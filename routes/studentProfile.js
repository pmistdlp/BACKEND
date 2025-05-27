const express = require('express');
const router = express.Router();
const db = require('../model'); // Import the SQLite database connection
const upload = require('../utils/multer');

// GET /api/student-profile/profile/:registerNo
router.get('/profile/:registerNo', (req, res) => {
  const registerNo = req.params.registerNo;

  db.get(
    `SELECT name, registerNo, dob, aadharNumber, abcId, photo, eSignature 
     FROM students 
     WHERE registerNo = ?`,
    [registerNo],
    (err, student) => {
      if (err) {
        console.error('Error fetching student profile:', err.message);
        return res.status(500).json({ error: 'Internal server error' });
      }

      if (!student) {
        return res.status(404).json({ error: 'Student not found' });
      }

      // Return the student's profile data
      res.status(200).json({
        name: student.name,
        registerNo: student.registerNo,
        dob: student.dob,
        aadharNumber: student.aadharNumber,
        abcId: student.abcId,
        photo: student.photo,
        eSignature: student.eSignature,
      });
    }
  );
});

// PUT /api/student-profile/profile/:registerNo
router.put('/profile/:registerNo', (req, res, next) => {
  upload(req, res, (err) => {
    if (err) {
      console.error('Multer error:', err.message);
      return res.status(400).json({ error: err.message });
    }

    const registerNo = req.params.registerNo;

    // First, fetch the existing student to verify they exist
    db.get(
      `SELECT * FROM students WHERE registerNo = ?`,
      [registerNo],
      (err, student) => {
        if (err) {
          console.error('Error fetching student:', err.message);
          return res.status(500).json({ error: 'Internal server error' });
        }

        if (!student) {
          return res.status(404).json({ error: 'Student not found' });
        }

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
          params.push(student.eSignature);
        }

        // Construct the SQL UPDATE query
        const setClause = Object.keys(updates).length > 0
          ? `name = ?, dob = ?, aadharNumber = ?, abcId = ?, password = ?, photo = ?, eSignature = ?`
          : `name = ?, dob = ?, aadharNumber = ?, abcId = ?, password = ?, photo = ?, eSignature = ?`; // Include all fields to avoid undefined issues

        params.push(registerNo); // For the WHERE clause

        // Update the student record in the database
        db.run(
          `UPDATE students 
           SET ${setClause} 
           WHERE registerNo = ?`,
          params,
          function (updateErr) {
            if (updateErr) {
              console.error('Error updating student profile:', updateErr.message);
              return res.status(500).json({ error: 'Failed to update profile' });
            }

            if (this.changes === 0) {
              return res.status(500).json({ error: 'No changes applied to the profile' });
            }

            // Fetch the updated student record to return
            db.get(
              `SELECT name, registerNo, dob, aadharNumber, abcId, photo, eSignature 
               FROM students 
               WHERE registerNo = ?`,
              [registerNo],
              (fetchErr, updatedStudent) => {
                if (fetchErr) {
                  console.error('Error fetching updated student profile:', fetchErr.message);
                  return res.status(500).json({ error: 'Internal server error' });
                }

                res.status(200).json({
                  message: 'Profile updated successfully',
                  profile: {
                    name: updatedStudent.name,
                    registerNo: updatedStudent.registerNo,
                    dob: updatedStudent.dob,
                    aadharNumber: updatedStudent.aadharNumber,
                    abcId: updatedStudent.abcId,
                    photo: updatedStudent.photo,
                    eSignature: updatedStudent.eSignature,
                  },
                });
              }
            );
          }
        );
      }
    );
  });
});

module.exports = router;