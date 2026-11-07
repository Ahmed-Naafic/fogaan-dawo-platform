// A local stand-in for Google's OpenID Connect endpoints, for automated tests only (no real Google calls).
//   GET  /authorize  validates client_id + redirect_uri, then redirects back with a one-time code (or an
//                    error when the test asked for a cancelled sign-in) — simulating the consent screen
//   POST /token      checks client credentials, redirect_uri, single use of the code and the PKCE verifier,
//                    and returns an RS256 ID token
//   GET  /certs      the JWKS of the signing key
// `fake.next(...)` sets the profile and claim overrides for the next sign-in (e.g. a wrong audience).
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

export async function startFakeGoogle({ clientId = 'fake-client.apps.googleusercontent.com', clientSecret = randomBytes(24).toString('base64url') } = {}) {
  const kid = randomBytes(6).toString('hex');
  const good = await generateKeyPair('RS256');
  const rogue = await generateKeyPair('RS256'); // same kid, different key: signature must fail
  const jwk = { ...(await exportJWK(good.publicKey)), kid, alg: 'RS256', use: 'sig' };
  const codes = new Map();
  const stats = { authorize: 0, token: 0, tokenRejected: 0 };
  let pending = {};
  let issuer;
  let lastAuthorizeParams = null;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, issuer);
    const send = (status, body, headers = {}) => {
      res.writeHead(status, { 'content-type': 'application/json', ...headers });
      res.end(body === undefined ? '' : JSON.stringify(body));
    };
    try {
      if (req.method === 'GET' && url.pathname === '/certs') return send(200, { keys: [jwk] });

      if (req.method === 'GET' && url.pathname === '/authorize') {
        stats.authorize += 1;
        const p = Object.fromEntries(url.searchParams);
        lastAuthorizeParams = p;
        if (p.client_id !== clientId || !p.redirect_uri || p.response_type !== 'code' || p.code_challenge_method !== 'S256') return send(400, { error: 'invalid_request' });
        const plan = pending;
        pending = {};
        const back = new URL(p.redirect_uri);
        if (plan.deny) {
          back.search = new URLSearchParams({ error: 'access_denied', state: p.state }).toString();
        } else {
          const code = `4/${randomBytes(18).toString('base64url')}`;
          codes.set(code, { ...plan, nonce: p.nonce, challenge: p.code_challenge, redirectUri: p.redirect_uri, used: false });
          back.search = new URLSearchParams({ code, state: p.state, scope: 'openid email profile', authuser: '0', prompt: 'consent' }).toString();
        }
        res.writeHead(302, { location: back.toString() });
        return res.end();
      }

      if (req.method === 'POST' && url.pathname === '/token') {
        stats.token += 1;
        let raw = '';
        for await (const chunk of req) raw += chunk;
        const f = Object.fromEntries(new URLSearchParams(raw));
        const grant = codes.get(f.code);
        const verifierOk = grant && createHash('sha256').update(f.code_verifier ?? '').digest('base64url') === grant.challenge;
        if (f.grant_type !== 'authorization_code' || f.client_id !== clientId || f.client_secret !== clientSecret || !grant || grant.used || grant.redirectUri !== f.redirect_uri || !verifierOk) {
          stats.tokenRejected += 1;
          if (grant) grant.used = true; // like Google: a code is burned by any redemption attempt
          return send(400, { error: 'invalid_grant' });
        }
        grant.used = true;
        const o = grant.overrides ?? {};
        const now = Math.floor(Date.now() / 1000);
        const profile = { sub: randomBytes(10).toString('hex'), email: `g-${randomBytes(4).toString('hex')}@gmail.test`, email_verified: true, name: 'Hodan Google', ...grant.profile };
        const claims = { ...profile, nonce: grant.nonce, azp: clientId, ...o.claims };
        for (const [k, v] of Object.entries(claims)) if (v === undefined) delete claims[k];
        const idToken = await new SignJWT(claims)
          .setProtectedHeader({ alg: 'RS256', kid, typ: 'JWT' })
          .setIssuer(o.iss ?? issuer)
          .setAudience(o.aud ?? clientId)
          .setIssuedAt(o.iat ?? now)
          .setExpirationTime(o.exp ?? now + 3600)
          .sign(o.rogueSignature ? rogue.privateKey : good.privateKey);
        return send(200, { access_token: randomBytes(16).toString('hex'), token_type: 'Bearer', expires_in: 3599, scope: 'openid email profile', id_token: idToken });
      }
      return send(404, { error: 'not_found' });
    } catch (error) {
      return send(500, { error: error.message });
    }
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  issuer = `http://127.0.0.1:${server.address().port}`;

  return {
    clientId,
    clientSecret,
    issuer,
    stats,
    get lastAuthorizeParams() {
      return lastAuthorizeParams;
    },
    /** Environment variables pointing the API at this fake (test-only overrides; ignored in production). */
    env: {
      GOOGLE_CLIENT_ID: clientId,
      GOOGLE_CLIENT_SECRET: clientSecret,
      GOOGLE_TEST_AUTHORIZATION_ENDPOINT: `${issuer}/authorize`,
      GOOGLE_TEST_TOKEN_ENDPOINT: `${issuer}/token`,
      GOOGLE_TEST_JWKS_URI: `${issuer}/certs`,
      GOOGLE_TEST_ISSUER: issuer,
    },
    /** Profile ({ sub, email, email_verified, name }) and overrides ({ aud, iss, exp, claims, rogueSignature }) for the next sign-in; `deny` simulates "Cancel". */
    next({ profile = {}, overrides = {}, deny = false } = {}) {
      pending = { profile, overrides, deny };
    },
    close: () => new Promise((r) => server.close(r)),
  };
}
