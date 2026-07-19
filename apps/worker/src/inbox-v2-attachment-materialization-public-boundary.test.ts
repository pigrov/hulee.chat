import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import * as publicWorker from "./index";

// @ts-expect-error Lease-bearing claims are worker-internal implementation state.
import type { InboxV2AttachmentMaterializationClaim as _RawMaterializationClaim } from "./index";
// @ts-expect-error Repository injection is a worker-internal composition seam.
import type { InboxV2AttachmentMaterializationRepository as _RawMaterializationRepository } from "./index";
// @ts-expect-error Source handles and locators must stay inside the worker.
import type { InboxV2AttachmentMaterializationSource as _RawMaterializationSource } from "./index";
// @ts-expect-error Source loaders are worker-internal composition seams.
import type { InboxV2AttachmentMaterializationSourceLoader as _RawMaterializationSourceLoader } from "./index";
// @ts-expect-error Storage persistence records must stay inside the worker.
import type { InboxV2AttachmentReadyPersistenceInput as _RawReadyPersistenceInput } from "./index";

describe("worker attachment-materialization public boundary", () => {
  it("does not expose the injectable low-level coordinator", () => {
    expect(publicWorker).not.toHaveProperty(
      "createInboxV2AttachmentMaterializationCoordinator"
    );
    expect(publicWorker).not.toHaveProperty(
      "DEFAULT_INBOX_V2_ATTACHMENT_MATERIALIZATION_MAXIMUM_BYTES"
    );
    expect(publicWorker).not.toHaveProperty(
      "InboxV2AttachmentMaterializationSourceError"
    );
  });

  it("does not re-export the low-level coordinator module", () => {
    const workerRootSource = readFileSync(
      new URL("./index.ts", import.meta.url),
      "utf8"
    );

    expect(workerRootSource).not.toMatch(
      /from\s+["']\.\/inbox-v2-attachment-materialization-coordinator["']/u
    );
  });
});
