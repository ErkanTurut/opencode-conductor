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

export interface CreateRunParams {
  id: string
  parentId: string | null
  repoId: string
  requestHash: string
  dataClass: string
  policyProfile: string
  operationMode: string
  riskClass: string
  requestText: string
  budgetJson: string
  deadlineAt: string | null
}

export interface CreateWorkItemParams {
  id: string
  runId: string
  issueKey: string
  title: string
  dependencyJson: string
  ownerRole: string
  modelSlot: string
  priority: number
  writeScopeJson: string
  contractJson: string
  allowedPathsJson: string
  readPathsJson: string
  acceptanceCriteriaJson: string
  verificationCommandsJson: string
}

export interface CreateAttemptParams {
  id: string
  workItemId: string
  attemptNo: number
  harness: string
  modelProvider: string
  modelId: string
  modelVariant: string | null
  workspaceId: string | null
  baseSha: string
}

export interface ClaimLeaseParams {
  workItemId: string
  leaseOwner: string
  leaseExpiresAt: string
}

export interface ClaimLeaseResult {
  fencingToken: number
  claimed: boolean
}

export interface ILedger {
  // Transactions
  transaction<T>(fn: (tx: ILedger) => Promise<T> | T): Promise<T>

  // Runs
  createRun(params: CreateRunParams): Promise<RunRow>
  getRun(id: string): Promise<RunRow | null>
  listActiveRuns(): Promise<RunRow[]>
  /** Every run row (any state). Used for GC attribution and ledger-health probes. */
  listRuns(): Promise<RunRow[]>
  transitionRunState(
    id: string,
    state: string,
    reason?: string,
  ): Promise<RunRow>
  updateRunPlan(id: string, planJson: string): Promise<RunRow>
  updateRunContract(id: string, contractJson: string): Promise<RunRow>
  updateRunReceipt(id: string, receiptJson: string): Promise<RunRow>

  // Work Items
  createWorkItem(params: CreateWorkItemParams): Promise<WorkItemRow>
  getWorkItem(id: string): Promise<WorkItemRow | null>
  listWorkItems(runId: string): Promise<WorkItemRow[]>
  listReadyWorkItems(runId: string): Promise<WorkItemRow[]>
  transitionWorkItemState(id: string, state: string): Promise<WorkItemRow>
  incrementWorkItemAttempts(id: string): Promise<WorkItemRow>

  // Attempts
  createAttempt(params: CreateAttemptParams): Promise<AttemptRow>
  getAttempt(id: string): Promise<AttemptRow | null>
  getLatestAttempt(workItemId: string): Promise<AttemptRow | null>
  completeAttempt(
    id: string,
    exitCode: number,
    usageJson: string | null,
    stdoutPath: string | null,
    stderrPath: string | null,
    evidenceJson: string | null,
  ): Promise<AttemptRow>
  failAttempt(
    id: string,
    failureClass: string,
    exitCode: number | null,
    usageJson: string | null,
    evidenceJson: string | null,
  ): Promise<AttemptRow>

  // Leases
  claimLease(params: ClaimLeaseParams): Promise<ClaimLeaseResult>
  heartbeatLease(workItemId: string, fencingToken: number): Promise<boolean>
  releaseLease(workItemId: string, fencingToken: number): Promise<boolean>
  getLease(workItemId: string): Promise<LeaseRow | null>
  listExpiredLeases(): Promise<LeaseRow[]>
  listStaleHeartbeats(maxAgeMs: number): Promise<LeaseRow[]>

  // Workspaces
  createWorkspace(params: {
    id: string
    provider: string
    path: string
    branch: string
    baseSha: string
  }): Promise<WorkspaceRow>
  getWorkspace(id: string): Promise<WorkspaceRow | null>
  updateWorkspaceStatus(
    id: string,
    status: string,
    headSha?: string,
  ): Promise<WorkspaceRow>
  markWorkspaceDirty(id: string, dirty: boolean): Promise<WorkspaceRow>
  quarantineWorkspace(id: string, rescueBranch: string): Promise<WorkspaceRow>

  // Events (append-only)
  appendEvent(params: {
    runId: string
    workItemId?: string
    attemptId?: string
    eventType: string
    actor: string
    payloadJson: string
    correlationId?: string
  }): Promise<EventRow>
  getEvents(runId: string, afterSequence?: number): Promise<EventRow[]>

  // Approvals
  createApproval(params: {
    id: string
    runId: string
    gate: string
    decision: string
    actor: string
    policyHash?: string
    expiresAt?: string
  }): Promise<ApprovalRow>
  getApprovals(runId: string, gate?: string): Promise<ApprovalRow[]>

  // Verifications
  createVerification(params: {
    id: string
    attemptId: string
    profile: string
    command: string
    exitCode: number
    outputHash: string
    durationMs: number
    stdoutPath?: string
    stderrPath?: string
  }): Promise<VerificationRow>
  getVerifications(attemptId: string): Promise<VerificationRow[]>

  // Review Findings
  createReviewFinding(params: {
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
  }): Promise<ReviewFindingRow>
  getReviewFindings(reviewId: string): Promise<ReviewFindingRow[]>
  // Run-scoped read (additive; does not change getReviewFindings above).
  // A finding belongs to a run when its review_id is exactly the run id, or
  // carries the round marker `{runId}:round-{N}`. Findings are ordered
  // critical->high->medium->low->other, then created_at.
  listReviewFindingsByRun(runId: string): Promise<ReviewFindingRow[]>
  // Status transition for a single finding (open/accepted/rejected/fixed/
  // wont_fix). Returns the updated row, or null when the id is unknown.
  updateReviewFindingStatus(
    id: string,
    status: string,
  ): Promise<ReviewFindingRow | null>

  // Budget Events
  createBudgetEvent(params: {
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
  }): Promise<BudgetEventRow>
  getBudgetEvents(scope: string, scopeId: string): Promise<BudgetEventRow[]>

  // Merge Entries
  createMergeEntry(params: {
    id: string
    repoId: string
    baseBranch: string
    candidateBranch: string
    candidateSha: string
    position: number
    requiredChecksJson: string
    reviewGateJson: string
  }): Promise<MergeEntryRow>
  getMergeEntry(id: string): Promise<MergeEntryRow | null>
  listPendingMergeEntries(repoId: string): Promise<MergeEntryRow[]>
  updateMergeEntryState(id: string, state: string): Promise<MergeEntryRow>

  // Utility
  close(): void
}
