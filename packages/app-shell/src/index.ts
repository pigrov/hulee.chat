import type { BrandProfile } from "@hulee/branding";
import type { DeploymentType, TenantId } from "@hulee/contracts";

export type AppShellRuntime = "web" | "mobile" | "desktop";

export type TenantContext = {
  tenantId: TenantId;
  deploymentType: DeploymentType;
  locale: string;
  timezone: string;
  brand: BrandProfile;
};

export type AppShellState = {
  runtime: AppShellRuntime;
  tenant: TenantContext;
  authenticatedEmployeeId?: string;
};

export function createAppShellState(input: AppShellState): AppShellState {
  return input;
}
