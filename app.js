const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const fs = require('fs');

try {
  const adminRoutes = require('./routes/admin');
  const coursesRoutes = require('./routes/courses');
  const questionsRoutes = require('./routes/questions');
  const staffRoutes = require('./routes/staff');
  const studentRoutes = require('./routes/student');
  const historyRoutes = require('./routes/history');
  const publicEnrollmentRoutes = require('./routes/publicEnrollment');
  const adminEnrollmentsRoutes = require('./routes/adminEnrollments');
  const studentCoursesRoutes = require('./routes/studentCourses');
  const ResultsRoutes = require('./routes/results');
  const studentProfileRoutes = require('./routes/studentProfile');
  const authRoutes = require('./routes/auth');

  const app = express();

  const allowedOrigins = [
    'http://localhost:8080',
    'https://mooc-frontend-9kdg.onrender.com',
    'https://moocs.pmu.edu'
  ];

  app.use(cors({
    origin: (origin, callback) => {
      console.log('Request Origin:', origin);
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, origin);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
  }));

  app.options('*', cors());

  // Create db directory if it doesn't exist
  const dbDir = path.join(__dirname, 'db');
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
    console.log(`Created directory: ${dbDir}`);
  }

  // Session middleware
  const sessionStore = new SQLiteStore({
    db: 'sessions.db',
    dir: dbDir,
  });

  sessionStore.on('error', (error) => {
    console.error('Session store error:', error.message);
  });

  app.use(session({
    store: sessionStore,
    secret: process.env.SESSION_SECRET || 'your-secret-key', // Use env variable in production
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, // 1 day
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', // For cross-site cookies
    },
  }));

  app.use(express.json());
  app.use('/Uploads', express.static(path.join(__dirname, 'Uploads')));

  // Log all incoming requests
  app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
  });

  // Session check endpoint
  app.get('/api/check-session', (req, res) => {
    console.log('Checking session:', req.sessionID);
    if (req.session.user) {
      console.log('Session valid for user:', req.session.user);
      res.json({ user: req.session.user });
    } else {
      console.log('No active session found');
      res.status(401).json({ error: 'No active session' });
    }
  });

  // Unified login route
  app.post('/api/login', async (req, res) => {
    const { role, username, registerNo, password } = req.body;
    console.log('Login attempt:', { role, username, registerNo });

    if (!role || !password) {
      console.log('Missing role or password');
      return res.status(400).json({ error: 'Role and password are required' });
    }

    try {
      if (role === 'admin') {
        if (!username) {
          return res.status(400).json({ error: 'Username is required for admin login' });
        }
        return adminRoutes.stack
          .find(layer => layer.route && layer.route.path === '/login' && layer.route.methods.post)
          .route.stack[0].handle(req, res);
      } else if (role === 'staff') {
        if (!username) {
          return res.status(400).json({ error: 'Username is required for staff login' });
        }
        return adminRoutes.stack
          .find(layer => layer.route && layer.route.path === '/staff/login' && layer.route.methods.post)
          .route.stack[0].handle(req, res);
      } else if (role === 'student') {
        if (!registerNo) {
          return res.status(400).json({ error: 'Register number is required for student login' });
        }
        return adminRoutes.stack
          .find(layer => layer.route && layer.route.path === '/student/login' && layer.route.methods.post)
          .route.stack[0].handle(req, res);
      } else {
        console.log('Invalid role:', role);
        return res.status(400).json({ error: 'Invalid role' });
      }
    } catch (err) {
      console.error('Error in login route:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Route middleware
  app.use('/api/admin-enrollments', adminEnrollmentsRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/courses', coursesRoutes);
  app.use('/api/questions', questionsRoutes);
  app.use('/api/staff', staffRoutes);
  app.use('/api/student', studentRoutes);
  app.use('/api/student-courses', studentCoursesRoutes);
  app.use('/api/history', historyRoutes);
  app.use('/api/public-enrollment', publicEnrollmentRoutes);
  app.use('/api/student-profile', studentProfileRoutes);
  app.use('/api/results', ResultsRoutes);
  app.use('/api', authRoutes);

  // Serve frontend static files
  app.use(express.static(path.join(__dirname, 'dist')));

  // Catch-all route to serve index.html for frontend routing
  app.get('*', (req, res) => {
    console.log(`Serving index.html for route: ${req.url}`);
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
  });

  // Global error handler
  app.use((err, req, res, next) => {
    console.error('Unhandled error:', err.stack);
    res.status(500).json({ error: 'Something went wrong on the server' });
  });

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
} catch (error) {
  console.error('Server startup error:', error);
  process.exit(1);
}