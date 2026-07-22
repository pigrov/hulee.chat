# Inbox V2 MSG-006 Reactions And Provider Receipts

Status: `done`

Task: `INB2-MSG-006`

Started: `2026-07-22`

Completed: `2026-07-22`

## Scope

`INB2-MSG-006` exposes the existing append-only reaction and Message transport
fact models through production command and source-reconciliation boundaries.
It covers employee-authored reaction set, replace and clear commands plus
provider-observed accepted, sent, delivered, failed and exact-message read
facts.

The public reaction command accepts only tenant, Conversation, Message,
expected revision, reaction value and `clientMutationId`. The actor participant,
TimelineItem, reaction slot, original SourceOccurrence,
ExternalMessageReference, SourceAccount, SourceThreadBinding, route and adapter
capability are trusted server-loaded facts. Caller-supplied provider authority
cannot enter the authorized mutation.

Live Telegram, WhatsApp, MAX or other provider calls remain outside this task.
An external reaction atomically creates a pending domain transition and one
`core:provider.message_reaction` outbox intent. Provider runtimes consume that
intent only after commit and later return an explicit provider observation or
result; the command path never claims provider success in advance.

## Reaction semantics

Each reaction preserves a semantic slot consisting of the exact Message,
available actor identity and provider capability cardinality. Actor identity is
retained as an exact participant when the provider supplies it; aggregate,
unattributed and provider-system observations remain explicit instead of being
assigned to an invented participant.

- `set` creates the slot head from an inactive slot.
- `replace` advances the same actor slot and retains its identity.
- `clear` advances the slot to an inactive state without deleting history.
- An internal command becomes active in the command transaction and creates no
  provider work.
- An external command becomes `pending_external`; only a provider result or
  observation may confirm or reject it.
- Replays return the original transition before mutable Message, route or
  capability discovery. Reusing the same mutation ID for different input is an
  idempotency conflict.

Reaction transitions and slot heads are append-only/CAS-protected. A stale
Message, TimelineItem, reaction revision or slot head cannot overwrite a newer
reaction.

## Provider delivery and receipt truth

Transport states are immutable facts, not one synthetic status column. The
model records only evidence supplied by the owning provider adapter:

| Fact | Meaning |
| --- | --- |
| `accepted` | The provider explicitly accepted responsibility for the Message. |
| `sent` | The provider reported its send milestone. |
| `delivered` | The provider reported delivery to the remote endpoint. |
| `read` | The provider reported a receipt for this exact external Message. |
| `failed` | The provider returned an explicit failure fact and diagnostic class. |

An absent provider fact remains absent. Hulee does not infer `sent` from an
outbox dequeue, `delivered` from `accepted`, `read` from an employee opening a
Conversation, or `failed` from a timeout whose provider outcome is unknown.
Provider-specific ordering and evidence stay in the normalized observation
proof so later analytics can distinguish actual provider truth from local
workflow state.

## Employee read cursor is independent

`EmployeeConversationState.lastReadSequence` is a per-employee UI projection.
It controls unread state for that employee only. A provider receipt is an
external Message transport fact and does not update an employee cursor;
advancing an employee cursor does not create a provider receipt. Both paths use
separate tables, commands and stream effects and can advance in either order.

This distinction also applies to group conversations: several employees may
have different local cursors while one or more remote participants generate
provider receipt evidence for the same external Message.

## Authorization and exact external route

Every app-authored reaction requires `core:message.react` on the exact current
TimelineItem and the appropriate exact Conversation read permission. An
external reaction additionally requires `core:source_account.use` on the
original SourceAccount.

The provider route is one-shot and must remain tied to all of the following:

- the original SourceOccurrence and ExternalMessageReference;
- the original SourceAccount and SourceThreadBinding;
- the current account, binding, provider-access, capability and route
  descriptor revisions;
- an adapter capability which explicitly supports the exact set, replace or
  clear operation at the command timestamp;
- a route policy with no preferred binding and no fallback bindings.

Only an `explicit_occurrence` selection is accepted. A changed binding,
capability, route-policy revision, substituted account, preferred route,
fallback route or reroute attempt fails the transaction before any reaction,
stream, outbox or provider effect is committed.

## Atomic command persistence

The authorized reaction coordinator commits one closure:

- reaction transition and current slot head;
- exact tenant-stream change and `core:message.changed` event;
- command/idempotency result and projection outbox intent;
- for an external reaction only, the exact one-use outbound route and one
  `core:provider.message_reaction` provider-I/O intent.

Route preparation, live resource/revision checks, reaction CAS and stream seal
run in the same database transaction. Provider I/O is forbidden inside that
transaction.

## Provider-observed source reconciliation

The source-action router now exhaustively handles all five deferred Message
action kinds. Edit/delete use the lifecycle adapter; reaction, delivery and
receipt use the Message-effect adapter. Both run inside the reconciliation
repository's ambient transaction and preserve the caller's result ordering.

Only a monotonic `advance` may append a reaction or transport fact. Duplicate,
stale, ordering-conflict and target-conflict actions retain their source
provenance without mutating the Message effect. Provider-observed effects create
one event/projection closure and are structurally forbidden from creating a
provider-I/O outbox intent, preventing source echoes from being sent back to the
provider.

## Runtime boundary

This task owns provider-neutral commands, persistence and observation
reconciliation. Provider adapters still own the actual API call, normalization
of provider-native reaction/receipt payloads, capability discovery and the
explicit accepted/failed/outcome-unknown response. Echo and out-of-band
outbound correlation belong to `INB2-MSG-007`; direct-messenger adapter parity
belongs to the corresponding DMX tasks.

## Verification

The final task gate covers:

- contract and authorization closure for exact TimelineItem, Conversation and
  SourceAccount decisions;
- internal and external set/replace/clear command fixtures, replay, denial,
  stale revision, tampering and no-fallback routing;
- atomic PostgreSQL external-reaction commit and route-policy drift rollback;
- provider reaction/delivery/receipt ordering, duplicate/stale closure and a
  hard prohibition on provider I/O during provider-observed reconciliation;
- real PostgreSQL proof that provider receipt facts and employee read cursors
  advance independently;
- repository-wide type, source, schema and standard quality gates.

Exact test counts and command results are recorded in the task entry in
`docs/product/inbox-v2-backlog.md`.

Final verification on `2026-07-22` passed the API reaction suite (`26/26`), the
source gate (`80/80` files, `1,218/1,218` tests), focused DB/source suites
(`220/220`), and the full disposable PostgreSQL gate (`34/34` files, `377`
passed, `6` skipped) after installing the single clean baseline. Repository-wide
`pnpm check` passed `352` default test files and `4,082` tests (`33` files and
`385` tests skipped), together with format, lint, typecheck, DB/schema, i18n,
encoding, branding, native and clean-slate guards. Two independent final reviews
reported `READY` with no P0/P1 findings.
