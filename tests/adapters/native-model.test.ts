import { expect, test } from 'bun:test'
import { buildAgentArguments, type AgentSpec } from '../../src/adapters/opencode-cli'

test('the CLI adapter delegates model resolution to native OpenCode by default', () => {
  const spec: AgentSpec = { taskId: 't', runId: 'r', role: 'coder', objective: 'Fixture', worktree: '/fixture', allowedPaths: [], acceptanceCriteria: [], verificationCommands: [], mustNot: [] }
  expect(buildAgentArguments(spec).slice(0, 3)).toEqual(['run', '--agent', 'coder'])
  expect(buildAgentArguments(spec)).not.toContain('--model')
  expect(buildAgentArguments({ ...spec, model: 'native/example', variant: 'high' }).slice(0, 5)).toEqual(['run', '--agent', 'coder', '--model', 'native/example#high'])
})
