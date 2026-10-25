// Trust — the gate that lets the plugin run globally without trusting every
// folder the user opens.
//
// Once the plugin is global it executes in freshly cloned repositories. A
// supervisor started inside such a checkout used to read its own shell policy
// from that project, so a hostile repository supplied the rules that governed
// the agent acting on it. Trust moves the decision out of the project entirely:
// only a user-owned config file can grant a folder the right to be mutated, and
// every failure to read or understand that file resolves to "deny".
//
// Invariants:
//   - `resolveTrust` never throws and never reads anything under projectRoot.
//     A project file cannot influence trust in any way.
//   - Only an explicit grant for the canonical project path — or for an
//     ancestor when `allowSubdirectories` is on — can produce `trusted: true`.
//     `trust.default` is accepted for forward compatibility but never grants
//     anything by itself; opting in is always per path.
//   - Writes go through a temp file + rename with mode 0600 and preserve every
//     unrelated key in the config, so a malformed update cannot silently
//     discard the user's other conductor settings.
//
// Import note: consumers import this module extensionless (`./runtime/trust`)
// because the package's `tsc --noEmit` baseline rejects `.ts`-suffixed imports
// (TS5097). Bun resolves the extensionless specifier at runtime.
import { randomBytes } from 'node:crypto'
import {
  chmodSync,
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'

/** Why a project is (or is not) trusted. */
export type TrustCode =
  | 'trusted'
  | 'no_config'
  | 'malformed_config'
  | 'not_granted'
  | 'revoked'
  | 'io_error'

/** The exact remedy for every denial, quoted verbatim in `TrustDecision.hint`. */
export const TRUST_GRANT_HINT = 'Run: bunx opencode-conductor trust .'

/** File name under `$XDG_CONFIG_HOME/opencode` (or `~/.config/opencode`). */
export const TRUST_FILE_NAME = 'conductor.json'

/** Injectable environment (tests pass a literal, production passes process.env). */
export type TrustEnv = Record<string, string | undefined>

/** A grant as written on disk; unknown extra keys are preserved. */
export interface TrustGrantRecord {
  path: string
  grantedAt?: string
  note?: string
  revokedAt?: string
}

/** The `trust` section shape this module understands. */
export interface TrustConfigSection {
  default?: 'deny' | 'allow'
  allowSubdirectories?: boolean
  grants?: TrustGrantRecord[]
}

export interface TrustDecision {
  trusted: boolean
  code: TrustCode
  projectRoot: string
  matchedGrant?: string
  message: string
  hint: string
}

export interface ResolveTrustInput {
  projectRoot: string
  /**
   * Environment used to locate the config. Defaults to `process.env`; when
   * supplied it is the complete environment (no implicit process.env fallback)
   * so tests never reach the real home directory.
   */
  env?: TrustEnv
  /** Explicit config path; overrides env-based discovery. */
  configPath?: string
}

export interface GrantTrustOptions {
  env?: TrustEnv
  configPath?: string
  /** Optional human note stored next to the grant. */
  note?: string
  /** Recorded `grantedAt`; defaults to now. Injectable for deterministic tests. */
  now?: string
  /** Sets the config-wide subdirectory policy while granting. */
  allowSubdirectories?: boolean
}

export interface RevokeTrustOptions {
  env?: TrustEnv
  configPath?: string
  /** Recorded `revokedAt`; defaults to now. Injectable for deterministic tests. */
  now?: string
}

/** Typed refusal thrown by `assertTrusted`; carries the user-facing remedy. */
export class UntrustedProjectError extends Error {
  readonly code: TrustCode
  readonly hint: string
  readonly projectRoot: string

  constructor(decision: TrustDecision) {
    super(decision.message)
    this.name = 'UntrustedProjectError'
    this.code = decision.code
    this.hint = decision.hint
    this.projectRoot = decision.projectRoot
  }
}

/**
 * Config location: `$XDG_CONFIG_HOME/opencode/conductor.json`, else
 * `~/.config/opencode/conductor.json`. Returns `null` when neither variable is
 * set — the caller turns that into a fail-closed denial, never a throw.
 *
 * The config is user-owned and deliberately outside the project: there is no
 * project-local fallback, because a repository must never supply the rules
 * that govern the agent working inside it.
 */
export function trustConfigPath(env: TrustEnv = process.env): string | null {
  const xdg = env.XDG_CONFIG_HOME?.trim()
  if (xdg) return resolve(xdg, 'opencode', TRUST_FILE_NAME)
  const home = env.HOME?.trim()
  if (home) return resolve(home, '.config', 'opencode', TRUST_FILE_NAME)
  return null
}

/**
 * Decide whether the supervisor may mutate `projectRoot`.
 *
 * Fail-closed: a missing config, unreadable file, malformed JSON, missing
 * `trust` section or absent grant all deny. This function never throws.
 */
export function resolveTrust(input: ResolveTrustInput): TrustDecision {
  const environment = input.env ?? process.env
  const configPath = input.configPath ?? trustConfigPath(environment)
  const projectRoot = canonicalPath(input.projectRoot)

  if (!configPath) {
    return deniedDecision(
      projectRoot,
      'io_error',
      'cannot locate the trust config because neither XDG_CONFIG_HOME nor HOME is set',
    )
  }

  const loaded = loadConfig(configPath)
  if (loaded.kind === 'failure') {
    return deniedDecision(projectRoot, loaded.code, loaded.reason)
  }
  if (!isPlainObject(loaded.value)) {
    return deniedDecision(
      projectRoot,
      'malformed_config',
      `${configPath} must contain a JSON object`,
    )
  }

  const parsed = parseTrustSection(loaded.value, configPath)
  if (!parsed.ok) {
    return deniedDecision(projectRoot, 'malformed_config', parsed.reason)
  }

  let revokedMatch: ParsedGrant | undefined
  for (const grant of parsed.grants) {
    const grantPath = canonicalPath(grant.path)
    const matches =
      grantPath === projectRoot ||
      (parsed.allowSubdirectories && isInside(grantPath, projectRoot))
    if (!matches) continue
    if (grant.revoked) {
      revokedMatch ??= grant
      continue
    }
    return trustedDecision(projectRoot, grantPath, configPath)
  }

  if (revokedMatch) {
    const when = revokedMatch.revokedAt
      ? ` at ${revokedMatch.revokedAt}`
      : ''
    return deniedDecision(
      projectRoot,
      'revoked',
      `its grant was revoked${when}`,
    )
  }
  return notGrantedDecision(projectRoot)
}

/**
 * Grant trust to a canonical path, creating the config if needed.
 *
 * Atomic and idempotent: granting the same path twice leaves one entry (and
 * clears a prior revocation). Unrelated config keys are preserved.
 */
export function grantTrust(
  projectPath: string,
  opts: GrantTrustOptions = {},
): TrustDecision {
  const environment = opts.env ?? process.env
  const configPath = opts.configPath ?? trustConfigPath(environment)
  const projectRoot = canonicalPath(projectPath)

  if (!configPath) {
    return deniedDecision(
      projectRoot,
      'io_error',
      'cannot locate the trust config because neither XDG_CONFIG_HOME nor HOME is set',
    )
  }

  const loaded = loadConfig(configPath)
  if (loaded.kind === 'failure' && loaded.code !== 'no_config') {
    return deniedDecision(projectRoot, loaded.code, loaded.reason)
  }

  let config: Record<string, unknown> = {}
  if (loaded.kind === 'ok') {
    if (!isPlainObject(loaded.value)) {
      return deniedDecision(
        projectRoot,
        'malformed_config',
        `${configPath} must contain a JSON object`,
      )
    }
    config = loaded.value
  }

  const rawTrust = config.trust
  let trust: Record<string, unknown>
  if (rawTrust === undefined) {
    trust = {}
  } else if (isPlainObject(rawTrust)) {
    trust = rawTrust
  } else {
    return deniedDecision(
      projectRoot,
      'malformed_config',
      `"trust" in ${configPath} must be an object`,
    )
  }

  const rawGrants = trust.grants
  if (rawGrants !== undefined && !Array.isArray(rawGrants)) {
    return deniedDecision(
      projectRoot,
      'malformed_config',
      `"trust.grants" in ${configPath} must be an array`,
    )
  }
  const grants: unknown[] = Array.isArray(rawGrants) ? rawGrants : []

  const now = opts.now ?? new Date().toISOString()
  const existingIndex = grants.findIndex(
    (entry) =>
      isPlainObject(entry) &&
      typeof entry.path === 'string' &&
      isAbsolute(entry.path) &&
      canonicalPath(entry.path) === projectRoot,
  )

  if (existingIndex >= 0) {
    const existing = grants[existingIndex]
    if (isPlainObject(existing)) {
      const next: Record<string, unknown> = {
        ...existing,
        path: projectRoot,
        grantedAt: now,
      }
      delete next.revokedAt
      if (opts.note !== undefined) next.note = opts.note
      grants[existingIndex] = next
    }
  } else {
    const entry: Record<string, unknown> = {
      path: projectRoot,
      grantedAt: now,
    }
    if (opts.note !== undefined && opts.note !== '') entry.note = opts.note
    grants.push(entry)
  }

  if (trust.default === undefined) trust.default = 'deny'
  if (trust.allowSubdirectories === undefined) trust.allowSubdirectories = false
  if (opts.allowSubdirectories !== undefined) {
    trust.allowSubdirectories = opts.allowSubdirectories
  }
  trust.grants = grants
  config.trust = trust

  try {
    writeConfigAtomic(configPath, config)
  } catch (error) {
    return deniedDecision(
      projectRoot,
      'io_error',
      `cannot write ${configPath} (${describeError(error)})`,
    )
  }

  return resolveTrust({ projectRoot, env: environment, configPath })
}

/**
 * Revoke every grant that covers `projectPath` by stamping `revokedAt`.
 *
 * Revoked entries stay in the file as an audit trail but are ignored by
 * `resolveTrust`. Revoking twice is a no-op that keeps the original timestamp.
 */
export function revokeTrust(
  projectPath: string,
  opts: RevokeTrustOptions = {},
): TrustDecision {
  const environment = opts.env ?? process.env
  const configPath = opts.configPath ?? trustConfigPath(environment)
  const projectRoot = canonicalPath(projectPath)

  if (!configPath) {
    return deniedDecision(
      projectRoot,
      'io_error',
      'cannot locate the trust config because neither XDG_CONFIG_HOME nor HOME is set',
    )
  }

  const loaded = loadConfig(configPath)
  if (loaded.kind === 'failure') {
    return deniedDecision(projectRoot, loaded.code, loaded.reason)
  }
  if (!isPlainObject(loaded.value)) {
    return deniedDecision(
      projectRoot,
      'malformed_config',
      `${configPath} must contain a JSON object`,
    )
  }

  const config = loaded.value
  const parsed = parseTrustSection(config, configPath)
  if (!parsed.ok) {
    return deniedDecision(projectRoot, 'malformed_config', parsed.reason)
  }

  const grants = Array.isArray(parsed.trustValue.grants)
    ? parsed.trustValue.grants
    : []
  const now = opts.now ?? new Date().toISOString()
  let changed = false

  for (let index = 0; index < grants.length; index += 1) {
    const entry = grants[index]
    if (!isPlainObject(entry)) continue
    const entryPath = entry.path
    if (typeof entryPath !== 'string' || !isAbsolute(entryPath)) continue
    const grantPath = canonicalPath(entryPath)
    const matches =
      grantPath === projectRoot ||
      (parsed.allowSubdirectories && isInside(grantPath, projectRoot))
    if (!matches) continue
    if (Object.prototype.hasOwnProperty.call(entry, 'revokedAt')) continue
    grants[index] = { ...entry, path: entryPath, revokedAt: now }
    changed = true
  }

  if (changed) {
    try {
      writeConfigAtomic(configPath, config)
    } catch (error) {
      return deniedDecision(
        projectRoot,
        'io_error',
        `cannot write ${configPath} (${describeError(error)})`,
      )
    }
  }

  return resolveTrust({ projectRoot, env: environment, configPath })
}

/**
 * Throw `UntrustedProjectError` unless the decision allows mutation.
 *
 * Callers gate every mutating tool path on this instead of inspecting
 * `decision.code`, so a future code cannot accidentally be treated as allowed.
 */
export function assertTrusted(decision: TrustDecision): void {
  if (decision.trusted) return
  throw new UntrustedProjectError(decision)
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface ParsedGrant {
  path: string
  revoked: boolean
  revokedAt?: string
}

type ConfigLoad =
  | { kind: 'ok'; value: unknown }
  | {
      kind: 'failure'
      code: 'no_config' | 'malformed_config' | 'io_error'
      reason: string
    }

type TrustParse =
  | {
      ok: true
      trustValue: Record<string, unknown>
      allowSubdirectories: boolean
      grants: ParsedGrant[]
    }
  | { ok: false; reason: string }

/** `realpath` when the path exists; a lexical resolve otherwise. Never throws. */
function canonicalPath(value: string): string {
  try {
    return realpathSync(value)
  } catch {
    return resolve(value)
  }
}

/** True when `child` is strictly below `parent` (equal paths do not count). */
function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  if (rel === '' || isAbsolute(rel)) return false
  return rel !== '..' && !rel.startsWith(`..${sep}`)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function loadConfig(configPath: string): ConfigLoad {
  let text: string
  try {
    text = readFileSync(configPath, 'utf8')
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return {
        kind: 'failure',
        code: 'no_config',
        reason: `no trust config at ${configPath}`,
      }
    }
    return {
      kind: 'failure',
      code: 'io_error',
      reason: `cannot read ${configPath} (${describeError(error)})`,
    }
  }

  // Accept a UTF-8 BOM and whitespace-only files without pretending they are
  // valid: an empty file is a malformed config, not an absent one.
  const stripped = text.replace(/^\uFEFF/, '').trim()
  if (stripped.length === 0) {
    return {
      kind: 'failure',
      code: 'malformed_config',
      reason: `${configPath} is empty`,
    }
  }

  try {
    return { kind: 'ok', value: JSON.parse(stripped) as unknown }
  } catch {
    return {
      kind: 'failure',
      code: 'malformed_config',
      reason: `${configPath} is not valid JSON`,
    }
  }
}

function parseTrustSection(
  config: Record<string, unknown>,
  configPath: string,
): TrustParse {
  const rawTrust = config.trust
  if (rawTrust === undefined) {
    return { ok: false, reason: `${configPath} has no "trust" section` }
  }
  if (!isPlainObject(rawTrust)) {
    return { ok: false, reason: `"trust" in ${configPath} must be an object` }
  }

  const candidate = rawTrust.grants
  if (candidate !== undefined && !Array.isArray(candidate)) {
    return {
      ok: false,
      reason: `"trust.grants" in ${configPath} must be an array`,
    }
  }
  const entries: unknown[] = Array.isArray(candidate) ? candidate : []

  const grants: ParsedGrant[] = []
  for (const entry of entries) {
    // Be liberal about unknown or malformed entries: ignoring one can only
    // deny, never grant, so a hand-edited file still yields a safe decision.
    if (!isPlainObject(entry)) continue
    const entryPath = entry.path
    if (typeof entryPath !== 'string') continue
    const trimmed = entryPath.trim()
    if (trimmed === '' || !isAbsolute(trimmed)) continue
    grants.push({
      path: trimmed,
      revoked: Object.prototype.hasOwnProperty.call(entry, 'revokedAt'),
      revokedAt:
        typeof entry.revokedAt === 'string' ? entry.revokedAt : undefined,
    })
  }

  return {
    ok: true,
    trustValue: rawTrust,
    allowSubdirectories: rawTrust.allowSubdirectories === true,
    grants,
  }
}

/**
 * Atomic write: temp file in the same directory (created 0600), fsync, close,
 * rename over the destination. A crash leaves either the old file or the new
 * one, never a half-written config, and the rename carries mode 0600 with it.
 */
function writeConfigAtomic(
  configPath: string,
  config: Record<string, unknown>,
): void {
  mkdirSync(dirname(configPath), { recursive: true, mode: 0o700 })
  const tempPath = `${configPath}.tmp-${randomBytes(8).toString('hex')}`
  const payload = `${JSON.stringify(config, null, 2)}\n`
  let handle: number | undefined

  try {
    handle = openSync(tempPath, 'wx', 0o600)
    writeFileSync(handle, payload, 'utf8')
    fsyncSync(handle)
    closeSync(handle)
    handle = undefined
    renameSync(tempPath, configPath)
    try {
      chmodSync(configPath, 0o600)
    } catch {
      // The temp file was already 0600, so the rename carried the mode even if
      // this filesystem rejects an explicit chmod.
    }
  } catch (error) {
    if (handle !== undefined) {
      try {
        closeSync(handle)
      } catch {
        // Best effort: the original error is the one that matters.
      }
    }
    try {
      unlinkSync(tempPath)
    } catch {
      // Best effort cleanup; the temp name is unique per attempt.
    }
    throw error
  }
}

function trustedDecision(
  projectRoot: string,
  matchedGrant: string,
  configPath: string,
): TrustDecision {
  return {
    trusted: true,
    code: 'trusted',
    projectRoot,
    matchedGrant,
    message: oneLine(
      `Project ${projectRoot} is trusted; mutating supervisor tools are enabled.`,
    ),
    hint: `Remove the grant from ${configPath} to revoke.`,
  }
}

function notGrantedDecision(projectRoot: string): TrustDecision {
  return {
    trusted: false,
    code: 'not_granted',
    projectRoot,
    message: oneLine(
      `Project ${projectRoot} is not trusted; mutating supervisor tools are disabled.`,
    ),
    hint: TRUST_GRANT_HINT,
  }
}

function deniedDecision(
  projectRoot: string,
  code: Exclude<TrustCode, 'trusted'>,
  reason: string,
): TrustDecision {
  return {
    trusted: false,
    code,
    projectRoot,
    message: oneLine(
      `Project ${projectRoot} is not trusted: ${reason}; mutating supervisor tools are disabled.`,
    ),
    hint: TRUST_GRANT_HINT,
  }
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
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
  const cleaned = oneLine(detail)
  return cleaned || 'unknown error'
}
