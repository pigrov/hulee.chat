import type { z } from "zod";
import { describe, expect, it } from "vitest";

import { inboxV2SourceObjectTimelineCreationCommitSchema } from "./timeline-source-object-commit";
import {
  fixtureAdapterContract,
  fixtureParticipant,
  fixtureReference,
  fixtureSourceConnectionReference,
  fixtureSourceIdentityClaim,
  fixtureSourceIdentityReference,
  fixtureT0,
  fixtureT1,
  fixtureT2,
  fixtureTenantId,
  fixtureTimelineAllocation,
  fixtureTimelineItem
} from "./timeline-message-fixtures.type-fixture";

describe("Inbox V2 source-object Timeline creation", () => {
  it.each(["call", "review", "module_event"] as const)(
    "creates one typed %s item through an exact source induction",
    (kind) => {
      expect(
        inboxV2SourceObjectTimelineCreationCommitSchema.safeParse(
          fixtureSourceObjectCommit(kind)
        ).success
      ).toBe(true);
    }
  );

  it("rejects a participant snapshot that does not represent the proven source actor", () => {
    const commit = fixtureSourceObjectCommit("call");
    commit.actorParticipantSnapshot = fixtureParticipant("employee");

    expect(
      inboxV2SourceObjectTimelineCreationCommitSchema.safeParse(commit).success
    ).toBe(false);
  });

  it("rejects a Timeline source descriptor induced from another normalized event", () => {
    const commit = fixtureSourceObjectCommit("call");
    commit.inductionProof.sourceObject = {
      ...commit.inductionProof.sourceObject,
      normalizedSourceEvent: fixtureReference(
        "normalized_inbound_event",
        "normalized_inbound_event:other-event"
      )
    };

    expect(
      inboxV2SourceObjectTimelineCreationCommitSchema.safeParse(commit).success
    ).toBe(false);
  });

  it("requires the full exact claim when event-time identity resolution was claimed", () => {
    const commit = fixtureSourceObjectCommit("review");
    const claim = fixtureSourceIdentityClaim();
    commit.inductionProof.identityResolutionAtOccurrence = {
      state: "claimed",
      claim: fixtureReference("source_identity_claim", claim.id),
      claimVersion: claim.claimVersion,
      target: claim.target
    };

    expect(
      inboxV2SourceObjectTimelineCreationCommitSchema.safeParse(commit).success
    ).toBe(false);

    commit.claimAtOccurrenceSnapshot = claim;
    expect(
      inboxV2SourceObjectTimelineCreationCommitSchema.safeParse(commit).success
    ).toBe(true);
  });

  it("does not manufacture an anonymous Review author", () => {
    const commit = fixtureSourceObjectCommit("review");
    commit.inductionProof.sourceIdentitySnapshot = null;
    commit.inductionProof.identityResolutionAtOccurrence = null;
    commit.actorParticipantSnapshot = null;

    expect(
      inboxV2SourceObjectTimelineCreationCommitSchema.safeParse(commit).success
    ).toBe(false);
  });

  it("rejects a connection-scoped actor from another source connection", () => {
    const commit = fixtureSourceObjectCommit("module_event");
    const identity = commit.inductionProof.sourceIdentitySnapshot;
    if (identity === null) {
      throw new Error("Fixture must contain a source actor.");
    }
    identity.scope = {
      kind: "source_connection",
      owner: fixtureReference(
        "source_connection",
        "source_connection:other-connection"
      )
    };

    expect(
      inboxV2SourceObjectTimelineCreationCommitSchema.safeParse(commit).success
    ).toBe(false);
  });
});

function fixtureSourceObjectCommit(
  kind: "call" | "review" | "module_event"
): z.input<typeof inboxV2SourceObjectTimelineCreationCommitSchema> {
  const normalizedEvent = fixtureReference(
    "normalized_inbound_event",
    "normalized_inbound_event:source-object-1"
  );
  const sourceObject = {
    sourceObject: fixtureReference("source_object", "source_object:object-1"),
    objectKindId:
      kind === "call"
        ? "module:telephony:call"
        : kind === "review"
          ? "module:reviews:review"
          : "module:marketplace:order",
    objectRevision: "1",
    normalizedSourceEvent: normalizedEvent
  };
  const participant = fixtureParticipant("source");
  const subject =
    kind === "call"
      ? {
          kind: "call" as const,
          source: sourceObject,
          actorParticipant: {
            tenantId: participant.tenantId,
            kind: "conversation_participant" as const,
            id: participant.id
          }
        }
      : kind === "review"
        ? {
            kind: "review" as const,
            source: sourceObject,
            authorParticipant: {
              tenantId: participant.tenantId,
              kind: "conversation_participant" as const,
              id: participant.id
            }
          }
        : {
            kind: "module_event" as const,
            itemKindId: "module:marketplace:order-status",
            source: sourceObject,
            actorParticipant: {
              tenantId: participant.tenantId,
              kind: "conversation_participant" as const,
              id: participant.id
            }
          };
  const item = fixtureTimelineItem("external", {
    subject,
    visibility: "source_item_policy",
    occurredAt: fixtureT1,
    receivedAt: fixtureT2,
    createdAt: fixtureT2,
    updatedAt: fixtureT2
  });
  const semantic =
    kind === "module_event"
      ? {
          kind: "module_event" as const,
          itemKindId: "module:marketplace:order-status"
        }
      : { kind };

  return {
    tenantId: fixtureTenantId,
    timelineAllocation: fixtureTimelineAllocation("external", item),
    inductionProof: {
      tenantId: fixtureTenantId,
      sourceObject,
      sourceConnection: fixtureSourceConnectionReference,
      sourceAccount: null,
      sourceIdentitySnapshot: {
        tenantId: fixtureTenantId,
        id: fixtureSourceIdentityReference.id,
        realm: {
          realmId: "module:synthetic:source-person",
          version: "v1",
          canonicalizationVersion: "v1"
        },
        objectKindId: "module:synthetic:source-person",
        scope: {
          kind: "source_connection" as const,
          owner: fixtureSourceConnectionReference
        },
        identityDeclaration: {
          adapterContract: fixtureAdapterContract,
          identityKind: "source_external_identity" as const,
          realmId: "module:synthetic:source-person",
          realmVersion: "v1",
          canonicalizationVersion: "v1",
          objectKindId: "module:synthetic:source-person",
          scopeKind: "source_connection" as const,
          decisionStrength: "authoritative" as const
        },
        materializationAuthority: {
          kind: "trusted_service" as const,
          tenantId: fixtureTenantId,
          trustedServiceId: fixtureAdapterContract.loadedByTrustedServiceId,
          authorizationToken: "identity-materialization:source-object-1",
          authorizedAt: fixtureT0
        },
        materializedAt: fixtureT0,
        canonicalExternalSubject: "source-person-1",
        stability: { kind: "stable" as const },
        resolution: { status: "unresolved" as const },
        latestClaimVersion: null,
        revision: "1",
        createdAt: fixtureT0,
        updatedAt: fixtureT0
      },
      identityResolutionAtOccurrence: { state: "unresolved" as const },
      adapterContract: fixtureAdapterContract,
      capabilityId: "module:synthetic:source-object.observe",
      capabilityRevision: "1",
      semantic,
      declaredByTrustedServiceId:
        fixtureAdapterContract.loadedByTrustedServiceId,
      proofToken: "proof:source-object-1",
      occurredAt: fixtureT1,
      receivedAt: fixtureT2,
      recordedAt: fixtureT2,
      revision: "1" as const
    },
    actorParticipantSnapshot: participant,
    claimAtOccurrenceSnapshot: null
  } as z.input<typeof inboxV2SourceObjectTimelineCreationCommitSchema>;
}
