import type { PgTable } from "drizzle-orm/pg-core";

import type {
  InsertConflictPolicy,
  InsertRowsOptions,
  PersistenceExecutor,
  PersistenceTable
} from "./persistence-executor";

type DrizzleInsertQuery = Promise<unknown> & {
  onConflictDoNothing(): Promise<unknown>;
};

type DrizzleInsertBuilder = {
  values(rows: readonly unknown[]): DrizzleInsertQuery;
};

type DrizzleTransactionCapable = {
  insert(table: PgTable): DrizzleInsertBuilder;
  transaction<TResult>(
    work: (transaction: DrizzleTransactionCapable) => Promise<TResult>
  ): Promise<TResult>;
};

export function createDrizzlePersistenceExecutor(
  client: unknown
): PersistenceExecutor {
  const drizzleClient = client as DrizzleTransactionCapable;

  return {
    async insertRows<Row>(
      table: PersistenceTable<Row>,
      rows: readonly Row[],
      options?: InsertRowsOptions
    ): Promise<void> {
      if (rows.length === 0) {
        return;
      }

      const query = drizzleClient.insert(table.table).values(rows);
      const conflictPolicy: InsertConflictPolicy =
        options?.onConflict ?? "do_nothing";

      if (conflictPolicy === "do_nothing") {
        await query.onConflictDoNothing();
        return;
      }

      await query;
    },

    async transaction<TResult>(
      work: (transaction: PersistenceExecutor) => Promise<TResult>
    ): Promise<TResult> {
      return drizzleClient.transaction(async (transaction) => {
        return work(createDrizzlePersistenceExecutor(transaction));
      });
    }
  };
}
