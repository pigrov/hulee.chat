import { describe, expect, it } from "vitest";
import type { z } from "zod";

import { assertInboxV2ClosedJsonSchema } from "./schema-safety";
import {
  inboxV2AtomicMutationCommitSchema,
  inboxV2TenantRbacAudienceImpactSchema
} from "./tenant-stream";
import {
  decideInboxV2RolePermissionSnapshotWrite,
  INBOX_V2_PRIVILEGED_AUTHORIZATION_MUTATION_SCHEMA_ID,
  inboxV2AuthorizationClockAdvanceSchema,
  inboxV2AuthorizationPersistencePayloadSchema,
  inboxV2AuthorizationResourceReferenceSchema,
  inboxV2AuthorizationRevisionDeltaSchema,
  inboxV2AuthorizationScopeReferenceSchema,
  inboxV2CollaboratorResourceReferenceSchema,
  inboxV2PermissionCatalogAuthoritySchema,
  inboxV2PersistedRoleReferenceSchema,
  inboxV2PrivilegedAuthorizationMutationEnvelopeSchema,
  inboxV2PrivilegedAuthorizationMutationSchema,
  inboxV2RoleBindingSubjectReferenceSchema,
  inboxV2RolePermissionSnapshotSchema,
  inboxV2StructuralAccessTargetReferenceSchema,
  inboxV2SuccessfulAuthorizationAuditFacetSchema,
  inboxV2SuccessfulAuthorizationAuditSchema,
  inboxV2TemporalCollaboratorSchema,
  inboxV2TemporalDirectGrantSchema,
  inboxV2TemporalRoleBindingSchema,
  inboxV2TemporalStructuralAccessBindingSchema,
  inboxV2TemporalWorkforceMembershipSchema,
  inboxV2WorkforceMembershipContainerReferenceSchema
} from "./authorization-persistence";

const tenantId = "tenant:tenant-1";
const otherTenantId = "tenant:tenant-2";
const committedAt = "2026-07-15T09:00:00.000Z";
const validUntil = "2026-07-15T11:00:00.000Z";
const hashA = `sha256:${"a".repeat(64)}`;
const hashB = `sha256:${"b".repeat(64)}`;
const internalRoleId = `internal-ref:${"1".repeat(32)}`;
const internalTenantId = `internal-ref:${"2".repeat(32)}`;

function employee(id = "employee:employee-1", tenant = tenantId) {
  return { tenantId: tenant, kind: "employee" as const, id };
}

function principal(tenant = tenantId) {
  return { kind: "employee" as const, employee: employee(undefined, tenant) };
}

function role(tenant = tenantId) {
  return { tenantId: tenant, kind: "role" as const, id: "role:role-1" };
}

function team(tenant = tenantId) {
  return { tenantId: tenant, kind: "team" as const, id: "team:team-1" };
}

function orgUnit(tenant = tenantId) {
  return {
    tenantId: tenant,
    kind: "org_unit" as const,
    id: "org_unit:org-1"
  };
}

function queue(tenant = tenantId) {
  return {
    tenantId: tenant,
    kind: "work_queue" as const,
    id: "work_queue:queue-1"
  };
}

function conversation(tenant = tenantId) {
  return {
    tenantId: tenant,
    kind: "conversation" as const,
    id: "conversation:conversation-1"
  };
}

function workItem(tenant = tenantId) {
  return {
    tenantId: tenant,
    kind: "work_item" as const,
    id: "work_item:work-1"
  };
}

function client(tenant = tenantId) {
  return { tenantId: tenant, kind: "client" as const, id: "client:client-1" };
}

function sourceAccount(tenant = tenantId) {
  return {
    tenantId: tenant,
    kind: "source_account" as const,
    id: "source_account:source-1"
  };
}

function catalogAuthority() {
  return {
    schemaId: "core:inbox-v2.permission-scope-catalog" as const,
    schemaVersion: "v1" as const,
    catalogDigest: hashA
  };
}

function temporalFields() {
  return {
    validFrom: committedAt,
    validUntil,
    revocation: null,
    revision: "1",
    createdAt: committedAt,
    createdBy: principal()
  };
}

function roleSnapshot(tenant = tenantId) {
  return {
    tenantId: tenant,
    role: role(tenant),
    roleRevision: "1",
    catalogAuthority: catalogAuthority(),
    permissionIds: ["core:roles.bind", "core:roles.define"],
    immutable: true as const,
    createdAt: committedAt,
    createdBy: principal(tenant),
    snapshotHash: hashA
  };
}

function roleBinding() {
  return {
    tenantId,
    id: "role-binding:binding-1",
    role: role(),
    roleRevisionObservedAtTransition: "1",
    subject: team(),
    scope: { type: "team" as const, tenantId, team: team() },
    reasonId: "core:role-bound",
    bindingHash: hashA,
    ...temporalFields()
  };
}

function directGrant() {
  return {
    tenantId,
    id: "direct-grant:grant-1",
    employee: employee(),
    catalogAuthority: catalogAuthority(),
    permissionId: "core:conversation.read",
    scope: {
      type: "conversation" as const,
      tenantId,
      conversation: conversation()
    },
    reasonId: "core:temporary-coverage",
    grantHash: hashA,
    ...temporalFields()
  };
}

function workforceMembership() {
  return {
    tenantId,
    id: "workforce-membership:membership-1",
    employee: employee(),
    container: queue(),
    reasonId: "core:queue-membership",
    membershipHash: hashA,
    ...temporalFields()
  };
}

function structuralBinding(
  resource:
    | ReturnType<typeof conversation>
    | ReturnType<typeof sourceAccount> = conversation(),
  target: ReturnType<typeof orgUnit> | ReturnType<typeof team> = team()
) {
  return {
    tenantId,
    id: "structural-binding:binding-1",
    resource,
    target,
    reasonId: "core:routing-policy",
    policyReference: {
      policyId: "core:conversation-access-policy",
      policyRevision: "1"
    },
    bindingHash: hashA,
    ...temporalFields()
  };
}

function collaborator() {
  return {
    tenantId,
    id: "collaborator:relation-1",
    resource: { ...workItem(), workItemCycle: "0" },
    employee: employee(),
    reasonId: "core:assistance-requested",
    relationHash: hashA,
    ...temporalFields()
  };
}

describe("Inbox V2 authorization persistence references", () => {
  it("keeps role subjects, scopes and resources closed and provider-neutral", () => {
    for (const subject of [employee(), orgUnit(), team(), queue()]) {
      expect(
        inboxV2RoleBindingSubjectReferenceSchema.safeParse(subject).success
      ).toBe(true);
    }
    expect(
      inboxV2RoleBindingSubjectReferenceSchema.safeParse({
        tenantId,
        kind: "provider_member",
        id: "provider:member-1"
      }).success
    ).toBe(false);
    expect(
      inboxV2RoleBindingSubjectReferenceSchema.safeParse({
        ...employee(),
        providerRole: "admin"
      }).success
    ).toBe(false);

    const scopes = [
      { type: "tenant", tenantId },
      { type: "org_unit", tenantId, orgUnit: orgUnit(), mode: "subtree" },
      { type: "team", tenantId, team: team() },
      { type: "queue", tenantId, queue: queue() },
      { type: "client", tenantId, client: client() },
      { type: "conversation", tenantId, conversation: conversation() },
      { type: "work_item", tenantId, workItem: workItem() },
      { type: "source_account", tenantId, sourceAccount: sourceAccount() },
      { type: "responsible", tenantId },
      { type: "collaborator", tenantId },
      { type: "internal_participant", tenantId },
      { type: "client_owner", tenantId }
    ];
    for (const scope of scopes) {
      expect(
        inboxV2AuthorizationScopeReferenceSchema.safeParse(scope).success
      ).toBe(true);
    }
    expect(
      inboxV2AuthorizationScopeReferenceSchema.safeParse({
        type: "team",
        tenantId,
        team: team(otherTenantId)
      }).success
    ).toBe(false);
    expect(
      inboxV2AuthorizationScopeReferenceSchema.safeParse({
        type: "provider_chat",
        tenantId,
        id: "provider:chat-1"
      }).success
    ).toBe(false);

    for (const resource of [
      sourceAccount(),
      conversation(),
      client(),
      workItem()
    ]) {
      expect(
        inboxV2AuthorizationResourceReferenceSchema.safeParse(resource).success
      ).toBe(true);
    }
    expect(
      inboxV2AuthorizationResourceReferenceSchema.safeParse({
        tenantId,
        kind: "message",
        id: "message:message-1"
      }).success
    ).toBe(false);
  });

  it("binds immutable role snapshots to one stable role and canonical catalog set", () => {
    const snapshot = roleSnapshot();
    expect(
      inboxV2RolePermissionSnapshotSchema.safeParse(snapshot).success
    ).toBe(true);
    expect(
      inboxV2RolePermissionSnapshotSchema.safeParse({
        ...snapshot,
        permissionIds: [...snapshot.permissionIds].reverse()
      }).success
    ).toBe(false);
    expect(
      inboxV2RolePermissionSnapshotSchema.safeParse({
        ...snapshot,
        permissionIds: [snapshot.permissionIds[0], snapshot.permissionIds[0]]
      }).success
    ).toBe(false);
    expect(
      inboxV2RolePermissionSnapshotSchema.safeParse({
        ...snapshot,
        role: role(otherTenantId)
      }).success
    ).toBe(false);

    expect(
      decideInboxV2RolePermissionSnapshotWrite({
        incoming: snapshot,
        existing: null
      })
    ).toEqual({ kind: "insert" });
    expect(
      decideInboxV2RolePermissionSnapshotWrite({
        incoming: snapshot,
        existing: snapshot
      })
    ).toEqual({ kind: "duplicate" });
    expect(
      decideInboxV2RolePermissionSnapshotWrite({
        incoming: { ...snapshot, snapshotHash: hashB },
        existing: snapshot
      })
    ).toEqual({
      kind: "conflict",
      errorCode: "authorization.role_snapshot_conflict"
    });
  });
});

describe("Inbox V2 temporal authorization relations", () => {
  it("accepts the five temporal relation families and rejects cross-tenant/provider edges", () => {
    for (const [schema, value] of [
      [inboxV2TemporalRoleBindingSchema, roleBinding()],
      [inboxV2TemporalDirectGrantSchema, directGrant()],
      [inboxV2TemporalWorkforceMembershipSchema, workforceMembership()],
      [inboxV2TemporalStructuralAccessBindingSchema, structuralBinding()],
      [inboxV2TemporalCollaboratorSchema, collaborator()]
    ] as const) {
      expect(schema.safeParse(value).success).toBe(true);
    }

    expect(
      inboxV2TemporalDirectGrantSchema.safeParse({
        ...directGrant(),
        employee: employee(undefined, otherTenantId)
      }).success
    ).toBe(false);
    expect(
      inboxV2TemporalWorkforceMembershipSchema.safeParse({
        ...workforceMembership(),
        container: {
          tenantId,
          kind: "provider_roster",
          id: "provider:roster-1"
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2TemporalCollaboratorSchema.safeParse({
        ...collaborator(),
        resource: { tenantId, kind: "external_thread", id: "thread:remote-1" }
      }).success
    ).toBe(false);
    expect(
      inboxV2TemporalCollaboratorSchema.safeParse({
        ...collaborator(),
        resource: workItem()
      }).success
    ).toBe(false);
    expect(
      inboxV2TemporalCollaboratorSchema.safeParse({
        ...collaborator(),
        resource: { ...conversation(), workItemCycle: "0" }
      }).success
    ).toBe(false);
  });

  it("enforces positive intervals, in-interval revocation and SourceAccount org ownership", () => {
    expect(
      inboxV2TemporalRoleBindingSchema.safeParse({
        ...roleBinding(),
        validUntil: committedAt
      }).success
    ).toBe(false);
    expect(
      inboxV2TemporalRoleBindingSchema.safeParse({
        ...roleBinding(),
        revocation: {
          revokedAt: committedAt,
          revokedBy: principal(),
          reasonId: "core:role-revoked"
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2TemporalRoleBindingSchema.safeParse({
        ...roleBinding(),
        revocation: {
          revokedAt: "2026-07-15T12:00:00.000Z",
          revokedBy: principal(),
          reasonId: "core:role-revoked"
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2TemporalStructuralAccessBindingSchema.safeParse(
        structuralBinding(sourceAccount(), team())
      ).success
    ).toBe(false);
    expect(
      inboxV2TemporalStructuralAccessBindingSchema.safeParse(
        structuralBinding(sourceAccount(), orgUnit())
      ).success
    ).toBe(true);
  });
});

describe("Inbox V2 bounded authorization revision delta", () => {
  it("uses entity-style authorization clocks with a persisted baseline of one", () => {
    expect(
      inboxV2AuthorizationClockAdvanceSchema.safeParse({
        previous: "0",
        resulting: "1"
      }).success
    ).toBe(false);
    expect(
      inboxV2AuthorizationClockAdvanceSchema.safeParse({
        previous: "1",
        resulting: "2"
      }).success
    ).toBe(true);
  });

  it("advances exact clocks once and keeps broad role changes fan-out free", () => {
    const roleDelta = revisionDelta();
    expect(
      inboxV2AuthorizationRevisionDeltaSchema.safeParse(roleDelta).success
    ).toBe(true);
    expect(
      inboxV2AuthorizationRevisionDeltaSchema.safeParse({
        ...roleDelta,
        sharedAccessRevision: { previous: "4", resulting: "5" }
      }).success
    ).toBe(false);
    expect(
      inboxV2AuthorizationRevisionDeltaSchema.safeParse({
        ...roleDelta,
        employeeAccessRevisions: [employeeAdvance()]
      }).success
    ).toBe(false);
    expect(
      inboxV2AuthorizationRevisionDeltaSchema.safeParse({
        ...roleDelta,
        tenantRbacRevision: { previous: "7", resulting: "9" }
      }).success
    ).toBe(false);
  });

  it("requires canonical bounded recipients/resources and structural zero-recipient fanout", () => {
    const direct = {
      tenantId,
      kind: "direct_inbox_relation" as const,
      tenantRbacRevision: null,
      sharedAccessRevision: null,
      employeeAccessRevisions: [],
      employeeInboxRelationRevisions: [
        employeeAdvance("employee:employee-1"),
        employeeAdvance("employee:employee-2")
      ],
      resourceAccessRevisions: []
    };
    expect(
      inboxV2AuthorizationRevisionDeltaSchema.safeParse(direct).success
    ).toBe(true);
    expect(
      inboxV2AuthorizationRevisionDeltaSchema.safeParse({
        ...direct,
        employeeInboxRelationRevisions: [
          employeeAdvance("employee:employee-2"),
          employeeAdvance("employee:employee-1")
        ]
      }).success
    ).toBe(false);

    const structural = {
      tenantId,
      kind: "structural_resource_access" as const,
      tenantRbacRevision: null,
      sharedAccessRevision: { previous: "2", resulting: "3" },
      employeeAccessRevisions: [],
      employeeInboxRelationRevisions: [],
      resourceAccessRevisions: [
        { resource: conversation(), advance: { previous: "3", resulting: "4" } }
      ]
    };
    expect(
      inboxV2AuthorizationRevisionDeltaSchema.safeParse(structural).success
    ).toBe(true);
    expect(
      inboxV2AuthorizationRevisionDeltaSchema.safeParse({
        ...structural,
        employeeInboxRelationRevisions: [employeeAdvance()]
      }).success
    ).toBe(false);
    expect(
      inboxV2AuthorizationRevisionDeltaSchema.safeParse({
        ...direct,
        employeeInboxRelationRevisions: Array.from(
          { length: 1_001 },
          (_, index) =>
            employeeAdvance(
              `employee:employee-${String(index).padStart(4, "0")}`
            )
        )
      }).success
    ).toBe(false);
    expect(
      inboxV2AuthorizationRevisionDeltaSchema.safeParse({
        tenantId,
        kind: "employee_access",
        tenantRbacRevision: null,
        sharedAccessRevision: null,
        employeeAccessRevisions: Array.from({ length: 65 }, (_, index) =>
          employeeAdvance(`employee:employee-${String(index).padStart(4, "0")}`)
        ),
        employeeInboxRelationRevisions: [],
        resourceAccessRevisions: []
      }).success
    ).toBe(false);
    expect(
      inboxV2AuthorizationRevisionDeltaSchema.safeParse({
        ...structural,
        resourceAccessRevisions: Array.from({ length: 257 }, (_, index) => ({
          resource: {
            ...conversation(),
            id: `conversation:conversation-${String(index).padStart(4, "0")}`
          },
          advance: { previous: "3", resulting: "4" }
        }))
      }).success
    ).toBe(false);
  });
});

function employeeAdvance(id = "employee:employee-1") {
  return { employee: employee(id), advance: { previous: "5", resulting: "6" } };
}

function revisionDelta() {
  return {
    tenantId,
    kind: "role_definition_or_binding" as const,
    tenantRbacRevision: { previous: "7", resulting: "8" },
    sharedAccessRevision: null,
    employeeAccessRevisions: [],
    employeeInboxRelationRevisions: [],
    resourceAccessRevisions: []
  };
}

function authorizationDecision() {
  return {
    tenantId,
    id: "authorization-decision:decision-1",
    authorizationEpoch: "authorization:epoch-1",
    principal: principal(),
    permissionId: "core:roles.define",
    resourceScopeId: "core:permission-scope.tenant",
    resource: { tenantId, entityTypeId: "core:role", entityId: "role:role-1" },
    resourceAccessRevision: "1",
    decisionRevision: "1",
    decisionHash: hashA,
    outcome: "allowed" as const,
    decidedAt: committedAt,
    notAfter: "2026-07-15T10:00:00.000Z"
  };
}

function request() {
  return {
    tenantId,
    requestId: "request:request-1",
    clientMutationId: "mutation:mutation-1",
    commandTypeId: "core:authorization.role_definition",
    requestHash: hashA
  };
}

function payloadReference(recordId: string) {
  return {
    tenantId,
    recordId,
    schemaId: "core:inbox-v2.role-head",
    schemaVersion: "v1",
    digest: hashA
  };
}

function atomicCommit(): z.input<typeof inboxV2AtomicMutationCommitSchema> {
  const decision = authorizationDecision();
  const commitReference = {
    tenantId,
    streamEpoch: "stream:epoch-1",
    commitId: "commit:commit-1",
    streamPosition: "1"
  };
  const change = {
    reference: {
      tenantId,
      commitId: "commit:commit-1",
      streamPosition: "1",
      changeId: "change:change-1",
      ordinal: "1"
    },
    entity: { tenantId, entityTypeId: "core:role", entityId: "role:role-1" },
    resultingRevision: "1",
    timeline: null,
    audience: "workforce_metadata" as const,
    state: {
      kind: "upsert" as const,
      stateSchemaId: "core:inbox-v2.role-head",
      stateSchemaVersion: "v1",
      stateHash: hashA,
      payloadReference: payloadReference("role-head:role-1"),
      domainCommitReference: payloadReference("domain-commit:role-1")
    }
  };
  const event = {
    tenantId,
    id: "event:event-1",
    typeId: "core:authorization.changed" as const,
    payloadSchemaId: "core:inbox-v2.authorization-change",
    payloadSchemaVersion: "v1",
    commit: commitReference,
    ordinal: "1",
    changeIds: [change.reference.changeId],
    subjects: [change.entity],
    payloadReference: null,
    correlationId: "correlation:correlation-1",
    commandIds: ["command:command-1"],
    clientMutationIds: ["mutation:mutation-1"],
    authorizationDecisionRefs: [decision],
    accessEffect: {
      kind: "may_change_access" as const,
      causes: ["rbac_or_direct_grant" as const]
    },
    occurredAt: committedAt,
    recordedAt: committedAt,
    eventHash: hashA
  };
  const outbox = {
    tenantId,
    id: "outbox-intent:projection-1",
    typeId: "core:projection.update" as const,
    handlerId: "core:authorization-projection",
    effectClass: "projection" as const,
    commit: commitReference,
    eventId: event.id,
    changeIds: [change.reference.changeId],
    payloadReference: null,
    consumerDedupeKey: hashB,
    correlationId: event.correlationId,
    availableAt: committedAt,
    intentHash: hashB
  };
  const result = {
    tenantId,
    commandId: "command:command-1",
    principal: principal(),
    clientMutationId: request().clientMutationId,
    requestHash: request().requestHash,
    authorizationEpoch: decision.authorizationEpoch,
    recordedAt: committedAt,
    kind: "committed" as const,
    commit: commitReference,
    resultReference: null
  };
  return {
    headBefore: {
      tenantId,
      streamEpoch: commitReference.streamEpoch,
      lastPosition: "0",
      minRetainedPosition: "0"
    },
    commit: {
      tenantId,
      streamEpoch: commitReference.streamEpoch,
      id: commitReference.commitId,
      position: commitReference.streamPosition,
      schemaVersion: "v1",
      correlationId: event.correlationId,
      commandIds: [result.commandId],
      clientMutationIds: [result.clientMutationId],
      authorizationDecisionRefs: [decision],
      changeIds: [change.reference.changeId],
      eventIds: [event.id],
      outboxIntentIds: [outbox.id],
      audienceImpact: {
        kind: "tenant_rbac" as const,
        impactId: "audience-impact:tenant-rbac-1",
        deliveryFence: "invalidate_before_payload" as const,
        previousTenantRbacRevision: "7",
        resultingTenantRbacRevision: "8",
        invalidations: [
          { kind: "projection" as const, projectionId: "core:authorization" }
        ],
        indexedFanoutPlanId: "audience-impact:tenant-rbac-plan-1"
      },
      committedAt,
      commitHash: hashA
    },
    changes: [change],
    events: [event],
    outboxIntents: [outbox],
    commandRecords: [
      {
        scope: {
          tenantId,
          principal: principal(),
          commandTypeId: request().commandTypeId,
          clientMutationId: request().clientMutationId
        },
        commandId: result.commandId,
        firstRequestId: request().requestId,
        requestHash: request().requestHash,
        state: {
          kind: "completed" as const,
          result,
          authorizationDecisionRefs: [decision],
          authorizedAt: committedAt,
          authorizationNotAfter: decision.notAfter
        }
      }
    ],
    headAfter: {
      tenantId,
      streamEpoch: commitReference.streamEpoch,
      lastPosition: commitReference.streamPosition,
      minRetainedPosition: "0"
    }
  };
}

function successfulAudit() {
  return {
    tenantId,
    auditId: "authorization-audit:audit-1",
    category: "privileged_security" as const,
    actionId: request().commandTypeId,
    actor: principal(),
    target: { tenantId, entityTypeId: "core:role", entityId: internalRoleId },
    facets: [
      {
        tenantId,
        dimension: "tenant" as const,
        target: {
          tenantId,
          entityTypeId: "core:tenant",
          entityId: internalTenantId
        },
        relation: "affected" as const,
        facetHash: hashA
      }
    ],
    authorizationDecisionRefs: [authorizationDecision()],
    revisionDeltaHash: hashA,
    reasonId: "core:role-definition-changed",
    request: request(),
    commandId: "command:command-1",
    correlationId: "correlation:correlation-1",
    outcome: "succeeded" as const,
    occurredAt: committedAt,
    recordedAt: committedAt,
    expiresAt: "2027-07-15T09:00:00.000Z",
    previousAuditHash: null,
    auditHash: hashA
  };
}

function persistenceRecords() {
  return {
    tenantId,
    rolePermissionSnapshots: [
      { ...roleSnapshot(), permissionIds: ["core:roles.define"] }
    ],
    roleBindings: [],
    directGrants: [],
    workforceMemberships: [],
    structuralBindings: [],
    collaborators: [],
    reusedRelationTransitions: []
  };
}

function privilegedMutation(): z.input<
  typeof inboxV2PrivilegedAuthorizationMutationSchema
> {
  return {
    tenantId,
    kind: "role_definition",
    command: {
      tenantId,
      commandId: "command:command-1",
      request: request(),
      principal: principal(),
      authorizationEpoch: "authorization:epoch-1",
      authorizationDecisionRefs: [authorizationDecision()],
      authorizedAt: committedAt
    },
    records: persistenceRecords(),
    revisionDelta: revisionDelta(),
    audit: successfulAudit(),
    atomicCommit: atomicCommit()
  };
}

function directAudienceImpact() {
  return {
    kind: "direct" as const,
    impactId: "audience-impact:direct-1",
    deliveryFence: "invalidate_before_payload" as const,
    affectedRecipients: [
      {
        employee: employee(),
        relation: "resulting" as const,
        previousAuthorizationEpoch: "authorization:epoch-0",
        resultingAuthorizationEpoch: "authorization:epoch-1",
        invalidations: [{ kind: "recipient_scope" as const }],
        authorizationDecisionRefs: [authorizationDecision()]
      }
    ]
  };
}

function targetBoundMutation(
  kind:
    | "direct_grant"
    | "workforce_membership"
    | "collaborator"
    | "structural_binding"
): z.input<typeof inboxV2PrivilegedAuthorizationMutationSchema> {
  const mutation = privilegedMutation();
  mutation.kind = kind;
  mutation.records.rolePermissionSnapshots = [];

  if (kind === "direct_grant") {
    mutation.records.directGrants = [directGrant()];
    mutation.revisionDelta = {
      tenantId,
      kind: "employee_access",
      tenantRbacRevision: null,
      sharedAccessRevision: null,
      employeeAccessRevisions: [employeeAdvance()],
      employeeInboxRelationRevisions: [],
      resourceAccessRevisions: []
    };
    mutation.atomicCommit.commit.audienceImpact = directAudienceImpact();
  } else if (kind === "workforce_membership") {
    mutation.records.workforceMemberships = [workforceMembership()];
    mutation.revisionDelta = {
      tenantId,
      kind: "employee_access",
      tenantRbacRevision: null,
      sharedAccessRevision: null,
      employeeAccessRevisions: [employeeAdvance()],
      employeeInboxRelationRevisions: [],
      resourceAccessRevisions: []
    };
    mutation.atomicCommit.commit.audienceImpact = directAudienceImpact();
  } else if (kind === "collaborator") {
    mutation.records.collaborators = [collaborator()];
    mutation.revisionDelta = {
      tenantId,
      kind: "direct_inbox_relation",
      tenantRbacRevision: null,
      sharedAccessRevision: null,
      employeeAccessRevisions: [],
      employeeInboxRelationRevisions: [employeeAdvance()],
      resourceAccessRevisions: []
    };
    mutation.atomicCommit.commit.audienceImpact = directAudienceImpact();
  } else {
    mutation.records.structuralBindings = [structuralBinding()];
    mutation.revisionDelta = {
      tenantId,
      kind: "structural_resource_access",
      tenantRbacRevision: null,
      sharedAccessRevision: { previous: "2", resulting: "3" },
      employeeAccessRevisions: [],
      employeeInboxRelationRevisions: [],
      resourceAccessRevisions: [
        {
          resource: conversation(),
          advance: { previous: "3", resulting: "4" }
        }
      ]
    };
    mutation.atomicCommit.commit.audienceImpact = {
      kind: "structural",
      impactId: "audience-impact:structural-1",
      deliveryFence: "invalidate_before_payload",
      previousSharedAccessRevision: "2",
      resultingSharedAccessRevision: "3",
      invalidations: [
        { kind: "projection", projectionId: "core:authorization" }
      ],
      indexedFanoutPlanId: "audience-impact:structural-plan-1"
    };
  }
  return mutation;
}

describe("Inbox V2 successful privileged authorization commit", () => {
  it("models tenant-RBAC invalidation as one +1 tenant clock with zero Employee fanout", () => {
    const impact = atomicCommit().commit.audienceImpact;
    expect(
      inboxV2TenantRbacAudienceImpactSchema.safeParse(impact).success
    ).toBe(true);
    expect(
      inboxV2TenantRbacAudienceImpactSchema.safeParse({
        ...impact,
        resultingTenantRbacRevision: "9"
      }).success
    ).toBe(false);
    expect(
      inboxV2TenantRbacAudienceImpactSchema.safeParse({
        ...impact,
        affectedRecipients: [employee()]
      }).success
    ).toBe(false);

    const crossTenant = atomicCommit();
    if (crossTenant.commit.audienceImpact.kind === "tenant_rbac") {
      crossTenant.commit.audienceImpact.invalidations = [
        {
          kind: "entity",
          entity: {
            tenantId: otherTenantId,
            entityTypeId: "core:role",
            entityId: "role:role-1"
          }
        }
      ];
    }
    expect(
      inboxV2AtomicMutationCommitSchema.safeParse(crossTenant).success
    ).toBe(false);
  });

  it("ties records, +1 revisions, minimized audit, command/idempotency and stream effects", () => {
    const mutation = privilegedMutation();
    expect(
      inboxV2SuccessfulAuthorizationAuditSchema.safeParse(mutation.audit)
        .success
    ).toBe(true);
    expect(
      inboxV2PrivilegedAuthorizationMutationSchema.safeParse(mutation).success
    ).toBe(true);
    expect(
      inboxV2PrivilegedAuthorizationMutationEnvelopeSchema.safeParse({
        schemaId: INBOX_V2_PRIVILEGED_AUTHORIZATION_MUTATION_SCHEMA_ID,
        schemaVersion: "v1",
        payload: mutation
      }).success
    ).toBe(true);
  });

  it("fails closed on tenant drift, idempotency drift, missing audit/event/outbox or wrong fanout", () => {
    const tenantDrift = privilegedMutation();
    tenantDrift.records.rolePermissionSnapshots[0]!.role.tenantId =
      otherTenantId;
    expect(
      inboxV2PrivilegedAuthorizationMutationSchema.safeParse(tenantDrift)
        .success
    ).toBe(false);

    const idempotencyDrift = privilegedMutation();
    const record = idempotencyDrift.atomicCommit.commandRecords[0]!;
    record.requestHash = hashB;
    if (record.state.kind === "completed") {
      record.state.result.requestHash = hashB;
    }
    expect(
      inboxV2PrivilegedAuthorizationMutationSchema.safeParse(idempotencyDrift)
        .success
    ).toBe(false);

    const principalDrift = privilegedMutation();
    principalDrift.command.authorizationDecisionRefs[0]!.principal = {
      kind: "employee",
      employee: employee("employee:employee-2")
    };
    expect(
      inboxV2PrivilegedAuthorizationMutationSchema.safeParse(principalDrift)
        .success
    ).toBe(false);

    const missingEvent = privilegedMutation();
    missingEvent.atomicCommit.events[0]!.typeId = "core:command.committed";
    missingEvent.atomicCommit.events[0]!.accessEffect = { kind: "none" };
    expect(
      inboxV2PrivilegedAuthorizationMutationSchema.safeParse(missingEvent)
        .success
    ).toBe(false);

    const missingOutbox = privilegedMutation();
    missingOutbox.atomicCommit.commit.outboxIntentIds = [];
    missingOutbox.atomicCommit.outboxIntents = [];
    expect(
      inboxV2PrivilegedAuthorizationMutationSchema.safeParse(missingOutbox)
        .success
    ).toBe(false);

    const employeeFanout = privilegedMutation();
    employeeFanout.revisionDelta.employeeAccessRevisions = [employeeAdvance()];
    expect(
      inboxV2PrivilegedAuthorizationMutationSchema.safeParse(employeeFanout)
        .success
    ).toBe(false);
  });

  it("persists only minimized successful audit facets and exact reused relation refs", () => {
    expect(
      inboxV2SuccessfulAuthorizationAuditSchema.safeParse({
        ...successfulAudit(),
        outcome: "denied"
      }).success
    ).toBe(false);
    expect(
      inboxV2SuccessfulAuthorizationAuditSchema.safeParse({
        ...successfulAudit(),
        rawPhone: "+79990000000"
      }).success
    ).toBe(false);
    expect(
      inboxV2SuccessfulAuthorizationAuditSchema.safeParse({
        ...successfulAudit(),
        target: {
          tenantId,
          entityTypeId: "module:telegram:chat",
          entityId: "provider-chat:123"
        }
      }).success
    ).toBe(false);

    const mismatchedFacet = successfulAudit();
    mismatchedFacet.facets[0]!.target.entityTypeId = "core:conversation";
    expect(
      inboxV2SuccessfulAuthorizationAuditSchema.safeParse(mismatchedFacet)
        .success
    ).toBe(false);

    const reused = {
      ...persistenceRecords(),
      rolePermissionSnapshots: [],
      reusedRelationTransitions: [
        {
          kind: "internal_membership" as const,
          transition: {
            tenantId,
            kind: "participant_membership_transition" as const,
            id: "participant_membership_transition:transition-1"
          }
        },
        {
          kind: "servicing_team" as const,
          transition: {
            tenantId,
            kind: "work_item_relation_transition" as const,
            id: "work_item_relation_transition:transition-1"
          }
        }
      ]
    };
    expect(
      inboxV2AuthorizationPersistencePayloadSchema.safeParse(reused).success
    ).toBe(true);
    reused.reusedRelationTransitions[0]!.transition.tenantId = otherTenantId;
    expect(
      inboxV2AuthorizationPersistencePayloadSchema.safeParse(reused).success
    ).toBe(false);
  });

  it("binds direct, workforce, collaborator and structural clocks to persisted targets", () => {
    for (const kind of [
      "direct_grant",
      "workforce_membership",
      "collaborator",
      "structural_binding"
    ] as const) {
      const mutation = targetBoundMutation(kind);
      expect(
        inboxV2PrivilegedAuthorizationMutationSchema.safeParse(mutation).success
      ).toBe(true);

      if (kind === "direct_grant") {
        mutation.records.directGrants[0]!.employee = employee(
          "employee:employee-2"
        );
      } else if (kind === "workforce_membership") {
        mutation.records.workforceMemberships[0]!.employee = employee(
          "employee:employee-2"
        );
      } else if (kind === "collaborator") {
        mutation.records.collaborators[0]!.employee = employee(
          "employee:employee-2"
        );
      } else {
        mutation.records.structuralBindings[0]!.resource = client();
      }
      expect(
        inboxV2PrivilegedAuthorizationMutationSchema.safeParse(mutation).success
      ).toBe(false);
    }
  });

  it("keeps every persisted JSON schema closed", () => {
    for (const schema of [
      inboxV2PersistedRoleReferenceSchema,
      inboxV2RoleBindingSubjectReferenceSchema,
      inboxV2AuthorizationScopeReferenceSchema,
      inboxV2AuthorizationResourceReferenceSchema,
      inboxV2StructuralAccessTargetReferenceSchema,
      inboxV2CollaboratorResourceReferenceSchema,
      inboxV2WorkforceMembershipContainerReferenceSchema,
      inboxV2PermissionCatalogAuthoritySchema,
      inboxV2RolePermissionSnapshotSchema,
      inboxV2TemporalRoleBindingSchema,
      inboxV2TemporalDirectGrantSchema,
      inboxV2TemporalWorkforceMembershipSchema,
      inboxV2TemporalStructuralAccessBindingSchema,
      inboxV2TemporalCollaboratorSchema,
      inboxV2AuthorizationRevisionDeltaSchema,
      inboxV2SuccessfulAuthorizationAuditFacetSchema,
      inboxV2SuccessfulAuthorizationAuditSchema,
      inboxV2AuthorizationPersistencePayloadSchema,
      inboxV2PrivilegedAuthorizationMutationSchema
    ]) {
      expect(() => assertInboxV2ClosedJsonSchema(schema)).not.toThrow();
    }
  });
});
