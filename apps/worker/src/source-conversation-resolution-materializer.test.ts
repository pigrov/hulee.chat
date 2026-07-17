import {
  INBOX_V2_NORMALIZED_EVENT_ENVELOPE_SCHEMA_ID,
  inboxV2SourceConversationResolutionSourceProjectionSchema,
  type InboxV2SourceConversationResolutionSourceProjection
} from "@hulee/contracts";
import { computeInboxV2SourceThreadBindingRouteDescriptorDigest } from "@hulee/db";
import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  buildInboxV2SourceConversationMaterializationAuthorizationPreimage,
  createInboxV2TrustedSourceConversationResolutionMaterializer,
  deriveInboxV2SourceConversationMaterializationAuthorizationDigest,
  isInboxV2TrustedSourceConversationResolutionMaterializer,
  type InboxV2SourceConversationMaterializationClock,
  type InboxV2SourceConversationNamespaceDeriver,
  type InboxV2SourceConversationThreadPlan,
  type InboxV2SourceConversationThreadPlanResolver,
  type InboxV2TrustedSourceConversationResolutionMaterializer
} from "./source-conversation-resolution-materializer";

const t0 = "2026-07-17T07:00:00.000Z";
const t1 = "2026-07-17T07:01:00.000Z";
const t2 = "2026-07-17T07:02:00.000Z";

function adapterContract(overrides: Record<string, unknown> = {}) {
  return {
    contractId: "module:synthetic-source:direct-contract",
    contractVersion: "v1",
    declarationRevision: "1",
    surfaceId: "module:synthetic-source:direct-surface",
    loadedByTrustedServiceId: "core:source-runtime",
    loadedAt: t0,
    ...overrides
  };
}

function sourceProjection(
  input: {
    tenantId?: string;
    accountSuffix?: string;
    connectionSuffix?: string;
    subject?: string;
    scopeKind?: "provider" | "source_connection" | "source_account";
    realmId?: string;
    realmVersion?: string;
    canonicalizationVersion?: string;
    objectKindId?: string;
    adapterOverrides?: Record<string, unknown>;
    recordedAt?: string;
  } = {}
): InboxV2SourceConversationResolutionSourceProjection {
  const tenantId = input.tenantId ?? "tenant:alpha";
  const accountSuffix = input.accountSuffix ?? "a";
  const connectionSuffix = input.connectionSuffix ?? accountSuffix;
  const sourceConnection = {
    tenantId,
    kind: "source_connection" as const,
    id: `source_connection:synthetic-${connectionSuffix}`
  };
  const sourceAccount = {
    tenantId,
    kind: "source_account" as const,
    id: `source_account:synthetic-${accountSuffix}`
  };
  const scopeKind = input.scopeKind ?? "provider";
  const scope =
    scopeKind === "provider"
      ? ({ kind: "provider" } as const)
      : scopeKind === "source_connection"
        ? ({ kind: "source_connection", owner: sourceConnection } as const)
        : ({ kind: "source_account", owner: sourceAccount } as const);
  const contract = adapterContract(input.adapterOverrides);
  const subject = input.subject ?? "Group:Case-Sensitive-ABC";
  const realmId = input.realmId ?? "module:synthetic-source:thread-realm";
  const realmVersion = input.realmVersion ?? "v1";
  const canonicalizationVersion = input.canonicalizationVersion ?? "v1";
  const objectKindId =
    input.objectKindId ??
    (scopeKind === "provider"
      ? "module:synthetic-source:group-room"
      : "module:synthetic-source:dialog");

  return inboxV2SourceConversationResolutionSourceProjectionSchema.parse({
    tenantId,
    rawInboundEvent: {
      tenantId,
      kind: "raw_inbound_event",
      id: `raw_inbound_event:synthetic-${accountSuffix}`
    },
    normalizedInboundEvent: {
      tenantId,
      kind: "normalized_inbound_event",
      id: `normalized_inbound_event:synthetic-${accountSuffix}`
    },
    sourceConnection,
    sourceAccount,
    domain: "core:inbox-v2.normalized-event-safe-envelope",
    schemaId: INBOX_V2_NORMALIZED_EVENT_ENVELOPE_SCHEMA_ID,
    schemaVersion: "v1",
    safeEnvelopeHmacSha256: `hmac-sha256:${"a".repeat(64)}`,
    adapterContract: contract,
    thread: {
      sourceConnection,
      sourceAccount,
      identityDeclaration: {
        adapterContract: contract,
        identityKind: "external_thread",
        realmId,
        realmVersion,
        canonicalizationVersion,
        objectKindId,
        scopeKind,
        decisionStrength: "authoritative"
      },
      key: {
        realm: {
          realmId,
          realmVersion,
          canonicalizationVersion
        },
        scope,
        objectKindId,
        canonicalExternalSubject: subject
      },
      observedExternalSubject: subject
    },
    recordedAt: input.recordedAt ?? t1
  });
}

function routeDescriptor(
  source: InboxV2SourceConversationResolutionSourceProjection,
  overrides: Record<string, unknown> = {}
) {
  const candidate = {
    adapterContract: source.adapterContract,
    descriptorSchemaId: "module:synthetic-source:thread-route",
    descriptorVersion: "v1",
    descriptorRevision: "1",
    destinationKindId: "module:synthetic-source:provider-peer",
    // A provider route may intentionally differ from the canonical thread
    // subject. It is still exact, opaque, adapter-owned and sender-free.
    destinationSubject: `Route:${source.thread.key.canonicalExternalSubject}`,
    attributes: [
      {
        attributeId: "module:synthetic-source:address-kind",
        value: "group"
      }
    ],
    descriptorDigestSha256: "0".repeat(64),
    ...overrides
  };
  return {
    ...candidate,
    descriptorDigestSha256:
      "descriptorDigestSha256" in overrides
        ? String(overrides.descriptorDigestSha256)
        : computeInboxV2SourceThreadBindingRouteDescriptorDigest(
            candidate as never
          )
  };
}

function threadPlan(
  source: InboxV2SourceConversationResolutionSourceProjection,
  overrides: Partial<InboxV2SourceConversationThreadPlan> = {}
): InboxV2SourceConversationThreadPlan {
  return {
    topology: source.thread.key.scope.kind === "provider" ? "group" : "direct",
    purposeId: "core:chat",
    routeDescriptor: routeDescriptor(source) as never,
    capabilityEntries: [
      {
        capabilityId: "core:message-text-send",
        operationId: "core:send",
        contentKindId: "core:text",
        state: "supported",
        referencePortability: "external_thread",
        requiredProviderRoleIds: [],
        validUntil: null,
        diagnostic: null,
        evidence: [source.rawInboundEvent]
      }
    ],
    historySyncState: "not_started",
    ...overrides
  } as InboxV2SourceConversationThreadPlan;
}

function namespaceDeriver(
  secret: string,
  namespaceGeneration = "conversation-namespace-v1",
  calls = vi.fn()
): InboxV2SourceConversationNamespaceDeriver & {
  calls: typeof calls;
} {
  return {
    namespaceGeneration,
    calls,
    deriveNamespaceHmacSha256(input) {
      calls(input);
      return createHmac("sha256", `${secret}:${input.tenantId}`)
        .update(JSON.stringify(input), "utf8")
        .digest("hex");
    }
  };
}

function fixedClock(value = t2): InboxV2SourceConversationMaterializationClock {
  return { now: () => value };
}

function resolver(
  handler: (
    source: InboxV2SourceConversationResolutionSourceProjection
  ) => InboxV2SourceConversationThreadPlan = threadPlan
): InboxV2SourceConversationThreadPlanResolver & {
  resolve: ReturnType<typeof vi.fn>;
} {
  const resolve = vi.fn(handler);
  return { resolve };
}

function materializer(
  input: {
    source?: InboxV2SourceConversationResolutionSourceProjection;
    namespace?: InboxV2SourceConversationNamespaceDeriver;
    planResolver?: InboxV2SourceConversationThreadPlanResolver;
    clock?: InboxV2SourceConversationMaterializationClock;
    trustedServiceId?: string;
  } = {}
): {
  source: InboxV2SourceConversationResolutionSourceProjection;
  value: InboxV2TrustedSourceConversationResolutionMaterializer;
} {
  const source = input.source ?? sourceProjection();
  return {
    source,
    value: createInboxV2TrustedSourceConversationResolutionMaterializer({
      trustedServiceId: input.trustedServiceId ?? "core:source-runtime",
      namespaceDeriver:
        input.namespace ?? namespaceDeriver("tenant-secret-alpha"),
      threadPlanResolver: input.planResolver ?? resolver(),
      clock: input.clock ?? fixedClock()
    })
  };
}

function expectMaterializerError(action: () => unknown, code: string): void {
  let thrown: unknown;
  try {
    action();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toMatchObject({ code });
}

describe("Inbox V2 source conversation resolution materializer", () => {
  it("produces a synchronous sender-free deterministic plan with five domain-separated tenant HMAC purposes", () => {
    const source = sourceProjection();
    const namespace = namespaceDeriver("tenant-secret-alpha");
    const planResolver = resolver((received) => {
      expect(Object.keys(received).sort()).toEqual(
        [
          "adapterContract",
          "domain",
          "normalizedInboundEvent",
          "rawInboundEvent",
          "recordedAt",
          "safeEnvelopeHmacSha256",
          "schemaId",
          "schemaVersion",
          "sourceAccount",
          "sourceConnection",
          "tenantId",
          "thread"
        ].sort()
      );
      expect(received).not.toHaveProperty("identityObservations");
      expect(received).not.toHaveProperty("sender");
      expect(received).not.toHaveProperty("client");
      expect(received).not.toHaveProperty("title");
      expect(Object.isFrozen(received)).toBe(true);
      expect(Object.isFrozen(received.thread)).toBe(true);
      return threadPlan(received);
    });
    const fixture = materializer({ source, namespace, planResolver });

    const plan = fixture.value.materialize(source);

    expect(planResolver.resolve).toHaveBeenCalledTimes(1);
    expect(plan).not.toBeInstanceOf(Promise);
    expect(plan).toMatchObject({
      source,
      topology: "group",
      purposeId: "core:chat",
      historySyncState: "not_started",
      namespaceGeneration: "conversation-namespace-v1",
      materializedByTrustedServiceId: "core:source-runtime",
      materializedAt: t2
    });
    expect(plan.routeDescriptor.destinationSubject).toBe(
      "Route:Group:Case-Sensitive-ABC"
    );
    expect(plan.routeDescriptor.destinationSubject).not.toBe(
      source.thread.key.canonicalExternalSubject
    );
    expect(plan.capabilityEntries).toEqual(
      threadPlan(source).capabilityEntries
    );
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.routeDescriptor)).toBe(true);
    expect(plan).not.toHaveProperty("streamPosition");
    expect(plan).not.toHaveProperty("conversation");

    expect(namespace.calls.mock.calls.map(([call]) => call.purpose)).toEqual([
      "conversation_id",
      "external_thread_id",
      "source_thread_binding_id",
      "remote_access_episode_id",
      "materialization_authorization"
    ]);
    const { materializationToken: _materializationToken, ...unsignedPlan } =
      plan;
    const verificationNamespace = namespaceDeriver("tenant-secret-alpha");
    const expectedAuthorizationDigest =
      deriveInboxV2SourceConversationMaterializationAuthorizationDigest(
        verificationNamespace,
        unsignedPlan
      );
    expect(plan.materializationToken).toBe(
      `source-conversation-materialization:${plan.namespaceGeneration}:${expectedAuthorizationDigest}`
    );
    expect(
      JSON.parse(
        buildInboxV2SourceConversationMaterializationAuthorizationPreimage(
          unsignedPlan
        )
      )
    ).toMatchObject({
      domain: "core:inbox-v2.source-conversation-materialization-authorization",
      tenantId: source.tenantId,
      candidateIds: {
        candidateConversationId: plan.candidateConversationId,
        candidateExternalThreadId: plan.candidateExternalThreadId
      }
    });
    for (const opaque of [
      plan.candidateConversationId,
      plan.candidateExternalThreadId,
      plan.candidateSourceThreadBindingId,
      plan.candidateRemoteAccessEpisodeId,
      plan.materializationToken
    ]) {
      expect(opaque).not.toContain("Group:Case-Sensitive-ABC");
      expect(opaque).not.toContain("synthetic-a");
    }
  });

  it("shares only provider-scoped group thread candidates across accounts and keeps binding candidates account-local", () => {
    const namespace = namespaceDeriver("tenant-secret-alpha");
    const value = createInboxV2TrustedSourceConversationResolutionMaterializer({
      trustedServiceId: "core:source-runtime",
      namespaceDeriver: namespace,
      threadPlanResolver: resolver(),
      clock: fixedClock()
    });
    const providerA = value.materialize(
      sourceProjection({ accountSuffix: "a", connectionSuffix: "a" })
    );
    const providerB = value.materialize(
      sourceProjection({ accountSuffix: "b", connectionSuffix: "b" })
    );

    expect(providerA.candidateConversationId).toBe(
      providerB.candidateConversationId
    );
    expect(providerA.candidateExternalThreadId).toBe(
      providerB.candidateExternalThreadId
    );
    expect(providerA.candidateSourceThreadBindingId).not.toBe(
      providerB.candidateSourceThreadBindingId
    );
    expect(providerA.candidateRemoteAccessEpisodeId).not.toBe(
      providerB.candidateRemoteAccessEpisodeId
    );

    const privateA = value.materialize(
      sourceProjection({ accountSuffix: "a", scopeKind: "source_account" })
    );
    const privateB = value.materialize(
      sourceProjection({ accountSuffix: "b", scopeKind: "source_account" })
    );
    expect(privateA.candidateConversationId).not.toBe(
      privateB.candidateConversationId
    );
    expect(privateA.candidateExternalThreadId).not.toBe(
      privateB.candidateExternalThreadId
    );
  });

  it("preserves exact realm, scope, object and case in stable candidate derivation", () => {
    const value = materializer().value;
    const upper = value.materialize(
      sourceProjection({ subject: "Opaque:ABC" })
    );
    const lower = value.materialize(
      sourceProjection({ subject: "Opaque:abc" })
    );
    const accountScoped = value.materialize(
      sourceProjection({ subject: "Opaque:ABC", scopeKind: "source_account" })
    );

    expect(upper.candidateConversationId).not.toBe(
      lower.candidateConversationId
    );
    expect(upper.candidateExternalThreadId).not.toBe(
      lower.candidateExternalThreadId
    );
    expect(upper.candidateConversationId).not.toBe(
      accountScoped.candidateConversationId
    );

    const sameSubject = "Opaque:Same-Provider-Subject";
    const base = value.materialize(sourceProjection({ subject: sameSubject }));
    const dimensionVariants = [
      sourceProjection({
        subject: sameSubject,
        realmId: "module:other-source:thread-realm"
      }),
      sourceProjection({ subject: sameSubject, realmVersion: "v2" }),
      sourceProjection({
        subject: sameSubject,
        canonicalizationVersion: "v2"
      }),
      sourceProjection({
        subject: sameSubject,
        objectKindId: "module:synthetic-source:channel-room"
      }),
      sourceProjection({ subject: sameSubject, tenantId: "tenant:beta" })
    ].map((source) => value.materialize(source));

    expect(
      new Set([
        base.candidateConversationId,
        ...dimensionVariants.map((plan) => plan.candidateConversationId)
      ]).size
    ).toBe(1 + dimensionVariants.length);
    expect(
      new Set([
        base.candidateExternalThreadId,
        ...dimensionVariants.map((plan) => plan.candidateExternalThreadId)
      ]).size
    ).toBe(1 + dimensionVariants.length);
  });

  it("keeps entity candidates stable across replay clocks and wrapping-key rotation but isolates namespace secrets and tenants", () => {
    const source = sourceProjection();
    const initial = materializer({
      source,
      namespace: namespaceDeriver("stable-secret", "namespace-v1"),
      clock: fixedClock(t2)
    }).value;
    const wrappingRotation = materializer({
      source,
      namespace: namespaceDeriver("stable-secret", "namespace-v1"),
      clock: fixedClock("2026-07-17T07:03:00.000Z")
    }).value;
    const changedSecret = materializer({
      source,
      namespace: namespaceDeriver("changed-secret", "namespace-v2")
    }).value;
    const first = initial.materialize(source);
    const replay = wrappingRotation.materialize(source);
    const changed = changedSecret.materialize(source);
    const otherTenantSource = sourceProjection({ tenantId: "tenant:beta" });
    const otherTenant = initial.materialize(otherTenantSource);

    expect(replay.candidateConversationId).toBe(first.candidateConversationId);
    expect(replay.candidateExternalThreadId).toBe(
      first.candidateExternalThreadId
    );
    expect(replay.candidateSourceThreadBindingId).toBe(
      first.candidateSourceThreadBindingId
    );
    expect(replay.materializationToken).not.toBe(first.materializationToken);
    expect(changed.candidateConversationId).not.toBe(
      first.candidateConversationId
    );
    expect(otherTenant.candidateConversationId).not.toBe(
      first.candidateConversationId
    );
  });

  it("brands only factory-created materializers and rejects dependency or sender-bearing structural substitution", () => {
    const source = sourceProjection();
    const planResolver = resolver();
    const fixture = materializer({ source, planResolver });
    const structuralFake = {
      materialize: vi.fn()
    } as unknown as InboxV2TrustedSourceConversationResolutionMaterializer;

    expect(
      isInboxV2TrustedSourceConversationResolutionMaterializer(fixture.value)
    ).toBe(true);
    expect(
      isInboxV2TrustedSourceConversationResolutionMaterializer(structuralFake)
    ).toBe(false);
    expect(() =>
      createInboxV2TrustedSourceConversationResolutionMaterializer({
        trustedServiceId: "core:source-runtime",
        namespaceDeriver: namespaceDeriver("tenant-secret-alpha"),
        threadPlanResolver: planResolver,
        clock: fixedClock(),
        database: {}
      } as never)
    ).toThrowError(/Unknown source conversation materializer option/u);

    expectMaterializerError(
      () =>
        fixture.value.materialize({
          ...source,
          identityObservations: [],
          sender: { id: "must-not-cross-boundary" },
          client: { id: "must-not-cross-boundary" },
          title: "must-not-cross-boundary"
        } as never),
      "source.conversation_resolution.source_projection_invalid"
    );
    expect(planResolver.resolve).not.toHaveBeenCalled();
  });

  it("fails closed for service, adapter-surface and route-digest substitution", () => {
    const source = sourceProjection();
    const wrongServiceResolver = resolver();
    const wrongService = materializer({
      source,
      planResolver: wrongServiceResolver,
      trustedServiceId: "core:other-runtime"
    });
    expectMaterializerError(
      () => wrongService.value.materialize(source),
      "source.conversation_resolution.materializer_service_mismatch"
    );
    expect(wrongServiceResolver.resolve).not.toHaveBeenCalled();

    const wrongSurface = materializer({
      source,
      planResolver: resolver((received) =>
        threadPlan(received, {
          routeDescriptor: routeDescriptor(received, {
            adapterContract: adapterContract({
              surfaceId: "module:synthetic-source:other-surface"
            })
          }) as never
        })
      )
    });
    expectMaterializerError(
      () => wrongSurface.value.materialize(source),
      "source.conversation_resolution.adapter_surface_mismatch"
    );

    const invalidDigest = materializer({
      source,
      planResolver: resolver((received) =>
        threadPlan(received, {
          routeDescriptor: routeDescriptor(received, {
            descriptorDigestSha256: "f".repeat(64)
          }) as never
        })
      )
    });
    expectMaterializerError(
      () => invalidDigest.value.materialize(source),
      "source.conversation_resolution.route_descriptor_digest_invalid"
    );
  });

  it("rejects asynchronous or extended adapter plans before deriving candidate IDs", () => {
    const source = sourceProjection();
    const namespace = namespaceDeriver("tenant-secret-alpha");
    const asynchronous =
      createInboxV2TrustedSourceConversationResolutionMaterializer({
        trustedServiceId: "core:source-runtime",
        namespaceDeriver: namespace,
        threadPlanResolver: {
          // @ts-expect-error Thread planning is a synchronous pure boundary.
          resolve: async (received) => threadPlan(received)
        },
        clock: fixedClock()
      });
    expectMaterializerError(
      () => asynchronous.materialize(source),
      "source.conversation_resolution.thread_plan_invalid"
    );
    expect(namespace.calls).not.toHaveBeenCalled();

    const extended = materializer({
      source,
      namespace,
      planResolver: resolver(
        (received) =>
          ({
            ...threadPlan(received),
            sender: "forbidden"
          }) as never
      )
    });
    expectMaterializerError(
      () => extended.value.materialize(source),
      "source.conversation_resolution.thread_plan_invalid"
    );
    expect(namespace.calls).not.toHaveBeenCalled();
  });

  it("rejects invalid tenant HMAC output and clocks that are invalid or precede the normalized event", () => {
    const source = sourceProjection();
    const invalidNamespace: InboxV2SourceConversationNamespaceDeriver = {
      namespaceGeneration: "conversation-namespace-v1",
      deriveNamespaceHmacSha256: () => "NOT-A-LOWERCASE-HMAC"
    };
    expectMaterializerError(
      () =>
        materializer({
          source,
          namespace: invalidNamespace
        }).value.materialize(source),
      "source.conversation_resolution.namespace_derivation_invalid"
    );

    expectMaterializerError(
      () =>
        materializer({
          source,
          clock: fixedClock("not-a-time")
        }).value.materialize(source),
      "source.conversation_resolution.materialization_clock_invalid"
    );
    expectMaterializerError(
      () =>
        materializer({
          source,
          clock: fixedClock(t0)
        }).value.materialize(source),
      "source.conversation_resolution.materialization_clock_invalid"
    );
  });
});
