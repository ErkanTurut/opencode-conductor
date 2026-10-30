import { For, Show } from 'solid-js'
import { usePlugin } from '@opencode/plugin/gui'
import type { RefinementData } from '../../rpc-contract'
import { arrayOf, openQuestions, textOf } from '../data'
import { stateTone } from '../format'
import { Badge, EmptyState, LoadingBlock, Section } from '../components'

export interface RefinementsViewProps {
  data: RefinementData | null
  loading: boolean
  hasRun: boolean
}

/** Refinement round: state, uncertainties, Q&A, requirements and open questions. */
export function RefinementsView(props: RefinementsViewProps) {
  const ctx = usePlugin()

  const state = () => textOf(props.data?.state, ctx.t('common.unknown'))
  const uncertainties = () => arrayOf<string>(props.data?.uncertainties)
  const qaPairs = () =>
    arrayOf<RefinementData['qaPairs'][number]>(props.data?.qaPairs).filter(
      (pair) => textOf(pair.question, '').length > 0 || textOf(pair.answer, '').length > 0,
    )
  const questions = () => openQuestions(props.data?.contract)
  const requirements = () => textOf(props.data?.requirementsMarkdown, '')

  return (
    <Section
      title={ctx.t('refinements.title')}
      aside={<Badge tone={stateTone(props.data?.state)} label={state()} />}
    >
      <Show
        when={props.hasRun}
        fallback={<EmptyState title={ctx.t('runs.noSelection')} body={ctx.t('runs.empty.noSelection')} />}
      >
        <Show
          when={props.data}
          fallback={props.loading ? <LoadingBlock label={ctx.t('common.loading')} /> : null}
        >
          <Show when={props.data?.state !== 'none'}>
            <dl class="cdt-kv">
              <dt>{ctx.t('refinements.state')}</dt>
              <dd>{state()}</dd>
              <Show when={props.data?.outcome}>
                <dt>{ctx.t('refinements.outcome')}</dt>
                <dd>{textOf(props.data?.outcome, ctx.t('common.unknown'))}</dd>
              </Show>
              <Show when={props.data?.requirementsPath}>
                <dt>{ctx.t('refinements.source')}</dt>
                <dd class="cdt-mono">{textOf(props.data?.requirementsPath, '')}</dd>
              </Show>
            </dl>
          </Show>

          <Show
            when={uncertainties().length > 0}
            fallback={<p class="cdt-muted cdt-meta">{ctx.t('refinements.noUncertainties')}</p>}
          >
            <span class="cdt-label">{ctx.t('refinements.uncertainties')}</span>
            <ul class="cdt-list">
              <For each={uncertainties()}>
                {(uncertainty) => (
                  <li class="cdt-card cdt-card-tight">{uncertainty}</li>
                )}
              </For>
            </ul>
          </Show>

          <span class="cdt-label">{ctx.t('refinements.qa')}</span>
          <Show
            when={qaPairs().length > 0}
            fallback={<p class="cdt-muted cdt-meta">{ctx.t('refinements.noQa')}</p>}
          >
            <ul class="cdt-list">
              <For each={qaPairs()}>
                {(pair) => (
                  <li class="cdt-qa">
                    <div class="cdt-qa-question">
                      <span class="cdt-muted">{ctx.t('refinements.question')}: </span>
                      {textOf(pair.question, ctx.t('common.unknown'))}
                    </div>
                    <p class="cdt-qa-answer">
                      <span class="cdt-muted">{ctx.t('refinements.answer')}: </span>
                      {textOf(pair.answer, ctx.t('common.unknown'))}
                    </p>
                  </li>
                )}
              </For>
            </ul>
          </Show>

          <span class="cdt-label">{ctx.t('refinements.openQuestions')}</span>
          <Show
            when={questions().length > 0}
            fallback={<p class="cdt-muted cdt-meta">{ctx.t('refinements.noOpenQuestions')}</p>}
          >
            <ul class="cdt-list">
              <For each={questions()}>
                {(question) => <li class="cdt-card cdt-card-tight">{question}</li>}
              </For>
            </ul>
          </Show>

          <span class="cdt-label">{ctx.t('refinements.requirements')}</span>
          <Show
            when={requirements().length > 0}
            fallback={<p class="cdt-muted cdt-meta">{ctx.t('refinements.noRequirements')}</p>}
          >
            <pre class="cdt-pre" tabindex="0" aria-label={ctx.t('refinements.requirements')}>
              {requirements()}
            </pre>
          </Show>
        </Show>
      </Show>
    </Section>
  )
}
