import { describe, it, expect } from 'bun:test'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  collectEvidence,
  getArtifactPaths,
  hashContent,
  isMutatingRole,
  NoVerificationCommandsError,
  runVerification,
} from '../src/artifacts'
import { SqliteLedger } from '../src/ledger/sqlite'
import type { ILedger } from '../src/ledger/interface'

function fakeLedger(sink: Array<Record<string, unknown>>): ILedger {
  return {
    createVerification: async (params: Record<string, unknown>) => {
      sink.push(params)
      return params
    },
  } as unknown as ILedger
}

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'sup-artifacts-'))
}

describe('artifacts — getArtifactPaths unification', () => {
  it('exposes a verificationDir under the run artifacts dir', () => {
    const paths = getArtifactPaths('run-1', '/repo')
    expect(paths.artifactsDir).toBe('/repo/.opencode/runs/run-1/artifacts')
    expect(paths.verificationDir).toBe(
      '/repo/.opencode/runs/run-1/artifacts/verification',
    )
    // Additive: existing fields unchanged.
    expect(paths.discoveryDir).toBe(
      '/repo/.opencode/runs/run-1/artifacts/discovery',
    )
  })
})

describe('artifacts — empty verification commands', () => {
  it('runVerification throws NoVerificationCommandsError on empty input', async () => {
    const dir = tempDir()
    await expect(
      runVerification([], dir, 'att-empty', fakeLedger([]), dir),
    ).rejects.toBeInstanceOf(NoVerificationCommandsError)
  })

  it('runVerification still throws for an explicit MUTATING role', async () => {
    const dir = tempDir()
    for (const role of ['coder', 'test-engineer', 'integrator']) {
      await expect(
        runVerification([], dir, 'att-empty', fakeLedger([]), dir, undefined, role),
      ).rejects.toBeInstanceOf(NoVerificationCommandsError)
    }
  })

  it('runVerification returns [] (neutral skip) for a read-only role', async () => {
    const dir = tempDir()
    const verifications: Array<Record<string, unknown>> = []
    for (const role of ['scout', 'external-scout', 'critic', 'build-verifier']) {
      const results = await runVerification(
        [],
        dir,
        'att-empty',
        fakeLedger(verifications),
        dir,
        undefined,
        role,
      )
      expect(results).toEqual([])
    }
    // A neutral skip persists no verification rows.
    expect(verifications).toEqual([])
  })

  it('isMutatingRole follows the MUTATING_ROLES partition, absent role fails closed', () => {
    expect(isMutatingRole('coder')).toBe(true)
    expect(isMutatingRole('frontend-specialist')).toBe(true)
    expect(isMutatingRole('scout')).toBe(false)
    // Real read-only roles from READ_ONLY_ROLES are neutral.
    expect(isMutatingRole('critic')).toBe(false)
    expect(isMutatingRole('build-verifier')).toBe(false)
    // No role supplied: fail closed (legacy no-arg call keeps throwing).
    expect(isMutatingRole(undefined)).toBe(true)
    expect(isMutatingRole(null)).toBe(true)
    expect(isMutatingRole('')).toBe(true)
    // Non-member string is "not mutating" per the MUTATING_ROLES partition,
    // mirroring the scheduler, which only dispatches members of the two sets.
    expect(isMutatingRole('not-a-role')).toBe(false)
  })

  it('collectEvidence reports all_checks_passed=false for zero results', async () => {
    const evidence = await collectEvidence('att-empty', [])
    expect(evidence.all_checks_passed).toBe(false)
    expect(evidence.verification_skipped).toBe(false)
  })

  it('collectEvidence treats an empty profile as neutral for read-only roles', async () => {
    const scout = await collectEvidence('att-empty', [], 'scout')
    expect(scout.all_checks_passed).toBe(true)
    expect(scout.verification_skipped).toBe(true)

    // Mutating role (or unresolved role) keeps the fail-closed reading.
    const coder = await collectEvidence('att-empty', [], 'coder')
    expect(coder.all_checks_passed).toBe(false)
    expect(coder.verification_skipped).toBe(false)
  })

  it('collectEvidence still fails a read-only role when a command fails', async () => {
    const evidence = await collectEvidence(
      'att-s',
      [
        {
          command: 'a',
          exitCode: 1,
          durationMs: 1,
          stdoutHash: 'x',
          stdoutPath: null,
          stderrPath: null,
          passed: false,
        },
      ],
      'scout',
    )
    expect(evidence.all_checks_passed).toBe(false)
    expect(evidence.verification_skipped).toBe(false)
  })

  it('collectEvidence reports all_checks_passed=false when any check failed', async () => {
    const evidence = await collectEvidence('att-1', [
      {
        command: 'a',
        exitCode: 0,
        durationMs: 1,
        stdoutHash: 'x',
        stdoutPath: null,
        stderrPath: null,
        passed: true,
      },
      {
        command: 'b',
        exitCode: 1,
        durationMs: 1,
        stdoutHash: 'y',
        stdoutPath: null,
        stderrPath: null,
        passed: false,
      },
    ])
    expect(evidence.all_checks_passed).toBe(false)
  })
})

describe('artifacts — stdout-only hash', () => {
  it('hashes stdout only and never folds stderr into the hash', async () => {
    const dir = tempDir()
    const verifications: Array<Record<string, unknown>> = []
    const command = 'printf "out"; printf "err" 1>&2'

    const results = await runVerification(
      [command],
      process.cwd(),
      'att-hash',
      fakeLedger(verifications),
      dir,
    )

    expect(results.length).toBe(1)
    expect(results[0].stdoutHash).toBe(hashContent('out'))
    expect(results[0].stdoutHash).not.toBe(hashContent('out\nerr'))

    // The persisted id and output hash agree with the stdout-only convention.
    expect(verifications[0].outputHash).toBe(hashContent('out'))
    expect(verifications[0].id).toBe(
      `att-hash-verify-${hashContent(command)}`,
    )
  })
})

describe('artifacts — verification id is command-keyed and re-runnable', () => {
  async function seedAttempt(ledger: SqliteLedger): Promise<void> {
    await ledger.createRun({
      id: 'run-v',
      parentId: null,
      repoId: '/test',
      requestHash: 'v',
      dataClass: 'internal',
      policyProfile: 'assisted',
      operationMode: 'assisted',
      riskClass: 'low',
      requestText: 'verification idempotency',
      budgetJson: '{}',
      deadlineAt: null,
    })
    await ledger.createWorkItem({
      id: 'wi-v',
      runId: 'run-v',
      issueKey: '',
      title: 'v',
      dependencyJson: '[]',
      ownerRole: 'coder',
      modelSlot: 'implementation',
      priority: 0,
      writeScopeJson: '["src/**"]',
      contractJson: '{}',
      allowedPathsJson: '[]',
      readPathsJson: '[]',
      acceptanceCriteriaJson: '[]',
      verificationCommandsJson: '["true"]',
    })
    await ledger.createAttempt({
      id: 'att-v',
      workItemId: 'wi-v',
      attemptNo: 1,
      harness: 'test',
      modelProvider: 'test',
      modelId: 'test',
      modelVariant: null,
      workspaceId: null,
      baseSha: 'sha',
    })
  }

  it('upserts on the command-keyed id when runner and plugin both verify the attempt', async () => {
    const dir = tempDir()
    const ledger = new SqliteLedger(join(dir, 'supervisor.db'))
    try {
      await seedAttempt(ledger)
      const command = 'printf "ok"'

      // First pass = the runner's executeTask.
      const first = await runVerification(
        [command],
        process.cwd(),
        'att-v',
        ledger,
        dir,
      )
      // Second pass = the plugin's record_evidence re-run: must NOT throw on
      // the `id` PRIMARY KEY (the HIGH finding), and must collapse to one row.
      const second = await runVerification(
        [command],
        process.cwd(),
        'att-v',
        ledger,
        dir,
      )

      expect(first[0].stdoutHash).toBe(hashContent('ok'))
      expect(second.length).toBe(1)

      const rows = await ledger.getVerifications('att-v')
      expect(rows.length).toBe(1)
      expect(rows[0].id).toBe(`att-v-verify-${hashContent(command)}`)
      // Id keys on the command hash, not the (varying) stdout hash.
      expect(rows[0].output_hash).toBe(hashContent('ok'))
    } finally {
      ledger.close()
    }
  })

  it('bounds a command with the per-command timeout and fails closed', async () => {
    const dir = tempDir()
    const verifications: Array<Record<string, unknown>> = []
    const start = Date.now()

    const results = await runVerification(
      ['sleep 1'],
      process.cwd(),
      'att-timeout',
      fakeLedger(verifications),
      dir,
      50,
    )

    expect(Date.now() - start).toBeLessThan(3000)
    expect(results[0].passed).toBe(false)
    expect(results[0].exitCode).toBe(124)
    expect(verifications[0].exitCode).toBe(124)
  })
})
