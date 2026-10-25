import { describe, it, expect } from 'bun:test'
import {
  isRiskClassAllowed,
  isDataClassAllowed,
  isCommandAllowed,
  loadPolicyConfig,
  evaluateShellCommand,
  evaluateShellGate,
  isReadOnlyCommand,
  isJevEgressAllowed,
  resolveMcpAllowedServers,
  isToolInMcpScope,
  mcpServerNamespace,
  MCP_SERVERS,
  MCP_PROFILE_SERVERS,
  findProfileForKey,
  CANONICAL_SHELL_RULES,
} from '../src/policy'

describe('Policy — Risk Classes', () => {
  it('allows risk class at or below limit', () => {
    expect(isRiskClassAllowed('low', 'medium')).toBe(true)
    expect(isRiskClassAllowed('medium', 'medium')).toBe(true)
    expect(isRiskClassAllowed('high', 'medium')).toBe(false)
    expect(isRiskClassAllowed('critical', 'high')).toBe(false)
  })
})

describe('Policy — Data Classes', () => {
  it('allows data class at or below limit', () => {
    expect(isDataClassAllowed('public', 'internal')).toBe(true)
    expect(isDataClassAllowed('internal', 'internal')).toBe(true)
    expect(isDataClassAllowed('confidential', 'internal')).toBe(false)
    expect(isDataClassAllowed('regulated', 'internal')).toBe(false)
  })
})

describe('Policy — Command Allowlist', () => {
  const permissions = [
    { action: 'shell', resource: 'git push *', effect: 'deny' },
    { action: 'shell', resource: 'bun run *', effect: 'allow' },
    { action: 'shell', resource: 'sudo **', effect: 'deny' },
    { action: 'shell', resource: 'rm -rf *', effect: 'deny' },
  ]

  it('allows safe commands', () => {
    expect(isCommandAllowed('bun run test', permissions)).toBe(true)
    expect(isCommandAllowed('bun run lint', permissions)).toBe(true)
  })

  it('denies dangerous commands', () => {
    expect(isCommandAllowed('git push origin main', permissions)).toBe(false)
    expect(isCommandAllowed('sudo rm -rf /', permissions)).toBe(false)
    expect(isCommandAllowed('rm -rf node_modules', permissions)).toBe(false)
  })

  it('allows unmatched commands by default', () => {
    expect(isCommandAllowed('echo hello', permissions)).toBe(true)
  })
})

describe('Policy — Config Loading', () => {
  it('loads default values for missing fields', () => {
    const config = loadPolicyConfig({})
    expect(config.operationMode).toBe('assisted')
    expect(config.maxAttemptsPerTask).toBe(2)
    expect(config.maxRepairRounds).toBe(3)
    expect(config.unattendedMergeEnabled).toBe(false)
  })

  it('loads provided values', () => {
    const config = loadPolicyConfig({
      operation_mode: 'unattended',
      budget: {
        max_attempts_per_task: 3,
        max_repair_rounds: 5,
        unattended_merge_enabled: true,
      },
    })
    expect(config.operationMode).toBe('unattended')
    expect(config.maxAttemptsPerTask).toBe(3)
    expect(config.maxRepairRounds).toBe(5)
    expect(config.unattendedMergeEnabled).toBe(true)
  })

  it('carries profile permissions + mcp bundles and derives the shell default', () => {
    const observed = loadPolicyConfig({
      operation_mode: 'observe',
      permissions: [{ action: 'shell', resource: 'sudo **', effect: 'deny' }],
      mcp_profiles: ['core-readonly'],
    })
    expect(observed.denyMutatingShell).toBe(true)
    expect(observed.permissions).toHaveLength(1)
    expect(observed.mcpProfiles).toEqual(['core-readonly'])

    const assisted = loadPolicyConfig({ operation_mode: 'assisted' })
    expect(assisted.denyMutatingShell).toBe(false)

    const restricted = loadPolicyConfig({ operation_mode: 'assisted', restricted: true })
    expect(restricted.denyMutatingShell).toBe(true)
  })

  it('resolves a profile by policy_profile, basename or operation_mode', () => {
    const profiles = [
      { basename: 'local', profile: { operation_mode: 'observe', policy_profile: 'local' } },
      { basename: 'assisted', profile: { operation_mode: 'assisted', policy_profile: 'assisted' } },
    ]
    expect(findProfileForKey('assisted', profiles)?.basename).toBe('assisted')
    expect(findProfileForKey('observe', profiles)?.basename).toBe('local')
    expect(findProfileForKey('nope', profiles)).toBeNull()
  })
})

describe('Policy — fail-closed shell gate', () => {
  it('allows supervisor-safe read-only commands', () => {
    expect(isReadOnlyCommand('git status --porcelain')).toBe(true)
    expect(isReadOnlyCommand('cat foo.txt | grep bar')).toBe(true)
    expect(isReadOnlyCommand('bun run build')).toBe(false)
    expect(isReadOnlyCommand('git commit -m x')).toBe(false)
    expect(isReadOnlyCommand('echo hi > out.txt')).toBe(false)
  })

  it('denies dangerous commands under the canonical rules', () => {
    expect(evaluateShellCommand('git push origin main', CANONICAL_SHELL_RULES).allowed).toBe(false)
    expect(evaluateShellCommand('sudo rm -rf /', CANONICAL_SHELL_RULES).allowed).toBe(false)
    expect(evaluateShellCommand('chmod 777 x', CANONICAL_SHELL_RULES).allowed).toBe(false)
    expect(evaluateShellCommand('git clean -fdx', CANONICAL_SHELL_RULES).allowed).toBe(false)
    expect(evaluateShellCommand('git status', CANONICAL_SHELL_RULES).allowed).toBe(true)
  })

  it('prefers the most specific rule (develop push is ask, not deny)', () => {
    const ask = evaluateShellCommand('git push origin develop', CANONICAL_SHELL_RULES, {
      askEffect: 'allow',
    })
    expect(ask.allowed).toBe(true)
    const askFailClosed = evaluateShellCommand('git push origin develop', CANONICAL_SHELL_RULES, {
      askEffect: 'deny',
    })
    expect(askFailClosed.allowed).toBe(false)
  })

  it('denies unmatched mutating shells for a restricted (observe) profile', () => {
    const restricted = [
      { action: 'shell', resource: 'sudo **', effect: 'deny' },
    ]
    const denyMutating = { denyMutating: true, askEffect: 'deny' as const }
    expect(
      evaluateShellCommand('bun run build', restricted, denyMutating).allowed,
    ).toBe(false)
    expect(
      evaluateShellCommand('git status', restricted, denyMutating).allowed,
    ).toBe(true)
    // Non-restricted profiles keep unmatched commands (opencode prompts).
    expect(evaluateShellCommand('bun run build', restricted, {}).allowed).toBe(true)
  })

  it('keeps canonical root denials authoritative over additive profile rules', () => {
    const profileAsksRmRf = [
      { action: 'shell', resource: 'rm -rf *', effect: 'ask' },
    ]
    // A profile cannot soften the canonical deny into an ask.
    const softened = evaluateShellGate(
      'rm -rf /tmp/x',
      CANONICAL_SHELL_RULES,
      profileAsksRmRf,
      { askEffect: 'allow' },
    )
    expect(softened.allowed).toBe(false)

    // Profile rules still restrict further than the canonical set.
    const profileDeniesBunInstall = [
      { action: 'shell', resource: 'bun install *', effect: 'deny' },
    ]
    const additive = evaluateShellGate(
      'bun install left-pad',
      CANONICAL_SHELL_RULES,
      profileDeniesBunInstall,
      { askEffect: 'allow' },
    )
    expect(additive.allowed).toBe(false)

    // Canonical ask defers to the prompt when a human is present.
    expect(
      evaluateShellGate(
        'git push origin develop',
        CANONICAL_SHELL_RULES,
        profileAsksRmRf,
        { askEffect: 'allow' },
      ).allowed,
    ).toBe(true)
  })
})

describe('Policy — MCP scope', () => {
  it('expands bundles into allowed servers (core-readonly => none)', () => {
    expect(resolveMcpAllowedServers(['core-readonly'])).toEqual([])
    expect(resolveMcpAllowedServers(['document'])).toEqual(['LiteParse'])
    expect(resolveMcpAllowedServers(['core-readonly', 'cloud-readonly']).sort()).toEqual(
      ['cloudflare-docs', 'cloudflare-observability'].sort(),
    )
  })

  it('maps long MCP namespaces before their prefixes', () => {
    expect(mcpServerNamespace('cloudflare-docs_migrate')).toBe('cloudflare-docs')
    expect(mcpServerNamespace('cloudflare-builds_workers_list')).toBe('cloudflare-builds')
    expect(mcpServerNamespace('cloudflare_get_live')).toBe('cloudflare')
    expect(mcpServerNamespace('supabase_get_project_url')).toBe('supabase')
    expect(mcpServerNamespace('supabase.get_project_url')).toBe('supabase')
    expect(mcpServerNamespace('mcp__supabase__get_project_url')).toBe('supabase')
    expect(mcpServerNamespace('bash')).toBeNull()
    expect(mcpServerNamespace('grep')).toBeNull()
  })

  it('scopes MCP namespaces but never built-in tools', () => {
    expect(isToolInMcpScope('supabase_get_project_url', [])).toBe(false)
    expect(isToolInMcpScope('supabase_get_project_url', ['supabase'])).toBe(true)
    expect(isToolInMcpScope('reguardian_analyze_code_snippet', ['LiteParse'])).toBe(false)
    expect(isToolInMcpScope('bash', [])).toBe(true)
    expect(isToolInMcpScope('read', [])).toBe(true)

    // The assisted bundle set reaches all 12 documented servers.
    const assistedServers = resolveMcpAllowedServers(Object.keys(MCP_PROFILE_SERVERS))
    expect(assistedServers.sort()).toEqual([...MCP_SERVERS].sort())
  })
})

describe('Policy — Jev data-class egress gate', () => {
  it('gates confidential/regulated but keeps public/internal', () => {
    expect(isDataClassAllowed('confidential', 'internal')).toBe(false)
    expect(isDataClassAllowed('regulated', 'internal')).toBe(false)
    expect(isJevEgressAllowed('public')).toBe(true)
    expect(isJevEgressAllowed('internal')).toBe(true)
    expect(isJevEgressAllowed('confidential')).toBe(false)
    expect(isJevEgressAllowed('regulated')).toBe(false)
    expect(isJevEgressAllowed(undefined)).toBe(true)
    expect(isJevEgressAllowed('CONFIDENTIAL')).toBe(false)
  })
})
