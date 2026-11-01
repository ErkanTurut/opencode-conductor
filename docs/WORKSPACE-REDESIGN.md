# Conductor workspace redesign

## Authorization and isolation

The user approved the full implementation scope in an isolated checkout on 2026-11-01.
The installed plugin, existing user edits, active runs, ledgers, memory stores, service,
and Desktop app must remain untouched. Do not activate the result or reload a plugin.
Builds and tests run only in the unregistered redesign worktree with temporary fixtures.
Live Desktop sign-off is deferred, not passed.

The panel remains a read-only projection under the repository's safety contract.
Configuration provenance and drafts may be inspected; saving configuration, approving
gates, retrying work, and merging are not panel actions. No new dependencies are authorized.

## Product contract

- Project scope, not inferred conversation ownership.
- Runs opens on active work with useful progress and attention information. Historical
  runs remain reachable through a searchable, sortable, paginated data table.
- Selecting a run opens its complete task graph. Compact task cards open details.
- Every node and dependency remains reachable, including disconnected and ghost nodes.
  Search, filters, zoom, pan, fit, overview, keyboard access, and a list alternative
  must not silently truncate the graph or reset on polling.
- Inspectors distinguish task state, latest attempt, required checks, recorded evidence,
  findings, and approval. Missing or unknown evidence is never a successful gate.
- Native-compatible Markdown/JSONC agent definitions have explicit effective-value
  provenance. Fleet configuration is not an invisible competing model authority.
- Task creation/amendment writes additive graph snapshots; claim and completion validate
  the current revision/policy and recorded checks. This is not a general plan-edit proposal
  API; legacy plan history cannot be reconstructed. A recovered lease does not imply repair.
- Actual claim/completion boundaries enforce their wired checks. Pure candidate-merge and
  governance decisions are contracts only, not an integrated authenticated approval path.
  The display projection never authorizes merge.
- Project policy distinguishes main/development branches and remote actions. External
  host protection and deployment observations are unknown until genuinely verified.
- Memory keeps source/version/review information and exposes stale or unreviewed lessons
  instead of implicitly trusting every persisted block. Automatic learning/promotion and
  evidence revalidation are not integrated; current review classification is conservative.

## Historical evidence informing the work

A bounded read-only sample of Saul run artifacts showed review/repair rounds reopening
after re-review; verification reruns differing from caller-reported checks; infrastructure
timeouts being confused with code failures; integration drift; receipts ending in
nonterminal states after many attempts; and memory proposals awaiting manual promotion.
These are observations from a sample, not prevalence statistics.

Evidence references (not copied into fixtures):

- `run-1791634292599-g3n77r/artifacts/journal.md`: post-repair review and regression loops.
- `run-1793128723248-93is44/artifacts/integration-notes.md`: verification environment/timeout friction.
- `run-1792177166163-aufyrg/receipt.md`: parallel integration and stale-code conflict.
- `run-1792174883959-gw147m/receipt.md`: focused versus full-suite evidence and deferred integration concerns.
- `run-1793128723248-93is44/artifacts/memory-proposals.md`: promotion and reproducibility gaps.

## Design direction

Native Solid/SVG, host typography and themes, compact developer-tool density, restrained
motion. Design dials: variance 3, motion 2, density 8. The supplied UI/UX skill's developer
tool guidance fits; its generated FAQ landing pattern does not. The supplied design-taste
skill explicitly excludes dashboards/data tables, so marketing layouts and dependencies
are not applied. Semantic colors supplement text, not replace it.

## Verification and activation

Required isolated checks:

```sh
bunx tsc -p tsconfig.gui.json --noEmit
bun run gui:build
bun run smoke:gui
bun test
bun run typecheck
bun run build
```

Use the fixture-only preview to check both themes, narrow/bottom-pane sizes, and large graphs.
Run it with `bunx vite --config scripts/gui-preview.config.ts`; it mounts the real plugin entry,
with synthetic host/RPC fixtures and no service reload.
Provider credentials, real deployments, pushes, merges, and authenticated phone review are not
exercised without separate authorization. No fixture result proves these integrations work.
The detected branch policy/JSONC draft is inspectable, but there is no project-config editor,
authenticated approval adapter, deployment webhook, phone endpoint, merge executor, or
authenticated preview provider. New server writes are isolated code only until reviewed and
deployed. The final report must list these limitations explicitly.
