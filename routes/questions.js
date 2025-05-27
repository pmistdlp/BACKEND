const express = require('express');
const router = express.Router();
const db = require('../model');
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

// GET questions for a course
router.get('/:courseId', (req, res) => {
  console.log(`Fetching questions for courseId: ${req.params.courseId}`);
  db.all(`SELECT * FROM questions WHERE courseId = ?`, [req.params.courseId], (err, rows) => {
    if (err) {
      console.error('Database error fetching questions:', err.message);
      return res.status(500).json({ error: `Internal server error: ${err.message}` });
    }
    console.log('Questions fetched:', rows);
    res.json(rows || []);
  });
});

// POST create a new question with optional images
router.post('/', upload, (req, res) => {
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

  // Validate kLevel against course's coDetails
  db.get(`SELECT coDetails FROM courses WHERE id = ?`, [courseId], (err, row) => {
    if (err) return res.status(500).json({ error: `Database error: ${err.message}` });
    if (!row) return res.status(404).json({ error: 'Course not found' });

    const coDetails = JSON.parse(row.coDetails);
    const selectedCO = coDetails.find(co => co.coNumber === coNumber);
    if (!selectedCO) return res.status(400).json({ error: `CO ${coNumber} not found in course` });
    if (kLevel < 1 || kLevel > 14 || kLevel > selectedCO.kLevel) {
      return res.status(400).json({ error: `K-Level must be between 1 and ${selectedCO.kLevel} for CO ${coNumber}` });
    }

    // Get image paths
    const questionImage = req.files.questionImage ? req.files.questionImage[0].path : null;
    const option1Image = req.files.option1Image ? req.files.option1Image[0].path : null;
    const option2Image = req.files.option2Image ? req.files.option2Image[0].path : null;
    const option3Image = req.files.option3Image ? req.files.option3Image[0].path : null;
    const option4Image = req.files.option4Image ? req.files.option4Image[0].path : null;

    db.run(
      `INSERT INTO questions (courseId, coNumber, kLevel, question, questionImage, option1, option1Image, option2, option2Image, option3, option3Image, option4, option4Image, answer, weightage) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [courseId, coNumber, kLevel, question, questionImage, option1, option1Image, option2, option2Image, option3, option3Image, option4, option4Image, answer, weightage || 1],
      function (err) {
        if (err) {
          console.error('Database error creating question:', err.message);
          return res.status(400).json({ error: `Failed to create question: ${err.message}` });
        }
        const questionId = this.lastID;
        db.run(
          `INSERT INTO course_history (courseId, action, questionId, userType, userId, timestamp) VALUES (?, ?, ?, ?, ?, ?)`,
          [courseId, 'added', questionId, userType, userId, getISTTimestamp()],
          (err) => {
            if (err) {
              console.error('Database error creating course history:', err.message);
              return res.status(400).json({ error: `Failed to log history: ${err.message}` });
            }
            res.json({ message: 'Question created', questionId });
          }
        );
      }
    );
  });
});

// PUT update a question with optional images
router.put('/:id', upload, (req, res) => {
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

  // Validate kLevel against course's coDetails
  db.get(`SELECT coDetails FROM courses WHERE id = ?`, [courseId], (err, row) => {
    if (err) return res.status(500).json({ error: `Database error: ${err.message}` });
    if (!row) return res.status(404).json({ error: 'Course not found' });

    const coDetails = JSON.parse(row.coDetails);
    const selectedCO = coDetails.find(co => co.coNumber === coNumber);
    if (!selectedCO) return res.status(400).json({ error: `CO ${coNumber} not found in course` });
    if (kLevel < 1 || kLevel > 14 || kLevel > selectedCO.kLevel) {
      return res.status(400).json({ error: `K-Level must be between 1 and ${selectedCO.kLevel} for CO ${coNumber}` });
    }

    // Get image paths (fetch existing images if not updated)
    db.get(`SELECT questionImage, option1Image, option2Image, option3Image, option4Image FROM questions WHERE id = ?`, [req.params.id], (err, row) => {
      if (err) return res.status(500).json({ error: `Database error: ${err.message}` });
      if (!row) return res.status(404).json({ error: 'Question not found' });

      const questionImage = req.files.questionImage ? req.files.questionImage[0].path : row.questionImage;
      const option1Image = req.files.option1Image ? req.files.option1Image[0].path : row.option1Image;
      const option2Image = req.files.option2Image ? req.files.option2Image[0].path : row.option2Image;
      const option3Image = req.files.option3Image ? req.files.option3Image[0].path : row.option3Image;
      const option4Image = req.files.option4Image ? req.files.option4Image[0].path : row.option4Image;

      db.run(
        `UPDATE questions SET coNumber = ?, kLevel = ?, question = ?, questionImage = ?, option1 = ?, option1Image = ?, option2 = ?, option2Image = ?, option3 = ?, option3Image = ?, option4 = ?, option4Image = ?, answer = ?, weightage = ? WHERE id = ?`,
        [coNumber, kLevel, question, questionImage, option1, option1Image, option2, option2Image, option3, option3Image, option4, option4Image, answer, weightage || 1, req.params.id],
        (err) => {
          if (err) {
            console.error('Database error updating question:', err.message);
            return res.status(400).json({ error: `Failed to update question: ${err.message}` });
          }
          db.run(
            `INSERT INTO course_history (courseId, action, questionId, userType, userId, timestamp) VALUES (?, ?, ?, ?, ?, ?)`,
            [courseId, 'updated', req.params.id, userType, userId, getISTTimestamp()],
            (err) => {
              if (err) {
                console.error('Database error updating course history:', err.message);
                return res.status(400).json({ error: `Failed to log history: ${err.message}` });
              }
              res.json({ message: 'Question updated' });
            }
          );
        }
      );
    });
  });
});

// DELETE multiple questions (bulk delete)
router.delete('/bulk', (req, res) => {
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

  // Fetch image paths for all questions to be deleted
  db.all(`SELECT id, questionImage, option1Image, option2Image, option3Image, option4Image FROM questions WHERE id IN (${questionIds.map(() => '?').join(',')})`, questionIds, (err, rows) => {
    if (err) {
      console.error('Database error fetching question images:', err.message);
      return res.status(500).json({ error: `Database error: ${err.message}` });
    }

    // Check if all requested questions exist
    if (rows.length !== questionIds.length) {
      const foundIds = rows.map(row => row.id);
      const missingIds = questionIds.filter(id => !foundIds.includes(id));
      return res.status(404).json({ error: `Some questions not found: ${missingIds.join(', ')}` });
    }

    // Delete questions from database
    db.run(`DELETE FROM questions WHERE id IN (${questionIds.map(() => '?').join(',')})`, questionIds, function (err) {
      if (err) {
        console.error('Database error deleting questions:', err.message);
        return res.status(400).json({ error: `Failed to delete questions: ${err.message}` });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'No questions found to delete' });
      }

      // Delete associated image files
      rows.forEach(row => {
        const images = [row.questionImage, row.option1Image, row.option2Image, row.option3Image, row.option4Image];
        images.forEach(image => {
          if (image && fs.existsSync(image)) {
            fs.unlink(image, (err) => {
              if (err) console.error(`Error deleting image ${image}:`, err.message);
            });
          }
        });
      });

      // Log deletion in course_history for each question
      const placeholders = questionIds.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
      const historyValues = questionIds.reduce((acc, id) => {
        acc.push(courseId, 'deleted', id, userType, userId, getISTTimestamp());
        return acc;
      }, []);

      db.run(
        `INSERT INTO course_history (courseId, action, questionId, userType, userId, timestamp) VALUES ${placeholders}`,
        historyValues,
        (err) => {
          if (err) {
            console.error('Database error logging history:', err.message);
            return res.status(400).json({ error: `Failed to log history: ${err.message}` });
          }
          res.json({ message: `${questionIds.length} questions deleted` });
        }
      );
    });
  });
});

// DELETE question (single)
router.delete('/:id', (req, res) => {
  console.log(`Attempting to delete question with id: ${req.params.id} by userId: ${req.body.userId}`);
  const { userType, userId, courseId } = req.body;

  // Basic check for admin access
  if (userType !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: Admin access required' });
  }

  if (!courseId) {
    return res.status(400).json({ error: 'courseId is required' });
  }

  // Fetch image paths to delete files
  db.get(`SELECT questionImage, option1Image, option2Image, option3Image, option4Image FROM questions WHERE id = ?`, [req.params.id], (err, row) => {
    if (err) {
      console.error('Database error fetching question images:', err.message);
      return res.status(500).json({ error: `Database error: ${err.message}` });
    }
    if (!row) {
      return res.status(404).json({ error: 'Question not found' });
    }

    // Delete question from database
    db.run(`DELETE FROM questions WHERE id = ?`, [req.params.id], function (err) {
      if (err) {
        console.error('Database error deleting question:', err.message);
        return res.status(400).json({ error: `Failed to delete question: ${err.message}` });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Question not found' });
      }

      // Delete associated image files
      const images = [row.questionImage, row.option1Image, row.option2Image, row.option3Image, row.option4Image];
      images.forEach(image => {
        if (image && fs.existsSync(image)) {
          fs.unlink(image, (err) => {
            if (err) console.error(`Error deleting image ${image}:`, err.message);
          });
        }
      });

      db.run(
        `INSERT INTO course_history (courseId, action, questionId, userType, userId, timestamp) VALUES (?, ?, ?, ?, ?, ?)`,
        [courseId, 'deleted', req.params.id, userType, userId, getISTTimestamp()],
        (err) => {
          if (err) {
            console.error('Database error deleting course history:', err.message);
            return res.status(400).json({ error: `Failed to log history: ${err.message}` });
          }
          res.json({ message: 'Question deleted' });
        }
      );
    });
  });
});

// Bulk upload preview
router.post('/bulk-upload/preview', upload, (req, res) => {
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

    db.get(`SELECT coDetails FROM courses WHERE id = ?`, [courseId], (err, row) => {
      if (err) return res.status(500).json({ error: `Database error: ${err.message}` });
      if (!row) return res.status(404).json({ error: 'Course not found' });

      const coDetails = JSON.parse(row.coDetails);
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
    });
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
router.post('/bulk-upload/confirm', (req, res) => {
  console.log('Confirming bulk upload:', req.body);
  const { courseId, userType, userId, questions } = req.body;
  if (!courseId || !userType || !userId || !questions || !Array.isArray(questions) || questions.length === 0) {
    return res.status(400).json({ error: 'courseId, userType, userId, and questions array are required' });
  }

  db.get(`SELECT coDetails FROM courses WHERE id = ?`, [courseId], (err, row) => {
    if (err) return res.status(500).json({ error: `Database error: ${err.message}` });
    if (!row) return res.status(404).json({ error: 'Course not found' });

    const coDetails = JSON.parse(row.coDetails);
    let insertedCount = 0;

    const insertQuestion = (index) => {
      if (index >= questions.length) {
        return res.json({ message: `${insertedCount} questions uploaded successfully` });
      }

      const q = questions[index];
      const selectedCO = coDetails.find(co => co.coNumber === q.coNumber);
      if (!selectedCO) {
        return res.status(400).json({ error: `CO ${q.coNumber} not found in course at question ${index + 1}` });
      }
      if (q.kLevel < 1 || q.kLevel > 14 || q.kLevel > selectedCO.kLevel) {
        return res.status(400).json({ error: `K-Level ${q.kLevel} invalid for CO ${q.coNumber} at question ${index + 1}` });
      }

      db.run(
        `INSERT INTO questions (courseId, coNumber, kLevel, question, questionImage, option1, option1Image, option2, option2Image, option3, option3Image, option4, option4Image, answer, weightage) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          courseId, q.coNumber, q.kLevel, q.question, q.questionImage,
          q.option1, q.option1Image, q.option2, q.option2Image,
          q.option3, q.option3Image, q.option4, q.option4Image,
          q.answer, q.weightage
        ],
        function (err) {
          if (err) {
            console.error('Database error inserting question:', err.message);
            return res.status(400).json({ error: `Failed to insert question ${index + 1}: ${err.message}` });
          }
          const questionId = this.lastID;
          db.run(
            `INSERT INTO course_history (courseId, action, questionId, userType, userId, timestamp) VALUES (?, ?, ?, ?, ?, ?)`,
            [courseId, 'added', questionId, userType, userId, getISTTimestamp()],
            (err) => {
              if (err) {
                console.error('Database error logging history:', err.message);
                return res.status(400).json({ error: `Failed to log history for question ${index + 1}: ${err.message}` });
              }
              insertedCount++;
              insertQuestion(index + 1);
            }
          );
        }
      );
    };

    insertQuestion(0);
  });
});

module.exports = router;