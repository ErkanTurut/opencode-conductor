// Skill registration: the 15 workflow skills are package-owned assets
// (`assets/skills/<id>/SKILL.md`), loaded and registered through the runtime's
// `skill.transform(editor => editor.add(asset))` editor.
//
// Two kinds of assertions live here:
//   - the real asset set: 15 skills, unique ids, real frontmatter, absolute
//     paths that exist, and the `references/` sibling a skill resolves against;
//   - the registration contract: a stub runtime registers 15, a throwing
//     transform produces warnings instead of an exception, and one refused
//     skill does not cost the other fourteen.
//
// The rendering section at the end pins `renderAgentMarkdown`'s V2 permission
// sequence against the coder asset: a materialised agent must carry the same
// rules, never the runtime default `allow *`.
import { afterEach, describe, expect, it } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import {
  loadSkillAssets,
  parseSkillFrontmatter,
  registerSkills,
  type SkillAsset,
  type SkillEditor,
  type SkillRegistrationContext,
} from '../../src/register/skills'
import {
  parseAgentMarkdown,
  type PermissionRule,
} from '../../src/register/agents'
import {
  renderAgentMarkdown,
  type MaterializableAgent,
} from '../../src/runtime/compat'

const ASSETS_DIR = join(import.meta.dir, '..', '..', 'assets')
const SKILLS_DIR = join(ASSETS_DIR, 'skills')

const created: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'conductor-skills-'))
  created.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of created.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

interface StubContext {
  ctx: SkillRegistrationContext
  assets: SkillAsset[]
}

/** A runtime that accepts every skill, recording what it was given. */
function stubContext(): StubContext {
  const added: SkillAsset[] = []
  const stub: StubContext = { ctx: {}, assets: added }
  stub.ctx = {
    skill: {
      transform(callback) {
        const editor: SkillEditor = {
          add(asset) {
            added.push(asset)
          },
        }
        callback(editor)
        return { dispose() {} }
      },
    },
  }
  return stub
}

const assets = loadSkillAssets(SKILLS_DIR)

// ---------------------------------------------------------------------------
// The real asset set
// ---------------------------------------------------------------------------

describe('the real skill assets', () => {
  it('loads all 15 skills with unique ids', () => {
    expect(assets).toHaveLength(15)

    const ids = assets.map((asset) => asset.id)
    expect(new Set(ids).size).toBe(15)
    expect(ids).toEqual([...ids].sort())
    expect(ids).toContain('supervisor-orchestrate')
    expect(ids).toContain('closeout')
    expect(ids).toContain('task-contract')
  })

  it('carries a non-empty name and description for every skill', () => {
    for (const asset of assets) {
      expect(asset.name.length).toBeGreaterThan(0)
      expect(asset.description.length).toBeGreaterThan(0)
      // A quoted description must be unquoted, not passed through verbatim.
      expect(asset.description.startsWith('"')).toBe(false)
      expect(asset.description.startsWith("'")).toBe(false)
      expect(asset.description.includes(' ')).toBe(true)
    }
  })

  it('reads the frontmatter, not the file name, for name and description', () => {
    const closeout = assets.find((asset) => asset.id === 'closeout')
    expect(closeout?.name).toBe('Closeout')
    expect(closeout?.description).toBe(
      'Produce final run receipt, journal entry, and memory proposals',
    )

    const orchestrate = assets.find((asset) => asset.id === 'supervisor-orchestrate')
    expect(orchestrate?.name).toBe('supervisor-orchestrate')
    expect(orchestrate?.description).toContain('Multi-model orchestration workflow')

    // The long quoted descriptions survive intact, colon and quotes included.
    const claims = assets.find((asset) => asset.id === 'claims-audit')
    expect(claims?.description).toContain('Claims-audit ground-truth adjudication:')
    expect(claims?.description).toContain("'claims audit'")
  })

  it('gives every asset an absolute SKILL.md path that exists, and its full text', () => {
    for (const asset of assets) {
      expect(asset.path).toBe(resolve(asset.path))
      expect(existsSync(asset.path)).toBe(true)
      expect(asset.path.endsWith('/SKILL.md')).toBe(true)
      expect(asset.path).toBe(join(SKILLS_DIR, asset.id, 'SKILL.md'))
      expect(asset.content).toBe(readFileSync(asset.path, 'utf8'))
      expect(asset.content.length).toBeGreaterThan(0)
    }
  })

  it('keeps the references subtree resolvable beside the SKILL.md', () => {
    const orchestrate = assets.find((asset) => asset.id === 'supervisor-orchestrate')
    expect(orchestrate).toBeDefined()

    const reference = join(dirname(orchestrate!.path), 'references', 'generate-n-carousels.md')
    expect(existsSync(reference)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Loading rules
// ---------------------------------------------------------------------------

describe('loadSkillAssets', () => {
  it('returns an empty list for an absent assets directory', () => {
    expect(loadSkillAssets(join(tempDir(), 'missing'))).toEqual([])
  })

  it('ignores a directory without a SKILL.md', () => {
    const dir = tempDir()
    mkdirSync(join(dir, 'has-skill'), { recursive: true })
    writeFileSync(join(dir, 'has-skill', 'SKILL.md'), '---\nname: Has\ndescription: d\n---\nBody.\n')
    mkdirSync(join(dir, 'no-skill'), { recursive: true })
    writeFileSync(join(dir, 'no-skill', 'README.md'), 'not a skill\n')
    mkdirSync(join(dir, '.hidden'), { recursive: true })
    writeFileSync(join(dir, '.hidden', 'SKILL.md'), 'hidden\n')

    const loaded = loadSkillAssets(dir)
    expect(loaded.map((asset) => asset.id)).toEqual(['has-skill'])
    expect(loaded[0].content).toContain('Body.')
  })

  it('falls back to the directory id for a body-only SKILL.md', () => {
    const dir = tempDir()
    mkdirSync(join(dir, 'prompt-only'), { recursive: true })
    writeFileSync(join(dir, 'prompt-only', 'SKILL.md'), 'Just a body.\n')

    const [asset] = loadSkillAssets(dir)
    expect(asset.id).toBe('prompt-only')
    expect(asset.name).toBe('prompt-only')
    expect(asset.description).toBe('')
  })
})

describe('parseSkillFrontmatter', () => {
  it('reads a folded block scalar', () => {
    const parsed = parseSkillFrontmatter(
      '---\nname: Folded\ndescription: >\n  first line\n  second line\nmetadata:\n  audience: conductor\n---\nBody.\n',
    )
    expect(parsed).toEqual({ name: 'Folded', description: 'first line second line' })
  })

  it('reads a literal block scalar', () => {
    const parsed = parseSkillFrontmatter(
      '---\nname: Literal\ndescription: |\n  first line\n  second line\n---\nBody.\n',
    )
    expect(parsed.description).toBe('first line\nsecond line')
  })

  it('reads a quoted description that wraps across lines', () => {
    const parsed = parseSkillFrontmatter(
      '---\nname: Wrapped\ndescription: "first part\n  second part"\n---\nBody.\n',
    )
    expect(parsed).toEqual({ name: 'Wrapped', description: 'first part second part' })
  })

  it('reads a plain description continued on an indented line', () => {
    const parsed = parseSkillFrontmatter(
      '---\nname: Plain\ndescription: first part\n  second part\nmetadata:\n  audience: coder\n---\nBody.\n',
    )
    expect(parsed).toEqual({ name: 'Plain', description: 'first part second part' })
  })

  it('returns empty scalars without frontmatter or with an unterminated block', () => {
    expect(parseSkillFrontmatter('Body only.\n')).toEqual({ name: '', description: '' })
    expect(parseSkillFrontmatter('---\nname: x\nBody.\n')).toEqual({
      name: '',
      description: '',
    })
  })
})

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

describe('registerSkills', () => {
  it('registers all 15 assets with their id, path and content', async () => {
    const stub = stubContext()
    const result = await registerSkills(stub.ctx, assets)

    expect(result.warnings).toEqual([])
    expect(result.registered).toEqual(assets.map((asset) => asset.id))
    expect(stub.assets).toHaveLength(15)
    expect(stub.assets.map((asset) => asset.id)).toEqual(result.registered)

    for (const asset of stub.assets) {
      // Registered verbatim: id, name, description, path and content.
      expect(assets).toContainEqual(asset)
    }
  })

  it('turns a throwing transform into a warning, never an exception', async () => {
    const failing: SkillRegistrationContext = {
      skill: {
        transform() {
          throw new Error('runtime refused the skill transform')
        },
      },
    }

    const result = await registerSkills(failing, assets)

    expect(result.registered).toEqual([])
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('skill.transform')
    expect(result.warnings[0]).toContain('runtime refused the skill transform')
  })

  it('reports a missing transform instead of throwing', async () => {
    const result = await registerSkills(null, assets)

    expect(result.registered).toEqual([])
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('no skill.transform')
  })

  it('keeps the other skills when one add is refused', async () => {
    const added: string[] = []
    const partial: SkillRegistrationContext = {
      skill: {
        transform(callback) {
          const editor: SkillEditor = {
            add(asset) {
              if (asset.id === 'closeout') throw new Error('duplicate skill id')
              added.push(asset.id)
            },
          }
          callback(editor)
          return { dispose() {} }
        },
      },
    }

    const result = await registerSkills(partial, assets)

    expect(result.registered).toHaveLength(14)
    expect(result.registered).not.toContain('closeout')
    expect(added).toHaveLength(14)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('closeout')
    expect(result.warnings[0]).toContain('duplicate skill id')
  })
})

// ---------------------------------------------------------------------------
// V2 file rendering: permission-preserving rendering
//
// `materializeAgentFiles` is the registration path, so it must not reload with
// the runtime default `allow *`, and the frontmatter must be the V2 shape the
// runtime discovers globally. The rendering itself is in `src/runtime/compat.ts`.
// ---------------------------------------------------------------------------

describe('renderAgentMarkdown permissions', () => {
  const coderMarkdown = readFileSync(join(ASSETS_DIR, 'agents', 'coder.md'), 'utf8')
  const coder = parseAgentMarkdown('coder.md', coderMarkdown)

  /** Read the `permissions:` sequence back without a YAML dependency. */
  function parseRenderedPermissions(markdown: string): PermissionRule[] {
    const [, frontmatter = ''] = markdown.split('---')
    const rules: PermissionRule[] = []
    let current: PermissionRule | null = null
    for (const line of frontmatter.split('\n')) {
      const action = /^\s*-\s*action:\s*(\S+)\s*$/.exec(line)
      if (action) {
        current = { action: action[1], resource: '', effect: 'allow' }
        rules.push(current)
        continue
      }
      const resource = /^\s+resource:\s*(.+)$/.exec(line)
      if (resource && current) {
        const raw = resource[1].trim()
        current.resource =
          raw.length >= 2 && raw.startsWith("'") && raw.endsWith("'")
            ? raw.slice(1, -1).replace(/''/g, "'")
            : raw
        continue
      }
      const effect = /^\s+effect:\s*(\S+)\s*$/.exec(line)
      if (effect && current) current.effect = effect[1] as PermissionRule['effect']
    }
    return rules
  }

  it('renders the V2 permissions sequence with runtime action names', () => {
    const rendered = renderAgentMarkdown({
      id: coder.id,
      description: coder.description,
      mode: coder.mode,
      steps: coder.steps,
      system: coder.system,
      permissions: coder.permissions,
    })

    expect(rendered).toContain('permissions:\n')
    expect(rendered).not.toContain('\npermission:\n')
    // Resources are single-quoted; effects and actions stay bare.
    expect(rendered).toContain("    resource: '**/.env*'\n    effect: deny")
    expect(rendered).toContain("    resource: '*'\n    effect: allow")
    // The runtime's V2 action names are written as-is.
    expect(rendered).toContain('  - action: shell\n')
    expect(rendered).toContain('  - action: subagent\n')
    expect(rendered).not.toContain('action: bash')
    expect(rendered).not.toContain('action: task')
    // The block sits inside the frontmatter, before the body.
    const [, frontmatter] = rendered.split('---')
    expect(frontmatter).toContain('permissions:')
    expect(frontmatter).toContain('steps: 100')
  })

  it('writes each action allow, then ask, then deny (last matching rule wins)', () => {
    const rendered = renderAgentMarkdown({
      id: coder.id,
      description: coder.description,
      mode: coder.mode,
      model: coder.model,
      steps: coder.steps,
      system: coder.system,
      permissions: coder.permissions,
    })
    const rules = parseRenderedPermissions(rendered)

    expect(rules).toHaveLength(coder.permissions?.length ?? 0)

    const effectsByAction = new Map<string, string[]>()
    for (const rule of rules) {
      const effects = effectsByAction.get(rule.action) ?? []
      effects.push(rule.effect)
      effectsByAction.set(rule.action, effects)
    }
    const rank = (effect: string): number =>
      effect === 'allow' ? 0 : effect === 'ask' ? 1 : 2
    for (const effects of effectsByAction.values()) {
      const ranks = effects.map(rank)
      expect(ranks).toEqual([...ranks].sort((left, right) => left - right))
    }

    // The broad shell allow is written before every shell deny, so the deny is
    // the last match.
    const shell = rules.filter((rule) => rule.action === 'shell')
    expect(shell[0]).toEqual({ action: 'shell', resource: '*', effect: 'allow' })
    expect(shell[shell.length - 1].effect).toBe('deny')
    expect(shell.some((rule) => rule.resource === 'git push*' && rule.effect === 'deny')).toBe(
      true,
    )
  })

  it('keeps every rule and action when it renders', () => {
    const rendered = renderAgentMarkdown({
      id: coder.id,
      description: coder.description,
      mode: coder.mode,
      model: coder.model,
      steps: coder.steps,
      system: coder.system,
      permissions: coder.permissions,
    })
    const key = (rule: PermissionRule): string =>
      `${rule.action}|${rule.resource}|${rule.effect}`

    expect(parseRenderedPermissions(rendered).map(key).sort()).toEqual(
      [...(coder.permissions ?? [])].map(key).sort(),
    )
  })

  it('omits the block for an agent without permissions', () => {
    const plain: MaterializableAgent = {
      id: 'plain',
      description: 'plain',
      mode: 'subagent',
      system: 'Plain.',
    }
    expect(renderAgentMarkdown(plain)).not.toContain('permissions:')
  })

  it('quotes a pattern containing a single quote by doubling it', () => {
    const rendered = renderAgentMarkdown({
      id: 'quoted',
      description: 'quoted',
      permissions: [
        { action: 'read', resource: "it's", effect: 'deny' },
        { action: 'read', resource: '*', effect: 'allow' },
      ],
    })

    expect(rendered).toContain("    resource: 'it''s'")
    // Allow first, deny last: the V2 evaluator takes the last match.
    expect(parseRenderedPermissions(rendered)).toEqual([
      { action: 'read', resource: '*', effect: 'allow' },
      { action: 'read', resource: "it's", effect: 'deny' },
    ])
  })
})
