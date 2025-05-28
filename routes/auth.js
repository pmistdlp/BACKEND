const express = require('express');
const router = express.Router();

// Logout endpoint
router.post('/logout', (req, res) => {
  console.log('Logout attempt for session:', req.sessionID);
  if (req.session) {
    req.session.destroy((err) => {
      if (err) {
        console.error('Error destroying session:', err.message);
        return res.status(500).json({ error: 'Failed to logout' });
      }
      res.clearCookie('connect.sid', {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      });
      console.log('Session destroyed successfully');
      res.json({ message: 'Logged out successfully' });
    });
  } else {
    console.log('No active session to logout');
    res.status(400).json({ error: 'No active session to logout' });
  }
});

module.exports = router;