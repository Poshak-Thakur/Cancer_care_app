const prisma = require('../config/db');
const { isUuid } = require('../utils/validators');
const { parseDateInput, parsePatientBody } = require('../utils/patientFields');
const { recordAudit, AUDIT_ACTIONS, RESOURCES } = require('../services/auditService');
const crypto = require('crypto');
const { getISTDayRangeFromDateString } = require('../utils/timezoneHelper');
const HttpError = require('../utils/httpError');
const { lockPatientSelf } = require('../services/patientSelfLockService');

/**
 * NGO WEB ADMIN API
 * Mounted at /api/admin behind authMiddleware + requireCentralCounsellor, so every handler
 * here already runs as the single central NGO head/counsellor (global access, no
 * staffassignment needed).
 */

const ALERT_STATUSES = ['OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS', 'RESOLVED', 'CANCELLED', 'ESCALATION_EXHAUSTED'];
// STAFF LIFECYCLE (strict, one step at a time):  OPEN -> ACKNOWLEDGED -> IN_PROGRESS -> RESOLVED
//   - CANCELLED belongs only to the original requester's Help Now cancel endpoint
//     (alertController.cancelHelpNow); staff can never cancel, automatic or manual.
//   - ESCALATION_EXHAUSTED is set by the system's escalation logic, never by hand.
//   - Staff cannot reopen (RESOLVED -> OPEN) or skip steps. A recurring condition reopens an alert
//     through alertService (system), not through this API.
const STAFF_ALERT_TRANSITIONS = Object.freeze({
    OPEN: ['ACKNOWLEDGED'],
    ACKNOWLEDGED: ['IN_PROGRESS'],
    IN_PROGRESS: ['RESOLVED']
});
const ADMIN_SETTABLE_ALERT_STATUSES = ['ACKNOWLEDGED', 'IN_PROGRESS', 'RESOLVED'];
const ACTIVE_ALERT_STATUSES = ['OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS'];
const RESERVED_UPDATE_TYPES = ['STATUS_CHANGE'];

const USER_BRIEF = { id: true, email: true, full_name: true, phone_number: true };
const REL_ACCOUNT_USER = 'useraccount_patientaccountlink_user_idTouseraccount';
const REL_CONSENT_GRANTEE = 'useraccount_consentrecord_grantee_idTouseraccount';
const REL_CONSENT_GRANTOR = 'useraccount_consentrecord_granted_byTouseraccount';
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
// OVERVIEW (dashboard metrics)
// ------------------------------------------------------------------

// GET /api/admin/overview
exports.getOverview = async (req, res, next) => {
    try {
        const now = new Date();
        const [
            totalPatients, activeAlerts, overdueCareEvents, documentsAwaitingVerification,
            caregiversAwaitingRecognition, postsPendingModeration, openCommunityReports
        ] = await Promise.all([
            prisma.patient.count(),
            prisma.alert.count({ where: { status: { in: ACTIVE_ALERT_STATUSES } } }),
            // Overdue = still SCHEDULED / DUE although its time has passed.
            prisma.careevent.count({ where: { completion_status: { in: ['SCHEDULED', 'DUE'] }, schedule_time: { lt: now } } }),
            prisma.medicaldocument.count({ where: { verification_status: 'PENDING' } }),
            prisma.caregiverprofile.count({ where: { ngo_recognition_status: 'NOT_RECOGNIZED' } }),
            // Same rule as the moderation queue for public posts.
            prisma.communitypost.count({ where: { visibility: 'PUBLIC', status: 'PENDING' } }),
            prisma.communityreport.count({ where: { status: 'OPEN' } })
        ]);

        return res.status(200).json({
            status: 'success',
            data: {
                total_patients: totalPatients,
                active_alerts: activeAlerts,
                overdue_care_events: overdueCareEvents,
                documents_awaiting_verification: documentsAwaitingVerification,
                caregivers_awaiting_recognition: caregiversAwaitingRecognition,
                posts_pending_moderation: postsPendingModeration,
                open_community_reports: openCommunityReports,
                // Deliberately NOT reported: patients have no defined expected check-in frequency, so
                // a "missed check-ins" number would be a guess presented as a fact.
                unavailable_metrics: {
                    missed_check_ins: 'No expected check-in frequency is defined for patients.'
                },
                generated_at: now.toISOString()
            }
        });
    } catch (error) { next(error); }
};

// ------------------------------------------------------------------
// NGO-MANAGED PATIENT RECORDS
// Creates / updates the patient record ONLY. No login account, no password and no SELF
// patientaccountlink is ever created here (POST /api/patients stays the patient's own SELF flow).
// There is no delete: patients are never permanently deleted from the NGO portal.
// ------------------------------------------------------------------

// POST /api/admin/patients
exports.createPatient = async (req, res, next) => {
    try {
        const parsed = parsePatientBody(req.body, { requireAll: true });
        if (parsed.error) return res.status(400).json({ status: 'error', message: parsed.error });

        const patient = await prisma.$transaction(async (tx) => {
            const created = await tx.patient.create({ data: parsed.data });
            await recordAudit(tx, {
                actorId: req.user.userId,
                action: AUDIT_ACTIONS.PATIENT_CREATED,
                targetResource: RESOURCES.PATIENT,
                targetId: created.id,
                patientId: created.id,
                // field NAMES only - health details are not copied into the audit log
                extra: { fields: Object.keys(parsed.data) },
                req
            });
            return created;
        });

        return res.status(201).json({ status: 'success', data: patient });
    } catch (error) { next(error); }
};

// PATCH /api/admin/patients/:id
exports.updatePatient = async (req, res, next) => {
    try {
        const { id } = req.params;
        if (!isUuid(id)) return res.status(400).json({ status: 'error', message: 'Invalid patient id.' });

        const parsed = parsePatientBody(req.body, { requireAll: false });
        if (parsed.error) return res.status(400).json({ status: 'error', message: parsed.error });
        if (Object.keys(parsed.data).length === 0) {
            return res.status(400).json({ status: 'error', message: 'Provide at least one field to update.' });
        }

        const existing = await prisma.patient.findUnique({ where: { id }, select: { id: true } });
        if (!existing) return res.status(404).json({ status: 'error', message: 'Patient not found.' });

        const patient = await prisma.$transaction(async (tx) => {
            const updated = await tx.patient.update({
                where: { id },
                data: { ...parsed.data, updated_at: new Date() }
            });
            await recordAudit(tx, {
                actorId: req.user.userId,
                action: AUDIT_ACTIONS.PATIENT_UPDATED,
                targetResource: RESOURCES.PATIENT,
                targetId: id,
                patientId: id,
                extra: { fields: Object.keys(parsed.data) },
                req
            });
            return updated;
        });

        return res.status(200).json({ status: 'success', data: patient });
    } catch (error) { next(error); }
};

// ------------------------------------------------------------------
// AUDIT LOG (read-only view of auditlogentry)
// ------------------------------------------------------------------

// GET /api/admin/audit-logs?page=&limit=&action=&target_resource=&target_id=&from=&to=
exports.listAuditLogs = async (req, res, next) => {
    try {
        const { page, limit, skip } = parsePagination(req.query);
        const { action, target_resource, target_id, from, to } = req.query;
        const where = {};

        if (action !== undefined && action !== '') {
            if (typeof action !== 'string' || !/^[A-Z0-9_]{1,50}$/.test(action)) {
                return res.status(400).json({ status: 'error', message: 'action must be an upper-case audit action name.' });
            }
            where.action = action;
        }
        if (target_resource !== undefined && target_resource !== '') {
            if (typeof target_resource !== 'string' || !/^[A-Za-z0-9_]{1,100}$/.test(target_resource)) {
                return res.status(400).json({ status: 'error', message: 'target_resource is invalid.' });
            }
            where.target_resource = target_resource;
        }
        if (target_id !== undefined && target_id !== '') {
            if (!isUuid(target_id)) return res.status(400).json({ status: 'error', message: 'target_id must be a valid UUID.' });
            where.target_id = target_id;
        }

        const range = {};
        if (from !== undefined && from !== '') {
            const d = parseDateInput(from);
            if (!d) return res.status(400).json({ status: 'error', message: 'from must be a valid date.' });
            range.gte = d;
        }
        if (to !== undefined && to !== '') {
            const d = parseDateInput(to);
            if (!d) return res.status(400).json({ status: 'error', message: 'to must be a valid date.' });
            // A bare date means "through the end of that day".
            range.lte = /^\d{4}-\d{2}-\d{2}$/.test(String(to).trim()) ? new Date(d.getTime() + 24 * 60 * 60 * 1000 - 1) : d;
        }
        if (range.gte && range.lte && range.gte > range.lte) {
            return res.status(400).json({ status: 'error', message: 'from must not be after to.' });
        }
        if (range.gte || range.lte) where.created_at = range;

        const [total, rows] = await Promise.all([
            prisma.auditlogentry.count({ where }),
            prisma.auditlogentry.findMany({
                where,
                orderBy: { created_at: 'desc' },
                skip,
                take: limit,
                include: { useraccount: { select: USER_BRIEF } }
            })
        ]);

        const data = rows.map(({ useraccount, ...entry }) => ({ ...entry, actor: useraccount || null }));
        return res.status(200).json({
            status: 'success',
            data,
            pagination: { page, limit, total, total_pages: Math.ceil(total / limit) }
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
                },
                // Consent history (granted + revoked rows are both kept).
                consentrecord: {
                    orderBy: { granted_at: 'desc' },
                    take: 200,
                    include: {
                        [REL_CONSENT_GRANTEE]: { select: USER_BRIEF },
                        [REL_CONSENT_GRANTOR]: { select: USER_BRIEF }
                    }
                },
                // Prescription METADATA + extraction info. file_path is never selected: files are only
                // reachable through GET /api/admin/prescriptions/:id/file-url (short-lived signed URL).
                prescription: {
                    orderBy: { uploaded_at: 'desc' },
                    take: 20,
                    select: {
                        id: true,
                        mime_type: true,
                        file_size_bytes: true,
                        uploaded_by: true,
                        uploaded_at: true,
                        prescriptionextraction: {
                            orderBy: { processed_at: 'desc' },
                            take: 1,
                            select: { id: true, extracted_text: true, confidence_score: true, processed_at: true }
                        }
                    }
                }
            }
        });

        if (!patient) return res.status(404).json({ status: 'error', message: 'Patient not found.' });

        const {
            patientaccountlink, patientcaregiverlink, alert, patientmedication,
            medicaldocument, careevent, symptomevent, consentrecord, prescription, ...profile
        } = patient;

        return res.status(200).json({
            status: 'success',
            data: {
                profile,
                // Current AND historical relationships: revoked links stay in the list, with is_active.
                account_holders: patientaccountlink.map(({ [REL_ACCOUNT_USER]: user, ...link }) => ({
                    ...link, user, is_active: link.consent_status === 'GRANTED' && link.revoked_at === null
                })),
                caregivers: patientcaregiverlink.map(({ useraccount, ...link }) => ({
                    ...link, user: useraccount, is_active: link.consent_status === 'GRANTED' && link.revoked_at === null
                })),
                consent_history: consentrecord.map(({ [REL_CONSENT_GRANTEE]: grantee, [REL_CONSENT_GRANTOR]: granted_by_user, ...c }) => ({
                    ...c, grantee, granted_by_user
                })),
                prescriptions: prescription.map(({ prescriptionextraction, file_size_bytes, ...rx }) => ({
                    ...rx,
                    file_size_bytes: Number(file_size_bytes),
                    extraction: prescriptionextraction[0] || null
                })),
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
                requested_by: { select: { id: true, email: true, full_name: true } },
                alertrecipient: {
                    include: {
                        [REL_RECIPIENT_USER]: { select: { id: true, email: true, full_name: true } },
                        // delivery status per recipient (QUEUED / SENT / DELIVERED / SEEN / FAILED ...)
                        alertdelivery: { orderBy: { queued_at: 'asc' } }
                    }
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
                recipients: alertrecipient.map(({ [REL_RECIPIENT_USER]: user, alertdelivery, ...r }) => ({ ...r, user, deliveries: alertdelivery })),
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
        if (typeof status !== 'string' || !ALERT_STATUSES.includes(status)) {
            return res.status(400).json({ status: 'error', message: `Invalid status. Use one of: ${ADMIN_SETTABLE_ALERT_STATUSES.join(', ')}.` });
        }

        const alert = await prisma.alert.findUnique({ where: { id } });
        if (!alert) return res.status(404).json({ status: 'error', message: 'Alert not found.' });

        // CANCELLED is exclusive to the original requester's manual Help Now cancellation.
        if (status === 'CANCELLED') {
            if (alert.type === 'HELP_REQUEST') {
                return res.status(403).json({
                    status: 'error',
                    code: 'HELP_NOW_CANCEL_REQUESTER_ONLY',
                    message: 'A Help Now request can only be cancelled by the person who sent it. Acknowledge, progress or resolve it instead.'
                });
            }
            return res.status(403).json({
                status: 'error',
                code: 'ALERT_CANCEL_NOT_ALLOWED',
                message: 'Staff cannot cancel alerts. Acknowledge, progress or resolve it instead.'
            });
        }
        // Set by the escalation system only.
        if (status === 'ESCALATION_EXHAUSTED') {
            return res.status(403).json({
                status: 'error',
                code: 'SYSTEM_STATUS_ONLY',
                message: 'ESCALATION_EXHAUSTED is set by the system and cannot be set manually.'
            });
        }

        if (alert.status === status) {
            return res.status(200).json({ status: 'success', message: `Alert is already ${status}.`, data: alert });
        }

        const allowed = STAFF_ALERT_TRANSITIONS[alert.status] || [];
        if (!allowed.includes(status)) {
            return res.status(409).json({
                status: 'error',
                code: 'INVALID_TRANSITION',
                message: allowed.length > 0
                    ? `An alert that is ${alert.status} can only move to ${allowed.join(' or ')}.`
                    : `An alert that is ${alert.status} can no longer be changed by staff.`,
                allowed_transitions: allowed
            });
        }

        const updatedAlert = await prisma.$transaction(async (tx) => {
            // Atomic compare-and-set: two staff members (or two tabs) cannot both apply the same step.
            const changed = await tx.alert.updateMany({
                where: { id, status: alert.status },
                data: { status, updated_at: new Date() }
            });
            if (changed.count !== 1) {
                throw new HttpError(409, 'The alert status changed in the meantime. Reload and try again.', 'STALE_STATUS');
            }

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

            return tx.alert.findUnique({ where: { id } });
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

// ------------------------------------------------------------------
// NGO WEB: document verification queue
// GET /api/admin/documents?verification_status=PENDING&page=&limit=
// Oldest first. The private storage path (file_path) is never part of the response - the browser
// uses the short-lived signed-URL endpoint instead.
// ------------------------------------------------------------------
const VERIFICATION_STATUSES = ['PENDING', 'VERIFIED', 'REJECTED'];

exports.listDocuments = async (req, res, next) => {
    try {
        const { page, limit, skip } = parsePagination(req.query);
        const status = req.query.verification_status;
        if (status !== undefined && status !== '' && !VERIFICATION_STATUSES.includes(status)) {
            return res.status(400).json({ status: 'error', message: `verification_status must be one of: ${VERIFICATION_STATUSES.join(', ')}.` });
        }
        const where = status ? { verification_status: status } : {};

        const [total, documents] = await Promise.all([
            prisma.medicaldocument.count({ where }),
            prisma.medicaldocument.findMany({
                where,
                orderBy: [{ uploaded_at: 'asc' }, { id: 'asc' }],
                skip,
                take: limit,
                select: {
                    id: true,
                    title: true,
                    document_type: true,
                    verification_status: true,
                    is_private: true,
                    uploaded_at: true,
                    patient: { select: { id: true, full_name: true } }
                }
            })
        ]);

        const data = documents.map((d) => ({
            id: d.id,
            title: d.title,
            document_type: d.document_type,
            verification_status: d.verification_status,
            is_private: d.is_private,
            uploaded_at: d.uploaded_at,
            patient: d.patient ? { id: d.patient.id, full_name: d.patient.full_name } : null
        }));

        return res.status(200).json({
            status: 'success',
            data,
            pagination: { page, limit, total, total_pages: Math.ceil(total / limit) }
        });
    } catch (error) { next(error); }
};

// ------------------------------------------------------------------
// NGO WEB: care events across all patients
// GET /api/admin/care-events?overdue=true|false&from=YYYY-MM-DD&to=YYYY-MM-DD&page=&limit=
//   from / to : inclusive IST calendar days
//   overdue=true  : completion_status IN (SCHEDULED, DUE) AND schedule_time < now
//   overdue=false : everything that is NOT overdue
// ------------------------------------------------------------------
const OVERDUE_STATUSES = ['SCHEDULED', 'DUE'];

exports.listCareEvents = async (req, res, next) => {
    try {
        const { page, limit, skip } = parsePagination(req.query);
        const { overdue, from, to } = req.query;
        const conditions = [];

        if (overdue !== undefined && overdue !== '') {
            if (overdue !== 'true' && overdue !== 'false') {
                return res.status(400).json({ status: 'error', message: 'overdue must be true or false.' });
            }
            const now = new Date();
            conditions.push(overdue === 'true'
                ? { completion_status: { in: OVERDUE_STATUSES }, schedule_time: { lt: now } }
                : { OR: [{ completion_status: { notIn: OVERDUE_STATUSES } }, { schedule_time: { gte: now } }] });
        }

        let fromRange = null;
        let toRange = null;
        if (from !== undefined && from !== '') {
            fromRange = getISTDayRangeFromDateString(from);
            if (!fromRange) return res.status(400).json({ status: 'error', message: 'from must be a valid date in YYYY-MM-DD format.' });
        }
        if (to !== undefined && to !== '') {
            toRange = getISTDayRangeFromDateString(to);
            if (!toRange) return res.status(400).json({ status: 'error', message: 'to must be a valid date in YYYY-MM-DD format.' });
        }
        if (fromRange && toRange && fromRange.startOfDay > toRange.startOfDay) {
            return res.status(400).json({ status: 'error', message: 'from cannot be after to.' });
        }
        if (fromRange || toRange) {
            conditions.push({
                schedule_time: {
                    ...(fromRange ? { gte: fromRange.startOfDay } : {}),
                    ...(toRange ? { lte: toRange.endOfDay } : {})
                }
            });
        }

        const where = conditions.length > 0 ? { AND: conditions } : {};
        const [total, events] = await Promise.all([
            prisma.careevent.count({ where }),
            prisma.careevent.findMany({
                where,
                orderBy: [{ schedule_time: 'asc' }, { id: 'asc' }],
                skip,
                take: limit,
                include: {
                    patient: { select: { id: true, full_name: true } },
                    patientmedication: { select: { name: true } }
                }
            })
        ]);

        const data = events.map((e) => ({
            ...e,
            patient: e.patient ? { id: e.patient.id, full_name: e.patient.full_name } : null,
            patientmedication: e.patientmedication ? { name: e.patientmedication.name } : null
        }));

        return res.status(200).json({
            status: 'success',
            data,
            pagination: { page, limit, total, total_pages: Math.ceil(total / limit) }
        });
    } catch (error) { next(error); }
};

// ------------------------------------------------------------------
// NGO WEB (optional): verify a medication
// PATCH /api/admin/medications/:id/verify   body: { verification_status: 'PENDING' | 'VERIFIED' | 'REJECTED' }
// Records who verified it and when (cleared again on PENDING) and audits every change.
// ------------------------------------------------------------------
exports.verifyMedication = async (req, res, next) => {
    try {
        const { id } = req.params;
        const verification_status = req.body?.verification_status;
        if (!isUuid(id)) return res.status(400).json({ status: 'error', message: 'Invalid medication id.' });
        if (!VERIFICATION_STATUSES.includes(verification_status)) {
            return res.status(400).json({ status: 'error', message: `verification_status must be one of: ${VERIFICATION_STATUSES.join(', ')}.` });
        }

        const existing = await prisma.patientmedication.findUnique({ where: { id }, select: { id: true, patient_id: true, verification_status: true } });
        if (!existing) return res.status(404).json({ status: 'error', message: 'Medication not found.' });

        const updated = await prisma.$transaction(async (tx) => {
            const row = await tx.patientmedication.update({
                where: { id },
                data: {
                    verification_status,
                    verified_by: verification_status === 'PENDING' ? null : req.user.userId,
                    verified_at: verification_status === 'PENDING' ? null : new Date()
                }
            });
            if (existing.verification_status !== verification_status) {
                await recordAudit(tx, {
                    actorId: req.user.userId,
                    action: AUDIT_ACTIONS.MEDICATION_VERIFICATION_CHANGED,
                    targetResource: RESOURCES.MEDICATION,
                    targetId: id,
                    patientId: existing.patient_id,
                    extra: { from: existing.verification_status, to: verification_status },
                    req
                });
            }
            return row;
        });

        return res.status(200).json({ status: 'success', data: updated });
    } catch (error) { next(error); }
};

// ------------------------------------------------------------------
// NGO WEB: one-time code that lets the real patient claim an NGO-created record
// POST /api/admin/patients/:id/claim-code
// The patient installs the app, signs in, and enters the code (POST /api/patients/claim); the record
// then becomes their SELF account. Older unused claim codes of this patient are retired first, so only
// the newest code works. The code is returned ONCE here and is never written to logs or audit payloads.
// ------------------------------------------------------------------
const CLAIM_CODE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

exports.createPatientClaimCode = async (req, res, next) => {
    try {
        const patientId = req.params.id;
        if (!isUuid(patientId)) return res.status(400).json({ status: 'error', message: 'Invalid patient id.' });

        const patient = await prisma.patient.findUnique({ where: { id: patientId }, select: { id: true } });
        if (!patient) return res.status(404).json({ status: 'error', message: 'Patient not found.' });

        const actorId = req.user.userId;
        const expiresAt = new Date(Date.now() + CLAIM_CODE_TTL_MS);

        let issued = null;
        for (let attempt = 0; attempt < 5 && !issued; attempt++) {
            // Same generator as caregiver invites: 8 uppercase hex characters.
            const candidate = crypto.randomBytes(4).toString('hex').toUpperCase();
            try {
                issued = await prisma.$transaction(async (tx) => {
                    // Same lock the claim uses, so "one active SELF per patient" cannot race a new code.
                    await lockPatientSelf(tx, patientId);

                    const activeSelf = await tx.patientaccountlink.findFirst({
                        where: { patient_id: patientId, relationship_type: 'SELF', consent_status: 'GRANTED', revoked_at: null },
                        select: { id: true }
                    });
                    if (activeSelf) throw new HttpError(409, 'This patient already has an account. A claim code is no longer needed.', 'SELF_LINK_EXISTS');

                    // Only the newest code may work: retire older unused claim codes of this patient.
                    await tx.caregiverinvite.updateMany({
                        where: { patient_id: patientId, invite_kind: 'PATIENT_CLAIM', is_used: false },
                        data: { is_used: true }
                    });
                    const invite = await tx.caregiverinvite.create({
                        data: { patient_id: patientId, code: candidate, invite_kind: 'PATIENT_CLAIM', expires_at: expiresAt, created_by: actorId }
                    });
                    await recordAudit(tx, {
                        actorId,
                        action: AUDIT_ACTIONS.PATIENT_CLAIM_CODE_CREATED,
                        targetResource: RESOURCES.INVITE,
                        targetId: invite.id,
                        patientId,
                        extra: { invite_id: invite.id, expires_at: expiresAt.toISOString() },   // never the code
                        req
                    });
                    return { code: candidate, expires_at: expiresAt };
                });
            } catch (err) {
                if (err.code !== 'P2002') throw err;   // only retry on a code collision
            }
        }
        if (!issued) throw new HttpError(500, 'Could not generate a unique claim code. Please try again.');

        return res.status(201).json({ status: 'success', data: issued });
    } catch (error) { next(error); }
};
