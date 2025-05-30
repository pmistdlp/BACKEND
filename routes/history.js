const express = require('express');
const router = express.Router();
const pgPool = require('../model');

router.get('/course', async (req, res) => {
  console.log('Fetching course history...');
  try {
    const { rows } = await pgPool.query(
      `SELECT ch.*, c.name AS coursename, s.name AS staffname, a.username AS adminname 
       FROM course_history ch 
       LEFT JOIN courses c ON ch.courseid = c.id 
       LEFT JOIN staff s ON ch.usertype = 'staff' AND ch.userid = s.id 
       LEFT JOIN admins a ON ch.usertype = 'admin' AND ch.userid = a.id`
    );
    if (!rows || rows.length === 0) {
      console.log('No course history data found');
      return res.json([]); // Return empty array if no data
    }
    console.log('Course history fetched:', rows);
    res.json(rows);
  } catch (err) {
    console.error('Database error fetching course history:', err.message);
    return res.status(500).json({ error: 'Internal server error while fetching course history', details: err.message });
  }
});

router.get('/student', async (req, res) => {
  console.log('Fetching student history...');
  try {
    const { rows } = await pgPool.query(
      `SELECT sh.*, st.name AS studentname, a.username AS adminname, s.name AS staffname 
       FROM student_history sh 
       LEFT JOIN students st ON sh.studentid = st.id 
       LEFT JOIN admins a ON sh.usertype = 'admin' AND sh.userid = a.id 
       LEFT JOIN staff s ON sh.usertype = 'staff' AND sh.userid = s.id`
    );
    if (!rows || rows.length === 0) {
      console.log('No student history data found');
      return res.json([]); // Return empty array if no data
    }
    console.log('Student history fetched:', rows);
    res.json(rows);
  } catch (err) {
    console.error('Database error fetching student history:', err.message);
    return res.status(500).json({ error: 'Internal server error while fetching student history', details: err.message });
  }
});

module.exports = router;