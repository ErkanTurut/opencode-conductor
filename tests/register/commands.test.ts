// The five conductor commands, registered through
// `ctx.command.transform(editor => editor.add({ name, description, execute }))`.
//
// What is pinned here:
//   1. all five names register, in order, with descriptions;
//   2. the three model commands prompt `session.prompt` with the exact
//      instruction `/conductor:run|status|receipt` must produce — and an empty
//      objective asks the user instead of inventing one;
//   3. `conductor:trust` and `conductor:doctor` answer locally via
//      `session.synthetic` (never a model call), with the trust grant landing in
//      the injected config path and the doctor report carrying the runtime, the
//      agent registration warnings, the registration path and the state layout;
//   4. registration is non-fatal: a throwing transform is a warning.
import { afterEach, describe, expect, it } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildDoctorReport,
  COMMAND_NAMES,
  RECEIPT_INSTRUCTION,
  registerCommands,
  runInstruction,
  STATUS_INSTRUCTION,
  type CommandDefinition,
  type CommandEditor,
  type CommandRegistrationContext,
} from '../../src/register/commands'
import { RUNTIME_REMEDIATION, type RuntimeProbe } from '../../src/runtime/compat'
import { setupConductor } from '../../src/index'
import { readProjectRecord } from '../../src/runtime/project'
import { projectKeyFor } from '../../src/runtime/state-layout'

const created: string[] = []

function tempDir(prefix = 'conductor-commands-'): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  created.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of created.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

interface PromptCall {
  sessionID: string
  text: string
  delivery?: unknown
}

interface SyntheticCall {
  sessionID: string
  text: string
}

interface Harness {
  ctx: CommandRegistrationContext
  definitions: CommandDefinition[]
  prompts: PromptCall[]
  synthetics: SyntheticCall[]
}

/** A runtime that records command registrations and session calls. */
function harness(): Harness {
  const definitions: CommandDefinition[] = []
  const prompts: PromptCall[] = []
  const synthetics: SyntheticCall[] = []

  const ctx: CommandRegistrationContext = {
    command: {
      transform(callback) {
        const editor: CommandEditor = {
          add(definition) {
            definitions.push(definition)
          },
        }
        callback(editor)
        return { dispose() {} }
      },
    },
    session: {
      prompt(input) {
        prompts.push(input)
      },
      synthetic(input) {
        synthetics.push(input)
      },
    },
  }

  return { ctx, definitions, prompts, synthetics }
}

const PASSING_PROBE: RuntimeProbe = {
  ok: true,
  checks: [{ name: 'bun-runtime', ok: true, detail: 'Bun 1.3.4' }],
  remediation: RUNTIME_REMEDIATION,
}

async function probePassing(): Promise<RuntimeProbe> {
  return PASSING_PROBE
}

function definition(harnessed: Harness, name: string): CommandDefinition {
  const found = harnessed.definitions.find((candidate) => candidate.name === name)
  if (!found) throw new Error(`command ${name} was not registered`)
  return found
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

describe('registerCommands', () => {
  it('registers the five conductor commands in order', async () => {
    const harnessed = harness()
    const result = await registerCommands(harnessed.ctx, {
      projectRoot: tempDir(),
      probe: probePassing,
    })

    expect(result.registered).toEqual([...COMMAND_NAMES])
    expect(result.warnings).toEqual([])
    expect(harnessed.definitions.map((entry) => entry.name)).toEqual([...COMMAND_NAMES])
    for (const entry of harnessed.definitions) {
      expect(entry.description.length).toBeGreaterThan(0)
      expect(typeof entry.execute).toBe('function')
    }
  })

  it('turns a throwing transform into a warning, never an exception', async () => {
    const failing: CommandRegistrationContext = {
      command: {
        transform() {
          throw new Error('runtime refused the command transform')
        },
      },
    }

    const result = await registerCommands(failing, { probe: probePassing })

    expect(result.registered).toEqual([])
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('command.transform')
    expect(result.warnings[0]).toContain('runtime refused the command transform')
  })

  it('reports a missing transform instead of throwing', async () => {
    const result = await registerCommands(null, { probe: probePassing })

    expect(result.registered).toEqual([])
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('no command.transform')
  })

  it('keeps the other commands when one add is refused', async () => {
    const definitions: string[] = []
    const partial: CommandRegistrationContext = {
      command: {
        transform(callback) {
          const editor: CommandEditor = {
            add(entry) {
              if (entry.name === 'conductor:receipt') throw new Error('duplicate command')
              definitions.push(entry.name)
            },
          }
          callback(editor)
        },
      },
    }

    const result = await registerCommands(partial, { probe: probePassing })

    expect(result.registered).toHaveLength(4)
    expect(result.registered).not.toContain('conductor:receipt')
    expect(definitions).toHaveLength(4)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('conductor:receipt')
  })
})

// ---------------------------------------------------------------------------
// Model commands: run / status / receipt
// ---------------------------------------------------------------------------

describe('model commands', () => {
  it('starts a run with the exact instruction and forwards the delivery', async () => {
    const harnessed = harness()
    await registerCommands(harnessed.ctx, { probe: probePassing })

    const delivery = { mode: 'queue' }
    await definition(harnessed, 'conductor:run').execute({
      sessionID: 'ses_run',
      prompt: { text: '  ship the conductor  ' },
      delivery,
    })

    expect(harnessed.synthetics).toEqual([])
    expect(harnessed.prompts).toHaveLength(1)
    expect(harnessed.prompts[0]).toEqual({
      sessionID: 'ses_run',
      text: 'Load the supervisor-orchestrate skill and start a supervised run for: ship the conductor',
      delivery,
    })
  })

  it('asks for the objective instead of starting an empty run', async () => {
    const harnessed = harness()
    await registerCommands(harnessed.ctx, { probe: probePassing })

    await definition(harnessed, 'conductor:run').execute({
      sessionID: 'ses_empty',
      prompt: { text: '   ' },
    })

    expect(harnessed.prompts).toHaveLength(1)
    expect(harnessed.prompts[0].text).toBe(runInstruction(''))
    expect(harnessed.prompts[0].text).toContain(
      'Load the supervisor-orchestrate skill and start a supervised run',
    )
    expect(harnessed.prompts[0].text).toContain('ask the user for the objective')
    expect(harnessed.prompts[0].text).not.toContain('for:')
  })

  it('prompts status with the exact supervisor_get_status instruction', async () => {
    const harnessed = harness()
    await registerCommands(harnessed.ctx, { probe: probePassing })

    await definition(harnessed, 'conductor:status').execute({ sessionID: 'ses_status' })

    expect(harnessed.synthetics).toEqual([])
    expect(harnessed.prompts).toEqual([
      { sessionID: 'ses_status', text: STATUS_INSTRUCTION, delivery: undefined },
    ])
    expect(STATUS_INSTRUCTION).toBe(
      'Call supervisor_get_status for the most recent run in this project and summarise state, tasks, leases and blockers.',
    )
  })

  it('prompts receipt with the exact supervisor_generate_receipt instruction', async () => {
    const harnessed = harness()
    await registerCommands(harnessed.ctx, { probe: probePassing })

    await definition(harnessed, 'conductor:receipt').execute({ sessionID: 'ses_receipt' })

    expect(harnessed.synthetics).toEqual([])
    expect(harnessed.prompts).toEqual([
      { sessionID: 'ses_receipt', text: RECEIPT_INSTRUCTION, delivery: undefined },
    ])
    expect(RECEIPT_INSTRUCTION).toBe(
      'Call supervisor_generate_receipt for the most recent run and summarise the outcome, changed files and open findings.',
    )
  })
})

// ---------------------------------------------------------------------------
// Local commands: trust / doctor
// ---------------------------------------------------------------------------

describe('conductor:trust', () => {
  it('grants trust into the injected config path and answers synthetically', async () => {
    const projectRoot = tempDir('conductor-trust-project-')
    const configDir = tempDir('conductor-trust-config-')
    const configPath = join(configDir, 'conductor.json')
    const harnessed = harness()

    await registerCommands(harnessed.ctx, {
      projectRoot,
      configPath,
      env: { HOME: configDir },
      probe: probePassing,
    })

    expect(existsSync(configPath)).toBe(false)
    await definition(harnessed, 'conductor:trust').execute({ sessionID: 'ses_trust' })

    // No model call: the command reports the decision itself.
    expect(harnessed.prompts).toEqual([])
    expect(harnessed.synthetics).toHaveLength(1)
    expect(harnessed.synthetics[0].sessionID).toBe('ses_trust')

    const text = harnessed.synthetics[0].text
    expect(text).toContain('is trusted')
    expect(text).toContain('mutating supervisor tools are enabled')
    expect(text).toContain('conductor.json')

    // The grant actually landed in the injected file.
    expect(existsSync(configPath)).toBe(true)
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
      trust?: { grants?: Array<{ path: string }> }
    }
    expect(config.trust?.grants?.map((grant) => grant.path)).toEqual([projectRoot])

    // A second run is idempotent: one grant, still trusted.
    await definition(harnessed, 'conductor:trust').execute({ sessionID: 'ses_trust_2' })
    const again = JSON.parse(readFileSync(configPath, 'utf8')) as {
      trust?: { grants?: Array<{ path: string }> }
    }
    expect(again.trust?.grants).toHaveLength(1)
    expect(harnessed.synthetics[1].text).toContain('is trusted')
  })

  it('explains why the decision is not trusted', async () => {
    const projectRoot = tempDir('conductor-trust-denied-')
    const configDir = tempDir('conductor-trust-bad-config-')
    const configPath = join(configDir, 'conductor.json')
    writeFileSync(configPath, '{not json')

    const harnessed = harness()
    await registerCommands(harnessed.ctx, {
      projectRoot,
      configPath,
      env: { HOME: configDir },
      probe: probePassing,
    })

    await definition(harnessed, 'conductor:trust').execute({ sessionID: 'ses_denied' })

    expect(harnessed.prompts).toEqual([])
    expect(harnessed.synthetics).toHaveLength(1)
    const text = harnessed.synthetics[0].text
    expect(text).toContain('is not trusted')
    // "Say why": the code alone would not explain the refusal.
    expect(text).toContain('Why:')
    expect(text).toContain('malformed_config')
    expect(text).toContain('Run: bunx opencode-conductor trust .')
    // The malformed file was not overwritten by a failed grant.
    expect(readFileSync(configPath, 'utf8')).toBe('{not json')
  })
})

describe('conductor:doctor', () => {
  it('reports the runtime, agent warnings, registration path and state layout', async () => {
    const projectRoot = tempDir('conductor-doctor-project-')
    const assetsDir = tempDir('conductor-doctor-assets-')
    const home = tempDir('conductor-doctor-home-')
    const harnessed = harness()

    await registerCommands(harnessed.ctx, {
      projectRoot,
      assetsDir,
      env: { HOME: home },
      agentWarnings: ['coder: no model declared', 'critic: unknown model'],
      probe: probePassing,
    })

    await definition(harnessed, 'conductor:doctor').execute({ sessionID: 'ses_doctor' })

    expect(harnessed.prompts).toEqual([])
    expect(harnessed.synthetics).toHaveLength(1)
    expect(harnessed.synthetics[0].sessionID).toBe('ses_doctor')

    const text = harnessed.synthetics[0].text
    expect(text).toContain(`conductor doctor — ${projectRoot}`)
    expect(text).toContain('runtime: ok')
    expect(text).toContain('[ok] bun-runtime: Bun 1.3.4')
    expect(text).toContain(RUNTIME_REMEDIATION)
    // No probe report in the fixture assets: the fail-closed file path wins.
    expect(text).toContain('agents: registration path files')
    expect(text).toContain('agents: 2 registration warning(s)')
    expect(text).toContain('  - coder: no model declared')
    expect(text).toContain('  - critic: unknown model')
    expect(text).toContain('  mode: central')
    expect(text).toContain(`  projectKey: ${projectKeyFor(projectRoot)}`)
    expect(text).toContain(`  ledgerPath: ${join(home, '.local', 'share', 'opencode-conductor', 'projects', projectKeyFor(projectRoot), 'supervisor.db')}`)
    expect(text).toContain(`  runsDir: ${join(home, '.local', 'share', 'opencode-conductor', 'projects', projectKeyFor(projectRoot), 'runs')}`)
    // Doctor is read-only: it does not create the project record or any state.
    expect(existsSync(join(home, '.local', 'share'))).toBe(false)
    expect(readProjectRecord(join(home, '.local', 'share', 'opencode-conductor', 'projects', projectKeyFor(projectRoot), 'project.json'))).toBeNull()
  })

  it('selects the transform path only from an explicit pass report', async () => {
    const projectRoot = tempDir('conductor-doctor-pass-')
    const assetsDir = tempDir('conductor-doctor-report-')
    const home = tempDir('conductor-doctor-pass-home-')
    mkdirSync(join(assetsDir, 'compat'), { recursive: true })
    writeFileSync(
      join(assetsDir, 'compat', 'probe-report.json'),
      JSON.stringify({ generatedAt: new Date().toISOString(), verdict: 'pass', checks: {} }),
    )

    const text = await buildDoctorReport({
      projectRoot,
      assetsDir,
      env: { HOME: home },
      agentWarnings: [],
      probe: probePassing,
    })

    expect(text).toContain('agents: registration path transform')
    expect(text).toContain('agents: no registration warnings')
  })

  it('reports a failing runtime and still answers without a model', async () => {
    const projectRoot = tempDir('conductor-doctor-fail-')
    const assetsDir = tempDir('conductor-doctor-fail-assets-')
    const home = tempDir('conductor-doctor-fail-home-')
    const harnessed = harness()

    await registerCommands(harnessed.ctx, {
      projectRoot,
      assetsDir,
      env: { HOME: home },
      probe: async () => ({
        ok: false,
        checks: [{ name: 'bun:sqlite', ok: false, detail: 'bun:sqlite is not available' }],
        remediation: RUNTIME_REMEDIATION,
      }),
    })

    await definition(harnessed, 'conductor:doctor').execute({ sessionID: 'ses_fail' })

    const text = harnessed.synthetics[0].text
    expect(harnessed.prompts).toEqual([])
    expect(text).toContain('runtime: FAILED')
    expect(text).toContain('[FAIL] bun:sqlite: bun:sqlite is not available')
  })
})

// ---------------------------------------------------------------------------
// Plugin wiring: the tool set is registered without the runtime transform paths
// ---------------------------------------------------------------------------

describe('setupConductor wiring', () => {
  it('registers agents and skills through transforms, without files or commands', async () => {
    const projectRoot = tempDir('conductor-wiring-project-')
    const home = tempDir('conductor-wiring-home-')
    const registeredCommands: CommandDefinition[] = []
    const registeredTools: string[] = []
    const registeredAgents: string[] = []
    const registeredSkills: string[] = []
    const transformCalls: string[] = []
    const logged: string[] = []

    const ctx = {
      location: {
        directory: projectRoot,
        project: { canonical: projectRoot, id: 'prj_wiring' },
      },
      agent: {
        async transform(callback: (editor: any) => void) {
          transformCalls.push('agent')
          callback({
            update(id: string, apply: (agent: Record<string, unknown>) => void) {
              const agent: Record<string, unknown> = {}
              apply(agent)
              registeredAgents.push(id)
            },
            default() {},
          })
        },
      },
      skill: {
        async transform(callback: (editor: any) => void) {
          transformCalls.push('skill')
          callback({
            add(asset: { id: string }) {
              registeredSkills.push(asset.id)
            },
          })
        },
      },
      command: {
        async transform(callback: (editor: { add(entry: CommandDefinition): void }) => void) {
          transformCalls.push('command')
          callback({
            add(entry) {
              registeredCommands.push(entry)
            },
          })
        },
      },
      tool: {
        async transform(callback: (editor: { add(entry: { name: string }): void }) => void) {
          callback({
            add(entry) {
              registeredTools.push(entry.name)
            },
          })
        },
      },
    }

    const originalError = console.error
    console.error = (...args: unknown[]) => {
      logged.push(args.map(String).join(' '))
    }
    try {
      await setupConductor(ctx, {
        env: { HOME: home },
        probe: async () => ({ ok: true, checks: [], remediation: RUNTIME_REMEDIATION }),
      })
    } finally {
      console.error = originalError
    }

    // Runtime registration is the default path; commands stay omitted.
    expect(transformCalls).toEqual(['agent', 'skill'])
    expect(registeredCommands).toEqual([])
    expect(registeredAgents).toHaveLength(15)
    expect(registeredAgents).toContain('conductor')
    expect(registeredSkills).toHaveLength(15)
    expect(registeredSkills).toContain('closeout')

    // No files are written into the user's global config.
    expect(existsSync(join(home, '.config', 'opencode', 'agents', 'conductor.md'))).toBe(false)
    expect(existsSync(join(home, '.config', 'opencode', 'skills', 'closeout', 'SKILL.md'))).toBe(
      false,
    )

    // The tool set is unaffected.
    expect(registeredTools.length).toBeGreaterThan(10)
    expect(registeredTools).toContain('supervisor_init_run')
    // No transform failure was logged.
    expect(logged.some((line) => line.includes('transform failed'))).toBe(false)
  })
})
