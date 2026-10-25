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
2. Write receipt markdown with summary, results, and unresolved risks.
3. Write a concise journal entry.
4. Propose memory updates for durable lessons.

## Receipt Format

- Objective and final state
- Changed files
- Verification summary (pass/fail per command)
- Review findings (severity, blocking status)
- Model usage (which models, token counts)
- Repair rounds
- Unresolved risks
