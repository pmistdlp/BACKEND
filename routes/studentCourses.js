const express = require('express');
const router = express.Router();
const db = require('../model');

// Utility to shuffle an array (Fisher-Yates shuffle)
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

router.get('/:studentId', (req, res) => {
  const studentId = req.params.studentId;
  console.log(`Fetching courses for student ID: ${studentId}`);

  db.all(
    `SELECT c.id, c.name, c.learning_platform AS learningPlatform, c.course_code AS courseCode, 
            c.examDate, c.examTime, c.examQuestionCount, c.examMarks, sc.isEligible, sc.paymentConfirmed,
            CASE WHEN EXISTS (
              SELECT 1 FROM student_exams se WHERE se.studentId = sc.studentId AND se.courseId = c.id
            ) THEN 1 ELSE 0 END AS hasCompleted,
            c.isDraft
     FROM courses c
     JOIN student_courses sc ON c.id = sc.courseId
     WHERE sc.studentId = ? AND c.isDraft = 0`, // Reinstated c.isDraft = 0 condition
    [studentId],
    (err, rows) => {
      if (err) {
        console.error('Database error fetching student courses:', err.message);
        return res.status(500).json({ error: `Internal server error: ${err.message}` });
      }
      console.log('Courses fetched for student ID:', studentId, 'Rows:', rows);
      const modifiedRows = rows.map(row => ({
        ...row,
        duration: 120,
      }));
      res.json(modifiedRows);
    }
  );
});

router.get('/questions/:courseId', (req, res) => {
  const courseId = req.params.courseId;
  console.log(`Received request to fetch questions for course ID: ${courseId}`);
  console.log('Request headers:', req.headers);
  console.log('Request query params:', req.query);

  // Step 1: Fetch examQuestionCount, examMarks, and coCount from the courses table
  db.get(
    `SELECT examQuestionCount, examMarks, coCount FROM courses WHERE id = ?`,
    [courseId],
    (err, course) => {
      if (err) {
        console.error('Database error fetching course details:', err.message);
        return res.status(500).json({ error: `Internal server error: ${err.message}` });
      }
      if (!course) {
        return res.status(404).json({ error: 'Course not found' });
      }

      const examQuestionCount = course.examQuestionCount || 0;
      const examMarks = course.examMarks || 0;
      const coCount = course.coCount || 0;

      if (coCount === 0) {
        return res.status(400).json({ error: 'No COs defined for this course' });
      }

      // Step 2: Calculate total marks and required questions
      const w2 = examMarks - examQuestionCount; // Number of weightage 2 questions
      const w1 = examQuestionCount - w2; // Number of weightage 1 questions
      const totalMarks = w1 * 1 + w2 * 2;

      console.log(`Total marks: ${totalMarks}, Weightage 1 questions: ${w1}, Weightage 2 questions: ${w2}`);

      if (w1 < 0 || w2 < 0) {
        return res.status(400).json({ error: 'Invalid examQuestionCount or examMarks: cannot distribute questions based on weightage' });
      }

      // Step 3: Calculate marks per CO
      const marksPerCO = Math.floor(totalMarks / coCount); // Marks to take from each CO
      const remainingMarks = totalMarks - (marksPerCO * coCount); // Remaining marks to distribute randomly

      console.log(`Marks per CO: ${marksPerCO}, Remaining marks: ${remainingMarks}, CO count: ${coCount}`);

      // Step 4: Fetch all questions for the course, grouped by CO and weightage
      db.all(
        `SELECT id, question, questionImage, option1, option1Image, option2, option2Image, 
                option3, option3Image, option4, option4Image, weightage, coNumber
         FROM questions
         WHERE courseId = ?`,
        [courseId],
        (err, rows) => {
          if (err) {
            console.error('Database error fetching questions for course ID:', courseId, 'Error:', err.message);
            return res.status(500).json({ error: `Internal server error: ${err.message}` });
          }
          console.log(`Questions fetched for course ID: ${courseId}, Total questions: ${rows.length}`);
          console.log('Raw questions data:', rows);

          // Step 5: Group questions by CO and weightage
          const questionsByCO = {};
          for (let i = 1; i <= coCount; i++) {
            const coNum = `CO${i}`;
            questionsByCO[coNum] = {
              weightage1: rows.filter(q => q.coNumber === coNum && q.weightage === 1),
              weightage2: rows.filter(q => q.coNumber === coNum && q.weightage === 2),
            };
            console.log(`CO${i} - Weightage 1: ${questionsByCO[coNum].weightage1.length}, Weightage 2: ${questionsByCO[coNum].weightage2.length}`);
          }

          // Step 6: Distribute questions evenly across COs
          const selectedQuestions = { phase1: [], phase2: [] };
          let totalMarksSelected = 0;

          // For each CO, select questions to reach marksPerCO
          for (let i = 1; i <= coCount; i++) {
            const coNum = `CO${i}`;
            let marksForThisCO = 0;
            const w1Questions = shuffleArray([...questionsByCO[coNum].weightage1]);
            const w2Questions = shuffleArray([...questionsByCO[coNum].weightage2]);

            // First, try to use weightage 2 questions (2 marks each)
            while (marksForThisCO + 2 <= marksPerCO && w2Questions.length > 0) {
              const question = w2Questions.shift();
              selectedQuestions.phase2.push(question);
              marksForThisCO += 2;
              totalMarksSelected += 2;
            }

            // Then, fill the remaining marks with weightage 1 questions (1 mark each)
            while (marksForThisCO < marksPerCO && w1Questions.length > 0) {
              const question = w1Questions.shift();
              selectedQuestions.phase1.push(question);
              marksForThisCO += 1;
              totalMarksSelected += 1;
            }

            // Update the remaining questions after selection
            questionsByCO[coNum].weightage1 = w1Questions;
            questionsByCO[coNum].weightage2 = w2Questions;
          }

          console.log(`After even distribution: Total marks selected: ${totalMarksSelected}, Phase 1: ${selectedQuestions.phase1.length}, Phase 2: ${selectedQuestions.phase2.length}`);

          // Step 7: Select remaining marks randomly from any CO
          let remainingMarksToSelect = remainingMarks;
          while (remainingMarksToSelect > 0) {
            // Collect all remaining questions across all COs
            const allRemainingW1 = [];
            const allRemainingW2 = [];
            for (let i = 1; i <= coCount; i++) {
              const coNum = `CO${i}`;
              allRemainingW1.push(...questionsByCO[coNum].weightage1);
              allRemainingW2.push(...questionsByCO[coNum].weightage2);
            }

            // Shuffle remaining questions
            shuffleArray(allRemainingW1);
            shuffleArray(allRemainingW2);

            // Prefer weightage 2 if it fits
            if (remainingMarksToSelect >= 2 && allRemainingW2.length > 0) {
              const question = allRemainingW2.shift();
              selectedQuestions.phase2.push(question);
              remainingMarksToSelect -= 2;
              totalMarksSelected += 2;
              // Remove the question from its CO's pool
              const coNum = question.coNumber;
              questionsByCO[coNum].weightage2 = questionsByCO[coNum].weightage2.filter(q => q.id !== question.id);
            } else if (allRemainingW1.length > 0) {
              const question = allRemainingW1.shift();
              selectedQuestions.phase1.push(question);
              remainingMarksToSelect -= 1;
              totalMarksSelected += 1;
              // Remove the question from its CO's pool
              const coNum = question.coNumber;
              questionsByCO[coNum].weightage1 = questionsByCO[coNum].weightage1.filter(q => q.id !== question.id);
            } else {
              break; // No more questions available
            }
          }

          console.log(`Final selection: Total marks selected: ${totalMarksSelected}, Phase 1: ${selectedQuestions.phase1.length}, Phase 2: ${selectedQuestions.phase2.length}`);

          // Step 8: Validate the selected questions match the required counts
          if (selectedQuestions.phase1.length !== w1 || selectedQuestions.phase2.length !== w2) {
            return res.status(400).json({ error: `Not enough questions to meet the required distribution: required ${w1} weightage 1 and ${w2} weightage 2, got ${selectedQuestions.phase1.length} and ${selectedQuestions.phase2.length}` });
          }

          // Step 9: Construct absolute URLs for images
          const baseUrl = `${req.protocol}://${req.get('host')}`;
          const normalizePath = (path) => {
            if (!path) return null;
            const normalized = path.replace(/\\/g, '/').replace(/^Uploads\//, '');
            return `${baseUrl}/Uploads/${normalized}`;
          };

          const modifiedQuestions = {
            phase1: selectedQuestions.phase1.map(row => ({
              ...row,
              questionImage: normalizePath(row.questionImage),
              option1Image: normalizePath(row.option1Image),
              option2Image: normalizePath(row.option2Image),
              option3Image: normalizePath(row.option3Image),
              option4Image: normalizePath(row.option4Image),
            })),
            phase2: selectedQuestions.phase2.map(row => ({
              ...row,
              questionImage: normalizePath(row.questionImage),
              option1Image: normalizePath(row.option1Image),
              option2Image: normalizePath(row.option2Image),
              option3Image: normalizePath(row.option3Image),
              option4Image: normalizePath(row.option4Image),
            })),
          };

          console.log('Modified questions with absolute image URLs:', modifiedQuestions);
          res.json(modifiedQuestions);
        }
      );
    }
  );
});

router.post('/submit-exam', (req, res) => {
  const { studentId, courseId, answers, isMalpractice } = req.body;
  console.log(`Received exam submission for student ID: ${studentId}, course ID: ${courseId}, isMalpractice: ${isMalpractice}`);
  console.log('Answers:', answers);

  if (!studentId || !courseId || !Array.isArray(answers)) {
    return res.status(400).json({ error: 'studentId, courseId, and answers array are required' });
  }

  // Check if exam is already completed
  db.get(
    `SELECT 1 FROM student_exams WHERE studentId = ? AND courseId = ? LIMIT 1`,
    [studentId, courseId],
    (err, row) => {
      if (err) {
        console.error('Database error checking exam completion:', err.message);
        return res.status(500).json({ error: `Internal server error: ${err.message}` });
      }
      if (row) {
        return res.status(400).json({ error: 'Exam already submitted for this course' });
      }

      const currentTime = new Date().toISOString();
      const malpracticeFlag = isMalpractice ? 1 : 0;

      const insertAnswer = (index) => {
        if (index >= answers.length) {
          return res.json({ message: malpracticeFlag ? 'Exam auto-evaluated due to malpractice' : 'Exam submitted successfully' });
        }

        const { questionId, selectedAnswer, startTime } = answers[index];
        if (!questionId || !startTime) {
          return res.status(400).json({ error: `Invalid answer data at index ${index}: questionId and startTime are required` });
        }

        db.run(
          `INSERT INTO student_exams (studentId, courseId, questionId, selectedAnswer, startTime, endTime, malpracticeFlag) 
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [studentId, courseId, questionId, selectedAnswer, startTime, currentTime, malpracticeFlag],
          (err) => {
            if (err) {
              console.error('Database error inserting student exam:', err.message);
              return res.status(500).json({ error: `Failed to submit answer for question ${questionId}: ${err.message}` });
            }
            insertAnswer(index + 1);
          }
        );
      };

      insertAnswer(0);
    }
  );
});

router.post('/malpractice', (req, res) => {
  const { studentId, courseId, type } = req.body;
  console.log(`Received malpractice report for student ID: ${studentId}, course ID: ${courseId}, type: ${type}`);

  if (!studentId || !courseId || !type) {
    return res.status(400).json({ error: 'studentId, courseId, and type are required' });
  }

  const timestamp = new Date().toISOString();
  db.run(
    `INSERT INTO malpractice_logs (studentId, courseId, type, timestamp) 
     VALUES (?, ?, ?, ?)`,
    [studentId, courseId, type, timestamp],
    (err) => {
      if (err) {
        console.error('Database error logging malpractice:', err.message);
        return res.status(500).json({ error: `Failed to log malpractice: ${err.message}` });
      }
      res.json({ message: 'Malpractice logged successfully' });
    }
  );
});

module.exports = router;