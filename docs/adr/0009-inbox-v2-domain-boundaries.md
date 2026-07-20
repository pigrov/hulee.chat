# ADR 0009: Inbox V2 Conversation, WorkItem, CRM And User-State Boundaries

## Status

Accepted.

`INB2-BASE-001` and `INB2-ARCH-001` were verified before acceptance and are
recorded in the canonical backlog.

## Date

2026-07-10.

## Context

Hulee must present one inbox for:

- external messenger direct and group threads;
- groups containing several clients and several employees;
- external provider groups containing only employees;
- internal employee direct and group chats;
- support/intake work;
- calls, reviews, marketplaces, classifieds, forms and future source items.

Current Inbox V1 stores one `clientId`, queue and assignment fields on
Conversation, represents participants as employee IDs and represents the
selected inbox as one client-centric snapshot. That shape cannot model
clientless internal chats, several clients in a provider group, exact source
thread routing or historically correct responsibility/CRM reporting.

RIK proves many provider/message capabilities but also shows the cost of
combining external transport thread, client dialog, operational intake and
internal collaboration in one overloaded Conversation model. Hulee must keep
those lifecycles explicit before implementing direct messenger parity.

The source integration ADR already establishes that messages, calls, leads,
reviews and other source events pass through a provider-neutral source pipeline.
The Inbox V2 domain must preserve that broader model rather than make every
source a messenger chat.

## Decision

Inbox is a projected product surface. It is not a canonical aggregate.

Canonical state is separated into Conversation, WorkItem, Client CRM and
EmployeeConversationState. Source transport and participant identity are also
separate boundaries completed by follow-up ADRs.

### Conversation owns the durable timeline

Conversation is a tenant-owned ordered timeline container. It owns:

- stable conversation ID;
- topology and internal/external transport classification;
- purpose/lifecycle metadata;
- monotonic timeline sequence and conversation revision;
- participant membership references;
- typed TimelineItems and their ordering.

Conversation does not own:

- a mandatory or scalar Client;
- client pipeline stage, client owner or custom CRM fields;
- queue, SLA, current responsible or assignment history;
- employee-specific read, mute, pin, archive or draft state;
- SourceConnection, SourceAccount, ExternalThread or SourceThreadBinding
  lifecycle/capability state;
- provider-specific capability branches.

This is logical ownership, not one unbounded in-memory aggregate. TimelineItems,
large membership sets and projections are persisted/queryable independently.
An ordinary Conversation command must not load the full timeline, roster,
Client-link collection, WorkItem history or per-employee state.

Every inbox-visible communication/source timeline uses a Conversation as its
canonical timeline container. Calls, reviews, marketplace questions and other
non-chat inputs create typed TimelineItems; they are not converted into fake
text Messages.

Shared Conversation lifecycle is the closed `active`/`ended` communication
continuity state. A personal archive/hide operation belongs to
EmployeeConversationState and cannot end or archive the Conversation for other
employees. Reactivation from `ended` is an explicit revisioned transition that
preserves the exact Conversation/ExternalThread identity.

### WorkItem owns actionable operations

WorkItem is a tenant-owned operational aggregate. It owns:

- exactly one parent Conversation;
- queue and operational routing state;
- lifecycle such as new, assigned, in progress, waiting, resolved or dismissed;
- priority and SLA/business-hours inputs;
- exactly zero or one active primary responsible employee according to state;
- temporal assignment/transfer history;
- resolution, dismiss and reopen reason/history;
- optimistic version for concurrent claim/transfer commands.

A Conversation has zero to many WorkItems over its lifetime. Inbox V2 permits
at most one non-terminal WorkItem per Conversation. After terminal state,
routing policy either reopens that WorkItem or creates a new sequential
WorkItem; those are different operations and neither changes Conversation
identity.

Internal employee direct/group Conversations have no WorkItem by default. An
explicit command can create a support/work item when the internal discussion
becomes actionable.

A `new` WorkItem has no active primary and is safely owned by a queue; claim or
policy assignment atomically enters `assigned`. States requiring human ownership
have exactly one effective primary responsible outside the explicit Employee-
draining recovery overlay. Terminal states close the active assignment while
preserving event-time history. Queue member,
collaborator, watcher, supervisor and participant are different roles.

ADR 0013 adds one cross-aggregate safety fence without moving WorkItem
ownership: an open assignment is effective only while its referenced Employee
assignment-eligibility fence remains active/current. Entering Employee
`draining` immediately makes affected WorkItems derive the
`responsibility_recovery_pending` safety overlay. WorkItem still owns its
canonical lifecycle/assignment rows, but every command reads the Employee fence
transactionally rather than trusting an eventual projection. Bounded recovery
closes assignment history at the immutable fence time and requeues/transfers the
WorkItem. This is the only allowed temporary overlay on the human-ownership
invariant and cannot authorize normal responsible-only actions.

`intake` is a WorkItem classification/qualification state, not a Conversation
type or identity. Qualification links/creates Client context and advances
WorkItem/CRM state while preserving Conversation and timeline identity.

### Client CRM owns customer state

Client is an independent tenant-owned CRM aggregate. It owns:

- Client and ClientContact identity;
- pipeline/current stage and append-only transition history;
- client owner and temporal owner history;
- typed custom fields, tags and source attribution;
- merge/link history, audit and CRM permissions.

Conversation links to zero, one or many Clients through an explicit
many-to-many relationship with role, provenance/confidence, actor and
timestamps. A primary Client link is optional and explicit; it is never required
for Conversation identity.

One link ID is one temporal attribution episode. Unlink ends that episode;
relink or role/confidence/provenance change creates a new ID. A per-Conversation
link-set head and append-only CAS transitions own the optional current primary
pointer and atomic multi-link/primary handoff. Primary is not a role and never
becomes Conversation identity, routing, access, Client ownership or WorkItem
responsibility.

Client merge is not one tenant-wide in-memory graph. It stores one current
root/redirect node row per Client, one tenant merge-head CAS fence and one
immutable row-wise redirect event per merge. A merge command requires its exact
requested source and target to still be two different current canonical roots;
it never silently canonicalizes an alias and merges a larger component than the
operator selected. A non-root/stale request conflicts and must be re-read and
confirmed. The transaction locks both roots, verifies the source component
maximum inbound depth, links the source root to the target root and advances
the target depth plus tenant head atomically. A bounded deterministic merge-
commit contract ties both exact before rows and head to the only legal source-
redirected/target-root/head after state; individually valid node rows are not a
commit proof. This root-to-root rule and the bounded depth projection prove
acyclicity without loading every historical merge. Current CRM resolution reads
an authoritative MVCC path of at most 64
redirect edges at an exact merge-head revision; bounded batches resolve only a
current page of Conversation links. It never loads all tenant merge history,
rewrites historical Conversation links or grants access to the canonical
Client. Paged readers restart if either the Conversation link-set revision or
tenant merge-head revision changes.

Each Client in a group has independent pipeline, owner and fields. WorkItem
primary responsible does not automatically change Client owner, and Client
owner does not automatically claim current work.

Different Telegram, WhatsApp, MAX, call and marketplace threads for the same
Client remain separate Conversations. Client profile/read models can aggregate
them without merging their reply route, read state or timeline.

### EmployeeConversationState owns personal state

EmployeeConversationState is keyed by tenant, Conversation and Employee. It
owns:

- monotonic last-read sequence;
- a separate manual-unread marker;
- mute/notification preference for the Conversation;
- pin/archive/hide state;
- draft and last-opened metadata where required.

Employee read state is not shared Conversation state and is not a provider
delivery/read receipt. Provider receipts belong to message transport delivery
records.

### InboxEntry is a projection

InboxEntry is a per-employee read model built from canonical events. It can
project:

- an actionable WorkItem with Conversation head/client/source context;
- an internal Conversation without a WorkItem;
- unread/mention/pin/mute and filter/sort fields.

InboxEntry can be rebuilt. Commands never mutate it as the source of truth.
Sidebar and active timeline consume the same versioned Conversation/Timeline
entities and stream cursor rather than maintaining unrelated client copies.

### Cross-boundary changes use commands and durable events

Every field is changed only through its owning aggregate. One application use
case can coordinate several aggregates, with exact transaction/ordering rules
deferred to `INB2-ARCH-005`. Important changes emit versioned tenant-scoped
events through the transactional outbox. Examples:

- source event creates/updates Conversation participants and TimelineItem;
- routing creates/reopens WorkItem;
- claim/transfer changes WorkItem and assignment history;
- identity resolution adds/updates Conversation-Client links;
- Client stage change updates CRM history;
- read command advances EmployeeConversationState;
- projections, notifications and reporting consume those durable events.

Cross-boundary state is not maintained through silent direct writes between
repositories. Derived projections can be eventually consistent but expose
revision/cursor information and rebuild/reconciliation paths.

### Notification state is a separate domain

EmployeeConversationState owns read cursor and conversation-specific
preferences. A separate notification domain owns logical notification feed,
temporal Conversation/exact-WorkItem WatcherSubscriptions, recipient/reason
dedupe and endpoint deliveries/retries. Watchers never grant content authority
and an exact-WorkItem subscription ends at terminal state. Conversation and
WorkItem do not store device endpoint or delivery state, and provider read
receipts are not notification/read-cursor state.

## Invariants

- Every entity, command, event, job, stream update, query and storage key is
  tenant-scoped.
- Conversation can exist without Client, WorkItem or external source binding.
- Every WorkItem belongs to exactly one Conversation.
- Inbox V2 allows at most one non-terminal WorkItem per Conversation.
- One WorkItem has at most one active primary responsible; owned processing
  states require exactly one, except that an Employee draining fence immediately
  makes the stored assignment ineffective and exposes the explicit
  `responsibility_recovery_pending` safety overlay until bounded recovery.
- Client stage/owner is never represented by Conversation or WorkItem status.
- Employee read/mute state is never represented by shared Conversation fields.
- Internal/staff-only TimelineItems cannot create provider delivery.
- Non-chat items retain typed payloads and do not become text-only Messages.
- Different external threads are not merged only because they link to one
  Client.
- Client merge joins different current canonical roots only; the resulting
  maximum inbound depth cannot exceed 64 and resolution never needs complete
  tenant history.
- Every committed merge atomically matches its deterministic before/after node
  and tenant-head transition; standalone valid rows cannot substitute for that
  commit invariant.
- Projections/reports cannot rewrite historic author, responsible, queue or
  client-stage attribution from current rows.

## Persistence And Constraint Consequences

The V2 schema requires separate tenant-owned tables or equivalent boundaries
for:

- Conversations and conversation head/revision;
- WorkItems and temporal assignment history;
- Conversation-Client links;
- Client merge node state, tenant CAS head and immutable paged redirect events;
- EmployeeConversationState;
- typed TimelineItems and message-specific lifecycle/transport details;
- rebuildable inbox and analytics projections.

Database constraints should enforce same-tenant relationships, one
non-terminal WorkItem per Conversation and one active primary assignment per
WorkItem. Application policy and tests still validate permissions and lifecycle
transitions.

## Compatibility And Migration

ADR 0016 now owns the active decision. On `2026-07-20` the product owner
classified every current environment/data root as disposable test state, so V1
is removed without data migration, dual implementation or a preserve bridge.
ADR 0014 remains the historical fail-closed design for the period before that
authority was known and for any future real-data upgrade analysis.

This implementation decision does not remove schema/event/realtime/module or
public API version fields. No ambiguous legacy author, route or group roster is
imported into the clean baseline. Detailed reset, deletion and future
post-release migration boundaries live in
`docs/product/inbox-v2-migration-and-cutover.md`.

## Consequences

Positive:

- internal chats do not need fake Clients or assignments;
- group chats support several Clients, employees and unresolved identities;
- one responsible operator is enforceable without changing membership;
- long-lived external threads can produce sequential work history;
- CRM funnel and client owner history remain correct across several channels;
- personal unread/mute state scales per employee and synchronizes across devices;
- calls/reviews/marketplace items fit one inbox without messenger-only core;
- manager reports can use immutable event-time attribution;
- projections and clients can reconcile by revision/cursor.

Costs:

- more explicit tables/contracts/events than the current V1 vertical slice;
- cross-boundary workflows require idempotent commands and outbox events;
- the current V1 removal must follow ADR 0016 and the clean-slate gate;
- projection rebuild/reconciliation and migration diagnostics become required
  operational features;
- product teams must use precise status/owner vocabulary rather than one generic
  Conversation status.

## Rejected Alternatives

### Keep client, queue, assignment and intake on Conversation

Rejected because lifecycle and cardinality conflict for internal chats,
multi-client groups, sequential cases, CRM ownership and manager reporting. It
also repeats the complexity observed in RIK.

### Make InboxEntry the canonical aggregate

Rejected because InboxEntry is employee/filter-specific, rebuildable and
eventually consistent. Using it as canonical state would couple domain commands
to UI folders/projections and multiply state across employees.

### Merge every channel for one Client into one Conversation

Rejected because reply routes, provider capabilities, membership, read state,
history and lifecycle are source-thread-specific. Client aggregation belongs in
the Client view/reporting layer.

### Require a WorkItem for every Conversation

Rejected because internal collaboration and employee-only external groups do
not always represent operational work. A WorkItem is created explicitly or by
actionability policy.

### Allow WorkItem to point directly to arbitrary source objects without Conversation

Rejected for Inbox V2 because it would require separate timeline/read/realtime
models for calls, reviews and marketplace items. A Conversation is the common
timeline container; typed TimelineItems preserve source-specific semantics.

### Store employee read state as per-message read rows only

Rejected as the primary internal read model because a monotonic per-employee
sequence cursor is simpler and cheaper for large timelines. Provider
per-recipient receipts remain separate where available.

## Relationship To Existing ADRs

- ADR 0001: all boundaries stay in the same core for SaaS and on-prem.
- ADR 0002: provider differences remain in adapter contracts/modules.
- ADR 0003: every new entity/relationship/event is tenant-scoped.
- ADR 0004: Inbox UI uses i18n/design tokens and quality gates.
- ADR 0005: normalized app-shell/realtime state is shared by web/mobile/desktop.
- ADR 0006: all Inbox V2 business/customer data stays in the data-plane.
- ADR 0007: core inbox functionality is not gated by ad hoc plan checks.
- ADR 0008: source events materialize typed Conversation timeline items through
  the provider-neutral source pipeline.

## Follow-Up Decisions

- `INB2-ARCH-003`: participant, external identity and message authorship model.
- `INB2-ARCH-004`: canonical external-thread identity and outbound routing.
- `INB2-ARCH-005`: sequence, revisions, snapshot cursor and realtime recovery.
- `INB2-ARCH-006`: detailed responsibility/RBAC matrix.
- ADR 0015 / `INB2-CON-010`: retention, PII, export/delete, legal hold and audit
  contracts.
- `INB2-ARCH-009`: Inbox V1 migration, compatibility, cutover and rollback.
