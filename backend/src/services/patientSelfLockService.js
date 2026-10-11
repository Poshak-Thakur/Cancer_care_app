/**
 * Shared PostgreSQL advisory-lock helpers for SELF-profile / claim-code operations.
 *
 * Every function takes the CALLER'S transaction client (`tx`) and uses pg_advisory_xact_lock, so the
 * lock is released automatically at COMMIT / ROLLBACK. Locks only serialise the application workflow;
 * the partial unique indexes (prisma/migrations_pending) protect the same invariants in the database.
 *
 * Lock order (to avoid deadlocks): USER lock first, PATIENT lock second.
 * The patient key MUST stay 'patient_self:<id>' in every controller, or the operations stop
 * serialising with each other.
 */
const USER_NAMESPACE = 'patient_self_user:';
const PATIENT_NAMESPACE = 'patient_self:';

const lockKey = (tx, key) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;

/** Serialises everything that creates / claims / rate-limits a SELF profile for ONE account. */
exports.lockUserSelf = (tx, userId) => lockKey(tx, USER_NAMESPACE + userId);

/** Serialises claims and claim-code creation for ONE patient record. */
exports.lockPatientSelf = (tx, patientId) => lockKey(tx, PATIENT_NAMESPACE + patientId);

exports.USER_NAMESPACE = USER_NAMESPACE;
exports.PATIENT_NAMESPACE = PATIENT_NAMESPACE;
