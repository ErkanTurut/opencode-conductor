---
name: copy-truth
description: "Honest-conversion and copy-truth guardrails: audit UI/marketing copy and conversion flows for unsupported claims, fabricated metrics, dark patterns, and mismatch between what the product does and what copy promises. Trigger on 'claims in copy', 'honest conversion', 'dark pattern', 'marketing copy review', 'is this claim supported', 'false urgency'"
metadata:
  opencode/autoinvoke: true
  audience: critic
---

# Copy Truth

## Purpose

Audit copy and conversion surfaces — UI/marketing copy, pricing, CTAs, onboarding, emails — for unsupported claims, fabricated metrics, dark patterns, and mismatch between product behavior and copy promises. Scope is copy/conversion surfaces plus the dark-pattern class, not generic factual verification. Verdicts are evidence-backed; persuasion goals never soften findings.

## Procedure

1. Collect copy surfaces from the diff or target area: routes, components, i18n/message files, emails, page metadata, pricing and CTA blocks, modals, onboarding.
2. Extract every verifiable claim: metrics, performance numbers, security or compliance assertions, social proof, scarcity or urgency, guarantees, "best/fastest" comparisons, pricing terms, free-tier terms.
3. Map each claim to evidence in code, docs, tests, metrics, or external sources:
   - code paths that enforce the behavior (limits, defaults, feature gates)
   - tests asserting the behavior
   - docs and requirements artifacts, run receipts
   - real metric definitions — not screenshots, not intent
4. Classify each claim as exactly one of: `supported`, `unverifiable`, `false`, `dark-pattern`.
5. Inspect conversion flows for dark patterns: fake urgency or scarcity, forced continuity, confirm-shaming, hidden costs, pre-checked consent, asymmetric cancel flows.
6. Propose the minimal correction: rewrite, qualify, delete, or file a behavior-change task.
7. Report blocking rows to the conductor before integration.

## Output

Claim table, one row per claim:

```markdown
| Surface | Claim | Verdict | Evidence | Required fix |
| --- | --- | --- | --- | --- |
| src/.../pricing.tsx | "2 free analyses" | supported | MAX_ANALYSES_PER_USER = 2 — src/.../limits.ts:14 | none |
| src/.../landing.tsx | "bank-grade encryption" | unverifiable | no security docs or tests found | replace with documented statement or delete |
| src/.../promo.tsx | "Only 1 seat left" | dark-pattern | hardcoded countdown — src/.../promo.tsx:88 | remove scarcity or compute from real inventory |
```

Blocking rows are never ad-hoc-only outputs: record each via `supervisor_record_finding`; if tool access is unavailable, hand the blocking rows to the conductor or critic for recording.

## Rules

- Scope is copy and conversion surfaces plus the dark-pattern class. Generic factual re-derivation belongs to `claims-audit` — when a claim needs independent ground-truth re-derivation beyond copy surfaces, delegate or escalate to `claims-audit` instead of duplicating it here.
- Every claim gets a verdict; `unverifiable` is never recorded as `supported`.
- Evidence must be a file path, test name, metric, or external source — never intuition or "the team said".
- Dark patterns (fake urgency, forced continuity, confirm-shaming, hidden costs, pre-checked consent) are always blocking.
- Never invent metrics, testimonials, or proof to manufacture support.
- Mismatch between a copy promise and product behavior is a finding until copy or behavior changes.
- If this guidance was wrong or incomplete, write a proposal to `.opencode/runs/<run>/artifacts/skill-proposals/copy-truth-<timestamp>.md` (gap, evidence, proposed edit, blast radius) for memory-curator triage; never edit this skill file directly without human approval.
