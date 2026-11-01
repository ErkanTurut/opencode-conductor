// Agent roster registration: markdown parsing, permission mapping, fleet model
// overrides, and the dual registration path (runtime transform + files).
//
// Two kinds of assertions live here:
//   - pure parsing/mapping against hand-written fixtures, so a failure names the
//     exact rule rather than "the real file changed";
//   - the real `assets/agents/*.md` roster, because the roster is the product:
//     15 ids, a primary `conductor`, and no secret reads outside `conductor`.
import { afterEach, describe, expect, it } from 'bun:test'
import * as nodeFs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ENV_READ_DENY,
  loadAgentDefinitions,
  loadFleetConfig,
  mapPermissionBlock,
  parseAgentMarkdown,
  parseModelRef,
  registerAgents,
  type AgentDefinition,
  type AgentEditor,
  type AgentRegistrationContext,
  type FleetConfig,
  type MutableAgentConfig,
  type PermissionRule,
} from '../../src/register/agents'
import type { MaterializeFs } from '../../src/runtime/compat'

const ASSETS_DIR = join(import.meta.dir, '..', '..', 'assets')

/** The five fs calls `materializeAgentFiles` is allowed to make. */
const io: MaterializeFs = {
  mkdirSync: (path, options) =>
    nodeFs.mkdirSync(path, options as nodeFs.MakeDirectoryOptions),
  writeFileSync: (path, data, options) =>
    nodeFs.writeFileSync(path, data, options as nodeFs.WriteFileOptions),
  renameSync: (from, to) => nodeFs.renameSync(from, to),
  readFileSync: (path, encoding) =>
    nodeFs.readFileSync(path, { encoding: encoding as BufferEncoding }),
  existsSync: (path) => nodeFs.existsSync(path),
}

const created: string[] = []

function tempDir(): string {
  const dir = nodeFs.mkdtempSync(join(tmpdir(), 'conductor-roster-'))
  created.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of created.splice(0)) {
    nodeFs.rmSync(dir, { recursive: true, force: true })
  }
})

function rulesFor(rules: PermissionRule[] | undefined, action: string): PermissionRule[] {
  return (rules ?? []).filter((rule) => rule.action === action)
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXTURE = `---
description: "Fixture agent: keeps the colon in the description"
mode: subagent
model: opencode-go/deepseek-v4.1-flash
variant: max
steps: 7
permission:
  read:
    '*': allow
    '**/.env*': deny
    '**/*.key': deny
  edit:
    '*': deny
    'src/**': allow
  bash:
    '*': allow
    'git push*': deny
  task: deny
  'supervisor_*': allow
  webfetch: allow
---
You are FIXTURE.

Do the fixture thing.
`

const NO_ENV_RULE = `---
description: Fixture without the env deny
mode: subagent
permission:
  read:
    '*': allow
---
Body.
`

const ORDERING = `---
description: Ordering fixture
mode: subagent
permission:
  read:
    first: allow
    second: ask
    third: deny
---
Body.
`

const ORDERING_PERMISSIONS = parseAgentMarkdown('ordering.md', ORDERING)

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

describe('parseAgentMarkdown', () => {
  it('parses description, mode, model/variant, steps, permissions and body', () => {
    const agent = parseAgentMarkdown('fixture.md', FIXTURE)

    expect(agent.id).toBe('fixture')
    expect(agent.description).toBe('Fixture agent: keeps the colon in the description')
    expect(agent.mode).toBe('subagent')
    expect(agent.model).toEqual({
      providerID: 'opencode-go',
      id: 'deepseek-v4.1-flash',
      variant: 'max',
    })
    expect(agent.steps).toBe(7)
    // Everything after the closing `---`, separator newlines removed.
    expect(agent.system).toBe('You are FIXTURE.\n\nDo the fixture thing.')
  })

  it('derives the id from the file name and survives a body-only file', () => {
    const agent = parseAgentMarkdown('/tmp/agents/prompt-only.md', 'Just a prompt.\n')

    expect(agent.id).toBe('prompt-only')
    expect(agent.description).toBe('')
    expect(agent.mode).toBe('subagent')
    expect(agent.system).toBe('Just a prompt.')
    expect(agent.model).toBeUndefined()
  })

  it('reads an inline #variant when no variant key is present', () => {
    const agent = parseAgentMarkdown(
      'inline.md',
      '---\ndescription: d\nmodel: opencode-go/model#fast\n---\nBody.\n',
    )
    expect(agent.model).toEqual({
      providerID: 'opencode-go',
      id: 'model',
      variant: 'fast',
    })
  })

  it('rejects a provider-less model reference instead of forwarding it', () => {
    expect(parseModelRef('deepseek-v4.1-flash')).toBeUndefined()
    expect(parseModelRef('')).toBeUndefined()
    expect(parseModelRef(undefined)).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Permission mapping
// ---------------------------------------------------------------------------

describe('permission mapping', () => {
  it('maps bash to shell and task to subagent', () => {
    const agent = parseAgentMarkdown('fixture.md', FIXTURE)

    const shell = rulesFor(agent.permissions, 'shell')
    expect(shell.length).toBe(2)
    expect(shell.map((rule) => rule.resource)).toEqual(['*', 'git push*'])

    expect(rulesFor(agent.permissions, 'subagent')).toEqual([
      { action: 'subagent', resource: '*', effect: 'deny' },
    ])

    // The aliased names never leak through.
    expect(rulesFor(agent.permissions, 'bash')).toEqual([])
    expect(rulesFor(agent.permissions, 'task')).toEqual([])
  })

  it('drops supervisor_* instead of forwarding an unknown action', () => {
    const agent = parseAgentMarkdown('fixture.md', FIXTURE)
    expect(agent.permissions?.some((rule) => rule.action.startsWith('supervisor_'))).toBe(false)
  })

  it('preserves source order for native last-match permission evaluation', () => {
    const rules = ORDERING_PERMISSIONS.permissions ?? []

    expect(rules).toEqual([
      { action: 'read', resource: 'first', effect: 'allow' },
      { action: 'read', resource: 'second', effect: 'ask' },
      { action: 'read', resource: 'third', effect: 'deny' },
      // Appended because the fixture declares no env rule.
      { ...ENV_READ_DENY },
    ])
  })

  it('puts narrow read denies after the broad allow of the same action', () => {
    const agent = parseAgentMarkdown('fixture.md', FIXTURE)

    expect(rulesFor(agent.permissions, 'read').map((rule) => rule.effect)).toEqual([
      'allow',
      'deny',
      'deny',
    ])
    expect(rulesFor(agent.permissions, 'edit')).toEqual([
      { action: 'edit', resource: '*', effect: 'deny' },
      { action: 'edit', resource: 'src/**', effect: 'allow' },
    ])
  })

  it('turns an unrecognised effect into ask, never allow', () => {
    expect(mapPermissionBlock({ read: { '*': 'maybe' } })).toEqual([
      { action: 'read', resource: '*', effect: 'ask' },
    ])
  })

  it('appends the env read deny for a non-conductor agent', () => {
    const agent = parseAgentMarkdown('no-env.md', NO_ENV_RULE)
    const read = rulesFor(agent.permissions, 'read')

    expect(read).toEqual([
      { action: 'read', resource: '*', effect: 'allow' },
      { ...ENV_READ_DENY },
    ])
    expect(read[read.length - 1]).toEqual({
      action: 'read',
      resource: '**/.env*',
      effect: 'deny',
    })
  })

  it('does not give conductor the env read deny (it debugs runs)', () => {
    const agent = parseAgentMarkdown('conductor.md', NO_ENV_RULE)
    expect(rulesFor(agent.permissions, 'read')).toEqual([
      { action: 'read', resource: '*', effect: 'allow' },
    ])
  })

  it('does not duplicate an env deny the file already declares', () => {
    const agent = parseAgentMarkdown('fixture.md', FIXTURE)
    const envRules = rulesFor(agent.permissions, 'read').filter(
      (rule) => rule.resource === ENV_READ_DENY.resource,
    )
    expect(envRules.length).toBe(1)
  })

  it('leaves a permission-less agent with only the appended env deny', () => {
    const agent = parseAgentMarkdown('bare.md', '---\ndescription: bare\n---\nBody.\n')
    expect(agent.permissions).toEqual([{ ...ENV_READ_DENY }])
  })
})

// ---------------------------------------------------------------------------
// The real roster
// ---------------------------------------------------------------------------

describe('the real agent roster', () => {
  const fleet = loadFleetConfig(ASSETS_DIR)
  const definitions = loadAgentDefinitions(ASSETS_DIR, fleet)

  it('loads the fleet config with one role per agent', () => {
    expect(fleet).not.toBeNull()
    expect(fleet?.version).toBe(1)
    expect(fleet?.defaults?.fallbackModel).toBe('opencode-go/deepseek-v4.1-flash')
    expect(Object.keys(fleet?.models ?? {}).length).toBe(15)
  })

  it('parses all 15 assets into unique ids', () => {
    expect(definitions.length).toBe(15)
    const ids = definitions.map((definition) => definition.id)
    expect(new Set(ids).size).toBe(15)
    expect(ids).toContain('conductor')
    expect(ids).toContain('coder')
    expect(ids).toContain('visual-sketch-translator')
  })

  it('has conductor as the only primary agent', () => {
    const primaries = definitions.filter((definition) => definition.mode === 'primary')
    expect(primaries.map((definition) => definition.id)).toEqual(['conductor'])
  })

  it('gives every agent a description, a system prompt and a model', () => {
    for (const definition of definitions) {
      expect(definition.description.length).toBeGreaterThan(0)
      expect(definition.system.length).toBeGreaterThan(0)
      expect(definition.model?.providerID.length ?? 0).toBeGreaterThan(0)
    }
  })

  it('denies .env reads for every agent except conductor', () => {
    for (const definition of definitions) {
      const envRules = (definition.permissions ?? []).filter(
        (rule) => rule.action === 'read' && rule.resource === ENV_READ_DENY.resource,
      )
      if (definition.id === 'conductor') {
        // It may read secrets to debug a run; no deny is appended.
        expect(envRules).not.toContainEqual({ ...ENV_READ_DENY })
      } else {
        expect(envRules).toEqual([{ ...ENV_READ_DENY }])
      }
    }
  })

  it('maps the coder bash block to shell with the broad default first', () => {
    const coder = definitions.find((definition) => definition.id === 'coder')
    const shell = rulesFor(coder?.permissions, 'shell')
    expect(shell.length).toBeGreaterThan(1)
    expect(shell[0].effect).toBe('allow')
    expect(shell[0].resource).toBe('*')
    expect(shell[shell.length - 1]).toEqual({
      action: 'shell',
      resource: 'chown*',
      effect: 'deny',
    })
  })

  it('prefers markdown model over legacy fleet by role id', () => {
    const overridden: FleetConfig = {
      ...fleet,
      models: {
        ...(fleet?.models ?? {}),
        coder: { model: 'opencode-go/other-model', variant: 'fast' },
      },
    }
    const withOverride = loadAgentDefinitions(ASSETS_DIR, overridden)
    const coder = withOverride.find((definition) => definition.id === 'coder')

    expect(coder?.model).toEqual({
      providerID: 'opencode-go',
      id: 'deepseek-v4.1-flash',
      variant: 'max',
    })
    // Untouched roles keep their own model.
    const critic = withOverride.find((definition) => definition.id === 'critic')
    expect(critic?.model).toEqual({ providerID: 'opencode-go', id: 'mimo-v2.6-pro' })
  })
})

// ---------------------------------------------------------------------------
// registerAgents
// ---------------------------------------------------------------------------

interface StubContext {
  ctx: AgentRegistrationContext
  ids: string[]
  defaultId: string
  agents: Record<string, MutableAgentConfig>
}

/** The runtime contract, as the probe observed it: mutate, then default. */
function stubContext(): StubContext {
  const ids: string[] = []
  const agents: Record<string, MutableAgentConfig> = {}
  const stub: StubContext = { ctx: {}, ids, defaultId: '', agents }

  stub.ctx = {
    agent: {
      transform: async (callback) => {
        const editor: AgentEditor = {
          get(id) { return agents[id] },
          update(id, apply) {
            const agent: MutableAgentConfig = {}
            apply(agent)
            ids.push(id)
            agents[id] = agent
          },
          default(id) {
            stub.defaultId = id
          },
        }
        callback(editor)
        return { dispose() {} }
      },
    },
  }

  return stub
}

const fleet = loadFleetConfig(ASSETS_DIR)
const roster = loadAgentDefinitions(ASSETS_DIR, fleet)

describe('registerAgents', () => {
  it('registers the roster through the runtime transform by default and writes no files', async () => {
    const stub = stubContext()
    const dir = tempDir()
    const result = await registerAgents(stub.ctx, roster, {
      configDir: dir,
      env: {},
      fs: io,
      fleet,
    })

    // The transform is the registration path: every id is available in memory,
    // and nothing is written into the user's global config.
    expect(result.registered).toHaveLength(15)
    expect(new Set(result.registered).size).toBe(15)
    expect(result.registered).toEqual(roster.map((definition) => definition.id))
    expect(result.materialized).toEqual([])
    expect(result.registration).toBe('transform')
    expect(result.defaultAgent).toBe('conductor')
    expect(result.warnings).toEqual([])
    expect(stub.ids).toHaveLength(15)
    expect(stub.agents.coder.name).toBe('coder')

    for (const definition of roster) {
      expect(nodeFs.existsSync(join(dir, 'agents', `${definition.id}.md`))).toBe(false)
    }

    // `editor.default` is opt-in: the user's config owns the default agent.
    expect(stub.defaultId).toBe('')
  })

  it('sets conductor as the runtime default only when asked', async () => {
    const stub = stubContext()
    const result = await registerAgents(stub.ctx, roster, {
      configDir: tempDir(),
      env: {},
      fs: io,
      fleet,
      transform: true,
      setDefault: true,
    })

    expect(result.registered).toHaveLength(15)
    expect(new Set(result.registered).size).toBe(15)
    expect(result.registered).toEqual(roster.map((definition) => definition.id))
    expect(result.defaultAgent).toBe('conductor')
    expect(stub.defaultId).toBe('conductor')
    expect(result.warnings).toEqual([])

    // The mutable object actually carried the definition.
    expect(stub.agents.coder.system).toBe(
      roster.find((definition) => definition.id === 'coder')?.system,
    )
    expect(stub.agents.coder.model).toEqual({
      providerID: 'opencode-go',
      id: 'deepseek-v4.1-flash',
      variant: 'max',
    })
    expect(stub.agents.conductor.mode).toBe('primary')
    expect(stub.agents.conductor.permissions?.some(
      (rule) => rule.action.startsWith('supervisor_'),
    )).toBe(false)
  })

  it('materialises the same roster as files exactly once when the fallback is enabled', async () => {
    const stub = stubContext()
    const dir = tempDir()

    const first = await registerAgents(stub.ctx, roster, {
      configDir: dir,
      env: {},
      fs: io,
      fleet,
      transform: false,
      materialize: true,
    })
    expect(first.materialized).toHaveLength(15)
    expect(first.registered).toHaveLength(15)
    expect(first.registration).toBe('files')
    for (const definition of roster) {
      expect(nodeFs.existsSync(join(dir, 'agents', `${definition.id}.md`))).toBe(true)
    }

    const conductorFile = nodeFs.readFileSync(join(dir, 'agents', 'conductor.md'), 'utf8')
    expect(conductorFile).toContain('mode: primary')
    expect(conductorFile).toContain('Coordinates bounded software runs')
    // V2 frontmatter is what the runtime discovers globally.
    expect(conductorFile).toContain('permissions:\n')
    expect(conductorFile).not.toContain('\npermission:\n')

    // Idempotent: the files are byte-identical, so nothing is rewritten — and
    // the roster still reads as registered.
    const second = await registerAgents(stub.ctx, roster, {
      configDir: dir,
      env: {},
      fs: io,
      fleet,
      transform: false,
      materialize: true,
    })
    expect(second.materialized).toEqual([])
    expect(second.registered).toHaveLength(15)
  })

  it('honours CONDUCTOR_NO_MATERIALIZE=1', async () => {
    const stub = stubContext()
    const result = await registerAgents(stub.ctx, roster, {
      configDir: tempDir(),
      env: { CONDUCTOR_NO_MATERIALIZE: '1' },
      fs: io,
      fleet,
      transform: false,
      materialize: true,
    })

    // Nothing is registered by any path: no transform, and the write is off.
    expect(result.registered).toEqual([])
    expect(result.materialized).toEqual([])
    expect(result.registration).toBe('none')
  })

  it('preserves an explicit model outside the fleet', async () => {
    const stub = stubContext()
    const stray: AgentDefinition = {
      id: 'ghost',
      description: 'ghost',
      mode: 'subagent',
      system: 'Ghost.',
      model: { providerID: 'totally-unknown', id: 'ghost-model' },
    }

    const result = await registerAgents(stub.ctx, [stray], {
      configDir: tempDir(),
      env: {},
      fs: io,
      fleet,
      transform: true,
    })

    expect(result.warnings).toEqual([])
    expect(stub.agents.ghost.model).toEqual({ providerID: 'totally-unknown', id: 'ghost-model' })
  })

  it('keeps a known provider whose model is not in the fleet', async () => {
    const dir = tempDir()
    const stray: AgentDefinition = {
      id: 'known-provider',
      description: 'known',
      mode: 'subagent',
      system: 'Known.',
      model: { providerID: 'opencode-go', id: 'unlisted-model' },
    }

    const result = await registerAgents(null, [stray], {
      configDir: dir,
      env: {},
      fs: io,
      fleet,
      transform: false,
      materialize: true,
    })

    expect(result.warnings).toEqual([])
    expect(result.registered).toEqual(['known-provider'])
    const written = nodeFs.readFileSync(
      join(dir, 'agents', 'known-provider.md'),
      'utf8',
    )
    expect(written).toContain('model: "opencode-go/unlisted-model"')
  })

  it('defaults to transform registration and needs no filesystem', async () => {
    const stub = stubContext()
    const result = await registerAgents(stub.ctx, roster, {
      configDir: tempDir(),
      env: {},
      fs: io,
      fleet,
    })

    expect(result.registered).toHaveLength(15)
    expect(result.materialized).toEqual([])
    expect(result.registration).toBe('transform')
    expect(result.warnings).toEqual([])
  })

  it('reports a missing transform when transform registration is requested', async () => {
    const result = await registerAgents(null, roster, {
      configDir: tempDir(),
      env: {},
      fs: io,
      fleet,
      transform: true,
    })

    expect(result.registered).toEqual([])
    expect(result.materialized).toEqual([])
    expect(result.registration).toBe('none')
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('agent.transform')
  })

  it('reports a failing transform and still writes the files when the fallback is enabled', async () => {
    const failing: AgentRegistrationContext = {
      agent: {
        transform() {
          throw new Error('runtime refused the transform')
        },
      },
    }

    const result = await registerAgents(failing, roster, {
      configDir: tempDir(),
      env: {},
      fs: io,
      fleet,
      transform: true,
      materialize: true,
    })

    expect(result.registered).toEqual([])
    expect(result.materialized).toHaveLength(15)
    expect(result.registration).toBe('files')
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('runtime refused the transform')
  })

  it('still permits explicit materialization when editor.get is unavailable', async () => {
    let updates = 0
    const result = await registerAgents({ agent: { transform(callback) {
      callback({ update() { updates++ }, default() {} })
    } } }, roster, {
      configDir: tempDir(), env: {}, fs: io, fleet, materialize: true,
    })
    expect(updates).toBe(0)
    expect(result.materialized).toHaveLength(15)
    expect(result.registration).toBe('files')
    expect(result.warnings.join(' ')).toContain('editor.get is unavailable')
  })

  it('reports a single failing agent without dropping the rest', async () => {
    const partial: AgentRegistrationContext = {
      agent: {
        transform(callback) {
          const editor: AgentEditor = {
            get() { return undefined },
            update(id, apply) {
              if (id === 'critic') throw new Error('duplicate id')
              const agent: MutableAgentConfig = {}
              apply(agent)
            },
            default() {},
          }
          callback(editor)
          return { dispose() {} }
        },
      },
    }

    const result = await registerAgents(partial, roster, {
      configDir: tempDir(),
      env: {},
      fs: io,
      fleet,
      transform: true,
    })

    expect(result.registered).toHaveLength(14)
    expect(result.registered).not.toContain('critic')
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('critic')
    expect(result.warnings[0]).toContain('duplicate id')
  })
})
