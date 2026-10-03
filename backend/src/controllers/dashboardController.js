const prisma = require('../config/db');

exports.getDashboardOverview = async (req, res, next) => {
    try {
        const { patient_id } = req.params;
        
        // The rbacMiddleware already validated access and attached the specific link
        const accessLink = req.accessContext.link;

        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        
        const endOfDay = new Date();
        endOfDay.setHours(23, 59, 59, 999);

        // Execute all database queries simultaneously for maximum performance
        const [patient, todayEvents, todayCheckIn, recentDocuments] = await Promise.all([
            // 1. Patient Profile & Clinical Summary
            prisma.patient.findUnique({
                where: { id: patient_id },
                select: {
                    full_name: true,
                    date_of_birth: true,
                    preferred_language: true,
                    cancer_type: true,
                    cancer_stage: true,
                    diagnosis_date: true
                }
            }),

            // 2. Today's Care Tasks (Medicines, Appointments, Custom Tasks)
            prisma.careevent.findMany({
                where: {
                    patient_id: patient_id,
                    schedule_time: { gte: startOfDay, lte: endOfDay }
                },
                include: {
                    patientmedication: {
                        select: { name: true, strength: true, form: true }
                    }
                },
                orderBy: { schedule_time: 'asc' }
            }),

            // 3. Today's Wellbeing Check-in Status
            prisma.symptomevent.findFirst({
                where: {
                    patient_id: patient_id,
                    recorded_at: { gte: startOfDay, lte: endOfDay },
                    source: 'ROUTINE'
                },
                orderBy: { recorded_at: 'desc' }
            }),

            // 4. Recent Medical Documents (Limit to 3 for the dashboard widget)
            prisma.medicaldocument.findMany({
                where: { patient_id: patient_id },
                orderBy: { uploaded_at: 'desc' },
                take: 3,
                select: {
                    id: true,
                    title: true,
                    document_type: true,
                    uploaded_at: true
                }
            })
        ]);

        // Construct the exact JSON payload the Flutter UI needs
        return res.status(200).json({
            status: 'success',
            data: {
                relationship: accessLink.relationship_label || 'Staff',
                access_scopes: accessLink.access_scopes || ['ALL'],
                profile: patient,
                care_tasks: {
                    total_today: todayEvents.length,
                    completed_today: todayEvents.filter(e => e.completion_status === 'COMPLETED').length,
                    events: todayEvents
                },
                wellbeing: {
                    check_in_completed: !!todayCheckIn,
                    last_record: todayCheckIn || null
                },
                documents: recentDocuments
            }
        });
    } catch (error) {
        next(error);
    }
};