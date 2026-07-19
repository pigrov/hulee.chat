export type InboxV2FileObjectPin = Readonly<{
  tenantId: string;
  fileId: string;
  fileRevision: string;
  fileVersionId: string;
  objectVersionId: string;
}>;

export type InboxV2FileParentKind = "message" | "staff_note" | "upload_staging";

export type InboxV2FileParentVisibility =
  | "external"
  | "internal"
  | "staff_only";

export type InboxV2FileAccessAction = "view" | "upload" | "detach";

export type InboxV2FileParentAccessSnapshot = Readonly<{
  tenantId: string;
  linkId: string;
  linkRevision: string;
  fileVersionId: string;
  objectVersionId: string;
  parentKind: InboxV2FileParentKind;
  parentId: string;
  parentRevision: string;
  contentRevision: string;
  blockKey: string;
  visibility: InboxV2FileParentVisibility;
  state: "live" | "detached";
  current: boolean;
  permission: "allowed" | "denied";
}>;

export type InboxV2FileAccessSnapshot = Readonly<{
  pin: InboxV2FileObjectPin;
  authorizationAction: InboxV2FileAccessAction;
  objectState: "staging" | "ready" | "quarantined" | "deleted";
  retentionState: "available" | "expired" | "deleted";
  activeHoldIds: readonly string[];
  retainedPurposeIds: readonly string[];
  parentSet: Readonly<{
    revision: string;
    completeness: "complete" | "reconciling";
    completenessRevision: string;
    liveParentCount: number;
  }>;
  parentLinks: readonly InboxV2FileParentAccessSnapshot[];
}>;

export type InboxV2FileAccessDenialCode =
  | "tenant_mismatch"
  | "pin_mismatch"
  | "object_unavailable"
  | "retention_unavailable"
  | "parent_not_found"
  | "parent_not_live"
  | "parent_stale"
  | "parent_forbidden"
  | "authorization_action_mismatch"
  | "hold_active";

export type InboxV2FileParentFence = Readonly<{
  pin: InboxV2FileObjectPin;
  parentLinkId: string;
  parentLinkRevision: string;
  parentId: string;
  parentRevision: string;
  contentRevision: string;
  blockKey: string;
}>;

export type InboxV2FileViewDecision =
  | Readonly<{
      outcome: "allowed";
      fence: InboxV2FileParentFence;
    }>
  | Readonly<{
      outcome: "denied";
      code: InboxV2FileAccessDenialCode;
    }>;

export type InboxV2FileDetachDecision =
  | Readonly<{
      outcome: "allowed";
      fence: InboxV2FileParentFence;
      storageDisposition: "detach_only" | "physical_delete_candidate";
      blockingParentLinkIds: readonly string[];
      blockingPurposeIds: readonly string[];
      blockingHoldIds: readonly string[];
      parentSetFence: InboxV2FileAccessSnapshot["parentSet"];
    }>
  | Readonly<{
      outcome: "denied";
      code: InboxV2FileAccessDenialCode;
    }>;

export type InboxV2FileUploadDecision =
  | Readonly<{
      outcome: "allowed";
      fence: InboxV2FileParentFence;
    }>
  | Readonly<{
      outcome: "denied";
      code: InboxV2FileAccessDenialCode | "upload_parent_required";
    }>;

/**
 * Authorizes one immutable upload only while its exact reserved object version
 * is staging and the caller still controls the current upload-staging parent.
 * Storage additionally enforces key-absent conditional put, so this decision
 * cannot be reused to overwrite a ready version.
 */
export function evaluateInboxV2FileUpload(
  input: Readonly<{
    tenantId: string;
    pin: InboxV2FileObjectPin;
    parentLinkId: string;
    snapshot: InboxV2FileAccessSnapshot;
  }>
): InboxV2FileUploadDecision {
  const common = evaluateFileParentAccess(input, "staging", "upload");
  if (common.outcome === "denied") return common;
  if (common.parent.parentKind !== "upload_staging") {
    return { outcome: "denied", code: "upload_parent_required" };
  }
  return {
    outcome: "allowed",
    fence: parentFence(input.snapshot.pin, common.parent)
  };
}

/**
 * Authorizes one exact ready object version through one exact live parent.
 * A hidden sibling parent neither grants nor blocks this read; the caller must
 * name and reauthorize the parent that makes the file visible in its current
 * content revision.
 */
export function evaluateInboxV2FileView(
  input: Readonly<{
    tenantId: string;
    pin: InboxV2FileObjectPin;
    parentLinkId: string;
    snapshot: InboxV2FileAccessSnapshot;
  }>
): InboxV2FileViewDecision {
  const common = evaluateCommonFileAccess(input, "view");
  if (common.outcome === "denied") return common;

  return {
    outcome: "allowed",
    fence: parentFence(input.snapshot.pin, common.parent)
  };
}

/**
 * Plans removal of one parent link. Physical storage deletion is only a
 * candidate when the selected link is the final live parent and no independent
 * purpose or hold retains the object. The actual delete remains a fenced,
 * version-aware storage operation owned by the lifecycle worker.
 */
export function evaluateInboxV2FileParentDetach(
  input: Readonly<{
    tenantId: string;
    pin: InboxV2FileObjectPin;
    parentLinkId: string;
    snapshot: InboxV2FileAccessSnapshot;
  }>
): InboxV2FileDetachDecision {
  const common = evaluateCommonFileAccess(input, "detach");
  if (common.outcome === "denied") return common;

  const blockingParents = input.snapshot.parentLinks
    .filter(
      (parent) =>
        parent.state === "live" && parent.linkId !== common.parent.linkId
    )
    .map((parent) => parent.linkId)
    .sort();
  const blockingPurposes = [...input.snapshot.retainedPurposeIds].sort();
  const blockingHolds = [...input.snapshot.activeHoldIds].sort();
  const observedLiveParentCount = input.snapshot.parentLinks.filter(
    (parent) => parent.state === "live"
  ).length;
  const parentSetAllowsPhysicalDelete =
    input.snapshot.parentSet.completeness === "complete" &&
    input.snapshot.parentSet.liveParentCount === observedLiveParentCount;

  return {
    outcome: "allowed",
    fence: parentFence(input.snapshot.pin, common.parent),
    storageDisposition:
      parentSetAllowsPhysicalDelete &&
      blockingParents.length === 0 &&
      blockingPurposes.length === 0 &&
      blockingHolds.length === 0
        ? "physical_delete_candidate"
        : "detach_only",
    blockingParentLinkIds: blockingParents,
    blockingPurposeIds: blockingPurposes,
    blockingHoldIds: blockingHolds,
    parentSetFence: input.snapshot.parentSet
  };
}

type CommonFileAccessDecision =
  | Readonly<{
      outcome: "allowed";
      parent: InboxV2FileParentAccessSnapshot;
    }>
  | Readonly<{
      outcome: "denied";
      code: InboxV2FileAccessDenialCode;
    }>;

function evaluateCommonFileAccess(
  input: Readonly<{
    tenantId: string;
    pin: InboxV2FileObjectPin;
    parentLinkId: string;
    snapshot: InboxV2FileAccessSnapshot;
  }>,
  action: "view" | "detach"
): CommonFileAccessDecision {
  return evaluateFileParentAccess(input, "ready", action);
}

function evaluateFileParentAccess(
  input: Readonly<{
    tenantId: string;
    pin: InboxV2FileObjectPin;
    parentLinkId: string;
    snapshot: InboxV2FileAccessSnapshot;
  }>,
  requiredObjectState: InboxV2FileAccessSnapshot["objectState"],
  requiredAction: InboxV2FileAccessAction
): CommonFileAccessDecision {
  if (
    input.tenantId !== input.pin.tenantId ||
    input.tenantId !== input.snapshot.pin.tenantId
  ) {
    return { outcome: "denied", code: "tenant_mismatch" };
  }
  if (!samePin(input.pin, input.snapshot.pin)) {
    return { outcome: "denied", code: "pin_mismatch" };
  }
  if (input.snapshot.authorizationAction !== requiredAction) {
    return { outcome: "denied", code: "authorization_action_mismatch" };
  }
  if (input.snapshot.objectState !== requiredObjectState) {
    return { outcome: "denied", code: "object_unavailable" };
  }
  if (input.snapshot.retentionState !== "available") {
    return { outcome: "denied", code: "retention_unavailable" };
  }

  const matchingParents = input.snapshot.parentLinks.filter(
    (parent) => parent.linkId === input.parentLinkId
  );
  if (matchingParents.length !== 1) {
    return { outcome: "denied", code: "parent_not_found" };
  }
  const parent = matchingParents[0]!;
  if (
    parent.tenantId !== input.tenantId ||
    parent.fileVersionId !== input.pin.fileVersionId ||
    parent.objectVersionId !== input.pin.objectVersionId
  ) {
    return { outcome: "denied", code: "pin_mismatch" };
  }
  if (parent.state !== "live") {
    return { outcome: "denied", code: "parent_not_live" };
  }
  if (!parent.current) {
    return { outcome: "denied", code: "parent_stale" };
  }
  if (parent.permission !== "allowed") {
    return { outcome: "denied", code: "parent_forbidden" };
  }

  return { outcome: "allowed", parent };
}

function samePin(
  left: InboxV2FileObjectPin,
  right: InboxV2FileObjectPin
): boolean {
  return (
    left.tenantId === right.tenantId &&
    left.fileId === right.fileId &&
    left.fileRevision === right.fileRevision &&
    left.fileVersionId === right.fileVersionId &&
    left.objectVersionId === right.objectVersionId
  );
}

function parentFence(
  pin: InboxV2FileObjectPin,
  parent: InboxV2FileParentAccessSnapshot
): InboxV2FileParentFence {
  return {
    pin,
    parentLinkId: parent.linkId,
    parentLinkRevision: parent.linkRevision,
    parentId: parent.parentId,
    parentRevision: parent.parentRevision,
    contentRevision: parent.contentRevision,
    blockKey: parent.blockKey
  };
}
