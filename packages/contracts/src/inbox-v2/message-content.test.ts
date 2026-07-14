import { describe, expect, it } from "vitest";

import {
  INBOX_V2_TIMELINE_CONTENT_SCHEMA_ID,
  inboxV2MessageContentBlockSchema,
  inboxV2TimelineContentDraftSchema,
  inboxV2TimelineContentEnvelopeSchema,
  inboxV2TimelineContentHeadOf,
  inboxV2TimelineContentSchema,
  inboxV2TimelineContentTransitionCommitSchema
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
      file: fixtureReference("file", "file:file-1")
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

  it("keeps File and occurrence references tenant-scoped", () => {
    const crossTenant = fixtureContent({
      state: {
        kind: "available",
        blocks: [
          {
            blockKey: "image-1",
            kind: "image",
            attachment: {
              state: "ready",
              attachment: fixtureReference(
                "message_attachment",
                "message_attachment:image-1"
              ),
              file: fixtureReference(
                "file",
                "file:file-1",
                fixtureOtherTenantId
              )
            },
            displayName: null
          }
        ],
        contentDigestSha256: "b".repeat(64)
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
    const after = fixtureContent({
      state: {
        kind: "available",
        blocks: [
          {
            blockKey: "body-1",
            kind: "text",
            role: "body",
            text: "Edited",
            language: "en"
          }
        ],
        contentDigestSha256: "e".repeat(64)
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
    const before = fixtureContent({
      state: {
        kind: "available",
        blocks: [
          {
            blockKey: "image-1",
            kind: "image",
            attachment: pendingAttachment,
            displayName: "photo.jpg"
          }
        ],
        contentDigestSha256: "a".repeat(64)
      }
    });
    const after = fixtureContent({
      state: {
        kind: "available",
        blocks: [
          {
            blockKey: "image-1",
            kind: "image",
            attachment: readyAttachment,
            displayName: "photo.jpg"
          }
        ],
        contentDigestSha256: "b".repeat(64)
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
