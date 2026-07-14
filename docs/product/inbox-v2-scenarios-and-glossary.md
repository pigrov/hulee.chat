# Inbox V2 Scenarios And Glossary

Status: `accepted`  
Backlog task: `INB2-ARCH-001`  
Decision date: `2026-07-10`

## Purpose

This document defines the product language and valid conversation/work shapes
for Inbox V2. It is the scenario-level input for domain contracts, database
constraints, provider adapters, UI state, notifications and reporting.

Detailed persistence choices for participants, external identities, source
bindings and realtime are completed by the following Inbox V2 ADR tasks. This
document fixes the product meaning and cardinalities those designs must support.

## Core Rule

One visual inbox does not mean one domain aggregate.

Inbox is a tenant-scoped read model that can list actionable WorkItems and
non-actionable internal conversations in one shell. Conversation, work
responsibility, client CRM, source transport and employee read state keep
separate ownership and lifecycle.

## Glossary

### Inbox

The product surface that combines external work, client conversations,
internal chats, support cases and future source items. Inbox is a projection and
command surface, not the owner of canonical message/client/work state.

### InboxEntry

A per-employee projected list item. It can represent:

- an actionable WorkItem attached to a Conversation;
- any accessible Conversation without a WorkItem, including internal chats and
  external employee-only/non-actionable threads;
- a future actionable non-chat source represented by a typed item in a
  Conversation timeline, optionally with a WorkItem.

Folders, filters, unread totals and sidebar order operate on InboxEntry
projections. They do not redefine Conversation identity.

### Conversation

A durable ordered communication/timeline stream. Conversation owns stable
identity, topology, purpose/lifecycle, monotonic sequence and participant
membership references. It does not own client pipeline stage, queue SLA,
current client owner or employee-specific read/mute state.

### Conversation topology

- `direct`: one-to-one communication by product invariant for the relevant
  internal scenario; an external provider can still expose account-scoped
  direct-thread semantics.
- `group`: a room with a changing set of participants.
- `case`: a native case/support interaction timeline when direct/group semantics
  do not describe the source.
- `object`: a timeline around a call, review, order, question, lead or another
  non-chat source object.

Topology describes shape. It does not imply whether a client exists.

### Transport origin

- `internal`: created and transported inside Hulee.
- `external`: bound to an external source thread/account.

An external group containing only known employees remains external because its
membership, history and send route are controlled by the provider.
Transport is immutable after Conversation creation. Moving between internal
and external transport requires an explicit new Conversation/cutover relation;
an in-place transport update cannot reclassify membership authority while a
command is in flight.

### Conversation purpose

An extensible namespaced business hint. Initial core IDs are `core:chat`,
`core:support` and `core:service`; module-owned additions use
`module:<module-id>:<purpose-id>` and are resolved fail-closed through the pinned
tenant catalog. A purpose remains a non-authoritative hint and never gains
lifecycle, assignment, CRM or delivery semantics from its local ID. Intake/
sales stages and assignment state belong to WorkItem/Client CRM, not to
Conversation identity.

### WorkItem

An actionable unit processed through a queue. WorkItem owns operational state,
priority, SLA, current primary responsible, transfers and resolution/reopen
history. Every WorkItem belongs to exactly one Conversation. A Conversation may
have no WorkItem or several WorkItems over its lifetime.

ADR 0013 Employee `draining` is a direct transactional safety fence: an open
stored assignment becomes ineffective and the WorkItem derives
`responsibility_recovery_pending` until bounded recovery closes history at the
fence time. Commands read the fence itself, never an eventual projection.

Inbox V2 permits at most one non-terminal WorkItem per Conversation. The model
must allow sequential historical WorkItems without replacing the Conversation.
Parallel non-terminal cases require a later explicit product decision and must
not be inferred from group participants.

### Queue

The operational destination that owns unassigned/actionable work. Queue is not
the same as a Team, Conversation membership or client owner.

### Queue member

An active Employee eligible under Queue policy. Queue membership can make a
role binding applicable and can satisfy assignment eligibility, but it grants
no list/read/claim/reply permission by itself.

### Servicing team

An explicit temporal team relation on one WorkItem used by routing and team
scope matching. It is not primary responsibility, Employee team membership or
a grant, and ends/changes with versioned WorkItem history.

### Primary responsible

The single employee operationally accountable for one active WorkItem.

- A new WorkItem is safely owned by a queue without an active primary.
- Canonical `new` has zero active primary; manual or policy assignment enters
  `assigned` atomically rather than leaving an assigned item in `new`.
- `assigned`, `in_progress` and `waiting` have exactly one effective primary,
  except the explicit `responsibility_recovery_pending` safety overlay after an
  Employee fence.
- Terminal `resolved`/`dismissed` has no active primary assignment; append-only
  assignment/resolution history keeps the event-time responsible snapshot.
- Collaborators, watchers, queue members and supervisors are not additional
  primary responsible employees.

### Client

A CRM person/organization record. Client owns pipeline state, client owner,
typed fields, tags and CRM history. Client is not automatically one chat
participant and is not Conversation identity.

### ConversationClientLink

A tenant-scoped temporal CRM attribution episode between one Conversation and
one Client. It carries bounded namespaced roles, association confidence, typed
provenance/evidence and audited decisions. The per-Conversation link-set head
owns the optional primary pointer under append-only CAS transitions. Neither a
link nor primary selection grants access, PII, participant/authorship, route,
ownership, responsibility, watcher/collaborator or WorkItem state.

### ClientMergeRedirect

An immutable same-tenant audit event recording that one current canonical root
was merged into another current canonical root at an exact tenant merge-head
revision. It is not a mutable pointer to whatever Client becomes canonical
later and is never collected into one lifetime-sized runtime aggregate.
Historical ConversationClientLinks retain their original Client reference;
current CRM resolution follows current ClientMergeNodeState rows through an
authoritative path and still requires independent authorization for the final
canonical target.

### ClientMergeNodeState

The current one-row-per-Client merge projection. A node is either a canonical
root or redirects to the next Client/immutable merge event. Canonical roots
carry the maximum inbound component depth. Merge commands join two different
exact requested current roots under a tenant CAS head, reject non-root/stale
requested Clients rather than silently merging their whole canonical component,
reject a resulting depth above 64 and update node state atomically. Resolution
paths are limited to 64 edges; the tenant lifetime number of immutable merge
events is not limited by a request batch size. A deterministic ClientMergeCommit
binds the exact before head/root rows to the only legal after head, redirected
source and updated target root; separately valid rows do not prove a merge.

### ClientContact

A contact point/person associated with a Client, such as phone, email or a
linked source identity. One Client can have many contacts; one Conversation can
contain contacts belonging to several Clients.

### SourceExternalIdentity (ExternalIdentity)

A provider/source actor identity observed in inbound/outbound events, for
example Telegram user, WhatsApp participant or marketplace customer ID. It can
be stable or explicitly observation-ephemeral according to the adapter
contract; weak/display evidence never makes an ephemeral identity globally
reusable.

Contracts/persistence use `SourceExternalIdentity` to distinguish it from the
existing authentication-provider-to-Account identity link. Its key and safe
canonicalization are scoped explicitly by the source adapter; an unscoped
username, display name or phone-like string is not an identity key.

An ExternalIdentity starts as unresolved and can later be claimed/linked to one
Employee or ClientContact according to identity policy. Original message
authorship and source evidence are retained after linking or merging.

### ConversationParticipant

The immutable conversation-local author/persona anchor with exactly one typed
subject: Employee, SourceExternalIdentity, authenticated ClientContact, bot,
system or legacy-unknown. Membership origins/episodes are separate and retained
after leave/removal. ADR 0010 deliberately keeps a claimed external Employee
persona distinct from that Employee's Hulee-app persona.

### SourceConnection

The tenant-level external integration, for example Telegram direct or an Avito
seller integration.

### SourceAccount

A concrete external account/resource inside a SourceConnection: direct user
session, phone number, shop, branch, mailbox or bot. Connector/session IDs are
provisional observations, not account identity. Promotion to a canonical
SourceAccount requires a pinned adapter realm/scope decision and an audited CAS;
reauth preserves the account, while a real provider-account replacement creates
a new one.

### ConversationAccessBinding

Temporal authorization metadata linking one exact Conversation to an org unit
or Team through trusted routing/source policy or an audited command. It is not
participant membership, WorkItem routing or provider roster evidence. A
Conversation can have zero-to-many active structural targets, with at most one
active relation per exact target and append-only history/revision.

### ClientAccessBinding

Temporal authorization metadata linking one exact Client to an org unit or
Team. It is not Client owner, linked-Conversation access or a relation inferred
from the owner's memberships. A Client can have zero-to-many active structural
targets, with at most one active relation per exact target and append-only
history/revision.

### ExternalThread

The canonical provider thread/room used to group related communication events.
Its exact key includes a versioned provider/adapter realm, provider object kind,
adapter-declared provider/connection/account scope and opaque canonical subject.
Core must not guess it from Client, sender, title or account order and must not
lowercase provider IDs.

### SourceThreadBinding

The link between one canonical Conversation/ExternalThread and a concrete
SourceAccount. It keeps account-local opaque destination, remote membership,
administrative enablement, runtime health, capabilities, cursors and revision as
separate facts. One external group may have several bindings when several
company accounts are members.

### ExternalMessageReference and SourceOccurrence

An exact adapter-scoped provider message key maps to one canonical TimelineItem.
Every account/webhook/poll/history/echo observation remains a SourceOccurrence,
so cross-account dedupe never discards raw evidence.

### OutboundRoute and OutboundDispatch

OutboundRoute is the immutable, server-authorized selection of exactly one
SourceThreadBinding plus its versioned opaque adapter destination. Dispatch and
all retries remain pinned to that route. Multi-send and reroute are explicit
separate commands; temporary health does not silently change accounts.

Each provider attempt pins retry-safety before I/O. A timeout or expired lease
with possible provider acceptance becomes `outcome_unknown`; a separate audited
reconciliation decision confirms the outcome or authorizes a new attempt on the
same route. It is never treated as success or blindly retried.

### SourceObjectReference

The canonical key for a non-chat source object such as call, review, listing,
order, question, lead or form submission. An object Conversation has exactly
one primary source-object key. SourceThreadBinding is used only when the source
actually exposes a thread and reply route.

### TimelineItem

An ordered typed item in a Conversation timeline. Supported families include
message, internal note, call, review, marketplace question/order event, lead,
participant change, assignment/status change and system event.

### TimelineSequence

The immutable server-assigned per-Conversation order/keyset of TimelineItems.
It is not provider time, receive time, event ID, entity revision or a source
history cursor. Edit/delete/delivery changes keep the original sequence.

### EntityRevision

The monotonic version of one mutable canonical or projected entity. It rejects
stale mutation/results and protects revisioned tombstones from resurrection.
Independent entities have independent revisions; revision is not the global
realtime order.

### TenantStreamPosition and client cursor

TenantStreamPosition is the server-side commit-safe total order of atomic Inbox
V2 change sets for one tenant. The client cursor is an opaque versioned token
over that position plus stream epoch, sync generation, actor/scope and ADR 0013
composite authorization epoch. Outbox order, timestamps and PostgreSQL
notifications are not cursors.
The primary scope is the Employee's complete authorized Inbox, not the current
folder, filter, page, selected Conversation or client cache.

### ProjectionCheckpoint and InboxSyncBatch

ProjectionCheckpoint is the highest contiguous tenant stream position applied
with projection rows in one transaction. InboxSyncBatch is the immutable,
recipient-filtered set of revisioned upserts/tombstones/invalidations scanned
between two client cursors. Snapshot, SSE and polling share this contract.

### Message

A TimelineItem with content blocks and message lifecycle. Message author,
trusted Hulee app actor, provider-observed actor, SourceAccount and
SourceThreadBinding are distinct facts.

### Staff-only internal note

A TimelineItem visible only to authorized employees. It is never eligible for a
provider delivery route or any client/public external API, webhook/export or
unauthorized realtime surface. It is delivered through the normal authorized
workforce Inbox snapshot/SSE/poll contract only after staff-note read checks.

### EmployeeConversationState

Per-employee state such as last-read sequence, manual-unread marker, mute,
notification level, pin/archive and draft. It is neither provider read receipt
nor shared Conversation state.

### Provider delivery/receipt

Transport facts for one message/binding/recipient where available: accepted,
sent, delivered, read or failed. Providers with no delivered semantic must not
receive a synthetic delivered state.

### DataLifecyclePolicy

A versioned ADR 0015 data-plane policy resolved by deployment/jurisdiction
profile, tenant, data class, processing purpose, canonical anchor, hold/
restriction and approved commercial envelope. It is not one Conversation TTL,
provider timestamp or entitlement flag.

### DataSubjectLink

A tenant-scoped discovery link from a classified data root to an Employee,
ClientContact, SourceExternalIdentity, Account or unresolved provider-scoped
subject, with role/provenance. It creates no principal, Client, participant,
membership, authorship rewrite, WorkItem or permission.

### LegalHold and ProcessingRestriction

LegalHold prevents policy purge for an approved finite-review case/scope but
grants no read/export authority and never retains usable credentials.
ProcessingRestriction limits allowed use while preserving only approved storage/
claim operations. Both are independent from RBAC and ordinary retention.

### PrivacyRequest and lifecycle deletion

A verified case for access/portability, correction, restriction, erasure,
objection or tenant offboarding, with per-root decisions and third-party
redaction. Provider Message delete, retention expiry and privacy erasure are
different operations. Physical deletion is a verified multi-store workflow, not
one `deletedAt` or cascade.

### Client owner

The employee responsible for the long-term CRM relationship. Client owner is
independent from WorkItem primary responsible and can differ for every Client in
a group.

### Collaborator

An Employee with an explicit temporal Hulee assistance relation on a
Conversation/WorkItem. A matching permission can allow read and staff-note
actions. Collaborator is not primary responsibility, Client ownership or
provider membership. Conversation collaboration and exact-WorkItem
collaboration have separate lifetime. External reply on active work is allowed
only for the primary/override by default or for an exact WorkItem collaborator
when a versioned Queue policy explicitly enables it.

### Watcher

An Employee notification subscription. Watcher is never an access grant or a
permission scope: the Employee must retain independent read authority, and
notification delivery is suppressed/removed when that authority is lost.
The notification domain owns temporal Conversation or exact-WorkItem watcher
subscriptions; WorkItem watch ends at terminal state and never carries to a
later WorkItem.

### Internal participant

An Employee participant with a current Hulee-origin membership episode in an
internal direct/group Conversation. This relation can scope internal read/send
permissions. A provider roster episode or identity claim never satisfies it.

### Scoped supervisor override

An exceptional operation made with the ordinary operation permission plus a
separate matching `work.override` permission and mandatory audited reason. It
is not inferred from a role name and cannot bypass tenant, inactive-target,
one-primary, internal-privacy, staff-only or source-route invariants.

## Orthogonal Classification

Inbox V2 does not use one archetype enum to encode every rule. The following
dimensions remain independent:

| Dimension      | Examples                                         | Owned by                     |
| -------------- | ------------------------------------------------ | ---------------------------- |
| Topology       | direct, group, case, object                      | Conversation                 |
| Transport      | internal, external                               | Conversation/source binding  |
| Purpose        | core:chat, core:support, core:service, module:\* | Conversation/WorkItem policy |
| Audience       | employees, external identities, mixed            | Derived from participants    |
| Actionability  | no WorkItem, new, processing, waiting, resolved  | WorkItem                     |
| Client context | zero, one, many clients                          | Conversation/client links    |
| CRM state      | lead, qualified, won, lost, custom stage         | Client pipeline              |
| Delivery       | pending, sent, delivered, read, failed           | Message transport delivery   |
| Read/mute      | last-read, mute, pin, manual unread              | EmployeeConversationState    |

## Compatibility With Current Product Terms

The current names remain useful as product scenarios, but are composed from V2
boundaries instead of persisted as one overloaded identity enum:

| Current term      | Inbox V2 composition                                                                         |
| ----------------- | -------------------------------------------------------------------------------------------- |
| `client_direct`   | external/direct Conversation with an explicit Client link                                    |
| `client_group`    | external/group Conversation with one or more Client links                                    |
| `internal_direct` | internal/direct Conversation between two Employee identities                                 |
| `internal_group`  | internal/group Conversation with Employee memberships                                        |
| `support_case`    | support-classified WorkItem linked to exactly one Conversation                               |
| `intake`          | new/qualification WorkItem and unresolved client context; not an immutable Conversation type |

Qualifying intake preserves Conversation, participant and timeline IDs. It adds
or changes identity/client links and advances WorkItem/CRM state.

## Scenario Matrix

| ID        | Scenario                                             | Participants                                                                                                                                                                           | Clients                                        | External bindings                                                                         | WorkItem                                           | Primary responsible                              |
| --------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------ |
| `SCN-001` | Unknown external direct                              | One unresolved external identity plus optional internal collaborators                                                                                                                  | 0 initially                                    | One canonical ExternalThread; 1..N historical bindings; 0..N active send-capable bindings | Created in intake/default queue                    | 0 while new; exactly 1 in owned processing state |
| `SCN-002` | Known-client external direct                         | External identity linked to a ClientContact plus optional employees                                                                                                                    | Usually 1; model allows explicit related links | One account-scoped/provider-scoped direct thread                                          | Created/reopened by actionable inbound policy      | Same WorkItem rule                               |
| `SCN-003` | Mixed external group                                 | Changing external identities and internal collaborators/source-linked employees                                                                                                        | 0..N                                           | 1..N account bindings to one canonical provider group                                     | Created by customer/actionability policy           | One per active WorkItem, not one per client      |
| `SCN-004` | External employee-only group                         | External identities linked to employees and/or internal employee collaborators                                                                                                         | 0                                              | Provider group bindings                                                                   | None by default                                    | None by default                                  |
| `SCN-005` | Internal direct                                      | Exactly two immutable Employee participant anchors; 0..2 current membership episodes after ordinary lifecycle changes, while draining/deactivation closes the affected Employee access | 0                                              | 0                                                                                         | 0                                                  | 0                                                |
| `SCN-006` | Internal group                                       | At least two employees with owner/admin/member roles                                                                                                                                   | 0                                              | 0                                                                                         | 0 by default                                       | 0 by default                                     |
| `SCN-007` | Internal support case                                | Employee requester and authorized support employees                                                                                                                                    | 0 unless explicitly related                    | 0 for internal transport                                                                  | Required                                           | 0 while queued; exactly 1 while owned            |
| `SCN-008` | External support/service case                        | External participants plus support employees                                                                                                                                           | 0..N                                           | Source thread binding required                                                            | Required                                           | Same WorkItem rule                               |
| `SCN-009` | Intake qualification                                 | Same Conversation as the source thread; identity is unresolved                                                                                                                         | 0 until linked/created                         | Unchanged                                                                                 | WorkItem state is new/intake                       | May be unassigned in queue                       |
| `SCN-010` | Same client in several channels                      | Separate participants/threads per source                                                                                                                                               | Same Client linked to each Conversation        | Separate exact bindings                                                                   | Separate work lifecycles unless explicitly related | Independent per WorkItem                         |
| `SCN-011` | Same provider group through several company accounts | One logical provider roster; several account send/receive capabilities                                                                                                                 | 0..N                                           | Several bindings to one ExternalThread/Conversation                                       | At most one non-terminal by MVP policy             | One per non-terminal WorkItem                    |
| `SCN-012` | Call/review/marketplace question                     | Source-specific actors represented without fake messenger users                                                                                                                        | 0..N                                           | Exact call/object/thread key where applicable                                             | Only when actionable                               | One per active WorkItem                          |
| `SCN-013` | Multi-client external group                          | Changing external identities plus optional internal collaborators                                                                                                                      | 2..N explicit Client links                     | One canonical ExternalThread with 1..N bindings                                           | At most one non-terminal WorkItem                  | Exactly one when WorkItem is in owned processing |

## Scenario Requirements

### SCN-001. Unknown external direct

- Persist raw and normalized source evidence before materialization.
- Create/reuse an exact external thread independent of Client lookup.
- Create an unresolved ExternalIdentity and ConversationParticipant.
- Do not create a Client merely because a message exists.
- Route actionable inbound to a queue and create a WorkItem.
- Link/create a Client later without changing Conversation identity or rewriting
  message authorship.

### SCN-002. Known-client external direct

- Resolve the source identity to an existing ClientContact when evidence/policy
  allows.
- Reuse the exact external thread, not the latest conversation of that Client.
- Keep other Telegram/WhatsApp/MAX/public API threads separate.
- Reply through the binding of the opened/quoted source thread.

### SCN-003. Mixed external group

- Preserve sender identity per TimelineItem.
- Support several linked Clients and unresolved participants simultaneously.
- Preserve provider roster state, join/leave/admin events and partial-roster
  diagnostics.
- Treat provider membership and Hulee authorization as different concepts.
- One WorkItem primary responsible coordinates the current work; other employees
  can collaborate only according to RBAC.
- Client stage/owner remains per Client, never per group Conversation.

### SCN-004. External employee-only group

- Transport remains external even when every resolved human is an Employee.
- `employee-only` is derived and reversible. It is confirmed only when there are
  no Client links or unresolved human identities and roster evidence is
  sufficient; a partial roster remains unresolved.
- No fake Client, WorkItem or responsible is created by default.
- Native provider-app outbound is imported as outbound and does not trigger a
  client-inbound notification.
- A new unknown/client participant changes audience/routing classification in
  the same Conversation and triggers routing re-evaluation.
- An employee can explicitly create a support/work item when business action is
  needed.

### SCN-005. Internal direct

- At creation, require exactly two distinct Employee identities and use a
  deterministic tenant-scoped key derived from those IDs so a
  second authorized create command returns the same Conversation. Lookup/key
  construction is server-only and never reveals an existing direct to a caller
  who is not one of the two anchors.
- Leave/deactivation preserves the two-party identity/history and never converts
  topology; Employee draining closes that Employee's active membership/access,
  and no provider binding exists.
- UI mine/theirs is derived from author identity, not stored inbound/outbound.
- Read/mute/draft state remains per employee.

### SCN-006. Internal group

- Membership roles and join/leave history are explicit.
- An active group starts with the creator as owner and retains at least one
  active owner; last-owner removal/deactivation requires an active successor or
  explicit metadata-only `owner_recovery` without content access for recovery
  administrators.
- Internal group messages do not create provider delivery rows.
- No WorkItem/responsible exists unless an explicit work/support command creates
  one.

### SCN-007 and SCN-008. Support/service

- Support purpose does not replace topology or transport.
- WorkItem is required and owns queue, primary responsible, SLA and resolution.
- Conversation continues to own the communication timeline.
- Repeated support cases can produce sequential WorkItems on one long-lived
  Conversation.

### SCN-009. Intake qualification

- `intake` is a WorkItem/identity qualification state, not a Conversation type.
- Qualification can link an existing Client or create a new Client.
- Spam/duplicate decisions close/dismiss WorkItem with reason but preserve
  source/audit evidence according to retention policy.

### SCN-010. Same client in several channels

- Client profile aggregates links/timelines as a view.
- Message timelines are not automatically interleaved/merged into one send
  context.
- Every external reply has one explicit route.

### SCN-011. Same group through several accounts

- Adapter supplies canonical external-thread/message realms, object kinds,
  identity scopes and opaque route descriptors.
- Raw events from every account remain available for diagnostics.
- Cross-account provider echo/dedupe creates one canonical TimelineItem.
- Route policy selects one binding with membership/send capability; absence or
  ambiguity yields a stable error, never implicit fan-out.
- Explicit route failure does not fall through to another account; fallback or
  reroute requires an explicit allowed intent and audit.
- A pinned route changed/disabled before provider I/O makes no provider call;
  uncertain provider acceptance is reconciled before any unsafe retry.

### SCN-012. Non-chat source work

- Calls, reviews, questions, leads and order events are typed TimelineItems or
  typed source objects; provider payload is not inserted into message text.
- WorkItem is created only for an actionable event/policy.
- Reply capability can be native, external link, read-only, expired or
  unsupported.
- Metrics use source-specific grains while remaining visible in one Inbox.

### SCN-013. Multi-client external group

- The Conversation has two or more explicit Client links and can also contain
  unresolved identities and Employees.
- Each Client keeps an independent owner, pipeline stage and custom fields.
- Inbox V2 creates at most one non-terminal WorkItem for the Conversation, with
  one primary responsible when owned; it does not create one WorkItem per Client.
- Reporting uses an attribution bridge so Client linkage does not multiply the
  physical message count.

## Cardinality And Lifecycle Rules

| Relationship                                         | Rule                                                                                    |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Tenant -> Conversation                               | 1:N; every Conversation is tenant-owned                                                 |
| Conversation -> participants                         | 0:N globally; scenario rules define required minimums; left/removed history is retained |
| Conversation -> Clients                              | 0:N through explicit links                                                              |
| Conversation -> active primary Client link           | 0:1; primary is optional                                                                |
| Client -> Conversations                              | 0:N; source threads are not merged by Client                                            |
| Internal Conversation -> ExternalThread              | 0                                                                                       |
| External direct/group Conversation -> ExternalThread | exactly 1 historical canonical thread identity                                          |
| ExternalThread -> SourceThreadBindings               | 1:N; each binding belongs to one SourceAccount                                          |
| Object Conversation -> primary SourceObjectReference | exactly 1                                                                               |
| Conversation -> TimelineItems                        | 0:N with unique monotonic sequence                                                      |
| Conversation -> WorkItems                            | 0:N over lifetime; MVP at most one non-terminal WorkItem                                |
| WorkItem -> Conversation                             | exactly 1                                                                               |
| WorkItem -> current Queue                            | exactly 1 for every non-terminal WorkItem; transfer changes it atomically               |
| WorkItem -> Queue/routing history                    | 1:N temporal/append-only; terminal work retains the final route snapshot                |
| WorkItem -> current servicing Team                   | 0:1 explicit temporal relation; never inferred from assignee membership                 |
| Conversation -> active structural access bindings    | 0:N; unique per exact org-unit/Team target                                              |
| Client -> active structural access bindings          | 0:N; unique per exact org-unit/Team target                                              |
| WorkItem -> active primary responsible               | 0 while new/unassigned; exactly 1 in owned processing states                            |
| WorkItem -> assignment history                       | 0:N temporal/append-only                                                                |
| Conversation + Employee -> EmployeeConversationState | 0:1                                                                                     |
| ExternalIdentity -> active canonical claim           | 0:1 Employee or ClientContact; conflicting evidence is not auto-resolved                |
| Message -> outbound route                            | exactly 1 for normal external send; 0 for internal/staff-only                           |

## State Namespace Rules

These states must not be represented by one shared `status` field:

| Namespace/owner            | Initial vocabulary or shape                                                                       | Contract owner                     |
| -------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Conversation lifecycle     | closed `active`, `ended`; personal archive/hide is not Conversation lifecycle                     | `INB2-CON-002`                     |
| Participant membership     | closed `active`, `pending`, `left`, `removed`; origin episodes remain separate                    | `INB2-CON-003`                     |
| WorkItem lifecycle         | closed `new`, `assigned`, `in_progress`, `waiting`, `resolved`, `dismissed`                       | `INB2-CON-006`                     |
| Client pipeline            | opaque tenant-scoped `ClientStageId`; definitions carry initial/terminal/won/lost semantics       | `INB2-CRM-002`                     |
| Client record lifecycle    | separate from pipeline stage and Conversation/WorkItem lifecycle                                  | `INB2-CRM-001`                     |
| Message/revision lifecycle | versioned edit/delete/current/tombstone semantics; provider delete and privacy purge are separate | `INB2-CON-007`                     |
| Content lifecycle          | ADR 0015 availability/restriction/hold/purge vocabulary                                           | `INB2-CON-010`                     |
| Transport delivery         | provider-honest pending/accepted/sent/delivered/read/failed capabilities, never synthesized       | `INB2-CON-007`                     |
| Employee read/notification | monotonic sequence plus independent manual unread/mute/pin/archive fields, not one enum           | `INB2-DB-006`/projection contracts |
| Source account health      | versioned onboarding/runtime/administrative axes rather than one overloaded connector status      | `INB2-CON-005`, `INB2-DMX-001`     |
| Privacy request/hold       | ADR 0015 request, restriction, hold and residual state machines                                   | `INB2-CON-010`                     |

`INB2-CON-001` owns branded ID types, schema-version envelopes and namespaced
catalog-ID/registration primitives only. It must not predeclare owner-specific
domain enum values. A later owner task can change a closed vocabulary only with
an ADR/backlog impact review and backward/forward parsing fixtures.

Conversation `active -> ended` is a global lifecycle transition, and any
`ended -> active` reactivation is explicit and revisioned while preserving the
same exact thread/Conversation identity. Per-Employee archive/unarchive never
changes it.

## Non-Negotiable Invariants

- Every row, command, event, job, stream update, object key and query is
  tenant-scoped.
- Conversation identity never depends only on `clientId`.
- Internal Conversation does not require Client or SourceThreadBinding.
- Client stage/owner is never stored as Conversation or WorkItem status.
- One active WorkItem cannot have two primary responsible employees.
- A WorkItem that requires human ownership cannot enter an owned processing
  state without a primary responsible.
- One canonical external thread in one identity scope cannot map to two active
  Conversations.
- One normal external send cannot resolve to zero or several routes.
- Explicit route/occurrence choice cannot silently fall back to another account;
  persisted retry never changes its binding or opaque destination.
- Group reply destination is the SourceThreadBinding, never the sender identity.
- Staff-only/internal TimelineItem cannot create provider delivery.
- Message author remains attributable after participant leaves or identity is
  linked/merged.
- Authentication external-identity links and SourceExternalIdentity claims are
  separate; source linking/roster membership never grants Hulee access.
- Permission, role-binding subject and resource relation are separate; queue
  membership, responsibility, collaborator, watcher, participant and Client
  owner relations grant nothing without a matching explicit permission.
- Shared RBAC, Employee and resource-relation revisions form one opaque
  authorization epoch; access loss prevents replay/targeted fetch before an
  invalidate is merely delivered.
- Client-scoped access never authorizes a linked Conversation, and Conversation
  access never authorizes every linked Client/contact in a group.
- Structural tenant/org/team/queue scope never opens private internal-chat
  content; current Hulee membership or audited exact break-glass is required.
- An active internal group has an owner, or is explicitly frozen in
  metadata-only owner recovery; recovery authority grants no content access.
- Content author, trusted Hulee app actor and provider transport sender remain
  independently attributable after echo, link, merge or reassignment.
- Conversation sequence and entity revision never decrease.
- Canonical state, tenant stream change/event/idempotency result and outbox
  intent commit together or not at all; a published stream position is
  immutable.
- Snapshot resume cursor is not newer than any included projection component;
  hidden authorized-filter ranges still advance a scanned cursor without data
  leakage.
- Employee last-read sequence never decreases; manual unread is a separate
  marker.
- Duplicate or replayed source input cannot create a second canonical TimelineItem.
- History import/replay cannot create new-message notifications unless an
  explicit operator action requests it.
- Provider capability differences are expressed by adapter contracts, not core
  provider branches.
- Immutable sequence/authorship/audit does not make raw PII/content immortal;
  purgeable payload and finite technical skeleton have independent ADR 0015
  policies.
- Legal hold, processing restriction, RBAC and retention cannot imply or grant
  one another; usable secrets are never hold eligible.
- Subject export/erasure in a group is decided per data root and protects other
  participants rather than assuming one Client owns the Conversation.
- Replay pruning deletes only a safe contiguous position prefix, while object/
  index/cache/analytics/provider residuals remain explicit handler outcomes.

## Invalid States To Reject

- `internal` Conversation with an external source binding.
- Conversation transport changed in place after creation.
- Internal direct created with other than two distinct Employee identities or
  later given a third participant.
- Client/group Conversation requiring one scalar Client.
- External outbound Message without an exact route.
- Explicit/persisted route silently replaced by another binding/account.
- Group reply addressed to the sender private identity instead of the selected
  group binding.
- Automatic retry after uncertain provider acceptance without adapter-proven
  idempotency/retry safety.
- Staff-only item with delivery attempt/provider outbox command.
- Two active primary assignments for one WorkItem.
- New/effective WorkItem assignment to an inactive/draining or Queue-ineligible
  employee; during fenced deactivation an old stored assignment can exist only
  as `responsibility_recovery_pending` until bounded release/requeue, and
  supervisor override cannot bypass target activity/eligibility.
- Watcher/provider participant/identity claim treated as Hulee read/reply
  authority, or Client access treated as Conversation authority.
- Processing WorkItem without queue ownership or required responsible.
- ExternalThread mapped to multiple Conversations in the same declared scope.
- Participant identity link that silently grants Hulee authorization.
- Message lifecycle update that replaces a newer revision.
- Read cursor update that moves backwards.
- Replayed/history event that increases unread/push as a fresh inbound.
- Current-row reporting that rewrites historic responsible, author or client
  stage attribution.
- Global/undefined/forever retention class, hold without owner/review scope or
  plan expiry used as a destructive deletion instruction.
- Privacy/retention completion while a required SQL/object/version/index/cache/
  analytics/backup/provider handler is failed, unknown or unverified.
- Data-subject identity inferred from one reusable phone/email/provider handle or
  used to export/delete other participants' group data.

## Defaults Requiring An ADR Change To Override

- At most one non-terminal WorkItem per Conversation in Inbox V2 MVP.
- Customer/actionable inbound creates or reopens a WorkItem by policy.
- New inbound can reopen recently resolved work according to tenant policy;
  otherwise it creates a new sequential WorkItem.
- External employee-only groups have no WorkItem by default.
- Cross-channel conversations remain separate and aggregate in the Client view.
- Internal notes are supported in external conversations and are staff-only.
- Normal reply inherits the route of the referenced/opened external thread.
- Provider-native forward is a separate capability from outbound content copy.
- First response metrics count the first authorized human external reply, not
  bot/system/internal-note activity.

## Acceptance Mapping

The release scenarios `INB2-ACC-001` through `INB2-ACC-048` in
`docs/product/inbox-v2-backlog.md` are the executable acceptance layer for this
matrix. New implementation tasks must reference at least one scenario or add a
new scenario when they introduce a new valid/invalid state.
