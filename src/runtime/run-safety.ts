import { createHash } from 'node:crypto'

export interface SafetyReason { code: string; message: string; taskId?: string }
export interface SafetyDecision { allowed: boolean; reasons: SafetyReason[] }
const decision = (reasons: SafetyReason[]): SafetyDecision => ({ allowed: reasons.length === 0, reasons })

export interface SafetyTask {
  id: string
  state: string
  dependencies: readonly string[]
  verificationCommands?: readonly string[] | null
  required?: boolean
  planRevision?: string | null
}
export interface AdmissionInput {
  tasks: readonly SafetyTask[]
  taskId: string
  currentRevision?: string
  expectedRevision?: string
}

/** Fail-closed DAG validation shared by claim and merge gates. Iterative O(V+E). */
export function validateTaskGraph(tasks: readonly SafetyTask[]): SafetyDecision {
  const reasons: SafetyReason[] = []
  if (!Array.isArray(tasks)) return { allowed: false, reasons: [{ code: 'invalid_task_graph', message: 'Task graph is unavailable or malformed' }] }
  const byId = new Map<string, SafetyTask>()
  for (const task of tasks) {
    if (!task || typeof task.id !== 'string' || !task.id.trim()) {
      reasons.push({ code: 'invalid_task_id', message: 'Task has a missing or invalid id' }); continue
    }
    if (byId.has(task.id)) reasons.push({ code: 'duplicate_task_id', message: `Duplicate task id: ${task.id}`, taskId: task.id })
    else byId.set(task.id, task)
  }
  const edges = new Map<string, string[]>()
  for (const task of byId.values()) {
    if (!Array.isArray(task.dependencies)) { reasons.push({ code: 'invalid_dependencies', message: 'Dependencies are unavailable or malformed', taskId: task.id }); edges.set(task.id, []); continue }
    const deps: string[] = []
    for (const dep of task.dependencies) {
      if (typeof dep !== 'string' || !byId.has(dep)) reasons.push({ code: 'unknown_dependency', message: `Unknown dependency: ${String(dep)}`, taskId: task.id })
      else deps.push(dep)
    }
    edges.set(task.id, deps)
  }
  // Iterative three-color DFS avoids call-stack overflow on large plans.
  const color = new Map<string, number>()
  for (const id of byId.keys()) {
    if (color.get(id)) continue
    color.set(id, 1)
    const stack: Array<{ id: string; next: number }> = [{ id, next: 0 }]
    while (stack.length) {
      const top = stack[stack.length - 1]!
      const neighbors = edges.get(top.id) ?? []
      if (top.next >= neighbors.length) { color.set(top.id, 2); stack.pop(); continue }
      const next = neighbors[top.next++]!
      if (color.get(next) === 1) reasons.push({ code: 'dependency_cycle', message: `Dependency cycle includes ${next}`, taskId: top.id })
      else if (!color.get(next)) { color.set(next, 1); stack.push({ id: next, next: 0 }) }
    }
  }
  return decision(reasons)
}

export function decideTaskAdmission(input: AdmissionInput): SafetyDecision {
  const tasks = Array.isArray(input?.tasks) ? input.tasks : []
  const reasons = [...validateTaskGraph(tasks).reasons]
  if (input.currentRevision !== undefined && input.expectedRevision !== input.currentRevision)
    reasons.push({ code: 'stale_plan_revision', message: 'Admission plan revision does not match the current immutable revision', taskId: input.taskId })
  const task = tasks.find((candidate) => candidate?.id === input.taskId)
  if (!task) reasons.push({ code: 'missing_task', message: 'Task is not present in the recorded plan', taskId: input.taskId })
  else {
    if (task.planRevision != null && task.planRevision !== input.currentRevision) reasons.push({ code: 'task_revision_mismatch', message: 'Task belongs to a different plan revision', taskId: task.id })
    if (task.state !== 'ready') reasons.push({ code: 'task_not_ready', message: `Task state ${String(task.state)} is not claimable`, taskId: task.id })
    for (const depId of Array.isArray(task.dependencies) ? task.dependencies : []) {
      const dep = tasks.find((candidate) => candidate?.id === depId)
      if (!dep || dep.state !== 'completed') reasons.push({ code: 'dependency_incomplete', message: `Dependency ${depId} is missing or not completed`, taskId: task.id })
    }
  }
  return decision(reasons)
}

export interface CompletionInput {
  taskId: string
  currentAttemptId: string | null
  currentFencingToken: number | null
  attemptId: string
  fencingToken: number
  attemptState: string
  exitCode: number | null
  requiredCommands: readonly string[] | null
  verificationResults: readonly { command: string; exitCode: number; passed?: boolean; attemptId?: string; fencingToken?: number }[] | null
}
export function decideTaskCompletion(input: CompletionInput): SafetyDecision {
  const reasons: SafetyReason[] = []
  if (!input.currentAttemptId || input.attemptId !== input.currentAttemptId) reasons.push({ code: 'stale_attempt', message: 'Evidence is not from the current attempt', taskId: input.taskId })
  if (!Number.isSafeInteger(input.fencingToken) || input.fencingToken <= 0 || input.currentFencingToken !== input.fencingToken) reasons.push({ code: 'stale_fencing_token', message: 'Evidence does not hold the current fencing token', taskId: input.taskId })
  if (input.attemptState !== 'completed') reasons.push({ code: 'attempt_not_successful', message: `Attempt state ${String(input.attemptState)} is not completed`, taskId: input.taskId })
  if (input.exitCode !== 0) reasons.push({ code: 'attempt_exit_nonzero', message: 'Attempt exit code is not zero', taskId: input.taskId })
  if (!Array.isArray(input.requiredCommands) || input.requiredCommands.length === 0) reasons.push({ code: 'missing_verification_commands', message: 'Required verification commands are missing or empty', taskId: input.taskId })
  if (!Array.isArray(input.verificationResults)) reasons.push({ code: 'missing_verification_evidence', message: 'Verification evidence is unavailable', taskId: input.taskId })
  else if (Array.isArray(input.requiredCommands)) {
    for (const command of input.requiredCommands) {
      const found = input.verificationResults.find((r) => r.command === command && r.exitCode === 0 && r.passed !== false && (r.attemptId === undefined || r.attemptId === input.attemptId) && (r.fencingToken === undefined || r.fencingToken === input.fencingToken))
      if (!found) reasons.push({ code: 'required_check_not_passed', message: `Required check lacks successful current-attempt evidence: ${command}`, taskId: input.taskId })
    }
  }
  return decision(reasons)
}

export interface MergeApproval { candidateSha?: string | null; planRevision?: string | null; policyHash?: string | null; expiresAt?: string | null; decision?: string; gate?: string }
export interface MergeInput {
  tasks: readonly SafetyTask[] | null
  candidateSha: string | null
  planRevision: string | null
  policyHash: string | null
  approval: MergeApproval | null
  now?: number
  requiredEvidenceValid: boolean
  blockingFindings: readonly { blocking: boolean }[] | null
  candidateAvailable: boolean
}
export function decideCandidateMerge(input: MergeInput): SafetyDecision {
  const reasons: SafetyReason[] = []
  const tasks = Array.isArray(input?.tasks) ? input.tasks : null
  if (!input.candidateAvailable || !input.candidateSha) reasons.push({ code: 'candidate_unavailable', message: 'Candidate SHA is unavailable; merge is denied' })
  if (!tasks?.length) reasons.push({ code: 'empty_or_missing_plan', message: 'A non-empty recorded task plan is required' })
  else {
    reasons.push(...validateTaskGraph(tasks).reasons)
    for (const task of tasks) if (task.state !== 'completed') reasons.push({ code: 'task_incomplete', message: `Task state ${String(task.state)} is not completed`, taskId: task.id })
  }
  if (!input.requiredEvidenceValid) reasons.push({ code: 'required_evidence_invalid', message: 'Required task verification evidence is missing or unsuccessful' })
  if (!input.blockingFindings) reasons.push({ code: 'findings_unavailable', message: 'Review findings are unavailable' })
  else if (input.blockingFindings.some((finding) => finding?.blocking === true)) reasons.push({ code: 'blocking_findings', message: 'Blocking findings remain unresolved' })
  const a = input.approval
  if (!a) reasons.push({ code: 'approval_missing', message: 'Explicit merge approval is required' })
  else {
    if (!a.candidateSha || !a.planRevision || !a.policyHash) reasons.push({ code: 'legacy_unbound_approval', message: 'Approval is legacy or not bound to candidate, plan revision, and policy' })
    if (a.decision !== 'approved' || a.gate !== 'merge') reasons.push({ code: 'approval_invalid', message: 'Approval must explicitly approve the merge gate' })
    if (a.candidateSha !== input.candidateSha || a.planRevision !== input.planRevision || a.policyHash !== input.policyHash) reasons.push({ code: 'approval_binding_mismatch', message: 'Approval does not match candidate SHA, plan revision, and policy' })
    const expiry = a.expiresAt ? Date.parse(a.expiresAt) : NaN
    if (!Number.isFinite(expiry) || expiry <= (input.now ?? Date.now())) reasons.push({ code: 'approval_expired_or_unbounded', message: 'Approval is expired or has no valid expiry' })
  }
  return decision(reasons)
}

export function canonicalHash(value: unknown): string {
  const canonical = (v: unknown): string => {
    if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'undefined'
    if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
    const obj = v as Record<string, unknown>
    return `{${Object.keys(obj).sort().map((key) => `${JSON.stringify(key)}:${canonical(obj[key])}`).join(',')}}`
  }
  return createHash('sha256').update(canonical(value)).digest('hex')
}
