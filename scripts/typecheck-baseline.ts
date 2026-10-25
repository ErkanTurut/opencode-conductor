#!/usr/bin/env bun
/**
 * Baseline-gated typecheck for this package.
 *
 * `tsc --noEmit` carries a pre-existing red baseline (the `.ts`-extension
 * imports tsc rejects without `allowImportingTsExtensions`, `bun:test` overload
 * narrowing, unused imports in tests). The repo convention is to diff against a
 * recorded baseline instead of chasing that debt, so this wrapper fails only on
 * diagnostics that are NOT already in `typecheck-baseline.json`. Fixed errors
 * are allowed to disappear; nothing is suppressed.
 *
 * Signature: `<relative path>:<line>:<col>:<TS code>`. The message text is
 * dropped on purpose — tsc rewording or a type-definition bump should not churn
 * the baseline — and paths are made relative to the package root so the gate is
 * identical from a worktree or a plain checkout.
 *
 * Usage:
 *   bun run scripts/typecheck-baseline.ts            # gate: exit 1 on new errors
 *   bun run scripts/typecheck-baseline.ts --update   # rewrite the baseline
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

const PACKAGE_ROOT = resolve(import.meta.dir, '..')
const BASELINE_PATH = join(PACKAGE_ROOT, 'typecheck-baseline.json')

/** `src/index.ts(16,15): error TS5097: ...` — the only shape we record. */
const FILE_DIAGNOSTIC = /^(.+?)\((\d+),(\d+)\): error TS(\d+):/
/** File-less diagnostics (`error TS18003: No inputs were found ...`). */
const GLOBAL_DIAGNOSTIC = /^error TS(\d+):/

interface TscRun {
  exitCode: number
  stdout: string
  stderr: string
}

/**
 * Spawn tsc. `bun run` puts the ancestor `node_modules/.bin` directories on
 * PATH, so a hoisted `typescript` resolves even though this package does not
 * depend on it; `bun x tsc` is the fallback for a bare checkout.
 */
function runTsc(): TscRun {
  const args = ['--noEmit', '--pretty', 'false']
  const tsc = Bun.which('tsc')
  const cmd = tsc ? [tsc, ...args] : ['bun', 'x', 'tsc', ...args]
  const result = Bun.spawnSync({
    cmd,
    cwd: PACKAGE_ROOT,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  return {
    exitCode: result.exitCode ?? 1,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  }
}

function normalizePath(file: string): string {
  const absolute = isAbsolute(file) ? file : resolve(PACKAGE_ROOT, file)
  const rel = relative(PACKAGE_ROOT, absolute) || file
  return rel.split(sep).join('/')
}

/** Every distinct diagnostic signature in tsc's stdout, sorted. */
function parseSignatures(stdout: string): string[] {
  const found = new Set<string>()
  for (const line of stdout.split(/\r?\n/)) {
    const fileMatch = FILE_DIAGNOSTIC.exec(line)
    if (fileMatch) {
      const [, file, lineNo, col, code] = fileMatch
      found.add(`${normalizePath(file)}:${lineNo}:${col}:TS${code}`)
      continue
    }
    const globalMatch = GLOBAL_DIAGNOSTIC.exec(line)
    if (globalMatch) found.add(`<global>:0:0:TS${globalMatch[1]}`)
  }
  return [...found].sort()
}

function readBaseline(): string[] | null {
  if (!existsSync(BASELINE_PATH)) return null
  const parsed: unknown = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== 'string')) {
    throw new Error(`${BASELINE_PATH} must be a JSON array of signature strings`)
  }
  return parsed as string[]
}

function writeBaseline(signatures: string[]): void {
  writeFileSync(BASELINE_PATH, `${JSON.stringify(signatures, null, 2)}\n`)
}

const update = process.argv.includes('--update')
const run = runTsc()
const current = parseSignatures(run.stdout)

// A non-zero exit with no parseable diagnostic is a tsc/toolchain failure, not a
// baseline question: surface it verbatim rather than gating on an empty set.
if (current.length === 0 && run.exitCode !== 0) {
  const detail = run.stdout.trim() || run.stderr.trim()
  console.error(detail || `typecheck: tsc exited ${run.exitCode} with no diagnostics`)
  process.exit(1)
}

if (update) {
  writeBaseline(current)
  console.log(`typecheck: baseline updated (${current.length} signatures)`)
  process.exit(0)
}

const baseline = readBaseline()
const known = new Set(baseline ?? [])
const added = current.filter((signature) => !known.has(signature))
const baselineCount = baseline?.length ?? 0

if (baseline === null) {
  console.log(`typecheck: baseline missing at ${normalizePath(BASELINE_PATH)} — run with --update`)
} else if (added.length === 0) {
  console.log(`typecheck: ${current.length} errors, 0 new (baseline ${baselineCount})`)
  process.exit(0)
}

console.log(`typecheck: ${current.length} errors, ${added.length} new (baseline ${baselineCount})`)
console.log('new since baseline:')
for (const signature of added) console.log(`  + ${signature}`)
process.exit(1)
