DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'model_providers'
      AND column_name = 'api_key'
  ) AND EXISTS (
    SELECT 1
    FROM "model_providers"
    WHERE "api_key" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Cannot drop model_providers.api_key while plaintext secrets still exist. Run pnpm db:backfill-provider-secrets with DATABASE_URL and SESSION_SECRET set, then rerun this migration.';
  END IF;
END $$;

ALTER TABLE "model_providers"
  DROP COLUMN IF EXISTS "api_key";
