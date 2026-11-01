# Migration to v1.1.0

## Agent model settings

Native OpenCode agent Markdown and `opencode.json`/`opencode.jsonc` are authoritative. Fleet
catalog files, CLI, and legacy fleet UI no longer override runtime agent registration or runner
model selection. Move active model/variant choices into native agent Markdown (project
`.opencode/agents/<id>.md` or global `~/.config/opencode/agents/<id>.md`) and inspect
host-resolved settings. Existing JSON/JSONC may take precedence over Markdown.

The Agents tab can edit model/variant, steps, prompt body, and permission rules. Global edits
require confirmation. Keep a backup and review diffs. Saves are revision-checked; resolve a
conflict by reloading rather than overwriting concurrent edits. A saved edit is not applied until
OpenCode successfully reloads it.

## Project settings

`.opencode/conductor.json` can hold `branches`, `verificationCommands`, `preview`, and `memory`
operational settings. The Project tab manages these while preserving unrelated JSON keys.
Preview fields are configuration hints, not a provider connection or deployment proof. Trust
and permission policy remain separately governed by user authority; project settings cannot
loosen them.

## Memory closeout

Every closeout now records `none` or `curate` with rationale, including failed/cancelled runs;
explicitly disabled project memory is recorded as `disabled`. Curate requires a curator handoff
and evidence-linked proposal or `curator_no_learning` result. Proposals are immutable, versioned,
proposed project blocks requiring review, not automatic learning/promotion. No existing ledger,
run, or memory content needs to be deleted for this change.

## Publication

The documented install target is `github:ErkanTurut/opencode-conductor#v1.1.0`.
v1.1.0 tests, builds, and live server configuration checks passed; manual Desktop click-through
of the panel remains a separate check.
