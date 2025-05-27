const multer = require('multer');
const path = require('path');

// Custom middleware to enforce dynamic file size limits
const checkFileSize = (req, file, cb) => {
  const maxSize = ['image/jpeg', 'image/png'].includes(file.mimetype)
    ? 1024 * 1024 // 1MB for images
    : 5 * 1024 * 1024; // 5MB for CSV/Excel
  if (file.size > maxSize) {
    return cb(new Error(`File size exceeds limit (${maxSize / (1024 * 1024)}MB)`), false);
  }
  cb(null, true);
};

// Set storage destination and filename
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'Uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `${file.fieldname}-${uniqueSuffix}${path.extname(file.originalname)}`);
  },
});

// File filter for images and CSV/Excel files
const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    'image/jpeg',
    'image/png',
    'text/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ];
  const ext = path.extname(file.originalname).toLowerCase();
  const mimeType = file.mimetype;

  if (allowedTypes.includes(mimeType) || ['.csv', '.xlsx', '.xls'].includes(ext)) {
    checkFileSize(req, file, cb);
  } else {
    cb(new Error('Only JPEG, PNG, CSV, XLSX, and XLS files are allowed'), false);
  }
};

// Multer configuration for multiple fields
const upload = multer({
  storage,
  fileFilter,
}).fields([
  { name: 'file', maxCount: 1 }, // For CSV/Excel bulk uploads
  { name: 'photo', maxCount: 1 }, // For student photo
  { name: 'eSignature', maxCount: 1 }, // For student eSignature
  { name: 'questionImage', maxCount: 1 },
  { name: 'option1Image', maxCount: 1 },
  { name: 'option2Image', maxCount: 1 },
  { name: 'option3Image', maxCount: 1 },
  { name: 'option4Image', maxCount: 1 },
]);

module.exports = upload;