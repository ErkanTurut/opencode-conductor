// Durable fleet configuration layer — the single authority for the model
// catalog that serves `AGENT_ROLES`.
//
// `config/models.json` is the registry of record: the built-in base catalog
// from `createModelRegistry()` is a curated minimum, and every fleet model
// pinned by `.opencode/agents/*.md` frontmatter must be registered here
// (extraModels) or the pin is drift. This module persists per-model enabled
// flags, extra catalog entries, per-agent-role model overrides, per-slot
// default overrides, and per-agent-role within-family fallback chains as plain
// JSON, then builds a merged ModelRegistry view. Nothing in this package may
// keep a second copy of the model list: add models to models.json instead.
// Plain TypeScript validation only — no deps.

import * as nodeFs from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { AGENT_ROLES, MODEL_ROLE_SLOTS } from './types'
import type { AgentRole, ModelRoleSlot } from './types'
import { createModelRegistry, attemptSelection, roleToSlot } from './model-router'
import type {
  ModelEntry,
  ModelRegistry,
  ModelOverride,
  SelectionAttempt,
  SelectionObserver,
} from './model-router'

export const FLEET_CONFIG_ENV_VAR = 'FLEET_CONFIG_PATH'
export const DEFAULT_FLEET_CONFIG_FILENAME = 'models.json'

/** Variants must look like simple reasoning-effort tokens ('high', 'max', ...). */
const VARIANT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/**
 * Token pattern for extra-model identity fields (providerId / modelId /
 * modelFamily): no whitespace or control characters; composite ids keep
 * their internal slashes.
 */
export const MODEL_ID_TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/

const CONFIG_SECTIONS = [
  'models',
  'extraModels',
  'fallbackChains',
  'agentOverrides',
  'slotDefaults',
  'steps',
] as const

/** Bounds for persisted per-role step limits. */
export const MIN_STEPS_PER_ROLE = 1
export const MAX_STEPS_PER_ROLE = 10000

// --- Public shape ---

export interface FleetEnabledFlag {
  enabled: boolean
}

export interface FleetModelOverride {
  /** Registry key (`provider/model`) — must exist in builtin ∪ extras. */
  modelRef: string
  variant?: string
}

export interface FleetExtraModel {
  providerId: string
  modelId: string
  modelFamily: string
  /** Default reasoning variant used when no override supplies one. */
  variant?: string
  roleSuitability: Partial<Record<ModelRoleSlot, number>>
  toolSupport: boolean
  imageSupport: boolean
  contextLimit: number
  costPer1kTokens: number | null
  /** Registry keys (`provider/model`) within builtin ∪ extras. */
  fallbackChain?: string[]
}

export interface FleetConfig {
  /** Persisted enabled/disabled flags keyed by model ref. Absent = enabled. */
  models: Record<string, FleetEnabledFlag>
  /** Additional catalog entries appended to the built-in registry. */
  extraModels: Record<string, FleetExtraModel>
  /**
   * Ordered within-family fallback rungs per agent role. Every ref in a chain
   * must resolve to the same model family: a chain is the sanctioned way to
   * serve a role from a sibling model, never a license to cross families.
   * Omitted section = no declared chains (scored selection applies).
   */
  fallbackChains?: Partial<Record<AgentRole, string[]>>
  /** Highest-precedence selection override per agent role. */
  agentOverrides: Partial<Record<AgentRole, FleetModelOverride>>
  /** Middle-precedence selection override per model role slot. */
  slotDefaults: Partial<Record<ModelRoleSlot, FleetModelOverride>>
  /**
   * Persisted per-agent-role step-limit overrides. Absent key = role
   * default applies; values are integers in [1, 10000].
   */
  steps?: Partial<Record<AgentRole, number>>
}

export type FleetSelection = {
  providerId: string
  modelId: string
  key: string
  variant?: string
} | null

export function emptyFleetConfig(): FleetConfig {
  return {
    models: {},
    extraModels: {},
    agentOverrides: {},
    slotDefaults: {},
    steps: {},
  }
}

/**
 * Resolve the fleet config path, independent of the current working
 * directory: explicit argument > `FLEET_CONFIG_PATH` env var >
 * `<package>/config/models.json` (via `import.meta.dir`).
 */
export function resolveFleetConfigPath(explicitPath?: string): string {
  const candidate =
    explicitPath?.trim() || process.env[FLEET_CONFIG_ENV_VAR]?.trim()
  if (candidate) return resolve(candidate)
  return resolve(join(import.meta.dir, '..', 'config', DEFAULT_FLEET_CONFIG_FILENAME))
}

export function getBuiltinModelRefs(): string[] {
  return Object.keys(createModelRegistry())
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isValidVariant(value: unknown): value is string {
  return typeof value === 'string' && VARIANT_PATTERN.test(value)
}

function assertValidVariant(value: unknown, where: string): void {
  if (!isValidVariant(value)) {
    throw new Error(
      `fleet-config: invalid variant '${String(value)}' ${where} (expected a non-empty token matching ${VARIANT_PATTERN})`,
    )
  }
}

function parseEnabledFlags(
  raw: unknown,
  knownRefs: Set<string>,
): Record<string, FleetEnabledFlag> {
  if (raw === undefined) return {}
  if (!isPlainObject(raw)) {
    throw new Error('fleet-config: "models" must be an object of ref -> { enabled }')
  }
  const flags: Record<string, FleetEnabledFlag> = {}
  for (const [ref, value] of Object.entries(raw)) {
    if (!knownRefs.has(ref)) {
      throw new Error(
        `fleet-config: unknown model ref '${ref}' in "models" enabled flags`,
      )
    }
    if (!isPlainObject(value) || typeof value.enabled !== 'boolean') {
      throw new Error(
        `fleet-config: models['${ref}'] must be { enabled: boolean }`,
      )
    }
    flags[ref] = { enabled: value.enabled }
  }
  return flags
}

function parseExtraModels(
  raw: unknown,
): { extras: Record<string, FleetExtraModel>; refs: Set<string> } {
  if (raw === undefined) return { extras: {}, refs: new Set() }
  if (!isPlainObject(raw)) {
    throw new Error('fleet-config: "extraModels" must be an object of ref -> model entry')
  }
  const extras: Record<string, FleetExtraModel> = {}
  const refs = new Set<string>()
  for (const [ref, value] of Object.entries(raw)) {
    if (!isPlainObject(value)) {
      throw new Error(`fleet-config: extraModels['${ref}'] must be an object`)
    }
    const providerId = value.providerId
    const modelId = value.modelId
    const modelFamily = value.modelFamily
    if (typeof providerId !== 'string' || !providerId) {
      throw new Error(`fleet-config: extraModels['${ref}'].providerId must be a non-empty string`)
    }
    if (!MODEL_ID_TOKEN_PATTERN.test(providerId)) {
      throw new Error(
        `fleet-config: extraModels['${ref}'].providerId ${JSON.stringify(providerId)} must match ${MODEL_ID_TOKEN_PATTERN} (no whitespace or control characters)`,
      )
    }
    if (typeof modelId !== 'string' || !modelId) {
      throw new Error(`fleet-config: extraModels['${ref}'].modelId must be a non-empty string`)
    }
    if (!MODEL_ID_TOKEN_PATTERN.test(modelId)) {
      throw new Error(
        `fleet-config: extraModels['${ref}'].modelId ${JSON.stringify(modelId)} must match ${MODEL_ID_TOKEN_PATTERN} (no whitespace or control characters)`,
      )
    }
    if (typeof modelFamily !== 'string' || !modelFamily) {
      throw new Error(`fleet-config: extraModels['${ref}'].modelFamily must be a non-empty string`)
    }
    if (!MODEL_ID_TOKEN_PATTERN.test(modelFamily)) {
      throw new Error(
        `fleet-config: extraModels['${ref}'].modelFamily ${JSON.stringify(modelFamily)} must match ${MODEL_ID_TOKEN_PATTERN} (no whitespace or control characters)`,
      )
    }
    const derivedRef = `${providerId}/${modelId}`
    if (derivedRef !== ref) {
      throw new Error(
        `fleet-config: extraModels key '${ref}' does not match providerId/modelId '${derivedRef}'`,
      )
    }
    if (value.variant !== undefined) {
      assertValidVariant(value.variant, `on extra model '${ref}'`)
    }
    if (!isPlainObject(value.roleSuitability)) {
      throw new Error(`fleet-config: extraModels['${ref}'].roleSuitability must be an object`)
    }
    const suitability: Partial<Record<ModelRoleSlot, number>> = {}
    for (const [slot, score] of Object.entries(value.roleSuitability)) {
      if (!(MODEL_ROLE_SLOTS as readonly string[]).includes(slot)) {
        throw new Error(`fleet-config: unknown slot '${slot}' in roleSuitability of extra model '${ref}'`)
      }
      if (
        typeof score !== 'number' ||
        !Number.isFinite(score) ||
        score < 0 ||
        score > 1
      ) {
        throw new Error(
          `fleet-config: roleSuitability.${slot} = ${String(score)} on extra model '${ref}' (must be a number between 0 and 1)`,
        )
      }
      suitability[slot as ModelRoleSlot] = score
    }
    if (typeof value.toolSupport !== 'boolean') {
      throw new Error(`fleet-config: extraModels['${ref}'].toolSupport must be a boolean`)
    }
    if (typeof value.imageSupport !== 'boolean') {
      throw new Error(`fleet-config: extraModels['${ref}'].imageSupport must be a boolean`)
    }
    if (
      typeof value.contextLimit !== 'number' ||
      !Number.isInteger(value.contextLimit) ||
      value.contextLimit <= 0
    ) {
      throw new Error(`fleet-config: extraModels['${ref}'].contextLimit must be a positive integer`)
    }
    if (
      value.costPer1kTokens !== null &&
      (typeof value.costPer1kTokens !== 'number' ||
        !Number.isFinite(value.costPer1kTokens) ||
        value.costPer1kTokens < 0)
    ) {
      throw new Error(`fleet-config: extraModels['${ref}'].costPer1kTokens must be a non-negative number or null`)
    }
    let fallbackChain: string[] | undefined
    if (value.fallbackChain !== undefined) {
      if (
        !Array.isArray(value.fallbackChain) ||
        value.fallbackChain.some((r) => typeof r !== 'string')
      ) {
        throw new Error(`fleet-config: extraModels['${ref}'].fallbackChain must be an array of model refs`)
      }
      fallbackChain = value.fallbackChain as string[]
    }
    extras[ref] = {
      providerId,
      modelId,
      modelFamily,
      ...(value.variant !== undefined ? { variant: value.variant as string } : {}),
      roleSuitability: suitability,
      toolSupport: value.toolSupport,
      imageSupport: value.imageSupport,
      contextLimit: value.contextLimit,
      costPer1kTokens: value.costPer1kTokens as number | null,
      ...(fallbackChain !== undefined ? { fallbackChain } : {}),
    }
    refs.add(ref)
  }
  return { extras, refs }
}

function parseOverrides<T extends string>(
  raw: unknown,
  section: 'agentOverrides' | 'slotDefaults',
  validKeys: readonly T[],
  kindLabel: string,
  knownRefs: Set<string>,
): Partial<Record<T, FleetModelOverride>> {
  if (raw === undefined) return {}
  if (!isPlainObject(raw)) {
    throw new Error(`fleet-config: "${section}" must be an object`)
  }
  const out: Partial<Record<T, FleetModelOverride>> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (!validKeys.includes(key as T)) {
      throw new Error(`fleet-config: unknown ${kindLabel} '${key}' in "${section}"`)
    }
    if (!isPlainObject(value) || typeof value.modelRef !== 'string' || !value.modelRef) {
      throw new Error(`fleet-config: ${section}['${key}'] must be { modelRef: string }`)
    }
    if (!knownRefs.has(value.modelRef)) {
      throw new Error(
        `fleet-config: unknown model ref '${value.modelRef}' in ${kindLabel} override '${key}'`,
      )
    }
    if (value.variant !== undefined) {
      assertValidVariant(value.variant, `on ${kindLabel} override '${key}'`)
    }
    out[key as T] = {
      modelRef: value.modelRef,
      ...(value.variant !== undefined ? { variant: value.variant as string } : {}),
    }
  }
  return out
}

function parseSteps(raw: unknown): Partial<Record<AgentRole, number>> {
  if (raw === undefined) return {}
  if (!isPlainObject(raw)) {
    throw new Error(
      'fleet-config: "steps" must be an object of agent role -> step limit',
    )
  }
  const out: Partial<Record<AgentRole, number>> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (!(AGENT_ROLES as readonly string[]).includes(key)) {
      throw new Error(`fleet-config: unknown agent role '${key}' in "steps"`)
    }
    if (
      typeof value !== 'number' ||
      !Number.isInteger(value) ||
      value < MIN_STEPS_PER_ROLE ||
      value > MAX_STEPS_PER_ROLE
    ) {
      throw new Error(
        `fleet-config: steps['${key}'] = ${String(value)} (must be an integer between ${MIN_STEPS_PER_ROLE} and ${MAX_STEPS_PER_ROLE})`,
      )
    }
    out[key as AgentRole] = value
  }
  return out
}

/**
 * Ordered within-family rungs per agent role. Strict: unknown roles, unknown
 * refs, duplicate rungs, empty chains, and chains spanning more than one model
 * family are all rejected by name.
 */
function parseRoleFallbackChains(
  raw: unknown,
  knownRefs: Set<string>,
  familyOf: ReadonlyMap<string, string>,
): Partial<Record<AgentRole, string[]>> | undefined {
  if (raw === undefined) return undefined
  if (!isPlainObject(raw)) {
    throw new Error(
      'fleet-config: "fallbackChains" must be an object of agent role -> model refs',
    )
  }
  const out: Partial<Record<AgentRole, string[]>> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (!(AGENT_ROLES as readonly string[]).includes(key)) {
      throw new Error(`fleet-config: unknown agent role '${key}' in "fallbackChains"`)
    }
    if (
      !Array.isArray(value) ||
      value.length === 0 ||
      value.some((ref) => typeof ref !== 'string')
    ) {
      throw new Error(
        `fleet-config: fallbackChains['${key}'] must be a non-empty array of model refs`,
      )
    }
    const chain = value as string[]
    const families = new Set<string>()
    const seen = new Set<string>()
    for (const ref of chain) {
      if (seen.has(ref)) {
        throw new Error(
          `fleet-config: fallbackChains['${key}'] lists duplicate rung '${ref}'`,
        )
      }
      seen.add(ref)
      if (!knownRefs.has(ref)) {
        throw new Error(
          `fleet-config: unknown model ref '${ref}' in fallbackChains of '${key}'`,
        )
      }
      const family = familyOf.get(ref)
      if (family !== undefined) families.add(family)
    }
    if (families.size > 1) {
      throw new Error(
        `fleet-config: fallbackChains['${key}'] must stay within one model family (got ${[...families].sort().join(', ')})`,
      )
    }
    out[key as AgentRole] = chain
  }
  return out
}

/** Registry ref -> model family, for built-ins plus configured extras. */
function knownModelFamilies(
  extras: Record<string, FleetExtraModel>,
): Map<string, string> {
  const families = new Map<string, string>()
  for (const [ref, entry] of Object.entries(createModelRegistry())) {
    families.set(ref, entry.modelFamily)
  }
  for (const [ref, extra] of Object.entries(extras)) {
    families.set(ref, extra.modelFamily)
  }
  return families
}

/**
 * Validate an untrusted parsed config value against the built-in catalog.
 * Throws a descriptive error naming the problem and offending value;
 * returns a normalized FleetConfig otherwise.
 */
export function validateFleetConfig(raw: unknown): FleetConfig {
  if (!isPlainObject(raw)) {
    throw new Error('fleet-config: top-level config must be an object')
  }
  for (const key of Object.keys(raw)) {
    if (!(CONFIG_SECTIONS as readonly string[]).includes(key)) {
      throw new Error(`fleet-config: unknown config section '${key}'`)
    }
  }

  // Extras first — they extend the set of valid model refs.
  const { extras, refs: extraRefs } = parseExtraModels(raw.extraModels)
  const knownRefs = new Set<string>([...getBuiltinModelRefs(), ...extraRefs])

  // Fallback chains may reference builtins or sibling extras.
  for (const [ref, extra] of Object.entries(extras)) {
    for (const chainRef of extra.fallbackChain ?? []) {
      if (!knownRefs.has(chainRef)) {
        throw new Error(
          `fleet-config: unknown model ref '${chainRef}' in fallbackChain of extra model '${ref}'`,
        )
      }
    }
  }

  const chains = parseRoleFallbackChains(
    raw.fallbackChains,
    knownRefs,
    knownModelFamilies(extras),
  )

  return {
    models: parseEnabledFlags(raw.models, knownRefs),
    extraModels: extras,
    ...(chains !== undefined ? { fallbackChains: chains } : {}),
    agentOverrides: parseOverrides(
      raw.agentOverrides,
      'agentOverrides',
      AGENT_ROLES,
      'agent role',
      knownRefs,
    ),
    slotDefaults: parseOverrides(
      raw.slotDefaults,
      'slotDefaults',
      MODEL_ROLE_SLOTS,
      'slot',
      knownRefs,
    ),
    steps: parseSteps(raw.steps),
  }
}

/**
 * Load the fleet config from `path` (default: resolved via
 * `resolveFleetConfigPath()`). A missing file yields a valid empty default;
 * malformed JSON or schema violations throw descriptive errors.
 */
export function loadFleetConfig(path?: string): FleetConfig {
  const configPath = resolveFleetConfigPath(path)
  if (!nodeFs.existsSync(configPath)) return emptyFleetConfig()

  let text: string
  try {
    text = nodeFs.readFileSync(configPath, 'utf8')
  } catch (e) {
    throw new Error(`fleet-config: failed to read '${configPath}': ${String(e)}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (e) {
    throw new Error(
      `fleet-config: config at '${configPath}' is not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
    )
  }

  return validateFleetConfig(parsed)
}

/**
 * Atomically persist the fleet config: validate, pretty-print to
 * `<path>.tmp`, then rename over the target. On any failure the existing
 * file is left untouched.
 */
export function saveFleetConfig(path: string, config: FleetConfig): void {
  const validated = validateFleetConfig(config)
  const target = resolve(path)
  const tmp = `${target}.tmp`
  const json = `${JSON.stringify(validated, null, 2)}\n`

  nodeFs.mkdirSync(dirname(target), { recursive: true })
  nodeFs.writeFileSync(tmp, json, 'utf8')
  nodeFs.renameSync(tmp, target)
}

/**
 * Build the merged registry view: a fresh built-in catalog patched with
 * persisted enabled flags, plus validated extras appended with runtime
 * fields (healthy / circuitBreakerOpen / consecutiveFailures) initialized
 * fresh. Expects a validated config; unknown enabled-flag refs are ignored.
 */
export function buildModelRegistry(config: FleetConfig): ModelRegistry {
  const registry = createModelRegistry()

  for (const [ref, flag] of Object.entries(config.models)) {
    const entry = registry[ref]
    if (entry) entry.enabled = flag.enabled
  }

  for (const [ref, extra] of Object.entries(config.extraModels)) {
    const entry: ModelEntry = {
      providerId: extra.providerId,
      modelId: extra.modelId,
      modelFamily: extra.modelFamily,
      roleSuitability: { ...extra.roleSuitability },
      toolSupport: extra.toolSupport,
      imageSupport: extra.imageSupport,
      contextLimit: extra.contextLimit,
      costPer1kTokens: extra.costPer1kTokens,
      healthy: true,
      lastHealthCheck: null,
      fallbackChain: [...(extra.fallbackChain ?? [])],
      circuitBreakerOpen: false,
      consecutiveFailures: 0,
      enabled: config.models[ref]?.enabled,
      ...(extra.variant !== undefined ? { variant: extra.variant } : {}),
    }
    registry[ref] = entry
  }

  return registry
}

/**
 * Ordered within-family rungs persisted for a role (empty when none declared).
 */
export function resolveRoleFallbackChain(
  config: FleetConfig,
  role: AgentRole,
): string[] {
  return [...(config.fallbackChains?.[role] ?? [])]
}

/** True when a registry entry can currently serve traffic. */
function isLiveModel(entry: ModelEntry | undefined): boolean {
  return (
    !!entry && entry.enabled !== false && entry.healthy && !entry.circuitBreakerOpen
  )
}

/**
 * Family a role asked for: the family of its live role override, else its live
 * slot default, else the family shared by its declared fallback chain.
 *
 * `undefined` means "no family requested" — legacy scored selection applies and
 * the never-cross-families rule stays dormant, because there is no requested
 * family to substitute away from. A *dead* override (disabled / unhealthy /
 * circuit-open target) withdraws the request rather than pinning a family whose
 * only rungs are dead: the fleet turned that model off, so scoring may pick a
 * substitute. A declared chain, by contrast, is an explicit family demand and
 * keeps the lock armed even while its rungs are unavailable.
 */
export function resolveRoleFamily(
  registry: ModelRegistry,
  config: FleetConfig,
  role: AgentRole,
): string | undefined {
  const roleOverride = config.agentOverrides[role]
  const overrideFamily =
    roleOverride && isLiveModel(registry[roleOverride.modelRef])
      ? registry[roleOverride.modelRef]?.modelFamily
      : undefined
  if (overrideFamily !== undefined) return overrideFamily

  const slotDefault = config.slotDefaults[roleToSlot(role)]
  const slotFamily =
    slotDefault && isLiveModel(registry[slotDefault.modelRef])
      ? registry[slotDefault.modelRef]?.modelFamily
      : undefined
  if (slotFamily !== undefined) return slotFamily

  const chain = config.fallbackChains?.[role]
  if (chain && chain.length > 0) return registry[chain[0]]?.modelFamily
  return undefined
}

/**
 * Selection with fleet precedence: agent-role override > slot default
 * override > within-family rung walk. Overrides pointing at disabled /
 * unhealthy / circuit-open models fall back to normal selection (handled
 * inside `selectModel`). Disabled models never appear in candidate pools.
 *
 * The persisted fallback chain and the requested family both come from the
 * config, so the routing decision the fleet declares is the routing decision
 * that runs. `options.onSelection` is an optional observer; persisting those
 * events is a caller concern.
 */
export function attemptFleetSelection(
  registry: ModelRegistry,
  config: FleetConfig,
  role: AgentRole,
  options: { onSelection?: SelectionObserver } = {},
): SelectionAttempt {
  const toRouterOverride = (ov: FleetModelOverride | undefined): ModelOverride | undefined =>
    ov ? { key: ov.modelRef, variant: ov.variant } : undefined

  const chain = resolveRoleFallbackChain(config, role)
  const requestedFamily = resolveRoleFamily(registry, config, role)

  return attemptSelection(registry, role, {
    roleOverride: toRouterOverride(config.agentOverrides[role]),
    slotDefault: toRouterOverride(config.slotDefaults[roleToSlot(role)]),
    ...(requestedFamily !== undefined ? { requestedFamily } : {}),
    ...(chain.length > 0 ? { roleFallbackChain: chain } : {}),
    ...(options.onSelection ? { onSelection: options.onSelection } : {}),
  })
}

/** Selection only (`null` on a miss) — the attempt audit stays available. */
export function selectFleetModel(
  registry: ModelRegistry,
  config: FleetConfig,
  role: AgentRole,
  options: { onSelection?: SelectionObserver } = {},
): FleetSelection {
  return attemptFleetSelection(registry, config, role, options).selection
}
