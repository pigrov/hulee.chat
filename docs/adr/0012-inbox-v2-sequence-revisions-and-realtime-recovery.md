# ADR 0012: Inbox V2 Sequence, Revisions And Realtime Recovery

## Status

Accepted.

This ADR completes `INB2-ARCH-005`. It depends on ADR 0009 domain boundaries
and is consistent with ADR 0010 authorship and ADR 0011 source routing.

## Date

2026-07-10.

## Context

Inbox V2 must keep the sidebar, the selected timeline, background
conversations, unread totals and optimistic mutations convergent while events
arrive concurrently from 50+ source integrations and several employee devices.
Wall-clock time, provider order and eventual page refresh are not sufficient
correctness mechanisms.

The current Hulee Inbox V1 is a useful vertical slice, but it has no canonical
conversation sequence, entity revision, durable stream position or
snapshot/realtime cursor. Its list and timeline are independent queries without
one transaction/checkpoint, the timeline is ordered by `created_at`/ID and
limited to the oldest 200 rows, and a mutation ends with `router.refresh()`.
`event_store` has durable event envelopes but no commit-safe stream position or
aggregate revision. The outbox is claimed with `SKIP LOCKED`, has no expiring
lease and is transport work state rather than an immutable client replay log.
Some client-visible delivery/file transitions do not currently append a domain
event. The configured SSE flag and application boundary do not yet provide a
streaming HTTP route.

The current web-to-internal API authentication also uses server-created HMAC
headers that a browser `EventSource` cannot and must not reproduce. A long-lived
internal secret cannot be put in browser code or an SSE query string.

RIK supplies valuable regression evidence but not an architecture to port. Its
timestamp/event-ID projector checkpoint, mutable realtime payload at an already
published cursor, snapshot plus future-only refresh, missing standard SSE
resume and duplicated active-chat/sidebar stores allow lost, replayed or stale
state. Several production fixes had to fan one message change manually into the
active timeline and list preview. Inbox V2 needs a formal order, immutable
replay contract and one normalized reducer before UI implementation.

The protocol must close all of these races:

- a commit between snapshot read and stream connection;
- two transactions obtaining IDs in one order but committing in another;
- a stale HTTP response arriving after a newer SSE delta;
- POST response, SSE commit and provider echo arriving in any order;
- a projector/worker crash after partial work;
- missed PostgreSQL notification, proxy disconnect or slow consumer;
- permission change, cursor retention expiry, restore or projection rebuild;
- edits, deletes and delivery changes to the message referenced by both the
  timeline and sidebar head.

## Decision

Inbox V2 uses independent ordering/version mechanisms, a commit-safe tenant
stream recorded with canonical state, immutable recipient-safe sync batches and
one revision-aware client reducer. PostgreSQL remains the initial source of
truth. Outbox and `LISTEN/NOTIFY` have narrower responsibilities.

### Order and version concepts are not interchangeable

| Concept                | Scope                       | Purpose                                                       |
| ---------------------- | --------------------------- | ------------------------------------------------------------- |
| `timelineSequence`     | one Conversation            | Stable order/keyset of committed TimelineItems                |
| `entityRevision`       | one mutable entity          | Stale-write and stale-read conflict resolution                |
| `tenantStreamPosition` | one tenant commit stream    | Total order of committed Inbox V2 change sets                 |
| `projectionCheckpoint` | one projection/generation   | Highest contiguous stream position applied transactionally    |
| opaque client `cursor` | actor/sync scope + protocol | Resume token over stream position, epoch and security context |

`Conversation.revision` is the entity revision of Conversation fields. A
`ConversationHead`, Message, WorkItem, participant, Client link and
`EmployeeConversationState` each have their own revision. Conversation
revision is not increased merely to imitate every child revision.

The following values remain separate facts and are never ordering substitutes:

- `clientMutationId` and provider idempotency keys identify operations;
- domain event IDs identify immutable events;
- provider `occurredAt`, server `receivedAt` and commit time support display,
  diagnostics and reporting;
- SourceAccount receive/history cursors belong to their adapter ingestion
  stream;
- provider delivery/read receipts do not advance employee read state.

Database counters are `bigint`. Contracts encode them as decimal strings or
inside an opaque cursor, never as a JavaScript `number`.

### Timeline sequence is stable and server assigned

Every TimelineItem has an immutable positive `timelineSequence`, unique by
`(tenantId, conversationId, timelineSequence)`. Only the server allocates it.
Creation of `N` items locks the Conversation row and allocates one contiguous
range in the same transaction. Rollback consumes no visible range.

Sequence rules are:

- committed items have a strict per-Conversation order;
- concurrent inbound, outbound, note, call and system items cannot collide;
- edit, delete, reaction, delivery, receipt and attachment transitions keep the
  original item sequence and increase the affected entity revision;
- a tombstone never frees or reuses a sequence;
- provider time never reorders an already committed timeline;
- timeline pagination uses sequence keysets (`before`, `after` and
  `aroundItemId`), and the default page returns the latest items;
- list/head ordering is a projection policy over committed changes, not a
  `createdAt`/random-ID comparison.

Provider history ingestion has an explicit binding state machine:

```text
backfilling -> catching_up -> live
```

Where the provider permits it, initial history completes before the binding
becomes live. The adapter supplies one deterministic oldest-to-newest order, and
Hulee allocates sequences in bounded commits in that order. Live input arriving
during backfill is durably recorded first, then reconciled through the same
exact-reference dedupe. An adapter watermark separates the imported prefix from
the buffered live tail, and transition to `live` records that watermark
atomically.

After the live watermark, a newly discovered old item is append-only: it gets a
new sequence plus explicit history/import provenance and
`activityEligible=false`. Conversation therefore stores timeline tail
(`latestTimelineSequence`) separately from activity head
(`latestActivityItemId`/`latestActivityAt`). Late history does not renumber
existing items and cannot create unread, notification, SLA or normal
activity-head side effects. If chronological insertion of late history becomes
a product need, it requires a separate archive/timeline-order ADR; provider
timestamps will not be silently promoted to canonical order.

### Entity revisions reject stale state

Every mutable client-visible V2 entity has:

```text
revision bigint
lastChangedStreamPosition bigint
```

New entities start at revision `1`. A committed logical mutation increases the
revision once. Several intermediate writes to the same entity within one
transaction collapse into one final revision. An idempotent no-op creates no
revision and no tenant stream position. Delete is a revisioned tombstone; stale
data cannot resurrect it.

Commands that depend on current state carry `expectedRevision`. The server
either commits against that exact revision or returns `revision.conflict` with
the authorized current revision/result. Read-modify-write without compare-and-
set is not allowed for responsibility, routing, message lifecycle or other
conflicting mutations.

The client reducer applies these rules:

- incoming revision lower than confirmed local revision is stale and ignored;
- equal revision with the same canonical content/tombstone is a duplicate;
- equal revision with different canonical content is
  `sync.revision_conflict` and triggers targeted or full resync;
- a higher revision replaces the confirmed entity atomically;
- the stream cursor advances only after the complete batch validates and the
  reducer commits successfully.

An entity revision is monotonic but not a universal delivery sequence. A jump
can be valid after a partial snapshot, cache eviction or recipient filtering.
Global/scope gap detection therefore uses stream cursor continuity, not a
generic `incomingRevision === currentRevision + 1` rule.

### Tenant stream position follows commit order

Inbox V2 adds a logical persistence model equivalent to:

```text
TenantStreamHead
  tenantId primary key
  streamEpoch
  lastPosition
  minRetainedPosition

TenantStreamCommit
  tenantId + position primary key
  commitId unique within tenant
  schemaVersion
  correlationId
  command/clientMutation references when applicable
  committedAt

TenantStreamChange
  tenantId + position + ordinal primary key
  entity type/id/revision or domain event reference
  deterministic immutable change manifest/payload
```

Every Inbox V2 write transaction is single-tenant. A transaction with one or
more client-visible V2 mutations creates exactly one `TenantStreamCommit`; only
a true idempotent no-op creates none. All related domain events and entity
changes have different ordinals under that position. One message creation can
therefore atomically describe the TimelineItem, Message, ConversationHead and
relevant WorkItem/read/list changes. A consumer never observes half of that
logical change set. Cross-tenant bulk work is split into independent tenant
transactions/commits.

A PostgreSQL sequence, `bigserial`, timestamp, ULID or random event ID does not
prove commit order. For example, transaction A can allocate `10`, transaction B
can allocate and commit `11`, a consumer can advance to `11`, and A can later
commit `10`. Position `10` would be skipped forever.

The initial implementation instead updates `TenantStreamHead` under a tenant
row lock inside the same short transaction. Every writer locks domain rows in
one canonical type/ID order, resolves all potentially blocking domain conflicts
and acquires the tenant stream-head lock last. After that lock, code may update
already locked rows and append final change/event/outbox/result records, but may
not acquire a new potentially blocking domain lock or perform provider/network
I/O. All locks are held until commit/rollback. Another writer cannot allocate
the next visible position until the previous transaction commits or rolls back.
Rollback leaves neither the position nor a gap.

Different tenants remain independent. The tenant-head lock is an explicit
correctness boundary, not an assumption that contention is free. Capacity tests
must measure its wait time and throughput for a hot tenant, one hot
Conversation, 50+ source bursts and reconnect storms. If it becomes the proven
bottleneck, an ordered log/sequencer can replace this allocator behind the same
contract. Introducing vector cursors or stream partitions requires another ADR.

### Canonical mutation, events, sync manifest and outbox are atomic

The logical command boundary is:

```text
authenticate and authorize
  -> validate schema and tenant
  -> atomically claim/lock command idempotency key and validate request hash
  -> lock domain entities in deterministic order
  -> validate expected revisions and allocate timeline ranges
  -> stage canonical final state
  -> allocate one commit-safe tenant stream position
  -> persist canonical state and revisions
  -> persist immutable stream change set and domain events
  -> persist outbox intents and idempotent command result
  -> COMMIT
```

Every step after position allocation is database-only and part of the same
transaction. Any failure rolls back all steps. Provider calls occur only after
commit through the immutable route/dispatch model in ADR 0011. A provider result
or echo is a later canonical transaction and later entity revision/stream
position.

The following invariants are mandatory:

- no canonical client-visible mutation without a durable stream change/event;
- no event or sync change describing canonical state that did not commit;
- no external Message/route/dispatch without its durable outbox intent;
- delivery, receipt, reaction, file and dispatch lifecycle changes are events,
  not silent row updates;
- all stream/event/change records are append-only after publication;
- a repeated immutable ID with a different payload/hash is a conflict, never an
  update to an already consumed cursor;
- duplicate commands return their original canonical result and position.

Command idempotency is scoped at least by tenant, authenticated principal,
command type and stable `clientMutationId`, and stores the request hash,
commit/position and canonical result. Same ID plus same hash returns the same
result. Same ID plus different request is `command.idempotency_conflict`. A
client retries an uncertain HTTP result with the same ID; it does not create a
new ID for an outcome that may already have committed.

The idempotency claim is acquired before domain and tenant-head locks. A
concurrent same-hash caller waits for and returns the original canonical result;
a different hash fails before domain mutation. All potentially blocking unique,
fence and command claims are resolved before `TenantStreamHead`, so two
simultaneous requests cannot allocate two sequences/commits/outbox intents for
one mutation ID.

### Outbox is delivery work state, not the realtime cursor

Outbox transports provider calls, notifications and other asynchronous work.
It does not define canonical stream order and is never the only SSE replay
source. `SKIP LOCKED` claim order, retry order and completion order may differ
from tenant commit order.

V2 outbox processing uses expiring fenced leases and durable outcomes:

```text
pending -> leased -> processed
                  -> pending  (retryable failure or expired lease)
                  -> dead     (terminal/exhausted, with diagnostics)
```

A row includes lease token/owner/expiry, attempts/availability and an immutable
intent/consumer dedupe key. The handler persists its outcome before the worker
marks the row processed. A crash cannot strand `processing` forever. Consumers
that require strict entity order consume the tenant stream/checkpoint rather
than relying on arbitrary outbox claims.

Claim, renew, retry, dead-letter and finalize operations compare-and-set the
current lease token. After reclaim, a stale worker cannot persist outcome or
mark the row processed. Lease expiry during a provider request is an uncertain
side effect, not permission for a second provider call: reclaim reconciles the
original attempt, and repeats I/O only when the adapter/route proves the same
operation retry-safe/idempotent under ADR 0011.

### Projectors apply a contiguous immutable stream

Every ordered projection has a tenant/scope, schema version, generation and
durable checkpoint. Applying position `N + 1`, all projection row changes and
advancing the checkpoint to `N + 1` occur in one transaction.

- position at or below checkpoint is an idempotent duplicate;
- position above `checkpoint + 1` is `projection.gap_detected` and halts that
  mandatory partition;
- an irrelevant/filtered position still advances the contiguous checkpoint;
- a crash before commit changes nothing; a crash after commit is replay-safe;
- mandatory Inbox projections never skip poison input silently;
- rebuild happens in a shadow generation, catches up and cuts over atomically;
- an incompatible generation change forces an authoritative client resync.

Projector work is proportional to the explicitly affected entities, audience
references or recipients, never total Conversation history. Recipient fanout
uses an indexed audience/recipient path and bounded batches; it cannot rescan
the tenant stream independently for every connected client. A recipient-safe
sync projection/index may materialize sanitized immutable deltas keyed to the
original tenant position. It remains a rebuildable acceleration layer: it
cannot invent a second order, mutate a published position or expose beyond its
contiguous checkpoint.

The critical Inbox snapshot and sync path uses one mandatory projection
barrier. For position `N`, ConversationHead, its referenced Message/TimelineItem
revision (or an ordered invalidation), list membership/totals, recipient sync
entries and checkpoint `N` commit in one projection transaction. The checkpoint
cannot commit with a dangling head dependency, and a recipient stream may never
advance `scannedThrough` beyond its durable contiguous sync-projection
checkpoint.

### The client contract is an atomic sync batch

SSE and polling expose the same versioned recipient-filtered contract, not raw
domain/provider events. A logical envelope is:

```text
InboxSyncBatch
  schemaVersion
  streamEpoch
  syncGeneration
  scopeId
  authorizationEpoch // opaque ADR 0013 composite security revision
  fromExclusive
  scannedThrough
  hasMore
  commits[]

RecipientCommit
  commitId
  streamPosition
  clientMutationIds[]
  changes[]

EntityChange
  operation: upsert | tombstone | invalidate
  entityType + entityId + revision
  conversationId/timelineSequence when applicable
  normalized recipient-safe value or invalidation scope
```

All commits and changes are ordered. One `RecipientCommit` is never split across
frames and is applied atomically. A frame is applied atomically as a batch
before `lastAppliedCursor` changes. Contracts set maximum changes/bytes per
canonical commit and frame. Oversized history/roster work is split into several
domain commits or represented by a compact revisioned invalidation. Full
normalized upserts/tombstones are preferred to fragile unordered JSON patches.
Large values may use a revisioned invalidation followed by a targeted fetch, but
the invalidation itself is ordered and durable.

The recipient may not see every tenant commit. The server can scan positions
`101..110`, include only visible commits `104` and `109`, and return
`fromExclusive=100`, `scannedThrough=110`. An empty checkpoint batch is valid.
This proves the hidden range was scanned and prevents every reconnect from
rescanning other employees' or staff-only events.

The primary Inbox sync scope is the complete Employee-authorized Inbox within
one tenant/ADR 0013 authorization epoch. It is independent of current folder, list filter,
page, selected Conversation and bounded timeline cache. A narrower specialized
subscription owns a separate cursor/store and cannot advance the Employee-wide
`lastAppliedCursor`. Reconnect catch-up uses tenant/scope indexes and bounded
batches rather than one full scan per connection.

The opaque cursor represents at least protocol version, stream epoch, tenant
position, sync generation, actor/sync scope, an opaque authorization epoch over
shared RBAC/Employee/resource-relation/temporal-window dependencies and its
server-enforced `notAfter`. Tenant and
actor still come from authenticated server context; a cursor is not an
authorization token. A cursor copied across tenant, employee or scope is
invalid and never reveals whether the referenced tenant/resource exists.

### Snapshot and stream use one lossless handshake

A canonical snapshot is read in one `REPEATABLE READ, READ ONLY` transaction.
Because canonical state and stream head commit atomically, its `resumeAfter`
cannot be newer than included state.

A projection snapshot returns the projection's durable checkpoint read in the
same database snapshot as its rows. It must not return the current tenant head
when that projection is behind. If bootstrap combines independently
checkpointed components, then:

```text
resumeAfter = minimum(included component checkpoints)
```

Each component also reports its own checkpoint/generation. Replaying from the
minimum can repeat newer included entities, which revision checks safely
deduplicate. A head that references a Message must include that Message/revision
or an explicit revisioned dependency/invalidation; snapshots cannot contain
dangling projection state.

The connection algorithm is:

1. Authenticate and return an authoritative normalized snapshot plus
   `resumeAfter`, scope manifests and entity revisions.
2. Apply the snapshot through the same reducer used by deltas.
3. Open the stream with `after=resumeAfter`.
4. Validate the cursor, establish the database wake-up listener and read a
   durable catch-up head/checkpoint.
5. Replay every retained scanned range after the cursor in bounded batches.
6. Continue querying durable positions after every wake-up and periodically,
   then enter/remain in live mode.

A commit between steps 1 and 3 is in the replay range. A commit between listener
setup and head read is also in the durable query. A lost notification is healed
by periodic catch-up. Subscribe-first is not used to compensate for a weak
snapshot.

On automatic SSE reconnect, a valid `Last-Event-ID` has precedence. Query
`after` is used only when that header is absent; the server never silently takes
the maximum of disagreeing cursors. A standard frame is:

```text
id: <opaque cursor for scannedThrough>
event: inbox.delta
data: <InboxSyncBatch JSON>
```

Delivery is at least once; revision/idempotency rules produce one convergent
state. The server cannot claim network exactly once.

`LISTEN/NOTIFY` carries only a small internal wake-up/watermark, never customer
message content and never the only copy of an event. Transport keepalive
comments do not advance a cursor. A periodic `inbox.heartbeat` event without an
SSE `id` may report server head, recipient-available checkpoint and lag so the
client can detect a connected but stalled projection. The UI watchdog observes
heartbeat/progress, not only TCP `open` state.

After cursor validation and listener installation, the server emits one
`inbox.ready` event without an SSE `id`; it identifies protocol/scope and the
recipient-available checkpoint but never advances the applied cursor. This
provides an application/proxy liveness boundary before a quiet stream waits for
its first visible delta.

### Streaming authentication is a client boundary

For web MVP, ingress exposes one versioned same-origin client path and routes it
through a non-buffering streaming reverse proxy directly to `apps/api`, not
through a long-lived Next.js response. The host-only HttpOnly application
session cookie (`hulee_session` in development and its secure `__Host-` variant
in production) is forwarded to `apps/api`. A shared session/auth repository
validates it there and derives tenant, Employee, RBAC sync scope and
`authorizationEpoch` only from trusted server state. This client endpoint ignores
spoofed internal tenant/employee/permission headers and never exposes the
internal HMAC secret to browser code or a query string.

An open connection expires no later than its session. Before each emitted delta
or heartbeat, and on an auth/access-change wake-up, `apps/api` revalidates
session, Employee state, authorization epoch and current resource relations
through the shared auth boundary.
Expiry, logout, deactivation or revocation stops before the next customer-data
payload and follows the invalidate/resync rules below. A 14-day cookie is not a
14-day authorization snapshot.

Mobile/desktop use their authorized client transport and may set the normal
client bearer/session credentials. A fetch-stream implementation may consume
the same SSE frames when native/browser constraints require headers. Any future
cross-origin stream ticket is a separate short-lived, audience/scope-bound,
revocable credential contract; it is not the cursor and cannot be a long-lived
URL secret.

`apps/api` owns the MVP endpoint. The durable protocol/port stays independent so
fanout can move to `apps/realtime` after measurement without changing domain or
client envelopes.

Every same-origin/ingress proxy hop is part of the streaming contract. It must
forward SSE chunks without response buffering or semantic transformation,
preserve streaming-safe content/cache headers, avoid forwarding hop-by-hop
headers incorrectly and flush the first `inbox.ready`/delta before upstream
closure. Client cancellation propagates immediately to the upstream abort
signal, database listener/query and connection release. Proxy and upstream use
bounded backpressure; neither buffers an unbounded slow-client stream.

### Cursor validation and recovery are explicit

The server validates cursor syntax/version, authenticated actor/scope, access
revision, stream epoch, sync generation, current head and retained prefix.
Stable outcomes include:

| Code                      | Meaning/action                                                    |
| ------------------------- | ----------------------------------------------------------------- |
| `sync.cursor_invalid`     | Malformed, wrong actor/tenant/scope or unsupported token          |
| `sync.cursor_future`      | Position is beyond the authoritative head                         |
| `sync.cursor_expired`     | Required prefix is older than retained replay                     |
| `sync.epoch_changed`      | Restore/reset invalidated prior positions                         |
| `sync.scope_changed`      | Authorization epoch/not-after or synchronization scope changed    |
| `sync.schema_unsupported` | Client/server envelope versions cannot interoperate               |
| `sync.gap_detected`       | Retained stream/projection has an impossible internal hole        |
| `sync.resync_required`    | Bounded replay is unsafe/too large; authoritative snapshot needed |

After authentication, an EventSource-incompatible HTTP error is represented by
an `inbox.resync_required` event when safe and the connection closes. That event
never carries an SSE `id`. Its handler immediately closes the old EventSource;
recovery creates a new instance from the application-owned last successfully
applied cursor or a fresh snapshot, never automatic reconnect of the failed
instance. Auth or session failure closes/refuses the stream without leaking
data.

Recovery fetches a full or targeted authoritative snapshot with a declared
scope/generation/manifest. The reducer merges newer revisions and prunes only
the scope the snapshot declares authoritative. Absence from one paginated list
page is never proof that a Conversation/entity was deleted. Revoked access
either produces an atomic final invalidate plus a cursor in the new access scope
or sends `resync_required` and stops before advancing further. Continuing with
an old authorization-epoch cursor is forbidden.

Retention deletes only a contiguous position prefix and never passes mandatory
durable projector checkpoints. A prune boundary is derived from stream
positions, required consumer checkpoints and retention policy, never provider
or server `occurredAt`. Physical replay rows and the corresponding
`minRetainedPosition` for each tenant stream or recipient sync generation are
deleted/advanced in one transaction. The server cannot advertise a cursor range
whose rows were already removed, or remove rows while advertising the older
minimum. Browser/mobile clients cannot hold retention forever; expired clients
resync. Tombstones and authoritative snapshot semantics must outlive the
incremental replay window as required by the policy from `INB2-ARCH-007`.

A restore that can reuse tenant positions rotates `streamEpoch`. Projection
rebuild uses a shadow generation and atomic cutover. A byte/contract-compatible
rebuild can retain the sync generation; an incompatible materialization or
contract cutover changes it and forces resync. Restore/cutover runbooks must not
silently let an old cursor enter a different history.

### One normalized reducer owns every client arrival path

`packages/app-shell` owns a normalized confirmed graph:

```text
entities by ID
  conversations, heads, participants, workItems, timelineItems, messages
  employeeConversationStates, clientLinks and revisioned tombstones

indexes
  inbox ordered IDs by query key
  timeline item IDs by Conversation
  participant IDs by Conversation

pending overlays by clientMutationId
stream epoch/generation/lastAppliedCursor/connection state
```

Sidebar and selected timeline never keep independent Message copies. The head
references the same normalized Message/revision rendered in the timeline.
Ordered collections contain IDs plus their own as-of/revision metadata. A
single reducer applies snapshot, mutation response, SSE, polling and optimistic
reconciliation.

An active V2 upsert carries an opaque `hmac-sha256` state fingerprint for
equal-revision comparison. The producer computes and verifies it with a
tenant- and purpose-bound lifecycle key; the client only compares the opaque
fingerprint. Raw projection values are never a public/keyless SHA preimage, and
the key, dependency vector and verification proof never enter client wire
contracts. One fingerprint is immutable for one entity revision. Rebuilding a
projection reuses the persisted fingerprint and its historical key generation;
rekeying unchanged state requires a new entity revision or an atomic
`syncGeneration` cutover plus authoritative client reset. A page-chain SHA may
commit this opaque fingerprint, never the raw low-entropy value.

HTTP mutation results contain the same commit ID, stream position,
`clientMutationId` and canonical entity revisions as their later stream commit.
They may reconcile a pending overlay immediately, but they do not advance the
global cursor across unknown intervening positions. When the stream later
reaches that commit, entity changes deduplicate and the batch still advances
the cursor.

POST-before-SSE, SSE-before-POST, response loss and provider-echo-before-HTTP
therefore converge. A provider echo is a later revision of the same canonical
Message only when exact ADR 0011 correlation proves it; weak body/time matching
does not merge messages.

Confirmed server state and optimistic overlays are separate. A temporary item
uses `local:<clientMutationId>` until a canonical ID/sequence arrives. A timeout
becomes uncertain and retries/status lookup use the same mutation ID. Failed or
conflicting optimistic edit/delete/reaction removes or rebases only its overlay
and cannot roll back a newer confirmed revision.

An HTTP snapshot/list/timeline response also passes through revision checks.
Request generation and cancellation prevent a late response for Conversation A
from populating selection B. The router/deep link is the selection source;
selected Conversation loading is independent of the current list page/filter.
Background Conversation entities can update even when their timeline is not in
the bounded cache.

Browser `EventSource` may remember an SSE `id` before application code has
persisted state. The event handler must validate and synchronously commit the
reducer batch before considering that cursor applied. On parse/reducer failure,
the client closes the stream and creates a new connection from its own last
successfully applied cursor (or resyncs); it does not trust the transport's last
received ID. Persistent offline caches store entity state and applied cursor in
one local transaction or discard both and take a fresh snapshot.

### Employee read state is monotonic and device-safe

`EmployeeConversationState` owns a per-Employee `lastReadSequence`, separate
manual-unread marker, revision and last stream position.

`markReadThrough(sequence)` validates that the sequence belongs to the
Conversation and stores `greatest(current, requested)`. A lower stale device
cursor is an idempotent no-op and cannot increase unread. Advancing read state
creates one tenant commit delivered to that Employee's devices and updates
server-authoritative unread projections. Manual unread is a separate marker; it
does not lower the durable read sequence. Provider read/delivery receipts remain
transport facts and cannot mutate employee state.

Read, delivery and receipt commands are deduplicated/coalesced before stream
allocation. A client keeps at most one pending highest read command per
Conversation; repeated provider states are no-ops. Safe batches may share one
tenant commit, while transitions required for audit/reporting remain explicit.
This prevents scroll/receipt noise from monopolizing the tenant stream-head
lock.

Typing/presence are ephemeral and do not occupy the durable tenant commit stream
unless a future requirement explicitly makes them auditable state.

## Required State Machines

### Ordered projector

```text
caught_up(N) -> applying(N+1) -> caught_up(N+1)
                         |-> rollback/retry

gap/schema conflict -> halted -> repair/rebuild -> caught_up
```

### Client synchronization

```text
idle -> hydrating -> catching_up -> live
                         ^           |
                         |           v
                   reconnecting <- disconnected/stalled

catching_up/reconnecting -> resync_required -> hydrating
```

Slow consumers use bounded server/client buffers. Overflow closes the
connection; recovery starts from the last applied cursor or authoritative
snapshot. It never drops an arbitrary middle frame and continues.

## Required Verification Matrix

### Transaction, sequence and revision

1. Concurrent writes in one Conversation produce unique ordered sequences.
2. Reversed/equal provider timestamps do not change canonical order.
3. Rollback/retry consumes neither a visible timeline range nor tenant position.
4. The uncommitted-A/committed-B sequence-allocation trap cannot skip A.
5. One multi-entity transaction creates one atomic ordered recipient commit.
6. Failure between canonical rows, events, sync changes and outbox leaves no
   partial state in either direction.
7. Edit/delete/delivery keeps sequence, advances affected revisions and updates
   the shared head in the same sync commit.
8. Revision 3 then revision 2 cannot roll back; equal revision/different payload
   causes a diagnostic resync; a stale upsert cannot beat a tombstone.
9. Two concurrent same-ID/same-hash commands create one sequence, tenant commit,
   outbox/provider intent and canonical result; a different hash returns the
   stable idempotency conflict before mutation.

### Snapshot, cursor and transport

10. Events immediately before, during and after snapshot/connect are neither
    lost nor able to roll state back.
11. The catch-up-to-live handoff survives a commit at every boundary.
12. Reconnect resumes through `Last-Event-ID`; an explicit reconnect starts from
    the client's last applied cursor.
13. Duplicate frames, lost `NOTIFY`, proxy disconnect and page reload converge.
14. The real same-origin/ingress path validates only the shared session, rejects
    spoofed actor headers, revalidates expiry/revocation, flushes the first
    ready/delta before upstream close, avoids buffering/transformation and unsafe
    hop-by-hop headers, propagates cancellation and bounds backpressure.
15. Hidden RBAC positions advance `scannedThrough` without payload leakage.
16. Invalid, future, expired, wrong-epoch, wrong-scope and retained-hole cursors
    produce their distinct outcomes.
17. Retention with old timestamps at high positions and fresh timestamps below
    prunes only by contiguous position; crash before/after prune/minimum update
    never exposes a physically missing advertised range.
18. Slow-consumer overflow and a connected-but-stalled projector are detected
    and recover without loss.
19. Polling and SSE from the same cursor produce the same normalized final state.

### Projection and pagination

20. Projector crash before/after its transaction is idempotent; it refuses
    `N+2` while checkpoint is `N`.
21. Shadow rebuild equals incremental state at the same checkpoint and cuts over
    without a mixed generation.
22. More than 200 items returns the latest page and stable before/after/around
    sequence keysets while new items arrive.
23. Selected Conversation outside the first list page/filter remains selected;
    a late A request cannot populate active B.
24. A background Conversation updates head/unread even when its timeline is not
    loaded.

### Mutation, source and devices

25. POST-before-SSE, SSE-before-POST and response-loss retry converge under one
    `clientMutationId`.
26. Provider echo before HTTP response preserves the higher canonical revision
    without duplicate Message.
27. `created -> updated -> delivery_changed -> deleted` in one/batched delivery
    converges in timeline and sidebar.
28. Delivery/file state mutations are present in the stream.
29. Read 100 followed by stale read 80 remains 100 across web/mobile/desktop;
    manual unread and provider receipts remain independent.
30. Backfill/catch-up/live races dedupe correctly in bounded chunks; late history
    has `activityEligible=false`, creates no false head/unread/notification and
    never renumbers live items.
31. After lease reclaim, the stale owner cannot renew/finalize/write outcome; no
    second provider call occurs unless exact retry safety is proven, and durable
    handler outcome precedes `processed`.

### Isolation and capacity

32. Tenant A/Employee A cursors cannot read Tenant B or a different Employee's
    scope; staff-only changes never enter unauthorized snapshots/deltas.
33. Permission/session/Employee revocation purges cached data and prevents the
    next customer-data payload.
34. 50+ source bursts, a hot Conversation, wide recipient fanout and reconnect
    storm remain within
    agreed stream-lock, query, buffer, projection-lag and recovery budgets.

## Consequences

### Positive

- The snapshot-to-stream loss window is closed by durable replay.
- Sidebar, active timeline and optimistic updates converge by entity revision
  instead of timestamp/manual fanout heuristics.
- PostgreSQL supplies correctness without requiring Kafka, Redis or a separate
  realtime service for MVP.
- Outbox retries and SSE replay can evolve independently.
- The same protocol works in web, mobile and desktop clients and through polling
  fallback.
- Projection rebuild, permission change and restore have explicit recovery
  semantics instead of broad periodic refresh.

### Costs and risks

- Tenant stream-head locking and Conversation sequence allocation add database
  contention that must be measured.
- Immutable replay, tombstones, leases and shadow projections add storage and
  operational work.
- Recipient filtering/authorization epoch and authoritative scope manifests require
  careful security tests.
- Late history cannot be inserted into the live sequence without a new ordering
  decision; stability is preferred over silent reorder.
- Exactly-once network delivery is not promised; clients and consumers must be
  idempotent.

## Rejected Alternatives

### Timestamp plus event ID as the cursor

Rejected because provider/server clocks can be equal or late, event IDs do not
represent commit order and a late old timestamp can fall behind a checkpoint.

### PostgreSQL `bigserial` as proof of commit order

Rejected because allocation order can differ from commit order and permanently
skip an in-flight lower value.

### Outbox claim order as the realtime stream

Rejected because concurrent claims/retries/reaping are work scheduling, not an
immutable contiguous history.

### `LISTEN/NOTIFY` payloads as message delivery

Rejected because notifications can be missed and have no retained catch-up.
They remain wake-up hints only.

### Snapshot followed by future-only SSE

Rejected because a commit between the two is lost. Subscribe-before-snapshot is
also insufficient because an older snapshot can overwrite a newer delta.

### Full conversation refresh for every event

Rejected because replay becomes nondeterministic/current-state based and work
grows with timeline size rather than event size.

### Separate active-chat and sidebar message stores

Rejected because every lifecycle change requires error-prone manual fanout and
allows the two views to retain different revisions.

### Use entity revision gaps as the global cursor

Rejected because entities have independent lifecycles and recipient filtering
can legitimately hide intermediate revisions. Stream continuity owns gap
detection.

### Periodic broad refresh as recovery

Rejected because it does not define what is authoritative, can overwrite newer
state and scales poorly. Polling must consume the same cursor/delta contract.

### Put internal HMAC or long-lived token in the EventSource URL

Rejected because browser history, logs and referrers can expose it and cursors
must not become authorization credentials.

## Relationship To Existing ADRs

- ADR 0003 requires tenant scope in streams, cursors, projections and client
  authorization.
- ADR 0005 places the normalized reducer/connection state in shared app-shell.
- ADR 0006 keeps customer data and message processing in the data-plane.
- ADR 0008 provides raw/normalized input and current event/outbox foundations.
- ADR 0009 separates Conversation, WorkItem, CRM and employee state revisions.
- ADR 0010 supplies immutable author/app/provider identity facts.
- ADR 0011 requires route, Message, dispatch and outbox creation to be atomic;
  this ADR defines that transaction and later provider-result commits.

## Follow-Up Work

- `INB2-CON-008`: version command/event/sync batch/cursor/idempotency contracts.
- `INB2-DB-001`, `005`, `006`, `007`: sequences, revisions, tombstones, tenant
  stream heads/commits, read state, projection checkpoints and indexes.
- `INB2-SRC-007`, `009`: atomic canonical mutation/change/event/outbox boundary
  and token-fenced lease/reconciliation lifecycle.
- `INB2-PRJ-003`: contiguous projectors, immutable sync materialization and
  shadow rebuild.
- `INB2-API-001`, `002`, `003`: authoritative snapshots, stable pagination and
  idempotent revisioned mutation results.
- `INB2-RT-001`, `002`: authenticated SSE, replay, heartbeat/watchdog, retention
  outcomes and identical polling fallback.
- `INB2-UI-001`, `002`: normalized confirmed graph, optimistic overlays and one
  atomic reducer.
- `INB2-OPS-002`, `007`, `008`: lag/lock/resync metrics and epoch-aware
  restore/recovery runbooks.
