# Quality Gates

## Required Local Checks

The exact command names can be decided during scaffolding, but the project should have these gates:

- TypeScript typecheck.
- Unit tests.
- Lint.
- Format check.
- Migration generation/check.
- i18n hardcoded text check.
- Encoding/broken character check.
- Branding hardcoded product/logo check.
- Native bridge contract tests.
- UI slot contract tests.
- Entitlement policy tests.
- Dependency/unused export check after the codebase stabilizes.

Recommended command shape:

```bash
pnpm check
pnpm test
pnpm typecheck
pnpm lint
pnpm format:check
pnpm db:check
pnpm i18n:check
pnpm encoding:check
pnpm native:check
```

## Unit Tests

Unit tests are mandatory for:

- domain services;
- permissions;
- entitlement and usage limit decisions;
- data lifecycle policy, hold/restriction and export/delete decisions;
- assignment logic;
- message routing;
- adapter mappers;
- native bridge abstractions;
- provider error normalization;
- API request/response contract mappers;
- i18n helpers;
- design token helpers if logic is present.

## Integration And Contract Tests

Required where relevant:

- database repository tests;
- migration smoke tests;
- public API contract tests;
- webhook contract tests;
- adapter contract tests;
- UI slot contract tests;
- queue/outbox processing tests;
- tenant isolation tests.
- same-tenant composite-FK and destructive lifecycle-worker isolation tests;
- object/version/index/cache deletion and restore-erasure reconciliation tests;
- typed audit/privacy-evidence redaction and finite-retention tests;
- native bridge contract tests.
- mobile/desktop packaging smoke tests where relevant.

## Inbox V2 Pre-Production Schema Epoch

ADR 0016 revision `clean-slate-2026-07-20-r1` replaces V1 preserve/N-1 gates
with one clean-slate gate until the first real release. `INB2-CLEAN-001` retains
the current unit/type/schema, PostgreSQL repository, Conversation-head and
disposable reset gates while freezing deployment. `INB2-DB-011` and
`INB2-CLEAN-GATE` must evolve CI to verify the final target:

- one current baseline and deterministic schema drift/invariant checks;
- fresh empty install plus idempotent tenant/projection bootstrap;
- explicitly guarded disposable reset and stream-epoch rotation;
- Inbox V2 PostgreSQL repository and Conversation-head integrity tests;
- schema ownership, role and ACL audit;
- API/Web/worker startup with provider egress disabled;
- a repository guard that keeps application deployment manual and locked until
  `INB2-CLEAN-GATE`.

No V1 preserve-upgrade, N-1 V1 runtime bundle, backfill or online-bridge lane is
required for this unpublished epoch. The first real production/on-prem baseline
restores append-only migration and supported-release upgrade gates.

## E2E Tests

E2E should cover only critical user paths:

- tenant registration/login;
- integration setup happy path;
- open inbox and send a message;
- receive a message from a channel;
- create support case;
- admin enables/disables a module.
- mobile app opens a conversation from a deep link;
- desktop app opens a conversation from a custom protocol link.

## i18n And Text Checks

CI should fail when:

- user-facing Russian text is added directly to TS/TSX components;
- product names or logo paths are hardcoded in UI components instead of brand profiles;
- translation key is missing in default locale;
- translation key is unused after cleanup threshold;
- mojibake/broken Cyrillic is detected.

Allowed Russian text locations:

- locale dictionaries;
- product documentation;
- tests/fixtures where intentionally testing Russian data;
- seed data.

## Design Token Checks

CI or lint should discourage:

- hardcoded hex colors in components;
- arbitrary one-off Tailwind values without reason;
- direct theme-specific colors outside token definitions;
- UI components that cannot support dark theme.
- company colors outside brand token definitions.

## Operational Quality

Every integration must expose:

- health status;
- last successful inbound event;
- last successful outbound event;
- last failure;
- normalized error code;
- retryability;
- operator hint.
