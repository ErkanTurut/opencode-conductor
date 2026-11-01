# Iterating on the Conductor GUI

The panel is an OpenCode Desktop contribution with eight tabs: Runs, DAG, Gates, Refinements,
Memory, Routing & timeline, Agents, Project. It uses server RPC only; every call passes the
session directory.

## Loop

```sh
bunx tsc -p tsconfig.gui.json --noEmit
bun run gui:build
bun run smoke:gui
# Desktop Settings → Extensions → Plugins → conductor → Reload
bun test
bun run typecheck
bun run build
```

A GUI bundle reload updates the panel without requiring a service restart. Configuration writes
are fixed-target server RPC operations. OpenCode watches configuration; if reload/application
fails after save, report **saved, not applied** and verify before assuming effective values.
Server/RPC source changes may reload the plugin; do not disturb an active run without explicit
acceptance. Never mutate live ledger/run/memory state during diagnosis.

## Configuration editors

Agent edits target a project/global native Markdown file. Global edits require explicit
confirmation. Revision conflicts require reload/reconciliation, not overwriting the newer
version. Saves preserve non-edited native keys/body. OpenCode native JSON/JSONC may supersede
Markdown; inspect effective host values. Project settings target `.opencode/conductor.json` and
preserve other keys. The UI does not write trust/permission authority or perform work actions.

## Manual checks

- Verify all eight tabs, active/history filtering/pagination, compact DAG cards and details.
- Check loading/empty/error behavior and correct project scoping.
- Exercise project and global agent editing, global confirmation, revision conflict, and native
  precedence warning; verify saved content and host reload separately.
- Edit project settings and verify only intended settings changed.
- Confirm no GUI action approves work, launches runs, pushes, creates PRs, or merges.

Release checks and manual live Desktop verification are currently pending; do not report them
as passed until evidence is collected.
