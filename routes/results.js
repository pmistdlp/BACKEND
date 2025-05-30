const express = require('express');
const router = express.Router();
const pgPool = require('../model');
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

// Fetch all published courses (isdraft = FALSE), regardless of student
router.get('/courses/:studentId', async (req, res) => {
  console.log(`Fetching all published courses`);
  try {
    const { rows } = await pgPool.query(
      `SELECT id, name, course_code, learning_platform, cocount, exammarks
       FROM courses
       WHERE isdraft = FALSE`
    );
    console.log(`Published courses fetched:`, rows);
    res.json(rows || []);
  } catch (error) {
    console.error('Error fetching courses for results:', error.message);
    res.status(500).json({ error: 'Failed to fetch courses' });
  }
});

// Fetch results for a specific course (all students who have taken the exam)
router.get('/:courseId', async (req, res) => {
  const { courseId } = req.params;
  console.log(`Fetching results for course ID: ${courseId}`);

  try {
    // Step 1: Fetch course details to get cocount and exammarks
    const courseResult = await pgPool.query(
      `SELECT cocount, exammarks FROM courses WHERE id = $1 AND isdraft = FALSE`,
      [courseId]
    );
    if (courseResult.rows.length === 0) {
      console.log(`Course ID ${courseId} not found or not published`);
      return res.status(404).json({ error: 'Course not found or not published' });
    }

    const course = courseResult.rows[0];
    const coCount = course.cocount || 2; // Default to 2 COs
    const examMarks = course.exammarks || 100; // Total marks for the course
    console.log(`Course details: coCount=${coCount}, examMarks=${examMarks}`);

    // Step 2: Fetch all students who have taken the exam for this course
    const studentResult = await pgPool.query(
      `SELECT DISTINCT s.id, s.name, s.registerNo
       FROM students s
       JOIN student_exams se ON s.id = se.studentid
       WHERE se.courseid = $1`,
      [courseId]
    );
    const students = studentResult.rows;
    console.log(`Students who took the exam for course ID ${courseId}:`, students);
    if (!students.length) {
      console.log(`No students have taken the exam for course ID ${courseId}`);
      return res.status(200).json([]);
    }

    // Step 3: Fetch all student exams for this course
    const examResult = await pgPool.query(
      `SELECT se.studentid, se.questionid, se.selectedanswer, se.malpracticeflag, q.conumber, q.answer, q.weightage
       FROM student_exams se
       JOIN questions q ON se.questionid = q.id
       WHERE se.courseid = $1`,
      [courseId]
    );
    const studentExams = examResult.rows;
    console.log(`Student exams for course ID ${courseId}:`, studentExams);

    // Step 4: Fetch total possible marks per CO for accurate CO-wise percentages
    const coMaxMarks = {};
    for (let co = 1; co <= coCount; co++) {
      const coResult = await pgPool.query(
        `SELECT SUM(weightage) as maxmarks
         FROM questions
         WHERE courseid = $1 AND conumber = $2`,
        [courseId, `CO${co}`]
      );
      coMaxMarks[`CO${co}`] = coResult.rows[0]?.maxmarks || 0;
    }
    console.log(`Max marks per CO for course ID ${courseId}:`, coMaxMarks);

    // Step 5: Calculate results for each student who took the exam
    const results = await Promise.all(students.map(async (student) => {
      const studentId = student.id;
      const studentExamsForThisStudent = studentExams.filter(se => se.studentid === studentId);

      // Check if the student has any malpractice flag in their exam submissions
      const hasMalpractice = studentExamsForThisStudent.some(se => se.malpracticeflag);
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
        const coQuestions = studentExamsForThisStudent.filter(se => se.conumber === `CO${co}`);
        console.log(`Student ID ${studentId}, CO${co} questions:`, coQuestions);
        if (coQuestions.length === 0) {
          // If no questions answered for this CO, mark as 'A'
          coMarks[`co${co}Marks`] = 'A';
          coMarks[`co${co}Percentage`] = 'A';
        } else {
          let totalMarks = 0;
          coQuestions.forEach(q => {
            if (q.selectedanswer === q.answer) {
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
        if (se.selectedanswer === se.answer) {
          overallMarks += se.weightage;
        }
      });

      // Use examMarks for overall percentage
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
    console.error('Error fetching results:', error.message);
    res.status(500).json({ error: 'Failed to fetch results' });
  }
});

// Download results as Excel file
router.get('/:courseId/download', async (req, res) => {
  const { courseId } = req.params;
  console.log(`Generating Excel report for course ID: ${courseId}`);

  try {
    // Step 1: Fetch course details to get name, cocount, and exammarks
    const courseResult = await pgPool.query(
      `SELECT name, cocount, exammarks FROM courses WHERE id = $1 AND isdraft = FALSE`,
      [courseId]
    );
    if (courseResult.rows.length === 0) {
      console.log(`Course ID ${courseId} not found or not published`);
      return res.status(404).json({ error: 'Course not found or not published' });
    }

    const course = courseResult.rows[0];
    const courseName = course.name;
    const coCount = course.cocount || 2; // Default to 2 COs
    const examMarks = course.exammarks || 100; // Total marks for the course
    console.log(`Course details: name=${courseName}, coCount=${coCount}, examMarks=${examMarks}`);

    // Step 2: Fetch all students who have taken the exam for this course, including abcId
    const studentResult = await pgPool.query(
      `SELECT DISTINCT s.id, s.name, s.registerNo, s.abcId
       FROM students s
       JOIN student_exams se ON s.id = se.studentid
       WHERE se.courseid = $1`,
      [courseId]
    );
    const students = studentResult.rows;
    console.log(`Students who took the exam for course ID ${courseId}:`, students);
    if (!students.length) {
      console.log(`No students have taken the exam for course ID ${courseId}`);
      return res.status(200).json({ error: 'No students have taken this exam yet' });
    }

    // Step 3: Fetch all student exams for this course
    const examResult = await pgPool.query(
      `SELECT se.studentid, se.questionid, se.selectedanswer, se.malpracticeflag, q.conumber, q.answer, q.weightage
       FROM student_exams se
       JOIN questions q ON se.questionid = q.id
       WHERE se.courseid = $1`,
      [courseId]
    );
    const studentExams = examResult.rows;
    console.log(`Student exams for course ID ${courseId}:`, studentExams);

    // Step 4: Fetch total possible marks per CO for accurate CO-wise percentages
    const coMaxMarks = {};
    for (let co = 1; co <= coCount; co++) {
      const coResult = await pgPool.query(
        `SELECT SUM(weightage) as maxmarks
         FROM questions
         WHERE courseid = $1 AND conumber = $2`,
        [courseId, `CO${co}`]
      );
      coMaxMarks[`CO${co}`] = coResult.rows[0]?.maxmarks || 0;
    }
    console.log(`Max marks per CO for course ID ${courseId}:`, coMaxMarks);

    // Step 5: Calculate results for each student who took the exam
    const results = await Promise.all(students.map(async (student, index) => {
      const studentId = student.id;
      const studentExamsForThisStudent = studentExams.filter(se => se.studentid === studentId);

      // Check if the student has any malpractice flag in their exam submissions
      const hasMalpractice = studentExamsForThisStudent.some(se => se.malpracticeflag);
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
        const coQuestions = studentExamsForThisStudent.filter(se => se.conumber === `CO${co}`);
        console.log(`Student ID ${studentId}, CO${co} questions:`, coQuestions);
        if (coQuestions.length === 0) {
          // If no questions answered for this CO, mark as 'A'
          coMarks[`co${co}Marks`] = 'A';
          coMarks[`co${co}Percentage`] = 'A';
        } else {
          let totalMarks = 0;
          coQuestions.forEach(q => {
            if (q.selectedanswer === q.answer) {
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
        if (se.selectedanswer === se.answer) {
          overallMarks += se.weightage;
        }
      });

      // Use examMarks for overall percentage
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
        console.error('Error sending Excel file:', err.message);
        res.status(500).json({ error: 'Failed to download the report' });
      }
      // Delete the file after sending
      fs.unlink(filePath, (unlinkErr) => {
        if (unlinkErr) console.error('Error deleting Excel file:', unlinkErr.message);
        else console.log(`Excel file deleted: ${filePath}`);
      });
    });
  } catch (error) {
    console.error('Error generating Excel report:', error.message);
    res.status(500).json({ error: 'Failed to generate the report' });
  }
});

module.exports = router;