// Runtime configuration. Point this at the Saathi backend (the one the Flutter app uses).
// The portal origin (e.g. http://localhost:5173) must be in the backend's CORS_ALLOWED_ORIGINS.
// Also set SAATHI_API_BASE_URL when starting server.js so the Content-Security-Policy allows this API origin.
window.SAATHI_CONFIG = { API_BASE_URL: 'http://localhost:3000/api', IDLE_TIMEOUT_MINUTES: 15 };
