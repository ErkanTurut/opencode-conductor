import { describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nativeAgentTemplate } from '../../src/rpc/register'
import { readAgentDocument } from '../../src/runtime/configuration-store'

function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'conductor-template-'))
  const authority = { projectRoot: join(base, 'project'), configDir: join(base, 'global') }
  mkdirSync(authority.projectRoot)
  mkdirSync(authority.configDir)
  return { base, authority }
}

describe('native agent template', () => {
  test('round-trips allowlisted values and ordered permissions through the store parser', () => {
    const { base, authority } = fixture()
    try {
      const template = nativeAgentTemplate({
        description: 'Reviewer: checks "quotes" and\nnewlines',
        mode: 'subagent',
        hidden: false,
        color: '#ff6b6b',
        steps: 9,
        model: 'provider/model#high',
        permissions: [
          { action: '*', resource: '*', effect: 'deny' },
          { action: 'skill', resource: 'deploy:*', effect: 'allow' },
          { action: 'shell', resource: 'git push*', effect: 'ask' },
        ],
        system: 'Native prompt with # not a comment',
      })
      const document = readAgentDocument(
        { ...authority, inheritedAgent: template },
        { agentId: 'reviewer', scope: 'project' },
      )
      expect(document.fields.model).toBe('provider/model#high')
      expect(document.fields.steps).toBe(9)
      expect(document.fields.system).toBe('Native prompt with # not a comment')
      expect(document.fields.permissions).toEqual([
        { action: '*', resource: '*', effect: 'deny' },
        { action: 'skill', resource: 'deploy:*', effect: 'allow' },
        { action: 'shell', resource: 'git push*', effect: 'ask' },
      ])
      expect(template).toContain('description: "Reviewer: checks \\"quotes\\" and\\nnewlines"')
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  test('fails closed on permission or model shapes it cannot copy faithfully', () => {
    const base = { system: 'Prompt' }
    expect(() => nativeAgentTemplate({ ...base, permissions: [{ action: '*', resource: '*' }] })).toThrow('cannot be copied safely')
    expect(() => nativeAgentTemplate({ ...base, permissions: [{ action: '*', resource: '*', effect: 'maybe' }] })).toThrow('cannot be copied safely')
    expect(() => nativeAgentTemplate({ ...base, permissions: new Array(1001).fill({ action: 'read', resource: '*', effect: 'allow' }) })).toThrow('Invalid native permission list')
    expect(() => nativeAgentTemplate({ ...base, model: 'not-a-model' })).toThrow('cannot be copied safely')
    expect(() => nativeAgentTemplate({ ...base, mode: 'hidden-mode' })).toThrow('Unsupported native agent mode')
    expect(() => nativeAgentTemplate({ ...base, steps: 0 })).toThrow('Invalid native step limit')
    expect(() => nativeAgentTemplate({ ...base, system: 'x'.repeat(1_000_001) })).toThrow('too large')
  })

  test('omits absent optional fields rather than inventing values', () => {
    const template = nativeAgentTemplate({ system: '' })
    expect(template).toBe('---\n---\n')
  })
})
