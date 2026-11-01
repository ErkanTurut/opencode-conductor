import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

// These checks protect read-only UI invariants even without a Desktop GUI host.
const memory = readFileSync(new URL('../../src/gui/views/memory.tsx', import.meta.url), 'utf8')
const gates = readFileSync(new URL('../../src/gui/views/gates.tsx', import.meta.url), 'utf8')
const configuration = readFileSync(new URL('../../src/gui/views/configuration.tsx', import.meta.url), 'utf8')
describe('inspector guardrails', () => {
  test('memory reads are scoped and invalidated on disposal', () => {
    expect(memory).toContain('scope === requestScope')
    expect(memory).toContain('onCleanup(() => { disposed = true; generation++ })')
    expect(memory).toContain('setContents({})')
  })
  test('legacy mergeReady is not presented as authorization', () => {
    expect(gates).not.toContain('mergeReady')
    expect(gates).toContain('Not merge authorization')
    expect(gates).toContain('Evidence readiness unknown')
  })
  test('configuration examples do not prescribe unsupported fields', () => {
    expect(configuration).toContain('"system"')
    expect(configuration).toContain('"steps"')
    expect(configuration).not.toContain('"maxSteps"')
    expect(configuration).not.toContain('"skills"')
  })
})
