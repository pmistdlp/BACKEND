const express = require('express');
const router = express.Router();
const pgPool = require('../model');
const transporter = require('../utils/mailer');

router.get('/', async (req, res) => {
  try {
    const { rows } = await pgPool.query(`SELECT id, name, username, department, ismaster, email, facultyid FROM staff`);
    res.json(rows);
  } catch (err) {
    console.error('Database error fetching staff:', err.message);
    return res.status(400).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pgPool.query(
      `SELECT id, name, username, password, department, ismaster, email, facultyid FROM staff WHERE id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Faculty not found' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error('Database error fetching staff:', err.message);
    return res.status(400).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const { name, username, password, department, isMaster, email, facultyId } = req.body;
  if (!name || !username || !password || !department || !email || !facultyId) {
    return res.status(400).json({ error: 'Name, Username, Password, Department, Email, and Faculty ID are required' });
  }

  let client;
  try {
    client = await pgPool.connect();
    await client.query('BEGIN');

    // Insert into staff table
    await client.query(
      `INSERT INTO staff (name, username, password, department, ismaster, email, facultyid) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [name, username, password, department, isMaster || false, email, facultyId]
    );

    // If isMaster is true, insert into admins table
    if (isMaster) {
      await client.query(
        `INSERT INTO admins (username, password, isMaster) VALUES ($1, $2, $3) ON CONFLICT (username) DO NOTHING`,
        [username, password, true]
      );
    }

    await client.query('COMMIT');

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
    if (client) {
      await client.query('ROLLBACK');
    }
    console.error('Database error creating staff:', err.message);
    return res.status(400).json({ error: err.message });
  } finally {
    if (client) {
      client.release();
    }
  }
});

router.put('/:id', async (req, res) => {
  const { name, username, password, department, isMaster, email, facultyId } = req.body;
  if (!name || !username || !department || !email || !facultyId) {
    return res.status(400).json({ error: 'Name, Username, Department, Email, and Faculty ID are required' });
  }

  let client;
  try {
    client = await pgPool.connect();
    await client.query('BEGIN');

    // Fetch current staff details
    const staffResult = await client.query(
      `SELECT name, username, email, ismaster FROM staff WHERE id = $1`,
      [req.params.id]
    );
    if (staffResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Faculty not found' });
    }
    const currentStaff = staffResult.rows[0];

    // Update staff
    const query = password
      ? `UPDATE staff SET name = $1, username = $2, password = $3, department = $4, ismaster = $5, email = $6, facultyid = $7 WHERE id = $8`
      : `UPDATE staff SET name = $1, username = $2, department = $3, ismaster = $4, email = $5, facultyid = $6 WHERE id = $7`;
    const params = password
      ? [name, username, password, department, isMaster || false, email, facultyId, req.params.id]
      : [name, username, department, isMaster || false, email, facultyId, req.params.id];

    const updateResult = await client.query(query, params);
    if (updateResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Faculty not found' });
    }

    // Handle admins table based on isMaster change
    if (isMaster && !currentStaff.ismaster) {
      // Add to admins if newly set as master
      await client.query(
        `INSERT INTO admins (username, password, isMaster) VALUES ($1, $2, $3) ON CONFLICT (username) DO UPDATE SET password = EXCLUDED.password, isMaster = EXCLUDED.isMaster`,
        [username, password || currentStaff.password, true]
      );
    } else if (!isMaster && currentStaff.ismaster) {
      // Remove from admins if master status is revoked
      await client.query(`DELETE FROM admins WHERE username = $1`, [currentStaff.username]);
    } else if (isMaster && currentStaff.ismaster && password) {
      // Update password in admins if master and password changed
      await client.query(
        `UPDATE admins SET password = $1 WHERE username = $2`,
        [password, username]
      );
    }

    await client.query('COMMIT');

    try {
      await transporter.sendMail({
        from: 'salmanparies18@gmail.com',
        to: currentStaff.email,
        subject: 'NPTEL-SOFTWARE - Staff Account Updated',
        text: `
          Hello ${currentStaff.name},
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
    if (client) {
      await client.query('ROLLBACK');
    }
    console.error('Database error updating staff:', err.message);
    return res.status(400).json({ error: err.message });
  } finally {
    if (client) {
      client.release();
    }
  }
});

router.delete('/:id', async (req, res) => {
  let client;
  try {
    client = await pgPool.connect();
    await client.query('BEGIN');

    // Fetch staff details before deletion
    const staffResult = await client.query(
      `SELECT name, username, email, ismaster FROM staff WHERE id = $1`,
      [req.params.id]
    );
    if (staffResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Faculty not found' });
    }
    const staff = staffResult.rows[0];

    // Delete from admins if ismaster
    if (staff.ismaster) {
      await client.query(`DELETE FROM admins WHERE username = $1`, [staff.username]);
    }

    // Delete from staff
    const deleteResult = await client.query(
      `DELETE FROM staff WHERE id = $1`,
      [req.params.id]
    );
    if (deleteResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Faculty not found' });
    }

    await client.query('COMMIT');

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
    if (client) {
      await client.query('ROLLBACK');
    }
    console.error('Database error deleting staff:', err.message);
    return res.status(400).json({ error: err.message });
  } finally {
    if (client) {
      client.release();
    }
  }
});

module.exports = router;