import type {
  RunState,
  WorkItemState,
  AttemptState,
  AttemptFailureClass,
  Severity,
  FindingCategory,
  RiskClass,
  DataClass,
  OperationMode,
  AgentRole,
  EventType,
} from '../types'

// --- Row types ---

export interface RunRow {
  id: string
  parent_id: string | null
  repo_id: string
  request_hash: string
  data_class: DataClass
  policy_profile: string
  operation_mode: OperationMode
  state: RunState
  effective_workflow_hash: string | null
  risk_class: RiskClass
  request_text: string
  contract_json: string | null
  plan_json: string | null
  receipt_json: string | null
  budget_json: string
  created_at: string
  updated_at: string
  deadline_at: string | null
  terminal_reason: string | null
}

export interface WorkItemRow {
  id: string
  run_id: string
  issue_key: string
  title: string
  dependency_json: string
  owner_role: AgentRole
  model_slot: string
  state: WorkItemState
  priority: number
  attempts: number
  write_scope_json: string
  contract_json: string
  allowed_paths_json: string
  read_paths_json: string
  acceptance_criteria_json: string
  verification_commands_json: string
  created_at: string
  updated_at: string
}

export interface AttemptRow {
  id: string
  work_item_id: string
  attempt_no: number
  harness: string
  model_provider: string
  model_id: string
  model_variant: string | null
  workspace_id: string | null
  base_sha: string
  state: AttemptState
  started_at: string | null
  finished_at: string | null
  exit_code: number | null
  failure_class: AttemptFailureClass | 'plan_or_policy_invalidated' | null
  usage_json: string | null
  cost_json: string | null
  stdout_path: string | null
  stderr_path: string | null
  evidence_json: string | null
  created_at: string
}

export interface LeaseRow {
  work_item_id: string
  lease_owner: string
  lease_expires_at: string
  heartbeat_at: string
  fencing_token: number
  claimed_at: string
  released_at: string | null
}

export interface WorkspaceRow {
  id: string
  provider: string
  path: string
  branch: string
  base_sha: string
  head_sha: string | null
  status: string
  dirty: boolean
  quarantined_at: string | null
  rescue_branch: string | null
  cleanup_state: string | null
  created_at: string
}

export interface EventRow {
  sequence: number
  run_id: string
  work_item_id: string | null
  attempt_id: string | null
  event_type: EventType
  actor: string
  payload_json: string
  created_at: string
  correlation_id: string | null
}

export interface ApprovalRow {
  id: string
  run_id: string
  gate: string
  decision: string
  actor: string
  policy_hash: string | null
  created_at: string
  expires_at: string | null
}

export interface VerificationRow {
  id: string
  attempt_id: string
  profile: string
  command: string
  exit_code: number
  output_hash: string
  duration_ms: number
  stdout_path: string | null
  stderr_path: string | null
  started_at: string
  finished_at: string
}

export interface ReviewFindingRow {
  id: string
  review_id: string
  severity: Severity
  category: FindingCategory
  title: string
  fingerprint: string
  location: string | null
  evidence: string
  confidence: number
  blocking: boolean
  status: string
  required_fix: string | null
  created_at: string
}

export interface BudgetEventRow {
  id: string
  scope: string
  scope_id: string
  kind: string
  estimated: number | null
  actual: number | null
  currency: string
  provider: string | null
  model: string | null
  attempt_id: string | null
  created_at: string
}

export interface MergeEntryRow {
  id: string
  repo_id: string
  base_branch: string
  candidate_branch: string
  candidate_sha: string
  position: number
  state: string
  required_checks_json: string
  review_gate_json: string
  bisect_parent_id: string | null
  created_at: string
  merged_at: string | null
}
