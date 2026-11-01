import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { join } from 'node:path'
import {
  buildDag,
  buildGates,
  buildMemory,
  buildMemoryBlock,
  buildRefinements,
  buildRouting,
  buildRunDetail,
  buildRuns,
  buildTimeline,
  buildWorkspace,
  summarizeEvent,
  taskStateCounts,
} from '../../src/read/projections'
import { LedgerReader } from '../../src/read/ledger-reader'
import type { LedgerRunListRow } from '../../src/read/ledger-reader'
import type { MemoryBlockRecord } from '../../src/read/artifacts'
import { DEFAULT_BUDGET } from '../../src/types'
import { seedLedger, tempProject, type SeedIds, type TempProject } from './seed'

let project: TempProject
let ids: SeedIds
let reader: LedgerReader

beforeEach(async () => {
  project = tempProject('projections')
  ids = await seedLedger(project.layout.ledgerPath)
  reader = new LedgerReader(project.layout.ledgerPath)
})

afterEach(() => {
  project.cleanup()
})

function runRecord() {
  const run = reader.run(ids.runId)
  if (!run) throw new Error('seed run missing')
  return run
}

function taskById(id: string) {
  const task = reader.tasks(ids.runId).find((candidate) => candidate.id === id)
  if (!task) throw new Error(`seed task ${id} missing`)
  return task
}

function memoryBlock(overrides: Partial<MemoryBlockRecord> = {}): MemoryBlockRecord {
  return {
    label: 'alpha',
    scope: 'project',
    version: 1,
    sourceRunId: null,
    sourceArtifacts: [],
    content: 'content',
    contentHash: null,
    actor: null,
    confidence: null,
    reviewAfter: null,
    status: 'active',
    supersedes: null,
    path: '/memory/alpha.v1.json',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('projections — workspace and runs', () => {
  it('builds the workspace shape from the layout and counts', () => {
    const data = buildWorkspace({
      projectRoot: project.root,
      layout: project.layout,
      trusted: true,
      policyRestricted: false,
      counts: reader.counts(),
    })
    expect(data).toEqual({
      projectRoot: project.root,
      projectKey: project.layout.projectKey,
      mode: 'local',
      ledgerPath: project.layout.ledgerPath,
      runsDir: project.layout.runsDir,
      memoryDir: project.layout.memoryDir,
      trusted: true,
      policyRestricted: false,
      counts: { runs: 2, activeRuns: 1, tasks: 5, attempts: 2 },
    })
  })

  it('builds run summaries with task counts and receipt state', () => {
    const runs = reader.runs()
    const rows: LedgerRunListRow[] = runs.runs.map((run) => ({
      ...run,
      hasReceipt: run.id === ids.runId,
    }))
    const data = buildRuns({ runs: rows, nextCursor: 'cursor-1' })
    expect(data.nextCursor).toBe('cursor-1')
    expect(data.runs).toHaveLength(2)
    const alpha = data.runs.find((run) => run.id === ids.runId)!
    expect(alpha).toMatchObject({
      state: 'intake',
      riskClass: 'high',
      operationMode: 'assisted',
      objective: 'alpha objective',
      taskCount: 5,
      counts: { pending: 5 },
      hasReceipt: true,
    })
  })

  it('counts task states', () => {
    expect(taskStateCounts(reader.tasks(ids.runId))).toEqual({ pending: 5 })
  })
})

describe('projections — run detail', () => {
  it('joins latest attempts and active leases onto each task', () => {
    const data = buildRunDetail({
      run: runRecord(),
      tasks: reader.tasks(ids.runId),
      attempts: reader.attempts(ids.runId),
      leases: reader.leases(ids.runId),
      approvals: reader.approvals(ids.runId),
      eventCount: reader.eventCount(ids.runId),
      runDir: join(project.layout.runsDir, ids.runId),
    })
    expect(data.summary.taskCount).toBe(5)
    expect(data.eventCount).toBe(4)
    expect(data.runDir).toBe(join(project.layout.runsDir, ids.runId))
    expect(data.approvals).toHaveLength(1)
    expect(data.approvals[0]).toMatchObject({ gate: 'plan', decision: 'approved', actor: 'operator' })

    const taskA = data.tasks.find((task) => task.id === ids.taskIds.a)!
    expect(taskA.latestAttempt).toMatchObject({
      id: ids.attemptIds.a,
      attemptNo: 1,
      state: 'completed',
      modelProvider: 'opencode-go',
      modelId: 'deepseek-v4.1-flash',
      modelVariant: 'max',
      exitCode: 0,
      usage: { total_tokens: 1000 },
      cost: null,
    })
    expect(taskA.lease).toMatchObject({ owner: 'worker-1', fencingToken: 1 })
    expect(taskA.dependencies).toEqual([])

    const taskGhost = data.tasks.find((task) => task.id === ids.taskIds.ghost)!
    expect(taskGhost.latestAttempt).toBeNull()
    expect(taskGhost.lease).toBeNull()
    expect(taskGhost.dependencies).toEqual(['task-missing'])
  })

  it('reports a released lease as no holder', () => {
    const leases = reader.leases(ids.runId).map((lease) =>
      lease.workItemId === ids.taskIds.a ? { ...lease, releasedAt: '2026-01-01 00:00:00' } : lease,
    )
    const detail = buildRunDetail({
      run: runRecord(),
      tasks: [taskById(ids.taskIds.a)],
      attempts: reader.attempts(ids.runId),
      leases,
      approvals: [],
    })
    expect(detail.tasks[0].lease).toBeNull()
    expect(detail.runDir).toBeNull()
    expect(detail.eventCount).toBe(0)
  })
})

describe('projections — DAG', () => {
  it('computes layers, ghosts and cycles without throwing', () => {
    const dag = buildDag({ runId: ids.runId, tasks: reader.tasks(ids.runId) })
    expect(dag.runId).toBe(ids.runId)
    expect(dag.dangling).toEqual(['task-missing'])
    expect(dag.maxDepthBudget).toBe(DEFAULT_BUDGET.max_dag_depth)

    const ghost = dag.nodes.find((node) => node.id === 'task-missing')!
    expect(ghost.ghost).toBe(true)
    expect(ghost.state).toBe('unknown')

    const nodeA = dag.nodes.find((node) => node.id === ids.taskIds.a)!
    const nodeB = dag.nodes.find((node) => node.id === ids.taskIds.b)!
    expect(nodeA.layer).toBe(0)
    expect(nodeB.layer).toBe(1)
    expect(ghost.layer).toBe(0)

    expect(dag.layers).toEqual([
      ['cycle-1', 'cycle-2', ids.taskIds.a, 'task-missing'].sort(),
      [ids.taskIds.b, ids.taskIds.ghost].sort(),
    ])
    expect(dag.roots).toEqual([ids.taskIds.a, ids.taskIds.ghost])
    expect(dag.leaves).toEqual([ids.taskIds.b, ids.taskIds.ghost])
    expect(dag.cycles).toEqual([[ids.taskIds.cycleOne, ids.taskIds.cycleTwo].sort()])
    expect(dag.maxDepth).toBe(2)

    const ghostEdge = dag.edges.find((edge) => edge.from === 'task-missing')!
    expect(ghostEdge).toMatchObject({ to: ids.taskIds.ghost, resolved: false })
    const resolvedEdge = dag.edges.find((edge) => edge.to === ids.taskIds.b)!
    expect(resolvedEdge).toMatchObject({ from: ids.taskIds.a, resolved: true })
  })

  it('handles an empty graph', () => {
    const dag = buildDag({ runId: 'run-empty', tasks: [] })
    expect(dag.nodes).toEqual([])
    expect(dag.edges).toEqual([])
    expect(dag.layers).toEqual([])
    expect(dag.roots).toEqual([])
    expect(dag.leaves).toEqual([])
    expect(dag.dangling).toEqual([])
    expect(dag.cycles).toEqual([])
    expect(dag.maxDepth).toBe(0)
  })

  it('detects a self-dependency as a cycle', () => {
    const task = { ...taskById(ids.taskIds.a), id: 'self', dependencies: ['self'] }
    const dag = buildDag({ runId: 'run-self', tasks: [task] })
    expect(dag.cycles).toEqual([['self']])
    expect(dag.nodes[0].layer).toBe(0)
    expect(dag.maxDepth).toBe(1)
  })
})

describe('projections — gates', () => {
  function gates(overrides: Partial<Parameters<typeof buildGates>[0]> = {}) {
    return buildGates({
      runId: ids.runId,
      tasks: reader.tasks(ids.runId),
      attempts: reader.attempts(ids.runId),
      verifications: reader.verifications(ids.runId),
      findings: reader.findings(ids.runId),
      approvals: reader.approvals(ids.runId),
      ...overrides,
    })
  }

  it('derives passed per task from its latest attempt verifications', () => {
    const data = gates()
    const byTask = new Map(data.tasks.map((task) => [task.taskId, task]))
    expect(byTask.get(ids.taskIds.a)!.passed).toBe(true)
    expect(byTask.get(ids.taskIds.a)!.verifications).toHaveLength(1)
    expect(byTask.get(ids.taskIds.a)!.verifications[0]).toMatchObject({
      command: 'bun test',
      exitCode: 0,
      passed: true,
      outputHash: 'hash-pass',
    })
    expect(byTask.get(ids.taskIds.b)!.passed).toBe(false)
    expect(byTask.get(ids.taskIds.ghost)!.passed).toBeNull()
    expect(byTask.get(ids.taskIds.cycleOne)!.passed).toBeNull()
  })

  it('attributes findings and blocks merge when a blocking finding is open', () => {
    const data = gates()
    // The run-level blocking finding follows the task with the newest attempt.
    const taskB = data.tasks.find((task) => task.taskId === ids.taskIds.b)!
    expect(taskB.findings.map((finding) => finding.id)).toEqual(['finding-run'])
    expect(taskB.blockingFindings).toBe(1)
    expect(taskB.openFindings).toBe(1)

    const taskA = data.tasks.find((task) => task.taskId === ids.taskIds.a)!
    expect(taskA.findings.map((finding) => finding.id)).toEqual(['finding-attempt'])
    expect(taskA.blockingFindings).toBe(0)
    expect(taskA.openFindings).toBe(1)

    expect(data.mergeReady).toBe(false)
  })

  it('distinguishes completed evidence from permission to merge', () => {
    const tasks = [{ ...taskById(ids.taskIds.a), state: 'completed' }]
    const verifications = reader
      .verifications(ids.runId)
      .filter((verification) => verification.attemptId === ids.attemptIds.a)
    const data = buildGates({
      runId: ids.runId,
      tasks,
      attempts: reader.attempts(ids.runId),
      verifications,
      findings: [],
      approvals: [],
    })
    expect(data.tasks[0].passed).toBe(true)
    expect(data.readiness?.evidenceReady).toBe(true)
    expect(data.readiness?.authoritative).toBe(false)
    expect(data.mergeReady).toBe(false)
    expect(data.readiness?.reasons.some(reason => reason.includes('Candidate-bound approval'))).toBe(true)
  })

  it('is not merge-ready for an empty run or with an open blocking finding', () => {
    expect(
      buildGates({
        runId: 'run-empty',
        tasks: [],
        attempts: [],
        verifications: [],
        findings: [],
        approvals: [],
      }).mergeReady,
    ).toBe(false)

    const nonBlocking = reader
      .findings(ids.runId)
      .map((finding) => ({ ...finding, blocking: false }))
    expect(gates({ findings: nonBlocking }).mergeReady).toBe(false) // task B still fails verification

    const tasks = [taskById(ids.taskIds.a)]
    const verifications = reader
      .verifications(ids.runId)
      .filter((verification) => verification.attemptId === ids.attemptIds.a)
    expect(
      buildGates({
        runId: ids.runId,
        tasks,
        attempts: reader.attempts(ids.runId),
        verifications,
        findings: nonBlocking,
        approvals: [],
      }).mergeReady,
    ).toBe(false)

    const blocking = nonBlocking.map((finding) =>
      finding.id === 'finding-run' ? { ...finding, blocking: true } : finding,
    )
    expect(
      buildGates({
        runId: ids.runId,
        tasks,
        attempts: reader.attempts(ids.runId),
        verifications,
        findings: blocking.filter((finding) => finding.id === 'finding-run'),
        approvals: [],
      }).mergeReady,
    ).toBe(false)
  })

  it('does not accept unrelated passing checks in place of required commands', () => {
    const task = { ...taskById(ids.taskIds.a), state: 'completed', verificationCommands: ['bun test', 'bun run build'] }
    const data = gates({ tasks: [task], findings: [] })
    expect(data.tasks[0]?.missingCommands).toEqual(['bun run build'])
    expect(data.tasks[0]?.passed).toBe(false)
    expect(data.readiness?.evidenceReady).toBe(false)
    expect(data.mergeReady).toBe(false)
  })
})

describe('projections — refinements', () => {
  const events = () =>
    reader.eventsOfType(ids.runId, [
      'refinement_requested',
      'refinement_completed',
      'refinement_declined',
    ])

  it('reads contract, events and requirements markdown', () => {
    const data = buildRefinements({
      run: runRecord(),
      contract: runRecord().contract,
      events: events(),
      requirements: { path: 'requirements.md', content: '# Requirements\n' },
    })
    expect(data.state).toBe('completed')
    expect(data.outcome).toBe('completed')
    expect(data.uncertainties).toEqual(['Which runtime?', 'Is the DB read-only?'])
    expect(data.qaPairs).toEqual([
      { question: 'q1', answer: 'a1' },
      { question: 'Which runtime?', answer: '2.2.4' },
    ])
    expect(data.requirementsPath).toBe('requirements.md')
    expect(data.requirementsMarkdown).toBe('# Requirements\n')
    expect(data.events.map((event) => event.type)).toEqual([
      'refinement_requested',
      'refinement_completed',
    ])
  })

  it('reports awaiting from the run state even without an outcome', () => {
    const run = { ...runRecord(), state: 'awaiting_refinement', contract: null }
    const data = buildRefinements({ run, contract: null, events: [], requirements: null })
    expect(data.state).toBe('awaiting')
    expect(data.outcome).toBeNull()
    expect(data.requirementsMarkdown).toBeNull()
  })

  it('reports declined from the contract outcome', () => {
    const data = buildRefinements({
      run: runRecord(),
      contract: { refinement: { outcome: 'declined' } },
      events: [],
    })
    expect(data.state).toBe('declined')
    expect(data.outcome).toBe('declined')
  })

  it('reports none without any refinement data and unknown with unresolvable data', () => {
    const none = buildRefinements({
      run: { ...runRecord(), state: 'intake', contract: null },
      contract: null,
      events: [],
    })
    expect(none.state).toBe('none')

    const unknown = buildRefinements({
      run: runRecord(),
      contract: { refinement: {} },
      events: [],
    })
    expect(unknown.state).toBe('unknown')
  })
})

describe('projections — memory', () => {
  it('builds summaries with a 400-char preview, total and limit', () => {
    const blocks = [
      memoryBlock({ label: 'alpha', version: 2, content: 'b'.repeat(500) }),
      memoryBlock({ label: 'alpha', version: 1, content: 'short' }),
    ]
    const data = buildMemory(blocks, 1)
    expect(data.total).toBe(2)
    expect(data.blocks).toHaveLength(1)
    expect(data.blocks[0].contentPreview).toHaveLength(400)
    expect(data.blocks[0].version).toBe(2)
    expect(buildMemory(blocks).blocks).toHaveLength(2)
  })

  it('builds the full block shape', () => {
    const block = memoryBlock({
      label: 'alpha',
      version: 3,
      content: 'full content',
      contentHash: 'sha256:abc',
      actor: 'memory-curator',
      confidence: 0.9,
      reviewAfter: '2026-12-01',
      sourceRunId: 'run-1',
      sourceArtifacts: ['runs/run-1/receipt.md'],
      supersedes: 'alpha.v2',
    })
    expect(buildMemoryBlock(block)).toEqual({
      label: 'alpha',
      version: 3,
      scope: 'project',
      status: 'active',
      confidence: 0.9,
      reviewAfter: '2026-12-01',
      sourceRunId: 'run-1',
      sourceArtifacts: ['runs/run-1/receipt.md'],
      content: 'full content',
      contentHash: 'sha256:abc',
      actor: 'memory-curator',
      supersedes: 'alpha.v2',
    })
  })
})

describe('projections — routing', () => {
  it('joins fleet assignments with observed attempts and null-safe costs', () => {
    const data = buildRouting({
      runId: ids.runId,
      tasks: reader.tasks(ids.runId),
      attempts: reader.attempts(ids.runId),
      fleetModels: {
        coder: { model: 'opencode-go/deepseek-v4.1-flash', variant: 'max' },
        'test-engineer': { model: 'opencode-go/mimo-v2.6-pro' },
      },
    })

    expect(data.assignments).toEqual([
      { role: 'coder', model: 'opencode-go/deepseek-v4.1-flash', variant: 'max', source: 'fleet' },
      { role: 'test-engineer', model: 'opencode-go/mimo-v2.6-pro', variant: null, source: 'fleet' },
    ])

    expect(data.observed).toHaveLength(2)
    const coder = data.observed.find((row) => row.role === 'coder')!
    expect(coder).toEqual({
      role: 'coder',
      modelSlot: 'implementation',
      modelProvider: 'opencode-go',
      modelId: 'deepseek-v4.1-flash',
      modelVariant: 'max',
      attempts: 1,
      completed: 1,
      failed: 0,
      avgDurationMs: 60_000,
    })
    const tester = data.observed.find((row) => row.role === 'test-engineer')!
    expect(tester.failed).toBe(1)
    expect(tester.completed).toBe(0)
    expect(tester.avgDurationMs).toBe(60_000)

    expect(data.costs.totalTokens).toBe(1000)
    expect(data.costs.totalCost).toBeNull() // missing is null, never 0
    expect(data.costs.currency).toBeNull()
    expect(data.costs.coverage).toEqual({ attempts: 2, withUsage: 1 })
    const flash = data.costs.byModel.find(
      (row) => row.model === 'opencode-go/deepseek-v4.1-flash',
    )!
    expect(flash).toEqual({
      model: 'opencode-go/deepseek-v4.1-flash',
      attempts: 1,
      tokens: 1000,
      cost: null,
      currency: null,
    })
    const mimo = data.costs.byModel.find((row) => row.model === 'opencode-go/mimo-v2.6-pro')!
    expect(mimo.tokens).toBeNull()
    expect(mimo.cost).toBeNull()
  })

  it('adds an unknown assignment for a role the fleet does not cover', () => {
    const data = buildRouting({
      runId: ids.runId,
      tasks: reader.tasks(ids.runId),
      attempts: reader.attempts(ids.runId),
      fleetModels: { 'test-engineer': { model: 'opencode-go/mimo-v2.6-pro' } },
    })
    expect(data.assignments).toContainEqual({
      role: 'coder',
      model: 'opencode-go/deepseek-v4.1-flash',
      variant: 'max',
      source: 'unknown',
    })
  })

  it('sums cost_json when present', async () => {
    const raw = new Database(project.layout.ledgerPath)
    raw.run(`UPDATE attempts SET cost_json = ? WHERE id = ?`, [
      JSON.stringify({ total_cost: 0.25, currency: 'USD' }),
      ids.attemptIds.a,
    ])
    raw.close()
    const data = buildRouting({
      runId: ids.runId,
      tasks: reader.tasks(ids.runId),
      attempts: reader.attempts(ids.runId),
      fleetModels: null,
    })
    expect(data.costs.totalCost).toBe(0.25)
    expect(data.costs.currency).toBe('USD')
    expect(data.costs.totalTokens).toBe(1000)
    expect(data.assignments.every((assignment) => assignment.source === 'unknown')).toBe(true)
  })
})

describe('projections — timeline', () => {
  it('maps events with summaries, ordering and truncation', () => {
    const events = reader.events(ids.runId)
    const data = buildTimeline({ runId: ids.runId, events, limit: 2 })
    expect(data.events.map((event) => event.type)).toEqual(['run_created', 'refinement_requested'])
    expect(data.lastSequence).toBe(events[1].sequence)
    expect(data.truncated).toBe(true)
    expect(data.events[0].summary).toBe('Run created')
    expect(data.events[1].summary).toBe('Refinement requested')

    const all = buildTimeline({ runId: ids.runId, events })
    expect(all.truncated).toBe(false)
    const transition = all.events.find((event) => event.type === 'work_item_state_transition')!
    expect(transition.taskId).toBe(ids.taskIds.a)
    expect(transition.summary).toBe(`Task ${ids.taskIds.a} ready → running`)
    expect(transition.payload).toEqual({ from: 'ready', to: 'running' })
  })

  it('handles no events and unknown event types', () => {
    const empty = buildTimeline({ runId: 'run-empty', events: [] })
    expect(empty.lastSequence).toBe(0)
    expect(empty.truncated).toBe(false)
    expect(empty.events).toEqual([])

    const idle = buildTimeline({ runId: 'run-empty', events: [], afterSequence: 12 })
    expect(idle.lastSequence).toBe(12)

    expect(summarizeEvent('custom_event', null)).toBe('Custom event')
    expect(summarizeEvent('attempt_started', { attempt_no: 2 })).toBe('Attempt #2 started')
    expect(summarizeEvent('verification_completed', { command: 'bun test', passed: false })).toBe(
      'Verification failed: bun test',
    )
    expect(summarizeEvent('review_finding_created', { severity: 'high', title: 'Bug' })).toBe(
      'Finding (high): Bug',
    )
    expect(summarizeEvent('run_state_transition', { from: 'intake', to: 'planned' })).toBe(
      'Run intake → planned',
    )
  })
})
