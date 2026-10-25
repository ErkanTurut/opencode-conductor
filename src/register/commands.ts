// Conductor commands for the global plugin entry.
//
// Five slash commands, registered through `ctx.command.transform(editor =>
// editor.add({ name, description, execute }))`:
//
//   /conductor:run      start a supervised run (asks for the objective if none)
//   /conductor:status   summarise the newest run: state, tasks, leases, blockers
//   /conductor:receipt  write and summarise the newest run's receipt
//   /conductor:trust    grant trust for this project (no model call)
//   /conductor:doctor   runtime + agent + state diagnosis (no model call)
//
// The first three hand a precise instruction to the session model; the last two
// answer locally and deliver the text with `ctx.session.synthetic`, so a broken
// runtime or an untrusted folder never depends on a model to be diagnosable —
// which is exactly the state those two commands exist to report.
//
// Registration never throws: a command is an enhancement, and a runtime that
// refuses the transform must not take the supervisor's tools down with it.
//
// Import note: imports are extensionless because the package's `tsc --noEmit`
// baseline rejects `.ts`-suffixed specifiers (TS5097). Bun resolves the
// extensionless specifier at runtime.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  formatDoctorReport,
  probeRuntime,
  selectAgentRegistrationPath,
  type AgentProbeReport,
  type RuntimeProbe,
  type RuntimeProbeEnv,
} from '../runtime/compat'
import { resolveStateLayout } from '../runtime/state-layout'
import { grantTrust, type TrustCode } from '../runtime/trust'

/** The five command names, in registration order. */
export const COMMAND_NAMES = [
  'conductor:run',
  'conductor:status',
  'conductor:receipt',
  'conductor:trust',
  'conductor:doctor',
] as const

export type CommandName = (typeof COMMAND_NAMES)[number]

/** Exact instruction for `/conductor:status`. */
export const STATUS_INSTRUCTION =
  'Call supervisor_get_status for the most recent run in this project and summarise state, tasks, leases and blockers.'

/** Exact instruction for `/conductor:receipt`. */
export const RECEIPT_INSTRUCTION =
  'Call supervisor_generate_receipt for the most recent run and summarise the outcome, changed files and open findings.'

/** Exact prefix for `/conductor:run`; the objective follows the colon. */
export const RUN_INSTRUCTION_PREFIX =
  'Load the supervisor-orchestrate skill and start a supervised run'

/**
 * Instruction for `/conductor:run`.
 *
 * An empty prompt must not start a supervised run against an invented
 * objective: the conductor is told to interview the user first.
 */
export function runInstruction(objective: string): string {
  const trimmed = objective.trim()
  if (trimmed.length === 0) {
    return `${RUN_INSTRUCTION_PREFIX}. No objective was supplied: ask the user for the objective before starting anything.`
  }
  return `${RUN_INSTRUCTION_PREFIX} for: ${trimmed}`
}

/** The model-facing prompt a command hands to `ctx.session.prompt`. */
export interface CommandPrompt {
  text?: string
}

/** `execute` input as the runtime supplies it. */
export interface CommandExecuteInput {
  sessionID: string
  prompt?: CommandPrompt
  delivery?: unknown
}

/** One command, in the shape the runtime's command editor accepts. */
export interface CommandDefinition {
  name: CommandName | string
  description: string
  execute(input: CommandExecuteInput): Promise<void> | void
}

/** The editor the runtime hands to a `command.transform` callback. */
export interface CommandEditor {
  add(definition: CommandDefinition): void
}

/** The session calls the commands make. Everything is optional. */
export interface SessionApi {
  prompt?: (input: { sessionID: string; text: string; delivery?: unknown }) => unknown
  synthetic?: (input: { sessionID: string; text: string }) => unknown
}

/** The part of `ctx` command registration needs. */
export interface CommandRegistrationContext {
  command?: {
    transform?: (callback: (editor: CommandEditor) => unknown) => unknown
  }
  session?: SessionApi
}

/** Injectable seams: production passes the resolved project and the real env. */
export interface RegisterCommandsOptions {
  /** Project the commands act on; defaults to the process cwd. */
  projectRoot?: string
  /** Package assets root (the probe report lives in `compat/`). */
  assetsDir?: string
  /** Environment for trust/state resolution; defaults to `process.env`. */
  env?: RuntimeProbeEnv
  /** Explicit trust config path; overrides env discovery (tests). */
  configPath?: string
  /** Agent-roster warnings to include in the doctor report. */
  agentWarnings?: readonly string[]
  /** Runtime probe override (tests); defaults to the real probe. */
  probe?: (env: RuntimeProbeEnv) => Promise<RuntimeProbe>
}

/** One line of evidence for the operator: never thrown, always reported. */
export interface RegisterCommandsResult {
  registered: string[]
  warnings: string[]
}

function describeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  const cleaned = raw.replace(/\s+/g, ' ').trim()
  return cleaned.length > 0 ? cleaned : 'unknown error'
}

// ---------------------------------------------------------------------------
// Runtime access
// ---------------------------------------------------------------------------

function requirePrompt(ctx: CommandRegistrationContext | null | undefined) {
  const prompt = ctx?.session?.prompt
  if (typeof prompt !== 'function') {
    throw new Error('the runtime exposes no session.prompt')
  }
  return prompt.bind(ctx?.session)
}

function requireSynthetic(ctx: CommandRegistrationContext | null | undefined) {
  const synthetic = ctx?.session?.synthetic
  if (typeof synthetic !== 'function') {
    throw new Error('the runtime exposes no session.synthetic')
  }
  return synthetic.bind(ctx?.session)
}

/**
 * Ask the session model to act. `delivery` is forwarded untouched: it is the
 * runtime's decision whether the instruction starts a turn or queues behind the
 * one in flight.
 */
function promptModel(
  ctx: CommandRegistrationContext | null | undefined,
  input: CommandExecuteInput,
  text: string,
): Promise<void> {
  const prompt = requirePrompt(ctx)
  return Promise.resolve(
    prompt({ sessionID: input.sessionID, text, delivery: input.delivery }),
  ).then(() => undefined)
}

/** Deliver locally produced text to the session without a model call. */
function sendSynthetic(
  ctx: CommandRegistrationContext | null | undefined,
  input: CommandExecuteInput,
  text: string,
): Promise<void> {
  const synthetic = requireSynthetic(ctx)
  return Promise.resolve(
    synthetic({ sessionID: input.sessionID, text }),
  ).then(() => undefined)
}

// ---------------------------------------------------------------------------
// Trust
// ---------------------------------------------------------------------------

/** Plain-language reason for a denial; the code alone is not an explanation. */
const TRUST_DENIAL_REASONS: Readonly<Record<Exclude<TrustCode, 'trusted'>, string>> = {
  no_config: 'there is no trust config for this user yet',
  not_granted: 'no grant in the trust config matches this project path',
  revoked: 'the grant for this project path was revoked',
  malformed_config: 'the trust config is not readable as a trust section',
  io_error: 'the trust config could not be read or written',
}

/** The synthetic text `/conductor:trust` delivers. */
function formatTrustDecision(decision: ReturnType<typeof grantTrust>): string {
  const lines = [decision.message]
  if (!decision.trusted) {
    const reason =
      decision.code === 'trusted'
        ? 'the decision is not a grant'
        : TRUST_DENIAL_REASONS[decision.code]
    lines.push(`Why: ${reason} (${decision.code}).`)
  }
  lines.push(decision.hint)
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Doctor
// ---------------------------------------------------------------------------

/** The probe report the agent-registration path is selected from. */
export function readAgentProbeReport(assetsDir: string): AgentProbeReport | null {
  const path = join(assetsDir, 'compat', 'probe-report.json')
  if (!existsSync(path)) return null
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (typeof parsed !== 'object' || parsed === null) return null
    return parsed as AgentProbeReport
  } catch {
    return null
  }
}

/** Build the synthetic text `/conductor:doctor` delivers. */
export async function buildDoctorReport(options: {
  projectRoot: string
  assetsDir: string
  env: RuntimeProbeEnv
  agentWarnings: readonly string[]
  probe: (env: RuntimeProbeEnv) => Promise<RuntimeProbe>
}): Promise<string> {
  const probe = await options.probe(options.env)
  const registrationPath = selectAgentRegistrationPath(
    readAgentProbeReport(options.assetsDir),
  )
  const layout = resolveStateLayout({
    projectRoot: options.projectRoot,
    mode: 'auto',
    env: options.env,
  })

  const lines: string[] = [
    `conductor doctor — ${options.projectRoot}`,
    '',
    `runtime: ${probe.ok ? 'ok' : 'FAILED'}`,
    formatDoctorReport(probe),
    '',
    `agents: registration path ${registrationPath}`,
  ]
  if (options.agentWarnings.length === 0) {
    lines.push('agents: no registration warnings')
  } else {
    lines.push(`agents: ${options.agentWarnings.length} registration warning(s)`)
    for (const warning of options.agentWarnings) lines.push(`  - ${warning}`)
  }

  lines.push(
    '',
    'state:',
    `  mode: ${layout.mode}`,
    `  projectKey: ${layout.projectKey}`,
    `  ledgerPath: ${layout.ledgerPath}`,
    `  runsDir: ${layout.runsDir}`,
  )

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

function commandDefinitions(
  ctx: CommandRegistrationContext | null | undefined,
  options: RegisterCommandsOptions,
): CommandDefinition[] {
  const env = options.env ?? process.env
  const projectRoot = options.projectRoot ?? process.cwd()
  const assetsDir = options.assetsDir ?? join(import.meta.dir, '..', '..', 'assets')
  const agentWarnings = options.agentWarnings ?? []
  const probe = options.probe ?? probeRuntime

  return [
    {
      name: 'conductor:run',
      description: 'Start a supervised conductor run from an objective.',
      async execute(input) {
        await promptModel(ctx, input, runInstruction(input.prompt?.text ?? ''))
      },
    },
    {
      name: 'conductor:status',
      description: 'Summarise the most recent conductor run.',
      async execute(input) {
        await promptModel(ctx, input, STATUS_INSTRUCTION)
      },
    },
    {
      name: 'conductor:receipt',
      description: 'Generate the most recent conductor run receipt.',
      async execute(input) {
        await promptModel(ctx, input, RECEIPT_INSTRUCTION)
      },
    },
    {
      name: 'conductor:trust',
      description: 'Grant trust for this project so mutating tools may run.',
      async execute(input) {
        // Resolve the root at execution time so a moved checkout grants the
        // folder the command was actually typed in.
        const decision = grantTrust(projectRoot, {
          env,
          ...(options.configPath ? { configPath: options.configPath } : {}),
        })
        await sendSynthetic(ctx, input, formatTrustDecision(decision))
      },
    },
    {
      name: 'conductor:doctor',
      description: 'Diagnose the runtime, agent registration and state layout.',
      async execute(input) {
        const text = await buildDoctorReport({
          projectRoot,
          assetsDir,
          env,
          agentWarnings,
          probe,
        })
        await sendSynthetic(ctx, input, text)
      },
    },
  ]
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register the five conductor commands.
 *
 * Never throws. A missing transform, a throwing transform and a per-command
 * `add` failure are warnings; the remaining commands still register.
 */
export async function registerCommands(
  ctx: CommandRegistrationContext | null | undefined,
  options: RegisterCommandsOptions = {},
): Promise<RegisterCommandsResult> {
  const registered: string[] = []
  const warnings: string[] = []

  try {
    const command = ctx?.command
    const transform = command?.transform
    if (typeof transform !== 'function') {
      throw new Error('the runtime exposes no command.transform')
    }

    const definitions = commandDefinitions(ctx, options)
    await transform.call(command, (editor: CommandEditor) => {
      if (!editor || typeof editor.add !== 'function') {
        warnings.push('the command editor exposes no add()')
        return
      }
      for (const definition of definitions) {
        try {
          editor.add(definition)
          registered.push(definition.name)
        } catch (error) {
          warnings.push(
            `${definition.name}: command registration failed: ${describeError(error)}`,
          )
        }
      }
    })
  } catch (error) {
    warnings.push(`command.transform registration failed: ${describeError(error)}`)
  }

  return { registered, warnings }
}
