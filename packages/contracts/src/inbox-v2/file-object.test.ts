import { describe, expect, it } from "vitest";

import {
  calculateInboxV2OutboundDispatchContentFingerprint,
  calculateInboxV2OutboundDispatchContentPlanDigest,
  INBOX_V2_OUTBOUND_DISPATCH_CONTENT_FINGERPRINT_PURPOSE_ID,
  inboxV2AttachmentMaterializationClaimSchema,
  inboxV2AttachmentMaterializationEvidenceSchema,
  inboxV2AttachmentMaterializationSchema,
  inboxV2AttachmentMaterializationTransitionSchema,
  inboxV2CurrentAttachmentMaterializationSchema,
  inboxV2ExactFileObjectPinSchema,
  inboxV2FileLineageEdgeSchema,
  inboxV2FileParentLinkHeadSchema,
  inboxV2FileParentLinkSchema,
  inboxV2FileParentSetHeadSchema,
  inboxV2FileVersionSchema,
  inboxV2ObjectOperationEvidenceSchema,
  inboxV2ObjectVersionHeadSchema,
  inboxV2ObjectVersionSchema,
  inboxV2OutboundDispatchContentPlanSchema,
  isInboxV2AttachmentMaterializationTransition,
  type InboxV2OutboundDispatchContentPlanDigestInput
} from "./file-object";

const tenantId = "tenant:tenant-1";
const otherTenantId = "tenant:tenant-2";
const t0 = "2026-07-18T09:00:00.000Z";
const t1 = "2026-07-18T09:01:00.000Z";
const fingerprintValidUntil = "2026-07-19T09:00:00.000Z";
const rawHashA = "a".repeat(64);
const rawHashB = "b".repeat(64);
const hashA = `sha256:${rawHashA}`;

function ref<const TKind extends string>(
  kind: TKind,
  id: string,
  tenant = tenantId
) {
  return { tenantId: tenant, kind, id };
}

const file = ref("file", "file:file-1");
const fileVersion = ref("file_version", "file_version:file-1-v1");
const objectVersion = ref(
  "file_object_version",
  "file_object_version:file-1-v1"
);
const attachment = ref("message_attachment", "message_attachment:attachment-1");
const exactPin = {
  file,
  fileRevision: "7",
  fileVersion,
  objectVersion
};

function objectVersionRecord() {
  return {
    tenantId,
    id: objectVersion.id,
    storageRootId: "core:tenant-object-storage",
    storageLocator: "tenant-1/objects/file-1-v1",
    providerVersionToken: "provider-version-0001",
    versioningMode: "native_version" as const,
    checksumSha256: rawHashA,
    sizeBytes: "4096",
    declaredMediaType: "application/pdf",
    detectedMediaType: "application/pdf",
    encryptionKeyRef: "tenant-key-0001",
    dataClassId: "core:message-content",
    retentionAnchorAt: t0,
    createdAt: t0,
    revision: "1" as const
  };
}

function fileVersionRecord() {
  return {
    tenantId,
    id: fileVersion.id,
    file,
    versionNumber: "1",
    objectVersion,
    createdAt: t0,
    revision: "1" as const
  };
}

function readyMaterialization() {
  return { state: "ready" as const, attachment, ...exactPin };
}

function deletionEvidence() {
  return {
    tenantId,
    id: "object_operation_evidence:delete-1",
    operation: "delete_version" as const,
    objectVersion,
    materializationClaim: null,
    storageRootId: "core:tenant-object-storage",
    attemptToken: "attempt-delete-0001",
    outcome: "succeeded" as const,
    observedVersionCount: 1,
    affectedBytes: "4096",
    reasonId: null,
    deletionEvidenceDigestSha256: rawHashA,
    deletionAuthorization: {
      expectedObjectHeadRevision: "4",
      liveParentCount: "0",
      activePurposeCount: "0",
      activeHoldCount: "0",
      evaluatedAt: t0,
      decisionDigestSha256: rawHashA
    },
    requestedAt: t0,
    completedAt: t1,
    revision: "1" as const
  };
}

function dispatchPlanInput(): InboxV2OutboundDispatchContentPlanDigestInput {
  const timelineContent = ref("timeline_content", "timeline_content:content-1");
  return {
    tenantId,
    id: "outbound_dispatch_content_plan:plan-1",
    dispatch: ref("outbound_dispatch", "outbound_dispatch:dispatch-1"),
    message: ref("message", "message:message-1"),
    messageRevision: "3",
    conversation: ref("conversation", "conversation:conversation-1"),
    timelineItem: ref("timeline_item", "timeline_item:item-1"),
    route: ref("outbound_route", "outbound_route:route-1"),
    timelineContent,
    contentRevision: "2",
    contentFingerprint: calculateInboxV2OutboundDispatchContentFingerprint(
      {
        tenantId,
        timelineContent,
        contentRevision: "2",
        contentDigestSha256: rawHashB
      },
      {
        tenantId,
        purposeId: INBOX_V2_OUTBOUND_DISPATCH_CONTENT_FINGERPRINT_PURPOSE_ID,
        keyGeneration: "outbound-content-key:g1",
        validUntil: fingerprintValidUntil,
        key: new Uint8Array(32).fill(7)
      }
    ),
    binding: ref("source_thread_binding", "source_thread_binding:binding-1"),
    bindingRevision: "5",
    capabilityRevision: "8",
    adapterContract: {
      contractId: "core:direct-messenger-adapter",
      contractVersion: "v1",
      declarationRevision: "4",
      surfaceId: "core:direct-account",
      loadedByTrustedServiceId: "core:outbound-worker",
      loadedAt: t0
    },
    blocks: [
      {
        blockKey: "text-1",
        blockKind: "text",
        exactFileObjectPin: null,
        artifactOrdinal: 1
      },
      {
        blockKey: "file-1",
        blockKind: "file",
        exactFileObjectPin: exactPin,
        artifactOrdinal: 2
      }
    ],
    artifacts: [
      {
        ordinal: 1,
        grouping: "single",
        capabilityId: "core:send-text",
        operationId: "core:send-message",
        blockKeys: ["text-1"]
      },
      {
        ordinal: 2,
        grouping: "split",
        capabilityId: "core:send-file",
        operationId: "core:send-file",
        blockKeys: ["file-1"]
      }
    ],
    createdAt: t0,
    revision: "1"
  };
}

describe("Inbox V2 file/object contracts", () => {
  it("pins an immutable logical file version to one immutable physical object version", () => {
    expect(
      inboxV2ObjectVersionSchema.safeParse(objectVersionRecord()).success
    ).toBe(true);
    expect(
      inboxV2FileVersionSchema.safeParse(fileVersionRecord()).success
    ).toBe(true);
    expect(inboxV2ExactFileObjectPinSchema.safeParse(exactPin).success).toBe(
      true
    );
    expect(
      inboxV2FileVersionSchema.safeParse({
        ...fileVersionRecord(),
        objectVersion: { ...objectVersion, tenantId: otherTenantId }
      }).success
    ).toBe(false);
    expect(
      inboxV2ObjectVersionSchema.safeParse({
        ...objectVersionRecord(),
        id: "object_version:legacy-wrong-kind"
      }).success
    ).toBe(false);
  });

  it("keeps mutable availability in a CAS head and immutable bytes outside it", () => {
    expect(
      inboxV2ObjectVersionHeadSchema.safeParse({
        tenantId,
        objectVersion,
        state: "staging",
        revision: "1",
        lastOperationEvidence: null,
        updatedAt: t0
      }).success
    ).toBe(true);
    expect(
      inboxV2ObjectVersionHeadSchema.safeParse({
        tenantId,
        objectVersion,
        state: "deleted",
        revision: "2",
        lastOperationEvidence: null,
        updatedAt: t1
      }).success
    ).toBe(false);
  });

  it("records a tenant-coherent acyclic original-to-derived edge", () => {
    const edge = {
      tenantId,
      id: "file_derivative_edge:preview-1",
      originalFileVersion: fileVersion,
      derivedFileVersion: ref("file_version", "file_version:file-preview-v1"),
      transformKindId: "core:thumbnail",
      transformProfileId: "core:thumbnail-default",
      transformProfileVersion: "v1",
      createdAt: t1,
      revision: "1"
    };
    expect(inboxV2FileLineageEdgeSchema.safeParse(edge).success).toBe(true);
    expect(
      inboxV2FileLineageEdgeSchema.safeParse({
        ...edge,
        derivedFileVersion: fileVersion
      }).success
    ).toBe(false);
  });

  it("separates exact parent identity from its live/detached CAS state", () => {
    const link = {
      tenantId,
      id: "file_parent_link:message-1-file-1",
      fileVersion,
      objectVersion,
      parent: {
        kind: "message" as const,
        conversation: ref("conversation", "conversation:conversation-1"),
        message: ref("message", "message:message-1"),
        timelineContent: ref("timeline_content", "timeline_content:content-1"),
        contentRevision: "2",
        blockKey: "file-1",
        visibilityBoundary: "external_work" as const
      },
      dataClassId: "core:message-content",
      purposeId: "core:message-attachment",
      retentionAnchorAt: t0,
      createdAt: t1,
      revision: "1"
    };
    expect(inboxV2FileParentLinkSchema.safeParse(link).success).toBe(true);
    expect(
      inboxV2FileParentLinkHeadSchema.safeParse({
        tenantId,
        link: ref("file_parent_link", link.id),
        state: "live",
        revision: "1",
        detachedByEvent: null,
        updatedAt: t0
      }).success
    ).toBe(true);
    expect(
      inboxV2FileParentLinkHeadSchema.safeParse({
        tenantId,
        link: ref("file_parent_link", link.id),
        state: "detached",
        revision: "2",
        detachedByEvent: null,
        updatedAt: t1
      }).success
    ).toBe(false);
  });

  it("requires a complete current parent-set revision before zero-parent decisions", () => {
    const complete = {
      tenantId,
      file,
      revision: "9",
      completeness: "complete" as const,
      completenessRevision: "9",
      liveParentCount: 0,
      updatedAt: t1
    };
    expect(inboxV2FileParentSetHeadSchema.safeParse(complete).success).toBe(
      true
    );
    expect(
      inboxV2FileParentSetHeadSchema.safeParse({
        ...complete,
        completenessRevision: "8"
      }).success
    ).toBe(false);
  });

  it("keeps legacy unpinned state out of current materialization and new writes", () => {
    const legacy = {
      state: "legacy_unpinned" as const,
      attachment,
      file
    };
    expect(
      inboxV2AttachmentMaterializationSchema.safeParse(legacy).success
    ).toBe(true);
    expect(
      inboxV2CurrentAttachmentMaterializationSchema.safeParse(legacy).success
    ).toBe(false);
    expect(inboxV2ExactFileObjectPinSchema.safeParse(exactPin).success).toBe(
      true
    );
  });

  it("allows only pending to reach one terminal materialization state", () => {
    const pending = { state: "pending" as const, attachment };
    const ready = readyMaterialization();
    expect(isInboxV2AttachmentMaterializationTransition(pending, ready)).toBe(
      true
    );
    expect(isInboxV2AttachmentMaterializationTransition(ready, pending)).toBe(
      false
    );
    expect(
      isInboxV2AttachmentMaterializationTransition(ready, {
        state: "failed",
        attachment,
        reasonId: "core:transfer-failed"
      })
    ).toBe(false);
    expect(
      inboxV2AttachmentMaterializationTransitionSchema.safeParse({
        tenantId,
        before: pending,
        after: ready,
        expectedAttachmentRevision: "4",
        resultingAttachmentRevision: "5",
        attempt: ref(
          "attachment_materialization_attempt",
          "attachment_materialization_attempt:attempt-1"
        ),
        evidence: ref(
          "attachment_materialization_evidence",
          "attachment_materialization_evidence:evidence-1"
        ),
        occurredAt: t1
      }).success
    ).toBe(true);
  });

  it("pins claim leases and immutable terminal evidence to contiguous revisions", () => {
    const claim = {
      tenantId,
      id: "attachment_materialization_claim:claim-1",
      attachment,
      expectedAttachmentRevision: "4",
      claimedByTrustedServiceId: "core:file-materializer",
      leaseTokenHash: hashA,
      claimedAt: t0,
      leaseExpiresAt: t1,
      revision: "1"
    };
    expect(
      inboxV2AttachmentMaterializationClaimSchema.safeParse(claim).success
    ).toBe(true);
    const evidence = {
      tenantId,
      id: "attachment_materialization_evidence:evidence-1",
      claim: ref("attachment_materialization_claim", claim.id),
      attempt: ref(
        "attachment_materialization_attempt",
        "attachment_materialization_attempt:attempt-1"
      ),
      attachment,
      expectedAttachmentRevision: "4",
      resultingAttachmentRevision: "5",
      outcome: {
        state: "ready" as const,
        pin: exactPin,
        objectOperationEvidence: ref(
          "object_operation_evidence",
          "object_operation_evidence:put-1"
        )
      },
      completedAt: t1,
      evidenceHash: hashA,
      revision: "1"
    };
    expect(
      inboxV2AttachmentMaterializationEvidenceSchema.safeParse(evidence).success
    ).toBe(true);
    expect(
      inboxV2AttachmentMaterializationEvidenceSchema.safeParse({
        ...evidence,
        resultingAttachmentRevision: "6"
      }).success
    ).toBe(false);
  });

  it("forbids exact-version deletion while any parent, purpose or hold remains", () => {
    const evidence = deletionEvidence();
    expect(
      inboxV2ObjectOperationEvidenceSchema.safeParse(evidence).success
    ).toBe(true);
    for (const count of [
      "liveParentCount",
      "activePurposeCount",
      "activeHoldCount"
    ] as const) {
      expect(
        inboxV2ObjectOperationEvidenceSchema.safeParse({
          ...evidence,
          deletionAuthorization: {
            ...evidence.deletionAuthorization,
            [count]: "1"
          }
        }).success
      ).toBe(false);
    }
    expect(
      inboxV2ObjectOperationEvidenceSchema.safeParse({
        ...evidence,
        storageLocator: "classified/object/key"
      }).success
    ).toBe(false);
    expect(
      inboxV2ObjectOperationEvidenceSchema.safeParse({
        ...evidence,
        deletionEvidenceDigestSha256: rawHashB
      }).success
    ).toBe(false);
  });

  it("binds every retry to one deterministic content and artifact plan", () => {
    const input = dispatchPlanInput();
    const plan = {
      ...input,
      planDigestSha256: calculateInboxV2OutboundDispatchContentPlanDigest(input)
    };
    expect(
      inboxV2OutboundDispatchContentPlanSchema.safeParse(plan).success
    ).toBe(true);
    expect(JSON.stringify(plan)).not.toContain(rawHashB);
    expect(plan.contentFingerprint.hmacSha256).toMatch(
      /^hmac-sha256:[a-f0-9]{64}$/u
    );
    expect(
      inboxV2OutboundDispatchContentPlanSchema.safeParse({
        ...plan,
        messageRevision: "4"
      }).success
    ).toBe(false);
    const extensionWithoutPinInput = {
      ...input,
      blocks: [
        input.blocks[0],
        {
          ...input.blocks[1],
          blockKind: "extension" as const,
          exactFileObjectPin: null
        }
      ]
    };
    expect(
      inboxV2OutboundDispatchContentPlanSchema.safeParse({
        ...extensionWithoutPinInput,
        planDigestSha256: calculateInboxV2OutboundDispatchContentPlanDigest(
          extensionWithoutPinInput
        )
      }).success
    ).toBe(false);
    expect(
      inboxV2OutboundDispatchContentPlanSchema.safeParse({
        ...plan,
        blocks: [
          input.blocks[0],
          { ...input.blocks[1], exactFileObjectPin: null }
        ],
        planDigestSha256: calculateInboxV2OutboundDispatchContentPlanDigest({
          ...input,
          blocks: [
            input.blocks[0],
            { ...input.blocks[1], exactFileObjectPin: null }
          ]
        })
      }).success
    ).toBe(false);
    expect(
      inboxV2OutboundDispatchContentPlanSchema.safeParse({
        ...plan,
        artifacts: [
          { ...input.artifacts[0], blockKeys: ["text-1", "file-1"] },
          input.artifacts[1]
        ]
      }).success
    ).toBe(false);
    expect(
      inboxV2OutboundDispatchContentPlanSchema.safeParse({
        ...plan,
        contentFingerprint: {
          ...plan.contentFingerprint,
          validUntil: plan.createdAt
        },
        planDigestSha256: calculateInboxV2OutboundDispatchContentPlanDigest({
          ...input,
          contentFingerprint: {
            ...input.contentFingerprint,
            validUntil: input.createdAt
          }
        })
      }).success
    ).toBe(false);
    expect(
      inboxV2OutboundDispatchContentPlanSchema.safeParse({
        ...plan,
        contentDigestSha256: rawHashB
      }).success
    ).toBe(false);
  });

  it("domain-separates content fingerprints by tenant and finite key generation", () => {
    const baseInput = {
      tenantId,
      timelineContent: ref("timeline_content", "timeline_content:content-1"),
      contentRevision: "2",
      contentDigestSha256: rawHashB
    };
    const baseProtection = {
      tenantId,
      purposeId: INBOX_V2_OUTBOUND_DISPATCH_CONTENT_FINGERPRINT_PURPOSE_ID,
      keyGeneration: "outbound-content-key:g1",
      validUntil: fingerprintValidUntil,
      key: new Uint8Array(32).fill(7)
    } as const;
    const first = calculateInboxV2OutboundDispatchContentFingerprint(
      baseInput,
      baseProtection
    );
    const nextGeneration = calculateInboxV2OutboundDispatchContentFingerprint(
      baseInput,
      {
        ...baseProtection,
        keyGeneration: "outbound-content-key:g2",
        key: new Uint8Array(32).fill(8)
      }
    );
    const extendedValidity = calculateInboxV2OutboundDispatchContentFingerprint(
      baseInput,
      {
        ...baseProtection,
        validUntil: "2026-08-19T09:00:00.000Z"
      }
    );
    const otherTenant = calculateInboxV2OutboundDispatchContentFingerprint(
      {
        ...baseInput,
        tenantId: otherTenantId,
        timelineContent: ref(
          "timeline_content",
          "timeline_content:content-1",
          otherTenantId
        )
      },
      { ...baseProtection, tenantId: otherTenantId }
    );

    expect(first.hmacSha256).not.toBe(nextGeneration.hmacSha256);
    expect(first.hmacSha256).not.toBe(extendedValidity.hmacSha256);
    expect(first.hmacSha256).not.toBe(otherTenant.hmacSha256);
    expect(first).not.toHaveProperty("key");
    expect(JSON.stringify(first)).not.toContain(rawHashB);
  });
});
