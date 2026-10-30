import {
  Match,
  Show,
  Switch,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
} from 'solid-js'
import { usePlugin, type PanelProps } from '@opencode/plugin/gui'
import {
  ConductorRpc,
  type DagData,
  type GatesData,
  type MemoryBlockData,
  type MemoryData,
  type RefinementData,
  type RoutingData,
  type RunDetailData,
  type RunSummary,
  type RunsData,
  type TimelineData,
} from '../rpc-contract'
import { arrayOf, isRecord, readResult, type Loaded } from './data'
import { formatRelativeTime } from './format'
import { DagView } from './views/dag'
import { GatesView } from './views/gates'
import { MemoryView } from './views/memory'
import { RefinementsView } from './views/refinements'
import { RoutingView } from './views/routing'
import { RunsView } from './views/runs'

/** The six views the panel lists. `runs` is the fallback tab. */
export const CONDUCTOR_TABS = ['runs', 'dag', 'gates', 'refinements', 'memory', 'routing'] as const

export type ConductorTab = (typeof CONDUCTOR_TABS)[number]

export function resolveTab(id: string | null | undefined): ConductorTab {
  return CONDUCTOR_TABS.find((candidate) => candidate === id) ?? 'runs'
}

const POLL_INTERVAL_MS = 3000
const RUN_LIMIT = 50
const MEMORY_LIMIT = 50
const TIMELINE_LIMIT = 200

/**
 * Read-only Conductor panel.
 *
 * One render is mounted for the whole `conductor` tab group, so the selected
 * run survives switching between views. Data is re-read every three seconds
 * while the render is mounted; every read is a projection of the ledger, no
 * write action is offered.
 */
export function ConductorPanel(props: PanelProps) {
  const ctx = usePlugin()

  const [runs, setRuns] = createSignal<RunSummary[]>([])
  const [runDetail, setRunDetail] = createSignal<RunDetailData | null>(null)
  const [dag, setDag] = createSignal<DagData | null>(null)
  const [gates, setGates] = createSignal<GatesData | null>(null)
  const [refinements, setRefinements] = createSignal<RefinementData | null>(null)
  const [memory, setMemory] = createSignal<MemoryData | null>(null)
  const [routing, setRouting] = createSignal<RoutingData | null>(null)
  const [timeline, setTimeline] = createSignal<TimelineData | null>(null)

  const [selectedRunId, setSelectedRunId] = createSignal<string | null>(null)
  const [runsLoading, setRunsLoading] = createSignal(true)
  const [detailLoading, setDetailLoading] = createSignal(false)
  const [memoryLoading, setMemoryLoading] = createSignal(true)
  const [error, setError] = createSignal<string | null>(null)

  const activeTab = () => resolveTab(props.tab.id)
  const selectedRun = createMemo(() => runs().find((run) => run.id === selectedRunId()) ?? null)
  const hasRun = () => selectedRunId() !== null

  let disposed = false
  let refreshing = false

  const rpc = () => ctx.client.rpc(ConductorRpc)

  async function call<T>(operation: () => Promise<unknown>): Promise<Loaded<T>> {
    try {
      return readResult<T>(await operation())
    } catch (cause) {
      return { data: null, error: cause instanceof Error ? cause.message : String(cause) }
    }
  }

  async function loadRun(runId: string) {
    setDetailLoading(true)
    const [detail, dagData, gateData, refinementData, routingData, timelineData] = await Promise.all([
      call<RunDetailData>(() => rpc().run({ runId })),
      call<DagData>(() => rpc().dag({ runId })),
      call<GatesData>(() => rpc().gates({ runId })),
      call<RefinementData>(() => rpc().refinements({ runId })),
      call<RoutingData>(() => rpc().routing({ runId })),
      call<TimelineData>(() => rpc().timeline({ runId, limit: TIMELINE_LIMIT })),
    ])
    if (disposed || selectedRunId() !== runId) return

    setDetailLoading(false)
    if (detail.data) setRunDetail(detail.data)
    if (dagData.data) setDag(dagData.data)
    if (gateData.data) setGates(gateData.data)
    if (refinementData.data) setRefinements(refinementData.data)
    if (routingData.data) setRouting(routingData.data)
    if (timelineData.data) setTimeline(timelineData.data)

    const failure = [detail, dagData, gateData, refinementData, routingData, timelineData].find(
      (result) => result.error !== null,
    )
    setError(failure?.error ?? null)
  }

  async function loadRuns() {
    const result = await call<RunsData>(() => rpc().runs({ limit: RUN_LIMIT }))
    if (disposed) return
    setRunsLoading(false)
    if (result.error) {
      setError(result.error)
      return
    }

    const list = arrayOf<RunSummary>(result.data?.runs)
    setRuns(list)
    setError(null)

    const current = selectedRunId()
    const next = current && list.some((run) => run.id === current) ? current : list[0]?.id ?? null
    if (next !== current) setSelectedRunId(next)
    else if (next) await loadRun(next)
  }

  async function loadMemory() {
    const result = await call<MemoryData>(() => rpc().memory({ limit: MEMORY_LIMIT }))
    if (disposed) return
    setMemoryLoading(false)
    if (result.data) setMemory(result.data)
    if (result.error) setError(result.error)
  }

  async function refresh() {
    if (refreshing || disposed) return
    refreshing = true
    try {
      await Promise.all([loadRuns(), loadMemory()])
    } finally {
      refreshing = false
    }
  }

  async function loadMemoryBlock(label: string, version: number): Promise<MemoryBlockData | null> {
    if (label.length === 0) return null
    const result = await call<unknown>(() => rpc().memoryBlock({ label, version }))
    if (result.error) {
      setError(result.error)
      return null
    }
    const value = result.data
    if (isRecord(value) && isRecord(value.block)) return value.block as unknown as MemoryBlockData
    return (value as MemoryBlockData | null) ?? null
  }

  createEffect(() => {
    const runId = selectedRunId()
    if (runId) void loadRun(runId)
  })

  createEffect(() => {
    void refresh()
    const timer = setInterval(() => {
      void refresh()
    }, POLL_INTERVAL_MS)
    onCleanup(() => {
      disposed = true
      clearInterval(timer)
    })
  })

  return (
    <div class="cdt-root">
      <header class="cdt-header">
        <div class="cdt-title">{ctx.t('panel.title')}</div>
        <div class="cdt-subtitle">
          <Show when={selectedRun()} fallback={<span>{ctx.t('panel.noRun')}</span>}>
            {(run) => (
              <>
                <span class="cdt-mono">{run().id}</span>
                {' \u00b7 '}
                <span>{ctx.t('runs.updated', { when: formatRelativeTime(run().updatedAt) })}</span>
              </>
            )}
          </Show>
          <Show when={runDetail()}>
            {(detail) => (
              <>
                {' \u00b7 '}
                <span>{ctx.plural('runs.events', detail().eventCount)}</span>
              </>
            )}
          </Show>
        </div>
      </header>

      <Show when={error()}>
        <div class="cdt-error" role="alert">
          <div>{ctx.t('common.error', { message: error() ?? '' })}</div>
          <div class="cdt-error-detail">{ctx.t('common.retryHint')}</div>
        </div>
      </Show>

      <Switch>
        <Match when={activeTab() === 'runs'}>
          <RunsView
            runs={runs()}
            selectedId={selectedRunId()}
            loading={runsLoading()}
            onSelect={(runId) => setSelectedRunId(runId)}
          />
        </Match>
        <Match when={activeTab() === 'dag'}>
          <DagView data={dag()} loading={detailLoading()} hasRun={hasRun()} />
        </Match>
        <Match when={activeTab() === 'gates'}>
          <GatesView data={gates()} loading={detailLoading()} hasRun={hasRun()} />
        </Match>
        <Match when={activeTab() === 'refinements'}>
          <RefinementsView data={refinements()} loading={detailLoading()} hasRun={hasRun()} />
        </Match>
        <Match when={activeTab() === 'memory'}>
          <MemoryView data={memory()} loading={memoryLoading()} loadBlock={loadMemoryBlock} />
        </Match>
        <Match when={activeTab() === 'routing'}>
          <RoutingView data={routing()} timeline={timeline()} loading={detailLoading()} hasRun={hasRun()} />
        </Match>
      </Switch>
    </div>
  )
}
