# LAN Studio Asset Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a unified project asset center to LAN Studio so uploaded scripts, uploaded images, generated scripts, generated images, and generated videos all flow through one project-scoped asset model and can be bound into storyboard, image, and video workflows.

**Architecture:** Keep the current Next.js App Router, Prisma, BullMQ, and workspace page structure, but add an asset-center layer on top of the existing `Asset`, `Task`, and workflow services. Phase the implementation so persistence and migration land first, then asset-center APIs and UI, then storyboard assetization, then images/videos bindings and provenance, while preserving compatibility with existing `scriptVersionId` and existing generated assets during the rollout.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Prisma, PostgreSQL, BullMQ, Redis, Vitest, Testing Library, Playwright

---

## Planning Decisions Locked In

These decisions close the non-blocking review notes and should not be reopened during implementation unless the human explicitly changes scope:

1. **Extracted script text stays in `Asset.metadata` for phase 1.**
   Use `metadata.parseStatus`, `metadata.parseError`, and `metadata.extractedText` rather than introducing a dedicated `Asset.body` column in the first implementation. This keeps the migration additive and avoids widening the schema surface before usage patterns are proven.
2. **Deletion policy is conservative in phase 1.**
   If an asset is currently referenced by `ProjectWorkflowBinding` or by any `AssetSourceLink`, deletion returns `409` with a specific message. Users must unbind first. This avoids silent dangling references and keeps the first implementation simple.
3. **Compatibility is additive, not big-bang.**
   Existing `scriptVersionId` reads remain available until storyboard consumers are fully moved to `scriptAssetId`; existing generated image/video assets remain readable throughout migration.

## Route And File Mapping

Use these names consistently in implementation and review:

- `资产中心页` -> `src/app/(workspace)/projects/[projectId]/assets/page.tsx`
- `项目详情页资产概览` -> `src/app/(workspace)/projects/[projectId]/page.tsx`
- `资产列表/上传接口` -> `src/app/api/projects/[projectId]/assets/route.ts`
- `资产删除接口` -> `src/app/api/projects/[projectId]/assets/[assetId]/route.ts`
- `剧本重试解析接口` -> `src/app/api/projects/[projectId]/assets/[assetId]/retry/route.ts`
- `默认绑定接口` -> `src/app/api/projects/[projectId]/workflow-binding/route.ts`
- `脚本定稿接口` -> `src/app/api/script/sessions/[sessionId]/finalize/route.ts`
- `分镜接口` -> `src/app/api/storyboards/route.ts`
- `图片接口` -> `src/app/api/images/route.ts`
- `视频接口` -> `src/app/api/videos/route.ts`
- `项目详情数据服务` -> `src/lib/services/projects.ts`
- `资产中心主服务` -> `src/lib/services/assets.ts`
- `工作流默认绑定服务` -> `src/lib/services/asset-bindings.ts`
- `存量回填服务` -> `src/lib/services/asset-backfill.ts`
- `脚本会话服务` -> `src/lib/services/script-sessions.ts`
- `分镜服务` -> `src/lib/services/storyboards.ts`
- `图片服务` -> `src/lib/services/images.ts`
- `视频服务` -> `src/lib/services/videos.ts`
- `统一入队器` -> `src/lib/queues/enqueue.ts`
- `脚本定稿 worker` -> `src/worker/processors/script.ts`
- `剧本解析 worker` -> `src/worker/processors/asset-script-parse.ts`
- `分镜 worker` -> `src/worker/processors/storyboard.ts`
- `图片 worker` -> `src/worker/processors/image.ts`
- `视频 worker` -> `src/worker/processors/video.ts`

## Planned File Structure

### Persistence and migration

- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260407130000_add_asset_center_foundation/migration.sql`
- Modify: `prisma/seed.ts`
- Create: `scripts/backfill-asset-center.ts`
- Modify: `tests/integration/db/migration-regressions.test.ts`

### New shared services

- Create: `src/lib/services/assets.ts`
- Create: `src/lib/services/asset-bindings.ts`
- Create: `src/lib/services/asset-backfill.ts`
- Modify: `src/lib/services/script-sessions.ts`

### API routes

- Create: `src/app/api/projects/[projectId]/assets/route.ts`
- Create: `src/app/api/projects/[projectId]/assets/[assetId]/route.ts`
- Create: `src/app/api/projects/[projectId]/assets/[assetId]/retry/route.ts`
- Create: `src/app/api/projects/[projectId]/workflow-binding/route.ts`
- Modify: `src/app/api/script/sessions/[sessionId]/finalize/route.ts`
- Modify: `src/app/api/storyboards/route.ts`
- Modify: `src/app/api/images/route.ts`
- Modify: `src/app/api/videos/route.ts`

### Workers and queue registration

- Modify: `src/lib/queues/index.ts`
- Modify: `src/lib/queues/enqueue.ts`
- Modify: `src/worker/index.ts`
- Modify: `src/worker/processors/script.ts`
- Create: `src/worker/processors/asset-script-parse.ts`
- Modify: `src/worker/processors/storyboard.ts`
- Modify: `src/worker/processors/image.ts`
- Modify: `src/worker/processors/video.ts`

### Workspace UI

- Create: `src/app/(workspace)/projects/[projectId]/assets/page.tsx`
- Create: `src/components/project-assets/asset-center-client.tsx`
- Create: `src/components/project-assets/asset-card.tsx`
- Create: `src/components/project-assets/asset-upload-panel.tsx`
- Create: `src/components/project-assets/asset-binding-picker.tsx`
- Modify: `src/app/(workspace)/projects/[projectId]/page.tsx`
- Modify: `src/app/(workspace)/projects/[projectId]/storyboard/page.tsx`
- Modify: `src/app/(workspace)/projects/[projectId]/images/page.tsx`
- Modify: `src/app/(workspace)/projects/[projectId]/videos/page.tsx`

### Tests

- Create: `tests/integration/services/asset-backfill.test.ts`
- Create: `tests/integration/api/project-assets.test.ts`
- Create: `tests/integration/api/videos.test.ts`
- Modify: `tests/integration/api/script-session.test.ts`
- Modify: `tests/integration/db/migration-regressions.test.ts`
- Create: `tests/integration/workers/asset-script-parse-worker.test.ts`
- Modify: `tests/integration/api/project-detail.test.ts`
- Modify: `tests/integration/api/images.test.ts`
- Modify: `tests/integration/api/storyboards.test.ts`
- Modify: `tests/integration/workers/image-worker.test.ts`
- Modify: `tests/integration/workers/video-worker.test.ts`
- Modify: `tests/integration/workers/storyboard-worker.test.ts`
- Modify: `tests/integration/workers/queue-bootstrap.test.ts`
- Modify: `tests/unit/workers/script-processor.test.ts`
- Create: `tests/unit/workspace/assets-page.test.tsx`
- Modify: `tests/unit/workspace/project-detail-page.test.tsx`
- Modify: `tests/unit/workspace/storyboard-page.test.tsx`
- Modify: `tests/unit/workspace/images-page.test.tsx`
- Modify: `tests/unit/workspace/videos-page.test.tsx`
- Modify: `tests/e2e/workflow.spec.ts`
- Modify: `tests/e2e/full-smoke.spec.ts`

## Implementation Tasks

### Task 1: Add asset-center persistence, backfill, and rollout scaffolding

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260407130000_add_asset_center_foundation/migration.sql`
- Modify: `prisma/seed.ts`
- Modify: `src/lib/queues/index.ts`
- Modify: `src/lib/queues/enqueue.ts`
- Create: `src/lib/services/asset-backfill.ts`
- Create: `scripts/backfill-asset-center.ts`
- Create: `tests/integration/services/asset-backfill.test.ts`
- Modify: `tests/integration/db/migration-regressions.test.ts`
- Modify: `tests/integration/workers/queue-bootstrap.test.ts`

- [ ] **Step 1: Write failing backfill tests for the new persistence layer**

Cover these cases in `tests/integration/services/asset-backfill.test.ts`:

```ts
expect(result.scriptAsset.category).toBe("script_generated");
expect(result.binding.storyboardScriptAssetId).toBe(result.scriptAsset.id);
expect(result.secondRun.createdAssets).toHaveLength(0);
```

Also assert:
- existing image/video assets get normalized category/origin metadata
- backfill is idempotent
- missing final scripts leave storyboard binding empty
- the migration can be applied from the repo's historical pre-asset-center schema baseline
- queue bootstrap recognizes the new parse task type and queue mapping immediately after the schema change

- [ ] **Step 2: Run the backfill test to verify it fails**

Run: `pnpm vitest run tests/integration/services/asset-backfill.test.ts tests/integration/db/migration-regressions.test.ts tests/integration/workers/queue-bootstrap.test.ts`

Expected: FAIL because `ProjectWorkflowBinding`, `AssetSourceLink`, the new migration, and the backfill service do not exist yet.

- [ ] **Step 3: Extend Prisma schema and add the rollout helper**

Add to `prisma/schema.prisma`:

```prisma
enum AssetCategory {
  SCRIPT_SOURCE
  SCRIPT_GENERATED
  IMAGE_SOURCE
  IMAGE_GENERATED
  VIDEO_GENERATED
}

enum AssetOrigin {
  UPLOAD
  SYSTEM
}
```

and new models:
- `ProjectWorkflowBinding`
- `AssetSourceLink`

Also:
- keep existing `Asset.kind` for compatibility
- add nullable `category` and `origin` to `Asset`
- add a new `TaskType` for script parsing, e.g. `ASSET_SCRIPT_PARSE`
- update `src/lib/queues/index.ts` and `src/lib/queues/enqueue.ts` in the same slice so the repo stays type-valid immediately after `pnpm prisma generate`
- implement `src/lib/services/asset-backfill.ts` as an idempotent helper
- implement `scripts/backfill-asset-center.ts` as a thin CLI wrapper around the service
- extend `tests/integration/db/migration-regressions.test.ts` with a historical-schema fixture that applies the new migration and verifies the new columns/tables come up without losing legacy asset/task/script data
- update `prisma/seed.ts` only if the new task type / queue bootstrap requires fixture normalization

- [ ] **Step 4: Generate Prisma artifacts and re-run the targeted test**

Run: `pnpm prisma generate`

Run: `pnpm vitest run tests/integration/services/asset-backfill.test.ts tests/integration/db/migration-regressions.test.ts tests/integration/workers/queue-bootstrap.test.ts`

Run: `pnpm typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the persistence foundation**

Run: `git add prisma/schema.prisma prisma/migrations prisma/seed.ts src/lib/queues/index.ts src/lib/queues/enqueue.ts src/lib/services/asset-backfill.ts scripts/backfill-asset-center.ts tests/integration/services/asset-backfill.test.ts tests/integration/db/migration-regressions.test.ts tests/integration/workers/queue-bootstrap.test.ts`

Run: `git commit -m "feat: add asset center persistence foundation"`

Expected: one focused commit covering only schema, backfill, and rollout scaffolding.

### Task 2: Build asset-center services and project-scoped API routes

**Files:**
- Create: `src/lib/services/assets.ts`
- Create: `src/lib/services/asset-bindings.ts`
- Create: `src/app/api/projects/[projectId]/assets/route.ts`
- Create: `src/app/api/projects/[projectId]/assets/[assetId]/route.ts`
- Create: `src/app/api/projects/[projectId]/assets/[assetId]/retry/route.ts`
- Create: `src/app/api/projects/[projectId]/workflow-binding/route.ts`
- Create: `tests/integration/api/project-assets.test.ts`

- [ ] **Step 1: Write failing API tests for listing, upload, binding, retry, and delete policy**

Cover these scenarios in `tests/integration/api/project-assets.test.ts`:

```ts
expect(listResponse.status).toBe(200);
expect(uploadResponse.status).toBe(202);
expect(bindingPatch.status).toBe(200);
expect(retryResponse.status).toBe(202);
expect(deleteResponse.status).toBe(409);
```

Test matrix:
- list returns grouped/ordered project assets and current workflow bindings
- `.txt` / `.md` upload creates `script_source` asset with `pending`
- image upload creates `image_source` asset immediately usable
- binding PATCH enforces project ownership, image-only reference rules, and ordered de-duplication
- retry only works for failed `script_source` assets
- delete returns `409` when asset is bound or referenced by `AssetSourceLink`

- [ ] **Step 2: Run the API test to verify failure**

Run: `pnpm vitest run tests/integration/api/project-assets.test.ts`

Expected: FAIL because none of the new routes or services exist.

- [ ] **Step 3: Implement the asset-center services and routes**

Implement `src/lib/services/assets.ts` and `src/lib/services/asset-bindings.ts` with:
- asset listing and filtering
- script upload / image upload write paths
- binding reads and updates
- conservative delete guard
- parse retry enqueue entry point

Implement route behavior:
- `GET /api/projects/[projectId]/assets`
- `POST /api/projects/[projectId]/assets`
- `DELETE /api/projects/[projectId]/assets/[assetId]`
- `POST /api/projects/[projectId]/assets/[assetId]/retry`
- `GET/PATCH /api/projects/[projectId]/workflow-binding`

Use this response shape for asset summaries:

```ts
{
  id,
  category,
  origin,
  mimeType,
  parseStatus,
  createdAt,
  downloadUrl
}
```

- [ ] **Step 4: Re-run the API test**

Run: `pnpm vitest run tests/integration/api/project-assets.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the asset-center API slice**

Run: `git add src/lib/services/assets.ts src/lib/services/asset-bindings.ts src/app/api/projects/[projectId]/assets src/app/api/projects/[projectId]/workflow-binding tests/integration/api/project-assets.test.ts`

Run: `git commit -m "feat: add project asset center APIs"`

Expected: one focused commit for the new service and route layer.

### Task 3: Add the asynchronous script-parse worker

**Files:**
- Modify: `src/worker/index.ts`
- Create: `src/worker/processors/asset-script-parse.ts`
- Create: `tests/integration/workers/asset-script-parse-worker.test.ts`

- [ ] **Step 1: Write failing worker tests for script parsing and retry lifecycle**

Cover:

```ts
expect(asset.metadata?.parseStatus).toBe("ready");
expect(asset.metadata?.extractedText).toContain("INT. ROOFTOP");
expect(failedAsset.metadata?.parseStatus).toBe("failed");
```

Also assert:
- `.txt` and `.md` parse to `metadata.extractedText`
- unsupported extension or malformed file marks asset `failed`
- retry reuses the same `assetId`

- [ ] **Step 2: Run the worker tests to verify failure**

Run: `pnpm vitest run tests/integration/workers/asset-script-parse-worker.test.ts`

Expected: FAIL because the queue and processor do not exist yet.

- [ ] **Step 3: Implement the parser worker**

In `src/worker/processors/asset-script-parse.ts`:
- read the uploaded file from storage
- normalize UTF-8 text
- parse `.txt` and `.md` into `metadata.extractedText`
- set `metadata.parseStatus` to `ready` or `failed`
- write error text for failures
- do not create a new asset on retry

Also register the new processor in `src/worker/index.ts`.

- [ ] **Step 4: Re-run the worker tests**

Run: `pnpm vitest run tests/integration/workers/asset-script-parse-worker.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the script parsing slice**

Run: `git add src/worker/index.ts src/worker/processors/asset-script-parse.ts tests/integration/workers/asset-script-parse-worker.test.ts`

Run: `git commit -m "feat: add script asset parsing worker"`

Expected: one focused commit for async parse behavior and queue wiring.

### Task 4: Mirror newly generated final scripts into asset center

**Files:**
- Modify: `src/lib/services/script-sessions.ts`
- Modify: `src/app/api/script/sessions/[sessionId]/finalize/route.ts`
- Modify: `src/worker/processors/script.ts`
- Modify: `src/lib/services/asset-backfill.ts`
- Modify: `tests/integration/api/script-session.test.ts`
- Modify: `tests/unit/workers/script-processor.test.ts`

- [ ] **Step 1: Write failing tests for script-finalize result asset creation**

Cover:

```ts
expect(task.outputJson).toEqual(expect.objectContaining({ scriptVersionId: expect.any(String) }));
expect(scriptAsset.category).toBe("script_generated");
expect(scriptAsset.metadata?.extractedText).toContain("INT. ROOFTOP");
```

Also assert:
- successful script finalization creates or updates exactly one `script_generated` asset for the final script
- repeated finalization does not create duplicate generated-script assets
- the finalize API response contract remains stable for the current script page

- [ ] **Step 2: Run the script-finalize tests to verify failure**

Run: `pnpm vitest run tests/integration/api/script-session.test.ts tests/unit/workers/script-processor.test.ts`

Expected: FAIL because script finalization currently only creates `ScriptVersion` rows and does not mirror them into assets.

- [ ] **Step 3: Implement generated-script asset mirroring**

Update `src/worker/processors/script.ts` and, only if needed for orchestration, `src/lib/services/script-sessions.ts` so that:
- successful finalization creates or upserts a `script_generated` asset
- the asset stores `metadata.extractedText`, `scriptVersionId`, and source task metadata
- repeated runs reuse the same script-result asset relationship rather than creating duplicates
- `src/lib/services/asset-backfill.ts` treats live-generated script assets and historical backfilled script assets consistently

Do not change:
- finalize route URL
- task status semantics
- existing script-session state transitions

- [ ] **Step 4: Re-run the script-finalize tests**

Run: `pnpm vitest run tests/integration/api/script-session.test.ts tests/unit/workers/script-processor.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the generated-script asset slice**

Run: `git add src/lib/services/script-sessions.ts src/app/api/script/sessions/[sessionId]/finalize/route.ts src/worker/processors/script.ts src/lib/services/asset-backfill.ts tests/integration/api/script-session.test.ts tests/unit/workers/script-processor.test.ts`

Run: `git commit -m "feat: mirror finalized scripts into asset center"`

Expected: one focused commit for live generated-script ingestion.

### Task 5: Add the project asset center page and project-detail asset overview

**Files:**
- Create: `src/app/(workspace)/projects/[projectId]/assets/page.tsx`
- Create: `src/components/project-assets/asset-center-client.tsx`
- Create: `src/components/project-assets/asset-card.tsx`
- Create: `src/components/project-assets/asset-upload-panel.tsx`
- Create: `src/components/project-assets/asset-binding-picker.tsx`
- Modify: `src/app/(workspace)/projects/[projectId]/page.tsx`
- Modify: `src/lib/services/projects.ts`
- Modify: `src/app/api/projects/[projectId]/detail/route.ts`
- Create: `tests/unit/workspace/assets-page.test.tsx`
- Modify: `tests/unit/workspace/project-detail-page.test.tsx`
- Modify: `tests/integration/api/project-detail.test.ts`

- [ ] **Step 1: Write failing page and detail tests**

Add assertions for:

```ts
expect(screen.getByText("资产中心")).toBeInTheDocument();
expect(screen.getByRole("button", { name: "上传剧本或图片" })).toBeInTheDocument();
expect(screen.getByRole("link", { name: "进入资产中心" })).toHaveAttribute("href", "/projects/project-1/assets");
expect(screen.getByText("当前默认分镜剧本")).toBeInTheDocument();
```

Also extend the project-detail API test to expect asset counts and binding summary fields.

- [ ] **Step 2: Run the targeted UI/API tests before implementation**

Run: `pnpm vitest run tests/unit/workspace/assets-page.test.tsx tests/unit/workspace/project-detail-page.test.tsx tests/integration/api/project-detail.test.ts`

Expected: FAIL because the asset center route and detail summary do not exist yet.

- [ ] **Step 3: Implement the new page and detail summary**

Deliver:
- `src/app/(workspace)/projects/[projectId]/assets/page.tsx` fetching the new project asset API
- asset cards grouped by category with upload, preview, download, bind, retry, and delete actions
- project detail asset overview block with counts and current default bindings
- asset-center empty states for no assets and for no default binding

Do not:
- duplicate download logic already provided by `/api/assets/[assetId]/download`
- reimplement project ownership checks in the page

- [ ] **Step 4: Re-run the targeted tests**

Run: `pnpm vitest run tests/unit/workspace/assets-page.test.tsx tests/unit/workspace/project-detail-page.test.tsx tests/integration/api/project-detail.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the asset-center UI slice**

Run: `git add src/app/(workspace)/projects/[projectId]/assets/page.tsx src/components/project-assets src/app/(workspace)/projects/[projectId]/page.tsx src/lib/services/projects.ts src/app/api/projects/[projectId]/detail/route.ts tests/unit/workspace/assets-page.test.tsx tests/unit/workspace/project-detail-page.test.tsx tests/integration/api/project-detail.test.ts`

Run: `git commit -m "feat: add project asset center workspace"`

Expected: one focused commit for page-level asset-center UI and detail integration.

### Task 6: Convert storyboard generation from `scriptVersionId` to asset-backed input

**Files:**
- Modify: `src/lib/services/storyboards.ts`
- Modify: `src/app/api/storyboards/route.ts`
- Modify: `src/worker/processors/storyboard.ts`
- Modify: `src/app/(workspace)/projects/[projectId]/storyboard/page.tsx`
- Modify: `tests/integration/api/storyboards.test.ts`
- Modify: `tests/integration/workers/storyboard-worker.test.ts`
- Modify: `tests/unit/workspace/storyboard-page.test.tsx`

- [ ] **Step 1: Write failing tests for `scriptAssetId` and compatibility behavior**

Cover:

```ts
expect(task.inputJson).toEqual(expect.objectContaining({ scriptAssetId: asset.id }));
expect(response.status).toBe(202);
expect(screen.getByText("当前未设置默认剧本资产")).toBeInTheDocument();
```

Test matrix:
- storyboard GET returns current default script asset and selectable script assets
- storyboard POST accepts `scriptAssetId`
- `pending` / `failed` script assets return `409`
- compatibility layer still resolves legacy `scriptVersionId` while migration is in progress
- page exposes “仅本次使用” and “设为该流程默认输入”

- [ ] **Step 2: Run the storyboard tests to verify failure**

Run: `pnpm vitest run tests/integration/api/storyboards.test.ts tests/integration/workers/storyboard-worker.test.ts tests/unit/workspace/storyboard-page.test.tsx`

Expected: FAIL because the current storyboard flow only knows `scriptVersionId`.

- [ ] **Step 3: Implement storyboard assetization**

Implement:
- a resolver in `src/lib/services/storyboards.ts` that accepts `scriptAssetId` and reads either uploaded script text from `metadata.extractedText` or generated script text from backfilled asset metadata
- API compatibility so route input can temporarily accept either `scriptAssetId` or `scriptVersionId`, but new UI posts `scriptAssetId`
- default binding reads from `ProjectWorkflowBinding.storyboardScriptAssetId`
- page UI for empty binding, temporary override, and promote-to-default action

- [ ] **Step 4: Re-run the storyboard tests**

Run: `pnpm vitest run tests/integration/api/storyboards.test.ts tests/integration/workers/storyboard-worker.test.ts tests/unit/workspace/storyboard-page.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit the storyboard slice**

Run: `git add src/lib/services/storyboards.ts src/app/api/storyboards/route.ts src/worker/processors/storyboard.ts src/app/(workspace)/projects/[projectId]/storyboard/page.tsx tests/integration/api/storyboards.test.ts tests/integration/workers/storyboard-worker.test.ts tests/unit/workspace/storyboard-page.test.tsx`

Run: `git commit -m "feat: connect storyboard workflow to script assets"`

Expected: one focused commit for the storyboard migration path.

### Task 7: Move image and video workflows onto default bindings, multi-select, and provenance

**Files:**
- Modify: `src/lib/services/images.ts`
- Modify: `src/lib/services/videos.ts`
- Modify: `src/app/api/images/route.ts`
- Modify: `src/app/api/videos/route.ts`
- Modify: `src/worker/processors/image.ts`
- Modify: `src/worker/processors/video.ts`
- Modify: `src/app/(workspace)/projects/[projectId]/images/page.tsx`
- Modify: `src/app/(workspace)/projects/[projectId]/videos/page.tsx`
- Modify: `tests/integration/api/images.test.ts`
- Create: `tests/integration/api/videos.test.ts`
- Modify: `tests/integration/workers/image-worker.test.ts`
- Modify: `tests/integration/workers/video-worker.test.ts`
- Modify: `tests/unit/workspace/images-page.test.tsx`
- Modify: `tests/unit/workspace/videos-page.test.tsx`

- [ ] **Step 1: Write failing tests for default bindings, one-off overrides, and source links**

Cover:

```ts
expect(form.getAll("referenceAssetIds")).toEqual(["asset-a", "asset-b"]);
expect(sourceLinks).toHaveLength(2);
expect(deleteResponse.status).toBe(409);
```

Test matrix:
- image/video workspace payloads include current default bindings and candidate assets
- image/video POST requests can accept one-off ordered `referenceAssetIds`
- image workflow still supports text-to-image when no source asset is provided
- video API route keeps preview streaming/range support while adding binding-aware workspace payloads and generation validation
- generated image/video assets write `AssetSourceLink` rows preserving order
- pages surface default selections, “仅本次使用”, and “设为默认输入”

- [ ] **Step 2: Run the image/video test set before implementation**

Run: `pnpm vitest run tests/integration/api/images.test.ts tests/integration/api/videos.test.ts tests/integration/workers/image-worker.test.ts tests/integration/workers/video-worker.test.ts tests/unit/workspace/images-page.test.tsx tests/unit/workspace/videos-page.test.tsx`

Expected: FAIL because the current implementation does not expose binding state or provenance rows.

- [ ] **Step 3: Implement images/videos binding and provenance support**

Make these changes:
- `src/lib/services/images.ts`: expose bound reference assets and accept ordered one-off overrides
- `src/lib/services/videos.ts`: keep the same ordered/de-duplicated reference behavior
- `src/app/api/images/route.ts`: stop creating ad-hoc temporary reference assets from page-local upload; route uploads through the asset center and accept asset IDs for generation
- `src/app/api/videos/route.ts`: return binding-aware workspace payloads and validate ordered one-off overrides without regressing existing preview streaming behavior
- `src/worker/processors/image.ts` and `src/worker/processors/video.ts`: create `AssetSourceLink` rows whenever assets were used as inputs
- pages: load default references, support quick reselection, and preserve current generate/poll flows

- [ ] **Step 4: Re-run the image/video test set**

Run: `pnpm vitest run tests/integration/api/images.test.ts tests/integration/api/videos.test.ts tests/integration/workers/image-worker.test.ts tests/integration/workers/video-worker.test.ts tests/unit/workspace/images-page.test.tsx tests/unit/workspace/videos-page.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit the image/video slice**

Run: `git add src/lib/services/images.ts src/lib/services/videos.ts src/app/api/images/route.ts src/app/api/videos/route.ts src/worker/processors/image.ts src/worker/processors/video.ts src/app/(workspace)/projects/[projectId]/images/page.tsx src/app/(workspace)/projects/[projectId]/videos/page.tsx tests/integration/api/images.test.ts tests/integration/api/videos.test.ts tests/integration/workers/image-worker.test.ts tests/integration/workers/video-worker.test.ts tests/unit/workspace/images-page.test.tsx tests/unit/workspace/videos-page.test.tsx`

Run: `git commit -m "feat: connect image and video workflows to asset bindings"`

Expected: one focused commit for the remaining workflow consumers.

### Task 8: Run migration, end-to-end verification, and rollout checks

**Files:**
- Modify: `tests/e2e/workflow.spec.ts`
- Modify: `tests/e2e/full-smoke.spec.ts`

- [ ] **Step 1: Update the end-to-end journeys to exercise the asset center**

Ensure the browser flows cover:
- uploading a script asset
- waiting for parse-ready state
- opening storyboard from default-bound script asset
- uploading/selecting image reference assets
- generating image and video results that later appear in asset center and project detail

- [ ] **Step 2: Run the targeted integration suite**

Run: `pnpm vitest run tests/integration/db/migration-regressions.test.ts tests/integration/services/asset-backfill.test.ts tests/integration/api/project-assets.test.ts tests/integration/api/project-detail.test.ts tests/integration/api/script-session.test.ts tests/integration/api/storyboards.test.ts tests/integration/api/images.test.ts tests/integration/api/videos.test.ts tests/integration/workers/asset-script-parse-worker.test.ts tests/integration/workers/storyboard-worker.test.ts tests/integration/workers/image-worker.test.ts tests/integration/workers/video-worker.test.ts tests/unit/workers/script-processor.test.ts tests/unit/workspace/assets-page.test.tsx tests/unit/workspace/project-detail-page.test.tsx tests/unit/workspace/storyboard-page.test.tsx tests/unit/workspace/images-page.test.tsx tests/unit/workspace/videos-page.test.tsx`

Expected: PASS.

- [ ] **Step 3: Run the end-to-end flows**

Run: `pnpm playwright test tests/e2e/workflow.spec.ts tests/e2e/full-smoke.spec.ts`

Expected: PASS.

- [ ] **Step 4: Run repository-wide safety checks**

Run: `pnpm lint`

Run: `pnpm typecheck`

Run: `pnpm test`

Run: `pnpm build`

Expected: PASS.

- [ ] **Step 5: Run the backfill script once against the local environment and verify it is idempotent**

Run: `pnpm tsx scripts/backfill-asset-center.ts`

Run: `pnpm tsx scripts/backfill-asset-center.ts`

Expected: both runs succeed; the second run reports zero newly created backfill assets/bindings.

- [ ] **Step 6: Commit any final test or migration-script adjustments**

Run: `git add tests/e2e scripts/backfill-asset-center.ts`

Run: `git commit -m "test: finalize asset center rollout coverage"`

Expected: either one small final commit or no-op if earlier slices already captured all changes cleanly.

## Plan Self-Check

- [ ] The plan stays inside the approved scope: unified project asset center plus storyboard/images/videos consumers.
- [ ] The plan explicitly resolves the two review follow-ups: delete policy and extracted script text storage.
- [ ] The plan keeps migration additive and preserves legacy `scriptVersionId` compatibility during rollout.
- [ ] The plan includes an explicit path for backfilling existing projects and verifying idempotence.
- [ ] Each task names exact files and exact verification commands.
- [ ] The plan keeps commits focused by slice rather than batching unrelated schema, UI, and worker work together.
