const prisma = require('../config/db');
const { isUuid } = require('../utils/validators');
const HttpError = require('../utils/httpError');
const { recordAudit, AUDIT_ACTIONS, RESOURCES } = require('../services/auditService');
const {
    FORM_SLUG, FORM_TITLE, LIMITS, validateFieldInput, validateVersionForPublish
} = require('../services/checkInFormService');

/**
 * DYNAMIC "TODAY'S CHECK-IN" FORM MANAGEMENT
 * ------------------------------------------------------------------
 * NGO web (central NGO authority only - see adminRoutes):
 *   GET    /api/admin/check-in-forms/current            published version + current draft (if any)
 *   POST   /api/admin/check-in-forms/drafts             create (or return) the draft, copied from the published form
 *   POST   /api/admin/check-in-forms/:versionId/fields  add a field to a draft
 *   PATCH  /api/admin/check-in-fields/:fieldId          edit a draft field
 *   DELETE /api/admin/check-in-fields/:fieldId          remove a field from a draft
 *   POST   /api/admin/check-in-forms/:versionId/publish validate + publish a draft
 * Flutter (any authenticated user):
 *   GET    /api/symptoms/check-in/form                  the PUBLISHED version only
 *
 * VERSIONING RULES
 *   - Only DRAFT versions are editable. Publishing archives the previous PUBLISHED version and makes
 *     the draft PUBLISHED; published/archived versions and their fields are never edited or deleted.
 *   - "Removing a field" = removing it from the draft, i.e. excluding it from the NEXT version.
 *     Old versions, their fields and every historical answer stay intact.
 *   - field_key + field_type are immutable: they identify a question across versions.
 *   - At most one DRAFT and one PUBLISHED version per form (partial unique indexes in the schema,
 *     plus an advisory lock here so concurrent editors cannot race).
 */

const ORDERED_FIELDS_INCLUDE = {
    fields: {
        orderBy: { display_order: 'asc' },
        include: { options: { orderBy: { display_order: 'asc' } } }
    }
};

const serializeOption = (o) => ({ id: o.id, option_value: o.option_value, label: o.label, display_order: o.display_order });

const serializeField = (f) => ({
    id: f.id,
    version_id: f.version_id,
    field_key: f.field_key,
    label: f.label,
    help_text: f.help_text ?? null,
    field_type: f.field_type,
    is_required: !!f.is_required,
    display_order: f.display_order,
    validation_config: f.validation_config || {},
    options: (f.options || []).slice().sort((a, b) => a.display_order - b.display_order).map(serializeOption)
});

const serializeVersion = (v) => v && ({
    id: v.id,
    form_id: v.form_id,
    version_number: v.version_number,
    status: v.status,
    published_at: v.published_at ?? null,
    archived_at: v.archived_at ?? null,
    created_at: v.created_at,
    fields: (v.fields || []).slice().sort((a, b) => a.display_order - b.display_order).map(serializeField)
});

// Serialises every write on one object (form / version) across concurrent requests (Postgres only;
// a harmless no-op in the in-memory test database).
const lock = (tx, key) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;

const validationFailed = (errors) =>
    new HttpError(400, 'Validation failed. Fix the listed problems and try again.', 'VALIDATION_FAILED', errors);

const sendValidationFailed = (res, errors) =>
    res.status(400).json({ status: 'error', code: 'VALIDATION_FAILED', message: 'Validation failed. Fix the listed problems and try again.', errors });

const findFormBySlug = (client) => client.checkinform.findUnique({ where: { slug: FORM_SLUG } });

const loadVersion = (client, id) => client.checkinformversion.findUnique({ where: { id }, include: ORDERED_FIELDS_INCLUDE });

const createFieldRows = async (tx, versionId, fieldInput) => {
    const field = await tx.checkinfield.create({
        data: {
            version_id: versionId,
            field_key: fieldInput.field_key,
            label: fieldInput.label,
            help_text: fieldInput.help_text ?? null,
            field_type: fieldInput.field_type,
            is_required: !!fieldInput.is_required,
            display_order: fieldInput.display_order,
            validation_config: fieldInput.validation_config || {}
        }
    });
    for (const opt of fieldInput.options || []) {
        await tx.checkinfieldoption.create({
            data: { field_id: field.id, option_value: opt.option_value, label: opt.label, display_order: opt.display_order }
        });
    }
    return field;
};

// ------------------------------------------------------------------
// GET /api/admin/check-in-forms/current
// ------------------------------------------------------------------
exports.getCurrentForm = async (req, res, next) => {
    try {
        const form = await findFormBySlug(prisma);
        if (!form) {
            return res.status(200).json({ status: 'success', data: { form: null, published: null, draft: null } });
        }
        const [published, draft] = await Promise.all([
            prisma.checkinformversion.findFirst({ where: { form_id: form.id, status: 'PUBLISHED' }, include: ORDERED_FIELDS_INCLUDE }),
            prisma.checkinformversion.findFirst({ where: { form_id: form.id, status: 'DRAFT' }, include: ORDERED_FIELDS_INCLUDE })
        ]);
        return res.status(200).json({
            status: 'success',
            data: {
                form: { id: form.id, slug: form.slug, title: form.title },
                published: serializeVersion(published),
                draft: serializeVersion(draft)
            }
        });
    } catch (error) { next(error); }
};

// ------------------------------------------------------------------
// POST /api/admin/check-in-forms/drafts
// ------------------------------------------------------------------
exports.createDraft = async (req, res, next) => {
    try {
        const userId = req.user.userId;
        let result;
        try {
            result = await prisma.$transaction(async (tx) => {
                await lock(tx, `checkin_form:${FORM_SLUG}`);

                let form = await findFormBySlug(tx);
                if (!form) {
                    form = await tx.checkinform.create({ data: { slug: FORM_SLUG, title: FORM_TITLE, created_by: userId } });
                    await recordAudit(tx, {
                        actorId: userId, action: AUDIT_ACTIONS.CHECKIN_FORM_CREATED,
                        targetResource: RESOURCES.CHECKIN_FORM, targetId: form.id, extra: { slug: form.slug }, req
                    });
                }

                const existingDraft = await tx.checkinformversion.findFirst({ where: { form_id: form.id, status: 'DRAFT' } });
                if (existingDraft) return { created: false, versionId: existingDraft.id };

                // The draft starts as a copy of what Flutter shows today (or the newest archived version).
                const published = await tx.checkinformversion.findFirst({ where: { form_id: form.id, status: 'PUBLISHED' }, include: ORDERED_FIELDS_INCLUDE });
                const newest = await tx.checkinformversion.findFirst({ where: { form_id: form.id }, orderBy: { version_number: 'desc' } });
                const base = published || (newest ? await loadVersion(tx, newest.id) : null);

                const draft = await tx.checkinformversion.create({
                    data: {
                        form_id: form.id,
                        version_number: (newest ? newest.version_number : 0) + 1,
                        status: 'DRAFT',
                        created_by: userId
                    }
                });
                for (const f of (base ? base.fields : [])) {
                    await createFieldRows(tx, draft.id, {
                        field_key: f.field_key, label: f.label, help_text: f.help_text, field_type: f.field_type,
                        is_required: f.is_required, display_order: f.display_order, validation_config: f.validation_config,
                        options: (f.options || []).map((o) => ({ option_value: o.option_value, label: o.label, display_order: o.display_order }))
                    });
                }
                await recordAudit(tx, {
                    actorId: userId, action: AUDIT_ACTIONS.CHECKIN_DRAFT_CREATED,
                    targetResource: RESOURCES.CHECKIN_VERSION, targetId: draft.id,
                    extra: { version_number: draft.version_number, based_on_version_id: base ? base.id : null }, req
                });
                return { created: true, versionId: draft.id };
            });
        } catch (txError) {
            // Two editors raced: the unique "one draft per form" index decided. Return the winner's draft.
            if (txError.code === 'P2002') {
                const form = await findFormBySlug(prisma);
                const draft = form && await prisma.checkinformversion.findFirst({ where: { form_id: form.id, status: 'DRAFT' }, include: ORDERED_FIELDS_INCLUDE });
                if (draft) return res.status(200).json({ status: 'success', message: 'A draft already exists.', data: serializeVersion(draft), meta: { created: false } });
            }
            throw txError;
        }
        const draft = await loadVersion(prisma, result.versionId);
        return res.status(result.created ? 201 : 200).json({
            status: 'success',
            message: result.created ? 'Draft created.' : 'A draft already exists.',
            data: serializeVersion(draft),
            meta: { created: result.created }
        });
    } catch (error) { next(error); }
};

// ------------------------------------------------------------------
// POST /api/admin/check-in-forms/:versionId/fields
// ------------------------------------------------------------------
exports.addField = async (req, res, next) => {
    try {
        const { versionId } = req.params;
        if (!isUuid(versionId)) return res.status(400).json({ status: 'error', message: 'Invalid version id.' });

        const { errors, value } = validateFieldInput(req.body, { mode: 'create' });
        if (errors.length > 0) return sendValidationFailed(res, errors);

        const field = await prisma.$transaction(async (tx) => {
            await lock(tx, `checkin_version:${versionId}`);
            const version = await loadVersion(tx, versionId);
            if (!version) throw new HttpError(404, 'Form version not found.');
            if (version.status !== 'DRAFT') throw new HttpError(409, 'Only a draft can be edited. Create a new draft first.', 'VERSION_NOT_EDITABLE');
            if (version.fields.length >= LIMITS.MAX_FIELDS) throw validationFailed([{ path: 'fields', message: `A check-in can have at most ${LIMITS.MAX_FIELDS} fields.` }]);
            if (version.fields.some((f) => f.field_key === value.field_key)) {
                throw new HttpError(409, `A field with the key "${value.field_key}" already exists in this draft.`, 'FIELD_KEY_EXISTS');
            }
            const nextOrder = version.fields.reduce((m, f) => Math.max(m, f.display_order), 0) + 1;
            const created = await createFieldRows(tx, versionId, { ...value, display_order: value.display_order ?? nextOrder });
            await recordAudit(tx, {
                actorId: req.user.userId, action: AUDIT_ACTIONS.CHECKIN_FIELD_ADDED,
                targetResource: RESOURCES.CHECKIN_FIELD, targetId: created.id,
                extra: { version_id: versionId, field_key: value.field_key, field_type: value.field_type }, req
            });
            return loadField(tx, created.id);
        });
        return res.status(201).json({ status: 'success', data: serializeField(field) });
    } catch (error) {
        if (error.code === 'P2002') return res.status(409).json({ status: 'error', code: 'FIELD_KEY_EXISTS', message: 'A field with this key already exists in this draft.' });
        next(error);
    }
};

const loadField = (client, id) => client.checkinfield.findUnique({
    where: { id },
    include: { options: { orderBy: { display_order: 'asc' } }, version: true }
});

// ------------------------------------------------------------------
// PATCH /api/admin/check-in-fields/:fieldId
// ------------------------------------------------------------------
exports.updateField = async (req, res, next) => {
    try {
        const { fieldId } = req.params;
        if (!isUuid(fieldId)) return res.status(400).json({ status: 'error', message: 'Invalid field id.' });

        const updated = await prisma.$transaction(async (tx) => {
            const first = await tx.checkinfield.findUnique({ where: { id: fieldId } });
            if (!first) throw new HttpError(404, 'Field not found.');
            await lock(tx, `checkin_version:${first.version_id}`);

            const field = await loadField(tx, fieldId);
            if (!field) throw new HttpError(404, 'Field not found.');
            if (field.version.status !== 'DRAFT') throw new HttpError(409, 'Published fields cannot be edited. Edit the draft instead.', 'VERSION_NOT_EDITABLE');

            const { errors, value } = validateFieldInput(req.body, { mode: 'update', existing: field });
            if (errors.length > 0) throw validationFailed(errors);
            // Settings that depend on the (possibly unchanged) option list.
            const optionCount = value.options ? value.options.length : field.options.length;
            const cfg = value.validation_config || field.validation_config || {};
            if (field.field_type === 'MULTI_CHOICE' && cfg.min_selections > optionCount) {
                throw validationFailed([{ path: 'validation_config.min_selections', message: 'min_selections cannot exceed the number of options.' }]);
            }

            const { options, ...columns } = value;
            const changed = Object.keys(value);
            if (changed.length === 0) throw validationFailed([{ path: '', message: 'Nothing to update.' }]);

            if (Object.keys(columns).length > 0) await tx.checkinfield.update({ where: { id: fieldId }, data: columns });
            if (options) {
                // Draft fields have never been answered (answers only reference non-draft versions), so the option list can be replaced.
                await tx.checkinfieldoption.deleteMany({ where: { field_id: fieldId } });
                for (const opt of options) {
                    await tx.checkinfieldoption.create({ data: { field_id: fieldId, option_value: opt.option_value, label: opt.label, display_order: opt.display_order } });
                }
            }
            await recordAudit(tx, {
                actorId: req.user.userId, action: AUDIT_ACTIONS.CHECKIN_FIELD_UPDATED,
                targetResource: RESOURCES.CHECKIN_FIELD, targetId: fieldId,
                extra: { version_id: field.version_id, field_key: field.field_key, changed }, req
            });
            return loadField(tx, fieldId);
        });
        return res.status(200).json({ status: 'success', data: serializeField(updated) });
    } catch (error) { next(error); }
};

// ------------------------------------------------------------------
// DELETE /api/admin/check-in-fields/:fieldId
// ------------------------------------------------------------------
exports.removeField = async (req, res, next) => {
    try {
        const { fieldId } = req.params;
        if (!isUuid(fieldId)) return res.status(400).json({ status: 'error', message: 'Invalid field id.' });

        await prisma.$transaction(async (tx) => {
            const first = await tx.checkinfield.findUnique({ where: { id: fieldId } });
            if (!first) throw new HttpError(404, 'Field not found.');
            await lock(tx, `checkin_version:${first.version_id}`);

            const field = await loadField(tx, fieldId);
            if (!field) throw new HttpError(404, 'Field not found.');
            // A published / archived field is history: it is excluded from the NEXT version instead.
            if (field.version.status !== 'DRAFT') {
                throw new HttpError(409, 'A published field cannot be deleted. Remove it from the draft so it is left out of the next version.', 'VERSION_NOT_EDITABLE');
            }
            await tx.checkinfieldoption.deleteMany({ where: { field_id: fieldId } });
            await tx.checkinfield.delete({ where: { id: fieldId } });
            await recordAudit(tx, {
                actorId: req.user.userId, action: AUDIT_ACTIONS.CHECKIN_FIELD_REMOVED,
                targetResource: RESOURCES.CHECKIN_FIELD, targetId: fieldId,
                extra: { version_id: field.version_id, field_key: field.field_key }, req
            });
        });
        return res.status(200).json({ status: 'success', message: 'Field removed from the draft.' });
    } catch (error) { next(error); }
};

// ------------------------------------------------------------------
// POST /api/admin/check-in-forms/:versionId/publish
// ------------------------------------------------------------------
exports.publishVersion = async (req, res, next) => {
    try {
        const { versionId } = req.params;
        if (!isUuid(versionId)) return res.status(400).json({ status: 'error', message: 'Invalid version id.' });
        const userId = req.user.userId;

        const published = await prisma.$transaction(async (tx) => {
            const first = await tx.checkinformversion.findUnique({ where: { id: versionId } });
            if (!first) throw new HttpError(404, 'Form version not found.');
            await lock(tx, `checkin_form:${FORM_SLUG}`);

            const draft = await loadVersion(tx, versionId);
            if (!draft) throw new HttpError(404, 'Form version not found.');
            if (draft.status !== 'DRAFT') throw new HttpError(409, 'Only a draft can be published.', 'VERSION_NOT_EDITABLE');

            const errors = validateVersionForPublish(draft.fields);
            if (errors.length > 0) throw validationFailed(errors);

            const now = new Date();
            const previous = await tx.checkinformversion.findFirst({ where: { form_id: draft.form_id, status: 'PUBLISHED' } });
            if (previous) {
                await tx.checkinformversion.updateMany({
                    where: { id: previous.id, status: 'PUBLISHED' },
                    data: { status: 'ARCHIVED', archived_at: now, updated_at: now }
                });
                await recordAudit(tx, {
                    actorId: userId, action: AUDIT_ACTIONS.CHECKIN_VERSION_ARCHIVED,
                    targetResource: RESOURCES.CHECKIN_VERSION, targetId: previous.id,
                    extra: { version_number: previous.version_number, replaced_by_version_id: draft.id }, req
                });
            }
            const flipped = await tx.checkinformversion.updateMany({
                where: { id: draft.id, status: 'DRAFT' },
                data: { status: 'PUBLISHED', published_at: now, published_by: userId, updated_at: now }
            });
            if (flipped.count !== 1) throw new HttpError(409, 'This draft was changed by someone else. Reload and try again.', 'STALE_VERSION');
            await recordAudit(tx, {
                actorId: userId, action: AUDIT_ACTIONS.CHECKIN_VERSION_PUBLISHED,
                targetResource: RESOURCES.CHECKIN_VERSION, targetId: draft.id,
                extra: { version_number: draft.version_number, field_count: draft.fields.length, previous_version_id: previous ? previous.id : null }, req
            });
            return loadVersion(tx, draft.id);
        });
        return res.status(200).json({ status: 'success', message: 'Check-in form published.', data: serializeVersion(published) });
    } catch (error) { next(error); }
};

// ------------------------------------------------------------------
// GET /api/symptoms/check-in/form   (Flutter - any authenticated user)
// ------------------------------------------------------------------
exports.getPublishedForm = async (req, res, next) => {
    try {
        const form = await findFormBySlug(prisma);
        const version = form && await prisma.checkinformversion.findFirst({
            where: { form_id: form.id, status: 'PUBLISHED' },
            include: ORDERED_FIELDS_INCLUDE
        });
        if (!version) {
            // Flutter keeps its built-in check-in screen until the NGO publishes a form.
            return res.status(404).json({ status: 'error', code: 'NO_PUBLISHED_FORM', message: 'No check-in form has been published yet.' });
        }
        const v = serializeVersion(version);
        return res.status(200).json({
            status: 'success',
            data: {
                form: { id: form.id, slug: form.slug, title: form.title },
                version: { id: v.id, version_number: v.version_number, published_at: v.published_at },
                fields: v.fields
            }
        });
    } catch (error) { next(error); }
};

exports._internals = { serializeVersion, serializeField, ORDERED_FIELDS_INCLUDE };
