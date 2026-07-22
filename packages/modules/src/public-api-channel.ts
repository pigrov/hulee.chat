import { defineModuleManifest } from "@hulee/contracts";

import { publicApiChannelDataGovernance } from "./data-governance";

export const publicApiChannelManifest = defineModuleManifest({
  id: "channel-public-api",
  type: "channel",
  name: "Public API channel",
  version: "0.0.0",
  capabilities: [],
  configSchema: {},
  healthChecks: ["public_api_channel.health"],
  dataHandling: "tenant_or_customer_data",
  dataGovernance: publicApiChannelDataGovernance
});
