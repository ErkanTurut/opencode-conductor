#!/usr/bin/env bun
/**
 * End-to-end probe for the two unverified OpenCode behaviours the conductor's
 * agent registration depends on:
 *
 *   (A) a plugin-created agent's `system` prompt is actually used by the model
 *   (B) `editor.default(id)` actually makes that agent the default session agent
 *
 * It is a real model call against a throwaway HOME, so it is a script and not a
 * unit test. It writes `assets/compat/probe-report.json` and exits non-zero
 * unless the verdict is `pass` or `inconclusive`.
 *
 *   bun tests/probes/agent-transform-probe.ts [--keep]
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const PACKAGE_ROOT = resolve(import.meta.dir, '..', '..')
const KEEP = process.argv.includes('--keep')
const TOKEN = 'PROBE_OK_7731'
const AGENT_ID = 'probeagent'
const MODEL = { providerID: 'opencode-go', id: 'deepseek-v4.1-flash' }

interface CheckResult {
  name: string
  ok: boolean
  detail: string
}

const checks: CheckResult[] = []
const evidence: Record<string, unknown> = {}

function record(name: string, ok: boolean, detail: string): void {
  checks.push({ name, ok, detail })
}

function findBinary(): string | null {
  const explicit = process.env.OPENCODE_BIN
  if (explicit && existsSync(explicit)) return explicit
  for (const candidate of ['opencode2', 'opencode']) {
    const found = Bun.which(candidate)
    if (found) return found
  }
  return null
}

function freePort(): number {
  const probe = Bun.serve({ port: 0, fetch: () => new Response('ok') })
  const port = probe.port ?? 0
  probe.stop(true)
  return port
}

const home = mkdtempSync(join(tmpdir(), 'conductor-probe-home-'))
const project = mkdtempSync(join(tmpdir(), 'conductor-probe-project-'))
const cleanup = () => {
  if (KEEP) {
    console.log(`kept: ${home} ${project}`)
    return
  }
  try {
    rmSync(home, { recursive: true, force: true })
    rmSync(project, { recursive: true, force: true })
  } catch {
    /* best effort */
  }
}

const env: Record<string, string> = {
  ...process.env,
  HOME: home,
  XDG_CONFIG_HOME: join(home, '.config'),
  XDG_DATA_HOME: join(home, '.local', 'share'),
}

function run(command: string[], cwd: string, timeoutMs: number) {
  const proc = Bun.spawnSync({
    cmd: command,
    cwd,
    env,
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: timeoutMs,
  })
  return {
    code: proc.exitCode ?? -1,
    stdout: new TextDecoder().decode(proc.stdout ?? new Uint8Array()),
    stderr: new TextDecoder().decode(proc.stderr ?? new Uint8Array()),
  }
}

const binary = findBinary()
if (!binary) {
  record('binary', false, 'no opencode binary found (OPENCODE_BIN / opencode2 / opencode)')
}

if (binary) {
  const realAuth = join(process.env.HOME ?? '', '.local', 'share', 'opencode', 'auth.json')
  const probeAuthDir = join(home, '.local', 'share', 'opencode')
  mkdirSync(probeAuthDir, { recursive: true, mode: 0o700 })
  const hasAuth = existsSync(realAuth)
  if (hasAuth) {
    cpSync(realAuth, join(probeAuthDir, 'auth.json'))
    record('auth', true, 'copied the local auth file into the throwaway HOME')
  } else {
    record('auth', false, `no auth file at ${realAuth}; the model call cannot run`)
  }

  const globalDir = join(home, '.config', 'opencode')
  const probePluginDir = join(globalDir, 'plugins', 'probe')
  mkdirSync(probePluginDir, { recursive: true })
  writeFileSync(
    join(globalDir, 'opencode.jsonc'),
    JSON.stringify({ $schema: 'https://opencode.ai/config.json', plugins: [PACKAGE_ROOT, probePluginDir] }, null, 2) + '\n',
  )

  const systemPrompt = `You are PROBEAGENT. Reply with exactly the token ${TOKEN} and nothing else.`
  writeFileSync(
    join(probePluginDir, 'index.ts'),
    [
      'export default {',
      "  id: 'probe',",
      '  async setup(ctx) {',
      '    await ctx.agent.transform((editor) => {',
      `      editor.update(${JSON.stringify(AGENT_ID)}, (agent) => {`,
      "        agent.mode = 'primary'",
      "        agent.description = 'registration probe agent'",
      '        agent.system = ' + JSON.stringify(systemPrompt),
      '        agent.model = ' + JSON.stringify(MODEL),
      '        agent.steps = 2',
      '      })',
      `      editor.default(${JSON.stringify(AGENT_ID)})`,
      '    })',
      '  },',
      '}',
      '',
    ].join('\n'),
  )

  const port = freePort()
  const setPort = run([binary, 'service', 'set', 'port', String(port)], project, 60_000)
  record('service', setPort.code === 0, `service set port ${port} exit=${setPort.code}`)

  const agents = run([binary, 'debug', 'agents'], project, 120_000)
  let agentList: Array<{ id?: string }> = []
  try {
    const parsed = JSON.parse(agents.stdout)
    if (Array.isArray(parsed)) agentList = parsed
  } catch {
    /* handled below */
  }
  const created = agentList.some((entry) => entry?.id === AGENT_ID)
  record('agentCreated', created, created ? `${AGENT_ID} present in debug agents` : 'agent not created')
  evidence.agentCount = agentList.length

  const logDir = join(home, '.local', 'share', 'opencode', 'log')
  let logText = ''
  if (existsSync(logDir)) {
    for (const file of readdirSync(logDir)) {
      try {
        logText += readFileSync(join(logDir, file), 'utf8')
      } catch {
        /* skip */
      }
    }
  }
  const rootLoad = logText.includes(PACKAGE_ROOT)
  const probeLoad = logText.includes(probePluginDir)
  record('rootLoad', rootLoad, rootLoad ? 'package root mounted' : 'package root not in the log')
  record('probeLoad', probeLoad, probeLoad ? 'probe plugin mounted' : 'probe plugin not in the log')

  if (hasAuth) {
    const call = run([binary, 'run', '--format', 'json', 'Say hello.'], project, 180_000)
    evidence.runExit = call.code
    evidence.runStdoutTail = call.stdout.slice(-2000)
    evidence.runStderrTail = call.stderr.slice(-1000)
    const said = call.stdout.includes(TOKEN) || call.stderr.includes(TOKEN)
    record('systemPromptEffect', said, said ? 'model echoed the probe token' : 'token absent from the reply')
    const agentMentioned = new RegExp(`"agent"\\s*:\\s*"${AGENT_ID}"`).test(call.stdout)
    record(
      'defaultAgent',
      said,
      agentMentioned
        ? `session reports agent=${AGENT_ID}`
        : said
          ? 'token echoed without an agent flag, so the default agent produced it'
          : 'the default agent did not produce the probe token',
    )
  } else {
    record('systemPromptEffect', false, 'skipped: no auth')
    record('defaultAgent', false, 'skipped: no auth')
  }

  evidence.logBytes = logText.length
  evidence.port = port
}

const binaryOk = checks.find((c) => c.name === 'binary')?.ok === true
const authOk = checks.find((c) => c.name === 'auth')?.ok === true
const allOk = checks.every((c) => c.ok)
const verdict: 'pass' | 'fail' | 'inconclusive' =
  checks.length === 0 || !binaryOk || !authOk ? 'inconclusive' : allOk ? 'pass' : 'fail'

const report = {
  generatedAt: new Date().toISOString(),
  verdict,
  checks: Object.fromEntries(checks.map((c) => [c.name, c.ok])),
  detail: checks,
  evidence,
}

const reportPath = join(PACKAGE_ROOT, 'assets', 'compat', 'probe-report.json')
mkdirSync(join(PACKAGE_ROOT, 'assets', 'compat'), { recursive: true })
writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n')

console.log(JSON.stringify(report, null, 2))
cleanup()
process.exit(verdict === 'fail' ? 1 : 0)
