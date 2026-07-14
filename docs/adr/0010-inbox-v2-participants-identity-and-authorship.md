# ADR 0010: Inbox V2 Participants, Source Identity And Message Authorship

## Status

Accepted.

This ADR completes `INB2-ARCH-003`. It depends on the accepted Inbox V2
scenario glossary and ADR 0009 domain boundaries.

## Date

2026-07-10.

## Context

Inbox V2 must preserve who actually authored every message in several distinct
surfaces:

- an unknown customer writing to a direct messenger account;
- several customers and employees writing in one provider group;
- an employee writing through Hulee;
- the same employee writing through the native Telegram, WhatsApp or MAX app;
- internal employee direct/group chats and staff-only notes;
- bot, automation, provider-system and imported legacy activity.

Those facts cannot be represented by one `senderId`, current Client link or
current responsible employee. A content author, an authenticated Hulee command
actor, a provider-observed actor and the tenant SourceAccount/Binding are
independent. Provider echo can also arrive after Hulee created an outbound
Message and must not replace the original author.

Inbox V1 cannot preserve these distinctions:

- the current core Conversation contract requires one Client (although the V1
  database column is nullable) and stores only employee participant IDs;
- external inbound resolves a sender-like `clientExternalId` directly to a
  Client/contact and does not persist a conversation participant;
- Message has no durable author, app actor or transport-sender reference;
- `external_identity_links` already means an authentication-provider subject
  linked to a Hulee Account and therefore cannot safely represent a messenger
  participant;
- `ClientContact.external_handle` lacks a declared provider/account identity
  scope;
- identity candidates provide useful evidence/confidence fields, but there is
  no implemented source-identity resolver or persistence model yet.

Reusing the authentication identity namespace for source participants would
create an authorization-escalation path. Linking a Telegram user to an
Employee must never create a login, grant Inbox access or make a provider event
look like an authenticated Hulee command.

## Decision

Hulee separates workforce/CRM records, observed source identities,
conversation-local participants, authenticated app actors and external
transport observations/routes. Identity resolution can relate those records,
but does not collapse them or rewrite history.

### Domain terms and ownership

`Employee` is the tenant workforce record. An Employee can be inactive and is
not itself proof of an authenticated session. Account/session authentication
and tenant RBAC decide whether a principal can act as that Employee.

`AuthExternalIdentityLink` is the semantic name for the existing
`external_identity_links` record: an authentication-provider subject linked to
a Hulee Account. It remains exclusively in the login/account boundary.

`Client` is a CRM person or organization aggregate. A Client is never a message
author or an authorization principal.

`ClientContact` is a CRM-owned person/contact point associated with a Client.
It can hold normalized phone/email/contact data and can be the target of a
verified source-identity claim. Linking a source identity to a ClientContact
does not turn the Client into the author.

`SourceExternalIdentity` is a source-actor identity record observed through an
integration, such as a Telegram user, WhatsApp group participant, marketplace
customer, bot or provider-side system actor. It can be adapter-declared stable
or observation-ephemeral. Product/UI language may shorten this to
`ExternalIdentity`, but contracts and persistence use the source prefix to
avoid collision with authentication `external_identity_links`.

`ConversationParticipant` is the immutable conversation-local subject used by
authorship and membership history. It has its own stable ID and references
exactly one typed subject:

- `employee` for an internal Hulee Employee persona;
- `source_external_identity` for a provider/source persona;
- `client_contact` only for a future explicitly authenticated Hulee client
  surface, not merely because a source identity was resolved;
- `bot` for a registered Hulee automation/bot identity;
- `system` or `legacy_unknown` for explicit non-human/irrecoverable provenance.

Typed references must be tenant-safe and constraint-checkable. A generic
unvalidated `{ type, id }` string is not sufficient persistence. Within one
Conversation there is at most one participant anchor for the same exact typed
subject, including after leave; membership epochs are history on that anchor,
not new authors.

Bot, service, system and legacy subjects use registered tenant-owned IDs or a
closed/versioned system-code registry. Arbitrary request/provider strings
cannot create a trusted bot, service or system principal.

The same human can legitimately have two distinct participants in one external
Conversation: an Employee participant used when they write through Hulee and a
SourceExternalIdentity participant used when they write through the native
provider app. Their identity claim allows related display/reporting, but the
two author personas are not merged.

### Source identity scope and evidence

A SourceExternalIdentity is unique only inside the identity realm and scope
explicitly declared by its adapter. Its durable key contains tenant, versioned
provider/adapter identity namespace (for example Telegram versus WhatsApp),
scope kind, scope-owner key when applicable and canonical external subject ID.
The namespace is distinct from a broad source category such as `messenger`.
The adapter also declares whether that subject is stable or
observation-ephemeral. Scope can be provider-, connection- or account-scoped;
ADR 0011 (`INB2-ARCH-004`) defines the exact thread/account interaction.

When no stable external subject exists, the adapter creates a deterministic
event/thread-observation-scoped ephemeral identity. Generic resolution does not
reuse it across unrelated observations or merge it by display data; later
alias/merge requires explicit compatible evidence.

Core never assumes that equal usernames, phone-like strings or opaque IDs from
different scopes denote one actor. Adapter-owned canonicalization must declare
whether case folding or another transformation is safe. Generic code must not
lowercase opaque external IDs.

Every observation is versioned, durably persisted and idempotent under
event/replay dedupe. It retains:

- raw/normalized source event references and adapter contract version;
- source connection/account and declared identity-scope key;
- external subject ID and provider profile/display snapshot;
- actor category and normalized/provider role where known;
- evidence candidates, confidence, provenance and observed timestamp.

One event may observe several identities, such as a group roster. V2
normalization therefore supports a collection of identity/roster observations,
not one overloaded `clientExternalId`. External thread identity and sender
identity are independent fields.

### Identity claims

A SourceExternalIdentity begins unresolved. It can have zero or one active
canonical claim to exactly one Employee or ClientContact. Claim history is
append-only and records:

- target type/ID and tenant;
- evidence and confidence;
- source policy/rule version;
- created/revoked time;
- authenticated employee or trusted system actor that made the decision;
- review state and reason;
- monotonically increasing claim version.

Automatic linking is allowed only for tenant-approved policy using verified,
scope-correct evidence. Phone/email normalization is not proof of ownership.
Weak or conflicting candidates stay unresolved or conflicted. Shared
phone/email/usernames never use first-match selection. A new claim to an
inactive Employee is denied unless a dedicated audited override policy permits
it. Deactivation revokes app authority but does not silently revoke, retarget
or rewrite an existing identity claim; unlink/reassignment is an explicit
audited decision and the inactive target remains visible in resolution history.

Claims are resolution metadata, not authorship or authorization. Creating,
changing or revoking one:

- never changes Message authorParticipantId;
- never replaces the participant subject;
- never rewrites raw/source observations;
- never creates an Account, session, Employee, Client or ClientContact;
- never grants RBAC, queue/team membership, Conversation access, participant
  membership, watcher/read state or WorkItem responsibility.

Cross-source identities for the same person are related through their common
Employee/ClientContact target; they are not merged into a global provider ID.

### Participant membership

Participant identity and membership are separate facts. A participant anchor
is retained after leave/removal so old messages remain attributable. A
participant can be author-only and have no current active membership.
Membership is represented by independent origin/binding episodes plus an
append-only transition history; one participant can have several simultaneous
origins. Each episode records normalized state, role, validity interval, source
evidence and actor/reason. The closed/versioned membership lifecycle states are
`pending`, `active`, `left` and `removed`; an invitation maps to `pending` with
its origin/evidence. Normalized roles include `owner`, `admin`, `member`,
`guest`, `observer` and `unknown`. Adapter-specific states/roles remain in a
versioned provider snapshot instead of provider branches in core.

Every Conversation has one membership head and a monotonic membership
revision. A canonical membership command runs in one explicit `READ COMMITTED`
transaction and obtains locks in this order:

1. the Conversation membership head with `FOR UPDATE` as the aggregate mutex;
2. for a current Hulee-origin membership, the subject Employee with
   `FOR NO KEY UPDATE`, followed by an active-Employee and internal-transport
   recheck;
3. the exact participant/episode rows, followed by the append-only commit and
   transition, episode projection and membership-head advance.

`FOR NO KEY UPDATE` fences a concurrent Employee deactivation without
conflicting with the `KEY SHARE` lock used by transition actor foreign keys.
`leave`/`remove` can close an episode after Employee deactivation and must not
require the Employee to remain active. One membership commit has one
`occurredAt`; all transitions in it and the resulting head clock use that exact
time. A later episode for the same participant/origin cannot overlap or start
before the previous terminal boundary.

Multi-Conversation commands lock heads in sorted `(tenantId, conversationId)`
order and then Employee fences in sorted Employee-ID order. The DB-only command
transaction may be retried as one unit, at most a bounded number of times, for
PostgreSQL `40P01`/`40001`; provider or other externally visible effects never
run inside that retry boundary. Membership mutation under `REPEATABLE READ` is
not supported until an Employee-membership fence revision participates in both
membership and deactivation writes. Read-only snapshot isolation from ADR 0012
is unaffected.

`observed`/`unknown` are observation evidence classifications, not membership
lifecycle states. They make an actor attributable but do not count as confirmed
roster membership or satisfy participant/member totals used by access, routing
or employee-only classification.

Membership origin distinguishes at least:

- an internal Hulee command;
- a provider roster snapshot/delta;
- observation as an event author;
- import/migration;
- an explicit system policy.

A sender can be observed and become an author before a complete group roster
is available. Missing from a partial roster does not mean `left`; absence can
close membership only when the adapter declares an authoritative complete
snapshot or supplies an explicit leave/remove event.

Roster evidence is retained per SourceThreadBinding/SourceAccount with
completeness (`unknown`, `partial` or `complete`), observation time/watermark
and the adapter's authority guarantee. Current roster/classification is derived
across the canonical external thread bindings. Even `complete` omission closes
an origin only when the adapter declares that snapshot authoritative; stale
snapshots cannot reverse a newer membership event.

Partial, stale or unresolved roster evidence cannot prove `employee_only` or
suppress customer routing, WorkItem creation/re-evaluation or notifications.
A newly observed unresolved/client participant invalidates that classification
and triggers policy re-evaluation as required by the scenario glossary.

History import or an old message observation can create an author participant
without reopening current membership. A provider leave/remove changes only the
applicable provider-origin episode; an explicit Hulee removal changes only the
internal origin. Neither silently removes the other. Reassigning a
SourceExternalIdentity claim from Employee A to Employee B never transfers an
existing internal membership, grant, notification state or WorkItem relation
from A to B.

Provider membership and Hulee access are different. Provider admin/member
status is display/source evidence and never satisfies a Hulee permission scope.
Conversely, an authorized Hulee collaborator can write through the selected
route without being represented as the provider transport account.

### Three independent attribution planes

Every communication Message preserves three independent facts:

1. `authorParticipantId` — immutable content author in this Conversation.
2. `appActor` — server-stamped authenticated Hulee Employee/service principal
   that issued the create/edit/delete command, or null for source-originated
   activity. This is audit metadata, not a client-supplied author override.
3. `sourceOccurrence`/`outboundDispatch` — structured external transport facts:
   provider-observed actor SourceExternalIdentity when available,
   SourceAccount, SourceThreadBinding, direction and provider references. These
   facts are not used as the content author.

Provider actor and tenant transport route are different. For inbound, the
SourceAccount is the tenant's receiving account and is never called the sender.
For outbound it is the selected sending account/route, while a distinct
provider-actor identity is stored only when the provider supplies or Hulee can
prove it. SourceAccount ownership/current assignment is never actor evidence.

Transport direction is also independent: `inbound`/`outbound` describes a
source occurrence relative to the tenant account. Internal messages have no
external transport direction. UI `mine/theirs`, external audience and manager
attribution are derived from typed authorship/context, not one direction flag.

User/bot-authored Messages require an authorParticipantId. Provider/system
lifecycle activity that is not communication remains a typed TimelineItem;
it is not converted into a fake Message. An automated communication uses an
explicit bot/system participant. Imported content with irrecoverable authorship
uses a diagnosable `legacy_unknown` participant rather than the current Client,
responsible or source account.

Message revisions retain the original author. Each edit/delete/reaction or
other authored action stores its own immutable actionActorParticipantId when
known, its app actor and/or source occurrence. A provider-side moderator/source
actor is therefore not lost and cannot replace the original Message author.
Staff-only content has an Employee/bot author but no source occurrence,
outbound dispatch or provider delivery.

When an Employee triggers automation, the bot/service remains the Message
author/app actor while an immutable causation/correlation reference records the
initiating Employee command. That reference supports audit but cannot credit a
bot response as a human response.

### Required scenario semantics

| Scenario                                 | Immutable author                                      | Hulee app actor                | Provider actor; tenant account/binding                       |
| ---------------------------------------- | ----------------------------------------------------- | ------------------------------ | ------------------------------------------------------------ |
| Unknown customer inbound                 | SourceExternalIdentity participant, unresolved        | null                           | observed external actor; separate receiving account/binding  |
| Customer linked later                    | same original participant                             | unchanged                      | unchanged source occurrence                                  |
| Employee sends from Hulee to provider    | Employee participant                                  | authenticated Employee         | provider actor if proven; selected sending account/binding   |
| Provider echo of Hulee send              | same Employee participant                             | unchanged                      | occurrence is reconciled onto the existing dispatch          |
| Employee sends from native provider app  | SourceExternalIdentity participant linked to Employee | null                           | observed external actor; account/binding; direction outbound |
| Internal employee message                | Employee participant                                  | authenticated Employee         | none                                                         |
| Staff-only note in external Conversation | Employee/bot participant                              | authenticated Employee/service | none; dispatch is forbidden                                  |
| Automation sends externally              | registered bot participant                            | trusted service actor          | provider actor if proven; selected account/binding           |
| Moderator edits/deletes                  | original author unchanged                             | moderating Employee            | original transport facts unchanged                           |

For a native-provider message from a source identity currently claimed by an
Employee, the normalized occurrence records the claim ID/version and resolved
Employee as of that occurrence for UI/reporting. It does not label the event as
app-authored. For a Hulee-originated external message, provider echo enriches
transport/delivery state and never changes the Employee author.

### Authorization boundary

All workforce/admin Inbox V2 app commands require an authenticated active
principal mapped to an active Employee (or an explicitly allowed service
principal), tenant match and the applicable scoped permission/resource
relation. ConversationParticipant is not an RBAC principal. A future client
portal requires a separate authenticated ClientPrincipal contract; merely
having a ClientContact participant does not provide that authority.

In particular:

- provider roster membership does not grant Hulee Conversation access;
- a SourceExternalIdentity-to-Employee claim does not grant access;
- a ClientContact or Client link does not create client-portal authentication;
- assignment, queue/team membership, watcher and participant roles remain
  separate grants/relationships;
- deactivating an Employee removes app authority according to RBAC policy but
  retains participant, claim and authorship history;
- client-supplied `appActor`, author-as-authority or claim-version-as-authority
  fields are rejected; trusted application code stamps them server-side;
- identity link/unlink/merge commands require dedicated permissions, tenant
  checks, audit and optimistic concurrency.

Claiming a SourceExternalIdentity to an Employee and claiming one to a
ClientContact are separate authorization decisions/policies. A generic CRM
contact-link permission cannot change Employee attribution; exact permission
names and scopes are fixed by `INB2-ARCH-006`.

`staff_only` is a server-enforced read/write visibility boundary as well as a
dispatch rule. Staff-only content is excluded from client/external APIs,
public webhooks, external exports and unauthorized realtime/projections even if
a caller guesses its ID; detailed export/redaction follows ADR 0015.

An app may group/display an Employee participant and a claimed external persona
as the same known human, but permission checks always use the authenticated
principal and canonical resource policy, never that visual grouping.

### Merge, unlink and deletion semantics

Duplicate SourceExternalIdentities can be merged only inside compatible,
adapter-declared scopes with audited evidence. Conflicting active claims block
automatic merge. Merge creates an acyclic canonical alias relationship and
prevents future duplicate resolution; it does not rewrite or delete existing
participant IDs, message authors, occurrences or claim history. Cross-source
identity correlation uses claims rather than a physical merge.

After a merge, historical participant anchors remain keyed by their original
immutable SourceExternalIdentity and may resolve to the same canonical alias.
They are marked superseded for new resolution; the uniqueness rule prevents
new duplicates but never invalidates those historical anchors.

Unlink/relink appends claim history and changes only current resolution.
Client/ClientContact merge is owned by CRM and preserves redirects/history;
source occurrences and Message authors remain unchanged.

ADR 0015 governs retention/redaction. Deactivation, leave, unlink or merge are
not privacy erasure and cannot hard-delete records referenced by authorship/
audit. An approved content/PII purge preserves the finite stable technical
attribution and auditable redaction fact without inventing another author; its
own skeleton also expires under policy.

### Events and reporting

Important changes emit versioned tenant-scoped events through the outbox,
including identity observed/claimed/unlinked/merged, participant
observed/joined/left/removed and message created/revised/deleted. Events carry
stable IDs, entity revision and enough claim/source evidence to build
event-time facts; sensitive provider payload stays referenced according to
retention policy rather than copied everywhere.

Reactions and other authored social actions follow the same immutable
participant/app-actor/transport separation as Messages.

Manager/reporting facts distinguish:

- immutable author participant and subject kind;
- resolved Employee/ClientContact and claim version at event time, if any;
- app actor at command time;
- provider-observed actor, SourceAccount, SourceThreadBinding and direction;
- bot/system/internal-note/import origin;
- Conversation, WorkItem responsible and Client attribution through separate
  dimensions/bridges.

Current identity links, current responsible and current Client ownership cannot
retroactively rewrite historical facts. A separate current-resolution view can
be offered, but KPI definitions must state which view they use. Linking several
Clients to a group does not multiply one physical Message fact.

Report authorization is also separate from identity resolution. Aggregate
`reports.view` access does not imply raw Message, roster or contact PII access;
drilldown requires the corresponding Conversation/Client/contact permissions,
and control-plane reporting never receives customer identities or content.

## Required Implementation Verification

The versioned contracts, persistence and services created by follow-up tasks
must prove at least these decision fixtures:

- an unknown source actor creates identity/participant/message without Client,
  Account or access grants; later ClientContact/Employee claim keeps the author;
- an unauthorized claim-to-self is denied, while concurrent authorized claims
  produce one active winner and append-only audited history;
- provider and internal membership origins change independently, and claim
  reassignment never transfers membership/read/notification/work state;
- one source identity in two Conversations has distinct participants; leave,
  merge, unlink and Employee deactivation retain old message/reaction authors;
- partial/advisory/stale roster cannot remove members or prove employee-only;
  authoritative newer evidence and explicit leave converge deterministically;
- Hulee send, provider echo, native-provider outbound, shared account and bot
  automation preserve distinct author, app actor, causation, provider actor and
  account/binding facts without false human-response credit;
- staff-only content with an injected route is rejected before delivery/outbox
  and is absent from every external read/webhook/export/realtime surface;
- same provider subject in different tenants is isolated, and cross-tenant
  participant/claim/author/link IDs fail without leaking object existence;
- reporting before/after claim/reassignment/merge uses event-time facts, keeps
  one physical message and gates PII drilldown separately.

## Invariants

- Every identity, participant, claim, membership, Message reference, command,
  event and query is tenant-scoped.
- Authentication `external_identity_links` and SourceExternalIdentity are
  different namespaces and persistence models.
- Client is never a Message author or RBAC principal.
- A participant subject is immutable; claim/link changes cannot replace it.
- Every user/bot Message author belongs to the same Conversation as the Message.
- Every action actor for edit/delete/reaction or another authored action belongs
  to the same Conversation as its target TimelineItem.
- Leaving/removal/deactivation never erases participant or authorship history.
- Each SourceExternalIdentity has at most one active claim; that claim targets
  exactly one Employee or one ClientContact. Many identities may claim the same
  target; conflict is explicit and never first-match.
- Source identity scope/canonicalization is adapter-declared; core does not
  compare unscoped usernames or mutate opaque IDs.
- External thread ID and external sender ID are independent.
- App actor is trusted server context and cannot be supplied as authority by a
  provider/client payload.
- Native-provider outbound from a claimed Employee remains source-authored;
  Hulee outbound remains app-authored after provider echo.
- Provider membership/identity claim never implies Hulee authorization.
- Staff-only content has no source occurrence, outbound dispatch or provider
  delivery.
- Staff-only content cannot enter a client/external read, webhook, export or
  realtime surface.
- Partial/unresolved roster evidence cannot suppress routing or notifications
  by declaring a group employee-only.
- Identity linking/merge does not rewrite event-time reporting attribution.
- Reactions and other authored actions retain their original participant after
  link, merge, leave or deactivation.

## Persistence And Contract Consequences

Inbox V2 requires additive, tenant-owned persistence or equivalent boundaries
for:

- source external identities, versioned realm/scoped keys, profiles and
  idempotent observations with stable observation/dedupe IDs;
- append-only Employee/ClientContact claim history and current claim pointer;
- stable conversation participants and membership history/projections;
- registered bot/service identities and constrained system/legacy actor codes;
- Message author participant;
- message revision app actor/audit context;
- inbound source occurrences and outbound dispatches with separate
  provider-observed actor, SourceAccount, SourceThreadBinding and direction;
- event-time attribution facts or sufficient immutable events to derive them.

Same-tenant composite relationships/checks, typed-subject XOR constraints,
unique scoped identity keys, one active claim and one participant per exact
Conversation subject should be enforced in the database where possible and
also tested in application policy.

Transition ownership is one-way to avoid required-FK insertion cycles:
membership transitions reference their episode, and claim transitions reference
the affected/resulting claim. Current projections do not require a reverse
transition FK. Versioned contract graph validators and later DB/service
constraints must additionally prove episode/participant, roster-member/roster/
binding/source-subject, claim/source-identity, current-pointer and contiguous
revision/version coherence; tenant equality alone is insufficient.

Direct runtime DML against membership heads, commits, episodes and transitions
is not a supported mutation API: row triggers are an invariant backstop but
cannot repair a lock order already inverted by arbitrary SQL. Runtime database
roles and the canonical mutation entrypoint must enforce the order above;
privileged migration/repair SQL follows the same order and retries an aborted
transaction rather than continuing partial work.

V2 contracts replace singular `clientExternalId` assumptions with explicit
thread identity, sender identity and zero-to-many identity/roster observations.
The existing source identity candidate/confidence/provenance contract and
phone/email normalizers can be reused after safe scope/canonicalization rules;
they do not themselves implement identity ownership or authorization.

## Compatibility And Migration

Migration is additive and versioned. Existing authentication
`external_identity_links` keeps its Account-login semantics and is neither
renamed nor backfilled as a source participant table.

Existing employee-only participant rows can be deterministically converted to
Employee participant anchors with one synthetic `migration` membership
episode. V1 role, join/leave and origin history is not recoverable and remains
`unknown` with a diagnostic rather than being invented. Legacy external handles
can be converted only when provider identity namespace, account/scope and
subject are provable.

V1 outbound commands discard the acting Employee before Message persistence,
so their Employee author generally cannot be reconstructed. Ambiguous legacy
author/route/identity becomes explicit `legacy_unknown` plus a diagnostic;
migration must not guess current Client, responsible, SourceAccount owner or
first external handle.

V1 API/event contracts are not changed in place. V2 consumers use versioned
participant/authorship contracts, while the cutover strategy is completed by
`INB2-ARCH-009`.

## Consequences

Positive:

- unknown customers and multi-client groups keep exact original authorship;
- employees can participate through Hulee and native provider apps without
  corrupting author, notification or first-response metrics;
- provider echo/dedupe enriches an existing Message instead of changing sender;
- internal chats and staff notes need no fake Client or provider account;
- identity resolution improves display/CRM correlation without escalating
  authorization;
- membership history, event-time reporting and audit survive leave/merge;
- calls, reviews and marketplace actors can reuse the source identity boundary.

Costs:

- participant, claim, membership and transport occurrence are explicit models
  instead of one sender/client field;
- UI must present linked personas clearly without hiding source provenance;
- adapters must declare identity scope/canonicalization and roster completeness;
- migrations cannot manufacture authorship for ambiguous V1 rows;
- authorization tests must prove negative claims as well as happy paths.

## Rejected Alternatives

### Reuse authentication external_identity_links

Rejected because that table links an external authentication subject to a
Hulee Account. Messenger/source observation is not login proof; reuse would
mix customer/provider identities with authentication and risk implicit access.

### Use Client or current responsible as author

Rejected because groups can contain several Clients/unresolved identities and
responsibility changes over time. It destroys per-sender history and corrupts
manager metrics.

### Store one generic senderId/direction

Rejected because content author, app actor and transport sender differ for
Hulee outbound, native-provider outbound, bots, moderation and provider echo.
Direction is a transport property, not a universal identity model.

### Collapse claimed external and Employee participants

Rejected because it would rewrite source provenance and make a native-provider
event indistinguishable from an authenticated Hulee action. The link is a
relationship, not identity replacement.

### Rewrite old Messages after link or merge

Rejected because it changes audited facts and historical reporting whenever
current CRM/identity state changes. Current-resolution views can be rebuilt
without mutating canonical authorship.

### Treat every roster member as an authorized Hulee participant

Rejected because provider roster/admin status is controlled outside Hulee and
cannot safely grant tenant data access, queue permissions or internal notes.

### Create one global Party aggregate

Rejected for Inbox V2 because Employee, Client CRM, provider persona and auth
principal have different lifecycles/security boundaries. Explicit claims and
typed participants cover required correlation without an unbounded aggregate.

## Relationship To Existing ADRs

- ADR 0002 keeps provider scope/role differences in adapter contracts.
- ADR 0003 requires same-tenant participant, identity and claim relations.
- ADR 0005 requires normalized participant/authorship entities across clients.
- ADR 0006 keeps identity/customer data in the data-plane.
- ADR 0008 supplies raw/normalized source evidence before identity resolution.
- ADR 0009 defines Conversation as timeline owner and separates Client CRM,
  WorkItem, employee state and reporting projections.

## Follow-Up Decisions

- `INB2-ARCH-004`: exact external thread/account identity and outbound route.
- `INB2-ARCH-005`: sequence, revision, echo ordering and realtime recovery.
- `INB2-ARCH-006`: detailed Conversation/WorkItem/CRM RBAC matrix.
- ADR 0015 / `INB2-CON-010`: retention, redaction, export/delete, legal hold and
  audit contracts.
- `INB2-ARCH-009`: V1 participant/authorship migration and cutover mechanics.
- `INB2-CON-003`: versioned participant/source identity contracts and fixtures.
