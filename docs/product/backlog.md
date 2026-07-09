# Backlog

## Epic 1. Platform Foundation

- [ ] Monorepo structure.
- [ ] TypeScript strict mode.
- [ ] Shared contracts package.
- [ ] PostgreSQL connection package.
- [ ] Drizzle schema and migrations.
- [ ] App config/env validation.
- [ ] Structured logging.
- [ ] Error model and error catalog.
- [ ] Unit test setup.
- [ ] CI quality gates.

## Epic 2. Tenant Core

- [ ] Tenant model.
- [ ] Tenant settings.
- [ ] Tenant branding.
- [ ] Tenant brand profile.
- [ ] White-label runtime brand resolution.
- [ ] Brand asset validation.
- [ ] Tenant module registry.
- [ ] Tenant feature flags.
- [ ] Tenant license model.
- [ ] Tenant entitlement model.
- [ ] Usage quota policies.
- [ ] Usage metering foundation.
- [ ] Tenant isolation checks.

## Epic 3. Identity And Access

- [ ] User account model.
- [ ] Employee model.
- [ ] Role model.
- [ ] Permission model.
- [ ] Team model.
- [ ] Session model.
- [ ] Email/password auth.
- [ ] External identity links.
- [ ] Bitrix24 auth provider.
- [ ] OIDC/ADFS provider.

## Epic 4. Clients

- [ ] Client model.
- [ ] Client contacts.
- [ ] Client sources.
- [ ] Client status/funnel.
- [ ] Client responsible assignment.
- [ ] Client merge/deduplication.
- [ ] Client audit timeline.

## Epic 5. Conversations And Messages

- [ ] Conversation model.
- [ ] Conversation participants.
- [ ] Message model.
- [ ] Attachments.
- [ ] Delivery states.
- [ ] Read states.
- [ ] Conversation projections.
- [ ] Inbox search.
- [ ] SSE realtime updates with polling fallback.

## Epic 6. Module System

- [ ] Module manifest.
- [ ] Module registry.
- [ ] Module config schema.
- [ ] Module secrets schema.
- [ ] Module capabilities.
- [ ] Module health checks.
- [ ] Module background jobs.
- [ ] Module UI slots.
- [ ] Module contract tests.

## Epic 7. Channels

- [ ] ChannelAdapter contract.
- [ ] Incoming message normalization.
- [ ] Outgoing dispatch flow.
- [ ] Attachment normalization.
- [ ] Error normalization.
- [ ] SMS fallback.
- [ ] Telegram adapter.
- [ ] VK adapter.
- [ ] MAX adapter.
- [ ] WhatsApp/Wazzup adapter.

## Epic 7A. Source Integrations

- [x] SOURCE-100 Source integration foundation.
- [x] SOURCE-101 SourceConnection contract and persistence.
- [x] SOURCE-102 SourceAccount contract and persistence.
- [x] SOURCE-103 Raw inbound event store.
- [x] SOURCE-104 Normalized inbound event model.
- [x] SOURCE-105 Source capabilities and reply capability model.
- [x] SOURCE-106 Idempotency keys for webhook, polling, email and API sources.
- [x] SOURCE-107 Identity resolver input contract for source identities.
- [x] SOURCE-108 Conversation resolver input contract for non-messenger events.
- [x] SOURCE-109 Link channel connectors to source connections without destructive rename.
- [ ] SOURCE-110 Source diagnostics, replay and DLQ policy.
- [ ] SOURCE-111 Source catalog categories for messengers, marketplaces, reviews, forms, email, telephony, CRM and API.
- [ ] SOURCE-112 Contract tests for source adapters and normalizers.

## Epic 8. Telephony

- [ ] TelephonyProvider contract.
- [ ] Call event normalization.
- [ ] Call recording storage.
- [ ] Employee extension mapping.
- [ ] Client phone matching.
- [ ] MegaPBX adapter.
- [ ] Beeline adapter.

## Epic 9. Support And Internal Messenger

- [ ] Internal direct chats.
- [ ] Internal group chats.
- [ ] Support team directory.
- [ ] Support case creation.
- [ ] Support team FAQ.
- [ ] Support case lifecycle.

## Epic 10. Public API And Webhooks

- [ ] API key model.
- [ ] Public API v1.
- [ ] OpenAPI generation.
- [ ] Client registration endpoint.
- [ ] Message send endpoint.
- [ ] Webhook subscriptions.
- [ ] Webhook retry/outbox.
- [ ] API audit and rate limits.

## Epic 11. Frontend Foundation

- [ ] Next.js app skeleton.
- [ ] App shell.
- [ ] Auth screens.
- [ ] Tenant admin shell.
- [ ] Inbox shell.
- [ ] Design tokens.
- [ ] Light/dark themes.
- [ ] Brand profile provider.
- [ ] i18n setup.
- [ ] Accessibility baseline.

## Epic 12. Client Applications

- [ ] Shared app-shell package.
- [ ] Native bridge contract.
- [ ] Web/PWA install baseline.
- [ ] Web Push support.
- [ ] Capacitor mobile app scaffold.
- [ ] Android build pipeline.
- [ ] iOS build pipeline.
- [ ] Mobile push notifications through FCM/APNs.
- [ ] Mobile deep links: Android App Links and iOS Universal Links.
- [ ] Mobile file/camera/media permissions.
- [ ] Tauri desktop app scaffold.
- [ ] Windows installer packaging.
- [ ] Desktop notifications and tray.
- [ ] Desktop deep links/custom protocol.
- [ ] Desktop auto-update.
- [ ] Tenant/server selection for SaaS, isolated SaaS and on-prem.
- [ ] Native client diagnostics and app version reporting.

## Epic 13. Deployment

- [ ] SaaS deployment baseline.
- [ ] Docker Compose on-prem package.
- [ ] Helm chart.
- [ ] Backup/restore runbook.
- [ ] Observability stack.
- [ ] License check.
- [ ] Upgrade/migration process.
