const express = require('express');
const router = express.Router();
const db = require('../model');
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

// Fetch all published courses (isDraft = 0), regardless of student
router.get('/courses/:studentId', async (req, res) => {
  console.log(`Fetching all published courses`);

  try {
    const courses = await new Promise((resolve, reject) => {
      db.all(
        `SELECT id, name, course_code, learning_platform, coCount, examMarks
         FROM courses
         WHERE isDraft = 0`,
        [],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });

    console.log(`Published courses fetched:`, courses);
    if (!courses.length) {
      return res.status(200).json([]);
    }

    res.json(courses);
  } catch (error) {
    console.error('Error fetching courses for results:', error);
    res.status(500).json({ error: 'Failed to fetch courses' });
  }
});

// Fetch results for a specific course (all students who have taken the exam)
router.get('/:courseId', async (req, res) => {
  const { courseId } = req.params;
  console.log(`Fetching results for course ID: ${courseId}`);

  try {
    // Step 1: Fetch course details to get coCount and examMarks
    const course = await new Promise((resolve, reject) => {
      db.get(
        `SELECT coCount, examMarks FROM courses WHERE id = ? AND isDraft = 0`,
        [courseId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    if (!course) {
      console.log(`Course ID ${courseId} not found or not published`);
      return res.status(404).json({ error: 'Course not found or not published' });
    }

    const coCount = course.coCount || 2; // Default to 2 COs
    const examMarks = course.examMarks || 100; // Total marks for the course
    console.log(`Course details: coCount=${coCount}, examMarks=${examMarks}`);

    // Step 2: Fetch all students who have taken the exam for this course
    const students = await new Promise((resolve, reject) => {
      db.all(
        `SELECT DISTINCT s.id, s.name, s.registerNo
         FROM students s
         JOIN student_exams se ON s.id = se.studentId
         WHERE se.courseId = ?`,
        [courseId],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });

    console.log(`Students who took the exam for course ID ${courseId}:`, students);
    if (!students.length) {
      console.log(`No students have taken the exam for course ID ${courseId}`);
      return res.status(200).json([]); // No students have taken the exam
    }

    // Step 3: Fetch all student exams for this course
    const studentExams = await new Promise((resolve, reject) => {
      db.all(
        `SELECT se.studentId, se.questionId, se.selectedAnswer, se.malpracticeFlag, q.coNumber, q.answer, q.weightage
         FROM student_exams se
         JOIN questions q ON se.questionId = q.id
         WHERE se.courseId = ?`,
        [courseId],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });

    console.log(`Student exams for course ID ${courseId}:`, studentExams);

    // Step 4: Fetch total possible marks per CO for accurate CO-wise percentages
    const coMaxMarks = {};
    for (let co = 1; co <= coCount; co++) {
      const coQuestions = await new Promise((resolve, reject) => {
        db.all(
          `SELECT SUM(weightage) as maxMarks
           FROM questions
           WHERE courseId = ? AND coNumber = ?`,
          [courseId, `CO${co}`],
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows[0]?.maxMarks || 0);
          }
        );
      });
      coMaxMarks[`CO${co}`] = coQuestions;
    }
    console.log(`Max marks per CO for course ID ${courseId}:`, coMaxMarks);

    // Step 5: Calculate results for each student who took the exam
    const results = await Promise.all(students.map(async (student) => {
      const studentId = student.id;
      const studentExamsForThisStudent = studentExams.filter(se => se.studentId === studentId);

      // Check if the student has any malpractice flag in their exam submissions
      const hasMalpractice = studentExamsForThisStudent.some(se => se.malpracticeFlag === 1);
      console.log(`Student ID ${studentId}: hasMalpractice=${hasMalpractice}`);

      if (hasMalpractice) {
        const result = {
          studentId: student.id,
          studentName: student.name,
          registerNumber: student.registerNo,
          overallMarks: 'M',
          overallPercentage: 'M',
        };
        for (let co = 1; co <= coCount; co++) {
          result[`co${co}Marks`] = 'M';
          result[`co${co}Percentage`] = 'M';
        }
        return result;
      }

      // Calculate CO-wise marks
      const coMarks = {};
      for (let co = 1; co <= coCount; co++) {
        const coQuestions = studentExamsForThisStudent.filter(se => se.coNumber === `CO${co}`);
        console.log(`Student ID ${studentId}, CO${co} questions:`, coQuestions);
        if (coQuestions.length === 0) {
          // If no questions answered for this CO, mark as 'A'
          coMarks[`co${co}Marks`] = 'A';
          coMarks[`co${co}Percentage`] = 'A';
        } else {
          let totalMarks = 0;
          coQuestions.forEach(q => {
            if (q.selectedAnswer === q.answer) {
              totalMarks += q.weightage;
            }
          });
          const maxMarks = coMaxMarks[`CO${co}`];
          coMarks[`co${co}Marks`] = totalMarks;
          coMarks[`co${co}Percentage`] = maxMarks ? ((totalMarks / maxMarks) * 100).toFixed(2) : '0.00';
        }
      }

      // Calculate overall marks dynamically from student_exams
      let overallMarks = 0;
      studentExamsForThisStudent.forEach(se => {
        if (se.selectedAnswer === se.answer) {
          overallMarks += se.weightage;
        }
      });

      // Use examMarks from courses table for overall percentage
      const overallPercentage = examMarks ? ((overallMarks / examMarks) * 100).toFixed(2) : '0.00';
      console.log(`Student ID ${studentId}: overallMarks=${overallMarks}, examMarks=${examMarks}, overallPercentage=${overallPercentage}`);

      return {
        studentId: student.id,
        studentName: student.name,
        registerNumber: student.registerNo,
        ...coMarks,
        overallMarks,
        overallPercentage,
      };
    }));

    console.log(`Final results for course ID ${courseId}:`, results);
    res.json(results);
  } catch (error) {
    console.error('Error fetching results:', error);
    res.status(500).json({ error: 'Failed to fetch results' });
  }
});

// Download results as Excel file
router.get('/:courseId/download', async (req, res) => {
  const { courseId } = req.params;
  console.log(`Generating Excel report for course ID: ${courseId}`);

  try {
    // Step 1: Fetch course details to get coCount and examMarks
    const course = await new Promise((resolve, reject) => {
      db.get(
        `SELECT name, coCount, examMarks FROM courses WHERE id = ? AND isDraft = 0`,
        [courseId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    if (!course) {
      console.log(`Course ID ${courseId} not found or not published`);
      return res.status(404).json({ error: 'Course not found or not published' });
    }

    const courseName = course.name;
    const coCount = course.coCount || 2; // Default to 2 COs
    const examMarks = course.examMarks || 100; // Total marks for the course
    console.log(`Course details: name=${courseName}, coCount=${coCount}, examMarks=${examMarks}`);

    // Step 2: Fetch all students who have taken the exam for this course, including ABC ID
    const students = await new Promise((resolve, reject) => {
      db.all(
        `SELECT DISTINCT s.id, s.name, s.registerNo, s.abcId
         FROM students s
         JOIN student_exams se ON s.id = se.studentId
         WHERE se.courseId = ?`,
        [courseId],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });

    console.log(`Students who took the exam for course ID ${courseId}:`, students);
    if (!students.length) {
      console.log(`No students have taken the exam for course ID ${courseId}`);
      return res.status(200).json({ error: 'No students have taken this exam yet' });
    }

    // Step 3: Fetch all student exams for this course
    const studentExams = await new Promise((resolve, reject) => {
      db.all(
        `SELECT se.studentId, se.questionId, se.selectedAnswer, se.malpracticeFlag, q.coNumber, q.answer, q.weightage
         FROM student_exams se
         JOIN questions q ON se.questionId = q.id
         WHERE se.courseId = ?`,
        [courseId],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });

    console.log(`Student exams for course ID ${courseId}:`, studentExams);

    // Step 4: Fetch total possible marks per CO for accurate CO-wise percentages
    const coMaxMarks = {};
    for (let co = 1; co <= coCount; co++) {
      const coQuestions = await new Promise((resolve, reject) => {
        db.all(
          `SELECT SUM(weightage) as maxMarks
           FROM questions
           WHERE courseId = ? AND coNumber = ?`,
          [courseId, `CO${co}`],
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows[0]?.maxMarks || 0);
          }
        );
      });
      coMaxMarks[`CO${co}`] = coQuestions;
    }
    console.log(`Max marks per CO for course ID ${courseId}:`, coMaxMarks);

    // Step 5: Calculate results for each student who took the exam
    const results = await Promise.all(students.map(async (student, index) => {
      const studentId = student.id;
      const studentExamsForThisStudent = studentExams.filter(se => se.studentId === studentId);

      // Check if the student has any malpractice flag in their exam submissions
      const hasMalpractice = studentExamsForThisStudent.some(se => se.malpracticeFlag === 1);
      console.log(`Student ID ${studentId}: hasMalpractice=${hasMalpractice}`);

      let result = {
        siNo: index + 1,
        registerNumber: student.registerNo,
        studentName: student.name,
        abcId: student.abcId || '-',
      };

      if (hasMalpractice) {
        for (let co = 1; co <= 6; co++) {
          result[`co${co}Marks`] = co <= coCount ? 'M' : '-';
          result[`co${co}Percentage`] = co <= coCount ? 'M' : '-';
        }
        result.overallMarks = 'M';
        result.overallPercentage = 'M';
        return result;
      }

      // Calculate CO-wise marks
      const coMarks = {};
      for (let co = 1; co <= coCount; co++) {
        const coQuestions = studentExamsForThisStudent.filter(se => se.coNumber === `CO${co}`);
        console.log(`Student ID ${studentId}, CO${co} questions:`, coQuestions);
        if (coQuestions.length === 0) {
          // If no questions answered for this CO, mark as 'A'
          coMarks[`co${co}Marks`] = 'A';
          coMarks[`co${co}Percentage`] = 'A';
        } else {
          let totalMarks = 0;
          coQuestions.forEach(q => {
            if (q.selectedAnswer === q.answer) {
              totalMarks += q.weightage;
            }
          });
          const maxMarks = coMaxMarks[`CO${co}`];
          coMarks[`co${co}Marks`] = totalMarks;
          coMarks[`co${co}Percentage`] = maxMarks ? ((totalMarks / maxMarks) * 100).toFixed(2) : '0.00';
        }
      }

      // Fill remaining COs (up to CO6) with '-'
      for (let co = 1; co <= 6; co++) {
        if (co <= coCount) {
          result[`co${co}Marks`] = coMarks[`co${co}Marks`];
          result[`co${co}Percentage`] = coMarks[`co${co}Percentage`];
        } else {
          result[`co${co}Marks`] = '-';
          result[`co${co}Percentage`] = '-';
        }
      }

      // Calculate overall marks dynamically from student_exams
      let overallMarks = 0;
      studentExamsForThisStudent.forEach(se => {
        if (se.selectedAnswer === se.answer) {
          overallMarks += se.weightage;
        }
      });

      // Use examMarks from courses table for overall percentage
      const overallPercentage = examMarks ? ((overallMarks / examMarks) * 100).toFixed(2) : '0.00';
      console.log(`Student ID ${studentId}: overallMarks=${overallMarks}, examMarks=${examMarks}, overallPercentage=${overallPercentage}`);

      result.overallMarks = overallMarks;
      result.overallPercentage = overallPercentage;
      return result;
    }));

    // Step 6: Generate Excel file
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Results Report');

    // Define columns
    const columns = [
      { header: 'SI.No', key: 'siNo', width: 10 },
      { header: 'Register Number', key: 'registerNumber', width: 15 },
      { header: 'Name of the Student', key: 'studentName', width: 25 },
      { header: 'ABC ID', key: 'abcId', width: 15 },
    ];

    // Add CO columns for marks and percentages (up to CO6)
    for (let co = 1; co <= 6; co++) {
      columns.push({ header: `CO${co} Marks`, key: `co${co}Marks`, width: 12 });
    }
    for (let co = 1; co <= 6; co++) {
      columns.push({ header: `CO${co} %`, key: `co${co}Percentage`, width: 12 });
    }

    columns.push({ header: 'Total Marks', key: 'overallMarks', width: 12 });
    columns.push({ header: 'Overall %', key: 'overallPercentage', width: 12 });

    worksheet.columns = columns;

    // Style the header row
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).alignment = { horizontal: 'center' };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFD3D3D3' }, // Light gray background
    };

    // Add data
    results.forEach(result => {
      worksheet.addRow(result);
    });

    // Style the data rows
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber > 1) { // Skip header row
        row.eachCell((cell) => {
          cell.alignment = { horizontal: 'center' };
          if (cell.value === 'M' || cell.value === 'A') {
            cell.font = { color: { argb: 'FFFF0000' } }; // Red color for 'M' and 'A'
          }
        });
      }
    });

    // Step 7: Save the Excel file temporarily and send it to the client
    const fileName = `results_${courseId}_${Date.now()}.xlsx`;
    const filePath = path.join(__dirname, '..', 'Uploads', fileName);

    await workbook.xlsx.writeFile(filePath);
    console.log(`Excel file generated: ${filePath}`);

    res.download(filePath, `${courseName}_Results_${Date.now()}.xlsx`, (err) => {
      if (err) {
        console.error('Error sending Excel file:', err);
        res.status(500).json({ error: 'Failed to download the report' });
      }
      // Delete the file after sending
      fs.unlink(filePath, (unlinkErr) => {
        if (unlinkErr) console.error('Error deleting Excel file:', unlinkErr);
        else console.log(`Excel file deleted: ${filePath}`);
      });
    });
  } catch (error) {
    console.error('Error generating Excel report:', error);
    res.status(500).json({ error: 'Failed to generate the report' });
  }
});

module.exports = router;