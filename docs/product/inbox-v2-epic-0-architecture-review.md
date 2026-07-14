# Inbox V2 Epic 0 Architecture Gate Review

Status: `accepted`  
Date: `2026-07-10`  
Owner task: `INB2-EPIC-0-GATE`  
Next implementation task after acceptance: `INB2-CON-001`

## Purpose

This review proves that the Inbox V2 baseline and architecture decisions are
specific enough to begin versioned contracts without inventing domain,
authorization, routing, synchronization, lifecycle or migration behavior during
implementation.

It is an architecture-readiness gate, not evidence that Inbox V2, any provider
surface or a production compliance profile is implemented.

## Reviewed Scope

The gate covers:

- product vision, requirements, MVP/deployment/client/control-plane/module/
  source/quality documents required by `AGENTS.md`;
- accepted ADR 0001 through ADR 0015;
- the verified Inbox V1 code/schema/runtime baseline;
- Inbox V2 scenarios/glossary and target architecture baseline;
- direct-messenger capability/evidence matrix and canonical cell ledger;
- data-lifecycle/privacy policy and V1-to-V2 migration/cutover policy;
- the executable Inbox V2 backlog, dependency graph and acceptance scenarios;
- the current repository quality gates.

RIK remains reference evidence only. Its implementation or matrix status is not
Hulee completion evidence.

## Gate Verdict

Verdict: `accepted` — Epic 1 contract work may start with `INB2-CON-001`.

The shared-core contracts have one defined answer for every boundary needed by
Epic 1. Remaining `PQ-*` and `DG-*` questions have owners and block named
commercial, deployment, native-client, provider or compliance surfaces rather
than silently changing the provider-neutral core.

Acceptance evidence:

1. independent domain, security/operations and backlog/coverage reviews reported
   `READY` with no unresolved P0/P1;
2. the final task graph, downstream gate ancestry and direct-messenger ledger
   checks passed;
3. the full repository `pnpm check` passed on the final decision documents;
4. evidence is recorded here and in the canonical backlog verification log.

## Gate Reconciliations Applied

The review closed these cross-document gaps before contract work:

- ADR 0001 through ADR 0007 moved from lingering `Proposed` labels to
  `Accepted`; their one-core, module, tenant, client, control/data-plane and
  entitlement decisions were already mandatory product/backlog invariants.
- ADR 0002 and the module manifest now require a typed, namespaced lifecycle/
  lineage contribution for every data-storing module and fail closed when data
  would lose compatible handlers.
- ADR 0008, requirements and module responsibilities now distinguish the safe
  immutable raw occurrence envelope from separately classified purgeable
  provider payload/evidence and require secret stripping before the first durable
  write.
- The target architecture baseline now names canonical ExternalThread, scoped
  server authority, lifecycle/content boundaries, fail-closed module governance,
  additive cutover and provider-surface evidence policy.
- General product/delivery questions became `PQ-001..PQ-014` with named owners
  and blocking impact; compliance questions remain `DG-001..DG-012`.
- `INB2-CON-001` was narrowed to branded IDs, schema/version envelopes and
  catalog registration primitives. The glossary now assigns each domain/state
  vocabulary to its owning contract; Client pipeline uses an opaque tenant-
  scoped `ClientStageId`, never a hard-coded global sales-stage enum.

## Decision Closure Matrix

Compact table notation is navigational only: `ACC-001..006`, `CON-002/004` and
similar suffixes expand to the corresponding full `INB2-*` task IDs in the
canonical backlog.

| Decision area                       | Canonical decision                                                                                                        | Implementation entry points                                                 | Release evidence                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------ |
| Shared core and deployment          | ADR 0001, 0003, 0006 and 0007: one core, strict tenant boundary, local data plane and policy-based entitlements           | `INB2-CON-001`, `INB2-DB-001/007/009`, `INB2-OPS-006/007/009/014`           | `ACC-024`, `042`, `045`, `046`                         |
| Modules, clients and UI boundaries  | ADR 0002, 0004 and 0005: typed adapters/module governance, i18n/tokens/slots and native-safe shared client contracts      | `INB2-CON-010`, `INB2-UI-001..008`, `INB2-EXT-006`, `INB2-OPS-009`          | `ACC-020`, `028`, `046`                                |
| Source integration                  | ADR 0008: safe raw occurrence envelope, classified purgeable payload, normalization and typed source materialization      | `INB2-SRC-001..009`, `INB2-DMX-001/004/005`                                 | `ACC-001`, `025..027`, `040`, `043`                    |
| Domain ownership                    | ADR 0009: Conversation, WorkItem, Client CRM, EmployeeConversationState, notifications and Inbox projection are separate  | `INB2-CON-002/004/006`, `INB2-DB-001/004/006`, `INB2-WRK-*`, `CRM-*`        | `ACC-001..006`, `017..023`, `027`                      |
| Identity, participants and author   | ADR 0010: auth/source identity, participant membership, app actor and transport sender are independent                    | `INB2-CON-003/007`, `INB2-DB-002`, `INB2-SRC-004`, `INB2-CRM-001`           | `ACC-003..006`, `009`, `021`, `030..032`, `037`, `041` |
| External thread and route           | ADR 0011: adapter-declared realm/scope, canonical ExternalThread, account binding, exact immutable route and occurrences  | `INB2-CON-005`, `INB2-DB-003`, `INB2-SRC-005/006`, `INB2-MSG-002/007`       | `ACC-007..013`, `025`, `032`                           |
| Transaction and realtime recovery   | ADR 0012: independent sequence/revision/position/checkpoint/cursor, atomic commit and snapshot-plus-stream recovery       | `INB2-CON-008`, `INB2-DB-007`, `INB2-PRJ-003`, `INB2-API-*`, `RT-*`         | `ACC-014..016`, `028`, `033`, `048`                    |
| Responsibility and authorization    | ADR 0013: default-deny permission plus server-derived relation/scope/revision; roles/provider state are not authority     | `INB2-RBAC-001..007`, `INB2-WRK-003..006`, scoped API/realtime/report tasks | `ACC-017..024`, `029..038`, `041`, `045`, `047`        |
| Migration and cutover               | ADR 0014: inventory, additive V2, one side-effect owner, conservative backfill, shadow comparison and explicit rollback   | `INB2-MIG-001..007`                                                         | `ACC-028` plus Epic 14/G7 evidence                     |
| Lifecycle, privacy and audit        | ADR 0015: typed class/purpose/period, purgeable content, hold/restriction separation, bounded deletion and restore ledger | `INB2-CON-010`, `INB2-DB-009`, `INB2-OPS-006/007/010..014`                  | `ACC-037..048`                                         |
| Direct-provider capability evidence | Hulee matrix: capability and evidence are per provider surface/account/group model; no provider-wide or RIK-derived claim | `INB2-DMX-*`, `INB2-TG-*`, `INB2-WA-001`, `INB2-MAX-001`                    | 504 canonical cells and later automated/live evidence  |

## Cross-Boundary Consistency

### Domain and identity

- A Conversation is the durable collaboration/timeline boundary, not a Client,
  queue, pipeline stage or assignment aggregate.
- A WorkItem belongs to one Conversation; at most one is non-terminal. Internal
  and genuinely non-actionable employee-only external groups need no WorkItem.
- Client linkage is zero-to-many and never rewrites immutable Message authorship
  or external-thread identity.
- Current Client-link reads are revision-fenced pages, not complete Conversation
  history aggregates. Client merge persists one node state per Client plus
  row-wise immutable events; root-to-root CAS and bounded 64-edge resolution
  paths replace tenant-wide graph loading.
- Employee, Account, ClientContact, SourceExternalIdentity and
  ConversationParticipant remain distinct. A claim is evidence/history, not a
  principal, membership, RBAC grant or responsibility decision.

### Source and routing

- ExternalThread identity uses an adapter-declared versioned realm and scope.
  Account-scoped private dialogs never merge from Client/contact similarity.
- A provider-scoped group may have several SourceThreadBindings and several
  occurrences while retaining one canonical Conversation/TimelineItem only when
  exact adapter evidence permits it.
- Normal send resolves one immutable route. Reply/lifecycle operations obey the
  exact original binding/reference portability. Retry never hops accounts.
- Raw ingress persists only a safe immutable occurrence envelope before
  normalization; secrets and non-allowlisted headers cannot enter durable raw
  evidence.

### State, events and clients

- Timeline sequence, entity revision, tenant commit position, projector
  checkpoint, actor-scoped cursor and provider timestamp are different types.
- Canonical state, tenant-stream change set, domain events, idempotent command
  result and outbox intents commit atomically. Notify is wake-up only.
- Snapshot and SSE/polling close the loss window through a declared manifest and
  resume cursor. Pagination is not a deletion manifest.
- Sidebar, selected timeline and background updates reduce into one normalized
  confirmed graph with revision checks and separate optimistic overlays.
- Retention-aware rebuild uses a tenant-consistent baseline at `N` plus the
  retained tail `> N`; it cannot reconstruct expired content from a pruned
  prefix.

### Authorization and lifecycle

- Authority is default deny and conjunctive: active principal, tenant,
  permission, server-derived resource relation and current revision/epoch.
- Queue membership, assignee, collaborator, watcher, Client owner, internal
  participant, source claim and provider owner/admin/member are different
  relations and never substitute for one another.
- Authorization is applied before SQL/projection pagination and counting. A UI
  capability or signed coarse header is not enforcement.
- Immutable technical facts are separated from purgeable PII/content. Every
  storage root has a typed data class, purpose, anchor, subject behavior and
  lifecycle handlers.
- Legal hold is an evaluator blocker, restriction limits processing and RBAC
  controls access. Provider delete, retention expiry and privacy erasure are
  separate workflows and outcomes.

### Deployment and migration

- Shared SaaS, isolated SaaS and on-prem use the same contracts and local data-
  plane lifecycle/authorization behavior. Control-plane stores no customer
  content or privacy-request payload.
- Plan/license state cannot invent authority or retention purpose and cannot
  disable required local read/export/delete/hold evidence operations.
- V1 is compatibility evidence, not a model to port. Migration never infers
  author, route, Client or responsibility from the current scalar row when exact
  history is absent.
- Cutover uses one canonical command/side-effect owner and a server-owned state
  machine. No reset, destructive cascade, provider cohort split or symmetric
  dual-send is inferred from environment labels.

## Explicitly Invalid States

| Invalid state or shortcut                                         | Required rejection/representation                                              | Contract/test owner                             |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------- |
| Conversation requires Client, queue or assignee                   | zero-to-many Client links; WorkItem/Employee state remain separate             | `CON-002/004/006`, `CON-009`                    |
| Client resolution loads all Conversation/tenant lifetime history  | bounded current-link page plus authoritative exact-revision merge paths        | `CON-004`, `DB-002`, `CRM-001`                  |
| Internal chat receives fake Client/WorkItem/provider route        | invalid topology/composition                                                   | `CON-002/005/006/007`                           |
| Current Client/responsible/provider account becomes author        | immutable participant author plus separate app actor/transport sender          | `CON-003/007`                                   |
| Provider membership or source identity claim becomes Hulee access | non-principal evidence; explicit permission/relation required                  | `CON-003`, `RBAC-001/002`                       |
| Thread dedupe uses display name, Client or weak body/time hash    | exact realm/scope descriptor or diagnosable unresolved state                   | `CON-005`, `SRC-005/006`                        |
| Explicit route silently falls back, fans out or changes on retry  | durable zero/one-route outcome; multi-send/reroute is a separate command       | `CON-005`, `MSG-002/007`                        |
| Timestamp/event/outbox order acts as global cursor                | typed sequence/revision/commit/checkpoint/cursor with explicit gap recovery    | `CON-008`, `PRJ-003`, `RT-002`                  |
| Unauthorized rows are filtered after `LIMIT`                      | scoped predicate before pagination/counting                                    | `RBAC-002`, `API-001`, `REP-008`                |
| Hold is configured as an expiry action                            | reject `hold_no_purge`; only `blocked_by_legal_hold` with case/revision/review | `CON-010`, `OPS-006`                            |
| Processing restriction silently extends retention                 | explicit storage-only purpose/condition or ordinary expiry                     | `CON-010`, `OPS-006`                            |
| Raw auth/cookie/session material reaches durable ingress          | pre-persistence sanitizer/quarantine and typed safe diagnostic                 | `SRC-002`, `DMX-004/005`                        |
| One parent purge deletes a still-shared file/object               | detach link; physical deletion after all parents/purposes/holds allow it       | `MSG-003`, `OPS-011`                            |
| Unknown module storage root or missing delete/verify handler      | fail build/activation/upgrade/uninstall closed                                 | `CON-010`, `DB-009`, `EXT-006`, `OPS-005/009`   |
| Internal backup residual is reported as external completion       | bounded-backup-pending or internal-verification-blocked state                  | `CON-010`, `DB-009`, `OPS-007/012`              |
| V1 and V2 both own provider side effects                          | one canonical side-effect owner selected by fenced rollout state               | `MIG-002/004/005`                               |
| Provider/RIK behavior is marked complete without Hulee evidence   | keep automated/live evidence missing or an explicit limitation                 | direct-messenger cell ledger and provider tasks |

## Open Questions And Non-Blocking Boundary

- `PQ-001..PQ-014` own product/delivery decisions and name the downstream
  commercial, extension, deployment or native-client surface they block.
- `DG-001..DG-012` own jurisdiction/compliance decisions and name the production
  profile they block.
- Neither family authorizes implementation-time guesses or weakens the accepted
  tenant, domain, identity, route, authorization, lifecycle or migration
  boundaries.
- `INB2-CON-001` can therefore start stable branded IDs, schema-version envelopes
  and catalog namespaces without inventing owner-specific domain enums. A later
  answer that changes a core invariant requires an ADR plus dependency/
  acceptance impact review before implementation.

## Structural And Verification Evidence

Final evidence on `2026-07-10`:

- all `11` prerequisite Epic 0 `BASE/ARCH` tasks are `done`, dated, have
  non-placeholder evidence and had `11` matching verification-log rows before
  this gate row;
- all `15` ADRs are `Accepted`;
- the backlog has `205/205` unique IDs: `157` task/gate nodes and `48` acceptance
  scenarios; there are `0` duplicate IDs, undefined references, explicit/
  expanded dependency cycles or implementation nodes without an
  `INB2-EPIC-0-GATE` ancestor;
- the decision/invalid-state review maps every accepted area to defined
  downstream owners and its acceptance coverage spans `INB2-ACC-001..048`;
- `PQ-001..014` and `DG-001..012` are unique rows with owner and blocking impact;
- the direct-messenger CSV has `504/504` unique cells across `10` surfaces and
  `105` capabilities, `0` missing required fields/invalid keys and `45/45`
  defined backlog task references;
- parsed local documentation references resolve with `0` missing target; the
  external RIK reference exists and remains non-authoritative;
- independent reviews `epic0_domain_consistency_retry`,
  `epic0_security_ops_retry` and `epic0_backlog_graph_retry` reported no
  remaining P0/P1 after the recorded reconciliations;
- `pnpm check` passed: Prettier, ESLint, TypeScript, `145` Vitest files / `724`
  tests, DB, i18n, encoding, branding and native gates.

## Exit Checklist

- [x] All required Epic 0 tasks are `done` with reproducible evidence.
- [x] ADR 0001 through ADR 0015 are accepted and cross-references resolve.
- [x] Domain/identity/routing/realtime/RBAC/lifecycle/migration decisions have no
      unresolved P0/P1 contradiction.
- [x] Every accepted decision has a downstream task and acceptance scenario or
      an explicitly named later release gate.
- [x] Product/compliance open questions have owners and blocking impact.
- [x] Backlog graph and direct-messenger ledger structural checks pass.
- [x] Independent review reports no unresolved P0/P1.
- [x] `pnpm check` and all repository gates pass.
- [x] Canonical backlog task/evidence and verification log are updated.
