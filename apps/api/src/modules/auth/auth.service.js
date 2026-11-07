import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { getAuthConfig } from '../../config/auth.js';
import { prisma } from '../../config/database.js';
import { ApiError } from '../../utils/ApiError.js';
import { burnPasswordCheck, hashPassword, verifyPassword } from '../../utils/password.js';
import { lockRow, withTransaction } from '../../utils/transaction.js';
import * as auditRepository from '../audit/audit.repository.js';
import { AuthErrorCode, ROLE_PRECEDENCE } from './auth.constants.js';
import { permissionsFor } from './auth.permissions.js';
import * as authRepository from './auth.repository.js';
import { generateRefreshToken, hashToken, parseRefreshToken, signAccessToken, tokenMatchesHash } from './auth.tokens.js';

/* ------------------------------------------------------------------ helpers */

export const rolesOf = (user) => user.roles.map((r) => r.role.name).sort((a, b) => ROLE_PRECEDENCE.indexOf(a) - ROLE_PRECEDENCE.indexOf(b));

/** Why `role` can't be used right now (null = usable). A suspended/disabled doctor loses DOCTOR. */
export function roleUnavailableReason(user, role) {
  if (!rolesOf(user).includes(role)) return AuthErrorCode.roleNotAssigned;
  if (role === 'DOCTOR' && user.doctorProfile?.accountStatus !== 'ACTIVE') return AuthErrorCode.roleUnavailable;
  if (role === 'PATIENT' && !user.patientProfile) return AuthErrorCode.roleUnavailable;
  return null;
}

const usableRoles = (user) => rolesOf(user).filter((r) => roleUnavailableReason(user, r) === null);

const STATUS_ERRORS = Object.freeze({
  SUSPENDED: [AuthErrorCode.accountSuspended, 'This account is suspended'],
  DISABLED: [AuthErrorCode.accountDisabled, 'This account is disabled'],
  PENDING_VERIFICATION: [AuthErrorCode.accountNotActive, 'This account is not active yet'],
});

/** Only ACTIVE accounts may authenticate or use protected functionality. */
export function assertAccountActive(user) {
  if (user.status === 'ACTIVE') return;
  const [code, message] = STATUS_ERRORS[user.status] ?? [AuthErrorCode.accountNotActive, 'This account is not active'];
  throw ApiError.forbidden(message, undefined, code);
}

function roleError(reason, role) {
  return reason === AuthErrorCode.roleNotAssigned
    ? ApiError.forbidden(`The ${role} role is not assigned to this account`, undefined, reason)
    : ApiError.forbidden(`The ${role} role is not available for this account`, undefined, reason);
}

export function chooseActiveRole(user, requested) {
  if (requested) {
    const reason = roleUnavailableReason(user, requested);
    if (reason) throw roleError(reason, requested);
    return requested;
  }
  const role = usableRoles(user)[0];
  if (!role) throw ApiError.forbidden('This account has no role that can be used', undefined, AuthErrorCode.noUsableRole);
  return role;
}

export const publicUser = (user) => ({
  id: user.id,
  fullName: user.fullName,
  email: user.email,
  phone: user.phone,
  status: user.status,
  preferredLanguage: user.preferredLanguage,
  timeZone: user.timeZone,
  emailVerifiedAt: user.emailVerifiedAt,
  phoneVerifiedAt: user.phoneVerifiedAt,
  lastLoginAt: user.lastLoginAt,
  createdAt: user.createdAt,
  // Version of the own profile photo (GET /api/v1/me/photo); null when there is none.
  photoUpdatedAt: user.avatarUpdatedAt ?? null,
});

const profilesOf = (user) => ({
  patient: user.patientProfile ? { id: user.patientProfile.id } : null,
  doctor: user.doctorProfile
    ? { id: user.doctorProfile.id, accountStatus: user.doctorProfile.accountStatus, verificationStatus: user.doctorProfile.verificationStatus }
    : null,
});

const sessionMeta = ({ userAgent, ipAddress }) => ({
  userAgent: userAgent ? String(userAgent).slice(0, 500) : null,
  ipAddress: ipAddress ? String(ipAddress).slice(0, 64) : null,
});

export async function startSession(tx, user, role, meta, now) {
  const id = randomUUID();
  const refreshToken = generateRefreshToken(id, role);
  const expiresAt = new Date(now.getTime() + getAuthConfig().refreshTokenTtlDays * 86_400_000);
  await authRepository.createSession(tx, { id, userId: user.id, refreshTokenHash: hashToken(refreshToken), expiresAt, ...sessionMeta(meta) });
  return { sessionId: id, refreshToken, expiresAt };
}

/** The response body shared by register/login/refresh/switch-role (refresh token delivered separately). */
export async function buildAuthResult(user, activeRole, session) {
  const access = await signAccessToken({ userId: user.id, sessionId: session.sessionId, role: activeRole });
  return {
    accessToken: access.token,
    tokenType: 'Bearer',
    expiresIn: access.expiresIn,
    user: publicUser(user),
    roles: rolesOf(user),
    activeRole,
    profiles: profilesOf(user),
    session: { id: session.sessionId, expiresAt: session.expiresAt },
    refreshToken: session.refreshToken,
  };
}

function uniqueViolationTarget(error) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return null;
  const target = [].concat(error.meta?.target ?? []).join(',');
  if (target.includes('email')) return 'email';
  if (target.includes('phone')) return 'phone';
  return 'other';
}

const takenError = (field) =>
  field === 'email'
    ? ApiError.conflict('An account with this email address already exists', { field: 'email' }, AuthErrorCode.emailTaken)
    : ApiError.conflict('An account with this phone number already exists', { field: 'phone' }, AuthErrorCode.phoneTaken);

/* ---------------------------------------------------------------- use cases */

/** Public registration creates PATIENT accounts only (doctors register in the doctor module; admins are granted). */
export async function register(input, meta, now = new Date()) {
  const passwordHash = await hashPassword(input.password); // hash outside the transaction (bcrypt is slow)
  try {
    const { user, session } = await withTransaction(async (tx) => {
      if (input.email && (await authRepository.findUserIdByEmail(tx, input.email))) throw takenError('email');
      if (input.phone && (await authRepository.findUserIdByPhone(tx, input.phone))) throw takenError('phone');
      const patientRole = await authRepository.findRoleByName(tx, 'PATIENT');
      if (!patientRole) throw new ApiError(500, 'PATIENT role is not seeded');

      const created = await authRepository.createPatientAccount(tx, {
        fullName: input.fullName,
        email: input.email,
        phone: input.phone,
        passwordHash,
        preferredLanguage: input.preferredLanguage,
        patientRoleId: patientRole.id,
      });
      const started = await startSession(tx, created, 'PATIENT', meta, now);
      await authRepository.setLastLogin(tx, created.id, now);
      await auditRepository.createAuditLog(tx, { actorUserId: created.id, action: 'CREATE', entityType: 'User', entityId: created.id, newValues: { registration: 'PATIENT' } });
      return { user: { ...created, lastLoginAt: now }, session: started };
    });
    return buildAuthResult(user, 'PATIENT', session);
  } catch (error) {
    const field = uniqueViolationTarget(error);
    if (field === 'email' || field === 'phone') throw takenError(field);
    throw error;
  }
}

/** Email or phone + password. Wrong identifier and wrong password produce the same error and timing. */
export async function login({ email, phone, password, role }, meta, now = new Date()) {
  const user = await authRepository.findUserForLogin(prisma, email ? { email } : { phone });
  // No account, or a Google-only account without a password: same error and timing as a wrong password.
  if (!user?.passwordHash) {
    await burnPasswordCheck(password);
    throw ApiError.unauthorized('Invalid credentials', AuthErrorCode.invalidCredentials);
  }
  if (!(await verifyPassword(password, user.passwordHash))) throw ApiError.unauthorized('Invalid credentials', AuthErrorCode.invalidCredentials);

  assertAccountActive(user);
  const activeRole = chooseActiveRole(user, role);
  const session = await withTransaction(async (tx) => {
    const started = await startSession(tx, user, activeRole, meta, now);
    await authRepository.setLastLogin(tx, user.id, now);
    await auditRepository.createAuditLog(tx, { actorUserId: user.id, action: 'LOGIN', entityType: 'Session', entityId: started.sessionId, newValues: { activeRole } });
    return started;
  });
  const { passwordHash: _omit, ...safeUser } = user;
  return buildAuthResult({ ...safeUser, lastLoginAt: now }, activeRole, session);
}

/**
 * Rotates a refresh token. Outcomes that must persist even though the request fails (revoking a
 * session on reuse, expiry or account suspension) are committed first, then the error is thrown.
 */
export async function refresh(refreshToken, meta, now = new Date()) {
  const parsed = parseRefreshToken(refreshToken);
  if (!parsed) throw ApiError.unauthorized('Invalid refresh token', AuthErrorCode.refreshInvalid);

  const outcome = await withTransaction(async (tx) => {
    if (!(await lockRow(tx, 'sessions', parsed.sessionId))) return { error: ApiError.unauthorized('Invalid refresh token', AuthErrorCode.refreshInvalid) };
    const session = await authRepository.findSessionById(tx, parsed.sessionId);
    const matches = tokenMatchesHash(refreshToken, session.refreshTokenHash);

    if (session.revokedAt) {
      if (!matches) {
        await auditRepository.createAuditLog(tx, { actorUserId: session.userId, action: 'OTHER', entityType: 'Session', entityId: session.id, newValues: { event: 'revoked_refresh_token_reused' } });
      }
      return { error: ApiError.unauthorized('This session has been revoked', matches ? AuthErrorCode.sessionRevoked : AuthErrorCode.refreshReused) };
    }
    if (!matches) {
      // An older, already-rotated token of a live session: assume theft and revoke the whole session.
      await authRepository.updateSession(tx, session.id, { revokedAt: now });
      await auditRepository.createAuditLog(tx, { actorUserId: session.userId, action: 'OTHER', entityType: 'Session', entityId: session.id, newValues: { event: 'refresh_token_reuse_detected', sessionRevoked: true } });
      return { error: ApiError.unauthorized('Refresh token reuse detected; the session has been revoked', AuthErrorCode.refreshReused) };
    }
    if (session.expiresAt <= now) {
      await authRepository.updateSession(tx, session.id, { revokedAt: now });
      return { error: ApiError.unauthorized('Session has expired', AuthErrorCode.sessionExpired) };
    }

    const user = await authRepository.findAuthUserById(tx, session.userId);
    try {
      assertAccountActive(user);
    } catch (error) {
      await authRepository.updateSession(tx, session.id, { revokedAt: now });
      return { error };
    }
    // Keep the session's role if still usable; otherwise fall back to the least-privileged usable role.
    let activeRole = parsed.role;
    if (roleUnavailableReason(user, activeRole)) {
      activeRole = usableRoles(user)[0];
      if (!activeRole) {
        await authRepository.updateSession(tx, session.id, { revokedAt: now });
        return { error: ApiError.forbidden('This account has no role that can be used', undefined, AuthErrorCode.noUsableRole) };
      }
    }

    const rotated = generateRefreshToken(session.id, activeRole);
    await authRepository.updateSession(tx, session.id, { refreshTokenHash: hashToken(rotated), ...sessionMeta(meta) });
    return { user, activeRole, session: { sessionId: session.id, refreshToken: rotated, expiresAt: session.expiresAt } };
  });

  if (outcome.error) throw outcome.error;
  return buildAuthResult(outcome.user, outcome.activeRole, outcome.session);
}

/** Revokes one session, identified by the access token's session id or by a valid refresh token. Idempotent. */
export async function logout({ sessionId = null, refreshToken = null, actorUserId = null }, now = new Date()) {
  let id = sessionId;
  if (!id && refreshToken) {
    const parsed = parseRefreshToken(refreshToken);
    if (!parsed) return;
    id = parsed.sessionId;
  }
  if (!id) return;
  await withTransaction(async (tx) => {
    if (!(await lockRow(tx, 'sessions', id))) return;
    const session = await authRepository.findSessionById(tx, id);
    if (session.revokedAt) return;
    // Without an access token, only the holder of the *current* refresh token may end the session.
    if (!sessionId && !tokenMatchesHash(refreshToken, session.refreshTokenHash)) return;
    await authRepository.updateSession(tx, id, { revokedAt: now });
    await auditRepository.createAuditLog(tx, { actorUserId: actorUserId ?? session.userId, action: 'LOGOUT', entityType: 'Session', entityId: id });
  });
}

export async function logoutAll(userId, now = new Date()) {
  return withTransaction(async (tx) => {
    const { count } = await authRepository.revokeActiveSessionsForUser(tx, userId, now);
    await auditRepository.createAuditLog(tx, { actorUserId: userId, action: 'LOGOUT', entityType: 'User', entityId: userId, newValues: { scope: 'all_sessions', revoked: count } });
    return count;
  });
}

/** Switches the session's active role to another role already assigned to the user. Never grants roles. */
export async function switchRole(auth, role, meta) {
  const reason = roleUnavailableReason(auth.user, role);
  if (reason) throw roleError(reason, role);

  const session = await withTransaction(async (tx) => {
    if (!(await lockRow(tx, 'sessions', auth.sessionId))) throw ApiError.unauthorized('Session not found', AuthErrorCode.sessionRevoked);
    const current = await authRepository.findSessionById(tx, auth.sessionId);
    if (current.revokedAt) throw ApiError.unauthorized('This session has been revoked', AuthErrorCode.sessionRevoked);
    const rotated = generateRefreshToken(current.id, role);
    await authRepository.updateSession(tx, current.id, { refreshTokenHash: hashToken(rotated), ...sessionMeta(meta) });
    await auditRepository.createAuditLog(tx, { actorUserId: auth.user.id, action: 'UPDATE', entityType: 'Session', entityId: current.id, oldValues: { activeRole: auth.activeRole }, newValues: { activeRole: role } });
    return { sessionId: current.id, refreshToken: rotated, expiresAt: current.expiresAt };
  });
  return buildAuthResult(auth.user, role, session);
}

/**
 * Per-request authorization context from verified JWT claims. Re-checks the database every time:
 * session live, account ACTIVE, and the active role still assigned and usable.
 */
export async function resolveAuthContext(client, claims, now = new Date()) {
  const session = await authRepository.findSessionWithUser(client, claims.sessionId);
  if (!session || session.userId !== claims.userId) throw ApiError.unauthorized('Invalid access token', AuthErrorCode.tokenInvalid);
  if (session.revokedAt) throw ApiError.unauthorized('This session has been revoked', AuthErrorCode.sessionRevoked);
  if (session.expiresAt <= now) throw ApiError.unauthorized('Session has expired', AuthErrorCode.sessionExpired);

  const { user } = session;
  assertAccountActive(user);
  const reason = roleUnavailableReason(user, claims.role);
  if (reason) throw roleError(reason, claims.role);

  return { user, sessionId: session.id, sessionExpiresAt: session.expiresAt, activeRole: claims.role, roles: rolesOf(user), permissions: permissionsFor(claims.role) };
}

export function getMe(auth) {
  return {
    user: publicUser(auth.user),
    roles: auth.roles,
    activeRole: auth.activeRole,
    permissions: auth.permissions,
    profiles: profilesOf(auth.user),
    session: { id: auth.sessionId, expiresAt: auth.sessionExpiresAt },
  };
}

/**
 * Changes the signed-in user's password. Requires the current password (re-authentication), so a
 * stolen access token alone cannot take over the account. Accounts without a password (Google-only)
 * cannot set one here: there is no safe identity confirmation for that yet.
 * In one transaction (user row locked): verify, store the new bcrypt hash, revoke every OTHER session
 * (their refresh tokens stop working at once), audit. The current session stays signed in; its refresh
 * token keeps rotating as before. Passwords are never logged or audited.
 */
export async function changePassword(auth, { currentPassword, newPassword }, now = new Date()) {
  const newHash = await hashPassword(newPassword);
  return withTransaction(async (tx) => {
    await lockRow(tx, 'users', auth.user.id);
    const user = await authRepository.findUserForLogin(tx, { id: auth.user.id });
    if (!user?.passwordHash) {
      throw ApiError.conflict('This account signs in with Google only and has no password to change', undefined, AuthErrorCode.passwordNotSet);
    }
    if (!(await verifyPassword(currentPassword, user.passwordHash))) {
      throw ApiError.badRequest('Your current password is incorrect', [{ path: 'currentPassword', message: 'Incorrect password' }], AuthErrorCode.currentPasswordInvalid);
    }
    await authRepository.updatePasswordHash(tx, user.id, newHash);
    const { count } = await authRepository.revokeOtherSessions(tx, user.id, auth.sessionId, now);
    await auditRepository.createAuditLog(tx, { actorUserId: user.id, action: 'UPDATE', entityType: 'UserPassword', entityId: user.id, newValues: { changed: true, otherSessionsRevoked: count } });
    return { otherSessionsRevoked: count };
  }, { timeout: 30_000 });
}
