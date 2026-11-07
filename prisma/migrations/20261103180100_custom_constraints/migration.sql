-- Fogaan Dawo App — custom PostgreSQL constraints (not expressible in Prisma schema syntax).
-- Source: docs/database/approved/fogaan-dawo-database-constraints.sql (approved), applied verbatim below,
-- plus the append-only ledger trigger (approved option 10, decision: fully immutable once POSTED).
-- Rules marked "service layer" in the approved file are implemented in apps/api/src/modules/*.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- At least one login identifier must exist.
ALTER TABLE users
  ADD CONSTRAINT users_email_or_phone_required
  CHECK (email IS NOT NULL OR phone IS NOT NULL);

-- Prevent invalid fees, slot intervals, availability rules, and file sizes.
ALTER TABLE doctor_profiles
  ADD CONSTRAINT doctor_fee_range CHECK (consultation_fee >= 5 AND consultation_fee <= 200);

ALTER TABLE availability_rules
  ADD CONSTRAINT availability_rule_day_range CHECK (day_of_week BETWEEN 0 AND 6),
  ADD CONSTRAINT availability_rule_time_order CHECK (start_local_time < end_local_time),
  ADD CONSTRAINT availability_rule_slot_duration CHECK (slot_duration_minutes IN (20, 30));

ALTER TABLE availability_slots
  ADD CONSTRAINT availability_slot_time_order CHECK (start_at_utc < end_at_utc);

ALTER TABLE blocked_dates
  ADD CONSTRAINT blocked_date_time_order CHECK (start_at < end_at);

ALTER TABLE doctor_documents
  ADD CONSTRAINT doctor_document_positive_size CHECK (file_size > 0),
  ADD CONSTRAINT doctor_document_positive_version CHECK (version_number > 0);

ALTER TABLE consultation_attachments
  ADD CONSTRAINT consultation_attachment_size_limit CHECK (file_size > 0 AND file_size <= 5242880);

ALTER TABLE reviews
  ADD CONSTRAINT review_rating_range CHECK (rating BETWEEN 1 AND 5);

ALTER TABLE appointments
  ADD CONSTRAINT appointment_time_order CHECK (start_at_utc < end_at_utc),
  ADD CONSTRAINT appointment_reschedule_count_nonnegative CHECK (reschedule_count >= 0);

-- Only one current document version per doctor and document type.
CREATE UNIQUE INDEX doctor_documents_one_current_version
  ON doctor_documents (doctor_id, document_type)
  WHERE is_current = TRUE;

-- A slot may have only one active appointment. Historical cancelled/rescheduled
-- appointments remain linked to the same slot without blocking future bookings.
CREATE UNIQUE INDEX appointments_one_active_per_slot
  ON appointments (slot_id)
  WHERE status IN ('PENDING_PAYMENT', 'CONFIRMED', 'WAITING', 'IN_PROGRESS');

-- Prevent overlapping generated slots for the same doctor.
ALTER TABLE availability_slots
  ADD CONSTRAINT availability_slots_no_overlap
  EXCLUDE USING gist (
    doctor_id WITH =,
    tstzrange(start_at_utc, end_at_utc, '[)') WITH &&
  );

-- Append-only financial ledger.
--   * No row may ever be deleted or truncated.
--   * A POSTED row is fully immutable (no column, including status, may change).
--   * PENDING rows may still transition (e.g. to POSTED or FAILED).
--   * Corrections are new compensating entries (REFUND_REVERSAL / ADJUSTMENT).
CREATE FUNCTION financial_transactions_append_only() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'financial_transactions is append-only: row % cannot be deleted', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status = 'POSTED' THEN
    RAISE EXCEPTION 'financial_transactions row % is POSTED and immutable; record a compensating entry instead', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION financial_transactions_no_truncate() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'financial_transactions is append-only: TRUNCATE is not allowed'
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER financial_transactions_append_only
  BEFORE UPDATE OR DELETE ON financial_transactions
  FOR EACH ROW EXECUTE FUNCTION financial_transactions_append_only();

CREATE TRIGGER financial_transactions_no_truncate
  BEFORE TRUNCATE ON financial_transactions
  FOR EACH STATEMENT EXECUTE FUNCTION financial_transactions_no_truncate();
