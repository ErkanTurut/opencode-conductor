// Provenance: the stale-lease fencing recovery, liveness probing, and
// SWEEP/KEEP/PRUNE classification below are adapted from the OmO comparison
// notes (idea 3 — rounds/sweep slot + evidence gating). Patterns only: no
// upstream source was copied. License: SUL-1.0.
// provenance: omo-comparison idea 3 (rounds/sweep slot + evidence gating)
import type { ILedger } from './ledger/interface'

const HEARTBEAT_INTERVAL_MS = 15_000
const STALE_HEARTBEAT_MAX_AGE_MS = 45_000

/**
 * A lease heartbeat younger than this counts as "recent" for the patrol /
 * sweep liveness probe. Shares the watchdog's stale-heartbeat window so the
 * two paths can never disagree about what "still alive" means.
 */
export const HEARTBEAT_FRESH_MS = STALE_HEARTBEAT_MAX_AGE_MS

const DAY_MS = 86_400_000

export interface WatchdogConfig {
  heartbeatIntervalMs: number
  staleHeartbeatMaxAgeMs: number
}

export interface StaleLeaseRecovery {
  workItemId: string
  leaseOwner: string
  previousFencingToken: number
  fencingToken: number
  /** True when the lease was actually released (fencing UPDATE / fenced release). */
  released: boolean
}

/**
 * Optional fencing-recovery capability implemented by `SqliteLedger`.
 *
 * Declared structurally here instead of on `ILedger` so the frozen ledger
 * interface is untouched for parallel tasks; the watchdog feature-detects it
 * and falls back to the token-fenced `releaseLease` for substitute ledgers
 * (fakes in tests) that do not implement it. The real ledger always takes the
 * BEGIN IMMEDIATE bump-and-release path.
 */
interface FencingRecoverer {
  recoverLease?(
    workItemId: string,
    expectedFencingToken: number,
  ): Promise<{ recovered: boolean; fencingToken: number }>
}

export class Watchdog {
  private ledger: ILedger
  private intervals: Map<string, ReturnType<typeof setInterval>>
  private config: WatchdogConfig

  constructor(ledger: ILedger, config?: Partial<WatchdogConfig>) {
    this.ledger = ledger
    this.intervals = new Map()
    this.config = {
      heartbeatIntervalMs: config?.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS,
      staleHeartbeatMaxAgeMs:
        config?.staleHeartbeatMaxAgeMs ?? STALE_HEARTBEAT_MAX_AGE_MS,
    }
  }

  startHeartbeat(workItemId: string, fencingToken: number): void {
    this.stopHeartbeat(workItemId)
    const interval = setInterval(async () => {
      let ok = false
      try {
        ok = await this.ledger.heartbeatLease(workItemId, fencingToken)
      } catch {
        ok = false
      }
      if (!ok) {
        // A failed heartbeat means this owner can no longer prove it holds a
        // live lease. Stop the timer AND release the lease (token-fenced) so
        // it cannot linger until expiry with nothing sweeping it. Because
        // releaseLease is fenced on the held token, a lease already superseded
        // by another owner is left untouched (the no-op is the correct
        // outcome, not a lost release).
        this.stopHeartbeat(workItemId)
        try {
          await this.ledger.releaseLease(workItemId, fencingToken)
        } catch {
          // Best-effort: the watchdog/patrol recovery path owns the durable
          // repair, so a release failure here must never crash the interval.
        }
      }
    }, this.config.heartbeatIntervalMs)
    this.intervals.set(workItemId, interval)
  }

  stopHeartbeat(workItemId: string): void {
    const interval = this.intervals.get(workItemId)
    if (interval) {
      clearInterval(interval)
      this.intervals.delete(workItemId)
    }
  }

  stopAll(): void {
    for (const [key, interval] of this.intervals) {
      clearInterval(interval)
      this.intervals.delete(key)
    }
  }

  async findStaleHeartbeats(): Promise<
    Array<{ workItemId: string; leaseOwner: string; fencingToken: number }>
  > {
    const stale = await this.ledger.listStaleHeartbeats(
      this.config.staleHeartbeatMaxAgeMs,
    )
    return stale.map((s) => ({
      workItemId: s.work_item_id,
      leaseOwner: s.lease_owner,
      fencingToken: s.fencing_token,
    }))
  }

  async findExpiredLeases(): Promise<
    Array<{ workItemId: string; leaseOwner: string; fencingToken: number }>
  > {
    const expired = await this.ledger.listExpiredLeases()
    return expired.map((s) => ({
      workItemId: s.work_item_id,
      leaseOwner: s.lease_owner,
      fencingToken: s.fencing_token,
    }))
  }

  /**
   * Recover every stale/expired lease with a REAL fencing UPDATE: the token is
   * bumped and the lease released inside one BEGIN IMMEDIATE (see
   * `SqliteLedger.recoverLease`). This is not event-only bookkeeping — a
   * subsequent claim takes the bumped token, so the previous owner's heartbeat
   * and release are fenced out. A `lease_recovered` event records the repair.
   *
   * Union of stale heartbeats + expired leases, deduped by work item: a lease
   * can be both at once.
   */
  async recoverStaleLeases(): Promise<StaleLeaseRecovery[]> {
    const stale = await this.findStaleHeartbeats()
    const expired = await this.findExpiredLeases()

    const seen = new Set<string>()
    const candidates: Array<{
      workItemId: string
      leaseOwner: string
      fencingToken: number
    }> = []
    for (const candidate of [...stale, ...expired]) {
      if (seen.has(candidate.workItemId)) continue
      seen.add(candidate.workItemId)
      candidates.push(candidate)
    }

    const recovered: StaleLeaseRecovery[] = []
    for (const candidate of candidates) {
      const outcome = await this.forceRecover(candidate)
      recovered.push(outcome)
      await this.ledger.appendEvent({
        runId: 'recovery',
        workItemId: candidate.workItemId,
        eventType: 'lease_recovered',
        actor: 'watchdog',
        payloadJson: JSON.stringify({
          reason: 'stale_heartbeat_or_expired_lease',
          leaseOwner: candidate.leaseOwner,
          previousFencingToken: candidate.fencingToken,
          fencingToken: outcome.fencingToken,
          released: outcome.released,
        }),
      })
    }
    return recovered
  }

  private async forceRecover(candidate: {
    workItemId: string
    leaseOwner: string
    fencingToken: number
  }): Promise<StaleLeaseRecovery> {
    const recoverer = this.ledger as ILedger & FencingRecoverer
    if (typeof recoverer.recoverLease === 'function') {
      try {
        const result = await recoverer.recoverLease(
          candidate.workItemId,
          candidate.fencingToken,
        )
        if (result.recovered) {
          return {
            workItemId: candidate.workItemId,
            leaseOwner: candidate.leaseOwner,
            previousFencingToken: candidate.fencingToken,
            fencingToken: result.fencingToken,
            released: true,
          }
        }
      } catch {
        // Fall through to the token-fenced release below.
      }
    }

    // Fallback for ledgers without the atomic bump path: the fenced release
    // still refuses to touch a lease whose token was superseded.
    let released = false
    try {
      released = await this.ledger.releaseLease(
        candidate.workItemId,
        candidate.fencingToken,
      )
    } catch {
      released = false
    }
    return {
      workItemId: candidate.workItemId,
      leaseOwner: candidate.leaseOwner,
      previousFencingToken: candidate.fencingToken,
      fencingToken: candidate.fencingToken,
      released,
    }
  }
}

// ---------------------------------------------------------------------------
// Liveness + sweep classification
//
// Shared by the plugin's `supervisor_patrol` / `supervisor_sweep` tools. Kept
// here (not in the plugin) so the classification is unit-testable without a
// git checkout and both callers agree on the rules.
// ---------------------------------------------------------------------------

export type LeaseState = 'none' | 'active' | 'expired' | 'released'

export interface WorkItemLiveness {
  live: boolean
  reason: string
  hasActiveAttempt: boolean
  leaseState: LeaseState
  heartbeatFresh: boolean
  leasePresent: boolean
}

/**
 * Liveness probe for a single work item. Live when ANY of:
 *   - the work item state is `running`;
 *   - its latest attempt is `running` (an active attempt);
 *   - its fenced lease row is active (unreleased, token > 0, not expired);
 *   - its heartbeat is recent.
 * Anything else (absent task, released/expired lease, no attempt) is a
 * sweep candidate — never a live one.
 */
export async function evaluateWorkItemLiveness(
  ledger: ILedger,
  taskId: string,
  nowMs: number = Date.now(),
  heartbeatFreshMs: number = HEARTBEAT_FRESH_MS,
): Promise<WorkItemLiveness> {
  const item = await ledger.getWorkItem(taskId)
  if (!item) {
    return {
      live: false,
      reason: 'task_absent',
      hasActiveAttempt: false,
      leaseState: 'none',
      heartbeatFresh: false,
      leasePresent: false,
    }
  }

  const attempt = await ledger.getLatestAttempt(taskId)
  const hasActiveAttempt = attempt?.state === 'running'

  const lease = await ledger.getLease(taskId)
  let leaseState: LeaseState = 'none'
  let heartbeatFresh = false
  if (lease) {
    const expiryMs = lease.lease_expires_at
      ? Date.parse(lease.lease_expires_at)
      : Number.NaN
    const expired = Number.isFinite(expiryMs) ? expiryMs <= nowMs : false
    const heartbeatMs = lease.heartbeat_at
      ? Date.parse(lease.heartbeat_at)
      : Number.NaN
    heartbeatFresh = Number.isFinite(heartbeatMs)
      ? nowMs - heartbeatMs <= heartbeatFreshMs
      : false

    if (lease.released_at) leaseState = 'released'
    else if (lease.fencing_token > 0 && (!expired || heartbeatFresh))
      leaseState = 'active'
    else if (lease.fencing_token > 0) leaseState = 'expired'
    else leaseState = 'none'
  }

  const base = {
    hasActiveAttempt,
    leaseState,
    heartbeatFresh,
    leasePresent: Boolean(lease),
  }

  if (item.state === 'running')
    return { live: true, reason: 'task_running', ...base }
  if (hasActiveAttempt)
    return { live: true, reason: 'attempt_running', ...base }
  if (leaseState === 'active')
    return {
      live: true,
      reason: heartbeatFresh ? 'recent_heartbeat' : 'lease_active',
      ...base,
    }

  return {
    live: false,
    reason: lease ? `lease_${leaseState}` : 'no_lease',
    ...base,
  }
}

export interface WorktreeSweepCandidate {
  worktree_id: string
  path: string
  task_id: string | null
  mtime_ms: number
  live: boolean
  live_reason: string | null
  has_active_attempt: boolean
  lease_state: LeaseState
  dirty?: boolean
}

export interface WorktreeSweepEntry extends WorktreeSweepCandidate {
  classification: 'KEEP' | 'SWEEP'
  /** SWEEP entries are the PRUNE candidates (eligible for removal on apply). */
  prune: boolean
  age_days: number
  reason: string
}

/**
 * SWEEP = expired/absent lease AND no active attempt AND past `olderThanDays`.
 * KEEP = live, or holding an active attempt/lease, or not yet past the age
 * gate. Live worktrees are always KEEP regardless of age.
 */
export function classifyWorktreeSweep(
  candidate: WorktreeSweepCandidate,
  olderThanDays: number,
  nowMs: number = Date.now(),
): WorktreeSweepEntry {
  const ageDays =
    Number.isFinite(candidate.mtime_ms) && candidate.mtime_ms > 0
      ? (nowMs - candidate.mtime_ms) / DAY_MS
      : Number.POSITIVE_INFINITY
  const base = { ...candidate, age_days: ageDays }

  if (candidate.live) {
    return {
      ...base,
      classification: 'KEEP',
      prune: false,
      reason: `live:${candidate.live_reason ?? 'unknown'}`,
    }
  }
  if (candidate.has_active_attempt) {
    return {
      ...base,
      classification: 'KEEP',
      prune: false,
      reason: 'active_attempt',
    }
  }
  if (candidate.lease_state === 'active') {
    return {
      ...base,
      classification: 'KEEP',
      prune: false,
      reason: 'lease_active',
    }
  }

  const expired =
    candidate.lease_state === 'expired' ||
    candidate.lease_state === 'none' ||
    candidate.lease_state === 'released'
  if (expired && ageDays >= olderThanDays) {
    return {
      ...base,
      classification: 'SWEEP',
      prune: true,
      reason: 'expired_and_aged',
    }
  }
  return {
    ...base,
    classification: 'KEEP',
    prune: false,
    reason: ageDays >= olderThanDays ? 'not_expired' : 'not_aged',
  }
}

export interface RunSweepCandidate {
  run_id: string
  path: string
  mtime_ms: number
  state: string | null
  active: boolean
  has_verification: boolean
  has_receipt: boolean
}

export interface RunSweepEntry extends RunSweepCandidate {
  classification: 'KEEP' | 'SWEEP'
  prune: boolean
  age_days: number
  reason: string
}

/**
 * Runs-dir GC classification: an active (non-terminal) run is never pruned,
 * no matter its age; an inactive run is a PRUNE candidate only once it is past
 * `olderThanDays`.
 */
export function classifyRunSweep(
  candidate: RunSweepCandidate,
  olderThanDays: number,
  nowMs: number = Date.now(),
): RunSweepEntry {
  const ageDays =
    Number.isFinite(candidate.mtime_ms) && candidate.mtime_ms > 0
      ? (nowMs - candidate.mtime_ms) / DAY_MS
      : Number.POSITIVE_INFINITY
  const base = { ...candidate, age_days: ageDays }

  if (candidate.active) {
    return {
      ...base,
      classification: 'KEEP',
      prune: false,
      reason: 'active_run',
    }
  }
  if (ageDays < olderThanDays) {
    return {
      ...base,
      classification: 'KEEP',
      prune: false,
      reason: 'not_expired',
    }
  }
  return { ...base, classification: 'SWEEP', prune: true, reason: 'expired' }
}
