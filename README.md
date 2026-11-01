# opencode-conductor

A multi-model workflow for [OpenCode](https://opencode.ai): durable project runs, a 15-agent
roster, workflow skills, supervisor tools, and a native Desktop workspace for runs, DAGs,
gates, refinements, memory, routing, agents, and project settings.

> **Requirements:** OpenCode 2.2.x CLI and Desktop. The GUI SDK is experimental in 2.2.

## Install

```sh
opencode plugin add github:ErkanTurut/opencode-conductor#v1.1.0
```

This is the intended release tag; verify publication before installing. The plugin is global.
The Desktop app has its own updater and must also be 2.2.x. Plugin configuration is watched by
OpenCode; configuration edits do not require restarting the service. If a host reload fails,
a saved edit is not yet applied.

## Quick start

1. Grant project trust in `~/.config/opencode/conductor.json`; mutating supervisor tools are
   fail-closed for untrusted projects.
2. Open a session in the project. Use **+ → Conductor** or the `conductor.open` command.
3. Review the **Agents** and **Project** tabs for native agent and operational settings.

## Workspace

The eight tabs are **Runs**, **DAG**, **Gates**, **Refinements**, **Memory**, **Routing &
timeline**, **Agents**, and **Project**. Runs separates active work from searchable,
paginated history. Selecting a run opens a compact-card DAG with task details.

Agent Markdown can be edited for model/variant, steps, prompt body, and permissions. Project
settings edit `.opencode/conductor.json` (branches, verification commands, preview awareness,
memory enabled). Saves go only to fixed targets, use revision checks, and preserve non-edited
native keys. Global agent edits require confirmation. Native OpenCode Markdown and JSON/JSONC
settings may take precedence over an edited Markdown file; heed the editor warning and verify
the effective host configuration. The GUI cannot loosen user-authority trust or host
permission rules.

`.opencode/conductor.json` operational settings are consumed at startup and run initialization.
Local Vercel markers/configuration can inform preview discovery, but do not prove a provider is
connected or a deployment succeeded. No automatic provider adapter, remote protection check,
PR creation, or merge is provided. Intended release flow: human-approved worktree → development
push → verify the exact pushed commit's preview → user review → development-to-main PR. Never
automatically create or merge the PR.

Existing native OpenCode agent Markdown/JSONC is authoritative. Fleet configuration, its CLI,
and the legacy fleet UI remain catalog tooling but are not runtime model overrides for agent
registration or the runner. Migrate active model choices to native agent Markdown.

## Closeout and memory

Every run closeout, including failed or cancelled runs, requires a receipt memory decision:
`none` or `curate` plus a bounded rationale. If project memory is explicitly disabled, closeout
records `disabled`. `curate` requires a memory-curator handoff: inspect relevant run artifacts
and existing project memory, then return `curator_proposal` (`label`, `content`,
`source_artifacts`, optional `expected_version`) or `curator_no_learning` with an explanation.
Proposals persist as immutable versioned **proposed** project blocks, never silently promoted.
Artifact references are confined to that run; personal data and sensitive content are rejected.
Do not put raw personal data in a proposal.

## State and policy

| Data | Location |
| --- | --- |
| Ledger | `<project>/.opencode/supervisor.db` |
| Run artifacts | `<project>/.opencode/runs/<run-id>/` |
| Project memory | `<project>/.opencode/memory/` |
| Operational settings | `<project>/.opencode/conductor.json` |
| User trust/policy | `~/.config/opencode/conductor.json` |

Scratch directories may use `~/.local/share/opencode-conductor/projects/<slug>-<hash8>/`.
Project operational settings do not grant trust. Project policy may tighten broader authority,
never loosen it. Preview configuration is awareness, not deployment evidence.

## Release evidence

v1.1.0 was verified in the isolated worktree and then activated from
`release/v1.1.0`: 959 tests pass, the baseline-gated server typecheck reports no new
diagnostics, GUI typecheck/build/smoke and the full build pass. The live plugin reports
`server`, `rpc`, and `gui` active; project reads were checked against real projects, and
configuration saves, stale-revision refusal, effective host reload, and cleanup were checked
with a temporary agent and project-settings probe. Manual Desktop click-through of the panel
was not performed. See [CHANGELOG.md](CHANGELOG.md) for details.

## Development

```sh
bun install
bun test
bun run typecheck
bunx tsc -p tsconfig.gui.json --noEmit
bun run gui:build
bun run smoke:gui
bun run build
```

The committed `dist/gui-experimental.cjs` is required for GitHub installs. See
[CONTRIBUTING.md](CONTRIBUTING.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md),
[docs/GUI.md](docs/GUI.md), [docs/RPC.md](docs/RPC.md),
[docs/GUI-ITERATION.md](docs/GUI-ITERATION.md), and [docs/MIGRATION.md](docs/MIGRATION.md).

## License

MIT. See [LICENSE](LICENSE).
