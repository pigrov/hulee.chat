import { inboxV2OutboundRouteSchema } from "@hulee/contracts";
import { describe, expect, it } from "vitest";

import {
  consumeInboxV2AtomicOutboundRouteProof,
  registerInboxV2AtomicOutboundRouteProof,
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
