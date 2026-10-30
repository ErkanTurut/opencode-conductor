import { describe, expect, it } from 'bun:test'
import { arrayOf, openQuestions, readResult, recordOf, textOf, unique } from '../../src/gui/data'

describe('gui data helpers', () => {
  it('unwraps the RPC envelope and preserves errors', () => {
    expect(readResult<{ value: number }>({ ok: true, data: { value: 7 } })).toEqual({
      data: { value: 7 },
      error: null,
    })
    expect(readResult({ ok: false, error: { code: 'not_found', message: 'missing' } })).toEqual({
      data: null,
      error: 'not_found: missing',
    })
    expect(readResult(undefined)).toEqual({ data: null, error: 'empty response' })
  })

  it('tolerates missing fields in projections', () => {
    expect(arrayOf<string>(null)).toEqual([])
    expect(arrayOf([1, 'two'])).toEqual([1, 'two'])
    expect(recordOf(null)).toEqual({})
    expect(textOf(undefined)).toBe('unknown')
    expect(textOf(42)).toBe('42')
    expect(unique(['a', 'b', 'a'])).toEqual(['a', 'b'])
  })

  it('finds open questions in nested contract shapes', () => {
    expect(openQuestions({ openQuestions: ['What is done?'] })).toEqual(['What is done?'])
    expect(openQuestions({ refinement: { open_questions: ['Who?'] } })).toEqual(['Who?'])
    expect(openQuestions({ questions: [{ question: 'Q1', answer: 'A1' }, { question: 'Q2' }] })).toEqual([
      'Q2',
    ])
    expect(openQuestions(null)).toEqual([])
  })
})
