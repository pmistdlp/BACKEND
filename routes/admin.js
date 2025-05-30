const express = require('express');
const router = express.Router();
const pgPool = require('../model');
const bcrypt = require('bcrypt');

router.get('/test-db', async (req, res) => {
  console.log('Received request to /test-db');
  try {
    const { rows } = await pgPool.query('SELECT * FROM admins WHERE username = $1', ['master']);
    if (rows.length === 0) {
      console.log('No admin found for username: master');
      return res.status(404).json({ error: 'No admin found' });
    }
    console.log('Admin found:', rows[0]);
    res.json(rows[0]);
  } catch (err) {
    console.error('Database error:', err.message);
    return res.status(500).json({ error: 'Database error', details: err.message });
  }
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  console.log('Admin login attempt:', { username, password });

  if (!username || !password) {
    console.log('Missing credentials');
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    const { rows } = await pgPool.query('SELECT * FROM admins WHERE username = $1', [username]);
    if (rows.length === 0) {
      console.log('No admin found for username:', username);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const admin = rows[0];
    console.log('Found admin:', { id: admin.id, username: admin.username, password: admin.password, ismaster: admin.ismaster });

    const isHashed = admin.password && admin.password.startsWith('$2b$');
    let isPasswordValid;

    if (isHashed) {
      console.log('Comparing hashed password...');
      isPasswordValid = await bcrypt.compare(password, admin.password);
    } else {
      console.warn('Using plain text password comparison (insecure)');
      isPasswordValid = password === admin.password;
    }

    if (!isPasswordValid) {
      console.log('Password mismatch for admin:', username);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isMaster = admin.ismaster === undefined ? false : admin.ismaster;
    console.log('Admin login successful:', { id: admin.id, username: admin.username, isMaster });

    res.json({
      id: admin.id,
      username: admin.username,
      isMaster,
      role: 'admin',
    });
  } catch (err) {
    console.error('Unexpected error during admin login:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/staff/login', async (req, res) => {
  const { username, password } = req.body;
  console.log('Staff login attempt:', { username, password });

  if (!username || !password) {
    console.log('Missing credentials');
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    const { rows } = await pgPool.query('SELECT * FROM staff WHERE username = $1 AND password = $2', [username, password]);
    if (rows.length === 0) {
      console.log('No staff found for username:', username);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const staff = rows[0];
    console.log('Staff login successful:', { id: staff.id, username: staff.username });
    res.json({ id: staff.id, username: staff.username, role: 'staff' });
  } catch (err) {
    console.error('Database error during staff login:', err.message);
    return res.status(500).json({ error: `Internal server error: ${err.message}` });
  }
});

router.post('/student/login', async (req, res) => {
  const { registerNo, password } = req.body;
  console.log('Student login attempt:', { registerNo, password });

  if (!registerNo || !password) {
    console.log('Missing credentials');
    return res.status(400).json({ error: 'registerNo and password are required' });
  }

  try {
    const { rows } = await pgPool.query('SELECT * FROM students WHERE registerNo = $1 AND password = $2', [registerNo, password]);
    if (rows.length === 0) {
      console.log('No student found for registerNo:', registerNo);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const student = rows[0];
    console.log('Student login successful:', { id: student.id, registerNo: student.registerNo });
    res.json({ id: student.id, registerNo: student.registerNo, name: student.name, role: 'student' });
  } catch (err) {
    console.error('Database error during student login:', err.message);
    return res.status(500).json({ error: `Internal server error: ${err.message}` });
  }
});

module.exports = router;