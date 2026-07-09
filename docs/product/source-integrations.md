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

`RawInboundEvent` is the immutable provider payload before normalization. It is
used for audit, diagnostics, replay and adapter fixes.

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

## Capabilities

Each source should declare capabilities explicitly:

- receive messages or events;
- send native replies;
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
- carry legal/support risk;
- limit reply windows.

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

- Store raw payload before normalization.
- Store provider timestamps separately from received timestamps.
- Deduplicate with tenant-scoped source idempotency keys. The canonical key
  format is `source:v1:{raw|normalized}:{webhook|polling|email|api}:...`.
- Include source connection and source account scope in idempotency keys so the
  same external id from different connected accounts does not collide.
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
- Keep source context separate from core message text so marketplaces, calls,
  reviews and lead forms do not become messenger-specific JSON fragments.
- Retention policy must cover messages, attachments, raw payloads, transcripts,
  embeddings and audit records separately.

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
