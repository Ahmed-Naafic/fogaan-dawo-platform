import { Prisma } from '@prisma/client';
import { databaseSchema } from '../config/database.js';

/**
 * Schema-qualified table name for raw SQL, e.g. "public"."appointments".
 * Only names from this allow-list can be used, so the identifier is never user input.
 */
const TABLES = new Set([
  'availability_slots',
  'appointments',
  'payments',
  'refunds',
  'doctor_profiles',
  'consultations',
  'consultation_notes',
  'sessions',
  'users',
  'notifications',
  'appointment_reminders',
  'patient_profiles',
  'medical_history_entries',
  'prescriptions',
  'consultation_attachments',
]);

/** Sequences usable from raw SQL (same allow-list rule as tables). */
const SEQUENCES = new Set(['prescription_reference_seq']);

/** Schema-qualified, quoted sequence name for raw SQL (follows ?schema= in DATABASE_URL). */
export function qualifiedSequence(name) {
  if (!SEQUENCES.has(name)) throw new Error(`Sequence "${name}" is not allowed in raw SQL`);
  return `"${databaseSchema}"."${name}"`;
}

/** Schema-qualified, quoted table name for raw SQL (follows ?schema= in DATABASE_URL). */
export function qualifiedTable(name) {
  if (!TABLES.has(name)) throw new Error(`Table "${name}" is not allowed in raw SQL`);
  return `"${databaseSchema}"."${name}"`;
}

/** The same, as a Prisma.sql fragment for tagged-template queries. */
export const tableSql = (name) => Prisma.raw(qualifiedTable(name));
