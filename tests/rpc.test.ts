// Tests for the supervisor RPC surface (src/rpc.ts) and the TUI definition
// layer (src/tui/*).
//
// Strategy: exercise the RPC methods against a real SqliteLedger so every
// assertion is evidence about the actual ledger verbs, and assert the
// authority boundary (reads never write; dryRun never writes; only expired
// leases are released) rather than trusting it by construction.
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rm } from 'node:fs/promises'
import { SqliteLedger } from '../src/ledger/sqlite'
// Integration note: the ledger now enforces the state machine fail-closed
// (t2), so test seeding must walk a LEGAL path instead of jumping straight
// from `created` to a mid-lifecycle state.
import { VALID_TRANSITIONS } from '../src/state-machine'
import {
  RPC_METHODS,
  RPC_METHOD_SPECS,
  TASK_RETRYABLE_STATES,
  createSupervisorRpc,
  gateForRunState,
} from '../src/rpc'
import type { RpcResult, RpcRunStatusValue, SupervisorRpc } from '../src/rpc'
import {
  BOARD_LANES,
  buildBoardModel,
  buildPanelModel,
  laneCoverage,
  laneForState,
} from '../src/tui/board'
import {
  FLEET_UI_RETIRE_GATE,
  SUPERVISOR_ATTENTION_DEF,
  SUPERVISOR_BINDINGS,
  SUPERVISOR_CONFIRM_DEFS,
  SUPERVISOR_EVENT_SUBS,
  SUPERVISOR_KEYMAP_DEFS,
  SUPERVISOR_PANEL_DEF,
  SUPERVISOR_ROUTE_DEF,
  SUPERVISOR_SLASH_DEF,
  TUI_DEFS,
  TUI_SURFACE_EVIDENCE,
  WEB_PARITY_ENDPOINTS,
  evaluateRetireGate,
  unimplementedDispatches,
} from '../src/tui/index'

const RUN = 'run-rpc-test'
const PAST = '2000-01-01T00:00:00.000Z'
const FUTURE = '2999-01-01T00:00:00.000Z'

function uniqueDbPath(): string {
  return join(
    tmpdir(),
    `test-rpc-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  )
}

function unwrap<T>(result: RpcResult<T>): T {
  if (!result.ok) {
    throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`)
  }
  return result.value
}

/**
 * Walk the SHORTEST legal transition path from the run's current state to
 * `target` (BFS over `VALID_TRANSITIONS`). The ledger's transition gate is
 * fail-closed, so fixtures cannot jump states.
 */
async function advanceRunState(
  ledger: SqliteLedger,
  id: string,
  target: string,
): Promise<void> {
  const run = await ledger.getRun(id)
  if (!run || run.state === target) return
  const start = run.state as keyof typeof VALID_TRANSITIONS
  const queue: string[][] = [[start]]
  const seen = new Set<string>([start])
  while (queue.length > 0) {
    const path = queue.shift()!
    const node = path[path.length - 1]
    if (node === target) {
      for (const step of path.slice(1)) {
        await ledger.transitionRunState(id, step)
      }
      return
    }
    for (const next of VALID_TRANSITIONS[node as keyof typeof VALID_TRANSITIONS] ?? []) {
      if (!seen.has(next)) {
        seen.add(next)
        queue.push([...path, next])
      }
    }
  }
  throw new Error(`no legal transition path from ${start} to ${target}`)
}

async function seedRun(
  ledger: SqliteLedger,
  id = RUN,
  state?: string,
): Promise<void> {
  await ledger.createRun({
    id,
    parentId: null,
    repoId: '/test/repo',
    requestHash: 'hash',
    dataClass: 'internal',
    policyProfile: 'assisted',
    operationMode: 'assisted',
    riskClass: 'medium',
    requestText: `Objective for ${id}`,
    budgetJson: '{}',
    deadlineAt: null,
  })
  if (state && state !== 'created') {
    await advanceRunState(ledger, id, state)
  }
}

async function seedItem(
  ledger: SqliteLedger,
  opts: {
    id: string
    runId?: string
    deps?: string[]
    role?: string
    priority?: number
  },
): Promise<void> {
  await ledger.createWorkItem({
    id: opts.id,
    runId: opts.runId ?? RUN,
    issueKey: '',
    title: `Task ${opts.id}`,
    dependencyJson: JSON.stringify(opts.deps ?? []),
    ownerRole: opts.role ?? 'coder',
    modelSlot: 'implementation',
    priority: opts.priority ?? 0,
    writeScopeJson: '[]',
    contractJson: '{}',
    allowedPathsJson: '[]',
    readPathsJson: '[]',
    acceptanceCriteriaJson: '[]',
    verificationCommandsJson: '[]',
  })
}

/** Claim a lease with the given expiry (creates the lease row if needed). */
async function claim(
  ledger: SqliteLedger,
  workItemId: string,
  expiresAt: string,
): Promise<number> {
  const result = await ledger.claimLease({
    workItemId,
    leaseOwner: 'test-worker',
    leaseExpiresAt: expiresAt,
  })
  expect(result.claimed).toBe(true)
  return result.fencingToken
}

async function eventCount(ledger: SqliteLedger, runId = RUN): Promise<number> {
  return (await ledger.getEvents(runId)).length
}

function tick(ms = 5): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe('rpc — method registry', () => {
  it('exposes exactly the five documented methods', () => {
    expect([...RPC_METHODS]).toEqual([
      'run.status',
      'task.approve',
      'task.retry',
      'run.receipt',
      'run.sweep',
    ])
  })

  it('describes every method once, with reads carrying no writes', () => {
    const seen = new Set<string>()
    for (const spec of RPC_METHOD_SPECS) {
      expect(RPC_METHODS).toContain(spec.method)
      expect(seen.has(spec.method)).toBe(false)
      seen.add(spec.method)
      if (spec.kind === 'read') expect(spec.writes).toEqual([])
      else expect(spec.writes.length).toBeGreaterThan(0)
    }
    expect(seen.size).toBe(RPC_METHODS.length)
  })

  it('rejects an unknown method without throwing', async () => {
    const ledger = new SqliteLedger(uniqueDbPath())
    const rpc = createSupervisorRpc({ ledger })
    const result = await rpc.invoke('run.explode', {})
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('unknown_method')
    ledger.close()
  })

  it('maps gates from run state', () => {
    expect(gateForRunState('awaiting_plan_approval')).toBe('plan')
    expect(gateForRunState('awaiting_merge_approval')).toBe('merge')
    expect(gateForRunState('executing')).toBeNull()
  })
})

describe('rpc — run.status (projection read)', () => {
  let ledger: SqliteLedger
  let dbFile: string
  let rpc: SupervisorRpc

  beforeEach(async () => {
    dbFile = uniqueDbPath()
    ledger = new SqliteLedger(dbFile)
    rpc = createSupervisorRpc({ ledger })
    await seedRun(ledger, RUN, 'executing')
  })

  afterEach(async () => {
    ledger.close()
    await rm(dbFile, { force: true })
    await rm(`${dbFile}-wal`, { force: true })
    await rm(`${dbFile}-shm`, { force: true })
  })

  it('returns the run, its tasks, attempts and leases', async () => {
    await seedItem(ledger, { id: 'wi-a' })
    await seedItem(ledger, { id: 'wi-b', deps: ['wi-a'] })
    await claim(ledger, 'wi-a', PAST)
    await ledger.createAttempt({
      id: 'att-1',
      workItemId: 'wi-a',
      attemptNo: 1,
      harness: 'opencode-cli',
      modelProvider: 'opencode',
      modelId: 'muse',
      modelVariant: null,
      workspaceId: null,
      baseSha: 'sha',
    })

    const value: RpcRunStatusValue = unwrap(await rpc.runStatus({ runId: RUN }))

    expect(value.run.id).toBe(RUN)
    expect(value.run.state).toBe('executing')
    expect(value.run.riskClass).toBe('medium')
    expect(value.tasks.length).toBe(2)

    const taskA = value.tasks.find((t) => t.id === 'wi-a')!
    expect(taskA.state).toBe('pending')
    expect(taskA.latestAttempt?.id).toBe('att-1')
    expect(taskA.lease?.expired).toBe(true)
    expect(taskA.lease?.fencingToken).toBe(1)

    const taskB = value.tasks.find((t) => t.id === 'wi-b')!
    expect(taskB.dependencies).toEqual(['wi-a'])
    expect(taskB.lease?.expired).toBe(false)

    expect(value.counts.tasks).toBe(2)
    expect(value.counts.byState).toEqual({ pending: 2 })
    expect(value.counts.expiredLeases).toBe(1)
  })

  it('does not write anything (no events, lease untouched)', async () => {
    await seedItem(ledger, { id: 'wi-ro' })
    await claim(ledger, 'wi-ro', PAST)
    const eventsBefore = await eventCount(ledger)
    const leaseBefore = await ledger.getLease('wi-ro')

    unwrap(await rpc.runStatus({ runId: RUN }))

    expect(await eventCount(ledger)).toBe(eventsBefore)
    expect((await ledger.getLease('wi-ro'))?.released_at).toBe(
      leaseBefore?.released_at ?? null,
    )
  })

  it('rejects a missing run and malformed params', async () => {
    const missing = await rpc.runStatus({ runId: 'nope' })
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.error.code).toBe('not_found')

    const bad = await rpc.invoke('run.status', { runId: '' })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error.code).toBe('invalid_params')

    const notObject = await rpc.invoke('run.status', 'run-1')
    expect(notObject.ok).toBe(false)
    if (!notObject.ok) expect(notObject.error.code).toBe('invalid_params')
  })
})

describe('rpc — task.approve (createApproval + bounded lease release)', () => {
  let ledger: SqliteLedger
  let dbFile: string
  let rpc: SupervisorRpc

  beforeEach(async () => {
    dbFile = uniqueDbPath()
    ledger = new SqliteLedger(dbFile)
    let seq = 0
    rpc = createSupervisorRpc({
      ledger,
      newId: (p) => `${p}-${++seq}`,
    })
  })

  afterEach(async () => {
    ledger.close()
    await rm(dbFile, { force: true })
    await rm(`${dbFile}-wal`, { force: true })
    await rm(`${dbFile}-shm`, { force: true })
  })

  it('records a gate approval derived from the run state', async () => {
    await seedRun(ledger, RUN, 'awaiting_plan_approval')
    await seedItem(ledger, { id: 'wi-ap' })

    const value = unwrap(await rpc.taskApprove({ taskId: 'wi-ap', actor: 'tester' }))

    expect(value.gate).toBe('plan')
    expect(value.decision).toBe('approved')
    expect(value.duplicate).toBe(false)
    expect(value.releasedLease).toBe(false)

    const approvals = await ledger.getApprovals(RUN, 'plan')
    expect(approvals.length).toBe(1)
    expect(approvals[0].actor).toBe('tester')
    expect(approvals[0].decision).toBe('approved')
  })

  it('flags a repeat approval as a duplicate (append-only audit)', async () => {
    await seedRun(ledger, RUN, 'awaiting_plan_approval')
    await seedItem(ledger, { id: 'wi-ap2' })
    await rpc.taskApprove({ taskId: 'wi-ap2' })
    const second = unwrap(await rpc.taskApprove({ taskId: 'wi-ap2' }))
    expect(second.duplicate).toBe(true)
    expect((await ledger.getApprovals(RUN, 'plan')).length).toBe(2)
  })

  it('refuses to invent a gate for a run that is not awaiting approval', async () => {
    await seedRun(ledger, RUN, 'executing')
    await seedItem(ledger, { id: 'wi-noGate' })

    const result = await rpc.taskApprove({ taskId: 'wi-noGate' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('conflict')
    expect((await ledger.getApprovals(RUN)).length).toBe(0)
  })

  it('accepts an explicit gate and does not widen the decision vocabulary', async () => {
    await seedRun(ledger, RUN, 'executing')
    await seedItem(ledger, { id: 'wi-explicit' })

    const value = unwrap(
      await rpc.taskApprove({ taskId: 'wi-explicit', gate: 'deploy' }),
    )
    expect(value.gate).toBe('deploy')
    const approvals = await ledger.getApprovals(RUN, 'deploy')
    expect(approvals[0].decision).toBe('approved')
  })

  it('releases only an already-expired lease when asked', async () => {
    await seedRun(ledger, RUN, 'awaiting_plan_approval')
    await seedItem(ledger, { id: 'wi-exp' })
    await seedItem(ledger, { id: 'wi-live' })
    await claim(ledger, 'wi-exp', PAST)
    await claim(ledger, 'wi-live', FUTURE)

    const released = unwrap(
      await rpc.taskApprove({ taskId: 'wi-exp', releaseStaleLease: true }),
    )
    expect(released.releasedLease).toBe(true)
    expect((await ledger.getLease('wi-exp'))?.released_at).not.toBeNull()

    const kept = unwrap(
      await rpc.taskApprove({ taskId: 'wi-live', releaseStaleLease: true }),
    )
    expect(kept.releasedLease).toBe(false)
    expect((await ledger.getLease('wi-live'))?.released_at).toBeNull()

    // And it is opt-in: an expired lease survives when the flag is absent.
    const untouched = unwrap(await rpc.taskApprove({ taskId: 'wi-exp' }))
    expect(untouched.releasedLease).toBe(false)
  })

  it('rejects an unknown task', async () => {
    await seedRun(ledger, RUN, 'awaiting_plan_approval')
    const result = await rpc.taskApprove({ taskId: 'ghost' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('not_found')
  })
})

describe('rpc — task.retry (bounded re-dispatch)', () => {
  let ledger: SqliteLedger
  let dbFile: string
  let rpc: SupervisorRpc

  beforeEach(async () => {
    dbFile = uniqueDbPath()
    ledger = new SqliteLedger(dbFile)
    rpc = createSupervisorRpc({ ledger })
    await seedRun(ledger, RUN, 'executing')
  })

  afterEach(async () => {
    ledger.close()
    await rm(dbFile, { force: true })
    await rm(`${dbFile}-wal`, { force: true })
    await rm(`${dbFile}-shm`, { force: true })
  })

  it('re-dispatches a failed task with no dependencies to ready', async () => {
    await seedItem(ledger, { id: 'wi-fail' })
    await ledger.transitionWorkItemState('wi-fail', 'failed')

    const value = unwrap(await rpc.taskRetry({ taskId: 'wi-fail' }))

    expect(value.from).toBe('failed')
    expect(value.to).toBe('ready')
    expect((await ledger.getWorkItem('wi-fail'))?.state).toBe('ready')

    const events = await ledger.getEvents(RUN)
    const retryEvent = events.find(
      (e) => e.event_type === 'work_item_state_transition' && e.work_item_id === 'wi-fail',
    )
    expect(retryEvent).toBeDefined()
    expect(JSON.parse(retryEvent!.payload_json).to).toBe('pending')
  })

  it('leaves a task pending while its dependency is unresolved', async () => {
    await seedItem(ledger, { id: 'wi-dep' })
    await seedItem(ledger, { id: 'wi-child', deps: ['wi-dep'] })
    await ledger.transitionWorkItemState('wi-child', 'blocked')

    const value = unwrap(await rpc.taskRetry({ taskId: 'wi-child' }))
    expect(value.to).toBe('pending')
    expect((await ledger.getWorkItem('wi-child'))?.state).toBe('pending')
  })

  it('reports the ledger\'s observed post-state, not a predicted one', async () => {
    await seedItem(ledger, { id: 'wi-obs' })
    await ledger.transitionWorkItemState('wi-obs', 'failed')

    // A ledger whose scheduler transaction never runs: the retry transition to
    // `pending` still happens, but nothing marks the item ready. A predicted
    // `to` would say `ready`; the RPC must report what the ledger holds.
    const inert = new Proxy(ledger, {
      get(target, prop, receiver) {
        if (prop === 'transaction') return async () => undefined
        return Reflect.get(target, prop, receiver) as unknown
      },
    })
    const value = unwrap(
      await createSupervisorRpc({ ledger: inert }).taskRetry({ taskId: 'wi-obs' }),
    )

    expect(value.to).toBe('pending')
    expect((await ledger.getWorkItem('wi-obs'))?.state).toBe('pending')
  })

  it('refuses to retry a running task', async () => {
    await seedItem(ledger, { id: 'wi-run' })
    await ledger.transitionWorkItemState('wi-run', 'running')

    const result = await rpc.taskRetry({ taskId: 'wi-run' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('conflict')
    expect((await ledger.getWorkItem('wi-run'))?.state).toBe('running')
  })

  it('stops at the budget attempt ceiling', async () => {
    // max_attempts_per_task default is 2; drive a 1-attempt budget to the ceiling.
    await ledger.createRun({
      id: 'run-budget2',
      parentId: null,
      repoId: '/test/repo',
      requestHash: 'h',
      dataClass: 'internal',
      policyProfile: 'assisted',
      operationMode: 'assisted',
      riskClass: 'low',
      requestText: 'budget',
      budgetJson: JSON.stringify({ max_attempts_per_task: 1 }),
      deadlineAt: null,
    })
    await advanceRunState(ledger, 'run-budget2', 'executing')
    await seedItem(ledger, { id: 'wi-budget', runId: 'run-budget2' })
    await ledger.incrementWorkItemAttempts('wi-budget')
    await ledger.transitionWorkItemState('wi-budget', 'failed')

    const result = await rpc.taskRetry({ taskId: 'wi-budget' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('budget_exhausted')
  })

  it('only ever allows the declared retryable states', () => {
    expect([...TASK_RETRYABLE_STATES]).toEqual(['failed', 'blocked', 'interrupted'])
  })
})

describe('rpc — run.receipt (read)', () => {
  let ledger: SqliteLedger
  let dbFile: string

  beforeEach(async () => {
    dbFile = uniqueDbPath()
    ledger = new SqliteLedger(dbFile)
    await seedRun(ledger, RUN, 'executing')
  })

  afterEach(async () => {
    ledger.close()
    await rm(dbFile, { force: true })
    await rm(`${dbFile}-wal`, { force: true })
    await rm(`${dbFile}-shm`, { force: true })
  })

  it('aggregates the run receipt without writing', async () => {
    const rpc = createSupervisorRpc({ ledger })
    await seedItem(ledger, { id: 'wi-r' })
    const eventsBefore = await eventCount(ledger)

    const receipt = unwrap(await rpc.runReceipt({ runId: RUN }))

    expect(receipt.runId).toBe(RUN)
    expect(receipt.objective).toBe(`Objective for ${RUN}`)
    expect(receipt.state).toBe('executing')
    expect(receipt.unresolvedRisks.length).toBeGreaterThan(0)
    expect(await eventCount(ledger)).toBe(eventsBefore)
  })

  it('rejects an unknown run', async () => {
    const rpc = createSupervisorRpc({ ledger })
    const result = await rpc.runReceipt({ runId: 'ghost' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('not_found')
  })
})

describe('rpc — run.sweep (expired leases + stale heartbeats)', () => {
  let ledger: SqliteLedger
  let dbFile: string
  let rpc: SupervisorRpc

  beforeEach(async () => {
    dbFile = uniqueDbPath()
    ledger = new SqliteLedger(dbFile)
    rpc = createSupervisorRpc({ ledger })
    await seedRun(ledger, RUN, 'executing')
  })

  afterEach(async () => {
    ledger.close()
    await rm(dbFile, { force: true })
    await rm(`${dbFile}-wal`, { force: true })
    await rm(`${dbFile}-shm`, { force: true })
  })

  it('plans without writing under dryRun', async () => {
    await seedItem(ledger, { id: 'wi-sweep' })
    await claim(ledger, 'wi-sweep', PAST)
    const eventsBefore = await eventCount(ledger)

    const plan = unwrap(await rpc.runSweep({ runId: RUN, dryRun: true }))

    expect(plan.dryRun).toBe(true)
    expect(plan.actions.length).toBe(1)
    expect(plan.actions[0]).toMatchObject({
      kind: 'release_lease',
      workItemId: 'wi-sweep',
      reason: 'lease_expired',
      applied: false,
    })
    expect(plan.counts).toEqual({ releasedLeases: 0, interrupted: 0, events: 0 })
    expect((await ledger.getLease('wi-sweep'))?.released_at).toBeNull()
    expect(await eventCount(ledger)).toBe(eventsBefore)
  })

  it('releases an expired lease and audits it', async () => {
    await seedItem(ledger, { id: 'wi-exp' })
    await claim(ledger, 'wi-exp', PAST)

    const value = unwrap(await rpc.runSweep({ runId: RUN }))

    expect(value.counts.releasedLeases).toBe(1)
    expect((await ledger.getLease('wi-exp'))?.released_at).not.toBeNull()
    const events = await ledger.getEvents(RUN)
    const event = events.find((e) => e.event_type === 'lease_expired')
    expect(event).toBeDefined()
    expect(JSON.parse(event!.payload_json).reason).toBe('lease_expired')
  })

  it('interrupts a stale running task but never releases a live lease', async () => {
    await seedItem(ledger, { id: 'wi-stale' })
    await claim(ledger, 'wi-stale', FUTURE)
    await ledger.transitionWorkItemState('wi-stale', 'running')
    // Let the heartbeat age past a zero-millisecond staleness window.
    await tick()

    const value = unwrap(await rpc.runSweep({ runId: RUN, staleHeartbeatMaxAgeMs: 0 }))

    expect(value.counts.interrupted).toBe(1)
    const action = value.actions.find((a) => a.kind === 'mark_interrupted')
    expect(action?.workItemId).toBe('wi-stale')
    expect((await ledger.getWorkItem('wi-stale'))?.state).toBe('interrupted')
    // The un-expired lease stays held: only the owning fencing token may release it.
    expect((await ledger.getLease('wi-stale'))?.released_at).toBeNull()
  })

  it('scopes the sweep to one run', async () => {
    await seedRun(ledger, 'run-other', 'executing')
    await seedItem(ledger, { id: 'wi-mine' })
    await seedItem(ledger, { id: 'wi-theirs', runId: 'run-other' })
    await claim(ledger, 'wi-mine', PAST)
    await claim(ledger, 'wi-theirs', PAST)

    const value = unwrap(await rpc.runSweep({ runId: RUN }))

    expect(value.actions.map((a) => a.workItemId)).toEqual(['wi-mine'])
    expect((await ledger.getLease('wi-theirs'))?.released_at).toBeNull()
    expect((await ledger.getLease('wi-mine'))?.released_at).not.toBeNull()
  })

  it('rejects an unknown scope run and malformed params', async () => {
    const missing = await rpc.runSweep({ runId: 'ghost' })
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.error.code).toBe('not_found')

    const bad = await rpc.invoke('run.sweep', { dryRun: 'yes' })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error.code).toBe('invalid_params')
  })
})

describe('tui — board model (projection-only)', () => {
  let ledger: SqliteLedger
  let dbFile: string

  beforeEach(async () => {
    dbFile = uniqueDbPath()
    ledger = new SqliteLedger(dbFile)
    await seedRun(ledger, RUN, 'awaiting_plan_approval')
  })

  afterEach(async () => {
    ledger.close()
    await rm(dbFile, { force: true })
    await rm(`${dbFile}-wal`, { force: true })
    await rm(`${dbFile}-shm`, { force: true })
  })

  it('covers every work-item state exactly once across the lanes', () => {
    expect(laneCoverage()).toEqual({
      ok: true,
      missing: [],
      duplicated: [],
      unknown: [],
    })
  })

  it('groups cards into lanes and carries the route handle', async () => {
    await seedItem(ledger, { id: 'wi-p', priority: 2 })
    await seedItem(ledger, { id: 'wi-r', priority: 1 })
    await ledger.transitionWorkItemState('wi-r', 'ready')
    await seedItem(ledger, { id: 'wi-d' })
    await ledger.transitionWorkItemState('wi-d', 'completed')
    await seedItem(ledger, { id: 'wi-f' })
    await ledger.transitionWorkItemState('wi-f', 'failed')

    const rpc = createSupervisorRpc({ ledger })
    const status = unwrap(await rpc.runStatus({ runId: RUN }))
    const board = buildBoardModel(status)

    expect(board.runId).toBe(RUN)
    expect(board.route).toEqual({ name: 'supervisor', params: { runId: RUN } })
    expect(laneForState('running')).toBe('active')
    expect(laneForState('blocked')).toBe('waiting')

    const byKey = new Map(board.columns.map((c) => [c.key, c.cards.map((x) => x.id)]))
    expect(byKey.get('queued')).toEqual(['wi-r', 'wi-p'])
    expect(byKey.get('done')).toEqual(['wi-d'])
    expect(byKey.get('failed')).toEqual(['wi-f'])

    const failedCard = board.columns
      .find((c) => c.key === 'failed')!
      .cards.find((c) => c.id === 'wi-f')!
    expect(failedCard.actions.find((a) => a.method === 'task.retry')?.enabled).toBe(true)

    const queuedCard = board.columns
      .find((c) => c.key === 'queued')!
      .cards.find((c) => c.id === 'wi-p')!
    expect(queuedCard.actions.find((a) => a.method === 'task.retry')?.enabled).toBe(false)
    // awaiting_plan_approval -> approve is available.
    expect(queuedCard.actions.find((a) => a.method === 'task.approve')?.enabled).toBe(true)

    expect(board.destructive.map((d) => d.method)).toEqual(['run.sweep'])
    expect(BOARD_LANES.length).toBe(board.columns.length)
  })

  it('disables approve when the run has no pending gate', async () => {
    await advanceRunState(ledger, RUN, 'executing')
    await seedItem(ledger, { id: 'wi-exec' })

    const rpc = createSupervisorRpc({ ledger })
    const board = buildBoardModel(unwrap(await rpc.runStatus({ runId: RUN })))
    const card = board.columns.flatMap((c) => c.cards).find((c) => c.id === 'wi-exec')!
    const approve = card.actions.find((a) => a.method === 'task.approve')!
    expect(approve.enabled).toBe(false)
    expect(approve.reason).toContain('no pending approval gate')
  })

  it('builds attempts/leases/hooks panel sections without writing', async () => {
    await seedItem(ledger, { id: 'wi-panel' })
    await claim(ledger, 'wi-panel', PAST)
    await ledger.createAttempt({
      id: 'att-p',
      workItemId: 'wi-panel',
      attemptNo: 1,
      harness: 'opencode-cli',
      modelProvider: 'opencode',
      modelId: 'muse',
      modelVariant: 'fast',
      workspaceId: null,
      baseSha: 'sha',
    })
    await ledger.failAttempt('att-p', 'exit_nonzero', 2, null, null)

    const rpc = createSupervisorRpc({ ledger })
    const status = unwrap(await rpc.runStatus({ runId: RUN }))
    const eventsBefore = await eventCount(ledger)

    const panel = buildPanelModel(status, 'wi-panel', [
      { name: 'tool.execute.before', active: true, source: 'server' },
    ])

    expect(panel.sections.map((s) => s.title)).toEqual(['Attempts', 'Hooks', 'Leases'])
    const attempts = panel.sections[0].fields
    expect(attempts.find((f) => f.label === 'failure')?.value).toBe('exit_nonzero')
    expect(attempts.find((f) => f.label === 'exit')?.tone).toBe('error')
    expect(panel.sections[1].fields[0].value).toBe('active')
    const leases = panel.sections[2].fields
    expect(leases.find((f) => f.label === 'state')?.value).toBe('expired')
    expect(await eventCount(ledger)).toBe(eventsBefore)
  })

  it('renders a task-less panel for an unknown task id', async () => {
    const rpc = createSupervisorRpc({ ledger })
    const status = unwrap(await rpc.runStatus({ runId: RUN }))
    const panel = buildPanelModel(status, 'ghost')
    expect(panel.task).toBeNull()
    expect(panel.sections[1].fields[0].value).toBe('\u2014')
  })
})

describe('tui — registration definitions (no API invention)', () => {
  it('never imports an opencode runtime surface', async () => {
    // Match real module specifiers only (not prose in comments).
    const specifier = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g
    for (const rel of ['../src/tui/index.ts', '../src/tui/board.ts', '../src/rpc.ts']) {
      const source = await Bun.file(new URL(rel, import.meta.url)).text()
      const specifiers = [...source.matchAll(specifier)].map((m) => m[1])
      expect(specifiers.length).toBeGreaterThan(0)
      for (const spec of specifiers) {
        expect(spec.startsWith('@opencode-ai/')).toBe(false)
        expect(spec.startsWith('@opentui/')).toBe(false)
      }
    }
  })

  it('defines the route, panel and slash command as data', () => {
    expect(SUPERVISOR_ROUTE_DEF.name).toBe('supervisor')
    expect(SUPERVISOR_ROUTE_DEF.boardProjection).toBe('rpc.run.status')
    expect(SUPERVISOR_ROUTE_DEF.registersWith).toBe('route.register')
    expect(TUI_DEFS.route).toBe(SUPERVISOR_ROUTE_DEF)

    expect(SUPERVISOR_PANEL_DEF.slot).toBe('sidebar_content')
    expect(SUPERVISOR_PANEL_DEF.sections).toEqual(['Attempts', 'Hooks', 'Leases'])

    expect(SUPERVISOR_SLASH_DEF.slash.name).toBe('supervisor')
    expect(SUPERVISOR_SLASH_DEF.slash.aliases).toContain('sup')
  })

  it('binds a=approve d=deny r=retry and marks deny unimplemented', () => {
    expect(new Set(SUPERVISOR_KEYMAP_DEFS.map((d) => d.key))).toEqual(
      new Set(['a', 'd', 'r']),
    )
    expect(SUPERVISOR_BINDINGS).toEqual({
      a: 'supervisor.task.approve',
      d: 'supervisor.task.deny',
      r: 'supervisor.task.retry',
    })
    const deny = SUPERVISOR_KEYMAP_DEFS.find((d) => d.key === 'd')!
    expect(deny.implemented).toBe(false)
    expect(deny.method).toBeNull()
    expect(SUPERVISOR_SLASH_DEF.unimplemented[0].command).toBe('supervisor.task.deny')
  })

  it('subscribes to permission.asked over the verified event bus', () => {
    const sub = SUPERVISOR_EVENT_SUBS.find((s) => s.type === 'permission.asked')!
    expect(sub.projection).toBe('read-only')
    expect(sub.effect).toBe('attention')
    expect(sub.handler).toContain('onPermissionAsked')
  })

  it('records the event union literals it subscribes to as verified', () => {
    // `session.created` moved from runtime-dependent to verified in the
    // 2026-10-18 re-probe (EventSessionCreated, sdk types.gen.d.ts L5279-5286).
    for (const type of ['permission.asked', 'permission.v2.asked', 'session.created']) {
      const sub = SUPERVISOR_EVENT_SUBS.find((s) => s.type === type)!
      expect(sub).toBeDefined()
      expect(sub.status).toBe('verified')
      expect(sub.evidence).toContain('types.gen.d.ts')
    }
  })

  it('defines attention with a verified sound name and a toast fallback', () => {
    expect(SUPERVISOR_ATTENTION_DEF.registersWith).toBe('attention.notify')
    expect(SUPERVISOR_ATTENTION_DEF.sound).toBe('permission')
    expect(SUPERVISOR_ATTENTION_DEF.fallback).toBe('ui.toast')
  })

  it('gates destructive actions behind confirm dialogs', () => {
    const ids = SUPERVISOR_CONFIRM_DEFS.map((d) => d.id)
    expect(ids).toContain('supervisor.sweep.confirm')
    expect(ids).toContain('supervisor.worktree.remove.confirm')
    for (const def of SUPERVISOR_CONFIRM_DEFS) {
      expect(def.destructive).toBe(true)
      expect(def.registersWith).toBe('ui.DialogConfirm')
    }
    const sweep = SUPERVISOR_CONFIRM_DEFS.find((d) => d.id === 'supervisor.sweep.confirm')!
    expect(sweep.confirms).toEqual({ kind: 'rpc', method: 'run.sweep' })
  })

  it('only dispatches methods that exist on the RPC surface', () => {
    expect(unimplementedDispatches()).toEqual([])
  })

  it('records a status for every surface it references', () => {
    const surfaces = new Set(TUI_SURFACE_EVIDENCE.map((e) => e.surface))
    expect(surfaces.size).toBe(TUI_SURFACE_EVIDENCE.length)
    for (const entry of TUI_SURFACE_EVIDENCE) {
      expect(entry.shape.length).toBeGreaterThan(0)
      expect(entry.evidence.length).toBeGreaterThan(0)
    }
    // The documented-but-absent surfaces must stay recorded as absent.
    const absent = TUI_SURFACE_EVIDENCE.filter((e) => e.status === 'absent').map(
      (e) => e.surface,
    )
    expect(absent).toContain('data.on / data.listen')
    expect(absent).toContain('tabs.*')
    expect(absent).toContain('slot `session.panel`')
    expect(absent).toContain('./rpc package export')
    expect(absent).toContain('permission.assert / permission.hook')
  })
})

describe('tui — fleet-ui retire gate', () => {
  it('closes the gate while the rpc leg is unverified', () => {
    expect(FLEET_UI_RETIRE_GATE.satisfied).toBe(false)
    expect([...FLEET_UI_RETIRE_GATE.blockingLegs]).toEqual(['rpc'])
    expect([...FLEET_UI_RETIRE_GATE.requiredCapabilities]).toEqual([
      'board',
      'panel',
      'slash',
      'approve',
    ])
  })

  it('re-evaluates when the evidence changes', () => {
    const withRpc = [
      ...WEB_PARITY_ENDPOINTS,
      {
        leg: 'rpc' as const,
        httpMethod: 'POST',
        path: '/api/rpc/{rpcID}/{method}',
        status: 'verified' as const,
        evidence: 'hypothetical',
      },
    ]
    const gate = evaluateRetireGate(withRpc)
    expect(gate.satisfied).toBe(true)
    expect(gate.blockingLegs).toEqual([])
  })

  it('records the rpc and pairing endpoints as absent, not assumed', () => {
    const rpc = WEB_PARITY_ENDPOINTS.find((e) => e.leg === 'rpc')!
    expect(rpc.status).toBe('absent')
    const pairing = WEB_PARITY_ENDPOINTS.find((e) => e.leg === 'pairing')!
    expect(pairing.status).toBe('absent')
    const pty = WEB_PARITY_ENDPOINTS.find((e) => e.leg === 'pty')!
    expect(pty.status).toBe('verified')
    const event = WEB_PARITY_ENDPOINTS.find((e) => e.path === '/api/event')!
    expect(event.status).toBe('verified')
  })
})
