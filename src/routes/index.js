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
const { authLimiter, aiTutorLimiter, aiAuthoringLimiter } = require('../middleware/rateLimit');
const { validate } = require('../middleware/validate');
const v = require('../middleware/validators');

// Health check
router.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// Sync (offline-first full pull/push — the app calls this right after login)
router.get('/sync/pull', requireAuth, syncController.pull);
router.post('/sync/push', requireAuth, syncController.push);

// Past papers — anyone signed in can view/download; only admin can add one
// (teachers can add questions and quizzes, but not upload exam papers).
router.get('/past-papers', requireAuth, pastPapersController.listPastPapers);
// multer runs before the validator, same reasoning as import-pdf below --
// it's what parses title/year/term/topic_id out of the multipart body
// when a file is attached.
router.post('/past-papers', requireAuth, requireRole('admin'), upload.single('file'), v.createPastPaper, validate, pastPapersController.createPastPaper);
router.delete('/past-papers/:id', requireAuth, requireRole('admin'), v.idParam, validate, pastPapersController.deletePastPaper);
router.get('/past-papers/:id/download-url', requireAuth, v.idParam, validate, pastPapersController.getDownloadUrl);

// User management — admin only (approve/reject teacher accounts).
router.get('/users/pending-teachers', requireAuth, requireRole('admin'), usersController.listPendingTeachers);
router.patch('/users/:id/approve', requireAuth, requireRole('admin'), v.idParam, validate, usersController.approveTeacher);
router.delete('/users/:id/reject', requireAuth, requireRole('admin'), v.idParam, validate, usersController.rejectTeacher);
// Student list/overview — admin and teacher both need this for the dashboard.
router.get('/users/students', requireAuth, requireRole('teacher', 'admin'), usersController.listStudents);

// Reports — per-student performance detail, for admin + teacher dashboard.
router.get('/reports/class-summary', requireAuth, requireRole('teacher', 'admin'), reportsController.classSummary);
router.get('/reports/students/:id', requireAuth, requireRole('teacher', 'admin'), v.idParam, validate, reportsController.studentDetail);

// Auth
router.post('/auth/register', authLimiter, v.register, validate, authController.register);
router.post('/auth/login', authLimiter, v.login, validate, authController.login);

// Topics
router.get('/topics', requireAuth, topicsController.listTopics);
router.post('/topics', requireAuth, requireRole('teacher', 'admin'), v.createTopic, validate, topicsController.createTopic);
router.patch('/topics/:id', requireAuth, requireRole('teacher', 'admin'), v.idParam, v.updateTopic, validate, topicsController.updateTopic);

// Questions
router.get('/questions', requireAuth, v.listQuestionsQuery, validate, questionsController.listQuestions);
router.get('/questions/export', requireAuth, questionsController.exportBank); // offline bulk sync
router.post('/questions/generate', requireAuth, requireRole('teacher', 'admin'), aiAuthoringLimiter, v.generateAnswer, validate, questionsController.generateAnswer);
router.post('/questions', requireAuth, requireRole('teacher', 'admin'), v.createQuestion, validate, questionsController.createQuestion);
// Teacher/admin uploads a PDF; AI extracts questions and converts them into
// the app's MCQ format, straight into the question bank. multer must run
// before the validator here -- it's what parses paper_title/paper_year
// out of the multipart body in the first place.
router.post('/questions/import-pdf', requireAuth, requireRole('teacher', 'admin'), aiAuthoringLimiter, upload.single('file'), v.importPdfMeta, validate, pdfImportController.importPdf);
// Single-question raw fetch, for the portal's edit form to pre-fill from
// (see questionsController.getQuestion for why this differs from the list
// endpoint's shape). Teacher/admin only, like the rest of the authoring
// surface -- not something the student app or a public reader needs.
router.get('/questions/:id', requireAuth, requireRole('teacher', 'admin'), v.idParam, validate, questionsController.getQuestion);
router.patch('/questions/:id', requireAuth, requireRole('teacher', 'admin'), v.idParam, v.updateQuestion, validate, questionsController.updateQuestion);
// Removal is archive-or-delete depending on whether students have answered
// the question — the controller decides. See questionsController.
router.delete('/questions/:id', requireAuth, requireRole('teacher', 'admin'), v.idParam, validate, questionsController.deleteQuestion);
router.patch('/questions/:id/restore', requireAuth, requireRole('teacher', 'admin'), v.idParam, validate, questionsController.restoreQuestion);

// Quizzes
router.get('/quizzes', requireAuth, quizzesController.listQuizzes);
router.post('/quizzes', requireAuth, requireRole('teacher', 'admin'), v.createQuiz, validate, quizzesController.createQuiz);
router.get('/quizzes/:id', requireAuth, v.idParam, validate, quizzesController.getQuiz);
router.patch('/quizzes/:id', requireAuth, requireRole('teacher', 'admin'), v.idParam, v.updateQuiz, validate, quizzesController.updateQuiz);
router.get('/quizzes/practice/adaptive', requireAuth, requireRole('student'), quizzesController.adaptiveSet);
router.delete('/quizzes/:id', requireAuth, requireRole('teacher', 'admin'), v.idParam, validate, quizzesController.deleteQuiz);

// Attempts (offline sync)
router.post('/attempts/sync', requireAuth, requireRole('student'), v.syncAttempts, validate, attemptsController.syncAttempts);
router.get('/attempts/mine', requireAuth, requireRole('student'), attemptsController.myAttempts);

// AI Tutor (online-only). 20/hour/student matches the limit the mobile
// client's own doc comments already assume (lib/repositories/ai_tutor_repository.dart).
router.post('/ai-tutor/ask', requireAuth, requireRole('student'), aiTutorLimiter, aiTutorController.ask);
// The mobile app's ApiClient actually calls this path — keep both so
// nothing that already depends on /ai-tutor/ask breaks.
router.post('/ai/tutor', requireAuth, requireRole('student'), aiTutorLimiter, aiTutorController.ask);

module.exports = router;
