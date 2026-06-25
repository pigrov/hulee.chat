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

## Release Strategy

- Core releases are versioned.
- Module releases are versioned.
- Public API and event schemas are versioned independently.
- Mobile and desktop app releases are versioned and traceable to compatible core/API versions.
- On-prem upgrades must run migrations explicitly and produce a rollback/backup plan.
- Company-layer must declare compatible core version.

## RBAC Migration State

Scoped RBAC is the active authorization model. Effective permissions are resolved from tenant roles, role bindings and direct grants.

Legacy `employee_roles` data can remain in the database only as historical data until migration cleanup, but runtime code must not read or write it for authorization, audit previews or bootstrap flows. New deployments and seed flows must create tenant roles and tenant-scoped bindings for initial administrators.

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
