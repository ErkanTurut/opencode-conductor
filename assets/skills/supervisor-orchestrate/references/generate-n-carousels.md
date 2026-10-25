# Run type: generate N carousels

Read this from Stage 0 when the objective is a carousel batch. It defines the
objective text, the task templates, and the gates that keep the batch auditable.

- **There is no run-type registry and no named verification profile.** A run type
  is the free-text `objective` passed to `supervisor_init_run` plus the task
  templates you create. Verification is per task (`verification_commands`). The
  `verifyProfile` option supplies default commands when a task passes none
  (`tools/opencode-supervisor/src/plugin.ts:1662-1668`); keep it empty for this
  run type.
- **Roles are a closed enum**, duplicated in `tools/opencode-supervisor/src/plugin.ts`
  (`ROLE_ENUM`) and `src/types.ts` (`AGENT_ROLES`). This run type uses existing
  roles only (`coder`, `test-engineer`, `critic`, `integrator`, `conductor`).
  Do not add a role: it would require editing both files, and that is out of
  scope for this run.
- **Every mutating task below carries non-empty `verification_commands`.**
  `supervisor_verify` hard-refuses a mutating task with an empty list
  (`failure_class: "no_verification_commands"`). Read-only roles (`critic`,
  `conductor`) get a neutral skip instead — see the gate notes.

## Capacity (check before init)

| Rule | Limit | Stop condition |
| --- | --- | --- |
| Carousels per batch | `N` integer, `1 ≤ N ≤ 7` (default `N=4`) | `E_BATCH_PERSONAS` (7 persona images is the ceiling) |
| Distinct persona image per carousel | batch needs `N` distinct files | `E_BATCH_PERSONAS` |
| Generic backgrounds | `Σ(M_c − 1) ≤` generic pool size | `E_BATCH_POOL` |
| Slides per carousel | `M ∈ {3,4}` | `E_SLIDE_COUNT` |
| Default batch | `N=4`, `M=4` → 12 backgrounds | — |

`Σ(M_c − 1)` is the sum over carousels of content slides (slide 1 is the persona
image). The pool is the merged `backgroundDirs` minus persona files. With a
41-image pool the persona ceiling binds first (`N ≤ 7`); the pool guard still
applies to smaller pools.

Reproducibility is **manifest-level**: the same `batchId` + same pools yields the
same assignment; a new `batchId` reshuffles from scratch. Never try to regenerate
a batch from per-carousel seeds.

## 1. Objective pattern for `supervisor_init_run`

Substitute the placeholders and pass the block as `objective`. The supervisor
stores the string only — every parameter must be literal in the text (there is
no structured run config).

```text
Generate <N> TikTok carousels (default N=4) for the "vibecoders" niche as one batch.

Batch: batchId=<batchId> (fresh id per batch). Persona images: <personaDir>. Generic backgrounds: <bgDir1>, <bgDir2> (one shared pool; quote paths containing spaces).
Template: 3-4 slides per carousel — slide 1 = persona image + French hook overlay; slides 2..M = generic backgrounds carrying the hook's tips. No product slide, no CTA slide, never.
Copy: French only, peer voice (a vibecoder sharing what worked), no vendor pitch, no "!". Slide text <=60 chars and <=12 words, tips <=10 words. caption.md per carousel: French TikTok caption + 3-5 hashtags.
Hook gate: 6-10 French candidates per carousel topic -> criticize_hooks; >=3 survivors required before any render. Failed rounds keep their verdicts, are retried with fresh candidates (max 3 attempts), then the topic is substituted. Nothing is ever rendered ungated.
Shuffle: plan the whole batch with plan_batch before rendering. Distinct persona image per carousel; no generic background repeats within a carousel or across the batch. A new batchId reshuffles.
Artifacts: .opencode/runs/<run_id>/artifacts/<batchId>/ only (batch.json at the root; one <carouselId>/ per carousel with slide_1..M.jpg, plan.json, caption.md). A repo-root artifacts/ directory is forbidden.
Metadata: strip/normalize EXIF on export and assert it. No fabricated provenance metadata; no bot-detection or platform-evasion features (hard non-goals).
Done = shuffle + metadata audit green, bun test/typecheck green, and a human-signed golden batch of <N> rendered carousels. No auto-posting, scheduling, or upload.
```

Recommended `supervisor_init_run` args:

| Field | Value | Why |
| --- | --- | --- |
| `objective` | block above | the run type |
| `risk_class` | `medium` | publishing images of an identifiable person; human-reviewed |
| `data_class` | `confidential` | persona photos are personal data |
| `operation_mode` | `assisted` | the human golden sign-off gate is mandatory |

## 2. Task template

Create tasks in order; substitute the real `run_id` and the minted task ids into
`dependencies`. Tasks 1-3 are artifact-only: claim them, then execute at the run
root (no worktree) — they edit no tracked file, `.opencode/runs/` is gitignored,
and `render_carousel` refuses an `outDir` outside the session root
(`E_OUT_OF_SCOPE`). Tasks 4 and 6 edit tracked files and run in a worktree. The
inline `jq -e` gates assume `jq` on PATH; the audit test (task 4) is the
authoritative manifest check. `<runRoot>` below is the absolute path of the run's
main checkout — substitute it when a command runs inside a task worktree.

| # | Title | Role | `model_slot` | Depends on | Mutating |
| --- | --- | --- | --- | --- | --- |
| 1 | Batch plan: draft manifest | `coder` | `implementation` | — | yes (artifacts) |
| 2 | Hook gate: draft + gate + retries | `coder` | `implementation` | 1 | yes (artifacts) |
| 3 | Copy + render: sliders, captions, JPEGs | `coder` | `implementation` | 2 | yes (artifacts) |
| 4 | Batch audit: shuffle + metadata test | `test-engineer` | `testing` | 3 | yes (test file) |
| 5 | Review: FR tone + drift | `critic` | `critique` | 3 | no |
| 6 | Integrate: merge + full suite | `integrator` | `integration` | 4, 5 | yes (merge) |
| 7 | Golden batch sign-off (human) | `conductor` | default | 6 | no |

### Task 1 — Batch plan (draft manifest)

```json
{
  "run_id": "<run_id>",
  "title": "Batch plan: draft manifest for <N> carousels (batchId <batchId>)",
  "role": "coder",
  "model_slot": "implementation",
  "priority": 30,
  "write_scope": [".opencode/runs/<run_id>/artifacts/<batchId>/batch.json"],
  "allowed_paths": ["<runRoot>/.opencode/runs/<run_id>/artifacts/<batchId>/"],
  "acceptance_criteria": [
    "plan_batch called once with batchId=<batchId>, <N> distinct topics (default: 4 vibecoder topics invented by the agent; explicit human briefs override), the persona dir and both generic dirs, frame 1080x1920",
    "Manifest records pools, seeds, one personaImage per carousel and plan.slides[].bg on every slide, 3-4 slides per carousel; copy may still be draft",
    "Capacity respected: N<=7 and sum(M_c-1) <= generic pool; E_BATCH_PERSONAS / E_BATCH_POOL are stop conditions, not retryable",
    "Tool-returned manifest persisted verbatim as batch.json under the batch dir; nothing written to a repo-root artifacts/",
    "No tracked file changed"
  ],
  "verification_commands": [
    "jq -e --arg id '<batchId>' --argjson n <N> '.batchId == $id and .templateId == \"hook-tips-3-4\" and (.carousels | length) == $n' .opencode/runs/<run_id>/artifacts/<batchId>/batch.json",
    "cd tools/opencode-carousel && bun test tests/batch.test.ts",
    "git diff --check"
  ],
  "dependencies": []
}
```

If `plan_batch` is not in the plugin surface, stop and report the tooling gap —
never hand-shuffle pools in the conductor context.

### Task 2 — Hook gate

```json
{
  "run_id": "<run_id>",
  "title": "Hook gate: draft, criticize_hooks, retry (batchId <batchId>)",
  "role": "coder",
  "model_slot": "implementation",
  "priority": 20,
  "write_scope": [
    ".opencode/runs/<run_id>/artifacts/<batchId>/batch.json",
    ".opencode/runs/<run_id>/artifacts/<batchId>/hooks.md"
  ],
  "allowed_paths": ["<runRoot>/.opencode/runs/<run_id>/artifacts/<batchId>/"],
  "acceptance_criteria": [
    "6-10 French candidates per carousel topic; French only, no '!', ASCII apostrophes",
    "criticize_hooks called per carousel; rewrite verdicts get their fix applied and re-criticized; rejects are rewritten or dropped",
    "Every round recorded in hookGate.attempts (candidates, verdicts, survivors, the E_HOOKS_FEW error when it fails); verdicts are never discarded",
    "A carousel passes only with >=3 survivors; hook.chosen = first survivor of the first passing round; remaining survivors = hook.alternates (text-only, never rendered)",
    "Max 3 attempts per topic, then substitute the topic (record old -> new) or drop the carousel and record why; the rubric is never lowered and nothing renders ungated",
    "hooks.md journals each carousel: candidates per round, survivors, retries, substitution"
  ],
  "verification_commands": [
    "jq -e '.carousels | all(.hookGate.passed and ((.hookGate.attempts | map(.survivors | length) | max) >= 3) and (.hook.chosen | length > 0) and ((.hook.alternates | length) >= 2))' .opencode/runs/<run_id>/artifacts/<batchId>/batch.json",
    "cd tools/opencode-carousel && bun test tests/hooks.test.ts",
    "git diff --check"
  ],
  "dependencies": ["<task_1_id>"]
}
```

### Task 3 — Copy + render

```json
{
  "run_id": "<run_id>",
  "title": "Copy + render: sliders, captions, JPEGs for <N> carousels (batchId <batchId>)",
  "role": "coder",
  "model_slot": "implementation",
  "priority": 10,
  "write_scope": [
    ".opencode/runs/<run_id>/artifacts/<batchId>/batch.json",
    ".opencode/runs/<run_id>/artifacts/<batchId>/<carouselId>/"
  ],
  "allowed_paths": ["<runRoot>/.opencode/runs/<run_id>/artifacts/<batchId>/"],
  "acceptance_criteria": [
    "generate_sliders per gated carousel: hook + 2-5 tips, 3-4 slides; <=60 chars and <=12 words per slide, <=10 words per tip; no truncation",
    "Completed copy attached by re-calling plan_batch with the same batchId and the recorded hookGateAttempts (assignment stays identical); the returned manifest is persisted as batch.json",
    "render_carousel per carousel with the manifest assignment (plan.slides[].bg, verbatim order): 3-4 JPEGs at 1080x1920, with plan.json and caption.md as siblings; batch.json records render.files/hashes and metadata.stripped=true",
    "caption.md: French TikTok caption + 3-5 hashtags per carousel",
    "No product slide, no CTA slide, no vendor pitch; no EXIF/XMP/IPTC added; E_META_LEAK is a stop condition",
    "All N carousel dirs under the batch dir; nothing in a repo-root artifacts/"
  ],
  "verification_commands": [
    "jq -e '.carousels | all(.metadata.stripped and ((.render.files | length) >= 3) and ((.render.files | length) <= 4) and .hookGate.passed and ((.caption.hashtags | length) >= 3) and ((.caption.hashtags | length) <= 5))' .opencode/runs/<run_id>/artifacts/<batchId>/batch.json",
    "test \"$(find .opencode/runs/<run_id>/artifacts/<batchId> -mindepth 2 -name caption.md | wc -l | tr -d ' ')\" -eq <N>",
    "cd tools/opencode-carousel && bun test",
    "cd tools/opencode-carousel && bun run typecheck"
  ],
  "dependencies": ["<task_2_id>"]
}
```

If the render tool cannot take the manifest assignment, stop and report — a fresh
draw at render time breaks the batch invariants. If `plan_batch` cannot replay
`hookGateAttempts`, stop and report as well — never hand-edit `batch.json`.

### Task 4 — Batch audit (test-engineer)

```json
{
  "run_id": "<run_id>",
  "title": "Batch audit: shuffle + metadata test against batchId <batchId>",
  "role": "test-engineer",
  "model_slot": "testing",
  "priority": 10,
  "write_scope": [
    "tools/opencode-carousel/tests/golden-batch-audit.test.ts",
    ".opencode/runs/<run_id>/artifacts/<batchId>/audit.md"
  ],
  "allowed_paths": [
    "tools/opencode-carousel/tests/",
    "<runRoot>/.opencode/runs/<run_id>/artifacts/<batchId>/"
  ],
  "acceptance_criteria": [
    "tests/golden-batch-audit.test.ts created or extended: reads GOLDEN_DIR, skips when unset so plain bun test stays hermetic, no hard-coded run ids or absolute paths",
    "Asserts (a) one persona image per carousel across the batch, (b) no generic background repeats inside a carousel, (c) none repeats across the batch, (d) re-planning with the same batchId and recorded pools reproduces the assignment, (e) a new batchId changes it",
    "Asserts per carousel: hookGate.passed with >=3 survivors, hook.chosen is a survivor, 3-4 slides, slide 1 role hook with bg == personaImage, metadata.stripped === true, every render.files entry exists as a 1080x1920 JPEG, 3-5 caption hashtags",
    "audit.md records pass/fail per invariant with counts (personas used, backgrounds used, slides rendered)",
    "No plugin runtime change (src/** untouched)"
  ],
  "verification_commands": [
    "cd tools/opencode-carousel && GOLDEN_DIR=\"<runRoot>/.opencode/runs/<run_id>/artifacts/<batchId>\" bun test tests/golden-batch-audit.test.ts",
    "cd tools/opencode-carousel && bun test",
    "cd tools/opencode-carousel && bun run typecheck",
    "git diff --check"
  ],
  "dependencies": ["<task_3_id>"]
}
```

The `GOLDEN_DIR` command must show a non-skipped run in evidence: the test
skips without the variable, and a skip is not an audit pass.

### Task 5 — Review (critic, read-only)

```json
{
  "run_id": "<run_id>",
  "title": "Review: FR tone + template drift (batchId <batchId>)",
  "role": "critic",
  "model_slot": "critique",
  "priority": 5,
  "write_scope": [],
  "allowed_paths": ["<runRoot>/.opencode/runs/<run_id>/artifacts/<batchId>/"],
  "acceptance_criteria": [
    "Read-only: no file edits; record each issue with supervisor_record_finding (review_id <run_id>:golden-review, carouselId + slide index + severity)",
    "French only, no '!', ASCII apostrophes, peer voice - no vendor pitch, no product/CTA slide",
    "Hook matches its topic and the slide copy (no bait-and-switch); no drift from the topic briefs; no duplicated slide copy across the batch",
    "Captions: French, 3-5 hashtags, no vendor or offer language",
    "Vendor-pitch / CTA / drift / duplicate-copy findings are blocking; cosmetic notes are non-blocking"
  ],
  "verification_commands": [],
  "dependencies": ["<task_3_id>"]
}
```

Empty `verification_commands` on a read-only role returns a neutral skip. The
tool emits every field below, so quote it whole rather than by excerpt:

```json
{
  "all_passed": true,
  "skipped": true,
  "failure_class": null,
  "role": "critic",
  "reason": "no_verification_commands_for_read_only_role",
  "results": []
}
```

That is not a content pass — blocking findings stop the run.

### Task 6 — Integrate (integrator)

```json
{
  "run_id": "<run_id>",
  "title": "Integrate: merge task branches + full suite (batchId <batchId>)",
  "role": "integrator",
  "model_slot": "integration",
  "priority": 0,
  "write_scope": ["supervisor/run-<run_id>/integration"],
  "allowed_paths": ["<runRoot>"],
  "acceptance_criteria": [
    "Merge approved task branches into supervisor/run-<run_id>/integration (merge-only); never push",
    "Merge the tracked audit test; run artifacts are untracked and gitignored - never commit or merge .opencode/runs/**",
    "Confirm the rendered batch is intact at the run artifact path (batch.json + <N> carousel dirs) and that no repo-root artifacts/ exists",
    "Full suite green; no auto-post/schedule/upload code and no metadata fabrication introduced"
  ],
  "verification_commands": [
    "cd tools/opencode-carousel && bun test",
    "cd tools/opencode-carousel && bun run typecheck",
    "test -d \"<runRoot>/.opencode/runs/<run_id>/artifacts/<batchId>\"",
    "git diff --check"
  ],
  "dependencies": ["<task_4_id>", "<task_5_id>"]
}
```

### Task 7 — Golden batch sign-off (human gate)

```json
{
  "run_id": "<run_id>",
  "title": "Golden batch sign-off: human-approved <N> carousels (batchId <batchId>)",
  "role": "conductor",
  "priority": 0,
  "write_scope": [],
  "allowed_paths": ["<runRoot>/.opencode/runs/<run_id>/artifacts/<batchId>/"],
  "acceptance_criteria": [
    "Present the batch: dir path, <N> carousel dirs, every slide JPEG + caption.md, audit.md result, critic findings",
    "The human answers via question: approve, or request changes. The agent never self-approves; silence is not approval",
    "Record the decision as an info finding (review_id <run_id>:golden-review, category human-signoff, evidence = the human's verbatim approval with batchId, manifest path and slide hashes), then complete this task with exit_code 0",
    "On change requests: create bounded repair tasks, re-render, re-run the audit, then ask again - the run is not done until a batch is signed",
    "Closeout (supervisor_generate_receipt) only after this task is complete"
  ],
  "verification_commands": [],
  "dependencies": ["<task_6_id>"]
}
```

`conductor` is read-only, so the empty command list is a neutral skip — the gate's
evidence is the human's quoted approval, recorded as a `human-signoff` finding,
not a command result.

## 3. Retry loop (hook gate)

The gate is `criticize_hooks`, and its verdicts are the record:

1. Draft 6-10 French candidates per carousel topic.
2. Call `criticize_hooks`. A failed round returns the pinned
   `{ results, survivors, error: "E_HOOKS_FEW: …", gate: "failed" }` — keep the
   payload; never discard verdicts.
3. `rewrite` verdicts: apply their `fix` and re-criticize. `reject` verdicts:
   rewrite the hook or drop it.
4. A round passes at **>=3 survivors**. `hook.chosen` = first survivor of the
   first passing round; the rest become `hook.alternates` (text-only).
5. A round fails: draft fresh candidates and retry, **max 3 attempts per topic**.
   Then substitute the topic (record old -> new) or drop the carousel and record
   why (`N` shrinks). Never soften the rubric to reach the quota.
6. No `render_carousel` call before `hookGate.passed === true` and `chosen` is a
   survivor — the batch layer refuses with `E_BATCH_GATE`.

## 4. Shuffle invariants (all automated)

- (a) No persona image is used by more than one carousel in the batch.
- (b) No generic background repeats inside a carousel.
- (c) No generic background repeats anywhere in the batch.
- (d) Re-planning with the same `batchId` + recorded pools reproduces the same
  assignment (manifest-level reproducibility).
- (e) A new `batchId` reshuffles the pools.

These are enforced by `BatchManifestSchema` and `tests/batch.test.ts`; the audit
test (task 4) proves them on the produced batch.

## 5. Metadata and copy expectations

- **Strip-only.** Exported JPEGs carry no EXIF/XMP/IPTC; the renderer asserts it
  and throws `E_META_LEAK` instead of exporting a leak. `metadata.stripped`
  flips to `true` only after a successful render.
- **Hard non-goal:** no fabricated EXIF/provenance metadata (no fake GPS, dates,
  camera info, locations) and no features designed to defeat bot detection or
  platform-integrity algorithms. If re-raised, restate the boundary once and
  continue without it.
- Copy budgets: <=60 chars / <=12 words per slide, <=10 words per tip, 3-4
  slides, 2-5 tips; violations are errors (`E_TEXT_LEN` / `E_ITEM_LEN`), never
  silent truncation. Caption: French + 3-5 hashtags.

## 6. Artifact layout

```text
<runRoot>/.opencode/runs/<run_id>/artifacts/<batchId>/
├── batch.json              # BatchManifest — source of truth (pools, seeds, gate, plan, caption, render)
├── hooks.md                # hook-gate journal (task 2)
├── audit.md                # invariant audit (task 4)
└── <carouselId>/
    ├── slide_1.jpg … slide_M.jpg   # 1080x1920 JPEG, metadata stripped
    ├── plan.json                   # plan v2 with slides[].bg populated
    └── caption.md                  # French caption + 3-5 hashtags
```

- `.opencode/runs/` is gitignored: artifacts are **never committed or merged**.
- `render_carousel` scope-guards `outDir` to the session root (`E_OUT_OF_SCOPE`).
  Run artifact tasks at `<runRoot>`; do not render through a worktree and copy
  afterwards.
- A repo-root `artifacts/` directory is forbidden.

## 7. Non-goals (do not add them later)

- No auto-posting, scheduling, multi-account handling, or TikTok upload — the
  batch produces human-reviewed artifacts.
- No persona generation, video/Reels, or AI image generation.
- No product slide, CTA slide, lead-magnet slide, or vendor pitch.
- No new supervisor roles, no run-type registry, no named verify profile.
- No fabricated provenance metadata, no anti-bot / platform-evasion features.

## 8. Verification quick reference

```bash
git diff --check
cd tools/opencode-carousel && bun test
cd tools/opencode-carousel && bun run typecheck
cd tools/opencode-supervisor && bun test   # only if supervisor code changed (it must not)
```

Manifest audit (task 4):

```bash
cd tools/opencode-carousel && \
  GOLDEN_DIR="<runRoot>/.opencode/runs/<run_id>/artifacts/<batchId>" \
  bun test tests/golden-batch-audit.test.ts
```
