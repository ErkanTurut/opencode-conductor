// Provenance: the patrol/sweep classification cases and the fencing-recovery
// expectations below are adapted from the OmO comparison notes (idea 3 —
// rounds/sweep slot + evidence gating). Patterns only: no upstream source was
// copied. License: SUL-1.0.
import { describe, it, expect } from 'bun:test'
import { mkdirSync, mkdtempSync, existsSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { $ } from 'bun'
import { SqliteLedger } from '../src/ledger/sqlite'
import type { ILedger } from '../src/ledger/interface'
import { Runner } from '../src/runner'
import {
  HEARTBEAT_FRESH_MS,
  Watchdog,
  classifyRunSweep,
  classifyWorktreeSweep,
  evaluateWorkItemLiveness,
} from '../src/watchdog'
import type { LeaseState } from '../src/watchdog'
// Integration note: the ledger enforces the state machine fail-closed (t2),
// so fixtures walk a legal path; GC attribution + the ledger health probe are
// exercised directly (F3).
import { VALID_TRANSITIONS } from '../src/state-machine'
import { classifyRunDirAttribution, probeLedgerHealth } from '../src/plugin'

const DAY_MS = 86_400_000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function tempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix))
  mkdirSync(join(root, '.opencode'), { recursive: true })
  return root
}

interface SeedItem {
  id: string
  state?: string
  role?: string
}

async function seedRun(
  ledger: SqliteLedger,
  runId = 'run-1',
): Promise<void> {
  await ledger.createRun({
    id: runId,
    parentId: null,
    repoId: '/repo',
    requestHash: 'h',
    dataClass: 'internal',
    policyProfile: 'assisted',
    operationMode: 'assisted',
    riskClass: 'low',
    requestText: 'test',
    budgetJson: '{}',
    deadlineAt: null,
  })
}

async function seedItem(
  ledger: SqliteLedger,
  item: SeedItem,
  runId = 'run-1',
): Promise<void> {
  await ledger.createWorkItem({
    id: item.id,
    runId,
    issueKey: '',
    title: item.id,
    dependencyJson: '[]',
    ownerRole: item.role ?? 'coder',
    modelSlot: 'implementation',
    priority: 0,
    writeScopeJson: '[]',
    contractJson: '{}',
    allowedPathsJson: '[]',
    readPathsJson: '[]',
    acceptanceCriteriaJson: '["ok"]',
    verificationCommandsJson: '["true"]',
  })
  if (item.state && item.state !== 'pending') {
    await ledger.transitionWorkItemState(item.id, item.state)
  }
}

/** Cancelled runs are tombstoned: attributable to F3 GC, never active. */
async function tombstoneRun(
  ledger: SqliteLedger,
  runId: string,
): Promise<void> {
  await seedRun(ledger, runId)
  await ledger.transitionRunState(runId, 'intake')
  await ledger.transitionRunState(runId, 'cancelled')
}

/** BFS over VALID_TRANSITIONS: the transition gate is fail-closed. */
async function advanceRunTo(
  ledger: SqliteLedger,
  runId: string,
  target: string,
): Promise<void> {
  const run = await ledger.getRun(runId)
  const start = (run?.state ?? 'created') as string
  const queue: string[][] = [[start]]
  const seen = new Set<string>([start])
  while (queue.length > 0) {
    const path = queue.shift()!
    const node = path[path.length - 1]
    if (node === target) {
      for (const step of path.slice(1)) {
        await ledger.transitionRunState(runId, step as never)
      }
      return
    }
    for (const next of VALID_TRANSITIONS[node as never] ?? []) {
      if (!seen.has(next)) {
        seen.add(next)
        queue.push([...path, next])
      }
    }
  }
  throw new Error(`no legal transition path from ${start} to ${target}`)
}

/**
 * Boot the plugin with a minimal ctx shim and collect the registered tools.
 * Mirrors the shape the OpenCode runtime passes (`ctx.location.directory`,
 * `ctx.tool.transform(editor)`, `ctx.tool.hook`).
 */
async function loadPluginTools(
  repoRoot: string,
): Promise<Record<string, { execute: (args: Record<string, unknown>) => Promise<string> }>> {
  const mod = (await import('../src/plugin')) as {
    default: {
      setup: (ctx: unknown) => Promise<void>
    }
  }
  const tools: Record<
    string,
    { execute: (args: Record<string, unknown>) => Promise<string> }
  > = {}
  const ctx = {
    location: { directory: repoRoot },
    tool: {
      transform: async (fn: (editor: unknown) => void) => {
        await fn({
          add: (tool: {
            name: string
            execute: (args: Record<string, unknown>) => Promise<unknown>
          }) => {
            const original = tool.execute.bind(tool)
            tools[tool.name] = {
              execute: async (args) => {
                // The runtime tool wrapper returns { content }; the tests want
                // the raw payload so JSON.parse can consume it directly.
                const result = await original(args)
                if (typeof result === 'string') return result
                if (
                  result &&
                  typeof result === 'object' &&
                  typeof (result as { content?: unknown }).content === 'string'
                ) {
                  return (result as { content: string }).content
                }
                return String(result)
              },
            }
          },
        })
      },
      hook: async () => {},
    },
  }
  await mod.default.setup(ctx)
  return tools
}

describe('Watchdog — stale lease recovery is a real fencing UPDATE', () => {
  it('bumps the fencing token, releases the lease, and events lease_recovered', async () => {
    const root = tempRoot('sup-wd-rec-')
    const ledger = new SqliteLedger(join(root, '.opencode/supervisor.db'))
    await seedRun(ledger)
    await seedItem(ledger, { id: 'wi-1' })

    const claim = await ledger.claimLease({
      workItemId: 'wi-1',
      leaseOwner: 'worker-a',
      // Long expiry: this lease is recovered because its HEARTBEAT is stale,
      // not because it expired.
      leaseExpiresAt: new Date(Date.now() + 600_000).toISOString(),
    })
    expect(claim.claimed).toBe(true)
    expect(claim.fencingToken).toBe(1)

    // Negative freshness window makes the just-set heartbeat stale.
    const watchdog = new Watchdog(ledger, { staleHeartbeatMaxAgeMs: -1 })
    const recovered = await watchdog.recoverStaleLeases()

    expect(recovered.map((r) => r.workItemId)).toEqual(['wi-1'])
    expect(recovered[0].previousFencingToken).toBe(1)
    expect(recovered[0].fencingToken).toBe(2)
    expect(recovered[0].released).toBe(true)

    const lease = await ledger.getLease('wi-1')
    expect(lease).not.toBeNull()
    expect(lease!.fencing_token).toBe(2)
    expect(lease!.released_at).not.toBeNull()

    const events = await ledger.getEvents('recovery')
    expect(events.some((e) => e.event_type === 'lease_recovered')).toBe(true)
    ledger.close()
  })

  it('recovers an expired lease through the same fencing path', async () => {
    const root = tempRoot('sup-wd-exp-')
    const ledger = new SqliteLedger(join(root, '.opencode/supervisor.db'))
    await seedRun(ledger)
    await seedItem(ledger, { id: 'wi-exp' })

    await ledger.claimLease({
      workItemId: 'wi-exp',
      leaseOwner: 'worker-b',
      leaseExpiresAt: new Date(Date.now() - 1_000).toISOString(),
    })

    const recovered = await new Watchdog(ledger).recoverStaleLeases()
    expect(recovered.map((r) => r.workItemId)).toContain('wi-exp')
    const lease = await ledger.getLease('wi-exp')
    expect(lease!.fencing_token).toBe(2)
    expect(lease!.released_at).not.toBeNull()
    ledger.close()
  })

  it('recoverLease is fenced: a superseded token is a no-op', async () => {
    const root = tempRoot('sup-wd-fence-')
    const ledger = new SqliteLedger(join(root, '.opencode/supervisor.db'))
    await seedRun(ledger)
    await seedItem(ledger, { id: 'wi-fence' })
    await ledger.claimLease({
      workItemId: 'wi-fence',
      leaseOwner: 'worker-c',
      leaseExpiresAt: new Date(Date.now() + 600_000).toISOString(),
    })

    const result = await ledger.recoverLease('wi-fence', 999)
    expect(result.recovered).toBe(false)
    const lease = await ledger.getLease('wi-fence')
    expect(lease!.released_at).toBeNull()
    ledger.close()
  })
})

describe('Watchdog — heartbeat failure releases the lease', () => {
  it('releases (token-fenced) when heartbeatLease returns false', async () => {
    const released: Array<[string, number]> = []
    const fakeLedger = {
      heartbeatLease: async () => false,
      releaseLease: async (workItemId: string, fencingToken: number) => {
        released.push([workItemId, fencingToken])
        return true
      },
      listStaleHeartbeats: async () => [],
      listExpiredLeases: async () => [],
      appendEvent: async () => ({}),
    } as unknown as ILedger

    const watchdog = new Watchdog(fakeLedger, { heartbeatIntervalMs: 5 })
    watchdog.startHeartbeat('wi-hb', 7)
    await sleep(40)
    watchdog.stopAll()

    expect(released).toContainEqual(['wi-hb', 7])
  })
})

describe('Watchdog — liveness probe', () => {
  it('treats a running work item as live', async () => {
    const root = tempRoot('sup-wd-live-')
    const ledger = new SqliteLedger(join(root, '.opencode/supervisor.db'))
    await seedRun(ledger)
    await seedItem(ledger, { id: 'wi-live', state: 'running' })

    const liveness = await evaluateWorkItemLiveness(ledger, 'wi-live')
    expect(liveness.live).toBe(true)
    expect(liveness.reason).toBe('task_running')
    ledger.close()
  })

  it('treats an expired, unreleased lease with a stale heartbeat as not live', async () => {
    const root = tempRoot('sup-wd-stale-')
    const ledger = new SqliteLedger(join(root, '.opencode/supervisor.db'))
    await seedRun(ledger)
    await seedItem(ledger, { id: 'wi-stale' })
    await ledger.claimLease({
      workItemId: 'wi-stale',
      leaseOwner: 'worker-d',
      leaseExpiresAt: new Date(Date.now() - 1_000).toISOString(),
    })

    // Negative freshness window: the just-set heartbeat counts as stale, so
    // the expired lease is not rescued by "recent heartbeat" liveness.
    const liveness = await evaluateWorkItemLiveness(
      ledger,
      'wi-stale',
      Date.now(),
      -1,
    )
    expect(liveness.live).toBe(false)
    expect(liveness.leaseState).toBe('expired')
    ledger.close()
  })

  it('treats a missing task as not live', async () => {
    const root = tempRoot('sup-wd-absent-')
    const ledger = new SqliteLedger(join(root, '.opencode/supervisor.db'))
    const liveness = await evaluateWorkItemLiveness(ledger, 'wi-nope')
    expect(liveness.live).toBe(false)
    expect(liveness.reason).toBe('task_absent')
    ledger.close()
  })
})

describe('Watchdog — sweep classification', () => {
  const now = Date.now()
  const old = now - 40 * DAY_MS
  const fresh = now - 1 * DAY_MS

  function candidate(overrides: {
    live: boolean
    leaseState: LeaseState
    mtimeMs: number
    hasActiveAttempt?: boolean
  }) {
    return {
      worktree_id: 'wt-wi-a',
      path: '/repo/.worktrees/wt-wi-a',
      task_id: 'wi-a',
      mtime_ms: overrides.mtimeMs,
      live: overrides.live,
      live_reason: overrides.live ? 'task_running' : 'no_lease',
      has_active_attempt: overrides.hasActiveAttempt ?? false,
      lease_state: overrides.leaseState,
      dirty: false,
    }
  }

  it('skips live worktrees regardless of age', () => {
    const entry = classifyWorktreeSweep(
      candidate({ live: true, leaseState: 'active', mtimeMs: old }),
      30,
      now,
    )
    expect(entry.classification).toBe('KEEP')
    expect(entry.prune).toBe(false)
    expect(entry.reason.startsWith('live:')).toBe(true)
  })

  it('classifies an expired, inactive, aged worktree as SWEEP/PRUNE', () => {
    const entry = classifyWorktreeSweep(
      candidate({ live: false, leaseState: 'expired', mtimeMs: old }),
      30,
      now,
    )
    expect(entry.classification).toBe('SWEEP')
    expect(entry.prune).toBe(true)
  })

  it('keeps a non-expired (recent) worktree', () => {
    const entry = classifyWorktreeSweep(
      candidate({ live: false, leaseState: 'expired', mtimeMs: fresh }),
      30,
      now,
    )
    expect(entry.classification).toBe('KEEP')
    expect(entry.prune).toBe(false)
  })

  it('keeps a worktree holding an active attempt', () => {
    const entry = classifyWorktreeSweep(
      candidate({
        live: false,
        leaseState: 'released',
        mtimeMs: old,
        hasActiveAttempt: true,
      }),
      30,
      now,
    )
    expect(entry.classification).toBe('KEEP')
  })

  it('keeps runs that are active or not past the age gate, prunes the rest', () => {
    const base = {
      run_id: 'run-x',
      path: '/repo/.opencode/runs/run-x',
      mtime_ms: old,
      state: null,
      active: false,
      has_verification: true,
      has_receipt: true,
    }
    expect(classifyRunSweep(base, 30, now).classification).toBe('SWEEP')
    expect(classifyRunSweep({ ...base, active: true }, 30, now).classification).toBe(
      'KEEP',
    )
    expect(
      classifyRunSweep({ ...base, mtime_ms: fresh }, 30, now).classification,
    ).toBe('KEEP')
  })
})

describe('Plugin — supervisor_sweep', () => {
  it('apply=false is a dry run that makes no changes', async () => {
    const root = tempRoot('sup-sweep-dry-')
    const old = new Date(Date.now() - 40 * DAY_MS)
    mkdirSync(join(root, '.opencode/runs/run-old'), { recursive: true })
    utimesSync(join(root, '.opencode/runs/run-old'), old, old)

    const seed = new SqliteLedger(join(root, '.opencode/supervisor.db'))
    await tombstoneRun(seed, 'run-old')
    seed.close()

    const tools = await loadPluginTools(root)
    const report = JSON.parse(
      await tools.supervisor_sweep.execute({
        older_than_days: 30,
        json: true,
        apply: false,
      }),
    )

    expect(report.mode).toBe('dry-run')
    expect(report.runs.sweep.map((e: { run_id: string }) => e.run_id)).toContain(
      'run-old',
    )
    expect(report.prune_candidates).toContain('run-old')
    expect(report.removed).toEqual([])
    expect(existsSync(join(root, '.opencode/runs/run-old'))).toBe(true)
  })

  it('runs GC respects the active-run exclusion and the olderThan gate', async () => {
    const root = tempRoot('sup-sweep-gc-')
    const old = new Date(Date.now() - 40 * DAY_MS)
    for (const name of ['run-active', 'run-old', 'run-new']) {
      mkdirSync(join(root, '.opencode/runs', name), { recursive: true })
    }
    utimesSync(join(root, '.opencode/runs/run-active'), old, old)
    utimesSync(join(root, '.opencode/runs/run-old'), old, old)

    const seed = new SqliteLedger(join(root, '.opencode/supervisor.db'))
    await seedRun(seed, 'run-active')
    await advanceRunTo(seed, 'run-active', 'executing')
    await tombstoneRun(seed, 'run-old')
    seed.close()

    const tools = await loadPluginTools(root)
    const report = JSON.parse(
      await tools.supervisor_sweep.execute({
        older_than_days: 30,
        json: true,
        apply: true,
      }),
    )

    expect(report.mode).toBe('apply')
    const swept = report.runs.sweep.map((e: { run_id: string }) => e.run_id)
    expect(swept).toContain('run-old')
    expect(swept).not.toContain('run-active')
    expect(swept).not.toContain('run-new')

    expect(existsSync(join(root, '.opencode/runs/run-old'))).toBe(false)
    expect(existsSync(join(root, '.opencode/runs/run-active'))).toBe(true)
    expect(existsSync(join(root, '.opencode/runs/run-new'))).toBe(true)
  })

  it('notes verification/receipt subdirs per run entry', async () => {
    const root = tempRoot('sup-sweep-notes-')
    const old = new Date(Date.now() - 40 * DAY_MS)
    const runDir = join(root, '.opencode/runs/run-noted')
    mkdirSync(join(runDir, 'artifacts/verification'), { recursive: true })
    await Bun.write(join(runDir, 'receipt.md'), '# receipt')
    utimesSync(runDir, old, old)

    const seed = new SqliteLedger(join(root, '.opencode/supervisor.db'))
    await tombstoneRun(seed, 'run-noted')
    seed.close()

    const tools = await loadPluginTools(root)
    const report = JSON.parse(
      await tools.supervisor_sweep.execute({ older_than_days: 30, json: true }),
    )
    const entry = report.runs.sweep.find(
      (e: { run_id: string }) => e.run_id === 'run-noted',
    )
    expect(entry.has_verification).toBe(true)
    expect(entry.has_receipt).toBe(true)
  })
})

describe('Plugin — supervisor_patrol', () => {
  it('reports leaked worktrees, skips live ones, and only removes with remove=true', async () => {
    const root = tempRoot('sup-patrol-')
    await $`git -C ${root} init -q`.quiet()
    await $`git -C ${root} config user.email test@example.com`.quiet()
    await $`git -C ${root} config user.name test`.quiet()
    await Bun.write(join(root, 'README.md'), 'x')
    await $`git -C ${root} add -A`.quiet()
    await $`git -C ${root} commit -q -m init`.quiet()
    mkdirSync(join(root, '.worktrees'), { recursive: true })
    await $`git -C ${root} worktree add ${join(root, '.worktrees', 'wt-wi-leaked')} -b supervisor/wi-leaked`.quiet()
    await $`git -C ${root} worktree add ${join(root, '.worktrees', 'wt-wi-live')} -b supervisor/wi-live`.quiet()

    const ledger = new SqliteLedger(join(root, '.opencode/supervisor.db'))
    await seedRun(ledger)
    // A live task: state running => the patrol must keep its worktree.
    await seedItem(ledger, { id: 'wi-live', state: 'running' })
    ledger.close()

    const tools = await loadPluginTools(root)

    const dry = JSON.parse(
      await tools.supervisor_patrol.execute({ remove: false, json: true }),
    )
    expect(dry.leaked).toContain('wi-leaked')
    expect(dry.leaked).not.toContain('wi-live')
    expect(dry.kept_live).toContain('wi-live')
    expect(existsSync(join(root, '.worktrees/wt-wi-leaked'))).toBe(true)

    const applied = JSON.parse(
      await tools.supervisor_patrol.execute({ remove: true, json: true }),
    )
    expect(applied.removed.length).toBeGreaterThan(0)
    expect(existsSync(join(root, '.worktrees/wt-wi-leaked'))).toBe(false)
    // Live worktree untouched.
    expect(existsSync(join(root, '.worktrees/wt-wi-live'))).toBe(true)
  })
})

describe('Plugin — supervisor_verify uses the bounded runVerification path', () => {
  it('refuses a command list that differs from the recorded set', async () => {
    const root = tempRoot('sup-verify-')
    const ledger = new SqliteLedger(join(root, '.opencode/supervisor.db'))
    await seedRun(ledger)
    await seedItem(ledger, { id: 'wi-verify' })
    await ledger.createAttempt({
      id: 'att-1',
      workItemId: 'wi-verify',
      attemptNo: 1,
      harness: 'opencode-cli',
      modelProvider: 'opencode',
      modelId: 'deepseek-v4-pro',
      modelVariant: null,
      workspaceId: null,
      baseSha: '',
    })
    ledger.close()

    const tools = await loadPluginTools(root)
    const result = JSON.parse(
      await tools.supervisor_verify.execute({
        commands: ['echo verify-ok'],
        run_id: 'run-1',
        attempt_id: 'att-1',
      }),
    )
    // deliberate: substitution replaced by refusal (P2b, AC5)
    expect(result.refused).toBe(true)
    expect(result.reason).toBe('commands_differ_from_recorded')
    expect(result.recorded_commands).toEqual(['true'])
    expect(result.supplied_commands).toEqual(['echo verify-ok'])
    expect(result.results).toEqual([])
    const reader = new SqliteLedger(join(root, '.opencode/supervisor.db'))
    expect(await reader.getVerifications('att-1')).toEqual([])
    reader.close()
  })
})

describe('Runner — per-node retry and amend', () => {
  it('records node_retry / node_amended events and keeps state non-terminal', async () => {
    const root = tempRoot('sup-node-ops-')
    const runner = new Runner({
      repoRoot: root,
      mainRepoPath: root,
      worktreeBasePath: join(root, '.worktrees'),
    })
    const runId = await runner.createRun('t', 'low', 'internal', 'assisted')
    const itemId = await runner.addWorkItem(runId, {
      title: 'node ops',
      ownerRole: 'coder',
      modelSlot: 'implementation',
      priority: 0,
      writeScope: ['src/ops/**'],
      allowedPaths: ['src/ops/**'],
      acceptanceCriteria: ['existing criterion'],
      verificationCommands: ['true'],
    })

    // Simulate a failed first attempt, then retry the node.
    const seed = new SqliteLedger(join(root, '.opencode/supervisor.db'))
    await seed.createAttempt({
      id: 'att-prev',
      workItemId: itemId,
      attemptNo: 1,
      harness: 'opencode-cli',
      modelProvider: 'opencode',
      modelId: 'deepseek-v4-pro',
      modelVariant: null,
      workspaceId: null,
      baseSha: '',
    })
    await seed.transitionWorkItemState(itemId, 'failed')
    seed.close()

    const retry = await runner.retryNode(itemId, 'flaky_verification')
    expect(retry.previousAttemptId).toBe('att-prev')
    expect(retry.nextAttemptNo).toBe(2)
    expect(retry.state).toBe('ready')

    const amended = await runner.amendNode(itemId, {
      acceptanceCriteria: ['no new dependencies'],
      reason: 'scope narrowed',
    })
    expect(amended.acceptanceCriteria).toEqual([
      'existing criterion',
      'no new dependencies',
    ])
    expect(amended.added).toEqual(['no new dependencies'])

    const reader = new SqliteLedger(join(root, '.opencode/supervisor.db'))
    const events = await reader.getEvents(runId)
    const retryEvent = events.find((e) => e.event_type === 'node_retry')
    expect(retryEvent).toBeDefined()
    expect(JSON.parse(retryEvent!.payload_json).same_inputs).toBe(true)

    const amendEvent = events.find((e) => e.event_type === 'node_amended')
    expect(amendEvent).toBeDefined()
    expect(JSON.parse(amendEvent!.payload_json).added_criteria).toEqual([
      'no new dependencies',
    ])

    // No shortcut state jump: the node is schedulable, never completed.
    const item = await reader.getWorkItem(itemId)
    expect(item!.state).toBe('ready')
    expect(JSON.parse(item!.acceptance_criteria_json)).toEqual([
      'existing criterion',
      'no new dependencies',
    ])
    reader.close()
    runner.close()
  })
})

describe('Watchdog — constants', () => {
  it('exposes a positive heartbeat freshness window', () => {
    expect(HEARTBEAT_FRESH_MS).toBeGreaterThan(0)
  })
})

describe('Plugin — supervisor_verify runs the exact recorded set', () => {
  it('runs the recorded command and persists an exit-0 verification row', async () => {
    const root = tempRoot('sup-verify-exact-')
    const ledger = new SqliteLedger(join(root, '.opencode/supervisor.db'))
    await seedRun(ledger)
    await seedItem(ledger, { id: 'wi-verify' })
    await ledger.createAttempt({
      id: 'att-1',
      workItemId: 'wi-verify',
      attemptNo: 1,
      harness: 'opencode-cli',
      modelProvider: 'opencode',
      modelId: 'deepseek-v4-pro',
      modelVariant: null,
      workspaceId: null,
      baseSha: '',
    })
    ledger.close()

    const tools = await loadPluginTools(root)
    const result = JSON.parse(
      await tools.supervisor_verify.execute({
        commands: ['true'],
        run_id: 'run-1',
        attempt_id: 'att-1',
      }),
    )
    expect(result.refused).toBeUndefined()
    expect(result.all_passed).toBe(true)
    expect(result.results.length).toBe(1)
    expect(result.results[0].command).toBe('true')
    expect(result.results[0].exit_code).toBe(0)

    const reader = new SqliteLedger(join(root, '.opencode/supervisor.db'))
    const verifications = await reader.getVerifications('att-1')
    expect(verifications.length).toBe(1)
    expect(verifications[0].exit_code).toBe(0)
    reader.close()
  })
})
