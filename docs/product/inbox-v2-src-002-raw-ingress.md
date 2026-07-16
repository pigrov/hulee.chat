# Inbox V2 Sanitized Raw Ingress and Lease Queue

Status: implementation evidence for `INB2-SRC-002`.

## Boundary

The first durable source-event write accepts only a process-authentic
`InboxV2SanitizedRawIngressCandidate`. An adapter declaration pins the exact
sanitizer profile and the trusted module registry binds that profile to its
process-local handler. A supported webhook, polling, stream or API ingress
cannot register without this capability; `not_supported` ingress cannot
register one accidentally.

The sanitizer is deliberately adapter-owned. Core validates and scrubs the
transport containers, enforces the header allowlist and safe JSON output, but a
production adapter must project an explicit payload allowlist. It must never
echo the provider body merely because field names look harmless: a secret can
always be hidden in the value of an otherwise safe field.

The old public raw-event SQL writer and the MegaPBX helper that copied
`crm_token` and all request headers have been removed. Existing V1
`raw_inbound_events` remains only as a compatibility/FK anchor; no second raw
event identity root is introduced.

## Ingress flow

```text
ephemeral request bytes + headers
  -> authentic adapter sanitizer capability
       validate provider shape/signature as needed
       project an explicit restricted-payload allowlist
       retain only declared non-credential diagnostic/signature headers
  -> scrub caller and handler byte/header containers
  -> accepted authentic candidate or safe reason-only quarantine candidate
  -> repository derives identity digest and opaque idempotency key
  -> one READ COMMITTED transaction
       accepted:
         empty V1 compatibility anchor
         immutable safe envelope
         classified purgeable evidence rows
         one pending work head
       unsafe/collision:
         immutable safe quarantine row only
  -> workers claim with DB time and SKIP LOCKED
  -> exact lease renew/release or expired-lease reclaim
```

Authorization, cookie, password, token, session, API-key, private-key and other
credential-like header names cannot enter a sanitizer profile. The generic
safe-JSON clone rejects credential-like payload keys, accessors, exotic
prototypes, cycles, symbols, malformed Unicode, non-finite values and bounded
size/depth/node violations. An adapter rejection, exception, invalid output or
unknown shape becomes a stable reason code without persisting the request body,
headers, exception or raw event identity.

## Durable model

Four tenant-scoped companions are added around the existing anchor:

| Relation                          | Role                                                        | Mutation rule                                   |
| --------------------------------- | ----------------------------------------------------------- | ----------------------------------------------- |
| `inbox_v2_source_raw_envelopes`   | Scope, sanitizer lineage and safe envelope digest           | Immutable                                       |
| `inbox_v2_source_raw_evidence`    | Classified provider payload and allowlisted headers         | Immutable; independently deletable by lifecycle |
| `inbox_v2_source_raw_quarantines` | Safe reason/digest evidence for rejected input or collision | Immutable                                       |
| `inbox_v2_source_raw_work_items`  | One pending/leased work head with fenced lease state        | Exact guarded transitions only                  |

The compatibility anchor stores `external_event_id = null`,
`event_signature = null`, empty JSON payload/headers, no error text and
`processing_status = ignored`. Deferred constraints require one coherent
envelope/work aggregate and exact evidence flags at commit. Update/delete and
TRUNCATE guards protect immutable roots, while evidence deletion is intentionally
outside aggregate closure so its shorter classified retention can expire.

The envelope stores lifecycle catalog values for the raw envelope and evidence
stores their own data class, sensitivity and purpose set. This task installs the
classification and safe deletion boundary, not a production retention
orchestrator. Later lifecycle work must compact or remove technical digests in
accordance with the finite raw replay window and `INB2-ACC-040`.

## Idempotency and collision rules

The repository hashes the transient event identity and constructs
`source:v2:raw:<64 hex>` itself from tenant, connection, null-safe account
scope, transport, identity kind and identity digest. The raw identity string is
never a SQL parameter or quarantine field.

An `ON CONFLICT` result is not treated as success by key alone. The repository
locks and compares the existing immutable connection/account/transport/
identity scope, safe envelope digest and sanitizer lineage. An exact retry
returns the original raw-event ID without changing evidence or work state. A
mismatch creates stable `source.idempotency_collision` quarantine evidence and
never returns the unrelated row as the caller's event. Exact replay continues
to work after independently retained payload/header evidence has been deleted,
because comparison depends only on the immutable envelope.

## Claim, lease and stale reclaim

Claim uses one PostgreSQL clock sample, deterministic due ordering and
`FOR UPDATE SKIP LOCKED`. A unique random token is generated per claim ordinal;
only its domain-separated SHA-256 is stored. The raw token is returned once to
the worker.

Every claim increments the attempt count and revision. Reclaim is allowed only
at or after database-observed expiry and records the prior owner, token digest,
lease revision and expiry. Renewal and release lock the row first, require the
exact tenant/event/worker/token/revision fence and must occur before expiry.
Stable outcomes distinguish not found, not leased, stale token, expired lease
and revision conflict.

This task intentionally has no processed/dead terminal transition. `INB2-SRC-003`
will own atomic normalization plus completion of the claimed raw item;
`INB2-SRC-008` will own retry/backoff/DLQ and replay administration. Keeping
those transitions out of `SRC-002` prevents two competing lifecycle owners.

## Production enablement gate

Production ingress remains disabled until a real adapter composition supplies:

1. an authentic declaration and exact sanitizer profile/handler pair;
2. provider-specific signature/auth validation over ephemeral input;
3. explicit payload and diagnostic/signature-header allowlists with credential
   sentinel contract tests;
4. the SQL raw-ingress repository and tenant-scoped connection/account roots;
5. lifecycle composition for both evidence classes;
6. the `SRC-003` normalization/completion transaction and `SRC-008` retry/DLQ
   policy.

## Verification map

The completion gate covers:

- credential-bearing body/header fixtures and unsafe output shapes;
- forged sanitizer, profile mismatch, unsupported ingress and forged candidate;
- absence of a public content-writing SQL builder or legacy raw writer;
- exact retry, evidence-purged retry, cross-scope forced key collision and
  same-scope different-envelope collision;
- concurrent record and multi-worker claim winner behavior;
- exact renew/release fences, expired crash recovery and reclaim diagnostics;
- direct DB invariant rejection for unsafe/incoherent aggregate mutation;
- current, preserve and pinned N-1 migration compatibility;
- full repository quality gate.

## Verified evidence

The task gate completed on `2026-07-16`:

- focused sanitizer, declaration, registry, API and repository suites passed;
  the final independent contract/schema rerun covered `6/6` files and `121/121`
  tests, while the repository unit plus live PostgreSQL pair covered `2/2`
  files and `21/21` tests;
- the disposable current-schema PostgreSQL gate applied all `43` migrations and
  passed `25/25` files and `232/232` tests;
- the populated V1 preserve upgrade, pinned source-bundled N-1 runtime and RBAC
  dry run passed `3/3` files and `17/17` tests;
- the migration contract is
  `sha256:b9b743b8b486cdfcabcf6a26fe6cdba8d665edef063c9ef80f7364184861c804`;
- full `pnpm check` passed: `316` test files and `3229` tests executed, with
  `34` opt-in files and `275` tests skipped by the default process; format,
  ESLint, TypeScript, DB parity, i18n, encoding, branding and native-boundary
  gates all passed;
- independent contract/schema, repository/concurrency and credential-gap
  reviews found no remaining P0/P1 defect in the task scope.
