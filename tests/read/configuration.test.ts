import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildConfigurationSnapshot, buildProjectSnapshot, redactConfigurationText } from '../../src/read/configuration'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function assets() {
  const root = mkdtempSync(join(tmpdir(), 'conductor-config-view-'))
  roots.push(root)
  mkdirSync(join(root, 'agents'))
  writeFileSync(join(root, 'agents', 'coder.md'), '---\ndescription: Implements changes\nmode: subagent\nmodel: example/coder#high\nsteps: 12\n---\nFollow project instructions.\n')
  return root
}

describe('read-only configuration snapshots', () => {
  it('reports packaged defaults without claiming native resolution', () => {
    const result = buildConfigurationSnapshot(assets())
    expect(result.readOnly).toBe(true)
    expect(result.nativeResolved).toBe(false)
    expect(result.agents[0]).toMatchObject({ id: 'coder', model: 'example/coder', variant: 'high', steps: 12 })
    expect(result.agents[0]?.sources.model).toBe('packaged-md')
  })
  it('allowlists resolved native fields and never exposes request or provider credentials', () => {
    const result = buildConfigurationSnapshot(assets(), [{
      id: 'coder', model: { providerID: 'native', id: 'chosen', variant: 'low' },
      steps: 5, system: 'api_key=not-for-display', request: { headers: { authorization: 'secret' } },
      permissions: [{ action: 'edit', resource: '*', effect: 'deny' }],
    }])
    expect(result.nativeResolved).toBe(true)
    expect(result.agents[0]?.model).toBe('native/chosen')
    expect(result.agents[0]?.sources.model).toBe('native')
    expect(JSON.stringify(result)).not.toContain('not-for-display')
    expect(JSON.stringify(result)).not.toContain('authorization')
  })
  it('redacts common secret shapes and bounds displayed prompts', () => {
    expect(redactConfigurationText('Bearer abcdefghijklmnop')).toBe('Bearer [redacted]')
    expect(redactConfigurationText('a'.repeat(100_000)).length).toBe(64_000)
  })
  it('does not invent branches, live preview integration or merge authority', () => {
    const result = buildProjectSnapshot({ projectRoot: '/fixture' })
    expect(result.branches).toBeNull()
    expect(result.policy).toBeNull()
    expect(result.capabilities).toEqual({ mergeExecutor: 'unavailable', previewAdapter: 'unavailable', remoteProtection: 'unknown' })
  })
})
