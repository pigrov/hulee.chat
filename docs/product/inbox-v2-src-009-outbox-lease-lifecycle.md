# Inbox V2 SRC-009 Outbox Lease Lifecycle

Status: `done`  
Task: `INB2-SRC-009`  
Date: `2026-07-17`

## Scope

`INB2-SRC-009` completes the fenced outbox lease lifecycle started by
`INB2-DB-007` and consumed by the source materialization path from
`INB2-SRC-007`.

The implemented repository behavior covers:

- claim, renew, retry, reclaim and terminal finalize paths through the current
  lease token digest and lease revision fences;
- same-lease terminal replay after `processed`/`dead` is already written;
- rejection of stale, reclaimed, expired, revision-conflicted or mismatched
  terminal workers;
- immutable terminal outcome preservation with no raw lease-token persistence.

## Terminal replay rule

A repeated `finalize` after a worker has already written a terminal outcome now
returns `already_finalized` only when all of these facts match:

1. tenant and intent match the current outbox work row;
2. current work state is terminal: `processed` or `dead`;
3. retried terminal instruction matches the stored terminal result;
4. immutable `inbox_v2_outbox_outcomes` has a row for the same tenant, intent,
   terminal revision, terminal kind, worker and lease-token digest.

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
- The durable outcome remains the replay-safe record; terminal payload and
  provider-specific diagnostic payload can still be governed separately by the
  lifecycle/privacy tasks.

## Verification

Commands executed:

```text
pnpm test -- packages/db/src/repositories/sql-inbox-v2-repository-outbox.test.ts packages/contracts/src/inbox-v2/repository-foundation.test.ts
pnpm test
pnpm test:inbox-v2:postgres
pnpm lint
pnpm typecheck
pnpm db:check
```

Results:

- focused repository/contracts tests: `2/2` files, `30/30` tests;
- full default tests: `341/341` files, `3513/3513` tests;
- disposable PostgreSQL gate: applied `47` migrations, contract
  `sha256:5ef422f4f82cb320ca992ac246374bb5fe7eff017acd5f51b5cf88c797009b14`,
  `29/29` files and `273/273` tests passed;
- `pnpm lint`, `pnpm typecheck` and `pnpm db:check` passed.
