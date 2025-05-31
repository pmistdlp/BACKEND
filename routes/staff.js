const express = require('express');
const router = express.Router();
const pgPool = require('../model');
const transporter = require('../utils/mailer');

// GET all staff with pagination
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    const { rows } = await pgPool.query(
      `SELECT id, name, username, department, ismaster, email, facultyid 
       FROM staff 
       ORDER BY id 
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    res.json(rows);
  } catch (err) {
    console.error('Database error fetching staff:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET staff by ID
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pgPool.query(
      `SELECT id, name, username, department, ismaster, email, facultyid 
       FROM staff 
       WHERE id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Faculty not found' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error('Database error fetching staff:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST new staff
router.post('/', async (req, res) => {
  const { name, username, password, department, isMaster, email, facultyId } = req.body;
  if (!name || !username || !password || !department || !email || !facultyId) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  try {
    await pgPool.query('BEGIN');
    await pgPool.query(
      `INSERT INTO staff (name, username, password, department, ismaster, email, facultyid) 
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [name, username, password, department, isMaster || false, email, facultyId]
    );

    if (isMaster) {
      await pgPool.query(
        `INSERT INTO admins (username, password, isMaster) 
         VALUES ($1, $2, $3) 
         ON CONFLICT (username) DO NOTHING`,
        [username, password, true]
      );
    }

    await pgPool.query('COMMIT');

    try {
      await transporter.sendMail({
        from: 'salmanparies18@gmail.com',
        to: email,
        subject: 'NPTEL-SOFTWARE - Staff Account Created',
        text: `
          Hello ${name},
          Your staff account has been created!
          Username: ${username}
          Password: ${password}
          Faculty ID: ${facultyId}
          Department: ${department}
          ${isMaster ? 'You are a Master Admin.' : ''}
          Regards,
          NPTEL SOFTWARE TEAM
        `
      });
    } catch (emailError) {
      console.error('Error sending email:', emailError.message);
    }

    res.json({ message: 'Staff created' });
  } catch (err) {
    await pgPool.query('ROLLBACK');
    console.error('Database error creating staff:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT update staff
router.put('/:id', async (req, res) => {
  const { name, username, password, department, isMaster, email, facultyId } = req.body;
  if (!name || !username || !department || !email || !facultyId) {
    return res.status(400).json({ error: 'Required fields missing' });
  }

  try {
    await pgPool.query('BEGIN');

    const query = password
      ? `UPDATE staff 
         SET name = $1, username = $2, password = $3, department = $4, ismaster = $5, email = $6, facultyid = $7 
         WHERE id = $8 
         RETURNING ismaster, username, email, name`
      : `UPDATE staff 
         SET name = $1, username = $2, department = $3, ismaster = $4, email = $5, facultyid = $6 
         WHERE id = $7 
         RETURNING ismaster, username, email, name`;

    const params = password
      ? [name, username, password, department, isMaster || false, email, facultyId, req.params.id]
      : [name, username, department, isMaster || false, email, facultyId, req.params.id];

    const { rows } = await pgPool.query(query, params);
    if (rows.length === 0) {
      await pgPool.query('ROLLBACK');
      return res.status(404).json({ error: 'Faculty not found' });
    }

    const updatedStaff = rows[0];

    if (isMaster && !updatedStaff.ismaster) {
      await pgPool.query(
        `INSERT INTO admins (username, password, isMaster) 
         VALUES ($1, $2, $3) 
         ON CONFLICT (username) DO UPDATE 
         SET password = EXCLUDED.password, isMaster = EXCLUDED.isMaster`,
        [username, password || updatedStaff.password, true]
      );
    } else if (!isMaster && updatedStaff.ismaster) {
      await pgPool.query(`DELETE FROM admins WHERE username = $1`, [updatedStaff.username]);
    } else if (isMaster && updatedStaff.ismaster && password) {
      await pgPool.query(
        `UPDATE admins SET password = $1 WHERE username = $2`,
        [password, username]
      );
    }

    await pgPool.query('COMMIT');

    try {
      await transporter.sendMail({
        from: 'salmanparies18@gmail.com',
        to: updatedStaff.email,
        subject: 'NPTEL-SOFTWARE - Staff Account Updated',
        text: `
          Hello ${updatedStaff.name},
          Your staff account has been updated!
          Updated Details:
          Name: ${name}
          Username: ${username}
          Faculty ID: ${facultyId}
          Department: ${department}
          Email: ${email}
          ${isMaster ? 'You are now a Master Admin.' : 'You are no longer a Master Admin.'}
          Regards,
          NPTEL SOFTWARE TEAM
        `
      });
    } catch (emailError) {
      console.error('Error sending update email:', emailError.message);
    }

    res.json({ message: 'Staff updated' });
  } catch (err) {
    await pgPool.query('ROLLBACK');
    console.error('Database error updating staff:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE staff
router.delete('/:id', async (req, res) => {
  try {
    await pgPool.query('BEGIN');

    const { rows } = await pgPool.query(
      `SELECT name, username, email, ismaster 
       FROM staff 
       WHERE id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) {
      await pgPool.query('ROLLBACK');
      return res.status(404).json({ error: 'Faculty not found' });
    }
    const staff = rows[0];

    if (staff.ismaster) {
      await pgPool.query(`DELETE FROM admins WHERE username = $1`, [staff.username]);
    }

    await pgPool.query(`DELETE FROM staff WHERE id = $1`, [req.params.id]);
    await pgPool.query('COMMIT');

    try {
      await transporter.sendMail({
        from: 'salmanparies18@gmail.com',
        to: staff.email,
        subject: 'NPTEL-SOFTWARE - Staff Account Deleted',
        text: `
          Hello ${staff.name},
          Your staff account has been deleted from the NPTEL-SOFTWARE system.
          If this was not intended, please contact the admin.
          Regards,
          NPTEL SOFTWARE TEAM
        `
      });
    } catch (emailError) {
      console.error('Error sending deletion email:', emailError.message);
    }

    res.json({ message: 'Staff deleted' });
  } catch (err) {
    await pgPool.query('ROLLBACK');
    console.error('Database error deleting staff:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;