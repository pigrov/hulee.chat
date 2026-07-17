# INB2-SRC-007: atomic canonical materialization

## Status

- Task: `INB2-SRC-007`
- State: `done`
- Owner: `Codex`
- Started: `2026-07-17`
- Finished: `2026-07-17`
- Depends on: `INB2-SRC-006`, `INB2-CON-006`, `INB2-CON-007`,
  `INB2-DB-008`, `INB2-DB-009`

## Boundary

This slice defines the transaction that turns one authorized source or operator
command into canonical Inbox V2 state. The transaction either commits all of
the following artifacts or none of them:

- canonical aggregate rows and immutable revisions;
- one tenant stream position, one `TenantStreamCommit` and its ordered changes;
- domain events;
- projection and provider-I/O outbox intents with work items;
- the command, mutation, authorization decision and audit closure;
- the final aggregate and tenant stream heads.

Provider/network I/O is never executed in this transaction. A provider call is
eligible only after its durable `provider_io` outbox work becomes visible.

This slice does not own worker replay/DLQ/backpressure (`INB2-SRC-008`),
provider attempt leasing (`INB2-SRC-009`), Message edit/delete/reaction/receipt
effects (`INB2-MSG-005` and `INB2-MSG-006`) or provider echo/uncertain-attempt
correlation (`INB2-MSG-007`).

## Transaction protocol

The SQL authorized-command coordinator owns one retryable transaction and the
only live runtime capabilities used by participating repositories:

1. claim the idempotency key before domain work; a committed replay returns the
   original command, mutation, commit, epoch and position without invoking a
   callback;
2. lock and validate authorization, employee, resource and collaboration
   revision fences;
3. issue independent, recursively frozen snapshots of the authenticated actor,
   authorization epoch and decision references, then run the prepare phase,
   which performs every canonical lookup, conflict check and domain-row lock
   required by the command;
4. verify callback-managed resource revisions;
5. bootstrap and lock `TenantStreamHead` last, then allocate exactly one next
   position;
6. recheck the database-clock authorization fence and enter the constrained
   seal phase; its public context contains no raw SQL executor;
7. consume an opaque, one-shot repository capability bound to the exact
   prepare/seal transaction token and materialize canonical rows at the
   allocated position; the internal writer additionally accepts only
   allowlisted append inserts and exact compare-and-swap updates, while reads,
   new lock clauses, destructive writes, advisory locks and DML against
   unprepared tables fail closed;
8. require and consume an opaque, one-shot seal receipt issued by the canonical
   repository for this exact atomic token; the receipt binds the exact Message,
   optional source resolution and optional canonical initial dispatch hashes,
   payload references and event times. A missing, forged, reused or
   cross-transaction receipt aborts before publication;
9. recheck the authorization-time fence after sealing;
10. persist the stream commit, ordered changes, events, outbox intents/work,
    command result, audit and mutation closure and advance the tenant stream
    head;
11. let deferred database constraints validate cardinality and provenance at
    commit.

Serialization/deadlock retries rerun prepare and seal from a clean transaction.
Any injected failure in either callback or in the closure rolls back the claimed
idempotency key, domain rows, stream position and outbox. A visible pending
command outside its transaction is treated as corruption, not as a replay.

## Source Message path

Message preparation locks the exact `ConversationHead`, checks the Message,
route, dispatch and revision identities, validates the author, and locks the
exact `SourceOccurrence`. Its fence is derived from the validated
`sourceResolutionCommit.before` snapshot, including resolution state, revision
and `updatedAt`; callers cannot provide a weaker or unrelated fence.

Before any Message-domain SQL, the repository also binds the origin to its
command and exact allowed Conversation decision: source-originated creation
requires `core:message.receive` / `core:message.receive_external`, external
send requires `core:message.send` / `core:message.send_external`, and internal
send requires `core:message.send` / `core:message.send_internal`. Employee or
trusted-service attribution must match the authenticated actor and epoch.
Migration origin fails closed until it has a dedicated authorized command
contract.

After the tenant position is allocated, the one-shot capability writes the
content, TimelineItem, Message, immutable initial Message revision, reference
context, transport provenance and the conversation-head CAS. Source-originated
composition additionally inserts the immutable `ExternalMessageReference`,
the occurrence resolution transition and the exact occurrence CAS in the same
transaction. Raw/normalized ingress evidence may pre-exist this transaction,
but no canonical source Message or resolved occurrence can become visible
without its stream/event/outbox closure.

## External send path

The prepare phase requires both the exact allowed Conversation decision and a
separately fenced `core:source_account.use` decision, then persists their
immutable route snapshots before the tenant stream-head lock. The seal phase
persists the operator-authored Message and a revision-1 `queued`
`OutboundDispatch` with zero attempts. The same commit publishes the Message
and dispatch changes, the domain event, projection outbox and exactly one
provider-I/O intent/work item. No `OutboundDispatchAttempt` exists and no
provider adapter is called yet; attempt creation and leasing belong to
`INB2-SRC-009`.

The caller-owned route seam accepts only a live coordinator capability and
checks the authorized tenant, `core:message.send` command, authenticated
principal/epoch and exact allowed Conversation decision before policy or
binding SQL can run. Preparation reads the exact current route-policy revision
without creating or advancing policy state. It must create one fresh immutable
route: `already_exists`, a changed policy/binding/source-account snapshot, a
descriptor-only substitution or a proof issued to another atomic token aborts
before Message sealing.

Migration `0046_inbox_v2_atomic_provider_io_closure.sql` adds an internal,
append-only dispatch-materialization ledger, an append-only source-resolution
ledger and row-driven inverse constraints, then extends the deferred
domain-mutation closure. The ledgers bind the canonical dispatch or resolved
`SourceOccurrence` to the exact mutation, stream commit, position and initial
revision. A newly inserted Message must resolve through the completed
authorized command and its exact Message change; source and outbound origins
must additionally close through their respective ledger and transition or
route/dispatch/provider-intent graph. Verification therefore starts from
either the stream manifest or any newly created canonical row. Every initial
dispatch has exactly one revision-1 change and one provider intent, while every
source Message has one resolved occurrence change, event and projection intent.
Orphan rows, forged revisions, shadow events, missing/duplicate changes or
intents and malformed initial state fail the transaction at commit.

Legacy standalone writer factories remain available only to repository-local
tests and migrations; they are absent from the public `@hulee/db` package
surface. The public one-phase authorization coordinator also rejects
`core:message.send`/`receive`, Message or dispatch changes and every
provider-I/O intent before opening a transaction, so product code cannot obtain
its raw callback executor for Message creation and must use the live authorized
atomic seam.

## Failure and replay matrix

| Failure point                        | Required result                                               |
| ------------------------------------ | ------------------------------------------------------------- |
| prepare lookup/fence/conflict        | no stream-head allocation and no canonical write              |
| seal after Message insert            | complete transaction rollback, including Message and dispatch |
| stream/change/event/outbox closure   | complete rollback, including the allocated position           |
| provider closure cardinality         | commit rejected; no command replay becomes visible            |
| serialization/deadlock               | bounded clean retry of prepare and seal                       |
| committed idempotency replay         | original position/status returned; neither callback runs      |
| changed request under the same scope | deterministic idempotency conflict                            |

## Implementation map

- Authorized two-phase coordinator, runtime capabilities, temporal fences and
  lock-last guard:
  `packages/db/src/repositories/sql-inbox-v2-authorization-repository.ts`.
- Private prepare-to-seal executor bridge:
  `packages/db/src/repositories/sql-inbox-v2-atomic-materialization-internal.ts`.
- Message prepare/seal capability and source-occurrence fence:
  `packages/db/src/repositories/sql-inbox-v2-timeline-message-repository.ts`.
- Immutable outbound route and initial dispatch persistence:
  `packages/db/src/repositories/sql-inbox-v2-outbound-transport-repository.ts`.
- Deferred provider-I/O closure:
  `packages/db/drizzle/0046_inbox_v2_atomic_provider_io_closure.sql` and
  `packages/db/src/schema/inbox-v2/authorization-relations.ts`.
- Focused unit and real PostgreSQL acceptance fixtures: the corresponding
  authorization, timeline-message and outbound-transport repository tests plus
  `inbox-v2-atomic-provider-io-closure-migration.test.ts`.

## Verification evidence

Completed on `2026-07-17` with the following evidence:

- focused Vitest gate: `10` files / `212` tests passed, including failure
  injection, idempotent replay, exact authorization/route fences and public
  export guards;
- independent runtime review: `6` files / `132` tests passed with no remaining
  P0, P1 or P2 findings;
- static migration parity and identifier checks: `5` / `5` passed; the
  RBAC-003 finalizer inventory regression added by the two ledger tables was
  closed and its focused suite passed `6` / `6`;
- fresh disposable PostgreSQL: all `47` migrations verified with contract
  `sha256:5ef422f4f82cb320ca992ac246374bb5fe7eff017acd5f51b5cf88c797009b14`,
  then `29` files / `273` tests passed;
- the first full PostgreSQL attempt exposed a pre-existing 7 ms backwards wall
  clock sample in the unchanged security-denial function; its isolated file
  passed `14` / `14`, the complete retry passed `29` / `273`, and no unrelated
  security-denial code or constraint was changed;
- the source-bundled N-1 artifact was regenerated against the exact `47`-
  migration digest; preserve, N-1 compatibility and RBAC dry-run passed `3`
  files / `17` tests;
- full non-PostgreSQL Vitest gate: `341` files / `3509` tests passed;
- the complete `pnpm check` passed: formatting, ESLint, TypeScript, `341` /
  `3509` unit tests, database schema checks, i18n, encoding, branding and native
  boundaries; `git diff --check` also passed.

The implementation was reviewed independently across both the runtime seam and
the deferred PostgreSQL closure. Neither review reported a remaining P0, P1 or
P2 finding.
