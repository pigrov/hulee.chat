import type { InboxV2EntityRevision } from "./entity-metadata";
import type {
  InboxV2AttachmentMaterialization,
  InboxV2CurrentAttachmentMaterialization,
  InboxV2ExactFileObjectPin,
  InboxV2ExtensionPayloadPin
} from "./file-object";
import type {
  InboxV2FileId,
  InboxV2FileReference,
  InboxV2FileVersionId,
  InboxV2FileVersionReference,
  InboxV2MessageAttachmentReference,
  InboxV2ObjectVersionId,
  InboxV2ObjectVersionReference
} from "./ids";

declare const fileId: InboxV2FileId;
declare const fileVersionId: InboxV2FileVersionId;
declare const objectVersionId: InboxV2ObjectVersionId;
declare const file: InboxV2FileReference;
declare const fileVersion: InboxV2FileVersionReference;
declare const objectVersion: InboxV2ObjectVersionReference;
declare const attachment: InboxV2MessageAttachmentReference;
declare const fileRevision: InboxV2EntityRevision;

const _exactPin: InboxV2ExactFileObjectPin = {
  file,
  fileRevision,
  fileVersion,
  objectVersion
};

const _ready: Extract<
  InboxV2CurrentAttachmentMaterialization,
  { state: "ready" }
> = {
  state: "ready",
  attachment,
  file,
  fileRevision,
  fileVersion,
  objectVersion
};

const _legacy: Extract<
  InboxV2AttachmentMaterialization,
  { state: "legacy_unpinned" }
> = {
  state: "legacy_unpinned",
  attachment,
  file
};

const _extensionPin: Extract<InboxV2ExtensionPayloadPin, { state: "exact" }> = {
  state: "exact",
  fileRevision,
  fileVersion,
  objectVersion
};

// @ts-expect-error Logical FileVersion IDs cannot substitute for physical ObjectVersion IDs.
const _objectVersionFromFileVersion: InboxV2ObjectVersionId = fileVersionId;

// @ts-expect-error Physical ObjectVersion IDs cannot substitute for logical FileVersion IDs.
const _fileVersionFromObjectVersion: InboxV2FileVersionId = objectVersionId;

// @ts-expect-error File entity IDs cannot substitute for immutable FileVersion IDs.
const _fileVersionFromFile: InboxV2FileVersionId = fileId;

// @ts-expect-error N-1 legacy state is deliberately outside current materialization writes.
const _legacyCurrent: InboxV2CurrentAttachmentMaterialization = _legacy;

// @ts-expect-error Exact extension payload pins require the physical object version.
const _extensionWithoutObject: Extract<
  InboxV2ExtensionPayloadPin,
  { state: "exact" }
> = {
  state: "exact",
  fileRevision,
  fileVersion
};

void _exactPin;
void _ready;
void _extensionPin;
