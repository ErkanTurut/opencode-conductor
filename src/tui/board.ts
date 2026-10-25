// Supervisor TUI board + panel models.
//
// WHY .ts AND NOT .tsx (verified, not assumed)
// The route/panel render surface in the installed `@opencode-ai/plugin` is
// `render: (input) => JSX.Element`, and `JSX` is imported from `@opentui/solid`
// (dist/tui.d.ts L5), alongside `CliRenderer`/`Renderable`/`KeyEvent` from
// `@opentui/core` and `Keymap` from `@opentui/keymap`. All three of those peer
// packages are absent everywhere:
//   - this package declares no `@opentui/*` dependency, and any `node_modules`
//     it has comes only from its own `package.json`.
//   - the repo root does have `react@19.2.7` and `solid-js@1.9.13`, but neither
//     provides the `@opentui/solid` JSX namespace or the OpenTUI renderable
//     intrinsics, and no `@opentui/*` package is installed anywhere.
// Emitting .tsx would therefore require inventing a JSX runtime to compile.
// So this file returns typed view models and never renders. When `@opentui/solid`
// is present, a thin .tsx wrapper can map these models 1:1 onto `ui.*`
// primitives; see src/tui/README.md.
//
// PROJECTION-ONLY
// Every function here is a pure read of an `RpcRunStatusValue` (itself produced
// by the read-only `run.status` projection). Nothing in this file writes,
// claims, releases or sequences anything.
//
// Provenance: the lane/board shaping follows the OmO comparison notes (idea 3 —
// rounds/sweep slot gating). Patterns only; no upstream source copied.
// License: SUL-1.0.
// provenance: omo-comparison idea 3
import type {
  RpcAttemptSummary,
  RpcLeaseSummary,
  RpcRunStatusValue,
  RpcTaskSummary,
} from '../rpc'
import { TASK_RETRYABLE_STATES, gateForRunState } from '../rpc'
import { WORK_ITEM_STATES } from '../types'

// ---------------------------------------------------------------------------
// Lanes
// ---------------------------------------------------------------------------

export interface BoardLane {
  key: string
  title: string
  /** Work-item states that land in this lane. */
  states: readonly string[]
}

/**
 * Ordered lanes. Kept aligned with WORK_ITEM_STATES; `laneCoverage()` proves
 * the alignment in tests so a new work-item state can never silently vanish
 * from the board.
 */
export const BOARD_LANES: readonly BoardLane[] = [
  { key: 'queued', title: 'Queued', states: ['pending', 'ready'] },
  {
    key: 'active',
    title: 'Active',
    states: ['claimed', 'running', 'validating', 'reviewing', 'repairing'],
  },
  { key: 'waiting', title: 'Waiting', states: ['blocked', 'interrupted'] },
  { key: 'done', title: 'Done', states: ['completed'] },
  { key: 'failed', title: 'Failed', states: ['failed'] },
] as const

export interface LaneCoverage {
  ok: boolean
  missing: string[]
  duplicated: string[]
  unknown: string[]
}

/** Pure coverage proof: every WORK_ITEM_STATES member in exactly one lane. */
export function laneCoverage(
  lanes: readonly BoardLane[] = BOARD_LANES,
  states: readonly string[] = WORK_ITEM_STATES,
): LaneCoverage {
  const seen = new Map<string, number>()
  for (const lane of lanes) {
    for (const state of lane.states) {
      seen.set(state, (seen.get(state) ?? 0) + 1)
    }
  }
  const missing = states.filter((s) => !seen.has(s))
  const duplicated = [...seen.entries()]
    .filter(([state, count]) => count > 1 && states.includes(state))
    .map(([state]) => state)
  const unknown = [...seen.keys()].filter((s) => !states.includes(s))
  return {
    ok: missing.length === 0 && duplicated.length === 0 && unknown.length === 0,
    missing,
    duplicated,
    unknown,
  }
}

export function laneForState(state: string): string {
  for (const lane of BOARD_LANES) {
    if (lane.states.includes(state)) return lane.key
  }
  return 'unknown'
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

export type BoardActionTone = 'default' | 'warning' | 'danger'

/** A TUI affordance: it names an existing RPC method, it never inlines a write. */
export interface BoardAction {
  /** RPC method name, e.g. `task.approve`. */
  method: string
  label: string
  key?: string
  enabled: boolean
  tone: BoardActionTone
  /** Why the action is disabled, when it is. */
  reason?: string
}

export interface BoardCard {
  id: string
  title: string
  role: string
  modelSlot: string
  state: string
  lane: string
  priority: number
  attempts: number
  badges: string[]
  actions: BoardAction[]
  task: RpcTaskSummary
}

export interface BoardColumn {
  key: string
  title: string
  cards: BoardCard[]
}

export interface BoardTotals {
  tasks: number
  byState: Record<string, number>
  attempts: number
  expiredLeases: number
}

export interface DestructiveAction {
  id: string
  label: string
  method: string
  tone: BoardActionTone
}

export interface BoardModel {
  runId: string
  runState: string
  objective: string
  /** Route handle for `route.navigate`; params are structured, not JSX. */
  route: { name: 'supervisor'; params: { runId: string } }
  columns: BoardColumn[]
  totals: BoardTotals
  /** Board-level destructive actions, always confirm-dialog gated. */
  destructive: DestructiveAction[]
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export type PanelTone = 'default' | 'muted' | 'warning' | 'error' | 'success'

export interface PanelField {
  label: string
  value: string
  tone?: PanelTone
}

export interface PanelSection {
  title: string
  fields: PanelField[]
}

export interface PanelModel {
  title: string
  subtitle: string
  taskId: string
  task: RpcTaskSummary | null
  sections: PanelSection[]
}

/** Injected projection input: the supervisor hook surface, never a write. */
export interface HookStatus {
  name: string
  active: boolean
  source: 'server' | 'tui' | 'unknown'
}

const DASH = '\u2014'

function attemptFields(attempt: RpcAttemptSummary | null, attempts: number): PanelField[] {
  if (!attempt) {
    return [
      { label: 'attempts', value: String(attempts) },
      { label: 'latest', value: DASH, tone: 'muted' },
    ]
  }
  const tone: PanelTone =
    attempt.state === 'completed'
      ? 'success'
      : attempt.state === 'failed' || attempt.state === 'timed_out'
        ? 'error'
        : 'default'
  return [
    { label: 'attempts', value: String(attempts) },
    { label: 'no', value: String(attempt.attemptNo) },
    { label: 'state', value: attempt.state, tone },
    { label: 'model', value: `${attempt.provider}/${attempt.model}` },
    { label: 'variant', value: attempt.variant ?? DASH, tone: 'muted' },
    {
      label: 'exit',
      value: attempt.exitCode === null ? DASH : String(attempt.exitCode),
      tone: attempt.exitCode === 0 ? 'success' : attempt.exitCode === null ? 'muted' : 'error',
    },
    { label: 'failure', value: attempt.failureClass ?? DASH, tone: attempt.failureClass ? 'error' : 'muted' },
    { label: 'started', value: attempt.startedAt ?? DASH, tone: 'muted' },
    { label: 'finished', value: attempt.finishedAt ?? DASH, tone: 'muted' },
  ]
}

function leaseTone(lease: RpcLeaseSummary): PanelTone {
  if (lease.releasedAt) return 'muted'
  return lease.expired ? 'error' : 'success'
}

function leaseFields(lease: RpcLeaseSummary | null): PanelField[] {
  if (!lease) return [{ label: 'lease', value: 'none', tone: 'muted' }]
  return [
    { label: 'owner', value: lease.owner },
    { label: 'token', value: String(lease.fencingToken) },
    {
      label: 'state',
      value: lease.releasedAt ? 'released' : lease.expired ? 'expired' : 'held',
      tone: leaseTone(lease),
    },
    { label: 'expires', value: lease.expiresAt, tone: lease.expired ? 'error' : 'default' },
    { label: 'heartbeat', value: lease.heartbeatAt, tone: 'muted' },
  ]
}

function hookFields(hooks: readonly HookStatus[]): PanelField[] {
  if (hooks.length === 0) {
    return [{ label: 'hooks', value: DASH, tone: 'muted' }]
  }
  return hooks.map((hook) => ({
    label: `${hook.source}:${hook.name}`,
    value: hook.active ? 'active' : 'inactive',
    tone: hook.active ? 'success' : 'muted',
  }))
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function cardActions(task: RpcTaskSummary, runState: string): BoardAction[] {
  const gate = gateForRunState(runState)
  const retryable = (TASK_RETRYABLE_STATES as readonly string[]).includes(task.state)
  return [
    {
      method: 'task.approve',
      label: 'approve',
      key: 'a',
      enabled: gate !== null,
      tone: 'default',
      reason:
        gate === null
          ? `run is \`${runState}\`; no pending approval gate`
          : undefined,
    },
    {
      method: 'task.retry',
      label: 'retry',
      key: 'r',
      enabled: retryable,
      tone: 'warning',
      reason: retryable
        ? undefined
        : `only ${TASK_RETRYABLE_STATES.join('/')} tasks can be retried`,
    },
    {
      method: 'run.receipt',
      label: 'receipt',
      enabled: true,
      tone: 'default',
    },
  ]
}

function cardBadges(task: RpcTaskSummary): string[] {
  const badges: string[] = []
  if (task.attempts > 0) badges.push(`attempts:${task.attempts}`)
  const attempt = task.latestAttempt
  if (attempt?.failureClass) badges.push(`fail:${attempt.failureClass}`)
  if (attempt && attempt.exitCode !== null && attempt.exitCode !== 0) {
    badges.push(`exit:${attempt.exitCode}`)
  }
  if (task.dependencies.length > 0) badges.push(`deps:${task.dependencies.length}`)
  if (task.lease) {
    badges.push(
      task.lease.releasedAt
        ? 'lease:released'
        : task.lease.expired
          ? 'lease:expired'
          : 'lease:held',
    )
  }
  if (task.approvalGates.length > 0) badges.push(`approved:${task.approvalGates.length}`)
  return badges
}

export function buildTaskCard(task: RpcTaskSummary, runState: string): BoardCard {
  return {
    id: task.id,
    title: task.title,
    role: task.ownerRole,
    modelSlot: task.modelSlot,
    state: task.state,
    lane: laneForState(task.state),
    priority: task.priority,
    attempts: task.attempts,
    badges: cardBadges(task),
    actions: cardActions(task, runState),
    task,
  }
}

/**
 * The board model: a `run.status` projection in, an ordered list of lane
 * columns out. Pure — the same input always yields the same output.
 */
export function buildBoardModel(status: RpcRunStatusValue): BoardModel {
  const columns: BoardColumn[] = BOARD_LANES.map((lane) => ({
    key: lane.key,
    title: lane.title,
    cards: [],
  }))
  const byKey = new Map(columns.map((c) => [c.key, c]))

  const sorted = [...status.tasks].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })

  for (const task of sorted) {
    const card = buildTaskCard(task, status.run.state)
    const column = byKey.get(card.lane) ?? byKey.get('queued')
    column?.cards.push(card)
  }

  return {
    runId: status.run.id,
    runState: status.run.state,
    objective: status.run.objective,
    route: { name: 'supervisor', params: { runId: status.run.id } },
    columns,
    totals: {
      tasks: status.counts.tasks,
      byState: status.counts.byState,
      attempts: status.counts.attempts,
      expiredLeases: status.counts.expiredLeases,
    },
    destructive: [
      {
        id: 'sweep',
        label: 'sweep stale leases',
        method: 'run.sweep',
        tone: 'danger',
      },
    ],
  }
}

/**
 * The session panel model. `hooks` is an injected projection input (the TUI
 * hook surface is not ledger state), so the panel stays projection-only.
 */
export function buildPanelModel(
  status: RpcRunStatusValue,
  taskId: string,
  hooks: readonly HookStatus[] = [],
): PanelModel {
  const task = status.tasks.find((t) => t.id === taskId) ?? null
  const sections: PanelSection[] = [
    {
      title: 'Attempts',
      fields: attemptFields(task?.latestAttempt ?? null, task?.attempts ?? 0),
    },
    { title: 'Hooks', fields: hookFields(hooks) },
    { title: 'Leases', fields: leaseFields(task?.lease ?? null) },
  ]

  return {
    title: task ? `task ${task.id}` : `run ${status.run.id}`,
    subtitle: task
      ? `${task.ownerRole} \u00b7 ${task.state} \u00b7 ${task.title}`
      : `${status.run.state} \u00b7 ${status.run.objective}`,
    taskId,
    task,
    sections,
  }
}
