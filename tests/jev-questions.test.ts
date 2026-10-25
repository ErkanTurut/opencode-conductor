import { describe, test, expect } from 'bun:test'
import {
  MAX_BUILDER_CHARS,
  buildContractQuestions,
  buildSafetyQuestions,
  buildSeverityQuestions,
} from '../src/jev/questions'
import { JEV_REDACTED, stripSecrets } from '../src/jev/config'

describe('jev-questions — shape', () => {
  test('severity builder returns state + questions', () => {
    const bundle = buildSeverityQuestions({
      title: 'SQL injection in login',
      category: 'security',
      evidence: 'unsanitized input at auth.ts:42',
      location: 'src/auth.ts:42',
    })
    expect(bundle.state.title).toBe('SQL injection in login')
    expect(bundle.state.category).toBe('security')
    expect(bundle.state.evidence).toBe('unsanitized input at auth.ts:42')
    expect(bundle.state.location).toBe('src/auth.ts:42')
    expect(bundle.questions.severity.type).toBe('choice')
    expect(bundle.questions.blocking.type).toBe('boolean')
  })

  test('contract builder returns state + questions', () => {
    const bundle = buildContractQuestions({
      title: 'Add login rate limiting',
      acceptance_criteria: ['blocks after 5 attempts'],
      verification_commands: ['bun test auth.test.ts'],
      write_scope: ['src/auth.ts'],
    })
    expect(bundle.state.title).toBe('Add login rate limiting')
    expect(bundle.state.acceptance_criteria).toEqual(['blocks after 5 attempts'])
    expect(bundle.state.verification_commands).toEqual(['bun test auth.test.ts'])
    expect(bundle.state.write_scope).toEqual(['src/auth.ts'])
    expect(bundle.questions.complete.type).toBe('choice')
    expect(bundle.questions.verifiable.type).toBe('boolean')
  })

  test('safety builder returns state + questions', () => {
    const bundle = buildSafetyQuestions({
      objective: 'Migrate prod database',
      riskClass: 'high',
      operationMode: 'autonomous-low-risk',
      summary: 'Backfill users table',
      pending_mutations: ['ALTER TABLE users'],
    })
    expect(bundle.state.objective).toBe('Migrate prod database')
    expect(bundle.state.riskClass).toBe('high')
    expect(bundle.state.operationMode).toBe('autonomous-low-risk')
    expect(bundle.state.summary).toBe('Backfill users table')
    expect(bundle.state.pending_mutations).toEqual(['ALTER TABLE users'])
    expect(bundle.questions.risky.type).toBe('boolean')
    expect(bundle.questions.needs_human.type).toBe('choice')
  })

  test('optional fields default to empty strings/lists', () => {
    const severity = buildSeverityQuestions({ title: 't' })
    expect(severity.state).toEqual({
      title: 't',
      category: '',
      evidence: '',
      location: '',
    })
    const contract = buildContractQuestions({ title: 't' })
    expect(contract.state).toEqual({
      title: 't',
      acceptance_criteria: [],
      verification_commands: [],
      write_scope: [],
    })
    const safety = buildSafetyQuestions({ objective: 'o' })
    expect(safety.state).toEqual({
      objective: 'o',
      riskClass: '',
      operationMode: '',
      summary: '',
      pending_mutations: [],
    })
  })
})

describe('jev-questions — criteria values', () => {
  test('severity question exposes all 5 severity values', () => {
    const { questions } = buildSeverityQuestions({ title: 't' })
    expect(Object.keys(questions.severity.criteria).sort()).toEqual([
      'critical',
      'high',
      'info',
      'low',
      'medium',
    ])
    for (const value of ['info', 'low', 'medium', 'high', 'critical'] as const) {
      expect(typeof questions.severity.criteria[value]).toBe('string')
      expect(questions.severity.criteria[value].length).toBeGreaterThan(0)
    }
  })

  test('contract complete question exposes vague/partial/good/excellent', () => {
    const { questions } = buildContractQuestions({ title: 't' })
    expect(Object.keys(questions.complete.criteria).sort()).toEqual([
      'excellent',
      'good',
      'partial',
      'vague',
    ])
    for (const value of ['vague', 'partial', 'good', 'excellent'] as const) {
      expect(typeof questions.complete.criteria[value]).toBe('string')
      expect(questions.complete.criteria[value].length).toBeGreaterThan(0)
    }
  })

  test('safety needs_human question exposes auto/peer/human', () => {
    const { questions } = buildSafetyQuestions({ objective: 'o' })
    expect(Object.keys(questions.needs_human.criteria).sort()).toEqual([
      'auto',
      'human',
      'peer',
    ])
    for (const value of ['auto', 'peer', 'human'] as const) {
      expect(typeof questions.needs_human.criteria[value]).toBe('string')
      expect(questions.needs_human.criteria[value].length).toBeGreaterThan(0)
    }
  })
})

describe('jev-questions — truncation to 4000', () => {
  test('MAX_BUILDER_CHARS is 4000', () => {
    expect(MAX_BUILDER_CHARS).toBe(4000)
  })

  test('long free-text fields truncate to 4000 chars', () => {
    const long = 'x'.repeat(5000)
    const severity = buildSeverityQuestions({
      title: long,
      evidence: long,
      category: long,
      location: long,
    })
    expect(severity.state.title.length).toBe(4000)
    expect(severity.state.evidence.length).toBe(4000)
    expect(severity.state.category.length).toBe(4000)
    expect(severity.state.location.length).toBe(4000)

    const safety = buildSafetyQuestions({ objective: long, summary: long })
    expect(safety.state.objective.length).toBe(4000)
    expect(safety.state.summary.length).toBe(4000)

    const contract = buildContractQuestions({ title: long })
    expect(contract.state.title.length).toBe(4000)
  })

  test('long list items truncate to 4000 chars each', () => {
    const long = 'y'.repeat(4500)
    const contract = buildContractQuestions({
      title: 't',
      acceptance_criteria: [long, 'short'],
      verification_commands: [long],
      write_scope: [long],
    })
    expect(contract.state.acceptance_criteria[0].length).toBe(4000)
    expect(contract.state.acceptance_criteria[1]).toBe('short')
    expect(contract.state.verification_commands[0].length).toBe(4000)
    expect(contract.state.write_scope[0].length).toBe(4000)

    const safety = buildSafetyQuestions({
      objective: 'o',
      pending_mutations: [long],
    })
    expect(safety.state.pending_mutations[0].length).toBe(4000)
  })

  test('short strings pass through untouched', () => {
    const bundle = buildSeverityQuestions({ title: 'short title' })
    expect(bundle.state.title).toBe('short title')
  })
})

describe('jev-questions — stripSecrets redaction', () => {
  test('stripSecrets redacts sensitive keys (config baseline)', () => {
    const out = stripSecrets({
      api_key: 'shh',
      token: 'shh',
      nested: { password: 'shh', public: 'visible' },
    })
    expect(out.api_key).toBe(JEV_REDACTED)
    expect(out.token).toBe(JEV_REDACTED)
    expect(out.nested.password).toBe(JEV_REDACTED)
    expect(out.nested.public).toBe('visible')
  })

  test('builder state matches stripSecrets of the truncated payload', () => {
    const input = {
      title: 'Deadlock in scheduler',
      category: 'reliability',
      evidence: 'stack trace at worker.ts:9',
      location: 'src/worker.ts:9',
    }
    const { state } = buildSeverityQuestions(input)
    const expected = stripSecrets(
      {
        title: input.title,
        category: input.category,
        evidence: input.evidence,
        location: input.location,
      },
      MAX_BUILDER_CHARS,
    )
    expect(state).toEqual(expected)
  })

  test('builders redact sensitive nested state via stripSecrets', () => {
    // The builder picks only known string fields, then runs stripSecrets
    // over them — verify the wiring by comparing against a direct call.
    const contractInput = {
      title: 'Rotate credentials',
      acceptance_criteria: ['old keys revoked'],
      verification_commands: ['bun test creds.test.ts'],
      write_scope: ['src/auth/keys.ts'],
    }
    const { state } = buildContractQuestions(contractInput)
    expect(state).toEqual(
      stripSecrets(
        {
          title: contractInput.title,
          acceptance_criteria: contractInput.acceptance_criteria,
          verification_commands: contractInput.verification_commands,
          write_scope: contractInput.write_scope,
        },
        MAX_BUILDER_CHARS,
      ),
    )
    // Sanity: JEV_REDACTED placeholder is the redaction marker.
    expect(JEV_REDACTED).toBe('[REDACTED]')
  })
})

describe('jev-questions — no input mutation', () => {
  test('severity builder does not mutate its input', () => {
    const input = {
      title: 'XSS in comment renderer',
      category: 'security',
      evidence: 'payload at render.ts:3',
      location: 'src/render.ts:3',
    }
    const snapshot = JSON.parse(JSON.stringify(input)) as typeof input
    buildSeverityQuestions(input)
    expect(input).toEqual(snapshot)
  })

  test('contract builder does not mutate lists', () => {
    const input = {
      title: 't',
      acceptance_criteria: ['a', 'b'],
      verification_commands: ['cmd'],
      write_scope: ['src/a.ts'],
    }
    const snapshot = JSON.parse(JSON.stringify(input)) as typeof input
    const { state } = buildContractQuestions(input)
    expect(input).toEqual(snapshot)
    expect(state.acceptance_criteria).not.toBe(input.acceptance_criteria)
    expect(state.verification_commands).not.toBe(input.verification_commands)
    expect(state.write_scope).not.toBe(input.write_scope)
  })

  test('safety builder does not mutate its input', () => {
    const input = {
      objective: 'o',
      riskClass: 'low',
      operationMode: 'observe',
      summary: 's',
      pending_mutations: ['m1'],
    }
    const snapshot = JSON.parse(JSON.stringify(input)) as typeof input
    const { state } = buildSafetyQuestions(input)
    expect(input).toEqual(snapshot)
    expect(state.pending_mutations).not.toBe(input.pending_mutations)
  })
})

describe('jev-questions — English instructions', () => {
  test('every instruction asks for English', () => {
    const severity = buildSeverityQuestions({ title: 't' })
    const contract = buildContractQuestions({ title: 't' })
    const safety = buildSafetyQuestions({ objective: 'o' })
    const instructions = [
      severity.questions.severity.instructions,
      severity.questions.blocking.instructions,
      contract.questions.complete.instructions,
      contract.questions.verifiable.instructions,
      safety.questions.risky.instructions,
      safety.questions.needs_human.instructions,
    ]
    expect(instructions.length).toBe(6)
    for (const text of instructions) {
      expect(typeof text).toBe('string')
      expect(text.length).toBeGreaterThan(0)
      expect(text).toMatch(/english/i)
    }
  })
})

describe('jev-questions — determinism', () => {
  test('same input yields the same output', () => {
    const finding = {
      title: 'Race in queue drain',
      category: 'concurrency',
      evidence: 'flaky test seed 42',
      location: 'src/queue.ts:77',
    }
    expect(buildSeverityQuestions(finding)).toEqual(buildSeverityQuestions(finding))

    const contract = {
      title: 't',
      acceptance_criteria: ['a'],
      verification_commands: ['bun test x.ts'],
      write_scope: ['src/x.ts'],
    }
    expect(buildContractQuestions(contract)).toEqual(buildContractQuestions(contract))

    const plan = {
      objective: 'o',
      riskClass: 'medium',
      operationMode: 'assisted',
      summary: 's',
      pending_mutations: ['write file'],
    }
    expect(buildSafetyQuestions(plan)).toEqual(buildSafetyQuestions(plan))
  })
})
