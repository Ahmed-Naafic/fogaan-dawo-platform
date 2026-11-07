export const createAuditLog = (client, { actorUserId = null, action, entityType, entityId, oldValues, newValues }) =>
  client.auditLog.create({ data: { actorUserId, action, entityType, entityId, oldValues, newValues } });

export const findAuditLogs = (client, { entityType, entityIds, action }) =>
  client.auditLog.findMany({ where: { entityType, entityId: { in: entityIds }, action }, orderBy: { createdAt: 'desc' } });
