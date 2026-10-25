// Model routing: role -> slot -> candidate scoring with circuit breaking,
// plus rung-level selection audit and optional event emission.
//
// SQLite-free by design: this module never touches the ledger. Callers may
// inject an `onSelection` observer to persist selection events; wiring that
// observer at the call sites is a separate concern. `ModelRouter.restore`
// rebuilds breaker + last-rung state from a past events array, so a restarted
// process is no longer blind to what already failed.
//
// The fleet catalog itself lives in `config/models.json` and is loaded through
// `fleet-config` (the single authority). This module ships only the built-in
// base catalog and must never carry a second copy of the fleet model list.
//
// provenance: omo-comparison idea 7 — rung-level routing report plus refusing
// silent cross-family substitution for reviewer roles (patterns only).
import type { ModelRoleSlot, AgentRole } from './types'

export interface ModelEntry {
  providerId: string
  modelId: string
  modelFamily: string
  roleSuitability: Partial<Record<ModelRoleSlot, number>>
  toolSupport: boolean
  imageSupport: boolean
  contextLimit: number
  costPer1kTokens: number | null
  healthy: boolean
  lastHealthCheck: string | null
  fallbackChain: string[]
  circuitBreakerOpen: boolean
  consecutiveFailures: number
  /**
   * Fleet-config persisted flag. Absent (undefined) means enabled.
   * Disabled models are excluded from all selection candidate pools.
   */
  enabled?: boolean
  /** Default reasoning variant for this model (e.g. 'high', 'max'). */
  variant?: string
}

export type ModelRegistry = Record<string, ModelEntry>

/**
 * A persisted routing override pointing at a registry key
 * (`provider/model` ref) with an optional reasoning variant.
 */
export interface ModelOverride {
  key: string
  variant?: string
}

/** Minimum suitability a candidate must reach to serve a role slot. */
export const MIN_ROLE_FITNESS = 0.3

/** Minimum critique suitability a standalone reviewer candidate must reach. */
export const MIN_REVIEWER_FITNESS = 0.5

const CIRCUIT_BREAKER_THRESHOLD = 3

/**
 * Roles that must never be served by a different family than the one they
 * asked for: a reviewer's independence claim depends on it, and the architect
 * pins the planning family. When every family rung is unavailable these roles
 * report `no_cross_family_substitution` instead of silently rerouting.
 *
 * provenance: omo-comparison idea 7 (missing family => unavailable, never a
 * silent reroute to another family).
 */
export const NO_CROSS_FAMILY_ROLES: readonly AgentRole[] = [
  'architect',
  'critic',
  'security-critic',
]

export function isCrossFamilyLocked(role: AgentRole): boolean {
  return (NO_CROSS_FAMILY_ROLES as readonly string[]).includes(role)
}

/** Circuit-breaker snapshot carried by every emitted selection event. */
export interface BreakerState {
  consecutiveFailures: number
  open: boolean
  healthy: boolean
}

/**
 * Why a rung was taken or skipped.
 *
 * Skipped: `unknown_ref` (absent from the registry), `disabled`, `unhealthy`,
 * `circuit_open`, `fitness_below_threshold`, `cross_family_blocked` (locked
 * role would have to cross families).
 *
 * Taken: `role_override` / `slot_default` (explicit intent), plain in-family
 * rung (reason omitted), `cross_family_substitution` (only non-locked roles).
 */
export type SelectionReason =
  | 'unknown_ref'
  | 'disabled'
  | 'unhealthy'
  | 'circuit_open'
  | 'fitness_below_threshold'
  | 'cross_family_blocked'
  | 'role_override'
  | 'slot_default'
  | 'cross_family_substitution'
  | 'no_cross_family_substitution'
  | 'no_candidates'

export type EventReason = SelectionReason

/** One evaluated rung, in the order the router walked it. */
export interface RungAudit {
  /** Registry key (`provider/model`) of the rung. */
  ref: string
  family: string | null
  /** 1-based rung index. */
  rung: number
  taken: boolean
  reason?: EventReason
  breaker_state: BreakerState
}

export interface ModelSelectedEvent {
  type: 'model_selected'
  /**
   * Registry key (`provider/model`) of the evaluated rung — the same ref the
   * `models` CLI takes, so a ledger event is actionable without translation.
   */
  model_id: string
  role: AgentRole
  /** 1-based rung index within the attempt. */
  rung: number
  taken: boolean
  reason?: EventReason
  breaker_state: BreakerState
}

export interface NoCrossFamilySubstitutionEvent {
  type: 'no_cross_family_substitution'
  role: AgentRole
  requested_family: string
  reason: string
}

export type SelectionEvent = ModelSelectedEvent | NoCrossFamilySubstitutionEvent

/** Receives one event per evaluated rung (plus the reviewer-miss event). */
export type SelectionObserver = (event: SelectionEvent) => void

const NOOP_OBSERVER: SelectionObserver = () => {}
const UNKNOWN_BREAKER_STATE: BreakerState = {
  consecutiveFailures: 0,
  open: false,
  healthy: false,
}

export function breakerStateOf(entry: ModelEntry | undefined): BreakerState {
  if (!entry) return { ...UNKNOWN_BREAKER_STATE }
  return {
    consecutiveFailures: entry.consecutiveFailures,
    open: entry.circuitBreakerOpen,
    healthy: entry.healthy,
  }
}

export function isBreakerState(value: unknown): value is BreakerState {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<BreakerState>
  return (
    typeof candidate.consecutiveFailures === 'number' &&
    typeof candidate.open === 'boolean' &&
    typeof candidate.healthy === 'boolean'
  )
}

export interface ModelSelection {
  providerId: string
  modelId: string
  key: string
  variant?: string
  /** Family of the selected model. */
  family: string
  /**
   * 1-based index of the taken rung. Always present on a selection result so
   * callers can report (and persist) which rung actually served the request.
   */
  selected_rung: number
  /** Set when an explicit override or a cross-family escape produced it. */
  reason?: EventReason
}

/** Full audit of one selection attempt, including a null (missed) result. */
export interface SelectionAttempt {
  role: AgentRole
  requested_family?: string
  rungs: RungAudit[]
  selection: ModelSelection | null
  /** `null` rung index when nothing could be served. */
  selected_rung: number | null
  /** Present only when `selection` is null. */
  reason?: EventReason
}

export interface SelectModelOptions {
  /** Highest precedence — explicit per-agent-role override. */
  roleOverride?: ModelOverride
  /** Middle precedence — per-slot default override. */
  slotDefault?: ModelOverride
  /**
   * Family the caller asked for. Required for the never-cross-families rule:
   * without a requested family there is nothing to substitute away from, and
   * legacy scored selection applies.
   */
  requestedFamily?: string
  /**
   * Ordered within-family fallback rungs from fleet config
   * (`fallbackChains[role]`). The first servable rung wins; skipped rungs stay
   * in the audit with their reason.
   */
  roleFallbackChain?: string[]
  /** Optional selection observer. Defaults to a noop. */
  onSelection?: SelectionObserver
}

const ROLE_TO_SLOT: Record<AgentRole, ModelRoleSlot> = {
  conductor: 'fast-triage',
  'requirements-refiner': 'fast-triage',
  scout: 'fast-triage',
  'external-scout': 'fast-triage',
  architect: 'architecture',
  coder: 'implementation',
  'frontend-specialist': 'ui-visual',
  'test-engineer': 'testing',
  'build-verifier': 'testing',
  critic: 'critique',
  'security-critic': 'security',
  integrator: 'integration',
  'memory-curator': 'fast-triage',
}

export function roleToSlot(role: AgentRole): ModelRoleSlot {
  return ROLE_TO_SLOT[role]
}

/** True when the entry may serve traffic: present, enabled, healthy, circuit closed. */
function isSelectable(entry: ModelEntry | undefined): entry is ModelEntry {
  if (!entry) return false
  if (entry.enabled === false) return false
  if (!entry.healthy || entry.circuitBreakerOpen) return false
  return true
}

/** Reason this entry cannot serve the slot, or null when it can. */
function unavailabilityOf(
  entry: ModelEntry | undefined,
  slot: ModelRoleSlot,
): EventReason | null {
  if (!entry) return 'unknown_ref'
  if (entry.enabled === false) return 'disabled'
  if (!entry.healthy) return 'unhealthy'
  if (entry.circuitBreakerOpen) return 'circuit_open'
  const fitness = entry.roleSuitability[slot]
  if (fitness === undefined || fitness < MIN_ROLE_FITNESS)
    return 'fitness_below_threshold'
  return null
}

// Verified model catalog from OpenCode 1.18.15. Fleet models pinned by agent
// frontmatter are registered in `config/models.json` (extraModels) instead —
// this base catalog stays a curated minimum.
export function createModelRegistry(): ModelRegistry {
  return {
    'opencode/deepseek-v4-pro': {
      providerId: 'opencode',
      modelId: 'deepseek-v4-pro',
      modelFamily: 'deepseek',
      roleSuitability: {
        'fast-triage': 0.7,
        architecture: 0.92,
        implementation: 0.88,
        'ui-visual': 0.5,
        testing: 0.65,
        critique: 0.82,
        security: 0.78,
        integration: 0.88,
      },
      toolSupport: true,
      imageSupport: false,
      contextLimit: 200000,
      costPer1kTokens: null,
      healthy: true,
      lastHealthCheck: null,
      fallbackChain: ['opencode/gpt-5.6-luna', 'opencode/kimi-k3'],
      circuitBreakerOpen: false,
      consecutiveFailures: 0,
    },
    'opencode/deepseek-v4-flash': {
      providerId: 'opencode',
      modelId: 'deepseek-v4-flash',
      modelFamily: 'deepseek',
      roleSuitability: {
        'fast-triage': 0.95,
        architecture: 0.45,
        implementation: 0.6,
        'ui-visual': 0.3,
        testing: 0.7,
        critique: 0.55,
        security: 0.5,
        integration: 0.5,
      },
      toolSupport: true,
      imageSupport: false,
      contextLimit: 200000,
      costPer1kTokens: null,
      healthy: true,
      lastHealthCheck: null,
      fallbackChain: ['opencode/kimi-k3', 'vercel/stepfun/step-3.7-flash'],
      circuitBreakerOpen: false,
      consecutiveFailures: 0,
    },
    'opencode/kimi-k3': {
      providerId: 'opencode',
      modelId: 'kimi-k3',
      modelFamily: 'kimi',
      roleSuitability: {
        'fast-triage': 0.75,
        architecture: 0.65,
        implementation: 0.9,
        'ui-visual': 0.35,
        testing: 0.72,
        critique: 0.6,
        security: 0.55,
        integration: 0.6,
      },
      toolSupport: true,
      imageSupport: false,
      contextLimit: 200000,
      costPer1kTokens: null,
      healthy: true,
      lastHealthCheck: null,
      fallbackChain: ['opencode/deepseek-v4-pro', 'opencode/gpt-5.6-luna'],
      circuitBreakerOpen: false,
      consecutiveFailures: 0,
    },
    'opencode/gpt-5.6-luna': {
      providerId: 'opencode',
      modelId: 'gpt-5.6-luna',
      modelFamily: 'openai',
      roleSuitability: {
        'fast-triage': 0.6,
        architecture: 0.88,
        implementation: 0.82,
        'ui-visual': 0.85,
        testing: 0.7,
        critique: 0.92,
        security: 0.88,
        integration: 0.85,
      },
      toolSupport: true,
      imageSupport: true,
      contextLimit: 200000,
      costPer1kTokens: null,
      healthy: true,
      lastHealthCheck: null,
      fallbackChain: ['opencode/deepseek-v4-pro'],
      circuitBreakerOpen: false,
      consecutiveFailures: 0,
    },
    'vercel/stepfun/step-3.7-flash': {
      providerId: 'vercel',
      modelId: 'stepfun/step-3.7-flash',
      modelFamily: 'stepfun',
      roleSuitability: {
        'fast-triage': 0.85,
        architecture: 0.4,
        implementation: 0.55,
        'ui-visual': 0.25,
        testing: 0.75,
        critique: 0.45,
        security: 0.4,
        integration: 0.4,
      },
      toolSupport: true,
      imageSupport: false,
      contextLimit: 128000,
      costPer1kTokens: null,
      healthy: true,
      lastHealthCheck: null,
      fallbackChain: ['opencode/deepseek-v4-flash', 'opencode/kimi-k3'],
      circuitBreakerOpen: false,
      consecutiveFailures: 0,
    },
    'vercel/alibaba/qwen3.8-max': {
      providerId: 'vercel',
      modelId: 'alibaba/qwen3.8-max',
      modelFamily: 'qwen',
      roleSuitability: {
        'fast-triage': 0.7,
        architecture: 0.72,
        implementation: 0.85,
        'ui-visual': 0.4,
        testing: 0.68,
        critique: 0.65,
        security: 0.6,
        integration: 0.65,
      },
      toolSupport: true,
      imageSupport: false,
      contextLimit: 128000,
      costPer1kTokens: null,
      healthy: true,
      lastHealthCheck: null,
      fallbackChain: ['opencode/deepseek-v4-pro', 'opencode/kimi-k3'],
      circuitBreakerOpen: false,
      consecutiveFailures: 0,
    },
  }
}

function pickOverride(
  registry: ModelRegistry,
  override: ModelOverride | undefined,
): { providerId: string; modelId: string; key: string; variant?: string } | null {
  if (!override) return null
  const entry = registry[override.key]
  // An override pointing at a disabled / unhealthy / circuit-open model is
  // treated as dead — fall back to normal selection instead.
  if (!isSelectable(entry)) return null
  return {
    providerId: entry.providerId,
    modelId: entry.modelId,
    key: override.key,
    variant: override.variant ?? entry.variant,
  }
}

/**
 * Rung order for an attempt: the declared per-role chain first (fleet config is
 * the authority on which rungs exist), then the scored candidate pool as an
 * implicit tail so a role with no declared chain keeps legacy behavior.
 *
 * `requestedFamily` only tilts the implicit tail (-0.15, legacy soft
 * preference); it never removes cross-family candidates, because the locked
 * roles need to *see* a cross-family rung to report it as blocked rather than
 * to silently pick it.
 */
function buildRungOrder(
  registry: ModelRegistry,
  role: AgentRole,
  requestedFamily: string | undefined,
  declaredChain: readonly string[],
): string[] {
  const slot = ROLE_TO_SLOT[role]
  const scored = Object.entries(registry)
    .filter(([, entry]) => {
      if (entry.enabled === false) return false
      if (!entry.healthy || entry.circuitBreakerOpen) return false
      const fitness = entry.roleSuitability[slot]
      return fitness !== undefined && fitness >= MIN_ROLE_FITNESS
    })
    .sort(([, a], [, b]) => {
      let scoreA = a.roleSuitability[slot] ?? 0
      let scoreB = b.roleSuitability[slot] ?? 0
      if (requestedFamily && requestedFamily !== a.modelFamily) scoreA -= 0.15
      if (requestedFamily && requestedFamily !== b.modelFamily) scoreB -= 0.15
      return scoreB - scoreA
    })
    .map(([key]) => key)

  const order: string[] = []
  const seen = new Set<string>()
  for (const ref of declaredChain) {
    if (seen.has(ref)) continue
    seen.add(ref)
    order.push(ref)
  }
  for (const ref of scored) {
    if (seen.has(ref)) continue
    seen.add(ref)
    order.push(ref)
  }
  return order
}

function toSelection(
  entry: ModelEntry,
  key: string,
  variant: string | undefined,
  rung: number,
  reason: EventReason | undefined,
): ModelSelection {
  return {
    providerId: entry.providerId,
    modelId: entry.modelId,
    key,
    ...(variant !== undefined ? { variant } : {}),
    family: entry.modelFamily,
    selected_rung: rung,
    ...(reason !== undefined ? { reason } : {}),
  }
}

/**
 * Walk the rungs for `role` and return the full attempt audit.
 *
 * Precedence: role override > slot default > rung walk. Overrides are explicit
 * intent — they are never second-guessed by scores, and (like today) a dead
 * override falls through to the rung walk.
 *
 * provenance: omo-comparison idea 7 — first servable rung wins; a locked role
 * whose family has no servable rung reports unavailable instead of rerouting.
 */
export function attemptSelection(
  registry: ModelRegistry,
  role: AgentRole,
  options: SelectModelOptions = {},
): SelectionAttempt {
  const emit = options.onSelection ?? NOOP_OBSERVER
  const slot = ROLE_TO_SLOT[role]
  const requestedFamily = options.requestedFamily
  const rungs: RungAudit[] = []

  const record = (
    ref: string,
    rung: number,
    taken: boolean,
    reason: EventReason | undefined,
  ): void => {
    const entry = registry[ref]
    const breaker_state = breakerStateOf(entry)
    rungs.push({
      ref,
      family: entry?.modelFamily ?? null,
      rung,
      taken,
      ...(reason !== undefined ? { reason } : {}),
      breaker_state,
    })
    emit({
      type: 'model_selected',
      model_id: ref,
      role,
      rung,
      taken,
      ...(reason !== undefined ? { reason } : {}),
      breaker_state,
    })
  }

  // 1. Explicit overrides win outright.
  const viaRole = pickOverride(registry, options.roleOverride)
  if (viaRole) {
    record(viaRole.key, 1, true, 'role_override')
    return {
      role,
      ...(requestedFamily !== undefined ? { requested_family: requestedFamily } : {}),
      rungs,
      selection: toSelection(
        registry[viaRole.key],
        viaRole.key,
        viaRole.variant,
        1,
        'role_override',
      ),
      selected_rung: 1,
    }
  }
  const viaSlot = pickOverride(registry, options.slotDefault)
  if (viaSlot) {
    record(viaSlot.key, 1, true, 'slot_default')
    return {
      role,
      ...(requestedFamily !== undefined ? { requested_family: requestedFamily } : {}),
      rungs,
      selection: toSelection(
        registry[viaSlot.key],
        viaSlot.key,
        viaSlot.variant,
        1,
        'slot_default',
      ),
      selected_rung: 1,
    }
  }

  // 2. Rung walk — first servable rung wins.
  const order = buildRungOrder(
    registry,
    role,
    requestedFamily,
    options.roleFallbackChain ?? [],
  )
  const locked = isCrossFamilyLocked(role)

  for (let i = 0; i < order.length; i++) {
    const ref = order[i]
    const rung = i + 1
    const entry = registry[ref]
    const unavailable = unavailabilityOf(entry, slot)
    if (unavailable) {
      record(ref, rung, false, unavailable)
      continue
    }
    if (requestedFamily !== undefined && entry.modelFamily !== requestedFamily) {
      if (locked) {
        record(ref, rung, false, 'cross_family_blocked')
        continue
      }
      record(ref, rung, true, 'cross_family_substitution')
      return {
        role,
        requested_family: requestedFamily,
        rungs,
        selection: toSelection(entry, ref, entry.variant, rung, 'cross_family_substitution'),
        selected_rung: rung,
      }
    }
    record(ref, rung, true, undefined)
    return {
      role,
      ...(requestedFamily !== undefined ? { requested_family: requestedFamily } : {}),
      rungs,
      selection: toSelection(entry, ref, entry.variant, rung, undefined),
      selected_rung: rung,
    }
  }

  // 3. Nothing servable. A locked role must refuse rather than substitute.
  if (requestedFamily !== undefined && locked) {
    emit({
      type: 'no_cross_family_substitution',
      role,
      requested_family: requestedFamily,
      reason: 'no_cross_family_substitution',
    })
    return {
      role,
      requested_family: requestedFamily,
      rungs,
      selection: null,
      selected_rung: null,
      reason: 'no_cross_family_substitution',
    }
  }

  return {
    role,
    ...(requestedFamily !== undefined ? { requested_family: requestedFamily } : {}),
    rungs,
    selection: null,
    selected_rung: null,
    reason: 'no_candidates',
  }
}

/**
 * Drop-in replacement for the legacy selector: same precedence, same null on a
 * miss, plus `family` / `selected_rung` on the result and optional events.
 */
export function selectModel(
  registry: ModelRegistry,
  role: AgentRole,
  preferFamily?: string,
  options?: SelectModelOptions,
): ModelSelection | null {
  const requestedFamily = preferFamily ?? options?.requestedFamily
  return attemptSelection(registry, role, {
    ...options,
    ...(requestedFamily !== undefined ? { requestedFamily } : {}),
  }).selection
}

export function selectFallbackModel(
  registry: ModelRegistry,
  primaryKey: string,
  role: AgentRole,
): { providerId: string; modelId: string; key: string } | null {
  const primary = registry[primaryKey]
  if (!primary) return null

  for (const fallbackKey of primary.fallbackChain) {
    const fallback = registry[fallbackKey]
    if (fallback && isSelectable(fallback)) {
      const slot = ROLE_TO_SLOT[role]
      const fitness = fallback.roleSuitability[slot]
      if (fitness !== undefined && fitness >= MIN_ROLE_FITNESS) {
        return {
          providerId: fallback.providerId,
          modelId: fallback.modelId,
          key: fallbackKey,
        }
      }
    }
  }
  return null
}

export function recordModelFailure(registry: ModelRegistry, key: string): void {
  const entry = registry[key]
  if (!entry) return
  entry.consecutiveFailures++
  if (entry.consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
    entry.circuitBreakerOpen = true
  }
}

export function recordModelSuccess(registry: ModelRegistry, key: string): void {
  const entry = registry[key]
  if (!entry) return
  entry.consecutiveFailures = 0
  entry.circuitBreakerOpen = false
  entry.healthy = true
  entry.lastHealthCheck = new Date().toISOString()
}

export function selectReviewerModel(
  registry: ModelRegistry,
  implementerFamily: string,
): { providerId: string; modelId: string; key: string; variant?: string } | null {
  const candidates = Object.entries(registry)
    .filter(([, entry]) => {
      if (entry.enabled === false) return false
      if (!entry.healthy || entry.circuitBreakerOpen) return false
      const critiqueFit = entry.roleSuitability.critique ?? 0
      if (critiqueFit < MIN_REVIEWER_FITNESS) return false
      return true
    })
    .sort(([, a], [, b]) => {
      let scoreA = a.roleSuitability.critique ?? 0
      let scoreB = b.roleSuitability.critique ?? 0
      if (a.modelFamily !== implementerFamily) scoreA += 0.2
      if (b.modelFamily !== implementerFamily) scoreB += 0.2
      return scoreB - scoreA
    })

  if (candidates.length === 0) return null

  const [key, entry] = candidates[0]
  return {
    providerId: entry.providerId,
    modelId: entry.modelId,
    key,
    variant: entry.variant,
  }
}

/**
 * One-line rung report used by the `models list` CLI:
 * `family=deepseek rung1=opencode/deepseek-v4.1-flash-free taken rung2=… skipped[unhealthy]`.
 *
 * provenance: omo-comparison idea 7 (print taken/skipped rungs instead of
 * leaving the routing decision implicit).
 */
export function formatSelectionRungs(attempt: SelectionAttempt): string {
  const takenFamily = attempt.rungs.find((rung) => rung.taken)?.family
  const family = attempt.requested_family ?? takenFamily ?? '-'
  const parts = [`family=${family}`]
  for (const rung of attempt.rungs) {
    parts.push(
      `rung${rung.rung}=${rung.ref} ${rung.taken ? 'taken' : `skipped[${rung.reason ?? 'unavailable'}]`}`,
    )
  }
  if (!attempt.selection) {
    parts.push(`unavailable (${attempt.reason ?? 'no_candidates'})`)
  }
  return parts.join(' ')
}

/**
 * Stateful router: same pure engine, plus an injected observer and durable
 * breaker / last-rung memory that survives a restart via `restore`.
 *
 * The in-memory breaker is intentionally a projection of the event log: a
 * process that restarts replays its past `model_selected` events and gets its
 * breaker state (and last taken rung) back, instead of starting blind.
 */
export class ModelRouter {
  private readonly observer: SelectionObserver
  private readonly breaker = new Map<string, BreakerState>()
  private readonly lastRung = new Map<AgentRole, number>()
  private readonly lastMiss = new Map<AgentRole, string>()

  constructor(options: { onSelection?: SelectionObserver } = {}) {
    this.observer = options.onSelection ?? NOOP_OBSERVER
  }

  /** Selection only (null on a miss); events are still emitted. */
  select(
    registry: ModelRegistry,
    role: AgentRole,
    preferFamily?: string,
    options: Omit<SelectModelOptions, 'onSelection'> = {},
  ): ModelSelection | null {
    return this.attempt(registry, role, {
      ...options,
      ...(preferFamily !== undefined ? { requestedFamily: preferFamily } : {}),
    }).selection
  }

  /** Full attempt audit; restored breaker state is applied as a read overlay. */
  attempt(
    registry: ModelRegistry,
    role: AgentRole,
    options: Omit<SelectModelOptions, 'onSelection'> = {},
  ): SelectionAttempt {
    return attemptSelection(this.withRestoredBreaker(registry), role, {
      ...options,
      onSelection: (event) => this.observe(event),
    })
  }

  recordFailure(registry: ModelRegistry, key: string): void {
    recordModelFailure(registry, key)
    this.breaker.set(key, breakerStateOf(registry[key]))
  }

  recordSuccess(registry: ModelRegistry, key: string): void {
    recordModelSuccess(registry, key)
    this.breaker.set(key, breakerStateOf(registry[key]))
  }

  /** Restored breaker state for `ref`, when a past event reported it. */
  getBreakerState(ref: string): BreakerState | undefined {
    const state = this.breaker.get(ref)
    return state ? { ...state } : undefined
  }

  /** Last rung that actually served `role`, per the event log. */
  getSelectedRung(role: AgentRole): number | undefined {
    return this.lastRung.get(role)
  }

  /** Last refusal reason for `role` (e.g. `no_cross_family_substitution`). */
  getMissReason(role: AgentRole): string | undefined {
    return this.lastMiss.get(role)
  }

  /**
   * Rebuild a router from a past events array: newest event per model wins for
   * the breaker, newest taken rung per role wins for `getSelectedRung`.
   * Malformed / foreign entries are skipped rather than throwing, so a ledger
   * replay can never take the router down.
   */
  static restore(
    events: readonly SelectionEvent[],
    options: { onSelection?: SelectionObserver } = {},
  ): ModelRouter {
    const router = new ModelRouter(options)
    for (const event of events) {
      if (!event || typeof event !== 'object') continue
      if (event.type === 'no_cross_family_substitution') {
        router.lastMiss.set(event.role, event.reason)
        continue
      }
      if (event.type !== 'model_selected') continue
      // Rung memory and breaker memory are independent: a truncated event can
      // still report which rung served a role.
      if (event.taken && typeof event.rung === 'number') {
        router.lastRung.set(event.role, event.rung)
      }
      if (
        typeof event.model_id === 'string' &&
        event.model_id &&
        isBreakerState(event.breaker_state)
      ) {
        router.breaker.set(event.model_id, { ...event.breaker_state })
      }
    }
    return router
  }

  private observe(event: SelectionEvent): void {
    if (event.type === 'model_selected') {
      this.breaker.set(event.model_id, { ...event.breaker_state })
      if (event.taken) this.lastRung.set(event.role, event.rung)
    } else {
      this.lastMiss.set(event.role, event.reason)
    }
    this.observer(event)
  }

  /**
   * Read overlay: selection sees the restored breaker state without mutating
   * the caller's registry.
   */
  private withRestoredBreaker(registry: ModelRegistry): ModelRegistry {
    if (this.breaker.size === 0) return registry
    const overlay: ModelRegistry = { ...registry }
    for (const [ref, state] of this.breaker) {
      const entry = overlay[ref]
      if (!entry) continue
      overlay[ref] = {
        ...entry,
        consecutiveFailures: state.consecutiveFailures,
        circuitBreakerOpen: state.open,
        healthy: state.healthy,
      }
    }
    return overlay
  }
}
