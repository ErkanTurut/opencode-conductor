# Supervisor TUI layer — definitions, board model, and the retire gate

This directory holds the TUI integration as **structured data plus pure view
models**. It imports no opencode runtime surface and renders nothing.

Status: **definitions only.** Nothing here is registered with a running TUI.

## The hard rule

> No API invention. Probe the **installed** packages before importing any
> opencode TUI/React surface. Whatever cannot be verified from installed
> packages is implemented as pure logic with a runtime-dependent boundary
> marked here — never as a fake import.

Everything below was read out of the packages on this machine on **2026-10-17**
and re-probed on **2026-10-18**:

| Install | Version | Path |
| --- | --- | --- |
| `@opencode-ai/plugin` (V2 runtime, used by `~/.opencode/bin/opencode2`) | `1.18.16` | `~/.opencode/node_modules/@opencode-ai/plugin/dist` |
| `@opencode-ai/plugin` (declared in `~/.config/opencode/package.json`) | `1.4.7` | `~/.config/opencode/node_modules/@opencode-ai/plugin/dist` |
| `@opencode-ai/sdk` | `1.18.16` | `~/.opencode/node_modules/@opencode-ai/sdk/dist` |

Not installed anywhere (the repo root, this package, or either
opencode install): `@opentui/core`, `@opentui/solid`, `@opentui/keymap` — all
three are peer dependencies of the installed plugin (`peerDependencies`:
`@opentui/core >=0.4.5`, `@opentui/keymap >=0.4.5`, `@opentui/solid >=0.4.5`).
`react@19.2.7` and `solid-js@1.9.13` *are* present at the repo root, but they
are not the JSX runtime this surface needs: `tui.d.ts` L5 imports `JSX` and
`SolidPlugin` from **`@opentui/solid`**, and `CliRenderer` / `Renderable` /
`KeyEvent` from `@opentui/core`. Neither is installed and neither ships in
`solid-js`/`react`, so no `.tsx` in this package could compile against the real
route/slot signature. The package's own `node_modules` is absent; its
`package.json` declares only `@types/bun`, and its `tsconfig.json` sets no
`jsx` option.

Per-package evidence is encoded as data in
[`src/tui/index.ts`](./index.ts) → `TUI_SURFACE_EVIDENCE`, and asserted by
`tests/rpc.test.ts`. Prose below is the same matrix, expanded.

## Verified vs runtime-dependent vs absent

| Surface | Status | Installed shape / evidence |
| --- | --- | --- |
| `route.register` / `route.navigate` | **verified** | `{ register(routes: TuiRouteDefinition[]): () => void; navigate(name, params?); current }` — `tui.d.ts` L472-476 |
| route `render` | **runtime-dependent** | `render: (input) => JSX.Element`; `JSX` comes from `@opentui/solid` (peer, **not installed**) — L25-30 |
| `slots.register` | **verified** | `slots: { register(plugin: TuiSlotPlugin): string }` — L495, L401-406 |
| slot `session.panel` | **absent** | `TuiHostSlotMap` = `app`, `app_bottom`, `home_logo`, `home_prompt`, `home_prompt_right`, `session_prompt`, `session_prompt_right`, `home_bottom`, `home_footer`, `sidebar_title`, `sidebar_content`, `sidebar_footer` — L355-386 |
| `keymap` | **runtime-dependent** | `keymap: Keymap<Renderable, KeyEvent>`; `Keymap` lives in `@opentui/keymap` (**not installed**). The runtime JSDoc names `api.keymap.registerLayer({ commands, bindings })` and `dispatchCommand` (L462-467) but that argument shape is unresolvable — L470, L35 |
| legacy `command` shape | **verified** | `command?: { register(cb: () => TuiCommand[]) }`, `TuiCommand { value, title, slash: { name, aliases? }, keybind?, onSelect? }` — L45-73, L468 (@deprecated) |
| `TuiKeybindMap` | **verified** | `Record<string, string>` — present in the 1.4.7 install |
| `event.on` | **verified** | `event: { on<Type extends Event["type"]>(type, handler): () => void }` — L493, L407-411 |
| `data.on` / `data.listen` | **absent** | no `data` member on `TuiPluginApi` (L459-504) |
| `attention.notify` | **verified** | `attention: { notify({ title?, message, notification?, sound? }): Promise<{ ok, notification, sound, skipped? }> }` — L461, L201-217; sound names L171. **Absent in 1.4.7** |
| `ui.DialogConfirm` | **verified** | `(props: { title, message, onConfirm?, onCancel? }) => JSX.Element` — L480, L92-97 |
| `ui.dialog` stack | **verified** | `{ replace, clear, setSize, depth, open, size }` — L486, L79-86 |
| `ui.toast` | **verified** | `({ variant?, title?, message, duration? }) => void` — L485, L164-169 |
| `mode` | **verified** | `{ current(): string; push(mode): () => void }` — L471, L36-39. No `pop`/`active`/`pending`/`shortcuts` |
| `panel.open(name, { presentation })` | **absent** | no `panel` member (L459-504) |
| `tabs.*` | **absent** | no `tabs` member (L459-504) |
| `permission.assert` / `permission.hook` | **absent** | no `permission` member on the TUI API or on the V2 `PluginContext` |
| server `"permission.ask"` hook | **verified** | `(input: Permission, output: { status: "ask"\|"deny"\|"allow" })` — `index.d.ts` L225-227 |
| `client` | **verified** | `client: OpencodeClient` from `@opencode-ai/sdk/v2` — L492, L1 |
| `kv` / `state` / `theme` / `renderer` / `lifecycle` | **verified** | L489-503 |
| `./rpc` package export | **absent** | `exports` are `.`, `./tool`, `./tui`, `./v2/effect`, `./v2/effect/integration`, `./v2/effect/plugin`, `./v2/promise` — no `./rpc`, and no `rpc` token anywhere in `dist` |
| V2 entry `define` | **verified** | `define(plugin: { id, setup(context: PluginContext) })` — `v2/promise/plugin.d.ts`; `PluginContext` = `options`, `agent`, `aisdk`, `catalog`, `command`, `integration`, `plugin`, `reference`, `skill` (confirms t7: **no `ctx.tool`, no `ctx.location`, no `ctx.storage`**) |
| `TuiCommand` legacy slash | **verified** | `slash: { name, aliases? }` + `keybind?` — the only command/slash shape with a resolvable declaration |

### Corrections against the upstream platform notes

These are the places where the documented surface does **not** match what is
installed. They are the reason this layer is data, not imports.

| Documented | Installed reality |
| --- | --- |
| `router.register({ name, render })` | member is `route.register` |
| `slot({ append: 'sidebar.content' \| 'session.panel' })` | slots are registered as Solid plugins via `slots.register`; **there is no `session.panel` slot**. Verified anchor: `sidebar_content` (props `{ session_id }`) |
| `data.on("permission.asked")`, `data.listen()` | no `data` member; use `event.on("permission.asked", handler)` |
| `panel.open(name, { presentation: 'fullscreen' })` | no `panel` member |
| `tabs.enabled/open/focus/list/move/close` | no `tabs` member |
| `ctx.permission.assert({ sessionID, agent, source, action, resources, save })` and `ctx.permission.hook("evaluate")` | not present on the TUI API or on V2 `PluginContext`; server-side control is the `"permission.ask"` hook only |
| `keymap.layer({ mode, priority, commands: [{ id, title, group, bind, palette, slash, run }], bindings })`; `dispatch` / `shortcuts` / `commands` / `pending` / `active` / `mode.push` / `mode.pop` | `keymap` is `Keymap` from `@opentui/keymap` (peer, not installed); `mode` has only `current` + `push`. The exact `registerLayer` argument shape is **runtime-dependent** |
| `attention.notify` unspecified | verified, **but only in 1.18.16**; 1.4.7 has no `attention` member at all |
| `POST /api/rpc/{rpcID}/{method}`; publish via `./rpc` | no `rpc` route and no `rpc` token in the installed SDK (`dist/v2/gen/sdk.gen.js`: 188 `url:` entries across 162 unique paths) and no `./rpc` export |
| `POST /api/pair`, `GET /auth/connect/{code}` | not in the installed SDK |
| `GET/POST/DELETE /api/worktree` | installed path is `/experimental/worktree` (+ `/experimental/worktree/reset`) |

## Files

| File | Role |
| --- | --- |
| [`index.ts`](./index.ts) | Registration definitions as data: route card, panel def, slash def, keymap defs + binding table, event subscriptions, attention, destructive-confirm defs, `TUI_SURFACE_EVIDENCE`, `WEB_PARITY_ENDPOINTS`, `evaluateRetireGate`, `TUI_DEFS` |
| [`board.ts`](./board.ts) | Pure view models: `buildBoardModel` (run state → lane columns of cards), `buildPanelModel` (attempts / hooks / leases), `laneCoverage()` proof |

### Why `board.ts` and not `board.tsx`

The route `render` returns `JSX.Element` where `JSX` is imported from
`@opentui/solid` (`tui.d.ts` L5). That package is not installed (see the install
table), and `react`/`solid-js` do not provide it, so a `.tsx` route render here
would have to invent a JSX runtime. `board.ts` returns typed view models
instead; when `@opentui/solid` is present, a thin wrapper can map
`BoardModel`/`PanelModel` 1:1 onto `ui.*` primitives without touching the model
layer.

## Consuming this

```ts
import { TUI_DEFS } from './src/tui/index'
import { buildBoardModel, buildPanelModel } from './src/tui/board'

// A verified TUI entry would walk TUI_DEFS and call the real api.* members:
//   api.route.register([{ name: TUI_DEFS.route.name, render: () => <Board/> }])
//   api.slots.register({ /* ... */ })
//   api.event.on('permission.asked', () => { /* rebuild from rpc.run.status */ })
//   api.attention.notify(TUI_DEFS.attention)   // 1.18.16+ only; fall back to api.ui.toast
export function register(api: unknown): void {
  throw new Error('not implemented: no verified TUI runtime import is available')
}
```

`TUI_DEFS.retireGate` and `TUI_DEFS.evidence` travel with the definitions, so an
installer can refuse to register against a runtime that contradicts them.

## Projection-only guarantee

- `src/rpc.ts` reads (`run.status`, `run.receipt`) call only existing projection
  reads (`getRun`, `listWorkItems`, `getLatestAttempt`, `getLease`,
  `getApprovals`, `generateReceipt`).
- `src/tui/board.ts` is pure: same `RpcRunStatusValue` in, same model out. It
  never claims, releases or sequences.
- `SUPERVISOR_EVENT_SUBS` handlers are declared `projection: 'read-only'`; their
  only permitted jobs are rebuilding a board/panel and raising attention/toast.
- The write verbs (`task.approve`, `task.retry`, `run.sweep`) live in
  `src/rpc.ts` and run only on an explicit user action, behind the confirm
  dialogs in `SUPERVISOR_CONFIRM_DEFS` for the destructive ones.

## Web parity endpoints (installed `@opencode-ai/sdk@1.18.16`)

Verified present (exact generated-client URL strings):

| Leg | Method | Path |
| --- | --- | --- |
| event | GET | `/api/event` |
| event | GET | `/event` |
| event | GET | `/global/event` |
| permission | GET | `/api/permission/request` |
| permission | GET | `/api/permission/saved` |
| permission | DELETE | `/api/permission/saved/{id}` |
| permission | GET | `/api/session/{sessionID}/permission` |
| permission | GET | `/api/session/{sessionID}/permission/{requestID}` |
| permission | POST | `/permission/{requestID}/reply` (`reply: "once" \| "always" \| "reject"`) |
| pty | POST | `/api/pty` |
| pty | DELETE | `/api/pty/{ptyID}` |
| pty | POST | `/api/pty/{ptyID}/connect-token` |
| pty | GET | `/api/pty/{ptyID}/connect` |
| worktree | GET/POST/DELETE | `/experimental/worktree` |
| worktree | POST | `/experimental/worktree/reset` |

Recorded **absent** (docs-only, must not be coded against):

| Leg | Documented | Why absent |
| --- | --- | --- |
| rpc | `POST /api/rpc/{rpcID}/{method}` | no `rpc` token in the installed SDK's generated client (188 `url:` entries / 162 unique paths, zero `rpc` matches), none in `@opencode-ai/plugin@1.18.16` `dist`, no `./rpc` export |
| pairing | `POST /api/pair`, `GET /auth/connect/{code}` | no `/pair` route and no `pairing` identifier in `sdk@1.18.16`; the only `Pair` matches are unrelated `serializeFormDataPair` / `serializeUrlSearchParamsPair` helpers in `dist/v2/gen/core/bodySerializer.gen.js`. Only `/auth/{providerID}` exists |

Also treat the `worktree` leg as unstable: its only installed path carries the
`/experimental/` prefix.

## fleet-ui retire gate

**Gate: retire the custom fleet-ui server (Bun.serve on `127.0.0.1`, port from
`--port` > `FLEET_UI_PORT` > 4649, routes `/`, `/index.html`, `/fleet`,
`GET /api/fleet`, `/health`, `/fleet/models|roles|slots`) ONLY after parity on
the board, the session panel, the `/supervisor` slash command and the approve
flow over the verified `event` + `rpc` + `pty` legs.**

`evaluateRetireGate()` is pure and data-driven; `FLEET_UI_RETIRE_GATE` is the
current evaluation:

```
requiredLegs : ['event', 'rpc', 'pty']
satisfiedLegs: ['event', 'pty']
blockingLegs : ['rpc']
satisfied    : false
capabilities : ['board', 'panel', 'slash', 'approve']
```

**Current verdict: the gate is CLOSED.** `event` and `pty` are verified, but the
`rpc` leg has no installed endpoint or package export, so the approve flow
cannot reach parity over it from installed evidence. Keep fleet-ui running until
the `rpc` leg is verified (or an alternative verified action channel replaces
it). The gate re-evaluates automatically if `WEB_PARITY_ENDPOINTS` gains a
verified `rpc` entry.

## Stub boundary (deliberately not implemented)

Marked `runtime-dependent` or `absent` above; do not "fix" by guessing:

1. **No TUI registration.** `register()` above is a documented stub. No
   `@opencode-ai/plugin/tui` import exists anywhere in this repo.
2. **JSX rendering.** The `@opentui/solid` JSX runtime is not installed (the
   repo-root `react`/`solid-js` are not it); `board.ts` returns models.
3. **Keymap `registerLayer` binding shape.** Encoded as a
   `Record<string, string>` table plus a `command.register` fallback.
4. **`keymapMethods` / deny action.** `d` (deny) is defined for the keymap
   contract but has **no RPC method**; the candidate mapping is
   `createApproval({ decision: 'denied' })`, recorded in
   `SUPERVISOR_SLASH_DEF.unimplemented`.
5. **`/experimental/worktree` removal.** The confirm dialog is defined, but the
   path is experimental — not a stable parity surface.

### Upgraded in the 2026-10-18 re-probe

- **`session.created` subscription** (previously `runtime-dependent`): now
  **verified** — `EventSessionCreated { type: "session.created", properties: { sessionID, info } }`,
  `sdk@1.18.16` `dist/v2/gen/types.gen.d.ts` L5279-5286.
- **SDK path counts** (previously "188 ops"): restated precisely as 188 `url:`
  entries across 162 unique paths in `dist/v2/gen/sdk.gen.js`.
- **`react` / `solid-js`** (previously listed as absent): both *are* installed at
  the repo root (`react@19.2.7`, `solid-js@1.9.13`); what is absent is
  `@opentui/solid`, whose `JSX`/`SolidPlugin` the TUI render signature needs.
