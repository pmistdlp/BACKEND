const express = require('express');
const router = express.Router();

// Logout endpoint
router.post('/logout', (req, res) => {
  // Check if session exists
  if (req.session) {
    // Destroy the session
    req.session.destroy((err) => {
      if (err) {
        console.error('Error destroying session:', err.message);
        return res.status(500).json({ error: 'Failed to logout' });
      }
      // Clear the session cookie
      res.clearCookie('connect.sid'); // Adjust cookie name if different
      console.log('Session destroyed successfully');
      res.json({ message: 'Logged out successfully' });
    });
  } else {
    // No session exists
    res.status(400).json({ error: 'No active session to logout' });
  }
});

module.exports = router;