const express = require('express');
const router = express.Router();
const pgPool = require('../model');

// Utility to shuffle an array (Fisher-Yates shuffle)
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// Fetch courses for a student
router.get('/:studentId', async (req, res) => {
  const studentId = req.params.studentId;
  console.log(`GET /api/student/student-courses/${studentId} at ${new Date().toISOString()}`);

  try {
    const { rows } = await pgPool.query(
      `SELECT c.id, c.name, c.learning_platform AS learningplatform, c.course_code AS coursecode, 
              c.examdate, c.examtime, c.examquestioncount, c.exammarks, sc.iseligible, sc.paymentconfirmed,
              CASE WHEN EXISTS (
                SELECT 1 FROM student_exams se WHERE se.studentid = sc.studentid AND se.courseid = c.id
              ) THEN TRUE ELSE FALSE END AS hascompleted,
              c.isdraft
       FROM courses c
       JOIN student_courses sc ON c.id = sc.courseid
       WHERE sc.studentid = $1 AND c.isdraft = FALSE`,
      [studentId]
    );
    console.log(`Fetched ${rows.length} courses for student ${studentId}`);
    const modifiedRows = rows.map(row => ({
      ...row,
      duration: 120,
    }));
    res.json(modifiedRows);
  } catch (err) {
    console.error('Error fetching student courses:', err.message, err.stack);
    return res.status(500).json({ error: `Internal server error: ${err.message}` });
  }
});

// Fetch questions for a course
router.get('/questions/:courseId', async (req, res) => {
  const courseId = req.params.courseId;
  console.log(`GET /api/student/student-courses/questions/${courseId} at ${new Date().toISOString()}`);

  try {
    const courseResult = await pgPool.query(
      `SELECT examquestioncount, exammarks, cocount FROM courses WHERE id = $1`,
      [courseId]
    );
    if (courseResult.rows.length === 0) {
      return res.status(404).json({ error: 'Course not found' });
    }

    const course = courseResult.rows[0];
    const examQuestionCount = course.examquestioncount || 0;
    const examMarks = course.exammarks || 0;
    const coCount = course.cocount || 0;

    if (coCount === 0) {
      return res.status(400).json({ error: 'No COs defined for this course' });
    }

    const w2 = examMarks - examQuestionCount;
    const w1 = examQuestionCount - w2;
    const totalMarks = w1 * 1 + w2 * 2;

    console.log(`Course ${courseId} - Total marks: ${totalMarks}, W1: ${w1}, W2: ${w2}`);

    if (w1 < 0 || w2 < 0) {
      return res.status(400).json({ error: 'Invalid examquestioncount or exammarks' });
    }

    const marksPerCO = Math.floor(totalMarks / coCount);
    const remainingMarks = totalMarks - (marksPerCO * coCount);

    const questionResult = await pgPool.query(
      `SELECT id, question, questionimage, option1, option1image, option2, option2image, 
              option3, option3image, option4, option4image, weightage, conumber
       FROM questions
       WHERE courseid = $1`,
      [courseId]
    );
    const rows = questionResult.rows;
    console.log(`Fetched ${rows.length} questions for course ${courseId}`);

    const questionsByCO = {};
    for (let i = 1; i <= coCount; i++) {
      const coNum = `CO${i}`;
      questionsByCO[coNum] = {
        weightage1: rows.filter(q => q.conumber === coNum && q.weightage === 1),
        weightage2: rows.filter(q => q.conumber === coNum && q.weightage === 2),
      };
    }

    const selectedQuestions = { phase1: [], phase2: [] };
    let totalMarksSelected = 0;

    for (let i = 1; i <= coCount; i++) {
      const coNum = `CO${i}`;
      let marksForThisCO = 0;
      const w1Questions = shuffleArray([...questionsByCO[coNum].weightage1]);
      const w2Questions = shuffleArray([...questionsByCO[coNum].weightage2]);

      while (marksForThisCO + 2 <= marksPerCO && w2Questions.length > 0) {
        const question = w2Questions.shift();
        selectedQuestions.phase2.push(question);
        marksForThisCO += 2;
        totalMarksSelected += 2;
      }

      while (marksForThisCO < marksPerCO && w1Questions.length > 0) {
        const question = w1Questions.shift();
        selectedQuestions.phase1.push(question);
        marksForThisCO += 1;
        totalMarksSelected += 1;
      }

      questionsByCO[coNum].weightage1 = w1Questions;
      questionsByCO[coNum].weightage2 = w2Questions;
    }

    let remainingMarksToSelect = remainingMarks;
    while (remainingMarksToSelect > 0) {
      const allRemainingW1 = [];
      const allRemainingW2 = [];
      for (let i = 1; i <= coCount; i++) {
        const coNum = `CO${i}`;
        allRemainingW1.push(...questionsByCO[coNum].weightage1);
        allRemainingW2.push(...questionsByCO[coNum].weightage2);
      }

      shuffleArray(allRemainingW1);
      shuffleArray(allRemainingW2);

      if (remainingMarksToSelect >= 2 && allRemainingW2.length > 0) {
        const question = allRemainingW2.shift();
        selectedQuestions.phase2.push(question);
        remainingMarksToSelect -= 2;
        totalMarksSelected += 2;
        const coNum = question.conumber;
        questionsByCO[coNum].weightage2 = questionsByCO[coNum].weightage2.filter(q => q.id !== question.id);
      } else if (allRemainingW1.length > 0) {
        const question = allRemainingW1.shift();
        selectedQuestions.phase1.push(question);
        remainingMarksToSelect -= 1;
        totalMarksSelected += 1;
        const coNum = question.conumber;
        questionsByCO[coNum].weightage1 = questionsByCO[coNum].weightage1.filter(q => q.id !== question.id);
      } else {
        break;
      }
    }

    if (selectedQuestions.phase1.length !== w1 || selectedQuestions.phase2.length !== w2) {
      return res.status(400).json({ error: `Not enough questions: required ${w1} W1 and ${w2} W2, got ${selectedQuestions.phase1.length} and ${selectedQuestions.phase2.length}` });
    }

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const normalizePath = (path) => {
      if (!path) return null;
      const normalized = path.replace(/\\/g, '/').replace(/^Uploads\//, '');
      return `${baseUrl}/Uploads/${normalized}`;
    };

    const modifiedQuestions = {
      phase1: selectedQuestions.phase1.map(row => ({
        ...row,
        questionimage: normalizePath(row.questionimage),
        option1image: normalizePath(row.option1image),
        option2image: normalizePath(row.option2image),
        option3image: normalizePath(row.option3image),
        option4image: normalizePath(row.option4image),
      })),
      phase2: selectedQuestions.phase2.map(row => ({
        ...row,
        questionimage: normalizePath(row.questionimage),
        option1image: normalizePath(row.option1image),
        option2image: normalizePath(row.option2image),
        option3image: normalizePath(row.option3image),
        option4image: normalizePath(row.option4image),
      })),
    };

    res.json(modifiedQuestions);
  } catch (err) {
    console.error('Error fetching questions:', err.message, err.stack);
    return res.status(500).json({ error: `Internal server error: ${err.message}` });
  }
});

// Submit a single answer
router.post('/submit-answer', async (req, res) => {
  const { studentId, courseId, questionId, selectedAnswer } = req.body;
  console.log(`POST /api/student/student-courses/submit-answer at ${new Date().toISOString()}:`, { studentId, courseId, questionId });

  if (!studentId || !courseId || !questionId || !selectedAnswer) {
    return res.status(400).json({ error: 'studentId, courseId, questionId, and selectedAnswer are required' });
  }

  try {
    const existingResult = await pgPool.query(
      `SELECT 1 FROM student_exams WHERE studentid = $1 AND courseid = $2 AND questionid = $3 LIMIT 1`,
      [studentId, courseId, questionId]
    );
    if (existingResult.rows.length > 0) {
      return res.status(400).json({ error: 'Answer already submitted for this question' });
    }

    const currentTime = new Date().toISOString();
    await pgPool.query(
      `INSERT INTO student_exams (studentid, courseid, questionid, selectedanswer, starttime, endtime, malpracticeflag) 
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [studentId, courseId, questionId, selectedAnswer, currentTime, currentTime, false]
    );

    res.json({ message: 'Answer submitted successfully' });
  } catch (err) {
    console.error('Error submitting answer:', err.message, err.stack);
    return res.status(500).json({ error: `Failed to submit answer: ${err.message}` });
  }
});

// Submit an entire exam
router.post('/submit-exam', async (req, res) => {
  const { studentId, courseId, answers, isMalpractice } = req.body;
  console.log(`POST /api/student/student-courses/submit-exam at ${new Date().toISOString()}:`, { studentId, courseId, isMalpractice });

  if (!studentId || !courseId || !Array.isArray(answers)) {
    return res.status(400).json({ error: 'studentId, courseId, and answers array are required' });
  }

  let client;
  try {
    client = await pgPool.connect();
    await client.query('BEGIN');

    const existingResult = await client.query(
      `SELECT 1 FROM student_exams WHERE studentid = $1 AND courseid = $2 LIMIT 1`,
      [studentId, courseId]
    );
    if (existingResult.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Exam already submitted for this course' });
    }

    const currentTime = new Date().toISOString();
    const malpracticeFlag = isMalpractice ? true : false;

    for (let index = 0; index < answers.length; index++) {
      const { questionId, selectedAnswer, startTime } = answers[index];
      if (!questionId || !startTime) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Invalid answer data at index ${index}: questionId and startTime are required` });
      }

      await client.query(
        `INSERT INTO student_exams (studentid, courseid, questionid, selectedanswer, starttime, endtime, malpracticeflag) 
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [studentId, courseId, questionId, selectedAnswer, startTime, currentTime, malpracticeFlag]
      );
    }

    await client.query('COMMIT');
    res.json({ message: malpracticeFlag ? 'Exam auto-evaluated due to malpractice' : 'Exam submitted successfully' });
  } catch (err) {
    if (client) {
      await client.query('ROLLBACK');
    }
    console.error('Error submitting exam:', err.message, err.stack);
    return res.status(500).json({ error: `Failed to submit exam: ${err.message}` });
  } finally {
    if (client) {
      client.release();
    }
  }
});

// Log malpractice
router.post('/malpractice', async (req, res) => {
  const { studentId, courseId, type } = req.body;
  console.log(`POST /api/student/student-courses/malpractice at ${new Date().toISOString()}:`, { studentId, courseId, type });

  if (!studentId || !courseId || !type) {
    return res.status(400).json({ error: 'studentId, courseId, and type are required' });
  }

  try {
    const timestamp = new Date().toISOString();
    await pgPool.query(
      `INSERT INTO malpractice_logs (studentid, courseid, type, timestamp) 
       VALUES ($1, $2, $3, $4)`,
      [studentId, courseId, type, timestamp]
    );
    res.json({ message: 'Malpractice logged successfully' });
  } catch (err) {
    console.error('Error logging malpractice:', err.message, err.stack);
    return res.status(500).json({ error: `Failed to log malpractice: ${err.message}` });
  }
});

module.exports = router;