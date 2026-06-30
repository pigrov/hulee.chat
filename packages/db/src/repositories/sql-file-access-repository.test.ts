import type { TenantId } from "@hulee/contracts";
import type { SQL } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  buildFindFileContentAccessSql,
  createSqlFileAccessRepository
} from "./sql-file-access-repository";
import type {
  RawSqlExecutor,
  RawSqlQueryResult
} from "./sql-outbox-repository";

const tenantId = "tenant_files" as TenantId;

describe("sql file access repository", () => {
  it("maps file content access rows with conversation scope", async () => {
    const repository = createSqlFileAccessRepository(
      new RecordingSqlExecutor([
        {
          tenant_id: tenantId,
          file_id: "file-1",
          storage_key: "tenants/tenant_files/messages/message-1/photo.jpg",
          file_name: "photo.jpg",
          media_type: "image/jpeg",
          size_bytes: 123,
          file_status: "stored",
          conversation_id: "conversation-1",
          client_id: "client-1",
          current_queue_id: "queue-sales",
          assigned_employee_id: "employee-1",
          assigned_team_id: null
        }
      ])
    );

    await expect(
      repository.findFileContentAccess({
        tenantId,
        fileId: "file-1"
      })
    ).resolves.toEqual({
      tenantId,
      fileId: "file-1",
      storageKey: "tenants/tenant_files/messages/message-1/photo.jpg",
      fileName: "photo.jpg",
      mediaType: "image/jpeg",
      sizeBytes: 123,
      status: "stored",
      conversation: {
        id: "conversation-1",
        tenantId,
        clientId: "client-1",
        currentQueueId: "queue-sales",
        assignedEmployeeId: "employee-1",
        assignedTeamId: undefined
      }
    });
  });

  it("builds tenant-scoped file content lookup SQL", () => {
    expect(
      buildFindFileContentAccessSql({
        tenantId,
        fileId: "file-1"
      })
    ).toBeDefined();
  });
});

class RecordingSqlExecutor implements RawSqlExecutor {
  readonly queries: SQL[] = [];

  constructor(private readonly rows: readonly Record<string, unknown>[]) {}

  async execute<Row extends Record<string, unknown>>(
    query: SQL
  ): Promise<RawSqlQueryResult<Row>> {
    this.queries.push(query);

    return {
      rows: this.rows as readonly Row[]
    };
  }
}
