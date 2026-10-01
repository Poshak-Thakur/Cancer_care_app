const app = require('./app');
// require('dotenv').config(); // Uncomment once dotenv is set up

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
  console.log(`Saathi API is running on port ${PORT}`);
});

// Graceful error handling for unhandled promise rejections
process.on('unhandledRejection', (err, promise) => {
  console.log(`Error: ${err.message}`);
  server.close(() => process.exit(1));
});