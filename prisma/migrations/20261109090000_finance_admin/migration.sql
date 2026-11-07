-- Phase 8: admin finance. Additive only: one enum value, nullable columns, indexes and integrity
-- triggers. No existing row is changed, dropped or rewritten.

-- Refund review: an administrator may reject a refund request (with a recorded reason).
ALTER TYPE "RefundStatus" ADD VALUE IF NOT EXISTS 'REJECTED';

ALTER TABLE "refunds" ADD COLUMN "review_note" TEXT;
ALTER TABLE "refunds" ADD COLUMN "reviewed_by" UUID;
ALTER TABLE "refunds" ADD COLUMN "reviewed_at" TIMESTAMPTZ(6);
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Date-range reporting.
CREATE INDEX "payments_status_paid_at_idx" ON "payments"("status", "paid_at");
CREATE INDEX "payments_created_at_idx" ON "payments"("created_at");
CREATE INDEX "refunds_processed_at_idx" ON "refunds"("processed_at");
CREATE INDEX "doctor_earnings_created_at_idx" ON "doctor_earnings"("created_at");

-- Historical commission protection.
--   * doctor_earnings keeps the gross / commission / net split computed when the payment succeeded.
--     Those amounts (and what they belong to) can never change and rows can never be deleted;
--     only the settlement status may move (PENDING → AVAILABLE / PARTIALLY_REFUNDED / REFUNDED).
--   * appointments.commission_rate_snapshot is the rate applied to that booking and never changes.
CREATE FUNCTION doctor_earnings_immutable_amounts() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'doctor_earnings row % cannot be deleted', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.gross_amount IS DISTINCT FROM OLD.gross_amount
     OR NEW.commission_amount IS DISTINCT FROM OLD.commission_amount
     OR NEW.net_amount IS DISTINCT FROM OLD.net_amount
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.appointment_id IS DISTINCT FROM OLD.appointment_id
     OR NEW.doctor_id IS DISTINCT FROM OLD.doctor_id THEN
    RAISE EXCEPTION 'doctor_earnings row % amounts are a historical snapshot and cannot change', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER doctor_earnings_immutable_amounts
  BEFORE UPDATE OR DELETE ON "doctor_earnings"
  FOR EACH ROW EXECUTE FUNCTION doctor_earnings_immutable_amounts();

CREATE FUNCTION appointments_commission_snapshot_immutable() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.commission_rate_snapshot IS DISTINCT FROM OLD.commission_rate_snapshot THEN
    RAISE EXCEPTION 'appointment % commission_rate_snapshot cannot change', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER appointments_commission_snapshot_immutable
  BEFORE UPDATE OF "commission_rate_snapshot" ON "appointments"
  FOR EACH ROW EXECUTE FUNCTION appointments_commission_snapshot_immutable();
