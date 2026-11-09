/** Data access: create audit log (auditLog.create: inserts a row). `client` is the Prisma client or a transaction. */
export const createAuditLog = (client, { actorUserId = null, action, entityType, entityId, oldValues, newValues }) =>
  client.auditLog.create({ data: { actorUserId, action, entityType, entityId, oldValues, newValues } });

/** Data access: find audit logs (auditLog.findMany: matching rows). `client` is the Prisma client or a transaction. */
export const findAuditLogs = (client, { entityType, entityIds, action }) =>
  client.auditLog.findMany({ where: { entityType, entityId: { in: entityIds }, action }, orderBy: { createdAt: 'desc' } });
