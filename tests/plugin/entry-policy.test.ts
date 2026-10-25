// Entry policy: what the conductor entry does with an unresolvable policy
// authority, and where a central-mode project's run projections land.
//
// Two measured defects are pinned here:
//
//   1. `resolvePolicyAuthority` had no consumer: a restricted authority (a
//      malformed user config, an unknown/malformed bundled profile) resolved
//      and was then ignored, so every mutating tool still ran. The entry now
//      refuses mutating tools with `policy_restricted` while read-only tools
//      keep working.
//   2. `writeRunProjection` hardcoded `<repoRoot>/.opencode/runs`, so a trusted
//      central-mode project still got a `.opencode/runs` tree written into the
//      checkout. `supervisor_init_run` is now proven byte-identical on disk,
//      with `run.json` under the central `runsDir`.
//
// Every fixture is a temp directory and every call injects `env`, so the suite
// never reads the real home or writes outside its own fixture.
import { afterAll, describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  POLICY_RESTRICTED_CODE,
  POLICY_RESTRICTED_HINT,
  setupConductor,
} from '../../src/index'
import { resolveSupervisorConfig, registerSupervisorTools, type CollectedTool, type ToolRegistrar } from '../../src/plugin'
import { resolveProjectIdentity } from '../../src/runtime/project'
import { RUNTIME_REMEDIATION } from '../../src/runtime/compat'
import { SqliteLedger } from '../../src/ledger/sqlite'

const fixtureRoot = realpathSync(mkdtempSync(join(tmpdir(), 'conductor-entry-policy-')))

afterAll(() => {
  rmSync(fixtureRoot, { recursive: true, force: true })
})

let counter = 0

function makeDir(...parts: string[]): string {
  counter += 1
  const dir = join(fixtureRoot, ...parts.map((part) => part.replace('$n', String(counter))))
  mkdirSync(dir, { recursive: true })
  return realpathSync(dir)
}

/** A runtime-shaped ctx that records what the plugin registers. */
function entryContext(projectRoot: string) {
  const definitions: CollectedTool[] = []
  const editor: ToolRegistrar = {
    add: (definition) => {
      definitions.push(definition)
    },
  }
  const ctx = {
    location: {
      directory: projectRoot,
      project: { canonical: projectRoot, id: 'prj_entry_policy' },
    },
    tool: {
      async transform(fn: (target: ToolRegistrar) => void) {
        await fn(editor)
      },
    },
  }
  return { ctx, definitions }
}

const probeOk = async () => ({
  ok: true as const,
  checks: [],
  remediation: RUNTIME_REMEDIATION,
})

/**
 * Content-level directory snapshot: names, directories, and a SHA-256 per file.
 * Two equal snapshots mean nothing was added, removed, or rewritten.
 */
function snapshotDir(dir: string): string[] {
  const entries: string[] = []
  const walk = (base: string, prefix: string) => {
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name
      const absolute = join(base, entry.name)
      if (entry.isDirectory()) {
        entries.push(`${relative}/`)
        walk(absolute, relative)
        continue
      }
      if (entry.isSymbolicLink()) {
        entries.push(`${relative}@`)
        continue
      }
      const hash = createHash('sha256').update(readFileSync(absolute)).digest('hex')
      entries.push(`${relative}:${hash}`)
    }
  }
  walk(dir, '')
  return entries.sort()
}

/** Write the user-owned conductor config under the injected HOME. */
function writeConductorConfig(home: string, payload: unknown): string {
  const path = join(home, '.config', 'opencode', 'conductor.json')
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2))
  return path
}

function toolResult(out: unknown): any {
  if (typeof out === 'string') return JSON.parse(out)
  const content = (out as { content?: unknown } | null)?.content
  if (typeof content === 'string') return JSON.parse(content)
  return out
}

function executeNamed(
  definitions: CollectedTool[],
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const definition = definitions.find((entry) => entry.name === name)
  if (!definition) throw new Error(`no definition registered for ${name}`)
  return definition.execute(args)
}

describe('conductor entry — restricted policy authority', () => {
  it('refuses every mutating tool with policy_restricted and keeps read-only tools working', async () => {
    const projectRoot = makeDir('restricted-project-$n')
    const home = makeDir('restricted-home-$n')
    // A malformed user config IS a restricted authority: the policy inputs
    // cannot be trusted, so no mutating tool may run.
    const configPath = writeConductorConfig(home, '{ this is not json')
    const { ctx, definitions } = entryContext(projectRoot)
    const before = snapshotDir(projectRoot)

    await setupConductor(ctx, { env: { HOME: home }, probe: probeOk })

    // The full tool set is still registered: the capability list must describe
    // what the tools do once the policy is fixed.
    const names = definitions.map((definition) => definition.name)
    expect(names).toContain('supervisor_init_run')
    expect(names).toContain('supervisor_verify')
    expect(names).toContain('supervisor_worktree')
    expect(names).toContain('supervisor_get_status')

    for (const name of [
      'supervisor_init_run',
      'supervisor_create_task',
      'supervisor_verify',
      'supervisor_worktree',
      'supervisor_cancel_run',
    ]) {
      const refusal = toolResult(await executeNamed(definitions, name, {}))
      expect(refusal.refused).toBe(true)
      expect(refusal.code).toBe(POLICY_RESTRICTED_CODE)
      expect(refusal.tool).toBe(name)
      expect(refusal.hint).toBe(POLICY_RESTRICTED_HINT)
      expect(refusal.failure.code).toBe('malformed_user_config')
      expect(String(refusal.failure.detail)).toContain(configPath)
    }

    // Read-only tools still work: an agent must be able to read state while the
    // operator fixes the configuration.
    const status = toolResult(
      await executeNamed(definitions, 'supervisor_get_status', {
        run_id: 'run-does-not-exist',
      }),
    )
    expect(status.refused).toBeUndefined()
    expect(status.error).toBe('Run not found')

    // Nothing was written into the checkout.
    expect(snapshotDir(projectRoot)).toEqual(before)
    expect(existsSync(join(projectRoot, '.opencode'))).toBe(false)
  })
})

describe('conductor entry — central mode keeps the checkout untouched', () => {
  it('writes run.json under the central runsDir after supervisor_init_run', async () => {
    const projectRoot = makeDir('central-project-$n')
    const home = makeDir('central-home-$n')
    writeConductorConfig(home, {
      trust: {
        default: 'deny',
        allowSubdirectories: false,
        grants: [{ path: projectRoot, grantedAt: '2026-01-01T00:00:00.000Z' }],
      },
    })

    const env = { HOME: home }
    // A plain directory with no conductor state: `auto` picks central.
    const identity = resolveProjectIdentity({ projectRoot, mode: 'auto', env })
    expect(identity.layout.mode).toBe('central')
    expect(identity.layout.runsDir.startsWith(home)).toBe(true)

    const { ctx, definitions } = entryContext(projectRoot)
    const before = snapshotDir(projectRoot)

    await setupConductor(ctx, { env, probe: probeOk })

    const init = toolResult(
      await executeNamed(definitions, 'supervisor_init_run', {
        objective: 'a centrally stored run',
        risk_class: 'low',
      }),
    )
    expect(init.state).toBe('intake')
    expect(String(init.run_id)).toMatch(/^run-/)

    // Byte-level proof: nothing was created, changed, or removed in the
    // checkout — including `.opencode/`.
    expect(snapshotDir(projectRoot)).toEqual(before)
    expect(existsSync(join(projectRoot, '.opencode'))).toBe(false)
    expect(existsSync(join(projectRoot, '.opencode', 'runs'))).toBe(false)

    // The projection landed in the central runs directory instead.
    const centralRunDir = join(identity.layout.runsDir, init.run_id)
    expect(existsSync(join(centralRunDir, 'run.json'))).toBe(true)
    const view = JSON.parse(readFileSync(join(centralRunDir, 'run.json'), 'utf8'))
    expect(view.run_id).toBe(init.run_id)
    expect(view.state).toBe('intake')

    // A task projection takes the same route (`writeTaskProjection`).
    const task = toolResult(
      await executeNamed(definitions, 'supervisor_create_task', {
        run_id: init.run_id,
        title: 'central task',
        role: 'coder',
        acceptance_criteria: ['ok'],
        verification_commands: ['echo ok'],
      }),
    )
    expect(
      existsSync(join(centralRunDir, 'tasks', task.task_id, 'task.json')),
    ).toBe(true)
    expect(snapshotDir(projectRoot)).toEqual(before)
  })
})

describe('supervisor_verify — allowlist + shell gate', () => {
  /** A local-mode fixture with one recorded task and a live attempt. */
  async function seedVerifyFixture(label: string, recorded: string[], role = 'coder') {
    const projectRoot = makeDir(`verify-${label}-$n`)
    const ledgerPath = join(projectRoot, '.opencode', 'supervisor.db')
    mkdirSync(dirname(ledgerPath), { recursive: true })

    const ledger = new SqliteLedger(ledgerPath)
    await ledger.createRun({
      id: 'run-1',
      parentId: null,
      repoId: projectRoot,
      requestHash: 'hash',
      dataClass: 'internal',
      policyProfile: 'assisted',
      operationMode: 'assisted',
      riskClass: 'low',
      requestText: 'verify allowlist',
      budgetJson: '{}',
      deadlineAt: null,
    })
    await ledger.createWorkItem({
      id: 'wi-verify',
      runId: 'run-1',
      issueKey: '',
      title: 'verify allowlist',
      dependencyJson: '[]',
      ownerRole: role,
      modelSlot: 'implementation',
      priority: 0,
      writeScopeJson: '[]',
      contractJson: '{}',
      allowedPathsJson: '[]',
      readPathsJson: '[]',
      acceptanceCriteriaJson: '["ok"]',
      verificationCommandsJson: JSON.stringify(recorded),
    })
    await ledger.createAttempt({
      id: 'att-1',
      workItemId: 'wi-verify',
      attemptNo: 1,
      harness: 'opencode-cli',
      modelProvider: 'opencode',
      modelId: 'test-model',
      modelVariant: null,
      workspaceId: null,
      baseSha: '',
    })
    ledger.close()

    const config = resolveSupervisorConfig({
      options: { repoRoot: projectRoot, ledgerPath },
      env: {},
    })
    const definitions: CollectedTool[] = []
    registerSupervisorTools(
      { add: (definition) => definitions.push(definition) },
      config,
    )
    return { projectRoot, definitions }
  }

  it('refuses caller-supplied commands a task did not record', async () => {
    const { definitions } = await seedVerifyFixture('substitute', ['echo recorded-ok'])

    const result = toolResult(
      await executeNamed(definitions, 'supervisor_verify', {
        commands: ['echo injected-command'],
        run_id: 'run-1',
        attempt_id: 'att-1',
      }),
    )

    expect(result.refused).toBe(true)
    expect(result.code).toBe('verification_command_refused')
    expect(result.reason).toBe('commands_differ_from_recorded')
    expect(result.recorded_commands).toEqual(['echo recorded-ok'])
    expect(result.supplied_commands).toEqual(['echo injected-command'])
    expect(result.failure_class).toBe('verification_command_refused')
    expect(result.results).toEqual([])
  })

  it('refuses a task that recorded no commands when the caller smuggles one in', async () => {
    const { definitions } = await seedVerifyFixture('smuggled', [])

    const refusal = toolResult(
      await executeNamed(definitions, 'supervisor_verify', {
        commands: ['echo smuggled'],
        run_id: 'run-1',
        attempt_id: 'att-1',
      }),
    )

    expect(refusal.refused).toBe(true)
    expect(refusal.code).toBe('verification_command_refused')
    expect(refusal.reason).toBe('commands_differ_from_recorded')
    expect(refusal.recorded_commands).toEqual([])
    expect(refusal.supplied_commands).toEqual(['echo smuggled'])
    expect(refusal.results).toEqual([])
    expect(refusal.failure_class).toBe('verification_command_refused')
  })

  it('refuses a recorded command the shell gate denies', async () => {
    const { definitions } = await seedVerifyFixture('denied', ['rm -rf /'])

    const refusal = toolResult(
      await executeNamed(definitions, 'supervisor_verify', {
        run_id: 'run-1',
        attempt_id: 'att-1',
      }),
    )

    expect(refusal.refused).toBe(true)
    expect(refusal.code).toBe('verification_command_refused')
    expect(refusal.command).toBe('rm -rf /')
    expect(refusal.reason).toBe('deny:rm -rf *')
  })
})
