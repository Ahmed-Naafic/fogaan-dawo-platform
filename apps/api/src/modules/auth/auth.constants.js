/** Default active role when none is requested: least privilege first. */
export const ROLE_PRECEDENCE = Object.freeze(['PATIENT', 'DOCTOR', 'ADMIN']);

/** Header that identifies the client type and doubles as CSRF protection for cookie-based calls. */
export const CLIENT_HEADER = 'x-fogaan-client';
export const ClientType = Object.freeze({ web: 'web', native: 'native' });

/** Stable error codes returned to clients. */
export const AuthErrorCode = Object.freeze({
  invalidCredentials: 'INVALID_CREDENTIALS',
  tokenMissing: 'TOKEN_MISSING',
  tokenInvalid: 'TOKEN_INVALID',
  tokenExpired: 'TOKEN_EXPIRED',
  sessionRevoked: 'SESSION_REVOKED',
  sessionExpired: 'SESSION_EXPIRED',
  refreshInvalid: 'REFRESH_TOKEN_INVALID',
  refreshReused: 'REFRESH_TOKEN_REUSED',
  accountSuspended: 'ACCOUNT_SUSPENDED',
  accountDisabled: 'ACCOUNT_DISABLED',
  accountNotActive: 'ACCOUNT_NOT_ACTIVE',
  roleNotAssigned: 'ROLE_NOT_ASSIGNED',
  roleUnavailable: 'ROLE_UNAVAILABLE',
  noUsableRole: 'NO_USABLE_ROLE',
  roleRequired: 'ROLE_REQUIRED',
  permissionRequired: 'PERMISSION_REQUIRED',
  csrfHeaderMissing: 'CLIENT_HEADER_REQUIRED',
  emailTaken: 'EMAIL_TAKEN',
  phoneTaken: 'PHONE_TAKEN',
  // Google sign-in
  googleUnavailable: 'GOOGLE_UNAVAILABLE',
  googleCancelled: 'GOOGLE_CANCELLED',
  googleFailed: 'GOOGLE_FAILED',
  googleStateInvalid: 'GOOGLE_STATE_INVALID',
  googleEmailUnverified: 'GOOGLE_EMAIL_UNVERIFIED',
  googleEmailExists: 'GOOGLE_EMAIL_EXISTS',
  googleLinkedElsewhere: 'GOOGLE_ALREADY_LINKED',
  googleAlreadyConnected: 'GOOGLE_ALREADY_CONNECTED',
  googleNotConnected: 'GOOGLE_NOT_CONNECTED',
  googleAdminForbidden: 'GOOGLE_ADMIN_NOT_ALLOWED',
  googleLinkSessionInvalid: 'GOOGLE_LINK_SESSION_INVALID',
  lastSignInMethod: 'LAST_SIGN_IN_METHOD',
  // Change password
  currentPasswordInvalid: 'CURRENT_PASSWORD_INVALID',
  passwordNotSet: 'PASSWORD_NOT_SET',
});
