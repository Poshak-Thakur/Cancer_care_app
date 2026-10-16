const express = require('express');
const cors = require('cors');
require('./config/firebase');

const authRoutes = require('./routes/authRoutes');
const patientRoutes = require('./routes/patientRoutes');
const careEventRoutes = require('./routes/careEventRoutes');
const documentRoutes = require('./routes/documentRoutes');
const symptomRoutes = require('./routes/symptomRoutes');
const checkInFormRoutes = require('./routes/checkInFormRoutes');
const { createCorsOptions } = require('./config/cors');
const dashboardRoutes = require('./routes/dashboardRoutes');
const caregiverRoutes = require('./routes/caregiverRoutes');
const communityRoutes = require('./routes/communityRoutes');
const chatRoutes = require('./routes/chatRoutes');
const callRoutes = require('./routes/callRoutes');
const adminRoutes = require('./routes/adminRoutes');
const alertRoutes = require('./routes/alertRoutes');
const HttpError = require('./utils/httpError');

const app = express();

// Explicit, environment-configured origin allowlist (CORS_ALLOWED_ORIGINS) - never '*' with credentials.
app.use(cors(createCorsOptions()));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  // req.path only: the query string can carry personal data (e.g. ?search=<patient name>).
  console.log(`[${req.method}] ${req.path}`);
  next();
});

app.use('/api/auth', authRoutes);
app.use('/api/patients', patientRoutes);
app.use('/api/care-events', careEventRoutes);
app.use('/api/documents', documentRoutes);
// Published check-in form for Flutter (GET /api/symptoms/check-in/form); must not be shadowed by symptomRoutes.
app.use('/api/symptoms/check-in', checkInFormRoutes);
app.use('/api/symptoms', symptomRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/caregivers', caregiverRoutes);
app.use('/api/community', communityRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/calls', callRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/alerts', alertRoutes);

app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'success',
    app_name: 'Dost - The cancer care companion',
    message: 'Dost API is running',
  });
});

app.use((err, req, res, next) => {
  // Deliberate client errors (e.g. thrown inside a transaction so it rolls back)
  if (err instanceof HttpError) {
    return res.status(err.status).json({
      status: 'error',
      message: err.message,
      ...(err.code ? { code: err.code } : {}),
      ...(err.errors ? { errors: err.errors } : {}),
    });
  }
  // Upload limits (file too large, too many files, unexpected field)
  if (err && err.name === 'MulterError') {
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    const message =
      err.code === 'LIMIT_FILE_SIZE'
        ? 'File is too large.'
        : err.code === 'LIMIT_UNEXPECTED_FILE'
          ? 'Too many files, or an unexpected file field.'
          : `Upload error: ${err.message}`;
    return res.status(status).json({ status: 'error', message });
  }
  // Malformed JSON body
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ status: 'error', message: 'Malformed JSON body.' });
  }
  console.error(err.stack);
  res.status(500).json({ status: 'error', message: 'Internal Server Error' });
});

module.exports = app;