import type { HuleeDatabase } from "../client";
import {
  createSqlInboxV2OutboundProviderSettlementPlanner,
  type InboxV2OutboundProviderSettlementPlanner
} from "./sql-inbox-v2-outbound-provider-settlement-planner";
import {
  createSqlInboxV2OutboundProviderSettlementService,
  type InboxV2OutboundProviderSettlementService
} from "./sql-inbox-v2-outbound-provider-settlement-repository";
import {
  createSqlInboxV2OutboundProviderSettlementWorkRepository,
  type InboxV2OutboundProviderSettlementWorkRepository,
  type InboxV2OutboundProviderSettlementWorkTransactionExecutor
} from "./sql-inbox-v2-outbound-provider-settlement-work-repository";

/**
 * Production-only composition for the settlement worker. Keeping the three
 * capabilities together prevents consumers from constructing a planner or a
 * settlement service with a different database/transaction boundary.
 */
export type InboxV2OutboundProviderSettlementRuntime = Readonly<{
  work: InboxV2OutboundProviderSettlementWorkRepository;
  planner: InboxV2OutboundProviderSettlementPlanner;
  settlementService: InboxV2OutboundProviderSettlementService;
}>;

export function createSqlInboxV2OutboundProviderSettlementRuntime(
  database: HuleeDatabase,
  options: Readonly<{ tokenSource?: () => string }> = {}
): InboxV2OutboundProviderSettlementRuntime {
  const work = createSqlInboxV2OutboundProviderSettlementWorkRepository(
    database as unknown as InboxV2OutboundProviderSettlementWorkTransactionExecutor,
    options
  );
  return Object.freeze({
    work,
    planner: createSqlInboxV2OutboundProviderSettlementPlanner(database),
    settlementService:
      createSqlInboxV2OutboundProviderSettlementService(database)
  });
}
