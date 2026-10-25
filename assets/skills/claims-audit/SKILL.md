---
name: claims-audit
description: "Claims-audit ground-truth adjudication: independently re-derive the truth of factual claims (feature behavior, metrics, legal/regulatory statements, citations) against ground truth sources and adjudicate disagreements between agents. Trigger on 'claims audit', 'ground truth', 'adjudicate', 'verify citations are real', 'is this metric accurate', 'check the report against the source'"
metadata:
  opencode/autoinvoke: false
  audience: critic
---

# Claims Audit

## Purpose

Adjudicate factual claims — feature behavior, metrics, legal/regulatory statements, citations — by independently re-deriving each one from a primary source. Agents frequently agree on wrong claims; the audit exists to catch that, not to confirm it. Boundary: `adversarial-review` judges a diff against the contract; claims-audit re-derives facts against primary sources — run both, neither substitutes for the other.

## Procedure

1. **Collect claims.** Extract every checkable factual claim from the artifacts under audit (reports, plans, receipts, findings, commit messages). Record each claim verbatim with its artifact path and exact location.
2. **Locate ground truth.** For each claim, identify a primary source:
   - Feature behavior → the code path and its tests
   - Metrics/performance → the raw measurement output, not a summary of it
   - Legal/regulatory statements → the regulation text itself
   - Citations → the cited document at the cited location
   A primary source is the artifact itself. Never accept another agent's summary, recollection, or restated finding as ground truth.
3. **Re-derive independently BEFORE comparing.** Reproduce the claim yourself from the source — run the test, read the code, open the cited text — and write your own conclusion first. Then compare against the claim under audit. Comparing first anchors you to the claim and produces rubber-stamps.
4. **Adjudicate.** Assign each claim one verdict:
   - `confirmed` — your independent derivation matches the claim
   - `refuted` — your derivation contradicts the claim; attach evidence
   - `unresolved` — ground truth is missing, ambiguous, or inaccessible
   Set confidence (0–1). Record severity (`info|low|medium|high|critical`) for refuted and unresolved claims; mark `blocking: true` when a refuted claim invalidates a contract, a merge, or a user-facing statement.
5. **Escalate unresolved claims.** Collect every unresolved claim into one human escalation list: what was checked, what was missing, and the exact question a human must answer. Never guess a verdict to close the table; never downgrade unresolved to confirmed.
6. **Record findings.** Persist every refuted claim and every blocking verdict via `supervisor_record_finding` (severity, category, evidence, confidence, `required_fix`) so they gate integration. An artifact table alone gates nothing.

## Output: Adjudication Table

Write to `.opencode/runs/<run>/artifacts/claims-audit/<timestamp>.md`:

| claim | source | ground truth | verdict | confidence | blocking |
| --- | --- | --- | --- | --- | --- |
| "Endpoint rejects unauthenticated requests" | report §3 | `src/routes/api.tsx:41` + `api.test.ts:88` | confirmed | 0.95 | no |
| "p95 latency reduced 40%" | perf report | raw run `perf-2026-09-28.json` | refuted | 0.90 | yes |
| "Article 10(2) requires X" | compliance report | AI Act text, Article 10 §2 | unresolved | — | — |

Append the escalation list:

```
## Escalation
- <claim> — checked: <sources> — missing: <gap> — question: <what a human must answer>
```

## Rules

- Ground truth is a primary source. Never another agent's summary — including a critic's or a scout's.
- Unresolved = escalated, never guessed, never dropped. No verdict without your own derivation.
- Citation checks verify the cited text exists at the cited location — wording, article/section, and page or line.
- A refuted blocking claim stops integration until repaired or explicitly waived by a human — and is persisted via `supervisor_record_finding`, never left only in the table.
- Self-improvement: when this skill misfires (missed claim class, bad adjudication, rubber-stamp detected), write a proposal to `.opencode/runs/<run>/artifacts/skill-proposals/claims-audit-<timestamp>.md` (what failed, evidence, proposed change). Proposal only — never edit this skill mid-run.
