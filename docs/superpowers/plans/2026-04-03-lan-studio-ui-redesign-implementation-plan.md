# LAN Studio UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the existing LAN Studio frontend into the approved `Spotlight Studio` creative-workspace design system without changing the underlying product workflows.

**Architecture:** Keep the current Next.js App Router routes and service layer intact, but move the presentation layer onto a shared visual system: global tokens in [`src/app/globals.css`](/d:/AI短剧创作/.worktrees/lan-studio-v1/src/app/globals.css), shared studio UI components in `src/components/studio/`, and consistent shell/page composition across workspace, project, auth, admin, and workflow pages. Deliver the redesign in route-aligned slices so each slice can be verified independently with existing unit/e2e coverage.

**Tech Stack:** Next.js App Router, React 19, TypeScript, CSS, Vitest, Testing Library, Playwright

---

## Route To File Mapping

Use these names consistently during implementation and review:

- `workspace 首页` -> [`src/app/(workspace)/workspace/page.tsx`](/d:/AI短剧创作/.worktrees/lan-studio-v1/src/app/(workspace)/workspace/page.tsx)
- `项目详情 / 流程入口页` -> [`src/app/(workspace)/projects/[projectId]/page.tsx`](/d:/AI短剧创作/.worktrees/lan-studio-v1/src/app/(workspace)/projects/[projectId]/page.tsx)
- `登录页` -> [`src/app/(auth)/login/login-form.tsx`](/d:/AI短剧创作/.worktrees/lan-studio-v1/src/app/(auth)/login/login-form.tsx)
- `注册申请页` -> [`src/app/(auth)/register-request/page.tsx`](/d:/AI短剧创作/.worktrees/lan-studio-v1/src/app/(auth)/register-request/page.tsx)
- `首次改密页` -> [`src/app/(auth)/force-password/page.tsx`](/d:/AI短剧创作/.worktrees/lan-studio-v1/src/app/(auth)/force-password/page.tsx)
- `工作区壳层` -> [`src/app/(workspace)/layout.tsx`](/d:/AI短剧创作/.worktrees/lan-studio-v1/src/app/(workspace)/layout.tsx)
- `后台壳层` -> [`src/app/admin/layout.tsx`](/d:/AI短剧创作/.worktrees/lan-studio-v1/src/app/admin/layout.tsx)
- `后台主要管理页` -> [`src/app/admin/users/page.tsx`](/d:/AI短剧创作/.worktrees/lan-studio-v1/src/app/admin/users/page.tsx), [`src/app/admin/providers/page.tsx`](/d:/AI短剧创作/.worktrees/lan-studio-v1/src/app/admin/providers/page.tsx), [`src/app/admin/tasks/page.tsx`](/d:/AI短剧创作/.worktrees/lan-studio-v1/src/app/admin/tasks/page.tsx), [`src/app/admin/storage/page.tsx`](/d:/AI短剧创作/.worktrees/lan-studio-v1/src/app/admin/storage/page.tsx)
- `工作流子页` -> [`src/app/(workspace)/projects/[projectId]/script/page.tsx`](/d:/AI短剧创作/.worktrees/lan-studio-v1/src/app/(workspace)/projects/[projectId]/script/page.tsx), [`src/app/(workspace)/projects/[projectId]/storyboard/page.tsx`](/d:/AI短剧创作/.worktrees/lan-studio-v1/src/app/(workspace)/projects/[projectId]/storyboard/page.tsx), [`src/app/(workspace)/projects/[projectId]/images/page.tsx`](/d:/AI短剧创作/.worktrees/lan-studio-v1/src/app/(workspace)/projects/[projectId]/images/page.tsx), [`src/app/(workspace)/projects/[projectId]/videos/page.tsx`](/d:/AI短剧创作/.worktrees/lan-studio-v1/src/app/(workspace)/projects/[projectId]/videos/page.tsx)

## Planned File Structure

### New shared presentation files

- Create: `src/components/studio/app-shell.tsx`
  - Shared shell wrapper for workspace/admin chrome
- Create: `src/components/studio/page-hero.tsx`
  - Hero/spotlight block with eyebrow, title, copy, and action slots
- Create: `src/components/studio/status-badge.tsx`
  - Unified status tokens for project/task/admin states
- Create: `src/components/studio/metric-card.tsx`
  - Shared KPI/stat card
- Create: `src/components/studio/project-card.tsx`
  - Workspace project summary card
- Create: `src/components/studio/workflow-rail.tsx`
  - Four-stage workflow rail used in project detail and supporting pages

### Existing files to centralize on the shared system

- Modify: `src/app/globals.css`
- Modify: `src/app/layout.tsx`
- Modify: `src/app/(workspace)/layout.tsx`
- Modify: `src/app/admin/layout.tsx`
- Modify: `src/app/(workspace)/workspace/page.tsx`
- Modify: `src/app/(workspace)/workspace/create-project-form.tsx`
- Modify: `src/app/(workspace)/projects/[projectId]/page.tsx`
- Modify: `src/app/(auth)/login/login-form.tsx`
- Modify: `src/app/(auth)/register-request/page.tsx`
- Modify: `src/app/(auth)/force-password/page.tsx`
- Modify: `src/app/admin/users/page.tsx`
- Modify: `src/app/admin/providers/page.tsx`
- Modify: `src/app/admin/tasks/page.tsx`
- Modify: `src/app/admin/storage/page.tsx`
- Modify: `src/app/(workspace)/projects/[projectId]/script/page.tsx`
- Modify: `src/app/(workspace)/projects/[projectId]/storyboard/page.tsx`
- Modify: `src/app/(workspace)/projects/[projectId]/images/page.tsx`
- Modify: `src/app/(workspace)/projects/[projectId]/videos/page.tsx`

### Existing tests to use and extend

- Modify: `tests/unit/workspace/workspace-shell.test.ts`
- Create: `tests/unit/workspace/create-project-form.test.tsx`
- Modify: `tests/unit/workspace/project-detail-page.test.tsx`
- Modify: `tests/unit/workspace/script-page.test.tsx`
- Modify: `tests/unit/workspace/images-page.test.tsx`
- Create: `tests/unit/workspace/storyboard-page.test.tsx`
- Create: `tests/unit/workspace/videos-page.test.tsx`
- Modify: `tests/unit/auth/login-page.test.ts`
- Modify: `tests/unit/auth/force-password-page.test.ts`
- Create: `tests/unit/auth/register-request-page.test.tsx`
- Modify: `tests/unit/admin/admin-layout.test.tsx`
- Create: `tests/unit/admin/providers-page.test.tsx`
- Modify: `tests/unit/admin/tasks-page.test.tsx`
- Modify: `tests/e2e/auth.spec.ts`
- Modify: `tests/e2e/admin.spec.ts`
- Modify: `tests/e2e/workflow.spec.ts`
- Modify: `tests/e2e/full-smoke.spec.ts`

## Implementation Tasks

### Task 1: Build the shared Spotlight Studio foundation

**Files:**
- Create: `src/components/studio/app-shell.tsx`
- Create: `src/components/studio/page-hero.tsx`
- Create: `src/components/studio/status-badge.tsx`
- Create: `src/components/studio/metric-card.tsx`
- Create: `src/components/studio/project-card.tsx`
- Create: `src/components/studio/workflow-rail.tsx`
- Modify: `src/app/globals.css`
- Modify: `src/app/layout.tsx`
- Modify: `src/app/(workspace)/layout.tsx`
- Modify: `src/app/admin/layout.tsx`
- Test: `tests/unit/workspace/workspace-shell.test.ts`
- Test: `tests/unit/admin/admin-layout.test.tsx`

- [ ] **Step 1: Update the shell tests to describe the new shared chrome**

Add assertions for:

```ts
expect(screen.getByText("Lan Studio")).toBeInTheDocument();
expect(screen.getByText("Creative workspace")).toBeInTheDocument();
expect(screen.getByText("Admin control")).toBeInTheDocument();
```

and for visible studio navigation labels rather than the old single-link shell.

- [ ] **Step 2: Run the shell tests to capture the initial failures**

Run: `pnpm vitest run tests/unit/workspace/workspace-shell.test.ts tests/unit/admin/admin-layout.test.tsx`

Expected: FAIL because the existing layouts do not expose the new chrome, labels, or shared components.

- [ ] **Step 3: Implement the design system foundation**

Make these changes:

```css
:root {
  --bg: #0f0f23;
  --bg-elevated: #17172b;
  --panel: #161827;
  --panel-strong: #1f2143;
  --text: #f8fafc;
  --text-muted: #b8c0d4;
  --border: rgba(129, 140, 248, 0.24);
  --accent-gold: #ca8a04;
  --accent-violet: #6d5efc;
}
```

Then:
- import the approved `Fira Sans` / `Fira Code` font pair in the root layout
- replace the old inline workspace/admin shell styles with `AppShell`
- keep redirects/auth guards intact
- keep the non-HTTPS admin warning behavior intact

- [ ] **Step 4: Re-run the shell tests**

Run: `pnpm vitest run tests/unit/workspace/workspace-shell.test.ts tests/unit/admin/admin-layout.test.tsx`

Expected: PASS.

- [ ] **Step 5: Run type and lint checks for the shell slice**

Run: `pnpm lint`

Run: `pnpm typecheck`

Expected: PASS.

- [ ] **Step 6: Commit the shared foundation**

Run: `git add src/app/globals.css src/app/layout.tsx src/app/(workspace)/layout.tsx src/app/admin/layout.tsx src/components/studio tests/unit/workspace/workspace-shell.test.ts tests/unit/admin/admin-layout.test.tsx`

Run: `git commit -m "feat: add spotlight studio shell foundation"`

Expected: one focused commit for the shared visual system baseline.

### Task 2: Redesign the workspace dashboard and create-project entry

**Files:**
- Modify: `src/app/(workspace)/workspace/page.tsx`
- Modify: `src/app/(workspace)/workspace/create-project-form.tsx`
- Modify: `src/components/studio/page-hero.tsx`
- Modify: `src/components/studio/project-card.tsx`
- Modify: `src/components/studio/metric-card.tsx`
- Test: `tests/unit/workspace/workspace-shell.test.ts`
- Test: `tests/unit/workspace/create-project-form.test.tsx`
- Test: `tests/e2e/workflow.spec.ts`

- [ ] **Step 1: Add dashboard and create-project tests for the new information hierarchy**

Create/update tests to assert:

```ts
expect(screen.getByText("今日创作控制台")).toBeInTheDocument();
expect(screen.getByRole("button", { name: "创建项目并进入脚本流程" })).toBeInTheDocument();
expect(screen.getByText("Script")).toBeInTheDocument();
expect(screen.getByText("Storyboard")).toBeInTheDocument();
```

Also assert the form still posts the same payload and still routes to `/projects/:id`.

- [ ] **Step 2: Run the workspace tests before implementation**

Run: `pnpm vitest run tests/unit/workspace/workspace-shell.test.ts tests/unit/workspace/create-project-form.test.tsx`

Expected: FAIL because the current dashboard is still the old list-and-stats layout.

- [ ] **Step 3: Implement the workspace redesign**

Deliver:
- a `spotlight` hero with welcome text, recent-activity summary, and main CTA
- a four-stage workflow overview using `WorkflowRail`
- project cards that show status, update time, current phase, and next action
- a visually promoted create-project form
- corrected Chinese copy where the page currently contains mojibake

Do not change:
- `listRecentProjects`
- `listRecentTasks`
- `countFailedTasks`
- the form POST behavior

- [ ] **Step 4: Re-run targeted workspace verification**

Run: `pnpm vitest run tests/unit/workspace/workspace-shell.test.ts tests/unit/workspace/create-project-form.test.tsx`

Expected: PASS.

- [ ] **Step 5: Re-run one end-to-end workflow smoke**

Run: `pnpm playwright test tests/e2e/workflow.spec.ts`

Expected: PASS with updated selectors/assertions for the redesigned workspace landing page.

- [ ] **Step 6: Commit the workspace redesign**

Run: `git add src/app/(workspace)/workspace/page.tsx src/app/(workspace)/workspace/create-project-form.tsx src/components/studio tests/unit/workspace/workspace-shell.test.ts tests/unit/workspace/create-project-form.test.tsx tests/e2e/workflow.spec.ts`

Run: `git commit -m "feat: redesign workspace dashboard"`

Expected: one focused commit for the first-priority page.

### Task 3: Turn project detail into the workflow control page

**Files:**
- Modify: `src/app/(workspace)/projects/[projectId]/page.tsx`
- Modify: `src/components/studio/page-hero.tsx`
- Modify: `src/components/studio/status-badge.tsx`
- Modify: `src/components/studio/workflow-rail.tsx`
- Test: `tests/unit/workspace/project-detail-page.test.tsx`
- Test: `tests/e2e/workflow.spec.ts`

- [ ] **Step 1: Update the project-detail tests to describe the new workflow rail**

Assert the page now exposes:

```ts
expect(screen.getByText("制作台")).toBeInTheDocument();
expect(screen.getByText("Script")).toBeInTheDocument();
expect(screen.getByText("Images")).toBeInTheDocument();
expect(screen.getByRole("link", { name: "继续脚本流程" })).toHaveAttribute("href", "/projects/project-1/script");
```

and that historical sections still render after the rail.

- [ ] **Step 2: Run the project-detail tests to verify failure**

Run: `pnpm vitest run tests/unit/workspace/project-detail-page.test.tsx`

Expected: FAIL because the current page is still a history-first page with old labels.

- [ ] **Step 3: Implement the project detail redesign**

Build:
- a project hero with title, idea, status, updated time, and primary/secondary CTAs
- a four-stage workflow rail where each stage summarizes the latest artifact/result
- history sections below the workflow rail
- larger, more intentional image/video preview cards
- corrected Chinese copy in all visible labels

Keep:
- `getProjectDetail`
- asset download links
- task history data

- [ ] **Step 4: Re-run the project-detail unit test**

Run: `pnpm vitest run tests/unit/workspace/project-detail-page.test.tsx`

Expected: PASS.

- [ ] **Step 5: Re-run the project workflow end-to-end flow**

Run: `pnpm playwright test tests/e2e/workflow.spec.ts`

Expected: PASS with assertions updated for the new project-detail hierarchy.

- [ ] **Step 6: Commit the project-detail redesign**

Run: `git add src/app/(workspace)/projects/[projectId]/page.tsx src/components/studio tests/unit/workspace/project-detail-page.test.tsx tests/e2e/workflow.spec.ts`

Run: `git commit -m "feat: redesign project workflow control page"`

Expected: one focused commit for the second-priority page.

### Task 4: Unify the script, storyboard, images, and videos pages

**Files:**
- Modify: `src/app/(workspace)/projects/[projectId]/script/page.tsx`
- Modify: `src/app/(workspace)/projects/[projectId]/storyboard/page.tsx`
- Modify: `src/app/(workspace)/projects/[projectId]/images/page.tsx`
- Modify: `src/app/(workspace)/projects/[projectId]/videos/page.tsx`
- Modify: `src/components/studio/page-hero.tsx`
- Modify: `src/components/studio/status-badge.tsx`
- Modify: `src/components/studio/workflow-rail.tsx`
- Test: `tests/unit/workspace/script-page.test.tsx`
- Test: `tests/unit/workspace/images-page.test.tsx`
- Create: `tests/unit/workspace/storyboard-page.test.tsx`
- Create: `tests/unit/workspace/videos-page.test.tsx`
- Test: `tests/e2e/full-smoke.spec.ts`

- [ ] **Step 1: Add/extend tests for shared workflow page chrome**

Make each page test assert:
- consistent project context header
- stage-specific title
- shared breadcrumb/back link
- preserved task/result behavior

Example:

```ts
expect(screen.getByText("项目制作流程")).toBeInTheDocument();
expect(screen.getByText("脚本")).toBeInTheDocument();
expect(screen.getByText("分镜")).toBeInTheDocument();
```

- [ ] **Step 2: Run the workflow page unit tests**

Run: `pnpm vitest run tests/unit/workspace/script-page.test.tsx tests/unit/workspace/images-page.test.tsx tests/unit/workspace/storyboard-page.test.tsx tests/unit/workspace/videos-page.test.tsx`

Expected: FAIL because the storyboard/videos page tests are new and the current pages do not share the new chrome yet.

- [ ] **Step 3: Implement the shared workflow page pattern**

Apply the same studio system to all four pages:
- common hero/header block
- consistent stage navigation and back link
- unified card, empty state, error state, and result stack styling
- no change to fetch logic, polling logic, or API contracts
- corrected Chinese copy where needed

- [ ] **Step 4: Re-run the workflow unit tests**

Run: `pnpm vitest run tests/unit/workspace/script-page.test.tsx tests/unit/workspace/images-page.test.tsx tests/unit/workspace/storyboard-page.test.tsx tests/unit/workspace/videos-page.test.tsx`

Expected: PASS.

- [ ] **Step 5: Re-run the full end-to-end smoke coverage**

Run: `pnpm playwright test tests/e2e/full-smoke.spec.ts`

Expected: PASS with selectors updated to the new layout while preserving the same user journeys.

- [ ] **Step 6: Commit the workflow-page unification**

Run: `git add src/app/(workspace)/projects/[projectId]/script/page.tsx src/app/(workspace)/projects/[projectId]/storyboard/page.tsx src/app/(workspace)/projects/[projectId]/images/page.tsx src/app/(workspace)/projects/[projectId]/videos/page.tsx src/components/studio tests/unit/workspace tests/e2e/full-smoke.spec.ts`

Run: `git commit -m "feat: unify workflow pages under studio design"`

Expected: one focused commit for the workflow pages.

### Task 5: Redesign the login and auth surfaces

**Files:**
- Modify: `src/app/(auth)/login/login-form.tsx`
- Modify: `src/app/(auth)/register-request/page.tsx`
- Modify: `src/app/(auth)/force-password/page.tsx`
- Modify: `src/app/layout.tsx`
- Test: `tests/unit/auth/login-page.test.ts`
- Test: `tests/unit/auth/force-password-page.test.ts`
- Create: `tests/unit/auth/register-request-page.test.tsx`
- Test: `tests/e2e/auth.spec.ts`

- [ ] **Step 1: Add auth page tests for the brand-consistent shell**

Assert:

```ts
expect(screen.getByText("Lan Studio")).toBeInTheDocument();
expect(screen.getByText("进入创作工作区")).toBeInTheDocument();
expect(screen.getByText("提交注册申请")).toBeInTheDocument();
```

and preserve the routing/auth behavior already covered by existing tests.

- [ ] **Step 2: Run the auth unit tests before implementation**

Run: `pnpm vitest run tests/unit/auth/login-page.test.ts tests/unit/auth/force-password-page.test.ts tests/unit/auth/register-request-page.test.tsx`

Expected: FAIL because the new branded shell and corrected copy are not present yet.

- [ ] **Step 3: Implement the auth redesign**

Deliver:
- a single auth surface that matches the creative brand without adding flow complexity
- corrected Chinese copy throughout login/register-request/force-password
- shared button/input/panel styling from the studio system
- unchanged submit handlers, redirects, and form semantics

- [ ] **Step 4: Re-run the auth unit tests**

Run: `pnpm vitest run tests/unit/auth/login-page.test.ts tests/unit/auth/force-password-page.test.ts tests/unit/auth/register-request-page.test.tsx`

Expected: PASS.

- [ ] **Step 5: Re-run the auth end-to-end flow**

Run: `pnpm playwright test tests/e2e/auth.spec.ts`

Expected: PASS with updated text/selectors.

- [ ] **Step 6: Commit the auth redesign**

Run: `git add src/app/(auth)/login/login-form.tsx src/app/(auth)/register-request/page.tsx src/app/(auth)/force-password/page.tsx src/app/layout.tsx tests/unit/auth/login-page.test.ts tests/unit/auth/force-password-page.test.ts tests/unit/auth/register-request-page.test.tsx tests/e2e/auth.spec.ts`

Run: `git commit -m "feat: redesign auth surfaces"`

Expected: one focused commit for login and auth pages.

### Task 6: Bring admin pages onto the shared studio system

**Files:**
- Modify: `src/app/admin/layout.tsx`
- Modify: `src/app/admin/users/page.tsx`
- Modify: `src/app/admin/providers/page.tsx`
- Modify: `src/app/admin/tasks/page.tsx`
- Modify: `src/app/admin/storage/page.tsx`
- Modify: `src/components/studio/app-shell.tsx`
- Modify: `src/components/studio/status-badge.tsx`
- Test: `tests/unit/admin/admin-layout.test.tsx`
- Test: `tests/unit/admin/providers-page.test.tsx`
- Test: `tests/unit/admin/tasks-page.test.tsx`
- Test: `tests/e2e/admin.spec.ts`

- [ ] **Step 1: Update admin tests for the unified but restrained control surface**

Add assertions for:
- the shared shell title and admin label
- the providers page header, summary cards, and form section still rendering with the shared admin surface
- consistent warning banner styling/content
- task action buttons and status rows still functioning under the new layout

- [ ] **Step 2: Run admin unit tests to verify failure**

Run: `pnpm vitest run tests/unit/admin/admin-layout.test.tsx tests/unit/admin/providers-page.test.tsx tests/unit/admin/tasks-page.test.tsx`

Expected: FAIL because the current admin UI still uses the old inline beige layout and copy.

- [ ] **Step 3: Implement the admin redesign**

Deliver:
- the same global token system and navigation language as the workspace
- more restrained cards/tables/panels than the creative pages
- unified status badges and action buttons
- corrected Chinese copy in admin navigation and warnings

Do not change:
- API requests
- retry/cancel semantics
- role guard logic

- [ ] **Step 4: Re-run admin unit tests**

Run: `pnpm vitest run tests/unit/admin/admin-layout.test.tsx tests/unit/admin/providers-page.test.tsx tests/unit/admin/tasks-page.test.tsx`

Expected: PASS.

- [ ] **Step 5: Re-run the admin end-to-end flow**

Run: `pnpm playwright test tests/e2e/admin.spec.ts`

Expected: PASS with selectors/assertions updated for the new admin styling, including at least one assertion that reaches `/admin/providers`.

- [ ] **Step 6: Commit the admin redesign**

Run: `git add src/app/admin/layout.tsx src/app/admin/users/page.tsx src/app/admin/providers/page.tsx src/app/admin/tasks/page.tsx src/app/admin/storage/page.tsx src/components/studio tests/unit/admin/admin-layout.test.tsx tests/unit/admin/providers-page.test.tsx tests/unit/admin/tasks-page.test.tsx tests/e2e/admin.spec.ts`

Run: `git commit -m "feat: redesign admin surfaces"`

Expected: one focused commit for the admin area.

### Task 7: Run the full redesign verification matrix

**Files:**
- Modify: `tests/e2e/full-smoke.spec.ts`
- Modify: `tests/e2e/workflow.spec.ts`
- Modify: `tests/e2e/auth.spec.ts`
- Modify: `tests/e2e/admin.spec.ts`

- [ ] **Step 1: Make the end-to-end suite selectors resilient to the redesigned UI**

Prefer role/text/test-friendly selectors over brittle layout selectors. Where the redesign introduces repeated labels, add stable accessible names or `data-testid` only if role/text matching is insufficient.

- [ ] **Step 2: Run the targeted Vitest suite for the redesigned surfaces**

Run: `pnpm vitest run tests/unit/workspace/workspace-shell.test.ts tests/unit/workspace/create-project-form.test.tsx tests/unit/workspace/project-detail-page.test.tsx tests/unit/workspace/script-page.test.tsx tests/unit/workspace/images-page.test.tsx tests/unit/workspace/storyboard-page.test.tsx tests/unit/workspace/videos-page.test.tsx tests/unit/auth/login-page.test.ts tests/unit/auth/force-password-page.test.ts tests/unit/auth/register-request-page.test.tsx tests/unit/admin/admin-layout.test.tsx tests/unit/admin/providers-page.test.tsx tests/unit/admin/tasks-page.test.tsx`

Expected: PASS.

- [ ] **Step 3: Run the route-level end-to-end suite**

Run: `pnpm playwright test tests/e2e/auth.spec.ts tests/e2e/admin.spec.ts tests/e2e/workflow.spec.ts tests/e2e/full-smoke.spec.ts`

Expected: PASS.

- [ ] **Step 4: Run repository-wide safety checks**

Run: `pnpm lint`

Run: `pnpm typecheck`

Run: `pnpm test`

Run: `pnpm build`

Expected: PASS.

- [ ] **Step 5: Run explicit responsive/accessibility spot checks**

Verify at minimum:
- `workspace` and project detail render without horizontal overflow at a narrow mobile width
- focus states remain visible in the dark theme
- status meaning is not conveyed by color alone in the redesigned cards/badges

Run: `pnpm playwright test tests/e2e/workflow.spec.ts --project=chromium`

Expected: PASS after adding or updating one small assertion/helper that checks the mobile-safe layout or accessible labels.

- [ ] **Step 6: Commit any final verification-related adjustments**

Run: `git add tests/e2e`

Run: `git commit -m "test: finalize ui redesign verification coverage"`

Expected: either a small final test-only commit or no-op if everything was already included cleanly in earlier commits.

## Plan Self-Check

- [ ] The plan keeps the existing route/file structure and does not invent new product pages outside the approved scope.
- [ ] The plan covers the approved priority order: workspace, project detail, auth/admin unification.
- [ ] The plan explicitly maps page names in the spec to real route files.
- [ ] The plan keeps business logic and API contracts stable while redesigning the presentation layer.
- [ ] The plan includes dedicated work for the known mojibake copy problems.
- [ ] Every implementation slice has a concrete verification command.
- [ ] Every major slice ends with a focused commit.
