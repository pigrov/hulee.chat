# Inbox V2 Source Identity and Participant Resolution

Status: implementation evidence for `INB2-SRC-004`.

## Boundary

`INB2-SRC-004` consumes one authenticated, durable `SRC-003` normalized
event and produces three deliberately separate results:

1. one stable `SourceExternalIdentity` for every exact provider identity key;
2. one append-only resolver assessment per distinct identity in the event;
3. one deferred participant intent per exact external-thread/identity pair.

The task does not select or create an `ExternalThread`, Conversation or
`SourceThreadBinding`. That remains the boundary of `INB2-SRC-005`. It also
does not create provider membership, canonical Messages, timeline sequence,
WorkItems, CRM links, RBAC relations, read state, watchers or notifications.
Those effects require their own later materializers and authority.

A source identity claim is a fourth, independent boundary. A claim can relate
the provider identity to one Employee or ClientContact for display, reporting
and later event-time attribution, but never changes the participant subject and
never grants Hulee access.

## Resolution flow

```text
authenticated SRC-003 normalized envelope
  -> explicit typed DB projection and contract parse
  -> for every exact identity observation
       tenant-keyed, domain-separated identity derivation
       trusted materialization authority bound to adapter service
       find/create immutable SourceExternalIdentity
       build immutable observation record
  -> group only equal SourceExternalIdentity IDs inside this event
  -> deterministic assessment planner
       ordered evidence with provenance
       ordered Employee/ClientContact candidates
       unresolved | conflicted | resolved Employee | resolved ClientContact
  -> append-only assessment + optimistic current-head CAS
  -> deferred participant intent keyed by
       ExternalThreadKey + SourceExternalIdentity
  -> SRC-005 resolves exact thread/conversation/binding
  -> context-bound participant materializer revalidates binding and thread key
  -> create conversation-local source-identity participant
```

An interrupted multi-identity event can leave an already committed identity or
assessment before a later observation fails. This is intentional retry-safe
progress, not a partially emitted canonical inbox event: all keys are stable,
observations and assessments are idempotent, the processor returns no completed
batch on failure, and canonical source materialization remains owned by the
later atomic intake stage.

## Identity key and materialization authority

Core never trims, case-folds, Unicode-normalizes or otherwise interprets an
opaque provider subject. The adapter declaration fixes the realm, realm
version, canonicalization version, object kind and scope. The resulting
identity key additionally retains stable versus observation-ephemeral
semantics.

The durable ID and materialization authorization token are derived through an
injected server-owned tenant key service using separate HMAC domains. Raw or
canonical provider subjects do not appear in either value. The long-lived
identity namespace generation, tenant, trusted service and exact
materialization input are bound to the derivation. A structurally similar
callback is not materialization authority.

Stable observations with the same tenant/realm/object/scope/opaque subject map
to one identity. Provider-, connection- and account-scoped identities remain
different when the adapter declared them different. Ephemeral identities also
include the exact normalized observation, preventing unsupported provider
actors from acquiring a false durable identity.

## Assessment ledger

The in-memory observation contract is immutable and validates the exact
normalized event, provider observation and identity materialization snapshot.
The SQL observation root deliberately persists only the tenant/event/identity
binding, observation key and purpose, safe-envelope HMAC, a subjectless digest
and timestamps. It does not duplicate the clear provider subject or the
materialization authorization token from their classified authentic roots.

Every assessment revision retains:

- the exact observation and current identity snapshot evaluated in memory;
- ordered evidence references, confidence and provenance;
- ordered, de-duplicated Employee/ClientContact candidates;
- an explicit `unresolved`, `conflicted`, `resolved_employee` or
  `resolved_client_contact` outcome;
- the previous/current assessment revision, idempotency key and canonical
  assessment digest;
- for a resolved outcome, the exact active claim ID, version and typed target.

Durable assessment provenance uses the strict
`core:inbox-v2.source-identity-assessment-provenance@v2` envelope. Instead of
serializing the full identity snapshot, it stores a minimized subjectless fact:
the identity revision/resolution state and timestamps plus a canonical digest
of immutable materialization fields. The digest input excludes
`canonicalExternalSubject` and
`materializationAuthority.authorizationToken`; the safe-envelope HMAC binds
the authentic observation without copying either clear value into provenance.

`unresolved` and `conflicted` are resolver facts and do not mutate the claim
head. A resolved assessment is accepted only while the exact active claim still
matches its identity, target and version. Candidate order never means
first-match authority: duplicate targets are aggregated, confidence is derived
from referenced evidence, and competing candidates remain conflicted.

## Durable model

Migration `0044_inbox_v2_source_identity_resolution.sql` adds three
tenant-scoped relations:

| Relation                                    | Role                                             | Mutation rule                     |
| ------------------------------------------- | ------------------------------------------------ | --------------------------------- |
| `inbox_v2_source_identity_observations`     | Exact normalized observation-to-identity binding | Immutable                         |
| `inbox_v2_source_identity_assessments`      | Evidence, candidates and decision history        | Immutable, contiguous revisions   |
| `inbox_v2_source_identity_assessment_heads` | Current assessment per source identity           | CAS-only, gap-free forward update |

Composite foreign keys bind observations to the exact normalized envelope and
identity, assessments to the exact observation, and resolved assessments to the
exact historical claim/target/version. Deferred triggers reject missing heads,
gapped histories, direct history mutation and incoherent current pointers. The
deferred append checks are bounded indexed lookups of only the immediate
predecessor, immediate successor and current head; they never scan or aggregate
the identity's full assessment history.

The repository acquires ordered advisory locks, row-locks the identity and
current head, compares an exact existing assessment before accepting a replay,
and retries serialization/deadlock failures within a bounded policy.

Only an exact assessment-ID/idempotency-key replay is coalesced. Semantically
equal assessments from distinct authenticated observations are retained:
observation and resolver-decision occurrence is audit evidence, so suppressing
an unchanged outcome would discard provenance rather than reduce harmless
state churn.

## Data lifecycle registration

SRC-004 publishes versioned core storage-root/data-use declarations for the
observation, assessment and assessment-head SQL relations. All three use the
existing `core:source_external_identity` data class, its
`core:unlink_or_relationship_end` anchor and its expiry action
`remove_identity_resolution_keep_subjectless_fact`. Each root declares bounded,
idempotent, tenant/revision/hold-fenced discovery, export projection/execution,
delete and absence-verification handlers. Registry composition fails closed if
any root or handler coverage is absent or incompatible.

Before removing subject-linked rows, the lifecycle projection retains only
materialization/assessment digests and non-identifying decision facts; tenant,
identity, event, claim and candidate-target references are redacted. The
post-delete verifier performs three bounded tenant-and-identity `not exists`
lookups. The declarations compose with the `INB2-DB-009` ledgers and guards.
Policy, dispatch, checkpoints, legal-hold/revision fencing and durable
compaction execution remain owned by `INB2-OPS-006`, `INB2-OPS-010` and
`INB2-OPS-012`; this task does not claim a parallel destructive executor.
Source production activation is still blocked by `INB2-SRC-008`.

## Participant locality and group chats

The deferred intent contains no Conversation or binding ID. It preserves the
exact external thread key and source scope until `SRC-005` has resolved the
canonical thread, Conversation and current binding.

The participant materializer then reloads both the binding and immutable
external-thread mapping, checks the expected binding revision, source
connection/account and canonical thread-key digest, and derives the participant
ID from tenant + Conversation + SourceExternalIdentity. Therefore one sender in
several Telegram, WhatsApp, MAX or future provider groups remains one source
identity but becomes a different participant in every Conversation.

Author observations create no membership. Membership/roster observations set
only `provider_evidence_required`; a separate binding-specific materializer must
validate the exact roster episode before changing provider membership. A claim
to an Employee does not turn provider membership into internal membership.

## Claim command security

Employee and ClientContact claim commands are separate public operations and
permissions. Public callers provide only the intended tenant, source identity,
typed target, expected claim version, exact evidence references and client
mutation ID. Actor, policy authority, transition/claim IDs, authorization plan
and timestamps are loaded and stamped by trusted server code.

Before persistence, the application boundary verifies the complete closure:

- command, transition, authenticated actor, tenant and occurrence time agree;
- Employee and ClientContact targets use their distinct permission families;
- the exact source identity and evidence resource are conjunctively authorized;
- reassignment additionally authorizes revoke of the exact old typed target;
- revoke binds the exact source identity, active claim/old target and current
  claim version;
- automatic resolution uses only the trusted-service `identity.auto_resolve`
  guard, exact assessment/evidence/source/target/policy and verified confidence;
- the domain-separated command-intent hash binds the public command,
  transition, state fence, evidence manifest and authorization plan; command
  type, epoch, dependency vector, decision references, revision plan and
  semantic audit must close that same intent;
- runtime `migration` decisions are rejected by this API.

The repository accepts runtime transitions only inside the live, non-forgeable
authorized-command transaction context. The authorization coordinator is the
only retry owner: a claim repository never retries `40001`/`40P01` on an
already-aborted executor. Under the same DB locks, the repository compares the
exact active claim ID and typed old target, while exact absence supports a new
claim after revoke at a nonzero head version. Manual Employee self-claim is
denied as `identity.claim_self_forbidden`, recorded as a review candidate and
performs no domain mutation. Single-admin/bootstrap tenants use the same
trusted automatic resolver; there is no self-claim exception. A future signed
versioned import is a separate verifier-owned migration boundary and cannot
enter through the runtime command.

The claim transaction may update only claim history/current identity resolution
plus the coordinator's explicit audit/stream records. It has no Account,
external-login link, RBAC grant/binding, participant/membership, personal
watch/read state, WorkItem, CRM-link or notification mutation port.

## Compatibility and ownership

Migration `0044` is additive. It preserves the existing identity/claim tables
and the populated V1/pinned N-1 path. `db:check` owns the generated schema,
snapshot, journal and invariant-tail parity for the new relations. The runtime
normalized-event reader projects only explicitly allowed fields from the
`SRC-003` safe envelope and parses them through the closed contract; arbitrary
JSONB casts are rejected.

## Production enablement gate

The generic resolver does not make a provider production-ready. A connector
must still provide a certified adapter identity declaration, normalization
profile, long-lived identity namespace configuration, evidence/assessment
policy and the later thread/message/replay lifecycle. In particular,
`INB2-SRC-005` through `INB2-SRC-008` remain required before an end-to-end
source can advertise production readiness.

## Verification map

The task gate covers:

- all four assessment outcomes with exact evidence, candidates, confidence and
  active-claim validation;
- stable/ephemeral identity derivation, tenant-key separation, adapter-service
  mismatch and forged materializer rejection;
- replay, assessment CAS, idempotency/ID conflicts and direct SQL invariants;
- bounded predecessor/successor/head append checks with no full-history scan;
- subjectless/tokenless durable provenance plus fail-closed lifecycle,
  redaction and absence-verification declarations for all three SQL roots;
- the same source identity in several groups producing distinct
  conversation-local participants;
- binding/thread/account substitution and participant-ID conflict rejection;
- separate Employee/ClientContact permissions, exact source/evidence,
  old/new-target reassignment, exact revoke and trusted auto-resolve closure;
- manual self-claim review, runtime migration rejection and concurrent
  one-winner claim behavior;
- absence of implicit Account, RBAC, membership, watcher/read and WorkItem
  state;
- current install, populated preserve upgrade, pinned N-1 compatibility and
  the full repository quality gate.

## Verification

Completed on `2026-07-17`:

- focused contract, worker, API, core-policy and DB suites passed `11/11` files
  and `537/537` tests;
- the clean PostgreSQL gate applied all `45` migrations with contract
  `sha256:686be094f65af826d67157ef67bf7fb57b6aeae774e1f15c62e2d13c56200f73`
  and passed `27/27` files / `239/239` tests;
- populated preserve, pinned N-1 compatibility and RBAC dry-run passed `3/3`
  files / `17/17` tests, and all disposable databases were removed;
- full `pnpm check` passed `328` test files / `3334` executed tests plus
  formatting, ESLint, TypeScript, DB, i18n, encoding, branding and native
  gates; its `36` opt-in files / `282` tests were covered by the explicit DB
  gates;
- independent replay/privacy/DB and claim/security reviews found no remaining
  P0/P1 issue.
