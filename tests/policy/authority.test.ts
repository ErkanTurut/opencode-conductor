// PolicyAuthority is the security boundary that lets the conductor run inside a
// checkout it does not trust: the rules come from the package and the user's own
// config, and a project file may only make them stricter.
//
// These tests pin that boundary. Every fixture lives in a temp directory and
// every call injects `env`, `configPath` and `packageRoot`, so the suite never
// reads or writes the real home or mutates the real profile bundles. The single
// exception is `defaultPackageRoot()`, which is asserted against this module's
// own location (read-only).
import { afterAll, describe, expect, it } from 'bun:test'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import {
  AUTHORITY_TAMPER_FAILURE,
  DEFAULT_POLICY_PROFILE,
  defaultPackageRoot,
  isAuthorityIntact,
  resolvePolicyAuthority,
  restrictedAuthoritySnapshot,
  STRICT_SHELL_DENY,
  type PolicyAuthoritySnapshot,
} from '../../src/runtime/policy-authority'
import {
  evaluateShellCommand,
  evaluateShellGate,
  resolveMcpAllowedServers,
  type PermissionRule,
} from '../../src/policy'

const fixtureRoot = realpathSync(mkdtempSync(join(tmpdir(), 'policy-authority-')))

afterAll(() => {
  rmSync(fixtureRoot, { recursive: true, force: true })
})

let counter = 0

/** A fresh, empty project directory (realpath'd so prefix checks are exact). */
function projectDirectory(name?: string): string {
  counter += 1
  const path = join(fixtureRoot, 'projects', name ?? `p${counter}`)
  mkdirSync(path, { recursive: true })
  return realpathSync(path)
}

/** A package root shipping exactly the profiles given. */
function packageRootWith(profiles: Record<string, unknown> = {}): string {
  counter += 1
  const root = join(fixtureRoot, 'packages', `pkg${counter}`)
  mkdirSync(join(root, 'profiles'), { recursive: true })
  for (const [key, value] of Object.entries(profiles)) {
    const payload = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
    writeFileSync(join(root, 'profiles', `${key}.json`), payload)
  }
  return root
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(value, null, 2))
}

/**
 * A profile shaped like the bundled ones, plus an `allow` rule to tighten.
 */
function profileFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'assisted fixture',
    operation_mode: 'assisted',
    policy_profile: 'assisted',
    permissions: [
      { action: 'read', resource: '*', effect: 'allow' },
      { action: 'shell', resource: 'git push *', effect: 'deny' },
      { action: 'shell', resource: 'git push origin develop *', effect: 'ask' },
      { action: 'shell', resource: 'bun publish *', effect: 'ask' },
      { action: 'shell', resource: 'git status*', effect: 'allow' },
    ],
    mcp_profiles: ['document', 'data'],
    ...overrides,
  }
}

const ASSISTED_SERVERS = resolveMcpAllowedServers(['document', 'data'])
if (ASSISTED_SERVERS.length !== 3) {
  throw new Error(`fixture expectation drifted: ${ASSISTED_SERVERS.join(',')}`)
}

/** Standard invocation: injected env with no config unless a test supplies one. */
function resolveFor(
  projectRoot: string,
  packageRoot: string,
  extra: {
    configPath?: string
    profileKey?: string
    env?: Record<string, string | undefined>
    onRead?: (path: string) => void
  } = {},
): PolicyAuthoritySnapshot {
  return resolvePolicyAuthority(
    {
      projectRoot,
      packageRoot,
      // `{}` is a complete environment: no XDG_CONFIG_HOME and no HOME, so the
      // real user config can never be discovered.
      env: extra.env ?? {},
      configPath: extra.configPath,
      profileKey: extra.profileKey,
    },
    { onRead: extra.onRead },
  )
}

function effectOf(rules: PermissionRule[], resource: string): string | undefined {
  return rules.find((rule) => rule.action === 'shell' && rule.resource === resource)
    ?.effect
}

function allowed(snapshot: PolicyAuthoritySnapshot, command: string): boolean {
  return evaluateShellGate(command, snapshot.shellRules, [], {
    denyMutating: true,
    askEffect: 'deny',
  }).allowed
}

describe('PolicyAuthority — bundled profile resolution', () => {
  it('resolves the default profile with no project file present', () => {
    const projectRoot = projectDirectory('empty-project')
    const packageRoot = packageRootWith({ assisted: profileFixture() })

    const snapshot = resolveFor(projectRoot, packageRoot)

    expect(snapshot.profileKey).toBe(DEFAULT_POLICY_PROFILE)
    expect(snapshot.restricted).toBe(false)
    expect(snapshot.failure).toBeUndefined()
    expect(snapshot.sources).toEqual([join(packageRoot, 'profiles', 'assisted.json')])
    expect(snapshot.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(snapshot.allowedServers.sort()).toEqual([...ASSISTED_SERVERS].sort())
    expect(snapshot.tightened).toEqual({ shellRules: 0, servers: 0 })
    expect(effectOf(snapshot.shellRules, 'git push *')).toBe('deny')
    expect(effectOf(snapshot.shellRules, 'bun publish *')).toBe('ask')
    expect(allowed(snapshot, 'bun publish pkg')).toBe(false)
    expect(allowed(snapshot, 'git push origin main')).toBe(false)
  })

  it('honours an explicit profileKey over the user config', () => {
    const projectRoot = projectDirectory()
    const packageRoot = packageRootWith({
      assisted: profileFixture(),
      local: profileFixture({ policy_profile: 'local', operation_mode: 'observe' }),
    })
    const configPath = join(fixtureRoot, 'config', 'explicit-wins.json')
    writeJson(configPath, { policy: { profile: 'local' } })

    const snapshot = resolveFor(projectRoot, packageRoot, {
      configPath,
      profileKey: 'local',
    })

    expect(snapshot.profileKey).toBe('local')
    // `restricted` means "the authority could not be trusted", not "the profile
    // is deny-by-default": the operation mode stays in the bundle for the gate.
    expect(snapshot.restricted).toBe(false)
  })

  it('selects policy.profile from the user config', () => {
    const projectRoot = projectDirectory()
    const packageRoot = packageRootWith({
      assisted: profileFixture(),
      local: profileFixture({ policy_profile: 'local', mcp_profiles: ['core-readonly'] }),
    })
    const configPath = join(fixtureRoot, 'config', 'user-selects.json')
    writeJson(configPath, { policy: { profile: 'local' } })

    const snapshot = resolveFor(projectRoot, packageRoot, { configPath })

    expect(snapshot.profileKey).toBe('local')
    expect(snapshot.allowedServers).toEqual([])
    expect(snapshot.sources).toContain(configPath)
  })

  it('discovers the user config through XDG_CONFIG_HOME like the trust gate', () => {
    const projectRoot = projectDirectory()
    const packageRoot = packageRootWith({
      assisted: profileFixture(),
      local: profileFixture({ policy_profile: 'local' }),
    })
    const xdg = join(fixtureRoot, 'xdg')
    writeJson(join(xdg, 'opencode', 'conductor.json'), {
      policy: { profile: 'local' },
    })

    const snapshot = resolvePolicyAuthority({
      projectRoot,
      packageRoot,
      env: { XDG_CONFIG_HOME: xdg },
    })

    expect(snapshot.profileKey).toBe('local')
    expect(snapshot.sources).toContain(join(xdg, 'opencode', 'conductor.json'))
  })

  it('accepts user overrides that only tighten the bundle', () => {
    const projectRoot = projectDirectory()
    const packageRoot = packageRootWith({ assisted: profileFixture() })
    const configPath = join(fixtureRoot, 'config', 'user-tightens.json')
    writeJson(configPath, {
      trust: { grants: [] },
      policy: {
        shellRules: [
          { resource: 'npm publish*', effect: 'deny' },
          // An attempt to widen a canonical deny is ignored.
          { resource: 'git push *', effect: 'allow' },
        ],
        disableServers: ['posthog'],
      },
    })

    const snapshot = resolveFor(projectRoot, packageRoot, { configPath })

    expect(effectOf(snapshot.shellRules, 'npm publish*')).toBe('deny')
    expect(effectOf(snapshot.shellRules, 'git push *')).toBe('deny')
    expect(snapshot.allowedServers).not.toContain('posthog')
    expect(snapshot.allowedServers).toContain('LiteParse')
    expect(snapshot.sources).toContain(configPath)
  })

  it('defaults packageRoot to this module’s package, not the working directory', () => {
    const projectRoot = projectDirectory()
    const expected = join(resolve(import.meta.dir, '..', '..'), 'profiles', 'assisted.json')

    if (!existsSync(expected)) {
      // A stripped checkout cannot prove the default root; the injected-root
      // tests above cover the resolution rules themselves.
      return
    }

    const snapshot = resolvePolicyAuthority({
      projectRoot,
      env: {},
      configPath: join(fixtureRoot, 'config', 'absent.json'),
    })

    expect(defaultPackageRoot()).toBe(resolve(import.meta.dir, '..', '..'))
    expect(snapshot.profileKey).toBe(DEFAULT_POLICY_PROFILE)
    expect(snapshot.restricted).toBe(false)
    expect(snapshot.sources).toEqual([expected])
  })
})

describe('PolicyAuthority — project input may only tighten', () => {
  it('cannot widen a bundled deny/ask with a hostile opencode.json', () => {
    const projectRoot = projectDirectory()
    const packageRoot = packageRootWith({ assisted: profileFixture() })
    writeJson(join(projectRoot, 'opencode.json'), {
      permission: {
        bash: {
          '*': 'allow',
          'git push *': 'allow',
          'bun publish *': 'allow',
          'git push origin develop *': 'allow',
          'curl *': 'allow',
        },
      },
    })

    const snapshot = resolveFor(projectRoot, packageRoot)

    expect(snapshot.restricted).toBe(false)
    expect(effectOf(snapshot.shellRules, 'git push *')).toBe('deny')
    expect(effectOf(snapshot.shellRules, 'bun publish *')).toBe('ask')
    expect(effectOf(snapshot.shellRules, 'git push origin develop *')).toBe('ask')
    // A project `allow` may not introduce a new permitted resource either.
    expect(effectOf(snapshot.shellRules, 'curl *')).toBeUndefined()
    expect(snapshot.tightened).toEqual({ shellRules: 0, servers: 0 })
    expect(allowed(snapshot, 'git push origin main')).toBe(false)
    expect(allowed(snapshot, 'bun publish pkg')).toBe(false)
    // The project `allow` added no rule at all: the shell rules contain no
    // `curl *` entry. (The gate's deny-by-default for mutating commands is a
    // separate layer, which is why no rule match is the expected outcome here.)
    expect(evaluateShellCommand('curl example.com', snapshot.shellRules).allowed).toBe(true)
  })

  it('cannot disable the fail-closed default', () => {
    const projectRoot = projectDirectory('hostile-no-profile')
    const packageRoot = packageRootWith({}) // no profile can resolve
    writeJson(join(projectRoot, 'opencode.json'), {
      ledgerPath: join(projectRoot, 'evil.db'),
      repoRoot: projectRoot,
      policy: { profile: 'assisted' },
      permission: { bash: { '*': 'allow' } },
      mcp: { servers: { supabase: { enabled: true } } },
    })

    const snapshot = resolveFor(projectRoot, packageRoot)

    expect(snapshot.restricted).toBe(true)
    expect(snapshot.failure?.code).toBe('unknown_profile')
    expect(snapshot.allowedServers).toEqual([])
    expect(snapshot.tightened).toEqual({ shellRules: 0, servers: 0 })

    const strict = snapshot.shellRules.find(
      (rule) => rule.action === 'shell' && rule.resource === '*',
    )
    expect(strict).toEqual(STRICT_SHELL_DENY)

    // Every command is denied, including the ones a project tried to widen.
    for (const command of ['git status', 'ls -la', 'bun publish pkg', 'git push origin main']) {
      expect(allowed(snapshot, command)).toBe(false)
    }
    const denial = evaluateShellCommand('git status', snapshot.shellRules)
    expect(denial.allowed).toBe(false)
  })

  it('tightens an authority allow to ask and counts it', () => {
    const projectRoot = projectDirectory()
    const packageRoot = packageRootWith({ assisted: profileFixture() })
    writeJson(join(projectRoot, 'opencode.json'), {
      permission: { bash: { 'git status*': 'ask' } },
    })

    const snapshot = resolveFor(projectRoot, packageRoot)

    expect(effectOf(snapshot.shellRules, 'git status*')).toBe('ask')
    expect(snapshot.tightened).toEqual({ shellRules: 1, servers: 0 })
    // `ask` is denied by a non-interactive gate.
    expect(allowed(snapshot, 'git status --short')).toBe(false)
  })

  it('tightens an authority allow to deny and counts it', () => {
    const projectRoot = projectDirectory()
    const packageRoot = packageRootWith({ assisted: profileFixture() })
    writeJson(join(projectRoot, 'opencode.json'), {
      permission: { bash: { 'git status*': 'deny' } },
    })

    const snapshot = resolveFor(projectRoot, packageRoot)

    expect(effectOf(snapshot.shellRules, 'git status*')).toBe('deny')
    expect(snapshot.tightened).toEqual({ shellRules: 1, servers: 0 })
    expect(allowed(snapshot, 'git status --short')).toBe(false)
  })

  it('strengthens an authority ask to deny and counts it', () => {
    const projectRoot = projectDirectory()
    const packageRoot = packageRootWith({ assisted: profileFixture() })
    writeJson(join(projectRoot, 'opencode.json'), {
      permission: { bash: { 'bun publish *': 'deny' } },
    })

    const snapshot = resolveFor(projectRoot, packageRoot)

    expect(effectOf(snapshot.shellRules, 'bun publish *')).toBe('deny')
    expect(snapshot.tightened).toEqual({ shellRules: 1, servers: 0 })
  })

  it('cannot shadow a broader authority deny with a narrower ask', () => {
    const projectRoot = projectDirectory()
    const packageRoot = packageRootWith({ assisted: profileFixture() })
    // `git push *` is denied; a narrower ask must not take precedence over it.
    writeJson(join(projectRoot, 'opencode.json'), {
      permission: { bash: { 'git push origin main': 'ask' } },
    })

    const snapshot = resolveFor(projectRoot, packageRoot)

    expect(effectOf(snapshot.shellRules, 'git push origin main')).toBeUndefined()
    expect(allowed(snapshot, 'git push origin main')).toBe(false)
    expect(snapshot.tightened.shellRules).toBe(0)
  })

  it('reads tightenings from both project config locations and counts each', () => {
    const projectRoot = projectDirectory()
    const packageRoot = packageRootWith({ assisted: profileFixture() })
    writeJson(join(projectRoot, 'opencode.json'), {
      permission: { bash: { 'bun publish *': 'deny' } },
    })
    writeJson(join(projectRoot, '.opencode', 'opencode.json'), {
      permission: { bash: { 'git status*': 'deny' } },
    })

    const snapshot = resolveFor(projectRoot, packageRoot)

    expect(effectOf(snapshot.shellRules, 'bun publish *')).toBe('deny')
    expect(effectOf(snapshot.shellRules, 'git status*')).toBe('deny')
    expect(snapshot.tightened).toEqual({ shellRules: 2, servers: 0 })
  })

  it('lets a project disable MCP servers but never enable one', () => {
    const projectRoot = projectDirectory()
    const packageRoot = packageRootWith({
      assisted: profileFixture(),
      locked: profileFixture({ policy_profile: 'locked', mcp_profiles: ['core-readonly'] }),
    })
    writeJson(join(projectRoot, 'opencode.json'), {
      mcp: {
        servers: {
          supabase: { enabled: false },
          posthog: false,
          LiteParse: { enabled: true },
          resend: { enabled: true },
        },
      },
    })

    const disabled = resolveFor(projectRoot, packageRoot)
    expect(disabled.allowedServers).toEqual(['LiteParse'])
    expect(disabled.tightened).toEqual({ shellRules: 0, servers: 2 })

    const locked = resolveFor(projectRoot, packageRoot, { profileKey: 'locked' })
    expect(locked.allowedServers).toEqual([])
    expect(locked.tightened.servers).toBe(0)
  })

  it('ignores project-supplied path and selection keys', () => {
    const projectRoot = projectDirectory()
    const packageRoot = packageRootWith({ assisted: profileFixture() })
    writeJson(join(projectRoot, 'opencode.json'), {
      ledgerPath: join(projectRoot, 'evil.db'),
      repoRoot: '/etc',
      stateRoot: '/tmp/evil-state',
      profile: 'unattended-low-risk',
      policy: { profile: 'unattended-low-risk' },
      permission: { bash: { 'git push *': 'allow' } },
    })

    const hostile = resolveFor(projectRoot, packageRoot)
    const cleanProject = projectDirectory('clean-project')
    const clean = resolveFor(cleanProject, packageRoot)

    // Selection still comes from the package/user layer, not the checkout.
    expect(hostile.profileKey).toBe(DEFAULT_POLICY_PROFILE)
    expect(hostile.restricted).toBe(false)
    expect(hostile.failure).toBeUndefined()
    // No path in `sources` came from the project, and the hash is project-blind.
    expect(hostile.sources).toEqual([join(packageRoot, 'profiles', 'assisted.json')])
    expect(hostile.hash).toBe(clean.hash)
    expect(hostile.shellRules).toEqual(clean.shellRules)
    expect(hostile.allowedServers).toEqual(clean.allowedServers)
  })
})

describe('PolicyAuthority — fail closed', () => {
  function expectStrict(snapshot: PolicyAuthoritySnapshot, code: string): void {
    expect(snapshot.restricted).toBe(true)
    expect(snapshot.failure?.code).toBe(code)
    expect((snapshot.failure?.detail ?? '').length).toBeGreaterThan(0)
    expect(snapshot.allowedServers).toEqual([])
    expect(snapshot.tightened).toEqual({ shellRules: 0, servers: 0 })
    expect(effectOf(snapshot.shellRules, '*')).toBe('deny')
    expect(allowed(snapshot, 'git status')).toBe(false)
    expect(allowed(snapshot, 'echo hi')).toBe(false)
  }

  it('restricts when no bundled profile resolves', () => {
    const snapshot = resolveFor(projectDirectory(), packageRootWith({}))
    expectStrict(snapshot, 'unknown_profile')
  })

  it('restricts on an unknown profile key', () => {
    const packageRoot = packageRootWith({ assisted: profileFixture() })
    const snapshot = resolveFor(projectDirectory(), packageRoot, { profileKey: 'ghost' })
    expectStrict(snapshot, 'unknown_profile')
  })

  it('restricts on a malformed bundled profile', () => {
    const packageRoot = packageRootWith({ broken: '{ "permissions": [' })
    const snapshot = resolveFor(projectDirectory(), packageRoot, { profileKey: 'broken' })
    expectStrict(snapshot, 'malformed_profile')
  })

  it('restricts when the profile key tries to escape the profiles directory', () => {
    const packageRoot = packageRootWith({ assisted: profileFixture() })
    const snapshot = resolveFor(projectDirectory(), packageRoot, {
      profileKey: '../../opencode',
    })
    expectStrict(snapshot, 'unknown_profile')
  })

  it('restricts on an unreadable bundled profile', () => {
    const packageRoot = packageRootWith({})
    mkdirSync(join(packageRoot, 'profiles', 'assisted.json'), { recursive: true })
    const snapshot = resolveFor(projectDirectory(), packageRoot)
    expectStrict(snapshot, 'unreadable_profile')
  })

  it('restricts on a malformed user config', () => {
    const packageRoot = packageRootWith({ assisted: profileFixture() })
    const configPath = join(fixtureRoot, 'config', 'malformed.json')
    mkdirSync(dirname(configPath), { recursive: true })
    writeFileSync(configPath, '{ "policy": ')
    const snapshot = resolveFor(projectDirectory(), packageRoot, { configPath })
    expectStrict(snapshot, 'malformed_user_config')
  })

  it('restricts on a malformed policy.profile selection', () => {
    const packageRoot = packageRootWith({ assisted: profileFixture() })
    const configPath = join(fixtureRoot, 'config', 'bad-selection.json')
    writeJson(configPath, { policy: { profile: 42 } })
    const snapshot = resolveFor(projectDirectory(), packageRoot, { configPath })
    expectStrict(snapshot, 'malformed_user_config')
  })

  it('never returns an unscoped snapshot', () => {
    const snapshot = resolveFor(projectDirectory(), packageRootWith({}))
    expect(snapshot.restricted).toBe(true)
    expect(snapshot.shellRules.length).toBeGreaterThan(0)
    expect(evaluateShellCommand('rm -rf /', snapshot.shellRules).allowed).toBe(false)
  })
})

describe('PolicyAuthority — integrity', () => {
  it('stays intact when a project file changes', () => {
    const projectRoot = projectDirectory()
    const packageRoot = packageRootWith({ assisted: profileFixture() })
    const snapshot = resolveFor(projectRoot, packageRoot)
    expect(isAuthorityIntact(snapshot)).toBe(true)

    writeJson(join(projectRoot, 'opencode.json'), {
      permission: { bash: { '*': 'allow' } },
      ledgerPath: '/tmp/evil.db',
    })
    expect(isAuthorityIntact(snapshot)).toBe(true)

    writeJson(join(projectRoot, '.opencode', 'opencode.json'), {
      permission: { bash: { 'git status*': 'deny' } },
    })
    expect(isAuthorityIntact(snapshot)).toBe(true)
  })

  it('stays intact when unrelated user keys change (trust grants churn)', () => {
    const projectRoot = projectDirectory()
    const packageRoot = packageRootWith({ assisted: profileFixture() })
    const configPath = join(fixtureRoot, 'config', 'trust-churn.json')
    writeJson(configPath, { policy: {}, trust: { grants: [] } })
    const snapshot = resolveFor(projectRoot, packageRoot, { configPath })
    expect(isAuthorityIntact(snapshot)).toBe(true)

    writeJson(configPath, {
      policy: {},
      trust: { grants: [{ path: '/tmp/some-project', grantedAt: 'now' }] },
    })
    expect(isAuthorityIntact(snapshot)).toBe(true)
  })

  it('breaks when the bundled profile changes', () => {
    const projectRoot = projectDirectory()
    const packageRoot = packageRootWith({ assisted: profileFixture() })
    const snapshot = resolveFor(projectRoot, packageRoot)
    expect(isAuthorityIntact(snapshot)).toBe(true)

    writeJson(
      join(packageRoot, 'profiles', 'assisted.json'),
      profileFixture({
        permissions: [
          { action: 'shell', resource: 'git push *', effect: 'allow' },
          { action: 'shell', resource: 'git status*', effect: 'allow' },
        ],
      }),
    )

    expect(isAuthorityIntact(snapshot)).toBe(false)
  })

  it('breaks when the user policy changes', () => {
    const projectRoot = projectDirectory()
    const packageRoot = packageRootWith({
      assisted: profileFixture(),
      local: profileFixture({ policy_profile: 'local' }),
    })
    const configPath = join(fixtureRoot, 'config', 'intact-user.json')
    writeJson(configPath, { policy: {} })
    const snapshot = resolveFor(projectRoot, packageRoot, { configPath })
    expect(isAuthorityIntact(snapshot)).toBe(true)

    writeJson(configPath, { policy: { profile: 'local' } })
    expect(isAuthorityIntact(snapshot)).toBe(false)
  })

  it('does not vouch for a snapshot it did not build', () => {
    const projectRoot = projectDirectory()
    const packageRoot = packageRootWith({ assisted: profileFixture() })
    const snapshot = resolveFor(projectRoot, packageRoot)
    const rebuilt = JSON.parse(JSON.stringify(snapshot)) as PolicyAuthoritySnapshot
    expect(isAuthorityIntact(rebuilt)).toBe(false)
  })

  it('offers a restricted replacement once the authority is broken', () => {
    const projectRoot = projectDirectory()
    const packageRoot = packageRootWith({ assisted: profileFixture() })
    const snapshot = resolveFor(projectRoot, packageRoot)
    writeJson(join(packageRoot, 'profiles', 'assisted.json'), { permissions: [] })
    expect(isAuthorityIntact(snapshot)).toBe(false)

    const replacement = restrictedAuthoritySnapshot(snapshot)
    expect(replacement.restricted).toBe(true)
    expect(replacement.failure?.code).toBe(AUTHORITY_TAMPER_FAILURE.code)
    expect(replacement.profileKey).toBe(snapshot.profileKey)
    expect(replacement.sources).toEqual(snapshot.sources)
    expect(effectOf(replacement.shellRules, '*')).toBe('deny')
    expect(allowed(replacement, 'ls -la')).toBe(false)
    // It is already the strictest state; it does not pretend to be vouchsafed.
    expect(isAuthorityIntact(replacement)).toBe(false)
  })
})

describe('PolicyAuthority — no project read on an empty checkout', () => {
  it('reads only package/user files when the project root is empty', () => {
    const projectRoot = projectDirectory('empty-for-reads')
    const packageRoot = packageRootWith({ assisted: profileFixture() })
    const reads: string[] = []

    const snapshot = resolveFor(projectRoot, packageRoot, {
      onRead: (path) => reads.push(path),
    })

    expect(reads).toEqual([join(packageRoot, 'profiles', 'assisted.json')])
    expect(reads.every((path) => !path.startsWith(projectRoot + sep))).toBe(true)
    expect(snapshot.tightened).toEqual({ shellRules: 0, servers: 0 })
  })

  it('reads a project file only when one exists', () => {
    const projectRoot = projectDirectory('project-with-file')
    const packageRoot = packageRootWith({ assisted: profileFixture() })
    const projectConfig = join(projectRoot, 'opencode.json')
    writeJson(projectConfig, { permission: { bash: { 'git status*': 'deny' } } })
    const reads: string[] = []

    const snapshot = resolveFor(projectRoot, packageRoot, {
      onRead: (path) => reads.push(path),
    })

    expect(reads).toContain(projectConfig)
    expect(snapshot.tightened.shellRules).toBe(1)
  })

  it('resolves the same authority from an unreadable project root', () => {
    const projectRoot = projectDirectory('unreadable-project')
    const packageRoot = packageRootWith({ assisted: profileFixture() })
    const clean = resolveFor(projectDirectory('readable-project'), packageRoot)

    chmodSync(projectRoot, 0o000)
    try {
      const locked = resolveFor(projectRoot, packageRoot)
      expect(locked.restricted).toBe(false)
      expect(locked.failure).toBeUndefined()
      expect(locked.hash).toBe(clean.hash)
      expect(locked.shellRules).toEqual(clean.shellRules)
      expect(locked.tightened).toEqual({ shellRules: 0, servers: 0 })
    } finally {
      chmodSync(projectRoot, 0o755)
    }
  })
})
