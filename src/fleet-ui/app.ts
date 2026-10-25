// Fleet dashboard HTTP layer.
//
// A dependency-free Bun.serve app that exposes the fleet configuration
// (see `../fleet-config`) as a small REST API plus a single-page vanilla
// HTML dashboard at `/`. All mutations go through `saveFleetConfig()` so
// they survive restarts, and every mutation validates its payload BEFORE
// touching either disk or in-memory state.

import { AGENT_ROLES, MODEL_ROLE_SLOTS } from '../types'
import type { AgentRole, ModelRoleSlot } from '../types'
import {
  MAX_STEPS_PER_ROLE,
  MIN_STEPS_PER_ROLE,
  buildModelRegistry,
  loadFleetConfig,
  resolveFleetConfigPath,
  saveFleetConfig,
  selectFleetModel,
} from '../fleet-config'
import type { FleetConfig, FleetModelOverride } from '../fleet-config'
import { roleToSlot } from '../model-router'
import type { ModelEntry, ModelRegistry } from '../model-router'
import { DASHBOARD_HTML } from './dashboard'

// --- Public view shapes ---

export interface FleetEffectiveModel {
  /** Registry key (`provider/model`). */
  key: string
  providerId: string
  modelId: string
  variant?: string
}

export type FleetAssignmentSource = 'role-override' | 'slot-default' | 'scored'

export interface FleetModelView {
  id: string
  providerId: string
  modelId: string
  family: string
  contextLimit: number
  costPer1kTokens: number | null
  roleSuitability: Partial<Record<ModelRoleSlot, number>>
  toolSupport: boolean
  imageSupport: boolean
  enabled: boolean
  variant?: string
  healthy: boolean
  circuitBreakerOpen: boolean
  consecutiveFailures: number
}

export interface FleetRoleView {
  role: AgentRole
  slot: ModelRoleSlot
  effective: FleetEffectiveModel | null
  source: FleetAssignmentSource
  roleOverride: FleetModelOverride | null
  stepsOverride: number | null
  slotDefault: FleetModelOverride | null
}

export interface FleetSlotView {
  slot: ModelRoleSlot
  override: FleetModelOverride | null
}

export interface FleetView {
  configPath: string
  models: FleetModelView[]
  roles: Record<AgentRole, FleetRoleView>
  slots: FleetSlotView[]
}

// --- Errors ---

/** HTTP-mapped error carrying a status code and a client-safe message. */
class HttpError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'HttpError'
    this.status = status
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function describeValue(value: unknown): string {
  try {
    const text = JSON.stringify(value)
    return text === undefined ? String(value) : text.length > 80 ? `${text.slice(0, 77)}...` : text
  } catch {
    return String(value)
  }
}

// --- Payload validation (throws HttpError; nothing persisted on failure) ---

const VARIANT_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

interface RolePatch {
  model?: string | null
  /** Absent = leave untouched; null = explicit clear; string = set. */
  variant?: string | null
  steps?: number | null
}

interface SlotPatch {
  model: string | null
  variant?: string
}

function parseVariant(value: unknown): string {
  if (typeof value !== 'string' || !VARIANT_TOKEN.test(value)) {
    throw new HttpError(
      400,
      `"variant" must be a token matching ${VARIANT_TOKEN} (got ${describeValue(value)})`,
    )
  }
  return value
}

function parseEnabledBody(body: Record<string, unknown>): boolean {
  if (typeof body.enabled !== 'boolean') {
    throw new HttpError(
      400,
      `"enabled" must be a boolean (got ${describeValue(body.enabled)})`,
    )
  }
  return body.enabled
}

function parseRolePatch(body: Record<string, unknown>, knownRefs: Set<string>): RolePatch {
  const patch: RolePatch = {}

  if (body.model !== undefined) {
    if (body.model === null) {
      patch.model = null
    } else if (typeof body.model === 'string' && body.model.length > 0) {
      if (!knownRefs.has(body.model)) {
        throw new HttpError(
          400,
          `unknown model '${body.model}' — "model" must reference a catalog model or be null`,
        )
      }
      patch.model = body.model
    } else {
      throw new HttpError(
        400,
        `"model" must be a non-empty string or null (got ${describeValue(body.model)})`,
      )
    }
  }

  if (body.variant !== undefined) {
    patch.variant = body.variant === null ? null : parseVariant(body.variant)
  }

  if (body.steps !== undefined) {
    if (body.steps === null) {
      patch.steps = null
    } else if (
      typeof body.steps === 'number' &&
      Number.isInteger(body.steps) &&
      body.steps >= MIN_STEPS_PER_ROLE &&
      body.steps <= MAX_STEPS_PER_ROLE
    ) {
      patch.steps = body.steps
    } else {
      throw new HttpError(
        400,
        `"steps" must be null or an integer between ${MIN_STEPS_PER_ROLE} and ${MAX_STEPS_PER_ROLE} (got ${describeValue(body.steps)})`,
      )
    }
  }

  return patch
}

function parseSlotPatch(body: Record<string, unknown>, knownRefs: Set<string>): SlotPatch {
  if (body.model === undefined) {
    throw new HttpError(400, '"model" is required (a model ref string, or null to clear)')
  }
  if (body.model === null) return { model: null }
  if (typeof body.model !== 'string' || body.model.length === 0) {
    throw new HttpError(
      400,
      `"model" must be a non-empty string or null (got ${describeValue(body.model)})`,
    )
  }
  if (!knownRefs.has(body.model)) {
    throw new HttpError(
      400,
      `unknown model '${body.model}' — "model" must reference a catalog model`,
    )
  }
  const patch: SlotPatch = { model: body.model }
  if (body.variant !== undefined) patch.variant = parseVariant(body.variant)
  return patch
}

// --- View builders (pure functions over config + registry) ---

function isSelectable(entry: ModelEntry | undefined): boolean {
  return !!entry && entry.enabled !== false && entry.healthy && !entry.circuitBreakerOpen
}

function overrideToEffective(
  registry: ModelRegistry,
  override: FleetModelOverride,
): FleetEffectiveModel {
  const entry = registry[override.modelRef]
  const fallbackVariant = entry?.variant
  const variant = override.variant ?? fallbackVariant
  return {
    key: override.modelRef,
    providerId: entry?.providerId ?? '',
    modelId: entry?.modelId ?? '',
    ...(variant !== undefined ? { variant } : {}),
  }
}

/**
 * Resolve a role's effective assignment with fleet precedence:
 * role override > slot default override > scored best. Mirrors the
 * dead-override handling inside `selectModel`.
 */
function resolveRoleAssignment(
  registry: ModelRegistry,
  config: FleetConfig,
  role: AgentRole,
): { effective: FleetEffectiveModel | null; source: FleetAssignmentSource } {
  const roleOverride = config.agentOverrides[role]
  if (roleOverride && isSelectable(registry[roleOverride.modelRef])) {
    return { effective: overrideToEffective(registry, roleOverride), source: 'role-override' }
  }
  const slotDefault = config.slotDefaults[roleToSlot(role)]
  if (slotDefault && isSelectable(registry[slotDefault.modelRef])) {
    return { effective: overrideToEffective(registry, slotDefault), source: 'slot-default' }
  }
  const scored = selectFleetModel(registry, config, role)
  if (!scored) return { effective: null, source: 'scored' }
  return {
    effective: {
      key: scored.key,
      providerId: scored.providerId,
      modelId: scored.modelId,
      ...(scored.variant !== undefined ? { variant: scored.variant } : {}),
    },
    source: 'scored',
  }
}

function toModelView(id: string, entry: ModelEntry): FleetModelView {
  return {
    id,
    providerId: entry.providerId,
    modelId: entry.modelId,
    family: entry.modelFamily,
    contextLimit: entry.contextLimit,
    costPer1kTokens: entry.costPer1kTokens,
    roleSuitability: { ...entry.roleSuitability },
    toolSupport: entry.toolSupport,
    imageSupport: entry.imageSupport,
    enabled: entry.enabled !== false,
    ...(entry.variant !== undefined ? { variant: entry.variant } : {}),
    healthy: entry.healthy,
    circuitBreakerOpen: entry.circuitBreakerOpen,
    consecutiveFailures: entry.consecutiveFailures,
  }
}

function toRoleView(registry: ModelRegistry, config: FleetConfig, role: AgentRole): FleetRoleView {
  const { effective, source } = resolveRoleAssignment(registry, config, role)
  return {
    role,
    slot: roleToSlot(role),
    effective,
    source,
    roleOverride: config.agentOverrides[role] ?? null,
    stepsOverride: config.steps?.[role] ?? null,
    slotDefault: config.slotDefaults[roleToSlot(role)] ?? null,
  }
}

// --- Route constants ---

const MODEL_ENABLED_PREFIX = '/api/fleet/models/'
const MODEL_ENABLED_SUFFIX = '/enabled'
const ROLE_PREFIX = '/api/fleet/roles/'
const SLOT_PREFIX = '/api/fleet/slots/'

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(`${JSON.stringify(data, null, 2)}\n`, {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

function safeDecodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    throw new HttpError(400, `malformed URL encoding in '${segment}'`)
  }
}

async function readJsonObject(req: Request): Promise<Record<string, unknown>> {
  let parsed: unknown
  try {
    parsed = await req.json()
  } catch {
    throw new HttpError(400, 'request body must be valid JSON')
  }
  if (!isPlainObject(parsed)) {
    throw new HttpError(400, 'request body must be a JSON object')
  }
  return parsed
}

// --- App factory ---

/** Default listen port when neither `--port` nor FLEET_UI_PORT is given. */
export const DEFAULT_FLEET_UI_PORT = 4649

export interface FleetUiOptions {
  /** Explicit config path; falls back to FLEET_CONFIG_PATH / package default. */
  configPath?: string
  /**
   * Port used for Host-header allowlisting before the real bind is known.
   * `startFleetUiServer` overwrites this with the actually bound port.
   */
  port?: number
}

export interface FleetUiApp {
  fetch(req: Request): Promise<Response>
  getView(): FleetView
  getConfigPath(): string
  /**
   * Pin the Host allowlist to the actually bound port (loopback only).
   * Must be called after Bun.serve() and before any request is handled —
   * guaranteed because both happen in one synchronous block.
   */
  setBoundPort(port: number): void
}

export function createFleetUiApp(options: FleetUiOptions = {}): FleetUiApp {
  const configPath = resolveFleetConfigPath(options.configPath)
  let config = loadFleetConfig(configPath)
  let registry = buildModelRegistry(config)
  let boundPort = options.port ?? DEFAULT_FLEET_UI_PORT

  const knownRefs = (): Set<string> => new Set(Object.keys(registry))

  const allowedHosts = (): string[] => [
    `127.0.0.1:${boundPort}`,
    `localhost:${boundPort}`,
  ]

  function currentView(): FleetView {
    const models = Object.entries(registry).map(([id, entry]) => toModelView(id, entry))
    const roles = {} as Record<AgentRole, FleetRoleView>
    for (const role of AGENT_ROLES) roles[role] = toRoleView(registry, config, role)
    const slots: FleetSlotView[] = MODEL_ROLE_SLOTS.map((slot) => ({
      slot,
      override: config.slotDefaults[slot] ?? null,
    }))
    return { configPath, models, roles, slots }
  }

  /**
   * Apply a mutation to a throwaway draft, persist it through the atomic
   * save path (which validates before writing anything), and only then
   * swap it into memory. Any failure leaves both disk and memory intact.
   */
  function applyDraft(mutate: (draft: FleetConfig) => void): void {
    const draft = JSON.parse(JSON.stringify(config)) as FleetConfig
    mutate(draft)
    saveFleetConfig(configPath, draft)
    config = draft
    registry = buildModelRegistry(draft)
  }

  function setModelEnabled(ref: string, body: Record<string, unknown>): Record<string, unknown> {
    if (!registry[ref]) throw new HttpError(404, `unknown model '${ref}'`)
    const enabled = parseEnabledBody(body)
    applyDraft((draft) => {
      draft.models[ref] = { enabled }
    })
    return { id: ref, enabled }
  }

  function setRole(role: string, body: Record<string, unknown>): FleetRoleView {
    if (!(AGENT_ROLES as readonly string[]).includes(role)) {
      throw new HttpError(404, `unknown agent role '${role}'`)
    }
    const patch = parseRolePatch(body, knownRefs())
    applyDraft((draft) => {
      const existing = draft.agentOverrides[role as AgentRole]
      if (patch.model === null) {
        delete draft.agentOverrides[role as AgentRole]
      } else if (typeof patch.model === 'string') {
        // Explicit variant wins; absent variant MERGES (preserves an
        // existing variant instead of wiping it); explicit null clears.
        const variant =
          patch.variant !== undefined
            ? patch.variant === null
              ? undefined
              : patch.variant
            : existing?.variant
        draft.agentOverrides[role as AgentRole] = {
          modelRef: patch.model,
          ...(variant !== undefined ? { variant } : {}),
        }
      } else if (patch.variant !== undefined && existing) {
        // Variant-only update on an existing override keeps the modelRef.
        draft.agentOverrides[role as AgentRole] =
          patch.variant === null
            ? { modelRef: existing.modelRef }
            : { ...existing, variant: patch.variant }
      } else if (patch.variant !== undefined && patch.variant !== null) {
        throw new HttpError(
          400,
          `"variant" requires an existing model override for role '${role}' — send "model" too`,
        )
      }
      if (patch.steps === null) {
        delete (draft.steps ??= {})[role as AgentRole]
      } else if (typeof patch.steps === 'number') {
        ;((draft.steps ??= {}))[role as AgentRole] = patch.steps
      }
    })
    return toRoleView(registry, config, role as AgentRole)
  }

  function setSlot(slot: string, body: Record<string, unknown>): FleetSlotView {
    if (!(MODEL_ROLE_SLOTS as readonly string[]).includes(slot)) {
      throw new HttpError(404, `unknown model slot '${slot}'`)
    }
    const patch = parseSlotPatch(body, knownRefs())
    applyDraft((draft) => {
      if (patch.model === null) {
        delete draft.slotDefaults[slot as ModelRoleSlot]
      } else {
        draft.slotDefaults[slot as ModelRoleSlot] =
          patch.variant !== undefined
            ? { modelRef: patch.model, variant: patch.variant }
            : { modelRef: patch.model }
      }
    })
    const typedSlot = slot as ModelRoleSlot
    return { slot: typedSlot, override: config.slotDefaults[typedSlot] ?? null }
  }

  async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url)
    const method = req.method.toUpperCase()
    const path = url.pathname

    // Host allowlist (DNS-rebinding guard), enforced before any routing.
    // A missing Host header is tolerated (direct handler invocation).
    const hostHeader = req.headers.get('host')
    if (hostHeader !== null && !allowedHosts().includes(hostHeader.trim().toLowerCase())) {
      return jsonResponse({ error: `host '${hostHeader}' not allowed` }, 403)
    }

    // Deterministic preflight refusal: 204 with no CORS headers.
    if (method === 'OPTIONS') {
      return new Response(null, { status: 204 })
    }

    if (method === 'GET') {
      if (path === '/' || path === '/index.html' || path === '/fleet') {
        return new Response(DASHBOARD_HTML, {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        })
      }
      if (path === '/api/fleet') return jsonResponse(currentView())
      if (path === '/api/health') return jsonResponse({ ok: true })
      return jsonResponse({ error: `no such endpoint: GET ${path}` }, 404)
    }

    if (path.startsWith('/api/fleet/')) {
      if (method !== 'PUT') {
        return jsonResponse({ error: `method ${method} not allowed; use PUT` }, 405)
      }
      if (
        path.startsWith(MODEL_ENABLED_PREFIX) &&
        path.endsWith(MODEL_ENABLED_SUFFIX) &&
        path.length > MODEL_ENABLED_PREFIX.length + MODEL_ENABLED_SUFFIX.length
      ) {
        const ref = safeDecodeSegment(
          path.slice(MODEL_ENABLED_PREFIX.length, path.length - MODEL_ENABLED_SUFFIX.length),
        )
        return jsonResponse(setModelEnabled(ref, await readJsonObject(req)))
      }
      const roleSegment = path.startsWith(ROLE_PREFIX) ? path.slice(ROLE_PREFIX.length) : ''
      if (roleSegment && !roleSegment.includes('/')) {
        return jsonResponse(setRole(safeDecodeSegment(roleSegment), await readJsonObject(req)))
      }
      const slotSegment = path.startsWith(SLOT_PREFIX) ? path.slice(SLOT_PREFIX.length) : ''
      if (slotSegment && !slotSegment.includes('/')) {
        return jsonResponse(setSlot(safeDecodeSegment(slotSegment), await readJsonObject(req)))
      }
      return jsonResponse({ error: `no such endpoint: PUT ${path}` }, 404)
    }

    if (path === '/api/fleet') {
      return jsonResponse({ error: `method ${method} not allowed; use GET` }, 405)
    }
    return jsonResponse({ error: `no such endpoint: ${method} ${path}` }, 404)
  }

  async function fetch(req: Request): Promise<Response> {
    try {
      return await handle(req)
    } catch (error) {
      if (error instanceof HttpError) {
        return jsonResponse({ error: error.message }, error.status)
      }
      return jsonResponse(
        { error: `internal error: ${error instanceof Error ? error.message : String(error)}` },
        500,
      )
    }
  }

  return {
    fetch,
    getView: currentView,
    getConfigPath: () => configPath,
    setBoundPort: (port: number) => {
      boundPort = port
    },
  }
}
