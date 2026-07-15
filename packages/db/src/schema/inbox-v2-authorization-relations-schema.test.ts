import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  INBOX_V2_AUTHORIZATION_RELATIONS_INTEGRITY_SQL,
  inboxV2AudienceImpactKind,
  inboxV2AuthorizationAuditEvents,
  inboxV2AuthorizationAuditFacets,
  inboxV2AuthorizationCollaboratorHeads,
  inboxV2AuthorizationCollaboratorVersions,
  inboxV2AuthorizationCommandRecords,
  inboxV2AuthorizationDirectGrantHeads,
  inboxV2AuthorizationDirectGrantVersions,
  inboxV2AuthorizationEmployeeHeads,
  inboxV2AuthorizationMutationCommits,
  inboxV2AuthorizationRelationWrites,
  inboxV2AuthorizationResourceHeads,
  inboxV2AuthorizationRevisionEffectKind,
  inboxV2AuthorizationRevisionEffects,
  inboxV2AuthorizationRoleBindingHeads,
  inboxV2AuthorizationRoleBindingVersions,
  inboxV2AuthorizationRoleHeads,
  inboxV2AuthorizationRoleVersionPermissions,
  inboxV2AuthorizationRoleVersions,
  inboxV2AuthorizationStructuralAccessHeads,
  inboxV2AuthorizationStructuralAccessVersions,
  inboxV2AuthorizationTenantHeads,
  inboxV2AuthorizationWorkforceMembershipHeads,
  inboxV2AuthorizationWorkforceMembershipVersions,
  inboxV2DomainEvents,
  inboxV2OutboxIntents,
  inboxV2TenantStreamChanges,
  inboxV2TenantStreamCommits,
  inboxV2TenantStreamHeads
} from "./inbox-v2/authorization-relations";
import { inboxV2ParticipantMembershipTransitions } from "./inbox-v2/participant-membership";
import {
  inboxV2WorkItemRelationTransitions,
  inboxV2WorkItemTransitions
} from "./inbox-v2/work-item";
import {
  clients,
  employees,
  inboxV2Conversations,
  orgUnits,
  sourceAccounts,
  teams,
  workQueues
} from "./tables";

const authorizationTables = [
  inboxV2AuthorizationTenantHeads,
  inboxV2AuthorizationEmployeeHeads,
  inboxV2AuthorizationRoleVersions,
  inboxV2AuthorizationRoleVersionPermissions,
  inboxV2AuthorizationRoleHeads,
  inboxV2AuthorizationRoleBindingVersions,
  inboxV2AuthorizationRoleBindingHeads,
  inboxV2AuthorizationDirectGrantVersions,
  inboxV2AuthorizationDirectGrantHeads,
  inboxV2AuthorizationWorkforceMembershipVersions,
  inboxV2AuthorizationWorkforceMembershipHeads,
  inboxV2AuthorizationResourceHeads,
  inboxV2AuthorizationStructuralAccessVersions,
  inboxV2AuthorizationStructuralAccessHeads,
  inboxV2AuthorizationCollaboratorVersions,
  inboxV2AuthorizationCollaboratorHeads,
  inboxV2AuthorizationCommandRecords,
  inboxV2TenantStreamHeads,
  inboxV2TenantStreamCommits,
  inboxV2TenantStreamChanges,
  inboxV2DomainEvents,
  inboxV2OutboxIntents,
  inboxV2AuthorizationAuditEvents,
  inboxV2AuthorizationAuditFacets,
  inboxV2AuthorizationMutationCommits,
  inboxV2AuthorizationRevisionEffects,
  inboxV2AuthorizationRelationWrites
] as const;

describe("Inbox V2 authorization relation schema", () => {
  it("exposes an exact tenant/epoch/position commit identity for checkpoints", () => {
    const checkpointIdentity = getTableConfig(
      inboxV2TenantStreamCommits
    ).uniqueConstraints.find(
      (candidate) =>
        candidate.name === "inbox_v2_tenant_stream_commits_checkpoint_unique"
    );
    expect(checkpointIdentity?.columns.map((column) => column.name)).toEqual([
      "tenant_id",
      "id",
      "stream_epoch",
      "position"
    ]);
  });

  it("declares the bounded tenant-owned relation and total-order stream slice", () => {
    expect(authorizationTables).toHaveLength(27);
    expect(
      authorizationTables.map((table) => getTableConfig(table).name)
    ).toEqual([
      "inbox_v2_auth_tenant_heads",
      "inbox_v2_auth_employee_heads",
      "inbox_v2_auth_role_versions",
      "inbox_v2_auth_role_version_permissions",
      "inbox_v2_auth_role_heads",
      "inbox_v2_auth_role_binding_versions",
      "inbox_v2_auth_role_binding_heads",
      "inbox_v2_auth_direct_grant_versions",
      "inbox_v2_auth_direct_grant_heads",
      "inbox_v2_auth_workforce_membership_versions",
      "inbox_v2_auth_workforce_membership_heads",
      "inbox_v2_auth_resource_heads",
      "inbox_v2_auth_structural_access_versions",
      "inbox_v2_auth_structural_access_heads",
      "inbox_v2_auth_collaborator_versions",
      "inbox_v2_auth_collaborator_heads",
      "inbox_v2_auth_command_records",
      "inbox_v2_tenant_stream_heads",
      "inbox_v2_tenant_stream_commits",
      "inbox_v2_tenant_stream_changes",
      "inbox_v2_domain_events",
      "inbox_v2_outbox_intents",
      "inbox_v2_auth_audit_events",
      "inbox_v2_auth_audit_facets",
      "inbox_v2_auth_mutation_commits",
      "inbox_v2_auth_revision_effects",
      "inbox_v2_auth_relation_writes"
    ]);

    for (const table of authorizationTables) {
      expect(
        getTableConfig(table).columns.find(
          (column) => column.name === "tenant_id"
        )?.notNull
      ).toBe(true);
    }
  });

  it("keeps typed relation endpoints inside the same tenant", () => {
    expectForeignKey(
      inboxV2AuthorizationWorkforceMembershipVersions,
      "inbox_v2_auth_workforce_versions_employee_fk",
      employees,
      ["tenant_id", "employee_id"],
      ["tenant_id", "id"]
    );
    expectForeignKey(
      inboxV2AuthorizationWorkforceMembershipVersions,
      "inbox_v2_auth_workforce_versions_org_fk",
      orgUnits,
      ["tenant_id", "org_unit_id"],
      ["tenant_id", "id"]
    );
    expectForeignKey(
      inboxV2AuthorizationWorkforceMembershipVersions,
      "inbox_v2_auth_workforce_versions_team_fk",
      teams,
      ["tenant_id", "team_id"],
      ["tenant_id", "id"]
    );
    expectForeignKey(
      inboxV2AuthorizationWorkforceMembershipVersions,
      "inbox_v2_auth_workforce_versions_queue_fk",
      workQueues,
      ["tenant_id", "work_queue_id"],
      ["tenant_id", "id"]
    );
    expectForeignKey(
      inboxV2AuthorizationResourceHeads,
      "inbox_v2_auth_resource_heads_conversation_fk",
      inboxV2Conversations,
      ["tenant_id", "conversation_id"],
      ["tenant_id", "id"]
    );
    expectForeignKey(
      inboxV2AuthorizationResourceHeads,
      "inbox_v2_auth_resource_heads_client_fk",
      clients,
      ["tenant_id", "client_id"],
      ["tenant_id", "id"]
    );
    expectForeignKey(
      inboxV2AuthorizationResourceHeads,
      "inbox_v2_auth_resource_heads_source_fk",
      sourceAccounts,
      ["tenant_id", "source_account_id"],
      ["tenant_id", "id"]
    );
  });

  it("encodes one-hot workforce, resource, structural and collaborator edges", () => {
    expect(
      checkSql(
        inboxV2AuthorizationWorkforceMembershipVersions,
        "inbox_v2_auth_workforce_versions_target_check"
      )
    ).toContain("when 'queue'");
    expect(
      checkSql(
        inboxV2AuthorizationResourceHeads,
        "inbox_v2_auth_resource_heads_resource_check"
      )
    ).toContain("when 'source_account'");
    expect(
      checkSql(
        inboxV2AuthorizationStructuralAccessVersions,
        "inbox_v2_auth_structural_versions_source_target_check"
      )
    ).toContain("'org_unit'");
    expect(
      checkSql(
        inboxV2AuthorizationCollaboratorVersions,
        "inbox_v2_auth_collaborator_versions_resource_check"
      )
    ).toContain("work_item_cycle");

    const allColumns = authorizationTables.flatMap((table) =>
      getTableConfig(table).columns.map((column) => column.name)
    );
    expect(allColumns).not.toContain("provider_identity_id");
    expect(allColumns).not.toContain("provider_roster_member_id");
  });

  it("keeps terminal relation episodes while fencing only active logical edges", () => {
    const activeEpisodeIndexes = [
      ...indexesNamed(
        inboxV2AuthorizationWorkforceMembershipHeads,
        "inbox_v2_auth_workforce_heads_",
        "_unique"
      ),
      ...indexesNamed(
        inboxV2AuthorizationStructuralAccessHeads,
        "inbox_v2_auth_structural_heads_",
        "_unique"
      ),
      ...indexesNamed(
        inboxV2AuthorizationCollaboratorHeads,
        "inbox_v2_auth_collaborator_heads_",
        "_unique"
      )
    ];

    expect(activeEpisodeIndexes).toHaveLength(10);
    for (const table of [
      inboxV2AuthorizationWorkforceMembershipHeads,
      inboxV2AuthorizationStructuralAccessHeads,
      inboxV2AuthorizationCollaboratorHeads
    ]) {
      const currentState = getTableConfig(table).columns.find(
        (column) => column.name === "current_state"
      );
      expect(currentState?.notNull).toBe(true);
    }
    for (const tableIndex of activeEpisodeIndexes) {
      expect(tableIndex.config.unique).toBe(true);
      expect(indexPredicateSql(tableIndex)).toContain(
        `"current_state" = 'active'`
      );
    }
  });

  it("binds collaborator-set effects to one exact resource aggregate", () => {
    expect(inboxV2AuthorizationRevisionEffectKind.enumValues).toContain(
      "collaborator_set"
    );
    const effectColumns = columnNames(inboxV2AuthorizationRevisionEffects);
    expect(effectColumns).toEqual(
      expect.arrayContaining([
        "work_item_cycle",
        "expected_work_item_revision",
        "resulting_work_item_revision"
      ])
    );
    const effectShape = checkSql(
      inboxV2AuthorizationRevisionEffects,
      "inbox_v2_auth_revision_effects_shape_check"
    );
    expect(effectShape).toContain("when 'collaborator_set'");
    expect(effectShape).toContain('"work_item_cycle" >= 0');
    expect(effectShape).toMatch(
      /"resulting_work_item_revision"\s*=\s*"inbox_v2_auth_revision_effects"\."expected_work_item_revision" \+ 1/u
    );
  });

  it("uses tenant-wide RBAC impact without Employee fan-out", () => {
    expect(inboxV2AudienceImpactKind.enumValues).toContain("tenant_rbac");
    const rolePermissionCheck = checkSql(
      inboxV2AuthorizationRoleVersions,
      "inbox_v2_auth_role_versions_values_check"
    );
    expect(rolePermissionCheck).toContain("between 1 and 256");
    expect(
      checkSql(
        inboxV2AuthorizationRoleVersionPermissions,
        "inbox_v2_auth_role_permissions_values_check"
      )
    ).toContain("between 1 and 256");
  });

  it("indexes current active role bindings by role for bounded legality checks", () => {
    const roleLookupIndex = getTableConfig(
      inboxV2AuthorizationRoleBindingVersions
    ).indexes.find(
      (candidate) =>
        candidate.config.name ===
        "inbox_v2_auth_role_binding_tenant_role_active_idx"
    );
    expect(roleLookupIndex?.config.columns.map(indexColumnName)).toEqual([
      "tenant_id",
      "role_id",
      "binding_id",
      "revision"
    ]);
    expect(roleLookupIndex && indexPredicateSql(roleLookupIndex)).toContain(
      `"state" = 'active'`
    );
  });

  it("indexes actor-first active structural and collaborator visibility edges", () => {
    expectPartialLookupIndex(
      inboxV2AuthorizationStructuralAccessHeads,
      "inbox_v2_auth_structural_heads_conversation_org_actor_idx",
      ["tenant_id", "target_org_unit_id", "conversation_id"],
      [
        `"resource_kind" = 'conversation'`,
        `"target_kind" = 'org_unit'`,
        `"current_state" = 'active'`
      ]
    );
    expectPartialLookupIndex(
      inboxV2AuthorizationStructuralAccessHeads,
      "inbox_v2_auth_structural_heads_conversation_team_actor_idx",
      ["tenant_id", "target_team_id", "conversation_id"],
      [
        `"resource_kind" = 'conversation'`,
        `"target_kind" = 'team'`,
        `"current_state" = 'active'`
      ]
    );
    expectPartialLookupIndex(
      inboxV2AuthorizationCollaboratorHeads,
      "inbox_v2_auth_collaborator_employee_conversation_idx",
      ["tenant_id", "employee_id", "conversation_id"],
      [`"resource_kind" = 'conversation'`, `"current_state" = 'active'`]
    );
    expectPartialLookupIndex(
      inboxV2AuthorizationCollaboratorHeads,
      "inbox_v2_auth_collaborator_employee_work_item_idx",
      ["tenant_id", "employee_id", "work_item_id", "work_item_cycle"],
      [`"resource_kind" = 'work_item'`, `"current_state" = 'active'`]
    );
  });

  it("scopes idempotency by principal, command type and client mutation", () => {
    const idempotencyIndex = getTableConfig(
      inboxV2AuthorizationCommandRecords
    ).indexes.find(
      (candidate) =>
        candidate.config.name ===
        "inbox_v2_auth_command_records_idempotency_unique"
    );
    expect(idempotencyIndex?.config.unique).toBe(true);
    expect(idempotencyIndex?.config.columns.map(indexColumnName)).toEqual([
      "tenant_id",
      "principal_scope_key",
      "command_type_id",
      "client_mutation_id"
    ]);
    expect(columnNames(inboxV2AuthorizationCommandRecords)).toEqual(
      expect.arrayContaining([
        "first_request_id",
        "authorization_decision_refs",
        "authorized_at",
        "authorization_not_after"
      ])
    );
  });

  it("keeps every explicit operational index tenant-leading", () => {
    for (const table of authorizationTables) {
      const indexes = getTableConfig(table).indexes;
      expect(indexes.length).toBeGreaterThan(0);
      for (const tableIndex of indexes) {
        expect(indexColumnName(tableIndex.config.columns[0])).toBe("tenant_id");
      }
    }
  });

  it("persists exact immutable hashes and permission catalog authority", () => {
    expect(columnNames(inboxV2AuthorizationRoleVersions)).toEqual(
      expect.arrayContaining([
        "permission_set_digest_sha256",
        "catalog_digest_sha256",
        "snapshot_hash"
      ])
    );
    expect(columnNames(inboxV2AuthorizationDirectGrantVersions)).toEqual(
      expect.arrayContaining(["catalog_digest_sha256", "record_hash"])
    );
    for (const table of [
      inboxV2AuthorizationRoleBindingVersions,
      inboxV2AuthorizationDirectGrantVersions,
      inboxV2AuthorizationWorkforceMembershipVersions,
      inboxV2AuthorizationStructuralAccessVersions,
      inboxV2AuthorizationCollaboratorVersions
    ]) {
      expect(columnNames(table)).toContain("record_hash");
    }
    expect(columnNames(inboxV2AuthorizationStructuralAccessVersions)).toEqual(
      expect.arrayContaining(["policy_id", "policy_revision"])
    );
  });

  it("keeps temporal boundaries strict and command results opaque", () => {
    for (const [table, stateConstraint, timeConstraint] of [
      [
        inboxV2AuthorizationRoleBindingVersions,
        "inbox_v2_auth_role_binding_state_check",
        "inbox_v2_auth_role_binding_times_check"
      ],
      [
        inboxV2AuthorizationDirectGrantVersions,
        "inbox_v2_auth_direct_grant_state_check",
        "inbox_v2_auth_direct_grant_times_check"
      ],
      [
        inboxV2AuthorizationWorkforceMembershipVersions,
        "inbox_v2_auth_workforce_versions_state_check",
        "inbox_v2_auth_workforce_versions_values_check"
      ],
      [
        inboxV2AuthorizationStructuralAccessVersions,
        "inbox_v2_auth_structural_versions_state_check",
        "inbox_v2_auth_structural_versions_values_check"
      ],
      [
        inboxV2AuthorizationCollaboratorVersions,
        "inbox_v2_auth_collaborator_versions_state_check",
        "inbox_v2_auth_collaborator_versions_values_check"
      ]
    ] as const) {
      const stateSql = checkSql(table, stateConstraint);
      expect(stateSql).toMatch(/"revoked_at" > [^\n]*"valid_from"/u);
      expect(stateSql).toMatch(
        /'active'[\s\S]*"occurred_at" <= [\s\S]*"valid_from"/u
      );
      expect(stateSql).toMatch(
        /'revoked'[\s\S]*"occurred_at" = [\s\S]*"revoked_at"/u
      );
      expect(stateSql).toMatch(
        /'archived'[\s\S]*"occurred_at" >= [\s\S]*"valid_until"/u
      );
      expect(checkSql(table, timeConstraint)).toContain("created_at");
    }
    expect(
      checkSql(
        inboxV2AuthorizationCommandRecords,
        "inbox_v2_auth_command_records_values_check"
      )
    ).toContain("^internal-ref:[a-f0-9]{32,64}$");
  });

  it("keeps immutable permission, policy and reason identifiers catalog-safe", () => {
    for (const [table, constraintName] of [
      [
        inboxV2AuthorizationRoleVersions,
        "inbox_v2_auth_role_versions_values_check"
      ],
      [
        inboxV2AuthorizationRoleVersionPermissions,
        "inbox_v2_auth_role_permissions_values_check"
      ],
      [
        inboxV2AuthorizationRoleBindingVersions,
        "inbox_v2_auth_role_binding_values_check"
      ],
      [
        inboxV2AuthorizationDirectGrantVersions,
        "inbox_v2_auth_direct_grant_values_check"
      ],
      [
        inboxV2AuthorizationWorkforceMembershipVersions,
        "inbox_v2_auth_workforce_versions_values_check"
      ],
      [
        inboxV2AuthorizationStructuralAccessVersions,
        "inbox_v2_auth_structural_versions_policy_check"
      ],
      [
        inboxV2AuthorizationStructuralAccessVersions,
        "inbox_v2_auth_structural_versions_values_check"
      ],
      [
        inboxV2AuthorizationCollaboratorVersions,
        "inbox_v2_auth_collaborator_versions_values_check"
      ]
    ] as const) {
      const identifierSql = checkSql(table, constraintName);
      expect(identifierSql).toContain("^core:[a-z]");
      expect(identifierSql).toContain("^module:[a-z]");
    }
  });

  it("round-trips the reference-only tenant-stream contract", () => {
    expect(columnNames(inboxV2TenantStreamCommits)).toEqual(
      expect.arrayContaining([
        "schema_version",
        "correlation_id",
        "command_ids",
        "client_mutation_ids",
        "authorization_decision_refs",
        "change_ids",
        "event_ids",
        "outbox_intent_ids",
        "audience_impact_manifest",
        "commit_hash"
      ])
    );
    expect(columnNames(inboxV2TenantStreamChanges)).toContain("timeline");
    expect(columnNames(inboxV2DomainEvents)).toEqual(
      expect.arrayContaining([
        "change_ids",
        "correlation_id",
        "command_ids",
        "client_mutation_ids",
        "authorization_decision_refs",
        "access_effect_causes"
      ])
    );
    expect(columnNames(inboxV2OutboxIntents)).toEqual(
      expect.arrayContaining(["consumer_dedupe_key", "correlation_id"])
    );
    const genericColumns = [
      inboxV2TenantStreamCommits,
      inboxV2TenantStreamChanges,
      inboxV2DomainEvents,
      inboxV2OutboxIntents
    ].flatMap(columnNames);
    expect(genericColumns).not.toContain("payload");
    expect(genericColumns).not.toContain("message_text");
  });

  it("closes audit facets and reuses DB-002/DB-004 transition authority", () => {
    expect(columnNames(inboxV2AuthorizationAuditEvents)).toEqual(
      expect.arrayContaining([
        "facet_count",
        "facets_digest_sha256",
        "revision_delta_hash",
        "reason_code_id",
        "client_mutation_id",
        "request_hash"
      ])
    );
    expectForeignKey(
      inboxV2AuthorizationRelationWrites,
      "inbox_v2_auth_relation_writes_membership_transition_fk",
      inboxV2ParticipantMembershipTransitions,
      ["tenant_id", "internal_membership_transition_id"],
      ["tenant_id", "id"]
    );
    expectForeignKey(
      inboxV2AuthorizationRelationWrites,
      "inbox_v2_auth_relation_writes_primary_transition_fk",
      inboxV2WorkItemTransitions,
      ["tenant_id", "primary_responsibility_transition_id"],
      ["tenant_id", "id"]
    );
    expectForeignKey(
      inboxV2AuthorizationRelationWrites,
      "inbox_v2_auth_relation_writes_team_transition_fk",
      inboxV2WorkItemRelationTransitions,
      ["tenant_id", "servicing_team_transition_id"],
      ["tenant_id", "id"]
    );
    expect(columnNames(inboxV2AuthorizationRelationWrites)).toContain(
      "previous_revision"
    );
    const auditReferenceSql = checkSql(
      inboxV2AuthorizationAuditEvents,
      "inbox_v2_auth_audit_events_reference_check"
    );
    expect(auditReferenceSql).toContain("^core:[a-z]");
    expect(auditReferenceSql).toContain("^v[1-9][0-9]*$");
    expect(auditReferenceSql).toContain("between 2 and 128");
    expect(auditReferenceSql).toContain("override_reason_id");
    const facetSql = checkSql(
      inboxV2AuthorizationAuditFacets,
      "inbox_v2_auth_audit_facets_values_check"
    );
    expect(facetSql).toContain("core:tenant");
    expect(facetSql).toContain("core:org-unit");
    expect(facetSql).toContain("core:team");
    expect(facetSql).toContain("core:work-queue");
    expect(facetSql).toContain("core:conversation");
    expect(facetSql).toContain("core:source-account");
  });

  it("installs immutable, +1 CAS and deferred atomic-closure guards", () => {
    const invariantSql = INBOX_V2_AUTHORIZATION_RELATIONS_INTEGRITY_SQL;
    const functionCount =
      invariantSql.match(/create or replace function public\./g)?.length ?? 0;
    const searchPathCount =
      invariantSql.match(/set search_path = pg_catalog, public, pg_temp/g)
        ?.length ?? 0;
    expect(functionCount).toBe(17);
    expect(searchPathCount).toBe(functionCount);
    expect(invariantSql.match(/chr\(10\)/g)).toHaveLength(8);
    expect(invariantSql).not.toMatch(/E'\\+n'/);
    expect(invariantSql).toContain("inbox_v2_auth_reject_immutable");
    expect(invariantSql).toContain("authorization_version_cas_conflict");
    expect(invariantSql).toContain("authorization_version_time_regression");
    expect(invariantSql).toContain("authorization_relation_identity_morph");
    expect(invariantSql).toContain(
      "authorization_relation_state_transition_invalid"
    );
    expect(invariantSql).toContain(
      "v_incoming->>'valid_until' is distinct from"
    );
    expect(invariantSql).toContain("authorization_relation_interval_morph");
    expect(invariantSql).toContain(
      "new.current_revision <> old.current_revision + 1"
    );
    expect(
      invariantSql.match(/version_row\.state = new\.current_state/g)
    ).toHaveLength(3);
    expect(invariantSql).toContain("new.structural_relation_revision =");
    expect(invariantSql).toContain("new.collaborator_set_revision =");
    expect(invariantSql).toContain("new.resource_kind = 'conversation'");
    expect(invariantSql).toContain("old.state <> 'pending'");
    expect(invariantSql).toContain("new.first_request_id");
    expect(invariantSql).toContain("new.authorization_decision_refs");
    const commandGuardSql = invariantSql.slice(
      invariantSql.indexOf(
        "create or replace function public.inbox_v2_auth_command_guard()"
      ),
      invariantSql.indexOf(
        "create or replace function public.inbox_v2_auth_stream_head_guard()"
      )
    );
    expect(commandGuardSql).not.toContain("new.principal_scope_key");
    expect(commandGuardSql).not.toContain("old.principal_scope_key");
    const decisionRefsSql = invariantSql.slice(
      invariantSql.indexOf(
        "create or replace function public.inbox_v2_auth_decision_refs_safe("
      ),
      invariantSql.indexOf(
        "create or replace function public.inbox_v2_auth_audit_identifier_guard()"
      )
    );
    expect(decisionRefsSql.match(/::text\[\]/g)).toHaveLength(10);
    const groupedJsonbSubtraction =
      /\(\((?:[a-z_]+\.)?[a-z_]+(?:->'[^']+')+\)\s*-\s*array\[/g;
    const ungroupedJsonbSubtraction =
      /\((?:[a-z_]+\.)?[a-z_]+(?:->'[^']+')+\s*-\s*array\[/;
    expect(invariantSql.match(groupedJsonbSubtraction)).toHaveLength(8);
    expect(invariantSql).not.toMatch(ungroupedJsonbSubtraction);
    expect(invariantSql).toContain(
      "new.last_position <> old.last_position + 1"
    );
    expect(invariantSql).toContain(
      "authorization_role_permission_manifest_incomplete"
    );
    expect(invariantSql).toContain("v_audit.facets_digest_sha256");
    expect(invariantSql).toContain("authorization_stream_manifest_incomplete");
    expect(invariantSql).toContain(
      "authorization_mutation_sealed_manifest_changed"
    );
    expect(
      invariantSql.match(
        /execute function public\.inbox_v2_auth_mutation_child_coherence\(\)/g
      )
    ).toHaveLength(6);
    for (const childTable of [
      "inbox_v2_tenant_stream_changes",
      "inbox_v2_domain_events",
      "inbox_v2_outbox_intents",
      "inbox_v2_auth_audit_facets",
      "inbox_v2_auth_revision_effects",
      "inbox_v2_auth_relation_writes"
    ]) {
      expect(invariantSql).toContain(`after insert on public.${childTable}`);
    }
    const childCoherenceSql = invariantSql.slice(
      invariantSql.indexOf(
        "create or replace function public.inbox_v2_auth_mutation_child_coherence()"
      ),
      invariantSql.indexOf("do $triggers$")
    );
    expect(childCoherenceSql).toContain(
      "The tenant stream is shared by every V2 domain writer"
    );
    expect(childCoherenceSql).toContain(
      "if not found then\n      return null;"
    );
    expect(invariantSql).toContain("v_authorization_event_count < 1");
    expect(invariantSql).toContain(
      "event_row.type_id = 'core:authorization.changed'"
    );
    expect(invariantSql).toContain(
      "event_row.access_effect <> 'may_change_access'"
    );
    expect(invariantSql).toContain("intent_row.effect_class = 'provider_io'");
    expect(invariantSql).toContain("authorization_revision_effect_invalid");
    expect(invariantSql).toContain("authorization_relation_write_invalid");
    expect(invariantSql).toContain("authorization_relation_version_orphan");
    expect(invariantSql).toContain("authorization_relation_actor_mismatch");
    expect(invariantSql).toContain(
      "authorization_relation_occurred_at_mismatch"
    );
    expect(invariantSql).toContain(
      "new.occurred_at is distinct from v_mutation_committed_at"
    );
    expect(invariantSql).toContain("transition_row.cause_actor_employee_id =");
    expect(invariantSql).toContain("transition_row.actor_authorization_epoch");
    expect(invariantSql).toContain(
      "case when v_command.actor_kind = 'employee'"
    );
    expect(invariantSql).toContain(
      "command_row.id = mutation_row.command_record_id"
    );
    expect(invariantSql).toContain("v_command_actor_kind");
    expect(invariantSql).toContain("authorization_command_orphan");
    expect(invariantSql).toContain("as decision_rows(decision_value)");
    expect(invariantSql).not.toContain("count(distinct decision_ref->>'id')");
    expect(invariantSql).toContain("write_row.previous_revision");
    expect(invariantSql).toContain("authorization_tenant_rbac_fanout_invalid");
    expect(invariantSql).not.toMatch(/\bor case when\b/);
    expect(invariantSql.match(/\bor \(case when\b/g)).toHaveLength(4);
    expect(invariantSql).toContain("previousTenantRbacRevision");
    expect(invariantSql).toContain("previousSharedAccessRevision");
    expect(invariantSql).toContain("affectedRecipients");
    expect(invariantSql).toContain("jsonb_path_query");
    expect(invariantSql).toContain("inbox_v2_auth_catalog_id_safe");
    expect(invariantSql).toContain(
      "authorization_audit_permission_ids_invalid"
    );
    expect(invariantSql).toContain(
      "authorization_structural_target_set_mismatch"
    );
    expect(invariantSql).toContain(
      "authorization_employee_access_target_set_mismatch"
    );
    expect(invariantSql).toContain(
      "authorization_direct_relation_target_set_mismatch"
    );
    expect(invariantSql).toContain(
      "authorization_direct_recipient_set_mismatch"
    );
    expect(invariantSql).toContain(
      "authorization_direct_recipient_relation_invalid"
    );
    expect(invariantSql).toContain(
      "v_stream.change_ids @> event_row.change_ids"
    );
    expect(invariantSql).toContain(
      "event_row.change_ids @> intent_row.change_ids"
    );
    expect(invariantSql).toContain("effect_class = 'projection'");
    expect(invariantSql).toContain("deferrable initially deferred");
    expect(invariantSql).toContain(
      "transition_row.resulting_revision = write_row.resulting_revision"
    );
    expect(invariantSql).toContain(
      "transition_row.resulting_relation_revision ="
    );
    expect(invariantSql).toContain("version_row.work_item_cycle >= 0");
    expect(invariantSql).not.toMatch(/\b(?:from|join|update) inbox_v2_/u);
    expect(invariantSql).not.toMatch(/execute function inbox_v2_/u);
  });
});

function expectForeignKey(
  table: Parameters<typeof getTableConfig>[0],
  name: string,
  foreignTable: Parameters<typeof getTableConfig>[0],
  columns: string[],
  foreignColumns: string[]
): void {
  const foreignKey = getTableConfig(table).foreignKeys.find(
    (candidate) => candidate.getName() === name
  );
  expect(foreignKey).toBeDefined();
  const reference = foreignKey?.reference();
  expect(reference?.foreignTable).toBe(foreignTable);
  expect(reference?.columns.map((column) => column.name)).toEqual(columns);
  expect(reference?.foreignColumns.map((column) => column.name)).toEqual(
    foreignColumns
  );
}

function checkSql(
  table: Parameters<typeof getTableConfig>[0],
  name: string
): string {
  const constraint = getTableConfig(table).checks.find(
    (candidate) => candidate.name === name
  );
  if (!constraint) throw new Error(`Missing expected check: ${name}`);
  return new PgDialect().sqlToQuery(constraint.value).sql;
}

function indexColumnName(
  column: ReturnType<
    typeof getTableConfig
  >["indexes"][number]["config"]["columns"][number]
): string | undefined {
  return "name" in column && typeof column.name === "string"
    ? column.name
    : undefined;
}

function columnNames(table: Parameters<typeof getTableConfig>[0]): string[] {
  return getTableConfig(table).columns.map((column) => column.name);
}

function indexesNamed(
  table: Parameters<typeof getTableConfig>[0],
  prefix: string,
  suffix: string
): ReturnType<typeof getTableConfig>["indexes"] {
  return getTableConfig(table).indexes.filter(
    (candidate) =>
      (candidate.config.name ?? "").startsWith(prefix) &&
      (candidate.config.name ?? "").endsWith(suffix)
  );
}

function indexPredicateSql(
  tableIndex: ReturnType<typeof getTableConfig>["indexes"][number]
): string {
  const predicate = tableIndex.config.where;
  if (!predicate) {
    throw new Error(`Missing index predicate: ${tableIndex.config.name}`);
  }
  return new PgDialect().sqlToQuery(predicate).sql;
}

function expectPartialLookupIndex(
  table: Parameters<typeof getTableConfig>[0],
  name: string,
  columns: string[],
  predicateFragments: string[]
): void {
  const tableIndex = getTableConfig(table).indexes.find(
    (candidate) => candidate.config.name === name
  );
  expect(tableIndex?.config.unique).toBe(false);
  expect(tableIndex?.config.columns.map(indexColumnName)).toEqual(columns);
  if (!tableIndex) throw new Error(`Missing expected index: ${name}`);
  const predicate = indexPredicateSql(tableIndex);
  for (const fragment of predicateFragments) {
    expect(predicate).toContain(fragment);
  }
}
