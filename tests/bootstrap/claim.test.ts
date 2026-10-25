// P4-B: claim_task refuses a mutating task in a folder with no repository,
// before any lease/attempt write; a read-only task still claims normally.
import { afterAll, describe, expect, it } from 'bun:test'
import { rmSync } from 'node:fs'
import { SqliteLedger } from '../../src/ledger/sqlite'
import { NO_GIT_REPO_HINT } from '../../src/plugin'
import {
  executeNamed,
  makeDir,
  registerFor,
  toolResult,
} from './support'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

function tracked(root: string): string {
  roots.push(root)
  return root
}

async function seedTask(
  projectRoot: string,
  ledgerPath: string,
  role: string,
): Promise<void> {
  const ledger = new SqliteLedger(ledgerPath)
  try {
    await ledger.createRun({
      id: 'run-p4',
      parentId: null,
      repoId: projectRoot,
      requestHash: 'hash',
      dataClass: 'internal',
      policyProfile: 'assisted',
      operationMode: 'assisted',
      riskClass: 'low',
      requestText: 'P4 non-git claim',
      budgetJson: '{}',
      deadlineAt: null,
    })
    await ledger.createWorkItem({
      id: 'wi-p4-claim',
      runId: 'run-p4',
      issueKey: '',
      title: 'P4 non-git claim',
      dependencyJson: '[]',
      ownerRole: role,
      modelSlot: 'implementation',
      priority: 0,
      writeScopeJson: '[]',
      contractJson: '{}',
      allowedPathsJson: '[]',
      readPathsJson: '[]',
      acceptanceCriteriaJson: '["ok"]',
      verificationCommandsJson: '[]',
    })
  } finally {
    ledger.close()
  }
}

function claimArgs(): Record<string, string> {
  return {
    run_id: 'run-p4',
    task_id: 'wi-p4-claim',
    lease_owner: 'conductor-p4',
    model_id: 'test-model',
    base_sha: 'deadbeef',
  }
}

describe('supervisor_claim_task — non-git contract', () => {
  it('refuses a mutating role before creating a lease', async () => {
    const root = tracked(makeDir('claim-non-git'))
    const { definitions, ledgerPath } = registerFor(root)
    await seedTask(root, ledgerPath, 'coder')

    const out = toolResult(
      await executeNamed(definitions, 'supervisor_claim_task', claimArgs()),
    )

    expect(out).toEqual({
      claimed: false,
      code: 'no_git_repo',
      hint: NO_GIT_REPO_HINT,
    })

    const ledger = new SqliteLedger(ledgerPath)
    try {
      const item = await ledger.getWorkItem('wi-p4-claim')
      expect(item?.attempts).toBe(0)
      expect(item?.state).toBe('pending')
    } finally {
      ledger.close()
    }
  })

  it('still claims a read-only role in a non-git folder', async () => {
    const root = tracked(makeDir('claim-non-git-readonly'))
    const { definitions, ledgerPath } = registerFor(root)
    await seedTask(root, ledgerPath, 'critic')

    const out = toolResult(
      await executeNamed(definitions, 'supervisor_claim_task', claimArgs()),
    )

    expect(out.claimed).toBe(true)
    expect(typeof out.attempt_id).toBe('string')

    const ledger = new SqliteLedger(ledgerPath)
    try {
      const item = await ledger.getWorkItem('wi-p4-claim')
      expect(item?.attempts).toBe(1)
      expect(item?.state).toBe('running')
    } finally {
      ledger.close()
    }
  })
})
