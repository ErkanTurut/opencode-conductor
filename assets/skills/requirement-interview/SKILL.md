---
name: requirement-interview
description: "Requirement interviews via the question tool: turn ambiguous mandates into per-decision user answers with hypotheses, verbatim transcripts, adjudication, and a contract addendum before any code. Trigger on 'interview the user', 'refine requirements', 'per-screen decisions', 'contract addendum', 'adjudicate hypotheses', 'multi-round interview'"
metadata:
  opencode/autoinvoke: false
  audience: conductor
---

# Requirement Interview

## Purpose

Convert an ambiguous multi-track mandate into per-decision user answers before any code is written. `run-intake` resolves a request in at most 2 generic rounds; this skill goes further — sustained, per-decision interviews when one contract cannot capture the design space. The user is the sole design authority.

## Handoff

`run-intake` escalates to this skill when gaps survive its 2 refinement rounds or when the mandate is multi-track. Read the run contract before round 1; never re-ask items already answered there.

## Procedure

1. **Write the interview plan first.** Before asking anything, write `.opencode/runs/<run>/artifacts/interviews/interview-plan.md`:
   - requirement-gap items — each unresolved decision the mandate leaves open
   - working hypotheses — the plausible answer you would otherwise assume
   - questions — the exact questions that discriminate between hypotheses
   Order gaps by blast radius (data model > server > worker > UI); ask the highest-blast-radius gaps first.
2. **Run 2–4 interviews.** Delegate each round to a `requirements-refiner` subagent; the subagent drives the `question` tool.
   - Batch related questions into one `question` call; one round = one theme, not one question.
   - Always offer a free-text escape option — the user may reject every offered option.
   - On timeout/no answer, re-ask the same round once; if it still stalls, park the run (`supervisor_request_refinement`) — never guess.
   - The Q&A stays in the subagent's context. The conductor receives only the compact contract. Never pull transcripts into the conductor's context.
3. **Document verbatim transcripts incrementally.** After each round, append the exact Q&A to `.opencode/runs/<run>/artifacts/interviews/<round>-<theme>.md`. Verbatim means the user's words unparaphrased, with the question as asked and the answer as given. Write per round — never batch at the end.
4. **Adjudicate every hypothesis.** In `.opencode/runs/<run>/artifacts/interviews/adjudication.md`, mark each hypothesis from the plan:
   - `confirmed` — answer matches; cite the transcript round
   - `refuted` — answer contradicts; cite the transcript round
   - `updated` — answer changes the hypothesis; record the new statement
   No hypothesis is silently dropped. An unanswered hypothesis is `unresolved` and becomes an escalation, not an assumption.
5. **Record the architecture mapping.** For each decision, write the concrete downstream change it implies (`decision → data model / worker / server / route / UI change, file paths`). Flag any decision that implies a breaking change or migration.
6. **Persist via `supervisor_record_requirements`** with a contract addendum:
   - acceptance criteria for the new decisions
   - a breaking-changes/migrations subsection listing every irreversible consequence
   - explicit `deferred` items — a decision the user defers is recorded as deferred, not invented
   Never invent a definition of done. If the user will not decide, the run stays parked.

## Output

| artifact | path | content |
| --- | --- | --- |
| Interview plan | `.opencode/runs/<run>/artifacts/interviews/interview-plan.md` | gaps × hypotheses × questions |
| Transcripts | `.opencode/runs/<run>/artifacts/interviews/<round>-<theme>.md` | verbatim Q&A, one file per round |
| Adjudication log | `.opencode/runs/<run>/artifacts/interviews/adjudication.md` | hypothesis → verdict + evidence |
| Contract addendum | `.opencode/runs/<run>/artifacts/requirements/contract-addendum.md` | acceptance criteria + breaking changes/migrations + deferred |

Return to the conductor only: the addendum path and a compact summary. Never the transcripts.

## Rules

- The user is the sole design authority. Agents propose hypotheses; the user decides.
- Never re-ask a contract item already answered by the user — check the contract before every round.
- Interviews before implementation, always. No code, plan, or task for undecided scope.
- Every hypothesis is adjudicated — confirmed, refuted, updated, or explicitly unresolved. Never silently dropped.
- Breaking decisions are recorded in the addendum before the affected task is created.
- Deferred is a valid outcome. Invented is not.
- Self-improvement: when this skill misfires (missed gap class, bad hypothesis, stalled round), write a proposal to `.opencode/runs/<run>/artifacts/skill-proposals/requirement-interview-<timestamp>.md`. Proposal only — never edit this skill mid-run.
