const prisma = require('../config/db');

exports.verifyPatientDataEventAccess = async (userId, patientId) => {
    const patientLink = await prisma.patientaccountlink.findFirst({ where: { user_id: userId, patient_id: patientId } });
    if (patientLink) return true;

    const caregiverLink = await prisma.patientcaregiverlink.findFirst({ where: { caregiver_user_id: userId, patient_id: patientId, consent_status: 'GRANTED' } });
    if (caregiverLink) return true;

    const staffLink = await prisma.staffassignment.findFirst({ where: { staff_user_id: userId, patient_id: patientId, status: 'ACTIVE' } });
    if (staffLink) return true;

    return false;
};

// Fixed for 2-Way Calling
exports.verifyCommunicationAccess = async (callerId, receiverId, patientId) => {
    try {
        const getRole = async (uid) => {
            if (await prisma.patientaccountlink.findFirst({ where: { user_id: uid, patient_id: patientId } })) return 'PATIENT';
            if (await prisma.patientcaregiverlink.findFirst({ where: { caregiver_user_id: uid, patient_id: patientId, consent_status: 'GRANTED' } })) return 'CAREGIVER';
            if (await prisma.staffassignment.findFirst({ where: { staff_user_id: uid, patient_id: patientId, status: 'ACTIVE' } })) return 'STAFF';
            return null;
        };

        const callerRole = await getRole(callerId);
        const receiverRole = await getRole(receiverId);

        // If both users belong to this patient's authorized network, allow the call
        return !!(callerRole && receiverRole);
    } catch (error) {
        console.error('Auth check error:', error);
        return false;
    }
};