const express = require('express');
const router = express.Router();
const db = require('../model');
const { getISTTimestamp } = require('../utils/helpers');
const multer = require('multer');
const XLSX = require('xlsx');
const fs = require('fs');
const csv = require('csv-parse');
const path = require('path');

// Create Uploads directory if it doesn't exist
const uploadDir = path.join(__dirname, '../Uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer configuration for single file upload (for bulk-upload/preview)
const singleFileUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
      cb(null, `${file.fieldname}-${uniqueSuffix}${path.extname(file.originalname)}`);
    },
  }),
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'text/csv',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV and Excel files are allowed'), false);
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
}).single('file');

// Multer configuration for photo and e-signature uploads
const upload = require('../utils/multer'); // Use existing multer configuration

// Validation function for DOB (8 digits)
const isValidDOB = (dob) => {
  return /^\d{8}$/.test(dob);
};

// Utility function to clean and convert numbers
const cleanNumber = (value) => {
  if (!value) return null;
  const cleaned = String(value).replace(/\./g, '');
  const num = parseInt(cleaned, 10);
  return isNaN(num) ? null : String(num);
};

// Debug route to verify router
router.get('/debug', (req, res) => {
  console.log('Received GET /api/student/debug at', new Date().toISOString());
  res.json({ message: 'Student router is active', timestamp: new Date().toISOString() });
});

// Student routes
router.get('/', (req, res) => {
  console.log('Received GET /api/student at', new Date().toISOString());
  db.all(`SELECT * FROM students`, [], (err, rows) => {
    if (err) {
      console.error('Database error fetching students:', err.stack);
      return res.status(500).json({ error: `Internal server error: ${err.message}` });
    }
    console.log('Students fetched:', rows);
    res.json(rows || []);
  });
});

router.post('/', upload, (req, res) => {
  console.log('Received POST /api/student at', new Date().toISOString(), 'with body:', req.body, 'files:', req.files);
  const { name, registerNo, dob, password, aadharNumber, abcId, userType, userId } = req.body;
  if (!name || !registerNo || !dob) {
    console.log('Validation failed: Name, Register No, or DOB missing');
    return res.status(400).json({ error: 'Name, Register No, and DOB are required' });
  }
  if (!isValidDOB(dob)) {
    console.log('Validation failed: Invalid DOB format:', dob);
    return res.status(400).json({ error: 'DOB must be 8 digits (e.g., 28022025 or 12345678)' });
  }
  const cleanedRegisterNo = cleanNumber(registerNo);
  const cleanedAadharNumber = cleanNumber(aadharNumber);
  const cleanedAbcId = cleanNumber(abcId);
  if (!cleanedRegisterNo) {
    console.log('Validation failed: Invalid Register No:', registerNo);
    return res.status(400).json({ error: 'Register No must be a valid number' });
  }
  const studentPassword = password || dob;
  const source = userType === 'admin' ? 'manual' : 'registration';
  const photo = req.files && req.files.photo ? `/Uploads/${req.files.photo[0].filename}` : null;
  const eSignature = req.files && req.files.eSignature ? `/Uploads/${req.files.eSignature[0].filename}` : null;

  db.run(
    `INSERT INTO students (name, registerNo, dob, password, aadharNumber, abcId, photo, eSignature, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [name, cleanedRegisterNo, dob, studentPassword, cleanedAadharNumber || null, cleanedAbcId || null, photo, eSignature, source],
    function (err) {
      if (err) {
        console.error('Database error creating student:', err.stack);
        return res.status(400).json({ error: `Failed to create student: ${err.message}` });
      }
      const studentId = this.lastID;
      db.run(
        `INSERT INTO student_history (studentId, action, userType, userId, timestamp) VALUES (?, ?, ?, ?, ?)`,
        [studentId, 'created', userType, userId, getISTTimestamp()],
        (err) => {
          if (err) {
            console.error('Database error creating student history:', err.stack);
            return res.status(400).json({ error: `Failed to log student history: ${err.message}` });
          }
          res.json({ message: 'Student created', studentId });
        }
      );
    }
  );
});

router.put('/:id', upload, (req, res) => {
  console.log('Received PUT /api/student/:id at', new Date().toISOString(), 'with body:', req.body, 'files:', req.files);
  const { name, registerNo, dob, password, aadharNumber, abcId, userType, userId } = req.body;
  if (!name || !registerNo || !dob) {
    console.log('Validation failed: Name, Register No, or DOB missing');
    return res.status(400).json({ error: 'Name, Register No, and DOB are required' });
  }
  if (!isValidDOB(dob)) {
    console.log('Validation failed: Invalid DOB format:', dob);
    return res.status(400).json({ error: 'DOB must be 8 digits (e.g., 28022025 or 12345678)' });
  }
  const cleanedRegisterNo = cleanNumber(registerNo);
  const cleanedAadharNumber = cleanNumber(aadharNumber);
  const cleanedAbcId = cleanNumber(abcId);
  if (!cleanedRegisterNo) {
    console.log('Validation failed: Invalid Register No:', registerNo);
    return res.status(400).json({ error: 'Register No must be a valid number' });
  }
  const studentPassword = password || dob;
  const photo = req.files && req.files.photo ? `/Uploads/${req.files.photo[0].filename}` : null;
  const eSignature = req.files && req.files.eSignature ? `/Uploads/${req.files.eSignature[0].filename}` : null;

  db.run(
    `UPDATE students SET name = ?, registerNo = ?, dob = ?, password = ?, aadharNumber = ?, abcId = ?, photo = COALESCE(?, photo), eSignature = COALESCE(?, eSignature) WHERE id = ?`,
    [name, cleanedRegisterNo, dob, studentPassword, cleanedAadharNumber || null, cleanedAbcId || null, photo, eSignature, req.params.id],
    (err) => {
      if (err) {
        console.error('Database error updating student:', err.stack);
        return res.status(400).json({ error: `Failed to update student: ${err.message}` });
      }
      db.run(
        `INSERT INTO student_history (studentId, action, userType, userId, timestamp) VALUES (?, ?, ?, ?, ?)`,
        [req.params.id, 'updated', userType, userId, getISTTimestamp()],
        (err) => {
          if (err) {
            console.error('Database error updating student history:', err.stack);
            return res.status(400).json({ error: `Failed to log student history: ${err.message}` });
          }
          res.json({ message: 'Student updated' });
        }
      );
    }
  );
});

router.delete('/:id', (req, res) => {
  console.log('Received DELETE /api/student/:id at', new Date().toISOString(), 'with body:', req.body);
  const { userType, userId } = req.body;
  db.run(`DELETE FROM students WHERE id = ?`, [req.params.id], (err) => {
    if (err) {
      console.error('Database error deleting student:', err.stack);
      return res.status(400).json({ error: `Failed to delete student: ${err.message}` });
    }
    db.run(
      `INSERT INTO student_history (studentId, action, userType, userId, timestamp) VALUES (?, ?, ?, ?, ?)`,
      [req.params.id, 'deleted', userType, userId, getISTTimestamp()],
      (err) => {
        if (err) {
          console.error('Database error deleting student history:', err.stack);
          return res.status(400).json({ error: `Failed to log student history: ${err.message}` });
        }
        res.json({ message: 'Student deleted' });
      }
    );
  });
});

// Bulk upload routes
router.post('/bulk-upload/preview', singleFileUpload, async (req, res) => {
  console.log('Received POST /api/student/bulk-upload/preview at', new Date().toISOString(), 'with file:', req.file);
  if (!req.file) {
    return res.status(400).json({ error: 'File is required' });
  }

  const file = req.file;
  if (!fs.existsSync(file.path)) {
    return res.status(500).json({ error: `Uploaded file not found: ${file.path}` });
  }

  try {
    let data;
    if (file.mimetype === 'text/csv') {
      data = await new Promise((resolve, reject) => {
        const results = [];
        fs.createReadStream(file.path)
          .pipe(csv.parse({ columns: true, trim: true, skip_lines_with_error: true }))
          .on('data', (row) => results.push(row))
          .on('error', (error) => reject(error))
          .on('end', () => resolve(results));
      });
    } else {
      const workbook = XLSX.readFile(file.path);
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      data = XLSX.utils.sheet_to_json(sheet);
    }

    const students = data.map((row) => {
      const dob = String(row['DOB'] || '');
      return {
        name: String(row['Student Name'] || ''),
        registerNo: cleanNumber(row['Register No']) || '',
        dob: dob,
        password: dob,
        aadharNumber: cleanNumber(row['Aadhar Number']) || null,
        abcId: cleanNumber(row['ABC ID']) || null,
        photo: null, // Not included in bulk upload
        eSignature: null, // Not included in bulk upload
        source: 'upload',
      };
    });

    const invalidRows = students.filter((s) => !s.name || !s.registerNo || !s.dob || !isValidDOB(s.dob));
    if (invalidRows.length > 0) {
      return res.status(400).json({
        error: 'Some rows are missing required fields or DOB is not 8 digits (e.g., 28022025 or 12345678)',
      });
    }

    res.json({ students });
  } catch (error) {
    console.error('Error processing file:', error.stack);
    res.status(500).json({ error: `Failed to process file: ${error.message}` });
  } finally {
    if (fs.existsSync(file.path)) {
      fs.unlink(file.path, (err) => {
        if (err) console.error('Error deleting uploaded file:', err);
      });
    }
  }
});

router.post('/bulk-upload/confirm', (req, res) => {
  console.log('Received POST /api/student/bulk-upload/confirm at', new Date().toISOString(), 'with body:', req.body);
  const { userType, userId, students } = req.body;
  if (!students || !Array.isArray(students)) {
    return res.status(400).json({ error: 'Students array is required' });
  }

  try {
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
      const stmt = db.prepare(
        `INSERT INTO students (name, registerNo, dob, password, aadharNumber, abcId, photo, eSignature, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      const historyStmt = db.prepare(
        `INSERT INTO student_history (studentId, action, userType, userId, timestamp) VALUES (?, ?, ?, ?, ?)`
      );

      let completedOperations = 0;
      let totalOperations = students.length;
      let errorOccurred = false;

      students.forEach((s) => {
        if (!s.dob || !isValidDOB(s.dob)) {
          console.error(`Invalid DOB for student ${s.name}: ${s.dob}`);
          errorOccurred = true;
          completedOperations++;
          if (completedOperations === totalOperations) {
            finalizeStatements();
          }
          return;
        }

        stmt.run(
          [
            s.name,
            s.registerNo,
            s.dob,
            s.password,
            s.aadharNumber || null,
            s.abcId || null,
            s.photo || null,
            s.eSignature || null,
            s.source,
          ],
          function (err) {
            if (err) {
              console.error('Error inserting student:', err.stack);
              errorOccurred = true;
              completedOperations++;
              if (completedOperations === totalOperations) {
                finalizeStatements();
              }
              return;
            }
            const studentId = this.lastID;
            historyStmt.run([studentId, 'created', userType, userId, getISTTimestamp()], (err) => {
              if (err) {
                console.error('Error inserting student history:', err.stack);
                errorOccurred = true;
              }
              completedOperations++;
              if (completedOperations === totalOperations) {
                finalizeStatements();
              }
            });
          }
        );
      });

      function finalizeStatements() {
        stmt.finalize((err) => {
          if (err) console.error('Error finalizing student statement:', err.stack);
          historyStmt.finalize((err) => {
            if (err) console.error('Error finalizing history statement:', err.stack);
            if (errorOccurred) {
              db.run('ROLLBACK', (err) => {
                if (err) console.error('Error rolling back transaction:', err.stack);
                res.status(400).json({ error: 'Failed to upload some students' });
              });
            } else {
              db.run('COMMIT', (err) => {
                if (err) {
                  console.error('Error committing transaction:', err.stack);
                  res.status(400).json({ error: 'Failed to commit transaction' });
                } else {
                  res.json({ message: `${students.length} students uploaded successfully` });
                }
              });
            }
          });
        });
      }
    });
  } catch (error) {
    db.run('ROLLBACK');
    console.error('Error saving students:', error.stack);
    res.status(500).json({ error: 'Failed to save students' });
  }
});

// Student courses routes
router.get('/student-courses/:studentId', (req, res) => {
  console.log('Received GET /api/student/student-courses/:studentId at', new Date().toISOString(), 'with params:', req.params);
  const studentId = req.params.studentId;
  db.all(
    `SELECT c.id, c.name, c.course_code, c.learning_platform, c.examDate, c.examTime, c.examQuestionCount, c.examMarks, c.coCount, c.coDetails, c.isDraft, c.isRegistrationOpen
     FROM student_courses sc
     JOIN courses c ON sc.courseId = c.id
     WHERE sc.studentId = ?`,
    [studentId],
    (err, rows) => {
      if (err) {
        console.error('Database error fetching student courses:', err.stack);
        return res.status(500).json({ error: `Database error fetching student courses: ${err.message}` });
      }
      console.log('Assigned courses fetched:', rows);
      res.json(rows || []);
    }
  );
});

router.post('/student-courses/single', async (req, res) => {
  console.log('Received POST /api/student/student-courses/single at', new Date().toISOString(), 'with body:', req.body);
  const { studentId, courseId, userType, userId } = req.body;

  if (!studentId || !courseId || !userType || !userId) {
    console.log('Validation failed for:', { studentId, courseId, userType, userId });
    return res.status(400).json({ error: 'Student ID, Course ID, User Type, and User ID are required' });
  }

  if (isNaN(studentId) || isNaN(courseId) || isNaN(userId)) {
    console.log('Invalid numeric fields:', { studentId, courseId, userId });
    return res.status(400).json({ error: 'Student ID, Course ID, and User ID must be valid numbers' });
  }

  try {
    const student = await new Promise((resolve, reject) => {
      db.get(`SELECT id, name, registerNo, dob FROM students WHERE id = ?`, [studentId], (err, row) => {
        if (err) reject(err);
        resolve(row);
      });
    });
    if (!student) {
      console.log(`Student not found: ${studentId}`);
      return res.status(400).json({ error: `Student with ID ${studentId} does not exist` });
    }
    if (!student.name || !student.registerNo || !student.dob || !isValidDOB(student.dob)) {
      console.log(`Student ${studentId} has invalid details:`, student);
      return res.status(400).json({ error: 'Student record is missing required fields or has invalid DOB' });
    }

    const course = await new Promise((resolve, reject) => {
      db.get(`SELECT id FROM courses WHERE id = ?`, [courseId], (err, row) => {
        if (err) reject(err);
        resolve(row);
      });
    });
    if (!course) {
      console.log(`Course not found: ${courseId}`);
      return res.status(400).json({ error: `Course with ID ${courseId} does not exist` });
    }

    const existingAssignment = await new Promise((resolve, reject) => {
      db.get(
        `SELECT id FROM student_courses WHERE studentId = ? AND courseId = ?`,
        [studentId, courseId],
        (err, row) => {
          if (err) reject(err);
          resolve(row);
        }
      );
    });
    if (existingAssignment) {
      console.log(`Assignment exists: studentId=${studentId}, courseId=${courseId}`);
      return res.status(400).json({ error: `Course ${courseId} is already assigned to student ${studentId}` });
    }

    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO student_courses (studentId, courseId, startDate, startTime) VALUES (?, ?, ?, ?)`,
        [studentId, courseId, new Date().toISOString().split('T')[0], new Date().toISOString().split('T')[1].split('.')[0]],
        function (err) {
          if (err) {
            console.error('Database error assigning course to student:', err.stack);
            reject(new Error(`Failed to assign course: ${err.message}`));
          } else {
            resolve();
          }
        }
      );
    });

    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO student_history (studentId, action, userType, userId, timestamp) VALUES (?, ?, ?, ?, ?)`,
        [studentId, `assigned_course_${courseId}`, userType, userId, getISTTimestamp()],
        (err) => {
          if (err) {
            console.error('Database error logging student history:', err.stack);
            reject(new Error(`Failed to log student history: ${err.message}`));
          } else {
            resolve();
          }
        }
      );
    });

    console.log(`Course ${courseId} assigned to student ${studentId} (${student.name})`);
    res.json({ message: 'Course assigned to student' });
  } catch (error) {
    console.error('Error in /api/student/student-courses/single:', error.stack);
    res.status(500).json({ error: `Failed to assign course: ${error.message}` });
  }
});

router.post('/student-courses/bulk', async (req, res) => {
  console.log('Received POST /api/student/student-courses/bulk at', new Date().toISOString(), 'with body:', req.body);
  const { assignments, userType, userId } = req.body;

  if (!assignments || !Array.isArray(assignments) || assignments.length === 0) {
    console.log('Invalid assignments array:', assignments);
    return res.status(400).json({ error: 'Assignments array is required and must not be empty' });
  }
  if (!userType || !userId || isNaN(userId)) {
    console.log('Invalid user fields:', { userType, userId });
    return res.status(400).json({ error: 'User Type and User ID are required, and User ID must be a number' });
  }

  try {
    const validAssignments = [];
    const errors = [];

    for (const { studentId, courseId } of assignments) {
      if (!studentId || !courseId || isNaN(studentId) || isNaN(courseId)) {
        errors.push(`Invalid studentId (${studentId}) or courseId (${courseId})`);
        continue;
      }

      const student = await new Promise((resolve, reject) => {
        db.get(`SELECT id, name, registerNo, dob FROM students WHERE id = ?`, [studentId], (err, row) => {
          if (err) reject(err);
          resolve(row);
        });
      });
      if (!student) {
        errors.push(`Student with ID ${studentId} does not exist`);
        continue;
      }
      if (!student.name || !student.registerNo || !student.dob || !isValidDOB(student.dob)) {
        errors.push(`Student ${studentId} has invalid details`);
        continue;
      }

      const course = await new Promise((resolve, reject) => {
        db.get(`SELECT id FROM courses WHERE id = ?`, [courseId], (err, row) => {
          if (err) reject(err);
          resolve(row);
        });
      });
      if (!course) {
        errors.push(`Course with ID ${courseId} does not exist`);
        continue;
      }

      const existingAssignment = await new Promise((resolve, reject) => {
        db.get(
          `SELECT id FROM student_courses WHERE studentId = ? AND courseId = ?`,
          [studentId, courseId],
          (err, row) => {
            if (err) reject(err);
            resolve(row);
          }
        );
      });
      if (existingAssignment) {
        errors.push(`Course ${courseId} is already assigned to student ${studentId}`);
        continue;
      }

      validAssignments.push({ studentId, courseId });
    }

    if (validAssignments.length === 0) {
      console.log('No valid assignments to process:', errors);
      return res.status(400).json({ error: 'No valid assignments to process', details: errors });
    }

    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
      const stmt = db.prepare(
        `INSERT INTO student_courses (studentId, courseId, startDate, startTime) VALUES (?, ?, ?, ?)`
      );
      const historyStmt = db.prepare(
        `INSERT INTO student_history (studentId, action, userType, userId, timestamp) VALUES (?, ?, ?, ?, ?)`
      );

      let completedOperations = 0;
      let totalOperations = validAssignments.length;
      let errorOccurred = false;

      validAssignments.forEach(({ studentId, courseId }) => {
        stmt.run(
          [studentId, courseId, new Date().toISOString().split('T')[0], new Date().toISOString().split('T')[1].split('.')[0]],
          function (err) {
            if (err) {
              console.error(`Error assigning course ${courseId} to student ${studentId}:`, err.stack);
              errorOccurred = true;
              completedOperations++;
              if (completedOperations === totalOperations) {
                finalizeStatements();
              }
              return;
            }
            historyStmt.run([studentId, `assigned_course_${courseId}`, userType, userId, getISTTimestamp()], (err) => {
              if (err) {
                console.error(`Error logging history for student ${studentId}, course ${courseId}:`, err.stack);
                errorOccurred = true;
              }
              completedOperations++;
              if (completedOperations === totalOperations) {
                finalizeStatements();
              }
            });
          }
        );
      });

      function finalizeStatements() {
        stmt.finalize((err) => {
          if (err) console.error('Error finalizing student_courses statement:', err.stack);
          historyStmt.finalize((err) => {
            if (err) console.error('Error finalizing history statement:', err.stack);
            if (errorOccurred) {
              db.run('ROLLBACK', (err) => {
                if (err) console.error('Error rolling back transaction:', err.stack);
                res.status(400).json({ error: 'Failed to assign some courses', details: errors });
              });
            } else {
              db.run('COMMIT', (err) => {
                if (err) {
                  console.error('Error committing transaction:', err.stack);
                  res.status(400).json({ error: 'Failed to commit transaction', details: errors });
                } else {
                  console.log(`Assigned ${validAssignments.length} courses successfully`);
                  res.json({
                    message: `${validAssignments.length} courses assigned successfully`,
                    skipped: errors
                  });
                }
              });
            }
          });
        });
      }
    });
  } catch (error) {
    console.error('Error in /api/student/student-courses/bulk:', error.stack);
    db.run('ROLLBACK');
    res.status(500).json({ error: `Failed to assign courses: ${error.message}` });
  }
});

router.delete('/student-courses', (req, res) => {
  console.log('Received DELETE /api/student/student-courses at', new Date().toISOString(), 'with body:', req.body);
  const { studentId, courseId, userType, userId } = req.body;
  if (!studentId || !courseId) {
    console.log('Missing studentId or courseId');
    return res.status(400).json({ error: 'Student ID and Course ID are required' });
  }

  db.run(
    `DELETE FROM student_courses WHERE studentId = ? AND courseId = ?`,
    [studentId, courseId],
    function (err) {
      if (err) {
        console.error('Database error unassigning course from student:', err.stack);
        return res.status(400).json({ error: `Failed to unassign course: ${err.message}` });
      }
      if (this.changes === 0) {
        console.log(`No course assignment found for studentId: ${studentId}, courseId: ${courseId}`);
        return res.status(404).json({ error: 'Course assignment not found' });
      }
      db.run(
        `INSERT INTO student_history (studentId, action, userType, userId, timestamp) VALUES (?, ?, ?, ?, ?)`,
        [studentId, `unassigned_course_${courseId}`, userType, userId, getISTTimestamp()],
        (err) => {
          if (err) {
            console.error('Database error logging student history:', err.stack);
            return res.status(400).json({ error: `Failed to log student history: ${err.message}` });
          }
          console.log('Course unassigned successfully');
          res.json({ message: 'Course unassigned from student' });
        }
      );
    }
  );
});

// Bulk delete route
router.post('/bulk-delete', (req, res) => {
  console.log('Received POST /api/student/bulk-delete at', new Date().toISOString(), 'with body:', req.body);
  const { studentIds, userType, userId } = req.body;
  if (!studentIds || !Array.isArray(studentIds) || studentIds.length === 0) {
    return res.status(400).json({ error: 'Student IDs array is required and must not be empty' });
  }

  try {
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
      const deleteStmt = db.prepare(`DELETE FROM students WHERE id = ?`);
      const historyStmt = db.prepare(
        `INSERT INTO student_history (studentId, action, userType, userId, timestamp) VALUES (?, ?, ?, ?, ?)`
      );

      let completedOperations = 0;
      let totalOperations = studentIds.length;
      let errorOccurred = false;

      studentIds.forEach((studentId) => {
        deleteStmt.run([studentId], function (err) {
          if (err) {
            console.error(`Error deleting student ${studentId}:`, err.stack);
            errorOccurred = true;
            completedOperations++;
            if (completedOperations === totalOperations) {
              finalizeStatements();
            }
            return;
          }
          historyStmt.run([studentId, 'deleted', userType, userId, getISTTimestamp()], (err) => {
            if (err) {
              console.error(`Error logging history for student ${studentId}:`, err.stack);
              errorOccurred = true;
            }
            completedOperations++;
            if (completedOperations === totalOperations) {
              finalizeStatements();
            }
          });
        });
      });

      function finalizeStatements() {
        deleteStmt.finalize((err) => {
          if (err) console.error('Error finalizing delete statement:', err.stack);
          historyStmt.finalize((err) => {
            if (err) console.error('Error finalizing history statement:', err.stack);
            if (errorOccurred) {
              db.run('ROLLBACK', (err) => {
                if (err) console.error('Error rolling back transaction:', err.stack);
                res.status(400).json({ error: 'Failed to delete some students' });
              });
            } else {
              db.run('COMMIT', (err) => {
                if (err) {
                  console.error('Error committing transaction:', err.stack);
                  res.status(400).json({ error: 'Failed to commit transaction' });
                } else {
                  res.json({ message: `${studentIds.length} students deleted successfully` });
                }
              });
            }
          });
        });
      }
    });
  } catch (error) {
    db.run('ROLLBACK');
    console.error('Error deleting students:', error.stack);
    res.status(500).json({ error: 'Failed to delete students' });
  }
});

module.exports = router;