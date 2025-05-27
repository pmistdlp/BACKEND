const express = require('express');
const router = express.Router();
const db = require('../model');
const transporter = require('../utils/mailer');

router.get('/', (req, res) => {
  db.all(`SELECT id, name, username, department, isMaster, email, facultyId FROM staff`, [], (err, rows) => {
    if (err) return res.status(400).json({ error: err.message });
    res.json(rows);
  });
});

router.get('/:id', (req, res) => {
  db.get(`SELECT id, name, username, password, department, isMaster, email, facultyId FROM staff WHERE id = ?`, [req.params.id], (err, row) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Faculty not found' });
    res.json(row);
  });
});

router.post('/', async (req, res) => {
  const { name, username, password, department, isMaster, email, facultyId } = req.body;
  if (!name || !username || !password || !department || !email || !facultyId) {
    return res.status(400).json({ error: 'Name, Username, Password, Department, Email, and Faculty ID are required' });
  }
  db.run(
    `INSERT INTO staff (name, username, password, department, isMaster, email, facultyId) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [name, username, password, department, isMaster || 0, email, facultyId],
    async (err) => {
      if (err) return res.status(400).json({ error: err.message });

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
            Regards,
            NPTEL SOFTWARE TEAM
          `
        });
      } catch (emailError) {
        console.error('Error sending email:', emailError);
      }

      res.json({ message: 'Staff created' });
    }
  );
});

router.put('/:id', (req, res) => {
  const { name, username, password, department, isMaster, email, facultyId } = req.body;
  if (!name || !username || !department || !email || !facultyId) {
    return res.status(400).json({ error: 'Name, Username, Department, Email, and Faculty ID are required' });
  }

  // Fetch the current staff details before updating
  db.get(`SELECT name, email FROM staff WHERE id = ?`, [req.params.id], (err, row) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Faculty not found' });

    const query = password 
      ? `UPDATE staff SET name = ?, username = ?, password = ?, department = ?, isMaster = ?, email = ?, facultyId = ? WHERE id = ?`
      : `UPDATE staff SET name = ?, username = ?, department = ?, isMaster = ?, email = ?, facultyId = ? WHERE id = ?`;
    const params = password 
      ? [name, username, password, department, isMaster || 0, email, facultyId, req.params.id]
      : [name, username, department, isMaster || 0, email, facultyId, req.params.id];

    db.run(query, params, async (err) => {
      if (err) return res.status(400).json({ error: err.message });

      try {
        await transporter.sendMail({
          from: 'salmanparies18@gmail.com',
          to: row.email, // Use the original email before the update
          subject: 'NPTEL-SOFTWARE - Staff Account Updated',
          text: `
            Hello ${row.name},
            Your staff account has been updated!
            Updated Details:
            Name: ${name}
            Username: ${username}
            Faculty ID: ${facultyId}
            Department: ${department}
            Email: ${email}
            Regards,
            NPTEL SOFTWARE TEAM
          `
        });
      } catch (emailError) {
        console.error('Error sending update email:', emailError);
      }

      res.json({ message: 'Staff updated' });
    });
  });
});

router.delete('/:id', (req, res) => {
  // Fetch the staff details before deletion
  db.get(`SELECT name, email FROM staff WHERE id = ?`, [req.params.id], (err, row) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Faculty not found' });

    db.run(`DELETE FROM staff WHERE id = ?`, [req.params.id], async (err) => {
      if (err) return res.status(400).json({ error: err.message });

      try {
        await transporter.sendMail({
          from: 'salmanparies18@gmail.com',
          to: row.email,
          subject: 'NPTEL-SOFTWARE - Staff Account Deleted',
          text: `
            Hello ${row.name},
            Your staff account has been deleted from the NPTEL-SOFTWARE system.
            If this was not intended, please contact the admin.
            Regards,
            NPTEL SOFTWARE TEAM
          `
        });
      } catch (emailError) {
        console.error('Error sending deletion email:', emailError);
      }

      res.json({ message: 'Staff deleted' });
    });
  });
});

module.exports = router;