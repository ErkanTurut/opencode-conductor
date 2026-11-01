import { For, Show } from 'solid-js'
import { usePlugin } from '@opencode/plugin/gui'
import type { ProjectData } from '../../rpc-contract'
import { arrayOf, textOf } from '../data'
import { EmptyState, LoadingBlock, Section } from '../components'

export interface ProjectViewProps { data: ProjectData | null; loading: boolean }

/** Project policy and capability status; no action is authorized here. */
export function ProjectView(props: ProjectViewProps) {
  const ctx = usePlugin()
  const values = (items: unknown) => arrayOf<string>(items).filter(item => typeof item === 'string' && item.length > 0)
  return <Section title="Project policy">
    <Show when={props.data} fallback={props.loading ? <LoadingBlock label={ctx.t('common.loading')} /> : <EmptyState title="Project policy unavailable" />}>
      {(data) => <>
        <p class="cdt-muted cdt-meta">{textOf(data().projectRoot, 'Project directory unavailable')}</p>
        <For each={arrayOf<string>(data().warnings)}>{warning => <p class="cdt-inspector-note">{warning}</p>}</For>
        <div class="cdt-inspector-scroll"><table class="cdt-inspector-table"><caption class="cdt-sr-only">Branches and configured policy</caption><tbody>
          <tr><th scope="row">Main branch</th><td>{textOf(data().branches?.main, 'Unknown')}</td></tr>
          <tr><th scope="row">Development branch</th><td>{textOf(data().branches?.dev, 'Unknown')}</td></tr>
          <tr><th scope="row">Repository</th><td>{textOf(data().policy?.repository, 'Not configured')}</td></tr>
          <tr><th scope="row">Allowed remotes</th><td>{values(data().policy?.remotes).join(', ') || 'Not configured'}</td></tr>
          <tr><th scope="row">Allowed targets</th><td>{values(data().policy?.targets).join(', ') || 'Not configured'}</td></tr>
          <tr><th scope="row">Configured operations</th><td>{values(data().policy?.operations).join(', ') || 'Not configured'}</td></tr>
          <tr><th scope="row">Preview providers</th><td>{values(data().policy?.previewProviders).join(', ') || 'Not configured'}</td></tr>
          <tr><th scope="row">Policy source</th><td>{textOf(data().policySource, 'Unknown')}</td></tr>
          <tr><th scope="row">Policy hash</th><td class="cdt-mono">{textOf(data().policyHash, 'Unavailable')}</td></tr>
        </tbody></table></div>
        <section class="cdt-section"><h3 class="cdt-heading">Required checks</h3><Show when={values(data().policy?.requiredChecks).length} fallback={<p class="cdt-muted">No required checks configured in policy.</p>}><ul class="cdt-inspector-list"><For each={values(data().policy?.requiredChecks)}>{check => <li><code>{check}</code></li>}</For></ul></Show></section>
        <section class="cdt-section"><h3 class="cdt-heading">Project verification commands</h3><Show when={values(data().verificationCommands).length} fallback={<p class="cdt-muted">No verification commands provided.</p>}><ul class="cdt-inspector-list"><For each={values(data().verificationCommands)}>{command => <li><code>{command}</code></li>}</For></ul></Show></section>
        <section class="cdt-section"><h3 class="cdt-heading">Current local push guard</h3>
          <Show when={data().branches?.main && data().branches?.dev} fallback={<p class="cdt-muted">Branch names are unknown; no branch-specific promise can be made.</p>}>
            <p>{data().branches?.main === data().branches?.dev
              ? `Trunk branch ${data().branches?.main}: direct push is blocked until an authenticated approval adapter exists.`
              : `Non-force direct pushes to ${data().branches?.dev} are permitted by the branch guard; direct pushes to ${data().branches?.main} and other targets are blocked.`}</p>
            <p class="cdt-muted cdt-meta">The host's own permission policy can still ask or deny. This is not a merge rule, branch-protection check, preview result, or candidate-bound approval.</p>
          </Show>
        </section>
        <section class="cdt-section"><h3 class="cdt-heading">Connected capabilities</h3><div class="cdt-inspector-scroll"><table class="cdt-inspector-table"><caption class="cdt-sr-only">Provider and executor status</caption><tbody>
          <tr><th scope="row">Preview adapter</th><td>{textOf(data().capabilities?.previewAdapter, 'unknown')}</td></tr>
          <tr><th scope="row">Merge executor</th><td>{textOf(data().capabilities?.mergeExecutor, 'unknown')}</td></tr>
          <tr><th scope="row">Remote protection</th><td>{textOf(data().capabilities?.remoteProtection, 'unknown')}</td></tr>
        </tbody></table></div><p class="cdt-muted cdt-meta">Configured providers do not establish a connected provider or a successful preview.</p></section>
        <section class="cdt-section"><h3 class="cdt-heading">Release gate sequence</h3><ol class="cdt-inspector-sequence"><li>Run required checks.</li><li>Obtain approval to merge the worktree into development and push.</li><li>Verify the deployment for the pushed commit and share its preview URL.</li><li>Obtain the user's preview verification.</li><li>Open or report the development-to-main PR.</li></ol><p class="cdt-muted">This sequence is guidance, not evidence that any step has passed or authorization to perform it.</p></section>
      </>}
    </Show>
  </Section>
}
