// Tests for the models/agents CLI layer (`src/cli-models.ts`) and the
// agent frontmatter sync (`src/fleet-sync.ts`). Fully offline: parsers
// are pure, executors run against temp-dir configs, and sync fixtures
// live only in temp directories — never the real .opencode/agents.

import { describe, it, expect, afterAll } from 'bun:test'
import * as nodeFs from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AGENT_ROLES } from '../src/types'
import {
  parseAgentsArgs,
  parseModelsArgs,
  runAgentsCommand,
  runModelsCommand,
} from '../src/cli-models'
import type { AgentsCommand, ModelsCommand } from '../src/cli-models'
import {
  DEFAULT_AGENTS_DIR_SEGMENT,
  FLEET_UI_AGENTS_DIR_ENV_VAR,
  applyAgentOverridesToMarkdown,
  resolveAgentsDir,
  syncAgentsFromConfig,
} from '../src/fleet-sync'

let cleanupDirs: string[] = []

function makeTempDir(): string {
  const dir = nodeFs.mkdtempSync(join(tmpdir(), 'cli-models-'))
  cleanupDirs.push(dir)
  return dir
}

afterAll(() => {
  const dirs = cleanupDirs
  cleanupDirs = []
  for (const dir of dirs) {
    nodeFs.rmSync(dir, { recursive: true, force: true })
  }
})

/** Base fixture config written to a temp config path. */
function writeBaseConfig(configPath: string): void {
  nodeFs.writeFileSync(
    configPath,
    JSON.stringify({
      models: {},
      extraModels: {
        'vercel/xai/grok-4.5': {
          providerId: 'vercel',
          modelId: 'xai/grok-4.5',
          modelFamily: 'grok',
          roleSuitability: { architecture: 0.95 },
          toolSupport: true,
          imageSupport: false,
          contextLimit: 500000,
          costPer1kTokens: 0.002,
        },
      },
      agentOverrides: {},
      slotDefaults: {},
      steps: {},
    }),
  )
}

// --- Parser tests ---

describe('parseModelsArgs', () => {
  it('parses all subcommands', () => {
    expect(parseModelsArgs(['list'])).toEqual({
      ok: true,
      value: { action: 'list' },
    })
    expect(parseModelsArgs(['set', 'coder', 'opencode/kimi-k3'])).toEqual({
      ok: true,
      value: { action: 'set', role: 'coder', model: 'opencode/kimi-k3' },
    })
    expect(
      parseModelsArgs(['set', 'coder', 'opencode/kimi-k3', '--variant', 'max']),
    ).toEqual({
      ok: true,
      value: {
        action: 'set',
        role: 'coder',
        model: 'opencode/kimi-k3',
        variant: 'max',
      },
    })
    expect(parseModelsArgs(['reset', 'critic'])).toEqual({
      ok: true,
      value: { action: 'reset', role: 'critic' },
    })
    expect(parseModelsArgs(['enable', 'opencode/kimi-k3'])).toEqual({
      ok: true,
      value: { action: 'enable', model: 'opencode/kimi-k3' },
    })
    expect(parseModelsArgs(['disable', 'opencode/kimi-k3'])).toEqual({
      ok: true,
      value: { action: 'disable', model: 'opencode/kimi-k3' },
    })
    expect(parseModelsArgs(['sync-agents'])).toEqual({
      ok: true,
      value: { action: 'sync-agents', agentsDir: undefined },
    })
    expect(
      parseModelsArgs(['sync-agents', '--agents-dir', '/tmp/agents']),
    ).toEqual({
      ok: true,
      value: { action: 'sync-agents', agentsDir: '/tmp/agents' },
    })
  })

  it('returns typed errors on bad input', () => {
    const cases: string[][] = [
      [],
      ['bogus'],
      ['set'],
      ['set', 'coder'],
      ['set', 'coder', 'a', 'b'],
      ['reset'],
      ['reset', 'a', 'b'],
      ['enable'],
      ['disable'],
      ['list', 'extra'],
      ['sync-agents', 'positional'],
      ['sync-agents', '--unknown-flag', 'x'],
      ['set', 'coder', 'm', '--variant'],
      ['set', 'coder', 'm', '--bogus', 'v'],
    ]
    for (const argv of cases) {
      const result = parseModelsArgs(argv)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.length).toBeGreaterThan(0)
    }
  })
})

describe('parseAgentsArgs', () => {
  it('parses all subcommands', () => {
    expect(parseAgentsArgs(['list'])).toEqual({
      ok: true,
      value: { action: 'list' },
    })
    expect(parseAgentsArgs(['set-steps', 'coder', '40'])).toEqual({
      ok: true,
      value: { action: 'set-steps', role: 'coder', steps: 40 },
    })
    expect(parseAgentsArgs(['reset', 'coder'])).toEqual({
      ok: true,
      value: { action: 'reset', role: 'coder' },
    })
  })

  it('rejects out-of-range or non-integer steps', () => {
    for (const raw of ['abc', '0', '-5', '10001', '2.5', '']) {
      const result = parseAgentsArgs(['set-steps', 'coder', raw])
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toContain('between 1 and 10000')
    }
  })

  it('returns typed errors on arity/unknown subcommands', () => {
    for (const argv of [
      ['bogus'],
      ['set-steps'],
      ['set-steps', 'coder'],
      ['reset'],
      [],
    ]) {
      expect(parseAgentsArgs(argv).ok).toBe(false)
    }
  })
})

// --- Executor tests ---

describe('models/agents command execution', () => {
  let dir: string
  let configPath: string
  let before: string

  const runModels = (cmd: ModelsCommand) =>
    runModelsCommand(cmd, { configPath })
  const runAgents = (cmd: AgentsCommand) =>
    runAgentsCommand(cmd, { configPath })

  const disk = () => JSON.parse(nodeFs.readFileSync(configPath, 'utf8'))

  const seed = (): void => {
    writeBaseConfig(configPath)
    before = nodeFs.readFileSync(configPath, 'utf8')
  }

  dir = makeTempDir()
  configPath = join(dir, 'models.json')
  seed()

  it('models list renders catalog + per-role assignments', () => {
    seed()
    // Give the fixture some state to render.
    expect(
      runAgents({ action: 'set-steps', role: 'coder', steps: 40 }).ok,
    ).toBe(true)
    expect(
      runModels({
        action: 'set',
        role: 'architect',
        model: 'vercel/xai/grok-4.5',
      }).ok,
    ).toBe(true)

    const result = runModels({ action: 'list' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const text = result.value.join('\n')
    expect(text).toContain('opencode/deepseek-v4-pro')
    expect(text).toContain('vercel/xai/grok-4.5')
    expect(text).toContain('healthy')
    expect(text).toContain('role-override')
    expect(text).toMatch(/architect\s+architecture\s+vercel\/xai\/grok-4\.5/)
    expect(text).toMatch(/coder\s+\S+\s+\S+\s+\S+\s+scored\s+40/)
    // All 13 roles appear.
    for (const role of AGENT_ROLES) expect(text).toContain(role)
  })

  it('models set persists an override; unknown refs fail without persisting', () => {
    seed()
    const good = runModels({
      action: 'set',
      role: 'critic',
      model: 'opencode/kimi-k3',
      variant: 'max',
    })
    expect(good.ok).toBe(true)
    expect(disk().agentOverrides.critic).toEqual({
      modelRef: 'opencode/kimi-k3',
      variant: 'max',
    })
    // Successful saves reformat the file; snapshot right before error paths.
    before = nodeFs.readFileSync(configPath, 'utf8')

    const badRole = runModels({
      action: 'set',
      role: 'not-a-role',
      model: 'opencode/kimi-k3',
    })
    expect(badRole.ok).toBe(false)
    if (!badRole.ok)
      expect(badRole.error).toContain("unknown agent role 'not-a-role'")

    const badModel = runModels({
      action: 'set',
      role: 'critic',
      model: 'ghost/model',
    })
    expect(badModel.ok).toBe(false)
    if (!badModel.ok)
      expect(badModel.error).toContain("unknown model 'ghost/model'")

    expect(nodeFs.readFileSync(configPath, 'utf8')).toBe(before)
  })

  it('models reset clears the override idempotently', () => {
    seed()
    expect(
      runModels({ action: 'set', role: 'scout', model: 'opencode/kimi-k3' }).ok,
    ).toBe(true)
    expect(disk().agentOverrides.scout?.modelRef).toBe('opencode/kimi-k3')

    const reset = runModels({ action: 'reset', role: 'scout' })
    expect(reset.ok).toBe(true)
    expect(disk().agentOverrides.scout).toBeUndefined()

    const again = runModels({ action: 'reset', role: 'scout' })
    expect(again.ok).toBe(true)
    if (!again.ok) return
    expect(again.value[0]).toContain('no model override existed')
  })

  it('models enable/disable persists flags; unknown model fails cleanly', () => {
    seed()
    expect(
      runModels({ action: 'disable', model: 'opencode/deepseek-v4-flash' }).ok,
    ).toBe(true)
    expect(disk().models['opencode/deepseek-v4-flash']).toEqual({
      enabled: false,
    })

    expect(
      runModels({ action: 'enable', model: 'opencode/deepseek-v4-flash' }).ok,
    ).toBe(true)
    expect(disk().models['opencode/deepseek-v4-flash']).toEqual({
      enabled: true,
    })
    before = nodeFs.readFileSync(configPath, 'utf8')

    const bad = runModels({ action: 'disable', model: 'ghost/model' })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error).toContain("unknown model 'ghost/model'")
    expect(nodeFs.readFileSync(configPath, 'utf8')).toBe(before)
  })

  it('agents set-steps / reset / list manage step overrides', () => {
    seed()
    expect(
      runAgents({ action: 'set-steps', role: 'coder', steps: 25 }).ok,
    ).toBe(true)
    expect(disk().steps.coder).toBe(25)

    const list = runAgents({ action: 'list' })
    expect(list.ok).toBe(true)
    if (list.ok) expect(list.value.join('\n')).toMatch(/coder\s+25\s+-/)

    expect(runAgents({ action: 'reset', role: 'coder' }).ok).toBe(true)
    expect(disk().steps.coder).toBeUndefined()
    expect(runAgents({ action: 'reset', role: 'coder' }).ok).toBe(true)
    before = nodeFs.readFileSync(configPath, 'utf8')

    const afterReset = runAgents({ action: 'list' })
    if (afterReset.ok)
      expect(afterReset.value.join('\n')).toMatch(/coder\s+default\s+-/)

    const bad = runAgents({
      action: 'set-steps',
      role: 'not-a-role',
      steps: 10,
    })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error).toContain('unknown agent role')
    expect(nodeFs.readFileSync(configPath, 'utf8')).toBe(before)
  })
})

// --- fleet-sync tests ---

describe('applyAgentOverridesToMarkdown', () => {
  it('rewrites existing lines and leaves everything else byte-identical', () => {
    const input = [
      '---',
      'description: Architect',
      'mode: subagent',
      'model: deepseek/deepseek-v4-pro',
      'variant: max',
      'steps: 20',
      'permission:',
      '  read: allow',
      '---',
      '',
      '# Body stays',
    ].join('\n')
    const result = applyAgentOverridesToMarkdown(input, {
      model: 'vercel/xai/grok-4.5',
    })
    expect(result.changed).toEqual(['model'])
    expect(result.content).toBe(
      [
        '---',
        'description: Architect',
        'mode: subagent',
        'model: vercel/xai/grok-4.5',
        'variant: max',
        'steps: 20',
        'permission:',
        '  read: allow',
        '---',
        '',
        '# Body stays',
      ].join('\n'),
    )
  })

  it('inserts missing keys right after the opening delimiter', () => {
    const input = [
      '---',
      'description: Scout',
      'mode: subagent',
      '---',
      'body',
    ].join('\n')
    const result = applyAgentOverridesToMarkdown(input, {
      model: 'opencode/kimi-k3',
      steps: 9,
    })
    expect(result.changed).toEqual(['model', 'steps'])
    expect(result.content).toBe(
      [
        '---',
        'model: opencode/kimi-k3',
        'steps: 9',
        'description: Scout',
        'mode: subagent',
        '---',
        'body',
      ].join('\n'),
    )
  })

  it('only rewrites the first occurrence of each key and never the body', () => {
    const input = [
      '---',
      'model: first/provider',
      'steps: 1',
      '---',
      'body with model: not/a-frontmatter and steps: 99',
    ].join('\n')
    const result = applyAgentOverridesToMarkdown(input, {
      model: 'second/provider',
      steps: 2,
    })
    expect(result.content).toBe(
      [
        '---',
        'model: second/provider',
        'steps: 2',
        '---',
        'body with model: not/a-frontmatter and steps: 99',
      ].join('\n'),
    )
  })

  it('synthesizes frontmatter when none exists and no-ops on identical values', () => {
    const bare = applyAgentOverridesToMarkdown('# just body\n', {
      model: 'p/m',
      steps: 7,
    })
    expect(bare.content).toBe('---\nmodel: p/m\nsteps: 7\n---\n\n# just body\n')
    expect(bare.changed).toEqual(['model', 'steps'])

    const same = '---\nmodel: p/m\nsteps: 7\n---\nx'
    const noop = applyAgentOverridesToMarkdown(same, { model: 'p/m', steps: 7 })
    expect(noop.changed).toEqual([])
    expect(noop.content).toBe(same)
  })

  it('strips control characters so a hostile value cannot create multi-line frontmatter', () => {
    const input = ['---', 'model: opencode/kimi-k3', '---', 'body'].join('\n')
    const result = applyAgentOverridesToMarkdown(input, {
      model: 'evil\nsteps: 9999\rinjected',
    })
    // Same line count as the input — nothing broke out of its line.
    expect(result.content.split('\n')).toHaveLength(input.split('\n').length)
    expect(result.content).toContain('evilsteps: 9999injected')
    expect(
      result.content.split('\n').filter((l) => l.startsWith('steps:')),
    ).toEqual([])

    // Insertion path is sanitized too.
    const inserted = applyAgentOverridesToMarkdown('# bare\n', {
      model: 'a\nb',
    })
    expect(inserted.content).toBe('---\nmodel: ab\n---\n\n# bare\n')
    expect(inserted.content.split('\n')).toHaveLength(6)
  })

  it('removes a stale variant when a model override has no variant', () => {
    const input = [
      '---',
      'model: old/provider',
      'variant: max',
      '---',
      'body',
    ].join('\n')
    const result = applyAgentOverridesToMarkdown(input, {
      model: 'new/provider',
      variant: null,
    })
    expect(result.content).toBe(
      ['---', 'model: new/provider', '---', 'body'].join('\n'),
    )
    expect(result.changed).toEqual(['model', 'variant'])
  })
})

describe('resolveAgentsDir', () => {
  it('prefers explicit arg over env over cwd default', () => {
    const previous = process.env[FLEET_UI_AGENTS_DIR_ENV_VAR]
    try {
      process.env[FLEET_UI_AGENTS_DIR_ENV_VAR] = '/env/agents'
      expect(
        resolveAgentsDir('/explicit/agents').endsWith('/explicit/agents'),
      ).toBe(true)
      delete process.env[FLEET_UI_AGENTS_DIR_ENV_VAR]
      expect(resolveAgentsDir()).toContain(DEFAULT_AGENTS_DIR_SEGMENT)
      process.env[FLEET_UI_AGENTS_DIR_ENV_VAR] = '/env/agents'
      expect(resolveAgentsDir().endsWith('/env/agents')).toBe(true)
    } finally {
      if (previous === undefined)
        delete process.env[FLEET_UI_AGENTS_DIR_ENV_VAR]
      else process.env[FLEET_UI_AGENTS_DIR_ENV_VAR] = previous
    }
  })
})

describe('syncAgentsFromConfig', () => {
  let dir: string
  let configPath: string
  let agentsDir: string

  const writeAgentFile = (role: string, content: string): string => {
    const filePath = join(agentsDir, `${role}.md`)
    nodeFs.writeFileSync(filePath, content)
    return filePath
  }

  const readAgentFile = (role: string): string =>
    nodeFs.readFileSync(join(agentsDir, `${role}.md`), 'utf8')

  const resetFixtures = (): void => {
    nodeFs.rmSync(agentsDir, { recursive: true, force: true })
    nodeFs.mkdirSync(agentsDir, { recursive: true })
    writeAgentFile(
      'architect',
      [
        '---',
        'description: A',
        'mode: subagent',
        'model: deepseek/deepseek-v4-pro',
        'variant: max',
        'steps: 20',
        '---',
        '',
        'architect body',
      ].join('\n') + '\n',
    )
    writeAgentFile(
      'scout',
      ['---', 'description: S', 'mode: subagent', '---', '', 'scout body'].join(
        '\n',
      ) + '\n',
    )
    writeAgentFile(
      'critic',
      [
        '---',
        'description: C',
        'mode: subagent',
        'model: opencode/gpt-5.6-luna',
        'permission:',
        '  read: allow',
        '---',
      ].join('\n') + '\n',
    )
    writeAgentFile(
      'conductor',
      ['---', 'description: Cond', '---', 'cond body'].join('\n') + '\n',
    )
  }

  const saveConfig = (
    overrides: Record<string, unknown>,
    steps: Record<string, number>,
  ): void => {
    nodeFs.writeFileSync(
      configPath,
      JSON.stringify({
        models: {},
        extraModels: {
          // Overrides below reference this extra catalog entry.
          'vercel/xai/grok-4.5': {
            providerId: 'vercel',
            modelId: 'xai/grok-4.5',
            modelFamily: 'grok',
            roleSuitability: { architecture: 0.95 },
            toolSupport: true,
            imageSupport: false,
            contextLimit: 500000,
            costPer1kTokens: 0.002,
          },
        },
        agentOverrides: overrides,
        slotDefaults: {},
        steps,
      }),
    )
  }

  dir = makeTempDir()
  configPath = join(dir, 'models.json')
  agentsDir = join(dir, 'agents')

  it('rewrites model/steps lines, inserts missing ones, skips roles without overrides', () => {
    resetFixtures()
    saveConfig(
      {
        architect: { modelRef: 'vercel/xai/grok-4.5' },
        scout: { modelRef: 'opencode/kimi-k3' },
      },
      { scout: 9, critic: 12 },
    )

    const result = syncAgentsFromConfig({ configPath, agentsDir })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.lines.some((l) => l.startsWith('architect: updated'))).toBe(
      true,
    )
    expect(result.lines.some((l) => l.startsWith('scout: updated'))).toBe(true)
    expect(result.lines.some((l) => l.startsWith('critic: updated'))).toBe(true)

    expect(readAgentFile('architect')).toBe(
      [
        '---',
        'description: A',
        'mode: subagent',
        'model: vercel/xai/grok-4.5',
        'steps: 20',
        '---',
        '',
        'architect body',
      ].join('\n') + '\n',
    )
    expect(readAgentFile('scout')).toBe(
      [
        '---',
        'model: opencode/kimi-k3',
        'steps: 9',
        'description: S',
        'mode: subagent',
        '---',
        '',
        'scout body',
      ].join('\n') + '\n',
    )
    expect(readAgentFile('critic')).toBe(
      [
        '---',
        'steps: 12',
        'description: C',
        'mode: subagent',
        'model: opencode/gpt-5.6-luna',
        'permission:',
        '  read: allow',
        '---',
      ].join('\n') + '\n',
    )

    // Role without overrides must be byte-identical.
    const conductorBefore = readAgentFile('conductor')
    expect(result.lines.some((l) => l.startsWith('conductor:'))).toBe(false)
    expect(readAgentFile('conductor')).toBe(conductorBefore)
  })

  it('is idempotent on rerun (unchanged statuses)', () => {
    resetFixtures()
    saveConfig({ architect: { modelRef: 'vercel/xai/grok-4.5' } }, {})
    expect(syncAgentsFromConfig({ configPath, agentsDir }).ok).toBe(true)
    const second = syncAgentsFromConfig({ configPath, agentsDir })
    expect(second.ok).toBe(true)
    if (second.ok)
      expect(second.lines.join('\n')).toContain('architect: unchanged')
    expect(syncAgentsFromConfig({ configPath, agentsDir }).ok).toBe(true)
  })

  it('emits a separate variant field for OpenCode Markdown frontmatter', () => {
    resetFixtures()
    nodeFs.writeFileSync(
      configPath,
      JSON.stringify({
        models: {},
        extraModels: {
          'vercel/xai/grok-4.5': {
            providerId: 'vercel',
            modelId: 'xai/grok-4.5',
            modelFamily: 'grok',
            variant: 'high',
            roleSuitability: { architecture: 0.95 },
            toolSupport: true,
            imageSupport: false,
            contextLimit: 500000,
            costPer1kTokens: 0.002,
          },
        },
        agentOverrides: {
          architect: { modelRef: 'vercel/xai/grok-4.5' },
          critic: { modelRef: 'vercel/xai/grok-4.5', variant: 'low' },
        },
        slotDefaults: {},
        steps: {},
      }),
    )

    const result = syncAgentsFromConfig({ configPath, agentsDir })
    expect(result.ok).toBe(true)
    // No explicit variant -> catalog default ('high') is written separately.
    expect(readAgentFile('architect')).toContain(
      'model: vercel/xai/grok-4.5\nvariant: high',
    )
    // Explicit override variant wins over the catalog default.
    expect(readAgentFile('critic')).toContain('variant: low')
    expect(readAgentFile('critic')).toContain('model: vercel/xai/grok-4.5')
  })

  it('errors clearly when an agent file is missing', () => {
    resetFixtures()
    saveConfig({ integrator: { modelRef: 'opencode/kimi-k3' } }, {})
    const result = syncAgentsFromConfig({ configPath, agentsDir })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain("missing agent file for role 'integrator'")
    expect(result.error).toContain(join(agentsDir, 'integrator.md'))
  })

  it('reports nothing to sync when no overrides are persisted', () => {
    resetFixtures()
    saveConfig({}, {})
    const result = syncAgentsFromConfig({ configPath, agentsDir })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.lines[0]).toContain('no persisted agent overrides')
    expect(readAgentFile('architect')).toContain(
      'model: deepseek/deepseek-v4-pro',
    )
  })

  it('never touches the real .opencode/agents directory', () => {
    // All fixtures above live in temp dirs; assert the default resolver
    // does not point into this package's real agents dir by accident
    // when an explicit temp dir is given.
    expect(resolveAgentsDir(agentsDir)).toContain(dir.split('/').pop()!)
  })
})
