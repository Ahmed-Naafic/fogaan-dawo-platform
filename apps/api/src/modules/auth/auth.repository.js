/** Data access for authentication: users, roles, profiles and sessions. */

/** Everything authorization needs about a user, in one query. Never selects password_hash. */
const AUTH_USER_SELECT = Object.freeze({
  id: true,
  email: true,
  phone: true,
  fullName: true,
  status: true,
  preferredLanguage: true,
  timeZone: true,
  emailVerifiedAt: true,
  phoneVerifiedAt: true,
  lastLoginAt: true,
  createdAt: true,
  avatarUpdatedAt: true, // whether a profile photo exists (never the storage key)
  roles: { select: { role: { select: { name: true } } } },
  patientProfile: { select: { id: true } },
  doctorProfile: { select: { id: true, accountStatus: true, verificationStatus: true } },
});

/** Data access: find auth user by id (user.findUnique: one row by unique key). `client` is the Prisma client or a transaction. */
export const findAuthUserById = (client, id) => client.user.findUnique({ where: { id }, select: AUTH_USER_SELECT });

/** Login lookup: the only query that reads password_hash. */
export const findUserForLogin = (client, where) =>
  client.user.findUnique({ where, select: { ...AUTH_USER_SELECT, passwordHash: true } });

/** Data access: find user id by email (user.findUnique: one row by unique key). `client` is the Prisma client or a transaction. */
export const findUserIdByEmail = (client, email) => client.user.findUnique({ where: { email }, select: { id: true } });

/** Data access: find user id by phone (user.findUnique: one row by unique key). `client` is the Prisma client or a transaction. */
export const findUserIdByPhone = (client, phone) => client.user.findUnique({ where: { phone }, select: { id: true } });

/** Data access: find role by name (role.findUnique: one row by unique key). `client` is the Prisma client or a transaction. */
export const findRoleByName = (client, name) => client.role.findUnique({ where: { name } });

/** Creates a patient account: user + PATIENT role + patient profile (caller provides the transaction). */
export const createPatientAccount = (client, { fullName, email, phone, passwordHash, preferredLanguage, patientRoleId, emailVerifiedAt }) =>
  client.user.create({
    data: {
      fullName,
      email: email ?? null,
      phone: phone ?? null,
      passwordHash: passwordHash ?? null, // null: Google-only account (no password sign-in)
      ...(emailVerifiedAt ? { emailVerifiedAt } : {}),
      ...(preferredLanguage ? { preferredLanguage } : {}),
      roles: { create: [{ roleId: patientRoleId }] },
      patientProfile: { create: {} },
    },
    select: AUTH_USER_SELECT,
  });

/** Data access: add user role (userRole.create: inserts a row). `client` is the Prisma client or a transaction. */
export const addUserRole = (client, { userId, roleId }) => client.userRole.create({ data: { userId, roleId } });

/** Removes one role assignment (no-op if absent). Returns { count }. */
export const removeUserRole = (client, { userId, roleId }) => client.userRole.deleteMany({ where: { userId, roleId } });

/** Data access: set last login (user.update: updates a row). `client` is the Prisma client or a transaction. */
export const setLastLogin = (client, userId, at) => client.user.update({ where: { id: userId }, data: { lastLoginAt: at }, select: { id: true } });

/** Data access: create session (session.create: inserts a row). `client` is the Prisma client or a transaction. */
export const createSession = (client, data) => client.session.create({ data });

/** Data access: find session by id (session.findUnique: one row by unique key). `client` is the Prisma client or a transaction. */
export const findSessionById = (client, id) => client.session.findUnique({ where: { id } });

/** Session plus its user's authorization data, for per-request checks (one round trip). */
export const findSessionWithUser = (client, id) =>
  client.session.findUnique({ where: { id }, include: { user: { select: AUTH_USER_SELECT } } });

/** Data access: update session (session.update: updates a row). `client` is the Prisma client or a transaction. */
export const updateSession = (client, id, data) => client.session.update({ where: { id }, data });

/* ------------------------------------------------- external identities (Google) */

/** Data access: find identity by subject (userIdentity.findUnique: one row by unique key). `client` is the Prisma client or a transaction. */
export const findIdentityBySubject = (client, provider, providerSubject) =>
  client.userIdentity.findUnique({ where: { provider_providerSubject: { provider, providerSubject } } });

/** Data access: find identity for user (userIdentity.findUnique: one row by unique key). `client` is the Prisma client or a transaction. */
export const findIdentityForUser = (client, userId, provider) =>
  client.userIdentity.findUnique({ where: { userId_provider: { userId, provider } } });

/** Data access: create identity (userIdentity.create: inserts a row). `client` is the Prisma client or a transaction. */
export const createIdentity = (client, data) => client.userIdentity.create({ data });

/** Data access: touch identity (userIdentity.update: updates a row). `client` is the Prisma client or a transaction. */
export const touchIdentity = (client, id, at) => client.userIdentity.update({ where: { id }, data: { lastUsedAt: at }, select: { id: true } });

/** Data access: delete identity (userIdentity.delete: deletes a row). `client` is the Prisma client or a transaction. */
export const deleteIdentity = (client, id) => client.userIdentity.delete({ where: { id } });

/** Sign-in methods of a user: whether a password exists (never the hash itself) and linked identities. */
export async function findSignInMethods(client, userId) {
  const user = await client.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true, identities: { select: { id: true, provider: true, emailAtLink: true, createdAt: true, lastUsedAt: true } } },
  });
  return user ? { hasPassword: Boolean(user.passwordHash), identities: user.identities } : null;
}

/** Data access: revoke active sessions for user (session.updateMany: updates matching rows). `client` is the Prisma client or a transaction. */
export const revokeActiveSessionsForUser = (client, userId, at) =>
  client.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: at } });

/** Revokes every live session of the user except `keepSessionId` (password change). */
export const revokeOtherSessions = (client, userId, keepSessionId, at) =>
  client.session.updateMany({ where: { userId, revokedAt: null, id: { not: keepSessionId } }, data: { revokedAt: at } });

/** The only write of password_hash outside registration. */
export const updatePasswordHash = (client, userId, passwordHash) =>
  client.user.update({ where: { id: userId }, data: { passwordHash }, select: { id: true } });
