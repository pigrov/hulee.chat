# ADR 0014: Inbox V1 To V2 Migration And Cutover

- Status: Superseded by ADR 0016 for the current pre-production epoch
- Date: 2026-07-10
- Owners: Product and platform architecture
- Decision task: `INB2-ARCH-009`
- Detailed runbook contract:
  `docs/product/inbox-v2-migration-and-cutover.md`

> Historical decision notice (`2026-07-20`): the product owner classified all
> current environments and data as disposable test state and removed every V1
> migration obligation. ADR 0016 and disposition
> `clean-slate-2026-07-20-r1` now govern the active transition. The preserve
> design below remains only as decision history and as a reference for future
> real production upgrades; it is not an active Inbox V2 dependency.

## Context

Inbox V1 is a working compatibility slice, but its model cannot represent the
accepted Inbox V2 boundaries:

- every V1 Conversation assumes at most one scalar Client;
- queue/team/assignee are mutable Conversation fields rather than WorkItem and
  temporal responsibility;
- Message has no durable participant author, exact source binding/route,
  sequence, revision, lifecycle or provider occurrence;
- current external routing derives a destination from Client contact state;
- the inbox is refresh-based and has no resumable revision/cursor protocol;
- V1 `message.sent` is both a dispatch intent name and an apparent fact;
- provider/session foundations exist, but direct message runtime is not yet V2.

V1 data therefore cannot be copied mechanically into V2 without inventing
identity, authorship, provider route, roster, responsibility or delivery facts.
At the time of the original preserve-path decision, Public API v1, Telegram Bot,
web inbox, workers and potentially existing deployments had to continue working
during implementation. The amendment below made direct replacement conditional
on inventory; the completed inventory rejected that fast path.

The current production workflow applies database migrations before replacing
application containers. It has no complete Inbox V2 backup/restore gate. Normal
migrations must therefore remain additive and compatible with the previous
application release until a separate contract/removal release.

Hulee uses one core for shared SaaS, isolated SaaS and on-prem. On-prem data
plane migration cannot depend on permanent SaaS control-plane connectivity.

## Conditional Pre-Production Fast Path (Historical Proposal)

On `2026-07-11` the product owner confirmed that Hulee had not entered
production and did not need two long-lived internal Inbox implementations. The
proposed target was therefore a **conditional pre-production direct
replacement**: build one complete V2 vertical slice, switch every internal
Inbox producer/consumer to it, then remove V1 before expanding WhatsApp/MAX,
notifications, CRM and reporting. This proposal is retained as decision history;
it is not the current disposition.

This fast path was conditional. `INB2-MIG-001` had to prove all of the
following:

- no supported production, isolated SaaS or on-prem installation exists;
- no external consumer has been promised the current Public API v1 semantics;
- every database, object-store copy, cache, backup and log in scope is empty or
  explicitly classified as disposable and contains no real customer data,
  legal hold or required audit/evidence;
- no active V1 provider session, listener, dispatch attempt or uncertain outbox
  effect must be preserved;
- repository and deployment inventory contains no unknown V1 consumer or
  installation.

When all conditions pass, dual materialization, V1 compatibility projection,
backfill ledger, semantic shadow, `v1Representable`, V1 rollback and the
calendar observation/deprecation windows below are not required. Cutover and
deletion remain explicit reviewed steps, but may occur in one pre-production
work package without a soak clock. If any condition fails or a real deployment/
consumer appears before deletion, the full preserve path in this ADR becomes
mandatory automatically.

### INB2-MIG-001 outcome

Read-only repository, runtime, PostgreSQL, MinIO and backup inventory completed
on `2026-07-16` found a live shared SaaS deployment, non-empty V1, API/session/
provider, object and backup state, and no authoritative fleet/external-consumer/
off-host-backup registry. The current local database also has pending outbox
work and governance/hold fixtures.

The conditional fast path therefore failed and the additive `preserve` path in
this ADR is active. The earlier product intent to avoid a permanent V1/V2
platform remains valid: compatibility exists only until the preserving backfill,
cutover, observation and removal gates pass. It is not disposal authority.
Detailed evidence and downstream ownership are recorded in
`docs/product/inbox-v2-mig-001-inventory-and-disposition.md`.

Contract versioning is not removed by this decision. Persisted events, module/
adapter APIs, realtime envelopes and public APIs remain versioned. Public API
`/v1` means the first public contract and is independent of the obsolete Inbox
V1 implementation; while unpublished it may be remapped directly to V2 or
changed without a compatibility facade. Only a future separately approved
disposable deployment whose fast-path evidence remains current may collapse
internal `InboxV2` naming to neutral `Inbox` naming without compatibility
aliases. The selected preserve path keeps persisted/published IDs and migration
history stable or changes them through an explicit versioned compatibility
migration.

## Decision

For a deployment classified `preserve`, Inbox V2 migration remains one-way and
additive:

```text
inventory/classify
  -> backup/preflight
  -> expand
  -> one-command dual materialization
  -> repeatable diagnostic backfill
  -> semantic shadow reconciliation
  -> fenced V2 command/read/source canaries
  -> V2 primary observing
  -> V2 only
  -> disable V1 runtime
  -> observe
  -> contract/remove V1
```

### Environment disposition

Every deployment is explicitly classified as:

- `empty`: verified empty business state; install V2 without backfill;
- `disposable`: operator-approved destructive development/test state;
- `preserve`: additive upgrade and backfill.

Missing or uncertain classification means `preserve`. `NODE_ENV`, deployment
type, low row count or seed-looking data never authorizes reset.

- fresh empty installs initialize V2 as canonical;
- ephemeral CI may reset, but now also keeps the representative V1 upgrade lane
  required by the selected preserve path;
- `INB2-MIG-001` classified the current local development database as
  `preserve`; it is the upgrade/reconciliation fixture. A different personal
  local target may be `disposable` only through fresh exact evidence;
- shared/isolated SaaS and existing on-prem are always preserved;
- unknown on-prem versions require inventory and possibly an intermediate bridge
  release, never best-effort direct upgrade.

### One canonical command and one side-effect owner

Dual materialization is not symmetric dual write. One authorized, idempotent
command owns a mutation. It persists canonical V2 facts and, while needed, the
minimum V1 compatibility projection in one transaction or through a durable
transactionally-enqueued compatibility intent.

Provider I/O has exactly one fenced owner per binding/generation. Shadow reads,
backfill and compatibility projection cannot send, notify, update read state,
start SLA or perform provider health/action side effects.

Normal deploy migrations are expand-only and N-1 compatible: no destructive
DDL, incompatible V1 enum/semantics, blocking rewrite or immediate tightening.
N-1 API read/write/worker/startup smoke must pass against the expanded database.
Preserving releases require both PostgreSQL backup and a real recoverable
MinIO/S3 snapshot/versioned backup; an object manifest alone is not backup.

### Server-owned rollout state

Rollout uses one revisioned, audited server state machine:

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

Employee/application cohorts may select read/UI/realtime canaries only. Command
ownership is tenant/Conversation-sticky. Listener checkpoints and dispatch are
fenced per SourceConnection/SourceAccount/binding. A client parameter, cookie or
entitlement cannot select write/dispatch authority.

Old v1 clients at `v2_command_primary` become adapters into the same V2 command
service and receive a V1 compatibility projection.

While `v1Representable=true`, that projection uses
`compatibilityWriteMode=complete_required` and must be complete enough for the
fenced reverse path. After the fence becomes false it uses
`facade_subset_only`: an approved V1/Public API read facade may retain a
compatible subset, but that subset is never command/source rollback authority.

`v1Representable` is a separate revisioned transactional fence. While true, any
command/event not fully representable in the V1 projection is rejected. Before
the first such command/event or before a SourceAccount/binding capable of such
traffic is handed off, the control transaction sets it false and command/source
rollback to V1 ends. Ingress, command materialization and pre-provider-I/O checks
use the same control revision, closing the group-event/handoff race.

Source handoff is `v1_active -> draining -> checkpoint_captured -> generation
CAS -> v2_active`. Draining stops new V1 claims; in-flight/uncertain attempts are
finalized or reconciled. Listener claim/checkpoint, pre-provider-I/O and finalize
all validate owner/generation. Reverse handoff uses a new generation. An
untrusted V1 cursor, including Telegram polling state advanced before successful
materialization, requires provider resync or controlled rewind/overlap with
exact dedupe; otherwise a blocking gap diagnostic is recorded.

### Conservative backfill

Stable tenant/entity IDs are preserved only for deterministic one-to-one
mappings. A durable MigrationRun/entity-map ledger makes bounded jobs resumable
and idempotent and accounts for every V1 row as mapped, skipped, ambiguous or
blocked.

Safe examples:

- V1 Conversation `clientId` becomes a Client link with migration provenance;
- Employee participant rows become Employee anchors with one synthetic migration
  membership episode;
- current queue/assignee/team may create a current WorkItem snapshot when a
  valid queue policy exists;
- without a configured migration Queue, an actionable Conversation is imported
  read-only/unclassified without WorkItem and blocks operational cutover;
- before dual materialization, each existing Conversation reserves a frozen
  legacy sequence prefix; backfill fills it by `(created_at, id)` and live V2
  writes start afterward, so published sequences are never renumbered;
- accepted Message IDs/content/direction/files are preserved or idempotently
  entity-mapped with explicit legacy/migration provenance;
- historical imports build projection state without new unread, notification or
  SLA side effects.

Forbidden inference:

- current Client/responsible is not Message author;
- first contact/connector is not an external thread or route;
- session reauth is not SourceAccount replacement;
- V1 `message.sent` or processed outbox is not provider sent/delivered proof;
- a queued Message with processed outbox and no attempt imports as
  `legacy_unresolved`, non-dispatchable, with no V2 dispatch/outbox; it blocks
  cutover until explicit reconciliation or a new manual send command;
- provider group roster, assignment history and route/message scope are not
  manufactured.

Unknown facts use `legacy_unknown`, read-only/unresolved state where required,
and stable diagnostics.

### Semantic shadow comparison

Shadow compares provider-neutral compatibility DTOs at a common tenant
checkpoint after V2 backfill/projection catch-up. It compares authorized entry
sets, Conversations, message cardinality/order/safe hashes, head/activity,
Client link, current WorkItem mapping, permissions, route classification and
delivery state.

It stores safe counts, reason codes and tenant-scoped keyed identifiers, not
message text, contact data, secrets or raw provider payloads. Expected
differences require a versioned owner/reason/expiry. There is zero tolerance for
tenant leakage, permission widening, lost/duplicate message, wrong route/account,
double send or skipped mandatory stream position.

### Rollback boundary

While `v1Representable=true`, rollback may switch server-owned read/command/
source authority through the fenced reverse path while leaving the additive
schema in place. In-flight/uncertain provider attempts are reconciled, never
blindly retried. Once the representability fence becomes false, only read/UI may
fall back to a V1-compatible subset; command/source rollback to V1 is forbidden
and recovery uses a prior V2-compatible release or roll-forward.

After V1 compatibility writes/schema are removed, recovery requires a tested,
coordinated application plus PostgreSQL/object-store/config restore. Restore or
incompatible rebuild rotates stream epoch/generation and forces client resync.
In-place down-migration is not the normal rollback mechanism.

Restore also follows ADR 0015: a newer erasure/legal-hold ledger is reapplied
before serving traffic so a rollback cannot resurrect deleted content, export
artifacts or identity mappings into active processing.

A tenant-local defect in shared SaaS never authorizes restoring the whole shared
deployment. Freeze/repair the affected tenant/source. Full restore is reserved
for confirmed deployment-wide catastrophe and must reconcile provider side
effects for every affected tenant.

### Compatibility and removal

Public API v1 is an external contract, not the Inbox V1 implementation. It may
remain as a tested facade over V2 after V1 tables/internal routes are removed.

The following minimum windows apply only to a `preserve` deployment or a
published/supported external contract. They do not apply after the
pre-production fast-path eligibility gate passes:

- read/dispatch canary: 7 consecutive days including a business-week cycle;
- wider managed cohort: 14 consecutive days;
- zero internal V1 read/write/dispatch/fallback before removal: 30 consecutive
  days;
- external Public API v1: at least 90 days after published deprecation and no
  supported client dependency;
- on-prem/native compatibility: at least 90 days or one documented supported
  release cycle, whichever is longer.

Time alone is insufficient: canaries also pass the normative workload/scenario
floor in `docs/product/inbox-v2-migration-and-cutover.md`, including private/
group inbound/outbound, attachment, reconnect, retry/uncertain and stream gap
cases for every required release surface.

Incidents, unexplained differences, rollback or fallback reset the affected
clock. On the preserve path, physical V1 removal is a separate release after
release gates, `INB2-ARCH-007`, deployment inventory, backup/restore drill, clean
install and representative upgrade evidence pass.

`INB2-MIG-006` owns one signed early V1-applicable removal dossier covering those
lifecycle, fleet, consumer, supported-upgrade, backup/restore and observation
criteria. `INB2-MIG-007` depends on that current dossier. Later operational tasks
productize the same capabilities but do not create a circular prerequisite for
removing the obsolete implementation.

## Consequences

Positive on the preserve path:

- production/on-prem data is never reset implicitly;
- V1 stays usable while V2 contracts/schema/projections are built;
- rollback is honest about the point where V1 can no longer represent state;
- provider messages cannot double-send because a cohort flag selected two
  writers;
- ambiguous history remains explicit instead of corrupting authorship, routing,
  RBAC or reports;
- external API version support is decoupled from internal implementation debt;
- one migration model works in SaaS and locally operated on-prem.

Costs when the preserve path is required:

- temporary V1 compatibility projection and migration control/ledger;
- bounded backfill, shadow comparison and diagnostics infrastructure;
- separate expand, cutover and destructive-contract workflows;
- backup/restore, source handoff and rollback drills before production cutover;
- some legacy rows remain unknown/read-only rather than fully feature-complete.

## Rejected Alternatives

### Reset every non-production database implicitly

Rejected because an environment label is not proof that data is disposable.
The accepted pre-production path permits an explicit guarded reset only after
inventory proves the fast-path conditions above.

### Infer reset from environment or row count

Rejected because configuration mistakes would make destructive behavior silent.

### Symmetric V1 and V2 dual write

Rejected because two command owners can diverge, duplicate side effects and make
authority/rollback unknowable.

### Random write or provider canary by client cohort

Rejected because retries and concurrent clients could route one Conversation or
provider binding through different owners. Cohorts are limited to reads/UI.

### Backfill author/route from current Client or assignee

Rejected because current CRM/responsibility facts are not historical transport
evidence and would corrupt audit/reporting.

### Replay the V1 outbox into V2

Rejected because processed V1 outbox is not proof of provider outcome and the
same intent may already have produced an uncertain side effect.

### Drop V1 in the same release as a preserve-deployment cutover

Rejected because it removes the normal application rollback path before the
observation window and restore drill. This rejection does not require a
calendar delay for the explicitly eligible pre-production fast path.

### SQL down-migration as standard rollback

Rejected because V2-only data cannot be represented safely in V1 schema.

## Implementation Ownership

- `INB2-DB-008`: clean V2 install/guarded reset plus the now-required additive
  V1-upgrade harness;
- `INB2-MIG-001`: completed repository/runtime/deployment inventory and preserve
  disposition;
- `INB2-MIG-002`: reviewed online schema bridge for any historical migration
  boundary rejected by preserve DDL preflight, followed by compatibility
  materialization;
- `INB2-MIG-003`: activated operational backfill;
- `INB2-MIG-004`: finalize the revisioned preserve disposition and build its
  shadow/rollout/authority controls;
- `INB2-MIG-005`: atomically revalidate that disposition and every applicable
  control before internal/Telegram cutover;
- `INB2-MIG-006`: pre-removal acceptance, required rollback drills and the signed
  early V1-applicable lifecycle/fleet/backup removal subgate;
- `INB2-MIG-007`: V1 implementation contraction/removal;
- `INB2-OPS-007`/`009`: later productization of packaged migration and
  backup/restore proof, reusing the MIG-006 dossier.

Completing this ADR makes the strategy reviewable; it does not mark any runtime,
database, provider or release gate complete.
