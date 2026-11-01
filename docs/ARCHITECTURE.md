# Architecture

The package comprises the OpenCode server plugin, typed RPC, native Desktop panel, durable
project state, and packaged agent/skill assets. The server is authoritative for tools, trust,
configuration writes, ledger and run operations; the GUI calls `ConductorRpc` with the current
session directory.

## Runtime and authority

`src/index.ts` resolves project identity and state layout, probes runtime support, loads agent
Markdown and skills, registers tools, and registers RPC. Native OpenCode agent Markdown and
host-resolved `opencode.json`/`opencode.jsonc` are the active agent configuration authority.
The runner/registration do not apply fleet catalog overrides. Fleet tooling/UI remain separate
catalog facilities; use native Markdown for active model/variant settings.

Project operational settings live at `.opencode/conductor.json`: branches, verification
commands, preview hints, and memory enabled state. They are loaded at startup and supplied to
run initialization. User trust and permission policy remain separate user-authority inputs;
project operational settings cannot loosen them.

State uses `<project>/.opencode/{supervisor.db,runs/,memory/}` where the project owns state;
scratch directories may use the central `~/.local/share/opencode-conductor/projects/` layout.

## RPC and configuration store

Read projections remain confined to resolved state layout. Four additional configuration
methods read or save native configuration: `agentDocument`, `saveAgentConfiguration`,
`projectSettings`, and `saveProjectSettings`. Writes validate and target only the fixed native
paths; revision tokens detect stale edits. Atomic replacement and path/symlink checks protect
the save path. Agent updates alter only selected native fields, preserving unrelated frontmatter
and prompt text; project settings merge their known fields into existing JSON. A saved write
is not proof the host reloaded or that it took effect under native precedence.

No GUI path input exists. RPC registration closes over server-resolved project/config
locations. The GUI never imports server filesystem, database, or ledger modules.

## GUI

Eight native tabs: Runs, DAG, Gates, Refinements, Memory, Routing & timeline, Agents, Project.
Runs presents active and historical work; DAG uses compact task cards. The Agents/Project tabs
are limited configuration editors, the only GUI writes; they do not execute work or authorize
trust, permissions, deployment, push, PR, or merge.

## Preview and release flow

Run initialization returns project context with branch/verification profile, memory state, and
local preview configuration discovery. Local Vercel markers/configuration are hints only. There
is no provider adapter, deployment verifier, remote-protection verifier, PR creator, or merge
executor. Intended sequence is human-approved worktree, approved push to development, verification
of the exact pushed commit's preview, user review, then development-to-main PR; no automatic PR
or merge.

## Closeout and memory

Receipts require a memory decision and rationale, including terminal failure/cancellation.
Disabled settings record `disabled`. A curate decision invokes a handoff for a memory-curator
to inspect relevant run artifacts and existing project memory. A proposal or explicit
`curator_no_learning` result is required. Proposals are path-confined, bounded, sensitive-data
checked, immutable versioned project blocks with `proposed` status; no automatic promotion.

## Release evidence

v1.1.0 tests, typechecks, builds, live plugin activation and configuration RPC checks passed
on 2026-11-01. Manual Desktop click-through was not performed. Do not infer provider deployment
or remote merge evidence from this architecture description.
