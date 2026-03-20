# AGENTS.md

Repository-local execution policy.

## Priority

Workflow compliance and correctness are more important than speed.
If a rule is ambiguous, choose the more conservative interpretation.

## Completion Gates

A task is not complete unless all required gates are green:

1. Implementation is finished.
2. Required verification commands were rerun and passed.
3. Required spec review explicitly approved the current state.
4. Required code-quality review explicitly approved the current state.
5. The worktree is clean, except for intentional changes or artifacts explicitly accepted by the user.

Do not say "done", "complete", "ready", or move to the next task while any required gate is red or pending.

## Review Discipline

1. If a workflow skill is active, follow it literally.
2. If a reviewer finds issues, fixes must be followed by the same review gate again.
3. Do not substitute your own judgment for a missing reviewer approval.
4. Do not weaken review standards to get a faster approval.
5. Do not switch reviewers repeatedly, narrow the review scope, downgrade the model, or rewrite the prompt just to force a pass.
6. If a review gate is unresolved, report that state explicitly instead of treating the task as complete.

## Timeout And Failure Handling

1. If a reviewer times out, report `review gate unresolved`.
2. Do not treat manual re-checking as a substitute for a required reviewer gate.
3. Do not proceed to the next planned task until every required gate is green.

## Speed Restrictions

1. Do not optimize for fastest completion.
2. Prefer waiting and reporting accurate status over pushing ahead.
3. Never compress or omit failed review findings when reporting status.

## Required Status Reporting

For each task, report these gates explicitly:

- `Implementation`: `GREEN` | `RED` | `PENDING`
- `Verification`: `GREEN` | `RED` | `PENDING`
- `Spec review`: `GREEN` | `RED` | `PENDING`
- `Code-quality review`: `GREEN` | `RED` | `PENDING`
- `Overall`: `GREEN` | `RED` | `PENDING`

`Overall` may be `GREEN` only if all required gates are `GREEN`.

## Default When Unsure

Stop, name the unresolved gate, and wait for direction or continue only after the gate is properly closed.
