const { Pool } = require('pg');

const pgPool = new Pool({
  connectionString: 'postgresql://root:QgaoJrvWJaFia6GxETVtRXSNV9P0UVfm@dpg-d0si1oadbo4c73f3midg-a.oregon-postgres.render.com/mooc_vmh7',
  ssl: { rejectUnauthorized: false } // Required for Render's external PostgreSQL
});

pgPool.connect((err, client, release) => {
  if (err) {
    console.error('Error connecting to PostgreSQL:', err.message);
  } else {
    console.log('Connected to PostgreSQL database mooc_vmh7');
    release();
  }
});

async function ensureTableExists(table, createQuery) {
  try {
    const existsQuery = `
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = $1
      )`;
    const res = await pgPool.query(existsQuery, [table]);
    const tableExists = res.rows[0].exists;

    if (!tableExists) {
      console.log(`Creating table ${table}...`);
      await pgPool.query(createQuery);
      console.log(`${table} table created`);
    } else {
      console.log(`${table} table already exists`);
    }
  } catch (err) {
    console.error(`Error creating table ${table}:`, err.message);
    throw err;
  }
}

async function ensureColumnExists(table, column, definition) {
  try {
    const existsQuery = `
      SELECT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = $1 AND lower(column_name) = lower($2)
      )`;
    const res = await pgPool.query(existsQuery, [table, column]);
    const columnExists = res.rows[0].exists;

    if (!columnExists) {
      console.log(`Adding column ${column} to ${table}...`);
      await pgPool.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
      console.log(`Successfully added ${column} to ${table}`);
    } else {
      console.log(`Column ${column} already exists in ${table}`);
    }
  } catch (err) {
    if (err.message.includes('already exists')) {
      console.log(`Column ${column} already exists in ${table}, skipping...`);
    } else {
      console.error(`Error adding column ${column} to ${table}:`, err.message);
      throw err;
    }
  }
}

async function ensureIndexExists(indexName, createQuery) {
  try {
    const existsQuery = `
      SELECT EXISTS (
        SELECT FROM pg_indexes 
        WHERE schemaname = 'public' AND lower(indexname) = lower($1)
      )`;
    const res = await pgPool.query(existsQuery, [indexName]);
    const indexExists = res.rows[0].exists;

    if (!indexExists) {
      console.log(`Creating index ${indexName}...`);
      await pgPool.query(createQuery);
      console.log(`${indexName} index created`);
    } else {
      console.log(`${indexName} index already exists`);
    }
  } catch (err) {
    if (err.message.includes('already exists')) {
      console.log(`Index ${indexName} already exists, skipping...`);
    } else {
      console.error(`Error creating index ${indexName}:`, err.message);
      throw err;
    }
  }
}

async function initializeDatabase() {
  try {
    // Admins table
    await ensureTableExists('admins', `
      CREATE TABLE admins (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE,
        password TEXT,
        isMaster BOOLEAN DEFAULT FALSE
      )`);

    // Check and insert default admin
    const adminCheck = await pgPool.query(`SELECT id FROM admins WHERE username = $1`, ['pmistdlp']);
    if (adminCheck.rows.length === 0) {
      await pgPool.query(
        `INSERT INTO admins (username, password, isMaster) VALUES ($1, $2, $3)`,
        ['pmistdlp', 'Periyar@2025', true]
      );
      console.log('Default admin (pmistdlp) created');
    } else {
      console.log('Default admin (pmistdlp) already exists');
    }

    // Staff table
    await ensureTableExists('staff', `
      CREATE TABLE staff (
        id SERIAL PRIMARY KEY,
        name TEXT,
        username TEXT UNIQUE,
        password TEXT,
        department TEXT,
        isMaster BOOLEAN DEFAULT FALSE,
        email TEXT,
        facultyId TEXT UNIQUE
      )`);

    // Courses table
    await ensureTableExists('courses', `
      CREATE TABLE courses (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        course_code TEXT,
        learning_platform TEXT NOT NULL CHECK (learning_platform IN ('NPTEL', 'NPTEL+', 'SWAYAM', 'ULEKTZ')),
        examDate TEXT,
        examTime TEXT,
        examQuestionCount INTEGER,
        examMarks INTEGER,
        coCount INTEGER DEFAULT 0,
        coDetails TEXT DEFAULT '[]',
        isDraft BOOLEAN DEFAULT TRUE,
        isRegistrationOpen BOOLEAN DEFAULT FALSE
      )`);

    // Questions table
    await ensureTableExists('questions', `
      CREATE TABLE questions (
        id SERIAL PRIMARY KEY,
        courseId INTEGER,
        coNumber TEXT NOT NULL,
        kLevel INTEGER NOT NULL CHECK (kLevel >= 1 AND kLevel <= 6),
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
        answer TEXT NOT NULL CHECK (answer IN ('option1', 'option2', 'option3', 'option4')),
        weightage INTEGER DEFAULT 1 CHECK (weightage > 0),
        FOREIGN KEY (courseId) REFERENCES courses(id)
      )`);

    // Students table
    await ensureTableExists('students', `
      CREATE TABLE students (
        id SERIAL PRIMARY KEY,
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
    await ensureTableExists('student_courses', `
      CREATE TABLE student_courses (
        id SERIAL PRIMARY KEY,
        studentId INTEGER,
        courseId INTEGER,
        startDate TEXT,
        startTime TEXT,
        isEligible BOOLEAN DEFAULT FALSE,
        paymentConfirmed BOOLEAN DEFAULT FALSE,
        FOREIGN KEY (studentId) REFERENCES students(id),
        FOREIGN KEY (courseId) REFERENCES courses(id)
      )`);

    // Ensure columns in student_courses
    await ensureColumnExists('student_courses', 'isEligible', 'BOOLEAN DEFAULT FALSE');
    await ensureColumnExists('student_courses', 'paymentConfirmed', 'BOOLEAN DEFAULT FALSE');

    // Course History table
    await ensureTableExists('course_history', `
      CREATE TABLE course_history (
        id SERIAL PRIMARY KEY,
        courseId INTEGER,
        action TEXT,
        questionId INTEGER,
        userType TEXT,
        userId INTEGER,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (courseId) REFERENCES courses(id)
      )`);

    // Student History table
    await ensureTableExists('student_history', `
      CREATE TABLE student_history (
        id SERIAL PRIMARY KEY,
        studentId INTEGER,
        action TEXT,
        userType TEXT,
        userId INTEGER,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (studentId) REFERENCES students(id)
      )`);

    // Student Exams table
    await ensureTableExists('student_exams', `
      CREATE TABLE student_exams (
        id SERIAL PRIMARY KEY,
        studentId INTEGER,
        courseId INTEGER,
        questionId INTEGER,
        selectedAnswer TEXT,
        startTime TIMESTAMP,
        endTime TIMESTAMP,
        malpracticeFlag BOOLEAN DEFAULT FALSE,
        FOREIGN KEY (studentId) REFERENCES students(id),
        FOREIGN KEY (courseId) REFERENCES courses(id),
        FOREIGN KEY (questionId) REFERENCES questions(id),
        UNIQUE (studentId, courseId, questionId)
      )`);

    // Malpractice Logs table
    await ensureTableExists('malpractice_logs', `
      CREATE TABLE malpractice_logs (
        id SERIAL PRIMARY KEY,
        studentId INTEGER,
        courseId INTEGER,
        type TEXT,
        timestamp TEXT,
        FOREIGN KEY (studentId) REFERENCES students(id),
        FOREIGN KEY (courseId) REFERENCES courses(id)
      )`);

    // Student Results table
    await ensureTableExists('student_results', `
      CREATE TABLE student_results (
        id SERIAL PRIMARY KEY,
        studentId INTEGER,
        courseId INTEGER,
        marks INTEGER,
        notifiedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        isPublished BOOLEAN DEFAULT FALSE,
        FOREIGN KEY (studentId) REFERENCES students(id),
        FOREIGN KEY (courseId) REFERENCES courses(id),
        UNIQUE (studentId, courseId)
      )`);

    // Create indexes
    await Promise.all([
      ensureIndexExists('idx_student_results_studentid', `CREATE INDEX idx_student_results_studentid ON student_results(studentId)`),
      ensureIndexExists('idx_student_results_courseid', `CREATE INDEX idx_student_results_courseid ON student_results(courseId)`),
      ensureIndexExists('idx_student_exams_studentid', `CREATE INDEX idx_student_exams_studentid ON student_exams(studentId)`),
      ensureIndexExists('idx_malpractice_logs_studentid', `CREATE INDEX idx_malpractice_logs_studentid ON malpractice_logs(studentId)`),
      ensureIndexExists('idx_malpractice_logs_courseid', `CREATE INDEX idx_malpractice_logs_courseid ON malpractice_logs(courseId)`),
    ]);

    console.log('Database initialization completed successfully');
  } catch (err) {
    console.error('Error setting up database:', err.message);
    process.exit(1); // Exit to prevent the app from running with an incomplete database
  }
}

// Initialize the database
initializeDatabase();

module.exports = pgPool;