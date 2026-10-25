# OpenCode Supervisor — Compatibility Audit

**Date:** 2026-08-08
**Repository:** ~ (reguardian)
**OpenCode Version:** 1.18.15
**Package Manager:** Bun 1.3.4
**Node.js:** 25.6.0

---

## 1. OpenCode Version

| Item                 | Value     |
| -------------------- | --------- |
| CLI binary           | 1.18.15   |
| Install location     | `~/.bun/bin/opencode` |
| Config dialect       | V1 (project), mixed V1/V2 (global) |
| V2 support           | V2 fields (`description`, `mode`, `model`, `steps`, `permissions`) supported; V1 legacy fields not accepted in V2 agent frontmatter |

The installed version 1.18.15 supports both V1 and V2 configuration shapes. The project-level `opencode.json` uses V1 syntax (`"permission": { "*": "allow" }`). The global `opencode.jsonc` uses V1 syntax (`"enabled"` flag on MCP servers). V2 syntax uses `"permissions": [...]` (ordered rules) and `"disabled"` (for MCP servers).

---

## 2. V1/V2 Configuration Compatibility

### Project config (`opencode.json`) — V1 shape

The current project config uses V1 syntax:
- `"permission": { "*": "allow", ... }` — flat object map, not ordered rules
- `"mcp": { ... }` with `"enabled": true` flags — V1 convention
- No agent definitions
- No `plugins` array

### Required migration for V2 agents

V2 agent definitions use:
- `description` (string)
- `mode` ("primary" | "subagent" | "all")
- `model` (provider/model)
- `steps` (number)
- `permissions` (ordered array of `{ action, resource, effect }`)
- `tools` (optional, per-agent MCP scoping)

### Recommendations

1. Add V2 `agents` block alongside existing V1 permission block (coexistence supported)
2. Gradually migrate `permission` → `permissions` (ordered rules)
3. Add `disabled` to MCP servers for unsupervised profiles
4. Test V1/V2 coexistence before removing any V1 keys

---

## 3. Model Catalog — Verified References

### Requested models vs. actual catalog

| Requested Name     | Verified Provider/Model ID(s)                                         | Status             |
| ------------------ | --------------------------------------------------------------------- | ------------------ |
| DeepSeek-V4-Pro    | `opencode/deepseek-v4-pro`, `deepseek/deepseek-v4-pro`, `vercel/deepseek/deepseek-v4-pro` | **Available** |
| DeepSeek-V4-Flash  | `opencode/deepseek-v4-flash`, `opencode/deepseek-v4-flash-free`, `deepseek/deepseek-v4-flash`, `vercel/deepseek/deepseek-v4-flash` | **Available** |
| kimi-k3            | `opencode/kimi-k3`, `moonshotai/kimi-k3`, `vercel/moonshotai/kimi-k3`, `kimi-for-coding/k3` | **Available** |
| qween-3.8          | **NOT FOUND** — Closest matches: `vercel/alibaba/qwen3.8-max`, `opencode-go/qwen3.8-max` | **TYP0 — use qwen3.8-max** |
| gpt-5.6-luna       | `opencode/gpt-5.6-luna`, `openai/gpt-5.6-luna`, `vercel/openai/gpt-5.6-luna` | **Available** |
| step-3.7-flash     | `vercel/stepfun/step-3.7-flash` | **Available** |

### Summary

- 5 of 6 requested models are available in the catalog
- `qween-3.8` is almost certainly a typo for `qwen3.8-max` (available as `vercel/alibaba/qwen3.8-max` or `opencode-go/qwen3.8-max`)
- The primary OpenCode gateway prefix (`opencode/*`) provides most models with fallback routing

### Recommended canonical references

```text
opencode/deepseek-v4-pro      → conductor, architect, coder (complex), integrator
opencode/deepseek-v4-flash    → scout, external-scout, test-engineer, build-verifier, memory-curator
opencode/kimi-k3              → coder (general), test-engineer
vercel/alibaba/qwen3.8-max    → coder (general)
opencode/gpt-5.6-luna         → critic, frontend-specialist, security-critic
vercel/stepfun/step-3.7-flash → fast repair, routine tests
```

---

## 4. MCP Server Inventory

### Currently configured (project `opencode.json`)

| Server                    | Type   | Endpoint                                                | Risk Profile       |
| ------------------------- | ------ | ------------------------------------------------------- | ------------------ |
| LiteParse                 | remote | https://developers.llamaindex.ai/mcp                    | Read (documents)   |
| domain-checker-remote-mcp | remote | https://domain-checker-remote-mcp-la5h5.ondigitalocean.app/mcp | Read (DNS) |
| hugeicons                 | local  | `bunx -y @hugeicons/mcp-server`                         | Read (icons)       |
| cloudflare                | remote | https://mcp.cloudflare.com/mcp                          | **Mutation-capable** |
| cloudflare-docs           | remote | https://docs.mcp.cloudflare.com/mcp                     | Read (docs)        |
| cloudflare-bindings       | remote | https://bindings.mcp.cloudflare.com/mcp                 | **Mutation-capable** |
| cloudflare-builds        | remote | https://builds.mcp.cloudflare.com/mcp                   | **Mutation-capable** |
| cloudflare-observability  | remote | https://observability.mcp.cloudflare.com/mcp            | Read (observability) |

### Currently configured (global `~/.config/opencode/opencode.jsonc`)

| Server           | Type   | Command                                                     | Risk Profile |
| ---------------- | ------ | ----------------------------------------------------------- | ------------ |
| Roblox_Studio    | local  | `/Applications/RobloxStudio.app/Contents/MacOS/StudioMCP`   | N/A (unrelated) |
| robloxstudio-mcp | local  | `npx -y robloxstudio-mcp@latest`                            | N/A (unrelated) |

### Unsafe defaults for unattended operation

1. **`cloudflare`** (full Cloudflare API) — allows Workers script modification, KV/R2/D1 mutation, DNS changes, etc. **Must be disabled** for unattended agents.
2. **`cloudflare-bindings`** — allows KV/D1/R2/Hyperdrive create/delete. **Must be disabled** for unattended agents.
3. **`cloudflare-builds`** — allows build management and deployment. **Must be disabled** for unattended agents.
4. **Broad `allow` permissions** — `bash: "allow"`, `edit: "allow"`, `task: "allow"`, etc. grant all agents full access. **Must be replaced** with ordered role-specific rules for unattended operation.
5. **`hugeicons`** — local `bunx` install without pinning. Minor supply-chain risk.

### MCP Profile Recommendations

For supervisor-managed runs, MCP servers should be scoped to task profiles:
- **core-readonly**: No servers needed (repository tooling only)
- **document**: LiteParse only
- **cloud-readonly**: cloudflare-docs + cloudflare-observability (both read-only)
- **cloud-mutation**: cloudflare + cloudflare-bindings + cloudflare-builds (**human-approved only**)
- **browser-ui**: Not currently configured
- **issue-ops**: Not currently configured
- **release**: Not currently configured

---

## 5. Plugin Compatibility

### opencode-agent-memory

The memory plugin (`@joshuadavidthomas/opencode-agent-memory`) is not currently installed. The architecture journal recommends version `0.2.0`.

**Compatibility concerns:**
- Plugin must support the OpenCode 1.18.15 plugin API
- V1 plugin config uses `plugin` key; V2 uses `plugins` array
- The plugin README may document V1 API only — verify against V2

**Recommendation:** Install in a disposable test project before integrating with the supervisor. Pin version. If incompatible, implement the same memory contract locally within the supervisor.

### Other plugins

No plugins are currently active in the project configuration. The supervisor should not add plugins without explicit testing.

---

## 6. Existing Agent/Skill State

### Agents

- **None** in `.opencode/agents/` — directory does not exist
- **None** in `~/.config/opencode/agents/` — not checked for project scope

### Skills

- `.opencode/skills/` — does not exist
- `~/.config/opencode/skills/find-skills` — one global skill installed
- `.agents/skills/` — 48 skills available (see AGENTS.md context)

### Context

- `.opencode/context/` — does not exist
- `.opencode/runs/` — does not exist

### Summary

All agent, skill, context, and run directories need to be created from scratch.

---

## 7. Permission Risks for Unattended Operation

### Current permissions (all `allow`)

```json
{
  "permission": {
    "*": "allow",
    "bash": "allow",
    "edit": "allow",
    "webfetch": "allow",
    "websearch": "allow",
    "question": "allow",
    "skill": "allow",
    "todoread": "allow",
    "list": "allow",
    "codesearch": "allow",
    "read": "allow",
    "doom_loop": "allow",
    "task": "allow",
    "grep": "allow",
    "lsp": "allow"
  }
}
```

### High-risk gaps for unattended execution

| Gap | Risk |
| --- | ---- |
| `bash: "allow"` without resource scoping | Any shell command, including `rm -rf`, `git push --force`, `sudo`, etc. |
| `edit: "allow"` without path restrictions | Modify any file including `.env`, credentials, migrations |
| `doom_loop: "allow"` | Allows recursive agent spawning with no bound |
| `task: "allow"` | Allows spawning subagents without restriction |
| `webfetch: "allow"` | Allows fetching arbitrary URLs (SSRF risk) |
| No secret-file deny rules | `.env`, `.key`, credential files are readable |

### Required changes before unattended mode

1. Replace flat `permission` map with ordered `permissions` array
2. Add deny rules for `.env*`, `*.key`, credential files
3. Scope `bash` to safe commands; deny `git push`, `sudo`, `rm -rf`
4. Limit `edit` to agent-specific paths
5. Deny `doom_loop` for subagents
6. Scope `task` to specific subagent names
7. Deny `webfetch` except for external-scout agent

---

## 8. Repository Build & Test Commands

| Command              | Status    |
| -------------------- | --------- |
| `bun install`        | Working (bun.lock present) |
| `bun run format`     | `prettier .` |
| `bun run lint`       | `eslint` |
| `bun run check`      | `prettier --write . && eslint --fix` |
| `bun run test`       | `vitest run` (requires `VITEST=true` env) |
| `bun run build`      | `NODE_OPTIONS="--max-old-space-size=8192" vite build` (heavy, may fail in CI without secrets) |

### Test configuration

- No standalone `vitest.config.ts` — Vitest config is inline in `vite.config.ts` via `isVitest` flag
- Tests run with: `VITEST=true bun run test`
- Only test file found: `packages/compliance-core/src/scoring.test.ts`

### Validation commands for supervisor

The deterministic validation profile should use:

```bash
bun run format  # Prettier formatting check
bun run lint    # ESLint
bun run test    # Vitest (VITEST=true may be needed)
bun run build   # Vite production build (last, heaviest)
```

Note: `bun run build` requires full application dependencies and may fail without proper env setup. The supervisor should make build optional for non-application changes.

---

## 9. Git and Worktree State

| Item            | Value |
| --------------- | ----- |
| Current branch  | `main` |
| Worktree state  | Clean (only journal file untracked) |
| Git worktree support | Available (git 2.x+) |
| Protected branch | `main` (assumed from branch naming) |

---

## 10. SQLite Availability

Bun's built-in `bun:sqlite` module is available natively. No additional dependency needed for the local ledger. WAL mode is supported.

For PostgreSQL compatibility, the ledger interface should be abstract. The application already uses `drizzle-orm` with Neon PostgreSQL, but the supervisor should remain independent.

---

## 11. Summary of Compatibility Decisions

| Decision | Verdict |
| -------- | ------- |
| OpenCode version supports V2 agents | Yes (1.18.15) |
| Can coexist V1 + V2 config | Yes, separate keys |
| All requested models available | 5 of 6; `qween-3.8` → `qwen3.8-max` |
| MCP servers safe for unattended | No — 3 mutation-capable Cloudflare servers must be disabled |
| Permissions safe for unattended | No — broad `allow` must be replaced with ordered scoped rules |
| `opencode-agent-memory` compatible | Unknown — requires isolated testing |
| SQLite available natively | Yes (`bun:sqlite`) |
| Git worktree available | Yes |
| Existing agent/skill infrastructure | None — all must be created |
| Build/test commands reliable | Format + lint reliable; test + build may need env setup |

---

## 12. Action Items Before Implementation

1. [x] Verify OpenCode version and V2 support
2. [x] Catalog all model references
3. [x] Audit MCP servers and permissions
4. [x] Document safe defaults for unattended operation
5. [ ] Test `opencode-agent-memory@0.2.0` compatibility in isolated project (Phase 11)
6. [ ] Create `.opencode/` directories for agents, skills, context
7. [ ] Replace broad permissions with ordered role-specific rules
8. [ ] Disable mutation-capable MCP servers in unattended profiles
9. [ ] Create SQLite ledger with abstract interface
10. [ ] Implement worktree provider
11. [ ] Create harness adapter for OpenCode child processes
