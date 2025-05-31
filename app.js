const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const session = require('express-session');
const PGSimple = require('connect-pg-simple')(session);
const { Pool } = require('pg');
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
    'https://mooc.pmu.edu',
    'http://mooc.pmu.edu'
  ];

  app.use(cors({
    origin: (origin, callback) => {
      console.log(`[${new Date().toISOString()}] Request Origin: ${origin}`);
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

  // PostgreSQL connection pool
  const pgPool = new Pool({
    connectionString: 'postgresql://root:QgaoJrvWJaFia6GxETVtRXSNV9P0UVfm@dpg-d0si1oadbo4c73f3midg-a.oregon-postgres.render.com/mooc_vmh7',
    ssl: { rejectUnauthorized: false }
  });

  // Test database connection
  pgPool.connect((err, client, release) => {
    if (err) {
      console.error('Error connecting to PostgreSQL:', err.message);
      process.exit(1);
    }
    console.log('Connected to PostgreSQL database');
    release();
  });

  // Session middleware
  const sessionStore = new PGSimple({
    pool: pgPool,
    tableName: 'sessions',
    createTableIfMissing: true
  });

  sessionStore.on('error', (error) => {
    console.error(`[${new Date().toISOString()}] Session store error:`, error.message);
  });

  app.use(session({
    store: sessionStore,
    secret: process.env.SESSION_SECRET || 'a-very-strong-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production' ? true : false, // Allow non-secure cookies in development
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000,
      sameSite: 'lax'
    },
  }));

  app.use(express.json());
  app.use('/Uploads', express.static(path.join(__dirname, 'Uploads')));

  // Log all incoming requests
  app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} SessionID: ${req.sessionID} User: ${JSON.stringify(req.session.user || {})}`);
    next();
  });

  // Check session endpoint
  app.get('/api/check-session', (req, res) => {
    console.log(`[${new Date().toISOString()}] GET /api/check-session SessionID: ${req.sessionID}`);
    if (req.session.user && req.session.user.role) {
      console.log(`Session valid for user:`, req.session.user);
      res.json({
        isAuthenticated: true,
        user: {
          id: req.session.user.id,
          role: req.session.user.role,
          name: req.session.user.name,
          registerNo: req.session.user.registerNo
        }
      });
    } else {
      console.log('No valid session found');
      res.status(401).json({ isAuthenticated: false, error: 'No valid session' });
    }
  });

  // Unified login route
  app.post('/api/login', async (req, res) => {
    const { role, username, registerNo, password } = req.body;
    console.log(`[${new Date().toISOString()}] Login attempt:`, { role, username, registerNo });

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

  // Debug endpoint to list all registered routes
  app.get('/api/debug/routes', (req, res) => {
    const routes = [];
    app._router.stack.forEach((middleware) => {
      if (middleware.route) {
        routes.push({
          path: middleware.route.path,
          methods: Object.keys(middleware.route.methods).map(m => m.toUpperCase())
        });
      } else if (middleware.name === 'router' && middleware.handle.stack) {
        const prefix = middleware.regexp.source
          .replace(/^\^\\\/?(?=\w)/, '')
          .replace(/\\\//g, '/')
          .replace(/\(\?:\[\^\]\]\+\)\?/, '')
          .replace(/\\\/\?$/, '');
        middleware.handle.stack.forEach((handler) => {
          if (handler.route) {
            routes.push({
              path: `${prefix}${handler.route.path}`,
              methods: Object.keys(handler.route.methods).map(m => m.toUpperCase())
            });
          }
        });
      }
    });
    res.json({ routes });
  });

  // Backup route to download the database file (accessible to anyone)
  app.get('/api/backup', (req, res) => {
    const dbPath = path.resolve(__dirname, 'exam.db');
    console.log(`[${new Date().toISOString()}] Backup requested for database at: ${dbPath}`);

    if (!fs.existsSync(dbPath)) {
      console.error(`Database file not found at: ${dbPath}`);
      return res.status(404).json({ error: 'Database file not found' });
    }

    res.setHeader('Content-Disposition', 'attachment; filename=exam.db');
    res.setHeader('Content-Type', 'application/octet-stream');

    res.download(dbPath, 'exam.db', (err) => {
      if (err) {
        console.error(`Error sending database file: ${err.message}`);
        return res.status(500).json({ error: 'Failed to download database' });
      }
      console.log(`Database backup downloaded successfully`);
    });
  });

  // Global error handler
  app.use((err, req, res, next) => {
    console.error(`[${new Date().toISOString()}] Unhandled error:`, err.stack);
    res.status(500).json({ error: 'Something went wrong on the server' });
  });

  // Catch-all for 404
  app.use((req, res) => {
    console.log(`[${new Date().toISOString()}] 404 Not Found: ${req.method} ${req.url}`);
    res.status(404).json({ error: 'Not Found' });
  });

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
} catch (error) {
  console.error('Server startup error:', error);
  process.exit(1);
}