import { For, Show } from 'solid-js'
import { usePlugin } from '@opencode/plugin/gui'
import type { GateFinding, GatesData, GateVerification } from '../../rpc-contract'
import { arrayOf, textOf } from '../data'
import { decisionTone, formatDateTime, formatDuration, stateTone, truncate } from '../format'
import { Badge, EmptyState, LoadingBlock, Section } from '../components'

export interface GatesViewProps {
  data: GatesData | null
  loading: boolean
  hasRun: boolean
}

/** Approvals, per-task verification evidence and review findings. Read-only. */
export function GatesView(props: GatesViewProps) {
  const ctx = usePlugin()

  const approvals = () => arrayOf<GatesData['approvals'][number]>(props.data?.approvals)
  const tasks = () => arrayOf<GatesData['tasks'][number]>(props.data?.tasks)

  const passedLabel = (passed: boolean | null | undefined): string => {
    if (typeof passed !== 'boolean') return ctx.t('gates.notRun')
    return passed ? ctx.t('gates.passed') : ctx.t('gates.failed')
  }

  return (
    <Section
      title={ctx.t('gates.title')}
      aside={
        <Show when={props.data}>
          <Badge
            tone={props.data?.readiness ? (props.data.readiness.evidenceReady ? 'completed' : 'blocked') : 'unknown'}
            label={props.data?.readiness ? (props.data.readiness.evidenceReady ? 'Evidence ready' : 'Evidence incomplete') : 'Evidence readiness unknown'}
          />
        </Show>
      }
    >
      <Show
        when={props.hasRun}
        fallback={<EmptyState title={ctx.t('runs.noSelection')} body={ctx.t('runs.empty.noSelection')} />}
      >
        <Show
          when={props.data}
          fallback={props.loading ? <LoadingBlock label={ctx.t('common.loading')} /> : null}
        >
          <div class="cdt-inspector-note">
            <strong>Not merge authorization.</strong> Recorded evidence does not authorize a push or merge.
            <Show when={props.data?.readiness} fallback={<p>Evidence readiness is unavailable for this server.</p>}>
              {(readiness) => <Show when={arrayOf<string>(readiness().reasons).length > 0}><ul><For each={arrayOf<string>(readiness().reasons)}>{reason => <li>{reason}</li>}</For></ul></Show>}
            </Show>
          </div>
          <Show
            when={approvals().length > 0 || tasks().length > 0}
            fallback={<EmptyState title={ctx.t('gates.empty.title')} body={ctx.t('gates.empty.body')} />}
          >
            <section class="cdt-section" aria-label={ctx.t('gates.approvals')}>
              <h3 class="cdt-heading">{ctx.t('gates.approvals')}</h3>
              <Show
                when={approvals().length > 0}
                fallback={<p class="cdt-muted cdt-meta">{ctx.t('gates.noApprovals')}</p>}
              >
                <ul class="cdt-list">
                  <For each={approvals()}>
                    {(approval) => (
                      <li class="cdt-card cdt-card-tight">
                        <div class="cdt-row cdt-between cdt-gap">
                          <span class="cdt-strong">{textOf(approval.gate, ctx.t('common.unknown'))}</span>
                          <Badge
                            tone={decisionTone(approval.decision)}
                            label={textOf(approval.decision, ctx.t('common.unknown'))}
                          />
                        </div>
                        <div class="cdt-row cdt-wrap cdt-meta cdt-muted">
                          <span>
                            {ctx.t('gates.actor')}: {textOf(approval.actor, ctx.t('common.unknown'))}
                          </span>
                          <span aria-hidden="true">&middot;</span>
                          <time datetime={textOf(approval.createdAt, '')}>
                            {formatDateTime(approval.createdAt)}
                          </time>
                          <Show when={approval.expiresAt}>
                            <span aria-hidden="true">&middot;</span>
                            <span>{ctx.t('gates.expires', { when: formatDateTime(approval.expiresAt) })}</span>
                          </Show>
                        </div>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </section>

            <section class="cdt-section" aria-label={ctx.t('gates.verification')}>
              <h3 class="cdt-heading">{ctx.t('gates.verification')}</h3>
              <ul class="cdt-list">
                <For each={tasks()}>
                  {(task) => {
                    const verifications = () => arrayOf<GateVerification>(task.verifications)
                    const findings = () => arrayOf<GateFinding>(task.findings)
                    return (
                      <li class="cdt-card">
                        <div class="cdt-row cdt-between cdt-gap">
                          <span class="cdt-strong">{textOf(task.title, task.taskId)}</span>
                          <Badge
                            tone={stateTone(task.state)}
                            label={textOf(task.state, ctx.t('common.unknown'))}
                          />
                        </div>
                        <div class="cdt-row cdt-wrap cdt-meta cdt-muted">
                          <Show when={typeof task.attemptNo === 'number'}>
                            <span>{ctx.t('gates.attempt', { no: textOf(task.attemptNo, '0') })}</span>
                            <span aria-hidden="true">&middot;</span>
                          </Show>
                          <Badge
                            tone={typeof task.passed === 'boolean' ? (task.passed ? 'completed' : 'failed') : 'pending'}
                            label={passedLabel(task.passed)}
                          />
                          <Show when={task.blockingFindings > 0}>
                            <Badge
                              tone="failed"
                              label={`${textOf(task.blockingFindings, '0')} ${ctx.t('gates.blocking')}`}
                            />
                          </Show>
                          <Show when={task.openFindings > 0}>
                            <Badge
                              tone="pending"
                              label={`${textOf(task.openFindings, '0')} ${ctx.t('gates.open')}`}
                            />
                          </Show>
                        </div>

                        <span class="cdt-label">{ctx.t('gates.verification')}</span>
                        <Show
                          when={verifications().length > 0}
                          fallback={<p class="cdt-muted cdt-meta">{ctx.t('gates.noVerifications')}</p>}
                        >
                          <ul class="cdt-list">
                            <For each={verifications()}>
                              {(verification) => (
                                <li class="cdt-verify">
                                  <code class="cdt-command" title={verification.command}>
                                    {textOf(verification.command, ctx.t('common.unknown'))}
                                  </code>
                                  <div class="cdt-row cdt-wrap cdt-meta">
                                    <Badge
                                      tone={verification.passed ? 'completed' : 'failed'}
                                      label={verification.passed ? ctx.t('gates.passed') : ctx.t('gates.failed')}
                                    />
                                    <span class="cdt-muted">
                                      {ctx.t('gates.exit', { code: textOf(verification.exitCode, '?') })}
                                    </span>
                                    <span class="cdt-muted">
                                      {formatDuration(verification.durationMs)}
                                    </span>
                                    <Show when={verification.outputHash}>
                                      <span class="cdt-mono cdt-muted" title={verification.outputHash}>
                                        {truncate(verification.outputHash, 12)}
                                      </span>
                                    </Show>
                                  </div>
                                </li>
                              )}
                            </For>
                          </ul>
                        </Show>

                        <Show when={findings().length > 0}>
                          <span class="cdt-label">{ctx.t('gates.findings')}</span>
                          <For each={findings()}>
                            {(finding) => (
                              <div
                                class="cdt-finding"
                                data-blocking={finding.blocking ? 'true' : 'false'}
                              >
                                <div class="cdt-row cdt-between cdt-gap">
                                  <span class="cdt-strong">
                                    {textOf(finding.title, ctx.t('common.unknown'))}
                                  </span>
                                  <Badge
                                    tone={finding.blocking ? 'failed' : 'pending'}
                                    label={textOf(finding.severity, ctx.t('common.unknown'))}
                                  />
                                </div>
                                <div class="cdt-meta cdt-muted">
                                  {textOf(finding.category, ctx.t('common.unknown'))}
                                  {' \u00b7 '}
                                  {textOf(finding.status, ctx.t('common.unknown'))}
                                  <Show when={finding.location}>
                                    {' \u00b7 '}
                                    <span class="cdt-mono">{finding.location}</span>
                                  </Show>
                                </div>
                                <Show when={finding.evidence}>
                                  <p class="cdt-evidence">{truncate(finding.evidence, 260)}</p>
                                </Show>
                                <Show when={finding.requiredFix}>
                                  <p class="cdt-required">
                                    <span class="cdt-label">{ctx.t('gates.requiredFix')}</span>
                                    {finding.requiredFix}
                                  </p>
                                </Show>
                              </div>
                            )}
                          </For>
                        </Show>
                        <Show when={findings().length === 0}>
                          <p class="cdt-muted cdt-meta">{ctx.t('gates.noFindings')}</p>
                        </Show>
                      </li>
                    )
                  }}
                </For>
              </ul>
            </section>
          </Show>
        </Show>
      </Show>
    </Section>
  )
}
