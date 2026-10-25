// `tests/probes/agent-transform-probe.ts` writes `assets/compat/probe-report.json`
// when it runs. That file is the only evidence behind the `transform` branch of
// `selectAgentRegistrationPath`, so its shape must be checked: a truncated or
// hand-edited report must not be able to select the undocumented API path.
//
// The report is absent until someone runs the probe, so these tests skip rather
// than fail in that case.
import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPORT_PATH = join(import.meta.dir, '..', '..', 'assets', 'compat', 'probe-report.json')
const PRESENT = existsSync(REPORT_PATH)
const VERDICTS = ['pass', 'fail', 'inconclusive']

interface ReportDetail {
  name: string
  ok: boolean
  detail: string
}

function readReport(): Record<string, unknown> {
  return JSON.parse(readFileSync(REPORT_PATH, 'utf8')) as Record<string, unknown>
}

describe('probe-report.json shape', () => {
  it.skipIf(!PRESENT)('carries generatedAt, a known verdict, a checks object and a detail array', () => {
    const report = readReport()

    expect(typeof report.generatedAt).toBe('string')
    expect(Number.isNaN(Date.parse(report.generatedAt as string))).toBe(false)

    expect(VERDICTS).toContain(report.verdict as string)

    expect(report.checks).toBeTypeOf('object')
    expect(Array.isArray(report.checks)).toBe(false)
    expect(report.checks).not.toBeNull()
    for (const value of Object.values(report.checks as Record<string, unknown>)) {
      expect(typeof value).toBe('boolean')
    }

    expect(Array.isArray(report.detail)).toBe(true)
    const detail = report.detail as ReportDetail[]
    expect(detail.length).toBeGreaterThan(0)
    for (const entry of detail) {
      expect(typeof entry.name).toBe('string')
      expect(typeof entry.ok).toBe('boolean')
      expect(typeof entry.detail).toBe('string')
    }
  })

  it.skipIf(!PRESENT)('reports a verdict its checks actually support', () => {
    const report = readReport()
    const checks = report.checks as Record<string, boolean>
    const detail = report.detail as ReportDetail[]

    // The two views of the same run must agree, name for name.
    expect(Object.keys(checks).sort()).toEqual(detail.map((entry) => entry.name).sort())
    for (const entry of detail) expect(checks[entry.name]).toBe(entry.ok)

    // A pass is only a pass when every recorded check passed; a fail needs one
    // failing check. Anything else is inconclusive, which must never claim pass.
    if (report.verdict === 'pass') expect(detail.every((entry) => entry.ok)).toBe(true)
    if (report.verdict === 'fail') expect(detail.some((entry) => !entry.ok)).toBe(true)
  })
})
