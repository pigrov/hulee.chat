# Inbox V2 Baseline

Status: `verified`  
Backlog task: `INB2-BASE-001`  
Snapshot date: `2026-07-10`

## Purpose

This document records the repository state from which Inbox V2 starts. It
separates reusable platform foundations from Inbox V1 compatibility code and
prevents an existing prototype or RIK behavior from being treated as completed
Inbox V2 functionality.

## Snapshot Metadata

- Repository: `D:/vscode/hulee`.
- Branch: `main`.
- Baseline commit: `ca9bada` (`Update workflow landing section`).
- Commit timestamp: `2026-07-10T09:22:27+03:00`.
- Repository files: 672; files under `apps/` and `packages/`: 609.
- Source-code changes at baseline review: none. The working tree contains only
  the Inbox V2 planning documentation created in the preceding task.
- Required quality gate: `pnpm check`.
- Verified result: full `pnpm check` passed after the baseline and architecture
  package were formatted.

## Baseline Verdict

Inbox V1 is a working MVP/compatibility slice for one client and one open direct
conversation. It is not a safe foundation for multi-client groups, clientless
employee chats, exact external-thread routing, resumable realtime, CRM history
or event-backed reporting.

Inbox V2 is the only target domain/read-model slice. Existing source,
authentication, RBAC, event/outbox, storage and client-platform foundations are
reused by ownership rather than copied from V1. `INB2-MIG-001` correctly chose a
fail-closed preserve disposition while the live deployment/data/provider/backup
roots were unclassified. On `2026-07-20` the product owner classified every
current root as disposable pre-production test state. ADR 0016 now selects a
clean-slate replacement with no V1 data migration, dual materialization,
backfill or N-1 V1 runtime requirement.

## Verified Current Slices

- Public API/external-channel inbound can create Client, Conversation, Message,
  Event and Outbox state through the V1 vertical slice.
- Telegram Bot webhook/polling can normalize inbound text/attachments and use
  the same V1 external-channel command path.
- Telegram Bot outbound can consume the V1 `message.sent` outbox event and call
  the adapter when connector/config/egress are valid.
- Direct Telegram/WhatsApp/MAX account onboarding, auth challenge, encrypted
  session, heartbeat/probe and SourceAccount synchronization are implemented.
- Web Inbox V1 can list the first client-direct conversations, open one, render
  messages/attachments, reply and mutate scalar routing with scoped access.

These slices prove useful platform components. They do not prove Inbox V2 group,
realtime, CRM, notification or reporting behavior.

## Reusable Platform Foundations

### Source integration foundation

Reusable:

- `SourceConnection`, `SourceAccount`, `RawInboundEvent` and
  `NormalizedInboundEvent` persistence exists in
  `packages/db/src/schema/tables.ts:493-663`.
- Source repository contracts and SQL implementation exist in
  `packages/db/src/repositories/sql-source-integration-repository.ts:183-344`.
- Provider-neutral identity and conversation resolver inputs exist in
  `packages/contracts/src/source-identity.ts` and
  `packages/contracts/src/source-conversation.ts`.
- Shared normalizer/idempotency/processing helpers and adapter contract tests
  already exist under `packages/contracts/src/source-*`.
- Raw and normalized source events have tenant-scoped idempotency indexes.

Gap:

- Production composition does not yet call `recordRawInboundEvent` or
  `recordNormalizedInboundEvent` for the current message path. The records and
  contracts are a foundation, not a materializing Inbox V2 pipeline.
- Telegram webhook/polling currently calls the external-channel command path
  directly, bypassing raw/normalized source persistence. The source repository
  exposes persistence CRUD/record methods but not a production claim/status/
  replay processing loop yet.

### Direct-account runtime foundation

Reusable:

- Connectors, encrypted sessions, auth challenges, leases, heartbeat and health
  fields exist in `packages/db/src/schema/tables.ts:293-460`.
- Telegram, WhatsApp and MAX direct-account session handlers/probes exist under
  `apps/worker/src`.
- `apps/worker/src/direct-account-session-monitor.ts:17-25` defines bounded
  monitoring for the three direct connector types; the monitor uses session
  leases and bounded concurrency.
- `apps/worker/src/direct-account-source-sync.ts:42-109` synchronizes a healthy
  connector/session into SourceConnection and SourceAccount records.

Gap:

- The direct-account composition currently covers onboarding/auth/session
  health and source-account synchronization, not a complete inbound/outbound
  message listener/dispatcher for all three providers.
- `apps/worker/src/direct-account-source-sync.ts:12-29` assigns one broad
  capability profile to Telegram, WhatsApp and MAX even though their private,
  group, media, lifecycle and receipt capabilities differ.

### Organization, queues and RBAC

Reusable:

- Teams, org units, work queues and employee membership tables exist in
  `packages/db/src/schema/tables.ts:1047-1184`.
- Scoped permissions include `inbox.read`, `message.reply` and conversation
  assignment/routing scopes in `packages/core/src/permissions.ts:89-113` and
  `packages/core/src/permissions.ts:168-196`.
- Current inbox API already resolves scoped access for tenant/org/team/queue and
  assignment operations.

Gap:

- Queue, employee and team routing are mutable scalar fields on Conversation.
  There is no separate WorkItem, optimistic version or temporal assignment
  history.

### Events, outbox, files and delivery attempts

Reusable:

- Current inbound/outbound message writes persist domain event and outbox rows
  in one database transaction in
  `packages/db/src/repositories/external-message-repository.ts:250-275`.
- Event store, outbox, audit, files, attachments and delivery-attempt tables
  already exist.
- Outbox claiming uses `FOR UPDATE SKIP LOCKED` in
  `packages/db/src/repositories/sql-outbox-repository.ts:92-115`.
- Tenant-scoped S3-compatible storage and attachment transfer infrastructure
  can be reused by typed content blocks.

Gap:

- Event records do not provide the Inbox V2 entity revision, conversation
  sequence or durable realtime stream position.
- Outbox rows have no lease owner/expiry or stale-processing reclaim; a worker
  crash after changing a row to `processing` can strand it.
- `apps/worker/src/telegram-outbound-dispatcher.ts:84-107` returns successfully
  when a queued message, connector, matching config or outbound enablement is
  missing. `apps/worker/src/outbox-processor.ts:58-64` then marks that event
  processed, which can leave a Message permanently queued without a retryable
  delivery outcome.

### Client application foundation

Reusable:

- Web/PWA, shared UI, i18n, design tokens, brand profile, native bridge and UI
  slot boundaries are established.
- Current inbox actions already use typed action state and permission-checked
  server operations.

Gap:

- `packages/app-shell/src/index.ts:14-21` is only a minimal runtime/tenant/auth
  state holder. No normalized inbox entity store exists yet, which makes it
  safe to design the V2 store without migrating a large Hulee client cache.

## Inbox V1 Domain And Persistence

### Core model

`packages/core/src/vertical-slice.ts:49-80` currently defines:

- conversation types that name client/internal/support/intake scenarios;
- a required scalar `clientId` on every Conversation;
- employees as a flat `participantEmployeeIds` list;
- queue, employee and team assignment on Conversation;
- only `inbound | outbound` message direction;
- a text-first Message without author, participant, source thread, visibility,
  sequence, revision, reply/forward, reaction or provider receipt state.

This makes the declared `internal_direct` and `internal_group` types
inconsistent with the required client and cannot represent several clients in
one external group.

### Database model

`packages/db/src/schema/tables.ts:1197-1333` currently persists:

- one optional `client_id` on Conversation;
- queue, assigned employee and assigned team on Conversation;
- employee-only conversation participants;
- Message direction/text/status/idempotency without author or ordering revision;
- delivery attempts and attachments as separate tables.

Tenant columns and tenant-aware query predicates exist, but many foreign keys
reference only the global `id` column. Same-tenant relationships are therefore
not universally enforced by composite database constraints.

## Current Message Resolution And Routing

### Inbound

`packages/core/src/external-channel-command-service.ts:74-124`:

1. deduplicates by message idempotency key;
2. builds one string external client handle;
3. finds or creates a Client from that handle;
4. finds the latest open `client_direct` conversation by `clientId`;
5. saves client/conversation/message/event/outbox.

`packages/db/src/repositories/external-message-repository.ts:301-320`
confirms that conversation identity is currently client-based, not exact
external-thread-based.

Consequences:

- different external threads for one client can collapse;
- unknown sender intake immediately becomes a Client;
- provider groups and several participants are not represented;
- an external identity is mixed with CRM identity.

The current lookup/create flow is read-before-write. There is no unique
constraint for `(tenant, contact type, contact value)` and no unique active
conversation key. Concurrent first messages can therefore attempt to create
duplicate Clients/Conversations. A concurrent duplicate idempotency race can
surface a unique-constraint failure instead of returning the existing canonical
result.

Current external ingestion also does not persist conversation participant rows;
participants exist in schema/seed mapping but are not part of this materialized
message flow.

### Outbound

`packages/db/src/repositories/sql-outbound-dispatch-repository.ts:87-111`
selects the first `client_contacts.external_handle` for the Conversation client.
There is no persisted exact source-thread/account binding on the Message.

The current Telegram Bot normalizer takes sender identity from `message.from`,
while send resolves the destination from that client identity in
`packages/modules/src/telegram-channel.ts:433-469`. In a provider group this can
route a reply to a sender's private chat instead of the source group.

Telegram `edited_message`/`edited_channel_post` is accepted by the envelope, but
the current normalizer converts it into the same new-message shape rather than
a lifecycle revision (`packages/modules/src/telegram-channel.ts:342-353` and
`415-454`).

The V1 message event name is also semantically overloaded: a queued outbound
Message emits `message.sent`, and the worker consumes that factual-looking event
as a dispatch command. Inbox V2 must keep dispatch intent and confirmed
sent/delivery facts distinct. `INB2-CLEAN-002` removes the overloaded V1 event
and dispatcher from production composition before the clean baseline is
activated; no preserve cutover or observation window applies.

## Correctness And Compatibility Risks

| Severity | Risk                                                                           | Current evidence                                                              | Inbox V2 owner                                 |
| -------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- | ---------------------------------------------- |
| P0       | Group reply can target sender private identity instead of source group         | Telegram normalizer/send uses sender-derived identity                         | `INB2-ARCH-004`, `INB2-CON-005`, `INB2-TG-003` |
| P0       | Concurrent first inbound can create duplicate Client/Conversation              | Read-before-write lookup; no canonical thread/open-conversation uniqueness    | `INB2-SRC-005`, `INB2-SRC-006`, `INB2-DB-003`  |
| P0       | Queued outbound can be stranded after a non-throwing dispatcher skip           | Dispatcher returns; generic outbox marks processed                            | `INB2-MSG-002`, `INB2-SRC-008`, `INB2-DMX-004` |
| P0       | Queue/assigned filters and deep links operate only on the first 50 global rows | SQL limit precedes RBAC/filter/selection                                      | `INB2-API-001`, `INB2-API-002`                 |
| P0       | No durable snapshot/realtime cursor or revision                                | Refresh-only client; no EventSource implementation                            | `INB2-ARCH-005`, `INB2-RT-001`, `INB2-RT-002`  |
| P1       | Telegram edit is materialized as a new-message shape                           | Envelope accepts edited events; normalizer has no lifecycle event             | `INB2-SRC-003`, `INB2-MSG-005`                 |
| P1       | External ingestion has no participant materialization                          | Production save path inserts client/conversation/message but not participants | `INB2-SRC-004`, `INB2-DB-002`                  |
| P1       | Queued command is named `message.sent`                                         | V1 event is both dispatch intent and apparent fact                            | `INB2-CON-008`, `INB2-CLEAN-002`               |
| P1       | One broad direct capability profile overstates provider parity                 | Shared WA/TG/MAX capability object                                            | `INB2-DMX-001`                                 |
| P1       | Outbox processing rows have no stale lease reclaim                             | `processing` status has no owner/expiry                                       | `INB2-SRC-002`                                 |

## Current Inbox API And UI

### API contract

`packages/contracts/src/internal-api-v1.ts:60-110` requires one client display
identity for every list item and returns a combined response containing the
conversation list, selected conversation and text-first messages.

There are no V1 fields for:

- participant roster or author;
- multiple/unknown clients;
- exact source binding and available routes;
- WorkItem/assignment version/history;
- unread/read cursor;
- timeline/message/entity revision;
- snapshot or realtime cursor;
- keyset pagination.

### Query behavior

`apps/api/src/internal-inbox-service.ts:704-811`:

- joins Client with `INNER JOIN`;
- selects only `client_direct` and `open` conversations;
- aggregates message counts and last text during each list query;
- orders the result and applies `LIMIT 50`;
- loads the oldest 200 selected messages by `(created_at, id)`.

Authorization, queue/assignment filters and selected-conversation lookup are
applied in memory after that first 50-row query
(`apps/api/src/internal-inbox-service.ts:398-417`). Therefore filtered results
can be incomplete and a deep-linked conversation outside the first page can be
silently replaced by the first visible row. Long timelines have no keyset or
`aroundMessageId` path.

### Client behavior

- `apps/web/src/inbox-api-client.ts:103-137` fetches one
  `/internal/v1/inbox` snapshot with `cache: no-store`.
- `apps/web/app/page.tsx:251-314` renders the list on the server and exposes a
  refresh link.
- `apps/web/src/inbox-action-form.tsx:35-84` calls `router.refresh()` after reply
  or routing mutation.
- No EventSource, SSE `Last-Event-ID` or persisted realtime client reducer exists
  in `apps/`, `packages/` or `packages/app-shell`.

This implementation is simpler than RIK, but it is refresh-based rather than a
production realtime inbox.

### Notifications, CRM and reporting

- Notification endpoint/event tables exist at
  `packages/db/src/schema/tables.ts:1485-1528`, but there is no production
  notification recipient/fan-out/read integration using them.
- Client runtime is limited to the current Client/contacts/source/responsible
  shape. Pipeline stage history, typed custom fields and client-owner history
  are not implemented.
- Per-employee conversation read state, durable inbox projection and manager
  fact/aggregate reporting do not exist.

## Current Tests And Quality Gates

Existing useful coverage includes:

- core vertical-slice/message/routing tests;
- tenant isolation and repository tests;
- source contract, idempotency, normalizer and retry/DLQ tests;
- Telegram Bot adapter/inbound/outbound tests;
- direct-account auth/session monitor/probe tests;
- internal API permission/routing/reply tests;
- inbox API client/action tests;
- root format, lint, typecheck, database, i18n, encoding, branding and native
  checks.

The baseline does not yet include tests for:

- several clients and several employees in one provider group;
- clientless internal/external employee chats;
- canonical external thread across several direct accounts;
- exactly one temporal primary WorkItem assignment;
- message author/sequence/revision/lifecycle parity;
- snapshot/SSE cursor handshake and gap recovery;
- normalized sidebar/timeline state;
- logical notification recipient/dedupe policy;
- CRM stage/custom-field history and historically correct reporting.

## Current Clean-Slate Boundary And Removal Requirements

`INB2-MIG-001` found state, provider sessions, backups and unknown roots and
correctly failed closed. The product owner subsequently classified every current
root as disposable test state. ADR 0016 now selects:

`freeze deploy -> stop V1 writers/providers -> delete V1 runtime/schema -> one
V2 baseline -> reset -> verify -> resume V2-only delivery`.

The pre-gate boundary required:

- do not deploy application/provider runtime from `main`;
- keep public/event/module version identifiers independent from Inbox V1;
- retain generic non-Inbox auth/admin/integration `/internal/v1` surfaces;
- fail unfinished V2 message surfaces closed without legacy fallback;
- do not add new migrations or feature work outside the cleanup sequence;
- do not import IDs, authors, routes, rosters or provider outcomes from V1;
- prevent stale application images, webhooks, workers and sessions from
  reconnecting to the new schema epoch.

`INB2-CLEAN-GATE` passed on `2026-07-22`; its receipt is
`docs/product/inbox-v2-clean-gate.md`. A successful full `Check` for a push to
`main` now hands its exact checked SHA to the V2-only deployment workflow;
direct-push and manual bypasses are absent. Provider egress remains disabled
until a separate adapter activation is reviewed.

The old preserve/N-1/backfill evidence remains historical. `INB2-CLEAN-002`
owns runtime/provider drain, `INB2-DB-011` owns the clean baseline and reset,
and `INB2-CLEAN-003` removes dead compatibility tooling. The exact historical
inventory remains in
`docs/product/inbox-v2-mig-001-inventory-and-disposition.md` as a deletion map.
The active policy is defined by ADR 0016 and
`docs/product/inbox-v2-migration-and-cutover.md`; ADR 0014 is superseded for this
epoch.

The approved separation of immutable technical history from purgeable content,
data-class retention, legal hold, subject export/delete, audit evidence and
backup/restore erasure is defined by ADR 0015 and
`docs/product/inbox-v2-data-lifecycle-and-privacy.md`.

## Baseline Acceptance Checklist

- [x] Current contracts, schema, API, worker, UI and tests are inventoried.
- [x] Reusable platform foundations are separated from Inbox V1 limitations.
- [x] Compatibility risks and the superseding clean-slate decision are recorded.
- [x] Current code paths are referenced with reproducible file/line locations.
- [x] Final `pnpm check` result is recorded after formatting the first work
      package.

## Verification Record

Targeted baseline suite:

```powershell
pnpm exec vitest run packages/contracts/src/internal-api-v1.test.ts packages/contracts/src/source-normalizer-contract.test.ts packages/core/src/vertical-slice.test.ts packages/core/src/external-message.test.ts packages/core/src/conversation-routing.test.ts packages/db/src/repositories/external-message-repository.test.ts packages/db/src/repositories/sql-source-integration-repository.test.ts packages/db/src/repositories/sql-outbox-repository.test.ts apps/api/src/internal-inbox-service.test.ts apps/worker/src/telegram-outbound-dispatcher.test.ts apps/worker/src/telegram-polling-sweeper.test.ts apps/worker/src/direct-account-session-monitor.test.ts apps/web/src/inbox-api-client.test.ts
```

Result on `2026-07-10`: 13 test files passed, 103 tests passed, duration 2.94s.

Full `pnpm check` result on `2026-07-10`:

- format, lint and TypeScript checks passed;
- 145 test files passed, 724 tests passed;
- `db:check`, `i18n:check`, `encoding:check`, `branding:check` and
  `native:check` passed.
