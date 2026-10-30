import { For, Show, createSignal } from 'solid-js'
import { usePlugin } from '@opencode/plugin/gui'
import type { MemoryBlockData, MemoryBlockSummary, MemoryData } from '../../rpc-contract'
import { arrayOf, textOf } from '../data'
import { formatConfidence, formatDate, stateTone, truncate } from '../format'
import { Badge, EmptyState, LoadingBlock, Section } from '../components'

export interface MemoryViewProps {
  data: MemoryData | null
  loading: boolean
  loadBlock: (label: string, version: number) => Promise<MemoryBlockData | null>
}

function blockKey(block: MemoryBlockSummary): string {
  return `${block.label}@${block.version}`
}

/** Memory blocks, newest version per label; click a row to read the full content. */
export function MemoryView(props: MemoryViewProps) {
  const ctx = usePlugin()
  const [expanded, setExpanded] = createSignal<string | null>(null)
  const [contents, setContents] = createSignal<Record<string, MemoryBlockData | null>>({})
  const [pending, setPending] = createSignal<string | null>(null)

  const blocks = () => arrayOf<MemoryBlockSummary>(props.data?.blocks)

  async function toggle(block: MemoryBlockSummary) {
    const key = blockKey(block)
    if (expanded() === key) {
      setExpanded(null)
      return
    }
    setExpanded(key)
    if (Object.prototype.hasOwnProperty.call(contents(), key)) return
    setPending(key)
    const loaded = await props.loadBlock(textOf(block.label, ''), block.version)
    setPending((current) => (current === key ? null : current))
    setContents((current) => ({ ...current, [key]: loaded }))
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
              const loaded = () => contents()[key()]
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
                    <Show when={block.contentPreview}>
                      <span class="cdt-memory-preview">{truncate(block.contentPreview, 160)}</span>
                    </Show>
                    <span class="cdt-label">
                      {expanded() === key() ? ctx.t('memory.collapse') : ctx.t('memory.expand')}
                    </span>
                  </button>

                  <Show when={expanded() === key()}>
                    <div class="cdt-memory-content" id={contentId()}>
                      <Show
                        when={pending() !== key()}
                        fallback={<p class="cdt-muted cdt-meta">{ctx.t('memory.loading')}</p>}
                      >
                        <Show
                          when={loaded()}
                          fallback={<p class="cdt-muted cdt-meta">{ctx.t('memory.contentUnavailable')}</p>}
                        >
                          {(blockData) => (
                            <pre class="cdt-pre" tabindex="0" aria-label={blockData().label}>
                              {blockData().content}
                            </pre>
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
