---
name: fixture-rls-repair
description: "Fixture and RLS repair protocol with migration-env fallback: diagnose and repair test/dev database fixtures, Row-Level Security policies, and seeding failures; when migration env vars are missing, fall back to documented SQL files or local substitutes instead of failing silently. Trigger on 'RLS policy broken', 'fixture fails', 'seed fails', 'migration env missing', 'rows come back empty', 'DATABASE_URL not set'"
metadata:
  opencode/autoinvoke: false
  audience: coder
---

# Fixture RLS Repair

## Purpose

Diagnose and repair test/dev database fixtures, RLS policies, and seeding failures. When migration environment is missing, descend a documented fallback ladder instead of failing silently.

## Procedure

1. **Reproduce the failure.** Run the exact failing test, seed, or query. Capture the error verbatim: SQLSTATE, message, stack, and the connection target (host/db name only, never credentials).
2. **Classify the failure:** `fixture` (row data, relationships, ordering), `policy` (RLS USING/WITH CHECK or grants), `seed` (prerequisites, extensions, idempotency), or `env` (missing variables/URLs). One classification per failure; split compound failures.
3. **Apply the env fallback ladder when env is missing:**
   1. Process environment variable.
   2. Local `.env` / `.env.local` via existing config (never print values).
   3. Committed raw SQL migration file (e.g. `supabase/migrations/*.sql`) applied manually.
   4. Documented skip: write the reason into the diagnosis record. Never stop at a silent skip.
4. **For empty-rows symptoms, inspect `pg_policy` USING quals first.** Query `polname`, `polcmd`, and `pg_get_expr(polqual, polrelid)` for the table. A NULL qual is deny-all — the top suspect. Also confirm grants and that `auth.uid()` maps to the expected user column.
5. **Repair the root cause:** fix fixture rows/ordering, correct the policy expression (e.g. `using (user_id = auth.uid()::text)`), add missing grants, or make the seed idempotent. Do not patch the symptom.
6. **Re-run the originally failing query under both clients:** user-scoped (RLS enforced) and service-role (bypass). Compare against intended visibility.
7. **Migration-env recipe:** when the direct database URL is unreachable (e.g. IPv6-only host resolution fails), use the pooler URL for migrations and record the workaround in the diagnosis record.
8. **Verify the repair end to end.** Re-run the original failing test/seed command and attach raw output.

## Output

Canonical diagnosis record — one row per failure; this table is the single source of truth:

| symptom | classification | root cause | repair | verification query result |
| ------- | -------------- | ---------- | ------ | ------------------------- |

The verification cell carries the re-run result for both clients (user-scoped and service-role) and the env-fallback step used. A JSON copy, if requested downstream, is a machine projection of these same columns — never a second record.

Persist every blocking failure via `supervisor_record_finding`; if the session lacks the tool, hand the record to the conductor for recording.

## Rules

- Never weaken or drop an RLS policy to make a test pass.
- Service-role bypass always pairs with explicit userId filtering.
- Env fallback is recorded; a silent skip is a failure.
- Every repair is verified by re-running the failing query.
- Never print secrets or connection strings; reference variable names only.
- Blocking failures are persisted (`supervisor_record_finding` or conductor handoff); an artifact alone is not a finding.
- Self-improvement: propose edits to `.opencode/runs/<run>/artifacts/skill-proposals/fixture-rls-repair-<timestamp>.md`.
