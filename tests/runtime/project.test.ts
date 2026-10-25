// Project identity is the central-state record: one `project.json` per
// canonical project under the conductor home. These tests pin the auto
// resolution rule, key stability, atomic/idempotent persistence, and the P1
// nested-directory rule (a plain subdirectory is its own project).
//
// Every test injects `env`. No test reads or writes the real user home: the
// `~` fallback is driven by the injected `HOME`.
import { afterAll, describe, expect, it } from 'bun:test'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  projectionKey,
  readProjectRecord,
  resolveProjectIdentity,
  writeProjectRecord,
  type ProjectRecord,
} from '../../src/runtime/project'
import { projectKeyFor } from '../../src/runtime/state-layout'

const fixtureRoot = realpathSync(
  mkdtempSync(join(tmpdir(), 'project-identity-test-')),
)

afterAll(() => {
  rmSync(fixtureRoot, { recursive: true, force: true })
})

/** Create (recursively) and realpath a fixture directory. */
function makeDir(...parts: string[]): string {
  const dir = join(fixtureRoot, ...parts)
  mkdirSync(dir, { recursive: true })
  return realpathSync(dir)
}

/** A fake repository root: `<root>/.git` is a directory. */
function makeRepo(...parts: string[]): string {
  const root = makeDir(...parts)
  mkdirSync(join(root, '.git', 'worktrees', 'wt-1'), { recursive: true })
  writeFileSync(join(root, '.git', 'worktrees', 'wt-1', 'HEAD'), 'ref: refs/heads/main\n')
  return root
}

/** Injected env: central state lives under the fixture root, never the real home. */
function envFor(name: string): Record<string, string> {
  return { OPENCODE_CONDUCTOR_HOME: join(fixtureRoot, 'homes', name) }
}

/** Recursive relative listing, used to prove a project dir is untouched. */
function walk(dir: string, prefix = ''): string[] {
  const entries: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name
    entries.push(relative)
    if (entry.isDirectory()) entries.push(...walk(join(dir, entry.name), relative))
  }
  return entries.sort()
}

describe('resolveProjectIdentity — auto mode', () => {
  it('picks local when a ledger exists and writes no record into the checkout', () => {
    const root = makeRepo('auto-local')
    mkdirSync(join(root, '.opencode'), { recursive: true })
    writeFileSync(join(root, '.opencode', 'supervisor.db'), '')
    const env = envFor('auto-local')
    const before = walk(root)

    const resolved = resolveProjectIdentity({ projectRoot: root, env })

    expect(resolved.layout.mode).toBe('local')
    expect(resolved.record.stateMode).toBe('local')
    expect(resolved.recordPath).toBe(null)
    expect(resolved.record.ledgerPath).toBe(`${root}/.opencode/supervisor.db`)
    // Local resolution is read-only: nothing new in the project, nothing in the
    // conductor home.
    expect(walk(root)).toEqual(before)
    expect(readdirSync(join(root, '.opencode')).sort()).toEqual(['supervisor.db'])
    expect(() => statSync(env.OPENCODE_CONDUCTOR_HOME)).toThrow()
  })

  it('picks central for a fresh project and writes the record outside it', () => {
    const root = makeDir('auto-central')
    const env = envFor('auto-central')
    const before = walk(root)

    const resolved = resolveProjectIdentity({ projectRoot: root, env })
    const expectedDir = `${env.OPENCODE_CONDUCTOR_HOME}/projects/${projectKeyFor(root)}`

    expect(resolved.layout.mode).toBe('central')
    expect(resolved.recordPath).toBe(`${expectedDir}/project.json`)
    expect(resolved.record.stateMode).toBe('central')
    expect(resolved.record.projectKey).toBe(projectKeyFor(root))
    expect(resolved.record.stateRoot).toBe(env.OPENCODE_CONDUCTOR_HOME)
    expect(resolved.record.ledgerPath).toBe(`${expectedDir}/supervisor.db`)
    expect(resolved.record.runsDir).toBe(`${expectedDir}/runs`)
    expect(resolved.record.memoryDir).toBe(`${expectedDir}/memory/project`)
    expect(resolved.record.branch).toEqual({ main: 'main', dev: 'develop' })
    expect(resolved.record.verify).toBe(null)
    expect(resolved.record.trust).toEqual({ grantedAt: null })
    expect(resolved.record.createdAt).toBe(resolved.record.lastUsedAt)

    // The record is on disk exactly as returned...
    expect(readProjectRecord(resolved.recordPath!)).toEqual(resolved.record)
    // ...and central resolution wrote nothing into the project directory.
    expect(walk(root)).toEqual(before)
  })

  it('picks local when only a non-empty runs directory exists', () => {
    const root = makeDir('auto-runs')
    mkdirSync(join(root, '.opencode', 'runs', 'run-1', 'artifacts'), {
      recursive: true,
    })
    const env = envFor('auto-runs')
    const before = walk(root)

    const resolved = resolveProjectIdentity({ projectRoot: root, env })

    expect(resolved.layout.mode).toBe('local')
    expect(resolved.recordPath).toBe(null)
    expect(resolved.record.runsDir).toBe(`${root}/.opencode/runs`)
    expect(walk(root)).toEqual(before)
    expect(() => statSync(env.OPENCODE_CONDUCTOR_HOME)).toThrow()
  })
})

describe('resolveProjectIdentity — explicit mode overrides', () => {
  it('forces central even when the project already owns a ledger', () => {
    const root = makeRepo('override-central')
    mkdirSync(join(root, '.opencode'), { recursive: true })
    writeFileSync(join(root, '.opencode', 'supervisor.db'), '')
    const env = envFor('override-central')

    const resolved = resolveProjectIdentity({
      projectRoot: root,
      mode: 'central',
      env,
    })

    expect(resolved.layout.mode).toBe('central')
    expect(resolved.recordPath).toBe(
      `${env.OPENCODE_CONDUCTOR_HOME}/projects/${projectKeyFor(root)}/project.json`,
    )
    expect(resolved.record.stateMode).toBe('central')
  })

  it('forces local for a fresh project and writes nothing', () => {
    const root = makeDir('override-local')
    const env = envFor('override-local')
    const before = walk(root)

    const resolved = resolveProjectIdentity({
      projectRoot: root,
      mode: 'local',
      env,
    })

    expect(resolved.layout.mode).toBe('local')
    expect(resolved.recordPath).toBe(null)
    expect(walk(root)).toEqual(before)
    expect(() => statSync(env.OPENCODE_CONDUCTOR_HOME)).toThrow()
  })
})

describe('resolveProjectIdentity — central root precedence', () => {
  it('records OPENCODE_CONDUCTOR_HOME ahead of XDG_DATA_HOME', () => {
    const root = makeDir('precedence-home')
    const home = join(fixtureRoot, 'homes', 'precedence-home-var')
    const resolved = resolveProjectIdentity({
      projectRoot: root,
      mode: 'central',
      env: {
        OPENCODE_CONDUCTOR_HOME: home,
        XDG_DATA_HOME: join(fixtureRoot, 'homes', 'precedence-xdg'),
      },
    })
    expect(resolved.record.stateRoot).toBe(home)
    expect(resolved.recordPath!.startsWith(home)).toBe(true)
  })

  it('records $XDG_DATA_HOME/opencode-conductor when the env override is absent', () => {
    const root = makeDir('precedence-xdg')
    const xdg = join(fixtureRoot, 'homes', 'precedence-xdg-data')
    const resolved = resolveProjectIdentity({
      projectRoot: root,
      mode: 'central',
      env: { XDG_DATA_HOME: xdg },
    })
    expect(resolved.record.stateRoot).toBe(`${xdg}/opencode-conductor`)
  })

  it('records ~/.local/share/opencode-conductor from the injected HOME', () => {
    const root = makeDir('precedence-home-dir')
    const fakeHome = join(fixtureRoot, 'homes', 'precedence-fake-home')
    const resolved = resolveProjectIdentity({
      projectRoot: root,
      mode: 'central',
      env: { HOME: fakeHome },
    })
    expect(resolved.record.stateRoot).toBe(
      `${fakeHome}/.local/share/opencode-conductor`,
    )
    expect(resolved.recordPath!.startsWith(fakeHome)).toBe(true)
  })
})

describe('resolveProjectIdentity — nested directories are their own project', () => {
  it('gives /repo/scratch its own key and ledger, not /repo', () => {
    const repo = makeRepo('nested-repo')
    const scratch = makeDir('nested-repo', 'scratch')
    const env = envFor('nested-repo')

    const repoResolved = resolveProjectIdentity({ projectRoot: repo, env })
    const scratchResolved = resolveProjectIdentity({ projectRoot: scratch, env })

    expect(scratchResolved.record.canonicalPath).toBe(scratch)
    expect(scratchResolved.record.projectKey).toBe(projectKeyFor(scratch))
    expect(scratchResolved.record.projectKey).not.toBe(
      repoResolved.record.projectKey,
    )
    expect(scratchResolved.record.ledgerPath).toBe(
      `${env.OPENCODE_CONDUCTOR_HOME}/projects/${projectKeyFor(scratch)}/supervisor.db`,
    )
    expect(scratchResolved.record.ledgerPath).not.toBe(
      repoResolved.record.ledgerPath,
    )

    // Local mode agrees: the scratch ledger can never be the repo ledger.
    const scratchLocal = resolveProjectIdentity({
      projectRoot: scratch,
      mode: 'local',
      env,
    })
    expect(scratchLocal.record.ledgerPath).toBe(
      `${scratch}/.opencode/supervisor.db`,
    )
    expect(scratchLocal.record.ledgerPath).not.toBe(
      `${repo}/.opencode/supervisor.db`,
    )
  })
})

describe('projectKey — stability and slug edge cases', () => {
  it('is stable across resolutions and slugifies the basename', () => {
    const root = makeDir('keys', 'My Repo !! 2')
    const env = envFor('keys')

    const first = resolveProjectIdentity({ projectRoot: root, env })
    const second = resolveProjectIdentity({ projectRoot: root, env })

    expect(first.record.projectKey).toBe(second.record.projectKey)
    expect(first.record.projectKey).toBe(projectKeyFor(root))
    expect(first.record.projectKey).toMatch(/^my-repo-2-[0-9a-f]{8}$/)
    expect(second.recordPath).toBe(first.recordPath)
    expect(second.record.createdAt).toBe(first.record.createdAt)
  })

  it('falls back to "project" for a basename with no alphanumerics', () => {
    const root = makeDir('keys', '---')
    const resolved = resolveProjectIdentity({
      projectRoot: root,
      mode: 'central',
      env: envFor('keys-fallback'),
    })
    expect(resolved.record.projectKey).toMatch(/^project-[0-9a-f]{8}$/)
  })

  it('clips long slugs to 40 characters and keeps the hash', () => {
    const root = makeDir('keys', 'B'.repeat(60))
    const key = projectKeyFor(root)
    expect(key).toBe(`${'b'.repeat(40)}-${key.slice(-8)}`)
  })
})

describe('project records — round-trip and atomic writes', () => {
  it('round-trips every field, including optional ones', () => {
    const root = makeRepo('records', 'roundtrip')
    const env = envFor('records')
    const { record, recordPath } = resolveProjectIdentity({
      projectRoot: root,
      projectId: 'ses_project_1',
      mode: 'central',
      env,
    })

    expect(record.opencodeProjectId).toBe('ses_project_1')
    expect(readProjectRecord(recordPath!)).toEqual(record)

    const explicit: ProjectRecord = {
      ...record,
      verify: {
        commands: ['bun test', 'bun run typecheck'],
        detectedFrom: ['package.json#scripts.test'],
        hash: 'abcdef0123456789',
      },
      trust: { grantedAt: '2026-01-02T03:04:05.000Z' },
    }
    writeProjectRecord(recordPath!, explicit)
    expect(readProjectRecord(recordPath!)).toEqual(explicit)

    // Atomic writer leaves no temp files behind.
    expect(
      readdirSync(dirname(recordPath!)).filter((name) => name.endsWith('.tmp')),
    ).toEqual([])
  })

  it('creates parent directories on write', () => {
    const target = join(fixtureRoot, 'records', 'deep', 'nested', 'project.json')
    const record = resolveProjectIdentity({
      projectRoot: makeDir('records', 'writer'),
      mode: 'central',
      env: envFor('records-writer'),
    }).record

    writeProjectRecord(target, record)
    expect(readProjectRecord(target)).toEqual(record)
  })

  it('returns null for a missing, malformed, or wrongly-shaped record', () => {
    expect(readProjectRecord(join(fixtureRoot, 'absent', 'project.json'))).toBe(
      null,
    )

    const malformed = join(fixtureRoot, 'records', 'malformed.json')
    writeFileSync(malformed, '{not json')
    expect(readProjectRecord(malformed)).toBe(null)

    const wrongShape = join(fixtureRoot, 'records', 'wrong-shape.json')
    writeFileSync(wrongShape, JSON.stringify({ id: 'only-an-id' }))
    expect(readProjectRecord(wrongShape)).toBe(null)
  })

  it('preserves an existing opencodeProjectId when a later resolve omits it', () => {
    const root = makeDir('records', 'preserve-id')
    const env = envFor('records-preserve')
    const first = resolveProjectIdentity({
      projectRoot: root,
      projectId: 'ses_project_2',
      mode: 'central',
      env,
    })
    expect(first.record.opencodeProjectId).toBe('ses_project_2')

    const second = resolveProjectIdentity({ projectRoot: root, mode: 'central', env })
    expect(second.record.opencodeProjectId).toBe('ses_project_2')
  })
})

describe('resolveProjectIdentity — idempotency', () => {
  it('does not rewrite an unchanged record and preserves hand-set fields', () => {
    const root = makeDir('idempotent')
    const env = envFor('idempotent')
    const first = resolveProjectIdentity({ projectRoot: root, env })
    const recordPath = first.recordPath!

    // A trust grant written by another task must survive a re-resolve: if the
    // resolver rewrote unconditionally, this would be clobbered (the resolver
    // never grants trust itself).
    const marked: ProjectRecord = {
      ...first.record,
      trust: { grantedAt: '2026-01-02T03:04:05.000Z' },
    }
    writeProjectRecord(recordPath, marked)

    const second = resolveProjectIdentity({ projectRoot: root, env })
    expect(second.record.trust).toEqual({ grantedAt: '2026-01-02T03:04:05.000Z' })
    expect(second.record.createdAt).toBe(first.record.createdAt)
    expect(second.record.lastUsedAt).toBe(first.record.lastUsedAt)
    expect(second.recordPath).toBe(first.recordPath)

    const bytesBefore = readFileSync(recordPath, 'utf8')
    const mtimeBefore = statSync(recordPath).mtimeMs
    const third = resolveProjectIdentity({ projectRoot: root, env })

    expect(third.record.projectKey).toBe(first.record.projectKey)
    expect(readFileSync(recordPath, 'utf8')).toBe(bytesBefore)
    expect(statSync(recordPath).mtimeMs).toBe(mtimeBefore)
  })
})

describe('projectionKey', () => {
  it('namespaces a project key under p/<projectKey>/', () => {
    expect(projectionKey('my-proj-abc12345', 'runs/run-1')).toBe(
      'p/my-proj-abc12345/runs/run-1',
    )
    expect(projectionKey('k-00000000', 'board')).toBe('p/k-00000000/board')
  })
})
