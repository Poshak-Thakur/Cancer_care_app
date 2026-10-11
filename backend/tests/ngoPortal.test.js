/**
 * Endpoints requested by the NGO web portal (ngo_web).
 * Runs with:  node --test tests/*.test.js      (in-memory fake DB, see tests/helpers/harness.js)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
    fakeDb, call, reset, uuid, addUser, addNgo, addPatientWithOwner, addCaregiver, linkCaregiver,
    auditActions, adminController, chatController
} = require('./helpers/harness');
const { getISTDayRangeFromDateString } = require('../src/utils/timezoneHelper');

test.beforeEach(reset);

const read = (p) => fs.readFileSync(require.resolve(p), 'utf8');

// ---------------------------------------------------------------------------
// 0. routes are mounted behind the admin guard
// ---------------------------------------------------------------------------
test('P0. every new admin route sits behind authMiddleware + requireCentralCounsellor', () => {
    const routes = read('../src/routes/adminRoutes');
    const guardAt = routes.indexOf('router.use(requireCentralCounsellor)');
    assert.ok(routes.indexOf('router.use(authMiddleware)') < guardAt);
    for (const r of ["post('/patients/:id/claim-code'", "get('/documents'", "get('/care-events'", "patch('/medications/:id/verify'"]) {
        assert.ok(routes.includes(r), `missing ${r}`);
        assert.ok(routes.indexOf(r) > guardAt, `${r} must be after the guard`);
    }
});

const mkPatient = (name = 'Asha') => fakeDb.patient.create({ data: { full_name: name, date_of_birth: new Date('1970-01-01') } });

// ---------------------------------------------------------------------------
// 2. GET /api/admin/documents
// ---------------------------------------------------------------------------
const addDoc = (patientId, extra = {}) => fakeDb.medicaldocument.create({
    data: {
        patient_id: patientId, title: 'Report', document_type: 'LAB_REPORT', file_path: `private/${patientId}/${uuid()}.pdf`,
        mime_type: 'application/pdf', file_size_bytes: 10, is_private: true, uploaded_by: uuid(), uploaded_at: new Date(), ...extra
    }
});

test('R1. document queue: filter by status, oldest first, patient embedded, NEVER file_path, pagination', async () => {
    const ngo = await addNgo();
    const pa = await mkPatient('Anita'); const pb = await mkPatient('Bela');
    const d3 = await addDoc(pa.id, { title: 'newest', uploaded_at: new Date('2026-03-03T00:00:00Z') });
    const d1 = await addDoc(pb.id, { title: 'oldest', uploaded_at: new Date('2026-03-01T00:00:00Z') });
    const d2 = await addDoc(pa.id, { title: 'middle', uploaded_at: new Date('2026-03-02T00:00:00Z') });
    await addDoc(pa.id, { title: 'done', verification_status: 'VERIFIED', uploaded_at: new Date('2026-02-01T00:00:00Z') });

    const r = await call(adminController.listDocuments, { userId: ngo.id, query: { verification_status: 'PENDING' } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.data.map((d) => d.id), [d1.id, d2.id, d3.id]);
    assert.deepEqual(r.body.pagination, { page: 1, limit: 20, total: 3, total_pages: 1 });
    assert.deepEqual(Object.keys(r.body.data[0]).sort(), ['document_type', 'id', 'is_private', 'patient', 'title', 'uploaded_at', 'verification_status']);
    assert.deepEqual(r.body.data[0].patient, { id: pb.id, full_name: 'Bela' });
    const raw = JSON.stringify(r.body);
    assert.ok(!raw.includes('file_path') && !raw.includes('private/') && !raw.includes('extracted_text') && !raw.includes('raw_ocr'), 'no storage path or OCR text');

    const page2 = await call(adminController.listDocuments, { userId: ngo.id, query: { verification_status: 'PENDING', page: '2', limit: '2' } });
    assert.deepEqual(page2.body.data.map((d) => d.id), [d3.id]);
    assert.deepEqual(page2.body.pagination, { page: 2, limit: 2, total: 3, total_pages: 2 });

    const all = await call(adminController.listDocuments, { userId: ngo.id, query: {} });
    assert.equal(all.body.pagination.total, 4, 'no filter = every status');
    assert.equal((await call(adminController.listDocuments, { userId: ngo.id, query: { verification_status: 'BOGUS' } })).status, 400);
});

// ---------------------------------------------------------------------------
// 3. GET /api/admin/care-events
// ---------------------------------------------------------------------------
const addEvent = (patientId, scheduleTime, extra = {}) => fakeDb.careevent.create({
    data: { patient_id: patientId, type: 'APPOINTMENT', schedule_time: new Date(scheduleTime), ...extra }
});
const events = (ngo, query) => call(adminController.listCareEvents, { userId: ngo.id, query });

test('S1. overdue = SCHEDULED/DUE and in the past; ordered by schedule_time; patient + medication embedded', async () => {
    const ngo = await addNgo();
    const p = await mkPatient('Chitra');
    const med = await fakeDb.patientmedication.create({ data: { patient_id: p.id, name: 'Letrozole', entered_by: uuid() } });
    const past = Date.now() - 3600_000; const future = Date.now() + 3600_000;
    const overdueDue = await addEvent(p.id, past - 1000, { completion_status: 'DUE', patient_medication_id: med.id, type: 'MEDICATION_DOSE' });
    const overdueSched = await addEvent(p.id, past - 5000);
    await addEvent(p.id, past, { completion_status: 'COMPLETED' });
    await addEvent(p.id, past, { completion_status: 'MISSED' });
    await addEvent(p.id, past, { completion_status: 'SNOOZED' });
    const upcoming = await addEvent(p.id, future);

    const r = await events(ngo, { overdue: 'true' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.data.map((e) => e.id), [overdueSched.id, overdueDue.id], 'ascending by schedule_time');
    assert.deepEqual(r.body.data[1].patient, { id: p.id, full_name: 'Chitra' });
    assert.deepEqual(r.body.data[1].patientmedication, { name: 'Letrozole' });
    assert.equal(r.body.data[0].patientmedication, null);
    assert.ok('completion_status' in r.body.data[0] && 'schedule_time' in r.body.data[0], 'full careevent fields');
    assert.deepEqual(r.body.pagination, { page: 1, limit: 20, total: 2, total_pages: 1 });

    const notOverdue = await events(ngo, { overdue: 'false' });
    assert.equal(notOverdue.body.pagination.total, 4);
    assert.ok(notOverdue.body.data.some((e) => e.id === upcoming.id));
    assert.ok(!notOverdue.body.data.some((e) => e.id === overdueDue.id || e.id === overdueSched.id));
    assert.equal((await events(ngo, {})).body.pagination.total, 6, 'no filters = all');
});

test('S2. from / to are inclusive IST days', async () => {
    const ngo = await addNgo();
    const p = await mkPatient();
    // IST = UTC+5:30. 2026-03-10 in IST runs from 2026-03-09T18:30:00Z to 2026-03-10T18:29:59.999Z.
    const before = await addEvent(p.id, '2026-03-09T18:29:59.999Z');
    const first = await addEvent(p.id, '2026-03-09T18:30:00.000Z');
    const last = await addEvent(p.id, '2026-03-10T18:29:59.999Z');
    const after = await addEvent(p.id, '2026-03-10T18:30:00.000Z');
    const ids = async (query) => (await events(ngo, query)).body.data.map((e) => e.id);
    assert.deepEqual(await ids({ from: '2026-03-10', to: '2026-03-10' }), [first.id, last.id]);
    assert.deepEqual(await ids({ from: '2026-03-10' }), [first.id, last.id, after.id]);
    assert.deepEqual(await ids({ to: '2026-03-09' }), [before.id]);
    assert.ok(!(await ids({ from: '2026-03-10', to: '2026-03-10' })).includes(after.id));

    // and the helper itself does not depend on the server's timezone
    const range = getISTDayRangeFromDateString('2026-03-10');
    assert.equal(range.startOfDay.toISOString(), '2026-03-09T18:30:00.000Z');
    assert.equal(range.endOfDay.toISOString(), '2026-03-10T18:29:59.999Z');
});

test('S3. combined filters, pagination and validation', async () => {
    const ngo = await addNgo();
    const p = await mkPatient();
    for (let i = 0; i < 5; i += 1) await addEvent(p.id, Date.parse('2026-01-01T06:00:00Z') + i * 3600_000);
    const page = await events(ngo, { overdue: 'true', from: '2026-01-01', to: '2026-01-01', page: '2', limit: '2' });
    assert.equal(page.body.data.length, 2);
    assert.deepEqual(page.body.pagination, { page: 2, limit: 2, total: 5, total_pages: 3 });
    assert.ok(page.body.data[0].schedule_time < page.body.data[1].schedule_time);
    for (const query of [{ overdue: 'yes' }, { from: '2026-13-01' }, { from: '2026-02-30' }, { to: '10-03-2026' }, { from: '2026-03-10', to: '2026-03-09' }, { from: '2026-3-1' }]) {
        assert.equal((await events(ngo, query)).status, 400, JSON.stringify(query));
    }
});

// ---------------------------------------------------------------------------
// 4. GET /api/chat/conversations -> patient + unread_count
// ---------------------------------------------------------------------------
test('T1. conversations include patient and an unread_count from ONE grouped query', async () => {
    const ngo = await addNgo();
    const { owner, patient } = await addPatientWithOwner('Dina');
    const cg = await addCaregiver('cousin', { recognized: true });
    await linkCaregiver(patient.id, cg.user.id);
    const open = (userId, participant_id, patient_id) => call(chatController.openThread, { userId, body: { participant_id, ...(patient_id ? { patient_id } : {}) } });
    const c1 = (await open(owner.id, ngo.id, patient.id)).body.data;       // patient thread
    const c2 = (await open(owner.id, ngo.id)).body.data;                    // helpline, no patient
    const c3 = (await open(cg.user.id, ngo.id, patient.id)).body.data;      // somebody else's thread
    const msg = (conversation_id, sender_id, is_read = false) => fakeDb.chatmessage.create({ data: { conversation_id, sender_id, content: 'hi', message_type: 'TEXT', is_read } });
    await msg(c1.id, ngo.id); await msg(c1.id, ngo.id); await msg(c1.id, ngo.id, true);   // 2 unread for the owner
    await msg(c1.id, owner.id);                                                           // own message: never counts
    await msg(c2.id, owner.id);                                                           // nothing unread FOR the owner
    await msg(c3.id, ngo.id);                                                             // other people's conversation

    let groupByCalls = 0;
    const realGroupBy = fakeDb.chatmessage.groupBy;
    fakeDb.chatmessage.groupBy = async (args) => { groupByCalls += 1; return realGroupBy(args); };
    let r;
    try { r = await call(chatController.getConversations, { userId: owner.id }); } finally { fakeDb.chatmessage.groupBy = realGroupBy; }
    assert.equal(r.status, 200);
    assert.equal(groupByCalls, 1, 'one grouped query, not one per conversation');
    const byId = Object.fromEntries(r.body.data.map((c) => [c.id, c]));
    assert.deepEqual(Object.keys(byId).sort(), [c1.id, c2.id].sort(), 'only my conversations');
    assert.equal(byId[c1.id].unread_count, 2);
    assert.equal(byId[c2.id].unread_count, 0);
    assert.deepEqual(byId[c1.id].patient, { id: patient.id, full_name: 'Dina' });
    assert.equal(byId[c2.id].patient, null);

    // the NGO sees the mirror image: the owner's message is unread for the NGO
    const ngoView = await call(chatController.getConversations, { userId: ngo.id });
    const n = Object.fromEntries(ngoView.body.data.map((c) => [c.id, c.unread_count]));
    assert.equal(n[c1.id], 1);
    assert.equal(n[c2.id], 1);
    assert.equal(n[c3.id], 0, "the NGO's own message is not unread for the NGO");
});

test('T2. no conversations -> no grouped query and an empty list', async () => {
    const { owner } = await addPatientWithOwner();
    let calls = 0;
    const real = fakeDb.chatmessage.groupBy;
    fakeDb.chatmessage.groupBy = async (a) => { calls += 1; return real(a); };
    try {
        const r = await call(chatController.getConversations, { userId: owner.id });
        assert.deepEqual(r.body.data, []);
    } finally { fakeDb.chatmessage.groupBy = real; }
    assert.equal(calls, 0);
});

// ---------------------------------------------------------------------------
// 5/6. server.js + app.js hygiene
// ---------------------------------------------------------------------------
test('U1. Socket.io reuses getAllowedOrigins(); no ALLOWED_ORIGINS variable and no wildcard fallback', () => {
    // comments may mention the variable names; only code is checked
    const src = read('../src/server.js').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    assert.ok(src.includes("require('./config/cors')") && src.includes('getAllowedOrigins()'));
    assert.ok(!/process\.env\.ALLOWED_ORIGINS/.test(src) && !/(^|[^_A-Z])ALLOWED_ORIGINS/.test(src), 'the separate variable is gone');
    assert.ok(!/['"]\*['"]/.test(src), "no '*' fallback");
});

test('U2. the request logger prints req.path, never the query string', () => {
    const src = read('../src/app.js');
    assert.ok(src.includes('${req.path}'));
    assert.ok(!src.includes('req.url') && !src.includes('req.originalUrl'));
});

// ---------------------------------------------------------------------------
// 7. PATCH /api/admin/medications/:id/verify
// ---------------------------------------------------------------------------
test('V1. medication verification records who/when and is audited; PENDING clears it; bad input is rejected', async () => {
    const ngo = await addNgo();
    const p = await mkPatient();
    const med = await fakeDb.patientmedication.create({ data: { patient_id: p.id, name: 'Tamoxifen', entered_by: uuid() } });
    const verify = (id, verification_status) => call(adminController.verifyMedication, { userId: ngo.id, params: { id }, body: { verification_status } });

    const ok = await verify(med.id, 'VERIFIED');
    assert.equal(ok.status, 200);
    assert.equal(med.verification_status, 'VERIFIED');
    assert.equal(med.verified_by, ngo.id);
    assert.ok(med.verified_at instanceof Date);
    const entry = fakeDb.auditlogentry._rows().find((a) => a.action === 'MEDICATION_VERIFICATION_CHANGED');
    assert.deepEqual([entry.target_resource, entry.target_id, entry.payload.from, entry.payload.to, entry.payload.patient_id], ['patientmedication', med.id, 'PENDING', 'VERIFIED', p.id]);

    await verify(med.id, 'VERIFIED');
    assert.equal(fakeDb.auditlogentry._rows().filter((a) => a.action === 'MEDICATION_VERIFICATION_CHANGED').length, 1, 'no audit when nothing changed');
    await verify(med.id, 'PENDING');
    assert.equal(med.verified_by, null);
    assert.equal(med.verified_at, null);
    assert.equal((await verify(med.id, 'MAYBE')).status, 400);
    assert.equal((await verify('nope', 'VERIFIED')).status, 400);
    assert.equal((await verify(uuid(), 'VERIFIED')).status, 404);
});
