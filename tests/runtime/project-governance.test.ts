import { describe, expect, test } from 'bun:test'
import { decideProjectChange, hashProjectPolicy, isSafeBranch, isSafePreviewUrl, parseProjectPolicy } from '../../src/runtime/project-governance'

const policy = parseProjectPolicy({ repository: 'org/repo', remotes: ['origin'], targets: ['main', 'develop'], operations: ['push', 'merge'], requiredChecks: ['ci'], previewProviders: ['fake'], maxObservationAgeMs: 60000 })!
const change = { operation: 'merge' as const, repository: 'org/repo', remote: 'origin', target: 'main', candidateSHA: 'a'.repeat(40) }
const now = '2026-01-01T00:01:00Z'
const approval = { ...change, policyHash: hashProjectPolicy(policy), identity: 'human', issuedAt: '2026-01-01T00:00:00Z', expiresAt: '2026-01-01T00:02:00Z', verified: true as const }
const observation = { ...change, policyHash: approval.policyHash, observedAt: now, verified: true as const, remoteProtections: 'enforced' as const, checks: { ci: 'passed' as const }, preview: { provider: 'fake', url: 'https://preview.host.com/path', deploymentId: 'deploy-1', candidateSHA: change.candidateSHA, status: 'ready' as const, observedAt: now } }
const input = { policy, change, now, broaderAuthorityAllowed: true, approval, observation }
describe('governance', () => {
  test('allows only complete verified evidence', () => { expect(decideProjectChange(input).allowed).toBe(true); expect(decideProjectChange({ ...input, policy: null }).allowed).toBe(false); expect(decideProjectChange({ ...input, broaderAuthorityAllowed: false }).allowed).toBe(false); expect(decideProjectChange({ ...input, force: true }).allowed).toBe(false) })
  test('rejects invalid refs and URLs', () => { for (const x of ['main:evil', 'main~1', 'refs/heads/main', '-x', 'x.lock', 'a..b']) expect(isSafeBranch(x)).toBe(false); for (const x of ['file:///x', 'javascript:alert(1)', 'https://u:p@host.com', 'https://localhost', 'https://127.0.0.1', 'https://svc.internal']) expect(isSafePreviewUrl(x)).toBe(false) })
  test('rejects expired and replayed approval or preview', () => { expect(decideProjectChange({ ...input, approval: { ...approval, expiresAt: now } }).allowed).toBe(false); expect(decideProjectChange({ ...input, approval: { ...approval, candidateSHA: 'b'.repeat(40) } }).allowed).toBe(false); expect(decideProjectChange({ ...input, observation: { ...observation, preview: { ...observation.preview, candidateSHA: 'b'.repeat(40) } } }).allowed).toBe(false); expect(decideProjectChange({ ...input, observation: { ...observation, remoteProtections: 'unknown' } }).allowed).toBe(false) })
})
