// Worktree provider lifecycle (t1): canonical id/branch naming plus the
// create -> status -> remove path, including the dirty-worktree rescue that
// quarantines uncommitted changes instead of refusing the cleanup.
//
// Isolation: every fixture builds its own git repo and worktrees root inside a
// temp directory. The repository's real `.worktrees/` is never touched — the
// fixture asserts the provider only ever sees temp paths.
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { $ } from 'bun'
import { SqliteLedger } from '../src/ledger/sqlite'
import {
  WorktreeProvider,
  canonicalRescueBranch,
  canonicalWorktreeBranch,
  canonicalWorktreeId,
} from '../src/worktrees'

interface Fixture {
  root: string
  repo: string
  worktreeBase: string
  /**
   * Default quarantine root: `.quarantine` inside the worktrees root, so it is
   * covered by the same git-ignore rule and never pollutes the main repo.
   */
  quarantineBase: string
  ledger: SqliteLedger
  provider: WorktreeProvider
}

async function makeFixture(): Promise<Fixture> {
  const root = mkdtempSync(join(tmpdir(), 'sup-worktrees-'))
  const repo = join(root, 'repo')
  mkdirSync(join(repo, 'src'), { recursive: true })

  await $`git -C ${repo} init -q`.quiet()
  // Local identity: the rescue path commits, so git needs an author.
  await $`git -C ${repo} config user.email supervisor-test@example.com`.quiet()
  await $`git -C ${repo} config user.name supervisor-test`.quiet()
  writeFileSync(join(repo, 'README.md'), '# fixture\n')
  writeFileSync(join(repo, 'src/index.ts'), 'export const value = 1\n')
  await $`git -C ${repo} add -A`.quiet()
  await $`git -C ${repo} commit -qm "fixture: initial"`.quiet()

  const worktreeBase = join(root, '.worktrees')
  // No explicit quarantinePath: exercise the provider default, which must stay
  // inside the temp worktrees root.
  const quarantineBase = join(worktreeBase, '.quarantine')
  const ledger = new SqliteLedger(join(root, 'supervisor.db'))
  const provider = new WorktreeProvider(ledger, {
    basePath: worktreeBase,
    mainRepoPath: repo,
  })

  return { root, repo, worktreeBase, quarantineBase, ledger, provider }
}

describe('canonical worktree convention', () => {
  it('derives `wt-<task>` and `supervisor/wi-<task>` from either task spelling', () => {
    expect(canonicalWorktreeId('wi-123-abc')).toBe('wt-wi-123-abc')
    expect(canonicalWorktreeId('123-abc')).toBe('wt-wi-123-abc')
    expect(canonicalWorktreeBranch('wi-123-abc')).toBe('supervisor/wi-123-abc')
    expect(canonicalWorktreeBranch('123-abc')).toBe('supervisor/wi-123-abc')
  })

  it('names rescue branches off the canonical branch', () => {
    expect(canonicalRescueBranch('supervisor/wi-123-abc', 1700)).toBe(
      'rescue/supervisor/wi-123-abc/1700',
    )
    expect(
      canonicalRescueBranch('supervisor/wi-123-abc').startsWith(
        'rescue/supervisor/wi-123-abc/',
      ),
    ).toBe(true)
  })
})

describe('WorktreeProvider lifecycle', () => {
  let fixture: Fixture

  beforeEach(async () => {
    fixture = await makeFixture()
  })

  afterEach(() => {
    fixture.ledger.close()
    rmSync(fixture.root, { recursive: true, force: true })
  })

  it('creates, reports status, and removes a clean worktree', async () => {
    const { provider, ledger, worktreeBase } = fixture
    const taskId = 'wi-task-1'
    const id = canonicalWorktreeId(taskId)
    const baseSha = await provider.resolveBaseSha()

    const created = await provider.createWorktree(
      id,
      canonicalWorktreeBranch(taskId),
      baseSha,
    )

    // Temp root only: nothing under the repository's real `.worktrees/`.
    expect(created.path.startsWith(worktreeBase)).toBe(true)
    expect(worktreeBase.startsWith(fixture.root)).toBe(true)
    expect(created.path).toBe(join(worktreeBase, 'wt-wi-task-1'))
    expect(created.branch).toBe('supervisor/wi-task-1')
    expect(created.headSha).toBe(baseSha)
    expect(created.dirty).toBe(false)
    expect(created.status).toBe('active')
    expect(existsSync(join(created.path, 'README.md'))).toBe(true)

    const info = await provider.getWorktreeInfo(id)
    expect(info?.path).toBe(created.path)
    expect(info?.branch).toBe('supervisor/wi-task-1')
    expect(info?.baseSha).toBe(baseSha)
    expect(info?.dirty).toBe(false)
    expect(info?.status).toBe('active')

    const removed = await provider.removeWorktree(id, false)
    expect(removed.removed).toBe(true)
    expect(removed.rescueBranch).toBeUndefined()
    expect(removed.quarantinePath).toBeUndefined()
    expect(existsSync(created.path)).toBe(false)
    expect((await ledger.getWorkspace(id))?.status).toBe('removed')

    // Unknown workspaces are a no-op, never a throw.
    expect(await provider.removeWorktree('wt-wi-missing', false)).toEqual({
      removed: false,
    })
  })

  it('rescues a dirty worktree into quarantine instead of refusing', async () => {
    const { provider, ledger, repo, quarantineBase } = fixture
    const taskId = 'wi-task-2'
    const id = canonicalWorktreeId(taskId)

    const created = await provider.createWorktree(
      id,
      canonicalWorktreeBranch(taskId),
      await provider.resolveBaseSha(),
    )

    // Dirty it: one tracked edit plus one untracked file.
    writeFileSync(join(created.path, 'README.md'), '# fixture\nmodified\n')
    writeFileSync(join(created.path, 'notes.txt'), 'uncommitted notes\n')
    expect((await provider.getWorktreeInfo(id))?.dirty).toBe(true)

    const removed = await provider.removeWorktree(id, false)

    // Rescued, not refused: the worktree still goes away.
    expect(removed.removed).toBe(true)
    expect(existsSync(created.path)).toBe(false)
    const rescueBranch = removed.rescueBranch
    expect(rescueBranch?.startsWith('rescue/supervisor/wi-task-2/')).toBe(true)
    expect(
      rescueBranch?.startsWith(`rescue/${canonicalWorktreeBranch(taskId)}`),
    ).toBe(true)

    // Uncommitted changes are preserved on disk in the quarantine directory,
    // which stays inside the temp worktrees root (never in the repo).
    const quarantinePath = removed.quarantinePath as string
    expect(quarantinePath.startsWith(quarantineBase)).toBe(true)
    expect(existsSync(join(fixture.root, '.worktrees-quarantine'))).toBe(false)
    expect(
      readFileSync(join(quarantinePath, 'status.txt'), 'utf8'),
    ).toContain('notes.txt')
    expect(
      readFileSync(join(quarantinePath, 'worktree.diff'), 'utf8'),
    ).toContain('modified')
    expect(
      readFileSync(join(quarantinePath, 'files', 'notes.txt'), 'utf8'),
    ).toContain('uncommitted notes')

    // ... and the rescue branch survives the worktree removal.
    const branches = (
      await $`git -C ${repo} branch --list ${'rescue/*'}`.text()
    ).trim()
    expect(branches).toContain(rescueBranch as string)

    const ws = await ledger.getWorkspace(id)
    expect(ws?.rescue_branch).toBe(rescueBranch)
    expect(ws?.quarantined_at).not.toBeNull()
  })

  it('removes a dirty worktree without rescue when forced', async () => {
    const { provider } = fixture
    const taskId = 'wi-task-3'
    const id = canonicalWorktreeId(taskId)
    const created = await provider.createWorktree(
      id,
      canonicalWorktreeBranch(taskId),
      await provider.resolveBaseSha(),
    )
    writeFileSync(join(created.path, 'scratch.txt'), 'discard me\n')

    const removed = await provider.removeWorktree(id, true)

    expect(removed.removed).toBe(true)
    expect(removed.rescueBranch).toBeUndefined()
    expect(removed.quarantinePath).toBeUndefined()
    expect(existsSync(created.path)).toBe(false)
  })

  it('honours an explicit quarantine root', async () => {
    const { ledger, repo, root } = fixture
    const explicitRoot = join(root, 'quarantine-explicit')
    const scoped = new WorktreeProvider(ledger, {
      basePath: join(root, '.worktrees-explicit'),
      mainRepoPath: repo,
      quarantinePath: explicitRoot,
    })
    const taskId = 'wi-task-4'
    const id = canonicalWorktreeId(taskId)
    const created = await scoped.createWorktree(
      id,
      canonicalWorktreeBranch(taskId),
      await scoped.resolveBaseSha(),
    )
    writeFileSync(join(created.path, 'dirty.txt'), 'explicit root\n')

    const removed = await scoped.removeWorktree(id, false)
    const quarantinePath = removed.quarantinePath as string

    expect(removed.removed).toBe(true)
    expect(quarantinePath.startsWith(explicitRoot)).toBe(true)
    expect(
      readFileSync(join(quarantinePath, 'files', 'dirty.txt'), 'utf8'),
    ).toContain('explicit root')
    // The default location must be untouched when a path is supplied.
    expect(existsSync(join(fixture.worktreeBase, '.quarantine'))).toBe(false)
  })
})
