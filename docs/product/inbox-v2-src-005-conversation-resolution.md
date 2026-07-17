# Inbox V2 Canonical Source Conversation Resolution

Status: implementation evidence for `INB2-SRC-005`.

## Boundary

`INB2-SRC-005` consumes one authenticated, persisted `SRC-003` normalized
event after its `SourceAccount` identity is verified. It resolves or creates,
in one transaction:

1. one exact `ExternalThread` for the adapter-declared thread key;
2. that thread's one canonical external `Conversation`;
3. one account-local `SourceThreadBinding` for the observing account.

This boundary never receives a Client, sender, title, participant set, phone,
username or caller-selected Conversation. Those values cannot select, merge or
route a conversation. Participant/CRM association remains downstream of exact
thread resolution; message dedupe and ordering remain `INB2-SRC-006`, while the
canonical tenant-stream/event/outbox commit remains `INB2-SRC-007`.

## Resolution flow

```text
persisted HMAC-pinned normalized event
  -> sender-free source projection
  -> adapter-owned pure thread plan
       direct | group topology
       purpose
       opaque route descriptor
       initial capability/history snapshot
  -> tenant-keyed, domain-separated candidate derivation
  -> one READ COMMITTED database transaction
       reload and compare the persisted source projection
       fail closed on a non-verified SourceAccount preflight
       reserve the exact thread key or direct alias without thread locks
       lock the (ExternalThread, SourceAccount) target and current BindingHead
       lock and revalidate the exact SourceAccount identity
       load or create ExternalThread + Conversation after those locks
       reuse the current binding or create its initial aggregate
  -> resolved canonical mapping/binding or stable conflict
```

The worker planner performs no provider I/O and no database write. It calls a
strict synchronous adapter-owned resolver exactly once with a frozen
sender-free projection and rejects extended plans. Determinism is covered by
stable-key/golden fixtures instead of executing potentially effectful adapter
code twice. A required injected clock owns the materialization boundary.

## Exact thread identity

The key is the exact tuple fixed by ADR 0011:

```text
tenant
+ realm ID/version/canonicalization version
+ declared provider/source-connection/source-account scope and owner
+ object kind
+ case-preserving opaque canonical subject
```

Core does not trim, case-fold, Unicode-normalize or infer provider subjects.
The adapter declaration must agree with the normalized event and declared
scope. Missing or unsafe identity remains unresolved instead of falling back to
display metadata.

Provider-scoped group keys omit the observing account from the canonical
thread candidate. Therefore the same proven provider group through two
accounts produces one `ExternalThread` and one `Conversation`, but each account
derives a different binding and remote-access episode. Account-scoped private
keys include their exact account owner and remain separate even when the same
Client is later linked to both.

The opaque route descriptor is adapter-owned, digest-verified and pinned to the
exact normalized adapter snapshot for a newly created binding. Its destination
may intentionally differ from the thread subject, but it never comes from the
sender or a participant. Historical mapping/binding replay accepts only the
same stable adapter contract/version/surface; it does not require an obsolete
load timestamp or declaration revision to equal the new observation.

## Server-owned candidates

Candidate Conversation, thread, binding and remote-access-episode IDs use five
separate tenant HMAC purposes, with materialization authorization using the
fifth purpose. Tenant, trusted service, long-lived namespace generation and the
complete canonical preimage are bound into every derivation. Clear provider
subjects do not appear in the resulting IDs or authorization token.

Entity candidates remain stable across replay time and wrapping-key rotation
that preserves the underlying tenant namespace secret. Tenant, exact key,
account-local binding identity and namespace generation changes remain
isolated. The materialization authorization token also binds the exact
raw/normalized event, route, capabilities, source-envelope HMAC and
materialization time. A trusted verifier recomputes this HMAC from the tenant
namespace secret and constant-time compares the token. The database resolver
requires that synchronous verifier and rejects a false/throwing verifier before
opening a transaction; there is no permissive production default.

## Atomic database boundary

Existing external-thread and binding repositories expose transaction-local
helpers in addition to their unchanged standalone APIs. The composite resolver
owns the only retry loop and transaction, so it never nests two independently
committing repositories.

Inside the transaction it reprojects the persisted normalized envelope rather
than trusting the caller's JSON. Tenant, raw/normalized event, connection,
account, thread declaration/key, HMAC, adapter snapshot and recorded time must
exactly equal the materialization plan. A cheap account-identity preflight
rejects missing, provisional or conflicted accounts before they serialize a
hot group key. The current account row is then locked and compared again after
the current BindingHead lock, so a concurrent identity transition cannot pass
on a stale `READ COMMITTED` snapshot.

The exact-key advisory lock serializes canonical and alias lookup with initial
creation. Its immutable registry reservation yields the canonical thread target
without first locking ExternalThread or Conversation rows. The transaction then
uses the global source order `exact key -> binding target/BindingHead ->
SourceAccountIdentity -> ExternalThread/Conversation`; this matches binding
transitions and SourceOccurrence materialization and avoids the former
high-contention lock inversion. Database uniqueness remains the final authority
for one thread per key, one external Conversation per thread and one binding per
`(ExternalThread, SourceAccount)`. A race either observes the canonical winner
or returns a stable conflict; it never selects the first/latest Conversation.

If a thread/Conversation is inserted but binding validation or creation later
fails, a typed rollback marker escapes the transaction. The caller receives a
closed conflict result only after the transaction has discarded every new
mapping row. Only PostgreSQL serialization/deadlock SQLSTATEs `40001` and
`40P01` are retried, at most three attempts.

The resolver requires a positive caller-supplied tenant stream position for a
new Conversation and never invents one. `INB2-SRC-007` must later invoke this
seam from the canonical tenant commit that persists its change/event/outbox
records atomically. This task does not claim that later publication boundary.

## Initial binding policy

A first trustworthy observation creates a conservative revision-1 binding:

- remote access is `observed` with the normalized event as direct evidence;
- administrative routing is `disabled`;
- runtime health is `unknown`;
- history is `unsupported` or `not_started` exactly as the adapter declared;
- provider roles start empty;
- route and capability snapshots use the exact adapter plan;
- cursors, watermarks and last-durable-raw pointers start null.

Inbound observation alone therefore cannot grant outbound authority or claim
provider membership. Later binding transitions own enablement, health, roles,
history watermarks, capability refresh and route revision.

## Stable conflicts

Closed results distinguish missing or changed persisted source evidence,
unverified/conflicted account identity, exact-key/digest collision, topology,
Conversation, adapter-surface, route-digest, mapping and binding conflicts.
They carry safe tokens and no provider credentials. Client/sender/title
ambiguity is not a conflict category because those fields never enter the
resolver.

An immutable direct alias can resolve an old exact key to one canonical thread
and Conversation. Similar names, members or Clients cannot create an alias,
and aliases cannot form a second current mapping.

## Compatibility and ownership

`INB2-SRC-005` needs no migration. It composes the additive `INB2-DB-003`
Conversation, external-thread, alias, account-identity and binding relations
and preserves their standalone repositories. Current install, populated V1
preserve and pinned N-1 migration contracts therefore remain unchanged.

No provider name or branch is present in core resolution. Telegram, WhatsApp,
MAX and future messenger, marketplace or classified adapters express their
differences only through versioned realm/object/scope, opaque route and
capability declarations.

## Verification map

The task gate covers:

- strict runtime and compile-time rejection of Client, sender, title,
  participant and existing-Conversation inputs;
- provider-scoped group sharing across accounts and account-scoped private
  separation;
- tenant isolation, cross-connection group reuse and exact case-sensitive
  opaque subjects;
- canonical replay, direct alias resolution and deterministic candidate IDs;
- persisted-source/HMAC, account identity, topology, adapter, route and binding
  substitution failures;
- concurrent first-event convergence and rollback after a forced post-mapping
  binding failure;
- no provider I/O, nested transaction, fake stream position, CRM link,
  participant, Message, WorkItem, unread, notification or outbound effect;
- current PostgreSQL install plus populated preserve and pinned N-1 paths.

## Verification

Completed on `2026-07-17`:

- focused contract, worker, verifier and database repository suites passed
  `7/7` files and `69/69` tests;
- the clean PostgreSQL gate applied all `45` migrations with contract
  `sha256:686be094f65af826d67157ef67bf7fb57b6aeae774e1f15c62e2d13c56200f73`
  and passed `28/28` files / `245/245` tests, including `6/6` real SRC-005
  cross-connection group/private, concurrency, lock-order, alias and rollback
  scenarios;
- populated preserve, pinned N-1 compatibility and RBAC dry-run passed `3/3`
  files / `17/17` tests; `db:check` and the source-bundled N-1 build passed;
- full `pnpm check` passed `332` test files / `3374` executed tests plus
  formatting, ESLint, TypeScript, DB, i18n, encoding, branding and native
  gates; its `37` opt-in files / `288` tests were covered by the explicit
  PostgreSQL and preserve gates;
- independent final reviews found no remaining P0/P1/P2 issue.
