const express = require('express');
const cors = require('cors');
const authRoutes = require('./routes/authRoutes');
const patientRoutes = require('./routes/patientRoutes');
const careEventRoutes = require('./routes/careEventRoutes');
const documentRoutes = require('./routes/documentRoutes');
const symptomRoutes = require('./routes/symptomRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');

const app = express();

app.use(cors());
app.use(express.json());
app.use('/api/patients', patientRoutes);
app.use(express.urlencoded({ extended: true }));

// Feature Routes
app.use('/api/auth', authRoutes);
app.use('/api/care-events', careEventRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/symptoms', symptomRoutes);
app.use('/api/dashboard', dashboardRoutes);






app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'success', message: 'Saathi API is running' });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ status: 'error', message: 'Internal Server Error' });
});

module.exports = app;