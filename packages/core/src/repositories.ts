import type { RegisteredTenant } from "./tenant-registration";

export type PersistTenantRegistrationInput = {
  registration: RegisteredTenant;
  adminPasswordHash: string | null;
};

export type TenantRegistrationRepository = {
  registerTenant(input: PersistTenantRegistrationInput): Promise<void>;
};
