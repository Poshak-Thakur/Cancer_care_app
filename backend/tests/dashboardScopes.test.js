/**
 * Dashboard access_scopes come from the validated access context - never a fabricated 'ALL'.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { fakeDb, reset, uuid, srcPath, addUser } = require('./helpers/harness');

const { getDashboardOverview } = require(srcPath('controllers/dashboardController'));
test.beforeEach(reset);

const overview = async (accessContext) => {
    const user = await addUser('viewer');
    const patient = await fakeDb.patient.create({ data: { full_name: 'Dash', date_of_birth: new Date('1980-01-01') } });
    const out = {};
    const res = { status(c) { out.status = c; return this; }, json(b) { out.body = b; return this; } };
    let error;
    await getDashboardOverview({ user: { userId: user.id }, params: { patient_id: patient.id }, accessContext }, res, (e) => { error = e; });
    if (error) throw error;
    return out;
};

test('DS1. central staff context reports ALL explicitly', async () => {
    const r = await overview({ role: 'STAFF', link: { relationship_type: 'COUNSELLOR', access_scopes: ['ALL'] }, scopes: ['ALL'] });
    assert.deepEqual(r.body.data.access_scopes, ['ALL']);
});

test('DS2. a patient context reports exactly its own scopes', async () => {
    const r = await overview({ role: 'PATIENT', link: { relationship_type: 'DELEGATE', access_scopes: ['ACCOUNT_OPERATE'] }, scopes: ['ACCOUNT_OPERATE', 42] });
    assert.deepEqual(r.body.data.access_scopes, ['ACCOUNT_OPERATE'], 'non-string entries are dropped');
});

test('DS3. missing / empty / malformed scope data fails closed (never a fabricated ALL)', async () => {
    for (const ctx of [
        { role: 'PATIENT', link: undefined, scopes: undefined },
        { role: 'CAREGIVER', link: { access_scopes: undefined }, scopes: [] },
        { role: 'PATIENT', link: null, scopes: 'ALL' }
    ]) {
        const r = await overview(ctx);
        assert.equal(r.status, 200);
        assert.deepEqual(r.body.data.access_scopes, [], JSON.stringify(ctx));
    }
});
