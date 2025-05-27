const express = require('express');
const router = express.Router();
const db = require('../model');
const multer = require('multer');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
const upload = multer({ storage });

// GET /api/public-enrollment - Fetch all public courses
router.get('/', (req, res) => {
  console.log('Received GET request for /api/public-enrollment');
  db.all(
    `SELECT id, name, description, examDate, examTime, isDraft, isRegistrationOpen 
     FROM courses 
     WHERE isDraft = 0 AND isRegistrationOpen = 1`,
    [],
    (err, rows) => {
      if (err) {
        console.error('Database error fetching courses:', err.message);
        return res.status(500).json({ error: `Internal server error: ${err.message}` });
      }
      console.log('Fetched courses:', rows);
      res.json(rows);
    }
  );
});

// GET /api/public-enrollment/:id - Fetch a specific public course
router.get('/:id', (req, res) => {
  console.log('Received GET request for /api/public-enrollment/:id', req.params.id);
  db.get(
    `SELECT id, name, description, examDate, examTime, isDraft, isRegistrationOpen 
     FROM courses 
     WHERE id = ? AND isDraft = 0 AND isRegistrationOpen = 1`,
    [req.params.id],
    (err, row) => {
      if (err) {
        console.error('Database error fetching course:', err.message);
        return res.status(500).json({ error: `Internal server error: ${err.message}` });
      }
      if (!row) {
        console.log('Course not found for id:', req.params.id);
        return res.status(404).json({ error: 'Course not found, not public, or registration closed' });
      }
      console.log('Fetched course:', row);
      res.json(row);
    }
  );
});

// POST /api/public-enrollment - Enroll student in a course
router.post('/', (req, res) => {
  const { studentId, courseId } = req.body;

  console.log('Received POST request for /api/public-enrollment', req.body);
  if (!studentId || !courseId) {
    return res.status(400).json({ error: 'Student ID and Course ID are required' });
  }

  db.get(
    `SELECT * FROM courses WHERE id = ? AND isDraft = 0 AND isRegistrationOpen = 1`,
    [courseId],
    (err, course) => {
      if (err) {
        console.error('Database error fetching course:', err.message);
        return res.status(500).json({ error: `Internal server error: ${err.message}` });
      }
      if (!course) {
        console.log('Course not found or registration not open for id:', courseId);
        return res.status(404).json({ error: 'Course not found or registration is not open' });
      }

      db.get(
        `SELECT * FROM student_courses WHERE studentId = ? AND courseId = ?`,
        [studentId, courseId],
        (err, enrollment) => {
          if (err) {
            console.error('Database error checking enrollment:', err.message);
            return res.status(500).json({ error: `Internal server error: ${err.message}` });
          }
          if (enrollment) {
            return res.status(400).json({ error: 'Student is already enrolled in this course' });
          }

          db.run(
            `INSERT INTO student_courses (studentId, courseId, startDate, startTime) VALUES (?, ?, ?, ?)`,
            [studentId, courseId, course.examDate, course.examTime],
            (err) => {
              if (err) {
                console.error('Database error enrolling student:', err.message);
                return res.status(400).json({ error: `Failed to enroll: ${err.message}` });
              }
              console.log(`Student ${studentId} enrolled in course ${courseId}`);
              res.json({ message: 'Successfully enrolled in the course', studentId: studentId });
            }
          );
        }
      );
    }
  );
});

// GET /api/public-enrollment/student-courses/:studentId - Fetch enrolled courses with student details
router.get('/student-courses/:studentId', (req, res) => {
  console.log('Received GET request for /api/public-enrollment/student-courses/:studentId', req.params.studentId);
  db.all(
    `SELECT c.id, c.name, c.description, c.examDate, c.examTime, 
            s.name AS studentName, s.registerNo AS studentRegisterNo, s.aadharNumber, s.abcId
     FROM student_courses sc
     JOIN courses c ON sc.courseId = c.id
     JOIN students s ON sc.studentId = s.id
     WHERE sc.studentId = ?`,
    [req.params.studentId],
    (err, rows) => {
      if (err) {
        console.error('Database error fetching enrolled courses:', err.message);
        return res.status(500).json({ error: `Internal server error: ${err.message}` });
      }
      if (rows.length === 0) {
        console.log('No enrolled courses found for studentId:', req.params.studentId);
        return res.status(404).json({ error: 'No enrolled courses found for this student' });
      }
      console.log('Fetched enrolled courses:', rows);
      res.json(rows);
    }
  );
});

// GET /api/public-enrollment/profile/:registerNo - Fetch student profile
router.get('/profile/:registerNo', (req, res) => {
  const { registerNo } = req.params;
  console.log('Received GET request for /api/public-enrollment/profile/', registerNo);
  db.get(
    `SELECT id, name, registerNo, dob, aadharNumber, abcId, photo, eSignature 
     FROM students 
     WHERE registerNo = ?`,
    [registerNo],
    (err, row) => {
      if (err) {
        console.error('Database error fetching student:', err.message);
        return res.status(500).json({ error: `Internal server error: ${err.message}` });
      }
      if (!row) {
        console.log('Student not found for registerNo:', registerNo);
        return res.status(404).json({ error: 'Student not found' });
      }
      console.log('Fetched student:', row);
      res.json(row);
    }
  );
});

// POST /api/public-enrollment/student - Create a new student
router.post('/student', (req, res) => {
  const { name, registerNo, dob, password, source } = req.body;
  console.log('Received POST request for /api/public-enrollment/student', req.body);

  if (!registerNo || !dob || !source) {
    return res.status(400).json({ error: 'Register Number, DOB, and Source are required' });
  }

  db.get(`SELECT id FROM students WHERE registerNo = ?`, [registerNo], (err, row) => {
    if (err) {
      console.error('Database error checking student:', err.message);
      return res.status(500).json({ error: `Internal server error: ${err.message}` });
    }
    if (row) {
      return res.status(400).json({ error: 'Student with this Register Number already exists' });
    }

    db.run(
      `INSERT INTO students (name, registerNo, dob, password, source) VALUES (?, ?, ?, ?, ?)`,
      [name || `Student_${registerNo}`, registerNo, dob, password || dob, source],
      function (err) {
        if (err) {
          console.error('Database error creating student:', err.message);
          return res.status(500).json({ error: `Internal server error: ${err.message}` });
        }
        console.log(`Student created with ID: ${this.lastID}`);
        res.json({ message: 'Student created successfully', studentId: this.lastID });
      }
    );
  });
});

// PUT /api/public-enrollment/profile/:registerNo - Update student profile
router.put('/profile/:registerNo', upload.fields([{ name: 'photo' }, { name: 'eSignature' }]), (req, res) => {
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

  db.get(`SELECT id FROM students WHERE registerNo = ?`, [registerNo], (err, row) => {
    if (err) {
      console.error('Database error fetching student:', err.message);
      return res.status(500).json({ error: `Internal server error: ${err.message}` });
    }
    if (!row) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const updates = ['name = ?', 'aadharNumber = ?', 'abcId = ?'];
    const params = [name, aadharNumber, abcId];
    if (dob) {
      updates.push('dob = ?');
      params.push(dob);
    }
    if (photo) {
      updates.push('photo = ?');
      params.push(photo);
    }
    if (eSignature) {
      updates.push('eSignature = ?');
      params.push(eSignature);
    }

    params.push(registerNo);
    const sql = `UPDATE students SET ${updates.join(', ')} WHERE registerNo = ?`;

    db.run(sql, params, (err) => {
      if (err) {
        console.error('Database error updating student:', err.message);
        return res.status(500).json({ error: `Database error: ${err.message}` });
      }
      console.log(`Student ${registerNo} updated successfully`);
      res.json({ message: 'Profile updated successfully', studentId: row.id });
    });
  });
});

module.exports = router;