import {
  inboxV2BigintCounterSchema,
  inboxV2TenantIdSchema,
  type InboxV2BigintCounter,
  type InboxV2TenantId
} from "@hulee/contracts";
import { sql, type SQL } from "drizzle-orm";

import type { HuleeDatabase } from "../client";
import type { RawSqlExecutor } from "./sql-outbox-repository";

const MAXIMUM_TENANT_PAGE_SIZE = 64;
const MAXIMUM_PRUNE_BATCH_SIZE = 1_000;

export type ListInboxV2SecurityDenialRetentionTenantsInput = Readonly<{
  afterTenantId: InboxV2TenantId | null;
  limit: number;
}>;

export type PruneInboxV2SecurityDenialsInput = Readonly<{
  tenantId: InboxV2TenantId;
  batchSize: number;
}>;

export type PruneInboxV2SecurityDenialsResult = Readonly<{
  deletedWindowCount: InboxV2BigintCounter;
}>;

export type InboxV2SecurityDenialRetentionRepository = Readonly<{
  listRetentionTenants(
    input: ListInboxV2SecurityDenialRetentionTenantsInput
  ): Promise<readonly InboxV2TenantId[]>;
  prune(
    input: PruneInboxV2SecurityDenialsInput
  ): Promise<PruneInboxV2SecurityDenialsResult>;
}>;

type PrunableTenantRow = Record<string, unknown> & {
  tenant_id: unknown;
};

type SecurityDenialPruneRow = Record<string, unknown> & {
  deleted_window_count: unknown;
};

/**
 * Deployment-scoped maintenance boundary. It keyset-pages the canonical tenant
 * primary key, including pre-provisioned reserved deployment buckets, then
 * exposes only tenant-local bounded pruning to the worker.
 */
export function createSqlInboxV2SecurityDenialRetentionRepository(
  executor: RawSqlExecutor | HuleeDatabase
): InboxV2SecurityDenialRetentionRepository {
  const rawExecutor = executor as RawSqlExecutor;
  return Object.freeze({
    async listRetentionTenants(input) {
      const normalized = normalizeTenantPageInput(input);
      const result = await rawExecutor.execute<PrunableTenantRow>(
        buildListInboxV2SecurityDenialRetentionTenantsSql(normalized)
      );
      if (result.rows.length > normalized.limit) {
        throw new TypeError(
          "Security-denial retention tenant query exceeded its page bound."
        );
      }
      const tenantIds = result.rows.map((row) =>
        inboxV2TenantIdSchema.parse(row.tenant_id)
      );
      const seenTenantIds = new Set<InboxV2TenantId>();
      if (normalized.afterTenantId !== null) {
        seenTenantIds.add(normalized.afterTenantId);
      }
      for (const tenantId of tenantIds) {
        if (seenTenantIds.has(tenantId)) {
          throw new TypeError(
            "Security-denial retention tenant query repeated a keyset identity."
          );
        }
        seenTenantIds.add(tenantId);
      }
      return Object.freeze(tenantIds);
    },
    async prune(input) {
      const normalized = normalizePruneInput(input);
      const result = await rawExecutor.execute<SecurityDenialPruneRow>(
        buildPruneInboxV2SecurityDenialsSql(normalized)
      );
      if (result.rows.length !== 1) {
        throw new TypeError(
          "Security-denial prune must return exactly one row."
        );
      }
      const deletedWindowCount = inboxV2BigintCounterSchema.safeParse(
        result.rows[0]!.deleted_window_count
      );
      if (!deletedWindowCount.success) {
        throw new TypeError(
          "Security-denial prune count must be canonical bigint text."
        );
      }
      return Object.freeze({
        deletedWindowCount: deletedWindowCount.data
      });
    }
  });
}

export function buildListInboxV2SecurityDenialRetentionTenantsSql(
  input: ListInboxV2SecurityDenialRetentionTenantsInput
): SQL {
  const normalized = normalizeTenantPageInput(input);
  const cursorPredicate =
    normalized.afterTenantId === null
      ? sql`true`
      : sql`tenant.id > ${normalized.afterTenantId}::text`;
  return sql`
    select tenant.id as tenant_id
      from public.tenants tenant
     where ${cursorPredicate}
     order by tenant.id asc
     limit ${normalized.limit}
  `;
}

export function buildPruneInboxV2SecurityDenialsSql(
  input: PruneInboxV2SecurityDenialsInput
): SQL {
  const normalized = normalizePruneInput(input);
  return sql`
    select pruned.deleted_window_count::text as deleted_window_count
      from public.inbox_v2_security_denial_prune(
        ${normalized.tenantId},
        ${normalized.batchSize}
      ) pruned
  `;
}

function normalizeTenantPageInput(
  input: ListInboxV2SecurityDenialRetentionTenantsInput
): ListInboxV2SecurityDenialRetentionTenantsInput {
  if (
    !Number.isInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > MAXIMUM_TENANT_PAGE_SIZE
  ) {
    throw new TypeError(
      `security-denial retention tenant page size must be between 1 and ${MAXIMUM_TENANT_PAGE_SIZE}.`
    );
  }
  return Object.freeze({
    afterTenantId:
      input.afterTenantId === null
        ? null
        : inboxV2TenantIdSchema.parse(input.afterTenantId),
    limit: input.limit
  });
}

function normalizePruneInput(
  input: PruneInboxV2SecurityDenialsInput
): PruneInboxV2SecurityDenialsInput {
  if (
    !Number.isInteger(input.batchSize) ||
    input.batchSize < 1 ||
    input.batchSize > MAXIMUM_PRUNE_BATCH_SIZE
  ) {
    throw new TypeError(
      `security-denial prune batch size must be between 1 and ${MAXIMUM_PRUNE_BATCH_SIZE}.`
    );
  }
  return Object.freeze({
    tenantId: inboxV2TenantIdSchema.parse(input.tenantId),
    batchSize: input.batchSize
  });
}
