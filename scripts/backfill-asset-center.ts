import { backfillAssetCenter } from "../src/lib/services/asset-backfill";

async function main() {
  const result = await backfillAssetCenter();

  console.log(
    [
      `createdAssets=${result.createdAssets.length}`,
      `updatedAssets=${result.updatedAssets.length}`,
      `createdBindings=${result.createdBindings.length}`,
      `updatedBindings=${result.updatedBindings.length}`,
    ].join(" "),
  );
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  console.error(message);
  process.exitCode = 1;
});
