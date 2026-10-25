// The package root must be mountable as a local plugin directory.
//
// OpenCode resolves a locally mounted plugin directory by looking for
// `index.ts` (or `server.ts`) *at the configured directory* — it ignores
// `package.json#main` for that path. That is why the package ships a root
// `index.ts` shim in front of `src/index.ts`, and why these tests pin the shim
// rather than the plugin behaviour (which `tests/register` and
// `tests/index.test.ts` already cover).
//
// Three properties matter, and they fail in different ways:
//   1. the root default export IS the src default export (`{ id, setup }`) — a
//      stale copy would still "work" while silently diverging;
//   2. both paths expose one `CONDUCTOR_PLUGIN_ID` — the host keys the plugin
//      by it;
//   3. the whole named surface is forwarded — compared as sorted key lists
//      derived from the modules themselves, never a hardcoded export list that
//      rots the first time `src/index.ts` grows.
import { describe, expect, it } from 'bun:test'
import rootDefault, * as rootEntry from '../../index'
import srcDefault, * as srcEntry from '../../src/index'
import { registerConductorTools as sourceRegisterConductorTools } from '../../src/register/tools'
import { resolveStateLayout as sourceResolveStateLayout } from '../../src/runtime/state-layout'
import { resolveTrust as sourceResolveTrust } from '../../src/runtime/trust'

/**
 * The only names the root entry publishes beyond `src/index.ts`.
 *
 * `src/index.ts` deliberately keeps `runtime/*` and `register/*` off the
 * package surface (it reaches them through `plugin.ts`), but the mountable
 * root must let a host reach the seams its plugin composes. This constant is
 * the contract the surface test pins; everything else is derived from the
 * modules, so a new export in `src/index.ts` needs no edit here.
 */
const ROOT_ONLY_REEXPORTS = [
  'registerConductorTools',
  'resolveStateLayout',
  'resolveTrust',
] as const

describe('package root entry (local plugin mount)', () => {
  it('defaults to the same conductor plugin object as src/index.ts', () => {
    // Same binding, not a copy: the shim re-exports it.
    expect(rootDefault).toBe(srcDefault)

    // The runtime contract the host reads.
    expect(rootDefault.id).toBe('conductor')
    expect(typeof rootDefault.setup).toBe('function')

    // Nothing else rides along on the plugin object: `{ id, setup }`.
    expect(Object.keys(rootDefault).sort()).toEqual(['id', 'setup'])
  })

  it('exposes the same CONDUCTOR_PLUGIN_ID from both paths', () => {
    expect(rootEntry.CONDUCTOR_PLUGIN_ID).toBe('conductor')
    expect(rootEntry.CONDUCTOR_PLUGIN_ID).toBe(srcEntry.CONDUCTOR_PLUGIN_ID)
    expect(rootDefault.id).toBe(rootEntry.CONDUCTOR_PLUGIN_ID)
  })

  it('re-exports the whole src surface, plus the documented conductor primitives', () => {
    // Derived from the modules, so adding/removing an export in `src/index.ts`
    // cannot leave this assertion stale — it can only fail if the shim stops
    // forwarding, or if it starts publishing something undocumented.
    const rootKeys = Object.keys(rootEntry).sort()
    const srcKeys = Object.keys(srcEntry).sort()
    const expected = [...new Set([...srcKeys, ...ROOT_ONLY_REEXPORTS])].sort()

    expect(rootKeys.length).toBe(expected.length)
    expect(rootKeys).toEqual(expected)

    // Every src export is forwarded under the same name (nothing shadowed or
    // silently renamed by the shim).
    for (const key of srcKeys) {
      expect(rootKeys).toContain(key)
    }
  })

  it('makes the conductor runtime helpers reachable from the root', () => {
    // Reachable *and* the same bindings the conductor entry uses: re-exported
    // functions, not re-implementations.
    expect(rootEntry.resolveStateLayout).toBe(sourceResolveStateLayout)
    expect(rootEntry.resolveTrust).toBe(sourceResolveTrust)
    expect(rootEntry.registerConductorTools).toBe(sourceRegisterConductorTools)
    expect(typeof rootEntry.setupConductor).toBe('function')
  })
})
