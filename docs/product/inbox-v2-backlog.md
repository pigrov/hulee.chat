# Inbox V2 Architecture Refactor And Delivery Backlog

Status: `active`  
Canonical task tracker: this file  
Last updated: `2026-07-17`

## Purpose

This document is the executable plan for replacing the current Inbox V1
prototype with Inbox V2. It covers the domain refactor, direct messenger
private/group support, stable realtime synchronization, notifications, client
CRM, manager reporting, non-messenger sources, production hardening and V1
cutover.

The detailed status of Inbox V2 work is tracked only here. High-level product
documents may link to this backlog, but must not duplicate task completion
state.

## Required Reading

Before starting any task, read the project instructions and the product/ADR
documents required by `AGENTS.md`. For Inbox V2 work, also read:

- `docs/product/source-integrations.md`;
- `docs/product/quality-gates.md`;
- `docs/adr/0008-source-integration-foundation.md`;
- `docs/product/inbox-v2-baseline.md`;
- `docs/product/inbox-v2-scenarios-and-glossary.md`;
- `docs/adr/0009-inbox-v2-domain-boundaries.md`;
- `docs/adr/0010-inbox-v2-participants-identity-and-authorship.md`;
- `docs/adr/0011-inbox-v2-external-threads-bindings-and-routing.md`;
- `docs/adr/0012-inbox-v2-sequence-revisions-and-realtime-recovery.md`;
- `docs/adr/0013-inbox-v2-responsibility-collaboration-and-rbac.md`;
- `docs/product/inbox-v2-epic-0-architecture-review.md`, the accepted cross-ADR
  architecture gate and implementation-entry guard;
- this backlog;
- `docs/product/inbox-v2-direct-messenger-matrix.md`, the Hulee-owned direct
  messenger matrix created by `INB2-ARCH-008`;
- `docs/product/inbox-v2-direct-messenger-cells.csv`, its canonical per-surface
  capability/evidence/task ledger;
- `docs/product/inbox-v2-data-lifecycle-and-privacy.md` and
  `docs/adr/0015-inbox-v2-data-lifecycle-privacy-and-audit.md`, the approved
  retention, privacy, export/delete, legal-hold and audit policy;
- `docs/product/inbox-v2-migration-and-cutover.md` and
  `docs/adr/0014-inbox-v1-to-v2-migration-cutover.md`, the approved V1/V2
  compatibility, migration, rollback and removal policy;
- `D:/vscode/rik/docs/direct-messenger-feature-matrix.md` only as reference
  evidence and a source of regression scenarios, never as proof that Hulee is
  complete.

## Tracking Rules

### Task states

- `planned`: ready to be selected after dependencies are complete.
- `in_progress`: actively being implemented. Keep at most one task in this
  state per Codex task unless the backlog explicitly allows parallel work.
- `blocked`: cannot proceed; record the concrete blocker and required decision.
- `ready_for_verification`: implementation is complete, but required checks or
  runtime/provider smoke have not all passed.
- `done`: acceptance, verification and evidence are complete.
- `deferred`: intentionally removed from the current release gate with a reason.

### Completion policy

- The leading task checkbox remains `[ ]` until the task state becomes `done`.
- Code complete without required tests is `ready_for_verification`, not `done`.
- Provider-dependent behavior remains `ready_for_verification` until the
  required live smoke is recorded, unless the task explicitly requires only a
  fixture/contract test.
- An epic is complete only after every required task is `done` and the epic
  exit gate has been checked.
- Every listed task is required for `G7` unless it is explicitly changed to
  `deferred` with an approved reason and release-gate impact.
- Existing RIK behavior and existing `[x]` entries in other Hulee backlogs do
  not transfer completion status into this file.
- When a task proves larger than one reviewable delivery, split it in this file
  before implementation and preserve the original acceptance intent.
- Do not mark a task done by deleting or weakening an unverified acceptance
  criterion. Record a blocker or an approved scope decision instead.

### Required task update flow

1. Confirm every dependency is `done`.
2. Change `State` to `in_progress` and record the start date/owner or Codex task.
3. Implement the narrow task, including tests and diagnostics.
4. Run focused checks, then the applicable repository quality gates.
5. Change the state to `ready_for_verification` if any independent/runtime
   evidence is still missing.
6. After verification, fill `Evidence`, change the state to `done`, and only
   then change the leading checkbox to `[x]`.
7. Append a row to the verification log at the end of this file.

### Evidence format

Replace `Evidence: -` with concise, reproducible evidence:

```text
Evidence: changes <commit/PR or file list>; tests <commands and result>;
runtime <fixture/E2E/smoke reference>; verified <person/Codex task and date>.
```

For a docs-only decision, evidence must name the reviewed ADR/docs and the
consistency check. For a migration, include fresh-database and upgrade-path
results. For provider behavior, include provider/account surface and scenario,
without secrets or customer payloads.

## Definition Of Ready

A task is ready when:

- its dependencies are `done`;
- the intended domain owner and package/application boundary are known;
- acceptance criteria do not rely on an unresolved product decision;
- tenant, permission, event and diagnostics implications are identified;
- provider-specific behavior has a fixture, documented observation or an
  explicit discovery subtask;
- the task can be verified independently.

## Definition Of Done

Unless a task narrows the gate explicitly, `done` requires:

- versioned contracts for public/module/event/realtime boundaries;
- tenant scope in tables, queries, commands, events, jobs and storage keys;
- no provider-specific branch in core when an adapter capability can express
  the difference;
- unit tests for business rules and contract tests for adapters/mappers;
- migration and repository tests for persistence changes;
- stable error codes, diagnostics and audit events for important failures;
- i18n dictionaries, design tokens and approved UI slots for UI work;
- focused checks followed by `pnpm check`;
- required integration/E2E/provider smoke evidence;
- updated documentation and verification log.

## Target Architecture Baseline

These are the defaults the implementation plan is built around. Changing one
requires an ADR update and backlog impact review.

- Inbox is a read model/UI shell, not one domain aggregate.
- `Conversation`, canonical `ExternalThread`, `SourceThreadBinding`, `WorkItem`,
  Client CRM and per-employee conversation state are separate concerns.
- A conversation can have zero, one or many linked clients and employees.
- Unknown external identities are first-class participants and can be linked
  later without rewriting message history.
- Internal direct/group chats require neither a client nor a WorkItem.
- An actionable external WorkItem is queue-owned and unassigned in `new`; atomic
  claim/assignment enters an owned state, whose active processing has exactly
  one effective primary responsible employee outside the fenced recovery overlay.
- Client owner, WorkItem responsible, conversation member and notification
  watcher are different roles.
- Cross-channel threads of the same client remain separate conversations; the
  client profile aggregates them.
- The same provider group visible through several company accounts is one
  canonical external thread when the adapter declares provider-scoped identity.
- Normal send has exactly one outbound route. Reply inherits the source route.
  Multi-send is a separate explicit command.
- Internal notes are `staff_only` and can never create provider delivery.
- Timeline order uses a server-assigned monotonic conversation sequence;
  provider timestamps are retained separately.
- Employee read cursor and provider delivery/read receipts are separate models.
- Snapshot, HTTP mutations, SSE and polling use one versioned event/reducer
  contract.
- Timeline sequence, entity revision, tenant commit position, projection
  checkpoint and actor-scoped client cursor are independent values; timestamps,
  event IDs and outbox order cannot substitute for them.
- Canonical state, one immutable tenant-stream change set, domain events,
  idempotent command result and outbox intents commit atomically. PostgreSQL
  notify is a wake-up only.
- PostgreSQL, transactional outbox and SSE remain the initial architecture.
  A broker or separate realtime service is introduced only after measured need.
- Authority is server-derived and relation-scoped. Provider membership, role
  names, identity claims, authorship, watcher state and Client linkage never
  create Hulee access implicitly.
- Immutable sequence/authorship/route facts use purgeable content/evidence
  boundaries. Retention is per data class and purpose; legal hold, restriction,
  RBAC, provider delete and privacy erasure are distinct.
- Data-storing modules declare typed lifecycle/lineage/export/delete handlers and
  fail closed when a storage root or compatible handler is missing.
- V1 disposition is explicit: `INB2-MIG-001` rejected the conditional
  pre-production fast path and selected preserve. Additive backfill, shadow,
  rollback and observation gates are active before the internal V1
  implementation can be removed. Contract versioning remains independent of
  legacy implementation compatibility.
- Provider access models and capability/evidence are surface-specific. Consumer
  QR/web/desktop access is never treated as a supported programmable connector
  without approved transport and current evidence.

## Non-Goals Of The Refactor

- Porting RIK conversation service or inbox frontend architecture.
- Merging all client channels into one physical message stream.
- Giving internal chats fake clients, queues or responsible operators.
- Modeling calls, reviews and marketplace objects as text-only messages.
- Introducing Kafka, microservices or mandatory Redis before the PostgreSQL
  design is measured and proven insufficient.
- Migrating RIK production data into Hulee.

## Release Gates And Critical Path

| Gate                                 | Required epics                          | Outcome                                                                  |
| ------------------------------------ | --------------------------------------- | ------------------------------------------------------------------------ |
| `G0 Architecture Ready`              | Epic 0                                  | Decisions, glossary, matrix and migration strategy are reviewable.       |
| `G1 Domain Foundation`               | Epics 1-2                               | Versioned contracts and tenant-safe schema enforce core invariants.      |
| `G2 Telegram Vertical Slice`         | Epics 3-5 plus Telegram tasks in Epic 8 | Private/group messages reach a correct conversation and WorkItem.        |
| `G3 Stable Inbox Client`             | Epics 6-7                               | Sidebar and active timeline share revisioned normalized state.           |
| `G4 Operational Product`             | Epics 8-10                              | Direct providers, notifications and client CRM work end to end.          |
| `G5 Management And Source Readiness` | Epics 11-12                             | Metrics are correct and non-chat sources fit without messenger branches. |
| `G6 Production Readiness`            | Epic 13                                 | Capacity, security, resilience and on-prem behavior are verified.        |
| `G7 V2 Cutover`                      | Epic 14 and cross-epic acceptance       | V2 is the only production path and V1 removal is safe.                   |

Critical path:

```text
architecture
  -> contracts
  -> database
  -> source resolution + messages + work items
  -> projections/API/realtime
  -> normalized app-shell/UI
  -> Telegram V2 vertical slice
  -> preserve upgrade/backfill + fenced V2 cutover
  -> WA/MAX provider parity + notifications + CRM
  -> reporting + operational hardening
  -> V2-only production release / G7
```

## Epic 0. Baseline And Architecture Decisions

Goal: freeze the boundaries and verification contract before changing schema or
expanding Inbox V1.

- [x] `INB2-BASE-001` Record the verified Inbox V1 baseline.
  - State: `done`; Priority: `P0`; Depends on: none.
  - Started: `2026-07-10`; Completed: `2026-07-10`; Owner: `Codex`.
  - Acceptance: inventory current contracts, schema, API, worker composition,
    UI flow, tests and known limitations; record a clean `pnpm check` baseline.
  - Verification: another reader can locate every referenced implementation and
    reproduce the baseline checks.
  - Evidence: `docs/product/inbox-v2-baseline.md`; targeted 13 files/103 tests;
    `pnpm check` passed 145 files/724 tests plus all repository gates; reviewed
    by `baseline_verify` and Codex on `2026-07-10`.

- [x] `INB2-ARCH-001` Approve the Inbox V2 glossary and scenario matrix.
  - State: `done`; Priority: `P0`; Depends on: `INB2-BASE-001`.
  - Started: `2026-07-10`; Completed: `2026-07-10`; Owner: `Codex`.
  - Acceptance: define external/internal direct/group, employee-only external
    group, support/intake, client/contact/external identity, WorkItem and
    non-chat source scenarios, including valid zero-to-many relationships.
  - Verification: requirements examples cover private, multi-client group and
    clientless employee chats without contradictory invariants.
  - Evidence: `docs/product/inbox-v2-scenarios-and-glossary.md` and updated
    `docs/product/requirements.md`; independently reviewed by
    `scenario_glossary`; formatting and full `pnpm check` passed on `2026-07-10`.

- [x] `INB2-ARCH-002` Add ADR for Conversation, WorkItem, CRM and user-state boundaries.
  - State: `done`; Priority: `P0`; Depends on: `INB2-ARCH-001`.
  - Started: `2026-07-10`; Completed: `2026-07-10`; Owner: `Codex`.
  - Acceptance: document aggregate ownership, lifecycle and events; move intake,
    queue, responsible and SLA out of the Conversation identity model.
  - Verification: ADR is consistent with source, tenant, client-app and
    control/data-plane documents.
  - Evidence: `docs/adr/0009-inbox-v2-domain-boundaries.md`; independently
    reviewed by `domain_adr_review` against ADR 0001-0008; WorkItem cardinality
    gap was added to `INB2-DB-004`/`INB2-WRK-001`; full `pnpm check` passed on
    `2026-07-10`.

- [x] `INB2-ARCH-003` Add ADR for participants, identity and message authorship.
  - State: `done`; Priority: `P0`; Depends on: `INB2-ARCH-001`.
  - Started: `2026-07-10`; Completed: `2026-07-10`; Owner: `Codex`.
  - Acceptance: distinguish Employee, Client, ClientContact, ExternalIdentity,
    ConversationParticipant, app author and transport sender; define link/merge
    and authorization boundaries.
  - Verification: unknown-to-client and external-employee scenarios preserve
    original authorship and do not grant app access implicitly.
  - Evidence: `docs/adr/0010-inbox-v2-participants-identity-and-authorship.md`,
    glossary/requirements/backlog consistency updates and current-code audit;
    independently reviewed by `participant_adr_model`,
    `participant_adr_review`, `identity_baseline_audit` and
    `adr0010_consistency`; full `pnpm check` passed 145 files/724 tests plus all
    repository gates on `2026-07-10`.

- [x] `INB2-ARCH-004` Add ADR for canonical external threads and outbound routing.
  - State: `done`; Priority: `P0`; Depends on: `INB2-ARCH-003`.
  - Started: `2026-07-10`; Completed: `2026-07-10`; Owner: `Codex`.
  - Acceptance: define provider/account identity scopes, multi-account group
    dedupe, binding lifecycle and exactly-one-route send/reply policy.
  - Verification: examples cover one Telegram group seen by two accounts and
    account-scoped private chats without accidental merge or fan-out.
  - Evidence: `docs/adr/0011-inbox-v2-external-threads-bindings-and-routing.md`
    plus glossary/source requirements and downstream backlog updates; current
    Hulee code and RIK matrix/runtime lessons independently reviewed by
    `arch004_hulee_audit` and `arch004_rik_matrix`; full `pnpm check` passed 145
    files/724 tests plus all repository gates on `2026-07-10`.

- [x] `INB2-ARCH-005` Add ADR for sequence, revisions and realtime recovery.
  - State: `done`; Priority: `P0`; Depends on: `INB2-ARCH-002`.
  - Started: `2026-07-10`; Completed: `2026-07-10`; Owner: `Codex`.
  - Acceptance: define transaction boundary, conversation sequence, entity
    revision, stream cursor, snapshot handshake, SSE resume and gap recovery.
  - Verification: ADR closes the snapshot-to-SSE loss window and defines how
    stale HTTP/SSE updates are rejected.
  - Evidence: `docs/adr/0012-inbox-v2-sequence-revisions-and-realtime-recovery.md`
    plus glossary/requirements/client/source and downstream backlog updates;
    current Hulee and all identified RIK synchronization failure modes reviewed
    independently by `arch004_hulee_audit`, `arch004_rik_matrix` and
    `participant_adr_model`; full `pnpm check` passed 145 files/724 tests plus
    all repository gates on `2026-07-10`.

- [x] `INB2-ARCH-006` Approve the responsibility and RBAC matrix.
  - State: `done`; Priority: `P0`; Depends on: `INB2-ARCH-002`.
  - Started: `2026-07-10`; Completed: `2026-07-10`; Owner: `Codex`.
  - Acceptance: define queue membership, primary responsible, supervisor
    override, collaborators/watchers, external reply, internal note, CRM edit
    and report/drilldown permissions; separate Employee/ClientContact identity
    claim and participant-management permissions cannot be inferred from
    provider membership or a claim target.
  - Verification: concurrent WorkItem/identity claims, claim-to-self denial,
    employee deactivation, report PII drilldown and internal-chat cases have
    explicit authorized outcomes.
  - Evidence: `docs/adr/0013-inbox-v2-responsibility-collaboration-and-rbac.md`
    plus ADR 0009/0012, requirements/glossary/RBAC guidance and executable
    downstream backlog updates; current Hulee audit found and routed 5 P0/5 P1
    gaps; security/product/consistency reviews reported no remaining P0/P1;
    184 unique tasks, 36 ACC scenarios, 0 undefined dependencies/cycles; full
    `pnpm check` passed 145 files/724 tests and all repository gates on
    `2026-07-10`.

- [x] `INB2-ARCH-007` Decide retention, PII, export/delete and audit policy.
  - State: `done`; Priority: `P0`; Depends on: `INB2-ARCH-003`.
  - Started: `2026-07-10`; Completed: `2026-07-10`; Owner: `Codex`.
  - Acceptance: cover raw events, normalized events, messages, attachments,
    provider payloads, transcripts, notifications, analytics facts and audit.
  - Verification: unresolved legal/product choices are added to
    `open-questions.md` with an owner/blocking impact.
  - Evidence: ADR 0015 plus the detailed lifecycle/privacy policy define 58
    unique provider-neutral core data classes, typed temporal/governance policy,
    hold/restriction, multi-subject export/erasure, shared-parent deletion,
    residual/backup/restore, projection-bootstrap and finite audit semantics;
    `DG-001..012` have named owners/blocking impact. Current schema/storage audit
    was routed into executable contracts/persistence/operations/admin tasks;
    compliance, code/storage and domain reviews reported READY with no remaining
    P0/P1. Backlog has 205 unique IDs, 48 acceptance scenarios, 0 duplicate/
    undefined references or explicit cycles; full `pnpm check` passed 145 files/
    724 tests plus all repository gates on `2026-07-10`.

- [x] `INB2-ARCH-008` Create the Hulee Inbox V2 direct messenger matrix.
  - State: `done`; Priority: `P0`; Depends on: `INB2-ARCH-001`, `INB2-ARCH-004`.
  - Started: `2026-07-10`; Completed: `2026-07-10`; Owner: `Codex`.
  - Acceptance: matrix has WA/TG/MAX private and group surfaces, automated/live
    evidence columns, task links, provider limitations, roster, multi-account,
    history, echo/out-of-band, media, lifecycle, receipts and health rows.
  - Verification: every relevant RIK matrix row is mapped, but no RIK `OK`
    status is copied as Hulee completion. Evidence: readable matrix plus `504`
    canonical cells across `10` surfaces/`105` capabilities; `44/44` RIK rows
    and `14/14` revisions mapped; focused direct-account suite `10/62`; full
    `pnpm check` `145/724` plus all repository gates; independent reviews by
    `matrix_design_review`, `rik_matrix_mapping` and `hulee_direct_evidence`.

- [x] `INB2-ARCH-009` Approve the Inbox V1 to V2 migration/cutover strategy.
  - State: `done`; Priority: `P0`; Depends on: `INB2-BASE-001`, `INB2-ARCH-005`.
  - Started: `2026-07-10`; Completed: `2026-07-10`; Owner: `Codex`.
  - Acceptance: decide backfill versus reset for each environment, compatibility
    window, shadow comparison, feature flags, rollback and V1 deletion criteria.
  - Verification: strategy is safe for fresh install, current dev data and any
    known production/on-prem deployments. Evidence: ADR 0014 and the detailed
    migration/cutover strategy; read-only current V1/outbox snapshot; four
    independent code/deployment/strategy/graph reviews; full `pnpm check`
    (`145/724`) and all repository gates. Amended `2026-07-11` after the product
    owner confirmed pre-production status: direct replacement is selected only
    after `INB2-MIG-001` proves no deployment/consumer/valuable-data obligation;
    otherwise the original preserve path remains mandatory. `INB2-MIG-001`
    completed on `2026-07-16` and selected preserve after finding a live shared
    SaaS deployment, V1/provider/object/backup state and unknown fleet/consumer
    roots.

- [x] `INB2-ARCH-010` Record messenger access models and provider evidence policy.
  - State: `done`; Priority: `P1`; Depends on:
    `INB2-ARCH-001`, `INB2-ARCH-004`.
  - Started: `2026-07-10`; Completed: `2026-07-10`; Owner: `Codex`.
  - Acceptance: define personal-session, official-business,
    phone-addressed-business, workspace/community and archive access models;
    record Viber, WeChat/WeCom and imo as separate provider surfaces with
    `supported`, `commercial_approval`, `partner_required`, `unsupported` or
    `research` status; consumer web/desktop QR login is never treated as an API;
    every conclusion has an official evidence entry point and last-verified
    date.
  - Verification: independent link and consistency review confirms that no
    provider-wide capability is inferred from one surface, Viber QR bridge is
    not advertised and the decisions require no provider branch in core.
  - Evidence: `docs/product/messenger-integration-landscape.md` and
    `docs/product/source-integrations.md`; 31 unique official/developer links
    resolved, independent Viber/code/document reviews passed, 185 task IDs have
    no duplicates and full `pnpm check` passed 145 files/724 tests plus all
    repository gates on `2026-07-10`.

- [x] `INB2-EPIC-0-GATE` Verify Epic 0 exit gate.
  - State: `done`; Priority: `P0`; Depends on: all required Epic 0 tasks.
  - Started: `2026-07-10`; Completed: `2026-07-10`; Owner: `Codex`.
  - Acceptance: invalid states and product decisions are explicit enough to
    start versioned contracts without assumptions.
  - Verification: architecture review recorded in the verification log.
  - Evidence: `docs/product/inbox-v2-epic-0-architecture-review.md`; all 15 ADRs
    accepted; 11 prerequisite Epic 0 tasks have dated evidence; 205 unique IDs/
    48 acceptance scenarios with no duplicate, undefined, cyclic or ungated
    implementation node; 504 unique direct-messenger cells/10 surfaces/105
    capabilities with 45 defined task refs; `PQ-001..014` and `DG-001..012` have
    owners/blocking impact. Domain, security/operations and backlog/coverage
    reviews reported READY with no remaining P0/P1; full `pnpm check` passed 145
    files/724 tests plus every repository gate on `2026-07-10`.

## Epic 1. Versioned Contracts And Domain Core

Goal: make the target model executable in memory before persistence/provider
implementation.

- [x] `INB2-CON-001` Add Inbox V2 IDs, catalog namespaces and schema-version primitives.
  - State: `done`; Priority: `P0`; Depends on: `INB2-EPIC-0-GATE`.
  - Started: `2026-07-11`; Completed: `2026-07-11`; Owner: `Codex`.
  - Acceptance: `packages/contracts/src/inbox-v2/` exports branded tenant and V2
    entity/reference IDs, schema-version envelopes and namespaced catalog-ID/
    registration primitives for later principal, permission, scope/relation and
    error catalogs. It does not define owner-specific Conversation, WorkItem,
    Client pipeline, delivery, source-health or privacy enum values; ownership is
    the authoritative State Namespace table in the glossary.
  - Verification: Zod/type fixtures reject cross-kind ID substitution, missing
    tenant scope, invalid/unknown schema versions, reserved/unnamespaced catalog
    IDs and an attempted closed Client-stage enum. Public exports import no app,
    DB, core implementation or provider module.
  - Evidence: changes `packages/contracts/src/brand.ts`, `base-ids.ts`, root
    `index.ts` and `packages/contracts/src/inbox-v2/`; focused 4 files/28 tests,
    all contracts 15 files/103 tests and full `pnpm check` 149 files/752 tests
    plus all repository gates passed. Independent `con001_design_review`,
    `con001_contract_audit` and `con001_consumer_audit` re-reviews reported
    READY with no remaining P0/P1 on `2026-07-11`.

- [x] `INB2-CON-002` Implement Conversation V2 contract and invariants.
  - State: `done`; Priority: `P0`; Depends on: `INB2-CON-001`.
  - Started: `2026-07-11`; Completed: `2026-07-11`; Owner: `Codex`.
  - Acceptance: topology, transport/purpose, closed `active|ended` lifecycle,
    sequence and revision do not require a client, queue, assignee or provider
    field; per-Employee archive/hide is never a Conversation lifecycle value.
  - Verification: unit matrix covers external/internal direct/group and invalid
    combinations. Evidence: additive strict/versioned Conversation contract,
    namespaced purpose IDs, explicit revisioned end/reactivate transitions,
    bounded decimal-string sequence/revision brands and ownership/type fixtures
    in `packages/contracts/src/inbox-v2/`; focused Inbox V2 `5/97`, V1
    compatibility `9/91`, full `pnpm check` `150/821` plus all gates; three
    independent re-reviews READY with no remaining P0/P1 on `2026-07-11`.

- [x] `INB2-CON-003` Implement participant and external identity contracts.
  - State: `done`; Priority: `P0`; Depends on: `INB2-CON-001`,
    `INB2-ARCH-003`, `INB2-ARCH-006`.
  - Started: `2026-07-11`; Completed: `2026-07-11`; Owner: `Codex`.
  - Acceptance: auth/source identity namespaces, scoped typed identity
    references, independent membership origins/state/role, provider snapshot
    completeness and temporal Employee-or-ClientContact claims are versioned;
    their permissions are separate, manual Employee self-claim is invalid and
    provider membership/claim never becomes a principal or Hulee membership.
  - Verification: fixtures cover unknown, linked, conflicted, concurrent claim,
    left/removed, dual-origin and external-employee identities without auth or
    membership side effects.
  - Evidence: strict participant/source identity, membership/roster and temporal
    claim/transition/graph contracts in `packages/contracts/src/inbox-v2/`;
    participant matrix `47/47`, focused Inbox V2 `6/144`, final full
    `pnpm check` `151/868` plus every repository gate; independent domain,
    compatibility/security, graph/insertion and V1-cutover re-reviews READY on
    `2026-07-11`.

- [x] `INB2-CON-004` Implement conversation-client link contracts.
  - State: `done`; Priority: `P0`; Depends on: `INB2-CON-003`.
  - Started: `2026-07-11`; Completed: `2026-07-11`; Owner: `Codex`.
  - Acceptance: same-tenant zero-to-many Client links use bounded namespaced
    roles, association confidence, typed provenance/evidence and server-stamped
    decisions. Temporal episodes plus append-only CAS transitions preserve
    unlink/relink history; a revisioned per-Conversation link-set head owns the
    optional explicit primary. Client merge uses one current root/redirect node
    per Client, immutable row-wise events and a tenant CAS head: only different
    exact requested current roots may merge (non-root/stale requests conflict
    rather than silently canonicalizing an alias), maximum inbound component
    depth prevents paths over 64 edges, and a deterministic bounded commit binds
    exact before/after node rows plus tenant head. Authoritative bounded
    resolution batches never load complete tenant or Conversation lifetime
    history. Merge resolution affects current CRM display only and never
    rewrites history or creates access, PII, identity, participant, authorship,
    routing, ownership, responsibility, watcher/collaborator or WorkItem effects.
  - Verification: multi-client groups serialize without inventing one scalar
    `clientId`; concurrent primary handoff, staged non-atomic relink, equal-time
    interval order, stale/reciprocal root merge, 64/65-edge resolution and V1
    legacy-unspecified migration fixtures fail closed. A row-wise merge event at
    revision `10001` remains valid while one resolution request stays bounded.
  - Evidence: strict temporal link/current-page/offline-history contracts plus
    Client merge node/path/batch/redirect/deterministic-commit contracts in
    `packages/contracts/src/inbox-v2/`; deleted tenant/lifetime graph APIs are
    compile- and runtime-rejected; focused link/merge/IDs/public boundary
    `4/68`, full Inbox V2 `8/199`, final `pnpm check` `153/923` plus every
    repository gate passed. Independent domain, scale-design and compatibility/
    performance re-reviews reported READY with no P0/P1 on `2026-07-11`.

- [x] `INB2-CON-005` Implement canonical thread, binding and route contracts.
  - State: `done`; Priority: `P0`; Depends on: `INB2-CON-001`,
    `INB2-ARCH-004`, `INB2-ARCH-006`.
  - Started: `2026-07-11`; Completed: `2026-07-11`; Owner: `Codex`.
  - Acceptance: versioned thread/message realms and scopes, account bindings,
    canonical/provisional SourceAccount identity plus audited direct promotion/
    alias, membership/admin/health axes, capabilities, opaque adapter route
    descriptor, reply portability, fallback intent, independent administrative/
    membership/runtime-health vocabularies and provider references are neutral.
    Provider-wide thread/message scope requires a pinned trusted adapter-contract
    decision; safe default is account/binding scope. Exact SourceAccount use
    authority is a separate server-loaded conjunctive decision, never a caller
    boolean or consequence of Conversation/Client access. Binding and occurrence
    creation use bounded induction commits over their exact mapping/account/
    binding/route authorities; current binding pages are compact heads rather
    than nested capability/evidence aggregates. Provider retry safety is pinned
    before I/O, expired leases become explicit uncertainty, and reconciliation
    is an append-only audited decision before any same-route retry.
  - Verification: contract rules reject unsafe opaque IDs, zero/multiple routes,
    invalid explicit-route fallback, nonportable replies, stale administrative
    authority, same-tenant unrelated occurrence refs, attempt/route mismatch and
    unsafe uncertain retries; explicit multi-send and uncertain send outcome
    remain distinct. Evidence: versioned canonical account/thread/binding/
    occurrence/route/dispatch contracts and type fixtures in
    `packages/contracts/src/inbox-v2/`; full Inbox V2 `15/343`; final repository
    `pnpm check` `160/1067` plus all DB/i18n/encoding/branding/native gates;
    independent domain/security reviews found and closed all P0/P1, followed by
    final cross-slice audit READY on `2026-07-11`.

- [x] `INB2-CON-006` Implement WorkItem, assignment, queue and SLA contracts.
  - State: `done`; Priority: `P0`; Depends on: `INB2-CON-001`, `INB2-ARCH-006`.
  - Started: `2026-07-11`; Completed: `2026-07-11`; Owner: `Codex`.
  - Acceptance: the closed initial state machine is `new`, `assigned`,
    `in_progress`, `waiting`, `resolved`, `dismissed`; queue, atomic claim/
    assignment, one primary, assignment history, explicit temporal servicing-team
    and collaborator relations, watcher reference, target eligibility,
    deactivation fence, priority, SLA and reopen metadata are explicit. `new`
    has zero active primary, the three owned non-terminal states have exactly one
    effective primary outside the recovery overlay, and terminal states close
    active assignment while preserving event-time history.
  - Verification: pure policy tests cover claim races, transfer, close/reopen
    and clientless internal chats. Evidence: versioned WorkItem, Queue,
    eligibility/fence, temporal assignment/relation and auditable SLA contracts,
    branded IDs, public exports and type fixtures in
    `packages/contracts/src/inbox-v2/`; focused contract suite `6/53`, full Inbox
    V2 `19/380`, scoped Prettier/ESLint/isolated strict TypeScript and repository
    format check passed; repository tests `164/1104` plus DB/i18n/encoding/
    branding/native gates passed. Independent P0/P1 audit returned READY on
    `2026-07-11`. Repository-wide lint/typecheck remain blocked outside this task
    by concurrent landing-site edits in `apps/site/app/[locale]/`.

- [x] `INB2-CON-007` Implement typed timeline and message lifecycle contracts.
  - State: `done`; Priority: `P0`; Depends on: `INB2-CON-002`,
    `INB2-CON-003`, `INB2-ARCH-006`.
  - Started: `2026-07-11`; Completed: `2026-07-11`; Owner: `Codex`.
  - Acceptance: discriminated timeline items, content blocks, immutable
    participant author, trusted app actor, automation causation, transport
    sender, visibility, reply/forward, revisions, reactions and provider-honest
    delivery/receipt vocabularies are versioned without synthesizing unsupported
    states; external reply, internal send and staff-note
    read/create remain distinct commands and visibility contracts. Provider
    delete, privacy erasure, retention purge and their tombstones are not one
    overloaded lifecycle state.
  - Verification: app send/provider echo/native outbound, message, internal
    note, call, review and system fixtures preserve distinct actors and cannot
    be confused or silently reduced to text. Evidence: versioned Message,
    StaffNote, typed TimelineItem/source-object creation, content/revision,
    provider lifecycle, reaction, transport/receipt, deferred source-action,
    semantic-proof/ordering and exact reference contracts in
    `packages/contracts/src/inbox-v2/`; generic Timeline allocation remains an
    internal primitive and Message transport/reaction facts do not mutate the
    Message/Timeline hot rows. Provider-honest fixtures cover app/provider actor
    separation, terminal reaction outcomes, exact/partial/opaque observed
    forwards, reply/forward target proofs, retain-local delete, offset-safe
    policy chronology, 32-target bounded forward evidence and cross-account
    direct-messenger echoes. Focused Inbox V2 suite `28/479`, repository suite
    `173/1203`, TypeScript, scoped ESLint/Prettier, DB, i18n, encoding, branding
    and native gates passed on `2026-07-11`; two independent final P0/P1 audits
    returned `READY`. Repository-wide lint remains blocked outside this task by
    three unused icon imports in the concurrent untracked landing component
    `apps/site/app/[locale]/calculator-section.tsx`.

- [x] `INB2-CON-008` Implement Inbox V2 commands, events and realtime envelopes.
  - State: `done`; Priority: `P0`; Depends on: `INB2-CON-002` through `INB2-CON-007`.
  - Started: `2026-07-11`; Completed: `2026-07-11`; Owner: `Codex`.
  - Acceptance: idempotent commands, immutable tenant commits/domain events and
    recipient sync batches separately model timeline sequence, entity revision,
    stream cursor/checkpoint, tombstone/invalidate, `scannedThrough`, schema/
    scope/composite authorization epoch, authorization-decision references and mutation/commit
    correlation; bigint is never a JS number. Access-affecting changes can
    invalidate old/new recipients before another unauthorized payload.
  - Verification: backward/forward parsing, hidden-range checkpoint,
    equal-revision conflict and same-mutation/different-request fixtures pass
    without provider-specific event types in core. Evidence: generic closed
    client/authorized-command, exact principal/resource/temporal authorization,
    idempotency/result, immutable atomic tenant commit/change/event/outbox,
    projection-version and recipient snapshot/delta/SSE contracts in
    `packages/contracts/src/inbox-v2/`; route/SourceAccount, WorkItem
    responsibility/override, native-forward source, ready-file parent,
    staff-note/internal boundary and message/reaction target proofs are checked
    conjunctively. Recipient sync is split into cursor, projection,
    wire-contract, application, hash and bounded-JSON modules. The server factory
    composes the client-only V2 wire façade and separately validates exact rich
    authorization evidence for batches, manifests/entities and scope transitions;
    ready/heartbeat emission requires fresh authorization, while no decision
    references, decoded claims, dependency vectors, resolver metadata or
    fingerprint keys enter wire values. Snapshot definition/coverage/page-chain
    commitments, final-only resume, later fresh delta authorization, old-cursor
    scope-transition purge and the 4,096-change/4 MiB bounds have adversarial
    fixtures. Active upserts use tenant/purpose/key-generation HMAC state
    fingerprints; frozen V1 command-result, atomic-commit, sync-batch, snapshot,
    realtime, projection and index-scope behavior remains independently parsed.
    Targeted sync suite `10/81`, full Inbox V2 suite `40/578`, repository suite
    `185/1302`, TypeScript, repository format, scoped ESLint, DB, i18n, encoding,
    branding and native gates passed on `2026-07-11`; two independent final P0/P1
    audits returned `READY`. Repository-wide lint remains blocked outside this
    task only by three unused icon imports in the concurrent untracked landing
    component `apps/site/app/[locale]/calculator-section.tsx`.

- [x] `INB2-CON-010` Implement data lifecycle, privacy, hold, export/delete and audit contracts.
  - State: `done`; Priority: `P0`; Depends on: `INB2-CON-008`,
    `INB2-ARCH-007`.
  - Started: `2026-07-11`; Completed: `2026-07-12`; Owner: `Codex`.
  - Acceptance: ADR 0015 data classes/sensitivity, purpose/role, canonical
    retention anchor, versioned policy resolution, subject links/discovery,
    restriction, legal hold, request/decision, export artifact, deletion run/
    handler/external residual and typed safe audit/evidence envelopes are
    provider/deployment neutral. A versioned `DataGovernanceContext` explicitly
    carries deployment profile, jurisdiction/legal-role vocabularies, residency/
    cross-border routes, industry/request-SLA profile and policy revision without
    inferring them from plan, IP or provider payload. A closed storage-root/data-
    class registry covers SQL, JSON/blob, object, index/cache, log/trace, backup
    and external routes, and module manifests declare compatible lineage plus
    lifecycle/export/delete handlers. Effective tenant policies and destructive
    plans require `tenantId`; global deployment templates/safety envelopes are
    distinct and non-executable. Recipient-state HMAC key generations have a
    finite tenant/purpose lifecycle: a persisted fingerprint is immutable for its
    entity revision, historical keys remain verifiable only through replay
    eligibility, and rekey/retirement requires a new revision or an atomic
    `syncGeneration` cutover with authoritative reset.
    Secrets are not hold/export eligible; `blocked_by_legal_hold` is an evaluator
    outcome requiring `holdId`, hold revision and `reviewAt`, while
    `hold_no_purge` is invalid persisted/config input rather than an expiry action.
    A processing restriction alone cannot extend retention or bypass a legal
    maximum. Request/delete result taxonomy distinguishes
    `completed_with_external_residuals` only for copies outside the operated data
    plane, `primary_purged_backup_expiry_pending` for proven primary purge with a
    bounded internal backup/version tail, and `verification_blocked_internal_residual`
    for any other operated copy or missing internal verification.
  - Verification: pure policy fixtures cover several purposes/deadlines,
    plan-versus-legal precedence, mixed-subject group, hold/restriction,
    pseudonymous-versus-anonymous result, distinct EU/Russian role vocabularies
    and provider/internal/backup residual classification; missing/mismatched
    governance context, tenant-less effective/destructive policy, any persisted/
    configured `hold_no_purge`, a
    hold outcome without current `holdId`/revision/review, restriction with no
    continuing purpose, unknown storage root/class and missing/incompatible module
    handler plus other forever configurations are rejected. Fingerprint key-ring
    expiry and rekey fixtures reject unverifiable retained revisions and in-place
    fingerprint replacement. Evidence: provider-neutral lifecycle/privacy,
    governance, registry, policy activation, subject discovery, hold/restriction,
    tenant-termination scope, export/download, deletion and safe-audit contracts
    are implemented under `packages/contracts/src/inbox-v2`; ADR 0015 and the
    detailed lifecycle/privacy policy record their executable invariants. The
    final critical suite passed `5/60`, the Inbox V2 + module suite passed
    `59/724`, and the full repository suite passed `199/1425` on `2026-07-12`.
    TypeScript, repository format, scoped ESLint, DB, i18n, encoding, branding
    and native gates passed; two independent latest-tree P0/P1 audits returned
    `READY`. Repository-wide lint remains blocked outside this task only by the
    three pre-existing unused icon imports `ArrowRight`, `Bot` and `FileText` in
    the concurrent untracked landing component
    `apps/site/app/[locale]/calculator-section.tsx`.

- [x] `INB2-CON-011` Extract the generic authorized-command transaction coordinator.
  - State: `done`; Priority: `P0`; Started: `2026-07-16`;
    Completed: `2026-07-16`; Owner: `Codex`; Depends on: `INB2-CON-008`,
    `INB2-RBAC-003`.
  - Acceptance: the command claim, same-transaction authorization/revision/
    temporal fence, tenant-stream commit, domain event, outbox, audit and final
    idempotency result currently embedded in the authorization-relation writer
    are exposed through one provider-neutral coordinator. It accepts the exact
    `InboxV2CommandRequestIdentity`, principal, full authorization epoch snapshot
    and decision references, expected revisions and a DB-only domain mutation
    callback over the coordinator-owned executor; relation writes remain a thin
    wrapper over the same protocol. Equal tenant/principal/command/
    `clientMutationId` plus equal request hash returns the canonical
    `already_applied` result without re-running the domain callback; a different
    hash conflicts. DB-clock `notAfter`, epoch/relation/revision changes and
    malformed evidence fail before the callback, and serialization retry may
    repeat only the DB callback, never provider I/O. The coordinator stores no
    plaintext credential or one-time response and supports only a non-sensitive
    replay result/reference.
  - Verification: unit and live PostgreSQL concurrency/failure fixtures cover
    same-hash replay, different-hash conflict, independent tenant/principal
    scopes, revocation or expiry after preflight, rollback with no command/
    stream/domain residue, serialization retry, exact command/change/event
    correlation and no one-time-secret redisclosure. Evidence: the generic
    `createSqlInboxV2AuthorizedCommandCoordinator` now owns command claim,
    authorization/revision/temporal fences, tenant-stream commit, domain events,
    outbox, audit, final idempotency result and retry loop; the authorization
    repository is a thin wrapper over the coordinator. `InboxV2CommandRequestIdentity`
    is exported from contracts and the coordinator command claim is typed from
    that exact request identity without duplicating the schema. Focused unit and
    contract suites passed `46/46`, TypeScript passed, scoped Prettier and ESLint
    passed, skip-mode integration passed `1/23` with `22` opt-in tests skipped,
    and a clean disposable PostgreSQL database on `hulee-postgres` passed the
    live authorization repository fixture `23/23` after applying `40` migrations
    on `2026-07-16`.

- [x] `INB2-RBAC-001` Implement the versioned Inbox V2 permission/scope catalog.
  - State: `done`; Priority: `P0`; Started: `2026-07-12`;
    Completed: `2026-07-12`; Owner: `Codex`; Depends on: `INB2-CON-001`,
    `INB2-CON-010`, `INB2-ARCH-006`.
  - Acceptance: ADR 0013 permission families, legal structural/relation scopes,
    exact/subtree org semantics, internal/break-glass, notification, file,
    source/non-chat, CRM-sensitive, report-workforce, privacy policy/request,
    subject evidence, hold/release, tenant export, deletion preview/approval/
    execution and privacy audit families plus V1 compatibility mappings are executable; `assigned`/
    `own` cannot satisfy new V2 relation permissions.
  - Verification: generated catalog tests reject illegal scope/action pairs,
    Client-to-Conversation propagation and provider/claim authority. Evidence:
    the immutable CON-001 registrations contain the exact 101-permission/12-scope
    ADR matrix, typed tenant-bound scopes, executable guard profiles and
    conservative V1 mappings; the focused suite passed `13/13`, the full suite
    passed `200/1438`, and TypeScript, repository format, scoped ESLint, DB,
    i18n, encoding, branding and native gates passed on `2026-07-12`. Two
    independent latest-tree architecture/security audits returned `READY`.
    Repository-wide lint remains blocked outside this task only by the three
    pre-existing unused icon imports in
    `apps/site/app/[locale]/calculator-section.tsx`.

- [x] `INB2-RBAC-002` Implement the pure Inbox V2 authorization policy.
  - State: `done`; Priority: `P0`; Started: `2026-07-12`;
    Completed: `2026-07-13`; Owner: `Codex`; Depends on: `INB2-RBAC-001`,
    `INB2-CON-002` through `INB2-CON-007`.
  - Acceptance: one server-oriented policy evaluates active principal, tenant,
    effective grants, canonical primary/collaborator/internal/client/source
    relations, exact structural relationship paths, secondary resources,
    external-reply state/policy, entity/composite authorization revisions and
    temporal `nextAuthorizationBoundary` plus hard boundaries; capabilities are
    derived output, not enforcement input and expire at that boundary. Privacy
    policy/request/evidence, hold issue/release, tenant export and deletion
    preview/approval/execute scopes are distinct, target-scoped and never imply
    content read or provider-delete authority.
  - Verification: generated principal x permission x scope x relation x state
    matrix covers responsibility, internal privacy, staff note, multi-client,
    claims, route, aggregate/drilldown and lifecycle case/root/hold/export/delete
    outcomes, including separation-of-duties and hidden-target denial. Evidence:
    the pure server policy and 101-permission catalog close exact Client,
    Conversation, WorkItem, SourceAccount, route, responsibility, internal,
    privacy and privileged-mutation relations with keyed revision/TTL fences and
    output-only capabilities. The focused suite passed `10/585`; the full suite
    passed `209/2010`; TypeScript, repository format, scoped ESLint, DB, i18n,
    encoding, branding and native gates passed on `2026-07-13`. Two independent
    immutable-snapshot recovery audits returned `READY` for policy SHA
    `774FA08B91818D75BC3FFE57DC6728008A6C4E40CEBEDB61DCFE671FD84A41FD`.
    Repository-wide lint remains blocked outside this task only by the three
    pre-existing unused icon imports in
    `apps/site/app/[locale]/calculator-section.tsx`.

- [x] `INB2-RBAC-005` Remove permission-only admin and audit enforcement.
  - State: `done`; Priority: `P0`; Started: `2026-07-13`;
    Completed: `2026-07-13`; Owner: `Codex`; Depends on: `INB2-RBAC-001`.
  - Acceptance: Employee lifecycle, org/team/Queue management and audit queries
    use target-scoped server-loaded resource decisions; web/API code cannot use
    permission presence or signed coarse permission headers as enforcement.
  - Verification: scoped `employees.manage`, `roles.manage` and `audit.view`
    positive/negative tests prove no tenant-wide mutation/read/email leak, while
    tenant-scoped admins retain intended operations. Evidence: employee
    directory/profile/lifecycle/membership, org/Team/Queue, RBAC and audit paths
    now authorize server-loaded actor, target, source and destination resources;
    scoped directory SQL filters rows before employee email materialization.
    Invitations and deactivation remain tenant-only. Membership changes inspect
    active and scheduled group bindings, enforce destination management and the
    complete delegated-permission ceiling on additions, allow safe permission
    reduction on removals and reject self/hidden/unknown targets without writes,
    audit or revalidation. Audit facets retain the target/source/destination and
    owning-org union while SQL redaction hides foreign-side identifiers. RBAC and
    access-decision routes require `service_effective_access`; signed coarse
    permission headers are never enforcement input. The focused integration
    suite passed `21/284`; the full suite passed `217/2150` with four workers;
    TypeScript, formatting, scoped ESLint, DB, i18n, encoding, branding, native
    and diff gates passed on `2026-07-13`. Independent employee and final
    security audits returned `READY` with no P0/P1 findings. Repository-wide lint
    remains blocked outside this task only by three pre-existing unused icon
    imports in `apps/site/app/[locale]/calculator-section.tsx`. Transactional
    membership-write/audit fencing remains owned by `INB2-RBAC-003`; directory
    pagination/access-plan optimization remains owned by `INB2-DB-007`.

- [x] `INB2-CON-009` Build the in-memory Inbox V2 domain scenario suite.
  - State: `done`; Priority: `P0`; Started: `2026-07-13`;
    Completed: `2026-07-13`; Owner: `Codex`; Depends on: `INB2-CON-008`,
    `INB2-CON-010`, `INB2-RBAC-002`.
  - Acceptance: commands exercise unknown private sender, multi-client group,
    internal chats, assignment/override, claim-and-reply, staff note, identity
    claim, message lifecycle and lifecycle-policy/hold/export/delete decisions
    through the authorization policy.
  - Verification: focused unit suite proves invariants without DB or provider
    implementation. Evidence: the immutable test-only `@hulee/testing` runner
    composes real versioned contract schemas, the pure Inbox V2 authorization
    policy, idempotency/replay authorization, contiguous CAS, revisioned
    tombstones and atomic tenant-stream commit/event/outbox contracts. External
    scenarios cover an unknown private sender, distinct scoped identities in a
    multi-client group, one responsible Employee, reasoned override, atomic
    claim-and-reply, immutable Message -> OutboundRoute -> Dispatch routing,
    provider-outbox exactness, staff notes, identity claim and edit/local-delete
    lifecycle. Internal scenarios cover direct/group chats, canonical
    owner/admin/member/observer membership and provider-free delivery. Privacy
    scenarios derive lifecycle-policy/hold/export/delete decisions from exact
    world records, including no/unrelated/exact active legal holds. Tenant,
    payload, projection, identity-key, membership, route graph, authorship,
    access-fence, stale-CAS, decoy/duplicate provider-effect and denied no-op
    invariants fail closed. No database repository or provider call is
    implemented by design at this contract-suite boundary. The focused suite
    passed `4/19`; the full suite passed `213/2029`; TypeScript, repository
    format, scoped ESLint, DB, i18n, encoding, branding and native gates passed
    on `2026-07-13`. Two independent latest-tree acceptance/security audits
    returned `READY` with no P0/P1/P2 findings. Repository-wide lint remains
    blocked outside this task only by the three pre-existing unused icon imports
    in `apps/site/app/[locale]/calculator-section.tsx`.

- [x] `INB2-EPIC-1-GATE` Verify Epic 1 exit gate.
  - State: `done`; Priority: `P0`; Started: `2026-07-13`;
    Completed: `2026-07-13`; Owner: `Codex`; Depends on: all Epic 1 tasks.
  - Acceptance: a complete in-memory flow can be implemented against stable V2
    contracts and invalid states are rejected.
  - Verification: contract exports, fixtures, unit tests and `pnpm check` pass.
    Evidence: `docs/product/inbox-v2-epic-1-gate-review.md`; all 13 prerequisite
    tasks are complete. A package-root consumer composes Conversation,
    participants, exact authorization, Message, atomic tenant commit, event,
    outbox and snapshot through `@hulee/contracts`, `@hulee/core` and
    `@hulee/testing` without deep imports. Canonical graph, same-Conversation
    authorship, immutable Message/StaffNote/WorkItem heads, one-active-WorkItem,
    internal topology/owner and SourceIdentityClaim uniqueness/head invariants
    now fail closed. The scenario suite passed `6/38`, the Epic-focused suite
    passed `68/1311`, and full `pnpm check` passed `219/2169` plus formatting,
    repository-wide ESLint, TypeScript, DB, i18n, encoding, branding and native
    gates on `2026-07-13`. Independent public-boundary and latest-tree
    acceptance/security reviews returned `READY` with no P0/P1/P2 findings.

## Epic 2. PostgreSQL Schema, Constraints And Repositories

Goal: persist the V2 model with tenant-safe constraints and efficient access
paths.

`INB2-DB-002` and `INB2-DB-003` are one coupled delivery package because their
canonical graphs intentionally reference each other: SourceOccurrence can name
a SourceExternalIdentity, while provider roster, claim and Client-link evidence
can name SourceThreadBinding/SourceOccurrence. They must not be implemented with
temporarily unverified opaque references. The executable order is:

1. `DB-002 foundation`: SourceExternalIdentity/current claim head,
   ConversationParticipant, non-provider membership, Client links and Client
   merge storage using only already-persisted evidence types;
2. `DB-003 transport`: ExternalThread, SourceAccount identity,
   SourceThreadBinding, SourceOccurrence, provider references and routing with
   composite references back to the identity foundation;
3. `DB-002 coherence`: provider roster/member evidence, provider-origin
   membership and the remaining occurrence/roster evidence subtypes with exact
   composite references.

Both canonical tasks close only after the shared fresh-migration and concurrent
PostgreSQL gate passes. `INB2-DB-005` cannot start before both are complete.

- [x] `INB2-DB-001` Add V2 conversations and conversation head persistence.
  - State: `done`; Priority: `P0`; Started: `2026-07-13`;
    Completed: `2026-07-13`; Owner: `Codex`; Depends on:
    `INB2-EPIC-1-GATE`.
  - Acceptance: tenant, topology/purpose, lifecycle, range-allocated timeline
    sequence, entity/head revision, last item/activity and timestamps have
    tenant-aware uniqueness, constraints and indexes.
  - Verification: concurrent allocation, rollback/retry, stable sequence and
    revision repository tests pass. Evidence: separate tenant-owned Conversation
    and ConversationHead tables, independent entity/head CAS clocks, tenant-safe
    composite keys, positive activity sequence, finite timestamps and catalog-ID
    parity are covered by contract/schema/repository tests; focused suite passed
    `4/94`; final migration `0028_groovy_purifiers` applied to a fresh PostgreSQL
    database and the opt-in PostgreSQL suite passed `7/7`, including blocking
    allocation races, rollback/retry and bigint overflow; full `pnpm check`
    passed `221/2185` plus formatting, repository-wide ESLint, TypeScript, DB,
    i18n, encoding, branding and native gates on `2026-07-13`. Independent
    repository, schema/migration and final acceptance reviews returned `READY`
    with no P0/P1/P2 findings.

- [x] `INB2-DB-002` Add external identities, participants and client links.
  - State: `done`; Priority: `P0`; Started: `2026-07-13`; Completed:
    `2026-07-14`; Owner: `Codex`; Depends on: `INB2-DB-001`, `INB2-CON-004`;
    coupled delivery: `INB2-DB-003`.
  - Acceptance: source identity storage is separate from auth identity links;
    composite tenant foreign keys/checks enforce one typed participant subject,
    one active temporal claim and preserve provider versus Hulee internal
    membership, collaborator/link/merge history while supporting zero-to-many
    clients and manual self-claim rejection. Client merge storage has one
    mandatory current node row per Client plus immutable paged event history;
    one transaction CASes the tenant head, resolves/locks both roots in stable
    order, checks source/target depth, updates both node projections and appends
    the redirect against the deterministic merge-commit before/after contract.
    Transition ownership is one-way to avoid insertion cycles;
    composite constraints and bounded contract validators enforce transition-
    to-episode/claim, roster-member-to-roster/binding/source-subject and
    contiguous revision/version coherence rather than accepting unrelated
    same-tenant references or loading lifetime history.
  - Verification: auth/source namespace, cross-tenant, claim race, conflicting
    root merge/depth race, dual-origin membership and invalid typed-row tests
    pass. Evidence: current checkpoint below; the coherence and coupled transport
    gates are complete.
  - Current checkpoint (`2026-07-14`): SourceExternalIdentity, its mandatory
    claim head, immutable temporal SourceIdentityClaim episodes, ordered
    evidence and append-only CAS transitions are persisted in the shared
    regenerated `0029_inbox_v2_identity_transport_foundation` migration.
    Provider-scoped identities require an exact realm/object-kind declaration and
    trusted materialization authority. Durable provider roster/member evidence
    and SourceOccurrence actor anchors induce claims and memberships through
    exact composite references; raw/normalized events are only paired
    supplemental evidence. A cross-episode provider ordering head rejects stale
    rejoin while retaining valid historical terminal episodes and pins its clock
    to the exact transition. Tenant-approved immutable policy versions plus
    activation transitions/heads are the sole authority for `automatic_policy`
    claims and trusted-service Client links; use and revoke race under row locks.
    ConversationClientLink persists separate ordered verification/audit evidence,
    exact claim/contact/participant/occurrence references, temporal Employee
    fences and linked/verified/ended policy authority. Persisted `trusted_policy`
    links round-trip into later transitions, revoked authority cannot mutate a
    link, and an Employee can perform the recovery end. Client merge keeps one
    mandatory current node per Client: direct node deletion rolls back with
    `23514`, while Client/Tenant cascades remain valid.
    The finalized migration contains `620` generated DDL statements and all
    `11/11` invariant blocks; `db:check` enforces verbatim schema-to-migration
    parity, invariant function/search-path coverage and critical generated
    FK/trigger/index anchors. Fresh migration, coherent `0028 -> 0029` upgrade
    and incoherent cross-tenant negative preflight pass; the failed preflight
    leaves only the first `29` migrations applied and no V2 transport artifacts.
    All `13` opt-in PostgreSQL files pass `124/124` sequentially on one fresh
    disposable PostgreSQL 16 instance. Full `pnpm check` passes `247` test files /
    `2511` tests, with `13` PostgreSQL files / `124` tests skipped by default,
    plus formatting, repository-wide ESLint, TypeScript, DB, i18n, encoding,
    branding and native gates. The coupled `INB2-DB-002` coherence and
    `INB2-DB-003` transport delivery is complete.

- [x] `INB2-DB-003` Add external threads, account bindings and provider references.
  - State: `done`; Priority: `P0`; Started: `2026-07-13`; Completed:
    `2026-07-14`; Owner: `Codex`; Depends on: `INB2-DB-001`, `INB2-CON-005`;
    coupled delivery: `INB2-DB-002` foundation/coherence.
  - Acceptance: composite tenant uniqueness respects versioned thread/message
    scopes; aliases, canonical/provisional accounts, binding generations/axes,
    compact current binding heads, occurrences, opaque routes, dispatch
    attempts/artifacts, append-only reconciliation decisions and refs preserve
    temporal history and dedupe. Composite relations enforce each bounded
    binding/occurrence/artifact induction commit rather than trusting unrelated
    same-tenant foreign keys.
  - Verification: multi-account group, account-scoped private, alias/account
    promotion, cross-tenant FK, concurrent resolution and changed-generation
    tests obey database invariants. Evidence: current checkpoint below; transport
    persistence, repositories and PostgreSQL gates are complete.
  - Current checkpoint (`2026-07-14`): ExternalThread resolution,
    append-only SourceAccount identity/re-auth history, SourceThreadBinding
    heads/revision snapshots/evidence/capability/route descriptors and inbound
    SourceOccurrence persistence are in the shared regenerated `0029` migration.
    Three tenant-scoped occurrence tables preserve exact thread/account/binding/
    event anchors, message identity, provider actor, ordered provider references
    and timestamps. Durable provider roster/member evidence now has exact binding
    snapshot and identity anchors; it drives cross-episode membership ordering and
    occurrence-backed claim/ClientLink coherence. Insert guards lock the current
    binding and verified account identity fences in canonical order;
    immutable/deferred triggers reject mutation, incomplete child aggregates and
    stale provider observations. The SQL repository supports `webhook`, `stream`,
    `poll` and `history`, exact idempotency and typed stale-evidence/fence
    conflicts. Binding creation and transition repositories persist evidence,
    episodes and compact snapshots with idempotency, stable lock order and CAS.
    All six contract evidence kinds, including provider roster/member evidence,
    resolve through typed exact binding/connection/account authorities.
    Minimal TimelineItem/Message identity anchors avoid a DB-003/DB-005 cycle;
    content and lifecycle remain owned by DB-005. Versioned route policies,
    immutable route snapshots, multi-send operations, dispatches, commit-first
    attempts, artifacts, append-only reconciliation decisions, external message
    references and occurrence-resolution transitions are durable. Provider
    response/echo materialization pins the exact attempt/dispatch/route/binding
    chain and opaque UTF-8 digest parity, including backslashes.
    The regenerated `0029` migration has `620` DDL statements and `11` invariant
    blocks; `db:check`, fresh PostgreSQL 16 apply and `0028 -> 0029` upgrade pass.
    The outbound lifecycle suite passes `6/6` both fresh and upgraded; all `13`
    opt-in PostgreSQL files pass `124/124`, including stale-fence, concurrent
    claimant, tenant/FK and both response/echo arrival orders. Negative preflight
    fails closed with SQLSTATE `23514`, leaving `29` migrations and no transport
    tables. Full `pnpm check` passes `247` files / `2511` tests with all format,
    lint, TypeScript, DB, i18n, encoding, branding and native gates. Disposable
    databases/container were removed and the test port was released.

- [x] `INB2-DB-004` Add WorkItems and temporal assignment history.
  - State: `done`; Priority: `P0`; Started: `2026-07-14`; Completed:
    `2026-07-14`; Owner: `Codex`; Depends on: `INB2-DB-001`, `INB2-CON-006`.
  - Acceptance: queue/state/priority/SLA/version are persisted and a partial
    unique constraint prevents two active primary assignments; Inbox V2 also
    prevents more than one non-terminal WorkItem per Conversation. Assignment
    eligibility/deactivation fences, servicing-team relation and non-overlapping
    temporal history are transactionally enforceable.
  - Verification: concurrent assignment and WorkItem-creation integration tests
    produce one winner and complete history. Evidence: the tenant-owned schema
    in `packages/db/src/schema/inbox-v2/work-item.ts` persists immutable Queue
    and Employee-fence versions/heads, one Conversation WorkItem slot, WorkItem
    aggregate/SLA cycles, eligibility and creation decisions, primary-assignment
    and servicing-team histories plus exact lifecycle/relation proofs across 13
    tables. Nineteen fixed-`search_path` functions enforce append-only history,
    OLD/NEW aggregate coherence, temporal non-overlap, current-head induction,
    active-assignment fences and deterministic cascade behavior. The finalized
    `0030_inbox_v2_work_item_responsibility_foundation.sql` has a fail-closed
    partial-schema preflight; fresh PostgreSQL 16 apply, coherent `0029 -> 0030`
    upgrade/backfill and negative SQLSTATE `23514` rollback passed. The SQL
    repository implements lock-ordered Queue/fence CAS, atomic create/claim/
    transfer/close/reopen/team commits, exact replay, typed race outcomes,
    `(sla_cycle, revision)` history, causal keyset pagination and recovery reads.
    Focused schema/repository/check tests passed `34/34`; all 14 opt-in PostgreSQL
    files passed in the DB suite (`70` files / `617` tests); full `pnpm check`
    passed `250` files / `2540` tests plus formatting, repository-wide ESLint,
    TypeScript, DB, i18n, encoding, branding and native gates on `2026-07-14`.
    Independent schema and SQL-invariant reviews returned `READY`; runtime gates
    found and closed timestamp decoding, relation-insert ordering and generic
    cascade-trigger regressions before completion.

- [x] `INB2-DB-005` Add timeline, message content and lifecycle persistence.
  - State: `done`; Priority: `P0`; Started: `2026-07-14`; Completed:
    `2026-07-14`; Owner: `Codex`; Depends on: `INB2-DB-001`,
    `INB2-DB-002`, `INB2-DB-003`, `INB2-CON-007`.
  - Acceptance: typed timeline envelope plus separately purgeable classified
    message/content parts, immutable author, revision/last-changed position, app
    actor, transport occurrences/dispatch, revisioned lifecycle/privacy/
    retention tombstones, reactions, deliveries, receipts and source refs are
    queryable with same-tenant checks; generic event/audit rows do not copy
    content.
  - Verification: lifecycle/echo replay retains one canonical sequence/item,
    original author and full audit history after stale update, tombstone, link,
    merge, leave and deactivation. Evidence: the typed schema persists the
    TimelineItem envelope, separately purgeable classified content heads,
    revisions, payloads and contact values, immutable action attribution and
    Message revisions, reference contexts, transport occurrence links/facts,
    route/dispatch state, delivery/receipt facts, reactions and provider
    lifecycle/ordering heads with composite tenant boundaries. Twenty-seven
    fixed-`search_path` functions enforce the canonical graph, revision chains,
    route/dispatch atomicity, tenant/source authority, lifecycle/reaction FSMs,
    classified-data deletion and provider semantic ordering. The SQL repository
    implements atomic create/mutate/staff-note, transport fact, reaction and
    provider-lifecycle commits with exact replay, stale/race fencing, recovery
    reads and content-free generic envelopes. Source and finalized `0031`
    invariant blocks matched exactly (`22 + 5` functions); fresh/upgrade/
    negative migration lifecycle passed `3/3`; timeline/message PostgreSQL
    scenarios passed `18/18`, the cross-feature outbound regression passed
    `6/6`, the full DB package passed `73` files / `666` tests, and full
    `pnpm check` passed `254` files / `2577` tests plus formatting, ESLint,
    TypeScript, DB, i18n, encoding, branding and native gates on `2026-07-14`.
    Independent acceptance and migration reviews returned `READY`.

- [x] `INB2-DB-006` Add employee conversation/read state persistence.
  - State: `done`; Priority: `P0`; Started: `2026-07-15`; Completed:
    `2026-07-15`; Owner: `Codex`; Depends on: `INB2-DB-001`,
    `INB2-DB-005`.
  - Acceptance: monotonic `greatest` last-read sequence, separate manual unread
    marker, revision/stream provenance, mute, notification level, pin/archive
    and timestamps are per employee.
  - Verification: lower multi-device read cursors cannot overwrite higher
    values; provider receipts/manual unread remain independent and tenant
    isolation tests pass. Evidence: the versioned contract, tenant-scoped sparse
    state table and SQL repository persist an exact Employee/Conversation read
    cursor plus independent manual-unread, mute, notification, pin and archive
    preferences with revision/stream provenance. Advisory state-key locking,
    exact TimelineItem validation, `GREATEST` cursor updates and idempotent CAS
    no-ops prevent lower/equal device cursors from allocating a commit or
    regressing state; callback writes and state mutations share one transaction.
    Finalized migration `0032_inbox_v2_employee_conversation_state` has guarded
    preflight/invariants and fresh/populated-upgrade/partial-schema lifecycle
    coverage. Focused contract/schema/repository/finalizer tests passed `4/28`;
    live PostgreSQL repository scenarios passed `4/4` for concurrent `80/100`
    reads, wrong-conversation sequence, tenant isolation, manual-unread/receipt
    independence and callback rollback; migration lifecycle passed `3/3`; full
    `pnpm check` passed `258/2605` plus formatting, repository-wide ESLint,
    TypeScript, DB, i18n, encoding, branding and native gates on `2026-07-15`.

- [x] `INB2-DB-009` Persist data lifecycle policy, holds, requests and operation ledgers.
  - State: `done`; Priority: `P0`; Started: `2026-07-15`; Completed:
    `2026-07-15`; Owner: `Codex`; Depends on: `INB2-DB-001`, `INB2-DB-002`,
    `INB2-DB-005`, `INB2-CON-010`.
  - Acceptance: versioned tenant-local `DataGovernanceContext`, a closed storage-
    root registry, tenant-safe effective policy/purpose/subject links, module
    lineage/handler registrations, hold/restriction, privacy request, export/
    deletion runs, fenced handler checkpoints, typed operated/external residuals
    and erasure/restore ledger preserve ADR 0015 revisions and scope. Status
    constraints allow `completed_with_external_residuals` only for a location
    outside the operated data plane, `primary_purged_backup_expiry_pending` only
    with verified primary absence plus bounded backup/version expiry evidence,
    and otherwise keep the run at `verification_blocked_internal_residual`;
    global templates are stored separately from effective tenant context/policy,
    every destructive run has non-null tenant and governance/policy revisions,
    and hold lookup is enforceable before row/object/key deletion.
  - Verification: composite-tenant, governance-context/policy activation, policy/
    hold CAS race, subject alias, idempotent run/checkpoint, tenant-less or stale-
    context destructive-run rejection, missing-root/handler rejection and cross-
    tenant destructive-operation integration tests pass without raw PII evidence.
    Invalid internal-as-external, unverified-primary-as-backup-pending and premature
    completed status transitions fail constraints. Evidence: versioned contracts,
    a closed tenant-safe schema and SQL repositories persist governance contexts,
    separately governed global templates, storage roots, lineage/handlers,
    effective policies and activations, subject aliases, holds/restrictions,
    privacy requests, export/deletion runs, fenced destructive checkpoints and
    the append-only erasure/restore chain without raw PII evidence. Composite
    tenant keys, revision/hash CAS, structurally encoded advisory locks,
    authorization/lease fences, exact terminal-export binding and fail-closed
    status/coherence triggers reject stale, cross-tenant, missing-authority and
    invalid residual transitions. Finalized migration
    `0033_inbox_v2_data_governance_privacy.sql` installs 52 tables, 37 enums, 11
    fixed-`search_path` functions and 84 triggers behind an exact-inventory
    preflight. Fresh install, populated `0032 -> 0033` upgrade, partial/damaged
    foundation and late-failure rollback plus invariant scenarios passed `8/8`;
    focused contract/schema/repository/finalizer/check tests passed `14` files /
    `122` tests; live PostgreSQL activation/export/deletion/guard/restore
    scenarios passed `4` files / `22` tests, including concurrency, exact retry,
    hold lookup, terminal export expiry/revocation and restore lease/sequence
    fencing. Full `pnpm check` passed `271` files / `2718` tests plus formatting,
    repository-wide ESLint, TypeScript, DB, i18n, encoding, branding and native
    gates on `2026-07-15`.

- [x] `INB2-RBAC-003` Persist authorization relations and revision fences.
  - State: `done`; Priority: `P0`; Started: `2026-07-15`; Completed:
    `2026-07-15`; Owner: `Codex`; Depends on: `INB2-RBAC-002`,
    `INB2-DB-002`, `INB2-DB-004`, `INB2-DB-006`.
  - Acceptance: composite-tenant role/grant/membership/resource edges,
    SourceAccount/Conversation/Client structural access, WorkItem servicing-team,
    collaborator/internal membership relations and bounded `tenantRbacRevision`, Employee and
    recipient/resource-relation revisions are persisted; privileged access
    mutation, revisions, audit, event/change and outbox commit atomically,
    without updating every affected Employee on broad role change.
  - Verification: cross-tenant constraints, incompatible role update, revoke
    versus command/replay/idempotent result, mass-binding revision, relation
    history and transaction-failure tests pass with no access change missing
    audit/invalidation and no unbounded Employee fan-out. Evidence: versioned
    authorization persistence contracts, pure revision planners and one SQL
    transaction boundary now persist tenant-safe role definitions/bindings,
    direct grants, workforce membership, Conversation/Client/SourceAccount
    structural access and Conversation/WorkItem collaborators while composing
    DB-002 internal membership and DB-004 responsibility/servicing-team writes.
    Bounded tenant, Employee, resource and direct-recipient revision effects,
    a total-order tenant stream, immutable audit/event/outbox manifests and six
    deferred post-seal child guards close every successful privileged mutation
    without broad Employee fan-out. Mandatory transaction-local role legality
    rejects incompatible active or future-scheduled bindings even when a raw
    persistence callback omits planning; indexed active-role lookup preserves
    mass-binding behavior. Terminal workforce/structural/collaborator episodes
    keep history while a new relation ID can re-add the same logical edge, and
    old-ID resurrection remains forbidden. Finalized migration
    `0034_inbox_v2_authorization_relations.sql` installs `27` tables, `17`
    enums, `19` fixed-search-path functions (`17` authorization plus `2`
    replaced WorkItem functions), `59` authorization triggers and verifies `8`
    foundation caller fingerprints behind an exact preflight. Fresh install,
    populated `0033 -> 0034`, partial/damaged foundation, wrong WorkItem binding
    and late-rollback lifecycle scenarios passed `7/7`; finalizer tests passed
    `6/6`; focused tests passed `9` files / `522` tests; a fresh unpatched
    PostgreSQL database passed `22/22` live scenarios (`23/23` with shape
    normalization), including cross-tenant, replay, revoke/command races,
    role-legality/CAS races, retry rollback, re-add history and all six late
    child tamper paths. Repository-wide formatting, ESLint, TypeScript, DB,
    i18n, encoding, branding and native gates passed; the full Vitest suite
    passed with bounded local parallelism at `277` files / `2782` tests plus
    `23` files / `219` tests intentionally skipped on `2026-07-15`.

- [x] `INB2-RBAC-007` Implement bounded security-denial audit and review.
  - State: `done`; Priority: `P0`; Started: `2026-07-15`; Completed:
    `2026-07-15`; Owner: `Codex`; Depends on: `INB2-RBAC-003`.
  - Acceptance: denied/guessed-ID attempts use a redacted sink with stable
    dedupe window, counters, rate/volume bounds and high-risk review/alert types;
    they allocate no Inbox stream position, stream-head lock, domain/provider
    outbox or attacker-controlled payload growth. Denied hold issue/release,
    privacy evidence, tenant export and destructive preview/approval/execute use
    the same bounded non-disclosing path with action-specific review signals.
  - Verification: guessed-ID flood, repeated self-claim, lifecycle scope-matrix
    denial, cross-tenant and sink failure tests preserve bounded storage/work,
    required alerts and normal API availability without leaking resource existence.
    Evidence: strict versioned attempt/result/review contracts and a core-owned
    authorization gate derive tenant/action/principal attribution, purpose-
    separated tenant HMACs, one random observation receipt, stable denial/public
    classes and action-specific lifecycle review signals without exposing sink
    outcomes through the public decision. Process-wide in-flight, telemetry and
    circuit caps keep rejected/hung/mutating sinks best-effort while deny remains
    fail-closed. Finalized migration `0035_inbox_v2_security_denial_sink.sql`
    installs three tenant-local tables plus DB-clock record/prune functions,
    exact counters, 16 shards, finite detail/review admission, overflow/rate
    aggregation, coherence guards and snapshot-high-water keyset review pages;
    no tenant stream, stream-head lock or outbox is touched. The autonomous
    worker keyset-pages the canonical tenant registry and prunes through a
    separate sanitized two-connection pool with `100ms` lock and `500ms`
    statement limits, bounded concurrency/batches and tracked retry/idle/shutdown;
    hostile URL options cannot override those controls. The common request
    repository exposes only `record/listReviews`; lifecycle `prune` is isolated
    in its dedicated repository. Focused contract/core/schema/repository/worker
    tests passed `9` files / `480` tests; fresh PostgreSQL migration lifecycle
    passed `5/5` and live sink/review/retention scenarios passed `14/14`, including
    floods, dedupe, self-claim, all lifecycle actions, cross-tenant/direct-DML,
    pagination, cap/coherence tampering and locked-prune timeout. Full
    `pnpm check` passed `286` files / `2850` tests plus formatting, repository-
    wide ESLint, TypeScript, DB, i18n, encoding, branding and native gates, with
    `25` files / `238` integration tests intentionally skipped on `2026-07-15`.

- [x] `INB2-DB-007` Add V2 repository ports, mappers and access-plan indexes.
  - State: `done`; Priority: `P0`; Started: `2026-07-15`; Completed:
    `2026-07-15`; Owner: `Codex`; Depends on: `INB2-DB-001` through
    `INB2-DB-006`, `INB2-DB-009`, `INB2-RBAC-003`.
  - Acceptance: all repositories require tenant context; commit-safe tenant
    stream head/commits/changes, projection checkpoints/generations and retained
    prefix are persisted; outbox claim/renew/reclaim/finalize/dead fields support
    token-fenced leases; keyset list/timeline, thread lookup, actor-visible
    access predicates, assignment, retention eligibility and hold lookup paths
    have reviewed indexes. Every tenant-owned parent/child edge uses a
    same-tenant composite FK/unique key rather than global-ID-only integrity;
    authorization is applied before pagination/counting with no per-row grant
    reload. Runtime database roles cannot directly mutate revision-owned
    membership heads/commits/episodes/transitions; canonical mutation entrypoints
    enforce the ADR 0010 lock order and isolation level, while privileged repair
    tooling uses the same order and bounded retry policy.
  - Verification: repository suite proves the in-flight lower-position race
    cannot skip, contiguous checkpoint/gap rules, stale lease owner cannot
    mutate/finalize and cross-tenant denial; schema introspection and destructive
    retention tests reject cross-tenant child links; privilege introspection
    proves runtime direct DML is denied; saved representative `EXPLAIN` plans
    pass. Evidence: versioned tenant-explicit ports and SQL repositories now
    persist repeatable-read stream snapshots/replay, contiguous projection
    generations/checkpoints/cutover, atomic retained-prefix pruning and
    token-fenced outbox claim/renew/reclaim/finalize/dead outcomes. The
    actor-visible access-plan repository binds a server-resolved tenant/Employee
    snapshot before keyset pagination or counting, and reviewed tenant-leading
    indexes cover structural access, active responsibility, retention, holds
    and exact external-thread lookup without per-row grant reload. Finalized
    migration `0036_inbox_v2_repository_foundation.sql` adds six tables, three
    enums, exact checkpoint/stream child composite keys, guarded backfills and
    fixed-search-path retention/membership entrypoints. NOLOGIN owner/runtime/
    repair roles deny runtime and repair direct DML to all four revision-owned
    membership tables; actual runtime repository create/start/transition and
    repair-runner paths use the canonical `READ COMMITTED` head -> Employee ->
    participant/episode lock order with three-attempt `40001`/`40P01` retry.
    Same-lease terminal replay is explicitly reserved for `INB2-SRC-009`;
    DB-007 returns terminal `not_leased` state rather than authenticating from a
    cleared lease. A rare concurrent inactive-Employee rejection remains
    fail-closed as SQLSTATE `23514`; translating it back to the earlier typed
    not-found result is a non-blocking API follow-up before public exposure.
    Focused contract/schema/repository/finalizer tests passed `18` files / `228`
    tests; fresh/populated/partial/incoherent migration lifecycle passed `4/4`,
    including eight runtime/repair direct-DML denials; clean PostgreSQL
    repository concurrency/retention scenarios passed `4/4`. Nine saved
    `EXPLAIN (ANALYZE, BUFFERS)` access paths passed `1/1`; independent final
    audit returned `READY` with no P0/P1 findings. Full `pnpm check` passed `296`
    files / `2954` tests, with `28` files / `247` integration tests intentionally
    skipped, plus formatting, repository-wide ESLint, TypeScript, DB, i18n,
    encoding, branding and native gates on `2026-07-15`.

- [x] `INB2-DB-008` Add repeatable clean V2 install and guarded reset migrations.
  - State: `done`; Priority: `P0`; Started: `2026-07-15`; Completed:
    `2026-07-16`; Owner: `Codex`; Preserve lane activated by completed
    `INB2-MIG-001`; Depends on: `INB2-DB-007`, `INB2-DB-009`,
    `INB2-ARCH-009`, `INB2-MIG-001`.
  - Acceptance: owns clean V2 DDL/seed/bootstrap and an explicitly guarded
    disposable reset path; it never infers reset authority from environment or
    row count. Because `INB2-MIG-001` selected `preserve`, a representative V1
    compatibility harness must prove default fail-closed online-DDL
    classification, strict ephemeral semantic compatibility, source-bundled N-1
    service-module behavior, no-write RBAC mapping and transactional rollback.
    This repository gate does not authorize deployment expand: the reviewed
    online bridge and runtime dual materialization belong to `INB2-MIG-002`,
    operational data backfill to `INB2-MIG-003`, real deploy-image/restore proof
    to `INB2-MIG-006`, and packaging/restore productization to
    `INB2-OPS-009/007`.
  - Verification: empty/current DB install, idempotent seed/reset and projection/
    stream bootstrap pass; when preserve is activated, representative V1 upgrade,
    N-1 smoke and rollback evidence become mandatory. `pnpm db:check` and
    `pnpm check` pass. Evidence: clean/current install, exact journal/bundle/
    bootstrap/MIG-001/object evidence binding, fenced atomic disposable reset,
    rollback after post-drop failure, content/catalog/sequence/ACL inventory,
    live semantic and prepared-transaction refusal, recoverable connection
    fence, reset-surviving database-wide immutable receipt ledger/idempotent
    `reset_noop` (including an expired exact retry), different-tenant and old
    generation replay refusal, bounded fresh destructive authority, exact
    critical schema/SECURITY DEFINER/ACL audit and synthetic repair are
    implemented in `scripts/db/inbox-v2-database-lifecycle.mjs`, migration
    `0037` and `docs/product/inbox-v2-db-008-install-and-reset.md`. The normal
    preserve runner now produces hashed PII-safe evidence and refuses every
    classified pre-existing-relation hazard before DDL, including generated
    rewrites, blocking indexes/immediate constraints, trigger/security changes
    and unbounded Tenant/Client/Employee source backfills. A library-only,
    strictly named integration lane then proves unchanged V1
    baseline facts, exactly `14` deterministic Client/Employee foundation rows,
    zero operational V2 rows and no-write RBAC mapping. Rule changes, nameless
    indexes and global blocking maintenance also fail closed, including SQL with
    comments between keywords. Unknown SQL uses bounded Evidence V2: one
    inventory-scoped operation per statement with count and domain-separated
    inventory digest, never a statement-by-relation expansion. One pinned
    migration-0034 source-bundled N-1 process remains operational across the
    immediate failed-migration probe and strict ephemeral 0035-0038
    compatibility expand. The contract binds revision `3b9d703`, exact source/
    build/input/migration digests and the reviewed routing patch; full-history CI
    regenerates the deterministic bundle and rejects drift. The sequential
    PostgreSQL 16 preserve gate passed `3` files / `17` tests; lifecycle/DDL/
    RBAC/install/routing focused suites passed `5` files / `72` tests;
    `pnpm db:check` passed. The disposable PostgreSQL 16 reset suite passed `1`
    file / `1` exhaustive scenario with `max_prepared_transactions=10`; both
    PostgreSQL lanes left `0` strictly named child databases. Full `pnpm check`
    passed `302` files / `3024` tests, with `30` files / `251` integration tests
    intentionally skipped, plus formatting, ESLint, TypeScript, DB, i18n,
    encoding, branding and native gates on `2026-07-16`. Guarded reset remains
    available only to a separately reviewed, explicitly disposable personal/
    ephemeral target. Production preserve expand remains fail-closed until
    `INB2-MIG-002`; backfill remains `INB2-MIG-003`.

- [x] `INB2-DB-010` Close Conversation/Head/timeline database coherence gaps.
  - State: `done`; Priority: `P0`; Started: `2026-07-16`; Completed:
    `2026-07-16`; Owner: `Codex`; Depends on: `INB2-DB-001`, `INB2-DB-005`,
    `INB2-DB-008`.
  - Acceptance: every persisted Conversation has exactly one tenant-matched
    ConversationHead; the head sequence and activity tuple exactly match the
    committed TimelineItems; direct SQL cannot delete the mandatory head,
    advertise an unpersisted sequence or regress Conversation/Head revision,
    stream position or update clock, and cannot truncate invariant-owned
    Conversation, Head, TimelineItem or identity-fence state. The checks are
    deferred where an atomic Conversation/Head/Timeline transaction needs
    temporary intermediate state, remain safe for Conversation/Tenant delete
    cascades and do not rely on repository-only assumptions.
  - Verification: a schema-owned invariant block and append-only migration pass
    fresh, coherent-upgrade, incoherent-preflight and rollback tests; adversarial
    PostgreSQL tests reject missing/deleted heads, forged sequence/activity and
    stale revision/stream writes while valid repository create and atomic
    Timeline allocation still commit. Evidence: schema-owned invariant,
    preflight and append-only migration `0038`; fresh/upgrade/preflight/race/
    rollback PostgreSQL lifecycle `1` file / `6` tests; preserve/N-1 lane `3`
    files / `17` tests; disposable reset lane `1` file / `1` exhaustive test on
    PostgreSQL 16 with `max_prepared_transactions=10`; affected repositories `5`
    files / `42` tests; schema invariant `5/5`; migration SQL/snapshot/journal
    parity `39/39/39`; full `pnpm check` `303` passed files / `3031` passed tests
    with `31` files / `257` integration tests intentionally skipped. Three
    independent reviews found no remaining P0/P1/P2 blocker. Production preserve
    expand remains fail-closed until `INB2-MIG-002` supplies its online bridge.

- [x] `INB2-EPIC-2-GATE` Verify Epic 2 exit gate.
  - State: `done`; Priority: `P0`; Started: `2026-07-16`;
    Completed: `2026-07-16`; Owner: `Codex`; Depends on: all Epic 2 tasks,
    including `INB2-DB-010`.
  - Acceptance: fresh/current V2 databases enforce tenant, thread, assignment
    and sequence invariants without application-only assumptions; a
    representative V1-upgraded database is required by the selected preserve
    path.
  - Verification: schema/repository/migration evidence is complete.
  - Evidence: `docs/product/inbox-v2-epic-2-gate-review.md`; fresh/current
    PostgreSQL 16 applied `39/39` migrations and passed `23/23` files with
    `219/219` tests; preserve `3/17`, timeline `1/6`, reset `1/2`, lifecycle and
    runner `2/27`, and focused membership `3/32` passed; `pnpm db:check` and
    `pnpm check` passed (`304/3041`, with `31/258` opt-in integration tests
    intentionally skipped by the default process); independent latest-tree
    reviews found no remaining P0/P1/P2 blocker. Production preserve expand,
    backfill, cutover and V1 removal remain outside this gate.

## Epic 3. Source Pipeline, Identity And Conversation Resolution

Goal: turn webhook/polling/session input into one idempotent canonical thread and
participant set.

- [x] `INB2-SRC-001` Re-verify the existing source foundation for V2 use.
  - State: `done`; Priority: `P0`; Started: `2026-07-16`; Completed:
    `2026-07-16`; Owner: `Codex`; Depends on: `INB2-EPIC-2-GATE`.
  - Acceptance: SOURCE-100..112 contracts/tables are mapped to V2 and every
    incompatibility becomes a task rather than an assumed completed dependency;
    raw/normalized arbitrary JSON, global-ID-only tenant FKs and absent lifecycle
    metadata are explicit migration gaps, not reusable V2 invariants.
  - Verification: mapping document and focused existing source tests pass.
  - Evidence: `docs/product/inbox-v2-src-001-source-foundation-map.md` maps
    `SOURCE-100..112`, current runtime/schema facts, twelve owned gaps and the
    ADR 0015 lifecycle target. Focused foundation `12/71`, independent source
    `8/45` and `12/89`, and connector/API/client `3/74` suites passed. Three
    independent reviews found the source/connector registry gap and assigned it
    to new P0 task `INB2-SRC-010`; no incompatibility remains ownerless. Full
    `pnpm check` passed (`304/3041`, with `31/258` opt-in integration tests
    intentionally skipped by the default process).

- [x] `INB2-SRC-010` Harden the reusable SourceConnection, SourceAccount and
      channel-connector registry for V2.
  - State: `done`; Priority: `P0`; Started: `2026-07-16`; Completed:
    `2026-07-16`; Owner: `Codex`; Depends on: `INB2-SRC-001`,
    `INB2-DB-003`, `INB2-DB-009`, `INB2-CON-010`, `INB2-RBAC-003`.
  - Acceptance: every SourceConnection, SourceAccount, creator/owner/access,
    ChannelConnector, ChannelSession, session-event and auth-challenge edge is
    enforced by same-tenant composite references; no repository or API path
    relies on a global ID alone. Canonical/provisional SourceAccount identity
    and re-auth history remain owned by the DB-003 authority. Persisted config,
    capabilities, diagnostics and metadata accept only versioned typed
    envelopes or classified content/evidence references; credentials are stored
    only through revocable secret references. Standalone source onboarding is
    atomic or compensating and exposes only a registered adapter handler.
    Disable, delete, replacement and reconnect preserve bindings, occurrences
    and historical identity while invalidating current route authority. Every
    retained JSON, secret reference and catalog/module surface declares its data
    class, purpose, storage root, subject-discovery path, parent and canonical
    retention anchor, policy/rule/lineage revision, hold/restriction behavior
    and compatible lifecycle/export/delete/absence-verification handlers. The
    registry is fail-closed when any required root, lineage or handler is absent
    or incompatible. This task owns the versioned capability-envelope storage
    boundary; exact direct-surface capability schemas remain in `INB2-DMX-001`.
  - Verification: fresh/current/N-1 PostgreSQL tests reject cross-tenant and
    global-ID-only edges, repository bypass with unsafe JSON or inline secrets,
    stale re-auth/replacement, orphaned onboarding secrets and invalid lifecycle
    declarations. Reconnect, disable/delete and replacement fixtures preserve
    historical evidence while preventing unauthorized route reuse. Registry
    composition rejects missing subject/parent/anchor/hold/export/delete/
    absence handlers and stale lineage revisions; hold/restriction and absence
    verification fail closed. Focused legacy source/channel tests pass.
    Evidence: additive V2 source registry contracts/modules, SQL schema,
    finalized migration, repository and internal onboarding API; production
    standalone onboarding remains fail-closed until `INB2-CON-011`/`INB2-SRC-011`.
    Focused contracts/modules/public boundary `3/73`, API `2/98`, DB unit/schema
    `2/20`, live migration `1/4`, clean temporary PostgreSQL repository `1/2`,
    N-1 upgrade `1/2`, `pnpm db:check`, `pnpm typecheck` and `pnpm lint` passed.
    Full `pnpm check` passed with `308/3146` and all gates.
    Detailed evidence is in
    `docs/product/inbox-v2-src-010-source-registry.md`.

- [x] `INB2-SRC-011` Wire standalone source onboarding through the authorized command protocol.
  - State: `completed`; Priority: `P0`; Depends on: `INB2-CON-011`,
    `INB2-SRC-010`, `INB2-DB-009`, `INB2-CON-010`, `INB2-RBAC-003`.
  - Acceptance: the versioned standalone-onboarding API requires a stable
    `clientMutationId`; the server computes the canonical request hash without
    plaintext credentials and invokes adapter prepare outside the sole database
    transaction. A DB-only source-registry callback then writes the compatibility
    source, transition/head, typed artifacts, revocable secret/route references
    and activation state through the `INB2-CON-011` coordinator, with the full
    current authorization snapshot and decision references revalidated in that
    same transaction. The first `applied` response may disclose a one-time value
    only through an explicitly registered response profile; `already_applied`
    returns the canonical non-sensitive source/commit result and never persists
    or rediscloses plaintext. A lost first response requires explicit credential
    rotation. The standard webhook-secret profile may deliberately use the same
    transient bytes for its revocable credential and `core:webhook-token`
    response, while generic route material and future response profiles remain
    independent. No production catalog item with `setupMode=source_connection`
    may become `available` until this coordinator, real adapter, transactional
    authorization resolver and production composition are all present.
  - Verification: API/repository/live PostgreSQL fixtures prove concurrent
    same-hash execution writes once, different-hash conflict writes nothing,
    revocation/expiry during slow prepare is denied, provider prepare is not
    repeated by DB retry, rollback leaves no command/source/secret/route/stream
    rows, an incomplete lifecycle purge rolls back with its full closure intact,
    the official checkpoint-safe prefix operation advances the advertised
    minimum without a replay gap and preserves its immutable commit skeleton,
    any retained command/event/outbox/audit reference blocks snapshot expiry,
    the atomic stream commit carries command/client-mutation/source event
    evidence, replay never rediscloses the token, and production composition
    fails closed when any required dependency or registered profile is absent.
    Evidence: completed on 2026-07-16 with stable UI/API mutation identity,
    HMAC credential fingerprints, adapter-owned prepare outside the retryable
    transaction, independent platform route material, DB-only authorized source
    persistence, immutable non-sensitive replay snapshots, exact lifecycle
    fences and fail-closed production composition. The clean PostgreSQL gate
    applied `42` migrations with contract
    `sha256:258ece1966e15b981ea77507f5299472de1baebe97429b1d8290c76d0969de0c`
    and passed `24/24` files / `225/225` tests. Preserve, pinned N-1 and RBAC
    passed `3/3` files / `17/17` tests. Full `pnpm check` passed with `313`
    test files / `3187` executed tests; `33` opt-in files / `268` tests were
    skipped by the default process. Detailed design and verification evidence
    are in
    `docs/product/inbox-v2-src-011-authorized-source-onboarding.md`.

- [x] `INB2-SRC-002` Add atomic raw-event claim, lease and stale reclaim.
  - State: `done`; Priority: `P0`; Depends on: `INB2-SRC-001`,
    `INB2-SRC-010`, `INB2-CON-010`.
  - Started: `2026-07-16`; Completed: `2026-07-16`; Owner: `Codex`.
  - Acceptance: before the first durable raw-event write, an adapter-declared
    sanitizer strips authorization/cookie/password/token/session material,
    persists only allowlisted diagnostic/signature headers and classified
    restricted evidence, and quarantines an unknown unsafe shape; repository
    callers cannot bypass this boundary. The repository constructs the raw
    idempotency key and, on conflict, compares immutable tenant/connection/
    account/transport/event-identity scope plus a safe envelope digest; mismatch
    produces stable `source.idempotency_collision` quarantine instead of
    returning an unrelated row. Multiple workers cannot process one pending
    event concurrently; expired leases are diagnosable and safely reclaimable.
  - Verification: signature/auth validation may use ephemeral request bytes, but
    persisted payload/header fixtures and repository-bypass attempts contain no
    credential material. Equal keys across connections/accounts and equal scope
    with a different safe digest are rejected and quarantined; exact retries
    return the original outcome. Multi-worker tests cover winner, retry and crash
    recovery. Evidence: completed on `2026-07-16` with a process-authentic,
    adapter-owned sanitizer boundary, classified immutable raw envelopes,
    independently purgeable restricted evidence, server-owned identity digests
    and idempotency keys, collision quarantine, fenced PostgreSQL claim/renew/
    release and expired-lease reclaim. The clean PostgreSQL gate applied `43`
    migrations with contract
    `sha256:b9b743b8b486cdfcabcf6a26fe6cdba8d665edef063c9ef80f7364184861c804`
    and passed `25/25` files / `232/232` tests. Preserve, pinned N-1 and RBAC
    passed `3/3` files / `17/17` tests. Full `pnpm check` passed with `316`
    test files / `3229` executed tests; `34` opt-in files / `275` tests were
    skipped by the default process. Independent contract/schema, repository and
    security reviews found no remaining P0/P1 defect. Detailed design and
    verification evidence are in
    `docs/product/inbox-v2-src-002-raw-ingress.md`.

- [x] `INB2-SRC-003` Normalize message, membership and lifecycle events for V2.
  - State: `done`; Priority: `P0`; Depends on: `INB2-SRC-001`,
    `INB2-SRC-010`, `INB2-CON-008`, `INB2-CON-010`.
  - Started: `2026-07-16`; Completed: `2026-07-16`; Owner: `Codex`.
  - Acceptance: normalized input separates exact source/account/thread/sender
    IDs, supports zero-to-many identity/roster observations with completeness,
    and retains provider time, capabilities, payload version and classified
    purgeable evidence reference; generic core/event/audit payloads never copy
    raw provider fragments, credentials or contact/message content. The
    normalized idempotency key is server-owned; a conflict must match its raw
    event, connection/account, event type and safe normalized-envelope digest or
    become a stable `source.idempotency_collision` quarantine outcome.
  - Verification: shared contract harness rejects missing scope, unsafe opaque-ID
    canonicalization and raw provider fragments in core payloads. Same-key
    fixtures across event types/raw events/accounts and mismatched safe digests
    never return an unrelated normalized row. Evidence: completed on
    `2026-07-16` with authentic adapter-declared normalizers, a fenced
    `loadClaimedInput` evidence boundary, explicit legacy `messenger` to catalog
    `core:messenger` mapping, generic worker orchestration, immutable normalized
    envelopes/results, classified purgeable payloads, tenant-keyed HMAC
    idempotency, exact collision quarantine and final-clock lease fences. Safe
    JSON and batch budgets cover prototype/accessor/sparse/symbol/NUL vectors and
    bound one raw event to 32 events / 8 evidence per event / 64 total. Focused
    suites passed `5/5` files / `66/66` tests. The clean PostgreSQL gate applied
    `44` migrations with contract
    `sha256:97e9204e2c12572f14bc23e91bde1bf03e4f701bed6d804f02a55c2f2be72d45`
    and passed `26/26` files / `238/238` tests; DB-enabled preserve, pinned N-1
    and RBAC passed `3/3` files / `17/17` tests. Full `pnpm check` passed with
    `320` test files / `3281` executed tests; `35` opt-in files / `281` tests
    were skipped by the default process and covered by explicit gates.
    Independent security and DB reviews found no remaining P0/P1 defect.
    Production activation remains blocked on the finite HMAC skeleton lifecycle
    in `INB2-SRC-008`. Detailed evidence is in
    `docs/product/inbox-v2-src-003-normalization.md`.

- [x] `INB2-SRC-004` Implement external identity and participant resolution.
  - State: `done`; Priority: `P0`; Started: `2026-07-17`; Completed:
    `2026-07-17`; Owner: `Codex`; Depends on: `INB2-SRC-003`,
    `INB2-DB-002`.
  - Acceptance: employee, client contact, conflicted and unresolved outcomes
    retain provenance/confidence; membership origins are conversation/binding
    specific; Employee/ClientContact claim commands use separate permissions,
    exact source/evidence plus old/new target are authorized conjunctively,
    manual self-claim is denied/reviewed and claims have no auth/resource side
    effects. Single-admin bootstrap uses only trusted resolver/signed import.
  - Verification: same sender in several groups does not collapse participants;
    concurrent claim, claim-to-self and claim-reassignment tests grant no
    Account, RBAC, membership, watcher/read or WorkItem state implicitly.
    Evidence: completed on `2026-07-17` with a closed SRC-003 identity
    projection, tenant-keyed long-lived HMAC namespace, stable/ephemeral
    SourceExternalIdentity materialization, all four resolver outcomes,
    historical replay, conversation-local deferred participant materialization
    and separately authorized Employee/ClientContact claim commands. Exact
    command-intent hashes, authorization epoch/dependency/decision/revision
    closure, semantic audit and DB-locked active-claim/typed-old-target fences
    reject stale or substituted claims; the coordinator alone owns transaction
    retries, self-claim and runtime migration fail closed, and re-claim after
    revoke remains legal at the exact nonzero head version. Migration `0044`
    persists immutable observations/assessments plus CAS heads using bounded
    predecessor/successor/head checks, subjectless/tokenless provenance and
    fail-closed lifecycle declarations for all three roots. Focused suites
    passed `11/11` files / `537/537` tests. The clean PostgreSQL gate applied
    `45` migrations with contract
    `sha256:686be094f65af826d67157ef67bf7fb57b6aeae774e1f15c62e2d13c56200f73`
    and passed `27/27` files / `239/239` tests; populated preserve, pinned N-1
    and RBAC passed `3/3` files / `17/17` tests. Full `pnpm check` passed `328`
    test files / `3334` executed tests plus all repository gates; `36` opt-in
    files / `282` tests were skipped by the default process and covered by the
    explicit gates. Two independent final reviews found no remaining P0/P1.
    Detailed evidence is in
    `docs/product/inbox-v2-src-004-identity-resolution.md`.

- [x] `INB2-SRC-005` Implement canonical direct/group conversation resolution.
  - State: `done`; Priority: `P0`; Started: `2026-07-17`;
    Finished: `2026-07-17`; Owner: `Codex`; Depends on: `INB2-SRC-003`,
    `INB2-DB-003`.
  - Acceptance: adapter thread realm/object/scope selects or creates exactly one
    canonical thread, conversation and binding; Client/sender/title never merge
    unrelated threads and group destination never comes from sender identity.
  - Verification: private/group, multi-account, cross-connection group,
    case-sensitive opaque ID and client-multichannel races are deterministic.
    Evidence: contract/worker/SQL focused suites passed `7/7` files and
    `69/69` tests; the disposable PostgreSQL gate applied `45` migrations and
    passed `28/28` files / `245/245` tests, including `6/6` SRC-005
    multi-connection, concurrency, alias and rollback scenarios; preserve/N-1
    passed `3/3` files / `17/17` tests; full `pnpm check` passed `332` files /
    `3374` executed tests. Detailed evidence is in
    `docs/product/inbox-v2-src-005-conversation-resolution.md`.

- [x] `INB2-SRC-006` Implement canonical dedupe and out-of-order reconciliation.
  - State: `done`; Priority: `P0`; Started: `2026-07-17`; Finished:
    `2026-07-17`; Owner: `Codex`; Depends on: `INB2-SRC-005`.
  - Acceptance: account-scoped raw observations stay distinct while exact
    adapter-scoped message refs dedupe webhook/polling/cross-account echoes;
    server-owned canonical keys compare exact adapter realm/object/scope and
    immutable message identity before reuse; late lifecycle and ambiguous weak
    correlation retain provenance instead of silently merging.
  - Verification: fixtures cover cross-account duplicate create, equal-content
    genuine messages, exact-key/candidate collision, ordered
    edit/delete-before-create, stale reaction/read, signed terminal replay,
    atomic transport links and bounded hot-key drain. Evidence: focused `8/8`
    files / `70/70` tests; disposable PostgreSQL `46` migrations and `29/29`
    files / `257/257` tests; preserve/N-1 `3/3` files / `17/17` tests; full
    `pnpm check` `338` passed files / `3,424` passed tests. Detailed evidence is
    in `docs/product/inbox-v2-src-006-message-reconciliation.md`.

- [x] `INB2-SRC-007` Materialize V2 state and outbox atomically.
  - State: `done`; Priority: `P0`; Started: `2026-07-17`; Finished:
    `2026-07-17`; Owner: `Codex`; Depends on: `INB2-SRC-004` through
    `INB2-SRC-006`.
  - Acceptance: canonical revisions/sequence, one immutable tenant commit/change
    set, domain events, idempotency result and durable outbox commit together or
    not at all; external send atomically stores Message, immutable route, the
    initial revision-1 queued dispatch with zero attempts and its outbox intent
    before provider I/O. Attempt creation and leasing start in `INB2-SRC-009`.
  - Verification: failure injection at every boundary and retry show no missing
    event/change/outbox, half-materialized message or consumed stream gap.
    Evidence: completed on `2026-07-17` with the authorized two-phase atomic
    coordinator, one-shot route/message seal capabilities, exact stream and
    provider-I/O closure, and row-driven database inverse constraints; focused
    `10` files / `212` tests, runtime review `6` / `132`, migration/finalizer
    `11` / `11`, fresh PostgreSQL `29` / `273`, preserve/N-1 `3` / `17`, and
    full unit `341` / `3509` plus the complete `pnpm check` passed. Detailed
    evidence is in
    `docs/product/inbox-v2-src-007-atomic-materialization.md`.

- [ ] `INB2-SRC-008` Complete replay, DLQ, redacted diagnostics and backpressure.
  - State: `planned`; Priority: `P1`; Depends on: `INB2-SRC-007`.
  - Acceptance: source/account isolation, durable-before-cursor acknowledgement,
    retryability, replay reason, rate-limit hints, classification/redaction before
    durable diagnostics and separate raw/normalized evidence deadlines work
    without leaking secrets/payloads; expiry ends replayability explicitly and
    leaves only a finite tenant/purpose-keyed HMAC dedupe/outcome skeleton unless
    held. Durable dedupe identity pins its key generation and guarantee window
    and contains no clear external event ID, signature, fingerprint or
    low-entropy content/time fragment.
  - Verification: polling/materialization failure, provider outage and poisoned
    event do not skip input/block other accounts; replay stays idempotent, and
    payload expiry cannot be reversed from diagnostics/hash or block bounded
    cleanup. Key rotation/retirement and guarantee-window expiry fixtures keep
    old outcomes finite and diagnosable without silently extending replay or
    falling back to clear/unkeyed weak identities. Evidence: -

- [x] `INB2-SRC-009` Implement fenced outbox lease and outcome lifecycle.
  - State: `done`; Priority: `P0`; Started: `2026-07-17`; Finished:
    `2026-07-17`; Owner: `Codex`; Depends on: `INB2-SRC-007`, `INB2-DB-007`.
  - Acceptance: claim, renew, retry, reclaim, finalize and dead-letter compare
    the current lease token; stale workers cannot store outcome/processed;
    expiry during provider I/O becomes uncertain/reconciliation and never a
    second call unless the pinned adapter operation proves retry safety;
    terminal payload is separately purgeable from the safe immutable outcome.
  - Verification: concurrent worker, stale-owner-after-reclaim, crash/renew,
    provider-timeout and retry-safe/non-idempotent fixtures prove durable outcome
    precedes `processed` and no duplicate external side effect. Evidence:
    completed and re-audited on `2026-07-17` with a provider-neutral worker
    coordinator, one-transaction outbox/provider cross-fence, durable
    attempt-before-I/O and outcome-before-finalize ordering, no-provider-call
    recovery paths, digest-only lease-token handling and exact same-lease
    terminal replay. Migration `0047` separates purgeable payload references
    from immutable safe outcome evidence, denies runtime purge and prevents
    payload resurrection while retaining additive N-1 replay compatibility.
    Focused tests passed `8/8` files / `115/115` tests; the disposable
    PostgreSQL gate applied `48` migrations with contract
    `sha256:629a81489efdd655c3024068a1a4cbd0ceee16713c32481a584a5235ea258f25`
    and passed `29/29` files / `274/274` tests; live preserve/N-1/RBAC passed
    `3/3` files / `17/17` tests; the N-1 runtime bundle and complete
    `pnpm check` passed, including `343/343` default test files / `3540/3540`
    tests. Independent final review returned `READY` with no P0/P1 findings.
    Detailed evidence is in
    `docs/product/inbox-v2-src-009-outbox-lease-lifecycle.md`.

- [ ] `INB2-EPIC-3-GATE` Verify Epic 3 exit gate.
  - State: `planned`; Priority: `P0`; Depends on: all required Epic 3 tasks.
  - Acceptance: any repeated/late fixture resolves to one canonical V2 state and
    unknown participants remain visible.
  - Verification: source contract/integration suite and `pnpm check` pass. Evidence: -

## Epic 4. Timeline And Message Lifecycle

Goal: provide one ordered, auditable timeline that supports messenger parity and
future non-chat items without a universal JSON message.

- [ ] `INB2-MSG-001` Implement monotonic timeline sequencing and item creation.
  - State: `planned`; Priority: `P0`; Depends on: `INB2-SRC-007`, `INB2-DB-005`.
  - Acceptance: concurrent inbound/outbound/system items receive unique ordered
    sequence values and preserve occurred/received/provider timestamps.
  - Verification: concurrency and retry tests produce no duplicate or regressed
    sequence. Evidence: -

- [ ] `INB2-MSG-002` Implement outbound send with explicit route and mutation ID.
  - State: `planned`; Priority: `P0`; Depends on: `INB2-MSG-001`,
    `INB2-CON-005`, `INB2-SRC-009`, `INB2-RBAC-002`.
  - Acceptance: normal send resolves exactly one structurally eligible binding,
    persists one immutable opaque route/dispatch transaction and deduplicates
    `clientMutationId`; external reply authority and exact SourceAccount use are
    conjunctive, and an explicit invalid/unauthorized route never falls back.
  - Verification: zero/multiple/invalid routes, admin disable or binding change
    before I/O, temporary-health retry and allowed reroute produce stable
    outcomes with no implicit fan-out/account hop. Evidence: -

- [ ] `INB2-MSG-003` Implement typed content blocks and attachment materialization.
  - State: `planned`; Priority: `P0`; Depends on: `INB2-MSG-001`.
  - Acceptance: text, image, audio/voice, video/video-note, file, sticker,
    location and contact content use provider-neutral classified purgeable
    blocks and tenant storage; object registry tracks checksum/version/state/
    retention class, original/derived graph and deletion evidence; file view/
    upload/delete is conjunctive with every live parent, hold and current item
    visibility, and short-lived download URLs reauthorize current access.
  - Verification: multipart/media-only and one-message-to-many-provider-artifact
    fixtures keep one route and deterministic references; unsupported/failed
    media creates a visible fallback; delete/quarantine/head/list-version adapter
    contracts and orphan reconciliation cover DB/object failure order. Purging
    one attachment parent removes only that link and keeps the shared object while
    another live parent, purpose or hold still requires it. Evidence: -

- [ ] `INB2-MSG-004` Implement reply and forward semantics.
  - State: `planned`; Priority: `P0`; Depends on: `INB2-MSG-002`.
  - Acceptance: reply preserves exact occurrence/binding/reference portability;
    explicit occurrence cannot fall back, and content copy/send-as-new and
    provider-native forward are distinct capabilities.
  - Verification: group-destination-not-sender, quoted route token, original
    deleted/unavailable, cross-route and unsupported forward fixtures return
    defined outcomes without falsifying reply semantics. Evidence: -

- [ ] `INB2-MSG-005` Implement edit/delete revisions and tombstones.
  - State: `planned`; Priority: `P0`; Depends on: `INB2-MSG-002`,
    `INB2-RBAC-002`.
  - Acceptance: revisions are append-only/auditable, the current item is
    deterministic, and lifecycle/provider delete never silently removes history
    needed by sync; privacy erasure and retention purge use distinct reason/
    content states from ADR 0015 while preserving finite sequence/author anchors;
    external propagation conjunctively authorizes exact original SourceAccount/
    binding/reference generation/capability and never reroutes.
  - Verification: duplicate, stale and edit/delete-before-create lifecycle tests
    plus unauthorized/cross-account/changed-binding cases converge to one
    revision with no provider call/reroute. Evidence: -

- [ ] `INB2-MSG-006` Implement reaction and delivery/receipt models.
  - State: `planned`; Priority: `P0`; Depends on: `INB2-MSG-002`,
    `INB2-RBAC-002`.
  - Acceptance: reactions retain actor identity where available; sent,
    delivered, read and failed reflect provider truth without invented states;
    external reaction requires exact original SourceAccount/binding/reference
    authority and capability, never a fallback route.
  - Verification: provider receipt and employee read cursor change independently;
    set/replace/clear reaction fixtures pass. Evidence: -

- [ ] `INB2-MSG-007` Implement provider echo and out-of-band outbound handling.
  - State: `planned`; Priority: `P0`; Depends on: `INB2-MSG-002`, `INB2-SRC-006`.
  - Acceptance: native-app outbound imports once; provider echo reconciles a
    pending route; attempt-before-I/O and retry-safe capability handle uncertain
    provider acceptance without blind duplicate retry.
  - Verification: echo/response/crash order permutations, cross-account echo,
    unknown sender-account and non-idempotent uncertain outcome pass without
    duplicate or false client notifications. Evidence: -

- [ ] `INB2-MSG-008` Enforce staff-only internal notes.
  - State: `planned`; Priority: `P0`; Depends on: `INB2-MSG-002`,
    `INB2-RBAC-002`.
  - Acceptance: read/create permissions and Conversation read are conjunctive;
    staff-note commands accept no route, and domain/repository/dispatch layers
    reject every attempt to create external visibility or provider delivery.
  - Verification: unit, repository and integration tests prove no delivery row,
    client/public/external webhook/export or unauthorized workforce realtime
    payload, outbox dispatch or provider call is created, including guessed-ID
    and injected-route attempts; authorized workforce sync still converges.
    Evidence: -

- [ ] `INB2-MSG-009` Implement internal direct/group messaging and membership.
  - State: `planned`; Priority: `P0`; Depends on: `INB2-MSG-001`,
    `INB2-DB-002`, `INB2-RBAC-002`.
  - Acceptance: internal direct remains exactly two Employees; internal group
    creator/owner/admin/member/observer history and last-owner recovery gate
    read/send/moderation/member management; create/find-direct does not disclose
    foreign chats, structural supervisor scope cannot read private content,
    break-glass issue/use is separated and audited read-only, and no Client/
    WorkItem/provider route is invented.
  - Verification: membership/remove/deactivate/send races, direct topology,
    group roles, break-glass and external employee-only provider-group fixtures
    preserve the internal/external authorization boundary. Evidence: -

- [ ] `INB2-MSG-010` Implement internal membership/owner drain recovery.
  - State: `planned`; Priority: `P0`; Depends on: `INB2-MSG-009`,
    `INB2-RBAC-003`.
  - Acceptance: the Employee-drain handler closes active internal access in
    bounded CAS batches, atomically appoints an eligible successor for sole-owner
    groups or enters metadata-only owner recovery, and reports a durable
    idempotent completion checkpoint without rewriting authorship.
  - Verification: high-cardinality groups, last-owner/deactivate/send/member
    races and crash/retry produce no inactive content authority or ownerless
    active group. Evidence: -

- [ ] `INB2-EPIC-4-GATE` Verify Epic 4 exit gate.
  - State: `planned`; Priority: `P0`; Depends on: all Epic 4 tasks.
  - Acceptance: the canonical timeline supports required lifecycle/media and is
    safe under retry, concurrency and late events.
  - Verification: focused lifecycle suite and `pnpm check` pass. Evidence: -

## Epic 5. Work Items, Queues And Responsibility

Goal: make actionable work operationally assignable without contaminating
conversation membership or client CRM ownership.

- [ ] `INB2-WRK-001` Implement the WorkItem lifecycle and intake creation policy.
  - State: `planned`; Priority: `P0`; Depends on: `INB2-CON-006`, `INB2-DB-004`.
  - Acceptance: external actionable input can create new/unassigned work in a
    queue; internal chats do not receive a WorkItem by default; one Conversation
    cannot have two non-terminal WorkItems in Inbox V2.
  - Verification: private unknown, group, support and employee-only scenarios
    create exactly the expected work records. Evidence: -

- [ ] `INB2-WRK-002` Implement queue routing and routing diagnostics.
  - State: `planned`; Priority: `P0`; Depends on: `INB2-WRK-001`.
  - Acceptance: routing uses tenant/org/source policy, records its decision and
    has a safe fallback queue or diagnosable failure.
  - Verification: routing table tests cover source account, org scope, disabled
    queue and no-match outcomes. Evidence: -

- [ ] `INB2-WRK-003` Implement atomic claim, assign, unassign and transfer.
  - State: `planned`; Priority: `P0`; Depends on: `INB2-WRK-001`, `INB2-DB-004`.
  - Acceptance: separate self-claim/assign/release/transfer commands validate
    source and destination scope, active target Queue eligibility and expected
    revision; compare-and-set constraints yield one active primary and immutable
    non-overlapping history. Servicing-team change separately authorizes old/new
    teams, reason and WorkItem resource revision without changing responsibility
    or fanning out Employee revisions. `claimAndReply` commits claim and Message
    or neither.
  - Verification: simultaneous claim/assign/transfer/close permutations produce
    one winner and no partial responsibility/message state; same-valid-revision
    claim loser gets `work.responsibility_conflict`, while pre-stale expected
    revision gets `revision.conflict`. Evidence: -

- [ ] `INB2-WRK-004` Implement responsibility permissions and collaboration roles.
  - State: `planned`; Priority: `P0`; Depends on: `INB2-WRK-003`,
    `INB2-RBAC-003`.
  - Acceptance: responsible, queue member, scoped supervisor, collaborator,
    watcher and internal/provider participant outcomes implement ADR 0013;
    watcher/membership grants nothing, external reply on active work uses the
    versioned responsible-only or exact-WorkItem-collaborator Queue policy (or
    audited override), and Client owner remains independent.
  - Verification: generated permission matrix denies cross-queue/tenant,
    provider/claim escalation, watcher reply and policy-disallowed collaborator
    reply while preserving allowed exact-WorkItem collaborator policy plus
    source/destination-scoped supervisor override reason/audit. Evidence: -

- [ ] `INB2-WRK-005` Implement close, reopen and new-inbound behavior.
  - State: `planned`; Priority: `P0`; Depends on: `INB2-WRK-003`.
  - Acceptance: close reason, resolution time and reopen policy are explicit;
    new inbound reopens or creates work according to tenant policy; a terminal
    actionable WorkItem can never be treated as a no-work collaborator reply,
    and proactive send is a separately authorized workflow.
  - Verification: messages inside/outside the reopen window and repeated close
    commands are idempotent. Evidence: -

- [ ] `INB2-WRK-006` Implement responsible deactivation and requeue recovery.
  - State: `planned`; Priority: `P0`; Depends on: `INB2-WRK-003`,
    `INB2-RBAC-003`, `INB2-ARCH-006`.
  - Acceptance: the Employee-drain WorkItem handler observes the authoritative
    fence, projects recovery pending and releases/requeues work in bounded CAS
    batches with history/events and a durable idempotent completion checkpoint.
    Missing destination remains diagnosably draining for the coordinator.
  - Verification: high-cardinality batch/retry, assign/transfer/close race and
    crash-resume preserve newer decisions, fence-time attribution and no
    effective inactive primary. Evidence: -

- [ ] `INB2-WRK-007` Implement priority and SLA/business-hours foundation.
  - State: `planned`; Priority: `P1`; Depends on: `INB2-WRK-001`, `INB2-ARCH-007`.
  - Acceptance: SLA clock inputs, pause conditions, timezone/calendar reference,
    due timestamps and breach events are versioned and auditable.
  - Verification: deterministic clock tests cover waiting, closed, weekend and
    timezone transitions. Evidence: -

- [ ] `INB2-EPIC-5-GATE` Verify Epic 5 exit gate.
  - State: `planned`; Priority: `P0`; Depends on: all required Epic 5 tasks.
  - Acceptance: concurrent responsibility is safe and internal chats remain
    independent from work/client ownership.
  - Verification: work lifecycle/permission suite and `pnpm check` pass. Evidence: -

## Epic 6. Inbox Projections, API And Realtime Protocol

Goal: serve high-volume lists and timelines incrementally with a formal cursor
and revision model.

- [ ] `INB2-PRJ-001` Implement the shared conversation-head projection.
  - State: `planned`; Priority: `P0`; Depends on: `INB2-EPIC-4-GATE`,
    `INB2-EPIC-5-GATE`, `INB2-RBAC-003`.
  - Acceptance: last item/activity, participants summary, source/binding,
    WorkItem state/responsible, visibility-safe preview and revision update from
    the same durable events without materializing provider/claim authority.
  - Verification: edit/delete/delivery of the last message produces the expected
    head exactly once. Evidence: -

- [ ] `INB2-PRJ-002` Implement per-employee inbox/read projections and totals.
  - State: `planned`; Priority: `P0`; Depends on: `INB2-PRJ-001`, `INB2-DB-006`.
  - Acceptance: unread, mentions, mute, pin/archive, queue folders and total badge
    are server-authoritative and do not depend on loaded list pages; actor
    composite authorization epoch and current canonical relations determine
    inclusion, while watcher state alone never creates visibility.
  - Verification: read is monotonic; own messages/history import do not create
    incorrect unread counts. Evidence: -

- [ ] `INB2-PRJ-003` Build idempotent incremental projectors and rebuild tooling.
  - State: `planned`; Priority: `P0`; Depends on: `INB2-PRJ-001`, `INB2-PRJ-002`.
  - Acceptance: work is proportional to explicitly affected entities/audience,
    never full history; head plus referenced entity/invalidation, list/totals,
    recipient sync rows and contiguous checkpoint update atomically; sync
    materialization is immutable by original position and bounded/indexed fanout;
    shadow generation rebuild/cutover can reproduce current state. When the replay
    prefix was pruned, a new generation bootstraps from a tenant-consistent
    authoritative canonical snapshot/baseline at position `N`, with generation/
    manifest/policy revisions and only lifecycle-eligible state/facts, then consumes
    changes strictly after `N`; no projector or analytics rebuild reads pruned or
    ineligible content. Access or relation loss emits remove/invalidate before
    another unauthorized payload. Rebuilds reuse the persisted recipient-state
    fingerprint and historical key generation for an unchanged entity revision;
    rekeying advances the revision or atomically cuts over `syncGeneration` and
    forces an authoritative reset.
  - Verification: duplicate, retained gap, crash before/after checkpoint, missing/
    stale baseline, snapshot-at-`N` plus tail-`>N` and full rebuild comparisons pass
    without skipping poison input, resurrecting purged data, changing an
    equal-revision fingerprint or reading full history. Evidence: -

- [ ] `INB2-API-001` Add versioned Inbox V2 list and totals endpoints.
  - State: `planned`; Priority: `P0`; Depends on: `INB2-PRJ-003`.
  - Acceptance: keyset pagination and filters cover queue, responsible, source,
    work/client state, unread and search with scoped RBAC applied before SQL/
    projection pagination and counting; page manifests and as-of checkpoints
    never claim absent paginated entities are deleted. Metadata/preview fields
    obey their content boundary independently from full Conversation read.
  - Verification: stale/list-page responses cannot overwrite newer revisions;
    selected/deep-linked conversation stays independent when outside the current
    page/filter. Evidence: -

- [ ] `INB2-API-002` Add conversation snapshot and timeline endpoints.
  - State: `planned`; Priority: `P0`; Depends on: `INB2-PRJ-003`.
  - Acceptance: one repeatable snapshot includes normalized participants, links,
    work/head revisions, component checkpoints/generation, authoritative scope
    manifest and `resumeAfter`; timeline uses sequence before/after/around
    keysets and defaults to the latest page. External content, private internal
    content, staff notes, files and every linked Client/contact are filtered by
    separate server-loaded authorization decisions.
  - Verification: concurrent snapshot/connect and long timeline/deep-link tests
    avoid fixed-page scans, dangling head references and stale resurrection.
    Evidence: -

- [ ] `INB2-API-003` Add idempotent Inbox V2 mutation endpoints.
  - State: `planned`; Priority: `P0`; Depends on: `INB2-API-002`,
    `INB2-RBAC-007`.
  - Acceptance: external reply, internal send, staff note, membership,
    edit/delete/reaction, read/mute, claim/assign/transfer/close, identity claim
    and per-Client CRM/link commands use one authoritative resource resolver,
    versioned schemas, expected entity/authorization revisions, independently checked
    secondary resources, stable `clientMutationId`, commit/position/entity
    result and stable errors; an HTTP result never skips the applied cursor.
    Denial observation uses a separately constructed bounded DB pool/executor,
    never the primary request/data pool, and retains the RBAC-007 timeout and
    circuit behavior under sink saturation or failure.
  - Verification: response-loss retries return the same canonical result,
    simultaneous same-ID requests create one sequence/commit/outbox result,
    same-ID/different-request conflicts, claim-and-reply atomicity, permission
    revoke races reauthorize stored result bodies, and uniform cross-tenant/
    hidden-ID denial does not create tenant-stream/audit amplification. Evidence: -

- [ ] `INB2-RT-001` Implement durable ordered realtime updates and SSE resume.
  - State: `planned`; Priority: `P0`; Depends on: `INB2-PRJ-003`, `INB2-CON-008`.
  - Acceptance: ingress non-bufferingly routes the same-origin path to `apps/api`;
    API validates/revalidates the shared HttpOnly session plus authorization epoch
    and ignores spoofed actor/resource headers; immutable recipient batches
    emit standard SSE `id`, support
    `Last-Event-ID`, bounded catch-up, heartbeat/lag watchdog and durable recheck;
    notify is wake-up only and no browser receives an internal secret. The live
    connection schedules reauthorization no later than session/grant/binding/
    membership/break-glass `nextAuthorizationBoundary`, without relying on a sweeper.
  - Verification: session and future grant/relation/break-glass start/expiry,
    revoke, header spoof, first-frame flush,
    cancellation/resource release, disconnect/reconnect, duplicate delivery,
    lost notify, stalled projector and slow consumer converge without loss or
    unbounded proxy buffering; network exactly-once is not claimed. Evidence: -

- [ ] `INB2-RT-002` Implement snapshot-cursor handshake, gap detection and fallback.
  - State: `planned`; Priority: `P0`; Depends on: `INB2-RT-001`, `INB2-API-002`.
  - Acceptance: the primary cursor covers the complete Employee-authorized
    Inbox independent of page/filter/selection; snapshot returns a consistent
    actor/scope/access/epoch cursor; subscribe-after closes the loss window;
    filtered ranges advance
    `scannedThrough`; invalid/future/expired/epoch/generation/access gaps request
    authoritative targeted/full resync; polling uses the exact same batches.
  - Verification: every snapshot/catch-up/live boundary, shared-RBAC/Employee/
    relation-revoked cursor (including old pre-invalidate replay),
    parse/reducer failure and background-chat outage converge without loss or
    stale overwrite; grant/membership/deactivation changes purge lost access
    before a subsequent customer-data event. Evidence: -

- [ ] `INB2-PRJ-004` Establish query/load budgets for projections and API.
  - State: `planned`; Priority: `P1`; Depends on: `INB2-API-001`, `INB2-API-002`.
  - Acceptance: representative tenant/source/message volumes have recorded query
    counts, access-predicate plans, effective-grant cache hit/miss behavior,
    latency and projection-lag budgets; no authorization-after-`LIMIT` or
    per-row effective-access lookup is permitted.
  - Verification: load harness fails when list/timeline/projector exceeds agreed
    budgets. Evidence: -

- [ ] `INB2-EPIC-6-GATE` Verify Epic 6 exit gate.
  - State: `planned`; Priority: `P0`; Depends on: all required Epic 6 tasks.
  - Acceptance: at one stream cursor, sidebar head and active timeline reference
    the same canonical revision.
  - Verification: API/realtime/rebuild suites and `pnpm check` pass. Evidence: -

## Epic 7. Shared App-Shell And Inbox UI

Goal: use one normalized client state graph across web, mobile and desktop-safe
shells.

- [ ] `INB2-UI-001` Implement the normalized Inbox V2 store in `packages/app-shell`.
  - State: `planned`; Priority: `P0`; Depends on: `INB2-EPIC-6-GATE`.
  - Acceptance: confirmed conversations, heads, participants, work items,
    messages, timelines, employee states and tombstones exist once by ID;
    ordered-ID indexes, pending overlays and epoch/generation/applied-cursor
    connection state are separate. Access invalidation purges affected
    entities/optimistic overlays before later batches apply.
  - Verification: lists contain ordered IDs only and active conversation uses the
    same entities as sidebar preview. Evidence: -

- [ ] `INB2-UI-002` Implement one reducer for snapshot, HTTP, SSE, polling and optimistic events.
  - State: `planned`; Priority: `P0`; Depends on: `INB2-UI-001`.
  - Acceptance: reducer atomically applies versioned upsert/tombstone/invalidate,
    rejects stale/equal-conflict revisions, advances cursor only after a valid
    full batch and reconciles optimistic overlay by `clientMutationId`; HTTP
    results cannot jump unknown stream positions.
  - Verification: deterministic tests cover SSE-before-POST, POST-before-SSE,
    duplicate/out-of-order lifecycle, stale HTTP after SSE, parse failure,
    provider echo and active-head shared revision. Evidence: -

- [ ] `INB2-UI-003` Make router/deep link the single selection source.
  - State: `planned`; Priority: `P0`; Depends on: `INB2-UI-001`.
  - Acceptance: URL opens/clears selected conversation independently of list
    page/filter and works through web/native deep-link adapters.
  - Verification: reload, back/forward, escape/close and conversation-outside-page
    E2E scenarios keep URL and UI consistent. Evidence: -

- [ ] `INB2-UI-004` Build the Inbox V2 sidebar, filters and totals.
  - State: `planned`; Priority: `P0`; Depends on: `INB2-UI-001`, `INB2-API-001`.
  - Acceptance: external work and internal conversations share one shell without
    fake client/assignment; keyset loading, filters and badges are server-based.
  - Verification: reorder, filter removal, background message and selected item
    outside page do not close or stale the active chat. Evidence: -

- [ ] `INB2-UI-005` Build the virtualized active timeline and bounded cache.
  - State: `planned`; Priority: `P0`; Depends on: `INB2-UI-002`, `INB2-API-002`.
  - Acceptance: backward/around pagination, anchor preservation, revisions,
    tombstones and typed timeline renderers work with an LRU conversation cache.
  - Verification: long timeline and rapid A-to-B switching tests avoid unbounded
    DOM/cache and cross-chat request cancellation. Evidence: -

- [ ] `INB2-UI-006` Build capability-driven composer and message actions.
  - State: `planned`; Priority: `P0`; Depends on: `INB2-UI-002`, `INB2-API-003`.
  - Acceptance: explicit route, external reply versus staff note, media, retry,
    internal send, reply/edit/delete/forward/reaction controls follow both
    server-derived action capabilities and binding capabilities; hidden/disabled
    controls are UX only and never reproduce enforcement policy.
  - Verification: unsupported/expired actions are unavailable with diagnosable
    feedback and staff-only never selects an external route. Evidence: -

- [ ] `INB2-UI-007` Build participant, group, WorkItem and multi-client panels.
  - State: `planned`; Priority: `P1`; Depends on: `INB2-UI-004`, `INB2-UI-005`.
  - Acceptance: roster/membership, unresolved links, client links, queue,
    responsible, collaborator/watcher, internal owner/admin/member/observer,
    history and permitted per-resource actions are visible without one fake
    client or magic supervisor.
  - Verification: two-client/three-employee mixed group, partial Client/PII
    access, internal direct/group and external employee-only group render the
    correct identities, redactions and controls. Evidence: -

- [ ] `INB2-UI-008` Complete client consistency, accessibility and native-safe UX tests.
  - State: `planned`; Priority: `P0`; Depends on: `INB2-UI-003` through `INB2-UI-007`.
  - Acceptance: loading/offline/reconnect/error states, keyboard/focus, i18n,
    tokens, slots and native-safe app-shell boundaries are covered.
  - Verification: E2E includes reconnect, pagination with incoming message,
    multi-tab/read race and deep links; `pnpm check` passes. Evidence: -

- [ ] `INB2-EPIC-7-GATE` Verify Epic 7 exit gate.
  - State: `planned`; Priority: `P0`; Depends on: all Epic 7 tasks.
  - Acceptance: the client has no independent active-message/sidebar-last-message
    state graphs and heals formal gaps through targeted resync.
  - Verification: consistency E2E evidence is recorded. Evidence: -

## Epic 8. Direct Messenger Private/Group Parity

Goal: implement Telegram, WhatsApp and MAX direct accounts through one contract
and make the Hulee matrix executable. Telegram is the reference slice, not a
provider-specific architecture.

- [ ] `INB2-DMX-001` Implement SourceCapabilities V2 and direct adapter contract harness.
  - State: `planned`; Priority: `P0`; Depends on: `INB2-ARCH-008`,
    `INB2-ARCH-010`, `INB2-CON-005`, `INB2-CON-007`, `INB2-CON-010`,
    `INB2-SRC-010`, `INB2-SRC-011`.
  - Acceptance: capability profiles belong to an exact provider surface and
    binding; they separately describe access model, private/group thread/message
    scope, opaque route token, roster fidelity/history, group read/write,
    business initiation, phone addressing, consent/reply windows,
    partner/archive/native-client restrictions, each content type,
    reply/reference portability, forward/edit/delete, reactions, receipts,
    idempotent-send/retry-safety and limits. Each exact surface also declares
    data classes/purposes, external lineage/routes and compatible lifecycle/
    export/delete handlers. Adapter roster/admin facts cannot satisfy Hulee
    permissions, and use of a capable route still requires exact SourceAccount
    authority from the core policy.
  - Verification: shared harness plus provider fixtures reject the current
    one-profile-for-all-providers assumption; negative fixtures keep Viber
    consumer QR unsupported, WeCom archive read-only and imo native reply
    disabled without a proven partner contract. A data-storing adapter with an
    unknown root or missing/incompatible handler cannot enable, upgrade or
    uninstall while retained data depends on it. Evidence: -

- [ ] `INB2-DMX-005` Implement generic channel-auth credential lifecycle and cleanup handoff.
  - State: `planned`; Priority: `P0`; Depends on: `INB2-DMX-001`,
    `INB2-CON-010`.
  - Acceptance: connector delete, session revoke/reset, challenge cancel/expiry/
    completion and validation-job terminalization synchronously make credential
    material unusable and wipe/destroy decryptable session/challenge/token data;
    only a minimized temporal outcome plus SourceAccount/binding history remains,
    and a tenant-scoped terminal anchor schedules delayed metadata cleanup in
    `INB2-OPS-010`. A hold on related source history never retains usable secrets.
  - Verification: generic repository/adapter fixtures cover delete/revoke/cancel/
    expiry versus reconnect/complete races, repeated terminalization, held source
    history and failure injection with no usable ciphertext or provider-side copy.
    Evidence: -

- [ ] `INB2-TG-001` Connect Telegram direct account/session runtime to V2 source bindings.
  - State: `planned`; Priority: `P0`; Depends on: `INB2-DMX-001`,
    `INB2-DMX-005`, `INB2-EPIC-3-GATE`.
  - Acceptance: existing auth/lease/health and egress runtime produce/maintain
    SourceConnection, SourceAccount and binding diagnostics without secret leaks.
  - Verification: auth, reconnect, revoke/delete, terminal secret-wipe handoff
    and session-health integration tests pass. Evidence: -

- [ ] `INB2-TG-002` Implement Telegram direct private flow.
  - State: `planned`; Priority: `P0`; Depends on: `INB2-TG-001`, `INB2-EPIC-5-GATE`.
  - Acceptance: known/unknown inbound, intake/routing, explicit outbound account,
    text/emoji and native-app outbound echo work through V2.
  - Verification: automated private fixture suite and live private smoke are
    recorded. Evidence: -

- [ ] `INB2-TG-003` Implement Telegram direct group and roster flow.
  - State: `planned`; Priority: `P0`; Depends on: `INB2-TG-001`, `INB2-SRC-004`, `INB2-SRC-005`.
  - Acceptance: stable group identity, title/avatar, partial/full roster,
    join/leave/admin roles, sender mapping and service events are materialized.
  - Verification: group with clients/employees/unresolved users and membership
    changes passes fixtures and live smoke. Evidence: -

- [ ] `INB2-TG-004` Complete Telegram multi-account, history and lifecycle parity.
  - State: `planned`; Priority: `P0`; Depends on: `INB2-TG-002`, `INB2-TG-003`, `INB2-EPIC-4-GATE`.
  - Acceptance: same group through two accounts dedupes; bounded
    backfill/catch-up/live states use atomic watermarks, retain live input and
    mark late history activity-ineligible without old alerts; media,
    reply/edit/delete/reaction/read follow honest Telegram capabilities.
  - Verification: automated matrix rows and live private/group smoke have task
    and evidence links. Evidence: -

- [ ] `INB2-WA-001` Implement WhatsApp direct private/group V2 flow.
  - State: `planned`; Priority: `P1`; Depends on: `INB2-TG-004`,
    `INB2-DMX-001`, `INB2-DMX-005`, `INB2-MIG-007`.
  - Acceptance: QR/link runtime, private chat, group JID/roster, participant
    changes, multi-account route, echo/history and core lifecycle use V2 only.
  - Verification: automated private/group suite plus live smoke covers text,
    receipts, reconnect and generic revoke/delete secret invalidation. Evidence: -

- [ ] `INB2-MAX-001` Implement MAX direct private/group V2 flow.
  - State: `planned`; Priority: `P1`; Depends on: `INB2-TG-004`,
    `INB2-DMX-001`, `INB2-DMX-005`, `INB2-MIG-007`.
  - Acceptance: phone/code/password runtime, private/group identity and roster,
    multi-account route, echo/history and lifecycle use V2 only.
  - Verification: automated private/group suite plus live smoke covers text,
    sent/read, reconnect and generic revoke/delete secret invalidation without
    synthesizing delivered. Evidence: -

- [ ] `INB2-DMX-002` Close direct media and special-payload parity gaps.
  - State: `planned`; Priority: `P1`; Depends on: `INB2-TG-004`, `INB2-WA-001`, `INB2-MAX-001`.
  - Acceptance: image/audio/file/video, sticker/video-note, location and contact
    behavior is capability-driven; WA vCard and MAX location/contact/media gaps
    have native or explicit fallback outcomes.
  - Verification: every matrix cell has automated evidence or a documented
    provider limitation plus required live smoke. Evidence: -

- [ ] `INB2-DMX-003` Complete direct lifecycle, receipt and reaction parity.
  - State: `planned`; Priority: `P1`; Depends on: `INB2-DMX-002`.
  - Acceptance: reply, content-copy/native-forward distinction, edit/delete,
    reaction set/clear and sent/delivered/read mappings are tested per surface.
  - Verification: no matrix row is marked complete from RIK evidence alone;
    Hulee contract/integration/smoke references are present. Evidence: -

- [ ] `INB2-DMX-004` Complete account health, diagnostics and failure isolation.
  - State: `planned`; Priority: `P1`; Depends on: `INB2-TG-001`,
    `INB2-WA-001`, `INB2-MAX-001`, `INB2-SRC-008`.
  - Acceptance: last heartbeat/provider check/inbound/outbound and safe normalized
    error code/operator hint are visible; raw provider error objects, headers,
    credentials, contact/message content and unbounded strings are redacted before
    channel session/event, connector, source diagnostic or audit persistence. One
    reconnecting or rate-limited account cannot block other accounts.
  - Verification: provider-error/secret/PII fuzzing proves every durable diagnostic
    copy is bounded and redacted; outage/recovery tests and admin smoke are recorded.
    Evidence: -

- [ ] `INB2-EPIC-8-GATE` Verify Epic 8 exit gate.
  - State: `planned`; Priority: `P1`; Depends on: all Epic 8 tasks.
  - Acceptance: Hulee-owned WA/TG/MAX private/group matrix has evidence or an
    explicitly accepted provider limitation for every required capability.
  - Verification: contract matrix suite, live smoke summary and `pnpm check` pass. Evidence: -

## Epic 9. Read State And Notifications

Goal: produce one logical notification per reason/recipient and synchronize
unread state across web, mobile and desktop without mixing provider receipts.

- [ ] `INB2-NOT-001` Implement notification preferences and endpoint lifecycle.
  - State: `planned`; Priority: `P1`; Depends on: `INB2-PRJ-002`,
    `INB2-MIG-007`.
  - Acceptance: per-employee levels, mute/quiet hours and web/mobile/desktop
    endpoints support register, refresh, disable and tenant-safe cleanup through
    self-only preference/endpoint permissions. Notification-domain temporal
    Conversation/exact-WorkItem WatcherSubscription stores self/managed source,
    reason/validity/revision, ends WorkItem watches at terminal state and never
    becomes read authority; managing another Employee uses its dedicated
    permission. Endpoint token hashes/device metadata become unusable on revoke/
    deactivation and are physically purged after their finite ADR 0015 window.
  - Verification: preference/endpoint contract, revoke-versus-delivery and
    expiry/cleanup repository tests pass. Evidence: -

- [ ] `INB2-NOT-002` Implement durable logical notification feed and dedupe.
  - State: `planned`; Priority: `P1`; Depends on: `INB2-NOT-001`, `INB2-CON-008`.
  - Acceptance: per-recipient records dedupe by tenant/event/recipient/reason
    before endpoint fan-out and retain read/open/suppressed state; logical state
    references canonical entities while short-lived classified preview/push
    payload has a separate expiry and never becomes another Message copy.
  - Verification: duplicate/replay events create one logical notification. Evidence: -

- [ ] `INB2-NOT-003` Implement recipient resolution policy.
  - State: `planned`; Priority: `P1`; Depends on: `INB2-NOT-002`,
    `INB2-WRK-004`, `INB2-MSG-009`.
  - Acceptance: external inbound, unassigned queue, direct/group internal,
    responsible, watcher, mention/reply and sender-exclusion rules are explicit;
    queue membership/watcher state alone grants no recipient content access,
    and current read authority is rechecked before materialization/delivery.
  - Verification: policy table covers mute, mention override, access loss,
    internal membership removal and employee-only external groups. Evidence: -

- [ ] `INB2-NOT-004` Implement web/native/desktop fan-out and retry.
  - State: `planned`; Priority: `P1`; Depends on: `INB2-NOT-002`, `INB2-NOT-003`.
  - Acceptance: SSE/Web Push/FCM/APNs/desktop delivery adapters use collapse/deep
    link keys, visibility/PII-safe minimal payloads, retry/DLQ and endpoint
    invalidation; no push preview survives authorization-epoch loss, restriction,
    parent content deletion or its own deadline.
  - Verification: adapter contract tests and available platform smoke are
    recorded without duplicate visible alerts. Evidence: -

- [ ] `INB2-NOT-005` Synchronize focused-window suppression, read/open and badges.
  - State: `planned`; Priority: `P1`; Depends on: `INB2-NOT-004`, `INB2-UI-008`.
  - Acceptance: active/focused conversation can suppress visible alert without
    losing server unread; open/read updates all endpoints and server totals.
  - Verification: two-tab/three-device tests keep one logical alert and correct
    badge after pagination. Evidence: -

- [ ] `INB2-NOT-006` Suppress notifications for history import, replay and own outbound.
  - State: `planned`; Priority: `P1`; Depends on: `INB2-NOT-003`, `INB2-MSG-007`.
  - Acceptance: imported history, replayed raw events, provider echoes and own
    native-app outbound cannot masquerade as a new client message.
  - Verification: fixtures do not increase unread or fan out push. Evidence: -

- [ ] `INB2-NOT-007` Add notification diagnostics, audit and E2E coverage.
  - State: `planned`; Priority: `P1`; Depends on: `INB2-NOT-004` through `INB2-NOT-006`.
  - Acceptance: operators can trace logical event to endpoint outcomes with safe
    error codes and finite payload-free diagnostics, while users can inspect/
    clear notification state and lifecycle workers verify endpoint/preview/feed
    purge without copying content into audit.
  - Verification: cross-device dedupe, retry and deep-link E2E pass. Evidence: -

- [ ] `INB2-EPIC-9-GATE` Verify Epic 9 exit gate.
  - State: `planned`; Priority: `P1`; Depends on: all Epic 9 tasks.
  - Acceptance: one logical event never creates duplicate visible alerts for one
    user and provider receipts remain independent.
  - Verification: notification suites and `pnpm check` pass. Evidence: -

## Epic 10. Client CRM, Funnel And Custom Fields

Goal: let managers analyze clients independently from conversation and WorkItem
lifecycle, including several clients in one group.

- [ ] `INB2-CRM-001` Implement client/contact identity linking and history.
  - State: `planned`; Priority: `P1`; Depends on: `INB2-CON-004`,
    `INB2-CON-010`, `INB2-DB-002`, `INB2-DB-009`, `INB2-MIG-007`.
  - Acceptance: source identities claim/unlink/reassign to ClientContacts while
    Conversation-Client links and ClientContact/Client merge remain explicit;
    ClientContact-claim permission is distinct from Employee-claim permission;
    linking requires Conversation plus every target Client permission, and
    provenance/confidence/actor/audit/history never rewrite messages. Merge
    commands operate on two current canonical roots under the tenant graph-head
    CAS and bounded-depth node projection; current Conversation pages use exact-
    revision authoritative resolution batches and independently authorize every
    resulting canonical Client. Typed ADR 0015 subject links support discovery
    and removal of current PII resolution without turning a privacy request into
    identity/authorship authority.
  - Verification: unknown-to-known, concurrent/conflicting claim and merge tests
    preserve authors, event-time facts and all historical Conversation-Client
    links without an implicit direct SourceExternalIdentity-to-Client shortcut;
    paged coalescing restarts on either link-set or merge-head revision change.
    Evidence: -

- [ ] `INB2-CRM-002` Implement tenant-configurable client pipelines and stages.
  - State: `planned`; Priority: `P1`; Depends on: `INB2-CRM-001`.
  - Acceptance: every stage uses an opaque tenant-scoped `ClientStageId`; stage
    definitions carry initial/terminal/won/lost semantics, ordering, permissions
    and optional qualification requirements. No closed global lead/qualified/
    won/lost enum is persisted; transition permission is separate from generic
    Client edit and uses the Client expected revision.
  - Verification: stage configuration/state-machine unit tests pass. Evidence: -

- [ ] `INB2-CRM-003` Implement append-only stage and lost-reason history.
  - State: `planned`; Priority: `P1`; Depends on: `INB2-CRM-002`.
  - Acceptance: every transition records from/to, actor, reason, occurred time,
    source and responsible snapshot for reporting.
  - Verification: retries are idempotent and current stage rebuilds from history. Evidence: -

- [ ] `INB2-CRM-004` Implement typed client custom fields and tags.
  - State: `planned`; Priority: `P1`; Depends on: `INB2-CRM-001`.
  - Acceptance: definitions support type, validation, visibility, options and
    indexing and sensitivity/purpose/retention policy; field/contact-PII view and
    edit permissions remain separate per Client, and values/tags have purgeable
    history/content plus minimized audit.
  - Verification: schema/permission/filter tests reject invalid/cross-tenant
    values. Evidence: -

- [ ] `INB2-CRM-005` Separate client owner from WorkItem responsible.
  - State: `planned`; Priority: `P1`; Depends on: `INB2-CRM-001`, `INB2-WRK-003`.
  - Acceptance: client owner changes have independent temporal history and never
    silently reassign current work, or vice versa; `client_owner` scope applies
    only to that Client and owner change has a dedicated permission/revision.
  - Verification: cross-change tests and audit events prove independent state. Evidence: -

- [ ] `INB2-CRM-008` Implement Client-owner drain recovery.
  - State: `planned`; Priority: `P0`; Depends on: `INB2-CRM-005`,
    `INB2-RBAC-003`.
  - Acceptance: the Employee-drain CRM handler transfers by explicit policy or
    clears current Client ownership in bounded CAS batches, preserves temporal
    owner/event-time reporting history and emits a durable idempotent completion
    checkpoint without changing WorkItem responsibility.
  - Verification: high-cardinality owner sets, concurrent owner change and
    crash/retry end with no inactive current owner or overwritten newer change.
    Evidence: -

- [ ] `INB2-CRM-006` Add CRM projection filters and client profile/timeline API.
  - State: `planned`; Priority: `P1`; Depends on: `INB2-CRM-003`, `INB2-CRM-004`.
  - Acceptance: inbox can filter by stage/field/tag/owner; client profile
    aggregates separately authorized source conversations and audit without
    merging threads or using one linked WorkItem as global Client authority.
  - Verification: group links do not multiply physical messages in profile
    summaries. Evidence: -

- [ ] `INB2-CRM-007` Build multi-client group CRM UI.
  - State: `planned`; Priority: `P1`; Depends on: `INB2-CRM-006`, `INB2-UI-007`.
  - Acceptance: roster shows zero-to-many linked clients, unresolved identities,
    per-client stage/owner/fields and explicit optional primary link; hidden
    Clients/contacts are redacted independently and mutations are all-or-none.
  - Verification: two-client group partial-view/contact/edit permission and
    hidden-target non-disclosure E2E pass. Evidence: -

- [ ] `INB2-EPIC-10-GATE` Verify Epic 10 exit gate.
  - State: `planned`; Priority: `P1`; Depends on: all Epic 10 tasks.
  - Acceptance: each client has independent CRM history and no conversation/work
    status is reused as client stage.
  - Verification: CRM integration/E2E suites and `pnpm check` pass. Evidence: -

## Epic 11. Manager Reporting And Analytics

Goal: build reproducible operational, employee, funnel and source reports from
immutable facts rather than current mutable rows.

- [ ] `INB2-REP-001` Approve the metric dictionary and fact grains.
  - State: `planned`; Priority: `P1`; Depends on: `INB2-EPIC-0-GATE`,
    `INB2-ARCH-006`, `INB2-ARCH-007`, `INB2-MIG-007`.
  - Acceptance: define inbound/outbound/internal, physical message, response
    cycle, queue wait, assignment, SLA, reopen, client attribution, timezone and
    business-hours formulas and exclusions; person-level facts, subject bridges
    and tested anonymous aggregates have distinct ADR 0015 lifecycle, while
    aggregate, drilldown, PII and export grains/fields map to separate
    permissions and current-resource checks.
  - Verification: examples resolve bot/system/internal-note, group and reassigned
    cases without ambiguous counting. Evidence: -

- [ ] `INB2-REP-002` Implement immutable message/activity and assignment facts.
  - State: `planned`; Priority: `P1`; Depends on: `INB2-REP-001`, `INB2-PRJ-003`.
  - Acceptance: facts retain actual author, transport account, responsible,
    queue/team/org event-time snapshot, source, occurred/received time and
    assignment interval without treating current grants/owners as historical
    facts; content is not copied, and removable/pseudonymous subject bridges are
    separate from the minimized event-time fact skeleton.
  - Verification: changing today's assignee/client owner does not change historic
    attribution. Evidence: -

- [ ] `INB2-REP-003` Implement inbox operations and SLA aggregates.
  - State: `planned`; Priority: `P1`; Depends on: `INB2-REP-002`, `INB2-WRK-007`.
  - Acceptance: volumes, unassigned/backlog/aging, assignment time, first/next
    human response, resolution, reopen, transfer and SLA p50/p90/p95 are available.
  - Verification: deterministic event fixtures reproduce expected aggregates. Evidence: -

- [ ] `INB2-REP-004` Implement operator workload and quality aggregates.
  - State: `planned`; Priority: `P1`; Depends on: `INB2-REP-002`.
  - Acceptance: assigned/touched/replied/noted/resolved/transferred work and
    concurrency are attributed to real authors/intervals, not current ownership.
  - Verification: shared-conversation and transfer fixtures do not double-count
    operator work. Evidence: -

- [ ] `INB2-REP-005` Implement CRM funnel and multi-client attribution facts.
  - State: `planned`; Priority: `P1`; Depends on: `INB2-CRM-003`, `INB2-REP-002`.
  - Acceptance: conversion, time-in-stage, source attribution, lost reasons and
    owner-at-transition use a bridge table instead of multiplying message facts.
  - Verification: linking three clients does not triple physical message volume;
    each client still receives explicit attribution. Evidence: -

- [ ] `INB2-REP-006` Implement delivery, source health and future-source metrics.
  - State: `planned`; Priority: `P2`; Depends on: `INB2-DMX-004`, `INB2-REP-002`.
  - Acceptance: delivery/read/failure/retry/reaction, session uptime, ingestion
    lag and projection lag support provider/account dimensions; calls and source
    items have reserved typed dimensions.
  - Verification: provider limitations do not become fake zero/success states. Evidence: -

- [ ] `INB2-REP-007` Add incremental rollups, rebuild and reconciliation.
  - State: `planned`; Priority: `P1`; Depends on: `INB2-REP-003` through `INB2-REP-006`.
  - Acceptance: hourly/daily aggregates update incrementally and can rebuild from
    eligible immutable events/facts with discrepancy reporting; deletion/
    restriction markers and the erasure ledger prevent rebuild from resurrecting
    subject bridges/content, and anonymity is revalidated after reaggregation.
    After replay pruning, rebuild bootstraps only lifecycle-eligible facts from the
    authoritative baseline at `N` and consumes the tail after `N`.
  - Verification: clean and pruned-prefix baseline-plus-tail rebuilds equal
    incremental eligible results for the shared fixture corpus. Evidence: -

- [ ] `INB2-REP-008` Build manager API/UI/export with scoped RBAC.
  - State: `planned`; Priority: `P1`; Depends on: `INB2-REP-007`,
    `INB2-RBAC-003`.
  - Acceptance: tenant/org/queue/team/date/source filters and timezone metadata
    use event-time fact dimensions; aggregate view/export contain no content,
    roster/contact/stable-row IDs, enforce fixed dimensions, minimum-five-cell/
    complementary suppression and differencing budgets; named operator reports
    require workforce-dimension plus Employee-directory permission and exclude
    private internal chats. Drilldown/PII/export conjunctively reauthorize every
    underlying resource. Manager/report export remains distinct from tenant and
    data-subject exports, rechecks authorization epoch per bounded chunk and
    before download, and quarantines/deletes all partial/object versions on
    revoke or expiry.
  - Verification: aggregate-only manager, partial underlying access, PII denial,
    revocation mid-export, staff-note exclusion, correct export and uniform
    cross-tenant/hidden-ID E2E pass. Evidence: -

- [ ] `INB2-EPIC-11-GATE` Verify Epic 11 exit gate.
  - State: `planned`; Priority: `P1`; Depends on: all required Epic 11 tasks.
  - Acceptance: reports are reproducible and historically correct after
    reassignment, client changes and projection rebuild.
  - Verification: report reconciliation suite and `pnpm check` pass. Evidence: -

## Epic 12. Calls, Marketplaces And Other Source Readiness

Goal: prove that Inbox V2 is a source-of-work platform rather than a messenger
UI with additional JSON payloads.

- [ ] `INB2-EXT-001` Implement generic non-message timeline/work materialization contracts.
  - State: `planned`; Priority: `P2`; Depends on: `INB2-EPIC-4-GATE`, `INB2-EPIC-5-GATE`.
  - Acceptance: source object/thread keys can create typed timeline items and an
    optional actionable WorkItem without pretending to be messenger messages;
    each typed action declares its own permission/resource/PII contract instead
    of inheriting `message.reply`.
  - Verification: call, review, marketplace question and lead fixtures share
    core boundaries without provider-specific core branches. Evidence: -

- [ ] `INB2-EXT-002` Implement call timeline items and WorkItem policy.
  - State: `planned`; Priority: `P2`; Depends on: `INB2-EXT-001`.
  - Acceptance: inbound/outbound/missed/answered state, participants, wait,
    duration, recording/transcript/derivative refs, notice/consent or other
    approved purpose evidence and client/employee links are typed; call metadata,
    recording, transcript, summary/embedding and aggregate metrics have
    independent ADR 0015 permissions/lifecycle.
  - Verification: duplicate provider updates converge and missed-call routing is
    diagnosable. Evidence: -

- [ ] `INB2-EXT-003` Implement marketplace/classified/review source items.
  - State: `planned`; Priority: `P2`; Depends on: `INB2-EXT-001`.
  - Acceptance: listing/order/question/review identity, reply window, external
    link/native/read-only capability and business context remain outside message
    text; native reply still requires source-account/route and WorkItem authority.
  - Verification: at least one fixture per source type materializes, routes and
    renders through the shared contract harness. Evidence: -

- [ ] `INB2-EXT-004` Build capability-driven actions and typed UI renderers.
  - State: `planned`; Priority: `P2`; Depends on: `INB2-EXT-002`, `INB2-EXT-003`, `INB2-UI-005`.
  - Acceptance: call/review/question/order/lead items expose only valid actions
    and extend approved slots without provider UI branches in the inbox shell.
  - Verification: read-only/expired/external-link/native actions and responsive
    rendering pass component/E2E tests. Evidence: -

- [ ] `INB2-EXT-005` Extend notification and reporting policies for source items.
  - State: `planned`; Priority: `P2`; Depends on: `INB2-EXT-002`, `INB2-EXT-003`, `INB2-NOT-007`, `INB2-REP-006`.
  - Acceptance: missed calls, new questions/reviews and reply-window/SLA events
    have recipient, dedupe and metric definitions distinct from messages.
  - Verification: fixture outcomes match notification/metric dictionary. Evidence: -

- [ ] `INB2-EXT-006` Extend the source adapter contract harness for non-chat sources.
  - State: `planned`; Priority: `P2`; Depends on: `INB2-EXT-001` through
    `INB2-EXT-005`, `INB2-CON-010`.
  - Acceptance: raw storage, idempotency, identity/conversation keys, reply
    capability, diagnostics, replay and typed materialization are verified; every
    data-storing surface declares data classes/purposes, external lineage/routes
    and compatible lifecycle/export/delete handlers.
  - Verification: a sample adapter passes without importing messenger contracts;
    missing storage-root classification/handler and unsafe uninstall fixtures fail.
    Evidence: -

- [ ] `INB2-EPIC-12-GATE` Verify Epic 12 exit gate.
  - State: `planned`; Priority: `P2`; Depends on: all Epic 12 tasks.
  - Acceptance: new source kinds can enter one inbox shell without changing the
    Conversation/Message core model or report grains.
  - Verification: shared non-chat fixture/E2E suite passes. Evidence: -

## Epic 13. Performance, Security And Operations

Goal: verify the 50+ source-account workload, isolation and recovery behavior in
SaaS, isolated SaaS and on-prem data planes.

- [ ] `INB2-OPS-001` Approve the Inbox V2 capacity profile and SLOs.
  - State: `planned`; Priority: `P0`; Depends on: `INB2-EPIC-0-GATE`,
    `INB2-BASE-001`.
  - Acceptance: record expected tenants, 50+ accounts, events/sec and bursts,
    active users/SSE, history batches, retention, latency, lag and recovery budgets.
  - Verification: assumptions have data/source or are explicitly labeled initial
    test targets with an owner for revision. Evidence: -

- [ ] `INB2-OPS-002` Implement end-to-end observability and correlation.
  - State: `planned`; Priority: `P1`; Depends on: `INB2-SRC-009`, `INB2-RT-001`.
  - Acceptance: raw event to normalization, resolution, transaction, outbox,
    projection, SSE, notification and dispatch share safe correlation IDs plus
    tenant-head lock wait, stream/projection lag, catch-up and resync metrics.
  - Verification: one test event is traceable without exposing secrets/content in
    restricted operational views. Evidence: -

- [ ] `INB2-OPS-003` Add database, projection and realtime load harnesses.
  - State: `planned`; Priority: `P1`; Depends on: `INB2-PRJ-004`,
    `INB2-OPS-001`, `INB2-OPS-010`, `INB2-OPS-011`.
  - Acceptance: harness covers ingestion burst, hot conversation, large tenant,
    many accounts, list/timeline/access-predicate queries, wide grants,
    mass role/binding revoke, reconnect storm and projection rebuild without an
    Employee x Conversation authorization materialization. Lifecycle coverage
    includes millions of independently eligible rows, many tenants/classes,
    policy preview, fenced purge batches, object versions/shared-parent graphs,
    one hot prospective hold and pruned-prefix snapshot-plus-tail rebuild with
    bounded locks, memory, queue growth and per-tenant failure isolation.
    Denial-retention load includes a very large tenant catalog, repeated worker
    restarts, slow/locked oldest batches and multiple replicas so checkpoint
    fairness, tail progress, duplicate work and bounded-pool isolation are measured.
  - Verification: agreed latency/error/lag/retention-throughput and maximum lock/
    batch budgets are asserted under normal, hot-hold and crash/retry load; results
    and representative query plans are saved. Evidence: -

- [ ] `INB2-OPS-004` Add account isolation, backpressure and failure tests.
  - State: `planned`; Priority: `P1`; Depends on: `INB2-SRC-008`, `INB2-DMX-004`.
  - Acceptance: provider outage/rate limit/poison event/reconnect loop has scoped
    concurrency, retry budget, circuit/backoff and cannot block other accounts.
  - Verification: chaos tests prove bounded queue growth and recovery. Evidence: -

- [ ] `INB2-RBAC-006` Orchestrate fenced Employee deactivation to completion.
  - State: `planned`; Priority: `P0`; Depends on: `INB2-WRK-006`,
    `INB2-CRM-008`, `INB2-MSG-010`, `INB2-NOT-003`.
  - Acceptance: `active -> draining` atomically fences sessions, authority,
    notifications and assignment eligibility; a persisted idempotent coordinator
    runs registered bounded WorkItem/Client/internal-membership recovery handlers
    and reaches `inactive` only after every required checkpoint and zero effective
    primary/current-owner relation. Extensions can register handlers without
    company/provider branches in core.
  - Verification: high-cardinality mixed ownership, missing destination,
    handler crash/retry/reorder and concurrent manual changes never finalize
    early, overwrite a newer decision or require an unbounded transaction.
    Evidence: -

- [ ] `INB2-RBAC-004` Run the Inbox V2 adversarial authorization suite.
  - State: `planned`; Priority: `P0`; Depends on: `INB2-API-003`,
    `INB2-RT-002`, `INB2-MSG-009`, `INB2-WRK-006`, `INB2-CRM-007`,
    `INB2-REP-008`, `INB2-RBAC-005`, `INB2-RBAC-006`.
  - Acceptance: generated matrix/IDOR tests cover scoped admin/audit, structural
    paths, active/terminal/no-work reply policy, internal privacy/owner recovery,
    staff-note/file parent visibility, source/target identity claims,
    multi-client PII, notifications, report suppression/export, deactivation and
    bounded shared/Employee/relation authorization revisions.
  - Verification: HTTP/SSE/replay/idempotent-result/file URL/push/export revoke,
    hidden/cross-tenant guessed IDs, mass revoke/reconnect and bounded denial
    audit tests have no unresolved P0/P1 result. Evidence: -

- [ ] `INB2-OPS-005` Complete tenant, RBAC, IDOR and secret/PII security review.
  - State: `planned`; Priority: `P0`; Depends on: `INB2-EPIC-6-GATE`,
    `INB2-EPIC-7-GATE`, `INB2-EPIC-8-GATE`, `INB2-EPIC-9-GATE`,
    `INB2-EPIC-10-GATE`, `INB2-EPIC-11-GATE`, `INB2-EPIC-12-GATE`,
    `INB2-RBAC-004`, `INB2-OPS-013`, `INB2-OPS-014`.
  - Acceptance: composite same-tenant DB relationships, repository/API/event/
    storage/lifecycle-worker isolation, scoped reports, push privacy, raw/audit
    diagnostic redaction and external/support data routes are reviewed.
  - Verification: schema introspection plus automated cross-tenant permission/
    destructive-delete/object/export/hold suite and a completeness gate prove
    every SQL/JSON/blob/object/index/cache/log/backup/external-route root has one
    tenant-safe class/purpose/anchor/parent/handler mapping; documented review has
    no unresolved P0 finding. Evidence: -

- [ ] `INB2-OPS-006` Implement lifecycle policy resolution, legal hold and processing restriction.
  - State: `planned`; Priority: `P0`; Depends on: `INB2-DB-009`,
    `INB2-RBAC-003`.
  - Acceptance: one server-owned ADR 0015 evaluator loads the active versioned
    tenant-local `DataGovernanceContext` and resolves its deployment/jurisdiction/
    legal-role/residency envelope, purpose deadlines, tenant choice and entitlement;
    versioned hold/restriction fences, prospective/frozen scope, preview,
    approval/cooling and current revision are checked before destructive I/O;
    credentials/secrets are never hold eligible and policy/hold grants no read.
    Only an effective policy with mandatory `tenantId` can authorize a destructive
    plan; a global template cannot. Restriction limits processing but cannot by
    itself extend retention, bypass a legal maximum or synthesize a legal hold.
  - Verification: missing/stale/mismatched governance context fails closed; policy
    precedence/change preview, hold-versus-purge CAS, release/reschedule,
    restriction-versus-AI/export/expiry, tenant-less policy/run rejection,
    separation of duties, cross-tenant IDOR and offline on-prem tests pass.
    Evidence: -

- [ ] `INB2-OPS-010` Implement bounded retention and replay-purge orchestration.
  - State: `planned`; Priority: `P1`; Depends on: `INB2-OPS-006`,
    `INB2-SRC-008`, `INB2-MSG-005`, `INB2-RT-002`, `INB2-DMX-005`,
    `INB2-PRJ-003`.
  - Acceptance: tenant/data-class workers freeze policy/high-water, use fenced
    leases and expected revisions, make content unavailable transactionally,
    dispatch registered purge handlers and verify absence; raw/normalized,
    event/outbox, timeline content/tombstones, auth/notification/audit classes
    have independent rules. After synchronous invalidation owned by `INB2-DMX-005`,
    terminal connector/session/challenge/validation metadata and any residual
    encrypted material are physically purged on their short independent deadline
    without deleting held SourceAccount/binding history. Before replay prefix
    pruning, orchestration verifies a tenant-consistent authoritative bootstrap
    baseline at boundary `N` for every required projection/analytics generation;
    it contains only lifecycle-eligible canonical state/facts and preserves hold/
    deletion markers. Replay deletes only a contiguous position prefix and
    atomically advances its tenant/generation retained minimum, never a provider/
    server timestamp. Tenant/class batching remains bounded under millions of
    eligible rows and hot hold scopes without cross-tenant scans or long locks.
    Production runners persist or lease partitioned checkpoints, add bounded
    jitter between replicas, retry retryable SQLSTATEs with batch downshift and
    expose lag/saturation/repeated-failure metrics; lifecycle executors are typed
    and cannot be constructed from an unbounded primary application pool.
  - Verification: mixed old/new timestamp-position, hot hold scope, stale lease/
    newer revision, handler crash/reorder and crash around prefix/minimum update
    plus terminal credential rows with held source history remain idempotent and
    bounded; focused high-cardinality purge/preview tests meet batch/lock budgets.
    Prune-then-bootstrap-at-`N`-plus-tail rebuild matches eligible canonical state
    and never reports false completion, resurrects content or retains usable secrets.
    Evidence: -

- [ ] `INB2-OPS-011` Implement object, derivative, index/cache and external deletion handlers.
  - State: `planned`; Priority: `P1`; Depends on: `INB2-OPS-010`,
    `INB2-MSG-003`, `INB2-NOT-007`, `INB2-REP-007`, `INB2-EXT-002`.
  - Acceptance: version-aware object delete/quarantine/head/list, thumbnails/
    transcodes/OCR, recording/transcript/AI/vector, search/cache, notification/
    export and adapter-declared provider handlers use one idempotent ledger;
    shared-file parents and holds are conjunctive, orphan reconciliation is
    bounded, and provider/device/recipient residuals remain explicit.
  - Verification: DB-before-object/object-before-DB failures, version/delete
    marker, one-parent-purged/another-live shared object, final-parent deletion,
    hold race, missing handler, rebuild and provider confirmed/unsupported/unknown
    fixtures prove no premature object loss or false “fully deleted”.
    Evidence: -

- [ ] `INB2-OPS-012` Implement privacy request, tenant export and erasure orchestration.
  - State: `planned`; Priority: `P1`; Depends on: `INB2-OPS-006`,
    `INB2-OPS-011`, `INB2-CRM-001`, `INB2-REP-008`.
  - Acceptance: verified subject access/portability, correction, restriction,
    erasure and tenant offboarding export/delete use distinct workflows,
    jurisdiction due/extension state, deterministic plus reviewed discovery,
    mixed-group third-party redaction, per-root decisions/exceptions, encrypted
    short-lived manifests/artifacts and current authorization per chunk/download;
    manager export remains separate. A provider/device/recipient copy outside the
    operated data plane may produce `completed_with_external_residuals`; verified
    primary purge awaiting bounded backup/object-version expiry produces
    `primary_purged_backup_expiry_pending`; any other internal handler/copy or
    unproven verification produces `verification_blocked_internal_residual` and
    cannot be presented as completed.
  - Verification: reused phone/multiple identities, multi-client/employee group,
    partial approval/hold, access revoke mid-export, failed partial artifact,
    content erasure with stable finite authorship, provider/device residual,
    primary-purged backup tail and internal object/index/ledger residual E2E each
    produce the exact non-overloaded status. Evidence: -

- [ ] `INB2-OPS-013` Implement finite typed audit and destruction-evidence lifecycle.
  - State: `planned`; Priority: `P1`; Depends on: `INB2-OPS-010`,
    `INB2-OPS-012`, `INB2-RBAC-007`.
  - Acceptance: domain, successful privileged/security, bounded denial, privacy
    evidence and platform audit use typed allowlisted envelopes, immutable
    conflict/tamper evidence, scoped facets and finite policies; sensitive
    evidence is a separate restricted purgeable object, and Russian destruction
    evidence profile can retain the required three-year safe receipt without
    retained content.
  - Verification: payload/secret fuzzing cannot enter generic audit, same-ID/
    different-hash conflicts, scoped pagination, audit access/export, evidence
    expiry/hold and destruction evidence-receipt tests pass. Evidence: -

- [ ] `INB2-OPS-014` Build the tenant-local data-governance administration surface.
  - State: `planned`; Priority: `P1`; Depends on: `INB2-RBAC-002`,
    `INB2-OPS-006`, `INB2-OPS-012`, `INB2-OPS-013`.
  - Acceptance: versioned tenant-local application/API/UI surfaces manage
    `DataGovernanceContext`, policy draft/preview/approval/activation, privacy
    request cases, restrictions, legal holds, tenant/subject exports and delete/
    erasure run status including operated-backup and external residual taxonomy.
    Every read/action uses the dedicated ADR 0013 scope matrix, current resource/
    evidence authority, expected revisions, separation of duties and cooling/
    approval rules; governance/request/hold status access grants no implicit
    Message, Client, file, recording, staff-note or provider credential access.
  - Verification: tenant admin/privacy officer/approver/content-reader matrices,
    concurrent preview-versus-activation, self-approval, revoke mid-operation,
    hidden/cross-tenant guessed IDs and stale context/policy revisions produce
    uniform safe outcomes with no PII/content in list/status/audit surfaces.
    Evidence: -

- [ ] `INB2-OPS-009` Verify Inbox V2 deployment packaging.
  - State: `planned`; Priority: `P0`; Depends on: `INB2-EPIC-2-GATE`,
    `INB2-EPIC-6-GATE`, `INB2-EPIC-8-GATE`, `INB2-OPS-013`,
    `INB2-OPS-014`.
  - Acceptance: SaaS/isolated/on-prem Compose/Helm packaging includes required
    API/SSE/workers, direct-source runtimes, lifecycle/export/delete workers,
    migrations, version-aware object deletion, storage/network paths, finite
    log/trace/support-bundle lifecycle and the closed storage-root/handler
    registry, tenant-local governance administration API/UI, secret/config/
    governance-profile boundaries and health/start ordering without mandatory
    SaaS control-plane connectivity in the data plane.
  - Verification: fresh packaged SaaS-like and on-prem installs migrate, start,
    ingest/dispatch one fixture, reconnect Inbox V2 and expose no secret in
    image/config/log evidence. Evidence: -

- [ ] `INB2-OPS-007` Verify backup/restore and on-prem control-plane independence.
  - State: `planned`; Priority: `P1`; Depends on: `INB2-OPS-009`,
    `INB2-OPS-013`.
  - Acceptance: restored data-plane rotates stream epoch when positions can be
    reused, reapplies newer erasure/hold/restriction ledgers before traffic and
    resumes source processing, leases/outbox, projections, SSE and local license/
    governance policy without permanent SaaS control-plane connectivity;
    backups/object versions have finite expiry and cannot resurrect export/
    content/identity into active processing. Verified primary absence with a
    known finite backup/version tail remains `primary_purged_backup_expiry_pending`
    until expiry evidence closes it; an unproven or live operated-data-plane copy
    is `verification_blocked_internal_residual`, never
    `completed_with_external_residuals`.
  - Verification: documented restore/on-prem drill forces old cursors to resync,
    reapplies deletion receipts before API/workers/search and proves backup/object
    expiry plus offline export/delete/hold evidence. Status-transition tests cover
    primary purge, pending expiry, verified expiry and failed internal
    verification. Evidence: -

- [ ] `INB2-OPS-008` Publish runbooks, alerts and operator diagnostics.
  - State: `planned`; Priority: `P1`; Depends on: `INB2-OPS-002` through
    `INB2-OPS-007`, `INB2-OPS-009` through `INB2-OPS-014`.
  - Acceptance: runbooks cover lag, stuck lease, DLQ/replay, broken account,
    projection rebuild, notification failure, policy/hold, privacy request,
    partial export/delete, object/provider residual, backup erasure replay,
    backfill and rollback with thresholds.
  - Verification: another operator can execute representative recovery steps. Evidence: -

- [ ] `INB2-EPIC-13-GATE` Verify Epic 13 exit gate.
  - State: `planned`; Priority: `P0`; Depends on: all required Epic 13 tasks.
  - Acceptance: agreed SLO/security/recovery gates are factually met for the
    release profile.
  - Verification: saved load, security, failure and restore evidence is complete. Evidence: -

## Epic 14. V1 Compatibility, Cutover And Removal

Goal: preserve and reconcile the discovered live V1/provider/object/backup state,
move all internal clients/source flows to V2 and remove the obsolete V1
implementation before WA/MAX/CRM/reporting expansion. `INB2-MIG-001` failed the
conditional pre-production fast-path gate, so compatibility/backfill/shadow and
the full ADR 0014 preserve path are active.

- [x] `INB2-MIG-001` Inventory every Inbox V1 producer, consumer and stored row.
  - State: `done`; Priority: `P0`; Started: `2026-07-16`; Completed:
    `2026-07-16`; Owner: `Codex`; Depends on: `INB2-EPIC-0-GATE`,
    `INB2-ARCH-007`, `INB2-ARCH-009`, `INB2-BASE-001`.
  - Acceptance: Public API, Telegram Bot/direct runtime, web actions, seed/tests,
    outbox/dispatch, silent delivery/attachment lifecycle writes, file-content
    reads, routing event plus separate audit, `saveReply` compatibility paths,
    raw/normalized/provider/auth/notification/tenant+platform-audit JSON copies,
    shared account/employee/RBAC/org/session and deployment-egress roots, object
    metadata/versions/source URLs, caches/indexes/logs/backups, reports and every
    known SaaS/isolated/on-prem deployment are dated, classified under ADR 0015
    or recorded as an explicit fail-closed catalog gap, and mapped to cutover/
    delete steps; missing inventory is not proof that no copy or deployment exists.
  - Verification: repository-wide search and runtime/deployment inventory have no
    unexplained V1 dependency. Evidence: preserve revision
    `mig-001-preserve-2026-07-16-r1` in
    `docs/product/inbox-v2-mig-001-inventory-and-disposition.md`; three
    independent code/data/deployment reviews; read-only local and known shared
    SaaS PostgreSQL, object storage, GitHub/deploy and backup inspection. The
    live data plane, non-empty provider/API/session/object/backup state and
    unknown fleet/consumer roots select `preserve`; unknown external roots are
    fail-closed and assigned to downstream tasks. Exact operational evidence is
    retained outside the public repository.

- [ ] `INB2-MIG-002` Implement additive compatibility and dual materialization.
  - State: `planned`; Priority: `P0`; Reactivated: `2026-07-16` by the
    `INB2-MIG-001` preserve disposition; Depends on: `INB2-EPIC-2-GATE`,
    `INB2-EPIC-5-GATE`, `INB2-MIG-001`.
  - Activation reason: the known shared SaaS deployment and current local
    upgrade fixture must be preserved; provider I/O cannot be duplicated.
  - Acceptance: first supplies a reviewed, resumable online schema bridge for
    the historical `0029`/`0036` boundaries (concurrent indexes, staged
    constraints, bounded backfills and explicit generated-column rewrite or
    maintenance disposition) and proves exact target schema/journal equivalence
    before enabling materialization. Existing v1 contracts then remain stable
    while current inbound flows materialize V2 through one canonical command; a
    minimum audited materialization phase/kill switch exists here, provider I/O
    has one owner, and outbound prefers explicit V2 binding while measuring
    legacy fallback.
  - Verification: the normal install preflight accepts the reviewed bridge
    result without a test bypass; representative populated V1, current Public
    API/Telegram Bot/inbox tests still pass and V2 rows/events are correct.
    Evidence: -

- [ ] `INB2-MIG-003` Implement repeatable backfill and diagnostic report.
  - State: `planned`; Priority: `P0`; Reactivated: `2026-07-16` by the
    `INB2-MIG-001` preserve disposition; Depends on: `INB2-MIG-002`,
    `INB2-DB-008`.
  - Activation reason: legacy business/provider/object/backup state must be
    reconciled without inventing author, route, roster or delivery facts.
  - Acceptance: owns the operational, bounded and resumable MigrationRun/entity
    mapping ledger and data backfill; legacy client/participants/assignment/
    messages become V2 links, WorkItems, sequence and authors where recoverable;
    payload roots receive data class/parent/anchor and subject-link candidates
    without inventing purpose/consent, while ambiguous route/roster/PII scope is
    restricted and reported for resync/manual action rather than guessed.
  - Verification: rerun is safe, frozen legacy sequence prefixes never renumber
    live V2 items, queued+processed/no-attempt rows remain non-dispatchable,
    missing Queue blocks WorkItem cutover and reconciliation totals/reasons are
    stable. Evidence: -

- [ ] `INB2-MIG-004` Finalize migration disposition and required cutover controls.
  - State: `planned`; Priority: `P0`; Depends on: `INB2-MIG-001`,
    `INB2-MIG-002`, `INB2-MIG-003`, `INB2-EPIC-6-GATE`.
  - Acceptance: records the revisioned preserve disposition and every eligibility
    condition; `INB2-MIG-002/003` are completed, and this task implements one
    validated server-owned phase, semantic shadow, tenant/Conversation-sticky
    command authority, SourceAccount/binding-fenced dispatch and
    `v1Representable` rollback fence.
  - Verification: disposition evidence has no unexplained deployment/consumer/
    data dependency; preserve evidence additionally has zero unexplained semantic
    diff and proves legal canary/rollback transitions. Evidence: -

- [ ] `INB2-MIG-005` Cut over all internal Inbox and Telegram paths directly to V2.
  - State: `planned`; Priority: `P0`; Depends on: `INB2-MIG-004`,
    `INB2-DB-008`, `INB2-EPIC-6-GATE`, `INB2-EPIC-7-GATE`, `INB2-TG-004`.
  - Acceptance: Public API composition, Telegram Bot/direct runtime, web/API/
    realtime, workers and seeds use the same V2 command/projection/source owners;
    provider I/O remains exactly-once-authoritative and no V2 handler calls V1
    domain/repository/routing/authorization helpers. Immediately before the first
    authority-switch CAS, the command atomically reloads and revalidates the
    `INB2-MIG-004` disposition revision and every applicable preserve gate/control
    artifact. Stale or changed disposition fails closed before any V1 read/write,
    listener or dispatch authority changes. The selected preserve path requires
    completed `INB2-MIG-002/003` and the fenced ADR 0014 handoff. Only a future,
    separately approved disposable target rechecks every fast-path condition and
    may omit preserve controls.
  - Verification: repository/runtime inventory plus private/group Telegram,
    rebuild/reconnect and provider failure/uncertain-outcome tests show one V2
    path and zero legacy fallback. Evidence: -

- [ ] `INB2-MIG-006` Complete pre-removal V2 acceptance and rollback drill.
  - State: `planned`; Priority: `P0`; Depends on: `INB2-MIG-005`,
    `INB2-MIG-001`, `INB2-ARCH-007`, `INB2-EPIC-0-GATE`,
    `INB2-EPIC-1-GATE`, `INB2-EPIC-2-GATE`, `INB2-EPIC-3-GATE`,
    `INB2-EPIC-4-GATE`, `INB2-EPIC-5-GATE`, `INB2-EPIC-6-GATE`,
    `INB2-EPIC-7-GATE`.
  - Acceptance: the V2 domain/source/message/work/projection/API/realtime/UI and
    Telegram private/group slice pass together. For the selected preserve path,
    this task owns the early V1-applicable removal subgate required by
    `INB2-MIG-007`: it freezes the C01-C24/D01-D31 root/class/handler graph and
    retained-shared-root exclusions; proves no unknown supported deployment,
    image, Public API consumer or V1-bearing copy; covers supported N-1,
    isolated/on-prem upgrades; rehearses DB+object backup/restore, stream reset
    and allowed V1 authority rollback; records a V2 facade or completed
    deprecation for Public API `/v1`; and observes zero internal V1 read/write/
    dispatch/fallback for `30` consecutive days. Later `INB2-OPS-007/009`
    productize and reuse this scoped evidence; they are not prerequisites that
    would create a post-MIG-007 dependency cycle.
  - Verification: a signed, current V1-removal dossier contains applicable ADR
    0015 lifecycle/hold/delete/audit handler coverage, fleet/consumer/copy/image
    inventory, clean plus representative upgrade results, supported deployment
    upgrade matrix, backup/restore and epoch/generation drill, provider-side-
    effect reconciliation, rollback boundaries and the uninterrupted `30`-day
    zero-use window. Any unexplained V1-bearing copy, missing handler in the
    applicable V1-removal graph, fallback or incident resets or blocks this
    subgate. Declared retained-shared exclusions remain recorded and block their
    later privacy/operations gate rather than scoped V1 removal. Evidence: -

- [ ] `INB2-MIG-007` Remove V1 reads, writes, fallback routes and obsolete schema.
  - State: `planned`; Priority: `P0`; Depends on: `INB2-MIG-001`,
    `INB2-MIG-005`, `INB2-MIG-006`, `INB2-ARCH-007`.
  - Acceptance: the signed `INB2-MIG-006` early-removal dossier is current and
    every selected preserve-path backfill, shadow, observation, backup/rollback,
    hold/evidence, fleet/consumer and supported-version removal gate still passes;
    Inbox V1 core/contracts, DB tables/repositories, internal Inbox route/client/
    actions, Public API/Telegram composition, worker dispatch, legacy
    `message.sent` intent and obsolete seed/fixtures/tests are removed or replaced
    by V2. Persisted/published schema IDs and migration history remain stable or
    change only through an explicit versioned compatibility migration; alias-free
    rename/squash is forbidden. Only a future separately approved disposable
    target whose fast-path evidence remains current may collapse internal
    `InboxV2` names and squash unpublished migrations without compatibility
    aliases. Generic `/internal/v1` surfaces unrelated to Inbox are not deleted by
    prefix.
  - Verification: repository/object/index/cache/deployment search, clean V2
    install/reset/seed, projection/realtime rebuild, Telegram smoke and full
    check show zero V1 Inbox runtime, fallback or undeclared retained copy;
    preserve additionally proves schema-catalog/replay/upgrade compatibility.
    Evidence: -

- [ ] `INB2-MIG-008` Publish final V2 operating and development documentation.
  - State: `planned`; Priority: `P1`; Depends on: `INB2-MIG-007`.
  - Acceptance: product docs, ADRs, adapter guide, runbooks, API/event docs and
    onboarding explain one canonical Inbox implementation; public/event/module
    schema versions remain explicit and are not described as legacy support.
  - Verification: documentation links/commands are reviewed on fresh checkout
    and on-prem package. Evidence: -

- [ ] `INB2-EPIC-14-GATE` Verify Epic 14 and release gate `G7`.
  - State: `planned`; Priority: `P0`; Depends on: all Epic 14 tasks,
    `INB2-EPIC-8-GATE`, `INB2-EPIC-9-GATE`, `INB2-EPIC-10-GATE`,
    `INB2-EPIC-11-GATE`, `INB2-EPIC-12-GATE`, `INB2-EPIC-13-GATE`.
  - Acceptance: V2 is the only supported production path and V1 removal is
    complete after the selected preserve backfill, observation and release gates;
    rollback remains possible up to the documented irreversible boundary.
  - Verification: final release evidence and verification log are complete. Evidence: -

## Cross-Epic Acceptance Scenarios

These scenarios are release-level checks. A scenario is checked only when its
linked automated tests and required runtime/provider smoke are recorded.

- [ ] `INB2-ACC-001` Unknown private sender creates an ExternalIdentity,
      conversation and unassigned WorkItem in the correct queue.
- [ ] `INB2-ACC-002` Known sender resolves to the existing source thread/client
      without duplicate conversation or message.
- [ ] `INB2-ACC-003` A group with two external participant identities linked to
      two Clients and three Employee personas preserves five distinguishable
      participants, two independent Client links and one primary WorkItem
      responsible.
- [ ] `INB2-ACC-004` An external employee-only group requires neither a fake
      client nor a WorkItem by default.
- [ ] `INB2-ACC-005` Internal direct has exactly two employees, no client and no
      responsible; duplicate authorized creation returns the same conversation
      without disclosing it to a non-participant.
- [ ] `INB2-ACC-006` Internal group supports role/membership changes and never
      loses its owner except through metadata-only owner recovery; structural
      supervisors cannot read it and staff-only content never becomes external.
- [ ] `INB2-ACC-007` One provider group visible to two direct accounts produces
      one conversation and one canonical message with two source occurrences;
      group reply uses the selected group route, never sender private identity.
- [ ] `INB2-ACC-008` Removing the active account selects only an allowed fallback
      route before dispatch or blocks send; an explicit/persisted route never
      changes account implicitly and disable-before-I/O calls no provider.
- [ ] `INB2-ACC-009` Native provider-app outbound is imported as outbound and does
      not notify agents as a client inbound.
- [ ] `INB2-ACC-010` Provider echo reconciles the optimistic message without a
      duplicate regardless of POST/SSE/echo order; uncertain provider acceptance
      is not blindly retried without adapter-proven idempotency.
- [ ] `INB2-ACC-011` Multipart media has deterministic grouping and unsupported
      media creates visible fallback instead of silent loss; split provider
      artifacts retain one Hulee Message route and separate references.
- [ ] `INB2-ACC-012` Reply, edit, delete, reaction and receipt events converge
      correctly when duplicated, stale or delivered before create.
- [ ] `INB2-ACC-013` Provider receipts and employee `lastReadSequence` change
      independently.
- [ ] `INB2-ACC-014` Active timeline and sidebar atomically converge from one
      commit and reference the same normalized Message revision at one cursor.
- [ ] `INB2-ACC-015` SSE reconnect and expired-cursor resync lose no messages and
      leave no duplicate final state, including background conversations.
- [ ] `INB2-ACC-016` History import/replay changes neither unread nor visible
      notification counts.
- [ ] `INB2-ACC-017` Two operators claim simultaneously; exactly one becomes
      primary responsible and the other receives a stable conflict.
- [ ] `INB2-ACC-018` Responsible deactivation atomically fences authority/
      eligibility, exposes recovery-pending work, then bounded retry-safe
      recovery returns work to valid queues and resolves Client/group ownership
      before `inactive`, with complete temporal history.
- [ ] `INB2-ACC-019` A staff-only note cannot create provider dispatch under any
      route/capability combination.
- [ ] `INB2-ACC-020` Mention/reply notifications obey recipient, mute and quiet
      hour policy and current content authority; access loss suppresses pending
      previews, and one event across devices stays one logical alert.
- [ ] `INB2-ACC-021` Every client in a group has independent stage, owner and
      custom fields plus independent contact/sensitive-field visibility.
- [ ] `INB2-ACC-022` Manager reports use author/responsible at event time, not
      current values; aggregate access alone reveals no content/person row and
      named workforce/PII drilldown/export require conjunctive permissions.
- [ ] `INB2-ACC-023` Linking three clients to a group does not triple physical
      message volume.
- [ ] `INB2-ACC-024` Tenant A cannot read/mutate tenant B threads, participants,
      files, notifications, stream events or report facts.
- [ ] `INB2-ACC-025` Failure/reconnect/rate limit of one account does not block
      ingestion or dispatch for other accounts and does not silently reroute a
      pinned dispatch.
- [ ] `INB2-ACC-026` Raw-event replay is idempotent and produces a safe diagnostic
      and audit trail.
- [ ] `INB2-ACC-027` Call/review/marketplace fixtures render as typed timeline
      items and use their own action/metric semantics.
- [ ] `INB2-ACC-028` Clean V2 install/reset, projection rebuild, backup/restore
      with stream-epoch rotation and rollback drills all reproduce a usable inbox;
      after a replay prefix is pruned, a new projection/report generation uses an
      authoritative eligible baseline at `N` plus tail `>N`, never deleted history.
- [ ] `INB2-ACC-029` Queue member, primary responsible, scoped supervisor,
      Conversation collaborator, exact-WorkItem collaborator, watcher, Client
      owner and internal/provider participant produce the exact distinct ADR
      0013 read/reply/note/transfer/notification outcomes.
- [ ] `INB2-ACC-030` A grant on Client A never opens its group Conversation or
      Clients B/C; Conversation read returns only authorized/redacted Client,
      contact, custom-field, participant and roster data.
- [ ] `INB2-ACC-031` Active WorkItem reply follows its versioned responsible-only
      or WorkItem-collaborator Queue policy; closing work cannot bypass it, and a
      true employee-only no-work provider group replies through explicit Hulee
      collaboration plus exact source-account authority.
- [ ] `INB2-ACC-032` Provider owner/admin/member and an Employee identity claim
      grant no Hulee read/reply/membership/work authority; Employee versus
      ClientContact claim permissions, source evidence and manual self-claim
      denial are enforced.
- [ ] `INB2-ACC-033` Tenant, role/binding, Employee or resource-relation revoke
      prevents the next HTTP/idempotent-result/file/push/SSE replay payload even
      when an old recipient delta precedes the invalidate.
- [ ] `INB2-ACC-034` Scoped `employees.manage` and `audit.view` cannot mutate/read
      outside their target scope, and guessed IDs produce bounded uniform denial
      without tenant-stream/outbox amplification.
- [ ] `INB2-ACC-035` Staff-note/internal/external attachments require their
      parent visibility, short-lived file access is reauthorized, and no generic
      Client/file grant opens hidden content.
- [ ] `INB2-ACC-036` Aggregate reports enforce approved dimensions, minimum-cell/
      differencing controls and private-internal exclusion; revocation deletes
      partial export and invalidates its download.
- [ ] `INB2-ACC-037` Approved subject/content erasure removes direct PII and every
      derived copy while retaining only the finite technical participant-author,
      sequence and redaction tombstone; no Client/Employee author is invented.
- [ ] `INB2-ACC-038` Legal hold racing a retention/privacy purge wins by revision
      fence before physical I/O, grants no read/export, and release only
      reschedules policy evaluation; processing restriction limits use but does
      not become a hold or extend an expired purpose/legal maximum by itself.
- [ ] `INB2-ACC-039` Object/version, derivative, index/cache or provider deletion
      failure remains retryable/explicit and can never produce a false fully
      deleted result or expose stage-one unavailable content; purging one parent
      cannot remove a shared object still required by another parent/purpose/hold.
- [ ] `INB2-ACC-040` Raw/normalized payload expiry ends replayability explicitly
      but a finite tenant-keyed skeleton still prevents duplicate materialization
      without retaining a reversible payload/header/content hash.
- [ ] `INB2-ACC-041` A verified subject export/erasure request in a mixed
      multi-client/multi-employee group discovers aliases, protects every other
      person's content/identity and records per-root exceptions/residuals.
- [ ] `INB2-ACC-042` Restoring a backup reapplies newer erasure/hold/restriction
      ledgers before API/workers/search/analytics and cannot resurrect content,
      identity resolution, notification preview or export artifact; a bounded
      backup tail is `primary_purged_backup_expiry_pending`, while an unproven/live
      internal residual is `verification_blocked_internal_residual` and never an
      external-residual completion.
- [ ] `INB2-ACC-043` Connector/session/challenge revoke or delete immediately
      invalidates usable credential material and physically purges it after its
      short window even when related source history is held.
- [ ] `INB2-ACC-044` Analytics rebuild after subject/content deletion removes
      personal bridges, never recreates content and retains longer-lived output
      only when the aggregate passes the approved irreversible-anonymity test.
- [ ] `INB2-ACC-045` Plan downgrade, non-payment or license expiry cannot bypass a
      legal minimum/maximum or hold and leaves authorized read, privacy/tenant
      export, deletion and evidence operations usable.
- [ ] `INB2-ACC-046` Production enable/start rejects an unknown SQL/JSON/blob/
      object/index/cache/log/backup/external-route storage root, a missing or
      incompatible lifecycle handler, and any tenant-less effective policy or
      destructive run; module uninstall cannot orphan retained data.
- [ ] `INB2-ACC-047` With an active hold, Employee UI delete/moderation may create
      only the explicitly allowed unavailable/tombstone state; provider delete,
      physical SQL/content/object/key purge and external delete calls are blocked
      with a durable explicit outcome, while the hold grants no read/export.
- [ ] `INB2-ACC-048` A projector or analytics generation starting after replay
      prefix pruning bootstraps from one tenant-consistent eligible baseline at
      `N`, consumes only tail `>N` and converges without resurrecting erased,
      restricted, held-hidden or otherwise ineligible content/facts.

## First Work Package

Work starts with `INB2-BASE-001`, followed by `INB2-ARCH-001` and
`INB2-ARCH-002`. The first implementation-changing task is `INB2-CON-001` only
after the Epic 0 architecture gate is verified.

The first package must produce:

1. a checked current-state baseline with `pnpm check` evidence;
2. the scenario/glossary document changes;
3. the ADR separating Conversation, WorkItem, CRM and employee user state;
4. a review note listing exact current code/schema compatibility points;
5. no Inbox V1 schema expansion or provider-specific UI work yet.

## Verification Log

Append one row when a task becomes `done`. Do not use the log instead of updating
the task state, checkbox and evidence above.

| Date       | Task               | Verification evidence                                                      | Commit/PR    | Verified by                       |
| ---------- | ------------------ | -------------------------------------------------------------------------- | ------------ | --------------------------------- |
| 2026-07-10 | `INB2-BASE-001`    | Baseline inventory; targeted 13/103; full 145/724 and all gates            | working tree | Codex + `baseline_verify`         |
| 2026-07-10 | `INB2-ARCH-001`    | Glossary/scenario matrix review; requirements consistency; full check      | working tree | Codex + `scenario_glossary`       |
| 2026-07-10 | `INB2-ARCH-002`    | ADR 0009 review against ADR 0001-0008; full check                          | working tree | Codex + `domain_adr_review`       |
| 2026-07-10 | `INB2-ARCH-003`    | ADR 0010 code/identity/security/consistency review; full check             | working tree | Codex + four reviewers            |
| 2026-07-10 | `INB2-ARCH-004`    | ADR 0011 Hulee/RIK route review; exact thread/route fixtures; check        | working tree | Codex + two reviewers             |
| 2026-07-10 | `INB2-ARCH-005`    | ADR 0012 Hulee/RIK/transaction review; snapshot-stream races; check        | working tree | Codex + three reviewers           |
| 2026-07-10 | `INB2-ARCH-006`    | ADR 0013 RBAC/code/security/product/backlog review; full check             | working tree | Codex + four reviewers            |
| 2026-07-10 | `INB2-ARCH-007`    | ADR 0015; 58 classes; DG-001..012; 205/48 graph; full 145/724              | working tree | Codex + three reviewers           |
| 2026-07-10 | `INB2-ARCH-008`    | 504-cell direct matrix; 44 RIK rows; focused 10/62; full 145/724           | working tree | Codex + three reviewers           |
| 2026-07-11 | `INB2-ARCH-009`    | ADR 0014 fast/preserve amendment; V1/outbox audit; graph re-review         | working tree | Codex + four reviewers            |
| 2026-07-10 | `INB2-ARCH-010`    | Surface/evidence policy; 31 links; 145/724 and all gates                   | working tree | Codex + three reviewers           |
| 2026-07-10 | `INB2-EPIC-0-GATE` | Cross-ADR review; 205/48 graph; 504 cells; full 145/724                    | working tree | Codex + three reviewers           |
| 2026-07-11 | `INB2-CON-001`     | IDs/version/catalog contracts; focused 4/28; full 149/752 and gates        | working tree | Codex + three reviewers           |
| 2026-07-11 | `INB2-CON-002`     | Conversation contract; focused 5/97; full 150/821 and all gates            | working tree | Codex + three reviewers           |
| 2026-07-11 | `INB2-CON-003`     | Participant/identity graphs; focused 6/144; full 151/868 and gates         | working tree | Codex + three reviewers           |
| 2026-07-11 | `INB2-CON-004`     | Client links/bounded merge; focused 8/199; full 153/923 and gates          | working tree | Codex + three reviewers           |
| 2026-07-11 | `INB2-CON-005`     | Thread/binding/route/dispatch; focused 15/343; full 160/1067 + gates       | working tree | Codex + domain/security reviews   |
| 2026-07-11 | `INB2-CON-006`     | WorkItem/assignment/SLA contracts; focused 6/53; full 164/1104 + gates     | working tree | Codex + independent review        |
| 2026-07-11 | `INB2-CON-007`     | Timeline/lifecycle contracts; focused 28/479; full 173/1203 + gates        | working tree | Codex + two reviewers             |
| 2026-07-11 | `INB2-CON-008`     | Command/event/realtime contracts; focused 40/578; full 185/1302 + gates    | working tree | Codex + two reviewers             |
| 2026-07-12 | `INB2-CON-010`     | Privacy/lifecycle contracts; critical 5/60; full 199/1425 + gates          | working tree | Codex + two reviewers             |
| 2026-07-12 | `INB2-RBAC-001`    | 101x12 catalog; focused 13/13; full 200/1438 + applicable gates            | working tree | Codex + two reviewers             |
| 2026-07-13 | `INB2-RBAC-002`    | Pure authorization policy; focused 10/585; full 209/2010 + gates           | working tree | Codex + two reviewers             |
| 2026-07-13 | `INB2-RBAC-005`    | Resource-scoped admin/audit; focused 21/284; full 217/2150 + gates         | working tree | Codex + security reviews          |
| 2026-07-13 | `INB2-CON-009`     | In-memory scenario runner; focused 4/19; full 213/2029 + gates             | working tree | Codex + acceptance/security       |
| 2026-07-13 | `INB2-EPIC-1-GATE` | Public-boundary proof; scenario 6/38; focused 68/1311; full 219/2169       | working tree | Codex + independent reviews       |
| 2026-07-13 | `INB2-DB-001`      | Conversation/head DB; PG 7/7; focused 4/94; full 221/2185 + gates          | working tree | Codex + three reviewers           |
| 2026-07-14 | `INB2-DB-002`      | Identity/participants/client links; shared PG 13/124; full 247/2511        | working tree | Codex + two reviewers             |
| 2026-07-14 | `INB2-DB-003`      | Thread/binding/outbound; PG 13/124; outbound 6/6; full 247/2511            | working tree | Codex + two reviewers             |
| 2026-07-14 | `INB2-DB-004`      | WorkItem/assignment DB; PG 14 files; DB 70/617; full 250/2540              | working tree | Codex + two reviewers             |
| 2026-07-14 | `INB2-DB-005`      | Timeline/message DB; PG 18/18; DB 73/666; full 254/2577                    | working tree | Codex + two reviewers             |
| 2026-07-15 | `INB2-DB-006`      | Employee state/read DB; PG 4/4; migration 3/3; full 258/2605               | working tree | Codex + three reviewers           |
| 2026-07-15 | `INB2-DB-009`      | Governance/privacy DB; PG 22/22; migration 8/8; full 271/2718              | working tree | Codex + three reviewers           |
| 2026-07-15 | `INB2-RBAC-003`    | Authorization relations/fences; live 23/23; focused 9/522; full 277/2782   | working tree | Codex + independent reviews       |
| 2026-07-15 | `INB2-RBAC-007`    | Bounded denial sink/review; live 14/14; focused 9/480; full 286/2850       | working tree | Codex + independent reviews       |
| 2026-07-15 | `INB2-DB-007`      | Repository foundation; PG 4/4; migration 4/4; full 296/2954                | working tree | Codex + three reviewers           |
| 2026-07-16 | `INB2-MIG-001`     | C01-C24/D01-D31 inventory; preserve; full 298/2968 and all gates           | working tree | Codex + independent reviews       |
| 2026-07-16 | `INB2-DB-008`      | Preserve 3/17; reset 1/1; focused 5/72; full 302/3024 + gates              | working tree | Codex + independent reviews       |
| 2026-07-16 | `INB2-DB-010`      | Coherence/TRUNCATE; lifecycle 6/6; preserve 3/17; reset 1/1; full 303/3031 | working tree | Codex + three independent reviews |
| 2026-07-16 | `INB2-EPIC-2-GATE` | Fresh PG 23/219; preserve/reset/lifecycle; full 304/3041 and all gates     | working tree | Codex + independent reviews       |
| 2026-07-16 | `INB2-SRC-001`     | Map; focused 12/71; independent 8/45, 12/89, 3/74; full 304/3041           | working tree | Codex + three independent reviews |
| 2026-07-16 | `INB2-SRC-010`     | Source registry; focused 7/191; live PG 6/6; N-1 2/2; full gate            | working tree | Codex                             |
| 2026-07-16 | `INB2-SRC-002`     | Raw ingress/lease; PG 25/232; preserve 3/17; full 316/3229 + all gates     | working tree | Codex + three independent reviews |
| 2026-07-16 | `INB2-SRC-003`     | Normalize/complete; focused 5/66; PG 26/238; preserve 3/17; full 320/3281  | working tree | Codex + two independent reviews   |
| 2026-07-17 | `INB2-SRC-004`     | Identity/claims; focused 11/537; PG 27/239; preserve 3/17; full 328/3334   | task commit  | Codex + two independent reviews   |
| 2026-07-17 | `INB2-SRC-007`     | Atomic commit; focused 10/212; PG 29/273; preserve 3/17; full 341/3509     | task commit  | Codex + two independent reviews   |
| 2026-07-17 | `INB2-SRC-009`     | Fenced provider I/O; focused 8/115; PG 29/274; preserve 3/17 + all gates   | task commit  | Codex + three independent reviews |
