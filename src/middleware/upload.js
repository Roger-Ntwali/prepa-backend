const multer = require('multer');

// Kept in memory (not written to disk) — we only need the buffer briefly
// to extract text, then the questions themselves are what gets stored.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB is plenty for an exam paper
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== 'application/pdf') {
      return cb(new Error('Only PDF files are accepted'));
    }
    cb(null, true);
  },
});

module.exports = upload;
