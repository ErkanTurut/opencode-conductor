import { For, Show, createEffect, createSignal, onCleanup } from 'solid-js'
import { usePlugin } from '@opencode/plugin/gui'
import type { ProjectData, ProjectSettings as Settings, ProjectSettingsDocument as SettingsDocument } from '../../rpc-contract'
import { arrayOf, textOf } from '../data'
import { EmptyState, LoadingBlock, Section } from '../components'

export interface ProjectViewProps { data: ProjectData | null; loading: boolean; onDirty?: (dirty: boolean) => void; editor?: { load(): Promise<SettingsDocument>; save(document: SettingsDocument): Promise<SettingsDocument> } }

/** Project settings and read-only governance status. */
export function ProjectView(props: ProjectViewProps) {
  const ctx = usePlugin()
  const values = (items: unknown) => arrayOf<string>(items).filter(item => typeof item === 'string' && item.length > 0)
  return <Section title="Project policy">
    <Show when={props.data} fallback={props.loading ? <LoadingBlock label={ctx.t('common.loading')} /> : <EmptyState title="Project policy unavailable" />}>
      {(data) => <>
        <p class="cdt-muted cdt-meta">{textOf(data().projectRoot, 'Project directory unavailable')}</p>
        <Show when={props.editor}>{editor => <ProjectEditor data={data()} editor={editor()} onDirty={dirty => props.onDirty?.(dirty)} />}</Show>
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
        <section class="cdt-section"><h3 class="cdt-heading">Preview awareness</h3>
          <Show when={data().preview} fallback={<p class="cdt-muted">Preview configuration is unavailable.</p>}>{preview => <>
            <p>Provider: {preview().provider} · Branch: {textOf(preview().branch, 'Unknown')}</p>
            <p>URL: {textOf(preview().url, 'Not configured')}</p>
            <p class="cdt-muted cdt-meta">Sources: {preview().sources.join(', ') || 'None'}. Configuration does not establish a connected provider or a verified deployment.</p>
            <ul class="cdt-inspector-list"><For each={preview().guidance}>{item => <li>{item}</li>}</For></ul>
          </>}</Show>
        </section>
        <section class="cdt-section"><h3 class="cdt-heading">Release gate sequence</h3><ol class="cdt-inspector-sequence"><li>Run required checks.</li><li>Obtain approval to merge the worktree into development and push.</li><li>Verify the deployment for the pushed commit and share its preview URL.</li><li>Obtain the user's preview verification.</li><li>Open or report the development-to-main PR.</li></ol><p class="cdt-muted">This sequence is guidance, not evidence that any step has passed or authorization to perform it.</p></section>
      </>}
    </Show>
  </Section>
}

function ProjectEditor(props: { data: ProjectData; editor: NonNullable<ProjectViewProps['editor']>; onDirty: (dirty: boolean) => void }) {
  const [document, setDocument] = createSignal<SettingsDocument | null>(null)
  const [baseline, setBaseline] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const [message, setMessage] = createSignal('')
  const [commands, setCommands] = createSignal('')
  const dirty = () => !!document() && JSON.stringify({ ...document()!.settings, verificationCommands: commands().split('\n').map(x => x.trim()).filter(Boolean) }) !== baseline()
  createEffect(() => props.onDirty(dirty()))
  onCleanup(() => props.onDirty(false))
  async function load() {
    if (dirty() && !window.confirm('Discard unsaved project settings and reload?')) return
    setBusy(true); setMessage('')
    try {
      const result = await props.editor.load()
      const settings = result.settings ?? { branches: { main: props.data.branches?.main ?? '', dev: props.data.branches?.dev ?? '' }, verificationCommands: arrayOf<string>(props.data.verificationCommands), preview: { provider: props.data.preview?.provider === 'vercel' || props.data.preview?.provider === 'other' ? props.data.preview.provider : 'none' as const, url: props.data.preview?.url ?? '', branch: props.data.preview?.branch ?? '' }, memory: { enabled: true } }
      setDocument({ ...result, settings }); setCommands(settings.verificationCommands.join('\n')); setBaseline(JSON.stringify(settings))
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  function update(patch: Partial<Settings>) { setDocument(d => d && d.settings ? { ...d, settings: { ...d.settings, ...patch } } : d); setMessage('') }
  async function save() {
    const current = document()
    if (!current?.settings || busy()) return
    const settings = { ...current.settings, verificationCommands: commands().split('\n').map(x => x.trim()).filter(Boolean) }
    if (!settings.branches.main.trim() || !settings.branches.dev.trim()) { setMessage('Enter both branch names.'); return }
    setBusy(true); setMessage('')
    try {
      const result = await props.editor.save({ ...current, settings })
      setDocument(result); setBaseline(JSON.stringify(result.settings)); setCommands(result.settings?.verificationCommands.join('\n') ?? ''); setMessage('Saved. Settings apply to new runs.')
    } catch (error) { setMessage(`Save failed: ${error instanceof Error ? error.message : String(error)}. Your draft was retained.`) }
    finally { setBusy(false) }
  }
  return <section class="cdt-section"><h3 class="cdt-heading">Project settings</h3>
    <p class="cdt-muted cdt-meta">Changes affect new runs. Saving checks the target revision; a conflict never overwrites newer settings.</p>
    <button type="button" disabled={busy()} onClick={() => void load()}>Load settings</button>
    <Show when={document()?.settings}>{settings => <>
      <p class="cdt-muted cdt-meta">Target: {document()?.target} · Revision: {document()?.revision}</p>
      <For each={document()?.warnings ?? []}>{warning => <p class="cdt-inspector-note">{warning}</p>}</For>
      <fieldset class="cdt-editor-fieldset" disabled={busy()}><div class="cdt-draft-fields">
        <label>Main branch<input value={settings().branches.main} onInput={e => update({ branches: { ...settings().branches, main: e.currentTarget.value } })} /></label>
        <label>Development branch<input value={settings().branches.dev} onInput={e => update({ branches: { ...settings().branches, dev: e.currentTarget.value } })} /></label>
        <label>Verification commands<textarea rows="4" value={commands()} onInput={e => setCommands(e.currentTarget.value)} /><span class="cdt-muted cdt-meta">One command per line.</span></label>
        <label>Preview provider<select value={settings().preview.provider} onChange={e => update({ preview: { ...settings().preview, provider: e.currentTarget.value as Settings['preview']['provider'] } })}><option value="none">None</option><option value="vercel">Vercel</option><option value="other">Other</option></select></label>
        <label>Preview URL<input type="url" value={settings().preview.url} onInput={e => update({ preview: { ...settings().preview, url: e.currentTarget.value } })} /></label>
        <label>Preview branch<input value={settings().preview.branch} onInput={e => update({ preview: { ...settings().preview, branch: e.currentTarget.value } })} /></label>
        <label><span>Memory policy</span><select value={settings().memory.enabled ? 'enabled' : 'disabled'} onChange={e => update({ memory: { enabled: e.currentTarget.value === 'enabled' } })}><option value="enabled">Enabled</option><option value="disabled">Disabled</option></select></label>
      </div></fieldset>
      <p class="cdt-muted cdt-meta">A configured preview does not establish a connected provider or a successful deployment.</p>
      <button type="button" disabled={busy() || !dirty()} onClick={() => void save()}>{busy() ? 'Saving…' : 'Save settings'}</button>
    </>}</Show>
    <Show when={busy() && !document()}><p role="status">Loading settings…</p></Show>
    <Show when={message()}><p role="status" class="cdt-inspector-note">{message()}</p></Show>
  </section>
}
