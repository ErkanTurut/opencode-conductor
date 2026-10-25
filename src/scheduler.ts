// Provenance: the DAG validation, write-ownership conflict scan, and
// budget-slotted batch selection below are adapted from the OmO comparison
// notes (idea 3 — rung validation + rounds/sweep slot gating). Patterns
// only: no upstream source was copied. License: SUL-1.0.
import type { ILedger } from './ledger/interface'
import type { AgentRole } from './types'
import { MUTATING_ROLES, READ_ONLY_ROLES } from './types'
import type { BudgetConfig } from './types'

export interface SchedulerConfig {
  maxConcurrentMutating: number
  maxConcurrentScouts: number
}

export interface TaskBatch {
  mutating: Array<{
    id: string
    role: AgentRole
    priority: number
    title: string
  }>
  scouts: Array<{
    id: string
    role: AgentRole
    priority: number
    title: string
  }>
}

export class Scheduler {
  private ledger: ILedger

  constructor(ledger: ILedger) {
    this.ledger = ledger
  }

  async getNextBatch(runId: string, budget: BudgetConfig): Promise<TaskBatch> {
    const readyItems = await this.ledger.listReadyWorkItems(runId)
    const runningItems = await this.getRunningCounts(runId)

    const mutating: TaskBatch['mutating'] = []
    const scouts: TaskBatch['scouts'] = []

    const mutatingSlots =
      budget.max_concurrent_mutating_tasks - runningItems.mutating
    const scoutSlots = budget.max_concurrent_scouts - runningItems.scouts

    for (const item of readyItems) {
      const role = item.owner_role as AgentRole

      if (MUTATING_ROLES.has(role)) {
        if (mutating.length < mutatingSlots) {
          mutating.push({
            id: item.id,
            role,
            priority: item.priority,
            title: item.title,
          })
        }
      } else if (READ_ONLY_ROLES.has(role)) {
        if (scouts.length < scoutSlots) {
          scouts.push({
            id: item.id,
            role,
            priority: item.priority,
            title: item.title,
          })
        }
      }
    }

    return { mutating, scouts }
  }

  async getRunningCounts(
    runId: string,
  ): Promise<{ mutating: number; scouts: number }> {
    const allItems = await this.ledger.listWorkItems(runId)
    let mutating = 0
    let scouts = 0

    for (const item of allItems) {
      if (item.state !== 'running' && item.state !== 'claimed') continue
      const role = item.owner_role as AgentRole
      if (MUTATING_ROLES.has(role)) {
        mutating++
      } else if (READ_ONLY_ROLES.has(role)) {
        scouts++
      }
    }

    return { mutating, scouts }
  }

  validateWorkItemDependencies(
    items: Array<{
      id: string
      dependencyJson: string
      state: string
    }>,
  ): { valid: boolean; blockedItems: string[] } {
    const completed = new Set(
      items.filter((i) => i.state === 'completed').map((i) => i.id),
    )

    const blockedItems: string[] = []

    for (const item of items) {
      if (item.state !== 'pending' && item.state !== 'ready') continue
      const deps: string[] = JSON.parse(item.dependencyJson)
      const allResolved = deps.every((d) => completed.has(d))
      if (!allResolved) {
        blockedItems.push(item.id)
      }
    }

    return { valid: blockedItems.length === 0, blockedItems }
  }

  markReadyItems(runId: string): Promise<void> {
    return this.ledger.transaction(async (tx) => {
      const allItems = await tx.listWorkItems(runId)
      const completed = new Set(
        allItems.filter((i) => i.state === 'completed').map((i) => i.id),
      )

      for (const item of allItems) {
        if (item.state !== 'pending') continue
        const deps: string[] = JSON.parse(item.dependency_json)
        const allResolved = deps.every((d) => completed.has(d))
        if (allResolved) {
          await tx.transitionWorkItemState(item.id, 'ready')
        }
      }
    })
  }

  validateDag(items: Array<{ id: string; dependencyJson: string }>): {
    valid: boolean
    cycles: string[][]
  } {
    // Build adjacency list
    const graph: Record<string, string[]> = {}
    for (const item of items) {
      const deps: string[] = JSON.parse(item.dependencyJson)
      graph[item.id] = deps
    }

    // DFS-based cycle detection
    const visited = new Set<string>()
    const recStack = new Set<string>()
    const cycles: string[][] = []

    function dfs(node: string, path: string[]): boolean {
      visited.add(node)
      recStack.add(node)
      path.push(node)

      for (const dep of graph[node] ?? []) {
        if (!visited.has(dep)) {
          if (dfs(dep, [...path])) return true
        } else if (recStack.has(dep)) {
          const cycleStart = path.indexOf(dep)
          cycles.push(path.slice(cycleStart))
          return true
        }
      }

      recStack.delete(node)
      return false
    }

    for (const item of items) {
      if (!visited.has(item.id)) {
        dfs(item.id, [])
      }
    }

    return { valid: cycles.length === 0, cycles }
  }

  validateWriteOwnership(
    items: Array<{ id: string; writeScopeJson: string; state: string }>,
  ): {
    valid: boolean
    conflicts: Array<{ item1: string; item2: string; paths: string[] }>
  } {
    const conflicts: Array<{ item1: string; item2: string; paths: string[] }> =
      []

    // Only check parallel-capable items (not completed/failed)
    const activeItems = items.filter(
      (i) =>
        i.state === 'ready' || i.state === 'running' || i.state === 'pending',
    )

    for (let i = 0; i < activeItems.length; i++) {
      const paths1: string[] = JSON.parse(activeItems[i].writeScopeJson)
      for (let j = i + 1; j < activeItems.length; j++) {
        const paths2: string[] = JSON.parse(activeItems[j].writeScopeJson)
        const overlap = paths1.filter((p) => paths2.includes(p))
        if (overlap.length > 0) {
          conflicts.push({
            item1: activeItems[i].id,
            item2: activeItems[j].id,
            paths: overlap,
          })
        }
      }
    }

    return { valid: conflicts.length === 0, conflicts }
  }
}
