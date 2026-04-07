import { describe, expect, it } from "vitest";
import { withTestDatabase } from "./test-database";

const requiredModels = [
  "users",
  "account_requests",
  "sessions",
  "projects",
  "script_sessions",
  "script_versions",
  "storyboard_versions",
  "assets",
  "tasks",
  "task_steps",
  "model_providers",
];

const requiredColumns = {
  script_sessions: [
    "status",
    "completed_rounds",
    "current_question",
    "qa_records_json",
    "final_script_version_id",
  ],
  script_versions: [
    "source_idea",
    "clarification_qa_json",
    "body",
    "model_provider_key",
    "model_name",
    "model_metadata_json",
  ],
  storyboard_versions: ["model_provider_key", "model_name", "model_metadata_json"],
  tasks: ["cancel_requested_at"],
  task_steps: ["retry_count", "log", "raw_response_summary"],
  model_providers: [
    "timeout_ms",
    "max_retries",
    "api_key_ciphertext",
    "api_key_iv",
    "api_key_auth_tag",
    "api_key_masked_tail",
  ],
} as const;

describe("database schema", () => {
  it("exposes the required models", async () => {
    await withTestDatabase(async ({ prisma }) => {
      const rows = await prisma.$queryRaw<Array<{ tablename: string }>>`
        SELECT tablename
        FROM pg_catalog.pg_tables
        WHERE schemaname = 'public'
      `;
      const tableNames = rows.map((row) => row.tablename);

      expect(tableNames).toEqual(expect.arrayContaining(requiredModels));
    });
  });

  it("persists the Task 3 workflow columns and final-script relation", async () => {
    await withTestDatabase(async ({ prisma }) => {
      const columnRows = await prisma.$queryRaw<
        Array<{ table_name: string; column_name: string }>
      >`
        SELECT table_name, column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name IN ('script_sessions', 'script_versions', 'storyboard_versions', 'tasks', 'task_steps', 'model_providers')
      `;
      const enumRows = await prisma.$queryRaw<Array<{ enumlabel: string }>>`
        SELECT e.enumlabel
        FROM pg_type t
        JOIN pg_enum e
          ON e.enumtypid = t.oid
        WHERE t.typname = 'TaskType'
      `;
      const foreignKeyRows = await prisma.$queryRaw<
        Array<{
          table_name: string;
          column_name: string;
          foreign_table_name: string;
          foreign_column_name: string;
        }>
      >`
        SELECT
          tc.table_name,
          kcu.column_name,
          ccu.table_name AS foreign_table_name,
          ccu.column_name AS foreign_column_name
        FROM information_schema.table_constraints AS tc
        JOIN information_schema.key_column_usage AS kcu
          ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage AS ccu
          ON tc.constraint_name = ccu.constraint_name
         AND tc.table_schema = ccu.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_schema = 'public'
          AND tc.table_name IN ('script_sessions', 'script_versions', 'storyboard_versions')
      `;

      const columnsByTable = new Map<string, string[]>();
      for (const row of columnRows) {
        const columns = columnsByTable.get(row.table_name) ?? [];
        columns.push(row.column_name);
        columnsByTable.set(row.table_name, columns);
      }

      for (const [tableName, columns] of Object.entries(requiredColumns)) {
        expect(columnsByTable.get(tableName)).toEqual(expect.arrayContaining([...columns]));
      }

      expect(foreignKeyRows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            table_name: "script_sessions",
            column_name: "final_script_version_id",
            foreign_table_name: "script_versions",
            foreign_column_name: "id",
          }),
        ]),
      );
      expect(enumRows.map((row) => row.enumlabel).sort()).toEqual([
        "ASSET_SCRIPT_PARSE",
        "IMAGE",
        "SCRIPT_FINALIZE",
        "STORYBOARD",
        "VIDEO",
      ]);
    });
  });

  it("does not retain the plaintext model provider api_key column after all migrations", async () => {
    await withTestDatabase(async ({ prisma }) => {
      const rows = await prisma.$queryRaw<Array<{ column_name: string }>>`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'model_providers'
      `;
      const columnNames = rows.map((row) => row.column_name);

      expect(columnNames).not.toContain("api_key");
      expect(columnNames).toEqual(
        expect.arrayContaining([
          "api_key_ciphertext",
          "api_key_iv",
          "api_key_auth_tag",
          "api_key_masked_tail",
        ]),
      );
    });
  });
});
