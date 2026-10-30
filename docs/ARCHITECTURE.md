# Architecture

The package has three executable surfaces and one shared state authority.

```text
OpenCode Desktop 2.2.x
│
├─ Server part  (index.ts → src/index.ts → Plugin.define)
│   ├─ runtime probe / project identity / StateLayout
│   ├─ dynamic roster: 15 agents (ctx.agent.transform)
│   ├─ dynamic skills: 15 skills (ctx.skill.transform)
│   ├─ supervisor tools: 15 tools + trust/policy gates
│   └─ RPC: ctx.rpc.register(ConductorRpc)
│
├─ RPC contract (src/rpc-contract.ts)
│   └─ ten read-only methods over the ledger + run artifacts
│
└─ GUI bundle (dist/gui-experimental.cjs)
    ├─ Panel: six tabs
    ├─ Command: conductor.open
    ├─ MenuItem: + / New tab launcher
    └─ ctx.client.rpc(ConductorRpc) with the session directory
```

## Why the split

The server owns authority: tool registration, trust, policy, the SQLite ledger, leases, and
writes. The GUI is a read-only projection. It receives no filesystem handle and cannot mutate a
run. The RPC contract is the only boundary between them, so a GUI bug cannot corrupt state and
the server tools keep working if the GUI fails to load.

## Server lifecycle

`index.ts` is the package root mount point. It re-exports `src/index.ts`, which defines the
plugin with `Plugin.define` from `@opencode/plugin`.

`setupConductor` runs in this order:

1. Resolve the project location (`ctx.location.project.canonical ?? ctx.location.directory`)
   and the `StateLayout` (`mode: 'auto'`).
2. Probe the runtime (Bun, `bun:sqlite`, Bun shell, Node builtins). On failure, register only
   `supervisor_doctor` and stop.
3. Register the 15 agents through `ctx.agent.transform`. The transform sets `name = id`,
   description, mode, system, model/variant from `assets/fleet.json`, steps, and permissions.
4. Register the 15 skills through `ctx.skill.transform` with `path` + `content` from
   `assets/skills/<id>/SKILL.md`.
5. Resolve the policy authority and trust. Mutating tools refuse without a trust grant.
6. Register the `supervisor_*` tool set (with the policy/trust gates).
7. Register the RPC contract (`ctx.rpc.register`). This is last and feature-detected: a host
   without `ctx.rpc` logs a warning and keeps the tools.

The file fallback (`CONDUCTOR_MATERIALIZE=1`) writes agents/skills to the global config. It is
not the default.

## State layout

`src/runtime/state-layout.ts` is the single path authority.

| Mode | Ledger | Runs | Memory |
| --- | --- | --- | --- |
| `local` | `<project>/.opencode/supervisor.db` | `<project>/.opencode/runs` | `<project>/.opencode/memory` |
| `central` | `~/.local/share/opencode-conductor/projects/<slug>-<hash8>/supervisor.db` | `.../runs` | `.../memory` |

`mode: 'auto'` keeps local state when the project already owns a ledger or a non-empty runs
directory; otherwise it uses the central home. A linked git worktree collapses to its main
worktree root for the ledger key.

The RPC handlers close over the resolved `StateLayout`. They never accept a filesystem path.

## Read layer

| Module | Responsibility |
| --- | --- |
| `src/read/ledger-reader.ts` | Opens SQLite with `{ readonly: true }`; never creates or migrates. Row readers for runs, tasks, attempts, leases, approvals, verifications, findings, events, costs. |
| `src/read/artifacts.ts` | Path-confined run directory reads (`run.json`, `plan.json`, `task-dag.json`, `contract.json`, `requirements.md`, `tasks/*`, `receipt.md`) and memory block discovery. |
| `src/read/projections.ts` | Pure builders for the exact RPC view shapes: workspace, runs, run detail, DAG, gates, refinements, memory, routing, timeline. |

Every reader is fail-soft: missing files, malformed JSON, dangling dependency ids, cycles, and
legacy attempt states become empty/`unknown` values, never exceptions.

## RPC

`src/rpc-contract.ts` is the single source of method names and view types. It is exported as
`opencode-conductor/rpc` and imported by the GUI bundle. It imports only
`@opencode/plugin/rpc`, never server code.

`src/rpc/register.ts` binds the contract to the readers. Every handler:

- narrows `unknown` input with small guards (ids, labels, pagination only);
- reads through the closed-over layout;
- returns `{ ok: true, data }` or `{ ok: false, error: { code, message } }`;
- is wrapped in `try/catch` so a corrupt row cannot take the server down.

Ten methods:

| Method | Kind | Input | Output |
| --- | --- | --- | --- |
| `workspace` | read | `{}` | project identity, layout, trust, policy, counts |
| `runs` | read | `{ limit?, cursor?, states? }` | run summaries + cursor |
| `run` | read | `{ runId }` | summary, contract, budget, plan, tasks, attempts, leases, approvals |
| `dag` | read | `{ runId }` | nodes, edges, layers, roots/leaves, dangling ids, cycles, depth |
| `gates` | read | `{ runId }` | approvals, per-task verification evidence, findings, merge-ready |
| `refinements` | read | `{ runId }` | state, uncertainties, Q&A, requirements, refinement events |
| `memory` | read | `{ limit? }` | block summaries |
| `memoryBlock` | read | `{ label, version? }` | full block |
| `routing` | read | `{ runId? }` | fleet assignments, observed routes, costs/usage |
| `timeline` | read | `{ runId, afterSequence?, limit? }` | event page, last sequence, truncated |

### Location scoping

The Desktop app's server has a global plugin instance at `/Users/<you>` and per-session
locations. An RPC call without a location reads the global instance and shows no project runs.
Every GUI call must pass:

```ts
{ location: { directory: props.session.directory } }
```

The server serializes that as `location[directory]`. Verified against a real server: the same
method returns the project's ledger and runs when the location is present.

## GUI

`src/gui.tsx` is the default export (`Plugin.define` from `@opencode/plugin/gui`). It registers:

- `Panel` id `conductor`, side region, six tabs in one `group: "conductor"` render;
- `Command` id `open` (`conductor.open`) to toggle the panel;
- `MenuItem` `session.panel` to make the panel appear in the **+ / New tab** launcher;
- `Style` with the panel CSS.

`src/gui/panel.tsx` owns the data loop:

- selected run signal, polling every 3 seconds, loading/error/empty states;
- one RPC client per call with the session location;
- a `Switch` over the six tab ids.

Views are pure render functions over the RPC shapes. `format.ts`, `data.ts`, and `dag-layout.ts`
are pure helpers and are unit-tested without a DOM.

## Packaging

```json
{
  "exports": {
    ".": "./index.ts",
    "./rpc": "./src/rpc-contract.ts",
    "./gui-experimental": "./dist/gui-experimental.cjs"
  }
}
```

`dist/gui-experimental.cjs` is built by Vite with the `gui()` preset from
`@opencode/plugin/gui/vite` and is **committed**, because a GitHub install clones the repository
without running a build. The GUI bundle keeps `effect`, `solid-js`, and `@opencode/*` external;
the Desktop app provides them.

`assets/` must ship: agents, skills, and `fleet.json`. Without `assets/`, a GitHub install has
no roster.

## Security invariants

- The GUI is read-only; no write verbs, no model calls, no filesystem access.
- RPC methods accept ids, labels, and pagination only. No paths.
- Reads are confined to the `StateLayout`; `..`, absolute paths, and symlink escapes are
  rejected by the artifact reader.
- The ledger is opened read-only; missing databases are not created.
- The trust gate and policy authority remain server-side. The GUI shows state but cannot
  approve a gate or release a lease.
- Secrets (`.env*`, `*.key`, `.secrets/**`) are denied by the shipped policy.

## Where to change what

| Change | Files |
| --- | --- |
| New panel tab | `src/gui.tsx`, `src/gui/panel.tsx`, `src/gui/views/<name>.tsx` |
| New RPC method | `src/rpc-contract.ts`, `src/rpc/register.ts`, `src/read/*`, `tests/rpc`, `tests/read` |
| New supervisor tool | `src/plugin.ts`, `src/register/tools.ts`, `tests/register` |
| Agent/skill content | `assets/agents/*.md`, `assets/skills/*/SKILL.md` |
| State layout | `src/runtime/state-layout.ts`, `tests/runtime` |
| Trust/policy | `src/runtime/trust.ts`, `src/runtime/policy-authority.ts`, `tests/security` |
| Install/docs | `README.md`, `docs/*`, `CHANGELOG.md` |
