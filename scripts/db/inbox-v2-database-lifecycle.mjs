import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import pg from "pg";

import {
  InboxV2DatabaseLifecycleContractError,
  assertInboxV2DisposableResetAuthorized,
  assertInboxV2DisposableResetContract,
  assertInboxV2Mig001EvidenceMatches,
  assertInboxV2ObjectStorageReceiptMatches,
  parseInboxV2RepositoryBootstrap,
  readInboxV2DispositionManifest,
  readInboxV2Mig001Evidence,
  readInboxV2ObjectStorageReceipt,
  readInboxV2RepositoryBootstrap,
  sha256
} from "./inbox-v2-install-contract.mjs";

const { Client, Pool } = pg;
const LIFECYCLE_LOCK_KEY = "hulee:inbox-v2:database-lifecycle:v1";
const MSG002_OUTBOUND_SEND_AUTHORITY_MARKER =
  "INB2-MSG-002_NORMAL_SEND_REPLY_AUTHORITY_V1";
const MSG003_TYPED_CONTENT_AUTHORIZATION_MARKER =
  "INBOX_V2_FILE_OBJECT_MIGRATION_FINALIZED_V1";
const MSG004_REPLY_FORWARD_MARKER =
  "INBOX_V2_REPLY_FORWARD_MIGRATION_FINALIZED_V1";
const MSG005_MESSAGE_LIFECYCLE_MARKER =
  "INBOX_V2_MESSAGE_LIFECYCLE_MIGRATION_FINALIZED_V1";
const MIGRATION_DDL_BUDGET_EVIDENCE_SCHEMA_ID =
  "core:inbox-v2.migration-ddl-budget-evidence@v1";
const MAX_MIGRATION_LOCK_TIMEOUT_MS = 60_000;
const MAX_MIGRATION_STATEMENT_TIMEOUT_MS = 3_600_000;
export const INBOX_V2_MIGRATION_DDL_BUDGET_DEFAULTS = Object.freeze({
  lockTimeoutMs: 5_000,
  statementTimeoutMs: 900_000
});
const DRIZZLE_MIGRATIONS_RELATION = "drizzle.__drizzle_migrations";
const PROTECTED_DATABASES = new Set(["postgres", "template0", "template1"]);
const ALLOWED_RESET_SCHEMAS = new Set(["public", "drizzle"]);
const RESET_RECEIPT_RELATION = "inbox_v2_database_reset_receipts";
const REQUIRED_EXCLUSIVE_OWNER_RELATIONS = new Set([RESET_RECEIPT_RELATION]);
const V1_BUSINESS_TABLES = new Set([
  "clients",
  "conversations",
  "messages",
  "event_store",
  "outbox"
]);
const REQUIRED_CURRENT_RELATIONS = [
  "tenants",
  "inbox_v2_conversations",
  "inbox_v2_conversation_heads",
  "inbox_v2_timeline_items",
  "inbox_v2_conversation_identity_fences",
  "inbox_v2_external_thread_key_registry",
  "inbox_v2_external_threads",
  "inbox_v2_source_thread_bindings",
  "inbox_v2_source_thread_binding_heads",
  "inbox_v2_source_thread_binding_remote_access_episodes",
  "inbox_v2_source_thread_binding_transitions",
  "inbox_v2_source_thread_binding_snapshots",
  "inbox_v2_work_items",
  "inbox_v2_conversation_work_heads",
  "inbox_v2_work_item_primary_assignments",
  "inbox_v2_messages",
  "inbox_v2_data_governance_contexts",
  "inbox_v2_auth_tenant_heads",
  "inbox_v2_security_denial_buckets",
  "inbox_v2_tenant_stream_heads",
  "inbox_v2_tenant_stream_commits",
  "inbox_v2_tenant_stream_changes",
  "inbox_v2_projection_generations",
  "inbox_v2_projection_checkpoints",
  "inbox_v2_projection_heads",
  "inbox_v2_outbox_work_items",
  "inbox_v2_outbox_outcomes",
  "inbox_v2_outbox_terminal_payload_refs",
  "inbox_v2_database_reset_receipts"
];
const REQUIRED_CURRENT_FUNCTIONS = [
  "public.inbox_v2_reject_immutable_binding_row_change()",
  "public.inbox_v2_guard_binding_episode_change()",
  "public.inbox_v2_guard_binding_head_update()",
  "public.inbox_v2_assert_source_thread_binding_integrity(text,text)",
  "public.inbox_v2_check_source_thread_binding_integrity()",
  "public.inbox_v2_check_source_thread_binding_edge_integrity()",
  "public.inbox_v2_tm_head_guard()",
  "public.inbox_v2_tm_core_coherence()",
  "public.inbox_v2_tm_outbound_route_action_valid(text,text,text,text,text,timestamptz,timestamptz,text,text,text,text,text,text,bigint,text,text,bigint,text,text,timestamptz,text,bigint,text,boolean)",
  "public.inbox_v2_tm_aux_coherence()",
  "public.inbox_v2_deferred_source_action_guard()",
  "public.inbox_v2_deferred_source_action_assert()",
  "public.inbox_v2_auth_domain_mutation_coherence()",
  "public.inbox_v2_atomic_message_creation_coherence()",
  "public.inbox_v2_atomic_outbound_creation_coherence()",
  "public.inbox_v2_system_event_timeline_binding_guard()",
  "public.inbox_v2_referenced_system_event_immutable_guard()",
  "public.inbox_v2_work_item_guard()",
  "public.inbox_v2_work_assignment_guard()",
  "public.inbox_v2_work_assignment_non_overlap()",
  "public.inbox_v2_work_item_mutation_coherence()",
  "public.inbox_v2_work_item_aggregate_coherence()",
  "public.inbox_v2_conversation_work_head_guard()",
  "public.inbox_v2_conversation_work_head_bootstrap()",
  "public.inbox_v2_conversation_work_head_advance()",
  "public.inbox_v2_conversation_work_head_coherence()",
  "public.inbox_v2_assert_conversation_timeline_head(text,text)",
  "public.inbox_v2_lock_conversation_identity(text,text)",
  "public.inbox_v2_conversation_timeline_head_deferred()",
  "public.inbox_v2_conversation_delete_guard()",
  "public.inbox_v2_conversation_insert_guard()",
  "public.inbox_v2_conversation_identity_fence_guard()",
  "public.inbox_v2_conversation_head_delete_guard()",
  "public.inbox_v2_conversation_update_guard()",
  "public.inbox_v2_conversation_head_insert_guard()",
  "public.inbox_v2_conversation_head_update_guard()",
  "public.inbox_v2_conversation_timeline_truncate_guard()",
  "public.inbox_v2_auth_stream_head_guard()",
  "public.inbox_v2_repository_projection_checkpoint_guard()",
  "public.inbox_v2_repository_projection_head_coherence()",
  "public.inbox_v2_repository_outbox_intent_work_init()",
  "public.inbox_v2_repository_outbox_work_guard()",
  "public.inbox_v2_repository_outbox_finalize_coherence()",
  "public.inbox_v2_repository_outbox_outcome_immutable()",
  "public.inbox_v2_outbox_terminal_payload_ref_immutable()",
  "public.inbox_v2_outbox_terminal_payload_ref_coherence()",
  "public.inbox_v2_outbox_terminal_payload_ref_insert_guard()",
  "public.inbox_v2_outbox_terminal_payload_ref_delete()",
  "public.inbox_v2_outbox_legacy_outcome_payload_bridge()",
  "public.inbox_v2_outbox_legacy_work_payload_bridge()",
  "public.inbox_v2_source_onboarding_terminal_payload_ref_guard()",
  "public.inbox_v2_repository_retention_advance_immutable()",
  "public.inbox_v2_advance_tenant_stream_retained_prefix_v1(text,text,bigint,bigint,bigint,bigint,text,text,timestamptz)",
  "public.inbox_v2_lock_conversation_membership_head_v1(text,text)",
  "public.inbox_v2_lock_participant_membership_mutation_v1(text,text,bigint,text,text,public.inbox_v2_participant_membership_origin_kind,public.inbox_v2_participant_membership_state)",
  "public.inbox_v2_apply_participant_membership_mutation_v1(jsonb)",
  "public.inbox_v2_database_reset_receipt_immutable_guard()"
];
const REQUIRED_FUNCTION_PRIVILEGES = new Map([
  [
    "public.inbox_v2_lock_conversation_membership_head_v1(text,text)",
    Object.freeze({
      owner: "hulee_inbox_v2_membership_owner",
      publicExecute: false,
      executeGrantees: [
        "hulee_inbox_v2_membership_owner",
        "hulee_inbox_v2_membership_repair",
        "hulee_inbox_v2_runtime"
      ]
    })
  ],
  [
    "public.inbox_v2_lock_participant_membership_mutation_v1(text,text,bigint,text,text,public.inbox_v2_participant_membership_origin_kind,public.inbox_v2_participant_membership_state)",
    Object.freeze({
      owner: "hulee_inbox_v2_membership_owner",
      publicExecute: false,
      executeGrantees: ["hulee_inbox_v2_membership_owner"]
    })
  ],
  [
    "public.inbox_v2_apply_participant_membership_mutation_v1(jsonb)",
    Object.freeze({
      owner: "hulee_inbox_v2_membership_owner",
      publicExecute: false,
      executeGrantees: [
        "hulee_inbox_v2_membership_owner",
        "hulee_inbox_v2_membership_repair",
        "hulee_inbox_v2_runtime"
      ]
    })
  ],
  [
    "public.inbox_v2_advance_tenant_stream_retained_prefix_v1(text,text,bigint,bigint,bigint,bigint,text,text,timestamptz)",
    Object.freeze({
      owner: "hulee_inbox_v2_retention_owner",
      publicExecute: false,
      executeGrantees: [
        "hulee_inbox_v2_retention_owner",
        "hulee_inbox_v2_runtime"
      ]
    })
  ]
]);
const REQUIRED_SECURITY_ROLES = [
  "hulee_inbox_v2_membership_owner",
  "hulee_inbox_v2_membership_repair",
  "hulee_inbox_v2_retention_owner",
  "hulee_inbox_v2_runtime"
];
const REQUIRED_CURRENT_TRIGGERS = [
  [
    "inbox_v2_source_thread_bindings",
    "inbox_v2_binding_anchors_immutable",
    "public.inbox_v2_reject_immutable_binding_row_change()"
  ],
  [
    "inbox_v2_source_thread_binding_remote_access_episodes",
    "inbox_v2_binding_episode_close_guard",
    "public.inbox_v2_guard_binding_episode_change()"
  ],
  [
    "inbox_v2_source_thread_binding_transitions",
    "inbox_v2_binding_transitions_immutable",
    "public.inbox_v2_reject_immutable_binding_row_change()"
  ],
  [
    "inbox_v2_source_thread_binding_snapshots",
    "inbox_v2_binding_snapshots_immutable",
    "public.inbox_v2_reject_immutable_binding_row_change()"
  ],
  [
    "inbox_v2_source_thread_binding_heads",
    "inbox_v2_binding_head_update_guard",
    "public.inbox_v2_guard_binding_head_update()"
  ],
  [
    "inbox_v2_source_thread_binding_heads",
    "inbox_v2_binding_heads_integrity",
    "public.inbox_v2_check_source_thread_binding_integrity()"
  ],
  [
    "inbox_v2_source_thread_bindings",
    "inbox_v2_binding_anchors_integrity",
    "public.inbox_v2_check_source_thread_binding_edge_integrity()"
  ],
  [
    "inbox_v2_source_thread_binding_remote_access_episodes",
    "inbox_v2_binding_episodes_integrity",
    "public.inbox_v2_check_source_thread_binding_edge_integrity()"
  ],
  [
    "inbox_v2_source_thread_binding_transitions",
    "inbox_v2_binding_transitions_integrity",
    "public.inbox_v2_check_source_thread_binding_integrity()"
  ],
  [
    "inbox_v2_source_thread_binding_snapshots",
    "inbox_v2_binding_snapshots_integrity",
    "public.inbox_v2_check_source_thread_binding_integrity()"
  ],
  [
    "inbox_v2_timeline_items",
    "inbox_v2_tm_timeline_head_guard",
    "public.inbox_v2_tm_head_guard()"
  ],
  [
    "inbox_v2_timeline_items",
    "inbox_v2_tm_timeline_coherence",
    "public.inbox_v2_tm_core_coherence()"
  ],
  [
    "inbox_v2_timeline_subject_details",
    "inbox_v2_system_event_timeline_binding_guard",
    "public.inbox_v2_system_event_timeline_binding_guard()"
  ],
  [
    "event_store",
    "inbox_v2_referenced_system_event_immutable_guard",
    "public.inbox_v2_referenced_system_event_immutable_guard()"
  ],
  [
    "inbox_v2_work_items",
    "inbox_v2_work_items_guard_trigger",
    "public.inbox_v2_work_item_guard()"
  ],
  [
    "inbox_v2_conversation_work_heads",
    "inbox_v2_conversation_work_heads_guard_trigger",
    "public.inbox_v2_conversation_work_head_guard()"
  ],
  [
    "inbox_v2_conversations",
    "inbox_v2_conversations_work_head_insert_trigger",
    "public.inbox_v2_conversation_work_head_bootstrap()"
  ],
  [
    "inbox_v2_work_item_creation_decisions",
    "inbox_v2_work_creation_head_advance_trigger",
    "public.inbox_v2_conversation_work_head_advance()"
  ],
  [
    "inbox_v2_conversation_work_heads",
    "inbox_v2_conversation_work_heads_coherence_constraint",
    "public.inbox_v2_conversation_work_head_coherence()"
  ],
  [
    "inbox_v2_work_items",
    "inbox_v2_work_items_head_coherence_constraint",
    "public.inbox_v2_conversation_work_head_coherence()"
  ],
  [
    "inbox_v2_work_item_creation_decisions",
    "inbox_v2_work_creation_head_coherence_constraint",
    "public.inbox_v2_conversation_work_head_coherence()"
  ],
  [
    "inbox_v2_work_item_primary_assignments",
    "inbox_v2_work_item_primary_assignments_guard_trigger",
    "public.inbox_v2_work_assignment_guard()"
  ],
  [
    "inbox_v2_work_item_primary_assignments",
    "inbox_v2_work_assignment_non_overlap_constraint",
    "public.inbox_v2_work_assignment_non_overlap()"
  ],
  [
    "inbox_v2_work_items",
    "inbox_v2_work_item_mutation_coherence_constraint",
    "public.inbox_v2_work_item_mutation_coherence()"
  ],
  [
    "inbox_v2_work_items",
    "inbox_v2_work_items_aggregate_constraint",
    "public.inbox_v2_work_item_aggregate_coherence()"
  ],
  [
    "inbox_v2_work_item_primary_assignments",
    "inbox_v2_work_assignment_aggregate_constraint",
    "public.inbox_v2_work_item_aggregate_coherence()"
  ],
  [
    "inbox_v2_conversations",
    "inbox_v2_conversations_insert_guard_trigger",
    "public.inbox_v2_conversation_insert_guard()"
  ],
  [
    "inbox_v2_conversations",
    "inbox_v2_conversations_update_guard_trigger",
    "public.inbox_v2_conversation_update_guard()"
  ],
  [
    "inbox_v2_conversations",
    "inbox_v2_conversations_delete_guard_trigger",
    "public.inbox_v2_conversation_delete_guard()"
  ],
  [
    "inbox_v2_conversation_heads",
    "inbox_v2_conversation_heads_insert_guard_trigger",
    "public.inbox_v2_conversation_head_insert_guard()"
  ],
  [
    "inbox_v2_conversation_heads",
    "inbox_v2_conversation_heads_update_guard_trigger",
    "public.inbox_v2_conversation_head_update_guard()"
  ],
  [
    "inbox_v2_conversation_heads",
    "inbox_v2_conversation_heads_delete_guard_trigger",
    "public.inbox_v2_conversation_head_delete_guard()"
  ],
  [
    "inbox_v2_conversation_identity_fences",
    "inbox_v2_conversation_identity_fences_guard_trigger",
    "public.inbox_v2_conversation_identity_fence_guard()"
  ],
  [
    "inbox_v2_conversations",
    "inbox_v2_conversations_truncate_guard_trigger",
    "public.inbox_v2_conversation_timeline_truncate_guard()"
  ],
  [
    "inbox_v2_conversation_heads",
    "inbox_v2_conversation_heads_truncate_guard_trigger",
    "public.inbox_v2_conversation_timeline_truncate_guard()"
  ],
  [
    "inbox_v2_timeline_items",
    "inbox_v2_timeline_items_truncate_guard_trigger",
    "public.inbox_v2_conversation_timeline_truncate_guard()"
  ],
  [
    "inbox_v2_conversation_identity_fences",
    "inbox_v2_conversation_identity_fences_truncate_guard_trigger",
    "public.inbox_v2_conversation_timeline_truncate_guard()"
  ],
  [
    "inbox_v2_conversation_identity_fences",
    "inbox_v2_conversation_identity_fence_coherence_trigger",
    "public.inbox_v2_conversation_timeline_head_deferred()"
  ],
  [
    "inbox_v2_conversations",
    "inbox_v2_conversations_timeline_head_constraint_trigger",
    "public.inbox_v2_conversation_timeline_head_deferred()"
  ],
  [
    "inbox_v2_conversation_heads",
    "inbox_v2_conversation_heads_timeline_constraint_trigger",
    "public.inbox_v2_conversation_timeline_head_deferred()"
  ],
  [
    "inbox_v2_tenant_stream_heads",
    "inbox_v2_tenant_stream_head_guard_trigger",
    "public.inbox_v2_auth_stream_head_guard()"
  ],
  [
    "inbox_v2_projection_checkpoints",
    "inbox_v2_projection_checkpoint_guard_trigger",
    "public.inbox_v2_repository_projection_checkpoint_guard()"
  ],
  [
    "inbox_v2_projection_generations",
    "inbox_v2_projection_generation_head_coherence_trigger",
    "public.inbox_v2_repository_projection_head_coherence()"
  ],
  [
    "inbox_v2_projection_heads",
    "inbox_v2_projection_head_generation_coherence_trigger",
    "public.inbox_v2_repository_projection_head_coherence()"
  ],
  [
    "inbox_v2_projection_checkpoints",
    "inbox_v2_projection_checkpoint_generation_coherence_trigger",
    "public.inbox_v2_repository_projection_head_coherence()"
  ],
  [
    "inbox_v2_outbox_intents",
    "inbox_v2_outbox_intent_work_init_trigger",
    "public.inbox_v2_repository_outbox_intent_work_init()"
  ],
  [
    "inbox_v2_outbox_work_items",
    "inbox_v2_outbox_work_guard_trigger",
    "public.inbox_v2_repository_outbox_work_guard()"
  ],
  [
    "inbox_v2_outbox_work_items",
    "inbox_v2_outbox_finalize_coherence_trigger",
    "public.inbox_v2_repository_outbox_finalize_coherence()"
  ],
  [
    "inbox_v2_outbox_outcomes",
    "inbox_v2_outbox_outcome_immutable_trigger",
    "public.inbox_v2_repository_outbox_outcome_immutable()"
  ],
  [
    "inbox_v2_outbox_terminal_payload_refs",
    "inbox_v2_outbox_terminal_payload_refs_immutable_trigger",
    "public.inbox_v2_outbox_terminal_payload_ref_immutable()"
  ],
  [
    "inbox_v2_outbox_terminal_payload_refs",
    "inbox_v2_outbox_terminal_payload_refs_insert_guard",
    "public.inbox_v2_outbox_terminal_payload_ref_insert_guard()"
  ],
  [
    "inbox_v2_outbox_terminal_payload_refs",
    "inbox_v2_outbox_terminal_payload_refs_truncate_guard",
    "public.inbox_v2_outbox_terminal_payload_ref_immutable()"
  ],
  [
    "inbox_v2_outbox_terminal_payload_refs",
    "inbox_v2_outbox_terminal_payload_refs_delete_trigger",
    "public.inbox_v2_outbox_terminal_payload_ref_delete()"
  ],
  [
    "inbox_v2_outbox_terminal_payload_refs",
    "inbox_v2_outbox_terminal_payload_refs_coherence",
    "public.inbox_v2_outbox_terminal_payload_ref_coherence()"
  ],
  [
    "inbox_v2_outbox_outcomes",
    "inbox_v2_outbox_legacy_outcome_payload_bridge_trigger",
    "public.inbox_v2_outbox_legacy_outcome_payload_bridge()"
  ],
  [
    "inbox_v2_outbox_work_items",
    "inbox_v2_outbox_legacy_work_payload_bridge_trigger",
    "public.inbox_v2_outbox_legacy_work_payload_bridge()"
  ],
  [
    "inbox_v2_source_onboarding_result_snapshots",
    "inbox_v2_source_onboarding_terminal_payload_ref_guard_trigger",
    "public.inbox_v2_source_onboarding_terminal_payload_ref_guard()"
  ],
  [
    "inbox_v2_tenant_stream_retention_advances",
    "inbox_v2_tenant_stream_retention_advance_immutable_trigger",
    "public.inbox_v2_repository_retention_advance_immutable()"
  ],
  [
    RESET_RECEIPT_RELATION,
    "inbox_v2_database_reset_receipt_immutable_trigger",
    "public.inbox_v2_database_reset_receipt_immutable_guard()"
  ],
  [
    RESET_RECEIPT_RELATION,
    "inbox_v2_database_reset_receipt_truncate_guard_trigger",
    "public.inbox_v2_database_reset_receipt_immutable_guard()"
  ]
];
const REQUIRED_CURRENT_CONSTRAINTS = [
  {
    relation: "inbox_v2_conversations",
    name: "inbox_v2_conversations_pk",
    type: "p",
    columns: ["tenant_id", "id"]
  },
  foreignKeyContract(
    "inbox_v2_conversations",
    "inbox_v2_conversations_tenant_id_tenants_id_fk",
    ["tenant_id"],
    "tenants",
    ["id"],
    { onDelete: "a" }
  ),
  {
    relation: "inbox_v2_external_thread_key_registry",
    name: "inbox_v2_ext_thread_key_registry_pk",
    type: "p",
    columns: ["tenant_id", "id"]
  },
  {
    relation: "inbox_v2_external_thread_key_registry",
    name: "inbox_v2_ext_thread_key_digest_unique",
    type: "u",
    columns: ["tenant_id", "key_digest"]
  },
  foreignKeyContract(
    "inbox_v2_external_thread_key_registry",
    "inbox_v2_ext_thread_key_conversation_fk",
    ["tenant_id", "canonical_conversation_id"],
    "inbox_v2_conversations",
    ["tenant_id", "id"],
    { onDelete: "a" }
  ),
  {
    relation: "inbox_v2_external_threads",
    name: "inbox_v2_external_threads_pk",
    type: "p",
    columns: ["tenant_id", "id"]
  },
  {
    relation: "inbox_v2_external_threads",
    name: "inbox_v2_external_threads_conversation_unique",
    type: "u",
    columns: ["tenant_id", "conversation_id"]
  },
  {
    relation: "inbox_v2_external_threads",
    name: "inbox_v2_external_threads_registry_unique",
    type: "u",
    columns: ["tenant_id", "key_registry_id"]
  },
  foreignKeyContract(
    "inbox_v2_external_threads",
    "inbox_v2_external_threads_conversation_fk",
    [
      "tenant_id",
      "conversation_id",
      "conversation_transport",
      "conversation_topology"
    ],
    "inbox_v2_conversations",
    ["tenant_id", "id", "transport", "topology"],
    { onDelete: "a" }
  ),
  foreignKeyContract(
    "inbox_v2_external_threads",
    "inbox_v2_external_threads_registry_fk",
    [
      "tenant_id",
      "key_registry_id",
      "key_registry_entry_kind",
      "id",
      "conversation_id",
      "key_digest"
    ],
    "inbox_v2_external_thread_key_registry",
    [
      "tenant_id",
      "id",
      "entry_kind",
      "canonical_thread_id",
      "canonical_conversation_id",
      "key_digest"
    ],
    { onDelete: "a" }
  ),
  {
    relation: "inbox_v2_source_thread_bindings",
    name: "inbox_v2_source_thread_bindings_pk",
    type: "p",
    columns: ["tenant_id", "id"]
  },
  {
    relation: "inbox_v2_source_thread_bindings",
    name: "inbox_v2_source_thread_bindings_thread_account_unique",
    type: "u",
    columns: ["tenant_id", "external_thread_id", "source_account_id"]
  },
  foreignKeyContract(
    "inbox_v2_source_thread_bindings",
    "inbox_v2_source_thread_bindings_thread_fk",
    ["tenant_id", "external_thread_id"],
    "inbox_v2_external_threads",
    ["tenant_id", "id"],
    { onDelete: "a" }
  ),
  {
    relation: "inbox_v2_source_thread_binding_heads",
    name: "inbox_v2_source_thread_binding_heads_pk",
    type: "p",
    columns: ["tenant_id", "binding_id"]
  },
  foreignKeyContract(
    "inbox_v2_source_thread_binding_heads",
    "inbox_v2_source_thread_binding_heads_binding_fk",
    [
      "tenant_id",
      "binding_id",
      "external_thread_id",
      "source_connection_id",
      "source_account_id"
    ],
    "inbox_v2_source_thread_bindings",
    [
      "tenant_id",
      "id",
      "external_thread_id",
      "source_connection_id",
      "source_account_id"
    ]
  ),
  {
    relation: "inbox_v2_work_items",
    name: "inbox_v2_work_items_pk",
    type: "p",
    columns: ["tenant_id", "id"]
  },
  foreignKeyContract(
    "inbox_v2_work_items",
    "inbox_v2_work_items_conversation_fk",
    ["tenant_id", "conversation_id"],
    "inbox_v2_conversations",
    ["tenant_id", "id"]
  ),
  {
    relation: "inbox_v2_conversation_work_heads",
    name: "inbox_v2_conversation_work_heads_pk",
    type: "p",
    columns: ["tenant_id", "id"]
  },
  {
    relation: "inbox_v2_conversation_work_heads",
    name: "inbox_v2_conversation_work_heads_conversation_unique",
    type: "u",
    columns: ["tenant_id", "conversation_id"]
  },
  foreignKeyContract(
    "inbox_v2_conversation_work_heads",
    "inbox_v2_conversation_work_heads_conversation_fk",
    ["tenant_id", "conversation_id"],
    "inbox_v2_conversations",
    ["tenant_id", "id"],
    { onDelete: "c" }
  ),
  {
    relation: "inbox_v2_conversation_work_heads",
    name: "inbox_v2_conversation_work_heads_identity_check",
    type: "c",
    definitionSha256:
      "sha256:33cacd9cb4f062bdbbf0c27e75c34a905b839cb6201d4922ce698cc966a7a11c",
    definitionFragments: [
      "conversation_work_head:",
      "sha256",
      "chr(31)",
      "tenant_id",
      "conversation_id"
    ]
  },
  {
    relation: "inbox_v2_conversation_work_heads",
    name: "inbox_v2_conversation_work_heads_state_check",
    type: "c",
    definitionSha256:
      "sha256:0b63fb16881b06685f27c4e6c5c30b0b19d5cd8fc92cc46e3cee7b1d39e30758",
    definitionFragments: [
      "work_item_count >= 0",
      "intake_decision_high_water >= 0",
      "revision = ((1 + intake_decision_high_water) + work_item_count)",
      "intake_decision_high_water >= work_item_count",
      "pending_materialization_ordinal is null",
      "pending_materialization_ordinal = (work_item_count + 1)",
      "intake_decision_high_water >= pending_materialization_ordinal",
      "current_outcome = 'pending_intake'",
      "current_outcome = 'no_work_item'",
      "current_outcome = 'create_work_item'"
    ]
  },
  {
    relation: "inbox_v2_conversation_work_heads",
    name: "inbox_v2_conversation_work_heads_timestamps_check",
    type: "c",
    definitionSha256:
      "sha256:dd2c4c9883e8c27d97b60040331681567ced5926db3764346329f14d0db5eef1",
    definitionFragments: [
      "isfinite(created_at)",
      "isfinite(updated_at)",
      "updated_at >= created_at"
    ]
  },
  {
    relation: "inbox_v2_work_items",
    name: "inbox_v2_work_items_state_head_check",
    type: "c",
    definitionSha256:
      "sha256:a8ce7ac326eaa2670c207b88049c780739e2b7e198272cf67476731941c8c94d",
    definitionFragments: [
      "state = 'new'",
      "state = any",
      "current_primary_assignment_id is null",
      "current_primary_assignment_id is not null",
      "terminal_snapshot is null",
      "terminal_snapshot is not null",
      "jsonb_typeof(terminal_snapshot) = 'object'"
    ]
  },
  {
    relation: "inbox_v2_work_item_primary_assignments",
    name: "inbox_v2_work_item_primary_assignments_pk",
    type: "p",
    columns: ["tenant_id", "id"]
  },
  foreignKeyContract(
    "inbox_v2_work_item_primary_assignments",
    "inbox_v2_work_item_primary_assignment_work_item_fk",
    ["tenant_id", "work_item_id"],
    "inbox_v2_work_items",
    ["tenant_id", "id"]
  ),
  {
    relation: "inbox_v2_work_item_primary_assignments",
    name: "inbox_v2_work_item_primary_assignment_end_shape_check",
    type: "c",
    definitionSha256:
      "sha256:e33c6d3299673cc462e735323ba552f5729523f8463c0ac9729b4c8ac3ed5524",
    definitionFragments: [
      "state = 'active'",
      "revision = 1",
      "ended_at is null",
      "state = 'ended'",
      "revision = 2",
      "ended_at is not null",
      "termination_transition_id is not null"
    ]
  },
  {
    relation: "inbox_v2_conversation_heads",
    name: "inbox_v2_conversation_heads_pk",
    type: "p",
    columns: ["tenant_id", "conversation_id"]
  },
  foreignKeyContract(
    "inbox_v2_conversation_heads",
    "inbox_v2_conversation_heads_conversation_fk",
    ["tenant_id", "conversation_id"],
    "inbox_v2_conversations",
    ["tenant_id", "id"]
  ),
  {
    relation: "inbox_v2_timeline_items",
    name: "inbox_v2_timeline_items_sequence_unique",
    type: "u",
    columns: ["tenant_id", "conversation_id", "timeline_sequence"]
  },
  foreignKeyContract(
    "inbox_v2_timeline_items",
    "inbox_v2_timeline_items_conversation_fk",
    ["tenant_id", "conversation_id"],
    "inbox_v2_conversations",
    ["tenant_id", "id"],
    { onDelete: "a" }
  ),
  {
    relation: "inbox_v2_timeline_items",
    name: "inbox_v2_timeline_items_clock_check",
    type: "c",
    definitionSha256:
      "sha256:300b58eea4eee213b16c192938edc01fb526949d22c072dee47a87d7ac3bfab3",
    definitionFragments: [
      "timeline_sequence >= 1",
      "revision >= 1",
      "last_changed_stream_position >= 1",
      "isfinite(occurred_at)",
      "isfinite(received_at)",
      "isfinite(created_at)",
      "isfinite(updated_at)",
      "occurred_at <= received_at",
      "received_at <= created_at",
      "created_at <= updated_at"
    ]
  },
  {
    relation: "inbox_v2_outbound_routes",
    name: "inbox_v2_outbound_routes_selection_check",
    type: "c",
    definitionSha256:
      "sha256:e7c199dd9c04191b8bed52c4e7d47cfd096ce7193cb970994a7f095b598f966f",
    definitionFragments: [
      "selection_intent_kind = 'explicit_reroute'",
      "selection_reason = 'explicit_reroute'",
      "selection_intent_snapshot #>> '{originalRoute,id}'",
      "selection_intent_snapshot #>> '{originalDispatch,id}'",
      "selection_intent_snapshot ->> 'expectedOriginalDispatchRevision'",
      "'kind', 'outbound_dispatch'"
    ]
  },
  {
    relation: "inbox_v2_conversation_identity_fences",
    name: "inbox_v2_conversation_identity_fences_pk",
    type: "p",
    columns: ["tenant_id", "conversation_id"]
  },
  {
    relation: "inbox_v2_conversation_identity_fences",
    name: "inbox_v2_conversation_identity_fences_values_check",
    type: "c",
    definitionSha256:
      "sha256:c5a7648848cd7e8c56559296454e770491452a5a2dfddc71596611266b7600e8",
    definitionFragments: [
      "retired_revision >= 1",
      "retired_stream_position >= 1",
      "isfinite(retired_updated_at)",
      "isfinite(retired_at)"
    ]
  },
  foreignKeyContract(
    "inbox_v2_conversation_identity_fences",
    "inbox_v2_conversation_identity_fences_tenant_id_tenants_id_fk",
    ["tenant_id"],
    "tenants",
    ["id"]
  ),
  {
    relation: RESET_RECEIPT_RELATION,
    name: "inbox_v2_database_reset_receipts_pk",
    type: "p",
    columns: ["reset_generation"]
  },
  {
    relation: RESET_RECEIPT_RELATION,
    name: "inbox_v2_database_reset_receipts_manifest_unique",
    type: "u",
    columns: ["manifest_sha256"]
  },
  {
    relation: "inbox_v2_tenant_stream_commits",
    name: "inbox_v2_tenant_stream_commits_identity_position_unique",
    type: "u",
    columns: ["tenant_id", "id", "mutation_id", "position"]
  },
  {
    relation: "inbox_v2_tenant_stream_commits",
    name: "inbox_v2_tenant_stream_commits_checkpoint_unique",
    type: "u",
    columns: ["tenant_id", "id", "stream_epoch", "position"]
  },
  foreignKeyContract(
    "inbox_v2_domain_events",
    "inbox_v2_domain_events_commit_fk",
    ["tenant_id", "stream_commit_id", "mutation_id", "stream_position"],
    "inbox_v2_tenant_stream_commits",
    ["tenant_id", "id", "mutation_id", "position"]
  ),
  foreignKeyContract(
    "inbox_v2_outbox_intents",
    "inbox_v2_outbox_intents_commit_fk",
    ["tenant_id", "stream_commit_id", "mutation_id", "stream_position"],
    "inbox_v2_tenant_stream_commits",
    ["tenant_id", "id", "mutation_id", "position"]
  ),
  foreignKeyContract(
    "inbox_v2_tenant_stream_changes",
    "inbox_v2_tenant_stream_changes_commit_fk",
    ["tenant_id", "stream_commit_id", "mutation_id", "stream_position"],
    "inbox_v2_tenant_stream_commits",
    ["tenant_id", "id", "mutation_id", "position"]
  ),
  foreignKeyContract(
    "inbox_v2_projection_checkpoints",
    "inbox_v2_projection_checkpoints_generation_fk",
    ["tenant_id", "projection_id", "scope_id", "generation", "stream_epoch"],
    "inbox_v2_projection_generations",
    ["tenant_id", "projection_id", "scope_id", "generation", "stream_epoch"]
  ),
  foreignKeyContract(
    "inbox_v2_projection_heads",
    "inbox_v2_projection_heads_generation_fk",
    [
      "tenant_id",
      "projection_id",
      "scope_id",
      "current_generation",
      "stream_epoch"
    ],
    "inbox_v2_projection_generations",
    ["tenant_id", "projection_id", "scope_id", "generation", "stream_epoch"]
  ),
  foreignKeyContract(
    "inbox_v2_outbox_work_items",
    "inbox_v2_outbox_work_items_intent_fk",
    ["tenant_id", "intent_id"],
    "inbox_v2_outbox_intents",
    ["tenant_id", "id"]
  ),
  foreignKeyContract(
    "inbox_v2_outbox_outcomes",
    "inbox_v2_outbox_outcomes_work_item_fk",
    ["tenant_id", "intent_id"],
    "inbox_v2_outbox_work_items",
    ["tenant_id", "intent_id"]
  ),
  foreignKeyContract(
    "inbox_v2_outbox_terminal_payload_refs",
    "inbox_v2_outbox_terminal_payload_refs_outcome_fk",
    ["tenant_id", "intent_id", "outcome_revision"],
    "inbox_v2_outbox_outcomes",
    ["tenant_id", "intent_id", "outcome_revision"],
    { deferrable: true, initiallyDeferred: true }
  ),
  {
    relation: "inbox_v2_outbox_work_items",
    name: "inbox_v2_outbox_work_items_state_check",
    type: "c",
    definitionSha256:
      "sha256:b530262fd1a2277b33ddeaeea6e6615fba80d356969e382ec8ee1ee79c277d97",
    definitionFragments: [
      "state = 'pending'",
      "state = 'leased'",
      "state = 'processed'",
      "state = 'dead'",
      "lease_owner_id",
      "terminal_result_hash"
    ]
  },
  {
    relation: RESET_RECEIPT_RELATION,
    name: "inbox_v2_database_reset_receipts_values_check",
    type: "c",
    definitionSha256:
      "sha256:e9c7cbd7e1ed0a5b1dab373bce942560af24dd73c2078e36367e03aac9692831",
    definitionFragments: [
      "manifest_sha256",
      "migration_contract_sha256",
      "bootstrap_sha256",
      "mig_001_evidence_sha256",
      "object_receipt_sha256",
      "target_fingerprint_sha256",
      "migration_journal_sha256",
      "database_inventory_sha256",
      "completed_at"
    ]
  }
];
const REQUIRED_CURRENT_INDEXES = [
  Object.freeze({
    name: "inbox_v2_ext_thread_key_canonical_target_unique",
    definition:
      "create unique index inbox_v2_ext_thread_key_canonical_target_unique on public.inbox_v2_external_thread_key_registry using btree (tenant_id, canonical_thread_id) where (entry_kind = 'canonical'::inbox_v2_external_thread_key_kind)",
    unique: true,
    primary: false
  }),
  Object.freeze({
    name: "inbox_v2_work_items_non_terminal_unique",
    definition:
      "create unique index inbox_v2_work_items_non_terminal_unique on public.inbox_v2_work_items using btree (tenant_id, conversation_id) where (state = any (array['new'::inbox_v2_work_item_state, 'assigned'::inbox_v2_work_item_state, 'in_progress'::inbox_v2_work_item_state, 'waiting'::inbox_v2_work_item_state]))",
    unique: true,
    primary: false
  }),
  Object.freeze({
    name: "inbox_v2_conversation_work_heads_state_idx",
    definition:
      "create index inbox_v2_conversation_work_heads_state_idx on public.inbox_v2_conversation_work_heads using btree (tenant_id, current_outcome, intake_decision_high_water, conversation_id)",
    unique: false,
    primary: false
  }),
  Object.freeze({
    name: "inbox_v2_work_item_primary_assignment_active_unique",
    definition:
      "create unique index inbox_v2_work_item_primary_assignment_active_unique on public.inbox_v2_work_item_primary_assignments using btree (tenant_id, work_item_id) where (state = 'active'::inbox_v2_work_assignment_state)",
    unique: true,
    primary: false
  }),
  Object.freeze({
    name: "inbox_v2_conversation_identity_fences_tenant_retired_idx",
    definition:
      "create index inbox_v2_conversation_identity_fences_tenant_retired_idx on public.inbox_v2_conversation_identity_fences using btree (tenant_id, retired_at, conversation_id)",
    unique: false,
    primary: false
  }),
  Object.freeze({
    name: "inbox_v2_timeline_items_eligible_activity_tail_idx",
    definition:
      "create index inbox_v2_timeline_items_eligible_activity_tail_idx on public.inbox_v2_timeline_items using btree (tenant_id, conversation_id, timeline_sequence desc nulls last, id, occurred_at) where (activity_kind = 'eligible'::inbox_v2_timeline_activity_kind)",
    unique: false,
    primary: false
  }),
  Object.freeze({
    name: "inbox_v2_timeline_subject_details_system_event_unique",
    definition:
      "create unique index inbox_v2_timeline_subject_details_system_event_unique on public.inbox_v2_timeline_subject_details using btree (tenant_id, system_event_id) where (system_event_id is not null)",
    unique: true,
    primary: false
  }),
  Object.freeze({
    name: "inbox_v2_provider_lifecycle_active_message_unique",
    definition:
      "create unique index inbox_v2_provider_lifecycle_active_message_unique on public.inbox_v2_message_provider_lifecycle_operations using btree (tenant_id, message_id) where ((origin = 'hulee_requested'::inbox_v2_provider_lifecycle_origin) and (outcome = any (array['pending'::inbox_v2_provider_lifecycle_outcome, 'accepted'::inbox_v2_provider_lifecycle_outcome, 'outcome_unknown'::inbox_v2_provider_lifecycle_outcome])))",
    unique: true,
    primary: false
  }),
  Object.freeze({
    name: "inbox_v2_database_reset_receipts_tenant_idx",
    definition:
      "create index inbox_v2_database_reset_receipts_tenant_idx on public.inbox_v2_database_reset_receipts using btree (tenant_id)",
    unique: false,
    primary: false
  })
];

export class InboxV2DatabaseLifecycleError extends Error {
  constructor(code, message, { evidence = null } = {}) {
    super(`${code}: ${message}`);
    this.name = "InboxV2DatabaseLifecycleError";
    this.code = code;
    this.evidence = evidence;
    this.reportSha256 = evidence?.reportSha256 ?? null;
  }
}

export async function preflightInboxV2Database(options = {}) {
  const databaseUrl = requiredDatabaseUrl(options.databaseUrl);
  const migrationsFolder = resolve(
    options.migrationsFolder ?? "packages/db/drizzle"
  );
  const migrationBundle = loadMigrationBundle(migrationsFolder);
  return withLifecycleConnection(databaseUrl, async ({ lockClient }) => {
    await lockClient.query("begin transaction read only");
    try {
      const journal = await assertMigrationJournalPrefix(
        lockClient,
        migrationsFolder
      );
      await assertNoUnsafeInboxV2DefaultPrivileges(lockClient);
      await assertNoPublicSchemaCreate(lockClient);
      if (journal.applied.length === journal.expected.length) {
        await assertCurrentInboxV2Schema(lockClient, migrationBundle);
      }
      const result = Object.freeze({
        action: "preflight",
        migrationsFolder,
        appliedMigrationCount: journal.applied.length,
        expectedMigrationCount: journal.expected.length,
        pendingMigrationCount: journal.expected.length - journal.applied.length,
        migrationContractSha256: migrationBundle.digest,
        migrationJournalSha256: digestMigrationJournal(journal.applied)
      });
      await lockClient.query("commit");
      return result;
    } catch (error) {
      await lockClient.query("rollback").catch(() => {});
      throw error;
    }
  });
}

export async function installInboxV2Database(options) {
  const databaseUrl = requiredDatabaseUrl(options.databaseUrl);
  const migrationDdlBudget = resolveInboxV2MigrationDdlBudget(options);
  const migrationsFolder = resolve(
    options.migrationsFolder ?? "packages/db/drizzle"
  );
  const migrationBundle = loadMigrationBundle(migrationsFolder);
  const bootstrapDocument = await resolveBootstrap(options.bootstrap);
  return withLifecycleConnection(databaseUrl, async ({ lockClient }) => {
    const lifecycle = await withInboxV2MigrationDdlBudget(
      lockClient,
      migrationDdlBudget,
      async (migrationClient) => {
        await assertMigrationJournalPrefix(migrationClient, migrationsFolder);
        await assertNoUnsafeInboxV2DefaultPrivileges(migrationClient);
        await assertNoPublicSchemaCreate(migrationClient);
        await migrate(drizzle(migrationClient), { migrationsFolder });
        const journal = await assertCurrentMigrationJournalAgainstBundle(
          migrationClient,
          migrationBundle
        );
        await assertCurrentInboxV2Schema(migrationClient, migrationBundle);
        const bootstrapResult =
          bootstrapDocument === null
            ? null
            : await bootstrapInboxV2Repository(
                migrationClient,
                bootstrapDocument.bootstrap
              );
        return Object.freeze({
          journal,
          bootstrapResult
        });
      }
    );
    return Object.freeze({
      action: "install",
      migrationsFolder,
      migrationCount: lifecycle.result.journal.applied.length,
      migrationContractSha256: lifecycle.result.journal.expectedDigest,
      migrationJournalSha256: lifecycle.result.journal.appliedDigest,
      migrationDdlBudget: lifecycle.evidence,
      bootstrapSha256: bootstrapDocument?.digest ?? null,
      bootstrap: lifecycle.result.bootstrapResult
    });
  });
}

export function resolveInboxV2MigrationDdlBudget(options = {}) {
  const lockTimeoutMs = migrationTimeoutMilliseconds(
    options.lockTimeoutMs,
    INBOX_V2_MIGRATION_DDL_BUDGET_DEFAULTS.lockTimeoutMs,
    MAX_MIGRATION_LOCK_TIMEOUT_MS,
    "lockTimeoutMs"
  );
  const statementTimeoutMs = migrationTimeoutMilliseconds(
    options.statementTimeoutMs,
    INBOX_V2_MIGRATION_DDL_BUDGET_DEFAULTS.statementTimeoutMs,
    MAX_MIGRATION_STATEMENT_TIMEOUT_MS,
    "statementTimeoutMs"
  );
  if (statementTimeoutMs < lockTimeoutMs) {
    throw lifecycleError(
      "inbox_v2.migration_ddl_budget_invalid",
      "statementTimeoutMs must be greater than or equal to lockTimeoutMs."
    );
  }
  return Object.freeze({ lockTimeoutMs, statementTimeoutMs });
}

export async function withInboxV2MigrationDdlBudget(client, rawBudget, work) {
  const budget = resolveInboxV2MigrationDdlBudget(rawBudget);
  if (typeof work !== "function") {
    throw lifecycleError(
      "inbox_v2.migration_ddl_budget_invalid",
      "Migration DDL budget work must be a function."
    );
  }

  let appliedSettings;
  let workFailed = false;
  let workError;
  let workResult;
  try {
    appliedSettings = exactlyOneRow(
      await client.query(
        `select pg_catalog.pg_backend_pid()::int as session_backend_pid,
                pg_catalog.set_config('lock_timeout', $1, false)
                  as applied_lock_timeout,
                pg_catalog.set_config('statement_timeout', $2, false)
                  as applied_statement_timeout`,
        [`${budget.lockTimeoutMs}ms`, `${budget.statementTimeoutMs}ms`]
      ),
      "migration DDL budget settings"
    );
    workResult = await work(client);
  } catch (error) {
    workFailed = true;
    workError = error;
  }

  const resetErrors = [];
  for (const setting of ["lock_timeout", "statement_timeout"]) {
    try {
      await client.query(`reset ${setting}`);
    } catch (error) {
      resetErrors.push(`${setting}: ${errorMessage(error)}`);
    }
  }
  if (resetErrors.length > 0) {
    const workFailure = workFailed
      ? ` Migration also failed (${errorMessage(workError)}).`
      : "";
    throw lifecycleError(
      "inbox_v2.migration_ddl_budget_reset_failed",
      `The migration connection did not reset every session timeout (${resetErrors.join("; ")}).${workFailure}`
    );
  }
  if (workFailed) throw workError;

  const sessionBackendPid = appliedSettings?.session_backend_pid;
  if (!Number.isSafeInteger(sessionBackendPid) || sessionBackendPid <= 0) {
    throw lifecycleError(
      "inbox_v2.migration_ddl_budget_evidence_invalid",
      "The migration connection returned an invalid PostgreSQL backend PID."
    );
  }
  const evidence = Object.freeze({
    schemaId: MIGRATION_DDL_BUDGET_EVIDENCE_SCHEMA_ID,
    sessionScope: "lifecycle_advisory_lock_connection",
    sessionBackendPid,
    lockTimeoutMs: budget.lockTimeoutMs,
    statementTimeoutMs: budget.statementTimeoutMs,
    appliedLockTimeout: requiredText(
      appliedSettings.applied_lock_timeout,
      "applied migration lock timeout"
    ),
    appliedStatementTimeout: requiredText(
      appliedSettings.applied_statement_timeout,
      "applied migration statement timeout"
    ),
    sessionSettingsReset: true
  });
  return Object.freeze({ result: workResult, evidence });
}

export async function resetInboxV2Database(options) {
  const databaseUrl = requiredDatabaseUrl(options.databaseUrl);
  if (
    options.manifestPath === undefined ||
    options.confirmation === undefined ||
    options.objectReceiptPath === undefined ||
    options.mig001EvidencePath === undefined
  ) {
    throw lifecycleError(
      "inbox_v2.reset_authority_missing",
      "Reset requires --manifest, --mig-001-evidence, --object-receipt and the exact --confirm manifest SHA-256."
    );
  }
  if (typeof options.bootstrap !== "string") {
    throw lifecycleError(
      "inbox_v2.reset_bootstrap_missing",
      "Reset requires an explicit repository bootstrap file whose exact bytes can be verified."
    );
  }
  const migrationsFolder = resolve(
    options.migrationsFolder ?? "packages/db/drizzle"
  );
  const migrationBundle = loadMigrationBundle(migrationsFolder);
  const [
    { manifest, digest },
    objectReceipt,
    mig001Evidence,
    bootstrapDocument
  ] = await Promise.all([
    readInboxV2DispositionManifest(options.manifestPath),
    readInboxV2ObjectStorageReceipt(options.objectReceiptPath),
    readInboxV2Mig001Evidence(options.mig001EvidencePath),
    resolveBootstrap(options.bootstrap)
  ]);
  const authorized = assertInboxV2DisposableResetContract({
    manifest,
    manifestDigest: digest,
    confirmation: options.confirmation
  });
  assertInboxV2ObjectStorageReceiptMatches({
    manifest: authorized,
    receipt: objectReceipt.receipt,
    receiptDigest: objectReceipt.digest
  });
  assertInboxV2Mig001EvidenceMatches({
    manifest: authorized,
    evidence: mig001Evidence.evidence,
    evidenceDigest: mig001Evidence.digest
  });
  if (bootstrapDocument.digest !== authorized.reset.bootstrapSha256) {
    throw lifecycleError(
      "inbox_v2.reset_bootstrap_digest_mismatch",
      "The selected repository bootstrap does not match the manifest digest."
    );
  }
  if (migrationBundle.digest !== authorized.target.migrationContractSha256) {
    throw lifecycleError(
      "inbox_v2.reset_migration_contract_mismatch",
      "The exact in-memory migration bundle does not match the reviewed disposition manifest."
    );
  }

  return withLifecycleConnection(databaseUrl, async ({ lockClient }) => {
    const target = await inspectInboxV2DatabaseTarget(lockClient);
    assertResetTargetMatchesManifest(target, authorized);
    const receiptContract = resetReceiptContract({
      manifest: authorized,
      manifestDigest: digest,
      migrationBundle,
      bootstrapDocument,
      mig001Evidence,
      objectReceipt,
      target
    });
    const preexistingReceipt = await readResetReceipt(
      lockClient,
      authorized.reset.generation
    );
    if (preexistingReceipt === null) {
      assertInboxV2DisposableResetAuthorized({
        manifest: authorized,
        manifestDigest: digest,
        confirmation: options.confirmation
      });
    }
    const fenceClient = await openDatabaseFenceConnection(databaseUrl, target);
    let connectionsDisabled = false;
    let transactionOpen = false;
    try {
      try {
        await setDatabaseAllowsConnections(
          fenceClient,
          target.databaseName,
          false
        );
        if (
          options.testOnlyLoseFenceAcquireResponse === true &&
          process.env.NODE_ENV === "test"
        ) {
          throw lifecycleError(
            "inbox_v2.reset_test_fence_acquire_response_lost",
            "Injected loss of the ALLOW_CONNECTIONS=false response."
          );
        }
      } catch (error) {
        try {
          await releaseDatabaseFenceWithFreshConnection(databaseUrl, target);
        } catch (recoveryError) {
          throw lifecycleError(
            "inbox_v2.reset_connection_fence_state_ambiguous",
            `The connection-fence request failed and automatic recovery could not prove ALLOW_CONNECTIONS=true (${errorMessage(error)}; recovery: ${errorMessage(recoveryError)}). Run the reviewed manual fence-recovery procedure before retrying.`
          );
        }
        throw error;
      }
      connectionsDisabled = true;
      await assertNoOtherDatabaseSessions(lockClient, target.databaseName);
      await lockClient.query("begin isolation level serializable");
      transactionOpen = true;
      await lockClient.query("set local lock_timeout = '5s'");
      await assertResetSchemaSet(lockClient);

      const existingReceipt = await readResetReceipt(
        lockClient,
        authorized.reset.generation
      );
      if (existingReceipt !== null) {
        const noOpResult = await verifyCompletedResetReceipt({
          client: lockClient,
          existingReceipt,
          receiptContract,
          migrationBundle,
          bootstrap: bootstrapDocument.bootstrap,
          target,
          migrationsFolder
        });
        await lockClient.query("commit");
        transactionOpen = false;
        return noOpResult;
      }

      assertInboxV2DisposableResetAuthorized({
        manifest: authorized,
        manifestDigest: digest,
        confirmation: options.confirmation
      });

      const observedJournal = await readAppliedMigrationJournal(lockClient);
      const observedJournalDigest = digestMigrationJournal(observedJournal);
      if (observedJournalDigest !== authorized.target.migrationJournalSha256) {
        throw lifecycleError(
          "inbox_v2.reset_migration_journal_mismatch",
          "The live migration journal does not match the reviewed disposition manifest."
        );
      }
      const observedInventory =
        await inspectInboxV2DatabaseInventory(lockClient);
      assertResetInventoryMatchesManifest(observedInventory, authorized);
      const previousEpoch = await readBootstrapTenantStreamEpoch(
        lockClient,
        bootstrapDocument.bootstrap.tenant.id
      );
      const historicalResetReceipts = await readAllResetReceipts(lockClient);

      await resetManagedDatabaseSchemasInTransaction(lockClient);
      if (
        options.testOnlyFailAfterSchemaReset === true &&
        process.env.NODE_ENV === "test"
      ) {
        throw lifecycleError(
          "inbox_v2.reset_test_failure_after_schema_reset",
          "Injected DB-008 transaction rollback verification failure."
        );
      }
      await applyMigrationBundleInTransaction(lockClient, migrationBundle);
      const journal = await assertCurrentMigrationJournalAgainstBundle(
        lockClient,
        migrationBundle
      );
      await assertCurrentInboxV2Schema(lockClient, migrationBundle);
      const bootstrapResult = await bootstrapInboxV2RepositoryInTransaction(
        lockClient,
        bootstrapDocument.bootstrap
      );
      if (
        previousEpoch !== null &&
        bootstrapResult.streamEpoch === previousEpoch
      ) {
        throw lifecycleError(
          "inbox_v2.reset_stream_epoch_not_rotated",
          "A reset must create a new tenant stream epoch."
        );
      }
      await restoreResetReceipts(lockClient, historicalResetReceipts);
      const postInventory = await inspectInboxV2DatabaseInventory(lockClient);
      await insertResetReceipt(lockClient, {
        ...receiptContract,
        previousStreamEpoch: previousEpoch,
        streamEpoch: bootstrapResult.streamEpoch,
        migrationJournalSha256: journal.appliedDigest,
        databaseInventorySha256: postInventory.digest
      });
      await lockClient.query("commit");
      transactionOpen = false;
      return Object.freeze({
        action: "reset",
        manifestId: authorized.manifestId,
        resetGeneration: authorized.reset.generation,
        manifestSha256: digest,
        target,
        migrationsFolder,
        migrationCount: journal.applied.length,
        migrationContractSha256: journal.expectedDigest,
        migrationJournalSha256: journal.appliedDigest,
        previousStreamEpoch: previousEpoch,
        bootstrap: bootstrapResult
      });
    } catch (error) {
      if (transactionOpen) {
        await lockClient.query("rollback").catch(() => {});
        transactionOpen = false;
      }
      throw error;
    } finally {
      if (connectionsDisabled) {
        try {
          await releaseDatabaseFence({
            databaseUrl,
            fenceClient,
            target
          });
        } finally {
          await fenceClient.end();
        }
      } else {
        await fenceClient.end();
      }
    }
  });
}

export async function bootstrapInboxV2Repository(client, rawBootstrap) {
  const bootstrap = parseInboxV2RepositoryBootstrap(rawBootstrap);
  await client.query("begin isolation level serializable");
  try {
    const result = await bootstrapInboxV2RepositoryInTransaction(
      client,
      bootstrap
    );
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  }
}

async function bootstrapInboxV2RepositoryInTransaction(client, rawBootstrap) {
  const bootstrap = parseInboxV2RepositoryBootstrap(rawBootstrap);
  const tenant = bootstrap.tenant;
  await client.query(
    `insert into public.tenants (
         id, slug, display_name, deployment_type, created_at, updated_at
       ) values ($1, $2, $3, $4, transaction_timestamp(), transaction_timestamp())
       on conflict (id) do nothing`,
    [tenant.id, tenant.slug, tenant.displayName, tenant.deploymentType]
  );
  const tenantRow = exactlyOneRow(
    await client.query(
      `select id, slug, display_name, deployment_type
           from public.tenants
          where id = $1
          for share`,
      [tenant.id]
    ),
    "bootstrap tenant"
  );
  assertExactRow(
    tenantRow,
    {
      id: tenant.id,
      slug: tenant.slug,
      display_name: tenant.displayName,
      deployment_type: tenant.deploymentType
    },
    "bootstrap tenant"
  );

  const candidateEpoch = `stream:epoch:${randomUUID()}`;
  await client.query(
    `insert into public.inbox_v2_tenant_stream_heads (
         tenant_id, stream_epoch, last_position, min_retained_position,
         revision, created_at, updated_at
       ) values ($1, $2, 0, 0, 1, transaction_timestamp(), transaction_timestamp())
       on conflict (tenant_id) do nothing`,
    [tenant.id, candidateEpoch]
  );
  const streamRow = exactlyOneRow(
    await client.query(
      `select tenant_id, stream_epoch, last_position::text,
                min_retained_position::text, revision::text
           from public.inbox_v2_tenant_stream_heads
          where tenant_id = $1
          for share`,
      [tenant.id]
    ),
    "bootstrap tenant stream"
  );
  assertExactRow(
    streamRow,
    {
      tenant_id: tenant.id,
      last_position: "0",
      min_retained_position: "0",
      revision: "1"
    },
    "bootstrap tenant stream"
  );
  const streamEpoch = requiredText(
    streamRow.stream_epoch,
    "bootstrap stream epoch"
  );

  for (const projection of bootstrap.projections) {
    await bootstrapProjection(client, tenant.id, streamEpoch, projection);
  }
  return Object.freeze({
    tenantId: tenant.id,
    streamEpoch,
    projectionCount: bootstrap.projections.length,
    projections: bootstrap.projections
  });
}

export async function inspectInboxV2DatabaseTarget(client) {
  let result;
  try {
    result = await client.query(`
      select (pg_catalog.pg_control_system()).system_identifier::text
               as postgres_system_identifier,
             current_database() as database_name,
             pg_catalog.pg_get_userbyid(database_row.datdba) as database_owner,
             current_user as current_user
        from pg_catalog.pg_database database_row
       where database_row.datname = current_database()
    `);
  } catch (error) {
    throw lifecycleError(
      "inbox_v2.reset_target_fingerprint_unavailable",
      `Cannot read the PostgreSQL cluster fingerprint: ${errorMessage(error)}`
    );
  }
  const row = exactlyOneRow(result, "database target fingerprint");
  return Object.freeze({
    postgresSystemIdentifier: requiredText(
      row.postgres_system_identifier,
      "PostgreSQL system identifier"
    ),
    databaseName: requiredText(row.database_name, "database name"),
    databaseOwner: requiredText(row.database_owner, "database owner"),
    currentUser: requiredText(row.current_user, "current database user")
  });
}

export async function inspectInboxV2DatabaseInventory(client) {
  const tableResult = await client.query(`
    select namespace.nspname as schema_name,
           relation.relname as table_name,
           relation.relkind as relation_kind
      from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace
        on namespace.oid = relation.relnamespace
     where namespace.nspname in ('public', 'drizzle')
       and relation.relkind in ('r', 'p', 'm', 'S', 'f')
     order by namespace.nspname, relation.relname
  `);
  const tables = [];
  for (const row of tableResult.rows) {
    const schemaName = requiredText(row.schema_name, "inventory schema name");
    const tableName = requiredText(row.table_name, "inventory table name");
    const relationKind = requiredText(
      row.relation_kind,
      "inventory relation kind"
    );
    if (relationKind === "f") {
      throw lifecycleError(
        "inbox_v2.reset_foreign_table_inventory_unsupported",
        `Reset refuses foreign table ${schemaName}.${tableName}; its remote state cannot be fingerprinted safely.`
      );
    }
    if (schemaName === "public" && tableName === RESET_RECEIPT_RELATION) {
      continue;
    }
    const countRow = exactlyOneRow(
      await client.query(
        `select count(*)::text as row_count
           from ${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)}`
      ),
      `inventory relation ${schemaName}.${tableName}`
    );
    tables.push(
      Object.freeze({
        schemaName,
        tableName,
        relationKind,
        rowCount: requiredText(
          countRow.row_count,
          `${schemaName}.${tableName} row count`
        ),
        contentSha256: await fingerprintRelationContent(
          client,
          schemaName,
          tableName,
          relationKind
        )
      })
    );
  }
  const countByTable = new Map(
    tables.map(({ schemaName, tableName, rowCount }) => [
      `${schemaName}.${tableName}`,
      Number(rowCount)
    ])
  );
  const tenantCount = countByTable.get("public.tenants") ?? 0;
  const v1BusinessRowCount = [...V1_BUSINESS_TABLES].reduce(
    (total, tableName) =>
      total + (countByTable.get(`public.${tableName}`) ?? 0),
    0
  );
  const observedAt = requiredText(
    exactlyOneRow(
      await client.query("select statement_timestamp()::text as observed_at"),
      "database inventory observation time"
    ).observed_at,
    "database inventory observation time"
  );
  const activeProviderSessions = await countSemanticRows(client, observedAt, [
    [
      "channel_sessions",
      `(status not in ('not_started', 'disconnected', 'revoked', 'error')
        or session_encrypted is not null
        or lease_expires_at > $1::timestamptz)`
    ],
    ["channel_connectors", "status not in ('draft', 'disabled', 'deleted')"],
    ["source_connections", "status not in ('draft', 'disabled', 'deleted')"],
    ["source_accounts", "status not in ('draft', 'disabled', 'deleted')"],
    [
      "channel_auth_challenges",
      `(status not in ('succeeded', 'failed', 'expired', 'cancelled')
        and (expires_at is null or expires_at > $1::timestamptz))`
    ],
    [
      "channel_provider_validation_jobs",
      "status not in ('succeeded', 'failed')"
    ]
  ]);
  const pendingOrUncertainOutbox = await countSemanticRows(client, observedAt, [
    ["outbox", "status <> 'processed'"],
    ["messages", "direction = 'outbound' and status = 'queued'"],
    ["inbox_v2_outbox_work_items", "state in ('pending', 'leased')"],
    [
      "inbox_v2_outbound_dispatches",
      "state in ('queued', 'attempting', 'retryable_failure', 'outcome_unknown')"
    ],
    [
      "inbox_v2_outbound_dispatch_attempts",
      "outcome_kind in ('pending', 'retryable_failure', 'outcome_unknown')"
    ]
  ]);
  const activeLeases = await countSemanticRows(client, observedAt, [
    ["channel_sessions", "lease_expires_at > $1::timestamptz"],
    [
      "inbox_v2_outbox_work_items",
      "state = 'leased' and lease_expires_at > $1::timestamptz"
    ],
    [
      "inbox_v2_outbound_dispatch_attempts",
      "outcome_kind = 'pending' and lease_expires_at > $1::timestamptz"
    ],
    [
      "inbox_v2_data_governance_destructive_checkpoint_leases",
      "state = 'claimed' and lease_expires_at > $1::timestamptz"
    ],
    [
      "inbox_v2_data_governance_restore_leases",
      "state = 'active' and lease_expires_at > $1::timestamptz"
    ]
  ]);
  const publishedV2Cursor =
    (await countSemanticRows(client, observedAt, [
      ["inbox_v2_tenant_stream_heads", "$1::timestamptz is not null"]
    ])) > 0;
  const largeObjectCount = Number(
    requiredText(
      exactlyOneRow(
        await client.query(`
          select count(*)::text as object_count
            from pg_catalog.pg_largeobject_metadata
        `),
        "database large-object inventory"
      ).object_count,
      "database large-object count"
    )
  );
  if (!Number.isSafeInteger(largeObjectCount) || largeObjectCount < 0) {
    throw lifecycleError(
      "inbox_v2.database_lifecycle_invariant",
      "Database large-object inventory returned an invalid count."
    );
  }
  const unsupportedDatabaseObjects = (
    await client.query(`
      select object_kind, object_count::int
        from (
          select 'event_trigger'::text as object_kind, count(*) as object_count
            from pg_catalog.pg_event_trigger
          union all
          select 'foreign_server', count(*)
            from pg_catalog.pg_foreign_server
          union all
          select 'publication', count(*)
            from pg_catalog.pg_publication
          union all
          select 'subscription', count(*)
            from pg_catalog.pg_subscription
           where subdbid = (
             select oid from pg_catalog.pg_database
              where datname = current_database()
           )
          union all
          select 'custom_extension', count(*)
            from pg_catalog.pg_extension
           where extname <> 'plpgsql'
          union all
          select 'default_acl', count(*)
            from pg_catalog.pg_default_acl
        ) inventory
       order by object_kind
    `)
  ).rows.map((row) =>
    Object.freeze({
      objectKind: requiredText(
        row.object_kind,
        "unsupported database object kind"
      ),
      objectCount: row.object_count
    })
  );
  if (
    unsupportedDatabaseObjects.some(
      ({ objectCount }) => !Number.isSafeInteger(objectCount) || objectCount < 0
    )
  ) {
    throw lifecycleError(
      "inbox_v2.database_lifecycle_invariant",
      "Unsupported database-level object inventory returned an invalid count."
    );
  }
  const semantic = Object.freeze({
    activeProviderSessions,
    pendingOrUncertainOutbox,
    activeLeases,
    publishedV2Cursor,
    largeObjectCount,
    unsupportedDatabaseObjects
  });
  const schemaCatalogSha256 = await fingerprintManagedSchemaCatalog(client);
  return Object.freeze({
    tables,
    tenantCount,
    v1BusinessRowCount,
    ...semantic,
    schemaCatalogSha256,
    digest: sha256(JSON.stringify({ tables, semantic, schemaCatalogSha256 }))
  });
}

export async function readAppliedMigrationJournal(client) {
  const existence = exactlyOneRow(
    await client.query("select to_regclass($1) as relation_name", [
      DRIZZLE_MIGRATIONS_RELATION
    ]),
    "migration journal existence"
  );
  if (existence.relation_name === null) return [];
  const result = await client.query(`
    select id::text, hash, created_at::text
      from drizzle.__drizzle_migrations
     order by created_at, id
  `);
  return result.rows.map((row) =>
    Object.freeze({
      id: requiredText(row.id, "migration journal id"),
      hash: requiredText(row.hash, "migration journal hash"),
      createdAt: requiredText(row.created_at, "migration journal created_at")
    })
  );
}

export function digestMigrationJournal(rows) {
  return sha256(
    JSON.stringify(rows.map(({ hash, createdAt }) => ({ hash, createdAt })))
  );
}

export function expectedMigrationContract(migrationsFolder) {
  return readMigrationFiles({ migrationsFolder }).map((migration) =>
    Object.freeze({
      hash: migration.hash,
      createdAt: String(migration.folderMillis)
    })
  );
}

function loadMigrationBundle(migrationsFolder) {
  const migrations = readMigrationFiles({ migrationsFolder });
  const contract = migrations.map((migration) =>
    Object.freeze({
      hash: migration.hash,
      createdAt: String(migration.folderMillis)
    })
  );
  return Object.freeze({
    migrations,
    contract,
    digest: digestMigrationJournal(contract)
  });
}

export async function assertMigrationJournalPrefix(client, migrationsFolder) {
  const expected = expectedMigrationContract(migrationsFolder);
  const applied = await readAppliedMigrationJournal(client);
  if (applied.length > expected.length) {
    throw lifecycleError(
      "inbox_v2.migration_journal_not_prefix",
      "The database contains migrations newer than this repository contract."
    );
  }
  for (let index = 0; index < applied.length; index += 1) {
    const actual = applied[index];
    const contract = expected[index];
    if (
      actual.hash !== contract.hash ||
      actual.createdAt !== contract.createdAt
    ) {
      throw lifecycleError(
        "inbox_v2.migration_journal_not_prefix",
        `Applied migration ${index} does not match the exact checked-in journal prefix.`
      );
    }
  }
  if (applied.length === 0) await assertFreshPublicSchema(client);
  return Object.freeze({ expected, applied });
}

export async function assertCurrentMigrationJournal(client, migrationsFolder) {
  const { expected, applied } = await assertMigrationJournalPrefix(
    client,
    migrationsFolder
  );
  if (applied.length !== expected.length) {
    throw lifecycleError(
      "inbox_v2.migration_journal_incomplete",
      `Expected ${expected.length} applied migrations; found ${applied.length}.`
    );
  }
  return Object.freeze({
    expected,
    applied,
    expectedDigest: digestMigrationJournal(expected),
    appliedDigest: digestMigrationJournal(applied)
  });
}

async function assertCurrentMigrationJournalAgainstBundle(client, bundle) {
  const applied = await readAppliedMigrationJournal(client);
  if (applied.length !== bundle.contract.length) {
    throw lifecycleError(
      "inbox_v2.migration_journal_incomplete",
      `Expected ${bundle.contract.length} applied migrations; found ${applied.length}.`
    );
  }
  for (let index = 0; index < applied.length; index += 1) {
    if (
      applied[index].hash !== bundle.contract[index].hash ||
      applied[index].createdAt !== bundle.contract[index].createdAt
    ) {
      throw lifecycleError(
        "inbox_v2.migration_journal_not_prefix",
        `Applied migration ${index} does not match the exact in-memory migration bundle.`
      );
    }
  }
  return Object.freeze({
    expected: bundle.contract,
    applied,
    expectedDigest: bundle.digest,
    appliedDigest: digestMigrationJournal(applied)
  });
}

export async function assertCurrentInboxV2Schema(client, migrationBundle) {
  if (!migrationBundle || !Array.isArray(migrationBundle.migrations)) {
    throw lifecycleError(
      "inbox_v2.database_lifecycle_invariant",
      "Current-schema audit requires the exact in-memory migration bundle."
    );
  }
  await assertNoUnsafeInboxV2DefaultPrivileges(client);
  await assertNoPublicSchemaCreate(client);
  for (const relation of REQUIRED_CURRENT_RELATIONS) {
    const row = exactlyOneRow(
      await client.query(
        `select (
           select relation_row.relkind::text
             from pg_catalog.pg_class relation_row
            where relation_row.oid = to_regclass($1)
         ) as relation_kind,
         (
           select pg_get_userbyid(relation_row.relowner)
             from pg_catalog.pg_class relation_row
            where relation_row.oid = to_regclass($1)
         ) as relation_owner,
         (
           select pg_get_userbyid(database_row.datdba)
             from pg_catalog.pg_database database_row
            where database_row.datname = current_database()
         ) as database_owner,
         coalesce((
           select exists (
             select 1
               from aclexplode(coalesce(
                 relation_row.relacl,
                 acldefault('r', relation_row.relowner)
               )) privilege_row
              where privilege_row.grantee = 0
           )
             from pg_catalog.pg_class relation_row
            where relation_row.oid = to_regclass($1)
         ), false) as public_privilege,
         coalesce((
           select exists (
             select 1
               from aclexplode(coalesce(
                 relation_row.relacl,
                 acldefault('r', relation_row.relowner)
               )) privilege_row
              where privilege_row.grantee <> relation_row.relowner
           ) or exists (
             select 1
               from pg_catalog.pg_attribute attribute_row
               cross join lateral aclexplode(attribute_row.attacl) privilege_row
              where attribute_row.attrelid = relation_row.oid
                and attribute_row.attnum > 0
                and not attribute_row.attisdropped
                and privilege_row.grantee <> relation_row.relowner
           )
             from pg_catalog.pg_class relation_row
            where relation_row.oid = to_regclass($1)
         ), false) as non_owner_privilege`,
        [`public.${relation}`]
      ),
      `required relation ${relation}`
    );
    if (!new Set(["r", "p"]).has(row.relation_kind)) {
      throw lifecycleError(
        "inbox_v2.current_schema_incomplete",
        `Required table public.${relation} is missing or has the wrong relation kind.`
      );
    }
    if (row.public_privilege !== false) {
      throw lifecycleError(
        "inbox_v2.current_schema_privilege_mismatch",
        `Required table public.${relation} grants a privilege to PUBLIC.`
      );
    }
    if (
      REQUIRED_EXCLUSIVE_OWNER_RELATIONS.has(relation) &&
      (row.relation_owner !== row.database_owner ||
        row.non_owner_privilege !== false)
    ) {
      throw lifecycleError(
        "inbox_v2.current_schema_privilege_mismatch",
        `Required table public.${relation} must be owned exclusively by the database owner.`
      );
    }
  }
  await assertNoPublicManagedRelationPrivileges(client);
  for (const routine of REQUIRED_CURRENT_FUNCTIONS) {
    const result = await client.query(
      `select routine_row.prosrc,
              language_row.lanname as language_name,
              pg_get_function_result(routine_row.oid) as result_type,
              routine_row.prosecdef,
              routine_row.proisstrict,
              routine_row.proleakproof,
              routine_row.provolatile::text,
              routine_row.proparallel::text,
              coalesce(routine_row.proconfig, array[]::text[]) as proconfig,
              pg_get_userbyid(routine_row.proowner) as owner_name,
              exists (
                select 1
                  from aclexplode(coalesce(
                    routine_row.proacl,
                    acldefault('f', routine_row.proowner)
                  )) privilege_row
                 where privilege_row.grantee = 0
                   and privilege_row.privilege_type = 'EXECUTE'
              ) as public_execute,
               coalesce((
                select array_agg(
                         (case when privilege_row.grantee = 0 then 'PUBLIC'
                               else grantee_role.rolname::text end)
                         order by case when privilege_row.grantee = 0
                                       then 'PUBLIC'
                                       else grantee_role.rolname::text end
                       )
                  from aclexplode(coalesce(
                    routine_row.proacl,
                    acldefault('f', routine_row.proowner)
                  )) privilege_row
                  left join pg_catalog.pg_roles grantee_role
                    on grantee_role.oid = privilege_row.grantee
                  where privilege_row.privilege_type = 'EXECUTE'
               ), array[]::text[]) as execute_grantees,
               exists (
                 select 1
                   from aclexplode(coalesce(
                     routine_row.proacl,
                     acldefault('f', routine_row.proowner)
                   )) privilege_row
                  where privilege_row.privilege_type = 'EXECUTE'
                    and privilege_row.grantee <> routine_row.proowner
                    and privilege_row.is_grantable
               ) as unsafe_execute_grant_option
         from pg_catalog.pg_proc routine_row
         join pg_catalog.pg_language language_row
           on language_row.oid = routine_row.prolang
        where routine_row.oid = to_regprocedure($1)`,
      [routine]
    );
    if (result.rows.length !== 1) {
      throw lifecycleError(
        "inbox_v2.current_schema_incomplete",
        `Required routine ${routine} is missing.`
      );
    }
    const row = result.rows[0];
    const expected = expectedFunctionContract(migrationBundle, routine);
    const functionDifferences = [];
    for (const [name, actual, contract] of [
      ["body", normalizeFunctionBody(row.prosrc), expected.body],
      [
        "language",
        requiredText(row.language_name, `${routine} language`),
        expected.language
      ],
      ["result", normalizeFunctionResult(row.result_type), expected.resultType],
      ["security-definer", row.prosecdef, expected.securityDefiner],
      ["strict", row.proisstrict, expected.strict],
      ["leakproof", row.proleakproof, expected.leakproof],
      [
        "volatility",
        requiredText(row.provolatile, `${routine} volatility`),
        expected.volatility
      ],
      [
        "parallel",
        requiredText(row.proparallel, `${routine} parallel safety`),
        expected.parallel
      ],
      [
        "config",
        JSON.stringify(normalizeFunctionConfig(row.proconfig)),
        JSON.stringify(expected.config)
      ]
    ]) {
      if (actual !== contract) functionDifferences.push(name);
    }
    if (functionDifferences.length > 0) {
      throw lifecycleError(
        "inbox_v2.current_schema_definition_mismatch",
        `Required routine ${routine} does not match the checked-in migration contract (${functionDifferences.join(", ")}).`
      );
    }
    const privilegeContract = REQUIRED_FUNCTION_PRIVILEGES.get(routine);
    if (
      privilegeContract &&
      (row.owner_name !== privilegeContract.owner ||
        row.public_execute !== privilegeContract.publicExecute ||
        row.unsafe_execute_grant_option !== false ||
        JSON.stringify(row.execute_grantees) !==
          JSON.stringify(privilegeContract.executeGrantees))
    ) {
      throw lifecycleError(
        "inbox_v2.current_schema_privilege_mismatch",
        `Required routine ${routine} has an unsafe owner, grantee or grant option.`
      );
    }
  }
  for (const [relation, trigger, routine] of REQUIRED_CURRENT_TRIGGERS) {
    const result = await client.query(
      `select trigger_row.tgenabled::text,
               trigger_row.tgtype::int,
               trigger_row.tgdeferrable,
               trigger_row.tginitdeferred,
               trigger_row.tgconstraint <> 0 as constraint_trigger,
               trigger_row.tgqual is null as no_when_clause,
               trigger_row.tgattr::text as updated_columns,
               encode(trigger_row.tgargs, 'hex') as encoded_arguments
           from pg_catalog.pg_trigger trigger_row
          where trigger_row.tgrelid = to_regclass($1)
            and trigger_row.tgname = $2
            and not trigger_row.tgisinternal
            and trigger_row.tgfoid = to_regprocedure($3)`,
      [`public.${relation}`, trigger, routine]
    );
    if (result.rows.length !== 1) {
      throw lifecycleError(
        "inbox_v2.current_schema_incomplete",
        `Required trigger public.${relation}.${trigger} is missing or bound to the wrong routine.`
      );
    }
    const row = result.rows[0];
    const expected = expectedTriggerContract(migrationBundle, trigger);
    if (
      row.tgenabled !== "O" ||
      row.tgtype !== expected.typeMask ||
      row.tgdeferrable !== expected.deferrable ||
      row.tginitdeferred !== expected.initiallyDeferred ||
      row.constraint_trigger !== expected.constraintTrigger ||
      row.no_when_clause !== true ||
      row.updated_columns !== "" ||
      row.encoded_arguments !== ""
    ) {
      throw lifecycleError(
        "inbox_v2.current_schema_definition_mismatch",
        `Required trigger public.${relation}.${trigger} has the wrong mode, timing or events.`
      );
    }
  }
  for (const constraint of REQUIRED_CURRENT_CONSTRAINTS) {
    const result = await client.query(
      `select constraint_row.contype::text,
              constraint_row.convalidated,
              constraint_row.condeferrable,
              constraint_row.condeferred,
              constraint_row.connoinherit,
              constraint_row.confupdtype::text,
              constraint_row.confdeltype::text,
              constraint_row.confmatchtype::text,
               pg_get_constraintdef(constraint_row.oid, false) as definition,
              coalesce((
                select array_agg(attribute_row.attname::text order by key_row.ordinality)
                  from unnest(constraint_row.conkey) with ordinality key_row(attnum, ordinality)
                  join pg_catalog.pg_attribute attribute_row
                    on attribute_row.attrelid = constraint_row.conrelid
                   and attribute_row.attnum = key_row.attnum
              ), array[]::text[]) as column_names,
              case when constraint_row.confrelid = 0 then null
                   else constraint_row.confrelid::regclass::text end
                as reference_relation,
              coalesce((
                select array_agg(attribute_row.attname::text order by key_row.ordinality)
                  from unnest(constraint_row.confkey) with ordinality key_row(attnum, ordinality)
                  join pg_catalog.pg_attribute attribute_row
                    on attribute_row.attrelid = constraint_row.confrelid
                   and attribute_row.attnum = key_row.attnum
              ), array[]::text[]) as reference_column_names
           from pg_catalog.pg_constraint constraint_row
          where constraint_row.conrelid = to_regclass($1)
            and constraint_row.conname = $2`,
      [`public.${constraint.relation}`, constraint.name]
    );
    if (result.rows.length !== 1) {
      throw lifecycleError(
        "inbox_v2.current_schema_incomplete",
        `Required constraint public.${constraint.relation}.${constraint.name} is missing.`
      );
    }
    const row = result.rows[0];
    const exactDefinition = normalizeExactCatalogDefinition(row.definition);
    const definition = normalizeSqlDefinition(exactDefinition);
    const definitionMatches = (constraint.definitionFragments ?? []).every(
      (fragment) => definition.includes(normalizeSqlDefinition(fragment))
    );
    const constraintDifferences = [];
    for (const [name, actual, contract] of [
      ["type", row.contype, constraint.type],
      ["validated", row.convalidated, true],
      ["deferrable", row.condeferrable, constraint.deferrable ?? false],
      [
        "initially-deferred",
        row.condeferred,
        constraint.initiallyDeferred ?? false
      ],
      [
        "columns",
        constraint.columns === undefined
          ? null
          : JSON.stringify(row.column_names),
        constraint.columns === undefined
          ? null
          : JSON.stringify(constraint.columns)
      ],
      [
        "reference-relation",
        constraint.referenceRelation === undefined
          ? null
          : normalizeRelationName(row.reference_relation),
        constraint.referenceRelation ?? null
      ],
      [
        "reference-columns",
        constraint.referenceColumns === undefined
          ? null
          : JSON.stringify(row.reference_column_names),
        constraint.referenceColumns === undefined
          ? null
          : JSON.stringify(constraint.referenceColumns)
      ],
      ["definition", definitionMatches, true]
    ]) {
      if (actual !== contract) constraintDifferences.push(name);
    }
    if (
      constraint.definitionSha256 !== undefined &&
      sha256(Buffer.from(exactDefinition, "utf8")) !==
        constraint.definitionSha256
    ) {
      constraintDifferences.push("definition-digest");
    }
    if (constraint.type === "c" && row.connoinherit !== false) {
      constraintDifferences.push("inheritance");
    }
    if (
      constraint.type === "f" &&
      (row.confupdtype !== constraint.onUpdate ||
        row.confdeltype !== constraint.onDelete ||
        row.confmatchtype !== "s")
    ) {
      constraintDifferences.push("foreign-key-actions");
    }
    if (constraintDifferences.length > 0) {
      throw lifecycleError(
        "inbox_v2.current_schema_definition_mismatch",
        `Required constraint public.${constraint.relation}.${constraint.name} does not match the checked-in structural contract (${constraintDifferences.join(", ")}).`
      );
    }
  }
  for (const index of REQUIRED_CURRENT_INDEXES) {
    const result = await client.query(
      `select index_row.indisvalid,
              index_row.indisready,
              index_row.indislive,
              index_row.indisunique,
              index_row.indisprimary,
              pg_get_indexdef(index_row.indexrelid) as definition
         from pg_catalog.pg_index index_row
        where index_row.indexrelid = to_regclass($1)`,
      [`public.${index.name}`]
    );
    if (result.rows.length !== 1) {
      throw lifecycleError(
        "inbox_v2.current_schema_incomplete",
        `Required index public.${index.name} is missing.`
      );
    }
    const row = result.rows[0];
    if (
      row.indisvalid !== true ||
      row.indisready !== true ||
      row.indislive !== true ||
      row.indisunique !== index.unique ||
      row.indisprimary !== index.primary ||
      normalizeSqlDefinition(row.definition) !== index.definition
    ) {
      throw lifecycleError(
        "inbox_v2.current_schema_definition_mismatch",
        `Required index public.${index.name} does not match the checked-in structural contract.`
      );
    }
  }
  await assertCurrentInboxV2RoleSecurity(client);
}

async function assertCurrentInboxV2RoleSecurity(client) {
  const result = await client.query(
    `select rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb,
            rolcanlogin, rolreplication, rolbypassrls
       from pg_catalog.pg_roles
      where rolname = any($1::text[])
      order by rolname`,
    [REQUIRED_SECURITY_ROLES]
  );
  if (result.rows.length !== REQUIRED_SECURITY_ROLES.length) {
    throw lifecycleError(
      "inbox_v2.current_schema_incomplete",
      "One or more required Inbox V2 security roles are missing."
    );
  }
  for (const row of result.rows) {
    if (
      row.rolsuper !== false ||
      row.rolinherit !== true ||
      row.rolcreaterole !== false ||
      row.rolcreatedb !== false ||
      row.rolcanlogin !== false ||
      row.rolreplication !== false ||
      row.rolbypassrls !== false
    ) {
      throw lifecycleError(
        "inbox_v2.current_schema_privilege_mismatch",
        `Security role ${row.rolname} has unsafe attributes.`
      );
    }
  }
  const membership = exactlyOneRow(
    await client.query(`
      select
        pg_has_role(
          'hulee_inbox_v2_runtime',
          'hulee_inbox_v2_membership_owner',
          'MEMBER'
        ) as runtime_membership_owner,
        pg_has_role(
          'hulee_inbox_v2_runtime',
          'hulee_inbox_v2_retention_owner',
          'MEMBER'
        ) as runtime_retention_owner,
        pg_has_role(
          'hulee_inbox_v2_membership_repair',
          'hulee_inbox_v2_membership_owner',
          'MEMBER'
        ) as repair_membership_owner
    `),
    "Inbox V2 security-role memberships"
  );
  if (Object.values(membership).some((value) => value !== false)) {
    throw lifecycleError(
      "inbox_v2.current_schema_privilege_mismatch",
      "Runtime or repair roles inherit a forbidden Inbox V2 owner role."
    );
  }
}

async function assertNoUnsafeInboxV2DefaultPrivileges(client) {
  const row = exactlyOneRow(
    await client.query(`
      select count(*)::int as unsafe_count
        from pg_catalog.pg_default_acl
    `),
    "database default privileges"
  );
  if (row.unsafe_count !== 0) {
    throw lifecycleError(
      "inbox_v2.current_schema_privilege_mismatch",
      "Inbox V2 requires an explicit empty default-privilege catalog in its dedicated database."
    );
  }
}

async function assertNoPublicSchemaCreate(client) {
  const row = exactlyOneRow(
    await client.query(`
      select count(*)::int as unsafe_count
        from pg_catalog.pg_namespace namespace_row
        cross join lateral aclexplode(coalesce(
          namespace_row.nspacl,
          acldefault('n', namespace_row.nspowner)
        )) privilege_row
       where namespace_row.nspname in ('public', 'drizzle')
         and privilege_row.grantee = 0
         and privilege_row.privilege_type = 'CREATE'
    `),
    "managed schema PUBLIC CREATE privileges"
  );
  if (row.unsafe_count !== 0) {
    throw lifecycleError(
      "inbox_v2.current_schema_privilege_mismatch",
      "PUBLIC must not have CREATE on the public or drizzle schema."
    );
  }
}

async function assertNoPublicManagedRelationPrivileges(client) {
  const row = exactlyOneRow(
    await client.query(`
      select count(*)::int as unsafe_count
        from (
          select relation_row.oid, privilege_row.privilege_type
            from pg_catalog.pg_class relation_row
            join pg_catalog.pg_namespace namespace_row
              on namespace_row.oid = relation_row.relnamespace
            cross join lateral aclexplode(coalesce(
              relation_row.relacl,
              acldefault(
                (case when relation_row.relkind = 'S' then 'S' else 'r' end)::"char",
                relation_row.relowner
              )
            )) privilege_row
           where namespace_row.nspname in ('public', 'drizzle')
             and relation_row.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
             and privilege_row.grantee = 0
          union all
          select attribute_row.attrelid, privilege_row.privilege_type
            from pg_catalog.pg_attribute attribute_row
            join pg_catalog.pg_class relation_row
              on relation_row.oid = attribute_row.attrelid
            join pg_catalog.pg_namespace namespace_row
              on namespace_row.oid = relation_row.relnamespace
            cross join lateral aclexplode(attribute_row.attacl) privilege_row
           where namespace_row.nspname in ('public', 'drizzle')
             and relation_row.relkind in ('r', 'p', 'v', 'm', 'f')
             and attribute_row.attnum > 0
             and not attribute_row.attisdropped
             and privilege_row.grantee = 0
        ) unsafe_privilege
    `),
    "managed PUBLIC relation privileges"
  );
  if (row.unsafe_count !== 0) {
    throw lifecycleError(
      "inbox_v2.current_schema_privilege_mismatch",
      "A managed relation, sequence or column grants a privilege to PUBLIC."
    );
  }
}

async function withLifecycleConnection(databaseUrl, work) {
  const pool = new Pool({ connectionString: databaseUrl, max: 4 });
  const lockClient = await pool.connect();
  let locked = false;
  try {
    const row = exactlyOneRow(
      await lockClient.query(
        "select pg_catalog.pg_try_advisory_lock(pg_catalog.hashtext($1)) as locked",
        [LIFECYCLE_LOCK_KEY]
      ),
      "database lifecycle lock"
    );
    if (row.locked !== true) {
      throw lifecycleError(
        "inbox_v2.database_lifecycle_lock_busy",
        "Another Inbox V2 database lifecycle command owns the migration lock."
      );
    }
    locked = true;
    return await work({ pool, lockClient });
  } finally {
    if (locked) {
      await lockClient
        .query(
          "select pg_catalog.pg_advisory_unlock(pg_catalog.hashtext($1))",
          [LIFECYCLE_LOCK_KEY]
        )
        .catch(() => {});
    }
    lockClient.release();
    await pool.end();
  }
}

async function bootstrapProjection(client, tenantId, streamEpoch, projection) {
  const parameters = [
    tenantId,
    projection.projectionId,
    projection.scopeId,
    streamEpoch,
    projection.projectionSchemaVersion
  ];
  await client.query(
    `insert into public.inbox_v2_projection_generations (
       tenant_id, projection_id, scope_id, generation, stream_epoch,
       projection_schema_version, state, min_retained_position, revision,
       created_at, activated_at, retired_at, updated_at
     ) values (
       $1, $2, $3, 1, $4, $5, 'active', 0, 1,
       transaction_timestamp(), transaction_timestamp(), null,
       transaction_timestamp()
     ) on conflict (tenant_id, projection_id, scope_id, generation) do nothing`,
    parameters
  );
  await client.query(
    `insert into public.inbox_v2_projection_checkpoints (
       tenant_id, projection_id, scope_id, generation, stream_epoch,
       position, last_commit_id, revision, created_at, updated_at
     ) values (
       $1, $2, $3, 1, $4, 0, null, 1,
       transaction_timestamp(), transaction_timestamp()
     ) on conflict (tenant_id, projection_id, scope_id, generation) do nothing`,
    parameters.slice(0, 4)
  );
  await client.query(
    `insert into public.inbox_v2_projection_heads (
       tenant_id, projection_id, scope_id, current_generation, stream_epoch,
       projection_schema_version, revision, created_at, updated_at
     ) values (
       $1, $2, $3, 1, $4, $5, 1,
       transaction_timestamp(), transaction_timestamp()
     ) on conflict (tenant_id, projection_id, scope_id) do nothing`,
    parameters
  );
  const row = exactlyOneRow(
    await client.query(
      `select generation.generation::text, generation.stream_epoch,
              generation.projection_schema_version, generation.state,
              generation.min_retained_position::text,
              generation.revision::text as generation_revision,
              checkpoint.position::text, checkpoint.last_commit_id,
              checkpoint.revision::text as checkpoint_revision,
              head.current_generation::text,
              head.stream_epoch as head_stream_epoch,
              head.projection_schema_version as head_schema_version,
              head.revision::text as head_revision
         from public.inbox_v2_projection_generations generation
         join public.inbox_v2_projection_checkpoints checkpoint
           on checkpoint.tenant_id = generation.tenant_id
          and checkpoint.projection_id = generation.projection_id
          and checkpoint.scope_id = generation.scope_id
          and checkpoint.generation = generation.generation
         join public.inbox_v2_projection_heads head
           on head.tenant_id = generation.tenant_id
          and head.projection_id = generation.projection_id
          and head.scope_id = generation.scope_id
        where generation.tenant_id = $1
          and generation.projection_id = $2
          and generation.scope_id = $3
          and generation.generation = 1
        for share of generation, checkpoint, head`,
      parameters.slice(0, 3)
    ),
    "bootstrap projection"
  );
  assertExactRow(
    row,
    {
      generation: "1",
      stream_epoch: streamEpoch,
      projection_schema_version: projection.projectionSchemaVersion,
      state: "active",
      min_retained_position: "0",
      generation_revision: "1",
      position: "0",
      last_commit_id: null,
      checkpoint_revision: "1",
      current_generation: "1",
      head_stream_epoch: streamEpoch,
      head_schema_version: projection.projectionSchemaVersion,
      head_revision: "1"
    },
    "bootstrap projection"
  );
}

async function resolveBootstrap(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return readInboxV2RepositoryBootstrap(value);
  const bootstrap = parseInboxV2RepositoryBootstrap(value);
  return Object.freeze({
    bootstrap,
    digest: sha256(Buffer.from(JSON.stringify(bootstrap), "utf8"))
  });
}

async function fingerprintRelationContent(
  client,
  schemaName,
  relationName,
  relationKind
) {
  const qualifiedRelation = `${quoteIdentifier(schemaName)}.${quoteIdentifier(relationName)}`;
  const result =
    relationKind === "S"
      ? await client.query(`
          select jsonb_build_array(
                   last_value::text,
                   log_cnt::text,
                   is_called::text
                 )::text as row_json
            from ${qualifiedRelation}
        `)
      : await client.query(`
          select to_jsonb(inventory_row)::text as row_json
            from ${qualifiedRelation} as inventory_row
           order by to_jsonb(inventory_row)::text
        `);
  const hash = createHash("sha256");
  for (const row of result.rows) {
    const serialized = requiredText(
      row.row_json,
      `${schemaName}.${relationName} inventory row`
    );
    hash.update(`${Buffer.byteLength(serialized, "utf8")}:`, "utf8");
    hash.update(serialized, "utf8");
  }
  return `sha256:${hash.digest("hex")}`;
}

export async function collectInboxV2ManagedSchemaCatalog(client) {
  const queries = [
    `select 'schema' as object_kind, namespace.nspname as schema_name,
            namespace.nspname as object_name,
            pg_get_userbyid(namespace.nspowner) as owner_name,
            coalesce(namespace.nspacl::text, '') as definition
       from pg_catalog.pg_namespace namespace
      where namespace.nspname in ('public', 'drizzle')`,
    `select 'relation' as object_kind, namespace.nspname as schema_name,
            relation.relname as object_name,
            pg_get_userbyid(relation.relowner) as owner_name,
            jsonb_build_array(relation.relkind::text, relation.relpersistence::text,
              coalesce(relation.relacl::text, ''),
              relation.relrowsecurity::text,
              relation.relforcerowsecurity::text,
              relation.relreplident::text,
              coalesce(relation.reloptions::text, ''),
              case when relation.relkind in ('v', 'm')
                then pg_get_viewdef(relation.oid, true) else '' end)::text as definition
       from pg_catalog.pg_class relation
       join pg_catalog.pg_namespace namespace
         on namespace.oid = relation.relnamespace
      where namespace.nspname in ('public', 'drizzle')
        and relation.relkind in ('r', 'p', 'v', 'm', 'S', 'f')`,
    `select 'column' as object_kind, namespace.nspname as schema_name,
            relation.relname || '.' || attribute_row.attname as object_name,
            '' as owner_name,
            jsonb_build_array(attribute_row.attnum::text,
               pg_catalog.format_type(attribute_row.atttypid, attribute_row.atttypmod),
               attribute_row.attnotnull::text, attribute_row.attidentity::text,
               attribute_row.attgenerated::text,
               coalesce(attribute_row.attacl::text, ''),
               coalesce(pg_get_expr(default_row.adbin, default_row.adrelid), ''),
              coalesce(collation_row.collname, ''))::text as definition
       from pg_catalog.pg_attribute attribute_row
       join pg_catalog.pg_class relation on relation.oid = attribute_row.attrelid
       join pg_catalog.pg_namespace namespace
         on namespace.oid = relation.relnamespace
       left join pg_catalog.pg_attrdef default_row
         on default_row.adrelid = attribute_row.attrelid
        and default_row.adnum = attribute_row.attnum
       left join pg_catalog.pg_collation collation_row
         on collation_row.oid = attribute_row.attcollation
      where namespace.nspname in ('public', 'drizzle')
        and attribute_row.attnum > 0 and not attribute_row.attisdropped`,
    `select 'constraint' as object_kind, namespace.nspname as schema_name,
            relation.relname || '.' || constraint_row.conname as object_name,
            '' as owner_name,
            jsonb_build_array(constraint_row.contype::text,
              constraint_row.convalidated::text,
              constraint_row.condeferrable::text,
              constraint_row.condeferred::text,
              pg_get_constraintdef(constraint_row.oid, true))::text as definition
       from pg_catalog.pg_constraint constraint_row
       join pg_catalog.pg_class relation on relation.oid = constraint_row.conrelid
       join pg_catalog.pg_namespace namespace
         on namespace.oid = relation.relnamespace
      where namespace.nspname in ('public', 'drizzle')`,
    `select 'index' as object_kind, namespace.nspname as schema_name,
            index_relation.relname as object_name,
            pg_get_userbyid(index_relation.relowner) as owner_name,
            jsonb_build_array(index_row.indisvalid::text,
              index_row.indisready::text, index_row.indislive::text,
              index_row.indisunique::text, index_row.indisprimary::text,
              index_row.indisreplident::text,
              pg_get_indexdef(index_relation.oid))::text as definition
       from pg_catalog.pg_index index_row
       join pg_catalog.pg_class index_relation
         on index_relation.oid = index_row.indexrelid
      join pg_catalog.pg_namespace namespace
         on namespace.oid = index_relation.relnamespace
      where namespace.nspname in ('public', 'drizzle')`,
    `select 'sequence' as object_kind, namespace.nspname as schema_name,
            relation.relname as object_name,
            pg_get_userbyid(relation.relowner) as owner_name,
            jsonb_build_array(
              pg_catalog.format_type(sequence_row.seqtypid, null),
              sequence_row.seqstart::text, sequence_row.seqincrement::text,
              sequence_row.seqmax::text, sequence_row.seqmin::text,
              sequence_row.seqcache::text, sequence_row.seqcycle::text)::text
              as definition
       from pg_catalog.pg_sequence sequence_row
       join pg_catalog.pg_class relation on relation.oid = sequence_row.seqrelid
       join pg_catalog.pg_namespace namespace
         on namespace.oid = relation.relnamespace
      where namespace.nspname in ('public', 'drizzle')`,
    `select 'function' as object_kind, namespace.nspname as schema_name,
            routine.proname || '(' ||
              pg_get_function_identity_arguments(routine.oid) || ')' as object_name,
            pg_get_userbyid(routine.proowner) as owner_name,
            jsonb_build_array(language.lanname, routine.prosecdef::text,
              routine.proleakproof::text, routine.provolatile::text,
              routine.proparallel::text, coalesce(routine.proconfig::text, ''),
              coalesce(routine.proacl::text, ''),
              pg_get_function_result(routine.oid), routine.prosrc)::text as definition
       from pg_catalog.pg_proc routine
       join pg_catalog.pg_namespace namespace
         on namespace.oid = routine.pronamespace
       join pg_catalog.pg_language language on language.oid = routine.prolang
      where namespace.nspname in ('public', 'drizzle')`,
    `select 'trigger' as object_kind, namespace.nspname as schema_name,
            relation.relname || '.' || trigger_row.tgname as object_name,
            '' as owner_name,
            jsonb_build_array(trigger_row.tgenabled::text,
              trigger_row.tgisinternal::text,
              pg_get_triggerdef(trigger_row.oid, true))::text as definition
       from pg_catalog.pg_trigger trigger_row
      join pg_catalog.pg_class relation on relation.oid = trigger_row.tgrelid
      join pg_catalog.pg_namespace namespace
         on namespace.oid = relation.relnamespace
      where namespace.nspname in ('public', 'drizzle')
        and not trigger_row.tgisinternal`,
    `select 'type' as object_kind, namespace.nspname as schema_name,
            type_row.typname as object_name,
            pg_get_userbyid(type_row.typowner) as owner_name,
            jsonb_build_array(type_row.typtype::text,
              coalesce(pg_catalog.format_type(type_row.typbasetype,
                type_row.typtypmod), ''),
              coalesce((select string_agg(enum_row.enumlabel, ','
                                  order by enum_row.enumsortorder)
                          from pg_catalog.pg_enum enum_row
                         where enum_row.enumtypid = type_row.oid), ''))
              ::text as definition
       from pg_catalog.pg_type type_row
       join pg_catalog.pg_namespace namespace
         on namespace.oid = type_row.typnamespace
      where namespace.nspname in ('public', 'drizzle')
        and type_row.typtype in ('e', 'd')`,
    `select 'role' as object_kind, '' as schema_name,
            role_row.rolname as object_name,
            role_row.rolname as owner_name,
            jsonb_build_array(role_row.rolsuper::text,
              role_row.rolinherit::text, role_row.rolcreaterole::text,
              role_row.rolcreatedb::text, role_row.rolcanlogin::text,
              role_row.rolreplication::text, role_row.rolbypassrls::text,
              role_row.rolconnlimit::text,
              coalesce(role_row.rolconfig::text, ''))::text as definition
       from pg_catalog.pg_roles role_row
      where role_row.rolname like 'hulee_inbox_v2_%'`,
    `select 'role-membership' as object_kind, '' as schema_name,
            parent_role.rolname || '->' || member_role.rolname as object_name,
            grantor_role.rolname as owner_name,
            jsonb_build_array(membership.admin_option::text,
              membership.inherit_option::text,
              membership.set_option::text)::text as definition
       from pg_catalog.pg_auth_members membership
       join pg_catalog.pg_roles parent_role on parent_role.oid = membership.roleid
       join pg_catalog.pg_roles member_role on member_role.oid = membership.member
       join pg_catalog.pg_roles grantor_role on grantor_role.oid = membership.grantor
      where parent_role.rolname like 'hulee_inbox_v2_%'
         or member_role.rolname like 'hulee_inbox_v2_%'`,
    `select 'default-acl' as object_kind, coalesce(namespace.nspname, '') as schema_name,
            owner_role.rolname || ':' || default_acl.defaclobjtype::text
              as object_name,
            owner_role.rolname as owner_name,
            coalesce(default_acl.defaclacl::text, '') as definition
       from pg_catalog.pg_default_acl default_acl
       join pg_catalog.pg_roles owner_role on owner_role.oid = default_acl.defaclrole
       left join pg_catalog.pg_namespace namespace
          on namespace.oid = default_acl.defaclnamespace`,
    `select 'database' as object_kind, '' as schema_name,
            database_row.datname as object_name,
            pg_get_userbyid(database_row.datdba) as owner_name,
            jsonb_build_array(database_row.datconnlimit::text,
              coalesce(database_row.datacl::text, ''))::text as definition
       from pg_catalog.pg_database database_row
      where database_row.datname = current_database()`
  ];
  const catalogRows = [];
  for (const query of queries) {
    let result;
    try {
      result = await client.query(query);
    } catch (error) {
      const objectKind = /select '([^']+)' as object_kind/iu.exec(query)?.[1];
      throw lifecycleError(
        "inbox_v2.database_catalog_fingerprint_failed",
        `Cannot fingerprint ${objectKind ?? "unknown"} catalog objects: ${errorMessage(error)}`
      );
    }
    for (const row of result.rows) {
      catalogRows.push({
        objectKind: requiredText(row.object_kind, "catalog object kind"),
        schemaName: String(row.schema_name ?? ""),
        objectName: requiredText(row.object_name, "catalog object name"),
        ownerName: String(row.owner_name ?? ""),
        definition: String(row.definition ?? "")
      });
    }
  }
  catalogRows.sort((left, right) => {
    const leftValue = JSON.stringify(left);
    const rightValue = JSON.stringify(right);
    return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
  });
  return Object.freeze(catalogRows.map((row) => Object.freeze(row)));
}

async function fingerprintManagedSchemaCatalog(client) {
  return sha256(
    JSON.stringify(await collectInboxV2ManagedSchemaCatalog(client))
  );
}

async function countSemanticRows(client, observedAt, specifications) {
  let total = 0;
  for (const [relation, predicate] of specifications) {
    const exists = exactlyOneRow(
      await client.query("select to_regclass($1) as relation_name", [
        `public.${relation}`
      ]),
      `semantic inventory relation ${relation}`
    ).relation_name;
    if (exists === null) continue;
    const row = exactlyOneRow(
      await client.query(
        `select count(*)::int as row_count
           from public.${quoteIdentifier(relation)}
          where ${predicate}`,
        predicate.includes("$1") ? [observedAt] : []
      ),
      `semantic inventory ${relation}`
    );
    if (!Number.isSafeInteger(row.row_count) || row.row_count < 0) {
      throw lifecycleError(
        "inbox_v2.database_lifecycle_invariant",
        `Semantic inventory ${relation} returned an invalid count.`
      );
    }
    total += row.row_count;
  }
  return total;
}

function assertResetInventoryMatchesManifest(observed, manifest) {
  if (observed.largeObjectCount !== 0) {
    throw lifecycleError(
      "inbox_v2.reset_large_objects_unsupported",
      "Reset refuses a database containing PostgreSQL large objects because schema replacement cannot prove their deletion."
    );
  }
  const unsupportedDatabaseObjects = observed.unsupportedDatabaseObjects.filter(
    ({ objectCount }) => objectCount !== 0
  );
  if (unsupportedDatabaseObjects.length > 0) {
    throw lifecycleError(
      "inbox_v2.reset_database_objects_unsupported",
      `Reset refuses database-level objects outside the managed schemas: ${unsupportedDatabaseObjects.map(({ objectKind, objectCount }) => `${objectKind}=${objectCount}`).join(", ")}.`
    );
  }
  if (
    observed.activeProviderSessions !== 0 ||
    observed.pendingOrUncertainOutbox !== 0 ||
    observed.activeLeases !== 0
  ) {
    throw lifecycleError(
      "inbox_v2.reset_live_active_effects_present",
      "The fenced database contains a live provider session, pending/uncertain effect or active lease."
    );
  }
  for (const [observedValue, reviewedValue] of [
    [observed.digest, manifest.inventory.databaseInventorySha256],
    [observed.tenantCount, manifest.inventory.tenantCount],
    [observed.v1BusinessRowCount, manifest.inventory.v1BusinessRowCount],
    [
      observed.activeProviderSessions,
      manifest.inventory.activeProviderSessions
    ],
    [
      observed.pendingOrUncertainOutbox,
      manifest.inventory.pendingOrUncertainOutbox
    ],
    [observed.activeLeases, manifest.inventory.activeLeases],
    [observed.publishedV2Cursor, manifest.inventory.publishedV2Cursor]
  ]) {
    if (observedValue !== reviewedValue) {
      throw lifecycleError(
        "inbox_v2.reset_database_inventory_mismatch",
        "The fenced live database inventory does not match the reviewed disposition manifest."
      );
    }
  }
}

export function digestInboxV2DatabaseTarget(target) {
  return sha256(
    JSON.stringify({
      postgresSystemIdentifier: target.postgresSystemIdentifier,
      databaseName: target.databaseName,
      databaseOwner: target.databaseOwner
    })
  );
}

function resetReceiptContract(input) {
  return Object.freeze({
    tenantId: input.bootstrapDocument.bootstrap.tenant.id,
    resetGeneration: input.manifest.reset.generation,
    manifestId: input.manifest.manifestId,
    manifestSha256: input.manifestDigest,
    migrationContractSha256: input.migrationBundle.digest,
    bootstrapSha256: input.bootstrapDocument.digest,
    mig001EvidenceSha256: input.mig001Evidence.digest,
    objectReceiptSha256: input.objectReceipt.digest,
    targetFingerprintSha256: digestInboxV2DatabaseTarget(input.target)
  });
}

async function openDatabaseFenceConnection(databaseUrl, target) {
  let controlUrl;
  try {
    controlUrl = new URL(databaseUrl);
    controlUrl.pathname = "/postgres";
  } catch (error) {
    throw lifecycleError(
      "inbox_v2.reset_control_database_url_invalid",
      `The reset DATABASE_URL must be a PostgreSQL URL: ${errorMessage(error)}`
    );
  }
  const client = new Client({ connectionString: controlUrl.toString() });
  try {
    await client.connect();
    const row = exactlyOneRow(
      await client.query(`
        select (pg_catalog.pg_control_system()).system_identifier::text
                 as postgres_system_identifier,
               current_database() as database_name
      `),
      "database fence control target"
    );
    if (
      row.postgres_system_identifier !== target.postgresSystemIdentifier ||
      row.database_name !== "postgres"
    ) {
      throw lifecycleError(
        "inbox_v2.reset_control_database_mismatch",
        "The database fence connection is not the postgres database of the reviewed cluster."
      );
    }
    return client;
  } catch (error) {
    await client.end().catch(() => {});
    throw error;
  }
}

async function setDatabaseAllowsConnections(client, databaseName, allowed) {
  try {
    await client.query(
      `alter database ${quoteIdentifier(databaseName)} with allow_connections ${
        allowed ? "true" : "false"
      }`
    );
  } catch (error) {
    throw lifecycleError(
      allowed
        ? "inbox_v2.reset_connection_fence_release_failed"
        : "inbox_v2.reset_connection_fence_failed",
      `${allowed ? "Cannot release" : "Cannot acquire"} the database connection fence: ${errorMessage(error)}`
    );
  }
}

async function releaseDatabaseFence(input) {
  try {
    await setDatabaseAllowsConnections(
      input.fenceClient,
      input.target.databaseName,
      true
    );
    await assertDatabaseAllowsConnections(
      input.fenceClient,
      input.target.databaseName
    );
  } catch (primaryError) {
    try {
      await releaseDatabaseFenceWithFreshConnection(
        input.databaseUrl,
        input.target
      );
    } catch (recoveryError) {
      throw lifecycleError(
        "inbox_v2.reset_connection_fence_release_failed",
        `Automatic ALLOW_CONNECTIONS recovery failed on both control connections (${errorMessage(primaryError)}; recovery: ${errorMessage(recoveryError)}). Run the reviewed manual fence-recovery procedure immediately.`
      );
    }
  }
}

async function releaseDatabaseFenceWithFreshConnection(databaseUrl, target) {
  const recoveryClient = await openDatabaseFenceConnection(databaseUrl, target);
  try {
    await setDatabaseAllowsConnections(
      recoveryClient,
      target.databaseName,
      true
    );
    await assertDatabaseAllowsConnections(recoveryClient, target.databaseName);
  } finally {
    await recoveryClient.end().catch(() => {});
  }
}

async function assertDatabaseAllowsConnections(client, databaseName) {
  const row = exactlyOneRow(
    await client.query(
      `select datallowconn
         from pg_catalog.pg_database
        where datname = $1`,
      [databaseName]
    ),
    "database fence recovery verification"
  );
  if (row.datallowconn !== true) {
    throw lifecycleError(
      "inbox_v2.reset_connection_fence_release_failed",
      "The control connection could not prove ALLOW_CONNECTIONS=true."
    );
  }
}

async function readResetReceipt(client, resetGeneration) {
  const relation = exactlyOneRow(
    await client.query("select to_regclass($1) as relation_name", [
      `public.${RESET_RECEIPT_RELATION}`
    ]),
    "reset receipt relation"
  );
  if (relation.relation_name === null) return null;
  const result = await client.query(
    `select tenant_id, reset_generation, manifest_id, manifest_sha256,
            migration_contract_sha256, bootstrap_sha256,
            mig_001_evidence_sha256, object_receipt_sha256,
            target_fingerprint_sha256, previous_stream_epoch, stream_epoch,
            migration_journal_sha256, database_inventory_sha256,
            completed_at::text
       from public.inbox_v2_database_reset_receipts
      where reset_generation = $1`,
    [resetGeneration]
  );
  if (result.rows.length === 0) return null;
  if (result.rows.length !== 1) {
    throw lifecycleError(
      "inbox_v2.reset_idempotency_receipt_ambiguous",
      "A reset generation must have at most one completion receipt."
    );
  }
  return result.rows[0];
}

async function readAllResetReceipts(client) {
  const relation = exactlyOneRow(
    await client.query("select to_regclass($1) as relation_name", [
      `public.${RESET_RECEIPT_RELATION}`
    ]),
    "reset receipt relation"
  );
  if (relation.relation_name === null) return [];
  const result = await client.query(`
    select tenant_id, reset_generation, manifest_id, manifest_sha256,
           migration_contract_sha256, bootstrap_sha256,
           mig_001_evidence_sha256, object_receipt_sha256,
           target_fingerprint_sha256, previous_stream_epoch, stream_epoch,
           migration_journal_sha256, database_inventory_sha256,
           completed_at::text
      from public.inbox_v2_database_reset_receipts
     order by tenant_id, reset_generation
  `);
  return result.rows;
}

async function restoreResetReceipts(client, receipts) {
  for (const receipt of receipts) {
    await client.query(
      `insert into public.inbox_v2_database_reset_receipts (
         tenant_id, reset_generation, manifest_id, manifest_sha256,
         migration_contract_sha256, bootstrap_sha256,
         mig_001_evidence_sha256, object_receipt_sha256,
         target_fingerprint_sha256, previous_stream_epoch, stream_epoch,
         migration_journal_sha256, database_inventory_sha256, completed_at
       ) values (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
         $14::timestamptz
       )`,
      [
        receipt.tenant_id,
        receipt.reset_generation,
        receipt.manifest_id,
        receipt.manifest_sha256,
        receipt.migration_contract_sha256,
        receipt.bootstrap_sha256,
        receipt.mig_001_evidence_sha256,
        receipt.object_receipt_sha256,
        receipt.target_fingerprint_sha256,
        receipt.previous_stream_epoch,
        receipt.stream_epoch,
        receipt.migration_journal_sha256,
        receipt.database_inventory_sha256,
        receipt.completed_at
      ]
    );
  }
}

async function verifyCompletedResetReceipt(input) {
  const journal = await assertCurrentMigrationJournalAgainstBundle(
    input.client,
    input.migrationBundle
  );
  await assertCurrentInboxV2Schema(input.client, input.migrationBundle);
  const inventory = await inspectInboxV2DatabaseInventory(input.client);
  const streamEpoch = await readBootstrapTenantStreamEpoch(
    input.client,
    input.bootstrap.tenant.id
  );
  const expected = {
    tenant_id: input.receiptContract.tenantId,
    reset_generation: input.receiptContract.resetGeneration,
    manifest_id: input.receiptContract.manifestId,
    manifest_sha256: input.receiptContract.manifestSha256,
    migration_contract_sha256: input.receiptContract.migrationContractSha256,
    bootstrap_sha256: input.receiptContract.bootstrapSha256,
    mig_001_evidence_sha256: input.receiptContract.mig001EvidenceSha256,
    object_receipt_sha256: input.receiptContract.objectReceiptSha256,
    target_fingerprint_sha256: input.receiptContract.targetFingerprintSha256,
    stream_epoch: streamEpoch,
    migration_journal_sha256: journal.appliedDigest,
    database_inventory_sha256: inventory.digest
  };
  for (const [field, value] of Object.entries(expected)) {
    if (input.existingReceipt[field] !== value) {
      throw lifecycleError(
        "inbox_v2.reset_idempotency_receipt_state_mismatch",
        `Completed reset receipt field ${field} does not match the current request and database state.`
      );
    }
  }
  return Object.freeze({
    action: "reset_noop",
    manifestId: input.receiptContract.manifestId,
    resetGeneration: input.receiptContract.resetGeneration,
    manifestSha256: input.receiptContract.manifestSha256,
    target: input.target,
    migrationsFolder: input.migrationsFolder,
    migrationCount: journal.applied.length,
    migrationContractSha256: journal.expectedDigest,
    migrationJournalSha256: journal.appliedDigest,
    previousStreamEpoch: input.existingReceipt.previous_stream_epoch,
    bootstrap: Object.freeze({
      tenantId: input.bootstrap.tenant.id,
      streamEpoch,
      projectionCount: input.bootstrap.projections.length,
      projections: input.bootstrap.projections
    })
  });
}

async function insertResetReceipt(client, receipt) {
  await client.query(
    `insert into public.inbox_v2_database_reset_receipts (
       tenant_id, reset_generation, manifest_id, manifest_sha256,
       migration_contract_sha256, bootstrap_sha256,
       mig_001_evidence_sha256, object_receipt_sha256,
       target_fingerprint_sha256, previous_stream_epoch, stream_epoch,
       migration_journal_sha256, database_inventory_sha256, completed_at
     ) values (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
       transaction_timestamp()
     )`,
    [
      receipt.tenantId,
      receipt.resetGeneration,
      receipt.manifestId,
      receipt.manifestSha256,
      receipt.migrationContractSha256,
      receipt.bootstrapSha256,
      receipt.mig001EvidenceSha256,
      receipt.objectReceiptSha256,
      receipt.targetFingerprintSha256,
      receipt.previousStreamEpoch,
      receipt.streamEpoch,
      receipt.migrationJournalSha256,
      receipt.databaseInventorySha256
    ]
  );
}

function assertResetTargetMatchesManifest(target, manifest) {
  if (PROTECTED_DATABASES.has(target.databaseName)) {
    throw lifecycleError(
      "inbox_v2.reset_protected_database",
      "postgres and template databases can never be reset."
    );
  }
  if (target.currentUser !== target.databaseOwner) {
    throw lifecycleError(
      "inbox_v2.reset_database_owner_required",
      "The reset connection must use the exact database owner."
    );
  }
  for (const key of [
    "postgresSystemIdentifier",
    "databaseName",
    "databaseOwner"
  ]) {
    if (target[key] !== manifest.target[key]) {
      throw lifecycleError(
        "inbox_v2.reset_target_mismatch",
        `Live target ${key} does not match the disposition manifest.`
      );
    }
  }
}

export async function assertNoOtherDatabaseSessions(client, databaseName) {
  const row = exactlyOneRow(
    await client.query(
      `select
         (select count(*)::int
            from pg_catalog.pg_stat_activity
           where datname = $1
             and pid <> pg_backend_pid()
             and backend_type is distinct from 'autovacuum worker')
           as connection_count,
         (select count(*)::int
            from pg_catalog.pg_prepared_xacts
           where database = $1) as prepared_transaction_count`,
      [databaseName]
    ),
    "active database connections"
  );
  if (row.connection_count !== 0) {
    throw lifecycleError(
      "inbox_v2.reset_active_connections",
      `Reset refuses ${row.connection_count} other database backend(s).`
    );
  }
  if (row.prepared_transaction_count !== 0) {
    throw lifecycleError(
      "inbox_v2.reset_prepared_transactions",
      `Reset refuses ${row.prepared_transaction_count} prepared transaction(s).`
    );
  }
}

async function assertResetSchemaSet(client) {
  const result = await client.query(`
    select nspname
      from pg_catalog.pg_namespace
     order by nspname
  `);
  const unexpected = result.rows
    .map((row) => requiredText(row.nspname, "schema name"))
    .filter(
      (name) =>
        !ALLOWED_RESET_SCHEMAS.has(name) && !isPostgresSystemSchema(name)
    );
  if (unexpected.length > 0) {
    throw lifecycleError(
      "inbox_v2.reset_unmanaged_schema_present",
      `Reset refuses unmanaged schema(s): ${unexpected.join(", ")}.`
    );
  }
}

async function resetManagedDatabaseSchemasInTransaction(client) {
  await client.query("drop schema if exists public cascade");
  await client.query("drop schema if exists drizzle cascade");
  await client.query("create schema public authorization pg_database_owner");
  await client.query("grant usage on schema public to public");
  await client.query("set local search_path to public, pg_catalog");
}

async function applyMigrationBundleInTransaction(client, bundle) {
  await client.query("create schema drizzle");
  await client.query(`
    create table drizzle.__drizzle_migrations (
      id serial primary key,
      hash text not null,
      created_at bigint
    )
  `);
  for (const migration of bundle.migrations) {
    for (const statement of migration.sql) {
      await client.query(statement);
    }
    await client.query(
      `insert into drizzle.__drizzle_migrations (hash, created_at)
       values ($1, $2::bigint)`,
      [migration.hash, String(migration.folderMillis)]
    );
  }
}

async function readBootstrapTenantStreamEpoch(client, tenantId) {
  const relation = exactlyOneRow(
    await client.query("select to_regclass($1) as relation_name", [
      "public.inbox_v2_tenant_stream_heads"
    ]),
    "tenant stream relation existence"
  );
  if (relation.relation_name === null) return null;
  const result = await client.query(
    `select stream_epoch
       from public.inbox_v2_tenant_stream_heads
      where tenant_id = $1`,
    [tenantId]
  );
  if (result.rows.length === 0) return null;
  if (result.rows.length !== 1) {
    throw lifecycleError(
      "inbox_v2.reset_stream_epoch_ambiguous",
      "Expected at most one pre-reset tenant stream head."
    );
  }
  return requiredText(result.rows[0].stream_epoch, "pre-reset stream epoch");
}

async function assertFreshPublicSchema(client) {
  const row = exactlyOneRow(
    await client.query(`
      select
        (select count(*)::int
           from pg_catalog.pg_class relation
           join pg_catalog.pg_namespace namespace
             on namespace.oid = relation.relnamespace
          where namespace.nspname = 'public'
            and relation.relkind in ('r', 'p', 'v', 'm', 'S', 'f'))
        +
        (select count(*)::int
           from pg_catalog.pg_proc routine
           join pg_catalog.pg_namespace namespace
             on namespace.oid = routine.pronamespace
          where namespace.nspname = 'public')
        +
        (select count(*)::int
           from pg_catalog.pg_type type_row
           join pg_catalog.pg_namespace namespace
             on namespace.oid = type_row.typnamespace
          where namespace.nspname = 'public'
            and type_row.typtype in ('e', 'd')) as object_count
    `),
    "fresh public schema objects"
  );
  if (row.object_count !== 0) {
    throw lifecycleError(
      "inbox_v2.unmanaged_schema_without_journal",
      "The migration journal is absent but public schema already contains managed objects."
    );
  }
}

function foreignKeyContract(
  relation,
  name,
  columns,
  referenceRelation,
  referenceColumns,
  {
    onUpdate = "a",
    onDelete = "c",
    deferrable = false,
    initiallyDeferred = false
  } = {}
) {
  return Object.freeze({
    relation,
    name,
    type: "f",
    columns,
    referenceRelation,
    referenceColumns,
    onUpdate,
    onDelete,
    deferrable,
    initiallyDeferred
  });
}

function expectedFunctionContract(bundle, signature) {
  const routineName = signature.slice(0, signature.indexOf("("));
  const pattern = new RegExp(
    `\\bcreate\\s+(?:or\\s+replace\\s+)?function\\s+${escapeRegExp(routineName)}\\s*\\(`,
    "iu"
  );
  const statement = findLastMigrationStatement(
    bundle,
    (candidate) => pattern.test(candidate),
    `routine ${signature}`
  );
  const definitionStart = statement.search(pattern);
  const routineDefinition = statement.slice(definitionStart);
  const bodyMatch =
    /\bas\s+(\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$)([\s\S]*?)\1/iu.exec(
      routineDefinition
    );
  if (!bodyMatch) {
    throw lifecycleError(
      "inbox_v2.database_lifecycle_invariant",
      `Cannot extract the checked-in body for routine ${signature}.`
    );
  }
  const header = routineDefinition.slice(0, bodyMatch.index);
  const resultAndLanguage =
    /\breturns\s+([\s\S]*?)\s+language\s+([A-Za-z0-9_]+)/iu.exec(header);
  const resultType = resultAndLanguage?.[1];
  const language = resultAndLanguage?.[2];
  if (!resultType || !language) {
    throw lifecycleError(
      "inbox_v2.database_lifecycle_invariant",
      `Cannot extract the checked-in language or result for routine ${signature}.`
    );
  }
  const config = [
    ...header.matchAll(
      /^\s*set\s+([A-Za-z_][A-Za-z0-9_.]*)\s*(?:=|to)\s*([^\r\n]+)\s*$/gimu
    )
  ].map((match) => `${match[1]}=${match[2]}`);
  let body = normalizeFunctionBody(bodyMatch[2]);
  if (
    migrationBundleContains(bundle, MSG002_OUTBOUND_SEND_AUTHORITY_MARKER) &&
    !statement.includes(MSG003_TYPED_CONTENT_AUTHORIZATION_MARKER) &&
    !statement.includes(MSG004_REPLY_FORWARD_MARKER) &&
    !statement.includes(MSG005_MESSAGE_LIFECYCLE_MARKER)
  ) {
    body = applyInboxV2Msg002ExpectedFunctionOverlay(signature, body, bundle);
  }
  return Object.freeze({
    body,
    language: language.toLowerCase(),
    resultType: normalizeFunctionResult(resultType),
    securityDefiner: /\bsecurity\s+definer\b/iu.test(header),
    strict:
      /\bstrict\b/iu.test(header) ||
      /\breturns\s+null\s+on\s+null\s+input\b/iu.test(header),
    leakproof: /\bleakproof\b/iu.test(header),
    volatility: /\bimmutable\b/iu.test(header)
      ? "i"
      : /\bstable\b/iu.test(header)
        ? "s"
        : "v",
    parallel: /\bparallel\s+safe\b/iu.test(header)
      ? "s"
      : /\bparallel\s+restricted\b/iu.test(header)
        ? "r"
        : "u",
    config: normalizeFunctionConfig(config)
  });
}

function applyInboxV2Msg002ExpectedFunctionOverlay(signature, body, bundle) {
  const replacements = (() => {
    switch (signature) {
      case "public.inbox_v2_tm_core_coherence()":
        return [["core:message.send_external", "core:message.reply_external"]];
      case "public.inbox_v2_tm_outbound_route_action_valid(text,text,text,text,text,timestamptz,timestamptz,text,text,text,text,text,text,bigint,text,text,bigint,text,text,timestamptz,text,bigint,text,boolean)":
        return [
          [
            "       and binding_snapshot.runtime_health_state = 'ready'",
            String.raw`       and binding_snapshot.runtime_health_state::text =
         route_row.runtime_observation_snapshot #>> '{state}'
       and binding_snapshot.runtime_health_revision::text =
         route_row.runtime_observation_snapshot #>> '{revision}'
       and binding_snapshot.runtime_health_checked_at =
         (route_row.runtime_observation_snapshot #>>
           '{observedAt}')::timestamptz`
          ],
          [
            String.raw`       and route_row.runtime_observation_snapshot #>> '{state}' = 'ready'
       and (route_row.runtime_observation_snapshot #>>
         '{observedAt}')::timestamptz <= expected_authority_at`,
            String.raw`       and (route_row.runtime_observation_snapshot #>>
         '{observedAt}')::timestamptz <= expected_authority_at`
          ]
        ];
      case "public.inbox_v2_auth_domain_mutation_coherence()":
        return [
          [
            String.raw`  if v_command.command_type_id in ('core:message.send', 'core:message.receive')
  then`,
            String.raw`  if v_command.command_type_id in (
    'core:message.send',
    'core:message.receive',
    'core:source.dispatch.reroute'
  )
  then`
          ],
          [
            String.raw`         v_command.command_type_id = 'core:message.send'
         and (
           v_source_change_count <> 0
           or v_source_materialization_count <> 0
         )`,
            String.raw`         v_command.command_type_id in (
           'core:message.send',
           'core:source.dispatch.reroute'
         )
         and (
           v_source_change_count <> 0
           or v_source_materialization_count <> 0
         )`
          ],
          [
            inboxV2Msg002MigrationFragment(
              bundle,
              "domain_mutation_dispatch_predecessor_fragment"
            ),
            inboxV2Msg002MigrationFragment(
              bundle,
              "domain_mutation_dispatch_successor_fragment"
            )
          ],
          [
            inboxV2Msg002MigrationFragment(
              bundle,
              "domain_mutation_audit_predecessor_fragment"
            ),
            inboxV2Msg002MigrationFragment(
              bundle,
              "domain_mutation_audit_successor_fragment"
            )
          ]
        ];
      case "public.inbox_v2_atomic_message_creation_coherence()":
        return [
          [
            String.raw`         message_row.origin_kind = 'hulee_external'
         and command_row.command_type_id = 'core:message.send'
         and (`,
            String.raw`         message_row.origin_kind = 'hulee_external'
         and (
           (
             command_row.command_type_id = 'core:message.send'
             and exists (
               select 1
                 from public.inbox_v2_outbound_routes route_row
                where route_row.tenant_id = message_row.tenant_id
                  and route_row.id = message_row.origin_outbound_route_id
                  and route_row.selection_intent_kind <> 'explicit_reroute'
             )
           )
           or (
             command_row.command_type_id = 'core:source.dispatch.reroute'
             and exists (
               select 1
                 from public.inbox_v2_outbound_routes route_row
                where route_row.tenant_id = message_row.tenant_id
                  and route_row.id = message_row.origin_outbound_route_id
                  and route_row.selection_intent_kind = 'explicit_reroute'
             )
           )
         )
         and (`
          ]
        ];
      case "public.inbox_v2_atomic_outbound_creation_coherence()":
        return [
          [
            inboxV2Msg002MigrationFragment(
              bundle,
              "atomic_outbound_predecessor_fragment"
            ),
            inboxV2Msg002MigrationFragment(
              bundle,
              "atomic_outbound_successor_fragment"
            )
          ]
        ];
      default:
        return [];
    }
  })();

  return replacements.reduce((current, [predecessor, successor], index) => {
    const firstIndex = current.indexOf(predecessor);
    if (
      firstIndex < 0 ||
      current.indexOf(predecessor, firstIndex + predecessor.length) >= 0
    ) {
      throw lifecycleError(
        "inbox_v2.database_lifecycle_invariant",
        `MSG-002 expected-function overlay found an unreviewed ${signature} body at replacement ${index + 1}.`
      );
    }
    return `${current.slice(0, firstIndex)}${successor}${current.slice(
      firstIndex + predecessor.length
    )}`;
  }, body);
}

function inboxV2Msg002MigrationFragment(bundle, constantName) {
  const statement = findLastMigrationStatement(
    bundle,
    (candidate) => candidate.includes(MSG002_OUTBOUND_SEND_AUTHORITY_MARKER),
    "MSG-002 outbound-send authority overlay"
  );
  const pattern = new RegExp(
    `${escapeRegExp(constantName)}\\s+constant\\s+text\\s*:=\\s*\\$fragment\\$([\\s\\S]*?)\\$fragment\\$`,
    "u"
  );
  const match = pattern.exec(statement);
  if (!match?.[1]) {
    throw lifecycleError(
      "inbox_v2.database_lifecycle_invariant",
      `Cannot extract MSG-002 fragment ${constantName}.`
    );
  }
  return normalizeFunctionBody(match[1]);
}

function migrationBundleContains(bundle, fragment) {
  return bundle.migrations.some((migration) =>
    migration.sql.some((statement) => statement.includes(fragment))
  );
}

function expectedTriggerContract(bundle, triggerName) {
  const pattern = new RegExp(
    `\\bcreate\\s+(?:constraint\\s+)?trigger\\s+${escapeRegExp(triggerName)}\\b`,
    "iu"
  );
  const statement = findLastMigrationStatement(
    bundle,
    (candidate) => pattern.test(candidate),
    `trigger ${triggerName}`
  );
  const definitionStart = statement.search(pattern);
  const remainingStatement = statement.slice(definitionStart);
  const terminator = remainingStatement.indexOf(";");
  const triggerDefinition = remainingStatement.slice(0, terminator + 1);
  if (terminator < 0) {
    throw lifecycleError(
      "inbox_v2.database_lifecycle_invariant",
      `Cannot extract the checked-in SQL for trigger ${triggerName}.`
    );
  }
  const eventMatch =
    /\b(before|after|instead\s+of)\s+([\s\S]*?)\s+on\s+/iu.exec(
      triggerDefinition
    );
  if (!eventMatch) {
    throw lifecycleError(
      "inbox_v2.database_lifecycle_invariant",
      `Cannot extract the checked-in timing/events for trigger ${triggerName}.`
    );
  }
  const timing = eventMatch[1].replace(/\s+/gu, " ").toLowerCase();
  const events = eventMatch[2].toLowerCase();
  let typeMask = /\bfor\s+each\s+row\b/iu.test(triggerDefinition) ? 1 : 0;
  if (timing === "before") typeMask += 2;
  if (timing === "instead of") typeMask += 64;
  if (/\binsert\b/u.test(events)) typeMask += 4;
  if (/\bdelete\b/u.test(events)) typeMask += 8;
  if (/\bupdate\b/u.test(events)) typeMask += 16;
  if (/\btruncate\b/u.test(events)) typeMask += 32;
  return Object.freeze({
    typeMask,
    deferrable: /\bdeferrable\b/iu.test(triggerDefinition),
    initiallyDeferred: /\binitially\s+deferred\b/iu.test(triggerDefinition),
    constraintTrigger: /\bcreate\s+constraint\s+trigger\b/iu.test(
      triggerDefinition
    )
  });
}

function findLastMigrationStatement(bundle, predicate, label) {
  let found = null;
  for (const migration of bundle.migrations) {
    for (const statement of migration.sql) {
      if (predicate(statement)) found = statement;
    }
  }
  if (found === null) {
    throw lifecycleError(
      "inbox_v2.database_lifecycle_invariant",
      `The exact migration bundle has no definition for ${label}.`
    );
  }
  return found;
}

function normalizeFunctionBody(value) {
  return requiredText(value, "function body")
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/gu, ""))
    .join("\n")
    .trim();
}

function normalizeFunctionResult(value) {
  return requiredText(value, "function result")
    .toLowerCase()
    .replaceAll('"', "")
    .replace(/\s+/gu, "")
    .replaceAll("timestampwithtimezone", "timestamptz");
}

function normalizeFunctionConfig(value) {
  if (!Array.isArray(value)) {
    throw lifecycleError(
      "inbox_v2.database_lifecycle_invariant",
      "Function config must be a text array."
    );
  }
  return value
    .map((entry) =>
      requiredText(entry, "function config")
        .toLowerCase()
        .replaceAll("'", "")
        .replace(/\s+/gu, "")
    )
    .sort();
}

function normalizeSqlDefinition(value) {
  return requiredText(value, "SQL definition")
    .toLowerCase()
    .replaceAll('"', "")
    .replace(/\s+/gu, " ")
    .trim();
}

function normalizeExactCatalogDefinition(value) {
  return requiredText(value, "exact catalog definition")
    .replaceAll("\r\n", "\n")
    .trim();
}

function normalizeRelationName(value) {
  if (value === null) return null;
  return requiredText(value, "referenced relation")
    .replaceAll('"', "")
    .replace(/^public\./u, "");
}

function isPostgresSystemSchema(name) {
  return (
    name === "information_schema" ||
    name === "pg_catalog" ||
    name === "pg_toast" ||
    /^pg_(?:toast_)?temp_[0-9]+$/u.test(name)
  );
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function requiredDatabaseUrl(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw lifecycleError(
      "inbox_v2.database_url_required",
      "DATABASE_URL is required; an implicit database is never allowed."
    );
  }
  return value;
}

function migrationTimeoutMilliseconds(value, fallback, maximum, label) {
  const milliseconds = value ?? fallback;
  if (
    !Number.isSafeInteger(milliseconds) ||
    milliseconds <= 0 ||
    milliseconds > maximum
  ) {
    throw lifecycleError(
      "inbox_v2.migration_ddl_budget_invalid",
      `${label} must be a positive safe integer no greater than ${maximum}.`
    );
  }
  return milliseconds;
}

function exactlyOneRow(result, label) {
  if (!result || !Array.isArray(result.rows) || result.rows.length !== 1) {
    throw lifecycleError(
      "inbox_v2.database_lifecycle_invariant",
      `${label} must return exactly one row.`
    );
  }
  return result.rows[0];
}

function assertExactRow(actual, expected, label) {
  for (const [key, value] of Object.entries(expected)) {
    if (actual[key] !== value) {
      throw lifecycleError(
        "inbox_v2.bootstrap_existing_state_mismatch",
        `${label} field ${key} does not match the requested idempotent state.`
      );
    }
  }
}

function requiredText(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw lifecycleError(
      "inbox_v2.database_lifecycle_invariant",
      `${label} must be a non-empty string.`
    );
  }
  return value;
}

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

function lifecycleError(code, message, options) {
  return new InboxV2DatabaseLifecycleError(code, message, options);
}

function errorMessage(error) {
  if (
    error instanceof InboxV2DatabaseLifecycleError ||
    error instanceof InboxV2DatabaseLifecycleContractError
  ) {
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}
