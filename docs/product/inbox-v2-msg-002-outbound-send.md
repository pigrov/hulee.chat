# Inbox V2 MSG-002 Deterministic Outbound Send

Status: `done`

Task: `INB2-MSG-002`

Date: `2026-07-18`

> Clean-slate amendment (`2026-07-20`): ADR 0016 imports no V1 rows and requires
> no online/N-1 bridge. Historical migration verification below remains evidence
> for MSG-002 invariants; `INB2-CLEAN-002` stops old writers and `INB2-DB-011`
> installs the clean baseline.

## Scope

`INB2-MSG-002` establishes the application and persistence boundary for a
normal external send. Its trusted-preparer port accepts only tenant,
Conversation, typed content, route intent and `clientMutationId` as command
data. SourceAccount, binding/account generations, adapter route descriptor,
permission evidence, WorkItem authority and generated record IDs must be
loaded and closed by the request-scoped server implementation.

This task does not expose an HTTP route and does not provide the production
request-scoped preparer implementation. Wiring authenticated request context,
bounded read models and durable public rejection receipts into an API entry
point remains `INB2-API-003`; that composition must implement this port without
weakening any closure documented here.

The implementation provides:

- deterministic fail-stop resolution for automatic, explicit-binding and
  explicit-reroute intents;
- one immutable opaque `OutboundRoute`, one canonical Message, one queued
  `OutboundDispatch` and one provider-I/O outbox intent in the same authorised
  atomic materialisation;
- authenticated idempotency replay before current route discovery, so a
  committed mutation survives later binding drift;
- conjunctive Conversation read, external reply/WorkItem and exact
  SourceAccount-use authority;
- pre-provider fencing for binding/admin/runtime changes without implicit
  fan-out, route reconstruction or account hopping.

## Caller and preparer boundary

The application command is deliberately unable to name a SourceAccount, source
connection, opaque destination, authorization decision, binding fence or
provider request. Unknown fields are rejected. The request digest binds the
exact Conversation, content, route intent and `clientMutationId`.

The trusted request-scoped preparer exposes two structurally separate calls.
`lookupIdempotency` can return only replay, conflict or miss and is always
invoked first; `prepareNew` cannot return a replay and is invoked only for a
miss. A matching committed request returns its original Message reference
before loading current routing state; a different request hash returns
`idempotency_conflict`. Only a new command loads one bounded current
route-policy/candidate snapshot and the complete RBAC/relation evidence.

The raw `clientMutationId` is scoped by authenticated tenant, canonical
principal and effective command type. It is never reused as the tenant-wide
`OutboundRoute.idempotencyToken`. The trusted preparer derives that opaque
route token with the exported canonical SHA-256 helper over the complete
authenticated command scope. Consequently two employees, or a normal send and
an explicit reroute, may legally reuse the same raw client value without
colliding in route storage, while an exact scope still deduplicates. Selected
and rejected route closures both fail closed if a preparer supplies the raw or
otherwise mismatched token.

Zero candidates, ambiguous automatic candidates and invalid or unauthorised
explicit targets produce a deterministic route-less result at this boundary.
Persisting a durable terminal receipt for a rejected public request belongs to
the `INB2-API-003` composition. An explicit target never borrows the valid
automatic candidate. An allowed explicit reroute names one replacement binding
and persists that exact intent and reason in a new route; the previous route
remains immutable.

## Authorization closure

Normal external send consistently uses `core:message.reply_external`; the
obsolete `core:message.send_external` literal is not part of the Inbox V2
permission catalog. Migration `0050_inbox_v2_outbound_send_authority.sql`
installs one reviewed, fail-closed successor set without rewriting the
already-applied migrations `0031` and `0046`: canonical Message reply authority,
runtime-observation provenance in the route-action helper, domain Message
cardinality and the atomic Message/outbound command-to-route closure. Exact
predecessor/successor hashes make a missing or drifted historical function roll
back the complete five-function overlay.

Before any write, the API closure proves all of the following against the same
tenant, principal and authorization epoch:

1. `core:conversation.read` on the exact Conversation;
2. `core:message.reply_external` on that Conversation with an exact external
   route guard;
3. valid reply authority as active primary responsible, policy-allowed exact
   WorkItem collaborator, scoped supervisor override, or a proven current
   no-WorkItem/non-actionable state;
4. `core:source_account.use` on the exact SourceAccount selected by the route;
5. the same binding, ExternalThread, SourceAccount and binding generation in
   the route authorization proof, command intent and Message commit.

An explicit reroute is a distinct `core:source.dispatch.reroute` command, not a
variant hidden inside `core:message.send`. It additionally requires one exact
reroute decision, two distinct SourceAccount-use requirements for the original
and replacement bindings, both reroute capability manifests and an audit event
that binds the immutable original route, the exact untouched original queued
dispatch, its expected revision, the newly created route/message/dispatch and
the exact reason. The original route and provider outbox intent are read and
fenced in the same transaction. The original dispatch is atomically changed
from `queued@1` to `cancelled@2`; its Message, route and provider intent remain
immutable. The replacement is always a distinct Message, route, queued dispatch
and provider outbox intent. Migration
`0051_inbox_v2_outbound_reroute_intent_fence.sql` makes the original Dispatch ID
and revision mandatory parts of the canonical persisted reroute intent. The
guard contract keeps the two binding authorisations distinct. In the current
storage model `(tenant, ExternalThread, SourceAccount)` is unique, so a
persisted replacement binding for the same thread necessarily belongs to
another SourceAccount; changing that cardinality requires a separate
architecture and migration decision.

The caller cannot turn generic Conversation permission into provider-account
access or bypass WorkItem responsibility.

The never-WorkItem branch is backed by a durable Conversation Work head rather
than inferred from an empty slot. A new or additively backfilled empty
Conversation starts as `pending_intake`, which cannot authorize a reply. Only
an explicit `no_work_item` intake decision advances the conversation-wide
high-water. Migration `0052_inbox_v2_conversation_work_head.sql` installs this
head additively and uses a new Conversation bootstrap trigger without replacing
the historical slot bootstrap. Send and current WorkItem creation both use the
database order `Conversation -> Work head -> WorkItem slot`. A current writer
first records a transient `pending_materialization_ordinal`; the creation
decision trigger consumes it, and deferred coherence rejects any transaction
that tries to commit the marker without its WorkItem. An N-1 writer that does
not know the marker is advanced once by the same compatibility trigger.

The historical expand migration first performed an additive backfill, then acquired capture
locks in the legacy writer order `Conversation -> WorkItems -> creation
decisions`, installs the compatibility triggers and performs a final
reconciliation while those locks remain held. This closes the visibility gap
without a DDL/writer deadlock. The reviewed blocking bridge is explicit in the
database lifecycle evidence. Those production preserve mechanics are superseded;
old-writer shutdown and clean-baseline proof are owned by
`INB2-CLEAN-002`/`INB2-DB-011`.

The two send/create transactions therefore serialize deterministically: either
the exact no-work send commits first, or a new actionable decision makes the
prepared no-work authority stale before any Message/provider work is created.
Conversation-wide high-water is intentionally separate from the immutable
per-WorkItem intake decision revision, which remains `1` for every sequential
WorkItem. `INB2-WRK-001` owns the production intake policy and durable decision
history that advances this head; MSG-002 owns only the exact send-time fence.

## Atomic creation and idempotency

The authorised coordinator owns one database transaction. Inside it the send
path first fences the exact no-WorkItem or WorkItem reply authority, then fences
and persists the selected route, prepares the canonical Message creation and
seals the Message, TimelineItem, dispatch, tenant-stream/audit closure and
outbox intents. Provider code is never invoked in this transaction.

The command uniqueness scope is authenticated tenant + principal + command
type + raw `clientMutationId`; its full request hash distinguishes replay from
conflict. Route storage keeps its existing tenant-wide uniqueness over the
derived opaque scope token. Concurrent identical requests have one winner and
one committed replay; the final database contains one route, Message and
dispatch. A failed prepare/seal rolls all domain and outbox rows back.

Reroute and provider attempt opening serialize on the original Dispatch row.
If provider attempt opening wins, the reroute fails with
`original_dispatch_conflict` and creates no replacement records. If reroute
wins, a worker that loaded the old queued head receives `dispatch_cancelled`,
performs zero provider calls and deterministically finalizes the old outbox
work as processed. A disabled or drifted original binding does not strand the
untouched dispatch: only the replacement binding is a current execution fence.

## Pre-provider fencing

Every dispatch remains pinned to the stored route and opaque adapter
descriptor. Before provider I/O, the worker validates the claimed outbox lease,
the exact dispatch head, the complete canonical immutable route snapshot and
the current binding head.

Structural drift is terminal before I/O:

- binding/account/capability/descriptor generation change;
- remote membership no longer active;
- administrative disable.

The structural dispatch CAS and outbox dead-letter outcome share one database
transaction, closing the crash window between domain transition and work
finalization. A forged route snapshot with a real route ID cannot select a
different binding.

Runtime health is intentionally not structural creation eligibility. The
immutable snapshot still proves the exact state, revision and observation time,
but `ready`, `degraded`, `unknown` and `unavailable` can all commit the same
route/Message/queued-dispatch/outbox closure. At worker preflight, `unknown` or
`unavailable` keeps that route and dispatch unchanged, opens no attempt,
performs zero provider calls and schedules the same outbox work for a same-route
retry. The retry uses a stable result-derived delay in the bounded 5-60 second
window so a runtime outage does not create a one-second retry herd. It cannot
trigger route resolution or account fallback.

## Verification

The final task-scoped API/contract/worker/repository slice passed `16/16` files
and `373/373` tests. This includes `44/44` API tests for early replay,
scope-derived route tokens and selected/rejected raw-token fail-close. The
focused PostgreSQL Work-head suite passed `7/7`, including both real
send-vs-create lock orders observed through `pg_blocking_pids`, a forced
`40001` rollback/retry, a stranded-marker rollback, N-1 replay and sequential
WorkItem creation.

A clean database installed all `53` migrations with contract digest
`sha256:8ab43a884313994d40ef231e85cf8fff19a6f878711257ca72384e2328ffdbe6`.
The complete PostgreSQL gate passed `32/32` files and `322` tests (`6` opt-in
scenarios skipped). Preserve/N-1/RBAC passed `3/3` files and `17/17` tests. The
reproducible N-1 bundle targets the same migration contract, last migration
hash `0c0414b8f3126401b0beba92d7c1b28c2920ba0ca0d3e502f7899c14d377d16e`
and bundle hash
`sha256:ac2743b36ae701771ef319b6a67aaf06b27c524eb678f83e2ac987a31e67b841`.

The complete default suite passed `356` files and `3808` tests (`42` files /
`376` tests skipped). Full typecheck, `db:check`, task-scoped ESLint/Prettier,
N-1 reproducibility, i18n, encoding, branding and native checks passed.
Independent bridge and idempotency reviews returned `READY`; a final holistic
diff review found no remaining P0/P1/P2 blocker. Workspace-wide lint/Prettier
entry points additionally traverse untracked Chrome runtime profiles and
unrelated in-progress site files; those out-of-scope artifacts were preserved
and excluded from the task commit.
