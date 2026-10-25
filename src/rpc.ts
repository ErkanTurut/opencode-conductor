// Supervisor RPC surface — typed, pure, testable, no UI dependencies.
//
// provenance: omo-comparison idea 3
// Provenance: the bounded-verb-per-state shaping and the dry-run sweep plan
// follow the OmO comparison notes (idea 3 — rounds/sweep slot and evidence
// gating). Patterns only: no upstream source was copied. License: SUL-1.0.
//
// SCOPE AND AUTHORITY (read before extending)
// This module is a typed method table over the EXISTING ledger verbs. It adds
// no new write authority:
//   - read methods      -> getRun / listWorkItems / getLatestAttempt / getLease
//                          / getApprovals / generateReceipt (all projection reads)
//   - task.approve      -> createApproval (the dedicated gate-audit verb) and an
//                          optional releaseLease restricted to already-expired leases
//   - task.retry        -> transitionWorkItemState + Scheduler.markReadyItems
//   - run.sweep         -> listExpiredLeases / listStaleHeartbeats + releaseLease
//                          + transitionWorkItemState + appendEvent
// Every write is one of the verbs ILedger already exposes and that the runner /
// watchdog already call. No event taxonomy is invented: only the existing
// `lease_expired` and `work_item_state_transition` event types are appended.
//
// VIEW ASSEMBLY IS PROJECTION-ONLY
// Anything that feeds a board, panel or card is a pure read. The write verbs
// below are only ever invoked by an explicit caller action — never during a
// render or a subscription callback.
//
// RUNTIME NOTE (NO API INVENTION)
// The `POST /api/rpc/{rpcID}/{method}` server endpoint and the `./rpc` package
// export are NOT present in the installed opencode packages (see
// src/tui/README.md for the probe evidence). This file therefore registers
// itself nowhere. It is the pure implementation a future verified RPC mount —
// or the TUI action layer — can call directly. Do not add a runtime import of
// an opencode surface here.
import type { ILedger } from './ledger/interface'
import type {
  ApprovalRow,
  AttemptRow,
  LeaseRow,
  RunRow,
  WorkItemRow,
} from './ledger/types'
import { generateReceipt } from './receipt'
import type { ReceiptData } from './receipt'
import { Scheduler } from './scheduler'
import { DEFAULT_BUDGET } from './types'

// ---------------------------------------------------------------------------
// Method registry
// ---------------------------------------------------------------------------

export const RPC_METHODS = [
  'run.status',
  'task.approve',
  'task.retry',
  'run.receipt',
  'run.sweep',
] as const

export type RpcMethod = (typeof RPC_METHODS)[number]

export type RpcMethodKind = 'read' | 'write'

export interface RpcMethodSpec {
  method: RpcMethod
  kind: RpcMethodKind
  params: readonly string[]
  /** Ledger verbs this method may call. Empty for pure reads. */
  writes: readonly string[]
  summary: string
}

/**
 * Single source of truth for the RPC surface. The TUI definitions
 * (src/tui/index.ts) reference these names; they are not duplicated there.
 */
export const RPC_METHOD_SPECS: readonly RpcMethodSpec[] = [
  {
    method: 'run.status',
    kind: 'read',
    params: ['runId'],
    writes: [],
    summary: 'Run summary plus every task with its state, latest attempt and lease.',
  },
  {
    method: 'task.approve',
    kind: 'write',
    params: ['taskId', 'actor?', 'gate?', 'releaseStaleLease?'],
    writes: ['createApproval', 'getApprovals', 'releaseLease'],
    summary:
      'Record a gate approval for the task\u2019s run (optional release of an already-expired lease).',
  },
  {
    method: 'task.retry',
    kind: 'write',
    params: ['taskId', 'actor?'],
    writes: ['transitionWorkItemState', 'appendEvent', 'markReadyItems'],
    summary: 'Re-dispatch a failed/blocked/interrupted task back through the ready queue.',
  },
  {
    method: 'run.receipt',
    kind: 'read',
    params: ['runId'],
    writes: [],
    summary: 'Aggregate the run receipt (objective, verification, findings, risks).',
  },
  {
    method: 'run.sweep',
    kind: 'write',
    params: ['runId?', 'dryRun?', 'staleHeartbeatMaxAgeMs?', 'actor?'],
    writes: ['listExpiredLeases', 'listStaleHeartbeats', 'releaseLease', 'transitionWorkItemState', 'appendEvent'],
    summary:
      'Release expired leases and interrupt stale running tasks; `dryRun` plans without writing.',
  },
] as const

// ---------------------------------------------------------------------------
// Errors and results
// ---------------------------------------------------------------------------

export type RpcErrorCode =
  | 'invalid_params'
  | 'unknown_method'
  | 'not_found'
  | 'conflict'
  | 'budget_exhausted'

export interface RpcError {
  code: RpcErrorCode
  message: string
}

export type RpcResult<T> =
  | { ok: true; method: RpcMethod; value: T }
  | { ok: false; method: RpcMethod; error: RpcError }

/** Work-item states a `task.retry` is allowed to leave. */
export const TASK_RETRYABLE_STATES = ['failed', 'blocked', 'interrupted'] as const
export type TaskRetryableState = (typeof TASK_RETRYABLE_STATES)[number]

/** Default staleness window, mirroring the watchdog's own default. */
export const DEFAULT_STALE_HEARTBEAT_MAX_AGE_MS = 45_000

// ---------------------------------------------------------------------------
// View models (projection reads only)
// ---------------------------------------------------------------------------

export interface RpcRunSummary {
  id: string
  state: string
  riskClass: string
  dataClass: string
  operationMode: string
  policyProfile: string
  objective: string
  parentId: string | null
  createdAt: string
  updatedAt: string
  deadlineAt: string | null
  terminalReason: string | null
  hasPlan: boolean
  hasReceipt: boolean
}

export interface RpcAttemptSummary {
  id: string
  attemptNo: number
  state: string
  provider: string
  model: string
  variant: string | null
  exitCode: number | null
  failureClass: string | null
  startedAt: string | null
  finishedAt: string | null
}

export interface RpcLeaseSummary {
  owner: string
  expiresAt: string
  heartbeatAt: string
  fencingToken: number
  expired: boolean
  releasedAt: string | null
}

export interface RpcTaskSummary {
  id: string
  runId: string
  title: string
  ownerRole: string
  modelSlot: string
  state: string
  priority: number
  attempts: number
  dependencies: string[]
  latestAttempt: RpcAttemptSummary | null
  lease: RpcLeaseSummary | null
  /** Gates recorded for this run whose name contains the task id (or `task:{id}`). */
  approvalGates: string[]
}

export interface RpcApprovalSummary {
  id: string
  gate: string
  decision: string
  actor: string
  createdAt: string
  expiresAt: string | null
}

export interface RpcRunCounts {
  tasks: number
  byState: Record<string, number>
  attempts: number
  expiredLeases: number
  approvals: number
}

export interface RpcRunStatusValue {
  run: RpcRunSummary
  tasks: RpcTaskSummary[]
  approvals: RpcApprovalSummary[]
  counts: RpcRunCounts
}

// ---------------------------------------------------------------------------
// Params / values
// ---------------------------------------------------------------------------

export interface RunStatusParams {
  runId: string
}

export interface TaskApproveParams {
  taskId: string
  actor?: string
  /**
   * Explicit gate name. When omitted the gate is derived from the run state
   * (`plan` for `awaiting_plan_approval`, `merge` for
   * `awaiting_merge_approval`); any other run state without an explicit gate is
   * a `conflict` — an approval is never recorded silently.
   */
  gate?: string
  /**
   * Release the task's lease when (and only when) it is already expired and
   * unreleased. Default false: releasing a lease a live worker still holds
   * would strand that worker.
   */
  releaseStaleLease?: boolean
}

export interface TaskApproveValue {
  taskId: string
  runId: string
  gate: string
  decision: 'approved'
  approvalId: string
  /** True when an identical `approved` row already existed for this gate (append-only audit). */
  duplicate: boolean
  releasedLease: boolean
}

export interface TaskRetryParams {
  taskId: string
  actor?: string
}

export interface TaskRetryValue {
  taskId: string
  runId: string
  from: string
  /** `ready` when dependencies are already satisfied, else `pending`. */
  to: 'ready' | 'pending'
  attempts: number
  maxAttempts: number
}

export interface RunReceiptParams {
  runId: string
}

export interface RunSweepParams {
  /** Restrict the sweep to one run. Without it, lease-level sweeps are ledger-wide. */
  runId?: string
  /** Plan only: nothing is written. */
  dryRun?: boolean
  staleHeartbeatMaxAgeMs?: number
  actor?: string
}

export type SweepActionKind = 'release_lease' | 'mark_interrupted' | 'record_event'

export interface SweepAction {
  kind: SweepActionKind
  workItemId: string
  runId: string | null
  reason: string
  fencingToken?: number
  /** False only when `dryRun` suppressed the write. */
  applied: boolean
}

export interface RunSweepValue {
  dryRun: boolean
  runId: string | null
  staleHeartbeatMaxAgeMs: number
  actions: SweepAction[]
  counts: { releasedLeases: number; interrupted: number; events: number }
}

// ---------------------------------------------------------------------------
// Param guards (no zod dependency in this package)
// ---------------------------------------------------------------------------

type Guard<T> = { ok: true; value: T } | { ok: false; message: string }

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

function requireString(
  params: Record<string, unknown>,
  key: string,
): Guard<string> {
  const raw = params[key]
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { ok: false, message: `\`${key}\` is required and must be a non-empty string` }
  }
  return { ok: true, value: raw }
}

function optionalString(
  params: Record<string, unknown>,
  key: string,
): Guard<string | undefined> {
  const raw = params[key]
  if (raw === undefined || raw === null) return { ok: true, value: undefined }
  if (typeof raw !== 'string') {
    return { ok: false, message: `\`${key}\` must be a string when present` }
  }
  return { ok: true, value: raw }
}

function optionalBoolean(
  params: Record<string, unknown>,
  key: string,
): Guard<boolean | undefined> {
  const raw = params[key]
  if (raw === undefined || raw === null) return { ok: true, value: undefined }
  if (typeof raw !== 'boolean') {
    return { ok: false, message: `\`${key}\` must be a boolean when present` }
  }
  return { ok: true, value: raw }
}

function optionalNumber(
  params: Record<string, unknown>,
  key: string,
): Guard<number | undefined> {
  const raw = params[key]
  if (raw === undefined || raw === null) return { ok: true, value: undefined }
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) {
    return { ok: false, message: `\`${key}\` must be a non-negative number when present` }
  }
  return { ok: true, value: raw }
}

function parseStringArray(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json)
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

function isExpiredLease(lease: LeaseRow, nowIso: string): boolean {
  return lease.released_at === null && lease.lease_expires_at < nowIso
}

function runBudget(run: RunRow | null): { maxAttempts: number } {
  let overrides: Partial<{ max_attempts_per_task: number }> = {}
  try {
    overrides = JSON.parse(run?.budget_json || '{}')
  } catch {
    overrides = {}
  }
  return {
    maxAttempts:
      overrides.max_attempts_per_task ?? DEFAULT_BUDGET.max_attempts_per_task,
  }
}

/** Gate implied by a run state, or null when the run is not awaiting approval. */
export function gateForRunState(state: string): string | null {
  if (state === 'awaiting_plan_approval') return 'plan'
  if (state === 'awaiting_merge_approval') return 'merge'
  return null
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export interface SupervisorRpcDeps {
  ledger: ILedger
  /** Injectable clock (tests); defaults to `new Date()`. */
  now?: () => Date
  /** Injectable id source (tests); defaults to a timestamp+random scheme. */
  newId?: (prefix: string) => string
}

export interface SupervisorRpc {
  readonly methods: readonly RpcMethod[]
  readonly specs: readonly RpcMethodSpec[]
  runStatus(params: RunStatusParams): Promise<RpcResult<RpcRunStatusValue>>
  taskApprove(params: TaskApproveParams): Promise<RpcResult<TaskApproveValue>>
  taskRetry(params: TaskRetryParams): Promise<RpcResult<TaskRetryValue>>
  runReceipt(params: RunReceiptParams): Promise<RpcResult<ReceiptData>>
  runSweep(params: RunSweepParams): Promise<RpcResult<RunSweepValue>>
  invoke(method: string, params: unknown): Promise<RpcResult<unknown>>
}

export function createSupervisorRpc(deps: SupervisorRpcDeps): SupervisorRpc {
  const ledger = deps.ledger
  const now = deps.now ?? (() => new Date())
  const newId =
    deps.newId ??
    ((prefix: string) =>
      `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  const scheduler = new Scheduler(ledger)

  function fail<T>(method: RpcMethod, code: RpcErrorCode, message: string): RpcResult<T> {
    return { ok: false, method, error: { code, message } }
  }

  function ok<T>(method: RpcMethod, value: T): RpcResult<T> {
    return { ok: true, method, value }
  }

  async function toAttemptSummary(
    attempt: AttemptRow | null,
  ): Promise<RpcAttemptSummary | null> {
    if (!attempt) return null
    return {
      id: attempt.id,
      attemptNo: attempt.attempt_no,
      state: attempt.state,
      provider: attempt.model_provider,
      model: attempt.model_id,
      variant: attempt.model_variant,
      exitCode: attempt.exit_code,
      failureClass: attempt.failure_class,
      startedAt: attempt.started_at,
      finishedAt: attempt.finished_at,
    }
  }

  function toLeaseSummary(lease: LeaseRow | null, nowIso: string): RpcLeaseSummary | null {
    if (!lease) return null
    return {
      owner: lease.lease_owner,
      expiresAt: lease.lease_expires_at,
      heartbeatAt: lease.heartbeat_at,
      fencingToken: lease.fencing_token,
      expired: isExpiredLease(lease, nowIso),
      releasedAt: lease.released_at,
    }
  }

  function toRunSummary(run: RunRow): RpcRunSummary {
    return {
      id: run.id,
      state: run.state,
      riskClass: run.risk_class,
      dataClass: run.data_class,
      operationMode: run.operation_mode,
      policyProfile: run.policy_profile,
      objective: run.request_text,
      parentId: run.parent_id,
      createdAt: run.created_at,
      updatedAt: run.updated_at,
      deadlineAt: run.deadline_at,
      terminalReason: run.terminal_reason,
      hasPlan: run.plan_json !== null,
      hasReceipt: run.receipt_json !== null,
    }
  }

  function toApprovalSummary(row: ApprovalRow): RpcApprovalSummary {
    return {
      id: row.id,
      gate: row.gate,
      decision: row.decision,
      actor: row.actor,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    }
  }

  async function toTaskSummary(
    item: WorkItemRow,
    nowIso: string,
    gates: readonly string[],
  ): Promise<RpcTaskSummary> {
    const attempt = await ledger.getLatestAttempt(item.id)
    const lease = await ledger.getLease(item.id)
    return {
      id: item.id,
      runId: item.run_id,
      title: item.title,
      ownerRole: item.owner_role,
      modelSlot: item.model_slot,
      state: item.state,
      priority: item.priority,
      attempts: item.attempts,
      dependencies: parseStringArray(item.dependency_json),
      latestAttempt: await toAttemptSummary(attempt),
      lease: toLeaseSummary(lease, nowIso),
      approvalGates: gates.filter(
        (gate) => gate === item.id || gate.includes(item.id),
      ),
    }
  }

  async function runStatus(params: RunStatusParams): Promise<RpcResult<RpcRunStatusValue>> {
    const method: RpcMethod = 'run.status'
    const raw = asRecord(params)
    if (!raw) return fail(method, 'invalid_params', 'params must be an object')
    const runIdGuard = requireString(raw, 'runId')
    if (!runIdGuard.ok) return fail(method, 'invalid_params', runIdGuard.message)

    const run = await ledger.getRun(runIdGuard.value)
    if (!run) return fail(method, 'not_found', `run ${runIdGuard.value} not found`)

    const nowIso = now().toISOString()
    const [items, approvalRows] = await Promise.all([
      ledger.listWorkItems(run.id),
      ledger.getApprovals(run.id),
    ])
    const gates = approvalRows.map((a) => a.gate)

    const tasks: RpcTaskSummary[] = []
    for (const item of items) {
      tasks.push(await toTaskSummary(item, nowIso, gates))
    }

    const byState: Record<string, number> = {}
    let attempts = 0
    let expiredLeases = 0
    for (const task of tasks) {
      byState[task.state] = (byState[task.state] ?? 0) + 1
      attempts += task.attempts
      if (task.lease?.expired) expiredLeases += 1
    }

    return ok(method, {
      run: toRunSummary(run),
      tasks,
      approvals: approvalRows.map(toApprovalSummary),
      counts: {
        tasks: tasks.length,
        byState,
        attempts,
        expiredLeases,
        approvals: approvalRows.length,
      },
    })
  }

  async function taskApprove(params: TaskApproveParams): Promise<RpcResult<TaskApproveValue>> {
    const method: RpcMethod = 'task.approve'
    const raw = asRecord(params)
    if (!raw) return fail(method, 'invalid_params', 'params must be an object')
    const taskIdGuard = requireString(raw, 'taskId')
    if (!taskIdGuard.ok) return fail(method, 'invalid_params', taskIdGuard.message)
    const actorGuard = optionalString(raw, 'actor')
    if (!actorGuard.ok) return fail(method, 'invalid_params', actorGuard.message)
    const gateGuard = optionalString(raw, 'gate')
    if (!gateGuard.ok) return fail(method, 'invalid_params', gateGuard.message)
    const releaseGuard = optionalBoolean(raw, 'releaseStaleLease')
    if (!releaseGuard.ok) return fail(method, 'invalid_params', releaseGuard.message)

    const item = await ledger.getWorkItem(taskIdGuard.value)
    if (!item) return fail(method, 'not_found', `task ${taskIdGuard.value} not found`)
    const run = await ledger.getRun(item.run_id)
    if (!run) return fail(method, 'not_found', `run ${item.run_id} not found`)

    const gate = gateGuard.value ?? gateForRunState(run.state)
    if (!gate) {
      return fail(
        method,
        'conflict',
        `run ${run.id} is in state \`${run.state}\` which has no pending approval gate; pass \`gate\` explicitly`,
      )
    }

    const actor = actorGuard.value ?? 'supervisor.rpc'
    const existing = await ledger.getApprovals(run.id, gate)
    const duplicate = existing.some((a) => a.decision === 'approved')

    const approval = await ledger.createApproval({
      id: newId(`appr-${run.id}-${gate}`),
      runId: run.id,
      gate,
      decision: 'approved',
      actor,
      policyHash: run.effective_workflow_hash ?? undefined,
    })

    // Optional, deliberately narrow: only an already-expired, unreleased lease
    // is released. A live worker keeps its lease and its fencing token.
    let releasedLease = false
    if (releaseGuard.value === true) {
      const lease = await ledger.getLease(item.id)
      if (lease && isExpiredLease(lease, now().toISOString())) {
        releasedLease = await ledger.releaseLease(item.id, lease.fencing_token)
      }
    }

    return ok(method, {
      taskId: item.id,
      runId: run.id,
      gate,
      decision: 'approved',
      approvalId: approval.id,
      duplicate,
      releasedLease,
    })
  }

  async function taskRetry(params: TaskRetryParams): Promise<RpcResult<TaskRetryValue>> {
    const method: RpcMethod = 'task.retry'
    const raw = asRecord(params)
    if (!raw) return fail(method, 'invalid_params', 'params must be an object')
    const taskIdGuard = requireString(raw, 'taskId')
    if (!taskIdGuard.ok) return fail(method, 'invalid_params', taskIdGuard.message)
    const actorGuard = optionalString(raw, 'actor')
    if (!actorGuard.ok) return fail(method, 'invalid_params', actorGuard.message)

    const item = await ledger.getWorkItem(taskIdGuard.value)
    if (!item) return fail(method, 'not_found', `task ${taskIdGuard.value} not found`)
    const run = await ledger.getRun(item.run_id)

    if (!(TASK_RETRYABLE_STATES as readonly string[]).includes(item.state)) {
      return fail(
        method,
        'conflict',
        `task ${item.id} is in state \`${item.state}\`; retry is only allowed from ${TASK_RETRYABLE_STATES.join(', ')}`,
      )
    }

    const { maxAttempts } = runBudget(run)
    if (item.attempts >= maxAttempts) {
      return fail(
        method,
        'budget_exhausted',
        `task ${item.id} has used ${item.attempts}/${maxAttempts} attempts`,
      )
    }

    const actor = actorGuard.value ?? 'supervisor.rpc'

    await ledger.transitionWorkItemState(item.id, 'pending')
    await ledger.appendEvent({
      runId: item.run_id,
      workItemId: item.id,
      eventType: 'work_item_state_transition',
      actor,
      payloadJson: JSON.stringify({
        from: item.state,
        to: 'pending',
        source: method,
      }),
    })
    // Reuse the scheduler's own ready-marking (dependency + state rules) rather
    // than re-implementing dispatch admission here. The reported `to` is read
    // back from the ledger afterwards, so it states what happened instead of
    // restating the dependency rule a second time.
    await scheduler.markReadyItems(item.run_id)

    const after = await ledger.getWorkItem(item.id)
    return ok(method, {
      taskId: item.id,
      runId: item.run_id,
      from: item.state,
      // Only `pending` -> `ready` can follow the transition above, so this is
      // total: any other observed state is reported as `pending`.
      to: after?.state === 'ready' ? 'ready' : 'pending',
      attempts: after?.attempts ?? item.attempts,
      maxAttempts,
    })
  }

  async function runReceipt(params: RunReceiptParams): Promise<RpcResult<ReceiptData>> {
    const method: RpcMethod = 'run.receipt'
    const raw = asRecord(params)
    if (!raw) return fail(method, 'invalid_params', 'params must be an object')
    const runIdGuard = requireString(raw, 'runId')
    if (!runIdGuard.ok) return fail(method, 'invalid_params', runIdGuard.message)

    const run = await ledger.getRun(runIdGuard.value)
    if (!run) return fail(method, 'not_found', `run ${runIdGuard.value} not found`)

    return ok(method, await generateReceipt(run.id, ledger))
  }

  async function runSweep(params: RunSweepParams): Promise<RpcResult<RunSweepValue>> {
    const method: RpcMethod = 'run.sweep'
    const raw = asRecord(params ?? {})
    if (!raw) return fail(method, 'invalid_params', 'params must be an object')
    const runIdGuard = optionalString(raw, 'runId')
    if (!runIdGuard.ok) return fail(method, 'invalid_params', runIdGuard.message)
    const dryRunGuard = optionalBoolean(raw, 'dryRun')
    if (!dryRunGuard.ok) return fail(method, 'invalid_params', dryRunGuard.message)
    const maxAgeGuard = optionalNumber(raw, 'staleHeartbeatMaxAgeMs')
    if (!maxAgeGuard.ok) return fail(method, 'invalid_params', maxAgeGuard.message)
    const actorGuard = optionalString(raw, 'actor')
    if (!actorGuard.ok) return fail(method, 'invalid_params', actorGuard.message)

    const scopeRunId = runIdGuard.value ?? null
    if (scopeRunId !== null) {
      const run = await ledger.getRun(scopeRunId)
      if (!run) return fail(method, 'not_found', `run ${scopeRunId} not found`)
    }

    const dryRun = dryRunGuard.value === true
    const staleHeartbeatMaxAgeMs =
      maxAgeGuard.value ?? DEFAULT_STALE_HEARTBEAT_MAX_AGE_MS
    const actor = actorGuard.value ?? 'supervisor.rpc'

    // Resolve each scoped work item once (and its run) so a ledger-wide read
    // can still be narrowed to one run without a second ledger verb.
    const itemCache = new Map<string, WorkItemRow | null>()
    async function resolveItem(id: string): Promise<WorkItemRow | null> {
      if (!itemCache.has(id)) itemCache.set(id, await ledger.getWorkItem(id))
      return itemCache.get(id) ?? null
    }

    function inScope(item: WorkItemRow | null): boolean {
      if (scopeRunId === null) return true
      return item !== null && item.run_id === scopeRunId
    }

    const expired = await ledger.listExpiredLeases()
    const stale = await ledger.listStaleHeartbeats(staleHeartbeatMaxAgeMs)

    const actions: SweepAction[] = []
    // Work items already accounted for by the expired-lease pass. Tracked even
    // under `dryRun` so the plan is deterministic and a lease that is both
    // expired and stale is never reported twice.
    const handled = new Set<string>()
    let releasedLeases = 0
    let interruptedCount = 0
    let eventCount = 0

    // 1. Expired, unreleased leases -> release (existing verb, bounded to
    //    leases the claim SQL already treats as reclaimable).
    for (const lease of expired) {
      const item = await resolveItem(lease.work_item_id)
      if (!inScope(item)) continue
      handled.add(lease.work_item_id)
      let applied = false
      if (!dryRun) {
        applied = await ledger.releaseLease(
          lease.work_item_id,
          lease.fencing_token,
        )
        if (applied) releasedLeases += 1
        await ledger.appendEvent({
          runId: item?.run_id ?? scopeRunId ?? 'sweep',
          workItemId: lease.work_item_id,
          eventType: 'lease_expired',
          actor,
          payloadJson: JSON.stringify({
            reason: 'lease_expired',
            source: method,
            leaseOwner: lease.lease_owner,
            fencingToken: lease.fencing_token,
          }),
        })
        eventCount += 1
      }
      actions.push({
        kind: 'release_lease',
        workItemId: lease.work_item_id,
        runId: item?.run_id ?? null,
        reason: 'lease_expired',
        fencingToken: lease.fencing_token,
        applied,
      })
    }

    // 2. Stale heartbeats -> interrupt a still-`running` task (mirrors
    //    Runner.reconcile). The lease itself is NOT released here: the worker
    //    may still be alive, and only its own fencing token may release it.
    for (const lease of stale) {
      if (handled.has(lease.work_item_id)) continue
      const item = await resolveItem(lease.work_item_id)
      if (!inScope(item)) continue
      handled.add(lease.work_item_id)

      if (!dryRun) {
        await ledger.appendEvent({
          runId: item?.run_id ?? scopeRunId ?? 'sweep',
          workItemId: lease.work_item_id,
          eventType: 'lease_expired',
          actor,
          payloadJson: JSON.stringify({
            reason: 'stale_heartbeat',
            source: method,
            leaseOwner: lease.lease_owner,
            fencingToken: lease.fencing_token,
          }),
        })
        eventCount += 1
      }

      if (item && item.state === 'running') {
        if (!dryRun) {
          await ledger.transitionWorkItemState(item.id, 'interrupted')
          interruptedCount += 1
        }
        actions.push({
          kind: 'mark_interrupted',
          workItemId: item.id,
          runId: item.run_id,
          reason: 'stale_heartbeat',
          fencingToken: lease.fencing_token,
          applied: !dryRun,
        })
      } else {
        actions.push({
          kind: 'record_event',
          workItemId: lease.work_item_id,
          runId: item?.run_id ?? null,
          reason: 'stale_heartbeat_observed',
          fencingToken: lease.fencing_token,
          applied: !dryRun,
        })
      }
    }

    return ok(method, {
      dryRun,
      runId: scopeRunId,
      staleHeartbeatMaxAgeMs,
      actions,
      counts: { releasedLeases, interrupted: interruptedCount, events: eventCount },
    })
  }

  async function invoke(method: string, params: unknown): Promise<RpcResult<unknown>> {
    switch (method) {
      case 'run.status':
        return runStatus(params as RunStatusParams)
      case 'task.approve':
        return taskApprove(params as TaskApproveParams)
      case 'task.retry':
        return taskRetry(params as TaskRetryParams)
      case 'run.receipt':
        return runReceipt(params as RunReceiptParams)
      case 'run.sweep':
        return runSweep(params as RunSweepParams)
      default:
        return {
          ok: false,
          method: method as RpcMethod,
          error: {
            code: 'unknown_method',
            message: `unknown method \`${method}\`; known: ${RPC_METHODS.join(', ')}`,
          },
        }
    }
  }

  return {
    methods: RPC_METHODS,
    specs: RPC_METHOD_SPECS,
    runStatus,
    taskApprove,
    taskRetry,
    runReceipt,
    runSweep,
    invoke,
  }
}
