# File-backed agent configuration

`src/runtime/configuration-store.ts` exports synchronous server-side helpers. The caller supplies
`ConfigurationAuthority` (`projectRoot`, `configDir`, optional `assetsDir`), resolved by the
server rather than from RPC input. The caller is responsible for authorization and project trust.
These helpers do not grant trust or execute verification commands.

- `readAgentDocument(authority, { agentId, scope })` returns
  `{ agentId, scope, target, revision, fields, writable, warnings }`.
- `saveAgentDocument(authority, { agentId, scope, expectedRevision, fields })` applies only
  supplied fields and returns a fresh document. `fields` supports `model` (provider/model with
  optional #variant), `steps` (number or null to remove), `system`, and `permissions` (the full
  native list of `{ action, resource, effect }`, where effect is allow, ask, or deny). Merge
  skill edits into the full list rather than sending only skill rules. Unchanged permission
  categories are retained verbatim. Variant is persisted as native `variant` frontmatter.
- For a new override the store uses `assetsDir/agents/<id>.md` as its source. Without a source,
  creation requires an explicit system prompt. Redacted prompts are rejected. The packaged source
  must be made available by the server when preserving its prompt is required.
- `readProjectSettings(authority)` returns `{ target, revision, settings, warnings }`; settings
  is null when the file is absent. `loadProjectSettings(projectRoot)` returns settings or null.
  Invalid existing files throw.
- `saveProjectSettings(authority, { expectedRevision, settings })` returns the same document
  shape. Settings consist of `branches: { main, dev }`, `verificationCommands: string[]`,
  `preview: { provider: 'vercel' | 'other' | 'none', url, branch }`, and
  `memory: { enabled: boolean }`. An empty preview URL or branch means unset. Unrelated JSON
  properties are preserved; conductor configuration must be valid JSON, not JSONC.

Files are confined to `.opencode/agents/<id>.md` in the project, `agents/<id>.md` in the global
config root, and project `.opencode/conductor.json`. Revision hashes distinguish missing files
from empty files. Saves use an exclusive sibling lock, check the revision inside the lock, and
atomically rename a temporary file. Conflicts and malformed input throw; read again before retrying.
Cooperating writers must use the same lock. Symlink components are refused; these checks do not
protect against a malicious local process racing filesystem operations.

Markdown edits retain untouched frontmatter and permissions. A non-block `permission` cannot
safely be edited and is rejected. A native `opencode.json` or `opencode.jsonc` produces a
precedence warning; those files are never edited, and saving an override does not prove that it
became effective. Saving does not reload host configuration.
