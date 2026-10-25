/**
 * Shared plumbing for the P0 parity gate.
 *
 * This is NOT a `*.test.ts` file on purpose: importing it from a test must not
 * register a second copy of the suite.
 */
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** `tools/opencode-conductor` */
export const CONDUCTOR_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
/** Repo root, i.e. the checkout / worktree that owns `tools/`. */
export const REPO_ROOT = resolve(CONDUCTOR_ROOT, '../..')
/** The read-only pre-port tree the conductor package is compared against. */
export const FROZEN_ROOT = join(REPO_ROOT, 'tools/opencode-supervisor')

/**
 * Set on every nested `bun test` spawned by the parity gate. The conductor suite
 * contains the parity test itself, so without this guard the test would recurse
 * forever. A guarded run still passes (one test, no assertions), which keeps the
 * pass counts comparable between the outer and nested runs.
 */
export const PARITY_CHILD_ENV = 'CONDUCTOR_PARITY_CHILD'

/** Both suites finish in a few seconds; the ceiling only catches hangs. */
export const PARITY_TIMEOUT_MS = 180_000

const ANSI_PATTERN = /\u001b\[[0-9;]*m/g

export interface SuiteSummary {
  pass: number
  fail: number
  ran: number
  files: number
}

export interface SuiteRun {
  summary: SuiteSummary
  exitCode: number
  /** stdout + stderr, in that order, ANSI codes intact. */
  output: string
}

/**
 * Bun prints its summary to stderr as:
 *
 *   ` 406 pass`
 *   ` 0 fail`
 *   `Ran 406 tests across 25 files. [2.29s]`
 *
 * Parse those three lines after stripping colour codes. Throws with the tail of
 * the output when the shape is missing, so a broken harness fails loudly rather
 * than silently comparing zero to zero.
 */
export function parseBunTestSummary(output: string): SuiteSummary {
  const clean = output.replace(ANSI_PATTERN, '')
  const pass = /(?:^|\n)\s*(\d+)\s+pass\b/.exec(clean)
  const fail = /(?:^|\n)\s*(\d+)\s+fail\b/.exec(clean)
  const ran = /(?:^|\n)\s*Ran\s+(\d+)\s+tests?\s+across\s+(\d+)\s+files?/.exec(clean)
  if (!pass || !fail || !ran) {
    throw new Error(`could not parse a bun test summary from:\n${tail(output, 3000)}`)
  }
  return {
    pass: Number(pass[1]),
    fail: Number(fail[1]),
    ran: Number(ran[1]),
    files: Number(ran[2]),
  }
}

/** Last `lines` lines of a captured suite run, for failure messages. */
export function tail(output: string, lines = 40): string {
  return output.trimEnd().split(/\r?\n/).slice(-lines).join('\n')
}

export function formatSuiteRun(label: string, run: SuiteRun): string {
  const { pass, fail, ran, files } = run.summary
  return `${label}: ${pass} pass, ${fail} fail (${ran} tests across ${files} files, exit ${run.exitCode})`
}

/** Minimal structural view of the Bun globals used here, so the gate does not
 * depend on ambient Bun types being installed in every checkout. */
interface BunRuntime {
  which(command: string): string | null
  spawnSync(options: {
    cmd: string[]
    cwd: string
    stdout: 'pipe'
    stderr: 'pipe'
    env: Record<string, string | undefined>
    timeout: number
  }): {
    exitCode: number | null
    stdout?: { toString(): string } | null
    stderr?: { toString(): string } | null
  }
}

const bunRuntime = (globalThis as unknown as { Bun?: BunRuntime }).Bun

/**
 * Run `bun test` in `cwd` and parse its summary. Uses `Bun.spawnSync` so the
 * gate is deterministic: no shared shell, no async races, no inherited cwd.
 */
export function runBunTest(
  cwd: string,
  env: Record<string, string> = {},
): SuiteRun {
  if (bunRuntime === undefined) throw new Error('this gate must run under Bun')
  const bun = bunRuntime.which('bun') ?? 'bun'
  const result = bunRuntime.spawnSync({
    cmd: [bun, 'test'],
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, ...env },
    timeout: PARITY_TIMEOUT_MS,
  })
  const output = `${result.stdout?.toString() ?? ''}${result.stderr?.toString() ?? ''}`
  return {
    // Parse before returning: a missing summary is a harness failure, not 0/0.
    summary: parseBunTestSummary(output),
    exitCode: result.exitCode ?? 1,
    output,
  }
}
