import { afterEach, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { registerConductorRpc } from '../../src/rpc/register'
import { tempProject } from '../read/seed'

const projects: ReturnType<typeof tempProject>[] = []
afterEach(() => { for (const project of projects.splice(0)) project.cleanup() })
function setup(options: { trusted?: boolean; policyRestricted?: boolean; configDir?: string; reload?: () => Promise<void>; agentGet?: (input: unknown, options: unknown) => Promise<unknown>; globalDirectory?: string; configurationAuthorityIntact?: () => boolean; onProjectSettingsSaved?: (value: any) => void } = {}) {
  const project = tempProject('rpc-configuration'); projects.push(project)
  const configDir = options.configDir ?? join(project.root, 'config'); mkdirSync(configDir, { recursive: true })
  const assetsDir = join(project.root, 'assets'); mkdirSync(join(assetsDir, 'agents'), { recursive: true })
  writeFileSync(join(assetsDir, 'agents', 'coder.md'), '---\nmodel: old/model\nsteps: 4\npermission:\n  shell:\n    "git *": allow\n    "git push*": deny\n---\nInherited system prompt\n')
  const captured: { handlers?: Record<string, (input: unknown) => Promise<any>> } = {}
  const ctx: any = { rpc: { register: async (_contract: unknown, handlers: unknown) => { captured.handlers = handlers as any; return {} } } }
  if (options.reload || options.agentGet) ctx.agent = { reload: options.reload, get: options.agentGet }
  const registered = registerConductorRpc(ctx, { projectRoot: project.root, layout: project.layout, trusted: options.trusted ?? true, policyRestricted: options.policyRestricted ?? false, assetsDir, configDir, globalDirectory: options.globalDirectory, configurationAuthorityIntact: options.configurationAuthorityIntact, onProjectSettingsSaved: options.onProjectSettingsSaved })
  const call = (name: string, input: unknown = {}) => {
    if (!captured.handlers) throw new Error('RPC handlers were not registered')
    return captured.handlers[name](input)
  }
  return { project, configDir, call, registered }
}

test('agent document reads inherited fixture and saves fields with duplicate permission order preserved', async () => {
  const { project, call } = setup()
  expect(await call('agentDocument', { agentId: 'coder', scope: 'project' })).toMatchObject({ ok: true, data: { fields: { model: 'old/model', system: 'Inherited system prompt\n' } } })
  const current = await call('agentDocument', { agentId: 'coder', scope: 'project' })
  const permissions = [
    { action: 'shell', resource: 'git push*', effect: 'deny' },
    { action: 'shell', resource: 'git *', effect: 'allow' },
    { action: 'shell', resource: 'git push*', effect: 'ask' },
  ]
  const saved = await call('saveAgentConfiguration', { agentId: 'coder', scope: 'project', expectedRevision: current.data.revision, fields: { model: 'provider/new-model', permissions } })
  expect(saved).toMatchObject({ ok: true, data: { fields: { model: 'provider/new-model', permissions } } })
  const text = readFileSync(join(project.root, '.opencode', 'agents', 'coder.md'), 'utf8')
  expect(text.indexOf('resource: "git push*"')).toBeLessThan(text.indexOf('resource: "git *"'))
  expect(text.indexOf('effect: deny')).toBeLessThan(text.indexOf('effect: allow'))
  expect(text.indexOf('effect: allow')).toBeLessThan(text.indexOf('effect: ask'))
})

test('configuration edits fail closed for untrusted and policy-restricted contexts without filesystem writes', async () => {
  for (const options of [{ trusted: false }, { policyRestricted: true }, { configurationAuthorityIntact: () => false }]) {
    const { project, call } = setup(options)
    const before = existsSync(join(project.root, '.opencode'))
    const read = await call('agentDocument', { agentId: 'coder', scope: 'project' })
    expect(read.ok).toBe(false)
    const write = await call('saveAgentConfiguration', { agentId: 'coder', scope: 'project', expectedRevision: 'x', fields: { system: 'no write' } })
    expect(write.ok).toBe(false)
    expect(existsSync(join(project.root, '.opencode'))).toBe(before)
  }
})

test('global edits inherit the global native prompt and restrictions, never packaged or project defaults', async () => {
  const seen: unknown[] = []
  const { call } = setup({ globalDirectory: '/fixture-global-location', agentGet: async (_input, options) => {
    seen.push(options)
    return { id: 'coder', description: 'Native global', mode: 'subagent', system: 'Native JSONC prompt', permissions: [{ action: '*', resource: '*', effect: 'deny' }], model: { providerID: 'native', id: 'chosen' } }
  } })
  const document = await call('agentDocument', { scope: 'global', agentId: 'coder' })
  expect(document.ok).toBe(true)
  expect(document.data.fields.system).toBe('Native JSONC prompt')
  const saved = await call('saveAgentConfiguration', { scope: 'global', agentId: 'coder', expectedRevision: document.data.revision, fields: { steps: 8 } })
  expect(saved.ok).toBe(true)
  expect(saved.data.fields.permissions).toEqual([{ action: '*', resource: '*', effect: 'deny' }])
  expect(saved.data.fields.system).toBe('Native JSONC prompt')
  expect(seen).toEqual([{ location: { directory: '/fixture-global-location' } }, { location: { directory: '/fixture-global-location' } }])
})

test('agent document rechecks revocable authority after native resolution', async () => {
  let intact = true
  const { call } = setup({ configurationAuthorityIntact: () => intact, agentGet: async () => { intact = false; return { system: 'Must not disclose' } } })
  const result = await call('agentDocument', { scope: 'project', agentId: 'coder' })
  expect(result.ok).toBe(false)
  expect(result.error.code).toBe('policy_restricted')
  expect(JSON.stringify(result)).not.toContain('Must not disclose')
})

test('an unknown host agent falls back to a createable target instead of failing', async () => {
  const { call } = setup({ agentGet: async () => { throw new Error('Agent not found') } })
  const document = await call('agentDocument', { scope: 'project', agentId: 'new-probe' })
  expect(document.ok).toBe(true)
  expect(document.data.fields.system).toBe('')
  const saved = await call('saveAgentConfiguration', { scope: 'project', agentId: 'new-probe', expectedRevision: document.data.revision, fields: { system: 'Probe prompt', steps: 3 } })
  expect(saved.ok).toBe(true)
  expect(saved.data.fields.system).toBe('Probe prompt')
})

test('rejects invalid agent scope, id, field shapes and stale revision without overwriting', async () => {
  const { project, call } = setup()
  expect((await call('agentDocument', { agentId: '../coder', scope: 'project' })).ok).toBe(false)
  expect((await call('agentDocument', { agentId: 'coder', scope: 'arbitrary' })).error.code).toBe('invalid_input')
  const document = await call('agentDocument', { agentId: 'coder', scope: 'project' })
  const path = join(project.root, '.opencode', 'agents', 'coder.md')
  const fields = { model: 'provider/first' }
  expect((await call('saveAgentConfiguration', { agentId: 'coder', scope: 'project', expectedRevision: document.data.revision, fields: { ...fields, injected: true } })).ok).toBe(false)
  const saved = await call('saveAgentConfiguration', { agentId: 'coder', scope: 'project', expectedRevision: document.data.revision, fields })
  expect(saved.ok).toBe(true)
  const bytes = readFileSync(path, 'utf8')
  const stale = await call('saveAgentConfiguration', { agentId: 'coder', scope: 'project', expectedRevision: document.data.revision, fields: { model: 'provider/second' } })
  expect(stale).toMatchObject({ ok: false, error: { code: 'conflict' } })
  expect(readFileSync(path, 'utf8')).toBe(bytes)
})

test('reload failure reports saved warning and never retries old revision', async () => {
  let reloads = 0
  const { project, call } = setup({ reload: async () => { reloads++; throw new Error('reload unavailable') } })
  const document = await call('agentDocument', { agentId: 'coder', scope: 'project' })
  const result = await call('saveAgentConfiguration', { agentId: 'coder', scope: 'project', expectedRevision: document.data.revision, fields: { model: 'provider/saved' } })
  expect(result.ok).toBe(true)
  expect(result.data.warnings.join(' ')).toContain('Saved to disk')
  expect(reloads).toBe(1)
  expect(readFileSync(join(project.root, '.opencode', 'agents', 'coder.md'), 'utf8')).toContain('provider/saved')
})

test('project settings roundtrip invokes callback and rejects invalid/malformed data without overwrite', async () => {
  const callbacks: unknown[] = []
  const { project, call } = setup({ onProjectSettingsSaved: (value) => callbacks.push(value) })
  const current = await call('projectSettings')
  const settings = { branches: { main: 'trunk', dev: 'develop' }, verificationCommands: ['bun test'], preview: { provider: 'other', url: 'https://preview.example.test', branch: 'preview' }, memory: { enabled: false } }
  const saved = await call('saveProjectSettings', { expectedRevision: current.data.revision, settings })
  expect(saved).toMatchObject({ ok: true, data: { settings } })
  expect(callbacks).toEqual([settings])
  const path = join(project.root, '.opencode', 'conductor.json'); const bytes = readFileSync(path, 'utf8')
  expect((await call('saveProjectSettings', { expectedRevision: saved.data.revision, settings: { ...settings, branches: { main: '../bad', dev: 'develop' } } })).ok).toBe(false)
  expect(readFileSync(path, 'utf8')).toBe(bytes)
  writeFileSync(path, '{malformed')
  const malformed = await call('projectSettings')
  expect(malformed.ok).toBe(false)
  expect(readFileSync(path, 'utf8')).toBe('{malformed')
})

test('stale project revision conflicts, bad RPC payloads are rejected, and global scope stays in injected configDir', async () => {
  const { project, configDir, call } = setup()
  expect((await call('saveProjectSettings', { expectedRevision: 12, settings: {} })).error.code).toBe('invalid_input')
  const current = await call('projectSettings')
  const settings = { branches: { main: 'main', dev: 'develop' }, verificationCommands: [], preview: { provider: 'none', url: '', branch: '' }, memory: { enabled: true } }
  expect((await call('saveProjectSettings', { expectedRevision: 'stale', settings })).error.code).toBe('conflict')
  const agent = await call('agentDocument', { agentId: 'coder', scope: 'global' })
  const globalSaved = await call('saveAgentConfiguration', { agentId: 'coder', scope: 'global', expectedRevision: agent.data.revision, fields: { system: 'global override' } })
  expect(globalSaved.ok).toBe(true)
  expect(existsSync(join(configDir, 'agents', 'coder.md'))).toBe(true)
  expect(existsSync(join(project.root, 'agents', 'coder.md'))).toBe(false)
  expect(current.ok).toBe(true)
})
