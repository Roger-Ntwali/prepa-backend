const { body, param, query } = require('express-validator');

// One chain per route. Field-presence checks mirror what each controller
// already assumed informally; this adds the type/format/length checking
// that was missing entirely (express-validator was a declared dependency
// with no actual validators anywhere in the codebase before this file).
//
// .withMessage() only attaches to the validator immediately before it in
// the chain, not the whole chain -- every check below carries its own
// message (with .bail() in between) so a missing field never falls
// through to express-validator's generic "Invalid value".

const requiredString = (field, label) =>
  body(field)
    .exists({ checkFalsy: true }).withMessage(`${label || field} is required`).bail()
    .isString().withMessage(`${label || field} must be text`).bail()
    .trim();

const register = [
  body().custom((_, { req }) => {
    if (!(req.body.full_name || req.body.name)) {
      throw new Error('full_name (or name) is required');
    }
    return true;
  }),
  body().custom((_, { req }) => {
    if (!(req.body.email || req.body.username)) {
      throw new Error('email or username is required');
    }
    return true;
  }),
  body('email').optional({ values: 'falsy' }).isEmail().withMessage('email must be a valid email address'),
  body('username').optional({ values: 'falsy' }).isString().withMessage('username must be text').bail()
    .isLength({ min: 3 }).withMessage('username must be at least 3 characters'),
  requiredString('password', 'password').bail()
    .isLength({ min: 6 }).withMessage('password must be at least 6 characters'),
  body('role').exists().withMessage('role is required').bail()
    .isIn(['student', 'teacher', 'admin']).withMessage('role must be student, teacher, or admin'),
];

const login = [
  body().custom((_, { req }) => {
    if (!(req.body.identifier || req.body.email)) {
      throw new Error('identifier (or email) is required');
    }
    return true;
  }),
  body('password').notEmpty().withMessage('password is required'),
];

const useResetCode = [
  body('email').isEmail().withMessage('email must be a valid email address'),
  body('code').exists().withMessage('code is required').bail()
    .isLength({ min: 6, max: 6 }).withMessage('code must be 6 digits').bail()
    .isNumeric().withMessage('code must be numeric'),
  body('new_password').exists().withMessage('new_password is required').bail()
    .isLength({ min: 6 }).withMessage('new_password must be at least 6 characters'),
];

const createTopic = [
  requiredString('title', 'title'),
  body('description').optional({ values: 'falsy' }).isString().withMessage('description must be text'),
  body('order_index').optional().isInt().withMessage('order_index must be a whole number'),
];

const createQuestion = [
  requiredString('question_text', 'question_text'),
  requiredString('correct_answer', 'correct_answer'),
  body('topic_id').optional({ values: 'falsy' }).isUUID().withMessage('topic_id must be a valid id'),
  body('past_paper_id').optional({ values: 'falsy' }).isUUID().withMessage('past_paper_id must be a valid id'),
  body('question_type').optional().isIn(['mcq', 'short_answer', 'structured']).withMessage('question_type is invalid'),
  body('difficulty').optional().isInt({ min: 1, max: 3 }).withMessage('difficulty must be between 1 and 3'),
];

// Same shape as createQuestion -- the portal's edit form resubmits every
// field (not a partial patch), so this validates identically.
const updateQuestion = createQuestion;

const updateTopic = createTopic;

const generateAnswer = [
  requiredString('question_text', 'question_text'),
  body('topic_title').optional().isString().withMessage('topic_title must be text'),
];

const importPdfMeta = [
  body('paper_year').optional({ values: 'falsy' }).isInt({ min: 2000, max: 2100 }).withMessage('paper_year must be a valid year'),
];

const createQuiz = [
  requiredString('title', 'title'),
  body('topic_id').optional({ values: 'falsy' }).isUUID().withMessage('topic_id must be a valid id'),
  body('is_adaptive').optional().isBoolean().withMessage('is_adaptive must be true or false'),
  body('question_ids').isArray({ min: 1 }).withMessage('question_ids must be a non-empty array'),
  body('question_ids.*').isUUID().withMessage('question_ids must all be valid ids'),
];

// Editing a quiz only covers title/topic (not which questions it
// contains), so this doesn't require question_ids like createQuiz does.
const updateQuiz = [
  requiredString('title', 'title'),
  body('topic_id').optional({ values: 'falsy' }).isUUID().withMessage('topic_id must be a valid id'),
];

const createPastPaper = [
  requiredString('title', 'title'),
  body('year').exists().withMessage('year is required').bail()
    .isInt({ min: 2000, max: 2100 }).withMessage('year must be a valid year'),
  body('term').optional({ values: 'falsy' }).isString().withMessage('term must be text'),
  body('topic_id').optional({ values: 'falsy' }).isUUID().withMessage('topic_id must be a valid id'),
  body('file_url').optional({ values: 'falsy' }).isString().withMessage('file_url must be text'),
];

const idParam = param('id').isUUID().withMessage('id must be a valid id');

const listQuestionsQuery = [
  query('topic_id').optional({ values: 'falsy' }).isUUID().withMessage('topic_id must be a valid id'),
  query('past_paper_id').optional({ values: 'falsy' }).isUUID().withMessage('past_paper_id must be a valid id'),
];

const syncAttempts = [
  body('attempts').isArray({ min: 1 }).withMessage('attempts must be a non-empty array'),
  body('attempts.*.question_id').isUUID().withMessage('each attempt needs a valid question_id'),
];

module.exports = {
  register,
  login,
  useResetCode,
  createTopic,
  createQuestion,
  updateQuestion,
  updateTopic,
  updateQuiz,
  generateAnswer,
  importPdfMeta,
  createQuiz,
  createPastPaper,
  idParam,
  listQuestionsQuery,
  syncAttempts,
};
