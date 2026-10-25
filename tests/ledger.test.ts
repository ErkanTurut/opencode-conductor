import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { SqliteLedger } from '../src/ledger/sqlite'

function createTestLedger(): SqliteLedger {
  const path = `/tmp/test-supervisor-${Date.now()}.db`
  return new SqliteLedger(path)
}

describe('SqliteLedger — Runs', () => {
  let ledger: SqliteLedger

  beforeEach(() => {
    ledger = createTestLedger()
  })

  afterEach(() => {
    ledger.close()
  })

  it('creates and retrieves a run', async () => {
    const run = await ledger.createRun({
      id: 'run-1',
      parentId: null,
      repoId: '/test/repo',
      requestHash: 'abc123',
      dataClass: 'internal',
      policyProfile: 'assisted',
      operationMode: 'assisted',
      riskClass: 'medium',
      requestText: 'Test run',
      budgetJson: '{}',
      deadlineAt: null,
    })

    expect(run.id).toBe('run-1')
    expect(run.state).toBe('created')

    const retrieved = await ledger.getRun('run-1')
    expect(retrieved).not.toBeNull()
    expect(retrieved!.state).toBe('created')
  })

  it('transitions run state', async () => {
    await ledger.createRun({
      id: 'run-2',
      parentId: null,
      repoId: '/test/repo',
      requestHash: 'xyz',
      dataClass: 'internal',
      policyProfile: 'assisted',
      operationMode: 'assisted',
      riskClass: 'low',
      requestText: 'Test',
      budgetJson: '{}',
      deadlineAt: null,
    })

    const updated = await ledger.transitionRunState('run-2', 'intake')
    expect(updated.state).toBe('intake')
  })

  it('lists active (non-terminal) runs', async () => {
    await ledger.createRun({
      id: 'active-1',
      parentId: null,
      repoId: '/test',
      requestHash: 'a',
      dataClass: 'internal',
      policyProfile: 'assisted',
      operationMode: 'assisted',
      riskClass: 'low',
      requestText: 'Active',
      budgetJson: '{}',
      deadlineAt: null,
    })

    await ledger.createRun({
      id: 'done-1',
      parentId: null,
      repoId: '/test',
      requestHash: 'b',
      dataClass: 'internal',
      policyProfile: 'assisted',
      operationMode: 'assisted',
      riskClass: 'low',
      requestText: 'Done',
      budgetJson: '{}',
      deadlineAt: null,
    })

    // The fail-closed gate rejects `created` -> terminal directly; walk a
    // legal path (created -> intake -> failed) to reach a terminal state.
    await ledger.transitionRunState('done-1', 'intake')
    await ledger.transitionRunState('done-1', 'failed', 'Done')

    const active = await ledger.listActiveRuns()
    expect(active.length).toBe(1)
    expect(active[0].id).toBe('active-1')
  })
})

describe('SqliteLedger — Work Items', () => {
  let ledger: SqliteLedger

  beforeEach(async () => {
    ledger = createTestLedger()
    await ledger.createRun({
      id: 'run-wi',
      parentId: null,
      repoId: '/test',
      requestHash: 'wi',
      dataClass: 'internal',
      policyProfile: 'assisted',
      operationMode: 'assisted',
      riskClass: 'low',
      requestText: 'WI test',
      budgetJson: '{}',
      deadlineAt: null,
    })
  })

  afterEach(() => {
    ledger.close()
  })

  it('creates and retrieves a work item', async () => {
    const item = await ledger.createWorkItem({
      id: 'wi-1',
      runId: 'run-wi',
      issueKey: 'TEST-1',
      title: 'Test item',
      dependencyJson: '[]',
      ownerRole: 'coder',
      modelSlot: 'implementation',
      priority: 0,
      writeScopeJson: '["src/**"]',
      contractJson: '{}',
      allowedPathsJson: '["src/**"]',
      readPathsJson: '[]',
      acceptanceCriteriaJson: '["Tests pass"]',
      verificationCommandsJson: '["bun test"]',
    })

    expect(item.id).toBe('wi-1')
    expect(item.state).toBe('pending')

    const retrieved = await ledger.getWorkItem('wi-1')
    expect(retrieved).not.toBeNull()
    expect(retrieved!.title).toBe('Test item')
  })

  it('transitions work item state', async () => {
    await ledger.createWorkItem({
      id: 'wi-2',
      runId: 'run-wi',
      issueKey: 'TEST-2',
      title: 'Item 2',
      dependencyJson: '[]',
      ownerRole: 'coder',
      modelSlot: 'implementation',
      priority: 0,
      writeScopeJson: '[]',
      contractJson: '{}',
      allowedPathsJson: '[]',
      readPathsJson: '[]',
      acceptanceCriteriaJson: '[]',
      verificationCommandsJson: '[]',
    })

    const updated = await ledger.transitionWorkItemState('wi-2', 'ready')
    expect(updated.state).toBe('ready')
  })

  it('increments attempt count', async () => {
    await ledger.createWorkItem({
      id: 'wi-3',
      runId: 'run-wi',
      issueKey: 'TEST-3',
      title: 'Item 3',
      dependencyJson: '[]',
      ownerRole: 'coder',
      modelSlot: 'implementation',
      priority: 0,
      writeScopeJson: '[]',
      contractJson: '{}',
      allowedPathsJson: '[]',
      readPathsJson: '[]',
      acceptanceCriteriaJson: '[]',
      verificationCommandsJson: '[]',
    })

    const updated = await ledger.incrementWorkItemAttempts('wi-3')
    expect(updated.attempts).toBe(1)

    const updated2 = await ledger.incrementWorkItemAttempts('wi-3')
    expect(updated2.attempts).toBe(2)
  })
})

describe('SqliteLedger — Leases', () => {
  let ledger: SqliteLedger

  beforeEach(async () => {
    ledger = createTestLedger()
    await ledger.createRun({
      id: 'run-lease',
      parentId: null,
      repoId: '/test',
      requestHash: 'lease',
      dataClass: 'internal',
      policyProfile: 'assisted',
      operationMode: 'assisted',
      riskClass: 'low',
      requestText: 'Lease test',
      budgetJson: '{}',
      deadlineAt: null,
    })
    await ledger.createWorkItem({
      id: 'wi-lease',
      runId: 'run-lease',
      issueKey: '',
      title: 'Lease test',
      dependencyJson: '[]',
      ownerRole: 'coder',
      modelSlot: 'implementation',
      priority: 0,
      writeScopeJson: '[]',
      contractJson: '{}',
      allowedPathsJson: '[]',
      readPathsJson: '[]',
      acceptanceCriteriaJson: '[]',
      verificationCommandsJson: '[]',
    })
  })

  afterEach(() => {
    ledger.close()
  })

  it('claims a lease', async () => {
    const result = await ledger.claimLease({
      workItemId: 'wi-lease',
      leaseOwner: 'worker-1',
      leaseExpiresAt: new Date(Date.now() + 60000).toISOString(),
    })

    expect(result.claimed).toBe(true)
    expect(result.fencingToken).toBe(1)
  })

  it('prevents duplicate claim', async () => {
    await ledger.claimLease({
      workItemId: 'wi-lease',
      leaseOwner: 'worker-1',
      leaseExpiresAt: new Date(Date.now() + 60000).toISOString(),
    })

    const result2 = await ledger.claimLease({
      workItemId: 'wi-lease',
      leaseOwner: 'worker-2',
      leaseExpiresAt: new Date(Date.now() + 60000).toISOString(),
    })

    expect(result2.claimed).toBe(false)
  })

  it('rejects stale fencing token on heartbeat', async () => {
    await ledger.claimLease({
      workItemId: 'wi-lease',
      leaseOwner: 'worker-1',
      leaseExpiresAt: new Date(Date.now() + 60000).toISOString(),
    })

    const ok = await ledger.heartbeatLease('wi-lease', 1)
    expect(ok).toBe(true)

    const fail = await ledger.heartbeatLease('wi-lease', 0)
    expect(fail).toBe(false)
  })

  it('rejects stale fencing token on release', async () => {
    await ledger.claimLease({
      workItemId: 'wi-lease',
      leaseOwner: 'worker-1',
      leaseExpiresAt: new Date(Date.now() + 60000).toISOString(),
    })

    const ok = await ledger.releaseLease('wi-lease', 1)
    expect(ok).toBe(true)

    const fail = await ledger.releaseLease('wi-lease', 1)
    expect(fail).toBe(false)
  })
})

describe('SqliteLedger — Events (append-only)', () => {
  let ledger: SqliteLedger

  beforeEach(async () => {
    ledger = createTestLedger()
    await ledger.createRun({
      id: 'run-ev',
      parentId: null,
      repoId: '/test',
      requestHash: 'ev',
      dataClass: 'internal',
      policyProfile: 'assisted',
      operationMode: 'assisted',
      riskClass: 'low',
      requestText: 'Event test',
      budgetJson: '{}',
      deadlineAt: null,
    })
  })

  afterEach(() => {
    ledger.close()
  })

  it('appends events and maintains sequence order', async () => {
    await ledger.appendEvent({
      runId: 'run-ev',
      eventType: 'run_created',
      actor: 'supervisor',
      payloadJson: '{}',
    })

    await ledger.appendEvent({
      runId: 'run-ev',
      eventType: 'run_state_transition',
      actor: 'supervisor',
      payloadJson: '{"from":"created","to":"intake"}',
    })

    const events = await ledger.getEvents('run-ev')
    expect(events.length).toBe(2)
    expect(events[0].sequence).toBeLessThan(events[1].sequence)
  })

  it('filters events by sequence', async () => {
    await ledger.appendEvent({
      runId: 'run-ev',
      eventType: 'run_created',
      actor: 'supervisor',
      payloadJson: '{}',
    })
    await ledger.appendEvent({
      runId: 'run-ev',
      eventType: 'run_state_transition',
      actor: 'supervisor',
      payloadJson: '{}',
    })

    const after = await ledger.getEvents('run-ev', 1)
    expect(after.length).toBe(1)
    expect(after[0].sequence).toBe(2)
  })
})

describe('SqliteLedger — Transactions', () => {
  let ledger: SqliteLedger

  beforeEach(() => {
    ledger = createTestLedger()
  })

  afterEach(() => {
    ledger.close()
  })

  it('rolls back on error', async () => {
    try {
      await ledger.transaction(async (tx) => {
        await tx.createRun({
          id: 'tx-run',
          parentId: null,
          repoId: '/test',
          requestHash: 'tx',
          dataClass: 'internal',
          policyProfile: 'assisted',
          operationMode: 'assisted',
          riskClass: 'low',
          requestText: 'TX test',
          budgetJson: '{}',
          deadlineAt: null,
        })
        throw new Error('forced rollback')
      })
    } catch {
      // Expected
    }

    const run = await ledger.getRun('tx-run')
    expect(run).toBeNull()
  })

  it('commits on success', async () => {
    await ledger.transaction(async (tx) => {
      await tx.createRun({
        id: 'tx-run-2',
        parentId: null,
        repoId: '/test',
        requestHash: 'tx2',
        dataClass: 'internal',
        policyProfile: 'assisted',
        operationMode: 'assisted',
        riskClass: 'low',
        requestText: 'TX test 2',
        budgetJson: '{}',
        deadlineAt: null,
      })
    })

    const run = await ledger.getRun('tx-run-2')
    expect(run).not.toBeNull()
  })
})

describe('SqliteLedger — Approvals', () => {
  let ledger: SqliteLedger

  beforeEach(async () => {
    ledger = createTestLedger()
    await ledger.createRun({
      id: 'run-ap',
      parentId: null,
      repoId: '/test',
      requestHash: 'ap',
      dataClass: 'internal',
      policyProfile: 'assisted',
      operationMode: 'assisted',
      riskClass: 'low',
      requestText: 'Approval test',
      budgetJson: '{}',
      deadlineAt: null,
    })
  })

  afterEach(() => {
    ledger.close()
  })

  it('creates and retrieves approvals', async () => {
    await ledger.createApproval({
      id: 'approval-1',
      runId: 'run-ap',
      gate: 'plan_approval',
      decision: 'approved',
      actor: 'human',
    })

    const approvals = await ledger.getApprovals('run-ap')
    expect(approvals.length).toBe(1)
    expect(approvals[0].gate).toBe('plan_approval')
  })

  it('filters approvals by gate', async () => {
    await ledger.createApproval({
      id: 'approval-1',
      runId: 'run-ap',
      gate: 'plan_approval',
      decision: 'approved',
      actor: 'human',
    })
    await ledger.createApproval({
      id: 'approval-2',
      runId: 'run-ap',
      gate: 'merge_approval',
      decision: 'pending',
      actor: 'human',
    })

    const planApprovals = await ledger.getApprovals('run-ap', 'plan_approval')
    expect(planApprovals.length).toBe(1)
    expect(planApprovals[0].id).toBe('approval-1')
  })
})
