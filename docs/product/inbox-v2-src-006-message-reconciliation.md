# INB2-SRC-006: canonical source-message reconciliation

## Status

- Task: `INB2-SRC-006`
- State: `done`
- Owner: `Codex`
- Started: `2026-07-17`
- Finished: `2026-07-17`
- Depends on: `INB2-SRC-005`

## Boundary

This slice turns one persisted, account-scoped source observation into an exact
canonical-message decision. It owns exact external-message-key locking,
immutable-reference reuse, occurrence reconciliation and durable deferral of
source actions that arrive before their target Message.

It deliberately does not own:

- tenant stream, domain event, change set, outbox or notification atomicity
  (`INB2-SRC-007`);
- Message edit/delete, reaction or receipt domain effects (`INB2-MSG-005` and
  `INB2-MSG-006`);
- provider-response occurrence materialization, pending outbound dispatch
  correlation, native-app outbound import or uncertain provider-attempt recovery
  (`INB2-MSG-007`);
- operational replay, DLQ, backpressure or finite post-purge dedupe skeletons
  (`INB2-SRC-008`).

## Canonical decision

Raw and normalized events remain scoped to their SourceAccount. Every webhook,
stream, poll, history import or provider echo has its own `SourceOccurrence`.
SRC-006 rejects `provider_response`: that origin needs the exact attempt,
dispatch and immutable-route proof owned by `INB2-MSG-007`. Canonical reuse is
allowed only after comparing the complete external-message identity:

1. tenant;
2. adapter message realm ID, realm version and canonicalization version;
3. message object kind;
4. canonical `ExternalThread`;
5. scope kind and, for account/binding scopes, its exact owner;
6. case-preserving opaque external subject;
7. stable adapter contract ID, version and surface.

The SHA-256 key digest is only a bounded lookup and lock index. A digest match
never proves equality. One immutable tenant-scoped message-key registry row
stores and validates the complete key under that digest. Deferred actions and
ordering heads reference the registry and use exact-key guards, so a hot pending
drain does not scan the conversation's lifetime action history. Content, display
sender, Client, title, provider time and received time never participate in
reuse.

For authoritative `provider_thread` identity, distinct account observations may
resolve to one immutable `ExternalMessageReference`. Safe-default
`source_account` and `source_thread_binding` keys remain separate. Adapter load
metadata stays on each occurrence and may differ while the stable adapter
surface remains the same.

## Reconciliation outcomes

- `message_create`: no exact reference exists; a DB-only callback may create the
  first Message/TimelineItem/reference, resolve the origin occurrence and store
  its exact `origin`/`native_outbound` transport link.
- `occurrence_attach`: an exact immutable reference exists; a DB-only callback
  resolves and links the distinct occurrence to that target with an exact
  `additional_artifact` transport link.
- `source_action_defer`: edit/delete/reaction/delivery/read arrived before its
  exact target and is stored durably without creating a placeholder Message.
- `source_action_process`: an exact target exists; ordering is classified and a
  DB-only callback may apply or terminally classify the action. Durable action
  induction precedes terminal occurrence replay, so a changed action tuple or
  payload cannot be acknowledged as the old replay.
- `echo_handoff`: an exact provider echo is passed to the MSG-007 boundary and
  must persist its `provider_echo` transport link; weak correlation never
  selects an outbound dispatch or Message.
- `conflict`: full-key/digest, candidate ID, immutable target, occurrence or
  ordering evidence disagrees; provenance is retained and no target is remapped.

All DB-only callbacks run inside the reconciliation transaction. A callback
conflict must be write-free; any failed post-write validation rolls the whole
transaction back. Provider/network I/O is forbidden in this boundary.

## Deferred action ordering

The existing `DeferredMessageSourceAction` contract is authoritative. The exact
replay tuple is normalized event, SourceOccurrence, semantic ID and event
fingerprint. Its action ID is a deterministic HMAC-derived plan candidate: the
same tuple, expected ID and stable facts return `already_exists`; the same tuple
with another candidate ID or payload fails closed as an idempotency conflict and
is never classified as a terminal duplicate. Monotonic ordering is partitioned
by exact message key, action lane, provider scope token, comparator ID and
comparator revision. Canonical decimal provider positions are limited to 128
digits before comparison.

- higher exact position: eligible to advance;
- lower position: stale;
- equal position, equal semantic duplicate identity (`semanticId` and event
  fingerprint) and a distinct exact replay tuple: duplicate;
- equal position with another semantic duplicate identity: ordering conflict;
- incomparable or unavailable ordering: explicit conflict, never timestamp
  fallback.

Stale and duplicate actions may resolve their occurrence provenance to the exact
canonical reference but cannot claim a Message mutation. Their immutable
comparison anchor is the historical head action and its `advance` transition;
the mutable current head may advance further without invalidating the recorded
classification. Likewise, an `advance` transition remains valid when the exact
current head is already at a greater revision and strictly greater provider
position, which permits multiple same-lane advances in one transaction and
later replay of an earlier action.

## Required acceptance fixtures

1. concurrent cross-account duplicate create for authoritative provider-thread
   identity;
2. account/binding scoped observations remain separate;
3. equal-content genuine messages and case-distinct opaque subjects remain
   separate;
4. forced digest/full-key, candidate-ID and immutable-target collisions fail
   closed;
5. edit/delete before create are deferred and later converge by exact provider
   ordering;
6. stale/duplicate/conflicting/advancing reaction and provider-read facts are
   classified without claiming MSG-005/006 domain effects;
7. exact canonical and source-action replay is idempotent, changed signed action
   payloads fail closed and distinct occurrences attach once;
8. weak/ambiguous echo evidence remains target-free for MSG-007;
9. hot exact-key contenders serialize while distinct keys remain independent;
10. 5,000 terminal actions do not enter the pending-drain query plan.

## Implementation map

- Contracts and exact replay/ordering invariants:
  `packages/contracts/src/inbox-v2/source-message-reconciliation.ts`,
  `message-source-action.ts`, `message-transport.ts` and their tests.
- Trusted plan construction and authorization verification:
  `apps/worker/src/source-message-reconciliation-materializer.ts` and
  `source-message-reconciliation-plan-verifier.ts`.
- Durable schema and additive migration:
  `packages/db/src/schema/inbox-v2/source-message-reconciliation.ts` and
  `packages/db/drizzle/0045_inbox_v2_source_message_reconciliation.sql`.
- Transactional reconciliation, exact-key locking/registry, callback
  postconditions and bounded drain:
  `packages/db/src/repositories/sql-inbox-v2-source-message-reconciliation-repository.ts`.
- Real PostgreSQL behavior and scaling fixtures:
  `sql-inbox-v2-source-message-reconciliation-repository.integration.test.ts`
  and `scripts/db/inbox-v2-source-message-reconciliation-migration.integration.test.mjs`.

## Verification evidence

- Focused contract/worker/repository/schema suite: `8/8` files and `70/70`
  tests passed.
- Disposable PostgreSQL gate: `46` migrations verified with contract digest
  `sha256:335224e8d7125ab5800e0937b263948c4e8f7309a0b363ecf891cce43b0003a2`;
  `29/29` files and `257/257` tests passed, including `12/12` SRC-006
  reconciliation scenarios and the 5,000-row terminal-history plan fixture.
- Preserve/N-1 gate: pinned bundle regeneration passed; `3/3` files and `17/17`
  tests passed against the final migration boundary.
- Full `pnpm check`: formatting, lint, TypeScript, unit/integration tests,
  database inventory, i18n, encoding, branding and native checks passed;
  Vitest reported `338` passed files / `3,424` passed tests (`39` files / `305`
  tests intentionally skipped).
- Independent architecture/atomicity review found no P0 issue. Its P1 findings
  were closed with a provider-echo-only SRC-006 boundary, mandatory persisted
  transport links, action-before-terminal replay induction and the bounded
  message-key registry.

This evidence does not claim tenant commit/domain-event/outbox atomicity
(`INB2-SRC-007`), Message lifecycle/reaction/receipt effects
(`INB2-MSG-005`/`006`), provider response/dispatch recovery (`INB2-MSG-007`) or
operational replay/DLQ/backpressure (`INB2-SRC-008`).
