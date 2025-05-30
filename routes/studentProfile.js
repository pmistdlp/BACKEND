const express = require('express');
const router = express.Router();
const pgPool = require('../model');
const upload = require('../utils/multer');

// GET /api/student-profile/profile/:registerNo
router.get('/profile/:registerNo', async (req, res) => {
  const registerNo = req.params.registerNo;

  try {
    const { rows } = await pgPool.query(
      `SELECT name, registerNo, dob, aadharNumber, abcId, photo, esignature 
       FROM students 
       WHERE registerNo = $1`,
      [registerNo]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const student = rows[0];
    res.status(200).json({
      name: student.name,
      registerNo: student.registerNo,
      dob: student.dob,
      aadharNumber: student.aadharNumber,
      abcId: student.abcId,
      photo: student.photo,
      eSignature: student.esignature,
    });
  } catch (err) {
    console.error('Error fetching student profile:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/student-profile/profile/:registerNo
router.put('/profile/:registerNo', async (req, res) => {
  try {
    // Use multer middleware to handle file uploads
    await new Promise((resolve, reject) => {
      upload(req, res, (err) => {
        if (err) {
          console.error('Multer error:', err.message);
          reject(new Error(err.message));
        } else {
          resolve();
        }
      });
    });

    const registerNo = req.params.registerNo;

    // Fetch the existing student to verify they exist
    const studentResult = await pgPool.query(
      `SELECT * FROM students WHERE registerNo = $1`,
      [registerNo]
    );

    if (studentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const student = studentResult.rows[0];

    // Prepare updates
    const updates = {};
    const params = [];

    // Update text fields if provided
    if (req.body.name) {
      updates.name = req.body.name;
      params.push(req.body.name);
    } else {
      params.push(student.name);
    }

    if (req.body.dob) {
      updates.dob = req.body.dob;
      params.push(req.body.dob);
    } else {
      params.push(student.dob);
    }

    if (req.body.aadharNumber) {
      if (!/^\d{12}$/.test(req.body.aadharNumber)) {
        return res.status(400).json({ error: 'Aadhar number must be 12 numeric digits' });
      }
      updates.aadharNumber = req.body.aadharNumber;
      params.push(req.body.aadharNumber);
    } else {
      params.push(student.aadharNumber);
    }

    if (req.body.abcId) {
      if (!/^[a-zA-Z0-9]{12}$/.test(req.body.abcId)) {
        return res.status(400).json({ error: 'ABC ID must be 12 alphanumeric characters' });
      }
      updates.abcId = req.body.abcId;
      params.push(req.body.abcId);
    } else {
      params.push(student.abcId);
    }

    // Update password if provided (store as plain text)
    if (req.body.password) {
      if (req.body.password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters long' });
      }
      updates.password = req.body.password;
      params.push(req.body.password);
    } else {
      params.push(student.password);
    }

    // Update files if uploaded
    if (req.files && req.files.photo) {
      updates.photo = `/Uploads/${req.files.photo[0].filename}`;
      params.push(updates.photo);
    } else {
      params.push(student.photo);
    }

    if (req.files && req.files.eSignature) {
      updates.eSignature = `/Uploads/${req.files.eSignature[0].filename}`;
      params.push(updates.eSignature);
    } else {
      params.push(student.esignature);
    }

    // Add registerNo for WHERE clause
    params.push(registerNo);

    // Update the student record
    const updateResult = await pgPool.query(
      `UPDATE students 
       SET name = $1, dob = $2, aadharNumber = $3, abcId = $4, password = $5, photo = $6, esignature = $7 
       WHERE registerNo = $8`,
      params
    );

    if (updateResult.rowCount === 0) {
      return res.status(500).json({ error: 'No changes applied to the profile' });
    }

    // Fetch the updated student record
    const updatedResult = await pgPool.query(
      `SELECT name, registerNo, dob, aadharNumber, abcId, photo, esignature 
       FROM students 
       WHERE registerNo = $1`,
      [registerNo]
    );

    const updatedStudent = updatedResult.rows[0];
    res.status(200).json({
      message: 'Profile updated successfully',
      profile: {
        name: updatedStudent.name,
        registerNo: updatedStudent.registerNo,
        dob: updatedStudent.dob,
        aadharNumber: updatedStudent.aadharNumber,
        abcId: updatedStudent.abcId,
        photo: updatedStudent.photo,
        eSignature: updatedStudent.esignature,
      },
    });
  } catch (err) {
    console.error('Error updating student profile:', err.message);
    return res.status(500).json({ error: `Failed to update profile: ${err.message}` });
  }
});

module.exports = router;