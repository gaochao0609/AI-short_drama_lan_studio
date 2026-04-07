import { hash } from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, UserRole, UserStatus } from "@prisma/client";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required");
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const defaultModelKeys = ["script", "asset_script_parse", "storyboard", "image", "video"] as const;

async function main() {
  const adminUsername = process.env.DEFAULT_ADMIN_USERNAME ?? "admin";
  const adminPassword = process.env.DEFAULT_ADMIN_PASSWORD ?? "change-me-please";
  const passwordHash = await hash(adminPassword, 12);

  await prisma.user.upsert({
    where: { username: adminUsername },
    update: {},
    create: {
      username: adminUsername,
      passwordHash,
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      forcePasswordChange: true,
    },
  });

  for (const key of defaultModelKeys) {
    await prisma.modelProvider.upsert({
      where: { key },
      update: {},
      create: {
        key,
        label: key,
        providerName: "placeholder",
        modelName: key,
        timeoutMs: 30000,
        maxRetries: 2,
        configJson: {},
        enabled: true,
      },
    });
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
