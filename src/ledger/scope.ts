import { lstatSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'

/** Literal repository-relative paths and a final recursive glob only. */
export function scopePrefix(value: unknown): string | null {
  if (typeof value !== 'string' || !value || value !== value.trim() || /[\x00-\x1f\x7f-\x9f\\]/.test(value) || value.startsWith('/') || /^[A-Za-z]:/.test(value)) return null
  const path = value.endsWith('/**') ? value.slice(0, -3) : value
  if (!path || /[*?\[\]{}!]/.test(path) || path.split('/').some(p => !p || p === '.' || p === '..')) return null
  return path
}
export function scopesOverlap(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)
}
export function validateScopeRoots(root: string, scopes: string[]): boolean {
  try { if (lstatSync(root).isSymbolicLink()) return false } catch { return false }
  for (const scope of scopes) {
    const prefix = scopePrefix(scope)
    if (!prefix) return false
    let current = root
    for (const part of prefix.split('/')) {
      current = join(current, part)
      try { if (lstatSync(current).isSymbolicLink()) return false }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return false }
    }
  }
  return true
}
export function validateChangedFiles(root: string, files: string[], writeScopes: string[], allowedPaths: string[]): string | null {
  try { if (lstatSync(root).isSymbolicLink()) return 'symlink_workspace' } catch { return 'workspace_uninspectable' }
  const write = writeScopes.map(scopePrefix), allowed = allowedPaths.map(scopePrefix)
  if (write.some(p => !p) || allowed.some(p => !p)) return 'invalid_scope'
  if (files.length && (!write.length || !allowed.length)) return 'scope_unavailable'
  for (const file of files) {
    const normalized = scopePrefix(file)
    if (!normalized || normalized !== file || file.includes('*')) return 'invalid_changed_path'
    if (!write.some(p => p && scopesOverlap(p, file) && (p === file || file.startsWith(`${p}/`))) || !allowed.some(p => p && (p === file || file.startsWith(`${p}/`)))) return 'changed_file_outside_scope'
    // Refuse any existing symlink component. Deleted components are allowed;
    // other lstat errors are not evidence of safety.
    let current = root
    for (const component of file.split('/')) {
      current = join(current, component)
      try { if (lstatSync(current).isSymbolicLink()) return 'symlink_in_changed_path' }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return 'changed_path_uninspectable' }
    }
  }
  return null
}

/** Includes committed, staged, unstaged and untracked paths, including ignored. */
export async function collectWorkspaceChanges(root: string, baseSha: string): Promise<string[]> {
  if (!/^[a-f0-9]{40,64}$/i.test(baseSha)) throw new Error('workspace base SHA unavailable')
  const run = async (args: string[]) => {
    const proc = Bun.spawn(['git', '-C', root, ...args], { stdout: 'pipe', stderr: 'pipe' })
    const text = await new Response(proc.stdout).text()
    if (await proc.exited !== 0) throw new Error('workspace diff unavailable')
    return text.split('\0').filter(Boolean)
  }
  const [committed, staged, unstaged, untracked] = await Promise.all([
    run(['diff', '--name-only', '--no-renames', '-z', baseSha, 'HEAD', '--']),
    run(['diff', '--cached', '--name-only', '--no-renames', '-z', baseSha, '--']),
    run(['diff', '--name-only', '--no-renames', '-z', '--']),
    run(['ls-files', '--others', '-z']),
  ])
  return [...new Set([...committed, ...staged, ...unstaged, ...untracked])]
}

/** Resolve only server-observed repository/worktree facts; never caller SHAs. */
export async function validateWorkspaceBinding(mainRoot: string, workspace: { id: string; path: string; branch: string; base_sha: string; status: string }, expectedId: string, expectedBranch: string, admission: boolean): Promise<boolean> {
  if (workspace.id !== expectedId || workspace.branch !== expectedBranch || workspace.status !== 'active' || !/^[a-f0-9]{40,64}$/i.test(workspace.base_sha)) return false
  const git = async (root: string, args: string[]) => {
    const proc = Bun.spawn(['git', '-C', root, ...args], { stdout: 'pipe', stderr: 'pipe' })
    const out = (await new Response(proc.stdout).text()).trim()
    if (await proc.exited !== 0) throw new Error('git binding unavailable')
    return out
  }
  try {
    if (lstatSync(workspace.path).isSymbolicLink()) return false
    const [mainHead, workHead, branch, mainCommon, workCommon] = await Promise.all([
      git(mainRoot, ['rev-parse', 'HEAD']), git(workspace.path, ['rev-parse', 'HEAD']),
      git(workspace.path, ['branch', '--show-current']), git(mainRoot, ['rev-parse', '--git-common-dir']),
      git(workspace.path, ['rev-parse', '--git-common-dir']),
    ])
    if (realpathSync(resolve(mainRoot, mainCommon)) !== realpathSync(resolve(workspace.path, workCommon))) return false
    if (branch !== expectedBranch) return false
    if (admission) return mainHead === workspace.base_sha && workHead === workspace.base_sha
    await git(workspace.path, ['merge-base', '--is-ancestor', workspace.base_sha, workHead])
    return true
  } catch { return false }
}
