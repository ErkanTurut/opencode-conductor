import { describe, expect, it } from 'bun:test'
import { canonicalHash } from '../../src/runtime/run-safety'
import { createPlanRevision, decideRepair, repairExecutionClass } from '../../src/runtime/plan-revisions'

describe('plan revisions', () => {
  it('hashes object keys deterministically and material changes distinctly', () => {
    expect(canonicalHash({ b: 2, a: 1 })).toBe(canonicalHash({ a: 1, b: 2 }))
    expect(canonicalHash({ a: 1 })).not.toBe(canonicalHash({ a: 2 }))
    const input = { tasks: [{ id: 'a', state: 'ready', dependencies: [] as string[], writeScope: ['src'] }], parent: null, expectedParentRevision: null, reason: 'initial' }
    expect(createPlanRevision(input).snapshot?.revision).toBe(createPlanRevision(input).snapshot?.revision)
    expect(createPlanRevision({ ...input, reason: 'changed' }).snapshot?.revision).not.toBe(createPlanRevision(input).snapshot?.revision)
  })
  it('rejects stale parent CAS, dangling graph nodes, and overlapping active task scope', () => {
    const base = { tasks: [{ id: 'a', state: 'ready', dependencies: [], writeScope: ['src'] }], parent: null, reason: 'edit' }
    expect(createPlanRevision({ ...base, expectedParentRevision: 'old' }).allowed).toBe(false)
    const overlap = { tasks: [{ id: 'a', state: 'ready', dependencies: [], writeScope: ['src'] }, { id: 'b', state: 'ready', dependencies: [], writeScope: ['src/ui'] }], parent: null, expectedParentRevision: null, reason: 'edit' }
    expect(createPlanRevision(overlap).reasons.some((r) => r.code === 'overlapping_active_scopes')).toBe(true)
    expect(createPlanRevision({ ...base, tasks: [{ id: 'a', state: 'ready', dependencies: ['missing'] }] , expectedParentRevision: null }).allowed).toBe(false)
  })
  it('distinguishes bounded retries from semantic repair requiring scope approval', () => {
    const budget = { repairsUsed: 0, maxRepairs: 2, retriesUsed: 0, maxRetriesPerTask: 1 }
    expect(decideRepair({ taskId: 'a', kind: 'retry', requestedScope: ['src'], existingScope: ['src'] }, budget).allowed).toBe(true)
    expect(decideRepair({ taskId: 'a', kind: 'retry', requestedScope: ['test'], existingScope: ['src'] }, budget).allowed).toBe(false)
    expect(repairExecutionClass('retry')).toBe('lease-retry')
    const request = { taskId: 'a', kind: 'semantic-repair' as const, requestedScope: ['src', 'tests'], existingScope: ['src'] }
    expect(decideRepair(request, budget).reasons.some((r) => r.code === 'new_scope_approval_required')).toBe(true)
    const scopeHash = canonicalHash(['src', 'tests'])
    expect(decideRepair({ ...request, scopeApproval: { approved: true, taskId: 'a', scopeHash } }, budget).allowed).toBe(true)
    expect(decideRepair(request, { ...budget, repairsUsed: 2 }).allowed).toBe(false)
  })
})
