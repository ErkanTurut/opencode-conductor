import { describe, expect, it } from 'bun:test'
import {
  decisionTone,
  formatConfidence,
  formatCost,
  formatDuration,
  formatRelativeTime,
  formatTokens,
  stateTone,
  taskProgress,
  truncate,
} from '../../src/gui/format'

describe('gui format helpers', () => {
  it('maps ledger states to display tones', () => {
    expect(stateTone('running')).toBe('running')
    expect(stateTone('completed')).toBe('completed')
    expect(stateTone('failed')).toBe('failed')
    expect(stateTone('blocked')).toBe('blocked')
    expect(stateTone('made-up')).toBe('unknown')
    expect(stateTone(null)).toBe('unknown')
    expect(decisionTone('approved')).toBe('completed')
    expect(decisionTone('rejected')).toBe('failed')
  })

  it('formats relative time and durations', () => {
    const now = Date.parse('2026-10-30T12:00:00Z')
    expect(formatRelativeTime('2026-10-30T11:59:45Z', now)).toBe('just now')
    expect(formatRelativeTime('2026-10-30T11:55:00Z', now)).toBe('5m ago')
    expect(formatRelativeTime('2026-10-30T09:00:00Z', now)).toBe('3h ago')
    expect(formatRelativeTime('not-a-date', now)).toBe('unknown')
    expect(formatDuration(820)).toBe('820ms')
    expect(formatDuration(1400)).toBe('1.4s')
    expect(formatDuration(125000)).toBe('2m 05s')
    expect(formatDuration(null)).toBe('unknown')
  })

  it('formats tokens, cost and confidence without inventing values', () => {
    expect(formatTokens(1234)).toBe('1,234')
    expect(formatTokens(null)).toBeNull()
    expect(formatCost(1.2345, 'usd')).toContain('1.23')
    expect(formatCost(undefined, 'usd')).toBeNull()
    expect(formatConfidence(0.91)).toBe('91%')
    expect(formatConfidence(null)).toBe('unknown')
  })

  it('computes task progress and truncates previews', () => {
    expect(taskProgress({ completed: 3, failed: 1 }, 4)).toEqual({
      completed: 3,
      total: 4,
      percent: 75,
    })
    expect(taskProgress({ completed: 1 }, 0)).toEqual({ completed: 1, total: 1, percent: 100 })
    expect(taskProgress(null, null)).toEqual({ completed: 0, total: 0, percent: 0 })
    expect(truncate('abcdef', 4)).toBe('abc\u2026')
    expect(truncate('abcdef', 10)).toBe('abcdef')
  })
})
