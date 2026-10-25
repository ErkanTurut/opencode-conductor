import { describe, test, expect, afterAll, afterEach } from 'bun:test'
import * as nodeFs from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  defaultJevConfig,
  loadJevConfig,
  stripSecrets,
  JEV_REDACTED,
} from '../src/jev/config'
import { clampJevSeverity, clampProbability } from '../src/jev/types'

let cleanupDirs: string[] = []

function makeTempDir(): string {
  const dir = nodeFs.mkdtempSync(join(tmpdir(), 'jev-config-'))
  cleanupDirs.push(dir)
  return dir
}

afterAll(() => {
  const dirs = cleanupDirs
  cleanupDirs = []
  for (const dir of dirs) {
    nodeFs.rmSync(dir, { recursive: true, force: true })
  }
})

// Snapshot/restore every JEV_* env var so tests stay hermetic and do not
// leak overrides into each other (or pick up ambient CI values).
const savedJevEnv = new Map<string, string | undefined>()

function snapshotJevEnv(): void {
  savedJevEnv.clear()
  for (const key of Object.keys(process.env)) {
    if (key === 'JEV_CONFIG_PATH' || key.startsWith('JEV_')) {
      savedJevEnv.set(key, process.env[key])
    }
  }
}

function clearJevEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (key === 'JEV_CONFIG_PATH' || key.startsWith('JEV_')) {
      delete process.env[key]
    }
  }
  // Hermetic isolation: never fall back to the repo's real config/jev.json
  // (a local enabled file would leak into unit tests). Point at a
  // guaranteed-missing temp path so defaults-OFF apply unless env overrides.
  process.env.JEV_CONFIG_PATH = join(tmpdir(), `jev-test-missing-${process.pid}.json`)
}

function restoreJevEnv(): void {
  clearJevEnv()
  for (const [key, value] of savedJevEnv) {
    if (value !== undefined) process.env[key] = value
  }
  savedJevEnv.clear()
}

snapshotJevEnv()

afterEach(() => {
  restoreJevEnv()
  snapshotJevEnv()
})

describe('jev-config — defaults', () => {
  test('defaultJevConfig is disabled with exact built-in values', () => {
    clearJevEnv()
    const config = defaultJevConfig()
    expect(config.enabled).toBe(false)
    expect(config.model).toBe('typesafe-ai/jev')
    expect(config.timeoutMs).toBe(4000)
    expect(config.maxStateChars).toBe(20000)
    expect(config.zeroDataRetention).toBe(true)
    expect(config.thresholds).toEqual({
      severityMin: 0.7,
      severityUpgradeMin: 0.85,
      contractScoreMin: 2.5,
      verifiableMin: 0.7,
      riskyMin: 0.85,
      needsHumanMin: 0.75,
    })
    expect(config.budget).toEqual({
      maxCallsPerRun: 20,
      maxInputTokensPerRun: 200000,
    })
  })

  test('defaultJevConfig returns a fresh deep copy', () => {
    clearJevEnv()
    const a = defaultJevConfig()
    const b = defaultJevConfig()
    expect(a).toEqual(b)
    expect(a).not.toBe(b)
    expect(a.thresholds).not.toBe(b.thresholds)
    expect(a.budget).not.toBe(b.budget)
    a.thresholds.severityMin = 0.01
    expect(b.thresholds.severityMin).toBe(0.7)
  })
})

describe('jev-config — load', () => {
  test('missing file yields defaults via explicit temp path', () => {
    clearJevEnv()
    const dir = makeTempDir()
    const missing = join(dir, 'does-not-exist.json')
    expect(nodeFs.existsSync(missing)).toBe(false)
    const config = loadJevConfig(missing)
    expect(config).toEqual(defaultJevConfig())
  })

  test('partial file merges over defaults, unknown keys throw', () => {
    clearJevEnv()
    const dir = makeTempDir()
    const p = join(dir, 'partial.json')
    nodeFs.writeFileSync(p, JSON.stringify({ enabled: true }))
    const config = loadJevConfig(p)
    expect(config.enabled).toBe(true)
    expect(config.model).toBe('typesafe-ai/jev')
    expect(config.thresholds.severityMin).toBe(0.7)

    const bad = join(dir, 'bad.json')
    nodeFs.writeFileSync(bad, JSON.stringify({ bogus: true }))
    expect(() => loadJevConfig(bad)).toThrow(/unknown config key/)
  })
})

describe('jev-config — env and per-run precedence', () => {
  test('JEV_ENABLED=1 enables a config that defaults to off', () => {
    clearJevEnv()
    const dir = makeTempDir()
    const missing = join(dir, 'does-not-exist.json')
    process.env.JEV_ENABLED = '1'
    const config = loadJevConfig(missing)
    expect(config.enabled).toBe(true)
  })

  test('per-run override wins over env', () => {
    clearJevEnv()
    const dir = makeTempDir()
    const missing = join(dir, 'does-not-exist.json')

    // Env turns it on, per-run turns it back off.
    process.env.JEV_ENABLED = '1'
    expect(loadJevConfig(missing, { enabled: false }).enabled).toBe(false)

    // Env off (or unset), per-run turns it on.
    process.env.JEV_ENABLED = '0'
    expect(loadJevConfig(missing, { enabled: true }).enabled).toBe(true)

    // No env, per-run alone decides.
    delete process.env.JEV_ENABLED
    expect(loadJevConfig(missing).enabled).toBe(false)
    expect(loadJevConfig(missing, { enabled: true }).enabled).toBe(true)
  })
})

describe('jev-config — stripSecrets', () => {
  test('redacts api_key/token/secret/password/authorization variants', () => {
    const input = {
      api_key: 'shh-1',
      apiKey: 'shh-2',
      'API-KEY': 'shh-3',
      token: 'shh-4',
      'auth-token': 'shh-5',
      clientSecret: 'shh-6',
      SECRET_VALUE: 'shh-7',
      dbPassword: 'shh-8',
      password: 'shh-9',
      Authorization: 'Bearer xyz',
      authorization: 'Bearer xyz',
      nested: { token: 'shh-10', public: 'visible' },
      list: [{ secret: 'shh-11', ok: 'visible' }],
      safe: 'visible',
    }
    const out = stripSecrets(input)
    expect(out.api_key).toBe(JEV_REDACTED)
    expect(out.apiKey).toBe(JEV_REDACTED)
    expect(out['API-KEY']).toBe(JEV_REDACTED)
    expect(out.token).toBe(JEV_REDACTED)
    expect(out['auth-token']).toBe(JEV_REDACTED)
    expect(out.clientSecret).toBe(JEV_REDACTED)
    expect(out.SECRET_VALUE).toBe(JEV_REDACTED)
    expect(out.dbPassword).toBe(JEV_REDACTED)
    expect(out.password).toBe(JEV_REDACTED)
    expect(out.Authorization).toBe(JEV_REDACTED)
    expect(out.authorization).toBe(JEV_REDACTED)
    expect(out.nested.token).toBe(JEV_REDACTED)
    expect(out.nested.public).toBe('visible')
    expect(out.list[0].secret).toBe(JEV_REDACTED)
    expect(out.list[0].ok).toBe('visible')
    expect(out.safe).toBe('visible')
  })

  test('replaces the whole subtree of a sensitive key', () => {
    const out = stripSecrets({ api_key: { nested: 'deep', deeper: { x: 1 } } })
    expect(out.api_key).toBe(JEV_REDACTED)
  })

  test('truncates long strings with a marker', () => {
    const long = 'x'.repeat(2500)
    const out = stripSecrets({ note: long })
    expect(typeof out.note).toBe('string')
    expect(out.note.length).toBeLessThan(long.length)
    expect(out.note).toContain('...[truncated')
    expect(out.note.startsWith('x'.repeat(10))).toBe(true)

    const custom = stripSecrets({ note: 'abcdefghij' }, 5)
    expect(custom.note).toBe('abcde...[truncated 5 chars]')
  })

  test('does not mutate the input', () => {
    const input = {
      api_key: 'original-secret',
      nested: { token: 'original-token', public: 'visible' },
      note: 'y'.repeat(100),
    }
    const snapshot = JSON.parse(JSON.stringify(input)) as typeof input
    const out = stripSecrets(input, 10)
    expect(input).toEqual(snapshot)
    expect(input.api_key).toBe('original-secret')
    expect(input.nested.token).toBe('original-token')
    // Fresh containers, not the same references.
    expect(out).not.toBe(input)
    expect(out.nested).not.toBe(input.nested)
    // Redaction applied only to the clone.
    expect(out.api_key).toBe(JEV_REDACTED)
  })
})

describe('jev-config — clamp helpers', () => {
  test('clampJevSeverity passes valid levels and falls back to info', () => {
    expect(clampJevSeverity('info')).toBe('info')
    expect(clampJevSeverity('low')).toBe('low')
    expect(clampJevSeverity('medium')).toBe('medium')
    expect(clampJevSeverity('high')).toBe('high')
    expect(clampJevSeverity('critical')).toBe('critical')
    expect(clampJevSeverity('urgent')).toBe('info')
    expect(clampJevSeverity('INFO')).toBe('info')
    expect(clampJevSeverity('')).toBe('info')
    expect(clampJevSeverity(null)).toBe('info')
    expect(clampJevSeverity(undefined)).toBe('info')
    expect(clampJevSeverity(42)).toBe('info')
  })

  test('clampProbability coerces into [0, 1]', () => {
    expect(clampProbability(0.5)).toBe(0.5)
    expect(clampProbability(0)).toBe(0)
    expect(clampProbability(1)).toBe(1)
    expect(clampProbability(-1)).toBe(0)
    expect(clampProbability(2)).toBe(1)
    expect(clampProbability('0.7')).toBe(0.7)
    expect(clampProbability(NaN)).toBe(0)
    expect(clampProbability(Infinity)).toBe(0)
    expect(clampProbability(null)).toBe(0)
    expect(clampProbability(undefined)).toBe(0)
    expect(clampProbability('nope')).toBe(0)
  })
})

describe('jev-config — ZDR opt-out (hobby plan)', () => {
  test('validateJevConfig honours explicit zeroDataRetention:false when enabled', async () => {
    clearJevEnv()
    const { validateJevConfig } = await import('../src/jev/config')
    const cfg = validateJevConfig({ enabled: true, zeroDataRetention: false })
    expect(cfg.enabled).toBe(true)
    expect(cfg.zeroDataRetention).toBe(false)
  })

  test('loadJevConfig honours file zeroDataRetention:false + env', async () => {
    clearJevEnv()
    const { loadJevConfig } = await import('../src/jev/config')
    const dir = makeTempDir()
    const { writeFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const fp = join(dir, 'jev.json')
    writeFileSync(fp, JSON.stringify({ enabled: true, zeroDataRetention: false }))
    const cfg = loadJevConfig(fp)
    expect(cfg.enabled).toBe(true)
    expect(cfg.zeroDataRetention).toBe(false)
  })

  test('defaults keep zeroDataRetention:true', async () => {
    clearJevEnv()
    const { defaultJevConfig } = await import('../src/jev/config')
    expect(defaultJevConfig().zeroDataRetention).toBe(true)
  })
})
