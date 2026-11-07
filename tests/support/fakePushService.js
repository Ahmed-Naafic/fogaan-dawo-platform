// A local stand-in for a browser push service (FCM / Mozilla autopush / …), for automated tests only.
// Records every push request (VAPID headers + encrypted body) and answers 201, or the status set for a
// path (e.g. 410 Gone = the browser unsubscribed). No real push service is ever contacted.
import { createECDH, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';

export async function startFakePushService() {
  const requests = [];
  const statusByPath = new Map();
  const server = createServer(async (req, res) => {
    let size = 0;
    for await (const chunk of req) size += chunk.length;
    const status = statusByPath.get(req.url) ?? 201;
    requests.push({ path: req.url, method: req.method, headers: req.headers, size, status });
    res.writeHead(status);
    res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    requests,
    /** A subscription as a browser would create it (real P-256 key and auth secret). */
    newSubscription() {
      const ecdh = createECDH('prime256v1');
      ecdh.generateKeys();
      return {
        endpoint: `${origin}/push/${randomBytes(12).toString('hex')}`,
        expirationTime: null,
        keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') },
      };
    },
    respondWith(endpoint, status) {
      statusByPath.set(new URL(endpoint).pathname, status);
    },
    to: (endpoint) => requests.filter((r) => r.path === new URL(endpoint).pathname),
    close: () => new Promise((r) => server.close(r)),
  };
}
