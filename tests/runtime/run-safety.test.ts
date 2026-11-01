import { describe, expect, it } from 'bun:test'
import { decideCandidateMerge, decideTaskAdmission, decideTaskCompletion, validateTaskGraph, type SafetyTask } from '../../src/runtime/run-safety'

const task = (id: string, state = 'ready', dependencies: string[] = []): SafetyTask => ({ id, state, dependencies })
describe('run safety decisions', () => {
  it('fails closed on dangling graph ids, duplicate ids, cycles, and unknown state', () => {
    expect(validateTaskGraph([task('a', 'ready', ['missing'])]).allowed).toBe(false)
    expect(validateTaskGraph([task('a', 'ready', ['b']), task('b', 'ready', ['a'])]).reasons.some((r) => r.code === 'dependency_cycle')).toBe(true)
    expect(validateTaskGraph([task('a'), task('a')]).allowed).toBe(false)
    expect(decideTaskAdmission({ tasks: [task('a', 'mystery')], taskId: 'a' }).allowed).toBe(false)
  })
  it('handles a deep graph iteratively', () => {
    const nodes = Array.from({ length: 1000 }, (_, i) => task(`t${i}`, 'completed', i ? [`t${i - 1}`] : []))
    expect(validateTaskGraph(nodes).allowed).toBe(true)
  })
  it('admits only ready tasks with completed dependencies and current revision', () => {
    const tasks = [task('a', 'completed'), task('b', 'ready', ['a'])]
    expect(decideTaskAdmission({ tasks, taskId: 'b', currentRevision: 'rev1', expectedRevision: 'rev1' }).allowed).toBe(true)
    expect(decideTaskAdmission({ tasks, taskId: 'b', currentRevision: 'rev2', expectedRevision: 'rev1' }).allowed).toBe(false)
    expect(decideTaskAdmission({ tasks: [task('b', 'ready', ['x'])], taskId: 'b' }).allowed).toBe(false)
  })
  it('requires current attempt/fence and every exact successful verification', () => {
    const base = { taskId: 'a', currentAttemptId: 'att2', currentFencingToken: 8, attemptId: 'att2', fencingToken: 8, attemptState: 'completed', exitCode: 0, requiredCommands: ['bun test', 'bun run build'], verificationResults: [{ command: 'bun test', exitCode: 0, attemptId: 'att2', fencingToken: 8 }] }
    expect(decideTaskCompletion(base).allowed).toBe(false)
    expect(decideTaskCompletion({ ...base, attemptId: 'att1', verificationResults: [] }).reasons.some((r) => r.code === 'stale_attempt')).toBe(true)
    expect(decideTaskCompletion({ ...base, fencingToken: 7 }).reasons.some((r) => r.code === 'stale_fencing_token')).toBe(true)
  })
  it('rejects unavailable candidates, empty plans, failed evidence, blocking findings, and unbound/expired approval', () => {
    const base = { tasks: [task('a', 'completed')], candidateSha: 'sha', planRevision: 'rev', policyHash: 'policy', approval: { candidateSha: 'sha', planRevision: 'rev', policyHash: 'policy', expiresAt: '2030-01-01T00:00:00Z', decision: 'approved', gate: 'merge' }, now: Date.parse('2029-01-01'), requiredEvidenceValid: true, blockingFindings: [], candidateAvailable: true }
    expect(decideCandidateMerge(base).allowed).toBe(true)
    expect(decideCandidateMerge({ ...base, candidateAvailable: false }).allowed).toBe(false)
    expect(decideCandidateMerge({ ...base, tasks: [] }).allowed).toBe(false)
    expect(decideCandidateMerge({ ...base, requiredEvidenceValid: false }).allowed).toBe(false)
    expect(decideCandidateMerge({ ...base, blockingFindings: [{ blocking: true }] }).allowed).toBe(false)
    expect(decideCandidateMerge({ ...base, approval: { decision: 'approved' } }).reasons.some((r) => r.code === 'legacy_unbound_approval')).toBe(true)
    expect(decideCandidateMerge({ ...base, approval: { ...base.approval, expiresAt: '2028-01-01T00:00:00Z' } }).allowed).toBe(false)
  })
})
