import { describe, expect, it } from "vitest";

import {
  createLocalAuthProvider,
  hashLocalPassword,
  localAuthManifest,
  verifyLocalPassword
} from "./auth-local";

describe("local auth module", () => {
  it("hashes passwords without exposing the raw password", async () => {
    const passwordHash = await hashLocalPassword("correct horse", "fixed-salt");

    expect(passwordHash).toMatch(/^scrypt:v1:fixed-salt:/);
    expect(passwordHash).not.toContain("correct horse");
  });

  it("verifies password hashes with constant-time comparison", async () => {
    const passwordHash = await hashLocalPassword("correct horse", "fixed-salt");

    await expect(
      verifyLocalPassword("correct horse", passwordHash)
    ).resolves.toBe(true);
    await expect(
      verifyLocalPassword("wrong horse", passwordHash)
    ).resolves.toBe(false);
    await expect(verifyLocalPassword("correct horse", null)).resolves.toBe(
      false
    );
  });

  it("exposes the local auth provider manifest", async () => {
    const provider = createLocalAuthProvider();

    expect(provider.manifest).toEqual(localAuthManifest);
    await expect(provider.health()).resolves.toMatchObject({
      status: "healthy"
    });
  });
});
