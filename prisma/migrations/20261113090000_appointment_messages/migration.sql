-- Messages: one patient–doctor conversation per paid appointment, available before the call exists.
-- Existing rows (if any) take the appointment of their consultation, so nothing is lost.
ALTER TABLE "messages" ADD COLUMN "appointment_id" UUID;
UPDATE "messages" m SET "appointment_id" = c."appointment_id" FROM "consultations" c WHERE c."id" = m."consultation_id";
ALTER TABLE "messages" ALTER COLUMN "appointment_id" SET NOT NULL;
ALTER TABLE "messages" ALTER COLUMN "consultation_id" DROP NOT NULL;
ALTER TABLE "messages" ADD COLUMN "read_at" TIMESTAMPTZ(6);

ALTER TABLE "messages" ADD CONSTRAINT "messages_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "messages_appointment_id_created_at_idx" ON "messages"("appointment_id", "created_at");
