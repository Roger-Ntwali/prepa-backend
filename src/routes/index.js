const express = require('express');
const router = express.Router();

const { requireAuth, requireRole } = require('../middleware/auth');
const authController = require('../controllers/authController');
const topicsController = require('../controllers/topicsController');
const questionsController = require('../controllers/questionsController');
const quizzesController = require('../controllers/quizzesController');
const attemptsController = require('../controllers/attemptsController');
const aiTutorController = require('../controllers/aiTutorController');
const syncController = require('../controllers/syncController');
const usersController = require('../controllers/usersController');
const reportsController = require('../controllers/reportsController');
const pastPapersController = require('../controllers/pastPapersController');
const upload = require('../middleware/upload');
const pdfImportController = require('../controllers/pdfImportController');

// Health check
router.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// Sync (offline-first full pull/push — the app calls this right after login)
router.get('/sync/pull', requireAuth, syncController.pull);
router.post('/sync/push', requireAuth, syncController.push);

// Past papers — anyone signed in can view/download; only admin can add one
// (teachers can add questions and quizzes, but not upload exam papers).
router.get('/past-papers', requireAuth, pastPapersController.listPastPapers);
router.post('/past-papers', requireAuth, requireRole('admin'), pastPapersController.createPastPaper);

// User management — admin only (approve/reject teacher accounts).
router.get('/users/pending-teachers', requireAuth, requireRole('admin'), usersController.listPendingTeachers);
router.patch('/users/:id/approve', requireAuth, requireRole('admin'), usersController.approveTeacher);
router.delete('/users/:id/reject', requireAuth, requireRole('admin'), usersController.rejectTeacher);
// Student list/overview — admin and teacher both need this for the dashboard.
router.get('/users/students', requireAuth, requireRole('teacher', 'admin'), usersController.listStudents);

// Reports — per-student performance detail, for admin + teacher dashboard.
router.get('/reports/students/:id', requireAuth, requireRole('teacher', 'admin'), reportsController.studentDetail);

// Auth
router.post('/auth/register', authController.register);
router.post('/auth/login', authController.login);

// Topics
router.get('/topics', requireAuth, topicsController.listTopics);
router.post('/topics', requireAuth, requireRole('teacher', 'admin'), topicsController.createTopic);

// Questions
router.get('/questions', requireAuth, questionsController.listQuestions);
router.get('/questions/export', requireAuth, questionsController.exportBank); // offline bulk sync
router.post('/questions/generate', requireAuth, requireRole('teacher', 'admin'), questionsController.generateAnswer);
router.post('/questions', requireAuth, requireRole('teacher', 'admin'), questionsController.createQuestion);
// Teacher/admin uploads a PDF; AI extracts questions and converts them into
// the app's MCQ format, straight into the question bank.
router.post('/questions/import-pdf', requireAuth, requireRole('teacher', 'admin'), upload.single('file'), pdfImportController.importPdf);

// Quizzes
router.get('/quizzes', requireAuth, quizzesController.listQuizzes);
router.post('/quizzes', requireAuth, requireRole('teacher', 'admin'), quizzesController.createQuiz);
router.get('/quizzes/:id', requireAuth, quizzesController.getQuiz);
router.get('/quizzes/practice/adaptive', requireAuth, requireRole('student'), quizzesController.adaptiveSet);

// Attempts (offline sync)
router.post('/attempts/sync', requireAuth, requireRole('student'), attemptsController.syncAttempts);
router.get('/attempts/mine', requireAuth, requireRole('student'), attemptsController.myAttempts);

// AI Tutor (online-only)
router.post('/ai-tutor/ask', requireAuth, requireRole('student'), aiTutorController.ask);
// The mobile app's ApiClient actually calls this path — keep both so
// nothing that already depends on /ai-tutor/ask breaks.
router.post('/ai/tutor', requireAuth, requireRole('student'), aiTutorController.ask);

module.exports = router;
