-- Phase 9: patient & doctor profiles. Additive only: nullable columns, one index and integrity
-- triggers. No existing row is changed, dropped or rewritten.

-- Profile photo (patients and doctors). The file lives in private storage under a server-generated key;
-- it is only ever served through authorised API endpoints (doctor photos publicly only while the doctor
-- is verified and active).
ALTER TABLE "users" ADD COLUMN "avatar_key" VARCHAR(500);
ALTER TABLE "users" ADD COLUMN "avatar_updated_at" TIMESTAMPTZ(6);

-- Emergency contact relationship (name and phone already exist).
ALTER TABLE "patient_profiles" ADD COLUMN "emergency_relationship" VARCHAR(60);

-- Doctor's public qualifications summary (free text the doctor maintains; documents stay private).
ALTER TABLE "doctor_profiles" ADD COLUMN "qualifications" TEXT;

-- Medical history entries are archived, never deleted.
ALTER TABLE "medical_history_entries" ADD COLUMN "archived_at" TIMESTAMPTZ(6);
ALTER TABLE "medical_history_entries" ADD COLUMN "archived_by_user_id" UUID;
ALTER TABLE "medical_history_entries" ADD CONSTRAINT "medical_history_entries_archived_by_user_id_fkey"
  FOREIGN KEY ("archived_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "medical_history_entries_medical_history_id_archived_at_idx"
  ON "medical_history_entries"("medical_history_id", "archived_at");

-- Medical history integrity:
--   * rows can never be deleted (archive instead);
--   * who wrote an entry (source, author), which history it belongs to and its linked consultation
--     never change after creation;
--   * an archived entry is frozen (no further edits, never un-archived).
CREATE FUNCTION medical_history_entries_protect() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'medical_history_entries row % cannot be deleted; archive it instead', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.medical_history_id IS DISTINCT FROM OLD.medical_history_id
     OR NEW.source IS DISTINCT FROM OLD.source
     OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
     OR NEW.consultation_id IS DISTINCT FROM OLD.consultation_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'medical_history_entries authorship of % cannot change', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'medical_history_entries row % is archived', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER medical_history_entries_protect
  BEFORE UPDATE OR DELETE ON "medical_history_entries"
  FOR EACH ROW EXECUTE FUNCTION medical_history_entries_protect();
