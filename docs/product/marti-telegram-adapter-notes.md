# Marti Telegram Adapter Notes

## What To Reuse As Practice

- Keep provider code behind a service/repository/Bot API split. Marti separates Telegram payload normalization, repository state, gateway dispatch and runtime wiring; Hulee should keep the same shape behind `ChannelAdapter` and module jobs.
- Stage inbound provider payloads before registering canonical messages. Marti stores inbound records with idempotency keys, status, attempts, raw payload and canonical links; Hulee should map that into tenant-scoped inbound adapter records plus `event_store`/`outbox`.
- Dispatch outbound messages asynchronously. Marti creates outbound dispatch records, deduplicates by idempotency key, sweeps pending/retrying records and only then updates delivery state; Hulee should send Telegram from worker/runtime, not directly from UI.
- Support webhook and polling modes. Telegram Bot API webhooks are the default runtime, but polling is useful for local/on-prem diagnostics and restricted networks.
- Normalize diagnostics for operators. Marti exposes status/run endpoints, last errors, retry metadata, bot sync, webhook sync and webhook status. Hulee should surface these through integration diagnostics and admin UI slots.
- Treat Bot API as a small client wrapper. Reusable patterns include `getMe`, `setWebhook`, `getWebhookInfo`, `deleteWebhook`, `getUpdates`, file metadata/download, timeout handling and provider error mapping.
- Enrich profiles outside core. Marti fetches Telegram avatars/profiles in adapter/runtime code. Hulee should keep this in module/provider jobs and write tenant-scoped files through storage providers.

## What Not To Copy Directly

- Marti domain-specific onboarding, employee pairing and conversation-platform details should not enter Hulee core.
- Provider-specific UI or admin actions must be contributed through approved UI extension slots.
- Connector secrets and deployment-specific settings must remain in module config/secret storage, not in shared core entities.
- Retry and diagnostics tables must include `tenantId`; Marti records are useful structurally, but Hulee needs tenant boundary on every row and job payload.

## Hulee Telegram Shape

1. `packages/modules/channel-telegram` owns Telegram normalization, Bot API client, error mapping and module manifest.
2. `apps/api` owns webhook callbacks and validates connector secret/header before handing payload to the module service.
3. `apps/worker` owns inbound registration sweep, outbound dispatch sweep and polling mode.
4. `packages/db` owns tenant-scoped adapter state repositories and delivery status persistence.
5. `apps/web` admin/inbox additions render only through `integration.settings.section`, `admin.section`, `inbox.sidebar.section`, `conversation.composer.tool`, `conversation.message.action` and `client.profile.card`.
