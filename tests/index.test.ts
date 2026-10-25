import { describe, it, expect, afterAll } from 'bun:test'
import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import {
  canonicalLedgerKey,
  createStorageProjection,
  isProjectionStorage,
  PROJECTION_ALLOWED_METHODS,
  PROJECTION_BOARD_KEY,
  PROJECTION_FORBIDDEN_AUTHORITY_NAMES,
  PROJECTION_KEY_PREFIX,
  resolveSupervisorConfig,
  SqliteLedger,
  SupervisorPlugin,
  supervisorExecuteBeforeGuard,
  supervisorPolicyGuard,
  createPolicySnapshot,
  toolName,
} from '../src/index'

const fixtureRoot = `/tmp/opencode-conductor-test/t7-globalize-${Date.now()}`

afterAll(() => {
  rmSync(fixtureRoot, { recursive: true, force: true })
})

function createFixtureRepo(name: string): string {
  const root = `${fixtureRoot}/${name}`
  // A fake repo: `<root>/.git` (dir) + a linked worktree whose `.git` is a file.
  mkdirSync(`${root}/.git/worktrees/wt-1`, { recursive: true })
  mkdirSync(`${root}/sub/deep`, { recursive: true })
  mkdirSync(`${root}/.opencode`, { recursive: true })
  writeFileSync(`${root}/.git/worktrees/wt-1/HEAD`, 'ref: refs/heads/main\n')
  const linked = `${fixtureRoot}/${name}-linked`
  mkdirSync(linked, { recursive: true })
  writeFileSync(linked + '/.git', `gitdir: ${root}/.git/worktrees/wt-1\n`)
  return root
}

describe('resolveSupervisorConfig — option resolution order', () => {
  const env = {
    SUPERVISOR_REPO_ROOT: '/env/repo',
    SUPERVISOR_BRANCHES: 'trunk,release',
    SUPERVISOR_VERIFY_PROFILE: 'bun run build,bun test',
  }

  it('explicit factory options win over ctx.options, env, ctx.location and cwd', () => {
    const config = resolveSupervisorConfig({
      options: { repoRoot: '/opt/repo' },
      ctxOptions: { supervisor: { repoRoot: '/ctx/repo' } },
      locationDirectory: '/loc/repo',
      env,
      cwd: '/cwd',
    })
    expect(config.repoRoot).toBe('/opt/repo')
    expect(config.source).toBe('options')
  })

  it('accepts the runtime directory alias on the factory options', () => {
    const config = resolveSupervisorConfig({ options: { directory: '/opt/dir' }, env })
    expect(config.repoRoot).toBe('/opt/dir')
    expect(config.source).toBe('options')
  })

  it('falls back to ctx.options.supervisor, then to a flat ctx.options bag', () => {
    const nested = resolveSupervisorConfig({
      ctxOptions: { supervisor: { repoRoot: '/ctx/repo' } },
      locationDirectory: '/loc/repo',
      env,
    })
    expect(nested.repoRoot).toBe('/ctx/repo')
    expect(nested.source).toBe('ctx.options')

    const flat = resolveSupervisorConfig({ ctxOptions: { repoRoot: '/flat/repo' }, env })
    expect(flat.repoRoot).toBe('/flat/repo')
    expect(flat.source).toBe('ctx.options')
  })

  it('survives a hostile ctx.options getter (unconfirmed runtime shape)', () => {
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error('boom')
        },
      },
    )
    const config = resolveSupervisorConfig({ ctxOptions: hostile, env, cwd: '/cwd' })
    expect(config.repoRoot).toBe('/env/repo')
    expect(config.source).toBe('env')
  })

  it('falls back to env, then ctx.location, then process cwd', () => {
    const fromEnv = resolveSupervisorConfig({ locationDirectory: '/loc/repo', env })
    expect(fromEnv.repoRoot).toBe('/env/repo')
    expect(fromEnv.source).toBe('env')

    const fromLocation = resolveSupervisorConfig({ locationDirectory: '/loc/repo', env: {}, cwd: '/cwd' })
    expect(fromLocation.repoRoot).toBe('/loc/repo')
    expect(fromLocation.source).toBe('ctx.location')

    const fromCwd = resolveSupervisorConfig({ env: {}, cwd: '/cwd' })
    expect(fromCwd.repoRoot).toBe('/cwd')
    expect(fromCwd.source).toBe('default')
  })

  it('resolves branches, verify profile, allowlist and harness from env and options', () => {
    const config = resolveSupervisorConfig({ env, cwd: '/cwd' })
    expect(config.branches).toEqual({ dev: 'trunk', main: 'release' })
    expect(config.verifyProfile).toEqual(['bun run build', 'bun test'])
    expect(config.allowedCommands).toEqual([])
    expect(config.harness).toBe('opencode-session')

    const overridden = resolveSupervisorConfig({
      options: {
        branches: { dev: 'dev' },
        verifyProfile: ['bun test tests/index.test.ts'],
        allowedCommands: ['bun test'],
        harness: 'opencode-session-v2',
        namespace: true,
      },
      env,
      cwd: '/cwd',
    })
    expect(overridden.branches).toEqual({ dev: 'dev', main: 'release' })
    expect(overridden.verifyProfile).toEqual(['bun test tests/index.test.ts'])
    expect(overridden.allowedCommands).toEqual(['bun test'])
    expect(overridden.harness).toBe('opencode-session-v2')
    expect(overridden.namespace).toBe(true)
  })

  it('defaults namespace to false so flat supervisor_* names keep working', () => {
    expect(resolveSupervisorConfig({ env, cwd: '/cwd' }).namespace).toBe(false)
    expect(resolveSupervisorConfig({ ctxOptions: { namespace: true }, env }).namespace).toBe(true)
  })

  it('keys a plain subdirectory as its own project, not the enclosing repo', () => {
    const root = createFixtureRepo('cfg')
    const nested = `${root}/sub/deep`
    const fromSubdir = resolveSupervisorConfig({ options: { repoRoot: nested }, env: {} })
    const fromRoot = resolveSupervisorConfig({ options: { repoRoot: root }, env: {} })
    expect(fromSubdir.ledgerKey).toBe(realpathSync(nested))
    expect(fromSubdir.ledgerPath).toBe(`${realpathSync(nested)}/.opencode/supervisor.db`)
    expect(fromRoot.ledgerKey).toBe(realpathSync(root))
    // P1: no enclosing-repo inheritance — the scratch dir has its own ledger.
    expect(fromRoot.ledgerKey).not.toBe(fromSubdir.ledgerKey)
    expect(fromRoot.ledgerPath).not.toBe(fromSubdir.ledgerPath)

    const explicit = resolveSupervisorConfig({
      options: { repoRoot: root, ledgerPath: '/custom/supervisor.db' },
      env: {},
    })
    expect(explicit.ledgerPath).toBe('/custom/supervisor.db')
  })
})

describe('canonicalLedgerKey — one ledger per repository', () => {
  it('does not walk up from a plain subdirectory to the enclosing repo', () => {
    const root = createFixtureRepo('canon')
    const nested = `${root}/sub/deep`
    expect(canonicalLedgerKey(nested)).toBe(realpathSync(nested))
    expect(canonicalLedgerKey(nested)).not.toBe(realpathSync(root))
    expect(canonicalLedgerKey(root)).toBe(realpathSync(root))
  })

  it('maps a linked worktree (gitdir file) to the main worktree root', () => {
    const root = createFixtureRepo('worktree')
    expect(canonicalLedgerKey(`${fixtureRoot}/worktree-linked`)).toBe(realpathSync(root))
  })

  it('returns the realpath of a directory outside any repository', () => {
    const plain = `${fixtureRoot}/plain`
    mkdirSync(plain, { recursive: true })
    expect(canonicalLedgerKey(plain)).toBe(realpathSync(plain))
  })
})

describe('toolName — flat names by default, dotted when namespaced', () => {
  it('preserves the current flat tool names', () => {
    expect(toolName('supervisor_init_run', false)).toBe('supervisor_init_run')
  })

  it('maps to supervisor.<name> when namespacing is enabled', () => {
    expect(toolName('supervisor_init_run', true)).toBe('supervisor.init_run')
    expect(toolName('supervisor_record_evidence', true)).toBe('supervisor.record_evidence')
  })
})

function createRecordingStorage() {
  const values = new Map<string, unknown>()
  const calls: string[] = []
  const storage = {
    async get(key: string) {
      calls.push(`get:${key}`)
      return values.get(key)
    },
    async set(key: string, value: unknown) {
      calls.push(`set:${key}`)
      values.set(key, value)
    },
    async remove(key: string) {
      calls.push(`remove:${key}`)
      values.delete(key)
    },
    async scan(input: { prefix: string; limit?: number }) {
      calls.push(`scan:${input.prefix}`)
      const entries = [...values.entries()]
        .filter(([key]) => key.startsWith(input.prefix))
        .map(([key, value]) => ({ key, value }))
      return { entries, next: null }
    },
  }
  return { values, calls, storage }
}

describe('I1 — ctx.storage is a VIEW projection, never a fencing authority', () => {
  it('exposes only projection members; no claim/release/heartbeat/sequence/fencing', () => {
    const projection = createStorageProjection(createRecordingStorage().storage)
    const members = Object.keys(projection)
    const allowed = new Set<string>(PROJECTION_ALLOWED_METHODS as readonly string[])

    expect(members.length).toBeGreaterThan(0)
    for (const member of members) {
      expect(allowed.has(member)).toBe(true)
    }
    for (const forbidden of PROJECTION_FORBIDDEN_AUTHORITY_NAMES) {
      for (const member of members) {
        expect(member.toLowerCase().includes(forbidden.toLowerCase())).toBe(false)
      }
    }
    // The forbidden list must actually cover the durable-authority surface.
    expect([...PROJECTION_FORBIDDEN_AUTHORITY_NAMES]).toEqual(
      expect.arrayContaining(['claim', 'release', 'lease', 'heartbeat', 'sequence', 'fencing']),
    )
  })

  it('reads and writes VIEW data through storage calls only', async () => {
    const { values, calls, storage } = createRecordingStorage()
    const projection = createStorageProjection(storage)

    expect(await projection.readRunView('run-1')).toBeNull()

    await projection.writeRunView('run-1', { run_id: 'run-1', state: 'intake' })
    expect(values.get(`${PROJECTION_KEY_PREFIX}run-1`)).toEqual({
      run_id: 'run-1',
      state: 'intake',
    })
    expect(await projection.readRunView('run-1')).toEqual({
      run_id: 'run-1',
      state: 'intake',
    })

    await projection.writeBoard({ run_count: 1 })
    expect(await projection.readBoard()).toEqual({ run_count: 1 })
    expect(values.has(PROJECTION_BOARD_KEY)).toBe(true)

    expect(await projection.listRunViews()).toEqual([
      { key: `${PROJECTION_KEY_PREFIX}run-1`, value: { run_id: 'run-1', state: 'intake' } },
    ])

    await projection.removeRunView('run-1')
    expect(values.has(`${PROJECTION_KEY_PREFIX}run-1`)).toBe(false)

    expect(calls).toEqual([
      `get:${PROJECTION_KEY_PREFIX}run-1`,
      `set:${PROJECTION_KEY_PREFIX}run-1`,
      `get:${PROJECTION_KEY_PREFIX}run-1`,
      `set:${PROJECTION_BOARD_KEY}`,
      `get:${PROJECTION_BOARD_KEY}`,
      `scan:${PROJECTION_KEY_PREFIX}`,
      `remove:${PROJECTION_KEY_PREFIX}run-1`,
    ])
  })

  it('leaves the authority surface to SqliteLedger alone', () => {
    const projection = createStorageProjection(createRecordingStorage().storage)
    for (const name of ['claimLease', 'heartbeatLease', 'releaseLease', 'transaction', 'appendEvent']) {
      expect(typeof (projection as unknown as Record<string, unknown>)[name]).toBe('undefined')
      expect(typeof (SqliteLedger.prototype as unknown as Record<string, unknown>)[name]).toBe('function')
    }
  })

  it('gates the unconfirmed runtime storage shape', () => {
    const { storage } = createRecordingStorage()
    expect(isProjectionStorage(storage)).toBe(true)
    expect(isProjectionStorage({ get: () => {} })).toBe(false)
    expect(isProjectionStorage(null)).toBe(false)
    expect(isProjectionStorage('storage')).toBe(false)
  })
})

describe('execute.before guard — secrets and dangerous commands', () => {
  it('permits only a non-force push to the dev branch', () => {
    const guard = (command: string) =>
      supervisorExecuteBeforeGuard({ tool: 'bash', input: { command } })

    expect(() => guard('git push origin develop')).not.toThrow()
    expect(() => guard('git push origin main')).toThrow(/Blocked dangerous command/)
    expect(() => guard('git push -f origin develop')).toThrow(/Blocked dangerous command/)
    expect(() => guard('git push origin develop && git push origin main')).toThrow(
      /Blocked dangerous command/,
    )
    expect(() => guard('sudo rm -rf /etc')).toThrow(/Blocked dangerous command/)
    expect(() => guard('chmod 777 .')).toThrow(/Blocked dangerous command/)
  })

  it('honours a configured dev branch', () => {
    const push = (command: string) =>
      supervisorExecuteBeforeGuard({ tool: 'bash', input: { command } }, { dev: 'trunk', main: 'main' })
    expect(() => push('git push origin trunk')).not.toThrow()
    expect(() => push('git push origin develop')).toThrow(/Blocked dangerous command/)
  })

  it('refuses secret-file reads', () => {
    expect(() =>
      supervisorExecuteBeforeGuard({ tool: 'read', input: { filePath: '/repo/.env.local' } }),
    ).toThrow(/Cannot read \.env/)
    expect(() =>
      supervisorExecuteBeforeGuard({ tool: 'read', input: { path: '/repo/secrets/app.key' } }),
    ).toThrow(/Cannot read \.env/)
    expect(() =>
      supervisorExecuteBeforeGuard({ tool: 'read', input: { filePath: '/repo/src/plugin.ts' } }),
    ).not.toThrow()
  })
})

describe('SupervisorPlugin — programmatic factory', () => {
  it('exposes the flat supervisor_* tool set and one ledger per canonical repo', async () => {
    const root = createFixtureRepo('factory')
    mkdirSync(`${root}/.opencode`, { recursive: true })

    const instance = await SupervisorPlugin({ directory: root, $: Bun.$ })
    const names = Object.keys(instance.tool)
    expect(names).toHaveLength(14)
    for (const name of names) expect(name.startsWith('supervisor_')).toBe(true)
    expect(names).toContain('supervisor_init_run')
    expect(names).toContain('supervisor_record_evidence')
    // Ops-resilience tools (t5) must be present in the shim-level tool set.
    expect(names).toContain('supervisor_patrol')
    expect(names).toContain('supervisor_sweep')
    expect(instance.config.repoRoot).toBe(root)

    const init = JSON.parse(
      await instance.tool.supervisor_init_run.execute({
        objective: 'globalize the plugin',
        risk_class: 'low',
        uncertainties: ['no acceptance criteria yet'],
      }),
    )
    expect(init.state).toBe('awaiting_refinement')

    expect(existsSync(instance.config.ledgerPath)).toBe(true)

    // A linked worktree shares the main ledger; a plain subdirectory is its own
    // project (P1: no enclosing-repo walk-up).
    const fromWorktree = await SupervisorPlugin({
      directory: `${fixtureRoot}/factory-linked`,
      $: Bun.$,
    })
    const fromSubdir = await SupervisorPlugin({ directory: `${root}/sub/deep`, $: Bun.$ })
    expect(fromWorktree.config.ledgerPath).toBe(instance.config.ledgerPath)
    expect(fromSubdir.config.ledgerPath).toBe(
      `${realpathSync(`${root}/sub/deep`)}/.opencode/supervisor.db`,
    )
    expect(fromSubdir.config.ledgerPath).not.toBe(instance.config.ledgerPath)
  })
})

describe('policy-authority snapshot — fail-closed gates (F1)', () => {
  function writePolicyFixture(root: string): void {
    mkdirSync(`${root}/tools/opencode-conductor/profiles`, { recursive: true })
    writeFileSync(
      `${root}/opencode.json`,
      JSON.stringify({ permission: { bash: { 'git push *': 'deny' } } }),
    )
    writeFileSync(
      `${root}/tools/opencode-conductor/profiles/assisted.json`,
      JSON.stringify({
        operation_mode: 'assisted',
        policy_profile: 'assisted',
        mcp_profiles: ['core-readonly'],
      }),
    )
  }

  it('denies an out-of-scope MCP tool with an unknown mcp__ namespace', () => {
    const root = createFixtureRepo('policy-mcp')
    writePolicyFixture(root)
    const snapshot = createPolicySnapshot(realpathSync(root))
    expect(() =>
      supervisorPolicyGuard({ tool: 'mcp__unknown_server__tool' }, { snapshot }),
    ).toThrow(/outside the effective profile's MCP scope/)
    // A known server that is not in the effective scope is also denied.
    expect(() =>
      supervisorPolicyGuard({ tool: 'supabase_get_project_url' }, { snapshot }),
    ).toThrow(/outside the effective profile's MCP scope/)
    // Non-MCP built-in tools stay unscoped.
    expect(() =>
      supervisorPolicyGuard({ tool: 'read', input: { filePath: '/x' } }, { snapshot }),
    ).not.toThrow()
  })

  it('exempts only the enumerated supervisor_* tools (flat and namespaced)', () => {
    const root = createFixtureRepo('policy-allowlist')
    writePolicyFixture(root)
    const snapshot = createPolicySnapshot(realpathSync(root))
    expect(() => supervisorPolicyGuard({ tool: 'supervisor_patrol' }, { snapshot })).not.toThrow()
    expect(() => supervisorPolicyGuard({ tool: 'supervisor.patrol' }, { snapshot })).not.toThrow()
  })

  it('fails closed when the canonical policy inputs change after the snapshot', () => {
    const root = createFixtureRepo('policy-tamper')
    writePolicyFixture(root)
    const snapshot = createPolicySnapshot(realpathSync(root))
    // A gated command that would otherwise pass.
    expect(() =>
      supervisorPolicyGuard({ tool: 'bash', input: { command: 'ls -la' } }, { snapshot }),
    ).not.toThrow()
    // Tamper with the canonical root permission block after the snapshot.
    writeFileSync(
      `${root}/opencode.json`,
      JSON.stringify({ permission: { bash: { '*': 'allow' } } }),
    )
    expect(() =>
      supervisorPolicyGuard({ tool: 'bash', input: { command: 'ls -la' } }, { snapshot }),
    ).toThrow(/policy snapshot/)
  })
})
