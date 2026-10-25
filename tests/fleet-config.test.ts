import { describe, it, expect, afterAll } from 'bun:test'
import * as nodeFs from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  emptyFleetConfig,
  loadFleetConfig,
  saveFleetConfig,
  validateFleetConfig,
  buildModelRegistry,
  selectFleetModel,
  resolveFleetConfigPath,
  FLEET_CONFIG_ENV_VAR,
} from '../src/fleet-config'
import type { FleetConfig } from '../src/fleet-config'
import { createModelRegistry, selectModel, selectFallbackModel, selectReviewerModel } from '../src/model-router'
import type { ModelEntry, ModelRegistry } from '../src/model-router'

let cleanupDirs: string[] = []

function makeTempDir(): string {
  const dir = nodeFs.mkdtempSync(join(tmpdir(), 'fleet-config-'))
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

const EMPTY_JSON = JSON.stringify(emptyFleetConfig())

function fixtureConfig(): FleetConfig {
  return {
    models: {
      'opencode/deepseek-v4-pro': { enabled: false },
      'vercel/xai/grok-4.5': { enabled: true },
    },
    extraModels: {
      'vercel/xai/grok-4.5': {
        providerId: 'vercel',
        modelId: 'xai/grok-4.5',
        modelFamily: 'grok',
        variant: 'high',
        roleSuitability: { architecture: 0.95, implementation: 0.94 },
        toolSupport: true,
        imageSupport: false,
        contextLimit: 500000,
        costPer1kTokens: null,
        fallbackChain: ['opencode/gpt-5.6-luna'],
      },
      'deepseek/test-mini': {
        providerId: 'deepseek',
        modelId: 'test-mini',
        modelFamily: 'deepseek',
        roleSuitability: { 'fast-triage': 0.99 },
        toolSupport: true,
        imageSupport: false,
        contextLimit: 128000,
        costPer1kTokens: 0.001,
      },
    },
    agentOverrides: {
      architect: { modelRef: 'vercel/xai/grok-4.5', variant: 'high' },
    },
    slotDefaults: {
      security: { modelRef: 'opencode/gpt-5.6-luna' },
    },
    steps: {
      coder: 40,
      critic: 12,
    },
  }
}

function selectReviewerTop(registry: ReturnType<typeof buildModelRegistry>) {
  const picked = selectReviewerModel(registry, 'deepseek')
  expect(picked).not.toBeNull()
  return picked!.key
}

// --- Path resolution ---

describe('fleet-config — path resolution', () => {
  it('defaults to <package>/config/models.json regardless of cwd', () => {
    delete process.env[FLEET_CONFIG_ENV_VAR]
    const p = resolveFleetConfigPath()
    expect(p.endsWith('config/models.json')).toBe(true)
    expect(p.startsWith('/')).toBe(true)
    expect(nodeFs.existsSync(p)).toBe(true)
  })

  it('prefers an explicit path over the env var', () => {
    process.env[FLEET_CONFIG_ENV_VAR] = '/from/env/models.json'
    try {
      expect(resolveFleetConfigPath('/explicit/models.json')).toBe(
        '/explicit/models.json',
      )
    } finally {
      delete process.env[FLEET_CONFIG_ENV_VAR]
    }
  })

  it('uses FLEET_CONFIG_PATH over the package default', () => {
    const dir = makeTempDir()
    const p = join(dir, 'custom.json')
    nodeFs.writeFileSync(
      p,
      JSON.stringify({
        models: { 'opencode/kimi-k3': { enabled: false } },
      }),
    )
    process.env[FLEET_CONFIG_ENV_VAR] = p
    try {
      const config = loadFleetConfig()
      expect(config.models['opencode/kimi-k3'].enabled).toBe(false)
    } finally {
      delete process.env[FLEET_CONFIG_ENV_VAR]
    }
  })
})

// --- Load ---

describe('fleet-config — load', () => {
  it('returns a valid empty default when the file is missing', () => {
    const dir = makeTempDir()
    const config = loadFleetConfig(join(dir, 'does-not-exist.json'))
    expect(config).toEqual(emptyFleetConfig())
    // Empty default merges to exactly the built-in catalog.
    expect(buildModelRegistry(config)).toEqual(createModelRegistry())
  })

  it('throws a descriptive error on malformed JSON', () => {
    const dir = makeTempDir()
    const p = join(dir, 'broken.json')
    nodeFs.writeFileSync(p, '{ "models": ')
    expect(() => loadFleetConfig(p)).toThrow(/not valid JSON/)
  })

  it('throws a descriptive error on schema violations', () => {
    const dir = makeTempDir()
    const p = join(dir, 'bad-schema.json')
    nodeFs.writeFileSync(p, JSON.stringify({ bogusSection: {} }))
    expect(() => loadFleetConfig(p)).toThrow(/unknown config section 'bogusSection'/)
  })
})

// --- Save ---

describe('fleet-config — save', () => {
  it('round-trips save/load preserving the logical config exactly', () => {
    const dir = makeTempDir()
    const p = join(dir, 'fleet.json')
    const config = fixtureConfig()

    saveFleetConfig(p, config)
    const loaded = loadFleetConfig(p)
    expect(loaded).toEqual(config)

    // Second round-trip through the loaded copy stays stable.
    saveFleetConfig(p, loaded)
    expect(loadFleetConfig(p)).toEqual(config)
  })

  it('writes pretty-printed JSON atomically via rename', () => {
    const dir = makeTempDir()
    const p = join(dir, 'fleet.json')
    nodeFs.writeFileSync(p, 'sentinel')

    saveFleetConfig(p, fixtureConfig())

    // Target was replaced (rename-over, not append).
    const raw = nodeFs.readFileSync(p, 'utf8')
    expect(raw.startsWith('{\n  "models"')).toBe(true)
    expect(raw.endsWith('\n')).toBe(true)
    expect(JSON.parse(raw)).toEqual(fixtureConfig())
    // No temp artifact left behind.
    expect(nodeFs.existsSync(`${p}.tmp`)).toBe(false)
  })

  it('leaves the existing file untouched when validation fails', () => {
    const dir = makeTempDir()
    const p = join(dir, 'fleet.json')
    nodeFs.writeFileSync(p, EMPTY_JSON)

    const invalid = fixtureConfig()
    invalid.agentOverrides.architect = {
      modelRef: 'ghost/nonexistent',
    }

    expect(() => saveFleetConfig(p, invalid)).toThrow(
      /unknown model ref 'ghost\/nonexistent'/,
    )
    expect(nodeFs.readFileSync(p, 'utf8')).toBe(EMPTY_JSON)
    expect(nodeFs.existsSync(`${p}.tmp`)).toBe(false)
  })
})

// --- Validation ---

describe('fleet-config — validation', () => {
  it('rejects unknown provider/model refs in enabled flags', () => {
    expect(() =>
      validateFleetConfig({
        models: { 'nosuch/provider': { enabled: true } },
      }),
    ).toThrow(/unknown model ref 'nosuch\/provider'/)
  })

  it('rejects unknown refs in agent overrides and slot defaults', () => {
    expect(() =>
      validateFleetConfig({
        agentOverrides: { coder: { modelRef: 'ghost/one' } },
      }),
    ).toThrow(/unknown model ref 'ghost\/one'/)
    expect(() =>
      validateFleetConfig({
        slotDefaults: { architecture: { modelRef: 'ghost/two' } },
      }),
    ).toThrow(/unknown model ref 'ghost\/two'/)
  })

  it('rejects unknown agent roles', () => {
    expect(() =>
      validateFleetConfig({
        agentOverrides: {
          'supreme commander': { modelRef: 'opencode/kimi-k3' },
        },
      }),
    ).toThrow(/unknown agent role 'supreme commander'/)
  })

  it('rejects unknown slots', () => {
    expect(() =>
      validateFleetConfig({
        slotDefaults: { turbo: { modelRef: 'opencode/kimi-k3' } },
      }),
    ).toThrow(/unknown slot 'turbo'/)
  })

  it('rejects invalid variants naming the offending value', () => {
    expect(() =>
      validateFleetConfig({
        agentOverrides: {
          coder: { modelRef: 'opencode/kimi-k3', variant: 'not a variant!' },
        },
      }),
    ).toThrow(/invalid variant 'not a variant!'/)

    expect(() =>
      validateFleetConfig({
        extraModels: {
          'vercel/bad-model': {
            providerId: 'vercel',
            modelId: 'bad-model',
            modelFamily: 'bad',
            variant: '',
            roleSuitability: {},
            toolSupport: true,
            imageSupport: false,
            contextLimit: 1000,
            costPer1kTokens: null,
          },
        },
      }),
    ).toThrow(/invalid variant ''/)
  })

  it('rejects malformed extra model entries', () => {
    expect(() =>
      validateFleetConfig({
        extraModels: {
          'vercel/mismatch': {
            providerId: 'vercel',
            modelId: 'other',
            modelFamily: 'x',
            roleSuitability: {},
            toolSupport: true,
            imageSupport: false,
            contextLimit: 1000,
            costPer1kTokens: null,
          },
        },
      }),
    ).toThrow(/does not match providerId\/modelId 'vercel\/other'/)

    expect(() =>
      validateFleetConfig({
        extraModels: {
          'vercel/mismatch': {
            providerId: 'vercel',
            modelId: 'mismatch',
            modelFamily: 'x',
            roleSuitability: { architecture: 1.5 },
            toolSupport: true,
            imageSupport: false,
            contextLimit: 1000,
            costPer1kTokens: null,
          },
        },
      }),
    ).toThrow(/roleSuitability\.architecture = 1\.5/)

    expect(() =>
      validateFleetConfig({
        extraModels: {
          'vercel/chained': {
            providerId: 'vercel',
            modelId: 'chained',
            modelFamily: 'x',
            roleSuitability: {},
            toolSupport: true,
            imageSupport: false,
            contextLimit: 1000,
            costPer1kTokens: null,
            fallbackChain: ['ghost/missing'],
          },
        },
      }),
    ).toThrow(/unknown model ref 'ghost\/missing'/)
  })
})

// --- Step limits ---

describe('fleet-config — per-role step limits', () => {
  it('round-trips a populated steps map exactly', () => {
    const dir = makeTempDir()
    const p = join(dir, 'steps.json')
    const config = fixtureConfig()

    saveFleetConfig(p, config)
    const loaded = loadFleetConfig(p)
    expect(loaded.steps).toEqual({ coder: 40, critic: 12 })
    expect(loadFleetConfig(p)).toEqual(config)
  })

  it('rejects unknown agent roles in steps', () => {
    expect(() =>
      validateFleetConfig({ steps: { boss: 10 } }),
    ).toThrow(/unknown agent role 'boss' in "steps"/)
  })

  it.each([0, -5, 2.5, 10001, 'many', null] as const)(
    'rejects invalid step limit %p naming the offending value',
    (value) => {
      expect(() =>
        validateFleetConfig({ steps: { coder: value } }),
      ).toThrow(new RegExp(`steps\\['coder'\\] = ${String(value)}`))
    },
  )

  it('accepts the inclusive bounds 1 and 10000', () => {
    const config = validateFleetConfig({
      steps: { coder: 1, critic: 10000 },
    })
    expect(config.steps).toEqual({ coder: 1, critic: 10000 })
  })

  it('defaults steps to an empty object when file or key is missing', () => {
    const dir = makeTempDir()

    // Missing file.
    expect(loadFleetConfig(join(dir, 'absent.json')).steps).toEqual({})
    expect(emptyFleetConfig().steps).toEqual({})

    // Existing file without the key.
    const p = join(dir, 'no-steps.json')
    nodeFs.writeFileSync(
      p,
      JSON.stringify({ models: { 'opencode/kimi-k3': { enabled: false } } }),
    )
    const loaded = loadFleetConfig(p)
    expect(loaded.steps).toEqual({})
    expect(loaded.models['opencode/kimi-k3'].enabled).toBe(false)

    // Round-trip of an empty steps map stays an empty map.
    saveFleetConfig(p, loaded)
    expect(loadFleetConfig(p).steps).toEqual({})
  })
})

// --- Merged view ---

describe('fleet-config — merged registry view', () => {
  it('appends extras with fresh runtime fields without mutating builtins', () => {
    const config = fixtureConfig()
    const merged = buildModelRegistry(config)

    // Built-in entries are identical to a pristine catalog, except those
    // with persisted enabled flags — they differ only by that flag.
    const pristine = createModelRegistry()
    const patchedRefs = new Set(Object.keys(config.models))
    for (const [ref, entry] of Object.entries(pristine)) {
      if (patchedRefs.has(ref)) continue
      expect(merged[ref]).toEqual(entry)
    }
    expect(merged['opencode/deepseek-v4-pro']).toEqual({
      ...pristine['opencode/deepseek-v4-pro'],
      enabled: false,
    })

    const grok = merged['vercel/xai/grok-4.5']
    expect(grok.modelFamily).toBe('grok')
    expect(grok.variant).toBe('high')
    expect(grok.roleSuitability.architecture).toBe(0.95)
    expect(grok.healthy).toBe(true)
    expect(grok.circuitBreakerOpen).toBe(false)
    expect(grok.consecutiveFailures).toBe(0)
    expect(grok.lastHealthCheck).toBeNull()
    expect(grok.fallbackChain).toEqual(['opencode/gpt-5.6-luna'])

    // Persisted enabled flags patch built-ins and extras alike.
    expect(merged['opencode/deepseek-v4-pro'].enabled).toBe(false)
    expect(merged['vercel/xai/grok-4.5'].enabled).toBe(true)
    expect(merged['opencode/kimi-k3'].enabled).toBeUndefined()
  })

  it('seeded package config loads and yields nine extra fleet models', () => {
    delete process.env[FLEET_CONFIG_ENV_VAR]
    const config = loadFleetConfig()
    const refs = Object.keys(config.extraModels).sort()
    expect(refs).toEqual([
      'deepseek/deepseek-v4-flash',
      // t6: agent frontmatter -free refs registered (registry of record).
      'opencode/deepseek-v4.1-flash-free',
      'opencode/glm-5.3-flash-free',
      'opencode/mimo-v2.6-flash-free',
      'opencode/muse-spark-1.3-contributor-free',
      'vercel/meta/muse-spark-1.2',
      'vercel/minimax/minimax-m3',
      'vercel/openai/gpt-5.6-luna',
      // Renamed upstream: xAI entries moved from vercel/xai to
      // vercel/spacexai; the route exposes no reasoning variants.
      'vercel/spacexai/grok-4.5',
    ])
    expect(config.extraModels['vercel/spacexai/grok-4.5'].variant).toBeUndefined()
    expect(config.extraModels['deepseek/deepseek-v4-flash'].variant).toBe('max')

    const merged = buildModelRegistry(config)
    expect(Object.keys(merged)).toHaveLength(
      Object.keys(createModelRegistry()).length + 9,
    )
  })
})

// --- Selection precedence ---

describe('fleet-config — override precedence', () => {
  function syntheticRegistry(): ModelRegistry {
    const entry = (
      impl: number,
      overrides: Partial<ModelEntry> = {},
    ): ModelEntry => ({
      providerId: 'm',
      modelId: 'x',
      modelFamily: 'fam',
      roleSuitability: { implementation: impl },
      toolSupport: true,
      imageSupport: false,
      contextLimit: 100000,
      costPer1kTokens: null,
      healthy: true,
      lastHealthCheck: null,
      fallbackChain: [],
      circuitBreakerOpen: false,
      consecutiveFailures: 0,
      ...overrides,
    })
    return {
      'm/scored-best': entry(0.9),
      'm/slot-pick': entry(0.7),
      'm/role-pick': entry(0.5),
      // Alive but never the top score — only reachable via overrides.
      'm/dead': entry(0.85),
    }
  }

  function syntheticConfig(overrides: Partial<FleetConfig>): FleetConfig {
    return { ...emptyFleetConfig(), ...overrides }
  }

  it('applies role override > slot default > scored best', () => {
    const registry = syntheticRegistry()

    // No overrides: plain scoring wins.
    let picked = selectFleetModel(registry, syntheticConfig({}), 'coder')
    expect(picked!.key).toBe('m/scored-best')

    // Slot default beats scoring.
    picked = selectFleetModel(
      registry,
      syntheticConfig({
        slotDefaults: { implementation: { modelRef: 'm/slot-pick' } },
      }),
      'coder',
    )
    expect(picked!.key).toBe('m/slot-pick')

    // Role override beats slot default.
    picked = selectFleetModel(
      registry,
      syntheticConfig({
        slotDefaults: { implementation: { modelRef: 'm/slot-pick' } },
        agentOverrides: { coder: { modelRef: 'm/role-pick' } },
      }),
      'coder',
    )
    expect(picked!.key).toBe('m/role-pick')
  })

  it('override variant wins over the model default variant', () => {
    const registry = syntheticRegistry()
    registry['m/role-pick'].variant = 'max'

    const picked = selectFleetModel(
      registry,
      syntheticConfig({
        agentOverrides: { coder: { modelRef: 'm/role-pick', variant: 'high' } },
      }),
      'coder',
    )
    expect(picked!.key).toBe('m/role-pick')
    expect(picked!.variant).toBe('high')

    // Without an explicit variant, the model default applies.
    const defaulted = selectFleetModel(
      registry,
      syntheticConfig({
        agentOverrides: { coder: { modelRef: 'm/role-pick' } },
      }),
      'coder',
    )
    expect(defaulted!.variant).toBe('max')
  })

  it.each(['disabled', 'unhealthy', 'circuit-open'] as const)(
    'falls back to normal selection when the role override target is %s',
    (mode) => {
      const registry = syntheticRegistry()
      if (mode === 'disabled') registry['m/dead'].enabled = false
      if (mode === 'unhealthy') registry['m/dead'].healthy = false
      if (mode === 'circuit-open') registry['m/dead'].circuitBreakerOpen = true

      // Dead role override -> slot default is honored.
      const picked = selectFleetModel(
        registry,
        syntheticConfig({
          agentOverrides: { coder: { modelRef: 'm/dead' } },
          slotDefaults: { implementation: { modelRef: 'm/slot-pick' } },
        }),
        'coder',
      )
      expect(picked!.key).toBe('m/slot-pick')

      // Dead role override and dead slot default -> scored best.
      registry['m/slot-pick'].enabled = false
      const scored = selectFleetModel(
        registry,
        syntheticConfig({
          agentOverrides: { coder: { modelRef: 'm/dead' } },
          slotDefaults: { implementation: { modelRef: 'm/slot-pick' } },
        }),
        'coder',
      )
      expect(scored!.key).toBe('m/scored-best')
    },
  )
})

// --- Disabled-model exclusion ---

describe('fleet-config — disabled model exclusion', () => {
  function registryWithDisabled(refs: string[]) {
    const models: FleetConfig['models'] = {}
    for (const ref of refs) models[ref] = { enabled: false }
    return buildModelRegistry({ ...emptyFleetConfig(), models })
  }

  it('excludes disabled models from selectModel pools', () => {
    const registry = registryWithDisabled([
      'opencode/kimi-k3',
      'opencode/deepseek-v4-pro',
    ])
    const picked = selectModel(registry, 'coder')
    // Best remaining implementation model after the two disabled ones.
    expect(picked!.key).toBe('vercel/alibaba/qwen3.8-max')
  })

  it('excludes disabled models from fallback chains', () => {
    const registry = registryWithDisabled(['opencode/deepseek-v4-pro'])
    // kimi-k3's chain starts with the disabled deepseek-v4-pro…
    const fallback = selectFallbackModel(registry, 'opencode/kimi-k3', 'coder')
    expect(fallback).not.toBeNull()
    expect(fallback!.key).toBe('opencode/gpt-5.6-luna')
  })

  it('excludes disabled models from reviewer selection', () => {
    const baseline = registryWithDisabled([])
    const top = selectReviewerTop(baseline)
    expect(top).toBe('opencode/gpt-5.6-luna')

    const registry = registryWithDisabled(['opencode/gpt-5.6-luna'])
    expect(selectReviewerTop(registry)).toBe('vercel/alibaba/qwen3.8-max')
  })

  it('never selects any disabled model across any role', () => {
    const disabled = [
      'opencode/kimi-k3',
      'vercel/xai/grok-4.5',
      'deepseek/deepseek-v4-flash',
    ]
    const registry = registryWithDisabled(disabled)
    const roles = [
      'conductor',
      'scout',
      'architect',
      'coder',
      'frontend-specialist',
      'test-engineer',
      'build-verifier',
      'critic',
      'security-critic',
      'integrator',
      'memory-curator',
      'requirements-refiner',
      'external-scout',
    ] as const

    for (const role of roles) {
      const picked = selectFleetModel(
        registry,
        emptyFleetConfig(),
        role,
      )
      if (picked) expect(disabled).not.toContain(picked.key)
    }
  })
})

describe('fleet-config — extra-model identity token validation', () => {
  const validExtra = {
    providerId: 'vercel',
    modelId: 'xai/grok-4.5',
    modelFamily: 'grok',
    roleSuitability: { architecture: 0.9 },
    toolSupport: true,
    imageSupport: false,
    contextLimit: 100000,
    costPer1kTokens: null,
  }

  it('accepts composite ids with internal slashes and dots', () => {
    expect(() =>
      validateFleetConfig({
        extraModels: { 'vercel/xai/grok-4.5': validExtra },
      }),
    ).not.toThrow()
  })

  it('rejects modelId containing control characters (e.g. newline)', () => {
    const config: FleetConfig = {
      models: {},
      extraModels: {
        'vercel/bad': { ...validExtra, providerId: 'vercel', modelId: 'bad\nmodel' },
      },
      agentOverrides: {},
      slotDefaults: {},
      steps: {},
    }
    expect(() => validateFleetConfig(config)).toThrow(/modelId/)
    expect(() => validateFleetConfig(config)).toThrow(/no whitespace or control characters/)
  })

  it('rejects whitespace in providerId and modelFamily', () => {
    expect(() =>
      validateFleetConfig({
        extraModels: {
          'white space/bad': { ...validExtra, providerId: 'white space' },
        },
      }),
    ).toThrow(/providerId/)
    expect(() =>
      validateFleetConfig({
        extraModels: {
          'p/bad': { ...validExtra, modelFamily: 'bad\nfamily' },
        },
      }),
    ).toThrow(/modelFamily/)
  })

  it('saveFleetConfig rejects a hostile id before writing anything', () => {
    const dir = makeTempDir()
    const target = join(dir, 'models.json')
    const config: FleetConfig = {
      models: {},
      extraModels: {
        'deepseek/test\nmini': {
          ...validExtra,
          providerId: 'deepseek',
          modelId: 'test\nmini',
        },
      },
      agentOverrides: {},
      slotDefaults: {},
      steps: {},
    }
    expect(() => saveFleetConfig(target, config)).toThrow(/modelId/)
    expect(nodeFs.existsSync(target)).toBe(false)
    expect(nodeFs.existsSync(`${target}.tmp`)).toBe(false)
  })
})
