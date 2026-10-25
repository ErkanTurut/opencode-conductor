---
name: Adversarial Review
description: Independent contract-based review producing structured findings
metadata:
  opencode/autoinvoke: false
---

# Adversarial Review

## Purpose

Independent review that challenges the implementation against the contract, not the implementer's rationale.

## Input

Reviewer receives:
- Original request and contract
- Approved plan
- Final diff from implementation
- Test/build evidence
- Relevant project standards

Reviewer does NOT receive the implementer's reasoning.

## Output

Structured findings (see `schemas/review.schema.json`):

```json
{
  "severity": "high",
  "category": "correctness",
  "title": "Short finding title",
  "fingerprint": "unique-hash",
  "location": "file.ts:42",
  "evidence": "Detailed evidence",
  "confidence": 0.91,
  "blocking": true,
  "required_fix": "What must change"
}
```

## Merging

Findings are merged by stable location/category/title. A single high-confidence blocking finding prevents integration.
