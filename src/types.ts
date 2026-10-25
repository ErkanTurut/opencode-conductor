// Phase 2: Core types for the supervisor

// --- Run Lifecycle ---

export const RUN_STATES = [
  'created',
  'intake',
  'awaiting_refinement',
  'discovered',
  'planned',
  'awaiting_plan_approval',
  'executing',
  'validating',
  'reviewing',
  'repairing',
  'integrating',
  'awaiting_merge_approval',
  'completed',
  'paused',
  'cancelled',
  'blocked',
  'timed_out',
  'failed',
] as const

export type RunState = (typeof RUN_STATES)[number]

export const ACTIVE_STATES = new Set<RunState>([
  'intake',
  'awaiting_refinement',
  'discovered',
  'planned',
  'awaiting_plan_approval',
  'executing',
  'validating',
  'reviewing',
  'repairing',
  'integrating',
  'awaiting_merge_approval',
])

export const TERMINAL_STATES = new Set<RunState>([
  'completed',
  'cancelled',
  'blocked',
  'timed_out',
  'failed',
])

// --- Work Item ---

export const WORK_ITEM_STATES = [
  'pending',
  'ready',
  'claimed',
  'running',
  'validating',
  'reviewing',
  'repairing',
  'completed',
  'failed',
  'blocked',
  'interrupted',
] as const

export type WorkItemState = (typeof WORK_ITEM_STATES)[number]

// --- Attempt ---

export const ATTEMPT_STATES = [
  'pending',
  'running',
  'completed',
  'failed',
  'timed_out',
  'cancelled',
  'interrupted',
] as const

export type AttemptState = (typeof ATTEMPT_STATES)[number]

export const ATTEMPT_FAILURE_CLASSES = [
  'timeout',
  'exit_nonzero',
  'malformed_output',
  'permission_denied',
  'path_violation',
  'provider_error',
  'crash',
  'cancelled',
  'unknown',
] as const

export type AttemptFailureClass = (typeof ATTEMPT_FAILURE_CLASSES)[number]

// --- Review Finding ---

export const SEVERITY_LEVELS = [
  'info',
  'low',
  'medium',
  'high',
  'critical',
] as const
export type Severity = (typeof SEVERITY_LEVELS)[number]

export const FINDING_CATEGORIES = [
  'correctness',
  'performance',
  'security',
  'style',
  'architecture',
  'testing',
  'documentation',
  'accessibility',
  'dependencies',
  'other',
] as const

export type FindingCategory = (typeof FINDING_CATEGORIES)[number]

// --- Risk Classes ---

export const RISK_CLASSES = ['low', 'medium', 'high', 'critical'] as const
export type RiskClass = (typeof RISK_CLASSES)[number]

// --- Data Classes ---

export const DATA_CLASSES = [
  'public',
  'internal',
  'confidential',
  'regulated',
] as const
export type DataClass = (typeof DATA_CLASSES)[number]

// --- Operation Modes ---

export const OPERATION_MODES = [
  'observe',
  'assisted',
  'autonomous-low-risk',
  'unattended',
  'release',
] as const

export type OperationMode = (typeof OPERATION_MODES)[number]

// --- Agent Roles ---

export const AGENT_ROLES = [
  'conductor',
  'requirements-refiner',
  'scout',
  'external-scout',
  'architect',
  'coder',
  'frontend-specialist',
  'test-engineer',
  'build-verifier',
  'critic',
  'security-critic',
  'integrator',
  'memory-curator',
] as const

export type AgentRole = (typeof AGENT_ROLES)[number]

export const MUTATING_ROLES = new Set<AgentRole>([
  'coder',
  'frontend-specialist',
  'test-engineer',
  'integrator',
])

export const READ_ONLY_ROLES = new Set<AgentRole>([
  'scout',
  'external-scout',
  'critic',
  'security-critic',
  'build-verifier',
])

// --- Model Role Slots ---

export const MODEL_ROLE_SLOTS = [
  'fast-triage',
  'architecture',
  'implementation',
  'ui-visual',
  'testing',
  'critique',
  'security',
  'integration',
] as const

export type ModelRoleSlot = (typeof MODEL_ROLE_SLOTS)[number]

// --- Budget ---

export interface BudgetConfig {
  max_concurrent_mutating_tasks: number
  max_concurrent_scouts: number
  max_dag_depth: number
  max_repair_rounds: number
  max_attempts_per_task: number
  max_task_wall_time_ms: number
  max_run_wall_time_ms: number
  max_plan_model_calls: number
  independent_reviewers: number
  unattended_merge_enabled: boolean
}

export const DEFAULT_BUDGET: BudgetConfig = {
  max_concurrent_mutating_tasks: 2,
  max_concurrent_scouts: 4,
  max_dag_depth: 8,
  max_repair_rounds: 3,
  max_attempts_per_task: 2,
  max_task_wall_time_ms: 20 * 60 * 1000,
  max_run_wall_time_ms: 2 * 60 * 60 * 1000,
  max_plan_model_calls: 2,
  independent_reviewers: 2,
  unattended_merge_enabled: false,
}

// --- Event ---

export const EVENT_TYPES = [
  'run_created',
  'run_state_transition',
  'refinement_requested',
  'refinement_completed',
  'refinement_declined',
  'work_item_created',
  'work_item_state_transition',
  'lease_claimed',
  'lease_expired',
  'lease_released',
  'attempt_started',
  'attempt_completed',
  'attempt_failed',
  'heartbeat',
  'verification_completed',
  'review_finding_created',
  'budget_consumed',
  'budget_exhausted',
  'merge_queued',
  'merge_completed',
  'merge_failed',
  'repair_started',
  'repair_completed',
  'run_cancelled',
  'run_paused',
  'run_resumed',
] as const

export type EventType = (typeof EVENT_TYPES)[number]
