// Provenance: the verification gate below (unified verification dir,
// stdout-only output hash, hard-refuse on empty verification commands) is
// adapted from the OmO comparison notes (idea 3 — rounds/sweep evidence
// gating). Patterns only: no upstream source was copied. License: SUL-1.0.
//
// Globalization debt: `runVerification` is imported below with an explicit
// `.ts` extension, matching the existing ledger/receipt imports because the
// plugin runs under the Bun runtime. Kept consistent this batch.
// t7 package-globalize: this file is the package's plugin implementation.
// `.opencode/plugins/supervisor.js` is a thin shim that re-exports the default
// plugin object and `SupervisorPlugin` from here, so opencode auto-discovery
// keeps working while the implementation lives in the package.
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  // realpathSync moved with the path authority to runtime/state-layout.ts.
  rmSync,
  statSync,
} from 'node:fs'
import { dirname } from 'node:path'
import { Database } from 'bun:sqlite'
import { $ as bunDollar } from 'bun'
import { SqliteLedger } from './ledger/sqlite.ts'
import {
  DEFAULT_VERIFICATION_TIMEOUT_MS,
  runVerification,
  isMutatingRole,
} from './artifacts.ts'
import {
  HEARTBEAT_FRESH_MS,
  Watchdog,
  classifyRunSweep,
  classifyWorktreeSweep,
  evaluateWorkItemLiveness,
} from './watchdog.ts'
import { generateReceipt, writeReceiptToDisk } from './receipt.ts'
// Canonical worktree lifecycle lives in the provider (t1): the plugin no
// longer carries its own branch scheme or path fallback.
import {
  WorktreeProvider,
  canonicalWorktreeBranch,
  canonicalWorktreeId,
} from './worktrees.ts'
// Policy gates (t2): the shell allowlist, MCP scope and transition authority
// live in the package; the hook only consults them (never a third divergent
// permission text).
import {
  CANONICAL_SHELL_RULES,
  evaluateShellGate,
  findProfileForKey,
  isToolInMcpScope,
  loadPolicyConfig,
  resolveMcpAllowedServers,
  type PermissionRule,
  type PolicyConfig,
} from './policy.ts'
import { TERMINAL_STATES } from './state-machine.ts'
// Additive gate imports (extensionless on purpose: the package's tsc baseline
// rejects new `.ts`-suffixed imports, TS5097). They are placed after the last
// baseline-pinned import line so the recorded diagnostics do not shift.
import {
  assertVerificationCommandsAllowed,
  VerificationCommandRefusedError,
  type VerificationCommandGuard,
} from './artifacts'
import type { ShellGateOptions } from './policy'
// Single path authority (P0): ledger key/path and run directories are resolved
// in runtime/state-layout.ts. `canonicalLedgerKey` stays exported from this
// module (the ported public surface) as a re-export. Imported extensionless
// because the package's tsc baseline rejects `.ts`-suffixed imports.
import {
  resolveStateLayout,
  type StateLayout,
} from './runtime/state-layout'
export { canonicalLedgerKey } from './runtime/state-layout'
// P4: package-manager-aware worktree bootstrap and the branch-aware push rule.
// Placed after the baseline-pinned import block on purpose: the package's tsc
// baseline records diagnostics by line, so nothing may shift lines 26-60.
import { bootstrapCommand, isPushAllowed } from './runtime/bootstrap'
import { detectProject } from './runtime/detect'

/**
 * Bun shell tag (`$` from 'bun'). Kept loose on purpose: the tag is injected in
 * tests and otherwise falls back to the real `bun` export.
 */
export type SupervisorShell = any

export const SUPERVISOR_REPO_ROOT_ENV_VAR = 'SUPERVISOR_REPO_ROOT'
export const SUPERVISOR_BRANCHES_ENV_VAR = 'SUPERVISOR_BRANCHES'
export const SUPERVISOR_VERIFY_PROFILE_ENV_VAR = 'SUPERVISOR_VERIFY_PROFILE'
export const DEFAULT_BRANCHES: { dev: string; main: string } = {
  dev: 'develop',
  main: 'main',
}
/**
 * Session harness label recorded on attempts. The opencode CLI binary itself is
 * resolved by `adapters/opencode-cli.ts` from OPENCODE_BIN (default `opencode2`).
 */
export const DEFAULT_HARNESS = 'opencode-session'

/** Where the resolved config came from, highest priority first. */
export type SupervisorConfigSource =
  | 'options'
  | 'ctx.options'
  | 'env'
  | 'ctx.location'
  | 'default'

export interface SupervisorOptions {
  repoRoot?: string
  /** Alias for `repoRoot` — runtime sessions hand the workspace dir as `ctx.location.directory`. */
  directory?: string
  /** Explicit SQLite ledger path. Defaults to `<canonical repo>/.opencode/supervisor.db`. */
  ledgerPath?: string
  branches?: { dev?: string; main?: string }
  /** Default verification commands used when a caller passes an empty list. */
  verifyProfile?: string[]
  /** Carried for the CLI/runner policy layer (`policy.isCommandAllowed`); not yet consulted here. */
  allowedCommands?: string[]
  /**
   * Emit `supervisor.<name>` tool keys instead of the flat `supervisor_<name>`
   * keys. Default false so existing sessions keep resolving their tool names.
   */
  namespace?: boolean
  /** Session harness label recorded on attempts. */
  harness?: string
  /** Injectable Bun shell tag; defaults to the `bun` module export. */
  $?: SupervisorShell
  /** VIEW projection sink (runtime `ctx.storage`). Never a fencing authority. */
  projection?: ViewProjectionStore | null
  /**
   * Already-resolved state layout (local or central). When supplied it IS the
   * path authority: the run/ledger directories are never re-derived from the
   * project root, so a central project never writes into the checkout.
   */
  stateLayout?: StateLayout
  /** Explicit run-artifact root. Defaults to `layout.runsDir`. */
  runsDir?: string
  /**
   * Shell authority rules consulted before executing a caller-influenced
   * command (verification commands, worktree bootstrap). Defaults to the
   * project's root `opencode.json` rules, else `CANONICAL_SHELL_RULES`.
   */
  shellRules?: PermissionRule[]
}

export interface ResolvedSupervisorConfig {
  repoRoot: string
  /** Canonical (realpath) repo root — the ledger singleton key. */
  ledgerKey: string
  ledgerPath: string
  /** Resolved path authority. `layout.ledgerPath === ledgerPath` always. */
  layout: StateLayout
  branches: { dev: string; main: string }
  verifyProfile: string[]
  allowedCommands: string[]
  namespace: boolean
  harness: string
  source: SupervisorConfigSource
  $?: SupervisorShell
  projection?: ViewProjectionStore | null
  /**
   * Run-artifact root: `<repoRoot>/.opencode/runs` in local mode, the central
   * per-project `runs/` in central mode. Every run projection is written here,
   * never to a hardcoded checkout path.
   */
  runsDir: string
  /** Alias of `layout`, for callers that read the resolved layout off the config. */
  stateLayout?: StateLayout
  /**
   * Shell authority rules (from the policy-authority snapshot at the conductor
   * entry). Gates every shell-executing path that is not already the user's
   * own bash tool call.
   */
  shellRules: PermissionRule[]
}

export interface ResolveSupervisorConfigInput {
  /** Explicit factory options (highest priority). */
  options?: SupervisorOptions | null
  /** Server-side `ctx.options` — unconfirmed shape, read opportunistically. */
  ctxOptions?: unknown
  /** Runtime `ctx.location.directory` — unconfirmed shape, read opportunistically. */
  locationDirectory?: string | null
  env?: Record<string, string | undefined>
  cwd?: string
}

function firstNonEmpty(...values: Array<string | undefined | null>): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value
  }
  return null
}

/**
 * Best-effort read of server-side plugin options. Unconfirmed shape (discovery:
 * "server ctx.options NOT shown — VERIFY"): accept either `{ supervisor: {...} }`
 * or a flat options bag, and never let a hostile/throwing getter break setup.
 */
export function pickSupervisorOptions(raw: unknown): SupervisorOptions | null {
  if (!raw || typeof raw !== 'object') return null
  try {
    const nested = (raw as Record<string, unknown>).supervisor
    if (nested && typeof nested === 'object') return nested as SupervisorOptions
    return raw as SupervisorOptions
  } catch {
    return null
  }
}

export function readCtxOptions(ctx: unknown): unknown {
  try {
    return (ctx as { options?: unknown } | null)?.options ?? null
  } catch {
    return null
  }
}

export function readCtxLocationDirectory(ctx: unknown): string | null {
  try {
    const value = (ctx as { location?: { directory?: unknown } } | null)?.location
      ?.directory
    return typeof value === 'string' && value.length > 0 ? value : null
  } catch {
    return null
  }
}

/**
 * Split a comma-separated env value into a trimmed, non-empty list.
 * `SUPERVISOR_BRANCHES` accepts either `dev,main` or `dev:main`.
 */
export function parseListEnv(value: string | undefined): string[] {
  if (typeof value !== 'string' || value.trim().length === 0) return []
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

function resolveBranches(
  options: SupervisorOptions,
  ctxOptions: SupervisorOptions | null,
  env: Record<string, string | undefined>,
): { dev: string; main: string } {
  const fromEnv = parseListEnv(env[SUPERVISOR_BRANCHES_ENV_VAR])
  return {
    dev:
      firstNonEmpty(options.branches?.dev, ctxOptions?.branches?.dev, fromEnv[0]) ??
      DEFAULT_BRANCHES.dev,
    main:
      firstNonEmpty(options.branches?.main, ctxOptions?.branches?.main, fromEnv[1]) ??
      DEFAULT_BRANCHES.main,
  }
}

function resolveList(
  ...sources: Array<string[] | string | undefined | null>
): string[] {
  for (const source of sources) {
    if (Array.isArray(source)) {
      const list = source.filter(
        (entry): entry is string => typeof entry === 'string' && entry.trim().length > 0,
      )
      if (list.length > 0) return list
      continue
    }
    const list = parseListEnv(source ?? undefined)
    if (list.length > 0) return list
  }
  return []
}

/**
 * Resolve plugin configuration.
 *
 * Order (explicit beats ambient): factory options -> server-side
 * `ctx.options.supervisor` (unconfirmed, opportunistic) -> `SUPERVISOR_*` env ->
 * runtime `ctx.location.directory` (opportunistic) -> `process.cwd()`.
 * The ledger is keyed and defaulted on the CANONICAL repo path.
 */
export function resolveSupervisorConfig(
  input: ResolveSupervisorConfigInput = {},
): ResolvedSupervisorConfig {
  const options = input.options ?? {}
  const ctxOptions = pickSupervisorOptions(input.ctxOptions)
  const env = input.env ?? {}
  const cwd = firstNonEmpty(input.cwd) ?? process.cwd()

  const fromOptions = firstNonEmpty(options.repoRoot, options.directory)
  const fromCtxOptions = firstNonEmpty(ctxOptions?.repoRoot, ctxOptions?.directory)
  const fromEnv = firstNonEmpty(env[SUPERVISOR_REPO_ROOT_ENV_VAR])
  const fromLocation = firstNonEmpty(input.locationDirectory)

  let repoRoot: string
  let source: SupervisorConfigSource
  if (fromOptions) {
    repoRoot = fromOptions
    source = 'options'
  } else if (fromCtxOptions) {
    repoRoot = fromCtxOptions
    source = 'ctx.options'
  } else if (fromEnv) {
    repoRoot = fromEnv
    source = 'env'
  } else if (fromLocation) {
    repoRoot = fromLocation
    source = 'ctx.location'
  } else {
    repoRoot = cwd
    source = 'default'
  }

  // Path authority: ledgerKey/ledgerPath default from the resolved layout. An
  // explicit ledgerPath (factory options or server ctx.options only — never
  // project config) still wins, and the layout is overlayed so the two can
  // never disagree. A supplied `stateLayout` (the conductor entry's resolved
  // identity) is used as-is: re-deriving it here would silently move a central
  // project's state back into the checkout.
  const resolvedLayout =
    options.stateLayout ??
    resolveStateLayout({ projectRoot: repoRoot, env })
  const explicitLedgerPath = firstNonEmpty(
    options.ledgerPath,
    ctxOptions?.ledgerPath,
  )
  const layout: StateLayout = explicitLedgerPath
    ? { ...resolvedLayout, ledgerPath: explicitLedgerPath }
    : resolvedLayout
  const ledgerKey = layout.ledgerKey
  const ledgerPath = layout.ledgerPath
  // Run projections go to the RESOLVED runs directory, never to a hardcoded
  // `<repoRoot>/.opencode/runs`: central mode must not write into the checkout.
  const runsDir = firstNonEmpty(options.runsDir) ?? layout.runsDir
  // Shell authority for internal command execution. An explicit (non-empty)
  // rule set wins; otherwise the project's root `opencode.json` rules, else the
  // canonical mirror — the same precedence `createPolicySnapshot` uses.
  const shellRules =
    Array.isArray(options.shellRules) && options.shellRules.length > 0
      ? options.shellRules
      : rootShellRules(repoRoot)

  return {
    repoRoot,
    ledgerKey,
    ledgerPath,
    layout,
    stateLayout: layout,
    runsDir,
    shellRules,
    branches: resolveBranches(options, ctxOptions, env),
    verifyProfile: resolveList(
      options.verifyProfile,
      ctxOptions?.verifyProfile,
      env[SUPERVISOR_VERIFY_PROFILE_ENV_VAR],
    ),
    allowedCommands: resolveList(options.allowedCommands, ctxOptions?.allowedCommands),
    namespace: options.namespace ?? ctxOptions?.namespace ?? false,
    harness: firstNonEmpty(options.harness, ctxOptions?.harness) ?? DEFAULT_HARNESS,
    source,
    $: options.$,
    projection: options.projection ?? null,
  }
}

/** Flat name (default) or `supervisor.<name>` key when namespacing is on. */
export function toolName(flatName: string, namespace: boolean): string {
  if (!namespace) return flatName
  const bare = flatName.startsWith('supervisor_')
    ? flatName.slice('supervisor_'.length)
    : flatName
  return `supervisor.${bare}`
}

// ---------------------------------------------------------------------------
// VIEW projections (ctx.storage)
//
// CONTRACT: SQLite (`SqliteLedger` / ILedger) is the SOLE fencing, lease,
// heartbeat, sequence and durable-state authority. Anything reached through
// `ctx.storage` below is a read/write CACHE for VIEW data (status cards, board
// snapshots) and must never carry a claim/release/heartbeat/sequence write.
// `tests/index.test.ts` encodes that as an assertion over the exported shape.
// ---------------------------------------------------------------------------

/** Narrow runtime storage surface used for projections only. */
export interface PluginStorage {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
  remove(key: string): Promise<void>
  scan(input: {
    prefix: string
    limit?: number
  }): Promise<{ entries?: Array<{ key: string; value: unknown }>; next?: unknown }>
}

/** Read/write VIEW projections. Deliberately authority-free. */
export interface ViewProjectionStore {
  readonly kind: 'projection'
  keyFor(runId: string): string
  readRunView(runId: string): Promise<unknown | null>
  writeRunView(runId: string, view: unknown): Promise<void>
  listRunViews(): Promise<Array<{ key: string; value: unknown }>>
  removeRunView(runId: string): Promise<void>
  readBoard(): Promise<unknown | null>
  writeBoard(board: unknown): Promise<void>
}

export const PROJECTION_KEY_PREFIX = 'runs/'
export const PROJECTION_BOARD_KEY = 'board'
export const PROJECTION_SCAN_LIMIT = 200

/** Every member a projection adapter may expose — nothing else. */
export const PROJECTION_ALLOWED_METHODS = [
  'kind',
  'keyFor',
  'readRunView',
  'writeRunView',
  'listRunViews',
  'removeRunView',
  'readBoard',
  'writeBoard',
] as const

/**
 * Authority capabilities that must NEVER appear on a projection adapter:
 * fencing/lease/claim writes, heartbeat renewal, and event/sequence allocation.
 */
export const PROJECTION_FORBIDDEN_AUTHORITY_NAMES = [
  'claim',
  'release',
  'lease',
  'heartbeat',
  'sequence',
  'fencing',
  'fence',
  'durable',
  'attempt',
  'transaction',
  'appendEvent',
  'transition',
] as const

/** True when the runtime handed us a usable projection storage API. */
export function isProjectionStorage(value: unknown): value is PluginStorage {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.get === 'function' &&
    typeof candidate.set === 'function' &&
    typeof candidate.remove === 'function' &&
    typeof candidate.scan === 'function'
  )
}

/** Adapt runtime storage into a VIEW-only projection store. */
export function createStorageProjection(storage: PluginStorage): ViewProjectionStore {
  const keyFor = (runId: string) => `${PROJECTION_KEY_PREFIX}${runId}`
  return {
    kind: 'projection',
    keyFor,
    async readRunView(runId) {
      const value = await storage.get(keyFor(runId))
      return value === undefined ? null : value
    },
    async writeRunView(runId, view) {
      await storage.set(keyFor(runId), view)
    },
    async listRunViews() {
      const page = await storage.scan({
        prefix: PROJECTION_KEY_PREFIX,
        limit: PROJECTION_SCAN_LIMIT,
      })
      return Array.isArray(page?.entries) ? page.entries : []
    },
    async removeRunView(runId) {
      await storage.remove(keyFor(runId))
    },
    async readBoard() {
      const value = await storage.get(PROJECTION_BOARD_KEY)
      return value === undefined ? null : value
    },
    async writeBoard(board) {
      await storage.set(PROJECTION_BOARD_KEY, board)
    },
  }
}

const ledgers = new Map<string, SqliteLedger>()

function getLedger(config: ResolvedSupervisorConfig): SqliteLedger {
  let ledger = ledgers.get(config.ledgerKey)
  if (!ledger) {
    mkdirSync(dirname(config.ledgerPath), { recursive: true })
    ledger = new SqliteLedger(config.ledgerPath)
    ledgers.set(config.ledgerKey, ledger)
  }
  return ledger
}

// ---------------------------------------------------------------------------
// POLICY-AUTHORITY SNAPSHOT (security-critic F1)
//
// Canonical permission inputs (the root `opencode.json` bash rules and this
// package's `profiles/*.json` bundles) are captured ONCE at
// plugin load and hashed. At each gated event the files are re-stat/re-hashed:
// a mismatch means the authority changed under us (an agent-writable live
// profile edit), so the gate FAILS CLOSED (deny + a `policy_tampered` event)
// instead of reading the mutated rules live. Rules are ALWAYS taken from the
// snapshot, never re-read per event.
// ---------------------------------------------------------------------------

export const PROFILE_BASENAMES = ['assisted', 'local', 'unattended-low-risk'] as const
export const PROFILE_DIR = 'tools/opencode-conductor/profiles'

/** Every supervisor tool the execute hook trusts without policy narrowing. */
export const SUPERVISOR_TOOL_ALLOWLIST: readonly string[] = [
  'supervisor_init_run',
  'supervisor_request_refinement',
  'supervisor_record_requirements',
  'supervisor_create_task',
  'supervisor_get_status',
  'supervisor_claim_task',
  'supervisor_verify',
  'supervisor_record_evidence',
  'supervisor_record_finding',
  'supervisor_worktree',
  'supervisor_generate_receipt',
  'supervisor_cancel_run',
  'supervisor_patrol',
  'supervisor_sweep',
]

function readJsonFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

export interface ProfileEntry {
  basename: string
  profile: Record<string, unknown>
}

function loadProfilesSync(repoRoot: string): ProfileEntry[] {
  const found: ProfileEntry[] = []
  for (const basename of PROFILE_BASENAMES) {
    const profile = readJsonFile(`${repoRoot}/${PROFILE_DIR}/${basename}.json`)
    if (profile && typeof profile === 'object') {
      found.push({ basename, profile: profile as Record<string, unknown> })
    }
  }
  return found
}

/**
 * Canonical shell authority: the root `opencode.json` permission.bash rules.
 * Never hardcode a third copy — only fall back to the documented mirror when
 * that file cannot be read.
 */
function rootShellRules(repoRoot: string): PermissionRule[] {
  const config = readJsonFile(`${repoRoot}/opencode.json`) as
    | { permission?: { bash?: Record<string, unknown> } }
    | null
  const bash = config?.permission?.bash
  if (!bash || typeof bash !== 'object') return CANONICAL_SHELL_RULES
  const rules: PermissionRule[] = []
  for (const [resource, effect] of Object.entries(bash)) {
    if (resource === '*' || typeof effect !== 'string') continue
    rules.push({ action: 'shell', resource, effect })
  }
  return rules.length > 0 ? rules : CANONICAL_SHELL_RULES
}

function hashPolicyInputs(
  rootRules: PermissionRule[],
  profiles: ProfileEntry[],
): string {
  return createHash('sha256')
    .update(JSON.stringify({ rootRules, profiles }))
    .digest('hex')
}

/** A resolved gate scope, computed once at snapshot time. */
export interface ResolvedGateScope {
  policy: PolicyConfig
  allowedServers: string[]
  shellRules: PermissionRule[]
  runId: string | null
  failClosed: boolean
}

export interface PolicySnapshot {
  repoRoot: string
  rootShellRules: PermissionRule[]
  profiles: ProfileEntry[]
  hash: string
  /** 'unscoped' means no resolvable profile: interactive sessions stay open. */
  scope: ResolvedGateScope | 'unscoped'
  /** Ledger-resolved run scope is fixed at snapshot time (F10: no per-event sqlite). */
  runId: string | null
}

/**
 * Latest non-terminal supervised run, read ONCE at snapshot creation.
 *
 * Takes the RESOLVED ledger path (from `StateLayout` / `ResolvedSupervisorConfig`)
 * — never re-derives `<repoRoot>/.opencode/supervisor.db`, so a custom
 * `ledgerPath` is honoured instead of silently reading the default database.
 */
function latestActiveRun(ledgerPath: string): {
  id: string
  policy_profile: string | null
  operation_mode: string | null
  data_class: string | null
} | null {
  const terminal = [...TERMINAL_STATES]
  const placeholders = terminal.map(() => '?').join(',')
  try {
    const db = new Database(ledgerPath, {
      readonly: true,
    })
    try {
      return (
        (db
          .query(
            `SELECT id, policy_profile, operation_mode, data_class FROM runs WHERE state NOT IN (${placeholders}) ORDER BY created_at DESC LIMIT 1`,
          )
          .get(...terminal) as {
          id: string
          policy_profile: string | null
          operation_mode: string | null
          data_class: string | null
        } | null) ?? null
      )
    } finally {
      db.close()
    }
  } catch {
    return null
  }
}

function scopeForProfile(
  key: string,
  profiles: ProfileEntry[],
  shellRules: PermissionRule[],
  runId: string | null,
  failClosed: boolean,
): ResolvedGateScope | null {
  const match = findProfileForKey(key, profiles)
  if (!match) return null
  const policy = loadPolicyConfig(match.profile)
  return {
    policy,
    allowedServers: resolveMcpAllowedServers(policy.mcpProfiles),
    shellRules,
    runId,
    failClosed,
  }
}

/**
 * Capture the canonical policy authority once. The gate scope (explicit
 * `SUPERVISOR_POLICY_PROFILE` selector, else the most recent supervised run,
 * else `assisted`) is resolved here and never re-read per event.
 *
 * `ledgerPath` is the resolved path authority (from `StateLayout`). It is
 * optional only for compatibility with existing callers/tests that pass the
 * canonical repo root; the fallback resolves through `StateLayout` (never a
 * locally interpolated `<repoRoot>/.opencode/supervisor.db`), so a custom or
 * central ledger is honoured instead of silently missing.
 */
export function createPolicySnapshot(
  repoRoot: string,
  ledgerPath: string = resolveStateLayout({ projectRoot: repoRoot }).ledgerPath,
): PolicySnapshot {
  const rootRules = rootShellRules(repoRoot)
  const profiles = loadProfilesSync(repoRoot)
  const hash = hashPolicyInputs(rootRules, profiles)

  const requested = (process.env.SUPERVISOR_POLICY_PROFILE ?? '').trim()
  let key = requested
  let runId: string | null = null
  if (!key) {
    const active = latestActiveRun(ledgerPath)
    if (active) {
      key = String(active.policy_profile || active.operation_mode || '')
      runId = active.id
    }
  }
  if (!key) key = 'assisted'

  const scope = scopeForProfile(key, profiles, rootRules, runId, false)
  if (!scope) {
    // Explicit selector that cannot be resolved: fail closed. An implicit
    // default that cannot be resolved leaves the session unscoped.
    if (!requested) {
      return {
        repoRoot,
        rootShellRules: rootRules,
        profiles,
        hash,
        scope: 'unscoped',
        runId,
      }
    }
    return {
      repoRoot,
      rootShellRules: rootRules,
      profiles,
      hash,
      scope: {
        policy: loadPolicyConfig({}),
        allowedServers: [],
        shellRules: rootRules,
        runId,
        failClosed: true,
      },
      runId,
    }
  }
  return { repoRoot, rootShellRules: rootRules, profiles, hash, scope, runId }
}

/** Re-stat/re-hash the canonical inputs; false means the authority changed. */
export function isPolicySnapshotIntact(snapshot: PolicySnapshot): boolean {
  const current = hashPolicyInputs(
    rootShellRules(snapshot.repoRoot),
    loadProfilesSync(snapshot.repoRoot),
  )
  return current === snapshot.hash
}

function recordGateDenial(
  ledger: SqliteLedger | null,
  runId: string | null,
  eventType: string,
  payload: Record<string, unknown>,
): void {
  const note = `[supervisor] ${eventType}: ${JSON.stringify(payload).slice(0, 200)}`
  console.warn(note)
  if (!ledger || !runId) return
  try {
    void ledger
      .appendEvent({
        runId,
        eventType,
        actor: 'supervisor-plugin',
        payloadJson: JSON.stringify(payload),
      })
      .catch(() => console.warn(`${note} (ledger unavailable)`))
  } catch {
    console.warn(`${note} (ledger unavailable)`)
  }
}

/**
 * Emit `sweep_blocked_ledger_unhealthy` best-effort. The event needs a run to
 * attach to; when the ledger has no run rows it cannot be attributed, so we log
 * loudly instead of writing a run-less event.
 */
async function recordSweepBlocked(
  ledger: SqliteLedger,
  site: string,
  reason: string,
): Promise<void> {
  try {
    const runs = await ledger.listRuns()
    const runId = runs[0]?.id
    if (!runId) {
      console.warn(
        `[supervisor] sweep_blocked_ledger_unhealthy (${site}): ${reason} (no run to attribute)`,
      )
      return
    }
    await ledger.appendEvent({
      runId,
      eventType: 'sweep_blocked_ledger_unhealthy',
      actor: 'supervisor-plugin',
      payloadJson: JSON.stringify({ site, reason }),
    })
  } catch {
    console.warn(`[supervisor] sweep_blocked_ledger_unhealthy (${site}): ${reason}`)
  }
}

/** Enumerated allowlist: exact flat names or the namespaced `supervisor.<name>`. */
export function isAllowedSupervisorTool(toolName: string): boolean {
  if (SUPERVISOR_TOOL_ALLOWLIST.includes(toolName)) return true
  if (toolName.startsWith('supervisor.')) {
    const bare = toolName.slice('supervisor.'.length)
    return SUPERVISOR_TOOL_ALLOWLIST.includes(`supervisor_${bare}`)
  }
  return false
}

export interface PolicyGuardContext {
  snapshot: PolicySnapshot
  ledger?: SqliteLedger | null
}

/**
 * Policy gate consulted by the `execute.before` hook (in addition to the
 * legacy secrets/dangerous-command guard). Runs the snapshot tamper check
 * first: a mutated authority denies the gated event fail-closed.
 */
export function supervisorPolicyGuard(
  event: any,
  context: PolicyGuardContext,
): void {
  const toolName = String(event?.tool ?? '')
  // Enumerated allowlist only — never a wholesale `supervisor_` prefix bypass.
  if (isAllowedSupervisorTool(toolName)) return

  const { snapshot } = context
  const ledger = context.ledger ?? null

  if (!isPolicySnapshotIntact(snapshot)) {
    recordGateDenial(ledger, snapshot.runId, 'policy_tampered', {
      tool: toolName,
      reason: 'canonical policy inputs changed after snapshot',
    })
    throw new Error(
      'Blocked: supervisor policy snapshot no longer matches the canonical ' +
        'permission authority (fail-closed)',
    )
  }

  if (snapshot.scope === 'unscoped') return
  const scope = snapshot.scope
  const input = event?.input ?? {}
  const command = String(input.command ?? input.cmd ?? '')

  if ((toolName === 'bash' || toolName === 'shell') && command) {
    const restricted = scope.policy.denyMutatingShell || scope.failClosed
    const decision = evaluateShellGate(
      command,
      scope.shellRules,
      scope.policy.permissions,
      {
        denyMutating: restricted,
        // No interactive channel in a hook: deny `ask` when restricted,
        // otherwise defer to opencode's own prompt.
        askEffect: restricted ? 'deny' : 'allow',
      },
    )
    if (!decision.allowed) {
      recordGateDenial(ledger, scope.runId, 'shell_command_denied', {
        tool: toolName,
        command: command.slice(0, 200),
        reason: decision.reason,
      })
      throw new Error(
        `Blocked shell command (${decision.reason}): ${command.slice(0, 80)}`,
      )
    }
    return
  }

  // MCP scope gate: unknown `mcp__`/`mcp_` namespaces fail closed.
  if (!isToolInMcpScope(toolName, scope.allowedServers)) {
    recordGateDenial(ledger, scope.runId, 'mcp_scope_denied', {
      tool: toolName,
      allowed_servers: scope.allowedServers,
    })
    throw new Error(
      `MCP tool '${toolName}' is outside the effective profile's MCP scope`,
    )
  }
}


// ---------------------------------------------------------------------------
// Internal shell gate
//
// `supervisor_verify` used to be an ungated shell channel: `runVerification`
// executes every caller-supplied string through `/bin/sh -c`, and the
// `execute.before` policy guard deliberately trusts every `supervisor_*` tool.
// A prompt-injected repository therefore only had to steer one agent into
// `supervisor_verify({ commands: ["curl … | sh"] })`.
//
// Every shell-executing path INSIDE this file is now routed through the same
// `evaluateShellGate` authority before it spawns. A denial is a structured tool
// result (`{ refused: true, code: 'shell_denied', command, reason }`) and never
// a partial run; nothing is silently dropped.
// ---------------------------------------------------------------------------

/** Stable refusal code for a policy-denied shell command. */
export const SHELL_DENIED_CODE = 'shell_denied' as const

/** The structured refusal returned (never thrown) by a gated tool. */
export interface ShellDeniedRefusal {
  refused: true
  code: typeof SHELL_DENIED_CODE
  command: string
  reason: string
}

/** Typed denial thrown by internal helpers; tools convert it to a refusal. */
export class ShellCommandDeniedError extends Error {
  readonly code = SHELL_DENIED_CODE
  readonly command: string
  readonly reason: string

  constructor(command: string, reason: string) {
    super(`Blocked shell command (${reason}): ${command.slice(0, 120)}`)
    this.name = 'ShellCommandDeniedError'
    this.command = command
    this.reason = reason
  }
}

/** Build the structured refusal payload for a denied command. */
export function shellDeniedRefusal(
  command: string,
  reason: string,
): ShellDeniedRefusal {
  return {
    refused: true,
    code: SHELL_DENIED_CODE,
    command,
    reason,
  }
}

/** True when `value` is a `ShellCommandDeniedError` (cross-realm safe). */
export function isShellCommandDeniedError(
  value: unknown,
): value is ShellCommandDeniedError {
  return (
    value instanceof ShellCommandDeniedError ||
    (typeof value === 'object' &&
      value !== null &&
      (value as { code?: unknown }).code === SHELL_DENIED_CODE &&
      typeof (value as { command?: unknown }).command === 'string' &&
      typeof (value as { reason?: unknown }).reason === 'string')
  )
}

/**
 * No-rules disqualifiers. These reject the classic arbitrary-code channel
 * regardless of what the permission file allows: a recorded verification
 * command is a build/test invocation, never a download piped into a
 * interpreter. Piping into a formatter or pager is untouched.
 */
const INTRINSIC_SHELL_DENIES: ReadonlyArray<{
  pattern: RegExp
  reason: string
}> = [
  {
    pattern:
      /\|\s*(?:\S*\/)?(?:sh|bash|zsh|dash|ksh|fish|node|deno|python3?|perl|ruby|php|osascript|pwsh|powershell)\b/,
    reason: 'deny:pipe-to-interpreter',
  },
  { pattern: /\$\(/, reason: 'deny:command-substitution' },
  { pattern: /`/, reason: 'deny:command-substitution' },
  { pattern: /(?:^|[;&|]\s*)eval\s/, reason: 'deny:eval' },
]

/** The intrinsic deny reason for `command`, or null when none applies. */
export function findIntrinsicShellDenial(command: string): string | null {
  for (const entry of INTRINSIC_SHELL_DENIES) {
    if (entry.pattern.test(command)) return entry.reason
  }
  return null
}

/**
 * The one gate every internal command passes: the intrinsic denies first, then
 * the two-layer `evaluateShellGate` over the authority rules.
 *
 * `askEffect` is a per-path decision: verification commands have no interactive
 * channel (`deny`), while a fixed internal bootstrap command was already
 * invoked by the operator, so an `ask` rule is satisfied by that invocation and
 * `deny` rules still block.
 */
export function evaluateInternalShellCommand(
  command: string,
  shellRules: PermissionRule[],
  opts: ShellGateOptions = {},
): { allowed: boolean; reason: string } {
  const intrinsic = findIntrinsicShellDenial(command)
  if (intrinsic) return { allowed: false, reason: intrinsic }
  return evaluateShellGate(command, shellRules, [], {
    askEffect: 'deny',
    ...opts,
  })
}

/** Throw `ShellCommandDeniedError` unless the gate allows `command`. */
export function assertShellCommandAllowed(
  command: string,
  shellRules: PermissionRule[],
  opts: ShellGateOptions = {},
): void {
  const decision = evaluateInternalShellCommand(command, shellRules, opts)
  if (!decision.allowed) {
    throw new ShellCommandDeniedError(command, decision.reason)
  }
}

/** Stable refusal code returned when a verification command is refused. */
export const VERIFICATION_REFUSED_CODE = 'verification_command_refused' as const

/** The structured refusal returned by `supervisor_verify` (never thrown). */
export interface VerificationRefusal {
  refused: true
  code: typeof VERIFICATION_REFUSED_CODE
  command: string
  reason: string
  all_passed: false
  failure_class: 'verification_command_refused'
  results: []
}

/**
 * The guard handed to `runVerification` (and to the standalone loop): exact
 * allowlist membership FIRST, then the policy-authority shell gate. The two
 * checks are independent — a command that is recorded still has to pass the
 * gate, and a command the gate allows still has to be recorded.
 */
export function makeVerificationGuard(
  allowed: readonly string[],
  shellRules: PermissionRule[],
): VerificationCommandGuard {
  return {
    allowed: [...allowed],
    check(command: string) {
      // No interactive channel in a verification run: an `ask` rule denies.
      const decision = evaluateInternalShellCommand(command, shellRules, {
        askEffect: 'deny',
      })
      return { allowed: decision.allowed, reason: decision.reason }
    },
  }
}

/**
 * Exact command-list equality: same length, same order, same strings.
 *
 * A task-bound verify may only run the recorded set. Reordering, widening or
 * narrowing the list is a DIFFERENT set, so it is refused rather than mapped
 * onto the recorded commands (a caller asking for X must never receive results
 * for Y).
 */
export function commandsExactlyMatch(
  supplied: readonly string[],
  recorded: readonly string[],
): boolean {
  if (supplied.length !== recorded.length) return false
  return supplied.every((command, index) => command === recorded[index])
}

/** Build the structured refusal payload for a refused verification command. */
export function verificationRefusal(
  err: VerificationCommandRefusedError,
): VerificationRefusal {
  return {
    refused: true,
    code: VERIFICATION_REFUSED_CODE,
    command: err.command,
    reason: err.reason,
    all_passed: false,
    failure_class: 'verification_command_refused',
    results: [],
  }
}

/** List git worktree paths registered with the main repo (never throws). */
async function listGitWorktreePaths(
  $: SupervisorShell,
  repoRoot: string,
  shellRules: PermissionRule[] = CANONICAL_SHELL_RULES,
): Promise<string[]> {
  const command = `git -C ${repoRoot} worktree list --porcelain`
  assertShellCommandAllowed(command, shellRules, { askEffect: 'deny' })
  const result = await $`git -C ${repoRoot} worktree list --porcelain`
    .nothrow()
    .quiet()
  if (result.exitCode !== 0) return []
  const paths: string[] = []
  for (const line of String(result.stdout).split('\n')) {
    if (line.startsWith('worktree ')) {
      paths.push(line.slice('worktree '.length).trim())
    }
  }
  return paths
}

/** `wt-wi-…` worktrees are the supervisor's own; everything else is skipped. */
function supervisorWorktreeId(path: string): string | null {
  const base = path.split('/').pop() ?? ''
  return /^wt-wi-/.test(base) ? base : null
}

async function isWorktreeDirty(
  $: SupervisorShell,
  path: string,
  shellRules: PermissionRule[] = CANONICAL_SHELL_RULES,
): Promise<boolean> {
  try {
    assertShellCommandAllowed(`git -C ${path} status --porcelain`, shellRules, {
      askEffect: 'deny',
    })
    const status = await $`git -C ${path} status --porcelain`.nothrow().quiet()
    return String(status.stdout).trim().length > 0
  } catch (err) {
    if (isShellCommandDeniedError(err)) throw err
    return false
  }
}

async function inspectSupervisorWorktrees(
  $: SupervisorShell,
  repoRoot: string,
  ledger: SqliteLedger,
  nowMs: number,
  heartbeatFreshMs: number = HEARTBEAT_FRESH_MS,
  shellRules: PermissionRule[] = CANONICAL_SHELL_RULES,
): Promise<Array<Record<string, any>>> {
  const paths = await listGitWorktreePaths($, repoRoot, shellRules)
  const entries: Array<Record<string, any>> = []
  for (const path of paths) {
    const worktreeId = supervisorWorktreeId(path)
    if (!worktreeId) continue
    const taskId = worktreeId.slice('wt-'.length)
    let mtimeMs = 0
    try {
      mtimeMs = statSync(path).mtimeMs
    } catch {
      mtimeMs = 0
    }
    const liveness = await evaluateWorkItemLiveness(
      ledger,
      taskId,
      nowMs,
      heartbeatFreshMs,
    )
    entries.push({
      worktree_id: worktreeId,
      path,
      task_id: taskId,
      mtime_ms: mtimeMs,
      dirty: await isWorktreeDirty($, path, shellRules),
      liveness,
    })
  }
  return entries
}

/**
 * Remove a leaked worktree using the provider's semantics: NEVER force. A
 * dirty worktree is refused (it needs the rescue/quarantine path); a clean one
 * is removed with a plain `git worktree remove`.
 */
async function removeLeakedWorktree(
  $: SupervisorShell,
  repoRoot: string,
  ledger: SqliteLedger,
  entry: Record<string, any>,
  shellRules: PermissionRule[] = CANONICAL_SHELL_RULES,
): Promise<Record<string, unknown>> {
  if (entry.dirty) {
    return {
      worktree_id: entry.worktree_id,
      removed: false,
      reason: 'dirty_requires_rescue',
    }
  }
  assertShellCommandAllowed(
    `git -C ${repoRoot} worktree remove ${entry.path}`,
    shellRules,
    { askEffect: 'deny' },
  )
  const result = await $`git -C ${repoRoot} worktree remove ${entry.path}`
    .nothrow()
    .quiet()
  if (result.exitCode !== 0) {
    return {
      worktree_id: entry.worktree_id,
      removed: false,
      reason: `worktree_remove_failed: ${String(result.stderr).trim().slice(0, 160)}`,
    }
  }
  const workspace = await ledger.getWorkspace(entry.worktree_id)
  if (workspace) await ledger.updateWorkspaceStatus(entry.worktree_id, 'removed')
  return { worktree_id: entry.worktree_id, removed: true, reason: 'removed' }
}

/**
 * Ledger health probe (F3): the ledger must expose its schema AND hold at
 * least one run row before ANY removal is allowed. An unreadable/empty ledger
 * means we cannot attribute a directory to a run, so all removals are refused.
 */
export async function probeLedgerHealth(
  ledger: SqliteLedger,
): Promise<{ healthy: boolean; reason: string; runCount: number }> {
  try {
    const runs = await ledger.listRuns()
    if (!Array.isArray(runs)) {
      return { healthy: false, reason: 'schema_unreadable', runCount: 0 }
    }
    if (runs.length < 1) {
      return { healthy: false, reason: 'no_run_rows', runCount: 0 }
    }
    return { healthy: true, reason: 'ok', runCount: runs.length }
  } catch (err) {
    return {
      healthy: false,
      reason: `probe_failed: ${err instanceof Error ? err.message : String(err)}`,
      runCount: 0,
    }
  }
}

/**
 * F3 attribution: a directory under `.opencode/runs` may be GC'd ONLY when its
 * name matches `^run-` AND it resolves to a ledger run row (or a
 * tombstone/cancelled run event). Anything else (`agent-backups/`, `archive/`,
 * unknown) is REPORT-only.
 */
export function classifyRunDirAttribution(
  name: string,
  ledgerRunIds: Set<string>,
  tombstoned: Set<string>,
): { attributable: boolean; reason: string } {
  if (!/^run-/.test(name)) {
    return { attributable: false, reason: 'name_not_run_prefixed' }
  }
  if (ledgerRunIds.has(name)) return { attributable: true, reason: 'ledger_run_row' }
  if (tombstoned.has(name)) return { attributable: true, reason: 'tombstone' }
  return { attributable: false, reason: 'no_ledger_run_or_tombstone' }
}

function summarizePatrol(report: Record<string, any>): string {
  const lines = [
    `patrol: leaked=${report.leaked.length} released=${report.released.length} kept_live=${report.kept_live.length} removed=${report.removed.length}`,
  ]
  for (const entry of report.details) {
    lines.push(
      `- ${entry.worktree_id} [${entry.live ? 'KEEP' : 'LEAKED'}] ${entry.reason}`,
    )
  }
  return lines.join('\n')
}

function summarizeSweep(report: Record<string, any>): string {
  const lines = [
    `sweep (${report.mode}, older_than_days=${report.older_than_days}): worktrees keep=${report.worktrees.keep.length} sweep=${report.worktrees.sweep.length}; runs keep=${report.runs.keep.length} sweep=${report.runs.sweep.length}; removed=${report.removed.length}`,
  ]
  for (const entry of report.runs.sweep) {
    lines.push(
      `- run ${entry.run_id} age=${entry.age_days.toFixed(1)}d verification=${entry.has_verification} receipt=${entry.has_receipt}`,
    )
  }
  for (const entry of report.worktrees.sweep) {
    lines.push(`- worktree ${entry.worktree_id} age=${entry.age_days.toFixed(1)}d`)
  }
  return lines.join('\n')
}

/**
 * Bounded local shell for the standalone verify path (no attempt to persist
 * against). Mirrors the DEFAULT_VERIFICATION_TIMEOUT_MS contract of
 * runVerification (exit 124 on timeout) so no standalone verify can hold an
 * unbounded shell.
 */
async function runBoundedShell(
  command: string,
  cwd: string,
  timeoutMs: number,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(['/bin/sh', '-c', command], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    try {
      proc.kill()
    } catch {
      // Already exited.
    }
  }, timeoutMs)
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    return {
      exitCode: timedOut ? 124 : exitCode,
      stdout,
      stderr: timedOut
        ? `verification command timed out after ${timeoutMs}ms`
        : stderr,
    }
  } finally {
    clearTimeout(timer)
  }
}

function hashOutput(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

function artifactId(value: string): string {
  return value.replace(/[^a-z0-9-]+/gi, '-').slice(0, 80)
}

/** VIEW of a run: the shape written to run.json and mirrored to storage projections. */
export interface RunView {
  run_id: string
  state?: string
  objective?: string
  risk_class?: string
  operation_mode?: string
  contract: unknown
  created_at?: string
  updated_at?: string
  tasks: Array<Record<string, unknown>>
}

export function buildRunView(runId: string, run: any, workItems: any[]): RunView {
  return {
    run_id: runId,
    state: run?.state,
    objective: run?.request_text,
    risk_class: run?.risk_class,
    operation_mode: run?.operation_mode,
    contract: run?.contract_json ? JSON.parse(run.contract_json) : null,
    created_at: run?.created_at,
    updated_at: run?.updated_at,
    tasks: workItems.map((item) => ({
      task_id: item.id,
      title: item.title,
      role: item.owner_role,
      state: item.state,
      attempts: item.attempts,
      dependencies: JSON.parse(item.dependency_json),
    })),
  }
}

/** Compact status card derived from a run view (VIEW data, no authority). */
export function buildStatusCard(view: RunView): Record<string, unknown> {
  return {
    run_id: view.run_id,
    state: view.state ?? null,
    risk_class: view.risk_class ?? null,
    operation_mode: view.operation_mode ?? null,
    task_count: view.tasks.length,
    tasks: view.tasks.map((task) => ({
      task_id: task.task_id,
      state: task.state,
      role: task.role,
    })),
    updated_at: view.updated_at ?? null,
  }
}

/** Board snapshot derived from run views (VIEW data, no authority). */
export function buildBoard(views: RunView[]): Record<string, unknown> {
  return {
    generated_at: new Date().toISOString(),
    run_count: views.length,
    columns: views.map(buildStatusCard),
  }
}

/**
 * Write the run VIEW projection.
 *
 * `runsDir` is the RESOLVED run-artifact root (`ResolvedSupervisorConfig.runsDir`,
 * i.e. `StateLayout.runsDir`): local mode keeps today's
 * `<repoRoot>/.opencode/runs/<id>/run.json`, central mode writes under the
 * conductor home so a trusted checkout is never mutated by a projection.
 */
async function writeRunProjection(
  runsDir: string,
  runId: string,
  ledger: SqliteLedger,
  projection: ViewProjectionStore | null = null,
): Promise<void> {
  const runDir = `${runsDir}/${runId}`
  mkdirSync(runDir, { recursive: true })
  const run = await ledger.getRun(runId)
  const workItems = await ledger.listWorkItems(runId)
  const view = buildRunView(runId, run, workItems)
  await Bun.write(`${runDir}/run.json`, JSON.stringify(view, null, 2))
  if (projection) {
    // Cache only, and never fatal: SQLite already holds the truth.
    try {
      await projection.writeRunView(runId, buildStatusCard(view))
    } catch {
      // storage is a projection target; a failure must not break a tool call
    }
  }
}

async function writeTaskProjection(runsDir: string, task: any): Promise<void> {
  const taskDir = `${runsDir}/${task.run_id}/tasks/${task.id}`
  mkdirSync(taskDir, { recursive: true })
  await Bun.write(
    `${taskDir}/task.json`,
    JSON.stringify(
      {
        task_id: task.id,
        run_id: task.run_id,
        role: task.owner_role,
        objective: task.title,
        allowed_paths: JSON.parse(task.allowed_paths_json),
        acceptance_criteria: JSON.parse(task.acceptance_criteria_json),
        verification_commands: JSON.parse(task.verification_commands_json),
        dependencies: JSON.parse(task.dependency_json),
        state: task.state,
      },
      null,
      2,
    ),
  )
}

const ROLE_ENUM = [
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

function asContent(value: unknown): { content: string } {
  return { content: typeof value === 'string' ? value : JSON.stringify(value) }
}

/** Minimal registrar surface used to collect/register tool definitions. */
export interface ToolRegistrar {
  add(definition: {
    name: string
    description: string
    input: Record<string, unknown>
    execute: (args: any) => Promise<unknown>
  }): void
}

export interface CollectedTool {
  name: string
  description: string
  input: Record<string, unknown>
  execute: (args: any) => Promise<unknown>
}

/**
 * Non-git contract (P4): a folder without a repository cannot isolate a
 * mutating task. The refusal is identical from `supervisor_worktree` (which
 * has nothing to create) and `supervisor_claim_task` (which must not lease a
 * worktree-bound task), so the code, message and hint live here once.
 */
export const NO_GIT_REPO_CODE = 'no_git_repo' as const
export const NO_GIT_REPO_MESSAGE =
  'This folder is not a git repository; isolated worktrees are unavailable.'
export const NO_GIT_REPO_HINT =
  'Run `git init` in the project root and retry, or run this task without worktree isolation.'

/**
 * Register the supervisor tool set against any `editor.add`-shaped registrar.
 * `runtime` carries the resolved config plus the (optional) VIEW projection.
 */
export function registerSupervisorTools(
  editor: ToolRegistrar,
  runtime: ResolvedSupervisorConfig,
): void {
  const repoRoot = runtime.repoRoot
  const $ = runtime.$ ?? bunDollar
  const ledger = getLedger(runtime)
  const projection = runtime.projection ?? null
  const harness = runtime.harness
  const verifyProfile = runtime.verifyProfile
  // Resolved path + shell authority (never re-derived from `repoRoot`): central
  // mode writes run artifacts under the conductor home, and every internal
  // command is gated by the policy-authority shell rules.
  const runsDir = runtime.runsDir
  const shellRules = runtime.shellRules

  editor.add({
    name: 'supervisor_init_run',
    description:
      'Create a durable supervised run in SQLite. Call this first. JSON files are projections only.',
    input: {
      type: 'object',
      properties: {
        objective: { type: 'string', description: 'What must be achieved' },
        risk_class: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'critical'],
          description: 'Risk level',
        },
        data_class: {
          type: 'string',
          enum: ['public', 'internal', 'confidential', 'regulated'],
          default: 'internal',
        },
        operation_mode: {
          type: 'string',
          enum: ['observe', 'assisted', 'autonomous-low-risk', 'unattended'],
          default: 'assisted',
        },
        uncertainties: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Why the request is under-specified. When non-empty, the run is created in awaiting_refinement instead of intake.',
          default: [],
        },
      },
      required: ['objective', 'risk_class'],
      additionalProperties: false,
    },
    async execute(args: any) {
      const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      await $`mkdir -p ${runsDir}/${runId}`.quiet()

      await ledger.transaction(async (tx) => {
        await tx.createRun({
          id: runId,
          parentId: null,
          repoId: repoRoot,
          requestHash: `${Bun.hash(args.objective)}`,
          dataClass: args.data_class ?? 'internal',
          policyProfile: args.operation_mode ?? 'assisted',
          operationMode: args.operation_mode ?? 'assisted',
          riskClass: args.risk_class,
          requestText: args.objective,
          budgetJson: JSON.stringify({}),
          deadlineAt: null,
        })
        await tx.transitionRunState(runId, 'intake')
        await tx.appendEvent({
          runId,
          eventType: 'run_created',
          actor: 'supervisor-plugin',
          payloadJson: JSON.stringify(args),
        })
        if (args.uncertainties && args.uncertainties.length > 0) {
          await tx.transitionRunState(runId, 'awaiting_refinement')
          await tx.appendEvent({
            runId,
            eventType: 'refinement_requested',
            actor: 'supervisor-plugin',
            payloadJson: JSON.stringify({ uncertainties: args.uncertainties }),
          })
        }
      })

      await writeRunProjection(runsDir, runId, ledger, projection)
      const state =
        args.uncertainties && args.uncertainties.length > 0
          ? 'awaiting_refinement'
          : 'intake'
      return asContent({ run_id: runId, state })
    },
  })

  editor.add({
    name: 'supervisor_request_refinement',
    description:
      'Park a run in awaiting_refinement with the uncertainties that block a well-defined contract. The requirements-refiner subagent then interviews the user and produces the refined contract.',
    input: {
      type: 'object',
      properties: {
        run_id: { type: 'string' },
        uncertainties: {
          type: 'array',
          items: { type: 'string' },
          description: 'What is unclear or missing in the request',
          default: [],
        },
      },
      required: ['run_id'],
      additionalProperties: false,
    },
    async execute(args: any) {
      const run = await ledger.getRun(args.run_id)
      if (!run) return asContent({ error: 'Run not found', run_id: args.run_id })
      if (!['intake', 'awaiting_refinement'].includes(run.state)) {
        return asContent({
          error: `Cannot request refinement from state ${run.state}`,
        })
      }
      await ledger.transaction(async (tx) => {
        await tx.transitionRunState(args.run_id, 'awaiting_refinement')
        await tx.appendEvent({
          runId: args.run_id,
          eventType: 'refinement_requested',
          actor: 'supervisor-plugin',
          payloadJson: JSON.stringify({ uncertainties: args.uncertainties ?? [] }),
        })
      })
      await writeRunProjection(runsDir, args.run_id, ledger, projection)
      return asContent({
        run_id: args.run_id,
        state: 'awaiting_refinement',
        uncertainties: args.uncertainties ?? [],
      })
    },
  })

  editor.add({
    name: 'supervisor_record_requirements',
    description:
      'Persist the refined requirements contract on the run and resume it to discovered. Outcome "completed" means the user refined the request; "declined" means they chose to proceed as-is.',
    input: {
      type: 'object',
      properties: {
        run_id: { type: 'string' },
        objective: { type: 'string', description: 'Refined objective' },
        non_goals: {
          type: 'array',
          items: { type: 'string' },
          default: [],
        },
        acceptance_criteria: {
          type: 'array',
          items: { type: 'string' },
        },
        risk_class: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'critical'],
        },
        constraints: {
          type: 'array',
          items: { type: 'string' },
          default: [],
        },
        qa_pairs: {
          type: 'array',
          items: {},
          description: 'Question/answer pairs from the refinement interview',
          default: [],
        },
        outcome: { type: 'string', enum: ['completed', 'declined'] },
        requirements_path: {
          type: 'string',
          description:
            'Path to the requirements artifact written by the refiner',
        },
      },
      required: [
        'run_id',
        'objective',
        'acceptance_criteria',
        'risk_class',
        'outcome',
      ],
      additionalProperties: false,
    },
    async execute(args: any) {
      const run = await ledger.getRun(args.run_id)
      if (!run) return asContent({ error: 'Run not found', run_id: args.run_id })
      if (!['intake', 'awaiting_refinement'].includes(run.state)) {
        return asContent({
          error: `Cannot record requirements from state ${run.state}`,
        })
      }
      const contract = {
        objective: args.objective,
        non_goals: args.non_goals ?? [],
        acceptance_criteria: args.acceptance_criteria,
        risk_class: args.risk_class,
        constraints: args.constraints ?? [],
        refinement: {
          outcome: args.outcome,
          qa_pairs: args.qa_pairs ?? [],
          requirements_path: args.requirements_path ?? null,
          recorded_at: new Date().toISOString(),
        },
      }
      await ledger.transaction(async (tx) => {
        await tx.updateRunContract(args.run_id, JSON.stringify(contract))
        await tx.transitionRunState(args.run_id, 'discovered')
        await tx.appendEvent({
          runId: args.run_id,
          eventType:
            args.outcome === 'declined'
              ? 'refinement_declined'
              : 'refinement_completed',
          actor: 'supervisor-plugin',
          payloadJson: JSON.stringify({
            objective: args.objective,
            risk_class: args.risk_class,
          }),
        })
      })
      await writeRunProjection(runsDir, args.run_id, ledger, projection)
      return asContent({
        run_id: args.run_id,
        state: 'discovered',
        recorded: true,
        outcome: args.outcome,
      })
    },
  })

  editor.add({
    name: 'supervisor_create_task',
    description:
      'Create a durable work item in SQLite with dependencies, ownership, and acceptance criteria.',
    input: {
      type: 'object',
      properties: {
        run_id: { type: 'string' },
        title: { type: 'string' },
        role: { type: 'string', enum: [...ROLE_ENUM] },
        model_slot: { type: 'string', default: 'implementation' },
        priority: { type: 'number', default: 0 },
        write_scope: {
          type: 'array',
          items: { type: 'string' },
          default: [],
        },
        allowed_paths: {
          type: 'array',
          items: { type: 'string' },
          default: [],
        },
        acceptance_criteria: {
          type: 'array',
          items: { type: 'string' },
        },
        verification_commands: {
          type: 'array',
          items: { type: 'string' },
          default: [],
        },
        dependencies: {
          type: 'array',
          items: { type: 'string' },
          default: [],
        },
      },
      required: ['run_id', 'title', 'role', 'acceptance_criteria'],
      additionalProperties: false,
    },
    async execute(args: any) {
      const itemId = `wi-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      const task = await ledger.transaction(async (tx) => {
        const created = await tx.createWorkItem({
          id: itemId,
          runId: args.run_id,
          issueKey: '',
          title: args.title,
          dependencyJson: JSON.stringify(args.dependencies ?? []),
          ownerRole: args.role,
          modelSlot: args.model_slot ?? 'implementation',
          priority: args.priority ?? 0,
          writeScopeJson: JSON.stringify(args.write_scope ?? []),
          contractJson: JSON.stringify({
            task_id: itemId,
            run_id: args.run_id,
            role: args.role,
            objective: args.title,
            acceptance_criteria: args.acceptance_criteria,
            verification_commands: args.verification_commands ?? [],
            allowed_paths: args.allowed_paths ?? [],
          }),
          allowedPathsJson: JSON.stringify(args.allowed_paths ?? []),
          readPathsJson: JSON.stringify([]),
          acceptanceCriteriaJson: JSON.stringify(args.acceptance_criteria),
          verificationCommandsJson: JSON.stringify(
            args.verification_commands ?? [],
          ),
        })
        await tx.appendEvent({
          runId: args.run_id,
          workItemId: itemId,
          eventType: 'work_item_created',
          actor: 'supervisor-plugin',
          payloadJson: JSON.stringify({ title: args.title, role: args.role }),
        })
        return created
      })

      await writeTaskProjection(runsDir, task)
      await writeRunProjection(runsDir, args.run_id, ledger, projection)
      return asContent({ task_id: itemId, run_id: args.run_id, state: task.state })
    },
  })

  editor.add({
    name: 'supervisor_get_status',
    description: 'Read durable run, task, lease, and attempt status from SQLite.',
    input: {
      type: 'object',
      properties: { run_id: { type: 'string' } },
      required: ['run_id'],
      additionalProperties: false,
    },
    async execute(args: any) {
      const run = await ledger.getRun(args.run_id)
      if (!run) return asContent({ error: 'Run not found', run_id: args.run_id })

      const workItems = await ledger.listWorkItems(args.run_id)
      const tasks = await Promise.all(
        workItems.map(async (item) => {
          const lease = await ledger.getLease(item.id)
          const attempt = await ledger.getLatestAttempt(item.id)
          return {
            task_id: item.id,
            title: item.title,
            role: item.owner_role,
            state: item.state,
            attempts: item.attempts,
            dependencies: JSON.parse(item.dependency_json),
            lease_owner: lease?.lease_owner ?? null,
            fencing_token: lease?.fencing_token ?? null,
            attempt_id: attempt?.id ?? null,
            attempt_state: attempt?.state ?? null,
            model: attempt
              ? `${attempt.model_provider}/${attempt.model_id}`
              : null,
          }
        }),
      )

      return asContent({
        run_id: args.run_id,
        state: run.state,
        risk_class: run.risk_class,
        operation_mode: run.operation_mode,
        created_at: run.created_at,
        updated_at: run.updated_at,
        task_count: tasks.length,
        tasks,
      })
    },
  })

  editor.add({
    name: 'supervisor_claim_task',
    description:
      'Atomically claim a ready task, increment its fencing token, create an attempt, and start its lease.',
    input: {
      type: 'object',
      properties: {
        run_id: { type: 'string' },
        task_id: { type: 'string' },
        lease_owner: { type: 'string' },
        model_provider: { type: 'string', default: 'deepseek' },
        model_id: { type: 'string' },
        base_sha: { type: 'string' },
        workspace_id: { type: 'string' },
        lease_ms: { type: 'number', default: 1200000 },
      },
      required: ['run_id', 'task_id', 'lease_owner', 'model_id', 'base_sha'],
      additionalProperties: false,
    },
    async execute(args: any) {
      const item = await ledger.getWorkItem(args.task_id)
      if (!item || item.run_id !== args.run_id) {
        return asContent({ claimed: false, error: 'Task not found' })
      }

      // Non-git contract (P4): a mutating task needs an isolated worktree, so
      // it cannot be claimed in a folder with no repository. Refused BEFORE the
      // lease/attempt writes; a read-only task does not need isolation and
      // still claims normally.
      if (
        isMutatingRole(item.owner_role) &&
        !detectProject(repoRoot).isGitRepo
      ) {
        return asContent({
          claimed: false,
          code: NO_GIT_REPO_CODE,
          hint: NO_GIT_REPO_HINT,
        })
      }

      const attemptId = `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      const result = await ledger.transaction(async (tx) => {
        const claim = await tx.claimLease({
          workItemId: args.task_id,
          leaseOwner: args.lease_owner,
          leaseExpiresAt: new Date(
            Date.now() + (args.lease_ms ?? 1200000),
          ).toISOString(),
        })
        if (!claim.claimed) return { claimed: false, fencingToken: -1 }

        await tx.incrementWorkItemAttempts(args.task_id)
        await tx.transitionWorkItemState(args.task_id, 'running')
        await tx.createAttempt({
          id: attemptId,
          workItemId: args.task_id,
          attemptNo: item.attempts + 1,
          harness,
          modelProvider: args.model_provider ?? 'deepseek',
          modelId: args.model_id,
          modelVariant: null,
          workspaceId: args.workspace_id ?? null,
          baseSha: args.base_sha,
        })
        await tx.appendEvent({
          runId: args.run_id,
          workItemId: args.task_id,
          attemptId,
          eventType: 'lease_claimed',
          actor: args.lease_owner,
          payloadJson: JSON.stringify({ fencingToken: claim.fencingToken }),
        })
        return { claimed: true, fencingToken: claim.fencingToken }
      })

      return asContent({
        ...result,
        attempt_id: result.claimed ? attemptId : null,
      })
    },
  })

  editor.add({
    name: 'supervisor_verify',
    description:
      'Run deterministic checks and persist command, exit code, duration, output hashes, and artifacts.',
    input: {
      type: 'object',
      properties: {
        commands: { type: 'array', items: { type: 'string' } },
        cwd: { type: 'string' },
        run_id: { type: 'string' },
        attempt_id: { type: 'string' },
      },
      required: ['commands'],
      additionalProperties: false,
    },
    async execute(args: any) {
      // `verifyProfile` (param-reusable option) supplies the default commands
      // when a caller passes none; with no profile configured the behaviour is
      // unchanged.
      const requestedCommands: string[] =
        Array.isArray(args.commands) && args.commands.length > 0
          ? args.commands
          : verifyProfile

      // Resolve attempt -> task -> role up front so the empty-profile rule and
      // the worktree resolution mirror record_evidence exactly.
      let item: any = null
      if (args.attempt_id) {
        const attempt = await ledger.getAttempt(args.attempt_id)
        if (attempt) item = await ledger.getWorkItem(attempt.work_item_id)
      }
      const role = item?.owner_role ?? null

      // Shell gate for every command below: the policy authority's rules (the
      // snapshot carried on the runtime config) plus the intrinsic
      // arbitrary-code denies. `evaluateShellGate` may only narrow.
      const verifyGuardFor = (allowed: readonly string[]) =>
        makeVerificationGuard(allowed, shellRules)

      // Allowlist source (fail closed):
      //   - the task's recorded verification commands are the ONLY commands a
      //     task-bound verify may run;
      //   - a read-only task that recorded none (or a standalone call with no
      //     task at all) may run the operator-configured `verifyProfile`;
      //   - a mutating task that recorded none allows NOTHING.
      let recordedCommands: string[] = []
      try {
        const parsed = JSON.parse(item?.verification_commands_json ?? '[]')
        recordedCommands = Array.isArray(parsed)
          ? parsed.filter((entry: unknown): entry is string => typeof entry === 'string')
          : []
      } catch {
        recordedCommands = []
      }

      // Task-bound exact-match gate. A resolvable task pins the verification
      // profile: a caller-supplied list that is not byte-for-byte the recorded
      // one (same length, same order, same strings) is refused BEFORE anything
      // spawns. Substituting the recorded set would hand the caller results for
      // commands it never asked for — false evidence — so there is no fallback.
      // Omitting `commands` is not a mismatch: the recorded set runs unchanged.
      const suppliedCommands: string[] | null = Array.isArray(args.commands)
        ? (args.commands as string[])
        : null
      if (
        item !== null &&
        suppliedCommands !== null &&
        !commandsExactlyMatch(suppliedCommands, recordedCommands)
      ) {
        return asContent({
          refused: true,
          code: VERIFICATION_REFUSED_CODE,
          reason: 'commands_differ_from_recorded',
          recorded_commands: recordedCommands,
          supplied_commands: suppliedCommands,
          all_passed: false,
          failure_class: 'verification_command_refused',
          results: [],
        })
      }

      const allowlist =
        recordedCommands.length > 0
          ? recordedCommands
          : item === null || !isMutatingRole(role)
            ? verifyProfile
            : []

      // Task-bound verification executes exactly the RECORDED set (the
      // equality gate above already refused every other task-bound list); a
      // standalone call keeps the caller/profile precedence.
      const commands: string[] =
        recordedCommands.length > 0 ? recordedCommands : requestedCommands

      // Empty profile: hard-refuse for mutating tasks (`[].every(...)` is
      // vacuously true, so an empty profile must never read as a pass).
      // Read-only roles have nothing to run by design: neutral skip instead.
      if (commands.length === 0) {
        if (!isMutatingRole(role)) {
          return asContent({
            all_passed: true,
            skipped: true,
            failure_class: null,
            role,
            reason: 'no_verification_commands_for_read_only_role',
            results: [],
          })
        }
        return asContent({
          all_passed: false,
          failure_class: 'no_verification_commands',
          error: 'No verification commands provided',
          results: [],
        })
      }

      const runId = args.run_id ?? item?.run_id ?? null
      const verificationDir = runId
        ? `${runsDir}/${runId}/artifacts/verification`
        : null
      if (verificationDir) await $`mkdir -p ${verificationDir}`.quiet()

      // Same worktree resolution as record_evidence: prefer the recorded task
      // worktree, fall back to the repo root when it is gone.
      let worktreePath = args.cwd ?? repoRoot
      if (item) {
        const workspace = await ledger.getWorkspace(`wt-${item.id}`)
        if (workspace?.path && existsSync(workspace.path)) {
          worktreePath = args.cwd ?? workspace.path
        }
      }

      const timeoutMs = DEFAULT_VERIFICATION_TIMEOUT_MS

      // Persisted path: reuse the canonical bounded runVerification. Every
      // command is capped at DEFAULT_VERIFICATION_TIMEOUT_MS, so this can never
      // hold an unbounded shell, and the verification rows are byte-identical
      // to the runner's. The guard is validated before the first spawn.
      if (args.attempt_id) {
        try {
          const results = await runVerification(
            commands,
            worktreePath,
            args.attempt_id,
            ledger,
            verificationDir ?? repoRoot,
            timeoutMs,
            role,
            verifyGuardFor(allowlist),
          )
          return asContent({
            all_passed: results.every((r: any) => r.passed),
            commands_source: recordedCommands.length > 0 ? 'task_record' : 'caller',
            results: results.map((r: any) => ({
              command: r.command,
              exit_code: r.exitCode,
              passed: r.passed,
              duration_ms: r.durationMs,
              output_hash: r.stdoutHash,
              stdout_path: r.stdoutPath,
              stderr_path: r.stderrPath,
            })),
          })
        } catch (err) {
          if (err instanceof VerificationCommandRefusedError) {
            return asContent(verificationRefusal(err))
          }
          return asContent({
            all_passed: false,
            failure_class: 'verification_error',
            error: err instanceof Error ? err.message : String(err),
            results: [],
          })
        }
      }

      // No attempt to persist against: still bounded (never an unbounded
      // shell) and still gated by the same allowlist + shell rules.
      try {
        assertVerificationCommandsAllowed(commands, verifyGuardFor(allowlist))
      } catch (err) {
        if (err instanceof VerificationCommandRefusedError) {
          return asContent(verificationRefusal(err))
        }
        throw err
      }
      const results: Array<Record<string, unknown>> = []
      for (const command of commands) {
        const startedAt = new Date().toISOString()
        const start = Date.now()
        const outcome = await runBoundedShell(command, worktreePath, timeoutMs)
        const durationMs = Date.now() - start
        // Frozen convention: the output_hash is stdout ONLY (matches
        // artifacts.ts).
        const outputHash = hashOutput(outcome.stdout)
        const prefix = artifactId(`${Date.now()}-${outputHash}`)
        const stdoutPath = verificationDir
          ? `${verificationDir}/${prefix}.stdout`
          : null
        const stderrPath = verificationDir
          ? `${verificationDir}/${prefix}.stderr`
          : null
        if (stdoutPath) await Bun.write(stdoutPath, outcome.stdout)
        if (stderrPath) await Bun.write(stderrPath, outcome.stderr)

        results.push({
          command,
          exit_code: outcome.exitCode,
          passed: outcome.exitCode === 0,
          duration_ms: durationMs,
          started_at: startedAt,
          output_hash: outputHash,
          stdout_path: stdoutPath,
          stderr_path: stderrPath,
        })
      }

      return asContent({
        all_passed: results.every((item) => item.passed),
        results,
      })
    },
  })

  editor.add({
    name: 'supervisor_record_evidence',
    description: 'Record a task attempt result and release its fencing-token lease.',
    input: {
      type: 'object',
      properties: {
        run_id: { type: 'string' },
        task_id: { type: 'string' },
        attempt_id: { type: 'string' },
        fencing_token: { type: 'number' },
        exit_code: { type: 'number' },
        failure_class: { type: 'string' },
        changed_files: {
          type: 'array',
          items: { type: 'string' },
          default: [],
        },
        usage_tokens: { type: 'number' },
      },
      required: [
        'run_id',
        'task_id',
        'attempt_id',
        'fencing_token',
        'exit_code',
      ],
      additionalProperties: false,
    },
    async execute(args: any) {
      const lease = await ledger.getLease(args.task_id)
      if (!lease || lease.fencing_token !== args.fencing_token || lease.released_at) {
        return asContent({ recorded: false, error: 'Stale fencing token' })
      }

      // Independent verification gate: re-run the task's declared
      // verification commands into the unified verification dir and gate
      // completion on their outcome. An empty command list or any failing
      // command fails the attempt for MUTATING roles; read-only roles
      // legitimately declare none, so an empty profile is a neutral skip
      // and completion still requires exit_code === 0. The caller's
      // exit_code alone is never trusted.
      const item = await ledger.getWorkItem(args.task_id)
      const role = item?.owner_role ?? null
      const mutating = isMutatingRole(role)
      let verificationCommands = []
      try {
        verificationCommands = JSON.parse(
          item?.verification_commands_json ?? '[]',
        )
      } catch {
        verificationCommands = []
      }

      // Resolve the task worktree (mutating tasks use `wt-<task>`); fall
      // back to the repo root when no workspace is recorded OR when the
      // recorded path no longer exists on disk (missed worktree cleanup
      // would otherwise make `.cwd()` throw and leak the lease).
      const workspace = await ledger.getWorkspace(`wt-${args.task_id}`)
      const recordedWorktree = workspace?.path
      const worktreePath =
        recordedWorktree && existsSync(recordedWorktree)
          ? recordedWorktree
          : repoRoot
      const verificationDir = `${runsDir}/${args.run_id}/artifacts/verification`
      await $`mkdir -p ${verificationDir}`.quiet()

      // Fail-closed verification gate. runVerification bounds every
      // command (DEFAULT_VERIFICATION_TIMEOUT_MS) so this tool can never
      // hold its fencing lease for an unbounded shell, and any error
      // (duplicate-id collision, timeout, missing cwd) is coerced to a
      // failed attempt rather than a pass.
      //
      // Cost note: record_evidence re-runs the task's verification
      // commands that the runner already executed for the same attempt.
      // That double-run is intentional (independent re-check) and is the
      // reason the verification row is upserted on a stable id.
      let verificationResults: any[] = []
      let verificationError = null
      const verificationSkipped = !mutating && verificationCommands.length === 0
      if (verificationCommands.length > 0) {
        try {
          verificationResults = await runVerification(
            verificationCommands,
            worktreePath,
            args.attempt_id,
            ledger,
            verificationDir,
            undefined,
            role,
            // Same gate as the standalone verify tool: the recorded commands are
            // the allowlist, and the shell authority still has to allow them.
            makeVerificationGuard(verificationCommands, shellRules),
          )
        } catch (err) {
          verificationError = err instanceof Error ? err.message : String(err)
          verificationResults = []
        }
      } else if (verificationSkipped) {
        await ledger.appendEvent({
          runId: args.run_id,
          workItemId: args.task_id,
          attemptId: args.attempt_id,
          eventType: 'verification_skipped',
          actor: 'supervisor-plugin',
          payloadJson: JSON.stringify({
            passed: true,
            role,
            reason: 'no_verification_commands_for_read_only_role',
            results: [],
          }),
        })
      }

      const allPassed =
        verificationError === null &&
        (verificationCommands.length > 0
          ? verificationResults.every((r) => r.passed)
          : verificationSkipped)
      const failureClass = allPassed
        ? null
        : verificationError !== null
          ? 'verification_error'
          : verificationCommands.length === 0
            ? mutating
              ? 'no_verification_commands'
              : 'exit_nonzero'
            : (args.failure_class ?? 'verification_failed')
      const completed = args.exit_code === 0 && allPassed

      const evidence = JSON.stringify({
        attempt_id: args.attempt_id,
        task_id: args.task_id,
        exit_code: args.exit_code,
        changed_files: args.changed_files ?? [],
        verification_results: verificationResults,
        all_checks_passed: allPassed,
        verification_skipped: verificationSkipped,
        failure_class: failureClass,
        verification_error: verificationError,
        collected_at: new Date().toISOString(),
      })

      try {
        if (completed) {
          await ledger.completeAttempt(
            args.attempt_id,
            args.exit_code,
            args.usage_tokens == null
              ? null
              : JSON.stringify({ total_tokens: args.usage_tokens }),
            null,
            null,
            evidence,
          )
          await ledger.transitionWorkItemState(args.task_id, 'completed')
        } else {
          await ledger.failAttempt(
            args.attempt_id,
            failureClass ?? 'exit_nonzero',
            args.exit_code,
            args.usage_tokens == null
              ? null
              : JSON.stringify({ total_tokens: args.usage_tokens }),
            evidence,
          )
          await ledger.transitionWorkItemState(args.task_id, 'failed')
        }
        await writeRunProjection(runsDir, args.run_id, ledger, projection)
      } finally {
        // Always release the fencing-token lease — a thrown verification
        // or recording step must never strand it until expiry.
        await ledger.releaseLease(args.task_id, args.fencing_token)
      }
      return asContent({
        recorded: true,
        task_id: args.task_id,
        all_passed: allPassed,
        failure_class: failureClass,
      })
    },
  })

  editor.add({
    name: 'supervisor_record_finding',
    description: 'Persist a structured independent review finding in SQLite.',
    input: {
      type: 'object',
      properties: {
        review_id: { type: 'string' },
        severity: {
          type: 'string',
          enum: ['info', 'low', 'medium', 'high', 'critical'],
        },
        category: { type: 'string' },
        title: { type: 'string' },
        location: { type: 'string' },
        evidence: { type: 'string' },
        confidence: { type: 'number', default: 0.8 },
        blocking: { type: 'boolean', default: false },
        required_fix: { type: 'string' },
      },
      required: ['review_id', 'severity', 'category', 'title', 'evidence'],
      additionalProperties: false,
    },
    async execute(args: any) {
      const fingerprint = hashOutput(
        `${args.category}:${args.title}:${args.location ?? 'global'}`,
      )
      await ledger.createReviewFinding({
        id: `rf-${Date.now()}-${fingerprint}`,
        reviewId: args.review_id,
        severity: args.severity,
        category: args.category,
        title: args.title,
        fingerprint,
        location: args.location,
        evidence: args.evidence,
        confidence: args.confidence ?? 0.8,
        blocking: args.blocking ?? false,
        requiredFix: args.required_fix,
      })
      return asContent({
        recorded: true,
        fingerprint,
        blocking: args.blocking ?? false,
      })
    },
  })

  editor.add({
    name: 'supervisor_worktree',
    description:
      'Create, inspect, or clean an isolated git worktree and record it in SQLite.',
    input: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['create', 'status', 'cleanup'] },
        task_id: { type: 'string' },
        base_sha: { type: 'string' },
      },
      required: ['action', 'task_id'],
      additionalProperties: false,
    },
    async execute(args: any) {
      // Provider-owned lifecycle (worktrees.ts): the layout
      // `.worktrees/wt-<task>` on branch `supervisor/wi-<task>` is canonical
      // there, so no inline scheme or path fallback remains here.
      const project = detectProject(repoRoot)
      const worktrees = new WorktreeProvider(ledger, {
        basePath: `${repoRoot}/.worktrees`,
        mainRepoPath: repoRoot,
      })
      const workspaceId = canonicalWorktreeId(args.task_id)

      // Non-git contract (P4): with no repository there is no worktree to
      // create, so refuse before any ledger write, directory creation or
      // shell call. Nothing is bootstrapped either.
      if (args.action === 'create' && !project.isGitRepo) {
        return asContent({
          created: false,
          code: NO_GIT_REPO_CODE,
          message: NO_GIT_REPO_MESSAGE,
          hint: NO_GIT_REPO_HINT,
        })
      }

      // Bootstrap command, from the detected package manager, evaluated BEFORE
      // anything is created so a denial returns the structured refusal and
      // never runs. `ask` is satisfied by the operator's tool invocation; deny
      // rules still block. `null` means there is no node project to install.
      const bootstrap = bootstrapCommand(project.packageManager, repoRoot)
      const installDecision = bootstrap
        ? evaluateInternalShellCommand(bootstrap.command, shellRules, {
            askEffect: 'allow',
          })
        : null

      if (args.action === 'status') {
        const info = await worktrees.getWorktreeInfo(workspaceId)
        if (!info) return asContent({ error: 'Worktree not found' })
        return asContent({
          workspace_id: workspaceId,
          path: info.path,
          branch: info.branch,
          base_sha: info.baseSha,
          dirty: info.dirty,
          status: info.status,
        })
      }

      if (args.action === 'create') {
        const existing = await ledger.getWorkspace(workspaceId)
        if (existing)
          return asContent({
            error: 'Worktree already exists',
            workspace_id: workspaceId,
          })
        if (bootstrap && installDecision && !installDecision.allowed) {
          // The bootstrap command is part of this operation: refuse the whole
          // create rather than leave a half-provisioned worktree behind.
          return asContent(
            shellDeniedRefusal(bootstrap.command, installDecision.reason),
          )
        }
        const baseSha = args.base_sha ?? (await worktrees.resolveBaseSha())
        const created = await worktrees.createWorktree(
          workspaceId,
          canonicalWorktreeBranch(args.task_id),
          baseSha,
        )
        let dependencySetup: Record<string, unknown>
        if (!bootstrap) {
          dependencySetup = {
            skipped: true,
            reason: 'no node project (no package.json or lockfile)',
          }
        } else {
          // `{ raw }` hands the rendered command to the shell verbatim: the
          // command is a fixed literal from bootstrap.ts, never caller input.
          const install = await $`${({ raw: bootstrap.command } as any)}`
            .cwd(created.path)
            .nothrow()
            .quiet()
          dependencySetup = {
            command: bootstrap.command,
            exit_code: install.exitCode,
            passed: install.exitCode === 0,
          }
        }
        return asContent({
          workspace_id: workspaceId,
          path: created.path,
          branch: created.branch,
          base_sha: created.baseSha,
          dependency_setup: dependencySetup,
        })
      }

      const info = await worktrees.getWorktreeInfo(workspaceId)
      if (!info) return asContent({ error: 'Worktree not found' })
      // Dirty worktrees are rescued into quarantine rather than refused.
      const result = await worktrees.removeWorktree(workspaceId, false)
      if (!result.removed) {
        return asContent({
          cleaned: false,
          error: 'Worktree cleanup failed',
        })
      }
      return asContent({
        cleaned: true,
        ...(result.rescueBranch ? { rescue_branch: result.rescueBranch } : {}),
        ...(result.quarantinePath
          ? { quarantine_path: result.quarantinePath }
          : {}),
      })
    },
  })

  editor.add({
    name: 'supervisor_generate_receipt',
    description: 'Write the durable run receipt without inventing a completed state.',
    input: {
      type: 'object',
      properties: { run_id: { type: 'string' } },
      required: ['run_id'],
      additionalProperties: false,
    },
    async execute(args: any) {
      const receipt = await generateReceipt(args.run_id, ledger)
      const runDir = `${runsDir}/${args.run_id}`
      await $`mkdir -p ${runDir}`.quiet()
      const receiptPath = `${runDir}/receipt.md`
      await writeReceiptToDisk(receipt, receiptPath)
      await writeRunProjection(runsDir, args.run_id, ledger, projection)
      return asContent({
        receipt_path: receiptPath,
        state: receipt.state,
        total_attempts: receipt.totalAttempts,
        repair_rounds: receipt.repairRounds,
        changed_files: receipt.changedFiles,
        verification_results: receipt.verificationResults,
        model_usage: receipt.modelUsage,
      })
    },
  })

  editor.add({
    name: 'supervisor_cancel_run',
    description: 'Cancel a run durably and append a cancellation event.',
    input: {
      type: 'object',
      properties: {
        run_id: { type: 'string' },
        reason: { type: 'string' },
      },
      required: ['run_id'],
      additionalProperties: false,
    },
    async execute(args: any) {
      await ledger.transaction(async (tx) => {
        await tx.transitionRunState(
          args.run_id,
          'cancelled',
          args.reason ?? 'Cancelled by supervisor',
        )
        await tx.appendEvent({
          runId: args.run_id,
          eventType: 'run_cancelled',
          actor: 'supervisor-plugin',
          payloadJson: JSON.stringify({
            reason: args.reason ?? 'Cancelled by supervisor',
          }),
        })
      })
      await writeRunProjection(runsDir, args.run_id, ledger, projection)
      return asContent({ cancelled: true, run_id: args.run_id })
    },
  })

    // --- Ops resilience: patrol + sweep -------------------------------
    // Both reuse the shared watchdog liveness/classification rules
    // (watchdog.ts) so the plugin and runner never disagree on "live".
    // Neither ever forces a removal.
    editor.add({
      name: 'supervisor_patrol',
      description:
        'Reclaim leaked supervisor worktrees (wt-wi-*) whose tasks hold no active attempt/lease, running the fencing stale-lease recovery path. Removal happens only with remove=true; live worktrees are always kept.',
      input: {
        type: 'object',
        properties: {
          remove: {
            type: 'boolean',
            default: false,
            description:
              'Remove leaked worktrees (clean ones only; dirty worktrees are refused for rescue). Default false = report only.',
          },
          stale_heartbeat_ms: {
            type: 'number',
            description:
              'Heartbeat freshness window in ms (default: watchdog stale window).',
          },
          json: {
            type: 'boolean',
            default: true,
            description: 'Machine-readable JSON output (false = text summary).',
          },
        },
        additionalProperties: false,
      },
      async execute(args: any) {
        const nowMs = Date.now()
        const heartbeatFreshMs = args.stale_heartbeat_ms ?? HEARTBEAT_FRESH_MS
        // Same shell authority as every other internal command: a denied
        // `git worktree list` is a structured refusal, not a silent empty list.
        let entries: Array<Record<string, any>>
        try {
          entries = await inspectSupervisorWorktrees(
            $,
            repoRoot,
            ledger,
            nowMs,
            heartbeatFreshMs,
            shellRules,
          )
        } catch (err) {
          if (isShellCommandDeniedError(err)) {
            return asContent(shellDeniedRefusal(err.command, err.reason))
          }
          throw err
        }

        const leaked = entries
          .filter((entry) => !entry.liveness.live)
          .map((entry) => entry.task_id)
        const keptLive = entries
          .filter((entry) => entry.liveness.live)
          .map((entry) => entry.task_id)

        const watchdog = new Watchdog(
          ledger,
          args.stale_heartbeat_ms
            ? { staleHeartbeatMaxAgeMs: args.stale_heartbeat_ms }
            : undefined,
        )
        const recovered = await watchdog.recoverStaleLeases()
        const released = recovered.map((r: any) => r.workItemId)

        const removed: Array<Record<string, unknown>> = []
        if (args.remove === true) {
          // F3: no removal without a healthy ledger (schema + >=1 run row).
          const health = await probeLedgerHealth(ledger)
          if (!health.healthy) {
            await recordSweepBlocked(ledger, 'patrol', health.reason)
            return asContent(
              args.json === false
                ? `patrol: refused all removals (ledger unhealthy: ${health.reason})`
                : {
                    leaked,
                    released,
                    kept_live: keptLive,
                    removed: [],
                    dry_run: false,
                    blocked: 'ledger_unhealthy',
                    reason: health.reason,
                  },
            )
          }
          for (const entry of entries) {
            if (entry.liveness.live) continue
            try {
              removed.push(
                await removeLeakedWorktree($, repoRoot, ledger, entry, shellRules),
              )
            } catch (err) {
              // Denied removal: report it in place, never run it.
              if (isShellCommandDeniedError(err)) {
                removed.push({ ...shellDeniedRefusal(err.command, err.reason) })
                continue
              }
              throw err
            }
          }
        }

        const report = {
          leaked,
          released,
          kept_live: keptLive,
          removed,
          dry_run: args.remove !== true,
          details: entries.map((entry) => ({
            worktree_id: entry.worktree_id,
            path: entry.path,
            task_id: entry.task_id,
            live: entry.liveness.live,
            reason: entry.liveness.reason,
            lease_state: entry.liveness.leaseState,
            dirty: entry.dirty,
          })),
        }
        return asContent(args.json === false ? summarizePatrol(report) : report)
      },
    })

    editor.add({
      name: 'supervisor_sweep',
      description:
        'Classify supervisor worktrees and run directories as SWEEP (expired + inactive + past older_than_days) or KEEP, and GC aged run directories. Dry-run by default (apply=false). Only `run-*` directories that resolve to a ledger run row (or tombstone) are removable; anything else is REPORT-only. Never forces, always skips live worktrees.',
      input: {
        type: 'object',
        properties: {
          older_than_days: {
            type: 'number',
            default: 30,
            description: 'Age gate in days (default 30, minimum 1).',
          },
          olderThan: {
            type: 'number',
            description: 'Alias for older_than_days (days, default 30, minimum 1).',
          },
          json: {
            type: 'boolean',
            default: true,
            description: 'Machine-readable JSON output (false = text summary).',
          },
          apply: {
            type: 'boolean',
            default: false,
            description:
              'Perform the removals. Default false = dry-run listing only; no filesystem changes.',
          },
        },
        additionalProperties: false,
      },
      async execute(args: any) {
        const requested =
          typeof args.older_than_days === 'number'
            ? args.older_than_days
            : typeof args.olderThan === 'number'
              ? args.olderThan
              : 30
        // F3 floor: zero/negative age gates are rejected, not silently applied.
        if (!(requested >= 1)) {
          return asContent({
            error: 'older_than_days must be >= 1',
            older_than_days: requested,
          })
        }
        const olderThanDays = requested
        const apply = args.apply === true
        const nowMs = Date.now()

        // --- Worktrees ---
        let worktreeCandidates: Array<Record<string, any>>
        try {
          worktreeCandidates = await inspectSupervisorWorktrees(
            $,
            repoRoot,
            ledger,
            nowMs,
            HEARTBEAT_FRESH_MS,
            shellRules,
          )
        } catch (err) {
          if (isShellCommandDeniedError(err)) {
            return asContent(shellDeniedRefusal(err.command, err.reason))
          }
          throw err
        }
        const worktrees = worktreeCandidates.map((entry) =>
          classifyWorktreeSweep(
            {
              worktree_id: entry.worktree_id,
              path: entry.path,
              task_id: entry.task_id,
              mtime_ms: entry.mtime_ms,
              live: entry.liveness.live,
              live_reason: entry.liveness.reason,
              has_active_attempt: entry.liveness.hasActiveAttempt,
              lease_state: entry.liveness.leaseState,
              dirty: entry.dirty,
            },
            olderThanDays,
            nowMs,
          ),
        )

        // --- Runs GC (F3 attribution) ---
        const health = await probeLedgerHealth(ledger)
        const allRuns = health.healthy ? await ledger.listRuns() : []
        const ledgerRunIds = new Set(allRuns.map((run: any) => run.id))
        const tombstoned = new Set(
          allRuns.filter((run: any) => run.state === 'cancelled').map((run: any) => run.id),
        )
        const activeRunIds = (await ledger.listActiveRuns()).map((run: any) => run.id)
        let runDirNames: string[] = []
        try {
          runDirNames = readdirSync(runsDir, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name)
        } catch {
          runDirNames = []
        }

        const reported: Array<Record<string, unknown>> = []
        const runs: Array<Record<string, any>> = []
        for (const name of runDirNames) {
          const path = `${runsDir}/${name}`
          const attribution = classifyRunDirAttribution(name, ledgerRunIds, tombstoned)
          if (!attribution.attributable) {
            // Unknown/unattributable directory: REPORT-only, never removed.
            reported.push({ run_id: name, path, reason: attribution.reason })
            continue
          }
          let mtimeMs = 0
          let state: string | null = null
          try {
            mtimeMs = statSync(path).mtimeMs
          } catch {
            mtimeMs = 0
          }
          try {
            const run = await ledger.getRun(name)
            state = run?.state ?? null
          } catch {
            state = null
          }
          runs.push(
            classifyRunSweep(
              {
                run_id: name,
                path,
                mtime_ms: mtimeMs,
                state,
                active: activeRunIds.includes(name),
                has_verification: existsSync(`${path}/artifacts/verification`),
                has_receipt: existsSync(`${path}/receipt.md`),
              },
              olderThanDays,
              nowMs,
            ),
          )
        }

        const worktreeKeep = worktrees.filter((e) => e.classification === 'KEEP')
        const worktreeSweep = worktrees.filter((e) => e.prune)
        const runKeep = runs.filter((e) => e.classification === 'KEEP')
        const runSweep = runs.filter((e) => e.prune)

        const removed: Array<Record<string, unknown>> = []
        let blocked: string | null = null
        if (apply) {
          if (!health.healthy) {
            // F3: an unhealthy ledger permits NO removals at all.
            blocked = 'ledger_unhealthy'
            await recordSweepBlocked(ledger, 'sweep', health.reason)
          } else {
            for (const entry of worktreeSweep) {
              const candidate = worktreeCandidates.find(
                (c) => c.worktree_id === entry.worktree_id,
              )
              if (candidate) {
                try {
                  removed.push(
                    await removeLeakedWorktree(
                      $,
                      repoRoot,
                      ledger,
                      candidate,
                      shellRules,
                    ),
                  )
                } catch (err) {
                  // Denied removal: report it in place, never run it.
                  if (isShellCommandDeniedError(err)) {
                    removed.push({ ...shellDeniedRefusal(err.command, err.reason) })
                    continue
                  }
                  throw err
                }
              }
            }
            for (const entry of runSweep) {
              // Defensive: never touch an active run, never escape runsDir, and
              // only attributable `run-*` dirs reach here.
              if (entry.active || !entry.path.startsWith(`${runsDir}/`)) {
                removed.push({
                  run_id: entry.run_id,
                  removed: false,
                  reason: 'protected',
                })
                continue
              }
              try {
                // recursive only — no force flag anywhere on the removal path.
                rmSync(entry.path, { recursive: true })
                removed.push({ run_id: entry.run_id, removed: true, reason: 'gc' })
              } catch (err) {
                removed.push({
                  run_id: entry.run_id,
                  removed: false,
                  reason: err instanceof Error ? err.message : String(err),
                })
              }
            }
          }
        }

        const report = {
          mode: apply ? 'apply' : 'dry-run',
          older_than_days: olderThanDays,
          ledger_healthy: health.healthy,
          worktrees: { keep: worktreeKeep, sweep: worktreeSweep },
          runs: { keep: runKeep, sweep: runSweep },
          reported_only: reported,
          prune_candidates: [
            ...worktreeSweep.map((e) => e.worktree_id),
            ...runSweep.map((e) => e.run_id),
          ],
          blocked,
          removed,
        }
        return asContent(args.json === false ? summarizeSweep(report) : report)
      },
    })
  }

/**
 * A blocked-command error carrying a machine-readable `code`, so a caller can
 * tell the trunk-based approval refusal (`push_requires_approval`) from the
 * generic dangerous-command denial. The message shape is unchanged.
 */
function blockedCommandError(command: string, code?: string): Error {
  const error = new Error(
    `Blocked dangerous command: ${command.slice(0, 80)}`,
  ) as Error & { code?: string }
  if (code) error.code = code
  return error
}

/**
 * True when the runtime hands a recorded human approval to this event. Gate
 * approvals are recorded in the ledger by the host; it may surface the push
 * approval either as `approval: true` or `approval: { approved: true }`. Absent
 * it, a trunk-based (`dev === main`) push is refused.
 */
function hasPushApproval(event: any): boolean {
  const approval = event?.approval
  if (approval === true) return true
  return (
    typeof approval === 'object' &&
    approval !== null &&
    approval.approved === true
  )
}

/**
 * The `execute.before` guard: secret-file reads and dangerous shell commands are
 * refused before the tool runs. The only permitted push is a non-force
 * `git push ... origin <dev branch>` (the human-approved flow); every other
 * push is blocked. A trunk-based repo (`dev === main`) needs an explicit
 * approval, otherwise the push is refused with `push_requires_approval`.
 */
export function supervisorExecuteBeforeGuard(
  event: any,
  branches: { dev?: string; main?: string } = DEFAULT_BRANCHES,
): void {
  const input = event?.input ?? {}
  if (event?.tool === 'read' && (input.filePath ?? input.path)) {
    const path = String(input.filePath ?? input.path)
    if (path.includes('.env') || path.endsWith('.key') || path.includes('/.secrets/')) {
      throw new Error('Cannot read .env files, key files, or secrets')
    }
  }
  const toolName = event?.tool ?? ''
  const command = String(input.command ?? input.cmd ?? '')
  if ((toolName === 'bash' || toolName === 'shell') && command) {
    const devBranch = branches.dev ?? DEFAULT_BRANCHES.dev
    const mainBranch = branches.main ?? DEFAULT_BRANCHES.main
    // Git flow: the ONLY permitted push is a non-force `git push ... origin
    // <dev>` (the human-approved dev -> main PR flow). `main` is denied by
    // name; on a trunk-based repo the same branch needs a recorded approval.
    // `isPushAllowed` owns the rule so the guard and its tests cannot drift.
    const push = isPushAllowed(
      command,
      { dev: devBranch, main: mainBranch },
      { approved: hasPushApproval(event) },
    )
    if (
      !push.allowed ||
      /\bgit\s+reset\s+--hard\b/.test(command) ||
      /\bgit\s+clean\b/.test(command) ||
      /\bsudo\b/.test(command) ||
      /\brm\s+-rf\s+\//.test(command) ||
      /\brm\s+-rf\b/.test(command) ||
      /\bchmod\b/.test(command) ||
      /\bchown\b/.test(command)
    ) {
      throw blockedCommandError(command, push.allowed ? undefined : push.reason)
    }
  }
}

export interface SupervisorPluginInput extends SupervisorOptions {
  /** Server-side plugin options (unconfirmed shape, read opportunistically). */
  ctxOptions?: unknown
  env?: Record<string, string | undefined>
  cwd?: string
}

export interface SupervisorTool {
  description: string
  input: Record<string, unknown>
  execute(args: Record<string, any>): Promise<string>
}

export interface SupervisorPluginInstance {
  tool: Record<string, SupervisorTool>
  config: ResolvedSupervisorConfig
}

/**
 * Programmatic (non-runtime) plugin factory: builds the same tool set the
 * runtime registers, but keyed by name with JSON-string results so tests and
 * callers can drive it directly. Tool names stay FLAT here (namespacing is a
 * runtime registration concern — see `toolName`).
 */
export const SupervisorPlugin = async (
  input: SupervisorPluginInput = {},
): Promise<SupervisorPluginInstance> => {
  const config = resolveSupervisorConfig({
    options: input,
    ctxOptions: input.ctxOptions,
    env: input.env ?? process.env,
    cwd: input.cwd ?? process.cwd(),
  })

  const collected: CollectedTool[] = []
  registerSupervisorTools(
    { add: (definition: CollectedTool) => collected.push(definition) },
    config,
  )

  const tool: Record<string, SupervisorTool> = {}
  for (const definition of collected) {
    tool[definition.name] = {
      description: definition.description,
      input: definition.input,
      async execute(args: Record<string, any>): Promise<string> {
        const out = await definition.execute(args)
        if (typeof out === 'string') return out
        const content = (out as { content?: unknown } | null)?.content
        return typeof content === 'string' ? content : JSON.stringify(out ?? null)
      },
    }
  }

  return { tool, config }
}

/**
 * Runtime plugin (auto-discovered from `.opencode/plugins/`).
 *
 * Kept as a plain `{ id, setup }` object factory on purpose: the installed
 * `@opencode-ai/plugin@1.18.15` root export has no `define()` helper, and the
 * V2 `define()` lives on the `./v2/promise` subpath whose `PluginContext`
 * exposes no `ctx.tool`/`ctx.location`. Inventing that API here would change the
 * runtime contract, so the shape stays as the runtime already delivers it.
 */
const supervisorPlugin = {
  id: 'supervisor',
  async setup(ctx: any) {
    const config = resolveSupervisorConfig({
      ctxOptions: readCtxOptions(ctx),
      locationDirectory: readCtxLocationDirectory(ctx),
      env: process.env,
      cwd: process.cwd(),
    })

    let projection: ViewProjectionStore | null = null
    try {
      const storage = ctx?.storage
      if (isProjectionStorage(storage)) projection = createStorageProjection(storage)
    } catch {
      // ctx.storage is unconfirmed across runtimes: never fail setup over it.
      projection = null
    }

    const runtime: ResolvedSupervisorConfig = { ...config, projection }

    // Policy authority snapshot: captured ONCE for the whole session. The
    // ledger read uses the resolved path (custom ledgerPath included).
    const policySnapshot = createPolicySnapshot(
      config.ledgerKey,
      config.ledgerPath,
    )
    const hookLedger = getLedger(config)

    await ctx.tool.transform((editor: ToolRegistrar) => {
      registerSupervisorTools(
        {
          add: (definition) =>
            editor.add({
              name: toolName(definition.name, config.namespace),
              description: definition.description,
              input: definition.input,
              execute: definition.execute,
            }),
        },
        runtime,
      )
    })

    await ctx.tool.hook('execute.before', (event: any) => {
      // Policy gate first (snapshot tamper check + shell/MCP scope), then the
      // legacy secrets/dangerous-command guard. The policy snapshot is taken
      // ONCE here at plugin load (never re-read per event).
      supervisorPolicyGuard(event, { snapshot: policySnapshot, ledger: hookLedger })
      supervisorExecuteBeforeGuard(event, config.branches)
    })
  },
}

export default supervisorPlugin
