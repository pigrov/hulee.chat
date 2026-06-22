# Open Questions

## Resolved for MVP

- MVP modules: local auth, public API channel, Telegram channel, outbound webhooks, S3-compatible storage, license stub and company example.
- MVP app topology: `apps/web`, `apps/api` and `apps/worker`; `apps/mobile` and `apps/desktop` scaffold-only; `apps/realtime` deferred.
- MVP realtime: SSE endpoints in `apps/api` with polling fallback.
- MVP tenant isolation: shared PostgreSQL with strict `tenantId`; schema-per-tenant and database-per-tenant remain future options.
- MVP auth: email/password plus `AuthProvider` contract; SSO providers are outside MVP.
- MVP channels: Telegram plus public API channel; VK, MAX, WhatsApp/Wazzup and SMS fallback are outside MVP.
- MVP telephony: `TelephonyProvider` contract and event schema only, no production telephony adapter.
- MVP workflow: domain events, outbox and webhooks only; workflow/rule engine is outside MVP.
- SaaS pricing principle: core functionality should not be artificially cut by plan; plans primarily differ by seats, storage, transcription, AI usage, API/webhook throughput, retention, SLA and enterprise capabilities.
- MVP billing scope: no payment provider or invoice automation; include entitlement evaluator, usage policies and storage/API/webhook metering foundation.
- MVP control-plane scope: logical control-plane/data-plane boundary only; no separate control-plane service until data-plane vertical slice is stable.

## Still open

- Do on-prem customers receive source code, packaged builds, or both?
- How strict should company-layer isolation be?
- What is the initial license model for on-prem?
- What are the exact SaaS plan names, included quotas and overage prices?
- Which telephony providers are required for v1?
- Should billing be built internally or integrated with an external billing provider?
- What is the minimum plugin/module API that must be stable for v1?
- What is the required data retention/audit policy?
- What compliance requirements are expected for enterprise clients?
- Should native apps use bundled client assets, controlled remote shell, or a hybrid model per deployment type?
- Which white-label level is required for v1: runtime branding only, or separate mobile/desktop release profiles?
- Which Apple Developer, Google Play and desktop signing accounts/certificates will be used?
- What is the required auto-update policy for on-prem desktop apps?
- Should enterprise/on-prem mobile apps support customer-specific MDM/private distribution?
- What offline behavior is required for mobile and desktop clients?
