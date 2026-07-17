import { describe, expect, it } from "vitest";

import * as publicDatabase from "@hulee/db";
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

    expect(publicDatabase).not.toHaveProperty(
      "createSqlInboxV2TimelineMessageRepository"
    );
    expect(publicDatabase).not.toHaveProperty(
      "createSqlInboxV2OutboundTransportRepository"
    );
  });
});
