const prisma = require('../config/db');
const { isUuid } = require('../utils/validators');
const { recordAudit, AUDIT_ACTIONS, RESOURCES } = require('../services/auditService');

/**
 * PATIENT CASE NOTES (NGO web)
 * Mounted through /api/admin (authMiddleware + requireCentralCounsellor), so only the central
 * NGO authority reaches these handlers.
 *
 * Notes are APPEND-ONLY in v1: there is no update or delete. The author is always the
 * authenticated account (never taken from the request body). The note text is stored only in
 * patientcasenote - it is never copied into the audit log (the audit row records who/what/when
 * and the note length, not the content) and never into chat messages.
 */

const MAX_NOTE_LENGTH = 5000;
const AUTHOR_BRIEF = { id: true, email: true, full_name: true };

const parsePagination = (query) => {
    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
    return { page, limit, skip: (page - 1) * limit };
};

const toResponse = ({ author, ...note }) => ({ ...note, author });

// GET /api/admin/patients/:id/case-notes?page=&limit=
exports.listCaseNotes = async (req, res, next) => {
    try {
        const { id } = req.params;
        if (!isUuid(id)) return res.status(400).json({ status: 'error', message: 'Invalid patient id.' });

        const patient = await prisma.patient.findUnique({ where: { id }, select: { id: true } });
        if (!patient) return res.status(404).json({ status: 'error', message: 'Patient not found.' });

        const { page, limit, skip } = parsePagination(req.query);
        const where = { patient_id: id };
        const [total, notes] = await Promise.all([
            prisma.patientcasenote.count({ where }),
            prisma.patientcasenote.findMany({
                where,
                orderBy: { created_at: 'desc' },
                skip,
                take: limit,
                include: { author: { select: AUTHOR_BRIEF } }
            })
        ]);

        return res.status(200).json({
            status: 'success',
            data: notes.map(toResponse),
            pagination: { page, limit, total, total_pages: Math.ceil(total / limit) }
        });
    } catch (error) { next(error); }
};

// POST /api/admin/patients/:id/case-notes   body: { note }
exports.createCaseNote = async (req, res, next) => {
    try {
        const { id } = req.params;
        const authorId = req.user.userId;

        if (!isUuid(id)) return res.status(400).json({ status: 'error', message: 'Invalid patient id.' });

        const raw = req.body ? req.body.note : undefined;
        if (typeof raw !== 'string' || raw.trim() === '') {
            return res.status(400).json({ status: 'error', message: 'note is required.' });
        }
        const note = raw.trim();
        if (note.length > MAX_NOTE_LENGTH) {
            return res.status(400).json({ status: 'error', message: `note must be at most ${MAX_NOTE_LENGTH} characters.` });
        }

        const patient = await prisma.patient.findUnique({ where: { id }, select: { id: true } });
        if (!patient) return res.status(404).json({ status: 'error', message: 'Patient not found.' });

        // The note and its audit record are saved together or not at all.
        const created = await prisma.$transaction(async (tx) => {
            const row = await tx.patientcasenote.create({
                data: { patient_id: id, author_id: authorId, note }
            });
            await recordAudit(tx, {
                actorId: authorId,
                action: AUDIT_ACTIONS.CASE_NOTE_CREATED,
                targetResource: RESOURCES.CASE_NOTE,
                targetId: row.id,
                patientId: id,
                extra: { note_length: note.length },
                req
            });
            return row;
        });

        return res.status(201).json({ status: 'success', data: created });
    } catch (error) { next(error); }
};
