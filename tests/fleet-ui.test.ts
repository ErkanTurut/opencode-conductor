// Tests for the fleet dashboard server (`src/fleet-ui`).
//
// Spins up the real Bun.serve app on an ephemeral port against a temp
// config dir (via FLEET_CONFIG_PATH) and exercises the REST API over
// HTTP: GET round-trip, mutations + persistence, restart survival,
// and 400/404 error paths. Fully offline.

import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import * as nodeFs from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AGENT_ROLES, MODEL_ROLE_SLOTS } from '../src/types'
import { FLEET_CONFIG_ENV_VAR, loadFleetConfig } from '../src/fleet-config'
import { createModelRegistry } from '../src/model-router'
import {
  DEFAULT_FLEET_UI_PORT,
  FLEET_UI_PORT_ENV_VAR,
  resolveFleetUiPort,
  startFleetUiServer,
} from '../src/fleet-ui/server'
import type { FleetView } from '../src/fleet-ui/server'

const GROK_REF = 'vercel/xai/grok-4.5'
const FLASH_REF = 'opencode/deepseek-v4-flash'
const KIMI_REF = 'opencode/kimi-k3'
const LUNA_REF = 'opencode/gpt-5.6-luna'

let cleanupDirs: string[] = []

function makeTempDir(): string {
  const dir = nodeFs.mkdtempSync(join(tmpdir(), 'fleet-ui-'))
  cleanupDirs.push(dir)
  return dir
}

interface ApiResult {
  status: number
  body: any
}

async function call(
  base: string,
  method: string,
  path: string,
  body?: unknown,
  rawBody?: string,
): Promise<ApiResult> {
  const hasBody = body !== undefined || rawBody !== undefined
  const res = await fetch(`${base}${path}`, {
    method,
    headers: hasBody ? { 'content-type': 'application/json' } : undefined,
    body: rawBody !== undefined ? rawBody : body !== undefined ? JSON.stringify(body) : undefined,
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

/** Initial config file: one extra model, an architect override, coder steps. */
function writeFixtureConfig(path: string): void {
  nodeFs.writeFileSync(
    path,
    JSON.stringify(
      {
        models: {},
        extraModels: {
          [GROK_REF]: {
            providerId: 'vercel',
            modelId: 'xai/grok-4.5',
            modelFamily: 'grok',
            variant: 'high',
            roleSuitability: { architecture: 0.95, implementation: 0.94, critique: 0.7 },
            toolSupport: true,
            imageSupport: false,
            contextLimit: 500000,
            costPer1kTokens: 0.002,
            fallbackChain: [LUNA_REF],
          },
        },
        agentOverrides: { architect: { modelRef: GROK_REF, variant: 'high' } },
        slotDefaults: {},
        steps: { coder: 40 },
      },
      null,
      2,
    ),
  )
}

async function getFleet(base: string): Promise<FleetView> {
  const res = await call(base, 'GET', '/api/fleet')
  expect(res.status).toBe(200)
  return res.body as FleetView
}

// --- Suite 1: API surface, mutations, errors ---

describe('fleet-ui server', () => {
  let dir: string
  let configPath: string
  let base = ''
  let running: ReturnType<typeof startFleetUiServer>

  beforeAll(() => {
    dir = makeTempDir()
    configPath = join(dir, 'models.json')
    writeFixtureConfig(configPath)
    process.env[FLEET_CONFIG_ENV_VAR] = configPath
    running = startFleetUiServer({ port: 0 })
    base = `http://127.0.0.1:${running.port}`
  })

  afterAll(() => {
    running.server.stop(true)
    delete process.env[FLEET_CONFIG_ENV_VAR]
  })

  it('binds to loopback only on an ephemeral port', () => {
    expect(running.hostname).toBe('127.0.0.1')
    expect(running.port).toBeGreaterThan(0)
  })

  it('serves the dashboard HTML at /', async () => {
    const res = await fetch(`${base}/`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    const html = await res.text()
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('/api/fleet')
    expect(html).toContain('Agent Roles')
  })

  it('GET /api/fleet round-trips catalog, roles, slots, and circuit state', async () => {
    const view = await getFleet(base)

    // Catalog: every builtin plus the configured extra.
    const expectedRefs = [...Object.keys(createModelRegistry()), GROK_REF].sort()
    expect(view.models.map((m) => m.id).sort()).toEqual(expectedRefs)

    for (const model of view.models) {
      expect(typeof model.contextLimit).toBe('number')
      expect(typeof model.costPer1kTokens === 'number' || model.costPer1kTokens === null).toBe(true)
      expect(typeof model.roleSuitability).toBe('object')
      expect(typeof model.enabled).toBe('boolean')
      expect(typeof model.healthy).toBe('boolean')
      expect(typeof model.circuitBreakerOpen).toBe('boolean')
      expect(typeof model.consecutiveFailures).toBe('number')
    }

    const grok = view.models.find((m) => m.id === GROK_REF)
    expect(grok?.family).toBe('grok')
    expect(grok?.variant).toBe('high')

    // All 13 agent roles present.
    expect(Object.keys(view.roles).sort()).toEqual([...AGENT_ROLES].sort())
    for (const role of AGENT_ROLES) {
      expect((MODEL_ROLE_SLOTS as readonly string[]).includes(view.roles[role].slot)).toBe(true)
      expect(['role-override', 'slot-default', 'scored']).toContain(view.roles[role].source)
      expect(view.roles[role].roleOverride ?? null).not.toBe(undefined)
      expect(view.roles[role].stepsOverride ?? null).not.toBe(undefined)
    }

    // Fixture overrides surface with correct precedence source.
    expect(view.roles.architect.source).toBe('role-override')
    expect(view.roles.architect.effective?.key).toBe(GROK_REF)
    expect(view.roles.architect.effective?.variant).toBe('high')
    expect(view.roles.architect.roleOverride).toEqual({ modelRef: GROK_REF, variant: 'high' })
    expect(view.roles.conductor.source).toBe('scored')
    expect(view.roles.coder.stepsOverride).toBe(40)
    expect(view.roles.critic.stepsOverride).toBeNull()

    // Slots fully enumerated, none overridden initially.
    expect(view.slots.map((s) => s.slot).sort()).toEqual([...MODEL_ROLE_SLOTS].sort())
    expect(view.slots.every((s) => s.override === null)).toBe(true)
  })

  it('enable/disable persists through the atomic save path', async () => {
    const put = await call(base, 'PUT', `/api/fleet/models/${GROK_REF}/enabled`, { enabled: false })
    expect(put.status).toBe(200)
    expect(put.body).toMatchObject({ id: GROK_REF, enabled: false })

    const onDisk = loadFleetConfig(configPath)
    expect(onDisk.models[GROK_REF]?.enabled).toBe(false)

    let view = await getFleet(base)
    expect(view.models.find((m) => m.id === GROK_REF)?.enabled).toBe(false)
    // Disabled override target is dead: architect falls back to scored selection.
    expect(view.roles.architect.source).toBe('scored')

    const back = await call(base, 'PUT', `/api/fleet/models/${GROK_REF}/enabled`, { enabled: true })
    expect(back.status).toBe(200)
    expect(loadFleetConfig(configPath).models[GROK_REF]?.enabled).toBe(true)

    view = await getFleet(base)
    expect(view.roles.architect.source).toBe('role-override')
  })

  it('role model set, steps set, steps clear, and model revert persist', async () => {
    // Set model override.
    let res = await call(base, 'PUT', '/api/fleet/roles/critic', { model: KIMI_REF })
    expect(res.status).toBe(200)
    expect(res.body.source).toBe('role-override')
    let disk = loadFleetConfig(configPath)
    expect(disk.agentOverrides.critic?.modelRef).toBe(KIMI_REF)

    // Steps override leaves the model override untouched.
    res = await call(base, 'PUT', '/api/fleet/roles/critic', { steps: 25 })
    expect(res.status).toBe(200)
    expect(res.body.stepsOverride).toBe(25)
    expect(res.body.roleOverride).toEqual({ modelRef: KIMI_REF })
    disk = loadFleetConfig(configPath)
    expect(disk.steps?.critic).toBe(25)
    expect(disk.agentOverrides.critic?.modelRef).toBe(KIMI_REF)

    // Clearing steps keeps the model override.
    res = await call(base, 'PUT', '/api/fleet/roles/critic', { steps: null })
    expect(res.status).toBe(200)
    expect(res.body.stepsOverride).toBeNull()
    disk = loadFleetConfig(configPath)
    expect(disk.steps?.critic).toBeUndefined()
    expect(disk.agentOverrides.critic?.modelRef).toBe(KIMI_REF)

    // Reverting the model drops the whole override.
    res = await call(base, 'PUT', '/api/fleet/roles/critic', { model: null })
    expect(res.status).toBe(200)
    expect(res.body.source).toBe('scored')
    disk = loadFleetConfig(configPath)
    expect(disk.agentOverrides.critic).toBeUndefined()
  })

  it('slot default persists and surfaces as slot-default source for its roles', async () => {
    const res = await call(base, 'PUT', '/api/fleet/slots/security', { model: LUNA_REF })
    expect(res.status).toBe(200)
    expect(res.body.override).toEqual({ modelRef: LUNA_REF })
    expect(loadFleetConfig(configPath).slotDefaults.security?.modelRef).toBe(LUNA_REF)

    let view = await getFleet(base)
    expect(view.slots.find((s) => s.slot === 'security')?.override).toEqual({
      modelRef: LUNA_REF,
    })
    // security-critic has no role override -> resolves via slot default.
    expect(view.roles['security-critic'].source).toBe('slot-default')
    expect(view.roles['security-critic'].effective?.key).toBe(LUNA_REF)
    expect(view.roles['security-critic'].slotDefault).toEqual({ modelRef: LUNA_REF })

    const clear = await call(base, 'PUT', '/api/fleet/slots/security', { model: null })
    expect(clear.status).toBe(200)
    expect(clear.body.override).toBeNull()
    expect(loadFleetConfig(configPath).slotDefaults.security).toBeUndefined()

    view = await getFleet(base)
    expect(view.roles['security-critic'].source).toBe('scored')
  })

  it('rejects invalid payloads with 400 and unknown refs with 404, persisting nothing', async () => {
    const snapshotBefore = nodeFs.readFileSync(configPath, 'utf8')

    // Unknown model ref in URL -> 404.
    expect((await call(base, 'PUT', '/api/fleet/models/opencode/nope/enabled', { enabled: true })).status).toBe(404)

    // Bad bodies -> 400.
    expect(
      (await call(base, 'PUT', `/api/fleet/models/${LUNA_REF}/enabled`, { enabled: 'yes' })).status,
    ).toBe(400)
    expect(
      (await call(base, 'PUT', `/api/fleet/models/${LUNA_REF}/enabled`, {})).status,
    ).toBe(400)
    const broken = await call(
      base,
      'PUT',
      `/api/fleet/models/${LUNA_REF}/enabled`,
      undefined,
      '{not json',
    )
    expect(broken.status).toBe(400)
    expect(String(broken.body.error)).toContain('JSON')

    // Unknown role -> 404; unknown model in role body -> 400.
    expect((await call(base, 'PUT', '/api/fleet/roles/not-a-role', { model: LUNA_REF })).status).toBe(404)
    const badModel = await call(base, 'PUT', '/api/fleet/roles/architect', { model: 'ghost/model' })
    expect(badModel.status).toBe(400)
    expect(String(badModel.body.error)).toContain('ghost/model')

    // Out-of-range / fractional steps -> 400.
    expect((await call(base, 'PUT', '/api/fleet/roles/architect', { steps: 0 })).status).toBe(400)
    expect((await call(base, 'PUT', '/api/fleet/roles/architect', { steps: 10001 })).status).toBe(400)
    expect((await call(base, 'PUT', '/api/fleet/roles/architect', { steps: 3.5 })).status).toBe(400)
    expect((await call(base, 'PUT', '/api/fleet/roles/architect', { variant: 'bad token!' })).status).toBe(400)

    // Unknown slot -> 404; unknown model in slot body -> 400.
    expect((await call(base, 'PUT', '/api/fleet/slots/bogus-slot', { model: null })).status).toBe(404)
    expect((await call(base, 'PUT', '/api/fleet/slots/security', { model: 'ghost/model' })).status).toBe(400)
    expect((await call(base, 'PUT', '/api/fleet/slots/security', {})).status).toBe(400)

    // Unknown GET route -> 404.
    expect((await call(base, 'GET', '/api/nope')).status).toBe(404)
    expect((await call(base, 'POST', '/api/fleet/roles/architect', {})).status).toBe(405)

    // Nothing above may have touched the persisted config.
    expect(nodeFs.readFileSync(configPath, 'utf8')).toBe(snapshotBefore)
    expect(await getFleet(base)).toBeTruthy()
  })

  it('preserves an existing variant on model-only saves (merge semantics)', async () => {
    // Fixture state: architect override is { modelRef: GROK_REF, variant: 'high' }.
    let res = await call(base, 'PUT', '/api/fleet/roles/architect', { model: GROK_REF })
    expect(res.status).toBe(200)
    expect(res.body.roleOverride).toEqual({ modelRef: GROK_REF, variant: 'high' })
    expect(loadFleetConfig(configPath).agentOverrides.architect).toEqual({
      modelRef: GROK_REF,
      variant: 'high',
    })
    const view = await getFleet(base)
    expect(view.roles.architect.effective?.variant).toBe('high')

    // Explicit variant wins over the preserved one.
    res = await call(base, 'PUT', '/api/fleet/roles/architect', { model: KIMI_REF, variant: 'max' })
    expect(res.status).toBe(200)
    expect(res.body.roleOverride).toEqual({ modelRef: KIMI_REF, variant: 'max' })

    // Variant-only update on an existing override keeps the modelRef.
    res = await call(base, 'PUT', '/api/fleet/roles/architect', { variant: 'ultra' })
    expect(res.status).toBe(200)
    expect(res.body.roleOverride).toEqual({ modelRef: KIMI_REF, variant: 'ultra' })
    expect(loadFleetConfig(configPath).agentOverrides.architect).toEqual({
      modelRef: KIMI_REF,
      variant: 'ultra',
    })

    // Explicit variant:null clears the variant but keeps the model.
    res = await call(base, 'PUT', '/api/fleet/roles/architect', { variant: null })
    expect(res.status).toBe(200)
    expect(res.body.roleOverride).toEqual({ modelRef: KIMI_REF })
    expect(loadFleetConfig(configPath).agentOverrides.architect).toEqual({ modelRef: KIMI_REF })
  })

  it('rejects a variant on a role without an existing override (400, nothing persisted)', async () => {
    // critic has no override left after the earlier revert test.
    const snapshot = nodeFs.readFileSync(configPath, 'utf8')
    const res = await call(base, 'PUT', '/api/fleet/roles/critic', { variant: 'y' })
    expect(res.status).toBe(400)
    expect(String(res.body.error)).toContain('requires an existing model override')
    expect(nodeFs.readFileSync(configPath, 'utf8')).toBe(snapshot)
  })

  it('rejects a hostile Host header with 403 and persists nothing', async () => {
    const snapshot = nodeFs.readFileSync(configPath, 'utf8')
    const res = await fetch(`${base}/api/fleet`, { headers: { host: 'evil.example' } })
    expect(res.status).toBe(403)
    const body: any = await res.json()
    expect(String(body.error)).toContain('not allowed')
    expect(nodeFs.readFileSync(configPath, 'utf8')).toBe(snapshot)

    // The loopback aliases for the bound port stay allowed.
    const ok = await fetch(`${base}/api/health`, {
      headers: { host: `localhost:${running.port}` },
    })
    expect(ok.status).toBe(200)
  })

  it('answers OPTIONS with 204 and no CORS headers', async () => {
    const res = await fetch(`${base}/api/fleet`, { method: 'OPTIONS' })
    expect(res.status).toBe(204)
    expect(await res.text()).toBe('')
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })
})

// --- Suite 2: restart survival ---

describe('fleet-ui restart persistence', () => {
  let dir: string
  let configPath: string
  let base = ''
  let running: ReturnType<typeof startFleetUiServer>

  beforeAll(async () => {
    dir = makeTempDir()
    configPath = join(dir, 'models.json')
    writeFixtureConfig(configPath)
    process.env[FLEET_CONFIG_ENV_VAR] = configPath
    running = startFleetUiServer({ port: 0 })
    base = `http://127.0.0.1:${running.port}`

    // Mutate through the API, then kill the server.
    expect(
      (await call(base, 'PUT', `/api/fleet/models/${FLASH_REF}/enabled`, { enabled: false })).status,
    ).toBe(200)
    expect(
      (
        await call(base, 'PUT', '/api/fleet/roles/scout', {
          model: KIMI_REF,
          variant: 'max',
          steps: 9,
        })
      ).status,
    ).toBe(200)
    expect(
      (await call(base, 'PUT', '/api/fleet/slots/integration', { model: LUNA_REF })).status,
    ).toBe(200)
    running.server.stop(true)
  })

  afterAll(() => {
    if (running) running.server.stop(true)
    delete process.env[FLEET_CONFIG_ENV_VAR]
  })

  it('mutations survive a full server restart by reloading from disk', async () => {
    running = startFleetUiServer({ port: 0 })
    base = `http://127.0.0.1:${running.port}`
    expect(running.port).not.toBeFalsy()

    const view = await getFleet(base)
    expect(view.models.find((m) => m.id === FLASH_REF)?.enabled).toBe(false)
    expect(view.roles.scout.source).toBe('role-override')
    expect(view.roles.scout.effective?.key).toBe(KIMI_REF)
    expect(view.roles.scout.effective?.variant).toBe('max')
    expect(view.roles.scout.stepsOverride).toBe(9)
    expect(view.slots.find((s) => s.slot === 'integration')?.override).toEqual({ modelRef: LUNA_REF })
    // Integrator maps to the integration slot -> slot-default source.
    expect(view.roles.integrator.source).toBe('slot-default')

    // And the raw config on disk agrees.
    const disk = loadFleetConfig(configPath)
    expect(disk.models[FLASH_REF]?.enabled).toBe(false)
    expect(disk.agentOverrides.scout).toEqual({ modelRef: KIMI_REF, variant: 'max' })
    expect(disk.steps?.scout).toBe(9)
    expect(disk.slotDefaults.integration).toEqual({ modelRef: LUNA_REF })
  })
})

// --- Suite 3: port resolution ---

describe('fleet-ui port resolution', () => {
  it('prefers --port flag over env over default', () => {
    expect(resolveFleetUiPort(['--port', '5555'], undefined)).toBe(5555)
    expect(resolveFleetUiPort(['--port=8888'], '7777')).toBe(8888)
    expect(resolveFleetUiPort([], '7777')).toBe(7777)
    expect(resolveFleetUiPort(['other', 'args'], undefined)).toBe(DEFAULT_FLEET_UI_PORT)
    expect(DEFAULT_FLEET_UI_PORT).toBe(4649)
  })

  it('falls back gracefully on invalid values', () => {
    expect(resolveFleetUiPort(['--port', 'abc'], undefined)).toBe(DEFAULT_FLEET_UI_PORT)
    expect(resolveFleetUiPort(['--port=0'], undefined)).toBe(DEFAULT_FLEET_UI_PORT)
    expect(resolveFleetUiPort(['--port', '99999'], undefined)).toBe(DEFAULT_FLEET_UI_PORT)
    expect(resolveFleetUiPort(['--port', '-1'], 'not-a-number')).toBe(DEFAULT_FLEET_UI_PORT)
  })

  it('exposes the env var name used by the runtime', () => {
    expect(FLEET_UI_PORT_ENV_VAR).toBe('FLEET_UI_PORT')
  })
})
