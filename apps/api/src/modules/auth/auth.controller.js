import { ApiError } from '../../utils/ApiError.js';
import { AuthErrorCode, ClientType } from './auth.constants.js';
import { clearRefreshCookie, clientTypeOf, deliverRefreshToken, readRefreshToken } from './auth.cookies.js';
import * as authService from './auth.service.js';

/** Thin controllers: read the request, call the service, shape the response. */

const requestMeta = (req) => ({ userAgent: req.get('user-agent'), ipAddress: req.ip });

/** Moves the refresh token from the service result to its transport (cookie or native body). */
function respondWithSession(req, res, status, result) {
  const { refreshToken, ...body } = result;
  const delivered = deliverRefreshToken(req, res, { refreshToken, expiresAt: result.session.expiresAt });
  res.status(status).json({ data: { ...body, ...delivered } });
}

export async function register(req, res) {
  respondWithSession(req, res, 201, await authService.register(req.body, requestMeta(req)));
}

export async function login(req, res) {
  respondWithSession(req, res, 200, await authService.login(req.body, requestMeta(req)));
}

export async function refresh(req, res) {
  const token = readRefreshToken(req);
  try {
    if (!token) throw ApiError.unauthorized('Refresh token required', AuthErrorCode.refreshInvalid);
    respondWithSession(req, res, 200, await authService.refresh(token, requestMeta(req)));
  } catch (error) {
    if (clientTypeOf(req) === ClientType.web) clearRefreshCookie(res);
    throw error;
  }
}

export async function logout(req, res) {
  await authService.logout({ sessionId: req.auth?.sessionId ?? null, refreshToken: readRefreshToken(req), actorUserId: req.auth?.user.id ?? null });
  clearRefreshCookie(res);
  res.status(204).end();
}

export async function logoutAll(req, res) {
  const revokedSessions = await authService.logoutAll(req.auth.user.id);
  clearRefreshCookie(res);
  res.status(200).json({ data: { revokedSessions } });
}

export async function switchRole(req, res) {
  respondWithSession(req, res, 200, await authService.switchRole(req.auth, req.body.role, requestMeta(req)));
}

export function me(req, res) {
  res.status(200).json({ data: authService.getMe(req.auth) });
}

export async function changePassword(req, res) {
  res.json({ data: await authService.changePassword(req.auth, req.body) });
}
