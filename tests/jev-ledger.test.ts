import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SqliteLedger } from '../src/ledger/sqlite'
import { resetJevCircuitForTests } from '../src/jev/client'

const savedEnv = new Map<string, string | undefined>()
const savedFetch = (globalThis as unknown as { fetch?: typeof fetch }).fetch
let idSeq = 0

function nextId(prefix: string): string {
  idSeq += 1
  return `${prefix}-${Date.now()}-${idSeq}`
}

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
}

function enableJev(): void {
  clearJevEnv()
  process.env.JEV_ENABLED = '1'
  process.env.AI_GATEWAY_API_KEY = 'test-gateway-key'
}

function mockFetchWithAnswers(answers: Record<string, unknown>): typeof fetch {
  return (async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ answers }),
    json: async () => ({ answers }),
  })) as unknown as typeof fetch
}

function baseFinding(overrides: Record<string, unknown> = {}): {
  id: string
  reviewId: string
  severity: string
  category: string
  title: string
  fingerprint: string
  evidence: string
  confidence: number
  blocking: boolean
} {
  return {
    id: nextId('finding'),
    reviewId: 'review-1',
    severity: 'medium',
    category: 'correctness',
    title: 'Null deref in handler',
    fingerprint: 'fp-1',
    evidence: 'stack trace shows null at line 42',
    confidence: 0.8,
    blocking: false,
    ...overrides,
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
  ;(globalThis as unknown as { fetch?: typeof fetch }).fetch = savedFetch
})

describe('jev-ledger — disabled preserves values (zero-fetch)', () => {
  test('stores original severity/blocking/confidence unchanged', async () => {
    clearJevEnv()
    const ledger = new SqliteLedger(':memory:')
    try {
      const row = await ledger.createReviewFinding(baseFinding({
        severity: 'medium',
        blocking: true,
        confidence: 0.8,
      }))
      expect(row.severity).toBe('medium')
      expect(row.blocking).toBe(1)
      expect(row.confidence).toBeCloseTo(0.8)
      expect(row.evidence).toBe('stack trace shows null at line 42')
    } finally {
      ledger.close()
    }
  })

  test('disabled makes zero fetch even if fetch would throw', async () => {
    clearJevEnv()
    let calls = 0
    ;(globalThis as unknown as { fetch?: typeof fetch }).fetch =
      (async () => {
        calls += 1
        throw new Error('fetch must not be called when disabled')
      }) as unknown as typeof fetch
    const ledger = new SqliteLedger(':memory:')
    try {
      const row = await ledger.createReviewFinding(baseFinding({
        severity: 'low',
        blocking: false,
      }))
      expect(row.severity).toBe('low')
      expect(calls).toBe(0)
    } finally {
      ledger.close()
    }
  })
})

describe('jev-ledger — input clamping', () => {
  test('invalid severity clamps to info', async () => {
    clearJevEnv()
    const ledger = new SqliteLedger(':memory:')
    try {
      const row = await ledger.createReviewFinding(baseFinding({
        severity: 'BOGUS',
      }))
      expect(row.severity).toBe('info')
    } finally {
      ledger.close()
    }
  })

  test('uppercase severity normalizes to lowercase', async () => {
    clearJevEnv()
    const ledger = new SqliteLedger(':memory:')
    try {
      const row = await ledger.createReviewFinding(baseFinding({
        severity: 'HIGH',
      }))
      expect(row.severity).toBe('high')
    } finally {
      ledger.close()
    }
  })

  test('confidence is clamped to [0,1]', async () => {
    clearJevEnv()
    const ledger = new SqliteLedger(':memory:')
    try {
      const high = await ledger.createReviewFinding(baseFinding({ confidence: 2.5 }))
      expect(high.confidence).toBe(1)
      const low = await ledger.createReviewFinding(baseFinding({ confidence: -10 }))
      expect(low.confidence).toBe(0)
      const nan = await ledger.createReviewFinding(baseFinding({ confidence: Number.NaN }))
      expect(nan.confidence).toBe(0)
    } finally {
      ledger.close()
    }
  })
})

describe('jev-ledger — enabled calibration', () => {
  test('low-band move auto-applies and annotates evidence', async () => {
    enableJev()
    ;(globalThis as unknown as { fetch?: typeof fetch }).fetch =
      mockFetchWithAnswers({
        severity: { choice: 'low', probabilities: { low: 0.9 } },
      })
    const ledger = new SqliteLedger(':memory:')
    try {
      const row = await ledger.createReviewFinding(baseFinding({
        severity: 'info',
        blocking: false,
      }))
      expect(row.severity).toBe('low')
      expect(row.blocking).toBe(0)
      expect(row.evidence).toContain('[jev:info->low:applied]')
    } finally {
      ledger.close()
    }
  })

  test('never auto-unblocks: blocking:true stays true on downgrade hint', async () => {
    enableJev()
    ;(globalThis as unknown as { fetch?: typeof fetch }).fetch =
      mockFetchWithAnswers({
        severity: { choice: 'low', probabilities: { low: 0.99 } },
        blocking: { probability: 0.01 },
      })
    const ledger = new SqliteLedger(':memory:')
    try {
      const row = await ledger.createReviewFinding(baseFinding({
        severity: 'high',
        blocking: true,
      }))
      expect(row.severity).toBe('high')
      expect(row.blocking).toBe(1)
    } finally {
      ledger.close()
    }
  })

  test('high-confidence upgrade may flip blocking false->true', async () => {
    enableJev()
    ;(globalThis as unknown as { fetch?: typeof fetch }).fetch =
      mockFetchWithAnswers({
        severity: { choice: 'high', probabilities: { high: 0.95 } },
      })
    const ledger = new SqliteLedger(':memory:')
    try {
      const row = await ledger.createReviewFinding(baseFinding({
        severity: 'medium',
        blocking: false,
      }))
      expect(row.severity).toBe('high')
      expect(row.blocking).toBe(1)
    } finally {
      ledger.close()
    }
  })

  test('low_confidence keeps original without annotation', async () => {
    enableJev()
    ;(globalThis as unknown as { fetch?: typeof fetch }).fetch =
      mockFetchWithAnswers({
        severity: { choice: 'critical', probabilities: { critical: 0.1 } },
      })
    const ledger = new SqliteLedger(':memory:')
    try {
      const row = await ledger.createReviewFinding(baseFinding({
        severity: 'medium',
        blocking: false,
        evidence: 'original evidence',
      }))
      expect(row.severity).toBe('medium')
      expect(row.blocking).toBe(0)
      expect(row.evidence).toBe('original evidence')
    } finally {
      ledger.close()
    }
  })

  test('fail-open on transport error: original kept, no throw', async () => {
    enableJev()
    ;(globalThis as unknown as { fetch?: typeof fetch }).fetch =
      (async () => {
        throw new Error('boom')
      }) as unknown as typeof fetch
    const ledger = new SqliteLedger(':memory:')
    try {
      const row = await ledger.createReviewFinding(baseFinding({
        severity: 'medium',
        blocking: false,
      }))
      expect(row.severity).toBe('medium')
      expect(row.blocking).toBe(0)
    } finally {
      ledger.close()
    }
  })

  test('fail-open on !ok (missing key): original kept, no throw', async () => {
    enableJev()
    delete process.env.AI_GATEWAY_API_KEY
    let calls = 0
    ;(globalThis as unknown as { fetch?: typeof fetch }).fetch =
      (async () => {
        calls += 1
        throw new Error('must not fetch without key')
      }) as unknown as typeof fetch
    const ledger = new SqliteLedger(':memory:')
    try {
      const row = await ledger.createReviewFinding(baseFinding({
        severity: 'low',
        blocking: false,
      }))
      expect(row.severity).toBe('low')
      expect(calls).toBe(0)
    } finally {
      ledger.close()
    }
  })
})
