const express = require('express');
const router = express.Router();
const pgPool = require('../model');
const { getISTTimestamp } = require('../utils/helpers');
const upload = require('../utils/multer');
const XLSX = require('xlsx');
const fs = require('fs');

// Authentication middleware (kept for reference but not used in DELETE)
const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (req.body.userType !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: Admin access required' });
  }
  next();
};

// GET COs for a course
router.get('/:courseId/cos', async (req, res) => {
  console.log(`Fetching COs for courseId: ${req.params.courseId}`);
  try {
    const { rows } = await pgPool.query(
      `SELECT codetails, cocount FROM courses WHERE id = $1`,
      [req.params.courseId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Course not found' });
    }

    const { codetails, cocount } = rows[0];
    let coDetails;
    try {
      coDetails = codetails ? JSON.parse(codetails) : [];
    } catch (err) {
      console.error('Error parsing codetails JSON:', err.message);
      return res.status(500).json({ error: 'Invalid CO details format in course' });
    }

    if (!Array.isArray(coDetails) || coDetails.length !== cocount) {
      console.warn(`CO count mismatch for courseId: ${req.params.courseId}, cocount: ${cocount}, codetails length: ${coDetails.length}`);
    }

    res.json({
      coCount: cocount || 0,
      coDetails: coDetails.map(co => ({
        coNumber: co.coNumber,
        coDescription: co.coDescription,
        kLevel: co.kLevel
      }))
    });
  } catch (err) {
    console.error('Database error fetching COs:', err.message);
    return res.status(500).json({ error: `Internal server error: ${err.message}` });
  }
});

// GET questions for a course
router.get('/:courseId', async (req, res) => {
  console.log(`Fetching questions for courseId: ${req.params.courseId}`);
  try {
    const { rows } = await pgPool.query(`SELECT * FROM questions WHERE courseid = $1`, [req.params.courseId]);
    console.log('Questions fetched:', rows);
    res.json(rows || []);
  } catch (err) {
    console.error('Database error fetching questions:', err.message);
    return res.status(500).json({ error: `Internal server error: ${err.message}` });
  }
});

// POST create a new question with optional images
router.post('/', upload, async (req, res) => {
  console.log('Creating question:', req.body, req.files);
  const { courseId, coNumber, kLevel, question, option1, option2, option3, option4, answer, weightage, userType, userId } = req.body;
  if (!courseId || !coNumber || !kLevel || !question || !option1 || !option2 || !option3 || !option4 || !answer) {
    return res.status(400).json({ error: 'courseId, coNumber, kLevel, question, and all options with answer are required' });
  }

  // Validate answer
  const validAnswers = ['option1', 'option2', 'option3', 'option4'];
  if (!validAnswers.includes(answer.toLowerCase())) {
    return res.status(400).json({ error: `Invalid answer: ${answer}. Must be one of: ${validAnswers.join(', ')}` });
  }

  try {
    // Validate kLevel against course's coDetails
    const courseResult = await pgPool.query(`SELECT codetails FROM courses WHERE id = $1`, [courseId]);
    if (courseResult.rows.length === 0) {
      return res.status(404).json({ error: 'Course not found' });
    }

    const coDetails = JSON.parse(courseResult.rows[0].codetails || '[]');
    const selectedCO = coDetails.find(co => co.coNumber === coNumber);
    if (!selectedCO) {
      return res.status(400).json({ error: `CO ${coNumber} not found in course` });
    }
    if (kLevel < 1 || kLevel > 14 || kLevel > selectedCO.kLevel) {
      return res.status(400).json({ error: `K-Level must be between 1 and ${selectedCO.kLevel} for CO ${coNumber}` });
    }

    // Get image paths
    const questionImage = req.files.questionImage ? req.files.questionImage[0].path : null;
    const option1Image = req.files.option1Image ? req.files.option1Image[0].path : null;
    const option2Image = req.files.option2Image ? req.files.option2Image[0].path : null;
    const option3Image = req.files.option3Image ? req.files.option3Image[0].path : null;
    const option4Image = req.files.option4Image ? req.files.option4Image[0].path : null;

    const questionResult = await pgPool.query(
      `INSERT INTO questions (courseid, conumber, klevel, question, questionimage, option1, option1image, option2, option2image, option3, option3image, option4, option4image, answer, weightage) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING id`,
      [courseId, coNumber, kLevel, question, questionImage, option1, option1Image, option2, option2Image, option3, option3Image, option4, option4Image, answer, weightage || 1]
    );
    const questionId = questionResult.rows[0].id;

    await pgPool.query(
      `INSERT INTO course_history (courseid, action, questionid, usertype, userid, timestamp) VALUES ($1, $2, $3, $4, $5, $6)`,
      [courseId, 'added', questionId, userType, userId, getISTTimestamp()]
    );

    res.json({ message: 'Question created', questionId });
  } catch (err) {
    console.error('Database error creating question:', err.message);
    return res.status(400).json({ error: `Failed to create question: ${err.message}` });
  }
});

// PUT update a question with optional images
router.put('/:id', upload, async (req, res) => {
  console.log(`Updating question with id: ${req.params.id}`, req.body, req.files);
  const { courseId, coNumber, kLevel, question, option1, option2, option3, option4, answer, weightage, userType, userId } = req.body;
  if (!courseId || !coNumber || !kLevel || !question || !option1 || !option2 || !option3 || !option4 || !answer) {
    return res.status(400).json({ error: 'courseId, coNumber, kLevel, question, all options, and answer are required' });
  }

  // Validate answer
  const validAnswers = ['option1', 'option2', 'option3', 'option4'];
  if (!validAnswers.includes(answer.toLowerCase())) {
    return res.status(400).json({ error: `Invalid answer: ${answer}. Must be one of: ${validAnswers.join(', ')}` });
  }

  try {
    // Validate kLevel against course's coDetails
    const courseResult = await pgPool.query(`SELECT codetails FROM courses WHERE id = $1`, [courseId]);
    if (courseResult.rows.length === 0) {
      return res.status(404).json({ error: 'Course not found' });
    }

    const coDetails = JSON.parse(courseResult.rows[0].codetails || '[]');
    const selectedCO = coDetails.find(co => co.coNumber === coNumber);
    if (!selectedCO) {
      return res.status(400).json({ error: `CO ${coNumber} not found in course` });
    }
    if (kLevel < 1 || kLevel > 14 || kLevel > selectedCO.kLevel) {
      return res.status(400).json({ error: `K-Level must be between 1 and ${selectedCO.kLevel} for CO ${coNumber}` });
    }

    // Get existing image paths
    const questionResult = await pgPool.query(
      `SELECT questionimage, option1image, option2image, option3image, option4image FROM questions WHERE id = $1`,
      [req.params.id]
    );
    if (questionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Question not found' });
    }
    const existing = questionResult.rows[0];

    // Use new images if provided, otherwise keep existing
    const questionImage = req.files.questionImage ? req.files.questionImage[0].path : existing.questionimage;
    const option1Image = req.files.option1Image ? req.files.option1Image[0].path : existing.option1image;
    const option2Image = req.files.option2Image ? req.files.option2Image[0].path : existing.option2image;
    const option3Image = req.files.option3Image ? req.files.option3Image[0].path : existing.option3image;
    const option4Image = req.files.option4Image ? req.files.option4Image[0].path : existing.option4image;

    await pgPool.query(
      `UPDATE questions SET conumber = $1, klevel = $2, question = $3, questionimage = $4, option1 = $5, option1image = $6, option2 = $7, option2image = $8, option3 = $9, option3image = $10, option4 = $11, option4image = $12, answer = $13, weightage = $14 WHERE id = $15`,
      [coNumber, kLevel, question, questionImage, option1, option1Image, option2, option2Image, option3, option3Image, option4, option4Image, answer, weightage || 1, req.params.id]
    );

    await pgPool.query(
      `INSERT INTO course_history (courseid, action, questionid, usertype, userid, timestamp) VALUES ($1, $2, $3, $4, $5, $6)`,
      [courseId, 'updated', req.params.id, userType, userId, getISTTimestamp()]
    );

    res.json({ message: 'Question updated' });
  } catch (err) {
    console.error('Database error updating question:', err.message);
    return res.status(400).json({ error: `Failed to update question: ${err.message}` });
  }
});

// DELETE multiple questions (bulk delete)
router.delete('/bulk', async (req, res) => {
  console.log(`Attempting to delete questions with ids: ${req.body.questionIds} by userId: ${req.body.userId}`);
  const { questionIds, userType, userId, courseId } = req.body;

  // Validate inputs
  if (userType !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: Admin access required' });
  }
  if (!courseId) {
    return res.status(400).json({ error: 'courseId is required' });
  }
  if (!Array.isArray(questionIds) || questionIds.length === 0) {
    return res.status(400).json({ error: 'questionIds must be a non-empty array' });
  }

  let client;
  try {
    client = await pgPool.connect();
    await client.query('BEGIN');

    // Fetch image paths
    const imageResult = await client.query(
      `SELECT id, questionimage, option1image, option2image, option3image, option4image FROM questions WHERE id = ANY($1::integer[])`,
      [questionIds]
    );

    // Check if all questions exist
    if (imageResult.rows.length !== questionIds.length) {
      const foundIds = imageResult.rows.map(row => row.id);
      const missingIds = questionIds.filter(id => !foundIds.includes(id));
      throw new Error(`Some questions not found: ${missingIds.join(', ')}`);
    }

    // Delete questions
    const deleteResult = await client.query(
      `DELETE FROM questions WHERE id = ANY($1::integer[])`,
      [questionIds]
    );
    if (deleteResult.rowCount === 0) {
      throw new Error('No questions found to delete');
    }

    // Delete image files
    imageResult.rows.forEach(row => {
      const images = [row.questionimage, row.option1image, row.option2image, row.option3image, row.option4image];
      images.forEach(image => {
        if (image && fs.existsSync(image)) {
          fs.unlink(image, (err) => {
            if (err) console.error(`Error deleting image ${image}:`, err.message);
          });
        }
      });
    });

    // Log deletion in course_history
    const historyValues = questionIds.map(id => [courseId, 'deleted', id, userType, userId, getISTTimestamp()]);
    for (const values of historyValues) {
      await client.query(
        `INSERT INTO course_history (courseid, action, questionid, usertype, userid, timestamp) VALUES ($1, $2, $3, $4, $5, $6)`,
        values
      );
    }

    await client.query('COMMIT');
    res.json({ message: `${questionIds.length} questions deleted` });
  } catch (err) {
    if (client) {
      await client.query('ROLLBACK');
    }
    console.error('Database error deleting questions:', err.message);
    return res.status(400).json({ error: `Failed to delete questions: ${err.message}` });
  } finally {
    if (client) {
      client.release();
    }
  }
});

// DELETE question (single)
router.delete('/:id', async (req, res) => {
  console.log(`Attempting to delete question with id: ${req.params.id} by userId: ${req.body.userId}`);
  const { userType, userId, courseId } = req.body;

  // Basic check for admin access
  if (userType !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: Admin access required' });
  }
  if (!courseId) {
    return res.status(400).json({ error: 'courseId is required' });
  }

  let client;
  try {
    client = await pgPool.connect();
    await client.query('BEGIN');

    // Fetch image paths
    const imageResult = await client.query(
      `SELECT questionimage, option1image, option2image, option3image, option4image FROM questions WHERE id = $1`,
      [req.params.id]
    );
    if (imageResult.rows.length === 0) {
      throw new Error('Question not found');
    }

    // Delete question
    const deleteResult = await client.query(`DELETE FROM questions WHERE id = $1`, [req.params.id]);
    if (deleteResult.rowCount === 0) {
      throw new Error('Question not found');
    }

    // Delete image files
    const images = [
      imageResult.rows[0].questionimage,
      imageResult.rows[0].option1image,
      imageResult.rows[0].option2image,
      imageResult.rows[0].option3image,
      imageResult.rows[0].option4image
    ];
    images.forEach(image => {
      if (image && fs.existsSync(image)) {
        fs.unlink(image, (err) => {
          if (err) console.error(`Error deleting image ${image}:`, err.message);
        });
      }
    });

    // Log deletion
    await client.query(
      `INSERT INTO course_history (courseid, action, questionid, usertype, userid, timestamp) VALUES ($1, $2, $3, $4, $5, $6)`,
      [courseId, 'deleted', req.params.id, userType, userId, getISTTimestamp()]
    );

    await client.query('COMMIT');
    res.json({ message: 'Question deleted' });
  } catch (err) {
    if (client) {
      await client.query('ROLLBACK');
    }
    console.error('Database error deleting question:', err.message);
    return res.status(400).json({ error: `Failed to delete question: ${err.message}` });
  } finally {
    if (client) {
      client.release();
    }
  }
});

// Bulk upload preview
router.post('/bulk-upload/preview', upload, async (req, res) => {
  console.log('Processing bulk upload preview:', req.body);
  const courseId = req.body.courseId;
  if (!courseId || !req.files.file) {
    return res.status(400).json({ error: 'Course ID and file are required' });
  }

  try {
    const file = req.files.file[0]; // Access the uploaded file
    const fileBuffer = fs.readFileSync(file.path);
    const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });

    // Validate headers
    const expectedHeaders = [
      'CO Number', 'K-Level', 'Question', 'Question Image',
      'Option A', 'Option A Image',
      'Option B', 'Option B Image',
      'Option C', 'Option C Image',
      'Option D', 'Option D Image',
      'Correct Answer', 'Weightage'
    ];
    const headers = data[0];
    if (!headers || !expectedHeaders.every((h, i) => h === headers[i])) {
      throw new Error('Invalid CSV format: headers do not match expected format');
    }

    const courseResult = await pgPool.query(`SELECT codetails FROM courses WHERE id = $1`, [courseId]);
    if (courseResult.rows.length === 0) {
      throw new Error('Course not found');
    }

    const coDetails = JSON.parse(courseResult.rows[0].codetails || '[]');
    const questions = [];
    const errors = [];

    // Process rows, skipping header
    const dataRows = data.slice(1).filter(row => {
      // Skip rows that are completely empty or start with a comment
      const isEmpty = row.every(cell => cell === undefined || cell === '');
      const isComment = row[0] && row[0].toString().trim().startsWith('#');
      return !isEmpty && !isComment;
    });

    dataRows.forEach((row, index) => {
      try {
        const coNumber = row[0]?.toString().trim();
        const kLevel = parseInt(row[1]);
        const question = row[2]?.toString().trim();
        const questionImage = row[3]?.toString().trim() || null;
        const option1 = row[4]?.toString().trim();
        const option1Image = row[5]?.toString().trim() || null;
        const option2 = row[6]?.toString().trim();
        const option2Image = row[7]?.toString().trim() || null;
        const option3 = row[8]?.toString().trim();
        const option3Image = row[9]?.toString().trim() || null;
        const option4 = row[10]?.toString().trim();
        const option4Image = row[11]?.toString().trim() || null;
        const answer = row[12]?.toString().trim();
        const weightage = parseFloat(row[13]) || 1;

        // Validate required fields
        if (!coNumber || !kLevel || !question || !option1 || !option2 || !option3 || !option4 || !answer) {
          throw new Error('Missing required fields');
        }

        // Validate CO
        const selectedCO = coDetails.find(co => co.coNumber === coNumber);
        if (!selectedCO) {
          throw new Error(`CO ${coNumber} not found in course`);
        }

        // Validate K-Level
        if (isNaN(kLevel) || kLevel < 1 || kLevel > 14 || kLevel > selectedCO.kLevel) {
          throw new Error(`K-Level ${kLevel} invalid for CO ${coNumber} (max ${selectedCO.kLevel})`);
        }

        // Validate answer
        const answerMap = {
          'option1': 'option1',
          'option2': 'option2',
          'option3': 'option3',
          'option4': 'option4'
        };
        const mappedAnswer = answerMap[answer.toLowerCase()];
        if (!mappedAnswer) {
          throw new Error(`Invalid answer: ${answer}. Must be one of: option1, option2, option3, option4`);
        }

        // Validate weightage
        if (isNaN(weightage) || weightage <= 0) {
          throw new Error(`Invalid weightage: ${weightage}. Must be a positive number`);
        }

        questions.push({
          courseId: parseInt(courseId),
          coNumber,
          kLevel,
          question,
          questionImage,
          option1,
          option1Image,
          option2,
          option2Image,
          option3,
          option3Image,
          option4,
          option4Image,
          answer: mappedAnswer,
          weightage
        });
      } catch (error) {
        errors.push(`Row ${index + 2}: ${error.message}`);
      }
    });

    if (errors.length > 0) {
      return res.status(400).json({ error: 'Errors in CSV data', details: errors });
    }

    if (questions.length === 0) {
      return res.status(400).json({ error: 'No valid questions found in CSV' });
    }

    res.json({ questions });
  } catch (error) {
    console.error('Error processing CSV:', error.message);
    return res.status(400).json({ error: `Failed to process CSV: ${error.message}` });
  } finally {
    if (req.files.file && req.files.file[0].path) {
      fs.unlink(req.files.file[0].path, (err) => {
        if (err) console.error('Error deleting temporary file:', err.message);
      });
    }
  }
});

// Bulk upload confirm
router.post('/bulk-upload/confirm', async (req, res) => {
  console.log('Confirming bulk upload:', req.body);
  const { courseId, userType, userId, questions } = req.body;
  if (!courseId || !userType || !userId || !questions || !Array.isArray(questions) || questions.length === 0) {
    return res.status(400).json({ error: 'courseId, userType, userId, and questions array are required' });
  }

  let client;
  try {
    client = await pgPool.connect();
    await client.query('BEGIN');

    const courseResult = await client.query(`SELECT codetails FROM courses WHERE id = $1`, [courseId]);
    if (courseResult.rows.length === 0) {
      throw new Error('Course not found');
    }

    const coDetails = JSON.parse(courseResult.rows[0].codetails || '[]');
    let insertedCount = 0;

    for (let index = 0; index < questions.length; index++) {
      const q = questions[index];
      const selectedCO = coDetails.find(co => co.coNumber === q.coNumber);
      if (!selectedCO) {
        throw new Error(`CO ${q.coNumber} not found in course at question ${index + 1}`);
      }
      if (q.kLevel < 1 || q.kLevel > 14 || q.kLevel > selectedCO.kLevel) {
        throw new Error(`K-Level ${q.kLevel} invalid for CO ${q.coNumber} at question ${index + 1}`);
      }

      const questionResult = await client.query(
        `INSERT INTO questions (courseid, conumber, klevel, question, questionimage, option1, option1image, option2, option2image, option3, option3image, option4, option4image, answer, weightage) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         RETURNING id`,
        [
          courseId, q.coNumber, q.kLevel, q.question, q.questionImage,
          q.option1, q.option1Image, q.option2, q.option2Image,
          q.option3, q.option3Image, q.option4, q.option4Image,
          q.answer, q.weightage
        ]
      );
      const questionId = questionResult.rows[0].id;

      await client.query(
        `INSERT INTO course_history (courseid, action, questionid, usertype, userid, timestamp) VALUES ($1, $2, $3, $4, $5, $6)`,
        [courseId, 'added', questionId, userType, userId, getISTTimestamp()]
      );

      insertedCount++;
    }

    await client.query('COMMIT');
    res.json({ message: `${insertedCount} questions uploaded successfully` });
  } catch (err) {
    if (client) {
      await client.query('ROLLBACK');
    }
    console.error('Database error inserting questions:', err.message);
    return res.status(400).json({ error: `Failed to insert questions: ${err.message}` });
  } finally {
    if (client) {
      client.release();
    }
  }
});

module.exports = router;