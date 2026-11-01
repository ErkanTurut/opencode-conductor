import { describe, expect, it } from 'bun:test'
import { inspectAgentConfigs, parseAgentMarkdown, registerAgents, type MutableAgentConfig } from '../../src/register/agents'

describe('native agent config', () => {
  it('never applies a competing fleet fallback to a model-less native agent', async () => {
    const target: MutableAgentConfig = {}
    const definition = parseAgentMarkdown('a.md', '---\nsteps: 3\n---\nA')
    await registerAgents({ agent: { transform: cb => cb({ get: () => undefined, update: (_id, apply) => apply(target), default: () => {} }) } }, [definition], { fleet: { models: { a: 'hidden/model' }, defaults: { fallbackModel: 'hidden/fallback' } } })
    expect(target.model).toBeUndefined()
  })
  it('parses expanded model and ordered native permission rules', () => {
    const agent = parseAgentMarkdown('reviewer.md', `---
model:
  providerID: anthropic
  model: example
  variant: high
steps: 4
permissions:
  - action: "*"
    resource: "*"
    effect: deny
  - action: skill
    resource: review
    effect: allow
---
Review.`)
    expect(agent.model).toEqual({ providerID: 'anthropic', id: 'example', variant: 'high' })
    expect(agent.permissions).toEqual([{ action: '*', resource: '*', effect: 'deny' }, { action: 'skill', resource: 'review', effect: 'allow' }])
    expect(agent.steps).toBe(4)
  })
  it('rejects invalid step limits', () => {
    for (const steps of ['0', '-1', '1.5', '999999999999999999999999']) {
      expect(parseAgentMarkdown('a.md', `---\nsteps: ${steps}\n---\nA`).steps).toBeUndefined()
    }
  })
  it('keeps host agents unchanged and exposes native provenance', async () => {
    const def = parseAgentMarkdown('a.md', '---\nmodel: x/y#high\n---\nA')
    const host = { name: 'custom', description: 'host', model: { providerID: 'z', id: 'q' } }
    let updated = false
    await registerAgents({ agent: { transform: (cb) => cb({ get: () => host, update: () => { updated = true }, default: () => {} }) } }, [def])
    expect(updated).toBe(false)
    const result = inspectAgentConfigs([def], { a: host })[0]
    expect(result.model).toBe('z/q')
    expect(result.sources.model).toBe('native')
    expect(result.sources.system).toBe('absent')
  })
  it('fails closed when the editor cannot detect existing agents', async () => {
    const definition = parseAgentMarkdown('a.md', '---\nmodel: x/y#high\n---\nPackaged')
    const host = { name: 'a', system: 'Native', model: { providerID: 'z', id: 'q' } }
    let updates = 0
    let defaults = 0
    const result = await registerAgents({ agent: { transform: (cb) => cb({
      update: (_id, apply) => { updates++; apply(host) },
      default: () => { defaults++ },
    }) } }, [definition], { setDefault: true })
    expect(updates).toBe(0)
    expect(defaults).toBe(0)
    expect(host.system).toBe('Native')
    expect(host.model).toEqual({ providerID: 'z', id: 'q' })
    expect(result.registered).toEqual([])
    expect(result.registration).toBe('none')
    expect(result.warnings.join(' ')).toContain('editor.get is unavailable')
  })
})
