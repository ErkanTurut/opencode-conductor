# opencode-conductor

A self-orchestrating multi-model pipeline for [OpenCode](https://opencode.ai): durable runs,
per-project state, a 15-agent roster, workflow skills, and a fail-closed trust gate.

> **Status: pre-release.** The package builds and its suite passes (758 tests), but the
> global runtime registration of agents, skills and slash commands is not yet stable in
> OpenCode 2.1.3. The supervisor tools, per-project state, trust gate and policy authority
> are proven. Do not install this expecting a working end-to-end pipeline yet.

## What it is

- **Supervisor tools** (`supervisor_*`): durable run state in SQLite, atomic task claims with
  fencing tokens, git-worktree isolation per mutating task, deterministic verification with
  recorded evidence, and receipts.
- **Per-project state**: a folder is a workspace. `state: auto` keeps existing in-repo
  `.opencode/` state where it exists and otherwise writes to
  `~/.local/share/opencode-conductor/projects/<slug>-<hash8>/`.
- **Trust gate**: mutating tools refuse in a folder you have not trusted. Grants live only in
  `~/.config/opencode/conductor.json`, never in the checkout.
- **Policy authority**: shell rules and profiles come from the package and your user config.
  A project's `opencode.json` can tighten them, never loosen them.
- **Verification containment**: `supervisor_verify` runs only the commands recorded on the
  task, and each one passes the shell gate.

## Install (when released)

```sh
opencode plugin add github:ErkanTurut/opencode-conductor#v0.1.0
```

Then trust a folder:

```sh
# ~/.config/opencode/conductor.json
{
  "trust": {
    "default": "deny",
    "grants": [{ "path": "/absolute/path/to/project", "grantedAt": "2026-01-01T00:00:00Z" }]
  }
}
```

## Development

```sh
cd tools/opencode-conductor   # in the source repo
bun install
bun test
bun run typecheck
bun run build
```

`tests/security/hostile-fixture.test.ts` is the adversarial suite: a hostile checkout cannot
widen policy, inject a verification command, or grant itself trust.

## Layout

| Path | Purpose |
| --- | --- |
| `index.ts` | package root entry (OpenCode mounts a directory, not `package.json#main`) |
| `src/index.ts` | plugin setup: runtime probe, project identity, trust, policy, tools |
| `src/runtime/` | state layout, project record, trust, policy authority, detection |
| `src/register/` | agents, skills, commands, tools |
| `src/ledger/` | SQLite ledger: runs, tasks, attempts, leases, events |
| `assets/agents/`, `assets/skills/` | the 15-agent roster and 15 workflow skills |

## License

MIT. See `LICENSE`.

Ported from a private project supervisor. Provenance notes in source headers describe
which patterns came from which upstream project; no upstream source was copied.
