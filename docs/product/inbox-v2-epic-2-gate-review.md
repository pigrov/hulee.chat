# Inbox V2 Epic 2 Exit Gate Review

- Gate: `INB2-EPIC-2-GATE`
- Reviewed: `2026-07-16`
- Result: `READY`

## Decision

Epic 2 has a complete PostgreSQL persistence foundation. The final
repository-wide check, fresh/current PostgreSQL corpus and independent
latest-tree reviews passed, so the exit gate is complete. All 13 implementation
prerequisites are `done`:

- `INB2-DB-001` through `INB2-DB-006`;
- `INB2-DB-009`;
- `INB2-RBAC-003` and `INB2-RBAC-007`;
- `INB2-DB-007`;
- `INB2-MIG-001`;
- `INB2-DB-008`;
- `INB2-DB-010`.

The gate uses two complementary proofs. A fresh/current database must be
created by the ordinary migration runner and pass the complete opt-in
repository/schema corpus. A representative V1 database must retain its V1
facts while the explicitly test-only DB-008 compatibility path reaches the
same current migration contract.

## Fresh And Current Database Proof

`pnpm test:inbox-v2:postgres` is the durable local/CI entrypoint. It:

1. discovers every opt-in PostgreSQL integration file below the Inbox V2
   repository and schema roots;
2. creates a strictly named disposable child database from an explicit
   administrator `DATABASE_URL`;
3. runs the ordinary `pnpm db:migrate` path with no compatibility bypass;
4. runs the discovered corpus with file parallelism disabled;
5. terminates child connections and drops the database in cleanup.

The current bundle contains `39` migrations through `0038` and is bound to
contract SHA-256
`8f557592491940c1f61a81bf5aa734f2b089967831e641ac3ba146e924a312ad`.
The end-to-end runner passed `23/23` files and `219/219` tests on PostgreSQL 16,
then left zero `hulee_inbox_v2_gate_*` databases. A dedicated PostgreSQL 16 CI
job now executes this command instead of allowing the opt-in repository corpus
to remain skipped by the default unit-test process.

## Invariant Closure

The installer audits exact relations, constraints, indexes, functions and
triggers rather than treating a complete migration journal as sufficient.
Reviewed reset is the only path that may repair a damaged disposable target.

| Boundary      | Database-owned proof                                                                                                                                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tenant        | Tenant-owned primary/unique keys and composite foreign keys prevent cross-tenant Conversation, participant, thread, binding, WorkItem, assignment, timeline, authorization and privacy relations.                                     |
| Thread        | ExternalThread key digests/canonical targets are unique; ExternalThread transport/topology agrees with its Conversation; SourceThreadBinding belongs to the exact thread/account scope.                                               |
| Participation | Typed participant subjects, membership episodes/transitions, provider evidence and ordering heads are constraint- and revision-owned; provider origin remains immutable while later evidence advances only the transition cause/head. |
| Assignment    | One non-terminal WorkItem per Conversation and one active primary assignment per WorkItem are partial-unique database invariants with exact tenant/work-item references and eligibility fences.                                       |
| Sequence      | ConversationHead is mandatory; timeline sequence/activity and revision/stream clocks agree with committed TimelineItems; direct delete, stale update, forged head and invariant-owned `TRUNCATE` fail closed.                         |
| Authorization | Relation episodes, bounded tenant/Employee/resource revisions, audit/event/change/outbox sealing and denial storage commit atomically without permission-only or provider-membership authority.                                       |
| Privacy       | Governance contexts, policy authority, holds, requests, export/delete runs, destructive checkpoints and restore ledger use exact tenant/revision/hash fences and retain no raw PII in generic evidence.                               |

The audited current-schema manifest contains twelve relations, twenty-nine
constraints, five indexes, twenty-four exact functions and thirty-two exact
triggers beyond the earlier installer baseline. It includes the gate-critical
tenant/thread/assignment/sequence contracts and every object introduced by
migration `0038`: one relation, eleven functions, fourteen triggers, three
constraints and two indexes. The tamper lane removes or weakens representative
relations, tenant and thread foreign keys, partial assignment indexes, the
DB-010 check, functions, triggers and timeline index; install rejects each
damaged state and a reviewed reset restores the exact contract.

## Gate Regression Closure

The first complete fresh/current run found five failures that earlier focused
checks had missed:

- a provider membership transition used its new roster evidence for both the
  immutable episode origin and the transition cause, causing a false episode
  revision conflict;
- an Employee deactivated while a membership start waited on the database lock
  surfaced as raw SQLSTATE `23514` instead of the existing non-disclosing
  `participant_not_found` result.

The mutation payload now carries separate immutable episode-origin and current
transition provider anchors. Only the current evidence advances the provider
ordering head. The repository translates only the exact SQLSTATE/message pair
`23514` / `inbox_v2.internal_membership_subject_or_employee_invalid`, after the
transaction has rolled back; other integrity failures remain exceptions. New
unit regressions cover both boundaries, the two formerly failing live files pass
`27/27`, and the complete fresh/current corpus passes `219/219`.

## Verification Log

| Check                                                                       | Result                                                                       |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Ordinary fresh migration plus all opt-in repository/schema PostgreSQL tests | `39/39` migrations; `23/23` files; `219/219` tests passed                    |
| Representative V1 preserve, pinned N-1 runtime and RBAC dry run             | `3/3` files; `17/17` tests passed                                            |
| Conversation/Head/timeline migration lifecycle                              | `1/1` file; `6/6` tests passed                                               |
| Disposable install/reset and gate-critical tamper repair                    | `1/1` file; `2/2` tests passed on PostgreSQL 16 with prepared transactions   |
| Lifecycle and fresh-runner unit suites                                      | `2/2` files; `27/27` tests passed                                            |
| Focused membership payload/result regressions                               | `3/3` files; `32/32` tests passed; live `2/2` files and `27/27` tests passed |
| Migration/schema contract check                                             | `pnpm db:check` passed                                                       |
| Full formatting, lint, TypeScript, tests and repository gates               | `pnpm check` passed; `304/3041` passed; `31/258` opt-in tests skipped        |
| Independent latest-tree schema/migration and repository/security reviews    | `READY`; no remaining P0/P1/P2 findings                                      |

## Explicit Boundary

This gate proves fresh/current V2 persistence and test-only representative V1
schema preservation. It does **not** authorize production or on-prem expand,
backfill, cutover, V1 removal, or a destructive reset of retained customer data.

- `INB2-MIG-002` still owns the reviewed online bridge and dual-write boundary;
- `INB2-MIG-003` still owns operational backfill and reconciliation;
- `INB2-MIG-006` still owns supported deploy-image and backup/restore proof;
- `INB2-OPS-009` and `INB2-OPS-007` still own packaged migration ordering and
  productized restore evidence.

The DB-008 compatibility switch remains strict, explicit and ephemeral. A
complete journal or a successful test fixture is never production authority.

## Exit

`INB2-EPIC-2-GATE` is complete. The next critical-path task is `INB2-SRC-001`.
