# ADR 0011: Inbox V2 External Threads, Account Bindings And Outbound Routing

## Status

Accepted.

This ADR completes `INB2-ARCH-004`. It depends on ADR 0010 participant,
identity and authorship boundaries.

## Date

2026-07-10.

## Context

Inbox V2 must route direct messenger private/group communication through 50+
source integrations without guessing a Client, connector or account. The hard
cases are:

- the same Telegram/WhatsApp/MAX group is visible through several company
  direct accounts;
- a private conversation with the same person through two company accounts is
  normally two independent provider dialogs;
- provider echo of one message arrives through one or several accounts;
- an Employee replies to a specific provider message whose reply reference can
  be binding-local;
- an account reconnects, loses membership, is disabled or is replaced;
- several bindings can send, but normal send must choose exactly one;
- a provider operation is temporarily unavailable, expired or unsupported;
- a native-provider outbound message has no Hulee mutation ID.

Current Hulee has useful SourceConnection, SourceAccount, raw/normalized event,
reply-capability and adapter-contract foundations. It does not yet have a
canonical ExternalThread or SourceThreadBinding. Current normalized thread and
message IDs are unscoped strings; generic conversation-key normalization
lowercases opaque values. Inbox V1 resolves inbound by Client external handle
and the latest open client conversation, while outbound derives a recipient
from Client contact data instead of the opened source thread.

The Telegram V1 adapter stores the sender as `clientExternalId` and later uses
that value as outbound `chatId`; in a group this can route a reply to the
sender's private chat instead of the group. Public API v1 accepts a requested
channel external ID, but the command path does not persist it as an immutable
route. Direct account sync also creates a SourceConnection per connector, so a
provider-scoped group identity must be able to cross those connections rather
than include SourceConnection unconditionally.

The current Telegram dispatcher selects a connector from a client/channel
handle after Message creation. Several missing-message/config/disabled cases
return without a delivery result, while the generic outbox processor marks any
non-throwing handler call processed. That can leave a Message queued forever
with no retry or actionable error.

The RIK direct-messenger feature matrix is valuable regression evidence for
private send/reply, lifecycle, media, receipts, reactions and account health.
It is not proof of Hulee behavior and does not define the multi-account group
model. RIK's current transport persistence commonly keys a conversation channel
binding by provider + external conversation + channel account. That is safe for
account-scoped private dialogs but can create separate logical conversations
for one provider-scoped group observed by two accounts. Hulee therefore needs
an adapter-declared thread scope instead of applying account scope everywhere.

## Decision

Hulee separates canonical provider thread identity, account access/capability,
external message occurrences and the immutable outbound route selected for one
dispatch.

### ExternalThread is the canonical provider thread

`ExternalThread` is a tenant-owned stable record for one logical provider
thread/room in one adapter-declared identity scope. Its key is:

```text
tenant
+ versioned provider/adapter thread realm
+ thread scope kind
+ scope owner key when applicable
+ provider thread object kind
+ canonical external thread subject
```

The thread realm distinguishes incompatible provider/API identity spaces, for
example Telegram MTProto versus Bot API until an adapter contract proves a
canonical equivalence. A broad source type such as `messenger` is never a realm.

The adapter declares:

- realm name/version and canonicalization version;
- scope kind: `provider`, `source_connection` or `source_account`;
- required scope owner (durable SourceConnection/SourceAccount) for scoped
  identities;
- provider thread object kind such as private peer, group, channel or topic;
- canonical external thread subject and stability;
- topology hint and any authoritative migration/alias evidence.

Core never lowercases or otherwise transforms an opaque thread subject. Display
title, Client/contact, sender, participant set, phone, username and first/last
account are not thread keys.

If an adapter cannot provide a stable exact direct-messenger thread descriptor,
the event remains diagnosable/unresolved and is not attached to a latest Client
conversation. A weak fingerprint may support an explicit non-chat resolver
policy, but cannot silently create/reuse a direct/group send context.

### Scope is provider behavior, not a core provider branch

The safe semantics are:

- `provider`: all connected accounts observing the canonical subject share one
  ExternalThread;
- `source_connection`: the subject is unique only inside one connection;
- `source_account`: the subject is unique only for one account.

Adapters declare scope per provider thread object kind. If scope is unknown,
the safe default is `source_account`; a later promotion to provider scope is a
versioned migration/alias decision, never an in-place key reinterpretation.

Expected direct-messenger contract fixtures are:

| Surface                       | Expected scope when provider evidence supports it | Result                                                                   |
| ----------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------ |
| Telegram MTProto private peer | source account                                    | Same peer through two company accounts remains two threads               |
| Telegram group/channel        | provider                                          | Same provider group through two accounts is one thread with two bindings |
| WhatsApp private JID          | source account                                    | Dialog and send persona remain account-specific                          |
| WhatsApp group JID            | provider only after adapter proof                 | Shared group can dedupe across connected accounts                        |
| MAX private peer              | source account                                    | Separate company accounts do not merge dialogs                           |
| MAX group                     | provider only after adapter proof                 | Shared group uses several bindings without duplicate Conversation        |

These are adapter contract expectations, not provider-specific core conditions.
`INB2-ARCH-008` owns live/fixture evidence and can keep a surface account-scoped
until the stronger guarantee is verified.

### Conversation mapping is exact and client-independent

For Inbox V2 external direct/group chat:

- one ExternalThread maps to exactly one canonical Conversation in a tenant;
- one external direct/group Conversation has exactly one ExternalThread;
- one ExternalThread has one-to-many historical SourceThreadBindings after
  creation and zero-to-many currently active bindings;
- different ExternalThreads remain different Conversations even when linked to
  the same Client/ClientContact;
- a Conversation remains after every binding is unavailable/removed and
  becomes read-only until an allowed route returns;
- archive/resolution/WorkItem lifecycle never creates another Conversation for
  the same exact ExternalThread.

Database uniqueness and transactional get-or-create enforce the mapping under
concurrent webhook/polling/account events. A caller-provided
`existingConversationId`, current Client, title or routing hint cannot override
an exact thread mapping.

Provider-declared thread migration (for example an authoritative room upgrade)
creates an append-only ExternalThread alias/supersession record. It keeps source
evidence and Conversation identity. Similar names, participants or linked
Clients never trigger automatic thread merge. Correcting an accidental legacy
duplicate is an audited migration operation, not normal resolver behavior.

An ExternalThreadAlias maps one old exact realm/scope/thread key directly to one
canonical ExternalThread. It is not another current Conversation-to-thread
relationship, cannot form chains/cycles and never makes one alias resolve to
several threads. Historical occurrences retain the observed alias key while new
resolution follows the canonical target.

### SourceThreadBinding represents one account's access

`SourceThreadBinding` is the tenant-safe relationship between exactly one
ExternalThread and exactly one SourceAccount. A stable binding is reused across
session reconnects and membership episodes; reauthentication of the same
external account must not create a new account/thread identity.

For direct accounts, adapters also declare a versioned external-account realm
and verified canonical account subject. Session/connector IDs create only a
provisional account identity. Once the provider account is verified, promotion
or alias to the canonical SourceAccount is transactional/audited and cannot
leave two active accounts for the same unique provider subject. Reauth or a
recreated connector that proves the same subject recovers the canonical account
or reports a conflict; a genuinely different subject creates a new account.

A binding owns or references:

- account-local provider thread reference/peer data needed by its adapter;
- account membership/access lifecycle and append-only transitions;
- first/last observation and authoritative membership evidence;
- receive/history cursors and provider watermarks where supported;
- versioned operation/content capability snapshot;
- provider role/permission and reply-window constraints;
- health/availability diagnostics and revision;
- roster evidence scoped to that account as required by ADR 0010.

Binding has three independent axes:

- remote membership/access lifecycle (`observed`, `active`, `left`, `removed`);
- administrative route state (`enabled`, `disabled`);
- runtime readiness/health (`unknown`, `ready`, `degraded`, `unavailable`).

An inbound observation cannot automatically re-enable an administratively
disabled binding. Reconnecting/degraded does not mean left; deleting/replacing
an account does not delete the binding or history. The same
`(tenant, ExternalThread, SourceAccount)` has one binding anchor with temporal
episodes. Roster completeness/authority and partial-snapshot rules are inherited
from ADR 0010 and remain evidence per binding/account.

Connection-level capabilities are defaults only. Send/reply/edit/delete/
reaction/read/history/media/native-forward eligibility is evaluated for the
specific binding, operation and content. Capability state distinguishes
supported, unsupported, unknown, temporarily unavailable and expired where
applicable; UI hints cannot be the only enforcement.

### External message identity and source occurrences are separate

Raw/normalized event idempotency remains account-scoped so every delivered
provider payload is retained. Canonical Message dedupe happens later through an
adapter-declared `ExternalMessageKey`:

```text
tenant
+ versioned provider/adapter message realm
+ message scope kind/owner
+ canonical ExternalThread
+ canonical external message subject
```

Message scope can be binding/account-specific or canonical-thread/provider
scoped. The adapter must prove when the same group message ID is shared across
accounts. Core does not lowercase opaque IDs or dedupe across accounts using
body + timestamp + display sender alone.

An `ExternalMessageReference` maps one exact key to one canonical TimelineItem/
Message. `SourceOccurrence` records each webhook/poll/history/echo observation
with Raw/NormalizedEvent, SourceAccount, SourceThreadBinding, provider actor,
direction, provider timestamps/references and payload/capability version. Thus
one provider group message can produce one Message and several occurrences
without losing diagnostics.

Lifecycle events, replies and receipts resolve through the same exact reference
scope. Missing/ambiguous references are deferred or diagnosed according to
event policy; they do not mutate the newest message in a Client conversation.

### Inbound canonical resolution

Trusted adapter processing follows this order:

1. Persist the raw account-scoped event.
2. Validate tenant/source/account ownership from ingress configuration, never
   from untrusted payload IDs.
3. Produce versioned exact thread, sender and message descriptors independently;
   the normalized event and resolver inputs must agree on account/thread/message
   references.
4. Transactionally get/create ExternalThread, canonical Conversation and the
   account binding under unique constraints.
5. Resolve/create participant identity through ADR 0010.
6. Resolve exact external message reference; create one TimelineItem or attach
   another SourceOccurrence to the existing one.
7. Emit durable events for projection, notification and reporting.

Concurrent delivery through several accounts can race; one database winner is
canonical and the other event attaches an occurrence after conflict retry. Raw
evidence from every account remains. Duplicate/history/replay occurrences do
not create unread, notification or WorkItem side effects as fresh inbound.

Polling/websocket/provider cursors advance only after the raw occurrence is
durably recorded with a resumable processing state. Materialization failure can
retry/replay that durable event and cannot be skipped by advancing an in-memory
or provider cursor first.

Occurrence materialization is a bounded induction proof, not three unrelated
same-tenant IDs: it loads the exact current binding, canonical ExternalThread
mapping and verified SourceAccount identity, then proves their thread/account/
connection/generation and adapter surface agree. A provider response additionally
loads its attempt, dispatch and immutable route and proves the complete
attempt-to-route-to-binding chain. Resolution of a recorded occurrence uses a
before/after revision CAS; `resolved` is terminal and cannot be overwritten by
a racing resolver.

Conflicting thread scope, account ownership, topology or exact message mapping
is a stable processing error/DLQ diagnostic. Resolver code does not recover by
selecting the first row, latest conversation or first Client contact.

### OutboundRoute is resolved before dispatch

Normal external send creates exactly one immutable `OutboundRoute` containing:

- tenant, Conversation, ExternalThread and SourceThreadBinding IDs;
- SourceAccount and adapter operation;
- full binding generation, capability revision and route-policy revision;
- immutable versioned opaque adapter route descriptor/destination/reference,
  including provider peer/address kind and any safe quoted-context token;
- referenced SourceOccurrence/external message reference when applicable;
- authenticated app actor/permission decision and selection reason;
- mutation/idempotency/correlation IDs;
- fallback reason if an explicitly allowed fallback was selected.

The resulting OutboundDispatch is pinned to that route. The provider dispatcher
receives the stored opaque descriptor and must not reconstruct destination from
participant, Client, ExternalThread display metadata, SourceAccount display
address or a “first target” fallback. Provider retry uses the same binding/
account/descriptor; it never hops accounts after persistence. A route change is
an explicit audited new/re-route command with its own concurrency and
idempotency semantics.

Route selection plus canonical Message, OutboundRoute, OutboundDispatch and
outbox intent persistence is one transactional command boundary. If no valid
route is selected, the command returns a stable error and cannot leave a queued
external Message without a dispatch. This is a logical atomicity invariant;
ADR 0012 (`INB2-ARCH-005`) fixes the exact transaction/outbox ordering.

Immediately before every provider I/O attempt, the dispatcher fences on full
binding/account generation, administrative state, remote terminal lifecycle
and descriptor version. Disable/remove/rebind/destination change yields
`route.binding_changed` or `route.inactive`, persists a durable outcome and
makes zero provider calls. It never reroutes. Temporary runtime/egress/rate
limit failure keeps the same pinned route and becomes retryable according to
adapter/policy.

The server evaluates structural route eligibility at command time:

- same tenant and exact ExternalThread/Conversation mapping;
- remote lifecycle `active`, administrative state `enabled` and an allowed
  SourceAccount/SourceConnection status;
- Employee permission for Conversation, action and that account/binding;
- action/content capability and provider role;
- reply window/reference portability where applicable;
- optimistic binding/policy revision.

Runtime/egress/rate-limit readiness is a separate scheduling/attempt decision,
not structural identity. Policy may delay the pinned route or, before dispatch
creation only, explicitly choose an allowed fallback. Temporary readiness must
not make a persisted route mutate.

Client/UI cannot establish authority by supplying a binding/account ID. It can
request one, but the server validates every relation and stamps the route.
Conversation/action access and exact SourceAccount/binding use are two separate
server-loaded authorization decisions. Both bind the principal, current
authorization epoch, resource tuple, operation/content and binding fence, and
both must still be valid at route creation. Provider roles, participant state or
a caller-supplied boolean cannot satisfy either decision.

Binding creation likewise uses one bounded commit containing the canonical
thread mapping, verified SourceAccount identity and initial binding/remote
episode. Current binding lists expose compact heads/fences only; full capability,
evidence, descriptor and history payloads are fetched through separate bounded
detail pages. Periodic health/cursor observations may advance same-state
progress under CAS, but an identical capability/provider-role refresh is a
semantic no-op and cannot churn a route-critical fence.

### Deterministic normal-send selection

For a non-reply new outbound message, the resolver applies:

1. if a binding was explicitly requested, use only that binding when eligible;
   otherwise return its exact error and stop;
2. when no binding was explicitly requested, use an eligible, explicitly
   configured preferred binding in the current
   versioned thread route policy;
3. the only eligible binding when exactly one exists;
4. an explicitly configured fallback policy, if it yields one deterministic
   allowed binding for this action;
5. otherwise a stable no-route or ambiguous-route error.

Database order, first/last connector, latest event arrival, current responsible,
Client owner/contact and SourceAccount creation time are never route policy.
When several eligible bindings remain, UI must ask for an account or an
authorized user must set a preference; normal send never fans out.

The default fallback policy is `none`. An enabled fallback policy stores an
audited ordered allowlist/conditions and must make the provider persona/account
change visible. It can select a route only before dispatch is created. Temporary
unavailability normally keeps an explicitly chosen dispatch pinned/retryable;
it does not silently switch to a different account.

An explicit binding/occurrence selection never falls through to preferred,
only-binding or fallback logic. Changing it requires a separate typed visible
reroute intent, reauthorization and audit that names the old and new accounts;
there is no caller-controlled `allowFallback` boolean. An invalid explicit
choice otherwise fails without provider I/O.

### Reply and lifecycle route affinity

Reply/edit/delete/reaction/native-forward operations additionally depend on the
referenced message's SourceOccurrences and external references. Each adapter
declares reference portability as `binding_only`, `external_thread` or a proven
provider-global scope; safe default is `binding_only`.

- If reply explicitly selects an occurrence/binding, it uses only that
  compatible route or fails; no fallback is inferred.
- Without explicit selection, reply uses a valid preferred binding that can
  address the reference or the only compatible eligible binding.
- More than one compatible binding without explicit/preferred choice is
  `route.ambiguous`, not first-arrival selection.
- An unavailable binding-local reply reference produces a stable error. An
  operator may explicitly send new content through another binding, but Hulee
  must not present that as the original provider reply.
- Edit/delete/reaction/receipt mutations target the original dispatch/
  occurrence route unless the adapter explicitly proves portability; there is
  no silent fallback.
- Cross-ExternalThread reply/reference is rejected.

This is the precise meaning of “reply inherits the source route”: route affinity
comes from exact source evidence and declared portability, not from the Client
or currently open sidebar item.

### Explicit multi-send is a different command

Sending through several accounts/threads is never a side effect of normal send.
An explicit multi-send/broadcast command names every target and creates
separate route-pinned dispatch/message intents with a common operation ID,
authorization, limits and audit. Reconciliation retains intentional-duplicate
identity so provider echoes are not incorrectly collapsed into one send.

### Account disable, removal and replacement

SourceAccount disable/delete is temporal/soft for all referenced data:

- historical bindings, occurrences, dispatches and reports remain;
- active route preference is invalidated/re-evaluated, not repointed silently;
- a new send uses only a configured eligible fallback or fails visibly;
- binding-local reply/lifecycle operations block unless explicit portability
  and policy allow another binding;
- a pending/retrying dispatch remains pinned and reaches terminal/retry state;
- reauth of the same account preserves SourceAccount/binding identity;
- replacement by a different external account creates a new SourceAccount and
  binding, even if the display phone/name is reused.

One account failure/reconnect/rate limit cannot block ingestion/dispatch for
other accounts. It also cannot cause their routes to take over unless an
explicit policy/command allows it.

### Provider echo and out-of-band outbound

Hulee-originated outbound stores Message, immutable route and mutation/
dispatch correlation before provider I/O. Provider response and one-or-many
echo occurrences can arrive in any order. Exact provider message references,
adapter correlation and dispatch IDs reconcile onto the existing Message; weak
content/time similarity cannot auto-merge ambiguous sends.

An unmatched provider-native outbound is materialized once as a new outbound
Message with a SourceExternalIdentity participant author under ADR 0010. It has
no Hulee app actor/mutation and does not notify employees as a new customer
inbound. Cross-account group echoes attach occurrences rather than duplicate the
Message when the adapter-declared message scope proves equivalence.

Intentional multi-send, two genuine provider messages with equal content and an
ambiguous weak echo remain distinct. Diagnostics expose unresolved correlation
instead of silently losing/merging content.

One Hulee Message can produce one or many provider dispatch artifacts, for
example a media album or providers that split attachments. All artifacts share
the one immutable OutboundRoute but have separate exact external references,
attempts and lifecycle state. Reply/edit/delete/reaction targets the concrete
artifact(s) according to adapter contract; a partial artifact outcome is not
collapsed into one invented provider status.

### Uncertain provider outcome is not blindly retried

Every provider attempt is durably opened with attempt/correlation ID and an
immutable adapter-declared retry-safety snapshot before network I/O. That
snapshot records a provider idempotency key, a recoverable client marker, or no
safe mechanism and cannot be upgraded after a timeout.

If timeout/crash occurs after the provider may have accepted content but before
Hulee persisted acknowledgement, the attempt becomes `delivery_uncertain`/
`outcome_unknown`. Automatic retry is allowed only when the adapter proves it
cannot duplicate the send. Otherwise Hulee reconciles via exact echo, history or
provider lookup; unresolved cases require an explicit operator decision that
warns about duplicate risk. Uncertainty never chooses another account and never
marks the outbox/Message sent merely because the handler returned.

An expired attempt lease is closed by revision CAS into an explicit unknown
outcome unless durable evidence proves that provider I/O never began. The
original attempt stays immutable. Exact echo/history/provider lookup or an
audited operator choice creates a separate reconciliation decision; only that
decision can move the dispatch to accepted, terminal failure or retry-authorized
state. A retry opens a new numbered attempt on the same route after its exact
backoff/reconciliation boundary. A stale lease holder cannot close or reclaim a
newer attempt.

### Dispatch/outbox outcome is explicit

Message creation, dispatch request and provider delivery acknowledgement use
different event semantics; a queued Message is not emitted as `message.sent`.
A provider dispatcher receives an already route-pinned dispatch and returns a
typed durable outcome such as accepted/sent, terminal failure or retryable
failure.

Missing Message, route, binding, account, adapter, secret or capability is not a
successful no-op. It persists a stable failure/diagnostic or throws into retry/
DLQ according to policy. The outbox row is marked processed only after the
handler's durable outcome is stored. Event-router “not my event type” filtering
happens before a provider handler and is the only benign ignored case.

Provider dispatch is selected through the module/adapter registry named by the
route contract; core does not branch on Telegram/WhatsApp/MAX.

### Stable error families

Contracts define stable machine-readable outcomes at least for:

- missing/invalid/changed thread identity scope;
- ExternalThread/Conversation mapping conflict;
- binding/account missing, inactive, left, removed or revision-stale;
- route not found, forbidden, unsupported, expired or temporarily unavailable;
- route ambiguous/multiple normal-send candidates;
- reply reference unavailable, binding mismatch or non-portable;
- external message reference conflict/ambiguous echo;
- provider adapter/secret/egress unavailable;
- multi-send required or explicit reroute required;
- cross-tenant/cross-thread reference.

The initial stable codes include `route.not_found`, `route.ambiguous`,
`route.forbidden`, `route.inactive`, `route.binding_changed`,
`route.capability_missing`, `route.reply_window_expired`,
`route.reference_nonportable`, `route.audience_mismatch` and
`route.runtime_unavailable`. Contracts define retryability separately from the
code.

Initial retry policy is explicit:

| Code/state                                                                                | Automatic retry                     | Required next action                                  |
| ----------------------------------------------------------------------------------------- | ----------------------------------- | ----------------------------------------------------- |
| `route.not_found` / `route.ambiguous`                                                     | no                                  | configure/select an exact route                       |
| `route.forbidden`                                                                         | no                                  | change permission or authorized actor                 |
| `route.inactive` / `route.binding_changed`                                                | no on old dispatch                  | explicit new route/reroute command                    |
| `route.capability_missing` / `route.reply_window_expired` / `route.reference_nonportable` | no                                  | change action or explicit send-as-new                 |
| `route.runtime_unavailable` / provider rate limit                                         | yes when policy permits             | retry same pinned route after delay                   |
| `delivery_uncertain`                                                                      | only when adapter proves retry-safe | reconcile exact provider outcome or operator decision |

Errors include safe operator hints and correlation IDs without tokens, raw
payloads or customer PII. No route error can leave a Message indefinitely
queued without retry/terminal state.

## Invariants

- Every ExternalThread, binding, alias, occurrence, reference, route, dispatch,
  event, job and query is tenant-scoped.
- Thread/message realm, scope and opaque canonicalization are adapter-declared
  and versioned; core never guesses or lowercases them.
- One exact ExternalThread maps to one Conversation; Client identity never
  merges different threads.
- One external direct/group Conversation has exactly one ExternalThread.
- One ExternalThread can have several account bindings; one binding belongs to
  exactly one thread and one SourceAccount.
- Remote membership, administrative enablement and runtime readiness are
  separate; provider inbound cannot re-enable an admin-disabled route.
- Same provider group through two accounts becomes one Conversation only when
  adapter scope evidence is provider-wide.
- Account-scoped private dialogs through different accounts never merge merely
  because the counterpart is the same Client/SourceExternalIdentity.
- Raw/account event idempotency and canonical cross-account Message dedupe are
  separate stages.
- One exact external message key maps to one TimelineItem; every observation is
  retained as an occurrence.
- Normal send resolves exactly one route or fails; no implicit fan-out.
- An explicit binding/occurrence choice either wins exactly or fails; it never
  falls through to another account without explicit reroute/fallback intent.
- Dispatcher uses the immutable adapter route descriptor and cannot reconstruct
  destination from sender/participant/Client/display fields.
- A persisted dispatch never changes binding/account during retry.
- Hard binding/account generation or administrative-state change before I/O
  makes zero provider calls and records a durable route failure.
- Reply/lifecycle actions obey exact reference portability and never silently
  degrade to send-as-new.
- Group reply destination comes from ExternalThread/SourceThreadBinding, never
  from the individual sender identity.
- Staff-only/internal content has no external route or dispatch.
- Account removal never cascades away messages, source evidence or reporting.
- Provider echo never changes app author/route or creates a duplicate when exact
  correlation exists.
- A possibly accepted but unacknowledged provider attempt is uncertain and is
  not retried unless adapter idempotency proves retry safety.
- Missing route/config/capability is a durable failure, not a processed no-op.

## Persistence And Contract Consequences

Inbox V2 requires additive tenant-owned persistence/contracts for:

- ExternalThreads with versioned realm/scope keys, state and aliases;
- canonical/provisional SourceAccount identity keys and audited promotion/
  aliases for reconnect/recreated connectors;
- exact one-to-one external direct/group Conversation mapping;
- SourceThreadBindings with account-local references, membership episodes,
  administrative state/authorization decisions, compact current heads,
  capability/health snapshots, cursors and generation;
- versioned route policy/preferred and allowed fallback configuration;
- scoped ExternalMessageReferences and many SourceOccurrences;
- bounded binding/occurrence creation and occurrence-resolution CAS commits;
- immutable opaque adapter route descriptors, OutboundRoutes and durable
  OutboundDispatch attempts/outcomes including uncertain state;
- one-to-many provider dispatch artifacts/external references per Hulee Message;
- append-only uncertainty reconciliation and late artifact-reference links;
- provider correlation, explicit multi-send grouping and reroute audit;
- stable route/resolution diagnostics.

Normalizer contract tests enforce account/thread/message agreement between the
NormalizedInboundEvent and every resolver descriptor. Ingress/source cursor
state references durable raw events and cannot acknowledge unpersisted work.

Same-tenant composite foreign keys and unique indexes enforce thread key,
Conversation mapping, `(thread, account)` binding, external message key and
route relationships. Soft-delete/status replaces cascade deletion for account
records referenced by history.

Current SourceConnection/SourceAccount/raw/normalized foundations are reused,
but direct-account capabilities become adapter/binding-specific. Current
`externalThreadId`, `externalMessageId` and conversation key candidates are V1
evidence only until wrapped in the versioned realm/scope descriptors. Generic
lowercase dedupe is not used for opaque V2 keys.

## Historical Compatibility Mapping And Current Clean Slate

The mapping constraints below remain historical proof that legacy routes cannot
be guessed. ADR 0016 does not backfill V1 thread/message rows; disposable state
is deleted and new V2 source traffic starts from exact versioned evidence.
Public contract versioning remains independent from the internal reset.

Migration can backfill an ExternalThread only when provider/adapter realm,
thread object kind, scope owner and exact subject are provable. Existing
Client/contact association is not proof. Ambiguous legacy rows become
diagnostics/read-only migration records rather than a guessed route.

Legacy provider-message IDs are backfilled only with provable scope. Ambiguous
outbound account/route stays `legacy_unknown`; current Client contact, first
connector or active account cannot fill it. Account/session IDs are mapped to a
durable SourceAccount only when account identity is verified. Session reauth is
not a new SourceAccount; actual account replacement is.

The active clean-slate/reset mechanics are defined by ADR 0016 and
`INB2-CLEAN-002`/`INB2-DB-011`; ADR 0014 retains the historical shadow/backfill
design.

## Required Implementation Verification

Follow-up contracts, repositories, adapters and services must prove at least:

- one Telegram-style provider group received through two accounts creates one
  ExternalThread/Conversation, two bindings, one Message and two occurrences;
- the same private counterpart through two accounts creates two account-scoped
  threads without accidental Client-based merge;
- missing scope/unsafe canonicalization is rejected; two providers with equal
  opaque IDs and two tenants remain isolated;
- concurrent first events through two group accounts produce one canonical
  mapping/message and preserve both raw events;
- normal send with zero/multiple eligible routes returns stable errors and never
  calls a provider; explicit/preferred/only route sends once;
- an explicit binding/occurrence that becomes invalid fails without fallback;
  only a separate allowed fallback/reroute intent can change the account;
- reply uses a compatible occurrence/binding, rejects non-portable fallback and
  allows explicit send-as-new without falsifying reply semantics;
- account disable/removal selects only an explicitly allowed fallback before
  dispatch or blocks; a persisted retry never changes account;
- binding destination/generation/admin state changed after enqueue produces zero
  provider calls, while temporary health/rate limit retries the same route;
- provider acceptance followed by worker timeout/crash becomes uncertain and
  cannot create an automatic duplicate when send is not proven idempotent;
- provider response/echo order permutations and cross-account echoes reconcile
  one Message; unmatched native outbound creates one source-authored Message;
- lifecycle/reference events duplicated, stale or before create converge or
  enter a diagnosable deferred state without mutating an unrelated message;
- a Telegram-style group reply uses the group binding destination and never the
  sender SourceExternalIdentity/private peer;
- adapter route-token fixtures retain WhatsApp group `@g.us` + quoted context,
  Telegram peer kind (`user`/`chat`/`channel`/topic) and MAX provider chat ID
  without participant/room fallback reconstruction;
- one Message with a multi-artifact media send keeps one route and distinct
  artifact references/lifecycle outcomes;
- partial/advisory roster on one of several bindings never implies leave or a
  provider-wide complete roster under ADR 0010;
- polling/materialization failure leaves a durable replayable event and cannot
  advance past unpersisted input;
- reauth/recreated connector for the same verified account deterministically
  recovers/promotes one canonical SourceAccount; changed account creates a new
  one and provisional conflicts are diagnosed;
- staff-only and implicit multi-send attempts produce zero dispatch/outbox/
  provider calls;
- every missing route/account/adapter/config branch reaches retry/terminal/DLQ
  rather than marking the outbox processed while Message stays queued;
- cross-tenant/cross-thread binding/reference/route IDs are rejected without
  leaking object existence.

RIK matrix rows for send/reply, media, forward, edit/delete, receipts, reactions
and health become adapter-matrix fixtures under `INB2-ARCH-008`; their RIK `OK`
labels are not copied as Hulee verification.

## Consequences

Positive:

- multi-account groups dedupe without collapsing account-scoped private chats;
- every send/reply has one visible/auditable account route;
- account removal and reconnect preserve history and fail predictably;
- provider echo/out-of-band behavior converges without corrupting authorship or
  notifications;
- binding-specific capability prevents UI promises the selected account cannot
  execute;
- raw evidence remains complete while canonical message counts stay correct;
- routing failures cannot disappear as successful outbox work;
- the model extends to email/marketplace threads without messenger branches.

Costs:

- adapters must define/test thread and message identity scopes per surface;
- several tables/contracts replace unscoped external ID strings;
- multi-account conversations need a visible route selector/preference UX;
- safe account-scoped defaults may temporarily show separate threads until
  provider-wide identity is proven/migrated;
- route/capability revisions and durable dispatch outcomes add concurrency and
  operational tests.

## Rejected Alternatives

### Key every thread by SourceAccount

Rejected because one provider group observed through several accounts becomes
several Conversations and physical messages. Account scope remains correct only
for surfaces whose adapter declares it, especially private direct dialogs.

### Key every thread globally by provider external ID

Rejected because private dialog IDs and some provider/API IDs are
account/connection-scoped. It can merge unrelated conversations and route one
customer message through another company account.

### Resolve conversation from Client or sender

Rejected because one Client can use many source threads and one group can have
many Clients. Identity association is CRM/display evidence, not send context.

### Select the first/latest active account

Rejected because database/event timing becomes business policy, behavior races
across nodes and the visible provider persona can change silently.

### Automatically fail over every send/retry

Rejected because a different account can be a different provider actor and a
reply reference can be binding-local. Fallback must be explicit, compatible and
selected before immutable dispatch creation.

### Fan out normal send to all group bindings

Rejected because clients receive duplicates, provider rate limits multiply and
echo dedupe cannot distinguish intended from accidental sends. Multi-send is an
explicit command.

### Dedupe cross-account events by body/time/sender

Rejected because genuine equal messages can collide and timestamps/order differ.
Only adapter-declared exact message identity/correlation can auto-dedupe.

### Let provider dispatchers choose the route

Rejected because Message creation succeeds before missing/ambiguous routes are
known, permission/capability logic is duplicated per provider and silent no-op
branches can strand queued messages.

### Delete bindings/messages when an account is removed

Rejected because it destroys audit, reply provenance, report facts and
reconciliation. Account and binding lifecycle are temporal.

## Relationship To Existing ADRs

- ADR 0002 keeps provider identity/capability logic in versioned adapters.
- ADR 0003 requires same-tenant thread, binding, occurrence and route relations.
- ADR 0005 requires route/capability state to normalize across app clients.
- ADR 0006 keeps customer/source threads and dispatch in the data-plane.
- ADR 0008 supplies SourceConnection/SourceAccount/raw/normalized foundations.
- ADR 0009 keeps source thread/binding outside Conversation/WorkItem/CRM state.
- ADR 0010 separates author/app actor/provider actor/account route and preserves
  native-provider authorship.

## Follow-Up Decisions

- `INB2-ARCH-005`: transaction sequence, dispatch/realtime revisions and gap
  recovery.
- `INB2-ARCH-006`: route/account permissions and supervisor overrides.
- `INB2-ARCH-008`: Hulee direct messenger capability/evidence matrix.
- `INB2-ARCH-009`: V1 thread/binding/reference migration and cutover.
- `INB2-CON-005`: versioned thread/binding/route/reference contracts.
- `INB2-DB-003`: tenant-safe thread/binding/reference constraints.
- `INB2-SRC-005`/`006`: canonical resolution/dedupe/reconciliation.
- `INB2-MSG-002`/`007`: route-pinned send and echo/out-of-band handling.
