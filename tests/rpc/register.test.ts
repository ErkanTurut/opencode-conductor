import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ConductorRpc } from '../../src/rpc-contract'
import { loadFleetModels, registerConductorRpc } from '../../src/rpc/register'
import { seedLedger, tempProject, type SeedIds, type TempProject } from '../read/seed'

type Handler = (input: unknown) => Promise<any>

interface Captured {
  definition: any
  handlers: Record<string, Handler> | null
}

function fakeCtx(options: { register?: (definition: unknown, handlers: unknown) => Promise<unknown> } = {}) {
  const captured: Captured = { definition: null, handlers: null }
  const register =
    options.register ??
    (async (definition: unknown, handlers: unknown) => {
      captured.definition = definition
      captured.handlers = handlers as Record<string, Handler>
      return { dispose: () => {}, events: { emit: async () => {} } }
    })
  return { ctx: { rpc: { register } }, captured }
}

function handler(captured: Captured, name: string): Handler {
  const handlers = captured.handlers
  if (!handlers) throw new Error('handlers were not captured')
  const found = handlers[name]
  if (!found) throw new Error(`handler ${name} missing`)
  return found
}

let project: TempProject
let ids: SeedIds

async function register(): Promise<{ captured: Captured; registered: boolean }> {
  const { ctx, captured } = fakeCtx()
  const registered = await registerConductorRpc(ctx, {
    projectRoot: project.root,
    layout: project.layout,
    trusted: true,
    policyRestricted: false,
    assetsDir: null,
  })
  return { captured, registered }
}

beforeEach(async () => {
  project = tempProject('rpc-register')
  ids = await seedLedger(project.layout.ledgerPath)
  const runDir = join(project.layout.runsDir, ids.runId)
  mkdirSync(join(runDir, 'tasks'), { recursive: true })
  writeFileSync(join(runDir, 'requirements.md'), '# Requirements\n')
})

afterEach(() => {
  project.cleanup()
})

describe('registerConductorRpc — registration', () => {
  it('registers the shared contract with exactly its method names', async () => {
    const { captured, registered } = await register()
    expect(registered).toBe(true)
    expect(captured.definition).toBe(ConductorRpc)
    expect(captured.definition.id).toBe('conductor')
    const contractMethods = Object.keys(ConductorRpc.methods).sort()
    const handlerMethods = Object.keys(captured.handlers ?? {}).sort()
    expect(handlerMethods).toEqual(contractMethods)
    expect(handlerMethods).toEqual(
      [
        'dag',
        'gates',
        'memory',
        'memoryBlock',
        'refinements',
        'routing',
        'run',
        'runs',
        'timeline',
        'workspace',
      ].sort(),
    )
  })

  it('warns and returns false when the runtime has no rpc.register', async () => {
    const original = console.warn
    const warnings: unknown[] = []
    console.warn = (...args: unknown[]) => {
      warnings.push(args.join(' '))
    }
    try {
      const registered = await registerConductorRpc(
        {},
        {
          projectRoot: project.root,
          layout: project.layout,
          trusted: false,
          policyRestricted: false,
          assetsDir: null,
        },
      )
      expect(registered).toBe(false)
      expect(warnings.join('\n')).toContain('rpc.register')
    } finally {
      console.warn = original
    }
  })

  it('returns false when registration itself throws', async () => {
    const original = console.error
    console.error = () => {}
    try {
      const { ctx } = fakeCtx({
        register: async () => {
          throw new Error('host exploded')
        },
      })
      const registered = await registerConductorRpc(ctx, {
        projectRoot: project.root,
        layout: project.layout,
        trusted: true,
        policyRestricted: false,
        assetsDir: null,
      })
      expect(registered).toBe(false)
    } finally {
      console.error = original
    }
  })
})

describe('registerConductorRpc — handlers', () => {
  it('workspace reports layout, trust and counts', async () => {
    const { captured } = await register()
    const result = await handler(captured, 'workspace')({})
    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({
      projectRoot: project.root,
      projectKey: project.layout.projectKey,
      mode: 'local',
      trusted: true,
      policyRestricted: false,
      counts: { runs: 2, activeRuns: 1, tasks: 5, attempts: 2 },
    })
  })

  it('runs paginates and marks the on-disk receipt', async () => {
    const { captured } = await register()
    const first = await handler(captured, 'runs')({ limit: 1 })
    expect(first.ok).toBe(true)
    expect(first.data.runs).toHaveLength(1)
    expect(first.data.runs[0].id).toBe(ids.otherRunId)
    expect(first.data.nextCursor).not.toBeNull()

    const alphaReceipt = join(project.layout.runsDir, ids.runId, 'receipt.md')
    writeFileSync(alphaReceipt, '# Receipt\n')
    const second = await handler(captured, 'runs')({
      limit: 1,
      cursor: first.data.nextCursor,
      states: ['intake'],
    })
    expect(second.ok).toBe(true)
    expect(second.data.runs).toHaveLength(1)
    expect(second.data.runs[0].hasReceipt).toBe(true)
  })

  it('run returns detail for a known run and not_found for an unknown one', async () => {
    const { captured } = await register()
    const result = await handler(captured, 'run')({ runId: ids.runId })
    expect(result.ok).toBe(true)
    expect(result.data.summary.id).toBe(ids.runId)
    expect(result.data.tasks).toHaveLength(5)
    expect(result.data.contract).not.toBeNull()
    expect(result.data.eventCount).toBe(4)
    expect(result.data.runDir).toBe(join(project.layout.runsDir, ids.runId))

    const missing = await handler(captured, 'run')({ runId: 'run-nope' })
    expect(missing.ok).toBe(false)
    expect(missing.error.code).toBe('not_found')
  })

  it('narrows invalid inputs instead of throwing', async () => {
    const { captured } = await register()
    const missing = await handler(captured, 'run')({})
    expect(missing.ok).toBe(false)
    expect(missing.error.code).toBe('invalid_input')

    const wrongType = await handler(captured, 'run')({ runId: 42 })
    expect(wrongType.ok).toBe(false)
    expect(wrongType.error.code).toBe('invalid_input')

    const nonObject = await handler(captured, 'memory')(null)
    expect(nonObject.ok).toBe(true)

    const badStates = await handler(captured, 'runs')({ states: [1] })
    expect(badStates.ok).toBe(false)
    expect(badStates.error.code).toBe('invalid_input')
  })

  it('dag exposes ghosts and cycles', async () => {
    const { captured } = await register()
    const result = await handler(captured, 'dag')({ runId: ids.runId })
    expect(result.ok).toBe(true)
    expect(result.data.dangling).toEqual(['task-missing'])
    expect(result.data.cycles).toHaveLength(1)
    expect(result.data.nodes.some((node: any) => node.ghost)).toBe(true)

    const missing = await handler(captured, 'dag')({ runId: 'run-nope' })
    expect(missing.ok).toBe(false)
    expect(missing.error.code).toBe('not_found')
  })

  it('gates reports pass/fail/null and merge readiness', async () => {
    const { captured } = await register()
    const result = await handler(captured, 'gates')({ runId: ids.runId })
    expect(result.ok).toBe(true)
    expect(result.data.mergeReady).toBe(false)
    const byTask = new Map(
      result.data.tasks.map((task: any) => [task.taskId, task]),
    ) as Map<string, any>
    expect(byTask.get(ids.taskIds.a).passed).toBe(true)
    expect(byTask.get(ids.taskIds.b).passed).toBe(false)
    expect(byTask.get(ids.taskIds.ghost).passed).toBeNull()
  })

  it('refinements reads the contract, events and requirements markdown', async () => {
    const { captured } = await register()
    const result = await handler(captured, 'refinements')({ runId: ids.runId })
    expect(result.ok).toBe(true)
    expect(result.data.state).toBe('completed')
    expect(result.data.requirementsPath).toBe('requirements.md')
    expect(result.data.requirementsMarkdown).toBe('# Requirements\n')
    expect(result.data.events).toHaveLength(2)
  })

  it('memory lists blocks and memoryBlock returns one version', async () => {
    writeFileSync(
      join(project.layout.memoryDir, 'alpha.v1.json'),
      JSON.stringify({ label: 'alpha', version: 1, content: 'v1' }),
    )
    writeFileSync(
      join(project.layout.memoryDir, 'alpha.v2.json'),
      JSON.stringify({ label: 'alpha', version: 2, content: 'v2' }),
    )
    const { captured } = await register()

    const list = await handler(captured, 'memory')({ limit: 1 })
    expect(list.ok).toBe(true)
    expect(list.data.total).toBe(2)
    expect(list.data.blocks).toHaveLength(1)
    expect(list.data.blocks[0].version).toBe(2)

    const block = await handler(captured, 'memoryBlock')({ label: 'alpha', version: 1 })
    expect(block.ok).toBe(true)
    expect(block.data.content).toBe('v1')

    const latest = await handler(captured, 'memoryBlock')({ label: 'alpha' })
    expect(latest.ok).toBe(true)
    expect(latest.data.version).toBe(2)

    const missing = await handler(captured, 'memoryBlock')({ label: 'nope' })
    expect(missing.ok).toBe(false)
    expect(missing.error.code).toBe('not_found')

    const badVersion = await handler(captured, 'memoryBlock')({ label: 'alpha', version: 0 })
    expect(badVersion.ok).toBe(false)
    expect(badVersion.error.code).toBe('invalid_input')
  })

  it('routing merges fleet assignments, observed attempts and costs', async () => {
    const assetsDir = join(project.root, 'assets')
    mkdirSync(assetsDir, { recursive: true })
    writeFileSync(
      join(assetsDir, 'fleet.json'),
      JSON.stringify({ version: 1, models: { coder: { model: 'fleet/flash', variant: 'max' } } }),
    )
    const { ctx, captured } = fakeCtx()
    await registerConductorRpc(ctx, {
      projectRoot: project.root,
      layout: project.layout,
      trusted: true,
      policyRestricted: false,
      assetsDir,
    })
    const result = await handler(captured, 'routing')({ runId: ids.runId })
    expect(result.ok).toBe(true)
    expect(result.data.assignments).toContainEqual({
      role: 'coder',
      model: 'fleet/flash',
      variant: 'max',
      source: 'fleet',
    })
    expect(result.data.costs.totalTokens).toBe(1000)
    expect(result.data.costs.totalCost).toBeNull()
    expect(result.data.costs.coverage).toEqual({ attempts: 2, withUsage: 1 })
  })

  it('routing defaults to the newest run and rejects an unknown one', async () => {
    const { captured } = await register()
    const result = await handler(captured, 'routing')({})
    expect(result.ok).toBe(true)
    expect(result.data.observed).toEqual([])
    expect(result.data.costs.coverage.attempts).toBe(0)

    const missing = await handler(captured, 'routing')({ runId: 'run-nope' })
    expect(missing.ok).toBe(false)
    expect(missing.error.code).toBe('not_found')
  })

  it('timeline paginates and reports truncation', async () => {
    const { captured } = await register()
    const first = await handler(captured, 'timeline')({ runId: ids.runId, limit: 2 })
    expect(first.ok).toBe(true)
    expect(first.data.events).toHaveLength(2)
    expect(first.data.truncated).toBe(true)

    const after = await handler(captured, 'timeline')({
      runId: ids.runId,
      afterSequence: first.data.lastSequence,
      limit: 10,
    })
    expect(after.ok).toBe(true)
    expect(after.data.events).toHaveLength(2)
    expect(after.data.truncated).toBe(false)

    const idle = await handler(captured, 'timeline')({
      runId: ids.runId,
      afterSequence: 999,
      limit: 5,
    })
    expect(idle.ok).toBe(true)
    expect(idle.data.events).toEqual([])
    expect(idle.data.lastSequence).toBe(999)

    const bad = await handler(captured, 'timeline')({ runId: ids.runId, limit: 'many' })
    expect(bad.ok).toBe(false)
    expect(bad.error.code).toBe('invalid_input')
  })

  it('never creates a database or throws when the ledger is absent or bogus', async () => {
    const missingPath = join(project.root, 'absent.db')
    const layout = { ...project.layout, ledgerPath: missingPath }
    const { ctx, captured } = fakeCtx()
    await registerConductorRpc(ctx, {
      projectRoot: project.root,
      layout,
      trusted: false,
      policyRestricted: true,
      assetsDir: null,
    })
    const workspace = await handler(captured, 'workspace')({})
    expect(workspace.ok).toBe(true)
    expect(workspace.data.counts.runs).toBe(0)
    expect(workspace.data.policyRestricted).toBe(true)
    expect(existsSync(missingPath)).toBe(false)

    const bogus = fakeCtx()
    await registerConductorRpc(bogus.ctx, {
      projectRoot: project.root,
      layout: { ...project.layout, ledgerPath: project.root },
      trusted: true,
      policyRestricted: false,
      assetsDir: null,
    })
    const result = await handler(bogus.captured, 'runs')({})
    expect(result.ok).toBe(true)
    expect(result.data.runs).toEqual([])
  })

  it('exposes loadFleetModels as a soft reader', () => {
    expect(loadFleetModels(null)).toEqual({})
    expect(loadFleetModels(join(project.root, 'missing'))).toEqual({})
    const assetsDir = join(project.root, 'fleet-assets')
    mkdirSync(assetsDir, { recursive: true })
    writeFileSync(join(assetsDir, 'fleet.json'), '{bad json')
    expect(loadFleetModels(assetsDir)).toEqual({})
    writeFileSync(
      join(assetsDir, 'fleet.json'),
      JSON.stringify({ models: { coder: { model: 'p/m' }, broken: {} } }),
    )
    expect(loadFleetModels(assetsDir)).toEqual({ coder: { model: 'p/m', variant: null } })
  })
})
