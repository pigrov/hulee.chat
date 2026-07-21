import type { ConversationId, EmployeeId, TenantId } from "@hulee/contracts";

export type FileContentAccessRecord = {
  tenantId: TenantId;
  fileId: string;
  storageKey: string;
  fileName: string;
  mediaType: string;
  sizeBytes: number;
  status: "pending_download" | "stored" | "failed";
  conversation: {
    id: ConversationId;
    tenantId: TenantId;
    clientId: string;
    currentQueueId?: string;
    assignedEmployeeId?: EmployeeId;
    assignedTeamId?: string;
  };
};
export type FindFileContentAccessInput = {
  tenantId: TenantId;
  fileId: string;
};
export type FileAccessRepository = {
  findFileContentAccess(
    input: FindFileContentAccessInput
  ): Promise<FileContentAccessRecord | null>;
};
