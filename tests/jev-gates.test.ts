import { describe, test, expect } from 'bun:test'
import {
  assessContract,
  assessSafety,
  calibrateSeverity,
} from '../src/jev/gates'
import { JEV_MODULE_VERSION, isJevEnabled } from '../src/jev/index'

describe('jev-gates — barrel', () => {
  test('index exposes version and the env+CLI toggle', () => {
    expect(JEV_MODULE_VERSION).toBe('0.1.0')
    expect(typeof isJevEnabled).toBe('function')
  })
})

describe('jev-gates — calibrateSeverity fallback', () => {
  test('null answers return the original with skipped', () => {
    const out = calibrateSeverity({ severity: 'medium', blocking: false }, null)
    expect(out.severity).toBe('medium')
    expect(out.blocking).toBe(false)
    expect(out.annotation.jev_status).toBe('skipped')
  })

  test('undefined answers return the original with skipped', () => {
    const out = calibrateSeverity(
      { severity: 'high', blocking: true },
      undefined,
    )
    expect(out.severity).toBe('high')
    expect(out.blocking).toBe(true)
    expect(out.annotation.jev_status).toBe('skipped')
  })

  test('missing severity block returns skipped', () => {
    const out = calibrateSeverity({ severity: 'low' }, {})
    expect(out.severity).toBe('low')
    expect(out.annotation.jev_status).toBe('skipped')
  })
})

describe('jev-gates — low-band auto-override', () => {
  test('info -> low auto-applies at 0.75', () => {
    const out = calibrateSeverity(
      { severity: 'info', blocking: false },
      { severity: { choice: 'low', probabilities: { low: 0.75 } } },
    )
    expect(out.severity).toBe('low')
    expect(out.blocking).toBe(false)
    expect(out.annotation.jev_status).toBe('applied')
    expect(out.annotation.original).toBe('info')
    expect(out.annotation.calibrated).toBe('low')
    expect(out.annotation.confidence).toBe(0.75)
  })

  test('below severityMin yields low_confidence and keeps original', () => {
    const out = calibrateSeverity(
      { severity: 'info', blocking: false },
      { severity: { choice: 'low', probabilities: { low: 0.5 } } },
    )
    expect(out.severity).toBe('info')
    expect(out.annotation.jev_status).toBe('low_confidence')
  })

  test('same severity confirms with applied', () => {
    const out = calibrateSeverity(
      { severity: 'medium' },
      { severity: { choice: 'medium', probabilities: { medium: 0.9 } } },
    )
    expect(out.severity).toBe('medium')
    expect(out.annotation.jev_status).toBe('applied')
  })
})

describe('jev-gates — upgrade band', () => {
  test('medium -> high below 0.85 stays advisory', () => {
    const out = calibrateSeverity(
      { severity: 'medium', blocking: false },
      { severity: { choice: 'high', probabilities: { high: 0.8 } } },
    )
    expect(out.severity).toBe('medium')
    expect(out.blocking).toBe(false)
    expect(out.annotation.jev_status).toBe('advisory')
    expect(out.annotation.calibrated).toBe('high')
    expect(out.annotation.confidence).toBe(0.8)
  })

  test('medium -> high at 0.9 applies and flips blocking on', () => {
    const out = calibrateSeverity(
      { severity: 'medium', blocking: false },
      { severity: { choice: 'high', probabilities: { high: 0.9 } } },
    )
    expect(out.severity).toBe('high')
    expect(out.blocking).toBe(true)
    expect(out.annotation.jev_status).toBe('applied')
  })

  test('custom upgrade threshold is honoured', () => {
    const answers = {
      severity: { choice: 'critical', probabilities: { critical: 0.8 } },
    }
    const strict = calibrateSeverity({ severity: 'low' }, answers)
    expect(strict.annotation.jev_status).toBe('advisory')
    const relaxed = calibrateSeverity({ severity: 'low' }, answers, {
      severityMin: 0.7,
      severityUpgradeMin: 0.75,
    })
    expect(relaxed.severity).toBe('critical')
    expect(relaxed.annotation.jev_status).toBe('applied')
  })
})

describe('jev-gates — downgrade guard', () => {
  test('high -> medium never auto-applies even at 0.95', () => {
    const out = calibrateSeverity(
      { severity: 'high', blocking: true },
      { severity: { choice: 'medium', probabilities: { medium: 0.95 } } },
    )
    expect(out.severity).toBe('high')
    expect(out.annotation.jev_status).toBe('advisory')
    expect(out.annotation.calibrated).toBe('medium')
  })

  test('blocking:true is never auto-unblocked by a downgrade hint', () => {
    const out = calibrateSeverity(
      { severity: 'critical', blocking: true },
      {
        severity: { choice: 'low', probabilities: { low: 0.99 } },
        blocking: { probability: 0.05 },
      },
    )
    expect(out.severity).toBe('critical')
    expect(out.blocking).toBe(true)
    expect(out.annotation.jev_status).toBe('advisory')
  })
})

describe('jev-gates — assessContract never blocks', () => {
  test('null answers skip but still proceed', () => {
    const out = assessContract({ title: 'Add login' }, null)
    expect(out.proceed).toBe(true)
    expect(out.annotation.jev_status).toBe('skipped')
  })

  test('vague completeness warns but still proceeds', () => {
    const out = assessContract(
      { title: 'Add login' },
      { complete: { choice: 'vague' }, verifiable: { probability: 0.9 } },
    )
    expect(out.proceed).toBe(true)
    expect(out.annotation.jev_status).toBe('contract_warning')
  })

  test('partial completeness warns but still proceeds', () => {
    const out = assessContract(
      { title: 'Add login' },
      { complete: { choice: 'partial' }, verifiable: { probability: 0.9 } },
    )
    expect(out.proceed).toBe(true)
    expect(out.annotation.jev_status).toBe('contract_warning')
  })

  test('low verifiable confidence warns but still proceeds', () => {
    const out = assessContract(
      { title: 'Add login' },
      { complete: { choice: 'good' }, verifiable: { probability: 0.4 } },
    )
    expect(out.proceed).toBe(true)
    expect(out.annotation.jev_status).toBe('contract_warning')
  })

  test('good + verifiable contract applies', () => {
    const out = assessContract(
      { title: 'Add login' },
      { complete: { choice: 'good' }, verifiable: { probability: 0.9 } },
    )
    expect(out.proceed).toBe(true)
    expect(out.annotation.jev_status).toBe('applied')
  })
})

describe('jev-gates — assessSafety escalation', () => {
  test('escalates only on high-conf unsafe (risky + human)', () => {
    const out = assessSafety(
      { objective: 'Migrate prod database' },
      {
        risky: { probability: 0.9 },
        needs_human: {
          choice: 'human',
          probabilities: { auto: 0.05, peer: 0.15, human: 0.8 },
        },
      },
    )
    expect(out.escalate).toBe(true)
    expect(out.annotation.jev_status).toBe('escalated')
  })

  test('high risky but low human confidence does not escalate', () => {
    const out = assessSafety(
      { objective: 'Migrate prod database' },
      {
        risky: { probability: 0.95 },
        needs_human: {
          choice: 'human',
          probabilities: { human: 0.5 },
        },
      },
    )
    expect(out.escalate).toBe(false)
  })

  test('human verdict without risky confidence does not escalate', () => {
    const out = assessSafety(
      { objective: 'Read docs' },
      {
        risky: { probability: 0.4 },
        needs_human: {
          choice: 'human',
          probabilities: { human: 0.95 },
        },
      },
    )
    expect(out.escalate).toBe(false)
  })

  test('peer choice never escalates', () => {
    const out = assessSafety(
      { objective: 'Ship feature' },
      {
        risky: { probability: 0.9 },
        needs_human: {
          choice: 'peer',
          probabilities: { peer: 0.9, human: 0.05 },
        },
      },
    )
    expect(out.escalate).toBe(false)
  })

  test('null answers fail open with skipped', () => {
    const out = assessSafety({ objective: 'Anything' }, null)
    expect(out.escalate).toBe(false)
    expect(out.annotation.jev_status).toBe('skipped')
  })

  test('malformed answers fail open instead of throwing', () => {
    const out = assessSafety(
      { objective: 'Anything' },
      {
        risky: { probability: Number.NaN },
        needs_human: {
          choice: 42 as unknown as string,
          probabilities: null as unknown as Record<string, number>,
        },
      },
    )
    expect(out.escalate).toBe(false)
  })
})
