import { collectWorkspaceChanges, validateChangedFiles, validateWorkspaceBinding } from './ledger/scope'
// Provenance: the scheduler pre-check wiring (fail-closed DAG + write-scope
// admission), unified verification dir, and stdout-only verification gate
// are adapted from the OmO comparison notes (idea 3 — rounds/sweep slot and
// evidence gating). Patterns only: no upstream source was copied.
// License: SUL-1.0.
import type { ILedger } from './ledger/interface'
import type { IAgentAdapter, AgentSpec } from './adapters/opencode-cli'
import type { BudgetConfig } from './types'
import { DEFAULT_BUDGET, MUTATING_ROLES } from './types'
import { OpenCodeCliAdapter } from './adapters/opencode-cli'
import { SqliteLedger } from './ledger/sqlite'
import { Scheduler } from './scheduler'
import type { TaskBatch } from './scheduler'
import {
  WorktreeProvider,
  canonicalWorktreeBranch,
  canonicalWorktreeId,
} from './worktrees'
import { Watchdog } from './watchdog'
import {
  selectFallbackModel,
  recordModelFailure,
  recordModelSuccess,
} from './model-router'
import type { ModelRegistry } from './model-router'
import type { SelectionEvent } from './model-router'
import {
  loadFleetConfig,
  buildModelRegistry,
  selectFleetModel,
} from './fleet-config'
import type { FleetConfig } from './fleet-config'
import {
  runVerification,
  getArtifactPaths,
  ensureArtifactDirs,
  isMutatingRole,
  type VerificationCommandGuard,
} from './artifacts'
import { generateReceipt, writeReceiptToDisk } from './receipt'
import type { AgentRole } from './types'
import { buildContractQuestions } from './jev/questions.js'
import { assessContract } from './jev/gates.js'
import type { JevAnnotation, JevContractAnswers } from './jev/gates.js'
import { isJevEnabled } from './jev/config.js'
import { evaluateWithJev } from './jev/client.js'
import {
  CANONICAL_SHELL_RULES,
  evaluateShellGate,
  isJevEgressAllowed,
  type PermissionRule,
} from './policy'
import { readFileSync } from 'node:fs'

/**
 * Parse a work item's recorded verification commands.
 *
 * Returns null when the record cannot be resolved (missing/non-string payload,
 * malformed JSON, or a non-array value). Callers must fail the attempt closed
 * with `no_verification_commands` in that case — never run unguarded.
 */
export function parseRecordedVerificationCommands(
  value: unknown,
): string[] | null {
  if (typeof value !== 'string' || value.length === 0) return null
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) return null
    if (parsed.some((entry) => typeof entry !== 'string' || !entry.trim())) return null
    return parsed
  } catch {
    return null
  }
}

/**
 * The shell authority for runner verification: the project's root
 * `opencode.json` permission.bash rules, falling back to the canonical mirror
 * (the same precedence the plugin's root rules use). Never a third hardcoded
 * copy.
 */
export function resolveVerificationShellRules(
  repoRoot: string,
): PermissionRule[] {
  let config: { permission?: { bash?: Record<string, unknown> } } | null = null
  try {
    config = JSON.parse(readFileSync(`${repoRoot}/opencode.json`, 'utf8'))
  } catch {
    config = null
  }
  const bash = config?.permission?.bash
  if (!bash || typeof bash !== 'object') return CANONICAL_SHELL_RULES
  const rules: PermissionRule[] = []
  for (const [resource, effect] of Object.entries(bash)) {
    if (resource === '*' || typeof effect !== 'string') continue
    rules.push({ action: 'shell', resource, effect })
  }
  return rules.length > 0 ? rules : CANONICAL_SHELL_RULES
}

/**
 * The guard handed to every runner `runVerification` call: exact allowlist
 * membership (the recorded commands) plus the policy shell gate. A command
 * outside the recorded set — or one the gate denies — is refused before any
 * spawn.
 */
export function makeRunnerVerificationGuard(
  recordedCommands: readonly string[],
  repoRoot: string,
): VerificationCommandGuard {
  const shellRules = resolveVerificationShellRules(repoRoot)
  return {
    allowed: [...recordedCommands],
    check(command: string) {
      // No interactive channel in a verification run: an `ask` rule denies.
      const decision = evaluateShellGate(command, shellRules, [], {
        askEffect: 'deny',
      })
      return { allowed: decision.allowed, reason: decision.reason }
    },
  }
}

export interface RunnerConfig {
  repoRoot: string
  mainRepoPath: string
  worktreeBasePath: string
  adapter?: IAgentAdapter
  budget?: Partial<BudgetConfig>
}

export interface RunResult {
  runId: string
  state: string
  receiptPath: string | null
  error?: string
}

export interface WorkItemContract {
  task_id: string
  run_id: string
  role: string
  objective: string
  acceptance_criteria: string[]
  verification_commands: string[]
  jev_contract?: JevAnnotation
}

/**
 * Attach a warn-only Jev contract annotation to a work-item contract.
 * Pure and fail-open: never throws, never blocks. Unknown keys on the
 * contract are preserved; only `jev_contract` is added/overwritten.
 * A null/undefined `jevAnswers` yields a `skipped` annotation.
 */
export function annotateContractWithJev(
  contract: WorkItemContract,
  jevAnswers?: JevContractAnswers | null,
): WorkItemContract {
  try {
    const safe = (contract ?? {}) as unknown as Record<string, unknown>
    const asStrings = (value: unknown): string[] => {
      if (!Array.isArray(value)) return []
      const out: string[] = []
      for (const item of value) {
        if (typeof item === 'string') out.push(item)
      }
      return out
    }
    const rawObjective = safe['objective']
    const rawTitle = safe['title']
    const title =
      typeof rawObjective === 'string'
        ? rawObjective
        : typeof rawTitle === 'string'
          ? rawTitle
          : ''
    const { annotation } = assessContract(
      {
        title,
        acceptance_criteria: asStrings(safe['acceptance_criteria']),
        verification_commands: asStrings(safe['verification_commands']),
        write_scope: asStrings(safe['write_scope']),
      },
      jevAnswers ?? null,
    )
    return { ...(safe as unknown as WorkItemContract), jev_contract: annotation }
  } catch {
    try {
      return {
        ...((contract as unknown as Record<string, unknown>) ?? {}),
        jev_contract: { jev_status: 'skipped' },
      } as WorkItemContract
    } catch {
      return contract
    }
  }
}

export class Runner {
  private ledger: ILedger
  private adapter: IAgentAdapter
  private scheduler: Scheduler
  private worktrees: WorktreeProvider
  private watchdog: Watchdog
  private config: RunnerConfig
  private fleetConfig: FleetConfig
  private modelRegistry: ModelRegistry

  constructor(config: RunnerConfig) {
    this.config = config
    this.ledger = new SqliteLedger(`${config.repoRoot}/.opencode/supervisor.db`)
    this.adapter = config.adapter ?? new OpenCodeCliAdapter()
    this.scheduler = new Scheduler(this.ledger)
    this.worktrees = new WorktreeProvider(this.ledger, {
      basePath: config.worktreeBasePath,
      mainRepoPath: config.mainRepoPath,
    })
    this.watchdog = new Watchdog(this.ledger)
    // Registry comes from the merged fleet-config view (built-ins patched
    // with persisted enabled flags + extra catalog entries).
    this.fleetConfig = loadFleetConfig()
    this.modelRegistry = buildModelRegistry(this.fleetConfig)
  }

  async createRun(
    objective: string,
    riskClass: string,
    dataClass: string,
    operationMode: string,
    budget?: Partial<BudgetConfig>,
  ): Promise<string> {
    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    await this.ledger.transaction(async (tx) => {
      await tx.createRun({
        id: runId,
        parentId: null,
        repoId: this.config.mainRepoPath,
        requestHash: Bun.hash(objective).toString(16),
        dataClass,
        policyProfile: operationMode,
        operationMode,
        riskClass,
        requestText: objective,
        budgetJson: JSON.stringify(budget ?? {}),
        deadlineAt: null,
      })
      await tx.appendEvent({
        runId,
        eventType: 'run_created',
        actor: 'supervisor',
        payloadJson: JSON.stringify({
          objective,
          riskClass,
          dataClass,
          operationMode,
        }),
      })
    })

    return runId
  }

  async addWorkItem(
    runId: string,
    params: {
      title: string
      ownerRole: AgentRole
      modelSlot: string
      priority: number
      writeScope: string[]
      allowedPaths: string[]
      acceptanceCriteria: string[]
      verificationCommands: string[]
      dependencies?: string[]
    },
  ): Promise<string> {
    const itemId = `wi-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

    let contract: WorkItemContract = {
      task_id: itemId,
      run_id: runId,
      role: params.ownerRole,
      objective: params.title,
      acceptance_criteria: params.acceptanceCriteria,
      verification_commands: params.verificationCommands,
    }

    // Jev contract pre-check (warn-only): fail-open, zero-fetch when
    // disabled. Never throws, never blocks item creation; existing
    // consumers ignore the optional `jev_contract` key.
    // Data-class gate: confidential/regulated runs never egress to the
    // remote judge (local/no-model path instead); the skip is recorded.
    try {
      if (isJevEnabled()) {
        const run = await this.ledger.getRun(runId)
        if (!isJevEgressAllowed(run?.data_class)) {
          await this.ledger.appendEvent({
            runId,
            eventType: 'jev_skipped_data_class',
            actor: 'supervisor',
            payloadJson: JSON.stringify({
              data_class: run?.data_class ?? null,
              site: 'addWorkItem',
            }),
          })
          contract = annotateContractWithJev(contract, null)
        } else {
          const bundle = buildContractQuestions({
            title: params.title,
            acceptance_criteria: params.acceptanceCriteria,
            verification_commands: params.verificationCommands,
            write_scope: params.writeScope,
          })
          const result = await evaluateWithJev(
            bundle.state,
            bundle.questions as unknown as Record<string, unknown>,
          )
          if (result.ok) {
            contract = annotateContractWithJev(
              contract,
              result.answers as unknown as JevContractAnswers,
            )
          } else {
            contract = annotateContractWithJev(contract, null)
          }
        }
      }
    } catch {
      // Fail-open: proceed without a Jev annotation.
    }

    // Scheduler admission pre-check (fail-closed, never silent): reject a
    // new work item that would introduce a dependency cycle or an active
    // write-scope overlap. A `work_item_rejected` event is appended before
    // the error is thrown so the rejection is always attributable.
    const existingItems = await this.ledger.listWorkItems(runId)

    const dagCheck = this.scheduler.validateDag([
      ...existingItems.map((i) => ({
        id: i.id,
        dependencyJson: i.dependency_json,
      })),
      { id: itemId, dependencyJson: JSON.stringify(params.dependencies ?? []) },
    ])
    if (!dagCheck.valid) {
      await this.ledger.appendEvent({
        runId,
        workItemId: itemId,
        eventType: 'work_item_rejected',
        actor: 'supervisor',
        payloadJson: JSON.stringify({
          reason: 'dependency_cycle',
          cycles: dagCheck.cycles,
        }),
      })
      throw new Error(
        `addWorkItem rejected: dependency cycle detected (${JSON.stringify(dagCheck.cycles)})`,
      )
    }

    const ownershipCheck = this.scheduler.validateWriteOwnership([
      ...existingItems.map((i) => ({
        id: i.id,
        writeScopeJson: i.write_scope_json,
        state: i.state,
      })),
      {
        id: itemId,
        writeScopeJson: JSON.stringify(params.writeScope),
        state: 'pending',
      },
    ])
    if (!ownershipCheck.valid) {
      await this.ledger.appendEvent({
        runId,
        workItemId: itemId,
        eventType: 'work_item_rejected',
        actor: 'supervisor',
        payloadJson: JSON.stringify({
          reason: 'write_ownership_conflict',
          conflicts: ownershipCheck.conflicts,
        }),
      })
      throw new Error(
        `addWorkItem rejected: overlapping write scope (${JSON.stringify(ownershipCheck.conflicts)})`,
      )
    }

    await this.ledger.transaction(async (tx) => {
      await tx.createWorkItem({
        id: itemId,
        runId,
        issueKey: '',
        title: params.title,
        dependencyJson: JSON.stringify(params.dependencies ?? []),
        ownerRole: params.ownerRole,
        modelSlot: params.modelSlot,
        priority: params.priority,
        writeScopeJson: JSON.stringify(params.writeScope),
        contractJson: JSON.stringify(contract),
        allowedPathsJson: JSON.stringify(params.allowedPaths),
        readPathsJson: JSON.stringify([]),
        acceptanceCriteriaJson: JSON.stringify(params.acceptanceCriteria),
        verificationCommandsJson: JSON.stringify(params.verificationCommands),
      })
      await tx.appendEvent({
        runId,
        workItemId: itemId,
        eventType: 'work_item_created',
        actor: 'supervisor',
        payloadJson: JSON.stringify({
          title: params.title,
          role: params.ownerRole,
        }),
      })
    })

    await this.scheduler.markReadyItems(runId)
    return itemId
  }

  /**
   * Read-only scheduler passthrough: compute the next dispatchable batch for
   * a run without claiming leases or mutating any state. Mirrors the budget
   * resolution used by `executeTask`.
   */
  async getNextBatch(runId: string): Promise<TaskBatch> {
    const run = await this.ledger.getRun(runId)
    const budget: BudgetConfig = {
      ...DEFAULT_BUDGET,
      ...JSON.parse(run?.budget_json || '{}'),
    }
    return this.scheduler.getNextBatch(runId, budget)
  }

  async executeTask(
    workItemId: string,
  ): Promise<{ success: boolean; error?: string }> {
    const item = await this.ledger.getWorkItem(workItemId)
    if (!item) return { success: false, error: 'Work item not found' }

    const run = await this.ledger.getRun(item.run_id)
    if (!run) return { success: false, error: 'Run not found' }

    const budget: BudgetConfig = {
      ...JSON.parse(run.budget_json || '{}'),
    }

    // Select model (fleet-config aware: overrides + disabled exclusion)
    const role = item.owner_role as AgentRole

    // Selection observability. Every evaluated rung is ledgered as a
    // rung-schema SelectionEvent (`model_selected` /
    // `no_cross_family_substitution`) so routing decisions survive process exit
    // and `ModelRouter.restore` can rebuild breaker + last-rung memory.
    const onSelection = async (event: SelectionEvent) => {
      try {
        await this.ledger.appendEvent({
          runId: item.run_id,
          workItemId,
          eventType: event.type,
          actor: 'supervisor',
          payloadJson: JSON.stringify(event),
        })
      } catch {
        // Observability must never block or fail task execution.
      }
    }

    // Feature test (NOT an arity gate): the options-aware selector names its
    // `onSelection` option in the source; the legacy 3-arg selector never
    // mentions it. `Function.length` reports 3 for a defaulted options param,
    // so arity cannot distinguish the merged t6 API — this probe does.
    const supportsObserver = (() => {
      try {
        return /onSelection/.test(Function.prototype.toString.call(selectFleetModel))
      } catch {
        return false
      }
    })()
    const selection = supportsObserver
      ? selectFleetModel(this.modelRegistry, this.fleetConfig, role, { onSelection })
      : selectFleetModel(this.modelRegistry, this.fleetConfig, role)
    if (!selection) {
      return { success: false, error: 'No available model for role' }
    }

    const attemptId = `att-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const leaseOwner = `worker-${process.pid}`
    const leaseExpiry = new Date(Date.now() + (budget.max_task_wall_time_ms ?? DEFAULT_BUDGET.max_task_wall_time_ms)).toISOString()
    const claim = this.ledger.claimTaskAtomic ? await this.ledger.claimTaskAtomic({
      runId: item.run_id, workItemId, leaseOwner, leaseExpiresAt: leaseExpiry,
      attempt: { id: attemptId, workItemId, harness: 'opencode-cli', modelProvider: selection.providerId,
        modelId: selection.modelId, modelVariant: selection.variant ?? null, workspaceId: null, baseSha: '' },
    }) : { claimed: false, fencingToken: -1, error: 'Atomic admission unavailable' }
    if (!claim.claimed) return { success: false, error: claim.error ?? 'Failed to claim lease' }

    // Create worktree for mutating tasks
    let worktreeId: string | null = null
    let worktreePath: string = this.config.mainRepoPath
    let workspaceBaseSha = ''

    // Shared role partition (types.ts): only mutating roles get a worktree and
    // only they are held to the non-empty verification gate.
    const isMutating = isMutatingRole(role)

    if (MUTATING_ROLES.has(role)) {
      // Canonical id + branch come from the provider module (worktrees.ts), the
      // single source of truth shared with the .opencode plugin, so the runner
      // can no longer carry its own `supervisor/<run>/<item>` scheme.
      worktreeId = canonicalWorktreeId(workItemId)

      try {
        const baseSha = await this.worktrees.resolveBaseSha()
        workspaceBaseSha = baseSha

        const wt = await this.worktrees.createWorktree(
          worktreeId,
          canonicalWorktreeBranch(workItemId),
          baseSha,
        )
        worktreePath = wt.path
      } catch (e) {
        await this.ledger.finishTaskAtomic?.({ runId: item.run_id, workItemId, attemptId, fencingToken: claim.fencingToken, success: false, exitCode: null, failureClass: 'workspace_error', usageJson: null, evidenceJson: null })
        return { success: false, error: `Failed to create worktree: ${e}` }
      }
    }

    try {
      // Read-only tasks can run in non-git directories; no source base is
      // asserted there. Mutating work always requires a real git base.
      if (isMutating) {
        const workspace = worktreeId ? await this.ledger.getWorkspace(worktreeId) : null
        if (!workspace || workspace.base_sha !== workspaceBaseSha || !(await validateWorkspaceBinding(this.config.mainRepoPath, workspace, canonicalWorktreeId(workItemId), canonicalWorktreeBranch(workItemId), true))) throw new Error('Authoritative task workspace binding unavailable')
      }
      const bound = await this.ledger.bindAttemptWorkspace?.(attemptId, workItemId, claim.fencingToken, worktreeId, workspaceBaseSha)
      if (!bound) throw new Error('Stale attempt or workspace binding unavailable')
    } catch (error) {
      await this.ledger.finishTaskAtomic?.({ runId: item.run_id, workItemId, attemptId, fencingToken: claim.fencingToken, success: false, exitCode: null, failureClass: 'workspace_error', usageJson: null, evidenceJson: null })
      return { success: false, error: `Failed to bind task workspace: ${error}` }
    }

    // Start heartbeat
    this.watchdog.startHeartbeat(workItemId, claim.fencingToken)

    // Set up artifact paths
    const paths = getArtifactPaths(item.run_id, this.config.repoRoot)

    // Everything from here runs under one try/finally: the fencing lease is
    // ALWAYS released and the heartbeat stopped — on the success return, on
    // the failure return, and on any throw from verification or evidence
    // recording. Previously the release lived inline in each branch, so a
    // throw between heartbeat start and the release stranded the lease until
    // expiry (and leaked the interval).
    try {
      await ensureArtifactDirs(paths)

      // Build agent spec
      const allowedPaths: string[] = JSON.parse(item.allowed_paths_json)
      const acceptanceCriteria: string[] = JSON.parse(
        item.acceptance_criteria_json,
      )
      // Fail closed when the recorded profile cannot be resolved (`null`):
      // an unusable verification record must never become an unguarded run.
      const recordedCommands = parseRecordedVerificationCommands(
        item.verification_commands_json,
      )
      const verificationCommands: string[] = recordedCommands ?? []

      const spec: AgentSpec = {
        taskId: item.id,
        runId: item.run_id,
        objective: item.title,
        role: item.owner_role,
        model: `${selection.providerId}/${selection.modelId}`,
        variant: selection.variant,
        worktree: worktreePath,
        allowedPaths,
        acceptanceCriteria,
        verificationCommands,
        mustNot: [
          'Do not edit files outside allowed paths',
          'Do not read .env files or credentials',
          'Do not commit or push',
        ],
      }

      // Execute
      let sessionId: string | null = null
      let resultResult: Awaited<
        ReturnType<IAgentAdapter['streamEvents']>
      > | null = null

      try {
        sessionId = await this.adapter.start(spec)

        const abortController = new AbortController()
        const timeout = setTimeout(
          () => abortController.abort(),
          budget.max_task_wall_time_ms,
        )

        resultResult = await this.adapter.streamEvents(
          sessionId,
          () => {},
          abortController.signal,
        )

        clearTimeout(timeout)
      } catch (e) {
        resultResult = {
          sessionId: sessionId ?? 'unknown',
          exitCode: -1,
          stdout: '',
          stderr: String(e),
          durationMs: 0,
          usage: null,
          artifacts: [],
          success: false,
        }
      }

      // Record outcome
      if (resultResult.success) {
        recordModelSuccess(this.modelRegistry, selection.key)

        // Run verification into the unified verification dir. An empty command
        // list is a hard failure FOR MUTATING ROLES: `[].every(...)` is vacuously
        // true and would otherwise complete the task without any check.
        // Read-only roles (scout/critic/…) legitimately declare no commands: an
        // empty profile is a neutral skip (`verification_skipped`), never a
        // failure, and never a false pass either — it still requires exit 0.
        const hasVerificationCommands = verificationCommands.length > 0
        // An unparseable/unresolvable record fails closed: no command runs and
        // the attempt is recorded as `no_verification_commands`.
        const verificationUnresolved = recordedCommands === null
        const verificationResults = hasVerificationCommands
          ? await runVerification(
              verificationCommands,
              worktreePath,
              attemptId,
              this.ledger,
              paths.verificationDir,
              undefined,
              role,
              // R1: the runner is never the ungated path. The recorded set is
              // the allowlist and the policy shell gate may only narrow it.
              makeRunnerVerificationGuard(
                verificationCommands,
                this.config.repoRoot,
              ),
            )
          : []

        // NOTE: Jev never overrides this gate. The agent's own exit code counts
        // too: `completed` mirrors the plugin's record_evidence gate
        // (exit_code === 0 && allPassed), so a clean verification profile cannot
        // mask a non-zero agent exit. Empty + mutating => failed; empty +
        // read-only => neutral pass; unresolvable record => failed.
        const verificationSkipped =
          !isMutating && !hasVerificationCommands && !verificationUnresolved
        const allPassed = verificationUnresolved
          ? false
          : verificationSkipped
            ? true
            : hasVerificationCommands && verificationResults.length === verificationCommands.length && verificationResults.every((r) => r.passed)
        let changedFiles: string[] = []
        let scopeError: string | null = null
        if (isMutating) {
          try {
            const attempt = await this.ledger.getAttempt(attemptId)
            const workspace = worktreeId ? await this.ledger.getWorkspace(worktreeId) : null
            if (!attempt || !workspace || attempt.workspace_id !== worktreeId || attempt.base_sha !== workspace.base_sha || !(await validateWorkspaceBinding(this.config.mainRepoPath, workspace, canonicalWorktreeId(workItemId), canonicalWorktreeBranch(workItemId), false))) throw new Error('workspace binding unavailable')
            changedFiles = await collectWorkspaceChanges(worktreePath, attempt?.base_sha ?? '')
            const writeScopes = JSON.parse(item.write_scope_json)
            if (!Array.isArray(writeScopes) || !Array.isArray(allowedPaths)) throw new Error('invalid scope data')
            scopeError = validateChangedFiles(worktreePath, changedFiles, writeScopes, allowedPaths)
          } catch { scopeError = 'scope_evidence_unavailable' }
        }
        const completed = resultResult.exitCode === 0 && allPassed && !scopeError
        // The empty-profile failure class is reserved for MUTATING roles and
        // unresolvable records: a read-only task that declares no commands but
        // exits non-zero is an ordinary `exit_nonzero`, never a
        // missing-verification-profile failure.
        const failureClass = completed
          ? null
          : scopeError ?? (verificationUnresolved || (!hasVerificationCommands && isMutating)
            ? 'no_verification_commands'
            : allPassed
              ? 'exit_nonzero'
              : verificationResults.some(r => r.exitCode === 124) ? 'infrastructure_timeout_or_exit_124' : 'verification_failed')

        // Get evidence
        const evidence = {
          attempted_at: new Date().toISOString(),
          model: `${selection.providerId}/${selection.modelId}`,
          model_key: selection.key,
          duration_ms: resultResult.durationMs,
          usage: resultResult.usage,
          verification_results: verificationResults,
          all_checks_passed: allPassed && !scopeError,
          verification_skipped: verificationSkipped,
          failure_class: failureClass,
          changed_files: changedFiles,
          scope_enforcement: isMutating ? (scopeError ?? 'checked') : 'not_applicable',
        }

        const recorded = await this.ledger.finishTaskAtomic?.({ runId: item.run_id, workItemId, attemptId,
          fencingToken: claim.fencingToken, success: completed, exitCode: resultResult.exitCode,
          failureClass, usageJson: resultResult.usage ? JSON.stringify(resultResult.usage) : null,
          evidenceJson: JSON.stringify(evidence) })
        if (!recorded) return { success: false, error: 'Stale attempt or fencing token' }

        if (completed) {
          // Read-only tasks with no commands: record that the gate was skipped
          // rather than silently passing an empty profile.
          if (verificationSkipped) {
            await this.ledger.appendEvent({
              runId: item.run_id,
              workItemId,
              attemptId,
              eventType: 'verification_skipped',
              actor: 'supervisor',
              payloadJson: JSON.stringify({
                passed: true,
                role,
                reason: 'no_verification_commands_for_read_only_role',
                results: [],
              }),
            })
          }
          await this.ledger.appendEvent({
            runId: item.run_id,
            workItemId,
            attemptId,
            eventType: 'work_item_state_transition',
            actor: 'supervisor',
            payloadJson: JSON.stringify({ from: 'running', to: 'completed' }),
          })
        } else {
          await this.ledger.appendEvent({
            runId: item.run_id,
            workItemId,
            attemptId,
            eventType: 'verification_completed',
            actor: 'supervisor',
            payloadJson: JSON.stringify({
              passed: false,
              failure_class: failureClass,
              results: verificationResults,
            }),
          })
        }

        return { success: completed }
      }

      // Failure path
      recordModelFailure(this.modelRegistry, selection.key)

      // Try fallback model
      const fallback = selectFallbackModel(
        this.modelRegistry,
        selection.key,
        role,
      )
      if (fallback) {
        // Could retry with fallback, but defer to repair loop for now
        await this.ledger.appendEvent({
          runId: item.run_id,
          workItemId,
          attemptId,
          eventType: 'attempt_failed',
          actor: 'supervisor',
          payloadJson: JSON.stringify({
            reason: 'primary_model_failed',
            fallback_available: fallback.key,
          }),
        })
      }

      const recorded = await this.ledger.finishTaskAtomic?.({ runId: item.run_id, workItemId, attemptId,
        fencingToken: claim.fencingToken, success: false, exitCode: resultResult.exitCode,
        failureClass: resultResult.exitCode !== 0 ? 'exit_nonzero' : 'unknown',
        usageJson: resultResult.usage ? JSON.stringify(resultResult.usage) : null, evidenceJson: null })
      if (!recorded) return { success: false, error: 'Stale attempt or fencing token' }

      return {
        success: false,
        error: resultResult.stderr || 'Task execution failed',
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await this.ledger.finishTaskAtomic?.({ runId: item.run_id, workItemId, attemptId, fencingToken: claim.fencingToken, success: false, exitCode: null, failureClass: /timed?\s*out|timeout/i.test(message) ? 'infrastructure_timeout' : 'verification_or_runtime_error', usageJson: null, evidenceJson: JSON.stringify({ error: message }) })
      return { success: false, error: message }
    } finally {
      // Lease release is unconditional: success, failure, or throw.
      this.watchdog.stopHeartbeat(workItemId)
      await this.ledger.releaseLease(workItemId, claim.fencingToken)
    }
  }

  /**
   * Per-node retry. Parks a failed/interrupted node back in the non-terminal
   * `ready` state and records a `node_retry` event carrying the SAME node
   * inputs hash, so the next dispatch re-runs the identical node as a new
   * attempt (the normal dispatch path claims a fresh fencing token and creates
   * the attempt row). It never jumps a node to a terminal state and never
   * re-runs already-finished sibling nodes.
   */
  async retryNode(
    workItemId: string,
    reason = 'operator_retry',
  ): Promise<{
    workItemId: string
    previousAttemptId: string | null
    nextAttemptNo: number
    state: string
  }> {
    const item = await this.ledger.getWorkItem(workItemId)
    if (!item) throw new Error(`retryNode: work item not found: ${workItemId}`)
    if (item.state === 'running') {
      throw new Error(`retryNode: node ${workItemId} is already running`)
    }
    const run = await this.ledger.getRun(item.run_id)
    let maxAttempts = DEFAULT_BUDGET.max_attempts_per_task
    try { maxAttempts = JSON.parse(run?.budget_json ?? '{}').max_attempts_per_task ?? maxAttempts } catch { throw new Error('retryNode: invalid budget') }
    if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || item.attempts >= maxAttempts) throw new Error('retryNode: attempt budget exhausted')

    const previous = await this.ledger.getLatestAttempt(workItemId)
    const inputsHash = String(
      Bun.hash(
        [
          item.title,
          item.owner_role,
          item.allowed_paths_json,
          item.acceptance_criteria_json,
          item.verification_commands_json,
        ].join('\u0000'),
      ),
    )
    // Next attempt number is derived from BOTH counters so a manually recorded
    // attempt row still yields a strictly increasing number.
    const nextAttemptNo =
      Math.max(item.attempts, previous?.attempt_no ?? 0) + 1

    await this.ledger.appendEvent({
      runId: item.run_id,
      workItemId,
      attemptId: previous?.id ?? undefined,
      eventType: 'node_retry',
      actor: 'supervisor',
      payloadJson: JSON.stringify({
        reason,
        same_inputs: true,
        inputs_hash: inputsHash,
        previous_attempt_id: previous?.id ?? null,
        next_attempt_no: nextAttemptNo,
        model: previous
          ? `${previous.model_provider}/${previous.model_id}`
          : null,
      }),
    })

    let state = item.state
    if (item.state === 'failed' || item.state === 'interrupted') {
      await this.ledger.transitionWorkItemState(workItemId, 'ready')
      state = 'ready'
      await this.ledger.appendEvent({
        runId: item.run_id,
        workItemId,
        eventType: 'work_item_state_transition',
        actor: 'supervisor',
        payloadJson: JSON.stringify({
          from: item.state,
          to: 'ready',
          reason: 'node_retry',
        }),
      })
    }

    return {
      workItemId,
      previousAttemptId: previous?.id ?? null,
      nextAttemptNo,
      state,
    }
  }

  /**
   * Per-node amend. Extends a node's acceptance criteria in place and records
   * a `node_amended` event. Additive only: the amendment can narrow/lengthen
   * what "done" means for the SAME node, but it never transitions the work
   * item and never invents a completed state — a shortcut state jump is
   * impossible because only an explicit event accompanies the change.
   */
  async amendNode(
    workItemId: string,
    amendment: { acceptanceCriteria?: string[]; reason?: string },
  ): Promise<{ workItemId: string; acceptanceCriteria: string[]; added: string[] }> {
    const item = await this.ledger.getWorkItem(workItemId)
    if (!item) throw new Error(`amendNode: work item not found: ${workItemId}`)

    let existing: string[] = []
    try {
      const parsed = JSON.parse(item.acceptance_criteria_json)
      if (Array.isArray(parsed)) {
        existing = parsed.filter((c): c is string => typeof c === 'string')
      }
    } catch {
      existing = []
    }

    const requested = Array.isArray(amendment.acceptanceCriteria)
      ? amendment.acceptanceCriteria.filter(
          (c): c is string => typeof c === 'string' && c.length > 0,
        )
      : []
    const added = requested.filter((c) => !existing.includes(c))
    const next = [...existing, ...added]

    // Structural: the frozen ILedger interface has no acceptance mutator, so
    // the real ledger is feature-detected. When a substitute ledger cannot
    // persist it, the `node_amended` event below is still the durable record.
    const amender = this.ledger as ILedger & {
      replaceWorkItemAcceptance?(
        id: string,
        acceptanceCriteriaJson: string,
      ): Promise<unknown>
    }
    if (typeof amender.replaceWorkItemAcceptance === 'function') {
      await amender.replaceWorkItemAcceptance(
        workItemId,
        JSON.stringify(next),
      )
    }

    await this.ledger.appendEvent({
      runId: item.run_id,
      workItemId,
      eventType: 'node_amended',
      actor: 'supervisor',
      payloadJson: JSON.stringify({
        reason: amendment.reason ?? 'operator_amend',
        added_criteria: added,
        acceptance_criteria: next,
      }),
    })

    return { workItemId, acceptanceCriteria: next, added }
  }

  async generateRunReceipt(runId: string): Promise<string> {
    const receipt = await generateReceipt(runId, this.ledger)
    const paths = getArtifactPaths(runId, this.config.repoRoot)
    await ensureArtifactDirs(paths)
    const receiptPath = `${paths.runDir}/receipt.md`
    await writeReceiptToDisk(receipt, receiptPath)
    return receiptPath
  }

  async cancelRun(runId: string): Promise<void> {
    this.watchdog.stopAll()
    await this.ledger.transaction(async (tx) => {
      await tx.transitionRunState(runId, 'cancelled', 'Cancelled by supervisor')
      await tx.appendEvent({
        runId,
        eventType: 'run_cancelled',
        actor: 'supervisor',
        payloadJson: JSON.stringify({}),
      })
    })
  }

  async reconcile(): Promise<void> {
    // Capture stale leases BEFORE recovery: the fencing recovery releases
    // them, and `findStaleHeartbeats` only returns rows with
    // `released_at IS NULL`, so the interrupted-item scan below must run off
    // the pre-recovery snapshot.
    const staleLeases = await this.watchdog.findStaleHeartbeats()

    // Recover stale leases (real fencing UPDATE + lease_recovered event).
    await this.watchdog.recoverStaleLeases()

    // Find interrupted work items
    for (const stale of staleLeases) {
      const item = await this.ledger.getWorkItem(stale.workItemId)
      if (item && item.state === 'running') {
        await this.ledger.transitionWorkItemState(
          stale.workItemId,
          'interrupted',
        )
        await this.ledger.appendEvent({
          runId: item.run_id,
          workItemId: stale.workItemId,
          eventType: 'lease_expired',
          actor: 'supervisor',
          payloadJson: JSON.stringify({
            reason: 'stale_heartbeat',
            previousState: 'running',
          }),
        })
      }
    }
  }

  async resumeRun(runId: string): Promise<RunResult> {
    const run = await this.ledger.getRun(runId)
    if (!run)
      return {
        runId,
        state: 'unknown',
        receiptPath: null,
        error: 'Run not found',
      }

    await this.reconcile()

    return {
      runId,
      state: run.state,
      receiptPath: null,
    }
  }

  close(): void {
    this.watchdog.stopAll()
    this.ledger.close()
  }
}
