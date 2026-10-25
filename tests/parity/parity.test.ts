/**
 * P0 parity gate.
 *
 * The port's licence to exist is "same behaviour as the frozen tree, plus new
 * runtime tests". This test runs both Bun suites and compares their summaries:
 *
 *   - both suites must exit 0 with zero failures;
 *   - the conductor package must have at least as many passing tests as the
 *     frozen supervisor (it legitimately has more: `tests/runtime/*` and this
 *     parity harness are new).
 *
 * It skips — never fails — when `tools/opencode-supervisor` is absent, so the
 * package still tests cleanly when published or extracted standalone. The one
 * thing it cannot do from a standalone copy is prove parity; that is what the
 * repo checkout is for.
 */
import { describe, expect, it } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  CONDUCTOR_ROOT,
  FROZEN_ROOT,
  PARITY_CHILD_ENV,
  PARITY_TIMEOUT_MS,
  formatSuiteRun,
  runBunTest,
  tail,
} from './support'

const isParityChild = process.env[PARITY_CHILD_ENV] === '1'
const frozenTreePresent = existsSync(join(FROZEN_ROOT, 'package.json'))

describe('P0 parity: conductor vs frozen supervisor', () => {
  it(
    'reports the same-or-more passing tests with zero failures in both suites',
    () => {
      if (isParityChild) {
        console.log('parity: nested conductor run (recursion guard) — skipping')
        return
      }
      if (!frozenTreePresent) {
        console.log(`parity: frozen tree absent at ${FROZEN_ROOT} — skipping parity comparison`)
        return
      }

      const oldRun = runBunTest(FROZEN_ROOT, { [PARITY_CHILD_ENV]: '1' })
      const newRun = runBunTest(CONDUCTOR_ROOT, { [PARITY_CHILD_ENV]: '1' })

      console.log(formatSuiteRun('parity: frozen supervisor', oldRun))
      console.log(formatSuiteRun('parity: conductor', newRun))

      if (oldRun.exitCode !== 0) {
        throw new Error(`frozen supervisor suite exited ${oldRun.exitCode}:\n${tail(oldRun.output)}`)
      }
      if (newRun.exitCode !== 0) {
        throw new Error(`conductor suite exited ${newRun.exitCode}:\n${tail(newRun.output)}`)
      }

      // A harness that parsed nothing must not be allowed to look like parity.
      expect(oldRun.summary.ran).toBeGreaterThan(0)
      expect(newRun.summary.ran).toBeGreaterThan(0)

      expect(oldRun.summary.fail).toBe(0)
      expect(newRun.summary.fail).toBe(0)

      expect(newRun.summary.pass).toBeGreaterThanOrEqual(oldRun.summary.pass)
    },
    PARITY_TIMEOUT_MS,
  )
})
