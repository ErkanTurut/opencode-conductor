// P4-A/B: worktree create consults the detected package manager and refuses a
// folder with no repository before it creates a directory or runs a shell.
import { afterAll, describe, expect, it } from 'bun:test'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import {
  NO_GIT_REPO_CODE,
  NO_GIT_REPO_HINT,
  NO_GIT_REPO_MESSAGE,
} from '../../src/plugin'
import {
  executeNamed,
  makeDir,
  makeGitRepo,
  registerFor,
  shellSpy,
  toolResult,
} from './support'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

function tracked(root: string): string {
  roots.push(root)
  return root
}

describe('supervisor_worktree create — non-git contract', () => {
  it('refuses a folder with no repository without creating anything', async () => {
    const root = tracked(makeDir('worktree-non-git'))
    const { $, calls } = shellSpy()
    const { definitions } = registerFor(root, { $ })

    const out = toolResult(
      await executeNamed(definitions, 'supervisor_worktree', {
        action: 'create',
        task_id: 'wi-p4-nogit',
      }),
    )

    expect(out).toEqual({
      created: false,
      code: NO_GIT_REPO_CODE,
      message: NO_GIT_REPO_MESSAGE,
      hint: NO_GIT_REPO_HINT,
    })
    expect(out.message).toContain('not a git repository')
    expect(out.hint).toContain('git init')
    // No worktree directory, no bootstrap shell call.
    expect(existsSync(join(root, '.worktrees'))).toBe(false)
    expect(calls).toEqual([])
  })
})

describe('supervisor_worktree create — package-manager bootstrap', () => {
  it('records the pnpm frozen install for a pnpm lockfile', async () => {
    const root = tracked(
      makeGitRepo('worktree-pnpm', {
        'package.json': JSON.stringify({ name: 'fixture', scripts: {} }),
        'pnpm-lock.yaml': 'lockfileVersion: "9.0"\n',
      }),
    )
    const { $, calls } = shellSpy()
    const { definitions } = registerFor(root, { $ })

    const out = toolResult(
      await executeNamed(definitions, 'supervisor_worktree', {
        action: 'create',
        task_id: 'wi-p4-pnpm',
      }),
    )

    expect(out.workspace_id).toBe('wt-wi-p4-pnpm')
    expect(out.branch).toBe('supervisor/wi-p4-pnpm')
    expect(out.dependency_setup).toEqual({
      command: 'pnpm install --frozen-lockfile',
      exit_code: 0,
      passed: true,
    })
    expect(calls).toEqual(['pnpm install --frozen-lockfile'])
    expect(existsSync(out.path)).toBe(true)
  })

  it('skips the bootstrap when there is no node project', async () => {
    const root = tracked(
      makeGitRepo('worktree-no-node', { 'README.md': 'not node\n' }),
    )
    const { $, calls } = shellSpy()
    const { definitions } = registerFor(root, { $ })

    const out = toolResult(
      await executeNamed(definitions, 'supervisor_worktree', {
        action: 'create',
        task_id: 'wi-p4-no-node',
      }),
    )

    expect(existsSync(out.path)).toBe(true)
    expect(out.dependency_setup).toEqual({
      skipped: true,
      reason: 'no node project (no package.json or lockfile)',
    })
    expect(calls).toEqual([])
  })
})
