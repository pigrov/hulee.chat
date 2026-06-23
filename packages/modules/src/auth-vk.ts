import type { AuthProvider, ModuleManifest } from "@hulee/contracts";

export const vkAuthManifest = {
  id: "auth-vk",
  type: "auth",
  name: "VK auth",
  version: "0.0.0",
  capabilities: ["auth.oauth2", "auth.social.vk"],
  configSchema: {
    type: "object",
    properties: {
      clientId: { type: "string" },
      redirectUri: { type: "string" }
    },
    required: ["clientId", "redirectUri"]
  },
  secretsSchema: {
    type: "object",
    properties: {
      clientSecretRef: { type: "string" }
    },
    required: ["clientSecretRef"]
  },
  uiSlots: [
    {
      id: "auth-vk-settings",
      slot: "integration.settings.section",
      componentRef: "auth-vk/settings",
      titleKey: "integrations.authVk.title",
      requiredPermissions: ["modules.manage"],
      supportedClients: ["web"],
      order: 40
    }
  ],
  healthChecks: ["vk.oauth.config"]
} satisfies ModuleManifest;

export type VkAuthProvider = AuthProvider;

export function createVkAuthProviderPlaceholder(): VkAuthProvider {
  return {
    manifest: vkAuthManifest,
    async startLogin() {
      throw new Error("VK auth provider is not configured.");
    },
    async validateCallback() {
      return null;
    },
    async health() {
      return {
        status: "degraded",
        checkedAt: new Date(0).toISOString(),
        operatorHint: "auth-vk.provider_not_configured"
      };
    }
  };
}
