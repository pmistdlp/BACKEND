const express = require('express');
const router = express.Router();
const db = require('../model');
const { getISTTimestamp } = require('../utils/helpers');

// Fetch all available courses with optional filtering
router.get('/courses', (req, res) => {
  console.log('[Backend] Fetching all courses for enrollments...');
  const { isDraft, isRegistrationOpen } = req.query;

  // Build the query dynamically based on provided filters
  let query = `SELECT id, name, course_code, learning_platform, examDate, examTime 
               FROM courses`;
  const params = [];
  const conditions = [];

  if (isDraft !== undefined) {
    conditions.push(`isDraft = ?`);
    params.push(isDraft === '1' ? 1 : 0);
  }
  if (isRegistrationOpen !== undefined) {
    conditions.push(`isRegistrationOpen = ?`);
    params.push(isRegistrationOpen === '1' ? 1 : 0);
  }
  if (conditions.length > 0) {
    query += ` WHERE ${conditions.join(' AND ')}`;
  }

  console.log('[Backend] Executing query:', query, 'with params:', params);
  db.all(query, params, (err, rows) => {
    if (err) {
      console.error('[Backend] Database error fetching courses:', err.stack);
      return res.status(500).json({ error: `Internal server error: ${err.message}` });
    }
    console.log('[Backend] Courses fetched:', rows);
    res.json(rows || []);
  });
});

// Fetch students enrolled in a specific course
router.get('/students/:courseId', (req, res) => {
  const courseId = req.params.courseId;
  console.log('[Backend] Fetching students for courseId:', courseId);
  console.log('[Backend] Request query:', req.query);
  db.all(
    `SELECT s.id, s.name, s.registerNo, s.dob, s.aadharNumber, s.abcId, sc.isEligible, sc.paymentConfirmed
     FROM student_courses sc
     JOIN students s ON sc.studentId = s.id
     WHERE sc.courseId = ?`,
    [courseId],
    (err, rows) => {
      if (err) {
        console.error('[Backend] Database error fetching students for course:', err.stack);
        return res.status(500).json({ error: `Internal server error: ${err.message}` });
      }
      console.log('[Backend] Students fetched:', rows);
      res.json(rows || []);
    }
  );
});

// Update isEligible and paymentConfirmed statuses for multiple students
router.post('/update-status', (req, res) => {
  const { courseId, updates, userType, userId } = req.body;
  console.log('[Backend] Updating status for courseId:', courseId);
  console.log('[Backend] Updates payload:', updates);
  console.log('[Backend] User info:', { userType, userId });
  if (!courseId || !updates || !Array.isArray(updates) || updates.length === 0) {
    console.log('[Backend] Validation failed: Course ID and updates array are required');
    return res.status(400).json({ error: 'Course ID and updates array are required' });
  }

  try {
    db.serialize(() => {
      db.run('BEGIN TRANSACTION', (err) => {
        if (err) console.error('[Backend] Error starting transaction:', err.stack);
      });
      const updateStmt = db.prepare(
        `UPDATE student_courses 
         SET isEligible = ?, paymentConfirmed = ? 
         WHERE studentId = ? AND courseId = ?`
      );
      const historyStmt = db.prepare(
        `INSERT INTO student_history (studentId, action, userType, userId, timestamp) 
         VALUES (?, ?, ?, ?, ?)`
      );

      let completedOperations = 0;
      let totalOperations = updates.length;
      let errorOccurred = false;

      updates.forEach(update => {
        const { studentId, isEligible, paymentConfirmed } = update;
        console.log('[Backend] Updating studentId:', studentId, 'with isEligible:', isEligible, 'paymentConfirmed:', paymentConfirmed);
        updateStmt.run([isEligible, paymentConfirmed, studentId, courseId], function (err) {
          if (err) {
            console.error(`[Backend] Error updating status for student ${studentId}:`, err.stack);
            errorOccurred = true;
            completedOperations++;
            if (completedOperations === totalOperations) {
              finalizeStatements();
            }
            return;
          }
          if (this.changes === 0) {
            console.warn(`[Backend] No enrollment found for student ${studentId} in course ${courseId}`);
          }
          // Log the status update in student_history
          const timestamp = getISTTimestamp();
          console.log('[Backend] Logging history for studentId:', studentId, 'at timestamp:', timestamp);
          historyStmt.run(
            [studentId, `updated_status_course_${courseId}`, userType, userId, timestamp],
            (err) => {
              if (err) {
                console.error(`[Backend] Error logging history for student ${studentId}:`, err.stack);
                errorOccurred = true;
              }
              completedOperations++;
              if (completedOperations === totalOperations) {
                finalizeStatements();
              }
            }
          );
        });
      });

      function finalizeStatements() {
        updateStmt.finalize((err) => {
          if (err) console.error('[Backend] Error finalizing update statement:', err.stack);
          historyStmt.finalize((err) => {
            if (err) console.error('[Backend] Error finalizing history statement:', err.stack);
            if (errorOccurred) {
              db.run('ROLLBACK', (err) => {
                if (err) console.error('[Backend] Error rolling back transaction:', err.stack);
                console.log('[Backend] Transaction rolled back due to errors');
                res.status(400).json({ error: 'Failed to update some statuses' });
              });
            } else {
              db.run('COMMIT', (err) => {
                if (err) {
                  console.error('[Backend] Error committing transaction:', err.stack);
                  res.status(400).json({ error: 'Failed to commit transaction' });
                } else {
                  console.log('[Backend] Transaction committed successfully');
                  res.json({ message: 'Statuses updated successfully' });
                }
              });
            }
          });
        });
      }
    });
  } catch (error) {
    db.run('ROLLBACK');
    console.error('[Backend] Error updating statuses:', error.stack);
    res.status(500).json({ error: 'Failed to update statuses' });
  }
});

// Generate hall ticket data for selected students
router.post('/hall-ticket', (req, res) => {
  const { courseId, studentIds } = req.body;
  console.log('[Backend] Generating hall ticket for courseId:', courseId, 'studentIds:', studentIds);
  console.log('[Backend] Full request body:', req.body);
  if (!courseId || !studentIds || !Array.isArray(studentIds) || studentIds.length === 0) {
    console.log('[Backend] Validation failed: Course ID and student IDs array are required');
    return res.status(400).json({ error: 'Course ID and student IDs array are required' });
  }

  // Fetch course details
  console.log('[Backend] Fetching course details for courseId:', courseId);
  db.get(
    `SELECT id, name, course_code, learning_platform, examDate, examTime 
     FROM courses 
     WHERE id = ?`,
    [courseId],
    (err, course) => {
      if (err) {
        console.error('[Backend] Database error fetching course:', err.stack);
        return res.status(500).json({ error: `Internal server error: ${err.message}` });
      }
      if (!course) {
        console.log('[Backend] Course not found for courseId:', courseId);
        return res.status(404).json({ error: 'Course not found' });
      }
      console.log('[Backend] Course details fetched:', course);

      // Fetch student details
      console.log('[Backend] Fetching student details for studentIds:', studentIds);
      const query = `SELECT s.id, s.name, s.registerNo, s.dob, s.aadharNumber, s.abcId, s.photo, sc.isEligible, sc.paymentConfirmed
                     FROM students s
                     JOIN student_courses sc ON s.id = sc.studentId
                     WHERE sc.courseId = ? AND s.id IN (${studentIds.map(() => '?').join(',')})`;
      console.log('[Backend] Executing student query:', query, 'with params:', [courseId, ...studentIds]);
      db.all(query, [courseId, ...studentIds], (err, students) => {
        if (err) {
          console.error('[Backend] Database error fetching students for hall ticket:', err.stack);
          return res.status(500).json({ error: `Internal server error: ${err.message}` });
        }
        console.log('[Backend] Students fetched for hall ticket:', students);

        const hallTickets = students.map(student => ({
          student: {
            id: student.id,
            name: student.name,
            registerNo: student.registerNo,
            dob: student.dob,
            aadharNumber: student.aadharNumber || 'N/A',
            abcId: student.abcId || 'N/A',
            photo: student.photo || null, // Include the photo field
            isEligible: student.isEligible,
            paymentConfirmed: student.paymentConfirmed
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
      });
    }
  );
});

module.exports = router;