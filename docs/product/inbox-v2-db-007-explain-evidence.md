# Inbox V2 DB-007 Representative EXPLAIN Evidence

- Task: `INB2-DB-007`
- Migration boundary: finalized `0036_inbox_v2_repository_foundation`
- Last verified: `2026-07-15`
- PostgreSQL profile: PostgreSQL 16, a temporary database migrated from zero
  through journal index `36`
- Executable evidence:
  `scripts/db/inbox-v2-repository-foundation-explain.integration.test.mjs`

## What This Gate Proves

The integration test creates a temporary PostgreSQL database, applies the exact
checked-in migrations through `0036`, loads bounded representative rows, runs
`ANALYZE`, and executes every path with:

```sql
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
```

The assertions deliberately ignore estimated cost, wall-clock time, row-width
and exact join implementation. Those values are environment- and PostgreSQL-
version-dependent. The gate instead verifies all of the following:

1. the intended tenant-leading index, or an explicitly reviewed equivalent,
   occurs in the executed JSON plan;
2. the executed scan carries both `tenant_id` and the requested tenant value in
   an index/recheck/filter/join condition;
3. buffer counters are present, proving that the plan was executed rather than
   only parsed;
4. actor-visible authorization is materialized below the root `Limit`, and the
   structural-access index is executed exactly once rather than reloaded once
   per conversation.

`enable_seqscan = off` is used only to make this structural index-applicability
gate deterministic across developer and CI database statistics. The fixture is
still populated and analyzed, and every query is executed. This is not a latency
or production-cardinality benchmark; load/SLO evidence remains a separate gate.
The plan-only corpus is loaded under transaction-local
`session_replication_role = replica` so it does not have to manufacture every
unrelated parent aggregate. Constraint, trigger, same-tenant and repository
behavior are verified by the DB-007 migration/repository suites; this EXPLAIN
gate owns only access-path shape.

## Saved Plan Summary

The following scan/index summary was emitted by the executable gate on the last
verified run. Every named path also passed tenant-predicate and buffer checks.

| Representative path                          | Root node     | Executed indexes relevant to the path                                                                                                                                         |
| -------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tenant stream bounded replay                 | `Limit`       | `inbox_v2_tenant_stream_commits_position_unique`                                                                                                                              |
| Projection checkpoint catch-up               | `Limit`       | `inbox_v2_projection_checkpoints_catchup_idx`                                                                                                                                 |
| Pending outbox due claim                     | `Limit`       | `inbox_v2_outbox_work_items_due_idx`                                                                                                                                          |
| Expired outbox lease reclaim                 | `Limit`       | `inbox_v2_outbox_work_items_reclaim_idx`                                                                                                                                      |
| Actor-visible conversations, org-unit branch | `Limit`       | `inbox_v2_auth_structural_heads_conversation_org_actor_idx`, `inbox_v2_conversation_heads_pk`, `inbox_v2_conversations_pk`                                                    |
| Active responsible assignment                | `Limit`       | `inbox_v2_work_item_primary_assignment_employee_active_idx`                                                                                                                   |
| Retention-eligible timeline content          | `Limit`       | `inbox_v2_timeline_contents_retention_idx`                                                                                                                                    |
| Active exact-root legal hold                 | `Limit`       | `inbox_v2_dg_hold_active_root_lookup_idx`                                                                                                                                     |
| Exact external-thread mapping                | `Nested Loop` | `inbox_v2_external_threads_target_revision_unique`, `inbox_v2_ext_thread_key_owner_unique`, `inbox_v2_conversations_tenant_id_shape_unique`, `inbox_v2_conversation_heads_pk` |

For retention eligibility, PostgreSQL selected the pre-existing covering index
`(tenant_id, data_class_id, state, retention_anchor_at, id)` instead of the new
smaller partial index
`inbox_v2_timeline_contents_retention_eligible_idx`. Both are valid reviewed
tenant-leading access paths for the repository predicate. The executable gate
accepts either and still requires `state = 'available'`, the tenant fence and the
retention anchor bound to appear before `Limit`.

For exact thread lookup, PostgreSQL selected the unique
`(tenant_id, id, conversation_id, revision)` index instead of the shorter
primary key `(tenant_id, id)`. Both have the complete exact lookup key as their
leading columns. The joined registry, Conversation and ConversationHead reads
also remain tenant-qualified.

## Reproduction

From the repository root with a disposable PostgreSQL admin database URL:

```powershell
$env:HULEE_DB_INTEGRATION = "1"
$env:DATABASE_URL = "postgres://hulee:hulee@localhost:15432/hulee"
pnpm exec vitest run scripts/db/inbox-v2-repository-foundation-explain.integration.test.mjs
```

To print the compact plan/index summary used to refresh this document:

```powershell
$env:HULEE_DB_EXPLAIN_REPORT = "1"
pnpm exec vitest run scripts/db/inbox-v2-repository-foundation-explain.integration.test.mjs --reporter=verbose
```

The test database name is validated against a fixed prefix, is isolated from the
admin database, and is terminated/dropped in teardown.
