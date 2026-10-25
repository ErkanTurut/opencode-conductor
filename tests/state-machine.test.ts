import { describe, it, expect } from 'bun:test'
import { unlinkSync } from 'node:fs'
import {
  isValidTransition,
  isTerminal,
  isActive,
  transitionAllowed,
  deriveTerminalStates,
  TERMINAL_STATES,
  StateTransitionDenied,
  assertTransitionAllowed,
} from '../src/state-machine'
import { SqliteLedger } from '../src/ledger/sqlite'

describe('State Machine', () => {
  it('allows valid transitions', () => {
    expect(isValidTransition('created', 'intake')).toBe(true)
    expect(isValidTransition('intake', 'discovered')).toBe(true)
    expect(isValidTransition('discovered', 'planned')).toBe(true)
    expect(isValidTransition('planned', 'awaiting_plan_approval')).toBe(true)
    expect(isValidTransition('awaiting_plan_approval', 'executing')).toBe(true)
    expect(isValidTransition('executing', 'validating')).toBe(true)
    expect(isValidTransition('validating', 'reviewing')).toBe(true)
    expect(isValidTransition('reviewing', 'completed')).toBe(true)
  })

  it('supports the refinement gate', () => {
    expect(isValidTransition('intake', 'awaiting_refinement')).toBe(true)
    expect(isValidTransition('awaiting_refinement', 'discovered')).toBe(true)
    expect(isValidTransition('awaiting_refinement', 'intake')).toBe(true)
    expect(isValidTransition('awaiting_refinement', 'paused')).toBe(true)
    expect(isValidTransition('awaiting_refinement', 'cancelled')).toBe(true)
    expect(isValidTransition('paused', 'awaiting_refinement')).toBe(true)
    expect(isActive('awaiting_refinement')).toBe(true)
    expect(isTerminal('awaiting_refinement')).toBe(false)
  })

  it('rejects invalid transitions', () => {
    expect(isValidTransition('created', 'completed')).toBe(false)
    expect(isValidTransition('created', 'executing')).toBe(false)
    expect(isValidTransition('intake', 'completed')).toBe(false)
    expect(isValidTransition('executing', 'created')).toBe(false)
  })

  it('identifies terminal states', () => {
    expect(isTerminal('completed')).toBe(true)
    expect(isTerminal('cancelled')).toBe(true)
    expect(isTerminal('failed')).toBe(true)
    expect(isTerminal('blocked')).toBe(true)
    expect(isTerminal('timed_out')).toBe(true)
    expect(isTerminal('executing')).toBe(false)
    expect(isTerminal('created')).toBe(false)
  })

  it('identifies active states', () => {
    expect(isActive('executing')).toBe(true)
    expect(isActive('reviewing')).toBe(true)
    expect(isActive('created')).toBe(false)
    expect(isActive('completed')).toBe(false)
    expect(isActive('cancelled')).toBe(false)
  })

  it('paused can transition to most active states', () => {
    expect(isValidTransition('paused', 'intake')).toBe(true)
    expect(isValidTransition('paused', 'executing')).toBe(true)
    expect(isValidTransition('paused', 'completed')).toBe(false)
  })

  it('transitionAllowed rejects terminal states', () => {
    const result = transitionAllowed('completed', 'intake')
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('Cannot transition')
  })

  it('transitionAllowed accepts same state', () => {
    const result = transitionAllowed('executing', 'executing')
    expect(result.allowed).toBe(true)
  })
})

describe('State Machine — derived terminal authority', () => {
  it('derives terminal states from the transition table', () => {
    const derived = [...deriveTerminalStates()].sort()
    expect(derived).toEqual(
      ['blocked', 'cancelled', 'completed', 'failed', 'timed_out'].sort(),
    )
    expect([...TERMINAL_STATES].sort()).toEqual(derived)
    // pausing is recoverable, so never terminal despite leaving the active set
    expect(TERMINAL_STATES.has('paused')).toBe(false)
  })

  it('does not hardcode the list: widening a terminal state removes it', () => {
    // A table where `failed` can reach the active `executing` state is not
    // terminal — proving the set is derived, not hand-maintained.
    const widened = deriveTerminalStates({
      created: ['intake'],
      intake: ['executing'],
      executing: ['validating'],
      validating: [],
      failed: ['validating'],
      cancelled: [],
    } as unknown as Parameters<typeof deriveTerminalStates>[0])
    expect(widened.has('failed')).toBe(false)
    expect(widened.has('created')).toBe(false)
    expect(widened.has('cancelled')).toBe(true)
  })

  it('assertTransitionAllowed throws a typed error on illegal transitions', () => {
    expect(() => assertTransitionAllowed('created', 'completed')).toThrow(
      StateTransitionDenied,
    )
    try {
      assertTransitionAllowed('created', 'completed')
      throw new Error('expected a throw')
    } catch (error) {
      expect(error).toBeInstanceOf(StateTransitionDenied)
      expect((error as StateTransitionDenied).code).toBe(
        'STATE_TRANSITION_DENIED',
      )
      expect((error as StateTransitionDenied).from).toBe('created')
      expect((error as StateTransitionDenied).to).toBe('completed')
    }
  })

  it('assertTransitionAllowed rejects wrapping a terminal state', () => {
    expect(() => assertTransitionAllowed('completed', 'intake')).toThrow(
      StateTransitionDenied,
    )
    expect(() => assertTransitionAllowed('completed', 'completed')).toThrow(
      StateTransitionDenied,
    )
    expect(() => assertTransitionAllowed('failed', 'paused')).toThrow(
      StateTransitionDenied,
    )
  })

  it('assertTransitionAllowed allows legal transitions', () => {
    expect(() => assertTransitionAllowed('created', 'intake')).not.toThrow()
    expect(() => assertTransitionAllowed('intake', 'discovered')).not.toThrow()
    expect(() => assertTransitionAllowed('paused', 'executing')).not.toThrow()
    expect(() => assertTransitionAllowed('executing', 'executing')).not.toThrow()
  })
})

describe('Ledger — transition gate is wired (fail-closed)', () => {
  it('transitionRunState rejects illegal and terminal transitions', async () => {
    const path = `/tmp/sm-gate-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.db`
    const ledger = new SqliteLedger(path)
    try {
      await ledger.createRun({
        id: 'r-1',
        parentId: null,
        repoId: '/test',
        requestHash: 'h',
        dataClass: 'internal',
        policyProfile: 'assisted',
        operationMode: 'assisted',
        riskClass: 'low',
        requestText: 'gate',
        budgetJson: '{}',
        deadlineAt: null,
      })

      // illegal jump created -> terminal
      await expect(ledger.transitionRunState('r-1', 'completed')).rejects.toThrow(
        StateTransitionDenied,
      )

      const intake = await ledger.transitionRunState('r-1', 'intake')
      expect(intake.state).toBe('intake')

      // legal terminal transition records the reason
      const cancelled = await ledger.transitionRunState('r-1', 'cancelled', 'stop')
      expect(cancelled.state).toBe('cancelled')
      expect(cancelled.terminal_reason).toBe('stop')

      // terminal-state wrap is rejected
      await expect(ledger.transitionRunState('r-1', 'paused')).rejects.toThrow(
        StateTransitionDenied,
      )

      // unknown run is rejected, never silently no-op'd
      await expect(ledger.transitionRunState('missing', 'intake')).rejects.toThrow(
        StateTransitionDenied,
      )
    } finally {
      ledger.close()
      for (const suffix of ['', '-wal', '-shm']) {
        try {
          unlinkSync(`${path}${suffix}`)
        } catch {
          // ignore
        }
      }
    }
  })
})
