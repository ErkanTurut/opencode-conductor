import { createHash } from 'node:crypto'
import { lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'

export type MemoryDecision = { decision: 'none' | 'disabled' | 'curate'; rationale: string }
export interface CuratorProposal { label: string; content: string; source_artifacts: string[]; expected_version?: number }

export function validateMemoryDecision(value: unknown): MemoryDecision | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (!['none', 'disabled', 'curate'].includes(String(v.decision)) || typeof v.rationale !== 'string') return null
  const rationale = v.rationale.trim()
  return rationale && rationale.length <= 1000 ? { decision: v.decision as MemoryDecision['decision'], rationale } : null
}

function safeDirectory(path: string): string {
  // Refuse symbolic links in any existing path component before creating or
  // writing. This is path confinement, not an OS sandbox against hostile races.
  const absolute = resolve(path)
  let current = absolute
  while (true) {
    try { if (lstatSync(current).isSymbolicLink()
      && !(process.platform === 'darwin' && ['/var', '/tmp'].includes(current) && realpathSync(current) === `/private${current}`)) throw new Error('symlink_path_refused') }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    const parent = dirname(current); if (parent === current) break; current = parent
  }
  mkdirSync(absolute, { recursive: true })
  return realpathSync(absolute)
}

/** Immutable explicit decision; repeat the same value safely after a handoff. */
export function recordMemoryDecision(runDir: string, runId: string, value: unknown): { ok: boolean; handoff?: boolean; error?: string } {
  const decision = validateMemoryDecision(value)
  if (!decision) return { ok: false, error: 'memory_decision_required: provide none|curate and a bounded rationale' }
  const root = safeDirectory(runDir), path = resolve(root, 'memory-decision.json')
  const record = { ...decision, run_id: runId, decided_at: new Date().toISOString(), provenance: 'conductor-explicit-decision' }
  try { writeFileSync(path, JSON.stringify(record, null, 2), { flag: 'wx', mode: 0o600 }) }
  catch {
    try {
      if (lstatSync(path).isSymbolicLink()) throw new Error('symlink_path_refused')
      const prior = JSON.parse(readFileSync(path, 'utf8'))
      if (prior.run_id === runId && prior.decision === decision.decision && prior.rationale === decision.rationale) return { ok: true, handoff: decision.decision === 'curate' }
    } catch { /* Never overwrite an unreadable, linked or conflicting decision. */ }
    return { ok: false, error: 'memory_decision_conflict' }
  }
  return { ok: true, handoff: decision.decision === 'curate' }
}

/** Persist evidence-linked proposed lessons, never silently promote governance. */
export function persistCuratorProposal(memoryDir: string, runDir: string, runId: string, proposal: CuratorProposal) {
  if (!proposal || !/^[a-z][a-z0-9-]{0,39}$/.test(proposal.label) || typeof proposal.content !== 'string' || !proposal.content.trim() || proposal.content.length > 5000 || !Array.isArray(proposal.source_artifacts) || !proposal.source_artifacts.length || proposal.source_artifacts.length > 10) return { ok: false as const, error: 'invalid_or_unbounded_proposal' }
  const content = proposal.content.trim()
  if (/-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----|\b(?:sk-|ghp_|github_pat_)[A-Za-z0-9_-]{12,}|\bBearer\s+\S+|\b(?:api[_-]?key|access[_-]?token|password|secret)\s*[:=]\s*\S+/i.test(content) || /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(content)) return { ok: false as const, error: 'sensitive_content_refused' }
  const runRoot = realpathSync(runDir)
  const sources: string[] = []
  for (const source of proposal.source_artifacts) {
    if (typeof source !== 'string' || !source.startsWith('artifacts/') || source.includes('..') || isAbsolute(source) || source.includes('\\') || /(?:^|\/)(?:\.env[^/]*|[^/]*\.key|\.secrets)(?:\/|$)/i.test(source)) return { ok: false as const, error: 'unsafe_source_path' }
    const path = resolve(runRoot, source)
    try {
      const real = realpathSync(path), rel = relative(runRoot, real)
      if (isAbsolute(rel) || rel.startsWith('..') || !lstatSync(real).isFile()) return { ok: false as const, error: 'source_outside_run' }
    } catch { return { ok: false as const, error: 'source_not_found' } }
    sources.push(source)
  }
  const root = safeDirectory(resolve(memoryDir, 'project'))
  if (!/^[A-Za-z0-9_-]+$/.test(runId)) return { ok: false as const, error: 'memory_path_escape' }
  const hash = `sha256:${createHash('sha256').update(content).digest('hex')}`
  let currentVersion = 0
  for (const name of readdirSync(root)) {
    if (!name.endsWith('.json')) continue
    const path = resolve(root, name)
    if (lstatSync(path).isSymbolicLink() || !lstatSync(path).isFile() || lstatSync(path).size > 64_000) continue
    let existing: Record<string, unknown>
    try { existing = JSON.parse(readFileSync(path, 'utf8')) } catch { continue }
    if (existing.label !== proposal.label) continue
    if (existing.source_run_id === runId && existing.content_hash === hash && JSON.stringify(existing.source_artifacts) === JSON.stringify(sources)) return { ok: true as const, path }
    if (existing.source_run_id === runId) return { ok: false as const, error: 'proposal_conflict' }
    if (Number.isSafeInteger(existing.version) && Number(existing.version) > currentVersion) currentVersion = Number(existing.version)
  }
  if ((proposal.expected_version ?? 0) !== currentVersion) return { ok: false as const, error: 'memory_version_conflict', current_version: currentVersion }
  const version = currentVersion + 1, path = resolve(root, `${proposal.label}-v${version}.json`)
  // Append a new version; prior evidence and review state are never overwritten.
  const record = { label: proposal.label, scope: 'project', version, source_run_id: runId, source_artifacts: sources, content_hash: hash, actor: 'memory-curator', confidence: 0.5, review_after: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10), status: 'proposed', content }
  try { writeFileSync(path, JSON.stringify(record, null, 2), { flag: 'wx', mode: 0o600 }); return { ok: true as const, path } }
  catch {
    try {
      if (lstatSync(path).isSymbolicLink()) throw new Error('symlink_path_refused')
      const existing = JSON.parse(readFileSync(path, 'utf8'))
      if (existing.source_run_id === runId && existing.content_hash === hash && JSON.stringify(existing.source_artifacts) === JSON.stringify(sources)) return { ok: true as const, path }
    } catch { /* Never replace existing memory. */ }
    return { ok: false as const, error: 'proposal_conflict' }
  }
}
