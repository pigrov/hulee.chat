# ADR 0015: Inbox V2 Data Lifecycle, Privacy And Audit

- Status: Accepted
- Date: 2026-07-10
- Owners: Product, platform architecture and security
- Decision task: `INB2-ARCH-007`
- Detailed policy contract:
  `docs/product/inbox-v2-data-lifecycle-and-privacy.md`

## Context

Inbox V2 stores communication and work data across several independent
surfaces:

- raw and normalized provider events;
- external/internal Messages, typed timeline items and lifecycle history;
- files, attachments and derived media;
- provider occurrences, routes, attempts and diagnostics;
- calls, recordings and transcripts;
- Client/contact identities, CRM history and custom fields;
- notifications, analytics facts, exports and AI artifacts;
- events, outbox, realtime replay, audit, logs and backups.

These surfaces have different purposes, risks and lawful retention periods. One
tenant-level `retentionDays`, one `deletedAt`, a Message tombstone or an object
storage lifecycle rule cannot represent them safely.

Prior Inbox V2 decisions require immutable authorship, sequence, revisions,
route facts, event-time reporting and privileged audit. Privacy/retention can
also require content removal, subject restriction, export, anonymization and
proof of destruction. Embedding raw PII in every immutable event/audit row would
make those requirements contradictory.

Group conversations may contain several Clients, Employees, unresolved source
identities and incidental third-party PII. A request by one subject cannot be
treated as authority to export or delete the entire Conversation.

Hulee ships one core for shared SaaS, isolated SaaS and on-prem. Applicable
regime-specific roles, jurisdictions, residency, contractual duties and special
communication/industry rules vary by deployment and cannot be inferred from a
plan or provider payload. EU controller/joint-controller/processor roles and
Russian operator/person-processing-on-instruction roles are recorded explicitly,
not treated as legally identical labels.

The current V1 schema has raw/provider/audit/notification JSON payloads without
classification or expiry, Message text in canonical rows and object storage with
put/get but no delete/version contract. It is historical deletion-scope
evidence, not the V2 policy model. ADR 0016 classifies all current contents as
disposable test state and imports none of it into the clean baseline.

## Decision

Inbox V2 adopts a versioned, tenant-scoped data-governance and lifecycle model.
The policy key is at least:

```text
deployment/jurisdiction profile
  + data class and sensitivity
  + processing purpose and role
  + canonical retention anchor
  + tenant choice inside the approved envelope
  + active hold/restriction
= lifecycle decision and evidence
```

Every production data class has a finite or reviewed condition-based rule and an
action at expiry. “Forever” is invalid. A legal hold or another unresolved
preservation condition requires an approved basis, owner, exact scope, end
condition and review date. Hold is a separate evaluator outcome carrying its case
and revision; it is forbidden as a configurable expiry action.

Exact production periods are policy-profile values, not universal legal facts.
The detailed policy defines an illustrative development profile while legal/
product owners approve launch jurisdictions, roles and contractual/industry
overrides. Calendar, elapsed, business-day and event-condition periods remain
distinct typed rules.

### Separate classification axes

Sensitivity, processing purpose, retention class, residency and authorization
are independent. A field marked PII does not automatically have one duration,
and a long-lived business fact does not automatically authorize its content to
remain readable.

Module/provider contracts declare the classes and purposes they introduce.
Unknown normalized fields cannot become unbounded generic JSON in core,
notifications, analytics or audit.

The detailed policy owns a versioned provider-neutral `core:*` `DataClass`
catalog. Module extensions use namespaced IDs and declare parent, purpose,
subject/export behavior and delete/verification handlers. Production build and
module activation fail when any SQL/JSON/blob/object/index/cache/log/backup or
external-route root lacks a complete lifecycle declaration.

Every module purpose maps to a core-purpose safety ceiling and cannot weaken its
responsibility-role or subject-discovery requirements. Every module class pins
exactly one finite or parent-inherited rule revision per allowed purpose, with
compatible action/hold semantics and lifecycle/delete/absence handlers; orphan
purposes, stale rule references and read-only local persistence are rejected.
For S3-compatible storage, a live version-enumerable `object` root and its
finite `backup`/version tail are separate registered surfaces. Only the backup
surface uses `core:backup_copy_or_object_version`; relabeling live data as backup
or attaching a backup class to a live root is invalid.

### Immutable envelope, purgeable payload

Inbox V2 preserves immutable technical facts without making raw content
immortal:

- Timeline sequence, original participant-author anchor, occurrence/route and
  revision identity remain stable while their technical purpose applies;
- Message/staff-note text, provider payload, contact values, attachment bytes,
  recording/transcript and sensitive evidence live in classified purgeable
  content records/blobs;
- generic event, outbox, audit, diagnostic, notification and analytics envelopes
  reference content instead of copying it;
- content expiry produces a revisioned tombstone/invalidation and removes every
  required physical/derived copy;
- subject resolution/display mappings may be removed without inventing a new
  Message author;
- the minimized technical skeleton also has a finite retention rule.

Pseudonymized data remains governed as personal data while re-identification is
possible. Only tested irreversible anonymization produces a non-personal
aggregate.

### Typed subject links and discovery

Structured data roots may link to Employee, ClientContact,
SourceExternalIdentity, Account or unresolved provider-scoped subject references
with role/provenance. A subject link is evidence for discovery only. It creates
no principal, Client, membership, WorkItem, authorship rewrite or permission.

Free text, files and recordings can contain incidental PII. Privacy request
results therefore record deterministic structured coverage, search-assisted
candidates, manual-review surfaces and external/unsupported residuals. Search
matches are never automatic identity claims or delete authority.

Executable discovery comes only from a registered server-owned complete-state
source. Its immutable proof binds the registry composition, source version,
exact scanned discovery-handler set, stream epoch, sync generation, complete-
through position and canonical root/subject/link/coverage hashes. Every root has
registered discovery lineage. A complete empty result additionally requires
canonical zero evidence over those same fences; raw subsets, clones and
caller-recomputed manifests remain non-authoritative wire data.

### Privacy request is a case workflow

Access, portability, correction, erasure, restriction, objection, tenant
offboarding and administrative retention purge are distinct intents. A request
records jurisdiction/profile, regime-specific responsibility role, identity
verification, due/extension timestamps, subject aliases, discovered scope,
decision per data root, exceptions/hold, execution and evidence.

Mixed/group data is decided per element and purpose. The requester receives only
their authorized data and context that does not violate the rights/confidential
content of other participants. One phone number is insufficient identity proof
or complete discovery because numbers and provider identities can change or be
shared.

A decided request is executable only with the authentic current governance
context, the policy still current in its activation ledger, the exact discovery
proof/registry and a registered current identity/RBAC authority source. It pins
the exact policy rule ID/revision for every root-purpose. Claimed aliases equal
the verified-subject set and each is discovered; discovered third parties do not
become requester aliases. Mixed roots require the exact discovered redaction or
omission, while third-party-only, unresolved and review-required roots fail
closed with the matching exception.

Tenant offboarding completes only after an authentic ready and unexpired tenant
export bundle binds the exact job, manifest, artifact checksum, governance,
current policy and exported root set. Export precedes erase for each approved
internal root. Synthetic handler success, a schema-valid reference, clone or
artifact from another revision is not terminal authority.

Tenant offboarding scope is a separate complete tenant-wide manifest, not a
subject-discovery result. It pins the registry composition, all scanned data
uses, one stream/generation high-water and every observed root/entity/lineage
revision. Exportable roots are exported then erased; secrets, registry-omitted
classes and backups are erased without export; external roots are deleted and
tracked through their exact routes. Destructive execution compare-and-sets the
same scope and seals new customer-data writes before adapter I/O. Any drift
forces re-enumeration and a new export.

### Legal hold and processing restriction are independent

- for hold-eligible content/evidence, legal hold blocks purge, object-version
  expiry and content-key destruction;
- processing restriction limits permitted use, often to storage/claim handling;
- RBAC decides who may read, search or export;
- retention decides normal eligibility.

None grants another. Holds have versioned exact/prospective scope, a frozen
manifest, future-match behavior, owner/approver/reason/review date and audited
release. Release schedules reevaluation; it does not delete synchronously.
Passwords, access tokens, live session material and auth challenges are never
hold-eligible; a minimized revoked/expired security outcome may remain instead.

Restriction limits use but does not itself extend retention or bypass a legal
maximum. When a regime requires storage-only preservation during correction,
objection or dispute, it is an explicit versioned storage-only purpose/condition
with owner, end condition and review schedule; otherwise ordinary expiry
continues.

Executable holds/restrictions require an authentic frozen scope manifest and
the authentic registry owning every class, root/data use and resolver. Exact
matching includes tenant, root, internal entity, entity revision and lineage
revision. Prospective matching uses a registered non-JSON capability pinned to
the registry hash, `scope_matcher` handler ID/version and predicate hash;
missing, cloned, stale or throwing matchers yield ambiguous/fail-closed, never a
false negative that permits deletion. Classified privacy evidence likewise
requires exact registered class/purpose/operated-root/lifecycle-handler lineage.

### Three export products

Tenant business export, ADR 0013 manager/report export and verified data-subject
access/portability export use different permissions, schemas and redaction.
An internal label or raw storage format is not a blanket subject-access
exception: in-scope personal data is normalized into the response unless a
specific legal/security/third-party rule applies. Access and narrower portability
decisions remain separate; secrets and usable auth material are never exported.

Every export is a bounded, revocation-aware job with a consistent high-water,
manifest, omission reasons, encrypted short-lived artifact and current
authorization check per chunk and download. Failure/revoke quarantines and
deletes partial artifacts. Artifact expiry deletes all object versions; only a
minimized audit/evidence skeleton remains.

Current governance, activated policy, exact job approval/RBAC, per-chunk/root
and lineage decisions, and terminal bundle state are reloaded at their actual
materialization/download/destructive boundaries. Tenant deletion requires the
terminal artifact before execution exists and rejects ready-state revocation,
payload deletion and expiry equality before any destructive resolver I/O.
Manager aggregate exports are anonymous-only; aggregate/drilldown authority
cannot be exchanged for PII authority. Manager report authority is one exact
principal chain across the source query, scope/root/lineage proof, job, chunks
and download issue/consume decisions; a fresh proof owned by another principal
is not transferable.

One-use download issuance/consumption requires a bootstrap-registered durable
claim-repository capability. Its unique artifact claim is keyed by tenant,
artifact ID and artifact revision; issuance binds principal/receipt and exact
job/manifest/packaging lineage, and consumption compare-and-swaps the issued
receipt revision plus the canonical immutable issued-receipt hash. A forged
`before` state therefore conflicts even when its receipt ID and revision match.
Process-local memory is not a production implementation.

### Privacy permissions have legal resource scope

Policy management, request decision/execution, subject-evidence access, hold
issue/release, tenant export, deletion preview/approval/execution and privacy-audit export
are separate permission families. Every check binds tenant plus the exact case,
subject/evidence roots, hold revision, export high-water or deletion-plan roots
described by the detailed policy matrix. Requester identity is not resource
authority; hold grants no read/export; preview cannot execute; issue/release and
request/approve/destructive execution use separation of duties by default.
Cross-tenant or stale-revision input fails before count, pagination or mutation.

### Durable deletion orchestration

Provider message delete, local UI moderation, retention expiry and privacy
erasure are separate commands/outcomes.

Local deletion is two-stage:

1. transactionally make approved content unavailable, advance revisions and
   persist tombstone/invalidation plus a deletion plan;
2. bounded idempotent handlers purge SQL content, objects/versions, derivatives,
   search/vectors/caches, notifications, analytics/subject bridges, exports and
   eligible identity mappings, then verify absence.

A handler checks tenant, policy/hold and expected entity revision immediately
before destructive I/O. Stale lease/revision cannot delete newer data. Failure
is retryable/terminal evidence, never false completion.

Raw-event payload expiry may retain a tenant-keyed HMAC dedupe skeleton with its
own finite purpose/key lifecycle. Raw values and reversible low-entropy hashes
are forbidden.

Recipient projection state uses the same privacy boundary: active upsert
fingerprints are tenant- and purpose-keyed HMACs with an explicit finite key
generation, not content-derived public SHA values. Keys and verification
contexts are server-only. A fingerprint is immutable for its entity revision;
historical generations remain verifiable while that revision can be replayed.
Key retirement/rekey therefore follows retention and either advances the
entity revision or atomically rotates `syncGeneration` and forces an
authoritative reset. Tombstone/invalidation/page-chain SHA digests may cover
only minimized technical metadata and opaque fingerprints.

That reset is executable only with an authentic current key ring and a proof
resolved through a registered reset-ledger capability. It binds exact before/
after entity bindings, old/new sync and key generations, the complete authority
high-water manifest, key-ring hash and atomic previous-generation invalidation.
Raw, cloned or recomputed proof objects cannot authorize a generation reset.

External/provider deletion uses surface-specific capability and records
`requested`, `confirmed`, `unsupported`, `unknown` or retryable failure. Hulee
does not promise erasure from provider history, recipient devices or disclosed
exports when it cannot verify it.

### Audit is minimized, typed and finite

Domain history, successful privileged/security audit, bounded denial signals,
privacy evidence and platform audit are separate contracts/stores.

The audit envelope contains stable tenant/effective/delegating actor/action/
target references, authorization facets, revisions, reason code, correlation/
mutation/request IDs, outcome, policy version and time. It never copies Message/
contact/provider/file/recording/secret payload or arbitrary client/provider JSON.

Required sensitive evidence is a separately authorized, classified and
purgeable object referenced from the audit skeleton. Audit access/export is
audited. Audit itself has a finite profile; “security” is not a forever
exception. Tamper evidence/WORM is a deployment-profile capability and does not
justify raw PII retention.

Audit/evidence targets use only a provider-neutral `core:*` entity type and a
random `internal-ref:<32-64 hex>` identifier resolved within the tenant data
plane. Contact values, provider IDs and caller-selected business keys are not
valid audit target IDs.

### Derived data, backups and restore

Search documents, thumbnails, transcodes, notification previews, report facts,
rollups, prompts, transcripts, embeddings, caches and exports inherit their
parent deadline or a shorter separately approved purpose. Rebuild cannot
resurrect deleted content.

For a shared object, deleting one parent detaches that link; physical bytes and
versions are removed only when all live parents/purposes are eligible and no hold
applies.

Backups/object versions have a finite maximum and are isolated from ordinary
processing. A tamper-resistant erasure/hold ledger newer than a restored backup
is reapplied before traffic, search, analytics or exports resume. Affected
stream/cache epochs rotate as required by ADR 0012. A known finite backup tail is
`primary_purged_backup_expiry_pending`; an unverified internal copy/restore path
is `verification_blocked_internal_residual`. External residual status is reserved
for copies outside the operated data plane. None is false full completion.
For versioned S3-compatible storage, deleting the live object root alone is not
evidence that the separately registered backup/version root has expired.

Realtime replay pruning remains position-safe: only a contiguous prefix before
all mandatory checkpoints is deleted, and its retained minimum advances in the
same transaction. Tombstones/snapshot semantics outlive the incremental window;
expired clients resync.

Current-state shadow rebuild after pruning starts from a tenant-consistent
canonical baseline at position `N`, including tombstone and erasure/hold/
restriction ledger fences, then replays the retained tail `> N`. The prefix is
not pruned until that baseline is verified. Analytics rebuilds only still-
eligible facts and cannot resurrect purged content or subject bridges.

### Policy precedence and entitlements

The evaluator applies jurisdiction/deployment safety constraints, a separate
legal-hold blocker, lawful-purpose deadlines/legal maximum, restriction of use,
tenant choice and finally product baseline/entitlements. Restriction alone never
postpones expiry. Plan limits can price or constrain optional longer storage;
they cannot override legal minimum/maximum, force deletion under hold, block
verified export/deletion, or delete on non-payment/license expiry.

Policy revisions are immutable/audited. A destructive shortening shows a
tenant-scoped rows/bytes/backup/hold preview, requires expected revision,
approval and cooling period. Lengthening requires a documented continuing
purpose, not only a tariff change.

### Executable contract integrity and activation

Schema validation alone does not make a lifecycle object executable authority.
Governance, catalog/registry composition, templates, effective policies,
discovery/scope manifests and deletion plans use domain-separated canonical
hashes created by their constructors. Executable boundaries additionally
require authentic deep-frozen constructor results where applicable; a
caller-authored schema/hash lookalike cannot substitute for an activated policy,
complete discovery/evaluation, request, plan/run or export materialization.
Server-owned discovery, matcher, archive-packager, reset-ledger, current-
authority and claim-repository callbacks are non-JSON composition-root
capabilities registered at trusted bootstrap; endpoint-supplied functions or
shape-compatible deserialized objects are rejected.

An effective policy is first an immutable candidate. Activation consumes a
trusted complete impact proof and canonical preview bound to the current policy,
exact class/root diff, rows/bytes, holds, backups and earliest destructive time.
A reviewed compare-and-set transition requires distinct requester/approver,
current exact-scope authorization at every transition point, non-zero cooling,
current policy/activation fences and explicit bootstrap or supersession/
rollback lineage. The evaluator accepts only the current activated policy and a
trusted complete high-water snapshot of all active purposes, holds and
restrictions for the target; omission fails closed.

Activation itself reloads the impact source at `activatedAt` and compare-and-
sets the reviewed high-water, snapshot, root/byte/hold/backup counts and earliest
destructive time. A stale preview cannot become current policy authority.

A destructive privacy result preserves one authentic
`request -> deletion plan -> deletion run` chain. The canonical plan binds its
exact scope, decision basis, lifecycle evaluations, revisions and every
operated/backup/external checkpoint. Backup execution is bounded by the policy
evaluation's `backupMaximumAt`, not a caller-selected later date.

Export products keep distinct proof types. Every chunk rechecks current
authorization and root/entity-lineage revisions at materialization; canonical
zero/completeness evidence, manifest totals/hash and archive packaging bind the
exact terminal artifact. One-use download issue/consume uses a principal-bound
claim and receipt compare-and-set transition, so reissue, replay or principal
substitution cannot be represented as success.

`INB2-CON-010` provides the schemas, authenticity boundaries and required
repository/capability interfaces. In particular, one-use export has no
process-local implementation that is valid for production: the injected
repository must enforce durable artifact-claim uniqueness and transactional
receipt CAS across processes and restarts. Concrete database tables/indexes,
transaction implementation, crash recovery, worker leases and physical
artifact/deletion execution remain required work in `INB2-DB-009` and
`INB2-OPS-006`/`012`; contract tests may use fakes but are not persistence
evidence.

### Deployment ownership

All customer-data lifecycle state and execution remains in the data plane.

- shared SaaS jobs are tenant-partitioned and cannot create cross-tenant scans or
  restore the whole deployment for one tenant defect;
- isolated SaaS can add reviewed compliance/key/backup profiles without a fork;
- on-prem runs policy, request, hold, export/delete and evidence locally without
  permanent control-plane connectivity; the customer owns local legal settings,
  keys and backups, while Hulee ships the same contracts/commands/diagnostics;
- control-plane and support telemetry receive no customer content, subject index
  or export/delete payload.

### Legal sign-off remains explicit

Official EU/Russian sources establish purpose/storage limitation, subject
rights, deletion evidence, security and communication-confidentiality
constraints, but do not establish one universal Inbox TTL. Before a production
profile is marketed or enabled, named owners must decide:

- regime-specific responsibility roles per deployment/flow;
- launch jurisdictions, industries, residency and cross-border routes;
- whether special Russian ORI/ОРИ or telecom-operator/оператор связи regimes, or
  EU interpersonal-communications regimes, apply;
- call recording/transcription notice/consent rules;
- exact minimum/maximum periods and request SLAs;
- external provider/subprocessor deletion and backup commitments;
- special-category/children/biometric handling;
- acceptability of crypto-shredding/WORM for the selected profile;
- incident-classification and notification roles/timers for each regime.

These are tracked in `docs/product/open-questions.md` with owner and blocking
impact. Missing answers block compliance/profile release, not the provider-
neutral core contracts.

## Required Implementation Boundaries

- `INB2-CON-010`: lifecycle/privacy/hold/export/delete/audit contracts,
  `DataGovernanceContext`, catalog/module declarations and pure policy evaluator.
- `INB2-DB-009`: governance contexts/effective tenant policies, purpose/subject
  links, holds/restrictions, request/export/delete ledgers, unique export artifact
  claims, receipt CAS state, lineage and erasure/restore evidence.
- `INB2-RBAC-001`/`002`: distinct privacy/hold/export/delete/audit permissions and
  separation of duties.
- `INB2-SRC-001`/`003`/`008`: raw/normalized classification, content reference,
  redaction, retention/replay behavior.
- `INB2-MSG-003`/`005`: purgeable content/files and tombstone semantics distinct
  from provider delete.
- `INB2-NOT-002`/`004`/`007`: short-lived minimized payloads and deletion/
  authorization invalidation.
- `INB2-REP-001`/`002`/`007`/`008`: personal facts versus truly anonymous
  aggregates, subject bridge purge/rebuild and export policy.
- `INB2-EXT-002`: recording/transcript classes and purpose/consent evidence.
- `INB2-OPS-006`: effective-policy/governance activation fences, hold matcher and
  restriction evaluator.
- `INB2-OPS-010`: bounded retention, core-SQL purge dispatch and contiguous
  replay-prefix purge.
- `INB2-OPS-011`: object/derivative/index/cache/provider handlers.
- `INB2-OPS-012`: privacy request, tenant export and erasure orchestration.
- `INB2-OPS-013`: finite typed audit and destruction evidence.
- `INB2-OPS-007`: backup/restore ledger reapplication and offline proof.
- `INB2-MIG-001`: historical V1 payload-copy inventory and deletion map;
  `INB2-CLEAN-002`/`INB2-DB-011`/`INB2-CLEAN-GATE`: writer shutdown, disposable
  reset and proof that stale roots cannot reconnect.

## Consequences

Benefits:

- immutable authorship/audit and lawful erasure are no longer contradictory;
- group/multi-subject requests do not rely on one scalar Client;
- every copy and provider residual has an explicit outcome;
- SaaS/on-prem use one core policy with local responsibility/profile settings;
- retention becomes testable, observable and compatible with realtime recovery.

Costs:

- content and technical envelopes need separate persistence/lifecycle;
- every module/storage/search/AI adapter needs classification and delete/export
  contracts;
- subject discovery and group redaction require a review workflow;
- backup/restore and external provider evidence become part of completion;
- exact compliance profiles require continuing legal/product ownership.

## Rejected Alternatives

### One tenant `retentionDays`

Rejected because raw events, Message content, recordings, audit, exports,
backups and anonymous aggregates have different purposes/actions.

### Keep all event/audit payloads forever

Rejected because immutability does not create a lawful purpose and copied PII
would make erasure, minimization and backup control impossible.

### Hard-delete a whole Conversation for one subject

Rejected because group data belongs to several subjects/business purposes and
would destroy other participants' history, authorship and legal evidence.

### Treat Message/provider delete as privacy erasure

Rejected because it does not cover identity, files, raw payloads, indexes,
notifications, analytics, exports, backups or provider/device residuals.

### Let object-storage/database TTLs run independently

Rejected because parent/derived deadlines, holds, revisions, replay positions,
verification and audit must be coordinated.

### Let plan expiry delete data

Rejected because commercial state is not a lawful deletion decision and must not
break export, hold, existing read or legal/contractual retention.
