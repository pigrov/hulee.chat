import type { PgTable } from "drizzle-orm/pg-core";

export type InsertConflictPolicy = "fail" | "do_nothing";

export type PersistenceTable<Row> = {
  name: string;
  table: PgTable;
  rowType?: Row;
};

export type InsertRowsOptions = {
  onConflict: InsertConflictPolicy;
};

export type PersistenceExecutor = {
  insertRows<Row>(
    table: PersistenceTable<Row>,
    rows: readonly Row[],
    options?: InsertRowsOptions
  ): Promise<void>;
  transaction<TResult>(
    work: (transaction: PersistenceExecutor) => Promise<TResult>
  ): Promise<TResult>;
};

export type PersistenceOperation = {
  kind: "insert";
  tableName: string;
  rowCount: number;
  onConflict: InsertConflictPolicy;
};

export function tableRef<TTable extends PgTable>(
  name: string,
  table: TTable
): PersistenceTable<TTable["$inferInsert"]> {
  return {
    name,
    table
  };
}
