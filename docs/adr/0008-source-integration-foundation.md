# ADR 0008: Source Integration Foundation

## Status

Accepted

## Context

Hulee started with messenger channels because Telegram, WhatsApp, MAX and VK
prove the core inbox flow quickly. The product must also accept requests from
marketplaces, classifieds, reviews, maps, website forms, email, telephony, CRM,
public API and customer-specific systems.

If `channel_connectors` remains the only integration model, future sources will
inherit messenger assumptions such as chat-only payloads, bot/user sessions and
reply-by-message semantics. That would make marketplace questions, reviews,
calls and lead forms hard to model without provider-specific branches in core.

## Decision

Hulee will introduce a source integration layer above channels:

- `SourceConnection` describes a tenant connection to an external source.
- `SourceAccount` describes a concrete account, shop, branch, mailbox, phone
  number, group, bot or custom resource inside a source.
- `RawInboundEvent` stores the original inbound payload before normalization.
- `NormalizedInboundEvent` stores the versioned platform event that can be
  resolved into a client, conversation, message, call, lead, review or system
  event.
- `ReplyCapability` describes whether Hulee can answer natively, via external
  link, read-only mode or within an expiry window.

`ChannelConnector` remains valid, but it becomes the communication-channel
implementation of the broader source model. Existing Telegram, WhatsApp and MAX
work does not need an immediate destructive rename. New non-messenger
integrations should be modeled through source connections first.

## Consequences

- `channel_*` tables continue to support messenger-specific sessions,
  challenges and diagnostics.
- New inbound sources must pass through raw event storage, idempotency,
  normalization and conversation/message resolution.
- Adapter capabilities should be typed around receive, reply, history,
  attachments, threading, delivery status and legal/support risk.
- UI can keep the tenant-facing "Channels" wording for communication sources,
  but platform contracts and persistence should use "source" where the model is
  not messenger-specific.
- Control-plane can manage global source catalog availability, while data-plane
  owns tenant source connections, raw events and normalized business data.
- On-prem and isolated SaaS can run source processing without permanent
  control-plane connectivity, using local catalog/license snapshots.

## Non-goals

- Rename existing `channel_connectors` in this ADR.
- Implement Ozon, Avito, email, telephony or CRM adapters immediately.
- Build a public marketplace UI before the source model and inbound pipeline are
  stable.
