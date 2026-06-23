import { describe, expect, it } from "vitest";

import {
  createVkAuthProviderPlaceholder,
  standardModuleManifests,
  vkAuthManifest
} from "./index";

describe("VK auth module manifest", () => {
  it("declares OAuth capabilities and extension slots without core coupling", async () => {
    const provider = createVkAuthProviderPlaceholder();

    expect(vkAuthManifest).toMatchObject({
      id: "auth-vk",
      type: "auth",
      capabilities: ["auth.oauth2", "auth.social.vk"]
    });
    expect(vkAuthManifest.uiSlots).toEqual([
      expect.objectContaining({
        slot: "integration.settings.section",
        componentRef: "auth-vk/settings"
      })
    ]);
    expect(standardModuleManifests).toContain(vkAuthManifest);
    await expect(provider.validateCallback?.({})).resolves.toBeNull();
    await expect(provider.health()).resolves.toMatchObject({
      status: "degraded"
    });
  });
});
