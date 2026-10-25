// Ecosystem fixture matrix — one executable table proving detection, bootstrap
// and the non-git refusal behave correctly for every ecosystem the conductor
// recognises.
//
// Nothing here executes a package manager, `cargo`, `go` or `python`: detection
// is `node:fs` reads plus read-only `git` probes, and `bootstrapCommand` is a
// pure table lookup. The only processes are the local `git init` / `commit` /
// `checkout -b` calls that build the two git fixtures (no network, no remotes).
//
// Each row pins the *full* detection answer — ecosystem, manager, command list,
// provenance lines, git predicate and branch rules — plus the exact install
// command the worktree bootstrap would run. Rows are asserted independently, so
// a regression names the ecosystem that broke instead of failing one opaque
// table comparison.
//
// Branch rules documented as implemented (runtime/detect.ts):
//   git-main-only  current branch is main, no develop ref
//                  -> `current-branch;same-as-main`
//   git-gitflow    HEAD is develop, no origin/HEAD, refs/heads/develop exists
//                  -> `default-main;develop-local`: dev follows the develop ref
//                     while main falls back to the default `main`
import { afterAll, describe, expect, it } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  detectProject,
  type DetectedBranches,
  type PackageManager,
  type ProjectEcosystem,
} from '../../src/runtime/detect'
import {
  bootstrapCommand,
  type BootstrapCommand,
} from '../../src/runtime/bootstrap'

const fixtureRoot = realpathSync(mkdtempSync(join(tmpdir(), 'conductor-matrix-')))

afterAll(() => {
  rmSync(fixtureRoot, { recursive: true, force: true })
})

/**
 * A fresh directory inside the matrix root. Unique per call on purpose: the
 * git rows run `git init`/`checkout -b` on every build, and the hash-invariant
 * rows mutate their fixture, so rows must never share a directory.
 */
function makeDir(name: string): string {
  return mkdtempSync(join(fixtureRoot, `${name}-`))
}

function writeFile(dir: string, name: string, content = ''): void {
  writeFileSync(join(dir, name), content)
}

function writePackageJson(dir: string, body: unknown): void {
  writeFile(dir, 'package.json', JSON.stringify(body))
}

/** The scripts every node row declares, in VERIFY_SCRIPT_ORDER terms. */
const NODE_SCRIPTS = {
  format: 'prettier --write .',
  lint: 'eslint .',
  test: 'vitest run',
  build: 'tsc --noEmit',
} as const

/** Run a git command for fixture setup; any failure fails the test loudly. */
function git(cwd: string, args: string[]): void {
  const result = Bun.spawnSync({
    cmd: [
      'git',
      '-c',
      'user.email=matrix@example.com',
      '-c',
      'user.name=Ecosystem Matrix',
      '-c',
      'commit.gpgsign=false',
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
      `git ${args.join(' ')} failed in ${cwd}: ${result.stderr.toString().trim()}`,
    )
  }
}

/** A real repository with one (empty) commit on `branch`. */
function initRepo(dir: string, branch: string): void {
  git(dir, ['init', '-q', '-b', branch])
  git(dir, ['commit', '-q', '--allow-empty', '-m', 'init'])
}

/** Bootstrap command expected for a manager detection proved by a lockfile. */
function managerBootstrap(manager: PackageManager): BootstrapCommand {
  const commands: Record<PackageManager, string> = {
    bun: 'bun install --frozen-lockfile',
    pnpm: 'pnpm install --frozen-lockfile',
    yarn: 'yarn install --immutable',
    npm: 'npm ci',
  }
  return { command: commands[manager], reason: `package-manager:${manager}` }
}

interface ExpectedDetection {
  ecosystem: ProjectEcosystem
  packageManager: PackageManager | null
  verifyCommands: string[]
  verifySources: string[]
  isGitRepo: boolean
  branches: DetectedBranches
  branchSource: string
  bootstrap: BootstrapCommand | null
}

interface Fixture {
  name: string
  build: (dir: string) => void
  expected: ExpectedDetection
}

/** A node row: the four scripts plus one lockfile, rendered with its manager. */
function nodeFixture(
  name: string,
  manager: PackageManager,
  lockfile: string,
): Fixture {
  return {
    name,
    build: (dir) => {
      writeFile(dir, lockfile)
      writePackageJson(dir, { name: 'fixture', scripts: NODE_SCRIPTS })
    },
    expected: {
      ecosystem: 'node',
      packageManager: manager,
      verifyCommands: [
        `${manager} run format`,
        `${manager} run lint`,
        `${manager} run test`,
        `${manager} run build`,
      ],
      verifySources: [
        'ecosystem:node (package.json)',
        `package-manager:${manager} (${lockfile})`,
        'package.json:scripts.format',
        'package.json:scripts.lint',
        'package.json:scripts.test',
        'package.json:scripts.build',
      ],
      isGitRepo: false,
      branches: { main: 'main', dev: 'main' },
      branchSource: 'not-git',
      bootstrap: managerBootstrap(manager),
    },
  }
}

/**
 * The `bun` row again, named for what it proves: a package.json + lockfile with
 * no `.git`. Detection is unchanged; only the non-git gate changes the outcome,
 * so sharing the builder keeps the two rows from drifting apart.
 */
const nonGitFixture: Fixture = nodeFixture('non-git', 'bun', 'bun.lock')

const fixtures: readonly Fixture[] = [
  nodeFixture('bun', 'bun', 'bun.lock'),
  nodeFixture('pnpm', 'pnpm', 'pnpm-lock.yaml'),
  nodeFixture('yarn', 'yarn', 'yarn.lock'),
  nodeFixture('npm', 'npm', 'package-lock.json'),
  {
    name: 'node-no-scripts',
    build: (dir) => {
      // Only unmatched scripts: detection must say why it has no commands.
      writePackageJson(dir, {
        name: 'fixture',
        scripts: { dev: 'vite', deploy: 'wrangler deploy' },
      })
    },
    expected: {
      ecosystem: 'node',
      packageManager: null,
      verifyCommands: [],
      verifySources: [
        'ecosystem:node (package.json)',
        'package-manager:npm (default, no lockfile)',
        'package.json:no-matching-scripts',
      ],
      isGitRepo: false,
      branches: { main: 'main', dev: 'main' },
      branchSource: 'not-git',
      // Nothing matched, but there is still a node project to install.
      bootstrap: {
        command: 'npm install',
        reason: 'package-manager:npm (default, no lockfile)',
      },
    },
  },
  {
    name: 'rust',
    build: (dir) => {
      writeFile(
        dir,
        'Cargo.toml',
        '[package]\nname = "fixture"\nversion = "0.1.0"\nedition = "2021"\n',
      )
    },
    expected: {
      ecosystem: 'rust',
      packageManager: null,
      verifyCommands: [
        'cargo fmt --check',
        'cargo clippy -- -D warnings',
        'cargo test',
        'cargo build',
      ],
      verifySources: ['ecosystem:rust (Cargo.toml)', 'cargo:Cargo.toml'],
      isGitRepo: false,
      branches: { main: 'main', dev: 'main' },
      branchSource: 'not-git',
      bootstrap: null,
    },
  },
  {
    name: 'python',
    build: (dir) => {
      writeFile(dir, 'pyproject.toml', '[project]\nname = "fixture"\n')
      mkdirSync(join(dir, 'tests'), { recursive: true })
    },
    expected: {
      ecosystem: 'python',
      packageManager: null,
      verifyCommands: ['ruff format --check .', 'ruff check .', 'pytest'],
      verifySources: [
        'ecosystem:python (pyproject.toml)',
        'python:pyproject.toml',
        'python:tests',
      ],
      isGitRepo: false,
      branches: { main: 'main', dev: 'main' },
      branchSource: 'not-git',
      bootstrap: null,
    },
  },
  {
    name: 'python-no-tests',
    build: (dir) => {
      writeFile(dir, 'requirements.txt', 'pytest\nruff\n')
    },
    expected: {
      ecosystem: 'python',
      packageManager: null,
      verifyCommands: ['ruff format --check .', 'ruff check .'],
      verifySources: [
        'ecosystem:python (requirements.txt)',
        'python:requirements.txt',
        'python:no-tests',
      ],
      isGitRepo: false,
      branches: { main: 'main', dev: 'main' },
      branchSource: 'not-git',
      bootstrap: null,
    },
  },
  {
    name: 'go',
    build: (dir) => {
      writeFile(dir, 'go.mod', 'module example.com/fixture\n\ngo 1.22\n')
    },
    expected: {
      ecosystem: 'go',
      packageManager: null,
      verifyCommands: [
        'gofmt -l .',
        'go vet ./...',
        'go test ./...',
        'go build ./...',
      ],
      verifySources: ['ecosystem:go (go.mod)', 'go:go.mod'],
      isGitRepo: false,
      branches: { main: 'main', dev: 'main' },
      branchSource: 'not-git',
      bootstrap: null,
    },
  },
  {
    name: 'none',
    build: () => {
      // Empty directory: nothing to detect, and no git repository either.
    },
    expected: {
      ecosystem: 'none',
      packageManager: null,
      verifyCommands: [],
      verifySources: ['ecosystem:none'],
      isGitRepo: false,
      branches: { main: 'main', dev: 'main' },
      branchSource: 'not-git',
      bootstrap: null,
    },
  },
  nonGitFixture,
  {
    name: 'git-main-only',
    build: (dir) => {
      initRepo(dir, 'main')
    },
    expected: {
      ecosystem: 'none',
      packageManager: null,
      verifyCommands: [],
      verifySources: ['ecosystem:none'],
      isGitRepo: true,
      branches: { main: 'main', dev: 'main' },
      branchSource: 'current-branch;same-as-main',
      bootstrap: null,
    },
  },
  {
    name: 'git-gitflow',
    build: (dir) => {
      initRepo(dir, 'main')
      git(dir, ['checkout', '-q', '-b', 'develop'])
    },
    expected: {
      ecosystem: 'none',
      packageManager: null,
      verifyCommands: [],
      verifySources: ['ecosystem:none'],
      isGitRepo: true,
      // Documented implementation choice: no origin/HEAD, HEAD is develop, so
      // main is `default-main` and dev follows the local develop ref.
      branches: { main: 'main', dev: 'develop' },
      branchSource: 'default-main;develop-local',
      bootstrap: null,
    },
  },
]

function buildFixture(fixture: Fixture): string {
  const dir = makeDir(fixture.name)
  fixture.build(dir)
  return dir
}

/** Add a matched node script to any fixture root, creating package.json if needed. */
function addVerifyScript(dir: string): void {
  const path = join(dir, 'package.json')
  let body: Record<string, unknown> = {}
  if (existsSync(path)) {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      body = parsed as Record<string, unknown>
    }
  }
  const current = body.scripts
  const scripts =
    current && typeof current === 'object' && !Array.isArray(current)
      ? { ...(current as Record<string, unknown>) }
      : {}
  scripts.typecheck = 'tsc --noEmit'
  writePackageJson(dir, { ...body, scripts })
}

describe('ecosystem matrix — detection', () => {
  for (const fixture of fixtures) {
    it(`${fixture.name}: detection table`, () => {
      const dir = buildFixture(fixture)

      // Non-throwing by contract, even for an empty or hostile folder.
      expect(() => detectProject(dir)).not.toThrow()
      const detected = detectProject(dir)

      expect(detected.ecosystem).toBe(fixture.expected.ecosystem)
      expect(detected.packageManager).toBe(fixture.expected.packageManager)
      expect(detected.verifyCommands).toEqual(fixture.expected.verifyCommands)
      expect(detected.verifySources).toEqual(fixture.expected.verifySources)
      expect(detected.isGitRepo).toBe(fixture.expected.isGitRepo)
      expect(detected.branches).toEqual(fixture.expected.branches)
      expect(detected.branchSource).toBe(fixture.expected.branchSource)
    })
  }
})

describe('ecosystem matrix — bootstrap', () => {
  for (const fixture of fixtures) {
    it(`${fixture.name}: install command`, () => {
      const dir = buildFixture(fixture)
      const detected = detectProject(dir)

      // Exactly the call the worktree tool makes: manager + project root.
      expect(bootstrapCommand(detected.packageManager, dir)).toEqual(
        fixture.expected.bootstrap,
      )
    })
  }
})

describe('ecosystem matrix — hash invariants', () => {
  for (const fixture of fixtures) {
    it(`${fixture.name}: stable 64-char hash, script-sensitive`, () => {
      const dir = buildFixture(fixture)
      const first = detectProject(dir)

      expect(first.hash).toMatch(/^[0-9a-f]{64}$/)
      expect(detectProject(dir).hash).toBe(first.hash)

      // A newly matched script is a detection input, for node fixtures (where
      // it adds a command) and for the other ecosystems (where package.json
      // changes the winner/commands). Either way the fingerprint must move.
      addVerifyScript(dir)
      expect(detectProject(dir).hash).not.toBe(first.hash)
    })
  }
})

describe('ecosystem matrix — non-git refusal predicate', () => {
  it('gate is detectProject(root).isGitRepo === false; bootstrap stays available', () => {
    const dir = buildFixture(nonGitFixture)

    expect(existsSync(join(dir, '.git'))).toBe(false)
    // This is the exact predicate the plugin gates `supervisor_worktree`
    // create (and mutating `supervisor_claim_task`) on: `!project.isGitRepo`.
    // A non-git checkout is refused for isolation, not for dependency setup.
    expect(detectProject(dir).isGitRepo).toBe(false)
    expect(
      bootstrapCommand(detectProject(dir).packageManager, dir),
    ).toEqual(nonGitFixture.expected.bootstrap)
  })
})
