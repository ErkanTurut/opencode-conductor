// Skill materialisation: the package's `assets/skills/**` tree is mirrored into
// the runtime's global skills directory instead of being registered through
// `ctx.skill.transform`.
//
// What is pinned here:
//   1. every skill directory (15) plus the `references/` file travels — a skill
//      that references `references/...` is unusable without its sibling;
//   2. the copy is byte-for-byte identical to the asset;
//   3. the mirror is idempotent: a second run writes nothing, so a plugin load
//      never churns the watched config directory.
import { afterEach, describe, expect, it } from 'bun:test'
import * as nodeFs from 'node:fs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  materializeSkillDirs,
  type MaterializeTreeFs,
} from '../../src/runtime/compat'

const ASSETS_SKILLS = join(import.meta.dir, '..', '..', 'assets', 'skills')

/** The five `MaterializeFs` calls plus the directory listing the walk needs. */
const io: MaterializeTreeFs = {
  mkdirSync: (path, options) =>
    nodeFs.mkdirSync(path, options as nodeFs.MakeDirectoryOptions),
  writeFileSync: (path, data, options) =>
    nodeFs.writeFileSync(path, data, options as nodeFs.WriteFileOptions),
  renameSync: (from, to) => nodeFs.renameSync(from, to),
  readFileSync: (path, encoding) =>
    nodeFs.readFileSync(path, { encoding: encoding as BufferEncoding }),
  existsSync: (path) => nodeFs.existsSync(path),
  readdirSync: (path, options) =>
    nodeFs.readdirSync(path, options) as unknown as ReturnType<
      MaterializeTreeFs['readdirSync']
    >,
}

const created: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'conductor-skills-materialize-'))
  created.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('materializeSkillDirs', () => {
  it('mirrors every skill directory and its references on the first run', () => {
    const target = join(tempDir(), 'skills')
    const written = materializeSkillDirs(ASSETS_SKILLS, target, io)

    // 15 SKILL.md files plus supervisor-orchestrate's references file.
    expect(written).toHaveLength(16)
    expect(written.filter((path) => path.endsWith('/SKILL.md'))).toHaveLength(15)

    const references = join(
      target,
      'supervisor-orchestrate',
      'references',
      'generate-n-carousels.md',
    )
    expect(written).toContain(references)
    expect(nodeFs.existsSync(references)).toBe(true)

    for (const path of written) {
      expect(nodeFs.existsSync(path)).toBe(true)
      // Absolute paths: callers report them verbatim.
      expect(path.startsWith('/')).toBe(true)
    }
    expect(nodeFs.existsSync(join(target, 'closeout', 'SKILL.md'))).toBe(true)
    expect(nodeFs.existsSync(join(target, 'union-merge', 'SKILL.md'))).toBe(true)

    // Files are owner-only, like the agent files.
    expect(nodeFs.statSync(join(target, 'closeout', 'SKILL.md')).mode & 0o777).toBe(0o600)
  })

  it('copies the content byte-for-byte', () => {
    const target = join(tempDir(), 'skills')
    materializeSkillDirs(ASSETS_SKILLS, target, io)

    for (const name of ['closeout', 'supervisor-orchestrate']) {
      const source = join(ASSETS_SKILLS, name, 'SKILL.md')
      const copy = join(target, name, 'SKILL.md')
      expect(nodeFs.readFileSync(copy).equals(nodeFs.readFileSync(source))).toBe(true)
    }

    const sourceReference = join(
      ASSETS_SKILLS,
      'supervisor-orchestrate',
      'references',
      'generate-n-carousels.md',
    )
    const copiedReference = join(
      target,
      'supervisor-orchestrate',
      'references',
      'generate-n-carousels.md',
    )
    expect(
      nodeFs.readFileSync(copiedReference).equals(nodeFs.readFileSync(sourceReference)),
    ).toBe(true)
  })

  it('is idempotent: a second run writes nothing', () => {
    const target = join(tempDir(), 'skills')

    expect(materializeSkillDirs(ASSETS_SKILLS, target, io)).toHaveLength(16)
    const before = nodeFs.readFileSync(join(target, 'closeout', 'SKILL.md'), 'utf8')

    expect(materializeSkillDirs(ASSETS_SKILLS, target, io)).toEqual([])
    expect(nodeFs.readFileSync(join(target, 'closeout', 'SKILL.md'), 'utf8')).toBe(before)
  })

  it('skips a directory without SKILL.md', () => {
    const assets = tempDir()
    nodeFs.mkdirSync(join(assets, 'with-skill'), { recursive: true })
    nodeFs.writeFileSync(join(assets, 'with-skill', 'SKILL.md'), '# skill\n')
    nodeFs.mkdirSync(join(assets, 'not-a-skill'), { recursive: true })
    nodeFs.writeFileSync(join(assets, 'not-a-skill', 'README.md'), 'no manifest\n')

    const target = join(tempDir(), 'skills')
    const written = materializeSkillDirs(assets, target, io)

    expect(written).toEqual([join(target, 'with-skill', 'SKILL.md')])
    expect(nodeFs.existsSync(join(target, 'not-a-skill'))).toBe(false)
  })
})
