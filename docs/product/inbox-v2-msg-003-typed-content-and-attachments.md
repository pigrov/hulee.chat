# Inbox V2 MSG-003 Typed Content And Attachments

Status: `done`

Task: `INB2-MSG-003`

Date: `2026-07-19`

## Scope

`INB2-MSG-003` establishes the provider-neutral content and file boundary for
Inbox V2. A Timeline item keeps typed, classified and purgeable blocks instead
of a messenger-specific payload. File-backed blocks pin an exact immutable
FileVersion/ObjectVersion pair, while text, location and contact blocks cannot
forge an object pin. One Message can be planned as one or several provider
artifacts without creating a second route or changing its canonical timeline
identity.

The implementation provides:

- typed text, image, audio/voice, video/video-note, file, sticker, location,
  contact and extension blocks with strict per-kind payloads;
- tenant-scoped File, FileVersion, ObjectVersion, current-head, parent,
  derivative/lineage and deletion-evidence records;
- lease-fenced attachment materialization from provider bytes into immutable,
  version-aware tenant storage;
- an immutable outbound content plan with exact binding/capability/provider-role
  and file/object pins plus deterministic multi-artifact identities;
- short-lived download tickets that reauthorize the current parent,
  visibility, retention authority and object version before exact-byte streaming.

## Content and object authority

Typed content is validated at the contract boundary and persisted through the
existing append-only content revision model. File-backed blocks require one
exact pin; inline blocks forbid it. File/object records contain no provider
payload bag: checksum, media type, byte size, storage key/version, lifecycle
state, retention purpose and revision are explicit fields.

A File may have several live parents. Removing one Message/StaffNote/attachment
parent does not delete a shared object while another live parent, purpose or
hold requires it. Current access is conjunctive: tenant, live parent, current
item visibility, RBAC and object lifecycle must all allow the operation.
Derivative edges are tenant-local, append-only and acyclic; concurrent direct
SQL writers are serialized by a tenant graph lock, and unsupported transaction
isolation fails closed.

The public deletion-eligibility result is a bounded diagnostic fence, not an
instruction to delete bytes after its transaction has released the parent and
object locks. `INB2-OPS-011` must consume the same checks while atomically
moving the exact ObjectVersion head to a deletion state and persisting its
outbox/evidence intent; a later parent attach must never race a detached
decision into physical data loss.

## Materialization and storage failure order

The worker claims one materialization lease before storage I/O. It validates
the provider source, writes to a deterministic tenant key with create-only
semantics, reads the exact returned version and checksum, and atomically
finalizes FileVersion/ObjectVersion/head/evidence records. A definite provider
rejection creates a visible attachment fallback. An indeterminate write never
claims failure or retries blindly: exact observed versions are recorded for
orphan reconciliation, while an unknown scope remains indeterminate and
reconcilable without pretending that a version was quarantined.

The S3-compatible adapter distinguishes `definitely_not_written`, an observed
exact version and an unknown write outcome. A retry after a lost acknowledgement
does not trust caller-controlled checksum metadata: without a provider-authentic
checksum it performs a bounded exact-version read and full SHA-256 verification.
A mismatching version is quarantined and cannot become the ready object.

The `retryable` marker on a visible fallback is diagnostic evidence, not an
automatic retry scheduler. Source-loading or storage-scope failures that were
durably finalized as `failed` require an explicit later command/workflow;
unknown write outcomes stay non-terminal and may only repeat the same
deterministic conditional write or enter exact-version reconciliation.

The active storage capability probe is reversible and tenant-scoped. It checks
version enumeration, conditional create, exact head/read/hash/list, conflicting
create, quarantine/read denial and exact-version cleanup. Any incomplete
cleanup or unsupported semantic makes version-aware writes unavailable.

## Reservation namespace lifecycle

Source attachment job, File/Object and opaque source-handle identities are
derived from a process-authentic HMAC key generation selected by the immutable
source event time. A restarted worker therefore reuses the same generation and
the same reservations across an edit, partial `N/2` reservation crash or active
key rotation. The exact generation is stored on the job and is verified before
the provider callback can observe a source handle.

The SQL repository can report bounded counts for unfinished materialization
work and nonterminal jobs pinned to one generation. That result is deliberately
an observation only: it neither proves that every replica has paused admission
nor authorizes key removal. Production attachment activation and key removal
remain blocked on `INB2-MIG-002`, which must add a durable all-replica admission
pause and a serialized, consumed drain receipt. `INB2-OPS-008` owns the alert and
operator runbook before a verification deadline. Until those controls exist,
an expired or unavailable exact generation fails closed before provider or
storage I/O; the system never falls back to the active key and never silently
mints a second identity.

## Reservation namespace rotation

Attachment reservation identities and opaque provider locators use a
tenant-keyed HMAC generation selected by the immutable source `causedAt`.
Every materialization job persists that generation. A retired generation stays
verify-only until its finite deadline, and provider-open verifies the exact
persisted generation instead of trying every key in the keyring.

Key removal is an explicit pause-and-drain operation. The deployment must first
prove that new source materialization admission is paused on every replica for
the tenant; the database currently has no durable pause fence. Only then may an
operator inspect the SQL drain observation. `drained_observed` means both zero
nonterminal jobs for the target generation and zero unfinished materialization
work heads for the tenant in that database snapshot. The second count is
intentionally conservative: it covers a crash after source work admission but
before the first reservation job exists.

The observation alone never authorizes key removal and is unsafe while any
replica can admit new work. The deployment procedure owns the all-replica pause,
drain observation, keyring update and admission resume sequence. A non-zero
count, `blocked_observed`, an unproven pause, or merely reaching `verifyUntil`
must all keep the key available.

This read-only observation is deliberately dormant: Inbox V2 activation and
key-removal paths must not consume it as a capability or receipt. Retirement
remains forbidden until `INB2-MIG-002` provides a durable all-replica admission
pause and a serialized drain receipt in the same operational boundary.

## Outbound artifact and duplicate-safety boundary

The outbound plan is persisted with the canonical Message/route/dispatch
transaction and loaded only under the live provider outbox lease. Provider I/O
rechecks the exact current binding revision, capability revision, content kind,
validity window and required provider roles. The complete planned artifact set
and attempt completion commit atomically; there is no public runtime method to
append a late artifact around that transaction.

Mixed provider outcomes are reconciliation-only. If any planned artifact may
already have been accepted, the attempt requires an operator duplicate-risk
decision. Both reconciliation and retry-open recheck the exact prior attempt
for an accepted artifact before mutation; a database trigger provides the same
fail-closed guard for a direct-SQL retryable reconciliation decision. All-failed
and provider-confirmed-none flows retain their explicit safe retry path.

## Upload staging boundary and follow-up composition

The provider-neutral schema and contracts reserve an internal
`upload_staging` content kind so an authenticated producer can stage bytes in
tenant storage and atomically hand the exact object version to the trusted
materialization command. This task deliberately does not expose or activate a
production upload endpoint. `INB2-API-003` owns idempotent start/finalize/cancel,
current parent/content/authorization revision checks and abandoned-staging
cleanup handoff. The upload capability must fail closed until that composition
is installed.

## Download boundary and follow-up composition

The internal API exposes only the ticket/service boundary. A ticket is tenant-
and principal-bound, short-lived, contains no storage locator and pins the exact
logical File/Object identity, parent fence and authorization epoch. Redemption
reauthorizes the authenticated principal, current parent/item visibility,
retention authority and object state, then resolves the current exact storage
key, version, checksum, media type and byte size before opening storage. The
current boundary reads at most 64 MiB, verifies the complete size and SHA-256
before HTTP headers can be written, and serves the verified bytes as a forced
attachment; range and cache headers do not turn the ticket into durable
authority. Missing ticket service, tenant storage resolver or current-access
repository fails closed.

This task deliberately does not claim an end-to-end production download route.
The production SQL composition that resolves current parent/visibility/RBAC
authority and injects the tenant storage resolver belongs to `INB2-API-002`.
That production composition must also replace the bounded in-memory verifier
with a verified disk/object spool and an explicit concurrency budget before
large-file/high-concurrency downloads are enabled.

It also does not claim N-1 attachment-writer compatibility. The pinned DB-008
process exercises query, reply, routing, outbox and WorkItem paths, but not an
old-shape attachment-anchor write or an in-flight attachment transfer. Nullable
expand columns are therefore only a bridge surface. `INB2-MIG-002` must prove
the exact supported old attachment workload or durably drain those writers and
transfers before V2 attachment ownership is activated.

## Privacy boundary

The immutable plan preserves technical routing and object-pin facts, but raw
or dictionary-verifiable content hashes must not outlive purgeable content.
The persisted plan therefore uses a finite tenant/purpose privacy fingerprint
boundary rather than a public low-entropy content-derived digest. Its key
generation and verification context are server-owned; the fingerprint expiry is
part of the HMAC preimage, and provider-open rechecks current content state,
revision and expiry instead of treating the immutable plan as current
authority. Provider locators remain opaque internal handles; production
lifecycle handlers and absence verification remain owned by `INB2-OPS-010` and
`INB2-OPS-011`.

## Verification

Final verification passed contract, API, worker, storage, SQL repository and
schema coverage. Default Vitest passed `374` files / `4077` tests (`43` files /
`395` tests skipped). The full PostgreSQL gate installed all `54` migrations and
passed `33` files / `341` tests (`6` opt-in scenarios skipped) with contract
`sha256:01d877f5f43035503d7b1542101e04e244cb0d213297614797f8bb6bae2dab6b`.
Preserve/N-1/RBAC passed `3` files / `17` tests. The N-1 bundle was regenerated
twice byte-for-byte with SHA-256
`AC2743B36AE701771EF319B6A67AAF06B27C524EB678F83E2AC987A31E67B841`;
its contract file hash is
`DEBB07E64F67D8FC23AFC58BD07858EC947212BEFD9788AFD580C63EA895E0A2`.
Typecheck, `db:check`, task-scoped lint/formatting, i18n, encoding, branding and
native gates passed. `INB2-ACC-035` and production attachment E2E remain open
until the downstream API and lifecycle compositions above are implemented.
