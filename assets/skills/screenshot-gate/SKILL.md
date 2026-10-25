---
name: screenshot-gate
description: "Screenshot-gate harness with hardening appendix: drive the app in a browser, capture per-screen screenshots at defined viewports, gate on visual assertions (broken layout, console errors, missing states), batch per-screen sign-off, and apply hardening checks (a11y contrast, focus, reduced motion, empty/error/loading states). Trigger on 'screenshot gate', 'visual verification', 'per-screen sign-off', 'capture screenshots of every screen', 'visual regression'"
metadata:
  opencode/autoinvoke: false
  audience: test-engineer
---

# Screenshot Gate

## Purpose

Drive the running app in a browser, capture every screen at defined viewports, gate on visual and hardening assertions, and collect per-screen sign-off. Every verdict cites a captured artifact.

## Procedure

1. **Enumerate screens from the route tree.** Walk `src/routes/` file-based routes and derive URLs: `_app.tsx` layout prefix drops, `index` maps to parent path, `$param` routes get a documented sample value. Record the full screen list before capturing anything.
2. **Start the app.** Run the dev server (port 3000). Wait for the ready log, then confirm an HTTP 200 on the root URL. Do not capture against a stale or failed server.
3. **Establish an authenticated session — never hardcode credentials.** Mint with the repo's existing auth helpers: the admin client (`src/lib/supabase/admin.ts`, `getAdminDb` in `src/server/auth-db.server.ts`) creates the gate user (`gate-e2e@reguardian.test`, or a fresh `createUser` with `email_confirm: true`) and issues a magic-link/`generateLink` session; inject it with `@supabase/ssr` `setSession` into a cookie jar (`gate-state.json`) — the auth-t9 / `gate-auth*.mjs` pattern used by prior gates. Secrets and session tokens stay out of artifacts and logs.
4. **Capture at 2 viewports minimum per screen:** `1440x900` (desktop) and `390x844` (mobile). Save PNGs under the run artifacts directory, e.g. `.opencode/runs/<run>/artifacts/screenshots/<screen>-<viewport>-<timestamp>.png`.
5. **Run the hardening appendix per screen:**
   - contrast meets WCAG AA for text and controls;
   - keyboard focus reaches every interactive element in order, focus ring visible;
   - reduced-motion preference disables non-essential animation;
   - empty, error, and loading states render (trigger each, don't assume);
   - no horizontal overflow at narrow width;
   - zero console errors.
6. **Evaluate the gate.** A screen passes only with zero console errors and zero hardening blockers. Record pass/fail and the evidence path per screen/viewport.
7. **Batch sign-off in groups of <=5 screens.** Route sign-off through the conductor's `question` tool: one approve/reject item per screen, batch manifest attached. Hold the batch until every screen has a verdict. Never self-approve.
8. **Convert `reject` verdicts to blocking findings.** Record each via `supervisor_record_finding` (see Output). A rejected screen re-enters closure only after a re-shot capture post-fix; cite the new artifact and resubmit in the next batch.

## Output

Gate report (one row per screen x viewport):

| screen | viewport | pass/fail | evidence path | blockers |
| ------ | -------- | --------- | ------------- | -------- |

Sign-off batch manifest (one per batch, <=5 screens):

```json
{
  "run": "<run-id>",
  "batch": 1,
  "status": "awaiting-human-verdict",
  "screens": [
    {
      "screen": "<route-url>",
      "viewport": "1440x900",
      "verdict": "pass",
      "evidence": "artifacts/screenshots/<screen>-1440x900-<ts>.png",
      "blockers": []
    }
  ]
}
```

Blocking rows — any fail or `reject` verdict — are recorded via `supervisor_record_finding` (one finding per screen, evidence path cited; closure requires the re-shot artifact). If the session lacks the tool, hand the rows to the conductor for recording.

## Rules

- A screen passes only with zero console errors and zero hardening blockers.
- Screenshots are evidence: save under run artifacts and cite exact paths.
- Never mark a screen signed-off without a captured artifact.
- Never hardcode credentials; mint with the admin magic-link pattern (`gate-auth*.mjs` → `gate-state.json`).
- Capture from the integrated branch, not per-task branches.
- Rejections are blocking findings recorded via `supervisor_record_finding`; re-shot closure is mandatory.
- Self-improvement: propose edits to `.opencode/runs/<run>/artifacts/skill-proposals/screenshot-gate-<timestamp>.md`.
