# Inbox V2 Source Foundation Compatibility Map

- Task: `INB2-SRC-001`
- Reviewed: `2026-07-16`
- Result: `READY AS AN INVENTORY; NOT A PRODUCTION PIPELINE`

## Decision

The completed `SOURCE-100..112` backlog proves a useful provider-neutral source
vocabulary, persistence skeleton and test pattern. It does not prove that the
existing implementation is safe to use as the Inbox V2 ingestion authority.

The following pieces remain reusable:

- the separation between SourceConnection, SourceAccount, raw occurrence and
  normalized event;
- source categories, non-chat event/key vocabulary and safe-default capability
  helpers;
- separate raw and normalized idempotency phases;
- the principle that adapters supply identity/conversation evidence while core
  resolvers own matching and materialization;
- the shared contract-test pattern.

The current mutable rows, arbitrary JSON payloads, generic upserts, unscoped
external identifiers and pure retry helpers are compatibility inputs only. They
are not Inbox V2 invariants. Every known incompatibility below has an explicit
backlog owner. `INB2-SRC-010` is added because source/connector registry
hardening, onboarding and lifecycle registration previously had no complete
owner.

## Current Runtime Truth

The implemented graph is:

```text
ChannelConnector or standalone source setup
  -> SourceConnection
  -> optional SourceAccount
  -> RawInboundEvent persistence API
  -> NormalizedInboundEvent persistence API
```

This is not the current production message graph:

- no production composition calls `recordRawInboundEvent` or
  `recordNormalizedInboundEvent` for the current message path;
- Telegram webhook and polling normalize directly into the legacy external
  channel command path;
- direct Telegram/WhatsApp/MAX runtimes synchronize connection/account health
  state but do not ingest messages through the source event pipeline;
- MegaPBX is a contract fixture and standalone setup surface, not a wired
  end-to-end source webhook handler;
- the generated `/webhooks/sources/{source}/{connection}` path has no production
  handler in the repository.

Therefore V2 migration must introduce one canonical source pipeline instead of
placing another writer beside the current provider paths.

## SOURCE-100..112 Mapping

| ID           | Existing evidence                                                                                                       | Reusable V2 subset                                                                | Gap owner(s)                                   |
| ------------ | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------- |
| `SOURCE-100` | Source types and records in `packages/contracts/src/index.ts`; source boundary in ADR 0008 and `source-integrations.md` | Source-vs-channel boundary and four-stage source vocabulary                       | `SRC-002..010`, `DMX-001`                      |
| `SOURCE-101` | `SourceConnection`, `source_connections`, SQL repository, internal admin API and integrations UI                        | Tenant row, source type/name and admin discovery shell                            | `SRC-010`, `DMX-001`, `OPS-010/013`            |
| `SOURCE-102` | `SourceAccount`, `source_accounts`, direct-account sync and V2 account identity/alias foundation                        | Account anchor and current composite account-to-connection relationship           | `SRC-010`, `DMX-001`, `TG/WA/MAX-001`          |
| `SOURCE-103` | `RawInboundEvent`, `raw_inbound_events`, `recordRawInboundEvent` and tenant idempotency index                           | Occurrence ID, received/provider timestamps and account-scoped raw dedupe concept | `SRC-002`, `SRC-008`, `MIG-003`                |
| `SOURCE-104` | `NormalizedInboundEvent`, `normalized_inbound_events` and `recordNormalizedInboundEvent`                                | Versioned normalized envelope concept and raw-to-normalized scope inheritance     | `SRC-003`, `SRC-006/007/008`, `MIG-003`        |
| `SOURCE-105` | `source-capabilities.ts` safe defaults and reply decision                                                               | Coarse non-authoritative defaults and reply-mode vocabulary                       | `DMX-001`, `MSG-002`                           |
| `SOURCE-106` | `source-idempotency.ts`; separate raw/normalized phase, transport, connection, account and event-type segments          | Phase separation and account-scoped occurrence-key principle                      | `SRC-002/003/006/008`                          |
| `SOURCE-107` | `source-identity.ts` candidate kinds, confidence and evidence-first resolver handoff                                    | Candidate vocabulary and resolver ownership principle                             | `SRC-003/004`                                  |
| `SOURCE-108` | `source-conversation.ts` non-chat key kinds for post/listing/order/review/lead/call/email/form/CRM                      | Non-messenger business-object vocabulary                                          | `SRC-003/005`, `EXT-001`                       |
| `SOURCE-109` | `channel_connectors.source_connection_id`, internal API sync and `direct-account-source-sync.ts`                        | Non-destructive connector-to-source association                                   | `SRC-010`, `DMX-001`, `TG/WA/MAX-001`          |
| `SOURCE-110` | `source-processing.ts` outcome, retry, DLQ, replay and diagnostic schemas/helpers                                       | Outcome/retry taxonomy only                                                       | `SRC-002/008/009`, `OPS-004/010`               |
| `SOURCE-111` | `source-catalog.ts` categories, readiness and setup modes                                                               | Platform taxonomy and source-vs-channel setup distinction                         | `SRC-010`, `DMX-001`, `EXT-001`, `SOURCE-113+` |
| `SOURCE-112` | `source-normalizer-contract.ts`, shared source contract suites, SQL repository tests and the MegaPBX fixture            | Shared harness pattern and basic raw-to-normalized scope checks                   | `SRC-002/003`, `DMX-001`, `EPIC-3-GATE`        |

## Gap Register

The severity describes the risk of adopting the existing behavior as the V2
production path. It does not claim that an unwired test-only path is currently
leaking production data.

| Gap       | Severity | Current incompatibility                                                                                                                                                                                           | Required owner(s)                                 |
| --------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `SFG-001` | P0       | MegaPBX raw creation keeps `crm_token` in the payload and copies token/API-key headers; the SQL repository serializes caller-supplied `unknown` payload/header values directly                                    | `SRC-002`; source secret/config side in `SRC-010` |
| `SFG-002` | P0       | Raw occurrence envelope, restricted provider payload and allowed headers are one row with no sanitizer/quarantine boundary or independent lifecycle                                                               | `SRC-002`, `SRC-008`, `OPS-010/011`               |
| `SFG-003` | P0       | Raw/normalized events have no atomic claim, lease token, attempt fence, renew/finalize CAS or stale reclaim                                                                                                       | `SRC-002`, `SRC-008`                              |
| `SFG-004` | P0       | Normalized payload/reply capability are arbitrary JSON; external thread/message/user and canonical conversation/message references are unscoped or unconstrained                                                  | `SRC-003`, `SRC-007`                              |
| `SFG-005` | P0       | Identity and conversation helpers lowercase every candidate key, including case-sensitive opaque provider IDs; any unscoped `externalThreadId` becomes an exact conversation key                                  | `SRC-003/004/005`                                 |
| `SFG-006` | P0       | Repository callers may provide any idempotency string; a tenant-level key conflict silently returns the old row without checking connection/account/event/payload coherence                                       | `SRC-002/003/006`                                 |
| `SFG-007` | P0       | The source repository is not the current Telegram/direct/Public API message authority; enabling it beside current paths would create duplicate or divergent materialization                                       | `SRC-007`, `MIG-002/005`, `TG-001..004`           |
| `SFG-008` | P0       | SourceConnection/SourceAccount/connector/session registry has global-ID-only edges, mutable untyped status/config/capabilities/diagnostics/metadata, provisional identity replacement and incomplete secret setup | `SRC-010`                                         |
| `SFG-009` | P0       | Connection/account/raw/normalized rows have no executable data-class, purpose, subject/parent, policy, deadline, hold, purge or absence-verification references                                                   | `SRC-002/003/008/010`, `MIG-003`, `OPS-010/011`   |
| `SFG-010` | P1       | Diagnostic redaction is a key-name denylist; secrets, contact/content or unbounded provider errors can survive under innocuous keys, URLs or nested values                                                        | `SRC-008`, `DMX-004`, `SRC-010`                   |
| `SFG-011` | P1       | Clear external event/signature/fingerprint segments are persisted in dedupe keys with no tenant-keyed HMAC generation, finite guarantee window or terminal expiry state                                           | `SRC-008`                                         |
| `SFG-012` | P0       | The current normalizer harness does not execute a versioned adapter manifest or reject unsafe raw shapes, missing identity realms/scopes, raw provider fragments, incomplete roster evidence or lifecycle gaps    | `SRC-002/003`, `DMX-001`                          |

After adding `INB2-SRC-010`, no identified source-foundation gap is left without
a task owner. Closing this inventory task does not close any implementation gap.

## Tenant And Relationship Audit

Migration `0029_inbox_v2_identity_transport_foundation.sql` already improved the
original `0026` source skeleton. Current schema enforces composite tenant
coherence for:

- SourceAccount -> SourceConnection;
- RawInboundEvent -> SourceConnection and optional SourceAccount;
- NormalizedInboundEvent -> RawInboundEvent, SourceConnection and optional
  SourceAccount;
- normalized/raw agreement on exact connection and nullable account scope.

This is reusable current-schema evidence. It must not be described as if the
whole source chain still relied only on global foreign keys.

Remaining compatibility edges are still unsafe to adopt as V2 authority:

- ChannelConnector -> SourceConnection uses only `source_connection_id`;
- ChannelSession -> ChannelConnector uses only `connector_id`;
- ChannelSessionEvent -> ChannelConnector/ChannelSession uses global IDs;
- ChannelAuthChallenge -> ChannelConnector uses a global ID;
- SourceConnection `created_by_employee_id` has no same-tenant relationship;
- NormalizedInboundEvent `conversation_id` and `message_id` are unconstrained
  text placeholders.

Global uniqueness of an ID is not itself the defect. The defect is allowing a
tenant-owned relationship, repository lookup or authorization decision to rely
on that ID without the tenant key and exact parent scope.

## Lifecycle Mapping

The ADR 0015 catalog already defines the target classes. The current rows do not
bind their JSON/content to those classes.

| Current copy                                        | Required target class                                       | Required transition                                                       | Owner(s)                 |
| --------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------ |
| Raw accepted occurrence fields                      | `core:raw_event_envelope`                                   | Immutable envelope plus finite safe outcome skeleton                      | `SRC-002/008`            |
| `raw_inbound_events.payload`                        | `core:raw_provider_payload`                                 | Separate classified restricted evidence object                            | `SRC-002`, `OPS-010/011` |
| `raw_inbound_events.headers`                        | `core:raw_provider_allowed_headers`                         | Allowlisted headers only; independent purge                               | `SRC-002`, `OPS-010/011` |
| Normalized source metadata                          | `core:normalized_event_envelope`                            | Typed versioned envelope with exact source/thread/sender scope            | `SRC-003`                |
| `normalized_inbound_events.normalized_payload`      | `core:normalized_event_payload`                             | Classified typed payload/content reference, never arbitrary generic JSON  | `SRC-003`, `OPS-010/011` |
| Idempotency fingerprint/outcome                     | `core:source_delivery_dedupe_skeleton`                      | Tenant-keyed finite skeleton with explicit guarantee end                  | `SRC-008`                |
| SourceAccount identity, replacement and aliases     | `core:source_account_identity_and_alias`                    | Preserve temporal identity while invalidating stale route authority       | `DB-003`, `SRC-010`      |
| Source occurrence and external provider reference   | `core:source_occurrence_and_external_reference`             | Keep exact provenance separately from canonical Message dedupe            | `SRC-006/007`            |
| Connection/account/connector config and diagnostics | Exact registered source/connector classes and storage roots | Typed projections/secret refs with purpose and compatible lifecycle hooks | `SRC-010`, `DMX-001/004` |
| Legacy arbitrary source JSON                        | Same classes after verified mapping                         | Classify/backfill or restrict; never infer purpose from table membership  | `MIG-003`                |

## New Registry Task Boundary

`INB2-SRC-010` owns only the reusable source/connector registry boundary:

- same-tenant source/connector/session/auth and creator/access relationships;
- versioned SourceConnection/SourceAccount registry state and replacement/
  reconnect history;
- contract-validated capabilities/config/metadata/diagnostics or classified
  evidence references;
- secret-reference-only configuration and atomic/compensated standalone source
  onboarding with a registered handler;
- lifecycle/storage-root/data-use/subject/parent/anchor/policy/hold/absence
  handler registration for every retained source/connector copy. Registry
  composition fails closed when a required handler or lineage revision is
  missing or incompatible.

It does not absorb the following owners:

- raw sanitizer, quarantine and claim: `INB2-SRC-002`;
- normalized input and evidence contract: `INB2-SRC-003`;
- identity/thread/dedupe/materialization: `INB2-SRC-004..007`;
- replay, expiry and bounded diagnostics: `INB2-SRC-008`;
- external outbox/attempt fencing: `INB2-SRC-009`;
- exact direct-surface capabilities: `INB2-DMX-001`;
- channel-auth revoke/cancel/expiry and destruction of usable credentials:
  `INB2-DMX-005`;
- existing-row classification/backfill: `INB2-MIG-003`;
- physical purge and residual verification: `INB2-OPS-010/011`.

The critical path is now:

```text
SRC-001 inventory
  -> SRC-010 source/connector registry
  -> SRC-002 raw intake and SRC-003 normalization
  -> SRC-004/005/006 resolution and dedupe
  -> SRC-007 materialization
  -> SRC-008 replay/diagnostics and SRC-009 outbox lifecycle
  -> EPIC-3-GATE
```

## Verification Baseline

The focused current-foundation suite passed before this review was closed:

- contracts, MegaPBX, SQL source repository, V2 identity-foundation schema and
  direct-account source synchronization: `12/12` files and `71/71` tests;
- an independent contract/repository run: `8/8` files and `45/45` tests;
- an independent extended source/bridge/API run: `12/12` files and `89/89`
  tests;
- an independent connector/API/client compatibility run: `3/3` files and
  `74/74` tests.
- the complete repository quality gate: `304/3041` default tests passed, with
  `31/258` opt-in integration tests intentionally skipped; format, lint,
  typecheck, DB, i18n, encoding, branding and native checks passed.

These green tests confirm the documented current behavior. They do not convert
the missing sanitizer, tenant edges, lifecycle, concurrency or materialization
boundaries into completed behavior.

## Exit

`INB2-SRC-001` may be marked `done` when:

1. this map and the `SOURCE-100..112` disposition are reviewed;
2. `INB2-SRC-010` exists and every registered gap has an owner;
3. focused source tests and the repository quality gate pass;
4. the backlog records that the next task is `INB2-SRC-010`, not direct reuse of
   the old raw/normalized repository.
