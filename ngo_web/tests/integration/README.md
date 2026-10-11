# Integration run (portal code <-> real backend code)

`portal-e2e.js` loads the real `public/*.js` into jsdom and sends real HTTP requests to the real backend Express app
(routes, middleware, controllers, services). The database is the backend's in-memory test harness, **not PostgreSQL**.

## Run
```
# 1. backend dependencies (once) in the backend repo
cd <backend> && npm install
# 2. portal test dependency (once)
cd <portal> && npm install
# 3. run
BACKEND_DIR=<backend> npm run test:integration
```
`make-patched-harness.js` writes `tests/helpers/harness.patched.js` into the backend (a copy of the harness with extra tables); nothing else in the backend is touched. The rig listens on port 3000.
Fixtures (`seed.js`) are test-only and live outside `public/`; the portal never ships or falls back to them.
Results are written to `e2e-results.json`.
