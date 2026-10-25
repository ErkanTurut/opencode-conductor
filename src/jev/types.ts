// JEV (judge ensemble verdicts) value types.
//
// Zero-dependency: imports type-level symbols only from `../types.ts`.
// All probabilities are in [0, 1]; use `clampProbability` (or
// `normalizeProbabilities`) when normalizing untrusted model output.
// Severity labels reuse the shared SEVERITY_LEVELS scale.

import { SEVERITY_LEVELS } from '../types'
import type { Severity } from '../types'

/** Shared severity scale re-exported for JEV verdicts. */
export const JEV_SEVERITIES = SEVERITY_LEVELS

export type JevSeverity = Severity

/** Boolean verdict with a calibrated probability in [0, 1]. */
export interface JevBoolean {
  probability: number
}

/** Categorical verdict: winning choice plus per-choice probabilities. */
export interface JevChoice<T extends string = string> {
  choice: T
  probabilities: Record<string, number>
}

/** Numeric score verdict with per-band probabilities. */
export interface JevScore {
  score: number
  probabilities: Record<string, number>
}

/** Full set of answers returned by a successful JEV call. */
export interface JevAnswers {
  severity: JevChoice<JevSeverity>
  contractScore: JevScore
  verifiable: JevBoolean
  risky: JevBoolean
  needsHuman: JevBoolean
}

/** Discriminated JEV outcome: answers on success, reason on failure. */
export type JevResult =
  | { ok: true; answers: JevAnswers }
  | { ok: false; reason: string }

/** Clamp a finite number into [min, max]; non-finite values yield min. */
export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  if (value < min) return min
  if (value > max) return max
  return value
}

/** Coerce an untrusted value into a probability in [0, 1]. */
export function clampProbability(value: unknown): number {
  const num = typeof value === 'string' ? Number(value) : value
  if (typeof num !== 'number' || !Number.isFinite(num)) return 0
  return clamp(num, 0, 1)
}

/** Coerce an untrusted value into a score in [min, max] (default 0-5). */
export function clampScore(value: unknown, min = 0, max = 5): number {
  const num = typeof value === 'string' ? Number(value) : value
  if (typeof num !== 'number' || !Number.isFinite(num)) return min
  return clamp(num, min, max)
}

/** Coerce an untrusted value into a valid severity; falls back to 'info'. */
export function clampJevSeverity(value: unknown): JevSeverity {
  if (
    typeof value === 'string' &&
    (JEV_SEVERITIES as readonly string[]).includes(value)
  ) {
    return value as JevSeverity
  }
  return 'info'
}

/** Clamp every value of a probability map into [0, 1]. */
export function normalizeProbabilities(
  input: Record<string, unknown>,
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [key, value] of Object.entries(input)) {
    out[key] = clampProbability(value)
  }
  return out
}
