// Runtime compatibility probe for the global plugin entry.
//
// A globally installed conductor runs under whatever runtime the host provides,
// not under the Bun process that developed it. It needs four things: the Bun
// global, `bun:sqlite` (the ledger), the Bun shell tag `$` (git, verification,
// run directories), and the Node built-ins (fs/path/crypto). When any one of
// them is missing the honest behaviour is to register a single diagnostic tool
// and stop, rather than register half a supervisor that fails on first use.
//
// Two invariants shape this module:
//   - `probeRuntime` never throws. Every check is isolated in its own
//     `try`/`catch`, so one missing capability is reported as a failed check
//     while the remaining checks still produce evidence.
//   - This module loads in a runtime that has none of the above. Every
//     runtime-specific module is imported *inside* its check; a static
//     `import { Database } from 'bun:sqlite'` would abort the module load
//     before the probe could ever report why.
//
// The probe is async because the `$` check awaits a real shell command
// (`echo conductor-probe`); Bun Shell has no synchronous API. The returned
// shape (`RuntimeProbe`) is the contract.
//
// Import note: consumers import this module extensionless
// (`./runtime/compat`) because the package's `tsc --noEmit` baseline rejects
// `.ts`-suffixed imports (TS5097). Bun resolves the extensionless specifier.

/** One check's evidence. `detail` is what the doctor report prints. */
export interface RuntimeProbeCheckResult {
  name: string
  ok: boolean
  detail: string
}

/** The probe outcome. `ok` is false when any check failed. */
export interface RuntimeProbe {
  ok: boolean
  checks: RuntimeProbeCheckResult[]
  remediation: string
}

/** Injectable environment (production passes `process.env`). */
export type RuntimeProbeEnv = Record<string, string | undefined>

/**
 * A single check. Returning a string is the pass detail; throwing is the
 * failure (its message becomes the detail). Checks may be async.
 */
export interface RuntimeProbeCheck {
  name: string
  run(env: RuntimeProbeEnv): string | Promise<string>
}

/** The exact remedy printed whenever the probe fails. */
export const RUNTIME_REMEDIATION =
  'opencode-conductor requires the Bun plugin runtime. Run /conductor:doctor for details or reinstall OpenCode >= 2.1.3.'

/** Check names in report order. */
export const RUNTIME_PROBE_CHECK_NAMES = [
  'bun-runtime',
  'bun:sqlite',
  'bun-shell',
  'node-builtins',
] as const

/** Node built-ins the conductor's modules depend on at load. */
export const NODE_BUILTIN_SPECIFIERS = [
  'node:fs',
  'node:path',
  'node:crypto',
] as const

function describeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  const cleaned = raw.replace(/\s+/g, ' ').trim()
  if (cleaned.length > 0) return cleaned
  return error instanceof Error ? error.name : 'unknown error'
}

/** (a) `Bun` global and its version. */
function checkBunRuntime(): string {
  const bun = (globalThis as { Bun?: { version?: unknown } }).Bun
  if (!bun) throw new Error('Bun global is not defined')
  const version = bun.version
  if (typeof version !== 'string' || version.trim().length === 0) {
    throw new Error('Bun.version is missing')
  }
  return `Bun ${version}`
}

/** (b) `bun:sqlite` imports and can open/close an in-memory database. */
async function checkBunSqlite(): Promise<string> {
  const mod = (await import('bun:sqlite')) as unknown as {
    Database?: new (path: string) => { close(): void }
  }
  const Database = mod.Database
  if (typeof Database !== 'function') {
    throw new Error('bun:sqlite exports no Database constructor')
  }
  const db = new Database(':memory:')
  db.close()
  return 'bun:sqlite opened and closed an in-memory database'
}

/** (c) The `$` shell tag from 'bun' runs a trivial command. */
async function checkBunShell(env: RuntimeProbeEnv): Promise<string> {
  const mod = (await import('bun')) as unknown as { $?: unknown }
  const $ = mod.$
  if (typeof $ !== 'function') {
    throw new Error("the 'bun' module exports no $ shell tag")
  }
  // Probe the shell in the caller's environment: that is the environment the
  // tools will actually run in, not an imagined default.
  const shellEnv: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') shellEnv[key] = value
  }
  const shell = ($ as any).env(shellEnv)
  const output = await shell`echo conductor-probe`.quiet().text()
  const echoed = String(output).trim()
  if (echoed !== 'conductor-probe') {
    throw new Error(
      `bun shell echoed ${JSON.stringify(echoed)} instead of "conductor-probe"`,
    )
  }
  return 'bun shell ran "echo conductor-probe"'
}

/** (d) The Node built-ins the conductor imports load. */
async function checkNodeBuiltins(): Promise<string> {
  const missing: string[] = []
  for (const specifier of NODE_BUILTIN_SPECIFIERS) {
    try {
      await import(specifier)
    } catch {
      missing.push(specifier)
    }
  }
  if (missing.length > 0) {
    throw new Error(`cannot import ${missing.join(', ')}`)
  }
  return `${NODE_BUILTIN_SPECIFIERS.join(', ')} load`
}

/** The real check list, in report order. Injectable for tests. */
export function defaultRuntimeChecks(): RuntimeProbeCheck[] {
  return [
    { name: 'bun-runtime', run: () => checkBunRuntime() },
    { name: 'bun:sqlite', run: () => checkBunSqlite() },
    { name: 'bun-shell', run: (env) => checkBunShell(env) },
    { name: 'node-builtins', run: () => checkNodeBuiltins() },
  ]
}

/**
 * Run every check and report the evidence.
 *
 * Fail-closed in two ways: a throwing check is a failure (never a pass), and an
 * empty check list is a failure too (a probe that verified nothing must not
 * claim the runtime is usable).
 */
export async function probeRuntime(
  env: RuntimeProbeEnv = process.env,
  checks: RuntimeProbeCheck[] = defaultRuntimeChecks(),
): Promise<RuntimeProbe> {
  const results: RuntimeProbeCheckResult[] = []
  for (const check of checks) {
    try {
      const detail = await check.run(env)
      results.push({ name: check.name, ok: true, detail: String(detail) })
    } catch (error) {
      results.push({ name: check.name, ok: false, detail: describeError(error) })
    }
  }
  return {
    ok: results.length > 0 && results.every((result) => result.ok),
    checks: results,
    remediation: RUNTIME_REMEDIATION,
  }
}

/**
 * Human report for the `supervisor_doctor` tool: one line per check, then the
 * remediation line. No header, so the text stays diffable and the remedy is
 * always the last line.
 */
export function formatDoctorReport(probe: RuntimeProbe): string {
  const lines = probe.checks.map(
    (check) => `[${check.ok ? 'ok' : 'FAIL'}] ${check.name}: ${check.detail}`,
  )
  lines.push(probe.remediation)
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Agent registration path selection (P3)
//
// OpenCode has no `agent.transform(...add)`; a plugin creates an agent by
// calling `update` with an id that does not exist yet. That is observed
// behaviour, not a documented API, so the conductor probes it at build time
// and falls back to writing agent files into the user's global config
// directory when the probe cannot confirm it.
// ---------------------------------------------------------------------------

export type AgentRegistrationPath = 'transform' | 'files'

export type AgentProbeVerdict = 'pass' | 'fail' | 'inconclusive'

export interface AgentProbeReport {
  verdict?: AgentProbeVerdict | string
  checks?: Record<string, boolean>
  [key: string]: unknown
}

/**
 * Decide how agents get registered. Anything short of an explicit `pass` uses
 * the file path: a probe that could not run is not evidence that the
 * undocumented API works, and silently registering nothing is the failure this
 * fallback exists to prevent.
 */
export function selectAgentRegistrationPath(
  report: AgentProbeReport | null | undefined,
): AgentRegistrationPath {
  if (!report || typeof report !== 'object') return 'files'
  return report.verdict === 'pass' ? 'transform' : 'files'
}

/**
 * One permission rule in the runtime's `action`/`resource`/`effect` shape.
 *
 * The runtime names two actions differently from the file format (`shell` for
 * `bash`, `subagent` for `task`); `renderAgentMarkdown` maps them back.
 */
export interface MaterializablePermissionRule {
  action: string
  resource: string
  effect: string
}

export interface MaterializableAgent {
  id: string
  description?: string
  mode?: string
  model?: { providerID: string; id: string; variant?: string }
  steps?: number
  system?: string
  permissions?: MaterializablePermissionRule[]
}

/** Runtime action name → the file-format action name. */
const FILE_PERMISSION_ACTION_ALIASES: Readonly<Record<string, string>> = {
  shell: 'bash',
  subagent: 'task',
}

function yamlScalar(value: string): string {
  return JSON.stringify(value)
}

/** Single-quoted YAML scalar (patterns): escape an embedded quote by doubling. */
function yamlQuoted(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

/**
 * A permission pattern, single-quoted (the file-agent convention).
 *
 * A pattern that itself contains a single quote switches to a double-quoted
 * scalar: OpenCode's own loader needs the YAML escape, while the markdown
 * reader in `register/agents.ts` does not unescape a doubled `''`, so the
 * double-quoted form is the one shape that is valid YAML *and* round-trips
 * here.
 */
function yamlPattern(value: string): string {
  return value.includes("'") ? yamlScalar(value) : yamlQuoted(value)
}

/** A bare map key when it is a plain identifier, a quoted one otherwise. */
function yamlKey(value: string): string {
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(value) ? value : yamlQuoted(value)
}

/** An effect is a bare token (`allow`/`deny`/`ask`); anything else is quoted. */
function yamlEffect(value: string): string {
  return /^[a-z]+$/.test(value) ? value : yamlQuoted(value)
}

/**
 * Render the `permission` block in the file-agent format the shipped agents
 * already use:
 *
 * ```
 * permission:
 *   read:
 *     '*': allow
 *     '.env*': deny
 *   bash:
 *     'git push*': deny
 * ```
 *
 * Grouping by action (first appearance wins) keeps one action's rules together,
 * and rule order inside an action is preserved: the runtime evaluates the first
 * match, so an existing deny must stay ahead of the broad allow it narrows.
 * Omitting the block entirely would fall back to the runtime default `allow *`,
 * which is the security gap this function closes.
 */
function renderPermissionBlock(
  rules: readonly MaterializablePermissionRule[] | undefined,
): string[] {
  if (!rules || rules.length === 0) return []

  const order: string[] = []
  const groups = new Map<string, MaterializablePermissionRule[]>()
  for (const rule of rules) {
    if (!rule || typeof rule.action !== 'string' || rule.action.length === 0) continue
    const action = FILE_PERMISSION_ACTION_ALIASES[rule.action] ?? rule.action
    let group = groups.get(action)
    if (!group) {
      group = []
      groups.set(action, group)
      order.push(action)
    }
    group.push(rule)
  }
  if (order.length === 0) return []

  const lines: string[] = ['permission:']
  for (const action of order) {
    lines.push(`  ${yamlKey(action)}:`)
    for (const rule of groups.get(action) ?? []) {
      const resource =
        typeof rule.resource === 'string' && rule.resource.length > 0
          ? rule.resource
          : '*'
      lines.push(`    ${yamlPattern(resource)}: ${yamlEffect(rule.effect)}`)
    }
  }
  return lines
}

/** Render one agent as OpenCode's file-based agent format (frontmatter + body). */
export function renderAgentMarkdown(agent: MaterializableAgent): string {
  const lines: string[] = ['---']
  if (agent.description) lines.push(`description: ${yamlScalar(agent.description)}`)
  lines.push(`mode: ${agent.mode ?? 'subagent'}`)
  if (agent.model) {
    const ref = agent.model.variant
      ? `${agent.model.providerID}/${agent.model.id}#${agent.model.variant}`
      : `${agent.model.providerID}/${agent.model.id}`
    lines.push(`model: ${yamlScalar(ref)}`)
  }
  if (typeof agent.steps === 'number') lines.push(`steps: ${agent.steps}`)
  lines.push(...renderPermissionBlock(agent.permissions))
  lines.push('---', '')
  lines.push(agent.system ?? '')
  if (lines[lines.length - 1] !== '') lines.push('')
  return lines.join('\n')
}

export interface MaterializeFs {
  mkdirSync: (path: string, options?: unknown) => unknown
  writeFileSync: (path: string, data: string, options?: unknown) => unknown
  renameSync: (from: string, to: string) => unknown
  readFileSync: (path: string, encoding: string) => string
  existsSync: (path: string) => boolean
}

/**
 * Write agent files into a global agents directory. Idempotent: an unchanged
 * file is left untouched. Atomic per file (temp + rename).
 */
export function materializeAgentFiles(
  agents: readonly MaterializableAgent[],
  targetDir: string,
  fs: MaterializeFs,
): string[] {
  fs.mkdirSync(targetDir, { recursive: true, mode: 0o700 })
  const written: string[] = []
  for (const agent of agents) {
    if (!agent || typeof agent.id !== 'string' || agent.id.length === 0) continue
    const body = renderAgentMarkdown(agent)
    const target = `${targetDir}/${agent.id}.md`
    try {
      if (fs.existsSync(target) && fs.readFileSync(target, 'utf8') === body) continue
    } catch {
      // An unreadable existing file is replaced rather than trusted.
    }
    const temp = `${target}.tmp-${process.pid}`
    fs.writeFileSync(temp, body, { mode: 0o600 })
    fs.renameSync(temp, target)
    written.push(target)
  }
  return written
}
