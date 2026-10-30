# opencode-conductor

A self-orchestrating multi-model pipeline for [OpenCode](https://opencode.ai): durable runs,
per-project state, a 15-agent roster, 15 workflow skills, a 15-tool supervisor, and a native
read-only Desktop panel for the DAG, gates, refinements, memory, routing and timeline.

One install gives you the whole stack. Agents and skills are registered by the plugin at
runtime; nothing is copied into your global `agents/` or `skills/` directories.

> **Requirements:** OpenCode **2.2.x** (CLI and Desktop). The GUI part uses the
> `@opencode/plugin/gui` SDK introduced in 2.2. On 2.1.x the server tools may load, but the
> roster, skills and panel do not.

## Install

```sh
opencode plugin add github:ErkanTurut/opencode-conductor#v1.0.0
```

Then restart OpenCode. The plugin is global: it loads in every project.

For the panel, update **OpenCode Desktop** to 2.2.x. The Desktop app has its own updater;
upgrading the CLI alone does not upgrade the app. The app loads the GUI from its own server,
so the plugin must be in your global `~/.config/opencode/opencode.json(c)` `plugins` list
(`opencode plugin add` does that) and **Settings > Extensions > Plugins** must show it.

## Quick start

1. Trust the project. Conductor is fail-closed: mutating tools refuse in an untrusted folder.
   Add a grant to `~/.config/opencode/conductor.json`:

   ```json
   {
     "trust": {
       "default": "deny",
       "grants": [
         { "path": "/absolute/path/to/project", "grantedAt": "2026-10-30T00:00:00Z" }
       ]
     }
   }
   ```

2. Open a session in the project. The `conductor` agent and the roster are available.
3. Open the **Conductor** panel from the session side region (or run the `conductor.open`
   command). The panel follows the current session's project directory.

## What you get

| Surface | Contents |
| --- | --- |
| Agents | `conductor`, `scout`, `external-scout`, `architect`, `coder`, `frontend-specialist`, `test-engineer`, `build-verifier`, `critic`, `security-critic`, `integrator`, `memory-curator`, `requirements-refiner`, `visual-sketch-translator`, `writing-reviewer` |
| Skills | `run-intake`, `context-discovery`, `task-contract`, `deterministic-validation`, `adversarial-review`, `closeout`, `memory-curation`, `supervisor-orchestrate`, `requirement-interview`, `integration-ledger`, `claims-audit`, `copy-truth`, `fixture-rls-repair`, `screenshot-gate`, `union-merge` |
| Tools | 15 `supervisor_*` tools: durable runs, refinement gate, task DAG, claims, leases, verification evidence, findings, worktrees, receipts, cancellation, patrol, sweep, doctor |
| GUI | Six read-only tabs: **Runs**, **DAG**, **Gates**, **Refinements**, **Memory**, **Routing & timeline** |
| RPC | Typed `opencode-conductor/rpc` contract, available to other plugins and clients |

## State and memory

State is project-level by default. Nothing is written into your global config except the
plugin install, trust grants and (optionally) the fallback roster.

| Data | Location |
| --- | --- |
| Run ledger (SQLite) | `<project>/.opencode/supervisor.db` |
| Run artifacts | `<project>/.opencode/runs/<run-id>/` |
| Project memory | `<project>/.opencode/memory/` |
| Trust grants | `~/.config/opencode/conductor.json` |
| Project record | `.opencode/project.json` when the project already owns a ledger |

For a directory with no `.opencode` ledger (a scratch folder or a non-repository), the plugin
uses the central home:

```text
~/.local/share/opencode-conductor/projects/<slug>-<hash8>/
  supervisor.db
  runs/
  memory/
  project.json
```

`OPENCODE_CONDUCTOR_HOME` overrides the central root.

### Runtime registration, not copies

The default path is `ctx.agent.transform` and `ctx.skill.transform`. On OpenCode 2.2.x this
registers the roster and skills in memory; no files appear in `~/.config/opencode/agents` or
`~/.config/opencode/skills`.

Two explicit escape hatches:

```sh
# Only if the host cannot register agents/skills at runtime.
CONDUCTOR_MATERIALIZE=1

# Force the conductor as the default agent (otherwise your config owns it).
CONDUCTOR_SET_DEFAULT_AGENT=1
```

## Desktop panel

The panel is a read-only projection of the run ledger and run directory. It never runs a
model, writes a run, approves a gate or launches work.

| Tab | Shows |
| --- | --- |
| Runs | State, risk, mode, objective, task progress, timestamps, receipt flag, live leases |
| DAG | Tasks, dependency edges, waves/layers, role/model, attempts, dangling ids, cycles |
| Gates | Plan/merge approvals, verification commands and exit codes, evidence hashes, blocking findings |
| Refinements | Refinement state, uncertainties, Q&A, requirements contract, open questions |
| Memory | Project/global blocks, versions, scope, status, confidence, review date, full content |
| Routing & timeline | Fleet assignments, observed model routes, tokens/costs (or “usage unavailable”), event timeline |

The panel polls every three seconds. Every view has loading, empty and error states. If the
GUI bundle cannot load, the `supervisor_*` tools continue to work.

## Trust and policy

- Mutating tools refuse in a folder without a grant (`untrusted_project`).
- The policy authority comes from the package and your user config; a project's
  `opencode.json` may tighten it, never loosen it.
- A restricted policy authority turns mutating tools into readable refusals
  (`policy_restricted`) while read-only tools keep working.
- Secrets are denied by the shipped policy: `.env*`, `*.key`, `.secrets/**`, `git push`,
  destructive git commands, `sudo`, `chmod`, `chown`.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Panel is missing | Desktop must be 2.2.x; the plugin must be in global `plugins`; check **Settings > Extensions > Plugins** |
| Roster is missing | Run on OpenCode 2.2.x; check `supervisor_doctor`; remove stale copies from `~/.config/opencode/agents` and `skills` |
| `untrusted_project` | Add the project to `~/.config/opencode/conductor.json` |
| `policy_restricted` | Fix the policy configuration and rerun `supervisor_doctor` |
| Two copies of `supervisor_*` | Remove the old project shim (`.opencode/plugins/supervisor.js`) and any duplicate plugin entry |
| No runs in a scratch folder | State is central there; use a git repository or set `OPENCODE_CONDUCTOR_HOME` |

## Migration from a 2.1.x materialized setup

The short version: delete the generated global roster/skills and the project shim, keep
`.opencode/runs`, `.opencode/memory` and `supervisor.db`, and let the 2.2 plugin register
everything. Full steps are in [docs/MIGRATION.md](docs/MIGRATION.md).

## Development

```sh
bun install
bun test                  # 855 tests
bun run typecheck         # baseline-gated tsc
bun run gui:build         # dist/gui-experimental.cjs
bun run build             # CLI + GUI
```

The GUI bundle is committed (`dist/gui-experimental.cjs`) because a GitHub install clones the
repository without running a build. Local plugin development: keep the package under
`~/.config/opencode/plugins/opencode-conductor` (auto-discovered) or add its absolute path to
the global `plugins` list.

## License

MIT. See [LICENSE](LICENSE).
