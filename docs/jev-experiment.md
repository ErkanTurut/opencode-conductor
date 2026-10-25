# JEV Experiment

Status: toggle OFF by default. No live calls without explicit opt-in.

## 1. What Jev is

- Model ref: `typesafe-ai/jev` (System-One judge ensemble).
- Verdict shapes: Choice (categorical winner + per-choice probabilities),
  Score (numeric score + per-band probabilities), Noul/boolean (probability).
- Latency: ~100ms per evaluate call (fast enough for inline gates).
- Pricing: free tier while available, then ~$0.042/M tokens post-free.
- Context cap: 32K (supervisor additionally caps serialized state via
  `maxStateChars`, default 20000, and per-field builder cap 4000).
- Language: text-only, English-best. All judge-facing instructions are
  English (`Respond in English`) even when the state payload contains
  other languages. See `src/jev/questions.ts`.

## 2. Toggle design

Precedence (lowest to highest):

1. Built-in defaults in `src/jev/config.ts` (`DEFAULT_JEV_CONFIG`).
2. `config/jev.json` file (copy from `config/jev.json.example`).
3. `JEV_*` env vars.
4. Per-run override argument to `loadJevConfig()` / explicit boolean to
   `isJevEnabled()`.

Defaults are OFF:

```json
{
  "enabled": false,
  "model": "typesafe-ai/jev",
  "timeoutMs": 4000,
  "maxStateChars": 20000,
  "thresholds": {
    "severityMin": 0.7,
    "severityUpgradeMin": 0.85,
    "contractScoreMin": 2.5,
    "verifiableMin": 0.7,
    "riskyMin": 0.85,
    "needsHumanMin": 0.75
  },
  "budget": { "maxCallsPerRun": 20, "maxInputTokensPerRun": 200000 },
  "zeroDataRetention": true
}
```

Env overrides:

| Env var                          | Maps to               |
| -------------------------------- | --------------------- |
| `JEV_ENABLED=1`                  | `enabled`             |
| `JEV_MODEL`                      | `model`               |
| `JEV_TIMEOUT_MS` (`JEV_TIMEOUT`) | `timeoutMs`           |
| `JEV_MAX_STATE_CHARS`            | `maxStateChars`       |
| `JEV_SEVERITY_THRESHOLD`         | `thresholds.severityMin` |
| `JEV_SEVERITY_UPGRADE_THRESHOLD` | `thresholds.severityUpgradeMin` |
| `JEV_CONTRACT_SCORE_THRESHOLD`   | `thresholds.contractScoreMin` |
| `JEV_VERIFIABLE_THRESHOLD`       | `thresholds.verifiableMin` |
| `JEV_RISKY_THRESHOLD`            | `thresholds.riskyMin` |
| `JEV_NEEDS_HUMAN_THRESHOLD`      | `thresholds.needsHumanMin` |
| `JEV_MAX_CALLS_PER_RUN`          | `budget.maxCallsPerRun` |
| `JEV_MAX_INPUT_TOKENS_PER_RUN`   | `budget.maxInputTokensPerRun` |
| `JEV_ZERO_DATA_RETENTION`        | `zeroDataRetention`   |
| `JEV_CONFIG_PATH`                | config file path      |

Per-run override wins: `loadJevConfig(path, { enabled: true })` beats
env; `isJevEnabled(false)` always returns `false` (fail-closed on config
load errors).

Disabled means zero fetch: `evaluateWithJev()` checks `isJevEnabled()`
then the merged config before touching `fetch`. When disabled it returns
`{ ok: false, reason: 'disabled' }` without calling fetch. Gates treat
missing answers as fail-open `skipped` (see IP-1/IP-2/IP-3 below).
Covered by `tests/jev-e2e.test.ts` Test A and
`tests/jev-client.test.ts` disabled case.

## 3. Insertion points

### IP-1 — Severity calibration (`calibrateSeverity`)

- Input: finding `{ severity, blocking }` + JEV `severity` choice and
  `blocking` hint built by `buildSeverityQuestions()`.
- Banded auto-override:
  - Confidence `< severityMin` (default 0.70) -> `low_confidence`,
    original kept.
  - Same severity -> `applied` (confirmation).
  - Lateral info/low/medium moves at `>= 0.70` -> `applied`.
  - Upgrade to high/critical needs `>= severityUpgradeMin` (default
    0.85); below that -> `advisory`, original kept. Applied upgrades
    flip `blocking` to `true`.
  - Any downgrade from high/critical -> `advisory` always; a `true`
    blocking is never auto-unblocked.
- Null/undefined answers -> `skipped`, original kept (fail-open).

### IP-2 — Contract assessment (`assessContract`)

- Input: task contract + JEV `complete` choice
  (vague/partial/good/excellent) and `verifiable` probability built by
  `buildContractQuestions()`.
- NEVER blocks: always returns `{ proceed: true }`. Risk surfaces as a
  `contract_warning` annotation when completeness is vague/partial or
  `verifiable < verifiableMin` (default 0.70); otherwise `applied`.
- Null answers -> `skipped`, still `proceed: true`.

### IP-3 — Safety assessment (`assessSafety`)

- Input: plan `{ objective, pending_mutations, ... }` + JEV `risky`
  probability and `needs_human` choice (auto/peer/human) built by
  `buildSafetyQuestions()`.
- Escalate ONLY on high-confidence unsafe: `risky >= riskyMin`
  (default 0.85) AND `needs_human` choice is `human` with
  `human >= needsHumanMin` (default 0.75) -> `{ escalate: true,
  jev_status: 'escalated' }` (fail-closed).
- Everything else fail-open: `{ escalate: false }`, annotation
  `applied` for judged-safe, `skipped` for null/malformed answers.
  Malformed input never throws and never escalates; the policy layer
  (`policy.ts`) remains authoritative.

## 4. How to spike while free

Do NOT commit the spike script. Document only.

Live spike via curl:

```bash
curl -sS -X POST https://ai-gateway.vercel.sh/v1/evaluate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AI_GATEWAY_API_KEY" \
  -d '{
    "model": "typesafe-ai/jev",
    "state": "{\"title\":\"demo finding\"}",
    "questions": {
      "severity": {"type": "choice", "instructions": "Rate severity. Respond in English."}
    },
    "providerOptions": {"gateway": {"zeroDataRetention": true, "only": ["typesafe-ai"]}}
  }'
```

Or a throwaway local script (never commit) e.g.
`bun scripts/jev-spike.ts`, which loads the`build*Questions()` bundle,
calls `evaluateWithJev()` with `JEV_ENABLED=1` + `AI_GATEWAY_API_KEY`
set, and prints the answers plus the gate annotation. Delete after the
spike; the hermetic E2E suite (`tests/jev-e2e.test.ts`) is the durable
artifact, not the spike script.

## 5. Free-tier expiry runbook

- Gateway signals: HTTP `402` (or body containing `payment_required`)
  -> `{ ok: false, reason: 'billing' }`; HTTP `429` ->
  `{ ok: false, reason: 'rate_limited' }`. Both open the in-memory
  circuit (`jevCircuitOpen = true`); subsequent calls return
  `{ ok: false, reason: 'circuit_open' }` without fetch.
- On `billing`/`rate_limited`: log `jev_disabled_billing` (with status
  and reason, no payload), continue degraded (gates see null answers ->
  `skipped` / fail-open, policy layer decides), do NOT retry in a hot
  loop.
- Re-enable only via explicit flag: clear the circuit with
  `resetJevCircuitForTests()` (tests) or restart the process with a
  deliberate `JEV_ENABLED=1` after confirming quota. Never auto-reset
  the circuit on success path.
- Budget: `budget.maxCallsPerRun` default 20. Pass a shared
  `{ calls }` tracker via `evaluateWithJev(..., { budgetTracker })`;
  at/over budget returns `{ ok: false, reason: 'budget_exceeded' }`
  without fetch. Timeouts (`timeoutMs` default 4000) return
  `{ ok: false, reason: 'timeout' }`.

## 6. Approvals and data hygiene

- Human approval required before `JEV_ENABLED=true` in any shared
  environment. Local spikes stay on the operator's own key and quota.
- Secrets redaction: every state payload passes through `stripSecrets()`
  (api_key/token/secret/password/authorization variants, whole-subtree
  replacement with `[REDACTED]`, long-string truncation) before
  serialization, plus the `maxStateChars` cap.
- `zeroDataRetention` defaults to `true` and `only: ['typesafe-ai']` is
  sent on every gateway call (`providerOptions.gateway`). No other provider
  may receive supervisor state.
- ZDR opt-out (hobby): ZDR requires a Vercel Pro/Enterprise plan — hobby
  teams get HTTP 403 `ZdrUnauthorizedError`. For hobby, set
  `"zeroDataRetention": false` in `config/jev.json` (or
  `JEV_ZERO_DATA_RETENTION=0`). Explicit `false` is now honoured when
  enabled (default stays `true`). `stripSecrets()` redaction,
  `maxStateChars` cap, and `only: ['typesafe-ai']` still apply, but the
  provider may retain payloads — operator decision, human-approved.

## 7. E2E results

Command:

```bash
cd tools/opencode-supervisor && bun test tests/jev-e2e.test.ts tests/jev-gates.test.ts tests/jev-config.test.ts tests/jev-client.test.ts tests/jev-questions.test.ts
```

Last run (2026-09-19, hermetic, no live network):

- 65 pass, 0 fail, 298 expect() calls across 5 files.
- `tests/jev-e2e.test.ts`: 5 pass (Test A disabled zero-fetch + fail-open,
  Test B IP-1 medium->high 0.90 applied + blocking, Test C IP-2 vague +
  verifiable 0.3 contract_warning never blocks, Test D IP-3 risky 0.92 +
  human 0.80 escalates and safe plan does not).
- `tests/jev-gates.test.ts`: 23 pass.
- `tests/jev-client.test.ts`: 6 pass.
- `tests/jev-config.test.ts`: 12 pass.
- `tests/jev-questions.test.ts`: 19 pass.

## 8. ZDR opt-out + hermetic tests (2026-09-20)

- Removed the force-`true` ZDR invariant in `src/jev/config.ts`
  (`validateJevConfig` + `loadJevConfig` no longer coerce an explicit
  `false` back to `true`). Default remains `true`.
- Live verification (hobby team, balance $5, no ZDR): direct
  `POST /v1/evaluate` succeeds; `evaluateWithJev()` with
  `zeroDataRetention:false` returns `{ ok: true }` (severity info,
  blocking probability). With ZDR `true` on hobby: 403 as above.
- Hermetic isolation: all `clearJevEnv()` helpers now set
  `JEV_CONFIG_PATH` to a guaranteed-missing temp path, so a local
  `config/jev.json` (`enabled:true`) no longer leaks into unit tests.
- New tests: `jev-config` ZDR opt-out (validate/load honour `false`,
  defaults stay `true`), `jev-client` forwards explicit
  `JEV_ZERO_DATA_RETENTION=0` as `false`, `jev-env-case` lowercase
  opt-out expectation updated from forced-`true` to honoured-`false`.
- Last run (2026-09-20, hermetic + live spike): 116 pass, 0 fail,
  412 expect() calls across 9 files
  (`jev-config`, `jev-client`, `jev-gates`, `jev-questions`, `jev-e2e`,
  `jev-ledger`, `runner-contract`, `jev-env-case`, `jev-policy`).
