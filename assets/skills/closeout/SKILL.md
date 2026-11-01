---
name: Closeout
description: Produce final run receipt, journal entry, and memory proposals
metadata:
  opencode/autoinvoke: true
---

# Closeout

## Purpose

Finalize a run by producing a receipt, journal entry, and memory proposals.

## Procedure

1. Gather all evidence: changed files, verification results, review findings, model usage.
2. Before closing or cleaning up, decide whether the run produced durable, evidence-backed project learning. Record the decision and rationale in run artifacts, including a no-learning decision.
3. If worthwhile, spawn `memory-curator` with the run ID, relevant artifact paths and resolved project memory location. Wait for its result; report actual persisted proposals or any blocker. Do not treat a failed delegation or an unwritten proposal as completed enrichment.
4. Write receipt markdown with summary, results, memory outcome and unresolved risks.
5. Write a concise journal entry; clean up only when safe.

## Receipt Format

- Objective and final state
- Changed files
- Verification summary (pass/fail per command)
- Review findings (severity, blocking status)
- Model usage (which models, token counts)
- Repair rounds
- Unresolved risks
