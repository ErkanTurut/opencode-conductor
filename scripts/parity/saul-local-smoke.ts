#!/usr/bin/env bun
/**
 * Smoke: this checkout keeps conductor state under `.opencode/` (local mode).
 *
 * The evidence gate for the saul switch runs this file, so it must be honest
 * about what it can prove from where it runs:
 *
 *   bun tools/opencode-conductor/scripts/parity/saul-local-smoke.ts
 *   cd tools/opencode-conductor && bun scripts/parity/saul-local-smoke.ts
 *
 * Root resolution, in order: `SAUL_REPO_ROOT`, the git toplevel of the current
 * directory, then the checkout two levels above this package. The env var is
 * the escape hatch for running against a checkout that is not your cwd.
 *
 * Two roots, because the runtime has two:
 *   - `repoRoot` (the checkout the command ran in) owns `runsDir` — run
 *     artifacts have always been rooted at the caller-supplied directory;
 *   - `stateRoot` (the main checkout) owns the ledger. `canonicalLedgerKey`
 *     folds a linked worktree to `mainWorktreeRoot`, so a worktree's ledger is
 *     the main checkout's `.opencode/supervisor.db`, not a per-worktree copy.
 *     For a normal checkout the two are the same directory.
 *
 * `mode: 'auto'` is deliberate: it is what a real session resolves. Local is
 * chosen when the canonical checkout already owns state (a ledger file, or a
 * non-empty runs dir); otherwise the resolver reports central.
 *
 * A checkout with no ledger at all is a fresh checkout, not a failure: it
 * prints `ledger: absent (fresh checkout)` and still asserts the path
 * contract. In that case the resolver would write a central project record, so
 * the smoke redirects `OPENCODE_CONDUCTOR_HOME` into a throwaway directory for
 * that one call and deletes it — a smoke must not mutate operator state.
 *
 * Prints one line per assertion and then exactly one verdict line:
 *   `SAUL_LOCAL_SMOKE_OK <repoRoot>`   exit 0
 *   `SAUL_LOCAL_SMOKE_FAIL <reason>`   exit 1
 */
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { resolveProjectIdentity } from '../../src/runtime/project'

/** The package root: this file is `<root>/scripts/parity/saul-local-smoke.ts`. */
const PACKAGE_ROOT = resolve(import.meta.dir, '..', '..')

/** Run git in `dir`; null when git is missing or the command fails. */
function git(dir: string, args: string[]): string | null {
  try {
    const proc = Bun.spawnSync({
      cmd: ['git', '-C', dir, ...args],
      stdout: 'pipe',
      stderr: 'pipe',
    })
    if (proc.exitCode !== 0) return null
    const out = proc.stdout.toString().trim()
    return out.length > 0 ? out : null
  } catch {
    return null
  }
}

/** Absolute, symlink-free when the path exists (git reports real paths). */
function normalize(path: string): string {
  const absolute = resolve(path)
  try {
    return realpathSync(absolute)
  } catch {
    return absolute
  }
}

function repoRootFromEnvOrGit(): string {
  const fromEnv = (process.env.SAUL_REPO_ROOT ?? '').trim()
  if (fromEnv.length > 0) return normalize(fromEnv)

  const toplevel = git(process.cwd(), ['rev-parse', '--show-toplevel'])
  if (toplevel) return normalize(toplevel)

  return normalize(resolve(PACKAGE_ROOT, '..', '..'))
}

/**
 * Main checkout for a linked worktree, else `repoRoot`. Independent of the
 * runtime's own helper on purpose: comparing a resolver with itself would
 * assert nothing. `<common>/.git` is the main checkout's git dir.
 */
function stateRootFor(repoRoot: string): string {
  const common =
    git(repoRoot, ['rev-parse', '--path-format=absolute', '--git-common-dir']) ??
    git(repoRoot, ['rev-parse', '--git-common-dir'])
  if (!common) return repoRoot

  const commonDir = normalize(common)
  return basename(commonDir) === '.git' ? dirname(commonDir) : repoRoot
}

function main(): number {
  const repoRoot = repoRootFromEnvOrGit()
  const stateRoot = stateRootFor(repoRoot)

  const expectedLedger = join(stateRoot, '.opencode', 'supervisor.db')
  const expectedRuns = join(repoRoot, '.opencode', 'runs')

  const ledgerPresent = existsSync(expectedLedger)
  const failures: string[] = []

  // Fresh checkout: 'auto' resolves central and would write a project record
  // into the operator's real central state. Redirect it for this one call.
  let scratchHome: string | null = null
  let env: Record<string, string | undefined> = process.env
  if (!ledgerPresent) {
    scratchHome = mkdtempSync(join(tmpdir(), 'saul-local-smoke-'))
    env = { ...process.env, OPENCODE_CONDUCTOR_HOME: scratchHome }
  }

  let stateMode: string
  let ledgerPath: string
  let runsDir: string
  try {
    const { record } = resolveProjectIdentity({ projectRoot: repoRoot, mode: 'auto', env })
    stateMode = record.stateMode
    ledgerPath = record.ledgerPath
    runsDir = record.runsDir
  } finally {
    if (scratchHome) rmSync(scratchHome, { recursive: true, force: true })
  }

  console.log(`repoRoot: ${repoRoot}`)
  if (stateRoot !== repoRoot) console.log(`stateRoot: ${stateRoot}`)

  if (ledgerPresent) {
    console.log(`stateMode: ${stateMode}`)
    if (stateMode !== 'local') failures.push(`stateMode ${stateMode} (expected local)`)

    console.log(`ledgerPath: ${ledgerPath}`)
    if (ledgerPath !== expectedLedger) {
      failures.push(`ledgerPath ${ledgerPath} (expected ${expectedLedger})`)
    }

    console.log(`runsDir: ${runsDir}`)
    if (runsDir !== expectedRuns) {
      failures.push(`runsDir ${runsDir} (expected ${expectedRuns})`)
    }

    console.log(`ledger: present`)
    console.log(`runs: ${existsSync(expectedRuns) ? 'present' : 'absent (fresh checkout)'}`)
  } else {
    // No ledger: 'auto' resolves central, so the auto record says nothing about
    // this checkout's layout. The local convention is asserted against an
    // explicit `mode: 'local'` resolution instead — same projectRoot, so this
    // checks the paths a session will use once state exists, and passes.
    console.log(`stateMode: ${stateMode} (fresh checkout: no local state yet)`)

    const local = resolveProjectIdentity({ projectRoot: repoRoot, mode: 'local', env: process.env })
    console.log(`ledgerPath: ${local.record.ledgerPath}`)
    if (local.record.ledgerPath !== expectedLedger) {
      failures.push(`ledgerPath ${local.record.ledgerPath} (expected ${expectedLedger})`)
    }

    console.log(`runsDir: ${local.record.runsDir}`)
    if (local.record.runsDir !== expectedRuns) {
      failures.push(`runsDir ${local.record.runsDir} (expected ${expectedRuns})`)
    }

    console.log(`ledger: absent (fresh checkout)`)
    console.log(`runs: ${existsSync(expectedRuns) ? 'present' : 'absent (fresh checkout)'}`)
  }

  if (failures.length > 0) {
    console.log(`SAUL_LOCAL_SMOKE_FAIL ${failures.join('; ')}`)
    return 1
  }

  console.log(`SAUL_LOCAL_SMOKE_OK ${repoRoot}`)
  return 0
}

process.exit(main())
