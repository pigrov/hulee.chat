# Inbox V2 MSG-005 Edit, Delete And Tombstones

Status: `done`

Task: `INB2-MSG-005`

Started: `2026-07-19`

Completed: `2026-07-20`

## Scope

`INB2-MSG-005` exposes the existing append-only Message lifecycle model through
one production command boundary. It covers employee edits, local deletion and
provider deletion requests. Provider-observed edit/delete ordering remains the
source reconciliation responsibility established by `INB2-SRC-006`.

The caller supplies only the tenant, Conversation, Message, expected Message
revision, new content or deletion reason and `clientMutationId`. Authorship,
moderation authority, content topology, legal-hold state, original provider
occurrence/reference, SourceAccount, binding generation, route and capability
are trusted server-loaded facts.

Live Telegram, WhatsApp and MAX adapter calls are outside this task. The task
atomically persists a provider-neutral lifecycle operation and exact
`core:provider.message_lifecycle` outbox intent inside the command transaction.
Only dispatch and provider I/O begin after that transaction commits. The
provider runtime which consumes the intent and applies an actual adapter outcome
belongs to the direct-provider/runtime follow-up tasks.

## Lifecycle meanings

Four operations which may look like "delete" in a UI remain different domain
states:

| Operation       | Message state                                                                                            | Content state                                        | Provider I/O                   |
| --------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------ |
| Local UI delete | `local_delete_tombstone`                                                                                 | Retained and hidden by read policy                   | Never                          |
| Provider delete | Pending provider lifecycle operation, then explicit `retain_local` or `provider_delete_tombstone` policy | Retained; this is not erasure                        | Exact original route only      |
| Privacy erasure | Message sequence and authorship anchors remain                                                           | `privacy_erased` with a privacy reason               | Governed by privacy handlers   |
| Retention purge | Message sequence and authorship anchors remain                                                           | `retention_purged` with policy identity and revision | Governed by retention handlers |

Local or provider deletion therefore never physically removes Message,
TimelineItem, MessageRevision, source reconciliation or sync history. Privacy
and retention execution remain owned by `INB2-OPS-010..012`.

## Revision and concurrency rules

- Message revisions are immutable and contiguous.
- A successful edit advances Message, TimelineItem and TimelineContent exactly
  once; a local tombstone advances Message and TimelineItem while retaining the
  original content anchor.
- The Message ID, TimelineItem ID, timeline sequence, Conversation, origin and
  initial participant author never change.
- Commands compare the expected current Message revision. A concurrent edit or
  delete wins once; every stale competitor receives `revision.conflict`.
- At most one Hulee-requested provider operation may be active for a Message.
  `pending`, `accepted` and `outcome_unknown` serialize edit, local-delete and
  provider-delete commands under the same Message row lock; a terminal outcome
  releases the partial-unique database fence.
- A tombstoned Message cannot be edited or resurrected by a stale command.
- A replay with the same principal, mutation ID and request digest returns the
  original result before current Message or provider-route discovery. Reusing
  the mutation ID for different input returns `command.idempotency_conflict`.

## Authorization and provider route

Own-message mutation and moderation are separate authorization paths. Own
mutation and external-message moderation authorize the exact TimelineItem as
their primary resource; internal-message moderation authorizes the exact
Conversation. Every path additionally requires an exact current Conversation
read decision. Provider-route authority is specifically
`core:conversation.read`; another action permission cannot substitute for it.

Every delete path, including deletion of the actor's own Message, pins the
legal-hold decision and its revision. Action, read, authorship, topology,
source-route and legal-hold decisions are checked independently so one broader
permission cannot satisfy a different fence.

A local tombstone has no provider dependency, including for an externally
originated Message. External edit and provider delete additionally require the
same original SourceOccurrence, ExternalMessageReference, SourceAccount,
SourceThreadBinding generation, outbound route and adapter capability revision
through authorization, persistence and provider work. Preferred-account or
fallback rerouting is not expressible.

## Attachment and source authority

An attachment edit proves exact File-view authority for every ready pin. Upload
authority is additionally required only while a File is in `upload_staging`.
The API guard, coordinator and timeline repository carry the same File and
source-authority plans; the transaction then revalidates the live File parent,
Message or StaffNote source, actor, authorization epoch and source locator under
locks.

Destination File parents are prepared and sealed atomically with a one-use
capability. A retained materialized pin must preserve its `fileRevision`,
`fileVersionId` and `objectVersionId`; presentation-only fields may change.
Conversation prelocks use a canonical order, with the destination locked for
update and source-only Conversations locked for share, closing cross-copy TOCTOU
and opposite-direction lock inversion. No lifecycle write occurs before all
File, source, route and current-head checks have passed.

## Atomic persistence and provider work

The authorized coordinator commits the lifecycle mutation as one unit:

- immutable MessageRevision and deterministic current heads;
- tenant-stream change and `core:message.changed` event;
- command/idempotency result and projection outbox;
- for an external edit or provider delete only, a pending
  MessageProviderLifecycleOperation and `core:provider.message_lifecycle`
  outbox intent referencing that exact operation.

Provider I/O is forbidden inside the command transaction. The shared outbox
infrastructure already supplies lease fencing, while the operation loader,
provider adapter invocation and result-application runtime are intentionally
left to `INB2-DMX-005`, the provider parity tasks and `INB2-MSG-007`. Those
consumers must load the exact pending operation and preserve its original
account, binding generation, reference, route and capability fence. Provider
outcomes advance the operation through typed transitions; a provider delete
does not create a local tombstone until an independent local-visibility policy
chooses `tombstone_local`.

## Deferred provider actions

Edit/delete-before-create actions remain keyed and ordered by the exact source
occurrence. Only an `advance` result may append one Message revision or one
provider lifecycle effect. `duplicate`, `stale`, `target_conflicted`,
`ordering_conflict` and `expired` terminal results preserve provenance but do
not mutate the Message or call a provider. Applied effects are anchored to the
exact resulting MessageRevision or provider lifecycle operation so a scalar
revision cannot be reinterpreted later.

## Migration compatibility

The current TimelineItem visibility, not the historical Message origin alone,
selects the lifecycle authorization path. A migration-origin Message with
internal visibility therefore uses internal moderation and read authority.

Migration creation also requires exact equality between the Message automation
causation and the initial revision attribution causation. The database history
compatibility exception is deliberately limited to revision `1`, change kind
`created`, migration origin, trusted-service automation and a
`legacy_unknown`/system author. Later revisions remain subject to the normal
attribution invariant and cannot reuse that exception.

## Verification

The final task gate passed:

- focused contract, core, API, repository and schema suites: `22/22` files,
  `822/822` tests;
- source gate: `83/83` files, `1,244/1,244` tests; preserve/N-1/RBAC gate:
  `3/3` files, `17/17` tests;
- full real-PostgreSQL gate: `35/35` files, `374` passed and `6` opt-in skipped,
  with all `57/57` migrations installed;
- full default Vitest: `381` passed files and `4,222` passed tests (`44` files /
  `427` tests skipped by their declared environment gates);
- `typecheck`, `db:check`, task-scoped ESLint/Prettier, `i18n:check`,
  `encoding:check`, `branding:check` and `native:check` passed;
- the N-1 bundle remained reproducible with migration contract digest
  `bef4a8f76df9224c159ba3b098928a3f177ca45ce59c288e35948b91ec66c067`
  and bundle digest
  `ac2743b36ae701771ef319b6a67aaf06b27c524eb678f83e2ac987a31e67b841`;
- negative regressions cover duplicate, extra and forged source fences; stale
  File/source/route/read/legal-hold revisions; substituted action permission;
  and forbidden post-head FileParent SQL shapes;
- independent final review returned `READY` with no P0/P1 findings.

The workspace-wide lint/format commands are not a clean repository signal while
unrelated user-owned Chromium data exists under `.codex-runtime-logs/` and
unrelated `apps/site` work remains in progress. The exact MSG-005 file set
passed ESLint and Prettier, and the standard full suite passed in one clean
final run.
