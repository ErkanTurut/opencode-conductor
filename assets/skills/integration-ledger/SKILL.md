---
name: integration-ledger
description: "Maintain a live, append-only integration-notes ledger during a run: cross-task interface changes, merge decisions, env quirks, and deferred items; consumed at closeout. Trigger on 'integration notes', 'ledger', 'keep track of changes across tasks', 'what did we defer', mid-run coordination bookkeeping"
metadata:
  opencode/autoinvoke: true
  audience: integrator
---

# Integration Ledger

## Purpose

Maintain a live, append-only ledger of cross-task interface changes, merge decisions, environment quirks, and deferred items for one run. Closeout consumes it; nothing in it is reconstructed from memory.

## Procedure

1. Open or create `.opencode/runs/<run>/artifacts/integration-notes.md`; create parent directories if missing. If it exists, continue from its last row.
2. Append one entry per decision — never a narrative. Record: timestamp (ISO 8601 UTC), task id, kind, note, evidence path.
3. Use exactly these kinds:
   - `interface` — a task changes a shared API, type, schema, or event; name producer and consumer tasks or modules in the note.
   - `merge` — a branch or merge decision; note source → target branches and how conflicts were resolved.
   - `env` — environment quirk or workaround; note symptom, workaround, and where it is documented.
   - `deferred` — work intentionally postponed; note owner and revisit condition.
4. Never rewrite, reorder, or delete existing rows. Corrections are new rows that reference the original timestamp.
5. At closeout, hand the ledger path to the conductor; the receipt cites it as evidence.

## Output

`.opencode/runs/<run>/artifacts/integration-notes.md`:

```markdown
# Integration Notes — <run>

Append-only. One row per decision.

| Timestamp (UTC) | Task | Kind | Note | Evidence |
| --- | --- | --- | --- | --- |
| 2026-09-28T10:14:00Z | wi-...-70z0 | interface | `session_move` gains optional `directory`; consumer wi-...-a1 must tolerate absence | src/lib/.../session.ts:88 |
| 2026-09-28T10:31:00Z | wi-...-70z0 | env | Bun cache stale in worktree; cleared with `bun install --frozen-lockfile` | .opencode/runs/<run>/artifacts/task.log |
| 2026-09-28T11:02:00Z | wi-...-70z0 | deferred | owner: integrator; revisit: after auth worktree merges | src/routes/.../settings.tsx |
```

## Rules

- Append-only: never rewrite, reorder, or delete entries.
- Every entry cites a task id and an evidence path; no entry from memory alone.
- A deferred item must state an owner and a revisit condition, or it is dropped, not deferred.
- The ledger records decisions, not task status; do not mirror planner state.
- If this guidance was wrong or incomplete, write a proposal to `.opencode/runs/<run>/artifacts/skill-proposals/integration-ledger-<timestamp>.md` (gap, evidence, proposed edit, blast radius) for memory-curator triage; never edit this skill file directly without human approval.
