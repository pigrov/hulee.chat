import type { OutboxRecord } from "@hulee/db";

/**
 * Narrow handler boundary for retained integration-control events. Batch
 * claiming and acknowledgement are intentionally not part of this contract.
 */
export type ProviderControlOutboxHandler = {
  handle(record: OutboxRecord): Promise<void>;
};

export type { OutboxRecord } from "@hulee/db";
