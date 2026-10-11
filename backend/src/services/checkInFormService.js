const { isUuid } = require('../utils/validators');

/**
 * DYNAMIC "TODAY'S CHECK-IN" - FIELD CONFIGURATION + ANSWER VALIDATION
 * ------------------------------------------------------------------
 * Pure functions (no database access) shared by checkInFormController (the NGO edits a draft)
 * and symptomController (Flutter submits answers against a published version).
 *
 * The NGO can only pick from a CONTROLLED list of field types and a WHITELIST of settings per
 * type. There is no free-form script / expression / regex support, so a configuration can never
 * execute code or hide a ReDoS in a validation rule.
 */

const FORM_SLUG = 'todays_checkin';
const FORM_TITLE = "Today's Check-in";

const FIELD_TYPES = Object.freeze(['TEXT', 'LONG_TEXT', 'NUMBER', 'BOOLEAN', 'SINGLE_CHOICE', 'MULTI_CHOICE', 'SCALE']);
const CHOICE_TYPES = Object.freeze(['SINGLE_CHOICE', 'MULTI_CHOICE']);

const LIMITS = Object.freeze({
    MAX_FIELDS: 40,
    MAX_OPTIONS: 30,
    MIN_CHOICE_OPTIONS: 2,
    MAX_LABEL: 255,
    MAX_HELP_TEXT: 1000,
    MAX_OPTION_VALUE: 64,
    TEXT_MAX_LENGTH: 255,
    LONG_TEXT_MAX_LENGTH: 2000,
    NUMBER_ABS_MAX: 1000000,   // answers are stored as Decimal(12,4)
    MAX_SCALE_SPAN: 100,
    MAX_UNIT: 20
});

const FIELD_KEY_REGEX = /^[a-z][a-z0-9_]{0,63}$/;
const OPTION_VALUE_REGEX = /^[a-z0-9][a-z0-9_-]{0,63}$/;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isInt = (v) => typeof v === 'number' && Number.isInteger(v);
const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v);

const slugifyOption = (label) => String(label).trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, LIMITS.MAX_OPTION_VALUE);

// ------------------------------------------------------------------
// validation_config (whitelisted, normalised, defaults filled in)
// ------------------------------------------------------------------
const rejectUnknownKeys = (config, allowed, errors) => {
    for (const key of Object.keys(config)) {
        if (!allowed.includes(key)) errors.push({ path: `validation_config.${key}`, message: `Unsupported setting "${key}" for this field type.` });
    }
};

const normalizeValidationConfig = (fieldType, raw, errors) => {
    const config = raw === undefined || raw === null ? {} : raw;
    if (!isPlainObject(config)) {
        errors.push({ path: 'validation_config', message: 'validation_config must be an object.' });
        return {};
    }
    const err = (key, message) => errors.push({ path: `validation_config.${key}`, message });

    switch (fieldType) {
        case 'TEXT':
        case 'LONG_TEXT': {
            rejectUnknownKeys(config, ['max_length'], errors);
            const cap = fieldType === 'TEXT' ? LIMITS.TEXT_MAX_LENGTH : LIMITS.LONG_TEXT_MAX_LENGTH;
            const max = config.max_length === undefined ? cap : config.max_length;
            if (!isInt(max) || max < 1 || max > cap) { err('max_length', `max_length must be a whole number between 1 and ${cap}.`); return {}; }
            return { max_length: max };
        }
        case 'NUMBER': {
            rejectUnknownKeys(config, ['min', 'max', 'integer', 'unit'], errors);
            const out = {};
            for (const key of ['min', 'max']) {
                if (config[key] === undefined || config[key] === null) continue;
                if (!isFiniteNum(config[key]) || Math.abs(config[key]) > LIMITS.NUMBER_ABS_MAX) err(key, `${key} must be a number within +/-${LIMITS.NUMBER_ABS_MAX}.`);
                else out[key] = config[key];
            }
            if (out.min !== undefined && out.max !== undefined && out.min > out.max) err('min', 'min cannot be greater than max.');
            if (config.integer !== undefined) {
                if (typeof config.integer !== 'boolean') err('integer', 'integer must be true or false.');
                else out.integer = config.integer;
            }
            if (config.unit !== undefined && config.unit !== null) {
                if (typeof config.unit !== 'string' || config.unit.trim() === '' || config.unit.trim().length > LIMITS.MAX_UNIT) err('unit', `unit must be a short text (max ${LIMITS.MAX_UNIT} characters).`);
                else out.unit = config.unit.trim();
            }
            return out;
        }
        case 'SCALE': {
            rejectUnknownKeys(config, ['min', 'max'], errors);
            const min = config.min === undefined ? 0 : config.min;
            const max = config.max === undefined ? 10 : config.max;
            if (!isInt(min) || !isInt(max)) { err('min', 'A scale needs whole-number min and max.'); return {}; }
            if (max <= min) { err('max', 'max must be greater than min.'); return {}; }
            if (max - min > LIMITS.MAX_SCALE_SPAN) { err('max', `A scale can span at most ${LIMITS.MAX_SCALE_SPAN} steps.`); return {}; }
            return { min, max };
        }
        case 'MULTI_CHOICE': {
            rejectUnknownKeys(config, ['min_selections', 'max_selections'], errors);
            const out = {};
            for (const key of ['min_selections', 'max_selections']) {
                if (config[key] === undefined || config[key] === null) continue;
                if (!isInt(config[key]) || config[key] < 0 || config[key] > LIMITS.MAX_OPTIONS) err(key, `${key} must be a whole number between 0 and ${LIMITS.MAX_OPTIONS}.`);
                else out[key] = config[key];
            }
            if (out.min_selections !== undefined && out.max_selections !== undefined && out.min_selections > out.max_selections) err('min_selections', 'min_selections cannot exceed max_selections.');
            return out;
        }
        case 'BOOLEAN':
        case 'SINGLE_CHOICE':
        default:
            rejectUnknownKeys(config, [], errors);
            return {};
    }
};

const normalizeOptions = (fieldType, raw, errors) => {
    if (!CHOICE_TYPES.includes(fieldType)) {
        if (raw !== undefined && raw !== null && !(Array.isArray(raw) && raw.length === 0)) {
            errors.push({ path: 'options', message: 'Only single-choice and multiple-choice fields can have options.' });
        }
        return [];
    }
    if (!Array.isArray(raw)) {
        errors.push({ path: 'options', message: 'options must be a list.' });
        return [];
    }
    if (raw.length < LIMITS.MIN_CHOICE_OPTIONS || raw.length > LIMITS.MAX_OPTIONS) {
        errors.push({ path: 'options', message: `A choice field needs between ${LIMITS.MIN_CHOICE_OPTIONS} and ${LIMITS.MAX_OPTIONS} options.` });
        return [];
    }
    const seen = new Set();
    const out = [];
    raw.forEach((opt, i) => {
        const path = `options[${i}]`;
        const input = typeof opt === 'string' ? { label: opt } : opt;
        if (!isPlainObject(input) || typeof input.label !== 'string' || input.label.trim() === '') {
            errors.push({ path: `${path}.label`, message: 'Every option needs a label.' });
            return;
        }
        const label = input.label.trim();
        if (label.length > LIMITS.MAX_LABEL) { errors.push({ path: `${path}.label`, message: `Option label must be at most ${LIMITS.MAX_LABEL} characters.` }); return; }
        const value = input.option_value === undefined || input.option_value === null ? slugifyOption(label) : input.option_value;
        if (typeof value !== 'string' || !OPTION_VALUE_REGEX.test(value)) {
            errors.push({ path: `${path}.option_value`, message: 'option_value may only contain lowercase letters, digits, "_" and "-".' });
            return;
        }
        if (seen.has(value)) { errors.push({ path: `${path}.option_value`, message: `Duplicate option "${value}".` }); return; }
        seen.add(value);
        out.push({ option_value: value, label, display_order: i + 1 });
    });
    return out;
};

/**
 * Validates + normalises a field definition coming from the NGO web.
 *   mode 'create': field_key, label and field_type are required.
 *   mode 'update': only the supplied properties are validated; field_key / field_type are
 *                  immutable (they identify the question across versions), `existing` carries them.
 * Returns { errors, value } where value only holds validated properties.
 */
const validateFieldInput = (input, { mode = 'create', existing = null } = {}) => {
    const errors = [];
    const value = {};
    if (!isPlainObject(input)) return { errors: [{ path: '', message: 'Request body must be an object.' }], value };
    const isCreate = mode === 'create';

    let fieldType = existing ? existing.field_type : undefined;
    if (isCreate) {
        if (!FIELD_TYPES.includes(input.field_type)) errors.push({ path: 'field_type', message: `field_type must be one of: ${FIELD_TYPES.join(', ')}.` });
        else { fieldType = input.field_type; value.field_type = fieldType; }
        if (typeof input.field_key !== 'string' || !FIELD_KEY_REGEX.test(input.field_key)) {
            errors.push({ path: 'field_key', message: 'field_key must start with a lowercase letter and contain only lowercase letters, digits and "_" (max 64).' });
        } else value.field_key = input.field_key;
    } else {
        if (input.field_type !== undefined && input.field_type !== existing.field_type) errors.push({ path: 'field_type', message: 'field_type cannot be changed. Remove the field and add a new one.' });
        if (input.field_key !== undefined && input.field_key !== existing.field_key) errors.push({ path: 'field_key', message: 'field_key cannot be changed because it identifies the question across versions.' });
    }

    if (isCreate || input.label !== undefined) {
        if (typeof input.label !== 'string' || input.label.trim() === '') errors.push({ path: 'label', message: 'label is required.' });
        else if (input.label.trim().length > LIMITS.MAX_LABEL) errors.push({ path: 'label', message: `label must be at most ${LIMITS.MAX_LABEL} characters.` });
        else value.label = input.label.trim();
    }
    if (input.help_text !== undefined) {
        if (input.help_text === null || (typeof input.help_text === 'string' && input.help_text.trim() === '')) value.help_text = null;
        else if (typeof input.help_text !== 'string' || input.help_text.trim().length > LIMITS.MAX_HELP_TEXT) errors.push({ path: 'help_text', message: `help_text must be text of at most ${LIMITS.MAX_HELP_TEXT} characters.` });
        else value.help_text = input.help_text.trim();
    }
    if (input.is_required !== undefined) {
        if (typeof input.is_required !== 'boolean') errors.push({ path: 'is_required', message: 'is_required must be true or false.' });
        else value.is_required = input.is_required;
    }
    if (input.display_order !== undefined) {
        if (!isInt(input.display_order) || input.display_order < 0 || input.display_order > 10000) errors.push({ path: 'display_order', message: 'display_order must be a whole number between 0 and 10000.' });
        else value.display_order = input.display_order;
    }

    if (fieldType) {
        if (isCreate || input.validation_config !== undefined) {
            value.validation_config = normalizeValidationConfig(fieldType, input.validation_config, errors);
        }
        if (isCreate || input.options !== undefined) {
            value.options = normalizeOptions(fieldType, input.options, errors);
        }
        // A multi-select cannot require more picks than it offers.
        if (value.options && value.validation_config && value.validation_config.min_selections > value.options.length) {
            errors.push({ path: 'validation_config.min_selections', message: 'min_selections cannot exceed the number of options.' });
        }
    }
    return { errors, value };
};

/**
 * Whole-version validation run right before publishing. `fields` are stored rows with `options`.
 */
const validateVersionForPublish = (fields) => {
    const errors = [];
    if (!Array.isArray(fields) || fields.length === 0) {
        errors.push({ path: 'fields', message: 'A published check-in needs at least one field.' });
        return errors;
    }
    if (fields.length > LIMITS.MAX_FIELDS) errors.push({ path: 'fields', message: `A check-in can have at most ${LIMITS.MAX_FIELDS} fields.` });
    const keys = new Set();
    for (const f of fields) {
        if (keys.has(f.field_key)) errors.push({ path: `fields.${f.field_key}`, message: 'Duplicate field_key.' });
        keys.add(f.field_key);
        const inner = [];
        normalizeValidationConfig(f.field_type, f.validation_config, inner);
        const options = CHOICE_TYPES.includes(f.field_type) ? (f.options || []) : [];
        if (CHOICE_TYPES.includes(f.field_type) && options.length < LIMITS.MIN_CHOICE_OPTIONS) {
            inner.push({ path: 'options', message: `A choice field needs at least ${LIMITS.MIN_CHOICE_OPTIONS} options.` });
        }
        const cfg = f.validation_config || {};
        if (f.field_type === 'MULTI_CHOICE' && cfg.min_selections > options.length) inner.push({ path: 'validation_config.min_selections', message: 'min_selections cannot exceed the number of options.' });
        inner.forEach((e) => errors.push({ path: `fields.${f.field_key}.${e.path}`, message: e.message }));
    }
    return errors;
};

// ------------------------------------------------------------------
// Answer validation (server-side source of truth)
// ------------------------------------------------------------------
const isBlank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);

/**
 * @param fields   stored fields of ONE form version, each with `options`
 * @param answers  [{ field_id, value }] from the client
 * @returns { errors: [{ field_id, path, message }], rows: [answer rows without symptom_event_id] }
 */
const validateAnswers = (fields, answers) => {
    const errors = [];
    const rows = [];
    if (!Array.isArray(answers)) return { errors: [{ path: 'answers', message: 'answers must be a list.' }], rows };
    if (answers.length > fields.length) return { errors: [{ path: 'answers', message: 'More answers than fields in this form version.' }], rows };

    const byId = new Map(fields.map((f) => [f.id, f]));
    const answered = new Set();

    answers.forEach((ans, i) => {
        const path = `answers[${i}]`;
        if (!isPlainObject(ans) || !isUuid(ans.field_id)) { errors.push({ path: `${path}.field_id`, message: 'field_id must be a valid UUID.' }); return; }
        const field = byId.get(ans.field_id);
        if (!field) { errors.push({ field_id: ans.field_id, path: `${path}.field_id`, message: 'This field does not belong to the submitted form version.' }); return; }
        if (answered.has(field.id)) { errors.push({ field_id: field.id, path: `${path}.field_id`, message: 'Duplicate answer for this field.' }); return; }
        answered.add(field.id);

        const v = ans.value;
        if (isBlank(v)) return; // unanswered; required-ness is checked below
        const cfg = field.validation_config || {};
        const bad = (message) => errors.push({ field_id: field.id, path: `${path}.value`, message: `${field.label}: ${message}` });
        const row = { field_id: field.id, option_id: null, value_text: null, value_number: null, value_boolean: null, value_json: null };

        switch (field.field_type) {
            case 'TEXT':
            case 'LONG_TEXT': {
                const cap = cfg.max_length || (field.field_type === 'TEXT' ? LIMITS.TEXT_MAX_LENGTH : LIMITS.LONG_TEXT_MAX_LENGTH);
                if (typeof v !== 'string') return bad('a text answer is required.');
                if (v.trim().length > cap) return bad(`must be at most ${cap} characters.`);
                row.value_text = v.trim();
                break;
            }
            case 'NUMBER': {
                if (!isFiniteNum(v) || Math.abs(v) > LIMITS.NUMBER_ABS_MAX) return bad('a valid number is required.');
                if (cfg.integer && !Number.isInteger(v)) return bad('a whole number is required.');
                if (cfg.min !== undefined && v < cfg.min) return bad(`must be at least ${cfg.min}.`);
                if (cfg.max !== undefined && v > cfg.max) return bad(`must be at most ${cfg.max}.`);
                row.value_number = v;
                break;
            }
            case 'SCALE': {
                const min = cfg.min === undefined ? 0 : cfg.min;
                const max = cfg.max === undefined ? 10 : cfg.max;
                if (!isInt(v) || v < min || v > max) return bad(`must be a whole number from ${min} to ${max}.`);
                row.value_number = v;
                break;
            }
            case 'BOOLEAN': {
                if (typeof v !== 'boolean') return bad('must be yes or no.');
                row.value_boolean = v;
                break;
            }
            case 'SINGLE_CHOICE': {
                const opt = typeof v === 'string' ? (field.options || []).find((o) => o.option_value === v || o.id === v) : null;
                if (!opt) return bad('is not one of the available options.');
                row.option_id = opt.id;
                row.value_text = opt.option_value;
                break;
            }
            case 'MULTI_CHOICE': {
                if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) return bad('must be a list of options.');
                const chosen = [];
                for (const x of v) {
                    const opt = (field.options || []).find((o) => o.option_value === x || o.id === x);
                    if (!opt) return bad('contains an option that is not available.');
                    if (chosen.includes(opt.option_value)) return bad('contains the same option twice.');
                    chosen.push(opt.option_value);
                }
                if (cfg.min_selections !== undefined && chosen.length < cfg.min_selections) return bad(`choose at least ${cfg.min_selections}.`);
                if (cfg.max_selections !== undefined && chosen.length > cfg.max_selections) return bad(`choose at most ${cfg.max_selections}.`);
                row.value_json = chosen;
                break;
            }
            default:
                return bad('has an unsupported field type.');
        }
        rows.push(row);
    });

    const answeredRows = new Set(rows.map((r) => r.field_id));
    for (const f of fields) {
        if (f.is_required && !answeredRows.has(f.id) && !errors.some((e) => e.field_id === f.id)) {
            errors.push({ field_id: f.id, path: 'answers', message: `${f.label}: this question is required.` });
        }
    }
    return { errors, rows };
};

module.exports = {
    FORM_SLUG, FORM_TITLE, FIELD_TYPES, CHOICE_TYPES, LIMITS,
    validateFieldInput, validateVersionForPublish, validateAnswers, normalizeValidationConfig
};
