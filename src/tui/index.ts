// Supervisor TUI registration DEFINITIONS — structured data only.
//
// NO RUNTIME IMPORTS OF ANY OPENCODE SURFACE.
// This file deliberately does not import `@opencode-ai/plugin` (or `/tui`).
// It encodes what a TUI installer would register as plain, typed data, so that
// (a) it builds and tests without a JSX/OpenTUI runtime, and (b) every claim
// about the runtime API is auditable against the probe evidence recorded in
// `TUI_SURFACE_EVIDENCE` (see src/tui/README.md for the full matrix).
//
// The registered surface for `PluginModule`/`TuiPluginModule` is verified to be
// `{ id?, tui: (api, options, meta) => Promise<void> }`. A future verified
// installer can walk TUI_DEFS and call the real `api.*` members; nothing here
// pretends to have done so.
//
// PROJECTION-ONLY
// `SUPERVISOR_EVENT_SUBS` handlers may only rebuild board/panel view models from
// a read projection. No handler claims, releases or sequences anything.
//
// Provenance: the route/panel/slash/keymap split follows the OmO comparison
// notes (idea 3 — rounds/sweep slot gating). Patterns only; no upstream source
// copied. License: SUL-1.0.
// provenance: omo-comparison idea 3
import type { RpcMethod } from '../rpc'
import { RPC_METHODS } from '../rpc'

export const TUI_PLUGIN_ID = 'supervisor'
/** Package export subpath the runtime loads the TUI entry from. */
export const TUI_PLUGIN_EXPORT = './tui'

// ---------------------------------------------------------------------------
// Probe evidence
// ---------------------------------------------------------------------------

export type TuiSurfaceStatus =
  /** Present in an installed package with a cited declaration. */
  | 'verified'
  /** Referenced by a declaration we cannot resolve (peer dep not installed). */
  | 'runtime-dependent'
  /** Absent from every installed package — must not be imported. */
  | 'absent'

export interface TuiSurfaceEvidence {
  surface: string
  status: TuiSurfaceStatus
  /** Declaration text / shape, quoted from the installed package. */
  shape: string
  /** Where it was verified (or where it is missing from). */
  evidence: string
  note?: string
}

/**
 * The verified-vs-runtime-dependent matrix. Every entry was read out of the
 * installed packages; nothing here is inferred from documentation.
 */
export const TUI_SURFACE_EVIDENCE: readonly TuiSurfaceEvidence[] = [
  {
    surface: 'route.register / route.navigate',
    status: 'verified',
    shape:
      "{ register(routes: TuiRouteDefinition[]): () => void; navigate(name, params?); current }",
    evidence:
      '@opencode-ai/plugin@1.18.16 dist/tui.d.ts L472-476; TuiRouteDefinition L25-30',
    note: 'Documented as `router.register`; the real member is `route.register`.',
  },
  {
    surface: 'route render',
    status: 'runtime-dependent',
    shape: 'render: (input: { params? }) => JSX.Element',
    evidence: '@opencode-ai/plugin@1.18.16 dist/tui.d.ts L25-30, JSX from @opentui/solid L5',
    note: 'JSX.Element comes from @opentui/solid, a peer dependency that is NOT installed. Hence board.ts emits typed view models instead of .tsx.',
  },
  {
    surface: 'slots.register',
    status: 'verified',
    shape: 'slots: { register(plugin: TuiSlotPlugin): string }',
    evidence: '@opencode-ai/plugin@1.18.16 dist/tui.d.ts L495, TuiSlots L401-406',
  },
  {
    surface: 'slot `session.panel`',
    status: 'absent',
    shape: 'TuiHostSlotMap = app | app_bottom | home_logo | home_prompt | home_prompt_right | session_prompt | session_prompt_right | home_bottom | home_footer | sidebar_title | sidebar_content | sidebar_footer',
    evidence: '@opencode-ai/plugin@1.18.16 dist/tui.d.ts L355-386 (no `session.panel`)',
    note: 'The panel is anchored to the verified `sidebar_content` slot instead.',
  },
  {
    surface: 'keymap',
    status: 'runtime-dependent',
    shape: 'keymap: Keymap<Renderable, KeyEvent>',
    evidence: '@opencode-ai/plugin@1.18.16 dist/tui.d.ts L470; TuiKeymap L35',
    note: "`Keymap` is declared in @opentui/keymap (peer, NOT installed). The runtime JSDoc names `api.keymap.registerLayer({ commands, bindings })` and `dispatchCommand` (L462-467), but that argument shape cannot be resolved from installed packages.",
  },
  {
    surface: 'legacy `command` shape',
    status: 'verified',
    shape:
      'command?: { register(cb: () => TuiCommand[]) } with TuiCommand { value, title, slash: { name, aliases? }, keybind?, onSelect? }',
    evidence: '@opencode-ai/plugin@1.18.16 dist/tui.d.ts L45-73, L468',
    note: 'Marked @deprecated in favour of keymap.registerLayer, but it is the only command/slash shape with a resolvable declaration.',
  },
  {
    surface: 'keybind map type',
    status: 'verified',
    shape: 'TuiKeybindMap = Record<string, string>',
    evidence: '@opencode-ai/plugin@1.4.7 dist/tui.d.ts (TuiKeybindMap, TuiKeybindSet)',
    note: 'Present in the 1.4.7 install; 1.18.16 replaced it with the @opentui/keymap Keymap.',
  },
  {
    surface: 'event bus',
    status: 'verified',
    shape: 'event: { on<Type extends Event["type"]>(type, handler): () => void }',
    evidence: '@opencode-ai/plugin@1.18.16 dist/tui.d.ts L493, TuiEventBus L407-411',
  },
  {
    surface: 'data.on / data.listen',
    status: 'absent',
    shape: 'no `data` member on TuiPluginApi',
    evidence:
      'TuiPluginApi member list, @opencode-ai/plugin@1.18.16 dist/tui.d.ts L459-504',
    note: 'The documented `data.on("permission.asked")` does not exist; the verified equivalent is `event.on("permission.asked", ...)`.',
  },
  {
    surface: 'attention.notify',
    status: 'verified',
    shape:
      'attention: { notify(input: { title?, message, notification?, sound? }): Promise<{ ok, notification, sound, skipped? }> }',
    evidence: '@opencode-ai/plugin@1.18.16 dist/tui.d.ts L461, L201-217; sound names L171',
    note: 'Absent in the 1.4.7 install — this surface is version-split, so it is registered defensively.',
  },
  {
    surface: 'ui.DialogConfirm',
    status: 'verified',
    shape: 'DialogConfirm: (props: { title, message, onConfirm?, onCancel? }) => JSX.Element',
    evidence: '@opencode-ai/plugin@1.18.16 dist/tui.d.ts L480, TuiDialogConfirmProps L92-97',
  },
  {
    surface: 'ui.dialog stack',
    status: 'verified',
    shape: 'dialog: { replace(render, onClose?), clear(), setSize(size), depth, open, size }',
    evidence: '@opencode-ai/plugin@1.18.16 dist/tui.d.ts L486, TuiDialogStack L79-86',
  },
  {
    surface: 'ui.toast',
    status: 'verified',
    shape: 'toast: (input: { variant?, title?, message, duration? }) => void',
    evidence: '@opencode-ai/plugin@1.18.16 dist/tui.d.ts L485, TuiToast L164-169',
  },
  {
    surface: 'mode (breadcrumb focus)',
    status: 'verified',
    shape: 'mode: { current(): string; push(mode: string): () => void }',
    evidence: '@opencode-ai/plugin@1.18.16 dist/tui.d.ts L471, TuiModeApi L36-39',
    note: 'No `mode.pop` / `mode.active` / `mode.pending` / `mode.shortcuts` members exist.',
  },
  {
    surface: 'panel.open(name, { presentation })',
    status: 'absent',
    shape: 'no `panel` member on TuiPluginApi',
    evidence: 'TuiPluginApi L459-504',
    note: 'Fullscreen presentation is not a verified surface; use the route + slot instead.',
  },
  {
    surface: 'tabs.*',
    status: 'absent',
    shape: 'no `tabs` member on TuiPluginApi',
    evidence: 'TuiPluginApi L459-504',
  },
  {
    surface: 'permission.assert / permission.hook',
    status: 'absent',
    shape: 'no `permission` member on TuiPluginApi or on v2 PluginContext',
    evidence:
      'TuiPluginApi L459-504; @opencode-ai/plugin@1.18.16 dist/v2/promise/context.d.ts',
    note: 'Server-side permission control is the `"permission.ask"` hook (index.d.ts L225-227). No TUI-side assert exists.',
  },
  {
    surface: 'server permission hook',
    status: 'verified',
    shape: '"permission.ask"?: (input: Permission, output: { status: "ask" | "deny" | "allow" }) => Promise<void>',
    evidence: '@opencode-ai/plugin@1.18.16 dist/index.d.ts L225-227',
  },
  {
    surface: 'client',
    status: 'verified',
    shape: 'client: OpencodeClient (from @opencode-ai/sdk/v2)',
    evidence: '@opencode-ai/plugin@1.18.16 dist/tui.d.ts L492, L1',
  },
  {
    surface: 'kv / state / theme / renderer / lifecycle',
    status: 'verified',
    shape:
      'kv: TuiKV; state: TuiState; theme: TuiTheme; renderer: CliRenderer; lifecycle: { signal, onDispose }',
    evidence: '@opencode-ai/plugin@1.18.16 dist/tui.d.ts L489-503',
  },
  {
    surface: './rpc package export',
    status: 'absent',
    shape: 'exports: ".", "./tool", "./tui", "./v2/effect", "./v2/effect/integration", "./v2/effect/plugin", "./v2/promise"',
    evidence: '@opencode-ai/plugin@1.18.16 package.json exports',
    note: 'There is no `./rpc` subpath and no `rpc` token anywhere in the installed dist, so src/rpc.ts cannot be published through a verified channel yet.',
  },
  {
    surface: 'V2 plugin entry (`define`)',
    status: 'verified',
    shape: 'define(plugin: { id, setup(context: PluginContext) }): Plugin',
    evidence: '@opencode-ai/plugin@1.18.16 dist/v2/promise/plugin.d.ts; PluginContext dist/v2/promise/context.d.ts',
    note: 'PluginContext has options/agent/aisdk/catalog/command/integration/plugin/reference/skill — no ctx.tool, no ctx.location, no ctx.storage (confirms t7).',
  },
] as const

// ---------------------------------------------------------------------------
// Route card (board)
// ---------------------------------------------------------------------------

export interface TuiRouteParamDef {
  name: string
  required: boolean
  description: string
}

export interface TuiRouteDef {
  name: string
  title: string
  params: readonly TuiRouteParamDef[]
  /** The board model is derived purely from this read projection. */
  boardProjection: 'rpc.run.status'
  panelProjection: 'rpc.run.status'
  /** Builder a JSX wrapper should call; a string reference, never an import. */
  boardBuilder: 'board.ts#buildBoardModel'
  panelBuilder: 'board.ts#buildPanelModel'
  /** Registration member on the verified API. */
  registersWith: 'route.register'
}

export const SUPERVISOR_ROUTE_DEF: TuiRouteDef = {
  name: TUI_PLUGIN_ID,
  title: 'Supervisor',
  params: [
    { name: 'runId', required: false, description: 'Run to open; defaults to the most recent active run.' },
  ],
  boardProjection: 'rpc.run.status',
  panelProjection: 'rpc.run.status',
  boardBuilder: 'board.ts#buildBoardModel',
  panelBuilder: 'board.ts#buildPanelModel',
  registersWith: 'route.register',
}

export interface TuiNavigateDef {
  name: string
  params: readonly string[]
}

/** Navigate helper: `board.route` in board.ts is the structured source of truth. */
export const SUPERVISOR_NAVIGATE_DEF: TuiNavigateDef = {
  name: TUI_PLUGIN_ID,
  params: ['runId'],
}

// ---------------------------------------------------------------------------
// Session panel
// ---------------------------------------------------------------------------

export interface TuiPanelDef {
  /** Verified host slot this panel is appended to. */
  slot: 'sidebar_content'
  /** Slot props the host passes (from TuiHostSlotMap). */
  slotProps: readonly string[]
  /** Fields rendered by buildPanelModel; all projection reads. */
  sections: readonly string[]
  /** Fields *requested* by the task, with their actual availability. */
  requestedFields: readonly { name: string; status: TuiSurfaceStatus; source: string }[]
  registersWith: 'slots.register'
  note: string
}

export const SUPERVISOR_PANEL_DEF: TuiPanelDef = {
  slot: 'sidebar_content',
  slotProps: ['session_id'],
  sections: ['Attempts', 'Hooks', 'Leases'],
  requestedFields: [
    {
      name: 'attempts',
      status: 'verified',
      source: 'rpc.run.status -> task.latestAttempt / task.attempts',
    },
    {
      name: 'leases',
      status: 'verified',
      source: 'rpc.run.status -> task.lease',
    },
    {
      name: 'hooks',
      status: 'runtime-dependent',
      source:
        'injected HookStatus[] (buildPanelModel argument): the TUI hook surface is not ledger state and has no verified reader',
    },
  ],
  registersWith: 'slots.register',
  note:
    'Anchored to `sidebar_content` because the documented `session.panel` slot does not exist in the installed plugin (TUI_SURFACE_EVIDENCE).',
}

// ---------------------------------------------------------------------------
// Slash command
// ---------------------------------------------------------------------------

export interface TuiSlashArgDef {
  name: string
  required: boolean
  description: string
}

export interface TuiSlashDef {
  /** Slash names as the deprecated-but-verified `TuiCommand.slash` shape. */
  slash: { name: string; aliases: readonly string[] }
  /** `TuiCommand.value`, the palette identity. */
  value: string
  title: string
  description: string
  args: readonly TuiSlashArgDef[]
  /** Actions the command can dispatch, by RPC method name. */
  dispatches: readonly RpcMethod[]
  /** The one action the slash command cannot dispatch yet. */
  unimplemented: readonly { command: string; candidate: string; reason: string }[]
  registersWith: 'command.register'
  note: string
}

export const SUPERVISOR_SLASH_DEF: TuiSlashDef = {
  slash: { name: 'supervisor', aliases: ['sup'] },
  value: 'supervisor.open',
  title: 'Supervisor',
  description: 'Open the supervisor run board; `/supervisor <runId> [approve|retry|receipt]`.',
  args: [
    { name: 'runId', required: false, description: 'Run to open (defaults to most recent).' },
    { name: 'action', required: false, description: 'approve | retry | receipt' },
  ],
  dispatches: ['run.status', 'task.approve', 'task.retry', 'run.receipt'],
  unimplemented: [
    {
      command: 'supervisor.task.deny',
      candidate: "createApproval({ decision: 'denied' })",
      reason:
        'RPC_METHODS exposes approve/retry only; deny is defined for the keymap contract but has no method yet.',
    },
  ],
  registersWith: 'command.register',
  note:
    '`command.register` is @deprecated in 1.18.16 but is the only command/slash shape with a resolvable declaration. The keymap.registerLayer command shape is runtime-dependent (see TUI_SURFACE_EVIDENCE).',
}

// ---------------------------------------------------------------------------
// Keymap
// ---------------------------------------------------------------------------

export interface TuiKeybindDef {
  key: string
  /** Palette command id the key dispatches. */
  command: string
  label: string
  description: string
  /** RPC method this key ends up calling, when implemented. */
  method: RpcMethod | null
  implemented: boolean
  destructive: boolean
  /** Confirmation dialog id required before dispatch, when destructive. */
  confirmsWith: string | null
}

export const SUPERVISOR_KEYMAP_DEFS: readonly TuiKeybindDef[] = [
  {
    key: 'a',
    command: 'supervisor.task.approve',
    label: 'approve',
    description: 'Record a gate approval for the selected task.',
    method: 'task.approve',
    implemented: true,
    destructive: false,
    confirmsWith: null,
  },
  {
    key: 'd',
    command: 'supervisor.task.deny',
    label: 'deny',
    description: 'Record a gate denial for the selected task.',
    method: null,
    implemented: false,
    destructive: false,
    confirmsWith: null,
  },
  {
    key: 'r',
    command: 'supervisor.task.retry',
    label: 'retry',
    description: 'Re-dispatch a failed/blocked/interrupted task.',
    method: 'task.retry',
    implemented: true,
    destructive: false,
    confirmsWith: null,
  },
] as const

/** `TuiKeybindMap`-shaped (`Record<string, string>`) binding table. */
export const SUPERVISOR_BINDINGS: Readonly<Record<string, string>> =
  Object.freeze(
    SUPERVISOR_KEYMAP_DEFS.reduce<Record<string, string>>((acc, def) => {
      acc[def.key] = def.command
      return acc
    }, {}),
  )

/** Every RPC method a keymap def actually reaches. */
export function keymapMethods(): RpcMethod[] {
  return SUPERVISOR_KEYMAP_DEFS.filter((d) => d.method !== null).map(
    (d) => d.method as RpcMethod,
  )
}

export interface TuiKeymapRegistrationDef {
  /** Runtime member named by the 1.18.16 JSDoc. */
  registersWith: 'keymap.registerLayer'
  status: TuiSurfaceStatus
  bindings: Readonly<Record<string, string>>
  commands: readonly TuiKeybindDef[]
  /** Fallback used because the primary shape cannot be resolved. */
  fallback: 'command.register + TuiCommand.keybind'
  note: string
}

export const SUPERVISOR_KEYMAP_DEF: TuiKeymapRegistrationDef = {
  registersWith: 'keymap.registerLayer',
  status: 'runtime-dependent',
  bindings: SUPERVISOR_BINDINGS,
  commands: SUPERVISOR_KEYMAP_DEFS,
  fallback: 'command.register + TuiCommand.keybind',
  note:
    '`keymap.registerLayer({ commands, bindings })` is named by the 1.18.16 runtime JSDoc, but its argument type lives in @opentui/keymap, which is not installed. The binding table is therefore registered as data; keys wired through `command.register` + `TuiCommand.keybind` are the verified path.',
}

// ---------------------------------------------------------------------------
// Event subscriptions
// ---------------------------------------------------------------------------

export interface TuiEventSubDef {
  /** Event type on the verified `event.on` bus. */
  type: string
  handler: string
  /** Rebuilds view models from a read projection; never writes. */
  projection: 'read-only'
  /** Action taken on the event, expressed as data. */
  effect: 'invalidate-board' | 'invalidate-panel' | 'toast' | 'attention'
  status: TuiSurfaceStatus
  evidence: string
}

export const SUPERVISOR_EVENT_SUBS: readonly TuiEventSubDef[] = [
  {
    type: 'permission.asked',
    handler: 'supervisor.onPermissionAsked',
    projection: 'read-only',
    effect: 'attention',
    status: 'verified',
    evidence:
      'EventPermissionAsked { type: "permission.asked", properties: { id, sessionID, permission, patterns, metadata, always, tool? } } — @opencode-ai/sdk@1.18.16 dist/v2/gen/types.gen.d.ts L5884-5905',
  },
  {
    type: 'permission.v2.asked',
    handler: 'supervisor.onPermissionV2Asked',
    projection: 'read-only',
    effect: 'invalidate-panel',
    status: 'verified',
    evidence:
      'EventPermissionV2Asked { type: "permission.v2.asked" } — @opencode-ai/sdk@1.18.16 dist/v2/gen/types.gen.d.ts L5764-5767',
  },
  {
    type: 'session.created',
    handler: 'supervisor.onSessionCreated',
    projection: 'read-only',
    effect: 'invalidate-board',
    status: 'verified',
    evidence:
      'EventSessionCreated { type: "session.created", properties: { sessionID, info } } — @opencode-ai/sdk@1.18.16 dist/v2/gen/types.gen.d.ts L5279-5286',
  },
] as const

/** Documented-but-absent subscription API, kept visible so it is not re-added. */
export const SUPERVISOR_EVENT_SUB_API = {
  requested: 'data.on / data.listen',
  status: 'absent' as TuiSurfaceStatus,
  substitute: 'event.on',
} as const

// ---------------------------------------------------------------------------
// Attention
// ---------------------------------------------------------------------------

export interface TuiAttentionDef {
  /** Verified sound name (TuiAttentionSoundNames). */
  sound: 'permission' | 'question' | 'error' | 'done' | 'default' | 'subagent_done'
  when: 'always' | 'focused' | 'blurred'
  title: string
  message: string
  registersWith: 'attention.notify'
  status: TuiSurfaceStatus
  fallback: 'ui.toast'
}

export const SUPERVISOR_ATTENTION_DEF: TuiAttentionDef = {
  sound: 'permission',
  when: 'blurred',
  title: 'Supervisor',
  message: 'A permission request is waiting.',
  registersWith: 'attention.notify',
  status: 'verified',
  fallback: 'ui.toast',
}

// ---------------------------------------------------------------------------
// Confirm dialogs (destructive)
// ---------------------------------------------------------------------------

export type DestructiveTarget =
  | { kind: 'rpc'; method: RpcMethod }
  | { kind: 'endpoint'; httpMethod: string; path: string }

export interface TuiConfirmDef {
  id: string
  title: string
  message: string
  destructive: boolean
  confirms: DestructiveTarget
  registersWith: 'ui.DialogConfirm'
  /** Registered but gated: the endpoint/path is not verified stable. */
  status: TuiSurfaceStatus
}

export const SUPERVISOR_CONFIRM_DEFS: readonly TuiConfirmDef[] = [
  {
    id: 'supervisor.sweep.confirm',
    title: 'Sweep stale leases?',
    message:
      'Releases expired leases and marks stale running tasks interrupted. This writes to the ledger.',
    destructive: true,
    confirms: { kind: 'rpc', method: 'run.sweep' },
    registersWith: 'ui.DialogConfirm',
    status: 'verified',
  },
  {
    id: 'supervisor.worktree.remove.confirm',
    title: 'Remove this worktree?',
    message: 'Removes a git worktree and deletes its branch.',
    destructive: true,
    confirms: {
      kind: 'endpoint',
      httpMethod: 'DELETE',
      path: '/experimental/worktree',
    },
    registersWith: 'ui.DialogConfirm',
    status: 'runtime-dependent',
  },
] as const

// ---------------------------------------------------------------------------
// Web parity + fleet-ui retire gate
// ---------------------------------------------------------------------------

export type ParityLeg = 'event' | 'permission' | 'rpc' | 'pty' | 'pairing' | 'worktree'

export interface ParityEndpoint {
  leg: ParityLeg
  httpMethod: string
  path: string
  status: TuiSurfaceStatus
  evidence: string
}

/**
 * Every endpoint read out of the installed `@opencode-ai/sdk@1.18.16` generated
 * client (188 operations). Anything the docs describe but the installed SDK
 * does not contain is recorded as `absent` rather than assumed.
 */
export const WEB_PARITY_ENDPOINTS: readonly ParityEndpoint[] = [
  {
    leg: 'event',
    httpMethod: 'GET',
    path: '/api/event',
    status: 'verified',
    evidence: 'sdk@1.18.16 dist/v2/gen/sdk.gen.js url: "/api/event"',
  },
  {
    leg: 'event',
    httpMethod: 'GET',
    path: '/event',
    status: 'verified',
    evidence: 'sdk@1.18.16 dist/v2/gen/sdk.gen.js url: "/event"',
  },
  {
    leg: 'event',
    httpMethod: 'GET',
    path: '/global/event',
    status: 'verified',
    evidence: 'sdk@1.18.16 dist/v2/gen/sdk.gen.js url: "/global/event"',
  },
  {
    leg: 'permission',
    httpMethod: 'GET',
    path: '/api/permission/request',
    status: 'verified',
    evidence: 'sdk@1.18.16 dist/v2/gen/sdk.gen.js',
  },
  {
    leg: 'permission',
    httpMethod: 'GET',
    path: '/api/permission/saved',
    status: 'verified',
    evidence: 'sdk@1.18.16 dist/v2/gen/sdk.gen.js',
  },
  {
    leg: 'permission',
    httpMethod: 'DELETE',
    path: '/api/permission/saved/{id}',
    status: 'verified',
    evidence: 'sdk@1.18.16 dist/v2/gen/sdk.gen.js',
  },
  {
    leg: 'permission',
    httpMethod: 'GET',
    path: '/api/session/{sessionID}/permission',
    status: 'verified',
    evidence: 'sdk@1.18.16 dist/v2/gen/sdk.gen.js',
  },
  {
    leg: 'permission',
    httpMethod: 'GET',
    path: '/api/session/{sessionID}/permission/{requestID}',
    status: 'verified',
    evidence: 'sdk@1.18.16 dist/v2/gen/sdk.gen.js',
  },
  {
    leg: 'permission',
    httpMethod: 'POST',
    path: '/permission/{requestID}/reply',
    status: 'verified',
    evidence: 'sdk@1.18.16 dist/v2/gen/sdk.gen.js; reply: "once" | "always" | "reject" (types.gen.d.ts L5905-5911)',
  },
  {
    leg: 'rpc',
    httpMethod: 'POST',
    path: '/api/rpc/{rpcID}/{method}',
    status: 'absent',
    evidence:
      'no `rpc` token in the installed sdk@1.18.16 generated client (188 `url:` entries / 162 unique paths, 0 `rpc` matches) or in @opencode-ai/plugin@1.18.16 dist, and no `./rpc` package export',
  },
  {
    leg: 'pty',
    httpMethod: 'POST',
    path: '/api/pty/{ptyID}/connect-token',
    status: 'verified',
    evidence: 'sdk@1.18.16 dist/v2/gen/sdk.gen.js url: "/api/pty/{ptyID}/connect-token"',
  },
  {
    leg: 'pty',
    httpMethod: 'GET',
    path: '/api/pty/{ptyID}/connect',
    status: 'verified',
    evidence: 'sdk@1.18.16 dist/v2/gen/sdk.gen.js url: "/api/pty/{ptyID}/connect"',
  },
  {
    leg: 'pty',
    httpMethod: 'POST',
    path: '/api/pty',
    status: 'verified',
    evidence: 'sdk@1.18.16 dist/v2/gen/sdk.gen.js url: "/api/pty"',
  },
  {
    leg: 'pty',
    httpMethod: 'DELETE',
    path: '/api/pty/{ptyID}',
    status: 'verified',
    evidence: 'sdk@1.18.16 dist/v2/gen/sdk.gen.js url: "/api/pty/{ptyID}"',
  },
  {
    leg: 'pairing',
    httpMethod: 'POST',
    path: '/api/pair',
    status: 'absent',
    evidence:
      'no `/pair` route and no `pairing` identifier in sdk@1.18.16 dist (only the /auth/{providerID} route exists; the `Pair` matches are unrelated bodySerializer helpers)',
  },
  {
    leg: 'pairing',
    httpMethod: 'GET',
    path: '/auth/connect/{code}',
    status: 'absent',
    evidence:
      'sdk@1.18.16 exposes /auth/{providerID} only; no /auth/connect route',
  },
  {
    leg: 'worktree',
    httpMethod: 'GET',
    path: '/experimental/worktree',
    status: 'verified',
    evidence:
      'sdk@1.18.16 dist/v2/gen/sdk.gen.js url: "/experimental/worktree" — experimental prefix, not the documented /api/worktree',
  },
  {
    leg: 'worktree',
    httpMethod: 'POST',
    path: '/experimental/worktree',
    status: 'verified',
    evidence: 'sdk@1.18.16 dist/v2/gen/sdk.gen.js',
  },
  {
    leg: 'worktree',
    httpMethod: 'DELETE',
    path: '/experimental/worktree',
    status: 'verified',
    evidence: 'sdk@1.18.16 dist/v2/gen/sdk.gen.js',
  },
  {
    leg: 'worktree',
    httpMethod: 'POST',
    path: '/experimental/worktree/reset',
    status: 'verified',
    evidence: 'sdk@1.18.16 dist/v2/gen/sdk.gen.js url: "/experimental/worktree/reset"',
  },
] as const

export interface RetireGateEvaluation {
  /** Legs that must reach parity before fleet-ui is retired. */
  requiredLegs: readonly ParityLeg[]
  /** Legs with at least one verified endpoint. */
  satisfiedLegs: readonly ParityLeg[]
  /** `requiredLegs` with no verified endpoint — the gate stays closed. */
  blockingLegs: readonly ParityLeg[]
  satisfied: boolean
  /** Capabilities that must reach parity on those legs. */
  requiredCapabilities: readonly string[]
  note: string
}

/**
 * The fleet-ui retire gate, evaluated from installed evidence. Pure: give it a
 * different endpoint table and it re-evaluates.
 */
export function evaluateRetireGate(
  endpoints: readonly ParityEndpoint[] = WEB_PARITY_ENDPOINTS,
  requiredLegs: readonly ParityLeg[] = ['event', 'rpc', 'pty'],
): RetireGateEvaluation {
  const satisfied: ParityLeg[] = []
  const blocking: ParityLeg[] = []
  for (const leg of requiredLegs) {
    const hasVerified = endpoints.some(
      (e) => e.leg === leg && e.status === 'verified',
    )
    if (hasVerified) satisfied.push(leg)
    else blocking.push(leg)
  }
  return {
    requiredLegs,
    satisfiedLegs: satisfied,
    blockingLegs: blocking,
    satisfied: blocking.length === 0,
    requiredCapabilities: ['board', 'panel', 'slash', 'approve'],
    note: 'Retire the custom fleet-ui server (127.0.0.1:4649, Bun.serve) ONLY after the board, session panel, /supervisor slash command and approve flow reach parity over the verified legs. Anything not satisfied stays on fleet-ui.',
  }
}

export const FLEET_UI_RETIRE_GATE: RetireGateEvaluation = evaluateRetireGate()

// ---------------------------------------------------------------------------
// Aggregate registration payload
// ---------------------------------------------------------------------------

export interface SupervisorTuiDefs {
  id: string
  export: string
  route: TuiRouteDef
  navigate: TuiNavigateDef
  panel: TuiPanelDef
  slash: TuiSlashDef
  keymap: TuiKeymapRegistrationDef
  events: readonly TuiEventSubDef[]
  attention: TuiAttentionDef
  confirms: readonly TuiConfirmDef[]
  parity: readonly ParityEndpoint[]
  retireGate: RetireGateEvaluation
  evidence: readonly TuiSurfaceEvidence[]
}

/** The single payload a verified installer would consume. */
export const TUI_DEFS: SupervisorTuiDefs = {
  id: TUI_PLUGIN_ID,
  export: TUI_PLUGIN_EXPORT,
  route: SUPERVISOR_ROUTE_DEF,
  navigate: SUPERVISOR_NAVIGATE_DEF,
  panel: SUPERVISOR_PANEL_DEF,
  slash: SUPERVISOR_SLASH_DEF,
  keymap: SUPERVISOR_KEYMAP_DEF,
  events: SUPERVISOR_EVENT_SUBS,
  attention: SUPERVISOR_ATTENTION_DEF,
  confirms: SUPERVISOR_CONFIRM_DEFS,
  parity: WEB_PARITY_ENDPOINTS,
  retireGate: FLEET_UI_RETIRE_GATE,
  evidence: TUI_SURFACE_EVIDENCE,
}

/** RPC methods this TUI layer is allowed to dispatch. */
export const TUI_DISPATCHABLE_METHODS: readonly RpcMethod[] = [
  ...new Set<RpcMethod>([
    ...SUPERVISOR_SLASH_DEF.dispatches,
    ...keymapMethods(),
    'run.sweep',
  ]),
]

/** Every dispatchable method must exist in the RPC surface. */
export function unimplementedDispatches(): string[] {
  return TUI_DISPATCHABLE_METHODS.filter(
    (method) => !(RPC_METHODS as readonly string[]).includes(method),
  )
}
