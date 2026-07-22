# Inbox V2 CLEAN-003 Residual V1 Removal

Status: `done`

Task: `INB2-CLEAN-003`

Started: `2026-07-22`

Completed: `2026-07-22`

Disposition revision: `clean-slate-2026-07-20-r1`

## Result

The detached Inbox V1 implementation has been physically removed. Hulee now
has no V1 Inbox domain service, persistence repository, internal Inbox route,
Telegram V1 ingress or polling path, generic legacy outbox dispatcher, Inbox V1
Web client, action or file proxy. The clean-slate production composition remains
fail closed until V2 product surfaces and provider adapters are explicitly
activated.

This deletion is ownership-based. The following retained foundations are not
Inbox V1 and remain versioned where their contracts require it:

- the public message API `/v1` facade, currently backed by the clean-slate
  no-authority command service;
- non-Inbox `/internal/v1` tenant, authentication, administration, RBAC,
  organization, integration and source-account routes;
- Inbox V2 repositories, contracts, file download tickets and exact-version
  object reads;
- shared tenant, employee, source, session, file/object, event/outbox, audit and
  security roots.

## Deleted ownership slices

| Layer | Removed Inbox V1 ownership | Retained boundary |
| --- | --- | --- |
| Core | MVP vertical slice, external-channel command service, scalar conversation routing, legacy message/client/conversation ID allocation and permission migration mapping | tenant registration, authorization, Inbox V2 command/domain contracts |
| Contracts | generic V1 channel adapter and normalized message DTOs, internal Inbox view/reply/routing DTOs, legacy message intent events | public `/v1`, generic internal `/v1`, source/auth/session and Inbox V2 contracts |
| Database | external message, attachment-transfer, file-access and outbound-dispatch repositories; conversation-routing audit projection | tenant/source/security audit, event/outbox and Inbox V2 repositories |
| API | external/public V1 command services, internal Inbox query/command routes, legacy file service and Telegram V1 webhook implementation | fail-closed public facade/webhook, generic internal routes and Inbox V2 file download service |
| Worker | Telegram polling, outbound, attachment-transfer and legacy outbox processors | provider-neutral secret resolver/control outbox and disabled production provider composition |
| Modules | V1 Telegram normalizer/channel adapter and Public API adapter surface | module manifests, connector settings and Telegram Bot API transport/diagnostics |
| Web | Inbox API client, reply/routing actions and helpers, queue options, V1 file route and obsolete Inbox layout styles | clean-slate root plus administration, integrations, source/auth and RBAC UI |

The historical preserve-upgrade, N-1 bundle, reviewed-online-bridge and V1 RBAC
mapping scripts, fixtures, CI jobs and package commands were already excluded by
the active clean-slate epoch and consolidated database baseline. CLEAN-003
removes the remaining runtime and compile-time consumers instead of recreating
compatibility seams.

## Durable absence guard

`pnpm inbox-v2:clean-slate:check` now walks production and test sources below
`apps/` and `packages/`. It rejects the known deleted file paths, removed V1
service/DTO/adapter symbols, the old `message.sent` intent and
`conversation.routing.updated` audit action. It continues to distinguish those
owned symbols from legitimate versioned `/v1` contracts and from historical
documentation.

The same guard still enforces the manual deployment freeze, provider-free
production worker, disabled provider I/O, fail-closed Public API and Telegram
surfaces, foundation-only seed and clean V2 migration command.

## Verification

The dependency-aware clean-slate check passed against the real repository and
found no deleted path or removed V1 symbol in production or test sources. The
remaining `/v1` references are reviewed public/generic internal contract
versions, clean-slate negative assertions or historical documentation.

- `pnpm test:inbox-v2:source`: `79/79` files and `1,211/1,211` tests passed;
- `pnpm test:inbox-v2:postgres`: `34/34` files and `373/373` executed tests
  passed; `6` declared tests were skipped;
- focused outbound transport PostgreSQL repeat: `1/1` file and `46/46` tests
  passed after an initial cold-Docker full run hit three exact `5,000 ms` test
  timeouts; the subsequent complete warm run passed;
- `pnpm check`: `348` passed files and `4,013` passed tests (`33` files / `381`
  tests skipped by declared gates), plus format, lint, typecheck, DB baseline,
  i18n, encoding, branding, native and clean-slate checks;
- `git diff --check` passed.

The next active task is `INB2-CLEAN-GATE`: verify the V2-only local and remote
boundary, reset the disposable external state and decide whether the temporary
deployment freeze can be removed.
