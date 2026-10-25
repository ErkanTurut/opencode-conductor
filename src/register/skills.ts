// Skill registration for the global plugin entry.
//
// The conductor's workflow skills are package assets (`assets/skills/<id>/SKILL.md`),
// copied verbatim from the project's `.opencode/skills/` directory. Registering
// them through the runtime's `skill.transform` editor makes the whole workflow
// available to any folder the plugin runs in, without the operator having to
// copy files into their global config.
//
// Two invariants shape this module:
//   - loading is read-only and fail-soft: a directory without a readable
//     `SKILL.md` is skipped, never an exception;
//   - registration never throws. A skill is an enhancement, and a runtime that
//     refuses the transform must not take the supervisor's tools down with it —
//     so every failure becomes a `warnings` entry.
//
// `path` is the absolute path of the SKILL.md inside the package assets, not the
// directory, so a skill that references `references/...` resolves relative to
// the file the runtime loaded its content from.
//
// Import note: imports are extensionless because the package's `tsc --noEmit`
// baseline rejects `.ts`-suffixed specifiers (TS5097). Bun resolves the
// extensionless specifier at runtime.
import * as nodeFs from 'node:fs'
import { resolve } from 'node:path'

/** The file every skill directory must contain. */
export const SKILL_FILE_NAME = 'SKILL.md'

/**
 * One skill, in the shape the runtime's skill editor accepts.
 *
 * `id` is the asset directory name (the runtime's stable key), `name` and
 * `description` come from the SKILL.md frontmatter, `path` is the absolute
 * SKILL.md path (so sibling `references/` resolve), and `content` is the file
 * verbatim.
 */
export interface SkillAsset {
  id: string
  name: string
  description: string
  path: string
  content: string
}

/** The editor the runtime hands to a `skill.transform` callback. */
export interface SkillEditor {
  add(asset: SkillAsset): void
}

/** The part of `ctx` skill registration needs. Everything is optional. */
export interface SkillRegistrationContext {
  skill?: {
    transform?: (callback: (editor: SkillEditor) => unknown) => unknown
  }
}

/** One line of evidence for the operator: never thrown, always reported. */
export interface RegisterSkillsResult {
  registered: string[]
  warnings: string[]
}

function describeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  const cleaned = raw.replace(/\s+/g, ' ').trim()
  return cleaned.length > 0 ? cleaned : 'unknown error'
}

// ---------------------------------------------------------------------------
// SKILL.md frontmatter (no YAML dependency)
// ---------------------------------------------------------------------------

/** The two frontmatter scalars a skill registers with. */
export interface SkillFrontmatter {
  name: string
  description: string
}

function indentOf(line: string): number {
  const match = /^[ \t]*/.exec(line)
  return match ? match[0].replace(/\t/g, '  ').length : 0
}

/** True when `value` closes the quote it opened at index 0. */
function hasClosingQuote(value: string, quote: string): boolean {
  if (value.length < 2) return false
  const rest = value.slice(1)
  if (quote === '"') {
    // An escaped quote does not close the scalar.
    for (let index = 0; index < rest.length; index += 1) {
      if (rest[index] !== '"') continue
      if (rest[index - 1] === '\\') continue
      return true
    }
    return false
  }
  // Single quotes close on the first quote that is not doubled (`''`).
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] !== "'") continue
    if (rest[index + 1] === "'") {
      index += 1
      continue
    }
    return true
  }
  return false
}

/** Drop leading/trailing blank lines, keeping interior ones. */
function trimBlankEdges(lines: readonly string[]): string[] {
  let start = 0
  let end = lines.length
  while (start < end && lines[start].trim().length === 0) start += 1
  while (end > start && lines[end - 1].trim().length === 0) end -= 1
  return lines.slice(start, end)
}

/**
 * Read one top-level frontmatter scalar.
 *
 * Handles the four shapes a SKILL.md description actually takes: a bare value,
 * a quoted value, a folded (`>`) or literal (`|`) block, and a plain scalar
 * continued on more-indented lines. The continuation lines stop at the next
 * top-level key, so `metadata:` can never leak into a description.
 */
function readFrontmatterScalar(
  lines: readonly string[],
  key: string,
): string | undefined {
  const prefix = `${key}:`
  let start = -1
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (indentOf(line) !== 0) continue
    if (!line.trimStart().startsWith(prefix)) continue
    start = index
    break
  }
  if (start === -1) return undefined

  const line = lines[start]
  const raw = line.slice(line.indexOf(':') + 1).trim()

  const continuation: string[] = []
  let cursor = start + 1
  while (cursor < lines.length) {
    const next = lines[cursor]
    if (next.trim().length === 0) {
      continuation.push('')
      cursor += 1
      continue
    }
    if (indentOf(next) === 0) break
    continuation.push(next.trim())
    cursor += 1
  }

  // Block scalar: `>` folds every newline to a space, `|` keeps them.
  if (/^[>|][+-]?$/.test(raw)) {
    const body = trimBlankEdges(continuation)
    return raw.startsWith('>') ? body.join(' ').replace(/\s+/g, ' ').trim() : body.join('\n')
  }

  // Quoted scalar: a description may wrap inside its quotes.
  if (raw.startsWith('"') || raw.startsWith("'")) {
    const quote = raw[0]
    let combined = raw
    let index = 0
    while (!hasClosingQuote(combined, quote) && index < continuation.length) {
      combined += ` ${continuation[index]}`
      index += 1
    }
    if (hasClosingQuote(combined, quote)) {
      return combined.slice(1, combined.lastIndexOf(quote))
    }
    return combined.slice(1)
  }

  // Plain scalar: the value plus any folded continuation lines.
  const parts = [raw, ...trimBlankEdges(continuation)].filter(
    (part) => part.trim().length > 0,
  )
  return parts.join(' ').trim()
}

/**
 * Extract the leading `---` block and parse `name` / `description`.
 *
 * A file without frontmatter (or with an unterminated block) yields empty
 * strings rather than a throw: the skill still registers under its directory
 * id, which is what a body-only SKILL.md needs.
 */
export function parseSkillFrontmatter(markdown: string): SkillFrontmatter {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')

  let opening = 0
  while (opening < lines.length && lines[opening].trim().length === 0) opening += 1
  if (opening >= lines.length || lines[opening].trim() !== '---') {
    return { name: '', description: '' }
  }

  const closing = lines.findIndex(
    (line, index) => index > opening && line.trim() === '---',
  )
  if (closing === -1) return { name: '', description: '' }

  const frontmatter = lines.slice(opening + 1, closing)
  return {
    name: readFrontmatterScalar(frontmatter, 'name') ?? '',
    description: readFrontmatterScalar(frontmatter, 'description') ?? '',
  }
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/**
 * Load one asset per top-level directory that contains a readable `SKILL.md`.
 *
 * Deterministic order (directory name), so registration and any test over the
 * asset set are stable between runs. Never throws: an absent assets directory
 * yields an empty list.
 */
export function loadSkillAssets(assetsDir: string): SkillAsset[] {
  let entries: nodeFs.Dirent[]
  try {
    entries = nodeFs.readdirSync(assetsDir, { withFileTypes: true })
  } catch {
    return []
  }

  const ids = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort()

  const assets: SkillAsset[] = []
  for (const id of ids) {
    const path = resolve(assetsDir, id, SKILL_FILE_NAME)
    if (!nodeFs.existsSync(path)) continue

    let content: string
    try {
      content = nodeFs.readFileSync(path, 'utf8')
    } catch {
      continue
    }

    const frontmatter = parseSkillFrontmatter(content)
    assets.push({
      id,
      name: frontmatter.name.length > 0 ? frontmatter.name : id,
      description: frontmatter.description,
      path,
      content,
    })
  }

  return assets
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register every skill through `ctx.skill.transform(editor => editor.add(asset))`.
 *
 * Never throws. A missing transform, a throwing transform and a per-skill `add`
 * failure are all warnings; the remaining skills still register.
 */
export async function registerSkills(
  ctx: SkillRegistrationContext | null | undefined,
  assets: readonly SkillAsset[],
): Promise<RegisterSkillsResult> {
  const registered: string[] = []
  const warnings: string[] = []

  try {
    const skill = ctx?.skill
    const transform = skill?.transform
    if (typeof transform !== 'function') {
      throw new Error('the runtime exposes no skill.transform')
    }

    await transform.call(skill, (editor: SkillEditor) => {
      if (!editor || typeof editor.add !== 'function') {
        warnings.push('the skill editor exposes no add()')
        return
      }
      for (const asset of assets) {
        try {
          // Copy: the runtime owns the object it registers.
          editor.add({ ...asset })
          registered.push(asset.id)
        } catch (error) {
          warnings.push(`${asset.id}: skill registration failed: ${describeError(error)}`)
        }
      }
    })
  } catch (error) {
    warnings.push(`skill.transform registration failed: ${describeError(error)}`)
  }

  return { registered, warnings }
}
