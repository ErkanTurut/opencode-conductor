import { expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scopePrefix, scopesOverlap, validateChangedFiles, collectWorkspaceChanges, validateScopeRoots } from '../../src/ledger/scope'

test('rejects unsafe and ambiguous repository scopes', () => {
  for (const path of ['src/a/../b', '/src/b', '../a', 'src//a', 'C:/foo', 'src/a\n', 'src/**/*.ts', 'src/\\b']) expect(scopePrefix(path)).toBeNull()
  expect(scopePrefix('src/a/**')).toBe('src/a')
  expect(scopesOverlap('src/a', 'src/a/file')).toBe(true)
  expect(scopesOverlap('src/a', 'src/abc')).toBe(false)
})
test('checks actual paths against both scopes and rejects symlink paths', () => {
  const root = mkdtempSync(join(tmpdir(), 'conductor-scope-'))
  try {
    mkdirSync(join(root, 'src')); writeFileSync(join(root, 'src/a'), 'x')
    symlinkSync('a', join(root, 'src/link'))
    expect(validateScopeRoots(root, ['src/link'])).toBe(false)
    expect(validateScopeRoots(root, ['src/a'])).toBe(true)
    expect(validateChangedFiles(root, ['src/a'], ['src/**'], ['src'])).toBeNull()
    expect(validateChangedFiles(root, ['src/a'], ['other'], ['src'])).toBe('changed_file_outside_scope')
    expect(validateChangedFiles(root, ['src/link'], ['src'], ['src'])).toBe('symlink_in_changed_path')
  } finally { rmSync(root, { recursive: true, force: true }) }
})
test('collects committed, staged, unstaged and ignored changes from temporary repository', async () => {
  const root = mkdtempSync(join(tmpdir(), 'conductor-scope-git-'))
  const git = async (...args: string[]) => { const p = Bun.spawn(['git', '-C', root, ...args], { stdout: 'pipe', stderr: 'pipe' }); const out = await new Response(p.stdout).text(); expect(await p.exited).toBe(0); return out.trim() }
  try {
    await git('init', '-q'); await git('config', 'user.email', 'fixture@example.invalid'); await git('config', 'user.name', 'Fixture')
    writeFileSync(join(root, 'tracked'), 'base'); await git('add', '.'); await git('commit', '-qm', 'base'); const sha = await git('rev-parse', 'HEAD')
    writeFileSync(join(root, 'tracked'), 'changed'); writeFileSync(join(root, '.gitignore'), 'ignored\n'); writeFileSync(join(root, 'ignored'), 'x')
    expect((await collectWorkspaceChanges(root, sha)).sort()).toEqual(['.gitignore', 'ignored', 'tracked'])
    await git('add', 'tracked')
    // The index contains the change while the working tree matches the base.
    // `git diff <base>` alone misses this staged modification.
    writeFileSync(join(root, 'tracked'), 'base')
    expect((await collectWorkspaceChanges(root, sha))).toContain('tracked')
  } finally { rmSync(root, { recursive: true, force: true }) }
})
