import { describe, test, expect, afterAll, afterEach } from 'bun:test'
import * as nodeFs from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  getEnvCaseInsensitive,
  getGatewayApiKey,
  isJevEnabled,
  loadJevConfig,
  resolveJevConfigPath,
} from '../src/jev/config'

let cleanupDirs: string[] = []

function makeTempDir(): string {
  const dir = nodeFs.mkdtempSync(join(tmpdir(), 'jev-env-case-'))
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

const TRACKED_KEYS = [
  'JEV_ENABLED',
  'jev_enabled',
  'JEV_MODEL',
  'jev_model',
  'JEV_TIMEOUT_MS',
  'jev_timeout_ms',
  'JEV_MAX_STATE_CHARS',
  'jev_max_state_chars',
  'JEV_RISKY_THRESHOLD',
  'jev_risky_threshold',
  'JEV_RISKY_MIN_THRESHOLD',
  'jev_risky_min_threshold',
  'JEV_NEEDS_HUMAN_THRESHOLD',
  'jev_needs_human_threshold',
  'JEV_ZERO_DATA_RETENTION',
  'jev_zero_data_retention',
  'JEV_CONFIG_PATH',
  'jev_config_path',
  'JEV_CONFIG_PATH_LOWER_SENTINEL',
  'AI_GATEWAY_API_KEY',
  'ai_gateway_api_key',
]

const savedEnv = new Map<string, string | undefined>()

function snapshotEnv(): void {
  savedEnv.clear()
  for (const key of TRACKED_KEYS) {
    savedEnv.set(key, process.env[key])
  }
  // Also capture any ambient JEV_*/jev_* keys not in the tracked list.
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('JEV_') || key.startsWith('jev_')) {
      if (!savedEnv.has(key)) savedEnv.set(key, process.env[key])
    }
  }
}

function clearEnv(): void {
  for (const key of TRACKED_KEYS) {
    delete process.env[key]
  }
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('JEV_') || key.startsWith('jev_')) {
      delete process.env[key]
    }
  }
  delete process.env['AI_GATEWAY_API_KEY']
  delete process.env['ai_gateway_api_key']
}

function restoreEnv(): void {
  clearEnv()
  for (const [key, value] of savedEnv) {
    if (value !== undefined) process.env[key] = value
  }
  savedEnv.clear()
}

snapshotEnv()

afterEach(() => {
  restoreEnv()
  snapshotEnv()
})

describe('jev-env-case — getEnvCaseInsensitive', () => {
  test('uppercase exact value wins when both cases are set', () => {
    clearEnv()
    process.env['JEV_ENABLED'] = '0'
    process.env['jev_enabled'] = '1'
    expect(getEnvCaseInsensitive('JEV_ENABLED')).toBe('0')
  })

  test('lowercase fallback is used when uppercase is unset', () => {
    clearEnv()
    process.env['jev_enabled'] = '1'
    expect(getEnvCaseInsensitive('JEV_ENABLED')).toBe('1')
  })

  test('uppercase exact is used when only uppercase is set', () => {
    clearEnv()
    process.env['JEV_ENABLED'] = '1'
    expect(getEnvCaseInsensitive('JEV_ENABLED')).toBe('1')
  })

  test('returns undefined when neither case is set', () => {
    clearEnv()
    expect(getEnvCaseInsensitive('JEV_ENABLED')).toBeUndefined()
  })
})

describe('jev-env-case — enabled via either case', () => {
  test('JEV_ENABLED=1 enables', () => {
    clearEnv()
    const dir = makeTempDir()
    const missing = join(dir, 'does-not-exist.json')
    process.env.JEV_ENABLED = '1'
    expect(loadJevConfig(missing).enabled).toBe(true)
  })

  test('jev_enabled=true enables identically', () => {
    clearEnv()
    const dir = makeTempDir()
    const missing = join(dir, 'does-not-exist.json')
    process.env['jev_enabled'] = 'true'
    expect(loadJevConfig(missing).enabled).toBe(true)
  })

  test('mixed-case values are parsed identically', () => {
    clearEnv()
    const dir = makeTempDir()
    const missing = join(dir, 'does-not-exist.json')
    process.env.JEV_ENABLED = 'TrUe'
    expect(loadJevConfig(missing).enabled).toBe(true)
    clearEnv()
    process.env['jev_enabled'] = 'YeS'
    expect(loadJevConfig(missing).enabled).toBe(true)
  })

  test('uppercase wins on conflict', () => {
    clearEnv()
    const dir = makeTempDir()
    const missing = join(dir, 'does-not-exist.json')
    process.env.JEV_ENABLED = '0'
    process.env['jev_enabled'] = '1'
    expect(loadJevConfig(missing).enabled).toBe(false)
    clearEnv()
    process.env.JEV_ENABLED = '1'
    process.env['jev_enabled'] = '0'
    expect(loadJevConfig(missing).enabled).toBe(true)
  })

  test('ZDR opt-out honoured via lowercase when explicitly false', () => {
    clearEnv()
    const dir = makeTempDir()
    const missing = join(dir, 'does-not-exist.json')
    process.env['jev_enabled'] = 'true'
    process.env['jev_zero_data_retention'] = 'false'
    const config = loadJevConfig(missing)
    expect(config.enabled).toBe(true)
    expect(config.zeroDataRetention).toBe(false)
  })

  test('isJevEnabled sees lowercase env', () => {
    clearEnv()
    process.env['jev_enabled'] = 'true'
    // Point config resolution at a missing file via lowercase path override
    // so the ambient repo config cannot interfere.
    const dir = makeTempDir()
    const missing = join(dir, 'does-not-exist.json')
    process.env['jev_config_path'] = missing
    expect(isJevEnabled()).toBe(true)
    expect(isJevEnabled(true)).toBe(true)
    expect(isJevEnabled(false)).toBe(false)
  })
})

describe('jev-env-case — other JEV_* keys are case-insensitive', () => {
  test('lowercase model and numeric keys apply', () => {
    clearEnv()
    const dir = makeTempDir()
    const missing = join(dir, 'does-not-exist.json')
    process.env['jev_enabled'] = '1'
    process.env['jev_model'] = 'typesafe-ai/jev'
    process.env['jev_timeout_ms'] = '7777'
    process.env['jev_risky_threshold'] = '0.5'
    const config = loadJevConfig(missing)
    expect(config.model).toBe('typesafe-ai/jev')
    expect(config.timeoutMs).toBe(7777)
    expect(config.thresholds.riskyMin).toBe(0.5)
  })

  test('lowercase config path override resolves', () => {
    clearEnv()
    const dir = makeTempDir()
    const target = join(dir, 'custom.json')
    nodeFs.writeFileSync(target, JSON.stringify({ enabled: true }))
    process.env['jev_config_path'] = target
    expect(resolveJevConfigPath()).toBe(target)
  })

  test('uppercase config path still wins over lowercase', () => {
    clearEnv()
    const dir = makeTempDir()
    const upper = join(dir, 'upper.json')
    const lower = join(dir, 'lower.json')
    nodeFs.writeFileSync(upper, JSON.stringify({ enabled: true }))
    nodeFs.writeFileSync(lower, JSON.stringify({ enabled: false }))
    process.env.JEV_CONFIG_PATH = upper
    process.env['jev_config_path'] = lower
    expect(resolveJevConfigPath()).toBe(upper)
  })
})

describe('jev-env-case — gateway key fallback', () => {
  test('lowercase ai_gateway_api_key is accepted', () => {
    clearEnv()
    process.env['ai_gateway_api_key'] = 'lower-key'
    expect(getGatewayApiKey()).toBe('lower-key')
  })

  test('uppercase AI_GATEWAY_API_KEY wins over lowercase', () => {
    clearEnv()
    process.env.AI_GATEWAY_API_KEY = 'upper-key'
    process.env['ai_gateway_api_key'] = 'lower-key'
    expect(getGatewayApiKey()).toBe('upper-key')
  })

  test('returns undefined when neither is set', () => {
    clearEnv()
    expect(getGatewayApiKey()).toBeUndefined()
  })
})
