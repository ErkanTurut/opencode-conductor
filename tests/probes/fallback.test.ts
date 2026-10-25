// Agent registration has two paths. `transform` uses the probe-verified
// `editor.transform` API; `files` writes agent markdown into the global config
// directory and needs no undocumented API at all.
//
// These tests pin the fail-closed selection rule (only an explicit `pass`
// selects `transform`, so an absent or inconclusive report still registers
// agents) and the file fallback itself: render shape and idempotent writes.
import { afterEach, describe, expect, it } from 'bun:test'
import * as nodeFs from 'node:fs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  materializeAgentFiles,
  renderAgentMarkdown,
  selectAgentRegistrationPath,
  type MaterializableAgent,
  type MaterializeFs,
} from '../../src/runtime/compat'

const AGENT: MaterializableAgent = {
  id: 'x',
  description: 'd',
  mode: 'subagent',
  model: { providerID: 'p', id: 'm' },
  steps: 3,
  system: 'You are X.',
}

/**
 * `MaterializeFs` is deliberately narrow, so adapt node:fs rather than widening
 * the production interface: only the five calls the materializer is allowed to
 * make are exposed here.
 */
const io: MaterializeFs = {
  mkdirSync: (path, options) => nodeFs.mkdirSync(path, options as nodeFs.MakeDirectoryOptions),
  writeFileSync: (path, data, options) => nodeFs.writeFileSync(path, data, options as nodeFs.WriteFileOptions),
  renameSync: (from, to) => nodeFs.renameSync(from, to),
  readFileSync: (path, encoding) => nodeFs.readFileSync(path, { encoding: encoding as BufferEncoding }),
  existsSync: (path) => nodeFs.existsSync(path),
}

const created: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'conductor-agents-'))
  created.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('selectAgentRegistrationPath', () => {
  it('uses transform only for an explicit pass', () => {
    expect(selectAgentRegistrationPath({ verdict: 'pass' })).toBe('transform')
  })

  it('falls back to files for a failed probe', () => {
    expect(selectAgentRegistrationPath({ verdict: 'fail' })).toBe('files')
  })

  it('falls back to files when the probe was inconclusive', () => {
    expect(selectAgentRegistrationPath({ verdict: 'inconclusive' })).toBe('files')
  })

  it('falls back to files without a report', () => {
    expect(selectAgentRegistrationPath(null)).toBe('files')
    expect(selectAgentRegistrationPath(undefined)).toBe('files')
  })

  it('falls back to files for an unknown verdict string', () => {
    expect(selectAgentRegistrationPath({ verdict: 'PASS' })).toBe('files')
    expect(selectAgentRegistrationPath({ verdict: 'green' })).toBe('files')
    expect(selectAgentRegistrationPath({})).toBe('files')
  })
})

describe('materializeAgentFiles', () => {
  it('writes frontmatter and body the file-agent loader can read', () => {
    const dir = tempDir()
    const written = materializeAgentFiles([AGENT], dir, io)
    const target = join(dir, 'x.md')

    expect(written).toEqual([target])
    expect(nodeFs.existsSync(target)).toBe(true)

    const content = nodeFs.readFileSync(target, 'utf8')
    expect(content).toBe(renderAgentMarkdown(AGENT))
    expect(content.startsWith('---\n')).toBe(true)
    expect(content).toContain('mode: subagent')
    expect(content).toContain('model: "p/m"')
    expect(content).toContain('steps: 3')
    expect(content).toContain('You are X.')
    // Frontmatter closes before the system prompt starts.
    const [, frontmatter, body] = content.split('---')
    expect(frontmatter).toContain('mode: subagent')
    expect(body.trim()).toBe('You are X.')
  })

  it('is idempotent: a second run writes nothing and leaves the file untouched', () => {
    const dir = tempDir()
    const first = materializeAgentFiles([AGENT], dir, io)
    expect(first).toEqual([join(dir, 'x.md')])

    const before = nodeFs.readFileSync(join(dir, 'x.md'), 'utf8')
    const second = materializeAgentFiles([AGENT], dir, io)

    expect(second).toEqual([])
    expect(nodeFs.readFileSync(join(dir, 'x.md'), 'utf8')).toBe(before)
  })
})
