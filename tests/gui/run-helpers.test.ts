import { describe, expect, test } from 'bun:test'
import type { RunSummary } from '../../src/rpc-contract'
import { filterRuns, isActiveRun, mergeRuns, taskAttention } from '../../src/gui/run-helpers'
const run = (id: string, state: string, updatedAt = id): RunSummary => ({ id, state, updatedAt, createdAt: updatedAt, objective: `Objective ${id}`, riskClass: 'low', operationMode: 'assisted', taskCount: 0, counts: {}, hasReceipt: false })
describe('run list helpers', () => {
  test('active and terminal states match ledger semantics', () => {
    expect(isActiveRun(run('a', 'awaiting_refinement'))).toBe(true)
    for (const state of ['completed', 'cancelled', 'blocked', 'timed_out', 'failed']) expect(isActiveRun(run('a', state))).toBe(false)
  })
  test('pages deduplicate by id while newest data wins', () => {
    expect(mergeRuns([run('a', 'running')], [run('a', 'failed'), run('b', 'completed')]).map(r => [r.id, r.state])).toEqual([['a', 'running'], ['b', 'completed']])
  })
  test('attention shows recorded task states', () => {
    expect(taskAttention({ ...run('a', 'running'), counts: { failed: 2, running: 1, ready: 0 } })).toBe('2 failed, 1 running')
    expect(taskAttention(run('a', 'running'))).toBe('No recorded task activity')
    expect(taskAttention(run('a', 'awaiting_refinement'))).toBe('Waiting for user input')
  })
  test('filters and sorts loaded rows only', () => {
    const rows = [run('b', 'running'), run('a', 'running'), run('c', 'completed')]
    expect(filterRuns(rows, true, '', 'oldest').map(r => r.id)).toEqual(['a', 'b'])
    expect(filterRuns(rows, false, 'OBJECTIVE C', 'newest').map(r => r.id)).toEqual(['c'])
    expect(rows.map(r => r.id)).toEqual(['b', 'a', 'c'])
  })
})
