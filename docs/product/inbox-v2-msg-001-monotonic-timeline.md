# Inbox V2 MSG-001 Monotonic Timeline Creation

Status: `done`

Task: `INB2-MSG-001`

Date: `2026-07-18`

## Scope

`INB2-MSG-001` establishes the first production-safe creation boundary for the
shared Inbox V2 timeline. It covers source-originated inbound Messages,
provider-native outbound Messages and Conversation-bound system events without
ordering them by provider clocks.

The implementation provides:

- a transaction-local Conversation range allocator for package-internal
  composition and tests, while the public `@hulee/db` Conversation repository
  does not expose an unauthorised raw timeline writer;
- authorised prepare/seal paths that persist the canonical item, Conversation
  head, tenant-stream commit, event and projection closure atomically;
- one monotonic `timelineSequence` per Conversation, with stale writers rebuilt
  from the current head after `revision.conflict`;
- exact source and provider clock preservation;
- a typed system-event creation contract, trusted-service permission and
  immutable database binding to the owning event;
- migration, lifecycle, preserve and pinned N-1 compatibility evidence.

## Ordering and clock contract

Timeline ordering is allocated from `ConversationHead.latestTimelineSequence`
under the Conversation/Head row lock. Sequence is a database-owned monotonic
counter; event IDs, provider timestamps and arrival clocks never determine the
canonical order.

Every TimelineItem now satisfies:

```text
occurredAt <= receivedAt <= createdAt
```

For a source-originated Message, the TimelineItem is additionally bound to the
exact immutable source evidence:

- `occurredAt = SourceOccurrence.observedAt`;
- `receivedAt = SourceOccurrence.recordedAt`;
- provider timestamps remain in the provider timestamp relation and may be
  older, equal or out of order without changing `timelineSequence`.

An allocation, its canonical rows and the Conversation head advance share one
SQL transaction. A failed callback or seal rolls the range back, so retry may
reuse the same sequence without leaving a gap. A stale concurrent plan returns
`revision.conflict`; it cannot silently append from an obsolete head.

## System-event creation boundary

System TimelineItems use
`core:inbox-v2.system-event-timeline-creation-commit@v1`. The source
`event_store` payload must implement
`core:inbox-v2.conversation-system-event-payload@v1` and bind the exact tenant,
Conversation and recorded clock. The creation snapshot pins its event type,
version, occurred/recorded clocks and SHA-256 payload digest.

The initial supported shape is deliberately narrow:

- trusted-service actor only;
- `workforce_metadata` visibility;
- `non_activity` activity kind;
- one `core:timeline.system_event.create` command authorised by
  `core:conversation.timeline_append_system` for the exact Conversation and
  revision fence;
- exactly one TimelineItem change, one domain event and one projection intent;
- no provider I/O, notification or workflow side effect under that receipt.

The source event is locked before the Conversation and before the tenant stream
head. The opaque prepare capability can be consumed only once and only inside
the atomic materialisation that issued it.

## Database backstops

Migration `0049_inbox_v2_monotonic_timeline.sql` adds:

1. a tenant-scoped partial unique index for `system_event_id`, preventing the
   same owning event from becoming two TimelineItems;
2. a binding trigger that validates the typed payload, exact Conversation,
   source clocks and TimelineItem clocks;
3. a `FOR SHARE` lock on the source event during that binding, closing the race
   with a concurrent event update;
4. an update/delete guard that keeps a referenced source event immutable.

The migration tail has a reviewed digest in `db:check`. The current-schema
lifecycle inventory also pins both functions, both triggers and the partial
unique index, so repeat install detects missing or rewritten guards.

## Concurrency evidence

The PostgreSQL acceptance race starts the real authorised inbound,
provider-native outbound and system-event prepare/seal paths against one
Conversation. Inbound is held at a deterministic barrier while the two stale
plans contend. After inbound commits, both losers observe `revision.conflict`,
rebuild their domain commits from the current Conversation and retry.

The final assertions prove:

- unique contiguous sequences `1..3`;
- matching contiguous tenant-stream positions;
- no gap after conflict/retry;
- exact source observed/recorded clocks;
- preserved reverse provider timestamps;
- a Conversation head and tenant-stream head that point to the third commit.

A separate database interleaving test inserts a system-event reference while a
concurrent transaction attempts to update the source event. The update waits
for the reference commit and is then rejected by the immutable guard.

## Verification

Commands executed:

```text
pnpm exec vitest run <MSG-001 focused contract/core/repository files>
pnpm test:inbox-v2:postgres
HULEE_DB_INTEGRATION=1 pnpm test:inbox-v2:preserve
pnpm db:inbox-v2:n1-bundle
pnpm db:check
pnpm typecheck
pnpm exec eslint <MSG-001 files>
pnpm exec prettier --check <MSG-001 files>
pnpm check
```

Results:

- focused contracts, permission, Conversation, authorisation and system-event
  repository tests: `8/8` files and `553/553` tests passed;
- the dedicated Timeline/Message PostgreSQL file passed `24/24` tests,
  including the real three-writer race;
- the disposable PostgreSQL gate applied `50` migrations with contract
  `sha256:a1c86bee22a9be596667d952cdfddef294517d19b3d73f677c79ee1c38995274`
  and passed `30/30` files / `299` tests (`6` explicitly opt-in scenarios
  skipped);
- preserve/N-1/RBAC passed `3/3` files / `17/17` tests;
- the pinned N-1 runtime bundle rebuilt reproducibly against the 50-migration
  target and a second generation produced no artifact diff;
- `db:check`, typecheck, focused ESLint, Prettier and `git diff --check` passed;
- the complete `pnpm check` passed in a clean worktree, including `354/354`
  default test files / `3694/3694` tests plus format, lint, typecheck, DB, i18n,
  encoding, branding and native gates;
- two independent final reviews returned `READY` with no P0/P1 findings.
