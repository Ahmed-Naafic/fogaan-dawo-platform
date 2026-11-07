// End-to-end browser test of the web ↔ API authentication integration.
//
//   npm run test:e2e
//
// Starts, all isolated and torn down afterwards:
//   * a fresh Postgres schema on the configured Neon branch (harness: migrate → test → DROP SCHEMA);
//     on production this requires ALLOW_PRODUCTION_DB=true for the run
//   * the real API (apps/api) on a free port with a per-run JWT secret
//   * the real Vite dev server (apps/web, React StrictMode) proxying /api to that API
//   * headless Chrome driven over the DevTools protocol (Node's built-in WebSocket, no extra packages)
// Skips (exit 0) when no development database or no Chrome is available.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { databaseTestsSkipReason, setupTestDatabase } from '../integration/db/harness.js';
import { baseData } from '../integration/db/fixtures.js';
import { startFakeGoogle } from '../support/fakeGoogle.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(join(ROOT, 'package.json'));
const PASSWORD = 'Correct-horse-42';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EN = require('./apps/web/src/locales/en.json');
const SO = require('./apps/web/src/locales/so.json');

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

const skip = databaseTestsSkipReason() ?? (CHROME_CANDIDATES.some((p) => existsSync(p)) ? null : 'no Chrome/Edge found (set CHROME_PATH)');
if (skip) {
  console.log(`[e2e] skipped: ${skip}`);
  process.exit(0);
}

const freePort = () =>
  new Promise((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

async function waitForHttp(url, timeoutMs = 60_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return;
    } catch {
      /* not up yet */
    }
    await sleep(300);
  }
  throw new Error(`timed out waiting for ${url}`);
}

/* ------------------------------------------------------------------ CDP */
class Browser {
  async launch() {
    const chrome = CHROME_CANDIDATES.find((p) => existsSync(p));
    this.port = await freePort();
    this.profile = mkdtempSync(join(tmpdir(), 'fd-e2e-'));
    this.proc = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', `--remote-debugging-port=${this.port}`, `--user-data-dir=${this.profile}`, 'about:blank'], { stdio: 'ignore' });
    let wsUrl;
    for (let i = 0; i < 100 && !wsUrl; i += 1) {
      try {
        wsUrl = (await (await fetch(`http://127.0.0.1:${this.port}/json/version`)).json()).webSocketDebuggerUrl;
      } catch {
        await sleep(150);
      }
    }
    this.ws = new WebSocket(wsUrl);
    await new Promise((r, j) => {
      this.ws.onopen = r;
      this.ws.onerror = j;
    });
    this.seq = 0;
    this.pending = new Map();
    this.handlers = new Map(); // sessionId -> fn(method, params)
    this.ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.error) reject(new Error(m.error.message));
        else resolve(m.result);
      } else if (m.method && m.sessionId) {
        this.handlers.get(m.sessionId)?.(m.method, m.params);
      }
    };
  }
  send(method, params = {}, sessionId) {
    const id = (this.seq += 1);
    this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  /** A tab in its own browser context (separate cookie jar = a separate "device"). */
  async newPage() {
    const { browserContextId } = await this.send('Target.createBrowserContext', { disposeOnDetach: true });
    const { targetId } = await this.send('Target.createTarget', { url: 'about:blank', browserContextId });
    const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true });
    const page = new Page(this, sessionId);
    page.origin = this.origin;
    this.handlers.set(sessionId, (method, params) => page.onEvent(method, params));
    await page.init();
    return page;
  }
  async close() {
    try {
      this.ws?.close();
    } catch {
      /* closing */
    }
    this.proc?.kill();
    await sleep(500);
    try {
      rmSync(this.profile, { recursive: true, force: true });
    } catch {
      /* Chrome may still hold files */
    }
  }
}

class Page {
  constructor(browser, sessionId) {
    this.b = browser;
    this.sid = sessionId;
    this.requests = [];
    this.responses = []; // { url, status } of /api responses (diagnostics in failure messages)
    this.consoleErrors = [];
    this.loadWaiters = [];
  }
  send(method, params) {
    return this.b.send(method, params, this.sid);
  }
  async init() {
    await this.send('Page.enable');
    await this.send('Runtime.enable');
    await this.send('Network.enable');
    await this.send('Log.enable');
    await this.viewport('desktop');
  }
  onEvent(method, params) {
    if (method === 'Network.requestWillBeSent' && params.request.url.includes('/api/')) {
      this.requests.push({ url: new URL(params.request.url).pathname, method: params.request.method, at: Date.now() });
    }
    if (method === 'Network.responseReceived' && params.response.url.includes('/api/')) {
      this.responses.push({ url: new URL(params.response.url).pathname, status: params.response.status });
    }
    if (method === 'Runtime.exceptionThrown') this.consoleErrors.push(`exception: ${params.exceptionDetails.exception?.description ?? params.exceptionDetails.text}`);
    if (method === 'Runtime.consoleAPICalled' && params.type === 'error') this.consoleErrors.push(`console.error: ${params.args.map((a) => a.value ?? a.description).join(' ')}`);
    if (method === 'Page.loadEventFired') {
      this.loadWaiters.forEach((r) => r());
      this.loadWaiters = [];
    }
  }
  viewport(kind) {
    return kind === 'mobile'
      ? this.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
      : this.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false });
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  }
  async goto(url) {
    const loaded = new Promise((r) => {
      this.loadWaiters.push(r);
      setTimeout(r, 15_000);
    });
    await this.send('Page.navigate', { url });
    await loaded;
    await this.settle();
  }
  async reload() {
    const loaded = new Promise((r) => {
      this.loadWaiters.push(r);
      setTimeout(r, 15_000);
    });
    await this.send('Page.reload', { ignoreCache: true });
    await loaded;
    await this.settle();
  }
  /** Waits until React has rendered something other than the restore loader. */
  settle() {
    return this.waitFor(`document.querySelector('#root')?.children.length > 0 && !document.querySelector('[role=status] .animate-pulse')`, 15_000).then(() => sleep(400));
  }
  async waitFor(condition, timeoutMs = 10_000) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      if (await this.eval(`return Boolean(${condition});`).catch(() => false)) return true;
      await sleep(100);
    }
    throw new Error(`timed out waiting for: ${condition}`);
  }
  path() {
    return this.eval('return location.pathname + location.search;');
  }
  h1() {
    return this.eval(`return [...document.querySelectorAll('h1')].map(h => h.innerText.trim()).filter(Boolean)[0] ?? '';`);
  }
  toasts() {
    return this.eval(`return [...document.querySelectorAll('[aria-live=polite] > div')].map(d => d.innerText.trim());`);
  }
  async type(selector, text, { clear = true } = {}) {
    await this.eval(`const el = document.querySelector(${JSON.stringify(selector)}); el.focus(); ${clear ? 'el.select && el.select();' : ''} return true;`);
    if (clear) await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
    if (clear) await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
    await this.send('Input.insertText', { text });
  }
  clickText(selector, text) {
    return this.eval(`const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find(e => e.offsetParent !== null && e.innerText.trim() === ${JSON.stringify(text)}); if (!el) return false; el.click(); return true;`);
  }
  /** Sets a React-controlled <select> through the native setter so React sees the change. */
  selectValue(selector, value) {
    return this.eval(`const el = document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('change', { bubbles: true })); return true;`);
  }
  /** Puts a real file into an <input type=file> (as if chosen in the file picker). */
  async setFile(selector, filePath) {
    const { root } = await this.send('DOM.getDocument', { depth: -1 });
    const { nodeId } = await this.send('DOM.querySelector', { nodeId: root.nodeId, selector });
    await this.send('DOM.setFileInputFiles', { nodeId, files: [filePath] });
  }
  /** Optional design-review screenshots: saved only when E2E_SCREENSHOTS_DIR is set. */
  async snap(name) {
    const dir = process.env.E2E_SCREENSHOTS_DIR;
    if (!dir) return;
    await sleep(600);
    const { data } = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    writeFileSync(join(dir, `${name}.png`), Buffer.from(data, 'base64'));
  }
  hasText(text) {
    return this.eval(`return document.body.innerText.includes(${JSON.stringify(text)});`);
  }
  click(selector) {
    return this.eval(`const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find(e => e.offsetParent !== null); if (!el) return false; el.click(); return true;`);
  }
  /** Cookies the browser would send to the API's auth routes (the refresh cookie is scoped there). */
  async cookies() {
    return (await this.send('Network.getCookies', { urls: [`${this.origin}/api/v1/auth/refresh`] })).cookies;
  }
  /** Opens the (visible) profile menu once the dashboard header has rendered. */
  async openProfileMenu() {
    const trigger = 'header button[aria-expanded]:not([aria-haspopup])';
    await this.waitFor(`[...document.querySelectorAll('${trigger}')].some(b => b.offsetParent)`, 15_000);
    await this.click(trigger);
    await this.waitFor(`[...document.querySelectorAll('header button')].some(b => b.offsetParent && b.innerText.trim() === ${JSON.stringify(EN.common.signOut)})`);
  }
  async signOut(label = EN.common.signOut) {
    await this.openProfileMenu();
    await this.clickText('header button', label);
    await this.waitFor(`location.pathname === '/'`, 15_000);
  }
  countRequests(path, since = 0) {
    return this.requests.filter((r) => r.url === path && r.at >= since).length;
  }
}

/* ------------------------------------------------------------- the run */
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? '✔' : '✖'} ${name}${!ok && detail ? ` :: ${detail}` : ''}`);
};

let db;
let api;
let fakeGoogle;
let web;
let browser;
const storageDir = mkdtempSync(join(tmpdir(), 'fd-e2e-storage-'));
try {
  db = await setupTestDatabase();
  const ctx = await baseData(db.prisma);
  const { hashPassword } = await import('../../apps/api/src/utils/password.js');

  // A user with two roles, created directly (public registration only creates patients).
  const multiEmail = `multi-${Date.now()}@fogaandawo.test`;
  const multi = await db.prisma.user.create({
    data: {
      email: multiEmail,
      fullName: 'Dr. Hodan Axmed',
      passwordHash: await hashPassword(PASSWORD),
      roles: { create: [{ roleId: ctx.roles.PATIENT.id }, { roleId: ctx.roles.DOCTOR.id }] },
      patientProfile: { create: {} },
      doctorProfile: { create: { specialtyId: ctx.specialty.id, licenceNumber: 'E2E-1', licenceCountry: 'Somalia', consultationFee: '20.00', verificationStatus: 'VERIFIED' } },
    },
  });

  const apiPort = await freePort();
  const webPort = await freePort();
  const webOrigin = `http://localhost:${webPort}`;
  // Local fake Google on 127.0.0.1 — a different *site* from localhost, so the real cross-site redirect
  // behaviour of the cookies (SameSite) is exercised. No real Google endpoint is called.
  fakeGoogle = await startFakeGoogle();
  const env = {
    ...process.env, // DATABASE_URL / DIRECT_URL already point at the isolated test schema
    PORT: String(apiPort),
    JWT_ACCESS_SECRET: randomBytes(48).toString('base64url'),
    CORS_ORIGIN: webOrigin,
    COOKIE_SECURE: 'false',
    BCRYPT_ROUNDS: '10',
    AUTH_RATE_LIMIT_MAX: '1000',
    ...fakeGoogle.env,
    GOOGLE_REDIRECT_URI: `${webOrigin}/api/v1/auth/google/callback`,
    WEB_APP_URL: webOrigin,
    OAUTH_STATE_SECRET: randomBytes(32).toString('base64url'),
    ...(() => {
      const k = require('web-push').generateVAPIDKeys();
      return { VAPID_PUBLIC_KEY: k.publicKey, VAPID_PRIVATE_KEY: k.privateKey, VAPID_SUBJECT: 'mailto:e2e@fogaandawo.test' };
    })(),
    NOTIFICATION_DISPATCH_INTERVAL_SECONDS: '1',
    STORAGE_DIR: storageDir,
    PROFILE_RATE_LIMIT_MAX: '1000',
  };
  api = spawn(process.execPath, [join(ROOT, 'apps/api/src/server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  await waitForHttp(`http://127.0.0.1:${apiPort}/api/health`);
  web = spawn(process.execPath, [join(dirname(require.resolve('vite/package.json')), 'bin', 'vite.js'), '--port', String(webPort), '--strictPort'], {
    cwd: join(ROOT, 'apps/web'),
    env: { ...process.env, API_PROXY_TARGET: `http://127.0.0.1:${apiPort}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForHttp(`${webOrigin}/`);
  console.log(`[e2e] API :${apiPort}  web :${webPort}  schema ${db.schema}`);

  browser = new Browser();
  browser.origin = webOrigin;
  await browser.launch();
  const page = await browser.newPage();

  // E2E_ONLY=profiles,prescriptions runs only those sections (20, 21); sections 1–19 are then skipped.
  const E2E_SECTIONS = (process.env.E2E_ONLY ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  if (E2E_SECTIONS.length === 0) {
  /* 1. anonymous access */
  await page.goto(`${webOrigin}/patient`);
  check('unauthenticated /patient redirects to login with next', (await page.path()) === '/login?next=%2Fpatient', await page.path());
  check('no refresh call for anonymous visitors', page.countRequests('/api/v1/auth/refresh') === 0);

  /* 2. validation messages, English then Somali */
  await page.clickText('[role=tab]', EN.auth.register);
  await page.waitFor(`document.querySelector('input[name=passwordConfirmation]')`);
  await page.type('input[name=fullName]', 'Amina Cabdi');
  await page.type('input[name=identifier]', `amina-${Date.now()}@example.test`);
  await page.type('input[name=password]', PASSWORD);
  await page.type('input[name=passwordConfirmation]', 'Different-42');
  await page.click('form button[type=submit]');
  await sleep(300);
  check('EN: password mismatch message shown', (await page.toasts()).some((t) => t.includes(EN.authValidation.passwordMismatch)), JSON.stringify(await page.toasts()));
  check('mismatched field is marked invalid', await page.eval(`return document.querySelector('input[name=passwordConfirmation]').getAttribute('aria-invalid') === 'true';`));
  check('no API call for client-side validation errors', page.countRequests('/api/v1/auth/register') === 0);

  await page.goto(`${webOrigin}/login?lang=so`);
  await page.clickText('[role=tab]', SO.auth.register);
  await page.waitFor(`document.querySelector('input[name=passwordConfirmation]')`);
  await page.click('form button[type=submit]');
  await sleep(300);
  check('SO: Somali validation message shown', (await page.toasts()).some((t) => t.includes(SO.authValidation.identifierRequired)), JSON.stringify(await page.toasts()));
  await page.type('input[name=fullName]', 'Amina Cabdi');
  await page.type('input[name=identifier]', '0612345678');
  await page.type('input[name=password]', PASSWORD);
  await page.type('input[name=passwordConfirmation]', PASSWORD);
  await page.click('form button[type=submit]');
  await sleep(300);
  check('SO: local phone number rejected with international-format hint', (await page.toasts()).some((t) => t.includes(SO.authValidation.invalidPhone)));

  /* 2b. role selection lives on Register only; Doctor continues to the application; Admin is never offered */
  await page.goto(`${webOrigin}/login?lang=en`);
  const loginButtons = await page.eval(`return [...document.querySelectorAll('form button')].map(b => b.innerText.trim());`);
  check('login form has no role selector', !loginButtons.some((t) => [EN.roles.patient, EN.roles.doctor, EN.roles.admin].includes(t)) && !(await page.eval(`return !!document.querySelector('form fieldset');`)), JSON.stringify(loginButtons));
  await page.clickText('[role=tab]', EN.auth.register);
  await page.waitFor(`document.querySelector('form fieldset')`);
  const picker = await page.eval(`
    const fs = document.querySelector('form fieldset');
    const buttons = [...fs.querySelectorAll('button')].map(b => ({ text: b.innerText.trim(), pressed: b.getAttribute('aria-pressed') }));
    const fields = [...document.querySelectorAll('form input, form fieldset, form button[type=submit]')].map(e => e.name || e.tagName.toLowerCase() + (e.type === 'submit' ? ':submit' : ''));
    return { legend: fs.querySelector('legend').innerText.trim(), buttons, fields };`);
  check('register has the account-type selector with Patient (default) and Doctor only', picker.legend.toLowerCase() === EN.auth.accountType.toLowerCase() && JSON.stringify(picker.buttons) === JSON.stringify([{ text: EN.roles.patient, pressed: 'true' }, { text: EN.roles.doctor, pressed: 'false' }]), JSON.stringify(picker));
  check('selector sits after Confirm Password and before the Register button', JSON.stringify(picker.fields.slice(-3)) === JSON.stringify(['passwordConfirmation', 'fieldset', 'button:submit']), JSON.stringify(picker.fields));
  check('Admin cannot be selected for public registration', !picker.buttons.some((b) => b.text === EN.roles.admin));
  await page.clickText('form fieldset button', EN.roles.doctor);
  await sleep(200);
  const doctorState = await page.eval(`return { note: document.querySelector('#doctor-signup-note')?.innerText.trim() ?? null, disabled: document.querySelector('form button[type=submit]').disabled };`);
  check('selecting Doctor explains the next step and keeps Register enabled', doctorState.note === EN.auth.doctorSignupNote && !doctorState.disabled, JSON.stringify(doctorState));
  await page.clickText('form fieldset button', EN.roles.patient);
  await sleep(200);
  check('switching back to Patient hides the doctor note', !(await page.eval(`return !!document.querySelector('#doctor-signup-note');`)));
  await page.goto(`${webOrigin}/register?lang=so&role=doctor`);
  await page.waitFor(`document.querySelector('#doctor-signup-note')`);
  check('"Join as a doctor" link (?role=doctor) preselects Doctor, note in Somali', (await page.eval(`return document.querySelector('#doctor-signup-note').innerText.trim();`)) === SO.auth.doctorSignupNote);

  /* 3. successful registration (English) */
  await page.goto(`${webOrigin}/login?lang=en&next=%2Fpatient`);
  await page.clickText('[role=tab]', EN.auth.register);
  await page.waitFor(`document.querySelector('input[name=passwordConfirmation]')`);
  const patientEmail = `amina-${Date.now()}@example.test`;
  await page.type('input[name=fullName]', 'Amina Cabdi');
  await page.type('input[name=identifier]', patientEmail);
  await page.type('input[name=password]', PASSWORD);
  await page.type('input[name=passwordConfirmation]', PASSWORD);
  await page.click('form button[type=submit]');
  await page.waitFor(`location.pathname === '/patient'`, 15_000);
  await page.settle();
  check('registration signs in and lands on /patient', (await page.path()) === '/patient');
  check('dashboard greets the real user', /Amina/.test(await page.h1()), await page.h1());
  const cookie1 = (await page.cookies()).find((c) => c.name === 'fd_refresh');
  check('refresh token is in an HttpOnly, SameSite=Strict cookie scoped to /api/v1/auth', cookie1?.httpOnly && cookie1.sameSite === 'Strict' && cookie1.path === '/api/v1/auth', JSON.stringify(cookie1 && { httpOnly: cookie1.httpOnly, sameSite: cookie1.sameSite, path: cookie1.path }));
  const storage = await page.eval(`return { cookie: document.cookie, local: JSON.stringify(localStorage), session: JSON.stringify(sessionStorage) };`);
  check('no token readable by JavaScript or stored in web storage', !storage.cookie.includes('fd_refresh') && !/eyJ|v1\./.test(storage.local + storage.session), JSON.stringify(storage));

  /* 4. session restoration + rotation after reload (StrictMode double effect → still ONE refresh) */
  const beforeReload = Date.now();
  await page.reload();
  await page.waitFor(`location.pathname === '/patient'`);
  check('session restored after page refresh', (await page.path()) === '/patient' && /Amina/.test(await page.h1()));
  check('exactly one refresh request on reload', page.countRequests('/api/v1/auth/refresh', beforeReload) === 1, String(page.countRequests('/api/v1/auth/refresh', beforeReload)));
  const cookie2 = (await page.cookies()).find((c) => c.name === 'fd_refresh');
  check('refresh token rotated on restore', cookie2 && cookie2.value !== cookie1.value);

  /* 5. many simultaneous requests with an expired/invalid access token → one refresh */
  const beforeBurst = Date.now();
  const burst = await page.eval(`
    const m = await import('/src/lib/apiClient.js');
    m.setAccessToken('invalid.access.token');
    const r = await Promise.all(Array.from({ length: 5 }, () => m.apiRequest('/v1/auth/me')));
    return r.map((x) => x.user.fullName);`);
  check('5 concurrent requests all succeed after one shared refresh', burst.length === 5 && burst.every((n) => n === 'Amina Cabdi') && page.countRequests('/api/v1/auth/refresh', beforeBurst) === 1, `refreshes=${page.countRequests('/api/v1/auth/refresh', beforeBurst)}`);

  /* 6. role-protected routes */
  await page.goto(`${webOrigin}/admin`);
  check('patient opening /admin sees the forbidden page', (await page.h1()) === EN.authz.forbiddenTitle, await page.h1());
  await page.goto(`${webOrigin}/doctor/appointments`);
  check('patient opening /doctor sees the forbidden page', (await page.h1()) === EN.authz.forbiddenTitle);
  await page.goto(`${webOrigin}/login`);
  await page.waitFor(`location.pathname === '/patient'`, 15_000).catch(() => {});
  check('signed-in user visiting /login goes to their dashboard', (await page.path()) === '/patient', await page.path());

  /* 7. profile menu: single-role user has no role switcher; sign out */
  await page.openProfileMenu();
  check('single-role user: no "switch view" list', !(await page.eval(`return [...document.querySelectorAll('header button')].some(b => b.innerText.trim() === ${JSON.stringify(EN.roles.doctor)});`)));
  await page.clickText('header button', EN.common.signOut);
  await page.waitFor(`location.pathname === '/'`);
  check('logout returns to the landing page', (await page.path()) === '/');
  let cleared = false;
  for (let i = 0; i < 50 && !cleared; i += 1) {
    cleared = !(await page.cookies()).some((c) => c.name === 'fd_refresh' && c.value);
    if (!cleared) await sleep(100);
  }
  check('logout cleared the refresh cookie', cleared);
  await page.goto(`${webOrigin}/patient`);
  check('after logout /patient requires login again', (await page.path()).startsWith('/login?next='));

  /* 8. wrong password (generic message) and phone login */
  await page.type('input[name=identifier]', patientEmail);
  await page.type('input[name=password]', 'Wrong-password-1');
  await page.click('form button[type=submit]');
  await page.waitFor(`[...document.querySelectorAll('[aria-live=polite] > div')].length > 0`);
  check('wrong password shows the generic credentials message', (await page.toasts()).some((t) => t.includes(EN.authErrors.INVALID_CREDENTIALS)));

  const phone = `+25261${String(Date.now()).slice(-7)}`;
  const phoneReg = await fetch(`http://127.0.0.1:${apiPort}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-fogaan-client': 'native' },
    body: JSON.stringify({ fullName: 'Cabdi Phone', phone, password: PASSWORD, passwordConfirmation: PASSWORD }),
  });
  check('(setup) phone account registered via API', phoneReg.status === 201);
  await page.goto(`${webOrigin}/login`);
  await page.type('input[name=identifier]', `00${phone.slice(1, 4)} ${phone.slice(4)}`);
  await page.type('input[name=password]', PASSWORD);
  await page.click('form button[type=submit]');
  await page.waitFor(`location.pathname === '/patient'`, 15_000);
  check('login with an international phone number works', (await page.path()) === '/patient');
  await page.signOut();
  await sleep(1000); // let the logout request finish before the next sign-in

  /* 9. multiple roles + role switching */
  await page.goto(`${webOrigin}/login`);
  await page.type('input[name=identifier]', multiEmail);
  await page.type('input[name=password]', PASSWORD);
  await page.click('form button[type=submit]');
  await page.waitFor(`location.pathname === '/patient'`, 15_000);
  check('multi-role user starts in the least-privileged role (Patient)', (await page.path()) === '/patient');
  await page.openProfileMenu();
  const menuRoles = await page.eval(`return [...document.querySelectorAll('header button')].filter(b => b.offsetParent && b.querySelector('svg') && ${JSON.stringify([EN.roles.patient, EN.roles.doctor, EN.roles.admin])}.includes(b.innerText.trim())).map(b => b.innerText.trim());`);
  check('profile menu lists only assigned roles', JSON.stringify(menuRoles) === JSON.stringify([EN.roles.patient, EN.roles.doctor]), JSON.stringify(menuRoles));
  const beforeSwitch = Date.now();
  await page.clickText('header button', EN.roles.doctor);
  await page.waitFor(`location.pathname === '/doctor'`, 15_000);
  await page.settle();
  check('switching to Doctor calls the API once and opens /doctor', (await page.path()) === '/doctor' && page.countRequests('/api/v1/auth/switch-role', beforeSwitch) === 1);
  await page.reload();
  check('active role survives a reload', (await page.path()) === '/doctor' && /Hodan/.test(await page.h1()), `${await page.path()} ${await page.h1()}`);
  const beforeAuto = Date.now();
  await page.goto(`${webOrigin}/patient`);
  await page.waitFor(`location.pathname === '/patient' && document.querySelector('h1')`);
  check('opening another assigned role’s area switches automatically (one API call under StrictMode)', page.countRequests('/api/v1/auth/switch-role', beforeAuto) === 1, String(page.countRequests('/api/v1/auth/switch-role', beforeAuto)));
  await page.goto(`${webOrigin}/admin`);
  check('multi-role user without ADMIN sees the forbidden page', (await page.h1()) === EN.authz.forbiddenTitle);

  /* 10. logout-all across two "devices" (separate browser contexts) */
  const device2 = await browser.newPage();
  await device2.goto(`${webOrigin}/login`);
  await device2.type('input[name=identifier]', multiEmail);
  await device2.type('input[name=password]', PASSWORD);
  await device2.click('form button[type=submit]');
  await device2.waitFor(`location.pathname === '/patient'`, 15_000);
  await page.goto(`${webOrigin}/patient`);
  await page.signOut(EN.common.signOutAll);
  await sleep(1500); // logout-all request completes after leaving the protected area
  check('logout-all signs out this device', (await page.path()) === '/');
  // Wait until the revocation is actually in the database (Neon latency varies) before testing the other device.
  for (let i = 0; i < 50; i += 1) {
    const open = await db.prisma.session.count({ where: { user: { email: multiEmail }, revokedAt: null } });
    if (open === 0) break;
    await sleep(200);
  }
  await device2.eval(`const m = await import('/src/lib/apiClient.js'); try { await m.apiRequest('/v1/auth/me'); } catch (e) { return e.code; } return 'ok';`);
  await device2.waitFor(`location.pathname === '/login'`, 10_000).catch(() => {});
  check('other device is signed out on its next API call', (await device2.path()).startsWith('/login'), await device2.path());
  await device2.reload();
  check('other device stays signed out after reload', (await device2.path()).startsWith('/login'));

  /* 11. expired / revoked session found on reload */
  await page.goto(`${webOrigin}/login`);
  await page.type('input[name=identifier]', patientEmail);
  await page.type('input[name=password]', PASSWORD);
  await page.click('form button[type=submit]');
  await page.waitFor(`location.pathname === '/patient'`, 15_000);
  const patientUser = await db.prisma.user.findUniqueOrThrow({ where: { email: patientEmail } });
  await db.prisma.session.updateMany({ where: { userId: patientUser.id, revokedAt: null }, data: { revokedAt: new Date() } });
  await page.reload();
  check('a revoked session on reload sends the user to login', (await page.path()) === '/login?next=%2Fpatient', await page.path());
  await db.prisma.user.update({ where: { id: patientUser.id }, data: { status: 'SUSPENDED' } });
  await page.type('input[name=identifier]', patientEmail);
  await page.type('input[name=password]', PASSWORD);
  await page.click('form button[type=submit]');
  await page.waitFor(`[...document.querySelectorAll('[aria-live=polite] > div')].some(d => d.innerText.includes(${JSON.stringify(EN.authErrors.ACCOUNT_SUSPENDED)}))`).catch(() => {});
  check('suspended account sees the suspended message', (await page.toasts()).some((t) => t.includes(EN.authErrors.ACCOUNT_SUSPENDED)), JSON.stringify(await page.toasts()));

  /* 12. mobile layout of the auth screen */
  await page.viewport('mobile');
  await page.goto(`${webOrigin}/login`);
  await page.clickText('[role=tab]', EN.auth.register);
  await page.waitFor(`document.querySelector('input[name=passwordConfirmation]')`);
  const mobile = await page.eval(`return { overflow: document.documentElement.scrollWidth > innerWidth + 1, confirmWidth: document.querySelector('input[name=passwordConfirmation]').getBoundingClientRect().width, passwordWidth: document.querySelector('input[name=password]').getBoundingClientRect().width };`);
  check('mobile: no horizontal overflow, confirm field matches password field', !mobile.overflow && Math.abs(mobile.confirmWidth - mobile.passwordWidth) < 1, JSON.stringify(mobile));

  /* 13. doctor management: apply → reject with reason → resubmit → approve → doctor dashboard */
  await page.viewport('desktop');
  const licencePath = join(mkdtempSync(join(tmpdir(), 'fd-licence-')), 'licence.pdf');
  writeFileSync(licencePath, '%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');
  const adminEmail = `verifier-${Date.now()}@fogaandawo.test`;
  await db.prisma.user.create({ data: { email: adminEmail, fullName: 'Admin Verifier', passwordHash: await hashPassword(PASSWORD), roles: { create: [{ roleId: ctx.roles.ADMIN.id }] } } });
  const applicantEmail = `doctor-${Date.now()}@example.test`;

  await page.goto(`${webOrigin}/login?lang=en`);
  await page.clickText('[role=tab]', EN.auth.register);
  await page.waitFor(`document.querySelector('input[name=passwordConfirmation]')`);
  await page.type('input[name=fullName]', 'Ayaan Warsame');
  await page.type('input[name=identifier]', applicantEmail);
  await page.type('input[name=password]', PASSWORD);
  await page.type('input[name=passwordConfirmation]', PASSWORD);
  await page.clickText('form fieldset button', EN.roles.doctor);
  await page.click('form button[type=submit]');
  await page.waitFor(`location.pathname === '/patient/doctor-application'`, 15_000);
  await page.waitFor(`document.querySelector('input[name=licenceNumber]')`, 15_000);
  check('registering as Doctor creates the account and opens the doctor application', (await page.hasText(EN.doctorApp.welcome)) && (await page.hasText(EN.doctorApp.statusTitle.NOT_SUBMITTED)));
  const applicant = await db.prisma.user.findUniqueOrThrow({ where: { email: applicantEmail }, include: { roles: { include: { role: true } } } });
  check('the new account has no DOCTOR role yet', applicant.roles.map((r) => r.role.name).join(',') === 'PATIENT');

  await page.type('input[name=professionalName]', 'Dr. Ayaan Warsame');
  await page.selectValue('select[name=specialtyId]', ctx.specialty.id);
  await page.type('input[name=licenceNumber]', 'SMC-2020/1188');
  await page.type('input[name=licenceCountry]', 'Somalia');
  await page.type('input[name=consultationFee]', '25');
  await page.type('textarea[name=bio]', 'Cardiologist with eight years of experience caring for patients in Mogadishu and Hargeisa.');
  await page.clickText('button', EN.languageNames.so);
  await page.clickText('button', EN.languageNames.en);
  await page.clickText('button', EN.doctorApp.save);
  await page.waitFor(`document.body.innerText.includes(${JSON.stringify(EN.doctorApp.saved)})`, 15_000).catch(() => {});
  check('application details are saved as a draft', page.requests.some((r) => r.url === '/api/v1/doctor-application' && r.method === 'PUT') && (await page.hasText(EN.doctorApp.saved)));

  await page.setFile('#upload-MEDICAL_LICENSE', licencePath);
  await page.waitFor(`document.body.innerText.includes('licence.pdf')`, 15_000).catch(() => {});
  check('medical licence uploads through the real file input', await page.hasText('licence.pdf'));
  await page.snap('01-doctor-application-draft');
  await page.clickText('button', EN.doctorApp.submit);
  await page.waitFor(`document.body.innerText.includes(${JSON.stringify(EN.doctorApp.statusTitle.PENDING)})`, 15_000).catch(() => {});
  await page.snap('01b-application-pending');
  check('application submitted: status Pending, form locked', (await page.hasText(EN.doctorApp.statusTitle.PENDING)) && (await page.eval(`return document.querySelector('input[name=licenceNumber]').disabled;`)));
  await page.goto(`${webOrigin}/doctor`);
  await page.snap('01c-pending-doctor-dashboard-blocked');
  check('pending applicant cannot open the Doctor Dashboard', (await page.h1()) === EN.authz.forbiddenTitle, await page.h1());

  const adminPage = await browser.newPage();
  await adminPage.goto(`${webOrigin}/login?lang=en`);
  await adminPage.type('input[name=identifier]', adminEmail);
  await adminPage.type('input[name=password]', PASSWORD);
  await adminPage.click('form button[type=submit]');
  await adminPage.waitFor(`location.pathname === '/admin'`, 15_000);
  await adminPage.goto(`${webOrigin}/admin/verification`);
  await adminPage.waitFor(`document.body.innerText.includes('Dr. Ayaan Warsame')`, 15_000).catch(() => {});
  await adminPage.snap('02-admin-verification-list');
  check('admin sees the application in the Pending tab', (await adminPage.hasText('Dr. Ayaan Warsame')) && (await adminPage.eval(`return [...document.querySelectorAll('[role=tab]')].some(t => /\(\d+\)/.test(t.innerText));`)));
  await adminPage.eval(`const a = [...document.querySelectorAll('a')].find(x => x.innerText.includes('Dr. Ayaan Warsame')); a && a.click(); return !!a;`);
  await adminPage.waitFor(`location.pathname.startsWith('/admin/verification/') && document.querySelector('#reject-reason')`, 15_000);
  await adminPage.snap('03-admin-application-review');
  const beforeView = Date.now();
  await adminPage.clickText('button', EN.doctorApp.view);
  await sleep(1500);
  check('admin opens the private licence securely (authenticated download)', adminPage.requests.some((r) => /\/api\/v1\/admin\/doctor-applications\/[0-9a-f-]+\/documents\/[0-9a-f-]+\/file$/.test(r.url) && r.at >= beforeView));
  await adminPage.type('#reject-reason', 'The licence number does not match the uploaded certificate.');
  await adminPage.clickText('button', EN.verification.reject);
  await adminPage.waitFor(`document.body.innerText.includes(${JSON.stringify(EN.verification.done.reject)})`, 15_000).catch(() => {});
  check('admin rejects with a reason', await adminPage.hasText(EN.verification.done.reject));
  check('sidebar Verification badge clears right after the rejection (no navigation)', await adminPage.waitFor(`!document.querySelector('aside a[href="/admin/verification"] span.bg-red-500')`, 5000).catch(() => false));

  await page.goto(`${webOrigin}/patient/doctor-application`);
  await page.waitFor(`document.body.innerText.includes(${JSON.stringify(EN.doctorApp.statusTitle.REJECTED)})`, 15_000).catch(() => {});
  await page.snap('04-application-rejected');
  check('applicant sees the rejection reason', (await page.hasText(EN.doctorApp.statusTitle.REJECTED)) && (await page.hasText('The licence number does not match the uploaded certificate.')));
  await page.clickText('button', EN.doctorApp.resubmit);
  await page.waitFor(`document.body.innerText.includes(${JSON.stringify(EN.doctorApp.statusTitle.PENDING)})`, 15_000).catch(() => {});
  check('applicant resubmits after rejection', await page.hasText(EN.doctorApp.statusTitle.PENDING));

  await adminPage.reload();
  await adminPage.waitFor(`[...document.querySelectorAll('button')].some(b => b.innerText.includes(${JSON.stringify(EN.verification.approve)}))`, 15_000);
  await adminPage.waitFor(`document.querySelector('aside a[href="/admin/verification"] span.bg-red-500')?.innerText.trim() === '1'`, 8000).catch(() => {});
  const badgeBefore = await adminPage.eval(`return document.querySelector('aside a[href="/admin/verification"] span.bg-red-500')?.innerText.trim() ?? null;`);
  await adminPage.clickText('button', EN.verification.approve);
  await adminPage.waitFor(`document.body.innerText.includes(${JSON.stringify(EN.verification.done.approve)})`, 15_000).catch(() => {});
  check('sidebar Verification badge updates immediately after approval', badgeBefore === '1' && (await adminPage.waitFor(`!document.querySelector('aside a[href="/admin/verification"] span.bg-red-500')`, 5000).catch(() => false)), `before=${badgeBefore}`);
  await adminPage.snap('04b-admin-approved');
  check('admin approves the resubmitted application', await adminPage.hasText(EN.verification.done.approve));
  const approvedRoles = (await db.prisma.userRole.findMany({ where: { userId: applicant.id }, include: { role: true } })).map((r) => r.role.name).sort();
  check('DOCTOR role granted only after approval', approvedRoles.join(',') === 'DOCTOR,PATIENT', approvedRoles.join(','));

  await page.reload();
  await page.waitFor(`document.body.innerText.includes(${JSON.stringify(EN.doctorApp.openDashboard)})`, 15_000).catch(() => {});
  await page.snap('04c-application-verified');
  check('verified application: no "Submit for verification" card and no "cannot be edited while reviewed" message', !(await page.hasText(EN.doctorApp.sections.submit)) && !(await page.hasText(EN.doctorApp.locked)));
  await page.clickText('button', EN.doctorApp.openDashboard);
  await page.waitFor(`location.pathname === '/doctor' && document.body.innerText.includes(${JSON.stringify(EN.doctorDash.profileTitle)})`, 20_000).catch(() => {});
  await page.snap('05-doctor-dashboard');
  await page.viewport('mobile');
  await page.reload();
  await page.waitFor(`document.body.innerText.includes(${JSON.stringify(EN.doctorDash.profileTitle)})`, 15_000).catch(() => {});
  await page.snap('06-doctor-dashboard-mobile');
  await page.viewport('desktop');
  check('approved doctor opens the Doctor Dashboard with the real profile', (await page.path()) === '/doctor' && (await page.hasText(EN.doctorDash.profileTitle)) && (await page.hasText('$25.00 / consultation')) && (await page.hasText(EN.appStatus.VERIFIED)), await page.path());

  /* 14. availability → published slots → public directory and profile (no login) */
  await page.goto(`${webOrigin}/doctor/availability`);
  await page.waitFor(`document.querySelector('[data-day="1"] [role=switch]')`, 15_000);
  await page.eval(`for (const sw of document.querySelectorAll('[data-day] [role=switch]')) if (sw.getAttribute('aria-checked') !== 'true') sw.click(); return true;`);
  await sleep(300);
  await page.clickText('button', EN.availability.save);
  await page.waitFor(`document.body.innerText.includes(${JSON.stringify(EN.availability.saved)})`, 20_000).catch(() => {});
  const approvedDoctor = await db.prisma.doctorProfile.findUniqueOrThrow({ where: { userId: applicant.id } });
  const published = await db.prisma.availabilitySlot.count({ where: { doctorId: approvedDoctor.id, status: 'AVAILABLE', startAtUtc: { gt: new Date() } } });
  const activeRules = await db.prisma.availabilityRule.count({ where: { doctorId: approvedDoctor.id, isActive: true } });
  check('verified doctor saves a weekly schedule (all 7 days) and slots are published', (await page.hasText(EN.availability.saved)) && published > 0 && activeRules === 7, `slots=${published} rules=${activeRules}`);
  await page.waitFor(`document.querySelectorAll('ol li span.rounded-md').length > 0`, 15_000).catch(() => {});
  check('weekly calendar shows the published times', await page.eval(`return document.querySelectorAll('ol li span.rounded-md').length > 0;`));
  await page.snap('07-availability-weekly');

  await page.clickText('[role=tab]', EN.availability.tabBlocks);
  await page.waitFor(`document.querySelector('input[name=startDate]')`, 10_000);
  await page.clickText('button', EN.availability.addBlock);
  await page.waitFor(`document.body.innerText.includes(${JSON.stringify(EN.availability.upcomingBlocks)}) && document.querySelectorAll('ul[aria-label] li').length === 1`, 15_000).catch(() => {});
  const blocks = await db.prisma.blockedDate.count({ where: { doctorId: approvedDoctor.id } });
  check('doctor blocks a date', blocks === 1 && (await page.eval(`return document.querySelectorAll('ul[aria-label] li').length;`)) === 1, `blocks=${blocks}`);
  await page.snap('08-availability-blocks');
  await page.clickText('button', EN.availability.removeBlock);
  await page.waitFor(`document.body.innerText.includes(${JSON.stringify(EN.availability.noBlocks)})`, 15_000).catch(() => {});
  check('doctor removes the blocked date', (await db.prisma.blockedDate.count({ where: { doctorId: approvedDoctor.id } })) === 0 && (await page.hasText(EN.availability.noBlocks)));
  await page.viewport('mobile');
  await page.reload();
  await page.waitFor(`document.querySelector('[data-day="1"]')`, 15_000).catch(() => {});
  await page.snap('09-availability-mobile');
  check('availability page fits a phone screen (no horizontal scroll)', await page.eval('return document.documentElement.scrollWidth <= window.innerWidth;'));
  await page.viewport('desktop');

  const visitor = await browser.newPage();
  await visitor.goto(`${webOrigin}/doctors?lang=en`);
  await visitor.waitFor(`document.body.innerText.includes('Dr. Ayaan Warsame')`, 15_000).catch(() => {});
  check('public directory (no login) lists the verified doctor with the next available time', (await visitor.path()).startsWith('/doctors') && (await visitor.hasText('Dr. Ayaan Warsame')) && (await visitor.hasText('Next available:')));
  await visitor.snap('10-public-directory');
  await visitor.selectValue('select[name=language]', 'ar');
  await visitor.waitFor(`document.body.innerText.includes(${JSON.stringify(EN.doctors.emptyTitle)})`, 10_000).catch(() => {});
  check('directory language filter works', await visitor.hasText(EN.doctors.emptyTitle));
  await visitor.goto(`${webOrigin}/doctors/${approvedDoctor.id}?lang=en`);
  await visitor.waitFor(`document.querySelectorAll('[role=option]').length > 0`, 15_000).catch(() => {});
  const profileText = await visitor.eval('return document.body.innerText;');
  check('public profile shows real consultation times', (await visitor.eval(`return document.querySelectorAll('[role=option]').length;`)) > 0 && profileText.includes(EN.doctorProfile.availability));
  check('public profile never shows the licence or private documents', !profileText.includes('SMC-2020/1188') && !profileText.includes('licence.pdf') && !profileText.includes(applicantEmail));
  await visitor.clickText('[role=option]', await visitor.eval(`return document.querySelector('[role=option]').innerText.trim();`));
  await visitor.snap('11-doctor-profile');
  await visitor.viewport('mobile');
  await visitor.reload();
  await visitor.waitFor(`document.querySelectorAll('[role=option]').length > 0`, 15_000).catch(() => {});
  await visitor.snap('12-doctor-profile-mobile');
  check('public profile fits a phone screen (no horizontal scroll)', await visitor.eval('return document.documentElement.scrollWidth <= window.innerWidth;'));
  await visitor.goto(`${webOrigin}/doctors?lang=en`);
  await visitor.waitFor(`document.body.innerText.includes('Dr. Ayaan Warsame')`, 15_000).catch(() => {});
  await visitor.snap('13-public-directory-mobile');
  check('public directory fits a phone screen (no horizontal scroll)', await visitor.eval('return document.documentElement.scrollWidth <= window.innerWidth;'));
  check('no booking or payment was created by browsing', (await db.prisma.appointment.count()) === 0 && (await db.prisma.payment.count()) === 0);

  /* 14b. booking: a patient reserves a real slot → countdown → lists → doctor sees it → patient cancels */
  const bookerEmail = `booker-${Date.now()}@example.test`;
  const booker = await db.prisma.user.create({ data: { email: bookerEmail, fullName: 'Hawa Booker', passwordHash: await hashPassword(PASSWORD), roles: { create: [{ roleId: ctx.roles.PATIENT.id }] } } });
  await db.prisma.patientProfile.create({ data: { userId: booker.id } });
  const patientPage = await browser.newPage();
  await patientPage.viewport('desktop');
  await patientPage.goto(`${webOrigin}/login?lang=en`);
  await patientPage.type('input[name=identifier]', bookerEmail);
  await patientPage.type('input[name=password]', PASSWORD);
  await patientPage.click('form button[type=submit]');
  await patientPage.waitFor(`location.pathname === '/patient'`, 15_000);
  await patientPage.goto(`${webOrigin}/patient/doctors/${approvedDoctor.id}`);
  await patientPage.waitFor(`document.querySelectorAll('[role=option]').length > 0`, 15_000).catch(() => {});
  await patientPage.eval(`document.querySelector('[role=option]').click(); return true;`);
  await sleep(300);
  await patientPage.eval(`const b = [...document.querySelectorAll('button')].find(x => x.innerText.trim().startsWith(${JSON.stringify(EN.booking.confirm.split('{')[0].trim())})); b.click(); return true;`);
  await patientPage.waitFor(`location.pathname.startsWith('/patient/appointments/') && document.querySelector('[data-countdown]')`, 15_000).catch(() => {});
  const bookingId = (await patientPage.path()).split('/').pop();
  const reserved = await db.prisma.appointment.findUnique({ where: { id: bookingId } }).catch(() => null);
  const countdown = await patientPage.eval(`return document.querySelector('[data-countdown]')?.innerText ?? null;`);
  check('patient reserves a slot and sees the 10-minute payment countdown', reserved?.status === 'PENDING_PAYMENT' && /^(09|10):\d\d$/.test(countdown ?? ''), `${reserved?.status} ${countdown}`);
  check('reservation shows "Continue to payment"', await patientPage.hasText(EN.appointments.continueToPayment));
  await patientPage.snap('17-booking-reserved-countdown');
  await patientPage.goto(`${webOrigin}/patient/appointments`);
  await patientPage.waitFor(`document.querySelector('[data-appointment]')`, 10_000).catch(() => {});
  check('My Appointments lists the reservation under Upcoming', await patientPage.eval(`return !!document.querySelector('[data-appointment="${bookingId}"]');`));
  await patientPage.snap('18-patient-appointments');
  await page.goto(`${webOrigin}/doctor/appointments`);
  await page.waitFor(`document.querySelector('[data-appointment]')`, 10_000).catch(() => {});
  check('the doctor sees the booking in their Appointments', (await page.hasText('Hawa Booker')) && (await page.eval(`return !!document.querySelector('[data-appointment="${bookingId}"]');`)));
  await page.snap('19-doctor-appointments');
  await patientPage.goto(`${webOrigin}/patient/appointments/${bookingId}`);
  await patientPage.waitFor(`document.querySelector('[data-countdown]')`, 10_000).catch(() => {});
  await patientPage.clickText('button', EN.appointments.cancelHold);
  await patientPage.waitFor(`document.querySelector('[data-refund-preview]')`, 5000).catch(() => {});
  await patientPage.snap('20-cancel-dialog');
  await patientPage.clickText('[role=dialog] button', EN.appointments.confirmCancel);
  await patientPage.waitFor(`document.body.innerText.includes(${JSON.stringify(EN.apptStatus.CANCELLED)}) && !document.querySelector('[role=dialog]')`, 10_000).catch(() => {});
  const afterCancel = await db.prisma.appointment.findUnique({ where: { id: bookingId }, include: { slot: true } });
  check('patient cancels the reservation; the slot is offered again', afterCancel.status === 'CANCELLED' && afterCancel.slot.status === 'AVAILABLE', `${afterCancel.status}/${afterCancel.slot.status}`);
  await patientPage.viewport('mobile');
  await patientPage.reload();
  await patientPage.waitFor(`document.body.innerText.includes(${JSON.stringify(EN.apptStatus.CANCELLED)})`, 10_000).catch(() => {});
  await patientPage.snap('21-appointment-detail-mobile');
  check('appointment detail fits a phone screen', await patientPage.eval('return document.documentElement.scrollWidth <= window.innerWidth;'));

  /* 14c. simulated payment: failed attempt → retry → success → history → admin finance → refund */
  await patientPage.viewport('desktop');
  await patientPage.goto(`${webOrigin}/patient/doctors/${approvedDoctor.id}`);
  await patientPage.waitFor(`document.querySelectorAll('[role=option]').length > 0`, 15_000).catch(() => {});
  // The latest offered date (weeks ahead): the >24 h full-refund tier then applies whatever the time of day.
  await patientPage.eval(`const tabs = document.querySelectorAll('[role=tablist] [role=tab]'); tabs[tabs.length - 1]?.click(); return true;`);
  await sleep(300);
  await patientPage.eval(`document.querySelector('[role=option]').click(); return true;`);
  await sleep(300);
  await patientPage.eval(`const b = [...document.querySelectorAll('button')].find(x => x.innerText.trim().startsWith(${JSON.stringify(EN.booking.confirm.split('{')[0].trim())})); b.click(); return true;`);
  await patientPage.waitFor(`location.pathname.startsWith('/patient/appointments/') && document.querySelector('[data-countdown]')`, 15_000).catch(() => {});
  const paidId = (await patientPage.path()).split('/').pop();
  await patientPage.clickText('a', `${EN.appointments.continueToPayment}`);
  await patientPage.waitFor(`location.pathname.endsWith('/pay') && document.querySelector('[data-provider]')`, 10_000).catch(() => {});
  check('reservation opens the simulated checkout', (await patientPage.path()).endsWith(`/patient/appointments/${paidId}/pay`) && (await patientPage.hasText(EN.payments.demoBanner)));
  await patientPage.eval(`document.querySelector('[data-provider="ZAAD"]').click(); return true;`);
  await patientPage.type('input[name=wallet]', '+252610000001');
  await patientPage.snap('22-checkout');
  await patientPage.click('form button[type=submit]');
  await patientPage.waitFor(`document.querySelector('[data-outcome="FAILED"]')`, 15_000).catch(() => {});
  check('a failed simulated payment shows the failure and confirms nothing', (await patientPage.eval(`return !!document.querySelector('[data-outcome="FAILED"]');`)) && (await db.prisma.appointment.findUnique({ where: { id: paidId } })).status === 'PENDING_PAYMENT');
  await patientPage.snap('23-payment-failed');
  await patientPage.clickText('button', EN.payments.tryAgain);
  await patientPage.waitFor(`document.querySelector('input[name=wallet]')`, 5000).catch(() => {});
  await patientPage.type('input[name=wallet]', '+252615551234');
  await patientPage.click('form button[type=submit]');
  await patientPage.waitFor(`document.querySelector('[data-outcome="SUCCESS"]')`, 15_000).catch(() => {});
  const paidAppt = await db.prisma.appointment.findUnique({ where: { id: paidId }, include: { payment: { include: { attempts: true } } } });
  check('retry succeeds: appointment CONFIRMED, two attempts, ZAAD reference shown', paidAppt.status === 'CONFIRMED' && paidAppt.payment.attempts.length === 2 && /ZAAD-DEMO-/.test(await patientPage.eval(`return document.querySelector('[data-reference]')?.innerText ?? '';`)), `${paidAppt.status} attempts=${paidAppt.payment?.attempts.length}`);
  check('the receipt download button is offered', await patientPage.hasText(EN.payments.downloadReceipt));
  await patientPage.snap('24-payment-success');
  await patientPage.goto(`${webOrigin}/patient/payments`);
  await patientPage.waitFor(`document.querySelector('[data-payment]')`, 10_000).catch(() => {});
  check('payment history lists the payment with its receipt', (await patientPage.eval(`return !!document.querySelector('[data-payment="${paidAppt.payment.id}"]');`)) && (await patientPage.hasText(EN.payments.receipt)));
  await patientPage.snap('25-payment-history');

  await adminPage.viewport('desktop');
  await adminPage.goto(`${webOrigin}/admin/payments`);
  await adminPage.waitFor(`document.querySelector('[data-overview]')`, 10_000).catch(() => {});
  check('old /admin/payments link opens the finance overview with simulated totals', (await adminPage.path()).startsWith('/admin/finance') && (await adminPage.hasText(EN.finance.cards.gross)) && (await adminPage.hasText(EN.payments.demoBanner)));
  await adminPage.snap('26-admin-finance-overview');
  await adminPage.goto(`${webOrigin}/admin/finance/payments?preset=all`);
  await adminPage.waitFor(`document.querySelector('[data-payment-row="${paidAppt.payment.id}"]')`, 10_000).catch(() => {});
  await adminPage.eval(`document.querySelector('[data-payment-row="${paidAppt.payment.id}"]').click(); return true;`);
  await adminPage.waitFor(`document.body.innerText.includes(${JSON.stringify(EN.finance.ledgerType.PLATFORM_COMMISSION)})`, 10_000).catch(() => {});
  check('admin payment details show attempts, ledger and audit history', (await adminPage.hasText(EN.finance.ledgerType.PAYMENT)) && (await adminPage.hasText(EN.finance.audit)));
  await adminPage.snap('27-admin-payment-detail');

  await patientPage.goto(`${webOrigin}/patient/appointments/${paidId}`);
  await patientPage.waitFor(`document.body.innerText.includes(${JSON.stringify(EN.appointments.cancel)})`, 10_000).catch(() => {});
  await patientPage.clickText('button', EN.appointments.cancel);
  await patientPage.waitFor(`document.querySelector('[data-refund-preview]')`, 5000).catch(() => {});
  await patientPage.clickText('[role=dialog] button', EN.appointments.confirmCancel);
  await patientPage.waitFor(`!document.querySelector('[role=dialog]')`, 10_000).catch(() => {});
  const refundRow = await db.prisma.refund.findFirst({ where: { appointmentId: paidId } });
  check('cancelling the paid appointment requests a refund per the policy', !!refundRow && refundRow.status === 'REQUESTED', JSON.stringify(refundRow?.amount));
  await adminPage.goto(`${webOrigin}/admin/payments?tab=refunds`);
  await adminPage.waitFor(`document.querySelector('[data-refund="${refundRow?.id}"]')`, 10_000).catch(() => {});
  await adminPage.snap('28-admin-refunds');
  await adminPage.eval(`const b = document.querySelector('[data-refund="${refundRow?.id}"] [data-approve-refund]'); b?.click(); return !!b;`);
  await adminPage.waitFor(`document.querySelector('[data-confirm-approve]')`, 5000).catch(() => {});
  await adminPage.click('[data-confirm-approve]');
  await adminPage.waitFor(`!document.querySelector('[data-refund="${refundRow?.id}"]')`, 10_000).catch(() => {});
  const processed = await db.prisma.refund.findUnique({ where: { id: refundRow.id } });
  check('admin processes the refund through the simulator', processed.status === 'SUCCEEDED' && /^ZAADR-DEMO-/.test(processed.providerReference ?? ''), processed.status);

  /* 15. admin Doctors page: list with status and details, suspend with a required reason */
  await adminPage.viewport('desktop');
  await adminPage.goto(`${webOrigin}/admin/doctors`);
  await adminPage.waitFor(`document.body.innerText.includes('Dr. Ayaan Warsame')`, 15_000).catch(() => {});
  check('admin Doctors page lists the approved doctor with status and professional details', (await adminPage.hasText('Dr. Ayaan Warsame')) && (await adminPage.hasText(EN.appStatus.VERIFIED)) && (await adminPage.hasText('SMC-2020/1188')));
  await adminPage.snap('14-admin-doctors');
  await adminPage.eval(`const b = document.querySelector('[data-doctor="${approvedDoctor.id}"] button[aria-label]'); b.click(); return true;`);
  await adminPage.waitFor(`document.querySelector('#suspend-reason')`, 5000);
  await adminPage.clickText('[role=dialog] button', EN.adminDoctors.confirmSuspend);
  await sleep(300);
  check('suspension without a reason is refused in the dialog', (await adminPage.hasText(EN.adminDoctors.errors.reasonShort)) && (await db.prisma.doctorProfile.findUniqueOrThrow({ where: { id: approvedDoctor.id } })).accountStatus === 'ACTIVE');
  await adminPage.type('#suspend-reason', 'Licence under investigation by the medical council.');
  await adminPage.snap('15-admin-suspend-dialog');
  await adminPage.clickText('[role=dialog] button', EN.adminDoctors.confirmSuspend);
  await adminPage.waitFor(`!document.querySelector('[role=dialog]')`, 15_000).catch(() => {});
  const suspendedNow = await db.prisma.doctorProfile.findUniqueOrThrow({ where: { id: approvedDoctor.id } });
  const suspendAudit = await db.prisma.auditLog.count({ where: { action: 'SUSPEND', entityId: approvedDoctor.id } });
  check('admin suspends the doctor with a reason; it is audited', suspendedNow.accountStatus === 'SUSPENDED' && suspendAudit === 1, `${suspendedNow.accountStatus} audit=${suspendAudit}`);
  await adminPage.clickText('[role=tab]', EN.adminDoctors.tabs.suspended.replace('{count}', '1'));
  await adminPage.waitFor(`document.body.innerText.includes('Licence under investigation by the medical council.')`, 10_000).catch(() => {});
  check('suspended tab shows the doctor with the reason', await adminPage.hasText('Licence under investigation by the medical council.'));
  await adminPage.snap('16-admin-doctors-suspended');
  await visitor.viewport('desktop');
  await visitor.goto(`${webOrigin}/doctors?lang=en`);
  await visitor.waitFor(`document.body.innerText.includes(${JSON.stringify(EN.doctors.resultCount.split('{')[0].trim() || 'doctors')})`, 10_000).catch(() => {});
  check('suspended doctor disappears from the public directory', !(await visitor.hasText('Dr. Ayaan Warsame')));

  /* 16. Google sign-in (fake Google): new patient, email collision, cancel, connect/disconnect, admin */
  const googleBtn = `button[aria-label=${JSON.stringify(EN.googleAuth.continue)}]`;
  const gPage = await browser.newPage();
  await gPage.viewport('desktop');
  const gSub = `e2e-sub-${Date.now()}`;
  const gEmail = `amina.google.${Date.now()}@gmail.test`;
  fakeGoogle.next({ profile: { sub: gSub, email: gEmail, name: 'Amina Google' } });
  await gPage.goto(`${webOrigin}/login?lang=en`);
  await gPage.click(googleBtn);
  await gPage.waitFor(`location.pathname === '/patient'`, 20_000).catch(() => {});
  const gUser = await db.prisma.user.findUnique({ where: { email: gEmail }, include: { roles: { include: { role: true } }, identities: true } });
  check('Google sign-in creates a PATIENT-only account and lands on the patient dashboard', (await gPage.path()) === '/patient' && gUser?.roles.map((r) => r.role.name).join() === 'PATIENT' && gUser.passwordHash === null && gUser.identities[0]?.providerSubject === gSub, await gPage.path());
  const gCookies = await gPage.cookies();
  check('session arrives only as the HttpOnly refresh cookie; the one-time OAuth cookie is gone', gCookies.some((c) => c.name === 'fd_refresh' && c.httpOnly && c.sameSite === 'Strict') && !(await gPage.send('Network.getCookies', { urls: [`${webOrigin}/api/v1/auth/google/callback`] })).cookies.some((c) => c.name === 'fd_oauth'));
  check('no token in the address bar or browser storage', !(await gPage.eval(`return /token|code=/i.test(location.href) || Object.keys(localStorage).some(k => /token/i.test(k + localStorage.getItem(k)));`)));
  await gPage.snap('29-google-signin-dashboard');
  await gPage.reload();
  await gPage.waitFor(`location.pathname === '/patient' && document.querySelector('header')`, 15_000).catch(() => {});
  check('Google session survives a reload (normal refresh rotation)', (await gPage.path()) === '/patient');
  await gPage.goto(`${webOrigin}/account/security`);
  await gPage.waitFor(`document.querySelector('[data-method="google"]')`, 10_000).catch(() => {});
  check('Account security (Google-only): password not set, Google connected, no Disconnect', (await gPage.hasText(EN.accountSecurity.password.notSet)) && (await gPage.hasText(gEmail)) && (await gPage.hasText(EN.accountSecurity.google.onlyMethod)) && !(await gPage.eval(`return [...document.querySelectorAll('[data-method="google"] button')].length > 0;`)));
  await gPage.snap('30-account-security-google-only');

  // An existing password account's email: refused, never linked automatically.
  const gVisitor = await browser.newPage();
  await gVisitor.viewport('desktop');
  fakeGoogle.next({ profile: { sub: `e2e-other-${Date.now()}`, email: bookerEmail } });
  await gVisitor.goto(`${webOrigin}/login?lang=en`);
  await gVisitor.click(googleBtn);
  await gVisitor.waitFor(`document.querySelector('[data-google-error]')`, 20_000).catch(() => {});
  check('email collision: back on login with clear instructions, nothing linked', (await gVisitor.eval(`return document.querySelector('[data-google-error]')?.dataset.googleError;`)) === 'GOOGLE_EMAIL_EXISTS' && (await gVisitor.hasText(EN.googleAuth.errors.GOOGLE_EMAIL_EXISTS)) && (await db.prisma.userIdentity.count({ where: { user: { email: bookerEmail } } })) === 0);
  await gVisitor.snap('31-google-email-exists');
  await gVisitor.goto(`${webOrigin}/login?lang=so&authError=GOOGLE_EMAIL_EXISTS`);
  await gVisitor.waitFor(`document.querySelector('[data-google-error]')`, 10_000).catch(() => {});
  check('Somali message for the email collision', await gVisitor.hasText(SO.googleAuth.errors.GOOGLE_EMAIL_EXISTS));
  await gVisitor.snap('32-google-email-exists-so');
  fakeGoogle.next({ deny: true });
  await gVisitor.goto(`${webOrigin}/login?lang=en`);
  await gVisitor.click(googleBtn);
  await gVisitor.waitFor(`document.querySelector('[data-google-error="GOOGLE_CANCELLED"]')`, 20_000).catch(() => {});
  check('cancelling at Google shows the cancelled message', await gVisitor.hasText(EN.googleAuth.errors.GOOGLE_CANCELLED));

  // A signed-in password user connects Google from Sign-in & security (via the profile menu), then disconnects.
  await patientPage.viewport('desktop');
  await patientPage.goto(`${webOrigin}/patient`);
  await patientPage.openProfileMenu();
  await patientPage.clickText('header button', EN.accountSecurity.menu);
  await patientPage.waitFor(`location.pathname === '/account/security' && document.querySelector('[data-method="google"]')`, 10_000).catch(() => {});
  check('profile menu opens Sign-in & security', (await patientPage.path()) === '/account/security');
  const linkSub = `e2e-link-${Date.now()}`;
  fakeGoogle.next({ profile: { sub: linkSub, email: `hawa.${Date.now()}@gmail.test` } });
  await patientPage.clickText('[data-method="google"] button', EN.accountSecurity.google.connect);
  await patientPage.waitFor(`location.pathname === '/account/security' && document.body.innerText.includes(${JSON.stringify(EN.accountSecurity.google.disconnect)})`, 20_000).catch(() => {});
  const linked = await db.prisma.userIdentity.findFirst({ where: { providerSubject: linkSub }, include: { user: true } });
  check('Connect Google links the identity to the signed-in account', linked?.user.email === bookerEmail && !(await patientPage.eval(`return location.search.includes('google');`)));
  check('the "connected" confirmation is shown once', (await patientPage.eval(`return document.body.innerText.split(${JSON.stringify(EN.accountSecurity.google.connectedToast)}).length - 1;`)) === 1);
  await patientPage.snap('33-account-security-connected');
  await patientPage.clickText('[data-method="google"] button', EN.accountSecurity.google.disconnect);
  await patientPage.waitFor(`document.querySelector('[role=dialog]')`, 5000).catch(() => {});
  await patientPage.snap('34-disconnect-google-dialog');
  await patientPage.clickText('[role=dialog] button', EN.accountSecurity.google.disconnect);
  await patientPage.waitFor(`!document.querySelector('[role=dialog]') && document.body.innerText.includes(${JSON.stringify(EN.accountSecurity.google.connect)})`, 10_000).catch(() => {});
  check('Disconnect removes the identity (a password remains)', (await db.prisma.userIdentity.count({ where: { providerSubject: linkSub } })) === 0);
  await patientPage.viewport('mobile');
  await patientPage.reload();
  await patientPage.waitFor(`document.querySelector('[data-method="google"]')`, 10_000).catch(() => {});
  check('Account security fits a phone screen', await patientPage.eval(`return document.documentElement.scrollWidth <= window.innerWidth + 1;`));
  await patientPage.snap('35-account-security-mobile');
  await patientPage.viewport('desktop');

  await adminPage.goto(`${webOrigin}/account/security`);
  await adminPage.waitFor(`document.querySelector('[data-method="google"]')`, 10_000).catch(() => {});
  check('administrators are password-only: no Connect Google', (await adminPage.hasText(EN.accountSecurity.google.adminOnly)) && !(await adminPage.hasText(EN.accountSecurity.google.connect)));
  await adminPage.snap('36-account-security-admin');

  /* 17. notifications: bell + live badge, dropdown, notification center, read/unread/delete, settings, Somali, mobile */
  const { notify } = await import('../../apps/api/src/modules/notifications/notification.service.js');
  const bookerUser = await db.prisma.user.findUniqueOrThrow({ where: { email: bookerEmail } });
  await patientPage.viewport('desktop');
  await patientPage.goto(`${webOrigin}/patient?lang=en`);
  await patientPage.waitFor(`[...document.querySelectorAll('[data-notification-bell]')].some(b => b.offsetParent)`, 15_000).catch(() => {});
  const badge = () => patientPage.eval(`const b = [...document.querySelectorAll('[data-unread-badge]')].find(e => e.offsetParent); return b ? Number(b.dataset.unreadBadge) : 0;`);
  const unreadInDb = await db.prisma.notification.count({ where: { userId: bookerUser.id, readAt: null } });
  await patientPage.waitFor(`[...document.querySelectorAll('[data-unread-badge]')].some(e => e.offsetParent)`, 10_000).catch(() => {});
  check('bell shows the real unread count from booking/payment/refund events', unreadInDb > 0 && (await badge()) === unreadInDb, `${await badge()} vs ${unreadInDb}`);
  await notify(db.prisma, { kind: 'refund.completed', recipients: [{ userId: bookerUser.id, role: 'PATIENT' }], params: { refundId: 'e2e', amount: '12.50' }, eventKey: `e2e.live:${Date.now()}` });
  await patientPage.waitFor(`[...document.querySelectorAll('[data-unread-badge]')].some(e => e.offsetParent && Number(e.dataset.unreadBadge) === ${unreadInDb + 1})`, 15_000).catch(() => {});
  check('real-time: a new notification updates the badge without reloading', (await badge()) === unreadInDb + 1);
  await patientPage.click('[data-notification-bell]');
  await patientPage.waitFor(`document.querySelector('[data-notification]')`, 5000).catch(() => {});
  check('dropdown lists the newest notification first', await patientPage.eval(`return document.querySelector('[role=dialog] [data-notification]')?.innerText.includes('Refund completed');`));
  await patientPage.snap('37-notification-dropdown');
  await patientPage.clickText('[role=dialog] button', EN.notifications.viewAll);
  await patientPage.waitFor(`location.pathname === '/account/notifications' && document.querySelector('[data-notification-list]')`, 10_000).catch(() => {});
  check('notification center lists the history', (await patientPage.path()) === '/account/notifications' && (await patientPage.eval(`return document.querySelectorAll('[data-notification-list] [data-notification]').length;`)) >= unreadInDb);
  await patientPage.snap('38-notification-center');
  const firstId = await patientPage.eval(`return document.querySelector('[data-notification-list] [data-notification]').dataset.notification;`);
  await patientPage.eval(`document.querySelector('[data-notification="${firstId}"] button[aria-label=${JSON.stringify(EN.notifications.markRead)}]').click(); return true;`);
  await patientPage.waitFor(`document.querySelector('[data-notification="${firstId}"]').dataset.read === 'true'`, 5000).catch(() => {});
  check('mark as read', (await db.prisma.notification.findUnique({ where: { id: firstId } })).readAt !== null);
  await patientPage.eval(`document.querySelector('[data-notification="${firstId}"] button[aria-label=${JSON.stringify(EN.notifications.markUnread)}]').click(); return true;`);
  await patientPage.waitFor(`document.querySelector('[data-notification="${firstId}"]').dataset.read === 'false'`, 5000).catch(() => {});
  check('mark as unread', (await db.prisma.notification.findUnique({ where: { id: firstId } })).readAt === null);
  await patientPage.eval(`document.querySelector('[data-notification="${firstId}"] button[aria-label=${JSON.stringify(EN.notifications.delete)}]').click(); return true;`);
  await patientPage.waitFor(`!document.querySelector('[data-notification="${firstId}"]')`, 5000).catch(() => {});
  check('delete removes the notification', (await db.prisma.notification.count({ where: { id: firstId } })) === 0);
  await patientPage.clickText('button', EN.notifications.markAllRead);
  await patientPage.waitFor(`![...document.querySelectorAll('[data-unread-badge]')].some(e => e.offsetParent)`, 5000).catch(() => {});
  check('mark all as read clears the badge', (await badge()) === 0 && (await db.prisma.notification.count({ where: { userId: bookerUser.id, readAt: null } })) === 0);
  check('settings: essentials always on, reminders on, push offered on this device', (await patientPage.hasText(EN.notifications.settings.alwaysOn)) && (await patientPage.eval(`return !!document.querySelector('[data-setting="reminders"] [role=switch][aria-checked=true]');`)) && (await patientPage.hasText(EN.notifications.settings.pushTitle)));
  await patientPage.eval(`document.querySelector('[data-setting="reminders"] [role=switch]').click(); return true;`);
  await patientPage.waitFor(`document.querySelector('[data-setting="reminders"] [role=switch][aria-checked=false]')`, 5000).catch(() => {});
  check('turning reminders off is saved', (await db.prisma.notificationPreference.findUnique({ where: { userId: bookerUser.id } }))?.remindersEnabled === false);
  await patientPage.eval(`document.querySelector('[data-setting="reminders"] [role=switch]').click(); return true;`);
  await patientPage.snap('39-notification-settings');
  await patientPage.goto(`${webOrigin}/account/notifications?lang=so`);
  await patientPage.waitFor(`document.querySelector('[data-notification-list]')`, 10_000).catch(() => {});
  check('Somali: page and notification text are translated', (await patientPage.hasText(SO.notifications.title)) && (await patientPage.hasText('Lacag-celinta waa dhammaatay')));
  await patientPage.snap('40-notification-center-so');
  await patientPage.viewport('mobile');
  await patientPage.goto(`${webOrigin}/account/notifications?lang=en`);
  await patientPage.waitFor(`document.querySelector('[data-notification-list]')`, 10_000).catch(() => {});
  check('notification center fits a phone screen', await patientPage.eval(`return document.documentElement.scrollWidth <= window.innerWidth + 1;`));
  await patientPage.snap('41-notification-center-mobile');
  await patientPage.viewport('desktop');

  await adminPage.goto(`${webOrigin}/admin?lang=en`);
  await adminPage.waitFor(`[...document.querySelectorAll('[data-notification-bell]')].some(b => b.offsetParent)`, 15_000).catch(() => {});
  await adminPage.click('[data-notification-bell]');
  await adminPage.waitFor(`document.querySelector('[role=dialog] [data-notification]')`, 8000).catch(() => {});
  check('admin bell shows administrative notifications (applications, refunds)', await adminPage.eval(`return [...document.querySelectorAll('[role=dialog] [data-notification]')].some(e => /doctor application|Refund/i.test(e.innerText));`));
  await adminPage.snap('42-admin-notifications');

  /* 18. video consultation: join window → waiting room → admit → real WebRTC media both ways → controls → leave/rejoin → end */
  async function videoBooking(doctorName, patientUser) {
    const email = `video-dr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.test`;
    const user = await db.prisma.user.create({ data: { email, fullName: doctorName, passwordHash: await hashPassword(PASSWORD), roles: { create: [{ roleId: ctx.roles.DOCTOR.id }] } } });
    const doctor = await db.prisma.doctorProfile.create({ data: { userId: user.id, specialtyId: ctx.specialty.id, licenceNumber: `E2E-V-${Date.now()}`, licenceCountry: 'Somalia', consultationFee: '20.00', verificationStatus: 'VERIFIED', verifiedAt: new Date() } });
    const patient = await db.prisma.patientProfile.findUniqueOrThrow({ where: { userId: patientUser.id } });
    const startAtUtc = new Date(Date.now() - 2 * 60_000);
    const endAtUtc = new Date(startAtUtc.getTime() + 30 * 60_000);
    const slot = await db.prisma.availabilitySlot.create({ data: { doctorId: doctor.id, startAtUtc, endAtUtc, timeZoneSnapshot: 'Africa/Mogadishu', status: 'BOOKED' } });
    const appointment = await db.prisma.appointment.create({ data: { patientId: patient.id, doctorId: doctor.id, slotId: slot.id, status: 'CONFIRMED', feeAmount: '20.00', commissionRateSnapshot: '0.1500', startAtUtc, endAtUtc } });
    await db.prisma.payment.create({ data: { appointmentId: appointment.id, patientId: patient.id, provider: 'EVC_PLUS', amount: '20.00', status: 'SUCCEEDED', paidAt: new Date() } });
    return { email, appointment };
  }
  const videoPlaying = (page) => page.eval(`const v = document.querySelector('[data-remote-video=on]'); return Boolean(v && v.readyState >= 2 && v.videoWidth > 0);`);
  const vBooker = await db.prisma.user.findUniqueOrThrow({ where: { email: bookerEmail } });
  const v1 = await videoBooking('Dr. Faisal Video', vBooker);

  await patientPage.viewport('desktop');
  await patientPage.goto(`${webOrigin}/patient/appointments/${v1.appointment.id}?lang=en`);
  await patientPage.waitFor(`document.querySelector('[data-join-consultation]')`, 15_000).catch(() => {});
  check('appointment page offers "Join consultation" inside the join window', await patientPage.eval(`return Boolean([...document.querySelectorAll('[data-join-consultation]')].find(e => e.offsetParent));`));
  await patientPage.click('[data-join-consultation]');
  await patientPage.waitFor(`location.pathname === '/consultation/${v1.appointment.id}' && document.querySelector('[data-join]') && !document.querySelector('[data-join]').disabled`, 15_000).catch(() => {});
  check('consultation page opens on a pre-join screen (camera not started yet)', (await patientPage.eval(`return document.querySelector('[data-stage=prejoin]') !== null && [...document.querySelectorAll('video')].every(v => !v.srcObject);`)));
  await patientPage.snap('43-consult-prejoin');

  // Permission denied: understandable message, nothing joined.
  await patientPage.eval(`window.__realGum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices); navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError')); return true;`);
  await patientPage.click('[data-join]');
  await patientPage.waitFor(`document.querySelector('[data-media-issue=DENIED]')`, 10_000).catch(() => {});
  check('camera/microphone permission denied shows a clear message and does not join', (await patientPage.hasText(EN.consult.media.denied)) && (await db.prisma.consultation.count({ where: { appointmentId: v1.appointment.id } })) === 0);
  await patientPage.snap('44-consult-permission-denied');
  await patientPage.eval(`navigator.mediaDevices.getUserMedia = window.__realGum; return true;`);

  await patientPage.click('[data-join]');
  await patientPage.waitFor(`document.querySelector('[data-admission=WAITING]') && document.querySelector('[data-stage=waiting]')`, 20_000).catch(() => {});
  check('patient enters the waiting room with a live self-view', (await patientPage.hasText(EN.consult.waiting.title.replace('{name}', 'Dr. Faisal Video'))) && (await patientPage.eval(`const v = document.querySelector('[data-self-view] video'); return Boolean(v && v.srcObject && v.srcObject.getVideoTracks().length);`)));
  await patientPage.snap('45-consult-patient-waiting');

  const doctorVideoPage = await browser.newPage();
  await doctorVideoPage.goto(`${webOrigin}/login?lang=en`);
  await doctorVideoPage.type('input[name=identifier]', v1.email);
  await doctorVideoPage.type('input[name=password]', PASSWORD);
  await doctorVideoPage.click('form button[type=submit]');
  await doctorVideoPage.waitFor(`location.pathname === '/doctor'`, 15_000).catch(() => {});
  await doctorVideoPage.goto(`${webOrigin}/doctor/appointments/${v1.appointment.id}?lang=en`);
  await doctorVideoPage.waitFor(`document.querySelector('[data-join-consultation]')`, 15_000).catch(() => {});
  await doctorVideoPage.click('[data-join-consultation]');
  await doctorVideoPage.waitFor(`document.querySelector('[data-join]') && !document.querySelector('[data-join]').disabled`, 15_000).catch(() => {});
  await doctorVideoPage.click('[data-join]');
  await doctorVideoPage.waitFor(`document.querySelector('[data-admit]')`, 20_000).catch(() => {});
  check('doctor sees the waiting patient with Admit / Not now', (await doctorVideoPage.hasText(EN.consult.lobby.patientWaiting.replace('{name}', 'Hawa Booker'))) && (await doctorVideoPage.eval(`return Boolean(document.querySelector('[data-reject]'));`)));
  await doctorVideoPage.snap('46-consult-doctor-admit');

  await doctorVideoPage.click('[data-admit]');
  await Promise.all([patientPage, doctorVideoPage].map((pg) => pg.waitFor(`document.querySelector('[data-admission=IN_CALL]')`, 20_000).catch(() => {})));
  const t0 = Date.now();
  await Promise.all([patientPage, doctorVideoPage].map((pg) => pg.waitFor(`(() => { const v = document.querySelector('[data-remote-video=on]'); return v && v.readyState >= 2 && v.videoWidth > 0; })()`, 45_000).catch(() => {})));
  const bothVideo = (await videoPlaying(patientPage)) && (await videoPlaying(doctorVideoPage));
  check('after admission both sides receive real WebRTC video (Chrome fake camera, peer-to-peer over localhost)', bothVideo, `waited ${Date.now() - t0} ms`);
  check('ICE connection is established', await doctorVideoPage.eval(`return ['connected','completed'].includes(document.querySelector('[data-connection]')?.dataset.connection);`));
  await sleep(1500);
  check('call clock runs from the server start time', /^\d{2}:\d{2}/.test(await doctorVideoPage.eval(`return document.querySelector('[data-call-clock]').innerText;`)));
  const live = await db.prisma.consultation.findUniqueOrThrow({ where: { appointmentId: v1.appointment.id } });
  check('server recorded admission and start', live.status === 'IN_PROGRESS' && live.startedAt && live.admittedAt);
  await patientPage.snap('47-consult-in-call-patient');
  await doctorVideoPage.snap('48-consult-in-call-doctor');

  // Mic and camera controls reach the other side.
  await patientPage.click(`[aria-label=${JSON.stringify(EN.consult.controls.micOff)}]`);
  await doctorVideoPage.waitFor(`document.body.innerText.includes(${JSON.stringify(EN.consult.remoteMuted.replace('{name}', 'Hawa Booker'))})`, 10_000).catch(() => {});
  check('mute: the doctor sees that the patient is muted; the patient sees "You are muted"', (await doctorVideoPage.hasText(EN.consult.remoteMuted.replace('{name}', 'Hawa Booker'))) && (await patientPage.hasText(EN.consult.muted)));
  await patientPage.click(`[aria-label=${JSON.stringify(EN.consult.controls.cameraOff)}]`);
  await doctorVideoPage.waitFor(`document.querySelector('[data-remote-video=off]')`, 10_000).catch(() => {});
  check('camera off: the doctor sees the patient avatar instead of video', await doctorVideoPage.eval(`return Boolean(document.querySelector('[data-remote-video=off]'));`));
  await doctorVideoPage.snap('49-consult-remote-camera-off');
  await patientPage.click(`[aria-label=${JSON.stringify(EN.consult.controls.cameraOn)}]`);
  await patientPage.click(`[aria-label=${JSON.stringify(EN.consult.controls.micOn)}]`);
  await doctorVideoPage.waitFor(`document.querySelector('[data-remote-video=on]')`, 10_000).catch(() => {});
  check('camera back on: video resumes', await doctorVideoPage.eval(`return Boolean(document.querySelector('[data-remote-video=on]'));`));

  // Mobile + dark mode keep the layout.
  await patientPage.viewport('mobile');
  await sleep(800);
  check('consultation fits a phone screen (no horizontal scroll)', await patientPage.eval(`return document.documentElement.scrollWidth <= window.innerWidth + 1;`));
  await patientPage.snap('50-consult-in-call-mobile');
  await patientPage.viewport('desktop');
  await doctorVideoPage.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await sleep(600);
  await doctorVideoPage.snap('51-consult-in-call-doctor-dark');
  await doctorVideoPage.send('Emulation.setEmulatedMedia', { features: [] });

  // Patient leaves (not an end) and rejoins straight into the call.
  await patientPage.click('[data-hangup=leave]');
  await patientPage.waitFor(`document.querySelector('[data-stage=left]')`, 10_000).catch(() => {});
  await doctorVideoPage.waitFor(`document.querySelector('[data-stage=peer-away]')`, 10_000).catch(() => {});
  check('patient leave: patient sees Rejoin; doctor sees the patient has left; the call is not ended', (await patientPage.hasText(EN.consult.rejoin)) && (await doctorVideoPage.eval(`return Boolean(document.querySelector('[data-stage=peer-away]'));`)) && (await db.prisma.consultation.findUniqueOrThrow({ where: { id: live.id } })).status === 'IN_PROGRESS');
  await patientPage.clickText('button', EN.consult.rejoin);
  await Promise.all([patientPage, doctorVideoPage].map((pg) => pg.waitFor(`(() => { const v = document.querySelector('[data-remote-video=on]'); return v && v.readyState >= 2 && v.videoWidth > 0; })()`, 45_000).catch(() => {})));
  check('rejoin goes straight back into the call with video both ways', (await videoPlaying(patientPage)) && (await videoPlaying(doctorVideoPage)));

  // Doctor ends (two-step confirm) → both see the end; server stores duration and who ended.
  await doctorVideoPage.click('[data-hangup=end]');
  await doctorVideoPage.waitFor(`document.body.innerText.includes(${JSON.stringify(EN.consult.confirmEnd)})`, 5000).catch(() => {});
  await doctorVideoPage.click('[data-hangup=end]');
  await Promise.all([patientPage, doctorVideoPage].map((pg) => pg.waitFor(`document.querySelector('[data-stage=ended] [data-duration]')`, 20_000).catch(() => {})));
  const ended = await db.prisma.consultation.findUniqueOrThrow({ where: { id: live.id } });
  const endedAppt = await db.prisma.appointment.findUniqueOrThrow({ where: { id: v1.appointment.id } });
  check('doctor ends: both see "Consultation ended"; consultation COMPLETED with server duration, ended by the doctor', (await patientPage.eval(`return Boolean(document.querySelector('[data-stage=ended] [data-duration]'));`)) && (await doctorVideoPage.eval(`return Boolean(document.querySelector('[data-stage=ended] [data-duration]'));`)) && ended.status === 'COMPLETED' && ended.endedBy === 'DOCTOR' && ended.durationSeconds >= 1 && endedAppt.status === 'COMPLETED', `${ended.status} ${ended.durationSeconds}`);
  check('camera and microphone are released after the call', await patientPage.eval(`return [...document.querySelectorAll('video')].every(v => !v.srcObject || v.srcObject.getTracks().every(t => t.readyState === 'ended'));`));
  await patientPage.snap('52-consult-ended-patient');
  const vEvents = (await db.prisma.consultationEvent.findMany({ where: { consultationId: live.id } })).map((e) => e.eventType);
  check('lifecycle events recorded (joined, admitted, started, left, ended)', ['PATIENT_JOINED', 'DOCTOR_JOINED', 'DOCTOR_ADMITTED', 'CALL_STARTED', 'PATIENT_LEFT', 'CALL_ENDED'].every((e) => vEvents.includes(e)), vEvents.join(','));

  // Connection failure is explained (simulated: relay-only ICE with no TURN server = no possible path).
  const v2 = await videoBooking('Dr. Nimco Relay', vBooker);
  await patientPage.goto(`${webOrigin}/consultation/${v2.appointment.id}?lang=en`);
  await patientPage.waitFor(`document.querySelector('[data-join]') && !document.querySelector('[data-join]').disabled`, 15_000).catch(() => {});
  await patientPage.eval(`const R = window.RTCPeerConnection; window.RTCPeerConnection = class extends R { constructor(c) { super({ ...(c || {}), iceTransportPolicy: 'relay' }); } }; return true;`);
  await patientPage.click('[data-join]');
  const doctor2 = await browser.newPage();
  await doctor2.goto(`${webOrigin}/login?lang=en`);
  await doctor2.type('input[name=identifier]', v2.email);
  await doctor2.type('input[name=password]', PASSWORD);
  await doctor2.click('form button[type=submit]');
  await doctor2.waitFor(`location.pathname === '/doctor'`, 15_000).catch(() => {});
  await doctor2.goto(`${webOrigin}/consultation/${v2.appointment.id}?lang=en`);
  await doctor2.waitFor(`document.querySelector('[data-join]') && !document.querySelector('[data-join]').disabled`, 15_000).catch(() => {});
  await doctor2.eval(`const R = window.RTCPeerConnection; window.RTCPeerConnection = class extends R { constructor(c) { super({ ...(c || {}), iceTransportPolicy: 'relay' }); } }; return true;`);
  await doctor2.click('[data-join]');
  await doctor2.waitFor(`document.querySelector('[data-admit]')`, 20_000).catch(() => {});
  await doctor2.click('[data-admit]');
  await patientPage.waitFor(`document.querySelector('[data-stage=failed]')`, 60_000).catch(() => {});
  check('when no network path exists, the user is told and offered Try again / Audio only', (await patientPage.hasText(EN.consult.failed.title)) && (await patientPage.hasText(EN.consult.failed.retry)) && (await patientPage.hasText(EN.consult.failed.audioOnly)));
  await patientPage.snap('53-consult-connection-failed');
  await patientPage.viewport('mobile');
  await patientPage.snap('54-consult-connection-failed-mobile');
  await patientPage.viewport('desktop');
  await patientPage.goto(`${webOrigin}/consultation/${v2.appointment.id}?lang=so`);
  await patientPage.waitFor(`document.querySelector('[data-stage=prejoin]')`, 15_000).catch(() => {});
  check('Somali: the consultation screen is translated', await patientPage.hasText(SO.consult.prejoin.join));
  await patientPage.snap('55-consult-prejoin-so');

  /* 19. admin finance: overview, payments search/filter/detail, refund approve + reject, commission, earnings, reports, CSV, mobile, dark, Somali */
  const { requestRefund } = await import('../../apps/api/src/modules/refunds/refund.service.js');
  const fb1 = await videoBooking('Dr. Ifrah Finance', vBooker);
  const fb2 = await videoBooking('Dr. Ifrah Finance Two', vBooker);
  const toReject = await requestRefund({ appointmentId: fb1.appointment.id, reason: 'Patient cancelled more than 24 hours before (policy: 100%)', amount: '20.00' });
  const toApprove = await requestRefund({ appointmentId: fb2.appointment.id, reason: 'Doctor cancelled (policy: full refund)', amount: '20.00' });

  await adminPage.viewport('desktop');
  await adminPage.goto(`${webOrigin}/admin/finance?lang=en&preset=30d`);
  await adminPage.waitFor(`document.querySelector('[data-overview]')`, 15_000).catch(() => {});
  const ov = await adminPage.eval(`return document.querySelector('[data-overview]')?.innerText ?? '';`);
  check('finance overview shows gross volume, refunds, platform and doctor earnings from real records', [EN.finance.cards.gross, EN.finance.cards.refunds, EN.finance.cards.platform, EN.finance.cards.doctors, EN.finance.cards.pending, EN.finance.cards.failed].every((x) => ov.includes(x)) && !/\$0\.00\s*\n\s*Refunds paid/.test(ov));
  check('admin sidebar has every finance entry', await adminPage.eval(`return ['/admin/finance','/admin/finance/payments','/admin/finance/refunds','/admin/finance/doctor-earnings','/admin/finance/reports','/admin/finance/settings'].every(h => document.querySelector('aside a[href="' + h + '"]'));`));
  await adminPage.snap('56-finance-overview');

  await adminPage.goto(`${webOrigin}/admin/finance/payments?preset=all&lang=en`);
  await adminPage.waitFor(`document.querySelector('[data-payment-row]')`, 15_000).catch(() => {});
  await adminPage.type('input[name=q]', 'Hawa Booker');
  await adminPage.waitFor(`[...document.querySelectorAll('[data-payment-row]')].length > 0 && [...document.querySelectorAll('[data-payment-row]')].every(r => r.innerText.includes('Hawa Booker'))`, 10_000).catch(() => {});
  check('payments: search by patient', await adminPage.eval(`const rows = [...document.querySelectorAll('[data-payment-row]')]; return rows.length > 0 && rows.every(r => r.innerText.includes('Hawa Booker'));`));
  await adminPage.selectValue('select[name=status]', 'FAILED');
  await adminPage.waitFor(`![...document.querySelectorAll('[data-payment-row]')].some(r => r.innerText.includes(${JSON.stringify(EN.paymentStatus.SUCCEEDED)}))`, 10_000).catch(() => {});
  check('payments: status filter', await adminPage.eval(`return ![...document.querySelectorAll('[data-payment-row]')].some(r => r.innerText.includes(${JSON.stringify(EN.paymentStatus.SUCCEEDED)}));`));
  await adminPage.selectValue('select[name=status]', '');
  await adminPage.waitFor(`document.querySelector('[data-payment-row="${paidAppt.payment.id}"]')`, 10_000).catch(() => {});
  await adminPage.click(`[data-payment-row="${paidAppt.payment.id}"]`);
  await adminPage.waitFor(`document.querySelector('[data-allocation]')`, 10_000).catch(() => {});
  check('payment details show the commission split saved at payment, appointment and ledger', (await adminPage.hasText(EN.finance.allocation.title)) && (await adminPage.hasText(EN.finance.allocation.rate)) && (await adminPage.hasText(EN.finance.ledgerType.PAYMENT)));
  await adminPage.snap('57-finance-payment-detail');
  await adminPage.eval(`document.querySelector('[data-payment-detail]').parentElement.querySelector('button[aria-label]')?.click(); return true;`);

  await adminPage.goto(`${webOrigin}/admin/finance/refunds?lang=en`);
  await adminPage.waitFor(`document.querySelector('[data-refund="${toReject.id}"]')`, 15_000).catch(() => {});
  await adminPage.click(`[data-refund="${toReject.id}"] [data-reject-refund]`);
  await adminPage.waitFor(`document.querySelector('[data-confirm-reject]')`, 5000).catch(() => {});
  await adminPage.click('[data-confirm-reject]');
  await sleep(300);
  check('rejecting without a reason is refused in the dialog', (await adminPage.hasText(EN.finance.review.reasonShort)) && (await db.prisma.refund.findUnique({ where: { id: toReject.id } })).status === 'REQUESTED');
  await adminPage.type('#reject-reason', 'Duplicate request — already refunded by support');
  await adminPage.snap('58-finance-reject-dialog');
  await adminPage.click('[data-confirm-reject]');
  await adminPage.waitFor(`!document.querySelector('[data-refund="${toReject.id}"]')`, 10_000).catch(() => {});
  const rejected = await db.prisma.refund.findUnique({ where: { id: toReject.id } });
  check('refund rejected with reason, reviewer and time recorded', rejected.status === 'REJECTED' && rejected.reviewNote?.startsWith('Duplicate request') && Boolean(rejected.reviewedBy && rejected.reviewedAt));
  await adminPage.click(`[data-refund="${toApprove.id}"] [data-approve-refund]`);
  await adminPage.waitFor(`document.querySelector('[data-confirm-approve]')`, 5000).catch(() => {});
  check('approval asks for confirmation and says it is simulated', await adminPage.hasText(EN.finance.review.simulated));
  await adminPage.click('[data-confirm-approve]');
  await adminPage.waitFor(`!document.querySelector('[data-refund="${toApprove.id}"]')`, 15_000).catch(() => {});
  const approved = await db.prisma.refund.findUnique({ where: { id: toApprove.id } });
  check('refund approved through the simulator', approved.status === 'SUCCEEDED', approved.status);
  await adminPage.goto(`${webOrigin}/admin/finance/refunds?status=REJECTED&lang=en`);
  await adminPage.waitFor(`document.querySelector('[data-refund="${toReject.id}"] [data-refund-history]')`, 10_000).catch(() => {});
  await adminPage.click(`[data-refund="${toReject.id}"] [data-refund-history]`);
  await adminPage.waitFor(`document.querySelector('[data-refund-detail]') && document.querySelector('[data-refund-detail]').innerText.includes('Duplicate request')`, 10_000).catch(() => {});
  check('refund history shows the decision and reason', await adminPage.eval(`return (document.querySelector('[data-refund-detail]')?.innerText ?? '').includes(${JSON.stringify(EN.finance.review.reasonRejected)});`));
  await adminPage.snap('59-finance-refund-history');

  await adminPage.goto(`${webOrigin}/admin/finance/settings?lang=en`);
  await adminPage.waitFor(`document.querySelector('[data-current-rate]')`, 15_000).catch(() => {});
  check('settings show the active commission (15% default)', (await adminPage.eval(`return document.querySelector('[data-current-rate]').innerText.trim();`)) === '15%');
  await adminPage.type('input[name=commissionPercent]', '150');
  await adminPage.click('[data-review-commission]');
  await sleep(200);
  check('an out-of-range commission is refused', await adminPage.hasText(EN.finance.settings.invalid));
  await adminPage.type('input[name=commissionPercent]', '17.5');
  await adminPage.click('[data-review-commission]');
  await adminPage.waitFor(`document.querySelector('[data-confirm-commission]')`, 5000).catch(() => {});
  await adminPage.snap('60-finance-commission-confirm');
  await adminPage.click('[data-confirm-commission]');
  await adminPage.waitFor(`document.querySelector('[data-current-rate]')?.innerText.trim() === '17.5%'`, 10_000).catch(() => {});
  const rateNow = await db.prisma.platformSetting.findUnique({ where: { key: 'commission_rate' } });
  const rateAudit = await db.prisma.auditLog.findFirst({ where: { entityType: 'PlatformSetting', entityId: 'commission_rate' }, orderBy: { createdAt: 'desc' } });
  check('commission change is confirmed, saved and audited (history unchanged)', rateNow.value.rate === '0.1750' && rateAudit?.oldValues?.rate === '0.1500' && (await adminPage.eval(`return (document.querySelector('[data-commission-history]')?.innerText ?? '').includes('15% → 17.5%');`)));
  await adminPage.snap('61-finance-settings');

  await adminPage.goto(`${webOrigin}/admin/finance/doctor-earnings?preset=all&lang=en`);
  await adminPage.waitFor(`document.querySelector('[data-earning-row]')`, 15_000).catch(() => {});
  check('doctor earnings table with "no payouts" notice', (await adminPage.eval(`return document.querySelectorAll('[data-earning-row]').length > 0 && !!document.querySelector('[data-no-payouts]');`)) && (await adminPage.hasText(EN.finance.earnings.pendingSettlement)));
  await adminPage.snap('62-finance-doctor-earnings');

  await adminPage.goto(`${webOrigin}/admin/finance/reports?preset=30d&lang=en`);
  await adminPage.waitFor(`document.querySelector('[data-report]')`, 15_000).catch(() => {});
  check('reports: revenue, methods, refunds, commission, doctors, daily and monthly trends', (await adminPage.eval(`return !!document.querySelector('[data-by-method]') && !!document.querySelector('[data-trend=daily]') && !!document.querySelector('[data-trend=monthly]');`)) && (await adminPage.hasText(EN.finance.reports.refundSummary)));
  await adminPage.eval(`window.__csv = null; const o = URL.createObjectURL.bind(URL); URL.createObjectURL = (b) => { b.text().then(t => { window.__csv = t; }); return o(b); }; return true;`);
  await adminPage.click('[data-export=payments]');
  await adminPage.waitFor(`window.__csv`, 15_000).catch(() => {});
  check('CSV export downloads the filtered payments (no wallet numbers)', await adminPage.eval(`const c = window.__csv || ''; return c.includes('"payment_id"') && c.includes('"simulated"') && !/\\+2526\\d{7}/.test(c);`));
  await adminPage.snap('63-finance-reports');
  await adminPage.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await sleep(500);
  await adminPage.snap('64-finance-reports-dark');
  await adminPage.send('Emulation.setEmulatedMedia', { features: [] });
  await adminPage.viewport('mobile');
  for (const path of ['/admin/finance', '/admin/finance/payments?preset=all', '/admin/finance/refunds', '/admin/finance/reports']) {
    await adminPage.goto(`${webOrigin}${path}`);
    await sleep(1200);
    check(`finance page fits a phone screen: ${path}`, await adminPage.eval('return document.documentElement.scrollWidth <= window.innerWidth + 1;'));
  }
  await adminPage.snap('65-finance-reports-mobile');
  await adminPage.viewport('desktop');
  await adminPage.goto(`${webOrigin}/admin/finance?lang=so`);
  await adminPage.waitFor(`document.querySelector('[data-overview]')`, 15_000).catch(() => {});
  check('Somali: finance pages are translated', (await adminPage.hasText(SO.finance.titles.overview)) && (await adminPage.hasText(SO.finance.cards.gross)));
  await adminPage.snap('66-finance-overview-so');
  await adminPage.goto(`${webOrigin}/admin/finance?lang=en`);

  const errors = [...page.consoleErrors, ...doctorVideoPage.consoleErrors, ...doctor2.consoleErrors, ...device2.consoleErrors, ...adminPage.consoleErrors, ...visitor.consoleErrors, ...patientPage.consoleErrors, ...gPage.consoleErrors, ...gVisitor.consoleErrors];
  check('no JavaScript exceptions or console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  } // end of sections 1–19

  /* 20. profiles: patient profile + photo + medical information; doctor professional profile, verification and
         availability; public profile; change password; Somali, mobile and dark mode. Self-contained data. */
  if (E2E_SECTIONS.length === 0 || E2E_SECTIONS.includes('profiles')) {
    const sharp = require('sharp');
    const { createCompletedConsultation } = await import('../integration/db/fixtures.js');
    const history = await import('../../apps/api/src/modules/medical-history/medicalHistory.service.js');
    const { syncAllDoctorSlots } = await import('../../apps/api/src/modules/availability/availability.service.js');
    const stamp = Date.now();
    const ppEmail = `profile-p-${stamp}@example.test`;
    const ppUser = await db.prisma.user.create({
      data: { email: ppEmail, fullName: 'Sahra Profile', passwordHash: await hashPassword(PASSWORD), roles: { create: [{ roleId: ctx.roles.PATIENT.id }] }, patientProfile: { create: {} } },
      include: { patientProfile: true },
    });
    const pdEmail = `profile-d-${stamp}@example.test`;
    const licenceNumber = `SMC-E2E-${stamp}`;
    const pdUser = await db.prisma.user.create({
      data: {
        email: pdEmail,
        fullName: 'Dr. Warsame Profile',
        passwordHash: await hashPassword(PASSWORD),
        roles: { create: [{ roleId: ctx.roles.PATIENT.id }, { roleId: ctx.roles.DOCTOR.id }] },
        patientProfile: { create: {} },
        doctorProfile: {
          create: {
            specialtyId: ctx.specialty.id, licenceNumber, licenceCountry: 'Somalia', consultationFee: '20.00', verificationStatus: 'VERIFIED', verifiedAt: new Date(), yearsExperience: 9,
            bio: 'Cardiologist with nine years of clinical experience in Mogadishu and Hargeisa hospitals.', languages: { create: [{ language: 'so' }] },
          },
        },
      },
      include: { doctorProfile: true },
    });
    const pdId = pdUser.doctorProfile.id;
    await db.prisma.verificationRequest.create({ data: { doctorId: pdId, status: 'APPROVED', resolvedAt: new Date() } });
    const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
    await db.prisma.availabilityRule.createMany({
      data: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ doctorId: pdId, dayOfWeek, startLocalTime: new Date('1970-01-01T09:00:00Z'), endLocalTime: new Date('1970-01-01T12:00:00Z'), timeZone: 'Africa/Mogadishu', slotDurationMinutes: 30, effectiveFrom: today })),
    });
    await syncAllDoctorSlots();
    const { consultation } = await createCompletedConsultation(db.prisma, { patient: ppUser.patientProfile, doctor: pdUser.doctorProfile });
    await history.addEntry({ actorUserId: pdUser.id, patientId: ppUser.patientProfile.id, consultationId: consultation.id, entryType: 'CONDITION', title: 'Hypertension' });
    const photoPath = join(tmpdir(), `fd-e2e-photo-${stamp}.jpg`);
    writeFileSync(photoPath, await sharp({ create: { width: 640, height: 640, channels: 3, background: '#0f766e' } }).jpeg().withExifMerge({ IFD0: { Make: 'E2ECam' } }).toBuffer());
    const photo2Path = join(tmpdir(), `fd-e2e-photo2-${stamp}.png`);
    writeFileSync(photo2Path, await sharp({ create: { width: 300, height: 300, channels: 3, background: '#c8a24a' } }).png().toBuffer());

    const setValue = (pg, sel, v) =>
      pg.eval(`const el = document.querySelector(${JSON.stringify(sel)}); const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(v)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true;`);
    const toast = (pg, text) => pg.waitFor(`[...document.querySelectorAll('[aria-live=polite] > div')].some(d => d.innerText.includes(${JSON.stringify(text)}))`, 15_000).then(() => true, () => false);
    async function signInAt(pg, email, next) {
      await pg.goto(`${webOrigin}/login?next=${encodeURIComponent(next)}&lang=en`);
      await pg.type('input[name=identifier]', email);
      await pg.type('input[name=password]', PASSWORD);
      await pg.click('form button[type=submit]');
      await pg.waitFor(`location.pathname === ${JSON.stringify(next)}`, 20_000);
    }
    const fits = (pg) => pg.eval('return document.documentElement.scrollWidth <= window.innerWidth + 1;');

    /* 20a. patient profile */
    const pp = await browser.newPage();
    await pp.viewport('desktop');
    await signInAt(pp, ppEmail, '/patient/profile');
    await pp.waitFor(`document.querySelector('[data-patient-profile]')`, 15_000).catch(() => {});
    check('patient profile shows real account data; email is read-only', (await pp.hasText(ppEmail)) && (await pp.eval(`return document.querySelector('#pp-fullName')?.value === 'Sahra Profile' && !document.querySelector('input[name=email], input[type=email]');`)));
    await pp.openProfileMenu();
    check('profile menu links to "My profile"', await pp.hasText(EN.profile.menu));
    await pp.click('header button[aria-expanded]');
    await setValue(pp, '#pp-dateOfBirth', '1994-07-21');
    await pp.selectValue('#pp-sex', 'FEMALE');
    await setValue(pp, '#pp-city', 'Hargeisa');
    await setValue(pp, '#pp-emergencyName', 'Hodan Profile');
    await setValue(pp, '#pp-emergencyRelationship', 'Sister');
    await setValue(pp, '#pp-emergencyPhone', '0634445566');
    await pp.click('[data-save-profile]');
    await sleep(500);
    check('invalid emergency phone shows a field message and nothing is saved', (await pp.hasText(EN.profile.errors.phone)) && !(await db.prisma.patientProfile.findUniqueOrThrow({ where: { id: ppUser.patientProfile.id } })).emergencyName);
    await setValue(pp, '#pp-emergencyPhone', '+252 63 444 5566');
    await pp.click('[data-save-profile]');
    check('patient saves personal details and emergency contact', await toast(pp, EN.profile.saved));
    const savedPatient = await db.prisma.patientProfile.findUniqueOrThrow({ where: { id: ppUser.patientProfile.id }, include: { addresses: true } });
    check('saved values reach the database (relationship, phone normalised, address)', savedPatient.emergencyRelationship === 'Sister' && savedPatient.emergencyPhone === '+252634445566' && savedPatient.addresses[0]?.city === 'Hargeisa' && savedPatient.dateOfBirth?.toISOString().startsWith('1994-07-21'));
    check('completeness indicator is shown (informational)', await pp.eval(`return Number(document.querySelector('[data-completeness]')?.dataset.completeness) > 50;`));

    await pp.setFile('[data-photo-input]', photoPath);
    await pp.waitFor(`document.querySelector('[data-photo-save]')`, 5_000).catch(() => {});
    check('photo preview before saving', await pp.eval(`return [...document.querySelectorAll('img')].some(i => i.src.startsWith('blob:'));`));
    await pp.click('[data-photo-save]');
    check('patient uploads a profile photo', await toast(pp, EN.profile.photo.saved));
    await pp.waitFor(`[...document.querySelectorAll('header img')].some(i => i.src.startsWith('blob:') && i.naturalWidth > 0)`, 10_000).catch(() => {});
    check('header avatar shows the private photo', await pp.eval(`return [...document.querySelectorAll('header img')].some(i => i.src.startsWith('blob:') && i.naturalWidth > 0);`));
    const firstPhoto = (await db.prisma.user.findUniqueOrThrow({ where: { id: ppUser.id } })).avatarUpdatedAt;
    await pp.setFile('[data-photo-input]', photo2Path);
    await pp.waitFor(`document.querySelector('[data-photo-save]')`, 5_000).catch(() => {});
    await pp.click('[data-photo-save]');
    await pp.waitFor(`!document.querySelector('[data-photo-save]')`, 15_000).catch(() => {});
    for (let i = 0; i < 40 && !((await db.prisma.user.findUniqueOrThrow({ where: { id: ppUser.id } })).avatarUpdatedAt > firstPhoto); i += 1) await sleep(250);
    const secondPhoto = await db.prisma.user.findUniqueOrThrow({ where: { id: ppUser.id } });
    check('patient changes the photo (PNG accepted, stored as a new private file)', secondPhoto.avatarUpdatedAt > firstPhoto && /^avatars\/[0-9a-f-]+\/[0-9a-f-]+\.jpg$/.test(secondPhoto.avatarKey));
    const anon = await fetch(`${webOrigin}/api/v1/me/photo`);
    const asDoctorPhoto = await fetch(`${webOrigin}/api/v1/doctors/${ppUser.patientProfile.id}/photo`);
    check('patient photo is private (no anonymous or public URL)', anon.status === 401 && asDoctorPhoto.status === 404);
    await pp.snap('70-patient-profile');

    /* 20b. medical information */
    await pp.goto(`${webOrigin}/patient/records?lang=en`);
    await pp.waitFor(`document.querySelector('[data-entries]')`, 15_000).catch(() => {});
    check('medical information lists the doctor-written entry as read-only (archivable)', await pp.eval(`const r = document.querySelector('[data-source=DOCTOR]'); return Boolean(r && r.innerText.includes('Hypertension') && !r.querySelector('[data-entry-edit]') && r.querySelector('[data-entry-archive]'));`));
    await pp.click('[data-entry-add]');
    await pp.waitFor(`document.querySelector('[data-entry-dialog]')`);
    await pp.selectValue('#me-type', 'ALLERGY');
    await setValue(pp, '#me-title', 'Penicillin');
    await setValue(pp, '#me-recordedAt', '2018-05-02');
    await pp.click('[data-entry-save]');
    check('patient adds an allergy', await toast(pp, EN.medical.added));
    await pp.waitFor(`[...document.querySelectorAll('[data-source=PATIENT]')].some(r => r.innerText.includes('Penicillin'))`, 10_000).catch(() => {});
    check('emergency summary shows allergies and conditions', await pp.eval(`const t = document.body.textContent; return t.includes(${JSON.stringify(EN.medical.typesPlural.ALLERGY)}) && /Penicillin/.test(t) && /Hypertension/.test(t);`));
    await pp.waitFor(`document.querySelector('[data-source=PATIENT] [data-entry-edit]')`, 15_000).catch(() => {});
    await pp.click('[data-source=PATIENT] [data-entry-edit]');
    await pp.waitFor(`document.querySelector('#me-description')`);
    await setValue(pp, '#me-description', 'Hives and swelling');
    await pp.click('[data-entry-save]');
    check('patient edits their own entry', (await toast(pp, EN.medical.updated)) && Boolean(await db.prisma.medicalHistoryEntry.findFirst({ where: { title: 'Penicillin', description: 'Hives and swelling' } })));
    await pp.waitFor(`document.querySelector('[data-source=DOCTOR] [data-entry-archive]')`, 15_000).catch(() => {});
    await pp.click('[data-source=DOCTOR] [data-entry-archive]');
    await pp.waitFor(`document.querySelector('[data-confirm]')`);
    check('archiving a doctor entry asks for confirmation', await pp.hasText(EN.medical.archiveBodyDoctor));
    await pp.click('[data-confirm]');
    check('patient archives the doctor-written entry', await toast(pp, EN.medical.archivedOk));
    const archivedEntry = await db.prisma.medicalHistoryEntry.findFirst({ where: { title: 'Hypertension' } });
    check('archived entry is kept (never deleted) with its doctor authorship', Boolean(archivedEntry?.archivedAt) && archivedEntry.source === 'DOCTOR' && archivedEntry.createdByUserId === pdUser.id);
    await pp.click(`[role=switch][aria-label=${JSON.stringify(EN.medical.showArchived)}]`);
    await pp.waitFor(`[...document.querySelectorAll('[data-entry]')].some(r => r.innerText.includes('Hypertension'))`, 15_000).catch(() => {});
    check('archived entries can be shown', await pp.eval(`return [...document.querySelectorAll('[data-entry]')].some(r => r.innerText.includes('Hypertension'));`));
    await pp.snap('71-medical-information');

    /* 20c. Somali, mobile, dark */
    await pp.goto(`${webOrigin}/patient/profile?lang=so`);
    await pp.waitFor(`document.querySelector('[data-patient-profile]')`, 15_000).catch(() => {});
    check('Somali: patient profile is translated', (await pp.hasText(SO.profile.patient.title)) && (await pp.hasText(SO.profile.emergency.title)));
    await pp.goto(`${webOrigin}/patient/records?lang=so`);
    await sleep(1200);
    check('Somali: medical information is translated', (await pp.hasText(SO.medical.title)) && (await pp.hasText(SO.medical.emergencyTitle)));
    await pp.snap('72-medical-information-so');
    await pp.viewport('mobile');
    for (const path of ['/patient/profile?lang=en', '/patient/records?lang=en', '/account/security?lang=en']) {
      await pp.goto(`${webOrigin}${path}`);
      await sleep(1200);
      check(`profile page fits a phone screen: ${path.split('?')[0]}`, await fits(pp));
    }
    await pp.goto(`${webOrigin}/patient/profile?lang=en`);
    await sleep(1000);
    await pp.snap('73-patient-profile-mobile');
    await pp.click(`button[aria-label=${JSON.stringify(EN.common.darkMode)}]`);
    await sleep(500);
    check('dark mode applies on the patient profile (phone)', (await pp.eval(`return document.documentElement.classList.contains('dark');`)) && (await fits(pp)));
    await pp.snap('74-patient-profile-mobile-dark');
    await pp.click(`button[aria-label=${JSON.stringify(EN.common.lightMode)}]`);
    await pp.viewport('desktop');

    /* 20d. account security: change password */
    await pp.goto(`${webOrigin}/account/security?lang=en`);
    await pp.waitFor(`document.querySelector('[data-change-password] #cp-currentPassword')`, 15_000).catch(() => {});
    await setValue(pp, '#cp-currentPassword', 'Not-the-password-1');
    await setValue(pp, '#cp-newPassword', 'Brand-new-pass-9');
    await setValue(pp, '#cp-newPasswordConfirmation', 'Brand-new-pass-9');
    await pp.click('[data-change-password] form button[type=submit]');
    await pp.waitFor(`document.querySelector('[data-confirm]')`);
    await pp.click('[data-confirm]');
    check('wrong current password is refused', await toast(pp, EN.profileErrors.CURRENT_PASSWORD_INVALID));
    await setValue(pp, '#cp-currentPassword', PASSWORD);
    await pp.click('[data-change-password] form button[type=submit]');
    await pp.waitFor(`document.querySelector('[data-confirm]')`);
    await pp.click('[data-confirm]');
    check('patient changes the password and stays signed in', (await toast(pp, 'Password changed')) && (await pp.path()).startsWith('/account/security'));
    const relogin = await fetch(`${webOrigin}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-fogaan-client': 'native' }, body: JSON.stringify({ email: ppEmail, password: 'Brand-new-pass-9' }) });
    check('the new password works', relogin.status === 200);
    await pp.snap('75-account-security');

    /* 20e. doctor professional profile */
    const dp = await browser.newPage();
    await dp.viewport('desktop');
    await signInAt(dp, pdEmail, '/doctor/profile');
    await dp.waitFor(`document.querySelector('[data-doctor-profile]')`, 15_000).catch(() => {});
    check('doctor profile: name and specialty are locked, professional fields editable', (await dp.hasText('Dr. Warsame Profile')) && (await dp.hasText(EN.myDoctorProfile.lockedHint)) && (await dp.eval(`return Boolean(document.querySelector('#dp-bio') && document.querySelector('#dp-fee'));`)));
    await setValue(dp, '#dp-qualifications', 'MBBS (Amoud University), MSc Cardiology');
    await setValue(dp, '#dp-fee', '25');
    await dp.clickText('button[aria-pressed]', EN.languageNames.en);
    await dp.click('[data-save-doctor-profile]');
    check('doctor saves professional information (fee for new bookings only)', await toast(dp, EN.myDoctorProfile.savedFee));
    const savedDoctor = await db.prisma.doctorProfile.findUniqueOrThrow({ where: { id: pdId }, include: { languages: true } });
    check('doctor changes reach the database; verification untouched', savedDoctor.consultationFee.toFixed(2) === '25.00' && savedDoctor.qualifications?.startsWith('MBBS') && savedDoctor.languages.length === 2 && savedDoctor.verificationStatus === 'VERIFIED');
    await dp.setFile('[data-photo-input]', photoPath);
    await dp.waitFor(`document.querySelector('[data-photo-save]')`, 5_000).catch(() => {});
    await dp.click('[data-photo-save]');
    check('doctor uploads a professional photo', await toast(dp, EN.profile.photo.saved));
    await dp.snap('76-doctor-profile');

    await dp.clickText('[role=tab]', EN.myDoctorProfile.tabs.verification);
    await dp.waitFor(`document.querySelector('[data-verification]')`, 5_000).catch(() => {});
    check('doctor views verification status and licence (admin-controlled)', (await dp.hasText(EN.myDoctorProfile.verification.adminOnly)) && (await dp.hasText(licenceNumber)));
    await dp.click('[data-replace-licence]');
    await dp.waitFor(`document.querySelector('[data-licence-ack]')`, 5_000).catch(() => {});
    check('licence replacement explains re-verification before anything happens', (await dp.hasText(EN.myDoctorProfile.licence.warning1)) && (await dp.hasText(EN.myDoctorProfile.licence.warning4)));
    await dp.click('[data-confirm]');
    await sleep(300);
    check('licence replacement requires the file and an explicit acknowledgement', (await dp.hasText(EN.myDoctorProfile.errors.ack)) && (await dp.hasText(EN.myDoctorProfile.errors.file)));
    await dp.clickText('[role=dialog] button', EN.common.cancel);
    check('cancelling changes nothing', (await db.prisma.doctorProfile.findUniqueOrThrow({ where: { id: pdId } })).verificationStatus === 'VERIFIED');
    await dp.snap('77-doctor-verification');

    await dp.clickText('[role=tab]', EN.myDoctorProfile.tabs.availability);
    await dp.waitFor(`document.querySelector('[data-availability-summary] li')`, 10_000).catch(() => {});
    check('doctor sees the published weekly availability and a link to manage it', (await dp.eval(`const s = document.querySelector('[data-availability-summary]')?.innerText ?? ''; return s.includes('09:00') && s.includes(${JSON.stringify(EN.availability.dayLong['1'])});`)) && (await dp.eval(`return Boolean(document.querySelector('[data-availability-summary] a[href="/doctor/availability"]'));`)));
    await dp.goto(`${webOrigin}/doctor/profile?lang=so`);
    await dp.waitFor(`document.querySelector('[data-doctor-profile]')`, 15_000).catch(() => {});
    check('Somali: doctor profile is translated', (await dp.hasText(SO.myDoctorProfile.title)) && (await dp.hasText(SO.myDoctorProfile.tabs.verification)));
    await dp.viewport('mobile');
    await dp.goto(`${webOrigin}/doctor/profile?lang=en`);
    await sleep(1200);
    check('doctor profile fits a phone screen', await fits(dp));
    await dp.click(`button[aria-label=${JSON.stringify(EN.common.darkMode)}]`);
    await sleep(500);
    check('dark mode applies on the doctor profile (phone)', (await dp.eval(`return document.documentElement.classList.contains('dark');`)) && (await fits(dp)));
    await dp.snap('78-doctor-profile-mobile-dark');
    await dp.click(`button[aria-label=${JSON.stringify(EN.common.lightMode)}]`);
    await dp.viewport('desktop');

    /* 20f. public doctor profile: approved information only */
    const pub = await browser.newPage();
    await pub.viewport('desktop');
    await pub.goto(`${webOrigin}/doctors/${pdId}?lang=en`);
    await pub.waitFor(`document.querySelector('[data-qualifications]')`, 15_000).catch(() => {});
    await pub.waitFor(`[...document.querySelectorAll('img')].some(i => i.src.includes('/api/v1/doctors/${pdId}/photo') && i.naturalWidth > 0)`, 10_000).catch(() => {});
    check('public profile shows qualifications, fee, languages and the professional photo', (await pub.eval(`return document.querySelector('[data-qualifications]')?.innerText.includes('MBBS');`)) && (await pub.eval(`return document.body.innerText.includes('$25');`)) && (await pub.eval(`return [...document.querySelectorAll('img')].some(i => i.src.includes('/api/v1/doctors/${pdId}/photo') && i.naturalWidth > 0);`)));
    check('public profile never shows email, licence number or private notes', !(await pub.hasText(pdEmail)) && !(await pub.hasText(licenceNumber)) && !(await pub.eval(`return document.documentElement.outerHTML.includes('avatars/');`)));
    await pub.waitFor(`document.querySelectorAll('[role=listbox] [role=option]').length > 0`, 20_000).catch(() => {});
    check('public profile shows bookable times', await pub.eval(`return document.querySelectorAll('[role=listbox] [role=option]').length > 0;`));
    await pub.snap('79-public-doctor-profile');

    const errors20 = [...pp.consoleErrors, ...dp.consoleErrors, ...pub.consoleErrors];
    check('profiles: no JavaScript exceptions or console errors', errors20.length === 0, errors20.slice(0, 3).join(' | '));
    rmSync(photoPath, { force: true });
    rmSync(photo2Path, { force: true });
  }

  /* 21. prescriptions & medical documents (Phase 10): doctor drafts → issues → corrects → cancels, uploads a
         document; patient sees prescriptions, PDF download/print, summary, documents page, uploads a lab
         report; public QR verification; admin metadata-only monitoring; Somali, mobile, dark mode. */
  if (E2E_SECTIONS.length === 0 || E2E_SECTIONS.includes('prescriptions')) {
    const sharp = require('sharp');
    const { hashVerificationToken, newVerificationToken } = await import('../../apps/api/src/modules/prescriptions/prescription.service.js');
    const setValue = (pg, sel, v) =>
      pg.eval(`const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(v)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true;`);
    const toast = (pg, text) => pg.waitFor(`[...document.querySelectorAll('[aria-live=polite] > div')].some(d => d.innerText.includes(${JSON.stringify(text)}))`, 20_000).then(() => true, () => false);
    async function signInAt(pg, email, next) {
      await pg.goto(`${webOrigin}/login?next=${encodeURIComponent(next)}&lang=en`);
      await pg.type('input[name=identifier]', email);
      await pg.type('input[name=password]', PASSWORD);
      await pg.click('form button[type=submit]');
      await pg.waitFor(`location.pathname === ${JSON.stringify(next)}`, 20_000);
    }
    const fits = (pg) => pg.eval('return document.documentElement.scrollWidth <= window.innerWidth + 1;');
    const stamp = Date.now();
    const mk = async (email, fullName, roles, extra = {}) =>
      db.prisma.user.create({ data: { email, fullName, passwordHash: await hashPassword(PASSWORD), roles: { create: roles.map((r) => ({ roleId: ctx.roles[r].id })) }, ...extra }, include: { patientProfile: true, doctorProfile: true } });
    const rxPatient = await mk(`rx-p-${stamp}@example.test`, 'Faadumo Rx Patient', ['PATIENT'], { patientProfile: { create: {} } });
    const rxDoctor = await mk(`rx-d-${stamp}@example.test`, 'Dr. Rx Prescriber', ['PATIENT', 'DOCTOR'], {
      patientProfile: { create: {} },
      doctorProfile: { create: { specialtyId: ctx.specialty.id, licenceNumber: `SMC-RX-${stamp}`, licenceCountry: 'Somalia', consultationFee: '20.00', verificationStatus: 'VERIFIED', verifiedAt: new Date() } },
    });
    const rxAdmin = await mk(`rx-a-${stamp}@example.test`, 'Records Admin', ['ADMIN']);
    let slotN = 0;
    async function consult(status) {
      slotN += 1;
      const startAtUtc = new Date(Date.now() - (status === 'COMPLETED' ? 5 : 0.25) * 3_600_000 - slotN * 3_600_000);
      const slot = await db.prisma.availabilitySlot.create({ data: { doctorId: rxDoctor.doctorProfile.id, startAtUtc, endAtUtc: new Date(startAtUtc.getTime() + 30 * 60_000), timeZoneSnapshot: 'Africa/Mogadishu', status: 'BOOKED' } });
      const appointment = await db.prisma.appointment.create({ data: { patientId: rxPatient.patientProfile.id, doctorId: rxDoctor.doctorProfile.id, slotId: slot.id, status, feeAmount: '20.00', commissionRateSnapshot: '0.1500', startAtUtc, endAtUtc: slot.endAtUtc } });
      const completedAt = status === 'COMPLETED' ? new Date(Date.now() - 2 * 3_600_000) : null;
      const c = await db.prisma.consultation.create({ data: { appointmentId: appointment.id, patientId: rxPatient.patientProfile.id, doctorId: rxDoctor.doctorProfile.id, status, startedAt: startAtUtc, ...(completedAt ? { completedAt, endedAt: completedAt } : {}) } });
      return { c, appointment };
    }
    const live = await consult('IN_PROGRESS');
    const done = await consult('COMPLETED');
    await db.prisma.consultationNote.create({ data: { consultationId: done.c.id, complaint: 'Cough for one week', assessment: 'Doctor-only assessment text', diagnosis: 'Acute bronchitis', advice: 'Rest and fluids', shareComplaint: true, shareAssessment: false, shareDiagnosis: true, shareAdvice: true, lockedAt: new Date(Date.now() + 22 * 3_600_000) } });
    const pngPath = join(tmpdir(), `fd-e2e-lab-${stamp}.png`);
    writeFileSync(pngPath, await sharp({ create: { width: 120, height: 160, channels: 3, background: '#f8fafc' } }).png().toBuffer());

    /* 21a. doctor: draft → issue */
    const dr = await browser.newPage();
    await dr.viewport('desktop');
    await signInAt(dr, rxDoctor.email, `/doctor/appointments/${live.appointment.id}`);
    await dr.waitFor(`document.querySelector('[data-consultation-prescriptions]') && document.querySelector('[data-rx-window=open]')`, 20_000).catch(() => {});
    check('doctor appointment page shows the prescription section with the issuing window open', await dr.eval(`return Boolean(document.querySelector('[data-rx-window=open]') && document.querySelector('[data-rx-new]'));`));
    await dr.click('[data-rx-new]');
    await dr.waitFor(`document.querySelector('[data-rx-editor]')`);
    const p0 = `#rx-${live.c.id}-0`;
    await dr.click('[data-rx-save-draft]');
    await sleep(300);
    check('empty medicine lines are refused with field messages', await dr.hasText(EN.rx.errors.medicineName));
    await setValue(dr, `${p0}-medicineName`, 'Amoxicillin 500 mg capsules');
    await setValue(dr, `${p0}-dose`, '1 capsule');
    await setValue(dr, `${p0}-frequency`, '3 times daily');
    await setValue(dr, `${p0}-duration`, '7 days');
    await setValue(dr, `${p0}-quantity`, '21 capsules');
    await setValue(dr, `${p0}-warnings`, 'Stop if a rash appears');
    await dr.click('[data-rx-add-line]');
    await dr.waitFor(`document.querySelector('#rx-${live.c.id}-1-medicineName')`);
    await setValue(dr, `#rx-${live.c.id}-1-medicineName`, 'Paracetamol 500 mg');
    await setValue(dr, `#rx-${live.c.id}-1-dose`, '1 tablet');
    await setValue(dr, `#rx-${live.c.id}-1-frequency`, 'Every 6 hours if needed');
    await setValue(dr, `#rx-${live.c.id}-1-duration`, '5 days');
    await dr.click('[data-rx-save-draft]');
    check('doctor saves a draft with two medicines', await toast(dr, EN.rx.draftSaved));
    const draftRow = await db.prisma.prescription.findFirst({ where: { consultationId: live.c.id }, include: { items: true } });
    check('draft stored with its lines, not yet issued', draftRow?.status === 'DRAFT' && draftRow.items.length === 2 && !draftRow.verificationTokenHash);
    await dr.waitFor(`document.querySelector('[data-rx-issue]')`, 10_000).catch(() => {});
    await dr.click('[data-rx-issue]');
    await dr.waitFor(`document.querySelector('[data-confirm]')`, 10_000).catch(() => {});
    check('issuing asks for confirmation and shows the medicines', await dr.hasText(EN.rx.issueTitle) && (await dr.hasText('Amoxicillin 500 mg capsules')));
    await dr.click('[data-confirm]');
    const issued = await db.prisma.prescription.findUniqueOrThrow({ where: { id: draftRow.id } }).then(async (r) => {
      for (let i = 0; i < 60 && r.status !== 'VALID'; i += 1) {
        await sleep(250);
        r = await db.prisma.prescription.findUniqueOrThrow({ where: { id: draftRow.id } });
      }
      return r;
    });
    check('doctor issues the prescription (reference, PDF stored with checksum)', issued.status === 'VALID' && /^FD-RX-/.test(issued.reference) && /^[0-9a-f]{64}$/.test(issued.pdfSha256 ?? ''));
    await dr.snap('80-doctor-prescription-issued');

    /* 21b. doctor uploads a document; summary shows share state */
    await dr.goto(`${webOrigin}/doctor/appointments/${done.appointment.id}?lang=en`);
    await dr.waitFor(`document.querySelector('[data-documents-panel] [data-doc-file]')`, 20_000).catch(() => {});
    await dr.selectValue('[data-documents-panel] [data-doc-category]', 'REFERRAL_LETTER');
    await dr.setFile('[data-documents-panel] [data-doc-file]', pngPath);
    await dr.click('[data-doc-upload]');
    check('doctor uploads a consultation document', await toast(dr, EN.docs.uploaded));
    await dr.waitFor(`document.querySelector('[data-consultation-summary]')`, 10_000).catch(() => {});
    await dr.waitFor(`document.querySelector('[data-consultation-summary] [data-summary-section]')`, 10_000).catch(() => {});
    // textContent: the section labels are styled uppercase, which innerText would apply.
    check('doctor summary shows every section with its share state', await dr.eval(`const s = document.querySelector('[data-consultation-summary]')?.textContent ?? ''; return s.includes('Doctor-only assessment text') && s.includes(${JSON.stringify(EN.summary.private)}) && s.includes(${JSON.stringify(EN.summary.shared)});`));

    /* 21c. correction (replace) and cancellation from the detail page */
    await dr.goto(`${webOrigin}/doctor/prescriptions/${issued.id}?lang=en`);
    await dr.waitFor(`document.querySelector('[data-rx-replace-open]')`, 20_000).catch(() => {});
    await dr.click('[data-rx-replace-open]');
    await dr.waitFor(`document.querySelector('[data-rx-replace]')`);
    await dr.click('[data-confirm]');
    await sleep(300);
    check('correction requires a reason', await dr.hasText(EN.rx.errors.reason));
    await setValue(dr, '[data-rx-replace] [data-rx-reason]', 'Dose corrected after reviewing allergy history');
    await setValue(dr, '#rx-replace-0-dose', '2 capsules');
    await dr.click('[data-confirm]');
    await dr.waitFor(`location.pathname !== '/doctor/prescriptions/${issued.id}' && document.querySelector('[data-rx-detail=VALID]')`, 20_000).catch(() => {});
    const original = await db.prisma.prescription.findUniqueOrThrow({ where: { id: issued.id } });
    const replacement = await db.prisma.prescription.findFirst({ where: { replacesPrescriptionId: issued.id }, include: { items: { orderBy: { position: 'asc' } } } });
    check('correction issues a linked new prescription and keeps the original as REPLACED', original.status === 'REPLACED' && original.replacementReason?.startsWith('Dose corrected') && replacement?.status === 'VALID' && replacement.items[0].dose === '2 capsules');
    await dr.waitFor(`document.querySelector('[data-rx-cancel-open]')`, 20_000).catch(() => {});
    await dr.click('[data-rx-cancel-open]');
    await dr.waitFor(`document.querySelector('[data-rx-reason]')`, 15_000);
    await setValue(dr, '[data-rx-reason]', 'Patient reported the medicine is unavailable locally');
    await dr.click('[data-confirm]');
    await dr.waitFor(`document.querySelector('[data-rx-detail=CANCELLED]')`, 20_000).catch(() => {});
    check('doctor cancels with a reason; status shown as cancelled', (await dr.eval(`return Boolean(document.querySelector('[data-rx-detail=CANCELLED]'));`)) && (await db.prisma.prescription.findUniqueOrThrow({ where: { id: replacement.id } })).status === 'CANCELLED');
    await dr.snap('81-doctor-prescription-cancelled');
    await dr.goto(`${webOrigin}/doctor/prescriptions?lang=en`);
    await dr.waitFor(`document.querySelectorAll('[data-rx-list-item]').length >= 2`, 15_000).catch(() => {});
    check('doctor prescription list shows the lifecycle (replaced + cancelled)', await dr.eval(`return Boolean(document.querySelector('[data-rx-list-item=REPLACED]') && document.querySelector('[data-rx-list-item=CANCELLED]'));`));

    /* 21d. patient: prescriptions, PDF, summary, documents page */
    const pt = await browser.newPage();
    await pt.viewport('desktop');
    await signInAt(pt, rxPatient.email, '/patient/prescriptions');
    await pt.waitFor(`document.querySelectorAll('[data-rx-list-item]').length >= 2`, 20_000).catch(() => {});
    check('patient sees both prescriptions (no drafts) with their statuses', await pt.eval(`return document.querySelectorAll('[data-rx-list-item]').length === 2;`));
    await pt.goto(`${webOrigin}/patient/prescriptions/${issued.id}?lang=en`);
    await pt.waitFor(`document.querySelector('[data-rx-detail=REPLACED]')`, 15_000).catch(() => {});
    check('patient sees the replaced original read-only, with the correction note', (await pt.hasText('Dose corrected after reviewing allergy history')) && (await pt.eval(`return !document.querySelector('[data-rx-doctor-actions], [data-rx-replace-open], [data-rx-cancel-open], textarea, input:not([type=file])');`)));
    const downloadsBefore = await db.prisma.auditLog.count({ where: { entityType: 'Prescription', entityId: issued.id, newValues: { path: ['action'], equals: 'PDF_DOWNLOADED' } } });
    await pt.waitFor(`document.querySelector('[data-rx-download]') && !document.querySelector('[data-rx-download]').disabled`, 15_000).catch(() => {});
    await pt.click('[data-rx-download]');
    // The download is a private fetch (sign-in, ownership, SHA-256 check, audit) — allow for Neon latency.
    for (let i = 0; i < 80; i += 1) {
      const n = await db.prisma.auditLog.count({ where: { entityType: 'Prescription', entityId: issued.id, newValues: { path: ['action'], equals: 'PDF_DOWNLOADED' } } });
      if (n > downloadsBefore) break;
      await sleep(250);
    }
    const pdfDiag = async () => `responses=${JSON.stringify(pt.responses.filter((r) => r.url.endsWith('/pdf')))} toasts=${JSON.stringify(await pt.toasts())}`;
    check('patient downloads the PDF (served after checksum verification)', (await db.prisma.auditLog.count({ where: { entityType: 'Prescription', entityId: issued.id, newValues: { path: ['action'], equals: 'PDF_DOWNLOADED' } } })) > downloadsBefore && !(await pt.hasText(EN.rxErrors.PRESCRIPTION_PDF_INTEGRITY)), await pdfDiag());
    await pt.waitFor(`!document.querySelector('[data-rx-print]').disabled`, 20_000).catch(() => {}); // buttons are disabled while a PDF action runs
    await pt.click('[data-rx-print]');
    await pt.waitFor(`[...document.querySelectorAll('iframe')].some(f => f.src.startsWith('blob:'))`, 10_000).catch(() => {});
    check('print opens the private PDF in a print frame', await pt.eval(`return [...document.querySelectorAll('iframe')].some(f => f.src.startsWith('blob:'));`), await pdfDiag());
    await pt.snap('82-patient-prescription');

    await pt.goto(`${webOrigin}/patient/appointments/${done.appointment.id}?lang=en`);
    await pt.waitFor(`document.querySelector('[data-consultation-summary] [data-summary-section]')`, 20_000).catch(() => {});
    check('patient summary shows only the shared sections', await pt.eval(`const s = document.querySelector('[data-consultation-summary]')?.innerText ?? ''; return s.includes('Cough for one week') && s.includes('Acute bronchitis') && s.includes('Rest and fluids') && !s.includes('Doctor-only assessment text');`));

    await pt.goto(`${webOrigin}/patient/documents?lang=en`);
    await pt.waitFor(`document.querySelector('[data-records-list]')`, 20_000).catch(() => {});
    check('documents page combines prescriptions, summaries and documents', await pt.eval(`return Boolean(document.querySelector('[data-record=prescription]') && document.querySelector('[data-record=summary]') && document.querySelector('[data-document]'));`));
    await pt.clickText('[role=tab]', `${EN.records.filters.summaries} (1)`);
    await sleep(300);
    check('filter: summaries only', await pt.eval(`return document.querySelectorAll('[data-record=summary]').length === 1 && !document.querySelector('[data-record=prescription], [data-document]');`));
    await pt.click('[data-summary-open]');
    await pt.waitFor(`document.querySelector('[role=dialog] [data-summary-section]')`, 15_000).catch(() => {});
    check('summary opens in a dialog without unshared sections', await pt.eval(`const d = document.querySelector('[role=dialog]')?.innerText ?? ''; return d.includes('Acute bronchitis') && !d.includes('Doctor-only assessment text');`));
    await pt.eval(`document.querySelector('[role=dialog] button[aria-label]')?.click(); return true;`);
    await pt.clickText('[role=tab]', EN.records.filters.all);
    await setValue(pt, 'input[name=records-search]', 'nothing-matches-this');
    await sleep(300);
    check('search with no match shows the empty state', await pt.eval(`return Boolean(document.querySelector('[data-records-empty]'));`));
    await setValue(pt, 'input[name=records-search]', '');
    await pt.click('[data-records-upload]');
    await pt.waitFor(`document.querySelector('[data-records-upload-dialog] #records-consultation')`, 10_000).catch(() => {});
    await pt.selectValue('#records-consultation', done.c.id);
    await pt.waitFor(`document.querySelector('[data-records-upload-dialog] [data-doc-file]')`, 10_000).catch(() => {});
    await pt.selectValue('[data-records-upload-dialog] [data-doc-category]', 'LAB_RESULT');
    await pt.setFile('[data-records-upload-dialog] [data-doc-file]', pngPath);
    await pt.click('[data-records-upload-dialog] [data-doc-upload]');
    check('patient uploads a laboratory report', await toast(pt, EN.docs.uploaded));
    check('both participants’ documents are stored privately (2 files, verified type)', (await db.prisma.consultationAttachment.count({ where: { consultationId: done.c.id, mimeType: 'image/png' } })) === 2);
    await pt.snap('83-patient-documents');

    /* 21e. public QR verification page (no login) */
    const token = newVerificationToken();
    const qr = await db.prisma.prescription.create({ data: { consultationId: done.c.id, patientId: rxPatient.patientProfile.id, doctorId: rxDoctor.doctorProfile.id, status: 'DRAFT', issuedAt: null, items: { create: [{ medicineName: 'Secret Medicine 10 mg', dose: '1', frequency: '1', duration: '1' }] } } });
    await db.prisma.prescription.update({ where: { id: qr.id }, data: { status: 'VALID', issuedAt: new Date(), reference: `FD-RX-E2E-${stamp}`, verificationTokenHash: hashVerificationToken(token) } });
    const anon = await browser.newPage();
    await anon.viewport('mobile');
    await anon.goto(`${webOrigin}/verify/${token}?lang=en`);
    await anon.waitFor(`document.querySelector('[data-verify-result]')`, 15_000).catch(() => {});
    check('QR page confirms a valid prescription and its doctor', (await anon.eval(`return document.querySelector('[data-verify-result]')?.dataset.verifyResult === 'VALID';`)) && (await anon.hasText('Dr. Rx Prescriber')));
    check('QR page never shows the patient or medicines', !(await anon.hasText('Faadumo')) && !(await anon.hasText('Secret Medicine')) && (await fits(anon)));
    await anon.snap('84-verify-valid-mobile');
    await anon.goto(`${webOrigin}/verify/${issued.id.replace(/-/g, '')}abcdefgh?lang=so`);
    await anon.waitFor(`document.querySelector('[data-verify-result]')`, 15_000).catch(() => {});
    check('unknown codes are "not recognised" (Somali)', await anon.hasText(SO.verify.notFoundTitle));

    /* 21f. admin: metadata-only monitoring */
    const ad = await browser.newPage();
    await ad.viewport('desktop');
    await signInAt(ad, rxAdmin.email, '/admin/medical-records');
    await ad.waitFor(`document.querySelector('[data-admin-overview]') && document.querySelector('[data-admin-rx]')`, 20_000).catch(() => {});
    check('admin sees prescription statistics and the status list', await ad.eval(`return Boolean(document.querySelector('[data-tile=issued]') && document.querySelectorAll('[data-admin-rx-row]').length >= 3);`));
    await ad.selectValue('select[name=rx-status]', 'CANCELLED');
    await ad.waitFor(`[...document.querySelectorAll('[data-admin-rx-row]')].length > 0 && [...document.querySelectorAll('[data-admin-rx-row]')].every(r => r.dataset.adminRxRow === 'CANCELLED')`, 10_000).catch(() => {});
    check('admin filters prescriptions by status', await ad.eval(`const rows = [...document.querySelectorAll('[data-admin-rx-row]')]; return rows.length > 0 && rows.every(r => r.dataset.adminRxRow === 'CANCELLED');`));
    await ad.clickText('[role=tab]', EN.adminRecords.tabs.documents);
    await ad.waitFor(`document.querySelector('[data-admin-docs]')`, 10_000).catch(() => {});
    const docsText = await ad.eval(`return document.body.innerText;`);
    await ad.clickText('[role=tab]', EN.adminRecords.tabs.audit);
    await ad.waitFor(`document.querySelector('[data-admin-audit] li')`, 10_000).catch(() => {});
    const auditText = await ad.eval(`return document.body.innerText;`);
    check('admin sees document counts, storage and audit events', (await ad.eval(`return Boolean(document.querySelector('[data-tile=storage]'));`)) && /PDF|PNG/.test(docsText) && auditText.includes(EN.adminRecords.entities.Prescription));
    const html = await ad.eval(`return document.documentElement.outerHTML;`);
    check('admin pages expose no medicines, notes, file names or patient names', ['Amoxicillin', 'Paracetamol', 'capsule', 'Stop if a rash', 'Acute bronchitis', 'fd-e2e-lab', 'Faadumo', 'Dose corrected', 'unavailable locally'].every((s) => !html.includes(s) && !docsText.includes(s) && !auditText.includes(s)));
    await ad.snap('85-admin-medical-records');

    /* 21g. Somali, mobile, dark */
    await pt.goto(`${webOrigin}/patient/documents?lang=so`);
    await pt.waitFor(`document.querySelector('[data-records-list]')`, 15_000).catch(() => {});
    check('Somali: documents page translated', (await pt.hasText(SO.records.title)) && (await pt.hasText(SO.records.filters.summaries)));
    await ad.goto(`${webOrigin}/admin/medical-records?lang=so`);
    await ad.waitFor(`document.querySelector('[data-admin-overview]')`, 15_000).catch(() => {});
    check('Somali: admin monitoring translated', await ad.hasText(SO.adminRecords.title));
    await pt.viewport('mobile');
    for (const path of ['/patient/documents', `/patient/prescriptions/${replacement.id}`, '/patient/prescriptions']) {
      await pt.goto(`${webOrigin}${path}?lang=en`);
      await sleep(1500);
      check(`fits a phone screen: ${path.replace(/[0-9a-f-]{36}/, ':id')}`, await fits(pt));
    }
    await pt.click(`button[aria-label=${JSON.stringify(EN.common.darkMode)}]`);
    await sleep(500);
    check('dark mode on the patient prescription page', (await pt.eval(`return document.documentElement.classList.contains('dark');`)) && (await fits(pt)));
    await pt.snap('86-patient-prescription-mobile-dark');
    await pt.click(`button[aria-label=${JSON.stringify(EN.common.lightMode)}]`);
    await dr.viewport('mobile');
    await dr.goto(`${webOrigin}/doctor/prescriptions/${replacement.id}?lang=en`);
    await sleep(1500);
    check('doctor prescription page fits a phone screen', await fits(dr));
    await ad.viewport('mobile');
    await ad.goto(`${webOrigin}/admin/medical-records?lang=en`);
    await sleep(1500);
    check('admin monitoring fits a phone screen', await fits(ad));

    const errors21 = [...dr.consoleErrors, ...pt.consoleErrors, ...anon.consoleErrors, ...ad.consoleErrors];
    check('prescriptions: no JavaScript exceptions or console errors', errors21.length === 0, errors21.slice(0, 3).join(' | '));
    rmSync(pngPath, { force: true });
  }
} catch (error) {
  check('e2e harness', false, error.stack);
} finally {
  await browser?.close();
  for (const p of [web, api]) p?.kill();
  await fakeGoogle?.close();
  await sleep(500);
  await db?.teardown().catch((e) => console.error('[e2e] teardown failed:', e.message));
  rmSync(storageDir, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n[e2e] ${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
