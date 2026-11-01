/** Legacy fields are optional because old records are not evidence of review. */
export interface MemoryReviewRecord {
  label: string
  version?: string | number
  scope?: string
  status?: string
  confidence?: number
  reviewAfter?: string
  sourceRunId?: string
  sourceArtifacts?: string[]
  contentHash?: string
  supersedes?: string
}
export type MemoryClassification = 'approved' | 'unknown' | 'unreviewed' | 'stale' | 'conflicting'
export interface MemoryReviewResult { classification: MemoryClassification; eligible: boolean; reasons: string[]; action: 'use' | 'propose_review' }
/** Trusted caller supplies current content and source fingerprints, not values copied from the record. */
export interface MemoryEvidence {
  contentHash: string
  sourceRunId: string
  sourceArtifacts: string[]
}
export function reviewMemory(record: MemoryReviewRecord, evidence: MemoryEvidence | null, now: string): MemoryReviewResult {
  const result = (classification: MemoryClassification, reasons: string[]): MemoryReviewResult => ({ classification, eligible: classification === 'approved', reasons, action: classification === 'approved' ? 'use' : 'propose_review' })
  if (record.status !== 'approved') return result('unreviewed', ['not_explicitly_approved'])
  const date = Date.parse(record.reviewAfter ?? '')
  const current = Date.parse(now)
  if (!Number.isFinite(date) || !Number.isFinite(current) || !record.label || !record.scope || record.version == null || !record.sourceRunId || !record.contentHash || !Array.isArray(record.sourceArtifacts) || record.sourceArtifacts.length === 0 || record.sourceArtifacts.some(x => typeof x !== 'string' || !x) || typeof record.confidence !== 'number' || !Number.isFinite(record.confidence) || record.confidence < 0 || record.confidence > 1 || !evidence) return result('unknown', ['missing_or_invalid_provenance'])
  if (date <= current) return result('stale', ['review_due'])
  const sources = (items: string[]) => JSON.stringify([...items].sort())
  if (record.contentHash !== evidence.contentHash || record.sourceRunId !== evidence.sourceRunId || sources(record.sourceArtifacts) !== sources(evidence.sourceArtifacts)) return result('conflicting', ['provenance_changed'])
  return result('approved', [])
}
/** Reviews a complete candidate set. Versions are unique within label/scope; an
 * explicit supersession suppresses only its direct predecessor, never a conflict. */
export function reviewMemorySet(records: MemoryReviewRecord[], evidence: Array<MemoryEvidence | null>, now: string): MemoryReviewResult[] {
  const results = records.map((record, i) => reviewMemory(record, evidence[i] ?? null, now))
  // Compare against the original eligible set, so a conflict cannot hide a
  // third contradictory candidate during pairwise iteration.
  const eligible = results.map(result => result.eligible)
  const superseded = new Set<number>()
  const conflicts = new Set<number>()
  for (let i = 0; i < records.length; i++) {
    for (let j = i + 1; j < records.length; j++) {
      const a = records[i], b = records[j]
      if (a.label !== b.label || a.scope !== b.scope || !eligible[i] || !eligible[j]) continue
      const av = String(a.version), bv = String(b.version)
      const aSupersedes = a.supersedes === bv && av !== bv
      const bSupersedes = b.supersedes === av && av !== bv
      if (aSupersedes !== bSupersedes) superseded.add(aSupersedes ? j : i)
      else if (a.contentHash !== b.contentHash || av === bv || (aSupersedes && bSupersedes)) {
        conflicts.add(i)
        conflicts.add(j)
      }
    }
  }
  for (const i of superseded) results[i] = { classification: 'stale', eligible: false, reasons: ['superseded'], action: 'propose_review' }
  for (const i of conflicts) results[i] = { classification: 'conflicting', eligible: false, reasons: ['contradictory_candidates'], action: 'propose_review' }
  return results
}
