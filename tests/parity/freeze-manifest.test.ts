/**
 * Tests for the freeze gate itself.
 *
 * The gate is the only thing standing between "the old tree is untouched" and
 * a silent edit, so its failure modes need the same scrutiny as the port:
 * deterministic hashing, stable ordering, deliberate exclusions, and a
 * drift report that names the offending path.
 *
 * All fixtures live in a temp directory; the real `tools/opencode-supervisor`
 * is never written to by this file.
 */
import { afterAll, describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  FROZEN_ROOT_REL,
  MANIFEST_ENV_VAR,
  ROOT_ENV_VAR,
  buildManifest,
  checkTree,
  computeTreeHash,
  diffManifests,
  formatDiff,
  hashTree,
  parseManifest,
  readManifest,
  runCli,
  walkTree,
  type CliIo,
} from '../../scripts/freeze/manifest'

const scratchRoot = realpathSync(mkdtempSync(join(tmpdir(), 'freeze-manifest-test-')))

afterAll(() => {
  rmSync(scratchRoot, { recursive: true, force: true })
})

/** Content chosen so every exclusion rule has a representative victim. */
const FIXTURE_FILES: Record<string, string> = {
  'README.md': '# fixture tree\n',
  'src/a.ts': 'export const a = 1\n',
  'src/nested/b.ts': 'export const b = 2\n',
  'bun.lock': '{ "lockfileVersion": 1 }\n',
  'node_modules/dep/index.js': 'module.exports = {}\n',
  'dist/bundle.js': 'bundled\n',
  'src/node_modules/inner/index.js': 'nested dependency\n',
  'src/dist/inner.js': 'nested build output\n',
}

let fixtureCounter = 0

function makeFixture(): string {
  fixtureCounter += 1
  const root = join(scratchRoot, `tree-${fixtureCounter}`)
  for (const [relPath, content] of Object.entries(FIXTURE_FILES)) {
    const absolute = join(root, relPath)
    mkdirSync(dirname(absolute), { recursive: true })
    writeFileSync(absolute, content)
  }
  return root
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

interface Capture extends CliIo {
  outLines: string[]
  errLines: string[]
}

function capture(): Capture {
  const outLines: string[] = []
  const errLines: string[] = []
  return {
    outLines,
    errLines,
    out: (line) => outLines.push(line),
    err: (line) => errLines.push(line),
  }
}

describe('walkTree', () => {
  it('lists regular files sorted by relative posix path', () => {
    const root = makeFixture()
    expect(walkTree(root)).toEqual(['README.md', 'src/a.ts', 'src/nested/b.ts'])
  })

  it('skips node_modules and dist at any depth, and bun.lock', () => {
    const root = makeFixture()
    const tracked = walkTree(root)
    for (const excluded of [
      'bun.lock',
      'node_modules/dep/index.js',
      'dist/bundle.js',
      'src/node_modules/inner/index.js',
      'src/dist/inner.js',
    ]) {
      expect(tracked).not.toContain(excluded)
    }
  })
})

describe('hashing', () => {
  it('hashes file contents and derives treeHash from the sorted path:hash lines', () => {
    const root = makeFixture()
    const files = hashTree(root)
    expect(files['README.md']).toBe(sha256(FIXTURE_FILES['README.md']))
    expect(files['src/a.ts']).toBe(sha256(FIXTURE_FILES['src/a.ts']))

    const independent = sha256(
      Object.keys(files)
        .sort()
        .map((path) => `${path}:${files[path]}`)
        .join('\n'),
    )
    expect(computeTreeHash(files)).toBe(independent)
  })

  it('is insertion-order independent and changes when content changes', () => {
    const root = makeFixture()
    const files = hashTree(root)
    const shuffled: Record<string, string> = {}
    for (const path of Object.keys(files).reverse()) shuffled[path] = files[path]
    expect(computeTreeHash(shuffled)).toBe(computeTreeHash(files))

    writeFileSync(join(root, 'src/a.ts'), 'export const a = 999\n')
    expect(computeTreeHash(hashTree(root))).not.toBe(computeTreeHash(files))
  })
})

describe('buildManifest', () => {
  it('records the documented relative root, an ISO timestamp, and no absolute paths', () => {
    const root = makeFixture()
    const manifest = buildManifest(root)
    expect(manifest.root).toBe(FROZEN_ROOT_REL)
    expect(manifest.generatedAt).toBe(new Date(manifest.generatedAt).toISOString())
    expect(Object.keys(manifest.files)).toEqual(['README.md', 'src/a.ts', 'src/nested/b.ts'])
    expect(manifest.treeHash).toBe(computeTreeHash(manifest.files))
    expect(JSON.stringify(manifest)).not.toContain(scratchRoot)
  })
})

describe('diffManifests', () => {
  it('separates added, removed, and changed paths, sorted', () => {
    const expected = { 'a.ts': '1'.repeat(64), 'b.ts': '2'.repeat(64), 'c.ts': '3'.repeat(64) }
    const actual = { 'a.ts': '1'.repeat(64), 'b.ts': '9'.repeat(64), 'd.ts': '4'.repeat(64) }
    const diff = diffManifests(expected, actual)
    expect(diff.added).toEqual(['d.ts'])
    expect(diff.removed).toEqual(['c.ts'])
    expect(diff.changed).toEqual(['b.ts'])
    expect(formatDiff(diff)).toEqual(['  + d.ts', '  - c.ts', '  ~ b.ts'])
  })

  it('reports nothing for identical trees', () => {
    const files = hashTree(makeFixture())
    expect(diffManifests(files, hashTree(makeFixture()))).toEqual({
      added: [],
      removed: [],
      changed: [],
    })
  })
})

describe('manifest validation', () => {
  const base = (): Record<string, unknown> => {
    const files = hashTree(makeFixture())
    return { generatedAt: new Date().toISOString(), root: FROZEN_ROOT_REL, files, treeHash: computeTreeHash(files) }
  }

  it('accepts a well-formed manifest and rejects an inconsistent treeHash', () => {
    expect(parseManifest(base()).treeHash).toBe(computeTreeHash(hashTree(makeFixture())))

    const tampered = base()
    tampered.treeHash = 'f'.repeat(64)
    expect(() => parseManifest(tampered)).toThrow(/does not match its file map/)
  })

  it('rejects absolute or traversal paths, non-sha256 hashes, and absolute roots', () => {
    const absolutePath = base()
    ;(absolutePath.files as Record<string, string>)['/etc/passwd'] = 'a'.repeat(64)
    expect(() => parseManifest(absolutePath)).toThrow(/plain relative path/)

    const traversal = base()
    ;(traversal.files as Record<string, string>)['../escape.ts'] = 'a'.repeat(64)
    expect(() => parseManifest(traversal)).toThrow(/plain relative path/)

    const badHash = base()
    ;(badHash.files as Record<string, string>)['src/a.ts'] = 'not-a-hash'
    expect(() => parseManifest(badHash)).toThrow(/not a sha256/)

    const absoluteRoot = { ...base(), root: join(scratchRoot, 'tree-1') }
    expect(() => parseManifest(absoluteRoot)).toThrow(/root must be a relative path/)
  })
})

describe('CLI', () => {
  it('writes a manifest on --update, keeps it stable on re-update, and reports FREEZE_OK', () => {
    const root = makeFixture()
    const manifestPath = join(scratchRoot, 'cli', 'supervisor-freeze.json')

    const first = capture()
    expect(runCli(['--update', '--root', root, '--manifest', manifestPath], first)).toBe(0)
    expect(first.errLines).toEqual([])
    expect(first.outLines[0]).toContain('treeHash')

    const initialRaw = readFileSync(manifestPath, 'utf8')
    const manifest = readManifest(manifestPath)
    expect(manifest.root).toBe(FROZEN_ROOT_REL)
    expect(Object.keys(manifest.files)).toEqual(['README.md', 'src/a.ts', 'src/nested/b.ts'])

    // A second --update with no tree change must be byte-identical (no churn),
    // including generatedAt.
    const second = capture()
    expect(runCli(['--update', '--root', root, '--manifest', manifestPath], second)).toBe(0)
    expect(readFileSync(manifestPath, 'utf8')).toBe(initialRaw)

    const check = capture()
    expect(runCli(['--root', root, '--manifest', manifestPath], check)).toBe(0)
    expect(check.outLines).toEqual([`FREEZE_OK ${manifest.treeHash}`])

    const checked = checkTree(manifest, root)
    expect(checked.ok).toBe(true)
    expect(checked.actualTreeHash).toBe(manifest.treeHash)
  })

  it('detects changed, added, and removed files with a named per-file diff', () => {
    const root = makeFixture()
    const manifestPath = join(scratchRoot, 'drift', 'supervisor-freeze.json')
    expect(runCli(['--update', '--root', root, '--manifest', manifestPath], capture())).toBe(0)
    const pristine = readManifest(manifestPath).treeHash

    writeFileSync(join(root, 'src/a.ts'), 'export const a = "changed"\n')
    const changed = capture()
    expect(runCli(['--root', root, '--manifest', manifestPath], changed)).toBe(1)
    expect(changed.outLines[0]).toBe('FREEZE_DRIFT')
    expect(changed.outLines).toContain('  ~ src/a.ts')
    expect(changed.outLines.join('\n')).toContain(`expected ${pristine}`)

    writeFileSync(join(root, 'src/new.ts'), 'export const fresh = true\n')
    const added = capture()
    expect(runCli(['--root', root, '--manifest', manifestPath], added)).toBe(1)
    expect(added.outLines).toContain('  ~ src/a.ts')
    expect(added.outLines).toContain('  + src/new.ts')

    rmSync(join(root, 'src/nested/b.ts'))
    const removed = capture()
    expect(runCli(['--root', root, '--manifest', manifestPath], removed)).toBe(1)
    expect(removed.outLines).toContain('  ~ src/a.ts')
    expect(removed.outLines).toContain('  + src/new.ts')
    expect(removed.outLines).toContain('  - src/nested/b.ts')

    // Restore the tree: the same manifest must pass again.
    writeFileSync(join(root, 'src/a.ts'), FIXTURE_FILES['src/a.ts'])
    rmSync(join(root, 'src/new.ts'))
    writeFileSync(join(root, 'src/nested/b.ts'), FIXTURE_FILES['src/nested/b.ts'])
    const restored = capture()
    expect(runCli(['--root', root, '--manifest', manifestPath], restored)).toBe(0)
    expect(restored.outLines).toEqual([`FREEZE_OK ${pristine}`])
  })

  it('re-freezes deliberately with --update after drift', () => {
    const root = makeFixture()
    const manifestPath = join(scratchRoot, 'refreeze', 'supervisor-freeze.json')
    expect(runCli(['--update', '--root', root, '--manifest', manifestPath], capture())).toBe(0)
    const before = readManifest(manifestPath).treeHash

    writeFileSync(join(root, 'src/a.ts'), 'export const a = "v2"\n')
    expect(runCli(['--root', root, '--manifest', manifestPath], capture())).toBe(1)
    expect(runCli(['--update', '--root', root, '--manifest', manifestPath], capture())).toBe(0)

    const after = readManifest(manifestPath)
    expect(after.treeHash).not.toBe(before)
    const check = capture()
    expect(runCli(['--root', root, '--manifest', manifestPath], check)).toBe(0)
    expect(check.outLines).toEqual([`FREEZE_OK ${after.treeHash}`])
  })

  it('honours SUPERVISOR_FREEZE_ROOT / SUPERVISOR_FREEZE_MANIFEST', () => {
    const root = makeFixture()
    const manifestPath = join(scratchRoot, 'env', 'supervisor-freeze.json')
    const previousRoot = process.env[ROOT_ENV_VAR]
    const previousManifest = process.env[MANIFEST_ENV_VAR]
    try {
      process.env[ROOT_ENV_VAR] = root
      process.env[MANIFEST_ENV_VAR] = manifestPath
      expect(runCli(['--update'], capture())).toBe(0)
      const check = capture()
      expect(runCli([], check)).toBe(0)
      expect(check.outLines[0].startsWith('FREEZE_OK ')).toBe(true)
    } finally {
      if (previousRoot === undefined) delete process.env[ROOT_ENV_VAR]
      else process.env[ROOT_ENV_VAR] = previousRoot
      if (previousManifest === undefined) delete process.env[MANIFEST_ENV_VAR]
      else process.env[MANIFEST_ENV_VAR] = previousManifest
    }
  })

  it('exits 2 for a missing tree, missing manifest, corrupt manifest, and bad usage', () => {
    const root = makeFixture()
    const missingRoot = capture()
    expect(runCli(['--root', join(scratchRoot, 'does-not-exist')], missingRoot)).toBe(2)
    expect(missingRoot.errLines.join('\n')).toContain('frozen tree not found')

    const missingManifest = capture()
    expect(
      runCli(['--root', root, '--manifest', join(scratchRoot, 'absent', 'manifest.json')], missingManifest),
    ).toBe(2)
    expect(missingManifest.errLines.join('\n')).toContain('manifest missing')

    const corruptPath = join(scratchRoot, 'corrupt', 'manifest.json')
    mkdirSync(dirname(corruptPath), { recursive: true })
    writeFileSync(corruptPath, '{"generatedAt":"x","root":"tools/opencode-supervisor","files":{},"treeHash":"deadbeef"}\n')
    const corrupt = capture()
    expect(runCli(['--root', root, '--manifest', corruptPath], corrupt)).toBe(2)
    expect(corrupt.errLines.join('\n')).toContain('treeHash must be a sha256')

    const unknown = capture()
    expect(runCli(['--bogus'], unknown)).toBe(2)
    expect(unknown.errLines.join('\n')).toContain('unknown argument: --bogus')

    const danglingFlag = capture()
    expect(runCli(['--root'], danglingFlag)).toBe(2)
    expect(danglingFlag.errLines.join('\n')).toContain('--root requires a value')
  })

  it('prints usage on --help without touching disk', () => {
    const help = capture()
    expect(runCli(['--help'], help)).toBe(0)
    expect(help.outLines.join('\n')).toContain('usage: bun tools/opencode-conductor/scripts/freeze/manifest.ts')
  })
})
