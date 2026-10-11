/**
 * Security regression tests: caregiver recognition, caregiver/delegate access, revocation,
 * chat authorization, consent history, audit trail.
 *
 * Runs with Node's built-in runner (no extra dependencies, no database):
 *     node --test tests/
 * Prisma is replaced by an in-memory fake (tests/helpers/harness.js); the REAL controllers and the
 * REAL authorizationService run against it.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    fakeDb, call, reset, addUser, addNgo, addPatientWithOwner, addCaregiver, linkCaregiver, addInvite, auditActions,
    authz, alertService, caregiverController, patientController, adminController, chatController,
    DEFAULT_CAREGIVER_SCOPES, SCOPES
} = require('./helpers/harness');

test.beforeEach(reset);

// ---------------------------------------------------------------------------
// Recognition
// ---------------------------------------------------------------------------
test('1. a new caregiver starts NOT_RECOGNIZED', async () => {
    const u = await addUser('rahul');
    const r = await call(caregiverController.upsertProfile, { userId: u.id, body: { full_name: 'Rahul', caregiver_type: 'VOLUNTEER' } });
    assert.equal(r.status, 200);
    const profile = fakeDb.caregiverprofile._rows()[0];
    assert.equal(profile.caregiver_type, 'VOLUNTEER');
    assert.equal(profile.ngo_recognition_status, 'NOT_RECOGNIZED');
    assert.equal(profile.recognized_by, null);
    assert.equal(profile.recognized_at, null);
});

test('2. a caregiver cannot self-recognize', async () => {
    const u = await addUser('rahul');
    for (const field of ['recognized', 'ngo_recognition_status', 'recognized_by', 'recognized_at']) {
        const r = await call(caregiverController.upsertProfile, {
            userId: u.id, body: { full_name: 'Rahul', caregiver_type: 'FAMILY', [field]: field === 'recognized' ? true : 'RECOGNIZED' }
        });
        assert.equal(r.status, 403, field);
    }
    assert.equal(fakeDb.caregiverprofile._rows().length, 0);
});

test('3. the NGO can recognize a caregiver', async () => {
    const ngo = await addNgo();
    const cg = await addCaregiver('rahul');
    const r = await call(adminController.setCaregiverRecognition, { userId: ngo.id, params: { user_id: cg.user.id }, body: { recognized: true } });
    assert.equal(r.status, 200);
    assert.equal(cg.profile.ngo_recognition_status, 'RECOGNIZED');
    assert.equal(cg.profile.recognized_by, ngo.id);
    assert.ok(cg.profile.recognized_at instanceof Date);
});

test('4. the NGO can remove caregiver recognition', async () => {
    const ngo = await addNgo();
    const cg = await addCaregiver('rahul', { recognized: true });
    cg.profile.recognized_by = ngo.id;
    const r = await call(adminController.setCaregiverRecognition, { userId: ngo.id, params: { user_id: cg.user.id }, body: { recognized: false } });
    assert.equal(r.status, 200);
    assert.equal(cg.profile.ngo_recognition_status, 'NOT_RECOGNIZED');
    assert.equal(cg.profile.recognized_by, null);
    assert.equal(cg.profile.recognized_at, null);
    // body must be a real boolean
    const bad = await call(adminController.setCaregiverRecognition, { userId: ngo.id, params: { user_id: cg.user.id }, body: { recognized: 'yes' } });
    assert.equal(bad.status, 400);
});

test('5. recognition and its removal create audit records', async () => {
    const ngo = await addNgo();
    const cg = await addCaregiver('rahul');
    await call(adminController.setCaregiverRecognition, { userId: ngo.id, params: { user_id: cg.user.id }, body: { recognized: true } });
    await call(adminController.setCaregiverRecognition, { userId: ngo.id, params: { user_id: cg.user.id }, body: { recognized: false } });
    assert.deepEqual(auditActions(), ['CAREGIVER_RECOGNIZED', 'CAREGIVER_RECOGNITION_REVOKED']);
    const [first] = fakeDb.auditlogentry._rows();
    assert.equal(first.actor_id, ngo.id);
    assert.equal(first.payload.target_user_id, cg.user.id);
    assert.equal(first.target_resource, 'caregiverprofile');
    // a no-op change is not audited as an action
    await call(adminController.setCaregiverRecognition, { userId: ngo.id, params: { user_id: cg.user.id }, body: { recognized: false } });
    assert.equal(fakeDb.auditlogentry._rows().length, 2);
});

// ---------------------------------------------------------------------------
// Invites
// ---------------------------------------------------------------------------
test('6. an unrecognized caregiver cannot accept a patient invite', async () => {
    const { patient } = await addPatientWithOwner();
    const cg = await addCaregiver('rahul');
    const invite = await addInvite(patient.id);
    const r = await call(caregiverController.acceptInvite, { userId: cg.user.id, body: { invite_code: 'ABCD1234' } });
    assert.equal(r.status, 403);
    assert.equal(r.body.message, 'Caregiver recognition by the NGO is required before linking to a patient.');
    assert.equal(fakeDb.patientcaregiverlink._rows().length, 0);
    assert.equal(invite.is_used, false, 'the invite must not be burned');
});

test('7. a recognized caregiver can accept a valid invite', async () => {
    const { patient } = await addPatientWithOwner();
    const cg = await addCaregiver('rahul', { recognized: true });
    const invite = await addInvite(patient.id);
    const r = await call(caregiverController.acceptInvite, { userId: cg.user.id, body: { invite_code: 'abcd1234', relationship_label: 'Brother' } });
    assert.equal(r.status, 200);
    const link = fakeDb.patientcaregiverlink._rows()[0];
    assert.equal(link.consent_status, 'GRANTED');
    assert.equal(link.revoked_at, null);
    assert.deepEqual(link.access_scopes, [...DEFAULT_CAREGIVER_SCOPES]);
    assert.ok(!link.access_scopes.includes('ALL'));
    assert.equal(invite.is_used, true);
    assert.deepEqual(auditActions(), ['CAREGIVER_LINK_CREATED']);
    assert.ok(await authz.getPatientAccessContext(cg.user.id, patient.id));
});

test('8. an invalid invite is rejected', async () => {
    const cg = await addCaregiver('rahul', { recognized: true });
    const r = await call(caregiverController.acceptInvite, { userId: cg.user.id, body: { invite_code: 'NOPE0000' } });
    assert.equal(r.status, 400);
    assert.equal(fakeDb.patientcaregiverlink._rows().length, 0);
});

test('9. an expired invite is rejected', async () => {
    const { patient } = await addPatientWithOwner();
    const cg = await addCaregiver('rahul', { recognized: true });
    await addInvite(patient.id, { expiresInMs: -1000 });
    const r = await call(caregiverController.acceptInvite, { userId: cg.user.id, body: { invite_code: 'ABCD1234' } });
    assert.equal(r.status, 400);
    assert.equal(fakeDb.patientcaregiverlink._rows().length, 0);
});

test('10. a used invite is rejected (single use)', async () => {
    const { patient } = await addPatientWithOwner();
    const a = await addCaregiver('a', { recognized: true });
    const b = await addCaregiver('b', { recognized: true });
    await addInvite(patient.id);
    assert.equal((await call(caregiverController.acceptInvite, { userId: a.user.id, body: { invite_code: 'ABCD1234' } })).status, 200);
    assert.equal((await call(caregiverController.acceptInvite, { userId: b.user.id, body: { invite_code: 'ABCD1234' } })).status, 400);
    assert.equal(fakeDb.patientcaregiverlink._rows().length, 1);
});

// ---------------------------------------------------------------------------
// Revocation
// ---------------------------------------------------------------------------
test('11. a revoked caregiver loses patient access, keeps recognition and other patients; re-linking applies fresh scopes', async () => {
    const A = await addPatientWithOwner('A');
    const B = await addPatientWithOwner('B');
    const cg = await addCaregiver('rahul', { recognized: true });
    const linkA = await linkCaregiver(A.patient.id, cg.user.id);
    await linkCaregiver(B.patient.id, cg.user.id);

    const r = await call(caregiverController.revokeCaregiver, { userId: A.owner.id, body: { patient_id: A.patient.id, caregiver_user_id: cg.user.id } });
    assert.equal(r.status, 200);
    assert.equal(linkA.consent_status, 'REVOKED');
    assert.ok(linkA.revoked_at instanceof Date);
    assert.equal(await authz.getPatientAccessContext(cg.user.id, A.patient.id), null);
    assert.ok(await authz.getPatientAccessContext(cg.user.id, B.patient.id), 'other patient link is unaffected');
    assert.equal(cg.profile.ngo_recognition_status, 'RECOGNIZED', 'profile is not deleted or downgraded');
    assert.ok(auditActions().includes('CAREGIVER_LINK_REVOKED'));

    // Re-link with a new invite: scopes are the newly granted ones, not the old elevated ones.
    linkA.access_scopes = [SCOPES.MEDICATION_EDIT, SCOPES.DOCUMENT_UPLOAD];
    await addInvite(A.patient.id, { code: 'NEWCODE1' });
    const again = await call(caregiverController.acceptInvite, { userId: cg.user.id, body: { invite_code: 'NEWCODE1' } });
    assert.equal(again.status, 200);
    assert.equal(linkA.consent_status, 'GRANTED');
    assert.equal(linkA.revoked_at, null);
    assert.deepEqual(linkA.access_scopes, [...DEFAULT_CAREGIVER_SCOPES]);
});

test('12. a revoked caregiver receives no new alert (and neither does an unrecognized one)', async () => {
    const { owner, patient } = await addPatientWithOwner();
    const ngo = await addNgo();
    const revoked = await addCaregiver('revoked', { recognized: true });
    const unrecognized = await addCaregiver('unrecognized');
    const active = await addCaregiver('active', { recognized: true });
    await linkCaregiver(patient.id, revoked.user.id, { consent_status: 'REVOKED', revoked_at: new Date() });
    await linkCaregiver(patient.id, unrecognized.user.id);
    await linkCaregiver(patient.id, active.user.id);
    const ids = await alertService.getAlertRecipientUserIds(fakeDb, patient.id);
    assert.ok(ids.includes(owner.id) && ids.includes(ngo.id) && ids.includes(active.user.id));
    assert.ok(!ids.includes(revoked.user.id));
    assert.ok(!ids.includes(unrecognized.user.id));
});

test('13. a revoked caregiver cannot open / read / send in a patient-specific chat', async () => {
    const { owner, patient } = await addPatientWithOwner();
    const cg = await addCaregiver('rahul', { recognized: true });
    const link = await linkCaregiver(patient.id, cg.user.id);

    const opened = await call(chatController.openThread, { userId: cg.user.id, body: { participant_id: owner.id, patient_id: patient.id } });
    assert.equal(opened.status, 200);
    const convo = opened.body.data;
    await fakeDb.chatmessage.create({ data: { conversation_id: convo.id, sender_id: owner.id, message_type: 'TEXT', content: 'hi', is_read: false } });

    await call(caregiverController.revokeCaregiver, { userId: owner.id, body: { patient_id: patient.id, caregiver_user_id: cg.user.id } });
    assert.equal(link.consent_status, 'REVOKED');

    assert.equal((await call(chatController.openThread, { userId: cg.user.id, body: { participant_id: owner.id, patient_id: patient.id } })).status, 403);
    assert.equal((await call(chatController.getMessages, { userId: cg.user.id, params: { conversation_id: convo.id } })).status, 403);
    assert.equal((await call(chatController.sendMessage, { userId: cg.user.id, body: { conversation_id: convo.id, content: 'still there?' } })).status, 403);
    assert.equal((await call(chatController.sendMessage, { userId: owner.id, body: { conversation_id: convo.id, content: 'bye' } })).status, 403);
});

test('14. a revoked caregiver/delegate no longer sees the patient conversation in the inbox (helpline stays)', async () => {
    const { owner, patient } = await addPatientWithOwner();
    const ngo = await addNgo();
    const cg = await addCaregiver('rahul', { recognized: true });
    await linkCaregiver(patient.id, cg.user.id);
    const delegate = await addUser('delegate');
    const dLink = await fakeDb.patientaccountlink.create({ data: { user_id: delegate.id, patient_id: patient.id, relationship_type: 'DELEGATE', access_scopes: [SCOPES.ACCOUNT_OPERATE] } });

    const cgThread = (await call(chatController.openThread, { userId: cg.user.id, body: { participant_id: owner.id, patient_id: patient.id } })).body.data;
    const dThread = (await call(chatController.openThread, { userId: delegate.id, body: { participant_id: owner.id, patient_id: patient.id } })).body.data;
    const helpline = (await call(chatController.openThread, { userId: cg.user.id, body: { participant_id: ngo.id } })).body.data;
    await fakeDb.chatmessage.create({ data: { conversation_id: cgThread.id, sender_id: owner.id, message_type: 'TEXT', content: 'secret preview' } });

    const before = await call(chatController.getConversations, { userId: cg.user.id });
    assert.ok(before.body.data.some((c) => c.id === cgThread.id));

    await call(caregiverController.revokeCaregiver, { userId: owner.id, body: { patient_id: patient.id, caregiver_user_id: cg.user.id } });
    await call(patientController.revokePatientDelegate, { userId: owner.id, params: { patient_id: patient.id, user_id: delegate.id } });
    assert.equal(dLink.consent_status, 'REVOKED');

    const cgInbox = (await call(chatController.getConversations, { userId: cg.user.id })).body.data.map((c) => c.id);
    assert.ok(!cgInbox.includes(cgThread.id), 'revoked caregiver: patient thread absent');
    assert.ok(cgInbox.includes(helpline.id), 'helpline thread remains');
    const dInbox = (await call(chatController.getConversations, { userId: delegate.id })).body.data.map((c) => c.id);
    assert.ok(!dInbox.includes(dThread.id), 'revoked delegate: patient thread absent');
    // the patient owner still sees both of their own threads
    const ownerInbox = (await call(chatController.getConversations, { userId: owner.id })).body.data.map((c) => c.id);
    assert.ok(ownerInbox.includes(cgThread.id) && ownerInbox.includes(dThread.id));
});

test('15. every active patient account holder is returned as a contact', async () => {
    const { owner, patient } = await addPatientWithOwner('Asha');
    const d1 = await addUser('delegate-one');
    const d2 = await addUser('delegate-two');
    const gone = await addUser('delegate-gone');
    for (const u of [d1, d2]) await fakeDb.patientaccountlink.create({ data: { user_id: u.id, patient_id: patient.id, relationship_type: 'DELEGATE', access_scopes: [SCOPES.ACCOUNT_OPERATE] } });
    await fakeDb.patientaccountlink.create({ data: { user_id: gone.id, patient_id: patient.id, relationship_type: 'DELEGATE', consent_status: 'REVOKED', revoked_at: new Date() } });
    const ngo = await addNgo();

    const r = await call(chatController.getContacts, { userId: ngo.id, params: { patient_id: patient.id } });
    assert.equal(r.status, 200);
    const ids = r.body.data.map((c) => c.userId);
    assert.ok(ids.includes(owner.id) && ids.includes(d1.id) && ids.includes(d2.id));
    assert.ok(!ids.includes(gone.id));
    assert.equal(r.body.data.find((c) => c.userId === owner.id).isPatient, true);
});

// ---------------------------------------------------------------------------
// Delegates
// ---------------------------------------------------------------------------
test('16. POST /patients cannot create a DELEGATE', async () => {
    const u = await addUser('someone');
    const r = await call(patientController.createPatientProfile, {
        userId: u.id, body: { full_name: 'X', date_of_birth: '1980-01-01', relationship_type: 'DELEGATE' }
    });
    assert.equal(r.status, 400);
    assert.equal(fakeDb.patient._rows().length, 0);
    assert.equal(fakeDb.patientaccountlink._rows().length, 0);
    // the normal SELF path still works
    const ok = await call(patientController.createPatientProfile, { userId: u.id, body: { full_name: 'X', date_of_birth: '1980-01-01' } });
    assert.equal(ok.status, 201);
    assert.equal(fakeDb.patientaccountlink._rows()[0].relationship_type, 'SELF');
});

test('17. delegate creation never grants ALL automatically', async () => {
    const { owner, patient } = await addPatientWithOwner();
    const d = await addUser('delegate');
    const r = await call(patientController.addPatientDelegate, { userId: owner.id, params: { patient_id: patient.id }, body: { user_id: d.id } });
    assert.equal(r.status, 201);
    const link = fakeDb.patientaccountlink._rows().find((l) => l.user_id === d.id);
    assert.deepEqual(link.access_scopes, ['ACCOUNT_OPERATE']);
    assert.ok(!link.access_scopes.includes('ALL'));
    assert.ok(auditActions().includes('DELEGATE_CREATED'));

    const d2 = await addUser('delegate2');
    const asked = await call(patientController.addPatientDelegate, { userId: owner.id, params: { patient_id: patient.id }, body: { user_id: d2.id, access_scopes: ['ALL'] } });
    assert.equal(asked.status, 400);
});

test('18. delegate scope escalation is rejected', async () => {
    const { patient } = await addPatientWithOwner();
    const manager = await addUser('manager');
    await fakeDb.patientaccountlink.create({ data: { user_id: manager.id, patient_id: patient.id, relationship_type: 'DELEGATE', access_scopes: [SCOPES.ACCOUNT_DELEGATE_MANAGE, SCOPES.DASHBOARD_VIEW] } });
    const target = await addUser('target');
    const r = await call(patientController.addPatientDelegate, {
        userId: manager.id, params: { patient_id: patient.id }, body: { user_id: target.id, access_scopes: [SCOPES.MEDICATION_EDIT] }
    });
    assert.equal(r.status, 403);
    assert.equal(r.body.code, 'SCOPE_ESCALATION');
    const nt = await call(patientController.addPatientDelegate, {
        userId: manager.id, params: { patient_id: patient.id }, body: { user_id: target.id, access_scopes: [SCOPES.ACCOUNT_DELEGATE_MANAGE] }
    });
    assert.equal(nt.status, 400, 'non-transferable scope stays non-transferable');
    assert.equal(fakeDb.patientaccountlink._rows().filter((l) => l.user_id === target.id).length, 0);
});

// ---------------------------------------------------------------------------
// Central NGO + active-link rules
// ---------------------------------------------------------------------------
test('19. the central NGO stays globally authorized, even with an incidental narrower link', async () => {
    const { patient } = await addPatientWithOwner();
    const ngo = await addNgo();
    await fakeDb.patientaccountlink.create({ data: { user_id: ngo.id, patient_id: patient.id, relationship_type: 'DELEGATE', access_scopes: [SCOPES.DASHBOARD_VIEW] } });
    await fakeDb.caregiverprofile.create({ data: { user_id: ngo.id, caregiver_type: 'FAMILY' } }); // NOT_RECOGNIZED
    await linkCaregiver(patient.id, ngo.id, { access_scopes: [] });
    const ctx = await authz.getPatientAccessContext(ngo.id, patient.id);
    assert.equal(ctx.role, 'STAFF');
    assert.ok(authz.contextHasScope(ctx, SCOPES.MEDICATION_EDIT));
    assert.ok(authz.contextHasScope(ctx, SCOPES.CARE_CIRCLE_MANAGE));
    // NGO <-> anyone / anyone <-> NGO helpline
    const other = await addUser('other');
    assert.equal(await authz.verifyCommunicationAccess(other.id, ngo.id, null), true);
    assert.equal(await authz.verifyCommunicationAccess(ngo.id, other.id, null), true, 'helpline is two-way');
});

test('20. active access requires revoked_at = null AND recognition (recognition decides eligibility, scopes decide capability)', async () => {
    const { patient, owner, link } = await addPatientWithOwner();
    const cg = await addCaregiver('rahul', { recognized: true });
    const cgLink = await linkCaregiver(patient.id, cg.user.id);
    assert.equal((await authz.getPatientAccessContext(cg.user.id, patient.id)).role, 'CAREGIVER');

    // consent GRANTED but revoked_at set -> no access (caregiver and account holder)
    cgLink.revoked_at = new Date();
    assert.equal(await authz.getPatientAccessContext(cg.user.id, patient.id), null);
    cgLink.revoked_at = null;
    link.revoked_at = new Date();
    assert.equal(await authz.getPatientAccessContext(owner.id, patient.id), null);
    link.revoked_at = null;

    // RECOGNIZED + GRANTED + active -> allowed; NOT_RECOGNIZED + GRANTED + active -> denied
    assert.ok(await authz.getPatientAccessContext(cg.user.id, patient.id));
    cg.profile.ngo_recognition_status = 'NOT_RECOGNIZED';
    assert.equal(await authz.getPatientAccessContext(cg.user.id, patient.id), null);
    assert.equal(await authz.verifyPatientDataEventAccess(cg.user.id, patient.id), false);
    assert.equal(await authz.verifyCommunicationAccess(cg.user.id, owner.id, patient.id), false);
});

test('21. a recognized caregiver is limited to the explicit scopes on the link ("ALL" is never honoured for caregivers)', async () => {
    const { patient } = await addPatientWithOwner();
    const vol = await addCaregiver('vol', { type: 'VOLUNTEER', recognized: true });
    await linkCaregiver(patient.id, vol.user.id, { access_scopes: ['ALL'] });
    assert.equal(await authz.requirePatientScope(vol.user.id, patient.id, SCOPES.MEDICATION_EDIT), null);
    assert.equal(await authz.requirePatientScope(vol.user.id, patient.id, SCOPES.DASHBOARD_VIEW), null);
    assert.equal(await authz.canManagePatientCaregivers(vol.user.id, patient.id), false);
    assert.ok(!DEFAULT_CAREGIVER_SCOPES.includes('ALL'));
});

test('22. relationship labels longer than 100 characters are rejected, not truncated', async () => {
    const { owner, patient } = await addPatientWithOwner();
    const cg = await addCaregiver('rahul', { recognized: true });
    await addInvite(patient.id);
    const long = 'x'.repeat(101);
    const r = await call(caregiverController.acceptInvite, { userId: cg.user.id, body: { invite_code: 'ABCD1234', relationship_label: long } });
    assert.equal(r.status, 400);
    assert.equal(fakeDb.patientcaregiverlink._rows().length, 0);
    const d = await addUser('delegate');
    const r2 = await call(patientController.addPatientDelegate, { userId: owner.id, params: { patient_id: patient.id }, body: { user_id: d.id, relationship_label: long } });
    assert.equal(r2.status, 400);
    const r3 = await call(patientController.createPatientProfile, { userId: (await addUser('p')).id, body: { full_name: 'X', date_of_birth: '1990-01-01', relationship_label: long } });
    assert.equal(r3.status, 400);
});

test('23. helpline is two-way; patient-specific and user-to-user rules still hold', async () => {
    const ngo = await addNgo();
    const { owner, patient } = await addPatientWithOwner();
    const fam = await addCaregiver('fam', { recognized: true });
    const vol = await addCaregiver('vol', { type: 'VOLUNTEER', recognized: true });
    const stranger = await addUser('stranger');
    await linkCaregiver(patient.id, fam.user.id);
    await linkCaregiver(patient.id, vol.user.id);
    const v = authz.verifyCommunicationAccess;

    for (const u of [fam.user, vol.user, owner]) {
        assert.equal(await v(ngo.id, u.id, null), true, 'NGO -> user, no patient');
        assert.equal(await v(u.id, ngo.id, null), true, 'user -> NGO, no patient');
    }
    // NGO <-> non-NGO with a patient: the non-NGO side must have access to that patient
    assert.equal(await v(ngo.id, fam.user.id, patient.id), true);
    assert.equal(await v(ngo.id, stranger.id, patient.id), false);
    assert.equal(await v(stranger.id, ngo.id, patient.id), false);
    // non-NGO <-> non-NGO
    assert.equal(await v(fam.user.id, owner.id, null), false);
    assert.equal(await v(fam.user.id, owner.id, patient.id), true);
    assert.equal(await v(fam.user.id, stranger.id, patient.id), false);
});

test('24. recognition is an eligibility switch: removing it blocks access, re-recognising restores non-revoked links', async () => {
    const ngo = await addNgo();
    const { patient } = await addPatientWithOwner();
    const cg = await addCaregiver('rahul', { recognized: true });
    const link = await linkCaregiver(patient.id, cg.user.id);
    const set = (recognized) => call(adminController.setCaregiverRecognition, { userId: ngo.id, params: { user_id: cg.user.id }, body: { recognized } });

    await set(false);
    assert.equal(await authz.getPatientAccessContext(cg.user.id, patient.id), null);
    assert.equal(link.consent_status, 'GRANTED', 'link itself is not revoked');
    assert.equal(link.revoked_at, null);

    await set(true);
    assert.ok(await authz.getPatientAccessContext(cg.user.id, patient.id));

    // a link that was actually revoked stays revoked after re-recognition
    link.consent_status = 'REVOKED'; link.revoked_at = new Date();
    await set(false); await set(true);
    assert.equal(await authz.getPatientAccessContext(cg.user.id, patient.id), null);
});

// ---------------------------------------------------------------------------
// Consent history (consentrecord) - attribution, revocation, recognition independence
// ---------------------------------------------------------------------------
const consentRows = (patientId, granteeId) =>
    fakeDb.consentrecord._rows().filter((r) => r.patient_id === patientId && r.grantee_id === granteeId);

test('25. caregiver consent is attributed to the invite creator (the grantor), not the accepting caregiver', async () => {
    const { owner, patient } = await addPatientWithOwner();
    const cg = await addCaregiver('rahul', { recognized: true });

    const made = await call(caregiverController.generateInvite, { userId: owner.id, body: { patient_id: patient.id } });
    assert.equal(made.status, 200);
    const invite = fakeDb.caregiverinvite._rows()[0];
    assert.equal(invite.created_by, owner.id, 'invite remembers who created it');

    const r = await call(caregiverController.acceptInvite, { userId: cg.user.id, body: { invite_code: made.body.data.code } });
    assert.equal(r.status, 200);
    const rows = consentRows(patient.id, cg.user.id);
    assert.deepEqual(rows.map((x) => x.data_scope).sort(), [...DEFAULT_CAREGIVER_SCOPES].sort());
    assert.ok(rows.every((x) => x.status === 'GRANTED' && x.revoked_at === null));
    assert.ok(rows.every((x) => x.granted_by === owner.id), 'grantor = invite creator');
    assert.ok(rows.every((x) => x.granted_by !== cg.user.id));
});

test('26. revoking a link revokes (not deletes) its consent; removing NGO recognition does not touch consent', async () => {
    const ngo = await addNgo();
    const { owner, patient } = await addPatientWithOwner();
    const cg = await addCaregiver('rahul', { recognized: true });
    await addInvite(patient.id, { createdBy: owner.id });
    await call(caregiverController.acceptInvite, { userId: cg.user.id, body: { invite_code: 'ABCD1234' } });
    const total = DEFAULT_CAREGIVER_SCOPES.length;

    // Recognition OFF: access is blocked, consent history is untouched.
    await call(adminController.setCaregiverRecognition, { userId: ngo.id, params: { user_id: cg.user.id }, body: { recognized: false } });
    assert.equal(await authz.getPatientAccessContext(cg.user.id, patient.id), null);
    assert.ok(consentRows(patient.id, cg.user.id).every((x) => x.status === 'GRANTED' && x.revoked_at === null));
    await call(adminController.setCaregiverRecognition, { userId: ngo.id, params: { user_id: cg.user.id }, body: { recognized: true } });

    // Link revoked: every active consent row is REVOKED but kept.
    await call(caregiverController.revokeCaregiver, { userId: owner.id, body: { patient_id: patient.id, caregiver_user_id: cg.user.id } });
    let rows = consentRows(patient.id, cg.user.id);
    assert.equal(rows.length, total, 'history preserved');
    assert.ok(rows.every((x) => x.status === 'REVOKED' && x.revoked_at instanceof Date));

    // Re-link: fresh GRANTED rows are added next to the old REVOKED ones.
    await addInvite(patient.id, { code: 'AGAIN123', createdBy: owner.id });
    await call(caregiverController.acceptInvite, { userId: cg.user.id, body: { invite_code: 'AGAIN123' } });
    rows = consentRows(patient.id, cg.user.id);
    assert.equal(rows.length, total * 2);
    assert.equal(rows.filter((x) => x.status === 'GRANTED').length, total);
    assert.equal(rows.filter((x) => x.status === 'REVOKED').length, total);
});

test('27. delegate consent is recorded on create, rescoped on change and revoked on removal', async () => {
    const { owner, patient } = await addPatientWithOwner();
    const d = await addUser('delegate');
    const rows = () => consentRows(patient.id, d.id);

    await call(patientController.addPatientDelegate, { userId: owner.id, params: { patient_id: patient.id }, body: { user_id: d.id, access_scopes: [SCOPES.ACCOUNT_OPERATE, SCOPES.DASHBOARD_VIEW] } });
    assert.deepEqual(rows().map((x) => x.data_scope).sort(), ['ACCOUNT_OPERATE', 'DASHBOARD_VIEW']);
    assert.ok(rows().every((x) => x.granted_by === owner.id && x.status === 'GRANTED'));

    await call(patientController.updatePatientDelegate, { userId: owner.id, params: { patient_id: patient.id, user_id: d.id }, body: { access_scopes: [SCOPES.ACCOUNT_OPERATE, SCOPES.SYMPTOM_VIEW] } });
    const by = (scope) => rows().filter((x) => x.data_scope === scope);
    assert.equal(by('ACCOUNT_OPERATE').length, 1, 'unchanged scope is left alone');
    assert.equal(by('DASHBOARD_VIEW')[0].status, 'REVOKED');
    assert.equal(by('SYMPTOM_VIEW')[0].status, 'GRANTED');

    await call(patientController.revokePatientDelegate, { userId: owner.id, params: { patient_id: patient.id, user_id: d.id } });
    assert.ok(rows().every((x) => x.status === 'REVOKED' && x.revoked_at instanceof Date));
    assert.ok(rows().length >= 3, 'history kept');
    for (const a of ['DELEGATE_CREATED', 'DELEGATE_RESCOPED', 'DELEGATE_REVOKED']) assert.ok(auditActions().includes(a), a);
});
