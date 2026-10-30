import { afterEach, describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  LedgerReader,
  decodeRunCursor,
  encodeRunCursor,
  parseJsonObject,
  parseJsonValue,
  parseStringArray,
} from '../../src/read/ledger-reader'
import { seedLedger, tempProject, type SeedIds, type TempProject } from './seed'

let project: TempProject
let ids: SeedIds
let reader: LedgerReader

async function setup(): Promise<void> {
  project = tempProject('ledger-reader')
  ids = await seedLedger(project.layout.ledgerPath)
  reader = new LedgerReader(project.layout.ledgerPath)
}

afterEach(() => {
  project?.cleanup()
})

describe('LedgerReader — missing database', () => {
  it('returns empty results and never creates the file', () => {
    project = tempProject('ledger-missing')
    const path = join(project.root, 'nope.db')
    const missing = new LedgerReader(path)
    expect(missing.exists()).toBe(false)
    expect(missing.counts()).toEqual({ runs: 0, activeRuns: 0, tasks: 0, attempts: 0 })
    expect(missing.runs()).toEqual({ runs: [], nextCursor: null })
    expect(missing.run('run-alpha')).toBeNull()
    expect(missing.tasks('run-alpha')).toEqual([])
    expect(missing.attempts('run-alpha')).toEqual([])
    expect(missing.leases('run-alpha')).toEqual([])
    expect(missing.approvals('run-alpha')).toEqual([])
    expect(missing.verifications('run-alpha')).toEqual([])
    expect(missing.findings('run-alpha')).toEqual([])
    expect(missing.events('run-alpha')).toEqual([])
    expect(missing.eventsOfType('run-alpha', ['run_created'])).toEqual([])
    expect(missing.eventCount('run-alpha')).toBe(0)
    expect(missing.costRows('run-alpha')).toEqual([])
    expect(existsSync(path)).toBe(false)
  })

  it('degrades to empty when the path is not a database', () => {
    project = tempProject('ledger-bogus')
    const bogus = new LedgerReader(project.root)
    expect(bogus.counts().runs).toBe(0)
    expect(bogus.runs().runs).toEqual([])
  })
})

describe('LedgerReader — seeded ledger', () => {
  it('counts runs, active runs, tasks and attempts', async () => {
    await setup()
    expect(reader.counts()).toEqual({ runs: 2, activeRuns: 1, tasks: 5, attempts: 2 })
  })

  it('parses the run JSON columns defensively', async () => {
    await setup()
    const run = reader.run(ids.runId)
    expect(run).not.toBeNull()
    expect(run!.riskClass).toBe('high')
    expect(run!.objective).toBe('alpha objective')
    expect((run!.contract as Record<string, unknown>).objective).toBe('alpha objective')
    const refinement = (run!.contract as Record<string, Record<string, unknown>>).refinement
    expect(refinement.requirements_path).toBe('requirements.md')
    expect(run!.plan).toBeNull()
    expect((run!.budget as Record<string, unknown>).max_attempts_per_task).toBe(3)
    expect(run!.hasReceipt).toBe(false)
  })

  it('returns null contract/plan for malformed JSON instead of throwing', async () => {
    await setup()
    const raw = new Database(project.layout.ledgerPath)
    raw.run(`UPDATE runs SET contract_json = 'not-json', plan_json = '{' WHERE id = ?`, [ids.runId])
    raw.run(`UPDATE work_items SET dependency_json = 'also-not-json' WHERE id = ?`, [ids.taskIds.a])
    raw.close()

    const run = reader.run(ids.runId)
    expect(run).not.toBeNull()
    expect(run!.contract).toBeNull()
    expect(run!.plan).toBeNull()
    const tasks = reader.tasks(ids.runId)
    const taskA = tasks.find((task) => task.id === ids.taskIds.a)
    expect(taskA).not.toBeNull()
    expect(taskA!.dependencies).toEqual([])
  })

  it('parses task JSON columns and preserves ordering', async () => {
    await setup()
    const tasks = reader.tasks(ids.runId)
    expect(tasks.map((task) => task.id)).toEqual([
      ids.taskIds.a,
      ids.taskIds.b,
      ids.taskIds.ghost,
      ids.taskIds.cycleOne,
      ids.taskIds.cycleTwo,
    ])
    const taskB = tasks.find((task) => task.id === ids.taskIds.b)!
    expect(taskB.dependencies).toEqual([ids.taskIds.a])
    expect(taskB.writeScope).toEqual([`src/${ids.taskIds.b}/**`])
    expect(taskB.allowedPaths).toEqual(['src/**'])
    expect(taskB.acceptanceCriteria).toEqual(['criterion one', 'criterion two'])
    expect(taskB.verificationCommands).toEqual(['bun test'])
    expect(taskB.role).toBe('test-engineer')
    expect(taskB.modelSlot).toBe('testing')
    expect(taskB.attempts).toBe(0)
  })

  it('parses attempts, usage and cost', async () => {
    await setup()
    const attempts = reader.attempts(ids.runId)
    expect(attempts).toHaveLength(2)
    const a = attempts.find((attempt) => attempt.id === ids.attemptIds.a)!
    expect(a.state).toBe('completed')
    expect(a.exitCode).toBe(0)
    expect(a.usage).toEqual({ total_tokens: 1000 })
    expect(a.cost).toBeNull()
    expect(a.startedAt).toBe('2026-01-01 00:00:00')
    const b = attempts.find((attempt) => attempt.id === ids.attemptIds.b)!
    expect(b.state).toBe('failed')
    expect(b.failureClass).toBe('exit_nonzero')
    expect(b.exitCode).toBe(1)
    expect(b.usage).toBeNull()
  })

  it('reads the claimed lease and approvals', async () => {
    await setup()
    const leases = reader.leases(ids.runId)
    expect(leases).toHaveLength(5) // one lease row per work item
    const claimed = leases.find((lease) => lease.workItemId === ids.taskIds.a)!
    expect(claimed.owner).toBe('worker-1')
    expect(claimed.fencingToken).toBe(1)
    expect(claimed.releasedAt).toBeNull()

    const approvals = reader.approvals(ids.runId)
    expect(approvals).toHaveLength(1)
    expect(approvals[0]).toMatchObject({ gate: 'plan', decision: 'approved', actor: 'operator' })
  })

  it('reads verifications per run', async () => {
    await setup()
    const verifications = reader.verifications(ids.runId)
    expect(verifications).toHaveLength(2)
    const pass = verifications.find((verification) => verification.id === 'verify-a')!
    expect(pass.exitCode).toBe(0)
    expect(pass.outputHash).toBe('hash-pass')
    expect(pass.attemptId).toBe(ids.attemptIds.a)
    const fail = verifications.find((verification) => verification.id === 'verify-b')!
    expect(fail.exitCode).toBe(1)
  })

  it('reads run-level and attempt-linked findings, severity ordered', async () => {
    await setup()
    const findings = reader.findings(ids.runId)
    expect(findings.map((finding) => finding.id)).toEqual(['finding-run', 'finding-attempt'])
    expect(findings[0].blocking).toBe(true)
    expect(findings[1].blocking).toBe(false)
  })

  it('orders events by sequence and supports afterSequence and limit', async () => {
    await setup()
    const events = reader.events(ids.runId)
    expect(events).toHaveLength(4)
    expect(events.map((event) => event.sequence)).toEqual(ids.eventSequences)
    const after = reader.events(ids.runId, ids.eventSequences[1])
    expect(after).toHaveLength(2)
    expect(after[0].sequence).toBe(ids.eventSequences[2])
    const limited = reader.events(ids.runId, 0, 1)
    expect(limited).toHaveLength(1)
    expect(limited[0].type).toBe('run_created')
    expect(reader.eventCount(ids.runId)).toBe(4)
    const refinement = reader.eventsOfType(ids.runId, ['refinement_requested', 'refinement_completed'])
    expect(refinement.map((event) => event.type)).toEqual([
      'refinement_requested',
      'refinement_completed',
    ])
    expect(refinement[0].payload).toEqual({ question: 'Which runtime?', answer: '2.2.4' })
  })

  it('exposes cost rows with parsed usage and null when absent', async () => {
    await setup()
    const rows = reader.costRows(ids.runId)
    expect(rows).toHaveLength(2)
    const a = rows.find((row) => row.attemptId === ids.attemptIds.a)!
    expect(a.usage).toEqual({ total_tokens: 1000 })
    expect(a.cost).toBeNull()
    const b = rows.find((row) => row.attemptId === ids.attemptIds.b)!
    expect(b.usage).toBeNull()
  })

  it('paginates newest-first over (updated_at, id) without duplicates', async () => {
    await setup()
    const first = reader.runs({ limit: 1 })
    expect(first.runs).toHaveLength(1)
    expect(first.runs[0].id).toBe(ids.otherRunId)
    expect(first.nextCursor).not.toBeNull()

    const second = reader.runs({ limit: 1, cursor: first.nextCursor })
    expect(second.runs).toHaveLength(1)
    expect(second.runs[0].id).toBe(ids.runId)
    expect(second.nextCursor).toBeNull()

    const all = reader.runs()
    expect(all.runs.map((run) => run.id)).toEqual([ids.otherRunId, ids.runId])
    expect(all.runs[0].taskCount).toBe(0)
    expect(all.runs[1].taskCount).toBe(5)
    expect(all.runs[1].counts).toEqual({ pending: 5 })
  })

  it('filters runs by state', async () => {
    await setup()
    const completed = reader.runs({ states: ['completed'] })
    expect(completed.runs.map((run) => run.id)).toEqual([ids.otherRunId])
    const intake = reader.runs({ states: ['intake'] })
    expect(intake.runs.map((run) => run.id)).toEqual([ids.runId])
  })

  it('breaks updated_at ties by id and starts over on a malformed cursor', async () => {
    await setup()
    const raw = new Database(project.layout.ledgerPath)
    raw.run(`UPDATE runs SET updated_at = '2026-01-01 00:00:00'`)
    raw.close()

    const page = reader.runs({ limit: 1 })
    expect(page.runs[0].id).toBe(ids.otherRunId) // run-beta > run-alpha
    const next = reader.runs({ limit: 1, cursor: page.nextCursor })
    expect(next.runs[0].id).toBe(ids.runId)
    expect(reader.runs({ cursor: 'not-a-cursor' }).runs).toHaveLength(2)
  })

  it('encodes and decodes the cursor round-trip', () => {
    const cursor = encodeRunCursor('2026-01-01 00:00:00', 'run-a')
    expect(decodeRunCursor(cursor)).toEqual({ updatedAt: '2026-01-01 00:00:00', id: 'run-a' })
    expect(decodeRunCursor('')).toBeNull()
    expect(decodeRunCursor('%%%')).toBeNull()
    expect(decodeRunCursor(Buffer.from('{"v":1}').toString('base64url'))).toBeNull()
  })

  it('never writes the database during reads', async () => {
    await setup()
    const path = project.layout.ledgerPath
    const hash = () => createHash('sha256').update(readFileSync(path)).digest('hex')
    const before = hash()
    const beforeSize = statSync(path).size
    const beforeFiles = readdirSync(project.root).sort()

    reader.counts()
    reader.runs({ limit: 10 })
    reader.run(ids.runId)
    reader.tasks(ids.runId)
    reader.attempts(ids.runId)
    reader.leases(ids.runId)
    reader.approvals(ids.runId)
    reader.verifications(ids.runId)
    reader.findings(ids.runId)
    reader.events(ids.runId)
    reader.costRows(ids.runId)
    reader.eventCount(ids.runId)

    expect(hash()).toBe(before)
    expect(statSync(path).size).toBe(beforeSize)
    expect(readdirSync(project.root).sort()).toEqual(beforeFiles)
  })
})

describe('LedgerReader — JSON helpers', () => {
  it('parseJsonValue / parseStringArray / parseJsonObject are defensive', () => {
    expect(parseJsonValue('{"a":1}')).toEqual({ a: 1 })
    expect(parseJsonValue('[')).toBeNull()
    expect(parseJsonValue('')).toBeNull()
    expect(parseJsonValue(null)).toBeNull()
    expect(parseStringArray('["a",1,"b"]')).toEqual(['a', 'b'])
    expect(parseStringArray('{"a":1}')).toEqual([])
    expect(parseStringArray('nope')).toEqual([])
    expect(parseJsonObject('{"a":1}')).toEqual({ a: 1 })
    expect(parseJsonObject('[1]')).toBeNull()
    expect(parseJsonObject('null')).toBeNull()
  })
})
