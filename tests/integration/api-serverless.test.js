import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import app from '../../apps/api/src/index.js';

/** The Vercel entry exports a plain Express app (no listen, no intervals, no signaling hub). */
let server;
let base;
const savedSecret = process.env.CRON_SECRET;

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (savedSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = savedSecret;
  await new Promise((resolve) => server.close(resolve));
});

test('serverless entry exports an Express request handler', () => {
  assert.equal(typeof app, 'function');
  assert.equal(typeof app.use, 'function');
});

test('liveness works through the serverless entry', async () => {
  const res = await fetch(`${base}/api/health`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).status, 'ok');
});

test('signaling path reports 503 SIGNALING_UNAVAILABLE instead of 404', async () => {
  const res = await fetch(`${base}/api/v1/consultations/signal`);
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error.code, 'SIGNALING_UNAVAILABLE');
});

test('job endpoints are disabled (503) when CRON_SECRET is unset or too short', async () => {
  delete process.env.CRON_SECRET;
  let res = await fetch(`${base}/api/internal/jobs/tick`, { headers: { authorization: 'Bearer anything' } });
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error.code, 'JOBS_DISABLED');

  process.env.CRON_SECRET = 'too-short';
  res = await fetch(`${base}/api/internal/jobs/tick`, { headers: { authorization: 'Bearer too-short' } });
  assert.equal(res.status, 503);
});

test('job endpoints reject missing or wrong credentials without running anything', async () => {
  process.env.CRON_SECRET = 'x'.repeat(48);
  for (const headers of [{}, { authorization: `Bearer ${'y'.repeat(48)}` }, { authorization: `Basic ${'x'.repeat(48)}` }, { authorization: 'Bearer' }]) {
    const res = await fetch(`${base}/api/internal/jobs/tick`, { headers });
    assert.equal(res.status, 401);
  }
});

test('unknown job names are 404 even with valid credentials', async () => {
  process.env.CRON_SECRET = 'x'.repeat(48);
  const res = await fetch(`${base}/api/internal/jobs/drop-tables`, { headers: { authorization: `Bearer ${'x'.repeat(48)}` } });
  assert.equal(res.status, 404);
});
