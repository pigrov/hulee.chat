import { describe, expect, it } from "vitest";

import {
  assertInboxV2SourceGateFilesExist,
  flattenInboxV2SourceGateManifest,
  inboxV2SourceGateGroups,
  inboxV2SourceGateTaskIds,
  parseRunnerArguments,
  pnpmExecutable
} from "./run-inbox-v2-source-gate.mjs";

describe("Inbox V2 Epic 3 source gate runner", () => {
  it("pins every Epic 3 source task to a unique non-integration corpus", async () => {
    const testFiles = flattenInboxV2SourceGateManifest(inboxV2SourceGateGroups);

    expect(inboxV2SourceGateGroups.map(({ taskId }) => taskId)).toEqual(
      inboxV2SourceGateTaskIds
    );
    expect(new Set(testFiles).size).toBe(testFiles.length);
    expect(
      testFiles.some((testFile) => /\.integration\.test\./u.test(testFile))
    ).toBe(false);
    expect(testFiles).toEqual(
      expect.arrayContaining([
        "packages/db/src/repositories/sql-inbox-v2-raw-ingress-repository.test.ts",
        "apps/worker/src/source-participant-materialization.test.ts",
        "packages/db/src/repositories/sql-inbox-v2-source-conversation-resolution-repository.test.ts",
        "packages/db/src/repositories/sql-inbox-v2-source-message-reconciliation-repository.test.ts",
        "packages/db/src/repositories/sql-inbox-v2-authorization-repository.test.ts",
        "apps/worker/src/source-processing-production-activation.test.ts",
        "apps/worker/src/inbox-v2-provider-dispatch-coordinator.test.ts",
        "packages/testing/src/inbox-v2/external-scenarios.test.ts"
      ])
    );
    await expect(
      assertInboxV2SourceGateFilesExist({
        repositoryRoot: process.cwd(),
        testFiles
      })
    ).resolves.toBeUndefined();
  });

  it("fails closed for missing tasks, duplicate files and unsafe paths", () => {
    expect(() =>
      flattenInboxV2SourceGateManifest(inboxV2SourceGateGroups.slice(1))
    ).toThrow(/misses tasks: INB2-SRC-001/u);

    const duplicate = inboxV2SourceGateGroups.map((entry, index) =>
      index === 1
        ? {
            ...entry,
            testFiles: [
              inboxV2SourceGateGroups[0].testFiles[0],
              ...entry.testFiles
            ]
          }
        : entry
    );
    expect(() => flattenInboxV2SourceGateManifest(duplicate)).toThrow(
      /Duplicate Inbox V2 source gate test path/u
    );

    const integration = inboxV2SourceGateGroups.map((entry, index) =>
      index === 0
        ? {
            ...entry,
            testFiles: [
              "packages/db/src/repositories/unsafe.integration.test.ts"
            ]
          }
        : entry
    );
    expect(() => flattenInboxV2SourceGateManifest(integration)).toThrow(
      /Unsafe Inbox V2 source gate test path/u
    );

    const traversal = inboxV2SourceGateGroups.map((entry, index) =>
      index === 0
        ? {
            ...entry,
            testFiles: ["scripts/test/../../outside.test.mjs"]
          }
        : entry
    );
    expect(() => flattenInboxV2SourceGateManifest(traversal)).toThrow(
      /Unsafe Inbox V2 source gate test path/u
    );
  });

  it("rejects missing and non-file corpus entries", async () => {
    await expect(
      assertInboxV2SourceGateFilesExist({
        repositoryRoot: process.cwd(),
        testFiles: ["scripts/test/missing-source-gate.test.mjs"]
      })
    ).rejects.toThrow(/test file is missing/u);
    await expect(
      assertInboxV2SourceGateFilesExist({
        repositoryRoot: process.cwd(),
        testFiles: ["scripts/test"]
      })
    ).rejects.toThrow(/not a regular file/u);
  });

  it("parses only the documented runner flags and resolves pnpm portably", () => {
    expect(parseRunnerArguments([])).toEqual({ help: false, list: false });
    expect(parseRunnerArguments(["--list"])).toEqual({
      help: false,
      list: true
    });
    expect(parseRunnerArguments(["--help"])).toEqual({
      help: true,
      list: false
    });
    expect(() => parseRunnerArguments(["--unknown"])).toThrow(
      /Unknown argument/u
    );
    expect(pnpmExecutable("win32")).toBe("pnpm.cmd");
    expect(pnpmExecutable("linux")).toBe("pnpm");
  });
});
