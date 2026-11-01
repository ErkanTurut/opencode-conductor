import { describe, expect, test } from 'bun:test'
import { serializeAgentDraft, type AgentDraftInput } from '../../src/gui/agent-draft'
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
