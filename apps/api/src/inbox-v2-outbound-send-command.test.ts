import {
  INBOX_V2_MESSAGE_SCHEMA_ID,
  INBOX_V2_MESSAGE_SCHEMA_VERSION,
  INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_ID,
  INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_VERSION,
  INBOX_V2_OUTBOUND_DISPATCH_REROUTE_COMMIT_SCHEMA_ID,
  INBOX_V2_OUTBOUND_DISPATCH_REROUTE_COMMIT_SCHEMA_VERSION,
  calculateInboxV2CanonicalSha256,
  inboxV2AuthorizationDecisionReferenceSchema,
  inboxV2AuthorizedCommandSchema,
  inboxV2MessageCreationCommitSchema,
  inboxV2OutboundDispatchRerouteCommitSchema,
  inboxV2OutboundDispatchSchema,
  inboxV2OutboundRoutePrincipalSchema,
  inboxV2OutboundRouteResolutionCommitSchema,
  inboxV2OutboundRouteResolutionInputSchema,
  inboxV2TenantIdSchema,
  inboxV2TimelineContentDraftSchema,
  materializeInboxV2OutboundRouteResolutionCommit,
  type InboxV2AuthorizationDecisionReference,
  type InboxV2OutboundDispatch,
  type InboxV2OutboundDispatchRerouteCommit,
  type InboxV2OutboundRoute,
  type InboxV2OutboundRouteResolutionInput
} from "@hulee/contracts";
import type {
  InboxV2AuthorizationPlanInput,
  InboxV2SecurityDenialContext,
  InboxV2SecurityDenialSink
} from "@hulee/core";
import type {
  InboxV2AuthorizedAtomicMaterializationCoordinator,
  InboxV2PrivilegedAuthorizationMutationAppliedStatus,
  WithInboxV2AuthorizedCommandMutationInput
} from "@hulee/db";
import { describe, expect, it, vi } from "vitest";

import {
  fixtureBindingReference,
  fixtureConversationReference,
  fixtureEmployeeReference,
  fixtureHuleeCreationCommit,
  fixtureRouteReference,
  fixtureSourceAccountReference,
  fixtureT0,
  fixtureT1,
  fixtureT2,
  fixtureT4,
  fixtureTenantId
} from "../../../packages/contracts/src/inbox-v2/timeline-message-fixtures.type-fixture";
import {
  calculateInboxV2OutboundRouteIdempotencyToken,
  calculateInboxV2OutboundSendIntentDigest,
  createInboxV2OutboundSendCommandService,
  type InboxV2OutboundSendCommand,
  type InboxV2OutboundSendCommandPreparer,
  type InboxV2OutboundSendCommandServiceOptions,
  type InboxV2OutboundSendIdempotencyScope,
  type InboxV2OutboundSendRequestScope,
  type InboxV2PreparedOutboundSendCommand
} from "./inbox-v2-outbound-send-command";

const hash = (seed: string) =>
  calculateInboxV2CanonicalSha256({ test: "outbound-send", seed });

const compareCanonicalStrings = (left: string, right: string) =>
  left === right ? 0 : left < right ? -1 : 1;

const requestScope = {
  tenantId: fixtureTenantId,
  principal: inboxV2OutboundRoutePrincipalSchema.parse({
    kind: "employee",
    employee: fixtureEmployeeReference
  })
} satisfies InboxV2OutboundSendRequestScope;

function preparerReturning(
  prepared: InboxV2PreparedOutboundSendCommand | null
): InboxV2OutboundSendCommandPreparer {
  const isIdempotencyResult =
    prepared?.kind === "committed_replay" ||
    prepared?.kind === "idempotency_conflict";
  return {
    lookupIdempotency: vi
      .fn()
      .mockResolvedValue(isIdempotencyResult ? prepared : null),
    prepareNew: vi
      .fn()
      .mockResolvedValue(
        prepared !== null && !isIdempotencyResult ? prepared : null
      )
  };
}

describe("Inbox V2 outbound send command", () => {
  it("rejects a cross-tenant command before preparation or materialization", async () => {
    const fixture = selectedFixture();
    const preparer = preparerReturning(null);
    const coordinator = coordinatorThatMustNotRun();
    const service = createInboxV2OutboundSendCommandService({
      requestScope,
      preparer,
      denialSink: denialSink(),
      coordinator,
      authorizationGate: allowGate()
    });

    await expect(
      service.send({ ...fixture.command, tenantId: "tenant:other" })
    ).rejects.toThrow("permission.denied");
    expect(preparer.lookupIdempotency).not.toHaveBeenCalled();
    expect(preparer.prepareNew).not.toHaveBeenCalled();
    expect(
      coordinator.withAuthorizedAtomicMaterialization
    ).not.toHaveBeenCalled();
  });

  it("seals one pinned route, Message and queued dispatch without provider I/O", async () => {
    const fixture = selectedFixture();
    const calls: string[] = [];
    const persistence = persistenceFixture(fixture, calls);
    const coordinator = appliedCoordinator(fixture, calls);
    const preparer: InboxV2OutboundSendCommandPreparer = {
      lookupIdempotency: vi.fn(async () => {
        calls.push("idempotency.lookup");
        return null;
      }),
      prepareNew: vi.fn(async () => {
        calls.push("route.prepare");
        return fixture.prepared.kind === "selected" ? fixture.prepared : null;
      })
    };
    const service = createInboxV2OutboundSendCommandService({
      requestScope,
      preparer,
      denialSink: denialSink(),
      coordinator,
      persistence,
      authorizationGate: allowGate()
    });

    await expect(service.send(fixture.command)).resolves.toMatchObject({
      outcome: "queued",
      messageId: fixture.messageCreation.message.id,
      outboundRouteId: fixture.route.id,
      outboundDispatchId: fixture.dispatch.id
    });
    expect(calls).toEqual([
      "idempotency.lookup",
      "route.prepare",
      "coordinator",
      "reply-authority",
      "route",
      "message.prepare",
      "message.seal"
    ]);
    expect(persistence.persistRoute).toHaveBeenCalledTimes(1);
    expect(persistence.fenceReplyAuthority).toHaveBeenCalledTimes(1);
    expect(persistence.prepareMessage).toHaveBeenCalledTimes(1);
    expect(persistence.sealMessage).toHaveBeenCalledTimes(1);
  });

  it("passes the production authorization gate for a closed normal send", async () => {
    const fixture = selectedFixture();
    const service = createInboxV2OutboundSendCommandService({
      requestScope,
      preparer: preparerReturning(fixture.prepared),
      denialSink: denialSink(),
      coordinator: appliedCoordinator(fixture, []),
      persistence: persistenceFixture(fixture, [])
    });

    await expect(service.send(fixture.command)).resolves.toMatchObject({
      outcome: "queued",
      outboundRouteId: fixture.route.id,
      outboundDispatchId: fixture.dispatch.id
    });
  });

  it("passes the production authorization gate for the active primary WorkItem closure", async () => {
    const fixture = activePrimaryFixture();
    const service = createInboxV2OutboundSendCommandService({
      requestScope,
      preparer: preparerReturning(fixture.prepared),
      denialSink: denialSink(),
      coordinator: appliedCoordinator(fixture, []),
      persistence: persistenceFixture(fixture, [])
    });

    await expect(service.send(fixture.command)).resolves.toMatchObject({
      outcome: "queued",
      outboundRouteId: fixture.route.id,
      outboundDispatchId: fixture.dispatch.id
    });
  });

  it("allows an explicit reroute only with old/new SourceAccount and reroute authority", async () => {
    const fixture = rerouteFixture();
    const calls: string[] = [];
    const persistence = persistenceFixture(fixture, calls);
    const service = createInboxV2OutboundSendCommandService({
      requestScope,
      preparer: preparerReturning(fixture.prepared),
      denialSink: denialSink(),
      coordinator: appliedCoordinator(fixture, calls),
      persistence
    });

    await expect(service.send(fixture.command)).resolves.toMatchObject({
      outcome: "queued",
      outboundRouteId: fixture.route.id,
      outboundDispatchId: fixture.dispatch.id
    });
    expect(calls).toEqual([
      "coordinator",
      "reply-authority",
      "reroute",
      "message.prepare",
      "message.seal"
    ]);
    if (fixture.prepared.kind !== "selected") {
      throw new Error("reroute fixture must be selected");
    }
    expect(persistence.persistReroute).toHaveBeenCalledWith(expect.anything(), {
      routeResolution: fixture.prepared.routeResolution,
      rerouteCommit: fixture.prepared.rerouteCommit
    });
  });

  it("fails closed when an explicit reroute omits its cancellation commit", async () => {
    const fixture = rerouteFixture();
    if (fixture.prepared.kind !== "selected") {
      throw new Error("reroute fixture must be selected");
    }
    const coordinator = coordinatorThatMustNotRun();
    const service = createInboxV2OutboundSendCommandService({
      requestScope,
      preparer: preparerReturning({
        ...fixture.prepared,
        rerouteCommit: undefined
      }),
      denialSink: denialSink(),
      coordinator,
      authorizationGate: allowGate()
    });

    await expect(service.send(fixture.command)).rejects.toThrow(
      "permission.denied"
    );
    expect(
      coordinator.withAuthorizedAtomicMaterialization
    ).not.toHaveBeenCalled();
  });

  it.each([
    "reroute permission",
    "original route",
    "original dispatch",
    "dispatch revision",
    "new dispatch state",
    "audit reason"
  ])("fails closed when explicit reroute forges %s", async (field) => {
    const fixture = rerouteFixture();
    const selected = fixture.prepared;
    if (selected.kind !== "selected") throw new Error("selected fixture");
    const rerouteRequirement = selected.authorizationPlan.requirements.find(
      (requirement) =>
        requirement.permissionId === "core:source.dispatch.reroute"
    );
    if (
      rerouteRequirement?.guard.profileId !==
        "core:rbac.guard.source_account_route" ||
      rerouteRequirement.guard.operation.kind !== "reroute_dispatch"
    ) {
      throw new Error("reroute fixture");
    }
    const forged =
      field === "reroute permission"
        ? {
            ...selected,
            authorizationPlan: {
              ...selected.authorizationPlan,
              requirements: selected.authorizationPlan.requirements.filter(
                (requirement) =>
                  requirement.permissionId !== "core:source.dispatch.reroute"
              )
            },
            supplementalRerouteAuthorizationDecisionRefs:
              selected.supplementalRerouteAuthorizationDecisionRefs?.filter(
                (decision) =>
                  decision.permissionId !== "core:source.dispatch.reroute"
              )
          }
        : field === "original route"
          ? withForgedRerouteGuard(selected, {
              ...rerouteRequirement.guard.operation,
              originalRoute: {
                ...rerouteRequirement.guard.operation.originalRoute,
                resource: {
                  ...rerouteRequirement.guard.operation.originalRoute.resource,
                  entityId: "outbound_route:forged"
                }
              }
            })
          : field === "original dispatch"
            ? withForgedRerouteGuard(selected, {
                ...rerouteRequirement.guard.operation,
                dispatch: {
                  ...rerouteRequirement.guard.operation.dispatch,
                  resource: {
                    ...rerouteRequirement.guard.operation.dispatch.resource,
                    entityId: "outbound_dispatch:forged"
                  }
                }
              })
            : field === "dispatch revision"
              ? withForgedRerouteGuard(selected, {
                  ...rerouteRequirement.guard.operation,
                  dispatch: {
                    ...rerouteRequirement.guard.operation.dispatch,
                    expectedStateRevision: "2",
                    currentStateRevision: "2"
                  }
                })
              : field === "new dispatch state"
                ? withForgedRerouteGuard(selected, {
                    ...rerouteRequirement.guard.operation,
                    dispatch: {
                      ...rerouteRequirement.guard.operation.dispatch,
                      state: "provider_io_started"
                    },
                    dispatchState: "provider_io_started"
                  })
                : {
                    ...selected,
                    authorizedMutation: {
                      ...selected.authorizedMutation,
                      records: {
                        ...selected.authorizedMutation.records,
                        audit: {
                          ...selected.authorizedMutation.records.audit,
                          reasonCodeId: "core:forged-reroute"
                        }
                      }
                    }
                  };
    const coordinator = coordinatorThatMustNotRun();
    const service = createInboxV2OutboundSendCommandService({
      requestScope,
      preparer: preparerReturning(
        forged as unknown as InboxV2PreparedOutboundSendCommand
      ),
      denialSink: denialSink(),
      coordinator,
      authorizationGate: allowGate()
    });

    await expect(service.send(fixture.command)).rejects.toThrow(
      "permission.denied"
    );
    expect(
      coordinator.withAuthorizedAtomicMaterialization
    ).not.toHaveBeenCalled();
  });

  it("fails closed when a normal send supplies reroute-only authorization decisions", async () => {
    const fixture = selectedFixture();
    const selected = fixture.prepared;
    if (selected.kind !== "selected") throw new Error("selected fixture");
    const supplementalDecision =
      inboxV2AuthorizationDecisionReferenceSchema.parse({
        ...selected.authorizedCommand.authorizationDecisionRefs[0],
        id: "authorization-decision:forged-normal-supplement",
        decisionHash: hash("forged-normal-supplement")
      });
    const forged = {
      ...selected,
      supplementalRerouteAuthorizationDecisionRefs: [supplementalDecision]
    } as InboxV2PreparedOutboundSendCommand;
    const coordinator = coordinatorThatMustNotRun();
    const service = createInboxV2OutboundSendCommandService({
      requestScope,
      preparer: preparerReturning(forged),
      denialSink: denialSink(),
      coordinator,
      authorizationGate: allowGate()
    });

    await expect(service.send(fixture.command)).rejects.toThrow(
      "permission.denied"
    );
    expect(
      coordinator.withAuthorizedAtomicMaterialization
    ).not.toHaveBeenCalled();
  });

  it.each(["principal", "outcome"])(
    "fails closed when a supplemental reroute decision forges %s",
    async (field) => {
      const fixture = rerouteFixture();
      const selected = fixture.prepared;
      if (selected.kind !== "selected") throw new Error("selected fixture");
      const supplemental =
        selected.supplementalRerouteAuthorizationDecisionRefs;
      if (supplemental === undefined || supplemental[0] === undefined) {
        throw new Error("supplemental reroute fixture");
      }
      const forgedDecision = inboxV2AuthorizationDecisionReferenceSchema.parse({
        ...supplemental[0],
        ...(field === "principal"
          ? {
              principal: {
                kind: "employee",
                employee: {
                  tenantId: fixtureTenantId,
                  kind: "employee",
                  id: "employee:forged"
                }
              }
            }
          : { outcome: "denied" })
      });
      const forged = {
        ...selected,
        supplementalRerouteAuthorizationDecisionRefs: [
          forgedDecision,
          ...supplemental.slice(1)
        ]
      } as InboxV2PreparedOutboundSendCommand;
      const coordinator = coordinatorThatMustNotRun();
      const service = createInboxV2OutboundSendCommandService({
        requestScope,
        preparer: preparerReturning(forged),
        denialSink: denialSink(),
        coordinator,
        authorizationGate: allowGate()
      });

      await expect(service.send(fixture.command)).rejects.toThrow(
        "permission.denied"
      );
      expect(
        coordinator.withAuthorizedAtomicMaterialization
      ).not.toHaveBeenCalled();
    }
  );

  it("fails closed when reroute audit evidence targets another commit", async () => {
    const fixture = rerouteFixture();
    const selected = fixture.prepared;
    if (selected.kind !== "selected") throw new Error("selected fixture");
    const forged = {
      ...selected,
      authorizedMutation: {
        ...selected.authorizedMutation,
        records: {
          ...selected.authorizedMutation.records,
          audit: {
            ...selected.authorizedMutation.records.audit,
            evidenceReference: {
              ...selected.authorizedMutation.records.audit.evidenceReference!,
              digest: hash("forged-reroute-evidence")
            }
          }
        }
      }
    } as InboxV2PreparedOutboundSendCommand;
    const coordinator = coordinatorThatMustNotRun();
    const service = createInboxV2OutboundSendCommandService({
      requestScope,
      preparer: preparerReturning(forged),
      denialSink: denialSink(),
      coordinator,
      authorizationGate: allowGate()
    });

    await expect(service.send(fixture.command)).rejects.toThrow(
      "permission.denied"
    );
    expect(
      coordinator.withAuthorizedAtomicMaterialization
    ).not.toHaveBeenCalled();
  });

  it("fails closed when reroute audit overstates its permission set", async () => {
    const fixture = rerouteFixture();
    const selected = fixture.prepared;
    if (selected.kind !== "selected") throw new Error("selected fixture");
    const forged = {
      ...selected,
      authorizedMutation: {
        ...selected.authorizedMutation,
        records: {
          ...selected.authorizedMutation.records,
          audit: {
            ...selected.authorizedMutation.records.audit,
            matchedPermissionIds: [
              ...selected.authorizedMutation.records.audit.matchedPermissionIds,
              "core:tenant.manage"
            ].sort(compareCanonicalStrings)
          }
        }
      }
    } as InboxV2PreparedOutboundSendCommand;
    const coordinator = coordinatorThatMustNotRun();
    const service = createInboxV2OutboundSendCommandService({
      requestScope,
      preparer: preparerReturning(forged),
      denialSink: denialSink(),
      coordinator,
      authorizationGate: allowGate()
    });

    await expect(service.send(fixture.command)).rejects.toThrow(
      "permission.denied"
    );
    expect(
      coordinator.withAuthorizedAtomicMaterialization
    ).not.toHaveBeenCalled();
  });

  it("returns the committed Message identity on clientMutationId replay without rerunning materialization", async () => {
    const fixture = selectedFixture();
    const persistence = persistenceFixture(fixture, []);
    const coordinator = replayCoordinator(fixture);
    const service = createInboxV2OutboundSendCommandService({
      requestScope,
      preparer: preparerReturning(fixture.prepared),
      denialSink: denialSink(),
      coordinator,
      persistence,
      authorizationGate: allowGate()
    });

    await expect(service.send(fixture.command)).resolves.toMatchObject({
      outcome: "already_queued",
      messageId: fixture.messageCreation.message.id
    });
    expect(persistence.persistRoute).not.toHaveBeenCalled();
    expect(persistence.fenceReplyAuthority).not.toHaveBeenCalled();
    expect(persistence.prepareMessage).not.toHaveBeenCalled();
    expect(persistence.sealMessage).not.toHaveBeenCalled();
  });

  it("returns a committed replay before current route discovery can reject a drifted binding", async () => {
    const fixture = selectedFixture();
    const coordinator = coordinatorThatMustNotRun();
    const persistence = persistenceFixture(fixture, []);
    const preparer = preparerReturning({
      kind: "committed_replay",
      requestHash: calculateInboxV2OutboundSendIntentDigest(fixture.command),
      scope: idempotencyScopeFor(fixture.command),
      status: appliedStatus(fixture)
    } satisfies InboxV2PreparedOutboundSendCommand);
    const service = createInboxV2OutboundSendCommandService({
      requestScope,
      preparer,
      denialSink: denialSink(),
      coordinator,
      persistence,
      authorizationGate: allowGate()
    });

    await expect(service.send(fixture.command)).resolves.toMatchObject({
      outcome: "already_queued",
      messageId: fixture.messageCreation.message.id
    });
    expect(
      coordinator.withAuthorizedAtomicMaterialization
    ).not.toHaveBeenCalled();
    expect(persistence.persistRoute).not.toHaveBeenCalled();
    expect(persistence.fenceReplyAuthority).not.toHaveBeenCalled();
    expect(preparer.lookupIdempotency).toHaveBeenCalledTimes(1);
    expect(preparer.prepareNew).not.toHaveBeenCalled();
  });

  it("normalizes a schema-equivalent replay principal before scope comparison", async () => {
    const fixture = selectedFixture();
    const honestScope = idempotencyScopeFor(fixture.command);
    if (honestScope.principal.kind !== "employee") {
      throw new Error("employee replay fixture");
    }
    const preparer = preparerReturning({
      kind: "committed_replay",
      requestHash: calculateInboxV2OutboundSendIntentDigest(fixture.command),
      scope: {
        ...honestScope,
        principal: {
          employee: {
            id: honestScope.principal.employee.id,
            kind: "employee",
            tenantId: honestScope.principal.employee.tenantId
          },
          kind: "employee"
        } as InboxV2OutboundSendIdempotencyScope["principal"]
      },
      status: appliedStatus(fixture)
    });
    const service = createInboxV2OutboundSendCommandService({
      requestScope,
      preparer,
      denialSink: denialSink(),
      coordinator: coordinatorThatMustNotRun(),
      authorizationGate: allowGate()
    });

    await expect(service.send(fixture.command)).resolves.toMatchObject({
      outcome: "already_queued",
      messageId: fixture.messageCreation.message.id
    });
    expect(preparer.prepareNew).not.toHaveBeenCalled();
  });

  it("reports a stable idempotency conflict before route selection", async () => {
    const fixture = selectedFixture();
    const coordinator = coordinatorThatMustNotRun();
    const service = createInboxV2OutboundSendCommandService({
      requestScope,
      preparer: preparerReturning({
        kind: "idempotency_conflict",
        scope: idempotencyScopeFor(fixture.command)
      } satisfies InboxV2PreparedOutboundSendCommand),
      denialSink: denialSink(),
      coordinator,
      authorizationGate: allowGate()
    });

    await expect(service.send(fixture.command)).resolves.toEqual({
      outcome: "idempotency_conflict"
    });
    expect(
      coordinator.withAuthorizedAtomicMaterialization
    ).not.toHaveBeenCalled();
  });

  it.each([
    "authenticated principal",
    "command type",
    "client mutation ID",
    "public result code"
  ])("rejects an early replay outside the %s scope", async (label) => {
    const fixture = selectedFixture();
    const coordinator = coordinatorThatMustNotRun();
    const honestScope = idempotencyScopeFor(fixture.command);
    const scope =
      label === "authenticated principal"
        ? {
            ...honestScope,
            principal: inboxV2OutboundRoutePrincipalSchema.parse({
              kind: "employee",
              employee: {
                tenantId: fixtureTenantId,
                kind: "employee",
                id: "employee:other"
              }
            })
          }
        : label === "command type"
          ? { ...honestScope, commandTypeId: "core:message.edit" }
          : label === "client mutation ID"
            ? { ...honestScope, clientMutationId: "mutation:other" }
            : { ...honestScope, publicResultCode: "core:message.sent" };
    const service = createInboxV2OutboundSendCommandService({
      requestScope,
      preparer: preparerReturning({
        kind: "committed_replay",
        requestHash: calculateInboxV2OutboundSendIntentDigest(fixture.command),
        scope,
        status: appliedStatus(fixture)
      } as unknown as InboxV2PreparedOutboundSendCommand),
      denialSink: denialSink(),
      coordinator,
      authorizationGate: allowGate()
    });

    await expect(service.send(fixture.command)).rejects.toThrow(
      "permission.denied"
    );
    expect(
      coordinator.withAuthorizedAtomicMaterialization
    ).not.toHaveBeenCalled();
  });

  it("rejects a committed replay reference outside the command tenant", async () => {
    const fixture = selectedFixture();
    const status = appliedStatus(fixture);
    if (status.resultReference === null) {
      throw new Error("Replay fixture requires a Message reference.");
    }
    const coordinator = coordinatorThatMustNotRun();
    const service = createInboxV2OutboundSendCommandService({
      requestScope,
      preparer: preparerReturning({
        kind: "committed_replay",
        requestHash: calculateInboxV2OutboundSendIntentDigest(fixture.command),
        scope: idempotencyScopeFor(fixture.command),
        status: {
          ...status,
          resultReference: {
            ...status.resultReference,
            tenantId: inboxV2TenantIdSchema.parse("tenant:other")
          }
        }
      } satisfies InboxV2PreparedOutboundSendCommand),
      denialSink: denialSink(),
      coordinator,
      authorizationGate: allowGate()
    });

    await expect(service.send(fixture.command)).rejects.toThrow(
      "permission.denied"
    );
    expect(
      coordinator.withAuthorizedAtomicMaterialization
    ).not.toHaveBeenCalled();
  });

  it.each([
    ["zero", "automatic", "route.not_found"],
    ["multiple", "automatic", "route.ambiguous"],
    ["explicit_forbidden", "explicit_binding", "route.forbidden"]
  ] as const)(
    "fails stop on %s route resolution with no mutation or provider work",
    async (failureKind, intentKind, errorCode) => {
      const fixture = rejectedFixture(failureKind);
      const coordinator = coordinatorThatMustNotRun();
      const service = createInboxV2OutboundSendCommandService({
        requestScope,
        preparer: preparerReturning(fixture.prepared),
        denialSink: denialSink(),
        coordinator,
        authorizationGate: allowGate()
      });

      expect(fixture.command.routeIntent.kind).toBe(intentKind);
      await expect(service.send(fixture.command)).resolves.toEqual({
        outcome: "route_rejected",
        errorCode,
        retryable: false
      });
      expect(
        coordinator.withAuthorizedAtomicMaterialization
      ).not.toHaveBeenCalled();
    }
  );

  it("does not disclose route failure details without Conversation read", async () => {
    const fixture = rejectedFixture("explicit_forbidden");
    const authorizationGate = vi.fn(async () => ({
      outcome: "denied" as const,
      publicDecision: {
        outcome: "denied" as const,
        errorCode: "permission.denied"
      }
    })) as unknown as NonNullable<
      InboxV2OutboundSendCommandServiceOptions["authorizationGate"]
    >;
    const service = createInboxV2OutboundSendCommandService({
      requestScope,
      preparer: preparerReturning(fixture.prepared),
      denialSink: denialSink(),
      coordinator: coordinatorThatMustNotRun(),
      authorizationGate
    });

    await expect(service.send(fixture.command)).resolves.toEqual({
      outcome: "denied",
      errorCode: "permission.denied"
    });
  });

  it("rejects a selected route prepared with the raw client mutation ID", async () => {
    const fixture = selectedFixture();
    const selected = fixture.prepared;
    if (selected.kind !== "selected") throw new Error("selected fixture");
    expect(fixture.command.clientMutationId).not.toBe(
      fixture.route.idempotencyToken
    );
    const rawTokenRoute = {
      ...fixture.route,
      idempotencyToken: fixture.command.clientMutationId
    };
    const forged = {
      ...selected,
      routeResolution: inboxV2OutboundRouteResolutionCommitSchema.parse({
        ...selected.routeResolution,
        input: {
          ...selected.routeResolution.input,
          idempotencyToken: fixture.command.clientMutationId
        },
        route: rawTokenRoute
      }),
      messageCreation: inboxV2MessageCreationCommitSchema.parse({
        ...selected.messageCreation,
        outboundRoute: rawTokenRoute,
        routeConsumption:
          selected.messageCreation.routeConsumption === null
            ? null
            : {
                ...selected.messageCreation.routeConsumption,
                idempotencyToken: fixture.command.clientMutationId
              }
      })
    } satisfies InboxV2PreparedOutboundSendCommand;
    const coordinator = coordinatorThatMustNotRun();
    const authorizationGate = vi.fn(allowGate()) as unknown as NonNullable<
      InboxV2OutboundSendCommandServiceOptions["authorizationGate"]
    >;
    const service = createInboxV2OutboundSendCommandService({
      requestScope,
      preparer: preparerReturning(forged),
      denialSink: denialSink(),
      coordinator,
      authorizationGate
    });

    await expect(service.send(fixture.command)).rejects.toThrow(
      "permission.denied"
    );
    expect(authorizationGate).not.toHaveBeenCalled();
    expect(
      coordinator.withAuthorizedAtomicMaterialization
    ).not.toHaveBeenCalled();
  });

  it("rejects a failed route prepared with the raw client mutation ID before disclosure", async () => {
    const fixture = rejectedFixture("zero");
    const prepared = fixture.prepared;
    if (prepared.kind !== "route_rejected") {
      throw new Error("rejected fixture");
    }
    const forged = {
      ...prepared,
      routeResolution: inboxV2OutboundRouteResolutionCommitSchema.parse({
        ...prepared.routeResolution,
        input: {
          ...prepared.routeResolution.input,
          idempotencyToken: fixture.command.clientMutationId
        }
      })
    } satisfies InboxV2PreparedOutboundSendCommand;
    const authorizationGate = vi.fn(allowGate()) as unknown as NonNullable<
      InboxV2OutboundSendCommandServiceOptions["authorizationGate"]
    >;
    const service = createInboxV2OutboundSendCommandService({
      requestScope,
      preparer: preparerReturning(forged),
      denialSink: denialSink(),
      coordinator: coordinatorThatMustNotRun(),
      authorizationGate
    });

    await expect(service.send(fixture.command)).rejects.toThrow(
      "permission.denied"
    );
    expect(authorizationGate).not.toHaveBeenCalled();
  });

  it.each(["principal", "authorization epoch"] as const)(
    "rejects a route failure prepared for another authenticated %s",
    async (forgedField) => {
      const fixture = rejectedFixture("zero");
      const prepared = fixture.prepared;
      if (prepared.kind !== "route_rejected") {
        throw new Error("rejected fixture");
      }
      const input = prepared.routeResolution.input;
      const forgedInput =
        forgedField === "principal"
          ? {
              ...input,
              principal: inboxV2OutboundRoutePrincipalSchema.parse({
                kind: "employee",
                employee: {
                  tenantId: fixtureTenantId,
                  kind: "employee",
                  id: "employee:other-route-request"
                }
              })
            }
          : {
              ...input,
              authorizationEpoch: "authorization-epoch:forged-route-request",
              candidates: {
                ...input.candidates,
                authorizationEpoch: "authorization-epoch:forged-route-request"
              }
            };
      const forged = {
        ...prepared,
        routeResolution: inboxV2OutboundRouteResolutionCommitSchema.parse({
          ...prepared.routeResolution,
          input: forgedInput
        })
      } satisfies InboxV2PreparedOutboundSendCommand;
      const coordinator = coordinatorThatMustNotRun();
      const service = createInboxV2OutboundSendCommandService({
        requestScope,
        preparer: preparerReturning(forged),
        denialSink: denialSink(),
        coordinator,
        authorizationGate: allowGate()
      });

      await expect(service.send(fixture.command)).rejects.toThrow(
        "permission.denied"
      );
      expect(
        coordinator.withAuthorizedAtomicMaterialization
      ).not.toHaveBeenCalled();
    }
  );

  it("rejects a prepared route that omits exact SourceAccount use authority", async () => {
    const fixture = selectedFixture();
    const selected = fixture.prepared;
    if (selected.kind !== "selected") throw new Error("selected fixture");
    const forged = {
      ...selected,
      authorizedCommand: {
        ...selected.authorizedCommand,
        authorizationDecisionRefs:
          selected.authorizedCommand.authorizationDecisionRefs.filter(
            (decision) => decision.permissionId !== "core:source_account.use"
          )
      }
    } as unknown as InboxV2PreparedOutboundSendCommand;
    const coordinator = coordinatorThatMustNotRun();
    const service = createInboxV2OutboundSendCommandService({
      requestScope,
      preparer: preparerReturning(forged),
      denialSink: denialSink(),
      coordinator,
      authorizationGate: allowGate()
    });

    await expect(service.send(fixture.command)).rejects.toThrow();
    expect(
      coordinator.withAuthorizedAtomicMaterialization
    ).not.toHaveBeenCalled();
  });

  it("rejects WorkItem/reply authority that is not closed by the route guard", async () => {
    const fixture = selectedFixture();
    const selected = fixture.prepared;
    if (selected.kind !== "selected") throw new Error("selected fixture");
    const requirements = selected.authorizationPlan.requirements.map(
      (requirement) =>
        requirement.permissionId === "core:message.reply_external" &&
        requirement.guard.profileId === "core:rbac.guard.external_route"
          ? {
              ...requirement,
              guard: {
                ...requirement.guard,
                workState: "active" as const,
                workItemId: "work_item:forged"
              }
            }
          : requirement
    );
    const forged = {
      ...selected,
      authorizationPlan: {
        ...selected.authorizationPlan,
        requirements
      }
    } as InboxV2PreparedOutboundSendCommand;
    const coordinator = coordinatorThatMustNotRun();
    const service = createInboxV2OutboundSendCommandService({
      requestScope,
      preparer: preparerReturning(forged),
      denialSink: denialSink(),
      coordinator,
      authorizationGate: allowGate()
    });

    await expect(service.send(fixture.command)).rejects.toThrow(
      "permission.denied"
    );
    expect(
      coordinator.withAuthorizedAtomicMaterialization
    ).not.toHaveBeenCalled();
  });

  it.each(["intake high-water", "head state revision"] as const)(
    "rejects no-WorkItem reply authority with a mismatched %s",
    async (field) => {
      const fixture = selectedFixture();
      const selected = fixture.prepared;
      if (selected.kind !== "selected") throw new Error("selected fixture");
      const requirements = selected.authorizationPlan.requirements.map(
        (requirement) => {
          if (
            requirement.permissionId !== "core:message.reply_external" ||
            requirement.guard.profileId !== "core:rbac.guard.external_route" ||
            requirement.guard.workAbsenceProof === null
          ) {
            return requirement;
          }
          const absence = requirement.guard.workAbsenceProof;
          return {
            ...requirement,
            guard: {
              ...requirement.guard,
              workAbsenceProof: {
                ...absence,
                ...(field === "intake high-water"
                  ? { expectedHighWater: "2", currentHighWater: "2" }
                  : {
                      revisionChecks: absence.revisionChecks.map((revision) =>
                        revision.kind === "state"
                          ? { ...revision, expected: "2", actual: "3" }
                          : revision
                      )
                    })
              }
            }
          };
        }
      );
      const forged = {
        ...selected,
        authorizationPlan: {
          ...selected.authorizationPlan,
          requirements
        }
      } as InboxV2PreparedOutboundSendCommand;
      const coordinator = coordinatorThatMustNotRun();
      const service = createInboxV2OutboundSendCommandService({
        requestScope,
        preparer: preparerReturning(forged),
        denialSink: denialSink(),
        coordinator,
        authorizationGate: allowGate()
      });

      await expect(service.send(fixture.command)).rejects.toThrow(
        "permission.denied"
      );
      expect(
        coordinator.withAuthorizedAtomicMaterialization
      ).not.toHaveBeenCalled();
    }
  );

  it("rolls back to a stable materialization rejection when binding changes before route persistence", async () => {
    const fixture = selectedFixture();
    const persistence = persistenceFixture(fixture, []);
    vi.mocked(persistence.persistRoute).mockResolvedValueOnce({
      kind: "binding_fence_conflict"
    });
    const service = createInboxV2OutboundSendCommandService({
      requestScope,
      preparer: preparerReturning(fixture.prepared),
      denialSink: denialSink(),
      coordinator: appliedCoordinator(fixture, []),
      persistence,
      authorizationGate: allowGate()
    });

    await expect(service.send(fixture.command)).resolves.toEqual({
      outcome: "materialization_rejected",
      reason: "binding_fence_conflict"
    });
    expect(persistence.prepareMessage).not.toHaveBeenCalled();
    expect(persistence.sealMessage).not.toHaveBeenCalled();
  });

  it("rolls back before route persistence when reply authority changes", async () => {
    const fixture = selectedFixture();
    const persistence = persistenceFixture(fixture, []);
    vi.mocked(persistence.fenceReplyAuthority).mockResolvedValueOnce({
      kind: "rejected",
      reason: "slot_revision_stale"
    });
    const service = createInboxV2OutboundSendCommandService({
      requestScope,
      preparer: preparerReturning(fixture.prepared),
      denialSink: denialSink(),
      coordinator: appliedCoordinator(fixture, []),
      persistence,
      authorizationGate: allowGate()
    });

    await expect(service.send(fixture.command)).resolves.toEqual({
      outcome: "materialization_rejected",
      reason: "slot_revision_stale"
    });
    expect(persistence.persistRoute).not.toHaveBeenCalled();
    expect(persistence.prepareMessage).not.toHaveBeenCalled();
    expect(persistence.sealMessage).not.toHaveBeenCalled();
  });

  it("binds requestHash to content and explicit route intent", () => {
    const fixture = selectedFixture();
    const changed = {
      ...fixture.command,
      content: {
        blocks: fixture.command.content.blocks.map((block) =>
          block.kind === "text" ? { ...block, text: `${block.text}!` } : block
        )
      }
    };
    expect(calculateInboxV2OutboundSendIntentDigest(changed)).not.toBe(
      calculateInboxV2OutboundSendIntentDigest(fixture.command)
    );
  });

  it("derives a stable opaque route token from a normalized authenticated scope", () => {
    const fixture = selectedFixture();
    const schemaEquivalentScope = {
      principal: {
        employee: {
          id: fixtureEmployeeReference.id,
          kind: "employee",
          tenantId: fixtureTenantId
        },
        kind: "employee"
      },
      tenantId: fixtureTenantId
    } as InboxV2OutboundSendRequestScope;

    const expected = calculateInboxV2OutboundRouteIdempotencyToken(
      requestScope,
      fixture.command
    );
    expect(expected).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(
      calculateInboxV2OutboundRouteIdempotencyToken(
        schemaEquivalentScope,
        fixture.command
      )
    ).toBe(expected);
  });

  it("separates route tokens for different authenticated principals using the same raw mutation ID", () => {
    const fixture = selectedFixture();
    const otherPrincipalScope = {
      tenantId: fixtureTenantId,
      principal: inboxV2OutboundRoutePrincipalSchema.parse({
        kind: "employee",
        employee: {
          tenantId: fixtureTenantId,
          kind: "employee",
          id: "employee:other"
        }
      })
    } satisfies InboxV2OutboundSendRequestScope;

    expect(
      calculateInboxV2OutboundRouteIdempotencyToken(
        otherPrincipalScope,
        fixture.command
      )
    ).not.toBe(
      calculateInboxV2OutboundRouteIdempotencyToken(
        requestScope,
        fixture.command
      )
    );
  });

  it("separates send and reroute route tokens using the same raw mutation ID", () => {
    const fixture = selectedFixture();
    const rerouteCommand: InboxV2OutboundSendCommand = {
      ...fixture.command,
      routeIntent: {
        kind: "explicit_reroute",
        originalRouteId: fixture.route.id,
        originalDispatchId: fixture.dispatch.id,
        expectedOriginalDispatchRevision: fixture.dispatch.revision,
        replacementBindingId: fixture.route.sourceThreadBinding.id,
        reasonId: "core:operator-reroute"
      }
    };

    expect(rerouteCommand.clientMutationId).toBe(
      fixture.command.clientMutationId
    );
    expect(
      calculateInboxV2OutboundRouteIdempotencyToken(
        requestScope,
        rerouteCommand
      )
    ).not.toBe(
      calculateInboxV2OutboundRouteIdempotencyToken(
        requestScope,
        fixture.command
      )
    );
  });
});

function selectedFixture() {
  const rawMessageCreation = fixtureHuleeCreationCommit();
  const rawRoute = rawMessageCreation.outboundRoute;
  const rawActor = rawMessageCreation.message.appActor;
  if (rawRoute === null || rawActor?.kind !== "employee") {
    throw new Error("Outbound fixture requires an employee route actor.");
  }
  const command: InboxV2OutboundSendCommand = {
    tenantId: fixtureTenantId,
    conversationId: fixtureConversationReference.id,
    content: inboxV2TimelineContentDraftSchema.parse({
      blocks:
        rawMessageCreation.content.state.kind === "available"
          ? rawMessageCreation.content.state.blocks
          : []
    }),
    routeIntent: { kind: "automatic" },
    clientMutationId: "mutation:outbound-send-client-1"
  };
  const routeIdempotencyToken = calculateInboxV2OutboundRouteIdempotencyToken(
    requestScope,
    command
  );
  const routeActor = {
    ...rawActor,
    authorizationEpoch: rawRoute.authorizationEpoch
  };
  const messageCreation = inboxV2MessageCreationCommitSchema.parse({
    ...rawMessageCreation,
    message: { ...rawMessageCreation.message, appActor: routeActor },
    initialRevision: {
      ...rawMessageCreation.initialRevision,
      actionAttribution: {
        ...rawMessageCreation.initialRevision.actionAttribution,
        appActor: routeActor
      }
    },
    outboundRoute: {
      ...rawRoute,
      idempotencyToken: routeIdempotencyToken
    },
    routeConsumption:
      rawMessageCreation.routeConsumption === null
        ? null
        : {
            ...rawMessageCreation.routeConsumption,
            idempotencyToken: routeIdempotencyToken
          }
  });
  const route = messageCreation.outboundRoute;
  const dispatch = messageCreation.outboundDispatch;
  if (route === null || dispatch === null) {
    throw new Error("Outbound fixture requires route and dispatch.");
  }
  const routeResolution = materializeInboxV2OutboundRouteResolutionCommit(
    routeInput(route),
    { routeId: route.id, selectedAt: route.selection.selectedAt }
  );
  expect(routeResolution.route).toEqual(route);
  const decisions = authorizationDecisions(route);
  const requestHash = calculateInboxV2OutboundSendIntentDigest(command);
  const authorizedCommand = inboxV2AuthorizedCommandSchema.parse({
    tenantId: fixtureTenantId,
    commandId: "command:outbound-send-1",
    request: {
      tenantId: fixtureTenantId,
      requestId: "request:outbound-send-1",
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
      payload: {
        kind: "send_external",
        tenantId: fixtureTenantId,
        conversation: fixtureConversationReference,
        authorParticipant: messageCreation.message.authorParticipant,
        appActor: messageCreation.message.appActor,
        automationCausation: null,
        occurredAt: messageCreation.initialRevision.occurredAt,
        content: command.content,
        outboundRoute: fixtureRouteReference,
        routeAuthorization: {
          conversation: fixtureConversationReference,
          outboundRoute: fixtureRouteReference,
          routeRevision: route.revision,
          sourceAccount: fixtureSourceAccountReference,
          sourceThreadBinding: fixtureBindingReference,
          bindingFence: route.bindingFence
        },
        replyAuthority: {
          kind: "no_work_item",
          appActor: messageCreation.message.appActor,
          conversation: fixtureConversationReference,
          workItemSlot: {
            tenantId: fixtureTenantId,
            kind: "conversation_work_item_slot",
            id: "conversation_work_item_slot:conversation-1"
          },
          expectedSlotRevision: "1",
          intakeDecisionRevision: "1"
        },
        referenceContext: { kind: "none" }
      }
    },
    authorizedAt: fixtureT2
  });
  const authorizationPlan = authorizationPlanFor(route, decisions);
  const authorizedMutation = authorizedMutationFor({
    command,
    messageCreation,
    route,
    dispatch,
    decisions,
    requestHash
  });
  const prepared: InboxV2PreparedOutboundSendCommand = {
    kind: "selected",
    authorizationPlan,
    denialContext: {} as InboxV2SecurityDenialContext,
    authorizedCommand,
    authorizedMutation,
    routeResolution,
    messageCreation
  };
  return {
    command,
    route,
    dispatch,
    messageCreation,
    prepared,
    authorizedMutation
  };
}

function activePrimaryFixture() {
  const base = selectedFixture();
  if (base.prepared.kind !== "selected") throw new Error("selected fixture");
  const workItemId = "work_item:outbound-send-active-1";
  const workItemResource = entityKey("core:work-item", workItemId);
  const templateDecision =
    base.prepared.authorizedCommand.authorizationDecisionRefs[0];
  if (templateDecision === undefined) throw new Error("decision fixture");
  const workReadDecision = inboxV2AuthorizationDecisionReferenceSchema.parse({
    ...templateDecision,
    id: "authorization-decision:work-read",
    permissionId: "core:work.read",
    resourceScopeId: "core:work-item",
    resource: workItemResource,
    decisionHash: hash("decision-work-read")
  });
  const decisions = [
    ...base.prepared.authorizedCommand.authorizationDecisionRefs,
    workReadDecision
  ].sort((left, right) => compareCanonicalStrings(left.id, right.id));
  const replyAuthority = {
    kind: "active_primary_responsible" as const,
    appActor: base.messageCreation.message.appActor,
    conversation: fixtureConversationReference,
    workItem: {
      tenantId: fixtureTenantId,
      kind: "work_item" as const,
      id: workItemId
    },
    expectedWorkItemRevision: "7",
    primaryAssignment: {
      tenantId: fixtureTenantId,
      kind: "work_item_primary_assignment" as const,
      id: "work_item_primary_assignment:outbound-send-active-1"
    },
    expectedAssignmentRevision: "3"
  };
  const authorizedCommand = inboxV2AuthorizedCommandSchema.parse({
    ...base.prepared.authorizedCommand,
    principal: {
      ...base.prepared.authorizedCommand.principal,
      authorization: authorizationSnapshot(decisions)
    },
    authorizationDecisionRefs: decisions,
    intent: {
      ...base.prepared.authorizedCommand.intent,
      payload: {
        ...base.prepared.authorizedCommand.intent.payload,
        replyAuthority
      }
    }
  });
  const authorizationPlan = authorizationPlanFor(base.route, decisions, {
    activeWorkItemId: workItemId
  });
  const authorizedMutation = authorizedMutationFor({
    command: base.command,
    messageCreation: base.messageCreation,
    route: base.route,
    dispatch: base.dispatch,
    decisions,
    requestHash: calculateInboxV2OutboundSendIntentDigest(base.command)
  });
  const prepared: InboxV2PreparedOutboundSendCommand = {
    ...base.prepared,
    authorizationPlan,
    authorizedCommand,
    authorizedMutation
  };
  return { ...base, prepared, authorizedMutation };
}

function rerouteFixture() {
  const base = selectedFixture();
  const basePrepared = base.prepared;
  if (basePrepared.kind !== "selected") throw new Error("selected fixture");
  const originalRouteId = "outbound_route:original";
  const originalDispatchId = "outbound_dispatch:original";
  const originalBindingId = "source_thread_binding:original";
  const originalSourceAccountId = "source_account:original";
  const reasonId = "core:operator-reroute";
  const command: InboxV2OutboundSendCommand = {
    ...base.command,
    routeIntent: {
      kind: "explicit_reroute",
      originalRouteId,
      originalDispatchId,
      expectedOriginalDispatchRevision: "1",
      replacementBindingId: base.route.sourceThreadBinding.id,
      reasonId
    }
  };
  const input = routeInput(base.route);
  const replacement = input.candidates.soleEligibleCandidate;
  if (replacement === null) throw new Error("reroute candidate fixture");
  const rerouteInput = inboxV2OutboundRouteResolutionInputSchema.parse({
    ...input,
    idempotencyToken: calculateInboxV2OutboundRouteIdempotencyToken(
      requestScope,
      command
    ),
    intent: {
      kind: "explicit_reroute",
      originalRoute: {
        tenantId: fixtureTenantId,
        kind: "outbound_route",
        id: originalRouteId
      },
      originalDispatch: {
        tenantId: fixtureTenantId,
        kind: "outbound_dispatch",
        id: originalDispatchId
      },
      expectedOriginalDispatchRevision: "1",
      replacementBinding: base.route.sourceThreadBinding,
      reasonId
    },
    candidates: {
      ...input.candidates,
      explicitTarget: replacement
    }
  });
  const routeResolution = materializeInboxV2OutboundRouteResolutionCommit(
    rerouteInput,
    { routeId: base.route.id, selectedAt: base.route.selection.selectedAt }
  );
  const route = routeResolution.route;
  if (route === null) throw new Error("reroute route fixture");
  const messageCreation = inboxV2MessageCreationCommitSchema.parse({
    ...base.messageCreation,
    outboundRoute: route,
    routeConsumption:
      base.messageCreation.routeConsumption === null
        ? null
        : {
            ...base.messageCreation.routeConsumption,
            idempotencyToken: route.idempotencyToken
          }
  });
  const dispatch = messageCreation.outboundDispatch;
  if (dispatch === null) throw new Error("reroute dispatch fixture");
  const originalDispatch = inboxV2OutboundDispatchSchema.parse({
    ...dispatch,
    id: originalDispatchId,
    message: {
      ...dispatch.message,
      id: "message:reroute-original"
    },
    route: {
      ...dispatch.route,
      id: originalRouteId
    },
    createdAt: fixtureT0,
    updatedAt: fixtureT0
  });
  const rerouteCommit = inboxV2OutboundDispatchRerouteCommitSchema.parse({
    tenantId: fixtureTenantId,
    original: {
      dispatchBefore: originalDispatch,
      dispatchAfter: {
        ...originalDispatch,
        state: "cancelled",
        revision: "2",
        updatedAt: fixtureT2
      },
      outboxIntentId: "outbox-intent:provider-dispatch-original"
    },
    replacement: {
      message: dispatch.message,
      route: dispatch.route,
      dispatch: {
        tenantId: dispatch.tenantId,
        kind: "outbound_dispatch",
        id: dispatch.id
      },
      outboxIntentId: "outbox-intent:provider-dispatch-1"
    },
    reasonId,
    changedAt: fixtureT2
  });
  const newSourceDecision =
    basePrepared.authorizedCommand.authorizationDecisionRefs.find(
      (decision) =>
        decision.permissionId === "core:source_account.use" &&
        String(decision.resource.entityId) === String(route.sourceAccount.id)
    );
  if (newSourceDecision === undefined)
    throw new Error("source decision fixture");
  const originalSourceResource = entityKey(
    "core:source-account",
    originalSourceAccountId
  );
  const originalBindingResource = entityKey(
    "core:source-thread-binding",
    originalBindingId
  );
  const originalSourceDecision =
    inboxV2AuthorizationDecisionReferenceSchema.parse({
      ...newSourceDecision,
      id: "authorization-decision:source-account-use-original",
      resource: originalSourceResource,
      resourceAccessRevision: "1",
      decisionHash: hash("decision-source-original")
    });
  const rerouteDecision = inboxV2AuthorizationDecisionReferenceSchema.parse({
    ...originalSourceDecision,
    id: "authorization-decision:reroute",
    permissionId: "core:source.dispatch.reroute",
    decisionHash: hash("decision-reroute")
  });
  const commandDecisions =
    basePrepared.authorizedCommand.authorizationDecisionRefs;
  const supplementalRerouteAuthorizationDecisionRefs = [
    originalSourceDecision,
    rerouteDecision
  ].sort((left, right) => compareCanonicalStrings(left.id, right.id));
  const decisions = [
    ...commandDecisions,
    ...supplementalRerouteAuthorizationDecisionRefs
  ].sort((left, right) => compareCanonicalStrings(left.id, right.id));
  const requestHash = calculateInboxV2OutboundSendIntentDigest(command);
  const authorizedCommand = inboxV2AuthorizedCommandSchema.parse({
    ...basePrepared.authorizedCommand,
    request: {
      ...basePrepared.authorizedCommand.request,
      requestHash
    },
    principal: {
      ...basePrepared.authorizedCommand.principal,
      authorization: authorizationSnapshot(commandDecisions)
    },
    authorizationDecisionRefs: commandDecisions,
    intent: {
      ...basePrepared.authorizedCommand.intent,
      payload: {
        ...basePrepared.authorizedCommand.intent.payload,
        outboundRoute: {
          tenantId: fixtureTenantId,
          kind: "outbound_route",
          id: route.id
        },
        routeAuthorization: {
          conversation: route.conversation,
          outboundRoute: {
            tenantId: fixtureTenantId,
            kind: "outbound_route",
            id: route.id
          },
          routeRevision: route.revision,
          sourceAccount: route.sourceAccount,
          sourceThreadBinding: route.sourceThreadBinding,
          bindingFence: route.bindingFence
        }
      }
    }
  });
  const originalRouteResource = entityKey(
    "core:outbound-route",
    originalRouteId
  );
  const newRouteResource = entityKey("core:outbound-route", route.id);
  const newBindingResource = entityKey(
    "core:source-thread-binding",
    route.sourceThreadBinding.id
  );
  const newSourceResource = entityKey(
    "core:source-account",
    route.sourceAccount.id
  );
  const basePlan = authorizationPlanFor(route, decisions);
  const authorizationPlan = {
    ...basePlan,
    requirements: basePlan.requirements.map((requirement) =>
      requirement.id ===
      "requirement:authorization-decision:source-account-use-original"
        ? {
            ...requirement,
            guard: sourceUseGuard(
              route,
              originalSourceResource,
              originalBindingResource
            )
          }
        : requirement.permissionId === "core:source.dispatch.reroute"
          ? {
              ...requirement,
              visibility: "primary",
              guard: rerouteGuard({
                route,
                dispatch: originalDispatch,
                originalRouteResource,
                originalBindingResource,
                originalSourceResource,
                newRouteResource,
                newBindingResource,
                newSourceResource,
                reasonId
              })
            }
          : requirement
    )
  } as unknown as InboxV2AuthorizationPlanInput;
  const authorizedMutation = authorizedMutationFor({
    command,
    messageCreation,
    route,
    dispatch,
    rerouteCommit,
    decisions,
    requestHash
  });
  const prepared: InboxV2PreparedOutboundSendCommand = {
    kind: "selected",
    authorizationPlan,
    denialContext: {} as InboxV2SecurityDenialContext,
    authorizedCommand,
    supplementalRerouteAuthorizationDecisionRefs,
    authorizedMutation,
    routeResolution,
    messageCreation,
    rerouteCommit
  };
  return {
    command,
    route,
    dispatch,
    originalDispatch,
    rerouteCommit,
    messageCreation,
    prepared,
    authorizedMutation
  };
}

function routeInput(
  route: InboxV2OutboundRoute
): InboxV2OutboundRouteResolutionInput {
  const candidate = {
    tenantId: route.tenantId,
    conversation: route.conversation,
    externalThread: route.externalThread,
    sourceThreadBinding: route.sourceThreadBinding,
    sourceAccount: route.sourceAccount,
    sourceConnection: route.sourceConnection,
    operationId: route.operationId,
    contentKindId: route.contentKindId,
    authorizationEpoch: route.authorizationEpoch,
    bindingFence: route.bindingFence,
    adapterContract: route.adapterContract,
    routeDescriptor: route.routeDescriptor,
    conversationAuthorization: route.conversationAuthorization,
    sourceAccountAuthorization: route.sourceAccountAuthorization,
    eligibility: { state: "eligible" as const },
    runtimeObservation: route.runtimeObservationAtResolution
  };
  return inboxV2OutboundRouteResolutionInputSchema.parse({
    tenantId: route.tenantId,
    principal: route.principal,
    conversation: route.conversation,
    externalThread: route.externalThread,
    operationId: route.operationId,
    contentKindId: route.contentKindId,
    authorizationEpoch: route.authorizationEpoch,
    intent: route.selection.intent,
    referenceContext: route.referenceContext,
    routePolicy: {
      tenantId: route.tenantId,
      id: route.routePolicy.id,
      conversation: route.conversation,
      externalThread: route.externalThread,
      operationId: route.operationId,
      contentKindId: route.contentKindId,
      policyId: "core:ordered-explicit-policy",
      requiredConversationPermissionId: route.requiredConversationPermissionId,
      preferredBinding: null,
      fallback: { kind: "none" },
      revision: route.routePolicyRevision,
      createdAt: fixtureT0,
      updatedAt: fixtureT0
    },
    candidates: {
      tenantId: route.tenantId,
      conversation: route.conversation,
      externalThread: route.externalThread,
      operationId: route.operationId,
      contentKindId: route.contentKindId,
      authorizationEpoch: route.authorizationEpoch,
      routePolicy: route.routePolicy,
      routePolicyRevision: route.routePolicyRevision,
      automaticCompatibleEligibleCount: 1,
      explicitTarget: null,
      preferredCandidate: null,
      soleEligibleCandidate: candidate,
      fallbackCandidate: null,
      zeroCandidateError: null,
      snapshotToken: route.selection.candidateSnapshotToken,
      loadedByTrustedServiceId: "core:route-resolver",
      loadedAt: fixtureT1,
      notAfter: route.selection.candidateSnapshotNotAfter
    },
    mutationToken: route.mutationToken,
    idempotencyToken: route.idempotencyToken,
    correlationToken: route.correlationToken,
    requestedAt: route.selection.selectedAt
  });
}

function rejectedFixture(
  failureKind: "zero" | "multiple" | "explicit_forbidden"
) {
  const selected = selectedFixture();
  const base = routeInput(selected.route);
  const candidate = base.candidates.soleEligibleCandidate;
  if (candidate === null) throw new Error("candidate fixture");
  const explicitForbidden = {
    ...candidate,
    sourceAccountAuthorization: {
      ...candidate.sourceAccountAuthorization,
      effect: "deny" as const,
      matchedPermissionIds: []
    },
    eligibility: {
      state: "ineligible" as const,
      error: {
        code: "route.forbidden" as const,
        retryability: "terminal" as const,
        diagnostic: {
          codeId: "core:route-forbidden",
          retryable: false,
          correlationToken: "correlation:route-forbidden",
          safeOperatorHintId: null
        }
      }
    }
  };
  const input = inboxV2OutboundRouteResolutionInputSchema.parse({
    ...base,
    intent:
      failureKind === "explicit_forbidden"
        ? { kind: "explicit_binding", binding: fixtureBindingReference }
        : { kind: "automatic" },
    candidates: {
      ...base.candidates,
      automaticCompatibleEligibleCount:
        failureKind === "multiple"
          ? 2
          : failureKind === "explicit_forbidden"
            ? 1
            : 0,
      explicitTarget:
        failureKind === "explicit_forbidden" ? explicitForbidden : null,
      soleEligibleCandidate:
        failureKind === "explicit_forbidden" ? candidate : null,
      zeroCandidateError:
        failureKind === "zero"
          ? {
              code: "route.not_found",
              retryability: "terminal",
              diagnostic: {
                codeId: "core:route-not-found",
                retryable: false,
                correlationToken: "correlation:route-not-found",
                safeOperatorHintId: null
              }
            }
          : null
    }
  });
  const routeResolution = materializeInboxV2OutboundRouteResolutionCommit(
    input,
    { routeId: "outbound_route:not-created", selectedAt: fixtureT2 }
  );
  const command: InboxV2OutboundSendCommand = {
    ...selected.command,
    routeIntent:
      failureKind === "explicit_forbidden"
        ? {
            kind: "explicit_binding",
            bindingId: fixtureBindingReference.id
          }
        : { kind: "automatic" }
  };
  const selectedPrepared = selected.prepared;
  if (selectedPrepared.kind !== "selected") {
    throw new Error("selected fixture");
  }
  return {
    command,
    prepared: {
      kind: "route_rejected",
      disclosureAuthorizationPlan: {
        ...selectedPrepared.authorizationPlan,
        requirements: selectedPrepared.authorizationPlan.requirements.filter(
          (requirement) => requirement.permissionId === "core:conversation.read"
        )
      },
      denialContext: {} as InboxV2SecurityDenialContext,
      routeResolution
    } satisfies InboxV2PreparedOutboundSendCommand
  };
}

function authorizationDecisions(
  route: InboxV2OutboundRoute
): readonly InboxV2AuthorizationDecisionReference[] {
  const resource = {
    tenantId: fixtureTenantId,
    entityTypeId: "core:conversation",
    entityId: fixtureConversationReference.id
  };
  const base = {
    tenantId: fixtureTenantId,
    authorizationEpoch: route.authorizationEpoch,
    principal: {
      kind: "employee" as const,
      employee: fixtureEmployeeReference
    },
    resourceScopeId: "core:conversation",
    resource,
    resourceAccessRevision: "1",
    decisionRevision: "1",
    decisionHash: hash("decision"),
    outcome: "allowed" as const,
    decidedAt: fixtureT1,
    notAfter: fixtureT4
  };
  return [
    {
      ...base,
      id: "authorization-decision:conversation-read",
      permissionId: "core:conversation.read"
    },
    {
      ...base,
      id: "authorization-decision:reply-external",
      permissionId: "core:message.reply_external"
    },
    {
      ...base,
      id: "authorization-decision:source-account-use",
      permissionId: "core:source_account.use",
      resourceScopeId: "core:source-account",
      resource: {
        tenantId: fixtureTenantId,
        entityTypeId: "core:source-account",
        entityId: fixtureSourceAccountReference.id
      }
    }
  ].map((decision) =>
    inboxV2AuthorizationDecisionReferenceSchema.parse(decision)
  );
}

function authorizationSnapshot(
  decisions: readonly InboxV2AuthorizationDecisionReference[]
) {
  const resources = new Map(
    decisions.map((decision) => [
      `${decision.resource.entityTypeId}:${decision.resource.entityId}`,
      {
        resource: decision.resource,
        accessRevision: decision.resourceAccessRevision
      }
    ])
  );
  return {
    tenantId: fixtureTenantId,
    employee: fixtureEmployeeReference,
    value: "authorization:route-epoch-1",
    dependencies: {
      tenantRbacRevision: "1",
      employeeAccessRevision: "1",
      employeeInboxRelationRevision: "1",
      sharedAccessRevision: "1",
      resourceDependencies: [...resources.values()].sort((left, right) => {
        const leftKey = `${left.resource.tenantId}\u0000${left.resource.entityTypeId}\u0000${left.resource.entityId}`;
        const rightKey = `${right.resource.tenantId}\u0000${right.resource.entityTypeId}\u0000${right.resource.entityId}`;
        return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
      }),
      temporalBoundaryDigest: hash("temporal")
    },
    evaluatedAt: fixtureT1,
    notAfter: fixtureT4,
    nextAuthorizationBoundary: null
  };
}

function authorizationPlanFor(
  route: InboxV2OutboundRoute,
  decisions: readonly InboxV2AuthorizationDecisionReference[],
  options: Readonly<{ activeWorkItemId?: string }> = {}
): InboxV2AuthorizationPlanInput {
  const conversationResource = {
    tenantId: fixtureTenantId,
    entityTypeId: "core:conversation",
    entityId: route.conversation.id
  };
  const bindingResource = {
    tenantId: fixtureTenantId,
    entityTypeId: "core:source-thread-binding",
    entityId: route.sourceThreadBinding.id
  };
  const externalThreadResource = {
    tenantId: fixtureTenantId,
    entityTypeId: "core:external-thread",
    entityId: route.externalThread.id
  };
  const sourceAccountResource = {
    tenantId: fixtureTenantId,
    entityTypeId: "core:source-account",
    entityId: route.sourceAccount.id
  };
  const readRequirementId =
    "requirement:authorization-decision:conversation-read";
  const sourceRequirementId =
    "requirement:authorization-decision:source-account-use";
  const workRequirementId = "requirement:authorization-decision:work-read";
  const activeWorkItemResource =
    options.activeWorkItemId === undefined
      ? null
      : entityKey("core:work-item", options.activeWorkItemId);
  const requirements = decisions.map((decision) => ({
    id: `requirement:${decision.id}`,
    permissionId: decision.permissionId,
    resource: decision.resource,
    resourceAccessRevision: decision.resourceAccessRevision,
    expectedResourceAccessRevision: decision.resourceAccessRevision,
    scopeFacts:
      decision.permissionId === "core:message.reply_external"
        ? activeWorkItemResource === null
          ? [
              {
                kind: "collaborator",
                ...fixtureScopePath(conversationResource),
                employeeId: fixtureEmployeeReference.id,
                subject: {
                  kind: "conversation",
                  conversationId: route.conversation.id
                },
                state: "active",
                episodeRevision: "1",
                currentEpisodeRevision: "1",
                validUntil: fixtureT4
              }
            ]
          : [
              {
                kind: "responsible",
                ...fixtureScopePath(
                  conversationResource,
                  activeWorkItemResource
                ),
                employeeId: fixtureEmployeeReference.id,
                workItemId: options.activeWorkItemId,
                state: "active",
                assignmentRevision: "3",
                currentAssignmentRevision: "3",
                validUntil: fixtureT4
              }
            ]
        : decision.permissionId === "core:source_account.use" ||
            decision.permissionId === "core:source.dispatch.reroute"
          ? [
              {
                kind: "source_account",
                ...fixtureScopePath(decision.resource),
                sourceAccountId: decision.resource.entityId,
                validUntil: fixtureT4
              }
            ]
          : [],
    revisionChecks: [],
    guard:
      decision.permissionId === "core:message.reply_external"
        ? {
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
              {
                kind: "route",
                expected: route.revision,
                actual: route.revision
              },
              { kind: "state", expected: "1", actual: "1" }
            ],
            conversationRequirementId: readRequirementId,
            sourceAccountRequirementId: sourceRequirementId,
            workRequirementId:
              activeWorkItemResource === null ? null : workRequirementId,
            overrideRequirementId: null,
            claimRequirementId: null,
            sourceAccountId: route.sourceAccount.id,
            bindingSourceAccountId: route.sourceAccount.id,
            bindingGeneration: route.bindingFence.bindingGeneration,
            expectedBindingGeneration: route.bindingFence.bindingGeneration,
            bindingState: "active",
            capabilityState: "supported",
            capabilityId: "core:capability.message.reply",
            capabilityManifestResource: {
              tenantId: fixtureTenantId,
              entityTypeId: "core:provider-capability-manifest",
              entityId: "provider_capability_manifest:message-reply"
            },
            capabilityManifestSourceAccountResource: sourceAccountResource,
            capabilityManifestBindingResource: bindingResource,
            capabilityRevisionChecks: [
              { kind: "manifest", expected: "1", actual: "1" }
            ],
            capabilityNotAfter: fixtureT4,
            actorRelation:
              activeWorkItemResource === null
                ? "conversation_collaborator"
                : "primary_responsible",
            workItemId: options.activeWorkItemId ?? null,
            workState:
              activeWorkItemResource === null
                ? "no_work_non_actionable"
                : "active",
            queueReplyPolicy: "responsible_only",
            replyPolicyEvidence: {
              resource: {
                tenantId: fixtureTenantId,
                entityTypeId: "core:queue-reply-policy",
                entityId: "queue_reply_policy:conversation-1"
              },
              conversationResource,
              workItemResource: activeWorkItemResource,
              policy: "responsible_only",
              revisionChecks: [{ kind: "state", expected: "1", actual: "1" }],
              notAfter: fixtureT4
            },
            workAbsenceProof:
              activeWorkItemResource === null
                ? {
                    resource: {
                      tenantId: fixtureTenantId,
                      entityTypeId: "core:conversation-work-head",
                      entityId: "conversation_work_head:conversation-1"
                    },
                    conversationResource,
                    workItemCount: 0,
                    expectedHighWater: "1",
                    currentHighWater: "1",
                    revisionChecks: [
                      { kind: "state", expected: "1", actual: "1" }
                    ]
                  }
                : null,
            conversationAccessBindingState: "active",
            structuralAccessBinding: null,
            claimMode: "none",
            overrideReason: null,
            routeFallbackRequested: false
          }
        : decision.permissionId === "core:source_account.use"
          ? sourceUseGuard(route, sourceAccountResource, bindingResource)
          : decision.permissionId === "core:work.read" &&
              options.activeWorkItemId !== undefined
            ? workReadGuard(options.activeWorkItemId)
            : canonicalConversationReadGuard(decision.resource),
    visibility:
      decision.permissionId === "core:message.reply_external"
        ? "primary"
        : "secondary_hidden",
    authorizationSubject: { kind: "actor" }
  }));
  return {
    tenantId: fixtureTenantId,
    evaluatedAt: fixtureT2,
    principal: {
      kind: "employee",
      employee: fixtureEmployeeReference,
      lifecycle: "active",
      session: {
        state: "active",
        authorization: authorizationSnapshot(decisions),
        notAfter: fixtureT4
      }
    },
    currentAuthorization: {
      tenantId: fixtureTenantId,
      principal: {
        kind: "employee",
        employeeId: fixtureEmployeeReference.id
      },
      authorizationEpoch: route.authorizationEpoch,
      dependencies: authorizationSnapshot(decisions).dependencies
    },
    grants: decisions.map((decision) => ({
      id: `grant:${decision.id}`,
      tenantId: fixtureTenantId,
      principal: {
        kind: "employee",
        employeeId: fixtureEmployeeReference.id
      },
      permissionId: decision.permissionId,
      catalogSchemaId: "core:inbox-v2.permission-scope-catalog",
      catalogVersion: "v1",
      scope:
        decision.resource.entityTypeId === "core:source-account"
          ? {
              type: "source_account",
              tenantId: fixtureTenantId,
              id: decision.resource.entityId
            }
          : { type: "tenant", tenantId: fixtureTenantId },
      source: {
        kind: "direct_grant",
        origin: "inbox_v2_native",
        directGrantId: `direct:${decision.id}`,
        bindingResource: {
          tenantId: fixtureTenantId,
          entityTypeId: "core:direct-grant",
          entityId: `direct_grant:direct:${decision.id}`
        },
        bindingRevision: "1"
      },
      revision: "1",
      validFrom: null,
      validUntil: fixtureT4,
      revokedAt: null
    })),
    requirements
  } as unknown as InboxV2AuthorizationPlanInput;
}

function fixtureScopePath(
  resource: {
    tenantId: string;
    entityTypeId: string;
    entityId: string;
  },
  scopeTarget = resource
) {
  return {
    resource,
    scopeTarget,
    pathRevisionChecks: [
      { kind: "relation" as const, expected: "1", actual: "1" },
      { kind: "state" as const, expected: "1", actual: "1" }
    ],
    authorityProvenance: {
      kind: "hulee_canonical_repository" as const,
      factId: `fact:${resource.entityTypeId}:${resource.entityId}`,
      loaderDecisionId: "loader-decision:outbound-send",
      projectionRevision: "1",
      observedAt: fixtureT1
    }
  };
}

function workReadGuard(workItemId: string) {
  return {
    profileId: "core:rbac.guard.work_item_state" as const,
    authorizationMode: "operation" as const,
    workItemId,
    operation: "read" as const,
    workState: "active" as const,
    actorRelation: "none" as const,
    assignmentState: "assigned" as const,
    expectedStateRevision: "1",
    currentStateRevision: "1",
    destinationRequirementIds: [],
    destinationResources: [],
    authorityTargetResource: null,
    authorityState: null,
    eligibleEmployeeId: null,
    authorityRevisionChecks: [],
    overrideReason: null,
    overrideRequirementId: null
  };
}

function canonicalConversationReadGuard(resource: {
  tenantId: string;
  entityTypeId: string;
  entityId: string;
}) {
  return {
    profileId: "core:rbac.guard.canonical_resource" as const,
    resourceState: "active" as const,
    contentBoundary: "external" as const,
    routeInputFields: [],
    companionRequirementIds: [],
    action: {
      kind: "conversation_content_read" as const,
      targetResource: resource,
      conversationKind: "external_work" as const,
      contentBoundary: "external" as const,
      topologyResource: {
        tenantId: fixtureTenantId,
        entityTypeId: "core:conversation-topology",
        entityId: "conversation_topology:conversation-1"
      },
      topologyConversationResource: resource,
      topologyConversationKind: "external_work" as const,
      topologyRevisionChecks: [
        { kind: "state" as const, expected: "1", actual: "1" }
      ]
    }
  };
}

function sourceUseGuard(
  route: InboxV2OutboundRoute,
  sourceAccountResource: {
    tenantId: string;
    entityTypeId: string;
    entityId: string;
  },
  bindingResource: {
    tenantId: string;
    entityTypeId: string;
    entityId: string;
  }
) {
  const manifestResource = {
    tenantId: fixtureTenantId,
    entityTypeId: "core:provider-capability-manifest",
    entityId: `provider_capability_manifest:source-use:${bindingResource.entityId}`
  };
  return {
    profileId: "core:rbac.guard.source_account_route" as const,
    operation: {
      kind: "use" as const,
      sourceAccountResource,
      bindingResource,
      capabilityManifest: {
        resource: manifestResource,
        capabilityId: "core:capability.source_account.use" as const,
        sourceAccountResource,
        bindingResource,
        routeResource: null,
        manifestSourceAccountResource: sourceAccountResource,
        manifestBindingResource: bindingResource,
        manifestRouteResource: null,
        state: "supported" as const,
        revisionChecks: [
          manifestResource,
          sourceAccountResource,
          bindingResource
        ].map((resource) => ({ resource, expected: "1", actual: "1" })),
        notAfter: fixtureT4
      }
    },
    sourceAccountId: sourceAccountResource.entityId,
    routeSourceAccountId: sourceAccountResource.entityId,
    sourceState: "active" as const,
    bindingState: "active" as const,
    bindingGeneration: route.bindingFence.bindingGeneration,
    expectedBindingGeneration: route.bindingFence.bindingGeneration,
    capabilityState: "supported" as const,
    capabilityNotAfter: fixtureT4
  };
}

function rerouteGuard(
  input: Readonly<{
    route: InboxV2OutboundRoute;
    dispatch: InboxV2OutboundDispatch;
    originalRouteResource: ReturnType<typeof entityKey>;
    originalBindingResource: ReturnType<typeof entityKey>;
    originalSourceResource: ReturnType<typeof entityKey>;
    newRouteResource: ReturnType<typeof entityKey>;
    newBindingResource: ReturnType<typeof entityKey>;
    newSourceResource: ReturnType<typeof entityKey>;
    reasonId: string;
  }>
) {
  const conversationResource = entityKey(
    "core:conversation",
    input.route.conversation.id
  );
  const externalThreadResource = entityKey(
    "core:external-thread",
    input.route.externalThread.id
  );
  const dispatchResource = entityKey(
    "core:outbound-dispatch",
    input.dispatch.id
  );
  const dispatchRelationResource = entityKey(
    "core:outbound-dispatch-route-decision",
    `outbound_dispatch_route_decision:${input.dispatch.id}`
  );
  const originalRouteBindingRelation = entityKey(
    "core:outbound-route-binding",
    `outbound_route_binding:${input.originalRouteResource.entityId}`
  );
  const newRouteBindingRelation = entityKey(
    "core:outbound-route-binding",
    `outbound_route_binding:${input.newRouteResource.entityId}`
  );
  return {
    profileId: "core:rbac.guard.source_account_route" as const,
    operation: {
      kind: "reroute_dispatch" as const,
      dispatch: {
        resource: dispatchResource,
        originalRouteResource: input.originalRouteResource,
        requestedRouteResource: input.newRouteResource,
        relationResource: dispatchRelationResource,
        relationDispatchResource: dispatchResource,
        relationOriginalRouteResource: input.originalRouteResource,
        relationRequestedRouteResource: input.newRouteResource,
        state: "before_provider_io" as const,
        expectedStateRevision: "1",
        currentStateRevision: "1",
        revisionChecks: [
          dispatchResource,
          dispatchRelationResource,
          input.originalRouteResource,
          input.newRouteResource
        ].map((resource) => ({ resource, expected: "1", actual: "1" }))
      },
      originalRoute: {
        resource: input.originalRouteResource,
        bindingResource: input.originalBindingResource,
        sourceAccountResource: input.originalSourceResource,
        routeBindingRelationResource: originalRouteBindingRelation,
        relationRouteResource: input.originalRouteResource,
        relationBindingResource: input.originalBindingResource,
        conversationResource,
        externalThreadResource,
        bindingConversationResource: conversationResource,
        bindingExternalThreadResource: externalThreadResource,
        bindingSourceAccountResource: input.originalSourceResource,
        relationRevisionChecks: [
          { kind: "relation" as const, expected: "1", actual: "1" }
        ]
      },
      newRoute: {
        resource: input.newRouteResource,
        bindingResource: input.newBindingResource,
        sourceAccountResource: input.newSourceResource,
        routeBindingRelationResource: newRouteBindingRelation,
        relationRouteResource: input.newRouteResource,
        relationBindingResource: input.newBindingResource,
        conversationResource,
        externalThreadResource,
        bindingConversationResource: conversationResource,
        bindingExternalThreadResource: externalThreadResource,
        bindingSourceAccountResource: input.newSourceResource,
        relationRevisionChecks: [
          { kind: "relation" as const, expected: "1", actual: "1" }
        ]
      },
      originalCapabilityManifest: rerouteCapabilityManifest(
        input.originalSourceResource,
        input.originalBindingResource,
        input.originalRouteResource,
        "original"
      ),
      newCapabilityManifest: rerouteCapabilityManifest(
        input.newSourceResource,
        input.newBindingResource,
        input.newRouteResource,
        "new"
      ),
      originalSourceRequirementId:
        "requirement:authorization-decision:source-account-use-original",
      newSourceRequirementId:
        "requirement:authorization-decision:source-account-use",
      dispatchState: "before_provider_io" as const,
      routeRevisionChecks: [
        { kind: "binding" as const, expected: "1", actual: "1" },
        { kind: "route" as const, expected: "1", actual: "1" },
        { kind: "state" as const, expected: "1", actual: "1" }
      ],
      originalRouteHistoryRecorded: true,
      reason: input.reasonId,
      auditEventId: "audit:outbound-send-1"
    },
    sourceAccountId: input.originalSourceResource.entityId,
    routeSourceAccountId: input.originalSourceResource.entityId,
    sourceState: "active" as const,
    bindingState: "active" as const,
    bindingGeneration: "1",
    expectedBindingGeneration: "1",
    capabilityState: "supported" as const,
    capabilityNotAfter: fixtureT4
  };
}

function rerouteCapabilityManifest(
  sourceAccountResource: ReturnType<typeof entityKey>,
  bindingResource: ReturnType<typeof entityKey>,
  routeResource: ReturnType<typeof entityKey>,
  suffix: string
) {
  const manifestResource = entityKey(
    "core:provider-capability-manifest",
    `provider_capability_manifest:reroute-${suffix}`
  );
  return {
    resource: manifestResource,
    capabilityId: "core:capability.source.dispatch.reroute" as const,
    sourceAccountResource,
    bindingResource,
    routeResource,
    manifestSourceAccountResource: sourceAccountResource,
    manifestBindingResource: bindingResource,
    manifestRouteResource: routeResource,
    state: "supported" as const,
    revisionChecks: [
      manifestResource,
      sourceAccountResource,
      bindingResource,
      routeResource
    ].map((resource) => ({ resource, expected: "1", actual: "1" })),
    notAfter: fixtureT4
  };
}

function entityKey(entityTypeId: string, entityId: string) {
  return { tenantId: fixtureTenantId, entityTypeId, entityId };
}

function withForgedRerouteGuard(
  selected: Extract<InboxV2PreparedOutboundSendCommand, { kind: "selected" }>,
  operation: unknown
): InboxV2PreparedOutboundSendCommand {
  return {
    ...selected,
    authorizationPlan: {
      ...selected.authorizationPlan,
      requirements: selected.authorizationPlan.requirements.map(
        (requirement) =>
          requirement.permissionId === "core:source.dispatch.reroute" &&
          requirement.guard.profileId === "core:rbac.guard.source_account_route"
            ? {
                ...requirement,
                guard: { ...requirement.guard, operation }
              }
            : requirement
      )
    }
  } as unknown as InboxV2PreparedOutboundSendCommand;
}

function authorizedMutationFor(input: {
  command: InboxV2OutboundSendCommand;
  messageCreation: ReturnType<typeof inboxV2MessageCreationCommitSchema.parse>;
  route: InboxV2OutboundRoute;
  dispatch: InboxV2OutboundDispatch;
  rerouteCommit?: InboxV2OutboundDispatchRerouteCommit;
  decisions: readonly InboxV2AuthorizationDecisionReference[];
  requestHash: string;
}): WithInboxV2AuthorizedCommandMutationInput {
  const dispatchChangeId = "change:outbound-dispatch-1";
  const messageReference = {
    tenantId: fixtureTenantId,
    recordId: input.messageCreation.message.id,
    schemaId: INBOX_V2_MESSAGE_SCHEMA_ID,
    schemaVersion: INBOX_V2_MESSAGE_SCHEMA_VERSION,
    digest: hash("message")
  };
  const dispatchReference = {
    tenantId: fixtureTenantId,
    recordId: input.dispatch.id,
    schemaId: INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_ID,
    schemaVersion: INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_VERSION,
    digest: hash("dispatch")
  };
  const rerouteCommitReference =
    input.rerouteCommit === undefined
      ? null
      : {
          tenantId: fixtureTenantId,
          recordId: input.rerouteCommit.original.dispatchAfter.id,
          schemaId: INBOX_V2_OUTBOUND_DISPATCH_REROUTE_COMMIT_SCHEMA_ID,
          schemaVersion:
            INBOX_V2_OUTBOUND_DISPATCH_REROUTE_COMMIT_SCHEMA_VERSION,
          digest: calculateInboxV2CanonicalSha256(input.rerouteCommit)
        };
  const originalDispatchReference =
    input.rerouteCommit === undefined
      ? null
      : {
          tenantId: fixtureTenantId,
          recordId: input.rerouteCommit.original.dispatchAfter.id,
          schemaId: INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_ID,
          schemaVersion: INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_VERSION,
          digest: calculateInboxV2CanonicalSha256(
            input.rerouteCommit.original.dispatchAfter
          )
        };
  const originalDispatchChange =
    input.rerouteCommit === undefined ||
    rerouteCommitReference === null ||
    originalDispatchReference === null
      ? null
      : {
          id: "change:outbound-dispatch-reroute-original",
          ordinal: 2,
          entity: {
            tenantId: fixtureTenantId,
            entityTypeId: "core:outbound-dispatch",
            entityId: input.rerouteCommit.original.dispatchAfter.id
          },
          resultingRevision:
            input.rerouteCommit.original.dispatchAfter.revision,
          timeline: null,
          audience: "conversation_external" as const,
          state: {
            kind: "upsert" as const,
            stateSchemaId: INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_ID,
            stateSchemaVersion: INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_VERSION,
            stateHash: originalDispatchReference.digest,
            payloadReference: originalDispatchReference,
            domainCommitReference: rerouteCommitReference
          }
        };
  const originalDispatchEvent =
    originalDispatchChange === null ||
    rerouteCommitReference === null ||
    input.rerouteCommit === undefined
      ? null
      : {
          id: "event:outbound-dispatch-reroute-original",
          typeId: "core:outbound-dispatch.changed" as const,
          payloadSchemaId: INBOX_V2_OUTBOUND_DISPATCH_REROUTE_COMMIT_SCHEMA_ID,
          payloadSchemaVersion:
            INBOX_V2_OUTBOUND_DISPATCH_REROUTE_COMMIT_SCHEMA_VERSION,
          ordinal: "1",
          changeIds: [originalDispatchChange.id],
          subjects: [originalDispatchChange.entity],
          payloadReference: rerouteCommitReference,
          correlationId: "correlation:route-1",
          commandIds: ["command:outbound-send-1"],
          clientMutationIds: [input.command.clientMutationId],
          authorizationDecisionRefs: input.decisions,
          accessEffect: { kind: "none" as const },
          occurredAt: input.rerouteCommit.changedAt,
          recordedAt: input.rerouteCommit.changedAt,
          eventHash: hash("reroute-event")
        };
  const originalDispatchProjection =
    originalDispatchChange === null || originalDispatchEvent === null
      ? null
      : {
          id: "outbox-intent:outbound-dispatch-reroute-projection",
          ordinal: 2,
          typeId: "core:projection.update" as const,
          handlerId: "core:inbox-projection",
          effectClass: "projection" as const,
          eventId: originalDispatchEvent.id,
          changeIds: [originalDispatchChange.id],
          payloadReference: rerouteCommitReference,
          consumerDedupeKey: hash("reroute-projection-dedupe"),
          correlationId: "correlation:route-1",
          availableAt: fixtureT2,
          intentHash: hash("reroute-projection-intent")
        };
  return {
    tenantId: fixtureTenantId,
    command: {
      id: "command:outbound-send-1",
      requestId: "request:outbound-send-1",
      clientMutationId: input.command.clientMutationId,
      commandTypeId:
        input.command.routeIntent.kind === "explicit_reroute"
          ? "core:source.dispatch.reroute"
          : "core:message.send",
      requestHash: input.requestHash,
      actor: { kind: "employee", employeeId: fixtureEmployeeReference.id },
      authorizationDecisionId:
        input.command.routeIntent.kind === "explicit_reroute"
          ? "authorization-decision:reroute"
          : "authorization-decision:reply-external",
      authorizationEpoch: input.route.authorizationEpoch,
      authorizedAt: fixtureT2,
      publicResultCode: "core:message.queued",
      resultReference: messageReference,
      sensitiveResultReference: null
    },
    revisions: {
      expectedTenantRbacRevision: "1",
      expectedSharedAccessRevision: "1",
      advanceTenantRbac: false,
      advanceSharedAccess: false,
      employees: [],
      resources: []
    },
    records: {
      mutationId: "authorization-mutation:outbound-send-1",
      relationKind: null,
      streamCommitId: "commit:outbound-send-1",
      expectedStreamEpoch: "stream:outbound-send-1",
      audienceImpact: { kind: "none" },
      commitHash: hash("commit"),
      correlationId: "correlation:route-1",
      changes: [
        {
          id: dispatchChangeId,
          ordinal: 1,
          entity: {
            tenantId: fixtureTenantId,
            entityTypeId: "core:outbound-dispatch",
            entityId: input.dispatch.id
          },
          resultingRevision: "1",
          timeline: null,
          audience: "conversation_external",
          state: {
            kind: "upsert",
            stateSchemaId: INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_ID,
            stateSchemaVersion: INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_VERSION,
            stateHash: dispatchReference.digest,
            payloadReference: dispatchReference,
            domainCommitReference: messageReference
          }
        },
        ...(originalDispatchChange === null ? [] : [originalDispatchChange])
      ],
      events: originalDispatchEvent === null ? [] : [originalDispatchEvent],
      outboxIntents: [
        {
          id: "outbox-intent:provider-dispatch-1",
          ordinal: 1,
          typeId: "core:provider.dispatch",
          handlerId: "core:provider-dispatch-worker",
          effectClass: "provider_io",
          eventId: "event:message-send-1",
          changeIds: [dispatchChangeId],
          payloadReference: dispatchReference,
          consumerDedupeKey: hash("provider-dedupe"),
          correlationId: "correlation:route-1",
          availableAt: fixtureT2,
          intentHash: hash("provider-intent")
        },
        ...(originalDispatchProjection === null
          ? []
          : [originalDispatchProjection])
      ],
      audit: {
        id: "audit:outbound-send-1",
        actionId:
          input.command.routeIntent.kind === "explicit_reroute"
            ? "core:source.dispatch.reroute"
            : "core:message.send",
        target: {
          tenantId: fixtureTenantId,
          entityTypeId: "core:outbound-dispatch",
          entityId: `internal-ref:${"c".repeat(32)}`
        },
        reasonCodeId:
          input.command.routeIntent.kind === "explicit_reroute"
            ? input.command.routeIntent.reasonId
            : "core:message-send-requested",
        matchedPermissionIds: [
          ...new Set(input.decisions.map((item) => item.permissionId))
        ].sort(compareCanonicalStrings),
        grantSourceIds: ["internal-ref:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],
        authorizationScopeIds: [
          ...new Set(input.decisions.map((item) => item.resourceScopeId))
        ].sort(compareCanonicalStrings),
        overrideReasonCodeId: null,
        policyVersion: "v1",
        evidenceReference: rerouteCommitReference ?? messageReference,
        authorizationDecisionRefs: input.decisions,
        correlationId: "correlation:route-1",
        outcome: "succeeded",
        revisionDeltaHash: hash("revision-delta"),
        previousAuditHash: null,
        auditHash: hash("audit"),
        occurredAt: fixtureT2,
        recordedAt: fixtureT2,
        expiresAt: fixtureT4,
        facets: []
      }
    },
    occurredAt: fixtureT2
  } as unknown as WithInboxV2AuthorizedCommandMutationInput;
}

function persistenceFixture(
  fixture: ReturnType<typeof selectedFixture>,
  calls: string[]
) {
  const capability = {};
  return {
    fenceReplyAuthority: vi.fn(async () => {
      calls.push("reply-authority");
      return {
        kind: "committed" as const,
        authorityKind: "no_work_item" as const
      };
    }),
    persistRoute: vi.fn(async () => {
      calls.push("route");
      return { kind: "committed" as const, route: fixture.route };
    }),
    persistReroute: vi.fn(async () => {
      calls.push("reroute");
      return { kind: "committed" as const, route: fixture.route };
    }),
    prepareMessage: vi.fn(async () => {
      calls.push("message.prepare");
      return { kind: "ready" as const, capability };
    }),
    sealMessage: vi.fn(async () => {
      calls.push("message.seal");
      return {
        kind: "created" as const,
        message: fixture.messageCreation.message,
        timelineItem: fixture.messageCreation.timelineAllocation.items[0]!,
        envelope: {},
        receipt: {}
      };
    })
  } as unknown as NonNullable<
    InboxV2OutboundSendCommandServiceOptions["persistence"]
  >;
}

function idempotencyScopeFor(
  command: InboxV2OutboundSendCommand
): InboxV2OutboundSendIdempotencyScope {
  return {
    tenantId: command.tenantId,
    principal: requestScope.principal,
    commandTypeId:
      command.routeIntent.kind === "explicit_reroute"
        ? "core:source.dispatch.reroute"
        : "core:message.send",
    clientMutationId: command.clientMutationId,
    publicResultCode: "core:message.queued"
  };
}

function appliedCoordinator(
  fixture: ReturnType<typeof selectedFixture>,
  calls: string[]
): InboxV2AuthorizedAtomicMaterializationCoordinator {
  return {
    withAuthorizedCommandMutation: vi.fn(),
    withAuthorizedAtomicMaterialization: vi.fn(
      async (_input, prepare, seal) => {
        calls.push("coordinator");
        const capability = await prepare({} as never);
        const sealed = await seal({} as never, capability);
        return {
          kind: "applied" as const,
          result: sealed.result,
          status: appliedStatus(fixture),
          revisionEffects: []
        };
      }
    )
  } as unknown as InboxV2AuthorizedAtomicMaterializationCoordinator;
}

function replayCoordinator(
  fixture: ReturnType<typeof selectedFixture>
): InboxV2AuthorizedAtomicMaterializationCoordinator {
  return {
    withAuthorizedCommandMutation: vi.fn(),
    withAuthorizedAtomicMaterialization: vi.fn(async () => ({
      kind: "already_applied" as const,
      status: appliedStatus(fixture)
    }))
  } as unknown as InboxV2AuthorizedAtomicMaterializationCoordinator;
}

function coordinatorThatMustNotRun(): InboxV2AuthorizedAtomicMaterializationCoordinator {
  return {
    withAuthorizedCommandMutation: vi.fn(),
    withAuthorizedAtomicMaterialization: vi.fn()
  } as unknown as InboxV2AuthorizedAtomicMaterializationCoordinator;
}

function appliedStatus(
  fixture: ReturnType<typeof selectedFixture>
): InboxV2PrivilegedAuthorizationMutationAppliedStatus {
  return {
    commandId: "command:outbound-send-1",
    mutationId: "authorization-mutation:outbound-send-1",
    publicResultCode: "core:message.queued",
    resultReference: fixture.authorizedMutation.command.resultReference,
    streamCommitId: "commit:outbound-send-1",
    streamEpoch: "stream:outbound-send-1",
    streamPosition: "1",
    committedAt: fixtureT2,
    sensitiveResultReference: null
  };
}

function allowGate(): NonNullable<
  InboxV2OutboundSendCommandServiceOptions["authorizationGate"]
> {
  return (async (input: { executeAllowed: () => Promise<unknown> }) => ({
    outcome: "allowed" as const,
    publicDecision: { outcome: "allowed" as const, notAfter: fixtureT4 },
    value: await input.executeAllowed()
  })) as NonNullable<
    InboxV2OutboundSendCommandServiceOptions["authorizationGate"]
  >;
}

function denialSink(): InboxV2SecurityDenialSink {
  return { record: vi.fn() } as unknown as InboxV2SecurityDenialSink;
}
