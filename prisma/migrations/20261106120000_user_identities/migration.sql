-- Google sign-in (OpenID Connect): external identities + password-optional accounts.
-- Additive only: a new enum and table, and password_hash becomes nullable (no rows are changed).

-- CreateEnum
CREATE TYPE "IdentityProvider" AS ENUM ('GOOGLE');

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;

-- CreateTable
CREATE TABLE "user_identities" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" "IdentityProvider" NOT NULL,
    "provider_subject" VARCHAR(255) NOT NULL,
    "email_at_link" VARCHAR(254),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(6),

    CONSTRAINT "user_identities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_identities_user_id_idx" ON "user_identities"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_identities_provider_provider_subject_key" ON "user_identities"("provider", "provider_subject");

-- CreateIndex
CREATE UNIQUE INDEX "user_identities_user_id_provider_key" ON "user_identities"("user_id", "provider");

-- AddForeignKey
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- The provider's subject identifier is never empty.
ALTER TABLE "user_identities"
  ADD CONSTRAINT "user_identities_subject_not_empty" CHECK (char_length("provider_subject") > 0);
