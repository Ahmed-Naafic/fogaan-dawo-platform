-- Phase 10 (2/2): digital prescriptions & medical documents.
-- Additive: new columns, one enum, one sequence, indexes, constraints and integrity triggers. Two NOT NULL
-- constraints are relaxed (prescriptions.verification_token_hash, issued_at) so a DRAFT can exist before
-- it is issued; a CHECK keeps both mandatory for every non-draft prescription. No row is changed or dropped.

/* ------------------------------------------------------------------ prescriptions */

ALTER TABLE "prescriptions" ALTER COLUMN "verification_token_hash" DROP NOT NULL;
ALTER TABLE "prescriptions" ALTER COLUMN "issued_at" DROP NOT NULL;

ALTER TABLE "prescriptions" ADD COLUMN "reference" VARCHAR(32);
ALTER TABLE "prescriptions" ADD COLUMN "general_notes" TEXT;
ALTER TABLE "prescriptions" ADD COLUMN "replaces_prescription_id" UUID;
ALTER TABLE "prescriptions" ADD COLUMN "replaced_at" TIMESTAMPTZ(6);
ALTER TABLE "prescriptions" ADD COLUMN "replacement_reason" TEXT;
ALTER TABLE "prescriptions" ADD COLUMN "cancellation_reason" TEXT;
ALTER TABLE "prescriptions" ADD COLUMN "cancelled_by" UUID;
ALTER TABLE "prescriptions" ADD COLUMN "status_changed_by" UUID;
ALTER TABLE "prescriptions" ADD COLUMN "pdf_sha256" CHAR(64);
ALTER TABLE "prescriptions" ADD COLUMN "pdf_generated_at" TIMESTAMPTZ(6);
ALTER TABLE "prescriptions" ADD COLUMN "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "prescriptions" ADD COLUMN "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX "prescriptions_reference_key" ON "prescriptions"("reference");
-- A prescription can be replaced at most once (one successor per original).
CREATE UNIQUE INDEX "prescriptions_replaces_prescription_id_key" ON "prescriptions"("replaces_prescription_id");
CREATE INDEX "prescriptions_doctor_id_issued_at_idx" ON "prescriptions"("doctor_id", "issued_at");
CREATE INDEX "prescriptions_consultation_id_idx" ON "prescriptions"("consultation_id");
CREATE INDEX "prescriptions_status_issued_at_idx" ON "prescriptions"("status", "issued_at");

ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_replaces_prescription_id_fkey" FOREIGN KEY ("replaces_prescription_id") REFERENCES "prescriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_cancelled_by_fkey" FOREIGN KEY ("cancelled_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_status_changed_by_fkey" FOREIGN KEY ("status_changed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Every issued (non-draft) prescription has its verification token hash and issue time.
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescription_issued_fields"
  CHECK ("status" = 'DRAFT' OR ("verification_token_hash" IS NOT NULL AND "issued_at" IS NOT NULL));
-- A cancelled prescription records when and why.
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescription_cancellation_fields"
  CHECK ("status" <> 'CANCELLED' OR ("cancelled_at" IS NOT NULL AND "cancellation_reason" IS NOT NULL));
-- A replaced prescription records when and why.
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescription_replacement_fields"
  CHECK ("status" <> 'REPLACED' OR ("replaced_at" IS NOT NULL AND "replacement_reason" IS NOT NULL));
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescription_not_self_replacing"
  CHECK ("replaces_prescription_id" IS NULL OR "replaces_prescription_id" <> "id");

-- Human-readable references (FD-RX-<year>-<n>), assigned when a prescription is issued.
CREATE SEQUENCE IF NOT EXISTS "prescription_reference_seq" START 1;

ALTER TABLE "prescription_items" ADD COLUMN "quantity" VARCHAR(60);
ALTER TABLE "prescription_items" ADD COLUMN "warnings" TEXT;
ALTER TABLE "prescription_items" ADD COLUMN "position" SMALLINT NOT NULL DEFAULT 0;
CREATE INDEX "prescription_items_prescription_id_position_idx" ON "prescription_items"("prescription_id", "position");

/*
 * Prescription integrity (lifecycle DRAFT → VALID → CANCELLED | REPLACED):
 *   * who/what it belongs to (consultation, patient, doctor) never changes;
 *   * a DRAFT may be edited, discarded, or issued (→ VALID) — nothing else;
 *   * once issued, the content (token, issue time, reference, notes, predecessor, PDF key/checksum/time)
 *     is frozen; the only change is VALID → CANCELLED or VALID → REPLACED (with their audit fields);
 *   * CANCELLED and REPLACED are final; issued prescriptions are never deleted.
 */
CREATE FUNCTION prescriptions_protect() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'issued prescription % cannot be deleted', OLD.id USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.consultation_id IS DISTINCT FROM OLD.consultation_id OR NEW.patient_id IS DISTINCT FROM OLD.patient_id
     OR NEW.doctor_id IS DISTINCT FROM OLD.doctor_id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'prescription % ownership cannot change', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status = 'DRAFT' THEN
    IF NEW.status NOT IN ('DRAFT', 'VALID') THEN
      RAISE EXCEPTION 'draft prescription % can only be issued', OLD.id USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.verification_token_hash IS DISTINCT FROM OLD.verification_token_hash
     OR NEW.issued_at IS DISTINCT FROM OLD.issued_at
     OR NEW.reference IS DISTINCT FROM OLD.reference
     OR NEW.general_notes IS DISTINCT FROM OLD.general_notes
     OR NEW.replaces_prescription_id IS DISTINCT FROM OLD.replaces_prescription_id
     OR NEW.pdf_file_key IS DISTINCT FROM OLD.pdf_file_key
     OR NEW.pdf_sha256 IS DISTINCT FROM OLD.pdf_sha256
     OR NEW.pdf_generated_at IS DISTINCT FROM OLD.pdf_generated_at THEN
    RAISE EXCEPTION 'issued prescription % is immutable', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status IN ('CANCELLED', 'REPLACED') THEN
    RAISE EXCEPTION 'prescription % is %, no further changes', OLD.id, OLD.status USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status NOT IN ('VALID', 'CANCELLED', 'REPLACED') THEN
    RAISE EXCEPTION 'invalid prescription status change % -> %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER prescriptions_protect
  BEFORE UPDATE OR DELETE ON "prescriptions"
  FOR EACH ROW EXECUTE FUNCTION prescriptions_protect();

-- Medicine lines can be added, changed or removed only while their prescription is a DRAFT.
CREATE FUNCTION prescription_items_protect() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  parent_status TEXT;
BEGIN
  -- Look the parent up in the trigger's own schema (Prisma qualifies tables; it does not set search_path).
  EXECUTE format('SELECT status::text FROM %I.prescriptions WHERE id = $1', TG_TABLE_SCHEMA)
     INTO parent_status
    USING CASE WHEN TG_OP = 'DELETE' THEN OLD.prescription_id ELSE NEW.prescription_id END;
  IF parent_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'medicine lines of an issued prescription cannot be changed' USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.prescription_id IS DISTINCT FROM OLD.prescription_id THEN
    RAISE EXCEPTION 'a medicine line cannot move to another prescription' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER prescription_items_protect
  BEFORE INSERT OR UPDATE OR DELETE ON "prescription_items"
  FOR EACH ROW EXECUTE FUNCTION prescription_items_protect();

/* ------------------------------------------------------------------ consultation summary */

-- Advice gets the same doctor-controlled share switch as the other note sections (default: not shared).
ALTER TABLE "consultation_notes" ADD COLUMN "share_advice" BOOLEAN NOT NULL DEFAULT false;

/* ------------------------------------------------------------------ medical documents */

CREATE TYPE "DocumentCategory" AS ENUM ('LAB_RESULT', 'MEDICAL_REPORT', 'REFERRAL_LETTER', 'DIAGNOSTIC_REPORT', 'SCANNED_DOCUMENT', 'OTHER');

ALTER TABLE "consultation_attachments" ADD COLUMN "category" "DocumentCategory" NOT NULL DEFAULT 'OTHER';
ALTER TABLE "consultation_attachments" ADD COLUMN "description" VARCHAR(500);
ALTER TABLE "consultation_attachments" ADD COLUMN "sha256" CHAR(64);
ALTER TABLE "consultation_attachments" ADD COLUMN "archived_at" TIMESTAMPTZ(6);
ALTER TABLE "consultation_attachments" ADD COLUMN "archived_by" UUID;
ALTER TABLE "consultation_attachments" ADD CONSTRAINT "consultation_attachments_archived_by_fkey" FOREIGN KEY ("archived_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "consultation_attachments" ADD CONSTRAINT "consultation_attachment_size" CHECK ("file_size" > 0 AND "file_size" <= 10485760);
CREATE INDEX "consultation_attachments_consultation_id_archived_at_idx" ON "consultation_attachments"("consultation_id", "archived_at");
CREATE INDEX "consultation_attachments_created_at_idx" ON "consultation_attachments"("created_at");

-- Documents are archived, never deleted; only the archive fields may change, once.
CREATE FUNCTION consultation_attachments_protect() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'medical document % cannot be deleted; archive it instead', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'medical document % is archived', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.consultation_id IS DISTINCT FROM OLD.consultation_id OR NEW.uploaded_by_user_id IS DISTINCT FROM OLD.uploaded_by_user_id
     OR NEW.file_key IS DISTINCT FROM OLD.file_key OR NEW.file_name IS DISTINCT FROM OLD.file_name
     OR NEW.mime_type IS DISTINCT FROM OLD.mime_type OR NEW.file_size IS DISTINCT FROM OLD.file_size
     OR NEW.attachment_type IS DISTINCT FROM OLD.attachment_type OR NEW.category IS DISTINCT FROM OLD.category
     OR NEW.description IS DISTINCT FROM OLD.description OR NEW.sha256 IS DISTINCT FROM OLD.sha256
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'medical document % is immutable', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER consultation_attachments_protect
  BEFORE UPDATE OR DELETE ON "consultation_attachments"
  FOR EACH ROW EXECUTE FUNCTION consultation_attachments_protect();
