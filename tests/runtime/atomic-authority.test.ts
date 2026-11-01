import { describe, expect, test } from 'bun:test'
import { SqliteLedger } from '../../src/ledger/sqlite'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

async function fixture(path = ':memory:') {
  const ledger = new SqliteLedger(path)
  await ledger.createRun({ id: 'r', parentId: null, repoId: 'repo', requestHash: 'h', dataClass: 'internal', policyProfile: 'assisted', operationMode: 'assisted', riskClass: 'low', requestText: '', budgetJson: '{}', deadlineAt: null })
  const task = async (id: string, deps: string[] = [], scope: string[] = []) => {
    await ledger.createWorkItem({ id, runId: 'r', issueKey: '', title: id, dependencyJson: JSON.stringify(deps), ownerRole: 'coder', modelSlot: 'implementation', priority: 0, writeScopeJson: JSON.stringify(scope), contractJson: '{}', allowedPathsJson: '[]', readPathsJson: '[]', acceptanceCriteriaJson: '[]', verificationCommandsJson: '["true"]' })
    await ledger.transitionWorkItemState(id, 'ready')
  }
  const claim = (id: string, attemptId = `a-${id}`) => ledger.claimTaskAtomic({ runId: 'r', workItemId: id, leaseOwner: 'worker', leaseExpiresAt: new Date(Date.now()+60000).toISOString(), attempt: { id: attemptId, workItemId: id, harness: 'test', modelProvider: 'test', modelId: 'test', modelVariant: null, workspaceId: null, baseSha: 'abc' } })
  return { ledger, task, claim }
}

describe('transactional task authority', () => {
  test('missing and incomplete dependencies fail closed', async () => {
    const { ledger, task, claim } = await fixture()
    await task('b', ['a'])
    expect((await claim('b')).claimed).toBe(false)
    await task('a')
    expect((await claim('b')).claimed).toBe(false)
    expect((await ledger.getWorkItem('b'))?.attempts).toBe(0)
    ledger.close()
  })
  test('pending read-only compatibility does not bypass dependency admission', async () => {
    const { ledger, task, claim } = await fixture()
    await task('dependency')
    await ledger.createWorkItem({ id: 'review', runId: 'r', issueKey: '', title: 'review', dependencyJson: '["dependency"]', ownerRole: 'critic', modelSlot: 'implementation', priority: 0, writeScopeJson: '[]', contractJson: '{}', allowedPathsJson: '[]', readPathsJson: '[]', acceptanceCriteriaJson: '[]', verificationCommandsJson: '[]' })
    expect((await claim('review')).claimed).toBe(false)
    expect((await ledger.getWorkItem('review'))?.state).toBe('pending')
    await ledger.transitionWorkItemState('dependency', 'completed')
    expect((await claim('review')).claimed).toBe(true)
    ledger.close()
  })
  test('scope conflicts and stale completion cannot mutate state', async () => {
    const { ledger, task, claim } = await fixture()
    await task('a', [], ['src/shared']); await task('b', [], ['src/shared/file.ts'])
    const first = await claim('a')
    expect(first.claimed).toBe(true)
    expect((await claim('b')).claimed).toBe(false)
    const finish = { runId: 'r', workItemId: 'a', attemptId: 'a-a', fencingToken: first.fencingToken + 1, success: true, exitCode: 0, failureClass: null, usageJson: null, evidenceJson: '{}' }
    expect(await ledger.finishTaskAtomic(finish)).toBe(false)
    expect((await ledger.getWorkItem('a'))?.state).toBe('running')
    expect(await ledger.finishTaskAtomic({ ...finish, fencingToken: first.fencingToken })).toBe(true)
    expect(await ledger.finishTaskAtomic({ ...finish, fencingToken: first.fencingToken })).toBe(false)
    ledger.close()
  })
  test('parked runs and expired leases cannot be used as authority', async () => {
    const { ledger, task, claim } = await fixture()
    await task('a')
    await ledger.transitionRunState('r', 'intake')
    await ledger.transitionRunState('r', 'paused')
    expect((await claim('a')).claimed).toBe(false)
    expect((await ledger.getWorkItem('a'))?.attempts).toBe(0)
    ledger.close()
  })
  test('policy and plan changes invalidate previously claimed success', async () => {
    for (const change of ['policy', 'plan'] as const) {
      const { ledger, task, claim } = await fixture()
      await task('a')
      const admitted = await claim('a')
      expect(admitted.claimed).toBe(true)
      if (change === 'policy') await ledger.updateRunContract('r', '{"changed":true}')
      else await task('sibling')
      expect(await ledger.finishTaskAtomic({ runId: 'r', workItemId: 'a', attemptId: 'a-a', fencingToken: admitted.fencingToken, success: true, exitCode: 0, failureClass: null, usageJson: null, evidenceJson: '{}' })).toBe(false)
      expect((await ledger.getWorkItem('a'))?.state).toBe('failed')
      expect((await ledger.getAttempt('a-a'))?.failure_class).toBe('plan_or_policy_invalidated')
      expect((await ledger.getLease('a'))?.released_at).not.toBeNull()
      await ledger.transitionWorkItemState('a', 'ready')
      const retry = await claim('a', 'retry-a')
      expect(retry.claimed).toBe(true)
      expect(retry.fencingToken).toBeGreaterThan(admitted.fencingToken)
      // A foreign stale completion cannot change the newer attempt.
      expect(await ledger.finishTaskAtomic({ runId: 'r', workItemId: 'a', attemptId: 'a-a', fencingToken: admitted.fencingToken, success: true, exitCode: 0, failureClass: null, usageJson: null, evidenceJson: '{}' })).toBe(false)
      expect((await ledger.getWorkItem('a'))?.state).toBe('running')
      ledger.close()
    }
  })
  test('workflow hash changes and unsnapshotted graph changes invalidate success', async () => {
    for (const change of ['policy', 'graph', 'legacy-attempt'] as const) {
      const root = mkdtempSync(join(tmpdir(), 'conductor-binding-'))
      const path = join(root, 'ledger.db')
      const { ledger, task, claim } = await fixture(path)
      const db = new Database(path)
      try {
        await task('a')
        db.run("UPDATE runs SET effective_workflow_hash = 'policy-one' WHERE id = 'r'")
        const admitted = await claim('a')
        expect(admitted.claimed).toBe(true)
        if (change === 'policy') db.run("UPDATE runs SET effective_workflow_hash = 'policy-two' WHERE id = 'r'")
        else if (change === 'graph') db.run("UPDATE work_items SET title = 'changed outside revision' WHERE id = 'a'")
        else db.run("UPDATE attempts SET policy_identity = NULL WHERE id = 'a-a'")
        expect(await ledger.finishTaskAtomic({ runId: 'r', workItemId: 'a', attemptId: 'a-a', fencingToken: admitted.fencingToken, success: true, exitCode: 0, failureClass: null, usageJson: null, evidenceJson: '{}' })).toBe(false)
      } finally { db.close(); ledger.close(); rmSync(root, { recursive: true, force: true }) }
    }
  })
  test('rejects traversal scope even when no other lease exists', async () => {
    const { ledger, task, claim } = await fixture()
    await task('a', [], ['src/a/../b'])
    expect((await claim('a')).claimed).toBe(false)
    ledger.close()
  })
  test('plan history is additive with compare-and-swap', async () => {
    const { ledger, task } = await fixture()
    await task('a'); await task('b', ['a'])
    const history = await ledger.listPlanRevisions('r')
    expect(history.map(r => r.revision)).toEqual([1, 2])
    expect(JSON.parse(history[0]!.graph_json)).toHaveLength(1)
    expect(await ledger.snapshotPlanCAS('r', 1, 'stale')).toBe(false)
    expect(await ledger.snapshotPlanCAS('r', 2, 'reviewed graph')).toBe(true)
    ledger.close()
  })
})
