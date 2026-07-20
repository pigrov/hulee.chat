import type { PlatformEvent } from "@hulee/contracts";

import type { RegisteredTenant } from "./tenant-registration";
import type { Message, MvpTenantWorkspace } from "./vertical-slice";

export type PersistConversationReplyInput = {
  message: Message;
  events: readonly PlatformEvent[];
};

export type PersistTenantRegistrationInput = {
  registration: RegisteredTenant;
  adminPasswordHash: string | null;
};

export type TenantRegistrationRepository = {
  registerTenant(input: PersistTenantRegistrationInput): Promise<void>;
};

export type TenantWorkspaceRepository = TenantRegistrationRepository & {
  saveWorkspace(workspace: MvpTenantWorkspace): Promise<void>;
  saveReply(input: PersistConversationReplyInput): Promise<void>;
};
