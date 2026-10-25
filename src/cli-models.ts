// Pure parsing + execution for the `models` / `agents` CLI command
// groups. No process spawning, no process.exit — cli.ts owns dispatch,
// output, and exit codes so every function here stays testable.

import { AGENT_ROLES } from './types'
import type { AgentRole } from './types'
import {
  MAX_STEPS_PER_ROLE,
  MIN_STEPS_PER_ROLE,
  attemptFleetSelection,
  buildModelRegistry,
  loadFleetConfig,
  resolveFleetConfigPath,
  saveFleetConfig,
} from './fleet-config'
import type { FleetConfig } from './fleet-config'
import { formatSelectionRungs, roleToSlot } from './model-router'
import type { ModelEntry, ModelRegistry } from './model-router'
import { syncAgentsFromConfig } from './fleet-sync'

export type CliResult<T> = { ok: true; value: T } | { ok: false; error: string }

const VARIANT_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

// --- Command shapes ---

export type ModelsCommand =
  | { action: 'list' }
  | { action: 'set'; role: string; model: string; variant?: string }
  | { action: 'reset'; role: string }
  | { action: 'enable'; model: string }
  | { action: 'disable'; model: string }
  | { action: 'sync-agents'; agentsDir?: string }

export type AgentsCommand =
  | { action: 'list' }
  | { action: 'set-steps'; role: string; steps: number }
  | { action: 'reset'; role: string }

// --- Tokenizer ---

interface Tokens {
  positionals: string[]
  flags: Record<string, string>
}

function tokenize(tokens: string[], allowedFlags: readonly string[]): CliResult<Tokens> {
  const positionals: string[] = []
  const flags: Record<string, string> = {}
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (!token.startsWith('--')) {
      positionals.push(token)
      continue
    }
    if (!(allowedFlags as readonly string[]).includes(token)) {
      return { ok: false, error: `unknown flag '${token}'` }
    }
    const value = tokens[i + 1]
    if (value === undefined || value.startsWith('--')) {
      return { ok: false, error: `flag '${token}' requires a value` }
    }
    flags[token] = value
    i++
  }
  return { ok: true, value: { positionals, flags } }
}

function expectPositionals(subcommand: string, got: number, want: number): string | null {
  return got === want
    ? null
    : `'${subcommand}' expects ${want} argument${want === 1 ? '' : 's'}, got ${got}`
}

// --- Parsers ---

/** Parse tokens following `cli.ts models ...` (the top word excluded). */
export function parseModelsArgs(argv: string[]): CliResult<ModelsCommand> {
  const subcommand = argv[0]
  if (subcommand === undefined) {
    return {
      ok: false,
      error:
        "missing subcommand (expected: list | set <role> <model> [--variant v] | reset <role> | enable <model-id> | disable <model-id> | sync-agents [--agents-dir dir])",
    }
  }

  switch (subcommand) {
    case 'list': {
      if (argv.length > 1) return { ok: false, error: `'list' takes no arguments` }
      return { ok: true, value: { action: 'list' } }
    }

    case 'set': {
      const tokens = tokenize(argv.slice(1), ['--variant'])
      if (!tokens.ok) return tokens
      const problem =
        tokens.value.flags['--variant'] !== undefined && tokens.value.positionals.length !== 2
          ? `'set' expects exactly 2 arguments (role, model)`
          : expectPositionals('set', tokens.value.positionals.length, 2)
      if (problem) return { ok: false, error: problem }
      const [role, model] = tokens.value.positionals
      const variant = tokens.value.flags['--variant']
      return {
        ok: true,
        value: { action: 'set', role, model, ...(variant !== undefined ? { variant } : {}) },
      }
    }

    case 'reset': {
      const problem = expectPositionals('reset', argv.length - 1, 1)
      if (problem) return { ok: false, error: problem }
      return { ok: true, value: { action: 'reset', role: argv[1] } }
    }

    case 'enable':
    case 'disable': {
      const problem = expectPositionals(subcommand, argv.length - 1, 1)
      if (problem) return { ok: false, error: problem }
      return { ok: true, value: { action: subcommand, model: argv[1] } }
    }

    case 'sync-agents': {
      const tokens = tokenize(argv.slice(1), ['--agents-dir'])
      if (!tokens.ok) return tokens
      if (tokens.value.positionals.length > 0) {
        return { ok: false, error: `'sync-agents' takes no positional arguments` }
      }
      return {
        ok: true,
        value: { action: 'sync-agents', agentsDir: tokens.value.flags['--agents-dir'] },
      }
    }

    default:
      return { ok: false, error: `unknown 'models' subcommand '${subcommand}'` }
  }
}

/** Parse tokens following `cli.ts agents ...` (the top word excluded). */
export function parseAgentsArgs(argv: string[]): CliResult<AgentsCommand> {
  const subcommand = argv[0]
  if (subcommand === undefined) {
    return {
      ok: false,
      error: "missing subcommand (expected: list | set-steps <role> <n> | reset <role>)",
    }
  }

  switch (subcommand) {
    case 'list': {
      if (argv.length > 1) return { ok: false, error: `'list' takes no arguments` }
      return { ok: true, value: { action: 'list' } }
    }

    case 'set-steps': {
      const problem = expectPositionals('set-steps', argv.length - 1, 2)
      if (problem) return { ok: false, error: problem }
      const [role, rawSteps] = [argv[1], argv[2]]
      const steps = Number(rawSteps)
      if (
        !Number.isInteger(steps) ||
        steps < MIN_STEPS_PER_ROLE ||
        steps > MAX_STEPS_PER_ROLE
      ) {
        return {
          ok: false,
          error: `steps must be an integer between ${MIN_STEPS_PER_ROLE} and ${MAX_STEPS_PER_ROLE}, got '${rawSteps}'`,
        }
      }
      return { ok: true, value: { action: 'set-steps', role, steps } }
    }

    case 'reset': {
      const problem = expectPositionals('reset', argv.length - 1, 1)
      if (problem) return { ok: false, error: problem }
      return { ok: true, value: { action: 'reset', role: argv[1] } }
    }

    default:
      return { ok: false, error: `unknown 'agents' subcommand '${subcommand}'` }
  }
}

// --- Shared execution helpers ---

export interface FleetCliOptions {
  /** Explicit config path; falls back to FLEET_CONFIG_PATH / default. */
  configPath?: string
}

interface FleetState {
  configPath: string
  config: FleetConfig
  registry: ModelRegistry
}

function loadState(options: FleetCliOptions): FleetState {
  const configPath = resolveFleetConfigPath(options.configPath)
  const config = loadFleetConfig(configPath)
  const registry = buildModelRegistry(config)
  return { configPath, config, registry }
}

interface RoleAssignment {
  key: string | null
  variant: string | undefined
  source: 'role-override' | 'slot-default' | 'scored'
  /** One-line `family=… rungN=… taken|skipped` audit of the walk. */
  rungs: string
}

/**
 * Effective assignment per fleet precedence. Runs the real selection engine
 * (role override > slot default > within-family rung walk) instead of
 * re-deriving it, so what `models list` prints is what the router does.
 */
function resolveRoleAssignment(state: FleetState, role: AgentRole): RoleAssignment {
  const attempt = attemptFleetSelection(state.registry, state.config, role)
  const selection = attempt.selection
  const source: RoleAssignment['source'] =
    selection?.reason === 'role_override'
      ? 'role-override'
      : selection?.reason === 'slot_default'
        ? 'slot-default'
        : 'scored'
  return {
    key: selection?.key ?? null,
    variant: selection?.variant,
    source,
    rungs: formatSelectionRungs(attempt),
  }
}

function circuitLabel(entry: ModelEntry): string {
  if (entry.circuitBreakerOpen) return `OPEN(x${entry.consecutiveFailures})`
  if (!entry.healthy) return `unhealthy(x${entry.consecutiveFailures})`
  return 'healthy'
}

function formatTable(headers: string[], rows: string[][]): string[] {
  const widths = headers.map((header, col) =>
    Math.max(header.length, ...rows.map((row) => (row[col] ?? '').length)),
  )
  const renderRow = (cells: string[]) =>
    cells.map((cell, col) => (cell ?? '').padEnd(widths[col])).join('  ').trimEnd()
  return [renderRow(headers), ...rows.map(renderRow)]
}

function assertKnownRole(role: string): CliResult<AgentRole> {
  if (!(AGENT_ROLES as readonly string[]).includes(role)) {
    return {
      ok: false,
      error: `unknown agent role '${role}' (valid roles: ${AGENT_ROLES.join(', ')})`,
    }
  }
  return { ok: true, value: role as AgentRole }
}

function assertKnownModel(state: FleetState, ref: string): CliResult<ModelEntry> {
  const entry = state.registry[ref]
  if (!entry) {
    return {
      ok: false,
      error: `unknown model '${ref}' (run 'models list' to see available models)`,
    }
  }
  return { ok: true, value: entry }
}

/**
 * Mutate a draft copy and persist it through the atomic save path.
 * Validation happens BEFORE this is called; saveFleetConfig re-validates
 * before writing anything, so failures leave the file untouched.
 */
function mutateConfig(
  state: FleetState,
  mutate: (draft: FleetConfig) => void,
): void {
  const draft = JSON.parse(JSON.stringify(state.config)) as FleetConfig
  mutate(draft)
  saveFleetConfig(state.configPath, draft)
  state.config = draft
  state.registry = buildModelRegistry(draft)
}

// --- Renderers ---

function renderModelsList(state: FleetState): string[] {
  const modelRows = Object.entries(state.registry).map(([key, entry]) => [
    key,
    entry.providerId,
    entry.modelFamily,
    String(entry.contextLimit),
    entry.costPer1kTokens === null ? '-' : `$${entry.costPer1kTokens}`,
    entry.enabled === false ? 'disabled' : 'enabled',
    entry.variant ?? '-',
    circuitLabel(entry),
  ])
  const lines = ['MODELS', ...formatTable(
    ['KEY', 'PROVIDER', 'FAMILY', 'CONTEXT', 'COST/1K', 'STATUS', 'VARIANT', 'CIRCUIT'],
    modelRows,
  ), '', 'AGENT ROLE ASSIGNMENTS']

  const assignments = (AGENT_ROLES as readonly AgentRole[]).map((role) => ({
    role,
    assignment: resolveRoleAssignment(state, role),
  }))
  lines.push(...formatTable(
    ['ROLE', 'SLOT', 'EFFECTIVE MODEL', 'VARIANT', 'SOURCE', 'STEPS'],
    assignments.map(({ role, assignment }) => [
      role,
      roleToSlot(role),
      assignment.key ?? '(none)',
      assignment.variant ?? '-',
      assignment.source,
      state.config.steps?.[role] === undefined
        ? 'default'
        : String(state.config.steps[role]),
    ]),
  ))

  // Rung audit: which rung served each role and which were skipped, so the
  // routing decision is reviewable instead of implicit.
  lines.push('', 'SELECTION RUNGS')
  const width = Math.max(...assignments.map(({ role }) => role.length))
  for (const { role, assignment } of assignments) {
    lines.push(`${role.padEnd(width)}  ${assignment.rungs}`)
  }
  return lines
}

function renderAgentsList(state: FleetState): string[] {
  const rows = (AGENT_ROLES as readonly AgentRole[]).map((role) => {
    const override = state.config.agentOverrides[role]
    const stepsOverride = state.config.steps?.[role]
    return [
      role,
      stepsOverride === undefined ? 'default' : String(stepsOverride),
      override ? override.modelRef : '-',
    ]
  })
  return formatTable(['ROLE', 'STEPS', 'MODEL OVERRIDE'], rows)
}

// --- Executors ---

/** Execute a parsed `models` command. Returns user-facing output lines. */
export function runModelsCommand(
  command: ModelsCommand,
  options: FleetCliOptions = {},
): CliResult<string[]> {
  const state = loadState(options)

  switch (command.action) {
    case 'list':
      return { ok: true, value: renderModelsList(state) }

    case 'set': {
      const role = assertKnownRole(command.role)
      if (!role.ok) return role
      const model = assertKnownModel(state, command.model)
      if (!model.ok) return model
      if (command.variant !== undefined && !VARIANT_TOKEN.test(command.variant)) {
        return {
          ok: false,
          error: `invalid variant '${command.variant}' (expected a token matching ${VARIANT_TOKEN})`,
        }
      }
      mutateConfig(state, (draft) => {
        draft.agentOverrides[role.value] = {
          modelRef: command.model,
          ...(command.variant !== undefined ? { variant: command.variant } : {}),
        }
      })
      return {
        ok: true,
        value: [
          `${role.value}: model -> ${command.model}${command.variant !== undefined ? ` (variant: ${command.variant})` : ''} saved`,
        ],
      }
    }

    case 'reset': {
      const role = assertKnownRole(command.role)
      if (!role.ok) return role
      const existed = state.config.agentOverrides[role.value] !== undefined
      mutateConfig(state, (draft) => {
        delete draft.agentOverrides[role.value]
      })
      return {
        ok: true,
        value: [
          existed
            ? `${role.value}: model override cleared`
            : `${role.value}: no model override existed (nothing to clear)`,
        ],
      }
    }

    case 'enable':
    case 'disable': {
      const model = assertKnownModel(state, command.model)
      if (!model.ok) return model
      const enabled = command.action === 'enable'
      mutateConfig(state, (draft) => {
        draft.models[command.model] = { enabled }
      })
      return {
        ok: true,
        value: [`${command.model}: ${enabled ? 'enabled' : 'disabled'}`],
      }
    }

    case 'sync-agents': {
      const outcome = syncAgentsFromConfig({
        configPath: options.configPath,
        agentsDir: command.agentsDir,
      })
      if (outcome.ok) return { ok: true, value: outcome.lines }
      // Keep the concise first-line error plus the per-role summary lines.
      const detail = [...outcome.lines, outcome.error].filter(Boolean).join('\n')
      return { ok: false, error: detail }
    }
  }
}

/** Execute a parsed `agents` command. Returns user-facing output lines. */
export function runAgentsCommand(
  command: AgentsCommand,
  options: FleetCliOptions = {},
): CliResult<string[]> {
  const state = loadState(options)

  switch (command.action) {
    case 'list':
      return { ok: true, value: renderAgentsList(state) }

    case 'set-steps': {
      const role = assertKnownRole(command.role)
      if (!role.ok) return role
      mutateConfig(state, (draft) => {
        draft.steps ??= {}
        draft.steps[role.value] = command.steps
      })
      return {
        ok: true,
        value: [`${role.value}: steps -> ${String(command.steps)} saved`],
      }
    }

    case 'reset': {
      const role = assertKnownRole(command.role)
      if (!role.ok) return role
      const existed = state.config.steps?.[role.value] !== undefined
      mutateConfig(state, (draft) => {
        if (draft.steps) delete draft.steps[role.value]
      })
      return {
        ok: true,
        value: [
          existed
            ? `${role.value}: steps override cleared (agent default applies)`
            : `${role.value}: no steps override existed (nothing to clear)`,
        ],
      }
    }
  }
}
