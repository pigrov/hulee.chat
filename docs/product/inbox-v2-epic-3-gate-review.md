# Inbox V2 Epic 3 Exit Gate Review

- Gate: `INB2-EPIC-3-GATE`
- Reviewed: `2026-07-18`
- Result: `READY`

## Decision

Epic 3 has all eleven implementation prerequisites completed:

- `INB2-SRC-001` through `INB2-SRC-011`.

The exit decision is based on three complementary proofs rather than a
synthetic end-to-end source adapter:

1. the named `pnpm test:inbox-v2:source` corpus runs the provider-neutral
   contracts, worker materializers, repository units and external Inbox V2
   scenarios that define the SRC-001..011 boundary;
2. `pnpm test:inbox-v2:postgres` applies the ordinary current migration bundle
   and runs every opt-in Inbox V2 repository/schema integration fixture against
   one disposable PostgreSQL database;
3. preserve/N-1 and the clean repository quality gate prove that the source
   foundation remains additive and compatible with the rest of the tree.

The gate deliberately does not invent a test-only canonicalization algorithm.
Every result below comes from the implemented contracts, materializers,
repositories and database invariants.

## Acceptance Closure

| Required outcome                               | Implemented proof                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repeated raw and normalized input is safe      | SRC-002 and SRC-003 cover exact replay, concurrent recording/completion, lease loss, collisions and crash reclaim without acknowledging a different occurrence or normalized event.                                                                                                                                                   |
| One canonical external Conversation            | SRC-005 resolves authoritative provider-group observations through different accounts to one immutable ExternalThread and Conversation while account-scoped private threads remain separate. Concurrent first-event and rollback fixtures use the real SQL repository.                                                                |
| One canonical Message with complete provenance | SRC-006 creates one ExternalMessageReference and Message for the canonical key, attaches distinct account observations as separate SourceOccurrences/transport links and rejects conflicting immutable targets.                                                                                                                       |
| Late and out-of-order input converges          | SRC-006 defers edit/delete-before-create, then applies the exact target action. Stale, duplicate, conflicting and advancing positions are classified without moving a canonical head incorrectly; historical replay remains idempotent.                                                                                               |
| Canonical state is atomic                      | SRC-007 uses the authorized two-phase repository seam. Failure injection, retry and committed replay prove that Message/timeline, occurrence resolution, stream changes, events and outbox closure are all visible or all rolled back.                                                                                                |
| Unknown participants remain visible            | SRC-004 preserves an unresolved SourceExternalIdentity, derives a Conversation-local source participant after exact binding/thread verification and does not create Client, Employee, membership or RBAC authority. The external scenario keeps the Message author bound to that participant before and after a later identity claim. |
| Processing recovery is bounded                 | SRC-008 covers durable-before-cursor acknowledgement, stage-fenced retry, replay episodes, DLQ, tenant/account isolation, safe diagnostics and backpressure. SRC-009 separately fences provider-outbox claim/renew/reclaim/finalize outcomes.                                                                                         |

This is a compositional proof over real implementation boundaries. A single
test-only `InboxV2SourceProcessingCompositeTransactionLocalPort` would merely
test logic invented inside the fixture because the concrete worker/provider
composition is intentionally not part of this gate.

## Stable Source Corpus

`pnpm test:inbox-v2:source` is the durable local and CI entrypoint. Its checked
manifest groups non-PostgreSQL tests by the exact Epic 3 owner and fails closed
for missing, duplicate or unsafe paths. It includes:

- raw admission, normalization and stage-runtime contracts;
- source registry and authorized onboarding;
- identity assessment, claim and participant materialization;
- external thread/binding and Conversation resolution;
- canonical Message/occurrence reconciliation and late action ordering;
- atomic Message/stream/outbox materialization;
- replay, DLQ, diagnostics, backpressure and provider-outbox lifecycle;
- the external unknown-sender/identity-claim scenarios.

The PostgreSQL integration files remain owned by
`pnpm test:inbox-v2:postgres`; the named unit corpus does not silently run them
as skipped tests.

## Production Activation Boundary

SRC-007 supplies the authorized atomic persistence seam. SRC-008 supplies a
sealed production-activation capability: normalization plus the complete
SRC-004..007 stage set must come from one process-local composite and cannot be
forged, mixed or partially registered.

The current core intentionally does not yet provide the concrete
`processTransactionLocally` worker/provider composition. That later wiring must
reconstruct durable stage hand-offs, consume deferred participant intents,
assemble reconciliation requests and call the SRC-007 atomic seam without
creating a second provider authority. It is not a small missing mock and is not
silently claimed by this gate.

- `INB2-MIG-002` owns the reviewed online bridge, one canonical V2 command and
  the dual-materialization boundary while exactly one side owns provider I/O;
- `INB2-MIG-005` owns final Public API, provider, worker, seed and client cutover
  with zero V1 fallback.

Consequently this gate authorizes the dormant provider-neutral source
foundation, not provider traffic, legacy dual write, V1 removal or production
cutover.

## Verification Log

| Check                                                              | Result                                                                                                                                      |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Named Epic 3 source contract/worker/repository corpus              | `82/82` files; `1,127/1,127` tests passed                                                                                                   |
| Ordinary fresh migration plus Inbox V2 PostgreSQL corpus           | `49/49` migrations; `30/30` files; `294` tests passed and `6` explicitly opt-in scenarios skipped                                           |
| Populated preserve, pinned N-1 compatibility and RBAC dry run      | `3/3` files; `17/17` tests passed                                                                                                           |
| Pinned N-1 source bundle reproducibility                           | rebuilt without diff; target `49` migrations and contract `sha256:f1eb6d3b49875524c7467ea8c6ba01bed70dfc9138bc7ccf6ff198ba2d22b69a`         |
| Clean formatting, lint, TypeScript, tests and repository guards    | `pnpm check` passed; `352/352` default files and `3,679/3,679` tests passed; `40` opt-in files / `348` tests skipped and covered separately |
| Independent latest-tree acceptance and composition-boundary review | `READY`; traversal P1 closed; no remaining P0/P1/P2 findings                                                                                |

## Exit

`INB2-EPIC-3-GATE` is complete. The next critical-path task is
`INB2-MSG-001`.
