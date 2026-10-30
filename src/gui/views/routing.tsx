import { For, Show, createMemo } from 'solid-js'
import { usePlugin } from '@opencode/plugin/gui'
import type { RoutingData, TimelineData, TimelineEvent } from '../../rpc-contract'
import { arrayOf, textOf } from '../data'
import {
  formatCost,
  formatDateTime,
  formatDuration,
  formatTokens,
  truncate,
} from '../format'
import { Badge, EmptyState, LoadingBlock, Section } from '../components'

export interface RoutingViewProps {
  data: RoutingData | null
  timeline: TimelineData | null
  loading: boolean
  hasRun: boolean
}

const MAX_EVENTS = 120

/** Fleet assignments, observed routes, cost/usage coverage and the event timeline. */
export function RoutingView(props: RoutingViewProps) {
  const ctx = usePlugin()

  const assignments = () => arrayOf<RoutingData['assignments'][number]>(props.data?.assignments)
  const observed = () => arrayOf<RoutingData['observed'][number]>(props.data?.observed)
  const byModel = () => arrayOf<RoutingData['costs']['byModel'][number]>(props.data?.costs.byModel)
  const events = createMemo(() =>
    arrayOf<TimelineEvent>(props.timeline?.events)
      .slice()
      .sort((left, right) => right.sequence - left.sequence)
      .slice(0, MAX_EVENTS),
  )

  const usageUnavailable = () => (
    <span class="cdt-muted">{ctx.t('routing.usageUnavailable')}</span>
  )

  return (
    <Section title={ctx.t('routing.title')}>
      <Show
        when={props.hasRun}
        fallback={<EmptyState title={ctx.t('runs.noSelection')} body={ctx.t('runs.empty.noSelection')} />}
      >
        <Show
          when={props.data}
          fallback={
            props.loading ? (
              <LoadingBlock label={ctx.t('common.loading')} />
            ) : (
              <EmptyState title={ctx.t('routing.empty.title')} body={ctx.t('routing.empty.body')} />
            )
          }
        >
            <section class="cdt-section" aria-label={ctx.t('routing.assignments')}>
              <h3 class="cdt-heading">{ctx.t('routing.assignments')}</h3>
              <Show
                when={assignments().length > 0}
                fallback={<p class="cdt-muted cdt-meta">{ctx.t('routing.noAssignments')}</p>}
              >
                <ul class="cdt-list">
                  <For each={assignments()}>
                    {(assignment) => (
                      <li class="cdt-card cdt-card-tight">
                        <div class="cdt-row cdt-between cdt-gap">
                          <span class="cdt-strong">{textOf(assignment.role, ctx.t('common.unknown'))}</span>
                          <Show when={assignment.variant}>
                            <Badge tone="pending" label={textOf(assignment.variant, '')} />
                          </Show>
                        </div>
                        <div class="cdt-mono cdt-meta cdt-muted">
                          {textOf(assignment.model, ctx.t('common.unknown'))}
                        </div>
                        <div class="cdt-meta cdt-muted">
                          {ctx.t('routing.source')}: {textOf(assignment.source, ctx.t('common.unknown'))}
                        </div>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </section>

            <section class="cdt-section" aria-label={ctx.t('routing.observed')}>
              <h3 class="cdt-heading">{ctx.t('routing.observed')}</h3>
              <Show
                when={observed().length > 0}
                fallback={<p class="cdt-muted cdt-meta">{ctx.t('routing.noObserved')}</p>}
              >
                <ul class="cdt-list">
                  <For each={observed()}>
                    {(route) => (
                      <li class="cdt-card cdt-card-tight">
                        <div class="cdt-row cdt-between cdt-gap">
                          <span class="cdt-strong">{textOf(route.role, ctx.t('common.unknown'))}</span>
                          <span class="cdt-muted cdt-meta">
                            {ctx.t('routing.attempts', { count: textOf(route.attempts, '0') })}
                          </span>
                        </div>
                        <div class="cdt-mono cdt-meta cdt-muted">
                          {textOf(route.modelProvider, ctx.t('common.unknown'))}/
                          {textOf(route.modelId, ctx.t('common.unknown'))}
                          <Show when={route.modelVariant}>/{textOf(route.modelVariant, '')}</Show>
                        </div>
                        <div class="cdt-row cdt-wrap cdt-meta cdt-muted">
                          <span>{textOf(route.modelSlot, ctx.t('common.unknown'))}</span>
                          <span aria-hidden="true">&middot;</span>
                          <span>{textOf(route.completed, '0')} completed</span>
                          <span aria-hidden="true">&middot;</span>
                          <span>{textOf(route.failed, '0')} failed</span>
                          <Show when={typeof route.avgDurationMs === 'number'}>
                            <span aria-hidden="true">&middot;</span>
                            <span>
                              {ctx.t('routing.avgDuration', {
                                duration: formatDuration(route.avgDurationMs),
                              })}
                            </span>
                          </Show>
                        </div>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </section>

            <section class="cdt-section" aria-label={ctx.t('routing.costs')}>
              <h3 class="cdt-heading">{ctx.t('routing.costs')}</h3>
              <dl class="cdt-kv">
                <dt>{ctx.t('routing.totalTokens')}</dt>
                <dd>{formatTokens(props.data?.costs.totalTokens) ?? usageUnavailable()}</dd>
                <dt>{ctx.t('routing.totalCost')}</dt>
                <dd>
                  {formatCost(props.data?.costs.totalCost, props.data?.costs.currency) ??
                    usageUnavailable()}
                </dd>
                <dt>{ctx.t('routing.coverage')}</dt>
                <dd>
                  {ctx.t('routing.coverageValue', {
                    withUsage: textOf(props.data?.costs.coverage.withUsage, '0'),
                    attempts: textOf(props.data?.costs.coverage.attempts, '0'),
                  })}
                </dd>
              </dl>
              <Show when={byModel().length > 0}>
                <ul class="cdt-list">
                  <For each={byModel()}>
                    {(row) => (
                      <li class="cdt-card cdt-card-tight">
                        <div class="cdt-row cdt-between cdt-gap">
                          <span class="cdt-mono cdt-strong">{textOf(row.model, ctx.t('common.unknown'))}</span>
                          <span class="cdt-muted cdt-meta">
                            {ctx.t('routing.attempts', { count: textOf(row.attempts, '0') })}
                          </span>
                        </div>
                        <div class="cdt-row cdt-wrap cdt-meta cdt-muted">
                          <span>
                            {ctx.t('routing.totalTokens')}:{' '}
                            {formatTokens(row.tokens) ?? usageUnavailable()}
                          </span>
                          <span aria-hidden="true">&middot;</span>
                          <span>
                            {ctx.t('routing.totalCost')}:{' '}
                            {formatCost(row.cost, row.currency ?? props.data?.costs.currency) ??
                              usageUnavailable()}
                          </span>
                        </div>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </section>

            <section class="cdt-section" aria-label={ctx.t('routing.timeline')}>
              <div class="cdt-row cdt-between">
                <h3 class="cdt-heading">{ctx.t('routing.timeline')}</h3>
                <Show when={props.timeline?.truncated}>
                  <Badge tone="pending" label={ctx.t('routing.truncated')} />
                </Show>
              </div>
              <Show
                when={events().length > 0}
                fallback={<p class="cdt-muted cdt-meta">{ctx.t('routing.noEvents')}</p>}
              >
                <ol class="cdt-list">
                  <For each={events()}>
                    {(event) => (
                      <li class="cdt-event">
                        <span class="cdt-event-seq" aria-hidden="true">
                          {event.sequence}
                        </span>
                        <div class="cdt-event-body">
                          <div class="cdt-row cdt-between cdt-gap">
                            <span class="cdt-strong cdt-mono">{textOf(event.type, ctx.t('common.unknown'))}</span>
                            <time class="cdt-muted cdt-meta" datetime={textOf(event.createdAt, '')}>
                              {formatDateTime(event.createdAt)}
                            </time>
                          </div>
                          <div class="cdt-meta cdt-muted">
                            {textOf(event.actor, ctx.t('common.unknown'))}
                            <Show when={event.taskId}>
                              {' \u00b7 '}
                              <span class="cdt-mono">{event.taskId}</span>
                            </Show>
                            <Show when={event.attemptId}>
                              {' \u00b7 '}
                              <span class="cdt-mono">{truncate(event.attemptId, 18)}</span>
                            </Show>
                          </div>
                          <Show when={event.summary}>
                            <p class="cdt-event-summary">{truncate(event.summary, 240)}</p>
                          </Show>
                        </div>
                      </li>
                    )}
                  </For>
                </ol>
              </Show>
            </section>
          </Show>
        </Show>
    </Section>
  )
}
