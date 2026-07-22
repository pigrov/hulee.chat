# Inbox V2 MSG-007 Provider Echo And Native Outbound

Status: `done`

Task: `INB2-MSG-007`

Started: `2026-07-22`

## Scope

`INB2-MSG-007` closes two inbound-to-Message paths which must never be treated
as a new customer request:

- an exact provider echo or provider response for a Hulee-authored outbound
  Message;
- an outbound Message created in the provider's native application and later
  observed by Hulee.

The implementation remains provider-neutral. Telegram, WhatsApp, MAX and later
direct-number adapters normalize their facts through the same source and
outbound-provider contracts; provider-specific correlation rules do not enter
core persistence.

## Attempt-before-I/O and exact correlation

An outbound attempt and its retry-safety declaration are durable before any
provider call. When the adapter owns an exact correlation token, the same
transaction also persists an immutable correlation anchor containing the
tenant, route, Message, binding generation, adapter surface and first attempt.
Opening the provider call is rejected if the content plan, binding, capability,
provider-access or retry fence has changed.

Echo matching uses only that exact anchor plus the declared provider reference
kind, correlation token and artifact ordinal. Sender, body and timestamp
similarity are never sufficient. A provider-wide cross-account echo is accepted
only when the adapter declared authoritative provider-thread identity and
authoritative external-thread portability; otherwise the original
SourceAccount and SourceThreadBinding must match exactly.

Unknown or weak evidence remains pending. It cannot create a Message link,
advance the dispatch or authorize another provider call.

## Provider observations and artifact settlement

Provider response and provider echo are separate immutable observations. Each
observation retains its exact SourceOccurrence and creates its own Message
transport link. One immutable outbound artifact has at most one effective
accepted resolution and one canonical artifact/reference link; a later response
or echo for the same artifact reuses those records rather than inventing a
second provider artifact.

Split/multipart dispatches settle per artifact. Partial coverage resolves the
observed occurrence but retains the dispatch state. Only complete planned
artifact coverage may complete a pending attempt or reconcile an
`outcome_unknown` attempt to accepted. Response-before-echo,
echo-before-response and accepted-response replay therefore converge to the
same canonical artifact set.

Mixed provider truth is deliberately not flattened into a successful attempt.
If at least one planned artifact is accepted while another artifact is failed
or still outcome-unknown, the attempt remains `outcome_unknown`, records the
stable `core:provider-artifact-outcomes-mixed` reason and requires an explicit
operator duplicate-risk decision. Automatic retry cannot overtake that state.
A complete hybrid result (for example, an exact echo for one artifact plus a
descriptorless accepted response for another) may transition directly from
pending to accepted when every planned artifact is covered; a fully
settlement-backed result waits for those settlements to commit.

Every provider observation has a literal no-effect disposition: it is not
customer inbound, does not create unread/work/notification state, does not
create an outbound dispatch and never requests provider I/O.

## Durable settlement handoff

The response transaction and the exact-echo reconciliation transaction append
one durable settlement work item together with the observation. A successful
observation write cannot be stranded without runnable work.

Settlement workers use tenant-scoped `SKIP LOCKED` claims, hash-only lease
tokens, bounded leases and compare-and-swap finalization. The worker loads the
exact immutable observation and current canonical settlement state, builds the
provider-neutral settlement commit, obtains explicit command authority and
seals one atomic occurrence/artifact/transport/stream mutation. No settlement
stage calls a provider.

A crash before settlement leaves the lease for bounded reclaim. A crash after
the atomic settlement but before work finalization is recovered by detecting
the existing observation settlement and finalizing the reclaimed work item as
an exact replay. Retry schedules are explicit reconciliation retries; they are
not permission to repeat non-idempotent provider I/O. Terminal structural or
authority conflicts become diagnosable dead work rather than silent drops.

Provider-response occurrence materialization uses the immutable route-time
binding and verified-account snapshots. A legitimate later binding refresh or
account reauthentication cannot invalidate already-recorded provider truth.
The planner retains the raw occurrence binding as the transport association,
while the response evidence keeps its complete projected binding wrapper. Its
authorization and materialization times are anchored to the immutable
SourceOccurrence `recordedAt`, so a later settlement timestamp cannot rewrite
the historical provider-observation boundary.
Echo observation creation still requires the current source/event fences. Once
that immutable observation and its work item commit, settlement instead reads
the exact occurrence-time binding and verified-account snapshots retained by
the SourceOccurrence; a later rebind, disable or account-generation advance
cannot strand durable provider truth. Ordinary inbound events continue to use
their current source/event fences.

Provider-response SourceOccurrence settlement is one guarded atomic state
change: the original row must be `provider_response` / `outbound` /
`pending` at revision 1, and the final row must be `resolved` at revision 2
with exactly one matching pending-to-resolved transition, exact resolver,
reference and timestamps, and no unresolved candidates. The database rejects
partial, replay-shaped or independently assembled create/resolve histories.

## Provider-truth serialization and retry safety

An accepted provider observation is a stronger fact than a later local
non-accepted transition. Attempt completion, retry opening and non-accepted
outcome reconciliation therefore inspect every accepted observation for the
same attempt while holding the canonical dispatch lock. Pending or leased
settlement work returns a stable wait result, dead work requires explicit
repair, and an orphaned or incoherent observation/work/settlement chain fails
closed.

The observation query takes no additional row locks. Exact-echo correlation
already holds the dispatch and attempt `FOR SHARE` until its observation and
work item commit, while transport mutation takes the dispatch `FOR UPDATE`.
Whichever transaction wins that single serialization point determines the
head observed by the other side without a work-to-dispatch lock inversion.
Accepted provider completion remains allowed and converges with the delayed
echo settlement; `outcome_unknown`, failed, retry and non-accepted
reconciliation cannot overtake unconsumed accepted evidence. This prevents a
crash-recovery turn from authorizing a blind second provider call.

## Native-app outbound Messages

A native outbound observation must have one exact
`SourceExternalIdentity` provider actor. It imports as a source-originated
outbound Message with that source participant as author, `appActor = null`, no
automation causation and no outbound route or dispatch.

The first exact Message key creates the Message, ExternalMessageReference,
resolved SourceOccurrence and `native_outbound` transport link atomically.
A later exact occurrence for the same canonical Message attaches one additional
resolved occurrence/link through the dedicated
`core:message.native_outbound_occurrence.attach` command. Creation and attach
are separate command shapes so a duplicate cannot masquerade as another new
Message.

Both paths derive their no-effect proof from durable rows in the ambient source
reconciliation transaction. They reject customer-inbound counters, unread,
work-item, notification, provider-I/O and outbound-dispatch effects. A
notification or provider intent injected by a planner therefore rolls back the
whole reconciliation.

## Runtime boundary

This task owns provider-neutral correlation, provider-truth normalization,
durable response/echo settlement and native outbound import. Direct-messenger
adapters still own provider API calls, provider reference extraction,
capability declarations and normalization of provider-native payloads. Adapter
parity remains in the corresponding direct-messenger tasks.

## Clean-slate database checkpoint

The Inbox V2 baseline was regenerated after the schema and trigger set froze.
Its raw SQL SHA-256 is
`aeb2e73818cb9bdbed7ef2c60f55642e647aaf9357df839a968b93fb1a8a43c9`;
the migration contract digest is
`sha256:a0fb976907a82654f49ecee0aac4ea0951e0372d6aa7ff25750006bdbd86e9e9`.
The retained catalog contains `14,955` rows with digest
`sha256:467f31ce6438c8928374d89fd0d68ab596e86937e5526c64208807a4c705054a`.

The root Drizzle snapshot contains `317` tables and `263` enums. A fresh
database proves both bounded immutable observation columns
(`observation_detail` and its SHA-256 digest) are `NOT NULL`, while the two
incorrect broad immutable triggers formerly attached to shared Message and
TimelineItem heads are absent. Fresh install, retained-catalog verification and
the two-pass install/reset lifecycle all use this same baseline.

The final authorization immutability function preserves the repository
foundation's narrow retention exception: only the non-login retention owner,
the exact transaction-local retention GUC and the three stream/event/outbox
relations may delete an otherwise immutable retained prefix. A schema
regression test inspects the final function definition so a later SQL overlay
cannot silently remove this boundary again.

## Verification

The final task gate covers:

- response/echo/crash order permutations and exact replay;
- split artifact partial and complete coverage;
- cross-account authoritative echo plus weak/unknown-account rejection;
- accepted, outcome-unknown and unsafe non-idempotent attempt behavior;
- lease concurrency, expiry, reclaim and crash-after-settlement recovery;
- binding/account revision drift after durable provider response;
- native outbound create, exact duplicate attach, author identity and injected
  provider/notification-effect rejection;
- real PostgreSQL schema guards, clean baseline install/reset and repository
  quality gates.

Final evidence on the frozen baseline:

- two disjoint task-focused Vitest selections passed `11/11` files and
  `254/254` tests; the final shared-auth-function schema selection passed
  `18/18` tests;
- `pnpm test:inbox-v2:source` passed `80/80` files and `1,269/1,269` tests;
- fresh migrate, idempotent install and retained-catalog verification passed
  with zero missing, changed, added or forbidden V1 objects; the isolated
  install/reset lifecycle passed `1/1` file and `2/2` tests;
- the previously failing PostgreSQL regression selection passed `3/3` files
  and `36/36` tests, and the final outbound response/echo selection passed
  `1/1` file and `54/54` tests;
- the accepted-artifact versus retry-decision race passed `10/10` independent
  named-test processes with no test retry; each run required the loser to fail
  with the exact retry-safety fence and retained only a coherent winner;
- the strict-alone `pnpm test:inbox-v2:postgres` run passed `34/34` files with
  `386` passed and `6` intentionally skipped tests (`392` total);
- the final `pnpm check` passed formatting, lint, typecheck, `360` passed and
  `33` skipped default-test files, `4,237` passed and `394` skipped default
  tests, plus database, i18n, encoding, branding, native and Inbox V2
  clean-slate guards;
- independent final acceptance reviews found no P0/P1 issue; task-scoped
  debug-marker inspection and `git diff --check` were clean.
