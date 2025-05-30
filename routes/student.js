const express = require('express');
const router = express.Router();
const pgPool = require('../model');
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
const upload = require('../utils/multer');

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

// Fetch all students
router.get('/', async (req, res) => {
  console.log('Received GET /api/student at', new Date().toISOString());
  try {
    const { rows } = await pgPool.query(
      `SELECT id, name, registerNo, dob, aadharNumber, abcId, photo, esignature, source FROM students`
    );
    console.log('Students fetched:', rows);
    res.json(rows || []);
  } catch (err) {
    console.error('Database error fetching students:', err.stack);
    return res.status(500).json({ error: `Internal server error: ${err.message}` });
  }
});

// Fetch student by registerNo (case-insensitive)
router.get('/register/:registerNo', async (req, res) => {
  console.log(`Received GET /api/student/register/${req.params.registerNo} at`, new Date().toISOString());
  try {
    const { rows } = await pgPool.query(
      `SELECT id, name, registerNo, dob, aadharNumber, abcId, photo, esignature, source 
       FROM students 
       WHERE LOWER(registerNo) = LOWER($1)`,
      [req.params.registerNo]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }
    console.log('Student fetched:', rows[0]);
    res.json(rows[0]);
  } catch (err) {
    console.error('Database error fetching student by registerNo:', err.stack);
    return res.status(500).json({ error: `Internal server error: ${err.message}` });
  }
});

// Create a new student
router.post('/', upload, async (req, res) => {
  console.log('Received POST /api/student at', new Date().toISOString(), 'with body:', req.body, 'files:', req.files);
  const { name, registerNo, dob, password, aadharNumber, abcId, userType, userId } = req.body;
  if (!name || !registerNo) {
    console.log('Validation failed: Name or Register No missing');
    return res.status(400).json({ error: 'Name and Register No are required' });
  }
  if (dob && !isValidDOB(dob)) {
    console.log('Validation failed: Invalid DOB format:', dob);
    return res.status(400).json({ error: 'DOB must be 8 digits (e.g., 28042005) if provided' });
  }
  const cleanedRegisterNo = cleanNumber(registerNo);
  const cleanedAadharNumber = cleanNumber(aadharNumber);
  const cleanedAbcId = cleanNumber(abcId);
  if (!cleanedRegisterNo) {
    console.log('Validation failed: Invalid Register No:', registerNo);
    return res.status(400).json({ error: 'Register No must be a valid number' });
  }
  const studentPassword = password || dob || '';
  const source = userType === 'admin' ? 'manual' : 'registration';
  const photo = req.files && req.files.photo ? `/Uploads/${req.files.photo[0].filename}` : null;
  const eSignature = req.files && req.files.eSignature ? `/Uploads/${req.files.eSignature[0].filename}` : null;

  try {
    const studentResult = await pgPool.query(
      `INSERT INTO students (name, registerNo, dob, password, aadharNumber, abcId, photo, esignature, source) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [name, cleanedRegisterNo, dob || null, studentPassword, cleanedAadharNumber || null, cleanedAbcId || null, photo, eSignature, source]
    );
    const studentId = studentResult.rows[0].id;

    await pgPool.query(
      `INSERT INTO student_history (studentid, action, usertype, userid, timestamp) VALUES ($1, $2, $3, $4, $5)`,
      [studentId, 'created', userType, userId, getISTTimestamp()]
    );

    res.json({ message: 'Student created', studentId });
  } catch (err) {
    console.error('Database error creating student:', err.stack);
    return res.status(400).json({ error: `Failed to create student: ${err.message}` });
  }
});

// Update a student
router.put('/:id', upload, async (req, res) => {
  console.log('Received PUT /api/student/:id at', new Date().toISOString(), 'with body:', req.body, 'files:', req.files);
  const { name, registerNo, dob, password, aadharNumber, abcId, userType, userId } = req.body;
  if (!name || !registerNo) {
    console.log('Validation failed: Name or Register No missing');
    return res.status(400).json({ error: 'Name and Register No are required' });
  }
  if (dob && !isValidDOB(dob)) {
    console.log('Validation failed: Invalid DOB format:', dob);
    return res.status(400).json({ error: 'DOB must be 8 digits (e.g., 28042005) if provided' });
  }
  const cleanedRegisterNo = cleanNumber(registerNo);
  const cleanedAadharNumber = cleanNumber(aadharNumber);
  const cleanedAbcId = cleanNumber(abcId);
  if (!cleanedRegisterNo) {
    console.log('Validation failed: Invalid Register No:', registerNo);
    return res.status(400).json({ error: 'Register No must be a valid number' });
  }
  const studentPassword = password || dob || '';
  const photo = req.files && req.files.photo ? `/Uploads/${req.files.photo[0].filename}` : null;
  const eSignature = req.files && req.files.eSignature ? `/Uploads/${req.files.eSignature[0].filename}` : null;

  try {
    const updateResult = await pgPool.query(
      `UPDATE students SET name = $1, registerNo = $2, dob = $3, password = $4, aadharNumber = $5, abcId = $6, 
       photo = COALESCE($7, photo), esignature = COALESCE($8, esignature) WHERE id = $9`,
      [name, cleanedRegisterNo, dob || null, studentPassword, cleanedAadharNumber || null, cleanedAbcId || null, photo, eSignature, req.params.id]
    );
    if (updateResult.rowCount === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }

    await pgPool.query(
      `INSERT INTO student_history (studentid, action, usertype, userid, timestamp) VALUES ($1, $2, $3, $4, $5)`,
      [req.params.id, 'updated', userType, userId, getISTTimestamp()]
    );

    res.json({ message: 'Student updated' });
  } catch (err) {
    console.error('Database error updating student:', err.stack);
    return res.status(400).json({ error: `Failed to update student: ${err.message}` });
  }
});

// Delete a student
router.delete('/:id', async (req, res) => {
  console.log('Received DELETE /api/student/:id at', new Date().toISOString(), 'with params:', req.params, 'body:', req.body);
  const { userType, userId } = req.body;
  const studentId = req.params.id;
  let client;

  try {
    client = await pgPool.connect();
    await client.query('BEGIN');

    await pgPool.query(
      `INSERT INTO student_history (studentid, action, usertype, userid, timestamp) VALUES ($1, $2, $3, $4, $5)`,
      [studentId, 'deleted', userType, userId, getISTTimestamp()]
    );

    await client.query(`DELETE FROM student_results WHERE studentid = $1`, [studentId]);
    await client.query(`DELETE FROM malpractice_logs WHERE studentid = $1`, [studentId]);
    await client.query(`DELETE FROM student_exams WHERE studentid = $1`, [studentId]);
    await client.query(`DELETE FROM student_courses WHERE studentid = $1`, [studentId]);
    await client.query(`DELETE FROM student_history WHERE studentid = $1`, [studentId]);

    const deleteResult = await client.query(`DELETE FROM students WHERE id = $1 RETURNING id`, [studentId]);

    if (deleteResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Student not found' });
    }

    await client.query('COMMIT');
    res.json({ message: 'Student and associated records deleted', id: studentId });
  } catch (err) {
    if (client) {
      await client.query('ROLLBACK');
    }
    console.error('Database error deleting student:', err.stack);
    return res.status(400).json({ error: `Failed to delete student: ${err.message}` });
  } finally {
    if (client) {
      client.release();
    }
  }
});

// Bulk upload preview
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
        password: dob || '',
        aadharNumber: cleanNumber(row['Aadhar Number']) || null,
        abcId: cleanNumber(row['ABC ID']) || null,
        photo: null,
        eSignature: null,
        source: 'upload',
      };
    });

    const invalidRows = students.filter((s) => !s.name || !s.registerNo);
    if (invalidRows.length > 0) {
      return res.status(400).json({
        error: 'Some rows are missing required fields (name or registerNo)',
      });
    }
    const invalidDOBs = students.filter((s) => s.dob && !isValidDOB(s.dob));
    if (invalidDOBs.length > 0) {
      return res.status(400).json({
        error: 'Some rows have invalid DOB format (must be 8 digits, e.g., 28042005)',
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

// Bulk upload confirm
router.post('/bulk-upload/confirm', async (req, res) => {
  console.log('Received POST /api/student/bulk-upload/confirm at', new Date().toISOString(), 'with body:', req.body);
  const { userType, userId, students } = req.body;
  if (!students || !Array.isArray(students)) {
    return res.status(400).json({ error: 'Students array is required' });
  }

  let client;
  try {
    client = await pgPool.connect();
    await client.query('BEGIN');

    for (const s of students) {
      if (!s.name || !s.registerNo) {
        throw new Error(`Missing required fields for student ${s.name || 'unknown'}`);
      }
      if (s.dob && !isValidDOB(s.dob)) {
        throw new Error(`Invalid DOB for student ${s.name}: ${s.dob}`);
      }

      const studentResult = await client.query(
        `INSERT INTO students (name, registerNo, dob, password, aadharNumber, abcId, photo, esignature, source) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [
          s.name,
          s.registerNo,
          s.dob || null,
          s.password || '',
          s.aadharNumber || null,
          s.abcId || null,
          s.photo || null,
          s.eSignature || null,
          s.source,
        ]
      );
      const studentId = studentResult.rows[0].id;

      await client.query(
        `INSERT INTO student_history (studentid, action, usertype, userid, timestamp) VALUES ($1, $2, $3, $4, $5)`,
        [studentId, 'created', userType, userId, getISTTimestamp()]
      );
    }

    await client.query('COMMIT');
    res.json({ message: `${students.length} students uploaded successfully` });
  } catch (error) {
    if (client) {
      await client.query('ROLLBACK');
    }
    console.error('Error saving students:', error.stack);
    res.status(500).json({ error: `Failed to save students: ${error.message}` });
  } finally {
    if (client) {
      client.release();
    }
  }
});

// Fetch student courses
router.get('/student-courses/:studentId', async (req, res) => {
  console.log('Received GET /api/student/student-courses/:studentId at', new Date().toISOString(), 'with params:', req.params);
  const studentId = req.params.studentId;
  try {
    const { rows } = await pgPool.query(
      `SELECT c.id, c.name, c.course_code, c.learning_platform, c.examdate, c.examtime, c.examquestioncount, c.exammarks, c.cocount, c.codetails, c.isdraft, c.isregistrationopen,
              s.registerNo, s.name AS student_name
       FROM student_courses sc
       JOIN courses c ON sc.courseid = c.id
       JOIN students s ON sc.studentid = s.id
       WHERE sc.studentid = $1`,
      [studentId]
    );
    console.log('Assigned courses fetched:', rows);
    res.json(rows || []);
  } catch (err) {
    console.error('Database error fetching student courses:', err.stack);
    return res.status(500).json({ error: `Database error fetching student courses: ${err.message}` });
  }
});

// Assign a single course to a student
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

  let client;
  try {
    client = await pgPool.connect();
    await client.query('BEGIN');

    // Verify student exists
    const studentResult = await client.query(
      `SELECT id FROM students WHERE id = $1`,
      [studentId]
    );
    if (studentResult.rows.length === 0) {
      console.log(`Student not found: ${studentId}`);
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Student with ID ${studentId} does not exist` });
    }

    // Verify course exists
    const courseResult = await client.query(`SELECT id FROM courses WHERE id = $1`, [courseId]);
    if (courseResult.rows.length === 0) {
      console.log(`Course not found: ${courseId}`);
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Course with ID ${courseId} does not exist` });
    }

    // Check for existing assignment
    const existingAssignmentResult = await client.query(
      `SELECT id FROM student_courses WHERE studentid = $1 AND courseid = $2`,
      [studentId, courseId]
    );
    if (existingAssignmentResult.rows.length > 0) {
      console.log(`Assignment exists: studentId=${studentId}, courseId=${courseId}`);
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Course ${courseId} is already assigned to student ${studentId}` });
    }

    // Assign course
    await client.query(
      `INSERT INTO student_courses (studentid, courseid, startdate, starttime, isEligible, paymentConfirmed) 
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [studentId, courseId, new Date().toISOString().split('T')[0], new Date().toISOString().split('T')[1].split('.')[0], false, false]
    );

    await client.query(
      `INSERT INTO student_history (studentid, action, usertype, userid, timestamp) VALUES ($1, $2, $3, $4, $5)`,
      [studentId, `assigned_course_${courseId}`, userType, userId, getISTTimestamp()]
    );

    await client.query('COMMIT');
    console.log(`Course ${courseId} assigned to student ${studentId}`);
    res.json({ message: 'Course assigned to student' });
  } catch (error) {
    if (client) {
      await client.query('ROLLBACK');
    }
    console.error('Error in /api/student/student-courses/single:', error.stack);
    res.status(500).json({ error: `Failed to assign course: ${error.message}` });
  } finally {
    if (client) {
      client.release();
    }
  }
});

// Bulk assign courses
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

  let client;
  try {
    client = await pgPool.connect();
    await client.query('BEGIN');

    const validAssignments = [];
    const errors = [];

    for (const { studentId, courseId } of assignments) {
      if (!studentId || !courseId || isNaN(studentId) || isNaN(courseId)) {
        errors.push(`Invalid studentId (${studentId}) or courseId (${courseId})`);
        continue;
      }

      const studentResult = await client.query(
        `SELECT id FROM students WHERE id = $1`,
        [studentId]
      );
      if (studentResult.rows.length === 0) {
        errors.push(`Student with ID ${studentId} does not exist`);
        continue;
      }

      const courseResult = await client.query(`SELECT id FROM courses WHERE id = $1`, [courseId]);
      if (courseResult.rows.length === 0) {
        errors.push(`Course with ID ${courseId} does not exist`);
        continue;
      }

      const existingAssignmentResult = await client.query(
        `SELECT id FROM student_courses WHERE studentid = $1 AND courseid = $2`,
        [studentId, courseId]
      );
      if (existingAssignmentResult.rows.length > 0) {
        errors.push(`Course ${courseId} is already assigned to student ${studentId}`);
        continue;
      }

      validAssignments.push({ studentId, courseId });
    }

    if (validAssignments.length === 0) {
      console.log('No valid assignments to process:', errors);
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'No valid assignments to process', details: errors });
    }

    for (const { studentId, courseId } of validAssignments) {
      await client.query(
        `INSERT INTO student_courses (studentid, courseid, startdate, starttime, isEligible, paymentConfirmed) 
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [studentId, courseId, new Date().toISOString().split('T')[0], new Date().toISOString().split('T')[1].split('.')[0], false, false]
      );

      await client.query(
        `INSERT INTO student_history (studentid, action, usertype, userid, timestamp) VALUES ($1, $2, $3, $4, $5)`,
        [studentId, `assigned_course_${courseId}`, userType, userId, getISTTimestamp()]
      );
    }

    await client.query('COMMIT');
    console.log(`Assigned ${validAssignments.length} courses successfully`);
    res.json({
      message: `${validAssignments.length} courses assigned successfully`,
      skipped: errors
    });
  } catch (error) {
    if (client) {
      await client.query('ROLLBACK');
    }
    console.error('Error in /api/student/student-courses/bulk:', error.stack);
    res.status(500).json({ error: `Failed to assign courses: ${error.message}`, details: errors });
  } finally {
    if (client) {
      client.release();
    }
  }
});

// Unassign a course from a student
router.delete('/student-courses/unassign', async (req, res) => {
  console.log('Received DELETE /api/student/student-courses/unassign at', new Date().toISOString(), 'with body:', req.body);
  const { studentId, courseId, userType, userId } = req.body;
  if (!studentId || !courseId || !userType || !userId) {
    console.log('Missing required fields:', { studentId, courseId, userType, userId });
    return res.status(400).json({ error: 'Student ID, Course ID, User Type, and User ID are required' });
  }

  let client;
  try {
    client = await pgPool.connect();
    await client.query('BEGIN');

    const deleteResult = await client.query(
      `DELETE FROM student_courses WHERE studentid = $1 AND courseid = $2`,
      [studentId, courseId]
    );
    if (deleteResult.rowCount === 0) {
      console.log(`No course assignment found for studentId: ${studentId}, courseId: ${courseId}`);
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Course assignment not found' });
    }

    await client.query(
      `INSERT INTO student_history (studentid, action, usertype, userid, timestamp) VALUES ($1, $2, $3, $4, $5)`,
      [studentId, `unassigned_course_${courseId}`, userType, userId, getISTTimestamp()]
    );

    await client.query('COMMIT');
    console.log('Course unassigned successfully');
    res.json({ message: 'Course unassigned from student' });
  } catch (err) {
    if (client) {
      await client.query('ROLLBACK');
    }
    console.error('Database error unassigning course from student:', err.stack);
    return res.status(500).json({ error: `Failed to unassign course: ${err.message}` });
  } finally {
    if (client) {
      client.release();
    }
  }
});

// Bulk delete students
router.post('/bulk-delete', async (req, res) => {
  console.log('Received POST /api/student/bulk-delete at', new Date().toISOString(), 'with body:', req.body);
  const { studentIds, userType, userId } = req.body;
  if (!studentIds || !Array.isArray(studentIds) || studentIds.length === 0) {
    return res.status(400).json({ error: 'Student IDs array is required and must not be empty' });
  }

  let client;
  try {
    client = await pgPool.connect();
    await client.query('BEGIN');

    for (const studentId of studentIds) {
      await client.query(
        `INSERT INTO student_history (studentid, action, usertype, userid, timestamp) VALUES ($1, $2, $3, $4, $5)`,
        [studentId, 'deleted', userType, userId, getISTTimestamp()]
      );
    }

    await client.query(`DELETE FROM student_results WHERE studentid = ANY($1::integer[])`, [studentIds]);
    await client.query(`DELETE FROM malpractice_logs WHERE studentid = ANY($1::integer[])`, [studentIds]);
    await client.query(`DELETE FROM student_exams WHERE studentid = ANY($1::integer[])`, [studentIds]);
    await client.query(`DELETE FROM student_courses WHERE studentid = ANY($1::integer[])`, [studentIds]);
    await client.query(`DELETE FROM student_history WHERE studentid = ANY($1::integer[])`, [studentIds]);

    const deleteResult = await client.query(
      `DELETE FROM students WHERE id = ANY($1::integer[]) RETURNING id`,
      [studentIds]
    );

    await client.query('COMMIT');
    res.json({ message: `${deleteResult.rowCount} students and associated records deleted successfully` });
  } catch (error) {
    if (client) {
      await client.query('ROLLBACK');
    }
    console.error('Error deleting students:', error.stack);
    res.status(500).json({ error: `Failed to delete students: ${error.message}` });
  } finally {
    if (client) {
      client.release();
    }
  }
});

module.exports = router;