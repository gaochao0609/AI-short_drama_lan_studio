import { createHmac, randomUUID } from "node:crypto";
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

test("script session page streams questions and shows the finalized script result", async ({
  context,
  page,
}) => {
  const prisma = createPrismaClient();
  const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
  const username = `script-e2e-${suffix}`;
  const passwordHash = await hash("ScriptE2E123!", 12);
  const sessionToken = `session-${suffix}`;
  let projectId = "";
  let taskPollCount = 0;

  try {
    const user = await prisma.user.create({
      data: {
        username,
        passwordHash,
        role: UserRole.USER,
        status: UserStatus.ACTIVE,
        forcePasswordChange: false,
      },
    });
    const project = await prisma.project.create({
      data: {
        ownerId: user.id,
        title: `Script Project ${suffix}`,
        idea: "Existing project idea",
      },
    });
    projectId = project.id;
    await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: createHmac(
          "sha256",
          process.env.SESSION_SECRET ?? "12345678901234567890123456789012",
        )
          .update(sessionToken)
          .digest("hex"),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        ipAddress: "127.0.0.1",
        userAgent: "playwright",
      },
    });

    await context.addCookies([
      {
        name: "session",
        value: sessionToken,
        domain: "127.0.0.1",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);

    await page.route("**/api/script/sessions", async (route) => {
      await route.fulfill({
        status: 201,
        contentType: "text/event-stream; charset=utf-8",
        body: [
          'event: session\n',
          'data: {"sessionId":"session-e2e-1"}\n\n',
          'event: question\n',
          'data: {"delta":"Who is the hero?"}\n\n',
          'event: done\n',
          'data: {"questionText":"Who is the hero?"}\n\n',
        ].join(""),
      });
    });
    await page.route("**/api/script/sessions/session-e2e-1/message", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream; charset=utf-8",
        body: [
          'event: question\n',
          'data: {"delta":"What does the hero stand to lose?"}\n\n',
          'event: done\n',
          'data: {"questionText":"What does the hero stand to lose?"}\n\n',
        ].join(""),
      });
    });
    await page.route("**/api/script/sessions/session-e2e-1/regenerate", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream; charset=utf-8",
        body: [
          'event: question\n',
          'data: {"delta":"What secret is the hero hiding?"}\n\n',
          'event: done\n',
          'data: {"questionText":"What secret is the hero hiding?"}\n\n',
        ].join(""),
      });
    });
    await page.route("**/api/script/sessions/session-e2e-1/finalize", async (route) => {
      await route.fulfill({
        status: 202,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify({
          taskId: "task-e2e-1",
        }),
      });
    });
    await page.route("**/api/tasks/task-e2e-1", async (route) => {
      taskPollCount += 1;

      await route.fulfill({
        status: 200,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify({
          id: "task-e2e-1",
          status: taskPollCount === 1 ? "RUNNING" : "SUCCEEDED",
          outputJson:
            taskPollCount === 1
              ? null
              : {
                  scriptVersionId: "version-e2e-1",
                  body: "INT. ARCHIVE - NIGHT\nThe courier opens the vault.",
                },
        }),
      });
    });

    await page.goto(`http://127.0.0.1:3000/projects/${projectId}/script`);

    await expect(page.getByRole("heading", { name: `Script Project ${suffix}` })).toBeVisible();
    await page.getByLabel("Script idea input").fill("A courier uncovers a black-market memory trade.");
    await page.getByRole("button", { name: "Start script session" }).click();
    await expect(page.getByText("Who is the hero?")).toBeVisible();

    await page.getByLabel("Script answer input").fill("A river courier who smuggles memories.");
    await page.getByRole("button", { name: "Send script answer" }).click();
    await expect(page.getByText("What does the hero stand to lose?")).toBeVisible();

    await page.getByRole("button", { name: "Regenerate script question" }).click();
    await expect(page.getByText("What secret is the hero hiding?")).toBeVisible();

    await page.getByRole("button", { name: "Finalize script" }).click();
    await expect(page.getByRole("button", { name: "Finalize script" })).toBeDisabled();
    await expect(page.getByText("INT. ARCHIVE - NIGHT")).toBeVisible();

    await page.getByRole("button", { name: "Reset script session" }).click();
    await expect(page.getByLabel("Script idea input")).toHaveValue("");
    await expect(page.getByText("What secret is the hero hiding?")).not.toBeVisible();
  } finally {
    await prisma.$disconnect();
  }
});

test("script session page surfaces polling errors during finalize", async ({
  context,
  page,
}) => {
  const prisma = createPrismaClient();
  const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
  const username = `script-e2e-poll-${suffix}`;
  const passwordHash = await hash("ScriptE2E123!", 12);
  const sessionToken = `session-${suffix}`;
  let projectId = "";

  try {
    const user = await prisma.user.create({
      data: {
        username,
        passwordHash,
        role: UserRole.USER,
        status: UserStatus.ACTIVE,
        forcePasswordChange: false,
      },
    });
    const project = await prisma.project.create({
      data: {
        ownerId: user.id,
        title: `Script Project ${suffix}`,
        idea: "Existing project idea",
      },
    });
    projectId = project.id;
    await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: createHmac(
          "sha256",
          process.env.SESSION_SECRET ?? "12345678901234567890123456789012",
        )
          .update(sessionToken)
          .digest("hex"),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        ipAddress: "127.0.0.1",
        userAgent: "playwright",
      },
    });

    await context.addCookies([
      {
        name: "session",
        value: sessionToken,
        domain: "127.0.0.1",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);

    await page.route("**/api/script/sessions", async (route) => {
      await route.fulfill({
        status: 201,
        contentType: "text/event-stream; charset=utf-8",
        body: [
          'event: session\n',
          'data: {"sessionId":"session-e2e-2"}\n\n',
          'event: question\n',
          'data: {"delta":"Who is the hero?"}\n\n',
          'event: done\n',
          'data: {"questionText":"Who is the hero?"}\n\n',
        ].join(""),
      });
    });
    await page.route("**/api/script/sessions/session-e2e-2/finalize", async (route) => {
      await route.fulfill({
        status: 202,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify({
          taskId: "task-e2e-2",
        }),
      });
    });
    await page.route("**/api/tasks/task-e2e-2", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify({
          error: "Task polling exploded",
        }),
      });
    });

    await page.goto(`http://127.0.0.1:3000/projects/${projectId}/script`);

    await page.getByLabel("Script idea input").fill("A courier uncovers a black-market memory trade.");
    await page.getByRole("button", { name: "Start script session" }).click();
    await expect(page.getByText("Who is the hero?")).toBeVisible();

    await page.getByRole("button", { name: "Finalize script" }).click();
    await expect(page.getByText("Failed to fetch task: 500")).toBeVisible();
  } finally {
    await prisma.$disconnect();
  }
});
