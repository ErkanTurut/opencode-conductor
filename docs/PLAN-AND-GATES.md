# Plan revisions and fail-closed gates

These modules provide pure decision helpers for eventual integration. They do **not** persist plans, acquire leases, transition ledger state, verify a candidate checkout, or execute a merge. A caller must enforce decisions at the authoritative write/claim/merge path and persist evidence atomically with its domain operation. Merely importing a helper does not enforce a gate.

## Plan revision API

`createPlanRevision({ tasks, parent, expectedParentRevision, reason })` validates a complete graph, duplicate/dangling ids and cycles, validates active write-scope overlap, then returns an immutable-by-convention snapshot and deterministic SHA-256 `revision`. Callers must compare `expectedParentRevision` against the authoritative current revision in a transaction/CAS, then persist the returned snapshot. Never rewrite an active task in place: produce a new revision with a reason and parent link. A stale parent is denied.

```ts
const result = createPlanRevision({ tasks, parent: current, expectedParentRevision: current?.revision ?? null, reason: '...' })
if (!result.allowed || !result.snapshot) throw new Error('plan revision denied')
// Persist via an authoritative CAS; this helper alone does not persist.
```

`decideTaskAdmission` requires the recorded task to be exactly `ready`, each dependency to exist and be completed, valid graph structure, and (when supplied) matching plan revision. Pass both current and expected revisions whenever plan versioning is active. `decideTaskCompletion` requires the current attempt id and fencing token, successful attempt/exit, and successful evidence for every exact required command. It is deliberately stricter than optional read-only verification skips: integration must pass the role-aware required-command policy, not infer success from an empty list.

`decideCandidateMerge` is a policy decision only. It requires a non-empty fully completed plan, valid required evidence, no blocking findings, candidate availability, and an explicit unexpired merge approval bound to candidate SHA, plan revision, and policy hash. Historical/unbound approvals are denied. The caller must independently establish that these inputs are authoritative and current. No merge executor or actual merge enforcement is implemented here.

## Repair, retry, and lease recovery

`decideRepair` applies bounded per-task retry and semantic-repair budgets. Retries cannot silently alter scope. A semantic repair that adds scope requires explicit approval bound to task id and a hash of the exact requested scope. It does not mutate an active task or create a revision. The caller must issue a new plan revision/CAS for approved semantic changes. `repairExecutionClass` labels retries `lease-retry` and semantic changes `semantic-repair`; watchdog stale-lease recovery is a liveness/fencing action, not evidence that semantic work should be retried or repaired.

## Integration hooks

1. Before `claimWorkItem`, construct structural task snapshots from authoritative ledger rows and call `decideTaskAdmission`; do not claim on denial. Bind plan revision from the persisted immutable snapshot.
2. Before completion/evidence transition, use the latest attempt and lease fencing token plus persisted required-check evidence in `decideTaskCompletion`. Preserve attempt provenance; reject stale evidence.
3. Before candidate approval/merge queueing, feed the authoritative plan, evidence, findings and bound approval to `decideCandidateMerge`. Candidate SHA must be freshly resolved by integration; unavailable or changed SHA denies.
4. At plan write, persist `createPlanRevision` via database CAS on parent revision. On semantic repair, never mutate task scope in place; require scope approval and create the next revision.

All decisions use `{ allowed, reasons: [{ code, message, taskId? }] }`; callers should retain reason codes for audit and surface messages without turning a denial into a retry loop. Structural input interfaces intentionally avoid coupling these pure helpers to GUI/RPC types.
