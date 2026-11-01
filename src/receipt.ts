import type { ILedger } from './ledger/interface'

// Deferred cross-task risks surfaced on every receipt until their owning work
// items land (t7: Node port + MCP scope). The t1 worktree-convention and
// merge-veto deferrals were resolved in this change: the runner and the
// .opencode plugin now share the canonical worktree module, and the receipt
// carries a merge-veto surface (ReceiptData.mergeVeto).
// License provenance: derived from OmO patterns only (idea N); SUL-1.0, no
// verbatim copy of upstream source.
const DEFERRED_RISKS: string[] = [
  'Deferred: Node.js port and `OPENCODE_BIN` pinning decision (t7)',
  'Deferred: MCP scope / Jev integration (t2/t7)',
]

// SQLite stores `blocking` as INTEGER (0/1) even though ReviewFindingRow types
// it as a boolean, so normalise both shapes without trusting either.
function isBlocking(value: boolean | number): boolean {
  return value === 1 || value === true
}

// Rounds are derived from the review_id convention (`{runId}` or
// `{runId}:round-{N}`) because there is no dedicated round column; see
// schemas/review.schema.json and ILedger.listReviewFindingsByRun.
function distinctRoundCount(runId: string, reviewIds: string[]): number {
  const prefix = `${runId}:round-`
  const rounds = new Set<number>()
  for (const reviewId of reviewIds) {
    if (!reviewId.startsWith(prefix)) continue
    const n = Number.parseInt(reviewId.slice(prefix.length), 10)
    if (Number.isInteger(n)) rounds.add(n)
  }
  return rounds.size
}

export interface ReceiptData {
  runId: string
  objective: string
  riskClass: string
  state: string
  startedAt: string
  finishedAt: string | null
  changedFiles: string[]
  verificationResults: Array<{
    command: string
    exitCode: number
    passed: boolean
  }>
  reviewFindings: Array<{
    severity: string
    category: string
    title: string
    blocking: boolean
  }>
  modelUsage: Array<{
    provider: string
    model: string
    role: string
    tokens: number | null
  }>
  unresolvedRisks: string[]
  /**
   * Merge candidates blocked before any merge attempt: `repo_id_mismatch`
   * means the entry's `repo_id` is not the run id, so the entry is not in this
   * run's repo scope. Surface only — no merge consumer reads this yet.
   */
  mergeVeto: Array<{
    mergeEntryId: string
    repoId: string
    candidateBranch: string
    reason: 'repo_id_mismatch'
  }>
  repairRounds: number
  totalAttempts: number
  totalCost: string | null
  terminalReason: string | null
}

export async function generateReceipt(
  runId: string,
  ledger: ILedger,
): Promise<ReceiptData> {
  const run = await ledger.getRun(runId)
  if (!run) throw new Error(`Run ${runId} not found`)

  const workItems = await ledger.listWorkItems(runId)
  const events = await ledger.getEvents(runId)
  const findings = await ledger.listReviewFindingsByRun(runId)

  const changedFiles: string[] = []
  const verificationResults: ReceiptData['verificationResults'] = []
  const reviewFindings: ReceiptData['reviewFindings'] = []
  const modelUsage: ReceiptData['modelUsage'] = []
  let repairRounds = 0
  let totalAttempts = 0

  for (const item of workItems) {
    totalAttempts += item.attempts
    const attempt = await ledger.getLatestAttempt(item.id)
    if (attempt) {
      if (attempt.evidence_json) {
        const evidence = JSON.parse(attempt.evidence_json)
        if (evidence.changed_files) {
          changedFiles.push(...evidence.changed_files)
        }
      }
      if (attempt.model_provider && attempt.model_id) {
        modelUsage.push({
          provider: attempt.model_provider,
          model: attempt.model_id,
          role: item.owner_role,
          tokens: attempt.usage_json
            ? (JSON.parse(attempt.usage_json).total_tokens ?? null)
            : null,
        })
      }

      const verifications = await ledger.getVerifications(attempt.id)
      for (const v of verifications) {
        verificationResults.push({
          command: v.command,
          exitCode: v.exit_code,
          passed: v.exit_code === 0,
        })
      }
    }
  }

  // Review findings, run-scoped (exact run id or `{runId}:round-N`).
  const unresolvedRisks: string[] = []
  for (const f of findings) {
    const blocking = isBlocking(f.blocking)
    reviewFindings.push({
      severity: f.severity,
      category: f.category,
      title: f.title,
      blocking,
    })
    if (blocking) unresolvedRisks.push(`BLOCKING: ${f.title}`)
  }
  if (reviewFindings.some((f) => f.blocking)) {
    unresolvedRisks.push(
      'Merge and run completion are barred while blocking review findings remain unresolved.',
    )
  }
  unresolvedRisks.push(...DEFERRED_RISKS)

  // Merge-veto surface (resolves the t1 deferral): a pending merge entry whose
  // `repo_id` is not the run id cannot belong to this run's repo scope, so it
  // is listed as a blocked candidate. Nothing consumes this yet — a later task
  // wires the merge gate to it.
  const mergeVeto: ReceiptData['mergeVeto'] = []
  try {
    const pendingMerges = await ledger.listPendingMergeEntries(run.repo_id)
    for (const entry of pendingMerges) {
      if (entry.repo_id === runId) continue
      mergeVeto.push({
        mergeEntryId: entry.id,
        repoId: entry.repo_id,
        candidateBranch: entry.candidate_branch,
        reason: 'repo_id_mismatch',
      })
    }
  } catch {
    // Ledger without merge entries: no veto candidates to surface.
  }

  const legacyRepairRounds = events.filter(
    (e) => e.event_type === 'repair_started',
  ).length
  // Round count comes from the review_id convention (no round column), with
  // legacy repair_* events as a fallback for runs without round markers.
  const reviewRounds = distinctRoundCount(
    runId,
    findings.map((f) => f.review_id),
  )
  repairRounds = reviewRounds > 0 ? reviewRounds : legacyRepairRounds

  return {
    runId,
    objective: run.request_text,
    riskClass: run.risk_class,
    state: run.state,
    startedAt: run.created_at,
    finishedAt: run.updated_at,
    changedFiles: [...new Set(changedFiles)],
    verificationResults,
    reviewFindings,
    modelUsage,
    unresolvedRisks,
    mergeVeto,
    repairRounds,
    totalAttempts,
    totalCost: null,
    terminalReason: run.terminal_reason,
  }
}

export async function writeReceiptToDisk(
  receipt: ReceiptData,
  path: string,
): Promise<void> {
  const markdown = formatReceiptAsMarkdown(receipt)
  safeWriteArtifact(path, markdown)
}

function formatReceiptAsMarkdown(receipt: ReceiptData): string {
  const lines: string[] = [
    `# Run Receipt: ${receipt.runId}`,
    '',
    `**Objective:** ${receipt.objective}`,
    `**Risk Class:** ${receipt.riskClass}`,
    `**Final State:** ${receipt.state}`,
    `**Started:** ${receipt.startedAt}`,
    `**Finished:** ${receipt.finishedAt ?? 'N/A'}`,
    `**Total Attempts:** ${receipt.totalAttempts}`,
    `**Repair Rounds:** ${receipt.repairRounds}`,
    '',
  ]

  if (receipt.terminalReason) {
    lines.push(`**Terminal Reason:** ${receipt.terminalReason}`, '')
  }

  if (receipt.modelUsage.length) {
    lines.push('## Model Usage', '')
    for (const u of receipt.modelUsage) {
      lines.push(
        `- ${u.role}: ${u.provider}/${u.model}${u.tokens ? ` (${u.tokens} tokens)` : ''}`,
      )
    }
    lines.push('')
  }

  if (receipt.verificationResults.length) {
    lines.push('## Verification Results', '')
    for (const v of receipt.verificationResults) {
      const icon = v.passed ? 'PASS' : 'FAIL'
      lines.push(`- [${icon}] \`${v.command}\` (exit ${v.exitCode})`)
    }
    lines.push('')
  }

  if (receipt.changedFiles.length) {
    lines.push('## Changed Files', '')
    for (const f of receipt.changedFiles) {
      lines.push(`- ${f}`)
    }
    lines.push('')
  }

  if (receipt.reviewFindings.length) {
    lines.push('## Review Findings', '')
    for (const f of receipt.reviewFindings) {
      lines.push(
        `- ${f.severity.toUpperCase()}: ${f.title} [${f.category}]${f.blocking ? ' (BLOCKING)' : ''}`,
      )
    }
    lines.push('')
  }

  if (receipt.unresolvedRisks.length) {
    lines.push('## Unresolved Risks', '')
    for (const r of receipt.unresolvedRisks) {
      lines.push(`- ${r}`)
    }
    lines.push('')
  }

  if (receipt.mergeVeto?.length) {
    lines.push('## Merge Veto', '')
    for (const v of receipt.mergeVeto) {
      lines.push(
        `- BLOCKED ${v.mergeEntryId} (${v.candidateBranch}): ${v.reason} (repo "${v.repoId}")`,
      )
    }
    lines.push('')
  }

  return lines.join('\n')
}
import { safeWriteArtifact } from './runtime/safe-write'
