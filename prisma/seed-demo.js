/**
 * Realistic DEMO data for development databases (baseline: "realistic seed data — Somali names, real
 * cities, realistic amounts"). Called by prisma/seed.js after the base accounts exist. Idempotent: people
 * are upserted by email and the demo bookings are created only once (marker: appointment reasons that
 * start with "Demo:").
 *
 * The real services are reused so demo rows follow the same rules as the app: weekly availability through
 * the availability service (slots in UTC from each doctor's own zone) and payments through
 * postSuccessfulPayment (ledger, commission and doctor earnings).
 */
import { randomBytes } from 'node:crypto';

const H = 3_600_000;
const DAY = 24 * H;

/** Doctors in several countries and time zones (the core scheduling challenge). Fees in USD, $5–$200. */
export const DEMO_DOCTORS = [
  { email: 'dr.hodan.axmed@fogaandawo.test', name: 'Dr. Hodan Axmed', specialty: 'Dermatology', fee: '18.00', years: 8, languages: ['so', 'en', 'ar'], country: 'Somalia', zone: 'Africa/Mogadishu', city: 'Hargeisa', bio: 'Dermatologist in Hargeisa with eight years of practice treating eczema, acne, fungal infections and skin allergies in adults and children.' },
  { email: 'dr.cabdiwali.nuur@fogaandawo.test', name: 'Dr. Cabdiwali Nuur', specialty: 'Pediatrics', fee: '25.00', years: 14, languages: ['so', 'en'], country: 'United Kingdom', zone: 'Europe/London', city: 'London', bio: 'Paediatrician at a London hospital, consulting Somali families on child growth, fevers, vaccination schedules and asthma.' },
  { email: 'dr.faadumo.warsame@fogaandawo.test', name: 'Dr. Faadumo Warsame', specialty: "Women's Health", fee: '22.00', years: 11, languages: ['so', 'en', 'sw'], country: 'Kenya', zone: 'Africa/Nairobi', city: 'Nairobi', bio: 'Obstetrician-gynaecologist in Nairobi supporting antenatal care, family planning and women’s health questions in Somali and English.' },
  { email: 'dr.axmed.jaamac@fogaandawo.test', name: 'Dr. Axmed Jaamac', specialty: 'Mental Health', fee: '35.00', years: 9, languages: ['so', 'en'], country: 'Canada', zone: 'America/Toronto', city: 'Toronto', bio: 'Psychiatrist in Toronto offering confidential consultations for anxiety, depression, sleep problems and trauma, with cultural understanding.' },
  { email: 'dr.ifraax.cismaan@fogaandawo.test', name: 'Dr. Ifraax Cismaan', specialty: 'Nutrition', fee: '15.00', years: 6, languages: ['so', 'en', 'ar'], country: 'United Arab Emirates', zone: 'Asia/Dubai', city: 'Dubai', bio: 'Clinical nutritionist in Dubai advising on diabetes diets, child nutrition, weight management and healthy eating during Ramadan.' },
];

/** A doctor whose application is still waiting for review (for the "verify a doctor" demo step). */
export const PENDING_DOCTOR = { email: 'dr.yuusuf.xirsi@fogaandawo.test', name: 'Dr. Yuusuf Xirsi', specialty: 'Orthopedics', fee: '30.00', years: 7, languages: ['so', 'en'], country: 'Somalia', zone: 'Africa/Mogadishu', bio: 'Orthopaedic surgeon in Garowe treating fractures, back pain and joint problems, with follow-up after surgery.' };

/** Patients in real Somali cities, with Somali mobile numbers (+252). */
export const DEMO_PATIENTS = [
  { email: 'cabdullaahi.xasan@fogaandawo.test', phone: '+252634110002', name: 'Cabdullaahi Xasan', sex: 'male', dob: '1985-09-03', city: 'Hargeisa' },
  { email: 'faadumo.nuur@fogaandawo.test', phone: '+252615220003', name: 'Faadumo Nuur', sex: 'female', dob: '1992-01-21', city: 'Kismaayo' },
  { email: 'maryan.jaamac@fogaandawo.test', phone: '+252617330004', name: 'Maryan Jaamac', sex: 'female', dob: '1979-06-30', city: 'Baydhabo' },
  { email: 'xasan.maxamed@fogaandawo.test', phone: '+252907440005', name: 'Xasan Maxamed', sex: 'male', dob: '1968-11-12', city: 'Boosaaso' },
  { email: 'sahra.cali@fogaandawo.test', phone: '+252907550006', name: 'Sahra Cali', sex: 'female', dob: '2001-03-08', city: 'Garowe' },
  { email: 'bashiir.aadan@fogaandawo.test', phone: '+252612660007', name: 'Bashiir Aadan', sex: 'male', dob: '1995-07-17', city: 'Beledweyne' },
];

/** Weekly availability in each doctor's OWN zone (stored in UTC by the availability service). */
const SCHEDULES = {
  'dr.maxamed.faarax@fogaandawo.test': { timeZone: 'Africa/Mogadishu', slotDurationMinutes: 30, days: [1, 3, 6], start: '16:00', end: '19:00' },
  'dr.cali.yuusuf@fogaandawo.test': { timeZone: 'America/Chicago', slotDurationMinutes: 20, days: [0, 2, 4], start: '10:00', end: '13:00' },
  'dr.hodan.axmed@fogaandawo.test': { timeZone: 'Africa/Mogadishu', slotDurationMinutes: 20, days: [0, 2, 4], start: '09:00', end: '12:00' },
  'dr.cabdiwali.nuur@fogaandawo.test': { timeZone: 'Europe/London', slotDurationMinutes: 30, days: [1, 3, 6], start: '18:00', end: '21:00' },
  'dr.faadumo.warsame@fogaandawo.test': { timeZone: 'Africa/Nairobi', slotDurationMinutes: 30, days: [1, 2, 4], start: '14:00', end: '17:00' },
  'dr.axmed.jaamac@fogaandawo.test': { timeZone: 'America/Toronto', slotDurationMinutes: 30, days: [2, 5], start: '08:00', end: '11:00' },
  'dr.ifraax.cismaan@fogaandawo.test': { timeZone: 'Asia/Dubai', slotDurationMinutes: 20, days: [0, 3, 5], start: '19:00', end: '22:00' },
};

/** Past consultations: [patient email, doctor email, days ago, rating, comment, notes]. */
const PAST = [
  ['amina.cabdi@fogaandawo.test', 'dr.maxamed.faarax@fogaandawo.test', 21, 5, 'Dr. Maxamed explained my blood pressure results clearly. Very patient.', { complaint: 'Headaches and high blood pressure readings at home for two weeks.', assessment: 'BP 152/96, no chest pain, no neurological signs.', diagnosis: 'Stage 2 hypertension.', advice: 'Reduce salt, walk 30 minutes daily, take the prescribed tablet each morning and check blood pressure twice a week.' }],
  ['cabdullaahi.xasan@fogaandawo.test', 'dr.hodan.axmed@fogaandawo.test', 14, 4, 'Helpful advice for my skin rash.', { complaint: 'Itchy rash on both hands for one month.', assessment: 'Dry, cracked skin on palms, worse after washing.', diagnosis: 'Hand eczema (contact dermatitis).', advice: 'Use a fragrance-free moisturiser after every wash, wear gloves when cleaning and apply the cream twice daily for 10 days.' }],
  ['faadumo.nuur@fogaandawo.test', 'dr.cabdiwali.nuur@fogaandawo.test', 10, 5, 'Mahadsanid dhakhtar, cunuggaygu wuu fiicnaaday.', { complaint: 'Child aged 4 with fever and cough for three days.', assessment: 'Temperature 38.4 °C, clear chest, drinking well.', diagnosis: 'Viral upper respiratory tract infection.', advice: 'Give paracetamol syrup for fever, plenty of fluids and rest. Go to the nearest clinic if breathing becomes fast or the fever lasts more than 5 days.' }],
  ['maryan.jaamac@fogaandawo.test', 'dr.faadumo.warsame@fogaandawo.test', 7, 5, null, { complaint: 'Antenatal questions at 20 weeks of pregnancy.', assessment: 'Pregnancy progressing normally per recent clinic card.', diagnosis: 'Normal pregnancy, 20 weeks.', advice: 'Continue iron and folic acid daily, attend the next antenatal visit and eat iron-rich food.' }],
  ['xasan.maxamed@fogaandawo.test', 'dr.ifraax.cismaan@fogaandawo.test', 5, 4, 'Good diet plan for my diabetes.', { complaint: 'Type 2 diabetes, wants a diet plan.', assessment: 'Fasting glucose 9.1 mmol/L, BMI 31.', diagnosis: 'Type 2 diabetes with obesity.', advice: 'Smaller portions of rice and bread, more vegetables and beans, no sugary drinks, walk after meals.' }],
  ['amina.cabdi@fogaandawo.test', 'dr.axmed.jaamac@fogaandawo.test', 3, 5, 'Felt listened to. Thank you.', { complaint: 'Poor sleep and worry for two months.', assessment: 'Low mood, no thoughts of self-harm, coping at work.', diagnosis: 'Generalised anxiety.', advice: 'Keep a regular sleep time, limit tea after 4 pm, practise the breathing exercise daily. Book a follow-up in two weeks.' }],
];

const reasonOf = (text) => `Demo: ${text}`;

export async function seedDemoData({ prisma, roles, specialties, passwordHash, hashPassword }) {
  const already = await prisma.appointment.count({ where: { reason: { startsWith: 'Demo:' } } });
  const users = {};

  // --- people (idempotent upserts) ---
  for (const d of [...DEMO_DOCTORS, PENDING_DOCTOR]) {
    const user = await prisma.user.upsert({
      where: { email: d.email },
      update: { fullName: d.name, ...(passwordHash ? { passwordHash } : {}) },
      create: { email: d.email, fullName: d.name, passwordHash: passwordHash ?? (await hashPassword(randomBytes(24).toString('base64url'))), emailVerifiedAt: new Date(), timeZone: d.zone },
    });
    await prisma.userRole.upsert({ where: { userId_roleId: { userId: user.id, roleId: roles.PATIENT.id } }, update: {}, create: { userId: user.id, roleId: roles.PATIENT.id } });
    const verified = d !== PENDING_DOCTOR;
    if (verified) await prisma.userRole.upsert({ where: { userId_roleId: { userId: user.id, roleId: roles.DOCTOR.id } }, update: {}, create: { userId: user.id, roleId: roles.DOCTOR.id } });
    await prisma.patientProfile.upsert({ where: { userId: user.id }, update: {}, create: { userId: user.id } });
    const doctor = await prisma.doctorProfile.upsert({
      where: { userId: user.id },
      update: { country: d.country, bio: d.bio },
      create: {
        userId: user.id,
        specialtyId: specialties[d.specialty].id,
        licenceNumber: `DEV-${d.country.slice(0, 2).toUpperCase()}-${user.id.slice(0, 6).toUpperCase()}`,
        licenceCountry: d.country,
        country: d.country,
        consultationFee: d.fee,
        yearsExperience: d.years,
        bio: d.bio,
        verificationStatus: verified ? 'VERIFIED' : 'PENDING',
        verifiedAt: verified ? new Date() : null,
      },
    });
    for (const language of d.languages) {
      await prisma.doctorLanguage.upsert({ where: { doctorId_language: { doctorId: doctor.id, language } }, update: {}, create: { doctorId: doctor.id, language } });
    }
    if (!verified && !(await prisma.verificationRequest.findFirst({ where: { doctorId: doctor.id } }))) {
      await prisma.verificationRequest.create({ data: { doctorId: doctor.id, status: 'PENDING', submittedAt: new Date() } }).catch(() => {});
    }
    users[d.email] = { user, doctor };
  }
  // Countries for the base doctors.
  await prisma.doctorProfile.updateMany({ where: { user: { email: 'dr.maxamed.faarax@fogaandawo.test' } }, data: { country: 'Somalia' } });
  await prisma.doctorProfile.updateMany({ where: { user: { email: 'dr.cali.yuusuf@fogaandawo.test' } }, data: { country: 'United States' } });

  for (const p of DEMO_PATIENTS) {
    const user = await prisma.user.upsert({
      where: { email: p.email },
      update: { fullName: p.name, ...(passwordHash ? { passwordHash } : {}) },
      create: { email: p.email, phone: p.phone, fullName: p.name, passwordHash: passwordHash ?? (await hashPassword(randomBytes(24).toString('base64url'))), emailVerifiedAt: new Date() },
    });
    await prisma.userRole.upsert({ where: { userId_roleId: { userId: user.id, roleId: roles.PATIENT.id } }, update: {}, create: { userId: user.id, roleId: roles.PATIENT.id } });
    const patient = await prisma.patientProfile.upsert({ where: { userId: user.id }, update: {}, create: { userId: user.id, sex: p.sex, dateOfBirth: new Date(p.dob) } });
    await prisma.medicalHistory.upsert({ where: { patientId: patient.id }, update: {}, create: { patientId: patient.id } });
  }

  // --- weekly availability through the real service (slots stored in UTC) ---
  const { saveMySchedule } = await import('../apps/api/src/modules/availability/availability.service.js');
  for (const [email, s] of Object.entries(SCHEDULES)) {
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!user) continue;
    const input = { timeZone: s.timeZone, slotDurationMinutes: s.slotDurationMinutes, days: s.days.map((dayOfWeek) => ({ dayOfWeek, periods: [{ startTime: s.start, endTime: s.end }] })) };
    await saveMySchedule({ user: { id: user.id }, activeRole: 'DOCTOR' }, input).catch((e) => console.warn(`[seed] schedule for ${email}: ${e.message}`));
  }

  if (already > 0) return { demoBookings: 'already present', schedules: Object.keys(SCHEDULES).length };

  // --- past consultations: paid (ledger + earnings), completed, notes, reviews, a message ---
  const { postSuccessfulPayment } = await import('../apps/api/src/modules/payments/payment.service.js');
  const { prisma: api } = await import('../apps/api/src/config/database.js');
  const rate = (await prisma.platformSetting.findUnique({ where: { key: 'commission_rate' } }))?.value?.rate ?? '0.1500';
  let created = 0;
  for (const [patientEmail, doctorEmail, daysAgo, stars, comment, note] of PAST) {
    const patient = await prisma.patientProfile.findFirst({ where: { user: { email: patientEmail } } });
    const doctor = await prisma.doctorProfile.findFirst({ where: { user: { email: doctorEmail } }, include: { user: true } });
    if (!patient || !doctor) continue;
    const start = new Date(Math.floor((Date.now() - daysAgo * DAY) / (30 * 60_000)) * 30 * 60_000);
    const end = new Date(start.getTime() + 30 * 60_000);
    await api.$transaction(async (tx) => {
      const slot = await tx.availabilitySlot.create({ data: { doctorId: doctor.id, startAtUtc: start, endAtUtc: end, timeZoneSnapshot: doctor.user.timeZone, status: 'HELD' } });
      const appointment = await tx.appointment.create({
        data: { patientId: patient.id, doctorId: doctor.id, slotId: slot.id, status: 'PENDING_PAYMENT', feeAmount: doctor.consultationFee, currency: doctor.currency, commissionRateSnapshot: rate, startAtUtc: start, endAtUtc: end, reason: reasonOf(note.complaint), holdExpiresAt: new Date(start.getTime() - DAY + H) },
      });
      const payment = await tx.payment.create({ data: { appointmentId: appointment.id, patientId: patient.id, amount: doctor.consultationFee, currency: doctor.currency, status: 'SUCCEEDED', provider: ['EVC_PLUS', 'ZAAD', 'EDAHAB'][created % 3], paidAt: new Date(start.getTime() - DAY) } });
      await tx.paymentAttempt.create({ data: { paymentId: payment.id, attemptNumber: 1, idempotencyKey: `seed-${appointment.id}`, providerReference: `DEMO-${appointment.id.slice(0, 8).toUpperCase()}`, status: 'SUCCEEDED', responseData: { simulated: true, outcome: 'SUCCESS', seeded: true } } });
      await postSuccessfulPayment(tx, { appointment, payment });
      const consultation = await tx.consultation.create({ data: { appointmentId: appointment.id, patientId: patient.id, doctorId: doctor.id, status: 'COMPLETED', startedAt: start, endedAt: new Date(start.getTime() + 22 * 60_000), completedAt: new Date(start.getTime() + 22 * 60_000), durationSeconds: 22 * 60, endedBy: 'DOCTOR' } });
      await tx.consultationNote.create({ data: { consultationId: consultation.id, ...note, shareAdvice: true, shareDiagnosis: true, lockedAt: new Date(start.getTime() + 22 * 60_000 + DAY) } });
      await tx.appointment.update({ where: { id: appointment.id }, data: { status: 'COMPLETED' } });
      await tx.appointmentStatusHistory.create({ data: { appointmentId: appointment.id, fromStatus: 'CONFIRMED', toStatus: 'COMPLETED', reason: 'Consultation completed (demo data)' } });
      await tx.review.create({ data: { appointmentId: appointment.id, patientId: patient.id, doctorId: doctor.id, rating: stars, comment } });
      await tx.message.create({ data: { appointmentId: appointment.id, consultationId: consultation.id, senderUserId: doctor.userId, body: 'Thank you for the consultation. Please follow the advice in your summary and message me if anything changes.', createdAt: new Date(start.getTime() + 30 * 60_000) } });
    }, { timeout: 60_000 });
    created += 1;
  }

  // --- upcoming paid bookings in each doctor's generated slots, plus one patient cancellation with a refund request ---
  const upcoming = [
    ['amina.cabdi@fogaandawo.test', 'dr.cabdiwali.nuur@fogaandawo.test', 'Child vaccination schedule questions'],
    ['sahra.cali@fogaandawo.test', 'dr.maxamed.faarax@fogaandawo.test', 'Chest tightness when climbing stairs'],
    ['bashiir.aadan@fogaandawo.test', 'dr.axmed.jaamac@fogaandawo.test', 'Trouble sleeping after moving cities'],
  ];
  const { createRefundRequest } = await import('../apps/api/src/modules/refunds/refund.service.js');
  for (const [i, [patientEmail, doctorEmail, why]] of upcoming.entries()) {
    const patient = await prisma.patientProfile.findFirst({ where: { user: { email: patientEmail } } });
    const doctor = await prisma.doctorProfile.findFirst({ where: { user: { email: doctorEmail } } });
    const slot = await prisma.availabilitySlot.findFirst({ where: { doctorId: doctor?.id, status: 'AVAILABLE', startAtUtc: { gt: new Date(Date.now() + 2 * DAY) } }, orderBy: { startAtUtc: 'asc' }, skip: i });
    if (!patient || !doctor || !slot) continue;
    await api.$transaction(async (tx) => {
      await tx.availabilitySlot.update({ where: { id: slot.id }, data: { status: 'HELD' } });
      const appointment = await tx.appointment.create({ data: { patientId: patient.id, doctorId: doctor.id, slotId: slot.id, status: 'PENDING_PAYMENT', feeAmount: doctor.consultationFee, currency: doctor.currency, commissionRateSnapshot: rate, startAtUtc: slot.startAtUtc, endAtUtc: slot.endAtUtc, reason: reasonOf(why), holdExpiresAt: new Date(Date.now() + 10 * 60_000) } });
      const payment = await tx.payment.create({ data: { appointmentId: appointment.id, patientId: patient.id, amount: doctor.consultationFee, currency: doctor.currency, status: 'SUCCEEDED', provider: 'EVC_PLUS', paidAt: new Date() } });
      await tx.paymentAttempt.create({ data: { paymentId: payment.id, attemptNumber: 1, idempotencyKey: `seed-${appointment.id}`, providerReference: `DEMO-${appointment.id.slice(0, 8).toUpperCase()}`, status: 'SUCCEEDED', responseData: { simulated: true, outcome: 'SUCCESS', seeded: true } } });
      await postSuccessfulPayment(tx, { appointment, payment });
      if (i === 2) {
        // A patient cancellation more than 24 h ahead → 100 % refund request (Admin › Finance › Refunds).
        await tx.appointment.update({ where: { id: appointment.id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancellationReason: 'Cancelled by the patient: travelling that week' } });
        await tx.appointmentStatusHistory.create({ data: { appointmentId: appointment.id, fromStatus: 'CONFIRMED', toStatus: 'CANCELLED', reason: 'Cancelled by the patient (demo data)' } });
        await tx.availabilitySlot.update({ where: { id: slot.id }, data: { status: 'AVAILABLE' } });
        await createRefundRequest(tx, { appointmentId: appointment.id, reason: 'Cancelled by the patient — 100% refund' });
      }
    }, { timeout: 60_000 });
    created += 1;
  }
  await api.$disconnect();
  return { demoBookings: created, schedules: Object.keys(SCHEDULES).length };
}
