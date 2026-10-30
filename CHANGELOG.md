# Changelog

## 1.0.1 — 2026-10-30

### Fixed

- Added the **Conductor** launcher to the Desktop session side panel's **+** / **New tab**
  menu. Registering a `Panel` alone does not create a launcher; the new `MenuItem` makes the
  panel discoverable. The command palette entry (`conductor.open`) remains available.
- Updated the install and GUI docs to use the **+** → **Conductor** path.

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
