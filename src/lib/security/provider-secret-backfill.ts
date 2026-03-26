import { Client } from "pg";
import { encryptApiKey } from "./secrets";

const ENCRYPTED_PROVIDER_SECRET_COLUMNS = [
  "api_key_ciphertext",
  "api_key_iv",
  "api_key_auth_tag",
  "api_key_masked_tail",
] as const;

type BackfillStatus = "backfilled" | "no-legacy-secrets" | "legacy-column-absent";

export type ProviderSecretBackfillResult = {
  status: BackfillStatus;
  updatedCount: number;
};

type LegacyProviderSecretRow = {
  id: string;
  key: string;
  api_key: string;
};

async function getModelProviderColumnNames(client: Client) {
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

  return new Set(result.rows.map((row) => row.column_name));
}

export async function backfillLegacyProviderSecrets(
  databaseUrl: string,
): Promise<ProviderSecretBackfillResult> {
  const client = new Client({ connectionString: databaseUrl });
  let transactionStarted = false;

  await client.connect();

  try {
    const columnNames = await getModelProviderColumnNames(client);

    if (!columnNames.has("api_key")) {
      return {
        status: "legacy-column-absent",
        updatedCount: 0,
      };
    }

    for (const columnName of ENCRYPTED_PROVIDER_SECRET_COLUMNS) {
      if (!columnNames.has(columnName)) {
        throw new Error(
          `Encrypted provider secret columns are missing. Apply migration 20260326104500_align_task_3_8_plan before running the backfill.`,
        );
      }
    }

    await client.query("BEGIN");
    transactionStarted = true;

    const result = (await client.query(
      `
        SELECT id, key, api_key
        FROM "model_providers"
        WHERE api_key IS NOT NULL
        ORDER BY key ASC
        FOR UPDATE
      `,
    )) as {
      rows: LegacyProviderSecretRow[];
    };

    for (const row of result.rows) {
      const encryptedApiKey = encryptApiKey(row.api_key);

      await client.query(
        `
          UPDATE "model_providers"
          SET
            "api_key" = NULL,
            "api_key_ciphertext" = $2,
            "api_key_iv" = $3,
            "api_key_auth_tag" = $4,
            "api_key_masked_tail" = $5,
            "updated_at" = NOW()
          WHERE "id" = $1
        `,
        [
          row.id,
          encryptedApiKey.apiKeyCiphertext,
          encryptedApiKey.apiKeyIv,
          encryptedApiKey.apiKeyAuthTag,
          encryptedApiKey.apiKeyMaskedTail,
        ],
      );
    }

    await client.query("COMMIT");

    return {
      status: result.rows.length === 0 ? "no-legacy-secrets" : "backfilled",
      updatedCount: result.rows.length,
    };
  } catch (error) {
    if (transactionStarted) {
      await client.query("ROLLBACK");
    }

    throw error;
  } finally {
    await client.end();
  }
}
