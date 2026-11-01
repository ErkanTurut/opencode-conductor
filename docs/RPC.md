# Conductor RPC

The GUI is a read-only client of the Conductor RPC. The contract is `src/rpc-contract.ts`,
exported as `opencode-conductor/rpc`; the implementation is `src/rpc/register.ts`.

## Contract shape

```ts
import { Rpc } from '@opencode/plugin/rpc'

export const ConductorRpc = Rpc.define({
  id: 'conductor',
  methods: {
    runs: {
      input: { type: 'object', properties: { limit: { type: 'number' } }, additionalProperties: false },
      output: { type: 'object', additionalProperties: true },
    },
    // ...
  },
  events: {},
})
```

All inputs/outputs use JSON Schema. The TypeScript view types in `src/rpc-contract.ts` describe
the `data` payloads for the GUI; they are not used for runtime validation.

## Envelope

Every handler returns one of:

```ts
{ ok: true, data: T }
{ ok: false, error: { code: string; message: string } }
```

`code` is a stable string (`invalid_input`, `not_found`, `internal`). The GUI renders the
message; it never throws on a bad run id or a missing database.

## Methods

| Method | Input | Data |
| --- | --- | --- |
| `workspace` | `{}` | `projectRoot`, `projectKey`, `mode`, `ledgerPath`, `runsDir`, `memoryDir`, `trusted`, `policyRestricted`, `counts` |
| `configuration` | `{}` | host-resolved agent allowlist and provenance, model catalog, warnings; native system text is withheld |
| `project` | `{}` | detected branches, verification profile, policy snapshot and explicit unavailable integration capabilities |
| `runs` | `{ limit?: number; cursor?: string; states?: string[] }` | `runs: RunSummary[]`, `nextCursor` |
| `run` | `{ runId: string }` | summary, contract, budget, plan, tasks, attempts, leases, approvals, eventCount, runDir |
| `dag` | `{ runId: string }` | nodes, edges, layers, roots, leaves, dangling, cycles, maxDepth, maxDepthBudget |
| `gates` | `{ runId: string }` | approvals, per-task verification evidence, findings, non-authoritative evidence readiness (`mergeReady` remains false) |
| `refinements` | `{ runId: string }` | state, uncertainties, Q&A, requirementsPath/Markdown, contract, events |
| `memory` | `{ limit?: number }` | `blocks: MemoryBlockSummary[]`, `total` |
| `memoryBlock` | `{ label: string; version?: number }` | full block: scope, status, confidence, reviewAfter, source artifacts, content, hash |
| `routing` | `{ runId?: string }` | fleet assignments, observed routes, cost/usage summary |
| `timeline` | `{ runId: string; afterSequence?: number; limit?: number }` | events, `lastSequence`, `truncated` |

The exact TypeScript shapes are exported from `src/rpc-contract.ts`.

## Location scoping

The Desktop app's server has a global plugin instance and per-session instances. An RPC call
without a location reads the global instance:

```ts
// wrong: reads /Users/<you>'s global ledger, usually empty
await rpc().runs({ limit: 50 })
```

Every call must name the session directory:

```ts
const location = () => ({ directory: props.session.directory })

const runs = await rpc().runs({ limit: 50 }, { location: location() })
```

The client serializes it as `location[directory]`. The server resolves the plugin instance for
that directory. This is why the same method can return 98 runs for a project and zero for the
global location.

## Server registration

`src/rpc/register.ts`:

```ts
export async function registerConductorRpc(ctx, options) {
  const register = ctx?.rpc?.register
  if (typeof register !== 'function') return false

  const reader = new LedgerReader(options.layout.ledgerPath)
  await register(ConductorRpc, {
    runs: async (input) => {
      // narrow input, read, return an envelope
    },
    // ...
  })
  return true
}
```

The options close over `projectRoot`, `StateLayout`, trust, policy, and `assetsDir`. The
handlers never read `process.env` and never accept a path. Registration is feature-detected and
failure-tolerant: a host before 2.2 logs a warning and keeps the tools.

## Adding a method

1. **Contract** — add the method to `ConductorRpc.methods` with input/output JSON Schema; add
   the view types to `src/rpc-contract.ts`.
2. **Source** — add a read-only reader in `src/read/ledger-reader.ts` (SQLite) or
   `src/read/artifacts.ts` (files). Never write.
3. **Projection** — add a pure builder in `src/read/projections.ts`. It must tolerate missing
   rows, malformed JSON, dangling ids, cycles, and legacy states.
4. **Handler** — add a guarded handler in `src/rpc/register.ts`. Return `invalid_input` or
   `not_found` as envelopes; wrap unexpected failures in `internal`.
5. **Tests** — `tests/read/*` for the source/projection, `tests/rpc/register.test.ts` for the
   handler/envelope. Use temporary ledgers, never live state.
6. **GUI** — call it with the session location and render loading/empty/error states.
7. **Verify** — `bun test`, `bun run typecheck`, GUI typecheck, `bun run gui:build`,
   `bun run smoke:gui`.

## Testing the endpoint directly

The HTTP endpoint is `POST /api/rpc/{rpcID}/{method}` with the body wrapped as `{ input }` and
the location as `location[directory]`:

```sh
PASSWORD=$(python3 -c "import json;print(json.load(open('$HOME/.config/opencode/service.json'))['password'])")
curl -u "opencode:$PASSWORD" -X POST \
  'http://127.0.0.1:49374/api/rpc/conductor/runs?location%5Bdirectory%5D=%2Fpath%2Fto%2Fproject' \
  -H 'Content-Type: application/json' \
  -d '{"input":{"limit":5}}'
```

The response is `{ "output": { "ok": true, "data": ... } }`. Use this for read-only diagnostics;
do not call write methods while a run is active.

## Security

- Inputs are ids, labels, and pagination only. No paths.
- Reads are confined to the resolved `StateLayout`; the artifact reader rejects `..`, absolute
  paths, and symlink escapes.
- The SQLite reader opens `readonly: true`, skips migrations, and does not create the file.
- The GUI never imports server code; it has no filesystem or database access.
- The RPC is read-only in 1.0.x. Approvals and retries remain server tools, not GUI actions.
