# Tech Stack

## Baseline

- Language: TypeScript.
- Runtime: Node.js LTS.
- Package manager: pnpm.
- Monorepo: pnpm workspaces.
- Frontend: Next.js App Router.
- UI: React, Tailwind CSS, CSS variables/design tokens.
- Mobile apps: Capacitor for Android and iOS.
- Desktop apps: Tauri for Windows, with macOS/Linux support when needed.
- Database: PostgreSQL.
- ORM/migrations: Drizzle ORM + drizzle-kit.
- Validation: Zod or another schema-first validation library.
- Testing: Vitest for unit tests, Testing Library for React components, Playwright for critical E2E flows.
- Object storage: S3-compatible API, MinIO for local/on-prem.
- Realtime: SSE for MVP, with polling fallback; WebSocket or a separate realtime gateway only when product needs require it.
- Observability: OpenTelemetry-compatible traces/metrics/logs.

## Applications

Recommended deployable apps:

- `apps/web`: Next.js frontend, app shell, tenant admin, inbox, auth screens.
- `apps/mobile`: Capacitor Android/iOS app.
- `apps/desktop`: Tauri Windows/macOS/Linux desktop app.
- `apps/api`: public API, webhooks, integration callbacks.
- `apps/worker`: outbox, retries, background jobs, provider sync.
- `apps/realtime`: optional SSE/WebSocket gateway if realtime fanout should scale separately.

For MVP, realtime starts as SSE endpoints in `apps/api` with polling fallback. The boundary should stay explicit so it can move to `apps/realtime` later without changing core.

## Packages

Recommended packages:

- `packages/contracts`: shared types, events, adapter interfaces, public API schemas.
- `packages/core`: business use cases, policies, permissions, domain services.
- `packages/db`: Drizzle schema, migrations, database client helpers.
- `packages/modules`: standard modules and adapters.
- `packages/ui`: shared UI primitives and design tokens.
- `packages/app-shell`: shared client navigation, layouts, auth state and inbox shell logic.
- `packages/native-bridge`: common interface for push, deep links, files, notifications and app metadata.
- `packages/branding`: brand profile resolution, asset references and token override helpers.
- `packages/entitlements`: plan/license evaluation, quota policy and usage limit helpers.
- `packages/i18n`: locale dictionaries and translation helpers.
- `packages/testing`: factories, fixtures, contract test helpers.
- `packages/observability`: logging, metrics and tracing helpers.

## Frontend Standards

- Use design tokens for color, spacing, radii, typography and semantic states.
- Support light and dark themes from the start.
- Allow company theme overrides through token values, not arbitrary component styles.
- Resolve product name, logos, favicon/PWA icons and support/legal links through brand profiles.
- Do not hardcode product names or logo paths in UI components.
- Do not hardcode Russian UI text in components.
- Use i18n keys and locale dictionaries.
- Prefer accessible primitives for dialogs, popovers, tooltips, menus and tabs.
- Icons should come from one icon system, for example `lucide-react`, unless a product-specific icon is needed.

## Native Client Standards

- Web/PWA, mobile and desktop are one client product with different shells.
- Mobile uses Capacitor for Android/iOS.
- Desktop uses Tauri for Windows/macOS/Linux.
- Native apps must use shared UI, i18n, contracts and app-shell packages.
- Native apps must not depend on server-only Next.js behavior.
- Native capabilities must be accessed through `packages/native-bridge`.
- Android builds require Android Studio and Android SDK.
- iOS builds require macOS, Xcode and Apple Developer account for signing, TestFlight and App Store distribution.
- Desktop builds require installer packaging, signing and auto-update design.
- Push and notifications must be deduplicated across web, mobile and desktop endpoints.

## i18n

Requirements:

- Default locale: `ru`.
- Planned locales: `en` and any company-required locales.
- Locale-aware dates, numbers, pluralization and time zones.
- No inline UI copy in components.
- Scanner/check that fails CI when Cyrillic or obvious user-facing text appears outside locale dictionaries, docs, tests or seed data.

Next.js has official App Router internationalization guidance, and `next-intl` is a strong candidate for the application layer.

## Database And Migrations

- Drizzle schema is the source for application-level table definitions.
- drizzle-kit generates and applies SQL migrations.
- Migration files are reviewed and committed.
- Avoid destructive migrations without explicit migration notes.
- Multi-tenant tables must include `tenantId` unless they are clearly global platform tables.
- Add indexes for tenant-scoped access paths.

## API Contracts

- Public API should have OpenAPI documentation.
- Webhooks should have versioned schemas.
- Internal events should have versioned schemas.
- Provider adapters should have contract tests.
- Idempotency keys are mandatory for external writes.

## Recommended Additional Tools

- ESLint for code quality.
- Prettier for formatting.
- TypeScript strict checks.
- Knip or similar unused export/dependency checks once the repo stabilizes.
- Secret scanning in CI.
- Encoding/localization scanner for broken characters and accidental hardcoded UI strings.
- Dependency audit as a scheduled job, not as a blocker for every local iteration unless severity is high.

## References

- Next.js App Router and TypeScript: https://nextjs.org/docs
- Next.js internationalization: https://nextjs.org/docs/app/guides/internationalization
- Drizzle Kit migrations: https://orm.drizzle.team/docs/kit-overview
- Tailwind dark mode: https://tailwindcss.com/docs/dark-mode
- Tailwind theme variables: https://tailwindcss.com/docs/theme
- next-intl: https://next-intl.dev/
- Capacitor: https://capacitorjs.com/docs
- Tauri: https://v2.tauri.app/
