import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  getLocalBrandAsset,
  putLocalBrandAsset,
  resolveLocalBrandAssetFilePath,
  toLocalBrandAssetStorageKey
} from "./local-brand-asset-storage";

describe("local brand asset storage", () => {
  it("stores local development assets under the workspace-local asset root", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "hulee-brand-assets-"));
    const storageKey = toLocalBrandAssetStorageKey(
      "tenants/tenant_1/brand-assets/logo/hash.png"
    );
    const body = new Uint8Array([1, 2, 3, 4]);

    try {
      await putLocalBrandAsset({ storageKey, body, rootDir });

      await expect(
        getLocalBrandAsset({ storageKey, rootDir }).then((storedBody) =>
          Array.from(storedBody)
        )
      ).resolves.toEqual(Array.from(body));
      expect(resolveLocalBrandAssetFilePath(storageKey, rootDir)).toBe(
        path.join(
          rootDir,
          ".hulee",
          "brand-assets",
          "tenants",
          "tenant_1",
          "brand-assets",
          "logo",
          "hash.png"
        )
      );
    } finally {
      await rm(rootDir, { force: true, recursive: true });
    }
  });

  it("rejects paths outside the local asset root", () => {
    expect(() =>
      resolveLocalBrandAssetFilePath("local:../outside.png", tmpdir())
    ).toThrow(/Invalid local brand asset path/);
  });
});
