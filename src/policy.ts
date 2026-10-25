import type { RiskClass, DataClass, OperationMode } from './types'

export interface PermissionRule {
  action: string
  resource: string
  effect: string
}

/**
 * Effect precedence for merged permission rule sets, weakest first.
 *
 * Authority layers (the package canonical floor, the bundled profile, the
 * user config) and project input are intersected by taking the most
 * restrictive effect: `deny` beats `ask` beats `allow`. Callers merge rules
 * through `mostRestrictiveEffect` instead of re-implementing the ordering, so
 * a newly added layer can never soften a stricter one by accident.
 */
export const POLICY_EFFECT_ORDER = ['allow', 'ask', 'deny'] as const

export type PolicyEffect = (typeof POLICY_EFFECT_ORDER)[number]

/** Lowercase a rule effect; `null` for anything that is not allow/ask/deny. */
export function normalizePolicyEffect(effect: unknown): PolicyEffect | null {
  if (typeof effect !== 'string') return null
  const normalized = effect.trim().toLowerCase()
  return (POLICY_EFFECT_ORDER as readonly string[]).includes(normalized)
    ? (normalized as PolicyEffect)
    : null
}

/**
 * Most restrictive of two effects (`deny` > `ask` > `allow`).
 *
 * An unrecognised effect is treated as `deny`: a rule we cannot read must
 * never widen a set.
 */
export function mostRestrictiveEffect(a: unknown, b: unknown): PolicyEffect {
  const left = normalizePolicyEffect(a) ?? 'deny'
  const right = normalizePolicyEffect(b) ?? 'deny'
  return POLICY_EFFECT_ORDER.indexOf(left) >= POLICY_EFFECT_ORDER.indexOf(right)
    ? left
    : right
}

export interface PolicyConfig {
  operationMode: OperationMode
  riskClassLimit: RiskClass
  dataClassLimit: DataClass
  allowedIssueLabels?: string[]
  humanGates: string[]
  maxAttemptsPerTask: number
  maxRepairRounds: number
  maxConcurrentMutatingTasks: number
  maxConcurrentScouts: number
  unattendedMergeEnabled: boolean
  requirePlanApproval: boolean
  requireMergeApproval: boolean
  /** Shell/edit rules carried by the effective profile (additive over root). */
  permissions: PermissionRule[]
  /** MCP bundles the effective profile is allowed to reach. */
  mcpProfiles: string[]
  /**
   * Deny-by-default for *mutating* shell commands with no matching rule
   * (observe / explicitly restricted profiles). Read-only commands and
   * explicitly allowed rules still pass.
   */
  denyMutatingShell: boolean
}

export function loadPolicyConfig(
  profile: Record<string, unknown>,
): PolicyConfig {
  const operationMode = (profile.operation_mode as OperationMode) ?? 'assisted'
  return {
    operationMode,
    riskClassLimit: (profile.risk_class_limit as RiskClass) ?? 'medium',
    dataClassLimit: (profile.data_class_limit as DataClass) ?? 'internal',
    allowedIssueLabels: profile.allowed_issue_labels as string[] | undefined,
    humanGates: (profile.human_gates as string[]) ?? [],
    maxAttemptsPerTask: profile.budget
      ? ((profile.budget as Record<string, number>).max_attempts_per_task ?? 2)
      : 2,
    maxRepairRounds: profile.budget
      ? ((profile.budget as Record<string, number>).max_repair_rounds ?? 3)
      : 3,
    maxConcurrentMutatingTasks: profile.budget
      ? ((profile.budget as Record<string, number>)
          .max_concurrent_mutating_tasks ?? 2)
      : 2,
    maxConcurrentScouts: profile.budget
      ? ((profile.budget as Record<string, number>).max_concurrent_scouts ?? 4)
      : 4,
    unattendedMergeEnabled: profile.budget
      ? ((profile.budget as Record<string, boolean>).unattended_merge_enabled ??
        false)
      : false,
    requirePlanApproval: true,
    requireMergeApproval: true,
    permissions: Array.isArray(profile.permissions)
      ? (profile.permissions as PermissionRule[])
      : [],
    mcpProfiles: Array.isArray(profile.mcp_profiles)
      ? (profile.mcp_profiles as string[])
      : [],
    denyMutatingShell:
      operationMode === 'observe' || profile.restricted === true,
  }
}

/**
 * Pick the effective profile for a requested key. Matches a profile's own
 * `policy_profile` field, its file basename, or its `operation_mode` so a
 * run's `policy_profile` (which stores the operation mode today) still
 * resolves. Returns null when nothing matches.
 */
export function findProfileForKey(
  key: string,
  profiles: Array<{ basename?: string; profile: Record<string, unknown> }>,
): { basename?: string; profile: Record<string, unknown> } | null {
  const target = key.trim()
  if (!target) return null
  const byPolicy = profiles.find((p) => p.profile.policy_profile === target)
  if (byPolicy) return byPolicy
  const byName = profiles.find((p) => p.basename === target)
  if (byName) return byName
  const byMode = profiles.find((p) => p.profile.operation_mode === target)
  return byMode ?? null
}


export function isRiskClassAllowed(
  riskClass: RiskClass,
  limit: RiskClass,
): boolean {
  const order: Record<RiskClass, number> = {
    low: 0,
    medium: 1,
    high: 2,
    critical: 3,
  }
  return order[riskClass] <= order[limit]
}

export function isDataClassAllowed(
  dataClass: DataClass,
  limit: DataClass,
): boolean {
  const order: Record<DataClass, number> = {
    public: 0,
    internal: 1,
    confidential: 2,
    regulated: 3,
  }
  return order[dataClass] <= order[limit]
}

export function shouldEscalateToHuman(opts: {
  riskyProb: number
  needsHumanChoice: string
  needsHumanProb: number
  thresholds?: { riskyMin: number; needsHumanMin: number }
}): boolean {
  const riskyMin = opts.thresholds?.riskyMin ?? 0.85
  const needsHumanMin = opts.thresholds?.needsHumanMin ?? 0.75
  return (
    opts.riskyProb >= riskyMin &&
    opts.needsHumanChoice === 'human' &&
    opts.needsHumanProb >= needsHumanMin
  )
}

export function isCommandAllowed(
  command: string,
  permissions: Array<{ action: string; resource: string; effect: string }>,
): boolean {
  for (const rule of permissions) {
    if (rule.action !== 'shell') continue
    const pattern = rule.resource
    if (matchResource(command, pattern)) {
      return rule.effect === 'allow'
    }
  }
  return true
}

/**
 * Shell-command glob match. `*`/`**` match any characters (shell patterns
 * are not path-segmented, so `rm -rf*` must match `rm -rf /tmp/x`).
 */
function matchResource(input: string, pattern: string): boolean {
  if (pattern === '*') return true
  const regexStr = pattern
    .replace(/\*\*/g, '<<GLOBSTAR>>')
    .replace(/\*/g, '.*')
    .replace(/<<GLOBSTAR>>/g, '.*')
  try {
    return new RegExp(`^${regexStr}$`).test(input)
  } catch {
    return input.includes(pattern)
  }
}

// --- Shell command gate (fail-closed) ---

export interface CommandDecision {
  allowed: boolean
  reason: string
}

export interface ShellGateOptions {
  /**
   * Deny shell commands that no rule matches and that are not provably
   * read-only (observe / explicitly restricted profiles).
   */
  denyMutating?: boolean
  /**
   * How to treat an `ask` rule inside a non-interactive hook. Default
   * 'deny' (fail-closed); the plugin passes 'allow' only when a human is
   * present to carry the prompt.
   */
  askEffect?: 'deny' | 'allow'
}

/**
 * Emergency mirror of the canonical `opencode.json` bash rules, used ONLY
 * when the canonical config cannot be read at hook time. The canonical
 * authority is the root `opencode.json`; profiles are additive overrides.
 */
export const CANONICAL_SHELL_RULES: PermissionRule[] = [
  { action: 'shell', resource: 'git push *', effect: 'deny' },
  { action: 'shell', resource: 'git push --force*', effect: 'deny' },
  { action: 'shell', resource: 'git push*--force*', effect: 'deny' },
  { action: 'shell', resource: 'git push origin develop*', effect: 'ask' },
  { action: 'shell', resource: 'git reset --hard *', effect: 'deny' },
  { action: 'shell', resource: 'git clean *', effect: 'deny' },
  { action: 'shell', resource: 'rm -rf *', effect: 'deny' },
  { action: 'shell', resource: 'sudo **', effect: 'deny' },
  { action: 'shell', resource: 'chmod *', effect: 'deny' },
  { action: 'shell', resource: 'chown *', effect: 'deny' },
]

const READ_ONLY_COMMANDS = new Set([
  'ls',
  'cat',
  'head',
  'tail',
  'wc',
  'grep',
  'rg',
  'find',
  'pwd',
  'echo',
  'printf',
  'which',
  'type',
  'env',
  'printenv',
  'stat',
  'file',
  'du',
  'df',
  'tree',
  'jq',
  'sort',
  'uniq',
  'cut',
  'diff',
  'cmp',
  'realpath',
  'basename',
  'dirname',
  'test',
  'true',
  'false',
  'date',
  'whoami',
  'uname',
  'sleep',
])

const READ_ONLY_GIT_SUBCOMMANDS = new Set([
  'status',
  'log',
  'diff',
  'show',
  'rev-parse',
  'ls-files',
  'ls-remote',
  'describe',
  'blame',
  'shortlog',
  'reflog',
  'name-rev',
  'merge-base',
  'cat-file',
  'for-each-ref',
])

function commandSegments(command: string): string[] {
  return command
    .split(/[;&|\n]+/)
    .map((segment) => segment.trim())
    .filter(Boolean)
}

/**
 * Flags that turn a nominally read-only command into a mutating one
 * (`find . -delete`, `find . -exec rm {} \;`). Presence anywhere in a segment
 * disqualifies the read-only classification.
 */
const MUTATING_FLAGS = new Set([
  '-delete',
  '-exec',
  '--exec',
  '-execdir',
  '-ok',
  '-okdir',
])

function segmentIsReadOnly(segment: string): boolean {
  if (/[<>`]/.test(segment) || segment.includes('$(')) return false
  const tokens = segment.split(/\s+/)
  // Any mutating flag disqualifies the segment regardless of the head command.
  for (const token of tokens) {
    if (MUTATING_FLAGS.has(token)) return false
  }
  let index = 0
  while (index < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index])) {
    index += 1 // skip VAR=value prefixes
  }
  const head = tokens[index]
  if (!head) return false
  const bare = head.split('/').pop() ?? head
  if (bare === 'env') {
    // `env` is read-only only when it just prints/assigns; any trailing
    // non-assignment token means it executes that command (`env rm -rf x`).
    for (let i = index + 1; i < tokens.length; i += 1) {
      const token = tokens[i]
      if (token.startsWith('-')) continue
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) continue
      return false
    }
    return true
  }
  if (bare === 'git') {
    let cursor = index + 1
    while (cursor < tokens.length) {
      const token = tokens[cursor]
      if (token === '-C' || token === '-c') {
        cursor += 2
        continue
      }
      if (token.startsWith('-')) {
        cursor += 1
        continue
      }
      return READ_ONLY_GIT_SUBCOMMANDS.has(token)
    }
    return false
  }
  return READ_ONLY_COMMANDS.has(bare)
}

/** True only when every command segment is provably read-only. */
export function isReadOnlyCommand(command: string): boolean {
  const segments = commandSegments(command)
  if (segments.length === 0) return true
  return segments.every(segmentIsReadOnly)
}

/**
 * Fail-closed shell decision. When several rules match, the most specific
 * pattern wins (longest literal, e.g. `git push origin develop*` beats
 * `git push*`); ties keep file order. `denyMutating` denies any unmatched
 * command that is not provably read-only (observe / assisted-restricted
 * profiles).
 */
export function evaluateShellCommand(
  command: string,
  permissions: PermissionRule[],
  opts: ShellGateOptions = {},
): CommandDecision {
  const cmd = command.trim()
  if (!cmd) return { allowed: true, reason: 'empty command' }

  let best: PermissionRule | null = null
  let bestScore = -1
  for (const rule of permissions) {
    if (rule.action !== 'shell') continue
    if (!matchResource(cmd, rule.resource)) continue
    const score = rule.resource.replace(/\*/g, '').length
    if (score > bestScore) {
      best = rule
      bestScore = score
    }
  }

  if (best) {
    const effect = String(best.effect ?? '').toLowerCase()
    if (effect === 'allow') return { allowed: true, reason: `allow:${best.resource}` }
    if (effect === 'deny') return { allowed: false, reason: `deny:${best.resource}` }
    if (effect === 'ask') {
      return opts.askEffect === 'allow'
        ? { allowed: true, reason: `ask:${best.resource}` }
        : {
            allowed: false,
            reason: `ask:${best.resource} (fail-closed: no interactive channel)`,
          }
    }
    return { allowed: false, reason: `unknown effect '${best.effect}' for ${best.resource}` }
  }

  if (opts.denyMutating && !isReadOnlyCommand(cmd)) {
    return {
      allowed: false,
      reason: 'deny-by-default: mutating shell under restricted profile',
    }
  }
  return { allowed: true, reason: 'no matching rule' }
}

/**
 * Two-layer shell gate. The canonical root rules are the authority: a
 * canonical denial is final and no profile rule may soften it. Profile
 * rules are additive — they may only restrict further.
 */
export function evaluateShellGate(
  command: string,
  canonicalRules: PermissionRule[],
  profileRules: PermissionRule[],
  opts: ShellGateOptions = {},
): CommandDecision {
  const canonical = evaluateShellCommand(command, canonicalRules, opts)
  if (!canonical.allowed) return canonical
  const profile = evaluateShellCommand(command, profileRules, opts)
  if (!profile.allowed) return profile
  return { allowed: true, reason: profile.reason }
}

// --- MCP scope ---

/** The 12 servers declared in the canonical root `opencode.json`. */
export const MCP_SERVERS: readonly string[] = [
  'supabase',
  'LiteParse',
  'reguardian',
  'stripe',
  'cloudflare',
  'cloudflare-docs',
  'cloudflare-bindings',
  'cloudflare-builds',
  'cloudflare-observability',
  'dns-analytics',
  'resend',
  'posthog',
]

/**
 * MCP bundles referenced by profiles' `mcp_profiles`. Server membership per
 * bundle per the compatibility audit; `core-readonly` needs no servers.
 */
export const MCP_PROFILE_SERVERS: Record<string, readonly string[]> = {
  'core-readonly': [],
  document: ['LiteParse'],
  'cloud-readonly': ['cloudflare-docs', 'cloudflare-observability'],
  'cloud-mutation': ['cloudflare', 'cloudflare-bindings', 'cloudflare-builds'],
  compliance: ['reguardian'],
  data: ['supabase', 'posthog'],
  payments: ['stripe'],
  messaging: ['resend'],
  dns: ['dns-analytics'],
}

/** Union of servers reachable through the given MCP bundles. */
export function resolveMcpAllowedServers(mcpProfiles: string[]): string[] {
  const allowed = new Set<string>()
  for (const name of mcpProfiles) {
    for (const server of MCP_PROFILE_SERVERS[name] ?? []) allowed.add(server)
  }
  return [...allowed]
}

/**
 * Resolve a tool name to its MCP server namespace, longest server name
 * first so `cloudflare-docs_x` never resolves to `cloudflare`. Accepts the
 * common OpenCode MCP id shapes (`<server>_<tool>`, `<server>.<tool>`,
 * `mcp__<server>__<tool>`). Returns null for non-MCP (built-in) tools.
 */
export function mcpServerNamespace(toolName: string): string | null {
  const lower = toolName.toLowerCase()
  const candidates = [lower]
  if (lower.startsWith('mcp__')) candidates.push(lower.slice(5))
  else if (lower.startsWith('mcp_')) candidates.push(lower.slice(4))
  const sorted = [...MCP_SERVERS].sort((a, b) => b.length - a.length)
  for (const candidate of candidates) {
    for (const server of sorted) {
      const name = server.toLowerCase()
      if (candidate === name) return server
      if (
        candidate.startsWith(name) &&
        ['_', '.', '/', ':', '-'].includes(candidate[name.length] ?? '')
      ) {
        return server
      }
    }
  }
  return null
}

/**
 * Fail-closed scope check. Non-MCP (built-in) tool names are not scoped
 * here and pass; a known MCP namespace must appear in `allowedServers`.
 */
export function isToolInMcpScope(
  toolName: string,
  allowedServers: string[],
): boolean {
  const namespace = mcpServerNamespace(toolName)
  if (namespace === null) {
    // Fail closed: a name carrying an explicit MCP prefix whose server is not
    // in the canonical registry (`mcp__unknown_server__tool`) must NOT pass.
    // Non-MCP built-in tools (no `mcp_`/`mcp__` prefix) are still unscoped.
    const lower = toolName.toLowerCase()
    if (lower.startsWith('mcp__') || lower.startsWith('mcp_')) return false
    return true
  }
  return allowedServers.some(
    (server) => server.toLowerCase() === namespace.toLowerCase(),
  )
}

// --- Jev data-class egress gate ---

export const DEFAULT_DATA_CLASS_LIMIT: DataClass = 'internal'

/**
 * Whether a run's data class may leave the machine for a remote Jev
 * judgement. Confidential/regulated payloads must not (local/no-model path
 * instead); unknown classes default to `internal` (the ledger column
 * default) so public/internal behaviour is unchanged.
 */
export function isJevEgressAllowed(
  dataClass?: string | null,
  limit: DataClass = DEFAULT_DATA_CLASS_LIMIT,
): boolean {
  return isDataClassAllowed(normalizeDataClass(dataClass), limit)
}

function normalizeDataClass(value?: string | null): DataClass {
  const normalized = (value ?? '').trim().toLowerCase()
  if (
    normalized === 'public' ||
    normalized === 'internal' ||
    normalized === 'confidential' ||
    normalized === 'regulated'
  ) {
    return normalized
  }
  return DEFAULT_DATA_CLASS_LIMIT
}
