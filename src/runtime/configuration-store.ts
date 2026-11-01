import { createHash, randomBytes } from 'node:crypto'
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export type ConfigurationAuthority = { projectRoot: string; configDir: string; assetsDir?: string | null; inheritedAgent?: string }
export type AgentScope = 'project' | 'global'
export type SkillRule = 'allow' | 'ask' | 'deny'
export type PermissionRule = { action: string; resource: string; effect: SkillRule }
export type AgentFields = { model: string; steps: number | null; system: string; permissions: PermissionRule[] }
export type AgentPatch = { model?: string; steps?: number | null; system?: string; permissions?: PermissionRule[] }
export type AgentConfiguration = { agentId: string; scope: AgentScope; target: string; revision: string; fields: AgentFields; writable: boolean; warnings: string[] }
export type ProjectSettings = { branches: { main: string; dev: string }; verificationCommands: string[]; preview: { provider: 'vercel' | 'other' | 'none'; url: string; branch: string }; memory: { enabled: boolean } }
export type ProjectSettingsDocument = { revision: string; settings: ProjectSettings | null; target: string; warnings: string[] }

const defaults: ProjectSettings = { branches: { main: 'main', dev: 'develop' }, verificationCommands: [], preview: { provider: 'none', url: '', branch: '' }, memory: { enabled: true } }
const revision = (text: string | null) => createHash('sha256').update(text === null ? 'missing\0' : `file\0${text}`).digest('hex')
// Test seam for simulating a non-cooperating writer just before the final check.
let beforeCommitForTests: (() => void) | undefined
export function __setConfigurationStoreBeforeCommitForTests(hook?: () => void): void { beforeCommitForTests = hook }
function root(path: string): string {
  if (!path || !existsSync(path) || lstatSync(path).isSymbolicLink()) throw new Error('Configuration root must be an existing non-symlink directory')
  const resolved = realpathSync(path)
  if (!lstatSync(resolved).isDirectory()) throw new Error('Configuration root must be a directory')
  return resolved
}
function target(base: string, parts: string[], create = false): string {
  let current = root(base)
  for (let i = 0; i < parts.length; i++) {
    current = join(current, parts[i])
    if (existsSync(current) || isLink(current)) {
      const stat = lstatSync(current)
      if (stat.isSymbolicLink()) throw new Error('Symlinks are not allowed in configuration paths')
      if (i < parts.length - 1 && !stat.isDirectory()) throw new Error('Configuration parent is not a directory')
      if (i === parts.length - 1 && !stat.isFile()) throw new Error('Configuration target is not a file')
    } else if (create && i < parts.length - 1) mkdirSync(current)
  }
  return current
}
function isLink(path: string): boolean { try { return lstatSync(path).isSymbolicLink() } catch (error: any) { if (error.code === 'ENOENT') return false; throw error } }
function read(path: string): string | null { try { return readFileSync(path, 'utf8') } catch (error: any) { if (error.code === 'ENOENT') return null; throw error } }
function atomicSave(resolve: (create: boolean) => string, expected: string, produce: (existing: string | null) => string, version: (existing: string | null) => string = revision): void {
  const path = resolve(true)
  const lock = `${path}.lock`
  let fd: number | undefined
  let temp: string | undefined
  try {
    fd = openSync(lock, 'wx', 0o600)
    const checked = resolve(false)
    const existing = read(checked)
    if (version(existing) !== expected) throw new Error('Configuration revision conflict')
    const content = produce(existing)
    temp = join(dirname(path), `.${randomBytes(16).toString('hex')}.tmp`)
    writeFileSync(temp, content, { flag: 'wx', mode: 0o600 })
    beforeCommitForTests?.()
    const finalPath = resolve(false)
    if (version(read(finalPath)) !== expected) throw new Error('Configuration revision conflict')
    // A non-cooperating process can still race between this check and rename.
    renameSync(temp, path)
    temp = undefined
  } finally {
    if (temp) try { unlinkSync(temp) } catch {}
    if (fd !== undefined) { closeSync(fd); unlinkSync(lock) }
  }
}
function agentPath(authority: ConfigurationAuthority, scope: AgentScope, id: string, create = false): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(id)) throw new Error('Invalid agent ID')
  if (scope !== 'project' && scope !== 'global') throw new Error('Invalid agent scope')
  return target(scope === 'project' ? authority.projectRoot : authority.configDir, scope === 'project' ? ['.opencode', 'agents', `${id}.md`] : ['agents', `${id}.md`], create)
}
function splitMarkdown(text: string): { front: string; body: string; newline: string } {
  const newline = text.includes('\r\n') ? '\r\n' : '\n'
  if (!/^---\r?\n/.test(text)) return { front: '', body: text, newline }
  const match = /^---\r?\n([\s\S]*?)^---[ \t]*(?:\r?\n|$)/m.exec(text)
  if (!match) throw new Error('Invalid Markdown frontmatter')
  return { front: match[1], body: text.slice(match[0].length), newline }
}
function parseFront(front: string): Record<string, any> {
  const keys = new Set<string>()
  for (const line of front.split(/\r?\n/)) {
    if (/^-\s/.test(line)) continue
    const match = /^((?:"(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s:#][^:]*?))\s*:/.exec(line)
    if (!match) continue
    const key = Bun.YAML.parse(match[1])
    if (typeof key !== 'string') throw new Error('Invalid frontmatter key')
    if (keys.has(key)) throw new Error('Duplicate frontmatter key')
    keys.add(key)
  }
  const parsed = front.trim() ? Bun.YAML.parse(front) : {}
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid Markdown frontmatter')
  return parsed as Record<string, any>
}
function section(front: string, key: string): { start: number; end: number; text: string } | undefined {
  const lines = front.split(/(?<=\n)/)
  let offset = 0
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const match = /^((?:"(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s:#][^:]*?))\s*:/.exec(line)
    let parsed: unknown
    if (match) { try { parsed = Bun.YAML.parse(match[1]) } catch {} }
    if (parsed === key) {
      let end = offset + line.length
      let pending = 0
      for (let j = i + 1; j < lines.length; j++) {
        if (/^\s*(?:#.*)?(?:\r?\n|$)/.test(lines[j])) { pending += lines[j].length; continue }
        if (!/^[ \t]/.test(lines[j]) && !/^-\s/.test(lines[j])) break
        end += pending + lines[j].length
        pending = 0
      }
      return { start: offset, end, text: front.slice(offset, end) }
    }
    offset += line.length
  }
}
function replaceSection(front: string, key: string, value: string, nl: string): string {
  const found = section(front, key)
  if (found) return front.slice(0, found.start) + value + front.slice(found.end)
  return front + (front && !front.endsWith('\n') ? nl : '') + value
}
function validateFields(fields: AgentPatch): void {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields) || Object.keys(fields).some(key => !['model', 'steps', 'system', 'permissions'].includes(key))) throw new Error('Invalid agent fields')
  if (fields.model !== undefined && (typeof fields.model !== 'string' || fields.model !== '' && !/^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._:/-]*(?:#[A-Za-z0-9][A-Za-z0-9._-]*)?$/.test(fields.model) || fields.model.length > 256)) throw new Error('Invalid model')
  if (fields.steps !== undefined && fields.steps !== null && (!Number.isInteger(fields.steps) || fields.steps < 1 || fields.steps > 10000)) throw new Error('Invalid steps')
  if (fields.system !== undefined && (typeof fields.system !== 'string' || fields.system.length > 1_000_000)) throw new Error('Invalid system prompt')
  if (fields.permissions !== undefined && (!Array.isArray(fields.permissions) || fields.permissions.length > 1000 || fields.permissions.some(rule => !rule || typeof rule.action !== 'string' || !rule.action || rule.action.length > 256 || /[\x00-\x1f\x7f]/.test(rule.action) || typeof rule.resource !== 'string' || !rule.resource || rule.resource.length > 256 || !['allow', 'ask', 'deny'].includes(rule.effect)))) throw new Error('Invalid permissions')
}
function fieldsFrom(text: string): AgentFields {
  const { front, body } = splitMarkdown(text)
  const data = parseFront(front)
  let model = ''
  if (typeof data.model === 'string') model = data.model
  else if (data.model !== undefined) {
    const value = data.model
    const modelId = value?.model ?? value?.id
    if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.providerID !== 'string' || typeof modelId !== 'string' || (value.variant !== undefined && typeof value.variant !== 'string')) throw new Error('Invalid agent model')
    model = `${value.providerID}/${modelId}${value.variant ? `#${value.variant}` : ''}`
  }
  if (data.variant !== undefined && typeof data.variant !== 'string' || data.steps !== undefined && (typeof data.steps !== 'number' || !Number.isInteger(data.steps))) throw new Error('Invalid agent frontmatter')
  if (data.variant && model && !model.includes('#')) model += `#${data.variant}`
  const permissions: PermissionRule[] = []
  if (data.permissions !== undefined) {
    if (!Array.isArray(data.permissions)) throw new Error('Invalid permissions list')
    for (const rule of data.permissions) {
      validateFields({ permissions: [rule] })
      permissions.push({ action: rule.action, resource: rule.resource, effect: rule.effect })
    }
  } else if (data.permission !== undefined) {
    if (!data.permission || typeof data.permission !== 'object' || Array.isArray(data.permission)) throw new Error('Invalid permission block')
    for (const [source, entry] of Object.entries(data.permission)) {
      const action = source === 'bash' ? 'shell' : source === 'task' ? 'subagent' : source
      if (typeof entry === 'string' && ['allow', 'ask', 'deny'].includes(entry)) permissions.push({ action, resource: '*', effect: entry as SkillRule })
      else if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        for (const [resource, effect] of Object.entries(entry)) {
          if (typeof effect !== 'string' || !['allow', 'ask', 'deny'].includes(effect)) throw new Error('Invalid permission rule')
          permissions.push({ action, resource, effect: effect as SkillRule })
        }
      } else throw new Error('Invalid permission rule')
    }
  }
  validateFields({ permissions })
  return { model, steps: data.steps ?? null, system: body, permissions }
}
function removeSection(front: string, key: string): string {
  const found = section(front, key)
  return found ? front.slice(0, found.start) + front.slice(found.end) : front
}
function updateMarkdown(text: string, fields: AgentPatch): string {
  validateFields(fields)
  fieldsFrom(text)
  let { front, body, newline: nl } = splitMarkdown(text)
  if (fields.model !== undefined) {
    front = fields.model ? replaceSection(front, 'model', `model: ${JSON.stringify(fields.model)}${nl}`, nl) : removeSection(front, 'model')
    front = removeSection(front, 'variant')
  }
  if (fields.steps !== undefined) {
    if (fields.steps === null) front = removeSection(front, 'steps')
    else front = replaceSection(front, 'steps', `steps: ${fields.steps}${nl}`, nl)
  }
  if (fields.permissions !== undefined) {
    front = removeSection(front, 'permission')
    const content = fields.permissions.length ? `permissions:${nl}${fields.permissions.map(rule => `  - action: ${JSON.stringify(rule.action)}${nl}    resource: ${JSON.stringify(rule.resource)}${nl}    effect: ${rule.effect}${nl}`).join('')}` : `permissions: []${nl}`
    front = replaceSection(front, 'permissions', content, nl)
  }
  if (fields.system !== undefined) body = fields.system
  return `---${nl}${front}${front && !front.endsWith('\n') ? nl : ''}---${nl}${body}`
}
function warnings(authority: ConfigurationAuthority): string[] {
  const found = [authority.projectRoot, authority.configDir].some(base => existsSync(base) && ['opencode.json', 'opencode.jsonc'].some(name => existsSync(join(root(base), name))))
  return found ? ['Native OpenCode JSON/JSONC configuration may take precedence; a saved Markdown file does not guarantee an effective change.'] : []
}
function defaultAgent(authority: ConfigurationAuthority, id: string, scope: AgentScope): string | null {
  if (authority.inheritedAgent !== undefined) {
    if (typeof authority.inheritedAgent !== 'string') throw new Error('Invalid inherited agent')
    return authority.inheritedAgent
  }
  if (scope === 'project' && (existsSync(authority.configDir) || isLink(authority.configDir))) {
    const global = read(agentPath(authority, 'global', id))
    if (global !== null) return global
  }
  if (!authority.assetsDir) return null
  return read(target(authority.assetsDir, ['agents', `${id}.md`]))
}
function agentRevision(authority: ConfigurationAuthority, id: string, scope: AgentScope, text: string | null): string {
  if (text !== null) return revision(text)
  const source = defaultAgent(authority, id, scope)
  return source === null ? revision(null) : createHash('sha256').update('inherited\0').update(source).digest('hex')
}
export function readAgentDocument(authority: ConfigurationAuthority, input: { agentId: string; scope: AgentScope }): AgentConfiguration {
  const { agentId, scope } = input
  const path = agentPath(authority, scope, agentId)
  const text = read(path)
  const fallback = text === null ? defaultAgent(authority, agentId, scope) : null
  return { agentId, scope, target: path, revision: agentRevision(authority, agentId, scope, text), fields: fieldsFrom(text ?? fallback ?? ''), writable: true, warnings: [...warnings(authority), ...(text === null && fallback === null ? ['No inherited agent prompt was found; provide a complete system prompt to create this override.'] : [])] }
}
export function saveAgentDocument(authority: ConfigurationAuthority, input: { agentId: string; scope: AgentScope; expectedRevision: string; fields: AgentPatch }): AgentConfiguration {
  const { agentId, scope, expectedRevision, fields } = input
  validateFields(fields)
  atomicSave(create => agentPath(authority, scope, agentId, create), expectedRevision, existing => {
    const source = existing ?? defaultAgent(authority, agentId, scope)
    if (source === null && fields.system === undefined) throw new Error('Cannot create an override without a source prompt')
    if (existing === null && source !== null) {
      const inherited = fieldsFrom(source)
      return updateMarkdown(source, { model: inherited.model, permissions: inherited.permissions, ...fields })
    }
    return updateMarkdown(source ?? '', fields)
  }, existing => agentRevision(authority, agentId, scope, existing))
  return readAgentDocument(authority, { agentId, scope })
}
function validRef(value: unknown, empty = false): value is string {
  return typeof value === 'string' && (empty && value === '' || value.length > 0 && value.length <= 255 && !/^(?:\/|\.|@)$/.test(value) && !/[\x00-\x20\x7f~^:?*\\\[]/.test(value) && !value.includes('..') && !value.includes('@{') && !value.includes('//') && !value.endsWith('/') && !value.endsWith('.') && value.split('/').every(part => !!part && !part.startsWith('.') && !part.endsWith('.lock')))
}
function validateSettings(settings: ProjectSettings): void {
  if (!settings || typeof settings !== 'object' || !settings.branches || !validRef(settings.branches.main) || !validRef(settings.branches.dev)) throw new Error('Invalid branch name')
  if (!Array.isArray(settings.verificationCommands) || settings.verificationCommands.length > 50 || settings.verificationCommands.some(command => typeof command !== 'string' || !command.trim() || command.length > 2048 || /[\0\r\n]/.test(command))) throw new Error('Invalid verification commands')
  if (!settings.preview || !['vercel', 'other', 'none'].includes(settings.preview.provider) || !validRef(settings.preview.branch, true) || typeof settings.preview.url !== 'string' || settings.preview.url.length > 2048) throw new Error('Invalid preview settings')
  if (settings.preview.url) { try { if (!['http:', 'https:'].includes(new URL(settings.preview.url).protocol)) throw new Error() } catch { throw new Error('Invalid preview URL') } }
  if (!settings.memory || typeof settings.memory.enabled !== 'boolean') throw new Error('Invalid memory settings')
}
function projectPath(authority: ConfigurationAuthority, create = false): string { return target(authority.projectRoot, ['.opencode', 'conductor.json'], create) }
function projectObject(text: string | null): Record<string, any> {
  const value = text === null ? {} : JSON.parse(text)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid conductor configuration')
  return value
}
function settingsFrom(value: Record<string, any>): ProjectSettings {
  for (const key of ['branches', 'preview', 'memory']) {
    if (value[key] !== undefined && (!value[key] || typeof value[key] !== 'object' || Array.isArray(value[key]))) throw new Error('Invalid project settings')
  }
  const settings = { branches: { ...defaults.branches, ...value.branches }, verificationCommands: value.verificationCommands ?? defaults.verificationCommands, preview: { ...defaults.preview, ...value.preview }, memory: { ...defaults.memory, ...value.memory } }
  validateSettings(settings)
  return settings
}
export function readProjectSettings(authority: ConfigurationAuthority): ProjectSettingsDocument {
  const path = projectPath(authority)
  const text = read(path)
  return { revision: revision(text), settings: text === null ? null : settingsFrom(projectObject(text)), target: path, warnings: [] }
}
export function loadProjectSettings(projectRoot: string): ProjectSettings | null {
  const text = read(target(projectRoot, ['.opencode', 'conductor.json']))
  return text === null ? null : settingsFrom(projectObject(text))
}
export function saveProjectSettings(authority: ConfigurationAuthority, input: { expectedRevision: string; settings: ProjectSettings }): ProjectSettingsDocument {
  const { expectedRevision, settings } = input
  validateSettings(settings)
  atomicSave(create => projectPath(authority, create), expectedRevision, existing => {
    const value = projectObject(existing)
    if (existing !== null) settingsFrom(value)
    return JSON.stringify({ ...value, branches: { ...value.branches, ...settings.branches }, verificationCommands: settings.verificationCommands, preview: { ...value.preview, ...settings.preview }, memory: { ...value.memory, ...settings.memory } }, null, 2) + '\n'
  })
  return readProjectSettings(authority)
}
