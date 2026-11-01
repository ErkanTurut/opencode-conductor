# Conductor RPC

The contract is `src/rpc-contract.ts`, exported as `opencode-conductor/rpc`. Handlers return
`{ ok: true, data }` or `{ ok: false, error: { code, message } }`. Calls are scoped to the
session location. RPC inputs never accept filesystem paths.

## Methods

Read methods: `workspace`, `configuration`, `project`, `runs`, `run`, `dag`, `gates`,
`refinements`, `memory`, `memoryBlock`, `routing`, and `timeline`.

Configuration methods (the only GUI write surface):

| Method | Input purpose | Effect |
|---|---|---|
| `agentDocument` | Agent ID and `project`/`global` scope | Read allowlisted fields, target, revision and warnings. |
| `saveAgentConfiguration` | Agent ID/scope, expected revision, edited fields | Revision-checked update to fixed native Markdown target. |
| `projectSettings` | Empty input | Read `.opencode/conductor.json` operational settings and revision. |
| `saveProjectSettings` | Expected revision and settings | Revision-checked update to fixed project settings target. |

Writes validate fields, use fixed targets, reject symlinked paths, and fail on revision conflict.
Agent writes preserve unrelated frontmatter and prompt body; project writes preserve unrelated
JSON keys. Global edits require GUI confirmation. Host permission authority and trust are not
weakened by these writes. A write response confirms the file save only; host reload/application
must be verified separately. No arbitrary path or remote-action RPC exists.

`configuration` reflects host-resolved allowlisted values when available; arbitrary native
system text is withheld from this snapshot. `agentDocument` is the specific editor read surface.
Native OpenCode Markdown and JSON/JSONC precedence remains in force.

Project settings hold branches, verification commands, preview awareness, and memory enabled
state. Preview discovery is local configuration awareness only, not a deployment/provider
verification. `supervisor_init_run` returns project context including branch/verification
settings, preview hints, memory directory and memory-enabled status.

## Session location

Every GUI call must include `{ location: { directory: props.session.directory } }`; without it,
the global plugin instance may return the wrong project. The server resolves the project and
fixed configuration targets itself.

## Closeout tools and memory decision

`supervisor_generate_receipt` requires `memory_decision` with `decision: none|curate` and a
bounded rationale for each run, including failed/cancelled runs. If project memory is explicitly
disabled it records `disabled`. A `curate` decision requires a memory-curator handoff and then a
`curator_proposal` containing `label`, `content`, `source_artifacts`, and optional
`expected_version`, or `curator_no_learning` explaining why no lesson was found. The curator
must inspect relevant artifacts; do not invent lessons or personal details. Proposal artifacts
must be confined to the run; sensitive or personal data is refused. Accepted blocks are
immutable, versioned, proposed project memory and are not auto-promoted.

## Release and verification

Validation and live host verification for v1.1.0 remain pending; do not interpret these method
descriptions as proof of runtime release testing. For contract changes, test schema, guards,
conflicts, and path confinement. See [ARCHITECTURE.md](ARCHITECTURE.md).
