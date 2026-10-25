// Project detection — how to verify a checkout, and which branches to push.
//
// Everything here is inspection: `node:fs` reads plus read-only `git` probes.
// Detection never installs anything, never runs a project's own tooling (no
// package manager, `cargo`, `go` or `python` process is ever spawned), never
// writes into the checkout, and never throws — a caller resolving a project
// always gets a usable answer, even for a folder that is not a repository yet.
//
// The result is a table, not a guess: `verifySources` names the file or git rule
// behind every command, so an empty command list always has a stated reason
// (`ecosystem:none`, `package.json:no-matching-scripts`, ...).
//
// Precedence when a folder looks like several projects at once:
//   ecosystem  node > rust > python > go (one wins, the rest are `skipped:`)
//   manager    bun > pnpm > yarn > npm (by lockfile)
//   commands   format, lint, typecheck, test, build (only scripts that exist)
//
// `hash` fingerprints the inputs (never absolute paths), so a durable record
// can tell drift from a stable checkout without diffing command lists.
//
// Import note: extensionless specifiers, matching runtime/state-layout.ts (the
// package's tsc baseline rejects `.ts`-suffixed imports).
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Package managers recognised by lockfile. */
export type PackageManager = 'bun' | 'pnpm' | 'yarn' | 'npm'

/** The one build ecosystem a checkout is classified as. */
export type ProjectEcosystem = 'node' | 'rust' | 'python' | 'go' | 'none'

/** Branch names a supervisor session writes to. */
export interface DetectedBranches {
  main: string
  dev: string
}

/**
 * A checkout's verification and branch table, derived without running it.
 *
 * `packageManager` is `null` when no lockfile proves one. Node commands still
 * render with `npm` in that case (the manifest's historical default) and
 * `verifySources` says so, so the fallback is visible instead of silent.
 */
export interface DetectedProject {
  packageManager: PackageManager | null
  ecosystem: ProjectEcosystem
  /** Ready-to-run commands, in the order a project should run them. */
  verifyCommands: string[]
  /** Provenance for every command (and for every reason there is none). */
  verifySources: string[]
  branches: DetectedBranches
  /**
   * Which branch rules fired, e.g. `origin-head;develop-local`. `not-git` for
   * a plain directory, `detection-failed` when detection had to bail out.
   */
  branchSource: string
  isGitRepo: boolean
  /** sha256 over the detection inputs (no absolute paths). */
  hash: string
}

/** Environment handed to the read-only git probes. Tests inject it. */
export type DetectEnv = Record<string, string | undefined>

/**
 * Source marker recorded when detection itself failed (the safety net in
 * `detectProject`). Callers must keep whatever profile they already stored: a
 * transient failure is not evidence that the checkout lost its checks.
 */
export const DETECTION_FAILED_SOURCE = 'detection:failed'

/** Scripts rendered as `<pm> run <script>`, in execution order. */
export const VERIFY_SCRIPT_ORDER = [
  'format',
  'lint',
  'typecheck',
  'test',
  'build',
] as const

/** Lockfiles in precedence order: bun, pnpm, yarn, npm. */
const LOCKFILE_RULES: ReadonlyArray<{ file: string; manager: PackageManager }> = [
  { file: 'bun.lockb', manager: 'bun' },
  { file: 'bun.lock', manager: 'bun' },
  { file: 'pnpm-lock.yaml', manager: 'pnpm' },
  { file: 'yarn.lock', manager: 'yarn' },
  { file: 'package-lock.json', manager: 'npm' },
]

/** Ecosystem manifests in precedence order: node > rust > python > go. */
const MANIFEST_RULES: ReadonlyArray<{
  ecosystem: Exclude<ProjectEcosystem, 'none'>
  manifests: readonly string[]
}> = [
  { ecosystem: 'node', manifests: ['package.json'] },
  { ecosystem: 'rust', manifests: ['Cargo.toml'] },
  { ecosystem: 'python', manifests: ['pyproject.toml', 'requirements.txt'] },
  { ecosystem: 'go', manifests: ['go.mod'] },
]

const RUST_VERIFY_COMMANDS = [
  'cargo fmt --check',
  'cargo clippy -- -D warnings',
  'cargo test',
  'cargo build',
] as const

const PYTHON_LINT_COMMANDS = ['ruff format --check .', 'ruff check .'] as const

const GO_VERIFY_COMMANDS = [
  'gofmt -l .',
  'go vet ./...',
  'go test ./...',
  'go build ./...',
] as const

/** Directories a Python test-file scan never descends into. */
const PYTHON_SCAN_SKIP_DIRS = new Set([
  '.git',
  '.mypy_cache',
  '.next',
  '.pytest_cache',
  '.tox',
  '.venv',
  '__pycache__',
  'build',
  'dist',
  'node_modules',
  'target',
  'venv',
])

/** Bounds for the Python test scan: enough for real layouts, never unbounded. */
const PYTHON_SCAN_MAX_DEPTH = 4
const PYTHON_SCAN_MAX_ENTRIES = 5000

/** Max time a single read-only git probe may take. */
const GIT_PROBE_TIMEOUT_MS = 5_000

/**
 * Inherited git variables that redirect git at a *different* repository. A
 * supervisor resolving `/repo/scratch` must inspect that directory, not the
 * checkout that happens to own the caller's environment.
 */
const GIT_ENV_REDIRECTS = new Set([
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_CEILING_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_DIR',
  'GIT_DISCOVERY_ACROSS_FILESYSTEM',
  'GIT_INDEX_FILE',
  'GIT_NAMESPACE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_WORK_TREE',
])

interface LockfileHit {
  file: string
  manager: PackageManager
}

interface NodeScan {
  commands: string[]
  sources: string[]
  /** Matched script names (the `format`, `lint`, ... subset that exists). */
  scriptNames: string[]
}

interface EcosystemCandidate {
  ecosystem: Exclude<ProjectEcosystem, 'none'>
  manifests: string[]
}

interface BranchDetection {
  branches: DetectedBranches
  branchSource: string
}

interface DetectionFingerprint {
  ecosystem: ProjectEcosystem
  packageManager: PackageManager | null
  isGitRepo: boolean
  manifests: string[]
  lockfiles: string[]
  scripts: string[]
  branches: DetectedBranches
  branchSource: string
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

function lockfileHits(projectRoot: string): LockfileHit[] {
  const hits: LockfileHit[] = []
  for (const rule of LOCKFILE_RULES) {
    if (isFile(join(projectRoot, rule.file))) {
      hits.push({ file: rule.file, manager: rule.manager })
    }
  }
  return hits
}

/** Every manifest present, in precedence order. */
function ecosystemCandidates(projectRoot: string): EcosystemCandidate[] {
  const candidates: EcosystemCandidate[] = []
  for (const rule of MANIFEST_RULES) {
    const manifests = rule.manifests.filter((name) => isFile(join(projectRoot, name)))
    if (manifests.length > 0) {
      candidates.push({ ecosystem: rule.ecosystem, manifests })
    }
  }
  return candidates
}

/** Bounded recursive search for a Python test suite. */
function hasPythonTests(projectRoot: string): boolean {
  const testsDir = join(projectRoot, 'tests')
  try {
    if (statSync(testsDir).isDirectory()) return true
  } catch {
    // No `tests/`: fall through to the file scan.
  }

  let seen = 0
  const scan = (dir: string, depth: number): boolean => {
    if (depth > PYTHON_SCAN_MAX_DEPTH || seen > PYTHON_SCAN_MAX_ENTRIES) {
      return false
    }
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return false
    }
    for (const entry of entries) {
      seen += 1
      if (seen > PYTHON_SCAN_MAX_ENTRIES) return false
      if (entry.isFile() && /^test_.+\.py$/.test(entry.name)) return true
      if (entry.isDirectory() && !PYTHON_SCAN_SKIP_DIRS.has(entry.name)) {
        if (scan(join(dir, entry.name), depth + 1)) return true
      }
    }
    return false
  }
  return scan(projectRoot, 0)
}

/**
 * Node commands from `package.json` scripts. A malformed or unreadable
 * manifest yields no commands and a source line naming the problem — it never
 * throws, because a broken manifest must not break project resolution.
 */
function scanNode(projectRoot: string, lockfile: LockfileHit | null): NodeScan {
  const sources: string[] = [
    lockfile
      ? `package-manager:${lockfile.manager} (${lockfile.file})`
      : 'package-manager:npm (default, no lockfile)',
  ]
  const renderAs: PackageManager = lockfile?.manager ?? 'npm'
  const empty: NodeScan = { commands: [], sources, scriptNames: [] }

  const raw = readText(join(projectRoot, 'package.json'))
  if (raw === null) {
    sources.push('package.json:unreadable')
    return empty
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    sources.push('package.json:malformed')
    return empty
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    sources.push('package.json:malformed')
    return empty
  }

  const scriptsValue = (parsed as Record<string, unknown>).scripts
  const scripts =
    scriptsValue && typeof scriptsValue === 'object' && !Array.isArray(scriptsValue)
      ? (scriptsValue as Record<string, unknown>)
      : {}

  const commands: string[] = []
  const scriptNames: string[] = []
  for (const name of VERIFY_SCRIPT_ORDER) {
    const value = scripts[name]
    if (typeof value !== 'string' || value.trim().length === 0) continue
    scriptNames.push(name)
    commands.push(`${renderAs} run ${name}`)
    sources.push(`package.json:scripts.${name}`)
  }
  if (scriptNames.length === 0) sources.push('package.json:no-matching-scripts')

  return { commands, sources, scriptNames }
}

interface GitProbeResult {
  ok: boolean
  stdout: string
}

/**
 * Run one read-only git command against `projectRoot`.
 *
 * `-C <root>` plus the redirect scrub keep the answer about *this* directory.
 * A missing `git`, a timeout or a non-zero exit all become `ok: false`.
 */
function gitProbe(
  projectRoot: string,
  args: string[],
  env: DetectEnv,
): GitProbeResult {
  try {
    const spawnEnv: Record<string, string> = {}
    for (const [key, value] of Object.entries({ ...process.env, ...env })) {
      if (typeof value !== 'string' || GIT_ENV_REDIRECTS.has(key)) continue
      spawnEnv[key] = value
    }
    const result = Bun.spawnSync({
      cmd: ['git', '-C', projectRoot, ...args],
      env: spawnEnv,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: GIT_PROBE_TIMEOUT_MS,
    })
    return {
      ok: (result.exitCode ?? 1) === 0,
      stdout: result.stdout.toString(),
    }
  } catch {
    return { ok: false, stdout: '' }
  }
}

/** `refs/remotes/origin/<name>` → `<name>`. Anything else is not a default. */
function parseOriginHead(stdout: string): string | null {
  const prefix = 'refs/remotes/origin/'
  const value = stdout.trim()
  if (!value.startsWith(prefix)) return null
  const name = value.slice(prefix.length)
  return name.length > 0 && !/\s/.test(name) ? name : null
}

/**
 * Main/dev branch names, in the order the rules are tried:
 *   1. `origin/HEAD` (the remote's default branch);
 *   2. the current branch, when it is `main` or `master`;
 *   3. `main`.
 * `dev` is `develop` when a local or origin remote-tracking ref exists, else
 * the main branch.
 */
function detectBranches(
  projectRoot: string,
  isGitRepo: boolean,
  env: DetectEnv,
): BranchDetection {
  if (!isGitRepo) {
    // No repository: there is no branch namespace to inspect. The record layer
    // keeps its own loopback defaults for this case (see runtime/project.ts).
    return { branches: { main: 'main', dev: 'main' }, branchSource: 'not-git' }
  }

  let main = 'main'
  let mainRule = 'default-main'
  const originHead = gitProbe(
    projectRoot,
    ['symbolic-ref', 'refs/remotes/origin/HEAD'],
    env,
  )
  const fromOrigin = originHead.ok ? parseOriginHead(originHead.stdout) : null
  if (fromOrigin) {
    main = fromOrigin
    mainRule = 'origin-head'
  } else {
    const current = gitProbe(projectRoot, ['rev-parse', '--abbrev-ref', 'HEAD'], env)
    const name = current.ok ? current.stdout.trim() : ''
    if (name === 'main' || name === 'master') {
      main = name
      mainRule = 'current-branch'
    }
  }

  let dev = main
  let devRule = 'same-as-main'
  const developRefs = gitProbe(
    projectRoot,
    [
      'for-each-ref',
      '--format=%(refname)',
      'refs/heads/develop',
      'refs/remotes/*/develop',
    ],
    env,
  )
  if (developRefs.ok) {
    const refs = developRefs.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
    if (refs.includes('refs/heads/develop')) {
      dev = 'develop'
      devRule = 'develop-local'
    } else if (
      refs.some(
        (ref) => ref.startsWith('refs/remotes/') && ref.endsWith('/develop'),
      )
    ) {
      dev = 'develop'
      devRule = 'develop-remote'
    }
  }

  return { branches: { main, dev }, branchSource: `${mainRule};${devRule}` }
}

/**
 * sha256 over the detection inputs, in a fixed order. Absolute paths are
 * deliberately absent: moving a checkout keeps its hash, while a changed
 * script, lockfile, manifest or branch flips it.
 */
function fingerprint(inputs: DetectionFingerprint): string {
  const normalized = {
    ecosystem: inputs.ecosystem,
    packageManager: inputs.packageManager,
    isGitRepo: inputs.isGitRepo,
    manifests: [...inputs.manifests],
    lockfiles: [...inputs.lockfiles],
    scripts: [...inputs.scripts],
    branches: { main: inputs.branches.main, dev: inputs.branches.dev },
    branchSource: inputs.branchSource,
  }
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex')
}

/** The answer when detection itself failed: empty, and marked as such. */
function fallbackDetection(): DetectedProject {
  const branches: DetectedBranches = { main: 'main', dev: 'main' }
  const branchSource = DETECTION_FAILED_SOURCE
  return {
    packageManager: null,
    ecosystem: 'none',
    verifyCommands: [],
    verifySources: ['ecosystem:none', DETECTION_FAILED_SOURCE],
    branches,
    branchSource,
    isGitRepo: false,
    hash: fingerprint({
      ecosystem: 'none',
      packageManager: null,
      isGitRepo: false,
      manifests: [],
      lockfiles: [],
      scripts: [],
      branches,
      branchSource,
    }),
  }
}

function detectUnsafe(projectRoot: string, env: DetectEnv): DetectedProject {
  const candidates = ecosystemCandidates(projectRoot)
  const winner = candidates[0] ?? null
  const isGitRepo = existsSync(join(projectRoot, '.git'))
  const lockfiles = lockfileHits(projectRoot)

  const sources: string[] = []
  const commands: string[] = []
  let scriptNames: string[] = []
  let packageManager: PackageManager | null = null

  if (winner === null) {
    sources.push('ecosystem:none')
  } else {
    sources.push(`ecosystem:${winner.ecosystem} (${winner.manifests[0]})`)
    // Lower-precedence manifests are recorded, not silently ignored: an
    // operator can see that a Cargo.toml exists but node won.
    for (const skipped of candidates.slice(1)) {
      sources.push(`skipped:${skipped.ecosystem} (${skipped.manifests[0]})`)
    }

    switch (winner.ecosystem) {
      case 'node': {
        packageManager = lockfiles[0]?.manager ?? null
        const scan = scanNode(projectRoot, lockfiles[0] ?? null)
        commands.push(...scan.commands)
        sources.push(...scan.sources)
        scriptNames = scan.scriptNames
        break
      }
      case 'rust': {
        commands.push(...RUST_VERIFY_COMMANDS)
        sources.push('cargo:Cargo.toml')
        break
      }
      case 'python': {
        commands.push(...PYTHON_LINT_COMMANDS)
        for (const manifest of winner.manifests) {
          sources.push(`python:${manifest}`)
        }
        if (hasPythonTests(projectRoot)) {
          commands.push('pytest')
          sources.push('python:tests')
        } else {
          sources.push('python:no-tests')
        }
        break
      }
      case 'go': {
        commands.push(...GO_VERIFY_COMMANDS)
        sources.push('go:go.mod')
        break
      }
    }
  }

  const { branches, branchSource } = detectBranches(projectRoot, isGitRepo, env)
  const hash = fingerprint({
    ecosystem: winner?.ecosystem ?? 'none',
    packageManager,
    isGitRepo,
    manifests: candidates.flatMap((candidate) => candidate.manifests),
    lockfiles: lockfiles.map((lockfile) => lockfile.file),
    scripts: scriptNames,
    branches,
    branchSource,
  })

  return {
    packageManager,
    ecosystem: winner?.ecosystem ?? 'none',
    verifyCommands: commands,
    verifySources: sources,
    branches,
    branchSource,
    isGitRepo,
    hash,
  }
}

/**
 * Detect how a checkout verifies itself and which branches it uses.
 *
 * Read-only and non-throwing by contract: any unexpected failure returns the
 * marked `detection:failed` fallback rather than propagating, so a project
 * resolve can never be blocked by a hostile or partially readable folder.
 *
 * The last parameter is only used for the read-only git probes (tests inject a
 * controlled environment); detection itself never consults the environment.
 */
export function detectProject(
  projectRoot: string,
  env: DetectEnv = process.env,
): DetectedProject {
  try {
    return detectUnsafe(projectRoot, env)
  } catch {
    return fallbackDetection()
  }
}
