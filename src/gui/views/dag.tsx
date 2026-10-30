import { For, Show, createEffect, createMemo, createSignal } from 'solid-js'
import { usePlugin } from '@opencode/plugin/gui'
import type { DagData, DagNode } from '../../rpc-contract'
import { arrayOf, textOf } from '../data'
import { buildDagLayout, dagEdgePath } from '../dag-layout'
import { stateTone } from '../format'
import { Badge, EmptyState, LoadingBlock, Section } from '../components'

export interface DagViewProps {
  data: DagData | null
  loading: boolean
  hasRun: boolean
}

interface RenderedEdge {
  key: string
  path: string
  resolved: boolean
}

/** Task graph: layers become rows, dependencies become curved edges. */
export function DagView(props: DagViewProps) {
  const ctx = usePlugin()
  const [selectedId, setSelectedId] = createSignal<string | null>(null)

  const nodes = createMemo(() => arrayOf<DagNode>(props.data?.nodes))
  const nodeById = createMemo(() => new Map(nodes().map((node) => [node.id, node])))
  const layout = createMemo(() => buildDagLayout(props.data?.layers, nodes().map((node) => node.id)))
  const edges = createMemo<RenderedEdge[]>(() => {
    const positions = layout().byId
    return arrayOf<DagData['edges'][number]>(props.data?.edges).flatMap((edge) => {
      const from = positions[edge.from]
      const to = positions[edge.to]
      if (!from || !to) return []
      return [
        {
          key: `${edge.from}->${edge.to}`,
          path: dagEdgePath(from, to),
          resolved: edge.resolved !== false,
        },
      ]
    })
  })
  const selected = createMemo(() => {
    const id = selectedId()
    return id ? nodeById().get(id) ?? null : null
  })

  createEffect(() => {
    const id = selectedId()
    if (id && !nodeById().has(id)) setSelectedId(null)
  })

  return (
    <Section title={ctx.t('dag.title')}>
      <Show
        when={props.hasRun}
        fallback={<EmptyState title={ctx.t('runs.noSelection')} body={ctx.t('runs.empty.noSelection')} />}
      >
        <Show
          when={props.data}
          fallback={props.loading ? <LoadingBlock label={ctx.t('common.loading')} /> : null}
        >
          <Show
            when={layout().nodes.length > 0}
            fallback={<EmptyState title={ctx.t('dag.empty.title')} body={ctx.t('dag.empty.body')} />}
          >
            <Show when={arrayOf<string[]>(props.data?.cycles).length > 0}>
              <p class="cdt-error">
                {ctx.t('dag.cycles')}:{' '}
                <span class="cdt-mono">{arrayOf<string[]>(props.data?.cycles).map((cycle) => cycle.join(' \u2192 ')).join('; ')}</span>
              </p>
            </Show>
            <Show when={arrayOf<string>(props.data?.dangling).length > 0}>
              <p class="cdt-muted cdt-meta">
                {ctx.t('dag.dangling')}:{' '}
                <span class="cdt-mono">{arrayOf<string>(props.data?.dangling).join(', ')}</span>
              </p>
            </Show>

            <div class="cdt-dag-canvas" role="group" aria-label={ctx.t('dag.title')}>
              <div
                class="cdt-dag-inner"
                style={{ width: `${layout().width}px`, height: `${layout().height}px` }}
              >
                <svg
                  class="cdt-dag-edges"
                  width={layout().width}
                  height={layout().height}
                  aria-hidden="true"
                >
                  <For each={edges()}>
                    {(edge) => (
                      <path
                        class="cdt-dag-edge"
                        data-resolved={edge.resolved ? 'true' : 'false'}
                        d={edge.path}
                      />
                    )}
                  </For>
                </svg>
                <For each={layout().nodes}>
                  {(position) => {
                    const node = () => nodeById().get(position.id)
                    const state = () => textOf(node()?.state, ctx.t('common.unknown'))
                    const meta = () =>
                      [node()?.role, node()?.modelSlot]
                        .map((value) => textOf(value, ''))
                        .filter((value) => value.length > 0)
                        .join(' \u00b7 ')
                    return (
                      <button
                        type="button"
                        class="cdt-dag-node"
                        data-tone={stateTone(node()?.state)}
                        data-ghost={node()?.ghost ? 'true' : 'false'}
                        aria-pressed={selectedId() === position.id}
                        aria-label={`${textOf(node()?.title, position.id)}, ${state()}${
                          meta() ? `, ${meta()}` : ''
                        }`}
                        style={{
                          left: `${position.x}px`,
                          top: `${position.y}px`,
                          width: `${position.width}px`,
                          height: `${position.height}px`,
                        }}
                        onClick={() => setSelectedId(position.id)}
                      >
                        <span class="cdt-dag-title">{textOf(node()?.title, position.id)}</span>
                        <span class="cdt-dag-meta">{meta() || position.id}</span>
                      </button>
                    )
                  }}
                </For>
              </div>
            </div>

            <Show
              when={selected()}
              fallback={<p class="cdt-muted cdt-meta">{ctx.t('dag.hint')}</p>}
            >
              {(node) => (
                <div class="cdt-card">
                  <div class="cdt-row cdt-between cdt-gap">
                    <span class="cdt-strong">{textOf(node().title, node().id)}</span>
                    <span class="cdt-row cdt-gap">
                      <Show when={node().ghost}>
                        <Badge tone="pending" label={ctx.t('dag.ghost')} />
                      </Show>
                      <Badge
                        tone={stateTone(node().state)}
                        label={textOf(node().state, ctx.t('common.unknown'))}
                      />
                    </span>
                  </div>
                  <dl class="cdt-kv">
                    <dt>{ctx.t('dag.role')}</dt>
                    <dd>{textOf(node().role, ctx.t('common.unknown'))}</dd>
                    <dt>{ctx.t('dag.model')}</dt>
                    <dd class="cdt-mono">{textOf(node().modelSlot, ctx.t('common.unknown'))}</dd>
                    <dt>{ctx.t('dag.attempts')}</dt>
                    <dd>{textOf(node().attempts, '0')}</dd>
                    <dt>{ctx.t('dag.layer')}</dt>
                    <dd>
                      {textOf(node().layer, '0')} / {textOf(props.data?.maxDepth, '0')}
                    </dd>
                    <dt>{ctx.t('dag.dependencies')}</dt>
                    <dd>
                      <Show
                        when={arrayOf<string>(node().dependencies).length > 0}
                        fallback={<span class="cdt-muted">{ctx.t('dag.noDependencies')}</span>}
                      >
                        <span class="cdt-chips">
                          <For each={arrayOf<string>(node().dependencies)}>
                            {(dependency) => <span class="cdt-chip">{dependency}</span>}
                          </For>
                        </span>
                      </Show>
                    </dd>
                  </dl>
                </div>
              )}
            </Show>
          </Show>
        </Show>
      </Show>
    </Section>
  )
}
