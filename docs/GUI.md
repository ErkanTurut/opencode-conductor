# Conductor Desktop workspace

The native OpenCode Desktop panel provides eight tabs: Runs, DAG, Gates, Refinements, Memory,
Routing & timeline, Agents, and Project. Every RPC call carries the current session location.

| Tab | Behavior |
|---|---|
| Runs | Active work plus searchable, paginated historical runs; project totals are separate from loaded pages. |
| DAG | Compact task cards, dependency graph, task detail, graph controls and accessible list. |
| Gates | Recorded checks, approvals and findings; evidence is not merge authorization. |
| Refinements | Parked-run questions and resulting requirements. |
| Memory | Versioned project/global blocks and review status. |
| Routing & timeline | Routes, usage when recorded, and run events. |
| Agents | Native agent Markdown configuration and host-resolved snapshot. |
| Project | Operational project settings and preview/policy awareness. |

## Configuration editing

The Agents editor supports native Markdown fields for model/variant, steps, prompt body, and
permissions. It saves to a fixed project target (`.opencode/agents/<id>.md`) or global target
(`~/.config/opencode/agents/<id>.md`), never a user-supplied path. Global saves require explicit
confirmation. Revision checks detect stale edits; the server changes only edited fields and
preserves unrelated frontmatter keys/body content. Project settings save to
`.opencode/conductor.json` and preserve unrelated top-level settings. Symlink paths are refused.

Native OpenCode agent Markdown and `opencode.json`/`opencode.jsonc` remain authoritative. A
native JSON/JSONC configuration can take precedence over the saved Markdown; the editor warns
when such configuration is present. Inspect the host-resolved result rather than assuming a
save changed effective behavior. A saved file whose host reload fails is **saved, not applied**
until OpenCode reloads it. Config watching is host behavior; no service restart is required by
these writes.

These are the only GUI writes. They do not grant trust, loosen host/user permission rules,
approve gates, retry/pause/launch runs, push branches, create PRs, or merge.

## Project settings and preview

`.opencode/conductor.json` stores branch names, verification commands, preview provider/URL/
branch awareness, and whether memory is enabled. Startup/run initialization consumes these
settings. Run initialization returns project context and locally discovered preview hints
(including Vercel configuration markers). Configuration is not a connected provider, successful
deployment, remote-protection observation, or approval. The proposed human-controlled sequence
is worktree → approved development push → verify the preview for that exact commit → user review
→ development-to-main PR. No provider adapter or automatic PR/merge is implemented.

## Agent model authority

Native OpenCode Markdown/JSONC wins. Fleet files, CLI, and legacy fleet UI remain catalog
functionality but do not override registration or runner model selection. Put active model and
variant choices in native agent Markdown.

## RPC methods

Read methods and configuration methods are documented in [RPC.md](RPC.md). All requests use
`{ location: { directory: session.directory } }`; GUI code has no direct filesystem or database
access. The configuration RPCs accept identifiers, fields, and revision tokens, not paths.
