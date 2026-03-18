# AI短剧创作局域网工作台 V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在一台 Windows 10 主机上交付一个可供 5-20 人局域网使用的 AI 短剧创作网站，包含注册申请、管理员审批登录、项目与任务持久化、统一模型适配层，以及剧本、分镜、图片、视频四条生成链路。

**Architecture:** 采用 `Next.js + Prisma + Postgres + Redis + BullMQ + 本地文件存储` 的模块化单体方案。Web 层负责 UI 和 API，独立 worker 进程负责异步队列消费，认证采用“数据库有状态会话 + HttpOnly Cookie”，所有模型请求统一经过适配层，所有产物围绕“项目 -> 任务 -> 资产/版本”落盘。

**Tech Stack:** Next.js App Router、TypeScript、Prisma、Postgres、Redis、BullMQ、Zod、bcryptjs、Vitest、Playwright、Docker Compose

---

## 计划说明

- 本计划对应规格文档：[2026-03-18-ai-short-drama-lan-studio-design.md](/d:/AI短剧创作/docs/superpowers/specs/2026-03-18-ai-short-drama-lan-studio-design.md)
- 当前仓库基本为空，因此本计划同时定义项目骨架、目录边界和实现顺序。
- 该规格虽然覆盖多个功能域，但它们共享同一套认证、项目、任务、队列和存储底座，不适合拆成彼此独立的多个实现计划；因此保留为一份主实施计划，按阶段递进交付。
- 执行时建议每个任务都配合 `@superpowers/test-driven-development` 和 `@superpowers/verification-before-completion`。

## 文件结构先行

### 根目录与基础设施

- `package.json`
  - 项目脚本、依赖、worker 启动命令
- `pnpm-lock.yaml`
  - 依赖锁文件
- `.env.example`
  - 所有环境变量模板
- `.gitignore`
  - 忽略 `node_modules`、`.next`、`.superpowers`、本地存储目录和测试产物
- `Dockerfile`
  - Web 容器镜像
- `docker-compose.yml`
  - `web + worker + postgres + redis` 本地编排和 volume 挂载
- `README.md`
  - 本地运行、局域网访问、备份和恢复说明

### 数据库与种子

- `prisma/schema.prisma`
  - 用户、会话、注册申请、项目、任务、剧本会话、版本、资产、模型配置等核心实体
- `prisma/migrations/*`
  - 数据库迁移
- `prisma/seed.ts`
  - 初始化管理员账号和默认模型配置

### 应用入口与页面

- `src/app/layout.tsx`
  - 全局布局和会话注入
- `src/app/page.tsx`
  - 首页跳转逻辑
- `src/app/(auth)/login/page.tsx`
  - 登录页
- `src/app/(auth)/register-request/page.tsx`
  - 注册申请页
- `src/app/(auth)/force-password/page.tsx`
  - 首次改密页
- `src/app/(workspace)/layout.tsx`
  - 工作区导航与权限边界
- `src/app/(workspace)/page.tsx`
  - 仪表盘
- `src/app/(workspace)/projects/[projectId]/page.tsx`
  - 项目详情页
- `src/app/(workspace)/projects/[projectId]/script/page.tsx`
  - 剧本会话式生成页
- `src/app/(workspace)/projects/[projectId]/storyboard/page.tsx`
  - 剧本转分镜页
- `src/app/(workspace)/projects/[projectId]/images/page.tsx`
  - 图片生成与编辑页
- `src/app/(workspace)/projects/[projectId]/videos/page.tsx`
  - 视频生成页
- `src/app/admin/layout.tsx`
  - 管理员页面统一权限守卫与导航框架
- `src/app/admin/users/page.tsx`
  - 账号与注册申请管理页
- `src/app/admin/providers/page.tsx`
  - 模型配置管理页
- `src/app/admin/tasks/page.tsx`
  - 任务监控页
- `src/app/admin/storage/page.tsx`
  - 存储管理页

### API 路由

- `src/app/api/auth/login/route.ts`
- `src/app/api/auth/logout/route.ts`
- `src/app/api/auth/register-request/route.ts`
- `src/app/api/auth/force-password/route.ts`
- `src/app/api/admin/account-requests/route.ts`
- `src/app/api/admin/users/route.ts`
- `src/app/api/admin/users/[userId]/reset-password/route.ts`
- `src/app/api/admin/providers/route.ts`
- `src/app/api/admin/tasks/route.ts`
- `src/app/api/admin/tasks/[taskId]/retry/route.ts`
- `src/app/api/admin/storage/route.ts`
- `src/app/api/projects/route.ts`
- `src/app/api/projects/[projectId]/route.ts`
- `src/app/api/tasks/route.ts`
- `src/app/api/tasks/[taskId]/route.ts`
- `src/app/api/script/sessions/route.ts`
- `src/app/api/script/sessions/[sessionId]/message/route.ts`
- `src/app/api/storyboards/route.ts`
- `src/app/api/images/route.ts`
- `src/app/api/videos/route.ts`
- `src/app/api/assets/[assetId]/download/route.ts`

### 领域服务与基础库

- `src/lib/env.ts`
  - 环境变量解析
- `src/lib/db.ts`
  - Prisma 客户端
- `src/lib/redis.ts`
  - Redis 客户端
- `src/lib/auth/password.ts`
  - 密码哈希与校验
- `src/lib/auth/session.ts`
  - 会话签发、读取、销毁
- `src/lib/auth/guards.ts`
  - `requireUser`、`requireAdmin`
- `src/lib/storage/paths.ts`
  - 文件目录命名规则
- `src/lib/storage/fs-storage.ts`
  - 文件写入、移动、删除、下载
- `src/lib/models/contracts.ts`
  - 模型适配层输入输出契约
- `src/lib/models/provider-registry.ts`
  - 提供方配置读取与默认模型分发
- `src/lib/models/proxy-client.ts`
  - 对接本地代理接口
- `src/lib/queues/index.ts`
  - BullMQ 队列与 job 名称
- `src/lib/queues/enqueue.ts`
  - 创建任务并入队
- `src/lib/services/account-requests.ts`
  - 注册申请服务
- `src/lib/services/users.ts`
  - 用户与密码重置服务
- `src/lib/services/projects.ts`
  - 项目服务
- `src/lib/services/tasks.ts`
  - 任务与任务步骤服务
- `src/lib/services/script-sessions.ts`
  - 剧本多轮会话服务
- `src/lib/services/storyboards.ts`
  - 分镜服务
- `src/lib/services/images.ts`
  - 图片任务服务
- `src/lib/services/videos.ts`
  - 视频任务服务
- `src/lib/services/providers.ts`
  - 模型配置服务

### Worker

- `src/worker/index.ts`
  - 启动所有 worker
- `src/worker/processors/script.ts`
  - 单轮提问与剧本定稿处理
- `src/worker/processors/storyboard.ts`
  - 剧本拆分分镜处理
- `src/worker/processors/image.ts`
  - 文生图和图生图处理
- `src/worker/processors/video.ts`
  - 视频生成处理

### 测试

- `vitest.config.ts`
- `playwright.config.ts`
- `tests/setup/vitest.setup.ts`
- `tests/unit/auth/password.test.ts`
- `tests/unit/auth/session.test.ts`
- `tests/unit/models/contracts.test.ts`
- `tests/unit/storage/fs-storage.test.ts`
- `tests/integration/db/schema.test.ts`
- `tests/integration/api/auth.test.ts`
- `tests/integration/api/admin-users.test.ts`
- `tests/integration/api/projects-and-tasks.test.ts`
- `tests/integration/api/providers.test.ts`
- `tests/integration/workers/storyboard-worker.test.ts`
- `tests/integration/workers/image-worker.test.ts`
- `tests/integration/workers/video-worker.test.ts`
- `tests/e2e/auth.spec.ts`
- `tests/e2e/admin.spec.ts`
- `tests/e2e/script-session.spec.ts`
- `tests/e2e/workflow.spec.ts`
- `tests/e2e/full-smoke.spec.ts`

## 实施任务

### Task 1: 初始化仓库、Next.js、测试工具和基础脚本

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `next.config.ts`
- Create: `src/app/layout.tsx`
- Create: `src/app/page.tsx`
- Create: `vitest.config.ts`
- Create: `playwright.config.ts`
- Create: `tests/setup/vitest.setup.ts`
- Create: `tests/smoke/homepage.test.ts`
- Modify: `.gitignore`

- [ ] **Step 1: 使用 Next.js 初始化 TypeScript App Router 项目**

Run: `pnpm create next-app@latest . --yes --ts --eslint --app --src-dir --use-pnpm --import-alias "@/*"`
Expected: 项目根目录生成 `package.json`、`src/app`、`next.config.ts` 等基础文件。

- [ ] **Step 2: 安装运行时与测试依赖**

Run: `pnpm add @prisma/client bullmq ioredis zod bcryptjs`

Run: `pnpm add -D prisma tsx vitest @vitest/ui @testing-library/react @testing-library/jest-dom jsdom @playwright/test`
Expected: `package.json` 中出现运行时和测试依赖，安装完成无错误。

- [ ] **Step 3: 配置基础脚本与测试入口**

在 `package.json` 中补充脚本：

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:e2e": "playwright test",
    "db:generate": "prisma generate",
    "db:migrate": "prisma migrate dev",
    "db:seed": "tsx prisma/seed.ts",
    "worker": "tsx src/worker/index.ts"
  }
}
```

Expected: `package.json` 中脚本完整，`tests/setup/vitest.setup.ts` 能被 `vitest.config.ts` 正确引用。

- [ ] **Step 4: 写一个首页冒烟测试**

在 `tests/smoke/homepage.test.ts` 写入：

```ts
import { describe, expect, it } from "vitest";

describe("homepage shell", () => {
  it("has a root app entry file", async () => {
    const mod = await import("@/app/page");
    expect(mod).toBeTruthy();
  });
});
```

Run: `pnpm vitest run tests/smoke/homepage.test.ts`
Expected: PASS。

- [ ] **Step 5: 运行基础质量检查**

Run: `pnpm lint`

Run: `pnpm typecheck`

Run: `pnpm test`
Expected: 所有命令通过。

- [ ] **Step 6: 提交本任务**

Run: `git add package.json pnpm-lock.yaml tsconfig.json next.config.ts src/app vitest.config.ts playwright.config.ts tests .gitignore`

Run: `git commit -m "chore: bootstrap nextjs app and test tooling"`
Expected: 生成一个干净提交。

### Task 2: 搭建 Docker、环境变量和 Postgres/Redis 本地运行底座

**Files:**
- Create: `.env.example`
- Create: `Dockerfile`
- Create: `docker-compose.yml`
- Create: `src/lib/env.ts`
- Test: `tests/unit/env.test.ts`

- [ ] **Step 1: 写环境变量解析测试**

在 `tests/unit/env.test.ts` 写入：

```ts
import { describe, expect, it } from "vitest";
import { loadEnv } from "@/lib/env";

describe("loadEnv", () => {
  it("returns typed env config", () => {
    const env = loadEnv({
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/ai_short_drama",
      REDIS_URL: "redis://localhost:6379",
      APP_URL: "http://localhost:3000",
      SESSION_SECRET: "12345678901234567890123456789012"
    });

    expect(env.APP_URL).toBe("http://localhost:3000");
  });
});
```

Run: `pnpm vitest run tests/unit/env.test.ts`
Expected: FAIL，提示 `@/lib/env` 不存在。

- [ ] **Step 2: 实现环境变量解析器和 `.env.example`**

在 `src/lib/env.ts` 中使用 `zod` 实现：

```ts
const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  APP_URL: z.string().url(),
  SESSION_SECRET: z.string().min(32),
  STORAGE_ROOT: z.string().min(1),
  DEFAULT_ADMIN_USERNAME: z.string().min(1),
  DEFAULT_ADMIN_PASSWORD: z.string().min(8)
});
```

在 `.env.example` 中写出全部变量占位。

Run: `pnpm vitest run tests/unit/env.test.ts`
Expected: PASS。

- [ ] **Step 3: 编写 `Dockerfile` 和 `docker-compose.yml`**

`docker-compose.yml` 至少包含：

```yaml
services:
  postgres:
    image: postgres:17
    environment:
      POSTGRES_DB: ai_short_drama
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - "5432:5432"
    volumes:
      - pg-data:/var/lib/postgresql/data
  redis:
    image: redis:7
    command: ["redis-server", "--appendonly", "yes"]
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
  web:
    build: .
    command: ["pnpm", "start"]
    env_file:
      - .env
    depends_on:
      - postgres
      - redis
    ports:
      - "3000:3000"
    volumes:
      - ./storage:/app/storage
  worker:
    build: .
    command: ["pnpm", "worker"]
    env_file:
      - .env
    depends_on:
      - postgres
      - redis
    volumes:
      - ./storage:/app/storage

volumes:
  pg-data:
  redis-data:
```

Expected: Compose 文件能表达 `web + worker + postgres + redis` 四服务关系，且 `Postgres`、`Redis`、`storage` 都具备持久化挂载。

- [ ] **Step 4: 启动基础依赖并验证连通性**

Run: `docker compose up -d postgres redis`

Run: `docker compose ps`
Expected: `postgres` 和 `redis` 状态为 `running`。

- [ ] **Step 5: 提交本任务**

Run: `git add .env.example Dockerfile docker-compose.yml src/lib/env.ts tests/unit/env.test.ts`

Run: `git commit -m "chore: add local infra and env baseline"`
Expected: 生成一个干净提交。

### Task 3: 建立 Prisma schema、迁移和默认种子数据

**Files:**
- Create: `prisma/schema.prisma`
- Create: `prisma/seed.ts`
- Create: `src/lib/db.ts`
- Test: `tests/integration/db/schema.test.ts`

- [ ] **Step 1: 写数据库结构测试**

在 `tests/integration/db/schema.test.ts` 里用 Prisma 查询以下表是否可用：

```ts
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
  "model_providers"
];
```

Run: `pnpm vitest run tests/integration/db/schema.test.ts`
Expected: FAIL，提示 Prisma client 或 schema 缺失。

- [ ] **Step 2: 定义 Prisma schema**

在 `prisma/schema.prisma` 中至少定义以下模型和关键字段：

```prisma
model User {
  id                  String   @id @default(cuid())
  username            String   @unique
  passwordHash        String
  role                UserRole
  status              UserStatus
  forcePasswordChange Boolean  @default(true)
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
}

model AccountRequest {
  id           String   @id @default(cuid())
  username     String   @unique
  displayName  String
  reason       String?
  status       String
  approvedById String?
  approvedAt   DateTime?
  createdAt    DateTime @default(now())
}

model Session {
  id            String   @id @default(cuid())
  userId        String
  tokenHash     String   @unique
  expiresAt     DateTime
  revokedAt     DateTime?
  lastSeenAt    DateTime?
  ipAddress     String?
  userAgent     String?
  createdAt     DateTime @default(now())
}

model Task {
  id          String     @id @default(cuid())
  projectId   String
  createdById String
  type        TaskType
  status      TaskStatus
  inputJson   Json
  outputJson  Json?
  errorText   String?
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt
}
```

其余模型 `Session`、`Project`、`ScriptSession`、`ScriptVersion`、`StoryboardVersion`、`Asset`、`TaskStep`、`ModelProvider` 按规格文档第 8 节字段落实，并为所有外键显式定义 relation。

关键枚举：

```prisma
enum UserRole { ADMIN USER }
enum UserStatus { PENDING ACTIVE DISABLED }
enum TaskStatus { QUEUED RUNNING SUCCEEDED FAILED CANCELED }
enum TaskType { SCRIPT_QUESTION SCRIPT_FINALIZE STORYBOARD IMAGE VIDEO }
```

- [ ] **Step 3: 生成迁移、客户端和默认种子**

Run: `pnpm db:generate`

Run: `pnpm db:migrate --name init_core_schema`

在 `prisma/seed.ts` 中创建默认管理员和 4 条默认模型配置键：

```ts
["script", "storyboard", "image", "video"]
```

Run: `pnpm db:seed`
Expected: 数据库中出现管理员和默认模型配置。

- [ ] **Step 4: 实现 `src/lib/db.ts` 并跑结构测试**

`src/lib/db.ts` 需要导出单例 Prisma Client。

Run: `pnpm vitest run tests/integration/db/schema.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交本任务**

Run: `git add prisma src/lib/db.ts tests/integration/db/schema.test.ts`

Run: `git commit -m "feat: add prisma schema and seed data"`
Expected: 生成一个干净提交。

### Task 4: 实现认证内核，包括密码哈希、数据库会话和权限守卫

**Files:**
- Create: `src/lib/auth/password.ts`
- Create: `src/lib/auth/session.ts`
- Create: `src/lib/auth/guards.ts`
- Test: `tests/unit/auth/password.test.ts`
- Test: `tests/unit/auth/session.test.ts`

- [ ] **Step 1: 写密码哈希与会话测试**

在 `tests/unit/auth/password.test.ts` 中验证：

```ts
expect(await hashPassword("P@ssw0rd!")).not.toBe("P@ssw0rd!");
expect(await verifyPassword("P@ssw0rd!", hash)).toBe(true);
```

在 `tests/unit/auth/session.test.ts` 中验证：

```ts
const token = createSessionToken();
expect(token.length).toBeGreaterThan(20);
expect(hashSessionToken(token)).not.toBe(token);
```

Run: `pnpm vitest run tests/unit/auth/password.test.ts tests/unit/auth/session.test.ts`
Expected: FAIL。

- [ ] **Step 2: 实现密码工具**

在 `src/lib/auth/password.ts` 中使用 `bcryptjs`：

```ts
export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}
```

- [ ] **Step 3: 实现数据库会话工具**

在 `src/lib/auth/session.ts` 中实现“数据库会话 + Cookie 标识”模型：

```ts
export function createSessionToken(): string {}

export function hashSessionToken(token: string): string {}

export async function createSession(input: {
  userId: string;
  ip?: string;
  userAgent?: string;
  expiresAt: Date;
}): Promise<{ sessionId: string; token: string }> {}

export async function invalidateSession(sessionId: string): Promise<void> {}

export async function invalidateUserSessions(userId: string): Promise<void> {}
```

Cookie 中只保存随机 `session token`，服务端通过 `sessions` 表查找、失效和审计，不使用自包含 JWT 作为权限真相来源。

- [ ] **Step 4: 实现路由守卫**

在 `src/lib/auth/guards.ts` 提供：

```ts
export async function requireUser(): Promise<{
  userId: string;
  role: "ADMIN" | "USER";
  forcePasswordChange: boolean;
}> {}

export async function requireAdmin(): Promise<{
  userId: string;
  role: "ADMIN";
}> {}
```

行为要求：

1. 未登录直接抛出 `401`
2. 普通用户访问管理员资源抛出 `403`
3. 强制改密用户访问工作区时允许通过，但页面层要重定向到改密页

Run: `pnpm vitest run tests/unit/auth/password.test.ts tests/unit/auth/session.test.ts`
Expected: PASS。

- [ ] **Step 5: 运行基础回归**

Run: `pnpm lint`

Run: `pnpm typecheck`
Expected: 通过。

- [ ] **Step 6: 提交本任务**

Run: `git add src/lib/auth tests/unit/auth`

Run: `git commit -m "feat: add auth core utilities"`
Expected: 生成一个干净提交。

### Task 5: 交付认证页面和管理员审批账号流

**Files:**
- Create: `src/app/(auth)/login/page.tsx`
- Create: `src/app/(auth)/register-request/page.tsx`
- Create: `src/app/(auth)/force-password/page.tsx`
- Create: `src/app/admin/layout.tsx`
- Create: `src/app/api/auth/login/route.ts`
- Create: `src/app/api/auth/logout/route.ts`
- Create: `src/app/api/auth/register-request/route.ts`
- Create: `src/app/api/auth/force-password/route.ts`
- Create: `src/app/api/admin/account-requests/route.ts`
- Create: `src/app/api/admin/users/route.ts`
- Create: `src/app/api/admin/users/[userId]/reset-password/route.ts`
- Create: `src/app/admin/users/page.tsx`
- Create: `src/lib/services/account-requests.ts`
- Create: `src/lib/services/users.ts`
- Test: `tests/integration/api/auth.test.ts`
- Test: `tests/integration/api/admin-users.test.ts`
- Test: `tests/e2e/auth.spec.ts`

- [ ] **Step 1: 写认证 API 集成测试**

覆盖以下场景：

1. 注册申请成功写入 `account_requests`
2. 管理员审批后创建 `users`
3. 正常登录创建 `sessions` 记录并写入会话 Cookie
4. 首次登录强制改密
5. 禁用账号后无法登录
6. 登出后当前会话失效
7. 管理员禁用账号后该用户现有会话全部失效

Run: `pnpm vitest run tests/integration/api/auth.test.ts tests/integration/api/admin-users.test.ts`
Expected: FAIL。

- [ ] **Step 2: 实现认证和账号管理服务**

在 `src/lib/services/account-requests.ts` 中实现：

```ts
export async function createAccountRequest(input: {
  username: string;
  displayName: string;
  reason?: string;
}): Promise<{ requestId: string; status: "PENDING" }> {}

export async function approveAccountRequest(
  requestId: string,
  adminUserId: string
): Promise<{ userId: string; tempPassword: string }> {}
```

在 `src/lib/services/users.ts` 中实现：

```ts
export async function authenticateUser(
  username: string,
  password: string
): Promise<{ userId: string; role: "ADMIN" | "USER"; forcePasswordChange: boolean }> {}

export async function resetUserPassword(
  userId: string,
  adminUserId: string
): Promise<{ tempPassword: string }> {}

export async function disableUser(
  userId: string,
  adminUserId: string
): Promise<void> {}

export async function logoutBySession(sessionId: string): Promise<void> {}
```

- [ ] **Step 3: 实现认证与管理员 API**

完成：

1. `POST /api/auth/register-request`
2. `POST /api/auth/login`
3. `POST /api/auth/logout`
4. `POST /api/auth/force-password`
5. `GET/POST /api/admin/account-requests`
6. `GET/POST/PATCH /api/admin/users`
7. `POST /api/admin/users/[userId]/reset-password`

要求：

1. 登录成功时创建数据库 `sessions` 记录
2. 登出时失效当前会话
3. 用户被禁用或重置密码时，主动失效该用户现有会话

Run: `pnpm vitest run tests/integration/api/auth.test.ts tests/integration/api/admin-users.test.ts`
Expected: PASS。

- [ ] **Step 4: 实现登录、注册申请、首次改密页面**

页面最少具备：

1. 表单提交
2. 错误提示
3. 成功跳转
4. 待审批提示

Run: `pnpm playwright test tests/e2e/auth.spec.ts`
Expected: PASS，至少覆盖“申请 -> 审批 -> 登录 -> 强制改密”的主流程。

- [ ] **Step 5: 实现管理员布局守卫**

在 `src/app/admin/layout.tsx` 中统一执行页面层管理员鉴权：

1. 未登录跳转登录页
2. 非管理员返回 `403` 页面或跳转工作区首页
3. 为 `/admin/users`、`/admin/providers`、`/admin/tasks`、`/admin/storage` 提供共用导航框架

Run: `pnpm lint`

Run: `pnpm typecheck`
Expected: 通过，且管理员页面不再依赖各自页面单独做权限判断。

- [ ] **Step 6: 提交本任务**

Run: `git add src/app/(auth) src/app/admin/layout.tsx src/app/admin/users src/app/api/auth src/app/api/admin src/lib/services tests/integration/api tests/e2e/auth.spec.ts`

Run: `git commit -m "feat: add auth pages and admin approval flow"`
Expected: 生成一个干净提交。

### Task 6: 建立项目、任务、资产基础域模型和工作区骨架

**Files:**
- Create: `src/app/(workspace)/layout.tsx`
- Create: `src/app/(workspace)/page.tsx`
- Create: `src/app/api/projects/route.ts`
- Create: `src/app/api/projects/[projectId]/route.ts`
- Create: `src/app/api/tasks/route.ts`
- Create: `src/app/api/tasks/[taskId]/route.ts`
- Create: `src/lib/services/projects.ts`
- Create: `src/lib/services/tasks.ts`
- Create: `src/lib/storage/paths.ts`
- Create: `src/lib/storage/fs-storage.ts`
- Test: `tests/unit/storage/fs-storage.test.ts`
- Test: `tests/integration/api/projects-and-tasks.test.ts`

- [ ] **Step 1: 写项目和任务测试**

覆盖：

1. 创建项目
2. 获取本人项目列表
3. 创建任务记录
4. 更新任务状态
5. 不允许访问其他用户项目

Run: `pnpm vitest run tests/integration/api/projects-and-tasks.test.ts tests/unit/storage/fs-storage.test.ts`
Expected: FAIL。

- [ ] **Step 2: 实现存储路径与文件写入封装**

`src/lib/storage/paths.ts` 约定：

```ts
storage/uploads/{projectId}/{taskId}/
storage/generated-images/{projectId}/{taskId}/
storage/generated-videos/{projectId}/{taskId}/
storage/exports/{projectId}/
```

`src/lib/storage/fs-storage.ts` 实现：

```ts
writeTempFile()
promoteTempFile()
deleteFile()
openReadStream()
```

- [ ] **Step 3: 实现项目与任务服务/API**

完成：

1. `GET/POST /api/projects`
2. `GET/PATCH /api/projects/[projectId]`
3. `POST /api/tasks`
4. `GET /api/tasks/[taskId]`

Run: `pnpm vitest run tests/integration/api/projects-and-tasks.test.ts tests/unit/storage/fs-storage.test.ts`
Expected: PASS。

- [ ] **Step 4: 实现工作区布局和仪表盘骨架**

仪表盘先展示：

1. 最近项目
2. 最近任务
3. 失败任务数量

Run: `pnpm lint`

Run: `pnpm typecheck`
Expected: 通过。

- [ ] **Step 5: 提交本任务**

Run: `git add src/app/(workspace) src/app/api/projects src/app/api/tasks src/lib/services/projects.ts src/lib/services/tasks.ts src/lib/storage tests`

Run: `git commit -m "feat: add projects tasks and workspace shell"`
Expected: 生成一个干净提交。

### Task 7: 实现模型配置后台和统一模型适配契约

**Files:**
- Create: `src/app/admin/providers/page.tsx`
- Create: `src/app/api/admin/providers/route.ts`
- Create: `src/lib/models/contracts.ts`
- Create: `src/lib/models/provider-registry.ts`
- Create: `src/lib/models/proxy-client.ts`
- Create: `src/lib/services/providers.ts`
- Test: `tests/unit/models/contracts.test.ts`
- Test: `tests/integration/api/providers.test.ts`

- [ ] **Step 1: 写模型契约和模型配置测试**

契约测试校验：

```ts
taskType in [
  "script_question_generate",
  "script_finalize",
  "storyboard_split",
  "image_generate",
  "image_edit",
  "video_generate"
]
```

接口测试校验：

1. 管理员可创建/修改提供方配置
2. 普通用户无权访问
3. 能获取每条链路默认模型

Run: `pnpm vitest run tests/unit/models/contracts.test.ts tests/integration/api/providers.test.ts`
Expected: FAIL。

- [ ] **Step 2: 实现模型契约**

在 `src/lib/models/contracts.ts` 中用 `zod` 定义：

```ts
export const ModelRequestSchema = z.object({
  taskType: z.enum([
    "script_question_generate",
    "script_finalize",
    "storyboard_split",
    "image_generate",
    "image_edit",
    "video_generate"
  ]),
  providerKey: z.string(),
  model: z.string(),
  inputText: z.string().optional(),
  inputFiles: z.array(z.string()).default([]),
  options: z.record(z.string(), z.unknown()).default({}),
  traceId: z.string()
});
```

- [ ] **Step 3: 实现模型配置服务与 API**

完成：

1. `GET/POST/PATCH /api/admin/providers`
2. `src/lib/services/providers.ts`
3. `src/lib/models/provider-registry.ts`

Run: `pnpm vitest run tests/unit/models/contracts.test.ts tests/integration/api/providers.test.ts`
Expected: PASS。

- [ ] **Step 4: 实现代理客户端**

在 `src/lib/models/proxy-client.ts` 中封装：

```ts
export async function callProxyModel(
  input: ModelRequest
): Promise<{
  status: "ok" | "error";
  textOutput?: string;
  fileOutputs?: string[];
  rawResponse: unknown;
  errorCode?: string;
  errorMessage?: string;
}> {}
```

要求：

1. 统一设置超时
2. 注入鉴权头
3. 把失败转换为统一错误码

- [ ] **Step 5: 实现模型配置页面并验证**

Run: `pnpm lint`

Run: `pnpm typecheck`
Expected: 通过。

- [ ] **Step 6: 提交本任务**

Run: `git add src/app/admin/providers src/app/api/admin/providers src/lib/models src/lib/services/providers.ts tests`

Run: `git commit -m "feat: add model provider config and contracts"`
Expected: 生成一个干净提交。

### Task 8: 搭建 BullMQ 队列、worker 运行时和任务编排入口

**Files:**
- Create: `src/lib/redis.ts`
- Create: `src/lib/queues/index.ts`
- Create: `src/lib/queues/enqueue.ts`
- Create: `src/worker/index.ts`
- Create: `src/worker/processors/script.ts`
- Create: `src/worker/processors/storyboard.ts`
- Create: `src/worker/processors/image.ts`
- Create: `src/worker/processors/video.ts`
- Test: `tests/integration/workers/queue-bootstrap.test.ts`

- [ ] **Step 1: 写队列初始化测试**

验证：

1. 能拿到 4 条队列实例
2. 入队后 job 名称正确
3. worker 启动不会抛出模块错误

Run: `pnpm vitest run tests/integration/workers/queue-bootstrap.test.ts`
Expected: FAIL。

- [ ] **Step 2: 实现 Redis 与队列注册**

在 `src/lib/queues/index.ts` 中导出：

```ts
const connection = new IORedis(loadEnv(process.env).REDIS_URL, {
  maxRetriesPerRequest: null
});

export const queues = {
  script: new Queue("script-queue", { connection }),
  storyboard: new Queue("storyboard-queue", { connection }),
  image: new Queue("image-queue", { connection }),
  video: new Queue("video-queue", { connection })
};
```

- [ ] **Step 3: 实现统一入队入口**

在 `src/lib/queues/enqueue.ts` 中实现：

```ts
export async function enqueueTask(
  taskId: string,
  type: TaskType,
  payload: unknown
): Promise<{ jobId: string; queueName: string }> {}
```

要求：

1. 根据任务类型选择队列
2. 写入 `task_steps`
3. 记录 `traceId`

- [ ] **Step 4: 搭建 worker 进程和空处理器**

每个 processor 先只做：

1. 拉取任务
2. 标记 `running`
3. 输出最小合法结果对象，例如 `{ ok: true, traceId }`
4. 标记 `succeeded`

Run: `pnpm vitest run tests/integration/workers/queue-bootstrap.test.ts`
Expected: PASS。

- [ ] **Step 5: 手动验证 worker 能启动**

Run: `pnpm worker`
Expected: 终端打印 4 条 worker 启动日志，无立即崩溃。

- [ ] **Step 6: 提交本任务**

Run: `git add src/lib/redis.ts src/lib/queues src/worker tests/integration/workers/queue-bootstrap.test.ts`

Run: `git commit -m "feat: add queue runtime and worker bootstrap"`
Expected: 生成一个干净提交。

### Task 9: 实现项目内剧本会话式生成链路

**Files:**
- Create: `src/app/(workspace)/projects/[projectId]/script/page.tsx`
- Create: `src/app/api/script/sessions/route.ts`
- Create: `src/app/api/script/sessions/[sessionId]/message/route.ts`
- Create: `src/lib/services/script-sessions.ts`
- Modify: `src/worker/processors/script.ts`
- Test: `tests/integration/api/script-session.test.ts`
- Test: `tests/e2e/script-session.spec.ts`

- [ ] **Step 1: 写剧本会话测试**

覆盖：

1. 创建 `script_session`
2. 返回第一轮问题
3. 提交回答后返回下一轮问题
4. 最终定稿生成 `script_version`
5. 会话结束后不可继续写入

Run: `pnpm vitest run tests/integration/api/script-session.test.ts`
Expected: FAIL。

- [ ] **Step 2: 实现剧本会话服务**

在 `src/lib/services/script-sessions.ts` 中实现：

```ts
export async function startScriptSession(
  projectId: string,
  idea: string,
  userId: string
): Promise<{ sessionId: string; firstQuestion: string }> {}

export async function answerScriptQuestion(
  sessionId: string,
  answer: string,
  userId: string
): Promise<{ nextQuestion?: string; completed: boolean }> {}

export async function finalizeScriptSession(
  sessionId: string,
  userId: string
): Promise<{ scriptVersionId: string }> {}
```

要求：

1. 问答记录写入 `script_sessions`
2. 每次调用模型都带 `traceId`
3. 最终结果写入 `script_versions`

- [ ] **Step 3: 实现剧本 API 和 worker 处理**

1. `POST /api/script/sessions`
2. `POST /api/script/sessions/[sessionId]/message`
3. `script` worker 支持两类 job：
   - `script_question_generate`
   - `script_finalize`

Run: `pnpm vitest run tests/integration/api/script-session.test.ts`
Expected: PASS。

- [ ] **Step 4: 实现剧本页面**

页面要支持：

1. 从路由参数读取 `projectId`
2. 项目上下文标题与返回项目详情入口
3. 输入创意
4. 显示问题列表
5. 回答单轮问题
6. 查看最终剧本
7. 继续基于当前项目再次开启新会话

Run: `pnpm playwright test tests/e2e/script-session.spec.ts`
Expected: PASS。

- [ ] **Step 5: 提交本任务**

Run: `git add src/app/(workspace)/projects/[projectId]/script src/app/api/script src/lib/services/script-sessions.ts src/worker/processors/script.ts tests`

Run: `git commit -m "feat: add script session workflow"`
Expected: 生成一个干净提交。

### Task 10: 实现项目内剧本转分镜链路

**Files:**
- Create: `src/app/(workspace)/projects/[projectId]/storyboard/page.tsx`
- Create: `src/app/api/storyboards/route.ts`
- Create: `src/lib/services/storyboards.ts`
- Modify: `src/worker/processors/storyboard.ts`
- Test: `tests/integration/workers/storyboard-worker.test.ts`

- [ ] **Step 1: 写分镜任务测试**

验证：

1. 输入剧本版本后创建 `STORYBOARD` 任务
2. worker 成功后落库 `storyboard_versions`
3. 分镜 JSON 至少包含 `index`、`durationSeconds`、`scene`、`shot`、`action`、`dialogue`、`videoPrompt`

Run: `pnpm vitest run tests/integration/workers/storyboard-worker.test.ts`
Expected: FAIL。

- [ ] **Step 2: 实现分镜服务与 API**

在 `src/lib/services/storyboards.ts` 中实现：

```ts
export async function enqueueStoryboardGeneration(input: {
  projectId: string;
  scriptVersionId: string;
  userId: string;
}): Promise<{ taskId: string }> {}
```

API：

1. `POST /api/storyboards`
2. `GET /api/tasks/[taskId]` 能返回任务与结果摘要

- [ ] **Step 3: 实现分镜 worker**

处理逻辑：

1. 读取剧本正文
2. 调用 `storyboard_split` 模型任务
3. 校验分镜结构
4. 写入 `storyboard_versions`
5. 更新任务状态

Run: `pnpm vitest run tests/integration/workers/storyboard-worker.test.ts`
Expected: PASS。

- [ ] **Step 4: 实现分镜页面**

页面最少支持：

1. 从路由参数读取 `projectId`
2. 只展示当前项目的剧本版本
3. 发起任务
4. 查看结构化分镜结果
5. 复制单段视频提示词

Run: `pnpm lint`

Run: `pnpm typecheck`
Expected: 通过。

- [ ] **Step 5: 提交本任务**

Run: `git add src/app/(workspace)/projects/[projectId]/storyboard src/app/api/storyboards src/lib/services/storyboards.ts src/worker/processors/storyboard.ts tests/integration/workers/storyboard-worker.test.ts`

Run: `git commit -m "feat: add storyboard generation workflow"`
Expected: 生成一个干净提交。

### Task 11: 实现项目内图片生成与编辑链路

**Files:**
- Create: `src/app/(workspace)/projects/[projectId]/images/page.tsx`
- Create: `src/app/api/images/route.ts`
- Create: `src/lib/services/images.ts`
- Modify: `src/worker/processors/image.ts`
- Test: `tests/integration/workers/image-worker.test.ts`

- [ ] **Step 1: 写图片任务测试**

验证：

1. 文生图任务能入队
2. 图生图任务能记录输入参考图
3. 成功后写入 `assets`
4. 失败时保留错误日志

Run: `pnpm vitest run tests/integration/workers/image-worker.test.ts`
Expected: FAIL。

- [ ] **Step 2: 实现图片服务与 API**

在 `src/lib/services/images.ts` 中实现：

```ts
export async function enqueueImageGeneration(input: {
  projectId: string;
  prompt: string;
  sourceAssetId?: string;
  userId: string;
}): Promise<{ taskId: string }> {}
```

API：

1. `POST /api/images`
2. 支持 `multipart/form-data`

- [ ] **Step 3: 实现图片 worker**

逻辑：

1. 读取输入提示词和可选参考图
2. 调用 `image_generate` 或 `image_edit`
3. 将结果先写临时目录，再提升到正式目录
4. 写入 `assets`
5. 更新任务和 `task_steps`

Run: `pnpm vitest run tests/integration/workers/image-worker.test.ts`
Expected: PASS。

- [ ] **Step 4: 实现图片页面**

页面最少支持：

1. 从路由参数读取 `projectId`
2. 文生图模式
3. 图生图模式
4. 参考图只允许选择当前项目资产
5. 图片预览
6. 任务状态提示
7. 结果落入当前项目详情

Run: `pnpm lint`

Run: `pnpm typecheck`
Expected: 通过。

- [ ] **Step 5: 提交本任务**

Run: `git add src/app/(workspace)/projects/[projectId]/images src/app/api/images src/lib/services/images.ts src/worker/processors/image.ts tests/integration/workers/image-worker.test.ts`

Run: `git commit -m "feat: add image generation and editing workflow"`
Expected: 生成一个干净提交。

### Task 12: 实现项目内 AI 视频生成链路

**Files:**
- Create: `src/app/(workspace)/projects/[projectId]/videos/page.tsx`
- Create: `src/app/api/videos/route.ts`
- Create: `src/lib/services/videos.ts`
- Modify: `src/worker/processors/video.ts`
- Test: `tests/integration/workers/video-worker.test.ts`

- [ ] **Step 1: 写视频任务测试**

验证：

1. 输入分镜提示词和参考图后能创建 `VIDEO` 任务
2. 成功后写入视频 `assets`
3. 错误时标记任务失败
4. 一次重试后仍失败则停止

Run: `pnpm vitest run tests/integration/workers/video-worker.test.ts`
Expected: FAIL。

- [ ] **Step 2: 实现视频服务与 API**

在 `src/lib/services/videos.ts` 中实现：

```ts
export async function enqueueVideoGeneration(input: {
  projectId: string;
  prompt: string;
  referenceAssetIds: string[];
  userId: string;
}): Promise<{ taskId: string }> {}
```

API：

1. `POST /api/videos`

- [ ] **Step 3: 实现视频 worker**

逻辑：

1. 读取分镜提示词和参考图
2. 调用 `video_generate`
3. 保存输出视频
4. 更新任务状态和日志
5. 按规则执行 1 次自动重试

Run: `pnpm vitest run tests/integration/workers/video-worker.test.ts`
Expected: PASS。

- [ ] **Step 4: 实现视频页面**

页面最少支持：

1. 从路由参数读取 `projectId`
2. 输入提示词
3. 选择当前项目下的参考图
4. 查看任务进度
5. 预览生成视频

Run: `pnpm lint`

Run: `pnpm typecheck`
Expected: 通过。

- [ ] **Step 5: 提交本任务**

Run: `git add src/app/(workspace)/projects/[projectId]/videos src/app/api/videos src/lib/services/videos.ts src/worker/processors/video.ts tests/integration/workers/video-worker.test.ts`

Run: `git commit -m "feat: add video generation workflow"`
Expected: 生成一个干净提交。

### Task 13: 完成项目详情页、资产下载和任务历史视图

**Files:**
- Create: `src/app/(workspace)/projects/[projectId]/page.tsx`
- Create: `src/app/api/assets/[assetId]/download/route.ts`
- Modify: `src/lib/services/projects.ts`
- Modify: `src/lib/services/tasks.ts`
- Test: `tests/integration/api/project-detail.test.ts`
- Test: `tests/e2e/workflow.spec.ts`

- [ ] **Step 1: 写项目详情测试**

验证：

1. 项目详情能返回剧本版本、分镜版本、图片资产、视频资产、任务历史
2. 下载 API 会校验所属用户
3. 他人项目下载应返回 `403`

Run: `pnpm vitest run tests/integration/api/project-detail.test.ts`
Expected: FAIL。

- [ ] **Step 2: 扩展项目聚合查询服务**

在 `src/lib/services/projects.ts` 中新增：

```ts
export async function getProjectDetail(
  projectId: string,
  userId: string
): Promise<{
  project: Project;
  scriptVersions: ScriptVersion[];
  storyboardVersions: StoryboardVersion[];
  imageAssets: Asset[];
  videoAssets: Asset[];
  tasks: Task[];
}> {}
```

返回：

```ts
{
  project,
  scriptVersions,
  storyboardVersions,
  imageAssets,
  videoAssets,
  tasks
}
```

- [ ] **Step 3: 实现下载 API 和详情页**

完成：

1. `GET /api/assets/[assetId]/download`
2. 项目详情页卡片式展示所有产物

Run: `pnpm vitest run tests/integration/api/project-detail.test.ts`
Expected: PASS。

- [ ] **Step 4: 跑端到端主流程**

`tests/e2e/workflow.spec.ts` 覆盖：

1. 登录
2. 创建项目
3. 发起剧本会话
4. 发起分镜任务
5. 发起图片任务
6. 发起视频任务
7. 在项目详情看到所有结果

Run: `pnpm playwright test tests/e2e/workflow.spec.ts`
Expected: PASS。

- [ ] **Step 5: 提交本任务**

Run: `git add src/app/(workspace)/projects src/app/api/assets src/lib/services/projects.ts src/lib/services/tasks.ts tests`

Run: `git commit -m "feat: add project detail and asset download views"`
Expected: 生成一个干净提交。

### Task 14: 完成管理员任务监控、存储管理和失败恢复

**Files:**
- Create: `src/app/admin/tasks/page.tsx`
- Create: `src/app/admin/storage/page.tsx`
- Create: `src/app/api/admin/tasks/route.ts`
- Create: `src/app/api/admin/tasks/[taskId]/retry/route.ts`
- Create: `src/app/api/admin/storage/route.ts`
- Modify: `src/lib/services/tasks.ts`
- Modify: `src/lib/storage/fs-storage.ts`
- Test: `tests/integration/api/admin-tasks.test.ts`
- Test: `tests/e2e/admin.spec.ts`

- [ ] **Step 1: 写管理员任务和存储测试**

覆盖：

1. 管理员能查看失败任务列表
2. 管理员能手动重试任务
3. 管理员能查看目录占用统计
4. 普通用户无权访问

Run: `pnpm vitest run tests/integration/api/admin-tasks.test.ts`
Expected: FAIL。

- [ ] **Step 2: 实现任务监控和重试 API**

完成：

1. `GET /api/admin/tasks`
2. `POST /api/admin/tasks/[taskId]/retry`

要求：

1. 重试前校验任务状态
2. 重试时写新的 `task_step`
3. 复用统一入队函数

- [ ] **Step 3: 实现存储统计 API**

完成：

1. `GET /api/admin/storage`

返回：

```ts
{
  totalBytes,
  uploadsBytes,
  imagesBytes,
  videosBytes,
  exportsBytes
}
```

Run: `pnpm vitest run tests/integration/api/admin-tasks.test.ts`
Expected: PASS。

- [ ] **Step 4: 实现管理员任务页和存储页**

Run: `pnpm playwright test tests/e2e/admin.spec.ts`
Expected: PASS，至少覆盖“审批申请、查看失败任务、重试任务、查看存储统计”。

- [ ] **Step 5: 提交本任务**

Run: `git add src/app/admin/tasks src/app/admin/storage src/app/api/admin/tasks src/app/api/admin/storage src/lib/services/tasks.ts src/lib/storage/fs-storage.ts tests`

Run: `git commit -m "feat: add admin task monitoring and storage views"`
Expected: 生成一个干净提交。

### Task 15: 补齐局域网部署说明、备份恢复和最终全量验证

**Files:**
- Create: `README.md`
- Create: `tests/e2e/full-smoke.spec.ts`

- [ ] **Step 1: 写最终全量冒烟脚本**

`tests/e2e/full-smoke.spec.ts` 覆盖：

1. 管理员登录
2. 用户申请与审批
3. 用户登录
4. 创建项目
5. 走通 4 条链路
6. 查看项目详情
7. 管理员重试失败任务

Run: `pnpm playwright test tests/e2e/full-smoke.spec.ts`
Expected: 初次 FAIL，提示缺少尚未补齐的页面或流程。

- [ ] **Step 2: 补齐 README 运维文档**

README 至少包含：

1. 环境变量说明
2. `docker compose up -d` 启动方法
3. `pnpm db:migrate`、`pnpm db:seed` 执行顺序
4. `pnpm worker` 启动方法
5. `web`、`worker`、`postgres`、`redis` 四服务职责说明
6. 局域网访问地址设置
7. `pg-data`、`redis-data` 和 `storage/` 的备份/恢复方法

- [ ] **Step 3: 运行最终验证矩阵**

Run: `pnpm lint`

Run: `pnpm typecheck`

Run: `pnpm test`

Run: `pnpm playwright test`

Run: `docker compose up -d`

Run: `pnpm build`
Expected: 全部通过；如果任一项失败，先修复再提交。

- [ ] **Step 4: 提交本任务**

Run: `git add README.md tests/e2e/full-smoke.spec.ts`

Run: `git commit -m "docs: finalize ops guide and verification coverage"`
Expected: 生成一个干净提交。

## 执行完成定义

以下条件全部满足，才算 V1 达到“可交付实施完成”：

1. 注册申请、审批、登录、首次改密完整可用。
2. 普通用户与管理员权限边界正确。
3. 项目、任务、文本版本、图片、视频均可持久化保存。
4. 剧本会话、分镜、图片、视频 4 条链路均能在 UI 发起并落盘。
5. 管理员能配置模型代理和默认模型。
6. 管理员能查看失败任务并重新入队。
7. 服务重启后数据与文件仍能访问。
8. `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm playwright test`、`pnpm build` 全通过。

## 计划自审清单

- [ ] 所有规格要求都在任务中有落点
- [ ] 没有把“剧本会话式流程”误拆成一次性长任务
- [ ] 没有遗漏注册申请页和管理员审批
- [ ] 4 条链路都有对应 API、页面、服务、worker、测试
- [ ] 每个任务都包含可执行的验证方式
- [ ] 每个任务都以独立 commit 结束
