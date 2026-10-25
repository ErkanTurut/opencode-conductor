// StateLayout is the single path authority. These tests pin the LOCAL strings
// exactly as they were before P0 (a byte-identical move, not a redesign), and
// pin the P1 rules: project identity stops at a plain directory (no
// enclosing-repo walk-up) and central mode roots state under a conductor home.
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'bun:test'
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import {
  artifactPathsFor,
  canonicalLedgerKey,
  detectStateMode,
  localStatePaths,
  projectKeyFor,
  resolveStateLayout,
} from '../../src/runtime/state-layout'
import {
  getArtifactPaths,
  getArtifactPathsForLayout,
} from '../../src/artifacts'
import { createPolicySnapshot, resolveSupervisorConfig } from '../../src/plugin'
import { SqliteLedger } from '../../src/ledger/sqlite'

const fixtureRoot = realpathSync(
  mkdtempSync(join(tmpdir(), 'state-layout-test-')),
)

afterAll(() => {
  rmSync(fixtureRoot, { recursive: true, force: true })
})

function makeRepo(name: string): string {
  const root = join(fixtureRoot, name)
  mkdirSync(join(root, '.git', 'worktrees', 'wt-1'), { recursive: true })
  mkdirSync(join(root, 'sub', 'deep'), { recursive: true })
  writeFileSync(
    join(root, '.git', 'worktrees', 'wt-1', 'HEAD'),
    'ref: refs/heads/main\n',
  )
  return realpathSync(root)
}

function makeLinkedWorktree(mainRoot: string, name: string): string {
  const linked = join(fixtureRoot, name)
  mkdirSync(linked, { recursive: true })
  writeFileSync(
    join(linked, '.git'),
    `gitdir: ${mainRoot}/.git/worktrees/wt-1\n`,
  )
  return realpathSync(linked)
}

async function seedRun(dbPath: string, runId: string): Promise<void> {
  mkdirSync(dirname(dbPath), { recursive: true })
  const ledger = new SqliteLedger(dbPath)
  try {
    await ledger.createRun({
      id: runId,
      parentId: null,
      repoId: '/repo',
      requestHash: 'h',
      dataClass: 'internal',
      policyProfile: 'assisted',
      operationMode: 'assisted',
      riskClass: 'low',
      requestText: 'state-layout test',
      budgetJson: '{}',
      deadlineAt: null,
    })
  } finally {
    ledger.close()
  }
}

describe('resolveStateLayout — local mode is exactly today’s layout', () => {
  it('matches the historical strings for a git repo root', () => {
    const root = makeRepo('repo')
    const layout = resolveStateLayout({ projectRoot: root })

    expect(layout.mode).toBe('local')
    expect(layout.projectRoot).toBe(root)
    expect(layout.ledgerKey).toBe(canonicalLedgerKey(root))
    expect(layout.ledgerKey).toBe(root)
    expect(layout.ledgerPath).toBe(`${root}/.opencode/supervisor.db`)
    expect(layout.runsDir).toBe(`${root}/.opencode/runs`)
    expect(layout.memoryDir).toBe(`${root}/.opencode/memory`)
    expect(layout.worktreesRoot).toBe(`${root}/.worktrees`)

    // The exported helper is the local branch itself.
    expect(localStatePaths(root)).toEqual(layout)
  })

  it('canonicalises a linked worktree to the main root for the ledger only', () => {
    const main = makeRepo('linked-main')
    const linked = makeLinkedWorktree(main, 'linked-wt')

    const layout = resolveStateLayout({ projectRoot: linked })

    // One ledger per REPOSITORY: the worktree shares the main ledger.
    expect(layout.ledgerKey).toBe(main)
    expect(layout.ledgerPath).toBe(`${main}/.opencode/supervisor.db`)

    // Unchanged pre-P0 asymmetry: run/memory/worktree dirs stay rooted at the
    // caller's project root, so existing worktree run dirs do not move.
    expect(layout.projectRoot).toBe(linked)
    expect(layout.runsDir).toBe(`${linked}/.opencode/runs`)
    expect(layout.memoryDir).toBe(`${linked}/.opencode/memory`)
    expect(layout.worktreesRoot).toBe(`${linked}/.worktrees`)
  })

  it('falls back to the realpath for a directory outside any repository', () => {
    const plain = join(fixtureRoot, 'plain')
    mkdirSync(plain, { recursive: true })
    const real = realpathSync(plain)

    const layout = resolveStateLayout({ projectRoot: plain })

    expect(layout.ledgerKey).toBe(real)
    expect(layout.ledgerPath).toBe(`${real}/.opencode/supervisor.db`)
  })

  it('gives a plain nested directory its own project, not the enclosing repo', () => {
    // P1 rule: only a linked worktree (`.git` file) or a repo root (`.git`
    // directory) collapses. A plain subdirectory is its own project even though
    // an ancestor is a repository, so `/repo/scratch` no longer inherits
    // `/repo`'s ledger.
    const root = makeRepo('nested-repo')
    const nested = join(root, 'sub', 'deep')

    const layout = resolveStateLayout({ projectRoot: nested })

    expect(layout.ledgerKey).toBe(nested)
    expect(layout.ledgerPath).toBe(`${nested}/.opencode/supervisor.db`)
    expect(layout.projectRoot).toBe(nested)
    expect(layout.runsDir).toBe(`${nested}/.opencode/runs`)

    // And the central identity is distinct from the enclosing repo's.
    const env = { OPENCODE_CONDUCTOR_HOME: join(fixtureRoot, 'nested-home') }
    const repoLayout = resolveStateLayout({ projectRoot: root, mode: 'central', env })
    const nestedLayout = resolveStateLayout({ projectRoot: nested, mode: 'central', env })
    expect(nestedLayout.projectKey).not.toBe(repoLayout.projectKey)
    expect(nestedLayout.ledgerPath).not.toBe(repoLayout.ledgerPath)
  })
})

describe('resolveStateLayout — central mode layout', () => {
  const env = { OPENCODE_CONDUCTOR_HOME: join(fixtureRoot, 'central-home') }

  function makePlainDir(name: string): string {
    const dir = join(fixtureRoot, name)
    mkdirSync(dir, { recursive: true })
    return realpathSync(dir)
  }

  it('derives every per-project path from the project key, writing nothing', () => {
    const project = makePlainDir('central-project')
    const before = readdirSync(project).slice().sort()

    const layout = resolveStateLayout({ projectRoot: project, mode: 'central', env })
    const key = projectKeyFor(project)

    expect(layout.mode).toBe('central')
    expect(layout.projectKey).toBe(key)
    expect(layout.stateRoot).toBe(env.OPENCODE_CONDUCTOR_HOME)
    expect(layout.projectDir).toBe(`${env.OPENCODE_CONDUCTOR_HOME}/projects/${key}`)
    expect(layout.projectRecordPath).toBe(
      `${env.OPENCODE_CONDUCTOR_HOME}/projects/${key}/project.json`,
    )
    expect(layout.ledgerPath).toBe(`${env.OPENCODE_CONDUCTOR_HOME}/projects/${key}/supervisor.db`)
    expect(layout.runsDir).toBe(`${env.OPENCODE_CONDUCTOR_HOME}/projects/${key}/runs`)
    expect(layout.memoryDir).toBe(
      `${env.OPENCODE_CONDUCTOR_HOME}/projects/${key}/memory/project`,
    )
    expect(layout.ledgerKey).toBe(canonicalLedgerKey(project))
    // Worktrees belong to the checkout, not the state store.
    expect(layout.worktreesRoot).toBe(`${project}/.worktrees`)

    // Resolution is pure: it does not create the project directory.
    expect(readdirSync(layout.projectRoot).slice().sort()).toEqual(before)
  })

  it('prefers OPENCODE_CONDUCTOR_HOME over XDG_DATA_HOME', () => {
    const layout = resolveStateLayout({
      projectRoot: '/repo',
      mode: 'central',
      env: {
        OPENCODE_CONDUCTOR_HOME: '/srv/conductor',
        XDG_DATA_HOME: '/xdg/data',
        HOME: '/home/test',
      },
    })
    expect(layout.stateRoot).toBe('/srv/conductor')
  })

  it('falls back to $XDG_DATA_HOME/opencode-conductor', () => {
    const layout = resolveStateLayout({
      projectRoot: '/repo',
      mode: 'central',
      env: { XDG_DATA_HOME: '/xdg/data', HOME: '/home/test' },
    })
    expect(layout.stateRoot).toBe('/xdg/data/opencode-conductor')
  })

  it('falls back to ~/.local/share/opencode-conductor from the injected HOME', () => {
    const layout = resolveStateLayout({
      projectRoot: '/repo',
      mode: 'central',
      env: { HOME: '/home/test' },
    })
    expect(layout.stateRoot).toBe('/home/test/.local/share/opencode-conductor')
  })

  it('lets an explicit stateRoot override the env', () => {
    const layout = resolveStateLayout({
      projectRoot: '/repo',
      mode: 'central',
      stateRoot: '/explicit/state',
      env: { OPENCODE_CONDUCTOR_HOME: '/srv/conductor' },
    })
    expect(layout.stateRoot).toBe('/explicit/state')
  })

  it('treats an empty env value as absent', () => {
    const layout = resolveStateLayout({
      projectRoot: '/repo',
      mode: 'central',
      env: { OPENCODE_CONDUCTOR_HOME: '  ', XDG_DATA_HOME: '/xdg/data' },
    })
    expect(layout.stateRoot).toBe('/xdg/data/opencode-conductor')
  })
})

describe('resolveStateLayout — auto mode detection', () => {
  const env = { OPENCODE_CONDUCTOR_HOME: join(fixtureRoot, 'auto-home') }

  function makePlainDir(name: string): string {
    const dir = join(fixtureRoot, name)
    mkdirSync(dir, { recursive: true })
    return realpathSync(dir)
  }

  it('picks local when the canonical project owns a ledger file', () => {
    const root = makeRepo('auto-local-ledger')
    mkdirSync(join(root, '.opencode'), { recursive: true })
    writeFileSync(join(root, '.opencode', 'supervisor.db'), '')

    expect(detectStateMode(root)).toBe('local')
    expect(resolveStateLayout({ projectRoot: root, mode: 'auto', env })).toEqual(
      localStatePaths(root),
    )
  })

  it('picks central for a fresh project', () => {
    const root = makePlainDir('auto-central-fresh')
    expect(detectStateMode(root)).toBe('central')
    expect(resolveStateLayout({ projectRoot: root, mode: 'auto', env }).mode).toBe(
      'central',
    )
  })

  it('picks local when only a non-empty runs directory exists', () => {
    const root = makePlainDir('auto-local-runs')
    mkdirSync(join(root, '.opencode', 'runs', 'run-1'), { recursive: true })

    expect(detectStateMode(root)).toBe('local')
    const layout = resolveStateLayout({ projectRoot: root, mode: 'auto', env })
    expect(layout.mode).toBe('local')
    expect(layout.runsDir).toBe(`${root}/.opencode/runs`)
  })

  it('stays central when the runs directory is empty', () => {
    const root = makePlainDir('auto-central-empty-runs')
    mkdirSync(join(root, '.opencode', 'runs'), { recursive: true })

    expect(detectStateMode(root)).toBe('central')
    expect(resolveStateLayout({ projectRoot: root, mode: 'auto', env }).mode).toBe(
      'central',
    )
  })

  it('lets explicit local and central override the markers', () => {
    const withLedger = makeRepo('auto-override-local')
    mkdirSync(join(withLedger, '.opencode'), { recursive: true })
    writeFileSync(join(withLedger, '.opencode', 'supervisor.db'), '')

    expect(
      resolveStateLayout({ projectRoot: withLedger, mode: 'central', env }).mode,
    ).toBe('central')

    const bare = makePlainDir('auto-override-central')
    expect(
      resolveStateLayout({ projectRoot: bare, mode: 'local', env }).mode,
    ).toBe('local')
  })

  it('detects local for a linked worktree from the main worktree ledger', () => {
    const main = makeRepo('auto-worktree-main')
    mkdirSync(join(main, '.opencode'), { recursive: true })
    writeFileSync(join(main, '.opencode', 'supervisor.db'), '')
    const linked = makeLinkedWorktree(main, 'auto-worktree-linked')

    expect(detectStateMode(linked)).toBe('local')
    expect(resolveStateLayout({ projectRoot: linked, mode: 'auto', env }).ledgerPath).toBe(
      `${main}/.opencode/supervisor.db`,
    )
  })
})

describe('projectKeyFor — stable slug-hash8 identity', () => {
  function makePlainDir(name: string): string {
    const dir = join(fixtureRoot, 'keys', name)
    mkdirSync(dir, { recursive: true })
    return realpathSync(dir)
  }

  it('is stable and shaped <slug>-<hash8>', () => {
    const dir = makePlainDir('stable')
    const first = projectKeyFor(dir)
    expect(first).toBe(projectKeyFor(dir))
    expect(first).toMatch(/^stable-[0-9a-f]{8}$/)
  })

  it('slugifies the canonical basename', () => {
    const dir = makePlainDir('My Repo !! 2')
    expect(projectKeyFor(dir)).toMatch(/^my-repo-2-[0-9a-f]{8}$/)
  })

  it('clips the slug to 40 characters without a trailing dash', () => {
    const dir = makePlainDir('A'.repeat(60))
    const key = projectKeyFor(dir)
    expect(key).toBe(`${'a'.repeat(40)}-${key.slice(-8)}`)
    expect(key).toMatch(/^[a-z0-9]{40}-[0-9a-f]{8}$/)
  })

  it('falls back to "project" when the basename has no alphanumerics', () => {
    const dir = makePlainDir('---')
    expect(projectKeyFor(dir)).toMatch(/^project-[0-9a-f]{8}$/)
  })

  it('distinguishes same-named directories by canonical path', () => {
    const left = makePlainDir('same')
    const right = makePlainDir('same-2')
    expect(basename(left)).not.toBe(basename(right))
    expect(projectKeyFor(left)).not.toBe(projectKeyFor(right))

    // Same basename, different parents: the hash is what separates them.
    const sameA = join(fixtureRoot, 'keys', 'a', 'same')
    const sameB = join(fixtureRoot, 'keys', 'b', 'same')
    mkdirSync(sameA, { recursive: true })
    mkdirSync(sameB, { recursive: true })
    const keyA = projectKeyFor(realpathSync(sameA))
    const keyB = projectKeyFor(realpathSync(sameB))
    expect(keyA.replace(/-[0-9a-f]{8}$/, '')).toBe(keyB.replace(/-[0-9a-f]{8}$/, ''))
    expect(keyA).not.toBe(keyB)
  })

  it('shares a key between a linked worktree and its main worktree', () => {
    const main = makeRepo('keys-main')
    const linked = makeLinkedWorktree(main, 'keys-linked')
    expect(projectKeyFor(linked)).toBe(projectKeyFor(main))
  })
})

describe('resolveStateLayout — mode selection is explicit', () => {
  it('accepts an explicit local mode', () => {
    expect(
      resolveStateLayout({ projectRoot: '/repo', mode: 'local' }),
    ).toEqual(localStatePaths('/repo'))
  })

  it('defaults to local for legacy callers that pass no mode', () => {
    // plugin.ts/artifacts.ts predate central state and must keep resolving the
    // historical local paths. Auto detection is opt-in via `mode: 'auto'`
    // (the project-identity resolver is the auto-facing API).
    expect(resolveStateLayout({ projectRoot: '/repo' })).toEqual(
      localStatePaths('/repo'),
    )
  })
})

describe('artifact paths — one implementation behind getArtifactPaths', () => {
  it('produces the unchanged run-artifact shape', () => {
    const root = makeRepo('artifact-repo')
    const layout = resolveStateLayout({ projectRoot: root })
    const expected = {
      runDir: `${root}/.opencode/runs/run-1`,
      artifactsDir: `${root}/.opencode/runs/run-1/artifacts`,
      discoveryDir: `${root}/.opencode/runs/run-1/artifacts/discovery`,
      researchDir: `${root}/.opencode/runs/run-1/artifacts/research`,
      reviewsDir: `${root}/.opencode/runs/run-1/artifacts/reviews`,
      checkpointsDir: `${root}/.opencode/runs/run-1/checkpoints`,
      verificationDir: `${root}/.opencode/runs/run-1/artifacts/verification`,
    }

    expect(artifactPathsFor(layout, 'run-1')).toEqual(expected)
    expect(getArtifactPaths('run-1', root)).toEqual(expected)
    expect(getArtifactPathsForLayout(layout, 'run-1')).toEqual(expected)
  })
})

describe('resolveSupervisorConfig — consumes the layout', () => {
  it('derives ledgerKey/ledgerPath from the layout', () => {
    const root = makeRepo('config-repo')
    const nested = join(root, 'sub', 'deep')

    const config = resolveSupervisorConfig({
      options: { repoRoot: nested },
      env: {},
    })

    // A plain nested directory is its own project; run artifacts stay rooted
    // there too.
    expect(config.layout).toEqual(localStatePaths(nested))
    expect(config.ledgerKey).toBe(nested)
    expect(config.ledgerPath).toBe(`${nested}/.opencode/supervisor.db`)
    // The two can never disagree.
    expect(config.layout.ledgerPath).toBe(config.ledgerPath)
    expect(config.layout.ledgerKey).toBe(config.ledgerKey)
  })

  it('lets an explicit ledgerPath option win, in both config and layout', () => {
    const root = makeRepo('config-explicit')
    const config = resolveSupervisorConfig({
      options: { repoRoot: root, ledgerPath: '/custom/supervisor.db' },
      env: {},
    })

    expect(config.ledgerPath).toBe('/custom/supervisor.db')
    expect(config.layout.ledgerPath).toBe('/custom/supervisor.db')
    // An explicit ledger path does not re-key the ledger.
    expect(config.ledgerKey).toBe(root)
    expect(config.layout.ledgerKey).toBe(root)
  })

  it('still honours a server ctx.options ledgerPath without re-keying', () => {
    const root = makeRepo('config-ctx')
    const config = resolveSupervisorConfig({
      ctxOptions: { repoRoot: root, ledgerPath: '/ctx/supervisor.db' },
      env: {},
    })

    expect(config.ledgerPath).toBe('/ctx/supervisor.db')
    expect(config.layout.ledgerPath).toBe('/ctx/supervisor.db')
    expect(config.ledgerKey).toBe(root)
  })
})

describe('latestActiveRun — reads the resolved ledger path', () => {
  const previousProfile = process.env.SUPERVISOR_POLICY_PROFILE

  beforeEach(() => {
    delete process.env.SUPERVISOR_POLICY_PROFILE
  })

  afterEach(() => {
    if (previousProfile === undefined) {
      delete process.env.SUPERVISOR_POLICY_PROFILE
    } else {
      process.env.SUPERVISOR_POLICY_PROFILE = previousProfile
    }
  })

  it('honours a custom ledgerPath instead of the repo default', async () => {
    const root = makeRepo('ledger-read')
    const customLedger = join(fixtureRoot, 'custom-state', 'supervisor.db')
    const defaultLedger = `${root}/.opencode/supervisor.db`

    await seedRun(customLedger, 'run-custom')
    await seedRun(defaultLedger, 'run-default')

    // Resolved custom path: the active run comes from the custom ledger.
    expect(createPolicySnapshot(root, customLedger).runId).toBe('run-custom')

    // No path supplied keeps the historical default (legacy callers/tests).
    expect(createPolicySnapshot(root).runId).toBe('run-default')
  })

  it('returns a null runId when the resolved ledger is absent', () => {
    const root = makeRepo('ledger-absent')
    const snapshot = createPolicySnapshot(
      root,
      `${fixtureRoot}/missing-state/supervisor.db`,
    )
    expect(snapshot.runId).toBe(null)
  })
})
