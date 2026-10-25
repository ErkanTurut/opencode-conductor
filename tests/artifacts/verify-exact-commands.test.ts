// Attempt-bound `supervisor_verify` runs EXACTLY the recorded command list.
//
// Substitution is false evidence: a model that asks for X must never receive
// results for Y. The pinning here is the five observable behaviours:
//
//   1. the exact recorded list passes and persists its rows;
//   2. a reordered list is refused (order is part of the set);
//   3. a superset is refused;
//   4. a subset is refused;
//   5. omitting `commands` runs the recorded set unchanged.
//
// Refusals are proven at the subprocess boundary with an instrumented binary:
// the claim is "nothing starts", so the assertion is made where a process
// would start. Every fixture is a temp directory.
import { afterAll, describe, expect, it } from 'bun:test'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  resolveSupervisorConfig,
  registerSupervisorTools,
  type CollectedTool,
  type ToolRegistrar,
} from '../../src/plugin'
import { SqliteLedger } from '../../src/ledger/sqlite'

const fixtureRoot = realpathSync(
  mkdtempSync(join(tmpdir(), 'conductor-verify-exact-')),
)

afterAll(() => {
  rmSync(fixtureRoot, { recursive: true, force: true })
})

let counter = 0

function makeDir(label: string): string {
  counter += 1
  const dir = join(fixtureRoot, `${label}-${counter}`)
  mkdirSync(dir, { recursive: true })
  return realpathSync(dir)
}

/**
 * An instrumented executable that appends one line to `logPath` when it runs.
 * Zero lines proves the refusal happened before any spawn.
 */
function boundarySpy(
  projectRoot: string,
  label: string,
): { command: string; runs(): number } {
  const dir = join(projectRoot, `spy-${label}`)
  mkdirSync(dir, { recursive: true })
  const logPath = join(dir, 'spawn.log')
  const command = join(dir, 'verify-spy')
  writeFileSync(
    command,
    `#!/bin/sh\nprintf 'spawned\\n' >> '${logPath}'\nprintf 'spy-stdout\\n'\nexit 0\n`,
  )
  chmodSync(command, 0o755)
  return {
    command,
    runs() {
      if (!existsSync(logPath)) return 0
      const content = readFileSync(logPath, 'utf8')
      return content.split('\n').filter((line) => line.length > 0).length
    },
  }
}

interface VerifyFixture {
  projectRoot: string
  ledgerPath: string
  definitions: CollectedTool[]
}

/** A local-mode fixture with one recorded task and a live attempt. */
async function seedFixture(
  label: string,
  recorded: string[],
  role = 'coder',
): Promise<VerifyFixture> {
  const projectRoot = makeDir(`verify-${label}`)
  const ledgerPath = join(projectRoot, '.opencode', 'supervisor.db')
  mkdirSync(dirname(ledgerPath), { recursive: true })

  const ledger = new SqliteLedger(ledgerPath)
  await ledger.createRun({
    id: 'run-1',
    parentId: null,
    repoId: projectRoot,
    requestHash: 'hash',
    dataClass: 'internal',
    policyProfile: 'assisted',
    operationMode: 'assisted',
    riskClass: 'low',
    requestText: 'verify exact commands',
    budgetJson: '{}',
    deadlineAt: null,
  })
  await ledger.createWorkItem({
    id: 'wi-verify',
    runId: 'run-1',
    issueKey: '',
    title: 'verify exact commands',
    dependencyJson: '[]',
    ownerRole: role,
    modelSlot: 'implementation',
    priority: 0,
    writeScopeJson: '[]',
    contractJson: '{}',
    allowedPathsJson: '[]',
    readPathsJson: '[]',
    acceptanceCriteriaJson: '["ok"]',
    verificationCommandsJson: JSON.stringify(recorded),
  })
  await ledger.createAttempt({
    id: 'att-1',
    workItemId: 'wi-verify',
    attemptNo: 1,
    harness: 'opencode-cli',
    modelProvider: 'opencode',
    modelId: 'test-model',
    modelVariant: null,
    workspaceId: null,
    baseSha: '',
  })
  ledger.close()

  const config = resolveSupervisorConfig({
    options: { repoRoot: projectRoot, ledgerPath },
    env: {},
  })
  const definitions: CollectedTool[] = []
  const editor: ToolRegistrar = {
    add: (definition) => {
      definitions.push(definition)
    },
  }
  registerSupervisorTools(editor, config)
  return { projectRoot, ledgerPath, definitions }
}

function toolResult(out: unknown): any {
  if (typeof out === 'string') return JSON.parse(out)
  const content = (out as { content?: unknown } | null)?.content
  if (typeof content === 'string') return JSON.parse(content)
  return out
}

function executeNamed(
  definitions: CollectedTool[],
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const definition = definitions.find((entry) => entry.name === name)
  if (!definition) throw new Error(`no definition registered for ${name}`)
  return definition.execute(args)
}

async function verifications(ledgerPath: string): Promise<unknown[]> {
  const ledger = new SqliteLedger(ledgerPath)
  try {
    return await ledger.getVerifications('att-1')
  } finally {
    ledger.close()
  }
}

function verificationDir(projectRoot: string): string {
  return join(projectRoot, '.opencode', 'runs', 'run-1', 'artifacts', 'verification')
}

describe('supervisor_verify — exact recorded commands only', () => {
  it('runs the exact recorded list and persists every row', async () => {
    const spyRoot = makeDir('verify-exact-project')
    const spy = boundarySpy(spyRoot, 'exact')
    const recorded = [spy.command]
    const { ledgerPath, definitions } = await seedFixture('exact', recorded)

    const out = toolResult(
      await executeNamed(definitions, 'supervisor_verify', {
        commands: [...recorded],
        run_id: 'run-1',
        attempt_id: 'att-1',
      }),
    )

    expect(out.refused).toBeUndefined()
    expect(out.all_passed).toBe(true)
    expect(out.commands_source).toBe('task_record')
    expect(out.results.map((entry: any) => entry.command)).toEqual(recorded)
    expect(spy.runs()).toBe(1)
    expect((await verifications(ledgerPath)).length).toBe(1)
  })

  it('refuses a reordered list', async () => {
    const spyRoot = makeDir('verify-reordered-project')
    const spy = boundarySpy(spyRoot, 'reordered')
    const recorded = [spy.command, 'echo second']
    const supplied = ['echo second', spy.command]
    const { projectRoot, ledgerPath, definitions } = await seedFixture(
      'reordered',
      recorded,
    )

    const out = toolResult(
      await executeNamed(definitions, 'supervisor_verify', {
        commands: supplied,
        run_id: 'run-1',
        attempt_id: 'att-1',
      }),
    )

    expect(out.refused).toBe(true)
    expect(out.code).toBe('verification_command_refused')
    expect(out.reason).toBe('commands_differ_from_recorded')
    expect(out.recorded_commands).toEqual(recorded)
    expect(out.supplied_commands).toEqual(supplied)
    expect(out.failure_class).toBe('verification_command_refused')
    expect(out.results).toEqual([])
    expect(spy.runs()).toBe(0)
    expect(await verifications(ledgerPath)).toEqual([])
    expect(existsSync(verificationDir(projectRoot))).toBe(false)
  })

  it('refuses a superset of the recorded list', async () => {
    const spyRoot = makeDir('verify-superset-project')
    const spy = boundarySpy(spyRoot, 'superset')
    const recorded = [spy.command]
    const supplied = [spy.command, 'echo extra']
    const { ledgerPath, definitions } = await seedFixture('superset', recorded)

    const out = toolResult(
      await executeNamed(definitions, 'supervisor_verify', {
        commands: supplied,
        run_id: 'run-1',
        attempt_id: 'att-1',
      }),
    )

    expect(out.refused).toBe(true)
    expect(out.reason).toBe('commands_differ_from_recorded')
    expect(out.recorded_commands).toEqual(recorded)
    expect(out.supplied_commands).toEqual(supplied)
    expect(spy.runs()).toBe(0)
    expect(await verifications(ledgerPath)).toEqual([])
  })

  it('refuses a subset of the recorded list', async () => {
    const spyRoot = makeDir('verify-subset-project')
    const spy = boundarySpy(spyRoot, 'subset')
    const recorded = [spy.command, 'echo second']
    const supplied = [spy.command]
    const { ledgerPath, definitions } = await seedFixture('subset', recorded)

    const out = toolResult(
      await executeNamed(definitions, 'supervisor_verify', {
        commands: supplied,
        run_id: 'run-1',
        attempt_id: 'att-1',
      }),
    )

    expect(out.refused).toBe(true)
    expect(out.reason).toBe('commands_differ_from_recorded')
    expect(out.recorded_commands).toEqual(recorded)
    expect(out.supplied_commands).toEqual(supplied)
    expect(spy.runs()).toBe(0)
    expect(await verifications(ledgerPath)).toEqual([])
  })

  it('runs the recorded set when commands are omitted', async () => {
    const spyRoot = makeDir('verify-omitted-project')
    const spy = boundarySpy(spyRoot, 'omitted')
    const recorded = [spy.command]
    const { ledgerPath, definitions } = await seedFixture('omitted', recorded)

    const out = toolResult(
      await executeNamed(definitions, 'supervisor_verify', {
        run_id: 'run-1',
        attempt_id: 'att-1',
      }),
    )

    expect(out.refused).toBeUndefined()
    expect(out.all_passed).toBe(true)
    expect(out.commands_source).toBe('task_record')
    expect(out.results.map((entry: any) => entry.command)).toEqual(recorded)
    expect(spy.runs()).toBe(1)
    expect((await verifications(ledgerPath)).length).toBe(1)
  })
})
