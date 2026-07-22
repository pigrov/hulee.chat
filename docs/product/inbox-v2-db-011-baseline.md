# INB2-DB-011 Clean Inbox V2 Baseline

Date: `2026-07-21`

Status: `done`

## Outcome

The unpublished `0000..0056` migration and snapshot chain is replaced by one
clean `0000_inbox_v2_baseline` migration, one Drizzle snapshot and one journal
entry. The baseline is the only supported database epoch. Databases from the
old epoch are deliberately unsupported and must be recreated through the
guarded disposable reset flow.

The schema no longer contains the Inbox V1 relations
`conversations`, `conversation_participants`, `messages`,
`message_delivery_attempts` and `message_attachments`, or the V1 enums
`conversation_type`, `message_direction` and `message_status`.

Historical preserve, N-1, backfill, migration-finalizer, RBAC dry-run and
reviewed-online-bridge tooling was deleted. Installation now applies the one
baseline directly and fails closed on catalog drift. This pulled the
schema/tooling slice of `INB2-CLEAN-003` forward because the new baseline could
not compile while V1 table exports and preserve-only tests remained attached to
the database package. Residual V1 API, UI, core and provider code remains owned
by `INB2-CLEAN-003`.

## Baseline construction

The retained-schema source was PostgreSQL `16.11` at revision
`abe184723fd74e167d8722a348eafc67f1789e9b`, after applying all 57 unpublished
migrations and then dropping only the five V1 relations and three V1 enums
without `CASCADE`.

The source migration contract was
`sha256:bef4a8f76df9224c159ba3b098928a3f177ca45ce59c288e35948b91ec66c067`.
The resulting single-baseline migration contract is
`sha256:21f7d69ab7abd54fdd47b049a952332882ff63a139bcea1d6d91ee80b5abc8c6`.

The baseline contains:

- 312 Drizzle-managed tables;
- 261 enums;
- the managed application roles and their security attributes;
- schema, relation, routine and database ACLs;
- all retained indexes, constraints, functions and non-internal triggers;
- explicit `SECURITY DEFINER` search-path guards and reset receipts.

`scripts/db/generate-inbox-v2-baseline.mjs` is the one-time reproducible
PostgreSQL 16 dump normalizer. `pnpm db:check` now rejects anything except one
SQL migration, one matching journal entry and one current Drizzle snapshot. It
also rejects the removed V1 names and verifies the retained roles, routines,
triggers, ACLs and security definitions.

## Retained catalog proof

The retained clean-baseline catalog checkpoint contains 14,619 normalized rows
with digest
`sha256:e552f4e499dd6f778bf15d277370c2277261c0756568708450fb0db7c73b8a01`.
It was recaptured from the single-migration baseline at schema-changing revision
`853eaed42a2bb8256810a9d49c73bc0406a057a7` after the reviewed MSG-006 reaction
closure extended two existing invariant functions; no relation, column, index,
constraint, trigger, role or type count changed:

| Object kind |  Rows |
| ----------- | ----: |
| Columns     | 9,218 |
| Constraints | 2,669 |
| Indexes     | 1,220 |
| Triggers    |   600 |
| Functions   |   327 |
| Types       |   261 |
| Relations   |   315 |
| Roles       |     4 |
| Schemas     |     2 |
| Sequences   |     2 |
| Database    |     1 |

ACLs and owners are part of the normalized definitions for their schema,
relation, column, routine and database objects. The physical database name,
actual database-owner name and that owner's ACL grantee/grantor tokens are
replaced with explicit placeholders so the proof is portable across SaaS and
on-prem role names. Internal PostgreSQL constraint triggers and physical column
ordinals are excluded/normalized because their generated identifiers/positions
are not portable across a dump-and-recreate cycle. Constraint expressions keep
their exact deparsed grouping; no whitespace or parentheses are discarded.

Verification of the clean baseline against the retained source returned:

- missing objects: `0`;
- changed objects: `0`;
- unexpected objects: `0`;
- forbidden V1 objects: `0`.

The catalog verifier is also called after guarded reset, so reset fidelity is
checked independently from Drizzle snapshot parity.

## Lifecycle and reset boundary

Installation no longer accepts an online-bridge override and no longer reports
expand-DDL risk. It applies the clean baseline under bounded lock/statement
budgets, validates the migration contract, then validates schema, roles, ACLs
and invariant definitions. The baseline removes only owner assignments to the
source deployment role while retaining four intentional security-function
owners. A static DB gate rejects any future hard-coded deployment owner.

Guarded reset still requires the reviewed disposable-target manifest, exact
database identity/inventory evidence, no live effects, no active connections or
prepared transactions and exact confirmation. Reset recreates `public` with
owner `pg_database_owner`, reapplies the one baseline and records the immutable
reset receipt. Repeating a completed reset is an idempotent no-op only when its
receipt and current catalog still match.

The remote disposable environment is intentionally not reset in DB-011. That
operational reset, object-state cleanup and proof that no V1 process reconnects
are explicit acceptance criteria of `INB2-CLEAN-GATE`, after residual V1 code is
removed by `INB2-CLEAN-003`.

## Verification

- lifecycle, catalog normalization, DB-check library and install-contract unit
  suites: `4/4` files, `44/44` tests, including adversarial constraint grouping;
- an independent fresh database owned by `hulee_db011_alt_owner` passed install,
  repeated idempotent install and the exact 14,619-row catalog comparison with
  zero fixed `OWNER TO hulee` statements in the baseline;
- source gate after historical migration-test removal: `79/79` files,
  `1,230/1,230` tests;
- clean install/current/idempotency/guarded reset PostgreSQL suite: `1/1` file,
  `2/2` exhaustive tests, including two independent fresh databases and three
  successful guarded resets;
- full Inbox V2 PostgreSQL gate: `34/34` files, `373` passed tests and `6`
  declared scenario skips;
- full `pnpm check`: `363` passed files / `4,131` passed tests, with `33` files /
  `381` tests skipped by declared environment gates; formatting, ESLint,
  TypeScript, DB parity, i18n, encoding, branding, native and clean-slate checks
  all passed;
- independent final review found the owner-portability and over-broad constraint
  normalization issues above; both were fixed and reverified with no remaining
  P0/P1/P2 blocker;
- `git diff --check` and the final staged-scope audit are required immediately
  before the task commit.
