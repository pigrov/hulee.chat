import { z } from "zod";

import { inboxV2AuthorizationEpochSchema } from "./authorization-epoch";
import { inboxV2CatalogIdSchema } from "./catalog";
import {
  inboxV2CommandPrincipalIdentitySchema,
  inboxV2CommandRequestIdentitySchema
} from "./command-protocol";
import {
  inboxV2BigintCounterSchema,
  inboxV2EntityRevisionSchema,
  inboxV2TimestampSchema,
  isInboxV2TimestampOrderValid
} from "./entity-metadata";
import {
  inboxV2ClientReferenceSchema,
  inboxV2ConversationReferenceSchema,
  inboxV2EmployeeReferenceSchema,
  inboxV2OrgUnitReferenceSchema,
  inboxV2ParticipantMembershipTransitionReferenceSchema,
  inboxV2SourceAccountReferenceSchema,
  inboxV2TeamReferenceSchema,
  inboxV2TenantIdSchema,
  inboxV2WorkItemReferenceSchema,
  inboxV2WorkItemRelationTransitionReferenceSchema,
  inboxV2WorkItemTransitionReferenceSchema,
  inboxV2WorkQueueReferenceSchema
} from "./ids";
import {
  createInboxV2SchemaEnvelopeSchema,
  INBOX_V2_INITIAL_SCHEMA_VERSION
} from "./schema-version";
import {
  inboxV2AuthorizationDecisionReferenceSchema,
  inboxV2CommandIdSchema,
  inboxV2CorrelationIdSchema,
  inboxV2EntityOpaqueIdSchema,
  inboxV2InternalEntityReferenceSchema,
  inboxV2Sha256DigestSchema
} from "./sync-primitives";
import { inboxV2AtomicMutationCommitSchema } from "./tenant-stream";

export const INBOX_V2_AUTHORIZATION_PERSISTENCE_SCHEMA_ID =
  "core:inbox-v2.authorization-persistence" as const;
export const INBOX_V2_PRIVILEGED_AUTHORIZATION_MUTATION_SCHEMA_ID =
  "core:inbox-v2.privileged-authorization-mutation" as const;
export const INBOX_V2_AUTHORIZATION_PERSISTENCE_SCHEMA_VERSION =
  INBOX_V2_INITIAL_SCHEMA_VERSION;
export const INBOX_V2_PERMISSION_CATALOG_SCHEMA_ID =
  "core:inbox-v2.permission-scope-catalog" as const;
export const INBOX_V2_PERMISSION_CATALOG_SCHEMA_VERSION = "v1" as const;

const inboxV2AuthorizationRecordIdSchema = inboxV2EntityOpaqueIdSchema;

export const inboxV2PersistedRoleReferenceSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    kind: z.literal("role"),
    id: inboxV2AuthorizationRecordIdSchema
  })
  .strict();

export const inboxV2RoleBindingSubjectReferenceSchema = z.discriminatedUnion(
  "kind",
  [
    inboxV2EmployeeReferenceSchema,
    inboxV2OrgUnitReferenceSchema,
    inboxV2TeamReferenceSchema,
    inboxV2WorkQueueReferenceSchema
  ]
);

export const inboxV2AuthorizationScopeReferenceSchema = z
  .discriminatedUnion("type", [
    z
      .object({ type: z.literal("tenant"), tenantId: inboxV2TenantIdSchema })
      .strict(),
    z
      .object({
        type: z.literal("org_unit"),
        tenantId: inboxV2TenantIdSchema,
        orgUnit: inboxV2OrgUnitReferenceSchema,
        mode: z.enum(["exact", "subtree"])
      })
      .strict(),
    z
      .object({
        type: z.literal("team"),
        tenantId: inboxV2TenantIdSchema,
        team: inboxV2TeamReferenceSchema
      })
      .strict(),
    z
      .object({
        type: z.literal("queue"),
        tenantId: inboxV2TenantIdSchema,
        queue: inboxV2WorkQueueReferenceSchema
      })
      .strict(),
    z
      .object({
        type: z.literal("client"),
        tenantId: inboxV2TenantIdSchema,
        client: inboxV2ClientReferenceSchema
      })
      .strict(),
    z
      .object({
        type: z.literal("conversation"),
        tenantId: inboxV2TenantIdSchema,
        conversation: inboxV2ConversationReferenceSchema
      })
      .strict(),
    z
      .object({
        type: z.literal("work_item"),
        tenantId: inboxV2TenantIdSchema,
        workItem: inboxV2WorkItemReferenceSchema
      })
      .strict(),
    z
      .object({
        type: z.literal("source_account"),
        tenantId: inboxV2TenantIdSchema,
        sourceAccount: inboxV2SourceAccountReferenceSchema
      })
      .strict(),
    z
      .object({
        type: z.literal("responsible"),
        tenantId: inboxV2TenantIdSchema
      })
      .strict(),
    z
      .object({
        type: z.literal("collaborator"),
        tenantId: inboxV2TenantIdSchema
      })
      .strict(),
    z
      .object({
        type: z.literal("internal_participant"),
        tenantId: inboxV2TenantIdSchema
      })
      .strict(),
    z
      .object({
        type: z.literal("client_owner"),
        tenantId: inboxV2TenantIdSchema
      })
      .strict()
  ])
  .superRefine((scope, context) => {
    const reference = scopeReference(scope);
    if (reference !== null && reference.tenantId !== scope.tenantId) {
      addIssue(
        context,
        [scopeReferenceField(scope)],
        "Authorization scope reference must belong to the scope tenant."
      );
    }
  });

export const inboxV2AuthorizationResourceReferenceSchema = z.discriminatedUnion(
  "kind",
  [
    inboxV2SourceAccountReferenceSchema,
    inboxV2ConversationReferenceSchema,
    inboxV2ClientReferenceSchema,
    inboxV2WorkItemReferenceSchema
  ]
);

export const inboxV2StructuralAccessTargetReferenceSchema =
  z.discriminatedUnion("kind", [
    inboxV2OrgUnitReferenceSchema,
    inboxV2TeamReferenceSchema
  ]);

export const inboxV2CollaboratorResourceReferenceSchema = z.discriminatedUnion(
  "kind",
  [
    inboxV2ConversationReferenceSchema,
    inboxV2WorkItemReferenceSchema.extend({
      /** Prevents a collaborator grant from silently surviving WorkItem reopen. */
      workItemCycle: inboxV2BigintCounterSchema
    })
  ]
);

export const inboxV2PermissionCatalogAuthoritySchema = z
  .object({
    schemaId: z.literal(INBOX_V2_PERMISSION_CATALOG_SCHEMA_ID),
    schemaVersion: z.literal(INBOX_V2_PERMISSION_CATALOG_SCHEMA_VERSION),
    catalogDigest: inboxV2Sha256DigestSchema
  })
  .strict();

export const inboxV2RolePermissionSnapshotSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    role: inboxV2PersistedRoleReferenceSchema,
    roleRevision: inboxV2EntityRevisionSchema,
    catalogAuthority: inboxV2PermissionCatalogAuthoritySchema,
    permissionIds: z.array(inboxV2CatalogIdSchema).min(1).max(256),
    immutable: z.literal(true),
    createdAt: inboxV2TimestampSchema,
    createdBy: inboxV2CommandPrincipalIdentitySchema,
    snapshotHash: inboxV2Sha256DigestSchema
  })
  .strict()
  .superRefine((snapshot, context) => {
    addTenantReferenceIssue(context, snapshot.tenantId, snapshot.role, [
      "role"
    ]);
    addPrincipalTenantIssue(context, snapshot.tenantId, snapshot.createdBy, [
      "createdBy"
    ]);
    addCanonicalStringArrayIssues(
      context,
      snapshot.permissionIds,
      ["permissionIds"],
      "Role permission snapshots"
    );
  });

export const inboxV2RolePermissionSnapshotWriteDecisionSchema =
  z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("insert") }).strict(),
    z.object({ kind: z.literal("duplicate") }).strict(),
    z
      .object({
        kind: z.literal("conflict"),
        errorCode: z.literal("authorization.role_snapshot_conflict")
      })
      .strict()
  ]);

export function decideInboxV2RolePermissionSnapshotWrite(input: {
  incoming: z.input<typeof inboxV2RolePermissionSnapshotSchema>;
  existing: z.input<typeof inboxV2RolePermissionSnapshotSchema> | null;
}): z.infer<typeof inboxV2RolePermissionSnapshotWriteDecisionSchema> {
  const incoming = inboxV2RolePermissionSnapshotSchema.parse(input.incoming);
  if (input.existing === null) {
    return { kind: "insert" };
  }
  const existing = inboxV2RolePermissionSnapshotSchema.parse(input.existing);
  if (
    incoming.tenantId !== existing.tenantId ||
    incoming.role.id !== existing.role.id ||
    incoming.roleRevision !== existing.roleRevision
  ) {
    return { kind: "insert" };
  }
  return sameJson(incoming, existing)
    ? { kind: "duplicate" }
    : {
        kind: "conflict",
        errorCode: "authorization.role_snapshot_conflict"
      };
}

const temporalAuthorizationEpisodeFields = {
  validFrom: inboxV2TimestampSchema,
  validUntil: inboxV2TimestampSchema.nullable(),
  revocation: z
    .object({
      revokedAt: inboxV2TimestampSchema,
      revokedBy: inboxV2CommandPrincipalIdentitySchema,
      reasonId: inboxV2CatalogIdSchema
    })
    .strict()
    .nullable(),
  revision: inboxV2EntityRevisionSchema,
  createdAt: inboxV2TimestampSchema,
  createdBy: inboxV2CommandPrincipalIdentitySchema
} as const;

export const inboxV2TemporalRoleBindingSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2AuthorizationRecordIdSchema,
    role: inboxV2PersistedRoleReferenceSchema,
    /** Historical observation only; effective authority follows the role head. */
    roleRevisionObservedAtTransition: inboxV2EntityRevisionSchema,
    subject: inboxV2RoleBindingSubjectReferenceSchema,
    scope: inboxV2AuthorizationScopeReferenceSchema,
    reasonId: inboxV2CatalogIdSchema,
    bindingHash: inboxV2Sha256DigestSchema,
    ...temporalAuthorizationEpisodeFields
  })
  .strict()
  .superRefine((binding, context) => {
    addTemporalEpisodeIssues(context, binding);
    for (const [field, reference] of [
      ["role", binding.role],
      ["subject", binding.subject],
      ["scope", binding.scope]
    ] as const) {
      addTenantReferenceIssue(context, binding.tenantId, reference, [field]);
    }
  });

export const inboxV2TemporalDirectGrantSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2AuthorizationRecordIdSchema,
    employee: inboxV2EmployeeReferenceSchema,
    catalogAuthority: inboxV2PermissionCatalogAuthoritySchema,
    permissionId: inboxV2CatalogIdSchema,
    scope: inboxV2AuthorizationScopeReferenceSchema,
    reasonId: inboxV2CatalogIdSchema,
    grantHash: inboxV2Sha256DigestSchema,
    ...temporalAuthorizationEpisodeFields
  })
  .strict()
  .superRefine((grant, context) => {
    addTemporalEpisodeIssues(context, grant);
    addTenantReferenceIssue(context, grant.tenantId, grant.employee, [
      "employee"
    ]);
    addTenantReferenceIssue(context, grant.tenantId, grant.scope, ["scope"]);
  });

export const inboxV2WorkforceMembershipContainerReferenceSchema =
  z.discriminatedUnion("kind", [
    inboxV2OrgUnitReferenceSchema,
    inboxV2TeamReferenceSchema,
    inboxV2WorkQueueReferenceSchema
  ]);

export const inboxV2TemporalWorkforceMembershipSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2AuthorizationRecordIdSchema,
    employee: inboxV2EmployeeReferenceSchema,
    container: inboxV2WorkforceMembershipContainerReferenceSchema,
    reasonId: inboxV2CatalogIdSchema,
    membershipHash: inboxV2Sha256DigestSchema,
    ...temporalAuthorizationEpisodeFields
  })
  .strict()
  .superRefine((membership, context) => {
    addTemporalEpisodeIssues(context, membership);
    addTenantReferenceIssue(context, membership.tenantId, membership.employee, [
      "employee"
    ]);
    addTenantReferenceIssue(
      context,
      membership.tenantId,
      membership.container,
      ["container"]
    );
  });

export const inboxV2TemporalStructuralAccessBindingSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2AuthorizationRecordIdSchema,
    resource: z.discriminatedUnion("kind", [
      inboxV2SourceAccountReferenceSchema,
      inboxV2ConversationReferenceSchema,
      inboxV2ClientReferenceSchema
    ]),
    target: inboxV2StructuralAccessTargetReferenceSchema,
    reasonId: inboxV2CatalogIdSchema,
    policyReference: z
      .object({
        policyId: inboxV2CatalogIdSchema,
        policyRevision: inboxV2EntityRevisionSchema
      })
      .strict()
      .nullable(),
    bindingHash: inboxV2Sha256DigestSchema,
    ...temporalAuthorizationEpisodeFields
  })
  .strict()
  .superRefine((binding, context) => {
    addTemporalEpisodeIssues(context, binding);
    addTenantReferenceIssue(context, binding.tenantId, binding.resource, [
      "resource"
    ]);
    addTenantReferenceIssue(context, binding.tenantId, binding.target, [
      "target"
    ]);
    if (
      binding.resource.kind === "source_account" &&
      binding.target.kind !== "org_unit"
    ) {
      addIssue(
        context,
        ["target"],
        "SourceAccount structural access is owned only through an explicit org unit."
      );
    }
  });

export const inboxV2TemporalCollaboratorSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2AuthorizationRecordIdSchema,
    resource: inboxV2CollaboratorResourceReferenceSchema,
    employee: inboxV2EmployeeReferenceSchema,
    reasonId: inboxV2CatalogIdSchema,
    relationHash: inboxV2Sha256DigestSchema,
    ...temporalAuthorizationEpisodeFields
  })
  .strict()
  .superRefine((relation, context) => {
    addTemporalEpisodeIssues(context, relation);
    addTenantReferenceIssue(context, relation.tenantId, relation.resource, [
      "resource"
    ]);
    addTenantReferenceIssue(context, relation.tenantId, relation.employee, [
      "employee"
    ]);
  });

export const inboxV2AuthorizationClockAdvanceSchema = z
  .object({
    previous: inboxV2EntityRevisionSchema,
    resulting: inboxV2EntityRevisionSchema
  })
  .strict()
  .superRefine((advance, context) => {
    if (BigInt(advance.resulting) !== BigInt(advance.previous) + 1n) {
      addIssue(
        context,
        ["resulting"],
        "Authorization clocks must advance exactly once."
      );
    }
  });

const inboxV2EmployeeAuthorizationRevisionAdvanceSchema = z
  .object({
    employee: inboxV2EmployeeReferenceSchema,
    advance: inboxV2AuthorizationClockAdvanceSchema
  })
  .strict();

const inboxV2ResourceAuthorizationRevisionAdvanceSchema = z
  .object({
    resource: inboxV2AuthorizationResourceReferenceSchema,
    advance: inboxV2AuthorizationClockAdvanceSchema
  })
  .strict();

/**
 * Bounded dependency-vector update. Broad changes update tenant/shared heads;
 * direct changes enumerate only their exact Employees; structural changes
 * enumerate only resources and never materialize target membership fan-out.
 */
export const inboxV2AuthorizationRevisionDeltaSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    kind: z.enum([
      "role_definition_or_binding",
      "employee_access",
      "direct_inbox_relation",
      "structural_resource_access"
    ]),
    tenantRbacRevision: inboxV2AuthorizationClockAdvanceSchema.nullable(),
    sharedAccessRevision: inboxV2AuthorizationClockAdvanceSchema.nullable(),
    employeeAccessRevisions: z
      .array(inboxV2EmployeeAuthorizationRevisionAdvanceSchema)
      .max(64),
    employeeInboxRelationRevisions: z
      .array(inboxV2EmployeeAuthorizationRevisionAdvanceSchema)
      .max(1_000),
    resourceAccessRevisions: z
      .array(inboxV2ResourceAuthorizationRevisionAdvanceSchema)
      .max(256)
  })
  .strict()
  .superRefine((delta, context) => {
    addCanonicalRevisionTargetIssues(context, delta);

    const roleChange = delta.kind === "role_definition_or_binding";
    const employeeChange = delta.kind === "employee_access";
    const directRelation = delta.kind === "direct_inbox_relation";
    const structural = delta.kind === "structural_resource_access";
    const validShape =
      (roleChange &&
        delta.tenantRbacRevision !== null &&
        delta.sharedAccessRevision === null &&
        delta.employeeAccessRevisions.length === 0 &&
        delta.employeeInboxRelationRevisions.length === 0 &&
        delta.resourceAccessRevisions.length === 0) ||
      (employeeChange &&
        delta.tenantRbacRevision === null &&
        delta.sharedAccessRevision === null &&
        delta.employeeAccessRevisions.length > 0 &&
        delta.employeeInboxRelationRevisions.length === 0 &&
        delta.resourceAccessRevisions.length === 0) ||
      (directRelation &&
        delta.tenantRbacRevision === null &&
        delta.sharedAccessRevision === null &&
        delta.employeeAccessRevisions.length === 0 &&
        delta.employeeInboxRelationRevisions.length > 0 &&
        delta.resourceAccessRevisions.length === 0) ||
      (structural &&
        delta.tenantRbacRevision === null &&
        delta.sharedAccessRevision !== null &&
        delta.employeeAccessRevisions.length === 0 &&
        delta.employeeInboxRelationRevisions.length === 0 &&
        delta.resourceAccessRevisions.length > 0);

    if (!validShape) {
      addIssue(
        context,
        ["kind"],
        "Revision delta must use the bounded clock set for its exact access-impact class."
      );
    }
  });

export const inboxV2SuccessfulAuthorizationAuditFacetSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    dimension: z.enum(["tenant", "org_unit", "team", "queue", "resource"]),
    target: inboxV2InternalEntityReferenceSchema,
    relation: z.enum(["source", "destination", "affected"]),
    facetHash: inboxV2Sha256DigestSchema
  })
  .strict()
  .superRefine((facet, context) => {
    addTenantReferenceIssue(context, facet.tenantId, facet.target, ["target"]);
    const allowedEntityTypes = {
      tenant: ["core:tenant"],
      org_unit: ["core:org-unit"],
      team: ["core:team"],
      queue: ["core:work-queue"],
      resource: [
        "core:conversation",
        "core:client",
        "core:work-item",
        "core:source-account"
      ]
    } as const;
    if (
      !(allowedEntityTypes[facet.dimension] as readonly string[]).includes(
        facet.target.entityTypeId
      )
    ) {
      addIssue(
        context,
        ["target", "entityTypeId"],
        "Audit facet entity type must match its minimized dimension."
      );
    }
  });

export const inboxV2SuccessfulAuthorizationAuditSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    auditId: inboxV2AuthorizationRecordIdSchema,
    category: z.literal("privileged_security"),
    actionId: inboxV2CatalogIdSchema,
    actor: inboxV2CommandPrincipalIdentitySchema,
    target: inboxV2InternalEntityReferenceSchema,
    facets: z
      .array(inboxV2SuccessfulAuthorizationAuditFacetSchema)
      .min(1)
      .max(64),
    authorizationDecisionRefs: z
      .array(inboxV2AuthorizationDecisionReferenceSchema)
      .min(1)
      .max(64),
    revisionDeltaHash: inboxV2Sha256DigestSchema,
    reasonId: inboxV2CatalogIdSchema,
    request: inboxV2CommandRequestIdentitySchema,
    commandId: inboxV2CommandIdSchema,
    correlationId: inboxV2CorrelationIdSchema,
    outcome: z.literal("succeeded"),
    occurredAt: inboxV2TimestampSchema,
    recordedAt: inboxV2TimestampSchema,
    expiresAt: inboxV2TimestampSchema,
    previousAuditHash: inboxV2Sha256DigestSchema.nullable(),
    auditHash: inboxV2Sha256DigestSchema
  })
  .strict()
  .superRefine((audit, context) => {
    addPrincipalTenantIssue(context, audit.tenantId, audit.actor, ["actor"]);
    addTenantReferenceIssue(context, audit.tenantId, audit.target, ["target"]);
    if (audit.request.tenantId !== audit.tenantId) {
      addIssue(
        context,
        ["request"],
        "Audit request must belong to the audit tenant."
      );
    }
    for (const [index, facet] of audit.facets.entries()) {
      addTenantReferenceIssue(context, audit.tenantId, facet, [
        "facets",
        index
      ]);
    }
    for (const [index, decision] of audit.authorizationDecisionRefs.entries()) {
      if (
        decision.tenantId !== audit.tenantId ||
        decision.outcome !== "allowed"
      ) {
        addIssue(
          context,
          ["authorizationDecisionRefs", index],
          "Successful audit contains only allowed decisions from its tenant."
        );
      }
    }
    addCanonicalReferenceArrayIssues(
      context,
      audit.facets,
      (facet) =>
        `${facet.dimension}\u0000${facet.target.entityTypeId}\u0000${facet.target.entityId}\u0000${facet.relation}`,
      ["facets"],
      "Audit facets"
    );
    addCanonicalReferenceArrayIssues(
      context,
      audit.authorizationDecisionRefs,
      (decision) => String(decision.id),
      ["authorizationDecisionRefs"],
      "Audit authorization decisions"
    );
    if (
      !isInboxV2TimestampOrderValid(audit.occurredAt, audit.recordedAt) ||
      !isInboxV2TimestampOrderValid(audit.recordedAt, audit.expiresAt) ||
      audit.recordedAt === audit.expiresAt
    ) {
      addIssue(
        context,
        ["expiresAt"],
        "Successful audit timestamps must be ordered and finitely retained."
      );
    }
  });

export const inboxV2AuthorizationPersistencePayloadSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    rolePermissionSnapshots: z
      .array(inboxV2RolePermissionSnapshotSchema)
      .max(64),
    roleBindings: z.array(inboxV2TemporalRoleBindingSchema).max(1_000),
    directGrants: z.array(inboxV2TemporalDirectGrantSchema).max(1_000),
    workforceMemberships: z
      .array(inboxV2TemporalWorkforceMembershipSchema)
      .max(1_000),
    structuralBindings: z
      .array(inboxV2TemporalStructuralAccessBindingSchema)
      .max(1_000),
    collaborators: z.array(inboxV2TemporalCollaboratorSchema).max(1_000),
    reusedRelationTransitions: z
      .array(
        z.discriminatedUnion("kind", [
          z
            .object({
              kind: z.literal("internal_membership"),
              transition: inboxV2ParticipantMembershipTransitionReferenceSchema
            })
            .strict(),
          z
            .object({
              kind: z.literal("primary_responsibility"),
              transition: inboxV2WorkItemTransitionReferenceSchema
            })
            .strict(),
          z
            .object({
              kind: z.literal("servicing_team"),
              transition: inboxV2WorkItemRelationTransitionReferenceSchema
            })
            .strict()
        ])
      )
      .max(64)
  })
  .strict()
  .superRefine((payload, context) => {
    for (const [field, records] of persistedRecordCollections(payload)) {
      for (const [index, record] of records.entries()) {
        if (record.tenantId !== payload.tenantId) {
          addIssue(
            context,
            [field, index],
            "Authorization persistence payload must contain one tenant only."
          );
        }
      }
    }
    for (const [
      index,
      relation
    ] of payload.reusedRelationTransitions.entries()) {
      if (relation.transition.tenantId !== payload.tenantId) {
        addIssue(
          context,
          ["reusedRelationTransitions", index, "transition"],
          "Reused relation transition must belong to the payload tenant."
        );
      }
    }
    addCanonicalReferenceArrayIssues(
      context,
      payload.reusedRelationTransitions,
      (relation) => `${relation.kind}\u0000${String(relation.transition.id)}`,
      ["reusedRelationTransitions"],
      "Reused relation transitions"
    );
  });

export const inboxV2PrivilegedAuthorizationMutationKindSchema = z.enum([
  "role_definition",
  "role_binding",
  "direct_grant",
  "workforce_membership",
  "structural_binding",
  "collaborator",
  "internal_membership",
  "primary_responsibility",
  "servicing_team"
]);

export const inboxV2PrivilegedAuthorizationCommandContextSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    commandId: inboxV2CommandIdSchema,
    request: inboxV2CommandRequestIdentitySchema,
    principal: inboxV2CommandPrincipalIdentitySchema,
    authorizationEpoch: inboxV2AuthorizationEpochSchema,
    authorizationDecisionRefs: z
      .array(inboxV2AuthorizationDecisionReferenceSchema)
      .min(1)
      .max(64),
    authorizedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((command, context) => {
    addPrincipalTenantIssue(context, command.tenantId, command.principal, [
      "principal"
    ]);
    if (command.request.tenantId !== command.tenantId) {
      addIssue(
        context,
        ["request"],
        "Privileged command request must belong to its command tenant."
      );
    }
    addCanonicalReferenceArrayIssues(
      context,
      command.authorizationDecisionRefs,
      (decision) => String(decision.id),
      ["authorizationDecisionRefs"],
      "Privileged command decisions"
    );
    for (const [
      index,
      decision
    ] of command.authorizationDecisionRefs.entries()) {
      if (
        decision.tenantId !== command.tenantId ||
        decision.authorizationEpoch !== command.authorizationEpoch ||
        !sameJson(decision.principal, command.principal) ||
        decision.outcome !== "allowed" ||
        Date.parse(decision.decidedAt) > Date.parse(command.authorizedAt) ||
        Date.parse(command.authorizedAt) >= Date.parse(decision.notAfter)
      ) {
        addIssue(
          context,
          ["authorizationDecisionRefs", index],
          "Privileged command requires the exact current allowed decision set for its principal."
        );
      }
    }
  });

export const inboxV2PrivilegedAuthorizationMutationSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    kind: inboxV2PrivilegedAuthorizationMutationKindSchema,
    command: inboxV2PrivilegedAuthorizationCommandContextSchema,
    records: inboxV2AuthorizationPersistencePayloadSchema,
    revisionDelta: inboxV2AuthorizationRevisionDeltaSchema,
    audit: inboxV2SuccessfulAuthorizationAuditSchema,
    atomicCommit: inboxV2AtomicMutationCommitSchema
  })
  .strict()
  .superRefine((mutation, context) => {
    validatePrivilegedMutationTenant(context, mutation);
    validatePrivilegedMutationRecordShape(context, mutation);
    validatePrivilegedMutationRevisionShape(context, mutation);
    validatePrivilegedMutationRecordTargets(context, mutation);
    validatePrivilegedMutationCommandCommit(context, mutation);
    validatePrivilegedMutationEventOutbox(context, mutation);
    validatePrivilegedMutationAudience(context, mutation);
  });

export const inboxV2PrivilegedAuthorizationMutationEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_PRIVILEGED_AUTHORIZATION_MUTATION_SCHEMA_ID,
    INBOX_V2_AUTHORIZATION_PERSISTENCE_SCHEMA_VERSION,
    inboxV2PrivilegedAuthorizationMutationSchema
  );

export const inboxV2AuthorizationPersistenceEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_AUTHORIZATION_PERSISTENCE_SCHEMA_ID,
    INBOX_V2_AUTHORIZATION_PERSISTENCE_SCHEMA_VERSION,
    inboxV2AuthorizationPersistencePayloadSchema
  );

export type InboxV2PersistedRoleReference = z.infer<
  typeof inboxV2PersistedRoleReferenceSchema
>;
export type InboxV2RoleBindingSubjectReference = z.infer<
  typeof inboxV2RoleBindingSubjectReferenceSchema
>;
export type InboxV2AuthorizationScopeReference = z.infer<
  typeof inboxV2AuthorizationScopeReferenceSchema
>;
export type InboxV2RolePermissionSnapshot = z.infer<
  typeof inboxV2RolePermissionSnapshotSchema
>;
export type InboxV2TemporalRoleBinding = z.infer<
  typeof inboxV2TemporalRoleBindingSchema
>;
export type InboxV2AuthorizationRevisionDelta = z.infer<
  typeof inboxV2AuthorizationRevisionDeltaSchema
>;
export type InboxV2PrivilegedAuthorizationMutation = z.infer<
  typeof inboxV2PrivilegedAuthorizationMutationSchema
>;

function addTemporalEpisodeIssues(
  context: z.RefinementCtx,
  episode: {
    tenantId: string;
    validFrom: string;
    validUntil: string | null;
    revocation: {
      revokedAt: string;
      revokedBy: z.infer<typeof inboxV2CommandPrincipalIdentitySchema>;
    } | null;
    createdAt: string;
    createdBy: z.infer<typeof inboxV2CommandPrincipalIdentitySchema>;
  }
): void {
  addPrincipalTenantIssue(context, episode.tenantId, episode.createdBy, [
    "createdBy"
  ]);
  if (!isInboxV2TimestampOrderValid(episode.createdAt, episode.validFrom)) {
    addIssue(
      context,
      ["createdAt"],
      "Temporal authorization episode must be recorded no later than validFrom."
    );
  }
  if (
    episode.validUntil !== null &&
    Date.parse(episode.validUntil) <= Date.parse(episode.validFrom)
  ) {
    addIssue(
      context,
      ["validUntil"],
      "Temporal authorization interval must have positive duration."
    );
  }
  if (episode.revocation !== null) {
    addPrincipalTenantIssue(
      context,
      episode.tenantId,
      episode.revocation.revokedBy,
      ["revocation", "revokedBy"]
    );
    if (
      Date.parse(episode.revocation.revokedAt) <=
        Date.parse(episode.validFrom) ||
      (episode.validUntil !== null &&
        Date.parse(episode.revocation.revokedAt) >
          Date.parse(episode.validUntil))
    ) {
      addIssue(
        context,
        ["revocation", "revokedAt"],
        "Revocation must occur strictly after validFrom and within the episode interval."
      );
    }
  }
}

function addCanonicalRevisionTargetIssues(
  context: z.RefinementCtx,
  delta: z.infer<typeof inboxV2AuthorizationRevisionDeltaSchema>
): void {
  for (const [field, advances] of [
    ["employeeAccessRevisions", delta.employeeAccessRevisions],
    ["employeeInboxRelationRevisions", delta.employeeInboxRelationRevisions]
  ] as const) {
    for (const [index, advance] of advances.entries()) {
      addTenantReferenceIssue(context, delta.tenantId, advance.employee, [
        field,
        index,
        "employee"
      ]);
    }
    addCanonicalReferenceArrayIssues(
      context,
      advances,
      (advance) => String(advance.employee.id),
      [field],
      "Employee revision targets"
    );
  }

  for (const [index, advance] of delta.resourceAccessRevisions.entries()) {
    addTenantReferenceIssue(context, delta.tenantId, advance.resource, [
      "resourceAccessRevisions",
      index,
      "resource"
    ]);
  }
  addCanonicalReferenceArrayIssues(
    context,
    delta.resourceAccessRevisions,
    (advance) => resourceReferenceKey(advance.resource),
    ["resourceAccessRevisions"],
    "Resource revision targets"
  );
}

function validatePrivilegedMutationTenant(
  context: z.RefinementCtx,
  mutation: z.infer<typeof inboxV2PrivilegedAuthorizationMutationSchema>
): void {
  if (
    mutation.command.tenantId !== mutation.tenantId ||
    mutation.records.tenantId !== mutation.tenantId ||
    mutation.revisionDelta.tenantId !== mutation.tenantId ||
    mutation.audit.tenantId !== mutation.tenantId ||
    mutation.atomicCommit.commit.tenantId !== mutation.tenantId
  ) {
    addIssue(
      context,
      [],
      "Privileged authorization mutation and every nested record must belong to one tenant."
    );
  }
}

function validatePrivilegedMutationRecordShape(
  context: z.RefinementCtx,
  mutation: z.infer<typeof inboxV2PrivilegedAuthorizationMutationSchema>
): void {
  const counts = {
    role_definition: mutation.records.rolePermissionSnapshots.length,
    role_binding: mutation.records.roleBindings.length,
    direct_grant: mutation.records.directGrants.length,
    workforce_membership: mutation.records.workforceMemberships.length,
    structural_binding: mutation.records.structuralBindings.length,
    collaborator: mutation.records.collaborators.length,
    internal_membership: mutation.records.reusedRelationTransitions.filter(
      (relation) => relation.kind === "internal_membership"
    ).length,
    primary_responsibility: mutation.records.reusedRelationTransitions.filter(
      (relation) => relation.kind === "primary_responsibility"
    ).length,
    servicing_team: mutation.records.reusedRelationTransitions.filter(
      (relation) => relation.kind === "servicing_team"
    ).length
  } as const;
  const total =
    mutation.records.rolePermissionSnapshots.length +
    mutation.records.roleBindings.length +
    mutation.records.directGrants.length +
    mutation.records.workforceMemberships.length +
    mutation.records.structuralBindings.length +
    mutation.records.collaborators.length +
    mutation.records.reusedRelationTransitions.length;
  if (counts[mutation.kind] === 0 || counts[mutation.kind] !== total) {
    addIssue(
      context,
      ["records"],
      "Privileged mutation persists only non-empty records for its declared kind."
    );
  }
}

function validatePrivilegedMutationRevisionShape(
  context: z.RefinementCtx,
  mutation: z.infer<typeof inboxV2PrivilegedAuthorizationMutationSchema>
): void {
  const expectedKind = {
    role_definition: "role_definition_or_binding",
    role_binding: "role_definition_or_binding",
    direct_grant: "employee_access",
    workforce_membership: "employee_access",
    structural_binding: "structural_resource_access",
    collaborator: "direct_inbox_relation",
    internal_membership: "direct_inbox_relation",
    primary_responsibility: "direct_inbox_relation",
    servicing_team: "structural_resource_access"
  } as const;
  if (mutation.revisionDelta.kind !== expectedKind[mutation.kind]) {
    addIssue(
      context,
      ["revisionDelta", "kind"],
      "Mutation kind must select its exact bounded revision class."
    );
  }
}

function validatePrivilegedMutationRecordTargets(
  context: z.RefinementCtx,
  mutation: z.infer<typeof inboxV2PrivilegedAuthorizationMutationSchema>
): void {
  const delta = mutation.revisionDelta;
  let persistedTargets: string[] | null = null;
  let revisionTargets: string[] | null = null;

  if (mutation.kind === "direct_grant") {
    persistedTargets = canonicalUniqueStrings(
      mutation.records.directGrants.map((record) => String(record.employee.id))
    );
    revisionTargets = delta.employeeAccessRevisions.map((advance) =>
      String(advance.employee.id)
    );
  } else if (mutation.kind === "workforce_membership") {
    persistedTargets = canonicalUniqueStrings(
      mutation.records.workforceMemberships.map((record) =>
        String(record.employee.id)
      )
    );
    revisionTargets = delta.employeeAccessRevisions.map((advance) =>
      String(advance.employee.id)
    );
  } else if (mutation.kind === "collaborator") {
    persistedTargets = canonicalUniqueStrings(
      mutation.records.collaborators.map((record) => String(record.employee.id))
    );
    revisionTargets = delta.employeeInboxRelationRevisions.map((advance) =>
      String(advance.employee.id)
    );
  } else if (mutation.kind === "structural_binding") {
    persistedTargets = canonicalUniqueStrings(
      mutation.records.structuralBindings.map((record) =>
        resourceReferenceKey(record.resource)
      )
    );
    revisionTargets = delta.resourceAccessRevisions.map((advance) =>
      resourceReferenceKey(advance.resource)
    );
  }

  if (
    persistedTargets !== null &&
    revisionTargets !== null &&
    !sameJson(persistedTargets, revisionTargets)
  ) {
    addIssue(
      context,
      ["revisionDelta"],
      "Revision targets must exactly match the unique Employees/resources persisted by the mutation."
    );
  }
}

function validatePrivilegedMutationCommandCommit(
  context: z.RefinementCtx,
  mutation: z.infer<typeof inboxV2PrivilegedAuthorizationMutationSchema>
): void {
  const { command, atomicCommit, audit } = mutation;
  const record = atomicCommit.commandRecords[0];
  if (
    atomicCommit.commandRecords.length !== 1 ||
    atomicCommit.commit.commandIds.length !== 1 ||
    atomicCommit.commit.commandIds[0] !== command.commandId ||
    atomicCommit.commit.clientMutationIds.length !== 1 ||
    atomicCommit.commit.clientMutationIds[0] !==
      command.request.clientMutationId ||
    !sameJson(
      atomicCommit.commit.authorizationDecisionRefs ?? [],
      command.authorizationDecisionRefs
    ) ||
    record === undefined ||
    record.commandId !== command.commandId ||
    record.firstRequestId !== command.request.requestId ||
    record.requestHash !== command.request.requestHash ||
    record.scope.tenantId !== command.tenantId ||
    record.scope.commandTypeId !== command.request.commandTypeId ||
    record.scope.clientMutationId !== command.request.clientMutationId ||
    !sameJson(record.scope.principal, command.principal) ||
    record.state.kind !== "completed" ||
    record.state.result.authorizationEpoch !== command.authorizationEpoch ||
    audit.commandId !== command.commandId ||
    audit.actionId !== command.request.commandTypeId ||
    audit.correlationId !== atomicCommit.commit.correlationId ||
    audit.recordedAt !== atomicCommit.commit.committedAt ||
    !sameJson(audit.request, command.request) ||
    !sameJson(audit.actor, command.principal) ||
    !sameJson(
      audit.authorizationDecisionRefs,
      command.authorizationDecisionRefs
    )
  ) {
    addIssue(
      context,
      ["atomicCommit", "commandRecords"],
      "Atomic commit must persist the exact privileged command, audit and completed idempotent result."
    );
  }
}

function validatePrivilegedMutationEventOutbox(
  context: z.RefinementCtx,
  mutation: z.infer<typeof inboxV2PrivilegedAuthorizationMutationSchema>
): void {
  const authorizationEvents = mutation.atomicCommit.events.filter(
    (event) => event.typeId === "core:authorization.changed"
  );
  if (
    authorizationEvents.length === 0 ||
    authorizationEvents.some(
      (event) => event.accessEffect.kind !== "may_change_access"
    )
  ) {
    addIssue(
      context,
      ["atomicCommit", "events"],
      "Privileged access mutations require an authorization.changed access-fence event."
    );
  }

  if (
    mutation.atomicCommit.outboxIntents.length === 0 ||
    mutation.atomicCommit.outboxIntents.some(
      (intent) => intent.effectClass === "provider_io"
    )
  ) {
    addIssue(
      context,
      ["atomicCommit", "outboxIntents"],
      "Privileged access mutations require a non-provider outbox intent and cannot dispatch provider I/O."
    );
  }
}

function validatePrivilegedMutationAudience(
  context: z.RefinementCtx,
  mutation: z.infer<typeof inboxV2PrivilegedAuthorizationMutationSchema>
): void {
  const impact = mutation.atomicCommit.commit.audienceImpact;
  const delta = mutation.revisionDelta;
  if (delta.kind === "role_definition_or_binding") {
    if (
      impact.kind !== "tenant_rbac" ||
      delta.tenantRbacRevision === null ||
      impact.previousTenantRbacRevision !== delta.tenantRbacRevision.previous ||
      impact.resultingTenantRbacRevision !== delta.tenantRbacRevision.resulting
    ) {
      addIssue(
        context,
        ["atomicCommit", "commit", "audienceImpact"],
        "Broad role/binding changes use tenant-RBAC invalidation with zero Employee fan-out."
      );
    }
    return;
  }

  if (delta.kind === "structural_resource_access") {
    if (
      impact.kind !== "structural" ||
      delta.sharedAccessRevision === null ||
      impact.previousSharedAccessRevision !==
        delta.sharedAccessRevision.previous ||
      impact.resultingSharedAccessRevision !==
        delta.sharedAccessRevision.resulting
    ) {
      addIssue(
        context,
        ["atomicCommit", "commit", "audienceImpact"],
        "Structural resource changes use shared/resource invalidation with zero Employee fan-out."
      );
    }
    return;
  }

  const expectedRecipients = (
    delta.kind === "employee_access"
      ? delta.employeeAccessRevisions
      : delta.employeeInboxRelationRevisions
  ).map((advance) => String(advance.employee.id));
  if (impact.kind !== "direct") {
    addIssue(
      context,
      ["atomicCommit", "commit", "audienceImpact"],
      "Direct Employee/relation changes require bounded recipient invalidation."
    );
    return;
  }
  const actualRecipients = impact.affectedRecipients.map((recipient) =>
    String(recipient.employee.id)
  );
  if (!sameJson(actualRecipients, expectedRecipients)) {
    addIssue(
      context,
      ["atomicCommit", "commit", "audienceImpact", "affectedRecipients"],
      "Direct audience recipients must exactly equal the canonical bounded revision targets."
    );
  }
}

function persistedRecordCollections(
  payload: z.infer<typeof inboxV2AuthorizationPersistencePayloadSchema>
): readonly (readonly [string, readonly { tenantId: string }[]])[] {
  return [
    ["rolePermissionSnapshots", payload.rolePermissionSnapshots],
    ["roleBindings", payload.roleBindings],
    ["directGrants", payload.directGrants],
    ["workforceMemberships", payload.workforceMemberships],
    ["structuralBindings", payload.structuralBindings],
    ["collaborators", payload.collaborators]
  ];
}

function scopeReference(
  scope: z.infer<typeof inboxV2AuthorizationScopeReferenceSchema>
): { tenantId: string } | null {
  switch (scope.type) {
    case "org_unit":
      return scope.orgUnit;
    case "team":
      return scope.team;
    case "queue":
      return scope.queue;
    case "client":
      return scope.client;
    case "conversation":
      return scope.conversation;
    case "work_item":
      return scope.workItem;
    case "source_account":
      return scope.sourceAccount;
    default:
      return null;
  }
}

function scopeReferenceField(
  scope: z.infer<typeof inboxV2AuthorizationScopeReferenceSchema>
): string {
  switch (scope.type) {
    case "org_unit":
      return "orgUnit";
    case "team":
      return "team";
    case "queue":
      return "queue";
    case "client":
      return "client";
    case "conversation":
      return "conversation";
    case "work_item":
      return "workItem";
    case "source_account":
      return "sourceAccount";
    default:
      return "tenantId";
  }
}

function addPrincipalTenantIssue(
  context: z.RefinementCtx,
  tenantId: string,
  principal: z.infer<typeof inboxV2CommandPrincipalIdentitySchema>,
  path: (string | number)[]
): void {
  if (
    principal.kind === "employee" &&
    principal.employee.tenantId !== tenantId
  ) {
    addIssue(
      context,
      path,
      "Employee principal must belong to the record tenant."
    );
  }
}

function addTenantReferenceIssue(
  context: z.RefinementCtx,
  tenantId: string,
  reference: { tenantId: string },
  path: (string | number)[]
): void {
  if (reference.tenantId !== tenantId) {
    addIssue(
      context,
      path,
      "Authorization reference must belong to the record tenant."
    );
  }
}

function addCanonicalStringArrayIssues(
  context: z.RefinementCtx,
  values: readonly string[],
  path: (string | number)[],
  label: string
): void {
  addCanonicalReferenceArrayIssues(context, values, String, path, label);
}

function addCanonicalReferenceArrayIssues<TValue>(
  context: z.RefinementCtx,
  values: readonly TValue[],
  keyOf: (value: TValue) => string,
  path: (string | number)[],
  label: string
): void {
  const keys = values.map(keyOf);
  if (
    new Set(keys).size !== keys.length ||
    keys.some((key, index) => index > 0 && key <= keys[index - 1]!)
  ) {
    addIssue(context, path, `${label} must be unique and canonically sorted.`);
  }
}

function resourceReferenceKey(
  resource: z.infer<typeof inboxV2AuthorizationResourceReferenceSchema>
): string {
  return `${resource.kind}\u0000${String(resource.id)}`;
}

function canonicalUniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0
  );
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function addIssue(
  context: z.RefinementCtx,
  path: (string | number)[],
  message: string
): void {
  context.addIssue({ code: "custom", path, message });
}
