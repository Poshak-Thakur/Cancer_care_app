/**
 * Dynamic Today's Check-in, alert lifecycle, push-delivery tracking, single NGO authority, CORS.
 * Runs with:  node --test tests/*.test.js      (in-memory fake DB, see tests/helpers/harness.js)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    fakeDb, storage, call, reset, uuid, addUser, addNgo, addPatientWithOwner, addCaregiver, linkCaregiver,
    auditActions, authz, adminController, alertController, checkInFormController, symptomController, rbac,
    whenNotificationsSettled, chatController
} = require('./helpers/harness');
const { createCorsOptions, getAllowedOrigins } = require('../src/config/cors');

test.beforeEach(reset);

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
const draftFor = async (ngo) => (await call(checkInFormController.createDraft, { userId: ngo.id })).body.data;
const addField = (ngo, versionId, body) => call(checkInFormController.addField, { userId: ngo.id, params: { versionId }, body });
const publish = (ngo, versionId) => call(checkInFormController.publishVersion, { userId: ngo.id, params: { versionId } });

const painField = { field_key: 'pain_level', label: 'Pain level', field_type: 'SCALE', is_required: true, validation_config: { min: 0, max: 10 } };
const moodField = { field_key: 'mood', label: 'How is your mood?', field_type: 'SINGLE_CHOICE', options: [{ label: 'Good' }, { label: 'Okay' }, { label: 'Low' }] };
const symptomsField = { field_key: 'symptoms', label: 'Symptoms today', field_type: 'MULTI_CHOICE', validation_config: { max_selections: 2 }, options: ['Nausea', 'Fatigue', 'Fever'] };
const noteField = { field_key: 'note', label: 'Anything else?', field_type: 'LONG_TEXT', validation_config: { max_length: 50 } };
const sleepField = { field_key: 'sleep_hours', label: 'Hours slept', field_type: 'NUMBER', is_required: true, validation_config: { min: 0, max: 24, integer: true } };
const tookMeds = { field_key: 'took_meds', label: 'Took medicines?', field_type: 'BOOLEAN' };

// builds + publishes a form with the given fields; returns { ngo, version (published), fieldByKey }
const publishedForm = async (fields, ngo = null) => {
    ngo = ngo || await addNgo();
    const draft = await draftFor(ngo);
    for (const f of fields) {
        const r = await addField(ngo, draft.id, f);
        assert.equal(r.status, 201, JSON.stringify(r.body));
    }
    const pub = await publish(ngo, draft.id);
    assert.equal(pub.status, 200, JSON.stringify(pub.body));
    const fieldByKey = Object.fromEntries(pub.body.data.fields.map((f) => [f.field_key, f]));
    return { ngo, version: pub.body.data, fieldByKey };
};

const submit = (userId, body) => call(symptomController.submitCheckIn, { userId, body });

// ---------------------------------------------------------------------------
// 1. Access control for form management
// ---------------------------------------------------------------------------
test('G1. the admin guard in front of every form-management route admits only the central NGO authority', async () => {
    const ngo = await addNgo();
    const { owner } = await addPatientWithOwner();
    const cg = await addCaregiver('cg', { recognized: true });
    const run = async (userId) => {
        let nexted = false; let status = null;
        const res = { status(c) { status = c; return this; }, json() { return this; } };
        await rbac.requireCentralCounsellor({ user: { userId } }, res, () => { nexted = true; });
        return { nexted, status };
    };
    assert.equal((await run(ngo.id)).nexted, true);
    for (const u of [owner.id, cg.user.id]) assert.deepEqual(await run(u), { nexted: false, status: 403 });

    // and the routes really are mounted behind that guard
    const fs = require('node:fs');
    const routes = fs.readFileSync(require.resolve('../src/routes/adminRoutes'), 'utf8');
    assert.ok(routes.indexOf('router.use(requireCentralCounsellor)') < routes.indexOf('/check-in-forms/current'));
    for (const r of ["get('/check-in-forms/current'", "post('/check-in-forms/drafts'", "post('/check-in-forms/:versionId/fields'",
        "patch('/check-in-fields/:fieldId'", "delete('/check-in-fields/:fieldId'", "post('/check-in-forms/:versionId/publish'"]) {
        assert.ok(routes.includes(r), `missing route ${r}`);
    }
    const appSrc = fs.readFileSync(require.resolve('../src/app'.replace('app', 'routes/checkInFormRoutes')), 'utf8');
    assert.ok(appSrc.includes("authMiddleware") && appSrc.includes("get('/form'"));
});

// ---------------------------------------------------------------------------
// 2. Draft -> publish lifecycle
// ---------------------------------------------------------------------------
test('G2. NGO creates a draft, adds fields, publishes; Flutter then fetches the published form', async () => {
    const { ngo, version } = await publishedForm([painField, moodField, symptomsField, noteField]);
    assert.equal(version.status, 'PUBLISHED');
    assert.equal(version.version_number, 1);
    assert.deepEqual(version.fields.map((f) => f.field_key), ['pain_level', 'mood', 'symptoms', 'note'], 'display order follows insertion');
    assert.deepEqual(version.fields[1].options.map((o) => o.option_value), ['good', 'okay', 'low']);

    const mobile = await call(checkInFormController.getPublishedForm, { userId: (await addUser('anyone')).id });
    assert.equal(mobile.status, 200);
    assert.equal(mobile.body.data.version.id, version.id);
    assert.equal(mobile.body.data.fields.length, 4);

    const actions = auditActions();
    for (const a of ['CHECKIN_FORM_CREATED', 'CHECKIN_DRAFT_CREATED', 'CHECKIN_FIELD_ADDED', 'CHECKIN_VERSION_PUBLISHED']) assert.ok(actions.includes(a), a);
    assert.equal(actions.filter((a) => a === 'CHECKIN_FIELD_ADDED').length, 4);
    const audit = fakeDb.auditlogentry._rows().find((a) => a.action === 'CHECKIN_VERSION_PUBLISHED');
    assert.equal(audit.actor_id, ngo.id);
    assert.equal(audit.target_resource, 'checkinformversion');
});

test('G3. Flutter gets 404 NO_PUBLISHED_FORM until something is published, and never sees a draft', async () => {
    const ngo = await addNgo();
    const user = await addUser('flutter');
    assert.equal((await call(checkInFormController.getPublishedForm, { userId: user.id })).body?.code, 'NO_PUBLISHED_FORM');
    const draft = await draftFor(ngo);
    await addField(ngo, draft.id, painField);
    const r = await call(checkInFormController.getPublishedForm, { userId: user.id });
    assert.equal(r.status, 404, 'a draft is not served');
});

test('G4. a new draft copies the published form; editing it never touches the published version; publishing archives the old one', async () => {
    const { ngo, version: v1, fieldByKey } = await publishedForm([painField, moodField]);
    const d2 = await draftFor(ngo);
    assert.equal(d2.version_number, 2);
    assert.deepEqual(d2.fields.map((f) => f.field_key), ['pain_level', 'mood']);
    assert.notEqual(d2.fields[0].id, fieldByKey.pain_level.id, 'a draft owns its own field rows');

    // creating a draft again returns the same draft
    const again = await call(checkInFormController.createDraft, { userId: ngo.id });
    assert.equal(again.status, 200);
    assert.equal(again.body.data.id, d2.id);

    // edit label / required / order in the draft
    const f = d2.fields.find((x) => x.field_key === 'pain_level');
    const upd = await call(checkInFormController.updateField, { userId: ngo.id, params: { fieldId: f.id }, body: { label: 'Pain right now', is_required: false, display_order: 9 } });
    assert.equal(upd.status, 200);
    assert.equal(upd.body.data.label, 'Pain right now');
    const published = fakeDb.checkinfield._rows().find((r) => r.id === fieldByKey.pain_level.id);
    assert.equal(published.label, 'Pain level', 'the published field row is untouched');

    assert.equal((await publish(ngo, d2.id)).status, 200);
    assert.equal(fakeDb.checkinformversion._rows().find((v) => v.id === v1.id).status, 'ARCHIVED');
    assert.equal(fakeDb.checkinformversion._rows().filter((v) => v.status === 'PUBLISHED').length, 1);
    assert.ok(auditActions().includes('CHECKIN_VERSION_ARCHIVED'));
    assert.equal((await call(checkInFormController.getCurrentForm, { userId: ngo.id })).body.data.published.version_number, 2);
});

test('G5. published and archived versions cannot be edited, extended or have fields deleted', async () => {
    const { ngo, version, fieldByKey } = await publishedForm([painField]);
    assert.equal((await addField(ngo, version.id, moodField)).body.code, 'VERSION_NOT_EDITABLE');
    const id = fieldByKey.pain_level.id;
    assert.equal((await call(checkInFormController.updateField, { userId: ngo.id, params: { fieldId: id }, body: { label: 'x' } })).status, 409);
    assert.equal((await call(checkInFormController.removeField, { userId: ngo.id, params: { fieldId: id } })).status, 409);
    assert.equal((await publish(ngo, version.id)).status, 409, 'already published');
    assert.ok(fakeDb.checkinfield._rows().some((r) => r.id === id), 'the field still exists');
});

test('G6. field_key / field_type are immutable; duplicate keys, bad ids and unknown records are rejected', async () => {
    const ngo = await addNgo();
    const draft = await draftFor(ngo);
    const r = await addField(ngo, draft.id, painField);
    const fieldId = r.body.data.id;
    assert.equal((await addField(ngo, draft.id, painField)).status, 409);
    const patch = (body) => call(checkInFormController.updateField, { userId: ngo.id, params: { fieldId }, body });
    assert.equal((await patch({ field_type: 'NUMBER' })).status, 400);
    assert.equal((await patch({ field_key: 'other' })).status, 400);
    assert.equal((await patch({})).status, 400);
    assert.equal((await call(checkInFormController.updateField, { userId: ngo.id, params: { fieldId: 'nope' }, body: {} })).status, 400);
    assert.equal((await call(checkInFormController.updateField, { userId: ngo.id, params: { fieldId: uuid() }, body: { label: 'x' } })).status, 404);
    assert.equal((await addField(ngo, uuid(), painField)).status, 404);
    assert.equal((await publish(ngo, 'nope')).status, 400);
});

test('G7. only controlled field types and whitelisted settings are accepted (no scripts, no free-form rules)', async () => {
    const ngo = await addNgo();
    const draft = await draftFor(ngo);
    const bad = [
        { ...painField, field_key: 'a1', field_type: 'SCRIPT' },
        { ...painField, field_key: 'Bad Key' },
        { ...painField, field_key: 'a2', validation_config: { min: 0, max: 10, pattern: '(a+)+$' } },
        { ...painField, field_key: 'a3', validation_config: { min: 5, max: 5 } },
        { ...painField, field_key: 'a4', validation_config: { expression: 'value > 3' } },
        { field_key: 'a5', label: 'Pick', field_type: 'SINGLE_CHOICE', options: ['only one'] },
        { field_key: 'a6', label: 'Pick', field_type: 'SINGLE_CHOICE', options: ['A', 'a'] },
        { field_key: 'a7', label: 'Text', field_type: 'TEXT', options: ['A', 'B'] },
        { field_key: 'a8', label: 'Num', field_type: 'NUMBER', validation_config: { min: 10, max: 1 } },
        { field_key: 'a9', label: '', field_type: 'TEXT' },
        { field_key: 'b1', label: 'Multi', field_type: 'MULTI_CHOICE', options: ['A', 'B'], validation_config: { min_selections: 3 } }
    ];
    for (const body of bad) {
        const r = await addField(ngo, draft.id, body);
        assert.equal(r.status, 400, `${body.field_key} should be rejected`);
        assert.equal(r.body.code, 'VALIDATION_FAILED');
        assert.ok(Array.isArray(r.body.errors) && r.body.errors.length > 0, 'field-level errors are returned for the web form');
    }
    assert.equal(fakeDb.checkinfield._rows().length, 0, 'nothing was stored');
});

test('G8. publishing validates the whole draft (needs at least one field) and reports the problems', async () => {
    const ngo = await addNgo();
    const draft = await draftFor(ngo);
    const empty = await publish(ngo, draft.id);
    assert.equal(empty.status, 400);
    assert.equal(empty.body.code, 'VALIDATION_FAILED');
    assert.equal(fakeDb.checkinformversion._rows()[0].status, 'DRAFT');
});

test('G9. removing a draft field leaves it out of the next version but keeps old versions and answers', async () => {
    const { ngo, version: v1, fieldByKey } = await publishedForm([painField, sleepField, moodField]);
    const { owner, patient } = await addPatientWithOwner();

    const first = await submit(owner.id, {
        patient_id: patient.id, client_event_id: uuid(), form_version_id: v1.id,
        answers: [{ field_id: fieldByKey.pain_level.id, value: 4 }, { field_id: fieldByKey.sleep_hours.id, value: 7 }, { field_id: fieldByKey.mood.id, value: 'good' }]
    });
    assert.equal(first.status, 201, JSON.stringify(first.body));

    const d2 = await draftFor(ngo);
    const sleepInDraft = d2.fields.find((f) => f.field_key === 'sleep_hours');
    assert.equal((await call(checkInFormController.removeField, { userId: ngo.id, params: { fieldId: sleepInDraft.id } })).status, 200);
    assert.equal((await publish(ngo, d2.id)).status, 200);

    const current = (await call(checkInFormController.getCurrentForm, { userId: ngo.id })).body.data.published;
    assert.deepEqual(current.fields.map((f) => f.field_key), ['pain_level', 'mood'], 'the removed field is not in the new version');
    assert.ok(fakeDb.checkinfield._rows().some((f) => f.id === fieldByKey.sleep_hours.id), 'old field definition still exists');
    const answers = fakeDb.checkinanswer._rows().filter((a) => a.symptom_event_id === first.body.data.id);
    assert.equal(answers.length, 3, 'old answers are intact');
    assert.equal(first.body.data.form_version_id, v1.id, 'the event still points at the version it was filled in');

    // the history API returns the answers together with the field they belonged to
    const history = await call(symptomController.getSymptomHistory, { userId: owner.id, params: { patient_id: patient.id } });
    const sleep = history.body.data[0].checkinanswer.find((a) => a.field_id === fieldByKey.sleep_hours.id);
    assert.equal(sleep.value_number, 7);
    assert.equal(sleep.field.label, 'Hours slept');
});

// ---------------------------------------------------------------------------
// 3. Submission validation
// ---------------------------------------------------------------------------
const setup = async () => {
    const form = await publishedForm([painField, sleepField, moodField, symptomsField, noteField, tookMeds]);
    const { owner, patient } = await addPatientWithOwner();
    const id = (k) => form.fieldByKey[k].id;
    const base = { patient_id: patient.id, form_version_id: form.version.id };
    const valid = () => [
        { field_id: id('pain_level'), value: 3 }, { field_id: id('sleep_hours'), value: 8 }, { field_id: id('mood'), value: 'okay' },
        { field_id: id('symptoms'), value: ['nausea', 'fatigue'] }, { field_id: id('note'), value: ' fine ' }, { field_id: id('took_meds'), value: true }
    ];
    return { ...form, owner, patient, id, base, valid };
};

test('H1. a valid versioned submission is stored with its form_version_id and typed answers', async () => {
    const s = await setup();
    const r = await submit(s.owner.id, { ...s.base, client_event_id: uuid(), answers: s.valid() });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.data.form_version_id, s.version.id);
    const rows = fakeDb.checkinanswer._rows();
    assert.equal(rows.length, 6);
    const by = (k) => rows.find((x) => x.field_id === s.id(k));
    assert.equal(by('pain_level').value_number, 3);
    assert.equal(by('mood').value_text, 'okay');
    assert.equal(by('mood').option_id, s.fieldByKey.mood.options.find((o) => o.option_value === 'okay').id);
    assert.deepEqual(by('symptoms').value_json, ['nausea', 'fatigue']);
    assert.equal(by('note').value_text, 'fine');
    assert.equal(by('took_meds').value_boolean, true);
});

test('H2. server-side validation: required fields, types, ranges, options, duplicates, unknown fields', async () => {
    const s = await setup();
    const attempt = async (mutate) => {
        const answers = s.valid(); mutate(answers);
        const r = await submit(s.owner.id, { ...s.base, client_event_id: uuid(), answers });
        return r;
    };
    const rejected = [
        (a) => a.splice(0, 1),                                                   // required pain_level missing
        (a) => { a[0].value = 11; },                                             // scale above max
        (a) => { a[0].value = 2.5; },                                            // scale must be whole
        (a) => { a[0].value = '3'; },                                            // wrong type
        (a) => { a[1].value = 7.5; },                                            // integer only
        (a) => { a[1].value = -1; },                                             // below min
        (a) => { a[1].value = 25; },                                             // above max
        (a) => { a[2].value = 'excellent'; },                                    // not an option
        (a) => { a[3].value = ['nausea', 'fatigue', 'fever']; },                 // more than max_selections
        (a) => { a[3].value = ['nausea', 'nausea']; },                           // duplicate selection
        (a) => { a[3].value = 'nausea'; },                                       // multi needs a list
        (a) => { a[4].value = 'x'.repeat(51); },                                 // longer than max_length
        (a) => { a[5].value = 'yes'; },                                          // boolean must be boolean
        (a) => { a.push({ ...a[0] }); },                                         // duplicate answer
        (a) => { a.push({ field_id: uuid(), value: 1 }); },                      // field of no version
        (a) => { a[0].field_id = 'not-a-uuid'; }
    ];
    for (const [i, mutate] of rejected.entries()) {
        const r = await attempt(mutate);
        assert.equal(r.status, 400, `case ${i}: ${JSON.stringify(r.body)}`);
    }
    assert.equal(fakeDb.symptomevent._rows().length, 0, 'a rejected submission writes nothing');
    assert.equal(fakeDb.checkinanswer._rows().length, 0);

    // optional blanks are fine; optional fields can simply be missing
    const lean = await submit(s.owner.id, { ...s.base, client_event_id: uuid(), answers: [{ field_id: s.id('pain_level'), value: 0 }, { field_id: s.id('sleep_hours'), value: 0 }, { field_id: s.id('note'), value: '' }] });
    assert.equal(lean.status, 201, JSON.stringify(lean.body));
    assert.equal(fakeDb.checkinanswer._rows().length, 2);
});

test('H3. field ids from another version, draft versions and unknown versions are rejected', async () => {
    const s = await setup();
    const d2 = await draftFor(s.ngo);
    const draftField = d2.fields.find((f) => f.field_key === 'pain_level');
    const mk = (versionId, fieldId) => submit(s.owner.id, { patient_id: s.patient.id, client_event_id: uuid(), form_version_id: versionId, answers: [{ field_id: fieldId, value: 1 }] });
    assert.equal((await mk(d2.id, draftField.id)).body.code, 'UNKNOWN_FORM_VERSION', 'drafts are never accepted');
    assert.equal((await mk(uuid(), s.id('pain_level'))).body.code, 'UNKNOWN_FORM_VERSION');
    assert.equal((await mk(s.version.id, draftField.id)).status, 400, 'a field of a different version');
    assert.equal((await submit(s.owner.id, { patient_id: s.patient.id, answers: [{ field_id: s.id('pain_level'), value: 1 }] })).status, 400, 'form_version_id required');
});

test('H4. a submission made under an older version is still accepted after a newer one is published (offline retry)', async () => {
    const s = await setup();
    const d2 = await draftFor(s.ngo);
    await addField(s.ngo, d2.id, { field_key: 'appetite', label: 'Appetite', field_type: 'SCALE' });
    await publish(s.ngo, d2.id);
    const r = await submit(s.owner.id, { ...s.base, client_event_id: uuid(), answers: s.valid() });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.data.form_version_id, s.version.id);
});

test('H5. patient access is still enforced (a stranger cannot submit answers)', async () => {
    const s = await setup();
    const stranger = await addUser('stranger');
    const r = await submit(stranger.id, { ...s.base, client_event_id: uuid(), answers: s.valid() });
    assert.equal(r.status, 403);
    assert.equal(fakeDb.symptomevent._rows().length, 0);
});

test('H6. old Flutter payloads (observations only, no version, no answers) keep working', async () => {
    const { owner, patient } = await addPatientWithOwner();
    const r = await submit(owner.id, { patient_id: patient.id, client_event_id: uuid(), observations: [{ observation_type: 'pain', severity: 4 }, { observation_type: 'nausea', severity: 2 }] });
    assert.equal(r.status, 201);
    assert.equal(r.body.data.form_version_id ?? null, null);
    assert.equal(fakeDb.symptomobservation._rows().length, 2);
    assert.equal(fakeDb.checkinanswer._rows().length, 0);
    assert.equal((await submit(owner.id, { patient_id: patient.id })).status, 400, 'still needs something to record');
    assert.equal((await submit(owner.id, { patient_id: patient.id, observations: [] })).status, 400);
    assert.equal((await submit(owner.id, { patient_id: patient.id, observations: [{ observation_type: 'pain', severity: 11 }] })).status, 400);
});

test('H7. configurable answers can never raise or change a medical alert; observations still do', async () => {
    const s = await setup();
    const loud = s.valid(); loud[0].value = 10;   // pain_level = 10 as a CUSTOM answer
    await submit(s.owner.id, { ...s.base, client_event_id: uuid(), answers: loud });
    assert.equal(fakeDb.alert._rows().length, 0, 'a custom answer alone never creates an alert');

    const both = await submit(s.owner.id, { ...s.base, client_event_id: uuid(), answers: s.valid(), observations: [{ observation_type: 'PAIN', severity: 9 }] });
    assert.equal(both.status, 201);
    assert.equal(fakeDb.alert._rows().length, 1, 'the established observation rule still fires');
    assert.equal(fakeDb.alert._rows()[0].rule_id, 'SEVERE_SYMPTOM_SCORE');
    assert.equal(fakeDb.checkinanswer._rows().length > 0, true, 'and the custom answers are stored alongside');
});

test('H8. offline retries (same client_event_id) never create duplicate check-ins, answers or alerts', async () => {
    const s = await setup();
    const eventId = uuid();
    const payload = { ...s.base, client_event_id: eventId, answers: s.valid(), observations: [{ observation_type: 'PAIN', severity: 9 }] };
    const a = await submit(s.owner.id, payload);
    const b = await submit(s.owner.id, payload);
    assert.equal(a.status, 201);
    assert.equal(b.status, 200);
    assert.equal(b.body.data.id, a.body.data.id);
    assert.equal(fakeDb.symptomevent._rows().length, 1);
    assert.equal(fakeDb.checkinanswer._rows().length, 6);
    assert.equal(fakeDb.alert._rows().length, 1);
    assert.equal(fakeDb.alertupdate._rows().filter((u) => u.type === 'NEW_TRIGGER').length, 0);
    // someone else cannot hijack the key
    const other = await addPatientWithOwner('other');
    assert.equal((await submit(other.owner.id, { patient_id: other.patient.id, client_event_id: eventId, observations: [{ observation_type: 'PAIN', severity: 1 }] })).status, 409);
});

// ---------------------------------------------------------------------------
// 4. Alert lifecycle + push delivery tracking
// ---------------------------------------------------------------------------
const openAlert = async (extra = {}) => {
    const { patient } = await addPatientWithOwner();
    return fakeDb.alert.create({ data: { patient_id: patient.id, type: 'DETERIORATION', severity: 'HIGH', status: 'OPEN', ...extra } });
};
const setStatus = (ngo, id, status) => call(adminController.updateAlertStatus, { userId: ngo.id, params: { id }, body: { status } });

test('I1. staff can only move an alert one step: OPEN -> ACKNOWLEDGED -> IN_PROGRESS -> RESOLVED', async () => {
    const ngo = await addNgo();
    const alert = await openAlert();
    assert.equal((await setStatus(ngo, alert.id, 'RESOLVED')).status, 409, 'cannot skip steps');
    assert.equal((await setStatus(ngo, alert.id, 'IN_PROGRESS')).status, 409);
    assert.equal(alert.status, 'OPEN');
    for (const next of ['ACKNOWLEDGED', 'IN_PROGRESS', 'RESOLVED']) {
        const r = await setStatus(ngo, alert.id, next);
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(alert.status, next);
    }
    assert.equal((await setStatus(ngo, alert.id, 'RESOLVED')).status, 200, 'repeating the current status is harmless');
    assert.equal(fakeDb.alertupdate._rows().filter((u) => u.type === 'STATUS_CHANGE').length, 3);
    assert.equal(fakeDb.auditlogentry._rows().filter((a) => a.action === 'ALERT_STATUS_CHANGED').length, 3);
});

test('I2. staff cannot reopen resolved alerts, go backwards, cancel (automatic or manual) or set system statuses', async () => {
    const ngo = await addNgo();
    const alert = await openAlert({ status: 'RESOLVED' });
    for (const s of ['OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS']) assert.equal((await setStatus(ngo, alert.id, s)).status, 409, `RESOLVED -> ${s}`);
    const auto = await openAlert();
    const cancel = await setStatus(ngo, auto.id, 'CANCELLED');
    assert.equal(cancel.status, 403, 'automatic alerts are not cancellable by staff either');
    assert.equal(cancel.body.code, 'ALERT_CANCEL_NOT_ALLOWED');
    assert.equal(auto.status, 'OPEN');
    assert.equal((await setStatus(ngo, auto.id, 'ESCALATION_EXHAUSTED')).status, 403);
    assert.equal((await setStatus(ngo, auto.id, 'WHATEVER')).status, 400);
    assert.equal((await setStatus(ngo, auto.id, undefined)).status, 400);
    const exhausted = await openAlert({ status: 'ESCALATION_EXHAUSTED' });
    assert.equal((await setStatus(ngo, exhausted.id, 'ACKNOWLEDGED')).status, 409);
    const cancelled = await openAlert({ status: 'CANCELLED' });
    assert.equal((await setStatus(ngo, cancelled.id, 'ACKNOWLEDGED')).status, 409);
    assert.equal((await setStatus(ngo, uuid(), 'ACKNOWLEDGED')).status, 404);
});

test('I3. a stale status change loses the compare-and-set instead of overwriting', async () => {
    const ngo = await addNgo();
    const alert = await openAlert();
    // another staff session moved it between our read and write
    const realFind = fakeDb.alert.findUnique;
    fakeDb.alert.findUnique = async (args) => {
        const row = await realFind(args);
        if (row && !fakeDb.alert._raced) { fakeDb.alert._raced = true; alert.status = 'ACKNOWLEDGED'; return row; }   // `row` is a copy taken before the other session's write
        return row;
    };
    try {
        const r = await setStatus(ngo, alert.id, 'ACKNOWLEDGED');
        assert.equal(r.status, 409);
        assert.equal(r.body.code, 'STALE_STATUS');
    } finally { fakeDb.alert.findUnique = realFind; delete fakeDb.alert._raced; }
});

const careCircleWithTokens = async () => {
    const ngo = await addNgo();
    const { owner, patient } = await addPatientWithOwner();
    const cg = await addCaregiver('cousin', { recognized: true });
    await linkCaregiver(patient.id, cg.user.id);
    await fakeDb.useraccount.update({ where: { id: ngo.id }, data: { fcm_token: 'tok-ngo' } });
    await fakeDb.useraccount.update({ where: { id: owner.id }, data: { fcm_token: 'tok-owner' } });
    return { ngo, owner, patient, cg };
};
const severe = (userId, patientId) => submit(userId, { patient_id: patientId, client_event_id: uuid(), observations: [{ observation_type: 'PAIN', severity: 9 }] });

test('J1. automatic deterioration alerts create delivery rows and mark them SENT after Firebase accepts', async () => {
    const { ngo, owner, patient, cg } = await careCircleWithTokens();
    const r = await severe(cg.user.id, patient.id);
    assert.equal(r.status, 201);
    await whenNotificationsSettled();
    const recipients = fakeDb.alertrecipient._rows().map((x) => x.recipient_user_id).sort();
    assert.deepEqual(recipients, [ngo.id, owner.id].sort());
    const deliveries = fakeDb.alertdelivery._rows();
    assert.equal(deliveries.length, 2, 'one delivery row per recipient (previously none for automatic alerts)');
    assert.ok(deliveries.every((d) => d.channel === 'PUSH' && d.delivery_status === 'SENT' && d.sent_at && !d.failed_at && !d.failure_reason));
    assert.deepEqual(storage.pushes.map((p) => p.token).sort(), ['tok-ngo', 'tok-owner']);
    assert.ok(storage.pushes.every((p) => !/pain|9|severity/i.test(p.body)), 'no clinical detail in the notification text');
});

test('J2. a refused push is marked FAILED with a reason and timestamp; missing tokens are FAILED too', async () => {
    const { ngo, owner, patient, cg } = await careCircleWithTokens();
    storage.failTokens.add('tok-owner');
    await fakeDb.useraccount.update({ where: { id: ngo.id }, data: { fcm_token: null } });
    await severe(cg.user.id, patient.id);
    await whenNotificationsSettled();
    const recipientOf = (userId) => fakeDb.alertrecipient._rows().find((r) => r.recipient_user_id === userId);
    const deliveryOf = (userId) => fakeDb.alertdelivery._rows().find((d) => d.alert_recipient_id === recipientOf(userId).id);
    const ownerDelivery = deliveryOf(owner.id);
    assert.equal(ownerDelivery.delivery_status, 'FAILED');
    assert.match(ownerDelivery.failure_reason, /^FCM_ERROR:/);
    assert.ok(ownerDelivery.failed_at instanceof Date);
    assert.equal(ownerDelivery.sent_at, undefined);
    const ngoDelivery = deliveryOf(ngo.id);
    assert.equal(ngoDelivery.delivery_status, 'FAILED');
    assert.equal(ngoDelivery.failure_reason, 'NO_DEVICE_TOKEN');
});

test('J3. Help Now uses the same tracking (SENT on success, FAILED on refusal)', async () => {
    const { ngo, owner, patient, cg } = await careCircleWithTokens();
    storage.failTokens.add('tok-ngo');
    const r = await call(alertController.createHelpNow, { userId: cg.user.id, body: { patient_id: patient.id, client_event_id: uuid() } });
    assert.equal(r.status, 201);
    await whenNotificationsSettled();
    const status = (userId) => {
        const rec = fakeDb.alertrecipient._rows().find((x) => x.recipient_user_id === userId);
        return fakeDb.alertdelivery._rows().find((d) => d.alert_recipient_id === rec.id);
    };
    assert.equal(status(owner.id).delivery_status, 'SENT');
    assert.equal(status(ngo.id).delivery_status, 'FAILED');
});

test('J4. a repeated trigger while the alert is open does not notify or create deliveries again', async () => {
    const { patient, cg } = await careCircleWithTokens();
    await severe(cg.user.id, patient.id);
    await severe(cg.user.id, patient.id);
    await whenNotificationsSettled();
    assert.equal(fakeDb.alert._rows().length, 1);
    assert.equal(fakeDb.alertdelivery._rows().length, 2);
    assert.equal(storage.pushes.length, 2);
});

// ---------------------------------------------------------------------------
// 5. Single central NGO authority
// ---------------------------------------------------------------------------
test('K1. a second central-role staff account does not gain central access', async () => {
    const first = await addNgo();
    await fakeDb.staffprofile.update({ where: { user_id: first.id }, data: { created_at: new Date('2025-01-01') } });
    const second = await addUser('second-admin');
    await fakeDb.staffprofile.create({ data: { user_id: second.id, is_active: true, roles: ['ADMIN'], created_at: new Date('2026-01-01') } });
    assert.equal(await authz.isCentralCounsellor(first.id), true);
    assert.equal(await authz.isCentralCounsellor(second.id), false, 'the newer account is NOT a second authority');
    assert.deepEqual(await authz.getCentralCounsellorUserIds(), [first.id]);
    const { patient } = await addPatientWithOwner();
    assert.equal(await authz.getPatientAccessContext(second.id, patient.id), null, 'no global patient access');
});

test('K2. the ngoauthority singleton is authoritative; losing its staff profile fails closed', async () => {
    const a = await addNgo();
    const b = await addUser('b');
    await fakeDb.staffprofile.create({ data: { user_id: b.id, is_active: true, roles: ['COUNSELLOR'] } });
    await fakeDb.ngoauthority.create({ data: { key: 'CENTRAL', user_id: b.id } });
    assert.equal(await authz.isCentralCounsellor(b.id), true);
    assert.equal(await authz.isCentralCounsellor(a.id), false);
    await fakeDb.staffprofile.updateMany({ where: { user_id: b.id }, data: { is_active: false } });
    assert.equal(await authz.isCentralCounsellor(b.id), false);
    assert.equal(await authz.isCentralCounsellor(a.id), false, 'no silent fallback to another account');
    assert.deepEqual(await authz.getCentralCounsellorUserIds(), []);
});

test('K3. alert recipients include only the single authority', async () => {
    const first = await addNgo();
    await fakeDb.staffprofile.update({ where: { user_id: first.id }, data: { created_at: new Date('2025-01-01') } });
    const second = await addUser('second');
    await fakeDb.staffprofile.create({ data: { user_id: second.id, is_active: true, roles: ['ADMIN'], created_at: new Date('2026-01-01') } });
    const { patient } = await addPatientWithOwner();
    const ids = await require('../src/services/alertService').getAlertRecipientUserIds(fakeDb, patient.id);
    assert.ok(ids.includes(first.id) && !ids.includes(second.id));
});

// ---------------------------------------------------------------------------
// 6. CORS
// ---------------------------------------------------------------------------
const askOrigin = (options, origin) => new Promise((resolve) => options.origin(origin, (err, ok) => resolve(ok)));

test('L1. CORS: explicit allowlist from the environment, credentials on, never a wildcard', async () => {
    const env = { NODE_ENV: 'development', CORS_ALLOWED_ORIGINS: 'https://ngo.saathi.org, http://localhost:5173/ ,*' };
    const opts = createCorsOptions(env);
    assert.equal(opts.credentials, true);
    assert.deepEqual(getAllowedOrigins(env), ['https://ngo.saathi.org', 'http://localhost:5173']);
    assert.equal(await askOrigin(opts, 'https://ngo.saathi.org'), true);
    assert.equal(await askOrigin(opts, 'http://localhost:5173'), true, 'actual local NGO-web dev origin');
    assert.equal(await askOrigin(opts, 'https://evil.example'), false);
    assert.equal(await askOrigin(opts, 'https://ngo.saathi.org.evil.example'), false);
    assert.equal(await askOrigin(opts, undefined), true, 'the Flutter app sends no Origin header');
    assert.ok(opts.allowedHeaders.includes('Authorization'));
});

test('L2. CORS defaults: production lists only the deployed sites; development only local dev servers', async () => {
    const prod = createCorsOptions({ NODE_ENV: 'production' });
    assert.equal(await askOrigin(prod, 'https://ngo.saathi.org'), true);
    assert.equal(await askOrigin(prod, 'http://localhost:5173'), false);
    const dev = createCorsOptions({ NODE_ENV: 'development' });
    assert.equal(await askOrigin(dev, 'http://localhost:5173'), true);
    assert.equal(await askOrigin(dev, 'https://random.example'), false, 'no wildcard even in development');
});

test('L3. app.js uses the allowlist, mounts the form router before symptomRoutes and has no wildcard', () => {
    const src = require('node:fs').readFileSync(require.resolve('../src/app.js'), 'utf8');
    assert.ok(src.includes('createCorsOptions()'));
    assert.ok(!/origin:\s*['"]\*['"]/.test(src) && !src.includes(": '*'"));
    assert.ok(src.indexOf("'/api/symptoms/check-in', checkInFormRoutes") < src.indexOf("'/api/symptoms', symptomRoutes"));
});

// ---------------------------------------------------------------------------
// 7. Chat conversation identity (matches the DB unique constraints)
// ---------------------------------------------------------------------------
test('M1. conversations store the participant pair in a consistent order and are reused from either side', async () => {
    const ngo = await addNgo();
    const { owner, patient } = await addPatientWithOwner();
    const open = (userId, participant_id, patient_id) => call(chatController.openThread, { userId, body: { participant_id, ...(patient_id ? { patient_id } : {}) } });
    const a = await open(owner.id, ngo.id, patient.id);
    assert.equal(a.status, 200, JSON.stringify(a.body));
    const b = await open(ngo.id, owner.id, patient.id);
    assert.equal(b.body.data.id, a.body.data.id, 'same conversation from the other side');
    const patientless = await open(owner.id, ngo.id);
    assert.equal(patientless.status, 200);
    assert.notEqual(patientless.body.data.id, a.body.data.id, 'the patientless helpline thread is separate');
    assert.equal((await open(owner.id, ngo.id)).body.data.id, patientless.body.data.id);
    assert.equal(fakeDb.chatconversation._rows().length, 2);
    for (const row of fakeDb.chatconversation._rows()) {
        assert.ok(row.participant_one_id < row.participant_two_id, 'smaller id is always participant_one');
    }
});
