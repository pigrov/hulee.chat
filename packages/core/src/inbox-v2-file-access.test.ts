import { describe, expect, it } from "vitest";

import {
  evaluateInboxV2FileParentDetach,
  evaluateInboxV2FileUpload,
  evaluateInboxV2FileView,
  type InboxV2FileAccessSnapshot,
  type InboxV2FileObjectPin
} from "./inbox-v2-file-access";

const pin: InboxV2FileObjectPin = {
  tenantId: "tenant:one",
  fileId: "file:one",
  fileRevision: "3",
  fileVersionId: "file_version:one",
  objectVersionId: "file_object_version:one"
};

function snapshot(
  overrides: Partial<InboxV2FileAccessSnapshot> = {},
  authorizationAction: InboxV2FileAccessSnapshot["authorizationAction"] = "view"
): InboxV2FileAccessSnapshot {
  return {
    pin,
    authorizationAction,
    objectState: "ready",
    retentionState: "available",
    activeHoldIds: [],
    retainedPurposeIds: [],
    parentSet: {
      revision: "5",
      completeness: "complete",
      completenessRevision: "5",
      liveParentCount: 1
    },
    parentLinks: [
      {
        tenantId: pin.tenantId,
        linkId: "file_parent_link:visible",
        linkRevision: "5",
        fileVersionId: pin.fileVersionId,
        objectVersionId: pin.objectVersionId,
        parentKind: "message",
        parentId: "message:one",
        parentRevision: "7",
        contentRevision: "4",
        blockKey: "image-1",
        visibility: "external",
        state: "live",
        current: true,
        permission: "allowed"
      }
    ],
    ...overrides
  };
}

describe("Inbox V2 file access", () => {
  it("authorizes one exact object version through one current live parent", () => {
    expect(
      evaluateInboxV2FileView({
        tenantId: pin.tenantId,
        pin,
        parentLinkId: "file_parent_link:visible",
        snapshot: snapshot()
      })
    ).toEqual({
      outcome: "allowed",
      fence: {
        pin,
        parentLinkId: "file_parent_link:visible",
        parentLinkRevision: "5",
        parentId: "message:one",
        parentRevision: "7",
        contentRevision: "4",
        blockKey: "image-1"
      }
    });
  });

  it("authorizes an immutable upload only through its current staging parent", () => {
    const uploadParent = {
      ...snapshot().parentLinks[0]!,
      linkId: "file_parent_link:upload",
      parentKind: "upload_staging" as const,
      parentId: "message_attachment:upload"
    };
    expect(
      evaluateInboxV2FileUpload({
        tenantId: pin.tenantId,
        pin,
        parentLinkId: uploadParent.linkId,
        snapshot: snapshot(
          {
            objectState: "staging",
            parentLinks: [uploadParent]
          },
          "upload"
        )
      })
    ).toMatchObject({
      outcome: "allowed",
      fence: { parentLinkId: uploadParent.linkId, pin }
    });
  });

  it("does not let an upload decision overwrite ready data or use a message parent", () => {
    expect(
      evaluateInboxV2FileUpload({
        tenantId: pin.tenantId,
        pin,
        parentLinkId: "file_parent_link:visible",
        snapshot: snapshot({}, "upload")
      })
    ).toEqual({ outcome: "denied", code: "object_unavailable" });

    expect(
      evaluateInboxV2FileUpload({
        tenantId: pin.tenantId,
        pin,
        parentLinkId: "file_parent_link:visible",
        snapshot: snapshot({ objectState: "staging" }, "upload")
      })
    ).toEqual({ outcome: "denied", code: "upload_parent_required" });
  });

  it.each([
    [
      "quarantined object",
      { objectState: "quarantined" },
      "object_unavailable"
    ],
    [
      "expired retention",
      { retentionState: "expired" },
      "retention_unavailable"
    ],
    [
      "detached parent",
      {
        parentLinks: [
          { ...snapshot().parentLinks[0]!, state: "detached" as const }
        ]
      },
      "parent_not_live"
    ],
    [
      "stale parent",
      { parentLinks: [{ ...snapshot().parentLinks[0]!, current: false }] },
      "parent_stale"
    ],
    [
      "hidden parent",
      {
        parentLinks: [
          {
            ...snapshot().parentLinks[0]!,
            permission: "denied" as const
          }
        ]
      },
      "parent_forbidden"
    ]
  ] as const)("fails closed for %s", (_label, override, code) => {
    expect(
      evaluateInboxV2FileView({
        tenantId: pin.tenantId,
        pin,
        parentLinkId: "file_parent_link:visible",
        snapshot: snapshot(override)
      })
    ).toEqual({ outcome: "denied", code });
  });

  it("does not let a hidden sibling grant or block an exact visible parent", () => {
    const hiddenSibling = {
      ...snapshot().parentLinks[0]!,
      linkId: "file_parent_link:hidden",
      parentId: "staff_note:hidden",
      visibility: "staff_only" as const,
      permission: "denied" as const
    };

    expect(
      evaluateInboxV2FileView({
        tenantId: pin.tenantId,
        pin,
        parentLinkId: "file_parent_link:visible",
        snapshot: snapshot({
          parentLinks: [...snapshot().parentLinks, hiddenSibling]
        })
      }).outcome
    ).toBe("allowed");
  });

  it("detaches only one parent while a shared parent or purpose is live", () => {
    const sibling = {
      ...snapshot().parentLinks[0]!,
      linkId: "file_parent_link:sibling",
      parentId: "message:two"
    };
    expect(
      evaluateInboxV2FileParentDetach({
        tenantId: pin.tenantId,
        pin,
        parentLinkId: "file_parent_link:visible",
        snapshot: snapshot(
          {
            parentLinks: [...snapshot().parentLinks, sibling],
            parentSet: {
              ...snapshot().parentSet,
              liveParentCount: 2
            },
            retainedPurposeIds: ["purpose:legal-export"]
          },
          "detach"
        )
      })
    ).toMatchObject({
      outcome: "allowed",
      storageDisposition: "detach_only",
      blockingParentLinkIds: ["file_parent_link:sibling"],
      blockingPurposeIds: ["purpose:legal-export"]
    });
  });

  it("marks only the final unheld/unpurposed version as a delete candidate", () => {
    expect(
      evaluateInboxV2FileParentDetach({
        tenantId: pin.tenantId,
        pin,
        parentLinkId: "file_parent_link:visible",
        snapshot: snapshot({}, "detach")
      })
    ).toMatchObject({
      outcome: "allowed",
      storageDisposition: "physical_delete_candidate",
      parentSetFence: {
        revision: "5",
        completeness: "complete",
        completenessRevision: "5",
        liveParentCount: 1
      }
    });
  });

  it.each([
    ["reconciling parent set", { completeness: "reconciling" as const }],
    ["stale parent count", { liveParentCount: 2 }]
  ])("never proposes physical deletion for a %s", (_label, parentSet) => {
    expect(
      evaluateInboxV2FileParentDetach({
        tenantId: pin.tenantId,
        pin,
        parentLinkId: "file_parent_link:visible",
        snapshot: snapshot(
          {
            parentSet: { ...snapshot().parentSet, ...parentSet }
          },
          "detach"
        )
      })
    ).toMatchObject({
      outcome: "allowed",
      storageDisposition: "detach_only"
    });
  });

  it("detaches the logical parent under hold but retains physical bytes", () => {
    const held = snapshot({ activeHoldIds: ["hold:one"] }, "detach");
    expect(
      evaluateInboxV2FileView({
        tenantId: pin.tenantId,
        pin,
        parentLinkId: "file_parent_link:visible",
        snapshot: { ...held, authorizationAction: "view" }
      }).outcome
    ).toBe("allowed");
    expect(
      evaluateInboxV2FileParentDetach({
        tenantId: pin.tenantId,
        pin,
        parentLinkId: "file_parent_link:visible",
        snapshot: held
      })
    ).toMatchObject({
      outcome: "allowed",
      storageDisposition: "detach_only",
      blockingHoldIds: ["hold:one"]
    });
  });

  it("never treats a hold as read authority for a forbidden parent", () => {
    const heldAndForbidden = snapshot({
      activeHoldIds: ["hold:one"],
      parentLinks: [
        { ...snapshot().parentLinks[0]!, permission: "denied" as const }
      ]
    });

    expect(
      evaluateInboxV2FileView({
        tenantId: pin.tenantId,
        pin,
        parentLinkId: "file_parent_link:visible",
        snapshot: heldAndForbidden
      })
    ).toEqual({ outcome: "denied", code: "parent_forbidden" });
  });

  it("does not let a view-authorized snapshot approve upload or detach", () => {
    const viewSnapshot = snapshot();

    expect(
      evaluateInboxV2FileParentDetach({
        tenantId: pin.tenantId,
        pin,
        parentLinkId: "file_parent_link:visible",
        snapshot: viewSnapshot
      })
    ).toEqual({
      outcome: "denied",
      code: "authorization_action_mismatch"
    });
    expect(
      evaluateInboxV2FileUpload({
        tenantId: pin.tenantId,
        pin,
        parentLinkId: "file_parent_link:visible",
        snapshot: { ...viewSnapshot, objectState: "staging" }
      })
    ).toEqual({
      outcome: "denied",
      code: "authorization_action_mismatch"
    });
  });

  it("rejects a sibling object-version substitution", () => {
    expect(
      evaluateInboxV2FileView({
        tenantId: pin.tenantId,
        pin,
        parentLinkId: "file_parent_link:visible",
        snapshot: snapshot({
          parentLinks: [
            {
              ...snapshot().parentLinks[0]!,
              objectVersionId: "file_object_version:forged"
            }
          ]
        })
      })
    ).toEqual({ outcome: "denied", code: "pin_mismatch" });
  });
});
