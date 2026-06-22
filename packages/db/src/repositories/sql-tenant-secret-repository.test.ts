import type { TenantId } from "@hulee/contracts";
import { CoreError } from "@hulee/core";
import type { SQL } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type {
  RawSqlExecutor,
  RawSqlQueryResult
} from "./sql-outbox-repository";
import {
  createAesGcmTenantSecretCipher,
  createSqlTenantSecretRepository,
  createTenantSecretRef,
  parseTenantSecretRef
} from "./sql-tenant-secret-repository";

const tenantId = "tenant_secret_1" as TenantId;
const otherTenantId = "tenant_secret_2" as TenantId;
const secretRef = createTenantSecretRef({
  tenantId,
  moduleId: "channel-telegram",
  secretName: "bot-token"
});
const cipher = createAesGcmTenantSecretCipher({
  key: "0123456789abcdef0123456789abcdef",
  keyRef: "test"
});

describe("SQL tenant secret repository", () => {
  it("builds tenant-scoped secret refs and rejects cross-tenant refs", () => {
    expect(parseTenantSecretRef({ tenantId, secretRef })).toEqual({
      tenantId,
      path: "channel-telegram/bot-token"
    });

    expect(() =>
      parseTenantSecretRef({
        tenantId: otherTenantId,
        secretRef
      })
    ).toThrow(new CoreError("tenant.boundary_violation"));
  });

  it("encrypts and decrypts tenant secrets", () => {
    const sealed = cipher.encrypt("telegram-token");

    expect(sealed).not.toContain("telegram-token");
    expect(cipher.decrypt(sealed)).toBe("telegram-token");
  });

  it("upserts encrypted secrets without storing plaintext in SQL params", async () => {
    const executor = new RecordingSqlExecutor([]);
    const repository = createSqlTenantSecretRepository(executor, cipher);

    await repository.upsertSecret({
      tenantId,
      secretRef,
      purpose: "telegram.bot_token",
      plainText: "telegram-token",
      updatedAt: new Date("2026-06-22T10:00:00.000Z")
    });

    expect(executor.queries).toHaveLength(1);
    expect(String(executor.queries[0])).not.toContain("telegram-token");
  });

  it("resolves encrypted tenant secrets", async () => {
    const executor = new RecordingSqlExecutor([
      {
        tenant_id: tenantId,
        secret_ref: secretRef,
        purpose: "telegram.bot_token",
        encrypted_value: cipher.encrypt("telegram-token"),
        encryption_key_ref: "test"
      }
    ]);
    const repository = createSqlTenantSecretRepository(executor, cipher);

    await expect(
      repository.resolveSecret({
        tenantId,
        secretRef
      })
    ).resolves.toBe("telegram-token");
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
