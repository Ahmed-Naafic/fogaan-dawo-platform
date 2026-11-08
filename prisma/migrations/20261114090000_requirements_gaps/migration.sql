-- Requirements gap closing. Additive only.
-- 1. Doctor country (requirement 1: "country and time zone"; the time zone stays users.time_zone).
ALTER TABLE "doctor_profiles" ADD COLUMN "country" VARCHAR(100);

-- 2. In-app SMS outbox per user (baseline: "write SMS messages to an in-app outbox").
ALTER TABLE "sms_outbox" ADD COLUMN "user_id" UUID;
ALTER TABLE "sms_outbox" ADD CONSTRAINT "sms_outbox_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "sms_outbox_user_id_created_at_idx" ON "sms_outbox"("user_id", "created_at");
