import { describe, expect, it } from "vitest";

import {
  INBOX_V2_TIMELINE_CONTENT_SCHEMA_ID,
  calculateInboxV2MessageContentDigest,
  inboxV2MessageContentBlockSchema,
  inboxV2TimelineContentDraftSchema,
  inboxV2TimelineContentEnvelopeSchema,
  inboxV2TimelineContentHeadOf,
  inboxV2TimelineContentSchema,
  inboxV2TimelineContentTransitionCommitSchema,
  verifyInboxV2MessageContentDigest
} from "./message-content";
import {
  fixtureContent,
  fixtureOtherTenantId,
  fixtureReference,
  fixtureSourceOccurrenceReference,
  fixtureT2,
  fixtureT3,
  fixtureTenantId
} from "./timeline-message-fixtures.type-fixture";

function attachment(state: "pending" | "ready" | "failed" | "quarantined") {
  const base = {
    attachment: fixtureReference(
      "message_attachment",
      `message_attachment:${state}-1`
    )
  };
  if (state === "ready") {
    return {
      state,
      ...base,
      file: fixtureReference("file", "file:file-1"),
      fileRevision: "1",
      fileVersion: fixtureReference("file_version", "file_version:file-1-r1"),
      objectVersion: fixtureReference(
        "file_object_version",
        "file_object_version:file-1-r1-v1"
      )
    };
  }
  if (state === "failed" || state === "quarantined") {
    return { state, ...base, reasonId: `core:${state}` };
  }
  return { state, ...base };
}

describe("Inbox V2 message content contracts", () => {
  it("supports the closed provider-neutral block families", () => {
    const fixtures = [
      {
        blockKey: "text-1",
        kind: "text",
        role: "body",
        text: "hello",
        language: "en"
      },
      {
        blockKey: "image-1",
        kind: "image",
        attachment: attachment("ready"),
        displayName: "photo.jpg"
      },
      {
        blockKey: "voice-1",
        kind: "audio",
        semantic: "voice",
        attachment: attachment("pending")
      },
      {
        blockKey: "video-note-1",
        kind: "video",
        semantic: "video_note",
        attachment: attachment("failed")
      },
      {
        blockKey: "file-1",
        kind: "file",
        attachment: attachment("quarantined"),
        displayName: "document.pdf"
      },
      {
        blockKey: "sticker-1",
        kind: "sticker",
        attachment: attachment("ready"),
        displayName: null
      },
      {
        blockKey: "location-1",
        kind: "location",
        latitude: 55.7558,
        longitude: 37.6173,
        accuracyMeters: 10,
        mode: "static",
        liveUntil: null,
        headingDegrees: null,
        label: "Office",
        address: null
      },
      {
        blockKey: "contact-1",
        kind: "contact",
        displayName: "Customer",
        organization: null,
        values: [{ kind: "phone", value: "+79990000000", label: "mobile" }]
      },
      {
        blockKey: "unsupported-1",
        kind: "unsupported_source_content",
        sourceOccurrence: fixtureSourceOccurrenceReference,
        providerContentKindId: "module:synthetic:unknown-share",
        safeFallbackReasonId: "core:unsupported-inbound"
      },
      {
        blockKey: "extension-1",
        kind: "extension",
        blockKindId: "module:voice:waveform",
        payloadSchemaId: "module:voice:waveform-payload",
        payloadSchemaVersion: "v1",
        payloadFile: fixtureReference("file", "file:waveform-1"),
        payloadPin: {
          state: "exact",
          fileRevision: "1",
          fileVersion: fixtureReference(
            "file_version",
            "file_version:waveform-1-r1"
          ),
          objectVersion: fixtureReference(
            "file_object_version",
            "file_object_version:waveform-1-r1-v1"
          )
        },
        payloadDigestSha256: "d".repeat(64),
        rendererId: "module:voice:waveform-renderer"
      }
    ];

    for (const block of fixtures) {
      expect(inboxV2MessageContentBlockSchema.safeParse(block).success).toBe(
        true
      );
    }
    expect(
      inboxV2MessageContentBlockSchema.safeParse({
        blockKey: "raw-1",
        kind: "telegram_voice",
        payload: { raw: true }
      }).success
    ).toBe(false);
  });

  it("accepts media-only content and rejects duplicate ordered block keys", () => {
    const mediaOnly = {
      blocks: [
        {
          blockKey: "image-1",
          kind: "image",
          attachment: attachment("pending"),
          displayName: null
        }
      ]
    };
    expect(inboxV2TimelineContentDraftSchema.safeParse(mediaOnly).success).toBe(
      true
    );
    expect(
      inboxV2TimelineContentDraftSchema.safeParse({
        blocks: [mediaOnly.blocks[0], mediaOnly.blocks[0]]
      }).success
    ).toBe(false);
    expect(
      inboxV2TimelineContentDraftSchema.safeParse({ blocks: [] }).success
    ).toBe(false);
  });

  it("rejects one attachment identity reused by multiple content blocks", () => {
    const sharedAttachment = attachment("pending");
    const blocks = [
      {
        blockKey: "image-1",
        kind: "image" as const,
        attachment: sharedAttachment,
        displayName: null
      },
      {
        blockKey: "file-1",
        kind: "file" as const,
        attachment: sharedAttachment,
        displayName: "same-bytes.bin"
      }
    ];

    expect(
      inboxV2TimelineContentDraftSchema.safeParse({ blocks }).success
    ).toBe(false);
    expect(
      inboxV2TimelineContentSchema.safeParse(
        fixtureContent({
          state: {
            kind: "available",
            blocks,
            contentDigestSha256: calculateInboxV2MessageContentDigest(blocks)
          }
        })
      ).success
    ).toBe(false);
  });

  it("verifies the ordered content digest in its own canonical hash domain", () => {
    const blocks = [
      {
        blockKey: "body-1",
        kind: "text" as const,
        role: "body" as const,
        text: "Digest me",
        language: "en"
      }
    ];
    const digest = calculateInboxV2MessageContentDigest(blocks);
    expect(verifyInboxV2MessageContentDigest(blocks, digest)).toBe(true);
    expect(verifyInboxV2MessageContentDigest(blocks, "0".repeat(64))).toBe(
      false
    );
    expect(
      inboxV2TimelineContentSchema.safeParse(
        fixtureContent({
          state: {
            kind: "available",
            blocks,
            contentDigestSha256: "0".repeat(64)
          }
        })
      ).success
    ).toBe(false);
  });

  it("parses legacy unpinned attachments only as N-1 stored content", () => {
    const blocks = [
      {
        blockKey: "legacy-file-1",
        kind: "file" as const,
        attachment: {
          state: "legacy_unpinned" as const,
          attachment: fixtureReference(
            "message_attachment",
            "message_attachment:legacy-file-1"
          ),
          file: fixtureReference("file", "file:legacy-file-1")
        },
        displayName: "legacy.pdf"
      }
    ];
    expect(
      inboxV2TimelineContentSchema.safeParse(
        fixtureContent({
          state: {
            kind: "available",
            blocks,
            contentDigestSha256: calculateInboxV2MessageContentDigest(blocks)
          }
        })
      ).success
    ).toBe(true);
    expect(
      inboxV2TimelineContentDraftSchema.safeParse({ blocks }).success
    ).toBe(false);
  });

  it("keeps File and occurrence references tenant-scoped", () => {
    const blocks = [
      {
        blockKey: "image-1",
        kind: "image" as const,
        attachment: {
          state: "ready" as const,
          attachment: fixtureReference(
            "message_attachment",
            "message_attachment:image-1"
          ),
          file: fixtureReference("file", "file:file-1", fixtureOtherTenantId),
          fileRevision: "1",
          fileVersion: fixtureReference(
            "file_version",
            "file_version:file-1-r1",
            fixtureOtherTenantId
          ),
          objectVersion: fixtureReference(
            "file_object_version",
            "file_object_version:file-1-r1-v1",
            fixtureOtherTenantId
          )
        },
        displayName: null
      }
    ];
    const crossTenant = fixtureContent({
      state: {
        kind: "available",
        blocks,
        contentDigestSha256: calculateInboxV2MessageContentDigest(blocks)
      }
    });
    expect(inboxV2TimelineContentSchema.safeParse(crossTenant).success).toBe(
      false
    );
  });

  it("validates live-location semantics without reducing it to text", () => {
    const live = {
      blockKey: "location-1",
      kind: "location",
      latitude: 55,
      longitude: 37,
      accuracyMeters: null,
      mode: "live",
      liveUntil: fixtureT3,
      headingDegrees: 90,
      label: null,
      address: null
    };
    expect(inboxV2MessageContentBlockSchema.safeParse(live).success).toBe(true);
    expect(
      inboxV2MessageContentBlockSchema.safeParse({ ...live, liveUntil: null })
        .success
    ).toBe(false);
  });

  it("keeps privacy and retention tombstones as distinct content states", () => {
    const privacy = fixtureContent({
      state: {
        kind: "privacy_erased",
        tombstoneEvent: fixtureReference("event", "event:privacy-1"),
        reasonId: "core:approved-erasure",
        erasedAt: fixtureT3
      },
      revision: "2",
      updatedAt: fixtureT3
    });
    const retention = fixtureContent({
      state: {
        kind: "retention_purged",
        tombstoneEvent: fixtureReference("event", "event:retention-1"),
        policyId: "core:message-content-retention",
        policyVersion: "v1",
        policyRevision: "4",
        purgedAt: fixtureT3
      },
      revision: "2",
      updatedAt: fixtureT3
    });
    expect(inboxV2TimelineContentSchema.safeParse(privacy).success).toBe(true);
    expect(inboxV2TimelineContentSchema.safeParse(retention).success).toBe(
      true
    );
    expect(inboxV2TimelineContentHeadOf(privacy as never).stateKind).toBe(
      "privacy_erased"
    );
    expect(inboxV2TimelineContentHeadOf(retention as never).stateKind).toBe(
      "retention_purged"
    );
  });

  it("applies content edit/erasure/purge through contiguous CAS", () => {
    const before = fixtureContent();
    const afterBlocks = [
      {
        blockKey: "body-1",
        kind: "text" as const,
        role: "body" as const,
        text: "Edited",
        language: "en"
      }
    ];
    const after = fixtureContent({
      state: {
        kind: "available",
        blocks: afterBlocks,
        contentDigestSha256: calculateInboxV2MessageContentDigest(afterBlocks)
      },
      revision: "2",
      updatedAt: fixtureT3
    });
    const commit = {
      tenantId: fixtureTenantId,
      before,
      transition: {
        kind: "edit",
        expectedRevision: "1",
        resultingRevision: "2",
        event: fixtureReference("event", "event:content-edit-1"),
        occurredAt: fixtureT3
      },
      after
    };
    expect(
      inboxV2TimelineContentTransitionCommitSchema.safeParse(commit).success
    ).toBe(true);
    expect(
      inboxV2TimelineContentTransitionCommitSchema.safeParse({
        ...commit,
        after: { ...after, state: before.state }
      }).success
    ).toBe(false);
    expect(
      inboxV2TimelineContentTransitionCommitSchema.safeParse({
        ...commit,
        transition: { ...commit.transition, resultingRevision: "3" }
      }).success
    ).toBe(false);
  });

  it("separates attachment materialization from semantic content edits", () => {
    const pendingAttachment = attachment("pending");
    const readyAttachment = {
      ...attachment("ready"),
      attachment: pendingAttachment.attachment
    };
    const beforeBlocks = [
      {
        blockKey: "image-1",
        kind: "image" as const,
        attachment: pendingAttachment,
        displayName: "photo.jpg"
      }
    ];
    const afterBlocks = [
      {
        blockKey: "image-1",
        kind: "image" as const,
        attachment: readyAttachment,
        displayName: "photo.jpg"
      }
    ];
    const before = fixtureContent({
      state: {
        kind: "available",
        blocks: beforeBlocks,
        contentDigestSha256: calculateInboxV2MessageContentDigest(beforeBlocks)
      }
    });
    const after = fixtureContent({
      state: {
        kind: "available",
        blocks: afterBlocks,
        contentDigestSha256: calculateInboxV2MessageContentDigest(afterBlocks)
      },
      revision: "2",
      updatedAt: fixtureT3
    });
    const commit = {
      tenantId: fixtureTenantId,
      before,
      transition: {
        kind: "attachment_materialization",
        expectedRevision: "1",
        resultingRevision: "2",
        event: fixtureReference("event", "event:attachment-ready-1"),
        occurredAt: fixtureT3
      },
      after
    };
    expect(
      inboxV2TimelineContentTransitionCommitSchema.safeParse(commit).success
    ).toBe(true);
    expect(
      inboxV2TimelineContentTransitionCommitSchema.safeParse({
        ...commit,
        transition: { ...commit.transition, kind: "edit" }
      }).success
    ).toBe(false);
    expect(
      inboxV2TimelineContentTransitionCommitSchema.safeParse({
        ...commit,
        after: {
          ...after,
          state: {
            ...after.state,
            blocks: [
              {
                ...after.state.blocks[0],
                displayName: "renamed.jpg"
              }
            ]
          }
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2TimelineContentTransitionCommitSchema.safeParse({
        ...commit,
        before: after,
        transition: {
          ...commit.transition,
          expectedRevision: "2",
          resultingRevision: "3"
        },
        after: {
          ...after,
          revision: "3",
          state: {
            ...after.state,
            contentDigestSha256: "c".repeat(64)
          }
        }
      }).success
    ).toBe(false);
  });

  it("keeps attachment ownership stable across semantic content edits", () => {
    const pendingAttachment = attachment("pending");
    const beforeBlocks = [
      {
        blockKey: "image-1",
        kind: "image" as const,
        attachment: pendingAttachment,
        displayName: "photo.jpg"
      },
      {
        blockKey: "body-1",
        kind: "text" as const,
        role: "body" as const,
        text: "Before",
        language: "en"
      }
    ];
    const before = fixtureContent({
      state: {
        kind: "available",
        blocks: beforeBlocks,
        contentDigestSha256: calculateInboxV2MessageContentDigest(beforeBlocks)
      }
    });
    const editCommit = (afterBlocks: readonly unknown[]) => ({
      tenantId: fixtureTenantId,
      before,
      transition: {
        kind: "edit",
        expectedRevision: "1",
        resultingRevision: "2",
        event: fixtureReference("event", "event:content-edit-attachment-1"),
        occurredAt: fixtureT3
      },
      after: fixtureContent({
        state: {
          kind: "available",
          blocks: afterBlocks,
          contentDigestSha256: calculateInboxV2MessageContentDigest(
            afterBlocks as never
          )
        },
        revision: "2",
        updatedAt: fixtureT3
      })
    });

    const preservingEdit = [
      { ...beforeBlocks[0], displayName: "renamed-photo.jpg" },
      { ...beforeBlocks[1], text: "After" }
    ];
    expect(
      inboxV2TimelineContentTransitionCommitSchema.safeParse(
        editCommit(preservingEdit)
      ).success
    ).toBe(true);

    const withoutAttachment = [
      { ...beforeBlocks[1], text: "Attachment removed" }
    ];
    expect(
      inboxV2TimelineContentTransitionCommitSchema.safeParse(
        editCommit(withoutAttachment)
      ).success
    ).toBe(false);

    const replacementAttachment = {
      ...pendingAttachment,
      attachment: fixtureReference(
        "message_attachment",
        "message_attachment:replacement-1"
      )
    };
    expect(
      inboxV2TimelineContentTransitionCommitSchema.safeParse(
        editCommit([
          { ...beforeBlocks[0], attachment: replacementAttachment },
          { ...beforeBlocks[1], text: "Attachment replaced" }
        ])
      ).success
    ).toBe(false);

    expect(
      inboxV2TimelineContentTransitionCommitSchema.safeParse(
        editCommit([
          { ...beforeBlocks[0], blockKey: "image-moved" },
          { ...beforeBlocks[1], text: "Attachment moved" }
        ])
      ).success
    ).toBe(false);

    const readyAttachment = {
      ...attachment("ready"),
      attachment: pendingAttachment.attachment
    };
    expect(
      inboxV2TimelineContentTransitionCommitSchema.safeParse(
        editCommit([
          { ...beforeBlocks[0], attachment: readyAttachment },
          { ...beforeBlocks[1], text: "Attachment materialized" }
        ])
      ).success
    ).toBe(false);
  });

  it("materializes exactly one attachment block per content revision", () => {
    const beforeBlocks = ["image-1", "image-2"].map((blockKey) => ({
      blockKey,
      kind: "image" as const,
      attachment: {
        ...attachment("pending"),
        attachment: fixtureReference(
          "message_attachment",
          `message_attachment:${blockKey}`
        )
      },
      displayName: `${blockKey}.jpg`
    }));
    const afterBlocks = beforeBlocks.map((block) => ({
      ...block,
      attachment: {
        ...attachment("ready"),
        attachment: block.attachment.attachment
      }
    }));
    const before = fixtureContent({
      state: {
        kind: "available",
        blocks: beforeBlocks,
        contentDigestSha256: calculateInboxV2MessageContentDigest(beforeBlocks)
      }
    });
    const after = fixtureContent({
      state: {
        kind: "available",
        blocks: afterBlocks,
        contentDigestSha256: calculateInboxV2MessageContentDigest(afterBlocks)
      },
      revision: "2",
      updatedAt: fixtureT3
    });

    expect(
      inboxV2TimelineContentTransitionCommitSchema.safeParse({
        tenantId: fixtureTenantId,
        before,
        transition: {
          kind: "attachment_materialization",
          expectedRevision: "1",
          resultingRevision: "2",
          event: fixtureReference("event", "event:attachment-ready-batch"),
          occurredAt: fixtureT3
        },
        after
      }).success
    ).toBe(false);
  });

  it("exports purgeable content through an exact versioned envelope", () => {
    expect(
      inboxV2TimelineContentEnvelopeSchema.parse({
        schemaId: INBOX_V2_TIMELINE_CONTENT_SCHEMA_ID,
        schemaVersion: "v1",
        payload: fixtureContent()
      }).payload.createdAt
    ).toBe(fixtureT2);
  });
});
