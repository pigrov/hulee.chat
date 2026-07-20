import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { INBOX_V2_AUTH_DOMAIN_PROVIDER_IO_CLOSURE_SQL } from "./inbox-v2/authorization-relations";
import { INBOX_V2_SOURCE_MESSAGE_RECONCILIATION_INTEGRITY_SQL } from "./inbox-v2/source-message-reconciliation";
import { INBOX_V2_TIMELINE_MESSAGE_INVARIANTS_SQL } from "./inbox-v2/timeline-message";

const migrationPath = new URL(
  "../../drizzle/0055_inbox_v2_message_lifecycle_commands.sql",
  import.meta.url
);
const migration = readFileSync(migrationPath, "utf8").replaceAll("\r\n", "\n");
const generatedMigrationPrefix = migration.slice(
  0,
  migration.indexOf("-- INBOX_V2_MESSAGE_LIFECYCLE_MIGRATION_FINALIZED_V1")
);

describe("Inbox V2 message lifecycle command migration", () => {
  it("adds only nullable N-1 lifecycle anchors without a backfill", () => {
    for (const [tableName, columnName, dataType] of [
      [
        "inbox_v2_deferred_message_source_action_transitions",
        "applied_provider_lifecycle_operation_id",
        "text"
      ],
      [
        "inbox_v2_deferred_message_source_action_transitions",
        "applied_provider_lifecycle_operation_revision",
        "bigint"
      ],
      [
        "inbox_v2_deferred_message_source_actions",
        "applied_provider_lifecycle_operation_id",
        "text"
      ],
      [
        "inbox_v2_deferred_message_source_actions",
        "applied_provider_lifecycle_operation_revision",
        "bigint"
      ]
    ] as const) {
      expect(migration).toContain(
        `ALTER TABLE "${tableName}" ADD COLUMN "${columnName}" ${dataType};`
      );
    }
    expect(generatedMigrationPrefix).not.toMatch(
      /^\s*(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/imu
    );
    expect(generatedMigrationPrefix).not.toMatch(
      /\b(?:DEFAULT|SET NOT NULL)\b/iu
    );
    expect(generatedMigrationPrefix).not.toMatch(
      /\bDROP\s+(?:TABLE|COLUMN|TYPE)\b/iu
    );
  });

  it("installs populated-table foreign keys and replaced checks without validation scans", () => {
    for (const constraintName of [
      "inbox_v2_deferred_action_transitions_message_revision_fk",
      "inbox_v2_deferred_action_transitions_provider_operation_fk",
      "inbox_v2_deferred_actions_applied_message_revision_fk",
      "inbox_v2_deferred_actions_applied_provider_operation_fk",
      "inbox_v2_deferred_action_transitions_state_check",
      "inbox_v2_deferred_actions_state_check"
    ]) {
      expect(migration).toMatch(
        new RegExp(
          `ADD CONSTRAINT "${constraintName}"[\\s\\S]*? NOT VALID;`,
          "u"
        )
      );
    }
  });

  it("pins the exact deferred-anchor and provider-outbox closure functions", () => {
    expect(migration).toContain(
      "-- INBOX_V2_MESSAGE_LIFECYCLE_MIGRATION_FINALIZED_V1"
    );
    expect(migration).toContain(
      extractSqlFunctionDefinition(
        INBOX_V2_SOURCE_MESSAGE_RECONCILIATION_INTEGRITY_SQL,
        "public.inbox_v2_deferred_source_action_guard"
      )
    );
    expect(migration).toContain(
      extractSqlFunctionDefinition(
        INBOX_V2_SOURCE_MESSAGE_RECONCILIATION_INTEGRITY_SQL,
        "public.inbox_v2_deferred_source_action_assert"
      )
    );
    expect(migration).toContain(
      extractSqlFunctionDefinition(
        INBOX_V2_TIMELINE_MESSAGE_INVARIANTS_SQL,
        "public.inbox_v2_tm_outbound_route_action_valid"
      )
    );
    const messageHistory = extractSqlFunctionDefinition(
      INBOX_V2_TIMELINE_MESSAGE_INVARIANTS_SQL,
      "public.inbox_v2_tm_message_history_valid"
    );
    expect(migration).toContain(messageHistory);
    for (const migrationCreationFence of [
      "history_row.message_revision = 1",
      "history_row.change_kind = 'created'",
      "message_row.origin_kind = 'migration'",
      "attribution_row.action_participant_id =\n                    message_row.author_participant_id",
      "attribution_row.app_actor_kind = 'trusted_service'",
      "attribution_row.source_occurrence_id is null",
      "attribution_row.automation_kind is not null",
      "migration_author_row.subject_kind in (\n                         'legacy_unknown', 'system'"
    ]) {
      expect(messageHistory).toContain(migrationCreationFence);
    }
    const lifecycleCoherence = extractSqlFunctionDefinition(
      INBOX_V2_TIMELINE_MESSAGE_INVARIANTS_SQL,
      "public.inbox_v2_tm_aux_coherence"
    );
    expect(migration).toContain(lifecycleCoherence);
    expect(migration).toContain(
      extractSqlFunctionDefinition(
        INBOX_V2_AUTH_DOMAIN_PROVIDER_IO_CLOSURE_SQL,
        "public.inbox_v2_auth_domain_mutation_coherence"
      )
    );
    expect(migration).toContain(
      "inbox_v2.deferred_source_action_lifecycle_effect_mismatch"
    );
    expect(migration).toContain(
      "inbox_v2.deferred_source_action_retain_local_effect_mismatch"
    );
    expect(migration).toContain(
      "capability_row.valid_until > expected_authority_at"
    );
    expect(lifecycleCoherence).toContain(
      "lifecycle_route_row.required_conversation_permission_id =\n              'core:conversation.read'"
    );
    for (const actionPermissionId of [
      "core:message.edit_own",
      "core:message.delete_own",
      "core:message.moderate_external"
    ]) {
      expect(lifecycleCoherence).not.toContain(`'${actionPermissionId}'`);
    }
    expect(migration).not.toContain(
      "'core:message.' || op_row.action::text || '_external'"
    );
    expect(migration).not.toContain(
      "capability_row.valid_until >= expected_authority_at"
    );
    for (const mutableColumn of [
      "applied_provider_lifecycle_operation_id",
      "applied_provider_lifecycle_operation_revision"
    ]) {
      const guard = extractSqlFunctionDefinition(
        migration,
        "public.inbox_v2_deferred_source_action_guard"
      );
      expect(guard.split(`'${mutableColumn}'`)).toHaveLength(4);
    }
    expect(migration).toContain("'core:provider.message_lifecycle'");
    expect(migration).toContain(
      "'core:inbox-v2.message-provider-lifecycle-operation'"
    );
  });
});

function extractSqlFunctionDefinition(sql: string, functionName: string) {
  const normalized = sql.replaceAll("\r\n", "\n");
  const start = normalized.indexOf(
    `create or replace function ${functionName}`
  );
  const delimiter = "$function$";
  const bodyStart = normalized.indexOf(`as ${delimiter}`, start);
  const bodyEnd = normalized.indexOf(
    `${delimiter};`,
    bodyStart + `as ${delimiter}`.length
  );
  if (start < 0 || bodyStart < 0 || bodyEnd < 0) {
    throw new Error(`Missing SQL function ${functionName}.`);
  }
  return normalized.slice(start, bodyEnd + `${delimiter};`.length).trim();
}
