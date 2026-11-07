import { timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, errors as joseErrors, jwtVerify } from 'jose';

/**
 * Google OpenID Connect client (authorization-code flow with PKCE). The only module that talks to Google.
 * Never trusts anything the browser sends about the user: identity comes only from an ID token that this
 * server obtained directly from Google's token endpoint and verified against Google's published keys.
 */

/** A failed step of the Google flow. `reason` is a short, non-sensitive code (no tokens or profile data). */
export class GoogleOidcError extends Error {
  constructor(reason) {
    super(`Google sign-in failed: ${reason}`);
    this.name = 'GoogleOidcError';
    this.reason = reason;
  }
}

const keySets = new Map();
/** Google's signing keys, fetched on demand and cached (re-fetched when an unknown key id appears). */
function keySetFor(jwksUri) {
  let keySet = keySets.get(jwksUri);
  if (!keySet) {
    keySet = createRemoteJWKSet(new URL(jwksUri), { timeoutDuration: 5000, cooldownDuration: 30_000, cacheMaxAge: 10 * 60_000 });
    keySets.set(jwksUri, keySet);
  }
  return keySet;
}

export function buildAuthorizationUrl(config, { state, nonce, codeChallenge, language }) {
  const url = new URL(config.authorizationEndpoint);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
    ...(language ? { hl: language } : {}),
  }).toString();
  return url.toString();
}

/** Exchanges the one-time authorization code (with the PKCE verifier) for an ID token. */
export async function exchangeCode(config, { code, codeVerifier }) {
  let response;
  try {
    response = await fetch(config.tokenEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        code_verifier: codeVerifier,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new GoogleOidcError('token_endpoint_unreachable');
  }
  if (!response.ok) throw new GoogleOidcError('code_exchange_rejected');
  const body = await response.json().catch(() => null);
  if (typeof body?.id_token !== 'string' || body.id_token.length > 8192) throw new GoogleOidcError('id_token_missing');
  return body.id_token;
}

const sameString = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

function claimFailure(error) {
  if (error instanceof joseErrors.JWTExpired) return 'token_expired';
  if (error instanceof joseErrors.JWTClaimValidationFailed) {
    if (error.claim === 'iss') return 'issuer_invalid';
    if (error.claim === 'aud') return 'audience_invalid';
    return `claim_invalid_${error.claim}`;
  }
  if (error instanceof joseErrors.JWSSignatureVerificationFailed || error instanceof joseErrors.JWKSNoMatchingKey) return 'signature_invalid';
  if (error instanceof joseErrors.JWKSTimeout || !(error instanceof joseErrors.JOSEError)) return 'keys_unavailable';
  return 'token_invalid';
}

/**
 * Verifies an ID token: RS256 signature against Google's keys, issuer, audience (our client ID), expiry,
 * authorized party, the nonce bound to this sign-in attempt, and a verified email address.
 * Returns only the fields Fogaan Dawo uses.
 */
export async function verifyIdToken(config, idToken, { nonce, now = new Date() }) {
  let payload;
  try {
    ({ payload } = await jwtVerify(idToken, keySetFor(config.jwksUri), {
      issuer: config.issuers,
      audience: config.clientId,
      algorithms: ['RS256'],
      currentDate: now,
      clockTolerance: 30,
      requiredClaims: ['iss', 'aud', 'sub', 'exp', 'iat'],
    }));
  } catch (error) {
    throw new GoogleOidcError(claimFailure(error));
  }

  // Authorized party: when present (or when there are several audiences) it must be this client.
  const audiences = [].concat(payload.aud);
  if ((payload.azp !== undefined || audiences.length > 1) && payload.azp !== config.clientId) throw new GoogleOidcError('azp_invalid');
  if (typeof payload.nonce !== 'string' || !nonce || !sameString(payload.nonce, nonce)) throw new GoogleOidcError('nonce_invalid');
  if (typeof payload.sub !== 'string' || payload.sub.length === 0 || payload.sub.length > 255) throw new GoogleOidcError('subject_invalid');
  if (typeof payload.email !== 'string' || payload.email.length > 254 || !payload.email.includes('@')) throw new GoogleOidcError('email_missing');
  if (payload.email_verified !== true && payload.email_verified !== 'true') throw new GoogleOidcError('email_unverified');

  const name = typeof payload.name === 'string' ? payload.name.trim().replace(/\s+/g, ' ').slice(0, 160) : '';
  return { subject: payload.sub, email: payload.email.trim().toLowerCase(), name };
}
