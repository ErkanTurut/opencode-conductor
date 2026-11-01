# Contributing to opencode-conductor

Thanks for contributing. This OpenCode plugin includes durable runs, agent/skill registration,
supervisor tools, a typed RPC contract, and a native Desktop workspace.

## Setup

Requirements: Bun, OpenCode 2.2.x CLI/Desktop, and Node for the GUI smoke script.

```sh
bun install
bun test
bun run typecheck
bunx tsc -p tsconfig.gui.json --noEmit
bun run gui:build
bun run smoke:gui
bun run build
```

## Authority and configuration

Native OpenCode agent Markdown and host-resolved JSON/JSONC configuration are authoritative.
Fleet tools/UI are catalog facilities, not active runtime overrides. Agent configuration edits
must be through fixed-target, revision-checked RPCs and preserve non-edited keys. Project
operational settings belong in `.opencode/conductor.json`; they cannot loosen user trust or
host permission authority. Configuration save success does not prove successful host reload or
effective application.

The GUI has eight tabs. Its only writes are the `agentDocument`/`saveAgentConfiguration` and
`projectSettings`/`saveProjectSettings` RPC flows. Do not add run mutations, approval, retry,
launch, remote push, PR, or merge actions to the GUI. Preview configuration is awareness only,
not provider/deployment verification.

Closeout requires a memory decision with rationale for every run, including failed/cancelled
runs. Curator proposals must be bounded, evidence-linked to run artifacts, free of raw personal
or sensitive data, and remain proposed/versioned (no auto-promotion).

## Pull request checklist

- [ ] Tests and relevant typechecks pass; baseline reports no new errors.
- [ ] GUI changes build and smoke-test; verify session location on every RPC call.
- [ ] Configuration changes cover revision conflicts, safe fixed targets, and preservation of
  non-edited native data.
- [ ] Documentation matches implemented behavior and clearly distinguishes hints from verified
  provider/deployment/host outcomes.
- [ ] No secrets, raw personal data, or live customer data in fixtures/docs.
- [ ] No live ledger/run/memory state is changed during tests.

## Release

Update `package.json` and `CHANGELOG.md`; rebuild the committed GUI bundle and run full checks.
Release verification, Desktop reload, live project verification, and publication must be backed
by evidence before they are described as passed. Do not invent a tag URL or claim publication.

See [AGENTS.md](AGENTS.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md),
[docs/GUI.md](docs/GUI.md), [docs/RPC.md](docs/RPC.md),
[docs/GUI-ITERATION.md](docs/GUI-ITERATION.md), and [docs/MIGRATION.md](docs/MIGRATION.md).
