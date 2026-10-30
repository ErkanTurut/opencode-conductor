// Shared fixtures for the read-layer tests: one real SQLite ledger created by
// the production `SqliteLedger` (writes are allowed in tests), plus a resolved
// state layout whose ledger/runs/memory paths live under a temp root.
import { Database } from 'bun:sqlite'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SqliteLedger } from '../../src/ledger/sqlite'
import { resolveStateLayout, type StateLayout } from '../../src/runtime/state-layout'

export interface TempProject {
  root: string
  layout: StateLayout
  cleanup(): void
}

/**
 * Temp project with a LOCAL layout whose paths are overridden to the temp root.
 * (`resolveStateLayout` realpaths `/var → /private/var` on macOS, so the derived
 * paths are not guaranteed to be under the mkdtemp string.)
 */
export function tempProject(prefix: string): TempProject {
  const root = mkdtempSync(join(tmpdir(), `${prefix}-`))
  const base = resolveStateLayout({ projectRoot: root, mode: 'local' })
  const layout: StateLayout = {
    ...base,
    ledgerPath: join(root, 'supervisor.db'),
    runsDir: join(root, 'runs'),
    memoryDir: join(root, 'memory'),
  }
  mkdirSync(layout.runsDir, { recursive: true })
  mkdirSync(layout.memoryDir, { recursive: true })
  return {
    root,
    layout,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  }
}

export interface SeedIds {
  runId: string
  otherRunId: string
  taskIds: {
    a: string
    b: string
    ghost: string
    cycleOne: string
    cycleTwo: string
  }
  attemptIds: {
    a: string
    b: string
  }
  eventSequences: number[]
}

/**
 * Seed: two runs, five tasks (one dangling dependency, one two-node cycle),
 * two attempts (one completed with usage/cost, one failed), pass/fail
 * verifications, a plan approval, a blocking run-level finding plus an
 * attempt-linked finding, four events and one claimed lease.
 */
export async function seedLedger(dbPath: string): Promise<SeedIds> {
  const ledger = new SqliteLedger(dbPath)
  const runId = 'run-alpha'
  const otherRunId = 'run-beta'
  const taskIds = {
    a: 'task-a',
    b: 'task-b',
    ghost: 'task-ghost',
    cycleOne: 'cycle-1',
    cycleTwo: 'cycle-2',
  }
  const attemptIds = { a: 'att-a-1', b: 'att-b-1' }

  const contract = {
    objective: 'alpha objective',
    refinement: {
      requirements_path: 'requirements.md',
      outcome: 'completed',
      uncertainties: ['Which runtime?', { question: 'Is the DB read-only?' }],
      qa_pairs: [{ question: 'q1', answer: 'a1' }],
    },
  }
  const budget = { max_attempts_per_task: 3, max_dag_depth: 4 }

  await ledger.createRun({
    id: runId,
    parentId: null,
    repoId: '/repo',
    requestHash: 'hash-alpha',
    dataClass: 'internal',
    policyProfile: 'assisted',
    operationMode: 'assisted',
    riskClass: 'high',
    requestText: 'alpha objective',
    budgetJson: JSON.stringify(budget),
    deadlineAt: null,
  })
  await ledger.transitionRunState(runId, 'intake')
  await ledger.updateRunContract(runId, JSON.stringify(contract))

  await ledger.createRun({
    id: otherRunId,
    parentId: null,
    repoId: '/repo',
    requestHash: 'hash-beta',
    dataClass: 'internal',
    policyProfile: 'assisted',
    operationMode: 'assisted',
    riskClass: 'low',
    requestText: 'beta objective',
    budgetJson: '{}',
    deadlineAt: null,
  })

  const task = (
    id: string,
    title: string,
    role: string,
    slot: string,
    priority: number,
    dependencies: string[],
  ) =>
    ledger.createWorkItem({
      id,
      runId,
      issueKey: id,
      title,
      dependencyJson: JSON.stringify(dependencies),
      ownerRole: role,
      modelSlot: slot,
      priority,
      writeScopeJson: JSON.stringify([`src/${id}/**`]),
      contractJson: JSON.stringify({ task_id: id }),
      allowedPathsJson: JSON.stringify(['src/**']),
      readPathsJson: JSON.stringify(['**/*']),
      acceptanceCriteriaJson: JSON.stringify(['criterion one', 'criterion two']),
      verificationCommandsJson: JSON.stringify(['bun test']),
    })

  await task(taskIds.a, 'Task A', 'coder', 'implementation', 0, [])
  await task(taskIds.b, 'Task B', 'test-engineer', 'testing', 1, [taskIds.a])
  await task(taskIds.ghost, 'Task Ghost', 'coder', 'implementation', 2, ['task-missing'])
  await task(taskIds.cycleOne, 'Cycle One', 'coder', 'implementation', 3, [taskIds.cycleTwo])
  await task(taskIds.cycleTwo, 'Cycle Two', 'coder', 'implementation', 4, [taskIds.cycleOne])

  await ledger.createAttempt({
    id: attemptIds.a,
    workItemId: taskIds.a,
    attemptNo: 1,
    harness: 'opencode-cli',
    modelProvider: 'opencode-go',
    modelId: 'deepseek-v4.1-flash',
    modelVariant: 'max',
    workspaceId: null,
    baseSha: 'abc',
  })
  await ledger.completeAttempt(
    attemptIds.a,
    0,
    JSON.stringify({ total_tokens: 1000 }),
    null,
    null,
    null,
  )
  await ledger.createAttempt({
    id: attemptIds.b,
    workItemId: taskIds.b,
    attemptNo: 1,
    harness: 'opencode-cli',
    modelProvider: 'opencode-go',
    modelId: 'mimo-v2.6-pro',
    modelVariant: null,
    workspaceId: null,
    baseSha: 'abc',
  })
  await ledger.failAttempt(attemptIds.b, 'exit_nonzero', 1, null, null)

  await ledger.createVerification({
    id: 'verify-a',
    attemptId: attemptIds.a,
    profile: 'default',
    command: 'bun test',
    exitCode: 0,
    outputHash: 'hash-pass',
    durationMs: 1234,
  })
  await ledger.createVerification({
    id: 'verify-b',
    attemptId: attemptIds.b,
    profile: 'default',
    command: 'bun run typecheck',
    exitCode: 1,
    outputHash: 'hash-fail',
    durationMs: 42,
  })

  await ledger.createApproval({
    id: 'appr-1',
    runId,
    gate: 'plan',
    decision: 'approved',
    actor: 'operator',
  })

  // Run-level finding (blocking, open) + an attempt-linked non-blocking one.
  await ledger.createReviewFinding({
    id: 'finding-run',
    reviewId: runId,
    severity: 'high',
    category: 'correctness',
    title: 'Blocking run-level issue',
    fingerprint: 'fp-run',
    evidence: 'evidence',
    confidence: 0.9,
    blocking: true,
  })
  await ledger.createReviewFinding({
    id: 'finding-attempt',
    reviewId: attemptIds.a,
    severity: 'low',
    category: 'style',
    title: 'Attempt-linked nit',
    fingerprint: 'fp-attempt',
    evidence: 'evidence',
    confidence: 0.6,
    blocking: false,
  })

  await ledger.appendEvent({
    runId,
    eventType: 'run_created',
    actor: 'supervisor',
    payloadJson: JSON.stringify({ objective: 'alpha objective' }),
  })
  await ledger.appendEvent({
    runId,
    eventType: 'refinement_requested',
    actor: 'requirements-refiner',
    payloadJson: JSON.stringify({ question: 'Which runtime?', answer: '2.2.4' }),
  })
  await ledger.appendEvent({
    runId,
    eventType: 'refinement_completed',
    actor: 'requirements-refiner',
    payloadJson: JSON.stringify({ round: 1 }),
  })
  await ledger.appendEvent({
    runId,
    workItemId: taskIds.a,
    eventType: 'work_item_state_transition',
    actor: 'supervisor',
    payloadJson: JSON.stringify({ from: 'ready', to: 'running' }),
  })

  const claim = await ledger.claimLease({
    workItemId: taskIds.a,
    leaseOwner: 'worker-1',
    leaseExpiresAt: '2999-01-01T00:00:00.000Z',
  })
  if (!claim.claimed) throw new Error('seed: lease claim failed')

  const events = await ledger.getEvents(runId)
  ledger.close()

  // Writes that the ledger interface does not expose: deterministic ordering
  // keys and attempt wall-clock data. Tests may write; the reader may not.
  const raw = new Database(dbPath)
  try {
    raw.run(
      `UPDATE runs SET updated_at = '2026-01-02 00:00:00', state = 'intake' WHERE id = ?`,
      [runId],
    )
    raw.run(
      `UPDATE runs SET updated_at = '2026-01-03 00:00:00', state = 'completed' WHERE id = ?`,
      [otherRunId],
    )
    raw.run(
      `UPDATE attempts SET started_at = '2026-01-01 00:00:00', finished_at = '2026-01-01 00:01:00' WHERE id = ?`,
      [attemptIds.a],
    )
    raw.run(
      `UPDATE attempts SET started_at = '2026-01-01 00:01:00', finished_at = '2026-01-01 00:02:00' WHERE id = ?`,
      [attemptIds.b],
    )
  } finally {
    raw.close()
  }

  return {
    runId,
    otherRunId,
    taskIds,
    attemptIds,
    eventSequences: events.map((event) => event.sequence),
  }
}
