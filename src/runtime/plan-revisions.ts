import { canonicalHash, validateTaskGraph, type SafetyDecision, type SafetyTask } from './run-safety'

export interface PlanTask extends SafetyTask {
  title?: string
  writeScope?: readonly string[]
}
export interface PlanSnapshot { version: 1; revision: string; parentRevision: string | null; reason: string; tasks: readonly PlanTask[] }
export interface PlanRevisionInput {
  tasks: readonly PlanTask[]
  parent: PlanSnapshot | null
  expectedParentRevision: string | null
  reason: string
}
export interface PlanRevisionResult extends SafetyDecision { snapshot?: PlanSnapshot }

function normalizedScope(path: string): string {
  return path.trim().replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\.\//, '').replace(/\/$/, '')
}
function scopesOverlap(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)
}

/** Validates immutable revision data before hashing it; no writes or CAS side effects. */
export function createPlanRevision(input: PlanRevisionInput): PlanRevisionResult {
  const tasks = Array.isArray(input?.tasks) ? input.tasks : []
  const reasons = [...validateTaskGraph(tasks).reasons]
  if (!Array.isArray(input?.tasks)) reasons.push({ code: 'invalid_task_graph', message: 'Task graph is unavailable or malformed' })
  if (typeof input.reason !== 'string' || !input.reason.trim()) reasons.push({ code: 'revision_reason_required', message: 'A revision reason is required' })
  const parentRevision = input.parent?.revision ?? null
  if (input.expectedParentRevision !== parentRevision) reasons.push({ code: 'stale_parent_revision', message: 'Expected parent revision does not match current revision' })
  const ids = new Set<string>()
  for (const task of tasks) {
    if (ids.has(task.id)) continue
    ids.add(task.id)
    if (!Array.isArray(task.writeScope)) continue
    const scopes = task.writeScope.map(normalizedScope)
    for (let i = 0; i < scopes.length; i++) {
      if (!scopes[i]) reasons.push({ code: 'invalid_write_scope', message: 'Write scope contains an empty path', taskId: task.id })
      for (let j = 0; j < i; j++) if (scopesOverlap(scopes[i]!, scopes[j]!)) reasons.push({ code: 'overlapping_task_scope', message: `Task declares overlapping write scopes ${scopes[i]} and ${scopes[j]}`, taskId: task.id })
    }
  }
  // Concurrent active tasks must not claim overlapping path scopes.
  const active = tasks.filter((task) => !['completed', 'failed', 'blocked'].includes(task.state))
  for (let i = 0; i < active.length; i++) for (let j = i + 1; j < active.length; j++) {
    for (const a of active[i]!.writeScope ?? []) for (const b of active[j]!.writeScope ?? []) {
      const left = normalizedScope(a), right = normalizedScope(b)
      if (left && right && scopesOverlap(left, right)) reasons.push({ code: 'overlapping_active_scopes', message: `Active tasks ${active[i]!.id} and ${active[j]!.id} have overlapping write scopes` , taskId: active[j]!.id })
    }
  }
  if (reasons.length) return { allowed: false, reasons }
  const snapshotTasks = tasks.map((task) => ({ ...task, dependencies: [...task.dependencies], writeScope: task.writeScope ? [...task.writeScope] : undefined }))
  const content = { version: 1 as const, parentRevision, reason: input.reason.trim(), tasks: snapshotTasks }
  const snapshot: PlanSnapshot = { ...content, revision: canonicalHash(content) }
  return { allowed: true, reasons: [], snapshot }
}

export interface RepairBudget { repairsUsed: number; maxRepairs: number; retriesUsed: number; maxRetriesPerTask: number }
export interface RepairRequest { taskId: string; kind: 'retry' | 'semantic-repair'; requestedScope: readonly string[]; existingScope: readonly string[]; scopeApproval?: { approved: boolean; taskId: string; scopeHash: string } | null }
export function decideRepair(request: RepairRequest, budget: RepairBudget): SafetyDecision {
  const reasons: Array<{ code: string; message: string; taskId?: string }> = []
  if (!request.taskId || !Number.isSafeInteger(budget.repairsUsed) || !Number.isSafeInteger(budget.maxRepairs) || !Number.isSafeInteger(budget.retriesUsed) || !Number.isSafeInteger(budget.maxRetriesPerTask)) reasons.push({ code: 'invalid_repair_budget', message: 'Repair budget or task identity is invalid' })
  if (request.kind === 'retry') {
    if (budget.retriesUsed >= budget.maxRetriesPerTask) reasons.push({ code: 'retry_budget_exhausted', message: 'Task retry budget is exhausted', taskId: request.taskId })
    if (request.requestedScope.some((path) => !request.existingScope.includes(path))) reasons.push({ code: 'retry_scope_changed', message: 'A retry cannot silently change task scope', taskId: request.taskId })
  } else {
    if (budget.repairsUsed >= budget.maxRepairs) reasons.push({ code: 'repair_budget_exhausted', message: 'Semantic repair budget is exhausted', taskId: request.taskId })
    const requested = request.requestedScope.map(normalizedScope)
    const existing = request.existingScope.map(normalizedScope)
    const newScope = requested.some((path) => !existing.includes(path))
    if (newScope) {
      const approval = request.scopeApproval
      const hash = canonicalHash(requested)
      if (!approval?.approved || approval.taskId !== request.taskId || approval.scopeHash !== hash) reasons.push({ code: 'new_scope_approval_required', message: 'Semantic repair adds scope and requires approval bound to task and exact scope', taskId: request.taskId })
    }
    if (requested.some((path, index) => !path || requested.slice(0, index).some((previous) => scopesOverlap(path, previous)))) reasons.push({ code: 'invalid_repair_scope', message: 'Repair scope is empty or overlapping', taskId: request.taskId })
  }
  return { allowed: reasons.length === 0, reasons }
}

export const repairExecutionClass = (kind: RepairRequest['kind']) => kind === 'retry' ? 'lease-retry' as const : 'semantic-repair' as const
