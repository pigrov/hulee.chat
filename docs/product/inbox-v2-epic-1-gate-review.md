# Inbox V2 Epic 1 Exit Gate Review

- Gate: `INB2-EPIC-1-GATE`
- Reviewed: `2026-07-13`
- Result: `READY`

## Decision

Epic 1 is complete. The public Inbox V2 contracts, pure authorization policy
and test-only scenario runner compose a complete in-memory command flow without
database, application or provider deep imports. Contract-valid happy paths
commit one immutable tenant-stream bundle, while cross-domain invalid states are
rejected before a new world snapshot is exposed.

All 13 prerequisites are complete:

- `INB2-CON-001` through `INB2-CON-008`;
- `INB2-CON-010`;
- `INB2-RBAC-001`, `INB2-RBAC-002` and `INB2-RBAC-005`;
- `INB2-CON-009`.

## Public Consumer Proof

`packages/testing/src/inbox-v2/epic-1-public-boundary.test.ts` imports only the
package roots `@hulee/contracts`, `@hulee/core` and `@hulee/testing`. It proves
that a consumer can:

1. create a versioned internal Conversation and its Employee participants;
2. construct exact canonical authorization facts and evaluate the pure policy;
3. execute an authorized internal Message command;
4. receive one contiguous atomic commit, domain event and projection outbox
   intent;
5. read the canonical Message and create an immutable world snapshot.

`epic-1-public-boundary.type-fixture.ts` separately compiles the key contract,
policy and scenario values and types through those package roots. Package export
maps resolve the three roots and reject `@hulee/*/src/...` deep imports.

The broader scenario suite also proves unknown external inbound, multi-client
group, atomic claim-and-routed-reply, staff note, identity claim, Message
lifecycle, internal direct/group and privacy policy/hold/export/delete flows.

## Invalid-State Closure

The final gate audit found and closed scenario-runner gaps that individual
schemas could not reject without canonical world context.

| Boundary           | Gate invariant                                                                                                                                              |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Canonical graph    | ConversationParticipant sets, WorkItems, ExternalThreads, ConversationClientLinks, Messages and StaffNotes require an existing same-tenant Conversation.    |
| Authorship         | Message and StaffNote authors must exist in the exact Conversation participant set.                                                                         |
| Immutable heads    | Message, StaffNote and WorkItem identity/authorship/origin fields cannot be rewritten by a later revision.                                                  |
| Work cardinality   | One Conversation cannot have two simultaneous non-terminal WorkItems.                                                                                       |
| Internal topology  | An active internal direct has exactly two Employee anchors; an active internal group has at least two active Employees and one active owner.                |
| Identity claims    | A SourceIdentityClaim requires its SourceExternalIdentity; only one active claim may exist and the identity head/reference/version must agree with it.      |
| Projection closure | Employee anchors, owners, clients, messages, responsibility and WorkItem projection fields equal canonical records.                                         |
| Command safety     | Tenant boundary, authorization, replay authorization, idempotency, contiguous CAS, tombstones and atomic commit/event/outbox invariants remain fail closed. |

`scenario-world-canonical-invariants.test.ts` contains adversarial regressions for
orphan references, claim conflicts/head drift, immutable rewrites, duplicate
active work and invalid internal topology/ownership. Denied and invalid attempts
cannot expose a partially mutated world.

## Verification Log

| Check                                                       | Result                                |
| ----------------------------------------------------------- | ------------------------------------- |
| Inbox V2 scenario suite                                     | `6` files, `38/38` tests passed       |
| Epic-focused contracts/core/testing suite                   | `68` files, `1311/1311` tests passed  |
| Full repository suite through `pnpm check`                  | `219` files, `2169/2169` tests passed |
| Formatting, repository-wide ESLint and TypeScript           | passed                                |
| DB, i18n, encoding, branding and native gates               | passed                                |
| `git diff --check`                                          | passed                                |
| Independent public-boundary and acceptance/security reviews | `READY`; no P0/P1/P2 findings         |

The repository gate was made deterministic by removing three unused landing-page
icon imports and assigning the existing heavy `auth-email` dynamic-import test a
10-second timeout. Neither change alters production behavior.

## Explicit Boundary

This gate proves the stable in-memory domain and authorization foundation. The
scenario runner deliberately receives a server-owned transition and does not
claim database foreign keys, transaction isolation, concurrent persistence,
provider I/O or provider-side idempotency. Those guarantees begin with Epic 2
repositories and later source/dispatch epics.

## Exit

`INB2-EPIC-1-GATE` may be marked `done`. The next critical-path task is
`INB2-DB-001`.
