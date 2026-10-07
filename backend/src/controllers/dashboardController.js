const prisma = require('../config/db');
const { getISTDayBoundaries } = require('../utils/timezoneHelper');
const { getPatientAccessContext } = require('../services/authorizationService');

exports.getDashboardOverview = async (req, res, next) => {
    try {
        const { patient_id } = req.params;

        // requirePatientAccess() normally fills req.accessContext. Resolve it here too (defence in
        // depth) so the central NGO head/counsellor can ALWAYS read any dashboard without a
        // staffassignment row, and nobody else can slip through if the route guard is ever removed.
        let accessContext = req.accessContext;
        if (!accessContext) {
            accessContext = await getPatientAccessContext(req.user.userId, patient_id);
            if (!accessContext) {
                return res.status(403).json({ status: 'error', message: 'Unauthorized access to this patient record.' });
            }
        }

        const patient = await prisma.patient.findUnique({
            where: { id: patient_id },
            select: { full_name: true, date_of_birth: true, preferred_language: true, cancer_type: true, cancer_stage: true, diagnosis_date: true }
        });
        if (!patient) return res.status(404).json({ status: 'error', message: 'Patient not found' });

        const role = accessContext.role;
        const link = accessContext.link;
        const accessScopes = link?.access_scopes || ['ALL'];
        const relationship = link?.relationship_label || link?.relationship_type || role;

        // NEW: Fetch from IST midnight to IST midnight
        const { startOfDay, endOfDay } = getISTDayBoundaries();

        const [careEvents, todayCheckIn, alerts, recentDocuments] = await Promise.all([
            prisma.careevent.findMany({
                where: { patient_id: patient_id, schedule_time: { gte: startOfDay, lte: endOfDay } },
                include: { patientmedication: { select: { name: true, strength: true, form: true } } },
                orderBy: { schedule_time: 'asc' }
            }),
            prisma.symptomevent.findFirst({
                where: { patient_id: patient_id, recorded_at: { gte: startOfDay, lte: endOfDay }, source: 'ROUTINE' },
                orderBy: { recorded_at: 'desc' },
                include: { symptomobservation: true } 
            }),
            prisma.alert.findMany({
                where: { patient_id: patient_id, status: { in: ['OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS'] } },
                orderBy: { created_at: 'desc' },
                take: 5
            }),
            prisma.medicaldocument.findMany({
                where: { patient_id: patient_id },
                orderBy: { uploaded_at: 'desc' },
                take: 3,
                select: { id: true, title: true, document_type: true, uploaded_at: true, verification_status: true }
            })
        ]);

        return res.status(200).json({
            status: 'success',
            data: {
                relationship,
                access_scopes: accessScopes,
                profile: patient,
                care_tasks: {
                    total_today: careEvents.length,
                    completed_today: careEvents.filter(e => e.completion_status === 'COMPLETED').length,
                    events: careEvents
                },
                wellbeing: {
                    check_in_completed: !!todayCheckIn,
                    last_record: todayCheckIn || null
                },
                documents: recentDocuments,
                active_alerts: alerts
            }
        });
    } catch (error) {
        next(error);
    }
};
