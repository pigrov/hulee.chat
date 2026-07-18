import {
  inboxV2OutboundDispatchRerouteCommitSchema,
  inboxV2OutboundRouteSchema
} from "@hulee/contracts";
import { describe, expect, it } from "vitest";

import {
  consumeInboxV2AtomicOutboundRouteProof,
  consumeInboxV2AtomicOutboundRerouteProof,
  registerInboxV2AtomicOutboundRouteProof,
  registerInboxV2AtomicOutboundRerouteProof,
  revokeInboxV2AtomicOutboundRerouteProofs,
  type InboxV2AtomicOutboundRerouteExpectation,
  type InboxV2AtomicOutboundRouteProof
} from "./sql-inbox-v2-atomic-materialization-internal";
import { computeInboxV2OutboundRouteDigest } from "./sql-inbox-v2-outbound-transport-repository";
import { createOutboundTransportContractFixture } from "./sql-inbox-v2-outbound-transport-repository.test-support";

describe("Inbox V2 atomic materialization route proofs", () => {
  it("binds the proof digest to descriptor-only route changes with stable IDs and revision", () => {
    const fixture = createOutboundTransportContractFixture({
      tenantId: "tenant:atomic-route-proof-descriptor",
      suffix: "atomic-route-proof-descriptor"
    });
    const route = fixture.route;
    const mutatedRoute = inboxV2OutboundRouteSchema.parse({
      ...route,
      routeDescriptor: {
        ...route.routeDescriptor,
        destinationSubject: `${route.routeDescriptor.destinationSubject}-forged`
      }
    });
    const token = {};
    const proof = routeProof(route);
    const mutatedProof = routeProof(mutatedRoute);

    expect(mutatedProof).toMatchObject({
      tenantId: proof.tenantId,
      routeId: proof.routeId,
      conversationId: proof.conversationId,
      sourceAccountId: proof.sourceAccountId,
      routePolicyId: proof.routePolicyId,
      routePolicyRevision: proof.routePolicyRevision
    });
    expect(mutatedProof.routeDigest).not.toBe(proof.routeDigest);

    registerInboxV2AtomicOutboundRouteProof(token, proof);
    expect(() =>
      consumeInboxV2AtomicOutboundRouteProof(token, mutatedProof)
    ).toThrow(/exactly one matching live outbound route proof/iu);
    expect(() => consumeInboxV2AtomicOutboundRouteProof(token, proof)).toThrow(
      /exactly one matching live outbound route proof/iu
    );
  });

  it("does not let a route proof issued for token A satisfy token B's Message seal", () => {
    const fixture = createOutboundTransportContractFixture({
      tenantId: "tenant:atomic-route-proof-token",
      suffix: "atomic-route-proof-token"
    });
    const proof = routeProof(fixture.route);
    const tokenA = {};
    const tokenB = {};

    registerInboxV2AtomicOutboundRouteProof(tokenA, proof);
    expect(() => consumeInboxV2AtomicOutboundRouteProof(tokenB, proof)).toThrow(
      /exactly one matching live outbound route proof/iu
    );
    expect(() =>
      consumeInboxV2AtomicOutboundRouteProof(tokenA, proof)
    ).not.toThrow();
  });

  it("rejects route proofs on internal and source-originated Message seals", () => {
    const fixture = createOutboundTransportContractFixture({
      tenantId: "tenant:atomic-route-proof-non-external",
      suffix: "atomic-route-proof-non-external"
    });
    const token = {};

    registerInboxV2AtomicOutboundRouteProof(token, routeProof(fixture.route));
    expect(() => consumeInboxV2AtomicOutboundRouteProof(token, null)).toThrow(
      /non-external Message materialization/iu
    );
  });

  it("rejects more than one live route proof for one Message seal", () => {
    const fixture = createOutboundTransportContractFixture({
      tenantId: "tenant:atomic-route-proof-duplicate",
      suffix: "atomic-route-proof-duplicate"
    });
    const token = {};
    const proof = routeProof(fixture.route);

    registerInboxV2AtomicOutboundRouteProof(token, proof);
    registerInboxV2AtomicOutboundRouteProof(token, proof);
    expect(() => consumeInboxV2AtomicOutboundRouteProof(token, proof)).toThrow(
      /exactly one matching live outbound route proof/iu
    );
  });

  it("binds an explicit-reroute proof to the original CAS fence and complete replacement identity", () => {
    const token = {};
    const commit = rerouteCommit("matching");
    const expected = rerouteExpectation(commit);

    registerInboxV2AtomicOutboundRerouteProof(token, commit);
    expect(consumeInboxV2AtomicOutboundRerouteProof(token, expected)).toEqual(
      commit
    );
    expect(() =>
      consumeInboxV2AtomicOutboundRerouteProof(token, expected)
    ).toThrow(/exactly one matching live outbound reroute proof/iu);
  });

  it("consumes a mismatched reroute proof fail-closed and keeps it token-local", () => {
    const tokenA = {};
    const tokenB = {};
    const commit = rerouteCommit("mismatch");
    const expected = rerouteExpectation(commit);

    registerInboxV2AtomicOutboundRerouteProof(tokenA, commit);
    expect(() =>
      consumeInboxV2AtomicOutboundRerouteProof(tokenB, expected)
    ).toThrow(/exactly one matching live outbound reroute proof/iu);
    expect(() =>
      consumeInboxV2AtomicOutboundRerouteProof(tokenA, {
        ...expected,
        expectedOriginalDispatchRevision: "2"
      })
    ).toThrow(/exactly one matching live outbound reroute proof/iu);
    expect(() =>
      consumeInboxV2AtomicOutboundRerouteProof(tokenA, expected)
    ).toThrow(/exactly one matching live outbound reroute proof/iu);
  });

  it("rejects reroute proofs on normal sends and revokes abandoned proof sets", () => {
    const normalToken = {};
    const abandonedToken = {};
    const commit = rerouteCommit("normal");

    registerInboxV2AtomicOutboundRerouteProof(normalToken, commit);
    expect(() =>
      consumeInboxV2AtomicOutboundRerouteProof(normalToken, null)
    ).toThrow(/non-reroute Message materialization/iu);

    registerInboxV2AtomicOutboundRerouteProof(abandonedToken, commit);
    revokeInboxV2AtomicOutboundRerouteProofs(abandonedToken);
    expect(
      consumeInboxV2AtomicOutboundRerouteProof(abandonedToken, null)
    ).toBeNull();
  });

  it("rejects duplicate reroute proofs for one Message seal", () => {
    const token = {};
    const commit = rerouteCommit("duplicate");
    const expected = rerouteExpectation(commit);

    registerInboxV2AtomicOutboundRerouteProof(token, commit);
    registerInboxV2AtomicOutboundRerouteProof(token, commit);
    expect(() =>
      consumeInboxV2AtomicOutboundRerouteProof(token, expected)
    ).toThrow(/exactly one matching live outbound reroute proof/iu);
  });
});

function routeProof(
  route: ReturnType<typeof inboxV2OutboundRouteSchema.parse>
): InboxV2AtomicOutboundRouteProof {
  return {
    tenantId: route.tenantId,
    routeId: route.id,
    conversationId: route.conversation.id,
    sourceAccountId: route.sourceAccount.id,
    routePolicyId: route.routePolicy.id,
    routePolicyRevision: route.routePolicyRevision,
    routeDigest: computeInboxV2OutboundRouteDigest(route)
  };
}

function rerouteCommit(suffix: string) {
  const tenantId = `tenant:atomic-reroute-${suffix}`;
  const changedAt = "2026-07-18T12:01:00.000Z";
  const dispatchBefore = {
    tenantId,
    id: `outbound_dispatch:atomic-reroute-original-${suffix}`,
    message: {
      tenantId,
      kind: "message" as const,
      id: `message:atomic-reroute-original-${suffix}`
    },
    route: {
      tenantId,
      kind: "outbound_route" as const,
      id: `outbound_route:atomic-reroute-original-${suffix}`
    },
    multiSendOperation: null,
    state: "queued" as const,
    attemptCount: 0,
    activeAttempt: null,
    lastAttempt: null,
    retryAuthorization: null,
    revision: "1",
    createdAt: "2026-07-18T12:00:00.000Z",
    updatedAt: "2026-07-18T12:00:00.000Z"
  };
  return inboxV2OutboundDispatchRerouteCommitSchema.parse({
    tenantId,
    original: {
      dispatchBefore,
      dispatchAfter: {
        ...dispatchBefore,
        state: "cancelled",
        revision: "2",
        updatedAt: changedAt
      },
      outboxIntentId: `outbox-intent:atomic-reroute-original-${suffix}`
    },
    replacement: {
      message: {
        tenantId,
        kind: "message",
        id: `message:atomic-reroute-replacement-${suffix}`
      },
      route: {
        tenantId,
        kind: "outbound_route",
        id: `outbound_route:atomic-reroute-replacement-${suffix}`
      },
      dispatch: {
        tenantId,
        kind: "outbound_dispatch",
        id: `outbound_dispatch:atomic-reroute-replacement-${suffix}`
      },
      outboxIntentId: `outbox-intent:atomic-reroute-replacement-${suffix}`
    },
    reasonId: "core:operator-reroute",
    changedAt
  });
}

function rerouteExpectation(
  commit: ReturnType<typeof rerouteCommit>
): InboxV2AtomicOutboundRerouteExpectation {
  return {
    tenantId: commit.tenantId,
    originalRouteId: commit.original.dispatchBefore.route.id,
    originalDispatchId: commit.original.dispatchBefore.id,
    expectedOriginalDispatchRevision: commit.original.dispatchBefore.revision,
    replacementMessageId: commit.replacement.message.id,
    replacementRouteId: commit.replacement.route.id,
    replacementDispatchId: commit.replacement.dispatch.id,
    reasonId: commit.reasonId
  };
}
