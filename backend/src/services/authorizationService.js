const prisma = require('../config/db');

exports.isCentralCounsellor = async (userId) => {
    const profile = await prisma.staffprofile.findFirst({ where: { user_id: userId, is_active: true } });
    return !!profile;
};

exports.verifyPatientDataEventAccess = async (userId, patientId) => {
    if (!userId || !patientId) return false;
    
    if (await exports.isCentralCounsellor(userId)) return true;

    const isPatient = await prisma.patientaccountlink.findFirst({
        where: { user_id: userId, patient_id: patientId, relationship_type: { in: ['SELF', 'DELEGATE'] } }
    });
    if (isPatient) return true;

    const isCaregiver = await prisma.patientcaregiverlink.findFirst({
        where: { caregiver_user_id: userId, patient_id: patientId, consent_status: 'GRANTED' }
    });
    if (isCaregiver) return true;

    const isAssignedStaff = await prisma.staffassignment.findFirst({
        where: { staff_user_id: userId, patient_id: patientId, status: 'ACTIVE' }
    });
    return !!isAssignedStaff;
};

exports.verifyCommunicationAccess = async (userA, userB, patientId) => {
    if (!userA || !userB || userA === userB || !patientId) return false;

    const hasAccessA = await exports.verifyPatientDataEventAccess(userA, patientId);
    const hasAccessB = await exports.verifyPatientDataEventAccess(userB, patientId);

    return hasAccessA && hasAccessB;
};