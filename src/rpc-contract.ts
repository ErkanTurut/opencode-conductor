// Conductor RPC contract — the only boundary between the server part and the
// Desktop GUI.
//
// This module deliberately imports nothing from the server implementation
// (no `bun:sqlite`, no `node:fs`). It is exported as `opencode-conductor/rpc`
// so other plugins and clients can import the token without loading the
// conductor runtime.
//
// Run projections are read-only. Explicit configuration saves use fixed server
// targets and revision checks; no method accepts an arbitrary filesystem path.

import { Rpc } from '@opencode/plugin/rpc'

// ---------------------------------------------------------------------------
// JSON Schema helpers
// ---------------------------------------------------------------------------

const empty = { type: 'object' as const, properties: {}, additionalProperties: false }
const envelope = { type: 'object' as const, additionalProperties: true }

function object(
  properties: Record<string, unknown>,
  required: readonly string[] = [],
) {
  return {
    type: 'object' as const,
    properties,
    ...(required.length > 0 ? { required: [...required] } : {}),
    additionalProperties: false,
  }
}

const string = { type: 'string' as const }
const number = { type: 'number' as const }
const strings = { type: 'array' as const, items: string }

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

export const CONDUCTOR_RPC_ID = 'conductor'

export const ConductorRpc = Rpc.define({
  id: CONDUCTOR_RPC_ID,
  methods: {
    /** Project identity, state layout, trust and policy summary. */
    workspace: {
      input: empty,
      output: envelope,
    },
    /** Native agent configuration and source provenance, without provider credentials. */
    configuration: {
      input: empty,
      output: envelope,
    },
    agentDocument: {
      input: object({ scope: { enum: ['project', 'global'] }, agentId: string }, ['scope', 'agentId']),
      output: envelope,
    },
    saveAgentConfiguration: {
      input: object({ scope: { enum: ['project', 'global'] }, agentId: string, expectedRevision: string,
        fields: { type: 'object', additionalProperties: true } }, ['scope', 'agentId', 'expectedRevision', 'fields']),
      output: envelope,
    },
    projectSettings: { input: empty, output: envelope },
    saveProjectSettings: {
      input: object({ expectedRevision: string, settings: { type: 'object', additionalProperties: true } }, ['expectedRevision', 'settings']),
      output: envelope,
    },
    /** Project governance configuration and explicitly reported integration capabilities. */
    project: {
      input: empty,
      output: envelope,
    },
    /** Runs for the current project, newest first. */
    runs: {
      input: object(
        {
          limit: number,
          cursor: string,
          states: strings,
        },
        [],
      ),
      output: envelope,
    },
    /** One run: summary, contract, budget, tasks, attempts, leases, approvals. */
    run: {
      input: object({ runId: string }, ['runId']),
      output: envelope,
    },
    /** Task graph: nodes, edges, layers, dangling references, cycles. */
    dag: {
      input: object({ runId: string }, ['runId']),
      output: envelope,
    },
    /** Plan/merge approvals, verification evidence and review findings. */
    gates: {
      input: object({ runId: string }, ['runId']),
      output: envelope,
    },
    /** Refinement state, Q&A, requirements contract and open questions. */
    refinements: {
      input: object({ runId: string }, ['runId']),
      output: envelope,
    },
    /** Project memory blocks, newest version first per label. */
    memory: {
      input: object({ limit: number }, []),
      output: envelope,
    },
    /** One memory block, optionally a specific version. */
    memoryBlock: {
      input: object({ label: string, version: number }, ['label']),
      output: envelope,
    },
    /** Fleet assignments and observed model routing from attempts. */
    routing: {
      input: object({ runId: string }, []),
      output: envelope,
    },
    /** Append-only run event timeline. */
    timeline: {
      input: object({ runId: string, afterSequence: number, limit: number }, ['runId']),
      output: envelope,
    },
  },
  events: {},
})

// ---------------------------------------------------------------------------
// Data shapes (TypeScript view of the JSON returned by the handlers)
// ---------------------------------------------------------------------------

export interface RpcError {
  code: string
  message: string
}

export type RpcEnvelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: RpcError }

export interface WorkspaceData {
  projectRoot: string
  projectKey: string
  mode: 'local' | 'central'
  ledgerPath: string
  runsDir: string
  memoryDir: string
  trusted: boolean
  policyRestricted: boolean
  counts: {
    runs: number
    activeRuns: number
    tasks: number
    attempts: number
  }
}

export interface ConfigurationAgent {
  id: string
  description: string
  mode: string
  system: string
  model: string | null
  variant: string | null
  steps: number | null
  permissions: unknown[]
  sources: Record<string, string>
  warnings: string[]
}

export interface ConfigurationData {
  agents: ConfigurationAgent[]
  models?: Array<{ id: string; name: string; variants: string[] }>
  nativeResolved: boolean
  readOnly: true
  warnings: string[]
  skillPolicy: string
}

export type ConfigurationScope = 'project' | 'global'
export interface ConfigurationPermission { action: string; resource: string; effect: 'allow' | 'ask' | 'deny' }
export interface AgentConfigurationFields {
  model: string
  steps: number | null
  system: string
  permissions: ConfigurationPermission[]
}
export interface AgentConfigurationDocument {
  agentId: string
  scope: ConfigurationScope
  target: string
  revision: string
  fields: AgentConfigurationFields
  writable: boolean
  warnings: string[]
}
export interface ProjectSettings {
  branches: { main: string; dev: string }
  verificationCommands: string[]
  preview: { provider: 'vercel' | 'other' | 'none'; url: string; branch: string }
  memory: { enabled: boolean }
}
export interface ProjectSettingsDocument {
  target: string
  revision: string
  settings: ProjectSettings | null
  warnings: string[]
}

export interface PreviewAwareness {
  provider: 'vercel' | 'other' | 'none' | 'unknown'
  configured: boolean
  url: string | null
  branch: string
  sources: string[]
  deploymentVerified: false
  guidance: string[]
}

export interface ProjectData {
  projectRoot: string
  branches: { main: string; dev: string } | null
  verificationCommands: string[]
  policy: {
    repository: string
    remotes: string[]
    targets: string[]
    operations: string[]
    requiredChecks: string[]
    previewProviders: string[]
    maxObservationAgeMs: number
  } | null
  policyHash: string | null
  policySource: string
  capabilities: { mergeExecutor: 'unavailable'; previewAdapter: 'unavailable'; remoteProtection: 'unknown' }
  warnings: string[]
  preview?: PreviewAwareness
}

export interface RunSummary {
  id: string
  state: string
  riskClass: string
  operationMode: string
  objective: string
  createdAt: string
  updatedAt: string
  taskCount: number
  counts: Record<string, number>
  hasReceipt: boolean
}

export interface RunsData {
  runs: RunSummary[]
  nextCursor: string | null
}

export interface RunTask {
  id: string
  title: string
  role: string
  modelSlot: string
  state: string
  priority: number
  attempts: number
  dependencies: string[]
  writeScope: string[]
  allowedPaths: string[]
  acceptanceCriteria: string[]
  verificationCommands: string[]
  latestAttempt: {
    id: string
    attemptNo: number
    state: string
    modelProvider: string
    modelId: string
    modelVariant: string | null
    startedAt: string | null
    finishedAt: string | null
    exitCode: number | null
    failureClass: string | null
    usage: unknown
    cost: unknown
  } | null
  lease: {
    owner: string
    expiresAt: string | null
    heartbeatAt: string | null
    fencingToken: number
  } | null
}

export interface RunDetailData {
  summary: RunSummary
  contract: unknown
  budget: unknown
  plan: unknown
  tasks: RunTask[]
  approvals: Array<{
    id: string
    gate: string
    decision: string
    actor: string
    createdAt: string
    expiresAt: string | null
  }>
  eventCount: number
  runDir: string | null
  planRevisions?: Array<{ revision: number; parentRevision: number | null; reason: string; createdAt: string }>
}

export interface DagNode {
  id: string
  title: string
  role: string
  modelSlot: string
  state: string
  priority: number
  attempts: number
  ghost: boolean
  layer: number
  dependencies: string[]
}

export interface DagEdge {
  from: string
  to: string
  resolved: boolean
}

export interface DagData {
  runId: string
  nodes: DagNode[]
  edges: DagEdge[]
  layers: string[][]
  roots: string[]
  leaves: string[]
  dangling: string[]
  cycles: string[][]
  maxDepth: number
  maxDepthBudget: number
}

export interface GateVerification {
  id: string
  command: string
  exitCode: number
  passed: boolean
  durationMs: number
  outputHash: string
  stdoutPath: string | null
  stderrPath: string | null
  startedAt: string
  finishedAt: string
}

export interface GateFinding {
  id: string
  severity: string
  category: string
  title: string
  location: string | null
  evidence: string
  confidence: number
  blocking: boolean
  status: string
  requiredFix: string | null
}

export interface GatesData {
  runId: string
  approvals: Array<{
    id: string
    gate: string
    decision: string
    actor: string
    createdAt: string
    expiresAt: string | null
  }>
  tasks: Array<{
    taskId: string
    title: string
    state: string
    attemptId: string | null
    attemptNo: number | null
    verifications: GateVerification[]
    findings: GateFinding[]
    blockingFindings: number
    openFindings: number
    passed: boolean | null
    requiredCommands?: string[]
    missingCommands?: string[]
  }>
  mergeReady: boolean
  /** Recorded evidence is not authorization to merge or push. */
  readiness?: {
    evidenceReady: boolean
    authoritative: false
    reasons: string[]
  }
}

export interface RefinementData {
  runId: string
  state: 'none' | 'awaiting' | 'completed' | 'declined' | 'unknown'
  uncertainties: string[]
  qaPairs: Array<{ question: string; answer: string }>
  outcome: string | null
  requirementsPath: string | null
  requirementsMarkdown: string | null
  contract: unknown
  events: Array<{
    sequence: number
    type: string
    actor: string
    createdAt: string
    payload: unknown
  }>
}

export interface MemoryBlockSummary {
  label: string
  version: number
  scope: string
  status: string
  confidence: number | null
  reviewAfter: string | null
  sourceRunId: string | null
  contentPreview: string
  updatedAt: string | null
  review?: MemoryReviewData
}

export interface MemoryReviewData {
  classification: 'approved' | 'unknown' | 'unreviewed' | 'stale' | 'conflicting'
  eligible: boolean
  reasons: string[]
  action: 'use' | 'propose_review'
}

export interface MemoryData {
  blocks: MemoryBlockSummary[]
  total: number
}

export interface MemoryBlockData {
  label: string
  version: number
  scope: string
  status: string
  confidence: number | null
  reviewAfter: string | null
  sourceRunId: string | null
  sourceArtifacts: string[]
  content: string
  contentHash: string | null
  actor: string | null
  supersedes: string | null
  review?: MemoryReviewData
}

export interface RoutingData {
  assignments: Array<{
    role: string
    model: string
    variant: string | null
    source: 'fleet' | 'unknown'
  }>
  observed: Array<{
    role: string
    modelSlot: string
    modelProvider: string
    modelId: string
    modelVariant: string | null
    attempts: number
    completed: number
    failed: number
    avgDurationMs: number | null
  }>
  costs: {
    byModel: Array<{
      model: string
      attempts: number
      tokens: number | null
      cost: number | null
      currency: string | null
    }>
    totalTokens: number | null
    totalCost: number | null
    currency: string | null
    coverage: { attempts: number; withUsage: number }
  }
}

export interface TimelineEvent {
  sequence: number
  type: string
  actor: string
  createdAt: string
  taskId: string | null
  attemptId: string | null
  summary: string
  payload: unknown
}

export interface TimelineData {
  runId: string
  events: TimelineEvent[]
  lastSequence: number
  truncated: boolean
}
