import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import {
  mkdirSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import {
  MAX_ARTIFACT_BYTES,
  emptyArtifact,
  hasReceiptFile,
  isSafePathSegment,
  readArtifact,
  readJsonArtifact,
  readMemoryBlock,
  readMemoryBlocks,
  readRequirements,
  readRunArtifact,
  readTaskArtifact,
  runArtifactExists,
  runDirectory,
  safeRelativeSegments,
} from '../../src/read/artifacts'
import { tempProject, type TempProject } from './seed'

let project: TempProject
let runDir: string

function write(path: string, content: string): void {
  const parts = path.split('/')
  const dir = join(runDir, ...parts.slice(0, -1))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(runDir, path), content)
}

beforeEach(() => {
  project = tempProject('artifacts')
  runDir = join(project.layout.runsDir, 'run-artifacts')
  mkdirSync(runDir, { recursive: true })
  write('run.json', '{"run_id":"run-artifacts"}')
  write('plan.json', '{"tasks":[]}')
  write('task-dag.json', '{"nodes":[]}')
  write('contract.json', '{"refinement":{"requirements_path":"custom/req.md"}}')
  write('requirements.md', '# Requirements\n')
  write('receipt.md', '# Receipt\n')
  write('tasks/task-1/task.json', '{"task_id":"task-1"}')
  write('tasks/task-1/evidence.json', '{"hash":"abc"}')
  write('tasks/task-1/review.json', '{"findings":[]}')
})

afterEach(() => {
  project.cleanup()
})

describe('artifacts — safe path segments', () => {
  it('rejects traversal, absolute and separator-bearing segments', () => {
    expect(isSafePathSegment('run-1')).toBe(true)
    expect(isSafePathSegment('..')).toBe(false)
    expect(isSafePathSegment('.')).toBe(false)
    expect(isSafePathSegment('a/b')).toBe(false)
    expect(isSafePathSegment('a\\b')).toBe(false)
    expect(isSafePathSegment('')).toBe(false)
    expect(isSafePathSegment(null)).toBe(false)
    expect(safeRelativeSegments('a/b.json')).toEqual(['a', 'b.json'])
    expect(safeRelativeSegments('../a')).toBeNull()
    expect(safeRelativeSegments('/etc/passwd')).toBeNull()
    expect(safeRelativeSegments('a//b')).toBeNull()
    expect(safeRelativeSegments('a/./b')).toBeNull()
  })
})

describe('artifacts — run directory files', () => {
  it('reads the top-level run artifacts', () => {
    expect(readRunArtifact(runDir, 'run.json').content).toBe('{"run_id":"run-artifacts"}')
    expect(readRunArtifact(runDir, 'plan.json').content).toBe('{"tasks":[]}')
    expect(readRunArtifact(runDir, 'task-dag.json').content).toBe('{"nodes":[]}')
    expect(readRunArtifact(runDir, 'contract.json').path).toBe('contract.json')
    expect(readRunArtifact(runDir, 'receipt.md').content).toBe('# Receipt\n')
    expect(readRunArtifact(runDir, 'missing.json')).toEqual(emptyArtifact())
  })

  it('reads parsed JSON and keeps the path on malformed content', () => {
    const parsed = readJsonArtifact<{ run_id: string }>(runDir, 'run.json')
    expect(parsed.value?.run_id).toBe('run-artifacts')
    expect(parsed.truncated).toBe(false)
    write('bad.json', '{not json')
    const bad = readJsonArtifact(runDir, 'bad.json')
    expect(bad.path).toBe('bad.json')
    expect(bad.value).toBeNull()
  })

  it('reads per-task artifacts', () => {
    expect(readTaskArtifact(runDir, 'task-1', 'task.json').content).toBe('{"task_id":"task-1"}')
    expect(readTaskArtifact(runDir, 'task-1', 'evidence.json').content).toBe('{"hash":"abc"}')
    expect(readTaskArtifact(runDir, 'task-1', 'review.json').content).toBe('{"findings":[]}')
    expect(readTaskArtifact(runDir, 'task-1', 'nope.json').content).toBeNull()
    expect(readTaskArtifact(runDir, '../escape', 'task.json').content).toBeNull()
  })

  it('rejects traversal and absolute paths', () => {
    writeFileSync(join(project.root, 'secret.txt'), 'secret')
    expect(readRunArtifact(runDir, '../secret.txt').content).toBeNull()
    expect(readArtifact(runDir, '../secret.txt').content).toBeNull()
    expect(readRunArtifact(runDir, '/etc/passwd').content).toBeNull()
    expect(readArtifact(runDir, 'tasks/../../secret.txt').content).toBeNull()
  })

  it('rejects a symlink that escapes the run directory', () => {
    const outside = join(project.root, 'outside.txt')
    writeFileSync(outside, 'outside')
    try {
      symlinkSync(outside, join(runDir, 'escape.txt'))
    } catch {
      return // Platform without symlink support: nothing to assert.
    }
    expect(readRunArtifact(runDir, 'escape.txt').content).toBeNull()
  })

  it('caps large artifacts and reports truncation', () => {
    write('big.txt', 'x'.repeat(MAX_ARTIFACT_BYTES + 100))
    const read = readRunArtifact(runDir, 'big.txt')
    expect(read.truncated).toBe(true)
    expect(read.content?.length).toBe(MAX_ARTIFACT_BYTES)
    write('edge.txt', 'y'.repeat(MAX_ARTIFACT_BYTES))
    const edge = readRunArtifact(runDir, 'edge.txt')
    expect(edge.truncated).toBe(false)
    expect(edge.content?.length).toBe(MAX_ARTIFACT_BYTES)
  })

  it('resolves and validates the run directory', () => {
    expect(runDirectory(project.layout.runsDir, 'run-artifacts')).toBe(runDir)
    expect(runDirectory(project.layout.runsDir, '../')).toBeNull()
    expect(runDirectory(project.layout.runsDir, 'missing')).toBeNull()
    expect(runArtifactExists(project.layout.runsDir, 'run-artifacts', 'receipt.md')).toBe(true)
    expect(runArtifactExists(project.layout.runsDir, 'run-artifacts', 'nope.md')).toBe(false)
    expect(hasReceiptFile(project.layout.runsDir, 'run-artifacts')).toBe(true)
    expect(hasReceiptFile(project.layout.runsDir, 'missing')).toBe(false)
  })

  it('fails soft on a missing run directory', () => {
    const missing = join(project.layout.runsDir, 'nope')
    expect(readRunArtifact(missing, 'run.json')).toEqual(emptyArtifact())
    expect(readRequirements(missing, null).content).toBeNull()
  })
})

describe('artifacts — requirements resolution order', () => {
  it('prefers the contract requirements_path', () => {
    write('custom/req.md', '# Custom\n')
    const result = readRequirements(runDir, {
      refinement: { requirements_path: 'custom/req.md' },
    })
    expect(result.path).toBe('custom/req.md')
    expect(result.content).toBe('# Custom\n')
  })

  it('falls back to requirements.md', () => {
    const result = readRequirements(runDir, {
      refinement: { requirements_path: 'custom/missing.md' },
    })
    expect(result.path).toBe('requirements.md')
    expect(result.content).toBe('# Requirements\n')
  })

  it('falls back to artifacts/requirements/requirements.md', () => {
    write('artifacts/requirements/requirements.md', '# Nested\n')
    const result = readRequirements(runDir, null)
    expect(result.path).toBe('requirements.md') // plain file still wins
    const onlyNested = join(project.layout.runsDir, 'run-nested')
    mkdirSync(join(onlyNested, 'artifacts/requirements'), { recursive: true })
    writeFileSync(join(onlyNested, 'artifacts/requirements/requirements.md'), '# Nested\n')
    const nested = readRequirements(onlyNested, null)
    expect(nested.path).toBe('artifacts/requirements/requirements.md')
    expect(nested.content).toBe('# Nested\n')
  })

  it('ignores an unsafe requirements_path and records the candidates tried', () => {
    const result = readRequirements(runDir, {
      refinement: { requirements_path: '../../etc/passwd' },
    })
    expect(result.path).toBe('requirements.md')
    expect(result.candidates).toContain('../../etc/passwd')
  })
})

describe('artifacts — memory tree', () => {
  const memoryDir = () => project.layout.memoryDir

  function writeMemory(relative: string, block: unknown): void {
    const path = join(memoryDir(), relative)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, JSON.stringify(block))
  }

  it('recursively reads blocks and sorts label asc / version desc', () => {
    writeMemory('a/alpha.v1.json', {
      label: 'alpha',
      version: 1,
      scope: 'project',
      content: 'alpha one',
      status: 'active',
    })
    writeMemory('alpha.v2.json', {
      label: 'alpha',
      version: 2,
      scope: 'project',
      content: 'alpha two',
      status: 'active',
      confidence: 0.8,
      review_after: '2026-12-01',
      source_run_id: 'run-1',
      source_artifacts: ['runs/run-1/receipt.md'],
      content_hash: 'sha256:abc',
      actor: 'memory-curator',
      supersedes: 'alpha.v1',
    })
    writeMemory('zeta.v1.json', { label: 'zeta', version: 1, content: 'zeta' })

    const blocks = readMemoryBlocks(memoryDir())
    expect(blocks.map((block) => `${block.label}.v${block.version}`)).toEqual([
      'alpha.v2',
      'alpha.v1',
      'zeta.v1',
    ])
    const latest = blocks[0]
    expect(latest.content).toBe('alpha two')
    expect(latest.confidence).toBe(0.8)
    expect(latest.reviewAfter).toBe('2026-12-01')
    expect(latest.sourceRunId).toBe('run-1')
    expect(latest.sourceArtifacts).toEqual(['runs/run-1/receipt.md'])
    expect(latest.contentHash).toBe('sha256:abc')
    expect(latest.actor).toBe('memory-curator')
    expect(latest.supersedes).toBe('alpha.v1')
    expect(latest.updatedAt).not.toBeNull()
  })

  it('skips malformed JSON and blocks without a label', () => {
    const path = join(memoryDir(), 'bad.json')
    writeFileSync(path, '{nope')
    writeMemory('nolabel.json', { version: 1, content: 'x' })
    writeMemory('ok.json', { label: 'ok', version: 1 })
    expect(readMemoryBlocks(memoryDir()).map((block) => block.label)).toEqual(['ok'])
  })

  it('reads one block by label and optional version', () => {
    writeMemory('one.v1.json', { label: 'one', version: 1, content: 'v1' })
    writeMemory('one.v2.json', { label: 'one', version: 2, content: 'v2' })
    expect(readMemoryBlock(memoryDir(), 'one')).not.toBeNull()
    expect(readMemoryBlock(memoryDir(), 'one')!.version).toBe(2)
    expect(readMemoryBlock(memoryDir(), 'one', 1)!.content).toBe('v1')
    expect(readMemoryBlock(memoryDir(), 'one', 9)).toBeNull()
    expect(readMemoryBlock(memoryDir(), 'nope')).toBeNull()
    expect(readMemoryBlock(join(project.root, 'absent'), 'one')).toBeNull()
  })

  it('ignores files that are not .json and symlinks', () => {
    writeFileSync(join(memoryDir(), 'notes.txt'), 'ignored')
    writeMemory('real.json', { label: 'real', version: 1 })
    try {
      symlinkSync(join(memoryDir(), 'real.json'), join(memoryDir(), 'link.json'))
    } catch {
      // Symlinks unavailable: the assertion below still holds for the real file.
    }
    const labels = readMemoryBlocks(memoryDir()).map((block) => block.label)
    expect(labels).toEqual(['real'])
  })

  it('returns an empty list when the memory directory is missing', () => {
    expect(readMemoryBlocks(join(project.root, 'absent'))).toEqual([])
  })
})
