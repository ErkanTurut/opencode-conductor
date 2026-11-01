import { For, Show, createEffect, createMemo, createSignal, createUniqueId, onCleanup } from 'solid-js'
import { usePlugin } from '@opencode/plugin/gui'
import type { DagData, DagNode, RunDetailData, GatesData, RoutingData } from '../../rpc-contract'
import { arrayOf, textOf } from '../data'
import { buildDagLayout, dagEdgePath, filterDagNodes, fitDagCamera, sameDagLayout, visibleDagPositions, type DagDirection, type DagPosition } from '../dag-layout'
import { stateTone } from '../format'
import { Badge, EmptyState, LoadingBlock, Section } from '../components'
import { DAG_CSS } from '../dag-styles'

export interface DagViewProps {
  data: DagData | null
  loading: boolean
  hasRun: boolean
  detail?: RunDetailData | null
  gates?: GatesData | null
  routing?: RoutingData | null
}

const PAGE_SIZE = 100

/** Compact graph with camera-stable polling and a paginated keyboard-accessible list. */
export function DagView(props: DagViewProps) {
  const ctx = usePlugin()
  const markerId = `cdt-dag-arrow-${createUniqueId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  let canvas: HTMLDivElement | undefined
  const [canvasElement, setCanvasElement] = createSignal<HTMLDivElement>()
  const [selectedId, setSelectedId] = createSignal<string | null>(null)
  const [query, setQuery] = createSignal('')
  const [status, setStatus] = createSignal('')
  const [zoom, setZoom] = createSignal(1)
  const [pan, setPan] = createSignal({ x: 20, y: 20 })
  const [direction, setDirection] = createSignal<DagDirection>('top-bottom')
  const [viewport, setViewport] = createSignal({ width: 700, height: 300 })
  const [page, setPage] = createSignal(0)
  const [drag, setDrag] = createSignal<{ x: number; y: number; px: number; py: number; pointerId: number } | null>(null)
  const graphRunId = createMemo(() => props.data?.runId ?? null)
  const nodes = createMemo(() => arrayOf<DagNode>(props.data?.nodes))
  const nodeById = createMemo(() => new Map(nodes().map((node) => [node.id, node])))
  const layout = createMemo(() => buildDagLayout(props.data?.layers, nodes().map((node) => node.id), {}, direction()), undefined, { equals: sameDagLayout })
  const filtered = createMemo(() => filterDagNodes(nodes(), query(), status() ? [status()] : []))
  const visibleIds = createMemo(() => new Set(visibleDagPositions(layout(), { ...pan(), scale: zoom() }, viewport()).map((n) => n.id)))
  const edges = createMemo(() => {
    const p = layout().byId
    return arrayOf<DagData['edges'][number]>(props.data?.edges).flatMap((edge) => {
      const from = p[edge.from]
      const to = p[edge.to]
      // Filtering policy: show only edges with both endpoints still in the graph.
      if (!from || !to || !filteredIdSet().has(edge.from) || !filteredIdSet().has(edge.to) || !visibleIds().has(edge.from) || !visibleIds().has(edge.to)) return []
      return [{ ...edge, key: `${edge.from}\u0000${edge.to}`, path: dagEdgePath(from, to, direction()) }]
    })
  })
  const filteredIdSet = createMemo(() => {
    const ids = new Set(filtered().visible.map((node) => node.id))
    for (const position of layout().nodes) if (!nodeById().has(position.id)) ids.add(position.id)
    return ids
  })
  const visibleNodePositions = createMemo(() => {
    const ids = filteredIdSet()
    return visibleDagPositions(layout(), { ...pan(), scale: zoom() }, viewport()).filter((position) => ids.has(position.id))
  })
  const selected = createMemo(() => selectedId() ? nodeById().get(selectedId()!) ?? null : null)
  const listPage = createMemo(() => filtered().visible.slice(page() * PAGE_SIZE, (page() + 1) * PAGE_SIZE))
  const maxPage = createMemo(() => Math.max(0, Math.ceil(filtered().visible.length / PAGE_SIZE) - 1))

  const fit = () => {
    if (!canvas) return
    const camera = fitDagCamera({ width: canvas.clientWidth, height: canvas.clientHeight }, layout().width, layout().height)
    setZoom(camera.scale)
    setPan({ x: camera.x, y: camera.y })
  }
  const center = (position: DagPosition) => {
    setPan({
      x: viewport().width / 2 - (position.x + position.width / 2) * zoom(),
      y: viewport().height / 2 - (position.y + position.height / 2) * zoom(),
    })
  }
  const choose = (id: string) => {
    setSelectedId(id)
    const position = layout().byId[id]
    if (position) {
      // An overview-scale card is not a readable detail target. Selecting a task
      // returns to a useful reading scale and centers it without hiding peers.
      if (zoom() < 0.65) setZoom(1)
      center(position)
    }
  }
  const stepPan = (dx: number, dy: number) => setPan((p) => ({ x: p.x + dx, y: p.y + dy }))

  createEffect(() => {
    const runId = graphRunId()
    if (!runId) return
    setSelectedId(null)
    setPan({ x: 20, y: 20 })
    setZoom(1)
    setQuery('')
    setStatus('')
    setPage(0)
  })
  createEffect(() => {
    if (selectedId() && !nodeById().has(selectedId()!)) setSelectedId(null)
    setPage((p) => Math.min(p, maxPage()))
  })
  createEffect(() => {
    const element = canvasElement()
    if (!element) return
    const update = () => setViewport({ width: element.clientWidth, height: element.clientHeight })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    onCleanup(() => observer.disconnect())
  })

  return (
    <Section title={ctx.t('dag.title')}>
      <style>{DAG_CSS}</style>
      <Show when={props.hasRun} fallback={<EmptyState title={ctx.t('runs.noSelection')} body={ctx.t('runs.empty.noSelection')} />}>
        <Show when={props.data} fallback={props.loading ? <LoadingBlock label={ctx.t('common.loading')} /> : null}>
          <Show when={layout().nodes.length > 0} fallback={<EmptyState title={ctx.t('dag.empty.title')} body={ctx.t('dag.empty.body')} />}>
            <Show when={arrayOf<string[]>(props.data?.cycles).length > 0}>
              <p class="cdt-error">Cycle members (not an ordered path): {arrayOf<string[]>(props.data?.cycles).map((cycle) => cycle.join(', ')).join('; ')}</p>
            </Show>
            <Show when={arrayOf<string>(props.data?.dangling).length > 0}>
              <p class="cdt-muted cdt-meta">Unresolved dependency ids: {arrayOf<string>(props.data?.dangling).join(', ')}</p>
            </Show>

            <div class="cdt-dag-toolbar" role="toolbar" aria-label="Graph controls">
              <input class="cdt-dag-search" aria-label="Search tasks" placeholder="Search tasks" value={query()} onInput={(event) => { setQuery(event.currentTarget.value); setPage(0) }} />
              <select aria-label="Filter by state" value={status()} onChange={(event) => { setStatus(event.currentTarget.value); setPage(0) }}>
                <option value="">All states</option>
                <For each={[...new Set(nodes().map((node) => textOf(node.state, 'unknown')))]}>{(state) => <option value={state}>{state}</option>}</For>
              </select>
              <button type="button" aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(2.5, value * 1.2))}>+</button>
              <button type="button" aria-label="Zoom out" onClick={() => setZoom((value) => Math.max(0.00001, value / 1.2))}>-</button>
              <button type="button" onClick={fit}>Fit</button>
              <button type="button" onClick={() => { setZoom(1); setPan({ x: 20, y: 20 }) }}>Reset</button>
              <button type="button" aria-pressed={direction() === 'top-bottom'} onClick={() => setDirection('top-bottom')}>Top to bottom</button>
              <button type="button" aria-pressed={direction() === 'left-right'} onClick={() => setDirection('left-right')}>Left to right</button>
              <span aria-live="polite">{filtered().hiddenCount} hidden</span>
            </div>

            <div
              ref={element => { canvas = element; setCanvasElement(element) }}
              class="cdt-dag-canvas"
              role="group"
              aria-label="Task dependency graph. Use arrow keys to pan; hold Space and drag to pan."
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return
                const amount = event.shiftKey ? 80 : 30
                if (event.key === ' ') {
                  event.currentTarget.setAttribute('data-space-pan', 'true')
                  event.preventDefault()
                  return
                }
                if (event.key === 'ArrowLeft') stepPan(amount, 0)
                else if (event.key === 'ArrowRight') stepPan(-amount, 0)
                else if (event.key === 'ArrowUp') stepPan(0, amount)
                else if (event.key === 'ArrowDown') stepPan(0, -amount)
                else if (event.key === '+' || event.key === '=') setZoom((value) => Math.min(2.5, value * 1.2))
                else if (event.key === '-') setZoom((value) => Math.max(0.00001, value / 1.2))
                else return
                event.preventDefault()
              }}
              onPointerDown={(event) => {
                if (event.target !== event.currentTarget && !event.currentTarget.hasAttribute('data-space-pan')) return
                if (event.button !== 0) return
                const current = pan()
                setDrag({ x: current.x, y: current.y, px: event.clientX, py: event.clientY, pointerId: event.pointerId })
              }}
              onPointerMove={(event) => {
                const start = drag()
                if (!start || start.pointerId !== event.pointerId) return
                const dx = event.clientX - start.px
                const dy = event.clientY - start.py
                if (Math.hypot(dx, dy) < 4) return
                if (!canvas?.hasPointerCapture(event.pointerId)) canvas?.setPointerCapture(event.pointerId)
                setPan({ x: start.x + dx, y: start.y + dy })
              }}
              onPointerUp={(event) => { if (canvas?.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId); setDrag(null) }}
              onPointerCancel={() => setDrag(null)}
              onKeyUp={(event) => { if (event.key === ' ') event.currentTarget.removeAttribute('data-space-pan') }}
              onBlur={() => canvas?.removeAttribute('data-space-pan')}
            >
              <div class="cdt-dag-inner" style={{ width: `${layout().width}px`, height: `${layout().height}px`, transform: `translate(${pan().x}px, ${pan().y}px) scale(${zoom()})`, 'transform-origin': 'top left' }}>
                <svg class="cdt-dag-edges" width={layout().width} height={layout().height} aria-hidden="true">
                  <defs><marker id={markerId} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 z" /></marker></defs>
                  <For each={edges()}>{(edge) => <path class="cdt-dag-edge" marker-end={`url(#${markerId})`} data-resolved={edge.resolved ? 'true' : 'false'} d={edge.path} />}</For>
                </svg>
                <For each={visibleNodePositions()}>{(position) => {
                  const node = () => nodeById().get(position.id)
                  const title = () => textOf(node()?.title, position.id)
                  const state = () => textOf(node()?.state, 'unknown')
                  return (
                    <button type="button" class="cdt-dag-node" data-tone={stateTone(node()?.state)} data-ghost={node()?.ghost || !node() ? 'true' : 'false'} aria-pressed={selectedId() === position.id} aria-label={`${title()}, ${state()}`} style={{ left: `${position.x}px`, top: `${position.y}px`, width: `${position.width}px`, height: `${position.height}px` }} onClick={() => choose(position.id)}>
                      <span class="cdt-dag-title">{title()}</span><span class="cdt-dag-meta">{state()} - {textOf(node()?.role, 'unknown')}</span>
                    </button>
                  )
                }}</For>
              </div>
            </div>

            <div class="cdt-dag-overview-wrap">
              <svg class="cdt-dag-overview" viewBox="0 0 180 72" role="img" aria-label="Graph minimap. Click to navigate; use the task list for keyboard navigation." onClick={(event) => {
                const bounds = event.currentTarget.getBoundingClientRect()
                const x = (event.clientX - bounds.left) / bounds.width * layout().width
                const y = (event.clientY - bounds.top) / bounds.height * layout().height
                let nearest: DagPosition | undefined
                let distance = Infinity
                for (const position of layout().nodes) {
                  const d = Math.hypot(position.x + position.width / 2 - x, position.y + position.height / 2 - y)
                  if (d < distance) { nearest = position; distance = d }
                }
                if (nearest) center(nearest)
              }}>
                <For each={layout().nodes}>{(position) => <rect x={layout().width ? position.x / layout().width * 176 : 0} y={layout().height ? position.y / layout().height * 68 : 0} width="2" height="2" fill="var(--text-muted, #aaa)" />}</For>
                <rect x={Math.max(0, -pan().x / zoom() / Math.max(layout().width, 1) * 176)} y={Math.max(0, -pan().y / zoom() / Math.max(layout().height, 1) * 68)} width={Math.min(176, viewport().width / zoom() / Math.max(layout().width, 1) * 176)} height={Math.min(68, viewport().height / zoom() / Math.max(layout().height, 1) * 68)} fill="var(--primary, #8aa8ff)" fill-opacity=".12" stroke="var(--primary, #8aa8ff)" />
              </svg>
              <span class="cdt-muted cdt-meta">Overview. Click to navigate; task list provides keyboard navigation.</span>
            </div>
            <p class="cdt-muted cdt-meta">Showing {visibleNodePositions().length} in viewport; {filtered().visible.length} match filters of {nodes().length} total. Edges to filtered or offscreen nodes are hidden.</p>

            <details class="cdt-dag-list">
              <summary>Accessible task list ({filtered().visible.length} matching tasks, {nodes().length} total)</summary>
              <div role="list"><For each={listPage()}>{(node) => <div role="listitem"><button type="button" aria-current={selectedId() === node.id ? 'true' : undefined} onClick={() => choose(node.id)}>{textOf(node.title, node.id)} - {textOf(node.state, 'unknown')}</button></div>}</For></div>
              <div class="cdt-dag-pagination"><button type="button" disabled={page() === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>Previous page</button><span>Page {page() + 1} of {maxPage() + 1}</span><button type="button" disabled={page() >= maxPage()} onClick={() => setPage((value) => Math.min(maxPage(), value + 1))}>Next page</button></div>
              <Show when={filtered().hiddenCount > 0}><p>{filtered().hiddenCount} tasks do not match the current search or state. Clear filters to reach them.</p></Show>
            </details>

            <Show when={selected()}>{(node) => {
              const task = () => props.detail?.tasks.find((item) => item.id === node().id)
              const attempt = () => task()?.latestAttempt
              const gate = () => props.gates?.tasks.find((item) => item.taskId === node().id)
              const dependencies = () => arrayOf<string>(node().dependencies)
              return (
                <div class="cdt-card cdt-dag-inspector">
                  <div class="cdt-row cdt-between"><strong>{textOf(node().title, node().id)}</strong><Badge tone={stateTone(node().state)} label={textOf(node().state, 'unknown')} /></div>
                  <dl class="cdt-kv">
                    <dt>Role</dt><dd>{textOf(node().role, 'unknown')}</dd>
                    <dt>Model slot</dt><dd>{textOf(node().modelSlot, 'unknown')}</dd>
                    <dt>Attempts</dt><dd>{textOf(node().attempts, '0')}</dd>
                    <dt>Latest model</dt><dd>{attempt() ? `${attempt()?.modelProvider}/${attempt()?.modelId}${attempt()?.modelVariant ? ` (${attempt()?.modelVariant})` : ''}` : 'No recorded attempt'}</dd>
                    <dt>Attempt result</dt><dd>{attempt() ? `${attempt()?.state}; exit ${attempt()?.exitCode ?? 'unknown'}${attempt()?.failureClass ? `; ${attempt()?.failureClass}` : ''}${attempt()?.startedAt && attempt()?.finishedAt && Number.isFinite(Date.parse(attempt()!.finishedAt!) - Date.parse(attempt()!.startedAt!)) ? `; ${Math.max(0, Date.parse(attempt()!.finishedAt!) - Date.parse(attempt()!.startedAt!))} ms` : ''}` : 'No recorded attempt'}</dd>
                    <dt>Verification</dt><dd>{gate()?.passed === true ? 'Passed' : gate()?.passed === false ? 'Failed' : 'No proof recorded'}</dd>
                    <dt>Acceptance criteria</dt><dd>{task()?.acceptanceCriteria?.length ? <ul><For each={task()!.acceptanceCriteria}>{(criterion) => <li>{criterion}</li>}</For></ul> : 'Not provided'}</dd>
                    <dt>Findings</dt><dd>{gate()?.findings.length ? <ul><For each={gate()!.findings}>{(finding) => <li>{finding.title} ({finding.status})</li>}</For></ul> : 'No findings recorded'}</dd>
                    <dt>Dependencies</dt><dd>{dependencies().length ? <span class="cdt-chips"><For each={dependencies()}>{(id) => <button type="button" class="cdt-chip cdt-dag-dependency" onClick={() => choose(id)}>{textOf(nodeById().get(id)?.title, id)}</button>}</For></span> : 'None'}</dd>
                  </dl>
                </div>
              )
            }}</Show>
          </Show>
        </Show>
      </Show>
    </Section>
  )
}
