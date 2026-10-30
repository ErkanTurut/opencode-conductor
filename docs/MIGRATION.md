# Migration: 2.1.x materialized setup → 2.2.x runtime registration

This guide is for an existing install that copied agents/skills into
`~/.config/opencode/{agents,skills}` and/or mounted a project-local
`.opencode/plugins/supervisor.js` shim. The 2.2 plugin registers the roster and skills at
runtime; the old copies are now duplicates and must be removed.

Nothing in this guide deletes run state, memory or the ledger.

## 1. Back up first

```sh
BACKUP="$HOME/opencode-conductor-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP"
cp -R ~/.config/opencode/agents "$BACKUP/agents" 2>/dev/null || true
cp -R ~/.config/opencode/skills "$BACKUP/skills" 2>/dev/null || true
cp ~/.config/opencode/opencode.jsonc "$BACKUP/opencode.jsonc" 2>/dev/null || true
cp ~/.config/opencode/conductor.json "$BACKUP/conductor.json" 2>/dev/null || true
echo "$BACKUP"
```

## 2. Upgrade OpenCode

- CLI: `opencode upgrade 2.2.4` (or newer 2.2.x).
- Desktop: use the app's own updater. The panel requires Desktop 2.2.x; the CLI upgrade does
  not update the Electron app.

Verify:

```sh
opencode --version   # 2.2.4 or newer 2.2.x
```

## 3. Install the plugin

```sh
opencode plugin add github:ErkanTurut/opencode-conductor#v1.0.1
```

`opencode plugin add` writes the package to the global `~/.config/opencode/opencode.json(c)`
`plugins` list. Keep the package there; the Desktop app reads that list to load the GUI.

## 4. Remove the old global copies

The plugin now registers the 15 roster agents and 15 skills in memory. The old files are
duplicates.

```sh
# Remove only the conductor roster; keep project/other-plugin agents.
cd ~/.config/opencode/agents 2>/dev/null && \
  rm -f architect.md build-verifier.md coder.md conductor.md critic.md \
        external-scout.md frontend-specialist.md integrator.md memory-curator.md \
        requirements-refiner.md scout.md security-critic.md test-engineer.md \
        visual-sketch-translator.md writing-reviewer.md

# Remove only the conductor skills; keep find-skills and user-specific skills.
cd ~/.config/opencode/skills 2>/dev/null && \
  rm -rf adversarial-review claims-audit closeout context-discovery copy-truth \
         deterministic-validation fixture-rls-repair integration-ledger memory-curation \
         requirement-interview run-intake screenshot-gate supervisor-orchestrate \
         task-contract union-merge
```

If you use `CONDUCTOR_MATERIALIZE=1`, skip this step; the plugin will regenerate the files.

## 5. Remove the project shim

In every project that has `.opencode/plugins/supervisor.js`, delete it. That shim loads a
second, older copy of the supervisor and registers the same `supervisor_*` tools twice.

```sh
rm .opencode/plugins/supervisor.js
```

Keep `.opencode/plugins/carousel` (or other project-specific plugins) untouched.

## 6. Remove duplicated project permission config

If `.opencode/opencode.jsonc` only mirrors the root `opencode.json` permissions, delete it.
Keep the root `opencode.json`: it is the project's policy authority and may tighten the
package policy.

Do **not** delete:

```text
.opencode/runs/
.opencode/memory/
.opencode/supervisor.db
.opencode/supervisor.db-shm
.opencode/supervisor.db-wal
```

## 7. Trust the project

Conductor is fail-closed. Add the project to `~/.config/opencode/conductor.json`:

```json
{
  "trust": {
    "default": "deny",
    "grants": [
      { "path": "/Users/turut/Documents/saul", "grantedAt": "2026-10-30T00:00:00Z" }
    ]
  }
}
```

The mutating tools return `untrusted_project` until the grant exists.

## 8. Verify

```sh
opencode --version
opencode debug agents          # conductor + the 14 roster agents
opencode plugin list           # conductor, version 1.0.1
```

In a session:

1. `supervisor_doctor` returns the runtime, layout, trust and policy summary.
2. The Conductor panel appears in the side region (Desktop 2.2.x).
3. The Runs tab lists the existing runs from `.opencode/supervisor.db`.
4. `~/.config/opencode/agents` has no conductor roster files (unless you opted into
   `CONDUCTOR_MATERIALIZE=1`).

## Saul-specific notes

`/Users/turut/Documents/saul` was the original development checkout:

- Remove `.opencode/plugins/supervisor.js`.
- Remove the 15 roster copies in `.opencode/agents/`; keep `hook-critic.md` (carousel).
- Remove the 15 duplicated skills in `.opencode/skills/`; keep the `find-skills` symlink.
- Remove `.opencode/opencode.jsonc`; keep the root `opencode.json`.
- Keep `.opencode/runs/`, `.opencode/memory/`, `.opencode/supervisor.db*`.
- `tools/opencode-supervisor` is the old source. It is no longer loaded; see
  `tools/opencode-supervisor/DEPRECATION.md`.

## Rollback

1. `opencode plugin remove opencode-conductor@1.0.1`.
2. Restore the backup directories into `~/.config/opencode/`.
3. Restore the project shim and `.opencode/opencode.jsonc` from git.
4. Restart OpenCode.
