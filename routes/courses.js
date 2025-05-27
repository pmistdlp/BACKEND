const express = require('express');
const router = express.Router();
const db = require('../model');
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
  // Ensure examTime is in HH:mm format and valid
  const timeRegex = /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/;
  if (!timeRegex.test(examTime)) {
    return null; // Invalid time format
  }
  // Parse and convert to IST
  return moment.tz(examTime, 'HH:mm', 'Asia/Kolkata').format('HH:mm');
};

// GET /api/courses - Fetch all courses with total questions
router.get('/', (req, res) => {
  db.all(`
    SELECT c.*, (SELECT COUNT(*) FROM questions q WHERE q.courseId = c.id) AS totalQuestions 
    FROM courses c
  `, [], (err, rows) => {
    if (err) {
      console.error('Error fetching courses:', err.message);
      return res.status(400).json({ error: 'Failed to fetch courses' });
    }
    // Ensure examTime is in HH:mm format
    const normalizedRows = rows.map(row => ({
      ...row,
      examTime: row.examTime ? moment.tz(row.examTime, 'HH:mm', 'Asia/Kolkata').format('HH:mm') : null
    }));
    res.json(normalizedRows);
  });
});

// POST /api/courses - Create a new course
router.post('/', (req, res) => {
  const { name, course_code, learning_platform, examDate, examTime, examQuestionCount, coCount, coDetails } = req.body;
  if (!name || !learning_platform) {
    return res.status(400).json({ error: 'Course Name and Learning Platform are required' });
  }
  if (!allowedPlatforms.includes(learning_platform)) {
    return res.status(400).json({ error: `Learning Platform must be one of: ${allowedPlatforms.join(', ')}` });
  }
  if (!Number.isInteger(coCount) || coCount < 0) {
    return res.status(400).json({ error: 'coCount must be a non-negative integer' });
  }
  const coDetailsError = validateCoDetails(coDetails, coCount);
  if (coDetailsError) {
    return res.status(400).json({ error: coDetailsError });
  }
  const istExamDate = examDate ? moment(examDate, 'YYYY-MM-DD').tz('Asia/Kolkata').format('YYYY-MM-DD') : null;
  const istExamTime = normalizeExamTime(examTime);
  const coDetailsString = coDetails && coCount > 0 ? JSON.stringify(coDetails) : '[]';

  db.run(
    `INSERT INTO courses (name, course_code, learning_platform, examDate, examTime, examQuestionCount, coCount, coDetails, isDraft, isRegistrationOpen) 
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [name, course_code || null, learning_platform, istExamDate, istExamTime, examQuestionCount || null, coCount || 0, coDetailsString, 1, 0],
    function (err) {
      if (err) {
        console.error('Error creating course:', err.message);
        return res.status(400).json({ error: 'Failed to create course due to a server error' });
      }
      res.json({ message: 'Course created as draft', id: this.lastID });
    }
  );
});

// PUT /api/courses/:id - Update an existing course
router.put('/:id', (req, res) => {
  const { name, course_code, learning_platform, examDate, examTime, examQuestionCount, examMarks, weightageDistribution, coCount, coDetails, isDraft, isRegistrationOpen } = req.body;
  if (!name || !learning_platform) {
    return res.status(400).json({ error: 'Course Name and Learning Platform are required' });
  }
  if (!allowedPlatforms.includes(learning_platform)) {
    return res.status(400).json({ error: `Learning Platform must be one of: ${allowedPlatforms.join(', ')}` });
  }
  if (!Number.isInteger(coCount) || coCount < 0) {
    return res.status(400).json({ error: 'coCount must be a non-negative integer' });
  }
  const coDetailsError = validateCoDetails(coDetails, coCount);
  if (coDetailsError) {
    return res.status(400).json({ error: coDetailsError });
  }

  const coDetailsString = coDetails && coCount > 0 ? JSON.stringify(coDetails) : '[]';

  if (isDraft === 0) {
    if (!examDate || !examTime || !examQuestionCount || !examMarks || !weightageDistribution) {
      return res.status(400).json({ error: 'Exam Date, Exam Time, Questions to Ask, Total Exam Marks, and Weightage Distribution are required to push the course.' });
    }

    const istExamDate = moment(examDate, 'YYYY-MM-DD').tz('Asia/Kolkata').format('YYYY-MM-DD');
    const istExamTime = normalizeExamTime(examTime);
    if (!istExamTime) {
      return res.status(400).json({ error: 'Invalid examTime format. Use HH:mm.' });
    }

    const w1Count = weightageDistribution[1] || 0;
    const w2Count = weightageDistribution[2] || 0;
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

    db.all(`SELECT weightage, COUNT(*) as count FROM questions WHERE courseId = ? GROUP BY weightage`, [req.params.id], (err, rows) => {
      if (err) {
        console.error('Error checking question weightage:', err.message);
        return res.status(500).json({ error: 'Failed to validate question weightage' });
      }

      const weightageCounts = {};
      rows.forEach(row => weightageCounts[row.weightage] = row.count);

      const availableW1 = weightageCounts[1] || 0;
      const availableW2 = weightageCounts[2] || 0;

      if (w1Count > availableW1 || w2Count > availableW2) {
        return res.status(400).json({ 
          error: `Not enough questions. W1 Required: ${w1Count}, Available: ${availableW1}. W2 Required: ${w2Count}, Available: ${availableW2}.` 
        });
      }

      db.run(
        `UPDATE courses SET name = ?, course_code = ?, learning_platform = ?, examDate = ?, examTime = ?, examQuestionCount = ?, examMarks = ?, coCount = ?, coDetails = ?, isDraft = ?, isRegistrationOpen = ? WHERE id = ?`,
        [name, course_code || null, learning_platform, istExamDate, istExamTime, examQuestionCount, examMarks, coCount || 0, coDetailsString, 0, isRegistrationOpen || 0, req.params.id],
        (err) => {
          if (err) {
            console.error('Error updating course:', err.message);
            return res.status(400).json({ error: 'Failed to update course due to a server error' });
          }
          res.json({ message: 'Course successfully pushed for test' });
        }
      );
    });
  } else {
    const istExamDate = examDate ? moment(examDate, 'YYYY-MM-DD').tz('Asia/Kolkata').format('YYYY-MM-DD') : null;
    const istExamTime = normalizeExamTime(examTime);
    db.run(
      `UPDATE courses SET name = ?, course_code = ?, learning_platform = ?, examDate = ?, examTime = ?, examQuestionCount = ?, examMarks = ?, coCount = ?, coDetails = ?, isDraft = ?, isRegistrationOpen = ? WHERE id = ?`,
      [name, course_code || null, learning_platform, istExamDate, istExamTime, examQuestionCount || null, null, coCount || 0, coDetailsString, 1, 0, req.params.id],
      (err) => {
        if (err) {
          console.error('Error updating course:', err.message);
          return res.status(400).json({ error: 'Failed to update course due to a server error' });
        }
        res.json({ message: 'Course revoked to draft or updated' });
      }
    );
  }
});

// PUT /api/courses/:id/toggle-registration - Toggle registration status
router.put('/:id/toggle-registration', (req, res) => {
  const courseId = req.params.id;
  const { isRegistrationOpen } = req.body;

  if (isRegistrationOpen === undefined) {
    return res.status(400).json({ error: 'isRegistrationOpen field is required' });
  }

  db.get(`SELECT isDraft FROM courses WHERE id = ?`, [courseId], (err, row) => {
    if (err) {
      console.error('Database error fetching course:', err.message);
      return res.status(500).json({ error: 'Failed to fetch course due to a server error' });
    }
    if (!row) {
      return res.status(404).json({ error: 'Course not found' });
    }
    if (row.isDraft) {
      return res.status(400).json({ error: 'Cannot toggle registration for a draft course' });
    }

    db.run(
      `UPDATE courses SET isRegistrationOpen = ? WHERE id = ?`,
      [isRegistrationOpen, courseId],
      function (err) {
        if (err) {
          console.error('Database error updating registration status:', err.message);
          return res.status(500).json({ error: 'Failed to update registration status due to a server error' });
        }
        if (this.changes === 0) {
          return res.status(404).json({ error: 'Course not found' });
        }
        res.json({ message: `Registration ${isRegistrationOpen ? 'opened' : 'closed'} for course` });
      }
    );
  });
});

// DELETE /api/courses/:id - Delete a course
router.delete('/:id', (req, res) => {
  db.run(`DELETE FROM courses WHERE id = ?`, [req.params.id], (err) => {
    if (err) {
      console.error('Error deleting course:', err.message);
      return res.status(400).json({ error: 'Failed to delete course due to a server error' });
    }
    res.json({ message: 'Course deleted' });
  });
});

module.exports = router;