const express = require('express');
const router = express.Router();
const db = require('../model');

router.get('/course', (req, res) => {
  console.log('Fetching course history...');
  db.all(
    `SELECT ch.*, c.name AS courseName, s.name AS staffName, a.username AS adminName 
     FROM course_history ch 
     LEFT JOIN courses c ON ch.courseId = c.id 
     LEFT JOIN staff s ON ch.userType = 'staff' AND ch.userId = s.id 
     LEFT JOIN admins a ON ch.userType = 'admin' AND ch.userId = a.id`,
    [],
    (err, rows) => {
      if (err) {
        console.error('Database error fetching course history:', err.message);
        return res.status(500).json({ error: 'Internal server error while fetching course history', details: err.message });
      }
      if (!rows || rows.length === 0) {
        console.log('No course history data found');
        return res.json([]); // Return empty array if no data
      }
      console.log('Course history fetched:', rows);
      res.json(rows);
    }
  );
});

router.get('/student', (req, res) => {
  console.log('Fetching student history...');
  db.all(
    `SELECT sh.*, st.name AS studentName, a.username AS adminName, s.name AS staffName 
     FROM student_history sh 
     LEFT JOIN students st ON sh.studentId = st.id 
     LEFT JOIN admins a ON sh.userType = 'admin' AND sh.userId = a.id 
     LEFT JOIN staff s ON sh.userType = 'staff' AND sh.userId = s.id`,
    [],
    (err, rows) => {
      if (err) {
        console.error('Database error fetching student history:', err.message);
        return res.status(500).json({ error: 'Internal server error while fetching student history', details: err.message });
      }
      if (!rows || rows.length === 0) {
        console.log('No student history data found');
        return res.json([]); // Return empty array if no data
      }
      console.log('Student history fetched:', rows);
      res.json(rows);
    }
  );
});

module.exports = router;