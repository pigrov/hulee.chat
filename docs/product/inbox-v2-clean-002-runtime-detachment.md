# Inbox V2 CLEAN-002 Runtime Detachment And Remote Drain

Status: `done`

Task: `INB2-CLEAN-002`

Started: `2026-07-20`

Completed: `2026-07-20`

Disposition revision: `clean-slate-2026-07-20-r1`

## Result

Inbox V1 no longer has read, write, listener or dispatch authority in the
production composition. The unfinished Inbox V2 user and message surfaces fail
closed instead of falling back to V1. Shared tenant, authentication, employee,
RBAC, administration, integration catalog, source-account/session, audit,
event/outbox and Inbox V2 foundations remain available.

This task detaches runtime authority; it does not claim that every residual V1
type, repository, route implementation or test has already been deleted.
Physical ownership-based deletion remains `INB2-CLEAN-003`, after the V2-only
database baseline in `INB2-DB-011`.

## Production composition boundary

| Surface                    | CLEAN-002 production behavior                                                                                                                               | Retained boundary                                                                 |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Web Inbox                  | Authenticated branded unavailable screen; no V1 Inbox query, reply or routing request                                                                       | Login/session, tenant brand, RBAC-derived navigation and admin UI                 |
| Web V1 file route          | HTTP `410` without internal API or object-storage access                                                                                                    | V2 signed download-ticket composition                                             |
| Internal Inbox API         | V1 Inbox query/reply/routing/file services are absent from the production factory and return `module.disabled`                                              | Auth, tenant/admin, RBAC, org, integration/source and V2 file-download routes     |
| Public API message surface | Client registration, inbound, outbound and delivery-status commands use a no-authority service and return `module.disabled`                                 | Versioned authentication, request IDs, audit and error envelope                   |
| Telegram webhook           | Clean-slate handler returns `204` without interpreting or validating provider payload, resolving a connector/secret or persisting a row                     | Versioned route boundary for a future V2 adapter                                  |
| Integration administration | Production service is composed with `providerIoEnabled: false`; provider validation/auth/webhook/diagnostic activation fails before secret/job/event writes | Catalog/list/read/draft/disable/delete and source/session persistence foundations |
| Worker                     | Production runner contains only core security-retention and egress-status housekeeping; every non-core feature fails startup with `module.disabled`         | Provider-neutral V2 worker/coordinator code for later explicit activation         |
| Bootstrap                  | `db:seed:foundation` creates only tenant/auth/RBAC/brand/module/entitlement/event/outbox roots                                                              | One-shot clean-database bootstrap                                                 |

The production Compose file has no provider worker or VPN gateway and pins
`HULEE_WORKER_FEATURES: core` literally. Deployment additionally rejects legacy
provider enablement, a non-core worker feature set, or stale provider container
names. Its migration service invokes only `db:migrate`; the historical preserve
installer and reviewed-online-bridge override are excluded. The CLEAN-001 manual
deployment freeze remained in force at CLEAN-002 completion. It was retired
only after `INB2-CLEAN-GATE` passed on `2026-07-22`.

## Foundation-only registration

Tenant registration was split from the obsolete MVP workspace repository. The
new repository writes exactly these retained row sets in one strict
transaction:

1. `tenants`
2. `tenant_settings`
3. `tenant_brand_profiles`
4. `tenant_modules`
5. `tenant_entitlements`
6. `accounts`
7. `employees`
8. `tenant_roles`
9. `tenant_role_permissions`
10. `tenant_role_bindings`
11. `event_store`
12. `outbox`

It creates no Client, Conversation, participant, Message, attachment, source
connection, connector, provider credential or provider session. Registration
supports an explicit password hash for normal sign-up and a nullable hash for a
foundation seed without a tenant login credential.

## Remote drain receipt

The known Hulee environment named production is covered by ADR 0016's explicit
pre-production disposable classification. No message, credential or secret
value was printed during the checks.

Pre-drain evidence:

- legacy API, Web, core-worker, provider-worker and VPN gateway containers were
  running;
- the outbox had zero `processing` records;
- Telegram connector configuration contained zero webhook-mode owners and one
  active bot using polling;
- two direct-account sessions were connected.

Executed drain:

- disabled restart policy and gracefully stopped legacy API, Web and core
  worker;
- stopped and removed the provider-worker and VPN gateway;
- invoked Telegram `deleteWebhook` for the one active bot through a temporary
  isolated VPN gateway with `drop_pending_updates=true`, then removed the
  gateway again;
- disabled four non-deleted provider connectors and cleared connector runtime
  configuration/diagnostics for all connector records;
- revoked six session records and cleared session ciphertext, fingerprints,
  leases, challenges and provider account/address state;
- cancelled or sanitized eight auth challenges and cleared encrypted challenge
  payloads.

Post-drain receipt:

- running legacy app/listener containers: `0`;
- existing provider-worker/VPN containers: `0`;
- stopped API/Web/core-worker restart policy: `no`;
- database application connections: `0`;
- provider connectors outside `disabled|deleted`: `0`;
- connector configuration, diagnostics or onboarding state outside `{}`: `0`;
- non-revoked sessions and retained session ciphertexts: `0`;
- active auth challenges and retained challenge ciphertexts: `0`;
- pending or processing outbox records: `0`;
- configured Telegram webhook owners: `0`.

PostgreSQL, MinIO and the public marketing site were not stopped. Their current
test data remains disposable and will be recreated by `INB2-DB-011` and the
clean-slate gate.

## Durable regression guard

`pnpm inbox-v2:clean-slate:check` now reads the real API, Web, worker, seed and
production Compose sources. It rejects:

- V1 message/Inbox/Telegram service construction in the API factory;
- provider I/O enabled in the integration production composition;
- polling, outbound, attachment or direct-account loops in the worker runner;
- V1 Inbox loading or file proxying from Web;
- the MVP seed command or demo/provider state in the foundation seed;
- the historical preserve installer or reviewed-online-bridge override in
  production Compose;
- provider-worker/VPN services or an environment-overridable production worker
  feature set.

## Verification

- task-focused CLEAN-002 suites: `10/10` files, `177/177` tests;
- retained auth/admin/source foundation suites, including registration through
  auth lookup and admin startup: `10/10` files, `88/88` tests;
- Web fail-closed client suite: `1/1` file, `15/15` tests;
- full sequential Vitest: `386` passed files and `4,261` passed tests (`44` files /
  `427` tests skipped by declared environment gates);
- `typecheck`, `db:check`, task-scoped ESLint/Prettier, `i18n:check`,
  `encoding:check`, `branding:check`, `native:check`, clean-slate guard,
  Compose parsing and `git diff --check` passed.

Subsequent outcome: `INB2-DB-011`, `INB2-CLEAN-003` and
`INB2-CLEAN-GATE` completed the baseline replacement, physical V1 removal and
remote clean-slate verification. See
`docs/product/inbox-v2-clean-gate.md`.
