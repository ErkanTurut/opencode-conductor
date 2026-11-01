import { For, Show, createMemo, createSignal } from 'solid-js'
import { usePlugin } from '@opencode/plugin/gui'
import type { RunSummary, WorkspaceData } from '../../rpc-contract'
import { formatRelativeTime, stateTone, taskProgress } from '../format'
import { recordOf } from '../data'
import { Badge, EmptyState, LoadingBlock, Section } from '../components'
import { filterRuns, isActiveRun, taskAttention } from '../run-helpers'

export interface RunsViewProps {
  runs: RunSummary[]
  selectedId: string | null
  loading: boolean
  workspace: WorkspaceData | null
  nextCursor: string | null
  loadingMore: boolean
  onMore: () => void
  onSelect: (runId: string) => void
}
export function RunsView(props: RunsViewProps) {
  const ctx = usePlugin()
  const [active, setActive] = createSignal(true)
  const [query, setQuery] = createSignal('')
  const [sort, setSort] = createSignal('newest')
  const filtered = createMemo(() => filterRuns(props.runs, active(), query(), sort()))
  const activeLoaded = createMemo(() => props.runs.filter(isActiveRun).length)
  return <Section title={ctx.t('runs.title')}>
    <div class="cdt-run-counts" aria-label="Project run counts">
      <span><strong>{props.workspace?.counts.activeRuns ?? activeLoaded()}</strong> active{!props.workspace && ' loaded'}</span>
      <span><strong>{props.workspace?.counts.runs ?? props.runs.length}</strong> total{!props.workspace && ' loaded'}</span>
      <span><strong>{props.workspace?.counts.tasks ?? '—'}</strong> tasks</span>
    </div>
    <div class="cdt-run-toolbar">
      <div class="cdt-run-switch" role="group" aria-label="Run category">
        <button type="button" aria-pressed={active()} onClick={() => setActive(true)}>Active</button>
        <button type="button" aria-pressed={!active()} onClick={() => setActive(false)}>History</button>
      </div>
      <label>Search loaded runs <input type="search" value={query()} onInput={e => setQuery(e.currentTarget.value)} /></label>
      <label>Sort <select value={sort()} onChange={e => setSort(e.currentTarget.value)}><option value="newest">Newest updated</option><option value="oldest">Oldest updated</option><option value="objective">Objective</option></select></label>
    </div>
    <p class="cdt-muted cdt-meta">Showing {filtered().length} of {props.runs.length} loaded runs. Search and sort apply to loaded runs only.</p>
    <Show when={!props.loading || props.runs.length} fallback={<LoadingBlock label={ctx.t('common.loading')} />}>
      <Show when={filtered().length} fallback={<EmptyState title={props.runs.length ? 'No matching loaded runs' : ctx.t('runs.empty.title')} body={props.runs.length ? 'Try another filter or load more runs.' : ctx.t('runs.empty.body')} />}>
        <div class="cdt-table-scroll"><table class="cdt-run-table"><thead><tr><th scope="col">Objective</th><th scope="col">State</th><th scope="col">Tasks</th><th scope="col">Attention</th><th scope="col">Updated</th></tr></thead><tbody>
          <For each={filtered()}>{run => { const progress = () => taskProgress(recordOf(run.counts), run.taskCount); return <tr>
            <td><button class="cdt-run-link" type="button" onClick={() => props.onSelect(run.id)} aria-label={`Open run: ${run.objective || run.id}`}>{run.objective || run.id}</button><div class="cdt-mono cdt-muted cdt-meta">{run.id}</div></td>
            <td><Badge tone={stateTone(run.state)} label={run.state} /></td><td>{progress().completed}/{progress().total}</td><td>{taskAttention(run)}</td><td>{formatRelativeTime(run.updatedAt)}</td>
          </tr> }}</For>
        </tbody></table></div>
      </Show>
      <Show when={props.nextCursor}><button class="cdt-more" type="button" disabled={props.loadingMore} onClick={props.onMore}>{props.loadingMore ? 'Loading…' : 'Load more runs'}</button></Show>
    </Show>
  </Section>
}
