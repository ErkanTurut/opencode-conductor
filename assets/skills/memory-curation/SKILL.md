---
name: Memory Curation
description: Extract bounded, evidence-linked lessons from runs and propose memory updates
metadata:
  opencode/autoinvoke: false
---

# Memory Curation

## Purpose

Extract durable, non-sensitive lessons from completed runs and propose bounded memory updates.

## Procedure

1. Review run receipt, evidence, and review findings.
2. Identify recurring patterns: failures, successes, useful techniques.
3. Write proposed memory block with provenance metadata.
4. Submit for review (human or automated gate).

## Block Format

```json
{
  "label": "failures",
  "scope": "project",
  "version": 12,
  "source_run_id": "run-abc123",
  "source_artifacts": ["runs/run-abc123/tasks/wi-1/evidence.json"],
  "content_hash": "sha256:...",
  "actor": "memory-curator",
  "confidence": 0.88,
  "review_after": "2026-09-08",
  "status": "proposed"
}
```

## Rules

- Never store secrets, tokens, or raw customer data.
- Memory is advisory — code and tests are authoritative.
- Promote: proposed → reviewed → active → superseded/expired.
- Keep blocks under 5,000 characters.
