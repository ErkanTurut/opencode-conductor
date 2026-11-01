// Register packaged Markdown defaults in memory through OpenCode V2 transforms.
// Existing native agents are authoritative. Fleet catalogs never select models
// here; native Markdown/JSONC owns configuration. Materialization is an explicit
// compatibility fallback only. Failures warn without disabling supervisor tools.
//
// Import note: imports are extensionless because the package's `tsc --noEmit`
// baseline rejects `.ts`-suffixed specifiers (TS5097).
import * as nodeFs from 'node:fs'
import { join } from 'node:path'
import {
  materializeAgentFiles,
  type MaterializeFs,
  type MaterializeTreeFs,
} from '../runtime/compat'

/** The agent that becomes the session default when it is in the roster. */
export const DEFAULT_AGENT_ID = 'conductor'

/** Environment switch that disables the file-based insurance. */
export const NO_MATERIALIZE_ENV = 'CONDUCTOR_NO_MATERIALIZE'

/** The only permission effects the runtime understands. */
export type PermissionEffect = 'allow' | 'deny' | 'ask'

/**
 * One permission rule, in the runtime's `action`/`resource`/`effect` shape.
 * `resource` is the glob the action applies to; a bare `bash: deny` becomes
 * `resource: '*'`.
 */
export interface PermissionRule {
  action: string
  resource: string
  effect: PermissionEffect
}

/** A model reference the runtime accepts on an agent. */
export interface AgentModelRef {
  providerID: string
  id: string
  variant?: string
}

/** One agent, as the runtime's agent config and as a markdown file see it. */
export interface AgentDefinition {
  id: string
  description: string
  mode: string
  system: string
  model?: AgentModelRef
  steps?: number
  permissions?: PermissionRule[]
}

/** A fleet role's model assignment (`assets/fleet.json#models[role]`). */
export interface FleetRoleModel {
  model: string
  variant?: string
}

/**
 * `assets/fleet.json` — the single place a role's model is changed.
 *
 * The string form of a role entry is accepted so a hand-edited fleet file
 * (`"coder": "opencode-go/deepseek-v4.1-flash"`) degrades to a working model
 * instead of an unusable roster.
 */
export interface FleetConfig {
  version?: number
  models?: Record<string, FleetRoleModel | string>
  defaults?: { fallbackModel?: string }
}

/** One line of evidence for the operator: never thrown, always reported. */
export interface RegisterAgentsResult {
  registered: string[]
  defaultAgent: string
  materialized: string[]
  registration: 'transform' | 'files' | 'none'
  warnings: string[]
}

/** The mutable agent object the runtime hands to an `update` callback. */
export interface MutableAgentConfig {
  /** Required by OpenCode 2.2's `Agent.Info`; the roster uses the id. */
  name?: string
  description?: string
  mode?: string
  system?: string
  model?: AgentModelRef
  steps?: number
  permissions?: PermissionRule[]
}

/** The editor the runtime hands to an `agent.transform` callback. */
export interface AgentEditor {
  update(id: string, apply: (agent: MutableAgentConfig) => void): void
  default(id: string): void
  get?(id: string): MutableAgentConfig | undefined
}

/** The part of `ctx` agent registration needs. Everything is optional. */
export interface AgentRegistrationContext {
  agent?: {
    transform?: (callback: (editor: AgentEditor) => unknown) => unknown
  }
}

/** Injectable seams for tests; production passes real fs and the real env. */
export interface RegisterAgentsOptions {
  env?: Record<string, string | undefined>
  /** Global config dir; defaults to `XDG_CONFIG_HOME/opencode` or `~/.config/opencode`. */
  configDir?: string | null
  /** @deprecated Migration compatibility only; never selects agent models. */
  fleet?: FleetConfig | null
  /**
   * Register through `ctx.agent.transform`. On by default for OpenCode 2.2+.
   * Set `false` to force the file fallback.
   */
  transform?: boolean
  /** Also materialize files. Off by default; the explicit fallback. */
  materialize?: boolean
  /** Set the runtime default agent. Off by default; the user's config owns it. */
  setDefault?: boolean
  /** Filesystem adapter for materialization (defaults to `node:fs`). */
  fs?: MaterializeFs
}

// ---------------------------------------------------------------------------
// Frontmatter parsing (no YAML dependency)
// ---------------------------------------------------------------------------

type FrontmatterNode = string | FrontmatterMap
interface FrontmatterMap {
  [key: string]: FrontmatterNode
}

function isMap(node: FrontmatterNode | undefined): node is FrontmatterMap {
  return typeof node === 'object' && node !== null
}

/** Strip one layer of matching YAML quotes. No escape gymnastics, no dependency. */
function unquote(value: string): string {
  if (value.length >= 2) {
    const first = value[0]
    const last = value[value.length - 1]
    if ((first === '"' || first === "'") && last === first) {
      return value.slice(1, -1)
    }
  }
  return value
}

function splitKeyValue(text: string): { key: string; value: string | null } | null {
  const colon = text.indexOf(':')
  if (colon <= 0) return null
  const key = text.slice(0, colon).trim()
  if (key.length === 0) return null
  const rest = text.slice(colon + 1).trim()
  return { key: unquote(key), value: rest.length === 0 ? null : unquote(rest) }
}

/**
 * Parse an indentation-structured block into nested maps.
 *
 * Indent depth is the only structure that matters, so the same parser handles
 * `permission` (three levels) and a plain key/value frontmatter (one level)
 * without special cases.
 */
function parseFrontmatterBlock(lines: readonly string[]): FrontmatterMap {
  const root: FrontmatterMap = {}
  const stack: Array<{ indent: number; map: FrontmatterMap }> = [
    { indent: -1, map: root },
  ]

  for (const raw of lines) {
    const line = raw.replace(/\t/g, '  ')
    const trimmed = line.trim()
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue

    const indent = line.length - line.trimStart().length
    const entry = splitKeyValue(trimmed)
    if (!entry) continue

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop()
    }
    const parent = stack[stack.length - 1].map

    if (entry.value === null) {
      const child: FrontmatterMap = {}
      parent[entry.key] = child
      stack.push({ indent, map: child })
    } else {
      parent[entry.key] = entry.value
    }
  }

  return root
}

/** Read a scalar frontmatter entry; a nested map is not a scalar. */
function scalar(map: FrontmatterMap, key: string): string | undefined {
  const value = map[key]
  return typeof value === 'string' ? value : undefined
}

/**
 * Split `provider/id` (optionally `provider/id#variant`) into the runtime's
 * model ref. A reference without a provider is not a model ref: returning
 * `undefined` lets registration fall back with a visible warning instead of
 * sending a provider-less model to the runtime.
 */
export function parseModelRef(
  reference: string | undefined,
  variant?: string,
): AgentModelRef | undefined {
  const raw = typeof reference === 'string' ? reference.trim() : ''
  if (raw.length === 0) return undefined

  const hash = raw.indexOf('#')
  const base = hash === -1 ? raw : raw.slice(0, hash)
  const inlineVariant = hash === -1 ? undefined : raw.slice(hash + 1)

  if ((hash !== -1 && (!inlineVariant || inlineVariant.includes('#'))) || /\s/.test(raw)) return undefined
  const slash = base.indexOf('/')
  if (slash <= 0 || slash === base.length - 1) return undefined

  const providerID = base.slice(0, slash).trim()
  const id = base.slice(slash + 1).trim()
  if (providerID.length === 0 || id.length === 0) return undefined

  const resolvedVariant = variant && variant.length > 0 ? variant : inlineVariant
  return resolvedVariant && resolvedVariant.length > 0
    ? { providerID, id, variant: resolvedVariant }
    : { providerID, id }
}

// ---------------------------------------------------------------------------
// Permission mapping
// ---------------------------------------------------------------------------

/**
 * Actions whose name the runtime already accepts unchanged. Everything not in
 * this set (other than the two aliases below) is an action the runtime would
 * reject, so it is dropped: a bad permission entry must not make the whole
 * agent unusable.
 */
export const PASSTHROUGH_PERMISSION_ACTIONS: ReadonlySet<string> = new Set([
  'read',
  'edit',
  'glob',
  'grep',
  'skill',
  'question',
  'webfetch',
  'websearch',
  'external_directory',
])

/** Source action name → runtime action name. */
export const PERMISSION_ACTION_ALIASES: Readonly<Record<string, string>> = {
  bash: 'shell',
  task: 'subagent',
}

/** The deny appended to every agent that may not read secrets directly. */
export const ENV_READ_DENY: Readonly<PermissionRule> = {
  action: 'read',
  resource: '**/.env*',
  effect: 'deny',
}

/**
 * Normalise an effect value. An unrecognised value becomes `ask`, never
 * `allow`: a typo in a permission file must not silently grant a capability.
 */
function normalizeEffect(value: string): PermissionEffect {
  const effect = value.trim().toLowerCase()
  if (effect === 'allow' || effect === 'deny' || effect === 'ask') return effect
  return 'ask'
}

function mapPermissionAction(source: string): string | null {
  if (source.startsWith('supervisor_')) return null
  const alias = PERMISSION_ACTION_ALIASES[source]
  if (alias) return alias
  return PASSTHROUGH_PERMISSION_ACTIONS.has(source) ? source : null
}

/**
 * Map a frontmatter `permission` block into runtime rules.
 *
 * OpenCode V2 evaluates the last matching rule. Preserve source order, with
 * broad defaults before exceptions, rather than sorting by effect (which
 * would put a broad allowance after the denials and accidentally permit it).
 */
export function mapPermissionBlock(block: FrontmatterMap | undefined): PermissionRule[] {
  if (!block) return []
  const rules: PermissionRule[] = []

  for (const [source, value] of Object.entries(block)) {
    const action = mapPermissionAction(source)
    if (!action) continue

    const actionRules: PermissionRule[] = []
    if (typeof value === 'string') {
      actionRules.push({ action, resource: '*', effect: normalizeEffect(value) })
    } else if (isMap(value)) {
      for (const [resource, effectValue] of Object.entries(value)) {
        if (typeof effectValue !== 'string') continue
        actionRules.push({
          action,
          resource,
          effect: normalizeEffect(effectValue),
        })
      }
    }

    rules.push(...actionRules)
  }

  return rules
}

// ---------------------------------------------------------------------------
// Markdown → AgentDefinition
// ---------------------------------------------------------------------------

/** Derive the agent id from a file name (`coder.md` / `/x/coder.md` → `coder`). */
function agentIdFromFileName(fileName: string): string {
  const base = fileName.replace(/\\/g, '/').split('/').pop() ?? fileName
  return base.endsWith('.md') ? base.slice(0, -3) : base
}

/** Trim the blank line(s) that separate the closing `---` from the prompt. */
function bodyToSystem(body: string): string {
  return body.replace(/^\n+/, '').trimEnd()
}

/**
 * Parse one agent markdown file.
 *
 * The `---` frontmatter block supplies the config; everything after the closing
 * delimiter is the system prompt, verbatim apart from the separator newlines.
 * A file without frontmatter (or with an unterminated one) is still usable as a
 * prompt-only agent, so this never throws.
 */
export function parseAgentMarkdown(fileName: string, markdown: string): AgentDefinition {
  const id = agentIdFromFileName(fileName)
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')

  let frontmatter: FrontmatterMap = {}
  let body = lines.join('\n')

  let opening = 0
  while (opening < lines.length && lines[opening].trim().length === 0) opening += 1

  if (opening < lines.length && lines[opening].trim() === '---') {
    const closing = lines.findIndex(
      (line, index) => index > opening && line.trim() === '---',
    )
    if (closing !== -1) {
      frontmatter = parseFrontmatterBlock(lines.slice(opening + 1, closing))
      body = lines.slice(closing + 1).join('\n')
    }
  }

  const modelMap = isMap(frontmatter.model) ? frontmatter.model : undefined
  const model = modelMap
    ? parseModelRef(`${scalar(modelMap, 'providerID') ?? ''}/${scalar(modelMap, 'model') ?? ''}`, scalar(modelMap, 'variant'))
    : parseModelRef(scalar(frontmatter, 'model'), scalar(frontmatter, 'variant'))

  const rawSteps = scalar(frontmatter, 'steps')
  const steps =
    rawSteps !== undefined && /^\d+$/.test(rawSteps.trim()) && Number.isSafeInteger(Number(rawSteps)) && Number(rawSteps) > 0
      ? Number(rawSteps.trim())
      : undefined

  const permissionBlock = isMap(frontmatter.permission)
    ? frontmatter.permission
    : isMap(frontmatter.permissions)
      ? frontmatter.permissions
      : undefined
  const permissions = mapPermissionBlock(permissionBlock)
  // Native V2 permissions are an ordered sequence, not the legacy map.
  const nativeLines = lines.slice(opening + 1, lines.findIndex((line, index) => index > opening && line.trim() === '---'))
  const start = nativeLines.findIndex((line) => /^permissions:\s*$/.test(line))
  if (start !== -1) {
    const rules: PermissionRule[] = []
    let current: Record<string, string> | undefined
    for (const line of nativeLines.slice(start + 1)) {
      if (line.trim() && !/^\s/.test(line)) break
      const match = line.match(/^\s*(?:-\s*)?(action|resource|effect):\s*(.*?)\s*$/)
      if (!match) continue
      if (/^\s*-/.test(line)) { current = {}; rules.push(current as unknown as PermissionRule) }
      if (current) current[match[1]] = unquote(match[2])
    }
    if (rules.length) {
      permissions.length = 0
      for (const rule of rules) {
        if (rule.action && rule.resource && ['allow', 'deny', 'ask'].includes(rule.effect)) permissions.push(rule)
      }
    }
  }

  // `conductor` may read `.env` to debug a run; every other agent is denied
  // secrets even if its file forgot the rule.
  const hasEnvRule = permissions.some(
    (rule) => rule.action === ENV_READ_DENY.action && rule.resource === ENV_READ_DENY.resource,
  )
  if (id !== DEFAULT_AGENT_ID && !hasEnvRule && start === -1) {
    permissions.push({ ...ENV_READ_DENY })
  }

  return {
    id,
    description: scalar(frontmatter, 'description') ?? '',
    mode: scalar(frontmatter, 'mode') ?? 'subagent',
    system: bodyToSystem(body),
    ...(model ? { model } : {}),
    ...(steps !== undefined ? { steps } : {}),
    ...(permissions.length > 0 ? { permissions } : {}),
  }
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

/**
 * Locate the package's `assets` directory from a module directory.
 *
 * Both layouts are supported: `<pkg>/src/index.ts` (assets one level up) and a
 * flattened mount where the module sits beside `assets/`. The probe file is the
 * marker, not the directory, so a stray empty `assets/` cannot win.
 */
export function resolveAssetsDir(moduleDir: string): string {
  const beside = join(moduleDir, 'assets')
  if (nodeFs.existsSync(join(beside, 'agents'))) return beside
  return join(moduleDir, '..', 'assets')
}

/**
 * Read `fleet.json`. A missing or malformed file returns `null` (the roster
 * still registers with the models its markdown declares); it never throws.
 */
export function loadFleetConfig(assetsDir: string): FleetConfig | null {
  try {
    const parsed: unknown = JSON.parse(nodeFs.readFileSync(join(assetsDir, 'fleet.json'), 'utf8'))
    if (typeof parsed !== 'object' || parsed === null) return null
    return parsed as FleetConfig
  } catch {
    return null
  }
}

/**
 * The directory the agent markdown files live in.
 *
 * `assetsDir` is the package's `assets/` root, where `agents/` sits beside
 * `fleet.json`; a directory that already contains the markdown (a fixture) is
 * used as-is.
 */
export function resolveAgentsDir(assetsDir: string): string {
  const nested = join(assetsDir, 'agents')
  return nodeFs.existsSync(nested) ? nested : assetsDir
}

/**
 * Load native Markdown defaults in deterministic filename order. The legacy
 * fleet argument is accepted for callers migrating away from it, never applied.
 */

export function loadAgentDefinitions(
  assetsDir: string,
  _fleet: FleetConfig | null = null,
): AgentDefinition[] {
  const agentsDir = resolveAgentsDir(assetsDir)
  const files = nodeFs
    .readdirSync(agentsDir)
    .filter((name) => name.endsWith('.md'))
    .sort()

  const definitions: AgentDefinition[] = []
  for (const file of files) {
    const markdown = nodeFs.readFileSync(join(agentsDir, file), 'utf8')
    const definition = parseAgentMarkdown(file, markdown)

    definitions.push(definition)
  }

  return definitions
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * The real filesystem adapter, also shared with the skill mirror in
 * `src/index.ts` (which needs the directory listing `MaterializeTreeFs` adds).
 */
export const nodeMaterializeFs: MaterializeTreeFs = {
  mkdirSync: (path, options) =>
    nodeFs.mkdirSync(path, options as nodeFs.MakeDirectoryOptions),
  writeFileSync: (path, data, options) =>
    nodeFs.writeFileSync(path, data, options as nodeFs.WriteFileOptions),
  renameSync: (from, to) => nodeFs.renameSync(from, to),
  readFileSync: (path, encoding) =>
    nodeFs.readFileSync(path, { encoding: encoding as BufferEncoding }),
  existsSync: (path) => nodeFs.existsSync(path),
  readdirSync: (path, options) =>
    nodeFs.readdirSync(path, options) as unknown as ReturnType<
      MaterializeTreeFs['readdirSync']
    >,
}

/** The config directory agent files live under, or `null` when HOME is unknown. */
export function resolveAgentConfigDir(
  env: Record<string, string | undefined>,
): string | null {
  const xdg = env.XDG_CONFIG_HOME
  if (typeof xdg === 'string' && xdg.length > 0) return join(xdg, 'opencode')
  const home = env.HOME
  if (typeof home === 'string' && home.length > 0) return join(home, '.config', 'opencode')
  return null
}

function describeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  const cleaned = raw.replace(/\s+/g, ' ').trim()
  return cleaned.length > 0 ? cleaned : 'unknown error'
}

export type AgentFieldSource = 'packaged-md' | 'native' | 'legacy-fleet' | 'absent'
export interface EffectiveAgentConfig {
  id: string
  description: string
  mode: string
  system: string
  model?: string
  variant?: string
  steps?: number
  permissions?: PermissionRule[]
  sources: Record<'description' | 'mode' | 'system' | 'model' | 'variant' | 'steps' | 'permissions', AgentFieldSource>
  warnings: string[]
}

/** Pure, allowlisted inspector. Native values must come from the host, not provider config. */
export function inspectAgentConfigs(definitions: readonly AgentDefinition[], native: Readonly<Record<string, MutableAgentConfig>> = {}): EffectiveAgentConfig[] {
  return definitions.map((definition) => {
    const host = native[definition.id]
    const pick = <K extends 'description' | 'mode' | 'system' | 'model' | 'steps' | 'permissions'>(key: K) => host ? host[key] : definition[key]
    const source = (key: 'description' | 'mode' | 'system' | 'model' | 'steps' | 'permissions'): AgentFieldSource =>
      host ? (host[key] !== undefined ? 'native' : 'absent') : definition[key] === undefined ? 'absent' : 'packaged-md'
    const model = pick('model') as AgentModelRef | undefined
    const warnings: string[] = []
    return {
      id: definition.id, description: pick('description') ?? '', mode: pick('mode') ?? '',
      system: pick('system') ?? '',
      ...(model ? { model: `${model.providerID}/${model.id}`, ...(model.variant ? { variant: model.variant } : {}) } : {}),
      ...(pick('steps') !== undefined ? { steps: pick('steps') as number } : {}),
      ...(pick('permissions') !== undefined ? { permissions: (pick('permissions') as PermissionRule[]).map(({action, resource, effect}) => ({action, resource, effect})) } : {}),
      sources: { description: source('description'), mode: source('mode'), system: source('system'), model: source('model'), variant: model?.variant ? source('model') : 'absent', steps: source('steps'), permissions: source('permissions') }, warnings,
    }
  })
}

/** Copy a definition onto the mutable object the runtime exposes. */
function applyDefinition(agent: MutableAgentConfig, definition: AgentDefinition): void {
  // OpenCode 2.2's Agent.Info requires a non-empty `name`; the id is the
  // stable machine name and the description carries the human-facing text.
  agent.name = definition.id
  agent.description = definition.description
  agent.mode = definition.mode
  agent.system = definition.system
  if (definition.model) {
    agent.model = { ...definition.model }
  }
  if (typeof definition.steps === 'number') {
    agent.steps = definition.steps
  }
  if (definition.permissions) {
    agent.permissions = definition.permissions.map((rule) => ({ ...rule }))
  }
}

/**
 * Register the roster.
 *
 * Runtime transforms are the default. Native agents already present in the
 * host are left unchanged; files are written only with explicit materialize.
 *
 * Never throws. Every failure is a `warnings` entry and the remaining work
 * continues: one agent the runtime refuses must not cost the other fourteen,
 * and a failed transform must not cost the file path.
 */
export async function registerAgents(
  ctx: AgentRegistrationContext | null | undefined,
  definitions: readonly AgentDefinition[],
  options: RegisterAgentsOptions = {},
): Promise<RegisterAgentsResult> {
  const warnings: string[] = []
  const registered: string[] = []
  const materialized: string[] = []

  // Kept as a compatibility input for explicit migration tools, never an authority.
  const resolved = [...definitions]

  const defaultAgent = resolved.some((definition) => definition.id === DEFAULT_AGENT_ID)
    ? DEFAULT_AGENT_ID
    : (resolved[0]?.id ?? DEFAULT_AGENT_ID)

  // (1) Runtime registration. This is the default path on OpenCode 2.2+:
  // `agent.transform` creates the roster in memory, so no files are written to
  // the user's global config.
  const useTransform = options.transform !== false
  if (useTransform) {
    try {
      const agent = ctx?.agent
      const transform = agent?.transform
      if (typeof transform !== 'function') {
        throw new Error('the runtime exposes no agent.transform')
      }

      await transform.call(agent, (editor: AgentEditor) => {
        if (typeof editor.get !== 'function') {
          warnings.push('agent.transform registration skipped: editor.get is unavailable; cannot safely detect existing native agents')
          return
        }
        for (const definition of resolved) {
          try {
            // Existing host agents are authoritative, including explicit empty values.
            // The host does not expose per-field configuration provenance here.
            if (editor.get(definition.id)) {
              registered.push(definition.id)
              continue
            }
            editor.update(definition.id, (target) => applyDefinition(target, definition))
            registered.push(definition.id)
          } catch (error) {
            warnings.push(
              `${definition.id}: agent.transform update failed: ${describeError(error)}`,
            )
          }
        }
        if (options.setDefault === true && resolved.length > 0) {
          try {
            if (typeof editor.default === 'function') editor.default(defaultAgent)
          } catch (error) {
            warnings.push(`default agent ${defaultAgent} not set: ${describeError(error)}`)
          }
        }
      })
    } catch (error) {
      warnings.push(`agent.transform registration failed: ${describeError(error)}`)
    }
  }

  // (2) Explicit file fallback. Off by default: the global config belongs to
  // the user, and duplicate agent files are what this migration removes.
  const env = options.env ?? process.env
  const enabled = options.materialize === true && env[NO_MATERIALIZE_ENV] !== '1'
  let materializedRoster = false

  if (enabled) {
    try {
      const configDir =
        options.configDir === undefined ? resolveAgentConfigDir(env) : options.configDir
      if (!configDir) {
        warnings.push('agent files not materialised: neither XDG_CONFIG_HOME nor HOME is set')
      } else {
        const written = materializeAgentFiles(
          resolved,
          join(configDir, 'agents'),
          options.fs ?? nodeMaterializeFs,
        )
        materialized.push(...written)
        materializedRoster = true
      }
    } catch (error) {
      warnings.push(`agent file materialisation failed: ${describeError(error)}`)
    }
  }

  // With the transform off, "registered" means the ids now available as files:
  // an idempotent second run writes nothing, but the roster is still installed.
  if (!useTransform && materializedRoster) {
    for (const definition of resolved) {
      if (typeof definition.id === 'string' && definition.id.length > 0) {
        registered.push(definition.id)
      }
    }
  }

  const registration: RegisterAgentsResult['registration'] =
    useTransform && registered.length > 0 ? 'transform' : materializedRoster ? 'files' : 'none'

  return { registered, defaultAgent, materialized, registration, warnings }
}
