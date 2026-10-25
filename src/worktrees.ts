import { $ } from 'bun'
import type { ILedger } from './ledger/interface'

export interface WorktreeConfig {
  basePath: string
  mainRepoPath: string
  /**
   * Rescue/quarantine root for dirty worktrees. Defaults to `.quarantine`
   * inside `basePath`, so quarantined work stays under the (git-ignored)
   * worktrees root instead of polluting the main repo's status.
   */
  quarantinePath?: string
}

export interface WorktreeInfo {
  path: string
  branch: string
  baseSha: string
  headSha: string | null
  dirty: boolean
  /** Ledger workspace status (additive; callers surface it on `status`). */
  status: string
}

export interface RemoveWorktreeResult {
  removed: boolean
  /** Set when a dirty worktree was rescued onto a rescue branch. */
  rescueBranch?: string
  /** Directory holding the quarantined copy of the uncommitted changes. */
  quarantinePath?: string
}

// --- Canonical worktree convention (t1) --------------------------------------
// Single source of truth for both the runner and the .opencode plugin, so the
// two can never drift again:
//   worktree id : wt-<task_id>
//   branch      : supervisor/wi-<task_id>
//   rescue      : rescue/<branch>/<timestamp>
// Task ids arrive as `wi-<id>`; the prefix is accepted either way so both
// spellings normalize onto the same name.
function bareTaskId(taskId: string): string {
  return taskId.startsWith('wi-') ? taskId.slice(3) : taskId
}

export function canonicalWorktreeId(taskId: string): string {
  return `wt-wi-${bareTaskId(taskId)}`
}

export function canonicalWorktreeBranch(taskId: string): string {
  return `supervisor/wi-${bareTaskId(taskId)}`
}

export function canonicalRescueBranch(
  branch: string,
  at: number = Date.now(),
): string {
  return `rescue/${branch}/${at}`
}

export class WorktreeProvider {
  private config: WorktreeConfig
  private ledger: ILedger

  constructor(ledger: ILedger, config: WorktreeConfig) {
    this.ledger = ledger
    this.config = config
  }

  /**
   * Base commit for a new worktree: the main repo's current HEAD. Callers use
   * this instead of shelling out to git themselves, so worktree lifecycle
   * stays inside the provider.
   */
  async resolveBaseSha(): Promise<string> {
    return (
      await $`git -C ${this.config.mainRepoPath} rev-parse HEAD`.text()
    ).trim()
  }

  async createWorktree(
    id: string,
    branch: string,
    baseSha: string,
  ): Promise<WorktreeInfo> {
    const path = `${this.config.basePath}/${id}`

    await $`git -C ${this.config.mainRepoPath} worktree add ${path} ${baseSha} -b ${branch}`.quiet()

    const headSha = (await $`git -C ${path} rev-parse HEAD`.text()).trim()

    await this.ledger.createWorkspace({
      id,
      provider: 'worktree',
      path,
      branch,
      baseSha,
    })
    await this.ledger.updateWorkspaceStatus(id, 'active', headSha)

    return {
      path,
      branch,
      baseSha,
      headSha,
      dirty: false,
      status: 'active',
    }
  }

  async getWorktreeInfo(id: string): Promise<WorktreeInfo | null> {
    const ws = await this.ledger.getWorkspace(id)
    if (!ws) return null

    let headSha = ws.head_sha
    let dirty = Boolean(ws.dirty)

    try {
      headSha = (await $`git -C ${ws.path} rev-parse HEAD`.text()).trim()
      const statusOutput = (
        await $`git -C ${ws.path} status --porcelain`.text()
      ).trim()
      dirty = statusOutput.length > 0
    } catch {
      // Worktree path may no longer exist
    }

    return {
      path: ws.path,
      branch: ws.branch,
      baseSha: ws.base_sha,
      headSha,
      dirty,
      status: ws.status,
    }
  }

  private quarantineRoot(): string {
    return this.config.quarantinePath ?? `${this.config.basePath}/.quarantine`
  }

  /**
   * Dirty-worktree rescue. Copies the uncommitted changes into a quarantine
   * directory (porcelain status + diff + the affected files) and preserves them
   * on a rescue branch that outlives the worktree, then lets the removal
   * proceed. A dirty worktree is never refused: refusing loses the work when
   * cleanup is the only recovery path.
   */
  private async rescueDirty(
    id: string,
    path: string,
    rescueBranch: string,
    at: number,
  ): Promise<string> {
    const dir = `${this.quarantineRoot()}/${id}-${at}`
    await $`mkdir -p ${dir}/files`.quiet()

    const statusResult =
      await $`git -C ${path} status --porcelain`.nothrow().quiet()
    const diffResult = await $`git -C ${path} diff HEAD`.nothrow().quiet()
    const statusText = String(statusResult.stdout)
    const diffText = String(diffResult.stdout)

    await Bun.write(`${dir}/status.txt`, statusText)
    await Bun.write(`${dir}/worktree.diff`, diffText)

    // Best-effort file copy: the status/diff above stay the authoritative
    // record when an exotic path (rename, quoted path) cannot be copied.
    for (const line of statusText.split('\n')) {
      const entry = line.slice(3).trim()
      if (!entry) continue
      const renamed = entry.includes(' -> ')
        ? entry.slice(entry.lastIndexOf(' -> ') + 4)
        : entry
      const rel = renamed.replace(/^"|"$/g, '').replace(/\/$/, '')
      if (!rel) continue
      const dest = `${dir}/files/${rel}`
      await $`mkdir -p ${dest.split('/').slice(0, -1).join('/')}`.quiet()
      await $`cp -R ${path}/${rel} ${dest}`.nothrow().quiet()
    }

    // Git-level preservation: the rescue branch keeps the changes even after
    // the worktree is removed, and even if a file copy above failed.
    try {
      await $`git -C ${path} checkout -b ${rescueBranch}`.quiet()
      await $`git -C ${path} add -A`.quiet()
      await $`git -C ${path} commit -m ${`rescue: preserving dirty worktree for ${id}`}`.quiet()
    } catch {
      // Best-effort rescue: the quarantine directory is the primary artefact.
    }

    return dir
  }

  async removeWorktree(
    id: string,
    force: boolean,
  ): Promise<RemoveWorktreeResult> {
    const ws = await this.ledger.getWorkspace(id)
    if (!ws) return { removed: false }

    const info = await this.getWorktreeInfo(id)
    let rescueBranch: string | undefined
    let quarantinePath: string | undefined

    if (info?.dirty && !force) {
      const at = Date.now()
      rescueBranch = canonicalRescueBranch(ws.branch, at)
      quarantinePath = await this.rescueDirty(id, ws.path, rescueBranch, at)
      await this.ledger.quarantineWorkspace(id, rescueBranch)
    }

    try {
      await $`git -C ${this.config.mainRepoPath} worktree remove ${ws.path} --force`.quiet()
      await this.ledger.updateWorkspaceStatus(id, 'removed')
      return { removed: true, rescueBranch, quarantinePath }
    } catch {
      await this.ledger.updateWorkspaceStatus(id, 'cleanup_failed')
      return { removed: false, rescueBranch, quarantinePath }
    }
  }

  async validatePathContainment(
    worktreeId: string,
    paths: string[],
  ): Promise<boolean> {
    const ws = await this.ledger.getWorkspace(worktreeId)
    if (!ws) return false

    const resolvedBase = ws.path.replace(/\/$/, '')
    for (const p of paths) {
      const resolved = p.replace(/\/$/, '')
      if (!resolved.startsWith(resolvedBase)) {
        return false
      }
    }
    return true
  }

  async validateBranchAncestry(
    worktreeId: string,
    targetBranch: string,
  ): Promise<boolean> {
    const ws = await this.ledger.getWorkspace(worktreeId)
    if (!ws) return false

    try {
      const result =
        await $`git -C ${this.config.mainRepoPath} merge-base --is-ancestor ${ws.base_sha} ${targetBranch}`
          .nothrow()
          .quiet()
      return result.exitCode === 0
    } catch {
      return false
    }
  }

  async getChangedFiles(worktreeId: string): Promise<string[]> {
    const ws = await this.ledger.getWorkspace(worktreeId)
    if (!ws) return []

    try {
      const files =
        await $`git -C ${ws.path} diff --name-only ${ws.base_sha} HEAD`.text()
      return files
        .trim()
        .split('\n')
        .filter((f) => f.length > 0)
    } catch {
      return []
    }
  }

  async getDiff(worktreeId: string): Promise<string> {
    const ws = await this.ledger.getWorkspace(worktreeId)
    if (!ws) return ''

    try {
      return await $`git -C ${ws.path} diff ${ws.base_sha} HEAD`.text()
    } catch {
      return ''
    }
  }

  async listWorktrees(): Promise<string[]> {
    try {
      const output =
        await $`git -C ${this.config.mainRepoPath} worktree list --porcelain`.text()
      return output
        .trim()
        .split('\n')
        .filter((line) => line.startsWith('worktree '))
        .map((line) => line.replace('worktree ', ''))
    } catch {
      return []
    }
  }
}
