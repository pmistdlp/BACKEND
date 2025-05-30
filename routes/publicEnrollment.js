const express = require('express');
const router = express.Router();
const pgPool = require('../model');
const multer = require('multer');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'Uploads/'),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
const upload = multer({ storage });

// GET /api/public-enrollment - Fetch all public courses
router.get('/', async (req, res) => {
  console.log('Received GET request for /api/public-enrollment');
  try {
    const { rows } = await pgPool.query(
      `SELECT id, name, description, examdate, examtime, isdraft, isregistrationopen 
       FROM courses 
       WHERE isdraft = FALSE AND isregistrationopen = TRUE`
    );
    console.log('Fetched courses:', rows);
    res.json(rows);
  } catch (err) {
    console.error('Database error fetching courses:', err.message);
    return res.status(500).json({ error: `Internal server error: ${err.message}` });
  }
});

// GET /api/public-enrollment/:id - Fetch a specific public course
router.get('/:id', async (req, res) => {
  console.log('Received GET request for /api/public-enrollment/:id', req.params.id);
  try {
    const { rows } = await pgPool.query(
      `SELECT id, name, description, examdate, examtime, isdraft, isregistrationopen 
       FROM courses 
       WHERE id = $1 AND isdraft = FALSE AND isregistrationopen = TRUE`,
      [req.params.id]
    );
    if (rows.length === 0) {
      console.log('Course not found for id:', req.params.id);
      return res.status(404).json({ error: 'Course not found, not public, or registration closed' });
    }
    console.log('Fetched course:', rows[0]);
    res.json(rows[0]);
  } catch (err) {
    console.error('Database error fetching course:', err.message);
    return res.status(500).json({ error: `Internal server error: ${err.message}` });
  }
});

// POST /api/public-enrollment - Enroll student in a course
router.post('/', async (req, res) => {
  const { studentId, courseId } = req.body;

  console.log('Received POST request for /api/public-enrollment', req.body);
  if (!studentId || !courseId) {
    return res.status(400).json({ error: 'Student ID and Course ID are required' });
  }

  try {
    const courseResult = await pgPool.query(
      `SELECT * FROM courses WHERE id = $1 AND isdraft = FALSE AND isregistrationopen = TRUE`,
      [courseId]
    );
    if (courseResult.rows.length === 0) {
      console.log('Course not found or registration not open for id:', courseId);
      return res.status(404).json({ error: 'Course not found or registration is not open' });
    }
    const course = courseResult.rows[0];

    const enrollmentResult = await pgPool.query(
      `SELECT * FROM student_courses WHERE studentid = $1 AND courseid = $2`,
      [studentId, courseId]
    );
    if (enrollmentResult.rows.length > 0) {
      return res.status(400).json({ error: 'Student is already enrolled in this course' });
    }

    await pgPool.query(
      `INSERT INTO student_courses (studentid, courseid, startdate, starttime) VALUES ($1, $2, $3, $4)`,
      [studentId, courseId, course.examdate, course.examtime]
    );
    console.log(`Student ${studentId} enrolled in course ${courseId}`);
    res.json({ message: 'Successfully enrolled in the course', studentId });
  } catch (err) {
    console.error('Database error enrolling student:', err.message);
    return res.status(400).json({ error: `Failed to enroll: ${err.message}` });
  }
});

// GET /api/public-enrollment/student-courses/:studentId - Fetch enrolled courses with student details
router.get('/student-courses/:studentId', async (req, res) => {
  console.log('Received GET request for /api/public-enrollment/student-courses/:studentId', req.params.studentId);
  try {
    const { rows } = await pgPool.query(
      `SELECT c.id, c.name, c.description, c.examdate, c.examtime, 
             s.name AS studentname, s.registerNo as studentregisterNo, s.aadharNumber, s.abcId
      FROM student_courses sc
      JOIN courses c ON sc.courseid = c.id
      JOIN students s ON sc.studentid = s.id
      WHERE sc.studentid = $1`,
      [req.params.studentId]
    );
    if (rows.length === 0) {
      console.log('No registered student found for studentId:', req.params.studentId);
      return res.status(404).json({ error: 'No registered courses found for this student' });
    }
    console.log('Courses fetched:', rows);
    res.json(rows);
  } catch (err) {
    console.error('Database error fetching enrolled courses:', err.message);
    return res.status(500).json({ error: `Internal server error: ${err.message}` });
  }
});

// GET /api/public-enrollment/profile/:registerNo - Fetch student profile
router.get('/profile/:registerNo', async (req, res) => {
  const { registerNo } = req.params;
  console.log('Received GET request for /api/public-enrollment/profile/', registerNo);
  try {
    const { rows } = await pgPool.query(
      `SELECT id, name, registerNo, dob, aadharNumber, abcId, photo, esignature 
       FROM students 
       WHERE registerNo = $1`,
      [registerNo]
    );
    if (rows.length === 0) {
      console.log('Student not found for registerNo:', registerNo);
      return res.status(404).json({ error: 'Student not found' });
    }
    console.log('Fetched student:', rows[0]);
    res.json(rows[0]);
  } catch (err) {
    console.error('Database error fetching student:', err.message);
    return res.status(500).json({ error: `Internal server error: ${err.message}` });
  }
});

// POST /api/public-enrollment/student - Create a new student
router.post('/student', async (req, res) => {
  const { name, registerNo, dob, password, source } = req.body;
  console.log('Received POST request for /api/public-enrollment/student', req.body);

  if (!registerNo || !dob || !source) {
    return res.status(400).json({ error: 'Register Number, DOB, and Source are required' });
  }

  try {
    const existingStudent = await pgPool.query(
      `SELECT id FROM students WHERE registerNo = $1`,
      [registerNo]
    );
    if (existingStudent.rows.length > 0) {
      return res.status(400).json({ error: 'Student with this Register Number already exists' });
    }

    const { rows } = await pgPool.query(
      `INSERT INTO students (name, registerNo, dob, password, source) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [name || `Student_${registerNo}`, registerNo, dob, password || dob, source]
    );
    console.log(`Student created with ID: ${rows[0].id}`);
    res.json({ message: 'Student created successfully', studentId: rows[0].id });
  } catch (err) {
    console.error('Database error creating student:', err.message);
    return res.status(500).json({ error: `Internal server error: ${err.message}` });
  }
});

// PUT /api/public-enrollment/profile/:registerNo - Update student profile
router.put('/profile/:registerNo', upload.fields([{ name: 'photo' }, { name: 'eSignature' }]), async (req, res) => {
  const { registerNo } = req.params;
  const { name, dob, aadharNumber, abcId } = req.body;
  const photo = req.files?.photo ? req.files.photo[0].path : null;
  const eSignature = req.files?.eSignature ? req.files.eSignature[0].path : null;

  console.log('Received PUT request for /api/public-enrollment/profile/', registerNo, req.body, 'Files:', req.files);

  // Make aadharNumber and abcId mandatory
  if (!name || !aadharNumber || !abcId) {
    return res.status(400).json({ error: 'Name, Aadhar Number, and ABC ID are required' });
  }

  // Validate formats
  if (!/^\d{12}$/.test(aadharNumber)) {
    return res.status(400).json({ error: 'Aadhar Number must be 12 numeric digits' });
  }
  if (!/^[a-zA-Z0-9]{12}$/.test(abcId)) {
    return res.status(400).json({ error: 'ABC ID must be 12 alphanumeric characters' });
  }

  try {
    const studentResult = await pgPool.query(
      `SELECT id FROM students WHERE registerNo = $1`,
      [registerNo]
    );
    if (studentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const updates = ['name = $1', 'aadharNumber = $2', 'abcId = $3'];
    const params = [name, aadharNumber, abcId];
    let paramIndex = 4;

    if (dob) {
      updates.push(`dob = $${paramIndex++}`);
      params.push(dob);
    }
    if (photo) {
      updates.push(`photo = $${paramIndex++}`);
      params.push(photo);
    }
    if (eSignature) {
      updates.push(`esignature = $${paramIndex++}`);
      params.push(eSignature);
    }

    params.push(registerNo);
    const sql = `UPDATE students SET ${updates.join(', ')} WHERE registerNo = $${paramIndex}`;

    const updateResult = await pgPool.query(sql, params);
    if (updateResult.rowCount === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }
    console.log(`Student ${registerNo} updated successfully`);
    res.json({ message: 'Profile updated successfully', studentId: studentResult.rows[0].id });
  } catch (err) {
    console.error('Database error updating student:', err.message);
    return res.status(500).json({ error: `Database error: ${err.message}` });
  }
});

module.exports = router;