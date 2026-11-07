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

export const findAuthUserById = (client, id) => client.user.findUnique({ where: { id }, select: AUTH_USER_SELECT });

/** Login lookup: the only query that reads password_hash. */
export const findUserForLogin = (client, where) =>
  client.user.findUnique({ where, select: { ...AUTH_USER_SELECT, passwordHash: true } });

export const findUserIdByEmail = (client, email) => client.user.findUnique({ where: { email }, select: { id: true } });

export const findUserIdByPhone = (client, phone) => client.user.findUnique({ where: { phone }, select: { id: true } });

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

export const addUserRole = (client, { userId, roleId }) => client.userRole.create({ data: { userId, roleId } });

/** Removes one role assignment (no-op if absent). Returns { count }. */
export const removeUserRole = (client, { userId, roleId }) => client.userRole.deleteMany({ where: { userId, roleId } });

export const setLastLogin = (client, userId, at) => client.user.update({ where: { id: userId }, data: { lastLoginAt: at }, select: { id: true } });

export const createSession = (client, data) => client.session.create({ data });

export const findSessionById = (client, id) => client.session.findUnique({ where: { id } });

/** Session plus its user's authorization data, for per-request checks (one round trip). */
export const findSessionWithUser = (client, id) =>
  client.session.findUnique({ where: { id }, include: { user: { select: AUTH_USER_SELECT } } });

export const updateSession = (client, id, data) => client.session.update({ where: { id }, data });

/* ------------------------------------------------- external identities (Google) */

export const findIdentityBySubject = (client, provider, providerSubject) =>
  client.userIdentity.findUnique({ where: { provider_providerSubject: { provider, providerSubject } } });

export const findIdentityForUser = (client, userId, provider) =>
  client.userIdentity.findUnique({ where: { userId_provider: { userId, provider } } });

export const createIdentity = (client, data) => client.userIdentity.create({ data });

export const touchIdentity = (client, id, at) => client.userIdentity.update({ where: { id }, data: { lastUsedAt: at }, select: { id: true } });

export const deleteIdentity = (client, id) => client.userIdentity.delete({ where: { id } });

/** Sign-in methods of a user: whether a password exists (never the hash itself) and linked identities. */
export async function findSignInMethods(client, userId) {
  const user = await client.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true, identities: { select: { id: true, provider: true, emailAtLink: true, createdAt: true, lastUsedAt: true } } },
  });
  return user ? { hasPassword: Boolean(user.passwordHash), identities: user.identities } : null;
}

export const revokeActiveSessionsForUser = (client, userId, at) =>
  client.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: at } });

/** Revokes every live session of the user except `keepSessionId` (password change). */
export const revokeOtherSessions = (client, userId, keepSessionId, at) =>
  client.session.updateMany({ where: { userId, revokedAt: null, id: { not: keepSessionId } }, data: { revokedAt: at } });

/** The only write of password_hash outside registration. */
export const updatePasswordHash = (client, userId, passwordHash) =>
  client.user.update({ where: { id: userId }, data: { passwordHash }, select: { id: true } });
