import { For, Show } from 'solid-js'
import { usePlugin } from '@opencode/plugin/gui'
import type { RunSummary } from '../../rpc-contract'
import { arrayOf, recordOf, textOf } from '../data'
import { formatRelativeTime, stateTone, taskProgress, truncate } from '../format'
import { Badge, EmptyState, LoadingBlock, Section } from '../components'

export interface RunsViewProps {
  runs: RunSummary[]
  selectedId: string | null
  loading: boolean
  onSelect: (runId: string) => void
}

/** The fallback tab: newest runs first, one click selects the inspected run. */
export function RunsView(props: RunsViewProps) {
  const ctx = usePlugin()

  return (
    <Section
      title={ctx.t('runs.title')}
      aside={<span class="cdt-muted cdt-meta">{ctx.plural('runs.summary', arrayOf(props.runs).length)}</span>}
    >
      <Show
        when={arrayOf(props.runs).length > 0}
        fallback={
          props.loading ? (
            <LoadingBlock label={ctx.t('common.loading')} />
          ) : (
            <EmptyState title={ctx.t('runs.empty.title')} body={ctx.t('runs.empty.body')} />
          )
        }
      >
        <ul class="cdt-list">
          <For each={arrayOf(props.runs)}>
            {(run) => {
              const progress = () => taskProgress(recordOf(run.counts), run.taskCount)
              const objective = () => textOf(run.objective, run.id)
              return (
                <li>
                  <button
                    type="button"
                    class="cdt-run"
                    aria-pressed={props.selectedId === run.id}
                    aria-label={`${ctx.t('runs.select')}: ${truncate(objective(), 90)}`}
                    onClick={() => props.onSelect(run.id)}
                  >
                    <span class="cdt-row cdt-between">
                      <span class="cdt-run-objective">{objective()}</span>
                      <Badge tone={stateTone(run.state)} label={textOf(run.state, ctx.t('common.unknown'))} />
                    </span>
                    <span class="cdt-row cdt-wrap cdt-meta cdt-muted">
                      <span>
                        {ctx.t('runs.risk')}: {textOf(run.riskClass, ctx.t('common.unknown'))}
                      </span>
                      <span aria-hidden="true">&middot;</span>
                      <span>
                        {ctx.t('runs.mode')}: {textOf(run.operationMode, ctx.t('common.unknown'))}
                      </span>
                      <Show when={run.hasReceipt}>
                        <span aria-hidden="true">&middot;</span>
                        <span>{ctx.t('runs.receipt')}</span>
                      </Show>
                    </span>
                    <span
                      class="cdt-progress"
                      role="progressbar"
                      aria-label={ctx.t('runs.progress', {
                        completed: progress().completed,
                        total: progress().total,
                      })}
                      aria-valuemin={0}
                      aria-valuemax={progress().total}
                      aria-valuenow={progress().completed}
                    >
                      <span style={{ width: `${progress().percent}%` }} />
                    </span>
                    <span class="cdt-row cdt-between cdt-meta cdt-muted">
                      <span>
                        {ctx.t('runs.progress', {
                          completed: progress().completed,
                          total: progress().total,
                        })}
                      </span>
                      <span>{ctx.t('runs.updated', { when: formatRelativeTime(run.updatedAt) })}</span>
                    </span>
                    <span class="cdt-mono cdt-muted cdt-meta">{run.id}</span>
                  </button>
                </li>
              )
            }}
          </For>
        </ul>
      </Show>
    </Section>
  )
}
