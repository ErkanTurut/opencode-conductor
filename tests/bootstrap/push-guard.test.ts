// P4-C: the push rule. The guard's only allowed push follows the DETECTED dev
// branch; main is denied by name; a trunk-based repo needs a recorded approval.
import { describe, expect, it } from 'bun:test'
import { isPushAllowed } from '../../src/runtime/bootstrap'
import { supervisorExecuteBeforeGuard } from '../../src/plugin'

const main = 'main'
const develop = { dev: 'develop', main }

describe('isPushAllowed — git-flow repo (dev !== main)', () => {
  it('allows a non-force push to the dev branch', () => {
    expect(isPushAllowed('git push origin develop', develop)).toEqual({
      allowed: true,
    })
    expect(isPushAllowed('git push origin develop:develop', develop)).toEqual({
      allowed: true,
    })
  })

  it('denies the main branch explicitly', () => {
    expect(isPushAllowed('git push origin main', develop)).toEqual({
      allowed: false,
      reason: 'push:main-branch',
    })
  })

  it('denies force pushes', () => {
    for (const command of [
      'git push -f origin develop',
      'git push --force origin develop',
      'git push --force-with-lease origin develop',
    ]) {
      expect(isPushAllowed(command, develop)).toEqual({
        allowed: false,
        reason: 'push:force',
      })
    }
  })

  it('denies any other branch or remote', () => {
    expect(isPushAllowed('git push origin feature/x', develop)).toEqual({
      allowed: false,
      reason: 'push:branch-not-allowed',
    })
    expect(isPushAllowed('git push upstream develop', develop)).toEqual({
      allowed: false,
      reason: 'push:branch-not-allowed',
    })
  })

  it('denies a command with one unapproved push segment', () => {
    expect(
      isPushAllowed('git push origin develop && git push origin main', develop),
    ).toEqual({ allowed: false, reason: 'push:main-branch' })
  })

  it('allows a custom dev branch and still denies main', () => {
    const trunk = { dev: 'trunk', main }
    expect(isPushAllowed('git push origin trunk', trunk)).toEqual({
      allowed: true,
    })
    expect(isPushAllowed('git push origin develop', trunk)).toEqual({
      allowed: false,
      reason: 'push:branch-not-allowed',
    })
    expect(isPushAllowed('git push origin main', trunk)).toEqual({
      allowed: false,
      reason: 'push:main-branch',
    })
  })

  it('leaves a command with no push alone', () => {
    expect(isPushAllowed('git status --porcelain', develop)).toEqual({
      allowed: true,
    })
  })
})

describe('isPushAllowed — trunk-based repo (dev === main)', () => {
  const trunk = { dev: 'main', main }

  it('requires an approval for a push to main', () => {
    expect(isPushAllowed('git push origin main', trunk)).toEqual({
      allowed: false,
      reason: 'push_requires_approval',
    })
    expect(
      isPushAllowed('git push origin main', trunk, { approved: false }),
    ).toEqual({ allowed: false, reason: 'push_requires_approval' })
  })

  it('allows the push once the approval is recorded', () => {
    expect(
      isPushAllowed('git push origin main', trunk, { approved: true }),
    ).toEqual({ allowed: true })
  })

  it('still denies force pushes, approval or not', () => {
    expect(
      isPushAllowed('git push -f origin main', trunk, { approved: true }),
    ).toEqual({ allowed: false, reason: 'push:force' })
  })
})

describe('supervisorExecuteBeforeGuard — push truth table', () => {
  const guard = (
    command: string,
    event: Record<string, unknown> = {},
    branches = develop,
  ) =>
    supervisorExecuteBeforeGuard(
      { tool: 'bash', input: { command }, ...event },
      branches,
    )

  it('permits only a non-force push to the detected dev branch', () => {
    expect(() => guard('git push origin develop')).not.toThrow()
    expect(() => guard('git push origin main')).toThrow(
      /Blocked dangerous command/,
    )
    expect(() => guard('git push -f origin develop')).toThrow(
      /Blocked dangerous command/,
    )
  })

  it('follows a custom dev branch', () => {
    const trunk = { dev: 'trunk', main }
    expect(() => guard('git push origin trunk', {}, trunk)).not.toThrow()
    expect(() => guard('git push origin develop', {}, trunk)).toThrow(
      /Blocked dangerous command/,
    )
  })

  it('carries push_requires_approval on a trunk-based repo', () => {
    const branches = { dev: 'main', main }
    let denied: unknown = null
    try {
      guard('git push origin main', {}, branches)
    } catch (error) {
      denied = error
    }
    expect(denied).toBeInstanceOf(Error)
    expect((denied as Error & { code?: string }).code).toBe(
      'push_requires_approval',
    )

    expect(() =>
      guard('git push origin main', { approval: { approved: true } }, branches),
    ).not.toThrow()
    expect(() =>
      guard('git push origin main', { approval: true }, branches),
    ).not.toThrow()
  })

  it('keeps every other deny unchanged', () => {
    for (const command of [
      'sudo rm -rf /etc',
      'chmod 777 .',
      'git reset --hard HEAD~1',
      'git clean -fd',
    ]) {
      expect(() => guard(command)).toThrow(/Blocked dangerous command/)
    }
    expect(() =>
      supervisorExecuteBeforeGuard({
        tool: 'read',
        input: { filePath: '/repo/.env.local' },
      }),
    ).toThrow(/Cannot read \.env/)
  })
})
