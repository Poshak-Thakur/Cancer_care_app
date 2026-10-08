const prisma = require('../config/db');
const { isUuid } = require('../utils/validators');
const { recordAudit, AUDIT_ACTIONS, RESOURCES } = require('../services/auditService');
const HttpError = require('../utils/httpError');

/**
 * NGO WEB ADMIN API
 * Mounted at /api/admin behind authMiddleware + requireCentralCounsellor, so every handler
 * here already runs as the single central NGO head/counsellor (global access, no
 * staffassignment needed).
 */

const ALERT_STATUSES = ['OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS', 'RESOLVED', 'CANCELLED', 'ESCALATION_EXHAUSTED'];
// ESCALATION_EXHAUSTED is set by the system's escalation logic, never by hand.
const ADMIN_SETTABLE_ALERT_STATUSES = ['OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS', 'RESOLVED', 'CANCELLED'];
const ACTIVE_ALERT_STATUSES = ['OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS'];
const RESERVED_UPDATE_TYPES = ['STATUS_CHANGE'];

const USER_BRIEF = { id: true, email: true, full_name: true, phone_number: true };
const REL_ACCOUNT_USER = 'useraccount_patientaccountlink_user_idTouseraccount';
const REL_RECIPIENT_USER = 'useraccount_alertrecipient_recipient_user_idTouseraccount';

const parsePagination = (query) => {
    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
    return { page, limit, skip: (page - 1) * limit };
};

const writeAudit = (client, req, { targetId, action, payload }) =>
    client.auditlogentry.create({
        data: {
            actor_id: req.user.userId,
            target_resource: 'alert',
            target_id: targetId,
            action,
            payload: payload || undefined,
            ip_address: req.ip ? String(req.ip).slice(0, 45) : null,
            user_agent: req.get('user-agent') || null
        }
    });

// ------------------------------------------------------------------
// CAREGIVER NGO RECOGNITION
// Only the central NGO reaches these handlers (adminRoutes). Recognition is an NGO-side
// decision, never a patient or caregiver action. There is no approval/training workflow:
//   NOT_RECOGNIZED <-> RECOGNIZED
// ------------------------------------------------------------------

const RECOGNITION_STATUSES = ['NOT_RECOGNIZED', 'RECOGNIZED'];
const CAREGIVER_TYPE_VALUES = ['FAMILY', 'VOLUNTEER'];
const CAREGIVER_USER_SELECT = { id: true, email: true, full_name: true, phone_number: true, avatar_url: true };

// GET /api/admin/caregivers?recognition_status=&caregiver_type=&search=&page=&limit=
exports.listCaregivers = async (req, res, next) => {
    try {
        const { page, limit, skip } = parsePagination(req.query);
        const { recognition_status, caregiver_type } = req.query;
        const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';

        if (recognition_status !== undefined && !RECOGNITION_STATUSES.includes(recognition_status)) {
            return res.status(400).json({ status: 'error', message: 'recognition_status must be NOT_RECOGNIZED or RECOGNIZED.' });
        }
        if (caregiver_type !== undefined && !CAREGIVER_TYPE_VALUES.includes(caregiver_type)) {
            return res.status(400).json({ status: 'error', message: 'caregiver_type must be FAMILY or VOLUNTEER.' });
        }

        const where = {
            ...(recognition_status ? { ngo_recognition_status: recognition_status } : {}),
            ...(caregiver_type ? { caregiver_type } : {}),
            ...(search ? {
                useraccount: {
                    OR: [
                        { full_name: { contains: search, mode: 'insensitive' } },
                        { email: { contains: search, mode: 'insensitive' } }
                    ]
                }
            } : {})
        };

        const [total, profiles] = await Promise.all([
            prisma.caregiverprofile.count({ where }),
            prisma.caregiverprofile.findMany({
                where,
                orderBy: { created_at: 'desc' },
                skip,
                take: limit,
                include: { useraccount: { select: CAREGIVER_USER_SELECT } }
            })
        ]);

        const data = profiles.map(({ useraccount, ...profile }) => ({ ...profile, user: useraccount }));
        return res.status(200).json({
            status: 'success',
            data,
            pagination: { page, limit, total, total_pages: Math.ceil(total / limit) }
        });
    } catch (error) { next(error); }
};

// FROZEN BEHAVIOUR: recognition is an ELIGIBILITY switch, not a relationship change.
//   recognition removed  -> patient access is blocked centrally (authorizationService); no
//                           patientcaregiverlink is revoked or deleted.
//   recognised again     -> existing GRANTED + non-revoked links become usable again.
// Patient-specific consent lives on patientcaregiverlink; only revocation ends it.
// PATCH /api/admin/caregivers/:user_id/recognition   Body: { "recognized": true | false }
exports.setCaregiverRecognition = async (req, res, next) => {
    try {
        const targetUserId = req.params.user_id;
        const actorId = req.user.userId;
        const { recognized } = req.body || {};

        if (!isUuid(targetUserId)) {
            return res.status(400).json({ status: 'error', message: 'user_id must be a valid UUID.' });
        }
        if (typeof recognized !== 'boolean') {
            return res.status(400).json({ status: 'error', message: 'recognized must be true or false.' });
        }

        const result = await prisma.$transaction(async (tx) => {
            const profile = await tx.caregiverprofile.findUnique({ where: { user_id: targetUserId } });
            if (!profile) throw new HttpError(404, 'Caregiver profile not found.');

            const alreadyThere = (profile.ngo_recognition_status === 'RECOGNIZED') === recognized;
            if (alreadyThere) return { profile, changed: false };

            const updated = await tx.caregiverprofile.update({
                where: { user_id: targetUserId },
                data: recognized
                    ? { ngo_recognition_status: 'RECOGNIZED', recognized_by: actorId, recognized_at: new Date() }
                    : { ngo_recognition_status: 'NOT_RECOGNIZED', recognized_by: null, recognized_at: null }
            });

            await recordAudit(tx, {
                actorId,
                action: recognized ? AUDIT_ACTIONS.CAREGIVER_RECOGNIZED : AUDIT_ACTIONS.CAREGIVER_RECOGNITION_REVOKED,
                targetResource: RESOURCES.CAREGIVER_PROFILE,
                targetId: profile.id,
                targetUserId,
                extra: {
                    caregiver_type: profile.caregiver_type,
                    previous_status: profile.ngo_recognition_status,
                    new_status: updated.ngo_recognition_status
                },
                req
            });
            return { profile: updated, changed: true };
        });

        return res.status(200).json({
            status: 'success',
            message: result.changed
                ? (recognized ? 'Caregiver recognised.' : 'Caregiver recognition removed.')
                : 'No change: caregiver was already in that state.',
            data: result.profile
        });
    } catch (error) { next(error); }
};

// ------------------------------------------------------------------
// PATIENTS
// ------------------------------------------------------------------

// GET /api/admin/patients?search=&page=&limit=
exports.listPatients = async (req, res, next) => {
    try {
        const { page, limit, skip } = parsePagination(req.query);
        const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
        const where = search ? { full_name: { contains: search, mode: 'insensitive' } } : {};

        const [total, patients] = await Promise.all([
            prisma.patient.count({ where }),
            prisma.patient.findMany({
                where,
                orderBy: { created_at: 'desc' },
                skip,
                take: limit,
                select: {
                    id: true,
                    full_name: true,
                    date_of_birth: true,
                    preferred_language: true,
                    cancer_type: true,
                    cancer_stage: true,
                    diagnosis_date: true,
                    created_at: true,
                    _count: {
                        select: {
                            alert: { where: { status: { in: ACTIVE_ALERT_STATUSES } } },
                            patientcaregiverlink: { where: { consent_status: 'GRANTED', revoked_at: null } }
                        }
                    },
                    patientaccountlink: {
                        where: { consent_status: 'GRANTED', revoked_at: null },
                        select: {
                            relationship_type: true,
                            relationship_label: true,
                            [REL_ACCOUNT_USER]: { select: USER_BRIEF }
                        }
                    }
                }
            })
        ]);

        const data = patients.map(p => ({
            id: p.id,
            full_name: p.full_name,
            date_of_birth: p.date_of_birth,
            preferred_language: p.preferred_language,
            cancer_type: p.cancer_type,
            cancer_stage: p.cancer_stage,
            diagnosis_date: p.diagnosis_date,
            created_at: p.created_at,
            open_alerts_count: p._count.alert,
            caregivers_count: p._count.patientcaregiverlink,
            account_holders: p.patientaccountlink.map(l => ({
                relationship_type: l.relationship_type,
                relationship_label: l.relationship_label,
                user: l[REL_ACCOUNT_USER]
            }))
        }));

        return res.status(200).json({
            status: 'success',
            data,
            pagination: { page, limit, total, total_pages: Math.ceil(total / limit) }
        });
    } catch (error) { next(error); }
};

// GET /api/admin/patients/:id
exports.getPatient = async (req, res, next) => {
    try {
        const { id } = req.params;
        if (!isUuid(id)) return res.status(400).json({ status: 'error', message: 'Invalid patient id.' });

        const patient = await prisma.patient.findUnique({
            where: { id },
            include: {
                patientaccountlink: {
                    include: { [REL_ACCOUNT_USER]: { select: USER_BRIEF } }
                },
                patientcaregiverlink: {
                    include: {
                        useraccount: {
                            select: {
                                ...USER_BRIEF,
                                avatar_url: true,
                                caregiverprofile: { select: { caregiver_type: true, ngo_recognition_status: true, recognized_by: true, recognized_at: true } }
                            }
                        }
                    }
                },
                alert: { orderBy: { created_at: 'desc' }, take: 10 },
                patientmedication: { orderBy: { created_at: 'desc' }, take: 50 },
                medicaldocument: {
                    orderBy: { uploaded_at: 'desc' },
                    take: 10,
                    select: { id: true, title: true, document_type: true, verification_status: true, is_private: true, uploaded_at: true }
                },
                careevent: {
                    where: { schedule_time: { gte: new Date() }, completion_status: { in: ['SCHEDULED', 'DUE', 'SNOOZED'] } },
                    orderBy: { schedule_time: 'asc' },
                    take: 10
                },
                symptomevent: {
                    orderBy: { recorded_at: 'desc' },
                    take: 5,
                    include: { symptomobservation: true }
                }
            }
        });

        if (!patient) return res.status(404).json({ status: 'error', message: 'Patient not found.' });

        const {
            patientaccountlink, patientcaregiverlink, alert, patientmedication,
            medicaldocument, careevent, symptomevent, ...profile
        } = patient;

        return res.status(200).json({
            status: 'success',
            data: {
                profile,
                account_holders: patientaccountlink.map(({ [REL_ACCOUNT_USER]: user, ...link }) => ({ ...link, user })),
                caregivers: patientcaregiverlink.map(({ useraccount, ...link }) => ({ ...link, user: useraccount })),
                recent_alerts: alert,
                medications: patientmedication,
                recent_documents: medicaldocument,
                upcoming_care_events: careevent,
                recent_symptom_checkins: symptomevent
            }
        });
    } catch (error) { next(error); }
};

// ------------------------------------------------------------------
// ALERTS
// ------------------------------------------------------------------

// GET /api/admin/alerts?status=OPEN,IN_PROGRESS&severity=HIGH&patient_id=&page=&limit=
exports.listAlerts = async (req, res, next) => {
    try {
        const { page, limit, skip } = parsePagination(req.query);
        const where = {};

        if (req.query.status) {
            const statuses = String(req.query.status).split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
            if (statuses.some(s => !ALERT_STATUSES.includes(s))) {
                return res.status(400).json({ status: 'error', message: `Invalid status filter. Use any of: ${ALERT_STATUSES.join(', ')}.` });
            }
            where.status = { in: statuses };
        }
        if (req.query.severity) {
            where.severity = { equals: String(req.query.severity).trim(), mode: 'insensitive' };
        }
        if (req.query.patient_id) {
            if (!isUuid(req.query.patient_id)) {
                return res.status(400).json({ status: 'error', message: 'patient_id must be a valid UUID.' });
            }
            where.patient_id = req.query.patient_id;
        }

        const [total, alerts] = await Promise.all([
            prisma.alert.count({ where }),
            prisma.alert.findMany({
                where,
                orderBy: { created_at: 'desc' },
                skip,
                take: limit,
                include: {
                    patient: { select: { id: true, full_name: true } },
                    _count: { select: { alertrecipient: true, alertupdate: true } },
                    alertupdate: { orderBy: { created_at: 'desc' }, take: 1 }
                }
            })
        ]);

        const data = alerts.map(({ alertupdate, _count, ...alert }) => ({
            ...alert,
            recipients_count: _count.alertrecipient,
            updates_count: _count.alertupdate,
            latest_update: alertupdate[0] || null
        }));

        return res.status(200).json({
            status: 'success',
            data,
            pagination: { page, limit, total, total_pages: Math.ceil(total / limit) }
        });
    } catch (error) { next(error); }
};

// GET /api/admin/alerts/:id
exports.getAlert = async (req, res, next) => {
    try {
        const { id } = req.params;
        if (!isUuid(id)) return res.status(400).json({ status: 'error', message: 'Invalid alert id.' });

        const alert = await prisma.alert.findUnique({
            where: { id },
            include: {
                patient: {
                    select: { id: true, full_name: true, date_of_birth: true, preferred_language: true, cancer_type: true, cancer_stage: true }
                },
                alertrecipient: {
                    include: { [REL_RECIPIENT_USER]: { select: { id: true, email: true, full_name: true } } }
                },
                alertupdate: {
                    orderBy: { created_at: 'asc' },
                    include: { useraccount: { select: { id: true, email: true, full_name: true } } }
                }
            }
        });
        if (!alert) return res.status(404).json({ status: 'error', message: 'Alert not found.' });

        // For check-in triggered alerts, include the symptom check-in that caused it.
        let source = null;
        if (alert.source_type === 'CHECK_IN' && isUuid(alert.source_id)) {
            source = await prisma.symptomevent.findUnique({
                where: { id: alert.source_id },
                include: { symptomobservation: true }
            });
        }

        const { alertrecipient, alertupdate, ...alertFields } = alert;

        return res.status(200).json({
            status: 'success',
            data: {
                ...alertFields,
                source,
                recipients: alertrecipient.map(({ [REL_RECIPIENT_USER]: user, ...r }) => ({ ...r, user })),
                updates: alertupdate.map(({ useraccount, ...u }) => ({ ...u, created_by_user: useraccount }))
            }
        });
    } catch (error) { next(error); }
};

// PATCH /api/admin/alerts/:id/status   body: { status, note? }
exports.updateAlertStatus = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        const note = typeof req.body.note === 'string' ? req.body.note.trim() : '';

        if (!isUuid(id)) return res.status(400).json({ status: 'error', message: 'Invalid alert id.' });
        if (!ADMIN_SETTABLE_ALERT_STATUSES.includes(status)) {
            return res.status(400).json({ status: 'error', message: `Invalid status. Use one of: ${ADMIN_SETTABLE_ALERT_STATUSES.join(', ')}.` });
        }

        const alert = await prisma.alert.findUnique({ where: { id } });
        if (!alert) return res.status(404).json({ status: 'error', message: 'Alert not found.' });

        if (alert.status === status) {
            return res.status(200).json({ status: 'success', message: `Alert is already ${status}.`, data: alert });
        }

        const updatedAlert = await prisma.$transaction(async (tx) => {
            const updated = await tx.alert.update({
                where: { id },
                data: { status, updated_at: new Date() }
            });

            await tx.alertupdate.create({
                data: {
                    alert_id: id,
                    created_by: req.user.userId,
                    type: 'STATUS_CHANGE',
                    note: note ? `${alert.status} -> ${status}: ${note}` : `${alert.status} -> ${status}`
                }
            });

            await writeAudit(tx, req, {
                targetId: id,
                action: 'ALERT_STATUS_CHANGED',
                payload: { from: alert.status, to: status, note: note || null }
            });

            return updated;
        });

        return res.status(200).json({ status: 'success', data: updatedAlert });
    } catch (error) { next(error); }
};

// POST /api/admin/alerts/:id/updates   body: { note, type? }
exports.addAlertUpdate = async (req, res, next) => {
    try {
        const { id } = req.params;
        const note = typeof req.body.note === 'string' ? req.body.note.trim() : '';
        const type = typeof req.body.type === 'string' && req.body.type.trim() !== ''
            ? req.body.type.trim().toUpperCase()
            : 'NOTE';

        if (!isUuid(id)) return res.status(400).json({ status: 'error', message: 'Invalid alert id.' });
        if (!note) return res.status(400).json({ status: 'error', message: 'note is required.' });
        if (!/^[A-Z_]{1,50}$/.test(type) || RESERVED_UPDATE_TYPES.includes(type)) {
            return res.status(400).json({ status: 'error', message: 'Invalid update type.' });
        }

        const alert = await prisma.alert.findUnique({ where: { id }, select: { id: true } });
        if (!alert) return res.status(404).json({ status: 'error', message: 'Alert not found.' });

        const update = await prisma.$transaction(async (tx) => {
            const created = await tx.alertupdate.create({
                data: { alert_id: id, created_by: req.user.userId, type, note }
            });
            await tx.alert.update({ where: { id }, data: { updated_at: new Date() } });
            await writeAudit(tx, req, { targetId: id, action: 'ALERT_UPDATE_ADDED', payload: { update_id: created.id, type } });
            return created;
        });

        return res.status(201).json({ status: 'success', data: update });
    } catch (error) { next(error); }
};
