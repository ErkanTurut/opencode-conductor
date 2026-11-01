import { scopePrefix, scopesOverlap, validateScopeRoots } from './scope'
import { createHash } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { decideTaskAdmission } from '../runtime/run-safety'
import { Database } from 'bun:sqlite'
import { buildSeverityQuestions } from '../jev/questions.js'
import { calibrateSeverity } from '../jev/gates.js'
import { isJevEnabled } from '../jev/config.js'
import { evaluateWithJev } from '../jev/client.js'
import { clampJevSeverity, clampProbability } from '../jev/types.js'
import { isJevEgressAllowed } from '../policy'
import {
  StateTransitionDenied,
  TERMINAL_STATES,
  assertTransitionAllowed,
  isTerminalTransition,
} from '../state-machine'
import type { RunState } from '../types'
import { MUTATING_ROLES, READ_ONLY_ROLES, type AgentRole } from '../types'
import type {
  ILedger,
  CreateRunParams,
  CreateWorkItemParams,
  CreateAttemptParams,
  ClaimLeaseParams,
  ClaimLeaseResult,
} from './interface'
import type {
  RunRow,
  WorkItemRow,
  AttemptRow,
  LeaseRow,
  WorkspaceRow,
  EventRow,
  ApprovalRow,
  VerificationRow,
  ReviewFindingRow,
  BudgetEventRow,
  MergeEntryRow,
} from './types'

/**
 * A review finding belongs to a run when its review_id is exactly the run
 * id, or carries the round marker `{runId}:round-{N}` (see
 * ILedger.listReviewFindingsByRun). Returns null when nothing is derivable.
 */
function runIdFromReviewId(reviewId: string): string | null {
  if (typeof reviewId !== 'string') return null
  const trimmed = reviewId.trim()
  if (!trimmed) return null
  return trimmed.split(':round-')[0] || null
}

function policyBinding(run: RunRow): string {
  // A deterministic legacy binding proves only that persisted inputs did not
  // change, not that any policy came from an authenticated authority.
  const identity = [run.effective_workflow_hash, run.policy_profile, run.operation_mode, run.risk_class, run.data_class, run.contract_json, run.budget_json, run.plan_json]
  return (run.effective_workflow_hash ? 'workflow:' : 'legacy:') + createHash('sha256').update(JSON.stringify(identity)).digest('hex')
}

export class SqliteLedger implements ILedger {
  private db: Database

  async bindAttemptWorkspace(attemptId: string, workItemId: string, fencingToken: number, workspaceId: string | null, baseSha: string): Promise<boolean> {
    const row = this.db.query(`UPDATE attempts SET workspace_id = ?, base_sha = ? WHERE id = ? AND work_item_id = ? AND state = 'pending' AND EXISTS (SELECT 1 FROM leases WHERE work_item_id = ? AND fencing_token = ? AND released_at IS NULL AND lease_expires_at > ?) RETURNING id`).get(workspaceId, baseSha, attemptId, workItemId, workItemId, fencingToken, new Date().toISOString())
    return !!row
  }

  async claimTaskAtomic(params: ClaimLeaseParams & { runId: string; attempt: Omit<CreateAttemptParams, 'attemptNo'> }): Promise<ClaimLeaseResult & { error?: string }> {
    const deny = (error: string) => ({ claimed: false, fencingToken: -1, error })
    this.db.run('BEGIN IMMEDIATE')
    try {
      const run = this.db.query('SELECT * FROM runs WHERE id = ?').get(params.runId) as RunRow | null
      const item = this.db.query('SELECT * FROM work_items WHERE id = ? AND run_id = ?').get(params.workItemId, params.runId) as WorkItemRow | null
      const reject = (reason: string) => { this.db.run('ROLLBACK'); return deny(reason) }
      if (!run || !item || params.attempt.workItemId !== item.id) return reject('Task or run not found')
      if (['paused', 'blocked', 'cancelled', 'completed', 'failed', 'timed_out', 'awaiting_refinement', 'awaiting_plan_approval', 'awaiting_merge_approval'].includes(run.state)) return reject('Run is parked or terminal')
      // Legacy read-only callers can claim pending tasks without invoking the
      // scheduler. Evaluate their readiness inside this same transaction;
      // never promote unknown roles or mutating work implicitly.
      const pendingReadOnly = item.state === 'pending' && READ_ONLY_ROLES.has(item.owner_role)
      if (item.state !== 'ready' && !pendingReadOnly) return reject('Task is not ready')
      const now = new Date().toISOString()
      if (!params.leaseOwner || !Number.isFinite(Date.parse(params.leaseExpiresAt)) || params.leaseExpiresAt <= now) return reject('Invalid lease')
      let deps: unknown, scopes: unknown, allowed: unknown, budget: any
      try { deps = JSON.parse(item.dependency_json); scopes = JSON.parse(item.write_scope_json); allowed = JSON.parse(item.allowed_paths_json); budget = JSON.parse(run.budget_json) } catch { return reject('Invalid task or budget data') }
      if (!Array.isArray(deps) || deps.some(d => typeof d !== 'string') || !Array.isArray(scopes) || scopes.some(s => typeof s !== 'string' || !s.trim())) return reject('Invalid dependencies or scope')
      if (!Array.isArray(allowed) || allowed.some(path => scopePrefix(path) === null)) return reject('Invalid allowed paths')
      const rows = this.db.query('SELECT id, state, dependency_json FROM work_items WHERE run_id = ?').all(params.runId) as Array<{ id: string; state: string; dependency_json: string }>
      let graph
      try { graph = rows.map(r => ({ id: r.id, state: r.state, dependencies: JSON.parse(r.dependency_json) })) } catch { return reject('Invalid task graph') }
      const admission = decideTaskAdmission({ tasks: graph.map(t => pendingReadOnly && t.id === item.id ? { ...t, state: 'ready' } : t), taskId: item.id })
      if (!admission.allowed) return reject(admission.reasons.map(r => r.code).join(', '))
      const max = budget?.max_attempts_per_task ?? 2
      if (!Number.isSafeInteger(max) || max < 1 || item.attempts >= max) return reject('Attempt budget exhausted')
      for (const dep of deps) {
        const row = this.db.query('SELECT state FROM work_items WHERE id = ? AND run_id = ?').get(dep, params.runId) as { state: string } | null
        if (!row || row.state !== 'completed') return reject('Dependency missing or unfinished')
      }
      const normalizedScopes = (scopes as string[]).map(scopePrefix)
      if (normalizedScopes.some(x => x === null)) return reject('Invalid write scope')
      // When repo_id is a path, refuse known symlink aliases before leasing.
      // Non-path repository identities cannot establish filesystem authority.
      if (isAbsolute(run.repo_id) && !validateScopeRoots(run.repo_id, [...scopes, ...allowed] as string[])) return reject('Uninspectable or symlink scope')
      const live = this.db.query(`SELECT w.write_scope_json, w.owner_role FROM work_items w JOIN leases l ON l.work_item_id = w.id WHERE w.run_id = ? AND w.id != ? AND l.released_at IS NULL AND l.lease_expires_at > ?`).all(params.runId, item.id, now) as Array<{ write_scope_json: string; owner_role: string }>
      for (const other of live) {
        let paths: unknown
        try { paths = JSON.parse(other.write_scope_json) } catch { return reject('Invalid active scope') }
        if (!Array.isArray(paths)) return reject('Invalid active scope')
        const otherScopes = paths.map(scopePrefix)
        if (otherScopes.some(p => p === null)) return reject('Invalid active scope')
        if (MUTATING_ROLES.has(item.owner_role) && MUTATING_ROLES.has(other.owner_role as AgentRole) && (!normalizedScopes.length || !otherScopes.length)) return reject('Unknown active write scope')
        for (const a of normalizedScopes) for (const b of otherScopes) if (a && b && scopesOverlap(a, b)) return reject('Active write scope collision')
      }
      const lease = this.db.query(`UPDATE leases SET lease_owner = ?, lease_expires_at = ?, heartbeat_at = ?, fencing_token = fencing_token + 1, claimed_at = ?, released_at = NULL WHERE work_item_id = ? AND (lease_expires_at IS NULL OR released_at IS NOT NULL OR lease_expires_at <= ?) RETURNING fencing_token`).get(params.leaseOwner, params.leaseExpiresAt, now, now, item.id, now) as { fencing_token: number } | null
      if (!lease) return reject('Lease unavailable')
      this.db.run(`UPDATE work_items SET attempts = attempts + 1, state = 'running', updated_at = datetime('now') WHERE id = ?`, [item.id])
      const a = params.attempt
      this.db.run(`INSERT INTO attempts (id, work_item_id, attempt_no, harness, model_provider, model_id, model_variant, workspace_id, base_sha) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [a.id, item.id, item.attempts + 1, a.harness, a.modelProvider, a.modelId, a.modelVariant, a.workspaceId, a.baseSha])
      let revision = this.db.query('SELECT MAX(revision) AS revision FROM plan_revisions WHERE run_id = ?').get(params.runId) as { revision: number | null }
      if (revision.revision === null) {
        this.snapshotPlan(params.runId, 0, 'legacy graph at task admission')
        revision = { revision: 1 }
      }
      this.db.run('UPDATE attempts SET plan_revision = ?, policy_identity = ? WHERE id = ?', [revision.revision, policyBinding(run), a.id])
      this.db.run('COMMIT')
      return { claimed: true, fencingToken: lease.fencing_token }
    } catch (e) { this.db.run('ROLLBACK'); throw e }
  }

  async finishTaskAtomic(p: { runId: string; workItemId: string; attemptId: string; fencingToken: number; success: boolean; exitCode: number | null; failureClass: string | null; usageJson: string | null; evidenceJson: string | null }): Promise<boolean> {
    this.db.run('BEGIN IMMEDIATE')
    try {
      const now = new Date().toISOString()
      const valid = this.db.query(`SELECT a.id FROM attempts a JOIN work_items w ON w.id = a.work_item_id JOIN leases l ON l.work_item_id = w.id JOIN runs r ON r.id = w.run_id WHERE a.id = ? AND w.id = ? AND w.run_id = ? AND w.state = 'running' AND a.state = 'pending' AND a.attempt_no = w.attempts AND l.fencing_token = ? AND l.released_at IS NULL AND l.lease_expires_at > ? AND r.state NOT IN ('paused','blocked','cancelled','completed','failed','timed_out','awaiting_refinement','awaiting_plan_approval','awaiting_merge_approval')`).get(p.attemptId, p.workItemId, p.runId, p.fencingToken, now)
      if (!valid) { this.db.run('ROLLBACK'); return false }
      if (p.success) {
        const invalidate = () => {
          this.db.run(`UPDATE attempts SET state = 'failed', failure_class = 'plan_or_policy_invalidated', evidence_json = ?, finished_at = datetime('now') WHERE id = ?`, [JSON.stringify({ reason: 'plan_or_policy_invalidated', prior_evidence: p.evidenceJson }), p.attemptId])
          this.db.run(`UPDATE work_items SET state = 'failed', updated_at = datetime('now') WHERE id = ?`, [p.workItemId])
          this.db.run(`UPDATE leases SET released_at = ? WHERE work_item_id = ? AND fencing_token = ?`, [now, p.workItemId, p.fencingToken])
          this.db.run(`INSERT INTO events (run_id, work_item_id, attempt_id, event_type, actor, payload_json) VALUES (?, ?, ?, 'attempt_invalidated', 'ledger', ?)`, [p.runId, p.workItemId, p.attemptId, JSON.stringify({ reason: 'plan_or_policy_invalidated' })])
          this.db.run('COMMIT')
          return false
        }
        const binding = this.db.query(`SELECT a.plan_revision, a.policy_identity, r.* FROM attempts a JOIN work_items w ON w.id = a.work_item_id JOIN runs r ON r.id = w.run_id WHERE a.id = ?`).get(p.attemptId) as (RunRow & { plan_revision: number | null; policy_identity: string | null })
        const current = this.db.query('SELECT MAX(revision) AS revision FROM plan_revisions WHERE run_id = ?').get(p.runId) as { revision: number | null }
        // Strict invalidation: any revision change requires a fresh attempt.
        // Null snapshots from pre-migration attempts are not authoritative.
        if (binding.plan_revision === null || current.revision === null || binding.plan_revision !== current.revision || !binding.policy_identity || binding.policy_identity !== policyBinding(binding)) return invalidate()
        const snapshot = this.db.query('SELECT graph_json FROM plan_revisions WHERE run_id = ? AND revision = ?').get(p.runId, binding.plan_revision) as { graph_json: string } | null
        const graph = this.db.query('SELECT id, title, dependency_json, owner_role, model_slot, write_scope_json, contract_json, allowed_paths_json, read_paths_json, acceptance_criteria_json, verification_commands_json FROM work_items WHERE run_id = ? ORDER BY id').all(p.runId)
        if (!snapshot || snapshot.graph_json !== JSON.stringify(graph)) return invalidate()
      }
      this.db.run(`UPDATE attempts SET state = ?, exit_code = ?, failure_class = ?, usage_json = ?, evidence_json = ?, finished_at = datetime('now') WHERE id = ?`, [p.success ? 'completed' : 'failed', p.exitCode, p.success ? null : p.failureClass, p.usageJson, p.evidenceJson, p.attemptId])
      this.db.run(`UPDATE work_items SET state = ?, updated_at = datetime('now') WHERE id = ?`, [p.success ? 'completed' : 'failed', p.workItemId])
      this.db.run(`UPDATE leases SET released_at = ? WHERE work_item_id = ? AND fencing_token = ?`, [now, p.workItemId, p.fencingToken])
      this.db.run('COMMIT')
      return true
    } catch (e) { this.db.run('ROLLBACK'); throw e }
  }

  constructor(path: string) {
    this.db = new Database(path)
    this.db.run('PRAGMA journal_mode = WAL')
    this.db.run('PRAGMA busy_timeout = 5000')
    this.db.run('PRAGMA foreign_keys = ON')
    this.migrate()
  }

  private migrate(): void {
    this.db.run(`CREATE TABLE IF NOT EXISTS plan_revisions (run_id TEXT NOT NULL, revision INTEGER NOT NULL, parent_revision INTEGER, reason TEXT NOT NULL, graph_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (run_id, revision), FOREIGN KEY (run_id) REFERENCES runs(id))`)
    this.db.run(`
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY NOT NULL,
        parent_id TEXT,
        repo_id TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        data_class TEXT NOT NULL DEFAULT 'internal',
        policy_profile TEXT NOT NULL DEFAULT 'assisted',
        operation_mode TEXT NOT NULL DEFAULT 'assisted',
        state TEXT NOT NULL DEFAULT 'created',
        effective_workflow_hash TEXT,
        risk_class TEXT NOT NULL DEFAULT 'medium',
        request_text TEXT NOT NULL DEFAULT '',
        contract_json TEXT,
        plan_json TEXT,
        receipt_json TEXT,
        budget_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        deadline_at TEXT,
        terminal_reason TEXT
      )
    `)

    this.db.run(`
      CREATE TABLE IF NOT EXISTS work_items (
        id TEXT PRIMARY KEY NOT NULL,
        run_id TEXT NOT NULL,
        issue_key TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL DEFAULT '',
        dependency_json TEXT NOT NULL DEFAULT '[]',
        owner_role TEXT NOT NULL DEFAULT 'coder',
        model_slot TEXT NOT NULL DEFAULT 'implementation',
        state TEXT NOT NULL DEFAULT 'pending',
        priority INTEGER NOT NULL DEFAULT 0,
        attempts INTEGER NOT NULL DEFAULT 0,
        write_scope_json TEXT NOT NULL DEFAULT '[]',
        contract_json TEXT NOT NULL DEFAULT '{}',
        allowed_paths_json TEXT NOT NULL DEFAULT '[]',
        read_paths_json TEXT NOT NULL DEFAULT '[]',
        acceptance_criteria_json TEXT NOT NULL DEFAULT '[]',
        verification_commands_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (run_id) REFERENCES runs(id)
      )
    `)

    this.db.run(`
      CREATE TABLE IF NOT EXISTS attempts (
        id TEXT PRIMARY KEY NOT NULL,
        work_item_id TEXT NOT NULL,
        attempt_no INTEGER NOT NULL DEFAULT 1,
        harness TEXT NOT NULL DEFAULT 'opencode-cli',
        model_provider TEXT NOT NULL DEFAULT '',
        model_id TEXT NOT NULL DEFAULT '',
        model_variant TEXT,
        workspace_id TEXT,
        base_sha TEXT NOT NULL DEFAULT '',
        state TEXT NOT NULL DEFAULT 'pending',
        started_at TEXT,
        finished_at TEXT,
        exit_code INTEGER,
        failure_class TEXT,
        usage_json TEXT,
        cost_json TEXT,
        stdout_path TEXT,
        stderr_path TEXT,
        evidence_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (work_item_id) REFERENCES work_items(id)
      )
    `)

    this.db.run(`
      CREATE TABLE IF NOT EXISTS leases (
        work_item_id TEXT PRIMARY KEY NOT NULL,
        lease_owner TEXT NOT NULL DEFAULT '',
        lease_expires_at TEXT,
        heartbeat_at TEXT,
        fencing_token INTEGER NOT NULL DEFAULT 0,
        claimed_at TEXT,
        released_at TEXT,
        FOREIGN KEY (work_item_id) REFERENCES work_items(id)
      )
    `)
    const attemptColumns = this.db.query('PRAGMA table_info(attempts)').all() as Array<{ name: string }>
    if (!attemptColumns.some(c => c.name === 'plan_revision')) this.db.run('ALTER TABLE attempts ADD COLUMN plan_revision INTEGER')
    if (!attemptColumns.some(c => c.name === 'policy_identity')) this.db.run('ALTER TABLE attempts ADD COLUMN policy_identity TEXT')

    this.db.run(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY NOT NULL,
        provider TEXT NOT NULL DEFAULT 'worktree',
        path TEXT NOT NULL DEFAULT '',
        branch TEXT NOT NULL DEFAULT '',
        base_sha TEXT NOT NULL DEFAULT '',
        head_sha TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        dirty INTEGER NOT NULL DEFAULT 0,
        quarantined_at TEXT,
        rescue_branch TEXT,
        cleanup_state TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `)

    this.db.run(`
      CREATE TABLE IF NOT EXISTS events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL,
        work_item_id TEXT,
        attempt_id TEXT,
        event_type TEXT NOT NULL,
        actor TEXT NOT NULL DEFAULT 'supervisor',
        payload_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        correlation_id TEXT
      )
    `)

    this.db.run(`
      CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY NOT NULL,
        run_id TEXT NOT NULL,
        gate TEXT NOT NULL DEFAULT '',
        decision TEXT NOT NULL DEFAULT 'pending',
        actor TEXT NOT NULL DEFAULT '',
        policy_hash TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        expires_at TEXT,
        FOREIGN KEY (run_id) REFERENCES runs(id)
      )
    `)

    this.db.run(`
      CREATE TABLE IF NOT EXISTS verifications (
        id TEXT PRIMARY KEY NOT NULL,
        attempt_id TEXT NOT NULL,
        profile TEXT NOT NULL DEFAULT 'default',
        command TEXT NOT NULL DEFAULT '',
        exit_code INTEGER NOT NULL DEFAULT -1,
        output_hash TEXT NOT NULL DEFAULT '',
        duration_ms INTEGER NOT NULL DEFAULT 0,
        stdout_path TEXT,
        stderr_path TEXT,
        started_at TEXT NOT NULL DEFAULT (datetime('now')),
        finished_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (attempt_id) REFERENCES attempts(id)
      )
    `)

    this.db.run(`
      CREATE TABLE IF NOT EXISTS review_findings (
        id TEXT PRIMARY KEY NOT NULL,
        review_id TEXT NOT NULL,
        severity TEXT NOT NULL DEFAULT 'medium',
        category TEXT NOT NULL DEFAULT 'other',
        title TEXT NOT NULL DEFAULT '',
        fingerprint TEXT NOT NULL DEFAULT '',
        location TEXT,
        evidence TEXT NOT NULL DEFAULT '',
        confidence REAL NOT NULL DEFAULT 0.5,
        blocking INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'open',
        required_fix TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `)

    this.db.run(`
      CREATE TABLE IF NOT EXISTS budget_events (
        id TEXT PRIMARY KEY NOT NULL,
        scope TEXT NOT NULL DEFAULT 'run',
        scope_id TEXT NOT NULL DEFAULT '',
        kind TEXT NOT NULL DEFAULT 'usage',
        estimated REAL,
        actual REAL,
        currency TEXT NOT NULL DEFAULT 'USD',
        provider TEXT,
        model TEXT,
        attempt_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `)

    this.db.run(`
      CREATE TABLE IF NOT EXISTS merge_entries (
        id TEXT PRIMARY KEY NOT NULL,
        repo_id TEXT NOT NULL DEFAULT '',
        base_branch TEXT NOT NULL DEFAULT 'main',
        candidate_branch TEXT NOT NULL DEFAULT '',
        candidate_sha TEXT NOT NULL DEFAULT '',
        position INTEGER NOT NULL DEFAULT 0,
        state TEXT NOT NULL DEFAULT 'pending',
        required_checks_json TEXT NOT NULL DEFAULT '[]',
        review_gate_json TEXT NOT NULL DEFAULT '{}',
        bisect_parent_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        merged_at TEXT
      )
    `)
  }

  // --- Transactions ---

  async transaction<T>(fn: (tx: ILedger) => Promise<T> | T): Promise<T> {
    this.db.run('BEGIN IMMEDIATE')
    try {
      const result = await fn(this)
      this.db.run('COMMIT')
      return result
    } catch (e) {
      this.db.run('ROLLBACK')
      throw e
    }
  }

  // --- Runs ---

  async createRun(params: CreateRunParams): Promise<RunRow> {
    return this.db
      .query(
        `INSERT INTO runs (id, parent_id, repo_id, request_hash, data_class, policy_profile, operation_mode, risk_class, request_text, budget_json, deadline_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`,
      )
      .get(
        params.id,
        params.parentId,
        params.repoId,
        params.requestHash,
        params.dataClass,
        params.policyProfile,
        params.operationMode,
        params.riskClass,
        params.requestText,
        params.budgetJson,
        params.deadlineAt,
      ) as RunRow
  }

  async getRun(id: string): Promise<RunRow | null> {
    return (
      (this.db.query('SELECT * FROM runs WHERE id = ?').get(id) as RunRow) ??
      null
    )
  }

  async listActiveRuns(): Promise<RunRow[]> {
    // Terminal states come from the derived transition-table authority,
    // never a private copy of the list.
    const terminalStates = [...TERMINAL_STATES]
    const placeholders = terminalStates.map(() => '?').join(',')
    return this.db
      .query(
        `SELECT * FROM runs WHERE state NOT IN (${placeholders}) ORDER BY created_at`,
      )
      .all(...terminalStates) as RunRow[]
  }

  async listRuns(): Promise<RunRow[]> {
    return this.db
      .query('SELECT * FROM runs ORDER BY created_at')
      .all() as RunRow[]
  }

  async transitionRunState(
    id: string,
    state: string,
    reason?: string,
  ): Promise<RunRow> {
    // Fail-closed transition gate: consult the derived state machine before
    // touching the row. Illegal and terminal-state (wrap) transitions throw
    // a typed StateTransitionDenied instead of silently writing.
    const current = this.db
      .query('SELECT * FROM runs WHERE id = ?')
      .get(id) as RunRow | null
    if (!current) {
      throw new StateTransitionDenied(
        'created',
        state as RunState,
        `Cannot transition unknown run ${id}`,
      )
    }
    const from = current.state as RunState
    const to = state as RunState
    assertTransitionAllowed(from, to)

    if (isTerminalTransition(from, to)) {
      return this.db
        .query(
          `UPDATE runs SET state = ?, terminal_reason = ?, updated_at = datetime('now') WHERE id = ? RETURNING *`,
        )
        .get(state, reason ?? null, id) as RunRow
    }
    return this.db
      .query(
        `UPDATE runs SET state = ?, updated_at = datetime('now') WHERE id = ? RETURNING *`,
      )
      .get(state, id) as RunRow
  }

  async updateRunPlan(id: string, planJson: string): Promise<RunRow> {
    return this.db
      .query(
        `UPDATE runs SET plan_json = ?, updated_at = datetime('now') WHERE id = ? RETURNING *`,
      )
      .get(planJson, id) as RunRow
  }

  async updateRunContract(id: string, contractJson: string): Promise<RunRow> {
    return this.db
      .query(
        `UPDATE runs SET contract_json = ?, updated_at = datetime('now') WHERE id = ? RETURNING *`,
      )
      .get(contractJson, id) as RunRow
  }

  async updateRunReceipt(id: string, receiptJson: string): Promise<RunRow> {
    return this.db
      .query(
        `UPDATE runs SET receipt_json = ?, updated_at = datetime('now') WHERE id = ? RETURNING *`,
      )
      .get(receiptJson, id) as RunRow
  }

  // --- Work Items ---

  private snapshotPlan(runId: string, expectedRevision: number, reason: string): boolean {
    const current = this.db.query('SELECT MAX(revision) AS revision FROM plan_revisions WHERE run_id = ?').get(runId) as { revision: number | null }
    if ((current.revision ?? 0) !== expectedRevision || !reason.trim()) return false
    const graph = this.db.query('SELECT id, title, dependency_json, owner_role, model_slot, write_scope_json, contract_json, allowed_paths_json, read_paths_json, acceptance_criteria_json, verification_commands_json FROM work_items WHERE run_id = ? ORDER BY id').all(runId)
    this.db.run('INSERT INTO plan_revisions (run_id, revision, parent_revision, reason, graph_json) VALUES (?, ?, ?, ?, ?)', [runId, expectedRevision + 1, expectedRevision || null, reason, JSON.stringify(graph)])
    return true
  }

  async listPlanRevisions(runId: string) {
    return this.db.query('SELECT * FROM plan_revisions WHERE run_id = ? ORDER BY revision').all(runId) as Array<{ run_id: string; revision: number; parent_revision: number | null; reason: string; graph_json: string; created_at: string }>
  }

  async snapshotPlanCAS(runId: string, expectedRevision: number, reason: string): Promise<boolean> {
    this.db.run('SAVEPOINT plan_cas')
    try {
      const exists = this.db.query('SELECT id FROM runs WHERE id = ?').get(runId)
      const ok = !!exists && this.snapshotPlan(runId, expectedRevision, reason)
      this.db.run('RELEASE plan_cas')
      return ok
    } catch (e) { this.db.run('ROLLBACK TO plan_cas'); this.db.run('RELEASE plan_cas'); throw e }
  }

  async createWorkItem(params: CreateWorkItemParams): Promise<WorkItemRow> {
    this.db.run('SAVEPOINT create_work_item')
    try {
    const previous = this.db.query('SELECT MAX(revision) AS revision FROM plan_revisions WHERE run_id = ?').get(params.runId) as { revision: number | null }
    // Capture a legacy graph before its first modification.
    let revision = previous.revision ?? 0
    const existing = this.db.query('SELECT COUNT(*) AS n FROM work_items WHERE run_id = ?').get(params.runId) as { n: number }
    if (!revision && existing.n) { this.snapshotPlan(params.runId, 0, 'legacy graph before task creation'); revision = 1 }
    const item = this.db
      .query(
        `INSERT INTO work_items (id, run_id, issue_key, title, dependency_json, owner_role, model_slot, priority, write_scope_json, contract_json, allowed_paths_json, read_paths_json, acceptance_criteria_json, verification_commands_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`,
      )
      .get(
        params.id,
        params.runId,
        params.issueKey,
        params.title,
        params.dependencyJson,
        params.ownerRole,
        params.modelSlot,
        params.priority,
        params.writeScopeJson,
        params.contractJson,
        params.allowedPathsJson,
        params.readPathsJson,
        params.acceptanceCriteriaJson,
        params.verificationCommandsJson,
      ) as WorkItemRow

    this.db
      .query(
        `INSERT OR IGNORE INTO leases (work_item_id, lease_owner, fencing_token) VALUES (?, '', 0)`,
      )
      .run(params.id)

    this.snapshotPlan(params.runId, revision, `task created: ${params.id}`)
    this.db.run('RELEASE create_work_item')
    return item
    } catch (e) { this.db.run('ROLLBACK TO create_work_item'); this.db.run('RELEASE create_work_item'); throw e }
  }

  async getWorkItem(id: string): Promise<WorkItemRow | null> {
    return (
      (this.db
        .query('SELECT * FROM work_items WHERE id = ?')
        .get(id) as WorkItemRow) ?? null
    )
  }

  async listWorkItems(runId: string): Promise<WorkItemRow[]> {
    return this.db
      .query(
        'SELECT * FROM work_items WHERE run_id = ? ORDER BY priority, created_at',
      )
      .all(runId) as WorkItemRow[]
  }

  async listReadyWorkItems(runId: string): Promise<WorkItemRow[]> {
    return this.db
      .query(
        'SELECT * FROM work_items WHERE run_id = ? AND state = ? ORDER BY priority, created_at',
      )
      .all(runId, 'ready') as WorkItemRow[]
  }

  async transitionWorkItemState(
    id: string,
    state: string,
  ): Promise<WorkItemRow> {
    return this.db
      .query(
        `UPDATE work_items SET state = ?, updated_at = datetime('now') WHERE id = ? RETURNING *`,
      )
      .get(state, id) as WorkItemRow
  }

  async incrementWorkItemAttempts(id: string): Promise<WorkItemRow> {
    return this.db
      .query(
        `UPDATE work_items SET attempts = attempts + 1, updated_at = datetime('now') WHERE id = ? RETURNING *`,
      )
      .get(id) as WorkItemRow
  }

  /**
   * Amend a node's acceptance criteria in place (per-node `amend`).
   *
   * Additive extension only: the caller (Runner.amendNode) appends and passes
   * the full JSON array, which is ledger-evented alongside the amendment so no
   * state jump can occur without an event. Kept off `ILedger` (structural use
   * via Runner duck-typing) to leave the frozen interface untouched for
   * parallel tasks.
   */
  async replaceWorkItemAcceptance(
    id: string,
    acceptanceCriteriaJson: string,
  ): Promise<WorkItemRow | null> {
    this.db.run('SAVEPOINT amend_work_item')
    try {
      const current = this.db.query('SELECT * FROM work_items WHERE id = ?').get(id) as WorkItemRow | null
      if (!current) { this.db.run('RELEASE amend_work_item'); return null }
      const active = this.db.query(`SELECT 1 FROM leases WHERE work_item_id = ? AND released_at IS NULL AND lease_expires_at > ?`).get(id, new Date().toISOString())
      if (active) throw new Error('Cannot amend actively leased work')
      let revision = (this.db.query('SELECT MAX(revision) AS revision FROM plan_revisions WHERE run_id = ?').get(current.run_id) as { revision: number | null }).revision ?? 0
      if (!revision) { this.snapshotPlan(current.run_id, 0, 'legacy graph before amendment'); revision = 1 }
      const result = (this.db
        .query(
          `UPDATE work_items SET acceptance_criteria_json = ?, updated_at = datetime('now') WHERE id = ? RETURNING *`,
        )
        .get(acceptanceCriteriaJson, id) as WorkItemRow) ?? null
      this.snapshotPlan(current.run_id, revision, `acceptance amended: ${id}`)
      this.db.run('RELEASE amend_work_item')
      return result
    } catch (e) { this.db.run('ROLLBACK TO amend_work_item'); this.db.run('RELEASE amend_work_item'); throw e }
  }

  // --- Attempts ---

  async createAttempt(params: CreateAttemptParams): Promise<AttemptRow> {
    return this.db
      .query(
        `INSERT INTO attempts (id, work_item_id, attempt_no, harness, model_provider, model_id, model_variant, workspace_id, base_sha)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`,
      )
      .get(
        params.id,
        params.workItemId,
        params.attemptNo,
        params.harness,
        params.modelProvider,
        params.modelId,
        params.modelVariant,
        params.workspaceId,
        params.baseSha,
      ) as AttemptRow
  }

  async getAttempt(id: string): Promise<AttemptRow | null> {
    return (
      (this.db
        .query('SELECT * FROM attempts WHERE id = ?')
        .get(id) as AttemptRow) ?? null
    )
  }

  async getLatestAttempt(workItemId: string): Promise<AttemptRow | null> {
    return (
      (this.db
        .query(
          'SELECT * FROM attempts WHERE work_item_id = ? ORDER BY attempt_no DESC LIMIT 1',
        )
        .get(workItemId) as AttemptRow) ?? null
    )
  }

  async completeAttempt(
    id: string,
    exitCode: number,
    usageJson: string | null,
    stdoutPath: string | null,
    stderrPath: string | null,
    evidenceJson: string | null,
  ): Promise<AttemptRow> {
    return this.db
      .query(
        `UPDATE attempts SET state = 'completed', exit_code = ?, usage_json = ?, stdout_path = ?, stderr_path = ?, evidence_json = ?, finished_at = datetime('now') WHERE id = ? RETURNING *`,
      )
      .get(
        exitCode,
        usageJson,
        stdoutPath,
        stderrPath,
        evidenceJson,
        id,
      ) as AttemptRow
  }

  async failAttempt(
    id: string,
    failureClass: string,
    exitCode: number | null,
    usageJson: string | null,
    evidenceJson: string | null,
  ): Promise<AttemptRow> {
    return this.db
      .query(
        `UPDATE attempts SET state = 'failed', failure_class = ?, exit_code = ?, usage_json = ?, evidence_json = ?, finished_at = datetime('now') WHERE id = ? RETURNING *`,
      )
      .get(failureClass, exitCode, usageJson, evidenceJson, id) as AttemptRow
  }

  // --- Leases ---

  async claimLease(params: ClaimLeaseParams): Promise<ClaimLeaseResult> {
    const now = new Date().toISOString()
    const row = this.db
      .query(
        `UPDATE leases
       SET lease_owner = ?,
           lease_expires_at = ?,
           heartbeat_at = ?,
           fencing_token = fencing_token + 1,
           claimed_at = ?,
           released_at = NULL
       WHERE work_item_id = ?
         AND (lease_expires_at IS NULL OR lease_expires_at < ?)
       RETURNING fencing_token`,
      )
      .get(
        params.leaseOwner,
        params.leaseExpiresAt,
        now,
        now,
        params.workItemId,
        now,
      ) as { fencing_token: number } | null

    if (row) {
      return { fencingToken: row.fencing_token, claimed: true }
    }
    return { fencingToken: -1, claimed: false }
  }

  async heartbeatLease(
    workItemId: string,
    fencingToken: number,
  ): Promise<boolean> {
    const now = new Date().toISOString()
    const result = this.db.run(
      `UPDATE leases SET heartbeat_at = ? WHERE work_item_id = ? AND fencing_token = ?`,
      [now, workItemId, fencingToken],
    )
    return result.changes > 0
  }

  async releaseLease(
    workItemId: string,
    fencingToken: number,
  ): Promise<boolean> {
    const now = new Date().toISOString()
    const result = this.db.run(
      `UPDATE leases SET released_at = ? WHERE work_item_id = ? AND fencing_token = ? AND released_at IS NULL`,
      [now, workItemId, fencingToken],
    )
    return result.changes > 0
  }

  /**
   * Fencing recovery for a stale/expired lease (watchdog + patrol path).
   *
   * One BEGIN IMMEDIATE does both halves of the repair: the fencing token is
   * bumped (so the previous owner's heartbeat/release are fenced out and the
   * next claim takes a higher token) and the lease is released. Returns
   * `recovered: false` when the row's token no longer matches — another owner
   * already superseded it, so this recovery is a no-op by design.
   *
   * Structural (not on `ILedger`) so the frozen ledger interface stays
   * untouched; `Watchdog.forceRecover` feature-detects it and falls back to
   * the token-fenced `releaseLease`.
   */
  async recoverLease(
    workItemId: string,
    expectedFencingToken: number,
  ): Promise<{ recovered: boolean; fencingToken: number }> {
    this.db.run('BEGIN IMMEDIATE')
    try {
      const now = new Date().toISOString()
      const row = this.db
        .query(
          `UPDATE leases
           SET fencing_token = fencing_token + 1,
               released_at = ?
           WHERE work_item_id = ? AND fencing_token = ? AND released_at IS NULL
           RETURNING fencing_token`,
        )
        .get(now, workItemId, expectedFencingToken) as {
        fencing_token: number
      } | null
      this.db.run('COMMIT')
      if (!row) return { recovered: false, fencingToken: -1 }
      return { recovered: true, fencingToken: row.fencing_token }
    } catch (e) {
      try {
        this.db.run('ROLLBACK')
      } catch {
        // The transaction may already be unwound; preserve the original error.
      }
      throw e
    }
  }

  async getLease(workItemId: string): Promise<LeaseRow | null> {
    return (
      (this.db
        .query('SELECT * FROM leases WHERE work_item_id = ?')
        .get(workItemId) as LeaseRow) ?? null
    )
  }

  async listExpiredLeases(): Promise<LeaseRow[]> {
    const now = new Date().toISOString()
    return this.db
      .query(
        'SELECT * FROM leases WHERE lease_expires_at IS NOT NULL AND lease_expires_at < ? AND released_at IS NULL',
      )
      .all(now) as LeaseRow[]
  }

  async listStaleHeartbeats(maxAgeMs: number): Promise<LeaseRow[]> {
    const cutoff = new Date(Date.now() - maxAgeMs).toISOString()
    return this.db
      .query(
        'SELECT * FROM leases WHERE heartbeat_at IS NOT NULL AND heartbeat_at < ? AND released_at IS NULL',
      )
      .all(cutoff) as LeaseRow[]
  }

  // --- Workspaces ---

  async createWorkspace(params: {
    id: string
    provider: string
    path: string
    branch: string
    baseSha: string
  }): Promise<WorkspaceRow> {
    return this.db
      .query(
        `INSERT INTO workspaces (id, provider, path, branch, base_sha)
       VALUES (?, ?, ?, ?, ?)
       RETURNING *`,
      )
      .get(
        params.id,
        params.provider,
        params.path,
        params.branch,
        params.baseSha,
      ) as WorkspaceRow
  }

  async getWorkspace(id: string): Promise<WorkspaceRow | null> {
    return (
      (this.db
        .query('SELECT * FROM workspaces WHERE id = ?')
        .get(id) as WorkspaceRow) ?? null
    )
  }

  async updateWorkspaceStatus(
    id: string,
    status: string,
    headSha?: string,
  ): Promise<WorkspaceRow> {
    if (headSha) {
      return this.db
        .query(
          'UPDATE workspaces SET status = ?, head_sha = ? WHERE id = ? RETURNING *',
        )
        .get(status, headSha, id) as WorkspaceRow
    }
    return this.db
      .query('UPDATE workspaces SET status = ? WHERE id = ? RETURNING *')
      .get(status, id) as WorkspaceRow
  }

  async markWorkspaceDirty(id: string, dirty: boolean): Promise<WorkspaceRow> {
    return this.db
      .query('UPDATE workspaces SET dirty = ? WHERE id = ? RETURNING *')
      .get(dirty ? 1 : 0, id) as WorkspaceRow
  }

  async quarantineWorkspace(
    id: string,
    rescueBranch: string,
  ): Promise<WorkspaceRow> {
    const now = new Date().toISOString()
    return this.db
      .query(
        'UPDATE workspaces SET status = ?, quarantined_at = ?, rescue_branch = ? WHERE id = ? RETURNING *',
      )
      .get('quarantined', now, rescueBranch, id) as WorkspaceRow
  }

  // --- Events ---

  async appendEvent(params: {
    runId: string
    workItemId?: string
    attemptId?: string
    eventType: string
    actor: string
    payloadJson: string
    correlationId?: string
  }): Promise<EventRow> {
    return this.db
      .query(
        `INSERT INTO events (run_id, work_item_id, attempt_id, event_type, actor, payload_json, correlation_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       RETURNING *`,
      )
      .get(
        params.runId,
        params.workItemId ?? null,
        params.attemptId ?? null,
        params.eventType,
        params.actor,
        params.payloadJson,
        params.correlationId ?? null,
      ) as EventRow
  }

  async getEvents(runId: string, afterSequence?: number): Promise<EventRow[]> {
    if (afterSequence !== undefined) {
      return this.db
        .query(
          'SELECT * FROM events WHERE run_id = ? AND sequence > ? ORDER BY sequence',
        )
        .all(runId, afterSequence) as EventRow[]
    }
    return this.db
      .query('SELECT * FROM events WHERE run_id = ? ORDER BY sequence')
      .all(runId) as EventRow[]
  }

  // --- Approvals ---

  async createApproval(params: {
    id: string
    runId: string
    gate: string
    decision: string
    actor: string
    policyHash?: string
    expiresAt?: string
  }): Promise<ApprovalRow> {
    return this.db
      .query(
        `INSERT INTO approvals (id, run_id, gate, decision, actor, policy_hash, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       RETURNING *`,
      )
      .get(
        params.id,
        params.runId,
        params.gate,
        params.decision,
        params.actor,
        params.policyHash ?? null,
        params.expiresAt ?? null,
      ) as ApprovalRow
  }

  async getApprovals(runId: string, gate?: string): Promise<ApprovalRow[]> {
    if (gate) {
      return this.db
        .query(
          'SELECT * FROM approvals WHERE run_id = ? AND gate = ? ORDER BY created_at',
        )
        .all(runId, gate) as ApprovalRow[]
    }
    return this.db
      .query('SELECT * FROM approvals WHERE run_id = ? ORDER BY created_at')
      .all(runId) as ApprovalRow[]
  }

  // --- Verifications ---

  async createVerification(params: {
    id: string
    attemptId: string
    profile: string
    command: string
    exitCode: number
    outputHash: string
    durationMs: number
    stdoutPath?: string
    stderrPath?: string
  }): Promise<VerificationRow> {
    // Idempotent upsert. The runner's executeTask persists a verification row
    // keyed `${attemptId}-verify-${hash(command)}` and the plugin's
    // record_evidence re-runs the exact same commands for the same attempt, so
    // a plain INSERT collides on the `id` PRIMARY KEY (and, with the try/catch
    // now wrapped around the call, would surface as a spurious failure).
    // ON CONFLICT(id) DO UPDATE keeps the row id stable (unlike INSERT OR
    // REPLACE, which deletes + re-inserts and resets started_at) while
    // refreshing the measured outcome. `finished_at` is refreshed too: the
    // re-run happened later, so the row must not keep the first runner's
    // timestamp as if it were the latest measurement.
    return this.db
      .query(
        `INSERT INTO verifications (id, attempt_id, profile, command, exit_code, output_hash, duration_ms, stdout_path, stderr_path)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         attempt_id = excluded.attempt_id,
         profile = excluded.profile,
         command = excluded.command,
         exit_code = excluded.exit_code,
         output_hash = excluded.output_hash,
         duration_ms = excluded.duration_ms,
         stdout_path = excluded.stdout_path,
         stderr_path = excluded.stderr_path,
         finished_at = datetime('now')
       RETURNING *`,
      )
      .get(
        params.id,
        params.attemptId,
        params.profile,
        params.command,
        params.exitCode,
        params.outputHash,
        params.durationMs,
        params.stdoutPath ?? null,
        params.stderrPath ?? null,
      ) as VerificationRow
  }

  async getVerifications(attemptId: string): Promise<VerificationRow[]> {
    return this.db
      .query(
        'SELECT * FROM verifications WHERE attempt_id = ? ORDER BY started_at',
      )
      .all(attemptId) as VerificationRow[]
  }

  // --- Review Findings ---

  async createReviewFinding(params: {
    id: string
    reviewId: string
    severity: string
    category: string
    title: string
    fingerprint: string
    location?: string
    evidence: string
    confidence: number
    blocking: boolean
    requiredFix?: string
  }): Promise<ReviewFindingRow> {
    // Clamp untrusted inputs first (always, even when Jev is disabled).
    const normalizedSeverityInput =
      typeof params.severity === 'string' ? params.severity.toLowerCase() : ''
    const originalSeverity = clampJevSeverity(normalizedSeverityInput)
    const originalBlocking = params.blocking === true
    const originalConfidence = clampProbability(params.confidence)
    let effectiveSeverity = originalSeverity
    let effectiveBlocking = originalBlocking
    const effectiveConfidence = originalConfidence
    let effectiveEvidence = params.evidence

    // Jev-aware calibration BEFORE insert. Fail-open: any error, disabled,
    // !ok, or low_confidence/skipped/advisory-without-apply keeps originals.
    // Never auto-unblocks: an original blocking:true stays true.
    // Never throws: the whole block is guarded.
    // Data-class gate: confidential/regulated runs never egress to the
    // remote judge (local/no-model path instead) — a skip event is recorded
    // when the owning run is resolvable.
    try {
      if (isJevEnabled()) {
        const runId = runIdFromReviewId(params.reviewId)
        const run = runId ? await this.getRun(runId) : null
        if (!isJevEgressAllowed(run?.data_class)) {
          if (runId) {
            try {
              await this.appendEvent({
                runId,
                eventType: 'jev_skipped_data_class',
                actor: 'sqlite-ledger',
                payloadJson: JSON.stringify({
                  data_class: run?.data_class ?? null,
                  site: 'createReviewFinding',
                }),
              })
            } catch {
              // Ledger unavailable: deny silently (no remote egress anyway).
            }
          }
        } else {
          const bundle = buildSeverityQuestions({
            title: params.title ?? '',
            category: params.category ?? '',
            evidence: typeof params.evidence === 'string' ? params.evidence.slice(0, 4000) : '',
            location: params.location ?? '',
          })
          const result = await evaluateWithJev(
            bundle.state,
            bundle.questions as unknown as Record<string, unknown>,
          )
          if (result.ok) {
            const calibrated = calibrateSeverity(
              { severity: originalSeverity, blocking: originalBlocking },
              result.answers as unknown as Parameters<typeof calibrateSeverity>[1],
            )
            const status = calibrated?.annotation?.jev_status
            if (status === 'applied' || status === 'advisory') {
              const nextSeverity = clampJevSeverity(
                typeof calibrated.severity === 'string'
                  ? calibrated.severity.toLowerCase()
                  : '',
              )
              // Defence in depth: never auto-unblock, even if a gate ever
              // returned blocking:false for an originally-blocking finding.
              const nextBlocking = originalBlocking
                ? true
                : calibrated.blocking === true
              effectiveSeverity = nextSeverity
              effectiveBlocking = nextBlocking
              if (nextSeverity !== originalSeverity) {
                effectiveEvidence = `${params.evidence} [jev:${originalSeverity}->${nextSeverity}:${status}]`
              }
            }
          }
        }
      }
    } catch {
      // Fail-open: keep original (clamped) values.
      effectiveSeverity = originalSeverity
      effectiveBlocking = originalBlocking
      effectiveEvidence = params.evidence
    }

    return this.db
      .query(
        `INSERT INTO review_findings (id, review_id, severity, category, title, fingerprint, location, evidence, confidence, blocking, required_fix)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`,
      )
      .get(
        params.id,
        params.reviewId,
        effectiveSeverity,
        params.category,
        params.title,
        params.fingerprint,
        params.location ?? null,
        effectiveEvidence,
        effectiveConfidence,
        effectiveBlocking ? 1 : 0,
        params.requiredFix ?? null,
      ) as ReviewFindingRow
  }

  async getReviewFindings(reviewId: string): Promise<ReviewFindingRow[]> {
    return this.db
      .query(
        'SELECT * FROM review_findings WHERE review_id = ? ORDER BY severity, created_at',
      )
      .all(reviewId) as ReviewFindingRow[]
  }

  // Run-scoped read. review_id is an interface-only convention (no FK):
  // exact `{runId}` or `{runId}:round-{N}`. The `LIKE ? || ':%'` bound
  // additionally stops a run id prefix from matching an unrelated run whose
  // id merely starts with the same text (run-1 must not match run-1b:round-1).
  // SQLite has no enum ordering, so severity is ranked with an inline CASE.
  // License provenance: derived from OmO patterns only (idea N); SUL-1.0, no
  // verbatim copy of upstream source.
  async listReviewFindingsByRun(runId: string): Promise<ReviewFindingRow[]> {
    return this.db
      .query(
        `SELECT id, review_id, severity, category, title, fingerprint, location, evidence, confidence, blocking, status, required_fix, created_at
         FROM review_findings
         WHERE review_id = ? OR review_id LIKE ? || ':%'
         ORDER BY CASE severity
           WHEN 'critical' THEN 0
           WHEN 'high' THEN 1
           WHEN 'medium' THEN 2
           WHEN 'low' THEN 3
           ELSE 4
         END, created_at`,
      )
      .all(runId, runId) as ReviewFindingRow[]
  }

  async updateReviewFindingStatus(
    id: string,
    status: string,
  ): Promise<ReviewFindingRow | null> {
    const row = this.db
      .query('UPDATE review_findings SET status = ? WHERE id = ? RETURNING *')
      .get(status, id) as ReviewFindingRow | null
    return row ?? null
  }

  // --- Budget Events ---

  async createBudgetEvent(params: {
    id: string
    scope: string
    scopeId: string
    kind: string
    estimated?: number
    actual?: number
    currency: string
    provider?: string
    model?: string
    attemptId?: string
  }): Promise<BudgetEventRow> {
    return this.db
      .query(
        `INSERT INTO budget_events (id, scope, scope_id, kind, estimated, actual, currency, provider, model, attempt_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`,
      )
      .get(
        params.id,
        params.scope,
        params.scopeId,
        params.kind,
        params.estimated ?? null,
        params.actual ?? null,
        params.currency,
        params.provider ?? null,
        params.model ?? null,
        params.attemptId ?? null,
      ) as BudgetEventRow
  }

  async getBudgetEvents(
    scope: string,
    scopeId: string,
  ): Promise<BudgetEventRow[]> {
    return this.db
      .query(
        'SELECT * FROM budget_events WHERE scope = ? AND scope_id = ? ORDER BY created_at',
      )
      .all(scope, scopeId) as BudgetEventRow[]
  }

  // --- Merge Entries ---

  async createMergeEntry(params: {
    id: string
    repoId: string
    baseBranch: string
    candidateBranch: string
    candidateSha: string
    position: number
    requiredChecksJson: string
    reviewGateJson: string
  }): Promise<MergeEntryRow> {
    return this.db
      .query(
        `INSERT INTO merge_entries (id, repo_id, base_branch, candidate_branch, candidate_sha, position, required_checks_json, review_gate_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`,
      )
      .get(
        params.id,
        params.repoId,
        params.baseBranch,
        params.candidateBranch,
        params.candidateSha,
        params.position,
        params.requiredChecksJson,
        params.reviewGateJson,
      ) as MergeEntryRow
  }

  async getMergeEntry(id: string): Promise<MergeEntryRow | null> {
    return (
      (this.db
        .query('SELECT * FROM merge_entries WHERE id = ?')
        .get(id) as MergeEntryRow) ?? null
    )
  }

  async listPendingMergeEntries(repoId: string): Promise<MergeEntryRow[]> {
    return this.db
      .query(
        'SELECT * FROM merge_entries WHERE repo_id = ? AND state = ? ORDER BY position',
      )
      .all(repoId, 'pending') as MergeEntryRow[]
  }

  async updateMergeEntryState(
    id: string,
    state: string,
  ): Promise<MergeEntryRow> {
    const now = state === 'merged' ? new Date().toISOString() : null
    return this.db
      .query(
        `UPDATE merge_entries SET state = ?, merged_at = ? WHERE id = ? RETURNING *`,
      )
      .get(state, now, id) as MergeEntryRow
  }

  // --- Utility ---

  close(): void {
    this.db.close()
  }
}
