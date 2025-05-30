const express = require('express');
const router = express.Router();
const pgPool = require('../model');
const { getISTTimestamp } = require('../utils/helpers');

// Fetch all available courses with optional filtering
router.get('/courses', async (req, res) => {
  console.log('[Backend] Fetching all courses for enrollments...');
  const { isDraft, isRegistrationOpen } = req.query;

  // Build the query dynamically based on provided filters
  let query = `SELECT id, name, course_code, learning_platform, examDate, examTime 
               FROM courses`;
  const params = [];
  const conditions = [];

  if (isDraft !== undefined) {
    conditions.push(`isdraft = $${params.length + 1}`);
    params.push(isDraft === '1');
  }
  if (isRegistrationOpen !== undefined) {
    conditions.push(`isregistrationopen = $${params.length + 1}`);
    params.push(isRegistrationOpen === '1');
  }
  if (conditions.length > 0) {
    query += ` WHERE ${conditions.join(' AND ')}`;
  }

  console.log('[Backend] Executing query:', query, 'with params:', params);
  try {
    const { rows } = await pgPool.query(query, params);
    console.log('[Backend] Courses fetched:', rows);
    res.json(rows || []);
  } catch (err) {
    console.error('[Backend] Database error fetching courses:', err.stack);
    return res.status(500).json({ error: `Internal server error: ${err.message}` });
  }
});

// Fetch students enrolled in a specific course
router.get('/students/:courseId', async (req, res) => {
  const courseId = req.params.courseId;
  console.log('[Backend] Fetching students for courseId:', courseId);
  console.log('[Backend] Request query:', req.query);
  try {
    const { rows } = await pgPool.query(
      `SELECT s.id, s.name, s.registerNo, s.dob, s.aadharNumber, s.abcId, sc.iseligible, sc.paymentconfirmed
       FROM student_courses sc
       JOIN students s ON sc.studentId = s.id
       WHERE sc.courseId = $1`,
      [courseId]
    );
    console.log('[Backend] Students fetched:', rows);
    res.json(rows || []);
  } catch (err) {
    console.error('[Backend] Database error fetching students for course:', err.stack);
    return res.status(500).json({ error: `Internal server error: ${err.message}` });
  }
});

// Update isEligible and paymentConfirmed statuses for multiple students
router.post('/update-status', async (req, res) => {
  const { courseId, updates, userType, userId } = req.body;
  console.log('[Backend] Updating status for courseId:', courseId);
  console.log('[Backend] Updates payload:', updates);
  console.log('[Backend] User info:', { userType, userId });
  if (!courseId || !updates || !Array.isArray(updates) || updates.length === 0) {
    console.log('[Backend] Validation failed: Course ID and updates array are required');
    return res.status(400).json({ error: 'Course ID and updates array are required' });
  }

  let client;
  try {
    client = await pgPool.connect();
    await client.query('BEGIN');

    for (const update of updates) {
      const { studentId, isEligible, paymentConfirmed } = update;
      console.log('[Backend] Updating studentId:', studentId, 'with isEligible:', isEligible, 'paymentConfirmed:', paymentConfirmed);

      const updateResult = await client.query(
        `UPDATE student_courses 
         SET iseligible = $1, paymentconfirmed = $2 
         WHERE studentId = $3 AND courseId = $4`,
        [isEligible, paymentConfirmed, studentId, courseId]
      );

      if (updateResult.rowCount === 0) {
        console.warn(`[Backend] No enrollment found for student ${studentId} in course ${courseId}`);
      }

      // Log the status update in student_history
      const timestamp = getISTTimestamp();
      console.log('[Backend] Logging history for studentId:', studentId, 'at timestamp:', timestamp);
      await client.query(
        `INSERT INTO student_history (studentId, action, userType, userId, timestamp) 
         VALUES ($1, $2, $3, $4, $5)`,
        [studentId, `updated_status_course_${courseId}`, userType, userId, timestamp]
      );
    }

    await client.query('COMMIT');
    console.log('[Backend] Transaction committed successfully');
    res.json({ message: 'Statuses updated successfully' });
  } catch (error) {
    if (client) {
      await client.query('ROLLBACK');
      console.log('[Backend] Transaction rolled back due to errors');
    }
    console.error('[Backend] Error updating statuses:', error.stack);
    res.status(500).json({ error: 'Failed to update statuses' });
  } finally {
    if (client) {
      client.release();
    }
  }
});

// Generate hall ticket data for selected students
router.post('/hall-ticket', async (req, res) => {
  const { courseId, studentIds } = req.body;
  console.log('[Backend] Generating hall ticket for courseId:', courseId, 'studentIds:', studentIds);
  console.log('[Backend] Full request body:', req.body);
  if (!courseId || !studentIds || !Array.isArray(studentIds) || studentIds.length === 0) {
    console.log('[Backend] Validation failed: Course ID and student IDs array are required');
    return res.status(400).json({ error: 'Course ID and student IDs array are required' });
  }

  try {
    // Fetch course details
    console.log('[Backend] Fetching course details for courseId:', courseId);
    const courseResult = await pgPool.query(
      `SELECT id, name, course_code, learning_platform, examDate, examTime 
       FROM courses 
       WHERE id = $1`,
      [courseId]
    );
    if (courseResult.rows.length === 0) {
      console.log('[Backend] Course not found for courseId:', courseId);
      return res.status(404).json({ error: 'Course not found' });
    }
    const course = courseResult.rows[0];
    console.log('[Backend] Course details fetched:', course);

    // Fetch student details
    console.log('[Backend] Fetching student details for studentIds:', studentIds);
    const query = `SELECT s.id, s.name, s.registerNo, s.dob, s.aadharNumber, s.abcId, s.photo, sc.iseligible, sc.paymentconfirmed
                   FROM students s
                   JOIN student_courses sc ON s.id = sc.studentId
                   WHERE sc.courseId = $1 AND s.id = ANY($2::integer[])`;
    console.log('[Backend] Executing student query:', query, 'with params:', [courseId, studentIds]);
    const studentResult = await pgPool.query(query, [courseId, studentIds]);
    const students = studentResult.rows;
    console.log('[Backend] Students fetched for hall ticket:', students);

    const hallTickets = students.map(student => ({
      student: {
        id: student.id,
        name: student.name,
        registerNo: student.registerNo,
        dob: student.dob,
        aadharNumber: student.aadharNumber || 'N/A',
        abcId: student.abcId || 'N/A',
        photo: student.photo || null,
        isEligible: student.iseligible,
        paymentConfirmed: student.paymentconfirmed
      },
      course: {
        id: course.id,
        name: course.name,
        courseCode: course.course_code || 'N/A',
        learningPlatform: course.learning_platform,
        examDate: course.examDate,
        examTime: course.examTime
      }
    }));
    console.log('[Backend] Generated hall tickets:', hallTickets);
    console.log('[Backend] Sending hall ticket response to frontend');
    res.json({ hallTickets });
  } catch (err) {
    console.error('[Backend] Database error generating hall ticket:', err.stack);
    return res.status(500).json({ error: `Internal server error: ${err.message}` });
  }
});

module.exports = router;