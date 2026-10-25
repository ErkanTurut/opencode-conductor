// P4-A: the bootstrap table. One exact command per detected manager, plus the
// fallback ladder when detection reported no manager (bun lockfile -> frozen
// bun install, bare package.json -> npm install, neither -> nothing to do).
import { afterAll, describe, expect, it } from 'bun:test'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { bootstrapCommand } from '../../src/runtime/bootstrap'
import { makeDir } from './support'

const roots: string[] = []

function fixture(files: Record<string, string>): string {
  const root = makeDir('bootstrap')
  roots.push(root)
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(root, name), content)
  }
  return root
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

describe('bootstrapCommand — detected package manager', () => {
  const table = [
    ['bun', 'bun install --frozen-lockfile'],
    ['pnpm', 'pnpm install --frozen-lockfile'],
    ['yarn', 'yarn install --immutable'],
    ['npm', 'npm ci'],
  ] as const

  for (const [manager, command] of table) {
    it(`${manager} -> ${command}`, () => {
      const result = bootstrapCommand(manager, '/nonexistent')
      expect(result).not.toBeNull()
      expect(result?.command).toBe(command)
      expect(result?.reason).toContain(manager)
    })
  }
})

describe('bootstrapCommand — no detected manager', () => {
  it('prefers a frozen bun install when a bun.lock exists', () => {
    const root = fixture({ 'bun.lock': '{}' })
    expect(bootstrapCommand(null, root)).toEqual({
      command: 'bun install --frozen-lockfile',
      reason: 'bun lockfile present, package manager not detected',
    })
  })

  it('accepts the legacy bun.lockb too', () => {
    const root = fixture({ 'bun.lockb': '' })
    expect(bootstrapCommand(null, root)?.command).toBe(
      'bun install --frozen-lockfile',
    )
  })

  it('falls back to npm install for a bare package.json', () => {
    const root = fixture({ 'package.json': '{"name":"fixture"}' })
    expect(bootstrapCommand(null, root)).toEqual({
      command: 'npm install',
      reason: 'package-manager:npm (default, no lockfile)',
    })
  })

  it('returns null when there is no node project', () => {
    const root = fixture({ 'README.md': 'not a node project' })
    expect(bootstrapCommand(null, root)).toBeNull()
  })
})
