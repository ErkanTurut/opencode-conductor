// Pure formatting helpers for the Conductor side panel.
//
// Everything here is deterministic and dependency-free, so the GUI views stay
// render-only and the helpers can be covered by plain `bun test` cases without
// a Solid renderer. Unknown or missing data formats as a muted-looking
// "unknown" string instead of throwing.

export type StateTone =
  | 'pending'
  | 'ready'
  | 'running'
  | 'completed'
  | 'failed'
  | 'blocked'
  | 'unknown'

const STATE_TONES: Readonly<Record<string, StateTone>> = {
  pending: 'pending',
  queued: 'pending',
  planned: 'pending',
  todo: 'pending',
  ready: 'ready',
  running: 'running',
  in_progress: 'running',
  inprogress: 'running',
  leased: 'running',
  claimed: 'running',
  dispatched: 'running',
  completed: 'completed',
  complete: 'completed',
  succeeded: 'completed',
  success: 'completed',
  passed: 'completed',
  done: 'completed',
  approved: 'completed',
  failed: 'failed',
  failure: 'failed',
  error: 'failed',
  rejected: 'failed',
  declined: 'failed',
  cancelled: 'failed',
  blocked: 'blocked',
  waiting: 'blocked',
  interrupted: 'blocked',
  skipped: 'unknown',
}

/** Map a ledger state (task, run, approval, finding) to a display tone. */
export function stateTone(state: string | null | undefined): StateTone {
  if (typeof state !== 'string' || state.length === 0) return 'unknown'
  return STATE_TONES[state.toLowerCase()] ?? 'unknown'
}

/** Approval decisions read better as a tone than as a raw word. */
export function decisionTone(decision: string | null | undefined): StateTone {
  if (typeof decision !== 'string') return 'unknown'
  const value = decision.toLowerCase()
  if (value === 'approved' || value === 'pass' || value === 'passed' || value === 'allow') return 'completed'
  if (value === 'rejected' || value === 'denied' || value === 'fail' || value === 'failed') return 'failed'
  if (value === 'pending' || value === 'requested') return 'pending'
  return stateTone(value)
}

/** Trim to `max` characters, ending with an ellipsis when cut. */
export function truncate(value: string | null | undefined, max: number): string {
  if (typeof value !== 'string') return ''
  if (max <= 0) return ''
  if (value.length <= max) return value
  return `${value.slice(0, Math.max(0, max - 1)).trimEnd()}\u2026`
}

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * Compact relative time, e.g. `just now`, `4m ago`, `3h ago`, `2d ago`.
 * Older than a week falls back to the UTC date part of the timestamp.
 */
export function formatRelativeTime(iso: string | null | undefined, now: number = Date.now()): string {
  if (typeof iso !== 'string' || iso.length === 0) return 'unknown'
  const time = Date.parse(iso)
  if (Number.isNaN(time)) return 'unknown'
  const diff = Math.max(0, now - time)
  if (diff < 45 * SECOND) return 'just now'
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m ago`
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}d ago`
  return iso.slice(0, 10)
}

/** `2026-10-30T12:34:56.000Z` -> `2026-10-30 12:34`, in UTC. Invalid input is `unknown`. */
export function formatDateTime(iso: string | null | undefined): string {
  if (typeof iso !== 'string' || iso.length === 0) return 'unknown'
  if (Number.isNaN(Date.parse(iso))) return 'unknown'
  return iso.slice(0, 16).replace('T', ' ')
}

/** The UTC date part of a timestamp, or `unknown`. */
export function formatDate(iso: string | null | undefined): string {
  if (typeof iso !== 'string' || iso.length === 0) return 'unknown'
  if (Number.isNaN(Date.parse(iso))) return 'unknown'
  return iso.slice(0, 10)
}

/** Durations as `820ms`, `1.4s`, `2m 05s`, `1h 03m`. */
export function formatDuration(ms: number | null | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return 'unknown'
  if (ms < SECOND) return `${Math.round(ms)}ms`
  if (ms < MINUTE) return `${(ms / SECOND).toFixed(1)}s`
  if (ms < HOUR) {
    const minutes = Math.floor(ms / MINUTE)
    const seconds = Math.floor((ms % MINUTE) / SECOND)
    return `${minutes}m ${String(seconds).padStart(2, '0')}s`
  }
  const hours = Math.floor(ms / HOUR)
  const minutes = Math.floor((ms % HOUR) / MINUTE)
  return `${hours}h ${String(minutes).padStart(2, '0')}m`
}

/** Thousands-separated integer, or `unknown`. */
export function formatNumber(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'unknown'
  return value.toLocaleString('en-US')
}

/** Token counts, or `null` so callers can render an explicit "usage unavailable". */
export function formatTokens(value: number | null | undefined): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return value.toLocaleString('en-US')
}

/** Currency amount, or `null` when the ledger recorded no cost. */
export function formatCost(value: number | null | undefined, currency?: string | null): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const code = typeof currency === 'string' && currency.length > 0 ? currency.toUpperCase() : 'USD'
  const digits = Math.abs(value) > 0 && Math.abs(value) < 0.01 ? 4 : 2
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code,
      maximumFractionDigits: digits,
    }).format(value)
  } catch {
    return `${value.toFixed(digits)} ${code}`
  }
}

/** A 0..1 confidence as a percentage; larger values are shown as authored. */
export function formatConfidence(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'unknown'
  if (value >= 0 && value <= 1) return `${Math.round(value * 100)}%`
  return String(value)
}

export interface TaskProgress {
  completed: number
  total: number
  percent: number
}

/**
 * Completed/total task progress. `taskCount` wins when it is a positive
 * number; otherwise the state counts are summed.
 */
export function taskProgress(
  counts: Record<string, unknown> | null | undefined,
  taskCount: number | null | undefined,
): TaskProgress {
  const record = counts ?? {}
  const completed = typeof record.completed === 'number' && Number.isFinite(record.completed) ? record.completed : 0
  const summed = Object.values(record).reduce(
    (total: number, value) =>
      typeof value === 'number' && Number.isFinite(value) ? total + value : total,
    0,
  )
  const total = typeof taskCount === 'number' && Number.isFinite(taskCount) && taskCount > 0 ? taskCount : summed
  const percent = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0
  return { completed, total, percent }
}

