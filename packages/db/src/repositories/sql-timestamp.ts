export type SqlTimestamp = Date | string;

export function mapSqlTimestamp(value: SqlTimestamp): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

export function mapOptionalSqlTimestamp(
  value: SqlTimestamp | null
): string | null {
  return value === null ? null : mapSqlTimestamp(value);
}
