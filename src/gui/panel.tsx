import { For, Match, Show, Switch, createEffect, createMemo, createSignal, onCleanup } from 'solid-js'
import { usePlugin, type PanelProps } from '@opencode/plugin/gui'
import { ConductorRpc, type ConfigurationData, type ProjectData, type DagData, type GatesData, type MemoryBlockData, type MemoryData, type RefinementData, type RoutingData, type RunDetailData, type RunSummary, type RunsData, type TimelineData, type WorkspaceData } from '../rpc-contract'
import { arrayOf, isRecord, readResult, type Loaded } from './data'
import { ACTIVE_RUN_STATES, mergeRuns } from './run-helpers'
import { DagView } from './views/dag'
import { GatesView } from './views/gates'
import { MemoryView } from './views/memory'
import { RefinementsView } from './views/refinements'
import { RoutingView } from './views/routing'
import { RunsView } from './views/runs'
import { ConfigurationView } from './views/configuration'
import { ProjectView } from './views/project'
import { formatDateTime, stateTone, taskProgress } from './format'
import { Badge } from './components'

export const CONDUCTOR_TABS = ['runs', 'dag', 'gates', 'refinements', 'memory', 'routing', 'agents', 'project'] as const
export type ConductorTab = (typeof CONDUCTOR_TABS)[number]
export function resolveTab(id: string | null | undefined): ConductorTab { return CONDUCTOR_TABS.find(candidate => candidate === id) ?? 'runs' }
const POLL = 3000

export function ConductorPanel(props: PanelProps) {
  const ctx = usePlugin()
  const rpc = () => ctx.client.rpc(ConductorRpc)
  const [runs, setRuns] = createSignal<RunSummary[]>([])
  const [workspace, setWorkspace] = createSignal<WorkspaceData | null>(null)
  const [configuration, setConfiguration] = createSignal<ConfigurationData | null>(null)
  const [project, setProject] = createSignal<ProjectData | null>(null)
  const [projectLoading, setProjectLoading] = createSignal(true)
  const [cursor, setCursor] = createSignal<string | null>(null)
  const [loadingMore, setLoadingMore] = createSignal(false)
  const [selectedId, setSelectedId] = createSignal<string | null>(null)
  const [selectedSummary, setSelectedSummary] = createSignal<RunSummary | null>(null)
  const [detail, setDetail] = createSignal<RunDetailData | null>(null)
  const [dag, setDag] = createSignal<DagData | null>(null)
  const [gates, setGates] = createSignal<GatesData | null>(null)
  const [refinements, setRefinements] = createSignal<RefinementData | null>(null)
  const [memory, setMemory] = createSignal<MemoryData | null>(null)
  const [routing, setRouting] = createSignal<RoutingData | null>(null)
  const [timeline, setTimeline] = createSignal<TimelineData | null>(null)
  const [runsLoading, setRunsLoading] = createSignal(true)
  const [detailLoading, setDetailLoading] = createSignal(false)
  const [memoryLoading, setMemoryLoading] = createSignal(true)
  const [error, setError] = createSignal<string | null>(null)
  const activeTab = () => resolveTab(props.tab.id)
  const selected = createMemo(() => runs().find(run => run.id === selectedId()) ?? selectedSummary())
  let projectGeneration = 0
  let pageGeneration = 0
  let disposed = false
  let initialPageLoaded = false
  onCleanup(() => { disposed = true; projectGeneration++; pageGeneration++ })
  async function call<T>(operation: () => Promise<unknown>): Promise<Loaded<T>> {
    try { return readResult<T>(await operation()) } catch (cause) { return { data: null, error: cause instanceof Error ? cause.message : String(cause) } }
  }
  // Reset synchronously on directory changes; responses retain the captured location.
  createEffect(() => {
    props.session.directory
    projectGeneration++; pageGeneration++; initialPageLoaded = false
    setRuns([]); setWorkspace(null); setCursor(null); setLoadingMore(false); setSelectedId(null); setSelectedSummary(null)
    setConfiguration(null); setProject(null); setProjectLoading(true)
    setDetail(null); setDag(null); setGates(null); setRefinements(null); setMemory(null); setRouting(null); setTimeline(null)
    setRunsLoading(true); setMemoryLoading(true); setError(null)
  })
  createEffect(() => {
    const directory = props.session.directory
    const tab = activeTab()
    const runId = selectedId()
    const generation = projectGeneration
    let current = true
    let busy = false
    const valid = () => current && !disposed && generation === projectGeneration
    const location = { directory }
    let timelineCursor = 0
    let timelineEvents: TimelineData['events'] = []
    setError(null)
    if (!['runs', 'memory', 'agents', 'project'].includes(tab)) {
      setDetail(null); setDag(null); setGates(null); setRefinements(null); setRouting(null); setTimeline(null)
      setDetailLoading(!!runId)
    }
    async function refresh() {
      if (busy || !valid()) return
      busy = true
      try {
        if (tab === 'runs') {
          const [list, project, active] = await Promise.all([
            call<RunsData>(() => rpc().runs({ limit: 50 }, { location })),
            call<WorkspaceData>(() => rpc().workspace({}, { location })),
            call<RunsData>(() => rpc().runs({ limit: 200, states: ACTIVE_RUN_STATES }, { location })),
          ])
          if (!valid()) return
          setRunsLoading(false)
          if (list.data) {
            // Keep previously loaded pages and their cursor on refresh; newest data wins.
            setRuns(old => mergeRuns(arrayOf<RunSummary>(list.data?.runs), mergeRuns(arrayOf<RunSummary>(active.data?.runs), old)))
            if (!initialPageLoaded) { setCursor(list.data.nextCursor); initialPageLoaded = true }
          }
          if (project.data) setWorkspace(project.data)
          setError(list.error ?? project.error ?? active.error)
        } else if (tab === 'agents') {
          const result = await call<ConfigurationData>(() => rpc().configuration({}, { location }))
          if (!valid()) return
          setProjectLoading(false); setConfiguration(result.data); setError(result.error)
        } else if (tab === 'project') {
          const result = await call<ProjectData>(() => rpc().project({}, { location }))
          if (!valid()) return
          setProjectLoading(false); setProject(result.data); setError(result.error)
        } else if (tab === 'memory') {
          const result = await call<MemoryData>(() => rpc().memory({ limit: 50 }, { location }))
          if (!valid()) return
          setMemoryLoading(false); setMemory(result.data); setError(result.error)
        } else if (runId) {
          const requests: Array<Promise<Loaded<any>>> = tab === 'dag' ? [
            call<RunDetailData>(() => rpc().run({ runId }, { location })),
            call<DagData>(() => rpc().dag({ runId }, { location })),
            call<GatesData>(() => rpc().gates({ runId }, { location })),
            call<RoutingData>(() => rpc().routing({ runId }, { location })),
          ] : tab === 'gates' ? [call<GatesData>(() => rpc().gates({ runId }, { location }))]
            : tab === 'refinements' ? [call<RefinementData>(() => rpc().refinements({ runId }, { location }))]
            : [call<RoutingData>(() => rpc().routing({ runId }, { location })), call<TimelineData>(() => rpc().timeline({ runId, afterSequence: timelineCursor, limit: 200 }, { location }))]
          const results = await Promise.all(requests)
          if (!valid()) return
          setDetailLoading(false)
          if (tab === 'dag') {
            setDetail(results[0].data); setDag(results[1].data); setGates(results[2].data); setRouting(results[3].data)
            if (results[0].data?.summary) setSelectedSummary(results[0].data.summary)
          }
          else if (tab === 'gates') setGates(results[0].data)
          else if (tab === 'refinements') setRefinements(results[0].data)
          else {
            setRouting(results[0].data)
            const page = results[1].data as TimelineData | null
            if (page) {
              timelineEvents = [...timelineEvents, ...arrayOf<TimelineData['events'][number]>(page.events)]
              timelineCursor = page.lastSequence
              setTimeline({ ...page, events: timelineEvents })
            }
          }
          setError(results.find(result => result.error)?.error ?? null)
        }
      } finally { busy = false }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), POLL)
    onCleanup(() => { current = false; clearInterval(timer) })
  })
  async function loadMore() {
    const next = cursor()
    if (!next || loadingMore()) return
    const generation = projectGeneration, page = ++pageGeneration, location = { directory: props.session.directory }
    setLoadingMore(true)
    const result = await call<RunsData>(() => rpc().runs({ limit: 50, cursor: next }, { location }))
    if (disposed || generation !== projectGeneration || page !== pageGeneration) return
    setLoadingMore(false)
    if (result.data) { setRuns(old => mergeRuns(old, arrayOf<RunSummary>(result.data?.runs))); setCursor(result.data.nextCursor) }
    setError(result.error)
  }
  async function loadMemoryBlock(label: string, version: number): Promise<MemoryBlockData | null> {
    if (!label) return null
    const generation = projectGeneration, location = { directory: props.session.directory }
    const result = await call<unknown>(() => rpc().memoryBlock({ label, version }, { location }))
    if (disposed || generation !== projectGeneration) return null
    if (result.error) { setError(result.error); return null }
    return isRecord(result.data) && isRecord(result.data.block) ? result.data.block as unknown as MemoryBlockData : result.data as MemoryBlockData | null
  }
  function selectRun(id: string) {
    setSelectedSummary(runs().find(run => run.id === id) ?? null)
    setSelectedId(id)
    ctx.layout.open(`${ctx.id}:dag`, props.session)
  }
  return <div class="cdt-root" data-color-mode={ctx.appearance?.mode?.()}>
    <header class="cdt-header"><div class="cdt-title">{(workspace()?.projectRoot ?? props.session.directory).split('/').filter(Boolean).pop() ?? ctx.t('panel.title')}</div>
      <div class="cdt-subtitle">{['runs', 'memory', 'agents', 'project'].includes(activeTab()) ? workspace()?.projectRoot ?? props.session.directory : selected()?.objective ?? ctx.t('panel.noRun')}</div>
      <Show when={selected() && !['runs', 'memory', 'agents', 'project'].includes(activeTab())}>
        <div class="cdt-row cdt-wrap cdt-meta">
          <Badge tone={stateTone(selected()?.state)} label={selected()?.state ?? ctx.t('common.unknown')} />
          <span>{ctx.t('runs.progress', { completed: taskProgress(selected()?.counts ?? {}, selected()?.taskCount ?? 0).completed, total: selected()?.taskCount ?? 0 })}</span>
          <span class="cdt-mono cdt-muted">{selectedId()}</span>
        </div>
      </Show>
    </header>
    <Show when={!['runs', 'memory', 'agents', 'project'].includes(activeTab())}><button class="cdt-back" type="button" onClick={() => ctx.layout.open(`${ctx.id}:runs`, props.session)}>{ctx.t('navigation.backRuns')}</button></Show>
    <Show when={error()}><div class="cdt-error" role="alert">{ctx.t('common.error', { message: error() ?? '' })}<div class="cdt-error-detail">{ctx.t('common.retryHint')}</div></div></Show>
    <Show when={activeTab() === 'dag' && detail()}>
      <details class="cdt-inspector-disclosure">
        <summary>Recent plan history ({detail()?.planRevisions?.length ?? 0})</summary>
        <Show when={detail()?.planRevisions?.length} fallback={<p class="cdt-muted">Legacy or unversioned plan. No revision history is available.</p>}>
          <ol class="cdt-inspector-list"><For each={detail()?.planRevisions ?? []}>{revision =>
            <li><span class="cdt-mono">v{revision.revision}</span> {revision.reason} <time class="cdt-muted" datetime={revision.createdAt}>{formatDateTime(revision.createdAt)}</time></li>
          }</For></ol>
        </Show>
      </details>
    </Show>
    <Switch>
      <Match when={activeTab() === 'runs'}><RunsView runs={runs()} selectedId={selectedId()} loading={runsLoading()} workspace={workspace()} nextCursor={cursor()} loadingMore={loadingMore()} onMore={loadMore} onSelect={selectRun} /></Match>
      <Match when={activeTab() === 'dag'}><DagView data={dag()} loading={detailLoading()} hasRun={!!selectedId()} {...{ detail: detail(), gates: gates(), routing: routing() }} /></Match>
      <Match when={activeTab() === 'gates'}><GatesView data={gates()} loading={detailLoading()} hasRun={!!selectedId()} /></Match>
      <Match when={activeTab() === 'refinements'}><RefinementsView data={refinements()} loading={detailLoading()} hasRun={!!selectedId()} /></Match>
      <Match when={activeTab() === 'memory'}><MemoryView data={memory()} loading={memoryLoading()} loadBlock={loadMemoryBlock} scopeKey={props.session.directory} /></Match>
      <Match when={activeTab() === 'routing'}><RoutingView data={routing()} timeline={timeline()} loading={detailLoading()} hasRun={!!selectedId()} /></Match>
      <Match when={activeTab() === 'agents'}><ConfigurationView data={configuration()} loading={projectLoading()} /></Match>
      <Match when={activeTab() === 'project'}><ProjectView data={project()} loading={projectLoading()} /></Match>
    </Switch>
  </div>
}
