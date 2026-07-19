# Inbox V2 MSG-004 Reply And Forward Semantics

Status: `completed`

Task: `INB2-MSG-004`

Date: `2026-07-19`

## Scope

`INB2-MSG-004` separates three operations that a provider UI may present with
similar wording but that have different authority, persistence and delivery
semantics.

| Operation               | Canonical meaning                                                                                                     | Provider reference                                            |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Reply                   | A new Message that replies to one exact Message revision and, for an external target, its exact provider occurrence   | Required and portability-fenced                               |
| Content-copy forward    | A new Message whose server-prepared content is sent as new while retaining exact canonical source-revision provenance | Not presented as a provider-native forward                    |
| Provider-native forward | A provider operation over one exact external occurrence                                                               | Separate capability and operation plan; currently unavailable |

The caller supplies only the tenant, destination Conversation, canonical source
IDs/revisions, route intent and `clientMutationId`; reply additionally supplies
new typed content. SourceAccount, binding, external thread/reference, opaque
quoted token, provider capabilities, copied source content, WorkItem authority
and authorization evidence are server-loaded facts. Unknown caller fields are
rejected.

The application port is not an HTTP endpoint. Authenticated request
composition, bounded loaders and durable public rejection receipts remain
owned by `INB2-API-003`. Live Telegram, WhatsApp and MAX operation mapping and
provider conformance remain owned by `INB2-DMX-003` and their provider tasks.

## Exact reply authority

Reply targets the destination Conversation and one immutable canonical Message
revision. An external reply additionally closes the same ExternalMessageReference,
SourceOccurrence, occurrence revision, immutable occurrence descriptor and
availability observation across the route decision, authorized intent,
persisted Message reference context and SQL rows.

Reference portability is explicit and fail-closed:

- `binding_only` permits only the occurrence's exact origin binding and
  SourceAccount;
- `external_thread` permits another binding only when it resolves the same
  ExternalThread and Conversation;
- `provider_global` requires a bounded, current server proof that binds the
  exact source reference/occurrence, origin and destination account/binding and
  one pinned provider adapter contract.

An unavailable, provider-deleted, unknown or expired reference returns a
defined terminal route outcome. A stale/mismatched availability bit cannot be
reused: its trusted observation binds the exact occurrence descriptor digest,
adapter contract and validity interval. Explicit-occurrence routing must load
that occurrence's origin route and never falls back to a preferred, sole or
policy route.

The destination remains the external thread of the selected binding. In a
group Conversation the provider sender is authorship evidence only; replying
cannot silently open a private dialog with that sender. The opaque quoted
provider token remains internal to the exact route/reference snapshot.

## Content-copy forwarding

Content-copy is deliberately `send-as-new`. The caller cannot inject copied
blocks or external provider identifiers. The current external command loads one
exact immutable Message revision, its Conversation/TimelineItem relation, the
current typed content/object pins and one exact source-read proof, then creates
a new Message, route, queued dispatch, content plan and provider outbox intent.
Multi-source copy remains closed until authorization evidence can bind every
source relation independently.

Attachment copy uses an explicit source-to-destination anchor map. A copied
attachment gets a new destination attachment ID while retaining the exact
source file, file revision, object version and display/media semantics. The
source digest is normalized only for that anchor substitution; all other block
fields and ordering remain protected. SQL independently locks and validates the
current source revision, ordered content payloads, contact children and object
pins, so a stale edit, purge race, reused source anchor or tampered destination
payload cannot pass materialization.

For an external destination, every unique source Conversation requires current
`core:conversation.read` evidence and every source proof must remain in the
`external_work` visibility boundary. Merely being able to read an internal
employee Conversation does not authorize exporting its content to a customer
channel. File/object pins continue to use the MSG-003 current-parent and
external-visibility checks.

The persisted reference context keeps the ordered canonical source revisions,
but no ExternalMessageReference is fabricated and the provider payload is not
labelled as a native forward. Cross-route copy therefore remains a normal new
send over the destination's independently authorized route.

## Provider-native forwarding

Provider-native forward has its own command intent, action, reference context,
capability snapshot and exact one-occurrence cardinality. It is never inferred
from content-copy success and cannot be downgraded to copied content.

The current direct-messenger matrix declares this capability unknown/deferred.
Until a versioned immutable provider-operation plan and adapter implementation
exist, a supported preparer must return the stable terminal
`route.capability_missing` outcome before domain writes, outbox creation or
provider I/O. An unexpected trusted `selected` native result is treated as an
undisclosable boundary violation and fails closed. This preserves the product
distinction without claiming Telegram/WhatsApp/MAX support that has not been
implemented or evidenced.

## Authorization and atomic persistence

Reply uses `core:message.reply_external`; both forward modes use the canonical
`core:message.forward_external` permission while retaining distinct audited
actions. Conversation/WorkItem reply authority, every source Conversation
read, exact SourceAccount use, route binding fence, authorization epoch,
principal, action and provider-outbox attribution must describe the same
operation.

Reply and content-copy share the MSG-002 atomic materialization seam only after
their operation-specific closure succeeds. In one authorized transaction it
fences WorkItem authority, persists the immutable route, prepares the Message
and content plan, then seals timeline, audit, dispatch and provider-outbox
records. Provider code is never called in that transaction. Replay is checked
before current source/route discovery; the authenticated principal and full
operation digest distinguish replay from mutation-ID conflict.

Migration `0054_inbox_v2_reply_and_forward.sql` retargets canonical reference
rows from a mutable Message head to the exact immutable Message revision and
installs the current route/reference/action coherence functions. The immediate
unique/FK/check replacement is intentionally classified as reviewed online-
bridge DDL for a populated upgrade; it is not silently accepted as an ordinary
online install. Production rollout/drain mechanics remain `INB2-MIG-002`.

## Verification

The final task gate passed:

- focused contract, core, API, repository and schema suites: `11/11` files,
  `710/710` tests;
- focused real-PostgreSQL reply/forward coverage: `26/26`, including attachment
  anchor remap, destination tampering, source drift and native-forward closure;
- full real-PostgreSQL gate: `33/33` files, `342` passed and `6` opt-in skipped,
  with all `55/55` migrations installed;
- preserve/N-1/RBAC integration: `3/3` files, `17/17` tests;
- full default Vitest: `375` passed files and `4,125` passed tests (`43` files /
  `396` tests skipped by their declared environment gates);
- `typecheck`, `db:check`, task-scoped ESLint/Prettier, `i18n:check`,
  `encoding:check`, `branding:check` and `native:check` passed;
- the N-1 bundle was regenerated twice with the same SHA-256 contract digest
  `17309fcb8f58b125c61e1300726d1d11d90afe86fa8690c5017a909a3265c792`;
- independent final review returned `READY` with no P0/P1 findings.

The workspace-wide Prettier scan cannot be used as a clean repository signal
while unrelated untracked Chromium runtime data under `.codex-runtime-logs/`
contains non-JSON files. The exact task file set passed the same Prettier check.
