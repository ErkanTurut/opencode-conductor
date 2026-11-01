import { For, Show, createEffect, createSignal, onCleanup } from 'solid-js'
import { usePlugin } from '@opencode/plugin/gui'
import type { MemoryBlockData, MemoryBlockSummary, MemoryData } from '../../rpc-contract'
import { arrayOf, textOf } from '../data'
import { formatConfidence, formatDate, stateTone, truncate } from '../format'
import { Badge, EmptyState, LoadingBlock, Section } from '../components'

export interface MemoryViewProps {
  data: MemoryData | null
  loading: boolean
  loadBlock: (label: string, version: number) => Promise<MemoryBlockData | null>
  /** Project identity; change it whenever the session directory changes. */
  scopeKey?: string
}

/** A late expansion result must never cross a project or component lifetime. */
export function memoryRequestIsCurrent(disposed: boolean, generation: number, requestGeneration: number, scope: string | undefined, requestScope: string | undefined): boolean {
  return !disposed && generation === requestGeneration && scope === requestScope
}

function blockKey(block: MemoryBlockSummary): string {
  return `${block.label}@${block.version}`
}

/** Memory blocks, newest version per label; click a row to read the full content. */
export function MemoryView(props: MemoryViewProps) {
  const ctx = usePlugin()
  const [expanded, setExpanded] = createSignal<string | null>(null)
  const [contents, setContents] = createSignal<Record<string, MemoryBlockData | null>>({})
  const [pending, setPending] = createSignal<Record<string, boolean>>({})
  let generation = 0
  let disposed = false
  let cacheScope = props.scopeKey
  createEffect(() => {
    cacheScope = props.scopeKey
    generation++
    setExpanded(null)
    setContents({})
    setPending({})
  })
  onCleanup(() => { disposed = true; generation++ })

  const blocks = () => arrayOf<MemoryBlockSummary>(props.data?.blocks)

  async function toggle(block: MemoryBlockSummary) {
    const key = blockKey(block)
    if (expanded() === key) {
      setExpanded(null)
      return
    }
    setExpanded(key)
    if (Object.prototype.hasOwnProperty.call(contents(), key) || pending()[key]) return
    const requestGeneration = generation
    const requestScope = props.scopeKey
    setPending(current => ({ ...current, [key]: true }))
    let loaded: MemoryBlockData | null = null
    try { loaded = await props.loadBlock(textOf(block.label, ''), block.version) } catch { /* shown as unavailable */ }
    if (!memoryRequestIsCurrent(disposed, generation, requestGeneration, props.scopeKey, requestScope)) return
    setPending(current => ({ ...current, [key]: false }))
    setContents(current => ({ ...current, [key]: loaded }))
  }

  return (
    <Section
      title={ctx.t('memory.title')}
      aside={
        <span class="cdt-muted cdt-meta">
          {ctx.plural('memory.summary', arrayOf(props.data?.blocks).length)}
        </span>
      }
    >
      <Show
        when={blocks().length > 0}
        fallback={
          props.loading ? (
            <LoadingBlock label={ctx.t('common.loading')} />
          ) : (
            <EmptyState title={ctx.t('memory.empty.title')} body={ctx.t('memory.empty.body')} />
          )
        }
      >
        <ul class="cdt-list">
          <For each={blocks()}>
            {(block, index) => {
              const key = () => blockKey(block)
              const contentId = () => `cdt-memory-content-${index()}`
              const loaded = () => props.scopeKey === cacheScope ? contents()[key()] : null
              return (
                <li>
                  <button
                    type="button"
                    class="cdt-memory"
                    aria-expanded={expanded() === key()}
                    aria-controls={contentId()}
                    onClick={() => void toggle(block)}
                  >
                    <span class="cdt-row cdt-between cdt-gap">
                      <span class="cdt-strong">{textOf(block.label, ctx.t('common.unknown'))}</span>
                      <span class="cdt-row cdt-gap">
                        <span class="cdt-mono cdt-muted cdt-meta">
                          {ctx.t('memory.version', { version: textOf(block.version, '0') })}
                        </span>
                        <Badge
                          tone={stateTone(block.status)}
                          label={textOf(block.status, ctx.t('common.unknown'))}
                        />
                      </span>
                    </span>
                    <span class="cdt-row cdt-wrap cdt-meta cdt-muted">
                      <span>
                        {ctx.t('memory.scope')}: {textOf(block.scope, ctx.t('common.unknown'))}
                      </span>
                      <span aria-hidden="true">&middot;</span>
                      <span>
                        {ctx.t('memory.confidence')}: {formatConfidence(block.confidence)}
                      </span>
                      <span aria-hidden="true">&middot;</span>
                      <span>
                        {typeof block.reviewAfter === 'string'
                          ? ctx.t('memory.reviewAfter', { when: formatDate(block.reviewAfter) })
                          : ctx.t('memory.noReview')}
                      </span>
                    </span>
                    <span class="cdt-row cdt-wrap cdt-meta">
                      <span>Review: {block.review?.classification === 'unreviewed' ? 'unreviewed (pending promotion)' : textOf(block.review?.classification, 'unknown')}</span>
                      <span aria-hidden="true">&middot;</span>
                      <span>Eligible: {typeof block.review?.eligible === 'boolean' ? (block.review.eligible ? 'yes' : 'no') : 'unknown'}</span>
                    </span>
                    <span class="cdt-meta cdt-muted">Source run: {textOf(block.sourceRunId, 'unknown')}</span>
                    <Show when={arrayOf<string>(block.review?.reasons).length}><span class="cdt-meta cdt-muted">Review reasons: {arrayOf<string>(block.review?.reasons).join(', ')}</span></Show>
                    <Show when={block.contentPreview}>
                      <span class="cdt-memory-preview">{truncate(block.contentPreview, 160)}</span>
                    </Show>
                    <span class="cdt-label">
                      {expanded() === key() ? ctx.t('memory.collapse') : ctx.t('memory.expand')}
                    </span>
                  </button>

                  <Show when={props.scopeKey === cacheScope && expanded() === key()}>
                    <div class="cdt-memory-content" id={contentId()}>
                      <Show
                        when={!pending()[key()]}
                        fallback={<p class="cdt-muted cdt-meta">{ctx.t('memory.loading')}</p>}
                      >
                        <Show
                          when={loaded()}
                          fallback={<p class="cdt-muted cdt-meta">{ctx.t('memory.contentUnavailable')}</p>}
                        >
                          {(blockData) => (
                            <>
                              <div class="cdt-inspector-review">
                                <p><strong>Review classification:</strong> {blockData().review?.classification === 'unreviewed' ? 'unreviewed (pending promotion)' : textOf(blockData().review?.classification ?? block.review?.classification, 'unknown')}</p>
                                <p><strong>Eligibility:</strong> {typeof (blockData().review ?? block.review)?.eligible === 'boolean' ? ((blockData().review ?? block.review)?.eligible ? 'eligible' : 'not eligible') : 'unknown'}</p>
                                <p><strong>Suggested action:</strong> {(blockData().review ?? block.review)?.action === 'propose_review' ? 'propose review' : textOf((blockData().review ?? block.review)?.action, 'unknown')}</p>
                                <Show when={arrayOf<string>((blockData().review ?? block.review)?.reasons).length}><p><strong>Reasons:</strong> {arrayOf<string>((blockData().review ?? block.review)?.reasons).join(', ')}</p></Show>
                                <p><strong>Source run:</strong> {textOf(blockData().sourceRunId, 'unknown')}</p>
                                <p><strong>Source artifacts:</strong> {arrayOf<string>(blockData().sourceArtifacts).join(', ') || 'unknown'}</p>
                                <p><strong>Actor:</strong> {textOf(blockData().actor, 'unknown')} · <strong>Content hash:</strong> {textOf(blockData().contentHash, 'unknown')}</p>
                                <Show when={blockData().supersedes}><p><strong>Supersedes:</strong> {blockData().supersedes}</p></Show>
                              </div>
                              <pre class="cdt-pre" tabindex="0" aria-label={blockData().label}>{blockData().content}</pre>
                            </>
                          )}
                        </Show>
                      </Show>
                    </div>
                  </Show>
                </li>
              )
            }}
          </For>
        </ul>
      </Show>
    </Section>
  )
}
