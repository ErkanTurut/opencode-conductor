// Package-manager-aware dependency bootstrap and the branch-aware push rule.
//
// Detection (runtime/detect.ts) answers WHICH package manager a checkout uses
// and which branches it pushes; this module turns those answers into the one
// install command a fresh worktree may run and the verdict the `execute.before`
// guard applies to a push. Both helpers are pure policy: nothing here spawns a
// process, writes a file, or reads the environment.
//
// Import note: extensionless specifier, matching runtime/detect.ts (the
// package's tsc baseline rejects `.ts`-suffixed imports).
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { PackageManager } from './detect'

/** The one install command a fresh worktree runs, with its provenance. */
export interface BootstrapCommand {
  command: string
  reason: string
}

/**
 * Lockfiles that still prove a bun checkout when detection reported no
 * manager. `bun.lockb` predates `bun.lock`; both are accepted.
 */
const BUN_LOCKFILES = ['bun.lock', 'bun.lockb'] as const

/** One install command per manager, in lockfile order (bun > pnpm > yarn > npm). */
const MANAGER_COMMANDS: Record<PackageManager, BootstrapCommand> = {
  bun: {
    command: 'bun install --frozen-lockfile',
    reason: 'package-manager:bun',
  },
  pnpm: {
    command: 'pnpm install --frozen-lockfile',
    reason: 'package-manager:pnpm',
  },
  yarn: {
    command: 'yarn install --immutable',
    reason: 'package-manager:yarn',
  },
  npm: {
    command: 'npm ci',
    reason: 'package-manager:npm',
  },
}

/**
 * The bootstrap command for a checkout, or `null` when there is nothing to
 * install (no package manager, no lockfile, no `package.json`).
 *
 * `projectRoot` is only consulted for the `null` manager case: a bun lockfile
 * still pins a frozen install, a bare `package.json` falls back to a plain
 * `npm install` (no lockfile exists to be strict about), and anything else is
 * not a node project.
 */
export function bootstrapCommand(
  packageManager: PackageManager | null,
  projectRoot: string = '.',
): BootstrapCommand | null {
  if (packageManager) return { ...MANAGER_COMMANDS[packageManager] }

  if (BUN_LOCKFILES.some((file) => existsSync(join(projectRoot, file)))) {
    return {
      command: MANAGER_COMMANDS.bun.command,
      reason: 'bun lockfile present, package manager not detected',
    }
  }
  if (existsSync(join(projectRoot, 'package.json'))) {
    return {
      command: 'npm install',
      reason: 'package-manager:npm (default, no lockfile)',
    }
  }
  return null
}

/** The branches a push may target. */
export interface PushBranches {
  dev: string
  main: string
}

/** A push verdict: `allowed`, or the machine-readable refusal code. */
export interface PushDecision {
  allowed: boolean
  reason?: string
}

/** Human-gated approval state for a trunk-based (dev === main) push. */
export interface PushOptions {
  /** True only when a human-gated approval was recorded for this push. */
  approved?: boolean
}

/** A command segment that invokes `git ... push` (same split as the guard). */
const PUSH_SEGMENT = /\bgit\b[^;&|]*\bpush\b/
/** A force flag anywhere in the segment denies before branch matching. */
const PUSH_FORCE = /(?:^|\s)(?:-f\b|--force)/

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** True when `segment` pushes `origin <branch>` (optionally `<branch>:<branch>`). */
function pushesBranch(segment: string, branch: string): boolean {
  const name = escapeRegExp(branch)
  return new RegExp(
    `\\bgit\\b[^;&|]*\\bpush\\b[^;&|]*\\borigin\\s+${name}(?::${name})?(?:\\s|$)`,
  ).test(segment)
}

/**
 * The push rule shared by the guard and its tests.
 *
 * - a force flag is denied outright;
 * - a normal repo allows a non-force `git push origin <dev>` only, and denies
 *   `git push origin <main>` by name;
 * - a trunk-based repo (`dev === main`) allows `git push origin <main>` only
 *   when `options.approved` is true, otherwise it denies with
 *   `push_requires_approval`.
 *
 * A command with no push segment is `allowed`: this predicate answers the push
 * question only, and the guard keeps its other denies unchanged.
 */
export function isPushAllowed(
  command: string,
  branches: PushBranches,
  options: PushOptions = {},
): PushDecision {
  const segments = command
    .split(/[;&|\n]+/)
    .map((segment) => segment.trim())
    .filter((segment) => PUSH_SEGMENT.test(segment))

  for (const segment of segments) {
    if (PUSH_FORCE.test(segment)) return { allowed: false, reason: 'push:force' }

    if (branches.dev === branches.main) {
      if (!pushesBranch(segment, branches.main)) {
        return { allowed: false, reason: 'push:branch-not-allowed' }
      }
      if (options.approved !== true) {
        return { allowed: false, reason: 'push_requires_approval' }
      }
      continue
    }

    if (pushesBranch(segment, branches.dev)) continue
    if (pushesBranch(segment, branches.main)) {
      return { allowed: false, reason: 'push:main-branch' }
    }
    return { allowed: false, reason: 'push:branch-not-allowed' }
  }

  return { allowed: true }
}
