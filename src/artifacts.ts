// Provenance: the verification artifact layout (unified verification dir,
// stdout-only output hash, per-command id `${attempt}-verify-${hash}`) is
// adapted from the OmO comparison notes (idea 3 — rounds/sweep evidence
// gating). Patterns only: no upstream source was copied. License: SUL-1.0.
import { $ } from 'bun'
import { createHash } from 'node:crypto'
import type { ILedger } from './ledger/interface'
import type { AgentRole } from './types'
import { MUTATING_ROLES } from './types'
// Single path authority: run directories come from StateLayout, never from a
// locally interpolated `.opencode/runs` here. Extensionless on purpose (the
// package's tsc baseline rejects `.ts`-suffixed imports).
import {
  artifactPathsFor,
  resolveStateLayout,
  type ArtifactPaths,
  type StateLayout,
} from './runtime/state-layout'

export type { ArtifactPaths } from './runtime/state-layout'

export interface VerificationResult {
  command: string
  exitCode: number
  durationMs: number
  stdoutHash: string
  stdoutPath: string | null
  stderrPath: string | null
  passed: boolean
}

/**
 * Thrown when a MUTATING task is asked to verify without any verification
 * commands. The failure_class is fixed so callers can map it onto the attempt
 * row and refuse to mark the task completed (empty `every([])` is vacuously
 * true).
 *
 * Read-only roles (scout/critic/security-critic/build-verifier/…) legitimately
 * have no commands to run: for them an empty profile is a neutral skip, not an
 * error (see `isMutatingRole` / `runVerification`).
 */
export class NoVerificationCommandsError extends Error {
  readonly failureClass = 'no_verification_commands'

  constructor() {
    super(
      'Refusing to verify: no verification commands were declared for this task',
    )
    this.name = 'NoVerificationCommandsError'
  }
}

/**
 * Thrown when a verification command is not permitted by the caller-supplied
 * guard. The check runs BEFORE any spawn, so a refused command never reaches a
 * shell; the `failureClass` is fixed so callers can map it onto the attempt row
 * exactly like `NoVerificationCommandsError`.
 *
 * `command` names the refused command; `reason` carries the guard's own reason
 * (`not_in_allowlist`, or the shell gate's deny reason).
 */
export class VerificationCommandRefusedError extends Error {
  readonly failureClass = 'verification_command_refused'
  readonly command: string
  readonly reason: string

  constructor(command: string, reason: string) {
    super(`Refusing to run verification command (${reason}): ${command}`)
    this.name = 'VerificationCommandRefusedError'
    this.command = command
    this.reason = reason
  }
}

/**
 * Allowlist + policy gate for verification commands.
 *
 * `allowed` is matched by EXACT string equality: a command the task did not
 * declare can never be substituted by a prompt-injected instruction, and a glob
 * can never widen the set. `check` is the shell-policy gate; it may only narrow
 * the allowlist further (it is consulted for every allowed command).
 */
export interface VerificationCommandGuard {
  readonly allowed: readonly string[]
  check(command: string): { allowed: boolean; reason?: string }
}

/** Fixed reason recorded when a command is absent from `guard.allowed`. */
export const VERIFICATION_NOT_IN_ALLOWLIST = 'not_in_allowlist'

/**
 * Throw `VerificationCommandRefusedError` for the first command the guard
 * refuses. The WHOLE list is validated before anything spawns, so a refused
 * command at position N cannot leave the earlier commands' side effects behind.
 *
 * A malformed guard (missing/non-array `allowed`, missing `check`) fails
 * closed: it refuses rather than falling back to unguarded execution.
 */
export function assertVerificationCommandsAllowed(
  commands: readonly string[],
  guard: VerificationCommandGuard,
): void {
  const allowed = Array.isArray(guard?.allowed) ? guard.allowed : []
  const check = typeof guard?.check === 'function' ? guard.check.bind(guard) : null

  for (const command of commands) {
    if (!allowed.includes(command)) {
      throw new VerificationCommandRefusedError(
        command,
        VERIFICATION_NOT_IN_ALLOWLIST,
      )
    }
    if (!check) {
      throw new VerificationCommandRefusedError(command, 'no_policy_gate')
    }
    let decision: { allowed: boolean; reason?: string }
    try {
      decision = check(command)
    } catch (err) {
      // A gate that throws is a denial, never an allow.
      throw new VerificationCommandRefusedError(
        command,
        `policy_gate_error: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
    if (!decision || decision.allowed !== true) {
      throw new VerificationCommandRefusedError(
        command,
        decision?.reason ?? 'policy_denied',
      )
    }
  }
}

/**
 * True when `role` belongs to MUTATING_ROLES. Mirrors the scheduler's role
 * partition: a non-member (read-only role) is not mutating. When NO role is
 * supplied the check fails closed (treated as mutating) so a caller that
 * forgets the role can never bypass the empty-profile guard.
 */
export function isMutatingRole(role?: string | null): boolean {
  if (typeof role !== 'string' || role.length === 0) return true
  return MUTATING_ROLES.has(role as AgentRole)
}

/**
 * Backwards-compatible artifact paths: resolves the local layout for
 * `repoRoot` and delegates to `artifactPathsFor`. Kept because many call sites
 * and tests pass just `(runId, repoRoot)`.
 */
export function getArtifactPaths(
  runId: string,
  repoRoot: string,
): ArtifactPaths {
  return artifactPathsFor(resolveStateLayout({ projectRoot: repoRoot }), runId)
}

/** Artifact paths for an already-resolved layout (new call sites). */
export function getArtifactPathsForLayout(
  layout: StateLayout,
  runId: string,
): ArtifactPaths {
  return artifactPathsFor(layout, runId)
}

export async function ensureArtifactDirs(paths: ArtifactPaths): Promise<void> {
  await $`mkdir -p ${paths.artifactsDir} ${paths.discoveryDir} ${paths.researchDir} ${paths.reviewsDir} ${paths.checkpointsDir} ${paths.verificationDir}`.quiet()
}

export async function writeArtifact(
  path: string,
  content: string,
): Promise<void> {
  await Bun.write(path, content)
}

export async function readArtifact(path: string): Promise<string> {
  return await Bun.file(path).text()
}

export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16)
}

// Per-command wall-clock cap for verification commands. Bun's shell (1.3.x)
// exposes neither `.timeout()` nor a killable signal, so the cap is enforced
// with Promise.race: once it fires we stop awaiting, record exit 124 (the GNU
// timeout convention), and let the caller release its fencing lease. The
// orphaned child may keep running in the background; that is accepted because
// the alternative — holding the lease for the command's full duration — is the
// exact leak this guard exists to prevent. Overridable for tests.
export const DEFAULT_VERIFICATION_TIMEOUT_MS = 120_000

interface BoundedCommandOutcome {
  exitCode: number
  stdout: string
  stderr: string
  timedOut: boolean
}

async function runCommandBounded(
  command: string,
  worktreePath: string,
  timeoutMs: number,
): Promise<BoundedCommandOutcome> {
  const timeoutMarker = Symbol('verification-timeout')
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<typeof timeoutMarker>((resolve) => {
    timer = setTimeout(() => resolve(timeoutMarker), timeoutMs)
  })

  try {
    const raced = await Promise.race([
      $`/bin/sh -c ${command}`.cwd(worktreePath).nothrow().quiet(),
      timeoutPromise,
    ])

    if (raced === timeoutMarker) {
      return {
        exitCode: 124,
        stdout: '',
        stderr: `verification command timed out after ${timeoutMs}ms`,
        timedOut: true,
      }
    }

    return {
      exitCode: raced.exitCode,
      stdout:
        raced.stdout instanceof Buffer
          ? raced.stdout.toString()
          : String(raced.stdout),
      stderr:
        raced.stderr instanceof Buffer
          ? raced.stderr.toString()
          : String(raced.stderr),
      timedOut: false,
    }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function runVerification(
  commands: string[],
  worktreePath: string,
  attemptId: string,
  ledger: ILedger,
  artifactsDir: string,
  timeoutMs: number = DEFAULT_VERIFICATION_TIMEOUT_MS,
  role?: string | null,
  guard?: VerificationCommandGuard,
): Promise<VerificationResult[]> {
  // Empty profile: mutating tasks are hard-refused because `[].every(...)` is
  // vacuously true and would otherwise auto-complete the task. Read-only roles
  // have nothing to run by design, so an empty list is a neutral skip: return
  // no results instead of throwing.
  if (commands.length === 0) {
    if (!isMutatingRole(role)) return []
    throw new NoVerificationCommandsError()
  }

  // Optional allowlist/policy gate: validated as a whole BEFORE the first
  // spawn, so a refused command can never run (and no earlier command's side
  // effects are left behind). Absent guard = the historical behaviour, byte for
  // byte.
  if (guard) assertVerificationCommandsAllowed(commands, guard)

  const results: VerificationResult[] = []

  for (const command of commands) {
    const stdoutPath = `${artifactsDir}/verify-${hashContent(command)}.stdout`
    const stderrPath = `${artifactsDir}/verify-${hashContent(command)}.stderr`

    const startTime = Date.now()
    const outcome = await runCommandBounded(command, worktreePath, timeoutMs)
    const durationMs = Date.now() - startTime

    const stdoutContent = outcome.stdout
    const stderrContent = outcome.stderr

    await writeArtifact(stdoutPath, stdoutContent)
    await writeArtifact(stderrPath, stderrContent)

    // Frozen convention (architect t3/t4 §1): hash stdout ONLY. Never fold
    // stderr into this hash — the plugin's supervisor_verify must produce
    // the identical id `${attemptId}-verify-${hash}` for the same command.
    const stdoutHash = hashContent(stdoutContent)

    // The id keys on the COMMAND hash (stable across runs), never the stdout
    // hash (varies run to run). The plugin's supervisor_verify mirrors this.
    const verificationId = `${attemptId}-verify-${hashContent(command)}`

    await ledger.createVerification({
      id: verificationId,
      attemptId,
      profile: 'default',
      command,
      exitCode: outcome.exitCode,
      outputHash: stdoutHash,
      durationMs,
      stdoutPath,
      stderrPath,
    })

    results.push({
      command,
      exitCode: outcome.exitCode,
      durationMs,
      stdoutHash,
      stdoutPath,
      stderrPath,
      passed: outcome.exitCode === 0,
    })
  }

  return results
}

export async function collectEvidence(
  attemptId: string,
  verificationResults: VerificationResult[],
  role?: string | null,
): Promise<Record<string, unknown>> {
  // Empty results must never read as success for a mutating task
  // (`[].every(...)` is true); for a read-only role an empty profile is a
  // neutral skip and may read as passed.
  const isMutating = isMutatingRole(role)
  const verificationSkipped = verificationResults.length === 0 && !isMutating
  const allPassed =
    verificationResults.length > 0
      ? verificationResults.every((r) => r.passed)
      : verificationSkipped

  return {
    attempt_id: attemptId,
    verification_results: verificationResults,
    all_checks_passed: allPassed,
    verification_skipped: verificationSkipped,
    collected_at: new Date().toISOString(),
  }
}
