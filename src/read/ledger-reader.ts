// Read-only ledger projection source for the Conductor GUI RPC surface.
//
// This is NOT a second ledger and it is not an authority: it opens the existing
// SQLite file with `{ readonly: true }`, never migrates, never runs a writing
// PRAGMA and never creates the file. A missing, unreadable or legacy database
// degrades to empty results, because a read-only panel must never be able to
// take the server down or invent state.
//
// Import note: extensionless specifiers, matching `runtime/*` and `register/*`
// (the package's `tsc --noEmit` baseline rejects `.ts`-suffixed imports).
import { Database } from 'bun:sqlite'
import { existsSync } from 'node:fs'
import { TERMINAL_STATES } from '../types'

// ---------------------------------------------------------------------------
// Records (parsed, camelCase views of the ledger columns)
// ---------------------------------------------------------------------------

export interface LedgerRunRecord {
  id: string
  parentId: string | null
  repoId: string
  dataClass: string
  policyProfile: string
  operationMode: string
  state: string
  riskClass: string
  objective: string
  contract: unknown
  plan: unknown
  budget: unknown
  hasReceipt: boolean
  createdAt: string
  updatedAt: string
  deadlineAt: string | null
  terminalReason: string | null
}

export interface LedgerRunListRow extends LedgerRunRecord {
  taskCount: number
  /** Task-state histogram (`{ completed: 3, failed: 1 }`). */
  counts: Record<string, number>
}

export interface LedgerTaskRecord {
  id: string
  runId: string
  issueKey: string
  title: string
  role: string
  modelSlot: string
  state: string
  priority: number
  attempts: number
  dependencies: string[]
  writeScope: string[]
  allowedPaths: string[]
  acceptanceCriteria: string[]
  verificationCommands: string[]
  contract: unknown
  createdAt: string
  updatedAt: string
}

export interface LedgerAttemptRecord {
  id: string
  workItemId: string
  attemptNo: number
  harness: string
  state: string
  modelProvider: string
  modelId: string
  modelVariant: string | null
  startedAt: string | null
  finishedAt: string | null
  exitCode: number | null
  failureClass: string | null
  usage: unknown
  cost: unknown
  createdAt: string
}

export interface LedgerLeaseRecord {
  workItemId: string
  owner: string
  expiresAt: string | null
  heartbeatAt: string | null
  fencingToken: number
  claimedAt: string | null
  releasedAt: string | null
}

export interface LedgerApprovalRecord {
  id: string
  gate: string
  decision: string
  actor: string
  createdAt: string
  expiresAt: string | null
}

export interface LedgerVerificationRecord {
  id: string
  attemptId: string
  profile: string
  command: string
  exitCode: number
  outputHash: string
  durationMs: number
  stdoutPath: string | null
  stderrPath: string | null
  startedAt: string
  finishedAt: string
}

export interface LedgerFindingRecord {
  id: string
  reviewId: string
  severity: string
  category: string
  title: string
  location: string | null
  evidence: string
  confidence: number
  blocking: boolean
  status: string
  requiredFix: string | null
  createdAt: string
}

export interface LedgerEventRecord {
  sequence: number
  runId: string
  workItemId: string | null
  attemptId: string | null
  type: string
  actor: string
  payload: unknown
  createdAt: string
}

export interface LedgerCostRow {
  attemptId: string
  workItemId: string
  attemptNo: number
  state: string
  modelProvider: string
  modelId: string
  modelVariant: string | null
  usage: unknown
  cost: unknown
}

export interface LedgerCounts {
  runs: number
  activeRuns: number
  tasks: number
  attempts: number
}

export interface RunListQuery {
  limit?: number
  cursor?: string | null
  states?: readonly string[] | null
}

export interface RunListPage {
  runs: LedgerRunListRow[]
  nextCursor: string | null
}

// ---------------------------------------------------------------------------
// Defensive parsing
// ---------------------------------------------------------------------------

export function parseJsonValue(value: unknown): unknown {
  if (typeof value !== 'string' || value.trim().length === 0) return null
  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}

export function parseJsonObject(value: unknown): Record<string, unknown> | null {
  const parsed = parseJsonValue(value)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null
  }
  return parsed as Record<string, unknown>
}

export function parseStringArray(value: unknown): string[] {
  const parsed = parseJsonValue(value)
  if (!Array.isArray(parsed)) return []
  return parsed.filter((entry): entry is string => typeof entry === 'string')
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function nullableStr(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function num(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function nullableNum(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function bool(value: unknown): boolean {
  return value === true || value === 1 || value === '1'
}

// bun:sqlite types `get`/`all` against the generic return type; every caller
// here maps an untyped `SELECT *` row through the helpers above.
type Row = Record<string, unknown>

// ---------------------------------------------------------------------------
// Cursor
// ---------------------------------------------------------------------------

export interface RunCursor {
  updatedAt: string
  id: string
}

const CURSOR_VERSION = 1

/** Opaque `(updated_at, id)` cursor. Base64url keeps ids with `-` unambiguous. */
export function encodeRunCursor(updatedAt: string, id: string): string {
  return Buffer.from(
    JSON.stringify({ v: CURSOR_VERSION, u: updatedAt, i: id }),
    'utf8',
  ).toString('base64url')
}

/** Decode a cursor; a malformed cursor is ignored (page from the start). */
export function decodeRunCursor(cursor: string | null | undefined): RunCursor | null {
  if (typeof cursor !== 'string' || cursor.trim().length === 0) return null
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    )
    if (typeof parsed !== 'object' || parsed === null) return null
    const record = parsed as Record<string, unknown>
    if (typeof record.u !== 'string' || typeof record.i !== 'string') return null
    if (record.i.length === 0) return null
    return { updatedAt: record.u, id: record.i }
  } catch {
    return null
  }
}

const DEFAULT_RUN_LIMIT = 50
const MAX_RUN_LIMIT = 200
const DEFAULT_EVENT_LIMIT = 200
const MAX_EVENT_LIMIT = 1000

export function clampLimit(
  value: number | null | undefined,
  fallback: number,
  max: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(1, Math.min(max, Math.floor(value)))
}

// ---------------------------------------------------------------------------
// Reader
// ---------------------------------------------------------------------------

/**
 * Read-only view over one conductor ledger file.
 *
 * Every method opens its own `readonly` connection and closes it again, so a
 * caller never holds a lock and a deleted/replaced file is picked up on the next
 * call. All failures resolve to the method's empty value.
 */
export class LedgerReader {
  readonly path: string

  constructor(path: string) {
    this.path = path
  }

  /** True when the ledger file exists (a zero-byte file still counts). */
  exists(): boolean {
    try {
      return existsSync(this.path)
    } catch {
      return false
    }
  }

  private withDb<T>(fallback: T, fn: (db: Database) => T): T {
    if (!this.exists()) return fallback
    let db: Database | null = null
    try {
      db = new Database(this.path, { readonly: true })
      return fn(db)
    } catch {
      return fallback
    } finally {
      if (db) {
        try {
          db.close()
        } catch {
          // A failed close must not mask the read result.
        }
      }
    }
  }

  /** `SELECT` helper that degrades to `[]` when the table is absent. */
  private safeAll(
    db: Database,
    sql: string,
    params: (string | number | null)[] = [],
  ): Row[] {
    try {
      return db
        .query<Row, (string | number | null)[]>(sql)
        .all(...params) as Row[]
    } catch {
      return []
    }
  }

  private safeGet(
    db: Database,
    sql: string,
    params: (string | number | null)[] = [],
  ): Row | null {
    try {
      return (
        db.query<Row, (string | number | null)[]>(sql).get(...params) ?? null
      )
    } catch {
      return null
    }
  }

  private safeCount(db: Database, sql: string, params: (string | number | null)[] = []): number {
    const row = this.safeGet(db, sql, params)
    return row ? num(row.n) : 0
  }

  // --- Workspace counts -----------------------------------------------------

  counts(): LedgerCounts {
    return this.withDb<LedgerCounts>(
      { runs: 0, activeRuns: 0, tasks: 0, attempts: 0 },
      (db) => {
        const terminal = [...TERMINAL_STATES]
        const placeholders = terminal.map(() => '?').join(', ')
        return {
          runs: this.safeCount(db, 'SELECT COUNT(*) AS n FROM runs'),
          activeRuns: this.safeCount(
            db,
            `SELECT COUNT(*) AS n FROM runs WHERE state NOT IN (${placeholders})`,
            terminal,
          ),
          tasks: this.safeCount(db, 'SELECT COUNT(*) AS n FROM work_items'),
          attempts: this.safeCount(db, 'SELECT COUNT(*) AS n FROM attempts'),
        }
      },
    )
  }

  // --- Runs -----------------------------------------------------------------

  runs(query: RunListQuery = {}): RunListPage {
    const limit = clampLimit(query.limit, DEFAULT_RUN_LIMIT, MAX_RUN_LIMIT)
    const states = Array.isArray(query.states)
      ? query.states.filter((state): state is string => typeof state === 'string' && state.length > 0)
      : []
    const cursor = decodeRunCursor(query.cursor)

    return this.withDb<RunListPage>({ runs: [], nextCursor: null }, (db) => {
      const where: string[] = []
      const params: (string | number | null)[] = []
      if (states.length > 0) {
        where.push(`state IN (${states.map(() => '?').join(', ')})`)
        params.push(...states)
      }
      if (cursor) {
        // Stable newest-first order over the composite key; ids break ties for
        // rows created inside the same `datetime('now')` second.
        where.push('(updated_at < ? OR (updated_at = ? AND id < ?))')
        params.push(cursor.updatedAt, cursor.updatedAt, cursor.id)
      }
      const sql = [
        'SELECT * FROM runs',
        where.length > 0 ? `WHERE ${where.join(' AND ')}` : '',
        'ORDER BY updated_at DESC, id DESC',
        'LIMIT ?',
      ]
        .filter((part) => part.length > 0)
        .join(' ')
      params.push(limit + 1)

      const rows = this.safeAll(db, sql, params)
      const pageRows = rows.slice(0, limit)
      const counts = this.taskCounts(
        db,
        pageRows.map((row) => str(row.id)),
      )
      const runs = pageRows.map((row) => {
        const id = str(row.id)
        const perRun = counts.get(id) ?? { total: 0, byState: {} }
        return { ...this.mapRun(row), taskCount: perRun.total, counts: perRun.byState }
      })
      const last = runs[runs.length - 1]
      return {
        runs,
        nextCursor:
          rows.length > limit && last
            ? encodeRunCursor(last.updatedAt, last.id)
            : null,
      }
    })
  }

  private taskCounts(
    db: Database,
    runIds: readonly string[],
  ): Map<string, { total: number; byState: Record<string, number> }> {
    const result = new Map<string, { total: number; byState: Record<string, number> }>()
    if (runIds.length === 0) return result
    const placeholders = runIds.map(() => '?').join(', ')
    const rows = this.safeAll(
      db,
      `SELECT run_id, state, COUNT(*) AS n FROM work_items
       WHERE run_id IN (${placeholders})
       GROUP BY run_id, state`,
      [...runIds],
    )
    for (const row of rows) {
      const runId = str(row.run_id)
      const state = str(row.state, 'unknown')
      const count = num(row.n)
      const entry = result.get(runId) ?? { total: 0, byState: {} }
      entry.total += count
      entry.byState[state] = (entry.byState[state] ?? 0) + count
      result.set(runId, entry)
    }
    return result
  }

  run(runId: string): LedgerRunRecord | null {
    if (typeof runId !== 'string' || runId.length === 0) return null
    return this.withDb<LedgerRunRecord | null>(null, (db) => {
      const row = this.safeGet(db, 'SELECT * FROM runs WHERE id = ?', [runId])
      return row ? this.mapRun(row) : null
    })
  }

  /** Additive history: an old ledger has no revision table and stays unmodified. */
  planRevisions(runId: string): Array<{ revision: number; parentRevision: number | null; reason: string; createdAt: string }> {
    if (typeof runId !== 'string' || runId.length === 0) return []
    return this.withDb([], db => this.safeAll(db,
      'SELECT revision, parent_revision, reason, created_at FROM plan_revisions WHERE run_id = ? ORDER BY revision DESC LIMIT 200',
      [runId],
    ).map(row => ({ revision: num(row.revision), parentRevision: nullableNum(row.parent_revision), reason: str(row.reason), createdAt: str(row.created_at) })))
  }

  private mapRun(row: Row): LedgerRunRecord {
    return {
      id: str(row.id),
      parentId: nullableStr(row.parent_id),
      repoId: str(row.repo_id),
      dataClass: str(row.data_class, 'internal'),
      policyProfile: str(row.policy_profile, 'assisted'),
      operationMode: str(row.operation_mode, 'assisted'),
      state: str(row.state, 'created'),
      riskClass: str(row.risk_class, 'medium'),
      objective: str(row.request_text),
      contract: parseJsonValue(row.contract_json),
      plan: parseJsonValue(row.plan_json),
      budget: parseJsonValue(row.budget_json),
      hasReceipt: row.receipt_json !== null && row.receipt_json !== undefined,
      createdAt: str(row.created_at),
      updatedAt: str(row.updated_at),
      deadlineAt: nullableStr(row.deadline_at),
      terminalReason: nullableStr(row.terminal_reason),
    }
  }

  // --- Tasks ----------------------------------------------------------------

  tasks(runId: string): LedgerTaskRecord[] {
    if (typeof runId !== 'string' || runId.length === 0) return []
    return this.withDb<LedgerTaskRecord[]>([], (db) => {
      const rows = this.safeAll(
        db,
        'SELECT * FROM work_items WHERE run_id = ? ORDER BY priority, created_at, id',
        [runId],
      )
      return rows.map((row) => this.mapTask(row))
    })
  }

  private mapTask(row: Row): LedgerTaskRecord {
    return {
      id: str(row.id),
      runId: str(row.run_id),
      issueKey: str(row.issue_key),
      title: str(row.title),
      role: str(row.owner_role, 'coder'),
      modelSlot: str(row.model_slot, 'implementation'),
      state: str(row.state, 'pending'),
      priority: num(row.priority),
      attempts: num(row.attempts),
      dependencies: parseStringArray(row.dependency_json),
      writeScope: parseStringArray(row.write_scope_json),
      allowedPaths: parseStringArray(row.allowed_paths_json),
      acceptanceCriteria: parseStringArray(row.acceptance_criteria_json),
      verificationCommands: parseStringArray(row.verification_commands_json),
      contract: parseJsonValue(row.contract_json),
      createdAt: str(row.created_at),
      updatedAt: str(row.updated_at),
    }
  }

  // --- Attempts -------------------------------------------------------------

  attempts(runId: string): LedgerAttemptRecord[] {
    if (typeof runId !== 'string' || runId.length === 0) return []
    return this.withDb<LedgerAttemptRecord[]>([], (db) => {
      const rows = this.safeAll(
        db,
        `SELECT a.* FROM attempts a
         JOIN work_items w ON w.id = a.work_item_id
         WHERE w.run_id = ?
         ORDER BY a.work_item_id, a.attempt_no, a.created_at`,
        [runId],
      )
      return rows.map((row) => this.mapAttempt(row))
    })
  }

  private mapAttempt(row: Row): LedgerAttemptRecord {
    return {
      id: str(row.id),
      workItemId: str(row.work_item_id),
      attemptNo: num(row.attempt_no, 1),
      harness: str(row.harness),
      state: str(row.state, 'pending'),
      modelProvider: str(row.model_provider),
      modelId: str(row.model_id),
      modelVariant: nullableStr(row.model_variant),
      startedAt: nullableStr(row.started_at),
      finishedAt: nullableStr(row.finished_at),
      exitCode: nullableNum(row.exit_code),
      failureClass: nullableStr(row.failure_class),
      usage: parseJsonValue(row.usage_json),
      cost: parseJsonValue(row.cost_json),
      createdAt: str(row.created_at),
    }
  }

  // --- Leases ---------------------------------------------------------------

  leases(runId: string): LedgerLeaseRecord[] {
    if (typeof runId !== 'string' || runId.length === 0) return []
    return this.withDb<LedgerLeaseRecord[]>([], (db) => {
      const rows = this.safeAll(
        db,
        `SELECT l.* FROM leases l
         JOIN work_items w ON w.id = l.work_item_id
         WHERE w.run_id = ?
         ORDER BY w.priority, l.work_item_id`,
        [runId],
      )
      return rows.map((row) => ({
        workItemId: str(row.work_item_id),
        owner: str(row.lease_owner),
        expiresAt: nullableStr(row.lease_expires_at),
        heartbeatAt: nullableStr(row.heartbeat_at),
        fencingToken: num(row.fencing_token),
        claimedAt: nullableStr(row.claimed_at),
        releasedAt: nullableStr(row.released_at),
      }))
    })
  }

  // --- Approvals ------------------------------------------------------------

  approvals(runId: string): LedgerApprovalRecord[] {
    if (typeof runId !== 'string' || runId.length === 0) return []
    return this.withDb<LedgerApprovalRecord[]>([], (db) => {
      const rows = this.safeAll(
        db,
        'SELECT * FROM approvals WHERE run_id = ? ORDER BY created_at, id',
        [runId],
      )
      return rows.map((row) => ({
        id: str(row.id),
        gate: str(row.gate),
        decision: str(row.decision),
        actor: str(row.actor),
        createdAt: str(row.created_at),
        expiresAt: nullableStr(row.expires_at),
      }))
    })
  }

  // --- Verifications --------------------------------------------------------

  verifications(runId: string): LedgerVerificationRecord[] {
    if (typeof runId !== 'string' || runId.length === 0) return []
    return this.withDb<LedgerVerificationRecord[]>([], (db) => {
      const rows = this.safeAll(
        db,
        `SELECT v.* FROM verifications v
         JOIN attempts a ON a.id = v.attempt_id
         JOIN work_items w ON w.id = a.work_item_id
         WHERE w.run_id = ?
         ORDER BY v.started_at, v.id`,
        [runId],
      )
      return rows.map((row) => ({
        id: str(row.id),
        attemptId: str(row.attempt_id),
        profile: str(row.profile),
        command: str(row.command),
        exitCode: num(row.exit_code, -1),
        outputHash: str(row.output_hash),
        durationMs: num(row.duration_ms),
        stdoutPath: nullableStr(row.stdout_path),
        stderrPath: nullableStr(row.stderr_path),
        startedAt: str(row.started_at),
        finishedAt: str(row.finished_at),
      }))
    })
  }

  // --- Review findings ------------------------------------------------------

  findings(runId: string): LedgerFindingRecord[] {
    if (typeof runId !== 'string' || runId.length === 0) return []
    const escaped = runId.replace(/[\\%_]/g, (match) => `\\${match}`)
    return this.withDb<LedgerFindingRecord[]>([], (db) => {
      const rows = this.safeAll(
        db,
        `SELECT * FROM review_findings
         WHERE review_id = ? OR review_id LIKE ? ESCAPE '\\'
            OR review_id IN (
              SELECT a.id FROM attempts a
              JOIN work_items w ON w.id = a.work_item_id
              WHERE w.run_id = ?
            )
         ORDER BY CASE severity
           WHEN 'critical' THEN 0
           WHEN 'high' THEN 1
           WHEN 'medium' THEN 2
           WHEN 'low' THEN 3
           ELSE 4
         END, created_at, id`,
        [runId, `${escaped}:%`, runId],
      )
      return rows.map((row) => ({
        id: str(row.id),
        reviewId: str(row.review_id),
        severity: str(row.severity, 'medium'),
        category: str(row.category, 'other'),
        title: str(row.title),
        location: nullableStr(row.location),
        evidence: str(row.evidence),
        confidence: num(row.confidence, 0.5),
        blocking: bool(row.blocking),
        status: str(row.status, 'open'),
        requiredFix: nullableStr(row.required_fix),
        createdAt: str(row.created_at),
      }))
    })
  }

  // --- Events ---------------------------------------------------------------

  events(runId: string, afterSequence = 0, limit = DEFAULT_EVENT_LIMIT): LedgerEventRecord[] {
    if (typeof runId !== 'string' || runId.length === 0) return []
    const after =
      typeof afterSequence === 'number' && Number.isFinite(afterSequence)
        ? Math.max(0, Math.floor(afterSequence))
        : 0
    const capped = clampLimit(limit, DEFAULT_EVENT_LIMIT, MAX_EVENT_LIMIT)
    return this.withDb<LedgerEventRecord[]>([], (db) => {
      const rows = this.safeAll(
        db,
        `SELECT * FROM events
         WHERE run_id = ? AND sequence > ?
         ORDER BY sequence
         LIMIT ?`,
        [runId, after, capped],
      )
      return rows.map((row) => this.mapEvent(row))
    })
  }

  /** Events filtered to a set of types (refinement history, etc.). */
  eventsOfType(runId: string, types: readonly string[], limit = DEFAULT_EVENT_LIMIT): LedgerEventRecord[] {
    if (typeof runId !== 'string' || runId.length === 0) return []
    const wanted = types.filter((type): type is string => typeof type === 'string' && type.length > 0)
    if (wanted.length === 0) return []
    const capped = clampLimit(limit, DEFAULT_EVENT_LIMIT, MAX_EVENT_LIMIT)
    return this.withDb<LedgerEventRecord[]>([], (db) => {
      const rows = this.safeAll(
        db,
        `SELECT * FROM events
         WHERE run_id = ? AND event_type IN (${wanted.map(() => '?').join(', ')})
         ORDER BY sequence
         LIMIT ?`,
        [runId, ...wanted, capped],
      )
      return rows.map((row) => this.mapEvent(row))
    })
  }

  eventCount(runId: string): number {
    if (typeof runId !== 'string' || runId.length === 0) return 0
    return this.withDb<number>(0, (db) =>
      this.safeCount(db, 'SELECT COUNT(*) AS n FROM events WHERE run_id = ?', [runId]),
    )
  }

  private mapEvent(row: Row): LedgerEventRecord {
    return {
      sequence: num(row.sequence),
      runId: str(row.run_id),
      workItemId: nullableStr(row.work_item_id),
      attemptId: nullableStr(row.attempt_id),
      type: str(row.event_type),
      actor: str(row.actor, 'supervisor'),
      payload: parseJsonValue(row.payload_json),
      createdAt: str(row.created_at),
    }
  }

  // --- Costs ----------------------------------------------------------------

  /** Attempt rows carrying the model identity and the raw usage/cost columns. */
  costRows(runId: string): LedgerCostRow[] {
    if (typeof runId !== 'string' || runId.length === 0) return []
    return this.withDb<LedgerCostRow[]>([], (db) => {
      const rows = this.safeAll(
        db,
        `SELECT a.id, a.work_item_id, a.attempt_no, a.state, a.model_provider,
                a.model_id, a.model_variant, a.usage_json, a.cost_json
         FROM attempts a
         JOIN work_items w ON w.id = a.work_item_id
         WHERE w.run_id = ?
         ORDER BY a.work_item_id, a.attempt_no`,
        [runId],
      )
      return rows.map((row) => ({
        attemptId: str(row.id),
        workItemId: str(row.work_item_id),
        attemptNo: num(row.attempt_no, 1),
        state: str(row.state, 'pending'),
        modelProvider: str(row.model_provider),
        modelId: str(row.model_id),
        modelVariant: nullableStr(row.model_variant),
        usage: parseJsonValue(row.usage_json),
        cost: parseJsonValue(row.cost_json),
      }))
    })
  }
}
