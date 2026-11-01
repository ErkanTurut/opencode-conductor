import type { RunSummary } from '../rpc-contract'

const terminal = new Set(['completed', 'cancelled', 'blocked', 'timed_out', 'failed'])
/** Fetch active work independently of newest history so old parked runs are not lost. */
export const ACTIVE_RUN_STATES = ['created', 'intake', 'awaiting_refinement', 'discovered', 'planned', 'awaiting_plan_approval', 'executing', 'validating', 'reviewing', 'repairing', 'integrating', 'awaiting_merge_approval', 'paused']
export const isActiveRun = (run: RunSummary) => !terminal.has(run.state)
export function mergeRuns(first: RunSummary[], rest: RunSummary[]): RunSummary[] {
  const seen = new Set<string>()
  return [...first, ...rest].filter(run => !seen.has(run.id) && !!seen.add(run.id))
}
export function filterRuns(runs: RunSummary[], active: boolean, query: string, sort: string): RunSummary[] {
  const q = query.trim().toLowerCase()
  return runs.filter(run => isActiveRun(run) === active && (!q || `${run.objective} ${run.id} ${run.state}`.toLowerCase().includes(q)))
    .sort((a, b) => sort === 'oldest' ? a.updatedAt.localeCompare(b.updatedAt) : sort === 'objective' ? a.objective.localeCompare(b.objective) : b.updatedAt.localeCompare(a.updatedAt))
}

/** Highlight recorded task states without inferring gate readiness. */
export function taskAttention(run: RunSummary): string {
  const counts = run.counts ?? {}
  const parts = ['failed', 'blocked', 'running', 'ready'].flatMap(state => {
    const count = counts[state]
    return typeof count === 'number' && count > 0 ? [`${count} ${state}`] : []
  })
  if (parts.length) return parts.join(', ')
  if (run.state.startsWith('awaiting_')) return 'Waiting for user input'
  if (run.state === 'paused') return 'Paused'
  return 'No recorded task activity'
}
