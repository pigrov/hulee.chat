# Inbox V1 Inventory And Preserve Disposition

- Status: `completed inventory; preserve path selected`
- Owner task: `INB2-MIG-001`
- Evidence revision: `mig-001-preserve-2026-07-16-r1`
- Observed at: `2026-07-16T01:15:08+03:00`
- Applies to: repository code, the current developer data plane, the known Hulee
  shared SaaS data plane and unknown/unregistered isolated or on-prem deployments.

## Decision

Inbox V1 is **not eligible for the pre-production destructive fast path**.
The additive `preserve` path from ADR 0014 is active.

This is a fail-closed decision, not an assertion that every observed row is real
customer data. The known shared SaaS data plane is live, contains Inbox V1 data,
active application/API access, connected provider sessions, provider state,
object data and a historical V1 database backup. The current local database is
also non-empty, has pending outbox work and contains legal-hold/deletion/restore
fixtures. Neither deployment has an approved disposable manifest. The absence
of an authoritative fleet, external-consumer and off-host backup registry leaves
additional deployments and copies unknown; ADR 0014 classifies unknown as
`preserve`.

Consequences:

- `INB2-MIG-002` and `INB2-MIG-003` are reactivated;
- the preserve-only V1 snapshot upgrade, N-1 compatibility, RBAC dry-run and
  rollback evidence in `INB2-DB-008` are mandatory;
- `db:inbox-v2:reset` must not be used against the known shared SaaS or current
  local database;
- Public API `/v1` remains an independent contract and must be mapped to a V2
  facade or retired through its own explicit contract decision;
- provider listener/dispatch authority must be fenced and reconciled before
  cutover;
- V1 implementation removal cannot delete shared platform/source/auth tables,
  audit/history, object or backup roots by table-name convention.

This evidence is point-in-time inventory. It is deliberately insufficient as a
destructive reset receipt. A later owner decision may classify a new personal
local or ephemeral CI target as disposable only through a fresh manifest and
the exact DB/object evidence contract implemented by `INB2-DB-008`.

## Evidence Method And Safety Boundary

The inventory used four independent, read-only passes:

1. repository-wide `rg` searches followed by producer/consumer call-chain
   review across contracts, core, DB repositories, API, worker, web, modules,
   seed, tests and deployment files;
2. GitHub Actions run/variable inspection, DNS and public health checks;
3. read-only SQL counts/status/shape queries against the current local and known
   shared SaaS PostgreSQL databases;
4. read-only MinIO usage/version checks and host backup metadata/dump-shape
   inspection. Message/file contents, credentials, encrypted sessions and
   backup row values were not read or copied.

All code-path hits are classified below. Facts that cannot be proven from the
repository or known host are recorded as explicit `unknown/preserve` roots with
an owning follow-up task. They are not silently converted into absence.

## Fast-Path Eligibility Result

| ADR 0014 condition                                                  | Result                  | Evidence                                                                                                                                |
| ------------------------------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| No supported production/shared/isolated/on-prem deployment          | **fail**                | A known live shared SaaS data plane and successful recent deployment were verified; it has no approved disposable classification.       |
| No promised or active Public API consumer                           | **unknown/fail closed** | Public contract routes and non-revoked API access exist; no last-used/access registry proves the absence of an external consumer.       |
| Every DB/object/log/backup copy is empty or explicitly disposable   | **fail**                | Known databases are non-empty; object, database-backup and configuration-copy roots are also non-empty and have no disposable approval. |
| No active V1 provider session/listener/dispatch or uncertain effect | **fail**                | Active provider/auth/session state exists, and the local upgrade fixture has pending outbox work requiring reconciliation.              |
| No valuable customer, legal-hold, audit or restore obligation       | **unknown/fail closed** | No reviewed production governance profile exists; governance fixtures and live audit/auth/provider/backup state require preservation.   |
| No unknown V1 deployment or consumer                                | **fail closed**         | No authoritative fleet/on-prem registry, supported-image inventory or external-consumer registry exists.                                |

The outcome is deterministic: at least one failed or unknown condition selects
`preserve`; all six are failed or unknown here.

## Deployment And Runtime Inventory

| Deployment/root                                                   | Observed state                                                                                                    | Classification                                                 | Required action                                                                                                                                 |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Known shared SaaS data plane                                      | Live customer data plane with active application, provider and persistent data state.                             | `preserve`                                                     | Expand/backfill in place; MIG-006 proves scoped DB+object restore and authority fencing; OPS-007 later productizes it; never reset.             |
| Current developer Docker data plane                               | Persistent PostgreSQL and MinIO; non-empty V1/V2/governance fixtures and pending outbox.                          | `preserve` until a separate explicit choice                    | Retain as the representative V1-upgrade/reconciliation fixture for DB-008/MIG-003. A different clean target supplies disposable-reset evidence. |
| GitHub Actions check/build runner                                 | No PostgreSQL/MinIO service or durable Inbox data plane in the check job; integration tests can skip without DB.  | Per-run `ephemeral_ci`, but not yet an adequate migration lane | Add real ephemeral PostgreSQL/MinIO install and preserve-upgrade lanes. Do not use this fact to classify deployed data.                         |
| Isolated SaaS/on-prem/company deployments                         | No registered runtime manifest found. Central fleet management and production Helm packaging are not implemented. | `unknown` => `preserve`                                        | MIG-006 signs scoped fleet/package/upgrade/restore evidence; OPS-007/009 later reuse and productize it.                                         |
| Historical images, off-host replicas/backups and external exports | GitHub token could not enumerate all GHCR versions; no authoritative replica/snapshot/export registry exists.     | `unknown` => `preserve`                                        | MIG-006 classifies every supported image and V1-bearing copy before removal; later release/OPS registries productize the evidence.              |

### Known shared SaaS snapshot

Observed on `2026-07-16` through read-only queries. Exact host/topology, row and
object counts, backup paths and digests are retained in a restricted operator
record and intentionally excluded from this public repository.

| Evidence class      | Public result                                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------------------------------- |
| deployment          | A live shared SaaS data plane is deployed and serving application traffic.                                            |
| V1 business state   | Client, Conversation, Message, File and attachment state is non-empty.                                                |
| events and outbox   | Shared event/outbox state is non-empty; a point-in-time terminal observation is not future quiescence evidence.       |
| access and auth     | Non-revoked API access and active application-session state exist.                                                    |
| provider state      | Active source, connector and encrypted provider-session state exists across direct and bot integrations.              |
| object storage      | The live bucket is non-empty and does not reconcile one-to-one with DB file rows; version protection is insufficient. |
| governance evidence | Governance roots were checked; their observed state is not disposal authority for other retained data.                |

The DB file-key inventory and live bucket inventory do not reconcile one-to-one.
No key-by-key reconciliation or deletion API exists in the current storage
abstraction. The mismatch is therefore a preserve/backfill diagnostic, not
permission to delete an apparent orphan.

Provider heartbeat/state changed shortly before the snapshot. Current rows are
not a quiescent cutover point even when the observed shared outbox state appears
terminal.

### Current developer snapshot

| Root/state                                                |                                                                 Count or fact |
| --------------------------------------------------------- | ----------------------------------------------------------------------------: |
| tenants                                                   |                                                          `42` fixture tenants |
| V1 clients / contacts / conversations                     |                                                                   `3 / 2 / 3` |
| V1 messages / delivery attempts                           |                                                                       `7 / 1` |
| V1 files / attachments                                    |                                                                       `0 / 0` |
| event store / outbox                                      |                                                                   `285 / 267` |
| pending / processed outbox                                |                                                                    `252 / 15` |
| processed `message.sent` rows                             | `3`; two outbound Messages remain `queued` without matching delivery evidence |
| audit rows                                                |                                                                          `36` |
| source/provider/session/raw/normalized/notification roots |                                                empty in the observed local DB |
| V2 conversations / timeline items                         |                                                                     `10 / 12` |
| V2 deletion runs / legal-hold heads / restore-ledger rows |                                                                 `55 / 8 / 19` |
| local MinIO                                               |                                              `0` objects; versioning disabled |

The rows look fixture-generated, but row shape is not disposal authority.
Pending outbox, already-created V2 state and governance/hold fixtures make a
database-wide reset unsafe until a separate owner-approved disposition exists.

### Backup and secret-copy roots

The known shared environment contains a valid historical compressed PostgreSQL
dump with V1 business rows plus shared event/outbox, tenant, API and auth/session
state. Historical environment/release configuration copies also exist. Their
contents were not inspected and they are treated as credential/session-key
backup roots. Exact paths, filenames, counts, sizes and digests are retained in
the restricted operator evidence rather than this public repository.

The deploy workflow has no PostgreSQL + object snapshot/restore gate. No backup
file under the known deploy path proves the absence of off-host snapshots,
provider copies or operator exports. The SQL dump and environment backups must
be covered by finite ADR 0015 retention/erasure and secret-rotation evidence;
dropping V1 tables cannot remove them.

## Repository Producer And Consumer Inventory

Every production and compatibility path found by the repository-wide search is
assigned below. Line references identify the reviewed revision; symbol/path
ownership remains authoritative if lines move.

| ID  | Surface and role                                                 | V1 read/write or side effect                                                                                                                      | Evidence                                                                                                                                            | Cutover/removal owner                                                                                                                          |
| --- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| C01 | Public API composition; producer/consumer                        | API-key auth, V1 commands, V1 audit/event/outbox                                                                                                  | `apps/api/src/index.ts:107-123`; `apps/api/src/http/public-api-handler.ts:342-375`                                                                  | MIG-002/MIG-005; keep `/v1` as tested V2 facade unless independently retired                                                                   |
| C02 | Public client registration; producer                             | Reads external-handle contact; writes Client/contact/event/outbox                                                                                 | `apps/api/src/public-api-command-service.ts:50-92`; `packages/db/src/repositories/external-message-repository.ts:224-237`                           | MIG-002/MIG-005/MIG-007                                                                                                                        |
| C03 | Public inbound; producer                                         | Read-before-write Client/open `client_direct`; writes Conversation/Message/file/attachment/event/outbox                                           | `public-api-command-service.ts:95-156`; `external-message-repository.ts:240-263`                                                                    | SRC-002 through SRC-007, MIG-002/MIG-005                                                                                                       |
| C04 | Public outbound/status; producer/consumer                        | Writes queued Message + overloaded `message.sent`; reads legacy delivery state                                                                    | `public-api-command-service.ts:159-201`; `public-api-handler.ts:291-311`                                                                            | SRC-009, MIG-002/MIG-005                                                                                                                       |
| C05 | Generic external channel command; producer                       | Resolves a sender handle to the latest open client-direct Conversation and performs full V1 ingest                                                | `packages/core/src/external-channel-command-service.ts:74-124`                                                                                      | SRC-003 through SRC-007, MIG-005/MIG-007                                                                                                       |
| C06 | Telegram Bot webhook; live producer                              | Normalizes provider request directly into V1; writes connector diagnostics                                                                        | `apps/api/src/http/telegram-webhook-handler.ts:98-336`; wiring `apps/api/src/index.ts:259-292`                                                      | TG-001 through TG-004, SRC-001 through SRC-009, MIG-005                                                                                        |
| C07 | Telegram Bot polling; live producer                              | Second V1 inbound path and polling cursor/diagnostic writes                                                                                       | `apps/worker/src/telegram-polling-sweeper.ts:396-452,548-677`                                                                                       | TG-001 through TG-004, SRC-001 through SRC-009, MIG-005                                                                                        |
| C08 | Telegram normalization; semantic mapper                          | Treats sender identity as the client key; group thread is split by sender and edits become new messages                                           | `packages/modules/src/telegram-channel.ts:331-358,419-458`                                                                                          | SRC-003 through SRC-006, TG-002/TG-003                                                                                                         |
| C09 | Telegram reply/dispatch; external side effect                    | Reads queued V1 Message + first client handle, calls provider, then updates delivery/message/diagnostics                                          | `apps/worker/src/telegram-outbound-dispatcher.ts:73-180`; `sql-outbound-dispatch-repository.ts:87-191`                                              | SRC-009, TG-002/TG-003, MIG-004/MIG-005                                                                                                        |
| C10 | Direct Telegram/WA/MAX runtime; auth/state producer              | Writes connector/session/challenge/source-account state; currently has no message listener/dispatcher despite declared receive/reply capabilities | `apps/worker/src/runner.ts:58-80`; `direct-account-source-sync.ts:12-109`; session monitor/auth sweeper callers                                     | TG-001 through TG-004 and corresponding WA/MAX tasks; preserve auth/source roots                                                               |
| C11 | Web Inbox; consumer/producer                                     | Reads V1 DTO, posts reply/routing and separately reads audit                                                                                      | `apps/web/src/actions.ts:133-204`; `apps/web/src/inbox-api-client.ts:103-213`; `apps/web/app/page.tsx:144-240`                                      | UI/PRJ/realtime V2 tasks, MIG-005/MIG-007                                                                                                      |
| C12 | Internal Inbox API/query; consumer/producer                      | `/internal/v1/inbox`, reply, routing and file routes; selects 50 Conversations before RBAC filtering and the first 200 oldest Messages            | `apps/api/src/http/internal-api-handler.ts:470-518,997-1021,1153-1168`; `internal-inbox-service.ts:398-438,730-862`                                 | PRJ-001 through PRJ-004, MIG-005/MIG-007                                                                                                       |
| C13 | Routing; producer + audit                                        | Updates scalar queue/team/assignee routing and event/outbox, then writes a separate non-atomic audit row                                          | `packages/core/src/conversation-routing.ts:38-76`; `internal-inbox-service.ts:257-318`                                                              | DB-004, WRK-002/WRK-003, RBAC/command path, MIG-002/MIG-005, OPS-013                                                                           |
| C14 | File content; consumer                                           | Authorizes through V1 File -> attachment -> Message -> Conversation and calls S3 `getObject`                                                      | `apps/api/src/internal-file-service.ts:32-75`; `sql-file-access-repository.ts:68-123`; web proxy `apps/web/app/files/[fileId]/route.ts:17-37`       | MSG/file V2 tasks, MIG-005/MIG-007                                                                                                             |
| C15 | Attachment transfer; producer/consumer + provider/S3 side effect | Telegram download -> S3 put -> silent File status/metadata update; no lease/event/outbox/audit                                                    | `apps/worker/src/telegram-attachment-transfer.ts:68-190`; `sql-attachment-transfer-repository.ts:90-154`                                            | MSG/SRC-009, OPS-011, MIG-003/MIG-005                                                                                                          |
| C16 | Shared V1 outbox; consumer                                       | Claims only `pending`, marks unsupported/no-op events processed, has no stale processing reclaim                                                  | `apps/worker/src/outbox-processor.ts:34-81`; `packages/db/src/repositories/sql-outbox-repository.ts:92-145`                                         | SRC-009, MIG-002/MIG-004/MIG-005                                                                                                               |
| C17 | Connector diagnostics; secondary JSON copy                       | Best-effort provider/message/request/error/cursor snapshots; some write failures are swallowed                                                    | dispatcher, polling and webhook files above; connector repository                                                                                   | SRC-008, OPS-010/OPS-013, MIG-003                                                                                                              |
| C18 | `saveReply` compatibility; dormant producer                      | Can recreate V1 Message/event/outbox; no production caller found, but exported interface and tests remain                                         | `packages/core/src/repositories.ts:6-19`; `drizzle-tenant-workspace-repository.ts:165-172`                                                          | MIG-005/MIG-007                                                                                                                                |
| C19 | MVP seed; producer                                               | Creates persisted V1 tenant/admin/client/conversation/message/event/outbox/API key and prints identifiers to logs                                 | `scripts/db/seed-mvp.ts:55-146`; workspace repository/mapper                                                                                        | DB-008 V2 bootstrap, MIG-005/MIG-007; log lifecycle OPS-010                                                                                    |
| C20 | Raw/normalized source repository; shared schema target           | Production Telegram paths currently bypass it; V2 relations already reference these roots                                                         | `tables.ts:590-812`; `sql-source-integration-repository.ts`; migration `0029`                                                                       | SRC-001 through SRC-008; retain/migrate, never blanket-drop                                                                                    |
| C21 | Notification/report/search consumers                             | Notification tables exist but no production Inbox writer found; no V1 report/search/Redis/Elastic materializer found                              | `tables.ts:1843-1887` plus repo-wide search                                                                                                         | NOT/REP tasks; unknown external BI/search stays preserve under OPS-011                                                                         |
| C22 | Tests and fixtures; compatibility consumers                      | Contract/core/DB/API/worker/web tests encode V1 semantics and can keep obsolete code reachable                                                    | `public-api-v1.test.ts`, `internal-api-v1.test.ts`, vertical-slice/repository/handler/worker/web suites                                             | Migrate with MIG-005; remove obsolete fixtures with MIG-007                                                                                    |
| C23 | Tenant admin routing-audit UI; consumer                          | Reads V1 `conversation.routing.updated` records from shared `audit_log` and renders them with access-audit records                                | `apps/web/app/admin/audit/page.tsx:103-139`; `sql-security-audit-repository.ts:216-248`                                                             | MIG-005 keeps a typed V2 audit projection; OPS-013 preserves/minimizes/lifecycles historical evidence; MIG-007 removes only obsolete semantics |
| C24 | Deployment egress policy/status; global producer and consumer    | Worker monitor writes global egress health/details; provider runtime and platform/API/Web surfaces read/write routing policy/status               | `apps/worker/src/egress-monitor.ts`; `apps/worker/src/policy-egress-runtime.ts`; `apps/web/src/platform-egress-actions.ts`; SQL egress repositories | Preserve shared deployment routing/health state; TG-001/DMX tasks reuse it, OPS-009/010/013 own packaging/lifecycle; never drop with V1        |

### Material defects exposed by the inventory

These are cutover requirements, not separate permission to patch V1:

1. Telegram group messages are resolved by sender rather than exact external
   thread; a reply can target the sender's private chat instead of the group.
2. A provider send occurs before durable delivery outcome. A crash can produce
   an uncertain effect, while several early-return paths are still marked
   `processed` by the generic outbox processor.
3. `outbox.processing` has no lease/reclaim path.
4. Public API outbound uses a synthetic accepted adapter but no non-Telegram
   transport worker, so a Message can remain queued indefinitely.
5. Public API metadata/outbound attachment fields are accepted by the contract
   but discarded by the current command path.
6. Inbound Client/Conversation/idempotency resolution is read-before-write and
   is race-prone.
7. UI pagination/filter order can make the list and selected chat disagree:
   RBAC filtering occurs after a 50-row query, and only the first 200 oldest
   Messages are returned.
8. Attachment/object and SQL transitions are non-atomic and silent, matching
   the observed DB/object count mismatch.

## Stored-Copy And Lifecycle Registry

The ADR 0015 class is a target classification. Current V1 arbitrary JSON does
not yet carry executable class/purpose/expiry metadata, so every preserve
mapping requires MIG-003 diagnostics rather than an inferred retention rule.

| ID  | Physical/logical copy                                                                              | Target ADR 0015 class                                                                               | Current observation and risk                                                                                                          | Preserve/cutover/delete mapping                                                                                                               |
| --- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| D01 | `clients`, `client_contacts`                                                                       | `core:client_contact_profile`                                                                       | PII/contact values and scalar responsible employee                                                                                    | MIG-003 maps identity/contact provenance; OPS privacy handlers remove identity links without deleting unrelated group facts                   |
| D02 | `conversations`, `conversation_participants`                                                       | `core:conversation_state`, `core:participant_membership`, work/assignment classes                   | V1 has optional one Client and scalar queue/assignee/team; group roster is not representable                                          | MIG-003 creates explicit links/memberships/WorkItems or blocking diagnostics                                                                  |
| D03 | `messages.text/status`                                                                             | `core:timeline_item_envelope`, `core:message_content_blocks`                                        | Canonical content with no author/thread/sequence/revision                                                                             | MIG-003 preserves accepted facts and reports unknown provenance; MIG-005 switches writes; OPS lifecycle purges content/tombstones             |
| D04 | `message_delivery_attempts`                                                                        | `core:outbound_dispatch_attempt_and_artifact`, reconciliation                                       | Provider ID/outcome may exist; queued/processed-without-attempt is not delivery proof                                                 | MIG-003 classifies uncertainty; SRC-009/MIG-004 fence future dispatch; never blindly replay                                                   |
| D05 | `files` row and JSON metadata                                                                      | `core:file_metadata`                                                                                | Storage key, name, media type, size/status; metadata may duplicate provider/source facts                                              | MIG-003 key-by-key manifest; OPS-011 delete/verify handler                                                                                    |
| D06 | `message_attachments` and `source_url`                                                             | file parent relation plus `core:source_occurrence_and_external_reference`                           | Provider attachment ID, URL and arbitrary metadata can be persisted; observed cardinality grants no disposal authority                | MIG-003 preserves relation/provenance; OPS-011 removes every metadata copy                                                                    |
| D07 | MinIO object bytes and S3 object metadata                                                          | `core:file_original_binary`; versions/backups use `core:backup_copy_or_object_version`              | Live non-empty object state does not reconcile one-to-one with DB file rows; metadata can contain PII; storage API only put/get       | MIG-003 reconciles; MIG-006 proves scoped object/restore evidence; OPS-007/011 productize handlers; no reset without object receipt           |
| D08 | `raw_inbound_events.payload/headers`                                                               | raw event/provider payload/allowed headers classes                                                  | Arbitrary provider payload/header copy in a shared V2 source root; observed cardinality grants no disposal authority                  | SRC tasks add lifecycle/claim/replay; never delete as an obsolete V1 table                                                                    |
| D09 | `normalized_inbound_events.normalized_payload/reply_capability`                                    | normalized event classes                                                                            | Provider thread/message/user IDs and arbitrary JSON in a root already referenced by V2                                                | SRC/MIG-003 classify and retain required provenance                                                                                           |
| D10 | `event_store.payload`                                                                              | domain event envelope/content-reference classes                                                     | Shared platform table; V1 message events currently carry IDs, but schema accepts arbitrary JSON                                       | MIG-002 dual-materializes one command; MIG-003 classifies legacy types; MIG-007 removes only obsolete semantics                               |
| D11 | `outbox.payload`                                                                                   | `core:outbox_dispatch_envelope` and dispatch body/artifact classes                                  | Full serialized event envelope; shared by auth/tenant/integration code; local pending rows and uncertain provider boundary            | SRC-009/MIG-004 reconcile and fence; bounded lifecycle after terminal outcome; never blanket-truncate                                         |
| D12 | routing event, tenant/Public API audit and `platform_audit_log.metadata`                           | domain/privileged audit skeleton, `core:platform_audit_skeleton` and separately classified evidence | Tenant/global audit accept arbitrary JSON; routing and platform-egress audit writes are non-atomic with their state change            | MIG-003 preserves safe V1 facts; OPS-013 types/minimizes/expires tenant/platform evidence; required audit survives V1 code removal            |
| D13 | notification endpoint/feed payload                                                                 | notification classes                                                                                | Arbitrary payload and endpoint-hash schema exist; observed cardinality grants no permission to omit the root                          | NOT/OPS lifecycle owns the shared root independently of Inbox V1                                                                              |
| D14 | source connections/accounts and connector config/diagnostics                                       | `core:source_account_connector_metadata` plus source identity/binding classes                       | Active live rows, cursor/diagnostic/provider metadata; shared V2 foundation                                                           | Rebind through SRC/TG/MIG tasks; do not delete with Inbox V1                                                                                  |
| D15 | encrypted channel sessions, public/metadata/error state and leases                                 | auth secret class plus source connector metadata/outcome                                            | Connected encrypted live sessions exist; secrets are never hold/backfill content                                                      | Stop/reconcile provider authority, retain or explicitly revoke; hard-delete secrets on revoke/expiry through auth lifecycle                   |
| D16 | session events, auth challenges, validation jobs and `tenant_secrets`                              | auth secret/outcome, operational diagnostic classes                                                 | Arbitrary public/result/metadata JSON and encrypted secret references; live rows exist                                                | Expire/revoke secret material, preserve safe bounded outcomes, never copy secrets into migration events/audit                                 |
| D17 | integration diagnostics and webhook subscriptions                                                  | operational diagnostic and webhook config/delivery classes                                          | Arbitrary JSON, URLs/event lists and secret references; observed cardinality cannot prove no external consumer                        | OPS lifecycle and API facade migration preserve this root until consumer evidence exists                                                      |
| D18 | PostgreSQL indexes and Drizzle migration snapshots                                                 | derived index/schema artifact, not customer content                                                 | DB indexes may contain content values internally; snapshots contain schema, not rows                                                  | Rebuild/drop with owning relation; preserve published migration history on the selected preserve path                                         |
| D19 | server/browser response memory and attachment cache                                                | transient/client residual of parent content                                                         | Inbox fetch is `no-store`; attachment proxy permits private 60-second cache                                                           | Invalidate server generations; report already-downloaded/browser copies as external residual, not verified server deletion                    |
| D20 | repository `.log`/`.logs`/`.hulee`, Docker stdout and external log sinks                           | `core:operational_log_trace_diagnostic`                                                             | Logger accepts arbitrary context/error; seed logs identifiers; remote/off-host retention is not registered                            | OPS-010 inventories/redacts/expires; support/export never treats raw logs as canonical data                                                   |
| D21 | PostgreSQL and MinIO persistent volumes                                                            | primary DB/object roots                                                                             | Both known data planes are persistent; a volume is not a backup                                                                       | Exact deployment/cluster/root manifests; expand in place for preserve                                                                         |
| D22 | historical compressed SQL dump                                                                     | `core:backup_copy_or_object_version` plus every contained class                                     | Contains V1 business plus shared event/outbox, auth and API/session state                                                             | MIG-006 verifies scoped restore/retained-backup disposition; OPS-007 productizes restore-erasure replay and verified expiry                   |
| D23 | historical environment/release configuration copies                                                | `core:backup_copy_or_object_version` plus contained auth-secret/security-outcome classes            | Potential deploy/provider/database/object credentials; contents deliberately not read                                                 | MIG-006 records the retained root; security/OPS-013 later own finite retention, rotation and verified deletion; never hold usable secrets     |
| D24 | reports, exports, caches, search/vector/BI                                                         | parent-derived analytics/export/index classes                                                       | No in-repo V1 materializer/Redis/Elastic found; external surfaces are unregistered                                                    | OPS-011/REP inventory every real deployment; unknown remains preserve until absence evidence                                                  |
| D25 | Telegram/WhatsApp/MAX/provider history and recipient devices                                       | external provider residual                                                                          | Connected accounts and provider-side copies exist; Hulee cannot infer remote deletion from local rows                                 | Adapter capability/status ledger, MIG-004 side-effect handoff, OPS-011 external delete/residual evidence                                      |
| D26 | tenant roles/permissions/bindings/direct grants and employee org/team/queue memberships            | `core:access_grant_invitation_membership_history`                                                   | Shared RBAC and membership facts authorize Inbox reads/writes and must outlive V1 implementation removal                              | DB-004/RBAC/WRK preserve temporal grants and membership; MIG-003 dry-run maps authority; OPS lifecycle compacts only under policy             |
| D27 | account password hashes, API keys, verification/invitation token hashes, sessions and rate buckets | `core:auth_credential_session_challenge_secret`, `core:auth_security_outcome`                       | Shared Public API/Web credentials, sessions and security state exist independently of Inbox implementation version                    | Keep shared auth roots; rebind V2 commands without copying secrets; revoke/expire/delete through auth lifecycle and preserve safe outcomes    |
| D28 | `external_identity_links` auth provider subject/email/display/profile                              | **ADR 0015 catalog gap: fail-closed auth external-identity/profile root**                           | Authentication identity/profile JSON is a separate boundary from source actor identity and cannot use `core:source_external_identity` | Preserve the shared auth root and exclude it from MIG-003 source-identity mapping; OPS-005/006/010 close lifecycle before privacy/ops gates   |
| D29 | account/employee/platform-admin email/display/profile and org/team/queue profile/config            | **ADR 0015 catalog gap: fail-closed personal-identifier/config roots**                              | Current catalog has no exact employee/account profile or tenant org-configuration class; treating the whole row as a grant is false   | Retain shared roots; OPS-005/006/010 close lifecycle before privacy/ops gates; this retained root is outside MIG-007 deletion scope           |
| D30 | deployment egress status `details`, public address and operator hint                               | `core:operational_log_trace_diagnostic`                                                             | Global health/diagnostic state can include network address and operator context; it is not tenant subject/hold data                   | Preserve as shared deployment state; TG/DMX reads remain authoritative; OPS-009/010/013 package, minimize and lifecycle it outside V1 removal |
| D31 | deployment egress provider policy/capability JSON and platform-admin attribution                   | **ADR 0015 catalog gap: platform deployment routing/configuration**                                 | Global provider/VPN routing configuration is not tenant-owned `core:outbound_route_and_policy` and must not enter tenant export/hold  | Retain outside MIG-007; OPS-005/006/010/013 add a global class/policy/handler before privacy/operations gates                                 |

## Shared Tables That Must Not Be Dropped Wholesale

The following names are not synonymous with obsolete Inbox V1 data:

- `clients` and `files` are referenced by current V2 foundations;
- raw/normalized source tables, source connections/accounts and connector/auth
  tables are shared integration roots;
- `event_store` and `outbox` are also written by tenant, auth, employee,
  integration and RBAC paths;
- `audit_log`, notifications and webhook tables are platform roots with their
  own lifecycle;
- account/employee/external-identity profiles, tenant RBAC, organization/team/
  queue configuration and membership, tenant API keys and application sessions
  are shared roots and are never removed with Inbox V1;
- platform audit and deployment egress policy/status are global shared roots and
  are never inferred to be obsolete from an Inbox implementation version;
- Drizzle migration history must remain append-only on the preserve path.

`INB2-MIG-007` therefore removes obsolete V1 relations, routes, event semantics,
workers, seeds and tests through explicit migrations. It does not issue a
blanket table drop or schema reset.

## Required Preserve Sequence

1. **DB-008 preserve lane**: add a representative V1 snapshot upgrade harness,
   migration-before-restart N-1 API/web/worker smoke, RBAC dry-run mapping and
   rollback evidence. Add a separate true ephemeral CI install/reset lane.
2. **MIG-002**: add one-command compatibility/dual materialization without
   duplicate provider I/O. Keep Public API `/v1` behavior stable or make a
   separate unpublished-contract decision.
3. **MIG-003**: backfill in bounded, repeatable batches with mapping ledgers and
   diagnostics for author/thread/roster/route/queue/content/object ambiguity.
   Reconcile the live DB/object mismatch and every queued/processed/attempt state.
4. **MIG-004**: persist revisioned server-owned authority modes; reconcile live
   Telegram/WhatsApp sessions, polling/webhook cursors and uncertain sends before
   listener or dispatch authority changes.
5. **MIG-005**: move Public API composition, Telegram webhook/polling/direct,
   internal API/web/realtime, files, workers and seed to V2 owners.
6. **MIG-006 early removal subgate**: sign the V1-applicable ADR 0015 root/handler
   graph, retained-root exclusions, backup/restore, supported upgrade, external
   consumer/fleet/copy inventory, rollback and uninterrupted zero-use evidence.
   Later OPS tasks productize and reuse it without becoming a cyclic prerequisite.
7. **MIG-007**: remove V1 implementation through an explicit contract release,
   retaining required history/audit/backups and a `/v1` V2 facade if the public
   contract remains supported.

## Explicit Unknowns And Owners

| Unknown fact                                                  | Fail-closed disposition | Owner/evidence needed                                  |
| ------------------------------------------------------------- | ----------------------- | ------------------------------------------------------ |
| Complete shared/isolated/on-prem fleet and historical domains | preserve                | MIG-006 removal dossier; OPS-009 productization        |
| Supported/running historical container images                 | preserve                | MIG-006 removal dossier; release registry/OPS-009      |
| Promised/active Public API clients                            | preserve `/v1`          | MIG-004 decision + MIG-006 consumer/facade evidence    |
| Off-host DB/object snapshots, replicas and operator copies    | preserve                | MIG-006 scoped inventory/drill; OPS-007 productization |
| External log, search, vector, BI, cache and export roots      | preserve                | MIG-006 V1-bearing-root classification; OPS/REP        |
| Provider/recipient copies and deletion capability             | external residual       | MIG-006 side-effect evidence; adapter ledger/OPS-011   |
| Live object identities and parent links                       | preserve                | MIG-003 reconciliation + MIG-006 dossier; OPS-011      |
| Environment backup expiry/rotation                            | preserve secret root    | MIG-006 retained-root dossier; security/OPS-013        |
| Production legal basis, hold and finite retention profile     | preserve                | MIG-006 applicable graph/approval; later OPS policy    |
| Exact ADR 0015 classes for auth/account/employee/org profiles | preserve/catalog gap    | OPS-005 completeness + OPS-006/OPS-010                 |
| Exact ADR 0015 class for global deployment egress policy      | preserve/catalog gap    | OPS-005/OPS-006/OPS-010/OPS-013                        |

These unknowns do not leave an unexplained repository dependency: each is an
identified root with a fail-closed disposition and an owner. All block fast-path
eligibility. Before V1 removal, MIG-006 gives every applicable unknown a finite
signed classification; an unknown copy that can retain obsolete V1 state blocks
its dossier. Declared shared auth/profile/egress roots D26-D31 remain retained;
their catalog gaps block later privacy/operations gates, not scoped V1
implementation removal. Later owners productize the registry/lifecycle
capability without deferring the MIG-006 removal decision.

## Verification Record

Repository searches covered, at minimum:

```text
/internal/v1/inbox
/v1/clients and /v1/messages/*
saveReply
message.received and message.sent
Conversation/Message/File/Event/Outbox repositories
Telegram webhook, polling, outbound and attachment transfer
direct-account auth/session/source synchronization
raw/normalized/notification/audit JSON roots
platform audit and deployment egress policy/status roots
object put/get and file-content reads
seed and every V1 contract/core/DB/API/worker/web test
production/local Compose, GitHub workflows and deployment documentation
```

Three independent reviewers separately audited code paths, data-copy roots and
deployment/runtime surfaces. The combined inventory was then checked against
restricted live DB/object/backup observations. The reviewers found no additional unclassified
repository producer/consumer after C01-C24 and no additional known physical
copy category after D01-D31.

`INB2-MIG-001` is complete because every found dependency/root is classified and
mapped, **not** because destructive eligibility passed. The recorded result is
`preserve`, which activates the downstream preserve work above.
