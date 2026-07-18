# Inbox V2 SRC-008 Replay, DLQ, Diagnostics And Backpressure

- Status: `done`
- Task: `INB2-SRC-008`
- Started: `2026-07-17`
- Finished: `2026-07-18`

## Scope

`INB2-SRC-008` closes the inbound source-processing lifecycle left deliberately
open by `INB2-SRC-002`, `INB2-SRC-003` and `INB2-SRC-007`.

This slice owns:

- a provider-neutral processing state machine from durable raw ingress through
  normalization and the downstream materialization stages;
- revision- and lease-fenced retry, finite attempt budgets, DLQ and exact
  replay episodes;
- typed diagnostics that are classified before persistence and cannot contain
  raw payloads, provider objects, exception strings, headers or arbitrary JSON;
- tenant/connection/account queue isolation, bounded in-flight work and
  account-fair claiming;
- provider cursor acknowledgement only after the exact raw occurrence and a
  resumable work head are durable;
- separate raw payload, allowed-header, normalized payload, replay and safe
  diagnostic deadlines;
- finite tenant/purpose-keyed HMAC dedupe/outcome skeletons with a pinned key
  generation, explicit guarantee end and no weak identity fallback.

It does not absorb realtime/SSE slow-consumer policy, provider outbound-I/O
fencing, the general physical purge engine, admin health UI or production SLO
chaos certification. Those remain owned by `INB2-RT-*`, `INB2-SRC-009`,
`INB2-OPS-*` and `INB2-DMX-*` respectively.

## Runtime contract

The V2 contract is intentionally separate from the legacy unprefixed
`source-processing.ts` compatibility taxonomy. The legacy shape accepts
arbitrary `safeDetails`, replay metadata and `forceReprocess`; none of those
fields are accepted by the Inbox V2 runtime.

The strict runtime contract defines:

- exact tenant, `SourceConnection`, nullable `SourceAccount`, raw event,
  nullable normalized event and stage scope;
- attempts bound to work revision, worker, lease-token digest, lease revision,
  claim/start/expiry timestamps, origin and a finite maximum attempt count;
- `processed`, `ignored`, `duplicate`, `retry_scheduled` and `dead_lettered`
  outcomes using the existing four-field safe diagnostic primitive only;
- bounded provider/local rate-limit hints and retry timestamps;
- exact raw, normalized or DLQ replay targets with one request ID, canonical
  request hash, catalog reason and server-owned actor;
- an explicit replayability state (`replayable`, `not_replayable`, `expired`);
- dedupe skeletons that contain only domain-separated HMACs, a pinned key
  generation, a safe terminal outcome and finite replay/guarantee/expiry
  windows.

Unknown properties are rejected. No contract field can carry a provider error
body, external identifier, URL, header map, message text or free-form metadata.

## Processing state and fences

The durable work lifecycle is:

```text
pending -> leased -> processed | ignored | duplicate
                  -> retry_scheduled -> leased
                  -> dead_lettered -> replay episode -> pending
```

Every claim increments the attempt and work revisions and stores only the
canonical digest of the transient lease token. A completion compares the exact
tenant, work, stage, worker, token digest, work revision, lease revision and
database-time lease boundary.

The immutable attempt row is written before the mutable work head is moved to
retry or a terminal state. A DLQ transition writes the attempt, DLQ fact and
terminal work state in the same transaction. Repeating the exact same fenced
outcome returns the existing result; a different or stale owner cannot mutate
it.

An exception from one handler is caught per claim. The exception object is
never serialized. A registered classifier must return the strict safe
diagnostic; invalid classifier output is discarded and replaced by a fixed
catalog code plus an opaque internal correlation token. This preserves
retryability without turning logs or diagnostics into a payload side channel.

## Backpressure and account isolation

Backpressure is scoped to the inbound source scheduler, not the UI realtime
transport.

The policy has finite nested limits for:

- claim batch;
- in-flight work per tenant, connection and account;
- queued work per tenant, connection and account;
- attempts, base/max retry delay and jitter.

The SQL claim path ranks due rows inside exact connection/account partitions
before the global tenant batch and uses database time with `SKIP LOCKED`. The
production scheduler supplies a per-account claim cap, so a hot account,
provider outage or poison event cannot fill every slot. The compatibility path
may omit that cap during an additive N-1 window and retains the SRC-002 order.

Shared pressure heads keep in-flight/queued counters, consecutive failures,
backoff and rate-limit reset times visible to every worker replica. An account
rate-limit hint requires an exact account; connection hints cannot suppress
another connection. The in-process coordinator applies the same nested limits
again, which prevents one worker process from violating the database policy.

## Durable-before-cursor acknowledgement

Provider receive/history cursors are not client realtime cursors. The runtime
stores only a tenant-keyed HMAC and a secret reference for the opaque provider
cursor; clear cursor bytes do not enter the processing tables.

An acknowledgement names the exact owner slot, route generation, raw event,
raw-ingress work ID, work revision and durable work state. The database accepts
the checkpoint only when the raw envelope and resumable work row exist in the
same tenant/connection/account scope. The raw occurrence and checkpoint are
committed together, or the provider cursor remains unchanged.

Consequently a polling restart after persistence, normalization or
materialization failure can resume the exact input. A later processing failure
does not roll the provider cursor backward and does not make the already durable
input disappear.

## Replay and DLQ

Replay is a new processing generation of the same exact target, not a mutation
of immutable history and not a second canonical Message command.

A replay request:

1. selects exactly one raw event, normalized event or DLQ fact;
2. binds the target tenant/source/account/stage and expected revision;
3. records one catalog reason and Employee or trusted-service actor;
4. uses a request ID plus canonical request hash for idempotency;
5. verifies the target is failed/DLQ, evidence still exists and every replay
   deadline remains open;
6. advances the existing work head to a new processing generation and leaves
   prior attempts/DLQ facts immutable.

The same request returns the first result. Reusing its ID/hash boundary for a
different target or reason returns `idempotency_conflict`. Processed, ignored,
duplicate, expired, evidence-free, cross-scope and revision-conflicted targets
are rejected with stable typed decisions. There is no force flag that bypasses
expiry or canonical idempotency.

## Evidence and finite dedupe

Raw payload, allowed headers and normalized payload remain separately
classified payload relations. Attempt diagnostics and DLQ facts contain safe
catalog IDs only and have their own finite expiry. A legal hold may retain
classified evidence physically, but does not extend replayability, a processing
purpose or the declared dedupe guarantee.

The post-terminal dedupe skeleton contains:

- tenant/source/account scope and raw/normalized target references;
- `core:source_replay_and_diagnostics` purpose;
- pinned key generation;
- separate identity and outcome HMAC domains;
- safe terminal outcome and optional catalog diagnostic code;
- terminal, replay, guarantee and skeleton-expiry timestamps.

It contains no clear provider event ID, signature, fingerprint, payload/header
hash, content fragment or time-derived fingerprint. Key material stays behind a
tenant secret reference. Active, verification-only, retired and destroyed key
states have finite issue/guarantee/verify windows.

Rotation keeps an old generation verifiable only through its declared window.
A missing, retired or destroyed key fails closed; the runtime never falls back
to unkeyed SHA-256 or a clear provider identity. When replay evidence expires,
replayability becomes explicitly `expired`. When the guarantee and skeleton
window end, the outcome skeleton is eligible for hard deletion and duplicate
prevention is no longer promised.

## Additive migration and N-1

The persistence layer is additive. Existing SRC-002 raw work remains the N-1
compatibility queue while the new runtime relations are installed dormant and
activated through a capability-complete composition. The bridge creates the
resumable raw-ingress runtime head in the same transaction without requiring an
old binary to understand new columns or enum values.

Production composition refuses activation unless it receives:

- every source-processing stage handler;
- durable retry/DLQ/replay/cursor repository capabilities;
- bounded scheduler policy;
- safe diagnostic classifier;
- tenant key-ring/lifecycle capability.

This prevents a partially upgraded worker from acknowledging provider input or
silently using the compatibility SHA identities as a production dedupe
authority.

The positive activation seam consumes normalization plus one opaque,
all-or-nothing capability set issued by a single process-local SRC-004..007
transaction composite. Individual downstream handlers cannot be mixed,
partially registered, structurally forged or reused, and every issued handler
is pinned to the exact claimed stage. This closes the V2 runtime composition
boundary without switching any legacy/provider authority. The audited dual
materialization phase and actual worker/provider cutover remain owned by
`INB2-MIG-002` and `INB2-MIG-005`.

## Verification

Completed on `2026-07-18` with the following evidence:

- migration `0048_inbox_v2_source_processing_runtime.sql` contains `96`
  generated additive DDL statements plus `2` schema-owned invariant blocks;
  `pnpm db:check` passed and the fresh PostgreSQL gate applied `49` migrations
  with contract
  `sha256:f1eb6d3b49875524c7467ea8c6ba01bed70dfc9138bc7ccf6ff198ba2d22b69a`;
- the fresh PostgreSQL suite passed `30/30` files and `294/294` executed tests;
  `6` explicitly opt-in scenarios were intentionally skipped by that runner;
- focused raw-ingress unit/live coverage passed `35/35`, runtime repository
  coverage `35/35`, schema coverage `23/23`, cursor coverage `63/63`, and
  aggregate terminal-outcome coverage `74/74` tests;
- populated preserve, pinned N-1 and RBAC database gates passed `3/3` files and
  `17/17` tests; `pnpm db:inbox-v2:n1-bundle` rebuilt the pinned compatibility
  artifact against the same `49`-migration target;
- production-activation tests cover the exact full stage set, one-shot issuance
  and consumption, shared process-local provenance, structural/partial/mixed
  rejection, callable capture and exact stage pinning;
- the complete default Vitest suite passed `351/351` executed files and
  `3675/3675` executed tests; `40` opt-in files / `348` tests remained
  intentionally skipped by the default runner. TypeScript, ESLint, database,
  i18n, encoding, branding and native guards passed. Prettier passed for every
  task file; the unmodified full-tree command additionally encountered only
  unrelated local Codex/browser evidence and parallel uncommitted site work,
  none of which was changed or included in this task;
- independent acceptance and activation-boundary review found no remaining
  P0/P1 defect. Concrete provider/legacy authority wiring is deliberately
  deferred to `INB2-MIG-002` and `INB2-MIG-005`, not silently claimed here.
