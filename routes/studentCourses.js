const express = require('express');
const router = express.Router();
const pgPool = require('../model'); // Import pgPool from model.js
const fs = require('fs').promises;
const path = require('path');

// Define the base path for uploads
const UPLOADS_DIR = path.join(__dirname, '..', 'Uploads');

// Middleware to verify session
const verifySession = (req, res, next) => {
  const session = req.session;
  const studentId = req.params.studentId || req.body.studentId;
  console.log(`[${new Date().toISOString()}] [verifySession] SessionID: ${req.sessionID}, Session:`, JSON.stringify(session, null, 2));
  console.log(`[${new Date().toISOString()}] [verifySession] Checking studentId: ${studentId}, User:`, JSON.stringify(session.user || {}));

  if (!session || !session.user || !session.user.id || session.user.id !== parseInt(studentId)) {
    console.log(`[Unauthorized] Invalid session for studentId ${studentId}. Session user:`, session.user);
    return res.status(401).json({ error: 'Unauthorized or invalid session' });
  }
  req.user = session.user;
  console.log(`[${new Date().toISOString()}] Session valid for user:`, session.user);
  next();
};

// GET /api/student-courses/complete-details/:studentId
router.get('/complete-details/:studentId', verifySession, async (req, res) => {
  const { studentId } = req.params;
  const limit = parseInt(req.query.limit) || 10;
  const offset = parseInt(req.query.offset) || 0;

  console.log(`[${new Date().toISOString()}] [GET /api/student-courses/complete-details/${studentId}] limit=${limit} offset=${offset}`);

  try {
    // Validate studentId
    if (!/^\d+$/.test(studentId)) {
      console.log(`Invalid studentId: ${studentId}`);
      return res.status(400).json({ error: 'Invalid student ID' });
    }

    // Step 1: Fetch student details
    console.log(`Fetching student details for studentId ${studentId}`);
    const studentQuery = `
      SELECT id, name, registerNo, abcId, photo
      FROM students
      WHERE id = $1
    `;
    const studentResult = await pgPool.query(studentQuery, [studentId]);

    if (studentResult.rows.length === 0) {
      console.log(`Student ID ${studentId} not found`);
      return res.status(404).json({ error: 'Student not found' });
    }

    const studentData = studentResult.rows[0];
    console.log(`Raw student data fetched:`, studentData);

    // Step 2: Validate photo file
    let photoPath = null;
    if (studentData.photo) {
      const fullPhotoPath = path.join(UPLOADS_DIR, studentData.photo.replace(/^\/Uploads\//, ''));
      try {
        await fs.access(fullPhotoPath);
        photoPath = studentData.photo.startsWith('/Uploads/') 
          ? studentData.photo 
          : `/Uploads/${studentData.photo}`;
        console.log(`Photo found for studentId ${studentId}: ${fullPhotoPath}`);
      } catch (err) {
        console.log(`Photo file not found for studentId ${studentId}: ${fullPhotoPath}`);
        photoPath = null;
      }
    }

    // Step 3: Fetch assigned courses
    console.log(`Fetching assigned courses for studentId ${studentId}`);
    const coursesQuery = `
      SELECT 
        c.id AS courseid,
        c.name AS coursename,
        c.course_code AS coursecode,
        c.learning_platform AS learningplatform,
        c.examDate AS examdate,
        c.examTime AS examtime,
        c.examQuestionCount AS examquestioncount,
        c.examMarks AS exammarks,
        c.coCount AS cocount,
        c.isRegistrationOpen AS isregistrationopen,
        c.isDraft AS isdraft,
        sc.isEligible AS iseligible,
        sc.paymentConfirmed AS paymentconfirmed,
        sc.startDate AS startdate,
        sc.startTime AS starttime,
        (SELECT COUNT(*) > 0 
         FROM student_results sr 
         WHERE sr.studentId = sc.studentId AND sr.courseId = sc.courseId) AS hascompleted,
        (SELECT COUNT(*) > 0 
         FROM malpractice_logs ml 
         WHERE ml.studentId = sc.studentId AND ml.courseId = sc.courseId) AS hasmalpractice,
        (SELECT COUNT(*) > 0 
         FROM student_exams se 
         WHERE se.studentId = sc.studentId AND se.courseId = se.courseId AND se.endTime IS NOT NULL) AS hasexited
      FROM student_courses sc
      JOIN courses c ON sc.courseId = c.id
      WHERE sc.studentId = $1
      ORDER BY c.id
      LIMIT $2 OFFSET $3
    `;
    const coursesResult = await pgPool.query(coursesQuery, [studentId, limit, offset]);

    console.log(`Raw course data fetched (${coursesResult.rows.length} courses):`, coursesResult.rows);

    // Step 4: Format courses response
    const courses = coursesResult.rows.map((course) => ({
      courseid: course.courseid,
      coursename: course.coursename.trim(), // Trim to remove trailing spaces
      coursecode: course.coursecode,
      learningplatform: course.learningplatform,
      examdate: course.examdate,
      examtime: course.examtime,
      examquestioncount: course.examquestioncount,
      exammarks: course.exammarks,
      cocount: course.cocount,
      isregistrationopen: course.isregistrationopen,
      isdraft: course.isdraft,
      iseligible: course.iseligible,
      paymentconfirmed: course.paymentconfirmed,
      startdate: course.startdate,
      starttime: course.starttime,
      hascompleted: course.hascompleted,
      hasmalpractice: course.hasmalpractice,
      hasexited: course.hasexited,
    }));

    // Step 5: Build final response
    const response = {
      student: {
        id: studentData.id,
        name: studentData.name,
        registerNo: studentData.registerNo || 'N/A',
        abcId: studentData.abcId || 'N/A',
        photo: photoPath,
      },
      courses,
    };

    console.log(`Final response for studentId ${studentId}:`, response);
    res.json(response);
  } catch (err) {
    console.error(`Error fetching details for studentId ${studentId}:`, err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/student-courses/hall-ticket
router.post('/hall-ticket', async (req, res) => {
  const { courseId, studentId } = req.body;

  console.log(`[${new Date().toISOString()}] [POST /api/student-courses/hall-ticket] studentId=${studentId}, courseId=${courseId}`);

  try {
    // Validate inputs
    if (!courseId || !/^\d+$/.test(courseId)) {
      console.log(`Invalid courseId: ${courseId}`);
      return res.status(400).json({ error: 'Invalid course ID' });
    }
    if (!studentId || !/^\d+$/.test(studentId)) {
      console.log(`Invalid studentId: ${studentId}`);
      return res.status(400).json({ error: 'Invalid student ID' });
    }

    // Fetch student details
    console.log(`Fetching student details for studentId ${studentId}`);
    const studentQuery = `
      SELECT id, name, registerNo, abcId, photo
      FROM students
      WHERE id = $1
    `;
    const studentResult = await pgPool.query(studentQuery, [studentId]);

    if (studentResult.rows.length === 0) {
      console.log(`Student ID ${studentId} not found`);
      return res.status(404).json({ error: 'Student not found' });
    }

    const studentData = studentResult.rows[0];
    console.log(`Raw student data fetched:`, studentData);

    // Fetch course details
    console.log(`Fetching course details for courseId ${courseId}`);
    const courseQuery = `
      SELECT id, name, course_code AS courseCode, learning_platform, examDate, examTime
      FROM courses
      WHERE id = $1
    `;
    const courseResult = await pgPool.query(courseQuery, [courseId]);

    if (courseResult.rows.length === 0) {
      console.log(`Course ID ${courseId} not found`);
      return res.status(404).json({ error: 'Course not found' });
    }

    const courseData = courseResult.rows[0];
    console.log(`Raw course data fetched:`, courseData);

    // Verify enrollment
    console.log(`Verifying enrollment for studentId ${studentId} in courseId ${courseId}`);
    const enrollmentQuery = `
      SELECT isEligible, paymentConfirmed
      FROM student_courses
      WHERE studentId = $1 AND courseId = $2
    `;
    const enrollmentResult = await pgPool.query(enrollmentQuery, [studentId, courseId]);

    if (enrollmentResult.rows.length === 0) {
      console.log(`No enrollment found for student ${studentId} in course ${courseId}`);
      return res.status(404).json({ error: 'Student not enrolled in this course' });
    }

    const enrollmentData = enrollmentResult.rows[0];
    console.log(`Enrollment data:`, enrollmentData);

    // Format hall ticket data
    const hallTickets = [{
      student: {
        id: studentData.id,
        name: studentData.name || 'N/A',
        registerNo: studentData.registerNo || 'N/A',
        abcId: studentData.abcId || 'N/A',
        photo: studentData.photo || null,
        isEligible: enrollmentData.isEligible,
        paymentConfirmed: enrollmentData.paymentConfirmed,
      },
      course: {
        id: courseData.id,
        name: courseData.name.trim(),
        courseCode: courseData.courseCode || 'N/A',
        learningPlatform: courseData.learning_platform,
        examDate: courseData.examDate,
        examTime: courseData.examTime,
      },
    }];

    console.log(`Hall ticket data prepared for studentId ${studentId}:`, hallTickets);
    res.json({ hallTickets });
  } catch (err) {
    console.error(`Error generating hall ticket for studentId ${studentId}:`, err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;