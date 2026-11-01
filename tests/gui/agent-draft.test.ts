import { describe, expect, test } from 'bun:test'
import { serializeAgentDraft, validateAgentEditorDocument, updateSkillPermission, type AgentDraftInput } from '../../src/gui/agent-draft'
const models = [{ id: 'provider/model', name: 'Model', variants: ['low', 'high'] }, { id: 'other/model', name: 'Other', variants: ['medium'] }]
const input: AgentDraftInput = { agentId: 'coder', model: 'provider/model', variant: 'high', steps: '42', system: 'Prompt "quoted"\n---\ntext', skillIds: 'review\nsecurity\nreview', skillEffect: 'ask' }
describe('native agent drafts', () => {
  test('serializes escaped JSONC scoped to the agent with skill permission rules', () => {
    const result = serializeAgentDraft(input, models)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const data = JSON.parse(result.json)
    expect(data.$schema).toBe('https://opencode.ai/config.json')
    expect(data.agents.coder).toEqual({ model: 'provider/model#high', steps: 42, system: input.system, permissions: [{ action: 'skill', resource: 'review', effect: 'ask' }, { action: 'skill', resource: 'security', effect: 'ask' }] })
    expect(result.json).not.toContain('"skills"')
    expect(result.json).not.toContain('"maxSteps"')
  })
  test('rejects invalid ids, model, steps and skill ids', () => {
    for (const patch of [{ agentId: '../escape' }, { agentId: '__proto__' }, { model: 'not-a-model' }, { steps: '0' }, { steps: '1.5' }, { steps: 'NaN' }, { steps: '9007199254740992' }, { skillIds: '../escape' }]) expect(serializeAgentDraft({ ...input, ...patch }, models).ok).toBe(false)
  })
  test('validates variants against selected model, including unavailable catalog', () => {
    expect(serializeAgentDraft({ ...input, variant: 'medium' }, models).ok).toBe(false)
    expect(serializeAgentDraft(input).ok).toBe(false)
    expect(serializeAgentDraft({ ...input, variant: '' }).ok).toBe(true)
    expect(serializeAgentDraft({ ...input, agentId: 'team/reviewer', skillIds: 'vendor:review' }, models).ok).toBe(true)
    expect(serializeAgentDraft({ ...input, model: 'missing/model', variant: '' }, models).ok).toBe(false)
  })
  test('omits optional blank fields and supports each permission effect', () => {
    for (const effect of ['allow', 'ask', 'deny'] as const) {
      const result = serializeAgentDraft({ ...input, steps: '', system: '', variant: '', skillEffect: effect }, models)
      if (!result.ok) throw new Error(result.errors.join(', '))
      const agent = JSON.parse(result.json).agents.coder
      expect(agent.steps).toBeUndefined()
      expect(agent.system).toBeUndefined()
      expect(agent.permissions[0].effect).toBe(effect)
    }
  })
})


test('validates full target permission arrays without altering them', () => {
  const document = { revision: 'v1', target: 'project config', values: { model: 'provider/model', variant: 'high', steps: '2', system: '', permissions: '[{"action":"skill","resource":"*","effect":"ask"}]' } }
  expect(validateAgentEditorDocument(document)).toEqual([])
  expect(validateAgentEditorDocument({ ...document, values: { ...document.values, permissions: '{}' } })).toContain('Permissions must be a JSON array.')
  expect(validateAgentEditorDocument({ ...document, values: { ...document.values, permissions: '[' } })).toContain('Permissions must be a valid JSON array.')
  expect(validateAgentEditorDocument({ ...document, values: { ...document.values, steps: '0' } })).toContain('Steps must be a positive whole number.')
})


test('skill rule edits retain non-skill rules and ordering', () => {
  const rules = [{ action: 'bash', resource: '*', effect: 'ask' }, { action: 'skill', resource: '*', effect: 'deny' }, { action: 'skill', resource: 'review', effect: 'allow' }, { action: 'read', resource: '*', effect: 'allow' }]
  const edited = updateSkillPermission(rules, 2, { effect: 'ask' })
  expect(edited.map(rule => [rule.action, rule.resource, rule.effect])).toEqual([['bash', '*', 'ask'], ['skill', '*', 'deny'], ['skill', 'review', 'ask'], ['read', '*', 'allow']])
  expect(updateSkillPermission(edited, 1, null)).toEqual([edited[0], edited[2], edited[3]])
  expect(updateSkillPermission(edited, 0, null)).toEqual(edited)
  expect(rules[2].effect).toBe('allow')
})

test('rejects incomplete skill permissions and out-of-range steps', () => {
  const document = { revision: 'v1', target: 'project', values: { model: '', variant: '', steps: '10001', system: '', permissions: '[{"action":"skill","resource":"","effect":"ask"}]' } }
  expect(validateAgentEditorDocument(document)).toContain('Steps must be a positive whole number.')
  expect(validateAgentEditorDocument(document)).toContain('Each permission needs an action, a resource and a valid effect.')
})
