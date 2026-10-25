// Trust is the gate that makes global plugin execution safe: no mutation in a
// folder until the user opts in from their own config. These tests pin the
// fail-closed matrix and the write properties (atomic, 0600, idempotent,
// non-destructive). Every case injects `configPath` or a synthetic `env`, so
// the suite never reads or writes the real home directory.
import { afterAll, describe, expect, it } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  assertTrusted,
  grantTrust,
  resolveTrust,
  revokeTrust,
  TRUST_GRANT_HINT,
  UntrustedProjectError,
  type TrustDecision,
} from '../../src/runtime/trust'

const fixtureRoot = realpathSync(mkdtempSync(join(tmpdir(), 'trust-test-')))

afterAll(() => {
  rmSync(fixtureRoot, { recursive: true, force: true })
})

function directory(name: string): string {
  const path = join(fixtureRoot, 'dirs', name)
  mkdirSync(path, { recursive: true })
  return realpathSync(path)
}

function configFile(name: string): string {
  return join(fixtureRoot, 'config', name)
}

function writeConfig(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(value, null, 2))
}

function readConfig(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
}

function grantsOf(config: Record<string, unknown>): Array<Record<string, unknown>> {
  const trust = config.trust
  if (typeof trust !== 'object' || trust === null) return []
  const grants = (trust as Record<string, unknown>).grants
  return Array.isArray(grants) ? (grants as Array<Record<string, unknown>>) : []
}

function grantConfig(
  path: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    trust: {
      default: 'deny',
      allowSubdirectories: false,
      grants: [
        {
          path,
          grantedAt: '2026-01-01T00:00:00.000Z',
          ...extra,
        },
      ],
    },
  }
}

function expectDenied(
  decision: TrustDecision,
  code: TrustDecision['code'],
): void {
  expect(decision.trusted).toBe(false)
  expect(decision.code).toBe(code)
  expect(decision.hint).toBe(TRUST_GRANT_HINT)
  expect(decision.message).not.toContain('\n')
  expect(decision.message).toContain('mutating supervisor tools are disabled')
}

describe('resolveTrust — fail closed', () => {
  it('denies when the config file does not exist', () => {
    const project = directory('no-config-project')
    const configPath = configFile('absent.json')

    const decision = resolveTrust({ projectRoot: project, configPath })

    expectDenied(decision, 'no_config')
    expect(decision.projectRoot).toBe(project)
    expect(decision.message).toBe(
      `Project ${project} is not trusted: no trust config at ${configPath}; mutating supervisor tools are disabled.`,
    )
  })

  it('denies when the config is not valid JSON', () => {
    const project = directory('malformed-project')
    const configPath = configFile('malformed.json')
    mkdirSync(dirname(configPath), { recursive: true })
    writeFileSync(configPath, '{"trust":')

    const decision = resolveTrust({ projectRoot: project, configPath })

    expectDenied(decision, 'malformed_config')
    expect(decision.message).toContain('is not valid JSON')
  })

  it('denies when the trust section is missing', () => {
    const project = directory('missing-trust-project')
    const configPath = configFile('missing-trust.json')
    writeConfig(configPath, { version: 1, unrelated: true })

    const decision = resolveTrust({ projectRoot: project, configPath })

    expectDenied(decision, 'malformed_config')
    expect(decision.message).toContain('has no "trust" section')
  })

  it('denies when the config cannot be read', () => {
    const project = directory('io-error-project')
    const configPath = directory('config-is-a-directory')

    const decision = resolveTrust({ projectRoot: project, configPath })

    expectDenied(decision, 'io_error')
  })

  it('denies without throwing when neither config location variable is set', () => {
    const project = directory('no-env-project')

    const decision = resolveTrust({ projectRoot: project, env: {} })

    expectDenied(decision, 'io_error')
    expect(decision.message).toContain('XDG_CONFIG_HOME')
  })

  it('denies a project that has no matching grant', () => {
    const project = directory('ungranted-project')
    const other = directory('other-project')
    const configPath = configFile('ungranted.json')
    writeConfig(configPath, grantConfig(other))

    const decision = resolveTrust({ projectRoot: project, configPath })

    expectDenied(decision, 'not_granted')
    expect(decision.message).toBe(
      `Project ${project} is not trusted; mutating supervisor tools are disabled.`,
    )
    expect(decision.matchedGrant).toBeUndefined()
  })

  it('denies a child of a grant when allowSubdirectories is false', () => {
    const parent = directory('plain-parent')
    const child = join(parent, 'repo')
    mkdirSync(child, { recursive: true })
    const configPath = configFile('plain-parent.json')
    writeConfig(configPath, grantConfig(parent))

    const decision = resolveTrust({ projectRoot: child, configPath })

    expectDenied(decision, 'not_granted')
    expect(decision.matchedGrant).toBeUndefined()
  })

  it('denies a revoked grant', () => {
    const project = directory('revoked-project')
    const configPath = configFile('revoked.json')
    writeConfig(
      configPath,
      grantConfig(project, { revokedAt: '2026-02-01T00:00:00.000Z' }),
    )

    const decision = resolveTrust({ projectRoot: project, configPath })

    expectDenied(decision, 'revoked')
    expect(decision.message).toContain('revoked at 2026-02-01T00:00:00.000Z')
  })

  it('ignores a trust file inside the project', () => {
    const project = directory('project-local-config')
    mkdirSync(join(project, '.opencode'), { recursive: true })
    writeFileSync(
      join(project, '.opencode', 'conductor.json'),
      JSON.stringify(grantConfig(project)),
    )
    const configPath = configFile('project-local-not-used.json')

    const decision = resolveTrust({ projectRoot: project, configPath })

    expectDenied(decision, 'no_config')
  })

  it('does not trust everything when trust.default is allow', () => {
    const project = directory('default-allow-project')
    const configPath = configFile('default-allow.json')
    writeConfig(configPath, { trust: { default: 'allow', grants: [] } })

    const decision = resolveTrust({ projectRoot: project, configPath })

    expectDenied(decision, 'not_granted')
  })
})

describe('resolveTrust — grants', () => {
  it('allows an exact grant', () => {
    const project = directory('exact-project')
    const configPath = configFile('exact.json')
    writeConfig(configPath, grantConfig(project))

    const decision = resolveTrust({ projectRoot: project, configPath })

    expect(decision.trusted).toBe(true)
    expect(decision.code).toBe('trusted')
    expect(decision.projectRoot).toBe(project)
    expect(decision.matchedGrant).toBe(project)
    expect(decision.message).toContain('mutating supervisor tools are enabled')
  })

  it('allows a subdirectory when allowSubdirectories is true', () => {
    const parent = directory('recursive-parent')
    const child = join(parent, 'nested', 'repo')
    mkdirSync(child, { recursive: true })
    const configPath = configFile('recursive.json')
    writeConfig(configPath, {
      trust: {
        default: 'deny',
        allowSubdirectories: true,
        grants: [{ path: parent, grantedAt: '2026-01-01T00:00:00.000Z' }],
      },
    })

    const decision = resolveTrust({ projectRoot: child, configPath })

    expect(decision.trusted).toBe(true)
    expect(decision.matchedGrant).toBe(parent)
  })

  it('matches a symlinked project root against the realpath grant', () => {
    const real = directory('symlink-real')
    const link = join(fixtureRoot, 'dirs', 'symlink-link')
    symlinkSync(real, link)
    const configPath = configFile('symlink.json')
    writeConfig(configPath, grantConfig(real))

    const decision = resolveTrust({ projectRoot: link, configPath })

    expect(decision.trusted).toBe(true)
    expect(decision.projectRoot).toBe(real)
    expect(decision.matchedGrant).toBe(real)
  })

  it('finds the config through an injected XDG_CONFIG_HOME', () => {
    const project = directory('xdg-project')
    const xdg = directory('xdg-config')
    const env = { XDG_CONFIG_HOME: xdg }

    const granted = grantTrust(project, { env })

    expect(granted.trusted).toBe(true)
    expect(existsSync(join(xdg, 'opencode', 'conductor.json'))).toBe(true)
    expect(resolveTrust({ projectRoot: project, env }).trusted).toBe(true)
  })

  it('falls back to HOME/.config/opencode when XDG_CONFIG_HOME is unset', () => {
    const project = directory('home-project')
    const home = directory('home-only')
    const env = { HOME: home }

    grantTrust(project, { env })

    expect(
      existsSync(join(home, '.config', 'opencode', 'conductor.json')),
    ).toBe(true)
    expect(resolveTrust({ projectRoot: project, env }).trusted).toBe(true)
  })
})

describe('grantTrust — writes', () => {
  it('is idempotent', () => {
    const project = directory('idempotent-project')
    const configPath = configFile('idempotent.json')

    const first = grantTrust(project, {
      configPath,
      now: '2026-03-01T00:00:00.000Z',
    })
    const second = grantTrust(project, {
      configPath,
      now: '2026-03-02T00:00:00.000Z',
    })

    expect(first.trusted).toBe(true)
    expect(second.trusted).toBe(true)
    const grants = grantsOf(readConfig(configPath))
    expect(grants).toHaveLength(1)
    expect(grants[0]?.path).toBe(project)
    expect(grants[0]?.grantedAt).toBe('2026-03-02T00:00:00.000Z')
  })

  it('preserves unrelated config keys', () => {
    const project = directory('preserve-project')
    const configPath = configFile('preserve.json')
    writeConfig(configPath, {
      version: 7,
      'x-custom': true,
      unrelated: { nested: [1, 2, 3] },
      trust: { default: 'deny', grants: [] },
    })

    const decision = grantTrust(project, { configPath })

    expect(decision.trusted).toBe(true)
    const config = readConfig(configPath)
    expect(config.version).toBe(7)
    expect(config['x-custom']).toBe(true)
    expect(config.unrelated).toEqual({ nested: [1, 2, 3] })
    const grants = grantsOf(config)
    expect(grants).toHaveLength(1)
    expect(grants[0]?.path).toBe(project)
  })

  it('writes the config with mode 0600', () => {
    const project = directory('mode-project')
    const configPath = configFile('mode.json')

    grantTrust(project, { configPath })

    expect(statSync(configPath).mode & 0o777).toBe(0o600)
  })

  it('can grant a parent with allowSubdirectories in one call', () => {
    const parent = directory('grant-parent')
    const child = join(parent, 'child')
    mkdirSync(child, { recursive: true })
    const configPath = configFile('grant-parent.json')

    grantTrust(parent, { configPath, allowSubdirectories: true })

    const decision = resolveTrust({ projectRoot: child, configPath })
    expect(decision.trusted).toBe(true)
    expect(decision.matchedGrant).toBe(parent)
  })

  it('clears a revocation when the path is granted again', () => {
    const project = directory('regrant-project')
    const configPath = configFile('regrant.json')

    grantTrust(project, { configPath, now: '2026-03-01T00:00:00.000Z' })
    revokeTrust(project, { configPath, now: '2026-03-02T00:00:00.000Z' })
    const regranted = grantTrust(project, {
      configPath,
      now: '2026-03-03T00:00:00.000Z',
    })

    expect(regranted.trusted).toBe(true)
    const grants = grantsOf(readConfig(configPath))
    expect(grants).toHaveLength(1)
    expect(grants[0]?.revokedAt).toBeUndefined()
    expect(grants[0]?.grantedAt).toBe('2026-03-03T00:00:00.000Z')
  })

  it('refuses to overwrite a malformed config', () => {
    const project = directory('refuse-project')
    const configPath = configFile('refuse.json')
    mkdirSync(dirname(configPath), { recursive: true })
    writeFileSync(configPath, '{ not json')

    const decision = grantTrust(project, { configPath })

    expectDenied(decision, 'malformed_config')
    expect(readFileSync(configPath, 'utf8')).toBe('{ not json')
  })
})

describe('revokeTrust', () => {
  it('stamps revokedAt, denies, and leaves the entry as an audit trail', () => {
    const project = directory('revoke-project')
    const configPath = configFile('revoke.json')

    grantTrust(project, { configPath, now: '2026-04-01T00:00:00.000Z' })
    const revoked = revokeTrust(project, {
      configPath,
      now: '2026-04-02T00:00:00.000Z',
    })

    expectDenied(revoked, 'revoked')
    const grants = grantsOf(readConfig(configPath))
    expect(grants).toHaveLength(1)
    expect(grants[0]?.revokedAt).toBe('2026-04-02T00:00:00.000Z')
  })

  it('keeps the original revocation timestamp on a second call', () => {
    const project = directory('revoke-twice-project')
    const configPath = configFile('revoke-twice.json')

    grantTrust(project, { configPath, now: '2026-04-01T00:00:00.000Z' })
    revokeTrust(project, { configPath, now: '2026-04-02T00:00:00.000Z' })
    const again = revokeTrust(project, {
      configPath,
      now: '2026-04-03T00:00:00.000Z',
    })

    expectDenied(again, 'revoked')
    expect(grantsOf(readConfig(configPath))[0]?.revokedAt).toBe(
      '2026-04-02T00:00:00.000Z',
    )
  })
})

describe('assertTrusted', () => {
  it('throws a typed error carrying code, hint and projectRoot', () => {
    const project = directory('assert-project')
    const configPath = configFile('assert.json')
    writeConfig(configPath, { trust: { default: 'deny', grants: [] } })
    const decision = resolveTrust({ projectRoot: project, configPath })

    let caught: unknown
    try {
      assertTrusted(decision)
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(UntrustedProjectError)
    const typed = caught as UntrustedProjectError
    expect(typed.name).toBe('UntrustedProjectError')
    expect(typed.code).toBe('not_granted')
    expect(typed.hint).toBe(TRUST_GRANT_HINT)
    expect(typed.projectRoot).toBe(project)
    expect(typed.message).toBe(decision.message)
  })

  it('does not throw for a trusted decision', () => {
    const project = directory('assert-trusted-project')
    const configPath = configFile('assert-trusted.json')
    grantTrust(project, { configPath })

    const decision = resolveTrust({ projectRoot: project, configPath })

    expect(() => assertTrusted(decision)).not.toThrow()
  })
})
