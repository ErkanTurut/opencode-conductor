import type { RunState } from './types'
import { ACTIVE_STATES } from './types'

export const VALID_TRANSITIONS: Record<RunState, RunState[]> = {
  created: ['intake'],
  intake: [
    'awaiting_refinement',
    'discovered',
    'paused',
    'cancelled',
    'failed',
  ],
  awaiting_refinement: [
    'intake',
    'discovered',
    'paused',
    'cancelled',
    'failed',
  ],
  discovered: ['planned', 'paused', 'cancelled', 'failed'],
  planned: ['awaiting_plan_approval', 'paused', 'cancelled', 'failed'],
  awaiting_plan_approval: ['executing', 'paused', 'cancelled', 'blocked'],
  executing: ['validating', 'paused', 'cancelled', 'timed_out', 'failed'],
  validating: [
    'reviewing',
    'executing',
    'paused',
    'cancelled',
    'timed_out',
    'failed',
  ],
  reviewing: [
    'repairing',
    'validating',
    'paused',
    'cancelled',
    'blocked',
    'completed',
  ],
  repairing: [
    'validating',
    'reviewing',
    'paused',
    'cancelled',
    'blocked',
    'failed',
  ],
  integrating: ['awaiting_merge_approval', 'paused', 'cancelled', 'failed'],
  awaiting_merge_approval: [
    'completed',
    'paused',
    'cancelled',
    'blocked',
    'failed',
  ],
  completed: [],
  paused: [
    'intake',
    'awaiting_refinement',
    'discovered',
    'planned',
    'awaiting_plan_approval',
    'executing',
    'validating',
    'reviewing',
    'repairing',
    'integrating',
    'awaiting_merge_approval',
    'cancelled',
  ],
  cancelled: [],
  blocked: ['paused', 'cancelled'],
  timed_out: ['paused', 'cancelled'],
  failed: ['paused', 'cancelled'],
}

/**
 * Derive the terminal state set from the transition table instead of
 * hardcoding it. A state is terminal when it is not a workable (active)
 * state and none of its outgoing transitions can reach a workable state —
 * i.e. no path leads back to productive work. `paused` is not active but
 * can resume into active states, so it is not terminal.
 *
 * This is the single authority for `TERMINAL_STATES`; callers (e.g. the
 * SQLite ledger's run transition gate) must import it rather than keep a
 * private copy of the list.
 */
export function deriveTerminalStates(
  transitions: Record<RunState, RunState[]> = VALID_TRANSITIONS,
): Set<RunState> {
  const terminal = new Set<RunState>()
  for (const state of Object.keys(transitions) as RunState[]) {
    if (ACTIVE_STATES.has(state)) continue
    const canReachActive = (transitions[state] ?? []).some((next) =>
      ACTIVE_STATES.has(next),
    )
    if (!canReachActive) terminal.add(state)
  }
  return terminal
}

/** Terminal states, derived from `VALID_TRANSITIONS` (never hand-edited). */
export const TERMINAL_STATES: ReadonlySet<RunState> = deriveTerminalStates()

export function isValidTransition(from: RunState, to: RunState): boolean {
  if (from === to) return true
  return VALID_TRANSITIONS[from]?.includes(to) ?? false
}

export function isTerminal(state: RunState): boolean {
  return TERMINAL_STATES.has(state)
}

export function isActive(state: RunState): boolean {
  return ACTIVE_STATES.has(state)
}

export function transitionAllowed(
  current: RunState,
  requested: RunState,
): { allowed: boolean; reason?: string } {
  if (!isValidTransition(current, requested)) {
    return {
      allowed: false,
      reason: `Cannot transition from ${current} to ${requested}`,
    }
  }
  if (isTerminal(current) && current !== 'paused') {
    return {
      allowed: false,
      reason: `Cannot transition from terminal state ${current}`,
    }
  }
  return { allowed: true }
}

/**
 * Typed denial raised by the fail-closed transition gate. `code` is stable
 * so callers/tests can branch on it without matching message text.
 */
export class StateTransitionDenied extends Error {
  readonly code = 'STATE_TRANSITION_DENIED'
  readonly from: RunState
  readonly to: RunState

  constructor(from: RunState, to: RunState, reason: string) {
    super(reason)
    this.name = 'StateTransitionDenied'
    this.from = from
    this.to = to
  }
}

/**
 * Fail-closed gate: throws `StateTransitionDenied` unless
 * `transitionAllowed` approves the move. The single authority consumed by
 * the ledger (`transitionRunState`) and any other writer.
 */
export function assertTransitionAllowed(
  current: RunState,
  requested: RunState,
): void {
  const verdict = transitionAllowed(current, requested)
  if (!verdict.allowed) {
    throw new StateTransitionDenied(
      current,
      requested,
      verdict.reason ?? `Cannot transition from ${current} to ${requested}`,
    )
  }
}

/**
 * Whether a proposed transition targets a terminal state (so the ledger
 * knows to persist `terminal_reason`). Uses the derived set, never a
 * hardcoded list.
 */
export function isTerminalTransition(_current: RunState, requested: RunState): boolean {
  return TERMINAL_STATES.has(requested)
}
