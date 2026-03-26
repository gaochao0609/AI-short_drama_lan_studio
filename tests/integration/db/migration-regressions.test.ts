import { readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { runWorkspaceCommand, withEmptyTestDatabase } from "./test-database";

const repoRoot = process.cwd();
const baseMigrationPaths = [
  "prisma/migrations/20260319034047_init_core_schema/migration.sql",
  "prisma/migrations/20260319120415_task_3_review_fixes/migration.sql",
] as const;
const alignTaskPlanMigrationPath =
  "prisma/migrations/20260326104500_align_task_3_8_plan/migration.sql";
const dropLegacyApiKeyMigrationPath =
  "prisma/migrations/20260326111500_drop_legacy_model_provider_api_key/migration.sql";

function getMigrationSql(relativePath: string) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

async function runSql(databaseUrl: string, sql: string, values: unknown[] = []) {
  const client = new Client({ connectionString: databaseUrl });

  await client.connect();

  try {
    await client.query(sql, values);
  } finally {
    await client.end();
  }
}

async function runMigration(databaseUrl: string, relativePath: string) {
  const client = new Client({ connectionString: databaseUrl });

  await client.connect();

  try {
    await client.query("BEGIN");
    await client.query(getMigrationSql(relativePath));
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

async function applyBaseMigrations(databaseUrl: string) {
  for (const relativePath of baseMigrationPaths) {
    await runMigration(databaseUrl, relativePath);
  }
}

async function getModelProviderColumns(databaseUrl: string) {
  const client = new Client({ connectionString: databaseUrl });

  await client.connect();

  try {
    const result = (await client.query(
      `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'model_providers'
      `,
    )) as {
      rows: Array<{ column_name: string }>;
    };

    return result.rows.map((row) => row.column_name);
  } finally {
    await client.end();
  }
}

async function getProviderApiKey(databaseUrl: string, providerId: string) {
  const client = new Client({ connectionString: databaseUrl });

  await client.connect();

  try {
    const result = (await client.query(
      `SELECT api_key FROM "model_providers" WHERE id = $1`,
      [providerId],
    )) as {
      rows: Array<{ api_key: string | null }>;
    };

    return result.rows[0]?.api_key ?? null;
  } finally {
    await client.end();
  }
}

async function getProviderSecretColumns(databaseUrl: string, providerId: string) {
  const client = new Client({ connectionString: databaseUrl });

  await client.connect();

  try {
    const result = (await client.query(
      `
        SELECT
          api_key,
          api_key_ciphertext,
          api_key_iv,
          api_key_auth_tag,
          api_key_masked_tail
        FROM "model_providers"
        WHERE id = $1
      `,
      [providerId],
    )) as {
      rows: Array<{
        api_key: string | null;
        api_key_ciphertext: string | null;
        api_key_iv: string | null;
        api_key_auth_tag: string | null;
        api_key_masked_tail: string | null;
      }>;
    };

    return result.rows[0] ?? null;
  } finally {
    await client.end();
  }
}

describe("migration regressions", () => {
  it("supports migrating legacy plaintext provider api keys through align, backfill, and drop", async () => {
    await withEmptyTestDatabase(async ({ databaseUrl }) => {
      const providerId = "provider-with-plaintext-key";
      const plaintextSecret = "sk-legacy-12345678";
      const sessionSecret = "12345678901234567890123456789012";

      await applyBaseMigrations(databaseUrl);
      await runSql(
        databaseUrl,
        `
          INSERT INTO "model_providers" (
            "id",
            "key",
            "label",
            "provider_name",
            "model_name",
            "api_key",
            "updated_at"
          )
          VALUES ($1, 'script', 'Script', 'legacy-provider', 'legacy-model', $2, NOW())
        `,
        [providerId, plaintextSecret],
      );

      await runMigration(databaseUrl, alignTaskPlanMigrationPath);

      expect(await getProviderApiKey(databaseUrl, providerId)).toBe(plaintextSecret);
      expect(await getModelProviderColumns(databaseUrl)).toEqual(
        expect.arrayContaining([
          "api_key_ciphertext",
          "api_key_iv",
          "api_key_auth_tag",
          "api_key_masked_tail",
        ]),
      );

      const preBackfillRow = await getProviderSecretColumns(databaseUrl, providerId);

      expect(preBackfillRow).toMatchObject({
        api_key: plaintextSecret,
        api_key_ciphertext: null,
        api_key_iv: null,
        api_key_auth_tag: null,
        api_key_masked_tail: null,
      });

      await expect(runMigration(databaseUrl, dropLegacyApiKeyMigrationPath)).rejects.toThrow(
        /db:backfill-provider-secrets/i,
      );

      runWorkspaceCommand("pnpm db:backfill-provider-secrets", {
        databaseUrl,
        env: {
          SESSION_SECRET: sessionSecret,
        },
      });

      const postBackfillRow = await getProviderSecretColumns(databaseUrl, providerId);
      const previousSessionSecret = process.env.SESSION_SECRET;
      process.env.SESSION_SECRET = sessionSecret;
      const { decryptApiKey } = await import("@/lib/security/secrets");

      try {
        expect(postBackfillRow).toMatchObject({
          api_key: null,
          api_key_masked_tail: "****5678",
        });
        expect(postBackfillRow?.api_key_ciphertext).toEqual(expect.any(String));
        expect(postBackfillRow?.api_key_iv).toEqual(expect.any(String));
        expect(postBackfillRow?.api_key_auth_tag).toEqual(expect.any(String));
        expect(
          decryptApiKey({
            apiKeyCiphertext: postBackfillRow?.api_key_ciphertext ?? "",
            apiKeyIv: postBackfillRow?.api_key_iv ?? "",
            apiKeyAuthTag: postBackfillRow?.api_key_auth_tag ?? "",
          }),
        ).toBe(plaintextSecret);
      } finally {
        if (previousSessionSecret === undefined) {
          delete process.env.SESSION_SECRET;
        } else {
          process.env.SESSION_SECRET = previousSessionSecret;
        }
      }

      await runMigration(databaseUrl, dropLegacyApiKeyMigrationPath);

      expect(await getModelProviderColumns(databaseUrl)).not.toContain("api_key");
    });
  });

  it("fails with accurate messaging for historical SCRIPT_QUESTION tasks", async () => {
    await withEmptyTestDatabase(async ({ databaseUrl }) => {
      await applyBaseMigrations(databaseUrl);
      await runSql(
        databaseUrl,
        `
          INSERT INTO "users" ("id", "username", "password_hash", "updated_at")
          VALUES ('migration-user', 'migration-user', 'hash', NOW());

          INSERT INTO "projects" ("id", "owner_id", "title", "updated_at")
          VALUES ('migration-project', 'migration-user', 'Migration project', NOW());

          INSERT INTO "tasks" (
            "id",
            "project_id",
            "created_by_id",
            "type",
            "status",
            "input_json",
            "updated_at"
          )
          VALUES (
            'historical-script-question',
            'migration-project',
            'migration-user',
            'SCRIPT_QUESTION',
            'SUCCEEDED',
            '{}'::jsonb,
            NOW()
          );
        `,
      );

      let failure: unknown;

      try {
        await runMigration(databaseUrl, alignTaskPlanMigrationPath);
      } catch (error) {
        failure = error;
      }

      expect(failure).toBeInstanceOf(Error);
      expect(String(failure)).toMatch(/SCRIPT_QUESTION/i);
      expect(String(failure)).not.toMatch(/queued/i);
    });
  });
});
