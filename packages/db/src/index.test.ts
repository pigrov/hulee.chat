import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import * as publicDatabase from "@hulee/db";
import * as internalAttachmentMaterialization from "@hulee/db/internal/attachment-materialization";
import type {
  InboxV2PreparedMessageCreationCapability as _InboxV2PreparedMessageCreationCapability,
  PrepareInboxV2MessageCreationInput as _PrepareInboxV2MessageCreationInput,
  PrepareInboxV2MessageCreationResult as _PrepareInboxV2MessageCreationResult,
  SealInboxV2PreparedMessageCreationResult as _SealInboxV2PreparedMessageCreationResult
} from "@hulee/db";

// @ts-expect-error Legacy timeline writers must stay behind the package boundary.
import type { InboxV2TimelineMessageRepository as _LegacyTimelineWriter } from "@hulee/db";
// @ts-expect-error Legacy outbound writers must stay behind the package boundary.
import type { InboxV2OutboundTransportRepository as _LegacyOutboundWriter } from "@hulee/db";
// @ts-expect-error Raw materialization reservations must stay behind the package boundary.
import type { ReserveInboxV2AttachmentMaterializationInput as _RawMaterializationReservation } from "@hulee/db";
// @ts-expect-error Lease-bearing materialization claims must stay behind the package boundary.
import type { InboxV2AttachmentMaterializationClaim as _RawMaterializationClaim } from "@hulee/db";
// @ts-expect-error Storage-orphan mutation inputs must stay behind the package boundary.
import type { RecordInboxV2StorageOrphanInput as _RawStorageOrphanMutation } from "@hulee/db";
// @ts-expect-error File-parent preparation capabilities are internal atomic seams.
import type { InboxV2PreparedFileParentAttachmentsCapability as _RawFileParentCapability } from "@hulee/db";
// @ts-expect-error Lease-bearing terminal materialization commands are worker-internal.
import type { InboxV2AttachmentMaterializationTerminalCommandService as _RawMaterializationTerminalService } from "@hulee/db";

type _AtomicMessageCreationSurface = Readonly<{
  capability: _InboxV2PreparedMessageCreationCapability;
  input: _PrepareInboxV2MessageCreationInput;
  prepared: _PrepareInboxV2MessageCreationResult;
  sealed: _SealInboxV2PreparedMessageCreationResult;
}>;

describe("@hulee/db public export surface", () => {
  it("exports only authorized atomic seams for Inbox V2 message writers", () => {
    expect(publicDatabase.prepareInboxV2MessageCreation).toBeTypeOf("function");
    expect(publicDatabase.sealInboxV2PreparedMessageCreation).toBeTypeOf(
      "function"
    );
    expect(
      publicDatabase.persistInboxV2RouteResolutionInTransaction
    ).toBeTypeOf("function");
    expect(
      publicDatabase.createSqlInboxV2FencedOutboundTransportRuntimeRepository
    ).toBeTypeOf("function");
    expect(
      publicDatabase.persistInboxV2OutboundDispatchContentPlanInTransaction
    ).toBeTypeOf("function");
    expect(
      publicDatabase.INBOX_V2_ATTACHMENT_MATERIALIZATION_COMPLETION_RESULT_CODE
    ).toBe("core:attachment.materialization.completed");

    expect(publicDatabase).not.toHaveProperty(
      "createSqlInboxV2TimelineMessageRepository"
    );
    expect(publicDatabase).not.toHaveProperty(
      "createSqlInboxV2OutboundTransportRepository"
    );
    expect(publicDatabase).not.toHaveProperty(
      "createSqlInboxV2FileObjectRepository"
    );
    expect(publicDatabase).not.toHaveProperty(
      "buildClaimInboxV2AttachmentMaterializationJobsSql"
    );
    expect(publicDatabase).not.toHaveProperty("deriveInboxV2StorageOrphanId");
    expect(publicDatabase).not.toHaveProperty(
      "prepareInboxV2FileParentAttachmentsInTransaction"
    );
    expect(publicDatabase).not.toHaveProperty(
      "createSqlInboxV2AttachmentMaterializationTerminalCommandService"
    );
  });

  it("does not wildcard-export raw file/materialization repositories", () => {
    const packageRootSource = readFileSync(
      new URL("./index.ts", import.meta.url),
      "utf8"
    );
    const repositoryBarrelSource = readFileSync(
      new URL("./repositories/index.ts", import.meta.url),
      "utf8"
    );

    for (const source of [packageRootSource, repositoryBarrelSource]) {
      expect(source).not.toMatch(
        /export\s+\*\s+from\s+["'][^"']*sql-inbox-v2-file-object-repository["']/u
      );
      expect(source).not.toMatch(
        /export\s+\*\s+from\s+["'][^"']*sql-inbox-v2-file-parent-materialization["']/u
      );
    }
  });

  it("keeps the server-only materialization subpath explicitly curated", () => {
    expect(Object.keys(internalAttachmentMaterialization).sort()).toEqual([
      "INBOX_V2_ATTACHMENT_MATERIALIZATION_COMPLETION_RESULT_CODE",
      "createSqlInboxV2AttachmentMaterializationTerminalCommandService",
      "createSqlInboxV2FileObjectRepository",
      "createSqlInboxV2SourceAttachmentMaterializationRepository",
      "createSqlInboxV2SourceAttachmentReservationAuthorizationPreparer",
      "createSqlInboxV2SourceAttachmentReservationCommandPort",
      "isSqlInboxV2SourceAttachmentMaterializationRepository",
      "isSqlInboxV2SourceAttachmentReservationCommandPort",
      "isSqlInboxV2SourceAttachmentReservationCommandPortForRepository"
    ]);
    expect(internalAttachmentMaterialization).not.toHaveProperty(
      "buildClaimInboxV2AttachmentMaterializationJobsSql"
    );
    expect(internalAttachmentMaterialization).not.toHaveProperty(
      "deriveInboxV2StorageOrphanId"
    );
  });
});
