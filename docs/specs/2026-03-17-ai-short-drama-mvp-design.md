# AI Short Drama Studio MVP (Commercial) Design

Date: 2026-03-17  
Status: Draft for implementation planning  
Owner: Product + Engineering

## 1. Context and Goals

Build a commercial AI short-drama creation website for Chinese-speaking creators. The MVP must prioritize delivery speed and market validation while still supporting production-grade billing, queueing, and operational visibility.

### Product goals

1. Let creators submit an outline/dialogue script and receive downloadable 15-second shot video assets.
2. Support subscription billing plus pay-as-you-go overage.
3. Handle 200+ concurrent generation jobs with clear progress and recoverable failures.
4. Keep the default model chain configurable from admin controls without redeploying code.

### Priority order

1. Delivery speed (highest)
2. Generation quality
3. Cost control
4. Compliance/risk controls

## 2. Scope

### In scope (MVP)

1. Single-region web app in Chinese.
2. Target user: non-technical individual creators.
3. Input mode: user provides outline/dialogue script, then the platform optimizes.
4. End output: downloadable shot asset package (no full auto-editing).
5. Generation chain:
   - Script optimization (`Claude Code Opus 4.6` by default)
   - 15-second storyboard split and prompt generation (`Dola-Seed-2.0-Preview` by default)
   - Character/prop/reference/first-last-frame image generation (`nano banana pro` by default)
   - Shot-level 15-second video generation from assets + prompts
6. Billing:
   - Monthly subscription with included credits
   - Overage by the same credit formula used for settlement (`base + completed_shots * per_shot`)
7. Queue and orchestration:
   - Tiered priority queues
   - Retries, timeout handling, and compensation
8. Operator/admin functions:
   - Model profile switching
   - Queue health and cost dashboards

### Out of scope (MVP)

1. Automatic final edit into one complete short (captions/music/transitions).
2. Team collaboration roles, organization management, and approval workflows.
3. Multi-language localization.
4. Marketplace templates and advanced creative collaboration features.

## 3. Approaches Considered

## Approach A: Fast monolith

- One deployable app with internal modules and worker processes.
- Fastest delivery, weakest long-term scaling boundary.

## Approach B: Full microservices

- Separate services for script, storyboard, image, video, billing, and orchestration.
- Strong scaling/isolation, high initial complexity and slower delivery.

## Approach C (Recommended): Modular monolith + queue workers

- One codebase and one deployment boundary for API/orchestration, plus horizontally scalable worker pools.
- Internal module boundaries are explicit, so services can be split later with less rework.
- Best fit for 4-6 week MVP with 200+ concurrent target.

## 4. High-Level Architecture

## 4.1 Components

1. Web Frontend
   - Chinese creator dashboard
   - Job creation, progress tracking, asset download
2. API/BFF
   - Auth, billing guards, job APIs, project APIs
3. Workflow Orchestrator
   - Job state machine, step scheduling, retries, compensation
4. Model Adapter Layer
   - Normalizes each provider into unified interfaces
5. Workers
   - `ScriptWorker`, `StoryboardWorker`, `ImageWorker`, `VideoWorker`, `PackWorker`
6. Infrastructure
   - Postgres (metadata + billing ledger)
   - Redis + queue system (priority + rate control)
   - Object storage (image/video/package files)
   - CDN for delivery

## 4.2 Data flow

1. User submits outline/dialogue script and job options.
2. API validates plan/credits and freezes estimated credits.
3. Orchestrator advances:
   - `draft -> queued -> scripted -> storyboarded -> imaged -> videoed -> packaged -> done`
4. Each stage stores artifacts in object storage and metadata in Postgres.
5. If a stage fails, orchestrator retries with policy; on hard failure it marks job failed, performs billing compensation, and returns actionable failure reason.
6. On success, `PackWorker` creates downloadable package and final billing settlement.

## 4.3 Module contracts (implementation boundary)

All modules communicate through versioned JSON contracts (`contract_version`).

1. Orchestrator -> Worker contract
   - Input: `job_id`, `step_id`, `step_type`, `attempt`, `model_profile_id`, `input_asset_refs[]`, `input_payload`, `trace_id`
   - Output: `status` (`ok`/`retryable_error`/`fatal_error`), `output_asset_refs[]`, `output_payload`, `metrics` (`latency_ms`, `provider_cost`), `error_code`, `error_message`
2. Worker -> Model Adapter contract
   - Input: `provider`, `model`, `task_type` (`script|storyboard|image|video`), `prompt`, `media_inputs[]`, `generation_options`
   - Output: `provider_request_id`, `result_payload`, `result_assets[]`, `token_or_unit_usage`, `error_class`
3. API/BFF -> Orchestrator contract
   - Create input: `user_id`, `project_id`, `input_script`, `shot_target`, `resolution_tier`, `style_options`
   - Create output: `job_id`, `estimated_credits`, `frozen_credits`, `initial_state=queued`
4. PackWorker output contract
   - `package_manifest.json` with `job_id`, `shots[]`, `asset_urls[]`, checksums, generation metadata, and billing summary

## 5. Domain Model (MVP)

Core entities:

1. `users`
2. `plans`
3. `subscriptions`
4. `credit_ledgers` (freeze/consume/refund records)
5. `projects`
6. `jobs`
7. `job_steps`
8. `shots`
9. `assets`
10. `model_profiles` (default + fallback mappings)
11. `model_calls` (trace, latency, cost, error)
12. `audit_events`

## 6. Workflow and State Management

## 6.1 Job state machine

1. `draft`
2. `queued`
3. `scripted`
4. `storyboarded`
5. `imaged`
6. `videoed`
7. `packaged`
8. `done`
9. `failed`
10. `canceled`

Each transition requires:

1. Idempotency key
2. Retry counter
3. Input/output checksum references

Canonical transition table:

| From | To | Trigger | Notes |
|---|---|---|---|
| `draft` | `queued` | credits freeze success | On freeze failure, stay `draft` with error |
| `queued` | `scripted` | script step success | Step output persisted first |
| `scripted` | `storyboarded` | storyboard step success | Shot list locked after this |
| `storyboarded` | `imaged` | all required shot images ready | Partial image success remains in `storyboarded` |
| `imaged` | `videoed` | all required shot videos ready | Shot-level retries allowed |
| `videoed` | `packaged` | package creation success | Manifest required |
| `packaged` | `done` | settlement success | Download links issued |
| any active state | `failed` | retry budget exhausted or fatal error | Compensation flow executes before finalization |
| `queued` | `canceled` | user cancel request | No generation charges |
| `scripted`/`storyboarded`/`imaged`/`videoed` | `canceled` | user cancel request accepted | Charges settle on completed billable units only |

Retry and compensation rules:

1. Script/storyboard steps: max 2 retries each (`30s`, `120s` backoff).
2. Image/video/pack steps: max 1 retry each (`60s` backoff).
3. On retry exhaustion: step enters dead-letter queue and job transitions to `failed`.
4. Compensation transaction is idempotent and uses `job_id + settlement_version`.
5. Retry semantics:
   - Transport retry: same prompt/input for transient upstream failures.
   - Regeneration retry: new prompt variant after QA failure; only allowed for image/video steps and consumes that step's single retry budget.

## 6.2 Shot-level processing

1. Storyboard stage emits shot list at 15-second granularity.
2. Image and video stages parallelize by shot.
3. Failed shots can be retried independently without rerunning completed shots.

## 7. Billing and Monetization Design

## 7.1 Pricing mechanism

1. Subscription grants monthly credits.
2. Each job estimates required credits before execution.
3. Two-phase settlement:
   - Freeze estimated credits at submit time.
   - Settle actual usage at completion; return difference or charge overage.
4. Billing unit and formula (integer credits):
   - Base credits (once per job): `script_base + storyboard_base`
   - Per-shot credits: `image_per_shot + video_per_shot(resolution_tier)`
   - Estimated credits: `base + (planned_shots * per_shot)`
   - Actual credits: `base_if_storyboard_completed + (completed_video_shots * per_shot)`
5. MVP default credit constants:
   - `script_base = 20`
   - `storyboard_base = 10`
   - `image_per_shot = 6`
   - `video_per_shot(sd)=12`, `video_per_shot(hd)=20`
6. Rounding rule: always integer credits, no decimals.

## 7.2 Failure billing policy

1. Platform/system failure: auto-refund unused or full affected portion.
2. Policy/content rejection due to user input: no automatic refund (configurable for support override).
3. Partial completion settlement:
   - If failure occurs before `storyboarded`: refund 100% frozen credits.
   - If failure occurs after `storyboarded` and before any successful video shot: charge base only.
   - If some shots are successfully video-generated: charge `base + completed_video_shots * per_shot`, refund the rest.
4. Billing examples:
   - Planned 12 shots, HD, frozen = `30 + 12*26 = 342`; completed 9 shots => actual `30 + 9*26 = 264`; refund `78`.
   - Planned 8 shots, SD, fails before storyboard => actual `0`; refund full frozen amount.

## 7.3 Billing safety controls

1. Per-user hourly job cap.
2. Max shot count and resolution cap per job tier.
3. Cost anomaly alerts for abnormal single-job burn.

## 8. Concurrency, Queueing, and Reliability

## 8.1 Queue strategy

1. Priority lanes by subscription tier.
2. Provider-specific rate limiters.
3. Worker autoscaling based on queue depth + processing latency.
4. Deterministic dequeue order:
   - Sort key: `(tier_priority DESC, created_at ASC, job_id ASC)`
   - Tier priority: `enterprise=3`, `pro=2`, `starter=1`
5. Queue limits:
   - Per user: max 3 running jobs, max 10 queued jobs
   - Global queue hard cap: 20,000 pending jobs (beyond cap, reject with retry-after)

## 8.2 Fallback and circuit breaking

1. Consecutive provider failures trip a circuit breaker.
2. Orchestrator routes to configured fallback model profile when possible.
3. If all configured fallbacks fail, mark as `failed` with retry recommendation.
4. Circuit breaker defaults:
   - Open after 5 consecutive failures within 2 minutes
   - Half-open after 5 minutes
   - Close after 3 consecutive successes in half-open
5. Fallback selection is deterministic:
   - Use `model_profiles` ordered list by `priority` ascending
   - Skip profiles marked unhealthy
6. Retry policy defaults:
   - Retryable error codes only (`timeout`, `rate_limit`, `upstream_5xx`)
   - Non-retryable codes (`policy_reject`, `invalid_input`, `auth_error`) fail fast

## 8.3 Reliability guarantees

1. At-least-once step execution with idempotent handlers.
2. Asset writes are checksum-verified before step completion.
3. Job progress updates are persisted before notifying clients.
4. Dead-letter queue for exhausted retries with replay tooling for operators.

## 9. Quality Control and Validation

Automated gates:

1. Script QA: coherence, role continuity, policy checks.
2. Storyboard QA: 15-second timing validity, sequence continuity.
3. Image QA: character/prop consistency checks.
4. Video QA: duration, playability, resolution, frame boundary checks.

Failure handling:

1. One automatic regeneration pass for image/video QA failures; this counts as the same retry budget defined in Section 6.1.
2. Then explicit user-visible failure with targeted retry options.

## 10. Security, Compliance, and Audit Baseline

1. Signed URLs for asset downloads.
2. Least-privilege service credentials for model adapters and storage.
3. Audit trail for billing and model calls with trace IDs.
4. Basic input and output policy filtering before final packaging.
5. Data retention:
   - Raw prompts and model responses: 30 days
   - Generated media assets: 90 days (unless user deletes earlier)
   - Billing ledger and audit events: 365 days
6. PII handling:
   - Encrypt user profile fields and billing identifiers at rest
   - Redact phone/email in application logs
7. Audit event minimum schema:
   - `event_id`, `timestamp`, `actor_type`, `actor_id`, `job_id`, `step`, `action`, `result`, `trace_id`, `metadata`
8. Content risk escalation:
   - Blocked by policy filter -> `failed` status with reason code `failed_policy` and user-visible reason
   - Flagged but not blocked -> send to moderation review queue for operator decision

## 11. 6-Week Delivery Plan

## Week 1: Platform skeleton

1. Auth baseline, project/job schema, queue wiring, storage integration.
2. Minimal dashboard and job submission UI.

## Week 2: Script and storyboard chain

1. Script optimization worker.
2. Storyboard splitting and prompt generation worker.

## Week 3: Image and video chain

1. Image worker (character/prop/reference/first-last-frame).
2. Video worker (15-second shot assets).

## Week 4: Billing and entitlements

1. Subscription + overage logic.
2. Credit freeze/settlement and refund flows.

## Week 5: Hardening

1. Concurrency and load testing for 200+ jobs.
2. Retry/fallback/circuit breaker and operational alerts.

## Week 6: Launch readiness

1. UX polish, error clarity, packaging UX.
2. Gray release and support runbook.

## 12. MVP Acceptance Criteria

1. End-to-end success:
   - In staging load test, >=95% of jobs complete `queued -> done` without manual intervention.
2. API responsiveness:
   - Job submission API p95 latency <=2.0 seconds at 200 concurrent active jobs.
3. Throughput and queue health:
   - Sustain 200 concurrent active jobs for 60 minutes with no queue outage.
   - Queue wait time p95 <=10 minutes for `pro` tier under test load.
4. Billing correctness:
   - Credit freeze, settlement, and refund reconciliation accuracy >=99.9% against ledger replay.
   - Overage charges match formula outputs on 100% of billing integration test fixtures.
5. Reliability:
   - Retryable failures auto-recovered within retry budget in >=90% of injected transient-failure tests.
6. Observability and audit:
   - 100% of job steps and model calls include `trace_id`, latency, provider usage, and cost metadata.

## 13. Immediate Next Step

After approval of this design, produce a detailed implementation plan with executable tasks, validation steps, and ownership boundaries.
