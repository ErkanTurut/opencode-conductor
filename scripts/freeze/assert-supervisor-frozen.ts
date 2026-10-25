#!/usr/bin/env bun
/**
 * Gate: the frozen supervisor tree must match its committed manifest.
 *
 * Thin by design. All hashing, manifest parsing, drift formatting, and exit
 * codes live in `manifest.ts`, so this entry point and a manual manifest run
 * can never disagree about what "frozen" means.
 *
 * Run from the repo root:
 *   bun tools/opencode-conductor/scripts/freeze/assert-supervisor-frozen.ts
 *
 * Prints `FREEZE_OK <treeHash>` and exits 0, or `FREEZE_DRIFT` plus a per-file
 * diff and exits 1. Exits 2 when the manifest or tree cannot be read.
 */
import { runCli } from './manifest'

process.exit(runCli(process.argv.slice(2)))
