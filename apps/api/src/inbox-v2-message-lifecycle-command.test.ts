import { describe, expect, it, vi } from "vitest";

import {
  calculateInboxV2CanonicalSha256,
  calculateInboxV2MessageContentDigest,
  INBOX_V2_MESSAGE_PROVIDER_LIFECYCLE_CREATION_COMMIT_SCHEMA_ID,
  INBOX_V2_MESSAGE_PROVIDER_LIFECYCLE_OPERATION_ENTITY_TYPE_ID,
  INBOX_V2_MESSAGE_PROVIDER_LIFECYCLE_OPERATION_SCHEMA_ID,
  INBOX_V2_MESSAGE_PROVIDER_LIFECYCLE_SCHEMA_VERSION,
  INBOX_V2_MESSAGE_LIFECYCLE_SCHEMA_VERSION,
  INBOX_V2_MESSAGE_REVISION_SCHEMA_ID,
  INBOX_V2_MESSAGE_SCHEMA_ID,
  INBOX_V2_MESSAGE_SCHEMA_VERSION,
  inboxV2AuthorizationDecisionReferenceSchema,
  inboxV2AuthorizationEpochSchema,
  inboxV2AuthorizedCommandSchema,
  inboxV2MessageSchema,
  inboxV2MessageMutationCommitSchema,
  inboxV2MessageProviderLifecycleOperationCreationCommitSchema,
  inboxV2OutboundRoutePrincipalSchema,
  inboxV2TenantIdSchema,
  inboxV2TimelineCommandIntentSchema,
  inboxV2TimelineContentDraftSchema,
  inboxV2TimelineContentHeadOf,
  inboxV2TimelineItemSchema,
  type InboxV2AuthorizationDecisionReference,
  type InboxV2AuthorizedCommand,
  type InboxV2MessageProviderLifecycleOperationCreationCommit,
  type InboxV2TimelineCommandIntent
} from "@hulee/contracts";
import {
  evaluateInboxV2AuthorizationPlan,
  type InboxV2AuthorizationPlanInput,
  type InboxV2SecurityDenialContext,
  type InboxV2SecurityDenialSink
} from "@hulee/core";
import {
  type InboxV2PrivilegedAuthorizationMutationAppliedStatus,
  type InboxV2PrivilegedAuthorizationMutationReplayStatus,
  type WithInboxV2AuthorizedCommandMutationInput
} from "@hulee/db";
import {
  fixtureAdapterContract,
  fixtureBindingReference,
  fixtureContent,
  fixtureConversationReference,
  fixtureEmployeeActor,
  fixtureEmployeeReference,
  fixtureExternalMessageReference,
  fixtureExternalReference,
  fixtureExternalTargetRoute,
  fixtureMessage,
  fixtureMessageReference,
  fixtureOccurrence,
  fixtureOutboundBindingSnapshot,
  fixtureParticipant,
  fixtureReference,
  fixtureRouteReference,
  fixtureSourceAccountReference,
  fixtureSourceOccurrenceReference,
  fixtureT1,
  fixtureT3,
  fixtureT4,
  fixtureTenantId,
  fixtureTimelineItem,
  fixtureTimelineItemReference
} from "../../../packages/contracts/src/inbox-v2/timeline-message-fixtures.type-fixture";

import {
  calculateInboxV2MessageLifecycleIntentDigest,
  createInboxV2MessageLifecycleCommandService,
  type InboxV2MessageLifecycleAtomicCoordinator,
  type InboxV2MessageLifecycleCommand,
  type InboxV2MessageLifecycleCommandPreparer,
  type InboxV2MessageLifecycleCommandServiceOptions,
  type InboxV2MessageLifecycleIdempotencyScope,
  type InboxV2MessageLifecycleRequestScope,
  type InboxV2PreparedMessageLifecycleCommand
} from "./inbox-v2-message-lifecycle-command";

const requestScope: InboxV2MessageLifecycleRequestScope = {
  tenantId: inboxV2TenantIdSchema.parse(fixtureTenantId),
  principal: inboxV2OutboundRoutePrincipalSchema.parse({
    kind: "employee" as const,
    employee: fixtureEmployeeReference
  }),
  authorizationEpoch: inboxV2AuthorizationEpochSchema.parse(
    fixtureEmployeeActor.authorizationEpoch
  )
};

describe("Inbox V2 Message lifecycle command", () => {
  it("returns a committed replay before loading mutable Message/route state", async () => {
    const command = editFixture(false).command;
    const prepareNew = vi.fn();
    const coordinator = coordinatorThatMustNotRun();
    const service = createInboxV2MessageLifecycleCommandService({
      requestScope,
      preparer: {
        lookupIdempotency: vi.fn(async () => ({
          kind: "committed_replay" as const,
          requestHash: calculateInboxV2MessageLifecycleIntentDigest(command),
          scope: idempotencyScope(command),
          status: replayStatus(command, fixtureMessageReference.id)
        })),
        prepareNew
      },
      denialSink: denialSink(),
      coordinator
    });

    await expect(service.execute(command)).resolves.toMatchObject({
      outcome: "already_applied",
      action: "edit",
      targetId: fixtureMessageReference.id
    });
    expect(prepareNew).not.toHaveBeenCalled();
    expect(
      coordinator.withAuthorizedMessageLifecycleMutation
    ).not.toHaveBeenCalled();
  });

  it("discloses a stale Message revision only after authorization", async () => {
    const command = localDeleteFixture().command;
    const authorizationGate = vi.fn(allowGate()) as unknown as NonNullable<
      InboxV2MessageLifecycleCommandServiceOptions["authorizationGate"]
    >;
    const service = createInboxV2MessageLifecycleCommandService({
      requestScope,
      preparer: {
        lookupIdempotency: vi.fn(async () => null),
        prepareNew: vi.fn(async () => ({
          kind: "revision_conflict" as const,
          requestHash: calculateInboxV2MessageLifecycleIntentDigest(command),
          scope: idempotencyScope(command),
          visibilityBoundary: "internal" as const,
          disclosureAuthorizationPlan: disclosureAuthorizationPlan(
            command,
            "internal"
          ),
          denialContext: {} as InboxV2SecurityDenialContext
        }))
      },
      denialSink: denialSink(),
      coordinator: coordinatorThatMustNotRun(),
      authorizationGate
    });

    await expect(service.execute(command)).resolves.toEqual({
      outcome: "revision_conflict"
    });
    expect(authorizationGate).toHaveBeenCalledOnce();
  });

  it("applies an internal edit with no provider operation or provider outbox", async () => {
    const fixture = editFixture(false);
    const coordinator = appliedCoordinator(fixture);
    const service = serviceFor(fixture, coordinator);

    await expect(service.execute(fixture.command)).resolves.toMatchObject({
      outcome: "edited",
      messageId: fixture.command.messageId,
      messageRevision: "2"
    });
    const input = vi.mocked(coordinator.withAuthorizedMessageLifecycleMutation)
      .mock.calls[0]?.[0];
    expect(input?.providerOperationCreation).toBeNull();
    expect(
      input?.authorizedMutation.records.outboxIntents.filter(
        (intent) => intent.effectClass === "provider_io"
      )
    ).toEqual([]);
  });

  it("applies internal moderation with primary and read decisions on the same Conversation revision", async () => {
    const fixture = editFixture(false, false, "moderate_internal");
    const coordinator = appliedCoordinator(fixture);
    const service = serviceFor(fixture, coordinator);

    await expect(service.execute(fixture.command)).resolves.toMatchObject({
      outcome: "edited",
      messageRevision: "2"
    });
    const primary =
      fixture.prepared.authorizedCommand.authorizationDecisionRefs.find(
        ({ permissionId }) => permissionId === "core:message.moderate_internal"
      );
    const read =
      fixture.prepared.authorizedCommand.authorizationDecisionRefs.find(
        ({ permissionId }) => permissionId === "core:conversation.internal.read"
      );
    expect(primary).toMatchObject({
      resourceScopeId: "core:conversation",
      resource: {
        entityTypeId: "core:conversation",
        entityId: fixtureConversationReference.id
      },
      resourceAccessRevision: "1"
    });
    expect(read?.resourceAccessRevision).toBe(primary?.resourceAccessRevision);
    expect(
      coordinator.withAuthorizedMessageLifecycleMutation
    ).toHaveBeenCalledOnce();
  });

  it("keeps a migrated internal Message on internal moderation and read authority", async () => {
    const fixture = editFixture(false, false, "moderate_internal", "migration");
    const coordinator = appliedCoordinator(fixture);
    const service = serviceFor(fixture, coordinator);

    await expect(service.execute(fixture.command)).resolves.toMatchObject({
      outcome: "edited",
      messageRevision: "2"
    });
    expect(
      fixture.prepared.authorizedCommand.authorizationDecisionRefs.map(
        ({ permissionId }) => permissionId
      )
    ).toEqual([
      "core:conversation.internal.read",
      "core:message.moderate_internal"
    ]);
    expect(fixture.messageMutation?.beforeMessage.origin.kind).toBe(
      "migration"
    );
    expect(fixture.messageMutation?.beforeTimelineItem.visibility).toBe(
      "internal_participants"
    );
  });

  it("applies external moderation with TimelineItem primary authority and read-only route authority", async () => {
    const externalFixture = editFixture(true, false, "moderate_external");
    const coordinator = appliedCoordinator(externalFixture);
    const service = serviceFor(externalFixture, coordinator);

    await expect(
      service.execute(externalFixture.command)
    ).resolves.toMatchObject({
      outcome: "edited",
      messageRevision: "2"
    });
    expect(
      externalFixture.prepared.authorizedCommand.authorizationDecisionRefs.find(
        ({ permissionId }) => permissionId === "core:message.moderate_external"
      )
    ).toMatchObject({
      resourceScopeId: "core:timeline-item",
      resource: {
        entityTypeId: "core:timeline-item",
        entityId: externalFixture.messageMutation?.beforeTimelineItem.id
      },
      resourceAccessRevision: "1"
    });
    expect(
      coordinator.withAuthorizedMessageLifecycleMutation
    ).toHaveBeenCalledOnce();
  });

  it("applies an edit with an exact upload-staging file proof and shared Conversation fence", async () => {
    const fixture = editFixture(false, true);
    const authorizationPlan = executableInternalAuthorizationPlan(fixture);
    const prepared = { ...fixture.prepared, authorizationPlan };
    const coordinator = appliedCoordinator(fixture);
    const service = createInboxV2MessageLifecycleCommandService({
      requestScope,
      preparer: preparerReturning(prepared),
      denialSink: denialSink(),
      coordinator
    });

    expect(evaluateInboxV2AuthorizationPlan(authorizationPlan)).toMatchObject({
      outcome: "allowed"
    });
    await expect(service.execute(fixture.command)).resolves.toMatchObject({
      outcome: "edited",
      messageRevision: "2"
    });
    expect(
      fixture.prepared.authorizedCommand.authorizationDecisionRefs.map(
        ({ permissionId }) => permissionId
      )
    ).toEqual([
      "core:conversation.internal.read",
      "core:message.edit_own",
      "core:message.send_internal",
      "core:file.view",
      "core:file.upload"
    ]);
    expect(fixture.prepared.authorizedMutation.revisions.resources).toEqual([
      expect.objectContaining({
        resourceKind: "conversation",
        resourceId: fixtureConversationReference.id,
        expectedResourceAccessRevision: "1",
        advance: "none"
      })
    ]);
    expect(
      coordinator.withAuthorizedMessageLifecycleMutation
    ).toHaveBeenCalledOnce();
  });

  it("passes the exact upload-only subset for a retained plus upload-staging edit through the default Core gate", async () => {
    const fixture = editFixture(false, "mixed");
    const authorizationPlan = executableInternalAuthorizationPlan(fixture);
    const coordinator = appliedCoordinator(fixture);
    const service = createInboxV2MessageLifecycleCommandService({
      requestScope,
      preparer: preparerReturning({
        ...fixture.prepared,
        authorizationPlan
      }),
      denialSink: denialSink(),
      coordinator
    });

    expect(evaluateInboxV2AuthorizationPlan(authorizationPlan)).toMatchObject({
      outcome: "allowed"
    });
    await expect(service.execute(fixture.command)).resolves.toMatchObject({
      outcome: "edited",
      messageRevision: "2"
    });
    const input = vi.mocked(coordinator.withAuthorizedMessageLifecycleMutation)
      .mock.calls[0]?.[0];
    expect(input?.fileUploadAuthorityPlan).toEqual([
      {
        file: expect.objectContaining({ id: "file:lifecycle-upload-1" }),
        expectedFileRevision: "1"
      }
    ]);
    expect(
      input?.fileSourceAuthorityPlan.map((target) => ({
        fileId: target.file.id,
        targetMessageId: target.targetParent.message.id,
        targetMessageRevision: target.targetParent.expectedMessageRevision,
        sourceKind: target.sourceParent.kind
      }))
    ).toEqual([
      {
        fileId: "file:lifecycle-retained-1",
        targetMessageId: fixtureMessageReference.id,
        targetMessageRevision: "2",
        sourceKind: "message"
      },
      {
        fileId: "file:lifecycle-upload-1",
        targetMessageId: fixtureMessageReference.id,
        targetMessageRevision: "2",
        sourceKind: "upload_staging"
      }
    ]);
    expect(
      input?.authorizedMutation.records.audit.authorizationDecisionRefs
        .filter(({ permissionId }) => permissionId === "core:file.view")
        .map(({ resource }) => String(resource.entityId))
        .sort()
    ).toEqual(["file:lifecycle-retained-1", "file:lifecycle-upload-1"]);
    expect(
      input?.authorizedMutation.records.audit.authorizationDecisionRefs
        .filter(({ permissionId }) => permissionId === "core:file.upload")
        .map(({ resource }) => String(resource.entityId))
    ).toEqual(["file:lifecycle-upload-1"]);
  });

  it.each(["stale File revision", "missing parent authority"] as const)(
    "denies an attachment edit with %s before the coordinator",
    async (field) => {
      const fixture = editFixture(false, true);
      const authorizationPlan = executableInternalAuthorizationPlan(fixture);
      const forgedPlan =
        field === "missing parent authority"
          ? {
              ...authorizationPlan,
              grants: authorizationPlan.grants.filter(
                ({ permissionId }) =>
                  permissionId !== "core:message.send_internal"
              )
            }
          : {
              ...authorizationPlan,
              requirements: authorizationPlan.requirements.map((requirement) =>
                requirement.permissionId === "core:file.upload" &&
                requirement.guard.profileId ===
                  "core:rbac.guard.file_parent_content"
                  ? {
                      ...requirement,
                      guard: {
                        ...requirement.guard,
                        currentFileRevision: "2"
                      }
                    }
                  : requirement
              )
            };
      const coordinator = coordinatorThatMustNotRun();
      const service = createInboxV2MessageLifecycleCommandService({
        requestScope,
        preparer: preparerReturning({
          ...fixture.prepared,
          authorizationPlan:
            forgedPlan as unknown as InboxV2AuthorizationPlanInput
        }),
        denialSink: denialSink(),
        coordinator
      });

      expect(
        evaluateInboxV2AuthorizationPlan(
          forgedPlan as unknown as InboxV2AuthorizationPlanInput
        )
      ).toMatchObject({ outcome: "denied" });
      if (field === "stale File revision") {
        await expect(service.execute(fixture.command)).rejects.toThrow(
          "permission.denied"
        );
      } else {
        await expect(service.execute(fixture.command)).resolves.toMatchObject({
          outcome: "denied",
          errorCode: "resource.not_found"
        });
      }
      expect(
        coordinator.withAuthorizedMessageLifecycleMutation
      ).not.toHaveBeenCalled();
    }
  );

  it("rejects a staging File guard bound to another uploader before the Core gate", async () => {
    const fixture = editFixture(false, true);
    const authorizationPlan = executableInternalAuthorizationPlan(fixture);
    const forgedPlan = {
      ...authorizationPlan,
      requirements: authorizationPlan.requirements.map((requirement) =>
        (requirement.permissionId === "core:file.view" ||
          requirement.permissionId === "core:file.upload") &&
        requirement.guard.profileId === "core:rbac.guard.file_parent_content"
          ? {
              ...requirement,
              guard: {
                ...requirement.guard,
                uploaderEmployeeId: "employee:other-uploader",
                uploaderEmployeeResource: {
                  tenantId: fixtureTenantId,
                  entityTypeId: "core:employee" as const,
                  entityId: "employee:other-uploader"
                }
              }
            }
          : requirement
      )
    } as unknown as InboxV2AuthorizationPlanInput;
    expect(evaluateInboxV2AuthorizationPlan(forgedPlan)).toMatchObject({
      outcome: "allowed"
    });
    const authorizationGate = vi.fn(allowGate()) as unknown as NonNullable<
      InboxV2MessageLifecycleCommandServiceOptions["authorizationGate"]
    >;
    const coordinator = coordinatorThatMustNotRun();
    const service = createInboxV2MessageLifecycleCommandService({
      requestScope,
      preparer: preparerReturning({
        ...fixture.prepared,
        authorizationPlan: forgedPlan
      }),
      denialSink: denialSink(),
      coordinator,
      authorizationGate
    });

    await expect(service.execute(fixture.command)).rejects.toThrow();
    expect(authorizationGate).not.toHaveBeenCalled();
    expect(
      coordinator.withAuthorizedMessageLifecycleMutation
    ).not.toHaveBeenCalled();
  });

  it.each([
    "missing file decision",
    "missing Conversation fence",
    "forged Conversation fence",
    "unbacked extra fence"
  ] as const)(
    "rejects upload-staging attachment closure with %s before authorization/write",
    async (field) => {
      const fixture = editFixture(false, true);
      const selected = fixture.prepared;
      const forged =
        field === "missing file decision"
          ? {
              ...selected,
              authorizedCommand: {
                ...selected.authorizedCommand,
                authorizationDecisionRefs:
                  selected.authorizedCommand.authorizationDecisionRefs.filter(
                    ({ permissionId }) => permissionId !== "core:file.view"
                  )
              }
            }
          : {
              ...selected,
              authorizedMutation: {
                ...selected.authorizedMutation,
                revisions: {
                  ...selected.authorizedMutation.revisions,
                  resources:
                    field === "missing Conversation fence"
                      ? []
                      : field === "forged Conversation fence"
                        ? selected.authorizedMutation.revisions.resources.map(
                            (fence) => ({
                              ...fence,
                              expectedResourceAccessRevision: "2"
                            })
                          )
                        : [
                            ...selected.authorizedMutation.revisions.resources,
                            {
                              resourceKind: "client" as const,
                              resourceId: "client:forged",
                              resourceHeadId:
                                "authorization_resource_head:forged-client",
                              expectedResourceAccessRevision: "1",
                              advance: "none" as const
                            }
                          ]
                }
              }
            };
      const coordinator = coordinatorThatMustNotRun();
      const authorizationGate = vi.fn(allowGate()) as unknown as NonNullable<
        InboxV2MessageLifecycleCommandServiceOptions["authorizationGate"]
      >;
      const service = createInboxV2MessageLifecycleCommandService({
        requestScope,
        preparer: preparerReturning(
          forged as unknown as InboxV2PreparedMessageLifecycleCommand
        ),
        denialSink: denialSink(),
        coordinator,
        authorizationGate
      });

      await expect(service.execute(fixture.command)).rejects.toThrow();
      expect(authorizationGate).not.toHaveBeenCalled();
      expect(
        coordinator.withAuthorizedMessageLifecycleMutation
      ).not.toHaveBeenCalled();
    }
  );

  it("allows an exact internal local delete through the default core authorization gate", async () => {
    const fixture = localDeleteFixture(false);
    const authorizationPlan = executableInternalAuthorizationPlan(fixture);
    const prepared = {
      ...fixture.prepared,
      authorizationPlan
    };
    const coordinator = appliedCoordinator(fixture);
    const service = createInboxV2MessageLifecycleCommandService({
      requestScope,
      preparer: preparerReturning(prepared),
      denialSink: denialSink(),
      coordinator
    });

    expect(evaluateInboxV2AuthorizationPlan(authorizationPlan)).toMatchObject({
      outcome: "allowed"
    });
    await expect(service.execute(fixture.command)).resolves.toMatchObject({
      outcome: "deleted_local",
      messageId: fixture.command.messageId,
      messageRevision: "2"
    });
    expect(
      coordinator.withAuthorizedMessageLifecycleMutation
    ).toHaveBeenCalledOnce();
  });

  it("applies an external edit with one exact lifecycle operation change", async () => {
    const fixture = editFixture(true);
    const coordinator = appliedCoordinator(fixture);
    const service = serviceFor(fixture, coordinator);

    await expect(service.execute(fixture.command)).resolves.toMatchObject({
      outcome: "edited",
      messageRevision: "2"
    });
    const input = vi.mocked(coordinator.withAuthorizedMessageLifecycleMutation)
      .mock.calls[0]?.[0];
    expect(input?.authorizedMutation.records.changes).toHaveLength(2);
    expect(input?.providerOperationCreation?.operation.outcome).toEqual({
      state: "pending"
    });
  });

  it("locally tombstones without provider I/O and retains content", async () => {
    const fixture = localDeleteFixture();
    const coordinator = appliedCoordinator(fixture);
    const service = serviceFor(fixture, coordinator);

    await expect(service.execute(fixture.command)).resolves.toMatchObject({
      outcome: "deleted_local",
      messageRevision: "2"
    });
    const input = vi.mocked(coordinator.withAuthorizedMessageLifecycleMutation)
      .mock.calls[0]?.[0];
    expect(input?.providerOperationCreation).toBeNull();
    expect(input?.messageMutation?.afterMessage.content).toEqual(
      input?.messageMutation?.beforeMessage.content
    );
    expect(
      input?.authorizedMutation.records.outboxIntents.some(
        (intent) => intent.effectClass === "provider_io"
      )
    ).toBe(false);
    expect(input?.legalHoldFence).toEqual({
      tenantId: fixtureTenantId,
      timelineItemId: fixtureTimelineItemReference.id,
      expectedLegalHoldSetRevision: "0"
    });
  });

  it("locally tombstones an external outbound Message without inventing provider I/O", async () => {
    const fixture = localDeleteFixture(true);
    const coordinator = appliedCoordinator(fixture);
    const service = serviceFor(fixture, coordinator);

    await expect(service.execute(fixture.command)).resolves.toMatchObject({
      outcome: "deleted_local",
      messageRevision: "2"
    });
    const input = vi.mocked(coordinator.withAuthorizedMessageLifecycleMutation)
      .mock.calls[0]?.[0];
    expect(input?.providerOperationCreation).toBeNull();
    expect(
      input?.authorizedMutation.records.outboxIntents.some(
        (intent) => intent.effectClass === "provider_io"
      )
    ).toBe(false);
  });

  it.each([
    ["origin", false, true],
    ["visibility", true, false]
  ] as const)(
    "rejects a local-delete authorization boundary that disagrees with persisted Message %s",
    async (
      _field,
      materializedExternalOrigin,
      materializedExternalVisibility
    ) => {
      const fixture = localDeleteFixture(
        true,
        materializedExternalOrigin,
        materializedExternalVisibility
      );
      const coordinator = coordinatorThatMustNotRun();
      const service = serviceFor(fixture, coordinator);

      await expect(service.execute(fixture.command)).rejects.toThrow(
        "permission.denied"
      );
      expect(
        coordinator.withAuthorizedMessageLifecycleMutation
      ).not.toHaveBeenCalled();
    }
  );

  it("queues provider delete without prematurely tombstoning Message", async () => {
    const fixture = providerDeleteFixture();
    const coordinator = appliedCoordinator(fixture);
    const service = serviceFor(fixture, coordinator);

    await expect(service.execute(fixture.command)).resolves.toMatchObject({
      outcome: "provider_delete_queued",
      messageId: fixture.command.messageId,
      providerOperationId: fixture.providerCreation?.operation.id
    });
    const input = vi.mocked(coordinator.withAuthorizedMessageLifecycleMutation)
      .mock.calls[0]?.[0];
    expect(input?.messageMutation).toBeNull();
    expect(input?.providerOperationCreation?.message.lifecycle).toEqual({
      kind: "active"
    });
    expect(
      input?.providerOperationCreation?.operation.deleteLocalPolicy
    ).toEqual({ effect: "not_evaluated" });
  });

  it.each(["source account", "binding", "capability"] as const)(
    "rejects a forged provider %s fence before authorization/write",
    async (field) => {
      const fixture = providerDeleteFixture();
      const selected = fixture.prepared;
      const creation = selected.providerOperationCreation;
      if (creation === null) throw new Error("provider fixture");
      const operation =
        field === "source account"
          ? {
              ...creation.operation,
              sourceAccount: {
                ...creation.operation.sourceAccount,
                id: "source_account:forged"
              }
            }
          : field === "binding"
            ? {
                ...creation.operation,
                sourceThreadBinding: {
                  ...creation.operation.sourceThreadBinding,
                  id: "source_thread_binding:forged"
                }
              }
            : { ...creation.operation, capabilityRevision: "2" };
      const forged = {
        ...selected,
        providerOperationCreation: { ...creation, operation }
      } as unknown as InboxV2PreparedMessageLifecycleCommand;
      const coordinator = coordinatorThatMustNotRun();
      const authorizationGate = vi.fn(allowGate()) as unknown as NonNullable<
        InboxV2MessageLifecycleCommandServiceOptions["authorizationGate"]
      >;
      const service = createInboxV2MessageLifecycleCommandService({
        requestScope,
        preparer: preparerReturning(forged),
        denialSink: denialSink(),
        coordinator,
        authorizationGate
      });

      await expect(service.execute(fixture.command)).rejects.toThrow();
      expect(authorizationGate).not.toHaveBeenCalled();
      expect(
        coordinator.withAuthorizedMessageLifecycleMutation
      ).not.toHaveBeenCalled();
    }
  );

  it("requires external edit materialization to return the exact operation ID", async () => {
    const fixture = editFixture(true);
    const coordinator = appliedCoordinator(fixture, {
      providerOperationId: null
    });
    const service = serviceFor(fixture, coordinator);

    await expect(service.execute(fixture.command)).rejects.toThrow(
      "permission.denied"
    );
  });

  it.each(["author participant", "authorship revision"] as const)(
    "rejects forged own-message %s authority",
    async (field) => {
      const fixture = localDeleteFixture();
      const intent = fixture.prepared.authorizedCommand.intent.payload;
      if (
        intent.kind !== "delete_message_local" ||
        intent.mutationAuthority?.kind !== "own"
      ) {
        throw new Error("own local-delete fixture");
      }
      const mutationAuthority =
        field === "author participant"
          ? {
              ...intent.mutationAuthority,
              authorParticipant: fixtureReference(
                "conversation_participant",
                "conversation_participant:forged"
              )
            }
          : { ...intent.mutationAuthority, expectedAuthorshipRevision: "2" };
      const forged = {
        ...fixture.prepared,
        authorizedCommand: inboxV2AuthorizedCommandSchema.parse({
          ...fixture.prepared.authorizedCommand,
          intent: {
            ...fixture.prepared.authorizedCommand.intent,
            payload: { ...intent, mutationAuthority }
          }
        })
      };
      const coordinator = coordinatorThatMustNotRun();
      const service = createInboxV2MessageLifecycleCommandService({
        requestScope,
        preparer: preparerReturning(forged),
        denialSink: denialSink(),
        coordinator,
        authorizationGate: allowGate()
      });

      await expect(service.execute(fixture.command)).rejects.toThrow(
        "permission.denied"
      );
      expect(
        coordinator.withAuthorizedMessageLifecycleMutation
      ).not.toHaveBeenCalled();
    }
  );

  it("rejects own-message authority when the participant snapshot revision drifts", async () => {
    const fixture = localDeleteFixture();
    const mutation = fixture.prepared.messageMutation;
    if (mutation === null || mutation.actionParticipantSnapshot === null) {
      throw new Error("local-delete participant fixture");
    }
    const forgedMutation = inboxV2MessageMutationCommitSchema.parse({
      ...mutation,
      actionParticipantSnapshot: {
        ...mutation.actionParticipantSnapshot,
        revision: "2",
        updatedAt: fixtureT3
      }
    });
    const forged = {
      ...fixture.prepared,
      messageMutation: forgedMutation
    };
    const coordinator = coordinatorThatMustNotRun();
    const service = createInboxV2MessageLifecycleCommandService({
      requestScope,
      preparer: preparerReturning(forged),
      denialSink: denialSink(),
      coordinator,
      authorizationGate: allowGate()
    });

    await expect(service.execute(fixture.command)).rejects.toThrow(
      "permission.denied"
    );
    expect(
      coordinator.withAuthorizedMessageLifecycleMutation
    ).not.toHaveBeenCalled();
  });

  it("rejects lifecycle provider work attached to the Message change", async () => {
    const fixture = editFixture(true);
    const mutation = fixture.prepared.authorizedMutation;
    const messageChange = mutation.records.changes.find(
      (change) => String(change.entity.entityTypeId) === "core:message"
    );
    const outbox = mutation.records.outboxIntents[0];
    if (messageChange === undefined || outbox === undefined) {
      throw new Error("external edit stream fixture");
    }
    const forged = {
      ...fixture.prepared,
      authorizedMutation: {
        ...mutation,
        records: {
          ...mutation.records,
          outboxIntents: [
            { ...outbox, changeIds: [messageChange.id] },
            ...mutation.records.outboxIntents.slice(1)
          ]
        }
      }
    } as unknown as InboxV2PreparedMessageLifecycleCommand;
    const coordinator = coordinatorThatMustNotRun();
    const service = createInboxV2MessageLifecycleCommandService({
      requestScope,
      preparer: preparerReturning(forged),
      denialSink: denialSink(),
      coordinator,
      authorizationGate: allowGate()
    });

    await expect(service.execute(fixture.command)).rejects.toThrow(
      "permission.denied"
    );
    expect(
      coordinator.withAuthorizedMessageLifecycleMutation
    ).not.toHaveBeenCalled();
  });

  it.each([
    "audit decisions",
    "requirements",
    "primary decision",
    "primary resource"
  ] as const)(
    "rejects selected authorization with forged %s closure",
    async (field) => {
      const fixture = editFixture(false);
      const selected = fixture.prepared;
      const mutation = selected.authorizedMutation;
      const forged =
        field === "requirements"
          ? {
              ...selected,
              authorizationPlan: {
                ...selected.authorizationPlan,
                requirements: selected.authorizationPlan.requirements.slice(1)
              }
            }
          : field === "primary resource"
            ? {
                ...selected,
                authorizationPlan: {
                  ...selected.authorizationPlan,
                  requirements: selected.authorizationPlan.requirements.map(
                    (requirement) =>
                      requirement.permissionId === "core:message.edit_own"
                        ? {
                            ...requirement,
                            resource: {
                              tenantId: fixtureTenantId,
                              entityTypeId: "core:conversation",
                              entityId: fixtureConversationReference.id
                            }
                          }
                        : requirement
                  )
                }
              }
            : {
                ...selected,
                authorizedMutation: {
                  ...mutation,
                  command:
                    field === "primary decision"
                      ? {
                          ...mutation.command,
                          authorizationDecisionId:
                            selected.authorizedCommand.authorizationDecisionRefs.find(
                              (decision) =>
                                decision.permissionId.includes(
                                  "conversation.internal.read"
                                )
                            )!.id
                        }
                      : mutation.command,
                  records: {
                    ...mutation.records,
                    audit:
                      field === "audit decisions"
                        ? {
                            ...mutation.records.audit,
                            authorizationDecisionRefs:
                              mutation.records.audit.authorizationDecisionRefs.slice(
                                1
                              )
                          }
                        : mutation.records.audit
                  }
                }
              };
      const coordinator = coordinatorThatMustNotRun();
      const authorizationGate = vi.fn(allowGate()) as unknown as NonNullable<
        InboxV2MessageLifecycleCommandServiceOptions["authorizationGate"]
      >;
      const service = createInboxV2MessageLifecycleCommandService({
        requestScope,
        preparer: preparerReturning(
          forged as unknown as InboxV2PreparedMessageLifecycleCommand
        ),
        denialSink: denialSink(),
        coordinator,
        authorizationGate
      });

      await expect(service.execute(fixture.command)).rejects.toThrow(
        "permission.denied"
      );
      expect(authorizationGate).not.toHaveBeenCalled();
    }
  );

  it.each(["target", "route", "operation", "hold"] as const)(
    "rejects a forged lifecycle policy guard %s closure",
    async (field) => {
      const fixture =
        field === "hold" ? providerDeleteFixture() : editFixture(true);
      const selected = fixture.prepared;
      const primary = selected.authorizationPlan.requirements.find(
        (requirement) =>
          requirement.permissionId ===
          (field === "hold"
            ? "core:message.delete_own"
            : "core:message.edit_own")
      );
      if (
        primary?.guard.profileId !== "core:rbac.guard.canonical_resource" ||
        primary.guard.action.kind !== "message_author_action"
      ) {
        throw new Error("lifecycle policy guard fixture");
      }
      const action = primary.guard.action;
      const changedAction =
        field === "target"
          ? {
              ...action,
              targetResource: {
                ...action.targetResource,
                entityId: "timeline_item:forged"
              }
            }
          : field === "route"
            ? {
                ...action,
                originalBindingResource: {
                  ...action.originalBindingResource!,
                  entityId: "source_thread_binding:forged"
                }
              }
            : field === "operation"
              ? { ...action, operation: "delete" as const }
              : {
                  ...action,
                  holdProof: {
                    ...action.holdProof!,
                    state: "active" as const
                  }
                };
      const forged = {
        ...selected,
        authorizationPlan: {
          ...selected.authorizationPlan,
          requirements: selected.authorizationPlan.requirements.map(
            (requirement) =>
              requirement === primary
                ? {
                    ...requirement,
                    guard: { ...primary.guard, action: changedAction }
                  }
                : requirement
          )
        }
      } as unknown as InboxV2PreparedMessageLifecycleCommand;
      const coordinator = coordinatorThatMustNotRun();
      const authorizationGate = vi.fn(allowGate()) as unknown as NonNullable<
        InboxV2MessageLifecycleCommandServiceOptions["authorizationGate"]
      >;
      const service = createInboxV2MessageLifecycleCommandService({
        requestScope,
        preparer: preparerReturning(forged),
        denialSink: denialSink(),
        coordinator,
        authorizationGate
      });

      await expect(service.execute(fixture.command)).rejects.toThrow(
        "permission.denied"
      );
      expect(authorizationGate).not.toHaveBeenCalled();
      expect(
        coordinator.withAuthorizedMessageLifecycleMutation
      ).not.toHaveBeenCalled();
    }
  );

  it.each(["tenant", "principal", "epoch", "target"] as const)(
    "rejects stale-revision disclosure prepared for another %s",
    async (field) => {
      const command = localDeleteFixture().command;
      const plan = disclosureAuthorizationPlan(command, "internal");
      const forgedPlan =
        field === "tenant"
          ? { ...plan, tenantId: "tenant:forged" }
          : field === "principal"
            ? {
                ...plan,
                principal: {
                  kind: "employee" as const,
                  employee: {
                    ...fixtureEmployeeReference,
                    id: "employee:forged"
                  }
                }
              }
            : field === "epoch"
              ? {
                  ...plan,
                  currentAuthorization: {
                    ...plan.currentAuthorization,
                    authorizationEpoch: "authorization:forged"
                  }
                }
              : {
                  ...plan,
                  requirements: plan.requirements.map((requirement) => ({
                    ...requirement,
                    resource: {
                      ...requirement.resource,
                      entityId: "conversation:forged"
                    }
                  }))
                };
      const authorizationGate = vi.fn(allowGate()) as unknown as NonNullable<
        InboxV2MessageLifecycleCommandServiceOptions["authorizationGate"]
      >;
      const service = createInboxV2MessageLifecycleCommandService({
        requestScope,
        preparer: {
          lookupIdempotency: vi.fn(async () => null),
          prepareNew: vi.fn(async () => ({
            kind: "revision_conflict" as const,
            requestHash: calculateInboxV2MessageLifecycleIntentDigest(command),
            scope: idempotencyScope(command),
            visibilityBoundary: "internal" as const,
            disclosureAuthorizationPlan:
              forgedPlan as InboxV2AuthorizationPlanInput,
            denialContext: {} as InboxV2SecurityDenialContext
          }))
        },
        denialSink: denialSink(),
        coordinator: coordinatorThatMustNotRun(),
        authorizationGate
      });

      await expect(service.execute(command)).rejects.toThrow(
        "permission.denied"
      );
      expect(authorizationGate).not.toHaveBeenCalled();
    }
  );

  it("rejects external edit whose provider target snapshot differs from the Message mutation", async () => {
    const fixture = editFixture(true);
    const creation = fixture.prepared.providerOperationCreation;
    const mutation = fixture.prepared.messageMutation;
    if (creation === null || mutation === null)
      throw new Error("external edit");
    const changedCreation = {
      ...creation,
      message: {
        ...creation.message,
        updatedAt: fixtureT3
      }
    };
    const forged = {
      ...fixture.prepared,
      providerOperationCreation: changedCreation,
      messageMutation: {
        ...mutation,
        providerOperationCreationCommit: changedCreation
      }
    } as unknown as InboxV2PreparedMessageLifecycleCommand;
    const coordinator = coordinatorThatMustNotRun();
    const service = createInboxV2MessageLifecycleCommandService({
      requestScope,
      preparer: preparerReturning(forged),
      denialSink: denialSink(),
      coordinator,
      authorizationGate: allowGate()
    });

    await expect(service.execute(fixture.command)).rejects.toThrow();
    expect(
      coordinator.withAuthorizedMessageLifecycleMutation
    ).not.toHaveBeenCalled();
  });

  it("rejects a provider route that substitutes mutation authority for conversation read", async () => {
    const fixture = editFixture(true);
    const creation = fixture.prepared.providerOperationCreation;
    const mutation = fixture.prepared.messageMutation;
    const route = creation?.outboundRoute;
    if (creation === null || mutation === null || route == null) {
      throw new Error("external edit route");
    }
    const changedRoute = {
      ...route,
      requiredConversationPermissionId: "core:message.moderate_external",
      conversationAuthorization: {
        ...route.conversationAuthorization,
        requiredPermissionId: "core:message.moderate_external",
        matchedPermissionIds: ["core:message.moderate_external"]
      }
    };
    const changedCreation = {
      ...creation,
      outboundRoute: changedRoute
    };
    const forged = {
      ...fixture.prepared,
      providerOperationCreation: changedCreation,
      messageMutation: {
        ...mutation,
        providerOperationCreationCommit: changedCreation
      }
    } as unknown as InboxV2PreparedMessageLifecycleCommand;
    const coordinator = coordinatorThatMustNotRun();
    const service = createInboxV2MessageLifecycleCommandService({
      requestScope,
      preparer: preparerReturning(forged),
      denialSink: denialSink(),
      coordinator,
      authorizationGate: allowGate()
    });

    await expect(service.execute(fixture.command)).rejects.toThrow();
    expect(
      coordinator.withAuthorizedMessageLifecycleMutation
    ).not.toHaveBeenCalled();
  });

  it.each([
    "extra conversation permission",
    "stale conversation decision revision",
    "conversation target mismatch",
    "source snapshot mismatch"
  ] as const)(
    "rejects provider authorization snapshot %s before authorization/write",
    async (field) => {
      const fixture = editFixture(true);
      const creation = fixture.prepared.providerOperationCreation;
      const mutation = fixture.prepared.messageMutation;
      const route = creation?.outboundRoute;
      if (creation === null || mutation === null || route == null) {
        throw new Error("external edit route snapshot");
      }
      const changedRoute =
        field === "extra conversation permission"
          ? {
              ...route,
              conversationAuthorization: {
                ...route.conversationAuthorization,
                matchedPermissionIds: [
                  "core:conversation.read" as const,
                  "core:message.moderate_external" as const
                ]
              }
            }
          : field === "stale conversation decision revision"
            ? {
                ...route,
                conversationAuthorization: {
                  ...route.conversationAuthorization,
                  decisionRevision: "2"
                }
              }
            : field === "conversation target mismatch"
              ? {
                  ...route,
                  conversationAuthorization: {
                    ...route.conversationAuthorization,
                    target: {
                      ...route.conversationAuthorization.target,
                      sourceConnection: {
                        ...route.conversationAuthorization.target
                          .sourceConnection,
                        id: "source_connection:forged"
                      }
                    }
                  }
                }
              : {
                  ...route,
                  sourceAccountAuthorization: {
                    ...route.sourceAccountAuthorization,
                    decisionRevision: "2"
                  }
                };
      const changedCreation = {
        ...creation,
        outboundRoute: changedRoute
      };
      const forged = {
        ...fixture.prepared,
        providerOperationCreation: changedCreation,
        messageMutation: {
          ...mutation,
          providerOperationCreationCommit: changedCreation
        }
      } as unknown as InboxV2PreparedMessageLifecycleCommand;
      const coordinator = coordinatorThatMustNotRun();
      const authorizationGate = vi.fn(allowGate()) as unknown as NonNullable<
        InboxV2MessageLifecycleCommandServiceOptions["authorizationGate"]
      >;
      const service = createInboxV2MessageLifecycleCommandService({
        requestScope,
        preparer: preparerReturning(forged),
        denialSink: denialSink(),
        coordinator,
        authorizationGate
      });

      await expect(service.execute(fixture.command)).rejects.toThrow();
      expect(authorizationGate).not.toHaveBeenCalled();
      expect(
        coordinator.withAuthorizedMessageLifecycleMutation
      ).not.toHaveBeenCalled();
    }
  );

  it("rejects a stale primary TimelineItem decision revision before authorization/write", async () => {
    const fixture = editFixture(false);
    const selected = fixture.prepared;
    const primaryPermission = "core:message.edit_own";
    const decisions = selected.authorizedCommand.authorizationDecisionRefs.map(
      (decision) =>
        decision.permissionId === primaryPermission
          ? { ...decision, resourceAccessRevision: "2" }
          : decision
    );
    const principal = selected.authorizedCommand.principal;
    if (principal.kind !== "employee") {
      throw new Error("employee authorization fixture");
    }
    const authorizedCommand = inboxV2AuthorizedCommandSchema.parse({
      ...selected.authorizedCommand,
      principal: {
        ...principal,
        authorization: {
          ...principal.authorization,
          dependencies: {
            ...principal.authorization.dependencies,
            resourceDependencies:
              principal.authorization.dependencies.resourceDependencies.map(
                (dependency) =>
                  dependency.resource.entityTypeId === "core:timeline-item"
                    ? { ...dependency, accessRevision: "2" }
                    : dependency
              )
          }
        }
      },
      authorizationDecisionRefs: decisions
    });
    const forged = {
      ...selected,
      authorizationPlan: {
        ...selected.authorizationPlan,
        requirements: selected.authorizationPlan.requirements.map(
          (requirement) =>
            requirement.permissionId === primaryPermission
              ? { ...requirement, resourceAccessRevision: "2" }
              : requirement
        )
      },
      authorizedCommand,
      authorizedMutation: {
        ...selected.authorizedMutation,
        records: {
          ...selected.authorizedMutation.records,
          audit: {
            ...selected.authorizedMutation.records.audit,
            authorizationDecisionRefs: decisions
          }
        }
      }
    } as unknown as InboxV2PreparedMessageLifecycleCommand;
    const coordinator = coordinatorThatMustNotRun();
    const authorizationGate = vi.fn(allowGate()) as unknown as NonNullable<
      InboxV2MessageLifecycleCommandServiceOptions["authorizationGate"]
    >;
    const service = createInboxV2MessageLifecycleCommandService({
      requestScope,
      preparer: preparerReturning(forged),
      denialSink: denialSink(),
      coordinator,
      authorizationGate
    });

    await expect(service.execute(fixture.command)).rejects.toThrow(
      "permission.denied"
    );
    expect(authorizationGate).not.toHaveBeenCalled();
    expect(
      coordinator.withAuthorizedMessageLifecycleMutation
    ).not.toHaveBeenCalled();
  });
});

type SelectedFixture = Readonly<{
  command: InboxV2MessageLifecycleCommand;
  prepared: Extract<
    InboxV2PreparedMessageLifecycleCommand,
    { kind: "selected" }
  >;
  messageMutation: ReturnType<
    typeof inboxV2MessageMutationCommitSchema.parse
  > | null;
  providerCreation: InboxV2MessageProviderLifecycleOperationCreationCommit | null;
}>;

function editFixture(
  external: boolean,
  attachmentMode: false | true | "mixed" = false,
  authorityKind: "own" | "moderate_internal" | "moderate_external" = "own",
  internalOrigin: "internal" | "migration" = "internal"
): SelectedFixture {
  if (
    (authorityKind === "moderate_internal" && external) ||
    (authorityKind === "moderate_external" && !external)
  ) {
    throw new Error("lifecycle moderation boundary fixture");
  }
  const baseBeforeContent = fixtureContent();
  const attachment = fixtureReference(
    "message_attachment",
    "message_attachment:lifecycle-upload-1"
  );
  const file = fixtureReference("file", "file:lifecycle-upload-1");
  const fileVersion = fixtureReference(
    "file_version",
    "file_version:lifecycle-upload-1-r1"
  );
  const objectVersion = fixtureReference(
    "file_object_version",
    "file_object_version:lifecycle-upload-1-r1-v1"
  );
  const retainedAttachment = fixtureReference(
    "message_attachment",
    "message_attachment:lifecycle-retained-1"
  );
  const retainedFile = fixtureReference("file", "file:lifecycle-retained-1");
  const retainedFileVersion = fixtureReference(
    "file_version",
    "file_version:lifecycle-retained-1-r1"
  );
  const retainedObjectVersion = fixtureReference(
    "file_object_version",
    "file_object_version:lifecycle-retained-1-r1-v1"
  );
  const textBlock = {
    blockKey: "body-1",
    kind: "text" as const,
    role: "body" as const,
    text: external ? "Edited externally" : "Edited internally",
    language: "en"
  };
  const retainedBlock = {
    blockKey: "file-retained-1",
    kind: "file" as const,
    attachment: {
      state: "ready" as const,
      attachment: retainedAttachment,
      file: retainedFile,
      fileRevision: "1",
      fileVersion: retainedFileVersion,
      objectVersion: retainedObjectVersion
    },
    displayName: "retained-before-edit.txt"
  };
  const beforeBlocks =
    attachmentMode === "mixed" && baseBeforeContent.state.kind === "available"
      ? [...baseBeforeContent.state.blocks, retainedBlock]
      : null;
  const beforeContent =
    beforeBlocks === null
      ? baseBeforeContent
      : fixtureContent({
          state: {
            kind: "available",
            blocks: beforeBlocks,
            contentDigestSha256:
              calculateInboxV2MessageContentDigest(beforeBlocks)
          }
        });
  const blocks = attachmentMode
    ? [
        textBlock,
        ...(attachmentMode === "mixed" ? [retainedBlock] : []),
        {
          blockKey: "file-1",
          kind: "file" as const,
          attachment: {
            state: "ready" as const,
            attachment,
            file,
            fileRevision: "1",
            fileVersion,
            objectVersion
          },
          displayName: "inbox-v2-lifecycle.txt"
        }
      ]
    : [textBlock];
  const content = inboxV2TimelineContentDraftSchema.parse({ blocks });
  const afterContent = fixtureContent({
    state: {
      kind: "available",
      blocks,
      contentDigestSha256: calculateInboxV2MessageContentDigest(blocks)
    },
    revision: "2",
    updatedAt: fixtureT3
  });
  const baseBeforeMessage = fixtureMessage(
    external ? "hulee" : "internal",
    beforeContent
  );
  const beforeMessage = inboxV2MessageSchema.parse(
    !external && internalOrigin === "migration"
      ? {
          ...baseBeforeMessage,
          appActor: {
            kind: "trusted_service" as const,
            trustedServiceId: "core:migration-service"
          },
          origin: {
            kind: "migration" as const,
            provenanceId: "core:migration.api-msg005"
          }
        }
      : baseBeforeMessage
  );
  const baseBeforeTimelineItem = fixtureTimelineItem(
    external ? "external" : "internal"
  );
  const beforeTimelineItem = inboxV2TimelineItemSchema.parse(
    !external && internalOrigin === "migration"
      ? {
          ...baseBeforeTimelineItem,
          activity: {
            kind: "migration" as const,
            provenanceId: "core:migration.api-msg005",
            importedAt: fixtureT1
          }
        }
      : baseBeforeTimelineItem
  );
  const afterMessage = {
    ...beforeMessage,
    content: inboxV2TimelineContentHeadOf(afterContent as never),
    revision: "2",
    updatedAt: fixtureT3
  };
  const afterTimelineItem = advancedTimelineItem(beforeTimelineItem);
  const providerCreation = external
    ? requestedProviderCreation("edit", beforeMessage, beforeTimelineItem)
    : null;
  const operation = providerCreation?.operation ?? null;
  const messageMutation = inboxV2MessageMutationCommitSchema.parse({
    tenantId: fixtureTenantId,
    beforeMessage,
    beforeTimelineItem,
    contentTransition: {
      tenantId: fixtureTenantId,
      before: beforeContent,
      transition: {
        kind: "edit",
        expectedRevision: "1",
        resultingRevision: "2",
        event: fixtureReference("event", "event:message-edit-1"),
        occurredAt: fixtureT3
      },
      after: afterContent
    },
    providerOperation: operation,
    providerOperationCreationCommit: providerCreation,
    actionParticipantSnapshot: fixtureParticipant("employee"),
    revision: {
      tenantId: fixtureTenantId,
      id: "message_revision:edit-2",
      message: fixtureMessageReference,
      timelineItem: fixtureTimelineItemReference,
      expectedPreviousRevision: "1",
      messageRevision: "2",
      change: {
        kind: "edited",
        beforeContent: beforeMessage.content,
        afterContent: afterMessage.content,
        providerOperation:
          operation === null
            ? null
            : fixtureReference(
                "message_provider_lifecycle_operation",
                operation.id
              )
      },
      actionAttribution: {
        actionParticipant: beforeMessage.authorParticipant,
        appActor: fixtureEmployeeActor,
        sourceOccurrence: null,
        automationCausation: null
      },
      occurredAt: fixtureT3,
      recordedAt: fixtureT3,
      recordRevision: "1",
      createdAt: fixtureT3
    },
    afterMessage,
    afterTimelineItem
  });
  const command: InboxV2MessageLifecycleCommand = {
    kind: "edit",
    tenantId: fixtureTenantId,
    conversationId: fixtureConversationReference.id,
    messageId: fixtureMessageReference.id,
    expectedMessageRevision: "1",
    content,
    clientMutationId: external
      ? "mutation:external-edit-1"
      : "mutation:internal-edit-1"
  };
  const intent = inboxV2TimelineCommandIntentSchema.parse({
    kind: "edit_message",
    tenantId: fixtureTenantId,
    conversation: fixtureConversationReference,
    authorParticipant: beforeMessage.authorParticipant,
    appActor: fixtureEmployeeActor,
    automationCausation: null,
    occurredAt: fixtureT3,
    message: fixtureMessageReference,
    expectedMessageRevision: "1",
    mutationAuthority:
      authorityKind === "own"
        ? ownAuthority(beforeMessage.authorParticipant, beforeTimelineItem)
        : moderationAuthority(authorityKind, beforeTimelineItem),
    content,
    fileReadProofs: attachmentMode
      ? [
          ...(attachmentMode === "mixed"
            ? [
                {
                  blockKey: "file-retained-1",
                  purpose: "attachment" as const,
                  file: retainedFile,
                  attachment: retainedAttachment,
                  expectedFileRevision: "1",
                  fileVersion: retainedFileVersion,
                  objectVersion: retainedObjectVersion,
                  parentConversation: fixtureConversationReference,
                  visibilityBoundary: external
                    ? ("external_work" as const)
                    : ("internal" as const),
                  sourceParent: {
                    kind: "message" as const,
                    conversation: fixtureConversationReference,
                    message: fixtureMessageReference,
                    expectedMessageRevision: "1",
                    visibilityBoundary: external
                      ? ("external_work" as const)
                      : ("internal" as const)
                  }
                }
              ]
            : []),
          {
            blockKey: "file-1",
            purpose: "attachment",
            file,
            attachment,
            expectedFileRevision: "1",
            fileVersion,
            objectVersion,
            parentConversation: fixtureConversationReference,
            visibilityBoundary: external ? "external_work" : "internal",
            sourceParent: {
              kind: "upload_staging",
              appActor: fixtureEmployeeActor,
              uploadRevision: "1"
            }
          }
        ]
      : undefined,
    transport:
      providerCreation === null
        ? { kind: "internal" }
        : {
            kind: "external",
            externalMessageReference: fixtureExternalMessageReference,
            sourceOccurrence: fixtureSourceOccurrenceReference,
            outboundRoute: fixtureRouteReference,
            routeAuthorization: routeAuthorization(providerCreation)
          }
  }) as Extract<InboxV2TimelineCommandIntent, { kind: "edit_message" }>;
  return selectedFixture(command, intent, messageMutation, providerCreation);
}

function localDeleteFixture(
  externalIntent = false,
  materializedExternalOrigin = externalIntent,
  materializedExternalVisibility = materializedExternalOrigin
): SelectedFixture {
  const beforeMessage = fixtureMessage(
    materializedExternalOrigin ? "hulee" : "internal"
  );
  const beforeTimelineItem = fixtureTimelineItem(
    materializedExternalVisibility ? "external" : "internal"
  );
  const revisionId = "message_revision:local-delete-2";
  const reasonId = "core:employee-delete";
  const afterMessage = {
    ...beforeMessage,
    lifecycle: {
      kind: "local_delete_tombstone" as const,
      revision: fixtureReference("message_revision", revisionId),
      reasonId,
      deletedAt: fixtureT3
    },
    revision: "2",
    updatedAt: fixtureT3
  };
  const messageMutation = inboxV2MessageMutationCommitSchema.parse({
    tenantId: fixtureTenantId,
    beforeMessage,
    beforeTimelineItem,
    contentTransition: null,
    providerOperation: null,
    providerOperationCreationCommit: null,
    actionParticipantSnapshot: fixtureParticipant("employee"),
    revision: {
      tenantId: fixtureTenantId,
      id: revisionId,
      message: fixtureMessageReference,
      timelineItem: fixtureTimelineItemReference,
      expectedPreviousRevision: "1",
      messageRevision: "2",
      change: { kind: "local_delete_tombstone", reasonId },
      actionAttribution: {
        actionParticipant: beforeMessage.authorParticipant,
        appActor: fixtureEmployeeActor,
        sourceOccurrence: null,
        automationCausation: null
      },
      occurredAt: fixtureT3,
      recordedAt: fixtureT3,
      recordRevision: "1",
      createdAt: fixtureT3
    },
    afterMessage,
    afterTimelineItem: advancedTimelineItem(beforeTimelineItem)
  });
  const command: InboxV2MessageLifecycleCommand = {
    kind: "delete_local",
    tenantId: fixtureTenantId,
    conversationId: fixtureConversationReference.id,
    messageId: fixtureMessageReference.id,
    expectedMessageRevision: "1",
    reasonId,
    clientMutationId: externalIntent
      ? "mutation:local-delete-external-1"
      : "mutation:local-delete-1"
  };
  const intent = inboxV2TimelineCommandIntentSchema.parse({
    kind: "delete_message_local",
    tenantId: fixtureTenantId,
    conversation: fixtureConversationReference,
    message: fixtureMessageReference,
    expectedMessageRevision: "1",
    visibilityBoundary: externalIntent ? "external_work" : "internal",
    mutationAuthority: ownAuthority(
      beforeMessage.authorParticipant,
      beforeTimelineItem
    ),
    appActor: fixtureEmployeeActor,
    reasonId,
    occurredAt: fixtureT3
  }) as Extract<InboxV2TimelineCommandIntent, { kind: "delete_message_local" }>;
  return selectedFixture(command, intent, messageMutation, null);
}

function providerDeleteFixture(): SelectedFixture {
  const beforeMessage = inboxV2MessageSchema.parse(fixtureMessage("hulee"));
  const beforeTimelineItem = inboxV2TimelineItemSchema.parse(
    fixtureTimelineItem("external")
  );
  const providerCreation = requestedProviderCreation(
    "delete",
    beforeMessage,
    beforeTimelineItem
  );
  const command: InboxV2MessageLifecycleCommand = {
    kind: "delete_provider",
    tenantId: fixtureTenantId,
    conversationId: fixtureConversationReference.id,
    messageId: fixtureMessageReference.id,
    expectedMessageRevision: "1",
    reasonId: "core:employee-delete-provider",
    clientMutationId: "mutation:provider-delete-1"
  };
  const intent = inboxV2TimelineCommandIntentSchema.parse({
    kind: "delete_message_provider",
    tenantId: fixtureTenantId,
    conversation: fixtureConversationReference,
    message: fixtureMessageReference,
    expectedMessageRevision: "1",
    mutationAuthority: ownAuthority(
      beforeMessage.authorParticipant,
      beforeTimelineItem
    ),
    appActor: fixtureEmployeeActor,
    externalMessageReference: fixtureExternalMessageReference,
    sourceOccurrence: fixtureSourceOccurrenceReference,
    outboundRoute: fixtureRouteReference,
    routeAuthorization: routeAuthorization(providerCreation),
    occurredAt: fixtureT3
  }) as Extract<
    InboxV2TimelineCommandIntent,
    { kind: "delete_message_provider" }
  >;
  return selectedFixture(command, intent, null, providerCreation);
}

function selectedFixture(
  command: InboxV2MessageLifecycleCommand,
  intent: Extract<
    InboxV2TimelineCommandIntent,
    {
      kind: "edit_message" | "delete_message_local" | "delete_message_provider";
    }
  >,
  messageMutation: ReturnType<
    typeof inboxV2MessageMutationCommitSchema.parse
  > | null,
  providerCreation: InboxV2MessageProviderLifecycleOperationCreationCommit | null
): SelectedFixture {
  const requestHash = calculateInboxV2MessageLifecycleIntentDigest(command);
  const authorizedCommand = authorizedCommandFor(command, intent, requestHash);
  const authorizedMutation = authorizedMutationFor(
    command,
    authorizedCommand,
    requestHash,
    messageMutation,
    providerCreation
  );
  return {
    command,
    messageMutation,
    providerCreation,
    prepared: {
      kind: "selected",
      authorizationPlan: authorizationPlanFor(
        authorizedCommand.authorizationDecisionRefs,
        intent,
        messageMutation,
        providerCreation
      ),
      denialContext: {} as InboxV2SecurityDenialContext,
      authorizedCommand,
      authorizedMutation,
      messageMutation,
      providerOperationCreation: providerCreation
    }
  };
}

function requestedProviderCreation(
  action: "edit" | "delete",
  message: ReturnType<typeof inboxV2MessageSchema.parse>,
  timelineItem: ReturnType<typeof inboxV2TimelineItemSchema.parse>
): InboxV2MessageProviderLifecycleOperationCreationCommit {
  const occurrence = fixtureOccurrence();
  const rawRoute = fixtureExternalTargetRoute(
    `core:message.${action}`,
    "core:conversation.read",
    { occurrence, externalMessageReference: fixtureExternalMessageReference }
  );
  const route = {
    ...rawRoute,
    authorizationEpoch: fixtureEmployeeActor.authorizationEpoch,
    conversationAuthorization: {
      ...rawRoute.conversationAuthorization,
      target: {
        ...rawRoute.conversationAuthorization.target,
        authorizationEpoch: fixtureEmployeeActor.authorizationEpoch
      }
    },
    sourceAccountAuthorization: {
      ...rawRoute.sourceAccountAuthorization,
      target: {
        ...rawRoute.sourceAccountAuthorization.target,
        authorizationEpoch: fixtureEmployeeActor.authorizationEpoch
      }
    }
  };
  const operation = {
    tenantId: fixtureTenantId,
    id: `message_provider_lifecycle_operation:requested-${action}-1`,
    message: fixtureMessageReference,
    action,
    origin: "hulee_requested" as const,
    externalMessageReference: fixtureExternalMessageReference,
    sourceOccurrence: fixtureSourceOccurrenceReference,
    sourceAccount: fixtureSourceAccountReference,
    sourceThreadBinding: fixtureBindingReference,
    bindingGeneration: occurrence.bindingContext.bindingGeneration,
    outboundRoute: fixtureRouteReference,
    adapterContract: fixtureAdapterContract,
    capabilityRevision: route.bindingFence.capabilityRevision,
    appActor: fixtureEmployeeActor,
    actionParticipant: message.authorParticipant,
    automationCausation: null,
    outcome: { state: "pending" as const },
    deleteLocalPolicy:
      action === "delete"
        ? ({ effect: "not_evaluated" as const } as const)
        : null,
    revision: "1",
    occurredAt: fixtureT3,
    recordedAt: fixtureT3,
    createdAt: fixtureT3,
    updatedAt: fixtureT3
  };
  return inboxV2MessageProviderLifecycleOperationCreationCommitSchema.parse({
    tenantId: fixtureTenantId,
    message,
    timelineItem,
    externalMessageReference: fixtureExternalReference(occurrence),
    sourceOccurrence: occurrence,
    outboundRoute: route,
    outboundBindingSnapshot: fixtureOutboundBindingSnapshot(
      route,
      `core:message-${action}`
    ),
    actionParticipantSnapshot: fixtureParticipant("employee"),
    providerSemanticProof: null,
    semanticOrderingCommit: null,
    routeConsumption: {
      outboundRoute: fixtureRouteReference,
      operation: fixtureReference(
        "message_provider_lifecycle_operation",
        operation.id
      ),
      mutationToken: route.mutationToken,
      idempotencyToken: route.idempotencyToken,
      correlationToken: route.correlationToken,
      consumedByTrustedServiceId:
        route.adapterContract.loadedByTrustedServiceId,
      consumedAt: operation.recordedAt,
      revision: "1"
    },
    operation
  });
}

function authorizedCommandFor(
  command: InboxV2MessageLifecycleCommand,
  intent: Extract<
    InboxV2TimelineCommandIntent,
    {
      kind: "edit_message" | "delete_message_local" | "delete_message_provider";
    }
  >,
  requestHash: string
): InboxV2AuthorizedCommand {
  const requiresProviderRoute =
    intent.kind === "delete_message_provider" ||
    (intent.kind === "edit_message" && intent.transport.kind === "external");
  const readPermission =
    (intent.kind === "delete_message_local" &&
      intent.visibilityBoundary === "internal") ||
    (intent.kind === "edit_message" && intent.transport.kind === "internal")
      ? "core:conversation.internal.read"
      : "core:conversation.read";
  const authority = intent.mutationAuthority;
  const actionPermission =
    authority?.kind === "moderate_internal"
      ? "core:message.moderate_internal"
      : authority?.kind === "moderate_external"
        ? "core:message.moderate_external"
        : command.kind === "edit"
          ? "core:message.edit_own"
          : "core:message.delete_own";
  const actionTimelineItem = authority?.timelineItem;
  if (authority === undefined || actionTimelineItem === undefined) {
    throw new Error("lifecycle action TimelineItem fixture");
  }
  const fileProofs =
    intent.kind === "edit_message" ? (intent.fileReadProofs ?? []) : [];
  const destinationParentRequirements =
    intent.kind === "edit_message" && fileProofs.length > 0
      ? [
          {
            permissionId:
              intent.transport.kind === "internal"
                ? "core:message.send_internal"
                : "core:message.reply_external",
            resourceScopeId: "core:conversation",
            entityTypeId: "core:conversation",
            entityId: intent.conversation.id
          }
        ]
      : [];
  const fileRequirements = fileProofs.flatMap((proof) => {
    const requirements: {
      permissionId: string;
      resourceScopeId: string;
      entityTypeId: string;
      entityId: string;
    }[] = [
      {
        permissionId: "core:file.view",
        resourceScopeId: "core:file",
        entityTypeId: "core:file",
        entityId: proof.file.id
      }
    ];
    if (proof.sourceParent.kind === "upload_staging") {
      requirements.push({
        permissionId: "core:file.upload",
        resourceScopeId: "core:file",
        entityTypeId: "core:file",
        entityId: proof.file.id
      });
    } else {
      requirements.push({
        permissionId:
          (proof.sourceParent.kind === "message" &&
            proof.sourceParent.visibilityBoundary === "internal") ||
          (proof.sourceParent.kind === "staff_note" &&
            proof.sourceParent.parentConversationVisibility === "internal")
            ? "core:conversation.internal.read"
            : "core:conversation.read",
        resourceScopeId: "core:conversation",
        entityTypeId: "core:conversation",
        entityId: proof.sourceParent.conversation.id
      });
      if (proof.sourceParent.kind === "staff_note") {
        requirements.push({
          permissionId: "core:message.staff_note.read",
          resourceScopeId: "core:conversation",
          entityTypeId: "core:conversation",
          entityId: proof.sourceParent.conversation.id
        });
      }
    }
    return requirements;
  });
  const decisionRequirements = [
    {
      permissionId: readPermission,
      resourceScopeId: "core:conversation",
      entityTypeId: "core:conversation",
      entityId: fixtureConversationReference.id
    },
    {
      permissionId: actionPermission,
      resourceScopeId:
        authority.kind === "moderate_internal"
          ? "core:conversation"
          : "core:timeline-item",
      entityTypeId:
        authority.kind === "moderate_internal"
          ? "core:conversation"
          : "core:timeline-item",
      entityId:
        authority.kind === "moderate_internal"
          ? intent.conversation.id
          : actionTimelineItem.id
    },
    ...(requiresProviderRoute
      ? [
          {
            permissionId: "core:source_account.use",
            resourceScopeId: "core:source-account",
            entityTypeId: "core:source-account",
            entityId: fixtureSourceAccountReference.id
          }
        ]
      : []),
    ...destinationParentRequirements,
    ...fileRequirements
  ];
  const uniqueDecisionRequirements = new Map(
    decisionRequirements.map((requirement) => [
      `${requirement.permissionId}\u0000${requirement.resourceScopeId}\u0000${requirement.entityTypeId}\u0000${requirement.entityId}`,
      requirement
    ])
  );
  const decisions = authorizationDecisions([
    ...uniqueDecisionRequirements.values()
  ]);
  return inboxV2AuthorizedCommandSchema.parse({
    tenantId: fixtureTenantId,
    commandId: `command:${command.kind}-1`,
    request: {
      tenantId: fixtureTenantId,
      requestId: `request:${command.kind}-1`,
      clientMutationId: command.clientMutationId,
      commandTypeId: "core:timeline.command",
      requestHash
    },
    principal: {
      kind: "employee",
      employee: fixtureEmployeeReference,
      authorization: authorizationSnapshot(decisions)
    },
    authorizationDecisionRefs: decisions,
    intent: {
      schemaId: "core:inbox-v2.timeline-command-intent",
      schemaVersion: "v1",
      payload: intent
    },
    authorizedAt: fixtureT3
  });
}

function authorizationDecisions(
  requirements: readonly Readonly<{
    permissionId: string;
    resourceScopeId: string;
    entityTypeId: string;
    entityId: string;
  }>[]
): readonly InboxV2AuthorizationDecisionReference[] {
  return requirements.map((requirement, index) =>
    inboxV2AuthorizationDecisionReferenceSchema.parse({
      tenantId: fixtureTenantId,
      id: `authorization-decision:lifecycle-${index + 1}`,
      authorizationEpoch: fixtureEmployeeActor.authorizationEpoch,
      principal: { kind: "employee", employee: fixtureEmployeeReference },
      permissionId: requirement.permissionId,
      resourceScopeId: requirement.resourceScopeId,
      resource: {
        tenantId: fixtureTenantId,
        entityTypeId: requirement.entityTypeId,
        entityId: requirement.entityId
      },
      resourceAccessRevision: "1",
      decisionRevision: "1",
      decisionHash: hash(`decision-${index + 1}`),
      outcome: "allowed",
      decidedAt: fixtureT1,
      notAfter: fixtureT4
    })
  );
}

function authorizationSnapshot(
  decisions: readonly InboxV2AuthorizationDecisionReference[]
) {
  const uniqueResources = new Map(
    decisions.map((decision) => [
      `${decision.resource.tenantId}\u0000${decision.resource.entityTypeId}\u0000${decision.resource.entityId}`,
      {
        resource: decision.resource,
        accessRevision: decision.resourceAccessRevision
      }
    ])
  );
  return {
    tenantId: fixtureTenantId,
    employee: fixtureEmployeeReference,
    value: fixtureEmployeeActor.authorizationEpoch,
    dependencies: {
      tenantRbacRevision: "1",
      employeeAccessRevision: "1",
      employeeInboxRelationRevision: "1",
      sharedAccessRevision: "1",
      resourceDependencies: [...uniqueResources.values()].sort(
        (left, right) => {
          const leftKey = `${left.resource.tenantId}\u0000${left.resource.entityTypeId}\u0000${left.resource.entityId}`;
          const rightKey = `${right.resource.tenantId}\u0000${right.resource.entityTypeId}\u0000${right.resource.entityId}`;
          return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
        }
      ),
      temporalBoundaryDigest: hash("temporal-boundary")
    },
    evaluatedAt: fixtureT1,
    notAfter: fixtureT4,
    nextAuthorizationBoundary: null
  };
}

function authorizationPlanFor(
  decisions: readonly InboxV2AuthorizationDecisionReference[],
  intent: Extract<
    InboxV2TimelineCommandIntent,
    {
      kind: "edit_message" | "delete_message_local" | "delete_message_provider";
    }
  >,
  messageMutation: ReturnType<
    typeof inboxV2MessageMutationCommitSchema.parse
  > | null,
  providerCreation: InboxV2MessageProviderLifecycleOperationCreationCommit | null
): InboxV2AuthorizationPlanInput {
  const timelineItem =
    messageMutation?.beforeTimelineItem ?? providerCreation?.timelineItem;
  const message = messageMutation?.beforeMessage ?? providerCreation?.message;
  if (timelineItem === undefined || message === undefined) {
    throw new Error("lifecycle authorization target fixture");
  }
  const externalBoundary =
    providerCreation !== null ||
    (intent.kind === "delete_message_local" &&
      intent.visibilityBoundary !== "internal");
  const targetResource = {
    tenantId: fixtureTenantId,
    entityTypeId: "core:timeline-item",
    entityId: timelineItem.id
  };
  const conversationResource = {
    tenantId: fixtureTenantId,
    entityTypeId: "core:conversation",
    entityId: fixtureConversationReference.id
  };
  const authority = intent.mutationAuthority;
  if (authority === undefined) {
    throw new Error("lifecycle mutation authority fixture");
  }
  const primaryPermission =
    authority.kind === "moderate_internal"
      ? "core:message.moderate_internal"
      : authority.kind === "moderate_external"
        ? "core:message.moderate_external"
        : intent.kind === "edit_message"
          ? "core:message.edit_own"
          : "core:message.delete_own";
  const readPermission =
    intent.kind === "delete_message_local" &&
    intent.visibilityBoundary === "internal"
      ? "core:conversation.internal.read"
      : intent.kind === "edit_message" && intent.transport.kind === "internal"
        ? "core:conversation.internal.read"
        : "core:conversation.read";
  const readRequirementId = "requirement:lifecycle-read";
  const sourceRequirementId = "requirement:lifecycle-source";
  const destinationParentPermission =
    intent.kind === "edit_message" && (intent.fileReadProofs?.length ?? 0) > 0
      ? intent.transport.kind === "internal"
        ? "core:message.send_internal"
        : "core:message.reply_external"
      : null;
  const destinationParentRequirementId =
    "requirement:lifecycle-file-parent-authority";
  const participant =
    messageMutation?.actionParticipantSnapshot ??
    providerCreation?.actionParticipantSnapshot;
  if (authority.kind === "own" && participant?.subject.kind !== "employee") {
    throw new Error("lifecycle author fixture");
  }
  const authorEmployeeId =
    participant?.subject.kind === "employee"
      ? participant.subject.employee.id
      : null;
  const route = providerCreation?.outboundRoute ?? null;
  const binding = providerCreation?.outboundBindingSnapshot ?? null;
  const providerEvidence =
    providerCreation === null || route === null || binding === null
      ? {
          originalRouteRequirementId: null,
          originalSourceAccountId: null,
          originalSourceAccountResource: null,
          originalBindingResource: null,
          originalBindingSourceAccountResource: null,
          externalReferenceResource: null,
          externalReferenceBindingResource: null,
          externalReferenceTargetResource: null,
          routeRevisionChecks: [],
          capabilityId: null,
          capabilityManifestResource: null,
          capabilityManifestSourceAccountResource: null,
          capabilityRevisionChecks: [],
          capabilityState: "not_applicable" as const,
          capabilityNotAfter: null
        }
      : {
          originalRouteRequirementId: sourceRequirementId,
          originalSourceAccountId: route.sourceAccount.id,
          originalSourceAccountResource: {
            tenantId: fixtureTenantId,
            entityTypeId: "core:source-account",
            entityId: route.sourceAccount.id
          },
          originalBindingResource: {
            tenantId: fixtureTenantId,
            entityTypeId: "core:source-thread-binding",
            entityId: route.sourceThreadBinding.id
          },
          originalBindingSourceAccountResource: {
            tenantId: fixtureTenantId,
            entityTypeId: "core:source-account",
            entityId: route.sourceAccount.id
          },
          externalReferenceResource: {
            tenantId: fixtureTenantId,
            entityTypeId: "core:external-message-reference",
            entityId: providerCreation.externalMessageReference.id
          },
          externalReferenceBindingResource: {
            tenantId: fixtureTenantId,
            entityTypeId: "core:source-thread-binding",
            entityId: route.sourceThreadBinding.id
          },
          externalReferenceTargetResource: targetResource,
          routeRevisionChecks: [
            {
              kind: "binding" as const,
              expected: route.bindingFence.bindingGeneration,
              actual: route.bindingFence.bindingGeneration
            },
            {
              kind: "route" as const,
              expected: route.revision,
              actual: route.revision
            },
            {
              kind: "state" as const,
              expected: route.bindingFence.capabilityRevision,
              actual: route.bindingFence.capabilityRevision
            }
          ],
          capabilityId:
            intent.kind === "edit_message"
              ? ("core:capability.message.edit" as const)
              : ("core:capability.message.delete" as const),
          capabilityManifestResource: {
            tenantId: fixtureTenantId,
            entityTypeId: "core:provider-capability-manifest",
            entityId: `provider_capability_manifest:${route.id}`
          },
          capabilityManifestSourceAccountResource: {
            tenantId: fixtureTenantId,
            entityTypeId: "core:source-account",
            entityId: route.sourceAccount.id
          },
          capabilityRevisionChecks: [
            {
              kind: "manifest" as const,
              expected: route.bindingFence.capabilityRevision,
              actual: route.bindingFence.capabilityRevision
            }
          ],
          capabilityState: "supported" as const,
          capabilityNotAfter: fixtureT4
        };
  const deletionMode =
    intent.kind === "delete_message_provider"
      ? ("provider_delete" as const)
      : intent.kind === "delete_message_local"
        ? ("local_tombstone" as const)
        : null;
  const topologyEvidence = {
    targetResource,
    targetRevisionChecks: [
      {
        kind: "entity" as const,
        expected: timelineItem.revision,
        actual: timelineItem.revision
      }
    ],
    contentTopologyResource: {
      tenantId: fixtureTenantId,
      entityTypeId: "core:timeline-content-topology",
      entityId: `timeline_content_topology:${timelineItem.id}`
    },
    topologyTimelineItemResource: targetResource,
    topologyConversationResource: conversationResource,
    topologyBoundary: externalBoundary
      ? ("external" as const)
      : ("internal" as const),
    topologyRevisionChecks: [
      { kind: "state" as const, expected: "1", actual: "1" }
    ],
    deletionMode,
    holdProof:
      deletionMode === null
        ? null
        : {
            resource: {
              tenantId: fixtureTenantId,
              entityTypeId: "core:content-hold-index",
              entityId: `content_hold_index:${timelineItem.id}`
            },
            targetResource,
            state: "none" as const,
            revisionChecks: [
              {
                kind: "legal_hold_set" as const,
                expected: "0",
                actual: "0"
              }
            ]
          }
  };
  const primaryAction =
    authority.kind === "own"
      ? {
          kind: "message_author_action" as const,
          operation:
            intent.kind === "edit_message"
              ? ("edit" as const)
              : ("delete" as const),
          ...topologyEvidence,
          actorEmployeeId: fixtureEmployeeReference.id,
          authorEmployeeId: authorEmployeeId!,
          contentBoundary: externalBoundary
            ? ("external" as const)
            : ("internal" as const),
          authorshipResource: {
            tenantId: fixtureTenantId,
            entityTypeId: "core:message-authorship",
            entityId: `message_authorship:${message.id}`
          },
          authorshipTimelineItemResource: targetResource,
          authorshipEmployeeResource: {
            tenantId: fixtureTenantId,
            entityTypeId: "core:employee",
            entityId: authorEmployeeId!
          },
          authorshipRevisionChecks: [
            {
              kind: "relation" as const,
              expected: authority.expectedAuthorshipRevision,
              actual: authority.expectedAuthorshipRevision
            }
          ],
          contentReadRequirementIds: [readRequirementId],
          ...providerEvidence
        }
      : {
          kind:
            authority.kind === "moderate_internal"
              ? ("internal_moderation" as const)
              : ("external_moderation" as const),
          operation:
            intent.kind === "edit_message"
              ? ("edit" as const)
              : ("delete" as const),
          ...topologyEvidence,
          contentReadResource: conversationResource,
          contentRelationTargetResource: targetResource,
          contentRelationReadResource: conversationResource,
          contentRelationRevisionChecks: [
            { kind: "relation" as const, expected: "1", actual: "1" }
          ],
          reason: authority.reasonId,
          auditEventId: "audit:message-lifecycle-1",
          contentReadRequirementId: readRequirementId,
          ...providerEvidence
        };
  const primaryGuard =
    authority.kind === "moderate_internal"
      ? {
          profileId: "core:rbac.guard.internal_membership" as const,
          conversationId: fixtureConversationReference.id,
          employeeId: fixtureEmployeeReference.id,
          membershipState: "active" as const,
          membershipOrigin: "hulee_internal_command" as const,
          membershipRole: "owner" as const,
          contentBoundary: "internal" as const,
          validUntil: fixtureT4,
          moderationAction: primaryAction
        }
      : {
          profileId: "core:rbac.guard.canonical_resource" as const,
          resourceState: "active" as const,
          contentBoundary: externalBoundary
            ? ("external" as const)
            : ("none" as const),
          routeInputFields: [],
          // The action fields below own the read/route companion links.
          companionRequirementIds: [],
          action: primaryAction
        };
  return {
    tenantId: fixtureTenantId,
    evaluatedAt: fixtureT1,
    principal: requestScope.principal,
    currentAuthorization: {
      tenantId: fixtureTenantId,
      authorizationEpoch: requestScope.authorizationEpoch,
      principal: {
        kind: "employee",
        employeeId: fixtureEmployeeReference.id
      }
    },
    grants: [],
    requirements: decisions.map((decision, index) => ({
      id:
        decision.permissionId === primaryPermission
          ? "requirement:lifecycle-primary"
          : decision.permissionId === readPermission &&
              decision.resource.entityTypeId === "core:conversation" &&
              String(decision.resource.entityId) ===
                String(fixtureConversationReference.id)
            ? readRequirementId
            : decision.permissionId === "core:source_account.use" &&
                route !== null &&
                String(decision.resource.entityId) ===
                  String(route.sourceAccount.id)
              ? sourceRequirementId
              : decision.permissionId === destinationParentPermission &&
                  decision.resource.entityTypeId === "core:conversation" &&
                  String(decision.resource.entityId) ===
                    String(fixtureConversationReference.id)
                ? destinationParentRequirementId
                : decision.permissionId === "core:file.view"
                  ? `requirement:lifecycle-file-view-${index + 1}`
                  : decision.permissionId === "core:file.upload"
                    ? `requirement:lifecycle-file-upload-${index + 1}`
                    : `requirement:lifecycle-extra-${index + 1}`,
      permissionId: decision.permissionId,
      resource: decision.resource,
      resourceAccessRevision: decision.resourceAccessRevision,
      guard:
        decision.permissionId === primaryPermission
          ? primaryGuard
          : decision.permissionId === "core:source_account.use" &&
              route !== null
            ? {
                profileId: "core:rbac.guard.source_account_route",
                operation: {
                  kind: "use",
                  sourceAccountResource: decision.resource,
                  bindingResource: {
                    tenantId: fixtureTenantId,
                    entityTypeId: "core:source-thread-binding",
                    entityId: route.sourceThreadBinding.id
                  },
                  capabilityManifest: {}
                },
                sourceAccountId: route.sourceAccount.id,
                routeSourceAccountId: route.sourceAccount.id,
                sourceState: "active",
                bindingState: "active",
                bindingGeneration: binding!.bindingGeneration,
                expectedBindingGeneration: binding!.bindingGeneration,
                capabilityState: "supported",
                capabilityNotAfter: fixtureT4
              }
            : {
                profileId: "core:rbac.guard.canonical_resource",
                resourceState: "active",
                contentBoundary: readPermission.endsWith("internal.read")
                  ? "none"
                  : "external",
                routeInputFields: [],
                companionRequirementIds: [],
                action: { kind: "canonical" }
              }
    }))
  } as unknown as InboxV2AuthorizationPlanInput;
}

function disclosureAuthorizationPlan(
  command: InboxV2MessageLifecycleCommand,
  visibilityBoundary: "external_work" | "internal"
): InboxV2AuthorizationPlanInput {
  return {
    tenantId: command.tenantId,
    principal: requestScope.principal,
    currentAuthorization: {
      tenantId: command.tenantId,
      authorizationEpoch: requestScope.authorizationEpoch,
      principal: {
        kind: "employee",
        employeeId: fixtureEmployeeReference.id
      }
    },
    requirements: [
      {
        permissionId:
          visibilityBoundary === "internal"
            ? "core:conversation.internal.read"
            : "core:conversation.read",
        resource: {
          tenantId: command.tenantId,
          entityTypeId: "core:conversation",
          entityId: command.conversationId
        },
        resourceAccessRevision: "1"
      }
    ]
  } as unknown as InboxV2AuthorizationPlanInput;
}

function authorizedMutationFor(
  command: InboxV2MessageLifecycleCommand,
  authorized: InboxV2AuthorizedCommand,
  requestHash: string,
  messageMutation: ReturnType<
    typeof inboxV2MessageMutationCommitSchema.parse
  > | null,
  providerCreation: InboxV2MessageProviderLifecycleOperationCreationCommit | null
): WithInboxV2AuthorizedCommandMutationInput {
  const messageReference =
    messageMutation === null
      ? null
      : {
          tenantId: fixtureTenantId,
          recordId: messageMutation.afterMessage.id,
          schemaId: INBOX_V2_MESSAGE_SCHEMA_ID,
          schemaVersion: INBOX_V2_MESSAGE_SCHEMA_VERSION,
          digest: calculateInboxV2CanonicalSha256(messageMutation.afterMessage)
        };
  const operationReference =
    providerCreation === null
      ? null
      : {
          tenantId: fixtureTenantId,
          recordId: providerCreation.operation.id,
          schemaId: INBOX_V2_MESSAGE_PROVIDER_LIFECYCLE_OPERATION_SCHEMA_ID,
          schemaVersion: INBOX_V2_MESSAGE_PROVIDER_LIFECYCLE_SCHEMA_VERSION,
          digest: calculateInboxV2CanonicalSha256(providerCreation.operation)
        };
  const operationCreationReference =
    providerCreation === null
      ? null
      : {
          tenantId: fixtureTenantId,
          recordId: providerCreation.operation.id,
          schemaId:
            INBOX_V2_MESSAGE_PROVIDER_LIFECYCLE_CREATION_COMMIT_SCHEMA_ID,
          schemaVersion: INBOX_V2_MESSAGE_PROVIDER_LIFECYCLE_SCHEMA_VERSION,
          digest: calculateInboxV2CanonicalSha256(providerCreation)
        };
  const messageRevisionReference =
    messageMutation === null
      ? null
      : {
          tenantId: fixtureTenantId,
          recordId: messageMutation.revision.id,
          schemaId: INBOX_V2_MESSAGE_REVISION_SCHEMA_ID,
          schemaVersion: INBOX_V2_MESSAGE_LIFECYCLE_SCHEMA_VERSION,
          digest: calculateInboxV2CanonicalSha256(messageMutation.revision)
        };
  const messageChange =
    messageReference === null
      ? null
      : {
          id: "change:lifecycle-message-1",
          ordinal: 1,
          entity: {
            tenantId: fixtureTenantId,
            entityTypeId: "core:message",
            entityId: command.messageId
          },
          resultingRevision: messageMutation!.afterMessage.revision,
          state: {
            kind: "upsert" as const,
            stateSchemaId: INBOX_V2_MESSAGE_SCHEMA_ID,
            stateSchemaVersion: INBOX_V2_MESSAGE_SCHEMA_VERSION,
            stateHash: messageReference.digest,
            payloadReference: messageReference,
            domainCommitReference: messageRevisionReference
          }
        };
  const operationChange =
    operationReference === null
      ? null
      : {
          id: "change:lifecycle-operation-1",
          ordinal: messageChange === null ? 1 : 2,
          entity: {
            tenantId: fixtureTenantId,
            entityTypeId:
              INBOX_V2_MESSAGE_PROVIDER_LIFECYCLE_OPERATION_ENTITY_TYPE_ID,
            entityId: providerCreation!.operation.id
          },
          resultingRevision: providerCreation!.operation.revision,
          state: {
            kind: "upsert" as const,
            stateSchemaId:
              INBOX_V2_MESSAGE_PROVIDER_LIFECYCLE_OPERATION_SCHEMA_ID,
            stateSchemaVersion:
              INBOX_V2_MESSAGE_PROVIDER_LIFECYCLE_SCHEMA_VERSION,
            stateHash: operationReference.digest,
            payloadReference: operationReference,
            domainCommitReference: operationCreationReference
          }
        };
  const changes = [messageChange, operationChange].filter(
    (change): change is NonNullable<typeof change> => change !== null
  );
  const eventReference = messageRevisionReference ?? operationCreationReference;
  if (eventReference === null) throw new Error("lifecycle event fixture");
  const lifecycleEvent = {
    id: "event:message-lifecycle-1",
    typeId: "core:message.changed",
    payloadSchemaId: eventReference.schemaId,
    payloadSchemaVersion: eventReference.schemaVersion,
    changeIds: changes.map(({ id }) => id),
    subjects: [
      {
        tenantId: fixtureTenantId,
        entityTypeId: "core:message",
        entityId: command.messageId
      }
    ],
    payloadReference: eventReference
  };
  const resultReference =
    command.kind === "delete_provider" ? operationReference : messageReference;
  const resultCode =
    command.kind === "edit"
      ? "core:message.edited"
      : command.kind === "delete_local"
        ? "core:message.deleted_local"
        : "core:message.provider_delete_queued";
  const commandType =
    command.kind === "edit"
      ? "core:message.edit"
      : command.kind === "delete_local"
        ? "core:message.delete_local"
        : "core:message.delete_provider";
  const lifecycleAuthority =
    authorized.intent.payload.kind === "edit_message" ||
    authorized.intent.payload.kind === "delete_message_local" ||
    authorized.intent.payload.kind === "delete_message_provider"
      ? authorized.intent.payload.mutationAuthority
      : undefined;
  if (lifecycleAuthority === undefined) {
    throw new Error("lifecycle mutation authority fixture");
  }
  const primaryPermission =
    lifecycleAuthority.kind === "moderate_internal"
      ? "core:message.moderate_internal"
      : lifecycleAuthority.kind === "moderate_external"
        ? "core:message.moderate_external"
        : command.kind === "edit"
          ? "core:message.edit_own"
          : "core:message.delete_own";
  const primaryDecision = authorized.authorizationDecisionRefs.find(
    (decision) => decision.permissionId === primaryPermission
  );
  const readDecision = authorized.authorizationDecisionRefs.find(
    (decision) =>
      decision.permissionId === "core:conversation.read" ||
      decision.permissionId === "core:conversation.internal.read"
  );
  const sourceDecision = authorized.authorizationDecisionRefs.find(
    (decision) => decision.permissionId === "core:source_account.use"
  );
  if (primaryDecision === undefined)
    throw new Error("primary decision fixture");
  if (readDecision === undefined) throw new Error("read decision fixture");
  const sortedPermissions = [
    ...new Set(
      authorized.authorizationDecisionRefs.map(
        (decision) => decision.permissionId
      )
    )
  ].sort();
  const sortedScopes = [
    ...new Set(
      authorized.authorizationDecisionRefs.map(
        (decision) => decision.resourceScopeId
      )
    )
  ].sort();
  return {
    tenantId: fixtureTenantId,
    command: {
      id: `command:${command.kind}-1`,
      requestId: `request:${command.kind}-1`,
      clientMutationId: command.clientMutationId,
      commandTypeId: commandType,
      requestHash,
      actor: { kind: "employee", employeeId: fixtureEmployeeReference.id },
      authorizationDecisionId: primaryDecision.id,
      authorizationEpoch: fixtureEmployeeActor.authorizationEpoch,
      authorizedAt: authorized.authorizedAt,
      publicResultCode: resultCode,
      resultReference,
      sensitiveResultReference: null
    },
    revisions: {
      expectedTenantRbacRevision: "1",
      expectedSharedAccessRevision: "1",
      advanceTenantRbac: false,
      advanceSharedAccess: false,
      employees: [
        {
          employeeId: fixtureEmployeeReference.id,
          expectedEmployeeAccessRevision: "1",
          expectedEmployeeInboxRelationRevision: "1",
          advanceEmployeeAccess: false,
          advanceEmployeeInboxRelation: false
        }
      ],
      resources: [
        {
          resourceKind: "conversation",
          resourceId: fixtureConversationReference.id,
          resourceHeadId: "authorization_resource_head:lifecycle-conversation",
          expectedResourceAccessRevision: readDecision.resourceAccessRevision,
          advance: "none"
        },
        ...(sourceDecision === undefined
          ? []
          : [
              {
                resourceKind: "source_account" as const,
                resourceId: fixtureSourceAccountReference.id,
                resourceHeadId:
                  "authorization_resource_head:lifecycle-source-account",
                expectedResourceAccessRevision:
                  sourceDecision.resourceAccessRevision,
                advance: "none" as const
              }
            ])
      ]
    },
    records: {
      changes,
      events: [lifecycleEvent],
      outboxIntents: [
        {
          id: "outbox-intent:message-lifecycle-projection-1",
          ordinal: 1,
          typeId: "core:projection.update",
          handlerId: "core:inbox-projection",
          effectClass: "projection",
          eventId: "event:message-lifecycle-1",
          changeIds: changes.map(({ id }) => id),
          payloadReference: null,
          consumerDedupeKey: hash("message-lifecycle-projection-dedupe"),
          correlationId: "correlation:message-lifecycle-1",
          availableAt: fixtureT3,
          intentHash: hash("message-lifecycle-projection-intent")
        },
        ...(operationReference === null
          ? []
          : [
              {
                id: "outbox-intent:message-lifecycle-1",
                ordinal: 2,
                typeId: "core:provider.message_lifecycle",
                handlerId: "core:provider-message-lifecycle-worker",
                effectClass: "provider_io",
                eventId: "event:message-lifecycle-1",
                changeIds: [operationChange!.id],
                payloadReference: operationReference,
                consumerDedupeKey: hash("provider-lifecycle-dedupe"),
                correlationId: "correlation:message-lifecycle-1",
                availableAt: fixtureT3,
                intentHash: hash("provider-lifecycle-intent")
              }
            ])
      ],
      audit: {
        id: "audit:message-lifecycle-1",
        actionId: commandType,
        reasonCodeId:
          lifecycleAuthority.kind !== "own"
            ? lifecycleAuthority.reasonId
            : "reasonId" in command
              ? command.reasonId
              : "core:message-edit-requested",
        authorizationDecisionRefs: authorized.authorizationDecisionRefs,
        matchedPermissionIds: sortedPermissions,
        authorizationScopeIds: sortedScopes
      }
    },
    occurredAt: fixtureT3
  } as unknown as WithInboxV2AuthorizedCommandMutationInput;
}

function routeAuthorization(
  creation: InboxV2MessageProviderLifecycleOperationCreationCommit
) {
  const route = creation.outboundRoute;
  if (route === null) throw new Error("requested route fixture");
  return {
    conversation: fixtureConversationReference,
    outboundRoute: fixtureRouteReference,
    routeRevision: route.revision,
    sourceAccount: fixtureSourceAccountReference,
    sourceThreadBinding: fixtureBindingReference,
    bindingFence: route.bindingFence
  };
}

function ownAuthority(
  authorParticipant: Readonly<{ tenantId: string; id: string }>,
  timelineItem: Readonly<{ tenantId: string; id: string }>
) {
  return {
    kind: "own" as const,
    appActor: fixtureEmployeeActor,
    conversation: fixtureConversationReference,
    message: fixtureMessageReference,
    timelineItem: {
      tenantId: timelineItem.tenantId,
      kind: "timeline_item" as const,
      id: timelineItem.id
    },
    authorParticipant: {
      tenantId: fixtureTenantId,
      kind: "conversation_participant" as const,
      id: authorParticipant.id
    },
    expectedAuthorshipRevision: "1"
  };
}

function advancedTimelineItem(
  before:
    | ReturnType<typeof fixtureTimelineItem>
    | ReturnType<typeof inboxV2TimelineItemSchema.parse>
) {
  return {
    ...before,
    subject: {
      kind: "message" as const,
      message: fixtureMessageReference,
      messageRevision: "2"
    },
    revision: "2",
    updatedAt: fixtureT3
  };
}

function moderationAuthority(
  kind: "moderate_internal" | "moderate_external",
  timelineItem: Readonly<{ tenantId: string; id: string }>
) {
  return {
    kind,
    appActor: fixtureEmployeeActor,
    conversation: fixtureConversationReference,
    message: fixtureMessageReference,
    timelineItem: {
      tenantId: timelineItem.tenantId,
      kind: "timeline_item" as const,
      id: timelineItem.id
    },
    reasonId:
      kind === "moderate_internal"
        ? "core:moderation.internal"
        : "core:moderation.external"
  };
}

function serviceFor(
  fixture: SelectedFixture,
  coordinator: InboxV2MessageLifecycleAtomicCoordinator
) {
  return createInboxV2MessageLifecycleCommandService({
    requestScope,
    preparer: preparerReturning(fixture.prepared),
    denialSink: denialSink(),
    coordinator,
    authorizationGate: allowGate()
  });
}

function executableInternalAuthorizationPlan(
  fixture: SelectedFixture
): InboxV2AuthorizationPlanInput {
  const base = fixture.prepared.authorizationPlan;
  const authorization = fixture.prepared.authorizedCommand.principal;
  if (authorization.kind !== "employee") {
    throw new Error("employee lifecycle authorization fixture");
  }
  const primary = base.requirements.find(
    (requirement) =>
      requirement.permissionId ===
      (fixture.command.kind === "edit"
        ? "core:message.edit_own"
        : "core:message.delete_own")
  );
  const contentRead = base.requirements.find(
    (requirement) =>
      requirement.permissionId === "core:conversation.internal.read"
  );
  if (primary === undefined || contentRead === undefined) {
    throw new Error("internal lifecycle authorization requirements");
  }
  const parentAuthority = base.requirements.find(
    (requirement) =>
      requirement.permissionId === "core:message.send_internal" &&
      requirement.resource.entityTypeId === "core:conversation" &&
      String(requirement.resource.entityId) ===
        String(fixtureConversationReference.id)
  );
  const fileRequirements = base.requirements.filter(
    (requirement) =>
      requirement.permissionId === "core:file.view" ||
      requirement.permissionId === "core:file.upload"
  );
  if (fileRequirements.length > 0 && parentAuthority === undefined) {
    throw new Error("attachment edit parent authority requirement");
  }
  const conversationResource = contentRead.resource;
  const lifecycleIntent =
    fixture.prepared.authorizedCommand.intent.payload.kind === "edit_message"
      ? fixture.prepared.authorizedCommand.intent.payload
      : null;
  const canonicalPath = (
    resource: typeof primary.resource,
    scopeTarget: typeof primary.resource,
    suffix: string
  ) => ({
    resource,
    scopeTarget,
    pathRevisionChecks: [
      { kind: "relation" as const, expected: "1", actual: "1" },
      { kind: "state" as const, expected: "1", actual: "1" }
    ],
    authorityProvenance: {
      kind: "hulee_canonical_repository" as const,
      factId: `fact:lifecycle-${suffix}`,
      loaderDecisionId: `loader-decision:lifecycle-${suffix}`,
      projectionRevision: "1",
      observedAt: fixtureT1
    }
  });
  const requirements = base.requirements.map((requirement) => {
    const common = {
      ...requirement,
      expectedResourceAccessRevision: requirement.resourceAccessRevision,
      revisionChecks: [],
      authorizationSubject: { kind: "actor" as const }
    };
    if (requirement === primary) {
      return {
        ...common,
        scopeFacts: [
          {
            kind: "conversation" as const,
            ...canonicalPath(
              requirement.resource,
              conversationResource,
              "primary-conversation"
            ),
            conversationId: fixtureConversationReference.id,
            validUntil: fixtureT4
          }
        ],
        visibility: "primary" as const
      };
    }
    if (
      requirement.permissionId === "core:file.view" ||
      requirement.permissionId === "core:file.upload"
    ) {
      const fileProof = lifecycleIntent?.fileReadProofs?.find(
        (proof) =>
          String(proof.file.id) === String(requirement.resource.entityId)
      );
      if (fileProof === undefined) {
        throw new Error("attachment edit File requirement proof");
      }
      const operation =
        requirement.permissionId === "core:file.view"
          ? ("view" as const)
          : ("upload" as const);
      const sourceConversation =
        fileProof.sourceParent.kind === "upload_staging"
          ? fileProof.parentConversation
          : fileProof.sourceParent.conversation;
      const fileParentConversationResource = {
        tenantId: sourceConversation.tenantId,
        entityTypeId: "core:conversation" as const,
        entityId: sourceConversation.id
      };
      const parentBoundary =
        fileProof.sourceParent.kind === "staff_note"
          ? ("staff_only" as const)
          : fileProof.sourceParent.kind === "message"
            ? fileProof.sourceParent.visibilityBoundary === "internal"
              ? ("internal" as const)
              : ("external" as const)
            : fileProof.visibilityBoundary === "internal"
              ? ("internal" as const)
              : ("external" as const);
      const stagingEmployee =
        fileProof.sourceParent.kind === "upload_staging" &&
        fileProof.sourceParent.appActor.kind === "employee"
          ? fileProof.sourceParent.appActor.employee
          : null;
      return {
        ...common,
        scopeFacts: [],
        guard: {
          profileId: "core:rbac.guard.file_parent_content" as const,
          targetResource: requirement.resource,
          parentResource: fileParentConversationResource,
          parentRelationResource: {
            tenantId: fixtureTenantId,
            entityTypeId: "core:file-parent-relation",
            entityId: `file_parent_relation:lifecycle-${String(requirement.resource.entityId)}`
          },
          relationFileResource: requirement.resource,
          relationParentResource: fileParentConversationResource,
          relationBoundary: parentBoundary,
          parentRelationRevisionChecks: [
            { kind: "relation" as const, expected: "1", actual: "1" }
          ],
          holdIndexResource: {
            tenantId: fixtureTenantId,
            entityTypeId: "core:file-hold-index",
            entityId: `file_hold_index:lifecycle-${String(requirement.resource.entityId)}`
          },
          holdIndexFileResource: requirement.resource,
          holdRevisionChecks: [
            { kind: "state" as const, expected: "1", actual: "1" }
          ],
          uploaderRelationResource:
            stagingEmployee === null
              ? null
              : {
                  tenantId: stagingEmployee.tenantId,
                  entityTypeId: "core:file-uploader-relation" as const,
                  entityId: `file_uploader_relation:lifecycle-${String(requirement.resource.entityId)}`
                },
          uploaderRelationFileResource:
            stagingEmployee === null ? null : requirement.resource,
          uploaderEmployeeResource:
            stagingEmployee === null
              ? null
              : {
                  tenantId: stagingEmployee.tenantId,
                  entityTypeId: "core:employee" as const,
                  entityId: stagingEmployee.id
                },
          uploaderRevisionChecks:
            stagingEmployee === null
              ? []
              : [{ kind: "relation" as const, expected: "1", actual: "1" }],
          parentBoundary,
          parentRequirementIds:
            operation === "upload"
              ? [contentRead.id, parentAuthority!.id]
              : [contentRead.id],
          retentionState: "available" as const,
          holdState: "none" as const,
          operation,
          storagePolicyState: "allowed" as const,
          actorEmployeeId: fixtureEmployeeReference.id,
          uploaderEmployeeId: stagingEmployee?.id ?? null,
          moderationRequirementId: null,
          expectedFileRevision: requirement.resourceAccessRevision,
          currentFileRevision: requirement.resourceAccessRevision
        },
        visibility: "secondary_hidden" as const
      };
    }
    return {
      ...common,
      scopeFacts: [
        {
          kind: "internal_participant" as const,
          ...canonicalPath(
            requirement.resource,
            conversationResource,
            "content-read-membership"
          ),
          employeeId: fixtureEmployeeReference.id,
          conversationId: fixtureConversationReference.id,
          origin: "hulee_internal_command" as const,
          state: "active" as const,
          role: "member" as const,
          membershipRevision: "1",
          currentMembershipRevision: "1",
          validUntil: fixtureT4
        }
      ],
      guard: {
        profileId: "core:rbac.guard.internal_membership" as const,
        conversationId: fixtureConversationReference.id,
        employeeId: fixtureEmployeeReference.id,
        membershipState: "active" as const,
        membershipOrigin: "hulee_internal_command" as const,
        membershipRole: "member" as const,
        contentBoundary: "internal" as const,
        validUntil: fixtureT4
      },
      visibility: "secondary_hidden" as const
    };
  });
  const dependencies = authorization.authorization.dependencies;
  const directGrant = (
    id: string,
    permissionId: string,
    scope:
      | Readonly<{
          type: "conversation";
          tenantId: typeof fixtureTenantId;
          id: string;
        }>
      | Readonly<{
          type: "tenant";
          tenantId: typeof fixtureTenantId;
        }>
      | Readonly<{
          type: "internal_participant";
          tenantId: typeof fixtureTenantId;
        }>
  ) => ({
    id: `grant:${id}`,
    tenantId: fixtureTenantId,
    principal: {
      kind: "employee" as const,
      employeeId: fixtureEmployeeReference.id
    },
    permissionId,
    catalogSchemaId: "core:inbox-v2.permission-scope-catalog" as const,
    catalogVersion: "v1" as const,
    scope,
    source: {
      kind: "direct_grant" as const,
      origin: "inbox_v2_native" as const,
      directGrantId: id,
      bindingResource: {
        tenantId: fixtureTenantId,
        entityTypeId: "core:direct-grant",
        entityId: `direct_grant:${id}`
      },
      bindingRevision: "1"
    },
    revision: "1",
    validFrom: null,
    validUntil: fixtureT4,
    revokedAt: null
  });
  return {
    tenantId: fixtureTenantId,
    evaluatedAt: fixtureT1,
    principal: {
      kind: "employee",
      employee: fixtureEmployeeReference,
      lifecycle: "active",
      session: {
        state: "active",
        authorization: authorization.authorization,
        notAfter: fixtureT4
      }
    },
    currentAuthorization: {
      tenantId: fixtureTenantId,
      authorizationEpoch: requestScope.authorizationEpoch,
      principal: {
        kind: "employee",
        employeeId: fixtureEmployeeReference.id
      },
      dependencies
    },
    grants: [
      directGrant(
        "lifecycle-primary",
        fixture.command.kind === "edit"
          ? "core:message.edit_own"
          : "core:message.delete_own",
        {
          type: "conversation",
          tenantId: fixtureTenantId,
          id: fixtureConversationReference.id
        }
      ),
      directGrant("lifecycle-content-read", "core:conversation.internal.read", {
        type: "internal_participant",
        tenantId: fixtureTenantId
      }),
      ...(parentAuthority === undefined
        ? []
        : [
            directGrant(
              "lifecycle-file-parent-authority",
              parentAuthority.permissionId,
              {
                type: "internal_participant" as const,
                tenantId: fixtureTenantId
              }
            )
          ]),
      ...fileRequirements.map((requirement, index) =>
        directGrant(`lifecycle-file-${index + 1}`, requirement.permissionId, {
          type: "tenant",
          tenantId: fixtureTenantId
        })
      )
    ],
    requirements
  } as unknown as InboxV2AuthorizationPlanInput;
}

function preparerReturning(
  prepared: InboxV2PreparedMessageLifecycleCommand
): InboxV2MessageLifecycleCommandPreparer {
  return {
    lookupIdempotency: vi.fn(async () => null),
    prepareNew: vi.fn(async () => prepared as never)
  };
}

function appliedCoordinator(
  fixture: SelectedFixture,
  overrides: Readonly<{
    messageId?: string;
    messageRevision?: string | null;
    providerOperationId?: string | null;
  }> = {}
): InboxV2MessageLifecycleAtomicCoordinator {
  const messageRevision =
    fixture.messageMutation?.afterMessage.revision ?? null;
  const providerOperationId = fixture.providerCreation?.operation.id ?? null;
  return {
    withAuthorizedMessageLifecycleMutation: vi.fn(async () => ({
      kind: "applied" as const,
      result: {
        messageId: overrides.messageId ?? fixture.command.messageId,
        messageRevision:
          overrides.messageRevision === undefined
            ? messageRevision
            : overrides.messageRevision,
        providerOperationId:
          overrides.providerOperationId === undefined
            ? providerOperationId
            : overrides.providerOperationId
      },
      status: appliedStatus(fixture.command, providerOperationId),
      revisionEffects: []
    }))
  };
}

function coordinatorThatMustNotRun(): InboxV2MessageLifecycleAtomicCoordinator {
  return { withAuthorizedMessageLifecycleMutation: vi.fn() };
}

function appliedStatus(
  command: InboxV2MessageLifecycleCommand,
  providerOperationId: string | null
): InboxV2PrivilegedAuthorizationMutationAppliedStatus {
  return {
    ...replayStatus(command, providerOperationId ?? command.messageId),
    sensitiveResultReference: null
  };
}

function replayStatus(
  command: InboxV2MessageLifecycleCommand,
  targetId: string
): InboxV2PrivilegedAuthorizationMutationReplayStatus {
  const providerDelete = command.kind === "delete_provider";
  return {
    commandId: `command:${command.kind}-1`,
    mutationId: `authorization-mutation:${command.kind}-1`,
    publicResultCode: idempotencyScope(command).publicResultCode,
    resultReference: {
      tenantId: fixtureTenantId,
      recordId: targetId,
      schemaId: providerDelete
        ? INBOX_V2_MESSAGE_PROVIDER_LIFECYCLE_OPERATION_SCHEMA_ID
        : INBOX_V2_MESSAGE_SCHEMA_ID,
      schemaVersion: providerDelete
        ? INBOX_V2_MESSAGE_PROVIDER_LIFECYCLE_SCHEMA_VERSION
        : INBOX_V2_MESSAGE_SCHEMA_VERSION,
      digest: hash(`result-${command.kind}`)
    },
    streamCommitId: `commit:${command.kind}-1`,
    streamEpoch: "stream:lifecycle-1",
    streamPosition: "1",
    committedAt: fixtureT3
  } as unknown as InboxV2PrivilegedAuthorizationMutationReplayStatus;
}

function idempotencyScope(
  command: InboxV2MessageLifecycleCommand
): InboxV2MessageLifecycleIdempotencyScope {
  return {
    tenantId: command.tenantId,
    principal: requestScope.principal,
    authorizationEpoch: requestScope.authorizationEpoch,
    commandTypeId:
      command.kind === "edit"
        ? "core:message.edit"
        : command.kind === "delete_local"
          ? "core:message.delete_local"
          : "core:message.delete_provider",
    clientMutationId: command.clientMutationId,
    publicResultCode:
      command.kind === "edit"
        ? "core:message.edited"
        : command.kind === "delete_local"
          ? "core:message.deleted_local"
          : "core:message.provider_delete_queued"
  };
}

function allowGate(): NonNullable<
  InboxV2MessageLifecycleCommandServiceOptions["authorizationGate"]
> {
  return (async (input: { executeAllowed: () => Promise<unknown> }) => ({
    outcome: "allowed" as const,
    publicDecision: { outcome: "allowed" as const, notAfter: fixtureT4 },
    value: await input.executeAllowed()
  })) as NonNullable<
    InboxV2MessageLifecycleCommandServiceOptions["authorizationGate"]
  >;
}

function denialSink(): InboxV2SecurityDenialSink {
  return { record: vi.fn() } as unknown as InboxV2SecurityDenialSink;
}

function hash(value: string): string {
  return calculateInboxV2CanonicalSha256(value);
}
