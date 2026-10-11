# Saathi NGO Counsellor Portal (web client)

A static client for the **existing Saathi backend** (the one the Flutter app uses). It has **no mock API, no database and no seeded data**; if a request fails it shows the backend's message and a Try again button, never substitute content.

* Setup, ports, env variables, CORS: [docs/SETUP.md](docs/SETUP.md)
* Session / token security design: [docs/SESSION_SECURITY.md](docs/SESSION_SECURITY.md)
* Page-by-page API contract: [docs/API_CONTRACT_CHECKLIST.md](docs/API_CONTRACT_CHECKLIST.md)
* Integration evidence: [docs/INTEGRATION_EVIDENCE.md](docs/INTEGRATION_EVIDENCE.md)

Quick start: `npm install && SAATHI_API_BASE_URL=http://localhost:3000/api npm start` → http://localhost:5173 (backend `CORS_ALLOWED_ORIGINS=http://localhost:5173`).

Sign-in is email OTP; only the central NGO counsellor account is admitted.

## Backend endpoints used (backend-updated6)
| Feature | Endpoint |
|---|---|
| Patient app code | `POST /api/admin/patients/:id/claim-code` → `{ code, expires_at }` (shown once) |
| Document review queue | `GET /api/admin/documents?verification_status=PENDING` (server-side paginated; a 404 shows a clear error, no scanning) |
| Care events / overdue | `GET /api/admin/care-events?overdue=true&from&to` (server-side paginated) |
| Medication verification | `PATCH /api/admin/medications/:id/verify` |
| Chat unread + patient name | `unread_count`, `patient{full_name}` on `GET /api/chat/conversations` |

## Patient onboarding (NGO side)
1. Create the patient record (name + date of birth).
2. Open the patient → "Patient app code" → Generate code → give it to the patient.
3. The patient chooses "I have a code from Saathi" in the app and signs in with their own email. The registered email then appears in the Care circle.
Patients who sign up without a code create their own record; the patient list flags records with the same name and date of birth as "Possible duplicate".
