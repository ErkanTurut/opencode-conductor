import { Command, Panel, Plugin, Style, type PanelTab } from '@opencode/plugin/gui'
import { CONDUCTOR_TABS, ConductorPanel } from './gui/panel'
import { PANEL_CSS } from './gui/styles'

const TITLES: Readonly<Record<(typeof CONDUCTOR_TABS)[number], string>> = {
  runs: 'tab.runs',
  dag: 'tab.dag',
  gates: 'tab.gates',
  refinements: 'tab.refinements',
  memory: 'tab.memory',
  routing: 'tab.routing',
}

/**
 * Native OpenCode Desktop GUI for the Conductor supervisor.
 *
 * The panel is read-only observability: six group tabs over one mounted render,
 * fed by the typed RPC contract in `src/rpc-contract.ts`. No approval, retry or
 * launch action lives here.
 */
export default Plugin.define({
  i18n: {
    en: {
      'panel.title': 'Conductor',
      'panel.noRun': 'No run selected',
      'command.open': 'Open Conductor panel',
      'command.description':
        'Inspect runs, the task graph, gates, refinements, memory and model routing.',
      'tab.runs': 'Runs',
      'tab.dag': 'DAG',
      'tab.gates': 'Gates',
      'tab.refinements': 'Refinements',
      'tab.memory': 'Memory',
      'tab.routing': 'Routing',

      'common.loading': 'Loading\u2026',
      'common.unknown': 'unknown',
      'common.error': 'Could not load data: {{message}}',
      'common.retryHint': 'The panel retries every 3 seconds.',

      'runs.title': 'Runs',
      'runs.summary.one': '{{count}} run',
      'runs.summary.other': '{{count}} runs',
      'runs.events.one': '{{count}} event',
      'runs.events.other': '{{count}} events',
      'runs.empty.title': 'No runs yet',
      'runs.empty.body': 'A run appears here once the supervisor starts one in this project.',
      'runs.select': 'Select run',
      'runs.risk': 'Risk',
      'runs.mode': 'Mode',
      'runs.receipt': 'receipt',
      'runs.progress': '{{completed}}/{{total}} tasks',
      'runs.updated': 'Updated {{when}}',
      'runs.noSelection': 'Select a run',
      'runs.empty.noSelection': 'Pick a run in the Runs tab to inspect this view.',

      'dag.title': 'Task graph',
      'dag.empty.title': 'No task graph',
      'dag.empty.body': 'This run has no plan or tasks yet.',
      'dag.cycles': 'Dependency cycle',
      'dag.dangling': 'Unknown dependencies',
      'dag.ghost': 'ghost',
      'dag.role': 'Role',
      'dag.model': 'Model',
      'dag.attempts': 'Attempts',
      'dag.layer': 'Layer',
      'dag.dependencies': 'Dependencies',
      'dag.noDependencies': 'No dependencies',
      'dag.hint': 'Select a task to see its role, model, attempts and dependencies.',

      'gates.title': 'Gates',
      'gates.empty.title': 'No gates',
      'gates.empty.body': 'This run has no approvals or verification evidence yet.',
      'gates.approvals': 'Approvals',
      'gates.noApprovals': 'No approvals recorded.',
      'gates.actor': 'Actor',
      'gates.expires': 'Expires {{when}}',
      'gates.verification': 'Verification',
      'gates.noVerifications': 'No verification commands recorded.',
      'gates.attempt': 'Attempt {{no}}',
      'gates.passed': 'passed',
      'gates.failed': 'failed',
      'gates.notRun': 'not run',
      'gates.exit': 'exit {{code}}',
      'gates.findings': 'Review findings',
      'gates.noFindings': 'No findings.',
      'gates.blocking': 'blocking',
      'gates.open': 'open',
      'gates.requiredFix': 'Required fix',
      'gates.mergeReady': 'Merge ready',
      'gates.mergeBlocked': 'Merge blocked',

      'refinements.title': 'Refinements',
      'refinements.state': 'State',
      'refinements.outcome': 'Outcome',
      'refinements.source': 'Source',
      'refinements.uncertainties': 'Uncertainties',
      'refinements.noUncertainties': 'No uncertainties recorded.',
      'refinements.qa': 'Questions and answers',
      'refinements.noQa': 'No questions recorded.',
      'refinements.question': 'Question',
      'refinements.answer': 'Answer',
      'refinements.openQuestions': 'Open questions',
      'refinements.noOpenQuestions': 'No open questions.',
      'refinements.requirements': 'Requirements',
      'refinements.noRequirements': 'No requirements contract.',

      'memory.title': 'Memory',
      'memory.summary.one': '{{count}} block',
      'memory.summary.other': '{{count}} blocks',
      'memory.empty.title': 'No memory blocks',
      'memory.empty.body': 'Project memory appears here once a run records it.',
      'memory.version': 'v{{version}}',
      'memory.scope': 'Scope',
      'memory.confidence': 'Confidence',
      'memory.reviewAfter': 'Review after {{when}}',
      'memory.noReview': 'No review date',
      'memory.expand': 'Show content',
      'memory.collapse': 'Hide content',
      'memory.loading': 'Loading block\u2026',
      'memory.contentUnavailable': 'Content unavailable.',

      'routing.title': 'Routing & timeline',
      'routing.empty.title': 'No routing data',
      'routing.empty.body': 'Routing and events appear after a run starts.',
      'routing.assignments': 'Fleet assignments',
      'routing.noAssignments': 'No fleet assignments.',
      'routing.source': 'Source',
      'routing.observed': 'Observed routes',
      'routing.noObserved': 'No attempts recorded.',
      'routing.attempts': '{{count}} attempts',
      'routing.avgDuration': 'avg {{duration}}',
      'routing.costs': 'Cost and usage',
      'routing.totalTokens': 'Total tokens',
      'routing.totalCost': 'Total cost',
      'routing.coverage': 'Usage coverage',
      'routing.coverageValue': '{{withUsage}}/{{attempts}} attempts',
      'routing.usageUnavailable': 'usage unavailable',
      'routing.timeline': 'Event timeline',
      'routing.truncated': 'older events hidden',
      'routing.noEvents': 'No events recorded.',
    },
  },
  setup(ctx) {
    const tabs: PanelTab[] = CONDUCTOR_TABS.map((id) => ({
      id,
      group: 'conductor',
      closable: 'hover',
      fallback: id === 'runs',
      get title() {
        return ctx.t(TITLES[id])
      },
    }))

    ctx.add(Panel, {
      id: 'conductor',
      region: 'side',
      wide: true,
      mobile: {
        get title() {
          return ctx.t('panel.title')
        },
        order: 40,
        kind: 'menu',
        icon: 'terminal',
      },
      list: () => tabs,
      render: (props) => (
        <ConductorPanel tab={props.tab} session={props.session} screen={props.screen} />
      ),
    })

    ctx.add(
      Command,
      (): Command => ({
        id: 'open',
        title: ctx.t('command.open'),
        description: ctx.t('command.description'),
        section: 'session',
        run: () => {
          const session = ctx.sessions.current()
          if (session) ctx.layout.toggle(`${ctx.id}:runs`, session)
        },
      }),
    )

    ctx.add(Style, PANEL_CSS)
  },
})
