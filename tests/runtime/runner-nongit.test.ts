import { test, expect } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Runner } from '../../src/runner'
import { SqliteLedger } from '../../src/ledger/sqlite'
import type { IAgentAdapter } from '../../src/adapters/opencode-cli'

test('runner executes a read-only task in a non-git fixture directory', async () => {
  const root = mkdtempSync(join(tmpdir(), 'conductor-nongit-runner-'))
  mkdirSync(join(root, '.opencode'))
  const adapter = {
    start: async () => 'session',
    streamEvents: async () => ({ sessionId: 'session', exitCode: 0, stdout: '', stderr: '', durationMs: 1, usage: null, artifacts: [], success: true }),
    stop: async () => {},
  } as unknown as IAgentAdapter
  const ledger = new SqliteLedger(join(root, '.opencode/supervisor.db'))
  try {
    await ledger.createRun({ id: 'run-nongit', parentId: null, repoId: root, requestHash: 'h', dataClass: 'internal', policyProfile: 'assisted', operationMode: 'assisted', riskClass: 'low', requestText: '', budgetJson: JSON.stringify({ max_task_wall_time_ms: 60000 }), deadlineAt: null })
    await ledger.createWorkItem({ id: 'wi-nongit', runId: 'run-nongit', issueKey: '', title: 'inspect', dependencyJson: '[]', ownerRole: 'critic', modelSlot: 'review', priority: 0, writeScopeJson: '[]', contractJson: '{}', allowedPathsJson: '[]', readPathsJson: '[]', acceptanceCriteriaJson: '[]', verificationCommandsJson: '[]' })
    await ledger.transitionWorkItemState('wi-nongit', 'ready')
    const runner = new Runner({ repoRoot: root, mainRepoPath: root, worktreeBasePath: join(root, 'worktrees'), adapter })
    const result = await runner.executeTask('wi-nongit')
    expect(result).toEqual({ success: true })
    expect((await ledger.getWorkItem('wi-nongit'))?.state).toBe('completed')
  } finally { ledger.close(); rmSync(root, { recursive: true, force: true }) }
})
