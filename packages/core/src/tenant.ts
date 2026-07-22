import type { TenantId } from "@hulee/contracts";

import type { TenantScope } from "./domain-events";

export type ModuleConfigMap = Readonly<Record<string, unknown>>;

export type Tenant = TenantScope & {
  id: TenantId;
  slug: string;
  displayName: string;
  locale: string;
  timezone: string;
  createdAt: string;
  enabledModules: readonly string[];
  moduleConfigs?: ModuleConfigMap;
};
