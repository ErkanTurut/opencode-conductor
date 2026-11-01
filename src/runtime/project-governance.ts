import { createHash } from 'node:crypto'
import { isIP } from 'node:net'

export type RemoteOperation = 'push' | 'merge'
export interface ProjectPolicy {
  repository: string
  remotes: string[]
  targets: string[]
  operations: RemoteOperation[]
  requiredChecks: string[]
  previewProviders: string[]
  maxObservationAgeMs: number
}
export interface ScopedChange {
  operation: RemoteOperation
  repository: string
  remote: string
  target: string
  candidateSHA: string
}
/** Evidence must be authenticated and verified by a trusted adapter, never by an event payload. */
export interface VerifiedApproval extends ScopedChange {
  policyHash: string
  identity: string
  issuedAt: string
  expiresAt: string
  verified: true
}
export interface VerifiedObservation extends ScopedChange {
  policyHash: string
  observedAt: string
  verified: true
  remoteProtections: 'enforced' | 'unknown' | 'missing'
  checks: Record<string, 'passed' | 'failed' | 'pending'>
  preview?: { provider: string; url: string; deploymentId: string; candidateSHA: string; status: 'ready' | 'pending' | 'failed'; observedAt: string }
}
export interface GovernanceDecisionInput {
  policy: ProjectPolicy | null
  /** Independently evaluated package/user authority; project policy cannot grant it. */
  broaderAuthorityAllowed: boolean
  change: ScopedChange
  force?: boolean
  approval?: VerifiedApproval | null
  observation?: VerifiedObservation | null
  now: string
}
export interface GovernanceDecision { allowed: boolean; reasons: string[]; policyHash: string | null }

const token = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 256 && /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(v) && !v.includes('..') && !v.includes('//')
/** Conservative literal branch names only, not refspecs or Git revision expressions. */
export function isSafeBranch(value: unknown): value is string {
  return token(value) && !value.startsWith('-') && !value.endsWith('/') && !value.endsWith('.') && !value.includes('@{') && value.split('/').every(x => x && !x.startsWith('.') && !x.endsWith('.lock')) && !value.startsWith('refs/') && !value.includes(':')
}
const list = (v: unknown, validate: (x: unknown) => boolean): string[] | null =>
  Array.isArray(v) && v.length > 0 && v.every(validate) ? [...new Set(v as string[])].sort() : null

/** Returns null on absent, malformed, or incomplete policy; no permissive defaults. */
export function parseProjectPolicy(input: unknown): ProjectPolicy | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const p = input as Record<string, unknown>
  const remotes = list(p.remotes, token)
  const targets = list(p.targets, isSafeBranch)
  const operations = list(p.operations, x => x === 'push' || x === 'merge')
  const requiredChecks = list(p.requiredChecks, token)
  const previewProviders = list(p.previewProviders, token)
  if (!token(p.repository) || !remotes || !targets || !operations || !requiredChecks || !previewProviders || !Number.isSafeInteger(p.maxObservationAgeMs) || (p.maxObservationAgeMs as number) <= 0) return null
  return { repository: p.repository, remotes, targets, operations: operations as RemoteOperation[], requiredChecks, previewProviders, maxObservationAgeMs: p.maxObservationAgeMs as number }
}
export function serializeProjectPolicy(policy: ProjectPolicy): string {
  const normalized = parseProjectPolicy(policy)
  if (!normalized) throw new Error('Invalid project policy')
  return JSON.stringify(normalized)
}
export function hashProjectPolicy(policy: ProjectPolicy): string {
  return createHash('sha256').update(serializeProjectPolicy(policy)).digest('hex')
}
export function isSafePreviewUrl(value: string): boolean {
  try {
    const u = new URL(value)
    const host = u.hostname.toLowerCase().replace(/\.$/, '')
    return u.protocol === 'https:' && !u.username && !u.password && !isIP(host.replace(/^\[|\]$/g, '')) && host.includes('.') && !/(^|\.)(localhost|local|internal|test|invalid|example|home|lan)$/.test(host)
  } catch { return false }
}
const sha = (value: string) => /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value)
const time = (value: string) => typeof value === 'string' ? Date.parse(value) : NaN
const same = (a: ScopedChange, b: ScopedChange) => a.operation === b.operation && a.repository === b.repository && a.remote === b.remote && a.target === b.target && a.candidateSHA === b.candidateSHA
const fresh = (value: string, now: number, max: number) => { const t = time(value); return Number.isFinite(t) && t <= now && now - t <= max }

/** Pure gate. Call again immediately before execution with freshly verified evidence. */
export function decideProjectChange(input: GovernanceDecisionInput): GovernanceDecision {
  const reasons: string[] = []
  const p = parseProjectPolicy(input.policy)
  const hash = p ? hashProjectPolicy(p) : null
  const c = input.change
  const now = time(input.now)
  if (!p) reasons.push('missing_or_invalid_policy')
  if (input.broaderAuthorityAllowed !== true) reasons.push('broader_authority_denied')
  if (input.force) reasons.push('force_push_forbidden')
  if (!c || !token(c.repository) || !token(c.remote) || !isSafeBranch(c.target) || !sha(c.candidateSHA) || !['push', 'merge'].includes(c.operation) || !Number.isFinite(now)) reasons.push('invalid_change')
  if (!p || !c) return { allowed: false, reasons, policyHash: hash }
  if (c.repository !== p.repository || !p.remotes.includes(c.remote) || !p.targets.includes(c.target) || !p.operations.includes(c.operation)) reasons.push('change_not_in_policy')
  const a = input.approval
  if (!a || a.verified !== true || !token(a.identity) || !same(a, c) || a.policyHash !== hash || !Number.isFinite(time(a.issuedAt)) || !Number.isFinite(time(a.expiresAt)) || time(a.issuedAt) > now || time(a.expiresAt) <= now || time(a.expiresAt) <= time(a.issuedAt)) reasons.push('missing_or_invalid_approval')
  const o = input.observation
  if (!o || o.verified !== true || !same(o, c) || o.policyHash !== hash || !fresh(o.observedAt, now, p.maxObservationAgeMs)) {
    reasons.push('missing_or_stale_observation', 'remote_protections_unknown', 'missing_check', 'missing_or_invalid_preview')
  } else {
    if (o.remoteProtections !== 'enforced') reasons.push('remote_protections_unknown')
    if (!o.checks || p.requiredChecks.some(check => o.checks[check] !== 'passed')) reasons.push('missing_check')
    const v = o.preview
    if (!v || !p.previewProviders.includes(v.provider) || !token(v.deploymentId) || !isSafePreviewUrl(v.url) || v.candidateSHA !== c.candidateSHA || v.status !== 'ready' || !fresh(v.observedAt, now, p.maxObservationAgeMs)) reasons.push('missing_or_invalid_preview')
  }
  return { allowed: reasons.length === 0, reasons, policyHash: hash }
}
