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
  model: { providerID: 'p', id: 'm', variant: 'fast' },
  steps: 3,
  // Deliberately supplied deny-first, the V1 order: V2 evaluates the last
  // matching rule, so the renderer must reverse each effect group.
  permissions: [
    { action: 'shell', resource: 'git push*', effect: 'deny' },
    { action: 'shell', resource: '*', effect: 'allow' },
    { action: 'read', resource: "**/*.key", effect: 'deny' },
  ],
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
  it('writes V2 frontmatter and body the global agent loader can read', () => {
    const dir = tempDir()
    const written = materializeAgentFiles([AGENT], dir, io)
    const target = join(dir, 'x.md')

    expect(written).toEqual([target])
    expect(nodeFs.existsSync(target)).toBe(true)

    const content = nodeFs.readFileSync(target, 'utf8')
    expect(content).toBe(renderAgentMarkdown(AGENT))
    expect(content.startsWith('---\n')).toBe(true)
    expect(content).toContain('mode: subagent')
    // The variant travels as the model reference suffix.
    expect(content).toContain('model: "p/m#fast"')
    expect(content).toContain('steps: 3')
    expect(content).toContain('You are X.')
    expect(content).not.toContain('\npermission:\n')

    // Frontmatter closes before the system prompt starts.
    const [, frontmatter, body] = content.split('---')
    expect(frontmatter).toContain('mode: subagent')
    expect(frontmatter).toContain('permissions:\n')
    expect(body.trim()).toBe('You are X.')
  })

  it('emits the permissions as an ordered action/resource/effect sequence', () => {
    const rendered = renderAgentMarkdown(AGENT)
    const [, frontmatter] = rendered.split('---')

    expect(frontmatter).toContain(
      [
        'permissions:',
        '  - action: shell',
        "    resource: '*'",
        '    effect: allow',
        '  - action: shell',
        "    resource: 'git push*'",
        '    effect: deny',
        '  - action: read',
        "    resource: '**/*.key'",
        '    effect: deny',
      ].join('\n'),
    )
  })

  it('orders every allow before the deny that narrows it', () => {
    const [, frontmatter] = renderAgentMarkdown(AGENT).split('---')
    const lines = frontmatter.split('\n').map((line) => line.trim())

    const effectOf = (line: string): string | null =>
      line.startsWith('effect:') ? line.slice('effect:'.length).trim() : null
    const effects = lines
      .map(effectOf)
      .filter((effect): effect is string => effect !== null)
    expect(effects).toEqual(['allow', 'deny', 'deny'])

    // Within one action, the broad allow cannot follow the deny it narrows.
    const shellAllow = frontmatter.indexOf('  - action: shell')
    const shellDeny = frontmatter.lastIndexOf('  - action: shell')
    expect(shellAllow).toBeLessThan(shellDeny)
    expect(frontmatter.indexOf('effect: allow')).toBeLessThan(
      frontmatter.indexOf('effect: deny'),
    )
  })

  it('omits the permissions block when there are no rules', () => {
    const rendered = renderAgentMarkdown({
      id: 'bare',
      description: 'bare',
      mode: 'subagent',
      system: 'Bare.',
    })
    expect(rendered).not.toContain('permissions:')
  })

  it('single-quotes resources and doubles an embedded quote', () => {
    const rendered = renderAgentMarkdown({
      id: 'quoted',
      description: 'quoted',
      permissions: [{ action: 'shell', resource: "git commit -m 'wip'", effect: 'deny' }],
    })
    expect(rendered).toContain("    resource: 'git commit -m ''wip'''")
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
