---
name: supervisor-orchestrate
description: Multi-model orchestration workflow — plan, scout, implement, verify, review, repair, integrate with full audit trail
metadata:
  opencode/autoinvoke: false
  audience: conductor
  workflow: multi-model
---

# Supervisor Orchestration

You are orchestrating a multi-model software change using the supervisor plugin. The supervisor provides durable tracking, worktree isolation, verification, and receipts.

## Available Supervisor Tools

- `supervisor_init_run` — Create a supervised run (always first)
- `supervisor_request_refinement` — Park an under-specified run in `awaiting_refinement`
- `supervisor_record_requirements` — Persist the refined contract and resume the run
- `supervisor_create_task` — Create a work item with role, paths, acceptance criteria
- `supervisor_get_status` — Check run progress and task states
- `supervisor_claim_task` — Atomically claim a task and receive an attempt/fencing token
- `supervisor_worktree` — Create/status/cleanup isolated git worktrees
- `supervisor_verify` — Run deterministic checks (format, lint, test)
- `supervisor_record_evidence` — Record task completion evidence
- `supervisor_record_finding` — Record review findings
- `supervisor_generate_receipt` — Final run receipt
- `supervisor_cancel_run` — Cancel a run durably

> NOTE: Optional Jev judge (default OFF). When `JEV_ENABLED=1` (or lowercase `jev_enabled=true`) + `AI_GATEWAY_API_KEY` set, pipeline MAY attach advisory `jev_status` calibrations. Disabled = zero fetch. Never replaces `supervisor_verify`, never changes repair budgets or merge gates. See `tools/opencode-supervisor/docs/jev-experiment.md`.
> - Runner contract warn only (never blocks).
> - Ledger severity calibration only (never auto-unblocks; high/critical upgrade needs >=0.85).
> - Policy safety escalate only on high-conf unsafe.

## Run Types

A run type is not a registry entry: it is the free-text `objective` passed to `supervisor_init_run`, the task templates you create, and each task's `verification_commands`. `supervisor_verify` has no named profiles, and mutating tasks with empty commands are refused (`no_verification_commands`). A configured `verifyProfile` option supplies default commands when a task passes none (`tools/opencode-supervisor/src/plugin.ts:1662-1668`); keep it empty for this run type. The role enum is closed and duplicated (`plugin.ts` `ROLE_ENUM` / `types.ts` `AGENT_ROLES`) — never invent a role for a run type.

- **generate N carousels** — supervised carousel batch (default N=4, ceiling N≤7): objective pattern, task templates, hook-gate retry loop, artifact layout, human golden sign-off. See `references/generate-n-carousels.md`.

## Workflow

### Stage 0: Intake
1. Call `supervisor_init_run` with the objective, risk class, and operation mode (pass `uncertainties` when the request is under-specified).
2. Record the returned `run_id`.
   Read `projectContext`: it supplies effective branches, verification commands, preview awareness and the resolved memory location. Do not assume every project uses `develop` or Vercel. Consult existing project memory during discovery; validate relevant advice against current code/tests and treat proposed or stale blocks as unreviewed evidence, not authority.
3. **Refinement gate** — judge definition quality per the `run-intake` skill. If the request is under-specified:
   a. Call `supervisor_request_refinement` with the uncertainties (run is durably parked in `awaiting_refinement`).
   b. Delegate to the `requirements-refiner` subagent — it interviews the user and writes the contract artifacts. Never carry that conversation in your own context.
   c. Call `supervisor_record_requirements` with the refined contract (or `outcome: "declined"`) before any discovery or planning.
   Never proceed to discovery with invented requirements.

### Stage 1: Discovery (parallel, read-only)
1. Create scout tasks via `supervisor_create_task`:
   - `scout` agent: repository structure, existing patterns
   - `external-scout` agent: external docs (if dependencies change)
2. For each task, call `supervisor_claim_task` before delegation and retain its `attempt_id` and `fencing_token`.
3. Launch subagents for each scout task (delegate to `scout` and `external-scout` agents).
4. Scouts are read-only — they cannot edit files.

### Stage 2: Plan
1. Delegate to the `architect` agent to produce `plan.json` with task DAG.
2. The architect proposes tasks with file ownership, dependencies, and acceptance criteria.
3. Create each planned task via `supervisor_create_task`.
4. For high-risk changes, request plan approval before execution.

### Stage 3: Execute (sequential / bounded parallel)
For each ready task (dependencies satisfied):
1. Call `supervisor_claim_task` before starting work. Never execute an unclaimed task.
2. If the task role is mutating (`coder`, `test-engineer`, `integrator`):
   a. Call `supervisor_worktree` with `action: "create"` to isolate the task.
   b. Pass the worktree path to the subagent.
3. `supervisor_worktree(action: "create")` bootstraps the worktree with `bun install --frozen-lockfile`; stop if `dependency_setup.passed` is false.
4. Delegate to the appropriate registered agent (`coder`, `test-engineer`, or `frontend-specialist` for UI-only tasks).
5. After implementation, call `supervisor_verify` with the task's verification commands and `run_id`/`attempt_id`.
6. Call `supervisor_record_evidence` with the exact fencing token.

### Stage 4: Review (read-only, parallel)
1. Delegate to `critic` (different model family from implementer) — reviews diff against contract.
2. Delegate to `security-critic` for auth/schema/infra changes.
3. Record findings via `supervisor_record_finding`.

### Stage 5: Repair (bounded, max 3 rounds)
If blocking findings exist:
1. Create repair tasks for the blocked items.
2. Re-implement with tight scope — only fix the finding, don't broaden.
3. Re-verify and re-review.
4. Stop after 3 rounds or if the same failure repeats.

### Stage 6: Integrate
1. Delegate to `integrator` agent in an integration worktree — it merges approved task branches into `supervisor/run-<run_id>/integration` and resolves conflicts within plan scope.
2. Run full verification profile via `supervisor_verify`.
3. Request merge approval from the human via `question` — never push without it.

### Stage 7: Finalize (human-gated git flow)
Only after explicit human merge approval:
1. Read the effective development and main branches from `projectContext`. At the clean repo root, verify the checkout and integration candidate, then merge the approved integration branch into development. Never merge into main. Do not overwrite unrelated user work.
2. Push the approved development branch to `origin` (for the default layout, `git push origin develop`). The configured branch guard and native permissions must both allow it; never force-push or work around a denial.
3. Find the preview deployment for the pushed commit, verify its status and provide the preview URL to the user for final verification. If no preview is configured, propose a setup; if it fails or cannot be verified, report the blocker rather than claiming success.
4. Once the user verifies the preview, create the development-to-main PR. If one already exists, report its URL instead of creating a duplicate. Never merge the PR yourself.
5. If merge, push, preview verification or PR creation fails, stop and report — never retry with force.

### Stage 8: Closeout
1. Before closing or cleaning up, decide whether the run produced durable, evidence-backed project learning. Record the decision and rationale in run artifacts, including when no update is worthwhile.
2. Call `supervisor_generate_receipt` with `memory_decision: {decision: "none"|"curate", rationale}`. For `curate`, delegate the returned handoff to `memory-curator` with the run ID, relevant artifacts and project memory location. Wait for its bounded proposal; repeat the receipt call with the same decision and `curator_proposal` to persist it server-side. Include `expected_version` when enriching an existing label. If the curator finds no supportable lesson, submit its explanation as `curator_no_learning` instead of fabricating memory. Report any failure explicitly rather than claiming enrichment.
3. Include the returned memory outcome and path in closeout, and clean up worktrees via `supervisor_worktree` only when safe.

## Key Rules

- **Never skip stages.** Discovery before plan. Verification before completion. Review before merge.
- **One worktree per mutating task.** Parallel tasks must have disjoint file ownership.
- **Verification is deterministic.** Call `supervisor_verify` — don't trust agent self-reports.
- **Critic gets diff + contract, not implementer's reasoning.**
- **Max 3 repair rounds.** Escalate to human, don't loop.
- **Push is scoped and human-gated.** Only the configured development target is eligible, after explicit human approval. Main moves only through the human-merged development-to-main PR. Production deployment is a separate human gate.
