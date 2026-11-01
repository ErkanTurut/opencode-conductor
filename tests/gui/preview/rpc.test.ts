import { expect, test } from 'bun:test'
import { client, configure } from './rpc'

test('preview settings persist per directory and reject stale revisions', async () => {
  configure({ scenario: 'normal', project: false })
  const rpc = client.rpc(null) as any
  const a = { location: { directory: '/fixture/test-settings-a' } }
  const b = { location: { directory: '/fixture/test-settings-b' } }
  const initial = await rpc.projectSettings({}, a)
  const settings = { branches: { main: 'main', dev: 'dev' }, verificationCommands: ['bun test'], preview: { provider: 'none', url: '', branch: '' }, memory: { enabled: false } }
  const saved = await rpc.saveProjectSettings({ expectedRevision: initial.data.revision, settings }, a)
  expect(saved.ok).toBe(true)
  expect((await rpc.projectSettings({}, a)).data.settings).toEqual(settings)
  expect((await rpc.projectSettings({}, b)).data.settings).toBeNull()
  expect((await rpc.saveProjectSettings({ expectedRevision: initial.data.revision, settings }, a)).error.code).toBe('conflict')
})

test('preview agent documents persist by scope and surface errors', async () => {
  configure({ scenario: 'normal', project: false })
  const rpc = client.rpc(null) as any
  const location = { location: { directory: '/fixture/test-agent' } }
  const input = { agentId: 'coder', scope: 'project' }
  const initial = await rpc.agentDocument(input, location)
  const saved = await rpc.saveAgentConfiguration({ ...input, expectedRevision: initial.data.revision, fields: { system: 'Updated' } }, location)
  expect(saved.data.fields.system).toBe('Updated')
  expect((await rpc.agentDocument({ ...input, scope: 'global' }, location)).data.fields.system).toBe('')
  expect((await rpc.saveAgentConfiguration({ ...input, expectedRevision: initial.data.revision, fields: {} }, location)).error.code).toBe('conflict')
  configure({ scenario: 'error', project: false })
  expect((await rpc.agentDocument(input, location)).error.code).toBe('FIXTURE_ERROR')
  configure({ scenario: 'normal', project: false })
})
