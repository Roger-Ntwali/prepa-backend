require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const routes = require('./routes');

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
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// Serves uploaded past-paper PDFs (and any other static assets) directly —
// e.g. a file at uploads/foo.pdf is reachable at /uploads/foo.pdf.
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

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

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`PREPA backend listening on port ${PORT}`);
});
