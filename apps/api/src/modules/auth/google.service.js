import { Prisma } from '@prisma/client';
import { getGoogleConfig } from '../../config/google.js';
import { prisma } from '../../config/database.js';
import { buildAuthorizationUrl, exchangeCode, GoogleOidcError, verifyIdToken } from '../../adapters/oauth/googleOidc.js';
import { ApiError } from '../../utils/ApiError.js';
import { lockRow, withTransaction } from '../../utils/transaction.js';
import * as auditRepository from '../audit/audit.repository.js';
import { AuthErrorCode } from './auth.constants.js';
import * as authRepository from './auth.repository.js';
import { assertAccountActive, buildAuthResult, chooseActiveRole, rolesOf, startSession } from './auth.service.js';
import { codeChallengeFor, consumeState, newOAuthTransaction, openOAuthTransaction, sealOAuthTransaction, statesMatch } from './oauth.state.js';

/**
 * Google sign-in (OpenID Connect).
 *
 * Rules:
 * - Identity = Google's `sub`. Email is never used to find or link an account.
 * - A new Google user gets a PATIENT account and patient profile only. DOCTOR still requires the doctor
 *   application and admin approval; ADMIN is never granted here.
 * - An email that already belongs to an account without a linked Google identity is refused (no
 *   automatic linking): the owner signs in with their password and connects Google from Account security.
 * - Linking happens only from an authenticated session, bound to that user and session.
 * - ADMIN accounts are password-only: they can neither link Google nor sign in with it.
 * - Sign-in goes through the existing session machinery: account status, usable roles, refresh-token
 *   rotation and reuse detection all apply unchanged.
 */
const PROVIDER = 'GOOGLE';

/** A redirect back to the web app, carrying only a stable outcome code (never a token). */
class GoogleFlowError extends Error {
  constructor(code, reason = code) {
    super(code);
    this.code = code;
    this.reason = reason;
  }
}

const isAdmin = (user) => rolesOf(user).includes('ADMIN');

function requireConfig() {
  const config = getGoogleConfig();
  if (!config) throw new ApiError(503, 'Google sign-in is not available', undefined, AuthErrorCode.googleUnavailable);
  return config;
}

export const isGoogleAvailable = () => getGoogleConfig() !== null;

/* ------------------------------------------------------------------ start */

/** Starts sign-in / registration. Returns the Google URL and the sealed OAuth cookie value. */
export async function startSignIn({ next, language }, now = new Date()) {
  const config = requireConfig();
  const tx = newOAuthTransaction({ mode: 'login', next: next ?? null, language: language ?? null });
  return {
    authorizationUrl: buildAuthorizationUrl(config, { state: tx.state, nonce: tx.nonce, codeChallenge: codeChallengeFor(tx.codeVerifier), language }),
    cookie: await sealOAuthTransaction(config.stateSecret, tx, now),
  };
}

/** Starts connecting Google to the signed-in account (bound to this user and session). */
export async function startLink(auth, { language }, now = new Date()) {
  const config = requireConfig();
  if (isAdmin(auth.user)) throw ApiError.forbidden('Administrator accounts sign in with a password only', undefined, AuthErrorCode.googleAdminForbidden);
  if (await authRepository.findIdentityForUser(prisma, auth.user.id, PROVIDER)) {
    throw ApiError.conflict('A Google account is already connected', undefined, AuthErrorCode.googleAlreadyConnected);
  }
  const tx = newOAuthTransaction({ mode: 'link', userId: auth.user.id, sessionId: auth.sessionId, language: language ?? null });
  return {
    authorizationUrl: buildAuthorizationUrl(config, { state: tx.state, nonce: tx.nonce, codeChallenge: codeChallengeFor(tx.codeVerifier), language }),
    cookie: await sealOAuthTransaction(config.stateSecret, tx, now),
  };
}

/* --------------------------------------------------------------- callback */

const isUniqueViolation = (error) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
const targetOf = (error) => [].concat(error.meta?.target ?? []).join(',');

function displayName(identity) {
  if (identity.name.length >= 2) return identity.name;
  const local = identity.email.split('@')[0].replace(/[._-]+/g, ' ').trim().slice(0, 160);
  return local.length >= 2 ? local : 'Fogaan Dawo patient';
}

async function signIn(identity, transaction, meta, now) {
  const linked = await authRepository.findIdentityBySubject(prisma, PROVIDER, identity.subject);

  if (linked) {
    const user = await authRepository.findAuthUserById(prisma, linked.userId);
    if (isAdmin(user)) throw new GoogleFlowError(AuthErrorCode.googleAdminForbidden);
    try {
      assertAccountActive(user);
    } catch (error) {
      throw new GoogleFlowError(error.code);
    }
    let activeRole;
    try {
      activeRole = chooseActiveRole(user);
    } catch (error) {
      throw new GoogleFlowError(error.code);
    }
    const session = await withTransaction(async (tx) => {
      const started = await startSession(tx, user, activeRole, meta, now);
      await authRepository.setLastLogin(tx, user.id, now);
      await authRepository.touchIdentity(tx, linked.id, now);
      await auditRepository.createAuditLog(tx, { actorUserId: user.id, action: 'LOGIN', entityType: 'Session', entityId: started.sessionId, newValues: { activeRole, method: 'google' } });
      return started;
    });
    return { user: { ...user, lastLoginAt: now }, activeRole, session };
  }

  // Not linked yet. An existing account with this email is never linked automatically.
  if (await authRepository.findUserIdByEmail(prisma, identity.email)) throw new GoogleFlowError(AuthErrorCode.googleEmailExists);

  try {
    return await withTransaction(async (tx) => {
      if (await authRepository.findUserIdByEmail(tx, identity.email)) throw new GoogleFlowError(AuthErrorCode.googleEmailExists);
      const patientRole = await authRepository.findRoleByName(tx, 'PATIENT');
      if (!patientRole) throw new ApiError(500, 'PATIENT role is not seeded');
      const created = await authRepository.createPatientAccount(tx, {
        fullName: displayName(identity),
        email: identity.email,
        passwordHash: null,
        preferredLanguage: transaction.language ?? undefined,
        patientRoleId: patientRole.id,
        emailVerifiedAt: now, // verified by Google (email_verified = true)
      });
      await authRepository.createIdentity(tx, { userId: created.id, provider: PROVIDER, providerSubject: identity.subject, emailAtLink: identity.email, lastUsedAt: now });
      const started = await startSession(tx, created, 'PATIENT', meta, now);
      await authRepository.setLastLogin(tx, created.id, now);
      await auditRepository.createAuditLog(tx, { actorUserId: created.id, action: 'CREATE', entityType: 'User', entityId: created.id, newValues: { registration: 'PATIENT', method: 'google' } });
      return { user: { ...created, lastLoginAt: now }, activeRole: 'PATIENT', session: started };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      // Lost a race: the same email registered, or the same Google account signed up, concurrently.
      throw new GoogleFlowError(targetOf(error).includes('email') ? AuthErrorCode.googleEmailExists : AuthErrorCode.googleFailed, 'concurrent_registration');
    }
    throw error;
  }
}

async function link(identity, transaction, now) {
  try {
    await withTransaction(async (tx) => {
      // The session that started the link must still be live and belong to the same user.
      const session = transaction.sessionId ? await authRepository.findSessionById(tx, transaction.sessionId) : null;
      if (!session || session.userId !== transaction.userId || session.revokedAt || session.expiresAt <= now) {
        throw new GoogleFlowError(AuthErrorCode.googleLinkSessionInvalid);
      }
      await lockRow(tx, 'users', transaction.userId); // serialise with a concurrent link / disconnect
      const user = await authRepository.findAuthUserById(tx, transaction.userId);
      try {
        assertAccountActive(user);
      } catch (error) {
        throw new GoogleFlowError(error.code);
      }
      if (isAdmin(user)) throw new GoogleFlowError(AuthErrorCode.googleAdminForbidden);

      const owner = await authRepository.findIdentityBySubject(tx, PROVIDER, identity.subject);
      if (owner && owner.userId !== user.id) throw new GoogleFlowError(AuthErrorCode.googleLinkedElsewhere);
      if (owner) return; // this Google account is already connected to this user
      if (await authRepository.findIdentityForUser(tx, user.id, PROVIDER)) throw new GoogleFlowError(AuthErrorCode.googleAlreadyConnected);

      const created = await authRepository.createIdentity(tx, { userId: user.id, provider: PROVIDER, providerSubject: identity.subject, emailAtLink: identity.email });
      await auditRepository.createAuditLog(tx, { actorUserId: user.id, action: 'CREATE', entityType: 'UserIdentity', entityId: created.id, newValues: { provider: PROVIDER } });
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new GoogleFlowError(targetOf(error).includes('user_id') ? AuthErrorCode.googleAlreadyConnected : AuthErrorCode.googleLinkedElsewhere, 'concurrent_link');
    }
    throw error;
  }
}

/** Where each outcome lands in the web app (relative to WEB_APP_URL). Only codes travel in the URL. */
function destination(config, mode, { ok, code, next } = {}) {
  const base = config?.webAppUrl ?? '';
  if (mode === 'link') {
    return ok ? `${base}/account/security?google=connected` : `${base}/account/security?googleError=${encodeURIComponent(code)}`;
  }
  if (ok) return `${base}/auth/google/complete${next ? `?next=${encodeURIComponent(next)}` : ''}`;
  return `${base}/login?authError=${encodeURIComponent(code)}`;
}

/**
 * Handles Google's redirect. Always resolves to { redirect, session? }; the controller clears the OAuth
 * cookie whatever happens and sets the refresh cookie only when a session was created.
 * `onFailure(reason)` receives a short non-sensitive reason for server logs.
 */
export async function handleCallback({ query, cookie, meta, onFailure = () => {} }, now = new Date()) {
  const config = getGoogleConfig();
  if (!config) return { redirect: destination(null, 'login', { code: AuthErrorCode.googleUnavailable }) };

  const transaction = await openOAuthTransaction(config.stateSecret, cookie, now);
  const fail = (mode, code, reason = code) => {
    onFailure(reason);
    return { redirect: destination(config, mode, { code }) };
  };
  if (!transaction) return fail('login', AuthErrorCode.googleStateInvalid, 'oauth_cookie_missing_or_invalid');
  const { mode } = transaction;
  if (!statesMatch(transaction.state, query.state)) return fail(mode, AuthErrorCode.googleStateInvalid, 'state_mismatch');
  if (!consumeState(transaction.state, transaction.expiresAt, now.getTime())) return fail(mode, AuthErrorCode.googleStateInvalid, 'state_replayed');
  if (query.iss !== undefined && !config.issuers.includes(query.iss)) return fail(mode, AuthErrorCode.googleFailed, 'callback_issuer_invalid');

  if (query.error !== undefined) {
    return query.error === 'access_denied' ? fail(mode, AuthErrorCode.googleCancelled, 'cancelled') : fail(mode, AuthErrorCode.googleFailed, 'provider_error');
  }
  if (typeof query.code !== 'string' || query.code.length === 0 || query.code.length > 2048) return fail(mode, AuthErrorCode.googleFailed, 'code_missing');

  let identity;
  try {
    const idToken = await exchangeCode(config, { code: query.code, codeVerifier: transaction.codeVerifier });
    identity = await verifyIdToken(config, idToken, { nonce: transaction.nonce, now });
  } catch (error) {
    if (!(error instanceof GoogleOidcError)) throw error;
    return fail(mode, error.reason === 'email_unverified' ? AuthErrorCode.googleEmailUnverified : AuthErrorCode.googleFailed, error.reason);
  }

  try {
    if (mode === 'link') {
      await link(identity, transaction, now);
      return { redirect: destination(config, 'link', { ok: true }) };
    }
    const result = await signIn(identity, transaction, meta, now);
    const auth = await buildAuthResult(result.user, result.activeRole, result.session);
    return { redirect: destination(config, 'login', { ok: true, next: transaction.next }), session: { refreshToken: auth.refreshToken, expiresAt: auth.session.expiresAt } };
  } catch (error) {
    if (error instanceof GoogleFlowError) return fail(mode, error.code, error.reason);
    throw error;
  }
}

/* ---------------------------------------------------- account security */

export async function getSignInMethods(auth) {
  const methods = await authRepository.findSignInMethods(prisma, auth.user.id);
  const google = methods.identities.find((i) => i.provider === PROVIDER) ?? null;
  const admin = isAdmin(auth.user);
  return {
    password: { enabled: methods.hasPassword },
    google: {
      available: isGoogleAvailable(),
      allowed: !admin, // administrators are password-only
      connected: Boolean(google),
      email: google?.emailAtLink ?? null,
      connectedAt: google?.createdAt ?? null,
      lastUsedAt: google?.lastUsedAt ?? null,
      canDisconnect: Boolean(google) && methods.hasPassword,
    },
  };
}

/** Disconnects Google — never when it is the account's only way to sign in. */
export async function disconnectGoogle(auth) {
  await withTransaction(async (tx) => {
    await lockRow(tx, 'users', auth.user.id);
    const methods = await authRepository.findSignInMethods(tx, auth.user.id);
    const google = methods.identities.find((i) => i.provider === PROVIDER);
    if (!google) throw new ApiError(404, 'No Google account is connected', undefined, AuthErrorCode.googleNotConnected);
    if (!methods.hasPassword) {
      throw ApiError.conflict('Google is the only way to sign in to this account; it cannot be disconnected', undefined, AuthErrorCode.lastSignInMethod);
    }
    await authRepository.deleteIdentity(tx, google.id);
    await auditRepository.createAuditLog(tx, { actorUserId: auth.user.id, action: 'DELETE', entityType: 'UserIdentity', entityId: google.id, oldValues: { provider: PROVIDER } });
  });
  return getSignInMethods(auth);
}
