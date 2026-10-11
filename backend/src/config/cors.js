/**
 * CORS ALLOWLIST (credentialed requests -> NEVER a wildcard)
 * ------------------------------------------------------------------
 * Origins come from the environment:
 *
 *   CORS_ALLOWED_ORIGINS=https://ngo.saathi.org,https://admin.saathi.org,http://localhost:5173
 *
 * Comma separated, exact origins (scheme + host + port, no path, no trailing slash).
 * If it is not set, a safe default is used:
 *   production  -> the deployed NGO website domains below
 *   otherwise   -> the usual local dev-server origins below
 * Set CORS_ALLOWED_ORIGINS to the real values for your deployment (it replaces the defaults).
 *
 * Requests WITHOUT an Origin header (the Flutter app, curl, server-to-server) are not browser CORS
 * requests and are always let through. A browser request from an origin that is not listed simply
 * gets no CORS headers and is blocked by the browser.
 */

const DEFAULT_PRODUCTION_ORIGINS = ['https://admin.saathi.org', 'https://ngo.saathi.org'];
const DEFAULT_DEVELOPMENT_ORIGINS = [
    'http://localhost:5173', 'http://127.0.0.1:5173',   // Vite
    'http://localhost:3000', 'http://127.0.0.1:3000'    // CRA / Next
];

const normalizeOrigin = (value) => String(value).trim().replace(/\/+$/, '');

const getAllowedOrigins = (env = process.env) => {
    const configured = (env.CORS_ALLOWED_ORIGINS || '')
        .split(',').map(normalizeOrigin).filter(Boolean);
    const wildcard = configured.includes('*');
    const list = configured.filter((o) => o !== '*');
    if (wildcard) console.warn('[CORS] "*" in CORS_ALLOWED_ORIGINS is ignored: credentialed requests need explicit origins.');
    if (list.length > 0) return list;
    return env.NODE_ENV === 'production' ? DEFAULT_PRODUCTION_ORIGINS : DEFAULT_DEVELOPMENT_ORIGINS;
};

const createCorsOptions = (env = process.env) => {
    const allowed = new Set(getAllowedOrigins(env));
    return {
        origin: (origin, callback) => {
            if (!origin) return callback(null, true);
            return callback(null, allowed.has(normalizeOrigin(origin)));
        },
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Authorization', 'Content-Type'],
        credentials: true,
        maxAge: 600
    };
};

module.exports = { createCorsOptions, getAllowedOrigins, DEFAULT_PRODUCTION_ORIGINS, DEFAULT_DEVELOPMENT_ORIGINS };
