---
name: Context Discovery
description: Systematic repository analysis producing compact evidence for planning
metadata:
  opencode/autoinvoke: true
---

# Context Discovery

## Purpose

Map the relevant parts of the repository before planning or implementation.

## Procedure

1. Read `AGENTS.md` for conventions and commands.
2. Read relevant project context from `.opencode/context/project/`.
3. Identify affected directories, files, tests, and configuration.
4. Check for existing patterns in similar code.
5. Note dependencies and their versions.
6. Flag any missing prerequisites or unresolved questions.

## Output

Write a discovery artifact to the run directory with:
- Affected file paths
- Existing patterns to follow
- Test locations and run commands
- Unresolved questions
