const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

// Define the database file path
const dbPath = path.resolve(__dirname, 'exam.db');

// Initialize the database connection
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error connecting to exam.db:', err.message);
  } else {
    console.log('Connected to exam.db');
  }
});

function ensureColumnExists(table, column, definition) {
  return new Promise((resolve, reject) => {
    db.all(`PRAGMA table_info(${table})`, (err, rows) => {
      if (err) {
        console.error(`Error checking table info for ${table}:`, err.message);
        return reject(err);
      }
      const columnExists = Array.isArray(rows) && rows.some(row => row.name === column);
      if (!columnExists) {
        console.log(`Column ${column} not found in ${table}. Adding it...`);
        db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`, (alterErr) => {
          if (alterErr) {
            console.error(`Error adding ${column} to ${table}:`, alterErr.message);
            return reject(alterErr);
          }
          console.log(`Successfully added ${column} to ${table}`);
          resolve();
        });
      } else {
        console.log(`Column ${column} already exists in ${table}`);
        resolve();
      }
    });
  });
}

function ensureTableExists(table, createQuery) {
  return new Promise((resolve, reject) => {
    db.run(`CREATE TABLE IF NOT EXISTS ${table} ${createQuery}`, (err) => {
      if (err) {
        console.error(`Error creating ${table} table:`, err.message);
        reject(err);
      } else {
        console.log(`${table} table ready`);
        resolve();
      }
    });
  });
}

function ensureIndexExists(indexName, createQuery) {
  return new Promise((resolve, reject) => {
    db.run(createQuery, (err) => {
      if (err) {
        console.error(`Error creating ${indexName} index:`, err.message);
        reject(err);
      } else {
        console.log(`${indexName} index ready`);
        resolve();
      }
    });
  });
}

db.serialize(async () => {
  try {
    // Admins table
    await ensureTableExists('admins', `(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password TEXT,
      isMaster INTEGER DEFAULT 0
    )`);
    
    // Check and insert default admin
    db.get(`SELECT id FROM admins WHERE username = ?`, ['pmistdlp'], (err, row) => {
      if (err) {
        console.error('Error checking for default admin:', err);
      } else if (!row) {
        db.run(
          `INSERT INTO admins (username, password, isMaster) VALUES (?, ?, ?)`,
          ['pmistdlp', 'Periyar@2025', 1],
          (insertErr) => {
            if (insertErr) {
              console.error('Error inserting default admin:', insertErr);
            } else {
              console.log('Default admin (pmistdlp) created');
            }
          }
        );
      } else {
        console.log('Default admin (pmistdlp) already exists');
      }
    });

    // Staff table
    await ensureTableExists('staff', `(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      username TEXT UNIQUE,
      password TEXT,
      department TEXT,
      isMaster INTEGER DEFAULT 0,
      email TEXT,
      facultyId TEXT UNIQUE
    )`);

    // Courses table
    await ensureTableExists('courses', `(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      course_code TEXT,
      learning_platform TEXT NOT NULL CHECK(learning_platform IN ('NPTEL', 'NPTEL+', 'SWAYAM', 'ULEKTZ')),
      examDate TEXT,
      examTime TEXT,
      examQuestionCount INTEGER,
      examMarks INTEGER,
      coCount INTEGER DEFAULT 0,
      coDetails TEXT DEFAULT '[]',
      isDraft INTEGER DEFAULT 1,
      isRegistrationOpen INTEGER DEFAULT 0
    )`);

    // Questions table
    await ensureTableExists('questions', `(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      courseId INTEGER,
      coNumber TEXT NOT NULL,
      kLevel INTEGER NOT NULL CHECK(kLevel >= 1 AND kLevel <= 6),
      question TEXT NOT NULL,
      questionImage TEXT,
      option1 TEXT NOT NULL,
      option1Image TEXT,
      option2 TEXT NOT NULL,
      option2Image TEXT,
      option3 TEXT NOT NULL,
      option3Image TEXT,
      option4 TEXT NOT NULL,
      option4Image TEXT,
      answer TEXT NOT NULL CHECK(answer IN ('option1', 'option2', 'option3', 'option4')),
      weightage INTEGER DEFAULT 1 CHECK(weightage > 0),
      FOREIGN KEY (courseId) REFERENCES courses(id)
    )`);

    // Students table
    await ensureTableExists('students', `(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      registerNo TEXT UNIQUE NOT NULL,
      dob TEXT NOT NULL,
      password TEXT NOT NULL,
      aadharNumber TEXT,
      abcId TEXT,
      photo TEXT,
      eSignature TEXT,
      source TEXT NOT NULL
    )`);

    // Student Courses table
    await ensureTableExists('student_courses', `(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      studentId INTEGER,
      courseId INTEGER,
      startDate TEXT,
      startTime TEXT,
      isEligible INTEGER DEFAULT 0,
      paymentConfirmed INTEGER DEFAULT 0,
      FOREIGN KEY (studentId) REFERENCES students(id),
      FOREIGN KEY (courseId) REFERENCES courses(id)
    )`);

    // Ensure columns in student_courses
    await ensureColumnExists('student_courses', 'isEligible', 'INTEGER DEFAULT 0');
    await ensureColumnExists('student_courses', 'paymentConfirmed', 'INTEGER DEFAULT 0');

    // Course History table
    await ensureTableExists('course_history', `(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      courseId INTEGER,
      action TEXT,
      questionId INTEGER,
      userType TEXT,
      userId INTEGER,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (courseId) REFERENCES courses(id)
    )`);

    // Student History table
    await ensureTableExists('student_history', `(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      studentId INTEGER,
      action TEXT,
      userType TEXT,
      userId INTEGER,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (studentId) REFERENCES students(id)
    )`);

    // Student Exams table
    await ensureTableExists('student_exams', `(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      studentId INTEGER,
      courseId INTEGER,
      questionId INTEGER,
      selectedAnswer TEXT,
      startTime DATETIME,
      endTime DATETIME,
      malpracticeFlag INTEGER DEFAULT 0,
      FOREIGN KEY (studentId) REFERENCES students(id),
      FOREIGN KEY (courseId) REFERENCES courses(id),
      FOREIGN KEY (questionId) REFERENCES questions(id),
      UNIQUE (studentId, courseId, questionId)
    )`);

    // Malpractice Logs table
    await ensureTableExists('malpractice_logs', `(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      studentId INTEGER,
      courseId INTEGER,
      type TEXT,
      timestamp TEXT,
      FOREIGN KEY (studentId) REFERENCES students(id),
      FOREIGN KEY (courseId) REFERENCES courses(id)
    )`);

    // Student Results table
    await ensureTableExists('student_results', `(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      studentId INTEGER,
      courseId INTEGER,
      marks INTEGER,
      notifiedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      isPublished INTEGER DEFAULT 0,
      FOREIGN KEY (studentId) REFERENCES students(id),
      FOREIGN KEY (courseId) REFERENCES courses(id),
      UNIQUE (studentId, courseId)
    )`);

    // Create indexes
    await Promise.all([
      ensureIndexExists('idx_student_results_studentId', `CREATE INDEX IF NOT EXISTS idx_student_results_studentId ON student_results(studentId)`),
      ensureIndexExists('idx_student_results_courseId', `CREATE INDEX IF NOT EXISTS idx_student_results_courseId ON student_results(courseId)`),
      ensureIndexExists('idx_student_exams_studentId', `CREATE INDEX IF NOT EXISTS idx_student_exams_studentId ON student_exams(studentId)`),
      ensureIndexExists('idx_malpractice_logs_studentId', `CREATE INDEX IF NOT EXISTS idx_malpractice_logs_studentId ON malpractice_logs(studentId)`),
      ensureIndexExists('idx_malpractice_logs_courseId', `CREATE INDEX IF NOT EXISTS idx_malpractice_logs_courseId ON malpractice_logs(courseId)`)
    ]);

  } catch (err) {
    console.error('Error setting up database:', err);
  }
});

module.exports = db;
