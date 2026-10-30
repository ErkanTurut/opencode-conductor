// Read-only artifact reader for one run directory plus the project memory tree.
//
// Every path is resolved INSIDE a caller-supplied root and re-checked after
// `realpath`, so a crafted run id, task id or contract `requirements_path`
// cannot read outside the run directory (or outside the memory directory), and
// a symlink planted in the tree cannot escape it either. Everything fails soft:
// a missing, unreadable, oversized or malformed file is `null`/empty, never a
// thrown error, and nothing here writes.
//
// Import note: extensionless specifiers (the package's `tsc --noEmit` baseline
// rejects `.ts`-suffixed imports).
import {
  closeSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
  statSync,
  type Dirent,
} from 'node:fs'
import { isAbsolute, join, resolve, sep } from 'node:path'

/** Hard cap for any single artifact read (512 KiB). */
export const MAX_ARTIFACT_BYTES = 512 * 1024

/** Upper bound on the memory tree walk, so a pathological tree cannot hang. */
const MAX_MEMORY_FILES = 5000
const MAX_MEMORY_DEPTH = 8

export interface ArtifactRead {
  /** Root-relative path that was read, or null when nothing was read. */
  path: string | null
  content: string | null
  truncated: boolean
}

export interface RequirementsArtifact extends ArtifactRead {
  /** Every candidate that was tried, in order (diagnostics only). */
  candidates: string[]
}

export function emptyArtifact(): ArtifactRead {
  return { path: null, content: null, truncated: false }
}

// ---------------------------------------------------------------------------
// Path safety
// ---------------------------------------------------------------------------

/** One path segment (`run-…`, `wi-…`, `task.json`): no separators, no `..`. */
export function isSafePathSegment(value: unknown): value is string {
  if (typeof value !== 'string') return false
  if (value.length === 0 || value.length > 256) return false
  if (value.includes('\0') || value.includes('/') || value.includes('\\')) return false
  if (value === '.' || value === '..') return false
  return true
}

/**
 * Split a contract-supplied relative path into validated segments. Rejects
 * absolute paths, `..`, empty segments and NUL bytes; accepts subdirectories.
 */
export function safeRelativeSegments(value: unknown): string[] | null {
  if (typeof value !== 'string') return null
  if (value.length === 0 || value.length > 1024) return null
  if (value.includes('\0') || value.includes('\\')) return null
  if (isAbsolute(value) || value.startsWith('/')) return null
  const segments = value.split('/')
  for (const segment of segments) {
    if (!isSafePathSegment(segment)) return null
  }
  return segments
}

function resolveInside(root: string, segments: readonly string[]): string | null {
  try {
    const rootAbs = resolve(root)
    const target = resolve(rootAbs, ...segments)
    if (target !== rootAbs && !target.startsWith(`${rootAbs}${sep}`)) return null
    return target
  } catch {
    return null
  }
}

/**
 * Realpath containment. Returns the canonical target only when it is a regular
 * file below the canonical root; a symlink escape, a directory, a missing root
 * or a missing target all resolve to null.
 */
function containedFile(root: string, target: string): string | null {
  let rootReal: string
  let targetReal: string
  try {
    rootReal = realpathSync(root)
    targetReal = realpathSync(target)
  } catch {
    return null
  }
  if (targetReal !== rootReal && !targetReal.startsWith(`${rootReal}${sep}`)) {
    return null
  }
  try {
    if (!statSync(targetReal).isFile()) return null
  } catch {
    return null
  }
  return targetReal
}

function readCappedFile(
  path: string,
  maxBytes: number = MAX_ARTIFACT_BYTES,
): { content: string; truncated: boolean } | null {
  let fd: number | null = null
  try {
    const stat = statSync(path)
    if (!stat.isFile()) return null
    const bytes = Math.min(stat.size, maxBytes)
    const buffer = Buffer.alloc(bytes)
    fd = openSync(path, 'r')
    let offset = 0
    while (offset < bytes) {
      const read = readSync(fd, buffer, offset, bytes - offset, offset)
      if (read <= 0) break
      offset += read
    }
    return {
      content: buffer.subarray(0, offset).toString('utf8'),
      truncated: stat.size > maxBytes,
    }
  } catch {
    return null
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd)
      } catch {
        // Best effort; a failed close must not fail the read.
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Run directory
// ---------------------------------------------------------------------------

/** Resolve `runsDir/<runId>` when it is an existing directory inside `runsDir`. */
export function runDirectory(runsDir: string, runId: unknown): string | null {
  if (!isSafePathSegment(runId)) return null
  const target = resolveInside(runsDir, [runId])
  if (!target) return null
  try {
    if (!statSync(target).isDirectory()) return null
  } catch {
    return null
  }
  // A run dir symlinked outside the runs root is not a run dir.
  try {
    const rootReal = realpathSync(runsDir)
    const targetReal = realpathSync(target)
    if (targetReal !== rootReal && !targetReal.startsWith(`${rootReal}${sep}`)) {
      return null
    }
    return target
  } catch {
    return null
  }
}

/** Read a root-relative artifact (validated segments, symlink-contained). */
export function readArtifact(root: string, relativePath: unknown): ArtifactRead {
  const segments = safeRelativeSegments(relativePath)
  if (!segments) return emptyArtifact()
  const target = resolveInside(root, segments)
  if (!target) return emptyArtifact()
  const file = containedFile(root, target)
  if (!file) return emptyArtifact()
  const read = readCappedFile(file)
  if (!read) return emptyArtifact()
  return { path: segments.join('/'), content: read.content, truncated: read.truncated }
}

/** Read one top-level file of a run directory (`run.json`, `receipt.md`, …). */
export function readRunArtifact(runDir: string, name: unknown): ArtifactRead {
  if (!isSafePathSegment(name)) return emptyArtifact()
  return readArtifact(runDir, name)
}

/** Read `tasks/<taskId>/<name>` (`task.json`, `evidence.json`, `review.json`). */
export function readTaskArtifact(
  runDir: string,
  taskId: unknown,
  name: unknown,
): ArtifactRead {
  if (!isSafePathSegment(taskId) || !isSafePathSegment(name)) return emptyArtifact()
  return readArtifact(runDir, `tasks/${taskId}/${name}`)
}

export interface JsonArtifact<T = unknown> {
  path: string | null
  value: T | null
  truncated: boolean
}

/** Read and parse a JSON artifact without ever throwing on malformed JSON. */
export function readJsonArtifact<T = unknown>(
  runDir: string,
  name: unknown,
): JsonArtifact<T> {
  const read = readRunArtifact(runDir, name)
  if (read.content === null) return { path: read.path, value: null, truncated: read.truncated }
  try {
    return {
      path: read.path,
      value: JSON.parse(read.content) as T,
      truncated: read.truncated,
    }
  } catch {
    return { path: read.path, value: null, truncated: read.truncated }
  }
}

/** True when `runsDir/<runId>/<name>` is a readable regular file inside the run dir. */
export function runArtifactExists(runsDir: string, runId: unknown, name: unknown): boolean {
  if (!isSafePathSegment(runId) || !isSafePathSegment(name)) return false
  const dir = runDirectory(runsDir, runId)
  if (!dir) return false
  return containedFile(dir, join(dir, name)) !== null
}

/** `receipt.md` presence, used for `RunSummary.hasReceipt`. */
export function hasReceiptFile(runsDir: string, runId: unknown): boolean {
  return runArtifactExists(runsDir, runId, 'receipt.md')
}

// ---------------------------------------------------------------------------
// Requirements
// ---------------------------------------------------------------------------

function contractRequirementsPath(contract: unknown): string | null {
  if (typeof contract !== 'object' || contract === null) return null
  const refinement = (contract as Record<string, unknown>).refinement
  if (typeof refinement !== 'object' || refinement === null) return null
  const path = (refinement as Record<string, unknown>).requirements_path
  return typeof path === 'string' && path.trim().length > 0 ? path.trim() : null
}

/**
 * Locate the requirements markdown for a run.
 *
 * Order: the contract's `refinement.requirements_path`, then `requirements.md`,
 * then `artifacts/requirements/requirements.md`. A candidate that is unsafe or
 * unreadable is skipped; the first readable one wins.
 */
export function readRequirements(runDir: string, contract: unknown): RequirementsArtifact {
  const candidates: string[] = []
  const contractPath = contractRequirementsPath(contract)
  if (contractPath) candidates.push(contractPath)
  candidates.push('requirements.md', 'artifacts/requirements/requirements.md')

  const tried: string[] = []
  for (const candidate of candidates) {
    if (tried.includes(candidate)) continue
    tried.push(candidate)
    const read = readArtifact(runDir, candidate)
    if (read.content !== null) {
      return { ...read, candidates: tried }
    }
  }
  return { ...emptyArtifact(), candidates: tried }
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

export interface MemoryBlockRecord {
  label: string
  scope: string
  version: number
  sourceRunId: string | null
  sourceArtifacts: string[]
  content: string
  contentHash: string | null
  actor: string | null
  confidence: number | null
  reviewAfter: string | null
  status: string
  supersedes: string | null
  /** Absolute file path the block was parsed from (diagnostics only). */
  path: string
  updatedAt: string | null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : []
}

function parseMemoryBlock(value: unknown, path: string): MemoryBlockRecord | null {
  const record = asRecord(value)
  if (!record) return null
  const label = stringOrNull(record.label)
  if (!label || label.trim().length === 0) return null
  const version = numberOrNull(record.version)
  let updatedAt: string | null = null
  try {
    updatedAt = statSync(path).mtime.toISOString()
  } catch {
    updatedAt = null
  }
  return {
    label,
    scope: stringOrNull(record.scope) ?? 'project',
    version: version !== null && version >= 1 ? Math.floor(version) : 1,
    sourceRunId: stringOrNull(record.source_run_id),
    sourceArtifacts: stringArray(record.source_artifacts),
    content: stringOrNull(record.content) ?? '',
    contentHash: stringOrNull(record.content_hash),
    actor: stringOrNull(record.actor),
    confidence: numberOrNull(record.confidence),
    reviewAfter: stringOrNull(record.review_after),
    status: stringOrNull(record.status) ?? 'active',
    supersedes: stringOrNull(record.supersedes),
    path,
    updatedAt,
  }
}

function isJsonFile(name: string): boolean {
  return name.toLowerCase().endsWith('.json')
}

/**
 * Recursively read `<memoryDir>/**\/*.json` as memory blocks.
 *
 * Symlinked files and directories are skipped (a symlink could point outside
 * the memory tree), malformed JSON is ignored, and the walk is bounded in both
 * depth and file count. Sorted label ascending, version descending.
 */
export function readMemoryBlocks(memoryDir: string): MemoryBlockRecord[] {
  const blocks: MemoryBlockRecord[] = []
  let files = 0

  const walk = (dir: string, depth: number): void => {
    if (depth > MAX_MEMORY_DEPTH || files >= MAX_MEMORY_FILES) return
    let entries: Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (files >= MAX_MEMORY_FILES) return
      if (entry.isSymbolicLink()) continue
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(path, depth + 1)
        continue
      }
      if (!entry.isFile() || !isJsonFile(entry.name)) continue
      files += 1
      let raw: string
      try {
        const read = readCappedFile(path)
        if (!read || read.truncated) continue
        raw = read.content
      } catch {
        continue
      }
      try {
        const block = parseMemoryBlock(JSON.parse(raw) as unknown, path)
        if (block) blocks.push(block)
      } catch {
        // Malformed JSON is not a memory block.
      }
    }
  }

  try {
    if (!statSync(memoryDir).isDirectory()) return []
  } catch {
    return []
  }
  walk(memoryDir, 0)
  return sortMemoryBlocks(blocks)
}

/** Label ascending, version descending, then path for a deterministic tie. */
export function sortMemoryBlocks(blocks: readonly MemoryBlockRecord[]): MemoryBlockRecord[] {
  return [...blocks].sort((a, b) => {
    if (a.label !== b.label) return a.label < b.label ? -1 : 1
    if (a.version !== b.version) return b.version - a.version
    if (a.path !== b.path) return a.path < b.path ? -1 : 1
    return 0
  })
}

/**
 * One block by label. With `version` omitted (or null) the highest version wins.
 * A missing/unreadable directory resolves to null.
 */
export function readMemoryBlock(
  memoryDir: string,
  label: string,
  version?: number | null,
): MemoryBlockRecord | null {
  if (typeof label !== 'string' || label.length === 0) return null
  const wantedVersion =
    typeof version === 'number' && Number.isFinite(version) ? Math.floor(version) : null
  const blocks = readMemoryBlocks(memoryDir)
  for (const block of blocks) {
    if (block.label !== label) continue
    if (wantedVersion !== null && block.version !== wantedVersion) continue
    // Sorted version-desc: the first match for a label is the newest version.
    return block
  }
  return null
}
