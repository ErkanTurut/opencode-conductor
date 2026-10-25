// JEV gateway client (fetch REST, timeout, budget, circuit-breaker).
//
// Zero-dependency: global fetch + AbortController only. No zod/ai deps.
// Fail-closed: disabled, circuit-open, budget-exceeded, timeouts, and
// transport errors all yield `{ ok: false, reason }` without throwing.

import {
  defaultJevConfig,
  getGatewayApiKey,
  isJevEnabled,
  loadJevConfig,
  stripSecrets,
} from './config.js'
import type { JevAnswers, JevResult } from './types.js'

export const JEV_EVALUATE_URL = 'https://ai-gateway.vercel.sh/v1/evaluate'

export interface JevEvaluateOptions {
  timeoutMs?: number
  maxStateChars?: number
  model?: string
  budgetTracker?: { calls: number }
  enabled?: boolean
}

export let jevCircuitOpen = false

export function resetJevCircuitForTests(): void {
  jevCircuitOpen = false
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const record = error as Record<string, unknown>
  if (record.code === 'JEV_TIMEOUT') return true
  if (record.name === 'AbortError') return true
  return false
}

function serializeState(state: unknown, maxChars: number): string {
  const redacted = stripSecrets(state)
  let text: string
  try {
    text = JSON.stringify(redacted) ?? 'null'
  } catch {
    text = '"[unserializable]"'
  }
  if (text.length > maxChars) return text.slice(0, maxChars)
  return text
}

export async function evaluateWithJev(
  state: unknown,
  questions: Record<string, unknown>,
  opts?: JevEvaluateOptions,
  fetchImpl?: typeof fetch,
): Promise<JevResult> {
  let enabled = false
  try {
    enabled = isJevEnabled(opts?.enabled)
  } catch {
    enabled = false
  }
  if (!enabled) return { ok: false, reason: 'disabled' }
  if (jevCircuitOpen) return { ok: false, reason: 'circuit_open' }

  let cfg = defaultJevConfig()
  try {
    cfg = loadJevConfig()
  } catch {
    cfg = { ...defaultJevConfig(), enabled: true }
  }
  if (!cfg.enabled) return { ok: false, reason: 'disabled' }

  const timeoutMs = isPositiveInt(opts?.timeoutMs)
    ? (opts?.timeoutMs as number)
    : cfg.timeoutMs
  const maxStateChars = isPositiveInt(opts?.maxStateChars)
    ? (opts?.maxStateChars as number)
    : cfg.maxStateChars
  const model =
    opts?.model && opts.model.trim() ? opts.model.trim() : cfg.model
  const maxCalls = cfg.budget.maxCallsPerRun

  const tracker = opts?.budgetTracker
  if (tracker && tracker.calls >= maxCalls) {
    return { ok: false, reason: 'budget_exceeded' }
  }

  // Fail-closed on missing gateway key: never serialize PII/state or send
  // an empty-Bearer POST when AI_GATEWAY_API_KEY is unset/blank.
  const gatewayKey = getGatewayApiKey()
  if (!gatewayKey || !gatewayKey.trim()) {
    return { ok: false, reason: 'missing_key' }
  }

  const stateText = serializeState(state, maxStateChars)

  const globalFetch = (globalThis as unknown as { fetch?: typeof fetch }).fetch
  const doFetch = fetchImpl ?? globalFetch
  if (typeof doFetch !== 'function') {
    return { ok: false, reason: 'transport_error' }
  }

  if (tracker) tracker.calls += 1

  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      try {
        controller.abort()
      } catch {
        // ignore abort errors; the timeout rejection below carries the reason
      }
      const err = new Error('jev: request timed out') as Error & {
        code?: string
      }
      err.code = 'JEV_TIMEOUT'
      reject(err)
    }, timeoutMs)
  })

  let response: Response
  try {
    response = await Promise.race([
      doFetch(JEV_EVALUATE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${gatewayKey.trim()}`,
        },
        body: JSON.stringify({
          model,
          state: stateText,
          questions,
          providerOptions: {
            gateway: {
              zeroDataRetention: cfg.zeroDataRetention,
              only: ['typesafe-ai'],
            },
          },
        }),
        signal: controller.signal,
      }),
      timeoutPromise,
    ])
  } catch (error) {
    if (timer !== undefined) clearTimeout(timer)
    if (isTimeoutError(error)) return { ok: false, reason: 'timeout' }
    const name = (error as { name?: unknown } | null)?.name
    if (name === 'AbortError') return { ok: false, reason: 'timeout' }
    return { ok: false, reason: 'transport_error' }
  }
  if (timer !== undefined) clearTimeout(timer)

  let bodyText = ''
  try {
    const withText = response as unknown as {
      text?: unknown
      json?: unknown
    }
    if (typeof withText.text === 'function') {
      bodyText = await response.text()
    } else if (typeof withText.json === 'function') {
      const data: unknown = await response.json()
      bodyText = typeof data === 'string' ? data : JSON.stringify(data)
    }
  } catch {
    bodyText = ''
  }

  if (response.status === 402 || bodyText.includes('payment_required')) {
    jevCircuitOpen = true
    return { ok: false, reason: 'billing' }
  }
  if (response.status === 429) {
    jevCircuitOpen = true
    return { ok: false, reason: 'rate_limited' }
  }
  if (!response.ok || response.status < 200 || response.status >= 300) {
    return { ok: false, reason: `http_${response.status}` }
  }

  let parsed: unknown
  try {
    parsed = bodyText ? (JSON.parse(bodyText) as unknown) : null
  } catch {
    return { ok: false, reason: 'bad_response' }
  }
  if (!isPlainObject(parsed)) return { ok: false, reason: 'bad_response' }
  const record = parsed as Record<string, unknown>
  let rawAnswers: unknown
  if (record.answers !== undefined) {
    rawAnswers = record.answers
  } else if (
    isPlainObject(record.data) &&
    (record.data as Record<string, unknown>).answers !== undefined
  ) {
    rawAnswers = (record.data as Record<string, unknown>).answers
  } else {
    rawAnswers = record
  }
  if (!isPlainObject(rawAnswers)) {
    return { ok: false, reason: 'bad_response' }
  }
  const answers = rawAnswers as JevAnswers
  const usage = record.usage ?? (isPlainObject(record.data)
    ? (record.data as Record<string, unknown>).usage
    : undefined)
  if (usage !== undefined) {
    return { ok: true, answers, usage } as unknown as JevResult
  }
  return { ok: true, answers }
}
