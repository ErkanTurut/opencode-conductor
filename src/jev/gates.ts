// JEV decision gates (thin thresholds + fallback).
//
// Pure functions only — no fetch, no I/O, no env reads, no clock, no
// randomness. The disabled path makes zero fetch: callers check
// `isJevEnabled()` before calling `evaluateWithJev()`; these gates only
// interpret answers that are already in hand.
//
// Banded auto-override policy (user decision):
// - info/low/medium lateral moves auto-apply at confidence >= severityMin
//   (default 0.70).
// - any upgrade to high/critical needs confidence >= severityUpgradeMin
//   (default 0.85); below that the verdict is advisory (original kept).
// - any downgrade from high/critical is never automatic — always advisory.
// - the JEV blocking probability is a hint only: it can never auto-unblock
//   a `blocking: true` finding. Blocking flips false -> true only when a
//   severity upgrade to high/critical is applied with high confidence.
//
// Safety posture:
// - high-confidence unsafe (risky + needs-human) is fail-closed: escalate.
// - missing answers or malformed input are fail-open (no escalation) and
//   defer to the policy layer (`policy.ts`).
// - contract assessment never blocks: it always returns `proceed: true`
//   and surfaces risk via a `contract_warning` annotation.

import { defaultJevConfig } from './config.js'
import { clampJevSeverity, clampProbability } from './types.js'

/** Machine-readable JEV verdict attached to a calibrated decision. */
export type JevStatus =
  | 'disabled'
  | 'skipped'
  | 'applied'
  | 'advisory'
  | 'low_confidence'
  | 'contract_warning'
  | 'escalated'

/** Annotation recording what JEV suggested and what was done with it. */
export interface JevAnnotation {
  jev_status: JevStatus
  original?: unknown
  calibrated?: unknown
  confidence?: number
}

/** Minimal finding shape needed for severity calibration. */
export interface JevSeverityFinding {
  severity: string
  blocking?: boolean
}

/** Minimal JEV answers needed for severity calibration. */
export interface JevSeverityAnswers {
  severity?: {
    choice?: string
    probabilities?: Record<string, number>
  }
  blocking?: {
    probability?: number
  }
}

/** Per-call threshold overrides; invalid values fall back to config. */
export interface JevSeverityThresholds {
  severityMin?: number
  severityUpgradeMin?: number
}

/** Calibrated severity plus the audit annotation. */
export interface CalibratedSeverity {
  severity: string
  blocking: boolean
  annotation: JevAnnotation
}

/** Minimal contract shape (mirrors the contract question builder input). */
export interface JevContractInput {
  title?: string
  acceptance_criteria?: string[]
  verification_commands?: string[]
  write_scope?: string[]
}

/** Minimal JEV answers needed for contract assessment. */
export interface JevContractAnswers {
  complete?: {
    choice?: string
  }
  verifiable?: {
    probability?: number
  }
}

/** Minimal plan shape (mirrors the safety question builder input). */
export interface JevSafetyPlan {
  objective?: string
  riskClass?: string
  operationMode?: string
  summary?: string
  pending_mutations?: string[]
}

/**
 * Minimal JEV answers needed for safety assessment. Both `needs_human`
 * (wire shape) and `needsHuman` (camelCase alias) are accepted.
 */
export interface JevSafetyAnswers {
  risky?: {
    probability?: number
  }
  needs_human?: {
    choice?: string
    probabilities?: Record<string, number>
  }
  needsHuman?: {
    choice?: string
    probabilities?: Record<string, number>
    probability?: number
  }
}

const SEVERITY_RANK: Record<string, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
}

function severityRank(severity: string): number {
  return SEVERITY_RANK[severity] ?? 0
}

function isThreshold(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  )
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function resolveSeverityThresholds(overrides?: JevSeverityThresholds): {
  severityMin: number
  severityUpgradeMin: number
} {
  const defaults = defaultJevConfig().thresholds
  return {
    severityMin:
      overrides && isThreshold(overrides.severityMin)
        ? overrides.severityMin
        : defaults.severityMin,
    severityUpgradeMin:
      overrides && isThreshold(overrides.severityUpgradeMin)
        ? overrides.severityUpgradeMin
        : defaults.severityUpgradeMin,
  }
}

/**
 * Calibrate a finding severity against JEV answers using the banded
 * auto-override policy. Pure: no fetch, no I/O. A null/undefined
 * `jevAnswers` (disabled, circuit-open, timeout, …) returns the original
 * severity with a `skipped` annotation.
 */
export function calibrateSeverity(
  finding: JevSeverityFinding,
  jevAnswers?: JevSeverityAnswers | null,
  thresholds?: JevSeverityThresholds,
): CalibratedSeverity {
  const { severityMin, severityUpgradeMin } =
    resolveSeverityThresholds(thresholds)
  const original = clampJevSeverity(finding?.severity)
  const originalBlocking = finding?.blocking === true
  if (!jevAnswers || !jevAnswers.severity) {
    return {
      severity: original,
      blocking: originalBlocking,
      annotation: { jev_status: 'skipped', original },
    }
  }
  const rawChoice =
    typeof jevAnswers.severity.choice === 'string'
      ? jevAnswers.severity.choice
      : ''
  const calibrated = clampJevSeverity(rawChoice)
  const rawProbs = jevAnswers.severity.probabilities
  const probs = isPlainObject(rawProbs)
    ? (rawProbs as Record<string, unknown>)
    : {}
  const rawConfidence =
    probs[rawChoice] ?? probs[calibrated] ?? 0
  const confidence = clampProbability(rawConfidence)
  if (confidence < severityMin) {
    return {
      severity: original,
      blocking: originalBlocking,
      annotation: {
        jev_status: 'low_confidence',
        original,
        calibrated,
        confidence,
      },
    }
  }
  if (calibrated === original) {
    return {
      severity: original,
      blocking: originalBlocking,
      annotation: { jev_status: 'applied', original, calibrated, confidence },
    }
  }
  const originalRank = severityRank(original)
  const calibratedRank = severityRank(calibrated)
  const highRank = severityRank('high')
  // Downgrade from high/critical is never automatic.
  if (originalRank >= highRank && calibratedRank < originalRank) {
    return {
      severity: original,
      blocking: originalBlocking,
      annotation: { jev_status: 'advisory', original, calibrated, confidence },
    }
  }
  // Upgrade to high/critical needs the higher band.
  if (calibratedRank >= highRank && calibratedRank > originalRank) {
    if (confidence >= severityUpgradeMin) {
      return {
        severity: calibrated,
        blocking: true,
        annotation: {
          jev_status: 'applied',
          original,
          calibrated,
          confidence,
        },
      }
    }
    return {
      severity: original,
      blocking: originalBlocking,
      annotation: { jev_status: 'advisory', original, calibrated, confidence },
    }
  }
  // Low-band move (info/low/medium lateral): auto-apply at severityMin.
  // The JEV blocking hint is recorded nowhere authoritative on purpose:
  // blocking stays as the pipeline set it; only a high-confidence upgrade
  // above (to high/critical) can flip blocking on, and nothing here can
  // flip a true blocking off.
  return {
    severity: calibrated,
    blocking: originalBlocking,
    annotation: { jev_status: 'applied', original, calibrated, confidence },
  }
}

/**
 * Assess task-contract quality. NEVER blocks: always returns
 * `proceed: true`. Vague/partial completeness or verifiable confidence
 * below `verifiableMin` (default 0.70) yields a `contract_warning`
 * annotation; otherwise `applied`. Null answers yield `skipped`.
 */
export function assessContract(
  contract: JevContractInput,
  jevAnswers?: JevContractAnswers | null,
  thresholds?: { verifiableMin?: number },
): { proceed: true; annotation: JevAnnotation } {
  void contract
  const verifiableMin =
    thresholds && isThreshold(thresholds.verifiableMin)
      ? thresholds.verifiableMin
      : defaultJevConfig().thresholds.verifiableMin
  if (!jevAnswers) {
    return { proceed: true, annotation: { jev_status: 'skipped' } }
  }
  const choice =
    typeof jevAnswers.complete?.choice === 'string'
      ? jevAnswers.complete.choice.toLowerCase()
      : ''
  const rawVerifiable: unknown = jevAnswers.verifiable?.probability
  const verifiable =
    typeof rawVerifiable === 'number' || typeof rawVerifiable === 'string'
      ? clampProbability(rawVerifiable)
      : undefined
  const incomplete = choice === 'vague' || choice === 'partial'
  const unverifiable =
    verifiable !== undefined && verifiable < verifiableMin
  if (incomplete || unverifiable) {
    return {
      proceed: true,
      annotation: {
        jev_status: 'contract_warning',
        original: choice || undefined,
        calibrated: choice || undefined,
        confidence: verifiable,
      },
    }
  }
  return {
    proceed: true,
    annotation: {
      jev_status: 'applied',
      original: choice || undefined,
      calibrated: choice || undefined,
      confidence: verifiable,
    },
  }
}

/**
 * Assess plan safety. Fail-closed on high-confidence unsafe: escalate only
 * when risky probability >= riskyMin (default 0.85) AND needs-human choice
 * is `human` with probability >= needsHumanMin (default 0.75). Null or
 * malformed answers are fail-open (`escalate: false`, `skipped`
 * annotation) and defer to the policy layer.
 */
export function assessSafety(
  plan: JevSafetyPlan,
  jevAnswers?: JevSafetyAnswers | null,
  thresholds?: { riskyMin?: number; needsHumanMin?: number },
): { escalate: boolean; annotation: JevAnnotation } {
  try {
    void plan
    const defaults = defaultJevConfig().thresholds
    const riskyMin =
      thresholds && isThreshold(thresholds.riskyMin)
        ? thresholds.riskyMin
        : defaults.riskyMin
    const needsHumanMin =
      thresholds && isThreshold(thresholds.needsHumanMin)
        ? thresholds.needsHumanMin
        : defaults.needsHumanMin
    if (!jevAnswers) {
      return { escalate: false, annotation: { jev_status: 'skipped' } }
    }
    const risky = clampProbability(jevAnswers.risky?.probability)
    const candidate = jevAnswers.needs_human ?? jevAnswers.needsHuman
    let choice = ''
    let humanP = 0
    if (candidate && typeof candidate === 'object') {
      const record = candidate as {
        choice?: unknown
        probabilities?: unknown
        probability?: unknown
      }
      choice =
        typeof record.choice === 'string' ? record.choice.toLowerCase() : ''
      const probs = isPlainObject(record.probabilities)
        ? (record.probabilities as Record<string, unknown>)
        : null
      if (probs && 'human' in probs) {
        humanP = clampProbability(probs['human'])
      } else if (
        typeof record.probability === 'number' ||
        typeof record.probability === 'string'
      ) {
        // Boolean-form fallback (e.g. JevBoolean): treat the probability
        // as the human-oversight signal.
        humanP = clampProbability(record.probability)
        if (choice === '' && humanP >= needsHumanMin) choice = 'human'
      }
    }
    if (risky >= riskyMin && choice === 'human' && humanP >= needsHumanMin) {
      return {
        escalate: true,
        annotation: {
          jev_status: 'escalated',
          original: choice,
          calibrated: 'human',
          confidence: risky,
        },
      }
    }
    return {
      escalate: false,
      annotation: { jev_status: 'applied', confidence: risky },
    }
  } catch {
    // Fail-open: malformed input must never escalate by itself.
    return { escalate: false, annotation: { jev_status: 'skipped' } }
  }
}
