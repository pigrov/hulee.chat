import type { ConversationId, EmployeeId, TenantId } from "@hulee/contracts";
import { sql, type SQL } from "drizzle-orm";

import type { HuleeDatabase } from "../client";
import type { RawSqlExecutor } from "./sql-outbox-repository";

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

type FileContentAccessRow = {
  tenant_id: string;
  file_id: string;
  storage_key: string;
  file_name: string;
  media_type: string;
  size_bytes: number;
  file_status: FileContentAccessRecord["status"];
  conversation_id: string;
  client_id: string;
  current_queue_id: string | null;
  assigned_employee_id: string | null;
  assigned_team_id: string | null;
};

export function createSqlFileAccessRepository(
  database: HuleeDatabase | RawSqlExecutor
): FileAccessRepository {
  const rawExecutor = database as RawSqlExecutor;

  return {
    async findFileContentAccess(input) {
      const result = await rawExecutor.execute<FileContentAccessRow>(
        buildFindFileContentAccessSql(input)
      );
      const row = result.rows[0];

      return row ? mapFileContentAccessRow(row) : null;
    }
  };
}

export function buildFindFileContentAccessSql(
  input: FindFileContentAccessInput
): SQL {
  return sql`
    select f.tenant_id,
           f.id as file_id,
           f.storage_key,
           f.file_name,
           f.media_type,
           f.size_bytes,
           f.status as file_status,
           m.conversation_id,
           c.client_id,
           c.current_queue_id,
           c.assigned_employee_id,
           c.assigned_team_id
    from files f
    inner join message_attachments ma
      on ma.tenant_id = f.tenant_id
     and ma.file_id = f.id
    inner join messages m
      on m.tenant_id = ma.tenant_id
     and m.id = ma.message_id
    inner join conversations c
      on c.tenant_id = m.tenant_id
     and c.id = m.conversation_id
    where f.tenant_id = ${input.tenantId}
      and f.id = ${input.fileId}
    order by ma.created_at asc,
             ma.id asc
    limit 1
  `;
}

function mapFileContentAccessRow(
  row: FileContentAccessRow
): FileContentAccessRecord {
  return {
    tenantId: row.tenant_id as TenantId,
    fileId: row.file_id,
    storageKey: row.storage_key,
    fileName: row.file_name,
    mediaType: row.media_type,
    sizeBytes: Number(row.size_bytes),
    status: row.file_status,
    conversation: {
      id: row.conversation_id as ConversationId,
      tenantId: row.tenant_id as TenantId,
      clientId: row.client_id,
      currentQueueId: row.current_queue_id ?? undefined,
      assignedEmployeeId: row.assigned_employee_id
        ? (row.assigned_employee_id as EmployeeId)
        : undefined,
      assignedTeamId: row.assigned_team_id ?? undefined
    }
  };
}
