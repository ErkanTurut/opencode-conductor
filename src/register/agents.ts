// Agent roster registration for the global plugin entry.
//
// Two things are true at once, and this module is built around the pair:
//
//   1. A plugin *can* create an agent by calling `editor.update(id, mutate)`
//      with an id that does not exist yet. That is observed behaviour of the
//      runtime, not a documented API (see `runtime/compat.ts`'s probe and
//      `tests/probes/agent-transform-probe.ts`). On OpenCode 2.1.3 it is not
//      used by default: the transform reshapes config reads (commands fail
//      `Command.list` schema validation) and keeps re-writing the watched
//      config directory. It stays available behind `transform: true` for
//      tests and experiments.
//   2. A V2 agent file in the user's global `opencode/agents/` directory is
//      the documented, restart-proof way to define an agent. Files are the
//      registration path, and `materializeAgentFiles` skips unchanged files so
//      a run costs no writes.
//
// Nothing here throws — a failure is a warning, because an agent roster is an
// enhancement and must never take the supervisor's tools down with it.
//
// The roster itself lives in `assets/agents/*.md` (verbatim copies of the
// project's agent definitions) and the role→model mapping lives in
// `assets/fleet.json`, so a model change is a one-line edit in one file.
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
  warnings: string[]
}

/** The mutable agent object the runtime hands to an `update` callback. */
export interface MutableAgentConfig {
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
  /** The fleet whose models/fallback decide the unknown-model policy. */
  fleet?: FleetConfig | null
  /**
   * Register through `ctx.agent.transform` as well. Off by default: on
   * OpenCode 2.1.3 the transform destabilises the config location (commands
   * fail `Command.list` schema validation, and writes into the watched config
   * directory cause reload storms), so files are the registration path. The
   * code is kept for tests and experiments.
   */
  transform?: boolean
  /** Disable file materialization (the env switch also disables it). */
  materialize?: boolean
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

const EFFECT_ORDER: Readonly<Record<PermissionEffect, number>> = {
  deny: 0,
  ask: 1,
  allow: 2,
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
 * Within one action the runtime evaluates the first match, so the order
 * matters: `deny` before `ask` before `allow`, preserving the file's order
 * inside each effect group. That makes the narrow denial (`git push*: deny`)
 * win over the broad allowance (`*: allow`) regardless of how the block was
 * written.
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

    // `Array.prototype.sort` is stable, so equal effects keep file order.
    actionRules.sort((left, right) => EFFECT_ORDER[left.effect] - EFFECT_ORDER[right.effect])
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

  const model = parseModelRef(scalar(frontmatter, 'model'), scalar(frontmatter, 'variant'))

  const rawSteps = scalar(frontmatter, 'steps')
  const steps =
    rawSteps !== undefined && /^\d+$/.test(rawSteps.trim())
      ? Number(rawSteps.trim())
      : undefined

  const permissionBlock = isMap(frontmatter.permission)
    ? frontmatter.permission
    : isMap(frontmatter.permissions)
      ? frontmatter.permissions
      : undefined
  const permissions = mapPermissionBlock(permissionBlock)

  // `conductor` may read `.env` to debug a run; every other agent is denied
  // secrets even if its file forgot the rule.
  const hasEnvRule = permissions.some(
    (rule) => rule.action === ENV_READ_DENY.action && rule.resource === ENV_READ_DENY.resource,
  )
  if (id !== DEFAULT_AGENT_ID && !hasEnvRule) {
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
  if (nodeFs.existsSync(join(beside, 'fleet.json'))) return beside
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
 * Load every agent definition from `assetsDir` and apply the fleet's model
 * overrides by id. Deterministic order (file name), so registration and the
 * materialised file set are stable between runs.
 */
export function loadAgentDefinitions(
  assetsDir: string,
  fleet: FleetConfig | null = null,
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

    const entry = fleet?.models?.[definition.id]
    if (entry !== undefined) {
      const reference = typeof entry === 'string' ? entry : entry.model
      const variant = typeof entry === 'string' ? undefined : entry.variant
      const override = parseModelRef(reference, variant)
      if (override) {
        definition.model = override
      } else {
        delete definition.model
      }
    }

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

/** Every model and provider the fleet knows about. */
function fleetKnowledge(fleet: FleetConfig | null): {
  providers: Set<string>
  models: Set<string>
} {
  const providers = new Set<string>()
  const models = new Set<string>()

  for (const entry of Object.values(fleet?.models ?? {})) {
    const reference =
      typeof entry === 'string' ? entry : typeof entry?.model === 'string' ? entry.model : undefined
    const parsed = parseModelRef(reference)
    if (!parsed) continue
    providers.add(parsed.providerID)
    models.add(`${parsed.providerID}/${parsed.id}`)
  }

  const fallback = parseModelRef(fleet?.defaults?.fallbackModel)
  if (fallback) providers.add(fallback.providerID)

  return { providers, models }
}

/**
 * Decide a definition's effective model.
 *
 * A model the fleet does not know and whose provider the fleet does not know is
 * almost certainly a typo or a provider this install has no credentials for, so
 * it is replaced by `defaults.fallbackModel` and reported. A known provider
 * with an unlisted model is left alone: the fleet is a role map, not an
 * exhaustive model catalogue.
 */
function resolveModel(
  definition: AgentDefinition,
  fleet: FleetConfig | null,
  warnings: string[],
): AgentDefinition {
  const fallback = parseModelRef(fleet?.defaults?.fallbackModel)
  const fallbackRef = fallback ? `${fallback.providerID}/${fallback.id}` : null

  if (!definition.model) {
    if (!fallback) {
      warnings.push(`${definition.id}: no model declared and the fleet has no fallback model`)
      return definition
    }
    warnings.push(
      `${definition.id}: no model declared; using the fleet fallback ${fallbackRef}`,
    )
    return { ...definition, model: fallback }
  }

  const known = fleetKnowledge(fleet)
  const reference = `${definition.model.providerID}/${definition.model.id}`
  if (known.models.has(reference) || known.providers.has(definition.model.providerID)) {
    return definition
  }

  if (!fallback) {
    warnings.push(
      `${definition.id}: unknown model ${reference} and the fleet has no fallback model`,
    )
    return definition
  }

  warnings.push(
    `${definition.id}: unknown model ${reference}; using the fleet fallback ${fallbackRef}`,
  )
  return { ...definition, model: fallback }
}

/** Copy a definition onto the mutable object the runtime exposes. */
function applyDefinition(agent: MutableAgentConfig, definition: AgentDefinition): void {
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
 * Files are the registration path: by default the roster is materialised as V2
 * markdown and no runtime transform runs. `transform: true` additionally
 * registers through `ctx.agent.transform` (kept for tests/experiments; it
 * destabilises the config location on OpenCode 2.1.3).
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

  const fleet = options.fleet ?? null
  const resolved = definitions.map((definition) => resolveModel(definition, fleet, warnings))

  const defaultAgent = resolved.some((definition) => definition.id === DEFAULT_AGENT_ID)
    ? DEFAULT_AGENT_ID
    : (resolved[0]?.id ?? DEFAULT_AGENT_ID)

  // (1) Optional runtime registration. Off by default: the transform is the
  // path that reshapes the runtime's config reads on 2.1.3. The callback is
  // synchronous; a returned promise is awaited.
  const useTransform = options.transform === true
  if (useTransform) {
    try {
      const agent = ctx?.agent
      const transform = agent?.transform
      if (typeof transform !== 'function') {
        throw new Error('the runtime exposes no agent.transform')
      }

      await transform.call(agent, (editor: AgentEditor) => {
        for (const definition of resolved) {
          try {
            editor.update(definition.id, (target) => applyDefinition(target, definition))
            registered.push(definition.id)
          } catch (error) {
            warnings.push(
              `${definition.id}: agent.transform update failed: ${describeError(error)}`,
            )
          }
        }
        if (resolved.length > 0) {
          try {
            editor.default(defaultAgent)
          } catch (error) {
            warnings.push(`default agent ${defaultAgent} not set: ${describeError(error)}`)
          }
        }
      })
    } catch (error) {
      warnings.push(`agent.transform registration failed: ${describeError(error)}`)
    }
  }

  // (2) The registration path. Always on unless explicitly disabled.
  const env = options.env ?? process.env
  const enabled = options.materialize !== false && env[NO_MATERIALIZE_ENV] !== '1'
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

  return { registered, defaultAgent, materialized, warnings }
}
