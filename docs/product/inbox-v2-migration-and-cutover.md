# Inbox V2 Migration And Cutover Strategy

- Status: `approved clean-slate pre-production epoch`
- Owner tasks: `INB2-ARCH-009`, `INB2-MIG-001`, `INB2-CLEAN-001`,
  `INB2-CLEAN-GATE`
- Last verified: `2026-07-22`
- Applies to: the currently known shared/local/CI Hulee fleet explicitly
  classified as disposable pre-production test state. Future real shared,
  isolated or on-prem deployments use the post-baseline append-only policy and
  are not granted destructive authority by this document.

## Current Disposition: Clean Slate

On `2026-07-20` the product owner classified every current Hulee environment,
including the known shared SaaS host, as pre-production test infrastructure and
classified all V1 database/object/provider/backup state as disposable. There is
no supported customer installation, V1 data migration requirement or committed
consumer of current Inbox V1 semantics.

ADR 0016 and disposition `clean-slate-2026-07-20-r1` supersede the historical
preserve result from `INB2-MIG-001`. The active path is:

```text
freeze automatic application/provider deployment
  -> detach V1 Web/API/worker/provider runtime
  -> remove V1 code and schema
  -> squash to one unpublished V2 baseline
  -> recreate disposable database/object state
  -> pass clean install/reset/repository/startup gates
  -> resume V2-only feature delivery
```

No V1 rows or objects are migrated. Dual materialization, backfill, semantic
shadow, V1 N-1 runtime compatibility, online preserve bridge and calendar soak
windows are not active requirements. Existing stale application images must not
connect to the new schema epoch.

`schemaVersion`, event/realtime/module API versions and the first public `/v1`
contract remain independent versioned contracts. Generic `/internal/v1` routes
unrelated to Inbox are not removed by prefix. Internal `InboxV2` names are not
renamed during this cleanup.

`INB2-CLEAN-GATE` passed on `2026-07-22`. The temporary manual unlock and
confirmation controls are retired. A successful full `Check` for a push to
`main` hands its exact checked SHA to the V2-only deployment workflow; no direct
push or manual path can bypass the full gate. The exact remote
reset/no-reconnect receipt is `docs/product/inbox-v2-clean-gate.md`. Provider
egress remains disabled until a separate reviewed adapter activation.

## Historical Preserve Decision (Superseded)

The remainder of this document records the former additive preserve design. It
is retained for decision history and as a future real-production migration
reference, but it does not constrain the current clean-slate epoch.

The historical preserve flow was:

```text
classify deployment
  -> backup/preflight when data must be preserved
  -> expand schema and versioned contracts
  -> materialize V2 beside V1
  -> repeatable backfill with diagnostics
  -> semantic shadow reconciliation
  -> tenant/cohort read and realtime canary
  -> exclusive V2 source dispatch
  -> V2 becomes canonical write/read/runtime
  -> observe zero legacy use
  -> remove V1 implementation in a separate contract phase
```

There is no automatic destructive reset based on `NODE_ENV`, deployment type,
row count or apparent test data. Every deployment is explicitly classified as
`empty`, `disposable` or `preserve`; an absent or uncertain classification
means `preserve`.

On the preserve path, Inbox V1 remains a compatibility implementation until
cutover evidence passes.
Public API v1 is an independently versioned external contract: after internal
V1 removal it may remain as a thin, tested facade over V2 until its own
published deprecation window ends.

## Binding Decisions

Decisions about dual materialization, shadow reads, compatibility writes and V1
rollback apply only to preserve. Both paths retain one command/side-effect owner,
honest unknown facts, explicit disposition, tenant isolation and local on-prem
operation.

1. All persistence changes are additive through the observation window.
2. One command owns each business mutation. Dual materialization is not two
   independent commands and never performs provider I/O twice.
3. V2 data is authoritative only after an explicit tenant/deployment mode
   transition. A client cannot select its own authority mode.
4. Shadow reads are side-effect free. They cannot dispatch, notify, mutate read
   state, claim work or update provider/account health.
5. Backfill preserves facts and provenance. It never invents an author,
   provider thread, route, roster, assignment history, Client link or delivery
   state.
6. Unknown legacy state produces a typed migration diagnostic and, when needed,
   a read-only/unresolved V2 record.
7. Provider dispatch has exactly one authority (`v1` or `v2`) per binding and
   generation. A flag transition cannot fan out or blindly retry an uncertain
   provider call.
8. A database rollback is not the normal rollback path. Before the contract
   phase, old application versions must remain compatible with the expanded
   schema; rollback normally changes server-owned modes while the schema stays
   expanded.
9. Once V2-only semantics have been accepted, any remaining V1-compatible
   facade projection is non-authoritative: per-tenant command/source rollback
   to V1 is forbidden. Recovery is a V2 forward fix or a coordinated full
   backup restore with an explicit data-loss decision.
10. On-prem migration, flags, diagnostics and recovery run locally in the data
    plane and do not require permanent SaaS control-plane connectivity.

## Scope And Non-Goals

This document decides environment disposition, compatibility, materialization,
backfill, shadow comparison, feature-control axes, cutover, rollback and V1
removal criteria. It does not implement migrations or create V2 tables.

Implementation belongs to:

- `INB2-DB-008`: clean V2 install/guarded reset and the now-required V1 upgrade
  harness;
- `INB2-MIG-001`: completed producer/consumer/runtime inventory and preserve
  disposition;
- `INB2-MIG-002`: activated online schema bridge and compatibility
  materialization for preserve;
- `INB2-MIG-003`: activated operational backfill for preserve;
- `INB2-MIG-004`: final revisioned preserve disposition plus shadow/rollout/
  authority controls;
- `INB2-MIG-005`: atomic preserve-disposition/control revalidation followed by
  the fenced internal/Telegram cutover;
- `INB2-MIG-006`: pre-removal acceptance, rollback drill and signed early
  V1-applicable lifecycle/fleet/backup removal subgate;
- `INB2-MIG-007`: V1 implementation removal;
- `INB2-OPS-007` and `INB2-OPS-009`: later productization of restore and packaged
  deployment proof, reusing the MIG-006 removal dossier.

Exact retention, subject export/delete, legal-hold, audit and restore-erasure
behavior is fixed by ADR 0015 and
`docs/product/inbox-v2-data-lifecycle-and-privacy.md`. That policy may lengthen
storage/observation periods but cannot make an ambiguous migration fact safe to
infer.

## Verified Starting Point

### Repository baseline

- V1 persists one optional Client, scalar queue/assignee/team state and
  text-first inbound/outbound Messages.
- V1 has no exact external thread/binding route, durable author, sequence,
  revision, roster, per-employee read cursor or resumable realtime cursor.
- Public API/Telegram Bot can create V1 Client, Conversation, Message, Event and
  Outbox rows; Telegram Bot outbound consumes the overloaded `message.sent`
  event as a dispatch command.
- direct Telegram/WhatsApp/MAX runtime currently covers authentication, session
  health and SourceAccount synchronization, not V2 message runtime.
- the web inbox reads `/internal/v1/inbox` and refreshes after mutations.
- current production Compose has a one-shot `migrate` service, and the deploy
  workflow applies migrations before recreating application services.
- a complete production/on-prem backup and restore runbook does not yet exist;
  actual V2 production cutover is blocked until the downstream operational
  tasks provide and rehearse it.
- the repository documents `chat.hulee.ru` as a production target, but no
  authoritative fleet/on-prem installation registry exists. Missing telemetry
  is not evidence that no other installation exists.

### Known shared SaaS data

Read-only verification on `2026-07-16` found a known live `saas_shared` data
plane with non-empty V1 business/event state, active API/application access,
active bot/direct provider and encrypted-session state, a non-empty object store
whose inventory does not reconcile one-to-one with DB file rows, and historical
database/configuration backup roots.

This deployment is `preserve`. The public disposition, copy categories and
cutover/delete ownership are in
`docs/product/inbox-v2-mig-001-inventory-and-disposition.md`. Exact operational
topology, counts, paths and digests are retained in restricted operator evidence.

### Current workspace development data

Read-only re-verification on `2026-07-16` found:

| Entity                       |      Rows |
| ---------------------------- | --------: |
| tenants                      |        42 |
| clients                      |         3 |
| conversations                |         3 |
| messages                     |         7 |
| conversation participants    |         1 |
| source connections/accounts  |         0 |
| raw/normalized source events |         0 |
| event store / outbox         | 285 / 267 |
| pending / processed outbox   |  252 / 15 |
| message delivery attempts    |         1 |
| V2 conversations/items       |   10 / 12 |
| deletion runs / hold heads   |    55 / 8 |
| restore-ledger rows          |        19 |

All legacy Client/Conversation/Message rows belong to the `local` seed tenant,
but the large pending outbox set makes this database useful for reconciliation
tests. Additional tenants and V2 governance rows are test fixtures, not proof
that the whole database is disposable.
The seven Messages are `4 inbound/received`, `2 outbound/queued` and
`1 outbound/sent`; all three `message.sent` outbox rows are `processed`, so two
queued Messages already prove that processed V1 outbox is not delivery evidence
and cannot be blindly replayed during migration.
All three open `client_direct` Conversations have no queue/assignee/team, so
they also exercise the blocking `migration.work_queue_missing` outcome unless
an operator configures a valid migration Queue.
On preserve, the first V2 pass keeps it as a V1-upgrade fixture and exercises
backfill/outbox classification; reset is allowed only afterward through an
explicit `disposable` choice. On the proven fast path, an explicit guarded
disposable reset is the required lane and no V1-upgrade fixture is manufactured.

## Deployment Classification

Before any V2 migration command, a deployment manifest records:

- deployment ID/type and application/schema versions;
- classification: `empty`, `disposable` or `preserve`;
- classification owner, timestamp and reason;
- tenant inventory and V1 row totals;
- object-storage inventory/checkpoint;
- active connector/session/outbox/lease summary;
- backup ID and restore-verification result when required;
- target migration contract version and supported upgrade path.

The manifest is durable evidence. CLI flags and environment variables may point
to it but cannot replace it.

### Environment decision matrix

| Environment                               | Default classification               | Data action                                                                                | Required evidence                                                |
| ----------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| Brand-new empty database                  | `empty` after zero-row preflight     | Install V2 schema/seed; no backfill                                                        | Empty DB migration smoke and V2 seed test                        |
| Personal/local development                | `preserve` until explicitly declared | Use fast-path reset only after explicit `disposable` inventory; otherwise upgrade/backfill | Recorded choice; V1 fixture exists only for preserve path        |
| Shared development/staging with team data | `preserve`                           | Additive upgrade, backfill and reconciliation                                              | Backup or reproducible snapshot plus report                      |
| Shared SaaS production                    | `preserve`                           | Global expand migration; tenant-scoped materialize/backfill/canary waves                   | Backup/restore proof, per-tenant checkpoints and cohort evidence |
| Isolated SaaS                             | `preserve`                           | Deployment wave using the same core state machine                                          | Deployment backup, canary and rollback drill                     |
| On-prem/private deployment                | `preserve`                           | Operator-run in-place upgrade; never remote reset                                          | Local preflight, compatible package, backup and tested restore   |
| Unknown/unregistered deployment           | `preserve`                           | Refuse destructive/reset mode                                                              | Inventory and explicit classification required                   |

`empty` means all V1 business tables are empty, not merely that one tenant or
inbox query is empty. `disposable` is an operator assertion, never a heuristic.

## Canonical Authority And Compatibility

### External contract versus implementation

These concerns are independent:

- Public API v1 schema and behavior may remain supported;
- internal V1 domain/read-model tables and `/internal/v1/inbox` are temporary;
- V1-compatible requests can be translated into one V2 command after cutover;
- a v1 response facade may project V2 facts only when it can preserve the
  published v1 contract without inventing data;
- V2-only features that have no v1 representation are absent from the v1 facade
  rather than flattened into misleading scalar fields.

No existing v1 request/response/event schema is expanded into a large optional
V1/V2 union. New functionality uses versioned V2 contracts.

### Single command and dual materialization

During compatibility, ingress is adapted once into a canonical command with one
tenant, idempotency key, mutation ID and authorization decision. In one local
transaction, or through one resumable transactionally-enqueued materializer, it
may persist:

- the canonical V2 aggregate/event/outbox changes; and
- the minimum V1 compatibility rows needed by an enabled legacy consumer.

It must not call a V1 service and a V2 service independently. Partial success
must be retryable without a second provider side effect or duplicate Message.

Provider input is durably recorded before materialization. Provider output is
owned by one dispatch attempt pinned to one SourceThreadBinding, SourceAccount,
route descriptor, capability revision and dispatch generation.

## Server-Owned Migration Control

`INB2-MIG-002` introduces the minimum materialization phase and emergency kill
switch; `INB2-MIG-004` extends it with audited shadow/read controls. The durable
record is validated, revisioned and server-owned. Command/materialization
authority is sticky per tenant/Conversation; provider ownership is fenced per
SourceConnection/SourceAccount/binding. Employee/app cohorts may select only
read/UI/realtime canaries, never random command or dispatch ownership.

The record exposes these constrained axes:

| Axis                     | Values                                                                  | Meaning                                                                                  |
| ------------------------ | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `materializationMode`    | `v1_only`, `dual`, `v2_with_compatibility_projection`, `v2_only`        | Which canonical command materializes which persistence models                            |
| `queryMode`              | `v1`, `v1_shadow_v2`, `v2_canary`, `v2`                                 | Which read result is returned; shadow never affects the response                         |
| `dispatchMode`           | `v1`, `handoff_to_v2`, `v2`, `handoff_to_v1`                            | Exclusive owner transition for an eligible binding generation                            |
| `realtimeMode`           | `v1_refresh`, `v2_stream_canary`, `v2_stream`                           | Client synchronization authority                                                         |
| `legacyRouteFallback`    | `disabled`, `observe_only`                                              | Measures would-be legacy routing without performing fallback I/O                         |
| `compatibilityWriteMode` | `not_applicable`, `complete_required`, `facade_subset_only`, `disabled` | Whether compatibility writes are a rollback-complete projection or a read-only V1 facade |

The server derives client-visible capabilities from this control record. A web,
mobile or desktop parameter/cookie cannot select V2 authority.
A deployment emergency ceiling may only disable a new V2 side effect or force a
compatible read fallback; it cannot advance a tenant into V2. Missing/invalid
control state fails closed to the last durable compatible authority.

### Validated phase state machine

The axes are not arbitrary booleans. They are derived from one audited phase:

```text
schema_expanded
  -> v1_primary_dual_materialize
  -> v2_backfilled
  -> shadow_read
  -> v2_command_primary
  -> v2_read_canary
  -> v2_source_handoff
  -> v2_primary_observing
  -> v2_only
  -> v1_disabled
  -> contracted
```

`v2_command_primary` makes every V1/V2 client command an adapter into the same
V2 command owner while maintaining a rollback-complete V1 compatibility
projection. `v2_source_handoff` separately fences listener checkpoints and
dispatch authority. It may cross the representability boundary, after which
compatibility writes are only a non-authoritative facade subset.

### Normative phase-to-axis mapping

| Phase                         | Materialization                    | Query          | Dispatch                                          | Realtime           | Legacy fallback | Compatibility write                                             |
| ----------------------------- | ---------------------------------- | -------------- | ------------------------------------------------- | ------------------ | --------------- | --------------------------------------------------------------- |
| `schema_expanded`             | `v1_only`                          | `v1`           | `v1`                                              | `v1_refresh`       | `disabled`      | `not_applicable`                                                |
| `v1_primary_dual_materialize` | `dual`                             | `v1`           | `v1`                                              | `v1_refresh`       | `observe_only`  | `complete_required`                                             |
| `v2_backfilled`               | `dual`                             | `v1`           | `v1`                                              | `v1_refresh`       | `observe_only`  | `complete_required`                                             |
| `shadow_read`                 | `dual`                             | `v1_shadow_v2` | `v1`                                              | `v1_refresh`       | `observe_only`  | `complete_required`                                             |
| `v2_command_primary`          | `v2_with_compatibility_projection` | `v1_shadow_v2` | `v1`                                              | `v1_refresh`       | `observe_only`  | `complete_required`                                             |
| `v2_read_canary`              | `v2_with_compatibility_projection` | `v2_canary`    | `v1`                                              | `v2_stream_canary` | `observe_only`  | `complete_required`                                             |
| `v2_source_handoff`           | `v2_with_compatibility_projection` | `v2_canary`    | `handoff_to_v2`; reverse only while representable | `v2_stream_canary` | `observe_only`  | `complete_required` if representable; else `facade_subset_only` |
| `v2_primary_observing`        | `v2_with_compatibility_projection` | `v2`           | `v2`                                              | `v2_stream`        | `observe_only`  | `complete_required` if representable; else `facade_subset_only` |
| `v2_only`                     | `v2_only`                          | `v2`           | `v2`                                              | `v2_stream`        | `disabled`      | `disabled`                                                      |
| `v1_disabled`                 | `v2_only`                          | `v2`           | `v2`                                              | `v2_stream`        | `disabled`      | `disabled`                                                      |
| `contracted`                  | `v2_only`                          | `v2`           | `v2`                                              | `v2_stream`        | `disabled`      | `disabled`                                                      |

In the two conditional rows, “representable” means
`v1Representable=true -> compatibilityWriteMode=complete_required`; otherwise
`compatibilityWriteMode=facade_subset_only`. The latter may maintain only the
fields needed by an approved V1/Public API read facade and is never evidence of
rollback completeness.

While the representability fence remains true, a reverse transition creates a
new control revision; it never rewinds a source generation.
`v2_primary_observing` returns through `v2_source_handoff -> v2_read_canary ->
v2_command_primary -> shadow_read`. Each step must satisfy its own
parity/fencing gate. Once `v1Representable=false`, command/source authority
cannot transition to V1; `facade_subset_only` cannot authorize that transition.

### Representability fence

`v1Representable` is an independent, revisioned transactional fence, not an
inference from a later phase name. It starts `true` only while every accepted
command/event can be completely represented in the V1 compatibility projection.

- a command/inbound transaction that would create a multi-client group,
  clientless internal chat, staff note, sequential WorkItem, V2-only route/RBAC
  fact or any other non-representable state is rejected while the fence is true;
- before handing off a SourceAccount/binding capable of receiving such traffic,
  the control transaction atomically sets `v1Representable=false`, records the
  reason/surfaces/checkpoint and removes command/source rollback to V1;
- the same transaction revision is checked by ingress, command materialization
  and pre-provider-I/O policy, so a group event racing the handoff cannot enter
  under the old rollback promise;
- after false, read/UI may temporarily fall back to a V1-compatible subset, but
  `compatibilityWriteMode=facade_subset_only` is non-authoritative and
  command/source rollback uses only a prior V2-compatible release or roll-forward.

### Illegal combinations

- `queryMode=v2*` requires V2 schema, completed tenant backfill and a current
  projection generation.
- `realtimeMode=v2_stream*` requires V2 query authority and a valid stream
  epoch, sync generation and snapshot/cursor handshake.
- `dispatchMode=handoff_*|v2` requires V2 materialization, exact binding/route
  readiness, provider gate evidence and drained/reconciled V1 in-flight
  dispatches.
- `materializationMode=v2_only` requires compatibility-write policy and rollback
  boundary approval.
- `legacyRouteFallback=observe_only` cannot call provider or bypass exact
  SourceAccount authorization; any would-be fallback blocks source cutover.
- a stale control revision cannot mutate or dispatch after a transition.
- `v1Representable=true` rejects any non-representable command/inbound event and
  any source handoff that could admit one without a narrower proven surface.

Every transition is audited with previous/new values, actor, reason, release,
tenant/cohort, verification report and rollback eligibility.

## Migration Phases And Gates

### Phase 0: inventory and classify

- finish `INB2-MIG-001` repository/runtime/deployment inventory;
- classify the deployment and tenants;
- capture V1 totals, duplicates, invalid tenant edges, active outbox/leases and
  provider sessions;
- refuse upgrade when the source version has no supported path.

Exit: no unexplained producer, consumer, table or deployment is present.

### Phase 1: backup and expand

- create a consistent PostgreSQL backup and a real recoverable object-storage
  snapshot/versioned backup; a manifest alone is inventory, not backup;
- verify the deployment-local encryption/config material required for restore;
- run additive schema migrations only;
- keep the currently deployed application compatible with the expanded schema;
- do not add destructive constraints until backfill diagnostics are clean.

Expand DDL rules for the migrate-before-restart deployment:

- no drop/rename/type narrowing, blocking table rewrite or incompatible default;
- no new V2 enum/semantic value is written into a V1 column that the N-1
  API/worker cannot parse; V2 state uses new tables/columns/contracts;
- new columns are nullable or have an N-1-safe staged default;
- large indexes use the platform's online/concurrent path and explicit lock/
  statement budgets; after reviewed N-1 write compatibility is proven,
  constraints are staged (`NOT VALID`/equivalent), backfilled and validated
  before later tightening;
- the N-1 API read/write paths, V1 inbox query/reply/routing, worker claim/
  finalize and old image startup pass against the expanded database before the
  new image is deployed;
- migration failure leaves the N-1 release operational or triggers an explicit
  halt before application replacement.

The checked DB-008 pre-expand compatibility build is pinned to revision
`3b9d703bb63d5ce39ea549d62413dee02d1969a0` plus the exact
`db008-n1-routing-returning-qualification-v1` patch. The raw historical revision
is not a valid expand candidate: its V1 routing statement can fail with
PostgreSQL `42702`. Deploy an image containing the same patched source digest
and pass `pnpm test:inbox-v2:preserve` before expand. That repository harness is
only a prerequisite: it does not authorize a preserving deployment. Its checked
CJS process exercises pinned API service functions, a stubbed Web load path and
the outbox worker, but it is not a Next/API server or deployable image.

The normal install runner also preflights pending DDL and refuses the historical
`0029`/`0036` blocking, rewrite, destructive and unbounded-work boundaries with
`inbox_v2.expand_online_bridge_required`. For pre-existing relations this is a
categorical decision, not a mutable row-count/size decision: unknown ALTER/DDL,
rewrites, immediate tightening, trigger/security changes and unbounded work all
require review even when the observed relation is currently empty or small.
Production and on-prem preserve expand remain blocked until `INB2-MIG-002`
supplies a reviewed online bridge, the real supported N-1 deploy image starts
and passes its workload, and the PostgreSQL/object restore plus release controls
below pass. The DB-008 test-only compatibility switch is not exposed through
CLI or environment and must never be used as deployment authority.

The pinned DB-008 process currently proves query, reply, routing, outbox and
WorkItem compatibility; it does not exercise an old-shape attachment-anchor
write or an in-flight attachment transfer. Consequently, nullable attachment
bridge columns alone do not authorize Inbox V2 attachment activation.
`INB2-MIG-002` must either add that exact supported N-1 workload and a compatible
online bridge, or record and enforce a drain checkpoint proving that every
supported old attachment writer and transfer is stopped before V2 becomes the
attachment owner.

Attachment reservation namespace rotation has the same cutover boundary. The
MSG-003 drain query is a bounded observation, not a pause receipt or key-removal
capability. `INB2-MIG-002` must durably pause materialization admission on every
replica, serialize the pause revision with a second zero unfinished-work and
zero nonterminal-job observation for the exact tenant/generation, persist the
consumed drain receipt, remove the key, and resume on the next generation.
Until that control exists, a retired-generation verification deadline fails
closed before provider or storage I/O and the key must not be removed.

Exit: fresh DB and representative V1 snapshot both migrate; old compatible app
still reads, writes and processes worker work; PostgreSQL and object-storage
restore rehearsal succeeds for the release profile, including orphan/reference
reconciliation.

### Phase 2: dual materialization

- under a tenant/Conversation migration fence, capture the V1 snapshot boundary
  and reserve the exact legacy sequence prefix for every existing Conversation;
- enable V2 materialization for controlled tenants/sources;
- keep V1 reads and exclusive V1 dispatch initially;
- ensure one mutation produces stable V1/V2 correlation IDs;
- measure any legacy route fallback explicitly.

Exit: new fixture and live-compatible writes create one canonical V2 result and
the expected V1 compatibility result without duplicate provider I/O; every
pre-fence legacy Message has a reserved prefix slot and every post-fence write
uses a later live sequence.

### Phase 3: repeatable backfill

- allocate a tenant checkpoint/high-water mark;
- fill each reserved Conversation prefix in deterministic `(created_at, id)`
  order through bounded, tenant-scoped batches;
- catch up changes recorded after the checkpoint;
- persist diagnostics and stable reason codes;
- rerun from any interruption without duplicate canonical entities.

Exit: all rows are mapped, explicitly excluded or diagnosed; rerun totals and
reason counts are stable. If prefix reservation/fence cannot be proven, the
tenant cannot enter dual materialization; implementation may not insert old
rows before already published live sequences or renumber them later.

### Phase 4: projection build and semantic shadow

- build V2 projections in a shadow generation;
- catch the generation up to a contiguous commit checkpoint;
- run side-effect-free V2 queries beside returned V1 queries;
- compare semantics after applying the same authorization context;
- store only safe counts, IDs/references, hashes and reason codes.

Exit: required fixture/tenant reports have zero unexplained differences and no
mandatory projection gaps.

### Phase 5: V2 command ownership, then read and realtime canary

- atomically move tenant/Conversation commands to one V2 command owner while
  preserving the complete V1 compatibility projection;
- adapt old Public/Internal API clients into that same command owner;
- switch selected staff/client cohorts to V2 reads;
- perform snapshot plus stream handshake and gap/reconnect recovery;
- leave dispatch on its single pre-approved owner;
- observe errors, latency, authorization denials, stale heads and user impact;
- rehearse immediate server-side read/realtime rollback.

Exit: command compatibility is complete, canary soak passes and rollback returns
the same authorized semantic state.

### Phase 6: source and dispatch canary

- before handoff, atomically set `v1Representable=false` when the binding can
  receive any non-representable event; full command/source rollback to V1 ends
  at that recorded boundary;
- drain or reconcile V1 dispatch claims before changing authority;
- pin every V2 attempt to an immutable binding/route/generation;
- enable V2 ingestion/dispatch for selected bindings;
- fence exactly one listener checkpoint owner and one dispatcher generation per
  SourceConnection/SourceAccount/binding;
- reconcile provider response/echo/receipt and uncertain outcomes;
- never retry an uncertain V1 attempt merely because authority changed.

Exit: provider fixture/live gates pass with no duplicate send, account hop,
private/group misroute or unowned attempt.

#### Fenced source handoff protocol

Each SourceConnection/SourceAccount/binding moves through a durable handoff
record:

```text
v1_active(generation N)
  -> draining_to_v2
  -> checkpoint_captured
  -> owner CAS committed(generation N+1, v2)
  -> v2_active
```

1. `draining_to_v2` prevents new V1 listener/dispatch claims at a durable fence.
2. Existing claims either finalize under generation N or become explicit
   reconciliation/uncertain outcomes; they are never silently reassigned.
3. The handoff captures the last safely materialized inbound checkpoint, every
   in-flight outbound attempt and the V2 raw-event/occurrence checkpoint.
4. One compare-and-swap commits owner/generation/checkpoint. Only then may V2
   claim work.
5. Listener claim, checkpoint advance, pre-provider-I/O check and attempt
   finalize all validate the current owner, generation and handoff token. A stale
   V1/V2 worker cannot mutate or call provider after ownership changes.
6. V2 resumes strictly from the proven checkpoint. Providers without a reliable
   cursor use a controlled overlap/resync window with exact raw-event/
   occurrence idempotency and a gap diagnostic.
7. Reverse handoff uses the same protocol and a new generation; it never
   decrements/reuses N.

Telegram Bot polling is a special migration hazard: V1 can persist
`lastUpdateId` before normalization/materialization succeeds, while raw events
are absent. That cursor is not a trusted V2 resume point. Handoff must use a
provider-supported history/resync boundary or controlled rewind/overlap with
exact dedupe; if neither proves no gap, `migration.source_cursor_untrusted`
blocks source cutover rather than skipping an event.

### Phase 7: V2 primary

- use V2 queries, realtime and source runtime for the tenant/cohort;
- while `v1Representable=true`, require the rollback-complete compatibility
  projection and keep the fenced reverse path eligible;
- after `v1Representable=false`, allow only the explicitly approved
  `facade_subset_only` projection; it can serve compatible reads but cannot
  authorize V1 command/source ownership;
- deny new legacy route fallback and monitor fallback counters;
- keep V1 schema/code available during the observation window.

Exit: all managed cohorts are V2 primary and zero legacy-use windows begin.

### Phase 8: disable V1 runtime

- disable V1 reads, business writes, dispatch and internal fallback;
- retain diagnostics and migration reports;
- keep an external Public API v1 facade only if it remains a supported contract;
- start the global runtime-removal observation window.

Exit: no supported runtime depends on the V1 implementation.

### Phase 9: contract/remove

- complete `INB2-MIG-006` acceptance and restore/rollback drill;
- remove V1 implementation through separately reviewed code and destructive DB
  migrations;
- rotate stream epoch/generation when restored/rebuilt positions could collide;
- publish V2-only operating/development documentation.

Exit: repository/runtime/deployment searches and clean-install/upgrade tests
prove V2 is the only canonical implementation.

## Backfill Rules

### Required migration ledger

Operational backfill does not hide progress in generic job logs. It persists:

- `MigrationRun`: deployment/tenant, source/target schema and contract versions,
  application release, dry-run/apply mode, operator/approval, stable watermark,
  status, timestamps and totals;
- `MigrationEntityMap`: source table/ID/content hash to target type/ID/revision,
  outcome `mapped | skipped | ambiguous | blocked` and stable reason code;
- bounded chunk/checkpoint/lease state with a fencing token;
- safe diagnostics and final anti-join/reconciliation totals.

The same source ID/hash and migration contract is idempotent. If a V1 source row
changes after mapping, it is re-evaluated or diagnosed and cannot silently
overwrite a newer V2 revision. Completion proves every in-scope V1 row is mapped
or has an explicit stable outcome; a checkpoint cannot make ambiguity disappear.

| V1 fact                                             | V2 action                                                                                                                                                                 | Forbidden inference / diagnostic                                                                                                                 |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Tenant and valid tenant-owned IDs                   | Preserve an existing stable ID only when the V2 contract accepts it and the mapping is deterministic; otherwise use the idempotent entity map                             | Cross-tenant edges block the tenant batch                                                                                                        |
| Client                                              | Reuse canonical Client; create explicit ConversationClientLink from V1 scalar association with `legacy_v1` provenance                                                     | Client is not external thread, author or route                                                                                                   |
| Conversation                                        | Preserve ID when one V1 row maps to one V2 Conversation; derive only validated topology/purpose/lifecycle                                                                 | Do not infer group, provider thread or Client requirement from display data                                                                      |
| `conversation_participants` Employee row            | Create Employee participant anchor and one synthetic migration membership episode                                                                                         | Historical role/origin/join/leave remains unknown                                                                                                |
| External contact/handle                             | Create ExternalIdentity only when namespace, account/scope and subject are provable                                                                                       | Otherwise `legacy_identity_scope_unknown`                                                                                                        |
| Scalar queue/team/assignee                          | Create current WorkItem/routing snapshot only with a valid configured migration Queue; record observation at migration checkpoint                                         | Without a valid Queue import Conversation read-only/unclassified, emit blocking `migration.work_queue_missing`; never invent Queue/owner/history |
| Message ID/text/direction/time                      | Preserve accepted ID or entity-map it, content/direction and legacy provenance; fill the pre-reserved legacy prefix by `(created_at, id)`                                 | Wall time is not realtime position; never renumber published live sequences; outbound Employee author is usually unknown                         |
| Inbound author                                      | Link only with exact source identity evidence                                                                                                                             | Current Client is not automatically the author                                                                                                   |
| Outbound author                                     | Use explicit `legacy_unknown`/migration actor state until evidence exists                                                                                                 | Current assignee/responsible is never substituted                                                                                                |
| Message status and `message.sent` event             | Map only proven queue/attempt facts with legacy semantic provenance                                                                                                       | Never synthesize provider sent/delivered/read from the overloaded event name                                                                     |
| V1 `queued` Message + processed outbox + no attempt | Import historical Message as `legacy_unresolved`, `dispatchable=false`; create no OutboundDispatch/provider outbox and require explicit reconciliation/manual send-as-new | Blocking `migration.outbox_outcome_unknown`; never replay or expose as claimable V2 `queued` work                                                |
| Delivery attempt                                    | Preserve exact attempt/status/error timestamps where semantics are known                                                                                                  | Ambiguous provider acceptance remains uncertain                                                                                                  |
| Attachment/file                                     | Preserve tenant-safe IDs, object references, metadata and authorization relation                                                                                          | Missing/cross-tenant object is diagnosed, not silently dropped                                                                                   |
| Provider message ID                                 | Backfill only with a provable versioned message realm/scope                                                                                                               | Otherwise `legacy_message_scope_unknown`                                                                                                         |
| External thread/binding/route                       | Create only from exact provider/account/object/scope evidence                                                                                                             | Client handle, first connector or active account cannot supply a route                                                                           |
| SourceAccount                                       | Reuse only when actual external account identity is verified                                                                                                              | Session reauth is not account replacement                                                                                                        |
| Historical unread/SLA/notification                  | Build projection head from history but mark import as migration baseline/no-new-activity                                                                                  | Do not produce unread storms, SLA starts or notifications                                                                                        |
| CRM/reporting fact                                  | Tag as `legacy_backfill` and retain known event time/provenance                                                                                                           | Do not invent author, responsible or funnel state at historical time                                                                             |
| RBAC role/grant                                     | Produce dry-run least-privilege mapping and administrator review where ambiguous                                                                                          | Never broaden `client`, `assigned`, reply, report, PII or export authority                                                                       |
| Pending/processing outbox                           | Drain, fence or quarantine and reconcile before dispatch cutover                                                                                                          | Never replay solely because V2 now owns dispatch                                                                                                 |

Initial backfill builds the correct historical head without emitting normal
new-activity side effects. A migration baseline cursor is distinct from proof
that an Employee actually read each historical item.

## Migration Diagnostics

Every diagnostic has tenant, migration run/version, source entity/ref, stable
reason code, severity, safe details, first/last occurrence, count and resolution
state. Suggested stable families include:

- `migration.tenant_edge_invalid`;
- `migration.duplicate_identity`;
- `migration.thread_scope_unknown`;
- `migration.source_account_unresolved`;
- `migration.source_cursor_untrusted`;
- `migration.route_binding_unknown`;
- `migration.provider_message_scope_unknown`;
- `migration.author_unknown`;
- `migration.roster_unavailable`;
- `migration.membership_history_unknown`;
- `migration.assignment_history_unknown`;
- `migration.work_queue_missing`;
- `migration.delivery_semantics_ambiguous`;
- `migration.attachment_missing`;
- `migration.outbox_inflight`;
- `migration.outbox_outcome_unknown`;
- `migration.rbac_review_required`;
- `migration.shadow_difference`.

Blocking diagnostics include invalid tenant ownership, duplicate canonical keys,
unexplained lost/extra Messages, an ambiguous active outbound route, unsafe RBAC
broadening, missing migration Queue for actionable work, untrusted source
cursor, unknown queued/outbox outcome, mandatory projection gaps and
unreconciled in-flight dispatch.
Unknown historical author/roster/assignment may remain non-blocking only when it
is explicit, read-only where required and excluded from false reporting claims.

## Shadow Reconciliation Contract

Comparison is semantic, tenant-scoped and checkpointed. It does not require V1
and V2 row shapes or IDs to be identical where the approved mapping differs.
Comparison begins only when backfill is complete and the V2 projection
checkpoint has reached the correlated mutation position. Projection lag is
`not_comparable_lag`, not a semantic match or mismatch. Where possible, both
compatibility DTOs are built from one repeatable-read boundary.

Required comparison families:

- source input and canonical mutation correlation counts;
- visible Conversation set for the same authorization context;
- V1 Client association versus V2 Client-link mapping;
- message count, direction, safe content hash, attachment refs and order;
- last visible timeline/head and activity timestamp;
- queue/assignment current snapshot versus WorkItem state;
- outbound pending/attempt/result and fallback ownership;
- authorization allow/deny result and reason family;
- unread/notification/SLA side-effect counters;
- projection checkpoint, lag, gap and generation;
- migration diagnostics by stable reason.

Rules:

1. Shadow execution cannot perform provider calls or business mutations.
2. Raw content, secrets and PII are not copied into comparison telemetry;
   tenant-scoped keyed/HMAC identifiers, hashes and safe references are used.
3. Expected differences require a versioned allowlist entry with owner, reason,
   affected contract version and expiry. An unowned or expired difference is
   unexplained.
4. Exact invariants have zero tolerance: tenant leakage, lost/duplicate message,
   wrong route/account, unauthorized visibility, provider double-send and
   skipped mandatory stream position.
5. A shadow timeout/failure is observable and cannot silently count as a match.
6. Comparison jobs use bounded sampling/batches and circuit breakers so shadow
   work cannot degrade the authoritative path.

## Rollout Cohorts And Minimum Windows

This section applies only to preserve deployments and published/supported
external contracts. An eligible pre-production direct replacement uses
scenario/test gates instead of calendar soak windows.

Managed SaaS order:

1. deterministic fixtures and fresh/upgrade CI databases;
2. staging clone with sanitized production-like distribution;
3. Hulee staff/internal tenant;
4. low-volume canary tenants and selected client cohorts;
5. wider cohorts by source/load/risk;
6. all eligible managed tenants;
7. separately scheduled isolated/on-prem releases.

Minimums may be lengthened by retention, compliance or operational policy:

- each read/realtime or dispatch canary: `7` consecutive days including a full
  business-week cycle;
- wider managed cohort soak: `14` consecutive days;
- before disabling/removing internal V1 runtime: `30` consecutive days with
  zero legacy read/write/dispatch/fallback use and zero unexplained shadow diff;
- external Public API v1 removal: at least `90` days after published deprecation
  notice, plus proof that no supported client/deployment depends on it;
- on-prem/native compatibility: at least `90` days or one documented supported
  release cycle, whichever is longer, with every registered deployment/client
  version accounted for;
- an incident, unexplained divergence, rollback or legacy fallback resets the
  affected observation clock.

Shortening a minimum requires an explicit release decision with recorded risk;
it is never implied by a successful unit test or one quiet tenant.

Time alone is insufficient. Each canary also satisfies a workload/scenario
floor for every surface required by its release gate:

- deployed-stack fixture/load evidence: at least `1,000` canonical mutations,
  `100` outbound dispatch attempts and `100` snapshot/stream reconnect cycles;
- controlled faults include retryable failure, uncertain provider outcome,
  stale owner/generation, duplicate input and projection gap/recovery;
- live provider evidence per required private/group surface includes at least
  `10` inbound and `10` outbound successful Messages, `2` attachment transfers,
  one reply/reference flow and one session reconnect; lifecycle/receipt rows
  follow the direct-messenger matrix;
- a low-volume tenant may use a dedicated live-fixture tenant in the same
  deployed release/network path to meet the floor, but synthetic traffic cannot
  replace separately required provider live evidence or contact real customers;
- wider cohort evidence includes a representative peak/load interval.

Downstream SLO/load policy may raise these counts. A missing required scenario
means the observation clock has not started for that surface.

## Rollback Classes

| Cutover point                                  | Allowed rollback                                                                                     | Conditions                                                                                                                                |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Expand/backfill/shadow                         | Roll application/read mode to V1; leave expanded schema                                              | No destructive migration; backfill is idempotent                                                                                          |
| V2 read/realtime canary                        | Server switches cohort to V1 query/refresh                                                           | V1 remains current; client discards incompatible V2 generation                                                                            |
| V2 dispatch canary with `v1Representable=true` | Fence new V2 attempts, reconcile in-flight/uncertain attempts, then use the fenced reverse handoff   | No blind retry; route/generation remains immutable; compatibility projection is complete                                                  |
| V2 primary with `complete_required`            | Return to V1 only after reconciliation proves the compatibility projection is current                | `v1Representable=true`; no accepted V2-only state                                                                                         |
| V2 primary with `facade_subset_only`           | Read/UI may use the approved subset; freeze and forward-fix or deploy a prior V2-compatible binary   | `v1Representable=false`; the subset never authorizes V1 command/source rollback; tenant-local SaaS defect never authorizes global restore |
| V2-only state or compatibility writes disabled | Freeze affected tenant/source and forward-fix or deploy a prior V2-compatible binary; no V1 rollback | A tenant-local shared-SaaS defect never authorizes global restore                                                                         |
| V1 schema/code removed                         | V2-compatible release/roll-forward; full restore only for confirmed deployment-wide catastrophe      | Rehearsed PostgreSQL plus real object backup, compatible image/config/secrets, external-effect reconciliation and stream epoch rotation   |

Rollback never runs down-migrations against a live database by default. A
tenant-local defect in shared SaaS freezes/repairs that tenant and must not roll
back unrelated tenants or already-observed provider effects by restoring the
whole shared database. Full restore is reserved for a confirmed deployment-wide
catastrophe under incident authority. It coordinates PostgreSQL, a real
recoverable object-store snapshot/versioned backup (not just a manifest),
deployment-local secrets/config, application release and reconciliation of
external provider effects. If restored positions/generations can collide with a
published cursor, `streamEpoch` changes and every client takes a fresh snapshot.
The first successful CAS from `v1Representable=true` to `false` records the
irreversible command/source rollback boundary in the migration ledger and audit.
UI/operator tooling must immediately stop promising V1 command/source rollback;
it may advertise only an explicitly available compatible read fallback. Crossing
into `v2_only` separately disables the remaining compatibility/facade writes and
records that boundary as well.

## Fresh Install Policy

During the compatibility period a fresh install receives the expanded schema
and V2 canonical seed. It has no backfill phase. If Public API v1 remains
supported, it operates as a compatibility adapter/facade and must not require a
second canonical V1 domain write.

Fresh-install CI must verify:

- migration from an empty database;
- idempotent seed/bootstrap;
- V2-only tenant creation and first message path;
- optional Public API v1 facade behavior;
- no legacy fallback or V1-only worker is required.

## Current Development Policy

`INB2-MIG-001` classified the current local database as `preserve`; it remains
the representative upgrade/reconciliation fixture. It must not be reset merely
because its data is test-shaped. A separate fresh personal/ephemeral target may
exercise guarded reset only with a disposable manifest/confirmation, exact
PostgreSQL/object evidence and stream-epoch rotation when required.

CI and release evidence now require both lanes: empty database -> clean V2
schema/seed/bootstrap/rebuild and representative V1 snapshot -> additive
upgrade/N-1 smoke/reconciliation/rollback.

## SaaS Shared And Isolated Policy

- schema expansion is deployment-wide, but materialization/read/dispatch modes
  are tenant/cohort scoped;
- migration workers use bounded batches, tenant leases and resumable checkpoints;
- one bad tenant pauses that tenant and does not authorize skipping its errors or
  blocking unrelated tenant processing indefinitely;
- authorization and telemetry stay tenant-scoped;
- isolated SaaS uses the same core state machine and evidence, with its own
  maintenance/release window;
- control-plane may schedule a managed cohort but never owns or copies customer
  inbox data.

## On-Prem Policy

- the package ships migration/preflight/report commands and all required local
  assets; it does not call SaaS control-plane for inbox data;
- operator explicitly selects the local deployment manifest and backup;
- PostgreSQL migrations run once under a migration lock before incompatible app
  services start;
- unsupported version jumps require documented intermediate releases rather
  than best-effort transformation;
- feature-control records and shadow reports remain local and export only when
  the customer chooses;
- upgrade is refused when backup, disk capacity, schema source version,
  encryption material or required object-store access is not valid;
- rollback/restore instructions name compatible application, schema, object
  storage and config versions.

No on-prem release may use a hidden SaaS-only migration service or require a
remote flag change to restore service.

## Deployment Pipeline Requirements

The current production workflow runs `pnpm db:migrate` before recreating
services and has no Inbox V2 backup/restore gate. Before the first preserving V2
production/on-prem upgrade, downstream implementation must add:

- schema/source-version preflight and supported-path check;
- one migrator lock;
- PostgreSQL backup plus real MinIO/S3 snapshot/versioned-backup identifiers and
  restore-verification evidence; object manifest alone is insufficient;
- expand-only migration classification for normal deploys;
- N-1 API read/write/worker/startup smoke against the expanded database, with
  online-DDL lock/statement budget evidence;
- separately approved contract/destructive migration job;
- migration/backfill status and blocking-diagnostic check;
- old/new app compatibility matrix;
- post-deploy V1/V2 health, projection and fallback smoke;
- abort behavior that leaves old services usable after an expand failure.

Automatic generic deploys must not execute `INB2-MIG-007` destructive SQL.

## V1 Disable And Deletion Criteria

For a future newly proven disposable fast-path target, internal V1 may be
disabled and removed after its fresh eligibility evidence, the required V2
vertical slice and Telegram private/group scenarios pass, all internal
producers/consumers are switched, provider-side effects are reconciled and clean
V2 install/reset/rebuild plus full checks pass. No calendar observation window
is required for that isolated target. This paragraph does not apply to the
current preserve disposition.

The remaining criteria in this section apply to preserve deployments:

Internal V1 reads/writes/dispatch/fallback may be disabled only when:

- `INB2-MIG-001` inventory has no unexplained dependency;
- every preserved tenant is backfilled or explicitly excluded with an approved
  migration disposition;
- blocking diagnostics are zero;
- required semantic shadow reports have zero unexplained differences;
- V2 projection/realtime/source/provider gates pass;
- RBAC dry-run shows no broadened authority;
- canary and wider cohort windows pass;
- rollback drills for read and dispatch authority pass;
- legacy-use counters are zero for the required window.

V1 code/schema is removed only when, in addition:

- all required release gates through `INB2-MIG-006` are done;
- ADR 0015 retention/PII/legal-hold/export/delete/audit policy is approved and
  its applicable V1 data/hold/delete graph is verified;
- internal V1 use has stayed zero for at least `30` consecutive days;
- all supported on-prem/isolated upgrade paths can cross the removal release;
- deployment inventory contains no unknown/unregistered supported instance;
- a clean install and representative V1 upgrade both pass;
- backup/restore and stream epoch/generation reset are rehearsed;
- public v1 contracts are either served by a V2 facade or have completed their
  independent `90`-day minimum deprecation policy;
- repository, runtime image and deployment searches show no accidental V1
  implementation dependency.

These bullets are one early V1-applicable removal subgate owned and signed by
`INB2-MIG-006`; `INB2-MIG-007` cannot start from an older or incomplete dossier.
Later `INB2-OPS-007/009` productize the backup/fleet capabilities and reuse this
evidence for production-readiness gates. They are deliberately not prerequisites
of MIG-006/MIG-007, which avoids a dependency cycle through post-removal epics.

Removing V1 implementation does not authorize deleting held or still-required
audit/history, nor retaining expired payload copies. Physical cleanup runs
through ADR 0015 lifecycle handlers/evidence rather than cascade/reset.

## Verification Contract

Architecture verification for this strategy requires review against current
contracts/schema/API/worker/web/deployment paths and the Inbox V2 ADRs.

All paths must verify:

- fresh empty database migration and bootstrap;
- fast-path eligibility or an explicit preserve disposition for every scoped
  deployment/data copy/consumer;
- exactly one provider dispatch authority and uncertain-attempt reconciliation;
- V2 projection/realtime rebuild and clean removal/deployment search;
- external Public API version behavior if retained.

The preserve path must additionally verify:

- representative V1 snapshot upgrade, interruption and idempotent rerun;
- ambiguous author/thread/route/roster/grant diagnostics;
- concurrent writes around backfill high-water/catch-up;
- one-command dual materialization and duplicate idempotency races;
- no provider call from shadow mode;
- exactly one dispatch authority across a mode transition;
- authorization-equivalent V1/V2 shadow queries with no PII telemetry leak;
- read/realtime canary rollback and client generation reset;
- V2-only rollback refusal after the compatibility mirror is incomplete;
- shared SaaS tenant isolation and bounded migration batches;
- isolated/on-prem explicit migration, backup and restore without control-plane;
- destructive-removal clean install and supported upgrade path.

## Approval Checklist

- [x] Fresh install uses V2 canonical state and no fake backfill.
- [x] The conditional direct replacement required explicit disposable/
      no-consumer inventory; MIG-001 rejected it and recorded preserve. Reset is
      never inferred from environment or rows.
- [x] Shared/isolated SaaS and on-prem preserve data by default.
- [x] Compatibility separates external API versions from internal V1 code.
- [x] An eligible pre-production path skips compatibility infrastructure and
      calendar windows while retaining versioned contracts.
- [x] Dual materialization has one command and one provider-I/O authority.
- [x] Backfill has deterministic mappings and explicit ambiguity diagnostics.
- [x] Shadow comparison is semantic, tenant-safe and side-effect free.
- [x] Server-owned modes reject illegal read/write/dispatch combinations.
- [x] Rollback boundaries and the representability point of no V1
      command/source return are explicit.
- [x] Observation/deprecation windows and V1 deletion criteria are explicit.
- [x] Current deployment pipeline gaps are assigned to downstream tasks.
