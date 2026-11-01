import { describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { discoverPreview } from '../../src/runtime/preview'

describe('preview awareness', () => {
  it('does not invent a deployment from missing configuration', () => {
    const data = discoverPreview('/does-not-exist', 'develop')
    expect(data.configured).toBe(false)
    expect(data.deploymentVerified).toBe(false)
    expect(data.guidance.join(' ')).toContain('exact commit')
  })
  it('detects local Vercel config but never declares a live deployment verified', () => {
    const root = mkdtempSync(join(tmpdir(), 'conductor-preview-'))
    try {
      mkdirSync(join(root, '.vercel'))
      writeFileSync(join(root, '.vercel/project.json'), '{"projectId":"fixture"}')
      const data = discoverPreview(root, 'dev')
      expect(data.provider).toBe('vercel')
      expect(data.configured).toBe(true)
      expect(data.branch).toBe('dev')
      expect(data.url).toBeNull()
      expect(data.deploymentVerified).toBe(false)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
  it('ignores escaping symlinks and malformed markers', () => {
    const root = mkdtempSync(join(tmpdir(), 'conductor-preview-'))
    try {
      writeFileSync(join(root, 'outside.json'), '{}')
      symlinkSync(join(root, 'outside.json'), join(root, 'vercel.json'))
      expect(discoverPreview(root, 'dev').provider).toBe('unknown')
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
})
