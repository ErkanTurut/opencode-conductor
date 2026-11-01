#!/usr/bin/env bun

import { Runner } from './runner'
import { parseAgentsArgs, parseModelsArgs, runAgentsCommand, runModelsCommand } from './cli-models'
import type { AgentRole } from './types'

const args = process.argv.slice(2)
const command = args[0]

/** Commands that need the Runner (and its SqliteLedger) constructed. */
const RUNNER_COMMANDS = new Set(['run', 'resume', 'cancel', 'receipt', 'reconcile'])

function printHelp(): void {
  console.log(`
OpenCode Supervisor CLI

Usage:
  bun run src/cli.ts run <objective> [--risk low|medium|high|critical] [--profile local|assisted|unattended]
                               --memory none|disabled --memory-reason "<why>"
  bun run src/cli.ts resume <run-id>
  bun run src/cli.ts cancel <run-id>
  bun run src/cli.ts receipt <run-id> --memory none|disabled --memory-reason "<why>"
  bun run src/cli.ts list
  bun run src/cli.ts reconcile
  bun run src/cli.ts models <subcommand>
  bun run src/cli.ts agents <subcommand>

Model fleet commands:
  models list                                   Merged catalog + per-role effective assignments
  models set <role> <provider/model> [--variant v]
                                                Pin an agent role to a model
  models reset <role>                           Clear an agent role's model override
  models enable <model-id>                      Enable a model in the fleet
  models disable <model-id>                     Disable a model (excluded from selection)
  models sync-agents [--agents-dir <dir>]       Write persisted role overrides into agent file frontmatter
                                                (env fallback: FLEET_UI_AGENTS_DIR, default <cwd>/.opencode/agents)

Agent commands:
  agents list                                   Per-role steps override + model override
  agents set-steps <role> <n>                   Persist a step-limit override for a role
  agents reset <role>                           Clear a role's steps override

Options:
  --repo-root     Repository root path (default: current directory)
  --profile       Policy profile (default: assisted)
  --risk          Risk class (default: medium)
  --data-class    Data class (default: internal)
`)
}

async function handleRunnerCommand(
  command: string,
  args: string[],
  runner: Runner,
): Promise<void> {
  /** The CLI cannot spawn the curator subagent, so only explicit no-learning outcomes close here. */
  function memoryDecision(): { decision: 'none' | 'disabled'; rationale: string } {
    const decision = getFlag(args, '--memory')
    const rationale = getFlag(args, '--memory-reason')?.trim()
    if (decision !== 'none' && decision !== 'disabled') {
      fail('Provide --memory none|disabled and --memory-reason "<why>". Curated learning must run through supervisor_generate_receipt in OpenCode so memory-curator can inspect evidence and submit a proposal.')
    }
    if (!rationale) fail('Provide --memory-reason "<why>" so the learning decision is auditable.')
    return { decision, rationale }
  }

  switch (command) {
    case 'run': {
      const objectiveIndex = args.indexOf('run') + 1
      if (objectiveIndex >= args.length) {
        console.error('Error: Objective required')
        process.exit(1)
      }

      const objective = args[objectiveIndex]
      const riskClass = getFlag(args, '--risk') ?? 'medium'
      const profile = getFlag(args, '--profile') ?? 'assisted'
      const dataClass = getFlag(args, '--data-class') ?? 'internal'
      const memory = memoryDecision()

      console.log(`Creating run with profile: ${profile}, risk: ${riskClass}`)

      const runId = await runner.createRun(
        objective,
        riskClass,
        dataClass,
        profile,
      )
      console.log(`Run created: ${runId}`)

      // Add a basic work item for demonstration
      const itemId = await runner.addWorkItem(runId, {
        title: objective,
        ownerRole: 'coder' as AgentRole,
        modelSlot: 'implementation',
        priority: 0,
        writeScope: ['src/**'],
        allowedPaths: ['src/**', 'tests/**'],
        acceptanceCriteria: ['Changes compile and tests pass'],
        verificationCommands: ['bun run format', 'bun run lint'],
      })
      console.log(`Work item created: ${itemId}`)

      console.log('Executing task...')
      const result = await runner.executeTask(itemId)
      console.log(`Task result: ${result.success ? 'SUCCESS' : 'FAILED'}`)
      if (result.error) {
        console.log(`Error: ${result.error}`)
      }

      const receiptPath = await runner.generateRunReceipt(runId, { decision: memory })
      console.log(`Receipt written: ${receiptPath}`)

      break
    }

    case 'resume': {
      const runId = args[1]
      if (!runId) {
        console.error('Error: Run ID required')
        process.exit(1)
      }

      console.log(`Resuming run: ${runId}`)
      const result = await runner.resumeRun(runId)
      console.log(`Run state: ${result.state}`)
      break
    }

    case 'cancel': {
      const runId = args[1]
      if (!runId) {
        console.error('Error: Run ID required')
        process.exit(1)
      }

      console.log(`Cancelling run: ${runId}`)
      await runner.cancelRun(runId)
      console.log('Run cancelled')
      break
    }

    case 'receipt': {
      const runId = args[1]
      if (!runId) {
        console.error('Error: Run ID required')
        process.exit(1)
      }

      const receiptPath = await runner.generateRunReceipt(runId, { decision: memoryDecision() })
      console.log(`Receipt written: ${receiptPath}`)
      break
    }

    case 'reconcile': {
      console.log('Running startup reconciliation...')
      await runner.reconcile()
      console.log('Reconciliation complete')
      break
    }

    default:
      throw new Error(`unsupported runner command '${command}'`)
  }
}

// Never-returning helper: declared as a function so TypeScript narrows
// the enclosing flow after `fail(...)` calls.
function fail(error: string): never {
  console.error(`Error: ${error}`)
  process.exit(1)
}

function handleFleetCommand(group: 'models' | 'agents'): void {
  const rest = args.slice(1)

  if (group === 'models') {
    const parsed = parseModelsArgs(rest)
    if (!parsed.ok) fail(parsed.error)
    const result = runModelsCommand(parsed.value)
    if (!result.ok) fail(result.error)
    for (const line of result.value) console.log(line)
    return
  }

  const parsed = parseAgentsArgs(rest)
  if (!parsed.ok) fail(parsed.error)
  const result = runAgentsCommand(parsed.value)
  if (!result.ok) fail(result.error)
  for (const line of result.value) console.log(line)
}

async function main(): Promise<void> {
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printHelp()
    return
  }

  switch (command) {
    case 'models':
      handleFleetCommand('models')
      return

    case 'agents':
      handleFleetCommand('agents')
      return

    case 'list': {
      console.log('Listing active runs...')
      // This would require the ledger interface
      console.log('(Use the ledger interface directly for now)')
      return
    }
  }

  if (!RUNNER_COMMANDS.has(command)) {
    console.error(`Unknown command: ${command}`)
    printHelp()
    process.exit(1)
  }

  const repoRoot = process.env.REPO_ROOT ?? process.cwd()
  const worktreeBase = `${repoRoot}/.worktrees`

  const runner = new Runner({
    repoRoot,
    mainRepoPath: repoRoot,
    worktreeBasePath: worktreeBase,
  })

  try {
    await handleRunnerCommand(command, args, runner)
  } finally {
    runner.close()
  }
}

function getFlag(args: string[], flag: string): string | null {
  const idx = args.indexOf(flag)
  if (idx >= 0 && idx + 1 < args.length) {
    return args[idx + 1]
  }
  return null
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
