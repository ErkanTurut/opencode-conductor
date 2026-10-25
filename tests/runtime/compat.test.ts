// Runtime probe: a globally installed plugin must diagnose an unusable runtime
// instead of registering a half-working supervisor. These tests pin the pass
// case in the real Bun runtime, the fail-closed reporting for a stubbed broken
// check, and the doctor report shape (one line per check, remediation last).
import { describe, expect, it } from 'bun:test'
import {
  defaultRuntimeChecks,
  formatDoctorReport,
  NODE_BUILTIN_SPECIFIERS,
  probeRuntime,
  RUNTIME_PROBE_CHECK_NAMES,
  RUNTIME_REMEDIATION,
  type RuntimeProbeCheck,
} from '../../src/runtime/compat'

/** Replace one default check with a throwing stub. */
function withBrokenCheck(name: string, message: string): RuntimeProbeCheck[] {
  return defaultRuntimeChecks().map((check) =>
    check.name === name
      ? {
          ...check,
          run: () => {
            throw new Error(message)
          },
        }
      : check,
  )
}

describe('probeRuntime — pass case', () => {
  it('passes in the Bun plugin runtime', async () => {
    const probe = await probeRuntime(process.env)

    expect(probe.ok).toBe(true)
    expect(probe.checks.map((check) => check.name)).toEqual([
      ...RUNTIME_PROBE_CHECK_NAMES,
    ])
    for (const check of probe.checks) {
      expect(check.ok).toBe(true)
      expect(check.detail.length).toBeGreaterThan(0)
    }
    expect(probe.remediation).toBe(RUNTIME_REMEDIATION)
    // Evidence, not a bare boolean: the doctor report depends on these strings.
    expect(probe.checks[0].detail).toContain('Bun ')
    expect(probe.checks[1].detail).toContain('bun:sqlite')
    expect(probe.checks[2].detail).toContain('conductor-probe')
    for (const specifier of NODE_BUILTIN_SPECIFIERS) {
      expect(probe.checks[3].detail).toContain(specifier)
    }
  })
})

describe('probeRuntime — failure reporting', () => {
  it('reports ok false and names the failed check', async () => {
    const probe = await probeRuntime(
      {},
      withBrokenCheck('bun:sqlite', 'bun:sqlite is not available'),
    )

    expect(probe.ok).toBe(false)
    const failed = probe.checks.filter((check) => !check.ok)
    expect(failed).toHaveLength(1)
    expect(failed[0].name).toBe('bun:sqlite')
    expect(failed[0].detail).toContain('bun:sqlite is not available')
    // Isolation, not abort-on-first-failure: the other checks still report.
    expect(probe.checks.filter((check) => check.ok)).toHaveLength(3)
    expect(probe.remediation).toBe(RUNTIME_REMEDIATION)
  })

  it('isolates every check: a throwing shell check does not stop node-builtins', async () => {
    const probe = await probeRuntime({}, withBrokenCheck('bun-shell', 'no $ tag'))

    expect(probe.ok).toBe(false)
    expect(probe.checks.map((check) => [check.name, check.ok])).toEqual([
      ['bun-runtime', true],
      ['bun:sqlite', true],
      ['bun-shell', false],
      ['node-builtins', true],
    ])
  })

  it('never throws when the check throws a non-Error', async () => {
    const probe = await probeRuntime({}, [
      {
        name: 'exploding',
        run: () => {
          throw 'boom'
        },
      },
    ])

    expect(probe.ok).toBe(false)
    expect(probe.checks).toEqual([
      { name: 'exploding', ok: false, detail: 'boom' },
    ])
  })

  it('fails closed when no check ran', async () => {
    const probe = await probeRuntime({}, [])

    expect(probe.ok).toBe(false)
    expect(probe.checks).toEqual([])
    expect(probe.remediation).toBe(RUNTIME_REMEDIATION)
  })
})

describe('formatDoctorReport', () => {
  it('prints one line per check and ends with the remediation', async () => {
    const probe = await probeRuntime(process.env)
    const report = formatDoctorReport(probe)
    const lines = report.split('\n')

    expect(lines).toHaveLength(probe.checks.length + 1)
    expect(lines[0]).toBe(
      `[ok] ${probe.checks[0].name}: ${probe.checks[0].detail}`,
    )
    expect(lines[lines.length - 1]).toBe(RUNTIME_REMEDIATION)
    expect(report).toContain('/conductor:doctor')
  })

  it('contains the remediation line when checks failed', async () => {
    const probe = await probeRuntime(
      {},
      withBrokenCheck('bun-runtime', 'Bun global is not defined'),
    )
    const report = formatDoctorReport(probe)

    expect(probe.ok).toBe(false)
    expect(report).toContain('[FAIL] bun-runtime: Bun global is not defined')
    expect(report.split('\n')).toContain(RUNTIME_REMEDIATION)
    expect(report.endsWith(RUNTIME_REMEDIATION)).toBe(true)
  })
})
