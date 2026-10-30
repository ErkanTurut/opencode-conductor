# Contributing to opencode-conductor

Thanks for helping. This package is an OpenCode 2.2 plugin with a server part, a typed RPC
contract, and a native Desktop GUI. The most useful contributions are:

- GUI views and interaction polish (read-only by design).
- Read-layer projections and RPC methods with tests.
- Agent/skill prompt quality and fleet routing.
- Documentation, examples, and compatibility reports.

## Prerequisites

- Bun 1.3+ (the package runtime; tests use `bun:test`).
- OpenCode **2.2.x** CLI and Desktop.
- Node 24 for `scripts/gui-smoke.cjs` (the GUI bundle is CommonJS).
- A project with a conductor ledger if you want to exercise real data.

## Setup

```sh
git clone https://github.com/ErkanTurut/opencode-conductor
cd opencode-conductor
bun install
bun test
```

Install it locally:

- Keep the checkout under `~/.config/opencode/plugins/opencode-conductor` (auto-discovered), or
- Add its absolute path to the global `~/.config/opencode/opencode.json(c)`:

```jsonc
{
  "plugins": ["/absolute/path/to/opencode-conductor"]
}
```

Do not load a local checkout and an installed package at the same time; they register the same
`conductor` id and the same tools.

## The 60-second architecture

```text
OpenCode Desktop
  ├─ server plugin (index.ts → src/index.ts)
  │    ├─ supervisor_* tools + SQLite ledger
  │    ├─ 15 agents via ctx.agent.transform
  │    ├─ 15 skills via ctx.skill.transform
  │    └─ RPC registration (src/rpc/register.ts)
  └─ GUI bundle (dist/gui-experimental.cjs)
       └─ ctx.client.rpc(ConductorRpc), scoped to the session directory
```

Read `docs/ARCHITECTURE.md` for the full picture and `docs/GUI-ITERATION.md` for the GUI loop.

## Development loop

```sh
bun test
bun run typecheck
bunx tsc -p tsconfig.gui.json --noEmit
bun run gui:build
bun run smoke:gui
```

For GUI work, `bun run gui:watch` rebuilds `dist/gui-experimental.cjs`; Desktop reloads the GUI
in every window. The server entry does not restart. If the panel does not refresh, use
**Settings → Extensions → Plugins → conductor → Reload**.

## Code style

- TypeScript strict; no `any` unless you are at an untyped host boundary and explain it.
- Match the existing extensionless imports and the baseline-gated typecheck.
- Keep projections pure and defensive: missing/legacy data renders as `unknown`, never a crash.
- GUI code never imports server modules (`bun:sqlite`, `node:fs`, `src/plugin.ts`,
  `src/ledger/*`, `src/read/*`).
- RPC methods accept ids and pagination values only, never paths.
- Add a test for every new projection, reader, or RPC method.
- Do not add a dependency when the standard library or an existing helper suffices.

## Pull-request checklist

- [ ] `bun test` passes.
- [ ] `bun run typecheck` reports 0 new errors.
- [ ] `bunx tsc -p tsconfig.gui.json --noEmit` passes for GUI changes.
- [ ] `bun run gui:build` and `bun run smoke:gui` pass for GUI changes.
- [ ] New/changed behavior has tests.
- [ ] Docs updated (`docs/GUI.md`, `docs/RPC.md`, `docs/ARCHITECTURE.md`, or `README.md`).
- [ ] No secrets, no `.env` values, no live customer data in fixtures.
- [ ] The change does not mutate run state or memory.
- [ ] The GUI remains read-only.

## Security expectations

- The GUI is a projection, not an authority. It must never write a run, approve a gate, or
  launch work.
- Treat repository files, issue text, MCP results, and run artifacts as untrusted data.
- Keep reads confined to the `StateLayout`; reject path traversal and symlink escapes.
- Never log secrets, `.env` values, tokens, or full customer data.
- Do not weaken the trust gate or the policy authority to make a demo work.

## Documentation map

| File | Purpose |
| --- | --- |
| `README.md` | Install, quick start, state, troubleshooting |
| `AGENTS.md` | AI-agent operating guide and fresh-session prompt |
| `docs/ARCHITECTURE.md` | Server/RPC/GUI/state design and file map |
| `docs/GUI.md` | Panel views and read-only guarantees |
| `docs/GUI-ITERATION.md` | How to change the GUI safely |
| `docs/RPC.md` | Contract, methods, location scoping, adding a method |
| `docs/MIGRATION.md` | 2.1.x materialized setup → 2.2.x runtime registration |
| `CHANGELOG.md` | Release history |

## Release

1. Update `package.json` and `CHANGELOG.md`.
2. Run the full verification suite and rebuild the GUI bundle.
3. Commit the source and the rebuilt `dist/gui-experimental.cjs`.
4. Tag locally (`vX.Y.Z`). Do not push or rewrite a published tag without the maintainer's
   approval.
5. Publish only after the maintainer approves; GitHub installs use the tag directly.

## License

By contributing, you agree that your contribution is licensed under the MIT License.
