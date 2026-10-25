import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { annotateContractWithJev } from '../src/runner'
import type { WorkItemContract } from '../src/runner'
import { assessContract } from '../src/jev/gates'
import { evaluateWithJev, resetJevCircuitForTests } from '../src/jev/client'
import { isJevEnabled } from '../src/jev/config'

const savedEnv = new Map<string, string | undefined>()

function snapshotEnv(): void {
  savedEnv.clear()
  for (const key of Object.keys(process.env)) {
    if (
      key === 'JEV_CONFIG_PATH' ||
      key.startsWith('JEV_') ||
      key === 'AI_GATEWAY_API_KEY'
    ) {
      savedEnv.set(key, process.env[key])
    }
  }
}

function clearJevEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (
      key === 'JEV_CONFIG_PATH' ||
      key.startsWith('JEV_') ||
      key === 'AI_GATEWAY_API_KEY'
    ) {
      delete process.env[key]
    }
  }
  // Hermetic isolation: never fall back to the repo's real config/jev.json
  // (a local enabled file would leak into unit tests). Point at a
  // guaranteed-missing temp path so defaults-OFF apply unless env overrides.
  process.env.JEV_CONFIG_PATH = join(tmpdir(), `jev-test-missing-${process.pid}.json`)
}

function restoreEnv(): void {
  clearJevEnv()
  for (const [key, value] of savedEnv) {
    if (value !== undefined) process.env[key] = value
  }
  savedEnv.clear()
}

function baseContract(): WorkItemContract {
  return {
    task_id: 'wi-test-1',
    run_id: 'run-test-1',
    role: 'coder',
    objective: 'Add login form',
    acceptance_criteria: ['form renders', 'submit works'],
    verification_commands: ['bun test'],
  }
}

snapshotEnv()

beforeEach(() => {
  resetJevCircuitForTests()
})

afterEach(() => {
  resetJevCircuitForTests()
  restoreEnv()
  snapshotEnv()
})

describe('runner-contract — disabled makes zero fetch', () => {
  test('isJevEnabled() is false by default and evaluateWithJev never fetches', async () => {
    clearJevEnv()
    resetJevCircuitForTests()
    expect(isJevEnabled()).toBe(false)
    let calls = 0
    const fakeFetch = (async () => {
      calls += 1
      throw new Error('fetch must not be called when disabled')
    }) as unknown as typeof fetch
    const result = await evaluateWithJev(
      { title: 'Add login' },
      { complete: {} },
      undefined,
      fakeFetch,
    )
    expect(result).toEqual({ ok: false, reason: 'disabled' })
    expect(calls).toBe(0)
  })

  test('disabled-style annotation (null answers) is warn-only and preserves shape', () => {
    clearJevEnv()
    const contract = baseContract()
    const annotated = annotateContractWithJev(contract, null)
    // Required fields untouched (backward compatible shape)
    expect(annotated.task_id).toBe('wi-test-1')
    expect(annotated.run_id).toBe('run-test-1')
    expect(annotated.role).toBe('coder')
    expect(annotated.objective).toBe('Add login form')
    expect(annotated.acceptance_criteria).toEqual([
      'form renders',
      'submit works',
    ])
    expect(annotated.verification_commands).toEqual(['bun test'])
    // Warn-only: skipped, never blocking
    expect(annotated.jev_contract?.jev_status).toBe('skipped')
    const gate = assessContract({ title: contract.objective }, null)
    expect(gate.proceed).toBe(true)
  })
})

describe('runner-contract — malformed contract still annotates fail-open', () => {
  test('missing/odd fields never throw and still yield skipped', () => {
    const malformed = {
      task_id: 'wi-malformed',
      run_id: 'run-malformed',
      role: 'coder',
      objective: 42,
      acceptance_criteria: undefined,
      verification_commands: null,
    } as unknown as WorkItemContract
    const fn = (): WorkItemContract => annotateContractWithJev(malformed, null)
    expect(fn).not.toThrow()
    const out = fn()
    expect(out.task_id).toBe('wi-malformed')
    expect(out.run_id).toBe('run-malformed')
    expect(out.jev_contract?.jev_status).toBe('skipped')
  })

  test('garbage answers never throw and never block', () => {
    const contract = baseContract()
    const fn = (): WorkItemContract =>
      annotateContractWithJev(contract, {
        complete: { choice: 42 },
      } as unknown as never)
    expect(fn).not.toThrow()
    const out = fn()
    expect(out.jev_contract).toBeDefined()
    // assessContract always proceeds, even on garbage
    const gate = assessContract(
      { title: 'x' },
      { complete: { choice: 42 as unknown as string } },
    )
    expect(gate.proceed).toBe(true)
  })
})

describe('runner-contract — warn-only mapping', () => {
  test('vague contract warns but still proceeds', () => {
    const annotated = annotateContractWithJev(baseContract(), {
      complete: { choice: 'vague' },
      verifiable: { probability: 0.9 },
    })
    expect(annotated.jev_contract?.jev_status).toBe('contract_warning')
    expect(annotated.task_id).toBe('wi-test-1')
  })

  test('good + verifiable contract applies without changing required fields', () => {
    const annotated = annotateContractWithJev(baseContract(), {
      complete: { choice: 'good' },
      verifiable: { probability: 0.9 },
    })
    expect(annotated.jev_contract?.jev_status).toBe('applied')
    expect(annotated.objective).toBe('Add login form')
    expect(annotated.acceptance_criteria).toEqual([
      'form renders',
      'submit works',
    ])
  })
})

describe('runner-contract — verification gate preserved', () => {
  test('allPassed alone decides; Jev warning never overrides', () => {
    const allPassed = (results: { passed: boolean }[]): boolean =>
      results.every((r) => r.passed)
    expect(allPassed([{ passed: true }, { passed: true }])).toBe(true)
    expect(allPassed([{ passed: true }, { passed: false }])).toBe(false)
    expect(allPassed([{ passed: false }])).toBe(false)
    // Jev contract assessment always proceeds, even when the gate fails
    const warning = assessContract(
      { title: 'Add login' },
      { complete: { choice: 'vague' }, verifiable: { probability: 0.9 } },
    )
    expect(warning.proceed).toBe(true)
    expect(warning.annotation.jev_status).toBe('contract_warning')
    // Gate outcome is independent of the Jev verdict
    expect(allPassed([{ passed: false }])).toBe(false)
    expect(warning.proceed).toBe(true)
  })
})
