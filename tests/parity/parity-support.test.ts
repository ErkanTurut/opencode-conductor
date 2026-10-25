/**
 * Unit coverage for the parity harness parser.
 *
 * The parity test is an integration test; if its summary parsing silently
 * matched nothing, the gate could pass on zero counts. These fixtures pin the
 * exact Bun summary shape (including ANSI colouring and singular "file") so a
 * Bun output change fails here first, with a small diff.
 */
import { describe, expect, it } from 'bun:test'
import { parseBunTestSummary, tail } from './support'

describe('parseBunTestSummary', () => {
  it('reads pass, fail, test count and file count', () => {
    const output = [
      '',
      ' 406 pass',
      ' 0 fail',
      ' 2126 expect() calls',
      'Ran 406 tests across 25 files. [2.29s]',
    ].join('\n')
    expect(parseBunTestSummary(output)).toEqual({ pass: 406, fail: 0, ran: 406, files: 25 })
  })

  it('strips ANSI colour codes and accepts the singular file form', () => {
    const output = [
      '\u001b[32m 3 pass\u001b[0m',
      '\u001b[31m 1 fail\u001b[0m',
      'Ran 4 tests across 1 file. [12.00ms]',
    ].join('\n')
    expect(parseBunTestSummary(output)).toEqual({ pass: 3, fail: 1, ran: 4, files: 1 })
  })

  it('throws with the output tail when no summary is present', () => {
    expect(() => parseBunTestSummary('error: something exploded')).toThrow(
      /could not parse a bun test summary/,
    )
  })
})

describe('tail', () => {
  it('keeps only the requested trailing lines', () => {
    expect(tail('a\nb\nc\nd\n', 2)).toBe('c\nd')
  })
})
