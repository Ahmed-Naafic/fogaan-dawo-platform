-- Fogaan Dawo App — PostgreSQL custom constraints review draft
-- Apply only after reviewing generated Prisma migration and validating schema.
-- These constraints are not represented fully by Prisma schema syntax.

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

-- Financial rules requiring transactional application logic:
-- 1. Sum of successful refunds for a payment must never exceed payment.amount.
-- 2. Only POSTED ledger entries are immutable; corrections use compensating entries.
-- 3. FinancialTransaction.reference and PaymentAttempt.idempotency_key are idempotency keys.
-- 4. Appointment slot hold, payment confirmation, slot release, and status history
--    must be handled in one database transaction with row locking.
-- 5. Appointment and consultation authorization must be enforced in the API.
-- 6. Enforce consultation note 24-hour edit window in the service layer.
-- 7. Enforce follow-up confirmation/payment deadline of 48 hours in the service layer.
-- 8. Prescription issue requires at least one item; QR verification exposes no patient data.
-- 9. Validate patient/doctor ownership for medical-history entries and reviews in service logic.
-- 10. Add a database trigger or carefully controlled service policy to prohibit mutation
--     or deletion of posted FinancialTransaction rows.
