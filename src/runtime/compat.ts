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
 * The file format uses the same action names (`shell`, `subagent`, `read`,
 * `edit`, ...); `renderAgentMarkdown` only corrects the two legacy aliases.
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

/**
 * Legacy file-format action name → the V2 name the runtime uses.
 *
 * The shipped assets already speak V2 (`shell`, `subagent`); the map only
 * catches a caller that still hands over the old aliases.
 */
const V2_PERMISSION_ACTION_ALIASES: Readonly<Record<string, string>> = {
  bash: 'shell',
  task: 'subagent',
}

function yamlScalar(value: string): string {
  return JSON.stringify(value)
}

/** Single-quoted YAML scalar (patterns): escape an embedded quote by doubling. */
function yamlQuoted(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
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
 * Emission rank of an effect.
 *
 * V2 evaluates the *last* matching rule, so a narrow deny must be written after
 * the broad allow it narrows — the opposite of the V1 first-match block the
 * shipped assets still use. An unknown effect sits between `ask` and `deny` so
 * it can never outrank an explicit denial.
 */
const RENDER_EFFECT_RANK: Readonly<Record<string, number>> = {
  allow: 0,
  ask: 1,
  deny: 2,
}

function effectRank(effect: string): number {
  return RENDER_EFFECT_RANK[effect] ?? 1.5
}

/**
 * Render the V2 `permissions` block:
 *
 * ```
 * permissions:
 *   - action: read
 *     resource: '.env*'
 *     effect: deny
 * ```
 *
 * Rules stay grouped by action (first appearance wins) and each action is
 * ordered allow → ask → deny, preserving the caller's relative order inside an
 * effect group. Omitting the block entirely would fall back to the runtime
 * default `allow *`, which is the security gap this function closes.
 */
function renderPermissionBlock(
  rules: readonly MaterializablePermissionRule[] | undefined,
): string[] {
  if (!rules || rules.length === 0) return []

  const order: string[] = []
  const groups = new Map<string, Array<{ rule: MaterializablePermissionRule; index: number }>>()
  rules.forEach((rule, index) => {
    if (!rule || typeof rule.action !== 'string' || rule.action.length === 0) return
    const action = V2_PERMISSION_ACTION_ALIASES[rule.action] ?? rule.action
    let group = groups.get(action)
    if (!group) {
      group = []
      groups.set(action, group)
      order.push(action)
    }
    group.push({ rule, index })
  })
  if (order.length === 0) return []

  const lines: string[] = ['permissions:']
  for (const action of order) {
    // `sort` is stable, so the index tie-break is only belt-and-braces.
    const group = [...(groups.get(action) ?? [])].sort(
      (left, right) =>
        effectRank(left.rule.effect) - effectRank(right.rule.effect) ||
        left.index - right.index,
    )
    for (const { rule } of group) {
      const resource =
        typeof rule.resource === 'string' && rule.resource.length > 0
          ? rule.resource
          : '*'
      lines.push(`  - action: ${yamlKey(action)}`)
      lines.push(`    resource: ${yamlQuoted(resource)}`)
      lines.push(`    effect: ${yamlEffect(rule.effect)}`)
    }
  }
  return lines
}

/**
 * Render one agent as OpenCode's file-based agent format (frontmatter + body).
 *
 * The frontmatter is V2: the runtime only discovers a global agent under
 * `<config>/opencode/agents/*.md` when it carries this shape, and a V1
 * `permission:` map is silently ignored outside a project. `model` keeps the
 * `provider/id` reference with an optional `#variant` suffix.
 */
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

/** The directory entry subset the skill mirror walks (a `Dirent` in practice). */
export interface MaterializeDirEntry {
  name: string
  isDirectory(): boolean
  isFile(): boolean
}

/**
 * `MaterializeFs` plus directory listing.
 *
 * The agent materialiser writes a flat list of known files; mirroring the
 * package's skill tree needs to read the source layout, so it gets its own
 * interface rather than widening the one every existing adapter implements.
 */
export interface MaterializeTreeFs extends MaterializeFs {
  readdirSync(
    path: string,
    options: { withFileTypes: true },
  ): readonly MaterializeDirEntry[]
}

/** The file every skill directory must contain to be mirrored. */
export const SKILL_MANIFEST_NAME = 'SKILL.md'

function joinPath(base: string, name: string): string {
  return base.endsWith('/') ? `${base}${name}` : `${base}/${name}`
}

/**
 * Make a caller-supplied directory absolute.
 *
 * This module deliberately imports no `node:path` (it must load where the probe
 * runs), so the one normalisation the mirror needs is inlined. Callers pass an
 * absolute config path in production.
 */
function absoluteDir(dir: string): string {
  const withoutTrailing = dir.replace(/\/+$/, '') || '/'
  if (withoutTrailing.startsWith('/')) return withoutTrailing
  const cwd = process.cwd().replace(/\/+$/, '')
  return `${cwd}/${withoutTrailing}`
}

/** Sorted directory listing; an unreadable directory is empty, never a throw. */
function listDir(fs: MaterializeTreeFs, dir: string): MaterializeDirEntry[] {
  try {
    return [...fs.readdirSync(dir, { withFileTypes: true })].sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    )
  } catch {
    return []
  }
}

/** Recursively mirror one source directory, writing only changed files. */
function mirrorSkillDir(
  sourceDir: string,
  targetDir: string,
  fs: MaterializeTreeFs,
  written: string[],
): void {
  fs.mkdirSync(targetDir, { recursive: true, mode: 0o700 })
  for (const entry of listDir(fs, sourceDir)) {
    const source = joinPath(sourceDir, entry.name)
    const target = joinPath(targetDir, entry.name)

    if (entry.isDirectory()) {
      mirrorSkillDir(source, target, fs, written)
      continue
    }
    // Only regular files are mirrored: a symlink or socket is not package
    // content, and following a link would copy a host file into the config dir.
    if (!entry.isFile()) continue

    let content: string
    try {
      content = fs.readFileSync(source, 'utf8')
    } catch {
      continue
    }
    try {
      if (fs.existsSync(target) && fs.readFileSync(target, 'utf8') === content) continue
    } catch {
      // An unreadable existing file is replaced rather than trusted.
    }
    const temp = `${target}.tmp-${process.pid}`
    fs.writeFileSync(temp, content, { mode: 0o600 })
    fs.renameSync(temp, target)
    written.push(target)
  }
}

/**
 * Mirror the package's skill tree into the runtime's global skills directory.
 *
 * The runtime discovers a global skill under `<config>/opencode/skills/<name>/`
 * containing `SKILL.md`; registering through `skill.transform` instead
 * destabilises the watched config directory on OpenCode 2.1.3, so files are the
 * registration path. Every immediate subdirectory with a `SKILL.md` is copied
 * recursively (a skill's `references/` siblings must travel with it).
 *
 * Idempotent: an unchanged file is left untouched. Atomic per file (temp +
 * rename), directories 0700 and files 0600. Returns the absolute paths written
 * — empty on a no-op second run.
 */
export function materializeSkillDirs(
  assetsSkillsDir: string,
  targetDir: string,
  fs: MaterializeTreeFs,
): string[] {
  const written: string[] = []
  const root = absoluteDir(targetDir)

  for (const entry of listDir(fs, assetsSkillsDir)) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const source = joinPath(assetsSkillsDir, entry.name)
    if (!fs.existsSync(joinPath(source, SKILL_MANIFEST_NAME))) continue
    mirrorSkillDir(source, joinPath(root, entry.name), fs, written)
  }

  return written
}
