# Workspace and orchestration acceptance checklist

The user authorized configuration writes, live inspection/reload, and publication to GitHub.
Run approvals, retries and destructive actions remain outside the GUI. Existing user edits must
be preserved. Phone access belongs to OpenCode, not this plugin.

## Implementation tasks

1. Preserve the existing workspace implementation and installation edits.
2. Implement fixed-target, revision-checked native Markdown agent saves, with global/project
   scope, model/variant, steps, prompt and native skill permission rules.
3. Implement project settings persistence and runtime consumption: branches, verification,
   preview deployment configuration and memory policy. Show provenance and save failures.
4. Remove fleet model overrides from registration and execution; native OpenCode configuration
   owns effective agents. Keep any legacy migration tooling explicitly separate.
5. Enforce an explicit learning decision before final closeout. Relevant learning hands off to
   memory-curator and persists bounded evidence-linked proposed blocks before closeout completes.
6. Discover existing preview configuration or propose setup. Finalization asks before merging
   worktrees into development and pushing, verifies that commit's preview, asks for user preview
   verification, and opens/reuses a PR to main. Never push main or merge the PR automatically.
7. Verify narrow/bottom GUI, loading/error/conflict/unsaved states, large DAG reachability,
   location scoping, security boundaries and regression tests.
8. Update docs/version/changelog, build the committed GUI bundle, verify live OpenCode, and push
   the reviewed release branch to GitHub without overwriting user edits or published tags.

## Evidence required

- Full test suite, baseline-gated server typecheck with no new diagnostics, GUI typecheck,
  GUI build/smoke, full build and whitespace checks.
- Independent correctness and security review with blocking findings resolved.
- Temporary fixture roundtrips for saves and memory, including stale revisions and unsafe paths.
- Live read RPCs scoped to a real project; real write checks use a dedicated temporary project,
  not existing run history or project memory.
- Published branch/commit and installation instructions; claims match observed verification.
