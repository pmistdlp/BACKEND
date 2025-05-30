const express = require('express');
const router = express.Router();
const pgPool = require('../model');
const moment = require('moment-timezone');

const allowedPlatforms = ['NPTEL', 'NPTEL+', 'SWAYAM', 'ULEKTZ'];

// Validate coDetails structure
const validateCoDetails = (coDetails, coCount) => {
  if (coCount > 0) {
    if (!Array.isArray(coDetails) || coDetails.length !== coCount) {
      return 'coDetails must be an array with length equal to coCount';
    }
    const coNumbers = new Set();
    for (const co of coDetails) {
      if (!co.coNumber || typeof co.coNumber !== 'string' || co.coNumber.trim() === '') {
        return 'Each coDetails entry must have a non-empty coNumber (string)';
      }
      if (!co.coDescription || typeof co.coDescription !== 'string' || co.coDescription.trim() === '') {
        return 'Each coDetails entry must have a non-empty coDescription (string)';
      }
      if (!Number.isInteger(co.kLevel) || co.kLevel < 1 || co.kLevel > 6) {
        return 'Each coDetails entry must have a kLevel (integer, 1-6)';
      }
      const upperCoNumber = co.coNumber.toUpperCase();
      if (coNumbers.has(upperCoNumber)) {
        return 'coNumber values must be unique (case-insensitive)';
      }
      coNumbers.add(upperCoNumber);
    }
  } else if (coDetails && coDetails.length > 0) {
    return 'coDetails must be empty when coCount is 0';
  }
  return null;
};

// Validate and normalize examTime to IST
const normalizeExamTime = (examTime) => {
  if (!examTime) return null;
  const timeRegex = /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/;
  if (!timeRegex.test(examTime)) {
    return null; // Invalid time format
  }
  return moment.tz(examTime, 'HH:mm', 'Asia/Kolkata').format('HH:mm');
};

// Normalize database row to camelCase
const normalizeCourseResponse = (row) => ({
  id: row.id,
  name: row.name,
  courseCode: row.course_code || null,
  learningPlatform: row.learning_platform,
  examDate: row.examdate || null,
  examTime: row.examtime ? moment.tz(row.examtime, 'HH:mm', 'Asia/Kolkata').format('HH:mm') : null,
  examQuestionCount: row.examquestioncount || null,
  examMarks: row.exammarks || null,
  coCount: row.cocount || 0,
  coDetails: row.codetails ? JSON.parse(row.codetails) : [],
  isDraft: row.isdraft,
  isRegistrationOpen: row.isregistrationopen,
  totalQuestions: Number(row.totalquestions) || 0,
  totalStudentScores: Number(row.totalstudentscores) || 0, // New field
});

// GET /api/courses - Fetch all courses with total questions and student scores
router.get('/', async (req, res) => {
  try {
    const { rows } = await pgPool.query(`
      SELECT c.*,
             (SELECT COUNT(*) FROM questions q WHERE q.courseid = c.id) AS totalquestions,
             (SELECT COUNT(*) FROM student_results sr WHERE sr.courseid = c.id) AS totalstudentscores
      FROM courses c
    `);
    const normalizedRows = rows.map(normalizeCourseResponse);
    res.json(normalizedRows);
  } catch (err) {
    console.error('Error fetching courses:', err.message);
    return res.status(400).json({ error: 'Failed to fetch courses' });
  }
});

// POST /api/courses - Create a new course
router.post('/', async (req, res) => {
  const { name, courseCode, learningPlatform, examDate, examTime, examQuestionCount, coCount, coDetails } = req.body;
  if (!name || !learningPlatform) {
    return res.status(400).json({ error: 'Course Name and Learning Platform are required' });
  }
  if (!allowedPlatforms.includes(learningPlatform)) {
    return res.status(400).json({ error: `Learning Platform must be one of: ${allowedPlatforms.join(', ')}` });
  }
  if (!Number.isInteger(coCount) || coCount < 0) {
    return res.status(400).json({ error: 'coCount must be a non-negative integer' });
  }
  if (examQuestionCount !== null && (!Number.isInteger(examQuestionCount) || examQuestionCount < 0)) {
    return res.status(400).json({ error: 'examQuestionCount must be a non-negative integer or null' });
  }
  const coDetailsError = validateCoDetails(coDetails, coCount);
  if (coDetailsError) {
    return res.status(400).json({ error: coDetailsError });
  }
  const istExamDate = examDate ? moment(examDate, 'YYYY-MM-DD').tz('Asia/Kolkata').format('YYYY-MM-DD') : null;
  const istExamTime = normalizeExamTime(examTime);
  const coDetailsString = coDetails && coCount > 0 ? JSON.stringify(coDetails) : '[]';

  try {
    const { rows } = await pgPool.query(
      `INSERT INTO courses (name, course_code, learning_platform, examdate, examtime, examquestioncount, cocount, codetails, isdraft, isregistrationopen) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [name, courseCode || null, learningPlatform, istExamDate, istExamTime, examQuestionCount || null, coCount || 0, coDetailsString, true, false]
    );
    res.json({ message: 'Course created as draft', course: normalizeCourseResponse(rows[0]) });
  } catch (err) {
    console.error('Error creating course:', err.message);
    return res.status(400).json({ error: 'Failed to create course due to a server error' });
  }
});

// PUT /api/courses/:id - Update an existing course
router.put('/:id', async (req, res) => {
  const { name, courseCode, learningPlatform, examDate, examTime, examQuestionCount, examMarks, weightageDistribution, coCount, coDetails, isDraft, isRegistrationOpen } = req.body;
  if (!name || !learningPlatform) {
    return res.status(400).json({ error: 'Course Name and Learning Platform are required' });
  }
  if (!allowedPlatforms.includes(learningPlatform)) {
    return res.status(400).json({ error: `Learning Platform must be one of: ${allowedPlatforms.join(', ')}` });
  }
  if (!Number.isInteger(coCount) || coCount < 0) {
    return res.status(400).json({ error: 'coCount must be a non-negative integer' });
  }
  if (examQuestionCount !== null && (!Number.isInteger(examQuestionCount) || examQuestionCount < 0)) {
    return res.status(400).json({ error: 'examQuestionCount must be a non-negative integer or null' });
  }
  const coDetailsError = validateCoDetails(coDetails, coCount);
  if (coDetailsError) {
    return res.status(400).json({ error: coDetailsError });
  }

  const coDetailsString = coDetails && coCount > 0 ? JSON.stringify(coDetails) : '[]';

  if (isDraft === false) {
    if (!examDate || !examTime || !examQuestionCount || !examMarks || !weightageDistribution) {
      return res.status(400).json({ error: 'Exam Date, Exam Time, Questions to Ask, Total Exam Marks, and Weightage Distribution are required to push the course.' });
    }

    const istExamDate = moment(examDate, 'YYYY-MM-DD').tz('Asia/Kolkata').format('YYYY-MM-DD');
    const istExamTime = normalizeExamTime(examTime);
    if (!istExamTime) {
      return res.status(400).json({ error: 'Invalid examTime format. Use HH:mm.' });
    }

    const w1Count = Number(weightageDistribution[1]) || 0;
    const w2Count = Number(weightageDistribution[2]) || 0;
    const totalQuestions = w1Count + w2Count;
    const totalMarks = (w1Count * 1) + (w2Count * 2);

    if (totalQuestions !== examQuestionCount) {
      return res.status(400).json({ 
        error: `Total questions in weightage distribution (${totalQuestions}) must equal Questions to Ask (${examQuestionCount}).` 
      });
    }
    if (totalMarks !== examMarks) {
      return res.status(400).json({ 
        error: `Total marks from weightage distribution (${totalMarks}) must equal Total Exam Marks (${examMarks}).` 
      });
    }

    try {
      const { rows } = await pgPool.query(
        `SELECT weightage, COUNT(*) as count FROM questions WHERE courseid = $1 GROUP BY weightage`,
        [req.params.id]
      );

      const weightageCounts = {};
      rows.forEach(row => weightageCounts[row.weightage] = Number(row.count));

      const availableW1 = weightageCounts[1] || 0;
      const availableW2 = weightageCounts[2] || 0;

      if (w1Count > availableW1 || w2Count > availableW2) {
        return res.status(400).json({ 
          error: `Not enough questions. W1 Required: ${w1Count}, Available: ${availableW1}. W2 Required: ${w2Count}, Available: ${availableW2}.` 
        });
      }

      const { rows: updatedRows } = await pgPool.query(
        `UPDATE courses SET name = $1, course_code = $2, learning_platform = $3, examdate = $4, examtime = $5, examquestioncount = $6, exammarks = $7, cocount = $8, codetails = $9, isdraft = $10, isregistrationopen = $11 WHERE id = $12
         RETURNING *`,
        [name, courseCode || null, learningPlatform, istExamDate, istExamTime, examQuestionCount, examMarks, coCount || 0, coDetailsString, false, isRegistrationOpen || false, req.params.id]
      );
      if (updatedRows.length === 0) {
        return res.status(404).json({ error: 'Course not found' });
      }
      res.json({ message: 'Course successfully pushed for test', course: normalizeCourseResponse(updatedRows[0]) });
    } catch (err) {
      console.error('Error updating course:', err.message);
      return res.status(400).json({ error: 'Failed to update course due to a server error' });
    }
  } else {
    const istExamDate = examDate ? moment(examDate, 'YYYY-MM-DD').tz('Asia/Kolkata').format('YYYY-MM-DD') : null;
    const istExamTime = normalizeExamTime(examTime);
    try {
      const { rows: updatedRows } = await pgPool.query(
        `UPDATE courses SET name = $1, course_code = $2, learning_platform = $3, examdate = $4, examtime = $5, examquestioncount = $6, exammarks = $7, cocount = $8, codetails = $9, isdraft = $10, isregistrationopen = $11 WHERE id = $12
         RETURNING *`,
        [name, courseCode || null, learningPlatform, istExamDate, istExamTime, examQuestionCount || null, null, coCount || 0, coDetailsString, true, false, req.params.id]
      );
      if (updatedRows.length === 0) {
        return res.status(404).json({ error: 'Course not found' });
      }
      res.json({ message: 'Course revoked to draft or updated', course: normalizeCourseResponse(updatedRows[0]) });
    } catch (err) {
      console.error('Error updating course:', err.message);
      return res.status(400).json({ error: 'Failed to update course due to a server error' });
    }
  }
});

// PUT /api/courses/:id/toggle-registration - Toggle registration status
router.put('/:id/toggle-registration', async (req, res) => {
  const courseId = req.params.id;
  const { isRegistrationOpen } = req.body;

  if (isRegistrationOpen === undefined) {
    return res.status(400).json({ error: 'isRegistrationOpen field is required' });
  }

  try {
    const { rows } = await pgPool.query(`SELECT isdraft FROM courses WHERE id = $1`, [courseId]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Course not found' });
    }
    if (rows[0].isdraft) {
      return res.status(400).json({ error: 'Cannot toggle registration for a draft course' });
    }

    const { rows: updatedRows } = await pgPool.query(
      `UPDATE courses SET isregistrationopen = $1 WHERE id = $2
       RETURNING *`,
      [isRegistrationOpen, courseId]
    );
    if (updatedRows.length === 0) {
      return res.status(404).json({ error: 'Course not found' });
    }
    res.json({ message: `Registration ${isRegistrationOpen ? 'opened' : 'closed'} for course`, course: normalizeCourseResponse(updatedRows[0]) });
  } catch (err) {
    console.error('Database error updating registration status:', err.message);
    return res.status(500).json({ error: 'Failed to update registration status due to a server error' });
  }
});

// DELETE /api/courses/:id - Delete a course and its associated records
router.delete('/:id', async (req, res) => {
  const courseId = req.params.id;
  let client;

  try {
    // Start a transaction
    client = await pgPool.connect();
    await client.query('BEGIN');

    // Delete associated records in dependent tables
    await client.query(`DELETE FROM student_results WHERE courseid = $1`, [courseId]);
    await client.query(`DELETE FROM malpractice_logs WHERE courseid = $1`, [courseId]);
    await client.query(`DELETE FROM student_exams WHERE courseid = $1`, [courseId]);
    await client.query(`DELETE FROM course_history WHERE courseid = $1`, [courseId]);
    await client.query(`DELETE FROM student_courses WHERE courseid = $1`, [courseId]);
    await client.query(`DELETE FROM questions WHERE courseid = $1`, [courseId]);

    // Delete the course
    const result = await client.query(`DELETE FROM courses WHERE id = $1 RETURNING id`, [courseId]);

    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(404).json({ error: 'Course not found' });
    }

    // Commit the transaction
    await client.query('COMMIT');
    client.release();
    res.json({ message: 'Course and associated records deleted', id: courseId });
  } catch (err) {
    if (client) {
      await client.query('ROLLBACK');
      client.release();
    }
    console.error('Error deleting course:', err.message);
    return res.status(400).json({ error: 'Failed to delete course due to a server error' });
  }
});

module.exports = router;