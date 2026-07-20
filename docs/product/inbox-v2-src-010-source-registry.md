# Inbox V2 Source Registry Authority

Status: implementation evidence for `INB2-SRC-010`.

> Clean-slate amendment (`2026-07-20`): ADR 0016 imports no legacy source rows.
> Retained source/auth schema ownership remains, but current row/object contents
> are disposable. `INB2-CLEAN-002` stops old writers and `INB2-DB-011` creates
> the registry directly from the current V2 baseline.

## Boundary

Inbox V2 uses the source-registry authority. Existing
`source_connections`, `source_accounts`, `channel_connectors`, channel sessions
and auth models are retained platform roots, but no legacy row without a current
V2 registry head is imported or treated as route authority.

The registry reuses, and does not duplicate, the following authorities:

- DB-003 owns canonical/provisional SourceAccount identity, aliases, re-auth
  history, identity revision and account generation;
- RBAC-003 owns structural SourceAccount access and its temporal revision;
- DB-009 owns the authentic lifecycle registry, storage roots, executable
  handlers and exact data-use lineage revisions;
- ADR 0011 binding and outbound-route authorities retain external thread,
  destination and message-affinity history.

## Authority chain

```text
tenant + exact base resource
  -> immutable source-registry transition
  -> current source-registry head (CAS revision)
  -> route-authority generation/state
  -> typed artifact and revocable secret references
  -> exact DB-009 registry/data-use lineage revision
  -> registered adapter contract and runtime handler
```

For SourceAccount route activation, the head additionally pins the current
DB-003 identity revision and account generation. A reconnect or re-auth result
cannot revive a stale identity generation.

## Current clean-slate and future compatibility rules

- No N-1 V1 writer is supported in the current clean-slate epoch; stale writers
  are stopped before reset and rejected after epoch rotation.
- Legacy arbitrary JSON and inline session/challenge ciphertext are not copied
  into the V2 authority; disposable legacy rows are deleted by
  `INB2-CLEAN-002`/`INB2-DB-011`.
- Existing bindings, occurrences, SourceAccount identity history and source
  rows are preserved on disable, delete, replacement and reconnect.
- Disable, delete, replacement and reconnect always advance or revoke the route
  generation, so an old inbound or outbound route cannot be reused.
- Provider-specific capability semantics remain owned by `INB2-DMX-001`.
- Physical credential revocation and ciphertext destruction remain owned by
  `INB2-DMX-005`; this task stores only revocable secret references.

## Onboarding rule

Standalone source onboarding is allowed only when all of the following are
present and mutually compatible:

1. an available source-catalog entry;
2. an authentic adapter registration with an exact contract version;
3. the declared onboarding/ingress runtime handler;
4. a complete authentic lifecycle composition and pinned lineage revision;
5. one transactional unit of work for the secret, base resource, first
   transition, head, artifact/secret references and ingress route.

The API does not invent a generic webhook path or provider token field. A
registered handler prepares the provider-specific route/configuration, and the
unit of work either commits every authoritative row or leaves none. Since no
standalone production handler is registered yet, current `coming_soon` sources
fail closed without writing a secret or SourceConnection.

The test-only MegaPBX slice exercises one explicitly named standard webhook-
secret profile: `revocable_secret_binding`, webhook ingress and the exact
`core:webhook-token` v1 one-time response. Only this profile may reuse the same
transient bytes for the credential and first response. Route material remains
independent, and another credential or response profile fails closed until its
own versioned mapper is registered.

## Production enablement gate

`INB2-SRC-010` establishes authentic contracts, storage and per-attempt atomic
registry writes; it does not claim that standalone onboarding is already a
production command. The two blocking protocol foundations are now implemented:

1. `INB2-CON-011` extracts the existing generic Inbox V2 authorized-command
   transaction coordinator instead of creating a source-specific idempotency
   table or fictitious authorization relation;
2. `INB2-SRC-011` adds a stable `clientMutationId`, canonical safe request hash,
   same-transaction authorization/temporal fence, tenant-stream event/audit
   commit and non-sensitive replay semantics to standalone onboarding.

Adapter prepare remains outside that database transaction. The first successful
response may disclose a registered one-time value, while an
`already_applied` replay never stores or rediscloses plaintext; a lost first
response requires credential rotation. Current production composition still
deliberately omits the real registry adapter, transactional authorization
resolver, fingerprint/lifecycle authority and onboarding unit of work.
Therefore no `setupMode=source_connection` item is enabled merely because the
generic protocol exists; the path remains unreachable and fail-closed until an
exact provider composition is reviewed.

## Verification map

The completion gate covers:

- composite same-tenant references for connection, connector, session, exact
  session/connector event, challenge and employee creator edges;
- strict contract rejection of unknown envelope versions, unclassified JSON,
  inline credentials, fake adapter registries and incomplete/stale lifecycle
  lineage;
- PostgreSQL fresh install, populated current upgrade and pinned N-1 expand;
- CAS races, stale identity/route generations and cross-tenant insert attempts;
- atomic onboarding failure injection and absence of orphan secrets/routes;
- proof that the production catalog has no available standalone source and that
  structural/fake registries or incomplete production composition cannot enable
  onboarding;
- disable/delete/replacement/reconnect preservation of history with denial of
  stale route reuse;
- focused legacy source/channel suites and the full repository quality gate.

## Verified evidence

`INB2-SRC-010` is implemented by the additive V2 source registry contracts,
module registry, SQL schema, repository, migration and internal onboarding API.
`INB2-CON-011` and `INB2-SRC-011` add the generic authorized-command coordinator
and replay-safe command surface; production standalone onboarding remains
fail-closed until a real provider installs every dependency listed above.

Verified on 2026-07-16:

- `pnpm exec vitest run packages/contracts/src/inbox-v2/source-registry.test.ts packages/modules/src/source-adapter-registry.test.ts packages/contracts/src/inbox-v2/public-boundary.test.ts`
  passed `3` files / `73` tests.
- `pnpm exec vitest run apps/api/src/internal-integrations-service.test.ts apps/api/src/http/internal-api-handler.test.ts`
  passed `2` files / `98` tests.
- `pnpm exec vitest run packages/db/src/repositories/sql-inbox-v2-source-registry-repository.test.ts packages/db/src/schema/inbox-v2-source-registry-schema.test.ts`
  passed `2` files / `20` tests.
- `pnpm test:inbox-v2:source-registry-integrity` passed `1` file / `4`
  live PostgreSQL migration tests.
- A clean temporary PostgreSQL database migrated with `pnpm db:migrate`
  verified `40` migrations and contract
  `sha256:9b254976e9003a0c4eaded656427214a1af9787983ea0f1426206f01fb9bd8be`;
  `pnpm exec vitest run --no-file-parallelism packages/db/src/repositories/sql-inbox-v2-source-registry-repository.integration.test.ts`
  then passed `1` file / `2` live repository tests.
- `pnpm exec vitest run --no-file-parallelism scripts/db/inbox-v2-n1-upgrade.integration.test.mjs`
  passed `1` file / `2` N-1 upgrade tests.
- `pnpm db:check`, `pnpm typecheck` and `pnpm lint` passed.
- `pnpm check` passed with `308` test files / `3146` tests, with `33` files /
  `264` opt-in integration tests skipped by the default process.
