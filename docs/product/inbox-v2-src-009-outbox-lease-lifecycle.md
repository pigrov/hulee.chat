# Inbox V2 SRC-009 Outbox Lease Lifecycle

Status: `done`  
Task: `INB2-SRC-009`  
Date: `2026-07-17`

## Scope

`INB2-SRC-009` completes the fenced outbox lease lifecycle started by
`INB2-DB-007` and consumed by the source materialization path from
`INB2-SRC-007`.

The implementation covers the repository, transport and worker boundaries:

- claim, renew, retry, reclaim and terminal finalize paths through the current
  lease token digest and lease revision fences;
- one database transaction for the live outbox lease fence and every outbound
  attempt/reconciliation CAS;
- a provider-neutral worker coordinator that persists attempt-open before I/O
  and persists the exact provider outcome before outbox finalization;
- same-lease terminal replay after `processed`/`dead` is already written;
- rejection of stale, reclaimed, expired, revision-conflicted or mismatched
  workers before they may mutate dispatch state;
- immutable safe terminal outcomes, with terminal payload references in a
  separately purgeable retention-owned relation;
- additive N-1 compatibility during the expand window.

## Provider I/O fence

Runtime provider dispatch uses the restricted
`createSqlInboxV2FencedOutboundTransportRuntimeRepository()` surface. Its
`loadClaimedProviderIo`, `applyAttemptFenced` and `reconcileFenced` operations
lock the outbox work row and validate, from database time:

1. exact tenant, intent, handler and `provider_io` payload linkage;
2. current worker, lease-token digest and lease revision;
3. a non-expired outbox lease;
4. attempt timestamps bounded by the same outbox lease;
5. the exact dispatch/attempt/reconciliation compare-and-set state.

The raw lease token is validated in memory and converted to its digest before
SQL construction. It is never persisted or included in a query parameter.

The worker coordinator processes one durable transition per claim. It does not
invoke the provider on recovery, reconciliation, already-open replay or a
reclaimed pre-open turn. An adapter call is possible only after the open
attempt commit succeeds. Cancellation that wins before dispatch performs zero
adapter calls; timeout, abort, invalid response and adapter failure produce a
durable `outcome_unknown`. A rejected outbox finalize is returned as
`finalize_rejected`, never reported as successful completion.

Automatic retry after `outcome_unknown` requires the exact append-only
reconciliation decision, the same pinned retry-safety mechanism and the same
non-null provider correlation token. Unsafe retry still requires the explicit
Employee duplicate-risk authorization defined by the outbound contract.

## Terminal replay rule

A repeated `finalize` after a worker has already written a terminal outcome now
returns `already_finalized` only when all of these facts match:

1. tenant and intent match the current outbox work row;
2. current work state is terminal: `processed` or `dead`;
3. retried terminal instruction matches the immutable safe result fields;
4. immutable `inbox_v2_outbox_outcomes` has a row for the same tenant, intent,
   terminal revision, terminal kind, worker and lease-token digest.

While the terminal payload reference still exists, it must also match exactly.
After the retention owner purges that reference, replay authenticates the same
safe hash/kind/error/fence skeleton and returns `resultReference: null`; it does
not pretend that expired payload remains available.

If any of those facts does not match, the repository returns the existing
fenced failure shape (`not_leased`, `stale_token`, `lease_expired` or
`lease_revision_conflict`) and does not write another outcome.

This closes the gap intentionally left by `INB2-DB-007`: terminal work rows no
longer reject the exact same lease replay merely because the active lease fields
were cleared during finalization.

## Safety properties

- Raw lease tokens are never stored or queried; only
  `calculateInboxV2OutboxLeaseTokenHash()` output reaches SQL.
- A different worker or a different terminal instruction cannot replay another
  worker's terminal outcome.
- A terminal replay reads immutable outcome history and does not insert another
  outcome row.
- Existing non-terminal lease fences remain unchanged for stale owner, expired
  lease and lease-revision conflict cases.
- Provider acceptance received after attempt or outbox lease loss cannot be
  written by the stale worker. A reclaimed worker closes the abandoned attempt
  as `outcome_unknown` and reconciles before any possible retry.
- Durable completion always precedes `processed`, `dead` or retry scheduling.
- The safe outcome row keeps kind, hash, error, worker and lease-token digest;
  payload lives in `inbox_v2_outbox_terminal_payload_refs` and can be deleted
  without deleting that safe evidence.
- General runtime has only `SELECT`/`INSERT` access to the payload relation.
  Purge is a separate retention port and the retention owner alone can delete a
  payload or clear the temporary N-1 work-row shadow.

## Expand and N-1 behavior

Migration `0047_inbox_v2_outbox_terminal_payload_boundary.sql` is additive. It
backfills existing terminal references into the child relation and keeps the
legacy columns for rolling compatibility without using them as the V2 source
of truth.

An N-1 finalize that still writes `outcome.result_reference` is bridged into the
child row and clears the legacy outcome payload. Its legacy work-row reference
is retained only as a compatibility shadow, so the old same-lease replay keeps
working before purge. Deleting the child under the retention role atomically
clears that shadow. Current V2 replay then keeps the safe skeleton and returns a
null reference. Runtime-role direct purge is denied by PostgreSQL privileges.

## Verification

Commands executed:

```text
pnpm test -- apps/worker/src/inbox-v2-provider-dispatch-coordinator.test.ts packages/contracts/src/inbox-v2/outbound-dispatch.test.ts packages/contracts/src/inbox-v2/repository-foundation.test.ts packages/db/src/repositories/sql-inbox-v2-outbound-transport-repository.test.ts packages/db/src/repositories/sql-inbox-v2-repository-outbox.test.ts packages/db/src/schema/inbox-v2-repository-foundation-schema.test.ts packages/db/src/schema/inbox-v2-outbox-terminal-payload-migration.test.ts packages/db/src/index.test.ts
pnpm test:inbox-v2:postgres
HULEE_DB_INTEGRATION=1 pnpm test:inbox-v2:preserve
pnpm db:inbox-v2:n1-bundle
pnpm check
```

Results:

- focused coordinator/contracts/repository/schema tests: `8/8` files,
  `115/115` tests;
- disposable PostgreSQL gate: applied `48` migrations, contract
  `sha256:629a81489efdd655c3024068a1a4cbd0ceee16713c32481a584a5235ea258f25`,
  `29/29` files and `274/274` tests passed;
- live preserve/N-1/RBAC gate: `3/3` files, `17/17` tests;
- N-1 runtime bundle regenerated reproducibly against the same 48-migration
  target contract;
- the complete `pnpm check` passed, including `343/343` default test files and
  `3540/3540` tests plus format, lint, typecheck, DB, i18n, encoding, branding
  and native gates;
- an independent final review returned `READY` with no P0/P1 findings.
