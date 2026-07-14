import { describe, expect, it } from "vitest";

import {
  decideInboxV2ProjectionInput,
  inboxV2ProjectionCheckpointTransitionSchema
} from "../index";

const tenantId = "tenant:tenant-1";
const streamEpoch = "stream:epoch:0001";

function checkpoint(position = "0") {
  return {
    tenantId,
    projectionId: "core:inbox-recipient-projection",
    scopeId: "scope:employee-1",
    streamEpoch,
    syncGeneration: "1",
    projectionSchemaVersion: "v1",
    position
  };
}

function commit(streamPosition = "1", commitSchemaVersion = "v1") {
  return {
    tenantId,
    streamEpoch,
    commitId: `commit:commit-${streamPosition}`,
    commitSchemaVersion,
    streamPosition
  };
}

describe("Inbox V2 projection protocol", () => {
  it("applies or irrelevantly advances exactly the next contiguous commit", () => {
    expect(
      decideInboxV2ProjectionInput({
        checkpoint: checkpoint("0"),
        commit: commit("1"),
        relevance: "relevant"
      })
    ).toEqual({ kind: "apply" });
    expect(
      decideInboxV2ProjectionInput({
        checkpoint: checkpoint("0"),
        commit: commit("1"),
        relevance: "irrelevant"
      })
    ).toEqual({ kind: "advance_irrelevant" });
    expect(
      inboxV2ProjectionCheckpointTransitionSchema.safeParse({
        before: checkpoint("0"),
        input: commit("1"),
        disposition: "irrelevant",
        after: checkpoint("1")
      }).success
    ).toBe(true);
  });

  it("deduplicates old input and halts on gaps or mandatory unknown schemas", () => {
    expect(
      decideInboxV2ProjectionInput({
        checkpoint: checkpoint("5"),
        commit: commit("5"),
        relevance: "relevant"
      })
    ).toEqual({ kind: "duplicate" });
    expect(
      decideInboxV2ProjectionInput({
        checkpoint: checkpoint("5"),
        commit: commit("7"),
        relevance: "relevant"
      })
    ).toEqual({
      kind: "halt",
      errorCode: "projection.gap_detected"
    });
    expect(
      decideInboxV2ProjectionInput({
        checkpoint: checkpoint("5"),
        commit: commit("6"),
        relevance: "unsupported_mandatory_schema"
      })
    ).toEqual({
      kind: "halt",
      errorCode: "projection.schema_unsupported"
    });
    expect(
      decideInboxV2ProjectionInput({
        checkpoint: checkpoint("5"),
        commit: commit("5", "v2"),
        relevance: "relevant"
      })
    ).toEqual({ kind: "duplicate" });
    expect(
      decideInboxV2ProjectionInput({
        checkpoint: checkpoint("5"),
        commit: commit("6", "v2"),
        relevance: "relevant"
      })
    ).toEqual({
      kind: "halt",
      errorCode: "projection.schema_unsupported"
    });
    expect(
      inboxV2ProjectionCheckpointTransitionSchema.safeParse({
        before: checkpoint("5"),
        input: commit("6", "v2"),
        disposition: "applied",
        after: checkpoint("6")
      }).success
    ).toBe(false);
  });

  it("does not coerce checkpoint or commit bigint positions through numbers", () => {
    expect(
      inboxV2ProjectionCheckpointTransitionSchema.safeParse({
        before: checkpoint("9007199254740992"),
        input: commit("9007199254740993"),
        disposition: "applied",
        after: checkpoint("9007199254740993")
      }).success
    ).toBe(true);
    expect(
      inboxV2ProjectionCheckpointTransitionSchema.safeParse({
        before: checkpoint(0 as never),
        input: commit("1"),
        disposition: "applied",
        after: checkpoint("1")
      }).success
    ).toBe(false);
  });
});
