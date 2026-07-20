import {
  INBOX_V2_CONVERSATION_CLIENT_LINK_SCHEMA_ID,
  INBOX_V2_CONVERSATION_SCHEMA_ID,
  INBOX_V2_EXTERNAL_THREAD_SCHEMA_ID,
  INBOX_V2_OUTBOUND_ROUTE_SCHEMA_ID,
  INBOX_V2_SOURCE_EXTERNAL_IDENTITY_SCHEMA_ID,
  INBOX_V2_SOURCE_IDENTITY_CLAIM_SCHEMA_ID,
  INBOX_V2_SOURCE_THREAD_BINDING_SCHEMA_ID,
  INBOX_V2_STAFF_NOTE_SCHEMA_ID,
  INBOX_V2_WORK_ITEM_SCHEMA_ID,
  calculateInboxV2MessageContentDigest,
  inboxV2AuthorizationDependencyVectorSchema,
  inboxV2AuthorizationEpochSchema,
  inboxV2AuthorizationEpochSnapshotSchema,
  inboxV2ConversationIdSchema,
  inboxV2ConversationClientLinkSchema,
  inboxV2ConversationParticipantSchema,
  inboxV2ConversationSchema,
  inboxV2EmployeeIdSchema,
  inboxV2EmployeeReferenceSchema,
  inboxV2EntityKeySchema,
  inboxV2EntityRevisionSchema,
  inboxV2MessageSchema,
  inboxV2ExternalThreadSchema,
  inboxV2OutboundRouteSchema,
  inboxV2SourceExternalIdentitySchema,
  inboxV2SourceAccountIdSchema,
  inboxV2SourceIdentityClaimSchema,
  inboxV2SourceThreadBindingSchema,
  inboxV2StaffNoteSchema,
  inboxV2TenantIdSchema,
  inboxV2TimelineContentHeadOf,
  inboxV2TimelineContentSchema,
  inboxV2WorkItemIdSchema,
  inboxV2WorkItemSchema,
  inboxV2WorkQueueIdSchema,
  type InboxV2AuthorizationDependencyVector,
  type InboxV2EntityKey
} from "@hulee/contracts";
import {
  getInboxV2PermissionDefinition,
  type InboxV2AuthorizationPlanInput,
  type InboxV2AuthorizationRequirement,
  type InboxV2CanonicalScopeFact,
  type InboxV2PermissionId,
  type InboxV2PermissionScope,
  type InboxV2PolicyGrant,
  type InboxV2PolicyGuardEvidence
} from "@hulee/core";
import { z } from "zod";

export const inboxV2ScenarioNow = "2026-07-13T09:00:00.000Z";
export const inboxV2ScenarioLater = "2026-07-13T09:30:00.000Z";
export const inboxV2ScenarioNotAfter = "2026-07-13T12:00:00.000Z";

function scenarioAdapterContract() {
  return {
    contractId: "module:hulee-testing:direct-account-adapter",
    contractVersion: "v1",
    declarationRevision: "1",
    surfaceId: "module:hulee-testing:direct-account",
    loadedByTrustedServiceId: "core:source-runtime",
    loadedAt: inboxV2ScenarioNow
  } as const;
}

export const inboxV2ScenarioStateSchema = z
  .object({
    tenantId: z.string(),
    kind: z.enum([
      "external_thread",
      "internal_direct",
      "internal_group",
      "work_assignment",
      "privacy_decision"
    ]),
    conversationId: z.string().nullable(),
    clientIds: z.array(z.string()),
    participantIds: z.array(z.string()),
    employeeAnchorIds: z.array(z.string()),
    ownerEmployeeIds: z.array(z.string()),
    workItemId: z.string().nullable(),
    primaryResponsibleEmployeeId: z.string().nullable(),
    groupBindingId: z.string().nullable(),
    senderPrivateIdentityId: z.string().nullable(),
    physicalMessageIds: z.array(z.string()),
    action: z.string().nullable(),
    status: z.string(),
    revision: z.string()
  })
  .strict()
  .superRefine((state, context) => {
    if (
      state.kind === "internal_direct" &&
      (state.employeeAnchorIds.length !== 2 ||
        new Set(state.employeeAnchorIds).size !== 2 ||
        state.clientIds.length !== 0 ||
        state.workItemId !== null ||
        state.primaryResponsibleEmployeeId !== null ||
        state.groupBindingId !== null)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Internal direct requires two distinct Employee anchors and no Client, WorkItem or provider binding."
      });
    }
    if (
      state.kind === "internal_group" &&
      state.status === "active" &&
      state.ownerEmployeeIds.length === 0
    ) {
      context.addIssue({
        code: "custom",
        message: "An active internal group requires an owner."
      });
    }
    if (
      state.primaryResponsibleEmployeeId !== null &&
      state.workItemId === null
    ) {
      context.addIssue({
        code: "custom",
        message: "Responsibility belongs to a WorkItem, not a Conversation."
      });
    }
  });

export type InboxV2ScenarioState = z.infer<typeof inboxV2ScenarioStateSchema>;

type InboxV2CanonicalScenarioGuard = Extract<
  InboxV2PolicyGuardEvidence,
  { profileId: "core:rbac.guard.canonical_resource" }
>;

export function inboxV2ScenarioEntity(
  tenantId: string,
  entityTypeId: string,
  entityId: string
) {
  return inboxV2EntityKeySchema.parse({ tenantId, entityTypeId, entityId });
}

export function inboxV2ScenarioConversation(input: {
  tenantId: string;
  id?: string;
  topology?: "direct" | "group" | "case" | "object";
  transport?: "internal" | "external";
  revision?: string;
  updatedAt?: string;
}) {
  return inboxV2ConversationSchema.parse({
    tenantId: input.tenantId,
    id: input.id ?? "conversation:scenario-1",
    topology: input.topology ?? "direct",
    transport: input.transport ?? "external",
    purposeId: "core:chat",
    lifecycle: "active",
    head: {
      latestTimelineSequence: "0",
      latestActivityItemId: null,
      latestActivityTimelineSequence: null,
      latestActivityAt: null,
      revision: "1",
      createdAt: inboxV2ScenarioNow,
      updatedAt: inboxV2ScenarioNow
    },
    revision: input.revision ?? "1",
    createdAt: inboxV2ScenarioNow,
    updatedAt: input.updatedAt ?? inboxV2ScenarioNow
  });
}

export function inboxV2ScenarioExternalThread(input: {
  tenantId: string;
  conversationId: string;
  id: string;
  sourceAccountId: string;
  topology?: "direct" | "group";
  canonicalExternalSubject?: string;
}) {
  const adapterContract = scenarioAdapterContract();
  const topology = input.topology ?? "direct";
  const realm = {
    realmId: "module:hulee-testing:thread-realm",
    realmVersion: "v1",
    canonicalizationVersion: "v1"
  } as const;
  const scope = {
    kind: "source_account" as const,
    owner: {
      tenantId: input.tenantId,
      kind: "source_account" as const,
      id: input.sourceAccountId
    }
  };
  return inboxV2ExternalThreadSchema.parse({
    tenantId: input.tenantId,
    id: input.id,
    key: {
      realm,
      scope,
      objectKindId:
        topology === "group"
          ? "module:hulee-testing:group-room"
          : "module:hulee-testing:direct-room",
      canonicalExternalSubject:
        input.canonicalExternalSubject ?? `Thread-${input.id.split(":").at(-1)}`
    },
    identityDeclaration: {
      adapterContract,
      identityKind: "external_thread",
      realmId: realm.realmId,
      realmVersion: realm.realmVersion,
      canonicalizationVersion: realm.canonicalizationVersion,
      objectKindId:
        topology === "group"
          ? "module:hulee-testing:group-room"
          : "module:hulee-testing:direct-room",
      scopeKind: scope.kind,
      decisionStrength: "safe_default"
    },
    conversation: {
      tenantId: input.tenantId,
      kind: "conversation",
      id: input.conversationId
    },
    conversationTopology: topology,
    revision: "1",
    createdAt: inboxV2ScenarioNow,
    updatedAt: inboxV2ScenarioNow
  });
}

export function inboxV2ScenarioSourceThreadBinding(input: {
  tenantId: string;
  id: string;
  externalThreadId: string;
  sourceAccountId: string;
  sourceConnectionId?: string;
}) {
  const adapterContract = scenarioAdapterContract();
  const sourceConnection = {
    tenantId: input.tenantId,
    kind: "source_connection" as const,
    id: input.sourceConnectionId ?? "source_connection:scenario-1"
  };
  const sourceAccount = {
    tenantId: input.tenantId,
    kind: "source_account" as const,
    id: input.sourceAccountId
  };
  const evidence = {
    tenantId: input.tenantId,
    kind: "raw_inbound_event" as const,
    id: `raw_inbound_event:${input.id.split(":").at(-1)}-binding`
  };
  const routeDescriptor = {
    adapterContract,
    descriptorSchemaId: "module:hulee-testing:direct-route",
    descriptorVersion: "v1",
    descriptorRevision: "1",
    destinationKindId: "module:hulee-testing:thread-peer",
    destinationSubject: `Peer-${input.externalThreadId.split(":").at(-1)}`,
    attributes: [],
    descriptorDigestSha256: "c".repeat(64)
  };
  return inboxV2SourceThreadBindingSchema.parse({
    tenantId: input.tenantId,
    id: input.id,
    externalThread: {
      tenantId: input.tenantId,
      kind: "external_thread",
      id: input.externalThreadId
    },
    sourceConnection,
    sourceAccount,
    accountIdentitySnapshot: {
      status: "verified",
      sourceConnection,
      sourceAccount,
      declaration: {
        adapterContract,
        identityKind: "source_account",
        realmId: "module:hulee-testing:account-realm",
        realmVersion: "v1",
        canonicalizationVersion: "v1",
        objectKindId: "module:hulee-testing:direct-account",
        scopeKind: "source_connection",
        decisionStrength: "authoritative"
      },
      realmId: "module:hulee-testing:account-realm",
      canonicalExternalSubject: `Account-${input.sourceAccountId.split(":").at(-1)}`,
      accountGeneration: "1",
      verificationEvidence: [evidence],
      verifiedAt: inboxV2ScenarioNow
    },
    bindingGeneration: "1",
    remoteAccess: {
      state: "active",
      evidenceAuthority: "direct_observation",
      revision: "1",
      since: inboxV2ScenarioNow,
      evidence: [evidence]
    },
    administrative: {
      state: "enabled",
      revision: "1",
      changedAt: inboxV2ScenarioNow
    },
    runtimeHealth: {
      state: "ready",
      revision: "1",
      checkedAt: inboxV2ScenarioNow,
      diagnostic: null
    },
    historySync: {
      state: "live",
      revision: "1",
      receiveCursor: "scenario-receive-cursor-1",
      historyCursor: "scenario-history-cursor-1",
      providerWatermark: "scenario-provider-watermark-1",
      lastDurableRawEvent: evidence,
      updatedAt: inboxV2ScenarioNow,
      diagnostic: null
    },
    providerAccess: {
      revision: "1",
      roleIds: ["module:hulee-testing:provider-member"],
      evidence: [evidence],
      observedAt: inboxV2ScenarioNow
    },
    capabilities: {
      adapterContract,
      revision: "1",
      capturedAt: inboxV2ScenarioNow,
      entries: [
        {
          capabilityId: "core:message-text-send",
          operationId: "core:message.send",
          contentKindId: "core:text",
          state: "supported",
          referencePortability: "external_thread",
          requiredProviderRoleIds: ["module:hulee-testing:provider-member"],
          validUntil: null,
          diagnostic: null,
          evidence: [evidence]
        }
      ]
    },
    routeDescriptor,
    revision: "1",
    createdAt: inboxV2ScenarioNow,
    updatedAt: inboxV2ScenarioNow
  });
}

export function inboxV2ScenarioOutboundRoute(input: {
  tenantId: string;
  id: string;
  conversationId: string;
  externalThreadId: string;
  bindingId: string;
  sourceAccountId: string;
  employeeId: string;
  sourceConnectionId?: string;
  selectedAt?: string;
}) {
  const adapterContract = scenarioAdapterContract();
  const conversation = {
    tenantId: input.tenantId,
    kind: "conversation" as const,
    id: input.conversationId
  };
  const externalThread = {
    tenantId: input.tenantId,
    kind: "external_thread" as const,
    id: input.externalThreadId
  };
  const sourceThreadBinding = {
    tenantId: input.tenantId,
    kind: "source_thread_binding" as const,
    id: input.bindingId
  };
  const sourceAccount = {
    tenantId: input.tenantId,
    kind: "source_account" as const,
    id: input.sourceAccountId
  };
  const sourceConnection = {
    tenantId: input.tenantId,
    kind: "source_connection" as const,
    id: input.sourceConnectionId ?? "source_connection:scenario-1"
  };
  const principal = {
    kind: "employee" as const,
    employee: {
      tenantId: input.tenantId,
      kind: "employee" as const,
      id: input.employeeId
    }
  };
  const bindingFence = {
    accountGeneration: "1",
    bindingGeneration: "1",
    remoteAccessRevision: "1",
    administrativeRevision: "1",
    capabilityRevision: "1",
    routeDescriptorRevision: "1"
  };
  const target = {
    conversation,
    externalThread,
    sourceThreadBinding,
    sourceAccount,
    sourceConnection,
    operationId: "core:message.send",
    contentKindId: "core:text",
    authorizationEpoch: "authorization:scenario-operator-1",
    bindingFence,
    referenceTarget: { kind: "none" as const }
  };
  const decisionBase = {
    tenantId: input.tenantId,
    principal,
    target,
    effect: "allow" as const,
    decisionRevision: "1",
    loadedByTrustedServiceId: "core:authorization-service",
    decidedAt: inboxV2ScenarioNow,
    notAfter: inboxV2ScenarioNotAfter
  };
  const token = input.id.split(":").at(-1);
  return inboxV2OutboundRouteSchema.parse({
    tenantId: input.tenantId,
    id: input.id,
    principal,
    conversation,
    externalThread,
    sourceThreadBinding,
    sourceAccount,
    sourceConnection,
    operationId: target.operationId,
    contentKindId: target.contentKindId,
    authorizationEpoch: target.authorizationEpoch,
    requiredConversationPermissionId: "core:message.reply_external",
    bindingFence,
    adapterContract,
    routeDescriptor: {
      adapterContract,
      descriptorSchemaId: "module:hulee-testing:direct-route",
      descriptorVersion: "v1",
      descriptorRevision: "1",
      destinationKindId: "module:hulee-testing:thread-peer",
      destinationSubject: `Peer-${input.externalThreadId.split(":").at(-1)}`,
      attributes: [],
      descriptorDigestSha256: "c".repeat(64)
    },
    routePolicy: {
      tenantId: input.tenantId,
      kind: "thread_route_policy",
      id: `thread_route_policy:${token}`
    },
    routePolicyRevision: "1",
    conversationAuthorization: {
      ...decisionBase,
      decisionKind: "conversation_action",
      requiredPermissionId: "core:message.reply_external",
      matchedPermissionIds: ["core:message.reply_external"],
      decisionToken: `decision:conversation-${token}`
    },
    sourceAccountAuthorization: {
      ...decisionBase,
      decisionKind: "source_account_use",
      requiredPermissionId: "core:source_account.use",
      matchedPermissionIds: ["core:source_account.use"],
      decisionToken: `decision:source-account-${token}`
    },
    referenceContext: { kind: "none" },
    runtimeObservationAtResolution: {
      state: "ready",
      revision: "1",
      observedAt: inboxV2ScenarioNow,
      diagnostic: null
    },
    selection: {
      intent: { kind: "automatic" },
      reason: "sole_eligible_binding",
      candidateSnapshotToken: `snapshot:${token}`,
      candidateSnapshotNotAfter: inboxV2ScenarioNotAfter,
      fallbackPolicyOrdinal: null,
      selectedAt: input.selectedAt ?? inboxV2ScenarioLater
    },
    mutationToken: `mutation:${token}`,
    idempotencyToken: `idempotency:${token}`,
    correlationToken: `correlation:${token}`,
    revision: "1",
    createdAt: input.selectedAt ?? inboxV2ScenarioLater
  });
}

export function inboxV2ScenarioSourceIdentity(input: {
  tenantId: string;
  id?: string;
  canonicalExternalSubject?: string;
  resolution?:
    | Readonly<{ status: "unresolved" }>
    | Readonly<{
        status: "claimed";
        activeClaim: Readonly<{
          tenantId: string;
          kind: "source_identity_claim";
          id: string;
        }>;
      }>;
  latestClaimVersion?: string | null;
  revision?: string;
  updatedAt?: string;
}) {
  const adapterContract = scenarioAdapterContract();
  const realm = {
    realmId: "module:synthetic:direct-user",
    version: "v1",
    canonicalizationVersion: "v1"
  } as const;
  const objectKindId = "module:hulee-testing:provider-user";

  return inboxV2SourceExternalIdentitySchema.parse({
    tenantId: input.tenantId,
    id: input.id ?? "source_external_identity:scenario-1",
    realm,
    objectKindId,
    scope: { kind: "provider" },
    identityDeclaration: {
      adapterContract,
      identityKind: "source_external_identity",
      realmId: realm.realmId,
      realmVersion: realm.version,
      canonicalizationVersion: realm.canonicalizationVersion,
      objectKindId,
      scopeKind: "provider",
      decisionStrength: "authoritative"
    },
    materializationAuthority: {
      kind: "trusted_service",
      tenantId: input.tenantId,
      trustedServiceId: adapterContract.loadedByTrustedServiceId,
      authorizationToken: "scenario-source-identity-materialization-v1",
      authorizedAt: inboxV2ScenarioNow
    },
    materializedAt: inboxV2ScenarioNow,
    canonicalExternalSubject:
      input.canonicalExternalSubject ??
      `SyntheticUser-${(input.id ?? "source_external_identity:scenario-1").split(":").at(-1)}`,
    stability: { kind: "stable" },
    resolution: input.resolution ?? { status: "unresolved" },
    latestClaimVersion: input.latestClaimVersion ?? null,
    revision: input.revision ?? "1",
    createdAt: inboxV2ScenarioNow,
    updatedAt: input.updatedAt ?? inboxV2ScenarioNow
  });
}

export function inboxV2ScenarioParticipant(input: {
  tenantId: string;
  conversationId: string;
  id: string;
  subject:
    | Readonly<{ kind: "employee"; employeeId: string }>
    | Readonly<{
        kind: "source_external_identity";
        sourceExternalIdentityId: string;
      }>;
}) {
  return inboxV2ConversationParticipantSchema.parse({
    tenantId: input.tenantId,
    id: input.id,
    conversation: {
      tenantId: input.tenantId,
      kind: "conversation",
      id: input.conversationId
    },
    subject:
      input.subject.kind === "employee"
        ? {
            kind: "employee",
            employee: {
              tenantId: input.tenantId,
              kind: "employee",
              id: input.subject.employeeId
            }
          }
        : {
            kind: "source_external_identity",
            sourceExternalIdentity: {
              tenantId: input.tenantId,
              kind: "source_external_identity",
              id: input.subject.sourceExternalIdentityId
            }
          },
    revision: "1",
    createdAt: inboxV2ScenarioNow,
    updatedAt: inboxV2ScenarioNow
  });
}

export function inboxV2ScenarioClientLink(input: {
  tenantId: string;
  conversationId: string;
  clientId: string;
  id: string;
  actorEmployeeId: string;
  roleId?: "core:subject" | "core:related" | "core:primary";
}) {
  return inboxV2ConversationClientLinkSchema.parse({
    tenantId: input.tenantId,
    id: input.id,
    conversation: {
      tenantId: input.tenantId,
      kind: "conversation" as const,
      id: input.conversationId
    },
    client: {
      tenantId: input.tenantId,
      kind: "client" as const,
      id: input.clientId
    },
    roleIds: [input.roleId ?? "core:related"],
    associationConfidence: "confirmed" as const,
    provenance: { kind: "manual" as const },
    auditEvidenceReferences: [],
    linkedBy: {
      actor: {
        kind: "employee" as const,
        employee: {
          tenantId: input.tenantId,
          kind: "employee" as const,
          id: input.actorEmployeeId
        }
      },
      policyId: "core:manual-client-link",
      policyVersion: "v1",
      reasonCodeId: "core:operator-linked-client",
      policyAuthority: null
    },
    validFrom: inboxV2ScenarioNow,
    validFromBasis: "known_effective" as const,
    state: "active" as const,
    termination: null,
    revision: "1"
  });
}

export function inboxV2ScenarioWorkItem(input: {
  tenantId: string;
  conversationId: string;
  id?: string;
  queueId?: string;
  responsibleEmployeeId?: string | null;
  revision?: string;
  updatedAt?: string;
}) {
  const id = input.id ?? "work_item:scenario-1";
  const revision = input.revision ?? "1";
  const responsible = input.responsibleEmployeeId ?? null;
  const queue = {
    tenantId: input.tenantId,
    kind: "work_queue" as const,
    id: input.queueId ?? "work_queue:scenario-default"
  };
  const operationalState =
    responsible === null
      ? {
          state: "new" as const,
          activeQueue: { queue, queueRevision: "1" },
          primaryAssignment: null,
          terminal: null
        }
      : {
          state: "assigned" as const,
          activeQueue: { queue, queueRevision: "1" },
          primaryAssignment: {
            assignment: {
              tenantId: input.tenantId,
              kind: "work_item_primary_assignment" as const,
              id: `work_item_primary_assignment:${id.split(":").at(-1)}-1`
            },
            employee: {
              tenantId: input.tenantId,
              kind: "employee" as const,
              id: responsible
            },
            eligibilityDecision: {
              tenantId: input.tenantId,
              kind: "work_queue_eligibility_decision" as const,
              id: `work_queue_eligibility_decision:${id.split(":").at(-1)}-1`
            },
            employeeFenceGenerationAtStart: "1",
            assignedAt: input.updatedAt ?? inboxV2ScenarioLater,
            assignmentRevision: "1"
          },
          terminal: null
        };
  return inboxV2WorkItemSchema.parse({
    tenantId: input.tenantId,
    id,
    conversation: {
      tenantId: input.tenantId,
      kind: "conversation",
      id: input.conversationId
    },
    ordinal: "1",
    operationalState,
    priorityId: "core:normal",
    sla: { kind: "not_applied", reasonId: "core:no-sla-policy" },
    currentServicingTeam: null,
    servicingTeamRelationRevision: "1",
    collaboratorSetRevision: "1",
    resourceAccessRevision: responsible === null ? "1" : "2",
    reopenCycle: "0",
    lastReopen: null,
    createdBy: {
      kind: "trusted_service",
      trustedServiceId: "core:work-intake"
    },
    creationReasonId: "core:external-actionable-input",
    revision,
    createdAt: inboxV2ScenarioNow,
    updatedAt: input.updatedAt ?? inboxV2ScenarioNow
  });
}

export function inboxV2ScenarioContent(input: {
  tenantId: string;
  id?: string;
  text?: string;
  revision?: string;
  updatedAt?: string;
}) {
  const blocks = [
    {
      blockKey: "body-1",
      kind: "text" as const,
      role: "body" as const,
      text: input.text ?? "Hello",
      language: "en"
    }
  ];
  return inboxV2TimelineContentSchema.parse({
    tenantId: input.tenantId,
    id: input.id ?? "timeline_content:scenario-1",
    state: {
      kind: "available" as const,
      blocks,
      contentDigestSha256: calculateInboxV2MessageContentDigest(blocks)
    },
    revision: input.revision ?? "1",
    createdAt: inboxV2ScenarioNow,
    updatedAt: input.updatedAt ?? inboxV2ScenarioNow
  });
}

export function inboxV2ScenarioMessage(input: {
  tenantId: string;
  conversationId: string;
  id?: string;
  authorParticipantId: string;
  content?: ReturnType<typeof inboxV2ScenarioContent>;
  revision?: string;
  updatedAt?: string;
  origin?: "internal" | "source_originated" | "hulee_external";
  outboundRouteId?: string;
  sourceOccurrenceId?: string;
  lifecycle?:
    | Readonly<{ kind: "active" }>
    | Readonly<{
        kind: "local_delete_tombstone";
        revisionId?: string;
        reasonId: string;
        deletedAt: string;
      }>;
}) {
  const id = input.id ?? "message:scenario-1";
  const content =
    input.content ?? inboxV2ScenarioContent({ tenantId: input.tenantId });
  const origin = input.origin ?? "internal";
  const lifecycle =
    input.lifecycle?.kind === "local_delete_tombstone"
      ? {
          kind: "local_delete_tombstone" as const,
          revision: {
            tenantId: input.tenantId,
            kind: "message_revision" as const,
            id:
              input.lifecycle.revisionId ??
              `message_revision:${id.split(":").at(-1)}-${input.revision ?? "1"}`
          },
          reasonId: input.lifecycle.reasonId,
          deletedAt: input.lifecycle.deletedAt
        }
      : (input.lifecycle ?? { kind: "active" as const });
  return inboxV2MessageSchema.parse({
    tenantId: input.tenantId,
    id,
    conversation: {
      tenantId: input.tenantId,
      kind: "conversation",
      id: input.conversationId
    },
    timelineItem: {
      tenantId: input.tenantId,
      kind: "timeline_item",
      id: `timeline_item:${id.split(":").at(-1)}`
    },
    authorParticipant: {
      tenantId: input.tenantId,
      kind: "conversation_participant",
      id: input.authorParticipantId
    },
    origin:
      origin === "internal"
        ? { kind: "internal" }
        : origin === "source_originated"
          ? {
              kind: "source_originated",
              originOccurrence: {
                tenantId: input.tenantId,
                kind: "source_occurrence",
                id: input.sourceOccurrenceId ?? "source_occurrence:scenario-1"
              },
              direction: "inbound",
              claimAtOccurrence: null
            }
          : {
              kind: "hulee_external",
              outboundRoute: {
                tenantId: input.tenantId,
                kind: "outbound_route",
                id: input.outboundRouteId ?? "outbound_route:scenario-1"
              }
            },
    appActor:
      origin === "source_originated"
        ? null
        : {
            kind: "employee",
            employee: {
              tenantId: input.tenantId,
              kind: "employee",
              id: "employee:operator-1"
            },
            authorizationEpoch: "authorization:scenario-operator-1"
          },
    automationCausation: null,
    content: inboxV2TimelineContentHeadOf(content),
    referenceContext: { kind: "none" },
    lifecycle,
    revision: input.revision ?? "1",
    createdAt: inboxV2ScenarioNow,
    updatedAt: input.updatedAt ?? inboxV2ScenarioNow
  });
}

export function inboxV2ScenarioStaffNote(input: {
  tenantId: string;
  conversationId: string;
  id?: string;
  authorParticipantId: string;
}) {
  const id = input.id ?? "staff_note:scenario-1";
  return inboxV2StaffNoteSchema.parse({
    tenantId: input.tenantId,
    id,
    conversation: {
      tenantId: input.tenantId,
      kind: "conversation",
      id: input.conversationId
    },
    timelineItem: {
      tenantId: input.tenantId,
      kind: "timeline_item",
      id: `timeline_item:${id.split(":").at(-1)}`
    },
    authorParticipant: {
      tenantId: input.tenantId,
      kind: "conversation_participant",
      id: input.authorParticipantId
    },
    appActor: {
      kind: "employee",
      employee: {
        tenantId: input.tenantId,
        kind: "employee",
        id: "employee:operator-1"
      },
      authorizationEpoch: "authorization:scenario-operator-1"
    },
    automationCausation: null,
    content: inboxV2TimelineContentHeadOf(
      inboxV2ScenarioContent({
        tenantId: input.tenantId,
        id: `timeline_content:${id.split(":").at(-1)}`,
        text: "Private note"
      })
    ),
    revision: "1",
    createdAt: inboxV2ScenarioLater,
    updatedAt: inboxV2ScenarioLater
  });
}

export function inboxV2ScenarioIdentityClaim(input: {
  tenantId: string;
  sourceIdentityId: string;
  clientContactId: string;
  actorEmployeeId: string;
  id?: string;
}) {
  return inboxV2SourceIdentityClaimSchema.parse({
    tenantId: input.tenantId,
    id: input.id ?? "source_identity_claim:scenario-1",
    sourceExternalIdentity: {
      tenantId: input.tenantId,
      kind: "source_external_identity",
      id: input.sourceIdentityId
    },
    previousClaimVersion: null,
    claimVersion: "1",
    target: {
      kind: "client_contact",
      clientContact: {
        tenantId: input.tenantId,
        kind: "client_contact",
        id: input.clientContactId
      }
    },
    status: "active",
    confidence: "verified",
    evidenceReferences: [
      {
        kind: "raw_inbound_event",
        reference: {
          tenantId: input.tenantId,
          kind: "raw_inbound_event",
          id: "raw_inbound_event:scenario-1"
        }
      }
    ],
    policyId: "core:verified-source-identity",
    policyVersion: "v1",
    reasonCodeId: "core:operator-reviewed",
    decision: {
      kind: "manual",
      actorEmployee: {
        tenantId: input.tenantId,
        kind: "employee",
        id: input.actorEmployeeId
      },
      reviewState: "approved"
    },
    createdAt: inboxV2ScenarioLater,
    revocation: null,
    revision: "1"
  });
}

export function inboxV2CanonicalScenarioGuard(
  contentBoundary: "none" | "external" | "staff_only" = "external"
): InboxV2CanonicalScenarioGuard {
  return {
    profileId: "core:rbac.guard.canonical_resource",
    resourceState: "active",
    contentBoundary,
    routeInputFields: [],
    companionRequirementIds: [],
    action: { kind: "canonical" }
  };
}

export function inboxV2ExternalConversationReadScenarioGuard(input: {
  tenantId: string;
  conversationId: string;
}): InboxV2PolicyGuardEvidence {
  const targetResource = inboxV2ScenarioEntity(
    input.tenantId,
    "core:conversation",
    input.conversationId
  );
  return {
    ...inboxV2CanonicalScenarioGuard("external"),
    action: {
      kind: "conversation_content_read",
      targetResource,
      conversationKind: "external_work",
      contentBoundary: "external",
      topologyResource: inboxV2ScenarioEntity(
        input.tenantId,
        "core:conversation-topology",
        `conversation_topology:${input.conversationId.split(":").at(-1)}`
      ),
      topologyConversationResource: targetResource,
      topologyConversationKind: "external_work",
      topologyRevisionChecks: [{ kind: "state", expected: "1", actual: "1" }]
    }
  };
}

export function inboxV2ExternalMessageEditScenarioAuthorization(input: {
  tenantId: string;
  employeeId: string;
  conversationId: string;
  timelineItemId: string;
  sourceAccountId: string;
  bindingId: string;
  externalReferenceId: string;
  operation?: "edit" | "delete";
  targetRevision?: string;
}) {
  const tenantId = inboxV2TenantIdSchema.parse(input.tenantId);
  const employeeId = inboxV2EmployeeIdSchema.parse(input.employeeId);
  const conversationId = inboxV2ConversationIdSchema.parse(
    input.conversationId
  );
  const sourceAccountId = inboxV2SourceAccountIdSchema.parse(
    input.sourceAccountId
  );
  const operation = input.operation ?? "edit";
  const requiresProviderMutation = operation === "edit";
  const actionRequirementId = `message-${operation}`;
  const sourceRequirementId = `message-${operation}-source-use`;
  const readRequirementId = `message-${operation}-conversation-read`;
  const permissionId =
    operation === "edit"
      ? ("core:message.edit_own" as const)
      : ("core:message.delete_own" as const);
  const conversationResource = inboxV2ScenarioEntity(
    tenantId,
    "core:conversation",
    conversationId
  );
  const timelineItemResource = inboxV2ScenarioEntity(
    tenantId,
    "core:timeline-item",
    input.timelineItemId
  );
  const employeeResource = inboxV2ScenarioEntity(
    tenantId,
    "core:employee",
    employeeId
  );
  const sourceAccountResource = inboxV2ScenarioEntity(
    tenantId,
    "core:source-account",
    sourceAccountId
  );
  const bindingResource = inboxV2ScenarioEntity(
    tenantId,
    "core:source-thread-binding",
    input.bindingId
  );
  const externalReferenceResource = inboxV2ScenarioEntity(
    tenantId,
    "core:external-message-reference",
    input.externalReferenceId
  );
  const sourceCapabilityManifest = inboxV2ScenarioEntity(
    tenantId,
    "core:provider-capability-manifest",
    `provider_capability_manifest:source-use-${input.timelineItemId.split(":").at(-1)}`
  );
  const actionCapabilityManifest = inboxV2ScenarioEntity(
    tenantId,
    "core:provider-capability-manifest",
    `provider_capability_manifest:message-${operation}-${input.timelineItemId.split(":").at(-1)}`
  );
  const scopePath = (
    resource: InboxV2EntityKey,
    scopeTarget: InboxV2EntityKey
  ) => ({
    resource,
    scopeTarget,
    pathRevisionChecks: [
      { kind: "relation" as const, expected: "1", actual: "1" },
      { kind: "state" as const, expected: "1", actual: "1" }
    ],
    authorityProvenance: {
      kind: "hulee_canonical_repository" as const,
      factId: `fact:${resource.entityTypeId}:${resource.entityId}`,
      loaderDecisionId: "scenario-loader",
      projectionRevision: inboxV2EntityRevisionSchema.parse("1"),
      observedAt: inboxV2ScenarioNow
    }
  });
  const keyedRevisionChecks = (resources: readonly InboxV2EntityKey[]) =>
    resources.map((resource) => ({
      resource,
      expected: "1",
      actual: "1"
    }));
  const sourceGuard = {
    profileId: "core:rbac.guard.source_account_route",
    operation: {
      kind: "use",
      sourceAccountResource,
      bindingResource,
      capabilityManifest: {
        resource: sourceCapabilityManifest,
        capabilityId: "core:capability.source_account.use",
        sourceAccountResource,
        bindingResource,
        routeResource: null,
        manifestSourceAccountResource: sourceAccountResource,
        manifestBindingResource: bindingResource,
        manifestRouteResource: null,
        state: "supported",
        revisionChecks: keyedRevisionChecks([
          sourceCapabilityManifest,
          sourceAccountResource,
          bindingResource
        ]),
        notAfter: inboxV2ScenarioNotAfter
      }
    },
    sourceAccountId,
    routeSourceAccountId: sourceAccountId,
    sourceState: "active",
    bindingState: "active",
    bindingGeneration: "1",
    expectedBindingGeneration: "1",
    capabilityState: "supported",
    capabilityNotAfter: inboxV2ScenarioNotAfter
  } satisfies InboxV2PolicyGuardEvidence;
  const actionGuard = {
    ...inboxV2CanonicalScenarioGuard("external"),
    action: {
      kind: "message_author_action",
      operation,
      targetResource: timelineItemResource,
      actorEmployeeId: employeeId,
      authorEmployeeId: employeeId,
      contentBoundary: "external",
      targetRevisionChecks: [
        {
          kind: "entity" as const,
          expected: input.targetRevision ?? "1",
          actual: input.targetRevision ?? "1"
        }
      ],
      contentTopologyResource: inboxV2ScenarioEntity(
        tenantId,
        "core:timeline-content-topology",
        `timeline_content_topology:${input.timelineItemId.split(":").at(-1)}`
      ),
      topologyTimelineItemResource: timelineItemResource,
      topologyConversationResource: conversationResource,
      topologyBoundary: "external",
      topologyRevisionChecks: [
        { kind: "state" as const, expected: "1", actual: "1" }
      ],
      authorshipResource: inboxV2ScenarioEntity(
        tenantId,
        "core:message-authorship",
        `message_authorship:${input.timelineItemId.split(":").at(-1)}`
      ),
      authorshipTimelineItemResource: timelineItemResource,
      authorshipEmployeeResource: employeeResource,
      authorshipRevisionChecks: [
        { kind: "relation" as const, expected: "1", actual: "1" }
      ],
      contentReadRequirementIds: [readRequirementId],
      deletionMode: operation === "delete" ? "local_tombstone" : null,
      holdProof:
        operation === "delete"
          ? {
              resource: inboxV2ScenarioEntity(
                tenantId,
                "core:content-hold-index",
                `content_hold_index:${input.timelineItemId.split(":").at(-1)}`
              ),
              targetResource: timelineItemResource,
              state: "none" as const,
              revisionChecks: [
                {
                  kind: "legal_hold_set" as const,
                  expected: "1",
                  actual: "1"
                }
              ]
            }
          : null,
      originalRouteRequirementId: requiresProviderMutation
        ? sourceRequirementId
        : null,
      originalSourceAccountId: requiresProviderMutation
        ? sourceAccountId
        : null,
      originalSourceAccountResource: requiresProviderMutation
        ? sourceAccountResource
        : null,
      originalBindingResource: requiresProviderMutation
        ? bindingResource
        : null,
      originalBindingSourceAccountResource: requiresProviderMutation
        ? sourceAccountResource
        : null,
      externalReferenceResource: requiresProviderMutation
        ? externalReferenceResource
        : null,
      externalReferenceBindingResource: requiresProviderMutation
        ? bindingResource
        : null,
      externalReferenceTargetResource: requiresProviderMutation
        ? timelineItemResource
        : null,
      routeRevisionChecks: requiresProviderMutation
        ? [
            { kind: "binding" as const, expected: "1", actual: "1" },
            { kind: "route" as const, expected: "1", actual: "1" },
            { kind: "state" as const, expected: "1", actual: "1" }
          ]
        : [],
      capabilityId: requiresProviderMutation
        ? "core:capability.message.edit"
        : null,
      capabilityManifestResource: requiresProviderMutation
        ? actionCapabilityManifest
        : null,
      capabilityManifestSourceAccountResource: requiresProviderMutation
        ? sourceAccountResource
        : null,
      capabilityRevisionChecks: requiresProviderMutation
        ? [{ kind: "manifest" as const, expected: "1", actual: "1" }]
        : [],
      capabilityState: requiresProviderMutation
        ? "supported"
        : "not_applicable",
      capabilityNotAfter: requiresProviderMutation
        ? inboxV2ScenarioNotAfter
        : null
    }
  } satisfies InboxV2PolicyGuardEvidence;

  return createInboxV2ScenarioAuthorization({
    tenantId,
    employeeId,
    requirements: [
      {
        id: actionRequirementId,
        permissionId,
        resource: timelineItemResource,
        scopeFacts: [
          {
            kind: "conversation",
            ...scopePath(timelineItemResource, conversationResource),
            conversationId,
            validUntil: inboxV2ScenarioNotAfter
          }
        ],
        guard: actionGuard
      },
      ...(requiresProviderMutation
        ? [
            {
              id: sourceRequirementId,
              permissionId: "core:source_account.use" as const,
              resource: sourceAccountResource,
              scopeFacts: [
                {
                  kind: "source_account" as const,
                  ...scopePath(sourceAccountResource, sourceAccountResource),
                  sourceAccountId,
                  validUntil: inboxV2ScenarioNotAfter
                }
              ],
              guard: sourceGuard,
              visibility: "secondary_hidden" as const
            }
          ]
        : []),
      {
        id: readRequirementId,
        permissionId: "core:conversation.read",
        resource: conversationResource,
        guard: inboxV2ExternalConversationReadScenarioGuard({
          tenantId,
          conversationId
        }),
        visibility: "secondary_hidden"
      }
    ],
    grants: [
      {
        id: actionRequirementId,
        permissionId,
        scope: { type: "conversation", tenantId, id: conversationId }
      },
      ...(requiresProviderMutation
        ? [
            {
              id: sourceRequirementId,
              permissionId: "core:source_account.use" as const,
              scope: {
                type: "source_account" as const,
                tenantId,
                id: sourceAccountId
              }
            }
          ]
        : []),
      {
        id: readRequirementId,
        permissionId: "core:conversation.read"
      }
    ]
  });
}

export function inboxV2AtomicClaimAndReplyScenarioAuthorization(input: {
  tenantId: string;
  employeeId: string;
  conversationId: string;
  workItemId: string;
  queueId: string;
  sourceAccountId: string;
  bindingId: string;
  externalThreadId: string;
}) {
  const tenantId = inboxV2TenantIdSchema.parse(input.tenantId);
  const employeeId = inboxV2EmployeeIdSchema.parse(input.employeeId);
  const conversationId = inboxV2ConversationIdSchema.parse(
    input.conversationId
  );
  const workItemId = inboxV2WorkItemIdSchema.parse(input.workItemId);
  const queueId = inboxV2WorkQueueIdSchema.parse(input.queueId);
  const sourceAccountId = inboxV2SourceAccountIdSchema.parse(
    input.sourceAccountId
  );
  const conversationResource = inboxV2ScenarioEntity(
    tenantId,
    "core:conversation",
    conversationId
  );
  const workItemResource = inboxV2ScenarioEntity(
    tenantId,
    "core:work-item",
    workItemId
  );
  const queueResource = inboxV2ScenarioEntity(
    tenantId,
    "core:work-queue",
    queueId
  );
  const sourceAccountResource = inboxV2ScenarioEntity(
    tenantId,
    "core:source-account",
    sourceAccountId
  );
  const bindingResource = inboxV2ScenarioEntity(
    tenantId,
    "core:source-thread-binding",
    input.bindingId
  );
  const externalThreadResource = inboxV2ScenarioEntity(
    tenantId,
    "core:external-thread",
    input.externalThreadId
  );
  const scopePath = (
    resource: InboxV2EntityKey,
    scopeTarget: InboxV2EntityKey
  ) => ({
    resource,
    scopeTarget,
    pathRevisionChecks: [
      { kind: "relation" as const, expected: "1", actual: "1" },
      { kind: "state" as const, expected: "1", actual: "1" }
    ],
    authorityProvenance: {
      kind: "hulee_canonical_repository" as const,
      factId: `fact:${resource.entityTypeId}:${resource.entityId}`,
      loaderDecisionId: "scenario-loader",
      projectionRevision: inboxV2EntityRevisionSchema.parse("1"),
      observedAt: inboxV2ScenarioNow
    }
  });
  const keyedRevisionChecks = (resources: readonly InboxV2EntityKey[]) =>
    resources.map((resource) => ({
      resource,
      expected: "1",
      actual: "1"
    }));
  const sourceCapabilityManifest = inboxV2ScenarioEntity(
    tenantId,
    "core:provider-capability-manifest",
    "provider_capability_manifest:claim-and-reply-source"
  );
  const sourceGuard = {
    profileId: "core:rbac.guard.source_account_route",
    operation: {
      kind: "use",
      sourceAccountResource,
      bindingResource,
      capabilityManifest: {
        resource: sourceCapabilityManifest,
        capabilityId: "core:capability.source_account.use",
        sourceAccountResource,
        bindingResource,
        routeResource: null,
        manifestSourceAccountResource: sourceAccountResource,
        manifestBindingResource: bindingResource,
        manifestRouteResource: null,
        state: "supported",
        revisionChecks: keyedRevisionChecks([
          sourceCapabilityManifest,
          sourceAccountResource,
          bindingResource
        ]),
        notAfter: inboxV2ScenarioNotAfter
      }
    },
    sourceAccountId,
    routeSourceAccountId: sourceAccountId,
    sourceState: "active",
    bindingState: "active",
    bindingGeneration: "1",
    expectedBindingGeneration: "1",
    capabilityState: "supported",
    capabilityNotAfter: inboxV2ScenarioNotAfter
  } satisfies InboxV2PolicyGuardEvidence;
  const replyGuard = {
    profileId: "core:rbac.guard.external_route",
    authorizationMode: "operation",
    multiSendDestinationAuthority: null,
    operation: {
      kind: "reply",
      mode: "new_response",
      sourceReadRequirementId: null,
      sourceReadResource: null,
      sourceTimelineItemResource: null,
      sourceOccurrenceResource: null,
      occurrenceTimelineItemResource: null,
      occurrenceReferenceResource: null,
      occurrenceBindingResource: null,
      sourceReferenceResource: null,
      referenceTimelineItemResource: null,
      referenceBindingResource: null,
      revisionChecks: [],
      resourceRevisionChecks: []
    },
    targetResource: conversationResource,
    conversationResource,
    bindingResource,
    externalThreadResource,
    bindingConversationResource: conversationResource,
    bindingExternalThreadResource: externalThreadResource,
    bindingSourceAccountResource: sourceAccountResource,
    routeRevisionChecks: [
      { kind: "binding", expected: "1", actual: "1" },
      { kind: "route", expected: "1", actual: "1" },
      { kind: "state", expected: "1", actual: "1" }
    ],
    conversationRequirementId: "claim-reply-conversation-read",
    sourceAccountRequirementId: "claim-reply-source-use",
    workRequirementId: "claim-reply-work-read",
    overrideRequirementId: null,
    claimRequirementId: "claim-reply-work-claim",
    workItemId,
    workState: "active",
    actorRelation: "queue_member",
    queueReplyPolicy: "responsible_only",
    replyPolicyEvidence: {
      resource: inboxV2ScenarioEntity(
        tenantId,
        "core:queue-reply-policy",
        "queue_reply_policy:claim-and-reply"
      ),
      conversationResource,
      workItemResource,
      policy: "responsible_only",
      revisionChecks: [{ kind: "state", expected: "1", actual: "1" }],
      notAfter: inboxV2ScenarioNotAfter
    },
    workAbsenceProof: null,
    conversationAccessBindingState: "active",
    structuralAccessBinding: null,
    sourceAccountId,
    bindingSourceAccountId: sourceAccountId,
    bindingState: "active",
    bindingGeneration: "1",
    expectedBindingGeneration: "1",
    capabilityState: "supported",
    capabilityId: "core:capability.message.reply",
    capabilityManifestResource: inboxV2ScenarioEntity(
      tenantId,
      "core:provider-capability-manifest",
      "provider_capability_manifest:claim-and-reply"
    ),
    capabilityManifestSourceAccountResource: sourceAccountResource,
    capabilityManifestBindingResource: bindingResource,
    capabilityRevisionChecks: [
      { kind: "manifest", expected: "1", actual: "1" }
    ],
    capabilityNotAfter: inboxV2ScenarioNotAfter,
    claimMode: "atomic_claim_and_reply",
    overrideReason: null,
    routeFallbackRequested: false
  } satisfies InboxV2PolicyGuardEvidence;

  return createInboxV2ScenarioAuthorization({
    tenantId,
    employeeId,
    requirements: [
      {
        id: "claim-reply",
        permissionId: "core:message.reply_external",
        resource: conversationResource,
        guard: replyGuard
      },
      {
        id: "claim-reply-conversation-read",
        permissionId: "core:conversation.read",
        resource: conversationResource,
        guard: inboxV2ExternalConversationReadScenarioGuard({
          tenantId,
          conversationId
        }),
        visibility: "secondary_hidden"
      },
      {
        id: "claim-reply-source-use",
        permissionId: "core:source_account.use",
        resource: sourceAccountResource,
        scopeFacts: [
          {
            kind: "source_account",
            ...scopePath(sourceAccountResource, sourceAccountResource),
            sourceAccountId,
            validUntil: inboxV2ScenarioNotAfter
          }
        ],
        guard: sourceGuard,
        visibility: "secondary_hidden"
      },
      {
        id: "claim-reply-work-read",
        permissionId: "core:work.read",
        resource: workItemResource,
        guard: inboxV2WorkScenarioGuard({
          workItemId,
          operation: "read",
          actorRelation: "queue_member",
          assignmentState: "unassigned"
        }),
        visibility: "secondary_hidden"
      },
      {
        id: "claim-reply-work-claim",
        permissionId: "core:work.claim",
        resource: workItemResource,
        guard: inboxV2WorkScenarioGuard({
          workItemId,
          operation: "claim",
          actorRelation: "queue_member",
          assignmentState: "unassigned",
          destinationRequirementIds: ["claim-reply-queue"],
          destinationResources: [queueResource]
        }),
        visibility: "secondary_hidden"
      },
      {
        id: "claim-reply-queue",
        permissionId: "core:work.claim",
        resource: workItemResource,
        scopeFacts: [
          inboxV2QueueScenarioScopeFact({
            workItemResource,
            queueResource,
            queueId
          })
        ],
        guard: inboxV2WorkScenarioGuard({
          workItemId,
          operation: "claim",
          authorizationMode: "destination_authority",
          actorRelation: "none",
          assignmentState: "assigned",
          authorityTargetResource: queueResource,
          authorityState: "eligible",
          eligibleEmployeeId: employeeId,
          authorityRevisionChecks: [
            { kind: "relation", expected: "1", actual: "1" }
          ]
        }),
        visibility: "secondary_hidden"
      }
    ],
    grants: [
      { id: "claim-reply", permissionId: "core:message.reply_external" },
      {
        id: "claim-reply-conversation-read",
        permissionId: "core:conversation.read"
      },
      {
        id: "claim-reply-source-use",
        permissionId: "core:source_account.use",
        scope: { type: "source_account", tenantId, id: sourceAccountId }
      },
      { id: "claim-reply-work-read", permissionId: "core:work.read" },
      { id: "claim-reply-work-claim", permissionId: "core:work.claim" }
    ]
  });
}

export function inboxV2WorkScenarioGuard(input: {
  workItemId: string;
  operation:
    | "read"
    | "claim"
    | "assign"
    | "servicing_team_manage"
    | "release_self"
    | "release_other"
    | "transfer"
    | "close"
    | "reopen"
    | "override";
  workState?:
    | "active"
    | "recovery_pending"
    | "terminal_actionable"
    | "terminal";
  actorRelation?:
    | "primary_responsible"
    | "work_item_collaborator"
    | "scoped_supervisor_override"
    | "queue_member"
    | "none";
  assignmentState?: "unassigned" | "assigned" | "recovery_pending";
  expectedStateRevision?: string;
  currentStateRevision?: string;
  destinationRequirementIds?: readonly string[];
  destinationResources?: readonly InboxV2EntityKey[];
  overrideReason?: string | null;
  overrideRequirementId?: string | null;
  authorizationMode?: "operation" | "destination_authority";
  authorityTargetResource?: InboxV2EntityKey | null;
  authorityState?: "eligible" | "ineligible" | null;
  eligibleEmployeeId?: string | null;
  authorityRevisionChecks?: readonly {
    kind: "entity" | "relation" | "state" | "manifest" | "policy";
    expected: string;
    actual: string;
  }[];
}): InboxV2PolicyGuardEvidence {
  return {
    profileId: "core:rbac.guard.work_item_state",
    authorizationMode: input.authorizationMode ?? "operation",
    workItemId: inboxV2WorkItemIdSchema.parse(input.workItemId),
    operation: input.operation,
    workState: input.workState ?? "active",
    actorRelation: input.actorRelation ?? "queue_member",
    assignmentState: input.assignmentState ?? "unassigned",
    expectedStateRevision: input.expectedStateRevision ?? "1",
    currentStateRevision: input.currentStateRevision ?? "1",
    destinationRequirementIds: input.destinationRequirementIds ?? [],
    destinationResources: input.destinationResources ?? [],
    authorityTargetResource: input.authorityTargetResource ?? null,
    authorityState: input.authorityState ?? null,
    eligibleEmployeeId:
      input.eligibleEmployeeId === undefined ||
      input.eligibleEmployeeId === null
        ? null
        : inboxV2EmployeeIdSchema.parse(input.eligibleEmployeeId),
    authorityRevisionChecks: input.authorityRevisionChecks ?? [],
    overrideReason: input.overrideReason ?? null,
    overrideRequirementId: input.overrideRequirementId ?? null
  };
}

export function inboxV2QueueScenarioScopeFact(input: {
  workItemResource: InboxV2EntityKey;
  queueResource: InboxV2EntityKey;
  queueId: string;
}): InboxV2CanonicalScopeFact {
  return {
    kind: "queue",
    resource: inboxV2EntityKeySchema.parse(input.workItemResource),
    scopeTarget: inboxV2EntityKeySchema.parse(input.queueResource),
    pathRevisionChecks: [
      { kind: "relation", expected: "1", actual: "1" },
      { kind: "state", expected: "1", actual: "1" }
    ],
    authorityProvenance: {
      kind: "hulee_canonical_repository",
      factId: `fact:${input.workItemResource.entityTypeId}:${input.workItemResource.entityId}`,
      loaderDecisionId: "scenario-loader",
      projectionRevision: inboxV2EntityRevisionSchema.parse("1"),
      observedAt: inboxV2ScenarioNow
    },
    queueId: inboxV2WorkQueueIdSchema.parse(input.queueId),
    validUntil: inboxV2ScenarioNotAfter
  };
}

export function inboxV2InternalMembershipScenarioGuard(input: {
  conversationId: string;
  employeeId: string;
  membershipState?: "active" | "closed";
  membershipRole?: "owner" | "admin" | "member" | "observer";
}): InboxV2PolicyGuardEvidence {
  return {
    profileId: "core:rbac.guard.internal_membership",
    conversationId: inboxV2ConversationIdSchema.parse(input.conversationId),
    employeeId: inboxV2EmployeeIdSchema.parse(input.employeeId),
    membershipState: input.membershipState ?? "active",
    membershipOrigin: "hulee_internal_command",
    membershipRole: input.membershipRole ?? "member",
    contentBoundary: "internal",
    validUntil: inboxV2ScenarioNotAfter
  };
}

export function inboxV2ClientContactClaimScenarioRequirements(input: {
  tenantId: string;
  actorEmployeeId: string;
  sourceIdentityId: string;
  clientContactId: string;
}) {
  const sourceIdentityResource = inboxV2ScenarioEntity(
    input.tenantId,
    "core:source-external-identity",
    input.sourceIdentityId
  );
  const targetResource = inboxV2ScenarioEntity(
    input.tenantId,
    "core:client-contact",
    input.clientContactId
  );
  const sourceRequirementId = "identity-source-use";
  const checks = [{ kind: "entity" as const, expected: "1", actual: "1" }];
  const claimGuard: InboxV2PolicyGuardEvidence = {
    profileId: "core:rbac.guard.identity_evidence",
    targetResource,
    evidenceState: "verified",
    operation: {
      kind: "client_contact_claim_manage",
      actorEmployeeId: inboxV2EmployeeIdSchema.parse(input.actorEmployeeId),
      sourceIdentityResource,
      sourceIdentityRequirementId: sourceRequirementId,
      sourceIdentityRevisionChecks: checks,
      reasonCodeId: "core:verified-manual-claim",
      auditEventResource: inboxV2ScenarioEntity(
        input.tenantId,
        "core:audit-event",
        "audit_event:scenario-identity-claim"
      ),
      auditActorEmployeeId: inboxV2EmployeeIdSchema.parse(
        input.actorEmployeeId
      ),
      auditSourceIdentityResource: sourceIdentityResource,
      auditTargetResource: targetResource,
      auditRevisionChecks: checks,
      oldTargetResource: null,
      oldTargetRequirementId: null,
      newTargetResource: targetResource,
      claimPolicyResource: inboxV2ScenarioEntity(
        input.tenantId,
        "core:identity-claim-policy",
        "identity_claim_policy:scenario-manual"
      ),
      claimPolicyState: "approved_active",
      claimPolicyVersion: "1",
      evidencePolicyResource: inboxV2ScenarioEntity(
        input.tenantId,
        "core:identity-claim-policy",
        "identity_claim_policy:scenario-manual"
      ),
      evidencePolicyVersion: "1",
      evidenceResource: inboxV2ScenarioEntity(
        input.tenantId,
        "core:identity-evidence",
        "identity_evidence:scenario-manual"
      ),
      evidenceSourceIdentityResource: sourceIdentityResource,
      evidenceTargetResource: targetResource,
      sensitiveEvidenceIncluded: false,
      evidenceViewRequirementId: null,
      claimPolicyRevisionChecks: [
        { kind: "policy", expected: "1", actual: "1" }
      ],
      evidenceRevisionChecks: checks,
      targetRevisionChecks: checks,
      claimHeadResource: inboxV2ScenarioEntity(
        input.tenantId,
        "core:source-identity-claim-head",
        "source_identity_claim_head:scenario-1"
      ),
      claimHeadSourceIdentityResource: sourceIdentityResource,
      currentClaimTargetResource: null,
      expectedClaimVersion: null,
      currentClaimVersion: null,
      claimRevisionChecks: [{ kind: "relation", expected: "1", actual: "1" }]
    }
  };
  const sourceGuard: InboxV2PolicyGuardEvidence = {
    profileId: "core:rbac.guard.identity_evidence",
    targetResource: sourceIdentityResource,
    evidenceState: "verified",
    operation: {
      kind: "source_identity_use",
      actorEmployeeId: inboxV2EmployeeIdSchema.parse(input.actorEmployeeId),
      evidenceResource: sourceIdentityResource,
      revisionChecks: [{ kind: "relation", expected: "1", actual: "1" }]
    }
  };
  return {
    targetResource,
    sourceIdentityResource,
    requirements: [
      {
        id: "identity-claim",
        permissionId: "core:identity.client_contact_claim.manage",
        resource: targetResource,
        guard: claimGuard
      },
      {
        id: sourceRequirementId,
        permissionId: "core:identity.source_identity.use",
        resource: sourceIdentityResource,
        guard: sourceGuard,
        visibility: "secondary_hidden" as const
      }
    ]
  } as const;
}

export function createInboxV2ScenarioAuthorization(input: {
  tenantId: string;
  employeeId: string;
  requirements: readonly Readonly<{
    id: string;
    permissionId: string;
    resource: InboxV2EntityKey;
    guard?: InboxV2PolicyGuardEvidence;
    scopeFacts?: readonly InboxV2CanonicalScopeFact[];
    revisionChecks?: InboxV2AuthorizationRequirement["revisionChecks"];
    visibility?: "primary" | "secondary_hidden";
    resourceAccessRevision?: string;
  }>[];
  grants?: readonly Readonly<{
    id?: string;
    permissionId: string;
    scope?: InboxV2PermissionScope;
  }>[];
  evaluatedAt?: string;
  notAfter?: string;
  lifecycle?: "active" | "draining" | "inactive";
}): InboxV2AuthorizationPlanInput {
  const tenantId = inboxV2TenantIdSchema.parse(input.tenantId);
  const employeeId = inboxV2EmployeeIdSchema.parse(input.employeeId);
  const employee = inboxV2EmployeeReferenceSchema.parse({
    tenantId,
    kind: "employee",
    id: employeeId
  });
  const requirements = input.requirements.map((requirement) => {
    getInboxV2PermissionDefinition(requirement.permissionId);
    return {
      id: requirement.id,
      permissionId: requirement.permissionId,
      resource: inboxV2EntityKeySchema.parse(requirement.resource),
      resourceAccessRevision: requirement.resourceAccessRevision ?? "1",
      expectedResourceAccessRevision: requirement.resourceAccessRevision ?? "1",
      scopeFacts: requirement.scopeFacts ?? [],
      revisionChecks: requirement.revisionChecks ?? [],
      guard: requirement.guard ?? inboxV2CanonicalScenarioGuard(),
      visibility: requirement.visibility ?? "primary",
      authorizationSubject: { kind: "actor" as const }
    } satisfies InboxV2AuthorizationRequirement;
  });
  const dependencies = scenarioDependencies(requirements);
  const evaluatedAt = input.evaluatedAt ?? inboxV2ScenarioNow;
  const notAfter = input.notAfter ?? inboxV2ScenarioNotAfter;
  const epoch = inboxV2AuthorizationEpochSchema.parse(
    `authorization:scenario-${String(employeeId).split(":").at(-1)}`
  );
  const authorization = inboxV2AuthorizationEpochSnapshotSchema.parse({
    tenantId,
    employee,
    value: epoch,
    dependencies,
    evaluatedAt,
    notAfter,
    nextAuthorizationBoundary: notAfter
  });
  const grantInputs: readonly Readonly<{
    id?: string;
    permissionId: string;
    scope?: InboxV2PermissionScope;
  }>[] =
    input.grants ??
    [
      ...new Set(requirements.map((requirement) => requirement.permissionId))
    ].map((permissionId, index) => ({
      id: `scenario-grant-${index + 1}`,
      permissionId
    }));
  const grants = grantInputs.map((grant, index) => {
    getInboxV2PermissionDefinition(grant.permissionId);
    return {
      id: grant.id ?? `scenario-grant-${index + 1}`,
      tenantId,
      principal: { kind: "employee" as const, employeeId },
      permissionId: grant.permissionId as InboxV2PermissionId,
      catalogSchemaId: "core:inbox-v2.permission-scope-catalog" as const,
      catalogVersion: "v1" as const,
      scope: grant.scope ?? { type: "tenant" as const, tenantId },
      source: {
        kind: "direct_grant" as const,
        origin: "inbox_v2_native" as const,
        directGrantId: `direct-${grant.id ?? index + 1}`,
        bindingResource: inboxV2ScenarioEntity(
          tenantId,
          "core:direct-grant",
          `direct_grant:direct-${grant.id ?? index + 1}`
        ),
        bindingRevision: inboxV2EntityRevisionSchema.parse("1")
      },
      revision: inboxV2EntityRevisionSchema.parse("1"),
      validFrom: null,
      validUntil: notAfter,
      revokedAt: null
    } satisfies InboxV2PolicyGrant;
  });

  return {
    tenantId,
    evaluatedAt,
    principal: {
      kind: "employee",
      employee,
      lifecycle: input.lifecycle ?? "active",
      session: { state: "active", authorization, notAfter }
    },
    currentAuthorization: {
      tenantId,
      principal: { kind: "employee", employeeId },
      authorizationEpoch: epoch,
      dependencies
    },
    grants,
    requirements
  };
}

export const inboxV2ScenarioContractIds = Object.freeze({
  conversation: INBOX_V2_CONVERSATION_SCHEMA_ID,
  externalThread: INBOX_V2_EXTERNAL_THREAD_SCHEMA_ID,
  sourceThreadBinding: INBOX_V2_SOURCE_THREAD_BINDING_SCHEMA_ID,
  outboundRoute: INBOX_V2_OUTBOUND_ROUTE_SCHEMA_ID,
  participant: "core:inbox-v2.conversation-participant",
  sourceIdentity: INBOX_V2_SOURCE_EXTERNAL_IDENTITY_SCHEMA_ID,
  clientLink: INBOX_V2_CONVERSATION_CLIENT_LINK_SCHEMA_ID,
  workItem: INBOX_V2_WORK_ITEM_SCHEMA_ID,
  message: "core:inbox-v2.message",
  staffNote: INBOX_V2_STAFF_NOTE_SCHEMA_ID,
  identityClaim: INBOX_V2_SOURCE_IDENTITY_CLAIM_SCHEMA_ID,
  scenarioState: "module:hulee-testing:scenario-state"
});

export const inboxV2ScenarioContractSchemas = Object.freeze({
  conversation: inboxV2ConversationSchema,
  externalThread: inboxV2ExternalThreadSchema,
  sourceThreadBinding: inboxV2SourceThreadBindingSchema,
  outboundRoute: inboxV2OutboundRouteSchema,
  participant: inboxV2ConversationParticipantSchema,
  sourceIdentity: inboxV2SourceExternalIdentitySchema,
  workItem: inboxV2WorkItemSchema,
  message: inboxV2MessageSchema,
  staffNote: inboxV2StaffNoteSchema,
  identityClaim: inboxV2SourceIdentityClaimSchema,
  scenarioState: inboxV2ScenarioStateSchema
});

function scenarioDependencies(
  requirements: readonly InboxV2AuthorizationRequirement[]
): InboxV2AuthorizationDependencyVector {
  const resources = new Map<string, InboxV2EntityKey>();
  for (const requirement of requirements) {
    resources.set(
      `${requirement.resource.tenantId}\u0000${requirement.resource.entityTypeId}\u0000${requirement.resource.entityId}`,
      requirement.resource
    );
  }
  return inboxV2AuthorizationDependencyVectorSchema.parse({
    tenantRbacRevision: "1",
    employeeAccessRevision: "1",
    employeeInboxRelationRevision: "1",
    sharedAccessRevision: "1",
    resourceDependencies: [...resources.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, resource]) => ({
        resource,
        accessRevision: "1"
      })),
    temporalBoundaryDigest: `sha256:${"a".repeat(64)}`
  });
}
