import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  evaluateWithJev,
  jevCircuitOpen,
  resetJevCircuitForTests,
  JEV_EVALUATE_URL,
} from '../src/jev/client'

const savedJevEnv = new Map<string, string | undefined>()

function snapshotJevEnv(): void {
  savedJevEnv.clear()
  for (const key of Object.keys(process.env)) {
    if (
      key === 'JEV_CONFIG_PATH' ||
      key === 'jev_config_path' ||
      key.startsWith('JEV_') ||
      key.startsWith('jev_') ||
      key === 'AI_GATEWAY_API_KEY' ||
      key === 'ai_gateway_api_key'
    ) {
      savedJevEnv.set(key, process.env[key])
    }
  }
}

function clearJevEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (
      key === 'JEV_CONFIG_PATH' ||
      key === 'jev_config_path' ||
      key.startsWith('JEV_') ||
      key.startsWith('jev_') ||
      key === 'AI_GATEWAY_API_KEY' ||
      key === 'ai_gateway_api_key'
    ) {
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

snapshotJevEnv()

beforeEach(() => {
  resetJevCircuitForTests()
})

afterEach(() => {
  resetJevCircuitForTests()
  restoreJevEnv()
  snapshotJevEnv()
})

function sampleAnswers(): Record<string, unknown> {
  return {
    severity: { choice: 'high', probabilities: { high: 0.9 } },
    contractScore: { score: 3, probabilities: { '3': 0.8 } },
    verifiable: { probability: 0.8 },
    risky: { probability: 0.9 },
    needsHuman: { probability: 0.7 },
  }
}

function jsonResponse(
  status: number,
  body: unknown,
): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    json: async () => body,
  } as unknown as Response
}

describe('jev-client — disabled makes zero fetch', () => {
  test('returns disabled without calling fetch', async () => {
    clearJevEnv()
    resetJevCircuitForTests()
    let calls = 0
    const fakeFetch = (async () => {
      calls += 1
      throw new Error('fetch must not be called when disabled')
    }) as unknown as typeof fetch
    const result = await evaluateWithJev({ hello: 'world' }, { q1: {} }, undefined, fakeFetch)
    expect(result).toEqual({ ok: false, reason: 'disabled' })
    expect(calls).toBe(0)
  })
})

describe('jev-client — truncation and redaction', () => {
  test('truncates serialized state to maxStateChars and strips secrets', async () => {
    enableJev()
    let capturedUrl = ''
    let capturedInit = {} as RequestInit & { body?: string; headers?: Record<string, string> }
    const fakeFetch = (async (url: unknown, init: unknown) => {
      capturedUrl = String(url)
      capturedInit = init as typeof capturedInit
      return jsonResponse(200, { answers: sampleAnswers() })
    }) as unknown as typeof fetch

    const big = 'x'.repeat(50000)
    const result = await evaluateWithJev(
      { big, api_key: 'super-secret-value' },
      { severity: { prompt: 'rate it' } },
      undefined,
      fakeFetch,
    )
    expect(result.ok).toBe(true)
    expect(capturedUrl).toBe(JEV_EVALUATE_URL)
    expect(capturedUrl).toBe('https://ai-gateway.vercel.sh/v1/evaluate')
    const body = JSON.parse(String(capturedInit.body)) as {
      model: string
      state: string
      questions: Record<string, unknown>
      providerOptions: { gateway: { zeroDataRetention: boolean; only: string[] } }
    }
    expect(body.model).toBe('typesafe-ai/jev')
    expect(typeof body.state).toBe('string')
    expect(body.state.length).toBeLessThanOrEqual(20000)
    expect(body.state).not.toContain('super-secret-value')
    expect(body.questions).toEqual({ severity: { prompt: 'rate it' } })
    expect(body.providerOptions.gateway.zeroDataRetention).toBe(true)
    expect(body.providerOptions.gateway.only).toEqual(['typesafe-ai'])
    const headers = capturedInit.headers as Record<string, string>
    expect(headers['Content-Type']).toBe('application/json')
    expect(headers.Authorization.startsWith('Bearer ')).toBe(true)
  })

  test('honours per-call maxStateChars override', async () => {
    enableJev()
    let capturedBody = ''
    const fakeFetch = (async (_url: unknown, init: unknown) => {
      capturedBody = String((init as { body?: string }).body ?? '')
      return jsonResponse(200, { answers: sampleAnswers() })
    }) as unknown as typeof fetch
    const result = await evaluateWithJev(
      { big: 'y'.repeat(5000) },
      { q: {} },
      { maxStateChars: 100 },
      fakeFetch,
    )
    expect(result.ok).toBe(true)
    const parsed = JSON.parse(capturedBody) as { state: string }
    expect(parsed.state.length).toBeLessThanOrEqual(100)
  })
})

describe('jev-client — timeout', () => {
  test('hanging fetch maps to timeout reason', async () => {
    enableJev()
    const hanging = (() =>
      new Promise<never>(() => {})) as unknown as typeof fetch
    const result = await evaluateWithJev({ a: 1 }, { q: {} }, { timeoutMs: 20 }, hanging)
    expect(result).toEqual({ ok: false, reason: 'timeout' })
  })
})

describe('jev-client — billing circuit-breaker', () => {
  test('402 returns billing and opens the circuit', async () => {
    enableJev()
    const billingFetch = (async () =>
      jsonResponse(402, 'payment_required: quota exhausted')) as unknown as typeof fetch
    const first = await evaluateWithJev({ a: 1 }, { q: {} }, undefined, billingFetch)
    expect(first).toEqual({ ok: false, reason: 'billing' })
    expect(jevCircuitOpen).toBe(true)

    let secondCalls = 0
    const shouldNotRun = (async () => {
      secondCalls += 1
      return jsonResponse(200, { answers: sampleAnswers() })
    }) as unknown as typeof fetch
    const second = await evaluateWithJev({ a: 1 }, { q: {} }, undefined, shouldNotRun)
    expect(second.ok).toBe(false)
    expect(secondCalls).toBe(0)
  })
})

describe('jev-client — per-run budget', () => {
  test('budget exceeded short-circuits without fetch', async () => {
    enableJev()
    let calls = 0
    const fakeFetch = (async () => {
      calls += 1
      return jsonResponse(200, { answers: sampleAnswers() })
    }) as unknown as typeof fetch
    const tracker = { calls: 20 }
    const result = await evaluateWithJev({ a: 1 }, { q: {} }, { budgetTracker: tracker }, fakeFetch)
    expect(result).toEqual({ ok: false, reason: 'budget_exceeded' })
    expect(calls).toBe(0)
    expect(tracker.calls).toBe(20)
  })
})

describe('jev-client — missing gateway key fail-closed', () => {
  test('returns missing_key without calling fetch when AI_GATEWAY_API_KEY is unset', async () => {
    enableJev()
    delete process.env.AI_GATEWAY_API_KEY
    delete process.env.ai_gateway_api_key
    let calls = 0
    const fakeFetch = (async () => {
      calls += 1
      return jsonResponse(200, { answers: sampleAnswers() })
    }) as unknown as typeof fetch
    const result = await evaluateWithJev({ a: 1 }, { q: {} }, undefined, fakeFetch)
    expect(result).toEqual({ ok: false, reason: 'missing_key' })
    expect(calls).toBe(0)
  })

  test('blank key also returns missing_key without fetch', async () => {
    enableJev()
    process.env.AI_GATEWAY_API_KEY = '   '
    delete process.env.ai_gateway_api_key
    let calls = 0
    const fakeFetch = (async () => {
      calls += 1
      return jsonResponse(200, { answers: sampleAnswers() })
    }) as unknown as typeof fetch
    const result = await evaluateWithJev({ a: 1 }, { q: {} }, undefined, fakeFetch)
    expect(result).toEqual({ ok: false, reason: 'missing_key' })
    expect(calls).toBe(0)
  })

  test('lowercase ai_gateway_api_key alone authenticates (no missing_key)', async () => {
    clearJevEnv()
    process.env.JEV_ENABLED = '1'
    delete process.env.AI_GATEWAY_API_KEY
    process.env.ai_gateway_api_key = 'lowercase-key'
    let calls = 0
    const fakeFetch = (async () => {
      calls += 1
      return jsonResponse(200, { answers: sampleAnswers() })
    }) as unknown as typeof fetch
    const result = await evaluateWithJev({ a: 1 }, { q: {} }, undefined, fakeFetch)
    expect(result.ok).toBe(true)
    expect(calls).toBe(1)
  })

  test('per-run enabled override disables without fetch', async () => {
    clearJevEnv()
    process.env.AI_GATEWAY_API_KEY = 'test-gateway-key'
    let calls = 0
    const fakeFetch = (async () => {
      calls += 1
      return jsonResponse(200, { answers: sampleAnswers() })
    }) as unknown as typeof fetch
    const result = await evaluateWithJev({ a: 1 }, { q: {} }, { enabled: false }, fakeFetch)
    expect(result).toEqual({ ok: false, reason: 'disabled' })
    expect(calls).toBe(0)
  })
})

describe('jev-client — ZDR opt-out sends false', () => {
  test('explicit JEV_ZERO_DATA_RETENTION=0 is forwarded', async () => {
    clearJevEnv()
    process.env.JEV_ENABLED = '1'
    process.env.AI_GATEWAY_API_KEY = 'test-gateway-key'
    process.env.JEV_ZERO_DATA_RETENTION = '0'
    let capturedBody = ''
    const fakeFetch = (async (_url: unknown, init: unknown) => {
      capturedBody = String((init as { body?: string }).body ?? '')
      return jsonResponse(200, { answers: sampleAnswers() })
    }) as unknown as typeof fetch
    const result = await evaluateWithJev({ a: 1 }, { q: {} }, undefined, fakeFetch)
    expect(result.ok).toBe(true)
    const parsed = JSON.parse(capturedBody) as {
      providerOptions: { gateway: { zeroDataRetention: boolean } }
    }
    expect(parsed.providerOptions.gateway.zeroDataRetention).toBe(false)
  })
})
