import { describe, it, expect } from 'bun:test'
import {
  shouldEscalateToHuman,
  isRiskClassAllowed,
  isDataClassAllowed,
} from '../src/policy'

describe('policy — shouldEscalateToHuman', () => {
  it('returns true when all gates pass at exact boundaries', () => {
    expect(
      shouldEscalateToHuman({
        riskyProb: 0.85,
        needsHumanChoice: 'human',
        needsHumanProb: 0.75,
      }),
    ).toBe(true)
  })

  it('returns true well above defaults', () => {
    expect(
      shouldEscalateToHuman({
        riskyProb: 0.9,
        needsHumanChoice: 'human',
        needsHumanProb: 0.8,
      }),
    ).toBe(true)
  })

  it('returns false when riskyProb is below default riskyMin', () => {
    expect(
      shouldEscalateToHuman({
        riskyProb: 0.84,
        needsHumanChoice: 'human',
        needsHumanProb: 0.95,
      }),
    ).toBe(false)
  })

  it('returns false when needsHumanProb is below default needsHumanMin', () => {
    expect(
      shouldEscalateToHuman({
        riskyProb: 0.95,
        needsHumanChoice: 'human',
        needsHumanProb: 0.74,
      }),
    ).toBe(false)
  })

  it('returns false when choice is not exactly human', () => {
    for (const choice of ['peer', 'auto', 'Human', 'HUMAN', '']) {
      expect(
        shouldEscalateToHuman({
          riskyProb: 0.95,
          needsHumanChoice: choice,
          needsHumanProb: 0.95,
        }),
      ).toBe(false)
    }
  })

  it('honours custom thresholds', () => {
    const thresholds = { riskyMin: 0.5, needsHumanMin: 0.5 }
    expect(
      shouldEscalateToHuman({
        riskyProb: 0.6,
        needsHumanChoice: 'human',
        needsHumanProb: 0.6,
        thresholds,
      }),
    ).toBe(true)
    expect(
      shouldEscalateToHuman({
        riskyProb: 0.49,
        needsHumanChoice: 'human',
        needsHumanProb: 0.6,
        thresholds,
      }),
    ).toBe(false)
    expect(
      shouldEscalateToHuman({
        riskyProb: 0.6,
        needsHumanChoice: 'human',
        needsHumanProb: 0.49,
        thresholds,
      }),
    ).toBe(false)
  })

  it('is deterministic with no I/O', () => {
    const opts = {
      riskyProb: 0.9,
      needsHumanChoice: 'human',
      needsHumanProb: 0.8,
    }
    expect(shouldEscalateToHuman(opts)).toBe(shouldEscalateToHuman(opts))
  })
})

describe('policy — existing gates unchanged', () => {
  it('isRiskClassAllowed still enforces ordering', () => {
    expect(isRiskClassAllowed('low', 'medium')).toBe(true)
    expect(isRiskClassAllowed('medium', 'medium')).toBe(true)
    expect(isRiskClassAllowed('high', 'medium')).toBe(false)
    expect(isRiskClassAllowed('critical', 'high')).toBe(false)
  })

  it('isDataClassAllowed still enforces ordering', () => {
    expect(isDataClassAllowed('public', 'internal')).toBe(true)
    expect(isDataClassAllowed('internal', 'internal')).toBe(true)
    expect(isDataClassAllowed('confidential', 'internal')).toBe(false)
    expect(isDataClassAllowed('regulated', 'internal')).toBe(false)
  })
})
