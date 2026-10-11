/**
 * REAL-DATABASE CONCURRENCY TESTS (Prisma 7 client + PostgreSQL / Supabase)
 * ------------------------------------------------------------------
 * The in-memory tests cannot prove the PostgreSQL guarantees (advisory locks, partial unique
 * indexes). These tests run the REAL controllers/services against a REAL database.
 *
 *   RUN_DB_TESTS=1 ALLOW_DB_TEST_WRITES=1 DIRECT_URL=postgresql://... \
 *       node --test tests/integration/postgres.integration.test.js
 *
 * !! Point DIRECT_URL at a DEVELOPMENT database only !!  The tests create (and delete) their own
 * patients / users. DB4 touches the shared "todays_checkin" form, so it snapshots that form first and
 * restores it afterwards (test versions removed, the original published version re-published).
 * Without RUN_DB_TESTS=1 and ALLOW_DB_TEST_WRITES=1 every test here is skipped.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const ENABLED = process.env.RUN_DB_TESTS === '1' && process.env.ALLOW_DB_TEST_WRITES === '1' && !!process.env.DIRECT_URL;
const opts = { skip: ENABLED ? false : 'set RUN_DB_TESTS=1, ALLOW_DB_TEST_WRITES=1 and DIRECT_URL (development database only)' };

let prisma; let raiseOrUpdateAlert; let symptomController; let checkInFormController; let patientController; let adminController; let HttpError;
if (ENABLED) {
    prisma = require('../../src/config/db');
    ({ raiseOrUpdateAlert } = require('../../src/services/alertService'));
    symptomController = require('../../src/controllers/symptomController');
    checkInFormController = require('../../src/controllers/checkInFormController');
    patientController = require('../../src/controllers/patientController');
    adminController = require('../../src/controllers/adminController');
    HttpError = require('../../src/utils/httpError');
}

const created = { users: [], patients: [] };
const mkUser = async (tag) => {
    const u = await prisma.useraccount.create({ data: { email: `it-${tag}-${crypto.randomUUID()}@integration.test` } });
    created.users.push(u.id);
    return u;
};
const mkPatientWithOwner = async () => {
    const owner = await mkUser('owner');
    const patient = await prisma.patient.create({ data: { full_name: 'Integration Patient', date_of_birth: new Date('1980-01-01') } });
    created.patients.push(patient.id);
    await prisma.patientaccountlink.create({ data: { user_id: owner.id, patient_id: patient.id, relationship_type: 'SELF', access_scopes: ['ALL'] } });
    return { owner, patient };
};

// ---- shared "todays_checkin" form: snapshot before DB4, restore afterwards -------------------------
const FORM_SLUG = 'todays_checkin';
const snapshotSharedForm = async () => {
    const form = await prisma.checkinform.findUnique({ where: { slug: FORM_SLUG } });
    const versions = form ? await prisma.checkinformversion.findMany({ where: { form_id: form.id } }) : [];
    return { form, versions };
};
const restoreSharedForm = async (snap) => {
    const form = await prisma.checkinform.findUnique({ where: { slug: FORM_SLUG } });
    if (!form) return;
    const keep = new Set(snap.versions.map((v) => v.id));
    const current = await prisma.checkinformversion.findMany({ where: { form_id: form.id }, select: { id: true } });
    const doomed = current.map((v) => v.id).filter((id) => !keep.has(id));
    if (doomed.length > 0) {   // versions created by the test (fields -> options -> versions)
        const fields = await prisma.checkinfield.findMany({ where: { version_id: { in: doomed } }, select: { id: true } });
        const fieldIds = fields.map((f) => f.id);
        await prisma.checkinanswer.deleteMany({ where: { field_id: { in: fieldIds } } });
        await prisma.checkinfieldoption.deleteMany({ where: { field_id: { in: fieldIds } } });
        await prisma.checkinfield.deleteMany({ where: { version_id: { in: doomed } } });
        await prisma.checkinformversion.deleteMany({ where: { id: { in: doomed } } });
    }
    for (const v of snap.versions) {   // original statuses (e.g. the previously PUBLISHED version again)
        await prisma.checkinformversion.update({
            where: { id: v.id },
            data: { status: v.status, published_at: v.published_at, published_by: v.published_by, archived_at: v.archived_at, updated_at: v.updated_at }
        });
    }
    if (!snap.form) {   // the form did not exist before the test created it
        await prisma.checkinform.deleteMany({ where: { id: form.id } });
    }
};
const indexExists = async (name) => (await prisma.$queryRaw`SELECT 1 FROM pg_indexes WHERE indexname = ${name}`).length > 0;

const run = async (handler, { userId, body = {}, params = {} }) => {
    const out = { status: 200, body: undefined };
    const res = { status(c) { out.status = c; return this; }, json(b) { out.body = b; return this; } };
    let error;
    await handler({ user: { userId }, body, params, query: {}, ip: '127.0.0.1', get: () => 'it' }, res, (e) => { error = e; });
    if (error instanceof HttpError) return { status: error.status, body: { code: error.code, message: error.message } };
    if (error) throw error;
    return out;
};

test.after(async () => {
    if (!ENABLED) return;
    for (const patientId of created.patients) {
        const events = await prisma.symptomevent.findMany({ where: { patient_id: patientId }, select: { id: true } });
        await prisma.checkinanswer.deleteMany({ where: { symptom_event_id: { in: events.map((e) => e.id) } } });
        await prisma.symptomobservation.deleteMany({ where: { symptom_event_id: { in: events.map((e) => e.id) } } });
        await prisma.symptomevent.deleteMany({ where: { patient_id: patientId } });
        const alerts = await prisma.alert.findMany({ where: { patient_id: patientId }, select: { id: true } });
        const alertIds = alerts.map((a) => a.id);
        const recips = await prisma.alertrecipient.findMany({ where: { alert_id: { in: alertIds } }, select: { id: true } });
        await prisma.alertdelivery.deleteMany({ where: { alert_recipient_id: { in: recips.map((r) => r.id) } } });
        await prisma.alertrecipient.deleteMany({ where: { alert_id: { in: alertIds } } });
        await prisma.alertupdate.deleteMany({ where: { alert_id: { in: alertIds } } });
        await prisma.alert.deleteMany({ where: { patient_id: patientId } });
        await prisma.patientaccountlink.deleteMany({ where: { patient_id: patientId } });
        await prisma.patient.deleteMany({ where: { id: patientId } });
    }
    await prisma.useraccount.deleteMany({ where: { id: { in: created.users } } });
    await prisma.$disconnect();
});

test('DB1. the advisory-lock statement runs on the real Prisma client + PostgreSQL', opts, async () => {
    await prisma.$transaction(async (tx) => {
        const affected = await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'alert:' + crypto.randomUUID()}))`;
        assert.equal(typeof affected, 'number');
    });
});

test('DB2. 25 concurrent triggers for one patient/rule create exactly ONE alert', opts, async () => {
    const { owner, patient } = await mkPatientWithOwner();
    const results = await Promise.all(Array.from({ length: 25 }, () => prisma.$transaction((tx) => raiseOrUpdateAlert(tx, {
        patientId: patient.id, type: 'DETERIORATION', ruleId: 'SEVERE_SYMPTOM_SCORE', actorId: owner.id, sourceType: 'CHECK_IN'
    }))));
    assert.equal(await prisma.alert.count({ where: { patient_id: patient.id } }), 1, 'no duplicate alerts');
    assert.equal(results.filter((r) => r.created).length, 1);
    assert.equal(results.filter((r) => r.notify).length, 1, 'only the creating request notifies');
    assert.equal(await prisma.alertupdate.count({ where: { alert: { patient_id: patient.id } } }), 24);
});

test('DB3. concurrent identical check-in submissions (offline retries) store one event and one alert', opts, async () => {
    const { owner, patient } = await mkPatientWithOwner();
    const body = { patient_id: patient.id, client_event_id: crypto.randomUUID(), observations: [{ observation_type: 'PAIN', severity: 9 }] };
    const replies = await Promise.all(Array.from({ length: 10 }, () => run(symptomController.submitCheckIn, { userId: owner.id, body })));
    assert.ok(replies.every((r) => r.status === 200 || r.status === 201));
    assert.equal(replies.filter((r) => r.status === 201).length, 1);
    assert.equal(await prisma.symptomevent.count({ where: { patient_id: patient.id } }), 1);
    assert.equal(await prisma.alert.count({ where: { patient_id: patient.id } }), 1);
});

test('DB4. concurrent draft creation yields ONE draft; concurrent publish succeeds exactly once', opts, async () => {
    const snap = await snapshotSharedForm();
    try {
        const ngo = await mkUser('ngo');
        const drafts = await Promise.all(Array.from({ length: 8 }, () => run(checkInFormController.createDraft, { userId: ngo.id })));
        assert.ok(drafts.every((d) => d.status === 200 || d.status === 201), JSON.stringify(drafts.map((d) => d.status)));
        const ids = new Set(drafts.map((d) => d.body.data.id));
        assert.equal(ids.size, 1, 'everyone got the same draft');
        const versionId = [...ids][0];

        const add = await run(checkInFormController.addField, { userId: ngo.id, params: { versionId }, body: { field_key: `it_${Date.now()}`, label: 'Integration', field_type: 'SCALE' } });
        assert.equal(add.status, 201, JSON.stringify(add.body));

        const publishes = await Promise.all(Array.from({ length: 5 }, () => run(checkInFormController.publishVersion, { userId: ngo.id, params: { versionId } })));
        assert.equal(publishes.filter((p) => p.status === 200).length, 1, 'exactly one publish wins');
        assert.ok(publishes.filter((p) => p.status !== 200).every((p) => p.status === 409));
        const form = await prisma.checkinform.findUnique({ where: { slug: 'todays_checkin' } });
        assert.equal(await prisma.checkinformversion.count({ where: { form_id: form.id, status: 'PUBLISHED' } }), 1);
    } finally {
        await restoreSharedForm(snap);
    }
});

test('DB5. 8 simultaneous claims of one patient claim code: exactly one SELF link, one winner', opts, async () => {
    const ngo = await mkUser('ngo');
    const patient = await prisma.patient.create({ data: { full_name: 'Claim Target', date_of_birth: new Date('1980-01-01') } });
    created.patients.push(patient.id);
    const issuedCode = await run(adminController.createPatientClaimCode, { userId: ngo.id, params: { id: patient.id } });
    assert.equal(issuedCode.status, 201, JSON.stringify(issuedCode.body));
    const claimers = await Promise.all(Array.from({ length: 8 }, (_, i) => mkUser(`claimer${i}`)));
    const results = await Promise.all(claimers.map((u) => run(patientController.claimPatient, { userId: u.id, body: { code: issuedCode.body.data.code } })));
    assert.equal(results.filter((r) => r.status === 201).length, 1, JSON.stringify(results.map((r) => r.status)));
    assert.ok(results.filter((r) => r.status !== 201).every((r) => r.status === 400 || r.status === 409));
    assert.equal(await prisma.patientaccountlink.count({ where: { patient_id: patient.id, relationship_type: 'SELF', consent_status: 'GRANTED', revoked_at: null } }), 1);
});

const code8 = async (ngo, patientId) => {
    const issued = await run(adminController.createPatientClaimCode, { userId: ngo.id, params: { id: patientId } });
    assert.equal(issued.status, 201, JSON.stringify(issued.body));
    return issued.body.data.code;
};
const mkBarePatient = async (name) => {
    const patient = await prisma.patient.create({ data: { full_name: name, date_of_birth: new Date('1980-01-01') } });
    created.patients.push(patient.id);
    return patient;
};
const selfLinkCount = (userId) => prisma.patientaccountlink.count({ where: { user_id: userId, relationship_type: 'SELF' } });

test('DB6. same user claims two different patient codes simultaneously: one success, one SELF profile', opts, async () => {
    const ngo = await mkUser('ngo');
    const [p1, p2] = [await mkBarePatient('Claim A'), await mkBarePatient('Claim B')];
    const [c1, c2] = [await code8(ngo, p1.id), await code8(ngo, p2.id)];
    const user = await mkUser('greedy');
    const results = await Promise.all([c1, c2].map((code) => run(patientController.claimPatient, { userId: user.id, body: { code } })));
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409], JSON.stringify(results.map((r) => r.body)));
    assert.equal(results.find((r) => r.status === 409).body.code, 'SELF_PROFILE_EXISTS');
    assert.equal(await selfLinkCount(user.id), 1);
});

test('DB7. same user creating two self-registration profiles concurrently: one patient, one SELF link', opts, async () => {
    const user = await mkUser('registrant');
    const body = { full_name: 'Integration Self', date_of_birth: '1985-05-05' };
    const results = await Promise.all(Array.from({ length: 6 }, () => run(patientController.createPatientProfile, { userId: user.id, body })));
    const links = await prisma.patientaccountlink.findMany({ where: { user_id: user.id, relationship_type: 'SELF' } });
    links.forEach((l) => created.patients.push(l.patient_id));   // for cleanup, whatever happened
    assert.equal(results.filter((r) => r.status === 201).length, 1, JSON.stringify(results.map((r) => r.status)));
    assert.ok(results.filter((r) => r.status !== 201).every((r) => r.status === 409));
    assert.equal(links.length, 1);
    assert.equal(await prisma.patient.count({ where: { id: { in: links.map((l) => l.patient_id) } } }), 1);
});

test('DB8. 12 invalid claims in parallel record at most 5 failed attempts; the rest get 429', opts, async () => {
    const user = await mkUser('guesser');
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => run(patientController.claimPatient, { userId: user.id, body: { code: `2000000${i % 10}` } })));
    const statuses = results.map((r) => r.status);
    assert.equal(statuses.filter((s) => s === 400).length, 5, String(statuses));
    assert.equal(statuses.filter((s) => s === 429).length, 7, String(statuses));
    assert.equal(await prisma.patientclaimattempt.count({ where: { user_id: user.id } }), 5);
});

test('DB9. different users claim the same patient concurrently: one active SELF link', opts, async () => {
    const ngo = await mkUser('ngo');
    const patient = await mkBarePatient('Contested');
    const code = await code8(ngo, patient.id);
    const claimers = await Promise.all(Array.from({ length: 6 }, (_, i) => mkUser(`rival${i}`)));
    const results = await Promise.all(claimers.map((u) => run(patientController.claimPatient, { userId: u.id, body: { code } })));
    assert.equal(results.filter((r) => r.status === 201).length, 1, JSON.stringify(results.map((r) => r.status)));
    assert.ok(results.filter((r) => r.status !== 201).every((r) => [400, 409].includes(r.status)));
    assert.equal(await prisma.patientaccountlink.count({ where: { patient_id: patient.id, relationship_type: 'SELF', consent_status: 'GRANTED', revoked_at: null } }), 1);
});

test('DB10. unique indexes + correct conflict codes (needs prisma/migrations_pending/*self_uniqueness_indexes applied)', opts, async (t) => {
    if (!(await indexExists('uq_one_active_self_per_patient')) || !(await indexExists('uq_one_self_per_user'))) {
        return t.skip('apply the self_uniqueness_indexes migration first');
    }
    const { owner, patient } = await mkPatientWithOwner();

    // DB backstop: a second active SELF link for the same patient / a second SELF for the same user is refused.
    const other = await mkUser('other');
    await assert.rejects(prisma.patientaccountlink.create({ data: { user_id: other.id, patient_id: patient.id, relationship_type: 'SELF', access_scopes: ['ALL'] } }), (e) => e.code === 'P2002');
    const patient2 = await mkBarePatient('Second');
    await assert.rejects(prisma.patientaccountlink.create({ data: { user_id: owner.id, patient_id: patient2.id, relationship_type: 'SELF', access_scopes: ['ALL'] } }), (e) => e.code === 'P2002');

    // Revoked history stays allowed for the per-patient rule (a revoked row does not block a new active one).
    await prisma.patientaccountlink.updateMany({ where: { patient_id: patient.id, user_id: owner.id }, data: { consent_status: 'REVOKED', revoked_at: new Date() } });
    const heir = await prisma.patientaccountlink.create({ data: { user_id: other.id, patient_id: patient.id, relationship_type: 'SELF', access_scopes: ['ALL'] } });
    assert.ok(heir.id);

    // Controller-level codes
    const ngo = await mkUser('ngo');
    const p3 = await mkBarePatient('Third');
    const code = await code8(ngo, p3.id);
    const mine = await run(patientController.claimPatient, { userId: owner.id, body: { code } });
    assert.equal(mine.body.code, 'SELF_PROFILE_EXISTS');        // owner still has a (revoked) SELF row: one per account
    const taken = await mkPatientWithOwner();
    const stranger = await mkUser('stranger');
    await prisma.caregiverinvite.create({ data: { patient_id: taken.patient.id, code: 'FEEDF00D', invite_kind: 'PATIENT_CLAIM', expires_at: new Date(Date.now() + 3600_000) } });
    const lost = await run(patientController.claimPatient, { userId: stranger.id, body: { code: 'FEEDF00D' } });
    assert.equal(lost.body.code, 'SELF_LINK_EXISTS');
    await prisma.caregiverinvite.deleteMany({ where: { patient_id: { in: [taken.patient.id, p3.id] } } });
});

test('DB11. same instant gives identical IST day boundaries under server TZ=UTC and TZ=Asia/Kolkata', opts, async () => {
    const { execFileSync } = require('node:child_process');
    const helper = require('node:path').join(__dirname, '..', '..', 'src', 'utils', 'timezoneHelper.js');
    const script = "const {getISTDayBoundaries:g}=require(process.argv[1]);const r=g('2026-10-10T18:29:59.999Z');process.stdout.write(JSON.stringify(r));";
    const at = (tz) => execFileSync(process.execPath, ['-e', script, helper], { env: { ...process.env, TZ: tz }, encoding: 'utf8' });
    assert.equal(at('UTC'), at('Asia/Kolkata'));
});
