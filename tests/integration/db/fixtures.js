// Small builders for database tests. All rows live in the per-run test schema.
import { randomBytes } from 'node:crypto';

const uid = () => randomBytes(4).toString('hex');
let slotCursor = 0;

export async function baseData(prisma) {
  const roles = {};
  for (const name of ['PATIENT', 'DOCTOR', 'ADMIN']) roles[name] = await prisma.role.create({ data: { name } });
  const specialty = await prisma.specialty.create({ data: { nameEn: 'Cardiology', nameSo: 'Wadnaha' } });
  await prisma.platformSetting.create({ data: { key: 'commission_rate', value: { rate: '0.1500' } } });
  return { roles, specialty };
}

export async function createUser(prisma, ctx, roleNames, extra = {}) {
  return prisma.user.create({
    data: {
      email: `user-${uid()}@fogaandawo.test`,
      fullName: extra.fullName ?? `Test User ${uid()}`,
      passwordHash: 'scrypt$test',
      roles: { create: roleNames.map((r) => ({ roleId: ctx.roles[r].id })) },
    },
  });
}

export async function createPatient(prisma, ctx) {
  const user = await createUser(prisma, ctx, ['PATIENT']);
  const patient = await prisma.patientProfile.create({ data: { userId: user.id } });
  return { user, patient };
}

export async function createDoctor(prisma, ctx, { verified = true, fee = '20.00' } = {}) {
  const user = await createUser(prisma, ctx, ['DOCTOR'], { fullName: `Dr. Test ${uid()}` });
  const doctor = await prisma.doctorProfile.create({
    data: {
      userId: user.id,
      specialtyId: ctx.specialty.id,
      licenceNumber: `LIC-${uid()}`,
      licenceCountry: 'Somalia',
      consultationFee: fee,
      verificationStatus: verified ? 'VERIFIED' : 'PENDING',
      verifiedAt: verified ? new Date() : null,
    },
  });
  return { user, doctor };
}

/** A 30-minute slot starting `hoursAhead` from `from`; each call gets a distinct time to avoid overlaps. */
export async function createSlot(prisma, doctorId, { from = new Date(), hoursAhead = 48 } = {}) {
  slotCursor += 1;
  const startAtUtc = new Date(from.getTime() + hoursAhead * 3_600_000 + slotCursor * 3_600_000);
  return prisma.availabilitySlot.create({
    data: { doctorId, startAtUtc, endAtUtc: new Date(startAtUtc.getTime() + 30 * 60_000), timeZoneSnapshot: 'Africa/Mogadishu' },
  });
}

/** A completed appointment + consultation between a patient and doctor (for history/notes/follow-up tests). */
export async function createCompletedConsultation(prisma, { patient, doctor }) {
  const slot = await createSlot(prisma, doctor.id, { from: new Date(Date.now() - 30 * 24 * 3_600_000) });
  const appointment = await prisma.appointment.create({
    data: {
      patientId: patient.id,
      doctorId: doctor.id,
      slotId: slot.id,
      status: 'COMPLETED',
      feeAmount: doctor.consultationFee,
      commissionRateSnapshot: '0.1500',
      startAtUtc: slot.startAtUtc,
      endAtUtc: slot.endAtUtc,
    },
  });
  const consultation = await prisma.consultation.create({
    data: { appointmentId: appointment.id, patientId: patient.id, doctorId: doctor.id, status: 'IN_PROGRESS', startedAt: slot.startAtUtc },
  });
  return { slot, appointment, consultation };
}
