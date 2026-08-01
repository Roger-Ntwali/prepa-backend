require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const routes = require('./routes');
const verifyUploadSignature = require('./middleware/verifyUploadSignature');

const app = express();

// Safety net: without this, an unhandled async error ANYWHERE in the app
// (e.g. a dropped database connection mid-query) crashes the entire Node
// process — taking the server offline for every user, not just the one
// request that failed. Logging and continuing is far better for a server
// that needs to stay up; the individual failing request still gets its
// own error response from the route/controller that threw.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection (server stays up):', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception (server stays up):', err);
});

app.use(helmet());
// X-Total-Count carries pagination totals for topics/questions/quizzes (see
// their controllers) -- without exposedHeaders, browsers strip any header
// that isn't on the CORS safelist from what fetch()'s Response.headers can
// read cross-origin, even though it's plainly visible in curl/devtools.
app.use(cors({ exposedHeaders: ['X-Total-Count'] }));
app.use(express.json());
if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));

// Serves uploaded past-paper PDFs (and any other static assets) directly —
// e.g. a file at uploads/foo.pdf is reachable at /uploads/foo.pdf. Every
// request needs a short-lived signature (see verifyUploadSignature) minted
// by GET /api/v1/past-papers/:id/download-url — this route itself accepts
// no session/bearer auth, since browsers and external PDF viewers navigate
// here directly and never attach an Authorization header.
app.use('/uploads', verifyUploadSignature, express.static(path.join(__dirname, '..', 'uploads')));

app.use('/api/v1', routes);

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err && (err.code === 'LIMIT_FILE_SIZE' || err.message === 'Only PDF files are accepted')) {
    return res.status(400).json({ error: err.message === 'Only PDF files are accepted' ? err.message : 'File is too large (15MB max)' });
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
