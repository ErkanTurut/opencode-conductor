import { test, expect } from 'bun:test'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SqliteLedger } from '../../src/ledger/sqlite'
import { executeNamed, makeGitRepo, registerFor, toolResult } from './support'

async function setup() {
  const root = makeGitRepo('workspace-binding', { 'safe.txt': 'base\n' })
  const { definitions, ledgerPath } = registerFor(root)
  const ledger = new SqliteLedger(ledgerPath)
  await ledger.createRun({ id: 'run', parentId: null, repoId: root, requestHash: 'h', dataClass: 'internal', policyProfile: 'assisted', operationMode: 'assisted', riskClass: 'low', requestText: '', budgetJson: '{}', deadlineAt: null })
  await ledger.createWorkItem({ id: 'wi-task', runId: 'run', issueKey: '', title: 'task', dependencyJson: '[]', ownerRole: 'coder', modelSlot: 'implementation', priority: 0, writeScopeJson: '["safe.txt"]', contractJson: '{}', allowedPathsJson: '["safe.txt"]', readPathsJson: '[]', acceptanceCriteriaJson: '[]', verificationCommandsJson: '["true"]' })
  await ledger.transitionWorkItemState('wi-task', 'ready')
  const workspace = toolResult(await executeNamed(definitions, 'supervisor_worktree', { action: 'create', task_id: 'wi-task' }))
  expect(workspace.path).toBeString()
  const claim = (extra: Record<string, unknown>) => executeNamed(definitions, 'supervisor_claim_task', { run_id: 'run', task_id: 'wi-task', lease_owner: 'test', model_id: 'model', base_sha: 'caller-supplied-fake-base', ...extra }).then(toolResult)
  return { root, ledger, workspace, claim }
}

test('claim ignores caller base and binds canonical workspace to server-observed HEAD', async () => {
  const { root, ledger, workspace, claim } = await setup()
  try {
    expect((await claim({ workspace_id: 'wt-someone-else' })).claimed).toBe(false)
    const result = await claim({ workspace_id: workspace.workspace_id })
    expect(result.claimed).toBe(true)
    const attempt = await ledger.getAttempt(result.attempt_id)
    expect(attempt?.workspace_id).toBe(workspace.workspace_id)
    expect(attempt?.base_sha).toBe(workspace.base_sha)
    expect(attempt?.base_sha).not.toBe('caller-supplied-fake-base')
  } finally { ledger.close(); rmSync(root, { recursive: true, force: true }) }
})

test('claim rejects a workspace containing a pre-claim commit even when supplied as base', async () => {
  const { root, ledger, workspace, claim } = await setup()
  try {
    writeFileSync(join(workspace.path, 'outside.txt'), 'unauthorized\n')
    const run = (...args: string[]) => {
      const p = Bun.spawnSync(['git', '-C', workspace.path, ...args], { stdout: 'pipe', stderr: 'pipe' })
      expect(p.exitCode).toBe(0)
      return p.stdout.toString().trim()
    }
    run('add', 'outside.txt')
    run('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'preclaim')
    const attackerSha = run('rev-parse', 'HEAD')
    const result = await claim({ workspace_id: workspace.workspace_id, base_sha: attackerSha })
    expect(result.claimed).toBe(false)
    expect((await ledger.getWorkItem('wi-task'))?.attempts).toBe(0)
  } finally { ledger.close(); rmSync(root, { recursive: true, force: true }) }
})
