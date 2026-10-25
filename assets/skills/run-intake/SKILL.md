---
name: Run Intake
description: Convert a human request into a structured run contract with acceptance criteria; detect under-specified requests and run a bounded refinement interview
metadata:
  opencode/autoinvoke: false
---

# Run Intake

## Purpose

Normalize a human request into a structured run contract that the supervisor and downstream agents can consume — and decide whether the request needs refinement **before any planning or implementation starts**.

## Definition Quality Assessment

A request is **well-defined** when ALL of these hold:

- A single, explicit objective — what must change and why.
- Verifiable success criteria — measurable or testable, not "make it better".
- Known scope — affected product areas/users, and at least implicit non-goals.
- No contradictions or blocking unknowns.

Otherwise the request is **under-specified**. Never invent the missing pieces yourself: an invented definition of done is the most common cause of a poor feature outcome.

## Refinement Interview (only when under-specified)

1. Ask the user ONE batched `question` call: do they want to go through a quick requirements refinement (recommended), proceed as-is, or cancel?
   - **Refine** → continue.
   - **Proceed as-is** → write the best-effort contract, mark `refinement: declined`, and stop.
   - **Cancel** → report back so the conductor cancels the run.
2. If refining, ask ONE batched `question` call covering the actual gaps:
   - Objective: what must change and why?
   - Target users / audience and their context.
   - Success criteria: how will we know it works?
   - Scope: what is in, what is explicitly out (non-goals)?
   - Constraints: deadlines, tech, budget, compliance.
   - Priority: must-have vs nice-to-have.
   Only ask questions whose answers are not already in the request.
3. If critical gaps remain, one additional batched round is allowed. Max 2 rounds total — never interrogate.

> **Handoff:** if gaps survive the two rounds, or the mandate is multi-track,
> escalate to the `requirement-interview` skill — never run a third round here.

## Output

Write two artifacts into `.opencode/runs/<run-id>/artifacts/requirements/`:

- `requirements.md` — human-readable refined requirements
- `contract.json` — machine-readable contract

```json
{
  "objective": "Add dark mode toggle to settings",
  "non_goals": ["System color scheme detection", "Per-component overrides"],
  "acceptance_criteria": [
    "Toggle in Settings page switches between light and dark themes",
    "Preference persists across page refresh",
    "Tailwind dark: classes applied correctly"
  ],
  "risk_class": "low",
  "constraints": ["No new dependencies"],
  "refinement": {
    "outcome": "completed",
    "qa_pairs": [],
    "requirements_path": ".opencode/runs/<run-id>/artifacts/requirements/requirements.md"
  }
}
```

Then return ONLY a compact summary (objective, acceptance criteria, risk class, open questions) — never the interview transcript.
