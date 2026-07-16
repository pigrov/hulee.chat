# Inbox V2 Source Event Normalization and Completion

Status: implementation evidence for `INB2-SRC-003`.

## Boundary

`INB2-SRC-003` turns one already accepted and leased `SRC-002` raw event into
either:

- one ordered batch of typed, provider-neutral normalized events;
- one explicit ignored result with no normalized events; or
- one stable `source.idempotency_collision` quarantine result.

The task ends at the durable normalized-event and raw-work completion boundary.
It does not resolve a `SourceExternalIdentity`, create a
`ConversationParticipant`, select/create an `ExternalThread` or Conversation,
deduplicate a canonical Message, allocate a timeline sequence, emit a tenant
stream commit, or notify an operator. Those effects remain owned by
`INB2-SRC-004` through `INB2-SRC-007` and later timeline/realtime tasks.

The implementation does not reuse the legacy arbitrary-JSON normalized-event
writer. That public repository method and its exported input/result types were
removed. `normalized_inbound_events` remains only as an empty compatibility/FK
anchor during the preserve and N-1 expand window.

## Adapter authority chain

Normalization is an adapter-declared process capability, not a generic callback
accepted from a repository caller:

```text
authentic SourceAdapterDeclaration
  -> exact adapter contract snapshot
  -> exact raw-ingress sanitizer profile + restricted-payload schema
  -> authentic SourceNormalizerProfile
       supported event kinds
       versioned thread/message/identity declarations
       classified evidence slots
       handler ID/version/declaration revision
  -> process-local normalizer handler + raw/evidence parsers
  -> fenced repository load of the persisted provider-payload evidence
  -> authentic frozen normalization candidate batch
  -> SQL source-normalization repository
```

Raw ingress and normalization support are coupled deliberately. An adapter with
`ingress.mode = not_supported` must declare normalization as unsupported and
cannot register a normalizer. A supported ingress must register exactly the
normalizer profile declared by the adapter. The module registry compares the
full profile, adapter contract and raw-sanitizer/restricted-schema pin before it
exposes the normalizer.

Schema-valid clones are not authority. Profiles, normalizers and candidate
batches are authenticated with process-local capabilities, frozen before
crossing the next boundary and rejected by persistence when forged or copied.

## Normalized contract

The v1 contract supports these source observations:

| Kind                      | Required exact target/evidence                                       |
| ------------------------- | -------------------------------------------------------------------- |
| `message_created`         | Thread, message and optional author observation                      |
| `message_edited`          | Thread, target message and optional action actor                     |
| `message_deleted`         | Thread, target message and optional action actor                     |
| `reaction_changed`        | Thread, target message, action actor and set/replace/clear operation |
| `delivery_status_changed` | Thread, target message and normalized delivery state                 |
| `read_receipt`            | Thread and exact target message                                      |
| `roster_observed`         | Thread plus explicit roster evidence                                 |
| `membership_changed`      | Thread, exact identity observation, state and normalized role        |

Every emitted event also carries direction, visibility, payload schema version,
provider occurrence time when available, a capability observation and zero to
many identity observations. Event ordinals are server-assigned from the
adapter's ordered decision and are part of the raw-event completion aggregate.

### Exact external descriptors

Thread, message and source-identity descriptors each pin a versioned adapter
identity declaration:

- realm ID and realm version;
- canonicalization version;
- object kind;
- scope kind and exact owner where the scope is connection/account-bound;
- observed opaque subject and canonical opaque subject.

For this contract version, the observed and canonical opaque subjects must be
byte-for-byte equal. Core does not trim, lowercase, case-fold or Unicode-
normalize them. A connection/account owner must match the exact tenant and raw
event scope. Provider-scoped descriptors remain explicit instead of being
silently rewritten to the current account.

An event that targets a message must carry one exact message descriptor.
Roster and membership observations intentionally carry no synthetic message.
The normalized thread destination is independent from the message sender, which
prevents a group reply from being routed to the sender's private dialog.

### Identity and roster observations

An event can contain zero to many source identity observations. No missing
sender is replaced with a Client, responsible Employee, SourceAccount or other
invented participant. Each observation has an event-local key, explicit
purpose, exact realm/object/scope descriptor, stability and observation time.

Semantic actor/author/membership references and roster-member references must
resolve to an observation inside the same event. Observation keys and roster
members are unique and canonically ordered.

Roster evidence records completeness, authority, omission policy, ordering,
member state and normalized role. `close_missing` is legal only for a complete,
authoritative snapshot; partial or advisory evidence can only retain omitted
members. SRC-003 preserves that evidence but does not mutate canonical
membership.

### Capabilities and provider time

Each event carries a versioned capability observation with unique canonical
capability IDs and `supported`, `unsupported` or `unknown` availability. It is
evidence for later binding-specific resolution and enforcement, not authority
to send by itself.

Provider time remains a source fact and never becomes a synchronization cursor.
When both raw metadata and the event declare a provider occurrence time, they
must agree exactly. Database time owns normalization and completion timestamps.

## Payload safety and evidence classification

The normalizer receives only the adapter parser's projection of the already
sanitized restricted raw payload. Its input contains exact tenant-owned source
references, transport and provider time; it does not receive credentials,
headers, cookies or arbitrary request containers.

Generic normalization output is a strict typed shape. Unknown provider fields,
credential-like keys, accessors, exotic prototypes, symbols, cycles,
non-finite numbers, malformed Unicode and bounded size/depth/node violations
are rejected before an authentic candidate exists. Handler exceptions become
the stable retryable `source.normalizer_failed` code; unsafe handler output is a
non-retryable `source.normalizer_output_invalid` or classified payload error.
The exception object and provider payload are not copied into diagnostics.
Own `__proto__` properties remain inert data on null-prototype clones; sparse or
custom arrays, accessors, symbols and JSONB-incompatible NUL keys/values fail
closed without invoking a getter. One raw event is bounded to `32` normalized
events, `8` classified evidence values per event and `64` evidence values in
total, preventing an adapter from expanding one occurrence into an unbounded
sequence of SQL writes.

Message/contact content and provider-specific fragments can leave the handler
only through a declared evidence slot. Every slot pins:

- slot ID and evidence schema ID/version;
- `core:normalized_event_payload` data class;
- one canonical purpose set from source replay/diagnostics, security/fraud or
  legal/regulatory duty;
- one process-local parser that projects the exact allowed evidence shape.

The normalizer must install exactly one parser per declared slot and no extra
parser. The parser result passes the same safe-JSON boundary before persistence.
The provider-neutral envelope stores only evidence descriptors; restricted
content is written to its separately purgeable payload relation.

Generic core event, audit, diagnostic and notification payloads are not created
by this task and receive no copy of normalized evidence. Later materializers
must reference the classified content rather than copy it.

## Persistence flow

```text
claimed SRC-002 raw event
  -> repository load under exact worker/token/revision/unexpired-lease fence
       exact tenant/raw/source/account/sanitizer metadata
       exact persisted provider_payload evidence + schema + canonical digest
  -> registry resolves the saved source declaration and normalizer
  -> execute authentic source normalizer exactly once over the loaded evidence
  -> authentic ignored/emitted candidate batch
       includes an ephemeral canonical raw-evidence digest binding
  -> derive tenant-keyed HMAC fingerprints and server-owned IDs
  -> READ COMMITTED transaction with bounded serialization/deadlock retry
       lock exact raw work + raw/source scope
       validate worker/token/revision/unexpired lease
       revalidate raw evidence schema and canonical digest binding
       advisory-lock every normalized idempotency key in byte order
       refresh database clock after all advisory waits
       lock conflicting key and raw-ordinal rows
       defensive exact-row comparison inside the open aggregate
       mismatch: write stable content-free collision quarantine
       new events:
         empty V1 compatibility anchor
         immutable provider-neutral envelope
         immutable classified evidence references
         independently purgeable restricted evidence payloads
       write one immutable normalization result with lease evidence
       delete the exact leased raw-work row
       force deferred aggregate constraints
  -> commit everything or nothing
```

`source_type` and `source_name` are loaded from the tenant-scoped
`source_connections` row inside the transaction. The repository performs the
reviewed compatibility mapping from the legacy `messenger` token to the adapter
catalog ID `core:messenger` before the worker compares its declaration. A
normalizer candidate cannot invent or overwrite either value.

The worker processor accepts only a validated SRC-002 claim. It never accepts
provider JSON from its caller: `claim -> loadClaimedInput -> registry
normalizer -> complete` carries one unchanged lease fence end to end. Missing or
purged evidence produces the stable `source.evidence_unavailable` load outcome,
while the database prevents evidence deletion for every still-pending or leased
normalization work item.

Provider-neutral envelopes, purpose arrays and restricted evidence are
explicitly JSON-serialized before their `jsonb` casts. HMAC input uses the
separate canonical JSON encoder. This keeps driver parameter coercion from
turning a validated object into an implementation-dependent string while
preserving one stable cryptographic representation.

## Durable model

Migration `0043_inbox_v2_source_normalization.sql` adds one enum and five
tenant-scoped relations around the existing raw and normalized anchors:

| Relation                                       | Role                                                        | Mutation rule                                     |
| ---------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------- |
| `inbox_v2_source_normalized_envelopes`         | Exact typed provider-neutral event and HMAC lineage         | Immutable                                         |
| `inbox_v2_source_normalized_evidence`          | Classified evidence reference and retained content HMAC     | Immutable                                         |
| `inbox_v2_source_normalized_evidence_payloads` | Restricted message/contact/provider evidence JSON           | Immutable; independently hard-deletable by policy |
| `inbox_v2_source_normalized_quarantines`       | Content-free stable collision evidence                      | Immutable                                         |
| `inbox_v2_source_normalization_results`        | One terminal raw-event outcome and completed-lease evidence | Immutable; replaces the leased raw-work head      |

The normalized compatibility anchor stores null external thread/message/user
columns, empty `normalized_payload` and `reply_capability` JSON, no canonical
Conversation/Message, and `processing_status = ignored`. Deferred constraints
require it to agree with the V2 envelope on tenant, raw/source scope, source
metadata, event type, direction, visibility, payload version, idempotency key
and timestamps.

Commit-time constraints also require:

- exact envelope/reference/payload evidence counts at initial commit;
- one coherent completion outcome, event count and quarantine reference;
- an exact composite quarantine relation including raw event, reason, key
  generation and candidate-completion HMAC;
- no committed normalized anchor/envelope without a terminal result and no
  envelope append after that immutable result;
- exactly one raw work or terminal completion head, never both or neither;
- an exact leased-worker/token/revision/clock fence before raw work deletion;
- no raw-evidence purge while the normalization work head still exists;
- no direct update/delete/truncate of immutable anchors, envelopes, evidence
  references, quarantine or result rows.

Deleting only a restricted evidence payload remains intentional. Its immutable
reference and tenant-keyed content fingerprint preserve finite replay/dedupe
evidence without keeping the provider content available.

## Server-owned idempotency and HMACs

All durable normalized idempotency material is derived inside the repository.
No adapter or API caller supplies a reusable normalized key.

The repository requests at least 256 bits of tenant-scoped key material for a
named key generation, copies it locally and zeroes that copy after preparation.
The key generation is persisted so an exact retry can request historical
verification material after rotation. Missing or mismatched key generations
fail closed.

Domain-separated HMACs protect distinct facts:

- normalized idempotency identity and the opaque
  `source:v2:normalized:<64 hex>` key;
- each deterministic evidence reference, derived from raw event, event ordinal
  and declared slot rather than a randomly allocated normalized-event ID;
- each classified evidence value, using the same stable raw/ordinal/slot
  identity;
- the complete provider-neutral safe envelope together with the canonical
  ordered evidence-content HMACs;
- the canonical ordered normalized-event set, including every evidence
  reference and content HMAC;
- candidate completion and terminal result;
- collision fingerprint and safe quarantine evidence.

The normalized-event ID is server-owned but intentionally not candidate
identity. Concurrent workers can prepare different random IDs before the raw
work lock; only the winner persists its ID, while an exact waiter compares the
same raw/ordinal/slot fingerprints. Conversely, changing classified evidence
changes the safe-envelope, ordered-event and candidate-completion HMACs, so it
cannot be accepted as an exact retry. After physical evidence-payload deletion,
the immutable evidence reference and terminal result still retain the HMACs
needed for that comparison without restoring or exposing content.

The public `structuralEnvelopeDigest` produced by the contract is a content-free
diagnostic only. It is not persistence authority and is never used as an
unkeyed oracle for provider/contact/message values.

An idempotency-key conflict with another raw aggregate is reusable only when raw
event, source connection, null-safe source-account scope, ordinal, event type,
digest key generation and safe-envelope HMAC match exactly. A mismatch writes a
stable `source.idempotency_collision` quarantine, completes the current raw item
as quarantined, and never returns or mutates the unrelated normalized row. A
coherent committed same-raw aggregate already has its immutable terminal result
and no work row: an exact candidate returns that result, while candidate drift
fails closed instead of rewriting the outcome. The raw-ordinal comparison inside
an open aggregate is therefore a defensive corruption/race check, not a second
normal completion path.

## Claim completion, concurrency and retry

Completion reuses the SRC-002 lease token hash and compares worker ID, token,
lease revision and work revision against the locked row. It samples
`clock_timestamp()` at the initial work lock, refreshes it after every advisory
lock wait and checks the current clock again in both the guarded delete and its
database trigger. Stable outcomes distinguish not found, not leased, stale
token, expired lease and lease-revision conflict before any normalized write.

The terminal result stores the exact completed attempt/reclaim counts, lease
token hash, lease revision, claim/expiry times and work revision. The guarded
raw-work delete is legal only after that result exists in the same transaction
and before the lease expires.

This immutable-result plus exact-delete model is intentionally safe for pinned
N-1 claim code: a completed item no longer has a pending/leased work row that an
older worker could reclaim. A retry after completion loads the original digest
generation, compares the candidate completion fingerprint and returns the
immutable event/quarantine outcome without recreating evidence.

Per-key advisory locks are acquired in canonical byte order, while raw work and
existing normalized rows are row-locked. SQLSTATE `40001` and `40P01` retry the
whole transaction a bounded number of times. A terminal failure rolls back the
anchor, envelope, evidence, result and work deletion together.

## Lifecycle and privacy

The envelope is classified as `core:normalized_event_envelope`,
`personal_operational`, with source replay/diagnostics purpose, a
materialization-or-final-failure anchor and `compact_to_safe_skeleton` expiry
action. It retains exact provider-neutral identity/thread descriptors needed by
later resolution and therefore remains governed personal data, not anonymous
telemetry.

Evidence references use `core:normalized_event_payload` and
`restricted_content`; the physical JSON payload is isolated so policy can make
it unavailable and hard-delete it independently. Generic event/audit/reporting
copies remain forbidden. HMACs are tenant/purpose/key-generation scoped and are
still finite governed technical evidence, not permission to retain them
forever.

This task installs storage boundaries and mutation guards. It does not install
the production retention/hold/privacy orchestration, key-generation retirement,
replay-expiry state machine or final safe-skeleton deletion. Those remain owned
by `INB2-SRC-008`, `INB2-OPS-009`, `INB2-OPS-010` and the ADR 0015 lifecycle
composition.

Consequently, production activation of a real normalization adapter remains
blocked on `INB2-SRC-008`: the retained tenant/purpose/key-generation HMAC
skeleton needs an executable finite expiry and key-retirement path before a
connector may advertise end-to-end production readiness.

## Migration and compatibility

Migration `0043` is additive. It preserves the V1 raw/normalized tables and
adds sidecars, constraints and triggers. The schema-owned invariant SQL is
appended by
`scripts/db/finalize-inbox-v2-source-normalization-migration.mjs` under marker
`INBOX_V2_SOURCE_NORMALIZATION_FINALIZED_V1`.

`db:check` verifies generated DDL/snapshot parity, exact invariant-tail parity,
required tables/enum/guards and historical `0042` raw-ingress parity after
stripping the additive SRC-003 delta. Preserve and pinned N-1 paths therefore
remain explicit gates rather than inferred compatibility.

## Production enablement gate

Enabling normalization for a real source requires all of the following:

1. an authentic adapter declaration and exact raw-ingress sanitizer;
2. a provider-specific restricted-payload parser and normalizer handler;
3. exact versioned thread/message/identity declarations for every emitted
   object kind and scope;
4. classified evidence slots with provider-specific sentinel tests;
5. tenant digest-key generation and historical verification-key availability
   for the promised idempotency window;
6. the SQL raw-ingress and source-normalization repositories in one data plane;
7. lifecycle composition for normalized envelope, evidence reference, payload,
   result and quarantine copies;
8. the later identity/thread/message materialization and replay/DLQ stages
   before advertising an end-to-end production connector.

The generic contract and repository alone do not make Telegram, WhatsApp, MAX
or any future source production-ready.

## Verification map

The SRC-003 completion gate is expected to cover:

- authentic profile/normalizer/batch enforcement and declaration/registry pin
  mismatch;
- every event kind, zero-to-many identity observations, exact event-local
  references and complete/partial/advisory roster rules;
- exact preservation of case, spaces and Unicode form for opaque IDs;
- rejection of missing tenant/source/account scope, unknown raw fragments,
  credential-like keys, unsafe JSON and unclassified evidence;
- deterministic adapter certification without evaluating a production event
  twice;
- empty legacy anchors and absence of the legacy arbitrary normalized writer;
- server-owned keys, exact retry, evidence-payload-purged retry and digest-key
  generation rotation;
- deterministic evidence references and rejection of evidence-content drift on
  a completed retry;
- same-key/raw-ordinal collisions across raw events, accounts, event types and
  envelope digests without returning an unrelated row;
- stale token, expired lease, revision conflict, concurrent completion,
  serialization/deadlock retry and full rollback;
- direct SQL rejection of incoherent anchors, evidence counts, result closure,
  mutation, truncate and unfenced work deletion;
- current install, populated preserve upgrade, pinned N-1 compatibility and the
  full repository quality gate.

## Verification

Completed on `2026-07-16`:

- focused contract/worker/repository/schema suites: `5/5` files, `66/66`
  tests; the repository/worker/schema subset after final edits: `3/3` files,
  `24/24` tests;
- `pnpm test:inbox-v2:postgres`: `26/26` files, `238/238` tests against a
  disposable PostgreSQL database after applying all `44` migrations;
- migration contract digest:
  `sha256:97e9204e2c12572f14bc23e91bde1bf03e4f701bed6d804f02a55c2f2be72d45`;
- DB-enabled `pnpm test:inbox-v2:preserve`: `3/3` files, `17/17` tests,
  including populated V1 preserve and pinned N-1 runtime compatibility;
- `pnpm db:inbox-v2:n1-bundle`, `pnpm db:check` and full `pnpm check` passed;
- full default suite: `320` passed files / `3281` passed tests; `35` opt-in
  files / `281` tests skipped by the default process and covered separately by
  the explicit PostgreSQL/preserve gates above.

Independent security and DB reviews are recorded in the task backlog. The
production-activation dependency on `INB2-SRC-008` remains explicit and is not
waived by this implementation gate.
