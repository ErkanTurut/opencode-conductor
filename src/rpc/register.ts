// RPC registration for the Conductor read-only GUI surface.
//
// `registerConductorRpc` is the only place that binds the shared contract
// (`src/rpc-contract.ts`) to server-side readers. Every handler:
//   - accepts `unknown` and narrows it with small guards (a method never takes a
//     filesystem path; ids are the only inputs);
//   - reads through a `LedgerReader`/artifact reader closed over the RESOLVED
//     state layout, so a caller cannot redirect a read;
//   - returns an envelope (`{ ok: true, data }` / `{ ok: false, error }`) and is
//     wrapped in try/catch, so a bad run id, a corrupt database or a legacy
//     schema degrades to an error envelope instead of crashing the server.
//
// Feature detection is deliberate: OpenCode runtimes before 2.2 expose no
// `ctx.rpc.register`. The panel stays empty and the plugin keeps working.
//
// Import note: extensionless specifiers (the package's `tsc --noEmit` baseline
// rejects `.ts`-suffixed imports).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ConductorRpc } from '../rpc-contract'
import type { RpcEnvelope } from '../rpc-contract'
import {
  LedgerReader,
  clampLimit,
  type LedgerAttemptRecord,
  type LedgerEventRecord,
  type LedgerTaskRecord,
} from '../read/ledger-reader'
import {
  hasReceiptFile,
  readMemoryBlock,
  readMemoryBlocks,
  readRequirements,
  runDirectory,
  type ArtifactRead,
} from '../read/artifacts'
import {
  buildDag,
  buildGates,
  buildMemory,
  buildMemoryBlock,
  buildRefinements,
  buildRouting,
  buildRunDetail,
  buildRuns,
  buildTimeline,
  buildWorkspace,
  type FleetModelEntry,
} from '../read/projections'
import type { StateLayout } from '../runtime/state-layout'

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface RegisterConductorRpcOptions {
  /** Canonical project root the handlers report (never used to read state). */
  projectRoot: string
  /** The resolved layout: the only filesystem authority the handlers use. */
  layout: StateLayout
  trusted: boolean
  policyRestricted: boolean
  /** Package assets directory (holds `fleet.json`); null when unresolvable. */
  assetsDir: string | null
}

// ---------------------------------------------------------------------------
// Envelopes and guards
// ---------------------------------------------------------------------------

type Envelope = RpcEnvelope<unknown>
type Guarded<T> = { ok: true; value: T } | { ok: false; message: string }
type Handler = (input: unknown) => Promise<Envelope>

export function okEnvelope(data: unknown): Envelope {
  return { ok: true, data }
}

export function errorEnvelope(code: string, message: string): Envelope {
  return { ok: false, error: { code, message } }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function detail(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message
  return String(error)
}

function guarded(method: string, fn: (input: Record<string, unknown>) => Promise<Envelope>): Handler {
  return async (input: unknown): Promise<Envelope> => {
    try {
      return await fn(asRecord(input) ?? {})
    } catch (error) {
      return errorEnvelope('internal', `${method}: ${detail(error)}`)
    }
  }
}

function requiredString(raw: Record<string, unknown>, key: string): Guarded<string> {
  const value = raw[key]
  if (typeof value !== 'string' || value.trim().length === 0) {
    return { ok: false, message: `\`${key}\` must be a non-empty string` }
  }
  return { ok: true, value }
}

function optionalString(raw: Record<string, unknown>, key: string): Guarded<string | undefined> {
  const value = raw[key]
  if (value === undefined || value === null) return { ok: true, value: undefined }
  if (typeof value !== 'string') {
    return { ok: false, message: `\`${key}\` must be a string when present` }
  }
  return { ok: true, value }
}

function optionalNumber(raw: Record<string, unknown>, key: string): Guarded<number | undefined> {
  const value = raw[key]
  if (value === undefined || value === null) return { ok: true, value: undefined }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return { ok: false, message: `\`${key}\` must be a non-negative number when present` }
  }
  return { ok: true, value }
}

function optionalStringArray(raw: Record<string, unknown>, key: string): Guarded<string[] | undefined> {
  const value = raw[key]
  if (value === undefined || value === null) return { ok: true, value: undefined }
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    return { ok: false, message: `\`${key}\` must be an array of strings when present` }
  }
  return { ok: true, value: value as string[] }
}

// ---------------------------------------------------------------------------
// Fleet config (soft read; a missing/malformed file is simply no assignments)
// ---------------------------------------------------------------------------

export function loadFleetModels(
  assetsDir: string | null | undefined,
): Record<string, FleetModelEntry> {
  if (!assetsDir) return {}
  try {
    const parsed: unknown = JSON.parse(
      readFileSync(join(assetsDir, 'fleet.json'), 'utf8'),
    )
    const models = asRecord(asRecord(parsed)?.models)
    if (!models) return {}
    const result: Record<string, FleetModelEntry> = {}
    for (const [role, value] of Object.entries(models)) {
      const entry = asRecord(value)
      const model = entry?.model
      if (typeof model !== 'string' || model.length === 0) continue
      result[role] = {
        model,
        variant: typeof entry?.variant === 'string' ? entry.variant : null,
      }
    }
    return result
  } catch {
    return {}
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

const REGISTER_MISSING_WARNING =
  '[conductor] rpc: the runtime exposes no rpc.register (OpenCode < 2.2); the Conductor panel stays empty'

/**
 * Register the Conductor RPC handlers. Never throws.
 *
 * Returns true only when the host accepted the registration. A host without
 * `ctx.rpc.register` is a warning, not a failure: the rest of the plugin (tools,
 * agents, skills) must keep working.
 */
export async function registerConductorRpc(
  ctx: any,
  options: RegisterConductorRpcOptions,
): Promise<boolean> {
  let register: ((definition: unknown, handlers: unknown) => Promise<unknown>) | null = null
  try {
    const rpc = ctx?.rpc
    if (rpc && typeof rpc.register === 'function') {
      register = rpc.register.bind(rpc)
    }
  } catch {
    register = null
  }
  if (!register) {
    console.warn(REGISTER_MISSING_WARNING)
    return false
  }

  const reader = new LedgerReader(options.layout.ledgerPath)
  const layout = options.layout

  const handlers: Record<string, Handler> = {
    workspace: guarded('workspace', async () => {
      return okEnvelope(
        buildWorkspace({
          projectRoot: options.projectRoot,
          layout,
          trusted: options.trusted,
          policyRestricted: options.policyRestricted,
          counts: reader.counts(),
        }),
      )
    }),

    runs: guarded('runs', async (input) => {
      const limitGuard = optionalNumber(input, 'limit')
      if (!limitGuard.ok) return errorEnvelope('invalid_input', limitGuard.message)
      const cursorGuard = optionalString(input, 'cursor')
      if (!cursorGuard.ok) return errorEnvelope('invalid_input', cursorGuard.message)
      const statesGuard = optionalStringArray(input, 'states')
      if (!statesGuard.ok) return errorEnvelope('invalid_input', statesGuard.message)

      const page = reader.runs({
        limit: clampLimit(limitGuard.value, 50, 200),
        cursor: cursorGuard.value ?? null,
        states: statesGuard.value ?? null,
      })
      const runs = page.runs.map((run) => ({
        ...run,
        // A receipt exists on disk long before `receipt_json` is written.
        hasReceipt: run.hasReceipt || hasReceiptFile(layout.runsDir, run.id),
      }))
      return okEnvelope(buildRuns({ runs, nextCursor: page.nextCursor }))
    }),

    run: guarded('run', async (input) => {
      const runIdGuard = requiredString(input, 'runId')
      if (!runIdGuard.ok) return errorEnvelope('invalid_input', runIdGuard.message)
      const run = reader.run(runIdGuard.value)
      if (!run) return errorEnvelope('not_found', `run ${runIdGuard.value} not found`)
      return okEnvelope(
        buildRunDetail({
          // A receipt exists on disk long before `receipt_json` is written.
          run: {
            ...run,
            hasReceipt: run.hasReceipt || hasReceiptFile(layout.runsDir, run.id),
          },
          tasks: reader.tasks(run.id),
          attempts: reader.attempts(run.id),
          leases: reader.leases(run.id),
          approvals: reader.approvals(run.id),
          eventCount: reader.eventCount(run.id),
          runDir: runDirectory(layout.runsDir, run.id),
        }),
      )
    }),

    dag: guarded('dag', async (input) => {
      const runIdGuard = requiredString(input, 'runId')
      if (!runIdGuard.ok) return errorEnvelope('invalid_input', runIdGuard.message)
      if (!reader.run(runIdGuard.value)) {
        return errorEnvelope('not_found', `run ${runIdGuard.value} not found`)
      }
      return okEnvelope(
        buildDag({ runId: runIdGuard.value, tasks: reader.tasks(runIdGuard.value) }),
      )
    }),

    gates: guarded('gates', async (input) => {
      const runIdGuard = requiredString(input, 'runId')
      if (!runIdGuard.ok) return errorEnvelope('invalid_input', runIdGuard.message)
      if (!reader.run(runIdGuard.value)) {
        return errorEnvelope('not_found', `run ${runIdGuard.value} not found`)
      }
      const runId = runIdGuard.value
      return okEnvelope(
        buildGates({
          runId,
          tasks: reader.tasks(runId),
          attempts: reader.attempts(runId),
          verifications: reader.verifications(runId),
          findings: reader.findings(runId),
          approvals: reader.approvals(runId),
        }),
      )
    }),

    refinements: guarded('refinements', async (input) => {
      const runIdGuard = requiredString(input, 'runId')
      if (!runIdGuard.ok) return errorEnvelope('invalid_input', runIdGuard.message)
      const runId = runIdGuard.value
      const run = reader.run(runId)
      if (!run) return errorEnvelope('not_found', `run ${runId} not found`)

      const runDir = runDirectory(layout.runsDir, runId)
      let requirements: ArtifactRead = { path: null, content: null, truncated: false }
      if (runDir) requirements = readRequirements(runDir, run.contract)
      const events: LedgerEventRecord[] = reader.eventsOfType(
        runId,
        ['refinement_requested', 'refinement_completed', 'refinement_declined'],
        200,
      )
      return okEnvelope(
        buildRefinements({
          run,
          contract: run.contract,
          events,
          requirements: { path: requirements.path, content: requirements.content },
        }),
      )
    }),

    memory: guarded('memory', async (input) => {
      const limitGuard = optionalNumber(input, 'limit')
      if (!limitGuard.ok) return errorEnvelope('invalid_input', limitGuard.message)
      const limit = clampLimit(limitGuard.value, 200, 1000)
      return okEnvelope(buildMemory(readMemoryBlocks(layout.memoryDir), limit))
    }),

    memoryBlock: guarded('memoryBlock', async (input) => {
      const labelGuard = requiredString(input, 'label')
      if (!labelGuard.ok) return errorEnvelope('invalid_input', labelGuard.message)
      const versionGuard = optionalNumber(input, 'version')
      if (!versionGuard.ok) return errorEnvelope('invalid_input', versionGuard.message)
      const version = versionGuard.value
      if (version !== undefined && (!Number.isInteger(version) || version < 1)) {
        return errorEnvelope('invalid_input', '`version` must be a positive integer when present')
      }
      const block = readMemoryBlock(layout.memoryDir, labelGuard.value, version ?? null)
      if (!block) {
        return errorEnvelope(
          'not_found',
          `memory block ${labelGuard.value}${version !== undefined ? `.v${version}` : ''} not found`,
        )
      }
      return okEnvelope(buildMemoryBlock(block))
    }),

    routing: guarded('routing', async (input) => {
      const runIdGuard = optionalString(input, 'runId')
      if (!runIdGuard.ok) return errorEnvelope('invalid_input', runIdGuard.message)

      let runId = runIdGuard.value ?? null
      if (runId !== null && !reader.run(runId)) {
        return errorEnvelope('not_found', `run ${runId} not found`)
      }
      if (runId === null) {
        // No run selected: report the newest run this project has.
        runId = reader.runs({ limit: 1 }).runs[0]?.id ?? null
      }

      let tasks: LedgerTaskRecord[] = []
      let attempts: LedgerAttemptRecord[] = []
      if (runId) {
        tasks = reader.tasks(runId)
        attempts = reader.attempts(runId)
      }
      return okEnvelope(
        buildRouting({
          runId,
          tasks,
          attempts,
          fleetModels: loadFleetModels(options.assetsDir),
        }),
      )
    }),

    timeline: guarded('timeline', async (input) => {
      const runIdGuard = requiredString(input, 'runId')
      if (!runIdGuard.ok) return errorEnvelope('invalid_input', runIdGuard.message)
      const afterGuard = optionalNumber(input, 'afterSequence')
      if (!afterGuard.ok) return errorEnvelope('invalid_input', afterGuard.message)
      const limitGuard = optionalNumber(input, 'limit')
      if (!limitGuard.ok) return errorEnvelope('invalid_input', limitGuard.message)

      const runId = runIdGuard.value
      if (!reader.run(runId)) return errorEnvelope('not_found', `run ${runId} not found`)
      const limit = clampLimit(limitGuard.value, 200, 500)
      const afterSequence = afterGuard.value ?? 0
      const events = reader.events(runId, afterSequence, limit + 1)
      return okEnvelope(buildTimeline({ runId, events, limit, afterSequence }))
    }),
  }

  try {
    await register(ConductorRpc, handlers)
    return true
  } catch (error) {
    console.error(`[conductor] rpc registration failed: ${detail(error)}`)
    return false
  }
}
