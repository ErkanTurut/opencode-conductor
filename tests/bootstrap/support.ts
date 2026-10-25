// Shared fixtures for the P4 bootstrap / non-git / push-guard suite.
//
// The worktree tests use a REAL temporary git repository: `supervisor_worktree`
// delegates `git worktree add` to `WorktreeProvider`, which owns its own shell,
// so stubbing the plugin's `$` would not stub the lifecycle. The install command
// under test DOES run through the plugin's injected `$`, so the spy below is
// what proves the recorded command without executing a package manager.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  registerSupervisorTools,
  resolveSupervisorConfig,
  type CollectedTool,
  type ToolRegistrar,
} from '../../src/plugin'

/** An empty temporary directory (unique per call). */
export function makeDir(name: string): string {
  return mkdtempSync(join(tmpdir(), `conductor-p4-${name}-`))
}

function git(args: string[], cwd: string): void {
  const result = Bun.spawnSync({
    cmd: ['git', ...args],
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  if ((result.exitCode ?? 1) !== 0) {
    throw new Error(
      `git ${args.join(' ')} failed in ${cwd}: ${result.stderr.toString()}`,
    )
  }
}

/** A real git repository with one commit and the given files. */
export function makeGitRepo(
  name: string,
  files: Record<string, string>,
): string {
  const root = makeDir(name)
  git(['init', '-q', '-b', 'main'], root)
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content)
  }
  git(['add', '-A'], root)
  git(
    [
      '-c',
      'user.email=conductor-p4@example.test',
      '-c',
      'user.name=Conductor P4',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-q',
      '-m',
      'init',
    ],
    root,
  )
  return root
}

/** A registrar-shaped `$` that records the rendered command and never runs it. */
export interface ShellSpy {
  $: any
  calls: string[]
}

export function shellSpy(exitCode = 0): ShellSpy {
  const calls: string[] = []
  const settle = (): any => {
    const promise: any = Promise.resolve({ exitCode, stdout: '', stderr: '' })
    // Chainable subprocess surface the plugin uses: `.cwd().nothrow().quiet()`.
    promise.cwd = () => settle()
    promise.nothrow = () => settle()
    promise.quiet = () => settle()
    return promise
  }
  const dollar = ((strings: TemplateStringsArray, ...expressions: unknown[]) => {
    const rendered = strings.reduce((acc, chunk, index) => {
      if (index === 0) return chunk
      const expression = expressions[index - 1]
      const raw =
        expression !== null &&
        typeof expression === 'object' &&
        'raw' in (expression as Record<string, unknown>)
          ? String((expression as { raw: unknown }).raw)
          : String(expression)
      return `${acc}${raw}${chunk}`
    }, '')
    calls.push(rendered.trim())
    return settle()
  }) as any
  return { $: dollar, calls }
}

export interface RegisteredTools {
  definitions: CollectedTool[]
  ledgerPath: string
  projectRoot: string
}

/** Register the full tool set for a fixture root (local mode). */
export function registerFor(
  projectRoot: string,
  options: { $?: any; ledgerPath?: string } = {},
): RegisteredTools {
  const ledgerPath =
    options.ledgerPath ?? join(projectRoot, '.opencode', 'supervisor.db')
  const config = resolveSupervisorConfig({
    options: {
      repoRoot: projectRoot,
      ledgerPath,
      ...(options.$ ? { $: options.$ } : {}),
    },
    env: {},
  })
  const definitions: CollectedTool[] = []
  const editor: ToolRegistrar = {
    add: (definition) => {
      definitions.push(definition)
    },
  }
  registerSupervisorTools(editor, config)
  return { definitions, ledgerPath, projectRoot }
}

/** Tool results arrive as `{ content: string }` from the registrar. */
export function toolResult(out: unknown): any {
  if (typeof out === 'string') return JSON.parse(out)
  const content = (out as { content?: unknown } | null)?.content
  if (typeof content === 'string') return JSON.parse(content)
  return out
}

export function executeNamed(
  definitions: CollectedTool[],
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const definition = definitions.find((entry) => entry.name === name)
  if (!definition) throw new Error(`no definition registered for ${name}`)
  return definition.execute(args)
}
