const express = require('express');
const cors = require('cors');
require('./config/firebase');

const authRoutes = require('./routes/authRoutes');
const patientRoutes = require('./routes/patientRoutes');
const careEventRoutes = require('./routes/careEventRoutes');
const documentRoutes = require('./routes/documentRoutes');
const symptomRoutes = require('./routes/symptomRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const caregiverRoutes = require('./routes/caregiverRoutes');
const communityRoutes = require('./routes/communityRoutes');
const chatRoutes = require('./routes/chatRoutes');
const callRoutes = require('./routes/callRoutes');
const adminRoutes = require('./routes/adminRoutes');
const HttpError = require('./utils/httpError');

const app = express();

app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://admin.saathi.org', 'https://ngo.saathi.org'] 
    : '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
    console.log(`[${req.method}] ${req.url}`);
    next();
});

app.use('/api/auth', authRoutes);
app.use('/api/patients', patientRoutes);
app.use('/api/care-events', careEventRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/symptoms', symptomRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/caregivers', caregiverRoutes);
app.use('/api/community', communityRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/calls', callRoutes);
app.use('/api/admin', adminRoutes);

app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'success', message: 'Saathi API is running' });
});

app.use((err, req, res, next) => {
  // Deliberate client errors (e.g. thrown inside a transaction so it rolls back)
  if (err instanceof HttpError) {
    return res.status(err.status).json({ status: 'error', message: err.message, ...(err.code ? { code: err.code } : {}) });
  }
  // Upload limits (file too large, too many files, unexpected field)
  if (err && err.name === 'MulterError') {
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'File is too large.'
      : err.code === 'LIMIT_UNEXPECTED_FILE' ? 'Too many files, or an unexpected file field.'
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
