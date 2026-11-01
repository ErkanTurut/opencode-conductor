/** Local-only native configuration drafting. No filesystem or network access. */
export interface DraftModel { id: string; name: string; variants: string[] }
export interface AgentDraftInput {
  agentId: string
  model: string
  variant: string
  steps: string
  system: string
  skillIds: string
  skillEffect: 'allow' | 'ask' | 'deny'
}
export type AgentDraftResult = { ok: true; json: string } | { ok: false; errors: string[] }

const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/
const skillPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/
const validAgentId = (id: string) => id.split('/').every(part => idPattern.test(part) && !reserved.has(part))
const modelPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]*\/[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/
const reserved = new Set(['__proto__', 'constructor', 'prototype'])

/** JSON is valid JSONC. Catalog validation never asserts support for an unknown variant. */
export function serializeAgentDraft(input: AgentDraftInput, models?: readonly DraftModel[]): AgentDraftResult {
  const errors: string[] = []
  const agentId = input.agentId.trim()
  const model = input.model.trim()
  const variant = input.variant.trim()
  const steps = input.steps.trim()
  if (!validAgentId(agentId)) errors.push('Agent ID must use valid path segments containing letters, numbers, dots, underscores or hyphens.')
  if (!modelPattern.test(model) || model.split('/').some(part => !part || part === '.' || part === '..')) errors.push('Enter a valid provider/model reference without a variant.')
  const catalog = Array.isArray(models) ? models : []
  const selected = catalog.find(entry => entry.id === model)
  if (catalog.length && !selected) errors.push('Choose a model from the available catalog.')
  if (variant && (!idPattern.test(variant) || !selected || !Array.isArray(selected.variants) || !selected.variants.includes(variant))) errors.push('Choose a supported variant for the selected model; variants cannot be verified without a catalog.')
  const stepsNumber = steps ? Number(steps) : null
  if (steps && (!/^[1-9]\d*$/.test(steps) || !Number.isSafeInteger(stepsNumber))) errors.push('Steps must be a positive whole number.')
  const ids = input.skillIds.split(/\r?\n/).map(id => id.trim()).filter(Boolean)
  if (ids.some(id => !skillPattern.test(id) || reserved.has(id))) errors.push('Each skill ID must contain only letters, numbers, dots, underscores, colons or hyphens.')
  if (!['allow', 'ask', 'deny'].includes(input.skillEffect)) errors.push('Choose a valid skill permission effect.')
  if (errors.length) return { ok: false, errors }
  const agent: Record<string, unknown> = { model: variant ? `${model}#${variant}` : model }
  if (stepsNumber !== null) agent.steps = stepsNumber
  if (input.system !== '') agent.system = input.system
  if (ids.length) agent.permissions = [...new Set(ids)].map(resource => ({ action: 'skill', resource, effect: input.skillEffect }))
  return { ok: true, json: JSON.stringify({ $schema: 'https://opencode.ai/config.json', agents: { [agentId]: agent } }, null, 2) }
}

/** The server adapter owns the target document and opaque concurrency token. */
export type ConfigurationScope = 'project' | 'global'
export interface AgentEditorDocument {
  revision: string
  target: string
  warnings?: string[]
  values: { model: string; variant: string; steps: string; system: string; permissions: string }
}
export interface AgentEditorAdapter {
  load(agentId: string, scope: ConfigurationScope): Promise<AgentEditorDocument>
  save(agentId: string, scope: ConfigurationScope, document: AgentEditorDocument): Promise<AgentEditorDocument>
}

/** Preserve all permission rules: never synthesize a replacement from a partial skill list. */
export function validateAgentEditorDocument(document: AgentEditorDocument): string[] {
  const errors: string[] = []
  const { model, variant, steps, permissions } = document.values
  if (model && (!modelPattern.test(model) || model.split('/').some(part => !part || part === '.' || part === '..'))) errors.push('Model must be a provider/model reference.')
  if (variant && !idPattern.test(variant)) errors.push('Variant contains invalid characters.')
  if (steps && (!/^[1-9]\d*$/.test(steps) || !Number.isSafeInteger(Number(steps)) || Number(steps) > 10000)) errors.push('Steps must be a positive whole number.')
  try { const rules = JSON.parse(permissions); if (!Array.isArray(rules)) errors.push('Permissions must be a JSON array.'); else if (rules.some(rule => !rule || typeof rule.action !== 'string' || typeof rule.resource !== 'string' || !rule.resource.trim() || rule.resource.length > 256 || !['allow', 'ask', 'deny'].includes(rule.effect))) errors.push('Each permission needs an action, a resource and a valid effect.') } catch { errors.push('Permissions must be a valid JSON array.') }
  return errors
}

/** Update a single ordered skill rule without replacing unrelated permissions. */
export function updateSkillPermission<T extends { action: string; resource: string; effect: string }>(rules: readonly T[], index: number, patch: Partial<Pick<T, 'resource' | 'effect'>> | null): T[] {
  if (!Number.isInteger(index) || index < 0 || index >= rules.length || rules[index].action !== 'skill') return [...rules]
  return patch === null ? rules.filter((_, i) => i !== index) : rules.map((rule, i) => i === index ? { ...rule, ...patch } : rule)
}
