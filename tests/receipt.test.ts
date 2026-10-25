import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rm } from 'node:fs/promises'
import { SqliteLedger } from '../src/ledger/sqlite'
import { generateReceipt, writeReceiptToDisk } from '../src/receipt'

const RUN = 'run-t4-receipt'

function uniqueDbPath(): string {
  return join(
    tmpdir(),
    `test-receipt-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  )
}

async function seedRun(ledger: SqliteLedger, id = RUN): Promise<void> {
  await ledger.createRun({
    id,
    parentId: null,
    repoId: '/test/repo',
    requestHash: 'hash',
    dataClass: 'internal',
    policyProfile: 'assisted',
    operationMode: 'assisted',
    riskClass: 'medium',
    requestText: 'Receipt aggregation test',
    budgetJson: '{}',
    deadlineAt: null,
  })
}

interface SeedFinding {
  id: string
  reviewId: string
  severity?: 'info' | 'low' | 'medium' | 'high' | 'critical'
  category?: string
  title: string
  blocking?: boolean
}

async function seedFinding(
  ledger: SqliteLedger,
  opts: SeedFinding,
): Promise<void> {
  await ledger.createReviewFinding({
    id: opts.id,
    reviewId: opts.reviewId,
    severity: opts.severity ?? 'medium',
    category: opts.category ?? 'correctness',
    title: opts.title,
    fingerprint: `fp-${opts.id}`,
    evidence: 'reproduced in test output',
    confidence: 0.9,
    blocking: opts.blocking ?? false,
  })
}

describe('generateReceipt — review findings aggregation', () => {
  let ledger: SqliteLedger
  let dbFile: string

  beforeEach(async () => {
    dbFile = uniqueDbPath()
    ledger = new SqliteLedger(dbFile)
    await seedRun(ledger)
  })

  afterEach(async () => {
    ledger.close()
    await rm(dbFile, { force: true })
    await rm(`${dbFile}-wal`, { force: true })
    await rm(`${dbFile}-shm`, { force: true })
  })

  it('fills reviewFindings run-scoped, sorted critical->info, blocking mapped', async () => {
    await seedFinding(ledger, {
      id: 'f-low',
      reviewId: RUN,
      severity: 'low',
      title: 'Minor naming nit',
    })
    await seedFinding(ledger, {
      id: 'f-critical',
      reviewId: `${RUN}:round-2`,
      severity: 'critical',
      title: 'Auth bypass',
      blocking: true,
    })
    await seedFinding(ledger, {
      id: 'f-high',
      reviewId: `${RUN}:round-1`,
      severity: 'high',
      title: 'Missing bound check',
      blocking: true,
    })
    await seedFinding(ledger, {
      id: 'f-medium',
      reviewId: RUN,
      severity: 'medium',
      title: 'Slow query',
    })

    const receipt = await generateReceipt(RUN, ledger)

    expect(receipt.reviewFindings.length).toBe(4)
    expect(receipt.reviewFindings.map((f) => f.severity)).toEqual([
      'critical',
      'high',
      'medium',
      'low',
    ])
    // blocking INTEGER 1 is normalised to a boolean in the receipt.
    expect(receipt.reviewFindings[0].blocking).toBe(true)
    expect(receipt.reviewFindings[1].blocking).toBe(true)
    expect(receipt.reviewFindings[2].blocking).toBe(false)
    expect(receipt.reviewFindings[3].blocking).toBe(false)
  })

  it('renders a non-empty Review Findings block to disk', async () => {
    await seedFinding(ledger, {
      id: 'f-render',
      reviewId: RUN,
      severity: 'high',
      title: 'Render me',
      blocking: true,
    })

    const receipt = await generateReceipt(RUN, ledger)
    const outPath = join(tmpdir(), `receipt-${Date.now()}.md`)
    await writeReceiptToDisk(receipt, outPath)
    const md = await Bun.file(outPath).text()
    await rm(outPath, { force: true })

    expect(md).toContain('## Review Findings')
    expect(md).toContain('HIGH: Render me [correctness] (BLOCKING)')
  })

  it('bars merge/completion and surfaces blocking titles plus deferred risks', async () => {
    await seedFinding(ledger, {
      id: 'f-bar',
      reviewId: RUN,
      severity: 'critical',
      title: 'Unsafe deserialise',
      blocking: true,
    })

    const receipt = await generateReceipt(RUN, ledger)

    expect(receipt.unresolvedRisks.some((r) => r.includes('BLOCKING: Unsafe deserialise'))).toBe(true)
    expect(receipt.unresolvedRisks.some((r) => r.toLowerCase().includes('barred'))).toBe(true)
    expect(receipt.unresolvedRisks.some((r) => r.startsWith('Deferred:'))).toBe(true)
  })

  it('does not bar when findings are non-blocking', async () => {
    await seedFinding(ledger, {
      id: 'f-note',
      reviewId: RUN,
      severity: 'medium',
      title: 'Just a note',
    })

    const receipt = await generateReceipt(RUN, ledger)

    expect(receipt.unresolvedRisks.some((r) => r.includes('BLOCKING:'))).toBe(false)
    expect(receipt.unresolvedRisks.some((r) => r.toLowerCase().includes('barred'))).toBe(false)
    expect(receipt.unresolvedRisks.some((r) => r.startsWith('Deferred:'))).toBe(true)
  })

  it('derives repairRounds from distinct :round-N review_id suffixes', async () => {
    await seedFinding(ledger, { id: 'f-r1a', reviewId: `${RUN}:round-1`, title: 'Round one A' })
    await seedFinding(ledger, { id: 'f-r1b', reviewId: `${RUN}:round-1`, title: 'Round one B' })
    await seedFinding(ledger, { id: 'f-r2', reviewId: `${RUN}:round-2`, title: 'Round two' })
    await seedFinding(ledger, { id: 'f-r0', reviewId: RUN, title: 'No round marker' })

    const receipt = await generateReceipt(RUN, ledger)

    expect(receipt.repairRounds).toBe(2)
  })

  it('excludes other runs and prefix lookalikes', async () => {
    await seedFinding(ledger, { id: 'f-mine', reviewId: `${RUN}:round-1`, title: 'Mine' })
    await seedFinding(ledger, { id: 'f-lookalike', reviewId: `${RUN}b:round-1`, title: 'Lookalike' })
    await seedFinding(ledger, { id: 'f-other', reviewId: 'run-other', title: 'Other run' })

    const receipt = await generateReceipt(RUN, ledger)

    expect(receipt.reviewFindings.length).toBe(1)
    expect(receipt.reviewFindings[0].title).toBe('Mine')
  })
})

describe('SqliteLedger — review finding status transition', () => {
  let ledger: SqliteLedger
  let dbFile: string

  beforeEach(async () => {
    dbFile = uniqueDbPath()
    ledger = new SqliteLedger(dbFile)
    await seedRun(ledger)
  })

  afterEach(async () => {
    ledger.close()
    await rm(dbFile, { force: true })
    await rm(`${dbFile}-wal`, { force: true })
    await rm(`${dbFile}-shm`, { force: true })
  })

  it('updates status and reflects it on the run-scoped read', async () => {
    await seedFinding(ledger, { id: 'f-status', reviewId: RUN, title: 'Transition me' })

    const before = await ledger.getReviewFindings(RUN)
    expect(before[0].status).toBe('open')

    const updated = await ledger.updateReviewFindingStatus('f-status', 'fixed')
    expect(updated).not.toBeNull()
    expect(updated!.status).toBe('fixed')

    const after = await ledger.listReviewFindingsByRun(RUN)
    expect(after[0].status).toBe('fixed')
  })

  it('returns null when the finding id is unknown', async () => {
    const missing = await ledger.updateReviewFindingStatus('does-not-exist', 'fixed')
    expect(missing).toBeNull()
  })
})
