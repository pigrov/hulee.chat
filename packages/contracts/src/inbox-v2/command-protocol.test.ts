import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  createInboxV2AuthorizedCommandContract,
  createInboxV2ClientCommandRequestEnvelopeSchema,
  decideInboxV2CommandIdempotency,
  deriveInboxV2MessageEditFileSourceAuthorityPlan,
  deriveInboxV2MessageEditFileUploadAuthorityPlan,
  discloseInboxV2CommandResult,
  INBOX_V2_AUTHORIZED_COMMAND_SCHEMA_ID,
  INBOX_V2_CLIENT_COMMAND_REQUEST_SCHEMA_ID,
  inboxV2AuthorizedCommandEnvelopeSchema,
  inboxV2CommandIdempotencyRecordSchema,
  inboxV2CommandIdempotencyScopeSchema,
  inboxV2CommandResultSchema,
  inboxV2EntityRevisionSchema,
  inboxV2TimelineCommandIntentEnvelopeSchema,
  inboxV2TimelineCommandIntentSchema,
  parseInboxV2AuthorizedCommandEnvelope,
  parseInboxV2CommandResultEnvelope
} from "../index";

const tenantId = "tenant:tenant-1";
const employee = {
  tenantId,
  kind: "employee" as const,
  id: "employee:employee-1"
};
const authorizationEpoch = "authorization:epoch-0001";
const hashA = `sha256:${"a".repeat(64)}`;
const hashB = `sha256:${"b".repeat(64)}`;
const now = "2026-07-11T09:00:00.000Z";
const notAfter = "2026-07-11T10:00:00.000Z";
const archivedV1CommandResultBytes =
  '{"schemaId":"core:inbox-v2.command-result","schemaVersion":"v1","payload":{"tenantId":"tenant:tenant-1","commandId":"command:command-1","principal":{"kind":"employee","employee":{"tenantId":"tenant:tenant-1","kind":"employee","id":"employee:employee-1"}},"clientMutationId":"mutation:mutation-1","requestHash":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","authorizationEpoch":"authorization:epoch-0001","recordedAt":"2026-07-11T09:00:00.000Z","kind":"committed","commit":{"tenantId":"tenant:tenant-1","streamEpoch":"stream:epoch:0001","commitId":"commit:commit-1","streamPosition":"9007199254740993"},"resultReference":null}}';

function authorization() {
  return {
    tenantId,
    employee,
    value: authorizationEpoch,
    dependencies: {
      tenantRbacRevision: "3",
      employeeAccessRevision: "5",
      employeeInboxRelationRevision: "8",
      sharedAccessRevision: "13",
      resourceDependencies: [
        {
          resource: {
            tenantId,
            entityTypeId: "core:conversation",
            entityId: "conversation:conversation-1"
          },
          accessRevision: "4"
        },
        {
          resource: {
            tenantId,
            entityTypeId: "core:staff-note",
            entityId: "staff_note:note-1"
          },
          accessRevision: "2"
        }
      ],
      temporalBoundaryDigest: hashA
    },
    evaluatedAt: now,
    notAfter,
    nextAuthorizationBoundary: null
  };
}

function decision() {
  return {
    tenantId,
    id: "authorization-decision:read-note-1",
    authorizationEpoch,
    principal: { kind: "employee" as const, employee },
    permissionId: "core:message.staff_note.read",
    resourceScopeId: "core:conversation",
    resource: {
      tenantId,
      entityTypeId: "core:conversation",
      entityId: "conversation:conversation-1"
    },
    resourceAccessRevision: "4",
    decisionRevision: "1",
    decisionHash: hashA,
    outcome: "allowed" as const,
    decidedAt: now,
    notAfter
  };
}

function conversationDecision() {
  return {
    ...decision(),
    id: "authorization-decision:read-conversation-1",
    permissionId: "core:conversation.read",
    resourceScopeId: "core:conversation",
    resource: {
      tenantId,
      entityTypeId: "core:conversation",
      entityId: "conversation:conversation-1"
    },
    resourceAccessRevision: "4"
  };
}

function result(kind: "committed" | "no_op" = "committed") {
  return kind === "committed"
    ? {
        tenantId,
        commandId: "command:command-1",
        principal: { kind: "employee" as const, employee },
        clientMutationId: "mutation:mutation-1",
        requestHash: hashA,
        authorizationEpoch,
        recordedAt: now,
        kind,
        commit: {
          tenantId,
          streamEpoch: "stream:epoch:0001",
          commitId: "commit:commit-1",
          streamPosition: "9007199254740993"
        },
        resultReference: null
      }
    : {
        tenantId,
        commandId: "command:command-1",
        principal: { kind: "employee" as const, employee },
        clientMutationId: "mutation:mutation-1",
        requestHash: hashA,
        authorizationEpoch,
        recordedAt: now,
        kind,
        commit: null,
        resultReference: null
      };
}

const conversation = {
  tenantId,
  kind: "conversation" as const,
  id: "conversation:conversation-1"
};
const sourceConversation = {
  tenantId,
  kind: "conversation" as const,
  id: "conversation:conversation-source-1"
};
const authorParticipant = {
  tenantId,
  kind: "conversation_participant" as const,
  id: "conversation_participant:employee-1"
};
const message = {
  tenantId,
  kind: "message" as const,
  id: "message:message-1"
};
const timelineItem = {
  tenantId,
  kind: "timeline_item" as const,
  id: "timeline_item:message-1"
};
const outboundRoute = {
  tenantId,
  kind: "outbound_route" as const,
  id: "outbound_route:route-1"
};
const sourceAccount = {
  tenantId,
  kind: "source_account" as const,
  id: "source_account:account-1"
};
const sourceThreadBinding = {
  tenantId,
  kind: "source_thread_binding" as const,
  id: "source_thread_binding:binding-1"
};
const readyFile = {
  tenantId,
  kind: "file" as const,
  id: "file:file-1"
};
const readyFileVersion = {
  tenantId,
  kind: "file_version" as const,
  id: "file_version:file-1-r9"
};
const readyObjectVersion = {
  tenantId,
  kind: "file_object_version" as const,
  id: "file_object_version:file-1-r9-v1"
};

type AuthorizationResource = Readonly<{
  tenantId: string;
  entityTypeId: string;
  entityId: string;
}>;

type AuthorizationEvidence = Readonly<{
  permissionId: string;
  resourceScopeId: string;
  resource: AuthorizationResource;
  accessRevision: string;
}>;

function authoredIntentFields() {
  return {
    tenantId,
    conversation,
    authorParticipant,
    appActor: employeeAppActor(),
    automationCausation: null,
    occurredAt: now
  };
}

function employeeAppActor() {
  return {
    kind: "employee" as const,
    employee,
    authorizationEpoch
  };
}

function routeAuthorization() {
  return {
    conversation,
    outboundRoute,
    routeRevision: "3",
    sourceAccount,
    sourceThreadBinding,
    bindingFence: {
      accountGeneration: "1",
      bindingGeneration: "2",
      remoteAccessRevision: "3",
      administrativeRevision: "4",
      capabilityRevision: "5",
      routeDescriptorRevision: "6"
    }
  };
}

function reactionMessageTargetProof() {
  return {
    conversation,
    message,
    timelineItem,
    expectedMessageRevision: "6",
    expectedTimelineItemRevision: "6",
    ownerParticipant: authorParticipant
  };
}

function textContent() {
  return {
    blocks: [
      {
        blockKey: "body-1",
        kind: "text" as const,
        role: "body" as const,
        text: "Hello",
        language: null
      }
    ]
  };
}

function readyAttachmentContent() {
  return {
    blocks: [
      {
        blockKey: "file-1",
        kind: "file" as const,
        attachment: {
          state: "ready" as const,
          attachment: {
            tenantId,
            kind: "message_attachment" as const,
            id: "message_attachment:attachment-1"
          },
          file: readyFile,
          fileRevision: "9",
          fileVersion: readyFileVersion,
          objectVersion: readyObjectVersion
        },
        displayName: "invoice.pdf"
      }
    ]
  };
}

function uploadStagingFileReadProof(
  visibilityBoundary: "external_work" | "internal"
) {
  return {
    blockKey: "file-1",
    purpose: "attachment" as const,
    file: readyFile,
    attachment: {
      tenantId,
      kind: "message_attachment" as const,
      id: "message_attachment:attachment-1"
    },
    expectedFileRevision: "9",
    fileVersion: readyFileVersion,
    objectVersion: readyObjectVersion,
    parentConversation: conversation,
    visibilityBoundary,
    sourceParent: {
      kind: "upload_staging" as const,
      appActor: employeeAppActor(),
      uploadRevision: "1"
    }
  };
}

function conversationEvidence(
  actionPermissionId: string,
  readPermissionId = "core:conversation.read"
): AuthorizationEvidence[] {
  const resource = {
    tenantId,
    entityTypeId: "core:conversation",
    entityId: conversation.id
  };
  return [
    {
      permissionId: readPermissionId,
      resourceScopeId: "core:conversation",
      resource,
      accessRevision: "4"
    },
    {
      permissionId: actionPermissionId,
      resourceScopeId: "core:conversation",
      resource,
      accessRevision: "4"
    }
  ];
}

function lifecycleEvidence(
  actionPermissionId: string,
  readPermissionId = "core:conversation.read"
): AuthorizationEvidence[] {
  return [
    conversationEvidence(actionPermissionId, readPermissionId)[0]!,
    {
      permissionId: actionPermissionId,
      resourceScopeId: "core:timeline-item",
      resource: {
        tenantId,
        entityTypeId: "core:timeline-item",
        entityId: timelineItem.id
      },
      accessRevision: "6"
    }
  ];
}

function routeEvidence(): AuthorizationEvidence {
  return {
    permissionId: "core:source_account.use",
    resourceScopeId: "core:source-account",
    resource: {
      tenantId,
      entityTypeId: "core:source-account",
      entityId: sourceAccount.id
    },
    accessRevision: "7"
  };
}

function fileEvidence(): AuthorizationEvidence {
  return {
    permissionId: "core:file.view",
    resourceScopeId: "core:file",
    resource: {
      tenantId,
      entityTypeId: "core:file",
      entityId: readyFile.id
    },
    accessRevision: "9"
  };
}

function fileUploadEvidence(): AuthorizationEvidence {
  return {
    permissionId: "core:file.upload",
    resourceScopeId: "core:file",
    resource: {
      tenantId,
      entityTypeId: "core:file",
      entityId: readyFile.id
    },
    accessRevision: "9"
  };
}

function sourceConversationEvidence(): AuthorizationEvidence {
  return {
    permissionId: "core:conversation.read",
    resourceScopeId: "core:conversation",
    resource: {
      tenantId,
      entityTypeId: "core:conversation",
      entityId: sourceConversation.id
    },
    accessRevision: "11"
  };
}

function workItemEvidence(permissionId: string): AuthorizationEvidence {
  return {
    permissionId,
    resourceScopeId: "core:work-item",
    resource: {
      tenantId,
      entityTypeId: "core:work-item",
      entityId: "work_item:work-1"
    },
    accessRevision: "12"
  };
}

function authorizedTimelineCommand(
  intent: Record<string, unknown>,
  evidence: readonly AuthorizationEvidence[]
) {
  const baseAuthorization = authorization();
  const dependencies = new Map<
    string,
    { resource: AuthorizationResource; accessRevision: string }
  >();
  for (const item of evidence) {
    dependencies.set(
      `${item.resource.tenantId}\u0000${item.resource.entityTypeId}\u0000${item.resource.entityId}`,
      {
        resource: item.resource,
        accessRevision: item.accessRevision
      }
    );
  }
  return {
    schemaId: INBOX_V2_AUTHORIZED_COMMAND_SCHEMA_ID,
    schemaVersion: "v1",
    payload: {
      tenantId,
      commandId: "command:security-fixture-1",
      request: {
        tenantId,
        requestId: "request:security-fixture-1",
        clientMutationId: "mutation:security-fixture-1",
        commandTypeId: "core:timeline.command",
        requestHash: hashA
      },
      principal: {
        kind: "employee" as const,
        employee,
        authorization: {
          ...baseAuthorization,
          dependencies: {
            ...baseAuthorization.dependencies,
            resourceDependencies: [...dependencies.entries()]
              .sort(([left], [right]) => left.localeCompare(right))
              .map(([, dependency]) => dependency)
          }
        }
      },
      authorizationDecisionRefs: evidence.map((item, index) => ({
        tenantId,
        id: `authorization-decision:security-${index + 1}`,
        authorizationEpoch,
        principal: { kind: "employee" as const, employee },
        permissionId: item.permissionId,
        resourceScopeId: item.resourceScopeId,
        resource: item.resource,
        resourceAccessRevision: item.accessRevision,
        decisionRevision: "1",
        decisionHash: hashA,
        outcome: "allowed" as const,
        decidedAt: now,
        notAfter
      })),
      intent: {
        schemaId: "core:inbox-v2.timeline-command-intent",
        schemaVersion: "v1",
        payload: intent
      },
      authorizedAt: now
    }
  };
}

function sendExternalIntent() {
  return {
    kind: "send_external" as const,
    ...authoredIntentFields(),
    content: textContent(),
    outboundRoute,
    routeAuthorization: routeAuthorization(),
    replyAuthority: noWorkItemReplyAuthority(),
    referenceContext: { kind: "none" as const }
  };
}

function noWorkItemReplyAuthority() {
  return {
    kind: "no_work_item" as const,
    appActor: employeeAppActor(),
    conversation,
    workItemSlot: {
      tenantId,
      kind: "conversation_work_item_slot" as const,
      id: "conversation_work_item_slot:conversation-1"
    },
    expectedSlotRevision: "3",
    intakeDecisionRevision: "5"
  };
}

describe("Inbox V2 command protocol", () => {
  it("keeps the untrusted typed request free of actor and authorization claims", () => {
    const schema = createInboxV2ClientCommandRequestEnvelopeSchema({
      commandTypeId: "core:test.rename-conversation",
      payloadSchema: z.object({ title: z.string().min(1) }).strict()
    });
    const request = {
      schemaId: INBOX_V2_CLIENT_COMMAND_REQUEST_SCHEMA_ID,
      schemaVersion: "v1",
      payload: {
        tenantId,
        requestId: "request:retry-1",
        clientMutationId: "mutation:mutation-1",
        commandTypeId: "core:test.rename-conversation",
        payload: { title: "New title" }
      }
    };

    expect(schema.parse(request)).toEqual(request);
    expect(
      schema.safeParse({
        ...request,
        payload: { ...request.payload, actor: employee }
      }).success
    ).toBe(false);
    expect(() =>
      createInboxV2ClientCommandRequestEnvelopeSchema({
        commandTypeId: "core:test.unsafe",
        payloadSchema: z.unknown()
      })
    ).toThrow(/closed registered schema/u);
    expect(() =>
      createInboxV2ClientCommandRequestEnvelopeSchema({
        commandTypeId: "core:test.nested-unsafe",
        payloadSchema: z.object({ data: z.unknown() }).strict()
      })
    ).toThrow(/closed registered schema/u);
    expect(() =>
      createInboxV2AuthorizedCommandContract({
        commandTypeId: "core:test.unsafe-intent",
        intentSchema: z.object({ context: z.any() }).strict(),
        resolveIntentContext: () => ({
          tenantId,
          authorizationContextComplete: true,
          actor: {
            kind: "employee",
            employee,
            authorizationEpoch
          },
          requiredAuthorizations: []
        })
      })
    ).toThrow(/closed registered schema/u);
    for (const payloadSchema of [
      z.string().transform((value) => JSON.parse(value) as unknown),
      z.string().transform(() => ({ rawPayload: "x" })),
      z.bigint(),
      z.date(),
      z.string().catch({ rawPayload: "x" } as never),
      z.string().default("x"),
      z.string().optional()
    ]) {
      expect(() =>
        createInboxV2ClientCommandRequestEnvelopeSchema({
          commandTypeId: "core:test.unsafe-json-leaf",
          payloadSchema
        })
      ).toThrow(/closed registered schema/u);
    }
  });

  it("builds a non-timeline authorized command through the generic trust boundary", () => {
    const intentSchema = z
      .object({
        tenantId: z.literal(tenantId),
        actor: z
          .object({
            kind: z.literal("employee"),
            employee: z
              .object({
                tenantId: z.literal(tenantId),
                kind: z.literal("employee"),
                id: z.literal("employee:employee-1")
              })
              .strict(),
            authorizationEpoch: z.literal(authorizationEpoch)
          })
          .strict(),
        staffNote: z
          .object({
            tenantId: z.literal(tenantId),
            entityTypeId: z.literal("core:staff-note"),
            entityId: z.literal("staff_note:note-1")
          })
          .strict(),
        operation: z.literal("archive")
      })
      .strict();
    const contract = createInboxV2AuthorizedCommandContract({
      commandTypeId: "core:test.archive-staff-note",
      intentSchema,
      resolveIntentContext: (intent) => ({
        tenantId: intent.tenantId,
        authorizationContextComplete: true,
        actor: intent.actor,
        requiredAuthorizations: [
          {
            permissionId: "core:message.staff_note.read",
            resourceScopeId: "core:conversation",
            resource: {
              tenantId: intent.tenantId,
              entityTypeId: "core:conversation",
              entityId: conversation.id
            }
          }
        ]
      })
    });
    const envelope = {
      schemaId: INBOX_V2_AUTHORIZED_COMMAND_SCHEMA_ID,
      schemaVersion: "v1",
      payload: {
        tenantId,
        commandId: "command:archive-note-1",
        request: {
          tenantId,
          requestId: "request:archive-note-1",
          clientMutationId: "mutation:archive-note-1",
          commandTypeId: "core:test.archive-staff-note",
          requestHash: hashA
        },
        principal: {
          kind: "employee" as const,
          employee,
          authorization: authorization()
        },
        authorizationDecisionRefs: [decision()],
        intent: {
          tenantId,
          actor: {
            kind: "employee" as const,
            employee,
            authorizationEpoch
          },
          staffNote: {
            tenantId,
            entityTypeId: "core:staff-note" as const,
            entityId: "staff_note:note-1" as const
          },
          operation: "archive" as const
        },
        authorizedAt: now
      }
    };
    expect(contract.envelopeSchema.safeParse(envelope).success).toBe(true);
    expect(contract.parseEnvelope(envelope).kind).toBe("parsed");
  });

  it("binds a server-stamped timeline intent to one principal and allow epoch", () => {
    const command = {
      schemaId: INBOX_V2_AUTHORIZED_COMMAND_SCHEMA_ID,
      schemaVersion: "v1",
      payload: {
        tenantId,
        commandId: "command:command-1",
        request: {
          tenantId,
          requestId: "request:retry-1",
          clientMutationId: "mutation:mutation-1",
          commandTypeId: "core:timeline.command",
          requestHash: hashA
        },
        principal: {
          kind: "employee" as const,
          employee,
          authorization: authorization()
        },
        authorizationDecisionRefs: [conversationDecision(), decision()],
        intent: {
          schemaId: "core:inbox-v2.timeline-command-intent",
          schemaVersion: "v1",
          payload: {
            kind: "read_staff_note" as const,
            tenantId,
            conversation: {
              tenantId,
              kind: "conversation" as const,
              id: "conversation:conversation-1"
            },
            staffNote: {
              tenantId,
              kind: "staff_note" as const,
              id: "staff_note:note-1"
            },
            readProof: {
              conversation,
              staffNote: {
                tenantId,
                kind: "staff_note" as const,
                id: "staff_note:note-1"
              },
              expectedStaffNoteRevision: "2",
              parentConversationVisibility: "external_work" as const
            },
            reader: {
              kind: "employee" as const,
              employee,
              authorizationEpoch
            },
            readAt: now
          }
        },
        authorizedAt: now
      }
    };

    expect(
      inboxV2AuthorizedCommandEnvelopeSchema.safeParse(command).success
    ).toBe(true);
    const { readProof: _readProof, ...legacyReadIntent } =
      command.payload.intent.payload;
    expect(
      inboxV2TimelineCommandIntentEnvelopeSchema.safeParse({
        ...command.payload.intent,
        payload: legacyReadIntent
      }).success
    ).toBe(true);
    expect(
      inboxV2AuthorizedCommandEnvelopeSchema.safeParse({
        ...command,
        payload: {
          ...command.payload,
          intent: { ...command.payload.intent, payload: legacyReadIntent }
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2AuthorizedCommandEnvelopeSchema.safeParse({
        ...command,
        payload: {
          ...command.payload,
          principal: {
            ...command.payload.principal,
            authorization: {
              ...command.payload.principal.authorization,
              nextAuthorizationBoundary: "2026-07-11T09:30:00.000Z"
            }
          },
          authorizedAt: "2026-07-11T09:15:00.000Z"
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2AuthorizedCommandEnvelopeSchema.safeParse({
        ...command,
        payload: {
          ...command.payload,
          intent: {
            ...command.payload.intent,
            payload: {
              ...command.payload.intent.payload,
              readProof: {
                ...command.payload.intent.payload.readProof,
                parentConversationVisibility: "internal"
              }
            }
          }
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2AuthorizedCommandEnvelopeSchema.safeParse({
        ...command,
        payload: {
          ...command.payload,
          authorizationDecisionRefs: [
            conversationDecision(),
            { ...decision(), id: conversationDecision().id }
          ]
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2TimelineCommandIntentEnvelopeSchema.safeParse({
        ...command.payload.intent,
        payload: {
          ...command.payload.intent.payload,
          readProof: {
            ...command.payload.intent.payload.readProof,
            staffNote: {
              tenantId,
              kind: "staff_note",
              id: "staff_note:hidden-note"
            }
          }
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2AuthorizedCommandEnvelopeSchema.safeParse({
        ...command,
        payload: {
          ...command.payload,
          authorizationDecisionRefs: [
            { ...decision(), authorizationEpoch: "authorization:epoch-0002" }
          ]
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2AuthorizedCommandEnvelopeSchema.safeParse({
        ...command,
        payload: {
          ...command.payload,
          principal: {
            ...command.payload.principal,
            authorization: {
              ...command.payload.principal.authorization,
              nextAuthorizationBoundary: "2026-07-11T09:30:00.000Z"
            }
          },
          authorizedAt: "2026-07-11T09:30:00.000Z"
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2AuthorizedCommandEnvelopeSchema.safeParse({
        ...command,
        payload: {
          ...command.payload,
          authorizationDecisionRefs: [
            conversationDecision(),
            decision(),
            {
              ...decision(),
              id: "authorization-decision:unrelated",
              resource: {
                tenantId,
                entityTypeId: "core:staff-note",
                entityId: "staff_note:note-2"
              }
            }
          ]
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2AuthorizedCommandEnvelopeSchema.safeParse({
        ...command,
        payload: { ...command.payload, authorizedAt: notAfter }
      }).success
    ).toBe(false);
    expect(parseInboxV2AuthorizedCommandEnvelope(command).kind).toBe("parsed");
    expect(
      parseInboxV2AuthorizedCommandEnvelope({
        ...command,
        schemaVersion: "v2"
      })
    ).toEqual({
      kind: "rejected",
      errorCode: "command.schema_unsupported",
      cursorAdvance: null
    });
  });

  it("requires one exact route proof, source-account decision and dependency for provider send", () => {
    const intent = sendExternalIntent();
    const evidence = [
      ...conversationEvidence("core:message.reply_external"),
      routeEvidence()
    ];
    const valid = authorizedTimelineCommand(intent, evidence);

    const parsedValid = inboxV2AuthorizedCommandEnvelopeSchema.safeParse(valid);
    expect(
      parsedValid.success,
      parsedValid.success
        ? undefined
        : JSON.stringify(parsedValid.error.issues, null, 2)
    ).toBe(true);

    const { routeAuthorization: _routeAuthorization, ...withoutRouteProof } =
      intent;
    expect(
      inboxV2TimelineCommandIntentEnvelopeSchema.safeParse({
        schemaId: "core:inbox-v2.timeline-command-intent",
        schemaVersion: "v1",
        payload: withoutRouteProof
      }).success
    ).toBe(true);
    expect(
      inboxV2AuthorizedCommandEnvelopeSchema.safeParse(
        authorizedTimelineCommand(withoutRouteProof, evidence)
      ).success
    ).toBe(false);
    const { replyAuthority: _replyAuthority, ...withoutReplyAuthority } =
      intent;
    expect(
      inboxV2TimelineCommandIntentEnvelopeSchema.safeParse({
        schemaId: "core:inbox-v2.timeline-command-intent",
        schemaVersion: "v1",
        payload: withoutReplyAuthority
      }).success
    ).toBe(true);
    expect(
      inboxV2AuthorizedCommandEnvelopeSchema.safeParse(
        authorizedTimelineCommand(withoutReplyAuthority, evidence)
      ).success
    ).toBe(false);

    expect(
      inboxV2AuthorizedCommandEnvelopeSchema.safeParse(
        authorizedTimelineCommand(
          {
            ...intent,
            routeAuthorization: {
              ...intent.routeAuthorization,
              outboundRoute: {
                ...outboundRoute,
                id: "outbound_route:guessed-route"
              }
            }
          },
          evidence
        )
      ).success
    ).toBe(false);

    expect(
      inboxV2AuthorizedCommandEnvelopeSchema.safeParse(
        authorizedTimelineCommand(
          intent,
          evidence.filter(
            (item) => item.permissionId !== "core:source_account.use"
          )
        )
      ).success
    ).toBe(false);

    const withoutSourceAccountDependency = {
      ...valid,
      payload: {
        ...valid.payload,
        principal: {
          ...valid.payload.principal,
          authorization: {
            ...valid.payload.principal.authorization,
            dependencies: {
              ...valid.payload.principal.authorization.dependencies,
              resourceDependencies:
                valid.payload.principal.authorization.dependencies.resourceDependencies.filter(
                  (dependency) =>
                    dependency.resource.entityTypeId !== "core:source-account"
                )
            }
          }
        }
      }
    };
    expect(
      inboxV2AuthorizedCommandEnvelopeSchema.safeParse(
        withoutSourceAccountDependency
      ).success
    ).toBe(false);
  });

  it("requires exact same-tenant ready-file proof, file.view decision and dependency", () => {
    const intent = {
      ...sendExternalIntent(),
      content: {
        blocks: [
          {
            blockKey: "file-1",
            kind: "file" as const,
            attachment: {
              state: "ready" as const,
              attachment: {
                tenantId,
                kind: "message_attachment" as const,
                id: "message_attachment:attachment-1"
              },
              file: readyFile,
              fileRevision: "9",
              fileVersion: readyFileVersion,
              objectVersion: readyObjectVersion
            },
            displayName: "invoice.pdf"
          }
        ]
      },
      fileReadProofs: [
        {
          blockKey: "file-1",
          purpose: "attachment" as const,
          file: readyFile,
          attachment: {
            tenantId,
            kind: "message_attachment" as const,
            id: "message_attachment:attachment-1"
          },
          expectedFileRevision: "9",
          fileVersion: readyFileVersion,
          objectVersion: readyObjectVersion,
          parentConversation: conversation,
          visibilityBoundary: "external_work" as const,
          sourceParent: {
            kind: "upload_staging" as const,
            appActor: employeeAppActor(),
            uploadRevision: "1"
          }
        }
      ]
    };
    const evidence = [
      ...conversationEvidence("core:message.reply_external"),
      routeEvidence(),
      fileEvidence(),
      fileUploadEvidence()
    ];
    const valid = authorizedTimelineCommand(intent, evidence);

    const parsedValid = inboxV2AuthorizedCommandEnvelopeSchema.safeParse(valid);
    expect(
      parsedValid.success,
      parsedValid.success
        ? undefined
        : JSON.stringify(parsedValid.error.issues, null, 2)
    ).toBe(true);

    const { fileReadProofs: _fileReadProofs, ...withoutFileProof } = intent;
    expect(
      inboxV2TimelineCommandIntentEnvelopeSchema.safeParse({
        schemaId: "core:inbox-v2.timeline-command-intent",
        schemaVersion: "v1",
        payload: withoutFileProof
      }).success
    ).toBe(true);
    expect(
      inboxV2AuthorizedCommandEnvelopeSchema.safeParse(
        authorizedTimelineCommand(withoutFileProof, evidence)
      ).success
    ).toBe(false);

    expect(
      inboxV2AuthorizedCommandEnvelopeSchema.safeParse(
        authorizedTimelineCommand(
          {
            ...intent,
            fileReadProofs: [
              {
                ...intent.fileReadProofs[0],
                file: { ...readyFile, id: "file:another-file" }
              }
            ]
          },
          evidence
        )
      ).success
    ).toBe(false);

    for (const mismatch of [
      {
        fileVersion: {
          ...readyFileVersion,
          id: "file_version:file-1-r8"
        }
      },
      {
        objectVersion: {
          ...readyObjectVersion,
          id: "file_object_version:file-1-r9-v2"
        }
      }
    ]) {
      expect(
        inboxV2TimelineCommandIntentEnvelopeSchema.safeParse({
          schemaId: "core:inbox-v2.timeline-command-intent",
          schemaVersion: "v1",
          payload: {
            ...intent,
            fileReadProofs: [{ ...intent.fileReadProofs[0], ...mismatch }]
          }
        }).success
      ).toBe(false);
    }

    expect(
      inboxV2AuthorizedCommandEnvelopeSchema.safeParse(
        authorizedTimelineCommand(
          intent,
          evidence.filter((item) => item.permissionId !== "core:file.view")
        )
      ).success
    ).toBe(false);

    const withoutFileDependency = {
      ...valid,
      payload: {
        ...valid.payload,
        principal: {
          ...valid.payload.principal,
          authorization: {
            ...valid.payload.principal.authorization,
            dependencies: {
              ...valid.payload.principal.authorization.dependencies,
              resourceDependencies:
                valid.payload.principal.authorization.dependencies.resourceDependencies.filter(
                  (dependency) =>
                    dependency.resource.entityTypeId !== "core:file"
                )
            }
          }
        }
      }
    };
    expect(
      inboxV2AuthorizedCommandEnvelopeSchema.safeParse(withoutFileDependency)
        .success
    ).toBe(false);
    const hiddenStaffNoteParent = {
      ...intent,
      fileReadProofs: [
        {
          ...intent.fileReadProofs[0],
          sourceParent: {
            kind: "staff_note" as const,
            conversation: sourceConversation,
            staffNote: {
              tenantId,
              kind: "staff_note" as const,
              id: "staff_note:hidden-parent"
            },
            expectedStaffNoteRevision: "4",
            parentConversationVisibility: "external_work" as const,
            visibilityBoundary: "staff_note" as const
          }
        }
      ]
    };
    expect(
      inboxV2TimelineCommandIntentEnvelopeSchema.safeParse({
        schemaId: "core:inbox-v2.timeline-command-intent",
        schemaVersion: "v1",
        payload: hiddenStaffNoteParent
      }).success
    ).toBe(true);
    expect(
      inboxV2AuthorizedCommandEnvelopeSchema.safeParse(
        authorizedTimelineCommand(hiddenStaffNoteParent, evidence)
      ).success
    ).toBe(false);
  });

  it("rejects an external reply without server-stamped reply authority", () => {
    const externalMessageReference = {
      tenantId,
      kind: "external_message_reference" as const,
      id: "external_message_reference:reply-target-1"
    };
    const sourceOccurrence = {
      tenantId,
      kind: "source_occurrence" as const,
      id: "source_occurrence:reply-target-1"
    };
    const replyIntent = {
      kind: "reply_external" as const,
      ...authoredIntentFields(),
      content: textContent(),
      externalMessageReference,
      sourceOccurrence,
      outboundRoute,
      routeAuthorization: routeAuthorization(),
      replyAuthority: {
        kind: "no_work_item" as const,
        appActor: employeeAppActor(),
        conversation,
        workItemSlot: {
          tenantId,
          kind: "conversation_work_item_slot" as const,
          id: "conversation_work_item_slot:conversation-1"
        },
        expectedSlotRevision: "3",
        intakeDecisionRevision: "5"
      },
      referenceContext: {
        kind: "reply" as const,
        target: {
          state: "resolved_external" as const,
          canonical: {
            conversation,
            message,
            timelineItem: {
              tenantId,
              kind: "timeline_item" as const,
              id: "timeline_item:reply-target-1"
            },
            messageRevision: "2"
          },
          external: { externalMessageReference, sourceOccurrence }
        }
      }
    };
    const evidence = [
      ...conversationEvidence("core:message.reply_external"),
      routeEvidence()
    ];

    expect(
      inboxV2AuthorizedCommandEnvelopeSchema.safeParse(
        authorizedTimelineCommand(replyIntent, evidence)
      ).success
    ).toBe(true);

    const { replyAuthority: _replyAuthority, ...withoutReplyAuthority } =
      replyIntent;
    expect(
      inboxV2TimelineCommandIntentEnvelopeSchema.safeParse({
        schemaId: "core:inbox-v2.timeline-command-intent",
        schemaVersion: "v1",
        payload: withoutReplyAuthority
      }).success
    ).toBe(true);
    expect(
      inboxV2AuthorizedCommandEnvelopeSchema.safeParse(
        authorizedTimelineCommand(withoutReplyAuthority, evidence)
      ).success
    ).toBe(false);
  });

  it("conjoins every active WorkItem reply relation and supervisor override", () => {
    const workItem = {
      tenantId,
      kind: "work_item" as const,
      id: "work_item:work-1"
    };
    const primaryAuthority = {
      kind: "active_primary_responsible" as const,
      appActor: employeeAppActor(),
      conversation,
      workItem,
      expectedWorkItemRevision: "7",
      primaryAssignment: {
        tenantId,
        kind: "work_item_primary_assignment" as const,
        id: "work_item_primary_assignment:assignment-1"
      },
      expectedAssignmentRevision: "3"
    };
    const collaboratorAuthority = {
      kind: "active_allowed_collaborator" as const,
      appActor: employeeAppActor(),
      conversation,
      workItem,
      expectedWorkItemRevision: "7",
      collaboratorEpisode: {
        tenantId,
        kind: "work_item_collaborator_episode" as const,
        id: "work_item_collaborator_episode:collaborator-1"
      },
      expectedCollaboratorRevision: "4",
      queueReplyPolicyRevision: "5"
    };
    const supervisorAuthority = {
      kind: "supervisor_override" as const,
      appActor: employeeAppActor(),
      conversation,
      workItem,
      expectedWorkItemRevision: "7",
      reasonId: "core:supervisor-override"
    };
    const baseEvidence = [
      ...conversationEvidence("core:message.reply_external"),
      routeEvidence(),
      workItemEvidence("core:work.read")
    ];

    for (const replyAuthority of [primaryAuthority, collaboratorAuthority]) {
      expect(
        inboxV2AuthorizedCommandEnvelopeSchema.safeParse(
          authorizedTimelineCommand(
            { ...sendExternalIntent(), replyAuthority },
            baseEvidence
          )
        ).success
      ).toBe(true);
    }
    expect(
      inboxV2AuthorizedCommandEnvelopeSchema.safeParse(
        authorizedTimelineCommand(
          { ...sendExternalIntent(), replyAuthority: supervisorAuthority },
          [...baseEvidence, workItemEvidence("core:work.override")]
        )
      ).success
    ).toBe(true);
    expect(
      inboxV2AuthorizedCommandEnvelopeSchema.safeParse(
        authorizedTimelineCommand(
          { ...sendExternalIntent(), replyAuthority: primaryAuthority },
          baseEvidence.filter(
            (item) => item.resource.entityTypeId !== "core:work-item"
          )
        )
      ).success
    ).toBe(false);
    expect(
      inboxV2AuthorizedCommandEnvelopeSchema.safeParse(
        authorizedTimelineCommand(
          { ...sendExternalIntent(), replyAuthority: supervisorAuthority },
          baseEvidence
        )
      ).success
    ).toBe(false);
    expect(
      inboxV2TimelineCommandIntentEnvelopeSchema.safeParse({
        schemaId: "core:inbox-v2.timeline-command-intent",
        schemaVersion: "v1",
        payload: {
          ...sendExternalIntent(),
          replyAuthority: {
            ...primaryAuthority,
            conversation: {
              ...conversation,
              id: "conversation:conversation-2"
            }
          }
        }
      }).success
    ).toBe(false);
    const trustedServiceActor = {
      kind: "trusted_service" as const,
      trustedServiceId: "core:automation"
    };
    expect(
      inboxV2TimelineCommandIntentEnvelopeSchema.safeParse({
        schemaId: "core:inbox-v2.timeline-command-intent",
        schemaVersion: "v1",
        payload: {
          ...sendExternalIntent(),
          appActor: trustedServiceActor,
          replyAuthority: {
            ...primaryAuthority,
            appActor: trustedServiceActor
          }
        }
      }).success
    ).toBe(false);
  });

  it("authorizes reaction_set on its exact TimelineItem with a separate Conversation read", () => {
    const evidence = lifecycleEvidence(
      "core:message.react",
      "core:conversation.internal.read"
    );
    const intent = {
      kind: "reaction_set" as const,
      tenantId,
      conversation,
      message,
      expectedMessageRevision: "6",
      targetProof: reactionMessageTargetProof(),
      actionParticipant: authorParticipant,
      appActor: {
        kind: "employee" as const,
        employee,
        authorizationEpoch
      },
      value: { kind: "unicode" as const, value: "👍" },
      target: { kind: "internal" as const },
      occurredAt: now
    };

    expect(
      inboxV2AuthorizedCommandEnvelopeSchema.safeParse(
        authorizedTimelineCommand(intent, evidence)
      ).success
    ).toBe(true);

    expect(
      inboxV2AuthorizedCommandEnvelopeSchema.safeParse(
        authorizedTimelineCommand(
          intent,
          conversationEvidence(
            "core:message.react",
            "core:conversation.internal.read"
          )
        )
      ).success
    ).toBe(false);

    const { targetProof: _targetProof, ...withoutTargetProof } = intent;
    expect(
      inboxV2TimelineCommandIntentEnvelopeSchema.safeParse({
        schemaId: "core:inbox-v2.timeline-command-intent",
        schemaVersion: "v1",
        payload: withoutTargetProof
      }).success
    ).toBe(true);
    expect(
      inboxV2AuthorizedCommandEnvelopeSchema.safeParse(
        authorizedTimelineCommand(withoutTargetProof, evidence)
      ).success
    ).toBe(false);

    const {
      expectedMessageRevision: _expectedMessageRevision,
      ...withoutExpectedRevision
    } = intent;
    expect(
      inboxV2TimelineCommandIntentEnvelopeSchema.safeParse({
        schemaId: "core:inbox-v2.timeline-command-intent",
        schemaVersion: "v1",
        payload: withoutExpectedRevision
      }).success
    ).toBe(true);
    expect(
      inboxV2AuthorizedCommandEnvelopeSchema.safeParse(
        authorizedTimelineCommand(withoutExpectedRevision, evidence)
      ).success
    ).toBe(false);

    expect(
      inboxV2TimelineCommandIntentSchema.safeParse({
        ...intent,
        targetProof: {
          ...intent.targetProof,
          expectedMessageRevision: "7"
        }
      }).success
    ).toBe(false);
  });

  it("requires exact own-or-moderation authority for message mutations", () => {
    const intent = {
      kind: "edit_message" as const,
      ...authoredIntentFields(),
      message,
      expectedMessageRevision: "6",
      mutationAuthority: {
        kind: "own" as const,
        appActor: employeeAppActor(),
        conversation,
        message,
        timelineItem,
        authorParticipant,
        expectedAuthorshipRevision: "2"
      },
      content: textContent(),
      transport: { kind: "internal" as const }
    };
    const evidence = lifecycleEvidence(
      "core:message.edit_own",
      "core:conversation.internal.read"
    );
    expect(
      inboxV2AuthorizedCommandEnvelopeSchema.safeParse(
        authorizedTimelineCommand(intent, evidence)
      ).success
    ).toBe(true);
    expect(
      inboxV2AuthorizedCommandEnvelopeSchema.safeParse(
        authorizedTimelineCommand(
          intent,
          conversationEvidence(
            "core:message.edit_own",
            "core:conversation.internal.read"
          )
        )
      ).success
    ).toBe(false);

    const moderateInternalIntent = {
      ...intent,
      mutationAuthority: {
        kind: "moderate_internal" as const,
        appActor: employeeAppActor(),
        conversation,
        message,
        timelineItem,
        reasonId: "core:moderation.internal"
      }
    };
    expect(
      inboxV2AuthorizedCommandEnvelopeSchema.safeParse(
        authorizedTimelineCommand(
          moderateInternalIntent,
          conversationEvidence(
            "core:message.moderate_internal",
            "core:conversation.internal.read"
          )
        )
      ).success
    ).toBe(true);

    const { mutationAuthority: _mutationAuthority, ...withoutAuthority } =
      intent;
    expect(
      inboxV2TimelineCommandIntentEnvelopeSchema.safeParse({
        schemaId: "core:inbox-v2.timeline-command-intent",
        schemaVersion: "v1",
        payload: withoutAuthority
      }).success
    ).toBe(true);
    expect(
      inboxV2AuthorizedCommandEnvelopeSchema.safeParse(
        authorizedTimelineCommand(withoutAuthority, evidence)
      ).success
    ).toBe(false);
    expect(
      inboxV2TimelineCommandIntentEnvelopeSchema.safeParse({
        schemaId: "core:inbox-v2.timeline-command-intent",
        schemaVersion: "v1",
        payload: {
          ...intent,
          mutationAuthority: {
            kind: "moderate_external",
            appActor: employeeAppActor(),
            conversation,
            message,
            timelineItem,
            reasonId: "core:moderation"
          }
        }
      }).success
    ).toBe(false);
  });

  it("requires edit attachment parent authority and exact File upload evidence", () => {
    const baseIntent = {
      kind: "edit_message" as const,
      ...authoredIntentFields(),
      message,
      expectedMessageRevision: "6",
      mutationAuthority: {
        kind: "own" as const,
        appActor: employeeAppActor(),
        conversation,
        message,
        timelineItem,
        authorParticipant,
        expectedAuthorshipRevision: "2"
      },
      content: readyAttachmentContent()
    };
    const internalIntent = {
      ...baseIntent,
      fileReadProofs: [uploadStagingFileReadProof("internal")],
      transport: { kind: "internal" as const }
    };
    const internalSendEvidence = conversationEvidence(
      "core:message.send_internal",
      "core:conversation.internal.read"
    )[1]!;
    const internalEvidence = [
      ...lifecycleEvidence(
        "core:message.edit_own",
        "core:conversation.internal.read"
      ),
      internalSendEvidence,
      fileEvidence(),
      fileUploadEvidence()
    ];

    const parsedInternal = inboxV2AuthorizedCommandEnvelopeSchema.safeParse(
      authorizedTimelineCommand(internalIntent, internalEvidence)
    );
    expect(
      parsedInternal.success,
      parsedInternal.success
        ? undefined
        : JSON.stringify(parsedInternal.error.issues, null, 2)
    ).toBe(true);
    if (!parsedInternal.success) {
      throw new Error("expected authorized internal attachment edit");
    }
    expect(
      parsedInternal.data.payload.authorizationDecisionRefs.filter(
        ({ permissionId }) => permissionId === "core:conversation.internal.read"
      )
    ).toHaveLength(1);
    const canonicalInternalIntent =
      inboxV2TimelineCommandIntentSchema.parse(internalIntent);
    if (canonicalInternalIntent.kind !== "edit_message") {
      throw new Error("expected canonical edit intent");
    }
    expect(
      deriveInboxV2MessageEditFileUploadAuthorityPlan(canonicalInternalIntent)
    ).toEqual([
      {
        file: readyFile,
        expectedFileRevision: "9"
      }
    ]);
    expect(
      deriveInboxV2MessageEditFileSourceAuthorityPlan(canonicalInternalIntent, {
        message: canonicalInternalIntent.message,
        expectedMessageRevision: inboxV2EntityRevisionSchema.parse("7")
      })
    ).toEqual([
      {
        blockKey: "file-1",
        purpose: "attachment",
        attachment: {
          tenantId,
          kind: "message_attachment",
          id: "message_attachment:attachment-1"
        },
        file: readyFile,
        expectedFileRevision: "9",
        fileVersion: readyFileVersion,
        objectVersion: readyObjectVersion,
        targetParent: {
          kind: "message",
          message,
          expectedMessageRevision: "7"
        },
        sourceParent: {
          kind: "upload_staging",
          appActor: employeeAppActor(),
          uploadRevision: "1"
        }
      }
    ]);
    expect(
      deriveInboxV2MessageEditFileUploadAuthorityPlan(
        inboxV2TimelineCommandIntentSchema.parse({
          ...internalIntent,
          fileReadProofs: [
            {
              ...internalIntent.fileReadProofs[0],
              sourceParent: {
                kind: "message",
                conversation,
                message,
                expectedMessageRevision: "6",
                visibilityBoundary: "internal"
              }
            }
          ]
        }) as Extract<
          ReturnType<typeof inboxV2TimelineCommandIntentSchema.parse>,
          { kind: "edit_message" }
        >
      )
    ).toEqual([]);

    for (const missingPermissionId of [
      "core:message.send_internal",
      "core:file.view",
      "core:file.upload"
    ]) {
      expect(
        inboxV2AuthorizedCommandEnvelopeSchema.safeParse(
          authorizedTimelineCommand(
            internalIntent,
            internalEvidence.filter(
              ({ permissionId }) => permissionId !== missingPermissionId
            )
          )
        ).success
      ).toBe(false);
    }

    const wrongUploadEvidence: AuthorizationEvidence = {
      permissionId: "core:file.upload",
      resourceScopeId: "core:conversation",
      resource: {
        tenantId,
        entityTypeId: "core:conversation",
        entityId: conversation.id
      },
      accessRevision: "4"
    };
    expect(
      inboxV2AuthorizedCommandEnvelopeSchema.safeParse(
        authorizedTimelineCommand(internalIntent, [
          ...internalEvidence.filter(
            ({ permissionId }) => permissionId !== "core:file.upload"
          ),
          wrongUploadEvidence
        ])
      ).success
    ).toBe(false);

    const externalIntent = {
      ...baseIntent,
      fileReadProofs: [uploadStagingFileReadProof("external_work")],
      transport: {
        kind: "external" as const,
        externalMessageReference: {
          tenantId,
          kind: "external_message_reference" as const,
          id: "external_message_reference:message-1"
        },
        sourceOccurrence: {
          tenantId,
          kind: "source_occurrence" as const,
          id: "source_occurrence:message-1"
        },
        outboundRoute,
        routeAuthorization: routeAuthorization()
      }
    };
    const externalReplyEvidence = conversationEvidence(
      "core:message.reply_external"
    )[1]!;
    const externalEvidence = [
      ...lifecycleEvidence("core:message.edit_own"),
      externalReplyEvidence,
      routeEvidence(),
      fileEvidence(),
      fileUploadEvidence()
    ];
    const parsedExternal = inboxV2AuthorizedCommandEnvelopeSchema.safeParse(
      authorizedTimelineCommand(externalIntent, externalEvidence)
    );
    expect(
      parsedExternal.success,
      parsedExternal.success
        ? undefined
        : JSON.stringify(parsedExternal.error.issues, null, 2)
    ).toBe(true);
    expect(
      inboxV2AuthorizedCommandEnvelopeSchema.safeParse(
        authorizedTimelineCommand(
          externalIntent,
          externalEvidence.filter(
            ({ permissionId }) => permissionId !== "core:message.reply_external"
          )
        )
      ).success
    ).toBe(false);
  });

  it("binds reaction replacement to its canonical Message and owner", () => {
    const reaction = {
      tenantId,
      kind: "message_reaction" as const,
      id: "message_reaction:reaction-1"
    };
    const intent = {
      kind: "reaction_replace" as const,
      tenantId,
      conversation,
      reaction,
      expectedReactionRevision: "3",
      targetProof: {
        conversation,
        reaction,
        message,
        timelineItem,
        expectedMessageRevision: "6",
        expectedTimelineItemRevision: "6",
        ownerParticipant: authorParticipant
      },
      actionParticipant: authorParticipant,
      appActor: employeeAppActor(),
      value: { kind: "unicode" as const, value: "👍" },
      target: { kind: "internal" as const },
      occurredAt: now
    };
    const evidence = lifecycleEvidence(
      "core:message.react",
      "core:conversation.internal.read"
    );
    expect(
      inboxV2AuthorizedCommandEnvelopeSchema.safeParse(
        authorizedTimelineCommand(intent, evidence)
      ).success
    ).toBe(true);
    expect(
      inboxV2AuthorizedCommandEnvelopeSchema.safeParse(
        authorizedTimelineCommand(
          intent,
          conversationEvidence(
            "core:message.react",
            "core:conversation.internal.read"
          )
        )
      ).success
    ).toBe(false);
    const { targetProof: _targetProof, ...withoutTargetProof } = intent;
    expect(
      inboxV2TimelineCommandIntentEnvelopeSchema.safeParse({
        schemaId: "core:inbox-v2.timeline-command-intent",
        schemaVersion: "v1",
        payload: withoutTargetProof
      }).success
    ).toBe(true);
    expect(
      inboxV2AuthorizedCommandEnvelopeSchema.safeParse(
        authorizedTimelineCommand(withoutTargetProof, evidence)
      ).success
    ).toBe(false);
  });

  it("requires exact provider-native forward source visibility proof", () => {
    const externalMessageReference = {
      tenantId,
      kind: "external_message_reference" as const,
      id: "external_message_reference:native-source-1"
    };
    const sourceOccurrence = {
      tenantId,
      kind: "source_occurrence" as const,
      id: "source_occurrence:native-source-1"
    };
    const intent = {
      kind: "forward_provider_native" as const,
      ...authoredIntentFields(),
      outboundRoute,
      routeAuthorization: routeAuthorization(),
      replyAuthority: noWorkItemReplyAuthority(),
      sourceReadProofs: [
        {
          conversation: sourceConversation,
          externalMessageReference,
          sourceOccurrence,
          sourceAccount,
          sourceThreadBinding,
          bindingFence: routeAuthorization().bindingFence,
          expectedSourceOccurrenceRevision: "11",
          visibilityBoundary: "external_work" as const
        }
      ],
      referenceContext: {
        kind: "forward_provider_native" as const,
        sources: [{ externalMessageReference, sourceOccurrence }],
        capability: {
          capabilityId: "core:provider-native-forward",
          capabilityRevision: "5",
          adapterContract: {
            contractId: "module:synthetic:direct-account-adapter",
            contractVersion: "v1",
            declarationRevision: "7",
            surfaceId: "module:synthetic:direct-account",
            loadedByTrustedServiceId: "core:source-runtime",
            loadedAt: now
          },
          decision: "supported" as const
        }
      }
    };
    const evidence = [
      ...conversationEvidence("core:message.forward_external"),
      sourceConversationEvidence(),
      routeEvidence()
    ];

    expect(
      inboxV2AuthorizedCommandEnvelopeSchema.safeParse(
        authorizedTimelineCommand(intent, evidence)
      ).success
    ).toBe(true);

    const secondExternalMessageReference = {
      ...externalMessageReference,
      id: "external_message_reference:native-source-2"
    };
    const secondSourceOccurrence = {
      ...sourceOccurrence,
      id: "source_occurrence:native-source-2"
    };
    expect(
      inboxV2TimelineCommandIntentEnvelopeSchema.safeParse({
        schemaId: "core:inbox-v2.timeline-command-intent",
        schemaVersion: "v1",
        payload: {
          ...intent,
          sourceReadProofs: [
            ...intent.sourceReadProofs,
            {
              ...intent.sourceReadProofs[0],
              externalMessageReference: secondExternalMessageReference,
              sourceOccurrence: secondSourceOccurrence
            }
          ],
          referenceContext: {
            ...intent.referenceContext,
            sources: [
              ...intent.referenceContext.sources,
              {
                externalMessageReference: secondExternalMessageReference,
                sourceOccurrence: secondSourceOccurrence
              }
            ]
          }
        }
      }).success
    ).toBe(false);

    const { sourceReadProofs: _sourceReadProofs, ...withoutSourceProof } =
      intent;
    expect(
      inboxV2TimelineCommandIntentEnvelopeSchema.safeParse({
        schemaId: "core:inbox-v2.timeline-command-intent",
        schemaVersion: "v1",
        payload: withoutSourceProof
      }).success
    ).toBe(true);
    expect(
      inboxV2AuthorizedCommandEnvelopeSchema.safeParse(
        authorizedTimelineCommand(withoutSourceProof, evidence)
      ).success
    ).toBe(false);

    expect(
      inboxV2TimelineCommandIntentEnvelopeSchema.safeParse({
        schemaId: "core:inbox-v2.timeline-command-intent",
        schemaVersion: "v1",
        payload: {
          ...intent,
          sourceReadProofs: [
            {
              ...intent.sourceReadProofs[0],
              externalMessageReference: {
                ...externalMessageReference,
                id: "external_message_reference:guessed-source"
              }
            }
          ]
        }
      }).success
    ).toBe(false);
    const crossAccountSource = {
      ...intent,
      sourceReadProofs: [
        {
          ...intent.sourceReadProofs[0],
          sourceAccount: {
            ...sourceAccount,
            id: "source_account:account-2"
          }
        }
      ]
    };
    expect(
      inboxV2TimelineCommandIntentEnvelopeSchema.safeParse({
        schemaId: "core:inbox-v2.timeline-command-intent",
        schemaVersion: "v1",
        payload: crossAccountSource
      }).success
    ).toBe(true);
    expect(
      inboxV2AuthorizedCommandEnvelopeSchema.safeParse(
        authorizedTimelineCommand(crossAccountSource, evidence)
      ).success
    ).toBe(false);
  });

  it("replays the original result for the same mutation/hash and conflicts on a changed request", () => {
    const scope = {
      tenantId,
      principal: { kind: "employee" as const, employee },
      commandTypeId: "core:timeline.command",
      clientMutationId: "mutation:mutation-1"
    };
    const existing = inboxV2CommandIdempotencyRecordSchema.parse({
      scope,
      commandId: "command:command-1",
      firstRequestId: "request:first",
      requestHash: hashA,
      state: { kind: "completed", result: result() }
    });

    expect(
      decideInboxV2CommandIdempotency({ scope, requestHash: hashA, existing })
    ).toEqual({ kind: "replay", result: result() });
    expect(
      decideInboxV2CommandIdempotency({ scope, requestHash: hashB, existing })
    ).toEqual({
      kind: "conflict",
      errorCode: "command.idempotency_conflict"
    });
    expect(
      decideInboxV2CommandIdempotency({
        scope: {
          ...scope,
          principal: {
            kind: "employee",
            employee: {
              tenantId,
              kind: "employee",
              id: "employee:employee-2"
            }
          }
        },
        requestHash: hashA,
        existing
      })
    ).toEqual({ kind: "execute" });
  });

  it("keeps true no-op results outside stream/cursor/outbox state", () => {
    const noOp = result("no_op");
    expect(inboxV2CommandResultSchema.parse(noOp)).toEqual(noOp);
    expect(
      inboxV2CommandResultSchema.safeParse({
        ...noOp,
        principal: {
          kind: "employee",
          employee: { ...employee, tenantId: "tenant:tenant-2" }
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2CommandIdempotencyScopeSchema.safeParse({
        tenantId,
        principal: {
          kind: "employee",
          employee: { ...employee, tenantId: "tenant:tenant-2" }
        },
        commandTypeId: "core:timeline.command",
        clientMutationId: "mutation:mutation-1"
      }).success
    ).toBe(false);
    expect(
      inboxV2CommandResultSchema.safeParse({
        ...noOp,
        streamPosition: "1"
      }).success
    ).toBe(false);
    expect(
      inboxV2CommandResultSchema.safeParse({
        ...noOp,
        cursor: "opaque-cursor-value"
      }).success
    ).toBe(false);
  });

  it("parses frozen v1 command-result bytes and rejects a forward envelope", () => {
    const archived = JSON.parse(archivedV1CommandResultBytes) as Record<
      string,
      unknown
    >;
    expect(parseInboxV2CommandResultEnvelope(archived).kind).toBe("parsed");
    expect(
      parseInboxV2CommandResultEnvelope({
        ...archived,
        schemaVersion: "v2"
      })
    ).toEqual({
      kind: "rejected",
      errorCode: "command.schema_unsupported",
      cursorAdvance: null
    });
  });

  it("reauthorizes stored results and falls back to non-sensitive status", () => {
    expect(
      discloseInboxV2CommandResult({
        result: result(),
        tenantId,
        principal: { kind: "employee", employee },
        currentAuthorizationEpoch: authorizationEpoch,
        mayReadResult: true
      }).kind
    ).toBe("authorized");
    expect(
      discloseInboxV2CommandResult({
        result: result(),
        tenantId,
        principal: { kind: "employee", employee },
        currentAuthorizationEpoch: "authorization:epoch-0002",
        mayReadResult: true
      })
    ).toEqual({
      kind: "status_only",
      status: "committed",
      commandId: "command:command-1"
    });
    expect(
      discloseInboxV2CommandResult({
        result: result(),
        tenantId: "tenant:tenant-2",
        principal: {
          kind: "employee",
          employee: {
            tenantId: "tenant:tenant-2",
            kind: "employee",
            id: "employee:employee-1"
          }
        },
        currentAuthorizationEpoch: authorizationEpoch,
        mayReadResult: true
      })
    ).toEqual({ kind: "not_found" });
    expect(
      discloseInboxV2CommandResult({
        result: result(),
        tenantId,
        principal: {
          kind: "employee",
          employee: {
            tenantId,
            kind: "employee",
            id: "employee:employee-2"
          }
        },
        currentAuthorizationEpoch: authorizationEpoch,
        mayReadResult: false
      })
    ).toEqual({ kind: "not_found" });
  });
});
