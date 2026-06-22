import type { TenantId } from "@hulee/contracts";
import { CoreError } from "@hulee/core";
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";

import type { HuleeDatabase } from "../client";
import type { RawSqlExecutor } from "./sql-outbox-repository";

export type TenantSecretPurpose =
  | "telegram.bot_token"
  | "telegram.webhook_secret_token"
  | (string & {});

export type TenantSecretRecord = {
  tenantId: TenantId;
  secretRef: string;
  purpose: TenantSecretPurpose;
  encryptedValue: string;
  encryptionKeyRef: string;
};

export type TenantSecretCipher = {
  readonly keyRef: string;
  encrypt(plainText: string): string;
  decrypt(sealedValue: string): string;
};

export type FindTenantSecretInput = {
  tenantId: TenantId;
  secretRef: string;
};

export type UpsertTenantSecretInput = {
  tenantId: TenantId;
  secretRef: string;
  purpose: TenantSecretPurpose;
  plainText: string;
  updatedAt: Date;
};

export type TenantSecretRepository = {
  findSecret(input: FindTenantSecretInput): Promise<TenantSecretRecord | null>;
  resolveSecret(input: FindTenantSecretInput): Promise<string | null>;
  upsertSecret(input: UpsertTenantSecretInput): Promise<void>;
};

type TenantSecretRow = {
  tenant_id: string;
  secret_ref: string;
  purpose: string;
  encrypted_value: string;
  encryption_key_ref: string;
};

const secretRefPrefix = "secret:";
const sealedValueVersion = "v1";

export function createSqlTenantSecretRepository(
  executor: RawSqlExecutor | HuleeDatabase,
  cipher: TenantSecretCipher
): TenantSecretRepository {
  const rawExecutor = executor as RawSqlExecutor;

  return {
    async findSecret(input) {
      assertSecretRefBelongsToTenant(input);
      const result = await rawExecutor.execute<TenantSecretRow>(
        buildFindTenantSecretSql(input)
      );

      return result.rows[0] ? mapTenantSecretRow(result.rows[0]) : null;
    },

    async resolveSecret(input) {
      const record = await this.findSecret(input);

      return record ? cipher.decrypt(record.encryptedValue) : null;
    },

    async upsertSecret(input) {
      assertSecretRefBelongsToTenant(input);
      const plainText = input.plainText.trim();

      if (plainText.length === 0) {
        throw new CoreError("validation.failed");
      }

      await rawExecutor.execute(
        buildUpsertTenantSecretSql({
          ...input,
          encryptedValue: cipher.encrypt(plainText),
          encryptionKeyRef: cipher.keyRef
        })
      );
    }
  };
}

export function createAesGcmTenantSecretCipher(input: {
  key: string;
  keyRef?: string;
}): TenantSecretCipher {
  const key = parseAes256Key(input.key);
  const keyRef = input.keyRef ?? "local";

  return {
    keyRef,
    encrypt(plainText) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const encrypted = Buffer.concat([
        cipher.update(plainText, "utf8"),
        cipher.final()
      ]);
      const authTag = cipher.getAuthTag();

      return [
        sealedValueVersion,
        iv.toString("base64url"),
        authTag.toString("base64url"),
        encrypted.toString("base64url")
      ].join(":");
    },
    decrypt(sealedValue) {
      const [version, ivPart, authTagPart, encryptedPart] =
        sealedValue.split(":");

      if (
        version !== sealedValueVersion ||
        !ivPart ||
        !authTagPart ||
        !encryptedPart
      ) {
        throw new CoreError("validation.failed");
      }

      const decipher = createDecipheriv(
        "aes-256-gcm",
        key,
        Buffer.from(ivPart, "base64url")
      );
      decipher.setAuthTag(Buffer.from(authTagPart, "base64url"));

      return Buffer.concat([
        decipher.update(Buffer.from(encryptedPart, "base64url")),
        decipher.final()
      ]).toString("utf8");
    }
  };
}

export function createTenantSecretRef(input: {
  tenantId: TenantId;
  moduleId: string;
  secretName: string;
}): string {
  assertSecretRefSegment(input.tenantId);
  assertSecretRefSegment(input.moduleId);
  assertSecretRefSegment(input.secretName);

  return `${secretRefPrefix}${input.tenantId}/${input.moduleId}/${input.secretName}`;
}

export function parseTenantSecretRef(input: {
  tenantId: TenantId;
  secretRef: string;
}): { tenantId: TenantId; path: string } {
  if (!input.secretRef.startsWith(secretRefPrefix)) {
    throw new CoreError("validation.failed");
  }

  const body = input.secretRef.slice(secretRefPrefix.length);
  const separatorIndex = body.indexOf("/");

  if (separatorIndex <= 0 || separatorIndex === body.length - 1) {
    throw new CoreError("validation.failed");
  }

  const refTenantId = body.slice(0, separatorIndex) as TenantId;
  const path = body.slice(separatorIndex + 1);

  if (refTenantId !== input.tenantId) {
    throw new CoreError("tenant.boundary_violation");
  }

  return {
    tenantId: refTenantId,
    path
  };
}

export function buildFindTenantSecretSql(input: FindTenantSecretInput): SQL {
  return sql`
    select tenant_id,
           secret_ref,
           purpose,
           encrypted_value,
           encryption_key_ref
    from tenant_secrets
    where tenant_id = ${input.tenantId}
      and secret_ref = ${input.secretRef}
    limit 1
  `;
}

export function buildUpsertTenantSecretSql(input: {
  tenantId: TenantId;
  secretRef: string;
  purpose: TenantSecretPurpose;
  encryptedValue: string;
  encryptionKeyRef: string;
  updatedAt: Date;
}): SQL {
  return sql`
    insert into tenant_secrets (
      tenant_id,
      secret_ref,
      purpose,
      encrypted_value,
      encryption_key_ref,
      created_at,
      updated_at
    )
    values (
      ${input.tenantId},
      ${input.secretRef},
      ${input.purpose},
      ${input.encryptedValue},
      ${input.encryptionKeyRef},
      ${input.updatedAt},
      ${input.updatedAt}
    )
    on conflict (tenant_id, secret_ref) do update
    set purpose = excluded.purpose,
        encrypted_value = excluded.encrypted_value,
        encryption_key_ref = excluded.encryption_key_ref,
        updated_at = excluded.updated_at
  `;
}

function assertSecretRefBelongsToTenant(input: {
  tenantId: TenantId;
  secretRef: string;
}): void {
  parseTenantSecretRef(input);
}

function assertSecretRefSegment(value: string): void {
  if (value.trim().length === 0 || value.includes("/")) {
    throw new CoreError("validation.failed");
  }
}

function parseAes256Key(value: string): Buffer {
  const trimmed = value.trim();
  const withoutPrefix = trimmed.startsWith("base64:")
    ? trimmed.slice("base64:".length)
    : trimmed;
  const key = trimmed.startsWith("base64:")
    ? Buffer.from(withoutPrefix, "base64")
    : /^[0-9a-f]{64}$/i.test(trimmed)
      ? Buffer.from(trimmed, "hex")
      : Buffer.from(trimmed, "utf8");

  if (key.length !== 32) {
    throw new CoreError("validation.failed");
  }

  return key;
}

function mapTenantSecretRow(row: TenantSecretRow): TenantSecretRecord {
  return {
    tenantId: row.tenant_id as TenantId,
    secretRef: row.secret_ref,
    purpose: row.purpose,
    encryptedValue: row.encrypted_value,
    encryptionKeyRef: row.encryption_key_ref
  };
}
