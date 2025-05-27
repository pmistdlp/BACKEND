const express = require('express');
const router = express.Router();
const db = require('../model');
const bcrypt = require('bcrypt');

router.get('/test-db', (req, res) => {
  console.log('Received request to /test-db');
  db.get(`SELECT * FROM admins WHERE username = ?`, ['master'], (err, row) => {
    if (err) {
      console.error('Database error:', err.message);
      return res.status(500).json({ error: 'Database error', details: err.message });
    }
    if (!row) {
      console.log('No admin found for username: master');
      return res.status(404).json({ error: 'No admin found' });
    }
    console.log('Admin found:', row);
    res.json(row);
  });
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  console.log('Admin login attempt:', { username, password });

  if (!username || !password) {
    console.log('Missing credentials');
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    db.get(`SELECT * FROM admins WHERE username = ?`, [username], async (err, row) => {
      if (err) {
        console.error('Database error during admin login:', err.message);
        return res.status(500).json({ error: `Internal server error: ${err.message}` });
      }

      if (!row) {
        console.log('No admin found for username:', username);
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      console.log('Found admin:', { id: row.id, username: row.username, password: row.password, isMaster: row.isMaster });

      const isHashed = row.password && row.password.startsWith('$2b$');
      let isPasswordValid;

      if (isHashed) {
        console.log('Comparing hashed password...');
        isPasswordValid = await bcrypt.compare(password, row.password);
      } else {
        console.warn('Using plain text password comparison (insecure)');
        isPasswordValid = password === row.password;
      }

      if (!isPasswordValid) {
        console.log('Password mismatch for admin:', username);
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const isMaster = row.isMaster === undefined ? 0 : row.isMaster === 1;
      console.log('Admin login successful:', { id: row.id, username: row.username, isMaster });

      res.json({
        id: row.id,
        username: row.username,
        isMaster,
        role: 'admin',
      });
    });
  } catch (err) {
    console.error('Unexpected error during admin login:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/staff/login', (req, res) => {
  const { username, password } = req.body;
  console.log('Staff login attempt:', { username, password });

  if (!username || !password) {
    console.log('Missing credentials');
    return res.status(400).json({ error: 'Username and password are required' });
  }

  db.get(`SELECT * FROM staff WHERE username = ? AND password = ?`, [username, password], (err, row) => {
    if (err) {
      console.error('Database error during staff login:', err.message);
      return res.status(500).json({ error: `Internal server error: ${err.message}` });
    }

    if (!row) {
      console.log('No staff found for username:', username);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    console.log('Staff login successful:', { id: row.id, username: row.username });
    res.json({ id: row.id, username: row.username, role: 'staff' });
  });
});

router.post('/student/login', (req, res) => {
  const { registerNo, password } = req.body;
  console.log('Student login attempt:', { registerNo, password });

  if (!registerNo || !password) {
    console.log('Missing credentials');
    return res.status(400).json({ error: 'registerNo and password are required' });
  }

  db.get(`SELECT * FROM students WHERE registerNo = ? AND password = ?`, [registerNo, password], (err, row) => {
    if (err) {
      console.error('Database error during student login:', err.message);
      return res.status(500).json({ error: `Internal server error: ${err.message}` });
    }

    if (!row) {
      console.log('No student found for registerNo:', registerNo);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    console.log('Student login successful:', { id: row.id, registerNo: row.registerNo });
    res.json({ id: row.id, registerNo: row.registerNo, name: row.name, role: 'student' });
  });
});

module.exports = router;