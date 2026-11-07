import webpush from 'web-push';

/**
 * Sends one encrypted Web Push message (RFC 8291 aes128gcm + RFC 8292 VAPID). web-push builds the
 * encrypted body and signed headers; the request itself is sent with fetch (no redirects, 10 s timeout).
 * Returns the push service's HTTP status (0 = network error).
 */
export async function sendWebPush(config, subscription, payload, { ttlSeconds = 3600, urgency = 'high', topic } = {}) {
  const details = webpush.generateRequestDetails(
    { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
    JSON.stringify(payload),
    { vapidDetails: { subject: config.subject, publicKey: config.publicKey, privateKey: config.privateKey }, TTL: ttlSeconds, urgency, ...(topic ? { topic } : {}) },
  );
  try {
    const response = await fetch(details.endpoint, { method: details.method, headers: details.headers, body: details.body, redirect: 'error', signal: AbortSignal.timeout(10_000) });
    await response.arrayBuffer().catch(() => {});
    return response.status;
  } catch {
    return 0;
  }
}
