/**
 * NGO web + Help Now regression tests.
 * Runs with:  node --test tests/      (in-memory fake DB, see tests/helpers/harness.js)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
    fakeDb, storage, call, reset, uuid, srcPath, addUser, addNgo, addPatientWithOwner, addCaregiver, linkCaregiver, addInvite,
    auditActions, authz, adminController, caseNoteController, documentController, communityController, alertController,
    caregiverController, patientController, rbac, SCOPES, whenNotificationsSettled
} = require('./helpers/harness');

test.beforeEach(reset);

const lastAudit = (action) => fakeDb.auditlogentry._rows().filter((a) => a.action === action).pop();

// ---------------------------------------------------------------------------
// Access control
// ---------------------------------------------------------------------------
test('A1. only the central NGO authority passes the admin guard', async () => {
    const ngo = await addNgo();
    const caregiver = await addCaregiver('cg', { recognized: true });
    const owner = (await addPatientWithOwner()).owner;
    const run = async (userId) => {
        let nexted = false; let status = null;
        const res = { status(c) { status = c; return this; }, json() { return this; } };
        await rbac.requireCentralCounsellor({ user: { userId } }, res, () => { nexted = true; });
        return { nexted, status };
    };
    assert.deepEqual(await run(ngo.id), { nexted: true, status: null });
    for (const u of [caregiver.user, owner]) assert.deepEqual(await run(u.id), { nexted: false, status: 403 });
});

test('A2. every admin route sits behind JWT + central-NGO guard; new routes are registered; Help Now is mounted', () => {
    const routes = fs.readFileSync(srcPath('routes/adminRoutes.js'), 'utf8');
    const firstRoute = routes.search(/router\.(get|post|patch|put|delete)\(/);
    assert.ok(routes.indexOf('router.use(authMiddleware)') < firstRoute);
    assert.ok(routes.indexOf('router.use(requireCentralCounsellor)') < firstRoute);
    for (const needle of [
        "get('/overview'", "post('/patients'", "patch('/patients/:id'", "get('/patients/:id/case-notes'", "post('/patients/:id/case-notes'",
        "get('/documents/:id/file-url'", "get('/prescriptions/:id/file-url'", "get('/audit-logs'",
        "get('/caregivers'", "patch('/caregivers/:user_id/recognition'", "get('/alerts/:id'"
    ]) assert.ok(routes.includes(needle), needle);
    const app = fs.readFileSync(srcPath('app.js'), 'utf8');
    assert.ok(app.includes("app.use('/api/alerts', alertRoutes)"));
    for (const mount of ['/api/auth', '/api/patients', '/api/care-events', '/api/documents', '/api/symptoms', '/api/dashboard', '/api/caregivers', '/api/community', '/api/chat', '/api/calls', '/api/admin']) {
        assert.ok(app.includes(`app.use('${mount}'`), `existing mount ${mount} unchanged`);
    }
    const community = fs.readFileSync(srcPath('routes/communityRoutes.js'), 'utf8');
    assert.ok(community.includes("post('/posts/:id/report'") && community.includes("patch('/reports/:id/status'"));
    const alerts = fs.readFileSync(srcPath('routes/alertRoutes.js'), 'utf8');
    assert.ok(alerts.includes('router.use(authMiddleware)') && alerts.includes("post('/help-now'") && alerts.includes("patch('/:id/cancel'"));
});

// ---------------------------------------------------------------------------
// NGO patient create / update
// ---------------------------------------------------------------------------
test('B1. NGO patient creation makes only a patient: no SELF link, no login, no password', async () => {
    const ngo = await addNgo();
    const usersBefore = fakeDb.useraccount._rows().length;
    const r = await call(adminController.createPatient, {
        userId: ngo.id, body: { full_name: '  Asha Devi ', date_of_birth: '1975-04-02', cancer_type: 'Breast', preferred_language: 'hi' }
    });
    assert.equal(r.status, 201);
    assert.equal(r.body.data.full_name, 'Asha Devi');
    assert.equal(fakeDb.patient._rows().length, 1);
    assert.equal(fakeDb.patientaccountlink._rows().length, 0, 'no SELF/DELEGATE link for anyone, NGO included');
    assert.equal(fakeDb.useraccount._rows().length, usersBefore, 'no account created');
    assert.equal(fakeDb.refreshtoken, undefined);
    assert.ok(auditActions().includes('PATIENT_CREATED'));
    assert.deepEqual(lastAudit('PATIENT_CREATED').payload.fields.sort(), ['cancer_type', 'date_of_birth', 'full_name', 'preferred_language']);
    assert.equal(lastAudit('PATIENT_CREATED').payload.full_name, undefined, 'health/identity values are not copied into the audit');
});

test('B2. patient creation validates input and rejects unknown / immutable fields', async () => {
    const ngo = await addNgo();
    const bad = [
        {}, { full_name: 'X' }, { date_of_birth: '1990-01-01' },
        { full_name: 'X', date_of_birth: 'not-a-date' },
        { full_name: 'X', date_of_birth: '2999-01-01' },
        { full_name: '', date_of_birth: '1990-01-01' },
        { full_name: 'X', date_of_birth: '1990-01-01', id: uuid() },
        { full_name: 'X', date_of_birth: '1990-01-01', created_at: '2020-01-01' },
        { full_name: 'X', date_of_birth: '1990-01-01', relationship_type: 'SELF' },
        { full_name: 'X', date_of_birth: '1990-01-01', user_id: uuid() },
        { full_name: 'X', date_of_birth: '1990-01-01', cancer_stage: 'x'.repeat(51) }
    ];
    for (const body of bad) {
        assert.equal((await call(adminController.createPatient, { userId: ngo.id, body })).status, 400, JSON.stringify(body));
    }
    assert.equal(fakeDb.patient._rows().length, 0);
});

test('B3. patient update: allowlist only, sets updated_at, audited, 404 for unknown patient', async () => {
    const ngo = await addNgo();
    const { patient } = await addPatientWithOwner('Old Name');
    patient.updated_at = new Date('2020-01-01');

    const ok = await call(adminController.updatePatient, { userId: ngo.id, params: { id: patient.id }, body: { full_name: 'New Name', cancer_stage: null, care_plan_summary: 'Weekly review' } });
    assert.equal(ok.status, 200);
    assert.equal(patient.full_name, 'New Name');
    assert.equal(patient.cancer_stage, null);
    assert.ok(patient.updated_at > new Date('2021-01-01'), 'updated_at refreshed');
    assert.ok(auditActions().includes('PATIENT_UPDATED'));

    for (const body of [{}, { id: uuid() }, { created_at: '2020-01-01' }, { updated_at: '2020-01-01' }, { relationship_type: 'SELF' }, { full_name: null }, { date_of_birth: null }, { unknown: 1 }]) {
        assert.equal((await call(adminController.updatePatient, { userId: ngo.id, params: { id: patient.id }, body })).status, 400, JSON.stringify(body));
    }
    assert.equal(patient.full_name, 'New Name', 'rejected requests change nothing');
    assert.equal((await call(adminController.updatePatient, { userId: ngo.id, params: { id: uuid() }, body: { full_name: 'X' } })).status, 404);
    assert.equal((await call(adminController.updatePatient, { userId: ngo.id, params: { id: 'nope' }, body: { full_name: 'X' } })).status, 400);
    assert.equal(adminController.deletePatient, undefined, 'no permanent deletion in the NGO portal');
});

// ---------------------------------------------------------------------------
// Case notes
// ---------------------------------------------------------------------------
test('C1. case notes: author comes from the token, tied to the right patient, append-only, audited without content', async () => {
    const ngo = await addNgo();
    const A = await addPatientWithOwner('A');
    const B = await addPatientWithOwner('B');

    const forged = await call(caseNoteController.createCaseNote, {
        userId: ngo.id, params: { id: A.patient.id }, body: { note: '  First visit done.  ', author_id: A.owner.id, patient_id: B.patient.id, created_at: '2001-01-01' }
    });
    assert.equal(forged.status, 201);
    const note = fakeDb.patientcasenote._rows()[0];
    assert.equal(note.author_id, ngo.id, 'author is the authenticated account');
    assert.equal(note.patient_id, A.patient.id, 'patient comes from the URL');
    assert.equal(note.note, 'First visit done.');
    assert.notEqual(note.created_at.getFullYear(), 2001);

    await call(caseNoteController.createCaseNote, { userId: ngo.id, params: { id: A.patient.id }, body: { note: 'Second note' } });
    await call(caseNoteController.createCaseNote, { userId: ngo.id, params: { id: B.patient.id }, body: { note: 'Other patient' } });

    const list = await call(caseNoteController.listCaseNotes, { userId: ngo.id, params: { id: A.patient.id }, query: {} });
    assert.equal(list.body.data.length, 2);
    assert.ok(list.body.data.every((n) => n.patient_id === A.patient.id));
    assert.equal(list.body.data[0].note, 'Second note', 'newest first');
    assert.equal(list.body.data[0].author.id, ngo.id);
    assert.equal(list.body.pagination.total, 2);

    const audit = lastAudit('CASE_NOTE_CREATED');
    assert.equal(audit.actor_id, ngo.id);
    assert.equal(audit.payload.patient_id, B.patient.id);
    assert.ok(!JSON.stringify(audit.payload).includes('Other patient'), 'note text never goes into the audit log');
    assert.equal(caseNoteController.updateCaseNote, undefined);
    assert.equal(caseNoteController.deleteCaseNote, undefined);
});

test('C2. case note validation: empty / too long / bad ids / unknown patient', async () => {
    const ngo = await addNgo();
    const { patient } = await addPatientWithOwner();
    for (const body of [{}, { note: '' }, { note: '   ' }, { note: 5 }, { note: 'x'.repeat(5001) }]) {
        assert.equal((await call(caseNoteController.createCaseNote, { userId: ngo.id, params: { id: patient.id }, body })).status, 400);
    }
    assert.equal((await call(caseNoteController.createCaseNote, { userId: ngo.id, params: { id: 'bad' }, body: { note: 'x' } })).status, 400);
    assert.equal((await call(caseNoteController.createCaseNote, { userId: ngo.id, params: { id: uuid() }, body: { note: 'x' } })).status, 404);
    assert.equal((await call(caseNoteController.listCaseNotes, { userId: ngo.id, params: { id: uuid() }, query: {} })).status, 404);
    assert.equal(fakeDb.patientcasenote._rows().length, 0);
});

// ---------------------------------------------------------------------------
// Secure file URLs
// ---------------------------------------------------------------------------
const addDoc = async (patient, { path, owner } = {}) => fakeDb.medicaldocument.create({
    data: { patient_id: patient.id, title: 'Lab', file_path: path ?? `${patient.id}/documents/1_lab.pdf`, mime_type: 'application/pdf', file_size_bytes: 10, uploaded_by: owner.id }
});

test('D1. document URL is short-lived, signed from the private bucket, audited, and never exposes file_path', async () => {
    const ngo = await addNgo();
    const { patient, owner } = await addPatientWithOwner();
    const doc = await addDoc(patient, { owner });
    storage.files.add(`medical_documents::${patient.id}/documents/1_lab.pdf`);

    const r = await call(documentController.getAdminDocumentFileUrl, { userId: ngo.id, params: { id: doc.id }, query: { patient_id: patient.id } });
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.body.data).sort(), ['expires_at', 'expires_in_seconds', 'url']);
    assert.ok(r.body.data.url.startsWith('https://signed.test/medical_documents/'));
    assert.ok(r.body.data.expires_in_seconds <= 600, 'short-lived');
    assert.ok(!JSON.stringify(r.body).includes('file_path'));
    assert.equal(storage.signCalls.length, 1);
    assert.equal(storage.signCalls[0].bucket, 'medical_documents');
    const audit = lastAudit('DOCUMENT_FILE_ACCESSED');
    assert.equal(audit.actor_id, ngo.id);
    assert.equal(audit.target_id, doc.id);
    assert.equal(audit.payload.patient_id, patient.id);
    assert.ok(!JSON.stringify(audit.payload).includes('1_lab.pdf'), 'storage path not copied into the audit');
});

test('D2. prescription URL uses the prescriptions bucket', async () => {
    const ngo = await addNgo();
    const { patient, owner } = await addPatientWithOwner();
    const rx = await fakeDb.prescription.create({ data: { patient_id: patient.id, file_path: `${patient.id}/1_prescription_a.jpg`, mime_type: 'image/jpeg', file_size_bytes: 5, uploaded_by: owner.id } });
    storage.files.add(`prescriptions::${patient.id}/1_prescription_a.jpg`);
    const r = await call(documentController.getAdminPrescriptionFileUrl, { userId: ngo.id, params: { id: rx.id }, query: {} });
    assert.equal(r.status, 200);
    assert.equal(storage.signCalls[0].bucket, 'prescriptions');
    assert.ok(auditActions().includes('PRESCRIPTION_FILE_ACCESSED'));
});

test('D3. nothing is signed or audited when the record, patient, path or file is wrong', async () => {
    const ngo = await addNgo();
    const A = await addPatientWithOwner('A');
    const B = await addPatientWithOwner('B');
    const docA = await addDoc(A.patient, { owner: A.owner });
    const stolen = await addDoc(A.patient, { owner: A.owner, path: `${B.patient.id}/documents/other.pdf` });   // path under another patient
    const traversal = await addDoc(A.patient, { owner: A.owner, path: `${A.patient.id}/../${B.patient.id}/x.pdf` });
    const empty = await addDoc(A.patient, { owner: A.owner, path: '' });
    storage.files.add(`medical_documents::${B.patient.id}/documents/other.pdf`);

    const cases = [
        [{ id: 'not-a-uuid' }, {}, 400],
        [{ id: uuid() }, {}, 404],
        [{ id: docA.id }, {}, 404],                                           // record fine, but the file is missing in storage
        [{ id: docA.id }, { patient_id: B.patient.id }, 404],                 // wrong patient
        [{ id: docA.id }, { patient_id: 'bad' }, 400],
        [{ id: stolen.id }, {}, 404],
        [{ id: traversal.id }, {}, 404],
        [{ id: empty.id }, {}, 404]
    ];
    for (const [params, query, expected] of cases) {
        const r = await call(documentController.getAdminDocumentFileUrl, { userId: ngo.id, params, query });
        assert.equal(r.status, expected, JSON.stringify([params, query]));
    }
    assert.equal(storage.signCalls.length, 0);
    assert.ok(!auditActions().includes('DOCUMENT_FILE_ACCESSED'));
});

// ---------------------------------------------------------------------------
// Community reports + moderation
// ---------------------------------------------------------------------------
const addPost = (author, extra = {}) => fakeDb.communitypost.create({ data: { author_id: author.id, content: 'hello', status: 'APPROVED', visibility: 'PUBLIC', ...extra } });

test('E1. community reports are persisted; duplicates are controlled; hidden posts cannot be reported', async () => {
    const author = await addUser('author');
    const reader = await addUser('reader');
    const other = await addUser('other');
    const pub = await addPost(author);
    const priv = await addPost(author, { visibility: 'PRIVATE' });
    const pending = await addPost(author, { status: 'PENDING' });

    const first = await call(communityController.reportPost, { userId: reader.id, params: { id: pub.id }, body: { reason: '  spam  ' } });
    assert.equal(first.status, 201);
    const row = fakeDb.communityreport._rows()[0];
    assert.deepEqual([row.post_id, row.reporter_id, row.reason, row.status], [pub.id, reader.id, 'spam', 'OPEN']);

    assert.equal((await call(communityController.reportPost, { userId: reader.id, params: { id: pub.id }, body: { reason: 'again' } })).status, 409);
    assert.equal(fakeDb.communityreport._rows().length, 1);
    assert.equal((await call(communityController.reportPost, { userId: other.id, params: { id: pub.id }, body: { reason: 'also bad' } })).status, 201, 'a different user can report the same post');

    assert.equal((await call(communityController.reportPost, { userId: author.id, params: { id: pub.id }, body: { reason: 'x' } })).status, 400, 'own post');
    assert.equal((await call(communityController.reportPost, { userId: reader.id, params: { id: priv.id }, body: { reason: 'x' } })).status, 404);
    assert.equal((await call(communityController.reportPost, { userId: reader.id, params: { id: pending.id }, body: { reason: 'x' } })).status, 404);
    for (const body of [{}, { reason: '' }, { reason: 7 }, { reason: 'x'.repeat(1001) }]) {
        assert.equal((await call(communityController.reportPost, { userId: other.id, params: { id: pub.id }, body })).status, 400);
    }
    assert.equal((await call(communityController.reportPost, { userId: other.id, params: { id: 'bad' }, body: { reason: 'x' } })).status, 400);
});

test('E2. only the central NGO can review reports or moderate; a reviewed report can be re-filed (history kept)', async () => {
    const ngo = await addNgo();
    const author = await addUser('author');
    const reader = await addUser('reader');
    const pub = await addPost(author);
    await call(communityController.reportPost, { userId: reader.id, params: { id: pub.id }, body: { reason: 'spam' } });
    const report = fakeDb.communityreport._rows()[0];

    // non-NGO users are refused everywhere
    assert.equal((await call(communityController.updateReportStatus, { userId: reader.id, params: { id: report.id }, body: { status: 'DISMISSED' } })).status, 403);
    assert.equal((await call(communityController.updateReportStatus, { userId: author.id, params: { id: report.id }, body: { status: 'DISMISSED' } })).status, 403);
    assert.equal((await call(communityController.moderatePost, { userId: reader.id, params: { id: pub.id }, body: { status: 'REJECTED', moderator_feedback: 'x' } })).status, 403);
    assert.equal((await call(communityController.getModerationQueue, { userId: reader.id })).status, 403);
    assert.equal(report.status, 'OPEN');

    // validation
    for (const body of [{}, { status: 'OPEN' }, { status: 'HIDDEN' }, { status: 'REVIEWED', moderator_note: 3 }]) {
        assert.equal((await call(communityController.updateReportStatus, { userId: ngo.id, params: { id: report.id }, body })).status, 400);
    }
    assert.equal((await call(communityController.updateReportStatus, { userId: ngo.id, params: { id: uuid() }, body: { status: 'DISMISSED' } })).status, 404);

    const ok = await call(communityController.updateReportStatus, { userId: ngo.id, params: { id: report.id }, body: { status: 'DISMISSED', moderator_note: 'Not a violation' } });
    assert.equal(ok.status, 200);
    assert.deepEqual([report.status, report.reviewed_by, report.moderator_note], ['DISMISSED', ngo.id, 'Not a violation']);
    assert.ok(report.reviewed_at instanceof Date);
    assert.ok(auditActions().includes('COMMUNITY_REPORT_REVIEWED'));
    assert.equal((await call(communityController.updateReportStatus, { userId: ngo.id, params: { id: report.id }, body: { status: 'REVIEWED' } })).status, 409, 'reviewed once');

    // the same reader may report again after a dismissal; the old row stays as history
    assert.equal((await call(communityController.reportPost, { userId: reader.id, params: { id: pub.id }, body: { reason: 'spam again' } })).status, 201);
    assert.equal(fakeDb.communityreport._rows().length, 2);
});

test('E3. moderation queue adds reported approved posts with report details; moderating closes the reports and is audited', async () => {
    const ngo = await addNgo();
    const author = await addUser('author');
    const r1 = await addUser('r1'); const r2 = await addUser('r2');
    const pendingPost = await addPost(author, { status: 'PENDING' });
    const privatePost = await addPost(author, { visibility: 'PRIVATE', status: 'APPROVED' });
    const quiet = await addPost(author);                    // approved, no reports -> not in queue
    const reported = await addPost(author);
    await call(communityController.reportPost, { userId: r1.id, params: { id: reported.id }, body: { reason: 'rude' } });
    await call(communityController.reportPost, { userId: r2.id, params: { id: reported.id }, body: { reason: 'misleading' } });

    const queue = await call(communityController.getModerationQueue, { userId: ngo.id });
    assert.equal(queue.status, 200);
    const ids = queue.body.data.map((p) => p.id);
    assert.ok(ids.includes(pendingPost.id) && ids.includes(privatePost.id) && ids.includes(reported.id), 'existing behaviour preserved + reported post added');
    assert.ok(!ids.includes(quiet.id));
    const entry = queue.body.data.find((p) => p.id === reported.id);
    assert.equal(entry.open_reports_count, 2);
    assert.deepEqual(entry.reports.map((r) => r.reason).sort(), ['misleading', 'rude']);
    assert.ok(entry.reports.every((r) => r.reporter && r.status === 'OPEN'));
    assert.equal(queue.body.data.find((p) => p.id === pendingPost.id).open_reports_count, 0);

    const mod = await call(communityController.moderatePost, { userId: ngo.id, params: { id: reported.id }, body: { status: 'REJECTED', moderator_feedback: 'Please be kind.' } });
    assert.equal(mod.status, 200);
    assert.equal(reported.status, 'REJECTED');
    assert.ok(fakeDb.communityreport._rows().every((r) => r.status === 'REVIEWED' && r.reviewed_by === ngo.id));
    const audit = lastAudit('COMMUNITY_POST_MODERATED');
    assert.equal(audit.actor_id, ngo.id);
    assert.deepEqual([audit.payload.from, audit.payload.to, audit.payload.reports_closed], ['APPROVED', 'REJECTED', 2]);
    const after = await call(communityController.getModerationQueue, { userId: ngo.id });
    assert.ok(!after.body.data.some((p) => p.id === reported.id && p.status === 'APPROVED'));
});

// ---------------------------------------------------------------------------
// Help Now
// ---------------------------------------------------------------------------
const helpNow = (userId, patientId, extra = {}) => call(alertController.createHelpNow, {
    userId, body: { patient_id: patientId, client_event_id: uuid(), ...extra }
});

const careCircle = async () => {
    const ngo = await addNgo();
    const { owner, patient } = await addPatientWithOwner();
    const cg = await addCaregiver('cousin', { recognized: true });
    await linkCaregiver(patient.id, cg.user.id);
    await fakeDb.useraccount.update({ where: { id: ngo.id }, data: { fcm_token: 'tok-ngo' } });
    await fakeDb.useraccount.update({ where: { id: owner.id }, data: { fcm_token: 'tok-owner' } });
    return { ngo, owner, patient, cg };
};

test('F1. Help Now creates an alert for the requester, notifies everyone else, records delivery rows', async () => {
    const { ngo, owner, patient, cg } = await careCircle();
    const r = await call(alertController.createHelpNow, { userId: cg.user.id, body: { patient_id: patient.id, client_event_id: uuid(), note: 'Needs help now' } });
    assert.equal(r.status, 201);
    const alert = fakeDb.alert._rows()[0];
    assert.deepEqual([alert.type, alert.status, alert.requested_by_user_id, alert.patient_id], ['HELP_REQUEST', 'OPEN', cg.user.id, patient.id]);

    const recipients = fakeDb.alertrecipient._rows().map((x) => x.recipient_user_id).sort();
    assert.deepEqual(recipients, [ngo.id, owner.id].sort(), 'NGO + account holder; never the requester');
    const deliveries = fakeDb.alertdelivery._rows();
    assert.equal(deliveries.length, 2);
    await whenNotificationsSettled();
    assert.ok(deliveries.every((d) => d.channel === 'PUSH' && d.delivery_status === 'SENT' && d.sent_at instanceof Date && !d.failed_at), 'SENT once Firebase accepted it');
    assert.deepEqual(storage.pushes.map((p) => p.token).sort(), ['tok-ngo', 'tok-owner']);
    assert.ok(storage.pushes.every((p) => !JSON.stringify(p).includes('Needs help now')), 'no note text in the push');
    assert.ok(fakeDb.alertupdate._rows().some((u) => u.type === 'HELP_NOW_NOTE' && u.note === 'Needs help now'));
    assert.ok(auditActions().includes('HELP_NOW_CREATED'));
});

test('F2. recipients without a device token get an honest FAILED delivery row', async () => {
    const { ngo, patient, cg } = await careCircle();
    await fakeDb.useraccount.update({ where: { id: ngo.id }, data: { fcm_token: null } });
    await helpNow(cg.user.id, patient.id);
    const failed = fakeDb.alertdelivery._rows().filter((d) => d.delivery_status === 'FAILED');
    assert.equal(failed.length, 1);
    assert.equal(failed[0].failure_reason, 'NO_DEVICE_TOKEN');
});

test('F3. retries with the same client_event_id never create a duplicate alert or push', async () => {
    const { patient, cg } = await careCircle();
    const eventId = uuid();
    const body = { patient_id: patient.id, client_event_id: eventId };
    const first = await call(alertController.createHelpNow, { userId: cg.user.id, body });
    const second = await call(alertController.createHelpNow, { userId: cg.user.id, body });
    assert.equal(first.status, 201);
    assert.equal(second.status, 200);
    assert.equal(second.body.meta.replay, true);
    assert.equal(second.body.data.id, first.body.data.id);
    assert.equal(fakeDb.alert._rows().length, 1);
    assert.equal(storage.pushes.length, 2, 'no extra notifications on retry');
    assert.equal(fakeDb.auditlogentry._rows().filter((a) => a.action === 'HELP_NOW_CREATED').length, 1);
});

test('F4. pressing again while open merges into the open alert (idempotently); another person gets their own alert', async () => {
    const { owner, patient, cg } = await careCircle();
    const a = await helpNow(cg.user.id, patient.id);
    const eventId = uuid();
    const again = await call(alertController.createHelpNow, { userId: cg.user.id, body: { patient_id: patient.id, client_event_id: eventId } });
    assert.equal(again.status, 200);
    assert.equal(again.body.meta.merged, true);
    assert.equal(again.body.data.id, a.body.data.id);
    assert.equal(fakeDb.alert._rows().length, 1);
    const pushesAfterMerge = storage.pushes.length;
    const retry = await call(alertController.createHelpNow, { userId: cg.user.id, body: { patient_id: patient.id, client_event_id: eventId } });
    assert.equal(retry.body.meta.replay, true);
    assert.equal(fakeDb.alertupdate._rows().filter((u) => u.client_event_id === eventId).length, 1, 'repeat press recorded once');
    assert.equal(storage.pushes.length, pushesAfterMerge, 'merged presses do not notify again');

    const ownerPress = await helpNow(owner.id, patient.id);
    assert.equal(ownerPress.status, 201);
    assert.equal(fakeDb.alert._rows().length, 2);
    assert.notEqual(ownerPress.body.data.id, a.body.data.id);
});

test('F5. a client_event_id used by someone else (or for another patient) is rejected', async () => {
    const { owner, patient, cg } = await careCircle();
    const eventId = uuid();
    assert.equal((await call(alertController.createHelpNow, { userId: cg.user.id, body: { patient_id: patient.id, client_event_id: eventId } })).status, 201);
    assert.equal((await call(alertController.createHelpNow, { userId: owner.id, body: { patient_id: patient.id, client_event_id: eventId } })).status, 409);
    assert.equal(fakeDb.alert._rows().length, 1);
});

test('F6. only a current, eligible relationship can send Help Now', async () => {
    const { ngo, patient, cg } = await careCircle();
    const stranger = await addUser('stranger');
    const unrecognized = await addCaregiver('unrecognized');
    await linkCaregiver(patient.id, unrecognized.user.id);
    const revoked = await addCaregiver('revoked', { recognized: true });
    await linkCaregiver(patient.id, revoked.user.id, { consent_status: 'REVOKED', revoked_at: new Date() });
    for (const u of [stranger, unrecognized.user, revoked.user, ngo]) {
        assert.equal((await helpNow(u.id, patient.id)).status, 403);
    }
    assert.equal(fakeDb.alert._rows().length, 0);

    // a caregiver with minimal scopes can still ask for help
    const minimal = await addCaregiver('minimal', { recognized: true });
    await linkCaregiver(patient.id, minimal.user.id, { access_scopes: [] });
    assert.equal((await helpNow(minimal.user.id, patient.id)).status, 201);

    // validation
    assert.equal((await call(alertController.createHelpNow, { userId: cg.user.id, body: { patient_id: patient.id } })).status, 400);
    assert.equal((await call(alertController.createHelpNow, { userId: cg.user.id, body: { patient_id: 'x', client_event_id: uuid() } })).status, 400);
    assert.equal((await helpNow(cg.user.id, patient.id, { note: 'n'.repeat(1001) })).status, 400);
    assert.equal((await helpNow(cg.user.id, patient.id, { note: 42 })).status, 400);
});

test('F7. a revoked caregiver is not notified of a later Help Now', async () => {
    const { owner, patient, cg } = await careCircle();
    await call(caregiverController.revokeCaregiver, { userId: owner.id, body: { patient_id: patient.id, caregiver_user_id: cg.user.id } });
    await helpNow(owner.id, patient.id);
    assert.ok(!fakeDb.alertrecipient._rows().some((r) => r.recipient_user_id === cg.user.id));
});

test('F8. only the original requester can cancel; staff cannot bypass it through the admin status route', async () => {
    const { ngo, owner, patient, cg } = await careCircle();
    const sent = await helpNow(cg.user.id, patient.id);
    const id = sent.body.data.id;
    const alert = fakeDb.alert._rows()[0];

    assert.equal((await call(alertController.cancelHelpNow, { userId: owner.id, params: { id } })).status, 403, 'another relative');
    assert.equal((await call(alertController.cancelHelpNow, { userId: ngo.id, params: { id } })).status, 403, 'NGO via the mobile route');
    const viaAdmin = await call(adminController.updateAlertStatus, { userId: ngo.id, params: { id }, body: { status: 'CANCELLED' } });
    assert.equal(viaAdmin.status, 403);
    assert.equal(viaAdmin.body.code, 'HELP_NOW_CANCEL_REQUESTER_ONLY');
    assert.equal(alert.status, 'OPEN');

    // staff still use the normal flow
    assert.equal((await call(adminController.updateAlertStatus, { userId: ngo.id, params: { id }, body: { status: 'ACKNOWLEDGED' } })).status, 200);
    assert.equal(alert.status, 'ACKNOWLEDGED');

    const ok = await call(alertController.cancelHelpNow, { userId: cg.user.id, params: { id }, body: { note: 'False alarm' } });
    assert.equal(ok.status, 200);
    assert.equal(alert.status, 'CANCELLED');
    assert.ok(fakeDb.alertupdate._rows().some((u) => u.type === 'STATUS_CHANGE' && u.note.includes('CANCELLED (by requester)')));
    assert.ok(auditActions().includes('HELP_NOW_CANCELLED'));
    assert.equal((await call(alertController.cancelHelpNow, { userId: cg.user.id, params: { id } })).status, 200, 'cancelling twice is harmless');
    assert.equal(fakeDb.auditlogentry._rows().filter((a) => a.action === 'HELP_NOW_CANCELLED').length, 1);
});

test('F9. lifecycle rules: not cancellable once staff is working on it; automatic alerts are not cancellable here; a new press after cancel starts a new alert', async () => {
    const { ngo, patient, cg } = await careCircle();
    const sent = await helpNow(cg.user.id, patient.id);
    const alert = fakeDb.alert._rows()[0];
    await call(adminController.updateAlertStatus, { userId: ngo.id, params: { id: alert.id }, body: { status: 'ACKNOWLEDGED' } });
    await call(adminController.updateAlertStatus, { userId: ngo.id, params: { id: alert.id }, body: { status: 'IN_PROGRESS' } });
    const blocked = await call(alertController.cancelHelpNow, { userId: cg.user.id, params: { id: alert.id } });
    assert.equal(blocked.status, 409);
    assert.equal(alert.status, 'IN_PROGRESS');

    const auto = await fakeDb.alert.create({ data: { patient_id: patient.id, type: 'DETERIORATION', severity: 'HIGH', status: 'OPEN' } });
    assert.equal((await call(alertController.cancelHelpNow, { userId: cg.user.id, params: { id: auto.id } })).status, 404);
    assert.equal((await call(alertController.cancelHelpNow, { userId: cg.user.id, params: { id: uuid() } })).status, 404);
    assert.equal((await call(alertController.cancelHelpNow, { userId: cg.user.id, params: { id: 'bad' } })).status, 400);

    // close it, then press again right away: a NEW alert (no cooldown re-opening)
    await call(adminController.updateAlertStatus, { userId: ngo.id, params: { id: alert.id }, body: { status: 'RESOLVED' } });
    const next = await helpNow(cg.user.id, patient.id);
    assert.equal(next.status, 201);
    assert.notEqual(next.body.data.id, sent.body.data.id);
    assert.equal(next.body.data.requested_by_user_id, cg.user.id);
});

test('F10. a requester who lost access can no longer cancel', async () => {
    const { owner, patient, cg } = await careCircle();
    const sent = await helpNow(cg.user.id, patient.id);
    await call(caregiverController.revokeCaregiver, { userId: owner.id, body: { patient_id: patient.id, caregiver_user_id: cg.user.id } });
    assert.equal((await call(alertController.cancelHelpNow, { userId: cg.user.id, params: { id: sent.body.data.id } })).status, 403);
});

// ---------------------------------------------------------------------------
// Admin read APIs
// ---------------------------------------------------------------------------
test('G1. admin alert detail includes requester and a delivery record for each recipient', async () => {
    const { ngo, patient, cg } = await careCircle();
    const sent = await helpNow(cg.user.id, patient.id);
    const r = await call(adminController.getAlert, { userId: ngo.id, params: { id: sent.body.data.id } });
    assert.equal(r.status, 200);
    assert.equal(r.body.data.requested_by.id, cg.user.id);
    assert.equal(r.body.data.recipients.length, 2);
    for (const rec of r.body.data.recipients) {
        assert.ok(rec.user && rec.user.id);
        assert.equal(rec.deliveries.length, 1);
        assert.equal(rec.deliveries[0].channel, 'PUSH');
    }
});

test('G2. overview returns real counts and does not invent a missed-check-in number', async () => {
    const ngo = await addNgo();
    const { owner, patient } = await addPatientWithOwner();
    await addPatientWithOwner('second');
    const past = new Date(Date.now() - 3600_000); const future = new Date(Date.now() + 3600_000);
    await fakeDb.alert.create({ data: { patient_id: patient.id, type: 'DETERIORATION', severity: 'HIGH', status: 'OPEN' } });
    await fakeDb.alert.create({ data: { patient_id: patient.id, type: 'DETERIORATION', severity: 'HIGH', status: 'RESOLVED' } });
    await fakeDb.careevent.create({ data: { patient_id: patient.id, completion_status: 'SCHEDULED', schedule_time: past } });
    await fakeDb.careevent.create({ data: { patient_id: patient.id, completion_status: 'DUE', schedule_time: past } });
    await fakeDb.careevent.create({ data: { patient_id: patient.id, completion_status: 'COMPLETED', schedule_time: past } });
    await fakeDb.careevent.create({ data: { patient_id: patient.id, completion_status: 'SCHEDULED', schedule_time: future } });
    await fakeDb.medicaldocument.create({ data: { patient_id: patient.id, title: 'x', file_path: 'p', uploaded_by: owner.id } });
    await fakeDb.medicaldocument.create({ data: { patient_id: patient.id, title: 'y', file_path: 'p', uploaded_by: owner.id, verification_status: 'VERIFIED' } });
    await addCaregiver('c1'); await addCaregiver('c2', { recognized: true });
    await fakeDb.communitypost.create({ data: { author_id: owner.id, content: 'a', status: 'PENDING', visibility: 'PUBLIC' } });
    await fakeDb.communitypost.create({ data: { author_id: owner.id, content: 'b', status: 'APPROVED', visibility: 'PUBLIC' } });
    await fakeDb.communityreport.create({ data: { post_id: uuid(), reporter_id: owner.id, reason: 'r' } });

    const r = await call(adminController.getOverview, { userId: ngo.id });
    assert.equal(r.status, 200);
    const d = r.body.data;
    assert.deepEqual(
        [d.total_patients, d.active_alerts, d.overdue_care_events, d.documents_awaiting_verification, d.caregivers_awaiting_recognition, d.posts_pending_moderation, d.open_community_reports],
        [2, 1, 2, 1, 1, 1, 1]
    );
    assert.equal(d.missed_check_ins, undefined);
    assert.ok(d.unavailable_metrics.missed_check_ins);
});

test('G3. patient detail adds consent history and prescription metadata, never storage paths', async () => {
    const ngo = await addNgo();
    const { owner, patient } = await addPatientWithOwner();
    const cg = await addCaregiver('rahul', { recognized: true });
    await addInvite(patient.id, { createdBy: owner.id });
    await call(caregiverController.acceptInvite, { userId: cg.user.id, body: { invite_code: 'ABCD1234' } });
    await call(caregiverController.revokeCaregiver, { userId: owner.id, body: { patient_id: patient.id, caregiver_user_id: cg.user.id } });
    const rx = await fakeDb.prescription.create({ data: { patient_id: patient.id, file_path: `${patient.id}/secret/path.jpg`, mime_type: 'image/jpeg', file_size_bytes: 123n, uploaded_by: owner.id } });
    await fakeDb.prescriptionextraction.create({ data: { prescription_id: rx.id, extracted_text: 'Paracetamol', raw_payload: { huge: true }, confidence_score: 0.9, processed_at: new Date() } });
    await fakeDb.medicaldocument.create({ data: { patient_id: patient.id, title: 'Lab', file_path: `${patient.id}/documents/secret.pdf`, uploaded_by: owner.id } });

    const r = await call(adminController.getPatient, { userId: ngo.id, params: { id: patient.id } });
    assert.equal(r.status, 200);
    const d = r.body.data;
    assert.ok(d.consent_history.length > 0 && d.consent_history.every((c) => c.status === 'REVOKED'), 'revoked history is visible');
    assert.equal(d.consent_history[0].granted_by_user.id, owner.id);
    assert.equal(d.consent_history[0].grantee.id, cg.user.id);
    assert.equal(d.prescriptions.length, 1);
    assert.equal(d.prescriptions[0].file_size_bytes, 123);
    assert.equal(d.prescriptions[0].extraction.extracted_text, 'Paracetamol');
    assert.equal(d.prescriptions[0].extraction.raw_payload, undefined);
    assert.equal(d.caregivers.length, 1, 'historical caregiver relationship still listed');
    assert.equal(d.caregivers[0].is_active, false);
    assert.equal(d.account_holders[0].is_active, true);
    assert.ok(!JSON.stringify(r.body).includes('secret'), 'no private storage path anywhere in the response');
    assert.ok(!JSON.stringify(r.body).includes('file_path'));
    for (const key of ['profile', 'caregivers', 'recent_alerts', 'medications', 'recent_documents', 'upcoming_care_events', 'recent_symptom_checkins']) {
        assert.ok(key in d, `existing key ${key} preserved`);
    }
});

test('G4. audit-log listing: pagination, validated filters, actor included, read-only', async () => {
    const ngo = await addNgo();
    const { patient } = await addPatientWithOwner();
    await call(caseNoteController.createCaseNote, { userId: ngo.id, params: { id: patient.id }, body: { note: 'one' } });
    await call(caseNoteController.createCaseNote, { userId: ngo.id, params: { id: patient.id }, body: { note: 'two' } });
    await call(adminController.updatePatient, { userId: ngo.id, params: { id: patient.id }, body: { full_name: 'Renamed' } });

    const all = await call(adminController.listAuditLogs, { userId: ngo.id, query: { page: '1', limit: '2' } });
    assert.equal(all.status, 200);
    assert.equal(all.body.data.length, 2);
    assert.equal(all.body.pagination.total, 3);
    assert.equal(all.body.pagination.total_pages, 2);
    assert.equal(all.body.data[0].actor.id, ngo.id);

    const byAction = await call(adminController.listAuditLogs, { userId: ngo.id, query: { action: 'CASE_NOTE_CREATED' } });
    assert.equal(byAction.body.data.length, 2);
    const byTarget = await call(adminController.listAuditLogs, { userId: ngo.id, query: { target_id: patient.id, target_resource: 'patient' } });
    assert.equal(byTarget.body.data.length, 1);
    assert.equal(byTarget.body.data[0].action, 'PATIENT_UPDATED');
    const today = new Date().toISOString().slice(0, 10);
    assert.equal((await call(adminController.listAuditLogs, { userId: ngo.id, query: { from: today, to: today } })).body.pagination.total, 3);
    assert.equal((await call(adminController.listAuditLogs, { userId: ngo.id, query: { to: '2000-01-01' } })).body.pagination.total, 0);

    for (const query of [{ action: 'drop table' }, { target_id: 'x' }, { from: 'yesterday' }, { to: 'tomorrow' }, { target_resource: 'a b' }, { from: '2030-01-02', to: '2030-01-01' }]) {
        assert.equal((await call(adminController.listAuditLogs, { userId: ngo.id, query })).status, 400, JSON.stringify(query));
    }
    for (const fn of ['createAuditLog', 'updateAuditLog', 'deleteAuditLog']) assert.equal(adminController[fn], undefined);
});

test('H1. existing flows are unchanged: POST /patients is SELF-only; delegates still need scope-checked creation', async () => {
    const u = await addUser('self');
    assert.equal((await call(patientController.createPatientProfile, { userId: u.id, body: { full_name: 'S', date_of_birth: '1990-01-01', relationship_type: 'DELEGATE' } })).status, 400);
    assert.equal((await call(patientController.createPatientProfile, { userId: u.id, body: { full_name: 'S', date_of_birth: '1990-01-01' } })).status, 201);
    assert.equal(fakeDb.patientaccountlink._rows()[0].relationship_type, 'SELF');
    assert.deepEqual(fakeDb.patientaccountlink._rows()[0].access_scopes, ['ALL']);
    assert.ok(SCOPES.ALL);
});
