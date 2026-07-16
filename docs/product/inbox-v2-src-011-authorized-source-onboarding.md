# Inbox V2 Authorized Standalone Source Onboarding

Status: implementation evidence for `INB2-SRC-011`.

## Boundary

Standalone `source_connection` onboarding is one authorized, idempotent Inbox
V2 command. Provider preparation remains outside PostgreSQL. All durable source,
secret-reference, route-reference, authorization, audit and tenant-stream writes
then commit through one `INB2-CON-011` transaction.

The implementation does not make a catalog source available by itself. A
production source remains fail-closed until its real adapter, response profile,
transactional authorization resolver, lifecycle composition, fingerprint key
and source-registry unit of work are all installed.

Requiring the closed onboarding-result lifecycle slot finalizes the unreleased
`v1` adapter declaration; it is not a backward-compatible wire change. The
packages remain pre-release, no production or external registration is enabled,
and the current composition fails closed. If a persisted `v1` module
registration or external SDK consumer exists before release, enablement instead
requires a parallel `v2` contract and migration bridge.

## Command flow

```text
stable clientMutationId + safe request fields
  -> tenant-keyed HMAC credential fingerprint
  -> canonical request hash (no plaintext credential)
  -> adapter prepare outside the database transaction
  -> revalidate authorization snapshot and revision/expiry fences
  -> mint an unforgeable coordinator callback context
  -> one database transaction
       source connection + first registry transition/head
       classified artifacts + revocable secret/route references
       immutable non-sensitive command result snapshot
       authorization audit + tenant-stream change/event/outbox intent
  -> applied: registered one-time response may be returned once
  -> already_applied: load only the immutable non-sensitive snapshot
```

The request ID is preserved as an opaque transport correlation value. Command,
mutation, stream and result IDs are server-owned. The UI creates one mutation ID
on the server and preserves it for every retry of the same rendered form.

## Credential and route rules

- Caller-supplied credentials require a tenant/purpose/key-generation HMAC
  fingerprint provider. Missing key composition fails before adapter prepare.
- Production key rotation must retain every fingerprint generation for at least
  the command idempotency window, or resolve an existing command before
  recomputing the fingerprint. Rotating the only key must not silently turn an
  equal retry into a different-hash conflict.
- The request hash contains only the protected fingerprint, never the token,
  ciphertext or a low-entropy unsalted digest.
- Adapter failures are normalized to `module.unhealthy`; adapter exceptions and
  their possible credential-bearing cause are not propagated to logging.
- Platform-owned ingress route material is 32 random bytes and must be returned
  unchanged by the adapter. Generic validation rejects equality with every
  classified artifact, credential and every field of any current or future
  one-time-response profile.
- Only the registered standard webhook-secret response profile may intentionally
  reuse credential bytes as `core:webhook-token`. The bytes are zeroed after the
  response boundary and are never persisted in command, stream, event or audit
  rows.
- A lost first response is not replayed. Recovery is an explicit credential
  rotation command.

## Transaction and authorization rules

`SqlInboxV2AuthorizedCommandCoordinator` is the sole entry to the durable
command callback. Its callback context is runtime-capability checked, carries
the exact tenant/command/mutation/client-mutation identity and is valid only
during that callback. Source persistence rejects a forged or expired context
before SQL or encryption.

The coordinator locks the idempotency claim, rejects a different request hash,
and revalidates decision references, temporal expiry and every declared revision
fence in the same transaction. Adapter prepare is never repeated by a database
retry. Any callback failure rolls back the command claim, source rows, secret and
route references, result snapshot, audit and tenant-stream closure together.

The classified payload extension can only build typed SQL; the repository owns
execution and transaction scope. It cannot receive a raw transaction executor or
commit independently.

## Immutable replay and evidence

The compatibility `source_connections` row and source-registry head may advance
after onboarding, so neither is a valid replay result. The command instead pins
one `core:inbox-v2.source-onboarding-result@v1` reference to
`inbox_v2_source_onboarding_result_snapshots`.

That snapshot stores only the non-sensitive source result plus the exact
source-state and transition envelopes needed to resolve the original stream
references. Canonical JSON text is stored beside each JSONB value; PostgreSQL
recomputes its SHA-256, verifies the fixed schema shape and relates result fields
and clocks back to authoritative rows. Update and truncate are rejected. Delete
is allowed only after an official contiguous-prefix prune has advanced the
tenant stream past the snapshot's position and removed its payload-bearing
change/event/outbox rows, and after command, mutation and audit retention has
removed every remaining structured reference to the snapshot. The immutable
stream commit/dedupe skeleton remains. Direct deletion, an unadvertised stream
hole, a partial parent purge or a reference from any retained command, event,
outbox intent/work/outcome or audit row is rejected by the deferred constraint.

Random tenant-scoped `internal-ref:<64 hex>` values identify the audit target,
tenant facet and authorization grant sources. The source repository resolves
those references back to the source, tenant or authorization decision with an
explicit tenant predicate. Provider IDs, credentials and contact data never
become audit identifiers.

## Lifecycle and privacy

The immutable result is a minimized technical result/evidence copy with its own
closed `source_onboarding_result_snapshot` lifecycle slot. The standalone
adapter must declare that slot before registration. Persistence resolves its
authentic registry locator, existing source-metadata data use, effective policy,
rule, activation, legal-hold and restriction revisions inside the same database
transaction and stores those fences on the snapshot. Embedded source state and
transition locators remain additional coherence evidence, not a substitute for
registering the physical copy. The snapshot contains no plaintext secret,
provider payload, arbitrary compatibility JSON or message/contact content.

Credential material remains in the classified secret boundary with its own
revocation/destruction lifecycle. The successful privileged audit skeleton uses
the finite `core:privileged_security_audit_skeleton` policy. Direct result
update, delete and truncate remain fail-closed. Physical expiry is a two-stage
reviewed lifecycle: the existing security-definer prefix operation proves a
checkpoint/baseline, atomically prunes payload rows, advances
`minRetainedPosition` and records its retention advance; a later parent
retention transaction removes command/mutation/audit evidence and cascades the
snapshot while preserving the prefix-hidden commit skeleton. Ordinary command
replay therefore resolves for exactly the retained idempotency/history window.
`INB2-SRC-011` supplies the schema guard and executable proof, but installs
neither the production retention orchestrator nor the separate ordered tenant
teardown executor required by legacy `NO ACTION` parent edges.

## Production enablement gate

The ordinary API composition deliberately does not install a synthetic adapter
or test authorization resolver. Therefore current `coming_soon`
`setupMode=source_connection` entries remain unavailable and the route fails
closed without writes.

Enabling a real source requires all of the following in one reviewed
composition:

1. available catalog item and authentic adapter declaration;
2. registered prepare and one-time-response profiles;
3. tenant HMAC fingerprint key generation and cryptographic route factory;
4. authentic DB-009 lifecycle composition including the onboarding-result
   snapshot slot, official checkpoint-safe stream-prefix pruning and executable
   parent-retention/ordered-tenant-teardown handlers;
5. transactional authorization resolver and revision fences;
6. SQL authorized-command coordinator and source-registry repository;
7. integration tests for the exact production composition.

## Verification map

The completion gate covers:

- stable UI/API mutation identity and opaque UUID/512-character persistence;
- HMAC request hashing, secret-free errors and independent route material;
- same-hash concurrency, different-hash conflict and no duplicate provider
  prepare during database retries;
- authorization revocation/expiry after slow prepare;
- forged callback rejection and DB-only source persistence;
- full rollback with no command/source/secret/route/result/stream residue;
- immutable replay after the compatibility source changes;
- command/client-mutation/source stream evidence and tenant-scoped audit
  reference resolution;
- malformed JSON, digest/content mismatch, update/delete/truncate and closure
  invariant rejection;
- exact snapshot lifecycle locator/policy/control fences, direct-delete and
  incomplete-purge denial, checkpoint-safe prefix advancement, gap-free replay
  tail, preserved commit skeleton, generic-reference denial and final snapshot
  expiry without dangling event/outbox/audit payload references;
- fresh, current, preserve and pinned N-1 migration compatibility;
- fail-closed production composition when any dependency/profile is absent.

## Verified evidence

Verified on 2026-07-16:

- focused contract/module/API/DB suites passed, including source-specific
  concurrent equal-hash execution (`applied` plus `already_applied` with one
  durable source/snapshot/command) and two persistence callbacks with one
  adapter prepare;
- `pnpm test:inbox-v2:preserve` passed `3` files / `17` tests across populated
  V1 preserve, pinned N-1 compatibility and RBAC dry-run;
- `pnpm test:inbox-v2:postgres` applied `42` migrations on a disposable
  PostgreSQL database and passed `24` files / `225` tests. The migration
  contract is
  `sha256:258ece1966e15b981ea77507f5299472de1baebe97429b1d8290c76d0969de0c`;
- `pnpm check` passed formatting, lint, typecheck, `313` test files / `3187`
  executed tests, DB parity/digests, i18n, encoding, branding and native gates.
  The default run skipped `33` opt-in files / `268` tests;
- every disposable PostgreSQL database created by the verification gates was
  dropped after the run.
