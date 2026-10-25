// The trust gate is what makes a global install safe: the supervisor tool set
// is registered in every folder, but a mutating tool refuses — with a readable
// JSON result, never a throw — until the user grants trust for that folder.
//
// These tests pin four things:
//   1. the interception rules (mutating refused, read-only passed by reference,
//      unknown names fail closed) with an executor spy proving nothing ran;
//   2. the whole registered set behaves that way end to end;
//   3. name/description/input schema are unchanged by the gate;
//   4. a central-state project keeps its writes out of the checkout (byte-level
//      listing comparison before/after).
//
// Every path is a temp fixture under the OS temp dir; the conductor home is
// injected via `HOME`/explicit paths, so nothing reads or writes the real home.
import { afterAll, describe, expect, it, mock } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  resolveSupervisorConfig,
  type CollectedTool,
  type ToolRegistrar,
} from '../../src/plugin'
import {
  CONDUCTOR_PLUGIN_ID,
  conductorPlugin,
  DOCTOR_TOOL_NAME,
  setupConductor,
} from '../../src/index'
import {
  createGuardedEditor,
  isMutatingSupervisorTool,
  isReadOnlySupervisorTool,
  READ_ONLY_SUPERVISOR_TOOLS,
  registerConductorTools,
  UNTRUSTED_PROJECT_CODE,
  untrustedRefusal,
  type ToolTrustGuard,
} from '../../src/register/tools'
import { RUNTIME_REMEDIATION } from '../../src/runtime/compat'
import { resolveProjectIdentity } from '../../src/runtime/project'
import { TRUST_GRANT_HINT } from '../../src/runtime/trust'

const fixtureRoot = realpathSync(
  mkdtempSync(join(tmpdir(), 'conductor-tools-test-')),
)

afterAll(() => {
  rmSync(fixtureRoot, { recursive: true, force: true })
})

/** Create (recursively) and realpath a fixture directory. */
function makeDir(...parts: string[]): string {
  const dir = join(fixtureRoot, ...parts)
  mkdirSync(dir, { recursive: true })
  return realpathSync(dir)
}

/** Recursive relative listing, used to prove a directory is byte-identical. */
function walk(dir: string, prefix = ''): string[] {
  const entries: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name
    entries.push(relative)
    if (entry.isDirectory()) entries.push(...walk(join(dir, entry.name), relative))
  }
  return entries.sort()
}

/** A registrar that only captures what is registered. */
function capture(): { editor: ToolRegistrar; definitions: CollectedTool[] } {
  const definitions: CollectedTool[] = []
  return {
    editor: {
      add: (definition) => {
        definitions.push(definition)
      },
    },
    definitions,
  }
}

/** A registrar-shaped `$` that records calls instead of running a shell. */
function shellSpy(): { $: any; calls: string[] } {
  const calls: string[] = []
  const result = { exitCode: 0, stdout: '', stderr: '' }
  const settle = () => Promise.resolve(result)
  const dollar = ((strings: TemplateStringsArray) => {
    calls.push(strings.join(''))
    return Object.assign(settle(), {
      quiet: () => Object.assign(settle(), { nothrow: settle }),
      nothrow: settle,
    })
  }) as any
  return { $: dollar, calls }
}

const untrustedGuard = (projectRoot: string): ToolTrustGuard => ({
  trusted: false,
  projectRoot,
  hint: TRUST_GRANT_HINT,
})

const trustedGuard = (projectRoot: string): ToolTrustGuard => ({
  trusted: true,
  projectRoot,
  hint: TRUST_GRANT_HINT,
})

/** Local-mode config (ledger under the fixture) for the gate tests. */
function configFor(
  projectRoot: string,
  extra: { $?: any; ledgerPath?: string } = {},
) {
  return resolveSupervisorConfig({
    options: {
      repoRoot: projectRoot,
      ...(extra.ledgerPath ? { ledgerPath: extra.ledgerPath } : {}),
      ...(extra.$ ? { $: extra.$ } : {}),
    },
    env: {},
  })
}

/**
 * Tool results come in two shapes: the trust gate returns a raw JSON string
 * (the refusal), while `registerSupervisorTools` wraps real results in
 * `{ content: string }` (the runtime's tool-result envelope).
 */
function toolResult(out: unknown): any {
  if (typeof out === 'string') return JSON.parse(out)
  const content = (out as { content?: unknown } | null)?.content
  if (typeof content === 'string') return JSON.parse(content)
  return out
}

function definitionNamed(
  definitions: CollectedTool[],
  name: string,
): CollectedTool {
  const found = definitions.find((definition) => definition.name === name)
  if (!found) throw new Error(`no definition registered for ${name}`)
  return found
}

function executeNamed(
  definitions: CollectedTool[],
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  return definitionNamed(definitions, name).execute(args)
}

describe('READ_ONLY_SUPERVISOR_TOOLS — fail closed', () => {
  it('contains exactly the enumerated read-only tools', () => {
    expect([...READ_ONLY_SUPERVISOR_TOOLS].sort()).toEqual([
      'supervisor_get_status',
      'supervisor_patrol',
    ])
  })

  it('treats every other name, including unknown ones, as mutating', () => {
    expect(isReadOnlySupervisorTool('supervisor_get_status')).toBe(true)
    expect(isReadOnlySupervisorTool('supervisor_patrol')).toBe(true)

    expect(isMutatingSupervisorTool('supervisor_init_run')).toBe(true)
    expect(isMutatingSupervisorTool('supervisor_claim_task')).toBe(true)
    // A tool added in a future release is NOT in the allowlist: it must be
    // treated as mutating rather than silently pass the gate.
    expect(isMutatingSupervisorTool('supervisor_future_tool')).toBe(true)
    expect(isMutatingSupervisorTool('some_other_tool')).toBe(true)
  })
})

describe('createGuardedEditor — interception', () => {
  it('refuses a mutating definition without invoking its executor (spy)', async () => {
    const { editor, definitions } = capture()
    const execute = mock(() => Promise.resolve('mutated the ledger'))
    const guarded = createGuardedEditor(editor, untrustedGuard('/repo/untrusted'))

    guarded.add({
      name: 'supervisor_future_tool',
      description: 'a tool this release does not know about',
      input: { type: 'object', properties: { run_id: { type: 'string' } } },
      execute,
    })

    expect(definitions).toHaveLength(1)
    // The schema is preserved so the tool list still describes the capability.
    expect(definitions[0].description).toBe(
      'a tool this release does not know about',
    )
    expect(definitions[0].input).toEqual({
      type: 'object',
      properties: { run_id: { type: 'string' } },
    })
    // ...but the executor was replaced, so the original can never run.
    expect(definitions[0].execute).not.toBe(execute)

    const raw = await definitions[0].execute({ run_id: 'run-1' })

    expect(execute).not.toHaveBeenCalled()
    expect(raw).toBe(
      JSON.stringify({
        refused: true,
        code: 'untrusted_project',
        tool: 'supervisor_future_tool',
        project_root: '/repo/untrusted',
        message:
          'Project /repo/untrusted is not trusted; supervisor_future_tool mutates conductor state and was refused.',
        hint: TRUST_GRANT_HINT,
      }),
    )
  })

  it('returns the pinned refusal payload shape', async () => {
    const { editor, definitions } = capture()
    const guarded = createGuardedEditor(editor, untrustedGuard('/repo/untrusted'))
    guarded.add({
      name: 'supervisor_cancel_run',
      description: 'd',
      input: { type: 'object' },
      execute: async () => 'ok',
    })

    const parsed = toolResult(await definitions[0].execute({}))

    expect(Object.keys(parsed)).toEqual([
      'refused',
      'code',
      'tool',
      'project_root',
      'message',
      'hint',
    ])
    expect(parsed).toEqual(
      untrustedRefusal(
        'supervisor_cancel_run',
        untrustedGuard('/repo/untrusted'),
      ),
    )
    expect(parsed.code).toBe(UNTRUSTED_PROJECT_CODE)
    expect(parsed.refused).toBe(true)
  })

  it('passes a read-only definition through unchanged and executes it', async () => {
    const { editor, definitions } = capture()
    const execute = mock(() => Promise.resolve('{"state":"running"}'))
    const guarded = createGuardedEditor(editor, untrustedGuard('/repo/untrusted'))

    guarded.add({
      name: 'supervisor_get_status',
      description: 'read status',
      input: { type: 'object', required: ['run_id'] },
      execute,
    })

    expect(definitions[0].execute).toBe(execute)
    expect(definitions[0].description).toBe('read status')

    const result = await definitions[0].execute({ run_id: 'run-1' })

    expect(execute).toHaveBeenCalledTimes(1)
    expect(result).toBe('{"state":"running"}')
  })

  it('executes a mutating definition normally when the project is trusted', async () => {
    const { editor, definitions } = capture()
    const execute = mock(() => Promise.resolve('{"cancelled":true}'))
    const guarded = createGuardedEditor(editor, trustedGuard('/repo/trusted'))

    guarded.add({
      name: 'supervisor_cancel_run',
      description: 'cancel',
      input: { type: 'object' },
      execute,
    })

    expect(definitions[0].execute).toBe(execute)
    expect(await definitions[0].execute({ run_id: 'run-1' })).toBe(
      '{"cancelled":true}',
    )
    expect(execute).toHaveBeenCalledTimes(1)
  })
})

describe('registerConductorTools — whole set', () => {
  it('registers every tool but refuses each mutating one while untrusted', async () => {
    const projectRoot = makeDir('untrusted-set')
    const { $, calls } = shellSpy()
    const config = configFor(projectRoot, { $ })
    const { editor, definitions } = capture()

    registerConductorTools(editor, config, untrustedGuard(projectRoot))

    const names = definitions.map((definition) => definition.name)
    expect(names).toContain('supervisor_init_run')
    expect(names).toContain('supervisor_claim_task')
    expect(names).toContain('supervisor_get_status')
    expect(names).toContain('supervisor_patrol')

    const readOnly = definitions.filter((definition) =>
      isReadOnlySupervisorTool(definition.name),
    )
    const mutating = definitions.filter((definition) =>
      isMutatingSupervisorTool(definition.name),
    )

    // Exactly the two documented read-only tools are exempt.
    expect(readOnly.map((definition) => definition.name).sort()).toEqual([
      'supervisor_get_status',
      'supervisor_patrol',
    ])
    expect(mutating.length).toBe(definitions.length - 2)

    for (const definition of mutating) {
      const parsed = toolResult(await definition.execute({}))

      expect(parsed.refused).toBe(true)
      expect(parsed.code).toBe(UNTRUSTED_PROJECT_CODE)
      expect(parsed.tool).toBe(definition.name)
      expect(parsed.project_root).toBe(projectRoot)
      expect(parsed.hint).toBe(TRUST_GRANT_HINT)
    }

    // No mutating executor ran: no shell call, no run directory, no run row.
    expect(calls).toEqual([])
    expect(existsSync(join(projectRoot, '.opencode', 'runs'))).toBe(false)
    const status = toolResult(
      await executeNamed(definitions, 'supervisor_get_status', {
        run_id: 'run-does-not-exist',
      }),
    )
    expect(status.error).toBe('Run not found')
  })

  it('executes mutating tools when the project is trusted', async () => {
    const projectRoot = makeDir('trusted-set')
    const config = configFor(projectRoot)
    const { editor, definitions } = capture()

    registerConductorTools(editor, config, trustedGuard(projectRoot))

    const init = toolResult(
      await executeNamed(definitions, 'supervisor_init_run', {
        objective: 'ship the trust gate',
        risk_class: 'low',
      }),
    )

    expect(String(init.run_id)).toMatch(/^run-/)
    expect(init.state).toBe('intake')

    const status = toolResult(
      await executeNamed(definitions, 'supervisor_get_status', {
        run_id: init.run_id,
      }),
    )
    expect(status.run_id).toBe(init.run_id)
    expect(status.state).toBe('intake')
  })

  it('leaves name, description and input schema byte-identical', () => {
    const projectRoot = makeDir('shape-parity')
    const config = configFor(projectRoot)
    const trusted = capture()
    const untrusted = capture()

    registerConductorTools(trusted.editor, config, trustedGuard(projectRoot))
    registerConductorTools(untrusted.editor, config, untrustedGuard(projectRoot))

    expect(untrusted.definitions.map((definition) => definition.name)).toEqual(
      trusted.definitions.map((definition) => definition.name),
    )

    for (const [index, definition] of trusted.definitions.entries()) {
      expect(untrusted.definitions[index].description).toBe(
        definition.description,
      )
      expect(JSON.stringify(untrusted.definitions[index].input)).toBe(
        JSON.stringify(definition.input),
      )
    }
  })
})

describe('central state — the checkout stays untouched', () => {
  it('refuses supervisor_init_run in an untrusted checkout and keeps state under the injected HOME', async () => {
    const projectRoot = makeDir('central-untrusted')
    const home = join(fixtureRoot, 'homes', 'central-untrusted')
    const env = { HOME: home }

    // A plain (non-git) directory with no conductor state: `auto` picks central.
    const identity = resolveProjectIdentity({ projectRoot, mode: 'auto', env })
    expect(identity.layout.mode).toBe('central')
    expect(identity.recordPath).not.toBe(null)
    expect(identity.layout.ledgerPath.startsWith(`${home}/`)).toBe(true)

    const config = configFor(projectRoot, {
      ledgerPath: identity.layout.ledgerPath,
    })
    const before = walk(projectRoot)
    const { editor, definitions } = capture()

    registerConductorTools(editor, config, untrustedGuard(projectRoot))

    const refusal = toolResult(
      await executeNamed(definitions, 'supervisor_init_run', {
        objective: 'touch nothing',
        risk_class: 'low',
      }),
    )
    expect(refusal.refused).toBe(true)
    expect(refusal.code).toBe(UNTRUSTED_PROJECT_CODE)
    expect(refusal.tool).toBe('supervisor_init_run')

    // Byte-level proof: the checkout listing is identical, nothing was created.
    expect(before).toEqual([])
    expect(walk(projectRoot)).toEqual(before)
    expect(existsSync(join(projectRoot, '.opencode'))).toBe(false)

    // The state that does exist lives centrally, under the injected HOME.
    expect(existsSync(String(identity.recordPath))).toBe(true)
    expect(existsSync(identity.layout.ledgerPath)).toBe(true)
    expect(walk(home).length).toBeGreaterThan(0)
  })

  it('runs supervisor_init_run with state rooted centrally, writing nothing into the fixture', async () => {
    const projectRoot = makeDir('central-trusted')
    const home = join(fixtureRoot, 'homes', 'central-trusted')
    const env = { HOME: home }
    const identity = resolveProjectIdentity({ projectRoot, mode: 'auto', env })
    expect(identity.layout.mode).toBe('central')

    // State rooted at the central project directory — the layout the conductor
    // home owns. (The checkout-relative projection paths inside `plugin.ts` are
    // pre-existing debt, tracked outside this task.)
    const stateRoot = String(identity.layout.projectDir)
    const config = configFor(stateRoot, {
      ledgerPath: identity.layout.ledgerPath,
    })
    const before = walk(projectRoot)
    const { editor, definitions } = capture()

    registerConductorTools(editor, config, trustedGuard(projectRoot))

    const init = toolResult(
      await executeNamed(definitions, 'supervisor_init_run', {
        objective: 'a centrally stored run',
        risk_class: 'low',
      }),
    )
    expect(init.state).toBe('intake')

    // The checkout is byte-identical; every new path is under the injected HOME.
    expect(before).toEqual([])
    expect(walk(projectRoot)).toEqual(before)
    expect(
      existsSync(`${stateRoot}/.opencode/runs/${init.run_id}/run.json`),
    ).toBe(true)
    expect(walk(home).length).toBeGreaterThan(0)

    const status = toolResult(
      await executeNamed(definitions, 'supervisor_get_status', {
        run_id: init.run_id,
      }),
    )
    expect(status.state).toBe('intake')
  })
})

describe('conductor entry — runtime probe gate', () => {
  /** A runtime-shaped ctx that records what the plugin registers. */
  function entryContext(projectRoot: string) {
    const { editor, definitions } = capture()
    const ctx = {
      location: {
        directory: projectRoot,
        project: { canonical: projectRoot, id: 'prj_entry' },
      },
      tool: {
        async transform(fn: (target: ToolRegistrar) => void) {
          await fn(editor)
        },
      },
    }
    return { ctx, definitions }
  }

  it('registers only supervisor_doctor when the runtime probe fails', async () => {
    const projectRoot = makeDir('entry-probe-failure')
    const home = join(fixtureRoot, 'homes', 'entry-probe-failure')
    const { ctx, definitions } = entryContext(projectRoot)
    const logged: unknown[][] = []
    const originalError = console.error

    console.error = (...args: unknown[]) => {
      logged.push(args)
    }
    try {
      await setupConductor(ctx, {
        env: { HOME: home },
        probe: async () => ({
          ok: false,
          checks: [
            {
              name: 'bun:sqlite',
              ok: false,
              detail: 'bun:sqlite is not available',
            },
          ],
          remediation: RUNTIME_REMEDIATION,
        }),
      })
    } finally {
      console.error = originalError
    }

    expect(conductorPlugin.id).toBe(CONDUCTOR_PLUGIN_ID)
    // Exactly one tool, and no supervisor tool set behind it.
    expect(definitions.map((definition) => definition.name)).toEqual([
      DOCTOR_TOOL_NAME,
    ])

    const report = String(await definitions[0].execute({}))
    expect(report).toContain('[FAIL] bun:sqlite: bun:sqlite is not available')
    expect(report.endsWith(RUNTIME_REMEDIATION)).toBe(true)

    // Logged once, and it is the same text the tool hands back.
    expect(logged).toHaveLength(1)
    expect(logged[0]).toEqual([report])

    // A failed probe must not create conductor state in the checkout.
    expect(existsSync(join(projectRoot, '.opencode'))).toBe(false)
  })

  it('registers the graded tool set for an untrusted project', async () => {
    const projectRoot = makeDir('entry-untrusted')
    const home = join(fixtureRoot, 'homes', 'entry-untrusted')
    const { ctx, definitions } = entryContext(projectRoot)
    const before = walk(projectRoot)

    await setupConductor(ctx, {
      env: { HOME: home },
      probe: async () => ({
        ok: true,
        checks: [],
        remediation: RUNTIME_REMEDIATION,
      }),
    })

    // The full set is registered (everything the gate knows about)...
    expect(definitions.length).toBeGreaterThan(10)
    expect(definitions.map((definition) => definition.name)).toContain(
      'supervisor_init_run',
    )

    // ...but the folder is untrusted, so mutation refuses and nothing is written.
    const refusal = toolResult(
      await executeNamed(definitions, 'supervisor_init_run', {
        objective: 'must not run',
        risk_class: 'low',
      }),
    )
    expect(refusal.refused).toBe(true)
    expect(refusal.code).toBe(UNTRUSTED_PROJECT_CODE)
    expect(refusal.project_root).toBe(projectRoot)
    expect(walk(projectRoot)).toEqual(before)
  })
})
