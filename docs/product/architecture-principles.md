# Architecture Principles

1. One core for SaaS and on-prem.
2. Tenant boundary is mandatory everywhere.
3. Integrations are adapters, not core branches.
4. Company customizations live in company-layer, modules, workflows or config.
5. Core does not know provider-specific implementation details.
6. Events are the integration backbone.
7. External operations must be idempotent.
8. Sources are broader than channels; channels are communication-source adapters, not the universal integration shape.
9. Public contracts are versioned.
10. UI supports extension slots.
11. Operational diagnostics are product features.
12. Design tokens are the only source of visual styling decisions.
13. UI text lives in i18n dictionaries, not in components.
14. Business logic is covered by unit tests.
15. Provider adapters are covered by contract tests.
16. On-prem packaging must not require a separate codebase.
17. Web, mobile and desktop clients are first-class product clients.
18. Shared client behavior lives in app-shell packages, not inside a single deployable app.
19. Native capabilities are accessed only through a native-bridge contract.
20. Native clients must not depend on server-only Next.js behavior.
21. Notifications are logical platform events that fan out to web, mobile and desktop endpoints without duplicate visible alerts.
22. UI slots are versioned module API and are rendered only through approved SlotHost boundaries.
23. Branding and white-label are configuration, brand assets and design token overrides, not UI/core forks.
24. Plans, licenses, quotas and limits are enforced through entitlement and usage policy evaluators, not ad hoc plan checks.
25. Control-plane owns product/deployment/commercial metadata; data-plane owns customer business data and traffic.

## Layering

Recommended layers:

- `contracts`: shared types, events, public API schemas, adapter interfaces.
- `control-plane`: tenant registry, deployments, plans, licenses, module catalog and release channels.
- `core`: domain models, use cases, permissions, event publishing.
- `modules`: external adapters and optional product modules.
- `ui`: shared primitives, design tokens and UI slots.
- `app-shell`: shared client navigation, auth state, tenant context and inbox shell logic.
- `native-bridge`: shared contracts for native capabilities such as push, deep links, files, badges and app metadata.
- `branding`: brand profile resolution, asset references and design token override helpers.
- `entitlements`: plan/license capability evaluation, quota policies and usage limit decisions.
- `apps`: deployable applications.
- `company`: tenant-specific extensions, branding, workflows and config.

Core can depend on contracts. Modules can depend on contracts and allowed core extension APIs. Core must not depend on a specific module.

`apps/web` can use Next.js App Router and server-specific behavior. `apps/mobile` and `apps/desktop` should use shared `ui`, `app-shell`, `i18n` and `contracts` packages, but must keep platform-specific native behavior behind `native-bridge` implementations.

## Event-first Design

Important actions should publish durable events:

- `tenant.created`
- `employee.created`
- `client.created`
- `client.qualified`
- `conversation.created`
- `message.received`
- `message.sent`
- `message.delivery_failed`
- `call.received`
- `support_case.created`
- `notification.created`
- `notification_endpoint.registered`
- `usage.recorded`
- `usage.limit_exceeded`
- `integration.failed`

Events must include `tenantId`, stable event id, timestamp, schema version and idempotency data where relevant.

## Extension Points

The product should be extended through:

- provider adapters;
- module manifests;
- UI slots;
- native bridge capabilities;
- brand profiles;
- entitlement and usage policies;
- workflow/rule engine;
- public API;
- webhooks;
- company config;
- company-specific modules.

Direct core patches should be rare and reviewed as platform changes.
