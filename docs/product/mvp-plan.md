# MVP Plan

## MVP objective

MVP Hulee должен доказать, что продукт может работать как единый multi-tenant core для SaaS и on-prem, принимать внешние клиентские сообщения, показывать их в inbox, позволять сотруднику ответить, фиксировать события и запускаться из одного репозитория без provider-specific логики в core.

MVP не должен закрывать весь список интеграций. Он должен зафиксировать платформенные границы так, чтобы следующие каналы, телефония, SSO, AI, billing и company-layer добавлялись через контракты, модули и конфигурацию.

## MVP scope decisions

- Поставка: shared SaaS и простой on-prem через Docker Compose.
- Изоляция: shared PostgreSQL с обязательным `tenantId` во всех tenant-owned таблицах, событиях, job payload, API операциях и file prefixes.
- Приложения: `apps/web`, `apps/api`, `apps/worker`; production-цель для клиентов - `apps/mobile` на Capacitor и `apps/desktop` на Tauri. В MVP native-клиенты могут быть scaffold-only, но границы `packages/app-shell` и `packages/native-bridge` нужно заложить сразу.
- Отдельный `apps/realtime` откладывается; MVP использует SSE внутри `apps/api` с polling fallback и явной границей для будущего выделения.
- Минимальный набор модулей: local auth, public API channel, Telegram channel, outbound webhooks, S3-compatible storage, license stub, company example.
- Первый внешний канал: Telegram, потому что он достаточно показателен для inbound webhook, outbound send, diagnostics, idempotency и contract tests.
- Телефония: только базовый `TelephonyProvider` contract и event schema, без production adapter в MVP.
- SSO: вне MVP. В MVP только email/password и заготовка `AuthProvider`.
- Billing/payment provider: вне MVP. В MVP нужны license/plan flags, entitlement evaluator и usage policy contracts, которые одинаково работают в SaaS и on-prem.
- Полный SaaS control-plane service вне MVP, но ownership boundary control-plane/data-plane нужно заложить сразу. Data-plane должен работать локально/on-prem по license snapshot без постоянной связи с control-plane.
- Workflow automation: вне MVP. В MVP только domain events, outbox и webhooks.
- Enterprise physical isolation: вне MVP. Архитектура должна не блокировать schema-per-tenant, database-per-tenant и isolated deployment позже.

## Out of MVP

- VK, MAX, WhatsApp/Wazzup, SMS fallback и production telephony adapters.
- ADFS, LDAP, OIDC/SAML, Bitrix24 auth.
- AI-модули, транскрибация, summary и аналитика качества.
- Полноценный billing и subscription provider.
- Сложный workflow/rule engine.
- Advanced search, deduplication, merge, SLA и аналитические dashboards.
- Production-hardening Helm chart. В MVP достаточно initial chart skeleton после Docker Compose.
- Полный production release pipeline для App Store, Google Play и desktop auto-update. Архитектура и scaffold должны быть заложены, но полноценная публикация может идти отдельным эпиком.
- Полная white-label сборка mobile/desktop приложений с customer-specific signing, app ids и update channels. MVP должен заложить brand profile и runtime branding, но не обязан выпускать отдельные store/installer variants.

## MVP backlog

| ID         | Priority | Area          | Deliverable                                | Acceptance criteria                                                                                                                                               |
| ---------- | -------- | ------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MVP-FND-01 | P0       | Platform      | pnpm monorepo skeleton                     | `pnpm install`, `pnpm check`, workspace package boundaries work locally.                                                                                          |
| MVP-FND-02 | P0       | Platform      | TypeScript strict baseline                 | All apps/packages use shared strict tsconfig. External declaration check exceptions, such as Drizzle optional dialect declarations, must be documented.           |
| MVP-FND-03 | P0       | Platform      | Lint, format, test setup                   | ESLint, Prettier and Vitest run through root scripts and CI.                                                                                                      |
| MVP-FND-04 | P0       | Platform      | Env/config validation                      | Apps fail fast on invalid env with typed config and safe error messages.                                                                                          |
| MVP-FND-05 | P0       | Platform      | Structured logging and error catalog       | Every app logs JSON, domain/provider errors map to stable platform codes.                                                                                         |
| MVP-FND-06 | P0       | Platform      | Encoding/i18n/design-token checks          | CI catches broken Cyrillic, direct Russian UI strings and hardcoded component colors.                                                                             |
| MVP-DB-01  | P0       | Database      | Drizzle schema and migrations              | Initial migration creates tenant, identity, client, conversation, message, event, outbox and audit tables.                                                        |
| MVP-DB-02  | P0       | Database      | Tenant isolation guardrails                | Tenant-owned tables include `tenantId`, tenant-aware indexes and repository tests for cross-tenant access denial.                                                 |
| MVP-CON-01 | P0       | Contracts     | Versioned domain events v1                 | Events include id, version, tenantId, timestamp and idempotency metadata where relevant.                                                                          |
| MVP-CON-02 | P0       | Contracts     | Module manifest and adapter contracts      | `ModuleManifest`, `AuthProvider`, `ChannelAdapter`, `StorageProvider`, `WebhookSink` contracts are exported and tested.                                           |
| MVP-CON-03 | P0       | Contracts     | Public API v1 schemas                      | Request/response schemas exist for client registration, inbound message, outbound message and delivery status.                                                    |
| MVP-TEN-01 | P0       | Tenants       | Tenant model, settings and branding tokens | Tenant can be created with locale, timezone, enabled modules, plan/license flags and theme token overrides.                                                       |
| MVP-TEN-02 | P0       | Tenants       | Module registry per tenant                 | Tenant admin can enable/disable MVP modules according to license flags.                                                                                           |
| MVP-TEN-03 | P0       | Tenants       | Brand profile                              | Tenant can configure product display name, light/dark logo references, favicon/PWA icon references, support/legal links and theme token overrides.                |
| MVP-TEN-04 | P0       | Tenants       | Entitlement evaluator                      | Module access and quota decisions go through a shared license/plan/usage policy evaluator.                                                                        |
| MVP-ID-01  | P0       | Identity      | Account, employee, session models          | First tenant admin can sign in, create employees and assign basic roles.                                                                                          |
| MVP-ID-02  | P0       | Permissions   | Minimal RBAC                               | Admin, supervisor and agent roles gate tenant admin, inbox and API key operations.                                                                                |
| MVP-CLI-01 | P0       | Clients       | Client and contacts model                  | API/UI can create clients with phone, email and external handles scoped by tenant.                                                                                |
| MVP-CLI-02 | P1       | Clients       | Client timeline projection                 | Client profile shows communication and audit events from the shared event stream.                                                                                 |
| MVP-COM-01 | P0       | Conversations | Conversation and participant model         | Client conversations and internal participants are persisted with tenant boundary.                                                                                |
| MVP-COM-02 | P0       | Messages      | Message model and delivery states          | Inbound/outbound text messages have direction, status, idempotency key and error code.                                                                            |
| MVP-COM-03 | P0       | Inbox         | Inbox query projection                     | Agent can list conversations, open one conversation and see ordered messages.                                                                                     |
| MVP-EVT-01 | P0       | Events        | Durable event store and outbox             | Domain actions create events and worker can process pending outbox records idempotently.                                                                          |
| MVP-API-01 | P0       | Public API    | API keys per tenant                        | Tenant admin can create/revoke API keys; API requests are tenant-scoped and audited.                                                                              |
| MVP-API-02 | P0       | Public API    | Public API v1                              | External systems can register clients, send inbound messages and query delivery status through versioned endpoints.                                               |
| MVP-WHK-01 | P1       | Webhooks      | Outbound webhook subscriptions             | Tenant can subscribe to selected events; worker retries failed deliveries and records diagnostics.                                                                |
| MVP-MOD-01 | P0       | Modules       | Local auth module                          | Email/password auth is implemented as a module behind `AuthProvider`.                                                                                             |
| MVP-MOD-02 | P0       | Modules       | Public API channel module                  | Public API inbound messages normalize through `ChannelAdapter` before entering core.                                                                              |
| MVP-MOD-03 | P0       | Modules       | Telegram channel module                    | Telegram webhook and send flow normalize provider payloads, statuses and errors through contract tests.                                                           |
| MVP-MOD-04 | P1       | Modules       | S3 storage module                          | Attachments use tenant-scoped object keys with MinIO-compatible local setup.                                                                                      |
| MVP-UI-01  | P0       | Frontend      | Next.js app shell                          | Authenticated app has layout, navigation, theme switch, locale setup and protected routes.                                                                        |
| MVP-UI-02  | P0       | Frontend      | Tenant admin UI                            | Admin can manage tenant settings, employees, roles, modules, API keys and integration diagnostics.                                                                |
| MVP-UI-03  | P0       | Frontend      | Inbox UI                                   | Agent can open inbox, inspect client profile, read messages and send a reply.                                                                                     |
| MVP-UI-04  | P0       | Frontend      | i18n dictionaries                          | UI text comes from dictionaries with `ru` default and `en` placeholder structure.                                                                                 |
| MVP-UI-05  | P0       | Frontend      | UI slot registry and SlotHost              | Approved slots exist for tenant settings, integration settings, client profile, composer, inbox sidebar, admin, reports, message actions and support case panels. |
| MVP-APP-01 | P0       | Client Apps   | Shared client platform boundary            | `packages/app-shell` and `packages/native-bridge` exist with documented contracts and unit/contract tests.                                                        |
| MVP-APP-02 | P1       | Client Apps   | Native app scaffolds                       | `apps/mobile` and `apps/desktop` exist as scaffold apps and consume shared UI, i18n, contracts and app-shell packages.                                            |
| MVP-APP-03 | P1       | Client Apps   | Client bootstrap and endpoint registration | Web/native clients can resolve tenant/server config, report app version/build metadata and register notification endpoints without production push fanout.        |
| MVP-DEP-01 | P0       | Deployment    | Docker Compose local/on-prem package       | Web, API, worker, PostgreSQL and MinIO start with documented env and health checks.                                                                               |
| MVP-DEP-02 | P1       | Deployment    | Migration and seed commands                | On-prem operator can apply migrations, create first tenant/admin and back up PostgreSQL.                                                                          |
| MVP-DEP-03 | P1       | Deployment    | Helm skeleton                              | Initial chart mirrors service boundaries without production SRE guarantees.                                                                                       |
| MVP-QA-01  | P0       | Quality       | Unit and contract test coverage            | Core business logic, permissions, mappers and adapters have focused tests.                                                                                        |
| MVP-QA-02  | P1       | Quality       | Critical E2E flows                         | Playwright covers login, open inbox, receive message, send reply and enable/disable module.                                                                       |

## Technical repository skeleton

```text
hulee/
  apps/
    web/
      app/
      src/
        app-shell/
        features/
        i18n/
        theme/
      tests/
    mobile/
      capacitor.config.ts
      src/
      tests/
    desktop/
      src/
      src-tauri/
      tests/
    api/
      src/
        http/
        public-api/v1/
        callbacks/
        internal/
      tests/
    worker/
      src/
        jobs/
        outbox/
        modules/
      tests/
  packages/
    contracts/
      src/
        events/v1/
        public-api/v1/
        modules/
        adapters/
        errors/
    core/
      src/
        tenants/
        identity/
        permissions/
        clients/
        conversations/
        messages/
        files/
        events/
        audit/
        ports/
    db/
      drizzle/
      src/
        schema/
        migrations/
        repositories/
        tenant-scope/
    modules/
      auth-local/
      channel-public-api/
      channel-telegram/
      storage-s3/
      webhooks-outbound/
      license-basic/
    ui/
      src/
        primitives/
        tokens/
        slots/
          slot-host.tsx
          slot-registry.ts
          slot-contracts.ts
    branding/
      src/
        brand-profile.ts
        brand-resolver.ts
        token-overrides.ts
        asset-validation.ts
    entitlements/
      src/
        entitlement.ts
        license.ts
        usage-policy.ts
        usage-limits.ts
        entitlement-evaluator.ts
    app-shell/
      src/
        navigation/
        auth-state/
        inbox-shell/
        tenant-context/
    native-bridge/
      src/
        capabilities/
        deeplinks/
        notifications/
        files/
        app-metadata/
    i18n/
      messages/
        ru.json
        en.json
      src/
    observability/
      src/
        logging/
        tracing/
        metrics/
    testing/
      src/
        factories/
        contract-tests/
        tenant-isolation/
  company/
    example/
      manifest.json
      theme.tokens.json
      modules/
  infra/
    docker-compose/
    helm/
    postgres/
    minio/
  docs/
    api/
    runbooks/
  scripts/
    checks/
    db/
  package.json
  pnpm-workspace.yaml
  tsconfig.base.json
  eslint.config.mjs
  prettier.config.mjs
  vitest.config.ts
```

## Dependency rules

- `packages/contracts` has no dependency on app, db, core or concrete modules.
- `packages/core` depends on `contracts` and pure utility packages only. It owns use cases, permissions, policies and event creation.
- `packages/db` owns Drizzle schema, migrations and repository implementations. Apps wire db repositories into core ports.
- `packages/modules/*` depend on `contracts` and allowed core extension ports. They never introduce provider-specific branches into core.
- `apps/web`, `apps/mobile`, `apps/desktop`, `apps/api` and `apps/worker` are composition roots. They can depend on core, db, contracts, modules, i18n, ui, app-shell, native-bridge and observability according to runtime needs.
- `apps/mobile` uses Capacitor and must not depend on server-only Next.js behavior.
- `apps/desktop` uses Tauri and must not depend on server-only Next.js behavior.
- `packages/native-bridge` defines interfaces for push, deep links, files, notifications and app metadata; platform implementations live in app shells.
- `packages/branding` defines brand profile contracts, resolution rules, asset validation and token override helpers.
- `packages/entitlements` defines plan/license contracts, entitlement evaluation, usage policies and limit decisions. Business logic must use this package instead of checking plan names directly.
- `company/*` can provide config, theme tokens, manifests and optional modules, but cannot patch core files.

## Initial data model

Global platform tables:

- `tenants`
- `tenant_domains`
- `platform_admin_accounts`
- `module_catalog`

Tenant-owned tables:

- `tenant_settings`
- `tenant_brand_profiles`
- `tenant_brand_assets`
- `tenant_modules`
- `tenant_secrets`
- `tenant_entitlements`
- `tenant_usage_policies`
- `usage_records`
- `usage_period_summaries`
- `tenant_api_keys`
- `accounts`
- `employees`
- `employee_roles`
- `teams`
- `clients`
- `client_contacts`
- `conversations`
- `conversation_participants`
- `messages`
- `message_delivery_attempts`
- `files`
- `event_store`
- `outbox`
- `audit_log`
- `webhook_subscriptions`
- `integration_diagnostics`
- `notification_endpoints`
- `notification_events`

Every tenant-owned table must have:

- `tenantId`;
- tenant-aware primary or secondary indexes;
- repository methods that require tenant context;
- tests proving one tenant cannot read or mutate another tenant's data.

## First implementation plan

### Step 0. Confirm MVP boundaries

- Accept this document as the MVP baseline.
- Convert MVP backlog into issues or tracking board.
- Mark unresolved questions that remain intentionally outside MVP.

Exit gate: MVP scope is stable enough to scaffold code without reworking package boundaries.

### Step 1. Bootstrap monorepo

- Create pnpm workspace, shared TypeScript config, lint, format and Vitest.
- Create shared client/platform packages: `packages/ui`, `packages/app-shell`, `packages/native-bridge`, `packages/branding`, `packages/entitlements` and `packages/i18n`.
- Add root scripts: `check`, `typecheck`, `lint`, `format:check`, `test`, `db:check`, `i18n:check`, `encoding:check`.
- Add initial CI workflow with the same commands.

Exit gate: empty apps/packages pass all quality gates.

### Step 2. Build contracts and core vertical slice

- Implement contract package for ids, events, module manifests, adapter interfaces and error catalog.
- Implement core use cases for tenant creation, employee creation, client creation, conversation creation and message receive/send.
- Implement entitlement evaluator contracts for module access, storage quota, API/webhook limits and future AI/transcription usage.
- Emit durable events from every important use case.
- Add unit tests for permissions, tenant isolation assumptions and event creation.

Exit gate: core can run a complete in-memory scenario from tenant creation to message send with tests.

### Step 3. Add database and worker

- Add Drizzle schema and first migration.
- Implement repositories behind core ports.
- Add outbox processing in `apps/worker`.
- Add migration and seed commands for local and on-prem.

Exit gate: PostgreSQL-backed scenario passes and outbox jobs are idempotent.

### Step 4. Add API and module runtime

- Implement `apps/api` with public API v1, internal admin endpoints and integration callbacks.
- Add API key auth, request validation, rate-limit placeholder and audit records.
- Implement module registry loading and diagnostics surface.
- Implement public API channel and Telegram channel adapters with contract tests.

Exit gate: external inbound message creates client/conversation/message through adapter normalization.

### Step 5. Add client UI

- Implement shared app-shell boundaries for auth state, tenant context, navigation and inbox shell logic.
- Implement Next.js web/PWA client with auth screens, tenant admin and inbox.
- Add scaffold-only Capacitor and Tauri apps that prove native clients do not import server-only Next.js behavior.
- Add native-bridge contracts for deep links, notifications, files, badges and app metadata.
- Wire brand profile resolution, i18n dictionaries, light/dark/company theme tokens and approved UI slots through app-shell providers and `SlotHost`.
- Add tenant admin controls for product display name, logo references, favicon/PWA icon references, support/legal links and theme token overrides.
- Implement initial `SlotHost` placements for tenant settings, integration settings, client profile, conversation composer, inbox sidebar, admin, reports, message actions and support case panels.
- Ensure components do not contain Russian UI strings, raw colors, hardcoded product names or hardcoded logo paths.

Exit gate: user can sign in through web/PWA, configure Telegram/API key, open inbox and send reply; native app scaffolds compile against shared client contracts.

### Step 6. Package MVP deployment

- Add Docker Compose for web, API, worker, PostgreSQL and MinIO.
- Add health checks, backup/restore notes and migration runbook.
- Add initial Helm skeleton after Compose is stable.

Exit gate: clean machine can run MVP from documented commands.

### Step 7. Stabilize quality gates

- Add focused Playwright flows for login, module enablement, inbound message and outbound reply.
- Add contract tests for adapter diagnostics and provider error normalization.
- Add tenant isolation regression tests around repositories and API.

Exit gate: MVP release candidate passes local and CI checks.

## Definition of done for MVP features

- Public contracts are versioned.
- Tenant boundary is explicit in API, repository, event, job and file paths.
- Business logic has unit tests.
- Adapter logic has contract tests and normalized diagnostics.
- User-facing UI text is in dictionaries.
- Visual styling comes from design tokens.
- Product names, logos and brand assets come from brand profiles.
- Plan, license and quota decisions go through shared entitlement/usage evaluators.
- Module UI contributions render only through approved, versioned slots.
- Important actions create events and audit records.
- On-prem startup path is tested through Docker Compose.
