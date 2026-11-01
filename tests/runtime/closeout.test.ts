import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { persistCuratorProposal, recordMemoryDecision, validateMemoryDecision } from '../../src/runtime/closeout'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'conductor-closeout-'))); roots.push(root)
  const run = join(root, 'runs', 'run-good'); const memory = join(root, 'memory')
  mkdirSync(join(run, 'artifacts'), { recursive: true }); writeFileSync(join(run, 'artifacts', 'result.txt'), 'verified output')
  return { root, run, memory }
}

test('memory decision requires explicit bounded decision and nonblank rationale', () => {
  expect(validateMemoryDecision(null)).toBeNull()
  expect(validateMemoryDecision({ decision: 'later', rationale: 'x' })).toBeNull()
  expect(validateMemoryDecision({ decision: 'none', rationale: '  ' })).toBeNull()
  expect(validateMemoryDecision({ decision: 'none', rationale: 'x'.repeat(1001) })).toBeNull()
  expect(validateMemoryDecision({ decision: 'none', rationale: 'no reusable lesson' })).toEqual({ decision: 'none', rationale: 'no reusable lesson' })
})

test('decision recording is immutable, idempotent for same choice, and detects conflict', () => {
  const { run } = fixture(); const none = { decision: 'none', rationale: 'No reusable lesson' }
  expect(recordMemoryDecision(run, 'run-good', none)).toEqual({ ok: true, handoff: false })
  expect(JSON.parse(readFileSync(join(run, 'memory-decision.json'), 'utf8')).decision).toBe('none')
  expect(recordMemoryDecision(run, 'run-good', none)).toEqual({ ok: true, handoff: false })
  expect(recordMemoryDecision(run, 'run-good', { decision: 'disabled', rationale: 'Disabled by config' })).toEqual({ ok: false, error: 'memory_decision_conflict' })
  expect(JSON.parse(readFileSync(join(run, 'memory-decision.json'), 'utf8')).decision).toBe('none')
})

test('curate decision returns handoff; proposal persists as proposed before receipt and repeats idempotently', () => {
  const { root, run, memory } = fixture(); const proposal = { label: 'lesson', content: 'Check fixture state before closeout.', source_artifacts: ['artifacts/result.txt'] }
  expect(recordMemoryDecision(run, 'run-good', { decision: 'curate', rationale: 'Evidence supports a reusable lesson' })).toEqual({ ok: true, handoff: true })
  const first = persistCuratorProposal(memory, run, 'run-good', proposal)
  expect(first.ok).toBe(true)
  const stored = JSON.parse(readFileSync(first.path!, 'utf8'))
  expect(stored).toMatchObject({ label: 'lesson', scope: 'project', version: 1, source_run_id: 'run-good', source_artifacts: proposal.source_artifacts, status: 'proposed', actor: 'memory-curator', content: proposal.content })
  expect(stored.content_hash).toMatch(/^sha256:[a-f0-9]{64}$/)
  expect(persistCuratorProposal(memory, run, 'run-good', proposal)).toEqual(first)
  expect(persistCuratorProposal(memory, run, 'run-good', { ...proposal, content: 'different lesson' })).toEqual({ ok: false, error: 'proposal_conflict' })
  const nextRun = join(root, 'runs', 'run-next'); mkdirSync(join(nextRun, 'artifacts'), { recursive: true }); writeFileSync(join(nextRun, 'artifacts', 'result.txt'), 'new evidence')
  expect(persistCuratorProposal(memory, nextRun, 'run-next', { ...proposal, expected_version: 0 })).toMatchObject({ ok: false, error: 'memory_version_conflict', current_version: 1 })
  const next = persistCuratorProposal(memory, nextRun, 'run-next', { ...proposal, content: 'Check fixture state before release.', expected_version: 1 })
  expect(next.ok).toBe(true)
  expect(JSON.parse(readFileSync(next.path!, 'utf8')).version).toBe(2)
  expect(JSON.parse(readFileSync(first.path!, 'utf8')).status).toBe('proposed')
})

test('refuses missing, escaping and symlinked evidence, unsafe run ids, and sensitive content', () => {
  const { root, run, memory } = fixture(); const base = { label: 'lesson', content: 'Safe general lesson', source_artifacts: ['artifacts/result.txt'] }
  expect(persistCuratorProposal(memory, run, 'run-good', { ...base, source_artifacts: ['artifacts/missing.txt'] })).toMatchObject({ ok: false, error: 'source_not_found' })
  expect(persistCuratorProposal(memory, run, 'run-good', { ...base, source_artifacts: ['artifacts/../outside'] })).toMatchObject({ ok: false, error: 'unsafe_source_path' })
  expect(persistCuratorProposal(memory, run, '../outside', base)).toMatchObject({ ok: false, error: 'memory_path_escape' })
  expect(persistCuratorProposal(memory, run, 'run-good', { ...base, content: 'Contact person@example.com' })).toMatchObject({ ok: false, error: 'sensitive_content_refused' })
  expect(persistCuratorProposal(memory, run, 'run-good', { ...base, content: 'Use token: ghp_12345678901234567890' })).toMatchObject({ ok: false, error: 'sensitive_content_refused' })
  const outside = join(root, 'outside.txt'); writeFileSync(outside, 'outside'); symlinkSync(outside, join(run, 'artifacts', 'linked.txt'))
  expect(persistCuratorProposal(memory, run, 'run-good', { ...base, source_artifacts: ['artifacts/linked.txt'] })).toMatchObject({ ok: false, error: 'source_outside_run' })
  const linkedMemory = join(root, 'linked-memory'); symlinkSync(join(root, 'memory-target'), linkedMemory)
  expect(() => recordMemoryDecision(linkedMemory, 'run-good', { decision: 'none', rationale: 'Safe' })).toThrow('symlink_path_refused')
})

test('proposal validation rejects unbounded and malformed inputs without writing', () => {
  const { run, memory } = fixture()
  expect(persistCuratorProposal(memory, run, 'run-good', { label: '../bad', content: 'lesson', source_artifacts: ['artifacts/result.txt'] })).toMatchObject({ ok: false, error: 'invalid_or_unbounded_proposal' })
  expect(persistCuratorProposal(memory, run, 'run-good', { label: 'lesson', content: 'x'.repeat(5001), source_artifacts: ['artifacts/result.txt'] })).toMatchObject({ ok: false, error: 'invalid_or_unbounded_proposal' })
  expect(persistCuratorProposal(memory, run, 'run-good', { label: 'lesson', content: 'lesson', source_artifacts: [] })).toMatchObject({ ok: false, error: 'invalid_or_unbounded_proposal' })
})
