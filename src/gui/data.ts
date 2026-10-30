// Defensive readers for RPC payloads.
//
// The GUI is a read-only projection of the ledger: the server answers with the
// shapes in `src/rpc-contract.ts`, but a newer/older server may omit a field.
// These helpers turn `unknown` into safe primitives so a missing field renders
// as muted "unknown" instead of throwing inside a view.

export interface Loaded<T> {
  data: T | null
  error: string | null
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Read an RPC result. Accepts the `RpcEnvelope<T>` shape
 * (`{ ok: true, data }` / `{ ok: false, error }`) and a bare payload, because
 * the server may hand the method result straight to the client.
 */
export function readResult<T>(value: unknown): Loaded<T> {
  if (value === null || value === undefined) return { data: null, error: 'empty response' }
  if (isRecord(value)) {
    if (value.ok === false) {
      const error = isRecord(value.error) ? value.error : null
      const message = error && typeof error.message === 'string' && error.message ? error.message : 'request failed'
      const code = error && typeof error.code === 'string' && error.code ? `${error.code}: ` : ''
      return { data: null, error: `${code}${message}` }
    }
    if (value.ok === true && 'data' in value) return { data: value.data as T, error: null }
  }
  return { data: value as T, error: null }
}

export function arrayOf<T>(value: readonly T[] | null | undefined): T[]
export function arrayOf<T = unknown>(value: unknown): T[]
export function arrayOf<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

export function recordOf(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

export function textOf(value: unknown, fallback = 'unknown'): string {
  if (typeof value === 'string' && value.length > 0) return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'boolean') return String(value)
  return fallback
}

export function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

export function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function booleanOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

/** A string list from an unknown value, skipping non-strings and empty entries. */
export function stringList(value: unknown): string[] {
  return arrayOf<unknown>(value).filter((item): item is string => typeof item === 'string' && item.length > 0)
}

const OPEN_QUESTION_KEYS = ['openQuestions', 'open_questions', 'questions', 'open'] as const
const NESTED_CONTRACT_KEYS = ['contract', 'refinement', 'requirements'] as const

interface QuestionLike extends Record<string, unknown> {
  question?: unknown
  title?: unknown
  text?: unknown
  prompt?: unknown
  answer?: unknown
}

function questionText(item: unknown): string {
  if (typeof item === 'string') return item
  if (!isRecord(item)) return ''
  const record = item as QuestionLike
  for (const key of ['question', 'title', 'text', 'prompt'] as const) {
    const value = record[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return ''
}

function answered(item: unknown): boolean {
  if (!isRecord(item)) return false
  const answer = (item as QuestionLike).answer
  return typeof answer === 'string' ? answer.trim().length > 0 : false
}

function collectQuestions(items: unknown, includeAnswered: boolean): string[] {
  const result: string[] = []
  for (const item of arrayOf<unknown>(items)) {
    if (!includeAnswered && answered(item)) continue
    const text = questionText(item)
    if (text) result.push(text)
  }
  return result
}

/**
 * Open questions from a refinement contract, tolerating the handful of field
 * names older contracts used. Nested `contract` / `refinement` objects are
 * searched once.
 */
export function openQuestions(contract: unknown): string[] {
  if (Array.isArray(contract)) return collectQuestions(contract, true)
  if (!isRecord(contract)) return []
  for (const key of OPEN_QUESTION_KEYS) {
    const value = contract[key]
    if (!Array.isArray(value)) continue
    const questions = collectQuestions(value, key === 'openQuestions' || key === 'open_questions')
    if (questions.length > 0) return questions
  }
  for (const key of NESTED_CONTRACT_KEYS) {
    const nested = contract[key]
    if (!isRecord(nested)) continue
    const questions = openQuestions(nested)
    if (questions.length > 0) return questions
  }
  return []
}

/** Deduplicate a list of strings, preserving order. */
export function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}
