import { describe, expect, it } from "vitest";
import type { z } from "zod";

import {
  INBOX_V2_CLIENT_MERGE_COMMIT_SCHEMA_ID,
  INBOX_V2_CLIENT_MERGE_GRAPH_HEAD_SCHEMA_ID,
  INBOX_V2_CLIENT_MERGE_MAX_REDIRECT_DEPTH,
  INBOX_V2_CLIENT_MERGE_MAX_RESOLUTION_NODES,
  INBOX_V2_CLIENT_MERGE_NODE_STATE_SCHEMA_ID,
  INBOX_V2_CLIENT_MERGE_REDIRECT_SCHEMA_ID,
  INBOX_V2_CLIENT_MERGE_REDIRECT_SCHEMA_VERSION,
  INBOX_V2_CLIENT_MERGE_RESOLUTION_BATCH_MAX,
  INBOX_V2_CORE_CONVERSATION_CLIENT_ROLE_IDS,
  inboxV2CanonicalConversationClientLinkPageSchema,
  inboxV2ClientMergeCommitEnvelopeSchema,
  inboxV2ClientMergeCommitSchema,
  inboxV2ClientMergeGraphHeadEnvelopeSchema,
  inboxV2ClientMergeGraphHeadSchema,
  inboxV2ClientMergeNodeStateEnvelopeSchema,
  inboxV2ClientMergeNodeStateSchema,
  inboxV2ClientMergeRedirectEnvelopeSchema,
  inboxV2ClientMergeRedirectSchema,
  inboxV2ClientMergeResolutionBatchSchema,
  inboxV2ClientMergeResolutionPathSchema,
  inboxV2ClientMergeResolutionStampSchema,
  inboxV2ConversationClientCurrentLinkPageSchema,
  deriveInboxV2ClientMergeCommit,
  resolveInboxV2CanonicalClientReference,
  resolveInboxV2CanonicalConversationClientLinkGroups
} from "../index";

type GraphHeadFixture = z.input<typeof inboxV2ClientMergeGraphHeadSchema>;
type ResolutionStampFixture = z.input<
  typeof inboxV2ClientMergeResolutionStampSchema
>;
type NodeStateFixture = z.input<typeof inboxV2ClientMergeNodeStateSchema>;
type ResolutionPathFixture = z.input<
  typeof inboxV2ClientMergeResolutionPathSchema
>;
type CanonicalNodeFixture = Extract<
  NodeStateFixture,
  { state: "canonical_root" }
>;
type RedirectedNodeFixture = Extract<NodeStateFixture, { state: "redirected" }>;

const tenantId = "tenant:tenant-1";
const otherTenantId = "tenant:tenant-2";
const firstAt = "2026-07-11T09:00:00.000Z";
const secondAt = "2026-07-11T10:00:00.000Z";
const thirdAt = "2026-07-11T11:00:00.000Z";

const trustedServiceId = "core:client-merge-resolver";
const graphHead: GraphHeadFixture = {
  tenantId,
  revision: "2",
  updatedAt: firstAt
};
const resolutionStamp: ResolutionStampFixture = {
  kind: "trusted_service",
  trustedServiceId,
  resolvedAt: secondAt
};
const employeeDecision = {
  actor: {
    kind: "employee",
    employee: {
      tenantId,
      kind: "employee",
      id: "employee:employee-1"
    }
  },
  policyId: "core:reviewed-client-merge",
  policyVersion: "v1",
  reasonCodeId: "core:duplicate-client"
} as const;

function clientReference(name: string, scopedTenantId = tenantId) {
  return {
    tenantId: scopedTenantId,
    kind: "client" as const,
    id: `client:${name}`
  };
}

function redirectReference(name: string, scopedTenantId = tenantId) {
  return {
    tenantId: scopedTenantId,
    kind: "client_merge_redirect" as const,
    id: `client_merge_redirect:${name}`
  };
}

function linkReference(name: string, scopedTenantId = tenantId) {
  return {
    tenantId: scopedTenantId,
    kind: "conversation_client_link" as const,
    id: `conversation_client_link:${name}`
  };
}

function neverMergedRoot(
  name: string,
  overrides: Partial<CanonicalNodeFixture> = {}
): CanonicalNodeFixture {
  return {
    tenantId,
    client: clientReference(name),
    maximumInboundDepth: 0,
    revision: "1",
    updatedAt: firstAt,
    state: "canonical_root" as const,
    nextClient: null,
    redirect: null,
    lastGraphRevision: null,
    ...overrides
  };
}

function mutatedRoot(
  name: string,
  maximumInboundDepth: number,
  lastGraphRevision: string = graphHead.revision,
  overrides: Partial<CanonicalNodeFixture> = {}
): CanonicalNodeFixture {
  return {
    tenantId,
    client: clientReference(name),
    maximumInboundDepth,
    revision: "2",
    updatedAt: firstAt,
    state: "canonical_root" as const,
    nextClient: null,
    redirect: null,
    lastGraphRevision,
    ...overrides
  };
}

function redirectedNode(
  name: string,
  nextName: string,
  maximumInboundDepth: number,
  lastGraphRevision: string = graphHead.revision,
  overrides: Partial<RedirectedNodeFixture> = {}
): RedirectedNodeFixture {
  return {
    tenantId,
    client: clientReference(name),
    maximumInboundDepth,
    revision: "2",
    updatedAt: firstAt,
    state: "redirected" as const,
    nextClient: clientReference(nextName),
    redirect: redirectReference(`${name}-to-${nextName}`),
    lastGraphRevision,
    ...overrides
  };
}

function resolutionPath(input: {
  requested: string;
  canonical: string;
  nodes: NodeStateFixture[];
  head?: GraphHeadFixture | null;
  stamp?: ResolutionStampFixture;
  scopedTenantId?: string;
}): ResolutionPathFixture {
  return {
    tenantId: input.scopedTenantId ?? tenantId,
    graphHead: input.head === undefined ? graphHead : input.head,
    requestedClient: clientReference(
      input.requested,
      input.scopedTenantId ?? tenantId
    ),
    nodes: input.nodes,
    canonicalClient: clientReference(
      input.canonical,
      input.scopedTenantId ?? tenantId
    ),
    resolutionStamp: input.stamp ?? resolutionStamp
  };
}

function rootResolution(
  name: string,
  node: CanonicalNodeFixture,
  head: GraphHeadFixture | null = graphHead,
  stamp: ResolutionStampFixture = resolutionStamp
): ResolutionPathFixture {
  return resolutionPath({
    requested: name,
    canonical: name,
    nodes: [node],
    head,
    stamp
  });
}

function resolutionBatch(
  resolutions: ResolutionPathFixture[],
  head: GraphHeadFixture | null = graphHead,
  stamp: ResolutionStampFixture = resolutionStamp
) {
  return {
    tenantId,
    graphHead: head,
    resolutionStamp: stamp,
    resolutions
  };
}

function baseRedirect(overrides: Record<string, unknown> = {}) {
  const sourceNode = mutatedRoot("source-root", 1);
  const targetNode = mutatedRoot("target-root", 2);

  return {
    tenantId,
    id: "client_merge_redirect:source-to-target",
    sourceRoot: clientReference("source-root"),
    targetRoot: clientReference("target-root"),
    sourceRootVerification: rootResolution("source-root", sourceNode),
    targetRootVerification: rootResolution("target-root", targetNode),
    sourceMaximumInboundDepth: 1,
    targetMaximumInboundDepth: 2,
    resultingMaximumInboundDepth: 2,
    decision: employeeDecision,
    expectedGraphRevision: "2",
    currentGraphRevision: "2",
    resultingGraphRevision: "3",
    createdAt: thirdAt,
    revision: "1",
    ...overrides
  };
}

const conversationReference = {
  tenantId,
  kind: "conversation",
  id: "conversation:conversation-1"
} as const;
const linkDecision = {
  actor: employeeDecision.actor,
  policyId: "core:manual-client-link",
  policyVersion: "v1",
  reasonCodeId: "core:operator-linked-client",
  policyAuthority: null
} as const;

function activeLink(name: string, clientName: string, validFrom: string) {
  return {
    tenantId,
    id: linkReference(name).id,
    conversation: conversationReference,
    client: clientReference(clientName),
    roleIds: [INBOX_V2_CORE_CONVERSATION_CLIENT_ROLE_IDS.subject],
    associationConfidence: "confirmed" as const,
    provenance: { kind: "manual" as const },
    auditEvidenceReferences: [],
    linkedBy: linkDecision,
    validFrom,
    validFromBasis: "known_effective" as const,
    state: "active" as const,
    termination: null,
    revision: "1"
  };
}

const linkA = activeLink("link-a", "client-a", firstAt);
const linkB = activeLink("link-b", "client-b", secondAt);
const linkAReference = linkReference("link-a");
const linkBReference = linkReference("link-b");
const currentLinkPage = {
  conversation: conversationReference,
  linkSetHead: {
    tenantId,
    conversation: conversationReference,
    primaryLink: linkAReference,
    revision: "2",
    updatedAt: secondAt
  },
  linkSetRevision: "2",
  links: [linkA, linkB]
} as const;

function aToBResolutionBatch() {
  const head: GraphHeadFixture = {
    tenantId,
    revision: "1",
    updatedAt: firstAt
  };
  const stamp: ResolutionStampFixture = {
    ...resolutionStamp,
    resolvedAt: secondAt
  };
  const nodeA = redirectedNode("client-a", "client-b", 0, "1");
  const nodeB = mutatedRoot("client-b", 1, "1");
  const resolutionA = resolutionPath({
    requested: "client-a",
    canonical: "client-b",
    nodes: [nodeA, nodeB],
    head,
    stamp
  });
  const resolutionB = resolutionPath({
    requested: "client-b",
    canonical: "client-b",
    nodes: [nodeB],
    head,
    stamp
  });

  return resolutionBatch([resolutionA, resolutionB], head, stamp);
}

describe("Inbox V2 Client merge resolution contracts", () => {
  it("resolves an initial nullable-head root and a never-merged root under a non-null head", () => {
    const initial = resolutionPath({
      requested: "initial-root",
      canonical: "initial-root",
      nodes: [neverMergedRoot("initial-root")],
      head: null
    });
    const existingGraphRoot = resolutionPath({
      requested: "unrelated-root",
      canonical: "unrelated-root",
      nodes: [neverMergedRoot("unrelated-root")]
    });

    expect(
      inboxV2ClientMergeResolutionPathSchema.safeParse(initial).success
    ).toBe(true);
    expect(
      inboxV2ClientMergeResolutionPathSchema.safeParse(existingGraphRoot)
        .success
    ).toBe(true);
    expect(
      resolveInboxV2CanonicalClientReference({
        resolution: inboxV2ClientMergeResolutionPathSchema.parse(initial)
      })
    ).toEqual(clientReference("initial-root"));
  });

  it("resolves an exact A-to-B-to-C path", () => {
    const path = resolutionPath({
      requested: "path-a",
      canonical: "path-c",
      nodes: [
        redirectedNode("path-a", "path-b", 0, "1"),
        redirectedNode("path-b", "path-c", 1, "2"),
        mutatedRoot("path-c", 2, "2")
      ]
    });

    expect(inboxV2ClientMergeResolutionPathSchema.safeParse(path).success).toBe(
      true
    );
    expect(
      resolveInboxV2CanonicalClientReference({
        resolution: inboxV2ClientMergeResolutionPathSchema.parse(path)
      })
    ).toEqual(clientReference("path-c"));
  });

  it("accepts 65 path nodes and rejects a 66-node 65-edge path", () => {
    expect(INBOX_V2_CLIENT_MERGE_MAX_REDIRECT_DEPTH).toBe(64);
    expect(INBOX_V2_CLIENT_MERGE_MAX_RESOLUTION_NODES).toBe(65);

    const acceptedNodes: NodeStateFixture[] = Array.from(
      { length: INBOX_V2_CLIENT_MERGE_MAX_REDIRECT_DEPTH },
      (_, index) =>
        redirectedNode(
          `depth-${index}`,
          `depth-${index + 1}`,
          index,
          String(index + 1)
        )
    );
    acceptedNodes.push(
      mutatedRoot(
        `depth-${INBOX_V2_CLIENT_MERGE_MAX_REDIRECT_DEPTH}`,
        INBOX_V2_CLIENT_MERGE_MAX_REDIRECT_DEPTH,
        String(INBOX_V2_CLIENT_MERGE_MAX_REDIRECT_DEPTH)
      )
    );
    const acceptedPath = resolutionPath({
      requested: "depth-0",
      canonical: `depth-${INBOX_V2_CLIENT_MERGE_MAX_REDIRECT_DEPTH}`,
      nodes: acceptedNodes,
      head: {
        tenantId,
        revision: String(INBOX_V2_CLIENT_MERGE_MAX_REDIRECT_DEPTH),
        updatedAt: firstAt
      }
    });

    expect(
      inboxV2ClientMergeResolutionPathSchema.safeParse(acceptedPath).success
    ).toBe(true);

    const rejectedNodes: NodeStateFixture[] = Array.from(
      { length: INBOX_V2_CLIENT_MERGE_MAX_RESOLUTION_NODES },
      (_, index) =>
        redirectedNode(
          `too-deep-${index}`,
          `too-deep-${index + 1}`,
          Math.min(index, INBOX_V2_CLIENT_MERGE_MAX_REDIRECT_DEPTH),
          String(index + 1)
        )
    );
    rejectedNodes.push(
      mutatedRoot(
        `too-deep-${INBOX_V2_CLIENT_MERGE_MAX_RESOLUTION_NODES}`,
        INBOX_V2_CLIENT_MERGE_MAX_REDIRECT_DEPTH,
        String(INBOX_V2_CLIENT_MERGE_MAX_RESOLUTION_NODES)
      )
    );

    expect(
      inboxV2ClientMergeResolutionPathSchema.safeParse(
        resolutionPath({
          requested: "too-deep-0",
          canonical: `too-deep-${INBOX_V2_CLIENT_MERGE_MAX_RESOLUTION_NODES}`,
          nodes: rejectedNodes,
          head: {
            tenantId,
            revision: String(INBOX_V2_CLIENT_MERGE_MAX_RESOLUTION_NODES),
            updatedAt: firstAt
          }
        })
      ).success
    ).toBe(false);
  });

  it("rejects terminal, continuity, cycle, tenant, stamp, head, timestamp and depth-induction failures", () => {
    const validPath = resolutionPath({
      requested: "invalid-a",
      canonical: "invalid-c",
      nodes: [
        redirectedNode("invalid-a", "invalid-b", 0, "1"),
        redirectedNode("invalid-b", "invalid-c", 1, "2"),
        mutatedRoot("invalid-c", 2, "2")
      ]
    });
    const validNodes = validPath.nodes;

    const invalidPaths = [
      {
        ...validPath,
        nodes: [
          validNodes[0],
          redirectedNode("invalid-b", "invalid-c", 1, "2")
        ],
        canonicalClient: clientReference("invalid-b")
      },
      {
        ...validPath,
        nodes: [
          redirectedNode("invalid-a", "wrong-next", 0, "1"),
          validNodes[1],
          validNodes[2]
        ]
      },
      {
        ...validPath,
        nodes: [
          redirectedNode("invalid-a", "invalid-b", 0, "1"),
          redirectedNode("invalid-b", "invalid-a", 1, "2"),
          mutatedRoot("invalid-a", 2, "2")
        ],
        canonicalClient: clientReference("invalid-a")
      },
      {
        ...validPath,
        nodes: [
          {
            ...validNodes[0],
            tenantId: otherTenantId
          },
          validNodes[1],
          validNodes[2]
        ]
      },
      {
        ...validPath,
        resolutionStamp: {
          ...resolutionStamp,
          resolvedAt: "2026-07-11T08:59:59.999Z"
        }
      },
      {
        ...validPath,
        nodes: [
          { ...validNodes[0], lastGraphRevision: "3" },
          validNodes[1],
          validNodes[2]
        ]
      },
      {
        ...validPath,
        nodes: [
          validNodes[0],
          validNodes[1],
          { ...validNodes[2], updatedAt: thirdAt }
        ]
      },
      {
        ...validPath,
        nodes: [
          validNodes[0],
          { ...validNodes[1], maximumInboundDepth: 0 },
          validNodes[2]
        ]
      }
    ];

    for (const path of invalidPaths) {
      expect(
        inboxV2ClientMergeResolutionPathSchema.safeParse(path).success
      ).toBe(false);
    }
  });

  it("keeps never-merged and merge-mutated NodeState invariants explicit", () => {
    expect(
      inboxV2ClientMergeNodeStateSchema.safeParse(neverMergedRoot("fresh-root"))
        .success
    ).toBe(true);
    expect(
      inboxV2ClientMergeNodeStateSchema.safeParse(
        mutatedRoot("mutated-root", 1)
      ).success
    ).toBe(true);
    expect(
      inboxV2ClientMergeNodeStateSchema.safeParse(
        redirectedNode("redirect-source", "redirect-target", 0)
      ).success
    ).toBe(true);

    for (const node of [
      neverMergedRoot("fresh-root", {
        maximumInboundDepth: 1,
        revision: "2"
      }),
      mutatedRoot("mutated-zero-depth", 0),
      mutatedRoot("mutated-revision-one", 1, graphHead.revision, {
        revision: "1"
      }),
      redirectedNode("self", "self", 0),
      redirectedNode(
        "depth-64-source",
        "depth-64-target",
        INBOX_V2_CLIENT_MERGE_MAX_REDIRECT_DEPTH
      )
    ]) {
      expect(inboxV2ClientMergeNodeStateSchema.safeParse(node).success).toBe(
        false
      );
    }
  });

  it("requires one exact graph head and trusted stamp across a resolution batch", () => {
    const resolutionA = rootResolution("batch-a", neverMergedRoot("batch-a"));
    const resolutionB = rootResolution("batch-b", neverMergedRoot("batch-b"));
    const batch = resolutionBatch([resolutionA, resolutionB]);

    expect(
      inboxV2ClientMergeResolutionBatchSchema.safeParse(batch).success
    ).toBe(true);
    expect(
      inboxV2ClientMergeResolutionBatchSchema.safeParse({
        ...batch,
        resolutions: [
          resolutionA,
          {
            ...resolutionB,
            graphHead: {
              ...graphHead,
              revision: "1"
            }
          }
        ]
      }).success
    ).toBe(false);
    expect(
      inboxV2ClientMergeResolutionBatchSchema.safeParse({
        ...batch,
        resolutions: [
          resolutionA,
          {
            ...resolutionB,
            resolutionStamp: {
              ...resolutionStamp,
              resolvedAt: thirdAt
            }
          }
        ]
      }).success
    ).toBe(false);
    expect(
      inboxV2ClientMergeResolutionBatchSchema.safeParse({
        ...batch,
        resolutions: [resolutionA, resolutionA]
      }).success
    ).toBe(false);
    expect(
      inboxV2ClientMergeResolutionBatchSchema.safeParse({
        ...batch,
        resolutions: [resolutionA, { ...resolutionB, tenantId: otherTenantId }]
      }).success
    ).toBe(false);
  });

  it("accepts 256 unique requested Clients per batch and rejects 257", () => {
    expect(INBOX_V2_CLIENT_MERGE_RESOLUTION_BATCH_MAX).toBe(256);

    const resolutions = Array.from(
      { length: INBOX_V2_CLIENT_MERGE_RESOLUTION_BATCH_MAX + 1 },
      (_, index) => {
        const name = `batch-limit-${index + 1}`;
        return rootResolution(name, neverMergedRoot(name));
      }
    );

    expect(
      inboxV2ClientMergeResolutionBatchSchema.safeParse(
        resolutionBatch(
          resolutions.slice(0, INBOX_V2_CLIENT_MERGE_RESOLUTION_BATCH_MAX)
        )
      ).success
    ).toBe(true);
    expect(
      inboxV2ClientMergeResolutionBatchSchema.safeParse(
        resolutionBatch(resolutions)
      ).success
    ).toBe(false);
  });

  it("accepts exact requested current one-node roots, including the initial graph merge", () => {
    expect(
      inboxV2ClientMergeRedirectSchema.safeParse(baseRedirect()).success
    ).toBe(true);

    const sourceNode = neverMergedRoot("initial-source");
    const targetNode = neverMergedRoot("initial-target");
    const initialRedirect = baseRedirect({
      id: "client_merge_redirect:initial-source-to-target",
      sourceRoot: clientReference("initial-source"),
      targetRoot: clientReference("initial-target"),
      sourceRootVerification: rootResolution(
        "initial-source",
        sourceNode,
        null
      ),
      targetRootVerification: rootResolution(
        "initial-target",
        targetNode,
        null
      ),
      sourceMaximumInboundDepth: 0,
      targetMaximumInboundDepth: 0,
      resultingMaximumInboundDepth: 1,
      expectedGraphRevision: null,
      currentGraphRevision: null,
      resultingGraphRevision: "1"
    });

    expect(
      inboxV2ClientMergeRedirectSchema.safeParse(initialRedirect).success
    ).toBe(true);
  });

  it("rejects a stale alias root, a same-root merge and detached root verification", () => {
    const redirect = baseRedirect();
    const staleSourceVerification = resolutionPath({
      requested: "source-root",
      canonical: "source-canonical",
      nodes: [
        redirectedNode("source-root", "source-canonical", 0),
        mutatedRoot("source-canonical", 1)
      ]
    });

    expect(
      inboxV2ClientMergeRedirectSchema.safeParse({
        ...redirect,
        sourceRootVerification: staleSourceVerification
      }).success
    ).toBe(false);
    expect(
      inboxV2ClientMergeRedirectSchema.safeParse({
        ...redirect,
        targetRoot: redirect.sourceRoot,
        targetRootVerification: redirect.sourceRootVerification,
        targetMaximumInboundDepth: redirect.sourceMaximumInboundDepth
      }).success
    ).toBe(false);
    expect(
      inboxV2ClientMergeRedirectSchema.safeParse({
        ...redirect,
        sourceRootVerification: {
          ...redirect.sourceRootVerification,
          requestedClient: clientReference("unrelated-root"),
          canonicalClient: clientReference("unrelated-root"),
          nodes: [mutatedRoot("unrelated-root", 1)]
        }
      }).success
    ).toBe(false);
  });

  it("enforces source depth 64 and the exact resulting-depth formula", () => {
    const sourceDepthFive = mutatedRoot("depth-source", 5);
    const targetDepthTwo = mutatedRoot("depth-target", 2);
    const valid = baseRedirect({
      sourceRoot: clientReference("depth-source"),
      targetRoot: clientReference("depth-target"),
      sourceRootVerification: rootResolution("depth-source", sourceDepthFive),
      targetRootVerification: rootResolution("depth-target", targetDepthTwo),
      sourceMaximumInboundDepth: 5,
      targetMaximumInboundDepth: 2,
      resultingMaximumInboundDepth: 6
    });

    expect(inboxV2ClientMergeRedirectSchema.safeParse(valid).success).toBe(
      true
    );
    expect(
      inboxV2ClientMergeRedirectSchema.safeParse({
        ...valid,
        resultingMaximumInboundDepth: 5
      }).success
    ).toBe(false);

    const maximumSource = mutatedRoot(
      "maximum-source",
      INBOX_V2_CLIENT_MERGE_MAX_REDIRECT_DEPTH
    );
    expect(
      inboxV2ClientMergeRedirectSchema.safeParse(
        baseRedirect({
          sourceRoot: clientReference("maximum-source"),
          sourceRootVerification: rootResolution(
            "maximum-source",
            maximumSource
          ),
          sourceMaximumInboundDepth: INBOX_V2_CLIENT_MERGE_MAX_REDIRECT_DEPTH,
          resultingMaximumInboundDepth: INBOX_V2_CLIENT_MERGE_MAX_REDIRECT_DEPTH
        })
      ).success
    ).toBe(false);
  });

  it("supports high graph revisions and rejects stale or skipped CAS", () => {
    const highHead = {
      tenantId,
      revision: "10000",
      updatedAt: firstAt
    } as const;
    const sourceNode = mutatedRoot("high-source", 1, "10000");
    const targetNode = mutatedRoot("high-target", 1, "10000");
    const highRevisionRedirect = baseRedirect({
      sourceRoot: clientReference("high-source"),
      targetRoot: clientReference("high-target"),
      sourceRootVerification: rootResolution(
        "high-source",
        sourceNode,
        highHead
      ),
      targetRootVerification: rootResolution(
        "high-target",
        targetNode,
        highHead
      ),
      sourceMaximumInboundDepth: 1,
      targetMaximumInboundDepth: 1,
      resultingMaximumInboundDepth: 2,
      expectedGraphRevision: "10000",
      currentGraphRevision: "10000",
      resultingGraphRevision: "10001"
    });

    expect(
      inboxV2ClientMergeRedirectSchema.safeParse(highRevisionRedirect).success
    ).toBe(true);
    for (const redirect of [
      { ...highRevisionRedirect, expectedGraphRevision: "9999" },
      { ...highRevisionRedirect, currentGraphRevision: "9999" },
      { ...highRevisionRedirect, resultingGraphRevision: "10002" }
    ]) {
      expect(inboxV2ClientMergeRedirectSchema.safeParse(redirect).success).toBe(
        false
      );
    }
  });

  it("requires an automated merge actor to match the authoritative resolver", () => {
    const automatedDecision = {
      ...employeeDecision,
      actor: {
        kind: "trusted_service",
        trustedServiceId
      }
    } as const;

    expect(
      inboxV2ClientMergeRedirectSchema.safeParse(
        baseRedirect({ decision: automatedDecision })
      ).success
    ).toBe(true);
    expect(
      inboxV2ClientMergeRedirectSchema.safeParse(
        baseRedirect({
          decision: {
            ...automatedDecision,
            actor: {
              ...automatedDecision.actor,
              trustedServiceId: "core:another-resolver"
            }
          }
        })
      ).success
    ).toBe(false);
  });

  it("rejects mismatched head/stamp/depth and merge timestamps", () => {
    const redirect = baseRedirect();

    for (const invalid of [
      {
        ...redirect,
        targetRootVerification: {
          ...redirect.targetRootVerification,
          graphHead: { ...graphHead, revision: "1" }
        }
      },
      {
        ...redirect,
        targetRootVerification: {
          ...redirect.targetRootVerification,
          resolutionStamp: { ...resolutionStamp, resolvedAt: thirdAt }
        }
      },
      { ...redirect, sourceMaximumInboundDepth: 2 },
      { ...redirect, createdAt: firstAt },
      { ...redirect, revision: "2" }
    ]) {
      expect(inboxV2ClientMergeRedirectSchema.safeParse(invalid).success).toBe(
        false
      );
    }
  });

  it("derives the exact atomic merge commit and rejects after-state tampering", () => {
    const redirect = inboxV2ClientMergeRedirectSchema.parse(baseRedirect());
    const commit = deriveInboxV2ClientMergeCommit({ redirect });

    expect(inboxV2ClientMergeCommitSchema.safeParse(commit).success).toBe(true);
    expect(commit.graphHeadBefore).toEqual(graphHead);
    expect(commit.graphHeadAfter).toEqual({
      tenantId,
      revision: "3",
      updatedAt: thirdAt
    });
    expect(commit.sourceNodeAfter).toMatchObject({
      state: "redirected",
      client: redirect.sourceRoot,
      nextClient: redirect.targetRoot,
      redirect: {
        tenantId,
        kind: "client_merge_redirect",
        id: redirect.id
      },
      maximumInboundDepth: 1,
      revision: "3",
      lastGraphRevision: "3",
      updatedAt: thirdAt
    });
    expect(commit.targetNodeAfter).toMatchObject({
      state: "canonical_root",
      client: redirect.targetRoot,
      maximumInboundDepth: 2,
      revision: "3",
      lastGraphRevision: "3",
      updatedAt: thirdAt
    });

    const invalidCommits = [
      {
        ...commit,
        targetNodeAfter: {
          ...commit.targetNodeAfter,
          maximumInboundDepth: 3
        }
      },
      {
        ...commit,
        sourceNodeAfter: { ...commit.sourceNodeAfter, revision: "4" }
      },
      {
        ...commit,
        sourceNodeAfter: {
          ...commit.sourceNodeAfter,
          nextClient: clientReference("wrong-next")
        }
      },
      {
        ...commit,
        sourceNodeAfter: {
          ...commit.sourceNodeAfter,
          redirect: redirectReference("wrong-redirect")
        }
      },
      {
        ...commit,
        graphHeadAfter: { ...commit.graphHeadAfter, updatedAt: secondAt }
      }
    ];

    for (const invalidCommit of invalidCommits) {
      expect(
        inboxV2ClientMergeCommitSchema.safeParse(invalidCommit).success
      ).toBe(false);
    }
  });

  it("coalesces bounded A and B links to B without rewriting historical links", () => {
    const batch = aToBResolutionBatch();
    const historicalSnapshot = JSON.stringify(currentLinkPage.links);
    const page = resolveInboxV2CanonicalConversationClientLinkGroups({
      linkPage:
        inboxV2ConversationClientCurrentLinkPageSchema.parse(currentLinkPage),
      resolutionBatch: inboxV2ClientMergeResolutionBatchSchema.parse(batch)
    });

    expect(page).toEqual({
      tenantId,
      conversation: conversationReference,
      linkSetRevision: "2",
      mergeGraphRevision: "1",
      linkSetPrimaryLink: linkAReference,
      primaryLinkIncluded: true,
      resolutionStamp: batch.resolutionStamp,
      groups: [
        {
          canonicalClient: clientReference("client-b"),
          contributingLinks: [linkAReference, linkBReference],
          primaryLink: linkAReference
        }
      ]
    });
    expect(JSON.stringify(currentLinkPage.links)).toBe(historicalSnapshot);
    expect(linkA.client).toEqual(clientReference("client-a"));
    expect(linkB.client).toEqual(clientReference("client-b"));
  });

  it("requires exactly one bounded resolution for every page Client", () => {
    const batch = aToBResolutionBatch();
    const extraName = "extra-client";
    const extraResolution = rootResolution(
      extraName,
      neverMergedRoot(extraName),
      batch.graphHead,
      batch.resolutionStamp
    );

    expect(() =>
      resolveInboxV2CanonicalConversationClientLinkGroups({
        linkPage:
          inboxV2ConversationClientCurrentLinkPageSchema.parse(currentLinkPage),
        resolutionBatch: inboxV2ClientMergeResolutionBatchSchema.parse({
          ...batch,
          resolutions: batch.resolutions.slice(0, 1)
        })
      })
    ).toThrow(/exactly one resolution/i);
    expect(() =>
      resolveInboxV2CanonicalConversationClientLinkGroups({
        linkPage:
          inboxV2ConversationClientCurrentLinkPageSchema.parse(currentLinkPage),
        resolutionBatch: inboxV2ClientMergeResolutionBatchSchema.parse({
          ...batch,
          resolutions: [...batch.resolutions, extraResolution]
        })
      })
    ).toThrow(/exactly one resolution/i);
  });

  it("distinguishes the global link-set primary from page-local inclusion", () => {
    const batch = aToBResolutionBatch();
    const boundedLinkPage = {
      ...currentLinkPage,
      links: [linkB]
    };
    const boundedBatch = {
      ...batch,
      resolutions: [batch.resolutions[1]]
    };
    const page = resolveInboxV2CanonicalConversationClientLinkGroups({
      linkPage:
        inboxV2ConversationClientCurrentLinkPageSchema.parse(boundedLinkPage),
      resolutionBatch:
        inboxV2ClientMergeResolutionBatchSchema.parse(boundedBatch)
    });

    expect(page.linkSetPrimaryLink).toEqual(linkAReference);
    expect(page.primaryLinkIncluded).toBe(false);
    expect(page.groups).toEqual([
      {
        canonicalClient: clientReference("client-b"),
        contributingLinks: [linkBReference],
        primaryLink: null
      }
    ]);

    expect(() =>
      resolveInboxV2CanonicalConversationClientLinkGroups({
        linkPage: {
          ...boundedLinkPage,
          linkSetHead: {
            ...boundedLinkPage.linkSetHead,
            primaryLink: { ...linkAReference, tenantId: otherTenantId }
          }
        },
        resolutionBatch:
          inboxV2ClientMergeResolutionBatchSchema.parse(boundedBatch)
      })
    ).toThrow();
  });

  it("validates canonical pages independently of the coalescer", () => {
    const batch = aToBResolutionBatch();
    const validPage = {
      tenantId,
      conversation: conversationReference,
      linkSetRevision: "2",
      mergeGraphRevision: "1",
      linkSetPrimaryLink: linkAReference,
      primaryLinkIncluded: true,
      resolutionStamp: batch.resolutionStamp,
      groups: [
        {
          canonicalClient: clientReference("client-b"),
          contributingLinks: [linkAReference, linkBReference],
          primaryLink: linkAReference
        }
      ]
    } as const;

    expect(
      inboxV2CanonicalConversationClientLinkPageSchema.safeParse(validPage)
        .success
    ).toBe(true);
    expect(
      inboxV2CanonicalConversationClientLinkPageSchema.safeParse({
        ...validPage,
        groups: [
          {
            canonicalClient: clientReference("client-b"),
            contributingLinks: [linkAReference],
            primaryLink: linkAReference
          },
          {
            canonicalClient: clientReference("client-c"),
            contributingLinks: [linkAReference],
            primaryLink: null
          }
        ]
      }).success
    ).toBe(false);
    expect(
      inboxV2CanonicalConversationClientLinkPageSchema.safeParse({
        ...validPage,
        groups: [
          {
            canonicalClient: clientReference("client-b"),
            contributingLinks: [linkAReference],
            primaryLink: linkAReference
          },
          {
            canonicalClient: clientReference("client-c"),
            contributingLinks: [linkBReference],
            primaryLink: linkBReference
          }
        ]
      }).success
    ).toBe(false);
    expect(
      inboxV2CanonicalConversationClientLinkPageSchema.safeParse({
        ...validPage,
        groups: [
          {
            canonicalClient: clientReference("client-b"),
            contributingLinks: [linkAReference, linkBReference],
            primaryLink: linkBReference
          }
        ]
      }).success
    ).toBe(false);
    expect(
      inboxV2CanonicalConversationClientLinkPageSchema.safeParse({
        ...validPage,
        primaryLinkIncluded: false
      }).success
    ).toBe(false);
    expect(
      inboxV2CanonicalConversationClientLinkPageSchema.safeParse({
        ...validPage,
        linkSetPrimaryLink: { ...linkAReference, tenantId: otherTenantId }
      }).success
    ).toBe(false);

    const untouchedPage = {
      ...validPage,
      linkSetRevision: null,
      linkSetPrimaryLink: null,
      primaryLinkIncluded: false,
      groups: []
    } as const;
    expect(
      inboxV2CanonicalConversationClientLinkPageSchema.safeParse(untouchedPage)
        .success
    ).toBe(true);
    expect(
      inboxV2CanonicalConversationClientLinkPageSchema.safeParse({
        ...untouchedPage,
        groups: validPage.groups
      }).success
    ).toBe(false);
    expect(
      inboxV2CanonicalConversationClientLinkPageSchema.safeParse({
        ...untouchedPage,
        linkSetPrimaryLink: linkAReference
      }).success
    ).toBe(false);
  });

  it("keeps redirects immutable, strict and free of authority or history rewrites", () => {
    const redirect = baseRedirect();

    for (const input of [
      { ...redirect, revision: "2" },
      { ...redirect, rewriteHistoricalLinks: true },
      { ...redirect, grantsCanonicalClientAuthority: true },
      { ...redirect, permissions: ["client.view"] },
      { ...redirect, outboundRouteId: "outbound_route:route-1" },
      { ...redirect, sourceClient: redirect.sourceRoot },
      { ...redirect, canonicalClient: redirect.targetRoot },
      {
        ...redirect,
        decision: {
          ...redirect.decision,
          permissions: ["client.link.manage"]
        }
      }
    ]) {
      expect(inboxV2ClientMergeRedirectSchema.safeParse(input).success).toBe(
        false
      );
    }

    expect(
      inboxV2ClientMergeRedirectSchema.safeParse({
        ...redirect,
        sourceRoot: { ...redirect.sourceRoot, tenantId: otherTenantId }
      }).success
    ).toBe(false);
    expect(
      inboxV2ClientMergeRedirectSchema.safeParse({
        ...redirect,
        decision: {
          ...redirect.decision,
          actor: {
            kind: "employee",
            employee: {
              ...employeeDecision.actor.employee,
              tenantId: otherTenantId
            }
          }
        }
      }).success
    ).toBe(false);
  });

  it("binds redirect, head, NodeState and commit to exact envelopes", () => {
    const redirect = inboxV2ClientMergeRedirectSchema.parse(baseRedirect());
    const commit = deriveInboxV2ClientMergeCommit({ redirect });
    const fixtures = [
      [
        inboxV2ClientMergeRedirectEnvelopeSchema,
        INBOX_V2_CLIENT_MERGE_REDIRECT_SCHEMA_ID,
        redirect
      ],
      [
        inboxV2ClientMergeGraphHeadEnvelopeSchema,
        INBOX_V2_CLIENT_MERGE_GRAPH_HEAD_SCHEMA_ID,
        graphHead
      ],
      [
        inboxV2ClientMergeNodeStateEnvelopeSchema,
        INBOX_V2_CLIENT_MERGE_NODE_STATE_SCHEMA_ID,
        mutatedRoot("envelope-root", 1)
      ],
      [
        inboxV2ClientMergeCommitEnvelopeSchema,
        INBOX_V2_CLIENT_MERGE_COMMIT_SCHEMA_ID,
        commit
      ]
    ] as const;

    for (const [schema, schemaId, payload] of fixtures) {
      const envelope = {
        schemaId,
        schemaVersion: INBOX_V2_CLIENT_MERGE_REDIRECT_SCHEMA_VERSION,
        payload
      };

      expect(schema.safeParse(envelope).success).toBe(true);
      expect(
        schema.safeParse({ ...envelope, schemaVersion: "v2" }).success
      ).toBe(false);
      expect(schema.safeParse({ ...envelope, futureField: true }).success).toBe(
        false
      );
      expect(
        schema.safeParse({
          ...envelope,
          payload: { ...payload, futureField: true }
        }).success
      ).toBe(false);
    }
  });
});
