import { describe, it, expect } from 'bun:test'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Scheduler } from '../src/scheduler'
import { Runner } from '../src/runner'
import { SqliteLedger } from '../src/ledger/sqlite'
import { DEFAULT_BUDGET } from '../src/types'
import type { ILedger } from '../src/ledger/interface'

describe('Scheduler — DAG Validation', () => {
  it('detects no cycles in valid DAG', () => {
    const scheduler = new Scheduler({} as ILedger)
    const result = scheduler.validateDag([
      { id: 'a', dependencyJson: '[]' },
      { id: 'b', dependencyJson: '["a"]' },
      { id: 'c', dependencyJson: '["a","b"]' },
    ])
    expect(result.valid).toBe(true)
  })

  it('detects cycles', () => {
    const scheduler = new Scheduler({} as ILedger)
    const result = scheduler.validateDag([
      { id: 'a', dependencyJson: '["c"]' },
      { id: 'b', dependencyJson: '["a"]' },
      { id: 'c', dependencyJson: '["b"]' },
    ])
    expect(result.valid).toBe(false)
    expect(result.cycles.length).toBeGreaterThan(0)
  })

  it('detects self-cycles', () => {
    const scheduler = new Scheduler({} as ILedger)
    const result = scheduler.validateDag([{ id: 'a', dependencyJson: '["a"]' }])
    expect(result.valid).toBe(false)
  })
})

describe('Scheduler — Write Ownership', () => {
  it('detects overlapping write scope', () => {
    const scheduler = new Scheduler({} as ILedger)
    const result = scheduler.validateWriteOwnership([
      {
        id: 'task-1',
        writeScopeJson: '["src/foo/**"]',
        state: 'ready',
      },
      {
        id: 'task-2',
        writeScopeJson: '["src/foo/**"]',
        state: 'ready',
      },
    ])
    expect(result.valid).toBe(false)
    expect(result.conflicts.length).toBe(1)
  })

  it('allows non-overlapping write scope', () => {
    const scheduler = new Scheduler({} as ILedger)
    const result = scheduler.validateWriteOwnership([
      {
        id: 'task-1',
        writeScopeJson: '["src/foo/**"]',
        state: 'ready',
      },
      {
        id: 'task-2',
        writeScopeJson: '["src/bar/**"]',
        state: 'ready',
      },
    ])
    expect(result.valid).toBe(true)
  })

  it('ignores completed tasks for ownership', () => {
    const scheduler = new Scheduler({} as ILedger)
    const result = scheduler.validateWriteOwnership([
      {
        id: 'task-1',
        writeScopeJson: '["src/foo/**"]',
        state: 'completed',
      },
      {
        id: 'task-2',
        writeScopeJson: '["src/foo/**"]',
        state: 'ready',
      },
    ])
    expect(result.valid).toBe(true)
  })
})

describe('Scheduler — Dependency Resolution', () => {
  it('marks items ready when dependencies are resolved', () => {
    const scheduler = new Scheduler({} as ILedger)
    const result = scheduler.validateWorkItemDependencies([
      { id: 'a', dependencyJson: '[]', state: 'completed' },
      { id: 'b', dependencyJson: '["a"]', state: 'pending' },
      { id: 'c', dependencyJson: '["a","b"]', state: 'pending' },
    ])
    expect(result.blockedItems.length).toBe(1) // c blocked because b is not completed
  })

  it('no blocking when all deps completed', () => {
    const scheduler = new Scheduler({} as ILedger)
    const result = scheduler.validateWorkItemDependencies([
      { id: 'a', dependencyJson: '[]', state: 'completed' },
      { id: 'b', dependencyJson: '["a"]', state: 'completed' },
      { id: 'c', dependencyJson: '["a","b"]', state: 'pending' },
    ])
    expect(result.blockedItems.length).toBe(0)
  })
})

describe('Scheduler — getNextBatch reachable', () => {
  it('selects ready mutating items into a batch without mutating leases', async () => {
    const calls: string[] = []
    const fakeLedger = {
      listReadyWorkItems: async () => [
        { id: 'wi-a', owner_role: 'coder', priority: 1, title: 'A' },
      ],
      listWorkItems: async () => {
        calls.push('listWorkItems')
        return []
      },
    } as unknown as ILedger

    const batch = await new Scheduler(fakeLedger).getNextBatch(
      'run-1',
      DEFAULT_BUDGET,
    )
    expect(batch.mutating.length).toBe(1)
    expect(batch.mutating[0].id).toBe('wi-a')
    expect(batch.scouts.length).toBe(0)
    // Read-only: never claims a lease or transitions state.
    expect(calls).toEqual(['listWorkItems'])
  })

  it('is empty when no items are ready', async () => {
    const fakeLedger = {
      listReadyWorkItems: async () => [],
      listWorkItems: async () => [],
    } as unknown as ILedger
    const batch = await new Scheduler(fakeLedger).getNextBatch(
      'run-1',
      DEFAULT_BUDGET,
    )
    expect(batch.mutating).toEqual([])
    expect(batch.scouts).toEqual([])
  })
})

describe('Runner.addWorkItem — scheduler admission pre-check', () => {
  function makeRunner(): { runner: Runner; root: string } {
    const root = mkdtempSync(join(tmpdir(), 'sup-sched-'))
    mkdirSync(join(root, '.opencode'), { recursive: true })
    const runner = new Runner({
      repoRoot: root,
      mainRepoPath: root,
      worktreeBasePath: join(root, '.worktrees'),
    })
    return { runner, root }
  }

  function seedLedger(root: string): SqliteLedger {
    return new SqliteLedger(`${root}/.opencode/supervisor.db`)
  }

  const baseItem = {
    ownerRole: 'coder' as const,
    modelSlot: 'implementation',
    priority: 0,
    allowedPaths: ['src/**'],
    acceptanceCriteria: ['ok'],
    verificationCommands: ['true'],
  }

  it('rejects a new item when the run already holds a dependency cycle', async () => {
    const { runner, root } = makeRunner()
    const runId = await runner.createRun('t', 'low', 'internal', 'assisted')

    const seed = seedLedger(root)
    await seed.createWorkItem({
      id: 'wi-x',
      runId,
      issueKey: '',
      title: 'x',
      dependencyJson: '["wi-y"]',
      ownerRole: 'coder',
      modelSlot: 'implementation',
      priority: 0,
      writeScopeJson: '["src/x/**"]',
      contractJson: '{}',
      allowedPathsJson: '[]',
      readPathsJson: '[]',
      acceptanceCriteriaJson: '[]',
      verificationCommandsJson: '["true"]',
    })
    await seed.createWorkItem({
      id: 'wi-y',
      runId,
      issueKey: '',
      title: 'y',
      dependencyJson: '["wi-x"]',
      ownerRole: 'coder',
      modelSlot: 'implementation',
      priority: 0,
      writeScopeJson: '["src/y/**"]',
      contractJson: '{}',
      allowedPathsJson: '[]',
      readPathsJson: '[]',
      acceptanceCriteriaJson: '[]',
      verificationCommandsJson: '["true"]',
    })
    seed.close()

    await expect(
      runner.addWorkItem(runId, {
        ...baseItem,
        title: 'new',
        writeScope: ['src/z/**'],
      }),
    ).rejects.toThrow(/cycle/i)
  })

  it('rejects a new item whose write scope overlaps an active item', async () => {
    const { runner } = makeRunner()
    const runId = await runner.createRun('t', 'low', 'internal', 'assisted')

    await runner.addWorkItem(runId, {
      ...baseItem,
      title: 'first',
      writeScope: ['src/foo/**'],
    })

    await expect(
      runner.addWorkItem(runId, {
        ...baseItem,
        title: 'second',
        writeScope: ['src/foo/**'],
      }),
    ).rejects.toThrow(/write scope/i)
  })

  it('accepts a non-overlapping item and exposes it via getNextBatch', async () => {
    const { runner } = makeRunner()
    const runId = await runner.createRun('t', 'low', 'internal', 'assisted')

    const itemId = await runner.addWorkItem(runId, {
      ...baseItem,
      title: 'ok',
      writeScope: ['src/ok/**'],
    })
    expect(itemId.startsWith('wi-')).toBe(true)

    const batch = await runner.getNextBatch(runId)
    expect(batch.mutating.map((i) => i.id)).toContain(itemId)
  })
})
