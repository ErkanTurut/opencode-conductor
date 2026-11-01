// Read-only, allowlisted configuration snapshots. Native configuration is resolved
// by OpenCode, not by a second JSONC loader with different merge semantics.
import {
  inspectAgentConfigs,
  loadAgentDefinitions,
  loadFleetConfig,
  type MutableAgentConfig,
} from '../register/agents'
import type { ConfigurationData, ProjectData } from '../rpc-contract'
import { hashProjectPolicy, parseProjectPolicy } from '../runtime/project-governance'

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null
}

/** Defense in depth: never include provider configuration, headers or credentials. */
export function redactConfigurationText(value: string): string {
  return value
    .replace(/\b(?:sk-|ghp_|github_pat_)[A-Za-z0-9_-]{12,}/g, '[redacted]')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+\/-]{12,}/gi, '$1[redacted]')
    .replace(/((?:api[_-]?key|password|secret|access[_-]?token)\s*[:=]\s*["']?)[^\s"'\n,;]+/gi, '$1[redacted]')
    .slice(0, 64_000)
}

export function buildConfigurationSnapshot(
  assetsDir: string | null,
  nativeValue?: unknown,
  modelValue?: unknown,
): ConfigurationData {
  const definitions = assetsDir ? loadAgentDefinitions(assetsDir, loadFleetConfig(assetsDir)) : []
  const native: Record<string, MutableAgentConfig> = Object.create(null)
  const raw = Array.isArray(nativeValue) ? nativeValue : Array.isArray(record(nativeValue)?.data) ? record(nativeValue)!.data as unknown[] : null
  if (raw) {
    const ids = new Set(definitions.map(agent => agent.id))
    for (const value of raw) {
      const item = record(value)
      if (!item || typeof item.id !== 'string' || !ids.has(item.id)) continue
      // Native API values are decoded by the host. Still copy only the fields
      // required by the inspector and validate their basic shape here.
      const model = record(item.model)
      native[item.id] = {
        ...(typeof item.description === 'string' ? { description: item.description } : {}),
        ...(typeof item.mode === 'string' && ['primary', 'subagent', 'all'].includes(item.mode)
          ? { mode: item.mode as 'primary' | 'subagent' | 'all' } : {}),
        // Arbitrary native prompts can contain credentials in unknown formats.
        // Do not treat heuristic redaction as a secrecy guarantee.
        ...(typeof item.system === 'string' ? { system: 'Native system text is withheld from RPC. Inspect or edit it in native agent configuration.' } : {}),
        ...(model && typeof model.providerID === 'string' && typeof model.id === 'string'
          ? { model: { providerID: model.providerID, id: model.id,
            ...(typeof model.variant === 'string' ? { variant: model.variant } : {}) } } : {}),
        ...(typeof item.steps === 'number' && Number.isSafeInteger(item.steps) && item.steps > 0
          ? { steps: item.steps } : {}),
        ...(Array.isArray(item.permissions) ? { permissions: item.permissions.flatMap(rule => {
          const r = record(rule)
          return r && typeof r.action === 'string' && typeof r.resource === 'string'
            && ['allow', 'ask', 'deny'].includes(String(r.effect))
            ? [{ action: r.action, resource: redactConfigurationText(r.resource), effect: r.effect as 'allow' | 'ask' | 'deny' }] : []
        }) } : {}),
      }
    }
  }
  return {
    models: (Array.isArray(modelValue) ? modelValue : Array.isArray(record(modelValue)?.data) ? record(modelValue)!.data as unknown[] : []).flatMap(value => {
      const model = record(value)
      if (!model || model.enabled === false || typeof model.id !== 'string' || typeof model.providerID !== 'string') return []
      return [{ id: `${model.providerID}/${model.id}`, name: typeof model.name === 'string' ? model.name : model.id,
        variants: (Array.isArray(model.variants) ? model.variants : []).flatMap(value => {
          const variant = record(value)
          return variant && typeof variant.id === 'string' ? [variant.id] : []
        }),
      }]
    }),
    agents: inspectAgentConfigs(definitions, native).map(agent => ({
      ...agent, system: redactConfigurationText(agent.system), model: agent.model ?? null,
      variant: agent.variant ?? null, steps: agent.steps ?? null, permissions: agent.permissions ?? [],
    })),
    nativeResolved: raw !== null,
    readOnly: true,
    warnings: raw ? ['Native values are host-resolved; individual source files are not exposed by the host.']
      : ['Native resolution unavailable. Packaged defaults are shown, not asserted as the effective host configuration.'],
    skillPolicy: 'OpenCode discovers skills natively. Agent skill access uses permission rules; there is no documented per-agent skills attachment field.',
  }
}

export function buildProjectSnapshot(input: {
  projectRoot: string
  branches?: { main: string; dev: string }
  verificationCommands?: string[]
  governance?: unknown
}): ProjectData {
  const policy = parseProjectPolicy(input.governance)
  return {
    projectRoot: input.projectRoot,
    branches: input.branches ?? null,
    verificationCommands: input.verificationCommands ?? [],
    policy,
    policyHash: policy ? hashProjectPolicy(policy) : null,
    policySource: 'OpenCode plugin options.governance (project configuration may only tighten broader authority)',
    capabilities: { mergeExecutor: 'unavailable', previewAdapter: 'unavailable', remoteProtection: 'unknown' },
    warnings: [
      ...(!policy ? ['No valid candidate-bound governance policy configured. Remote changes are not authorized by this view.'] : []),
      'No authenticated preview/remote-protection adapter or merge executor is connected. Local evidence is not merge authorization.',
    ],
  }
}
