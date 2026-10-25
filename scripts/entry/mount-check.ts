#!/usr/bin/env bun
/**
 * Opt-in mount check for the package-root entry — NOT part of `bun test`.
 *
 * Why it is not a unit test: it needs the real `opencode` binary, a real
 * background server, and a real plugin load. Nothing here can be faked without
 * re-implementing the very resolution rule under test ("OpenCode resolves
 * `index.ts`/`server.ts` at the configured directory and ignores
 * `package.json#main`"). So it runs on demand:
 *
 *     bun tools/opencode-conductor/scripts/entry/mount-check.ts
 *     bun tools/opencode-conductor/scripts/entry/mount-check.ts --keep
 *
 * What it proves, end to end:
 *   1. a config whose `plugins` entry is the package ROOT actually loads the
 *      plugin (the server log carries a `loading plugin` line for the root);
 *   2. no ERROR line mentions the plugin;
 *   3. the plugin wrote nothing into the project (recursive listing identical
 *      before/after).
 *
 * Isolation: a throwaway HOME and a throwaway non-git project, both under the
 * OS temp dir. Every XDG dir is redirected into that HOME so the real user
 * config and state are never read or written. Both are removed on exit unless
 * `--keep` is passed.
 *
 * Prints exactly one verdict line — `MOUNT_OK <package root>` (exit 0) or
 * `MOUNT_FAIL <reason>` (exit 1) — after the evidence lines.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const KEEP = process.argv.includes('--keep')

/** The package root: this file is `<root>/scripts/entry/mount-check.ts`. */
const PACKAGE_ROOT = realpathSync(resolve(import.meta.dir, '..', '..'))

/** Server log wait budget: the server has booted, we wait for the load line. */
const PLUGIN_LINE_TIMEOUT_MS = 20_000
/** Hard cap per opencode invocation, so a wedged server cannot hang the check. */
const COMMAND_TIMEOUT_MS = 180_000

type RunResult = {
  command: string
  exitCode: number | null
  signalCode: string | null
  stdout: string
  stderr: string
}

/** Recursive relative listing, sorted — the byte-identical comparison. */
function walk(dir: string, prefix = ''): string[] {
  const entries: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name
    entries.push(relative)
    if (entry.isDirectory()) entries.push(...walk(join(dir, entry.name), relative))
  }
  return entries.sort()
}

/** Strip `file://` and canonicalize when the path exists (tmpdir is a symlink on macOS). */
function normalizePath(value: string): string {
  const cleaned = value.replace(/^file:\/\//, '')
  try {
    return realpathSync(cleaned)
  } catch {
    return cleaned
  }
}

/** Parse `key=value` / `key="quoted value"` pairs out of one log line. */
function logAttrs(line: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  for (const match of line.matchAll(/([A-Za-z_][\w.]*)=("([^"]*)"|\S+)/g)) {
    const [, key, raw, quoted] = match
    attrs[key] = quoted ?? raw
  }
  return attrs
}

function resolveBinary(): string {
  const override = process.env.OPENCODE_BIN?.trim()
  if (override) {
    if (!existsSync(override)) {
      throw new Error(`OPENCODE_BIN is set but does not exist: ${override}`)
    }
    return override
  }
  for (const candidate of ['opencode2', 'opencode']) {
    const found = Bun.which(candidate)
    if (found) return found
  }
  throw new Error('no opencode binary found (set OPENCODE_BIN, or install opencode2/opencode)')
}

async function allocatePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, '127.0.0.1', () => resolveListen())
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()))
  if (!port) throw new Error('could not allocate a free port')
  return port
}

function run(command: string[], options: { cwd: string; env: Record<string, string> }): RunResult {
  const result = Bun.spawnSync({
    cmd: command,
    cwd: options.cwd,
    env: options.env,
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: COMMAND_TIMEOUT_MS,
  })
  return {
    command: command.join(' '),
    exitCode: result.exitCode,
    signalCode: result.signalCode ?? null,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  }
}

/** Concatenated contents of every `*.log` under the opencode log dir. */
function readLogs(logDir: string): string {
  if (!existsSync(logDir)) return ''
  const files = readdirSync(logDir).filter((name) => name.endsWith('.log')).sort()
  return files.map((name) => readFileSync(join(logDir, name), 'utf8')).join('\n')
}

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms))

/** The hermetic environment: every XDG root lives inside the throwaway HOME. */
function isolatedEnv(home: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !key.startsWith('OPENCODE_')) env[key] = value
  }
  env.HOME = home
  env.XDG_CONFIG_HOME = join(home, '.config')
  env.XDG_DATA_HOME = join(home, '.local', 'share')
  env.XDG_CACHE_HOME = join(home, '.cache')
  env.XDG_STATE_HOME = join(home, '.local', 'state')
  env.NO_COLOR = '1'
  return env
}

async function main(): Promise<string> {
  const binary = resolveBinary()
  const port = await allocatePort()

  const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'conductor-mount-check-')))
  const home = join(workspace, 'home')
  const project = join(workspace, 'project')
  const configDir = join(home, '.config', 'opencode')
  const configPath = join(configDir, 'opencode.jsonc')
  const logDir = join(home, '.local', 'share', 'opencode', 'log')
  mkdirSync(configDir, { recursive: true })
  mkdirSync(project, { recursive: true })

  const env = isolatedEnv(home)
  let serverStarted = false

  try {
    // The whole point: the *package root* is the configured plugin path.
    writeFileSync(
      configPath,
      `${JSON.stringify(
        {
          $schema: 'https://opencode.ai/config.json',
          plugins: [PACKAGE_ROOT],
        },
        null,
        2,
      )}\n`,
    )

    console.log(`mount-check: binary=${binary}`)
    console.log(`mount-check: package-root=${PACKAGE_ROOT}`)
    console.log(`mount-check: home=${home}`)
    console.log(`mount-check: project=${project}`)
    console.log(`mount-check: config=${configPath} plugins=["${PACKAGE_ROOT}"]`)

    // The project must be untouched by the plugin: snapshot before any boot.
    const before = walk(project)

    const portResult = run([binary, 'service', 'set', 'port', String(port)], {
      cwd: project,
      env,
    })
    if (portResult.exitCode !== 0) {
      throw new Error(
        `service set port failed (exit ${portResult.exitCode}): ${(portResult.stderr || portResult.stdout).trim().slice(0, 400)}`,
      )
    }

    // `debug agents` boots the background server, which loads the configured
    // plugins. Non-zero exits are reported but not fatal on their own: the
    // assertions below are about what the server actually did.
    const agents = run([binary, 'debug', 'agents'], { cwd: project, env })
    serverStarted = true
    console.log(`mount-check: debug agents exit=${agents.exitCode} (port ${port})`)
    if (agents.exitCode !== 0) {
      const detail = (agents.stderr || agents.stdout).trim().split('\n').slice(-3).join(' | ')
      console.log(`mount-check: debug agents stderr=${detail.slice(0, 400)}`)
    }

    // Wait for the root load line (or the deadline) before judging.
    const expectedEntrypoint = join(PACKAGE_ROOT, 'index.ts')
    const deadline = Date.now() + PLUGIN_LINE_TIMEOUT_MS
    let logs = ''
    let rootLoadLine: string | null = null
    while (Date.now() < deadline) {
      logs = readLogs(logDir)
      rootLoadLine =
        logs
          .split(/\r?\n/)
          .filter((line) => line.includes('loading plugin'))
          .find((line) => {
            const attrs = logAttrs(line)
            if (!attrs.id && !attrs.entrypoint) return false
            const idMatches = attrs.id ? normalizePath(attrs.id) === PACKAGE_ROOT : false
            const entryMatches = attrs.entrypoint
              ? normalizePath(attrs.entrypoint) === expectedEntrypoint
              : false
            return idMatches || entryMatches
          }) ?? null
      if (rootLoadLine) break
      await sleep(250)
    }

    if (!logs) {
      throw new Error(`no server log written under ${logDir}`)
    }

    if (!rootLoadLine) {
      const pluginLines = logs
        .split(/\r?\n/)
        .filter((line) => line.includes('loading plugin'))
        .slice(-3)
      console.log('LOG_ROOT_LOAD none — the package root never appears in a loading-plugin line')
      for (const line of pluginLines) console.log(`LOG_OTHER_PLUGIN ${line.slice(0, 300)}`)
      throw new Error(
        `plugin mount not observed for package root ${PACKAGE_ROOT} (plugins: [${PACKAGE_ROOT}])`,
      )
    }
    console.log(`LOG_ROOT_LOAD ${rootLoadLine.trim().slice(0, 400)}`)

    // The load line can precede a trailing error flush: give the server a
    // moment, then judge ERROR lines against the settled log.
    await sleep(500)
    logs = readLogs(logDir)

    // A load line plus an ERROR about the plugin is not a success.
    const pluginErrors = logs
      .split(/\r?\n/)
      .filter((line) => /level=(ERROR|FATAL)/.test(line))
      .filter((line) => /plugin|conductor/i.test(line) || line.includes(PACKAGE_ROOT))
    if (pluginErrors.length > 0) {
      for (const line of pluginErrors.slice(-5)) console.log(`LOG_PLUGIN_ERROR ${line.slice(0, 400)}`)
      throw new Error(`${pluginErrors.length} ERROR line(s) mention the plugin`)
    }
    console.log('LOG_PLUGIN_ERRORS none')

    // The plugin may only write in the conductor home, never in the project.
    const after = walk(project)
    const unchanged = JSON.stringify(before) === JSON.stringify(after)
    console.log(
      `PROJECT_DIR_UNCHANGED ${unchanged ? 'yes' : 'NO'} before=${before.length} after=${after.length}`,
    )
    if (!unchanged) {
      const added = after.filter((entry) => !before.includes(entry))
      const removed = before.filter((entry) => !after.includes(entry))
      console.log(`PROJECT_DIR_ADDED ${JSON.stringify(added.slice(0, 10))}`)
      console.log(`PROJECT_DIR_REMOVED ${JSON.stringify(removed.slice(0, 10))}`)
      throw new Error('the project directory listing changed during plugin load')
    }

    return PACKAGE_ROOT
  } finally {    if (KEEP) {
      console.log(`mount-check: kept ${workspace}`)
    } else {
      if (serverStarted) {
        // Best effort: never leave a background server pointed at a removed HOME.
        try {
          run([binary, 'service', 'stop'], { cwd: project, env })
        } catch {
          // The verdict is already decided; cleanup failures do not change it.
        }
      }
      rmSync(workspace, { recursive: true, force: true })
    }
  }
}

try {
  const packageRoot = await main()
  console.log(`MOUNT_OK ${packageRoot}`)
  process.exit(0)
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error)
  console.log(`MOUNT_FAIL ${reason.replace(/\s+/g, ' ').trim()}`)
  process.exit(1)
}
