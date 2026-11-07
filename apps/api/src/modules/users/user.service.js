import { ApiError } from '../../utils/ApiError.js';
import { withTransaction } from '../../utils/transaction.js';
import * as auditRepository from '../audit/audit.repository.js';
import * as authRepository from '../auth/auth.repository.js';
import { rolesOf } from '../auth/auth.service.js';

/**
 * Grants a role to an existing user. Route-level RBAC already requires an authenticated ADMIN with the
 * roles:assign permission; the grant is audited with the acting administrator.
 */
export async function assignRole({ actorUserId, userId, role }) {
  return withTransaction(async (tx) => {
    const user = await authRepository.findAuthUserById(tx, userId);
    if (!user) throw ApiError.notFound('User not found');
    if (rolesOf(user).includes(role)) throw ApiError.conflict(`User already has the ${role} role`, undefined, 'ROLE_ALREADY_ASSIGNED');
    const roleRow = await authRepository.findRoleByName(tx, role);
    await authRepository.addUserRole(tx, { userId, roleId: roleRow.id });
    await auditRepository.createAuditLog(tx, { actorUserId, action: 'UPDATE', entityType: 'UserRole', entityId: userId, newValues: { granted: role } });
    return { userId, roles: [...rolesOf(user), role] };
  });
}
