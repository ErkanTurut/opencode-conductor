/**
 * Package-root entry point — the *mountable* face of this package.
 *
 * Why this file exists: when a plugin is mounted from a local directory,
 * OpenCode resolves `index.ts` (or `server.ts`) **at the configured
 * directory**. It does not follow `package.json#main` for that path. So
 *
 *     "plugins": ["/abs/path/tools/opencode-conductor"]      // not loaded
 *     "plugins": ["/abs/path/tools/opencode-conductor/src"]  // loaded
 *
 * differ only because `src/index.ts` happens to satisfy the
 * index-at-the-configured-directory rule. This shim makes the package root
 * satisfy it too, which is the path a consumer actually installs (and the one
 * `files` ships).
 *
 * It is a re-export, not a copy: no logic, no registration, no side effects.
 * The named surface and the default plugin object stay in sync with
 * `src/index.ts` *by construction* (`export *` plus an explicit default
 * re-export) — never by re-declaring anything here. `export *` does not
 * forward `default`, hence the second line.
 *
 * Imports are extensionless on purpose: this package's `tsc --noEmit` rejects
 * `.ts` specifiers without `allowImportingTsExtensions` (TS5097), which is the
 * same reason `src/index.ts` imports its modules without a suffix.
 */
export * from './src/index'
export { default } from './src/index'

// The three primitives the conductor entry composes. `src/index.ts` keeps
// `runtime/*` and `register/*` off the *package* surface (it only imports them
// through `plugin.ts`), so a mount of the root would otherwise hand a host the
// plugin object with no way to reach its state-layout, trust, or registration
// seams. Publishing exactly these — no glob, no internal modules — keeps the
// mountable surface complete without inventing a second one. Explicit
// re-exports win over `export *`, so this stays correct if `src/index.ts` ever
// starts forwarding the same names.
export { resolveStateLayout } from './src/runtime/state-layout'
export { resolveTrust } from './src/runtime/trust'
export { registerConductorTools } from './src/register/tools'
