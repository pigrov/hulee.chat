import type { ModuleManifestInput } from "./module-manifest";

export const validNoDataModuleManifest: ModuleManifestInput = {
  id: "static-company-ui",
  type: "company",
  name: "Static company UI",
  version: "1.0.0",
  capabilities: [],
  configSchema: {},
  dataHandling: "none"
};

// @ts-expect-error A data-bearing manifest cannot omit dataGovernance.
export const missingDataGovernance: ModuleManifestInput = {
  id: "invalid-channel",
  type: "channel",
  name: "Invalid channel",
  version: "1.0.0",
  capabilities: [],
  configSchema: {},
  dataHandling: "tenant_or_customer_data"
};

// @ts-expect-error configSchema remains a required manifest field.
export const missingConfigSchema: ModuleManifestInput = {
  id: "invalid-company-ui",
  type: "company",
  name: "Invalid company UI",
  version: "1.0.0",
  capabilities: [],
  dataHandling: "none"
};

export const validStatelessWorkflow: ModuleManifestInput = {
  id: "stateless-workflow",
  type: "workflow",
  name: "Stateless workflow",
  version: "1.0.0",
  capabilities: [],
  configSchema: {},
  dataHandling: "none"
};
