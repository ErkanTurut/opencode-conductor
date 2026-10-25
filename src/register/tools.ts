// Trust-gated tool registration for the global plugin entry.
//
// The conductor is installed once, globally, and then runs in every folder the
// operator opens — including freshly cloned, hostile repositories. Registering
// the supervisor tools everywhere is safe only when the mutating ones refuse to
// act in a folder the user has not trusted (see `runtime/trust.ts` for why the
// grant can only come from a user-owned config file).
//
// This module is the single seam between "the supervisor tool set" and "the
// runtime's editor". It wraps `registerSupervisorTools` and intercepts `add`:
//
//   - read-only tools always pass through, untouched and un-wrapped;
//   - a mutating tool in an untrusted project is registered with a replacement
//     executor that returns a refusal JSON string — never throws, never touches
//     the ledger, and keeps the original input schema so the tool list still
//     describes what the tool would do once trusted;
//   - the read-only set is an allowlist: an unknown name (including a tool added
//     in a future release) is MUTATING, so a forgotten entry fails closed.
//
// Import note: `../plugin` is extensionless because the package's `tsc
// --noEmit` baseline rejects `.ts`-suffixed imports (TS5097).
import {
  registerSupervisorTools,
  type ResolvedSupervisorConfig,
  type ToolRegistrar,
} from '../plugin'

/**
 * Tools that only read. Everything else — including names this release does not
 * know about — is treated as mutating, so adding a tool without classifying it
 * denies in an untrusted project instead of silently allowing a write.
 */
export const READ_ONLY_SUPERVISOR_TOOLS: ReadonlySet<string> = new Set([
  'supervisor_get_status',
  'supervisor_patrol',
])

/** Stable refusal code; the CLI and the doctor both key on it. */
export const UNTRUSTED_PROJECT_CODE = 'untrusted_project'

/** What the gate needs to know about the folder the session runs in. */
export interface ToolTrustGuard {
  trusted: boolean
  /** Canonical project root the trust decision was made for. */
  projectRoot: string
  /** The exact remedy (`runtime/trust.ts`'s `TRUST_GRANT_HINT`). */
  hint: string
}

/** The refusal payload, as returned (JSON-encoded) from a blocked tool. */
export interface UntrustedRefusal {
  refused: true
  code: typeof UNTRUSTED_PROJECT_CODE
  tool: string
  project_root: string
  message: string
  hint: string
}

/** True only for the enumerated read-only set. Unknown names are mutating. */
export function isReadOnlySupervisorTool(name: string): boolean {
  return READ_ONLY_SUPERVISOR_TOOLS.has(name)
}

/** Fail-closed predicate: anything not proven read-only may mutate. */
export function isMutatingSupervisorTool(name: string): boolean {
  return !isReadOnlySupervisorTool(name)
}

/** Build the refusal payload for one tool. Deterministic and JSON-safe. */
export function untrustedRefusal(
  tool: string,
  guard: ToolTrustGuard,
): UntrustedRefusal {
  return {
    refused: true,
    code: UNTRUSTED_PROJECT_CODE,
    tool,
    project_root: guard.projectRoot,
    message: `Project ${guard.projectRoot} is not trusted; ${tool} mutates conductor state and was refused.`,
    hint: guard.hint,
  }
}

/**
 * Wrap a registrar with the trust gate.
 *
 * Exported separately from `registerConductorTools` so the interception rules
 * can be exercised against arbitrary definitions (including a hypothetical
 * future tool) without going through the supervisor tool set.
 */
export function createGuardedEditor(
  editor: ToolRegistrar,
  guard: ToolTrustGuard,
): ToolRegistrar {
  return {
    add(definition) {
      // Read-only tools and every tool in a trusted project are passed by
      // reference: name, description, input schema and executor stay exactly
      // what `registerSupervisorTools` produced.
      if (guard.trusted || isReadOnlySupervisorTool(definition.name)) {
        editor.add(definition)
        return
      }

      const tool = definition.name
      editor.add({
        ...definition,
        // Never throws: a refused tool must be a normal tool result, so the
        // agent can read the refusal and the operator remedy instead of
        // retrying a crashed call. The ledger is never opened here.
        async execute() {
          return JSON.stringify(untrustedRefusal(tool, guard))
        },
      })
    },
  }
}

/**
 * Register the supervisor tool set for a global install: all tools are always
 * listed, but mutating ones refuse while the project is untrusted.
 */
export function registerConductorTools(
  editor: ToolRegistrar,
  runtime: ResolvedSupervisorConfig,
  guard: ToolTrustGuard,
): void {
  registerSupervisorTools(createGuardedEditor(editor, guard), runtime)
}
