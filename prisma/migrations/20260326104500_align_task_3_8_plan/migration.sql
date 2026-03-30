DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "tasks" WHERE "type" = 'SCRIPT_QUESTION') THEN
    RAISE EXCEPTION 'Cannot apply this migration while legacy SCRIPT_QUESTION tasks still exist. Migrate or delete every SCRIPT_QUESTION row before rerunning this migration.';
  END IF;
END $$;

ALTER TABLE "tasks"
  ADD COLUMN "cancel_requested_at" TIMESTAMP(3);

ALTER TABLE "model_providers"
  ADD COLUMN "api_key_ciphertext" TEXT,
  ADD COLUMN "api_key_iv" TEXT,
  ADD COLUMN "api_key_auth_tag" TEXT,
  ADD COLUMN "api_key_masked_tail" TEXT;

CREATE TYPE "TaskType_new" AS ENUM ('SCRIPT_FINALIZE', 'STORYBOARD', 'IMAGE', 'VIDEO');

ALTER TABLE "tasks"
  ALTER COLUMN "type" TYPE "TaskType_new"
  USING ("type"::text::"TaskType_new");

DROP TYPE "TaskType";

ALTER TYPE "TaskType_new" RENAME TO "TaskType";
