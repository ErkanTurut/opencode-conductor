// Pure projections: ledger rows + artifacts in, exactly the shapes declared in
// `src/rpc-contract.ts` out.
//
// Nothing in this module performs IO, reads a clock or mutates its input, so the
// GUI's data can be rebuilt from the same rows in a test without a filesystem or
// a database. Malformed JSON, dangling dependency ids, cycles and missing usage
// data are all normal inputs here: every builder degrades instead of throwing.
//
// Import note: extensionless specifiers (the package's `tsc --noEmit` baseline
// rejects `.ts`-suffixed imports).
import type {
  DagData,
  DagEdge,
  DagNode,
  GateFinding,
  GateVerification,
  GatesData,
  MemoryBlockData,
  MemoryBlockSummary,
  MemoryData,
  RefinementData,
  RoutingData,
  RunDetailData,
  RunSummary,
  RunTask,
  RunsData,
  TimelineData,
  TimelineEvent,
  WorkspaceData,
} from '../rpc-contract'
import type { StateLayout } from '../runtime/state-layout'
import { DEFAULT_BUDGET } from '../types'
import type {
  LedgerApprovalRecord,
  LedgerAttemptRecord,
  LedgerCounts,
  LedgerEventRecord,
  LedgerFindingRecord,
  LedgerLeaseRecord,
  LedgerRunListRow,
  LedgerRunRecord,
  LedgerTaskRecord,
  LedgerVerificationRecord,
} from './ledger-reader'
import type { MemoryBlockRecord } from './artifacts'

// ---------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/**
 * Strings from a list that may mix prose with `{ question }` / `{ text }`
 * objects (the refinement contract uses both dialects).
 */
function textList(value: unknown): string[] {
  const out: string[] = []
  for (const entry of asArray(value)) {
    if (typeof entry === 'string') {
      const trimmed = entry.trim()
      if (trimmed.length > 0) out.push(entry)
      continue
    }
    const record = asRecord(entry)
    if (!record) continue
    const text =
      asString(record.question) ??
      asString(record.text) ??
      asString(record.uncertainty) ??
      asString(record.summary)
    if (text && text.trim().length > 0) out.push(text)
  }
  return out
}

/** Parse a SQLite `datetime('now')` value (UTC, no zone) or an ISO string. */
export function parseTimestamp(value: string | null | undefined): number | null {
  if (typeof value !== 'string') return null
  let text = value.trim()
  if (text.length === 0) return null
  if (/^\d{4}-\d{2}-\d{2} \d/.test(text)) text = text.replace(' ', 'T')
  if (/^\d{4}-\d{2}-\d{2}T[\d:.]+$/.test(text)) text = `${text}Z`
  const ms = Date.parse(text)
  return Number.isFinite(ms) ? ms : null
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

export interface WorkspaceInput {
  projectRoot: string
  layout: Pick<StateLayout, 'projectKey' | 'mode' | 'ledgerPath' | 'runsDir' | 'memoryDir'>
  trusted?: boolean
  policyRestricted?: boolean
  counts: LedgerCounts
}

export function buildWorkspace(input: WorkspaceInput): WorkspaceData {
  return {
    projectRoot: input.projectRoot,
    projectKey: input.layout.projectKey,
    mode: input.layout.mode,
    ledgerPath: input.layout.ledgerPath,
    runsDir: input.layout.runsDir,
    memoryDir: input.layout.memoryDir,
    trusted: input.trusted === true,
    policyRestricted: input.policyRestricted === true,
    counts: {
      runs: input.counts.runs,
      activeRuns: input.counts.activeRuns,
      tasks: input.counts.tasks,
      attempts: input.counts.attempts,
    },
  }
}

export function taskStateCounts(
  tasks: readonly LedgerTaskRecord[],
): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const task of tasks) {
    counts[task.state] = (counts[task.state] ?? 0) + 1
  }
  return counts
}

export function buildRunSummary(
  run: LedgerRunRecord,
  taskCount?: number,
  counts?: Record<string, number>,
): RunSummary {
  return {
    id: run.id,
    state: run.state,
    riskClass: run.riskClass,
    operationMode: run.operationMode,
    objective: run.objective,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    taskCount: typeof taskCount === 'number' ? taskCount : 0,
    counts: counts ?? {},
    hasReceipt: run.hasReceipt,
  }
}

export interface RunsInput {
  runs: readonly LedgerRunListRow[]
  nextCursor: string | null
}

export function buildRuns(input: RunsInput): RunsData {
  return {
    runs: input.runs.map((run) => buildRunSummary(run, run.taskCount, run.counts)),
    nextCursor: input.nextCursor,
  }
}

// ---------------------------------------------------------------------------
// Run detail (latest attempt + lease per task)
// ---------------------------------------------------------------------------

export interface RunDetailInput {
  run: LedgerRunRecord
  tasks: readonly LedgerTaskRecord[]
  attempts: readonly LedgerAttemptRecord[]
  leases: readonly LedgerLeaseRecord[]
  approvals: readonly LedgerApprovalRecord[]
  eventCount?: number
  runDir?: string | null
}

/** Latest attempt per work item: highest attempt number, then newest row. */
export function latestAttemptByTask(
  attempts: readonly LedgerAttemptRecord[],
): Map<string, LedgerAttemptRecord> {
  const latest = new Map<string, LedgerAttemptRecord>()
  for (const attempt of attempts) {
    const current = latest.get(attempt.workItemId)
    if (!current) {
      latest.set(attempt.workItemId, attempt)
      continue
    }
    if (attempt.attemptNo > current.attemptNo) {
      latest.set(attempt.workItemId, attempt)
      continue
    }
    if (
      attempt.attemptNo === current.attemptNo &&
      attempt.createdAt > current.createdAt
    ) {
      latest.set(attempt.workItemId, attempt)
    }
  }
  return latest
}

function buildRunTask(
  task: LedgerTaskRecord,
  attempt: LedgerAttemptRecord | null,
  lease: LedgerLeaseRecord | null,
): RunTask {
  return {
    id: task.id,
    title: task.title,
    role: task.role,
    modelSlot: task.modelSlot,
    state: task.state,
    priority: task.priority,
    attempts: task.attempts,
    dependencies: [...task.dependencies],
    writeScope: [...task.writeScope],
    allowedPaths: [...task.allowedPaths],
    acceptanceCriteria: [...task.acceptanceCriteria],
    verificationCommands: [...task.verificationCommands],
    latestAttempt: attempt
      ? {
          id: attempt.id,
          attemptNo: attempt.attemptNo,
          state: attempt.state,
          modelProvider: attempt.modelProvider,
          modelId: attempt.modelId,
          modelVariant: attempt.modelVariant,
          startedAt: attempt.startedAt,
          finishedAt: attempt.finishedAt,
          exitCode: attempt.exitCode,
          failureClass: attempt.failureClass,
          usage: attempt.usage,
          cost: attempt.cost,
        }
      : null,
    lease: lease
      ? {
          owner: lease.owner,
          expiresAt: lease.expiresAt,
          heartbeatAt: lease.heartbeatAt,
          fencingToken: lease.fencingToken,
        }
      : null,
  }
}

export function buildRunDetail(input: RunDetailInput): RunDetailData {
  const latest = latestAttemptByTask(input.attempts)
  // A released (or never-claimed placeholder) lease is history, not a holder.
  // Every work item gets a lease row at creation; the contract has no released
  // flag, so only a claimed, unreleased lease is reported.
  const activeLeases = new Map<string, LedgerLeaseRecord>()
  for (const lease of input.leases) {
    if (lease.releasedAt !== null) continue
    if (lease.owner.length === 0 && lease.claimedAt === null) continue
    activeLeases.set(lease.workItemId, lease)
  }
  const tasks = input.tasks.map((task) =>
    buildRunTask(task, latest.get(task.id) ?? null, activeLeases.get(task.id) ?? null),
  )
  return {
    summary: buildRunSummary(
      input.run,
      tasks.length,
      taskStateCounts(input.tasks),
    ),
    contract: input.run.contract,
    budget: input.run.budget,
    plan: input.run.plan,
    tasks,
    approvals: input.approvals.map((approval) => ({
      id: approval.id,
      gate: approval.gate,
      decision: approval.decision,
      actor: approval.actor,
      createdAt: approval.createdAt,
      expiresAt: approval.expiresAt,
    })),
    eventCount: input.eventCount ?? 0,
    runDir: input.runDir ?? null,
  }
}

// ---------------------------------------------------------------------------
// DAG
// ---------------------------------------------------------------------------

export interface DagInput {
  runId: string
  tasks: readonly LedgerTaskRecord[]
}

interface Graph {
  nodes: Map<string, DagNode>
  edges: DagEdge[]
  ghostIds: string[]
}

function stronglyConnectedComponents(
  ids: readonly string[],
  adjacency: Map<string, string[]>,
): string[][] {
  let index = 0
  const indices = new Map<string, number>()
  const lowlink = new Map<string, number>()
  const onStack = new Set<string>()
  const stack: string[] = []
  const components: string[][] = []

  // Iterative Tarjan: a deep task graph must not overflow the call stack.
  for (const root of ids) {
    if (indices.has(root)) continue
    const work: Array<{ id: string; next: number }> = [{ id: root, next: 0 }]
    indices.set(root, index)
    lowlink.set(root, index)
    index += 1
    stack.push(root)
    onStack.add(root)

    while (work.length > 0) {
      const frame = work[work.length - 1]
      const neighbours = adjacency.get(frame.id) ?? []
      if (frame.next < neighbours.length) {
        const next = neighbours[frame.next]
        frame.next += 1
        if (!indices.has(next)) {
          indices.set(next, index)
          lowlink.set(next, index)
          index += 1
          stack.push(next)
          onStack.add(next)
          work.push({ id: next, next: 0 })
        } else if (onStack.has(next)) {
          lowlink.set(
            frame.id,
            Math.min(lowlink.get(frame.id) ?? 0, indices.get(next) ?? 0),
          )
        }
        continue
      }

      work.pop()
      if (work.length > 0) {
        const parent = work[work.length - 1]
        lowlink.set(
          parent.id,
          Math.min(lowlink.get(parent.id) ?? 0, lowlink.get(frame.id) ?? 0),
        )
      }
      if (lowlink.get(frame.id) === indices.get(frame.id)) {
        const component: string[] = []
        while (stack.length > 0) {
          const member = stack.pop() as string
          onStack.delete(member)
          component.push(member)
          if (member === frame.id) break
        }
        components.push(component.sort())
      }
    }
  }
  return components
}

function buildGraph(tasks: readonly LedgerTaskRecord[]): Graph {
  const nodes = new Map<string, DagNode>()
  const edges: DagEdge[] = []
  const seenEdges = new Set<string>()
  const realIds = new Set<string>()
  for (const task of tasks) realIds.add(task.id)

  for (const task of tasks) {
    nodes.set(task.id, {
      id: task.id,
      title: task.title,
      role: task.role,
      modelSlot: task.modelSlot,
      state: task.state,
      priority: task.priority,
      attempts: task.attempts,
      ghost: false,
      layer: 0,
      dependencies: [...task.dependencies],
    })
  }

  const ghostIds = new Set<string>()
  for (const task of tasks) {
    for (const dependency of task.dependencies) {
      if (typeof dependency !== 'string' || dependency.length === 0) continue
      const key = `${dependency}\u0000${task.id}`
      if (seenEdges.has(key)) continue
      seenEdges.add(key)
      const resolved = realIds.has(dependency)
      edges.push({ from: dependency, to: task.id, resolved })
      if (!resolved) ghostIds.add(dependency)
    }
  }

  for (const ghostId of ghostIds) {
    nodes.set(ghostId, {
      id: ghostId,
      title: ghostId,
      role: '',
      modelSlot: '',
      state: 'unknown',
      priority: 0,
      attempts: 0,
      ghost: true,
      layer: 0,
      dependencies: [],
    })
  }

  return { nodes, edges, ghostIds: [...ghostIds].sort() }
}

/** Longest-path layers over the SCC condensation (cycles become one layer). */
function assignLayers(graph: Graph, components: string[][]): Map<string, number> {
  const componentOf = new Map<string, number>()
  components.forEach((component, componentIndex) => {
    for (const id of component) componentOf.set(id, componentIndex)
  })

  const condensation = new Map<number, Set<number>>()
  for (let i = 0; i < components.length; i += 1) condensation.set(i, new Set())
  for (const edge of graph.edges) {
    const from = componentOf.get(edge.from)
    const to = componentOf.get(edge.to)
    if (from === undefined || to === undefined || from === to) continue
    condensation.get(from)?.add(to)
  }

  const depth = new Map<number, number>()
  const visiting = new Set<number>()
  const resolve = (componentIndex: number): number => {
    const cached = depth.get(componentIndex)
    if (cached !== undefined) return cached
    // The condensation is acyclic by construction; the guard only protects
    // against a malformed graph, and returning 0 is a safe layer.
    if (visiting.has(componentIndex)) return 0
    visiting.add(componentIndex)
    let value = 0
    for (const [from, targets] of condensation) {
      if (!targets.has(componentIndex)) continue
      value = Math.max(value, resolve(from) + 1)
    }
    visiting.delete(componentIndex)
    depth.set(componentIndex, value)
    return value
  }

  const layers = new Map<string, number>()
  for (const [id, componentIndex] of componentOf) {
    layers.set(id, resolve(componentIndex))
  }
  return layers
}

export function buildDag(input: DagInput): DagData {
  const graph = buildGraph(input.tasks)
  const ids = [...graph.nodes.keys()].sort()
  const adjacency = new Map<string, string[]>()
  for (const id of ids) adjacency.set(id, [])
  for (const edge of graph.edges) {
    adjacency.get(edge.from)?.push(edge.to)
  }
  for (const targets of adjacency.values()) targets.sort()

  const components = stronglyConnectedComponents(ids, adjacency)
  const layers = assignLayers(graph, components)

  const nodes = ids.map((id) => {
    const node = graph.nodes.get(id) as DagNode
    return { ...node, layer: layers.get(id) ?? 0 }
  })

  const realIds = new Set(input.tasks.map((task) => task.id))
  const maxRealLayer = nodes.reduce(
    (max, node) => (node.ghost ? max : Math.max(max, node.layer)),
    -1,
  )
  const maxLayer = nodes.reduce((max, node) => Math.max(max, node.layer), -1)
  const layerBuckets: string[][] = []
  for (let layer = 0; layer <= maxLayer; layer += 1) {
    layerBuckets.push(
      nodes.filter((node) => node.layer === layer).map((node) => node.id),
    )
  }

  const roots = input.tasks
    .filter((task) => !task.dependencies.some((dependency) => realIds.has(dependency)))
    .map((task) => task.id)
    .sort()
  const dependedOn = new Set(
    graph.edges.filter((edge) => edge.resolved).map((edge) => edge.from),
  )
  const leaves = input.tasks
    .map((task) => task.id)
    .filter((id) => !dependedOn.has(id))
    .sort()

  const cycles = components
    .filter(
      (component) =>
        component.length > 1 ||
        graph.edges.some((edge) => edge.from === edge.to && edge.to === component[0]),
    )
    .map((component) => [...component])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))

  return {
    runId: input.runId,
    nodes,
    edges: graph.edges,
    layers: layerBuckets,
    roots,
    leaves,
    dangling: graph.ghostIds,
    cycles,
    // Depth is the longest chain of real tasks (a single task is depth 1).
    maxDepth: maxRealLayer < 0 ? 0 : maxRealLayer + 1,
    maxDepthBudget: DEFAULT_BUDGET.max_dag_depth,
  }
}

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

export interface GatesInput {
  runId: string
  tasks: readonly LedgerTaskRecord[]
  attempts: readonly LedgerAttemptRecord[]
  verifications: readonly LedgerVerificationRecord[]
  findings: readonly LedgerFindingRecord[]
  approvals: readonly LedgerApprovalRecord[]
}

function toGateVerification(record: LedgerVerificationRecord): GateVerification {
  return {
    id: record.id,
    command: record.command,
    exitCode: record.exitCode,
    passed: record.exitCode === 0,
    durationMs: record.durationMs,
    outputHash: record.outputHash,
    stdoutPath: record.stdoutPath,
    stderrPath: record.stderrPath,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
  }
}

function toGateFinding(record: LedgerFindingRecord): GateFinding {
  return {
    id: record.id,
    severity: record.severity,
    category: record.category,
    title: record.title,
    location: record.location,
    evidence: record.evidence,
    confidence: record.confidence,
    blocking: record.blocking,
    status: record.status,
    requiredFix: record.requiredFix,
  }
}

function isOpenFinding(finding: LedgerFindingRecord): boolean {
  return finding.status === 'open'
}

/**
 * Findings carry no task column. A finding is attributed to a task when its
 * `review_id` names one of the run's attempts, then when the review id or the
 * location names a task; a run-level finding (review id = run id or
 * `{runId}:round-N`) follows the task with the newest attempt, which is the work
 * under review. `mergeReady` always uses the whole finding set.
 */
function attributeFindings(
  findings: readonly LedgerFindingRecord[],
  tasks: readonly LedgerTaskRecord[],
  attemptsByTask: Map<string, LedgerAttemptRecord>,
): Map<string, LedgerFindingRecord[]> {
  const groups = new Map<string, LedgerFindingRecord[]>()
  for (const task of tasks) groups.set(task.id, [])

  const taskByAttempt = new Map<string, string>()
  for (const [taskId, attempt] of attemptsByTask) {
    taskByAttempt.set(attempt.id, taskId)
  }

  let focusTaskId: string | null = null
  let focusAt = Number.NEGATIVE_INFINITY
  for (const attempt of attemptsByTask.values()) {
    const at = parseTimestamp(attempt.finishedAt) ?? parseTimestamp(attempt.createdAt) ?? 0
    if (at > focusAt) {
      focusAt = at
      focusTaskId = attempt.workItemId
    }
  }
  if (focusTaskId === null && tasks.length > 0) focusTaskId = tasks[0].id

  for (const finding of findings) {
    let taskId: string | null = null
    for (const [attemptId, owner] of taskByAttempt) {
      if (finding.reviewId === attemptId || finding.reviewId.includes(attemptId)) {
        taskId = owner
        break
      }
    }
    if (taskId === null) {
      for (const task of tasks) {
        if (
          finding.reviewId.includes(task.id) ||
          (finding.location ?? '').includes(task.id)
        ) {
          taskId = task.id
          break
        }
      }
    }
    if (taskId === null) taskId = focusTaskId
    if (taskId === null) continue
    groups.get(taskId)?.push(finding)
  }
  return groups
}

export function buildGates(input: GatesInput): GatesData {
  const latest = latestAttemptByTask(input.attempts)
  const verificationsByAttempt = new Map<string, LedgerVerificationRecord[]>()
  for (const verification of input.verifications) {
    const bucket = verificationsByAttempt.get(verification.attemptId) ?? []
    bucket.push(verification)
    verificationsByAttempt.set(verification.attemptId, bucket)
  }
  const findingsByTask = attributeFindings(input.findings, input.tasks, latest)

  const tasks = input.tasks.map((task) => {
    const attempt = latest.get(task.id) ?? null
    const verifications = attempt
      ? (verificationsByAttempt.get(attempt.id) ?? []).map(toGateVerification)
      : []
    const findings = (findingsByTask.get(task.id) ?? []).map(toGateFinding)
    const blockingOpen = (findingsByTask.get(task.id) ?? []).filter(
      (finding) => finding.blocking && isOpenFinding(finding),
    ).length
    const requiredCommands = [...task.verificationCommands]
    const missingCommands = requiredCommands.filter(command =>
      !verifications.some(verification => verification.command === command && verification.passed),
    )
    return {
      taskId: task.id,
      title: task.title,
      state: task.state,
      attemptId: attempt ? attempt.id : null,
      attemptNo: attempt ? attempt.attemptNo : null,
      verifications,
      findings,
      blockingFindings: blockingOpen,
      openFindings: (findingsByTask.get(task.id) ?? []).filter(isOpenFinding).length,
      requiredCommands,
      missingCommands,
      passed:
        verifications.length === 0
          ? null
          : missingCommands.length === 0 && verifications.every((verification) => verification.passed),
    }
  })

  const failedVerification = tasks.some((task) => task.passed === false)
  const blockingOpen = input.findings.some(
    (finding) => finding.blocking && isOpenFinding(finding),
  )
  const evidenceReady = input.tasks.length > 0 && input.tasks.every((task, index) =>
    task.state === 'completed' && (
      task.verificationCommands.length > 0
        ? tasks[index]?.passed === true
        : task.writeScope.length === 0
    ),
  ) && !failedVerification && !blockingOpen
  const reasons = [
    ...(input.tasks.length === 0 ? ['No task plan is recorded.'] : []),
    ...(input.tasks.some(task => task.state !== 'completed') ? ['Not all tasks are completed.'] : []),
    ...(tasks.some(task => (task.missingCommands?.length ?? 0) > 0 || (task.requiredCommands?.length ?? 0) > 0 && task.passed === null)
      ? ['Required verification evidence is missing for the latest attempt.'] : []),
    ...(input.tasks.some(task => task.writeScope.length > 0 && task.verificationCommands.length === 0)
      ? ['A mutating task has no required verification commands.'] : []),
    ...(failedVerification ? ['A recorded verification failed or required commands are incomplete.'] : []),
    ...(blockingOpen ? ['Open blocking review findings remain.'] : []),
    'Candidate-bound approval, remote protections, and preview readiness are not established by this projection.',
  ]
  return {
    runId: input.runId,
    approvals: input.approvals.map((approval) => ({
      id: approval.id,
      gate: approval.gate,
      decision: approval.decision,
      actor: approval.actor,
      createdAt: approval.createdAt,
      expiresAt: approval.expiresAt,
    })),
    tasks,
    // Legacy clients must not interpret an absence of recorded failures as
    // authorization. This read model has no authenticated candidate/approval.
    mergeReady: false,
    readiness: { evidenceReady, authoritative: false, reasons },
  }
}

// ---------------------------------------------------------------------------
// Refinements
// ---------------------------------------------------------------------------

export interface RefinementInput {
  run: LedgerRunRecord
  contract?: unknown
  events?: readonly LedgerEventRecord[]
  requirements?: { path: string | null; content: string | null } | null
}

const REFINEMENT_EVENT_TYPES = [
  'refinement_requested',
  'refinement_completed',
  'refinement_declined',
] as const

function refinementBlock(contract: unknown): Record<string, unknown> | null {
  return asRecord(asRecord(contract)?.refinement)
}

function normalizeOutcome(value: unknown): string | null {
  const text = asString(value)
  if (!text) return null
  const normalized = text.trim().toLowerCase()
  return normalized.length > 0 ? normalized : null
}

function refinementStateFromOutcome(outcome: string | null): RefinementData['state'] | null {
  if (!outcome) return null
  if (outcome === 'completed' || outcome === 'complete' || outcome === 'approved') {
    return 'completed'
  }
  if (outcome === 'declined' || outcome === 'declined_by_user' || outcome === 'rejected') {
    return 'declined'
  }
  return null
}

function extractQaPairs(block: Record<string, unknown> | null): Array<{ question: string; answer: string }> {
  if (!block) return []
  const pairs: Array<{ question: string; answer: string }> = []
  const push = (question: unknown, answer: unknown): void => {
    const q = asString(question)
    const a = asString(answer)
    if (q && q.trim().length > 0 && a !== null) pairs.push({ question: q, answer: a })
  }

  for (const key of ['qa_pairs', 'qa', 'questions'] as const) {
    const value = block[key]
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry === 'string') continue
        const record = asRecord(entry)
        if (!record) continue
        push(record.question ?? record.q, record.answer ?? record.a)
      }
      continue
    }
    const record = asRecord(value)
    if (record) {
      for (const [question, answer] of Object.entries(record)) push(question, answer)
    }
  }
  return pairs
}

export function buildRefinements(input: RefinementInput): RefinementData {
  const contract = input.contract ?? input.run.contract
  const block = refinementBlock(contract)
  const eventRecords = (input.events ?? []).filter((event) =>
    (REFINEMENT_EVENT_TYPES as readonly string[]).includes(event.type),
  )

  const uncertainties: string[] = []
  if (block) {
    for (const text of [
      ...textList(block.uncertainties),
      ...textList(block.open_questions),
    ]) {
      if (!uncertainties.includes(text)) uncertainties.push(text)
    }
  }

  const qaPairs = extractQaPairs(block)
  const seen = new Set(qaPairs.map((pair) => `${pair.question}\u0000${pair.answer}`))
  for (const event of eventRecords) {
    const payload = asRecord(event.payload)
    if (!payload) continue
    const question = asString(payload.question)
    const answer = asString(payload.answer)
    if (!question || question.trim().length === 0 || answer === null) continue
    const key = `${question}\u0000${answer}`
    if (seen.has(key)) continue
    seen.add(key)
    qaPairs.push({ question, answer })
  }

  const outcome =
    normalizeOutcome(block?.outcome) ?? normalizeOutcome(block?.status) ?? null

  let state: RefinementData['state']
  if (input.run.state === 'awaiting_refinement') {
    state = 'awaiting'
  } else {
    const fromOutcome = refinementStateFromOutcome(outcome)
    if (fromOutcome) {
      state = fromOutcome
    } else {
      const lastEvent = [...eventRecords].sort((a, b) => b.sequence - a.sequence)[0]
      if (lastEvent?.type === 'refinement_completed') state = 'completed'
      else if (lastEvent?.type === 'refinement_declined') state = 'declined'
      else if (block !== null || eventRecords.length > 0) state = 'unknown'
      else state = 'none'
    }
  }

  const events = [...eventRecords]
    .sort((a, b) => a.sequence - b.sequence)
    .map((event) => ({
      sequence: event.sequence,
      type: event.type,
      actor: event.actor,
      createdAt: event.createdAt,
      payload: event.payload,
    }))

  return {
    runId: input.run.id,
    state,
    uncertainties,
    qaPairs,
    outcome,
    requirementsPath:
      input.requirements?.path ?? asString(block?.requirements_path) ?? null,
    requirementsMarkdown: input.requirements?.content ?? null,
    contract,
    events,
  }
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

const MEMORY_PREVIEW_CHARS = 400

export function buildMemory(
  blocks: readonly MemoryBlockRecord[],
  limit?: number | null,
): MemoryData {
  // The reader already sorts, but a projection must hold the contract on its
  // own: newest version first per label, labels ascending.
  const sorted = [...blocks].sort((a, b) => {
    if (a.label !== b.label) return a.label < b.label ? -1 : 1
    if (a.version !== b.version) return b.version - a.version
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0
  })
  const summaries: MemoryBlockSummary[] = sorted.map((block) => ({
    label: block.label,
    version: block.version,
    scope: block.scope,
    status: block.status,
    confidence: block.confidence,
    reviewAfter: block.reviewAfter,
    sourceRunId: block.sourceRunId,
    contentPreview: block.content.slice(0, MEMORY_PREVIEW_CHARS),
    updatedAt: block.updatedAt,
  }))
  const capped =
    typeof limit === 'number' && Number.isFinite(limit)
      ? Math.max(0, Math.floor(limit))
      : summaries.length
  return { blocks: summaries.slice(0, capped), total: summaries.length }
}

export function buildMemoryBlock(block: MemoryBlockRecord): MemoryBlockData {
  return {
    label: block.label,
    version: block.version,
    scope: block.scope,
    status: block.status,
    confidence: block.confidence,
    reviewAfter: block.reviewAfter,
    sourceRunId: block.sourceRunId,
    sourceArtifacts: [...block.sourceArtifacts],
    content: block.content,
    contentHash: block.contentHash,
    actor: block.actor,
    supersedes: block.supersedes,
  }
}

// ---------------------------------------------------------------------------
// Routing & costs
// ---------------------------------------------------------------------------

export interface FleetModelEntry {
  model: string
  variant?: string | null
}

export interface RoutingInput {
  runId?: string | null
  tasks: readonly LedgerTaskRecord[]
  attempts: readonly LedgerAttemptRecord[]
  fleetModels?: Readonly<Record<string, FleetModelEntry>> | null
}

function extractTokens(usage: unknown): number | null {
  const record = asRecord(usage)
  if (!record) return null
  const direct = asNumber(record.total_tokens) ?? asNumber(record.totalTokens)
  if (direct !== null) return direct
  const parts = [
    'input_tokens',
    'output_tokens',
    'prompt_tokens',
    'completion_tokens',
    'cache_read_input_tokens',
    'cache_creation_input_tokens',
  ]
  let sum = 0
  let found = false
  for (const key of parts) {
    const value = asNumber(record[key])
    if (value === null) continue
    sum += value
    found = true
  }
  return found ? sum : null
}

function extractCost(
  cost: unknown,
  usage: unknown,
): { cost: number | null; currency: string | null } {
  for (const source of [cost, usage]) {
    const record = asRecord(source)
    if (!record) continue
    const value =
      asNumber(record.total_cost) ??
      asNumber(record.totalCost) ??
      asNumber(record.cost) ??
      asNumber(record.amount) ??
      asNumber(record.total)
    const currency = asString(record.currency)
    if (value !== null || currency !== null) {
      return { cost: value, currency }
    }
  }
  return { cost: null, currency: null }
}

function roundCost(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

function modelRef(provider: string, model: string): string {
  if (provider && model) return `${provider}/${model}`
  return model || provider || 'unknown'
}

export function buildRouting(input: RoutingInput): RoutingData {
  const taskById = new Map(input.tasks.map((task) => [task.id, task]))

  // Observed routing: attempts grouped by role/slot/model identity.
  interface ObservedBucket {
    role: string
    modelSlot: string
    modelProvider: string
    modelId: string
    modelVariant: string | null
    attempts: number
    completed: number
    failed: number
    durations: number[]
  }
  const buckets = new Map<string, ObservedBucket>()
  for (const attempt of input.attempts) {
    const task = taskById.get(attempt.workItemId)
    if (!task) continue
    const key = [
      task.role,
      task.modelSlot,
      attempt.modelProvider,
      attempt.modelId,
      attempt.modelVariant ?? '',
    ].join('\u0000')
    const bucket = buckets.get(key) ?? {
      role: task.role,
      modelSlot: task.modelSlot,
      modelProvider: attempt.modelProvider,
      modelId: attempt.modelId,
      modelVariant: attempt.modelVariant,
      attempts: 0,
      completed: 0,
      failed: 0,
      durations: [],
    }
    bucket.attempts += 1
    if (attempt.state === 'completed') bucket.completed += 1
    if (attempt.state === 'failed') bucket.failed += 1
    const started = parseTimestamp(attempt.startedAt)
    const finished = parseTimestamp(attempt.finishedAt)
    if (started !== null && finished !== null && finished >= started) {
      bucket.durations.push(finished - started)
    }
    buckets.set(key, bucket)
  }

  const observed = [...buckets.values()]
    .map((bucket) => ({
      role: bucket.role,
      modelSlot: bucket.modelSlot,
      modelProvider: bucket.modelProvider,
      modelId: bucket.modelId,
      modelVariant: bucket.modelVariant,
      attempts: bucket.attempts,
      completed: bucket.completed,
      failed: bucket.failed,
      avgDurationMs:
        bucket.durations.length === 0
          ? null
          : Math.round(
              bucket.durations.reduce((sum, value) => sum + value, 0) /
                bucket.durations.length,
            ),
    }))
    .sort((a, b) => {
      if (a.role !== b.role) return a.role < b.role ? -1 : 1
      if (a.modelProvider !== b.modelProvider) {
        return a.modelProvider < b.modelProvider ? -1 : 1
      }
      return a.modelId < b.modelId ? -1 : a.modelId > b.modelId ? 1 : 0
    })

  // Fleet assignments, plus an `unknown` assignment for an observed role the
  // fleet does not cover (the GUI must not invent a fleet entry).
  const assignments: RoutingData['assignments'] = []
  const fleetRoles = new Set<string>()
  for (const role of Object.keys(input.fleetModels ?? {}).sort()) {
    const entry = input.fleetModels?.[role]
    if (!entry || typeof entry.model !== 'string' || entry.model.length === 0) continue
    fleetRoles.add(role)
    assignments.push({
      role,
      model: entry.model,
      variant: entry.variant ?? null,
      source: 'fleet',
    })
  }
  const observedRoles = new Map<string, (typeof observed)[number]>()
  for (const row of observed) {
    if (fleetRoles.has(row.role)) continue
    const current = observedRoles.get(row.role)
    if (!current || row.attempts > current.attempts) observedRoles.set(row.role, row)
  }
  for (const [role, row] of [...observedRoles].sort((a, b) =>
    a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
  )) {
    assignments.push({
      role,
      model: modelRef(row.modelProvider, row.modelId),
      variant: row.modelVariant,
      source: 'unknown',
    })
  }

  // Costs: a missing usage/cost column stays null — never a fabricated 0.
  interface CostBucket {
    model: string
    attempts: number
    tokens: number | null
    cost: number | null
    currency: string | null
  }
  const costBuckets = new Map<string, CostBucket>()
  let withUsage = 0
  let totalTokens: number | null = null
  let totalCost: number | null = null
  let currency: string | null = null

  for (const attempt of input.attempts) {
    if (attempt.usage !== null) withUsage += 1
    const model = modelRef(attempt.modelProvider, attempt.modelId)
    const bucket = costBuckets.get(model) ?? {
      model,
      attempts: 0,
      tokens: null,
      cost: null,
      currency: null,
    }
    bucket.attempts += 1

    const tokens = extractTokens(attempt.usage)
    if (tokens !== null) {
      bucket.tokens = (bucket.tokens ?? 0) + tokens
      totalTokens = (totalTokens ?? 0) + tokens
    }
    const extracted = extractCost(attempt.cost, attempt.usage)
    if (extracted.cost !== null) {
      const rounded = roundCost(extracted.cost)
      bucket.cost = roundCost((bucket.cost ?? 0) + rounded)
      totalCost = roundCost((totalCost ?? 0) + rounded)
    }
    if (extracted.currency !== null) {
      bucket.currency = bucket.currency ?? extracted.currency
      currency = currency ?? extracted.currency
    }
    costBuckets.set(model, bucket)
  }

  const byModel = [...costBuckets.values()].sort((a, b) =>
    a.model < b.model ? -1 : a.model > b.model ? 1 : 0,
  )

  return {
    assignments,
    observed,
    costs: {
      byModel,
      totalTokens,
      totalCost,
      currency,
      coverage: { attempts: input.attempts.length, withUsage },
    },
  }
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

export interface TimelineInput {
  runId: string
  events: readonly LedgerEventRecord[]
  /** Pass `limit + 1` events to let the builder detect truncation. */
  limit?: number | null
  /** Cursor the caller polled with; echoed when a page is empty. */
  afterSequence?: number | null
}

const DEFAULT_TIMELINE_LIMIT = 200
const MAX_TIMELINE_LIMIT = 1000

function humanizeType(type: string): string {
  if (type.length === 0) return 'Event'
  const words = type.replace(/_/g, ' ')
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`
}

function payloadString(payload: Record<string, unknown> | null, ...keys: string[]): string | null {
  if (!payload) return null
  for (const key of keys) {
    const value = payload[key]
    if (typeof value === 'string' && value.length > 0) return value
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
    if (typeof value === 'boolean') return String(value)
  }
  return null
}

/** One human sentence per event type (never throws on a malformed payload). */
export function summarizeEvent(type: string, payload: unknown, workItemId?: string | null, attemptId?: string | null): string {
  const record = asRecord(payload)
  const task = workItemId ?? payloadString(record, 'work_item_id', 'task_id', 'taskId')
  const attempt = attemptId ?? payloadString(record, 'attempt_id', 'attemptId')
  const from = payloadString(record, 'from', 'previous_state')
  const to = payloadString(record, 'to', 'state')

  switch (type) {
    case 'run_created':
      return 'Run created'
    case 'run_state_transition':
      return from && to ? `Run ${from} → ${to}` : 'Run state changed'
    case 'refinement_requested':
      return 'Refinement requested'
    case 'refinement_completed':
      return 'Refinement completed'
    case 'refinement_declined':
      return 'Refinement declined'
    case 'work_item_created': {
      const title = payloadString(record, 'title')
      return title ? `Task created: ${title}` : 'Task created'
    }
    case 'work_item_state_transition':
      return from && to
        ? `Task ${task ?? ''} ${from} → ${to}`.replace('  ', ' ')
        : `Task ${task ?? ''} state changed`.replace('  ', ' ')
    case 'lease_claimed': {
      const owner = payloadString(record, 'leaseOwner', 'lease_owner', 'owner')
      return owner ? `Lease claimed by ${owner}` : 'Lease claimed'
    }
    case 'lease_expired':
      return payloadString(record, 'reason') === 'stale_heartbeat'
        ? 'Lease observed stale'
        : 'Lease expired'
    case 'lease_released':
      return 'Lease released'
    case 'attempt_started': {
      const no = payloadString(record, 'attempt_no', 'attemptNo')
      return no ? `Attempt #${no} started` : 'Attempt started'
    }
    case 'attempt_completed': {
      const exit = payloadString(record, 'exit_code', 'exitCode')
      return exit !== null ? `Attempt completed (exit ${exit})` : 'Attempt completed'
    }
    case 'attempt_failed': {
      const failure = payloadString(record, 'failure_class', 'failureClass')
      return failure ? `Attempt failed (${failure})` : 'Attempt failed'
    }
    case 'heartbeat':
      return 'Heartbeat'
    case 'verification_completed': {
      const command = payloadString(record, 'command')
      const passed = record?.passed
      const verdict = passed === true ? 'passed' : passed === false ? 'failed' : 'recorded'
      return command
        ? `Verification ${verdict}: ${command}`
        : `Verification ${verdict}`
    }
    case 'review_finding_created': {
      const severity = payloadString(record, 'severity')
      const title = payloadString(record, 'title')
      if (title && severity) return `Finding (${severity}): ${title}`
      return title ? `Finding: ${title}` : 'Review finding recorded'
    }
    case 'budget_consumed': {
      const actual = payloadString(record, 'actual')
      return actual ? `Budget consumed: ${actual}` : 'Budget consumed'
    }
    case 'budget_exhausted':
      return 'Budget exhausted'
    case 'merge_queued':
      return 'Merge queued'
    case 'merge_completed':
      return 'Merge completed'
    case 'merge_failed':
      return 'Merge failed'
    case 'repair_started':
      return `Repair started${task ? ` for ${task}` : ''}`
    case 'repair_completed':
      return `Repair completed${task ? ` for ${task}` : ''}`
    case 'run_cancelled':
      return 'Run cancelled'
    case 'run_paused':
      return 'Run paused'
    case 'run_resumed':
      return 'Run resumed'
    default: {
      const base = humanizeType(type)
      return attempt ? `${base} (${attempt})` : base
    }
  }
}

export function buildTimeline(input: TimelineInput): TimelineData {
  const requested =
    typeof input.limit === 'number' && Number.isFinite(input.limit)
      ? Math.floor(input.limit)
      : DEFAULT_TIMELINE_LIMIT
  const limit = Math.max(1, Math.min(MAX_TIMELINE_LIMIT, requested))

  const sorted = [...input.events].sort((a, b) => a.sequence - b.sequence)
  const truncated = sorted.length > limit
  const events: TimelineEvent[] = sorted.slice(0, limit).map((event) => ({
    sequence: event.sequence,
    type: event.type,
    actor: event.actor,
    createdAt: event.createdAt,
    taskId: event.workItemId,
    attemptId: event.attemptId,
    summary: summarizeEvent(event.type, event.payload, event.workItemId, event.attemptId),
    payload: event.payload,
  }))

  return {
    runId: input.runId,
    events,
    // An empty page echoes the caller's cursor so polling does not restart at 0.
    lastSequence:
      events.length > 0
        ? events[events.length - 1].sequence
        : typeof input.afterSequence === 'number' && Number.isFinite(input.afterSequence)
          ? Math.max(0, Math.floor(input.afterSequence))
          : 0,
    truncated,
  }
}
