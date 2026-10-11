/**
 * Shared patient-record field rules (NGO portal + the patient's own PATCH /api/patients/:patient_id).
 * Every field is validated against an allowlist; unknown / immutable fields are rejected, so nothing
 * arbitrary ever reaches the database.
 */

// Strict date parsing for date columns: 'YYYY-MM-DD' or a full ISO string. Returns a Date or null.
const parseDateInput = (value) => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(value.trim())) return null;
    const d = new Date(value.trim());
    return Number.isNaN(d.getTime()) ? null : d;
};

// field -> { required on create, nullable, validate(value) -> normalised value | undefined (invalid) }
const PATIENT_FIELDS = {
    full_name: { required: true, nullable: false, parse: (v) => (typeof v === 'string' && v.trim() !== '' && v.trim().length <= 255 ? v.trim() : undefined) },
    date_of_birth: { required: true, nullable: false, parse: (v) => { const d = parseDateInput(v); return d && d <= new Date() ? d : undefined; } },
    preferred_language: { nullable: false, parse: (v) => (typeof v === 'string' && /^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,8})?$/.test(v.trim()) && v.trim().length <= 10 ? v.trim() : undefined) },
    cancer_type: { nullable: true, parse: (v) => (typeof v === 'string' && v.trim() !== '' && v.trim().length <= 255 ? v.trim() : undefined) },
    cancer_stage: { nullable: true, parse: (v) => (typeof v === 'string' && v.trim() !== '' && v.trim().length <= 50 ? v.trim() : undefined) },
    diagnosis_date: { nullable: true, parse: (v) => { const d = parseDateInput(v); return d && d <= new Date() ? d : undefined; } },
    care_plan_summary: { nullable: true, parse: (v) => (typeof v === 'string' && v.trim() !== '' && v.length <= 10000 ? v.trim() : undefined) }
};

// Validates a body against the allowlist. Returns { data } or { error }.
// `allowedFields` narrows the allowlist (the patient may not edit care_plan_summary, which stays with the NGO).
const parsePatientBody = (body, { requireAll, allowedFields = Object.keys(PATIENT_FIELDS) }) => {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Request body must be a JSON object.' };
    const unknown = Object.keys(body).filter((k) => !allowedFields.includes(k));
    if (unknown.length > 0) {
        return { error: `Unknown or immutable field(s): ${unknown.join(', ')}. Allowed: ${allowedFields.join(', ')}.` };
    }
    const data = {};
    for (const [field, rule] of Object.entries(PATIENT_FIELDS).filter(([k]) => allowedFields.includes(k))) {
        const present = Object.prototype.hasOwnProperty.call(body, field);
        if (!present) {
            if (requireAll && rule.required) return { error: `${field} is required.` };
            continue;
        }
        const value = body[field];
        if (value === null) {
            if (!rule.nullable) return { error: `${field} cannot be null.` };
            data[field] = null;
            continue;
        }
        const parsed = rule.parse(value);
        if (parsed === undefined) return { error: `${field} is invalid.` };
        data[field] = parsed;
    }
    return { data };
};

module.exports = { PATIENT_FIELDS, parseDateInput, parsePatientBody };
