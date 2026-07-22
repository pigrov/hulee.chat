# INB2-CLEAN-GATE V1 ownership allowlist

Date: `2026-07-22`

Status: `verified`

## Purpose

The clean-slate boundary removes the obsolete Inbox V1 implementation, not
every stable contract whose first public version is named `v1`. A prefix-only
search would incorrectly delete Public API, generic internal API and explicit
event/module/schema versions.

The repository guard in
`scripts/checks/inbox-v2-clean-slate-check.mjs` rejects the removed V1 file set,
obsolete runtime constructors and the retired `message.sent` and
`conversation.routing.updated` event identifiers. `pnpm db:check` independently
rejects the five removed Inbox V1 relations and three enums from the sole
baseline. Runtime startup additionally rejects a database in which any removed
V1 relation is present.

## Reviewed retained classes

The following classes are allowlisted by ownership:

- Public API `/v1` and its `public-api-v1` contract are the first supported
  external protocol version, not an internal Inbox implementation.
- Generic `/internal/v1` auth, tenant, RBAC, integration, health and Web client
  routes are retained platform protocols. The health route now reports the
  verified Inbox V2 schema epoch.
- `@v1`, `_v1` and `...v1` suffixes inside Inbox V2 contract schema IDs,
  immutable event names, SQL functions and wire formats are explicit version
  identifiers. They remain versioned even though Inbox V2 is the only runtime.
- Recipient-sync V1 wire decoding is an explicitly versioned input format
  inside the V2 synchronization contract; it does not read or write the removed
  Inbox V1 domain/schema.
- The shared object-storage V1 compatibility method is owned by the storage
  provider contract and is unrelated to the deleted Inbox model.
- `INB2-MIG-001` / `mig_001` identifiers remain only as immutable reset
  evidence provenance, tests and historical disposition documentation. The
  generic destructive reset remains forbidden for shared/SaaS/on-prem targets.
- Tests, nginx path fixtures and clean-slate guard adversarial strings may name
  allowed versioned surfaces or forbidden symbols in assertions; they do not
  compose runtime authority.

## Search receipt

The reviewed command was:

```text
rg -l -i --glob '!**/*.md' --glob '!packages/db/drizzle/**' --glob '!**/*.snap' '\bV1\b|/internal/v1|/v1|inbox[_-]?v1|message\.sent|conversation\.routing\.updated|MIG-001|mig_001|n1-bundle|online-bridge' apps packages scripts deploy .github package.json
```

After path sorting it returned `325` files with SHA-256
`3b43ad02a950135ff2649974e3dced31f3c9850d01a839ca788e1654a02b3815`.
Every match belongs to one of the retained classes above or to the guard/test
that rejects it. A separate exact event-ID scan returned zero runtime/test
definitions of the two retired V1 event types outside adversarial guard input;
the automated removed-symbol scan passed across all `apps` and `packages`
JavaScript/TypeScript sources.

This allowlist does not permit a V1 repository, route fallback, worker loop,
provider owner, UI model or database relation to return. Any such addition must
fail the clean-slate guard regardless of its file name.
