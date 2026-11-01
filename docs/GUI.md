# Conductor Desktop panel

The panel is the read-only observability surface for the conductor. It is a native
OpenCode Desktop GUI contribution (`./gui-experimental`), not a web dashboard.

## Requirements

- OpenCode Desktop **2.2.x**. The GUI SDK (`@opencode/plugin/gui`) is experimental and ships
  with 2.2.
- The plugin is in the **global** `~/.config/opencode/opencode.json(c)` `plugins` list.
  `opencode plugin add` does this.
- The plugin's server part loaded successfully. If the server part fails, the GUI does not
  load.

## Open the panel

- Session side region → **+** → **Conductor**, or
- Command palette → **Open Conductor panel** (`conductor.open`).

The panel follows the current session's project directory. Open it in a session in the
project you want to inspect.

## Views

| Tab | Data | What it answers |
| --- | --- | --- |
| Runs | `workspace`, `runs` | Project totals and loaded active or historical runs, their state and task progress |
| DAG | `run`, `dag`, `gates`, `routing` | Which tasks exist, what depends on what, which wave/layer they are in, and whether the graph is broken |
| Gates | `gates` | Which checks and findings were recorded. Evidence readiness is not merge authorization |
| Refinements | `refinements` | Why the run was parked, what the user was asked, and what contract came back |
| Memory | `memory`, `memoryBlock` | Which durable project lessons exist, at what version/confidence, and when they need review |
| Routing & timeline | `routing`, `timeline` | Which model handled each role/slot, what it cost, and the event sequence |
| Agents | `configuration` | Host-resolved agent values, provenance, model catalog, and local-only JSONC draft |
| Project | `project` | Detected branches, verification profile, governance snapshot and unavailable integrations |

The Runs table filters and sorts loaded rows only. Cursor pagination loads older pages; project
counts are independent of pages loaded. Selecting a run opens its DAG. The graph uses compact task
cards, an inspector, fit/zoom/pan/orientation controls, search/state filters, an overview map, and a
paginated keyboard-accessible task list. Viewport culling and filters never remove task-list access.

Agent configuration drafts are local preview text only. They are not saved or applied. Native
host-resolved system prompts are withheld from RPC because arbitrary prompt text cannot be safely
redacted. OpenCode `steps` is the maximum model-step setting. Skill access uses permission rules;
there is no documented per-agent skill attachment field.

Every view has explicit loading, empty and error states. Unknown or legacy fields render as
`unknown` — the panel never invents a value. Costs that the ledger did not collect render as
`usage unavailable`, not `0`.

## Read-only guarantees

- No approval, retry, pause, resume or launch action exists in the panel.
- A JSONC draft is not persisted. Project policy display does not authorize remote changes.
- Gate `mergeReady` is always false in this read model. Evidence readiness is non-authoritative.
- No authenticated preview adapter, remote protection verifier, or merge executor is connected.
- RPC methods accept only run ids, labels and pagination values. No method accepts a
  filesystem path.
- The server reads through the resolved `StateLayout`; the GUI bundle has no filesystem
  access.
- The SQLite reader opens `readonly: true`, skips migrations, and returns empty results for a
  missing database.

## Refresh

The visible view polls every 3 seconds while mounted. Tab switches keep one mounted render (all tabs
share the `conductor` group), so the selected run survives navigation. Select an objective to open
its DAG; **Runs** returns to the overview. Active and History, search and sorting apply only to
loaded runs. Use **Load more runs** to fetch another cursor page; project totals are independent
of the loaded pages. A directory change clears the prior project and invalidates in-flight reads.

## RPC contract

The typed contract is exported as `opencode-conductor/rpc`:

```ts
import { ConductorRpc } from 'opencode-conductor/rpc'
```

Methods: `workspace`, `configuration`, `project`, `runs`, `run`, `dag`, `gates`, `refinements`,
`memory`, `memoryBlock`, `routing`, `timeline`. Every method returns an envelope:

```ts
{ ok: true, data: T } | { ok: false, error: { code, message } }
```

The server registers the contract with `ctx.rpc.register`. A runtime without `rpc.register`
logs a warning and keeps the `supervisor_*` tools working.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Tab missing | Desktop < 2.2, plugin not in global `plugins`, or server part failed to load |
| Empty panel | Open a session in a project with a ledger; a scratch folder uses the central state home |
| “Could not load data” | The server part is older than the GUI or the RPC registration failed; check the server log |
| Panel disappeared after update | **Settings > Extensions > Plugins** → Reload; the GUI only changes with the package version |
| GUI load failure | The server and tools are unaffected; remove `dist/gui-experimental.cjs` to force the server-only path |
