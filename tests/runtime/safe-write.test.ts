import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readOptionalArtifact, safeWriteArtifact } from '../../src/runtime/safe-write'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'conductor-safe-write-'))); roots.push(root); return root
}

test('safe write atomically replaces an existing regular file and leaves no temporary artifact', () => {
  const root = fixture(), path = join(root, 'runs', 'run-1', 'receipt.md')
  safeWriteArtifact(path, 'first')
  expect(readFileSync(path, 'utf8')).toBe('first')
  safeWriteArtifact(path, 'replacement')
  expect(readFileSync(path, 'utf8')).toBe('replacement')
  expect(readdirSync(join(root, 'runs', 'run-1'))).toEqual(['receipt.md'])
  expect(readOptionalArtifact(path)).toBe('replacement')
  expect(readOptionalArtifact(join(root, 'absent.json'))).toBeNull()
})

test('safe write refuses a symlink target without modifying its destination', () => {
  const root = fixture(), target = join(root, 'outside.txt'), linked = join(root, 'receipt.md')
  writeFileSync(target, 'protected'); symlinkSync(target, linked)
  expect(() => safeWriteArtifact(linked, 'attack')).toThrow('symlink_path_refused')
  expect(readFileSync(target, 'utf8')).toBe('protected')
  expect(() => readOptionalArtifact(linked)).toThrow('symlink_path_refused')
})

test('safe write refuses symlinked parent components before creating files', () => {
  const root = fixture(), outside = join(root, 'outside'), linkedParent = join(root, 'linked')
  writeFileSync(join(root, 'sentinel'), 'untouched'); symlinkSync(outside, linkedParent)
  expect(() => safeWriteArtifact(join(linkedParent, 'receipt.md'), 'attack')).toThrow('symlink_path_refused')
  expect(readdirSync(root).sort()).toEqual(['linked', 'sentinel'])
})
