// Static file server ONLY. No API, no database, no auth, no seeded data.
// All clinical data comes from the Saathi backend configured in public/config.js (or SAATHI_API_BASE_URL).
// You may instead deploy ./public to any static host; set the same headers there (see docs/SETUP.md).
const express = require('express'), path = require('path');
const app = express(), PORT = Number(process.env.PORT) || 5173;
const API = (process.env.SAATHI_API_BASE_URL || '').replace(/\/+$/, '');
let apiOrigin = '';
try { if (API) apiOrigin = new URL(API).origin; } catch { console.error('SAATHI_API_BASE_URL is not a valid URL'); process.exit(1); }

app.disable('x-powered-by');
app.use((req, res, next) => {
  // connect-src lists the ONLY origin the page may send requests to: the Saathi backend.
  const connect = ["'self'", apiOrigin || 'http://localhost:3000'].join(' ');
  res.set({
    'Content-Security-Policy': [
      "default-src 'self'", "base-uri 'none'", "object-src 'none'", "frame-ancestors 'none'", "form-action 'none'",
      "script-src 'self'", "script-src-attr 'unsafe-inline'",          // inline handlers are limited to validated ids (see docs/SESSION_SECURITY.md)
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", "font-src https://fonts.gstatic.com",
      "img-src 'self' data: https:", "media-src https:", `connect-src ${connect}`
    ].join('; '),
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()', 'Cache-Control': 'no-store'
  });
  next();
});
// Runtime config without editing files: SAATHI_API_BASE_URL (+ optional IDLE_TIMEOUT_MINUTES).
app.get('/config.js', (req, res, next) => {
  if (!API) return next();
  res.type('js').send('window.SAATHI_CONFIG=' + JSON.stringify({ API_BASE_URL: API, IDLE_TIMEOUT_MINUTES: Number(process.env.IDLE_TIMEOUT_MINUTES) || 15 }) + ';');
});
app.use(express.static(path.join(__dirname, 'public')));
app.listen(PORT, () => console.log(`Saathi NGO Portal (static) at http://localhost:${PORT}  ->  API ${API || '(public/config.js)'}`));
