-- Storage hardening: SHA-256 of each doctor verification document, recorded when the file is stored
-- (and by the storage migration for existing files). Additive and nullable: existing rows are unchanged.
ALTER TABLE "doctor_documents" ADD COLUMN "sha256" CHAR(64);
