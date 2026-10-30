# Working on opencode-conductor

This repository is an OpenCode 2.2 plugin: a server part, a typed RPC contract, a native
Desktop GUI, and the package assets that define the 15-agent roster and 15 workflow skills.
This file is the operating guide for an AI agent (or a human) starting a fresh session here.

## Read in this order

1. `AGENTS.md` — this file: constraints, commands, file map, iteration loop.
2. `docs/ARCHITECTURE.md` — how the server, RPC, GUI and state fit together.
3. `docs/GUI-ITERATION.md` — the exact loop for changing the panel safely.
4. `docs/RPC.md` — the contract and how to add a method end-to-end.
5. `CONTRIBUTING.md` — human contributor setup, PR checklist, release.
6. `docs/GUI.md` — what each panel tab shows.
7. `docs/MIGRATION.md` — the 2.1.x → 2.2.x install migration.

## What this package is

- **Server part** (`index.ts` → `src/index.ts`): `Plugin.define` from `@opencode/plugin`.
  It registers the `supervisor_*` tools, the 15 agents (`ctx.agent.transform`), the 15 skills
  (`ctx.skill.transform`), and the RPC contract (`ctx.rpc.register`).
- **RPC** (`src/rpc-contract.ts`, `src/rpc/register.ts`): ten read-only methods over the
  project ledger and run artifacts. The GUI is a client of this contract.
- **GUI** (`src/gui.tsx`, `src/gui/**`, built to `dist/gui-experimental.cjs`): a read-only
  OpenCode Desktop side panel with Runs, DAG, Gates, Refinements, Memory, and Routing & Timeline.
- **State** is project-level: `<project>/.opencode/supervisor.db`, `.opencode/runs/`,
  `.opencode/memory/`. A scratch/non-repository directory uses the central home under
  `~/.local/share/opencode-conductor/projects/<slug>-<hash8>/`.

## Commands

```sh
bun install
bun test                                   # 855 tests
bun run typecheck                          # baseline-gated server typecheck
bunx tsc -p tsconfig.gui.json --noEmit     # GUI typecheck
bun run gui:build                          # dist/gui-experimental.cjs
bun run smoke:gui                          # loads the built bundle with a fake host
bun run build                              # CLI + GUI
```

Run all of them before calling a change done. `bun test` must stay green; do not update
`typecheck-baseline.json` unless a genuinely new diagnostic is unavoidable, and explain why.

## Hard constraints

### The GUI is read-only

- No approval, retry, pause, resume, launch, or file-write action in the panel.
- The GUI must not import `bun:sqlite`, `node:fs`, `src/plugin.ts`, `src/ledger/*`, or
  `src/read/*`. It talks to the server only through `ctx.client.rpc(ConductorRpc)`.
- RPC inputs are ids and pagination values only. A method never accepts a filesystem path.
- The server reads through the resolved `StateLayout`; the read-only ledger opens with
  `readonly: true` and never creates or migrates the database.

### Every GUI RPC call must carry the session location

The Desktop app's server otherwise answers from its global location (`/Users/<you>`), which is
why the panel can say **No runs yet** even when the project has an active run.

```ts
const location = () => ({ directory: props.session.directory })
await rpc().runs({ limit: 50 }, { location: location() })
```

Do this for every method: `runs`, `run`, `dag`, `gates`, `refinements`, `memory`,
`memoryBlock`, `routing`, `timeline`. The smoke script checks the bundle shape, not location
wiring; a manual check against a project with runs is still required.

### Do not disturb an active conductor run

- GUI-only changes (`src/gui/**`, `dist/gui-experimental.cjs`) reload the GUI in the Desktop
  window; the server entry does not restart.
- Server/RPC changes (`src/index.ts`, `src/rpc/**`, `src/read/**`, `src/plugin.ts`) can
  reload the plugin. While a conductor run is active, avoid them unless the user explicitly
  accepts the reload. Never use the GUI work as a reason to restart the service.
- Never mutate `.opencode/supervisor.db`, `.opencode/runs/**`, or `.opencode/memory/**` while
  diagnosing a UI issue. Use `sqlite3 -readonly` and plain reads.
- A run in `awaiting_refinement` is parked, not executing. Still do not restart on the
  assumption that it is safe; ask first.

### Dynamic registration, not copies

Agents and skills are registered at runtime. Do not reintroduce file materialization as the
default. The fallback is explicit: `CONDUCTOR_MATERIALIZE=1`. Do not add agent/skill files to
`~/.config/opencode/{agents,skills}` as part of a change.

### No unauthorized release actions

Do not push, publish to npm, rewrite a published tag, or delete project state without explicit
authorization. Tags are prepared locally; the author pushes.

## Repository map

| Path | Responsibility |
| --- | --- |
| `index.ts` | Root mount shim; re-exports `src/index.ts`. |
| `src/index.ts` | `Plugin.define`, `setupConductor`: probe, identity/layout, roster, skills, tools, RPC. |
| `src/plugin.ts` | Supervisor config, ledger/tool registration, the 15 `supervisor_*` tools. |
| `src/register/agents.ts` | Frontmatter parser, fleet model resolution, `ctx.agent.transform` registration. |
| `src/register/skills.ts` | `SKILL.md` loading and `ctx.skill.transform` registration. |
| `src/register/tools.ts` | Trust gate and read-only tool classification. |
| `src/runtime/state-layout.ts` | Single path authority: local vs central ledger/runs/memory. |
| `src/runtime/project.ts` | Project identity record and detection. |
| `src/runtime/trust.ts` | Fail-closed trust grants from `~/.config/opencode/conductor.json`. |
| `src/runtime/policy-authority.ts` | Package + user policy snapshot; project may only tighten. |
| `src/ledger/*` | Authoritative SQLite writes, leases, fencing tokens, events. |
| `src/read/ledger-reader.ts` | Read-only SQLite reader (no migrations, no create). |
| `src/read/artifacts.ts` | Path-confined run artifacts, requirements, memory files. |
| `src/read/projections.ts` | Pure builders for the RPC view shapes. |
| `src/rpc-contract.ts` | The shared `Rpc.define` contract and TypeScript view types. |
| `src/rpc/register.ts` | Binds the contract to the readers; feature-detects `ctx.rpc.register`. |
| `src/gui.tsx` | GUI entry: `Plugin.define`, `Panel`, `Command`, `MenuItem`, `Style`. |
| `src/gui/panel.tsx` | Fetch loop, polling, selected run, tab switch, session location. |
| `src/gui/views/*` | Runs, DAG, Gates, Refinements, Memory, Routing & Timeline. |
| `src/gui/format.ts`, `src/gui/data.ts`, `src/gui/dag-layout.ts` | Pure formatting/defensive parsing/DAG geometry. |
| `assets/agents`, `assets/skills`, `assets/fleet.json` | Runtime roster assets. Must be shipped. |
| `dist/gui-experimental.cjs` | Built CommonJS GUI bundle; committed for GitHub installs. |
| `tests/read`, `tests/rpc`, `tests/gui` | Read-layer, RPC, and GUI helper tests. |
| `scripts/gui-smoke.cjs` | Loads the built bundle with a fake host and checks registrations. |
| `docs/` | Architecture, GUI iteration, RPC, migration, release notes. |

## GUI iteration loop

1. Start from a clean tree: `git status`.
2. Read `docs/GUI-ITERATION.md` for the area you are changing.
3. Edit `src/gui/**` (and `src/rpc-contract.ts` only if the shape changes).
4. `bunx tsc -p tsconfig.gui.json --noEmit`
5. `bun run gui:build`
6. `bun run smoke:gui`
7. In Desktop: **Settings → Extensions → Plugins → conductor → Reload**, or run
   `bun run gui:watch` while iterating.
8. Open the Conductor panel from the session side panel's **+** menu and check the affected
   view with real runs. Use a project that has runs (for example saul).
9. `bun test`, `bun run typecheck`, and `bun run build` before finishing.

## Adding a tab

1. Add the id to `CONDUCTOR_TABS` in `src/gui/panel.tsx` and a title key in `src/gui.tsx`.
2. Add the view component in `src/gui/views/`.
3. Add a `<Match when={activeTab() === 'your-tab'}>` branch in `ConductorPanel`.
4. If it needs new data, add an RPC method (see below) rather than reading files in the GUI.
5. Add a pure helper test if the view has formatting/grouping logic.
6. Run the GUI loop and the full checks.

## Adding an RPC method

1. Add the method to `ConductorRpc.methods` in `src/rpc-contract.ts` with JSON Schema input
   and output, plus TypeScript view types.
2. Build the projection in `src/read/projections.ts` (pure, defensive).
3. Add the reader method in `src/read/ledger-reader.ts` or `src/read/artifacts.ts` (read-only,
   path-confined).
4. Add the handler in `src/rpc/register.ts` with input guards and the `{ ok, data }` envelope.
5. Add a test under `tests/rpc/` and `tests/read/` using a temporary ledger/fixtures.
6. Call it from the GUI with the session location:
   `rpc().yourMethod(input, { location: location() })`.
7. `bun test`, `bun run typecheck`, GUI typecheck, GUI build, smoke.

## Testing rules

- Tests never read live project state. Use `tests/read/seed.ts` or temp directories.
- Read-only tests must prove they do not create or mutate the database.
- DAG tests must cover dangling ids, cycles, self-edges, empty tasks, and depth budgets.
- RPC tests must cover invalid input, unknown run ids, empty results, and envelope shape.
- GUI helper tests cover formatting, defensive parsing, and DAG geometry; the smoke script
  covers bundle loading and registration.

## Common failure modes

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Panel missing from the **+** menu | Only a `Panel` was registered, no `MenuItem` | Add the `session.panel` `MenuItem` in `src/gui.tsx` |
| Panel says **No runs yet** in a project with runs | RPC call omitted the session `location` | Pass `{ location: { directory: props.session.directory } }` |
| Conductor not in Settings → Extensions | Plugin not in global `plugins` or Desktop < 2.2.x | Add the package path to global `opencode.json(c)`; use Desktop 2.2.x |
| `plugin bundle read failed` / 500 on `/api/plugin/gui` | `dist/gui-experimental.cjs` missing or stale | `bun run gui:build`; confirm the file exists |
| Whole plugin reload fails with `path ["name"]` | Another plugin registers a command with `id` instead of `name` | Fix that plugin; see the Carousel example in `docs/GUI-ITERATION.md` |
| Duplicate `supervisor_*` tools | Old project shim + global plugin both loaded | Remove `.opencode/plugins/supervisor.js`; keep one plugin entry |
| GUI loads but no data and no error | Wrong project/ledger (central vs local) | Check `workspace` RPC `projectRoot`/`ledgerPath`; use the session location |

## Fresh-session prompt

Copy this into a new OpenCode session:

```text
Work in ~/.config/opencode/plugins/opencode-conductor.
Read AGENTS.md, docs/ARCHITECTURE.md, docs/GUI-ITERATION.md, and docs/RPC.md first.

Task: <describe the GUI change or bug>

Constraints:
- GUI is read-only; no writes, approvals, retries, or filesystem access in the panel.
- Every GUI RPC call must pass { location: { directory: props.session.directory } }.
- Do not restart the server or mutate .opencode/supervisor.db / runs / memory.
- Do not modify server/RPC code while a conductor run is active unless I explicitly approve.
- Keep the existing file structure and style; no new dependencies without a reason.

Verify:
bun test
bun run typecheck
bunx tsc -p tsconfig.gui.json --noEmit
bun run gui:build
bun run smoke:gui
```

## Release

- Bump `package.json` and `CHANGELOG.md` for a behavior change.
- `bun run build` (rebuilds the committed GUI bundle).
- Commit and tag locally; do not push or rewrite a published tag without authorization.
- `v1.0.0` is the published baseline; `v1.0.1` is the launcher + session-location fix.
  Install with `opencode plugin add github:ErkanTurut/opencode-conductor#v1.0.1`.
