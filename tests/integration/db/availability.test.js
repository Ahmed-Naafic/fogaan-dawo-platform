// Doctor availability + public doctor directory — real HTTP API against Neon, isolated per-run schema.
import { randomBytes } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { databaseTestsSkipReason, setupTestDatabase } from './harness.js';
import { baseData } from './fixtures.js';

const skip = databaseTestsSkipReason();
const PASSWORD = 'Correct-horse-42';
const ZONE = 'Africa/Mogadishu';
const ALL_DAYS = (periods) => [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, periods }));
const MORNING = [{ startTime: '09:00', endTime: '11:00' }];
/** A civil date `n` days from now (UTC) — always within the one-year block window. */
const daysAhead = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

describe('doctor availability and public directory API (Neon, isolated schema)', { skip: skip ?? false }, () => {
  let db;
  let prisma;
  let ctx;
  let server;
  let base;
  let hashPassword;
  let svc;
  let seq = 0;

  before(async () => {
    process.env.JWT_ACCESS_SECRET = randomBytes(48).toString('base64url');
    process.env.BCRYPT_ROUNDS = '10';
    process.env.COOKIE_SECURE = 'false';
    process.env.PUBLIC_RATE_LIMIT_MAX = '10000';
    process.env.AVAILABILITY_RATE_LIMIT_MAX = '10000';
    db = await setupTestDatabase();
    prisma = db.prisma;
    ctx = await baseData(prisma);
    ctx.dermatology = await prisma.specialty.create({ data: { nameEn: 'Dermatology', nameSo: 'Maqaarka' } });
    ({ hashPassword } = await import('../../../apps/api/src/utils/password.js'));
    svc = await import('../../../apps/api/src/modules/availability/availability.service.js');
    const { createApp } = await import('../../../apps/api/src/app.js');
    server = createApp({ authRateLimit: { limit: 10_000 } }).listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((r) => (server ? server.close(r) : r()));
    await db?.teardown();
  });

  /* ------------------------------------------------------------ helpers */
  async function api(method, path, { body, token } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: { 'x-fogaan-client': 'native', ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json(), text: '' };
  }
  const uniq = () => `${Date.now().toString(36)}${(seq += 1)}`;

  /** A doctor account (DOCTOR role) with a profile in the given state; returns a DOCTOR session token. */
  async function makeDoctor({ status = 'VERIFIED', name = `Dr. Amina ${uniq()}`, fee = '20.00', specialtyId = ctx.specialty.id, languages = ['so', 'en'] } = {}) {
    const email = `doc-${uniq()}@fogaandawo.test`;
    const user = await prisma.user.create({
      data: { email, fullName: name, passwordHash: await hashPassword(PASSWORD), timeZone: ZONE, roles: { create: [{ roleId: ctx.roles.DOCTOR.id }] } },
    });
    const doctor = await prisma.doctorProfile.create({
      data: {
        userId: user.id,
        specialtyId,
        licenceNumber: `SECRET-LIC-${uniq()}`,
        licenceCountry: 'Somalia',
        consultationFee: fee,
        bio: 'Experienced physician.',
        verificationStatus: status,
        verifiedAt: status === 'VERIFIED' ? new Date() : null,
        languages: { create: languages.map((language) => ({ language })) },
      },
    });
    const login = await api('POST', '/api/v1/auth/login', { body: { email, password: PASSWORD, role: 'DOCTOR' } });
    assert.equal(login.status, 200, JSON.stringify(login.body));
    return { user, doctor, email, token: login.body.data.accessToken };
  }
  const schedule = (over = {}) => ({ timeZone: ZONE, slotDurationMinutes: 30, days: ALL_DAYS(MORNING), ...over });
  const futureSlots = (doctorId) => prisma.availabilitySlot.findMany({ where: { doctorId, startAtUtc: { gt: new Date() } }, orderBy: { startAtUtc: 'asc' } });
  const mogadishuDate = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const mogadishuTime = (d) => new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);

  /* ------------------------------------------------------------ doctor availability */

  test('verified doctor saves a weekly schedule; slots are generated in UTC and audited', async () => {
    const { doctor, token } = await makeDoctor();
    const res = await api('PUT', '/api/v1/doctors/me/availability/schedule', { token, body: schedule({ days: [{ dayOfWeek: 1, periods: [{ startTime: '09:00', endTime: '12:00' }, { startTime: '13:00', endTime: '15:00' }] }, ...ALL_DAYS(MORNING).filter((d) => d.dayOfWeek !== 1)] }) });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.canManage, true);
    assert.equal(res.body.data.rules.length, 8, 'Monday has two periods (a break between them)');
    assert.ok(res.body.data.slots.created > 0);

    const slots = await futureSlots(doctor.id);
    assert.ok(slots.length > 0);
    for (const s of slots) {
      const t = mogadishuTime(s.startAtUtc);
      assert.ok(t >= '09:00' && t < '15:00' && !(t >= '12:00' && t < '13:00'), `slot ${t} inside working hours, not in the break`);
      assert.equal(s.endAtUtc - s.startAtUtc, 30 * 60_000);
      assert.equal(s.timeZoneSnapshot, ZONE);
      assert.equal(s.startAtUtc.getUTCHours(), (Number(t.slice(0, 2)) - 3 + 24) % 24, 'stored in UTC (Mogadishu is UTC+3)');
    }
    const horizonEnd = Date.now() + 29 * 86_400_000;
    assert.ok(slots.every((s) => s.startAtUtc.getTime() < horizonEnd), 'within the 28-day window');
    const audit = await prisma.auditLog.findFirst({ where: { entityType: 'AvailabilitySchedule', entityId: doctor.id } });
    assert.equal(audit?.action, 'UPDATE');

    const mine = await api('GET', '/api/v1/doctors/me/availability', { token });
    assert.equal(mine.body.data.timeZone, ZONE);
    assert.deepEqual(mine.body.data.rules.find((r) => r.dayOfWeek === 1 && r.startTime === '13:00'), { ...mine.body.data.rules.find((r) => r.dayOfWeek === 1 && r.startTime === '13:00'), endTime: '15:00', slotDurationMinutes: 30 });
  });

  test('pending and suspended doctors cannot publish availability', async () => {
    const pending = await makeDoctor({ status: 'PENDING' });
    const res = await api('PUT', '/api/v1/doctors/me/availability/schedule', { token: pending.token, body: schedule() });
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'DOCTOR_NOT_BOOKABLE');
    assert.equal((await api('GET', '/api/v1/doctors/me/availability', { token: pending.token })).body.data.canManage, false);
    assert.equal(await prisma.availabilityRule.count({ where: { doctorId: pending.doctor.id } }), 0);
    assert.equal((await api('POST', '/api/v1/doctors/me/availability/blocks', { token: pending.token, body: { kind: 'DAYS', timeZone: ZONE, startDate: daysAhead(200), endDate: daysAhead(201) } })).status, 403);

    const suspended = await makeDoctor();
    await prisma.doctorProfile.update({ where: { id: suspended.doctor.id }, data: { accountStatus: 'SUSPENDED' } });
    const blocked = await api('PUT', '/api/v1/doctors/me/availability/schedule', { token: suspended.token, body: schedule() });
    assert.equal(blocked.status, 403, 'suspension takes effect on the very next request');
    assert.equal(await prisma.availabilitySlot.count({ where: { doctorId: suspended.doctor.id } }), 0);

    const patient = await prisma.user.create({ data: { email: `pat-${uniq()}@example.test`, fullName: 'Patient', passwordHash: await hashPassword(PASSWORD), roles: { create: [{ roleId: ctx.roles.PATIENT.id }] } } });
    await prisma.patientProfile.create({ data: { userId: patient.id } });
    const patientToken = (await api('POST', '/api/v1/auth/login', { body: { email: patient.email, password: PASSWORD } })).body.data.accessToken;
    assert.equal((await api('PUT', '/api/v1/doctors/me/availability/schedule', { token: patientToken, body: schedule() })).status, 403, 'patients have no availability permission');
    assert.equal((await api('GET', '/api/v1/doctors/me/availability')).status, 401);
  });

  test("a doctor cannot change another doctor's availability", async () => {
    const a = await makeDoctor();
    const b = await makeDoctor();
    await api('PUT', '/api/v1/doctors/me/availability/schedule', { token: a.token, body: schedule() });
    const ruleId = (await prisma.availabilityRule.findFirst({ where: { doctorId: a.doctor.id, isActive: true } })).id;
    const block = await api('POST', '/api/v1/doctors/me/availability/blocks', { token: a.token, body: { kind: 'DAYS', timeZone: ZONE, startDate: daysAhead(210), endDate: daysAhead(211) } });
    assert.equal(block.status, 201);

    assert.equal((await api('DELETE', `/api/v1/doctors/me/availability/rules/${ruleId}`, { token: b.token })).status, 404);
    assert.equal((await api('DELETE', `/api/v1/doctors/me/availability/blocks/${block.body.data.block.id}`, { token: b.token })).status, 404);
    assert.equal((await prisma.availabilityRule.findUnique({ where: { id: ruleId } })).isActive, true);
    assert.ok(await prisma.blockedDate.findUnique({ where: { id: block.body.data.block.id } }));
    const sneaky = await api('PUT', '/api/v1/doctors/me/availability/schedule', { token: b.token, body: { ...schedule(), doctorId: a.doctor.id } });
    assert.equal(sneaky.status, 400, 'unknown fields (mass assignment) rejected');

    const own = await api('DELETE', `/api/v1/doctors/me/availability/rules/${ruleId}`, { token: a.token });
    assert.equal(own.status, 200);
    assert.equal((await prisma.availabilityRule.findUnique({ where: { id: ruleId } })).isActive, false, 'soft-deleted, kept for history');
  });

  test('invalid working hours are rejected', async () => {
    const { token } = await makeDoctor();
    const cases = [
      schedule({ days: [{ dayOfWeek: 1, periods: [{ startTime: '17:00', endTime: '09:00' }] }] }),
      schedule({ days: [{ dayOfWeek: 1, periods: [{ startTime: '09:00', endTime: '12:00' }, { startTime: '11:30', endTime: '14:00' }] }] }),
      schedule({ days: [{ dayOfWeek: 1, periods: [{ startTime: '09:00', endTime: '09:10' }] }] }),
      schedule({ slotDurationMinutes: 15 }),
      schedule({ timeZone: 'Local/Server' }),
      schedule({ days: [{ dayOfWeek: 9, periods: MORNING }] }),
      schedule({ days: [{ dayOfWeek: 1, periods: [{ startTime: '9am', endTime: '5pm' }] }] }),
    ];
    for (const body of cases) {
      const res = await api('PUT', '/api/v1/doctors/me/availability/schedule', { token, body });
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    }
  });

  test('blocked dates and periods remove slots; unblocking restores them', async () => {
    const { doctor, token } = await makeDoctor();
    await api('PUT', '/api/v1/doctors/me/availability/schedule', { token, body: schedule() });
    const before = await futureSlots(doctor.id);
    const target = mogadishuDate(before[before.length - 1].startAtUtc);
    const onTarget = before.filter((s) => mogadishuDate(s.startAtUtc) === target).length;
    assert.equal(onTarget, 4);

    const block = await api('POST', '/api/v1/doctors/me/availability/blocks', { token, body: { kind: 'DAYS', timeZone: ZONE, startDate: target, endDate: target, reason: 'Conference' } });
    assert.equal(block.status, 201, JSON.stringify(block.body));
    assert.equal(block.body.data.slots.removed, onTarget);
    assert.equal((await futureSlots(doctor.id)).filter((s) => mogadishuDate(s.startAtUtc) === target).length, 0);
    assert.equal((await api('POST', '/api/v1/doctors/me/availability/blocks', { token, body: { kind: 'PERIOD', timeZone: ZONE, date: target, startTime: '10:00', endTime: '10:30' } })).body.error.code, 'BLOCK_OVERLAP');

    const period = await api('POST', '/api/v1/doctors/me/availability/blocks', { token, body: { kind: 'PERIOD', timeZone: ZONE, date: mogadishuDate(before[before.length - 5].startAtUtc), startTime: '10:00', endTime: '11:00' } });
    assert.equal(period.status, 201);
    assert.equal(period.body.data.slots.removed, 2, 'only the two slots inside the blocked period');

    assert.equal((await api('POST', '/api/v1/doctors/me/availability/blocks', { token, body: { kind: 'DAYS', timeZone: ZONE, startDate: '2020-01-01', endDate: '2020-01-02' } })).body.error.code, 'BLOCK_IN_PAST');

    const removed = await api('DELETE', `/api/v1/doctors/me/availability/blocks/${block.body.data.block.id}`, { token });
    assert.equal(removed.status, 200);
    assert.equal((await futureSlots(doctor.id)).filter((s) => mogadishuDate(s.startAtUtc) === target).length, onTarget);
    assert.ok(await prisma.auditLog.findFirst({ where: { entityType: 'BlockedDate', entityId: block.body.data.block.id, action: 'DELETE' } }));
  });

  test('overlapping slots are impossible and booked slots are never replaced', async () => {
    const { doctor, token } = await makeDoctor();
    await api('PUT', '/api/v1/doctors/me/availability/schedule', { token, body: schedule() });
    const [first] = await futureSlots(doctor.id);
    await assert.rejects(
      prisma.availabilitySlot.create({ data: { doctorId: doctor.id, startAtUtc: new Date(first.startAtUtc.getTime() + 10 * 60_000), endAtUtc: new Date(first.endAtUtc.getTime() + 10 * 60_000), timeZoneSnapshot: ZONE } }),
      /availability_slots_no_overlap|exclusion|conflicting key/i,
      'the database exclusion constraint rejects overlaps',
    );
    await prisma.availabilitySlot.update({ where: { id: first.id }, data: { status: 'BOOKED' } });
    const shifted = await api('PUT', '/api/v1/doctors/me/availability/schedule', { token, body: schedule({ days: ALL_DAYS([{ startTime: '09:15', endTime: '11:15' }]) }) });
    assert.equal(shifted.status, 200, JSON.stringify(shifted.body));
    const after = await prisma.availabilitySlot.findMany({ where: { doctorId: doctor.id, endAtUtc: { gt: new Date() } }, orderBy: { startAtUtc: 'asc' } });
    assert.ok(after.some((s) => s.id === first.id && s.status === 'BOOKED'), 'booked slot kept');
    for (let i = 1; i < after.length; i += 1) assert.ok(after[i].startAtUtc >= after[i - 1].endAtUtc, 'no overlaps');
  });

  test('slot generation never duplicates', async () => {
    const { doctor, token } = await makeDoctor();
    await api('PUT', '/api/v1/doctors/me/availability/schedule', { token, body: schedule() });
    const count = (await futureSlots(doctor.id)).length;
    const again = await api('PUT', '/api/v1/doctors/me/availability/schedule', { token, body: schedule() });
    assert.deepEqual(again.body.data.slots, { created: 0, removed: 0 });
    const job1 = await svc.syncAllDoctorSlots({ client: prisma });
    const job2 = await svc.syncAllDoctorSlots({ client: prisma });
    assert.equal(job2.created + job2.removed, 0, `second job run changes nothing (first: ${JSON.stringify(job1)})`);
    assert.equal((await futureSlots(doctor.id)).length, count);
  });

  test('timezones: rules in the doctor zone, storage in UTC, public days in the viewer zone', async () => {
    const { doctor, token } = await makeDoctor({ name: 'Dr. Zone Test' });
    const res = await api('PUT', '/api/v1/doctors/me/availability/schedule', { token, body: { timeZone: 'America/New_York', slotDurationMinutes: 20, days: ALL_DAYS([{ startTime: '20:00', endTime: '21:00' }]) } });
    assert.equal(res.status, 200);
    assert.equal((await prisma.user.findUnique({ where: { id: doctor.userId } })).timeZone, 'America/New_York', "the doctor's display zone follows the schedule");
    const slots = await futureSlots(doctor.id);
    const ny = (d) => new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
    assert.ok(slots.every((s) => ['20:00', '20:20', '20:40'].includes(ny(s.startAtUtc))), 'wall-clock 20:00–21:00 New York on every date, across any DST change');

    const pub = await api('GET', `/api/v1/doctors/${doctor.id}/slots?days=7&tz=Africa/Mogadishu`);
    assert.equal(pub.status, 200);
    assert.equal(pub.body.data.timeZone, 'Africa/Mogadishu');
    assert.equal(pub.body.data.doctorTimeZone, 'America/New_York');
    for (const day of pub.body.data.days) {
      for (const s of day.slots) assert.equal(mogadishuDate(new Date(s.startAtUtc)), day.date, '20:00 New York is the NEXT day in Mogadishu — grouped by the viewer date');
    }
    assert.equal(pub.body.data.days.length, 7);
    assert.equal((await api('GET', `/api/v1/doctors/${doctor.id}/slots?tz=Not/AZone`)).status, 400);
  });

  /* ------------------------------------------------------------ public directory */

  test('public directory: verified doctors only, with filters, search and sorting', async () => {
    const cheap = await makeDoctor({ name: 'Dr. Cheap Dermatologist', fee: '8.00', specialtyId: ctx.dermatology.id, languages: ['ar'] });
    const pricey = await makeDoctor({ name: 'Dr. Pricey Cardiologist', fee: '150.00', languages: ['en'] });
    const pending = await makeDoctor({ name: 'Dr. Pending Applicant', status: 'PENDING' });
    const suspended = await makeDoctor({ name: 'Dr. Suspended Person' });
    await prisma.doctorProfile.update({ where: { id: suspended.doctor.id }, data: { accountStatus: 'SUSPENDED' } });
    const noSlots = await makeDoctor({ name: 'Dr. No Free Slots' });
    const farAway = await makeDoctor({ name: 'Dr. Only Far Future' });
    await api('PUT', '/api/v1/doctors/me/availability/schedule', { token: cheap.token, body: schedule() });
    await api('PUT', '/api/v1/doctors/me/availability/schedule', { token: pricey.token, body: schedule() });
    const far = new Date(Date.now() + 40 * 86_400_000);
    await prisma.availabilitySlot.create({ data: { doctorId: farAway.doctor.id, startAtUtc: far, endAtUtc: new Date(far.getTime() + 30 * 60_000), timeZoneSnapshot: 'Africa/Mogadishu' } });

    const all = await api('GET', '/api/v1/doctors?pageSize=50');
    assert.equal(all.status, 200, 'no login required');
    const names = all.body.data.items.map((d) => d.name);
    assert.ok(names.includes(cheap.user.fullName) && names.includes(pricey.user.fullName));
    assert.ok(!names.includes(pending.user.fullName) && !names.includes(suspended.user.fullName), 'pending and suspended excluded');
    assert.ok(!names.includes(noSlots.user.fullName), 'no free slot → not in search');
    assert.ok(!names.includes(farAway.user.fullName), 'only slots beyond 30 days → not in search');
    assert.ok(all.body.data.items.every((d) => d.nextAvailableAt && Date.parse(d.nextAvailableAt) <= Date.now() + 30 * 86_400_000));
    assert.equal((await api('GET', `/api/v1/doctors/${noSlots.doctor.id}`)).status, 200, 'the profile page itself stays reachable');
    assert.equal((await api('GET', `/api/v1/doctors/${pending.doctor.id}`)).status, 404);
    assert.equal((await api('GET', `/api/v1/doctors/${suspended.doctor.id}/slots`)).status, 404);

    const byName = await api('GET', '/api/v1/doctors?q=pricey');
    assert.deepEqual(byName.body.data.items.map((d) => d.id), [pricey.doctor.id]);
    assert.ok((await api('GET', '/api/v1/doctors?q=maqaar')).body.data.items.some((d) => d.id === cheap.doctor.id), 'Somali specialty name matches');
    assert.ok((await api('GET', `/api/v1/doctors?specialtyId=${ctx.dermatology.id}&pageSize=50`)).body.data.items.every((d) => d.specialty.id === ctx.dermatology.id));
    assert.deepEqual((await api('GET', '/api/v1/doctors?language=ar')).body.data.items.map((d) => d.id), [cheap.doctor.id]);
    const band = (await api('GET', '/api/v1/doctors?minFee=100&maxFee=200&pageSize=50')).body.data.items;
    assert.ok(band.length >= 1 && band.every((d) => Number(d.consultationFee) >= 100));
    const low = (await api('GET', '/api/v1/doctors?sort=priceLow&pageSize=50')).body.data.items.map((d) => Number(d.consultationFee));
    assert.deepEqual(low, [...low].sort((x, y) => x - y));
    const high = (await api('GET', '/api/v1/doctors?sort=priceHigh&pageSize=50')).body.data.items.map((d) => Number(d.consultationFee));
    assert.deepEqual(high, [...high].sort((x, y) => y - x));
    const soon = (await api('GET', '/api/v1/doctors?sort=soonest&pageSize=50')).body.data.items;
    assert.ok(soon[0].nextAvailableAt, 'doctors with open slots first');
    const paged = await api('GET', '/api/v1/doctors?pageSize=1&page=2');
    assert.equal(paged.body.data.items.length, 1);
    assert.ok(paged.body.data.total >= 2);
    assert.equal((await api('GET', '/api/v1/doctors?sort=random')).status, 400);
    assert.equal((await api('GET', '/api/v1/doctors?minFee=50&maxFee=10')).status, 400);
    assert.equal((await api('GET', '/api/v1/doctors?verificationStatus=PENDING')).status, 400, 'unknown filters rejected');
  });

  test('public responses never expose licences, documents, verification records or contact details', async () => {
    const d = await makeDoctor({ name: 'Dr. Private Data' });
    await prisma.doctorDocument.create({ data: { doctorId: d.doctor.id, documentType: 'MEDICAL_LICENSE', fileKey: 'doctor-documents/secret-key.pdf', fileName: 'licence.pdf', mimeType: 'application/pdf', fileSize: 1000, versionNumber: 1 } });
    await prisma.verificationRequest.create({ data: { doctorId: d.doctor.id, status: 'APPROVED' } });
    await api('PUT', '/api/v1/doctors/me/availability/schedule', { token: d.token, body: schedule() });
    const responses = [await api('GET', '/api/v1/doctors?q=private'), await api('GET', `/api/v1/doctors/${d.doctor.id}`), await api('GET', `/api/v1/doctors/${d.doctor.id}/slots`)];
    for (const r of responses) {
      assert.equal(r.status, 200);
      const json = JSON.stringify(r.body);
      for (const secret of [d.doctor.licenceNumber, 'licence', 'fileKey', 'secret-key', d.email, 'verificationStatus', 'userId', 'passwordHash', 'APPROVED']) {
        assert.ok(!json.toLowerCase().includes(secret.toLowerCase()), `must not contain ${secret}`);
      }
    }
    const profile = responses[1].body.data;
    assert.deepEqual(Object.keys(profile).sort(), ['bio', 'consultationFee', 'country', 'currency', 'id', 'languages', 'name', 'nextAvailableAt', 'photoUrl', 'qualifications', 'rating', 'reviewCount', 'slotDurationMinutes', 'specialty', 'timeZone', 'verified', 'verifiedSince', 'yearsExperience'].sort());
  });

  test('authentication and registration still work', async () => {
    const email = `new-${uniq()}@example.test`;
    const reg = await api('POST', '/api/v1/auth/register', { body: { fullName: 'New Patient', email, password: PASSWORD, passwordConfirmation: PASSWORD } });
    assert.equal(reg.status, 201);
    const me = await api('GET', '/api/v1/auth/me', { token: reg.body.data.accessToken });
    assert.equal(me.status, 200);
    assert.deepEqual(me.body.data.user.roles ?? me.body.data.roles, ['PATIENT']);
  });
});
