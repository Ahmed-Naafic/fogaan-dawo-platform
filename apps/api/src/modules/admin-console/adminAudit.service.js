import { prisma } from '../../config/database.js';
import { describeRange, inRange } from '../finance/finance.dates.js';
import { resolveAdminRange } from './adminRange.js';

/**
 * Admin › Audit logs: platform-wide account, access, verification, scheduling, finance and settings events.
 * Clinical audit trails (prescriptions, medical documents, medical-history entries and access) are NOT
 * listed here — they stay in Admin › Medical records, which shows them as references only.
 * Old/new values pass through an allow-list: only keys known to carry no personal or clinical content.
 */

export const CLINICAL_AUDIT_ENTITIES = Object.freeze(['Prescription', 'MedicalDocument', 'MedicalHistoryEntry', 'PatientMedicalHistoryAccess', 'SecurityEvent']);

const SAFE_VALUE_KEYS = Object.freeze([
  // status changes
  'status', 'accountStatus', 'verificationStatus', 'activeRole', 'role', 'granted', 'reason', 'resubmission',
  // auth / sessions
  'method', 'scope', 'revoked', 'registration', 'provider', 'changed', 'otherSessionsRevoked', 'sessionsRevoked',
  // documents (metadata only)
  'documentType', 'versionNumber', 'mimeType', 'fileSize', 'bytes', 'width', 'height', 'replaced',
  // scheduling
  'timeZone', 'slotDurationMinutes', 'added', 'removed', 'slots', 'kind', 'startAt', 'endAt', 'keptBooked',
  // finance / settings
  'amount', 'outcome', 'simulated', 'reference', 'rate', 'value', 'consultationFee',
  // suspensions
  'cancelledAppointments', 'refundRequests',
  // booking policy (Admin › Settings)
  'paymentHoldMinutes', 'followUpDeadlineHours', 'maxFreeReschedules', 'freeRescheduleMinHours', 'fullRefundMinHours', 'partialRefundMinHours',
]);

/** Keys that hold an id: shown only as a short reference. */
const REF_KEYS = Object.freeze(['doctorId', 'patientId', 'appointmentId', 'paymentId', 'refundId', 'consultationId']);

const shortRef = (id) => (typeof id === 'string' ? id.slice(0, 8).toUpperCase() : null);

export function safeValues(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const out = {};
  for (const [k, value] of Object.entries(v)) {
    if (SAFE_VALUE_KEYS.includes(k) && (value === null || ['string', 'number', 'boolean'].includes(typeof value))) out[k] = value;
    else if (REF_KEYS.includes(k)) out[k] = shortRef(value);
  }
  return Object.keys(out).length ? out : null;
}

const actorRole = (actor) => {
  const roles = actor.roles.map((r) => r.role.name);
  return roles.includes('ADMIN') ? 'ADMIN' : actor.doctorProfile ? 'DOCTOR' : 'PATIENT';
};

/** GET /api/v1/admin/audit-logs?preset=&fromDate=&toDate=&tz=&action=&entityType=&actorUserId=&q=&page=&pageSize= */
export async function listAuditLogs(query = {}, client = prisma) {
  const range = resolveAdminRange(query, '7d');
  const where = {
    entityType: query.entityType && !CLINICAL_AUDIT_ENTITIES.includes(query.entityType) ? query.entityType : { notIn: CLINICAL_AUDIT_ENTITIES },
    ...(range.from ? { createdAt: inRange(range) } : {}),
    ...(query.action ? { action: query.action } : {}),
    ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
    ...(query.q ? { actor: { fullName: { contains: query.q, mode: 'insensitive' } } } : {}),
  };
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 25;
  const [total, rows, types] = await Promise.all([
    client.auditLog.count({ where }),
    client.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        oldValues: true,
        newValues: true,
        createdAt: true,
        actor: { select: { id: true, fullName: true, doctorProfile: { select: { id: true } }, roles: { select: { role: { select: { name: true } } } } } },
      },
    }),
    client.auditLog.groupBy({ by: ['entityType'], where: { entityType: { notIn: CLINICAL_AUDIT_ENTITIES } }, _count: { _all: true }, orderBy: { entityType: 'asc' } }),
  ]);
  return {
    range: describeRange(range),
    entityTypes: types.map((t) => t.entityType),
    items: rows.map((r) => ({
      id: r.id,
      at: r.createdAt.toISOString(),
      action: r.action,
      entityType: r.entityType,
      entityRef: r.entityId ? shortRef(r.entityId) : null,
      actor: r.actor ? { userId: r.actor.id, name: r.actor.fullName, role: actorRole(r.actor) } : null,
      oldValues: safeValues(r.oldValues),
      newValues: safeValues(r.newValues),
    })),
    total,
    page,
    pageSize,
  };
}
