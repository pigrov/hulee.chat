import type {
  InsertRowsOptions,
  PersistenceExecutor,
  PersistenceOperation,
  PersistenceTable
} from "./persistence-executor";

export class RecordingPersistenceExecutor implements PersistenceExecutor {
  readonly operations: PersistenceOperation[] = [];
  transactionCount = 0;

  async insertRows<Row>(
    table: PersistenceTable<Row>,
    rows: readonly Row[],
    options?: InsertRowsOptions
  ): Promise<void> {
    this.operations.push({
      kind: "insert",
      tableName: table.name,
      rowCount: rows.length,
      onConflict: options?.onConflict ?? "do_nothing"
    });
  }

  async transaction<TResult>(
    work: (transaction: PersistenceExecutor) => Promise<TResult>
  ): Promise<TResult> {
    this.transactionCount += 1;

    return work(this);
  }
}
