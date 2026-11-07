-- Phase 7: real-time video consultations. Additive only: new enum values and nullable columns.
-- No data is changed, dropped or rewritten.

-- Consultation events: admission rejected, and intentional leaves (distinct from network disconnects).
ALTER TYPE "ConsultationEventType" ADD VALUE IF NOT EXISTS 'DOCTOR_REJECTED';
ALTER TYPE "ConsultationEventType" ADD VALUE IF NOT EXISTS 'PATIENT_LEFT';
ALTER TYPE "ConsultationEventType" ADD VALUE IF NOT EXISTS 'DOCTOR_LEFT';

-- When the doctor admitted the patient, the server-measured call length, and who ended the call.
ALTER TABLE "consultations" ADD COLUMN "admitted_at" TIMESTAMPTZ(6);
ALTER TABLE "consultations" ADD COLUMN "duration_seconds" INTEGER;
ALTER TABLE "consultations" ADD COLUMN "ended_by" "ParticipantRole";

ALTER TABLE "consultations" ADD CONSTRAINT "consultations_duration_non_negative" CHECK ("duration_seconds" IS NULL OR "duration_seconds" >= 0);
