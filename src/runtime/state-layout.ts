// StateLayout — the single path authority for conductor state.
//
// Local mode stays byte-identical to the historical strings (ledger in the
// project's `.opencode/`). Central mode roots every per-project artifact under
// a shared conductor home, so sessions in scratch directories (or outside any
// repository) still get durable state without writing into the checkout.
//
// Project identity is deliberately narrower than "enclosing repository": a
// linked worktree (`.git` file) or a repo root (`.git` directory) is a project,
// but a plain directory without `.git` is its OWN project even when an ancestor
// is a repository. Walking up to an enclosing repo made `/repo/scratch` inherit
// `/repo`'s ledger, which silently mixed unrelated work into one database.
//
// Import note: consumers import this module extensionless (`./runtime/state-layout`)
// because the package's `tsc --noEmit` baseline rejects `.ts`-suffixed imports
// (TS5097). Bun resolves the extensionless specifier at runtime.
import { createHash } from 'node:crypto'
import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, isAbsolute, resolve } from 'node:path'

/** Where conductor state lives. */
export type StateMode = 'local' | 'central'

/**
 * Mode preference. `auto` inspects the project directory (see
 * `detectStateMode`); `local` and `central` are explicit and always win.
 */
export type StateModePreference = StateMode | 'auto'

/** Env var that overrides the central state root outright. */
export const CONDUCTOR_HOME_ENV_VAR = 'OPENCODE_CONDUCTOR_HOME'
/** XDG base directory used below the env override. */
export const XDG_DATA_HOME_ENV_VAR = 'XDG_DATA_HOME'

/** Maximum slug length in a project key (hash suffix excluded). */
const MAX_PROJECT_SLUG_LENGTH = 40
/** Slug used when the basename yields no usable characters (e.g. `/`). */
const FALLBACK_PROJECT_SLUG = 'project'

/**
 * Run artifact layout. Frozen publicly as `ArtifactPaths` (re-exported from
 * `artifacts.ts`): callers depend on the exact field set, including the unified
 * `verificationDir`.
 */
export interface ArtifactPaths {
  runDir: string
  artifactsDir: string
  discoveryDir: string
  researchDir: string
  reviewsDir: string
  checkpointsDir: string
  // Additive (frozen convention, architect t3/t4 §1): the single unified
  // directory both the runner and the plugin write verification output to.
  verificationDir: string
}

/**
 * Every path the conductor derives from a project root.
 *
 * `projectRoot` is the caller-provided (non-canonicalised) directory.
 * `ledgerKey` is its canonical project identity: a linked worktree points at
 * the main worktree root, a repo root and a plain directory point at
 * themselves. In local mode the ledger lives under `ledgerKey`; in central mode
 * it lives under `projectDir` (one directory per project key).
 */
export interface StateLayout {
  mode: StateMode
  projectRoot: string
  /**
   * `slug-hash8`, stable across sessions for the same canonical project path.
   * Used as the central per-project directory name and as the projection key
   * namespace.
   */
  projectKey: string
  /**
   * Root of conductor state: `<projectRoot>/.opencode` in local mode, the
   * shared conductor home (e.g. `~/.local/share/opencode-conductor`) in central
   * mode.
   */
  stateRoot: string
  /** Central per-project directory; `null` in local mode. */
  projectDir: string | null
  /** Central `project.json` record path; `null` in local mode. */
  projectRecordPath: string | null
  ledgerKey: string
  ledgerPath: string
  runsDir: string
  memoryDir: string
  worktreesRoot: string
}

export interface ResolveStateLayoutInput {
  projectRoot: string
  /**
   * Defaults to `local`, the historical behaviour existing callers rely on.
   * Pass `auto` for detection (the project-identity resolver does), or an
   * explicit `central`.
   */
  mode?: StateModePreference
  /**
   * Explicit central state root. Highest priority, ahead of
   * `OPENCODE_CONDUCTOR_HOME`; ignored in local mode.
   */
  stateRoot?: string
  /** Env for central-root resolution and detection. Defaults to `process.env`. */
  env?: Record<string, string | undefined>
}

function safeRealpath(value: string): string {
  try {
    return realpathSync(value)
  } catch {
    return resolve(value)
  }
}

function nonEmpty(value: string | undefined | null): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * When `dir` is a linked worktree (`.git` is a file: `gitdir: <main>/.git/worktrees/<name>`),
 * return the main worktree root.
 */
function mainWorktreeRoot(dir: string): string | null {
  const gitFile = `${dir}/.git`
  if (!existsSync(gitFile)) return null
  try {
    if (!statSync(gitFile).isFile()) return null
  } catch {
    return null
  }
  let contents = ''
  try {
    contents = readFileSync(gitFile, 'utf8')
  } catch {
    return null
  }
  const match = /^gitdir:\s*(.+)$/m.exec(contents)
  if (!match) return null
  const rawGitDir = match[1].trim()
  const gitDir = safeRealpath(
    isAbsolute(rawGitDir) ? rawGitDir : resolve(dir, rawGitDir),
  )
  if (!/[\\/]worktrees[\\/][^\\/]+$/.test(gitDir)) return null
  return resolve(gitDir, '..', '..', '..')
}

/**
 * Canonical project key for a workspace directory.
 *
 * Only two shapes collapse: a linked worktree collapses to its main worktree
 * root (one project across `git worktree`s), and a repo root `.git` directory
 * is itself. A plain directory without `.git` is its own project even when it
 * lives inside a repository — there is no enclosing-repo walk-up.
 */
export function canonicalLedgerKey(dir: string): string {
  const start = safeRealpath(dir)
  return mainWorktreeRoot(start) ?? start
}

/**
 * Slug half of a project key: basename lowercased, every run of
 * non-alphanumeric characters folded to `-`, trimmed, clipped to 40 chars.
 */
function projectSlug(canonicalPath: string): string {
  const slug = basename(canonicalPath)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const clipped = slug.slice(0, MAX_PROJECT_SLUG_LENGTH).replace(/-+$/g, '')
  return clipped.length > 0 ? clipped : FALLBACK_PROJECT_SLUG
}

/**
 * Stable `<slug>-<hash8>` project key. The hash is the first 8 hex characters
 * of SHA-256 over the canonical project path, so two checkouts that share a
 * basename never share a state directory.
 */
export function projectKeyFor(projectRoot: string): string {
  const canonical = canonicalLedgerKey(projectRoot)
  const hash8 = createHash('sha256')
    .update(canonical, 'utf8')
    .digest('hex')
    .slice(0, 8)
  return `${projectSlug(canonical)}-${hash8}`
}

/**
 * Should this project keep state locally?
 *
 * `auto` picks local iff the canonical project already owns conductor state:
 * a `<canonical>/.opencode/supervisor.db` file (even empty — the ledger is the
 * marker), or a non-empty `<canonical>/.opencode/runs` directory (a run
 * artifact tree from a session that never made a ledger). Everything else,
 * including a fresh directory and a scratch dir inside a repo, is central.
 */
export function detectStateMode(projectRoot: string): StateMode {
  const canonical = canonicalLedgerKey(projectRoot)
  if (existsSync(`${canonical}/.opencode/supervisor.db`)) return 'local'
  const runsDir = `${canonical}/.opencode/runs`
  try {
    if (statSync(runsDir).isDirectory() && readdirSync(runsDir).length > 0) {
      return 'local'
    }
  } catch {
    // Missing/unreadable runs dir is not local evidence.
  }
  return 'central'
}

/**
 * Local-mode layout: today's on-disk convention, unchanged.
 *
 * `ledgerKey` is canonical, while the run/memory/worktree directories stay
 * rooted at `projectRoot` as supplied. That asymmetry is intentional and
 * pre-existing: `getArtifactPaths(runId, repoRoot)` has always used the
 * caller's root, and changing it would relocate every existing run directory.
 */
export function localStatePaths(projectRoot: string): StateLayout {
  const ledgerKey = canonicalLedgerKey(projectRoot)
  return {
    mode: 'local',
    projectRoot,
    projectKey: projectKeyFor(projectRoot),
    stateRoot: `${projectRoot}/.opencode`,
    projectDir: null,
    projectRecordPath: null,
    ledgerKey,
    ledgerPath: `${ledgerKey}/.opencode/supervisor.db`,
    runsDir: `${projectRoot}/.opencode/runs`,
    memoryDir: `${projectRoot}/.opencode/memory`,
    worktreesRoot: `${projectRoot}/.worktrees`,
  }
}

/**
 * Central state root.
 *
 * Precedence: explicit `stateRoot` input, `OPENCODE_CONDUCTOR_HOME`, then
 * `$XDG_DATA_HOME/opencode-conductor`, then
 * `~/.local/share/opencode-conductor`. `~` prefers the injected `HOME` so tests
 * can resolve without reading or touching the real user home.
 */
function centralStateRoot(input: ResolveStateLayoutInput): string {
  const explicit = nonEmpty(input.stateRoot)
  if (explicit) return resolve(explicit)

  const env = input.env ?? process.env
  const fromEnv = nonEmpty(env[CONDUCTOR_HOME_ENV_VAR])
  if (fromEnv) return resolve(fromEnv)

  const xdg = nonEmpty(env[XDG_DATA_HOME_ENV_VAR])
  if (xdg) return resolve(xdg, 'opencode-conductor')

  const home = nonEmpty(env.HOME) ?? homedir()
  return resolve(home, '.local', 'share', 'opencode-conductor')
}

/**
 * Central-mode layout: `<stateRoot>/projects/<projectKey>/` owns the ledger,
 * runs, project memory and the project record. Nothing is written into the
 * checkout; `worktreesRoot` stays a checkout-local path because git worktrees
 * are attached to the repository, not to the state store.
 */
function centralStatePaths(
  projectRoot: string,
  stateRoot: string,
): StateLayout {
  const projectKey = projectKeyFor(projectRoot)
  const projectDir = `${stateRoot}/projects/${projectKey}`
  return {
    mode: 'central',
    projectRoot,
    projectKey,
    stateRoot,
    projectDir,
    projectRecordPath: `${projectDir}/project.json`,
    ledgerKey: canonicalLedgerKey(projectRoot),
    ledgerPath: `${projectDir}/supervisor.db`,
    runsDir: `${projectDir}/runs`,
    memoryDir: `${projectDir}/memory/project`,
    worktreesRoot: `${projectRoot}/.worktrees`,
  }
}

/**
 * Resolve the state layout for a project.
 *
 * `mode` defaults to `local` for callers that predate central state
 * (`plugin.ts`, `artifacts.ts`). Passing `auto` opts into detection; the
 * project-identity resolver (`runtime/project.ts`) is the auto-facing API.
 */
export function resolveStateLayout(input: ResolveStateLayoutInput): StateLayout {
  const preferred = input.mode ?? 'local'
  const mode = preferred === 'auto' ? detectStateMode(input.projectRoot) : preferred
  return mode === 'central'
    ? centralStatePaths(input.projectRoot, centralStateRoot(input))
    : localStatePaths(input.projectRoot)
}

/** Run artifact paths for a resolved layout (the single implementation). */
export function artifactPathsFor(
  layout: StateLayout,
  runId: string,
): ArtifactPaths {
  const runDir = `${layout.runsDir}/${runId}`
  return {
    runDir,
    artifactsDir: `${runDir}/artifacts`,
    discoveryDir: `${runDir}/artifacts/discovery`,
    researchDir: `${runDir}/artifacts/research`,
    reviewsDir: `${runDir}/artifacts/reviews`,
    checkpointsDir: `${runDir}/checkpoints`,
    verificationDir: `${runDir}/artifacts/verification`,
  }
}
