# Deployment Model

## SaaS Shared

Multiple tenants run in one shared deployment.

Recommended for:

- small and medium companies;
- fast onboarding;
- standard modules;
- subscription billing.

Data isolation must be enforced with `tenantId` in every business table, API operation, event, job, file path and audit record.

SaaS shared deployments should report tenant-scoped usage for storage, transcription, AI, API requests, webhook events and active employees into the billing/entitlement layer.

## SaaS Isolated / Enterprise SaaS

A tenant runs in a dedicated deployment managed by Hulee.

Recommended for:

- larger companies;
- stronger compliance requirements;
- custom integration load;
- custom release windows.

## On-Prem

The product runs on company infrastructure.

Required packaging:

- Docker Compose for simple/small installations.
- Helm chart for Kubernetes production.
- S3-compatible object storage support.
- PostgreSQL migrations and backup/restore runbooks.
- License/config mechanism.
- Optional offline mode for restricted environments.

On-prem deployments enforce a signed license and local usage policies. Expensive external services such as AI and transcription can use customer-owned provider credentials, Hulee-managed add-ons or disabled/offline mode depending on entitlement.

Every deployment keeps a local versioned ADR 0015 data-governance context:
regime-specific processing responsibility, jurisdictions, residency/cross-border
routes, lifecycle profile and privacy-request SLAs. Shared SaaS resolves it per
tenant; isolated/on-prem may use a deployment-specific profile without a fork.

Backups and object versions have finite policy windows. Restore must reapply a
newer erasure/legal-hold ledger before API/workers/search/analytics become
available. On-prem packaging supplies the same local export/delete/hold/evidence
commands even when the SaaS control plane is offline or the license is expired.

## Release Strategy

- Core releases are versioned.
- Module releases are versioned.
- Public API and event schemas are versioned independently.
- Mobile and desktop app releases are versioned and traceable to compatible core/API versions.
- On-prem upgrades must run migrations explicitly and produce a rollback/backup plan.
- Company-layer must declare compatible core version.

Inbox V1 to V2 disposition follows ADR 0014 and
`docs/product/inbox-v2-migration-and-cutover.md`. The current pre-production
fast path directly replaces V1 only after inventory proves no supported
deployment/consumer/valuable data; a preserve deployment still uses expand-only
migrations, one fenced side-effect owner and a separate destructive contraction
after backup/restore and observation evidence.

## RBAC Migration State

Scoped RBAC is the active authorization model. Effective permissions are resolved from tenant roles, role bindings and direct grants.

Legacy `employee_roles` is removed by migration after RBAC backfill. Runtime code must not read or write it for authorization, audit previews or bootstrap flows. New deployments and seed flows must create tenant roles and tenant-scoped bindings for initial administrators.

Rollback from RBAC migration defects should use an application release rollback plus database backup/restore runbook. There is no runtime flag that re-enables fixed employee roles as an authorization fallback.

## Client App Distribution

- Web/PWA is deployed with the web application.
- Android is distributed through Google Play tracks or enterprise distribution where required.
- iOS is distributed through TestFlight/App Store and requires macOS/Xcode or macOS CI for signing/builds.
- Windows desktop is distributed through a signed installer and an auto-update channel.
- On-prem customers may require separate update channels and tenant/server URL configuration.
- Native clients must support configurable server/tenant URLs for shared SaaS, isolated SaaS and on-prem deployments.
- Native client releases must declare compatible API/core versions.
- Web/PWA branding can be resolved at runtime from host/domain, tenant and deployment brand profile.
- Full white-label mobile/desktop branding for app name, app id, icon, signing and update channel requires a release profile per customer or distribution channel.

## Recommended Runtime Components

- Web application.
- Mobile application package.
- Desktop application package.
- API service.
- Worker service.
- Realtime stream endpoints in API for MVP; separate realtime gateway when scale or WebSocket features require it.
- PostgreSQL.
- Object storage.
- Queue/outbox processor.
- Observability stack.

Redis can be added for cache, locks, sessions or realtime fanout when scale requires it. The MVP should avoid mandatory infrastructure unless it is clearly needed.

## Provider Egress

Hulee-managed SaaS must route Telegram and WhatsApp provider traffic through a
managed egress profile, normally VPN/proxy-backed. This applies to Telegram Bot,
Telegram user/QR, WhatsApp QR and any future WhatsApp Business API connector.

Web, API, PostgreSQL and regular platform workers should stay on normal
networking. Provider calls such as diagnostics, webhook sync, polling, outbound
send and user-session auth should run in an egress-routed runtime/worker or use
a provider client explicitly bound to the selected egress profile.

Direct egress for Telegram/WhatsApp is acceptable only for local/dev bootstrap
or when an on-prem/customer-network deployment explicitly owns that route.
