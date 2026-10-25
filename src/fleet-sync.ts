// Agent frontmatter sync: propagates persisted fleet-config overrides
// (per-role model refs, variants, and step limits) into OpenCode agent
// markdown files, and reports drift between the pinned model refs in those
// files and the registry of record (`config/models.json`). Only the `model:`,
// `variant:`, and `steps:` frontmatter lines are ever touched; roles without
// overrides are left untouched, and validation never rewrites a pin.

import * as nodeFs from 'node:fs'
import { join, resolve } from 'node:path'
import { AGENT_ROLES } from './types'
import type { AgentRole } from './types'
import {
  buildModelRegistry,
  loadFleetConfig,
  resolveFleetConfigPath,
} from './fleet-config'
import type { FleetModelOverride } from './fleet-config'
import type { ModelRegistry } from './model-router'

export const FLEET_UI_AGENTS_DIR_ENV_VAR = 'FLEET_UI_AGENTS_DIR'
export const DEFAULT_AGENTS_DIR_SEGMENT = '.opencode/agents'

/**
 * Resolve the agents directory: explicit argument > `FLEET_UI_AGENTS_DIR`
 * env var > `<cwd>/.opencode/agents`.
 */
export function resolveAgentsDir(explicitDir?: string): string {
  const candidate =
    explicitDir?.trim() || process.env[FLEET_UI_AGENTS_DIR_ENV_VAR]?.trim()
  if (candidate) return resolve(candidate)
  return resolve(join(process.cwd(), DEFAULT_AGENTS_DIR_SEGMENT))
}

export interface MarkdownPatch {
  model?: string
  /** `null` removes an existing reasoning variant. */
  variant?: string | null
  steps?: number
}

export interface MarkdownPatchResult {
  content: string
  /** Which of the patched keys actually changed. */
  changed: string[]
}

/**
 * Strip ASCII control characters (C0 range + DEL), including CR/LF, so a
 * hostile value can never break out of its frontmatter line. Belt and
 * braces against hand-edited configs that bypassed validation.
 */
export function stripControlChars(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]/g, '')
}

function patchLines(patch: MarkdownPatch): string[] {
  const lines: string[] = []
  if (patch.model !== undefined)
    lines.push(`model: ${stripControlChars(patch.model)}`)
  if (typeof patch.variant === 'string') {
    lines.push(`variant: ${stripControlChars(patch.variant)}`)
  }
  if (patch.steps !== undefined) lines.push(`steps: ${String(patch.steps)}`)
  return lines
}

/**
 * Rewrite `model:` / `variant:` / `steps:` lines inside the YAML frontmatter of an
 * agent markdown file's content. Missing keys are inserted immediately
 * after the opening `---` delimiter. Content outside those lines —
 * including other frontmatter keys and the whole body — is preserved
 * byte-for-byte. Content without frontmatter gets a minimal block
 * prepended.
 */
export function applyAgentOverridesToMarkdown(
  markdown: string,
  patch: MarkdownPatch,
): MarkdownPatchResult {
  const changed: string[] = []
  const lines = markdown.split('\n')

  // No frontmatter at all -> synthesize a minimal block at the top.
  if ((lines[0] ?? '').trim() !== '---') {
    if (
      patch.model === undefined &&
      patch.variant === undefined &&
      patch.steps === undefined
    ) {
      return { content: markdown, changed }
    }
    const block = ['---', ...patchLines(patch), '---', '']
    return {
      content: [...block, ...lines].join('\n'),
      changed: Object.keys(patch),
    }
  }

  // Find the closing delimiter; frontmatter spans [1, end).
  let closeIndex = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      closeIndex = i
      break
    }
  }
  const end = closeIndex === -1 ? lines.length : closeIndex

  // Replace first occurrence of each known key inside the frontmatter.
  const seen = new Set<string>()
  for (let i = 1; i < end; i++) {
    const match = lines[i].match(/^(\s*)(model|variant|steps)((?:\s*):(?:\s*))/)
    if (!match) continue
    const key = match[2]
    if (seen.has(key)) continue
    seen.add(key)
    if (key === 'model' && patch.model !== undefined) {
      const next = `${match[1]}model${match[3]}${stripControlChars(patch.model)}`
      if (lines[i] !== next) {
        lines[i] = next
        changed.push('model')
      }
    } else if (key === 'variant' && patch.variant !== undefined) {
      if (patch.variant === null) {
        lines.splice(i, 1)
        i -= 1
        changed.push('variant')
      } else {
        const next = `${match[1]}variant${match[3]}${stripControlChars(patch.variant)}`
        if (lines[i] !== next) {
          lines[i] = next
          changed.push('variant')
        }
      }
    } else if (key === 'steps' && patch.steps !== undefined) {
      const next = `${match[1]}steps${match[3]}${String(patch.steps)}`
      if (lines[i] !== next) {
        lines[i] = next
        changed.push('steps')
      }
    }
  }

  // Insert keys absent from the frontmatter right after the opening `---`.
  const inserts = patchLines({
    model: !seen.has('model') ? patch.model : undefined,
    variant: !seen.has('variant') ? patch.variant : undefined,
    steps: !seen.has('steps') ? patch.steps : undefined,
  })
  if (inserts.length > 0) {
    lines.splice(1, 0, ...inserts)
    for (const line of inserts) changed.push(line.split(':')[0])
  }

  return { content: lines.join('\n'), changed }
}

export type SyncAgentsResult =
  { ok: true; lines: string[] } | { ok: false; error: string; lines: string[] }

export interface SyncAgentsOptions {
  configPath?: string
  agentsDir?: string
}

/** A `model:` pin found in an agent file's frontmatter. */
export interface AgentModelPin {
  file: string
  modelRef: string
}

/**
 * Read the pinned `model:` ref from a markdown file's YAML frontmatter.
 * Returns null when the file has no frontmatter or no `model:` line. A pin
 * outside the frontmatter block is deliberately ignored — OpenCode only reads
 * the frontmatter, so neither do we.
 */
export function readAgentModelPin(markdown: string): string | null {
  const lines = markdown.split('\n')
  if ((lines[0] ?? '').trim() !== '---') return null
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') break
    const match = lines[i].match(/^\s*model:\s*(\S+)\s*$/)
    if (match) return match[1]
  }
  return null
}

/**
 * Every `model:` pin in `<agentsDir>/*.md`, sorted by file name for stable
 * output. Scans the directory rather than `AGENT_ROLES` so agent files without
 * a supervisor role (e.g. visual-sketch-translator) are covered too.
 */
export function scanAgentModelPins(agentsDir?: string): AgentModelPin[] {
  const dir = resolveAgentsDir(agentsDir)
  if (!nodeFs.existsSync(dir)) return []
  const files = nodeFs
    .readdirSync(dir)
    .filter((file) => file.endsWith('.md'))
    .sort()
  const pins: AgentModelPin[] = []
  for (const file of files) {
    const ref = readAgentModelPin(nodeFs.readFileSync(join(dir, file), 'utf8'))
    if (ref) pins.push({ file, modelRef: ref })
  }
  return pins
}

/**
 * Strict drift check: every pinned ref must exist in the merged registry
 * (built-in catalog ∪ `config/models.json` extraModels). Unknown refs produce a
 * warning naming the missing id — the pin is never rewritten, and a warning
 * never fails the sync, but it is no longer invisible.
 */
export function validateAgentModelRefs(
  registry: ModelRegistry,
  agentsDir?: string,
): string[] {
  const warnings: string[] = []
  for (const pin of scanAgentModelPins(agentsDir)) {
    if (registry[pin.modelRef]) continue
    warnings.push(
      `warn: agent '${pin.file}' pins unknown model ref '${pin.modelRef}' - register it in config/models.json (see 'models list')`,
    )
  }
  return warnings
}

/**
 * OpenCode v2.0.1's Markdown frontmatter loader drops `model` when the
 * value contains `#variant`, even though the v2 docs document that syntax.
 * Keep the model and variant in separate frontmatter fields; v2 accepts this
 * legacy-compatible shape and preserves the selected reasoning effort.
 */
function composeModelSelection(
  registry: ReturnType<typeof buildModelRegistry>,
  override: FleetModelOverride,
): { model: string; variant?: string } {
  const variant = override.variant ?? registry[override.modelRef]?.variant
  return variant
    ? { model: override.modelRef, variant }
    : { model: override.modelRef }
}

/**
 * Sync persisted per-role overrides into `<agentsDir>/<role>.md`
 * frontmatter. Roles without a persisted model override AND steps
 * override are skipped entirely. A missing agent file is reported as an
 * error (sync continues for remaining roles; overall result fails).
 */
export function syncAgentsFromConfig(
  options: SyncAgentsOptions = {},
): SyncAgentsResult {
  const configPath = resolveFleetConfigPath(options.configPath)
  const config = loadFleetConfig(configPath)
  const registry = buildModelRegistry(config) // validates the config before touching any files
  const agentsDir = resolveAgentsDir(options.agentsDir)

  const lines: string[] = []
  const errors: string[] = []
  // Drift check runs on the final state of the files, after any override was
  // applied: an override that registered its own ref can never warn, and a pin
  // that is not in the registry is reported with the missing id.
  const driftWarnings: string[] = []

  for (const role of AGENT_ROLES as readonly AgentRole[]) {
    const override = config.agentOverrides[role]
    const steps = config.steps?.[role]
    if (!override && steps === undefined) continue

    const filePath = join(agentsDir, `${role}.md`)
    if (!nodeFs.existsSync(filePath)) {
      errors.push(`missing agent file for role '${role}': ${filePath}`)
      continue
    }

    const original = nodeFs.readFileSync(filePath, 'utf8')
    const patch: MarkdownPatch = {}
    if (override) {
      const selection = composeModelSelection(registry, override)
      patch.model = selection.model
      patch.variant = selection.variant ?? null
    }
    if (steps !== undefined) patch.steps = steps

    const applied = applyAgentOverridesToMarkdown(original, patch)
    const summary = [
      override ? `model=${override.modelRef}` : 'model=(unchanged)',
      steps !== undefined ? `steps=${String(steps)}` : 'steps=(unchanged)',
    ].join(' ')

    if (applied.changed.length === 0) {
      lines.push(`${role}: unchanged (${summary})`)
      continue
    }
    nodeFs.writeFileSync(filePath, applied.content, 'utf8')
    lines.push(`${role}: updated ${applied.changed.join(', ')} (${summary})`)
  }

  driftWarnings.push(...validateAgentModelRefs(registry, agentsDir))

  if (errors.length > 0) {
    const primary = errors[0]
    const suffix = errors.length > 1 ? ` (+${errors.length - 1} more)` : ''
    return {
      ok: false,
      error: `${primary}${suffix}`,
      lines: [...lines, ...errors, ...driftWarnings],
    }
  }
  if (lines.length === 0) {
    return {
      ok: true,
      lines: [
        'no persisted agent overrides found - nothing to sync',
        ...driftWarnings,
      ],
    }
  }
  return { ok: true, lines: [...lines, ...driftWarnings] }
}
