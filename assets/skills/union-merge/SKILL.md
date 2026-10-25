---
name: union-merge
description: "Union-merge orchestration for parallel task branches: reconcile overlapping file changes from concurrent agents using union semantics where safe, detect semantic conflicts, and produce a deterministic merge plan with rollback. Trigger on 'merge parallel branches', 'union merge', 'combine task worktrees', 'two agents changed the same file', 'reconcile concurrent changes'"
metadata:
  opencode/autoinvoke: false
  audience: integrator
---

# Union Merge

## Purpose

Reconcile overlapping file changes from concurrent agents into a deterministic, verified merge plan. Union-merge is a precise instrument for append-only regions — never a license to combine logic.

## Procedure

1. **Inventory.** List every branch/task worktree and its changed files: `git diff --name-only <base>...<branch>` plus per-file hunk counts. Record branch → files → hunks before touching the integration worktree.
2. **Classify each overlap.** For every file touched by more than one branch, assign exactly one class:
   - `disjoint` — changes hit non-adjacent, non-interacting regions
   - `union-safe` — changes append entries to the same region and order is irrelevant (lists, export lists, registries, data tables, enum members, migration lists)
   - `semantic-conflict` — changes alter the same logic, types, signatures, control flow, schema semantics, or ordering-dependent behavior
3. **Apply union semantics only where safe.** Union-merge (`git merge-file --union` or explicit append of both hunk sets) is permitted for `disjoint` and `union-safe` classes only:
   - lists, exports, enum members, registry entries, tables, constants — append both sides
   - never logic, conditionals, function bodies, schemas, ordering-dependent migrations
   If the union requires deciding which behavior wins, it is a semantic conflict — reclassify and stop.
4. **Return semantic conflicts to the owning task.** Do not guess. Create a repair task for the branch that owns the file (per its task contract write scope), attach both diffs and the conflict region, and block that file's merge until the owner resolves it. The integrator never authors the resolution.
5. **Verify before acceptance.** Assemble the merge in the integration worktree, then run the full check suite (format, lint, test, build — or the run's verification profile) via `supervisor_verify`. Never accept a merge on inspection alone. Acceptance requires the suite passing on the merged tree.
6. **Record the decision in the integration ledger.** Append one row per merged file to `.opencode/runs/<run>/artifacts/integration-notes.md` with kind `merge`; the note carries the overlap class and the rollback command, and the evidence points at the merge plan and verification result. Keep `merge-plan.md` as its own artifact. A file without a ledger row is not merged.

## Output: Merge Plan

Write to `.opencode/runs/<run>/artifacts/integration/merge-plan.md`:

| file | branches | overlap class | resolution | verification | rollback |
| --- | --- | --- | --- | --- | --- |
| `src/lib/registry.ts` | wt-a, wt-b | union-safe | union of appended exports | `bun run test` → pass | `git checkout <base> -- src/lib/registry.ts` |
| `src/lib/engine.ts` | wt-a, wt-c | semantic-conflict | returned to wt-c owner (task wi-…) | blocked | `git checkout <base> -- src/lib/engine.ts` |

Integration ledger rows (`.opencode/runs/<run>/artifacts/integration-notes.md`):

| Timestamp | Task | Kind | Note | Evidence |
| --- | --- | --- | --- | --- |
| 2026-09-28T22:41:07Z | wi-…-wrh7 | merge | `src/lib/registry.ts` union-safe (wt-a + wt-b); rollback: `git checkout <base> -- src/lib/registry.ts` | `merge-plan.md` §registry.ts; `bun run test` pass |

## Rules

- Union semantics apply to append-only/disjoint regions only — lists, exports, tables. Never logic.
- Semantic conflicts go back to the owning task. The integrator never guesses a resolution.
- Every merge is verified before acceptance. No merge is accepted on inspection.
- Each resolution carries an exact rollback command. No rollback, no merge.
- Never push. Merge preparation stops at the approval gate.
- Self-improvement: when this skill misfires (wrong class, unsafe union, missed conflict), write a proposal to `.opencode/runs/<run>/artifacts/skill-proposals/union-merge-<timestamp>.md`. Proposal only — never edit this skill mid-run.
