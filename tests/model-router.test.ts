import { describe, it, expect } from 'bun:test'
import {
  ModelRouter,
  attemptSelection,
  createModelRegistry,
  formatSelectionRungs,
  selectModel,
  selectFallbackModel,
  selectReviewerModel,
  recordModelFailure,
  recordModelSuccess,
} from '../src/model-router'
import type { AgentRole } from '../src/types'
import type { SelectionEvent } from '../src/model-router'
import {
  loadFleetConfig,
  buildModelRegistry,
  selectFleetModel,
} from '../src/fleet-config'

describe('Model Router', () => {
  it('selects a model for each agent role', () => {
    const registry = createModelRegistry()
    const roles: AgentRole[] = [
      'conductor',
      'scout',
      'architect',
      'coder',
      'critic',
      'security-critic',
      'integrator',
    ]

    for (const role of roles) {
      const selected = selectModel(registry, role)
      expect(selected).not.toBeNull()
      expect(selected!.providerId).toBeTruthy()
      expect(selected!.modelId).toBeTruthy()
    }
  })

  it('selects fallback model when primary is unhealthy', () => {
    const registry = createModelRegistry()
    const primary = selectModel(registry, 'architect')
    expect(primary).not.toBeNull()

    registry[primary!.key].healthy = false

    const fallback = selectModel(registry, 'architect')
    expect(fallback).not.toBeNull()
    expect(fallback!.key).not.toBe(primary!.key)
  })

  it('circuit breaks after threshold failures', () => {
    const registry = createModelRegistry()
    const key = 'opencode/deepseek-v4-pro'

    recordModelFailure(registry, key)
    recordModelFailure(registry, key)
    expect(registry[key].circuitBreakerOpen).toBe(false)

    recordModelFailure(registry, key)
    expect(registry[key].circuitBreakerOpen).toBe(true)
    expect(registry[key].consecutiveFailures).toBe(3)
  })

  it('resets circuit breaker on success', () => {
    const registry = createModelRegistry()
    const key = 'opencode/deepseek-v4-pro'

    recordModelFailure(registry, key)
    recordModelFailure(registry, key)
    recordModelFailure(registry, key)
    expect(registry[key].circuitBreakerOpen).toBe(true)

    recordModelSuccess(registry, key)
    expect(registry[key].circuitBreakerOpen).toBe(false)
    expect(registry[key].consecutiveFailures).toBe(0)
  })

  it('selects reviewer from different family', () => {
    const registry = createModelRegistry()
    const reviewer = selectReviewerModel(registry, 'deepseek')
    expect(reviewer).not.toBeNull()

    // Reviewer should be from a different family
    const entry = registry[reviewer!.key]
    expect(entry.modelFamily).not.toBe('deepseek')
  })

  it('returns null when no healthy models available', () => {
    const registry = createModelRegistry()
    for (const key of Object.keys(registry)) {
      registry[key].healthy = false
    }

    const selected = selectModel(registry, 'coder')
    expect(selected).toBeNull()
  })

  it('selects models with proper fallback chain', () => {
    const registry = createModelRegistry()
    const primary = selectModel(registry, 'coder')
    expect(primary).not.toBeNull()

    // Make primary unhealthy and circuit-broken
    registry[primary!.key].healthy = false
    registry[primary!.key].circuitBreakerOpen = true

    const fallback = selectFallbackModel(registry, primary!.key, 'coder')
    if (fallback) {
      expect(fallback.key).not.toBe(primary!.key)
      const fbEntry = registry[fallback.key]
      expect(fbEntry.healthy).toBe(true)
      expect(fbEntry.circuitBreakerOpen).toBe(false)
    }
  })
})

describe('Model Router — fleet-config overrides (additive)', () => {
  it('role override wins over scored best', () => {
    const registry = createModelRegistry()
    const best = selectModel(registry, 'coder')
    expect(best).not.toBeNull()
    expect(best!.key).not.toBe('opencode/gpt-5.6-luna')

    const picked = selectModel(registry, 'coder', undefined, {
      roleOverride: { key: 'opencode/gpt-5.6-luna' },
    })
    expect(picked).not.toBeNull()
    expect(picked!.key).toBe('opencode/gpt-5.6-luna')
  })

  it('slot default is used when no role override is given', () => {
    const registry = createModelRegistry()

    const picked = selectModel(registry, 'coder', undefined, {
      slotDefault: { key: 'opencode/kimi-k3' },
    })
    expect(picked).not.toBeNull()
    expect(picked!.key).toBe('opencode/kimi-k3')

    // Role override takes precedence over the slot default.
    const viaRole = selectModel(registry, 'coder', undefined, {
      roleOverride: { key: 'opencode/gpt-5.6-luna' },
      slotDefault: { key: 'opencode/kimi-k3' },
    })
    expect(viaRole!.key).toBe('opencode/gpt-5.6-luna')
  })

  it('override variant wins over model default variant', () => {
    const registry = createModelRegistry()
    const picked = selectModel(registry, 'architect', undefined, {
      roleOverride: { key: 'opencode/deepseek-v4-pro', variant: 'high' },
    })
    expect(picked!.key).toBe('opencode/deepseek-v4-pro')
    expect(picked!.variant).toBe('high')

    const defaulted = selectModel(registry, 'architect', undefined, {
      roleOverride: { key: 'opencode/deepseek-v4-pro' },
    })
    expect(defaulted!.variant).toBeUndefined()
  })

  it.each([
    ['disabled', () => ({ enabled: false })],
    ['unhealthy', () => ({ healthy: false })],
    ['circuit-open', () => ({ circuitBreakerOpen: true })],
  ] as const)('falls back when override target is %s', (_label, breakIt) => {
    const registry = createModelRegistry()
    Object.assign(registry['opencode/gpt-5.6-luna'], breakIt())

    const picked = selectModel(registry, 'critic', undefined, {
      roleOverride: { key: 'opencode/gpt-5.6-luna' },
    })
    // Falls back to normal scoring instead of returning a dead model.
    expect(picked).not.toBeNull()
    expect(picked!.key).not.toBe('opencode/gpt-5.6-luna')
  })

  it('excludes disabled models from all three selector pools', () => {
    const registry = createModelRegistry()

    // Baselines without any disabled flags.
    const basePick = selectModel(registry, 'coder')
    const baseReviewer = selectReviewerModel(registry, 'deepseek')

    registry['opencode/kimi-k3'].enabled = false
    registry['opencode/gpt-5.6-luna'].enabled = false

    // selectModel: coder's top pick (kimi-k3) is gone.
    const picked = selectModel(registry, 'coder')
    expect(picked).not.toBeNull()
    expect(picked!.key).not.toBe('opencode/kimi-k3')
    expect(picked!.key).not.toBe('opencode/gpt-5.6-luna')
    expect(picked!.key).not.toBe(basePick!.key)

    // selectFallbackModel: disabled chain entries are skipped.
    const fallback = selectFallbackModel(
      registry,
      'opencode/deepseek-v4-flash',
      'coder',
    )
    if (fallback) {
      expect(fallback.key).not.toBe('opencode/kimi-k3')
      expect(fallback.key).not.toBe('opencode/gpt-5.6-luna')
    }

    // selectReviewerModel: disabled reviewer candidates are skipped.
    const reviewer = selectReviewerModel(registry, 'deepseek')
    expect(reviewer).not.toBeNull()
    expect(reviewer!.key).not.toBe(baseReviewer!.key)
    expect(reviewer!.key).not.toBe('opencode/gpt-5.6-luna')
  })

  it('treats absent enabled flag as enabled', () => {
    const registry = createModelRegistry()
    for (const entry of Object.values(registry)) {
      expect(entry.enabled).toBeUndefined()
    }
    for (const role of [
      'conductor',
      'architect',
      'coder',
      'frontend-specialist',
      'test-engineer',
      'critic',
      'security-critic',
      'integrator',
    ] as const) {
      expect(selectModel(registry, role)).not.toBeNull()
    }
  })
})

describe('Model Router — rung audit and cross-family guard', () => {
  const REVIEWER_ROLES = ['critic', 'security-critic', 'architect'] as const

  it.each(REVIEWER_ROLES)(
    'never substitutes across families for %s: all family rungs unavailable => null + event',
    (role) => {
      const registry = createModelRegistry()
      const events: SelectionEvent[] = []

      const attempt = attemptSelection(registry, role, {
        requestedFamily: 'glm',
        onSelection: (event) => events.push(event),
      })

      // No silent reroute: a miss, never a model from another family.
      expect(attempt.selection).toBeNull()
      expect(attempt.selected_rung).toBeNull()
      expect(attempt.reason).toBe('no_cross_family_substitution')

      const miss = events.find((e) => e.type === 'no_cross_family_substitution')
      expect(miss).toBeDefined()
      if (miss?.type !== 'no_cross_family_substitution') return
      expect(miss.role).toBe(role)
      expect(miss.requested_family).toBe('glm')
      expect(miss.reason).toBe('no_cross_family_substitution')

      const selectedEvents = events.filter(
        (e): e is Extract<SelectionEvent, { type: 'model_selected' }> =>
          e.type === 'model_selected',
      )
      // Every candidate the router saw was refused, each with its own reason.
      expect(selectedEvents.length).toBeGreaterThan(0)
      for (const event of selectedEvents) {
        expect(event.taken).toBe(false)
        expect(event.reason).toBe('cross_family_blocked')
        expect(registry[event.model_id].modelFamily).not.toBe('glm')
      }

      // Same guard through the stateful router, plus the miss is remembered.
      const router = new ModelRouter()
      expect(router.attempt(registry, role, { requestedFamily: 'glm' }).selection).toBeNull()
      expect(router.getMissReason(role)).toBe('no_cross_family_substitution')
      expect(router.getSelectedRung(role)).toBeUndefined()
    },
  )

  it('lets a non-reviewer role substitute across families, and reports it', () => {
    const registry = createModelRegistry()
    const events: SelectionEvent[] = []

    const attempt = attemptSelection(registry, 'coder', {
      requestedFamily: 'glm',
      onSelection: (event) => events.push(event),
    })

    // coder is not family-locked: the escape is allowed but never silent.
    expect(attempt.selection).not.toBeNull()
    expect(attempt.reason).toBeUndefined()
    const taken = events.filter(
      (e): e is Extract<SelectionEvent, { type: 'model_selected' }> =>
        e.type === 'model_selected' && e.taken,
    )
    expect(taken).toHaveLength(1)
    expect(taken[0].reason).toBe('cross_family_substitution')
    expect(attempt.selection?.reason).toBe('cross_family_substitution')
    expect(registry[taken[0].model_id].modelFamily).not.toBe('glm')
  })

  it('walks the declared fallback chain in order and reports the taken rung', () => {
    const registry = createModelRegistry()
    const events: SelectionEvent[] = []

    const attempt = attemptSelection(registry, 'coder', {
      requestedFamily: 'deepseek',
      roleFallbackChain: [
        'opencode/deepseek-v4-flash',
        'opencode/deepseek-v4-pro',
      ],
      onSelection: (event) => events.push(event),
    })

    // Chain order is the config's, not the score's: pro out-scores flash on
    // implementation but flash is rung 1.
    expect(
      registry['opencode/deepseek-v4-pro'].roleSuitability.implementation,
    ).toBeGreaterThan(
      registry['opencode/deepseek-v4-flash'].roleSuitability.implementation!,
    )
    expect(attempt.selection?.key).toBe('opencode/deepseek-v4-flash')
    expect(attempt.selection?.family).toBe('deepseek')
    expect(attempt.selection?.selected_rung).toBe(1)
    expect(attempt.selected_rung).toBe(1)
    expect(attempt.rungs.map((r) => [r.rung, r.ref, r.taken])).toEqual([
      [1, 'opencode/deepseek-v4-flash', true],
    ])

    const takenEvents = events.filter(
      (e): e is Extract<SelectionEvent, { type: 'model_selected' }> =>
        e.type === 'model_selected' && e.taken,
    )
    expect(takenEvents).toHaveLength(1)
    expect(takenEvents[0]).toMatchObject({
      model_id: 'opencode/deepseek-v4-flash',
      role: 'coder',
      rung: 1,
    })
  })

  it('marks an unavailable rung skipped and takes the next servable one', () => {
    const registry = createModelRegistry()
    registry['opencode/deepseek-v4-flash'].healthy = false
    registry['opencode/deepseek-v4-pro'].circuitBreakerOpen = true
    const events: SelectionEvent[] = []

    const attempt = attemptSelection(registry, 'coder', {
      requestedFamily: 'deepseek',
      roleFallbackChain: [
        'opencode/deepseek-v4-flash',
        'opencode/deepseek-v4-pro',
        'opencode/kimi-k3',
        'opencode/ghost-model',
      ],
      onSelection: (event) => events.push(event),
    })

    expect(attempt.rungs).toMatchObject([
      {
        ref: 'opencode/deepseek-v4-flash',
        rung: 1,
        taken: false,
        reason: 'unhealthy',
        breaker_state: { consecutiveFailures: 0, open: false, healthy: false },
      },
      {
        ref: 'opencode/deepseek-v4-pro',
        rung: 2,
        taken: false,
        reason: 'circuit_open',
        breaker_state: { consecutiveFailures: 0, open: true, healthy: true },
      },
      {
        ref: 'opencode/kimi-k3',
        rung: 3,
        taken: true,
        reason: 'cross_family_substitution',
      },
    ])
    // The unknown ref after the winner is never reached, never silently added.
    expect(attempt.rungs.some((r) => r.ref === 'opencode/ghost-model')).toBe(false)
    expect(attempt.selected_rung).toBe(3)
    expect(attempt.selection?.key).toBe('opencode/kimi-k3')

    // The skipped rungs are visible in the event stream and in the one-liner.
    const skippedEvents = events.filter(
      (e): e is Extract<SelectionEvent, { type: 'model_selected' }> =>
        e.type === 'model_selected' && !e.taken,
    )
    expect(skippedEvents.map((e) => [e.rung, e.reason])).toEqual([
      [1, 'unhealthy'],
      [2, 'circuit_open'],
    ])
    expect(formatSelectionRungs(attempt)).toBe(
      'family=deepseek rung1=opencode/deepseek-v4-flash skipped[unhealthy] ' +
        'rung2=opencode/deepseek-v4-pro skipped[circuit_open] ' +
        'rung3=opencode/kimi-k3 taken',
    )
  })

  it('never takes a cross-family rung for a locked role, even mid-chain', () => {
    const registry = createModelRegistry()
    registry['opencode/deepseek-v4-flash'].healthy = false
    const events: SelectionEvent[] = []

    const attempt = attemptSelection(registry, 'critic', {
      requestedFamily: 'deepseek',
      roleFallbackChain: [
        'opencode/deepseek-v4-flash',
        'opencode/kimi-k3',
        'opencode/deepseek-v4-pro',
      ],
      onSelection: (event) => events.push(event),
    })

    // The in-family rung after the cross-family one still wins.
    expect(attempt.selection?.key).toBe('opencode/deepseek-v4-pro')
    expect(attempt.selected_rung).toBe(3)
    expect(attempt.rungs[1]).toMatchObject({
      ref: 'opencode/kimi-k3',
      taken: false,
      reason: 'cross_family_blocked',
    })
  })

  it('restore(events) rebuilds the breaker and the last taken rung', () => {
    const log: SelectionEvent[] = []
    const router = new ModelRouter({ onSelection: (event) => log.push(event) })
    const registry = createModelRegistry()

    router.recordFailure(registry, 'opencode/kimi-k3')
    router.recordFailure(registry, 'opencode/kimi-k3')
    router.recordFailure(registry, 'opencode/kimi-k3')

    const chain = ['opencode/kimi-k3', 'opencode/deepseek-v4-pro']
    const attempt = router.attempt(registry, 'coder', {
      requestedFamily: 'deepseek',
      roleFallbackChain: chain,
    })
    expect(attempt.rungs[0]).toMatchObject({
      ref: 'opencode/kimi-k3',
      taken: false,
      reason: 'circuit_open',
    })
    expect(attempt.selected_rung).toBe(2)
    expect(attempt.selection?.key).toBe('opencode/deepseek-v4-pro')
    expect(attempt.selection?.selected_rung).toBe(2)
    expect(log.length).toBeGreaterThan(0)

    // A restart replays the log instead of starting blind.
    const replay: SelectionEvent[] = []
    const restored = ModelRouter.restore(log, {
      onSelection: (event) => replay.push(event),
    })
    expect(restored.getSelectedRung('coder')).toBe(2)
    expect(restored.getBreakerState('opencode/kimi-k3')).toEqual({
      consecutiveFailures: 3,
      open: true,
      healthy: true,
    })

    // The restored breaker steers the next selection on a pristine registry...
    const freshRegistry = createModelRegistry()
    const afterRestart = restored.attempt(freshRegistry, 'coder', {
      requestedFamily: 'deepseek',
      roleFallbackChain: chain,
    })
    expect(afterRestart.rungs[0]).toMatchObject({
      ref: 'opencode/kimi-k3',
      taken: false,
      reason: 'circuit_open',
    })
    expect(afterRestart.selection?.key).toBe('opencode/deepseek-v4-pro')
    expect(afterRestart.selected_rung).toBe(2)
    // ...and still emits through the injected observer.
    expect(replay.length).toBeGreaterThan(0)
    // The read overlay never mutates the caller's registry.
    expect(freshRegistry['opencode/kimi-k3'].circuitBreakerOpen).toBe(false)

    // Malformed / foreign entries never take the router down.
    const tolerant = ModelRouter.restore([
      { type: 'model_selected', role: 'coder', rung: 1, taken: true } as SelectionEvent,
      { type: 'unknown_shape', role: 'coder' } as unknown as SelectionEvent,
    ])
    expect(tolerant.getBreakerState('opencode/deepseek-v4-pro')).toBeUndefined()
    expect(tolerant.getSelectedRung('coder')).toBe(1)
  })
})

describe('runner selection wiring — rung-schema events roundtrip into restore (F2)', () => {
  it('selectFleetModel({ onSelection }) emits rung events that restore() replays', () => {
    const config = loadFleetConfig()
    const registry = buildModelRegistry(config)

    const events: SelectionEvent[] = []
    const selection = selectFleetModel(registry, config, 'coder', {
      onSelection: (event: SelectionEvent) => events.push(event),
    })
    expect(selection).not.toBeNull()
    expect(events.length).toBeGreaterThan(0)

    // Every emitted event carries the t6 rung schema — never the legacy shape.
    for (const event of events) {
      expect(['model_selected', 'no_cross_family_substitution']).toContain(
        event.type,
      )
      if (event.type === 'model_selected') {
        expect(typeof event.model_id).toBe('string')
        expect(typeof event.role).toBe('string')
        expect(typeof event.rung).toBe('number')
        expect(typeof event.taken).toBe('boolean')
        expect(event.breaker_state).toBeDefined()
        // Legacy-shaped fields must be gone.
        expect((event as unknown as Record<string, unknown>).model_key).toBeUndefined()
        expect((event as unknown as Record<string, unknown>).provider_id).toBeUndefined()
      }
    }

    // The runner persists each event; a restart replays them into restore().
    const taken = events.find(
      (e) => e.type === 'model_selected' && e.taken,
    ) as Extract<SelectionEvent, { type: 'model_selected' }>
    expect(taken).toBeDefined()
    const restored = ModelRouter.restore(events)
    expect(restored.getSelectedRung('coder')).toBe(taken.rung)
  })
})
