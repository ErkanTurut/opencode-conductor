// Detection is the "real checks, not empty checks" contract: a checkout's
// verify commands and branch names are derived from the files it actually has.
//
// Every fixture is a throwaway directory under the OS temp dir. Detection is
// read-only by contract, so these tests also assert it creates nothing and
// never needs a package manager, cargo, go or python to run.
import { afterAll, describe, expect, it } from 'bun:test'
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { detectProject } from '../../src/runtime/detect'

const fixtureRoot = realpathSync(mkdtempSync(join(tmpdir(), 'detect-unit-')))

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

function writePackageJson(dir: string, body: unknown): void {
  writeFile(join(dir), 'package.json', JSON.stringify(body))
}

/** Run a git command for fixture setup; any failure fails the test loudly. */
function git(cwd: string, args: string[]): string {
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
  return result.stdout.toString().trim()
}

interface RepoOptions {
  branch: string
  develop?: 'local' | 'remote'
  originHead?: boolean
}

/** A real (commit-bearing) repository, so the branch probes are honest. */
function makeGitRepo(name: string, options: RepoOptions): string {
  const dir = makeDir(name)
  git(dir, ['init', '-q', '-b', options.branch])
  git(dir, ['commit', '-q', '--allow-empty', '-m', 'init'])
  if (options.develop === 'local') git(dir, ['branch', 'develop'])
  if (options.develop === 'remote') {
    git(dir, [
      'update-ref',
      'refs/remotes/origin/develop',
      git(dir, ['rev-parse', 'HEAD']),
    ])
  }
  if (options.originHead) {
    git(dir, [
      'symbolic-ref',
      'refs/remotes/origin/HEAD',
      `refs/remotes/origin/${options.branch}`,
    ])
  }
  return dir
}

describe('node ecosystems', () => {
  it('renders bun scripts in execution order from a bun lockfile', () => {
    const dir = makeDir('node-bun')
    writeFile(dir, 'bun.lock')
    writePackageJson(dir, {
      name: 'fixture',
      scripts: { test: 'bun test', lint: 'eslint .', format: 'prettier --write .' },
    })

    const detected = detectProject(dir)

    expect(detected.ecosystem).toBe('node')
    expect(detected.packageManager).toBe('bun')
    expect(detected.verifyCommands).toEqual([
      'bun run format',
      'bun run lint',
      'bun run test',
    ])
    expect(detected.verifySources).toEqual([
      'ecosystem:node (package.json)',
      'package-manager:bun (bun.lock)',
      'package.json:scripts.format',
      'package.json:scripts.lint',
      'package.json:scripts.test',
    ])
  })

  it('uses the pnpm lockfile', () => {
    const dir = makeDir('node-pnpm')
    writeFile(dir, 'pnpm-lock.yaml')
    writePackageJson(dir, { scripts: { format: 'prettier', lint: 'eslint', test: 'vitest' } })

    const detected = detectProject(dir)

    expect(detected.packageManager).toBe('pnpm')
    expect(detected.verifyCommands).toEqual([
      'pnpm run format',
      'pnpm run lint',
      'pnpm run test',
    ])
    expect(detected.verifySources).toContain('package-manager:pnpm (pnpm-lock.yaml)')
  })

  it('uses the yarn lockfile', () => {
    const dir = makeDir('node-yarn')
    writeFile(dir, 'yarn.lock')
    writePackageJson(dir, { scripts: { test: 'jest' } })

    expect(detectProject(dir).verifyCommands).toEqual(['yarn run test'])
  })

  it('uses the npm lockfile', () => {
    const dir = makeDir('node-npm')
    writeFile(dir, 'package-lock.json')
    writePackageJson(dir, { scripts: { format: 'prettier', lint: 'eslint', test: 'jest' } })

    const detected = detectProject(dir)

    expect(detected.packageManager).toBe('npm')
    expect(detected.verifyCommands).toEqual([
      'npm run format',
      'npm run lint',
      'npm run test',
    ])
  })

  it('renders with npm (and says so) when no lockfile proves a manager', () => {
    const dir = makeDir('node-no-lockfile')
    writePackageJson(dir, { scripts: { test: 'node --test' } })

    const detected = detectProject(dir)

    expect(detected.packageManager).toBe(null)
    expect(detected.verifyCommands).toEqual(['npm run test'])
    expect(detected.verifySources).toContain(
      'package-manager:npm (default, no lockfile)',
    )
  })

  it('records why a package.json with no matching scripts yields no commands', () => {
    const dir = makeDir('node-no-scripts')
    writeFile(dir, 'bun.lock')
    writePackageJson(dir, { scripts: { dev: 'vite', deploy: 'wrangler deploy' } })

    const detected = detectProject(dir)

    expect(detected.ecosystem).toBe('node')
    expect(detected.verifyCommands).toEqual([])
    expect(detected.verifySources).toContain('package.json:no-matching-scripts')
  })

  it('treats a package.json without a scripts object as no matching scripts', () => {
    const dir = makeDir('node-missing-scripts')
    writePackageJson(dir, { name: 'fixture' })

    const detected = detectProject(dir)

    expect(detected.verifyCommands).toEqual([])
    expect(detected.verifySources).toContain('package.json:no-matching-scripts')
  })

  it('survives a malformed package.json without throwing', () => {
    const dir = makeDir('node-malformed')
    writeFile(dir, 'bun.lock')
    writeFile(dir, 'package.json', '{"scripts": {')

    expect(() => detectProject(dir)).not.toThrow()
    const detected = detectProject(dir)

    expect(detected.ecosystem).toBe('node')
    expect(detected.packageManager).toBe('bun')
    expect(detected.verifyCommands).toEqual([])
    expect(detected.verifySources).toContain('package.json:malformed')
  })
})

describe('other ecosystems', () => {
  it('emits the cargo command list', () => {
    const dir = makeDir('rust')
    writeFile(dir, 'Cargo.toml', '[package]\nname = "fixture"\n')

    const detected = detectProject(dir)

    expect(detected.ecosystem).toBe('rust')
    expect(detected.packageManager).toBe(null)
    expect(detected.verifyCommands).toEqual([
      'cargo fmt --check',
      'cargo clippy -- -D warnings',
      'cargo test',
      'cargo build',
    ])
    expect(detected.verifySources).toEqual([
      'ecosystem:rust (Cargo.toml)',
      'cargo:Cargo.toml',
    ])
  })

  it('emits ruff and pytest when pyproject.toml declares a tests directory', () => {
    const dir = makeDir('python-pyproject')
    writeFile(dir, 'pyproject.toml', '[project]\nname = "fixture"\n')
    mkdirSync(join(dir, 'tests'), { recursive: true })

    const detected = detectProject(dir)

    expect(detected.ecosystem).toBe('python')
    expect(detected.verifyCommands).toEqual([
      'ruff format --check .',
      'ruff check .',
      'pytest',
    ])
    expect(detected.verifySources).toEqual([
      'ecosystem:python (pyproject.toml)',
      'python:pyproject.toml',
      'python:tests',
    ])
  })

  it('omits pytest (with a reason) when no tests exist', () => {
    const dir = makeDir('python-no-tests')
    writeFile(dir, 'pyproject.toml', '[project]\nname = "fixture"\n')

    const detected = detectProject(dir)

    expect(detected.verifyCommands).toEqual(['ruff format --check .', 'ruff check .'])
    expect(detected.verifySources).toContain('python:no-tests')
  })

  it('finds a root test_*.py for a requirements.txt project', () => {
    const dir = makeDir('python-requirements')
    writeFile(dir, 'requirements.txt', 'pytest\nruff\n')
    writeFile(dir, 'test_smoke.py', 'def test_ok():\n    assert True\n')

    const detected = detectProject(dir)

    expect(detected.ecosystem).toBe('python')
    expect(detected.verifyCommands).toContain('pytest')
    expect(detected.verifySources).toContain('python:requirements.txt')
    expect(detected.verifySources).toContain('python:tests')
  })

  it('emits the go command list', () => {
    const dir = makeDir('go')
    writeFile(dir, 'go.mod', 'module example.com/fixture\n')

    const detected = detectProject(dir)

    expect(detected.ecosystem).toBe('go')
    expect(detected.verifyCommands).toEqual([
      'gofmt -l .',
      'go vet ./...',
      'go test ./...',
      'go build ./...',
    ])
    expect(detected.verifySources).toEqual(['ecosystem:go (go.mod)', 'go:go.mod'])
  })

  it('picks node over rust and go, recording the skipped manifests', () => {
    const dir = makeDir('precedence')
    writeFile(dir, 'bun.lock')
    writePackageJson(dir, { scripts: { test: 'bun test' } })
    writeFile(dir, 'Cargo.toml', '[package]\nname = "fixture"\n')
    writeFile(dir, 'go.mod', 'module example.com/fixture\n')

    const detected = detectProject(dir)

    expect(detected.ecosystem).toBe('node')
    expect(detected.verifyCommands).toEqual(['bun run test'])
    expect(detected.verifySources).toContain('skipped:rust (Cargo.toml)')
    expect(detected.verifySources).toContain('skipped:go (go.mod)')
  })

  it('picks rust over python and go', () => {
    const dir = makeDir('precedence-rust')
    writeFile(dir, 'Cargo.toml', '[package]\nname = "fixture"\n')
    writeFile(dir, 'pyproject.toml', '[project]\nname = "fixture"\n')
    writeFile(dir, 'go.mod', 'module example.com/fixture\n')

    const detected = detectProject(dir)

    expect(detected.ecosystem).toBe('rust')
    expect(detected.verifySources).toContain('skipped:python (pyproject.toml)')
    expect(detected.verifySources).toContain('skipped:go (go.mod)')
  })
})

describe('empty and unreadable roots', () => {
  it('reports a plain non-git directory as ecosystem none with no commands', () => {
    const dir = makeDir('empty')

    const detected = detectProject(dir)

    expect(detected.ecosystem).toBe('none')
    expect(detected.packageManager).toBe(null)
    expect(detected.isGitRepo).toBe(false)
    expect(detected.verifyCommands).toEqual([])
    expect(detected.verifySources).toEqual(['ecosystem:none'])
    expect(detected.branches.main).toBe('main')
    expect(detected.branchSource).toBe('not-git')
  })

  it('reports a missing directory without throwing', () => {
    const detected = detectProject(join(fixtureRoot, 'does-not-exist'))

    expect(detected.ecosystem).toBe('none')
    expect(detected.isGitRepo).toBe(false)
    expect(detected.verifyCommands).toEqual([])
  })

  it('writes nothing into the inspected directory', () => {
    const dir = makeDir('read-only')
    writeFile(dir, 'bun.lock')
    writePackageJson(dir, { scripts: { test: 'bun test' } })

    detectProject(dir)

    expect(readdirSync(dir).sort()).toEqual(['bun.lock', 'package.json'])
  })
})

describe('git branches', () => {
  it('reads main from origin/HEAD and develop from a local ref', () => {
    const dir = makeGitRepo('repo-main-develop', {
      branch: 'main',
      develop: 'local',
      originHead: true,
    })

    const detected = detectProject(dir)

    expect(detected.isGitRepo).toBe(true)
    expect(detected.branches).toEqual({ main: 'main', dev: 'develop' })
    expect(detected.branchSource).toBe('origin-head;develop-local')
  })

  it('accepts a remote-only develop ref', () => {
    const dir = makeGitRepo('repo-remote-develop', {
      branch: 'main',
      develop: 'remote',
      originHead: true,
    })

    const detected = detectProject(dir)

    expect(detected.branches).toEqual({ main: 'main', dev: 'develop' })
    expect(detected.branchSource).toBe('origin-head;develop-remote')
  })

  it('falls back to the current master branch, and dev follows main', () => {
    const dir = makeGitRepo('repo-master', { branch: 'master' })

    const detected = detectProject(dir)

    expect(detected.branches).toEqual({ main: 'master', dev: 'master' })
    expect(detected.branchSource).toBe('current-branch;same-as-main')
  })

  it('defaults to main on a feature branch with no origin/HEAD', () => {
    const dir = makeGitRepo('repo-feature', { branch: 'feature/work' })

    const detected = detectProject(dir)

    expect(detected.branches).toEqual({ main: 'main', dev: 'main' })
    expect(detected.branchSource).toBe('default-main;same-as-main')
  })
})

describe('detection hash', () => {
  it('is stable across calls and changes when a matched script is added', () => {
    const dir = makeDir('hash-scripts')
    writeFile(dir, 'bun.lock')
    writePackageJson(dir, { scripts: { test: 'bun test' } })

    const first = detectProject(dir)
    const second = detectProject(dir)
    expect(second.hash).toBe(first.hash)
    expect(first.hash).toMatch(/^[0-9a-f]{64}$/)

    writePackageJson(dir, { scripts: { test: 'bun test', lint: 'eslint .' } })
    const withLint = detectProject(dir)
    expect(withLint.hash).not.toBe(first.hash)

    // A script outside the verified set is not a detection input.
    writePackageJson(dir, {
      scripts: { test: 'bun test', lint: 'eslint .', dev: 'vite' },
    })
    expect(detectProject(dir).hash).toBe(withLint.hash)
  })

  it('changes when the lockfile changes the package manager', () => {
    const dir = makeDir('hash-lockfile')
    writePackageJson(dir, { scripts: { test: 'bun test' } })
    const withoutLockfile = detectProject(dir)

    writeFile(dir, 'bun.lock')
    expect(detectProject(dir).hash).not.toBe(withoutLockfile.hash)
  })

  it('changes when a branch result changes', () => {
    const dir = makeGitRepo('hash-branch', { branch: 'main' })
    const before = detectProject(dir)

    git(dir, ['branch', 'develop'])
    const after = detectProject(dir)

    expect(after.branches.dev).toBe('develop')
    expect(after.hash).not.toBe(before.hash)
  })
})
