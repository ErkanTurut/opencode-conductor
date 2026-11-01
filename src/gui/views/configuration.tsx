import { For, Show, createMemo, createSignal } from 'solid-js'
import { usePlugin } from '@opencode/plugin/gui'
import type { ConfigurationAgent, ConfigurationData } from '../../rpc-contract'
import { arrayOf, recordOf, textOf } from '../data'
import { EmptyState, LoadingBlock, Section } from '../components'
import { serializeAgentDraft, type DraftModel } from '../agent-draft'

export interface ConfigurationViewProps { data: ConfigurationData | null; loading: boolean }

/** Read-only host-resolved snapshot and packaged defaults, not an editor. */
export function ConfigurationView(props: ConfigurationViewProps) {
  const ctx = usePlugin()
  const [selectedId, setSelectedId] = createSignal<string | null>(null)
  const agents = () => arrayOf<ConfigurationAgent>(props.data?.agents)
  const selected = createMemo(() => agents().find(agent => agent.id === selectedId()) ?? agents()[0] ?? null)
  const source = (agent: ConfigurationAgent, field: string) => textOf(recordOf(agent.sources)[field], 'unknown')
  return <Section title="Configuration">
    <Show when={props.data} fallback={props.loading ? <LoadingBlock label={ctx.t('common.loading')} /> : <EmptyState title="Configuration unavailable" />}>
      <p class="cdt-muted cdt-meta">Read-only snapshot. Model slots used by tasks are routing roles, not necessarily the actual model used by an attempt.</p>
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
            <Show when={agent().id} keyed>{agentId => <AgentDraft agentId={agentId} models={props.data?.models} />}</Show>
          </div>}</Show>
        </div>
      </Show>
      <section class="cdt-section"><h3 class="cdt-heading">Skills</h3><p>{textOf(props.data?.skillPolicy, 'Skill policy unavailable.')}</p></section>
      <details class="cdt-inspector-disclosure"><summary>Native configuration guide (read-only examples)</summary>
        <p class="cdt-muted">Examples only; this panel does not save or apply configuration. Replace the placeholder values before using them.</p>
        <h4 class="cdt-subheading">Agent Markdown · .opencode/agents/example.md</h4>
        <pre class="cdt-pre" tabindex="0">{`---\ndescription: Example agent\nmode: subagent\nmodel: provider/model#variant\nsteps: 20\n---\nYour system instructions here.`}</pre>
        <h4 class="cdt-subheading">JSONC · opencode.jsonc</h4>
        <pre class="cdt-pre" tabindex="0">{`{\n  "$schema": "https://opencode.ai/config.json",\n  "agents": {\n    "example": {\n      "description": "Example agent",\n      "mode": "subagent",\n      "system": "Your system instructions here.",\n      "model": "provider/model#variant",\n      "steps": 20\n    }\n  }\n}`}</pre>
      </details>
    </Show>
  </Section>
}

/** A keyed local component keeps edits through polling and resets on agent selection. */
function AgentDraft(props: { agentId: string; models?: DraftModel[] }) {
  const [model, setModel] = createSignal('')
  const [variant, setVariant] = createSignal('')
  const [steps, setSteps] = createSignal('')
  const [system, setSystem] = createSignal('')
  const [skillIds, setSkillIds] = createSignal('')
  const [skillEffect, setSkillEffect] = createSignal<'allow' | 'ask' | 'deny'>('ask')
  const models = () => arrayOf<DraftModel>(props.models).filter(item => item && typeof item.id === 'string' && typeof item.name === 'string' && Array.isArray(item.variants))
  const selectedModel = createMemo(() => models().find(item => item.id === model()))
  const draft = createMemo(() => serializeAgentDraft({ agentId: props.agentId, model: model(), variant: variant(), steps: steps(), system: system(), skillIds: skillIds(), skillEffect: skillEffect() }, models()))
  const changeModel = (value: string) => { setModel(value); setVariant('') }
  return <details class="cdt-inspector-disclosure cdt-agent-draft"><summary>Prepare native override</summary>
    <p class="cdt-inspector-note"><strong>Draft only; not applied, not saved.</strong> Review in native configuration. This is separate from the snapshot above. Selecting another agent discards this draft.</p>
    <p class="cdt-muted cdt-meta">The snippet contains only the fields entered here. Review existing native configuration and permissions before merging it; replacing them could remove existing settings.</p>
    <div class="cdt-draft-fields">
      <Show when={models().length > 0} fallback={<label>Model reference <input type="text" value={model()} placeholder="provider/model" onInput={event => changeModel(event.currentTarget.value)} aria-describedby="cdt-draft-model-help" /><span id="cdt-draft-model-help" class="cdt-muted cdt-meta">Model catalog unavailable. Enter a provider/model reference; its availability cannot be verified here.</span></label>}>
        <label>Model <select value={model()} onChange={event => changeModel(event.currentTarget.value)}><option value="">Choose a model</option><For each={models()}>{item => <option value={item.id}>{item.name} ({item.id})</option>}</For></select></label>
      </Show>
      <label>Effort / variant <select value={variant()} disabled={!selectedModel() || !arrayOf<string>(selectedModel()?.variants).length} onChange={event => setVariant(event.currentTarget.value)}><option value="">No variant override</option><For each={arrayOf<string>(selectedModel()?.variants)}>{item => <option value={item}>{item}</option>}</For></select><span class="cdt-muted cdt-meta">{selectedModel() ? 'Only variants listed for this model are available.' : 'Choose a catalog model to select a supported variant.'}</span></label>
      <label>Steps <input type="number" min="1" step="1" inputmode="numeric" value={steps()} onInput={event => setSteps(event.currentTarget.value)} /><span class="cdt-muted cdt-meta">Optional positive whole number.</span></label>
      <label>System prompt <textarea rows="5" value={system()} onInput={event => setSystem(event.currentTarget.value)} /><span class="cdt-muted cdt-meta">Leave blank to omit this field. A non-empty system prompt replaces the provider base prompt for this agent.</span></label>
      <label>Skill IDs <textarea rows="3" value={skillIds()} onInput={event => setSkillIds(event.currentTarget.value)} /><span class="cdt-muted cdt-meta">One ID per line. These become permission rules; they do not attach or load skills. Rules are ordered; the last matching rule wins.</span></label>
      <label>Skill permission effect <select value={skillEffect()} onChange={event => setSkillEffect(event.currentTarget.value as 'allow' | 'ask' | 'deny')}><option value="ask">Ask</option><option value="allow">Allow</option><option value="deny">Deny</option></select></label>
    </div>
    <Show when={draft().ok} fallback={<div class="cdt-inspector-note" role="status"><strong>Complete the draft to see JSONC.</strong><ul><For each={draft().ok ? [] : (draft() as { ok: false; errors: string[] }).errors}>{error => <li>{error}</li>}</For></ul></div>}>
      <h4 class="cdt-subheading">JSONC draft for {props.agentId}</h4><pre class="cdt-pre" tabindex="0" aria-label={`JSONC draft for ${props.agentId}`}>{draft().ok ? (draft() as { ok: true; json: string }).json : ''}</pre>
    </Show>
  </details>
}
