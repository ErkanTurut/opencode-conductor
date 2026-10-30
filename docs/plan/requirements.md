# Global OpenCode Conductor + GUI — Requirements

Status: agreed 2026-10-30. Implementation target: `opencode-conductor` v1.0.0.

## Goal

Make `opencode-conductor` a single installable OpenCode 2.2.x plugin that gives every project the same
orchestration stack the author uses locally:

- 15-agent roster and 15 workflow skills, registered by the plugin, not copied by hand.
- Durable supervisor tools (`supervisor_*`) with SQLite ledger, leases, fencing tokens, worktrees,
  verification evidence, receipts, trust gate and refinement gate.
- A native OpenCode Desktop GUI panel to inspect runs, the task DAG, validation gates, refinements,
  memory blocks, model routing, costs and the event timeline.
- Project-level state and memory (`.opencode/`), global-only plugin installation.

One install must be enough:

```sh
opencode plugin add github:ErkanTurut/opencode-conductor#v1.0.0
```

## Decisions

| Topic | Decision |
| --- | --- |
| OpenCode target | 2.2.4 (plugin SDK `@opencode/plugin@2.2.4`). The local install is upgraded to 2.2.4. |
| Agent/skill delivery | Runtime registration through `ctx.agent.transform` and `ctx.skill.transform`. No copied files. File materialization becomes an explicit opt-in fallback only. |
| GUI v1 | Read-only observability. No approval/write actions in the GUI. |
| Distribution | GitHub tag and install command. The author pushes; this work does not push or publish to npm. |
| Saul migration | Global-only. Remove local agent/skill copies, the supervisor shim and duplicate permission config. Keep `.opencode/runs`, `.opencode/memory`, `supervisor.db`. |
| State location | Project-level `.opencode/supervisor.db`, `.opencode/runs/`, `.opencode/memory/`. Global config/trust only. |
| Compatibility | Server tools must degrade safely if the GUI or a capability is unavailable. GUI requires OpenCode 2.2.x Desktop. |

## Non-goals (v1)

- No GUI write actions (approve, pause, retry, launch run).
- No npm publication.
- No multi-machine/PostgreSQL backend.
- No redesign of the supervisor state machine or ledger schema.
- No new model providers or fleet changes.

## GUI information architecture (read-only)

The panel lives in a session's side region and follows the current session directory.

1. **Runs** — list of runs with state, risk, mode, progress, timestamps, budget, active lease count.
2. **DAG** — tasks as nodes, dependency edges, state colors, waves/lanes, role/model, attempts, durations.
3. **Gates** — plan/merge approvals, verification commands and exit codes, evidence hashes, review findings.
4. **Refinements** — refinement rounds, questions asked, requirements contract, open questions, decision.
5. **Memory** — project/global blocks, scope, status, confidence, version, review date, content preview.
6. **Routing & timeline** — model/variant per task, attempts, costs/tokens, heartbeat, run events.

Every view is a pure projection of the run directory and SQLite ledger. No writes, no model calls.

## Data sources

- SQLite ledger: runs, work items, attempts, leases, approvals, verification, review findings, budget events,
  merge entries, events.
- Run directory: `run.json`, `plan.json`, `contract.json`, `requirements.md`, `tasks/*/task.json`,
  `tasks/*/evidence.json`, `tasks/*/review.json`, `receipt.md`, `events.ndjson`.
- Memory: `.opencode/memory/**/*.json` and global memory if present.
- Fleet config: package `assets/fleet.json` plus user overrides.

## Acceptance criteria

1. `opencode plugin add github:ErkanTurut/opencode-conductor#v1.0.0` installs one package; after restart the
   `conductor` agent and all roster agents are available in any trusted project without files in
   `~/.config/opencode/agents`.
2. All 15 skills are available from the plugin; no duplicate copies in `~/.config/opencode/skills`.
3. `supervisor_*` tools behave as before; the existing 769-test suite passes (updated where behavior changed).
4. The plugin registers a typed RPC contract and a GUI panel that renders all six views for the current
   project, with empty/error/loading states.
5. The GUI bundle builds as one CommonJS file and loads in OpenCode Desktop 2.2.x.
6. The plugin never writes agents/skills into the user's global config unless the opt-in fallback is set.
7. Saul uses the global plugin: no `.opencode/plugins/supervisor.js`, no duplicated agents/skills, no duplicate
   permission block; runs, memory and ledger are preserved.
8. README documents install, trust, state locations, GUI, migration from 2.1.3, and troubleshooting.
9. `bun test`, `bun run typecheck`, `bun run build`, and the GUI build pass.
10. A `v1.0.0` tag and release notes are prepared locally; the author pushes.

## Security constraints

- GUI is read-only and must not expose secrets, `.env` values, or arbitrary file contents.
- RPC methods accept only a run id and project-scoped identifiers; they never accept a filesystem path.
- All reads are confined to the resolved state layout for the current `ctx.location.directory`.
- The trust gate and policy authority remain server-side and unchanged.
- No new network calls; GUI talks only to its own server through `ctx.client.rpc`.

## Verification

```sh
cd ~/.config/opencode/plugins/opencode-conductor
bun install
bun test
bun run typecheck
bun run build
bun run gui:build
```

Manual smoke test:

1. Start OpenCode Desktop 2.2.x.
2. Open a trusted project.
3. Open the Conductor panel; confirm runs, DAG, gates, refinements, memory, routing render.
4. Restart OpenCode; confirm no agents/skills files were written to `~/.config/opencode`.
