/**
 * Patient claim flow, caregiver-invite safety fix, patient self-edit and NGO patient detail.
 * Runs with:  node --test tests/*.test.js      (in-memory fake DB, see tests/helpers/harness.js)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
    fakeDb, call, reset, uuid, addUser, addNgo, addPatientWithOwner, addCaregiver, linkCaregiver, addInvite,
    adminController, patientController, caregiverController
} = require('./helpers/harness');

test.beforeEach(reset);

const mkPatient = (name = 'Asha') => fakeDb.patient.create({ data: { full_name: name, date_of_birth: new Date('1970-01-01') } });
const claimCodeFor = (patientId, extra = {}) => fakeDb.caregiverinvite.create({
    data: { patient_id: patientId, code: 'A1B2C3D4', invite_kind: 'PATIENT_CLAIM', expires_at: new Date(Date.now() + 3600_000), ...extra }
});
const issue = (ngo, patientId) => call(adminController.createPatientClaimCode, { userId: ngo.id, params: { id: patientId } });
const claim = (userId, code) => call(patientController.claimPatient, { userId, body: { code } });
const CLAIM_INVALID = 'Invalid or expired code.';

// ---------------------------------------------------------------------------
// 1. Safety fix: caregiver accept only honours CAREGIVER codes
// ---------------------------------------------------------------------------
test('C1. a PATIENT_CLAIM code can never be used as a caregiver invite (same generic message, code not consumed)', async () => {
    const patient = await mkPatient();
    const cg = await addCaregiver('nurse', { recognized: true });
    const claimInvite = await claimCodeFor(patient.id);
    const r = await call(caregiverController.acceptInvite, { userId: cg.user.id, body: { invite_code: 'A1B2C3D4' } });
    assert.equal(r.status, 400);
    assert.equal(r.body.message, 'Invalid or expired invite code.');
    assert.equal(claimInvite.is_used, false, 'the claim code is untouched');
    assert.equal(fakeDb.patientcaregiverlink._rows().length, 0, 'no caregiver link was created');

    // and a genuine caregiver invite still works
    await addInvite(patient.id, { code: 'CAFE0001' });
    assert.equal((await call(caregiverController.acceptInvite, { userId: cg.user.id, body: { invite_code: 'CAFE0001' } })).status, 200);
});

test('C2. the atomic claim itself is also restricted to CAREGIVER codes (race between check and claim)', async () => {
    const patient = await mkPatient();
    const cg = await addCaregiver('nurse', { recognized: true });
    const claimInvite = await claimCodeFor(patient.id);
    // the check sees a CAREGIVER-looking row, but the row in the database is a PATIENT_CLAIM code
    const real = fakeDb.caregiverinvite.findUnique;
    fakeDb.caregiverinvite.findUnique = async (args) => { const row = await real(args); return row && { ...row, invite_kind: 'CAREGIVER' }; };
    try {
        const r = await call(caregiverController.acceptInvite, { userId: cg.user.id, body: { invite_code: 'A1B2C3D4' } });
        assert.equal(r.status, 400);
        assert.equal(r.body.message, 'Invalid or expired invite code.');
    } finally { fakeDb.caregiverinvite.findUnique = real; }
    assert.equal(claimInvite.is_used, false);
    assert.equal(fakeDb.patientcaregiverlink._rows().length, 0);
});

// ---------------------------------------------------------------------------
// 2. POST /api/admin/patients/:id/claim-code
// ---------------------------------------------------------------------------
test('D1. only behind the central-NGO guard; unknown patient 404; bad id 400', async () => {
    const routes = fs.readFileSync(require.resolve('../src/routes/adminRoutes'), 'utf8');
    assert.ok(routes.indexOf('router.use(requireCentralCounsellor)') < routes.indexOf("post('/patients/:id/claim-code'"));
    assert.ok(!routes.includes('account-links'), 'the account-links route was removed');
    const ngo = await addNgo();
    assert.equal((await issue(ngo, uuid())).status, 404);
    assert.equal((await issue(ngo, 'nope')).status, 400);
});

test('D2. issues an 8-char uppercase hex PATIENT_CLAIM code with a 7-day expiry, created_by the NGO user', async () => {
    const ngo = await addNgo();
    const patient = await mkPatient();
    const r = await issue(ngo, patient.id);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.status, 'success');
    assert.deepEqual(Object.keys(r.body.data).sort(), ['code', 'expires_at']);
    assert.match(r.body.data.code, /^[0-9A-F]{8}$/);
    const days = (new Date(r.body.data.expires_at) - Date.now()) / 86400_000;
    assert.ok(days > 6.99 && days <= 7, `expires in ${days} days`);
    const row = fakeDb.caregiverinvite._rows()[0];
    assert.deepEqual([row.invite_kind, row.patient_id, row.created_by, row.is_used, row.code], ['PATIENT_CLAIM', patient.id, ngo.id, false, r.body.data.code]);
});

test('D3. a new code retires older unused claim codes; caregiver invites and other patients are untouched', async () => {
    const ngo = await addNgo();
    const patient = await mkPatient(); const other = await mkPatient('Other');
    const careInvite = await addInvite(patient.id, { code: 'CAFE0002' });
    const otherClaim = await claimCodeFor(other.id, { code: 'EEEE0001' });
    const first = (await issue(ngo, patient.id)).body.data.code;
    const second = (await issue(ngo, patient.id)).body.data.code;
    assert.notEqual(first, second);
    const byCode = (c) => fakeDb.caregiverinvite._rows().find((x) => x.code === c);
    assert.equal(byCode(first).is_used, true, 'older code is retired');
    assert.equal(byCode(second).is_used, false);
    assert.equal(careInvite.is_used, false, 'caregiver invites are not affected');
    assert.equal(otherClaim.is_used, false, 'other patients are not affected');
    // the retired code no longer claims
    const person = await addUser('patient1');
    assert.equal((await claim(person.id, first)).status, 400);
    assert.equal((await claim(person.id, second)).status, 201);
});

test('D4. 409 when the patient already has an active SELF link (a revoked one does not block)', async () => {
    const ngo = await addNgo();
    const { patient, owner } = await addPatientWithOwner();
    const r = await issue(ngo, patient.id);
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'SELF_LINK_EXISTS');
    assert.equal(fakeDb.caregiverinvite._rows().length, 0, 'nothing issued');
    Object.assign(fakeDb.patientaccountlink._rows().find((l) => l.user_id === owner.id), { consent_status: 'REVOKED', revoked_at: new Date() });
    assert.equal((await issue(ngo, patient.id)).status, 201);
});

test('D5. audited as PATIENT_CLAIM_CODE_CREATED and the code itself is never in audit data or logs', async () => {
    const ngo = await addNgo();
    const patient = await mkPatient();
    const logged = [];
    const origLog = console.log; const origErr = console.error; const origWarn = console.warn;
    console.log = (...a) => logged.push(a.join(' ')); console.error = console.log; console.warn = console.log;
    let r;
    try { r = await issue(ngo, patient.id); } finally { console.log = origLog; console.error = origErr; console.warn = origWarn; }
    const code = r.body.data.code;
    const entry = fakeDb.auditlogentry._rows().find((a) => a.action === 'PATIENT_CLAIM_CODE_CREATED');
    assert.ok(entry);
    assert.deepEqual([entry.actor_id, entry.target_resource, entry.payload.patient_id], [ngo.id, 'caregiverinvite', patient.id]);
    assert.ok(!JSON.stringify(fakeDb.auditlogentry._rows()).includes(code), 'no code in audit rows');
    assert.ok(!logged.join('\n').includes(code), 'no code in logs');
});

// ---------------------------------------------------------------------------
// 3. POST /api/patients/claim
// ---------------------------------------------------------------------------
const issued = async (patient) => (await issue(await addNgoOnce(), patient.id)).body.data.code;
let ngoCache; const addNgoOnce = async () => { if (!ngoCache || !fakeDb.useraccount._rows().some((u) => u.id === ngoCache.id)) ngoCache = await addNgo(); return ngoCache; };

test('E1. a valid code turns the NGO-created record into the caller\'s SELF account (same shape as POST /api/patients)', async () => {
    const patient = await mkPatient('Meera');
    const code = await issued(patient);
    const person = await addUser('meera');
    const r = await claim(person.id, `  ${code.toLowerCase()} `);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.status, 'success');
    assert.deepEqual(Object.keys(r.body.data).sort(), ['link', 'patient']);
    assert.equal(r.body.data.patient.id, patient.id);
    const link = r.body.data.link;
    assert.deepEqual([link.user_id, link.patient_id, link.relationship_type, link.consent_status, link.granted_by, link.access_scopes], [person.id, patient.id, 'SELF', 'GRANTED', person.id, ['ALL']]);

    // identical shape to what createPatientProfile returns
    const created = await call(patientController.createPatientProfile, { userId: (await addUser('other')).id, body: { full_name: 'X', date_of_birth: '1990-01-01' } });
    assert.deepEqual(Object.keys(r.body.data.link).sort(), Object.keys(created.body.data.link).sort());
    assert.deepEqual(Object.keys(created.body), Object.keys(r.body), 'same envelope');
    assert.deepEqual(Object.keys(created.body.data).sort(), Object.keys(r.body.data).sort(), 'same { patient, link } payload');
    assert.equal(r.body.data.patient.full_name, 'Meera', 'the full patient row is returned');

    // like createPatientProfile: no consent rows; the patient now sees the record in /me
    assert.equal(fakeDb.consentrecord._rows().length, 0);
    const mine = await call(patientController.getMyPatients, { userId: person.id });
    assert.equal(mine.body.data[0].patient.id, patient.id);
    assert.equal(mine.body.data[0].relationship_type, 'SELF');
    const entry = fakeDb.auditlogentry._rows().find((a) => a.action === 'PATIENT_CLAIMED');
    assert.deepEqual([entry.actor_id, entry.target_id, entry.payload.patient_id], [person.id, link.id, patient.id]);
    assert.ok(!JSON.stringify(fakeDb.auditlogentry._rows()).includes(code), 'no code in audit rows');
});

test('E2. the code is single-use', async () => {
    const patient = await mkPatient();
    const code = await issued(patient);
    assert.equal((await claim((await addUser('a')).id, code)).status, 201);
    const again = await claim((await addUser('b')).id, code);
    assert.equal(again.status, 400);
    assert.equal(fakeDb.patientaccountlink._rows().filter((l) => l.patient_id === patient.id).length, 1);
});

test('E3. wrong, used, expired, malformed and caregiver-kind codes all return the SAME generic 400', async () => {
    const patient = await mkPatient();
    await fakeDb.caregiverinvite.create({ data: { patient_id: patient.id, code: 'DEAD0001', invite_kind: 'PATIENT_CLAIM', is_used: true, expires_at: new Date(Date.now() + 3600_000) } });
    await fakeDb.caregiverinvite.create({ data: { patient_id: patient.id, code: 'DEAD0002', invite_kind: 'PATIENT_CLAIM', expires_at: new Date(Date.now() - 1000) } });
    await addInvite(patient.id, { code: 'CAFE0003' });                                            // caregiver invite
    const bodies = [];
    let n = 0;
    for (const code of ['FFFFFFFF', 'DEAD0001', 'DEAD0002', 'CAFE0003', 'short', '', undefined, 12345678, ['A1B2C3D4'], { code: 1 }]) {
        const r = await claim((await addUser(`p${n += 1}`)).id, code);   // a fresh user each time: the per-user limiter is tested in E6
        assert.equal(r.status, 400, String(code));
        bodies.push(r.body.message);
    }
    assert.ok(bodies.every((m) => m === CLAIM_INVALID), `messages: ${[...new Set(bodies)]}`);
    assert.equal(fakeDb.patientaccountlink._rows().length, 0);
});

test('E4. 409 when the patient already has an active SELF link, or the user already has a SELF profile; the code stays valid', async () => {
    const patient = await mkPatient();
    const code = await issued(patient);
    const taken = await addPatientWithOwner('someone');
    const alreadySelf = await claim(taken.owner.id, code);
    assert.equal(alreadySelf.status, 409);
    assert.equal(alreadySelf.body.code, 'SELF_PROFILE_EXISTS');
    assert.equal(fakeDb.caregiverinvite._rows().find((i) => i.code === code).is_used, false, 'a 409 does not burn the code');

    // the patient got a SELF account some other way in the meantime
    const newcomer = await addUser('newcomer');
    await fakeDb.patientaccountlink.create({ data: { user_id: (await addUser('early')).id, patient_id: patient.id, relationship_type: 'SELF', access_scopes: ['ALL'], granted_by: uuid() } });
    const r = await claim(newcomer.id, code);
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'SELF_LINK_EXISTS');
    assert.equal(fakeDb.patientaccountlink._rows().filter((l) => l.user_id === newcomer.id).length, 0);
});

test('E5. two simultaneous claims of one code: exactly one wins', async () => {
    const patient = await mkPatient();
    const code = await issued(patient);
    const [a, b] = [await addUser('a'), await addUser('b')];
    const results = await Promise.all([claim(a.id, code), claim(b.id, code)]);
    // The loser either missed the code (400) or, having passed the lookup, waits for the patient lock and then
    // sees the winner's SELF link (409 SELF_LINK_EXISTS). Both are correct; never two winners.
    const statuses = results.map((r) => r.status).sort();
    assert.equal(statuses[0], 201);
    assert.ok([400, 409].includes(statuses[1]), String(statuses));
    assert.equal(fakeDb.patientaccountlink._rows().filter((l) => l.patient_id === patient.id && l.relationship_type === 'SELF').length, 1);
});

test('E6. rate limit: 5 failed attempts per user per hour, then 429 (even for a valid code); other users unaffected', async () => {
    const patient = await mkPatient();
    const code = await issued(patient);
    const guesser = await addUser('guesser');
    for (let i = 0; i < 5; i += 1) assert.equal((await claim(guesser.id, `0000000${i}`)).status, 400);
    const blocked = await claim(guesser.id, code);
    assert.equal(blocked.status, 429);
    assert.equal(fakeDb.caregiverinvite._rows().find((i) => i.code === code).is_used, false, 'a blocked request does not touch the code');
    assert.equal((await claim(guesser.id, '00000009')).status, 429);

    // per user: somebody else can still claim
    const real = await addUser('real');
    assert.equal((await claim(real.id, code)).status, 201);

    // the window slides: attempts older than an hour no longer count
    fakeDb.patientclaimattempt._rows().forEach((a) => { a.attempted_at = new Date(Date.now() - 61 * 60 * 1000); });
    assert.equal((await claim(guesser.id, '00000010')).status, 400);
});

test('E7. successful claims and 409s do not count as failed attempts', async () => {
    const patient = await mkPatient();
    const code = await issued(patient);
    assert.equal((await claim((await addUser('a')).id, code)).status, 201);
    assert.equal(fakeDb.patientclaimattempt._rows().length, 0);
});

test('E8. the claim route is mounted before /:patient_id and behind authMiddleware', () => {
    const routes = fs.readFileSync(require.resolve('../src/routes/patientRoutes'), 'utf8');
    assert.ok(routes.indexOf('router.use(authMiddleware)') < routes.indexOf("post('/claim'"));
    assert.ok(routes.indexOf("post('/claim'") < routes.indexOf("patch('/:patient_id'"));
});

// ---------------------------------------------------------------------------
// 4. PATCH /api/patients/:patient_id
// ---------------------------------------------------------------------------
const edit = (userId, patientId, body) => call(patientController.updatePatientProfile, { userId, params: { patient_id: patientId }, body });

test('F1. SELF can edit the allowed fields; the change is audited with field names only', async () => {
    const { owner, patient } = await addPatientWithOwner();
    const r = await edit(owner.id, patient.id, { full_name: ' Asha Rao ', date_of_birth: '1975-05-04', preferred_language: 'hi', cancer_type: 'Breast', cancer_stage: 'II', diagnosis_date: '2024-01-15' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(patient.full_name, 'Asha Rao');
    assert.equal(patient.preferred_language, 'hi');
    assert.equal(patient.cancer_stage, 'II');
    assert.equal(new Date(patient.date_of_birth).toISOString().slice(0, 10), '1975-05-04');
    const entry = fakeDb.auditlogentry._rows().find((a) => a.action === 'PATIENT_UPDATED');
    assert.equal(entry.actor_id, owner.id);
    assert.deepEqual(entry.payload.fields.sort(), ['cancer_stage', 'cancer_type', 'date_of_birth', 'diagnosis_date', 'full_name', 'preferred_language']);
    assert.ok(!JSON.stringify(entry.payload).includes('Breast') && !JSON.stringify(entry.payload).includes('Asha Rao'), 'values stay out of the audit log');
    // nullable fields can be cleared
    assert.equal((await edit(owner.id, patient.id, { cancer_stage: null, diagnosis_date: null })).status, 200);
    assert.equal(patient.cancer_stage, null);
});

test('F2. care_plan_summary stays with the NGO; unknown/immutable fields, empty bodies and bad values are rejected', async () => {
    const { owner, patient } = await addPatientWithOwner();
    for (const body of [
        { care_plan_summary: 'x' }, { full_name: 'ok', care_plan_summary: 'x' }, { id: uuid() }, { created_at: '2020-01-01' }, { deleted_at: null },
        {}, { full_name: '' }, { full_name: null }, { date_of_birth: '2999-01-01' }, { date_of_birth: 'yesterday' }, { preferred_language: 'not a language' }, { diagnosis_date: '2999-01-01' }
    ]) {
        assert.equal((await edit(owner.id, patient.id, body)).status, 400, JSON.stringify(body));
    }
    assert.equal(patient.full_name, 'patient', 'nothing changed');
    assert.equal((await edit(owner.id, patient.id, 'nope')).status, 400);
    assert.equal((await edit(owner.id, 'bad-id', { full_name: 'x' })).status, 400);
});

test('F3. a DELEGATE with ACCOUNT_OPERATE can edit; one without it, caregivers, strangers and the NGO cannot', async () => {
    const { patient } = await addPatientWithOwner();
    const mkDelegate = async (name, scopes) => {
        const u = await addUser(name);
        await fakeDb.patientaccountlink.create({ data: { user_id: u.id, patient_id: patient.id, relationship_type: 'DELEGATE', access_scopes: scopes, granted_by: uuid() } });
        return u;
    };
    const good = await mkDelegate('delegate-ok', ['ACCOUNT_OPERATE']);
    const weak = await mkDelegate('delegate-weak', ['SYMPTOM_VIEW']);
    const cg = await addCaregiver('cg', { recognized: true }); await linkCaregiver(patient.id, cg.user.id);
    const stranger = await addUser('stranger');
    const ngo = await addNgo();

    assert.equal((await edit(good.id, patient.id, { cancer_type: 'Lung' })).status, 200);
    for (const u of [weak, cg.user, stranger, ngo]) {
        const r = await edit(u.id, patient.id, { cancer_type: 'Hacked' });
        assert.equal(r.status, 403, u.email);
    }
    assert.equal(patient.cancer_type, 'Lung');
});

test('F4. a revoked SELF / DELEGATE link can no longer edit', async () => {
    const { owner, patient } = await addPatientWithOwner();
    Object.assign(fakeDb.patientaccountlink._rows().find((l) => l.user_id === owner.id), { consent_status: 'REVOKED', revoked_at: new Date() });
    assert.equal((await edit(owner.id, patient.id, { full_name: 'x' })).status, 403);
});

// ---------------------------------------------------------------------------
// 5. GET /api/admin/patients/:id -> email of each account holder
// ---------------------------------------------------------------------------
test('G1. the NGO patient detail returns the e-mail of every account holder (current and revoked)', async () => {
    const ngo = await addNgo();
    const { owner, patient } = await addPatientWithOwner('Nila');
    const r = await call(adminController.getPatient, { userId: ngo.id, params: { id: patient.id } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const holder = r.body.data.account_holders.find((h) => h.user_id === owner.id);
    assert.equal(holder.user.email, owner.email);
    assert.equal(holder.user.id, owner.id);
    assert.equal(holder.is_active, true);
});


// ---------------------------------------------------------------------------
// 4. Concurrency hardening: user-level lock, atomic rate limit, conflict mapping, input validation
//    (advisory locks are simulated by the harness; the real-PostgreSQL versions live in tests/integration)
// ---------------------------------------------------------------------------
const mkCode = (patientId, code) => claimCodeFor(patientId, { code });
const register = (userId, body) => call(patientController.createPatientProfile, { userId, body });
const selfLinks = (userId) => fakeDb.patientaccountlink._rows().filter((l) => l.user_id === userId && l.relationship_type === 'SELF');

test('G1. parallel invalid claims cannot exceed the 5-per-hour limit', async () => {
    const guesser = await addUser('guesser');
    const results = await Promise.all(Array.from({ length: 9 }, (_, i) => claim(guesser.id, `1000000${i}`)));
    const statuses = results.map((r) => r.status);
    assert.equal(statuses.filter((s) => s === 400).length, 5, String(statuses));
    assert.equal(statuses.filter((s) => s === 429).length, 4, String(statuses));
    assert.equal(fakeDb.patientclaimattempt._rows().length, 5);
});

test('G2. the same user claiming two different patients at once gets at most one SELF profile', async () => {
    const [p1, p2] = [await mkPatient('One'), await mkPatient('Two')];
    await mkCode(p1.id, 'AAAA0001');
    await mkCode(p2.id, 'AAAA0002');
    const user = await addUser('greedy');
    const results = await Promise.all([claim(user.id, 'AAAA0001'), claim(user.id, 'AAAA0002')]);
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
    assert.equal(results.find((r) => r.status === 409).body.code, 'SELF_PROFILE_EXISTS');
    assert.equal(selfLinks(user.id).length, 1);
    // the losing code was NOT consumed
    assert.equal(fakeDb.caregiverinvite._rows().filter((i) => i.is_used).length, 1);
});

test('G3. two simultaneous self-registrations of one account create one patient and one SELF link', async () => {
    const user = await addUser('twice');
    const body = { full_name: 'Twice', date_of_birth: '1985-05-05' };
    const results = await Promise.all([register(user.id, body), register(user.id, body)]);
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
    assert.equal(fakeDb.patient._rows().length, 1);
    assert.equal(selfLinks(user.id).length, 1);
});

test('G4. lock order: user lock first, then patient lock; patient key shared with claim-code creation', async () => {
    const patient = await mkPatient();
    await mkCode(patient.id, 'BBBB0001');
    const user = await addUser('ordered');
    fakeDb._lockLog.length = 0;
    assert.equal((await claim(user.id, 'BBBB0001')).status, 201);
    assert.deepEqual(fakeDb._lockLog, [`patient_self_user:${user.id}`, `patient_self:${patient.id}`]);

    fakeDb._lockLog.length = 0;
    const ngo = await addNgo();
    await issue(ngo, (await mkPatient('Other')).id);   // claim-code creation uses the same patient namespace
    assert.ok(fakeDb._lockLog.length === 1 && fakeDb._lockLog[0].startsWith('patient_self:'));
});

test('G5. a rejected code COMMITS its failed attempt (returned, not thrown) incl. a deleted patient, without burning the code', async () => {
    const patient = await mkPatient();
    await mkCode(patient.id, 'CCCC0001');
    fakeDb.patient._rows()[0].deleted_at = new Date();
    const user = await addUser('late');
    assert.equal((await claim(user.id, 'CCCC0001')).status, 400);
    assert.equal(fakeDb.patientclaimattempt._rows().length, 1);
    assert.equal(fakeDb.caregiverinvite._rows()[0].is_used, false);
});

// P2002 (unique violation) -> response code depends on WHICH invariant is violated, checked after rollback.
const claimWithUniqueViolation = async ({ before }) => {
    const patient = await mkPatient();
    await mkCode(patient.id, 'DDDD0001');
    const user = await addUser('racer');
    const realCreate = fakeDb.patientaccountlink.create;
    fakeDb.patientaccountlink.create = async (args) => {
        fakeDb.patientaccountlink.create = realCreate;
        await before({ user, patient });                      // what the concurrent winner committed meanwhile
        throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002', meta: { target: 'secret_internal_index' } });
    };
    try { return await call(patientController.claimPatient, { userId: user.id, body: { code: 'DDDD0001' } }).catch((e) => ({ thrown: e })); }
    finally { fakeDb.patientaccountlink.create = realCreate; }
};

test('G6. P2002 maps to SELF_PROFILE_EXISTS when the user now has a SELF profile', async () => {
    const r = await claimWithUniqueViolation({ before: ({ user }) => realLink(user.id, uuid()) });
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'SELF_PROFILE_EXISTS');
});

test('G7. P2002 maps to SELF_LINK_EXISTS when somebody else now owns the patient', async () => {
    const r = await claimWithUniqueViolation({ before: async ({ patient }) => realLink((await addUser('winner')).id, patient.id) });
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'SELF_LINK_EXISTS');
    assert.ok(!JSON.stringify(r.body).includes('secret_internal_index'), 'no database details to the client');
});

test('G8. an unrelated unique violation is NOT mislabelled: it goes to the normal error handler', async () => {
    const r = await claimWithUniqueViolation({ before: () => {} });
    assert.equal(r.thrown && r.thrown.code, 'P2002');
});

const realLink = (userId, patientId) => {
    const rows = fakeDb.patientaccountlink._rows();
    rows.push({ id: uuid(), user_id: userId, patient_id: patientId, relationship_type: 'SELF', consent_status: 'GRANTED', revoked_at: null, access_scopes: ['ALL'] });
};

test('G9. self-registration validates input with the shared patient rules (clean 400, nothing written)', async () => {
    const user = await addUser('validator');
    const future = new Date(Date.now() + 86400_000 * 30).toISOString().slice(0, 10);
    const bad = [
        { full_name: 'X', date_of_birth: 'not-a-date' },
        { full_name: 'X', date_of_birth: future },
        { full_name: '   ', date_of_birth: '1990-01-01' },
        { full_name: 'X', date_of_birth: '1990-01-01', diagnosis_date: 'tomorrow' },
        { full_name: 'X', date_of_birth: '1990-01-01', is_admin: true },
        { full_name: 'X', date_of_birth: '1990-01-01', user_id: uuid() }
    ];
    for (const body of bad) {
        const r = await register(user.id, body);
        assert.equal(r.status, 400, JSON.stringify(body));
    }
    assert.equal(fakeDb.patient._rows().length, 0);
    assert.equal(fakeDb.patientaccountlink._rows().length, 0);

    const ok = await register(user.id, { full_name: ' Asha ', date_of_birth: '1990-01-01', preferred_language: 'hi', cancer_type: 'Breast', relationship_label: 'Self' });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.data.patient.full_name, 'Asha');
    assert.equal(ok.body.data.patient.preferred_language, 'hi');
    assert.equal(ok.body.data.link.access_scopes[0], 'ALL');
});
