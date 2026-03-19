import { hash } from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, UserRole, UserStatus } from "@prisma/client";

const connectionString =
  process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/ai_short_drama";
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const defaultModelKeys = ["script", "storyboard", "image", "video"] as const;

async function main() {
  const adminUsername = process.env.DEFAULT_ADMIN_USERNAME ?? "admin";
  const adminPassword = process.env.DEFAULT_ADMIN_PASSWORD ?? "change-me-please";
  const passwordHash = await hash(adminPassword, 12);

  await prisma.user.upsert({
    where: { username: adminUsername },
    update: {
      passwordHash,
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      forcePasswordChange: true,
    },
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
      update: {
        label: key,
        providerName: "placeholder",
        modelName: key,
        configJson: {},
        enabled: true,
      },
      create: {
        key,
        label: key,
        providerName: "placeholder",
        modelName: key,
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
