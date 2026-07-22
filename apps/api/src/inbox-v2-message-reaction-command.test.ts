import { describe, expect, it, vi } from "vitest";

import {
  calculateInboxV2CanonicalSha256,
  INBOX_V2_MESSAGE_REACTION_COMMIT_SCHEMA_ID,
  INBOX_V2_MESSAGE_REACTION_SCHEMA_VERSION,
  INBOX_V2_MESSAGE_REACTION_TRANSITION_SCHEMA_ID,
  inboxV2AuthorizationDecisionReferenceSchema,
  inboxV2AuthorizationEpochSchema,
  inboxV2AuthorizedCommandSchema,
  inboxV2MessageReactionCommitSchema,
  inboxV2OutboundRoutePrincipalSchema,
  inboxV2PayloadRecordIdSchema,
  inboxV2ReactionSemanticSlotKeyFor,
  inboxV2TenantIdSchema,
  inboxV2TimelineCommandIntentSchema,
  type InboxV2AuthorizationDecisionReference,
  type InboxV2AuthorizedCommand,
  type InboxV2MessageReaction,
  type InboxV2TimelineCommandIntent
} from "@hulee/contracts";
import {
  type InboxV2AuthorizationPlanInput,
  type InboxV2SecurityDenialContext,
  type InboxV2SecurityDenialSink
} from "@hulee/core";
import {
  deriveInboxV2MessageReactionAuditTargetReference,
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
  calculateInboxV2MessageReactionIntentDigest,
  createInboxV2MessageReactionCommandService,
  INBOX_V2_MESSAGE_REACTION_RESULT_CODE,
  type InboxV2MessageReactionAtomicCoordinator,
  type InboxV2MessageReactionCommand,
  type InboxV2MessageReactionCommandPreparer,
  type InboxV2MessageReactionCommandServiceOptions,
  type InboxV2MessageReactionIdempotencyScope,
  type InboxV2MessageReactionRequestScope,
  type InboxV2PreparedMessageReactionCommand
} from "./inbox-v2-message-reaction-command";

type ReactionCommit = ReturnType<
  typeof inboxV2MessageReactionCommitSchema.parse
>;
type ReactionIntent = Extract<
  InboxV2TimelineCommandIntent,
  { kind: "reaction_set" | "reaction_replace" | "reaction_clear" }
>;

const reactionId = "message_reaction:reaction-1";
const transitionId = "message_reaction_transition:transition-1";
const employeeParticipant = fixtureReference(
  "conversation_participant",
  "conversation_participant:employee-1"
);
const requestScope: InboxV2MessageReactionRequestScope = {
  tenantId: inboxV2TenantIdSchema.parse(fixtureTenantId),
  principal: inboxV2OutboundRoutePrincipalSchema.parse({
    kind: "employee",
    employee: fixtureEmployeeReference
  }),
  authorizationEpoch: inboxV2AuthorizationEpochSchema.parse(
    fixtureEmployeeActor.authorizationEpoch
  )
};

describe("Inbox V2 Message reaction command", () => {
  it("returns a committed replay before reading mutable Message or route state", async () => {
    const fixture = selectedFixture("set", false);
    const prepareNew = vi.fn();
    const coordinator = coordinatorThatMustNotRun();
    const service = createInboxV2MessageReactionCommandService({
      requestScope,
      preparer: {
        lookupIdempotency: vi.fn(async () => ({
          kind: "committed_replay" as const,
          requestHash: calculateInboxV2MessageReactionIntentDigest(
            fixture.command
          ),
          scope: idempotencyScope(fixture.command),
          status: exactReplayStatus(fixture)
        })),
        prepareNew
      },
      denialSink: denialSink(),
      coordinator
    });

    await expect(service.execute(fixture.command)).resolves.toMatchObject({
      outcome: "already_applied",
      action: "set",
      transitionId
    });
    expect(prepareNew).not.toHaveBeenCalled();
    expect(
      coordinator.withAuthorizedMessageReactionMutation
    ).not.toHaveBeenCalled();
  });

  it("discloses a stale reaction revision only through the authorization gate", async () => {
    const fixture = selectedFixture("clear", false);
    const authorizationGate = vi.fn(allowGate()) as unknown as NonNullable<
      InboxV2MessageReactionCommandServiceOptions["authorizationGate"]
    >;
    const service = createInboxV2MessageReactionCommandService({
      requestScope,
      preparer: {
        lookupIdempotency: vi.fn(async () => null),
        prepareNew: vi.fn(async () => ({
          kind: "revision_conflict" as const,
          requestHash: calculateInboxV2MessageReactionIntentDigest(
            fixture.command
          ),
          scope: idempotencyScope(fixture.command),
          disclosureAuthorizationPlan: disclosurePlan(fixture.command),
          denialContext: {} as InboxV2SecurityDenialContext
        }))
      },
      denialSink: denialSink(),
      coordinator: coordinatorThatMustNotRun(),
      authorizationGate
    });

    await expect(service.execute(fixture.command)).resolves.toEqual({
      outcome: "revision_conflict"
    });
    expect(authorizationGate).toHaveBeenCalledOnce();
  });

  it("does not disclose a stale revision when Message reaction access is denied", async () => {
    const fixture = selectedFixture("clear", false);
    const coordinator = coordinatorThatMustNotRun();
    const service = createInboxV2MessageReactionCommandService({
      requestScope,
      preparer: {
        lookupIdempotency: vi.fn(async () => null),
        prepareNew: vi.fn(async () => ({
          kind: "revision_conflict" as const,
          requestHash: calculateInboxV2MessageReactionIntentDigest(
            fixture.command
          ),
          scope: idempotencyScope(fixture.command),
          disclosureAuthorizationPlan: disclosurePlan(fixture.command),
          denialContext: {} as InboxV2SecurityDenialContext
        }))
      },
      denialSink: denialSink(),
      coordinator,
      authorizationGate: denyGate("resource.not_found")
    });

    await expect(service.execute(fixture.command)).resolves.toEqual({
      outcome: "denied",
      errorCode: "resource.not_found"
    });
    expect(
      coordinator.withAuthorizedMessageReactionMutation
    ).not.toHaveBeenCalled();
  });

  it("rejects stale disclosure authority from a neighboring Conversation", async () => {
    const fixture = selectedFixture("clear", false);
    const authorizationGate = vi.fn(allowGate()) as unknown as NonNullable<
      InboxV2MessageReactionCommandServiceOptions["authorizationGate"]
    >;
    const plan = disclosurePlan(fixture.command);
    const service = createInboxV2MessageReactionCommandService({
      requestScope,
      preparer: {
        lookupIdempotency: vi.fn(async () => null),
        prepareNew: vi.fn(async () => ({
          kind: "revision_conflict" as const,
          requestHash: calculateInboxV2MessageReactionIntentDigest(
            fixture.command
          ),
          scope: idempotencyScope(fixture.command),
          disclosureAuthorizationPlan: {
            ...plan,
            requirements: plan.requirements.map((requirement) => ({
              ...requirement,
              resource: {
                ...requirement.resource,
                entityId: "conversation:neighbor"
              }
            }))
          } as unknown as InboxV2AuthorizationPlanInput,
          denialContext: {} as InboxV2SecurityDenialContext
        }))
      },
      denialSink: denialSink(),
      coordinator: coordinatorThatMustNotRun(),
      authorizationGate
    });

    await expect(service.execute(fixture.command)).rejects.toThrow(
      "permission.denied"
    );
    expect(authorizationGate).not.toHaveBeenCalled();
  });

  for (const kind of ["set", "clear"] as const) {
    it(`applies internal reaction ${kind} with exact TimelineItem authority and no provider effect`, async () => {
      const fixture = selectedFixture(kind, false);
      const coordinator = appliedCoordinator(fixture);
      const service = serviceFor(fixture, coordinator);

      await expect(service.execute(fixture.command)).resolves.toMatchObject({
        outcome: "applied",
        reaction: { id: reactionId },
        transitionId
      });
      const input = vi.mocked(coordinator.withAuthorizedMessageReactionMutation)
        .mock.calls[0]?.[0];
      const decisions =
        fixture.prepared.authorizedCommand.authorizationDecisionRefs;
      expect(decisions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            permissionId: "core:message.react",
            resourceScopeId: "core:timeline-item",
            resource: expect.objectContaining({
              entityId: fixtureTimelineItemReference.id
            })
          }),
          expect.objectContaining({
            permissionId: "core:conversation.internal.read",
            resourceScopeId: "core:conversation",
            resource: expect.objectContaining({
              entityId: fixtureConversationReference.id
            })
          })
        ])
      );
      expect(
        input?.authorizedMutation.records.outboxIntents.filter(
          (intent) => intent.effectClass === "provider_io"
        )
      ).toEqual([]);
    });
  }

  it("keeps an external replace pending and emits exactly one exact-route provider reaction", async () => {
    const fixture = selectedFixture("replace", true);
    const coordinator = appliedCoordinator(fixture);
    const service = serviceFor(fixture, coordinator);

    await expect(service.execute(fixture.command)).resolves.toMatchObject({
      outcome: "pending_external",
      reaction: { state: { kind: "pending_external" } },
      transitionId
    });
    const input = vi.mocked(coordinator.withAuthorizedMessageReactionMutation)
      .mock.calls[0]?.[0];
    expect(
      input?.authorizedMutation.records.outboxIntents.filter(
        (intent) => intent.effectClass === "provider_io"
      )
    ).toEqual([
      expect.objectContaining({ typeId: "core:provider.message_reaction" })
    ]);
    expect(
      fixture.commit.externalAuthorityEvidence?.outboundRoute
    ).toMatchObject({
      id: fixtureRouteReference.id,
      sourceAccount: fixtureSourceAccountReference,
      sourceThreadBinding: fixtureBindingReference,
      selection: {
        intent: {
          kind: "explicit_occurrence",
          occurrence: fixtureSourceOccurrenceReference
        },
        reason: "explicit_occurrence"
      }
    });
    expect(
      fixture.prepared.authorizedCommand.authorizationDecisionRefs.map(
        ({ permissionId }) => permissionId
      )
    ).toEqual(
      expect.arrayContaining([
        "core:message.react",
        "core:conversation.read",
        "core:source_account.use"
      ])
    );
  });

  it("rejects a fallback route even when the forged intent remains contract-valid", async () => {
    const fixture = selectedFixture("replace", true);
    const authorized = fixture.prepared.authorizedCommand;
    const intent = authorized.intent.payload as ReactionIntent;
    if (intent.target.kind !== "external") {
      throw new Error("external reaction fixture");
    }
    const fallbackRoute = fixtureReference(
      "outbound_route",
      "outbound_route:fallback"
    );
    const forgedAuthorized = inboxV2AuthorizedCommandSchema.parse({
      ...authorized,
      intent: {
        ...authorized.intent,
        payload: {
          ...intent,
          target: {
            ...intent.target,
            outboundRoute: fallbackRoute,
            routeAuthorization: {
              ...intent.target.routeAuthorization!,
              outboundRoute: fallbackRoute
            }
          }
        }
      }
    });
    const coordinator = coordinatorThatMustNotRun();
    const service = createInboxV2MessageReactionCommandService({
      requestScope,
      preparer: preparerReturning({
        ...fixture.prepared,
        authorizedCommand: forgedAuthorized
      }),
      denialSink: denialSink(),
      coordinator,
      authorizationGate: allowGate()
    });

    await expect(service.execute(fixture.command)).rejects.toThrow(
      "permission.denied"
    );
    expect(
      coordinator.withAuthorizedMessageReactionMutation
    ).not.toHaveBeenCalled();
  });

  it("rejects caller-supplied actor/account/route fields before any repository read", async () => {
    const fixture = selectedFixture("set", false);
    const preparer = preparerReturning(fixture.prepared);
    const coordinator = appliedCoordinator(fixture);
    const injected = {
      ...fixture.command,
      actor: { kind: "trusted_service", trustedServiceId: "core:forged" },
      sourceAccount: fixtureReference(
        "source_account",
        "source_account:forged"
      ),
      outboundRoute: fixtureReference("outbound_route", "outbound_route:forged")
    } as unknown as InboxV2MessageReactionCommand;
    const service = createInboxV2MessageReactionCommandService({
      requestScope,
      preparer,
      denialSink: denialSink(),
      coordinator,
      authorizationGate: allowGate()
    });

    expect(() => calculateInboxV2MessageReactionIntentDigest(injected)).toThrow(
      "Message reaction accepts only"
    );
    await expect(service.execute(injected)).rejects.toEqual(
      expect.objectContaining({ code: "validation.failed" })
    );
    expect(preparer.lookupIdempotency).not.toHaveBeenCalled();
    expect(preparer.prepareNew).not.toHaveBeenCalled();
    expect(
      coordinator.withAuthorizedMessageReactionMutation
    ).not.toHaveBeenCalled();
  });

  it("rejects an unknown runtime kind instead of coercing it to clear", async () => {
    const fixture = selectedFixture("clear", false);
    const preparer = preparerReturning(fixture.prepared);
    const malformed = {
      ...fixture.command,
      kind: "delete"
    } as unknown as InboxV2MessageReactionCommand;
    const service = createInboxV2MessageReactionCommandService({
      requestScope,
      preparer,
      denialSink: denialSink(),
      coordinator: coordinatorThatMustNotRun()
    });

    expect(() =>
      calculateInboxV2MessageReactionIntentDigest(malformed)
    ).toThrow("Message reaction accepts only");
    await expect(service.execute(malformed)).rejects.toEqual(
      expect.objectContaining({ code: "validation.failed" })
    );
    expect(preparer.lookupIdempotency).not.toHaveBeenCalled();
    expect(preparer.prepareNew).not.toHaveBeenCalled();
  });

  it("rejects audit-target and change-set tampering before the coordinator", async () => {
    const fixture = selectedFixture("set", false);
    const mutation = fixture.prepared.authorizedMutation;
    const forgeries = [
      {
        ...mutation,
        records: {
          ...mutation.records,
          changes: [...mutation.records.changes, mutation.records.changes[0]!]
        }
      },
      {
        ...mutation,
        records: {
          ...mutation.records,
          audit: {
            ...mutation.records.audit,
            target: {
              tenantId: fixtureTenantId,
              entityTypeId: "core:conversation",
              entityId: fixtureConversationReference.id
            }
          }
        }
      },
      {
        ...mutation,
        records: {
          ...mutation.records,
          audit: {
            ...mutation.records.audit,
            target: deriveInboxV2MessageReactionAuditTargetReference({
              tenantId: fixtureTenantId,
              timelineItemId: `${fixture.commit.beforeTimelineItem.id}-neighbor`
            })
          }
        }
      },
      {
        ...mutation,
        records: {
          ...mutation.records,
          changes: mutation.records.changes.map((change) => ({
            ...change,
            state:
              change.state.kind === "upsert"
                ? {
                    ...change.state,
                    payloadReference: {
                      ...change.state.payloadReference,
                      digest: hash("forged-transition-payload")
                    }
                  }
                : change.state
          }))
        }
      },
      {
        ...mutation,
        records: {
          ...mutation.records,
          events: mutation.records.events.map((event) => ({
            ...event,
            changeIds: []
          }))
        }
      }
    ];

    for (const forged of forgeries) {
      const coordinator = coordinatorThatMustNotRun();
      const service = createInboxV2MessageReactionCommandService({
        requestScope,
        preparer: preparerReturning({
          ...fixture.prepared,
          authorizedMutation:
            forged as unknown as WithInboxV2AuthorizedCommandMutationInput
        }),
        denialSink: denialSink(),
        coordinator,
        authorizationGate: allowGate()
      });

      await expect(service.execute(fixture.command)).rejects.toThrow(
        "permission.denied"
      );
      expect(
        coordinator.withAuthorizedMessageReactionMutation
      ).not.toHaveBeenCalled();
    }
  });

  it("rejects a wrong provider reaction payload before the coordinator", async () => {
    const fixture = selectedFixture("replace", true);
    const mutation = fixture.prepared.authorizedMutation;
    const forged = {
      ...mutation,
      records: {
        ...mutation.records,
        outboxIntents: mutation.records.outboxIntents.map((intent) =>
          intent.effectClass === "provider_io"
            ? { ...intent, payloadReference: null }
            : intent
        )
      }
    } as WithInboxV2AuthorizedCommandMutationInput;
    const coordinator = coordinatorThatMustNotRun();
    const service = createInboxV2MessageReactionCommandService({
      requestScope,
      preparer: preparerReturning({
        ...fixture.prepared,
        authorizedMutation: forged
      }),
      denialSink: denialSink(),
      coordinator,
      authorizationGate: allowGate()
    });

    await expect(service.execute(fixture.command)).rejects.toThrow(
      "permission.denied"
    );
    expect(
      coordinator.withAuthorizedMessageReactionMutation
    ).not.toHaveBeenCalled();
  });

  it("rejects stale authorization resource revisions before the coordinator", async () => {
    const fixture = selectedFixture("set", false);
    const plan = fixture.prepared.authorizationPlan;
    const coordinator = coordinatorThatMustNotRun();
    const service = createInboxV2MessageReactionCommandService({
      requestScope,
      preparer: preparerReturning({
        ...fixture.prepared,
        authorizationPlan: {
          ...plan,
          requirements: plan.requirements.map((requirement, index) =>
            index === 0
              ? { ...requirement, resourceAccessRevision: "999" }
              : requirement
          )
        } as InboxV2AuthorizationPlanInput
      }),
      denialSink: denialSink(),
      coordinator,
      authorizationGate: allowGate()
    });

    await expect(service.execute(fixture.command)).rejects.toThrow(
      "permission.denied"
    );
    expect(
      coordinator.withAuthorizedMessageReactionMutation
    ).not.toHaveBeenCalled();
  });

  it("rejects an authorization plan that duplicates react and omits Conversation read", async () => {
    const fixture = selectedFixture("set", false);
    const plan = fixture.prepared.authorizationPlan;
    const reactRequirement = plan.requirements.find(
      ({ permissionId }) => permissionId === "core:message.react"
    );
    if (reactRequirement === undefined) {
      throw new Error("reaction authorization requirement fixture");
    }
    const coordinator = coordinatorThatMustNotRun();
    const service = createInboxV2MessageReactionCommandService({
      requestScope,
      preparer: preparerReturning({
        ...fixture.prepared,
        authorizationPlan: {
          ...plan,
          requirements: plan.requirements.map((requirement) =>
            requirement.permissionId === "core:conversation.internal.read"
              ? {
                  ...reactRequirement,
                  id: requirement.id
                }
              : requirement
          )
        } as InboxV2AuthorizationPlanInput
      }),
      denialSink: denialSink(),
      coordinator,
      authorizationGate: allowGate()
    });

    await expect(service.execute(fixture.command)).rejects.toThrow(
      "permission.denied"
    );
    expect(
      coordinator.withAuthorizedMessageReactionMutation
    ).not.toHaveBeenCalled();
  });

  it("returns a stable denial without invoking the atomic coordinator", async () => {
    const fixture = selectedFixture("set", false);
    const coordinator = coordinatorThatMustNotRun();
    const service = createInboxV2MessageReactionCommandService({
      requestScope,
      preparer: preparerReturning(fixture.prepared),
      denialSink: denialSink(),
      coordinator,
      authorizationGate: denyGate("permission.denied")
    });

    await expect(service.execute(fixture.command)).resolves.toEqual({
      outcome: "denied",
      errorCode: "permission.denied"
    });
    expect(
      coordinator.withAuthorizedMessageReactionMutation
    ).not.toHaveBeenCalled();
  });

  it.each([
    ["idempotency_conflict", "idempotency_conflict"],
    ["revision_conflict", "revision_conflict"],
    ["resource_not_found", "revision_conflict"],
    ["authorization_epoch_conflict", "authorization_conflict"]
  ] as const)(
    "maps coordinator %s without inventing a provider outcome",
    async (kind, outcome) => {
      const fixture = selectedFixture("set", false);
      const coordinator: InboxV2MessageReactionAtomicCoordinator = {
        withAuthorizedMessageReactionMutation: vi.fn(async () => ({
          kind
        })) as InboxV2MessageReactionAtomicCoordinator["withAuthorizedMessageReactionMutation"]
      };
      const service = serviceFor(fixture, coordinator);

      await expect(service.execute(fixture.command)).resolves.toMatchObject({
        outcome
      });
    }
  );

  it.each([
    ["reactionId", "message_reaction:forged"],
    ["reactionRevision", "999"],
    ["transitionId", "message_reaction_transition:forged"]
  ] as const)(
    "rejects an applied coordinator result with a forged %s",
    async (field, value) => {
      const fixture = selectedFixture("set", false);
      const coordinator: InboxV2MessageReactionAtomicCoordinator = {
        withAuthorizedMessageReactionMutation: vi.fn(async () => ({
          kind: "applied" as const,
          result: {
            reactionId: fixture.commit.afterReaction.id,
            reactionRevision: fixture.commit.afterReaction.revision,
            transitionId: fixture.commit.transition.id,
            [field]: value
          },
          status: appliedStatus(fixture),
          revisionEffects: []
        }))
      };
      const service = serviceFor(fixture, coordinator);

      await expect(service.execute(fixture.command)).rejects.toEqual(
        expect.objectContaining({ code: "permission.denied" })
      );
    }
  );

  it("rejects an applied coordinator status with a forged transition reference", async () => {
    const fixture = selectedFixture("set", false);
    const status = appliedStatus(fixture);
    const coordinator: InboxV2MessageReactionAtomicCoordinator = {
      withAuthorizedMessageReactionMutation: vi.fn(async () => ({
        kind: "applied" as const,
        result: {
          reactionId: fixture.commit.afterReaction.id,
          reactionRevision: fixture.commit.afterReaction.revision,
          transitionId: fixture.commit.transition.id
        },
        status: {
          ...status,
          resultReference: {
            ...status.resultReference!,
            digest: calculateInboxV2CanonicalSha256({
              forged: "applied-status"
            })
          }
        },
        revisionEffects: []
      }))
    };

    await expect(
      serviceFor(fixture, coordinator).execute(fixture.command)
    ).rejects.toEqual(expect.objectContaining({ code: "permission.denied" }));
  });

  it("accepts an atomic concurrent replay using its persisted transition reference", async () => {
    const fixture = selectedFixture("clear", false);
    const status = exactReplayStatus(fixture);
    const concurrentTransitionId =
      "message_reaction_transition:concurrent-transition";
    const coordinator: InboxV2MessageReactionAtomicCoordinator = {
      withAuthorizedMessageReactionMutation: vi.fn(async () => ({
        kind: "already_applied" as const,
        status: {
          ...status,
          resultReference: {
            ...status.resultReference!,
            recordId: inboxV2PayloadRecordIdSchema.parse(
              concurrentTransitionId
            ),
            digest: calculateInboxV2CanonicalSha256({
              fixture: "concurrent-reaction-transition"
            })
          }
        }
      }))
    };
    const service = serviceFor(fixture, coordinator);

    await expect(service.execute(fixture.command)).resolves.toMatchObject({
      outcome: "already_applied",
      action: "clear",
      transitionId: concurrentTransitionId
    });
  });

  it("rejects cross-tenant public commands before any repository read", async () => {
    const fixture = selectedFixture("set", false);
    const preparer = preparerReturning(fixture.prepared);
    const service = createInboxV2MessageReactionCommandService({
      requestScope,
      preparer,
      denialSink: denialSink(),
      coordinator: coordinatorThatMustNotRun()
    });

    await expect(
      service.execute({
        ...fixture.command,
        tenantId: "tenant:other"
      })
    ).rejects.toEqual(expect.objectContaining({ code: "permission.denied" }));
    expect(preparer.lookupIdempotency).not.toHaveBeenCalled();
    expect(preparer.prepareNew).not.toHaveBeenCalled();
  });

  it("rejects a request scope whose Employee belongs to another tenant", () => {
    const fixture = selectedFixture("set", false);
    expect(() =>
      createInboxV2MessageReactionCommandService({
        requestScope: {
          ...requestScope,
          principal: inboxV2OutboundRoutePrincipalSchema.parse({
            kind: "employee",
            employee: {
              ...fixtureEmployeeReference,
              tenantId: "tenant:other"
            }
          })
        },
        preparer: preparerReturning(fixture.prepared),
        denialSink: denialSink(),
        coordinator: coordinatorThatMustNotRun()
      })
    ).toThrow("permission.denied");
  });
});

type SelectedFixture = Readonly<{
  command: InboxV2MessageReactionCommand;
  commit: ReactionCommit;
  prepared: Extract<
    InboxV2PreparedMessageReactionCommand,
    { kind: "selected" }
  >;
}>;

function selectedFixture(
  kind: "set" | "replace" | "clear",
  external: boolean
): SelectedFixture {
  if (kind === "replace" && !external) {
    throw new Error("replace requires a pinned single-value provider slot");
  }
  const commit =
    kind === "set"
      ? internalSetCommit()
      : kind === "replace"
        ? externalReplaceCommit()
        : internalClearCommit();
  const command = commandFor(kind, commit);
  const intent = intentFor(command, commit, external);
  const requestHash = calculateInboxV2MessageReactionIntentDigest(command);
  const authorizedCommand = authorizedCommandFor(command, intent, requestHash);
  const authorizedMutation = authorizedMutationFor(
    command,
    authorizedCommand,
    requestHash,
    commit
  );
  return {
    command,
    commit,
    prepared: {
      kind: "selected",
      authorizationPlan: authorizationPlanFor(authorizedCommand, commit),
      denialContext: {} as InboxV2SecurityDenialContext,
      authorizedCommand,
      authorizedMutation,
      reactionCommit: commit
    }
  };
}

function commandFor(
  kind: "set" | "replace" | "clear",
  commit: ReactionCommit
): InboxV2MessageReactionCommand {
  const base = {
    tenantId: fixtureTenantId,
    conversationId: fixtureConversationReference.id,
    messageId: fixtureMessageReference.id,
    clientMutationId: `client-mutation:reaction-${kind}-1`
  } as const;
  if (kind === "set") {
    return {
      ...base,
      kind,
      expectedMessageRevision: commit.beforeMessage.revision,
      value: reactionValue(commit.afterReaction)
    };
  }
  return kind === "replace"
    ? {
        ...base,
        kind,
        reactionId,
        expectedReactionRevision: commit.beforeReaction!.revision,
        value: reactionValue(commit.afterReaction)
      }
    : {
        ...base,
        kind,
        reactionId,
        expectedReactionRevision: commit.beforeReaction!.revision
      };
}

function intentFor(
  command: InboxV2MessageReactionCommand,
  commit: ReactionCommit,
  external: boolean
): ReactionIntent {
  const proof = {
    conversation: fixtureConversationReference,
    message: fixtureMessageReference,
    timelineItem: fixtureTimelineItemReference,
    expectedMessageRevision: commit.beforeMessage.revision,
    expectedTimelineItemRevision: commit.beforeTimelineItem.revision,
    ownerParticipant: employeeParticipant
  };
  const target = external
    ? externalTarget(commit)
    : ({ kind: "internal" } as const);
  const common = {
    tenantId: fixtureTenantId,
    conversation: fixtureConversationReference,
    targetProof: proof,
    actionParticipant: employeeParticipant,
    appActor: fixtureEmployeeActor,
    target,
    occurredAt: fixtureT3
  } as const;
  if (command.kind === "set") {
    return inboxV2TimelineCommandIntentSchema.parse({
      ...common,
      kind: "reaction_set",
      message: fixtureMessageReference,
      expectedMessageRevision: command.expectedMessageRevision,
      value: command.value
    }) as ReactionIntent;
  }
  const mutationProof = {
    ...proof,
    reaction: fixtureReference("message_reaction", command.reactionId)
  };
  return inboxV2TimelineCommandIntentSchema.parse(
    command.kind === "replace"
      ? {
          ...common,
          kind: "reaction_replace",
          reaction: fixtureReference("message_reaction", command.reactionId),
          expectedReactionRevision: command.expectedReactionRevision,
          targetProof: mutationProof,
          value: command.value
        }
      : {
          ...common,
          kind: "reaction_clear",
          reaction: fixtureReference("message_reaction", command.reactionId),
          expectedReactionRevision: command.expectedReactionRevision,
          targetProof: mutationProof,
          value: null
        }
  ) as ReactionIntent;
}

function externalTarget(commit: ReactionCommit) {
  const evidence = commit.externalAuthorityEvidence;
  const route = evidence?.outboundRoute;
  if (
    evidence === null ||
    evidence === undefined ||
    route === null ||
    route === undefined
  ) {
    throw new Error("exact external reaction authority fixture");
  }
  return {
    kind: "external" as const,
    externalMessageReference: fixtureExternalMessageReference,
    sourceOccurrence: fixtureSourceOccurrenceReference,
    outboundRoute: fixtureRouteReference,
    routeAuthorization: {
      conversation: fixtureConversationReference,
      outboundRoute: fixtureRouteReference,
      routeRevision: route.revision,
      sourceAccount: route.sourceAccount,
      sourceThreadBinding: route.sourceThreadBinding,
      bindingFence: route.bindingFence
    }
  };
}

function authorizedCommandFor(
  command: InboxV2MessageReactionCommand,
  intent: ReactionIntent,
  requestHash: string
): InboxV2AuthorizedCommand {
  const decisions = authorizationDecisions(intent);
  return inboxV2AuthorizedCommandSchema.parse({
    tenantId: fixtureTenantId,
    commandId: `command:reaction-${command.kind}-1`,
    request: {
      tenantId: fixtureTenantId,
      requestId: `request:reaction-${command.kind}-1`,
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
  intent: ReactionIntent
): readonly InboxV2AuthorizationDecisionReference[] {
  const requirements = [
    {
      permissionId:
        intent.target.kind === "internal"
          ? "core:conversation.internal.read"
          : "core:conversation.read",
      resourceScopeId: "core:conversation",
      entityTypeId: "core:conversation",
      entityId: fixtureConversationReference.id,
      resourceAccessRevision: "1"
    },
    {
      permissionId: "core:message.react",
      resourceScopeId: "core:timeline-item",
      entityTypeId: "core:timeline-item",
      entityId: fixtureTimelineItemReference.id,
      resourceAccessRevision: intent.targetProof!.expectedTimelineItemRevision
    },
    ...(intent.target.kind === "external"
      ? [
          {
            permissionId: "core:source_account.use",
            resourceScopeId: "core:source-account",
            entityTypeId: "core:source-account",
            entityId: fixtureSourceAccountReference.id,
            resourceAccessRevision: "1"
          }
        ]
      : [])
  ];
  return requirements.map((requirement, index) =>
    inboxV2AuthorizationDecisionReferenceSchema.parse({
      tenantId: fixtureTenantId,
      id: `authorization-decision:reaction-${index + 1}`,
      authorizationEpoch: fixtureEmployeeActor.authorizationEpoch,
      principal: { kind: "employee", employee: fixtureEmployeeReference },
      permissionId: requirement.permissionId,
      resourceScopeId: requirement.resourceScopeId,
      resource: {
        tenantId: fixtureTenantId,
        entityTypeId: requirement.entityTypeId,
        entityId: requirement.entityId
      },
      resourceAccessRevision: requirement.resourceAccessRevision,
      decisionRevision: "1",
      decisionHash: hash(`reaction-decision-${index + 1}`),
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
      `${decision.resource.entityTypeId}\u0000${decision.resource.entityId}`,
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
      resourceDependencies: [...uniqueResources.values()].sort((left, right) =>
        String(left.resource.entityTypeId) < String(right.resource.entityTypeId)
          ? -1
          : 1
      ),
      temporalBoundaryDigest: hash("reaction-temporal-boundary")
    },
    evaluatedAt: fixtureT1,
    notAfter: fixtureT4,
    nextAuthorizationBoundary: null
  };
}

function authorizationPlanFor(
  authorized: InboxV2AuthorizedCommand,
  commit: ReactionCommit
): InboxV2AuthorizationPlanInput {
  const intent = authorized.intent.payload as ReactionIntent;
  const requirements = authorized.authorizationDecisionRefs.map(
    (decision, index) => ({
      id: `requirement:reaction-${index + 1}`,
      permissionId: decision.permissionId,
      resource: decision.resource,
      resourceAccessRevision: decision.resourceAccessRevision
    })
  );
  const sourceRequirement = requirements.find(
    ({ permissionId }) => permissionId === "core:source_account.use"
  );
  const authority = commit.transition.externalAuthority;
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
    requirements,
    reactionAuthority: {
      targetTimelineItem: intent.targetProof!.timelineItem,
      expectedTimelineItemRevision:
        intent.targetProof!.expectedTimelineItemRevision,
      originalRouteRequirementId: sourceRequirement?.id ?? null,
      sourceAccount: authority?.sourceAccount ?? null,
      sourceThreadBinding: authority?.sourceThreadBinding ?? null,
      externalMessageReference: authority?.externalMessageReference ?? null,
      sourceOccurrence: authority?.sourceOccurrence ?? null,
      bindingGeneration: authority?.bindingGeneration ?? null,
      capabilityFence: authority?.capabilityFence ?? null
    }
  } as unknown as InboxV2AuthorizationPlanInput;
}

function disclosurePlan(
  command: InboxV2MessageReactionCommand
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
        permissionId: "core:conversation.internal.read",
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
  command: InboxV2MessageReactionCommand,
  authorized: InboxV2AuthorizedCommand,
  requestHash: string,
  commit: ReactionCommit
): WithInboxV2AuthorizedCommandMutationInput {
  const transitionReference = {
    tenantId: fixtureTenantId,
    recordId: commit.transition.id,
    schemaId: INBOX_V2_MESSAGE_REACTION_TRANSITION_SCHEMA_ID,
    schemaVersion: INBOX_V2_MESSAGE_REACTION_SCHEMA_VERSION,
    digest: calculateInboxV2CanonicalSha256(commit.transition)
  };
  const primaryDecision = authorized.authorizationDecisionRefs.find(
    ({ permissionId }) => permissionId === "core:message.react"
  );
  if (primaryDecision === undefined) {
    throw new Error("reaction authorization decision fixture");
  }
  const provider = commit.transition.mode === "external_request";
  return {
    tenantId: fixtureTenantId,
    command: {
      id: `command:reaction-${command.kind}-1`,
      commandTypeId: `core:message.reaction.${command.kind}`,
      clientMutationId: command.clientMutationId,
      requestHash,
      actor: {
        kind: "employee",
        employeeId: fixtureEmployeeReference.id
      },
      authorizationEpoch: requestScope.authorizationEpoch,
      authorizationDecisionId: primaryDecision.id,
      authorizedAt: authorized.authorizedAt,
      publicResultCode: INBOX_V2_MESSAGE_REACTION_RESULT_CODE,
      resultReference: transitionReference,
      sensitiveResultReference: null
    },
    records: {
      changes: [
        {
          id: "change:message-reaction-transition-1",
          ordinal: 1,
          entity: {
            tenantId: fixtureTenantId,
            entityTypeId: "core:message-reaction-transition",
            entityId: commit.transition.id
          },
          resultingRevision: commit.transition.recordRevision,
          timeline: {
            conversation: commit.beforeMessage.conversation,
            timelineSequence: commit.beforeTimelineItem.timelineSequence
          },
          audience: commit.beforeTimelineItem.visibility,
          state: {
            kind: "upsert",
            stateSchemaId: INBOX_V2_MESSAGE_REACTION_TRANSITION_SCHEMA_ID,
            stateSchemaVersion: INBOX_V2_MESSAGE_REACTION_SCHEMA_VERSION,
            stateHash: transitionReference.digest,
            payloadReference: transitionReference,
            domainCommitReference: {
              tenantId: fixtureTenantId,
              recordId: commit.transition.id,
              schemaId: INBOX_V2_MESSAGE_REACTION_COMMIT_SCHEMA_ID,
              schemaVersion: INBOX_V2_MESSAGE_REACTION_SCHEMA_VERSION,
              digest: calculateInboxV2CanonicalSha256(commit)
            }
          }
        }
      ],
      events: [
        {
          id: "event:message-reaction-changed-1",
          typeId: "core:message.changed",
          payloadSchemaId: INBOX_V2_MESSAGE_REACTION_COMMIT_SCHEMA_ID,
          payloadSchemaVersion: INBOX_V2_MESSAGE_REACTION_SCHEMA_VERSION,
          changeIds: ["change:message-reaction-transition-1"],
          subjects: [
            {
              tenantId: fixtureTenantId,
              entityTypeId: "core:message",
              entityId: fixtureMessageReference.id
            }
          ],
          payloadReference: {
            tenantId: fixtureTenantId,
            recordId: commit.transition.id,
            schemaId: INBOX_V2_MESSAGE_REACTION_COMMIT_SCHEMA_ID,
            schemaVersion: INBOX_V2_MESSAGE_REACTION_SCHEMA_VERSION,
            digest: calculateInboxV2CanonicalSha256(commit)
          },
          authorizationDecisionRefs: authorized.authorizationDecisionRefs,
          occurredAt: commit.transition.occurredAt,
          recordedAt: commit.transition.recordedAt
        }
      ],
      outboxIntents: [
        {
          id: "outbox:message-reaction-projection-1",
          ordinal: 1,
          typeId: "core:projection.update",
          effectClass: "projection",
          idempotencyKey: `reaction-projection:${commit.transition.id}`,
          payloadReference: transitionReference,
          eventId: "event:message-reaction-changed-1",
          changeIds: ["change:message-reaction-transition-1"]
        },
        ...(provider
          ? [
              {
                id: "outbox:message-reaction-provider-1",
                ordinal: 2,
                typeId: "core:provider.message_reaction",
                effectClass: "provider_io" as const,
                idempotencyKey: `reaction-provider:${commit.transition.id}`,
                payloadReference: transitionReference,
                eventId: "event:message-reaction-changed-1",
                changeIds: ["change:message-reaction-transition-1"]
              }
            ]
          : [])
      ],
      audit: {
        actionId: `core:message.reaction.${command.kind}`,
        target: {
          ...deriveInboxV2MessageReactionAuditTargetReference({
            tenantId: fixtureTenantId,
            timelineItemId: commit.beforeTimelineItem.id
          })
        },
        authorizationDecisionRefs: authorized.authorizationDecisionRefs,
        permissionIds: [
          ...new Set(
            authorized.authorizationDecisionRefs.map(
              ({ permissionId }) => permissionId
            )
          )
        ].sort(),
        resourceScopeIds: [
          ...new Set(
            authorized.authorizationDecisionRefs.map(
              ({ resourceScopeId }) => resourceScopeId
            )
          )
        ].sort()
      }
    }
  } as unknown as WithInboxV2AuthorizedCommandMutationInput;
}

function internalSetCommit(): ReactionCommit {
  const beforeMessage = fixtureMessage("internal", fixtureContent(), {
    revision: "1"
  });
  const beforeTimelineItem = fixtureTimelineItem("internal", {
    subject: {
      kind: "message",
      message: fixtureMessageReference,
      messageRevision: "1"
    },
    revision: "1"
  });
  const afterReaction = reaction({
    createdAt: fixtureT3,
    updatedAt: fixtureT3
  });
  return inboxV2MessageReactionCommitSchema.parse({
    tenantId: fixtureTenantId,
    beforeMessage,
    beforeTimelineItem,
    beforeReaction: null,
    transition: transition({
      semanticSlotKey: afterReaction.semanticSlotKey,
      mode: "internal_apply",
      operation: "set",
      expectedRevision: null,
      resultingRevision: "1",
      beforeState: null,
      afterState: afterReaction.state,
      externalAuthority: null
    }),
    afterReaction,
    participantSnapshots: [fixtureParticipant("employee")],
    externalAuthorityEvidence: null,
    outboundBindingSnapshot: null,
    routeConsumption: null,
    providerObservation: null,
    providerResultProof: null,
    slotHeadBefore: null,
    slotHeadAfter: slotHead(afterReaction)
  });
}

function internalClearCommit(): ReactionCommit {
  const beforeReaction = reaction();
  if (beforeReaction.state.kind !== "active") {
    throw new Error("active internal reaction fixture");
  }
  const afterReaction = reaction({
    state: {
      kind: "cleared",
      lastValue: beforeReaction.state.value,
      clearedAt: fixtureT3
    },
    revision: "2",
    updatedAt: fixtureT3
  });
  return internalMutationCommit("clear", beforeReaction, afterReaction);
}

function internalMutationCommit(
  operation: "clear",
  beforeReaction: ReturnType<typeof reaction>,
  afterReaction: ReturnType<typeof reaction>
): ReactionCommit {
  const beforeMessage = fixtureMessage("internal", fixtureContent(), {
    revision: "2"
  });
  const beforeTimelineItem = fixtureTimelineItem("internal", {
    subject: {
      kind: "message",
      message: fixtureMessageReference,
      messageRevision: "2"
    },
    revision: "2"
  });
  return inboxV2MessageReactionCommitSchema.parse({
    tenantId: fixtureTenantId,
    beforeMessage,
    beforeTimelineItem,
    beforeReaction,
    transition: transition({
      semanticSlotKey: afterReaction.semanticSlotKey,
      mode: "internal_apply",
      operation,
      expectedRevision: "1",
      resultingRevision: "2",
      beforeState: beforeReaction.state,
      afterState: afterReaction.state,
      externalAuthority: null
    }),
    afterReaction,
    participantSnapshots: [fixtureParticipant("employee")],
    externalAuthorityEvidence: null,
    outboundBindingSnapshot: null,
    routeConsumption: null,
    providerObservation: null,
    providerResultProof: null,
    slotHeadBefore: slotHead(beforeReaction),
    slotHeadAfter: slotHead(afterReaction)
  });
}

function externalReplaceCommit(): ReactionCommit {
  const capability = externalCapability();
  const beforeReaction = reaction({}, capability);
  if (beforeReaction.state.kind !== "active") {
    throw new Error("active external reaction fixture");
  }
  const route = fixtureExternalTargetRoute(
    "core:message.reaction.replace",
    "core:message.reaction.replace_external"
  );
  const requestAttribution = actionAttribution();
  const pendingState = {
    kind: "pending_external" as const,
    operation: "replace" as const,
    desired: { kind: "active" as const, value: unicode("🔥") },
    confirmedBefore: beforeReaction.state,
    outboundRoute: fixtureRouteReference,
    requestTransition: fixtureReference(
      "message_reaction_transition",
      transitionId
    ),
    requestAttribution,
    requestedAt: fixtureT3
  };
  const afterReaction = {
    ...beforeReaction,
    state: pendingState,
    revision: "2",
    updatedAt: fixtureT3
  };
  const occurrence = fixtureOccurrence();
  const externalAuthority = {
    externalMessageReference: fixtureExternalMessageReference,
    sourceOccurrence: fixtureSourceOccurrenceReference,
    sourceAccount: fixtureSourceAccountReference,
    sourceThreadBinding: fixtureBindingReference,
    bindingGeneration: occurrence.bindingContext.bindingGeneration,
    outboundRoute: fixtureRouteReference,
    adapterContract: fixtureAdapterContract,
    capabilityFence: {
      capabilityId: capability.capabilityId,
      capabilityRevision: capability.capabilityRevision,
      adapterContract: fixtureAdapterContract,
      decision: "supported" as const,
      evaluatedAt: fixtureT1,
      notAfter: fixtureT4
    }
  };
  const beforeMessage = fixtureMessage("source", fixtureContent(), {
    authorParticipant: employeeParticipant,
    revision: "2"
  });
  const beforeTimelineItem = fixtureTimelineItem("external", {
    subject: {
      kind: "message",
      message: fixtureMessageReference,
      messageRevision: "2"
    },
    revision: "2"
  });
  return inboxV2MessageReactionCommitSchema.parse({
    tenantId: fixtureTenantId,
    beforeMessage,
    beforeTimelineItem,
    beforeReaction,
    transition: transition({
      semanticSlotKey: afterReaction.semanticSlotKey,
      mode: "external_request",
      operation: "replace",
      expectedRevision: "1",
      resultingRevision: "2",
      beforeState: beforeReaction.state,
      afterState: pendingState,
      externalAuthority
    }),
    afterReaction,
    participantSnapshots: [fixtureParticipant("employee")],
    externalAuthorityEvidence: {
      externalMessageReference: fixtureExternalReference(occurrence),
      sourceOccurrence: occurrence,
      outboundRoute: route
    },
    outboundBindingSnapshot: fixtureOutboundBindingSnapshot(
      route,
      capability.capabilityId
    ),
    routeConsumption: {
      tenantId: fixtureTenantId,
      outboundRoute: fixtureRouteReference,
      transition: fixtureReference("message_reaction_transition", transitionId),
      reaction: fixtureReference("message_reaction", reactionId),
      semanticSlotKey: afterReaction.semanticSlotKey,
      mutationToken: route.mutationToken,
      idempotencyToken: route.idempotencyToken,
      correlationToken: route.correlationToken,
      consumedByTrustedServiceId:
        route.adapterContract.loadedByTrustedServiceId,
      consumedAt: fixtureT3,
      revision: "1"
    },
    providerObservation: null,
    providerResultProof: null,
    slotHeadBefore: slotHead(beforeReaction),
    slotHeadAfter: slotHead(afterReaction)
  });
}

function unicode(value = "👍") {
  return { kind: "unicode" as const, value };
}

function internalCapability() {
  return { kind: "internal" as const, cardinality: "multiple_values" as const };
}

function externalCapability() {
  return {
    kind: "external" as const,
    capabilityId: "module:synthetic:reactions",
    capabilityRevision: "4",
    cardinality: "single_value" as const,
    adapterContract: fixtureAdapterContract
  };
}

function actionAttribution() {
  return {
    actionParticipant: employeeParticipant,
    appActor: fixtureEmployeeActor,
    sourceOccurrence: null,
    automationCausation: null
  };
}

function reaction(
  overrides: Record<string, unknown> = {},
  capability:
    | ReturnType<typeof internalCapability>
    | ReturnType<typeof externalCapability> = internalCapability()
) {
  const candidate = {
    tenantId: fixtureTenantId,
    id: reactionId,
    message: fixtureMessageReference,
    actor: { kind: "participant" as const, participant: employeeParticipant },
    capability,
    state: { kind: "active" as const, value: unicode() },
    revision: "1",
    createdAt: fixtureT1,
    updatedAt: fixtureT1,
    ...overrides
  };
  return {
    ...candidate,
    semanticSlotKey:
      typeof overrides.semanticSlotKey === "string"
        ? overrides.semanticSlotKey
        : inboxV2ReactionSemanticSlotKeyFor(candidate)
  };
}

function slotHead(value: {
  id: string;
  semanticSlotKey: string;
  state: unknown;
  revision: string;
  updatedAt: string;
}) {
  return {
    tenantId: fixtureTenantId,
    message: fixtureMessageReference,
    semanticSlotKey: value.semanticSlotKey,
    reaction: fixtureReference("message_reaction", value.id),
    state: value.state,
    revision: value.revision,
    updatedAt: value.updatedAt
  };
}

function transition(input: {
  semanticSlotKey: string;
  mode: "internal_apply" | "external_request";
  operation: "set" | "replace" | "clear";
  expectedRevision: string | null;
  resultingRevision: string;
  beforeState: unknown;
  afterState: unknown;
  externalAuthority: unknown;
}) {
  return {
    tenantId: fixtureTenantId,
    id: transitionId,
    reaction: fixtureReference("message_reaction", reactionId),
    semanticSlotKey: input.semanticSlotKey,
    mode: input.mode,
    operation: input.operation,
    expectedRevision: input.expectedRevision,
    resultingRevision: input.resultingRevision,
    beforeState: input.beforeState,
    afterState: input.afterState,
    actionAttribution: actionAttribution(),
    externalAuthority: input.externalAuthority,
    occurredAt: fixtureT3,
    recordedAt: fixtureT3,
    recordRevision: "1"
  };
}

function reactionValue(reactionValue: InboxV2MessageReaction) {
  const state = reactionValue.state;
  if (state.kind === "active") return state.value;
  if (state.kind === "cleared") return state.lastValue;
  return state.desired.kind === "active"
    ? state.desired.value
    : state.desired.lastValue;
}

function serviceFor(
  fixture: SelectedFixture,
  coordinator: InboxV2MessageReactionAtomicCoordinator
) {
  return createInboxV2MessageReactionCommandService({
    requestScope,
    preparer: preparerReturning(fixture.prepared),
    denialSink: denialSink(),
    coordinator,
    authorizationGate: allowGate()
  });
}

function preparerReturning(
  prepared: Extract<InboxV2PreparedMessageReactionCommand, { kind: "selected" }>
): InboxV2MessageReactionCommandPreparer {
  return {
    lookupIdempotency: vi.fn(async () => null),
    prepareNew: vi.fn(async () => prepared)
  };
}

function coordinatorThatMustNotRun(): InboxV2MessageReactionAtomicCoordinator {
  return { withAuthorizedMessageReactionMutation: vi.fn() };
}

function appliedCoordinator(
  fixture: SelectedFixture
): InboxV2MessageReactionAtomicCoordinator {
  return {
    withAuthorizedMessageReactionMutation: vi.fn(async () => ({
      kind: "applied" as const,
      result: {
        reactionId: fixture.commit.afterReaction.id,
        reactionRevision: fixture.commit.afterReaction.revision,
        transitionId: fixture.commit.transition.id
      },
      status: appliedStatus(fixture),
      revisionEffects: []
    }))
  };
}

function appliedStatus(
  fixture: SelectedFixture
): InboxV2PrivilegedAuthorizationMutationAppliedStatus {
  return {
    ...exactReplayStatus(fixture),
    sensitiveResultReference: null
  };
}

function exactReplayStatus(
  fixture: SelectedFixture
): InboxV2PrivilegedAuthorizationMutationReplayStatus {
  return {
    ...replayStatus(fixture.command),
    resultReference: fixture.prepared.authorizedMutation.command.resultReference
  } as InboxV2PrivilegedAuthorizationMutationReplayStatus;
}

function replayStatus(
  command: InboxV2MessageReactionCommand
): InboxV2PrivilegedAuthorizationMutationReplayStatus {
  return {
    commandId: `command:reaction-${command.kind}-1`,
    mutationId: `authorization-mutation:reaction-${command.kind}-1`,
    publicResultCode: INBOX_V2_MESSAGE_REACTION_RESULT_CODE,
    resultReference: {
      tenantId: fixtureTenantId,
      recordId: transitionId,
      schemaId: INBOX_V2_MESSAGE_REACTION_TRANSITION_SCHEMA_ID,
      schemaVersion: INBOX_V2_MESSAGE_REACTION_SCHEMA_VERSION,
      digest: hash(`reaction-result-${command.kind}`)
    },
    streamCommitId: `commit:reaction-${command.kind}-1`,
    streamEpoch: "stream:reaction-1",
    streamPosition: "1",
    committedAt: fixtureT3
  } as unknown as InboxV2PrivilegedAuthorizationMutationReplayStatus;
}

function idempotencyScope(
  command: InboxV2MessageReactionCommand
): InboxV2MessageReactionIdempotencyScope {
  return {
    tenantId: command.tenantId,
    principal: requestScope.principal,
    authorizationEpoch: requestScope.authorizationEpoch,
    commandTypeId: `core:message.reaction.${command.kind}`,
    clientMutationId: command.clientMutationId,
    publicResultCode: INBOX_V2_MESSAGE_REACTION_RESULT_CODE
  };
}

function allowGate(): NonNullable<
  InboxV2MessageReactionCommandServiceOptions["authorizationGate"]
> {
  return (async (input: { executeAllowed: () => Promise<unknown> }) => ({
    outcome: "allowed" as const,
    publicDecision: { outcome: "allowed" as const, notAfter: fixtureT4 },
    value: await input.executeAllowed()
  })) as NonNullable<
    InboxV2MessageReactionCommandServiceOptions["authorizationGate"]
  >;
}

function denyGate(
  errorCode: "permission.denied" | "resource.not_found"
): NonNullable<
  InboxV2MessageReactionCommandServiceOptions["authorizationGate"]
> {
  return (async () => ({
    outcome: "denied" as const,
    publicDecision: { outcome: "denied" as const, errorCode }
  })) as NonNullable<
    InboxV2MessageReactionCommandServiceOptions["authorizationGate"]
  >;
}

function denialSink(): InboxV2SecurityDenialSink {
  return { record: vi.fn() } as unknown as InboxV2SecurityDenialSink;
}

function hash(value: string): string {
  return calculateInboxV2CanonicalSha256(value);
}
