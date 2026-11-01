import { For, Index, Show, createEffect, createMemo, createSignal, createUniqueId, onCleanup } from 'solid-js'
import { usePlugin } from '@opencode/plugin/gui'
import type { ConfigurationAgent, ConfigurationData, ConfigurationPermission as PermissionRule } from '../../rpc-contract'
import { arrayOf, recordOf, textOf } from '../data'
import { EmptyState, LoadingBlock, Section } from '../components'
import { validateAgentEditorDocument, updateSkillPermission, type AgentEditorAdapter, type AgentEditorDocument, type ConfigurationScope, type DraftModel } from '../agent-draft'

export interface ConfigurationViewProps { data: ConfigurationData | null; loading: boolean; editor?: AgentEditorAdapter; onDirty?: (dirty: boolean) => void }

/** Host-resolved snapshot and separately loaded native override editor. */
export function ConfigurationView(props: ConfigurationViewProps) {
  const ctx = usePlugin()
  const [selectedId, setSelectedId] = createSignal<string | null>(null)
  const [editorDirty, setEditorDirty] = createSignal(false)
  createEffect(() => props.onDirty?.(editorDirty()))
  onCleanup(() => props.onDirty?.(false))
  const agents = () => arrayOf<ConfigurationAgent>(props.data?.agents)
  const selected = createMemo(() => agents().find(agent => agent.id === selectedId()) ?? agents()[0] ?? null)
  const source = (agent: ConfigurationAgent, field: string) => textOf(recordOf(agent.sources)[field], 'unknown')
  return <Section title="Configuration">
    <Show when={props.data} fallback={props.loading ? <LoadingBlock label={ctx.t('common.loading')} /> : <EmptyState title="Configuration unavailable" />}>
      <p class="cdt-muted cdt-meta">Effective snapshot. Model slots used by tasks are routing roles, not necessarily the actual model used by an attempt.</p>
      <p class="cdt-muted cdt-meta">{props.data?.nativeResolved ? 'Native values are resolved by the host; the contributing configuration files are not exposed.' : 'Native resolution unavailable. Packaged defaults are not asserted to be effective host configuration.'}</p>
      <For each={arrayOf<string>(props.data?.warnings)}>{warning => <p class="cdt-inspector-note">{warning}</p>}</For>
      <Show when={agents().length} fallback={<EmptyState title="No agents available" body="No agent configuration was returned." />}>
        <div class="cdt-inspector-layout">
          <nav class="cdt-inspector-nav" aria-label="Agents"><For each={agents()}>{agent => <button type="button" aria-pressed={selected()?.id === agent.id} onClick={() => setSelectedId(agent.id)}>{agent.id}</button>}</For></nav>
          <Show when={selected()}>{agent => <div class="cdt-inspector-detail">
            <h3 class="cdt-subheading">{agent().id}</h3>
            <For each={arrayOf<string>(agent().warnings)}>{warning => <p class="cdt-inspector-note">{warning}</p>}</For>
            <div class="cdt-inspector-scroll"><table class="cdt-inspector-table"><caption class="cdt-sr-only">Agent configuration fields and sources</caption><thead><tr><th scope="col">Field</th><th scope="col">Value</th><th scope="col">Source</th></tr></thead><tbody>
              <tr><th scope="row">Description</th><td>{textOf(agent().description, 'Not provided')}</td><td>{source(agent(), 'description')}</td></tr>
              <tr><th scope="row">Mode</th><td>{textOf(agent().mode, 'Not provided')}</td><td>{source(agent(), 'mode')}</td></tr>
              <tr><th scope="row">Model</th><td>{textOf(agent().model, 'Not provided')}</td><td>{source(agent(), 'model')}</td></tr>
              <tr><th scope="row">Variant</th><td>{textOf(agent().variant, 'Not provided')}</td><td>{source(agent(), 'variant')}</td></tr>
              <tr><th scope="row">Steps</th><td>{textOf(agent().steps, 'Not provided')}</td><td>{source(agent(), 'steps')}</td></tr>
              <tr><th scope="row">System prompt</th><td>See disclosure below</td><td>{source(agent(), 'system')}</td></tr>
              <tr><th scope="row">Permissions</th><td>See disclosure below</td><td>{source(agent(), 'permissions')}</td></tr>
            </tbody></table></div>
            <details class="cdt-inspector-disclosure"><summary>System prompt</summary><pre class="cdt-pre" tabindex="0">{textOf(agent().system, 'Not provided')}</pre></details>
            <details class="cdt-inspector-disclosure"><summary>Permissions JSON</summary><pre class="cdt-pre" tabindex="0">{JSON.stringify(arrayOf(agent().permissions), null, 2)}</pre></details>
            <Show when={props.editor} fallback={<p class="cdt-inspector-note">Native configuration editing is unavailable.</p>}>{editor => <AgentEditor agentId={agent().id} editor={editor()} models={props.data?.models} onDirty={setEditorDirty} />}</Show>
          </div>}</Show>
        </div>
      </Show>
      <section class="cdt-section"><h3 class="cdt-heading">Skills</h3><p>{textOf(props.data?.skillPolicy, 'Skill policy unavailable.')}</p></section>
      <details class="cdt-inspector-disclosure"><summary>Native configuration examples</summary>
        <p class="cdt-muted">Examples only. Use the editor above to save an override; replace placeholder values when using these examples elsewhere.</p>
        <h4 class="cdt-subheading">Agent Markdown · .opencode/agents/example.md</h4>
        <pre class="cdt-pre" tabindex="0">{`---\ndescription: Example agent\nmode: subagent\nmodel: provider/model#variant\nsteps: 20\n---\nYour system instructions here.`}</pre>
        <h4 class="cdt-subheading">JSONC · opencode.jsonc</h4>
        <pre class="cdt-pre" tabindex="0">{`{\n  "$schema": "https://opencode.ai/config.json",\n  "agents": {\n    "example": {\n      "description": "Example agent",\n      "mode": "subagent",\n      "system": "Your system instructions here.",\n      "model": "provider/model#variant",\n      "steps": 20\n    }\n  }\n}`}</pre>
      </details>
    </Show>
  </Section>
}

/** Drafts are retained by agent and scope while the panel remains mounted. */
function AgentEditor(props: { agentId: string; editor: AgentEditorAdapter; models?: DraftModel[]; onDirty: (value: boolean) => void }) {
  const modelListId = `cdt-models-${createUniqueId()}`, variantListId = `cdt-variants-${createUniqueId()}`
  type Entry = { document: AgentEditorDocument; baseline: string }
  const [scope, setScope] = createSignal<ConfigurationScope>('project')
  const [entries, setEntries] = createSignal<Record<string, Entry>>({})
  const [busy, setBusy] = createSignal(false)
  const [message, setMessage] = createSignal('')
  const key = () => `${scope()}:${props.agentId}`
  const entry = () => entries()[key()]
  const dirtyEntry = (item: Entry) => JSON.stringify(item.document.values) !== item.baseline
  const dirty = () => !!entry() && dirtyEntry(entry())
  createEffect(() => props.onDirty(Object.values(entries()).some(dirtyEntry)))
  let generation = 0
  onCleanup(() => { generation++ })
  async function load() {
    const id = props.agentId, selectedScope = scope(), selectedKey = key()
    const prior = entries()[selectedKey]
    if (prior && dirtyEntry(prior) && !window.confirm('Discard this unsaved draft and reload the target?')) return
    const request = ++generation
    setBusy(true); setMessage('')
    try {
      const value = await props.editor.load(id, selectedScope)
      if (request !== generation) return
      setEntries(old => ({ ...old, [selectedKey]: { document: value, baseline: JSON.stringify(value.values) } }))
    } catch (error) { if (request === generation) setMessage(error instanceof Error ? error.message : String(error)) }
    finally { if (request === generation) setBusy(false) }
  }
  function update(field: keyof AgentEditorDocument['values'], value: string) {
    const selectedKey = key()
    setEntries(old => { const current = old[selectedKey]; return current ? { ...old, [selectedKey]: { ...current, document: { ...current.document, values: { ...current.document.values, [field]: value } } } } : old })
    setMessage('')
  }
  async function save() {
    const current = entry(), id = props.agentId, selectedScope = scope(), selectedKey = key()
    if (!current || busy()) return
    const errors = validateAgentEditorDocument(current.document)
    if (errors.length) { setMessage(errors.join(' ')); return }
    if (selectedScope === 'global' && !window.confirm(`Save global configuration for ${id}? This affects other projects.`)) return
    const request = ++generation
    setBusy(true); setMessage('')
    try {
      const saved = await props.editor.save(id, selectedScope, current.document)
      if (request !== generation) return
      setEntries(old => ({ ...old, [selectedKey]: { document: saved, baseline: JSON.stringify(saved.values) } })); setMessage('Saved.')
    } catch (error) { if (request === generation) setMessage(`Save failed: ${error instanceof Error ? error.message : String(error)}. Your draft was retained.`) }
    finally { if (request === generation) setBusy(false) }
  }
  const rules = () => { try { return JSON.parse(entry()?.document.values.permissions ?? '[]') as PermissionRule[] } catch { return [] } }
  const skillRules = () => rules().map((rule, index) => ({ rule, index })).filter(item => item.rule.action === 'skill')
  const replaceRule = (index: number, patch: Partial<PermissionRule>) => update('permissions', JSON.stringify(updateSkillPermission(rules(), index, patch), null, 2))
  return <section class="cdt-agent-draft">
    <h4 class="cdt-subheading">Edit native override</h4>
    <p class="cdt-muted cdt-meta">Drafts remain available when switching agents, scopes and tabs. Save checks the target revision.</p>
    <Show when={Object.values(entries()).some(dirtyEntry)}><p class="cdt-inspector-note" role="status">Unsaved agent changes are retained in this panel.</p></Show>
    <div class="cdt-row cdt-wrap"><label>Scope <select value={scope()} disabled={busy()} onChange={event => { setScope(event.currentTarget.value as ConfigurationScope); setMessage('') }}><option value="project">Project</option><option value="global">Global</option></select></label>
    <button type="button" disabled={busy()} onClick={() => void load()}>{entry() ? 'Reload target' : 'Load target'}</button></div>
    <Show when={entry()}>{item => <>
      <p class="cdt-muted cdt-meta">Target: {item().document.target} · Revision: <span class="cdt-mono">{item().document.revision}</span></p>
      <For each={item().document.warnings ?? []}>{warning => <p class="cdt-inspector-note">{warning}</p>}</For>
      <fieldset class="cdt-editor-fieldset" disabled={busy()}><div class="cdt-draft-fields">
        <label>Model <input list={modelListId} value={item().document.values.model} onInput={event => update('model', event.currentTarget.value)} placeholder="provider/model" /><datalist id={modelListId}><For each={arrayOf<DraftModel>(props.models)}>{model => <option value={model.id}>{model.name}</option>}</For></datalist></label>
        <label>Variant <input list={variantListId} value={item().document.values.variant} onInput={event => update('variant', event.currentTarget.value)} /><datalist id={variantListId}><For each={arrayOf<DraftModel>(props.models).find(model => model.id === item().document.values.model)?.variants ?? []}>{variant => <option value={variant} />}</For></datalist></label>
        <label>Steps <input type="number" min="1" max="10000" step="1" value={item().document.values.steps} onInput={event => update('steps', event.currentTarget.value)} /></label>
        <label>System prompt <textarea rows="5" value={item().document.values.system} onInput={event => update('system', event.currentTarget.value)} /></label>
      </div>
      <h5 class="cdt-subheading">Skill permissions</h5>
      <p class="cdt-muted cdt-meta">Rules are evaluated in order; the last matching rule wins. These permissions do not attach skills. Other permission rules are preserved.</p>
      <Index each={skillRules()}>{item => <div class="cdt-skill-rule">
        <label>Skill ID or pattern <input value={item().rule.resource} onInput={event => replaceRule(item().index, { resource: event.currentTarget.value })} /></label>
        <label>Effect <select value={item().rule.effect} onChange={event => replaceRule(item().index, { effect: event.currentTarget.value as PermissionRule['effect'] })}><option value="ask">Ask</option><option value="allow">Allow</option><option value="deny">Deny</option></select></label>
        <button type="button" aria-label={`Remove skill rule ${item().rule.resource}`} onClick={() => update('permissions', JSON.stringify(updateSkillPermission(rules(), item().index, null), null, 2))}>Remove</button>
      </div>}</Index>
      <button type="button" onClick={() => update('permissions', JSON.stringify([...rules(), { action: 'skill', resource: '', effect: 'ask' }], null, 2))}>Add skill rule</button>
      </fieldset>
      <button type="button" disabled={busy() || !dirty()} onClick={() => void save()}>{busy() ? 'Saving…' : 'Save override'}</button>
    </>}</Show>
    <Show when={busy() && !entry()}><p role="status">Loading target…</p></Show>
    <Show when={message()}><p class="cdt-inspector-note" role="status">{message()}</p></Show>
  </section>
}
