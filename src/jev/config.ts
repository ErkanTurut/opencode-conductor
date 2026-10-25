// JEV configuration layer (defaults OFF, redaction-first).
//
// Pure TypeScript — no dependencies beyond node:fs / node:path.
// Resolution precedence (lowest to highest):
//   built-in defaults -> config/jev.json file -> JEV_* env vars ->
//   per-run override argument to `loadJevConfig()`.
// JEV stays disabled unless explicitly enabled at one of those layers.

import * as nodeFs from 'node:fs'
import { join, resolve } from 'node:path'

export interface JevThresholds {
  severityMin: number
  severityUpgradeMin: number
  contractScoreMin: number
  verifiableMin: number
  riskyMin: number
  needsHumanMin: number
}

export interface JevBudget {
  maxCallsPerRun: number
  maxInputTokensPerRun: number
}

export interface JevConfig {
  enabled: boolean
  model: string
  timeoutMs: number
  maxStateChars: number
  thresholds: JevThresholds
  budget: JevBudget
  zeroDataRetention: boolean
}

/** Partial per-run (e.g. CLI toggle) overrides applied last. */
export interface JevConfigOverrides {
  enabled?: boolean
  model?: string
  timeoutMs?: number
  maxStateChars?: number
  thresholds?: Partial<JevThresholds>
  budget?: Partial<JevBudget>
  zeroDataRetention?: boolean
}

export const JEV_CONFIG_ENV_VAR = 'JEV_CONFIG_PATH'
export const DEFAULT_JEV_CONFIG_FILENAME = 'jev.json'

export const GATEWAY_API_KEY_ENV_VAR = 'AI_GATEWAY_API_KEY'

export function getEnvCaseInsensitive(name: string): string | undefined {
  return process.env[name] ?? process.env[name.toLowerCase()] ?? process.env[name.toUpperCase()]
}

export function getGatewayApiKey(): string | undefined {
  return getEnvCaseInsensitive(GATEWAY_API_KEY_ENV_VAR)
}

export const DEFAULT_JEV_MODEL = 'typesafe-ai/jev'
export const DEFAULT_JEV_TIMEOUT_MS = 4000
export const DEFAULT_JEV_MAX_STATE_CHARS = 20000

const MODEL_TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/

const PROBABILITY_THRESHOLD_KEYS = [
  'severityMin',
  'severityUpgradeMin',
  'verifiableMin',
  'riskyMin',
  'needsHumanMin',
] as const

type ProbabilityThresholdKey = (typeof PROBABILITY_THRESHOLD_KEYS)[number]

export const DEFAULT_JEV_CONFIG: JevConfig = {
  enabled: false,
  model: DEFAULT_JEV_MODEL,
  timeoutMs: DEFAULT_JEV_TIMEOUT_MS,
  maxStateChars: DEFAULT_JEV_MAX_STATE_CHARS,
  thresholds: {
    severityMin: 0.7,
    severityUpgradeMin: 0.85,
    contractScoreMin: 2.5,
    verifiableMin: 0.7,
    riskyMin: 0.85,
    needsHumanMin: 0.75,
  },
  budget: {
    maxCallsPerRun: 20,
    maxInputTokensPerRun: 200000,
  },
  zeroDataRetention: true,
}

/** Fresh deep copy of the built-in defaults (JEV disabled). */
export function defaultJevConfig(): JevConfig {
  return {
    ...DEFAULT_JEV_CONFIG,
    thresholds: { ...DEFAULT_JEV_CONFIG.thresholds },
    budget: { ...DEFAULT_JEV_CONFIG.budget },
  }
}

/**
 * Resolve the JEV config path, independent of the current working
 * directory: explicit argument > `JEV_CONFIG_PATH` env var >
 * `<package>/config/jev.json` (via `import.meta.dir`).
 */
export function resolveJevConfigPath(explicitPath?: string): string {
  const candidate =
    explicitPath?.trim() || getEnvCaseInsensitive(JEV_CONFIG_ENV_VAR)?.trim()
  if (candidate) return resolve(candidate)
  return resolve(join(import.meta.dir, '..', '..', 'config', DEFAULT_JEV_CONFIG_FILENAME))
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Top-level keys that are ignored (lets example files carry comments). */
function isIgnorableKey(key: string): boolean {
  return key.startsWith('_') || key.startsWith('$') || key === 'comment'
}

function parseBooleanEnv(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined
  const normalized = value.trim().toLowerCase()
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'n', 'off', ''].includes(normalized)) return false
  return undefined
}

function parseNumberEnv(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const num = Number(trimmed)
  return Number.isFinite(num) ? num : undefined
}

/** First defined numeric env var among the given names (case-insensitive keys). */
function firstNumberEnv(names: string[]): number | undefined {
  for (const name of names) {
    const num = parseNumberEnv(getEnvCaseInsensitive(name))
    if (num !== undefined) return num
  }
  return undefined
}

function isProbability(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
}

function assertProbability(value: unknown, where: string): number {
  if (!isProbability(value)) {
    throw new Error(
      `jev-config: ${where} = ${String(value)} (must be a number between 0 and 1)`,
    )
  }
  return value
}

function assertPositiveInt(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(
      `jev-config: ${where} = ${String(value)} (must be a positive integer)`,
    )
  }
  return value
}

function parseThresholds(raw: unknown): JevThresholds {
  const defaults = DEFAULT_JEV_CONFIG.thresholds
  if (raw === undefined) return { ...defaults }
  if (!isPlainObject(raw)) {
    throw new Error('jev-config: "thresholds" must be an object')
  }
  const out: JevThresholds = { ...defaults }
  for (const key of PROBABILITY_THRESHOLD_KEYS) {
    if (raw[key] !== undefined) {
      out[key] = assertProbability(raw[key], `thresholds.${key}`)
    }
  }
  if (raw.contractScoreMin !== undefined) {
    const score = raw.contractScoreMin
    if (typeof score !== 'number' || !Number.isFinite(score) || score < 0) {
      throw new Error(
        `jev-config: thresholds.contractScoreMin = ${String(score)} (must be a finite number >= 0)`,
      )
    }
    out.contractScoreMin = score
  }
  for (const key of Object.keys(raw)) {
    if (isIgnorableKey(key)) continue
    if (!(key in defaults)) {
      throw new Error(`jev-config: unknown thresholds key '${key}'`)
    }
  }
  return out
}

function parseBudget(raw: unknown): JevBudget {
  const defaults = DEFAULT_JEV_CONFIG.budget
  if (raw === undefined) return { ...defaults }
  if (!isPlainObject(raw)) {
    throw new Error('jev-config: "budget" must be an object')
  }
  const out: JevBudget = { ...defaults }
  if (raw.maxCallsPerRun !== undefined) {
    out.maxCallsPerRun = assertPositiveInt(raw.maxCallsPerRun, 'budget.maxCallsPerRun')
  }
  if (raw.maxInputTokensPerRun !== undefined) {
    out.maxInputTokensPerRun = assertPositiveInt(
      raw.maxInputTokensPerRun,
      'budget.maxInputTokensPerRun',
    )
  }
  for (const key of Object.keys(raw)) {
    if (isIgnorableKey(key)) continue
    if (!(key in defaults)) {
      throw new Error(`jev-config: unknown budget key '${key}'`)
    }
  }
  return out
}

/**
 * Validate an untrusted parsed config value. Missing fields fall back to
 * built-in defaults; wrong types throw descriptive errors. Keys starting
 * with `_`/`$` (or named `comment`) are ignored so commented example files
 * can be copied verbatim.
 */
export function validateJevConfig(raw: unknown): JevConfig {
  if (!isPlainObject(raw)) {
    throw new Error('jev-config: top-level config must be an object')
  }
  const defaults = defaultJevConfig()

  let enabled = defaults.enabled
  if (raw.enabled !== undefined) {
    if (typeof raw.enabled !== 'boolean') {
      throw new Error(
        `jev-config: enabled = ${String(raw.enabled)} (must be a boolean)`,
      )
    }
    enabled = raw.enabled
  }

  let model = defaults.model
  if (raw.model !== undefined) {
    if (typeof raw.model !== 'string' || !raw.model) {
      throw new Error('jev-config: model must be a non-empty string')
    }
    if (!MODEL_TOKEN_PATTERN.test(raw.model)) {
      throw new Error(
        `jev-config: model ${JSON.stringify(raw.model)} must match ${MODEL_TOKEN_PATTERN} (no whitespace or control characters)`,
      )
    }
    model = raw.model
  }

  let timeoutMs = defaults.timeoutMs
  if (raw.timeoutMs !== undefined) {
    timeoutMs = assertPositiveInt(raw.timeoutMs, 'timeoutMs')
  }

  let maxStateChars = defaults.maxStateChars
  if (raw.maxStateChars !== undefined) {
    maxStateChars = assertPositiveInt(raw.maxStateChars, 'maxStateChars')
  }

  let zeroDataRetention = defaults.zeroDataRetention
  if (raw.zeroDataRetention !== undefined) {
    if (typeof raw.zeroDataRetention !== 'boolean') {
      throw new Error(
        `jev-config: zeroDataRetention = ${String(raw.zeroDataRetention)} (must be a boolean)`,
      )
    }
    zeroDataRetention = raw.zeroDataRetention
  }
  // ZDR opt-out allowed: when the operator explicitly sets
  // zeroDataRetention to false (e.g. hobby plan without ZDR entitlement),
  // honour it. Default remains true. State payloads are still redacted via
  // stripSecrets() and capped via maxStateChars.

  const knownTopLevel = new Set([
    'enabled',
    'model',
    'timeoutMs',
    'maxStateChars',
    'thresholds',
    'budget',
    'zeroDataRetention',
  ])
  for (const key of Object.keys(raw)) {
    if (isIgnorableKey(key)) continue
    if (!knownTopLevel.has(key)) {
      throw new Error(`jev-config: unknown config key '${key}'`)
    }
  }

  return {
    enabled,
    model,
    timeoutMs,
    maxStateChars,
    thresholds: parseThresholds(raw.thresholds),
    budget: parseBudget(raw.budget),
    zeroDataRetention,
  }
}

function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) out[key as keyof T] = value as T[keyof T]
  }
  return out
}

/** Collect overrides from JEV_* env vars (case-insensitive keys); invalid values are ignored. */
function envOverrides(): JevConfigOverrides {
  const overrides: JevConfigOverrides = {}
  const enabled = parseBooleanEnv(getEnvCaseInsensitive('JEV_ENABLED'))
  if (enabled !== undefined) overrides.enabled = enabled

  const model = getEnvCaseInsensitive('JEV_MODEL')?.trim()
  if (model && MODEL_TOKEN_PATTERN.test(model)) overrides.model = model

  const timeoutMs = parseNumberEnv(getEnvCaseInsensitive('JEV_TIMEOUT_MS'))
  if (timeoutMs !== undefined && Number.isInteger(timeoutMs) && timeoutMs > 0) {
    overrides.timeoutMs = timeoutMs
  }

  const maxStateChars = parseNumberEnv(getEnvCaseInsensitive('JEV_MAX_STATE_CHARS'))
  if (
    maxStateChars !== undefined &&
    Number.isInteger(maxStateChars) &&
    maxStateChars > 0
  ) {
    overrides.maxStateChars = maxStateChars
  }

  const thresholds: Partial<JevThresholds> = {}
  const probabilityFromEnv = (
    key: ProbabilityThresholdKey,
    names: string[],
  ): void => {
    const num = firstNumberEnv(names)
    if (num !== undefined && isProbability(num)) thresholds[key] = num
  }
  probabilityFromEnv('severityMin', ['JEV_SEVERITY_THRESHOLD', 'JEV_SEVERITY_MIN_THRESHOLD'])
  probabilityFromEnv('severityUpgradeMin', [
    'JEV_SEVERITY_UPGRADE_THRESHOLD',
    'JEV_SEVERITY_UPGRADE_MIN_THRESHOLD',
  ])
  probabilityFromEnv('verifiableMin', ['JEV_VERIFIABLE_THRESHOLD', 'JEV_VERIFIABLE_MIN_THRESHOLD'])
  probabilityFromEnv('riskyMin', ['JEV_RISKY_THRESHOLD', 'JEV_RISKY_MIN_THRESHOLD'])
  probabilityFromEnv('needsHumanMin', ['JEV_NEEDS_HUMAN_THRESHOLD', 'JEV_NEEDS_HUMAN_MIN_THRESHOLD'])
  const contractScore = firstNumberEnv([
    'JEV_CONTRACT_SCORE_THRESHOLD',
    'JEV_CONTRACT_THRESHOLD',
  ])
  if (
    contractScore !== undefined &&
    Number.isFinite(contractScore) &&
    contractScore >= 0
  ) {
    thresholds.contractScoreMin = contractScore
  }
  if (Object.keys(thresholds).length > 0) overrides.thresholds = thresholds

  const budget: Partial<JevBudget> = {}
  const maxCalls = parseNumberEnv(getEnvCaseInsensitive('JEV_MAX_CALLS_PER_RUN'))
  if (maxCalls !== undefined && Number.isInteger(maxCalls) && maxCalls > 0) {
    budget.maxCallsPerRun = maxCalls
  }
  const maxTokens = parseNumberEnv(getEnvCaseInsensitive('JEV_MAX_INPUT_TOKENS_PER_RUN'))
  if (maxTokens !== undefined && Number.isInteger(maxTokens) && maxTokens > 0) {
    budget.maxInputTokensPerRun = maxTokens
  }
  if (Object.keys(budget).length > 0) overrides.budget = budget

  const zeroDataRetention = parseBooleanEnv(getEnvCaseInsensitive('JEV_ZERO_DATA_RETENTION'))
  if (zeroDataRetention !== undefined) overrides.zeroDataRetention = zeroDataRetention

  return overrides
}

function applyOverrides(config: JevConfig, overrides?: JevConfigOverrides): JevConfig {
  if (!overrides) return config
  const { thresholds, budget, ...rest } = overrides
  return validateJevConfig({
    ...config,
    ...stripUndefined(rest),
    thresholds: { ...config.thresholds, ...stripUndefined(thresholds ?? {}) },
    budget: { ...config.budget, ...stripUndefined(budget ?? {}) },
  })
}

/**
 * Load the JEV config: built-in defaults -> config/jev.json file (a
 * missing file yields defaults; malformed JSON or schema violations throw)
 * -> JEV_* env vars -> per-run `overrides` argument (highest precedence).
 */
export function loadJevConfig(
  explicitPath?: string,
  overrides?: JevConfigOverrides,
): JevConfig {
  let config = defaultJevConfig()
  const configPath = resolveJevConfigPath(explicitPath)
  if (nodeFs.existsSync(configPath)) {
    let text: string
    try {
      text = nodeFs.readFileSync(configPath, 'utf8')
    } catch (e) {
      throw new Error(`jev-config: failed to read '${configPath}': ${String(e)}`)
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (e) {
      throw new Error(
        `jev-config: config at '${configPath}' is not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
    config = validateJevConfig(parsed)
  }
  config = applyOverrides(config, envOverrides())
  config = applyOverrides(config, overrides)
  // No forced ZDR here — honour the merged config value (see above).
  return config
}

/**
 * Whether JEV is enabled. An explicit per-run boolean override wins;
 * otherwise the merged config (file + env over defaults-OFF) decides.
 * Fail-closed: config load errors yield false.
 */
export function isJevEnabled(override?: boolean): boolean {
  if (typeof override === 'boolean') return override
  try {
    return loadJevConfig().enabled
  } catch {
    return false
  }
}

// --- Secret redaction ---

/** Placeholder written over redacted secret values. */
export const JEV_REDACTED = '[REDACTED]'

/** Per-string truncation budget applied by `stripSecrets`. */
export const JEV_MAX_SECRET_STRING_CHARS = 2000

const SENSITIVE_SUBSTRINGS = [
  'apikey',
  'token',
  'secret',
  'password',
  'passwd',
  'authorization',
  'bearer',
  'cookie',
  'privatekey',
  'clientsecret',
  'accesstoken',
] as const

/** Short keys treated as sensitive only on exact match (avoids 'author'). */
const SENSITIVE_EXACT_KEYS = new Set(['auth', 'pwd', 'pass'])

function normalizeSecretKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function isSensitiveKey(key: string): boolean {
  const normalized = normalizeSecretKey(key)
  if (!normalized) return false
  if (SENSITIVE_EXACT_KEYS.has(normalized)) return true
  return SENSITIVE_SUBSTRINGS.some((part) => normalized.includes(part))
}

function truncateString(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  return `${value.slice(0, maxChars)}...[truncated ${value.length - maxChars} chars]`
}

/**
 * High-precision value-pattern scrubber for secrets embedded in free-form
 * strings (where key-based redaction cannot see them, e.g. pasted logs or
 * prompts). Each match is replaced with `[REDACTED]`. Patterns are
 * intentionally narrow to avoid over-redacting ordinary prose.
 */
const SECRET_VALUE_PATTERNS: RegExp[] = [
  /AKIA[0-9A-Z]{16}/g,
  /ghp_[A-Za-z0-9]{20,}/g,
  /gho_[A-Za-z0-9]{20,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /Bearer\s+[A-Za-z0-9\-_.~+/=]{10,}/g,
  /sk-[A-Za-z0-9]{10,}/g,
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  /xox[baprs]-[A-Za-z0-9-]+/g,
]

export function scrubSecretValues(text: string): string {
  let out = text
  for (const pattern of SECRET_VALUE_PATTERNS) {
    pattern.lastIndex = 0
    out = out.replace(pattern, JEV_REDACTED)
  }
  return out
}

function redactValue(
  value: unknown,
  maxStringChars: number,
  seen: WeakSet<object>,
): unknown {
  // Scrub secret-shaped values first (before truncation) so a long token
  // split by the truncation budget is still fully redacted.
  if (typeof value === 'string') return truncateString(scrubSecretValues(value), maxStringChars)
  if (Array.isArray(value)) {
    if (seen.has(value)) return '[CIRCULAR]'
    seen.add(value)
    const out = value.map((item) => redactValue(item, maxStringChars, seen))
    seen.delete(value)
    return out
  }
  if (isPlainObject(value)) {
    if (seen.has(value)) return '[CIRCULAR]'
    seen.add(value)
    const out: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value)) {
      out[key] = isSensitiveKey(key)
        ? JEV_REDACTED
        : redactValue(entry, maxStringChars, seen)
    }
    seen.delete(value)
    return out
  }
  return value
}

/**
 * Deep-clone `state` with secret values redacted and long strings
 * truncated. Keys matching api_key / token / secret / password /
 * authorization (case- and separator-insensitive, e.g. `apiKey`,
 * `auth-token`) have their whole subtree replaced with `[REDACTED]`.
 * The input is never mutated. Callers should additionally cap the total
 * serialized payload to `maxStateChars` before sending it anywhere.
 */
export function stripSecrets<T>(state: T, maxStringChars = JEV_MAX_SECRET_STRING_CHARS): T {
  const budget = Math.max(1, Math.floor(maxStringChars))
  return redactValue(state, budget, new WeakSet()) as T
}
