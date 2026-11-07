-- Phase 10 (1/2): prescription lifecycle values. Additive only.
-- Kept in its own migration: PostgreSQL cannot use a newly added enum value in the transaction that adds it,
-- and the next migration's constraints and triggers refer to these values.
ALTER TYPE "PrescriptionStatus" ADD VALUE IF NOT EXISTS 'DRAFT';
ALTER TYPE "PrescriptionStatus" ADD VALUE IF NOT EXISTS 'REPLACED';
