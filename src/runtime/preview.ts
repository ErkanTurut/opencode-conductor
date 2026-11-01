import { lstatSync, readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import type { PreviewAwareness, ProjectSettings } from '../rpc-contract'

/** Inspect only known non-secret configuration markers; never contact a URL. */
function marker(root: string, name: string): boolean {
  try {
    const base = realpathSync(root), path = resolve(base, name)
    const rel = relative(base, realpathSync(path))
    if (isAbsolute(rel) || rel.startsWith('..') || lstatSync(path).isSymbolicLink()) return false
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.size > 128_000) return false
    // A malformed or empty marker does not establish configuration.
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
  } catch { return false }
}

export function discoverPreview(projectRoot: string, devBranch: string, settings?: ProjectSettings | null): PreviewAwareness {
  const sources: string[] = []
  const configured = settings?.preview
  let provider: PreviewAwareness['provider'] = configured?.provider ?? 'unknown'
  if (configured) sources.push('.opencode/conductor.json#preview')
  if (!configured && (marker(projectRoot, '.vercel/project.json') || marker(projectRoot, 'vercel.json'))) {
    provider = 'vercel'
    sources.push('Vercel project configuration')
  }
  const branch = configured?.branch || devBranch
  return {
    provider, configured: provider === 'vercel' || provider === 'other',
    url: configured?.url || null, branch, sources, deploymentVerified: false,
    guidance: [
      ...(provider === 'unknown' || provider === 'none'
        ? ['No preview deployment is established by local configuration. Ask whether one exists; propose a branch-based preview setup if absent.']
        : [`${provider} configuration is present. Verify its development-branch deployment mapping; local files do not prove a successful deployment.`]),
      `Ask before merging the integration worktree into ${devBranch} and pushing the approved development branch.`,
      'After pushing, inspect the provider or GitHub deployment/check status for that exact commit. Do not accept an older successful deployment as evidence.',
      'Share the preview URL for the user to verify. If deployment fails, is missing, or cannot be checked, report the blocker rather than passing the gate.',
      'After the user verifies the preview, open or reuse the development-to-main PR. Never push main or merge the PR automatically.',
    ],
  }
}
