import type {
  SourceAccountId,
  SourceConnectionId,
  TenantId
} from "@hulee/contracts";
import type {
  FindSourceConnectionInput,
  ListTenantSourceConnectionsInput,
  NormalizedInboundEventRecord,
  RecordNormalizedInboundEventInput,
  SourceAccountRecord,
  SourceConnectionRecord,
  SourceIntegrationRepository,
  UpsertSourceAccountInput,
  UpsertSourceConnectionInput
} from "@hulee/db";

export class InMemorySourceIntegrationRepository implements SourceIntegrationRepository {
  readonly connections = new Map<string, SourceConnectionRecord>();
  readonly accounts = new Map<string, SourceAccountRecord>();

  constructor(input: { connections?: readonly SourceConnectionRecord[] } = {}) {
    for (const connection of input.connections ?? []) {
      this.connections.set(connection.id, connection);
    }
  }

  async findSourceConnection(
    input: FindSourceConnectionInput
  ): Promise<SourceConnectionRecord | null> {
    const record = this.connections.get(String(input.sourceConnectionId));

    return record?.tenantId === input.tenantId ? record : null;
  }

  async listTenantSourceConnections(
    input: ListTenantSourceConnectionsInput
  ): Promise<SourceConnectionRecord[]> {
    return [...this.connections.values()]
      .filter(
        (record) =>
          record.tenantId === input.tenantId &&
          (input.includeDeleted || record.status !== "deleted")
      )
      .slice(0, input.limit ?? 100);
  }

  async upsertSourceConnection(
    input: UpsertSourceConnectionInput
  ): Promise<SourceConnectionRecord> {
    const existing = this.connections.get(String(input.id));
    const updatedAt = input.updatedAt;
    const record: SourceConnectionRecord = {
      id: String(input.id) as SourceConnectionId,
      tenantId: input.tenantId,
      sourceType: input.sourceType,
      sourceName: input.sourceName,
      displayName: input.displayName,
      status: input.status,
      authType: input.authType,
      capabilities: input.capabilities ?? existing?.capabilities ?? {},
      config: input.config ?? existing?.config ?? {},
      diagnostics: input.diagnostics ?? existing?.diagnostics ?? {},
      metadata: input.metadata ?? existing?.metadata ?? {},
      createdByEmployeeId:
        input.createdByEmployeeId ?? existing?.createdByEmployeeId ?? null,
      createdAt: existing?.createdAt ?? updatedAt,
      updatedAt
    };

    this.connections.set(record.id, record);

    return record;
  }

  async upsertSourceAccount(
    input: UpsertSourceAccountInput
  ): Promise<SourceAccountRecord> {
    const existing = this.accounts.get(String(input.id));
    const updatedAt = input.updatedAt;
    const record: SourceAccountRecord = {
      id: String(input.id) as SourceAccountId,
      tenantId: input.tenantId,
      sourceConnectionId: String(
        input.sourceConnectionId
      ) as SourceConnectionId,
      externalAccountId: input.externalAccountId ?? null,
      externalAccountName: input.externalAccountName ?? null,
      accountType: input.accountType,
      displayName: input.displayName,
      status: input.status,
      metadata: input.metadata ?? existing?.metadata ?? {},
      createdAt: existing?.createdAt ?? updatedAt,
      updatedAt
    };

    this.accounts.set(record.id, record);

    return record;
  }

  async recordNormalizedInboundEvent(
    _input: RecordNormalizedInboundEventInput
  ): Promise<NormalizedInboundEventRecord> {
    throw new Error(
      "recordNormalizedInboundEvent is not used by worker tests."
    );
  }
}

export function createTestSourceConnection(input: {
  id: SourceConnectionId | string;
  tenantId: TenantId;
  displayName: string;
  updatedAt: Date;
}): SourceConnectionRecord {
  return {
    id: String(input.id) as SourceConnectionId,
    tenantId: input.tenantId,
    sourceType: "messenger",
    sourceName: "telegram_user_session",
    displayName: input.displayName,
    status: "onboarding",
    authType: "custom",
    capabilities: {},
    config: {},
    diagnostics: {},
    metadata: {},
    createdByEmployeeId: null,
    createdAt: input.updatedAt,
    updatedAt: input.updatedAt
  };
}
