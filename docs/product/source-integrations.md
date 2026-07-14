# Source Integrations

## Product Frame

Hulee treats every external entry point as a source of work for the inbox. A
source can be a messenger, marketplace, classified, review platform, map listing,
website widget, form, email mailbox, phone provider, CRM, helpdesk or public API
client.

Channels are a tenant-facing subset of sources for communication surfaces such
as Telegram, WhatsApp, MAX, VK and email. The platform architecture should not
assume that every integration is a chat channel.

## Core Terms

`SourceConnection` is the tenant-level connection to an external source. It owns
source type, source name, display name, status, auth type, capabilities,
diagnostics and source-level configuration.

`SourceAccount` is a concrete external account or resource inside a source:
bot, user session, VK group, marketplace shop, Avito account, 2GIS branch,
mailbox, phone number, webchat site or custom resource.

For scoped Inbox V2 authorization a SourceAccount may have an explicit
tenant-safe administrative owning org unit/access policy with temporal history
and revision. It is never inferred from provider participants, account owner
profile, linked Client or WorkItem responsible. Using a SourceAccount for send
requires its own ADR 0013 permission in addition to Conversation/WorkItem
authority and binding capability.

`RawInboundEvent` is the immutable provider-occurrence envelope before
normalization, with a separately classified restricted payload/evidence object.
The accepted occurrence is never rewritten, but ADR 0015 may purge its payload
after the replay/diagnostic purpose ends and retain only a finite safe dedupe/
outcome skeleton.

`NormalizedInboundEvent` is the versioned Hulee event derived from raw payload.
It is the input for identity resolution, conversation resolution, routing and
message/call/lead/review materialization.

`ReplyCapability` describes how Hulee can answer: natively, through an external
link, read-only, unsupported or expired.

## Source Catalog

The source catalog is the platform-wide taxonomy of external entry points. It is
broader than the tenant-facing channel catalog: channels are only the
communication subset that needs connector runtime, auth challenge, webhook or
polling setup.

Source catalog categories are stable product categories used by platform admin
UI, tenant onboarding, documentation, entitlements and adapter contracts:

- `messengers`: Telegram, WhatsApp, MAX, VK and other direct messaging sources;
- `marketplaces`: seller cabinets and order/question sources;
- `reviews`: maps and reputation platforms;
- `forms`: website forms, lead forms and callback requests;
- `email`: mailbox and alias sources;
- `telephony`: calls, missed calls, recordings, calltracking and SIP sources;
- `crm`: CRM systems of record and workflow sources;
- `api`: public API clients and custom enterprise integrations.

The catalog can also include `social`, `classifieds` and `internal` categories
for non-messenger social events, listing platforms and employee-facing internal
sources. Category definitions must declare source types, default capabilities
and sort order. Catalog items must declare setup mode so the product knows
whether onboarding should open a channel connector, source connection, public
API key flow or manual setup.

## Source Types

- `messenger`: Telegram, WhatsApp, MAX, VK messages, Viber, social direct
  messages.
- `social`: comments, mentions, community messages and page events.
- `marketplace`: Ozon, Wildberries, Yandex Market, Kaspi and seller cabinets.
- `classified`: Avito, OLX, Kolesa, Krisha and vertical listing platforms.
- `review`: maps, review platforms and reputation sources.
- `email`: mailboxes, aliases and email fallback integrations.
- `phone`: calls, missed calls, recordings, calltracking and SIP providers.
- `form`: website forms, lead forms and callback requests.
- `internal`: employee support cases and internal service requests.
- `crm`: Bitrix24, amoCRM, RetailCRM and customer systems of record.
- `api`: Public API, webhooks and custom enterprise integrations.

## Messaging Access Models

Messenger catalog entries identify an exact provider surface and access model,
not only a brand:

- `personal_session_bridge`: a normal user account connected through a
  provider-approved or otherwise explicitly accepted session transport;
- `official_business_account`: a bot, official account or verified business
  identity connected through an official API;
- `phone_addressed_business_agent`: a consented business-messaging surface that
  addresses customers by phone/provider identity;
- `workspace_or_community_app`: an app/bot participating in an enterprise,
  workspace or community conversation;
- `archive_or_compliance_feed`: a licensed/consented read surface that never
  implies permission to send.

Consumer web/desktop QR or phone login is a device-onboarding mechanism, not
proof of an integration API. A provider surface may enter the production catalog
only with an approved programmable contract and capability evidence. Capability
profiles belong to the exact surface and SourceThreadBinding; one surface cannot
lend its group, history, roster or reply rights to another surface from the same
brand.

The dated provider research, Viber personal-session decision and wider market
shortlist live in `docs/product/messenger-integration-landscape.md`.
The readable Telegram/WhatsApp/MAX private/group capability baseline lives in
`docs/product/inbox-v2-direct-messenger-matrix.md`; its canonical per-surface
evidence/task ledger is `docs/product/inbox-v2-direct-messenger-cells.csv`.

## Inbound Pipeline

```text
External Source
  -> SourceConnection / SourceAccount
  -> RawInboundEvent
  -> Normalizer
  -> NormalizedInboundEvent
  -> Identity Resolver
  -> Conversation Resolver
  -> Routing Engine
  -> Message / Call / Lead / Review / System Event
  -> Inbox / Storage / Search / Analytics
  -> Reply Adapter / CRM Sync / Outgoing Webhooks
```

Every step must be tenant-scoped, idempotent and diagnosable.

## Identity Resolver Input

Source normalizers must hand identity resolution a provider-neutral input:
tenant id, source connection id, optional source account id, source type, source
name, source event type, visibility, external thread id, external user id,
event ids, profile snapshot and a list of identity candidates.

Identity candidates are typed and ranked:

- `verified`: provider-verified phone/email or trusted account identity;
- `strong`: stable provider user id, username, source customer id or profile
  URL;
- `weak`: display name or low-confidence extracted value.

Supported candidate kinds are external user id, email, phone, username, profile
URL, display name, source customer id and custom. Candidates are deduplicated by
kind and value before resolver handoff, keeping the highest confidence version.
The resolver owns matching/linking decisions; adapters and normalizers only
describe evidence.

## Conversation Resolver Input

After identity resolution, source normalizers must provide a provider-neutral
conversation resolver input. It includes tenant id, source connection id,
optional source account id, source type, source name, source event type,
visibility, event ids, optional resolved client id, optional existing
conversation id and a list of conversation key candidates.

Conversation keys are not messenger-specific thread ids only. Supported key
kinds include external thread, external post, listing, order, review, lead,
call, email thread, form submission, CRM record and custom. Keys are ranked as:

- `exact`: canonical provider object or thread id that should map to one
  conversation;
- `strong`: stable business object id that can group events safely;
- `weak`: fallback extracted value that may need additional identity or routing
  context.

The conversation resolver owns lookup, merge and creation decisions. Adapters
and normalizers only describe grouping evidence, suggested conversation type and
routing hints. This keeps marketplace questions, reviews, calls, forms and CRM
events out of messenger-only assumptions.

For externally replyable direct/group threads, an unscoped
`externalThreadId` is insufficient. The adapter supplies a versioned thread and
message identity realm, provider object kind, provider/connection/account scope,
scope owner and opaque canonical subject. Core never lowercases provider IDs or
uses Client/sender/title as a thread key. Provider-scoped groups observed by
several accounts share one ExternalThread; account-scoped private dialogs do
not.

Each account's access is a SourceThreadBinding with its own opaque destination,
remote membership, administrative enablement, health, capabilities and cursor.
Raw idempotency remains account-scoped, while an exact adapter-declared external
message reference can attach several SourceOccurrences to one TimelineItem.
Every normal external send persists one server-authorized immutable binding/
route before provider I/O; fallback, reroute and multi-send are explicit.
Each provider attempt also pins the adapter contract and retry-safety mechanism
before I/O. An expired lease or possibly accepted timeout becomes an explicit
unknown outcome; only exact reconciliation or an authorized duplicate-risk
decision may open a new attempt on the same route. The adapter cannot upgrade an
unsafe attempt to idempotent after failure.
Provider owner/admin/member status and SourceExternalIdentity claims remain
source evidence and never satisfy a Hulee permission/scope relation.

## Diagnostics, Replay and DLQ

Every source processing step must emit safe diagnostics for operators. A
diagnostic record includes tenant id, source connection id, optional source
account id, raw or normalized event id, processing stage, outcome, attempt,
max attempts, checked time, normalized platform error code, retryability, next
attempt time, DLQ time, replayability, operator hint and sanitized details.

Diagnostics must not expose raw payloads, headers, cookies, authorization
values, tokens, passwords or secrets. Adapters can attach provider status,
method name, normalized reason and correlation ids only after redaction.

Replay and DLQ policy is shared across webhook, polling, email and API sources:

- successful events are marked processed;
- duplicate events are marked duplicate and are not replayable;
- intentionally ignored events are marked ignored and are not replayable;
- retryable or unknown failures are retried while attempts remain;
- exhausted retryable failures and non-retryable failures are sent to DLQ with a
  safe diagnostic reason;
- DLQ records remain manually replayable after adapter, provider or
  configuration fixes.

Replay requests must be tenant-scoped, idempotent and identify either a raw
event or normalized event. Replay can target a raw event, a normalized event or
a DLQ record, and must record the operator/system reason.

## Adapter Contract Tests

Every source adapter and normalizer must have contract tests against the shared
source normalizer contract. These tests must validate:

- raw events use source-scoped raw idempotency keys;
- normalized events use normalized idempotency keys and keep tenant,
  source connection and source account scope from the raw event;
- normalized event source type and source name match the adapter manifest;
- inbound materialized events provide identity resolver and conversation
  resolver inputs;
- reply capability and processing diagnostics are parseable shared contracts;
- ignored and duplicate raw events are explicit and do not silently drop work.

Adapter-specific tests can add provider payload fixtures, but they must not
replace the shared contract harness. This keeps marketplaces, forms, email,
telephony, CRM, public API and messengers on the same processing boundary.

## Capabilities

Each source should declare capabilities explicitly:

- provider surface and messaging access model;
- supported private, group, workspace/community and broadcast conversation
  kinds;
- participant roster fidelity: `full`, `partial`, `none` or `unknown`;
- receive messages or events;
- send native replies;
- read from and write to groups independently;
- support business-initiated messages and phone-addressed recipients;
- fetch history;
- receive and send files;
- support threads;
- support reactions;
- support read or delivery status;
- support webhook delivery;
- require polling;
- expose customer profile;
- have documented rate limits;
- support OAuth or safer auth;
- have sandbox support;
- require consent, partner access, paid archive or other commercial enablement;
- carry explicit commercial/legal/support status and risk;
- limit reply windows or require replies in the native client.

Capabilities are product behavior, not UI hints only. They drive onboarding,
admin diagnostics, reply controls, entitlements and support policy.

`SourceCapabilities` must be normalized before persistence or adapter handoff:
missing boolean fields default to `false`, while optional risk and reply-window
fields are preserved only when explicitly declared by the source.

`ReplyCapability` is derived from source status, event direction, reply support,
external reply links and reply windows. The shared decision order is:

- inactive, disabled, deleted, errored or onboarding sources are read-only;
- non-inbound events are read-only;
- events outside the source reply window are expired;
- sources with native reply support use `native_reply`;
- sources without native reply support can expose an `external_link`;
- sources with no available reply path are `unsupported`.

This reply capability decision must be produced by shared contracts/helpers and
then consumed by UI, public API, adapters and analytics.

## Data Rules

- Persist a secret-stripped, classified restricted raw payload/evidence object
  before normalization; reject/quarantine undeclared fields, and purge payload
  independently under ADR 0015 without losing the occurrence outcome.
- Store provider timestamps separately from received timestamps.
- A webhook/poll/history provider watermark advances only after the raw
  occurrence and resumable processing state are durable. Normalization or
  materialization failure must remain replayable and cannot be skipped by an
  adapter cursor.
- Provider timestamps and adapter receive/history cursors never define Inbox
  timeline order, entity freshness, projector checkpoints or client realtime
  cursors. Canonical materialization uses ADR 0012 timeline sequence, revision
  and atomic tenant commit rules.
- Initial history is deterministically ordered before a binding becomes live
  where possible. Late history is append-only with import provenance and cannot
  create unread, notification, SLA or normal head-activity side effects.
- Deduplicate with tenant-scoped source idempotency keys. The canonical key
  format is `source:v1:{raw|normalized}:{webhook|polling|email|api}:...`.
- Include source connection and source account scope in idempotency keys so the
  same external id from different connected accounts does not collide.
- Treat this account-scoped raw/normalized idempotency separately from canonical
  cross-account Message dedupe; retain every SourceOccurrence.
- For webhook, polling and email sources, prefer provider external event ids,
  then provider signatures, then explicit client keys, then stable
  fingerprints.
- For API sources, prefer the client-provided idempotency key before provider
  ids or fallback fingerprints.
- Keep raw and normalized idempotency phases separate. Normalized keys must also
  include the source event type so one raw payload can safely materialize more
  than one normalized event when needed.
- When external ids are missing, use a stable fingerprint of source, thread,
  user, timestamp, body and attachment hashes.
- Do not use a weak content/time fingerprint to merge direct-messenger Messages
  across accounts without an adapter-declared exact message scope.
- Fingerprint/HMAC dedupe is guaranteed only through its declared finite
  skeleton/key window. After expiry, diagnostics expose that historical dedupe
  is unavailable; no adapter may silently fall back to an unkeyed, low-entropy
  content/time hash or claim indefinite replay protection.
- Keep source context separate from core message text so marketplaces, calls,
  reviews and lead forms do not become messenger-specific JSON fragments.
- ADR 0015 retention policy covers raw envelope/payload, normalized envelope/
  payload, canonical Messages/items, source occurrences/refs, attachments,
  recordings/transcripts, embeddings, diagnostics and audit independently.
- Raw payload/headers are restricted purgeable evidence. Generic events,
  outbox, diagnostics and audit reference them and never copy cookies, auth,
  secrets, contact/message content or arbitrary provider JSON.
- Payload expiry may retain only a finite tenant-keyed HMAC/idempotency outcome
  skeleton; replayability and the dedupe-guarantee end become explicit terminal
  diagnostics rather than a reason for indefinite storage.
- Every provider surface declares external disclosure/residency/delete
  capability and records remote deletion residuals honestly.

## Relationship To Channel Connectors

Existing `channel_connectors`, `channel_sessions` and
`channel_auth_challenges` remain the runtime model for communication channels
that need bot tokens, user sessions, QR/code login or provider-specific
connectivity.

Future work should link a channel connector to a source connection instead of
making every source a channel connector. Non-chat sources should use source
connections directly.

## MVP Scope

The first source foundation slice should add contracts and persistence skeleton
for source connections, source accounts, raw inbound events and normalized
inbound events. It should not migrate existing messenger connectors until the
new pipeline is exercised by a simple source such as Public API, web forms or
email.
