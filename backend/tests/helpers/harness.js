/**
 * Shared test harness (no database, no network, no extra dependencies).
 *
 * Replaces Prisma with a small in-memory fake and stubs Supabase / Firebase / Gemini, then loads the
 * REAL controllers and services so the tests exercise the production code paths.
 *
 * Run everything with:   node --test tests/
 * (helpers/harness.js itself contains no tests.)
 */
const Module = require('node:module');
const path = require('node:path');
const crypto = require('node:crypto');

// ---------------------------------------------------------------------------
// In-memory Prisma fake
// ---------------------------------------------------------------------------
const uuid = () => crypto.randomUUID();
const isPlainObj = (v) => v !== null && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v);

const DEFAULTS = {
    caregiverprofile: () => ({ ngo_recognition_status: 'NOT_RECOGNIZED', recognized_by: null, recognized_at: null }),
    patientcaregiverlink: () => ({ consent_status: 'GRANTED', revoked_at: null, is_primary: false, availability: 'AVAILABLE', access_scopes: [] }),
    patientaccountlink: () => ({ consent_status: 'GRANTED', revoked_at: null, granted_at: new Date() }),
    caregiverinvite: () => ({ is_used: false, created_by: null, invite_kind: 'CAREGIVER' }),
    patientclaimattempt: () => ({ attempted_at: new Date() }),
    consentrecord: () => ({ status: 'GRANTED', revoked_at: null, granted_at: new Date() }),
    patient: () => ({ updated_at: new Date() }),
    alert: () => ({ status: 'OPEN', requested_by_user_id: null, client_event_id: null, updated_at: new Date() }),
    alertupdate: () => ({ client_event_id: null }),
    alertdelivery: () => ({ delivery_status: 'QUEUED', queued_at: new Date() }),
    communitypost: () => ({ status: 'PENDING', visibility: 'PUBLIC', media_urls: [] }),
    communityreport: () => ({ status: 'OPEN', reviewed_by: null, reviewed_at: null, moderator_note: null }),
    medicaldocument: () => ({ verification_status: 'PENDING', verified_by: null, verified_at: null }),
    careevent: () => ({ completion_status: 'SCHEDULED', patient_medication_id: null }),
    patientmedication: () => ({ verification_status: 'PENDING', verified_by: null, verified_at: null }),
    checkinfield: () => ({ is_required: false, validation_config: {}, help_text: null }),
    checkinformversion: () => ({ published_at: null, archived_at: null }),
    checkinanswer: () => ({ option_id: null, value_text: null, value_number: null, value_boolean: null, value_json: null })
};

const compoundKeys = { patient_id_caregiver_user_id: ['patient_id', 'caregiver_user_id'] };

// Relation metadata so include / select / relation filters work.   { key: { t: table, fk | local, } }
const REL_ACCOUNT_USER = 'useraccount_patientaccountlink_user_idTouseraccount';
const REL_RECIPIENT_USER = 'useraccount_alertrecipient_recipient_user_idTouseraccount';
const REL_CONSENT_GRANTEE = 'useraccount_consentrecord_grantee_idTouseraccount';
const REL_CONSENT_GRANTOR = 'useraccount_consentrecord_granted_byTouseraccount';
const REL = {
    patient: {
        patientaccountlink: { fk: 'patient_id' }, patientcaregiverlink: { fk: 'patient_id' }, alert: { fk: 'patient_id' },
        patientmedication: { fk: 'patient_id' }, medicaldocument: { fk: 'patient_id' }, careevent: { fk: 'patient_id' },
        symptomevent: { fk: 'patient_id' }, consentrecord: { fk: 'patient_id' }, prescription: { fk: 'patient_id' },
        patientcasenote: { fk: 'patient_id' }
    },
    patientaccountlink: { [REL_ACCOUNT_USER]: { t: 'useraccount', local: 'user_id' }, patient: { t: 'patient', local: 'patient_id' } },
    patientcaregiverlink: { useraccount: { local: 'caregiver_user_id' } },
    consentrecord: { [REL_CONSENT_GRANTEE]: { t: 'useraccount', local: 'grantee_id' }, [REL_CONSENT_GRANTOR]: { t: 'useraccount', local: 'granted_by' } },
    prescription: { prescriptionextraction: { fk: 'prescription_id' } },
    symptomevent: { symptomobservation: { fk: 'symptom_event_id' }, checkinanswer: { fk: 'symptom_event_id' } },
    checkinform: { versions: { t: 'checkinformversion', fk: 'form_id' } },
    checkinformversion: { fields: { t: 'checkinfield', fk: 'version_id' }, form: { t: 'checkinform', local: 'form_id' } },
    checkinfield: { options: { t: 'checkinfieldoption', fk: 'field_id' }, version: { t: 'checkinformversion', local: 'version_id' } },
    checkinanswer: { field: { t: 'checkinfield', local: 'field_id' }, option: { t: 'checkinfieldoption', local: 'option_id' } },
    alert: {
        alertrecipient: { fk: 'alert_id' }, alertupdate: { fk: 'alert_id' }, patient: { local: 'patient_id' },
        requested_by: { t: 'useraccount', local: 'requested_by_user_id' }
    },
    alertrecipient: { [REL_RECIPIENT_USER]: { t: 'useraccount', local: 'recipient_user_id' }, alertdelivery: { fk: 'alert_recipient_id' } },
    alertupdate: { useraccount: { local: 'created_by' } },
    communitypost: { author: { t: 'useraccount', local: 'author_id' }, communityreport: { fk: 'post_id' } },
    communityreport: { reporter: { t: 'useraccount', local: 'reporter_id' } },
    patientcasenote: { author: { t: 'useraccount', local: 'author_id' } },
    careevent: { patient: { t: 'patient', local: 'patient_id' }, patientmedication: { t: 'patientmedication', local: 'patient_medication_id' } },
    medicaldocument: { patient: { t: 'patient', local: 'patient_id' } },
    auditlogentry: { useraccount: { local: 'actor_id' } }
};

let seq = 0;
function makeFakePrisma() {
    const tables = {};
    const T = (name) => (tables[name] ||= []);

    const matchValue = (actual, cond) => {
        if (isPlainObj(cond)) {
            if ('in' in cond) return cond.in.includes(actual);
            if ('notIn' in cond) return !cond.notIn.includes(actual);
            if ('gt' in cond) return actual > cond.gt;
            if ('gte' in cond || 'lte' in cond) {
                return (!('gte' in cond) || actual >= cond.gte) && (!('lte' in cond) || actual <= cond.lte);
            }
            if ('lt' in cond) return actual < cond.lt;
            if ('not' in cond) return actual !== cond.not;
            if ('contains' in cond) return String(actual ?? '').toLowerCase().includes(String(cond.contains).toLowerCase());
            return false;
        }
        if (cond === null) return actual === null || actual === undefined;
        return actual === cond;
    };

    const matches = (row, where = {}, table) => Object.entries(where).every(([key, cond]) => {
        if (key === 'OR') return cond.some((w) => matches(row, w, table));
        if (key === 'AND') return cond.every((w) => matches(row, w, table));
        if (compoundKeys[key]) return compoundKeys[key].every((k) => row[k] === cond[k]);
        const spec = REL[table] && REL[table][key];
        if (spec && isPlainObj(cond) && 'some' in cond) {
            return T(spec.t || key).some((r) => r[spec.fk] === row.id && matches(r, cond.some, spec.t || key));
        }
        return matchValue(row[key], cond);
    });

    const sortRows = (rows, orderBy) => {
        if (!orderBy) return rows;
        const [[field, dir]] = Object.entries(Array.isArray(orderBy) ? orderBy[0] : orderBy);
        const mult = dir === 'desc' ? -1 : 1;
        return [...rows].sort((a, b) => {
            const x = a[field]; const y = b[field];
            if (x < y) return -1 * mult;
            if (x > y) return 1 * mult;
            return ((a._seq || 0) - (b._seq || 0)) * mult;   // stable tie-break = insertion order
        });
    };

    // Applies include / select (and their nested where / orderBy / take) to one row.
    const shape = (row, table, args = {}) => {
        if (!row) return row;
        const rels = REL[table] || {};
        const resolve = (key, sub) => {
            const spec = rels[key];
            const opts = sub === true ? {} : sub;
            const target = spec.t || key;
            if (spec.local) {
                const found = T(target).find((r) => r.id === row[spec.local]);
                return found ? shape(found, target, opts) : null;
            }
            let list = T(target).filter((r) => r[spec.fk] === row.id && matches(r, opts.where, target));
            list = sortRows(list, opts.orderBy);
            if (opts.take) list = list.slice(0, opts.take);
            return list.map((r) => shape(r, target, opts));
        };
        if (args.select) {
            const out = {};
            for (const [key, val] of Object.entries(args.select)) {
                if (!val) continue;
                out[key] = rels[key] ? resolve(key, val) : row[key];
            }
            return out;
        }
        const out = { ...row };
        if (args.include) {
            for (const [key, val] of Object.entries(args.include)) {
                if (val && rels[key]) out[key] = resolve(key, val);
            }
        }
        return out;
    };

    const model = (name) => {
        const base = (data) => ({ id: uuid(), created_at: new Date(), ...(DEFAULTS[name] ? DEFAULTS[name]() : {}), ...data });
        const insert = (data) => {
            const row = base(data);
            Object.defineProperty(row, '_seq', { value: ++seq, enumerable: false, writable: true });
            T(name).push(row);
            return row;
        };
        return {
            _rows: () => T(name),
            findUnique: async (args = {}) => shape(T(name).find((r) => matches(r, args.where, name)) || null, name, args),
            findFirst: async (args = {}) => {
                const rows = sortRows(T(name).filter((r) => matches(r, args.where, name)), args.orderBy);
                return shape(rows[0] || null, name, args);
            },
            findMany: async (args = {}) => {
                let rows = sortRows(T(name).filter((r) => matches(r, args.where, name)), args.orderBy);
                if (name === 'chatconversation') {
                    rows = rows.map((c) => ({
                        ...c,
                        participant_one: { id: c.participant_one_id },
                        participant_two: { id: c.participant_two_id },
                        patient: (() => { const p = T('patient').find((x) => x.id === c.patient_id); return p ? { id: p.id, full_name: p.full_name } : null; })(),
                        messages: T('chatmessage').filter((m) => m.conversation_id === c.id)
                            .sort((a, b) => b.created_at - a.created_at).slice(0, 1)
                    }));
                    return args.take ? rows.slice(0, args.take) : rows;
                }
                if (args.skip) rows = rows.slice(args.skip);
                if (args.take) rows = rows.slice(0, args.take);
                return rows.map((r) => shape(r, name, args));
            },
            groupBy: async ({ by, where }) => {
                const groups = new Map();
                for (const r of T(name).filter((row) => matches(row, where, name))) {
                    const key = by.map((f) => r[f]).join('|');
                    if (!groups.has(key)) groups.set(key, { ...Object.fromEntries(by.map((f) => [f, r[f]])), _count: { _all: 0 } });
                    groups.get(key)._count._all += 1;
                }
                return [...groups.values()];
            },
            count: async ({ where } = {}) => T(name).filter((r) => matches(r, where, name)).length,
            create: async ({ data }) => insert(data),
            createMany: async ({ data, skipDuplicates }) => {
                let count = 0;
                for (const d of data) {
                    if (skipDuplicates && name === 'alertrecipient' &&
                        T(name).some((r) => r.alert_id === d.alert_id && r.recipient_user_id === d.recipient_user_id)) continue;
                    insert(d); count += 1;
                }
                return { count };
            },
            update: async ({ where, data }) => {
                const row = T(name).find((r) => matches(r, where, name));
                if (!row) throw Object.assign(new Error('Record not found'), { code: 'P2025' });
                Object.assign(row, data);
                return row;
            },
            updateMany: async ({ where, data }) => {
                const rows = T(name).filter((r) => matches(r, where, name));
                rows.forEach((r) => Object.assign(r, data));
                return { count: rows.length };
            },
            delete: async ({ where }) => {
                const i = T(name).findIndex((r) => matches(r, where, name));
                if (i < 0) throw Object.assign(new Error('Record not found'), { code: 'P2025' });
                return T(name).splice(i, 1)[0];
            },
            deleteMany: async ({ where } = {}) => {
                const doomed = T(name).filter((r) => matches(r, where, name));
                tables[name] = T(name).filter((r) => !doomed.includes(r));
                return { count: doomed.length };
            },
            upsert: async ({ where, update, create }) => {
                const row = T(name).find((r) => matches(r, where, name));
                if (row) return Object.assign(row, update);
                return insert(create);
            }
        };
    };

    // Advisory-lock simulation: pg_advisory_xact_lock(hashtext(key)) is held until the owning "transaction"
    // finishes; a second transaction asking for the same key waits. Lock keys are recorded for order assertions.
    const lockQueues = new Map();
    const acquire = async (key) => {
        const prev = lockQueues.get(key) || Promise.resolve();
        let release;
        const gate = new Promise((r) => { release = r; });
        lockQueues.set(key, prev.then(() => gate));
        await prev;
        return release;
    };
    const db = { _tables: tables, _lockLog: [], $executeRaw: async () => 0 };
    [
        'useraccount', 'staffprofile', 'caregiverprofile', 'caregiverinvite', 'patientcaregiverlink', 'patientaccountlink',
        'patient', 'chatconversation', 'chatmessage', 'auditlogentry', 'consentrecord', 'patientcasenote', 'alert',
        'alertrecipient', 'alertupdate', 'alertdelivery', 'communitypost', 'communityreport', 'medicaldocument',
        'prescription', 'prescriptionextraction', 'careevent', 'patientmedication', 'symptomevent',
        'ngoauthority', 'patientclaimattempt', 'checkinform', 'checkinformversion', 'checkinfield', 'checkinfieldoption', 'checkinanswer', 'symptomobservation'
    ].forEach((n) => { db[n] = model(n); });
    // A "transaction" runs the callback with advisory-lock simulation (rollback is NOT simulated).
    db.$transaction = async (fn) => {
        const held = new Map();
        const tx = Object.create(db);
        tx.$executeRaw = async (strings, ...values) => {
            const isLock = Array.isArray(strings) && /pg_advisory_xact_lock/.test(strings.join(''));
            if (!isLock) return 0;
            const key = String(values[0]);
            db._lockLog.push(key);
            if (!held.has(key)) held.set(key, await acquire(key));   // re-entrant inside one transaction, like PostgreSQL
            return 0;
        };
        try { return await fn(tx); } finally { held.forEach((release) => release()); }
    };
    return db;
}

// ---------------------------------------------------------------------------
// Supabase storage fake (private buckets) + push-notification spy
// ---------------------------------------------------------------------------
const storage = {
    files: new Set(),            // 'bucket::path'
    signCalls: [],               // { bucket, path, ttl }
    pushes: [],                  // FCM notifications that were handed over
    failTokens: new Set(),       // tokens Firebase should refuse
    reset() { this.files.clear(); this.signCalls.length = 0; this.pushes.length = 0; this.failTokens.clear(); }
};
const fakeSupabase = {
    storage: {
        from: (bucket) => ({
            list: async (folder, { search } = {}) => {
                const prefix = `${bucket}::${folder}/`;
                const data = [...storage.files].filter((f) => f.startsWith(prefix)).map((f) => ({ name: f.slice(prefix.length) }))
                    .filter((f) => !f.name.includes('/') && (!search || f.name.includes(search)));
                return { data, error: null };
            },
            createSignedUrl: async (filePath, ttl) => {
                storage.signCalls.push({ bucket, path: filePath, ttl });
                return { data: { signedUrl: `https://signed.test/${bucket}/${filePath}?token=T&ttl=${ttl}` }, error: null };
            },
            upload: async () => ({ error: null }),
            remove: async () => ({ error: null })
        })
    }
};

process.env.SUPABASE_URL = 'http://supabase.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
delete process.env.GEMINI_API_KEY;

const fakeDb = makeFakePrisma();
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (/config[\\/]db$/.test(request)) return fakeDb;
    if (request === '@supabase/supabase-js') return { createClient: () => fakeSupabase };
    if (request === '@google/generative-ai') return { GoogleGenerativeAI: class {} };
    if (/config[\\/]firebase$/.test(request)) {
        return {
            sendMessagePushNotification: async () => {},
            sendCallPushNotification: async () => {},
            sendEmergencyAlertNotification: async (token, payload) => {
                storage.pushes.push({ token, ...payload });
                // Tests can make Firebase refuse a token to exercise the FAILED path.
                return storage.failTokens.has(token) ? { ok: false, reason: 'FCM_ERROR:messaging/registration-token-not-registered' } : { ok: true };
            }
        };
    }
    return realLoad.call(this, request, parent, isMain);
};

const SRC = path.join(__dirname, '..', '..', 'src');
const src = (p) => require(path.join(SRC, p));
const srcPath = (p) => path.join(SRC, p);

const authz = src('services/authorizationService');
const alertService = src('services/alertService');
const caregiverController = src('controllers/caregiverController');
const patientController = src('controllers/patientController');
const adminController = src('controllers/adminController');
const chatController = src('controllers/chatController');
const communityController = src('controllers/communityController');
const documentController = src('controllers/documentController');
const caseNoteController = src('controllers/caseNoteController');
const alertController = src('controllers/alertController');
const checkInFormController = src('controllers/checkInFormController');
const symptomController = src('controllers/symptomController');
const { whenNotificationsSettled } = src('services/alertNotificationService');
const rbac = src('middleware/rbacMiddleware');
const HttpError = src('utils/httpError');
const { DEFAULT_CAREGIVER_SCOPES, SCOPES } = src('constants/accessScopes');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const reset = () => {
    Object.keys(fakeDb._tables).forEach((k) => { fakeDb._tables[k].length = 0; });
    storage.reset();
};

// Runs an express handler like app.js would (HttpError -> its status).
const call = async (handler, { userId, body = {}, params = {}, query = {} }) => {
    const out = { status: 200, body: undefined };
    const res = { status(c) { out.status = c; return this; }, json(b) { out.body = b; return this; } };
    const req = { user: { userId }, body, params, query, ip: '127.0.0.1', get: () => 'test-agent', app: { get: () => null } };
    let error;
    await handler(req, res, (e) => { error = e; });
    if (error) {
        if (error instanceof HttpError) { out.status = error.status; out.body = { status: 'error', message: error.message, code: error.code, ...(error.errors ? { errors: error.errors } : {}) }; }
        else throw error;
    }
    return out;
};

const addUser = async (name, extra = {}) => fakeDb.useraccount.create({ data: { email: `${name}@test.dev`, full_name: name, ...extra } });
const addNgo = async () => {
    const u = await addUser('ngo');
    await fakeDb.staffprofile.create({ data: { user_id: u.id, is_active: true, roles: ['COUNSELLOR'] } });
    return u;
};
const addPatientWithOwner = async (name = 'patient') => {
    const owner = await addUser(`${name}-owner`);
    const patient = await fakeDb.patient.create({ data: { full_name: name, date_of_birth: new Date('1980-01-01') } });
    const link = await fakeDb.patientaccountlink.create({
        data: { user_id: owner.id, patient_id: patient.id, relationship_type: 'SELF', access_scopes: ['ALL'] }
    });
    return { owner, patient, link };
};
const addCaregiver = async (name, { type = 'FAMILY', recognized = false } = {}) => {
    const u = await addUser(name);
    const profile = await fakeDb.caregiverprofile.create({
        data: { user_id: u.id, caregiver_type: type, ...(recognized ? { ngo_recognition_status: 'RECOGNIZED', recognized_at: new Date() } : {}) }
    });
    return { user: u, profile };
};
const linkCaregiver = (patientId, caregiverId, extra = {}) => fakeDb.patientcaregiverlink.create({
    data: { patient_id: patientId, caregiver_user_id: caregiverId, access_scopes: [...DEFAULT_CAREGIVER_SCOPES], relationship_label: 'Cousin', ...extra }
});
const addInvite = (patientId, { code = 'ABCD1234', expiresInMs = 3600_000, used = false, createdBy = null } = {}) =>
    fakeDb.caregiverinvite.create({ data: { patient_id: patientId, code, expires_at: new Date(Date.now() + expiresInMs), is_used: used, created_by: createdBy } });
const auditActions = () => fakeDb.auditlogentry._rows().map((a) => a.action);

module.exports = {
    fakeDb, storage, call, reset, uuid, srcPath,
    addUser, addNgo, addPatientWithOwner, addCaregiver, linkCaregiver, addInvite, auditActions,
    authz, alertService, caregiverController, patientController, adminController, chatController,
    communityController, documentController, caseNoteController, alertController, rbac,
    checkInFormController, symptomController, whenNotificationsSettled,
    HttpError, DEFAULT_CAREGIVER_SCOPES, SCOPES
};
