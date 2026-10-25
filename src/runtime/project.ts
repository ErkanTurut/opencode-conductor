// Project identity — the durable record a central conductor keeps for a
// checkout.
//
// The record is a cache of the resolved state layout plus the operator-owned
// knobs (branch names, verification profile, trust grant) that must survive
// sessions. It is intentionally NOT an authority: every path in it is
// re-derived from `StateLayout` on resolve, so a moved checkout or a changed
// conductor home is picked up instead of being trusted from stale JSON.
//
// Trust grants (`trust.grantedAt`) are stored here but their lifecycle belongs
// to `runtime/trust.ts`; this module only preserves whatever is already on
// disk.
//
// Branch names and the verify profile come from `runtime/detect.ts` on every
// resolve. The stored verify `hash` is what decides between "keep the recorded
// profile" (no drift) and "re-detect" (a script, lockfile, manifest or branch
// changed), so a checkout that gains real checks stops being verified by an
// empty command list.
//
// Import note: extensionless specifiers, matching runtime/state-layout.ts (the
// package's tsc baseline rejects `.ts`-suffixed imports).
import { randomBytes } from 'node:crypto'
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname } from 'node:path'
import { DETECTION_FAILED_SOURCE, detectProject } from './detect'
import {
  canonicalLedgerKey,
  resolveStateLayout,
  type StateLayout,
  type StateMode,
  type StateModePreference,
} from './state-layout'

/** Branch names a supervisor session writes to. Mirrors plugin DEFAULT_BRANCHES. */
export interface ProjectBranches {
  main: string
  dev: string
}

/**
 * Verification profile captured for the project. `detectedFrom` records which
 * sources produced the commands (e.g. `package.json#scripts.verify`) and `hash`
 * makes drift detectable without diffing command lists.
 */
export interface ProjectVerifyProfile {
  commands: string[]
  detectedFrom: string[]
  hash: string
}

/** Trust grant state. `grantedAt` null means "not granted". */
export interface ProjectTrust {
  grantedAt: string | null
}

/**
 * One `project.json` under a central state root.
 *
 * `path` is the caller-supplied directory, `canonicalPath` the canonical
 * project identity (see `canonicalLedgerKey`). `id` is the conductor project
 * key; opencode's own project id, when known, rides in `opencodeProjectId`.
 */
export interface ProjectRecord {
  id: string
  path: string
  canonicalPath: string
  stateMode: StateMode
  projectKey: string
  stateRoot: string
  ledgerPath: string
  runsDir: string
  memoryDir: string
  branch: ProjectBranches
  verify: ProjectVerifyProfile | null
  trust: ProjectTrust
  createdAt: string
  lastUsedAt: string
  opencodeProjectId?: string
}

export interface ResolveProjectIdentityInput {
  projectRoot: string
  /** opencode's project id, persisted as `opencodeProjectId`. */
  projectId?: string | null
  /** Defaults to `auto`: local when the project already owns a ledger, else central. */
  mode?: StateModePreference
  /** Env for central-root resolution. Defaults to `process.env`. */
  env?: Record<string, string | undefined>
}

export interface ResolvedProjectIdentity {
  layout: StateLayout
  record: ProjectRecord
  /** `null` in local mode: local state has no project record. */
  recordPath: string | null
}

/** Loopback default branches, matching `DEFAULT_BRANCHES` in plugin.ts. */
const DEFAULT_BRANCHES: ProjectBranches = { main: 'main', dev: 'develop' }

function nonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

function isVerifyProfile(value: unknown): value is ProjectVerifyProfile {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return (
    isStringArray(candidate.commands) &&
    isStringArray(candidate.detectedFrom) &&
    typeof candidate.hash === 'string'
  )
}

/**
 * Structural validation. Anything unreadable or malformed returns null so a
 * corrupt record is rebuilt from the resolved layout instead of crashing every
 * session in that project.
 */
function isProjectRecord(value: unknown): value is ProjectRecord {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  const branch = candidate.branch as Record<string, unknown> | undefined
  const trust = candidate.trust as Record<string, unknown> | undefined
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.path === 'string' &&
    typeof candidate.canonicalPath === 'string' &&
    (candidate.stateMode === 'local' || candidate.stateMode === 'central') &&
    typeof candidate.projectKey === 'string' &&
    typeof candidate.stateRoot === 'string' &&
    typeof candidate.ledgerPath === 'string' &&
    typeof candidate.runsDir === 'string' &&
    typeof candidate.memoryDir === 'string' &&
    typeof candidate.createdAt === 'string' &&
    typeof candidate.lastUsedAt === 'string' &&
    !!branch &&
    typeof branch.main === 'string' &&
    typeof branch.dev === 'string' &&
    (candidate.verify === null || isVerifyProfile(candidate.verify)) &&
    !!trust &&
    (trust.grantedAt === null || typeof trust.grantedAt === 'string') &&
    (candidate.opencodeProjectId === undefined ||
      typeof candidate.opencodeProjectId === 'string')
  )
}

/**
 * Read a project record. Returns null when the file is missing, unreadable,
 * not JSON, or fails validation — never throws for those cases.
 */
export function readProjectRecord(path: string): ProjectRecord | null {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  return isProjectRecord(parsed) ? parsed : null
}

/**
 * Atomically write a project record: temp file in the destination directory,
 * then rename. Creates parent directories. A reader never observes a partial
 * JSON document, and a failed write leaves no stray temp file behind.
 */
export function writeProjectRecord(path: string, record: ProjectRecord): void {
  const dir = dirname(path)
  mkdirSync(dir, { recursive: true })
  const tempPath = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
  try {
    writeFileSync(tempPath, `${JSON.stringify(record, null, 2)}\n`)
    renameSync(tempPath, path)
  } catch (error) {
    try {
      rmSync(tempPath, { force: true })
    } catch {
      // Best effort: the temp file is inert if cleanup itself fails.
    }
    throw error
  }
}

/** Key-order-independent JSON, so idempotency is not a formatting accident. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/** `p/<projectKey>/<key>` — the storage projection namespace for a project. */
export function projectionKey(projectKey: string, key: string): string {
  return `p/${projectKey}/${key}`
}

/**
 * Resolve (and persist) a project's identity.
 *
 * Rules:
 * - `mode` defaults to `auto`: local iff the canonical project already owns
 *   conductor state, central otherwise (see `detectStateMode`).
 * - Central mode ensures the record exists and is current. The write is skipped
 *   when the resolved record is byte-identical (key order ignored), so repeated
 *   resolution is idempotent and does not churn mtimes.
 * - Local mode has no record path (`projectRecordPath` is null) and therefore
 *   never writes into the checkout.
 * - `createdAt`, `lastUsedAt` and `trust` are preserved from an existing
 *   record; only `lastUsedAt` is refreshed when the record's identity has
 *   changed (first write of a new layout).
 * - `branch` and `verify` come from `runtime/detect.ts`. They are preserved
 *   from an existing record while its verify `hash` still matches the current
 *   detection; otherwise the record is refreshed in the same write.
 */
export function resolveProjectIdentity(
  input: ResolveProjectIdentityInput,
): ResolvedProjectIdentity {
  const layout = resolveStateLayout({
    projectRoot: input.projectRoot,
    mode: input.mode ?? 'auto',
    env: input.env,
  })
  const recordPath = layout.projectRecordPath
  const existing = recordPath ? readProjectRecord(recordPath) : null
  const now = new Date().toISOString()

  const opencodeProjectId =
    nonEmpty(input.projectId) ?? existing?.opencodeProjectId ?? null

  // Detection is read-only and non-throwing by contract (runtime/detect.ts).
  // It runs on every resolve so a moved checkout, a new script or a renamed
  // branch is picked up; the stored hash decides whether the recorded verify
  // profile is still current.
  const detected = detectProject(input.projectRoot, input.env)
  const detectionFailed = detected.verifySources.includes(DETECTION_FAILED_SOURCE)
  const storedVerify = existing?.verify ?? null
  const verifyCurrent = storedVerify !== null && storedVerify.hash === detected.hash

  // A plain directory has no branch namespace: keep the record's historical
  // loopback defaults (main/develop) instead of detection's placeholders. A
  // git checkout records what was detected; an existing record is only kept
  // when its detection hash still matches (or when detection itself failed, in
  // which case the stored profile is the last known good one).
  const detectedBranch = detected.isGitRepo
    ? detected.branches
    : { ...DEFAULT_BRANCHES }
  const branch =
    existing && (detectionFailed || verifyCurrent)
      ? existing.branch
      : detectedBranch
  const verify = detectionFailed
    ? storedVerify
    : detected.ecosystem === 'none'
      ? null
      : verifyCurrent && storedVerify
        ? storedVerify
        : {
            commands: [...detected.verifyCommands],
            detectedFrom: [...detected.verifySources],
            hash: detected.hash,
          }

  const identityChanged =
    existing === null ||
    existing.stateMode !== layout.mode ||
    existing.projectKey !== layout.projectKey ||
    existing.stateRoot !== layout.stateRoot ||
    existing.canonicalPath !== canonicalLedgerKey(input.projectRoot) ||
    existing.path !== input.projectRoot ||
    existing.ledgerPath !== layout.ledgerPath ||
    existing.runsDir !== layout.runsDir ||
    existing.memoryDir !== layout.memoryDir ||
    (opencodeProjectId ?? null) !== (existing.opencodeProjectId ?? null)

  const record: ProjectRecord = {
    id: existing?.id ?? layout.projectKey,
    path: input.projectRoot,
    canonicalPath: canonicalLedgerKey(input.projectRoot),
    stateMode: layout.mode,
    projectKey: layout.projectKey,
    stateRoot: layout.stateRoot,
    ledgerPath: layout.ledgerPath,
    runsDir: layout.runsDir,
    memoryDir: layout.memoryDir,
    branch,
    verify,
    trust: existing?.trust ?? { grantedAt: null },
    createdAt: existing?.createdAt ?? now,
    lastUsedAt:
      existing === null || identityChanged ? now : existing.lastUsedAt,
    ...(opencodeProjectId ? { opencodeProjectId } : {}),
  }

  if (recordPath) {
    const unchanged = existing !== null && stableJson(existing) === stableJson(record)
    if (!unchanged) writeProjectRecord(recordPath, record)
  }

  return { layout, record, recordPath }
}
