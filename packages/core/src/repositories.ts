import type { PlatformEvent } from "@hulee/contracts";

import type { RegisteredTenant } from "./tenant-registration";
import type { Message, MvpTenantWorkspace } from "./vertical-slice";

export type PersistConversationReplyInput = {
  message: Message;
  events: readonly PlatformEvent[];
};

export type PersistTenantRegistrationInput = {
  registration: RegisteredTenant;
  adminPasswordHash: string;
};

export type TenantWorkspaceRepository = {
  registerTenant(input: PersistTenantRegistrationInput): Promise<void>;
  saveWorkspace(workspace: MvpTenantWorkspace): Promise<void>;
  saveReply(input: PersistConversationReplyInput): Promise<void>;
};
