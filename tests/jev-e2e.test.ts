import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  evaluateWithJev,
  resetJevCircuitForTests,
  JEV_EVALUATE_URL,
} from '../src/jev/client'
import { isJevEnabled } from '../src/jev/config'
import {
  buildContractQuestions,
  buildSafetyQuestions,
  buildSeverityQuestions,
} from '../src/jev/questions'
import {
  assessContract,
  assessSafety,
  calibrateSeverity,
} from '../src/jev/gates'

const savedJevEnv = new Map<string, string | undefined>()

function snapshotJevEnv(): void {
  savedJevEnv.clear()
  for (const key of Object.keys(process.env)) {
    if (key === 'JEV_CONFIG_PATH' || key.startsWith('JEV_') || key === 'AI_GATEWAY_API_KEY') {
      savedJevEnv.set(key, process.env[key])
    }
  }
}

function clearJevEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (key === 'JEV_CONFIG_PATH' || key.startsWith('JEV_') || key === 'AI_GATEWAY_API_KEY') {
      delete process.env[key]
    }
  }
  // Hermetic isolation: never fall back to the repo's real config/jev.json
  // (a local enabled file would leak into unit tests). Point at a
  // guaranteed-missing temp path so defaults-OFF apply unless env overrides.
  process.env.JEV_CONFIG_PATH = join(tmpdir(), `jev-test-missing-${process.pid}.json`)
}

function restoreJevEnv(): void {
  clearJevEnv()
  for (const [key, value] of savedJevEnv) {
    if (value !== undefined) process.env[key] = value
  }
  savedJevEnv.clear()
}

function enableJev(): void {
  clearJevEnv()
  process.env.JEV_ENABLED = '1'
  process.env.AI_GATEWAY_API_KEY = 'test-gateway-key'
}

function disableJev(): void {
  clearJevEnv()
  process.env.JEV_ENABLED = 'false'
}

snapshotJevEnv()

beforeEach(() => {
  resetJevCircuitForTests()
})

afterEach(() => {
  resetJevCircuitForTests()
  restoreJevEnv()
  snapshotJevEnv()
})

function jsonResponse(status: number, body: unknown): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    json: async () => body,
  } as unknown as Response
}

describe('jev-e2e — Test A disabled path makes zero network calls', () => {
  test('explicit per-run override false always disables', () => {
    clearJevEnv()
    expect(isJevEnabled(false)).toBe(false)
  })

  test('JEV_ENABLED=false short-circuits evaluate and gates fail open', async () => {
    clearJevEnv()
    expect(isJevEnabled(false)).toBe(false)
    disableJev()
    expect(isJevEnabled()).toBe(false)

    let calls = 0
    const throwingFetch = (async () => {
      calls += 1
      throw new Error('fetch must not be called when JEV is disabled')
    }) as unknown as typeof fetch

    const result = await evaluateWithJev(
      { hello: 'world' },
      { severity: { type: 'choice' } },
      undefined,
      throwingFetch,
    )
    expect(result).toEqual({ ok: false, reason: 'disabled' })
    expect(calls).toBe(0)

    const calibrated = calibrateSeverity(
      { severity: 'medium', blocking: false },
      null,
    )
    expect(calibrated.severity).toBe('medium')
    expect(calibrated.blocking).toBe(false)
    expect(calibrated.annotation.jev_status).toBe('skipped')

    // Literal null-input robustness: null finding must not throw, stays skipped.
    const calibratedNull = calibrateSeverity(
      null as unknown as { severity: string },
      null,
    )
    expect(calibratedNull.annotation.jev_status).toBe('skipped')

    const contract = assessContract({ title: 'Add login' }, null)
    expect(contract.proceed).toBe(true)
    expect(contract.annotation.jev_status).toBe('skipped')

    const contractNull = assessContract(
      null as unknown as { title?: string },
      null,
    )
    expect(contractNull.proceed).toBe(true)
    expect(contractNull.annotation.jev_status).toBe('skipped')

    const safety = assessSafety({ objective: 'Anything' }, null)
    expect(safety.escalate).toBe(false)
    expect(safety.annotation.jev_status).toBe('skipped')

    const safetyNull = assessSafety(
      null as unknown as { objective?: string },
      null,
    )
    expect(safetyNull.escalate).toBe(false)
  })
})

describe('jev-e2e — Test B mock gateway IP-1 severity upgrade', () => {
  test('medium -> high at 0.90 applies and flips blocking on', async () => {
    enableJev()
    expect(isJevEnabled()).toBe(true)

    const bundle = buildSeverityQuestions({
      title: 'Unsanitized input in login handler',
      category: 'security',
      evidence: 'string-concatenated SQL at auth.ts:42',
      location: 'src/auth.ts:42',
    })
    expect(bundle.questions.severity.type).toBe('choice')
    expect(bundle.questions.blocking.type).toBe('boolean')

    let calls = 0
    let capturedUrl = ''
    const fakeFetch = (async (url: unknown, _init: unknown) => {
      calls += 1
      capturedUrl = String(url)
      return jsonResponse(200, {
        answers: {
          severity: {
            choice: 'high',
            probabilities: { high: 0.9, medium: 0.07, low: 0.03 },
          },
          blocking: { probability: 0.95 },
          contractScore: { score: 3, probabilities: { '3': 0.8 } },
          verifiable: { probability: 0.8 },
          risky: { probability: 0.2 },
          needsHuman: { probability: 0.1 },
        },
      })
    }) as unknown as typeof fetch

    const result = await evaluateWithJev(
      bundle.state,
      bundle.questions as unknown as Record<string, unknown>,
      undefined,
      fakeFetch,
    )
    expect(calls).toBe(1)
    expect(capturedUrl).toBe(JEV_EVALUATE_URL)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const answers = result.answers as unknown as {
      severity: { choice: string; probabilities: Record<string, number> }
      blocking: { probability: number }
    }
    expect(answers.severity.choice).toBe('high')

    const calibrated = calibrateSeverity(
      { severity: 'medium', blocking: false },
      { severity: answers.severity, blocking: answers.blocking },
    )
    expect(calibrated.severity).toBe('high')
    expect(calibrated.blocking).toBe(true)
    expect(calibrated.annotation.jev_status).toBe('applied')
    expect(calibrated.annotation.original).toBe('medium')
    expect(calibrated.annotation.calibrated).toBe('high')
    expect(calibrated.annotation.confidence).toBe(0.9)
  })
})

describe('jev-e2e — Test C mock gateway IP-2 contract warn never blocks', () => {
  test('vague contract with verifiable 0.3 warns but still proceeds', async () => {
    enableJev()

    const bundle = buildContractQuestions({
      title: 'Add search',
      acceptance_criteria: [],
      verification_commands: [],
      write_scope: ['src/search.ts'],
    })
    expect(bundle.state.acceptance_criteria).toEqual([])
    expect(bundle.questions.complete.type).toBe('choice')
    expect(bundle.questions.verifiable.type).toBe('boolean')

    let calls = 0
    const fakeFetch = (async () => {
      calls += 1
      return jsonResponse(200, {
        answers: {
          complete: { choice: 'vague', probabilities: { vague: 0.7 } },
          verifiable: { probability: 0.3 },
        },
      })
    }) as unknown as typeof fetch

    const result = await evaluateWithJev(
      bundle.state,
      bundle.questions as unknown as Record<string, unknown>,
      undefined,
      fakeFetch,
    )
    expect(calls).toBe(1)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const answers = result.answers as unknown as {
      complete: { choice: string }
      verifiable: { probability: number }
    }

    const assessment = assessContract(
      { title: 'Add search', acceptance_criteria: [] },
      {
        complete: { choice: answers.complete.choice },
        verifiable: { probability: answers.verifiable.probability },
      },
    )
    expect(assessment.proceed).toBe(true)
    expect(assessment.annotation.jev_status).toBe('contract_warning')

    // Direct gate call with the same low verifiable signal never blocks.
    const direct = assessContract(
      { title: 'Add search' },
      { complete: { choice: 'vague' }, verifiable: { probability: 0.3 } },
    )
    expect(direct.proceed).toBe(true)
    expect(direct.annotation.jev_status).toBe('contract_warning')
  })
})

describe('jev-e2e — Test D mock gateway IP-3 safety escalation', () => {
  test('destructive plan with risky 0.92 + human 0.80 escalates; safe plan does not', async () => {
    enableJev()

    const destructive = buildSafetyQuestions({
      objective: 'Clean up prod hosts',
      pending_mutations: ['rm -rf /', 'prod deploy'],
    })
    expect(destructive.state.pending_mutations).toEqual([
      'rm -rf /',
      'prod deploy',
    ])
    expect(destructive.questions.risky.type).toBe('boolean')
    expect(destructive.questions.needs_human.type).toBe('choice')

    let calls = 0
    const riskyFetch = (async () => {
      calls += 1
      return jsonResponse(200, {
        answers: {
          risky: { probability: 0.92 },
          needs_human: {
            choice: 'human',
            probabilities: { auto: 0.05, peer: 0.15, human: 0.8 },
          },
        },
      })
    }) as unknown as typeof fetch

    const riskyResult = await evaluateWithJev(
      destructive.state,
      destructive.questions as unknown as Record<string, unknown>,
      undefined,
      riskyFetch,
    )
    expect(calls).toBe(1)
    expect(riskyResult.ok).toBe(true)
    if (!riskyResult.ok) return

    const riskyAnswers = riskyResult.answers as unknown as {
      risky: { probability: number }
      needs_human: {
        choice: string
        probabilities: Record<string, number>
      }
    }

    const escalated = assessSafety(
      {
        objective: 'Clean up prod hosts',
        pending_mutations: ['rm -rf /', 'prod deploy'],
      },
      {
        risky: { probability: riskyAnswers.risky.probability },
        needs_human: {
          choice: riskyAnswers.needs_human.choice,
          probabilities: riskyAnswers.needs_human.probabilities,
        },
      },
    )
    expect(escalated.escalate).toBe(true)
    expect(escalated.annotation.jev_status).toBe('escalated')

    const safeBundle = buildSafetyQuestions({
      objective: 'Read docs',
      pending_mutations: [],
    })
    const safeFetch = (async () =>
      jsonResponse(200, {
        answers: {
          risky: { probability: 0.1 },
          needs_human: {
            choice: 'auto',
            probabilities: { auto: 0.9, peer: 0.05, human: 0.05 },
          },
        },
      })) as unknown as typeof fetch

    const safeResult = await evaluateWithJev(
      safeBundle.state,
      safeBundle.questions as unknown as Record<string, unknown>,
      undefined,
      safeFetch,
    )
    expect(safeResult.ok).toBe(true)
    if (!safeResult.ok) return

    const safeAnswers = safeResult.answers as unknown as {
      risky: { probability: number }
      needs_human: {
        choice: string
        probabilities: Record<string, number>
      }
    }
    const safe = assessSafety({ objective: 'Read docs' }, safeAnswers)
    expect(safe.escalate).toBe(false)
  })
})
