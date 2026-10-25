// The project record is where detection becomes durable: a supervisor session
// must find real verify commands and branch names in `project.json`, not
// placeholder defaults, and must keep them until the checkout actually changes.
//
// These tests drive the same entry point `setupConductor` uses (and one test
// through `setupConductor` itself) against throwaway fixtures with an injected
// `HOME`, so the real user state is never read or written.
import { afterAll, describe, expect, it } from 'bun:test'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setupConductor } from '../../src/index'
import { detectProject } from '../../src/runtime/detect'
import {
  readProjectRecord,
  resolveProjectIdentity,
  writeProjectRecord,
  type ProjectRecord,
} from '../../src/runtime/project'
import { projectKeyFor } from '../../src/runtime/state-layout'
import { RUNTIME_REMEDIATION } from '../../src/runtime/compat'

const fixtureRoot = realpathSync(mkdtempSync(join(tmpdir(), 'detect-record-')))

afterAll(() => {
  rmSync(fixtureRoot, { recursive: true, force: true })
})

function makeDir(...parts: string[]): string {
  const dir = join(fixtureRoot, ...parts)
  mkdirSync(dir, { recursive: true })
  return realpathSync(dir)
}

function writeFile(dir: string, name: string, content = ''): void {
  writeFileSync(join(dir, name), content)
}

function writePackageJson(dir: string, scripts: Record<string, string>): void {
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'fixture', scripts }),
  )
}

function git(cwd: string, args: string[]): void {
  const result = Bun.spawnSync({
    cmd: [
      'git',
      '-c',
      'user.email=detect@example.com',
      '-c',
      'user.name=Detect',
      ...args,
    ],
    cwd,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 10_000,
  })
  if ((result.exitCode ?? 1) !== 0) {
    throw new Error(
      `git ${args.join(' ')} failed: ${result.stderr.toString().trim()}`,
    )
  }
}

/** A node project inside a real git checkout on `main` with a `develop` branch. */
function makeNodeRepo(name: string): string {
  const dir = makeDir(name)
  writeFile(dir, 'bun.lock')
  writePackageJson(dir, { format: 'prettier --write .', lint: 'eslint .', test: 'bun test' })
  git(dir, ['init', '-q', '-b', 'main'])
  git(dir, ['commit', '-q', '--allow-empty', '-m', 'init'])
  git(dir, ['branch', 'develop'])
  git(dir, [
    'symbolic-ref',
    'refs/remotes/origin/HEAD',
    'refs/remotes/origin/main',
  ])
  return dir
}

function envFor(name: string): Record<string, string> {
  return { HOME: join(fixtureRoot, 'homes', name) }
}

function recordPathFor(home: string, projectRoot: string): string {
  return join(
    home,
    '.local',
    'share',
    'opencode-conductor',
    'projects',
    projectKeyFor(projectRoot),
    'project.json',
  )
}

describe('resolveProjectIdentity — detection at setup', () => {
  it('writes the detected verify profile and branches into the record', () => {
    const root = makeNodeRepo('record-node')
    const env = envFor('record-node')

    const resolved = resolveProjectIdentity({ projectRoot: root, env })

    expect(resolved.layout.mode).toBe('central')
    expect(resolved.record.branch).toEqual({ main: 'main', dev: 'develop' })
    expect(resolved.record.verify).not.toBe(null)
    expect(resolved.record.verify!.commands).toEqual([
      'bun run format',
      'bun run lint',
      'bun run test',
    ])
    expect(resolved.record.verify!.detectedFrom).toContain(
      'package-manager:bun (bun.lock)',
    )
    expect(resolved.record.verify!.hash).toMatch(/^[0-9a-f]{64}$/)
    // The on-disk record is the detected one, not a default placeholder.
    expect(readProjectRecord(resolved.recordPath!)).toEqual(resolved.record)
  })

  it('keeps the loopback branch defaults for a non-git directory', () => {
    const root = makeDir('record-plain')
    writeFile(root, 'bun.lock')
    writePackageJson(root, { test: 'bun test' })

    const resolved = resolveProjectIdentity({
      projectRoot: root,
      mode: 'central',
      env: envFor('record-plain'),
    })

    expect(resolved.record.branch).toEqual({ main: 'main', dev: 'develop' })
    expect(resolved.record.verify!.commands).toEqual(['bun run test'])
  })

  it('records verify: null when no ecosystem was detected', () => {
    const root = makeDir('record-none')

    const resolved = resolveProjectIdentity({
      projectRoot: root,
      mode: 'central',
      env: envFor('record-none'),
    })

    expect(resolved.record.verify).toBe(null)
    expect(resolved.record.branch.main).toBe('main')
  })

  it('re-detects when a matched script is added', () => {
    const root = makeNodeRepo('record-drift')
    const env = envFor('record-drift')
    const first = resolveProjectIdentity({ projectRoot: root, env })

    writePackageJson(root, {
      format: 'prettier --write .',
      lint: 'eslint .',
      test: 'bun test',
      build: 'bun build src/index.ts',
    })
    const second = resolveProjectIdentity({ projectRoot: root, env })

    expect(second.record.verify!.commands).toEqual([
      'bun run format',
      'bun run lint',
      'bun run test',
      'bun run build',
    ])
    expect(second.record.verify!.hash).not.toBe(first.record.verify!.hash)
    expect(second.record.createdAt).toBe(first.record.createdAt)
    expect(readProjectRecord(second.recordPath!)).toEqual(second.record)
  })

  it('keeps a stored profile while the detection hash still matches', () => {
    const root = makeNodeRepo('record-stored')
    const env = envFor('record-stored')
    const first = resolveProjectIdentity({ projectRoot: root, env })

    const handEdited: ProjectRecord = {
      ...first.record,
      verify: {
        ...first.record.verify!,
        commands: ['bun run format', 'bun run lint', 'bun run test', 'bash scripts/verify.sh'],
        detectedFrom: [...first.record.verify!.detectedFrom, 'operator:extra-check'],
      },
    }
    writeProjectRecord(first.recordPath!, handEdited)

    const second = resolveProjectIdentity({ projectRoot: root, env })

    expect(second.record.verify!.commands).toEqual(handEdited.verify!.commands)
    expect(second.record.verify!.hash).toBe(first.record.verify!.hash)
    expect(readProjectRecord(second.recordPath!)!.verify!.commands).toEqual(
      handEdited.verify!.commands,
    )
  })

  it('is idempotent: a second resolve rewrites nothing', () => {
    const root = makeNodeRepo('record-idempotent')
    const env = envFor('record-idempotent')
    const first = resolveProjectIdentity({ projectRoot: root, env })
    const bytesBefore = readFileSync(first.recordPath!, 'utf8')
    const mtimeBefore = statSync(first.recordPath!).mtimeMs

    const second = resolveProjectIdentity({ projectRoot: root, env })

    expect(second.record.verify).toEqual(first.record.verify)
    expect(second.record.branch).toEqual(first.record.branch)
    expect(readFileSync(second.recordPath!, 'utf8')).toBe(bytesBefore)
    expect(statSync(second.recordPath!).mtimeMs).toBe(mtimeBefore)
  })
})

describe('setupConductor — the record written at setup', () => {
  it('persists the detection for the session project', async () => {
    const root = makeNodeRepo('setup-record')
    const home = join(fixtureRoot, 'homes', 'setup-record')
    const registeredTools: string[] = []

    const ctx = {
      location: {
        directory: root,
        project: { canonical: root, id: 'prj_setup_record' },
      },
      agent: {
        transform(callback: (editor: { add(entry: unknown): void }) => void) {
          callback({ add() {} })
        },
      },
      skill: {
        transform(callback: (editor: { add(entry: unknown): void }) => void) {
          callback({ add() {} })
        },
      },
      command: {
        async transform(
          callback: (editor: { add(entry: unknown): void }) => void,
        ) {
          callback({ add() {} })
        },
      },
      tool: {
        async transform(
          callback: (editor: { add(entry: { name: string }): void }) => void,
        ) {
          callback({
            add(entry) {
              registeredTools.push(entry.name)
            },
          })
        },
      },
    }

    const originalError = console.error
    console.error = () => {}
    try {
      await setupConductor(ctx, {
        env: { HOME: home },
        probe: async () => ({
          ok: true,
          checks: [],
          remediation: RUNTIME_REMEDIATION,
        }),
      })
    } finally {
      console.error = originalError
    }

    // The full tool set registered, so this really is the production path.
    expect(registeredTools).toContain('supervisor_init_run')

    const record = readProjectRecord(recordPathFor(home, root))
    expect(record).not.toBe(null)
    expect(record!.branch).toEqual({ main: 'main', dev: 'develop' })
    expect(record!.verify).not.toBe(null)
    expect(record!.verify!.commands).toEqual([
      'bun run format',
      'bun run lint',
      'bun run test',
    ])
    // The persisted hash is the current detection's hash, not an old one.
    expect(record!.verify!.hash).toBe(detectProject(root).hash)
  })
})
