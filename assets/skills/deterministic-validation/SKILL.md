---
name: Deterministic Validation
description: Run the repository's required checks and emit structured evidence
metadata:
  opencode/autoinvoke: true
---

# Deterministic Validation

## Purpose

Run validation commands and capture structured evidence. Never trust an agent-reported command result without checking exit status.

## Procedure

1. Read the task's verification command list.
2. Execute each command in the task's worktree.
3. Capture stdout and stderr to files.
4. Record: command, exit code, duration, output hash.
5. Produce structured evidence.

## Rules

- The supervisor runs these checks, not the agent.
- A failed check creates a structured failure artifact.
- Do not claim success from a partial run.
- Output must be machine-readable.
