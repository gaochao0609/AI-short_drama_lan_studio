import { backfillLegacyProviderSecrets } from "../src/lib/security/provider-secret-backfill";

function getDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  return databaseUrl;
}

async function main() {
  const result = await backfillLegacyProviderSecrets(getDatabaseUrl());

  if (result.status === "legacy-column-absent") {
    console.log("model_providers.api_key is already absent; nothing to backfill.");
    return;
  }

  if (result.status === "no-legacy-secrets") {
    console.log("No legacy plaintext provider secrets found.");
    return;
  }

  console.log(`Backfilled ${result.updatedCount} legacy provider secret(s).`);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  console.error(message);
  process.exitCode = 1;
});
