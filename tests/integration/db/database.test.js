// Database integration tests — run against the configured Neon branch in an isolated schema.
// Skipped automatically when no development database is configured (e.g. CI without secrets).
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { databaseTestsSkipReason, setupTestDatabase } from './harness.js';
import { baseData, createCompletedConsultation, createDoctor, createPatient, createSlot, createUser } from './fixtures.js';

const skip = databaseTestsSkipReason();
const MIN = 60_000;
const HOUR = 60 * MIN;

describe('database (Neon, isolated schema)', { skip: skip ?? false }, () => {
  let db;
  let prisma;
  let ctx;
  let svc;

  before(async () => {
    db = await setupTestDatabase();
    prisma = db.prisma;
    ctx = await baseData(prisma);
    svc = {
      appointments: await import('../../../apps/api/src/modules/appointments/appointment.service.js'),
      payments: await import('../../../apps/api/src/modules/payments/payment.service.js'),
      refunds: await import('../../../apps/api/src/modules/refunds/refund.service.js'),
      ledger: await import('../../../apps/api/src/modules/ledger/ledger.service.js'),
      doctors: await import('../../../apps/api/src/modules/doctors/doctor.service.js'),
      history: await import('../../../apps/api/src/modules/medical-history/medicalHistory.service.js'),
      consultations: await import('../../../apps/api/src/modules/consultations/consultation.service.js'),
      prescriptions: await import('../../../apps/api/src/modules/prescriptions/prescription.service.js'),
    };
  });

  after(async () => {
    await db?.teardown();
  });

  const book = async (patient, doctor, opts = {}) => {
    const slot = await createSlot(prisma, doctor.id);
    const appointment = await svc.appointments.reserveSlot({ patientId: patient.id, slotId: slot.id, ...opts });
    return { slot, appointment };
  };
  const pay = (appointment, key = `key-${appointment.id}`, now) =>
    svc.payments.recordSuccessfulPayment({ appointmentId: appointment.id, provider: 'EVC_PLUS', providerReference: `ref-${key}`, idempotencyKey: key, now });
  const rejects409 = (promise, re) => assert.rejects(promise, (e) => e.status === 409 && (!re || re.test(e.message)));

  // Raw SQL resolves names via search_path (public), not Prisma's ?schema= — always name the test schema.
  test('connectivity, migrations and custom constraints are in place (in the isolated test schema)', async () => {
    const schema = db.schema;
    assert.deepEqual(await prisma.$queryRaw`SELECT 1::int AS ok`, [{ ok: 1 }]);
    const [{ tables }] = await prisma.$queryRaw`SELECT count(*)::int AS tables FROM information_schema.tables WHERE table_schema = ${schema} AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations'`;
    assert.equal(tables, 41); // 37 approved + user_identities + push_subscriptions, notification_preferences, appointment_reminders
    const constraints = (await prisma.$queryRaw`SELECT conname FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = ${schema}`).map((r) => r.conname);
    for (const name of ['users_email_or_phone_required', 'doctor_fee_range', 'availability_rule_slot_duration', 'availability_slots_no_overlap', 'review_rating_range', 'consultation_attachment_size_limit', 'appointment_time_order']) {
      assert.ok(constraints.includes(name), `missing constraint ${name}`);
    }
    const indexes = (await prisma.$queryRaw`SELECT indexname FROM pg_indexes WHERE schemaname = ${schema}`).map((r) => r.indexname);
    assert.ok(indexes.includes('appointments_one_active_per_slot'));
    assert.ok(indexes.includes('doctor_documents_one_current_version'));
    const triggers = (
      await prisma.$queryRaw`SELECT t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE NOT t.tgisinternal AND c.relname = 'financial_transactions' AND n.nspname = ${schema}`
    ).map((r) => r.tgname);
    assert.deepEqual(triggers.sort(), ['financial_transactions_append_only', 'financial_transactions_no_truncate']);
  });

  test('one user can hold multiple roles', async () => {
    const user = await createUser(prisma, ctx, ['DOCTOR', 'PATIENT']);
    const loaded = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, include: { roles: { include: { role: true } } } });
    assert.deepEqual(loaded.roles.map((r) => r.role.name).sort(), ['DOCTOR', 'PATIENT']);
    await assert.rejects(prisma.userRole.create({ data: { userId: user.id, roleId: ctx.roles.DOCTOR.id } }), /Unique constraint/);
  });

  test('CHECK and exclusion constraints reject invalid data', async () => {
    await assert.rejects(prisma.user.create({ data: { fullName: 'No Login', passwordHash: 'x' } }), /users_email_or_phone_required/);
    const { user } = await createPatient(prisma, ctx);
    const doctorUser = await createUser(prisma, ctx, ['DOCTOR']);
    await assert.rejects(
      prisma.doctorProfile.create({ data: { userId: doctorUser.id, specialtyId: ctx.specialty.id, licenceNumber: 'L', licenceCountry: 'SO', consultationFee: '250.00' } }),
      /doctor_fee_range/,
    );
    const { doctor } = await createDoctor(prisma, ctx);
    const slot = await createSlot(prisma, doctor.id);
    await assert.rejects(
      prisma.availabilitySlot.create({
        data: { doctorId: doctor.id, startAtUtc: new Date(slot.startAtUtc.getTime() + 10 * MIN), endAtUtc: new Date(slot.endAtUtc.getTime() + 10 * MIN), timeZoneSnapshot: 'UTC' },
      }),
      /availability_slots_no_overlap/,
    );
    await assert.rejects(
      prisma.availabilityRule.create({
        data: { doctorId: doctor.id, dayOfWeek: 1, startLocalTime: new Date('1970-01-01T09:00:00Z'), endLocalTime: new Date('1970-01-01T12:00:00Z'), timeZone: 'UTC', slotDurationMinutes: 45, effectiveFrom: new Date() },
      }),
      /availability_rule_slot_duration/,
    );
    assert.ok(user);
  });

  test('model relationships load end-to-end', async () => {
    const { patient } = await createPatient(prisma, ctx);
    const { doctor } = await createDoctor(prisma, ctx);
    const { appointment } = await book(patient, doctor);
    await pay(appointment);
    const loaded = await prisma.appointment.findUniqueOrThrow({
      where: { id: appointment.id },
      include: {
        patient: { include: { user: true } },
        doctor: { include: { specialty: true, user: true } },
        slot: true,
        payment: { include: { attempts: true, transactions: true, patient: true } },
        earning: true,
        statusHistory: { orderBy: { createdAt: 'asc' } },
      },
    });
    assert.equal(loaded.patient.id, patient.id);
    assert.equal(loaded.doctor.specialty.nameEn, 'Cardiology');
    assert.equal(loaded.slot.status, 'BOOKED');
    assert.equal(loaded.payment.patient.id, patient.id);
    assert.equal(loaded.payment.attempts.length, 1);
    assert.equal(loaded.payment.transactions.length, 3);
    assert.equal(loaded.earning.netAmount.toString(), '17');
    assert.deepEqual(loaded.statusHistory.map((h) => h.toStatus), ['PENDING_PAYMENT', 'CONFIRMED']);
  });

  test('slot reservation holds for 10 minutes and cancellation releases the slot', async () => {
    const { patient } = await createPatient(prisma, ctx);
    const { doctor } = await createDoctor(prisma, ctx);
    const now = new Date();
    const slot = await createSlot(prisma, doctor.id);
    const appointment = await svc.appointments.reserveSlot({ patientId: patient.id, slotId: slot.id, now });
    assert.equal(appointment.status, 'PENDING_PAYMENT');
    assert.equal(appointment.holdExpiresAt.getTime(), now.getTime() + 10 * MIN);
    assert.equal(appointment.feeAmount.toString(), '20');
    let s = await prisma.availabilitySlot.findUniqueOrThrow({ where: { id: slot.id } });
    assert.equal(s.status, 'HELD');

    await svc.appointments.cancelAppointment({ appointmentId: appointment.id, reason: 'Changed my mind' });
    s = await prisma.availabilitySlot.findUniqueOrThrow({ where: { id: slot.id } });
    assert.equal(s.status, 'AVAILABLE');

    const again = await svc.appointments.reserveSlot({ patientId: patient.id, slotId: slot.id });
    assert.equal(again.slotId, slot.id);
    const history = await prisma.appointment.findMany({ where: { slotId: slot.id } });
    assert.deepEqual(history.map((a) => a.status).sort(), ['CANCELLED', 'PENDING_PAYMENT']);
  });

  test('payment after the 10-minute window is rejected; expiry releases the slot', async () => {
    const { patient } = await createPatient(prisma, ctx);
    const { doctor } = await createDoctor(prisma, ctx);
    const t0 = new Date();
    const slot = await createSlot(prisma, doctor.id);
    const appointment = await svc.appointments.reserveSlot({ patientId: patient.id, slotId: slot.id, now: t0 });

    await rejects409(pay(appointment, `late-${appointment.id}`, new Date(t0.getTime() + 11 * MIN)), /expired/);
    assert.equal((await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).status, 'PENDING_PAYMENT');
    assert.equal(await prisma.payment.count({ where: { appointmentId: appointment.id } }), 0);

    const expired = await svc.appointments.expireStaleHolds({ now: new Date(t0.getTime() + 11 * MIN) });
    assert.ok(expired >= 1);
    assert.equal((await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).status, 'EXPIRED');
    assert.equal((await prisma.availabilitySlot.findUniqueOrThrow({ where: { id: slot.id } })).status, 'AVAILABLE');
  });

  test('a stale hold is expired automatically when another patient reserves the slot', async () => {
    const a = await createPatient(prisma, ctx);
    const b = await createPatient(prisma, ctx);
    const { doctor } = await createDoctor(prisma, ctx);
    const t0 = new Date();
    const slot = await createSlot(prisma, doctor.id);
    const first = await svc.appointments.reserveSlot({ patientId: a.patient.id, slotId: slot.id, now: t0 });
    await rejects409(svc.appointments.reserveSlot({ patientId: b.patient.id, slotId: slot.id, now: new Date(t0.getTime() + 5 * MIN) }), /held/);
    const second = await svc.appointments.reserveSlot({ patientId: b.patient.id, slotId: slot.id, now: new Date(t0.getTime() + 10 * MIN + 1000) });
    assert.equal(second.patientId, b.patient.id);
    assert.equal((await prisma.appointment.findUniqueOrThrow({ where: { id: first.id } })).status, 'EXPIRED');
  });

  test('duplicate active bookings are prevented (concurrent requests and the partial unique index)', async () => {
    const a = await createPatient(prisma, ctx);
    const b = await createPatient(prisma, ctx);
    const { doctor } = await createDoctor(prisma, ctx);
    const slot = await createSlot(prisma, doctor.id);
    const results = await Promise.allSettled([
      svc.appointments.reserveSlot({ patientId: a.patient.id, slotId: slot.id }),
      svc.appointments.reserveSlot({ patientId: b.patient.id, slotId: slot.id }),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(results.find((r) => r.status === 'rejected').reason.status, 409);

    // Even a direct insert that bypasses the service cannot create a second active appointment.
    await assert.rejects(
      prisma.appointment.create({
        data: { patientId: b.patient.id, doctorId: doctor.id, slotId: slot.id, status: 'CONFIRMED', feeAmount: '20', commissionRateSnapshot: '0.15', startAtUtc: slot.startAtUtc, endAtUtc: slot.endAtUtc },
      }),
      /Unique constraint/,
    );
  });

  test('follow-up bookings get a 48-hour deadline and must reference a completed consultation', async () => {
    const { patient } = await createPatient(prisma, ctx);
    const { doctor } = await createDoctor(prisma, ctx);
    const { consultation } = await createCompletedConsultation(prisma, { patient, doctor });
    const slot = await createSlot(prisma, doctor.id, { hoursAhead: 24 * 7 });
    await assert.rejects(
      svc.appointments.reserveSlot({ patientId: patient.id, slotId: slot.id, bookingType: 'FOLLOW_UP', followUpOfConsultationId: consultation.id }),
      (e) => e.status === 400,
    );
    await prisma.consultation.update({ where: { id: consultation.id }, data: { status: 'COMPLETED', completedAt: new Date() } });
    const now = new Date();
    const followUp = await svc.appointments.reserveSlot({ patientId: patient.id, slotId: slot.id, bookingType: 'FOLLOW_UP', followUpOfConsultationId: consultation.id, now });
    assert.equal(followUp.holdExpiresAt.getTime(), now.getTime() + 48 * HOUR);
    assert.equal(followUp.followUpOfConsultationId, consultation.id);
  });

  test('payments are idempotent and the ledger balances', async () => {
    const { patient } = await createPatient(prisma, ctx);
    const { doctor } = await createDoctor(prisma, ctx, { fee: '25.00' });
    const { appointment } = await book(patient, doctor);
    const p1 = await pay(appointment, 'same-key-1');
    const p2 = await pay(appointment, 'same-key-1');
    assert.equal(p1.id, p2.id);
    const entries = await prisma.financialTransaction.findMany({ where: { paymentId: p1.id } });
    assert.deepEqual(entries.map((e) => `${e.type}:${e.amount}`).sort(), ['DOCTOR_EARNING:21.25', 'PAYMENT:25', 'PLATFORM_COMMISSION:3.75']);
    const report = await svc.ledger.verifyPaymentLedger(p1.id);
    assert.ok(report.ok, report.problems.join('; '));
    await rejects409(pay(appointment, 'another-key'), /not awaiting payment|already has a payment/);
  });

  test('posted ledger entries are immutable and the ledger is append-only', async () => {
    const { patient } = await createPatient(prisma, ctx);
    const { doctor } = await createDoctor(prisma, ctx);
    const { appointment } = await book(patient, doctor);
    const payment = await pay(appointment);
    const entry = await prisma.financialTransaction.findFirstOrThrow({ where: { paymentId: payment.id, type: 'PAYMENT' } });
    await assert.rejects(prisma.financialTransaction.update({ where: { id: entry.id }, data: { amount: '1.00' } }), /POSTED and immutable/);
    await assert.rejects(prisma.financialTransaction.update({ where: { id: entry.id }, data: { status: 'REVERSED' } }), /POSTED and immutable/);
    await assert.rejects(prisma.financialTransaction.delete({ where: { id: entry.id } }), /append-only/);
    await assert.rejects(prisma.$executeRawUnsafe(`TRUNCATE "${db.schema}".financial_transactions`), /append-only/);
    const pending = await prisma.financialTransaction.create({ data: { type: 'ADJUSTMENT', amount: '1.00', currency: 'USD', reference: `pending-${entry.id}` } });
    const posted = await prisma.financialTransaction.update({ where: { id: pending.id }, data: { status: 'POSTED' } });
    assert.equal(posted.status, 'POSTED');
    await assert.rejects(prisma.financialTransaction.delete({ where: { id: pending.id } }), /append-only/);
  });

  test('refunds: partial, over-refund guard, failure visible to admins, retry and full refund', async () => {
    const admin = await createUser(prisma, ctx, ['ADMIN']);
    const { patient } = await createPatient(prisma, ctx);
    const { doctor } = await createDoctor(prisma, ctx, { fee: '20.00' });
    const { appointment } = await book(patient, doctor);
    const payment = await pay(appointment);

    const partial = await svc.refunds.requestRefund({ appointmentId: appointment.id, amount: '5.00', reason: 'Partial goodwill refund' });
    await rejects409(svc.refunds.requestRefund({ appointmentId: appointment.id, amount: '15.01', reason: 'Too much' }), /exceeds/);
    await svc.refunds.completeRefund({ refundId: partial.id, providerReference: 'r-1' });
    assert.equal((await prisma.doctorEarning.findUniqueOrThrow({ where: { appointmentId: appointment.id } })).status, 'PARTIALLY_REFUNDED');

    const failing = await svc.refunds.requestRefund({ appointmentId: appointment.id, reason: 'Remaining balance' });
    assert.equal(failing.amount.toString(), '15');
    await svc.refunds.failRefund({ refundId: failing.id, error: 'Provider timeout (EVC Plus)' });
    const queue = await svc.refunds.listFailedRefunds();
    const visible = queue.find((r) => r.id === failing.id);
    assert.ok(visible, 'failed refund is listed for admins');
    assert.match(visible.failureReason, /Provider timeout/);
    const alert = await prisma.notification.findFirst({ where: { userId: admin.id, type: 'REFUND' } });
    assert.ok(alert, 'admins are notified of the failure');
    await rejects409(svc.refunds.completeRefund({ refundId: failing.id }), /already FAILED/);

    const retry = await svc.refunds.requestRefund({ appointmentId: appointment.id, reason: 'Retry remaining balance' });
    assert.equal(retry.amount.toString(), '15');
    await svc.refunds.completeRefund({ refundId: retry.id, providerReference: 'r-2' });
    await rejects409(svc.refunds.requestRefund({ appointmentId: appointment.id, reason: 'Nothing left' }), /Nothing left/);

    assert.equal((await prisma.doctorEarning.findUniqueOrThrow({ where: { appointmentId: appointment.id } })).status, 'REFUNDED');
    const report = await svc.ledger.verifyPaymentLedger(payment.id);
    assert.ok(report.ok, report.problems.join('; '));
    assert.equal(report.refunded.toString(), '20');
  });

  test('doctor suspension cancels future eligible appointments and requests full refunds', async () => {
    const admin = await createUser(prisma, ctx, ['ADMIN']);
    const p1 = await createPatient(prisma, ctx);
    const p2 = await createPatient(prisma, ctx);
    const { doctor } = await createDoctor(prisma, ctx, { fee: '30.00' });

    const paid = await book(p1.patient, doctor);
    await pay(paid.appointment);
    const pending = await book(p2.patient, doctor);
    const past = await createCompletedConsultation(prisma, { patient: p1.patient, doctor });
    const openSlot = await createSlot(prisma, doctor.id);

    const result = await svc.doctors.suspendDoctor({ doctorId: doctor.id, adminUserId: admin.id, reason: 'Licence under investigation' });
    assert.deepEqual(result.cancelledAppointmentIds.sort(), [paid.appointment.id, pending.appointment.id].sort());
    assert.equal(result.refunds.length, 1);
    assert.equal(result.refunds[0].amount.toString(), '30');
    assert.equal(result.refunds[0].status, 'REQUESTED');

    for (const a of [paid.appointment, pending.appointment]) {
      const row = await prisma.appointment.findUniqueOrThrow({ where: { id: a.id }, include: { slot: true } });
      assert.equal(row.status, 'CANCELLED');
      assert.equal(row.slot.status, 'CANCELLED');
    }
    assert.equal((await prisma.appointment.findUniqueOrThrow({ where: { id: past.appointment.id } })).status, 'COMPLETED');
    assert.ok(await prisma.auditLog.findFirst({ where: { action: 'SUSPEND', entityId: doctor.id } }));
    // One cancellation notice per affected patient (p1 also has the earlier "payment confirmed").
    assert.equal(await prisma.notification.count({ where: { userId: { in: [p1.user.id, p2.user.id] }, eventKey: { startsWith: 'appointment.cancelled:' } } }), 2);
    assert.ok(await prisma.notification.findFirst({ where: { eventKey: { startsWith: 'account.doctor_suspended:' } } }), 'the doctor is told');

    const visible = await svc.doctors.searchDoctors();
    assert.ok(!visible.some((d) => d.id === doctor.id), 'suspended doctor hidden from search');
    await rejects409(svc.appointments.reserveSlot({ patientId: p2.patient.id, slotId: openSlot.id }), /not verified or not active/);
  });

  test('verification gates search and publishing; licence replacement triggers re-verification and keeps versions', async () => {
    const admin = await createUser(prisma, ctx, ['ADMIN']);
    const { doctor } = await createDoctor(prisma, ctx, { verified: false });
    assert.ok(!(await svc.doctors.searchDoctors()).some((d) => d.id === doctor.id));
    const start = new Date(Date.now() + 90 * 24 * HOUR);
    const slots = [{ startAtUtc: start, endAtUtc: new Date(start.getTime() + 30 * MIN), timeZone: 'Africa/Mogadishu' }];
    await assert.rejects(svc.doctors.publishSlots({ doctorId: doctor.id, slots }), (e) => e.status === 403);

    const doc = { documentType: 'MEDICAL_LICENSE', fileKey: 'private/licence-v1.pdf', fileName: 'licence.pdf', mimeType: 'application/pdf', fileSize: 1024 };
    await svc.doctors.addDocumentVersion({ doctorId: doctor.id, ...doc });
    const request = await prisma.verificationRequest.create({ data: { doctorId: doctor.id } });
    await svc.doctors.reviewVerification({ verificationRequestId: request.id, reviewerUserId: admin.id, status: 'APPROVED' });
    assert.ok((await svc.doctors.searchDoctors()).some((d) => d.id === doctor.id));
    assert.equal((await svc.doctors.publishSlots({ doctorId: doctor.id, slots })).length, 1);

    const { verificationRequest } = await svc.doctors.addDocumentVersion({ doctorId: doctor.id, ...doc, fileKey: 'private/licence-v2.pdf' });
    assert.ok(verificationRequest, 'new verification request opened');
    assert.equal((await prisma.doctorProfile.findUniqueOrThrow({ where: { id: doctor.id } })).verificationStatus, 'PENDING');
    assert.ok(!(await svc.doctors.searchDoctors()).some((d) => d.id === doctor.id));
    const versions = await prisma.doctorDocument.findMany({ where: { doctorId: doctor.id }, orderBy: { versionNumber: 'asc' } });
    assert.deepEqual(versions.map((v) => [v.versionNumber, v.isCurrent]), [[1, false], [2, true]]);
    assert.equal(versions[1].replacesDocumentId, versions[0].id);
    await assert.rejects(prisma.doctorDocument.update({ where: { id: versions[0].id }, data: { isCurrent: true } }), /Unique constraint/);
  });

  test('medical history: patient ownership and doctor authorship', async () => {
    const { user: patientUser, patient } = await createPatient(prisma, ctx);
    const { user: doctorUser, doctor } = await createDoctor(prisma, ctx);
    const { user: otherDoctorUser } = await createDoctor(prisma, ctx);
    const { consultation } = await createCompletedConsultation(prisma, { patient, doctor });

    const own = await svc.history.addEntry({ actorUserId: patientUser.id, patientId: patient.id, entryType: 'ALLERGY', title: 'Penicillin' });
    assert.equal(own.source, 'PATIENT');
    const byDoctor = await svc.history.addEntry({ actorUserId: doctorUser.id, patientId: patient.id, consultationId: consultation.id, entryType: 'CONDITION', title: 'Hypertension' });
    assert.equal(byDoctor.source, 'DOCTOR');
    assert.equal(byDoctor.createdByUserId, doctorUser.id);

    await assert.rejects(svc.history.addEntry({ actorUserId: otherDoctorUser.id, patientId: patient.id, entryType: 'OTHER', title: 'x' }), (e) => e.status === 403);

    // Phase 9 rule: the patient cannot edit a doctor-written entry (they may archive it instead).
    await assert.rejects(
      svc.history.updateEntry({ actorUserId: patientUser.id, entryId: byDoctor.id, changes: { description: 'Controlled with medication' } }),
      (e) => e.status === 403 && e.code === 'HISTORY_DOCTOR_ENTRY_READ_ONLY',
    );
    const edited = await svc.history.updateEntry({ actorUserId: doctorUser.id, entryId: byDoctor.id, changes: { description: 'Controlled with medication' } });
    assert.equal(edited.createdByUserId, doctorUser.id, 'doctor keeps authorship');
    assert.equal(edited.source, 'DOCTOR');
    assert.equal(edited.updatedByUserId, doctorUser.id);
    const ownEdited = await svc.history.updateEntry({ actorUserId: patientUser.id, entryId: own.id, changes: { description: 'Rash and swelling' } });
    assert.equal(ownEdited.updatedByUserId, patientUser.id);

    await assert.rejects(svc.history.updateEntry({ actorUserId: doctorUser.id, entryId: own.id, changes: { title: 'x' } }), (e) => e.status === 403);
    await assert.rejects(svc.history.updateEntry({ actorUserId: doctorUser.id, entryId: byDoctor.id, changes: { createdByUserId: patientUser.id } }), (e) => e.status === 400);
    const loaded = await prisma.medicalHistoryEntry.findUniqueOrThrow({ where: { id: byDoctor.id }, include: { author: true, editor: true } });
    assert.equal(loaded.author.id, doctorUser.id);
    assert.equal(loaded.editor.id, doctorUser.id);
  });

  test('consultation notes lock 24 hours after the consultation', async () => {
    const { patient } = await createPatient(prisma, ctx);
    const { user: doctorUser, doctor } = await createDoctor(prisma, ctx);
    const { user: otherDoctorUser } = await createDoctor(prisma, ctx);
    const { consultation } = await createCompletedConsultation(prisma, { patient, doctor });
    const t = new Date();
    await svc.consultations.saveNote({ consultationId: consultation.id, actorUserId: doctorUser.id, fields: { complaint: 'Headache, 3 days' }, now: t });
    await svc.consultations.completeConsultation({ consultationId: consultation.id, actorUserId: doctorUser.id, now: t });

    const ok = await svc.consultations.saveNote({ consultationId: consultation.id, actorUserId: doctorUser.id, fields: { diagnosis: 'Tension headache' }, now: new Date(t.getTime() + 23 * HOUR) });
    assert.equal(ok.diagnosis, 'Tension headache');
    assert.equal(ok.lockedAt.getTime(), t.getTime() + 24 * HOUR);
    await assert.rejects(
      svc.consultations.saveNote({ consultationId: consultation.id, actorUserId: doctorUser.id, fields: { advice: 'late edit' }, now: new Date(t.getTime() + 24 * HOUR) }),
      (e) => e.status === 423,
    );
    await assert.rejects(svc.consultations.saveNote({ consultationId: consultation.id, actorUserId: otherDoctorUser.id, fields: { advice: 'x' }, now: t }), (e) => e.status === 403);
  });

  test('prescription QR verification exposes no patient or clinical data', async () => {
    const { patient } = await createPatient(prisma, ctx);
    const { doctor } = await createDoctor(prisma, ctx);
    const { consultation } = await createCompletedConsultation(prisma, { patient, doctor });
    const token = svc.prescriptions.newVerificationToken();
    // Phase 10 lifecycle: medicine lines are written while DRAFT, then the prescription is issued (VALID).
    const draft = await prisma.prescription.create({
      data: {
        consultationId: consultation.id,
        patientId: patient.id,
        doctorId: doctor.id,
        status: 'DRAFT',
        issuedAt: null,
        items: { create: [{ medicineName: 'Paracetamol', dose: '500 mg', frequency: 'Every 8 hours', duration: '3 days' }] },
      },
    });
    await prisma.prescription.update({ where: { id: draft.id }, data: { status: 'VALID', issuedAt: new Date(), verificationTokenHash: svc.prescriptions.hashVerificationToken(token) } });
    const result = await svc.prescriptions.verifyPrescriptionToken(token);
    assert.equal(result.valid, true);
    assert.deepEqual(Object.keys(result).sort(), ['cancelledAt', 'issuedAt', 'issuedBy', 'status', 'valid']);
    const serialized = JSON.stringify(result);
    for (const leaked of [patient.id, 'Paracetamol', consultation.id]) assert.ok(!serialized.includes(leaked), `leaks ${leaked}`);
    assert.deepEqual(await svc.prescriptions.verifyPrescriptionToken('not-a-real-token-value'), { valid: false });
  });
});

if (skip) test(`database tests skipped: ${skip}`, { skip: true }, () => {});
