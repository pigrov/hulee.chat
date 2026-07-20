export function restoreInboxV2HistoricalSqlFunction(
  input: Readonly<{
    sqlToRestore: string;
    currentSchemaSql: string;
    successorMigrationSql: string;
    predecessorSql: string;
    functionName: string;
    label: string;
  }>
): string {
  const currentDefinition = extractInboxV2SqlFunctionDefinition(
    input.currentSchemaSql,
    input.functionName
  );
  const installedSuccessor = extractInboxV2SqlFunctionDefinition(
    input.successorMigrationSql,
    input.functionName
  );
  if (currentDefinition !== installedSuccessor) {
    throw new Error(
      `${input.label} successor migration is not the exact current schema function.`
    );
  }
  const definitionToReplace = extractInboxV2SqlFunctionDefinition(
    input.sqlToRestore,
    input.functionName
  );
  const predecessorDefinition = extractInboxV2SqlFunctionDefinition(
    input.predecessorSql,
    input.functionName
  );
  return replaceExactlyOnce(
    normalizeSql(input.sqlToRestore),
    definitionToReplace,
    predecessorDefinition,
    `${input.label} predecessor restoration`
  );
}

export function extractInboxV2SqlFunctionDefinition(
  sql: string,
  functionName: string
): string {
  const normalized = normalizeSql(sql);
  const signature = `create or replace function ${functionName}`;
  const occurrences = normalized.split(signature).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `Expected exactly one ${functionName} definition, found ${occurrences}.`
    );
  }
  const start = normalized.indexOf(signature);
  const delimiter = "$function$";
  const bodyStart = normalized.indexOf(`as ${delimiter}`, start);
  const bodyEnd = normalized.indexOf(
    `${delimiter};`,
    bodyStart + `as ${delimiter}`.length
  );
  if (bodyStart < 0 || bodyEnd < 0) {
    throw new Error(`Cannot extract ${functionName}.`);
  }
  return normalized.slice(start, bodyEnd + `${delimiter};`.length).trim();
}

function replaceExactlyOnce(
  input: string,
  fragment: string,
  replacement: string,
  label: string
): string {
  const occurrences = input.split(fragment).length - 1;
  if (occurrences !== 1) {
    throw new Error(`${label} matched ${occurrences} times.`);
  }
  return input.replace(fragment, replacement);
}

function normalizeSql(sql: string): string {
  return sql.replaceAll("\r\n", "\n");
}
