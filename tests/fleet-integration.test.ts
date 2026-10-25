// Cross-cutting integration tests: the assembled fleet feature behaves as
// ONE system across its three entry points — the durable config layer
// (`src/fleet-config`), the models/agents CLI (`src/cli-models`), and the
// dashboard REST API (`src/fleet-ui`). Every group points all entry points
// at a single temp-dir config via FLEET_CONFIG_PATH. Fully offline and
// deterministic: scored-selection expectations derive from the static
// suitability table in `src/model-router`.

import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import * as nodeFs from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AGENT_ROLES, MODEL_ROLE_SLOTS } from '../src/types'
import {
  FLEET_CONFIG_ENV_VAR,
  buildModelRegistry,
  emptyFleetConfig,
  loadFleetConfig,
  saveFleetConfig,
  selectFleetModel,
} from '../src/fleet-config'
import type { FleetConfig } from '../src/fleet-config'
import { createModelRegistry } from '../src/model-router'
import { parseModelsArgs, runAgentsCommand, runModelsCommand } from '../src/cli-models'
import { startFleetUiServer } from '../src/fleet-ui/server'
import type { FleetView } from '../src/fleet-ui/server'

const PRO_REF = 'opencode/deepseek-v4-pro'
const FLASH_REF = 'opencode/deepseek-v4-flash'
const KIMI_REF = 'opencode/kimi-k3'
const LUNA_REF = 'opencode/gpt-5.6-luna'
const STEP_FLASH_REF = 'vercel/stepfun/step-3.7-flash'
const GHOST_REF = 'ghost/model'
const TITAN_REF = 'acme/titan'
const ECHO_REF = 'acme/echo'
const ORACLE_REF = 'acme/oracle'

let cleanupDirs: string[] = []

function makeTempDir(): string {
  const dir = nodeFs.mkdtempSync(join(tmpdir(), 'fleet-integration-'))
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

interface ApiResult {
  status: number
  body: any
}

async function call(base: string, method: string, path: string, body?: unknown): Promise<ApiResult> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let parsed: any = null
  try {
    parsed = text.length > 0 ? JSON.parse(text) : null
  } catch {
    parsed = text
  }
  return { status: res.status, body: parsed }
}

async function getFleet(base: string): Promise<FleetView> {
  const res = await call(base, 'GET', '/api/fleet')
  expect(res.status).toBe(200)
  return res.body as FleetView
}

// --- Group 1: offline E2E flow (config layer only) ---

describe('fleet integration — offline config lifecycle', () => {
  let dir: string
  let configPath: string

  /**
   * Extras: titan (enabled, architecture specialist, default variant) and
   * echo (disabled, huge fast-triage score — must never be selected).
   * Overrides: architect -> titan (beats its slot default); critic ->
   * disabled flash (dead override, must fall through to scoring).
   */
  const SEED: FleetConfig = {
    models: {
      [FLASH_REF]: { enabled: false },
      [ECHO_REF]: { enabled: false },
      [TITAN_REF]: { enabled: true },
    },
    extraModels: {
      [TITAN_REF]: {
        providerId: 'acme',
        modelId: 'titan',
        modelFamily: 'titan',
        variant: 'max',
        roleSuitability: { architecture: 0.97 },
        toolSupport: true,
        imageSupport: false,
        contextLimit: 1000000,
        costPer1kTokens: null,
        fallbackChain: [PRO_REF],
      },
      [ECHO_REF]: {
        providerId: 'acme',
        modelId: 'echo',
        modelFamily: 'acme',
        roleSuitability: { 'fast-triage': 0.99 },
        toolSupport: true,
        imageSupport: false,
        contextLimit: 64000,
        costPer1kTokens: null,
      },
    },
    agentOverrides: {
      architect: { modelRef: TITAN_REF },
      critic: { modelRef: FLASH_REF },
    },
    slotDefaults: {
      architecture: { modelRef: KIMI_REF },
      testing: { modelRef: PRO_REF },
    },
    steps: { coder: 33 },
  }

  beforeAll(() => {
    dir = makeTempDir()
    configPath = join(dir, 'models.json')
    process.env[FLEET_CONFIG_ENV_VAR] = configPath
  })

  afterAll(() => {
    delete process.env[FLEET_CONFIG_ENV_VAR]
  })

  it('save → load → buildModelRegistry merges extras and flags over the builtin catalog', () => {
    saveFleetConfig(configPath, SEED)
    // Loading with no explicit path resolves through FLEET_CONFIG_PATH.
    const loaded = loadFleetConfig()
    expect(loaded).toEqual(SEED)

    const reg = buildModelRegistry(loaded)
    expect(Object.keys(reg).sort()).toEqual(
      [...Object.keys(createModelRegistry()), ECHO_REF, TITAN_REF].sort(),
    )

    const titan = reg[TITAN_REF]
    expect(titan.modelFamily).toBe('titan')
    expect(titan.contextLimit).toBe(1000000)
    expect(titan.fallbackChain).toEqual([PRO_REF])
    expect(titan.enabled).toBe(true)
    expect(titan.healthy).toBe(true)
    expect(titan.lastHealthCheck).toBeNull()
    expect(titan.circuitBreakerOpen).toBe(false)
    expect(titan.consecutiveFailures).toBe(0)

    expect(reg[ECHO_REF]?.enabled).toBe(false)
    expect(reg[FLASH_REF]?.enabled).toBe(false)
    expect(reg[KIMI_REF]?.enabled).toBeUndefined() // absent flag = enabled
  })

  it('selection honors role override > slot default > scored; disabled models excluded everywhere', () => {
    const cfg = loadFleetConfig()
    const reg = buildModelRegistry(cfg)

    // Role override wins and inherits the extra's default variant...
    const architect = selectFleetModel(reg, cfg, 'architect')
    expect(architect).toMatchObject({
      key: TITAN_REF,
      providerId: 'acme',
      modelId: 'titan',
      variant: 'max',
    })
    // ...even though architect's own slot default names a different model.
    expect(cfg.slotDefaults.architecture?.modelRef).toBe(KIMI_REF)

    // Slot default beats scoring: step-flash outscores pro on testing
    // (0.75 vs 0.65) yet the persisted slot default prevails — for every
    // role mapped to that slot.
    expect(selectFleetModel(reg, cfg, 'test-engineer')?.key).toBe(PRO_REF)
    expect(selectFleetModel(reg, cfg, 'build-verifier')?.key).toBe(PRO_REF)

    // No override at all -> scored best among ENABLED candidates only
    // (flash 0.95 and echo 0.99 on fast-triage are disabled; step-flash 0.85 leads).
    expect(selectFleetModel(reg, cfg, 'conductor')?.key).toBe(STEP_FLASH_REF)

    // Dead override (critic -> disabled flash) falls through to scoring: luna leads critique.
    expect(selectFleetModel(reg, cfg, 'critic')?.key).toBe(LUNA_REF)

    // Disabled refs are unreachable for every role.
    for (const role of AGENT_ROLES) {
      const picked = selectFleetModel(reg, cfg, role)
      expect(picked).not.toBeNull()
      expect(picked?.key === FLASH_REF || picked?.key === ECHO_REF).toBe(false)
    }
  })

  it('steps override persists through a full save/load cycle without disturbing other sections', () => {
    const cfg = loadFleetConfig()
    expect(cfg.steps?.coder).toBe(33)

    const bumped = JSON.parse(JSON.stringify(cfg)) as FleetConfig
    bumped.steps = { coder: 77, 'test-engineer': 5 }
    saveFleetConfig(configPath, bumped)

    const reloaded = loadFleetConfig()
    expect(reloaded.steps).toEqual({ coder: 77, 'test-engineer': 5 })
    expect(reloaded.models).toEqual(cfg.models)
    expect(reloaded.extraModels).toEqual(cfg.extraModels)
    expect(reloaded.agentOverrides).toEqual(cfg.agentOverrides)
    expect(reloaded.slotDefaults).toEqual(cfg.slotDefaults)

    // Selection keeps working off the reloaded config.
    expect(selectFleetModel(buildModelRegistry(reloaded), reloaded, 'architect')?.key).toBe(TITAN_REF)
  })
})

// --- Group 2: UI server E2E on an ephemeral port ---

describe('fleet integration — UI server E2E', () => {
  let dir: string
  let configPath: string
  let base = ''
  let running: ReturnType<typeof startFleetUiServer>

  beforeAll(() => {
    dir = makeTempDir()
    configPath = join(dir, 'models.json')
    nodeFs.writeFileSync(
      configPath,
      JSON.stringify({
        models: {},
        extraModels: {
          [ORACLE_REF]: {
            providerId: 'acme',
            modelId: 'oracle',
            modelFamily: 'oracle',
            variant: 'max',
            roleSuitability: { architecture: 0.97 },
            toolSupport: true,
            imageSupport: false,
            contextLimit: 900000,
            costPer1kTokens: null,
          },
        },
        agentOverrides: { architect: { modelRef: ORACLE_REF, variant: 'max' } },
        slotDefaults: {},
        steps: { coder: 33 },
      }),
    )
    process.env[FLEET_CONFIG_ENV_VAR] = configPath
    running = startFleetUiServer({ port: 0 })
    base = `http://127.0.0.1:${running.port}`
  })

  afterAll(() => {
    if (running) running.server.stop(true)
    delete process.env[FLEET_CONFIG_ENV_VAR]
  })

  it('GET /api/fleet reflects seeded extras and roles incl. stepsOverride, agreeing with the core selector', async () => {
    const view = await getFleet(base)
    expect(view.configPath).toBe(configPath)

    expect(view.models.map((m) => m.id).sort()).toEqual(
      [...Object.keys(createModelRegistry()), ORACLE_REF].sort(),
    )
    const oracle = view.models.find((m) => m.id === ORACLE_REF)
    expect(oracle).toBeTruthy()
    expect(oracle?.family).toBe('oracle')
    expect(oracle?.variant).toBe('max')
    expect(oracle?.enabled).toBe(true)

    expect(Object.keys(view.roles).sort()).toEqual([...AGENT_ROLES].sort())
    for (const role of AGENT_ROLES) {
      expect('stepsOverride' in view.roles[role]).toBe(true)
      expect(['role-override', 'slot-default', 'scored']).toContain(view.roles[role].source)
    }
    expect(view.roles.architect.source).toBe('role-override')
    expect(view.roles.architect.effective).toMatchObject({ key: ORACLE_REF, variant: 'max' })
    expect(view.roles.architect.roleOverride).toEqual({ modelRef: ORACLE_REF, variant: 'max' })
    expect(view.roles.coder.stepsOverride).toBe(33)
    expect(view.roles.conductor.stepsOverride).toBeNull()

    expect(view.slots.map((s) => s.slot).sort()).toEqual([...MODEL_ROLE_SLOTS].sort())
    expect(view.slots.every((s) => s.override === null)).toBe(true)

    // HTTP layer and core engine agree on every role's effective assignment.
    const cfg = loadFleetConfig()
    const reg = buildModelRegistry(cfg)
    for (const role of AGENT_ROLES) {
      const expected = selectFleetModel(reg, cfg, role)?.key ?? null
      expect(view.roles[role].effective?.key ?? null).toBe(expected)
    }
  })

  it('enable/disable round-trip survives a server restart by reloading from disk', async () => {
    let res = await call(base, 'PUT', `/api/fleet/models/${encodeURIComponent(ORACLE_REF)}/enabled`, {
      enabled: false,
    })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ id: ORACLE_REF, enabled: false })
    expect(loadFleetConfig().models[ORACLE_REF]).toEqual({ enabled: false })

    let view = await getFleet(base)
    expect(view.models.find((m) => m.id === ORACLE_REF)?.enabled).toBe(false)
    // Disabled target kills the architect role override -> scored fallback (pro).
    expect(view.roles.architect.source).toBe('scored')
    expect(view.roles.architect.effective?.key).toBe(PRO_REF)

    // "Restart": kill the process-equivalent and boot a fresh server.
    running.server.stop(true)
    running = startFleetUiServer({ port: 0 })
    base = `http://127.0.0.1:${running.port}`

    view = await getFleet(base)
    expect(view.models.find((m) => m.id === ORACLE_REF)?.enabled).toBe(false)
    expect(view.roles.architect.source).toBe('scored')
    expect(view.roles.architect.effective?.key).toBe(PRO_REF)

    // Round-trip back to enabled restores the override.
    res = await call(base, 'PUT', `/api/fleet/models/${encodeURIComponent(ORACLE_REF)}/enabled`, {
      enabled: true,
    })
    expect(res.status).toBe(200)
    expect(loadFleetConfig().models[ORACLE_REF]).toEqual({ enabled: true })
    view = await getFleet(base)
    expect(view.roles.architect.source).toBe('role-override')
    expect(view.roles.architect.effective?.key).toBe(ORACLE_REF)
  })

  it('PUT roles {model, steps} then {model: null, steps: null} reverts cleanly on API and disk', async () => {
    let res = await call(base, 'PUT', '/api/fleet/roles/critic', { model: KIMI_REF, steps: 21 })
    expect(res.status).toBe(200)
    expect(res.body.source).toBe('role-override')
    expect(res.body.effective).toMatchObject({ key: KIMI_REF })
    expect(res.body.stepsOverride).toBe(21)
    expect(res.body.roleOverride).toEqual({ modelRef: KIMI_REF })

    let disk = loadFleetConfig()
    expect(disk.agentOverrides.critic).toEqual({ modelRef: KIMI_REF })
    expect(disk.steps?.critic).toBe(21)

    res = await call(base, 'PUT', '/api/fleet/roles/critic', { model: null, steps: null })
    expect(res.status).toBe(200)
    expect(res.body.source).toBe('scored')
    expect(res.body.effective?.key).toBe(LUNA_REF) // scored critique leader
    expect(res.body.roleOverride).toBeNull()
    expect(res.body.stepsOverride).toBeNull()

    disk = loadFleetConfig()
    expect(disk.agentOverrides.critic).toBeUndefined()
    expect(disk.steps?.critic).toBeUndefined()
  })

  it('validation rejections (unknown ref -> 400, unknown role/slot -> 404) leave the config file byte-identical', async () => {
    const snapshot = nodeFs.readFileSync(configPath, 'utf8')

    // Unknown model ref in a role patch -> 400.
    const badRoleModel = await call(base, 'PUT', '/api/fleet/roles/architect', { model: GHOST_REF })
    expect(badRoleModel.status).toBe(400)
    expect(String(badRoleModel.body.error)).toContain(GHOST_REF)

    // Unknown model ref in a slot patch -> 400.
    expect((await call(base, 'PUT', '/api/fleet/slots/testing', { model: GHOST_REF })).status).toBe(400)

    // Unknown role / slot -> 404.
    expect((await call(base, 'PUT', '/api/fleet/roles/wizard', { model: LUNA_REF })).status).toBe(404)
    expect((await call(base, 'PUT', '/api/fleet/slots/warp-speed', { model: null })).status).toBe(404)

    // Unknown model ref in the enabled-toggle URL -> 404.
    expect(
      (
        await call(base, 'PUT', `/api/fleet/models/${encodeURIComponent(GHOST_REF)}/enabled`, {
          enabled: true,
        })
      ).status,
    ).toBe(404)

    // Out-of-range steps -> 400.
    expect((await call(base, 'PUT', '/api/fleet/roles/architect', { steps: 0 })).status).toBe(400)

    // Nothing above touched the persisted file — nor the live view.
    expect(nodeFs.readFileSync(configPath, 'utf8')).toBe(snapshot)
    expect(await getFleet(base)).toBeTruthy()
  })
})

// --- Group 3: CLI ↔ UI parity through one config file ---

describe('fleet integration — CLI/UI parity', () => {
  let dir: string
  let configPath: string
  let base = ''
  let running: ReturnType<typeof startFleetUiServer>

  beforeAll(() => {
    dir = makeTempDir()
    configPath = join(dir, 'models.json')
    saveFleetConfig(configPath, emptyFleetConfig())
    process.env[FLEET_CONFIG_ENV_VAR] = configPath
    running = startFleetUiServer({ port: 0 })
    base = `http://127.0.0.1:${running.port}`
  })

  afterAll(() => {
    if (running) running.server.stop(true)
    delete process.env[FLEET_CONFIG_ENV_VAR]
  })

  it('an unknown model ref is rejected by BOTH entry points; neither ever persists', async () => {
    const snapshot = nodeFs.readFileSync(configPath, 'utf8')

    // The CLI parser is syntactic only — validation sits below BOTH entry points.
    expect(parseModelsArgs(['set', 'coder', GHOST_REF]).ok).toBe(true)

    const cliSet = runModelsCommand({ action: 'set', role: 'coder', model: GHOST_REF })
    expect(cliSet.ok).toBe(false)
    if (!cliSet.ok) expect(cliSet.error).toContain(`unknown model '${GHOST_REF}'`)
    expect(nodeFs.readFileSync(configPath, 'utf8')).toBe(snapshot)

    const cliDisable = runModelsCommand({ action: 'disable', model: GHOST_REF })
    expect(cliDisable.ok).toBe(false)
    expect(nodeFs.readFileSync(configPath, 'utf8')).toBe(snapshot)

    const uiRole = await call(base, 'PUT', '/api/fleet/roles/coder', { model: GHOST_REF })
    expect(uiRole.status).toBe(400)
    expect(String(uiRole.body.error)).toContain(GHOST_REF)

    const uiSlot = await call(base, 'PUT', '/api/fleet/slots/testing', { model: GHOST_REF })
    expect(uiSlot.status).toBe(400)

    // Consistent semantics: every refusal above left the file byte-identical.
    expect(nodeFs.readFileSync(configPath, 'utf8')).toBe(snapshot)
  })

  it('cross-entrypoint flow: CLI writes surface via UI, UI writes surface via CLI, core agrees', async () => {
    // Restart so the UI reloads before external (CLI) mutations.
    running.server.stop(true)
    expect(runModelsCommand({ action: 'set', role: 'coder', model: KIMI_REF }).ok).toBe(true)
    expect(runAgentsCommand({ action: 'set-steps', role: 'coder', steps: 44 }).ok).toBe(true)
    const disk = loadFleetConfig()
    expect(disk.agentOverrides.coder).toEqual({ modelRef: KIMI_REF })
    expect(disk.steps?.coder).toBe(44)

    // CLI -> UI: a fresh server surfaces the CLI-written state.
    running = startFleetUiServer({ port: 0 })
    base = `http://127.0.0.1:${running.port}`
    const view = await getFleet(base)
    expect(view.roles.coder.source).toBe('role-override')
    expect(view.roles.coder.effective?.key).toBe(KIMI_REF)
    expect(view.roles.coder.stepsOverride).toBe(44)

    // Core selector agrees with what the CLI wrote.
    const cfg = loadFleetConfig()
    expect(selectFleetModel(buildModelRegistry(cfg), cfg, 'coder')?.key).toBe(KIMI_REF)

    // UI -> CLI: an API mutation is immediately visible to a fresh CLI invocation.
    const put = await call(base, 'PUT', '/api/fleet/roles/build-verifier', { model: LUNA_REF })
    expect(put.status).toBe(200)
    const listing = runModelsCommand({ action: 'list' })
    expect(listing.ok).toBe(true)
    if (!listing.ok) return
    const text = listing.value.join('\n')
    expect(text).toMatch(/coder\s+implementation\s+opencode\/kimi-k3\s+-\s+role-override\s+44/)
    expect(text).toMatch(/build-verifier\s+testing\s+opencode\/gpt-5\.6-luna\s+-\s+role-override/)
  })
})
