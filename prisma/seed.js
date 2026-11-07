// Fogaan Dawo — development seed (idempotent: safe to run repeatedly; it upserts and never deletes).
// Run with `npm run db:seed` (guarded by scripts/db-guard.mjs: development database only).
//
// Creates: the 3 roles, 8 specialties (English + Somali), the commission-rate setting (development
// placeholder), and development test accounts on the reserved `.test` domain.
// Test-account password (bcrypt-hashed): taken from SEED_DEV_PASSWORD. If it is not set, new accounts
// get a random, unknown password and existing ones are left unchanged (they cannot be logged into).
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../apps/api/src/utils/password.js';

if (process.env.DATABASE_ENV !== 'development') {
  console.error('[seed] Refusing to run: seed data (test accounts, placeholder settings) is for development databases only.');
  process.exit(1);
}

const prisma = new PrismaClient();

const SPECIALTIES = [
  { nameEn: 'General Practice', nameSo: 'Dhakhtar Guud', description: 'Everyday health concerns and check-ups.' },
  { nameEn: 'Cardiology', nameSo: 'Wadnaha', description: 'Heart and blood-vessel conditions.' },
  { nameEn: 'Dermatology', nameSo: 'Maqaarka', description: 'Skin, hair and nail conditions.' },
  { nameEn: 'Pediatrics', nameSo: 'Carruurta', description: 'Health care for infants, children and adolescents.' },
  { nameEn: "Women's Health", nameSo: 'Caafimaadka Haweenka', description: 'Gynecology and maternal health.' },
  { nameEn: 'Mental Health', nameSo: 'Caafimaadka Maskaxda', description: 'Psychiatry and emotional wellbeing.' },
  { nameEn: 'Nutrition', nameSo: 'Nafaqada', description: 'Diet and nutrition advice.' },
  { nameEn: 'Orthopedics', nameSo: 'Lafaha', description: 'Bones, joints and muscles.' },
];

// Development-only placeholder; the real commission rate is a business decision to confirm before launch.
const DEV_COMMISSION_RATE = '0.1500';

const ACCOUNTS = [
  { email: 'admin@fogaandawo.test', fullName: 'Admin', roles: ['ADMIN'] },
  { email: 'amina.cabdi@fogaandawo.test', phone: '+252610000001', fullName: 'Amina Cabdi', roles: ['PATIENT'], patient: { sex: 'female', dateOfBirth: '1998-04-12' } },
  {
    email: 'dr.cali.yuusuf@fogaandawo.test',
    fullName: 'Dr. Cali Yuusuf',
    roles: ['DOCTOR', 'PATIENT'], // demonstrates one user with multiple roles
    patient: { sex: 'male' },
    doctor: { specialty: 'General Practice', licenceNumber: 'DEV-SO-0001', licenceCountry: 'Somalia', fee: '12.00', languages: ['so', 'en'], years: 9 },
  },
  {
    email: 'dr.maxamed.faarax@fogaandawo.test',
    fullName: 'Dr. Maxamed Faarax',
    roles: ['DOCTOR'],
    doctor: { specialty: 'Cardiology', licenceNumber: 'DEV-SO-0002', licenceCountry: 'Somalia', fee: '20.00', languages: ['so', 'en'], years: 12 },
  },
];

async function main() {
  const roles = {};
  for (const name of ['PATIENT', 'DOCTOR', 'ADMIN']) {
    roles[name] = await prisma.role.upsert({ where: { name }, update: {}, create: { name } });
  }

  const specialties = {};
  for (const s of SPECIALTIES) {
    specialties[s.nameEn] = await prisma.specialty.upsert({ where: { nameEn: s.nameEn }, update: { nameSo: s.nameSo, description: s.description }, create: s });
  }

  await prisma.platformSetting.upsert({
    where: { key: 'commission_rate' },
    update: {},
    create: { key: 'commission_rate', value: { rate: DEV_COMMISSION_RATE }, description: 'Platform commission as a fraction of the consultation fee (DEVELOPMENT PLACEHOLDER).' },
  });

  const password = process.env.SEED_DEV_PASSWORD;
  if (password && password.length < 12) throw new Error('SEED_DEV_PASSWORD must be at least 12 characters');
  const passwordHash = await hashPassword(password || randomBytes(32).toString('base64url'));

  for (const a of ACCOUNTS) {
    const user = await prisma.user.upsert({
      where: { email: a.email },
      // With SEED_DEV_PASSWORD set, existing dev accounts are re-hashed (bcrypt) so they can log in.
      update: { fullName: a.fullName, ...(password ? { passwordHash } : {}) },
      create: { email: a.email, phone: a.phone ?? null, fullName: a.fullName, passwordHash, emailVerifiedAt: new Date() },
    });
    for (const r of a.roles) {
      await prisma.userRole.upsert({ where: { userId_roleId: { userId: user.id, roleId: roles[r].id } }, update: {}, create: { userId: user.id, roleId: roles[r].id } });
    }
    if (a.patient) {
      const patient = await prisma.patientProfile.upsert({
        where: { userId: user.id },
        update: {},
        create: { userId: user.id, sex: a.patient.sex, dateOfBirth: a.patient.dateOfBirth ? new Date(a.patient.dateOfBirth) : null },
      });
      await prisma.medicalHistory.upsert({ where: { patientId: patient.id }, update: {}, create: { patientId: patient.id } });
    }
    if (a.doctor) {
      const d = a.doctor;
      const doctor = await prisma.doctorProfile.upsert({
        where: { userId: user.id },
        update: {},
        create: {
          userId: user.id,
          specialtyId: specialties[d.specialty].id,
          licenceNumber: d.licenceNumber,
          licenceCountry: d.licenceCountry,
          consultationFee: d.fee,
          yearsExperience: d.years,
          verificationStatus: 'VERIFIED',
          verifiedAt: new Date(),
        },
      });
      for (const language of d.languages) {
        await prisma.doctorLanguage.upsert({ where: { doctorId_language: { doctorId: doctor.id, language } }, update: {}, create: { doctorId: doctor.id, language } });
      }
    }
  }

  const counts = {
    roles: await prisma.role.count(),
    specialties: await prisma.specialty.count(),
    users: await prisma.user.count(),
    doctors: await prisma.doctorProfile.count(),
    patients: await prisma.patientProfile.count(),
  };
  console.log('[seed] done', counts, password ? '(test accounts use SEED_DEV_PASSWORD)' : '(no SEED_DEV_PASSWORD: test accounts have a random, unusable password)');
}

main()
  .catch((error) => {
    console.error('[seed] failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
