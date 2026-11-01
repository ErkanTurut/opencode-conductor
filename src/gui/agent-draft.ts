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
const modelPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]*\/[a-zA-Z0-9][a-zA-Z0-9._/-]*$/
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
