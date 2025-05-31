const express = require('express');
const router = express.Router();
const pgPool = require('../model'); // Import the PostgreSQL pool

// Middleware to check if user is a student
const checkStudentAuth = (req, res, next) => {
  if (!req.session.user || req.session.user.role !== 'student') {
    console.log(`[${new Date().toISOString()}] Unauthorized access to student exam route`);
    return res.status(401).json({ error: 'Unauthorized: Student access required' });
  }
  next();
};

// Start Exam: Check eligibility and course status
router.post('/start/:courseId', checkStudentAuth, async (req, res) => {
  const { courseId } = req.params;
  const studentId = req.session.user.id;

  try {
    // Check course status and student eligibility
    const courseCheck = await pgPool.query(`
      SELECT c.isDraft, sc.isEligible, sc.paymentConfirmed
      FROM courses c
      JOIN student_courses sc ON c.id = sc.courseId
      WHERE c.id = $1 AND sc.studentId = $2
    `, [courseId, studentId]);

    if (courseCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Course or enrollment not found' });
    }

    const { isDraft, isEligible, paymentConfirmed } = courseCheck.rows[0];

    if (isDraft) {
      return res.status(400).json({ error: 'Exam is still in draft mode' });
    }
    if (!isEligible) {
      return res.status(400).json({ error: 'You are not eligible to take this exam' });
    }
    if (!paymentConfirmed) {
      return res.status(400).json({ error: 'Payment not confirmed' });
    }

    // Check if exam already started or completed
    const examCheck = await pgPool.query(`
      SELECT id, startTime, endTime
      FROM student_exams
      WHERE studentId = $1 AND courseId = $2
      LIMIT 1
    `, [studentId, courseId]);

    if (examCheck.rows.length > 0 && examCheck.rows[0].endTime) {
      return res.status(400).json({ error: 'Exam already completed' });
    }

    // Start exam by recording start time if not already started
    if (examCheck.rows.length === 0) {
      await pgPool.query(`
        INSERT INTO student_exams (studentId, courseId, startTime)
        VALUES ($1, $2, CURRENT_TIMESTAMP)
      `, [studentId, courseId]);
    }

    // Fetch questions for the course
    const questions = await pgPool.query(`
      SELECT id, coNumber, kLevel, question, questionImage,
             option1, option1Image, option2, option2Image,
             option3, option3Image, option4, option4Image,
             weightage
      FROM questions
      WHERE courseId = $1
      ORDER BY id
    `, [courseId]);

    res.json({
      message: 'Exam started successfully',
      questions: questions.rows,
    });
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Error starting exam:`, err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Submit Answer: Record student's answer for a question
router.post('/submit-answer', checkStudentAuth, async (req, res) => {
  const { courseId, questionId, selectedAnswer } = req.body;
  const studentId = req.session.user.id;

  try {
    // Verify exam is active
    const examCheck = await pgPool.query(`
      SELECT startTime, endTime
      FROM student_exams
      WHERE studentId = $1 AND courseId = $2
      LIMIT 1
    `, [studentId, courseId]);

    if (examCheck.rows.length === 0) {
      return res.status(400).json({ error: 'Exam not started' });
    }
    if (examCheck.rows[0].endTime) {
      return res.status(400).json({ error: 'Exam already completed' });
    }

    // Update or insert answer
    await pgPool.query(`
      INSERT INTO student_exams (studentId, courseId, questionId, selectedAnswer)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (studentId, courseId, questionId)
      DO UPDATE SET selectedAnswer = EXCLUDED.selectedAnswer
    `, [studentId, courseId, questionId, selectedAnswer]);

    res.json({ message: 'Answer submitted successfully' });
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Error submitting answer:`, err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// End Exam: Mark exam as completed
router.post('/end/:courseId', checkStudentAuth, async (req, res) => {
  const { courseId } = req.params;
  const studentId = req.session.user.id;

  try {
    const examCheck = await pgPool.query(`
      UPDATE student_exams
      SET endTime = CURRENT_TIMESTAMP
      WHERE studentId = $1 AND courseId = $2 AND endTime IS NULL
      RETURNING id
    `, [studentId, courseId]);

    if (examCheck.rows.length === 0) {
      return res.status(400).json({ error: 'Exam not started or already completed' });
    }

    res.json({ message: 'Exam ended successfully' });
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Error ending exam:`, err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;