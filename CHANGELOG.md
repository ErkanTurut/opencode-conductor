# Changelog

## 1.1.0 — 2026-11-01

### Added

- Eight native Desktop tabs: Runs, DAG, Gates, Refinements, Memory, Routing & timeline,
  Agents, and Project. Runs separates active work from searchable, paginated history; DAGs
  use compact task cards.
- Native agent Markdown editor for model/variant, steps, prompt body, and permissions;
  revision-checked saves preserve unrelated native keys, with confirmation for global edits.
- Project settings editor backed by `.opencode/conductor.json`; startup and run initialization
  consume branches, verification commands, preview awareness, and memory enabled state.
- Four configuration RPC methods: `agentDocument`, `saveAgentConfiguration`,
  `projectSettings`, and `saveProjectSettings`.
- Run initialization returns project context and preview-configuration discovery. Closeout
  records an explicit memory decision; curator handoffs can save immutable, evidence-linked
  proposed project memory versions.

### Changed

- Native OpenCode agent Markdown and JSON/JSONC configuration are authoritative. Registration
  and the runner no longer apply fleet catalog overrides; legacy fleet tools/UI remain a
  separate catalog, not the active runtime model authority. Migrate model choices to native
  agent Markdown.
- GUI writes are limited to the configuration RPCs above. They cannot loosen trust/host
  permissions, approve work, or perform remote actions.

### Release evidence

- `bun test`: 959 passed across 82 files; `bun run typecheck`: 41 existing diagnostics,
  0 new against the recorded baseline; GUI typecheck, GUI build, GUI smoke, and full build
  passed.
- Activated the installed checkout at this commit (preserving existing user edits), restarted
  the service, and confirmed the plugin reports `server`, `rpc`, and `gui` active. The served
  GUI bundle contains the new configuration views.
- Live project reads were checked against real projects. Live agent save, effective host
  reload, project-settings save, preview awareness, and stale-revision refusal were checked
  with temporary files in a trusted project, then removed.
- Manual Desktop panel click-through, provider preview deployments, and remote PRs were not
  exercised. Configuration saves are server-verified; visual Desktop sign-off remains a
  separate check.

## 1.0.1 — 2026-10-30

### Fixed

- Added the **Conductor** launcher to the Desktop session side panel's **+** / **New tab**
  menu. Registering a `Panel` alone does not create a launcher; the new `MenuItem` makes the
  panel discoverable. The command palette entry (`conductor.open`) remains available.
- Pass the current session directory with every Conductor RPC call. The Desktop app's server
  otherwise answers from its global location, which made the panel show **No runs yet** even
  when the project had an active run.
- Updated the install and GUI docs to use the **+** → **Conductor** path.

### Documentation

- Added `AGENTS.md` (fresh-session operating guide and prompt), `CONTRIBUTING.md`,
  `docs/ARCHITECTURE.md`, `docs/GUI-ITERATION.md`, and `docs/RPC.md`.
- Added `scripts/gui-smoke.cjs` and `bun run smoke:gui` to load the built bundle with a fake
  host and verify `Panel`, `Command`, `MenuItem`, `Style`, and the six tab ids.

Install: `opencode plugin add github:ErkanTurut/opencode-conductor#v1.0.1`

## 1.0.0 — 2026-10-30

### Added

- Native OpenCode Desktop GUI (`./gui-experimental`): a read-only **Conductor** side panel
  with Runs, DAG, Gates, Refinements, Memory and Routing & Timeline views.
- Typed RPC contract (`opencode-conductor/rpc`) with ten read-only methods:
  `workspace`, `runs`, `run`, `dag`, `gates`, `refinements`, `memory`, `memoryBlock`,
  `routing`, `timeline`.
- Read-only SQLite reader that never creates or migrates the ledger, and artifact/memory
  readers confined to the resolved state layout.
- Package exports for `./rpc` and `./gui-experimental`, and a prebuilt
  `dist/gui-experimental.cjs` for GitHub installs.

### Changed

- Migrated to the OpenCode 2.2 plugin SDK (`@opencode/plugin@2.2.4`).
- Agents and skills are registered at runtime through `ctx.agent.transform` and
  `ctx.skill.transform`. The default install writes **no** files to
  `~/.config/opencode/agents` or `~/.config/opencode/skills`.
- `Plugin.define` is the server entry point; the old `{ id, setup }` object is gone.
- Agent registration sets the required `name` and no longer forces `editor.default`.
- File materialization is an explicit fallback: `CONDUCTOR_MATERIALIZE=1`.
- `CONDUCTOR_SET_DEFAULT_AGENT=1` opts into setting the runtime default agent.

### Fixed

- Read-only LEDGER reader includes attempt-linked review findings in the run view.
- GUI bundle stays CommonJS and keeps `solid-js`, `effect` and `@opencode/*` external.
- Duplicate `supervisor_*` registration is avoided by removing the project shim as part of
  the migration.

### Migration

See [docs/MIGRATION.md](docs/MIGRATION.md). In short: upgrade to OpenCode 2.2.x, install the
plugin, delete the old generated roster/skills and the project shim, keep
`.opencode/runs`, `.opencode/memory` and `supervisor.db`.

### Known limitations

- The Desktop GUI is experimental in OpenCode 2.2 and may change between releases.
- Costs and token counts are shown only when the ledger recorded them; older runs report
  `usage unavailable`.
- The GUI is read-only in 1.0.0. Approval/retry/launch actions are future work.
