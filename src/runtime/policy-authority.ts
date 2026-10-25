// Policy authority — the permission inputs the conductor owns.
//
// Once the plugin is mounted globally it executes inside folders the user has
// merely opened, including freshly cloned repositories. Reading the policy from
// the checkout made this a confused deputy: a repository supplied the shell
// rules and the profile bundles that governed the agent acting on it, and a
// project with no resolvable profile produced an "unscoped" snapshot, which is
// to say no gate at all.
//
// This module moves the authority out of the project:
//
//   authority = canonical package floor (CANONICAL_SHELL_RULES)
//             ∪ bundled profile `<packageRoot>/profiles/<key>.json`
//             ∪ user overrides `<config dir>/conductor.json#policy`
//   project   = input allowed to TIGHTEN the authority, never to widen it
//
// Invariants:
//   - `resolvePolicyAuthority` always returns a usable rule set. There is no
//     "unscoped" result: every failure (no/unknown/unreadable/malformed
//     profile, unusable user config, no package root) returns `restricted:
//     true`, an empty server list and the strictest shell rule set, which
//     denies `*` outright.
//   - Project input can only add `deny`/`ask` rules for resources the authority
//     does not mention, can only strengthen an existing effect, and can only
//     disable MCP servers. A project `allow` is ignored outright, so it can
//     never turn a deny/ask into allow. Every applied tightening is counted.
//   - The hash covers package/user authority inputs only. A project file is
//     never part of it, so editing a checkout can neither trip nor silence the
//     tamper check, and editing a bundled profile always trips it.
//   - `ledgerPath`, `repoRoot`, `stateRoot`, the profile selection and every
//     other filesystem path are never read from project config. The project
//     contributes exactly two kinds of value: `permission.bash` effects and MCP
//     server disables.
//   - Nothing here throws and nothing here writes.
//
// Import note: consumers import this module extensionless
// (`./runtime/policy-authority`) because the package's `tsc --noEmit` baseline
// rejects `.ts`-suffixed imports (TS5097). Bun resolves it at runtime.
import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CANONICAL_SHELL_RULES,
  mostRestrictiveEffect,
  normalizePolicyEffect,
  resolveMcpAllowedServers,
  type PermissionRule,
} from '../policy'
import { trustConfigPath } from './trust'

/** Profile used when neither the caller nor the user selects one. */
export const DEFAULT_POLICY_PROFILE = 'assisted'

/** Directory below `packageRoot` that ships the bundled profiles. */
export const BUNDLED_PROFILE_DIR = 'profiles'

/**
 * Fail-closed shell rule: with `effect: 'deny'` on `*`, no command is allowed
 * unless a *more specific* rule matches it — and every more specific rule in
 * the strict set is deny/ask, and a restricted gate denies `ask`. So the whole
 * strict set denies every command.
 */
export const STRICT_SHELL_DENY: PermissionRule = {
  action: 'shell',
  resource: '*',
  effect: 'deny',
}

/** Why a snapshot is restricted to the strict rule set. */
export type PolicyAuthorityFailureCode =
  | 'no_profile'
  | 'unknown_profile'
  | 'unreadable_profile'
  | 'malformed_profile'
  | 'malformed_user_config'
  | 'hash_mismatch'

export interface PolicyAuthorityInput {
  /** The checkout being acted on. Consulted ONLY for tighten-only input. */
  projectRoot: string
  /**
   * Environment used to locate the user config. Defaults to `process.env`; when
   * supplied it is the complete environment (no implicit `process.env`
   * fallback), so tests never reach the real home directory.
   */
  env?: Record<string, string | undefined>
  /** Explicit user config path (`conductor.json`); overrides env discovery. */
  configPath?: string
  /** Explicit profile key. An unresolvable explicit key fails closed. */
  profileKey?: string
  /**
   * Package root holding `profiles/`; defaults to the package directory that
   * contains this module (via `import.meta.url`), never `process.cwd()`.
   */
  packageRoot?: string
}

export interface PolicyAuthoritySnapshot {
  /** Bundled profile the authority resolved to (requested key on failure). */
  profileKey: string
  /** True when only the strictest rule set may be used (fail closed). */
  restricted: boolean
  /** SHA-256 over package/user authority inputs. Project input excluded. */
  hash: string
  /** Package/user files whose contents contributed (never project files). */
  sources: string[]
  /** Effective shell rules: authority merged with project tightenings. */
  shellRules: PermissionRule[]
  /** Effective MCP servers: authority scope minus project disables. */
  allowedServers: string[]
  /** How many project tightenings were applied (counted once per change). */
  tightened: { shellRules: number; servers: number }
  /** Present exactly when `restricted` is true. */
  failure?: { code: string; detail: string }
}

export interface PolicyAuthorityDeps {
  /**
   * Observation seam for audits and tests: called with every path whose bytes
   * were actually read. It cannot change the result (no return value), so a
   * consumer cannot widen a rule set through it. Missing files never fire it,
   * which makes "did the project contribute anything?" directly observable.
   */
  onRead?: (path: string) => void
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve the effective policy authority for `input.projectRoot`.
 *
 * Never throws, never returns an ungated ("unscoped") result, and never takes a
 * rule from the project except a strictly tighter one.
 */
export function resolvePolicyAuthority(
  input: PolicyAuthorityInput,
  deps: PolicyAuthorityDeps = {},
): PolicyAuthoritySnapshot {
  const env = input.env ?? process.env
  const projectRoot = canonicalPath(input.projectRoot)
  const packageRoot = resolvePackageRoot(input.packageRoot)
  const userConfigPath = input.configPath ?? trustConfigPath(env)

  const userRead = readUserPolicy(userConfigPath, deps)
  // A malformed user config invalidates the selection itself, so it outranks a
  // profile failure in the reported code.
  const selection = userRead.failure
    ? { key: DEFAULT_POLICY_PROFILE, failure: null }
    : selectProfileKey(input.profileKey, userRead.policy)
  const selected = selection.key
  const profileRead = selection.failure
    ? { profile: null, path: null, failure: null }
    : readBundledProfile(packageRoot, selected, deps)
  const failure = userRead.failure ?? selection.failure ?? profileRead.failure

  const sources = [
    ...(profileRead.path ? [profileRead.path] : []),
    ...(userRead.source ? [userRead.source] : []),
  ]

  if (failure) {
    // Fail closed WITHOUT consulting the project: the strict set already denies
    // everything, and not reading the checkout keeps a hostile file from even
    // reaching the parse path.
    const snapshot: PolicyAuthoritySnapshot = {
      profileKey: selected,
      restricted: true,
      hash: authorityHash({
        profileKey: selected,
        profile: null,
        userPolicy: userRead.policy,
        failureCode: failure.code,
      }),
      sources,
      shellRules: restrictedShellRules(),
      allowedServers: [],
      tightened: { shellRules: 0, servers: 0 },
      failure: { code: failure.code, detail: failure.detail },
    }
    authorityRecords.set(snapshot, {
      packageRoot,
      profileKey: selected,
      userConfigPath,
      failureCode: failure.code,
      hash: snapshot.hash,
      deps,
    })
    return snapshot
  }

  const profile = profileRead.profile as Record<string, unknown>
  const authorityRules = mergeAuthorityShellRules(profile, userRead.policy)
  const authorityServers = authorityMcpServers(profile, userRead.policy)
  const projectInput = readProjectInput(projectRoot, deps)
  const tightenedShell = applyProjectShellRules(authorityRules, projectInput.shell)
  const tightenedServers = authorityServers.filter(
    (server) => !projectInput.disabledServers.has(server),
  )

  const snapshot: PolicyAuthoritySnapshot = {
    profileKey: selected,
    restricted: false,
    hash: authorityHash({
      profileKey: selected,
      profile,
      userPolicy: userRead.policy,
      failureCode: null,
    }),
    sources,
    shellRules: tightenedShell.rules,
    allowedServers: tightenedServers,
    tightened: {
      shellRules: tightenedShell.applied,
      servers: authorityServers.length - tightenedServers.length,
    },
  }
  authorityRecords.set(snapshot, {
    packageRoot,
    profileKey: selected,
    userConfigPath,
    failureCode: null,
    hash: snapshot.hash,
    deps,
  })
  return snapshot
}

/**
 * Re-hash the package/user inputs recorded when `snapshot` was resolved.
 *
 * Project files are never opened here and are not part of the hash, so a
 * checkout can change freely; a bundled profile or the user policy changing
 * returns `false` and the caller must fail closed. A snapshot that did not come
 * from `resolvePolicyAuthority` (for example one rebuilt from JSON) is not
 * intact: its inputs are unknown, so it cannot be vouched for.
 */
export function isAuthorityIntact(snapshot: PolicyAuthoritySnapshot): boolean {
  const record = authorityRecords.get(snapshot)
  if (!record) return false
  const profile = readBundledProfile(record.packageRoot, record.profileKey, record.deps)
  const user = readUserPolicy(record.userConfigPath, record.deps)
  const current = authorityHash({
    profileKey: record.profileKey,
    // A failure snapshot hashed `profile: null` by construction; reproduce the
    // same shape so an unchanged failure is still an intact authority.
    profile: record.failureCode ? null : profile.profile,
    userPolicy: user.policy,
    failureCode: record.failureCode,
  })
  return current === record.hash && current === snapshot.hash
}

/** The strict rule set used whenever the authority cannot be trusted. */
export function restrictedShellRules(): PermissionRule[] {
  return [
    ...CANONICAL_SHELL_RULES.map((rule) => ({ ...rule })),
    { ...STRICT_SHELL_DENY },
  ]
}

/** Failure recorded when a snapshot's authority no longer matches its hash. */
export const AUTHORITY_TAMPER_FAILURE = {
  code: 'hash_mismatch',
  detail: 'package/user policy authority changed after the snapshot was taken',
} as const

/**
 * The strict replacement for a snapshot whose authority is no longer intact.
 *
 * This is the value a gate swaps in when `isAuthorityIntact` returns false: it
 * keeps the profile key and sources for the audit trail but carries the
 * fail-closed rule set, an empty server list and no tightenings.
 *
 * The replacement is deliberately NOT registered as a resolved snapshot, so
 * `isAuthorityIntact(replacement)` is `false`. That is the honest answer — the
 * authority it would be checked against is exactly what broke — and it is safe
 * because the replacement is already the most restrictive state.
 */
export function restrictedAuthoritySnapshot(
  previous: PolicyAuthoritySnapshot,
  failure: { code: string; detail: string } = AUTHORITY_TAMPER_FAILURE,
): PolicyAuthoritySnapshot {
  const profileKey = nonEmpty(previous?.profileKey) ?? DEFAULT_POLICY_PROFILE
  return {
    profileKey,
    restricted: true,
    hash: authorityHash({
      profileKey,
      profile: null,
      userPolicy: null,
      failureCode: failure.code,
    }),
    sources: Array.isArray(previous?.sources) ? [...previous.sources] : [],
    shellRules: restrictedShellRules(),
    allowedServers: [],
    tightened: { shellRules: 0, servers: 0 },
    failure: { code: failure.code, detail: failure.detail },
  }
}

/**
 * Package root that ships `profiles/`. Derived from this module's own location
 * (`<packageRoot>/src/runtime/policy-authority.ts`), never from the working
 * directory: a checkout must not be able to point the loader at its own profile
 * directory.
 */
export function defaultPackageRoot(): string {
  try {
    return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
  } catch {
    // No filesystem anchor (an in-memory bundle): callers must inject
    // `packageRoot`; an unresolved root can only fail closed.
    return ''
  }
}

// ---------------------------------------------------------------------------
// Authority reading
// ---------------------------------------------------------------------------

interface AuthorityFailure {
  code: PolicyAuthorityFailureCode
  detail: string
}

interface UserPolicyRead {
  policy: Record<string, unknown> | null
  source: string | null
  failure: AuthorityFailure | null
}

interface ProfileRead {
  profile: Record<string, unknown> | null
  path: string | null
  failure: AuthorityFailure | null
}

interface AuthorityRecord {
  packageRoot: string
  profileKey: string
  userConfigPath: string | null
  /** Failure the snapshot was built with; the recheck reuses it verbatim. */
  failureCode: PolicyAuthorityFailureCode | null
  hash: string
  deps: PolicyAuthorityDeps
}

/**
 * Snapshot -> the inputs needed to re-hash it. A WeakMap keeps the public
 * snapshot shape exactly as documented while still making `isAuthorityIntact`
 * self-contained: nothing in the snapshot can be edited to widen the authority.
 */
const authorityRecords = new WeakMap<PolicyAuthoritySnapshot, AuthorityRecord>()

/**
 * Profile resolution order: the caller's explicit `profileKey`, then the
 * user-owned `<config dir>/conductor.json#policy.profile`, then `assisted`.
 */
function selectProfileKey(
  explicit: unknown,
  userPolicy: Record<string, unknown> | null,
): { key: string; failure: AuthorityFailure | null } {
  const direct = nonEmpty(explicit)
  if (direct) return { key: direct, failure: null }

  const fromUser = userPolicy?.profile
  if (fromUser === undefined) {
    return { key: DEFAULT_POLICY_PROFILE, failure: null }
  }
  const key = nonEmpty(fromUser)
  if (key) return { key, failure: null }
  // `policy.profile` is a selection: a non-string or empty value is malformed,
  // not "use the default" — silently ignoring it could drop an intended
  // restriction.
  return {
    key: DEFAULT_POLICY_PROFILE,
    failure: {
      code: 'malformed_user_config',
      detail: `"policy.profile" must be a non-empty string (got ${typeof fromUser})`,
    },
  }
}

function resolvePackageRoot(value?: string): string {
  const explicit = nonEmpty(value)
  return explicit ? resolve(explicit) : defaultPackageRoot()
}

function readBundledProfile(
  packageRoot: string,
  profileKey: string,
  deps: PolicyAuthorityDeps,
): ProfileRead {
  if (!packageRoot) {
    return {
      profile: null,
      path: null,
      failure: {
        code: 'no_profile',
        detail: 'no package root: cannot locate the bundled policy profiles',
      },
    }
  }
  if (!isSafeProfileKey(profileKey)) {
    return {
      profile: null,
      path: null,
      failure: {
        code: 'unknown_profile',
        detail: `profile key "${clip(profileKey, 80)}" is not a valid bundled profile name`,
      },
    }
  }

  const path = join(packageRoot, BUNDLED_PROFILE_DIR, `${profileKey}.json`)
  const read = readJsonObject(path, deps)
  if (read.kind === 'missing') {
    return {
      profile: null,
      path: null,
      failure: { code: 'unknown_profile', detail: `no bundled profile at ${path}` },
    }
  }
  if (read.kind === 'error') {
    return {
      profile: null,
      path: null,
      failure: {
        code: 'unreadable_profile',
        detail: `cannot read ${path} (${read.detail})`,
      },
    }
  }
  if (read.kind === 'malformed') {
    return {
      profile: null,
      path: null,
      failure: {
        code: 'malformed_profile',
        detail: `${path} is not a usable profile (${read.detail})`,
      },
    }
  }
  return { profile: read.value, path, failure: null }
}

/**
 * Read `<config dir>/conductor.json#policy` — the user-owned override layer.
 *
 * Only the `policy` section is interpreted; `trust` and every unrelated key stay
 * owned by their own modules. A missing file is not an error; an unreadable or
 * malformed one fails closed, because it may be hiding a tightening the operator
 * expects to be in force.
 */
function readUserPolicy(
  configPath: string | null,
  deps: PolicyAuthorityDeps,
): UserPolicyRead {
  if (!configPath) return { policy: null, source: null, failure: null }

  const read = readJsonObject(configPath, deps)
  if (read.kind === 'missing') return { policy: null, source: null, failure: null }
  if (read.kind === 'error') {
    return {
      policy: null,
      source: null,
      failure: {
        code: 'malformed_user_config',
        detail: `cannot read ${configPath} (${read.detail})`,
      },
    }
  }
  if (read.kind === 'malformed') {
    return {
      policy: null,
      source: null,
      failure: {
        code: 'malformed_user_config',
        detail: `${configPath} is not usable (${read.detail})`,
      },
    }
  }

  const policy = read.value.policy
  if (policy === undefined) return { policy: null, source: configPath, failure: null }
  if (!isPlainObject(policy)) {
    return {
      policy: null,
      source: configPath,
      failure: {
        code: 'malformed_user_config',
        detail: `"policy" in ${configPath} must be an object`,
      },
    }
  }
  return { policy, source: configPath, failure: null }
}

// ---------------------------------------------------------------------------
// Authority rule sets
// ---------------------------------------------------------------------------

/**
 * Effective authority shell rules: the canonical package floor, then the
 * bundled profile, then user overrides — intersected with the most restrictive
 * effect per identical resource, so no later layer can soften an earlier one.
 *
 * The canonical floor is always included: the documented deny list is the
 * package's non-negotiable baseline, and a profile may only add to it.
 */
function mergeAuthorityShellRules(
  profile: Record<string, unknown>,
  userPolicy: Record<string, unknown> | null,
): PermissionRule[] {
  const rules: PermissionRule[] = []

  const add = (resource: unknown, effect: unknown) => {
    if (typeof resource !== 'string' || resource === '') return
    const normalized = normalizePolicyEffect(effect) ?? 'deny'
    const index = rules.findIndex((rule) => rule.resource === resource)
    if (index === -1) {
      rules.push({ action: 'shell', resource, effect: normalized })
      return
    }
    rules[index] = {
      ...rules[index],
      effect: mostRestrictiveEffect(rules[index].effect, normalized),
    }
  }

  for (const rule of CANONICAL_SHELL_RULES) add(rule.resource, rule.effect)

  const permissions = Array.isArray(profile.permissions) ? profile.permissions : []
  for (const entry of permissions) {
    if (!isPlainObject(entry)) continue
    if (entry.action !== 'shell') continue
    add(entry.resource, entry.effect)
  }

  for (const entry of userShellEntries(userPolicy)) add(entry.resource, entry.effect)

  return rules
}

/** Shell rules the user config declares (`policy.shellRules` / `policy.bash`). */
function userShellEntries(
  userPolicy: Record<string, unknown> | null,
): Array<{ resource: string; effect: unknown }> {
  if (!userPolicy) return []
  const entries: Array<{ resource: string; effect: unknown }> = []
  const collect = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (!isPlainObject(entry)) continue
        if (typeof entry.resource !== 'string') continue
        entries.push({ resource: entry.resource, effect: entry.effect })
      }
      return
    }
    if (!isPlainObject(value)) return
    for (const [resource, effect] of Object.entries(value)) {
      entries.push({ resource, effect })
    }
  }
  collect(userPolicy.shellRules)
  collect(userPolicy.bash)
  return entries
}

/**
 * Authority MCP servers: the profile's bundles, narrowed (never widened) by the
 * user's `policy.allowedServers` allowlist and `policy.disableServers` list.
 */
function authorityMcpServers(
  profile: Record<string, unknown>,
  userPolicy: Record<string, unknown> | null,
): string[] {
  const bundles = Array.isArray(profile.mcp_profiles)
    ? profile.mcp_profiles.filter((value): value is string => typeof value === 'string')
    : []
  let servers = resolveMcpAllowedServers(bundles)
  if (!userPolicy) return servers

  const allowed = stringArray(userPolicy.allowedServers)
  if (allowed) servers = servers.filter((server) => allowed.includes(server))
  const disabled = stringArray(userPolicy.disableServers)
  if (disabled) servers = servers.filter((server) => !disabled.includes(server))
  return servers
}

// ---------------------------------------------------------------------------
// Project input (tighten-only)
// ---------------------------------------------------------------------------

interface ProjectInput {
  shell: Array<{ resource: string; effect: unknown }>
  disabledServers: Set<string>
}

/**
 * Read the two documented project config locations. Anything unreadable or
 * malformed is ignored: ignoring a project rule can only leave the authority
 * untouched, never widen it.
 *
 * Only `permission.bash` (effects) and `mcp.servers` (disables) are consumed.
 * `ledgerPath`, `repoRoot`, `stateRoot`, profile selection and every other path
 * key are NOT read from here — a checkout cannot nominate its own authority.
 */
function readProjectInput(
  projectRoot: string,
  deps: PolicyAuthorityDeps,
): ProjectInput {
  const shell: Array<{ resource: string; effect: unknown }> = []
  const disabledServers = new Set<string>()

  for (const path of [
    join(projectRoot, 'opencode.json'),
    join(projectRoot, '.opencode', 'opencode.json'),
  ]) {
    const read = readJsonObject(path, deps)
    if (read.kind !== 'ok') continue

    const permission = read.value.permission
    if (isPlainObject(permission) && isPlainObject(permission.bash)) {
      for (const [resource, effect] of Object.entries(permission.bash)) {
        if (typeof effect !== 'string') continue
        shell.push({ resource, effect })
      }
    }

    const mcp = read.value.mcp
    if (isPlainObject(mcp) && isPlainObject(mcp.servers)) {
      for (const [name, config] of Object.entries(mcp.servers)) {
        // The documented OpenCode shape is `{ enabled: false }`; accept the
        // obvious aliases too. Anything else (including `true`) is not a
        // disable and is ignored — enabling is never honoured.
        if (config === false) {
          disabledServers.add(name)
          continue
        }
        if (!isPlainObject(config)) continue
        if (config.enabled === false || config.disabled === true) {
          disabledServers.add(name)
        }
      }
    }
  }

  return { shell, disabledServers }
}

/**
 * Intersect project shell rules into the authority rules.
 *
 * Per identical resource the effective effect is the most restrictive of
 * `deny > ask > allow`. A project `allow` is skipped outright: it could only
 * widen. A project `ask` that can match anything an authority `deny` matches is
 * skipped too, because `evaluateShellCommand` resolves overlapping patterns by
 * longest literal — a narrower project `ask` would otherwise beat a broader
 * authority `deny`. Skipping leaves the authority's denial in place; the project
 * simply does not get its prompt. Every change to the effective set is counted.
 */
function applyProjectShellRules(
  authorityRules: PermissionRule[],
  projectEntries: Array<{ resource: string; effect: unknown }>,
): { rules: PermissionRule[]; applied: number } {
  const rules = authorityRules.map((rule) => ({ ...rule }))
  const authorityDenies = rules
    .filter((rule) => rule.action === 'shell' && rule.effect === 'deny')
    .map((rule) => rule.resource)
  let applied = 0

  for (const entry of projectEntries) {
    const effect = normalizePolicyEffect(entry.effect)
    // An unrecognised effect cannot be shown to tighten, so it is ignored.
    if (!effect || effect === 'allow') continue
    if (
      effect === 'ask' &&
      authorityDenies.some((deny) => patternsCanIntersect(deny, entry.resource))
    ) {
      continue
    }

    const index = rules.findIndex((rule) => rule.resource === entry.resource)
    if (index === -1) {
      rules.push({ action: 'shell', resource: entry.resource, effect })
      applied += 1
      continue
    }
    const current = normalizePolicyEffect(rules[index].effect) ?? 'deny'
    const merged = mostRestrictiveEffect(current, effect)
    if (merged === current) continue
    rules[index] = { ...rules[index], effect: merged }
    applied += 1
  }

  return { rules, applied }
}

/**
 * True when some string matches both glob patterns (`*`/`**` match any run of
 * characters, mirroring `policy.matchResource`). Used only to stop a narrower
 * project `ask` from shadowing a broader authority `deny`.
 */
function patternsCanIntersect(a: string, b: string): boolean {
  const memo = new Map<string, boolean>()
  const visit = (i: number, j: number): boolean => {
    const key = `${i}:${j}`
    const cached = memo.get(key)
    if (cached !== undefined) return cached

    let result: boolean
    if (i === a.length && j === b.length) {
      result = true
    } else if (i === a.length) {
      result = onlyWildcards(b.slice(j))
    } else if (j === b.length) {
      result = onlyWildcards(a.slice(i))
    } else if (a[i] === '*') {
      result = visit(i + 1, j) || visit(i, j + 1)
    } else if (b[j] === '*') {
      result = visit(i, j + 1) || visit(i + 1, j)
    } else {
      result = a[i] === b[j] && visit(i + 1, j + 1)
    }

    memo.set(key, result)
    return result
  }
  return visit(0, 0)
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

/**
 * Digest over the authority inputs only. `failureCode` is passed explicitly so
 * a recheck reproduces the exact shape a failure snapshot was built with.
 */
function authorityHash(args: {
  profileKey: string
  profile: unknown
  userPolicy: unknown
  failureCode: string | null
}): string {
  return createHash('sha256').update(stableStringify(args)).digest('hex')
}

/** JSON with object keys sorted, so a reordered rewrite is not a change. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null'
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
  return `{${entries
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(',')}}`
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

type JsonRead =
  | { kind: 'ok'; value: Record<string, unknown> }
  | { kind: 'missing' }
  | { kind: 'error'; detail: string }
  | { kind: 'malformed'; detail: string }

function readJsonObject(path: string, deps: PolicyAuthorityDeps): JsonRead {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    const code = errorCode(error)
    if (code === 'ENOENT' || code === 'ENOTDIR') return { kind: 'missing' }
    return { kind: 'error', detail: describeError(error) }
  }

  // The bytes are in hand: this is the only place a path becomes a "read".
  deps.onRead?.(path)

  const stripped = text.replace(/^\uFEFF/, '').trim()
  if (stripped.length === 0) {
    return { kind: 'malformed', detail: 'file is empty' }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(stripped) as unknown
  } catch {
    return { kind: 'malformed', detail: 'not valid JSON' }
  }
  if (!isPlainObject(parsed)) {
    return { kind: 'malformed', detail: 'must contain a JSON object' }
  }
  return { kind: 'ok', value: parsed }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A profile key is a bundled file basename, never a path. */
function isSafeProfileKey(value: string): boolean {
  if (value.length === 0 || value.length > 64) return false
  if (value.includes('..') || value.includes('/') || value.includes('\\')) {
    return false
  }
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  return value.filter((entry): entry is string => typeof entry === 'string')
}

function onlyWildcards(value: string): boolean {
  return [...value].every((char) => char === '*')
}

function nonEmpty(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/** `realpath` when the path exists; a lexical resolve otherwise. Never throws. */
function canonicalPath(value: string): string {
  try {
    return realpathSync(value)
  } catch {
    return resolve(value)
  }
}

function errorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code: unknown }).code
    if (typeof code === 'string') return code
  }
  return undefined
}

function describeError(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error)
  return clip(detail.replace(/\s+/g, ' ').trim(), 160) || 'unknown error'
}

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value
}
