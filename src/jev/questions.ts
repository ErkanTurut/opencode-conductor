// Jev question builders (severity, contract, safety).
//
// Pure functions, no I/O, no dependencies beyond `./config.js`.
// All judge-facing instructions are in English (Jev English-best),
// even when the state payload itself contains other languages.
// Every builder redacts its state via `stripSecrets` and truncates
// free-text fields to MAX_BUILDER_CHARS. Deterministic: the same
// input always yields the same output, and inputs are never mutated.

import { stripSecrets } from './config.js'

/** Per-field truncation budget for builder state payloads. */
export const MAX_BUILDER_CHARS = 4000

export interface SeverityFindingInput {
  title: string
  category?: string
  evidence?: string
  location?: string
}

export interface SeverityState {
  title: string
  category: string
  evidence: string
  location: string
}

export interface SeverityQuestions {
  severity: {
    type: 'choice'
    instructions: string
    criteria: {
      info: string
      low: string
      medium: string
      high: string
      critical: string
    }
  }
  blocking: {
    type: 'boolean'
    instructions: string
    criteria: {
      true: string
      false: string
    }
  }
}

export interface SeverityBundle {
  state: SeverityState
  questions: SeverityQuestions
}

export interface ContractInput {
  title: string
  acceptance_criteria?: string[]
  verification_commands?: string[]
  write_scope?: string[]
}

export interface ContractState {
  title: string
  acceptance_criteria: string[]
  verification_commands: string[]
  write_scope: string[]
}

export interface ContractQuestions {
  complete: {
    type: 'choice'
    instructions: string
    criteria: {
      vague: string
      partial: string
      good: string
      excellent: string
    }
  }
  verifiable: {
    type: 'boolean'
    instructions: string
    criteria: {
      true: string
      false: string
    }
  }
}

export interface ContractBundle {
  state: ContractState
  questions: ContractQuestions
}

export interface SafetyPlanInput {
  objective: string
  riskClass?: string
  operationMode?: string
  summary?: string
  pending_mutations?: string[]
}

export interface SafetyState {
  objective: string
  riskClass: string
  operationMode: string
  summary: string
  pending_mutations: string[]
}

export interface SafetyQuestions {
  risky: {
    type: 'boolean'
    instructions: string
    criteria: {
      true: string
      false: string
    }
  }
  needs_human: {
    type: 'choice'
    instructions: string
    criteria: {
      auto: string
      peer: string
      human: string
    }
  }
}

export interface SafetyBundle {
  state: SafetyState
  questions: SafetyQuestions
}

function truncateText(value: unknown, maxChars: number = MAX_BUILDER_CHARS): string {
  if (typeof value !== 'string') return ''
  if (value.length <= maxChars) return value
  return value.slice(0, maxChars)
}

function truncateList(value: unknown, maxChars: number = MAX_BUILDER_CHARS): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const item of value) {
    if (typeof item === 'string') out.push(truncateText(item, maxChars))
  }
  return out
}

export function buildSeverityQuestions(finding: SeverityFindingInput): SeverityBundle {
  const raw: SeverityState = {
    title: truncateText(finding.title),
    category: truncateText(finding.category ?? ''),
    evidence: truncateText(finding.evidence ?? ''),
    location: truncateText(finding.location ?? ''),
  }
  const state = stripSecrets(raw, MAX_BUILDER_CHARS)
  const questions: SeverityQuestions = {
    severity: {
      type: 'choice',
      instructions: 'Rate severity for this finding. Be conservative. Respond in English.',
      criteria: {
        info: 'nit/docs, no behavior change',
        low: 'minor, safe to defer',
        medium: 'should fix before merge',
        high: 'likely bug/vuln, must fix',
        critical: 'exploitable/data-loss/crash in prod path',
      },
    },
    blocking: {
      type: 'boolean',
      instructions: 'Must this block merge? Respond in English.',
      criteria: {
        true: 'high/critical or broken build/test',
        false: 'anything deferrable',
      },
    },
  }
  return { state, questions }
}

export function buildContractQuestions(contract: ContractInput): ContractBundle {
  const raw: ContractState = {
    title: truncateText(contract.title),
    acceptance_criteria: truncateList(contract.acceptance_criteria ?? []),
    verification_commands: truncateList(contract.verification_commands ?? []),
    write_scope: truncateList(contract.write_scope ?? []),
  }
  const state = stripSecrets(raw, MAX_BUILDER_CHARS)
  const questions: ContractQuestions = {
    complete: {
      type: 'choice',
      instructions: 'Rate contract completeness. Respond in English.',
      criteria: {
        vague: 'no clear acceptance criteria',
        partial: 'some criteria written but gaps remain',
        good: 'clear criteria covering the main behavior',
        excellent: 'precise testable criteria with verification commands',
      },
    },
    verifiable: {
      type: 'boolean',
      instructions: 'Can this contract be verified deterministically? Respond in English.',
      criteria: {
        true: 'acceptance criteria with runnable verification commands',
        false: 'vague criteria or no verification commands',
      },
    },
  }
  return { state, questions }
}

export function buildSafetyQuestions(plan: SafetyPlanInput): SafetyBundle {
  const raw: SafetyState = {
    objective: truncateText(plan.objective),
    riskClass: truncateText(plan.riskClass ?? ''),
    operationMode: truncateText(plan.operationMode ?? ''),
    summary: truncateText(plan.summary ?? ''),
    pending_mutations: truncateList(plan.pending_mutations ?? []),
  }
  const state = stripSecrets(raw, MAX_BUILDER_CHARS)
  const questions: SafetyQuestions = {
    risky: {
      type: 'boolean',
      instructions: 'Is this plan risky to execute? Respond in English.',
      criteria: {
        true: 'mutations, prod access, data loss, or irreversible side effects',
        false: 'read-only or low-risk reversible actions',
      },
    },
    needs_human: {
      type: 'choice',
      instructions: 'What level of human oversight is needed? Respond in English.',
      criteria: {
        auto: 'safe to proceed automatically',
        peer: 'needs peer review before proceeding',
        human: 'needs human approval before proceeding',
      },
    },
  }
  return { state, questions }
}
