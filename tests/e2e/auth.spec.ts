import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, UserRole, UserStatus } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { hash } from "bcryptjs";

const databaseUrl =
  process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/ai_short_drama";

function createPrismaClient() {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });
}

test("main auth flow covers request approval login and forced password change", async ({ page }) => {
  const prisma = createPrismaClient();
  const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
  const adminUsername = `admin-e2e-${suffix}`;
  const requesterUsername = `writer-e2e-${suffix}`;
  const requesterDisplayName = `Writer ${suffix}`;
  const adminPassword = "AdminPass123!";
  const finalPassword = "BrandNewPassword123!";

  try {
    const adminPasswordHash = await hash(adminPassword, 12);

    await prisma.session.deleteMany({
      where: {
        user: {
          username: {
            in: [adminUsername, requesterUsername],
          },
        },
      },
    });
    await prisma.accountRequest.deleteMany({
      where: {
        username: requesterUsername,
      },
    });
    await prisma.user.deleteMany({
      where: {
        username: {
          in: [adminUsername, requesterUsername],
        },
      },
    });

    await prisma.user.create({
      data: {
        username: adminUsername,
        passwordHash: adminPasswordHash,
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        forcePasswordChange: false,
      },
    });

    await page.goto("http://localhost:3000/register-request");
    await page.getByLabel("用户名").fill(requesterUsername);
    await page.getByLabel("显示名称").fill(requesterDisplayName);
    await page.getByLabel("申请说明").fill("Need workspace access");
    await page.getByRole("button", { name: "提交申请" }).click();
    await expect(page.getByText("申请已提交，等待管理员审批。")).toBeVisible();

    await expect(
      prisma.accountRequest.findUniqueOrThrow({
        where: {
          username: requesterUsername,
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        username: requesterUsername,
        status: "PENDING",
      }),
    );

    await page.goto("http://localhost:3000/login");
    await page.getByLabel("用户名").fill(adminUsername);
    await page.getByLabel("密码").fill(adminPassword);
    await page.getByRole("button", { name: "登录" }).click();
    await expect(page).toHaveURL(/\/admin\/users$/);

    const requestCard = page.locator("article").filter({
      hasText: requesterUsername,
    });
    await expect(requestCard).toContainText(requesterDisplayName);

    const approvalResponsePromise = page.waitForResponse((response) => {
      return (
        response.url().includes("/api/admin/account-requests") &&
        response.request().method() === "POST"
      );
    });
    await requestCard.getByRole("button", { name: "审批" }).click();
    const approvalResponse = await approvalResponsePromise;
    expect(approvalResponse.ok()).toBe(true);
    const approvalPayload = (await approvalResponse.json()) as { tempPassword: string; userId: string };
    expect(approvalPayload.tempPassword).toBeTruthy();

    await expect(page.getByText("申请已审批")).toBeVisible();
    await expect(
      prisma.accountRequest.findUniqueOrThrow({
        where: {
          username: requesterUsername,
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        username: requesterUsername,
        status: "APPROVED",
      }),
    );

    await page.goto("http://localhost:3000/login");
    await page.getByLabel("用户名").fill(requesterUsername);
    await page.getByLabel("密码").fill(approvalPayload.tempPassword);
    await page.getByRole("button", { name: "登录" }).click();
    await expect(page).toHaveURL(/\/force-password$/);
    await expect(page.getByRole("heading", { name: "首次登录修改密码" })).toBeVisible();

    await page.getByLabel("新密码", { exact: true }).fill(finalPassword);
    await page.getByLabel("确认新密码", { exact: true }).fill(finalPassword);
    await page.getByRole("button", { name: "保存新密码" }).click();
    await expect(page).toHaveURL("http://localhost:3000/workspace");

    await expect(
      prisma.user.findUniqueOrThrow({
        where: {
          username: requesterUsername,
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        username: requesterUsername,
        status: UserStatus.ACTIVE,
        forcePasswordChange: false,
      }),
    );
  } finally {
    await prisma.session.deleteMany({
      where: {
        user: {
          username: {
            in: [adminUsername, requesterUsername],
          },
        },
      },
    });
    await prisma.accountRequest.deleteMany({
      where: {
        username: requesterUsername,
      },
    });
    await prisma.user.deleteMany({
      where: {
        username: {
          in: [adminUsername, requesterUsername],
        },
      },
    });
    await prisma.$disconnect();
  }
});
