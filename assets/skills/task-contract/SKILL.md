---
name: Task Contract
description: Produce a structured task contract for implementation agents
metadata:
  opencode/autoinvoke: true
---

# Task Contract

## Purpose

Every implementation agent receives a structured contract before starting work.

## Required Fields

- `task_id`: unique identifier
- `run_id`: parent run identifier
- `role`: agent role (coder, test-engineer, etc.)
- `objective`: what to achieve
- `allowed_paths`: files the agent may edit
- `acceptance_criteria`: verifiable conditions for completion
- `verification_commands`: commands to run before declaring done
- `must_not`: explicit prohibitions

## Schema

See `schemas/task.schema.json` in the supervisor tools directory.
