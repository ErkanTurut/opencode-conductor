/**
 * opencode-conductor — public package surface (ported from the project supervisor).
 *
 * `export *` from each module keeps the existing names (the same names callers
 * import from the individual paths today) and adds the plugin factory.
 *
 * Authority note: `SqliteLedger` / `ILedger` is the sole fencing, lease,
 * heartbeat, sequence and durable-state authority. Anything reachable through a
 * `ViewProjectionStore` (runtime `ctx.storage`) is a read/write VIEW cache and
 * carries no authority — see `PROJECTION_FORBIDDEN_AUTHORITY_NAMES`.
 *
 * Deliberately NOT re-exported here (side-effecting entry points / TUI runtime):
 * `./cli.ts`, `./cli-models.ts`, `./fleet-config.ts`, `./fleet-sync.ts`,
 * `./fleet-ui/*`. Import those by path.
 */
export * from './types.ts'
export * from './state-machine.ts'
export * from './policy.ts'
export * from './model-router.ts'
export * from './scheduler.ts'
export * from './artifacts.ts'
export * from './ledger/types.ts'
export * from './ledger/interface.ts'
export * from './ledger/sqlite.ts'
export * from './receipt.ts'
export * from './worktrees.ts'
export * from './watchdog.ts'
export * from './runner.ts'
export * from './adapters/types.ts'
export * from './adapters/opencode-cli.ts'
export * from './jev/index.ts'
export * from './plugin.ts'

// The runtime plugin object (auto-discovery shape) as an explicit named export,
// so `.opencode/plugins/supervisor.js` and package consumers share one binding.
export { default as supervisorPlugin } from './plugin.ts'

// Project detection (verify commands, branches, drift hash). Re-exported so a
// caller can re-detect and compare `hash` with the record written at setup
// without importing the runtime module by path.
export * from './runtime/detect'

// ---------------------------------------------------------------------------
// Global plugin entry (`conductor`)
//
// This is the additive, globally installed entry point. It is deliberately
// separate from `plugin.ts`'s project-scoped `{ id: 'supervisor' }` object:
// a global install must stay safe in folders the user has never trusted, so the
// entry probes the runtime, resolves the project's state location, asks
// `runtime/trust.ts` whether mutation is allowed, and only then registers the
// tool set through the trust gate in `register/tools.ts`.
//
// Deliberately NOT ported here (P1 scope): `plugin.ts`'s `execute.before` hook
// (`supervisorPolicyGuard` + `supervisorExecuteBeforeGuard`), the policy
// snapshot, and the `ctx.storage` projection bridge. Registering a second hook
// beside the existing one would double-gate every event; the hook port belongs
// to its own task.
//
// Import note: the new imports are extensionless, matching `runtime/*`, because
// the package's `tsc --noEmit` baseline rejects `.ts`-suffixed imports (TS5097).
// ---------------------------------------------------------------------------
import { join } from 'node:path'
import { Plugin } from '@opencode/plugin'
import { readCtxOptions, resolveSupervisorConfig, registerSupervisorTools, type ToolRegistrar } from './plugin'
import { loadProjectSettings } from './runtime/configuration-store'
import { registerConductorTools, isReadOnlySupervisorTool } from './register/tools'
import { registerConductorRpc } from './rpc/register'
import {
  loadAgentDefinitions,
  nodeMaterializeFs,
  registerAgents,
  resolveAgentConfigDir,
  resolveAssetsDir,
} from './register/agents'
import { loadSkillAssets, registerSkills } from './register/skills'
import {
  formatDoctorReport,
  materializeSkillDirs,
  probeRuntime,
  type RuntimeProbe,
  type RuntimeProbeEnv,
} from './runtime/compat'
import {
  resolvePolicyAuthority,
  isAuthorityIntact,
  type PolicyAuthoritySnapshot,
} from './runtime/policy-authority'
import { resolveProjectIdentity } from './runtime/project'
import { resolveTrust } from './runtime/trust'

/** Stable plugin id (the runtime keys the plugin object by it). */
export const CONDUCTOR_PLUGIN_ID = 'conductor'

/**
 * Explicit file fallback. The default is runtime registration through
 * `ctx.agent.transform` / `ctx.skill.transform`; set `CONDUCTOR_MATERIALIZE=1`
 * only when the host's transform APIs are unavailable.
 */
export const MATERIALIZE_ENV_VAR = 'CONDUCTOR_MATERIALIZE'

/** Stable refusal code for "the policy authority is restricted". */
export const POLICY_RESTRICTED_CODE = 'policy_restricted' as const

/** The exact remedy quoted in every restricted-policy refusal. */
export const POLICY_RESTRICTED_HINT = 'Fix the policy configuration; run /conductor:doctor.'

/** Failure recorded when the authority itself could not be resolved. */
const UNRESOLVED_AUTHORITY_FAILURE = {
  code: 'authority_unresolved',
  detail: 'the policy authority reported `restricted` without a failure code',
} as const

/**
 * The refusal payload a mutating tool returns while the policy authority is
 * restricted (never thrown: the agent must be able to read it and the operator
 * must see the remedy).
 */
export interface PolicyRestrictedRefusal {
  refused: true
  code: typeof POLICY_RESTRICTED_CODE
  tool: string
  failure: { code: string; detail: string }
  message: string
  hint: string
}

/** Build the restricted-policy refusal for one tool. */
export function policyRestrictedRefusal(
  tool: string,
  failure: { code: string; detail: string },
): PolicyRestrictedRefusal {
  return {
    refused: true,
    code: POLICY_RESTRICTED_CODE,
    tool,
    failure,
    message: `Policy authority is restricted (${failure.code}); ${tool} mutates conductor state and was refused.`,
    hint: POLICY_RESTRICTED_HINT,
  }
}

/**
 * Registrar wrapper for a restricted policy authority.
 *
 * It reuses the trust gate's classification (`isReadOnlySupervisorTool`: the
 * enumerated read-only allowlist with unknown names treated as MUTATING, so a
 * future tool fails closed) and only replaces the refusal code/payload. It
 * lives here rather than in `register/tools.ts` because the refusal code there
 * is a typed `untrusted_project` literal; the policy refusal is a different
 * authority state, not an untrusted folder.
 */
export function createPolicyRestrictedEditor(
  editor: ToolRegistrar,
  failure: { code: string; detail: string },
): ToolRegistrar {
  return {
    add(definition) {
      if (isReadOnlySupervisorTool(definition.name)) {
        editor.add(definition)
        return
      }
      const tool = definition.name
      editor.add({
        ...definition,
        // Never throws, never touches the ledger, keeps the input schema.
        async execute() {
          return JSON.stringify(policyRestrictedRefusal(tool, failure))
        },
      })
    },
  }
}

/**
 * The one tool registered when the runtime probe fails: it can explain the
 * failure without any of the capabilities the failure is about.
 */
export const DOCTOR_TOOL_NAME = 'supervisor_doctor'

const DOCTOR_TOOL_DESCRIPTION =
  'Report why the conductor runtime probe failed and how to fix it. This is the only conductor tool registered when the runtime is unusable.'

interface ConductorLocation {
  projectRoot: string
  projectId?: string
}

/**
 * Resolve where the session is running.
 *
 * Precedence matches the runtime contract: the canonical project path when the
 * host supplies one, else the session directory, else the process cwd. Read
 * defensively — `ctx.location` is host-supplied and may be partial.
 */
function resolveLocation(ctx: any): ConductorLocation {
  let location: any = null
  try {
    location = ctx?.location ?? null
  } catch {
    location = null
  }
  const project = location?.project ?? null
  const canonical =
    typeof project?.canonical === 'string' && project.canonical.length > 0
      ? project.canonical
      : null
  const directory =
    typeof location?.directory === 'string' && location.directory.length > 0
      ? location.directory
      : null
  const projectId =
    typeof project?.id === 'string' && project.id.length > 0
      ? project.id
      : undefined
  return {
    projectRoot: canonical ?? directory ?? process.cwd(),
    ...(projectId ? { projectId } : {}),
  }
}

/**
 * Injectable seams for `setupConductor` (tests only; the plugin's `setup(ctx)`
 * always uses `process.env` and the real runtime probe).
 */
export interface ConductorSetupOptions {
  /** Complete environment (no implicit process.env fallback when supplied). */
  env?: RuntimeProbeEnv
  /** Runtime probe override; defaults to the real `probeRuntime(env)`. */
  probe?: (env: RuntimeProbeEnv) => Promise<RuntimeProbe>
}

/**
 * Register the 15-agent roster at runtime.
 *
 * This runs on the probe-success path only: a runtime that cannot run the
 * supervisor must not advertise fifteen agents that depend on it. The roster is
 * built from the package's own assets (`assets/agents/*.md`, models from
     * native Markdown) and registered through `ctx.agent.transform` by
 * `register/*.ts`, which already turns every failure into a warning instead of
 * an exception.
 *
 * The file path is an explicit fallback (`CONDUCTOR_MATERIALIZE=1`), not the
 * default: a global install must not clone its roster into the user's config.
 * The default agent is whatever the user's config names; `editor.default` is
 * opt-in so an unrelated project is not forced onto the conductor.
 *
 * Returns the warnings so `/conductor:doctor` can report them; this function
 * never throws.
 */
async function registerAgentRoster(
  ctx: any,
  env: RuntimeProbeEnv,
): Promise<string[]> {
  const warnings: string[] = []
  try {
    const assetsDir = resolveAssetsDir(import.meta.dir)
    const definitions = loadAgentDefinitions(assetsDir)
    const result = await registerAgents(ctx, definitions, {
      env,
      transform: true,
      materialize: env[MATERIALIZE_ENV_VAR] === '1',
      setDefault: env.CONDUCTOR_SET_DEFAULT_AGENT === '1',
    })
    warnings.push(...result.warnings)
    for (const warning of result.warnings) {
      console.error(`[conductor] agent roster: ${warning}`)
    }
  } catch (error) {
    // Last resort: this function must never prevent the tool set from loading.
    const detail = error instanceof Error ? error.message : String(error)
    console.error(`[conductor] agent roster registration failed: ${detail}`)
    warnings.push(`agent roster registration failed: ${detail}`)
  }
  return warnings
}

/**
 * Register the workflow skills at runtime.
 *
 * `ctx.skill.transform(editor => editor.add(...))` is the default path on
 * OpenCode 2.2+. The file mirror is the explicit fallback
 * (`CONDUCTOR_MATERIALIZE=1`), used only when the host cannot register skills
 * in memory. Skills are additive and independent of the tool set: a failure is
 * a log line, never an exception.
 */
async function registerSkillRoster(
  ctx: any,
  assetsDir: string,
  env: RuntimeProbeEnv,
): Promise<void> {
  try {
    const assets = loadSkillAssets(join(assetsDir, 'skills'))
    const result = await registerSkills(ctx, assets)
    for (const warning of result.warnings) {
      console.error(`[conductor] skills: ${warning}`)
    }
    if (env[MATERIALIZE_ENV_VAR] === '1') {
      const configDir = resolveAgentConfigDir(env)
      if (!configDir) {
        console.error(
          '[conductor] skills not materialised: neither XDG_CONFIG_HOME nor HOME is set',
        )
        return
      }
      materializeSkillDirs(
        join(assetsDir, 'skills'),
        join(configDir, 'skills'),
        nodeMaterializeFs,
      )
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    console.error(`[conductor] skill registration failed: ${detail}`)
  }
}

/**
 * The plugin body.
 *
 * Setup order is the safety order:
 *   1. resolve the project location and its conductor state layout (`auto`:
 *      local when the checkout already owns a ledger, central otherwise);
 *   2. probe the runtime — on failure, register only `supervisor_doctor`, log
 *      the report once, and stop;
 *   3. register the 15-agent roster and the workflow skills at runtime — each
 *      additive and individually non-fatal; files are an explicit fallback;
 *   4. resolve the policy authority (package + user config, project may only
 *      tighten) and trust for the project root (fail-closed, never reads the
 *      project);
 *   5. register the full tool set behind the trust gate, plus the restricted
 *      policy gate when the authority could not be resolved.
 */
export async function setupConductor(
  ctx: any,
  options: ConductorSetupOptions = {},
): Promise<void> {
  const env = options.env ?? process.env
  const probe = options.probe ?? probeRuntime
  const { projectRoot, projectId } = resolveLocation(ctx)

  // Central state lives in the user's conductor home; local state in the
  // checkout. Either way the ledger path is the single path authority.
  // `resolveProjectIdentity` also runs read-only detection (runtime/detect.ts),
  // so the project record written at setup already carries this checkout's real
  // branch names and verify commands instead of placeholder defaults.
  const identity = resolveProjectIdentity({
    projectRoot,
    projectId,
    mode: 'auto',
    env,
  })

  const result = await probe(env)
  if (!result.ok) {
    // One tool, one log line: a broken runtime must degrade to a readable
    // diagnosis, never to a partially registered supervisor.
    const report = formatDoctorReport(result)
    console.error(report)
    await ctx.tool.transform((editor: ToolRegistrar) => {
      editor.add({
        name: DOCTOR_TOOL_NAME,
        description: DOCTOR_TOOL_DESCRIPTION,
        input: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
        async execute() {
          return report
        },
      })
    })
    return
  }

  // The roster and the skills are additive: they are registered before the
  // tools so a tool-registration failure cannot cost the operator their agents.
  // Failures inside are warnings by construction.
  await registerAgentRoster(ctx, env)

  const assetsDir = resolveAssetsDir(import.meta.dir)
  await registerSkillRoster(ctx, assetsDir, env)

  // Commands are omitted until the `Command.list` schema shape is confirmed
  // against a live instance: `command.transform` makes `Command.list` fail
  // schema validation on OpenCode 2.1.3. `register/commands.ts` stays for the
  // day the shape is confirmed; nothing here calls it.

  // Policy authority: rules come from the package bundles and the user's own
  // config; the checkout may only tighten them. A restricted snapshot covers
  // every mutating tool (the same gate the trust decision uses) while read-only
  // tools keep working — an unresolvable authority must not look like a broken
  // plugin. `env` is `process.env` in production; tests inject a complete
  // environment so the real home is never read.
  const authority: PolicyAuthoritySnapshot = resolvePolicyAuthority({
    projectRoot,
    env,
  })

  // Fail-closed: a missing/ambiguous grant means the mutating tools refuse.
  const trust = resolveTrust({ projectRoot, env })
  // Project settings are operational preferences, never authority grants.
  // Malformed explicit settings stop activation rather than silently running
  // against a different branch or skipping the expected verification profile.
  const projectSettings = loadProjectSettings(projectRoot)

  // The resolved layout (central or local) and the authority's shell rules are
  // carried into the runtime: run projections land in `runsDir`, and the verify
  // gate consults the same shell authority.
  const runtime = resolveSupervisorConfig({
    ctxOptions: readCtxOptions(ctx),
    detectedBranches: projectSettings?.branches ?? identity.record.branch,
    detectedVerifyProfile: projectSettings?.verificationCommands ?? identity.record.verify?.commands ?? [],
    options: {
      repoRoot: projectRoot,
      ledgerPath: identity.layout.ledgerPath,
      stateLayout: identity.layout,
      runsDir: identity.layout.runsDir,
      shellRules: authority.shellRules,
    },
    env,
  })

  await ctx.tool.transform((editor: ToolRegistrar) => {
    if (authority.restricted) {
      // Read-only tools still work; every mutating tool refuses with
      // `policy_restricted`, reusing the trust gate's classification.
      registerSupervisorTools(
        createPolicyRestrictedEditor(
          editor,
          authority.failure ?? UNRESOLVED_AUTHORITY_FAILURE,
        ),
        runtime,
      )
      return
    }
    registerConductorTools(editor, runtime, {
      trusted: trust.trusted,
      projectRoot: trust.projectRoot,
      hint: trust.hint,
    })
  })

  // Read-only GUI surface. Deliberately last: the tool set is the supervisor's
  // authority and must be registered even if a host predates `ctx.rpc`. The
  // handlers close over the resolved layout, so the GUI can read state but can
  // never name a path. No-op (with a warning) on runtimes without rpc.register.
  await registerConductorRpc(ctx, {
    projectRoot,
    layout: identity.layout,
    trusted: trust.trusted,
    policyRestricted: authority.restricted,
    assetsDir,
    branches: runtime.branches,
    verificationCommands: runtime.verifyProfile,
    governance: ctx.options?.governance,
    configDir: resolveAgentConfigDir(env) ?? undefined,
    globalDirectory: env.HOME,
    configurationAuthorityIntact: () => isAuthorityIntact(authority) && resolveTrust({ projectRoot, env }).trusted,
    onProjectSettingsSaved(settings) {
      // Existing registrations retain these object/array references. Explicit
      // options and environment still win, exactly as they do at startup.
      const updated = resolveSupervisorConfig({ ctxOptions: readCtxOptions(ctx), env,
        detectedBranches: settings.branches, detectedVerifyProfile: settings.verificationCommands })
      Object.assign(runtime.branches, updated.branches)
      runtime.verifyProfile.splice(0, runtime.verifyProfile.length, ...updated.verifyProfile)
    },
  })
}

/**
 * The global plugin object — the runtime contract. `id` keys the plugin; only
 * `setup(ctx)` is called, and it is the production wiring of `setupConductor`.
 */
export const conductorPlugin = Plugin.define({
  id: CONDUCTOR_PLUGIN_ID,
  async setup(ctx: any) {
    await setupConductor(ctx)
  },
})

export default conductorPlugin
