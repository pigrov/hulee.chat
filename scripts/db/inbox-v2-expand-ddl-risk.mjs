import { createHash } from "node:crypto";

const REPORT_SCHEMA_ID = "core:inbox-v2.expand-ddl-risk-evidence@v2";
const PRE_EXPAND_PUBLIC_INVENTORY_SCOPE = "pre_expand_public_inventory";
const PRE_EXPAND_PUBLIC_INVENTORY_DIGEST_DOMAIN =
  "hulee:inbox-v2.expand-ddl-risk:pre-expand-public-inventory@v1";
const EPHEMERAL_DATABASE_PATTERN = /^hulee_db008_(?:preserve|n1)_[a-z0-9_]+$/u;
const BRIDGE_REASON_BY_RISK_KIND = Object.freeze({
  blocking_index: "blocking_index_requires_bridge",
  blocking_maintenance: "blocking_maintenance_requires_bridge",
  data_rewrite: "existing_relation_rewrite_requires_bridge",
  destructive_contract_change: "destructive_expand_requires_bridge",
  explicit_table_lock: "explicit_table_lock_requires_bridge",
  immediate_constraint_tightening:
    "immediate_constraint_tightening_requires_bridge",
  online_index: "concurrent_index_requires_bridge_executor",
  rule_change: "rule_change_requires_bridge",
  security_policy_change: "security_policy_change_requires_bridge",
  table_rewrite: "existing_relation_rewrite_requires_bridge",
  trigger_state_change: "trigger_change_requires_bridge",
  unbounded_data_backfill: "unbounded_target_backfill_requires_bridge",
  unbounded_source_backfill: "unbounded_source_backfill_requires_bridge",
  unclassified_existing_relation_ddl:
    "unclassified_existing_relation_ddl_requires_bridge",
  validated_constraint: "validated_constraint_requires_bridge",
  validation_scan: "validation_scan_requires_bridge"
});

export const INBOX_V2_BLOCKING_DDL_MAX_RELATION_BYTES = 8 * 1024 * 1024;

/**
 * Classifies pending target operations and unbounded INSERT ... SELECT source
 * scans against relations which existed before the migration transaction.
 * Target operations against a table created by the same pending bundle cannot
 * interrupt the old application and are intentionally omitted. This is a
 * conservative recognizer for public tables and their indexes, not a general
 * SQL parser. A statement is safe only when its recognized shape proves that
 * it is local to relations absent from the pre-expand inventory (or is one of
 * the explicit metadata-only operations below). Every other unrecognized
 * statement produces one deterministic deny-by-default operation scoped to
 * the complete pre-expand public table inventory.
 */
export function classifyInboxV2PendingDdl({
  migrations,
  appliedCount,
  existingRelationNames,
  indexRelations = new Map()
}) {
  if (!Array.isArray(migrations)) {
    throw new TypeError("migrations must be an array");
  }
  if (
    !Number.isSafeInteger(appliedCount) ||
    appliedCount < 0 ||
    appliedCount > migrations.length
  ) {
    throw new TypeError("appliedCount must be a valid migration prefix");
  }
  const existing = new Set(
    [...existingRelationNames].map((name) => normalizeIdentifier(name))
  );
  const operations = [];

  for (
    let migrationIndex = appliedCount;
    migrationIndex < migrations.length;
    migrationIndex += 1
  ) {
    const migration = migrations[migrationIndex];
    const statements = Array.isArray(migration?.sql) ? migration.sql : [];
    for (
      let statementIndex = 0;
      statementIndex < statements.length;
      statementIndex += 1
    ) {
      const statement = String(statements[statementIndex] ?? "").trim();
      const statementParts = splitTopLevelSqlStatements(statement);
      for (
        let statementPartIndex = 0;
        statementPartIndex < statementParts.length;
        statementPartIndex += 1
      ) {
        const statementPart = statementParts[statementPartIndex];
        const direct = classifyStatement(
          statementPart,
          existing,
          indexRelations
        );
        const sourceClassifications = classifyInsertSourceOperations(
          statementPart,
          existing
        );
        const classifications = deduplicateOperations([
          ...direct.operations,
          ...sourceClassifications,
          ...(direct.recognized
            ? []
            : inventoryScopedOperations(
                existing,
                "unclassified_existing_relation_ddl"
              ))
        ]);
        for (const classification of classifications) {
          operations.push(
            Object.freeze({
              migrationIndex,
              migrationCreatedAt: String(migration.folderMillis),
              statementIndex,
              statementPartIndex,
              statementSha256: sha256(statementPart),
              ...classification
            })
          );
        }
      }
    }
  }

  return Object.freeze(operations);
}

export async function inspectInboxV2ExpandDdlRisk(
  client,
  {
    migrations,
    appliedCount,
    allowEphemeralBlockingDdlCompatibilityTest = false,
    allowReviewedOnlineBridge = false,
    maximumRelationBytes = INBOX_V2_BLOCKING_DDL_MAX_RELATION_BYTES
  }
) {
  if (
    !Number.isSafeInteger(maximumRelationBytes) ||
    maximumRelationBytes <= 0
  ) {
    throw new TypeError("maximumRelationBytes must be a positive safe integer");
  }
  const databaseResult = await client.query(
    "select current_database() as database_name"
  );
  const relationResult = await client.query(`
      select relation.relname as relation_name,
             case
               when relation.relkind = 'p' then coalesce((
                 select sum(pg_catalog.pg_total_relation_size(tree.relid))
                   from pg_catalog.pg_partition_tree(relation.oid) tree
               ), 0)
               else pg_catalog.pg_total_relation_size(relation.oid)
             end::text as total_bytes
        from pg_catalog.pg_class relation
        join pg_catalog.pg_namespace namespace
          on namespace.oid = relation.relnamespace
       where namespace.nspname = 'public'
         and relation.relkind in ('r', 'p')
       order by relation.relname
    `);
  const indexResult = await client.query(`
      select index_relation.relname as index_name,
             table_relation.relname as relation_name
        from pg_catalog.pg_index index_catalog
        join pg_catalog.pg_class index_relation
          on index_relation.oid = index_catalog.indexrelid
        join pg_catalog.pg_class table_relation
          on table_relation.oid = index_catalog.indrelid
        join pg_catalog.pg_namespace namespace
          on namespace.oid = table_relation.relnamespace
       where namespace.nspname = 'public'
       order by index_relation.relname
    `);
  const databaseName = exactlyOneText(databaseResult, "database_name");
  const relationSizes = new Map(
    relationResult.rows.map((row) => [
      normalizeIdentifier(row.relation_name),
      safeByteCount(row.total_bytes)
    ])
  );
  const indexRelations = new Map(
    indexResult.rows.map((row) => [
      normalizeIdentifier(row.index_name),
      normalizeIdentifier(row.relation_name)
    ])
  );
  const operations = classifyInboxV2PendingDdl({
    migrations,
    appliedCount,
    existingRelationNames: relationSizes.keys(),
    indexRelations
  });
  const targetedRelationNames = [
    ...new Set(
      operations
        .filter((candidate) => Object.hasOwn(candidate, "relationName"))
        .map(({ relationName }) => relationName)
    )
  ].sort(compareOrdinal);
  const relationEvidence = [];

  for (const relationName of targetedRelationNames) {
    const nonEmpty = await relationHasRows(client, relationName);
    relationEvidence.push(
      Object.freeze({
        relationName,
        totalBytes: relationSizes.get(relationName) ?? null,
        nonEmpty
      })
    );
  }
  const evidenceByRelation = new Map(
    relationEvidence.map((evidence) => [evidence.relationName, evidence])
  );
  const violations = operations
    .map((operation) => {
      const relation = evidenceByRelation.get(operation.relationName);
      const violationReason = violationReasonForOperation(operation, relation);
      return violationReason === null
        ? null
        : Object.freeze({ ...operation, violationReason });
    })
    .filter((violation) => violation !== null);
  const overrideRequested = allowEphemeralBlockingDdlCompatibilityTest === true;
  const overrideAuthorized =
    overrideRequested &&
    EPHEMERAL_DATABASE_PATTERN.test(databaseName) &&
    process.env.NODE_ENV === "test" &&
    process.env.HULEE_DB_INTEGRATION === "1";
  const reviewedOnlineBridgeRequested = allowReviewedOnlineBridge === true;
  const reviewedOnlineBridgeAuthorized = reviewedOnlineBridgeRequested;
  const body = {
    schemaId: REPORT_SCHEMA_ID,
    appliedMigrationCount: appliedCount,
    pendingMigrationCount: migrations.length - appliedCount,
    maximumRelationBytes,
    databaseRef: sha256(databaseName),
    operationCount: operations.length,
    violationCount: violations.length,
    requiresOnlineBridge: violations.length > 0,
    overrideRequested,
    overrideAuthorized,
    reviewedOnlineBridgeRequested,
    reviewedOnlineBridgeAuthorized,
    operations,
    relations: relationEvidence,
    violations
  };
  return deepFreeze({
    ...body,
    reportSha256: sha256(canonicalJson(body))
  });
}

function classifyStatement(statement, existingRelations, indexRelations) {
  const normalized = maskSqlComments(stripLeadingComments(statement)).trim();
  if (normalized.length === 0) return recognizedStatement();

  if (/^alter\s+(?:table|index)\s+all\s+in\s+tablespace\b/iu.test(normalized)) {
    return recognizedStatement(
      inventoryScopedOperations(
        existingRelations,
        "unclassified_existing_relation_ddl"
      )
    );
  }

  const createdTable = classifyCreateTableStatement(
    normalized,
    existingRelations
  );
  if (createdTable !== null) return createdTable;

  const alter = matchRelation(
    normalized,
    /^alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?/iu
  );
  if (alter !== null) {
    return existingRelations.has(alter.relationName)
      ? recognizedStatement([classifyAlterTableOperation(alter)])
      : classifyAbsentAlterTableStatement(alter, existingRelations);
  }

  const relationListResults = [
    classifyRelationListStatement(
      normalized,
      /^drop\s+table\s+(?:if\s+exists\s+)?/iu,
      existingRelations,
      "destructive_contract_change"
    ),
    classifyRelationListStatement(
      normalized,
      /^truncate(?:\s+table)?\s+/iu,
      existingRelations,
      "destructive_contract_change",
      { requireExistingTarget: true }
    ),
    classifyRelationListStatement(
      normalized,
      /^lock\s+(?:table\s+)?/iu,
      existingRelations,
      "explicit_table_lock"
    )
  ];
  const relationListResult = relationListResults.find(({ matched }) => matched);
  if (relationListResult !== undefined) {
    return relationListResult.complete
      ? recognizedStatement(relationListResult.operations)
      : unrecognizedStatement();
  }

  const triggerRelation = matchTriggerRelation(normalized);
  if (triggerRelation !== null) {
    return recognizedStatement(
      existingRelations.has(triggerRelation.relationName)
        ? [operation(triggerRelation.relationName, "trigger_state_change")]
        : []
    );
  }
  const policyRelation = matchPolicyRelation(normalized);
  if (policyRelation !== null) {
    return recognizedStatement(
      existingRelations.has(policyRelation.relationName)
        ? [operation(policyRelation.relationName, "security_policy_change")]
        : []
    );
  }
  const ruleRelation = matchRuleRelation(normalized);
  if (ruleRelation !== null) {
    return recognizedStatement(
      existingRelations.has(ruleRelation.relationName)
        ? [operation(ruleRelation.relationName, "rule_change")]
        : []
    );
  }

  const index = matchCreateIndex(normalized);
  if (index !== null) {
    return recognizedStatement(
      existingRelations.has(index.relationName)
        ? [
            operation(
              index.relationName,
              index.concurrent ? "online_index" : "blocking_index"
            )
          ]
        : []
    );
  }

  const maintenance = classifyMaintenanceOperations(
    normalized,
    existingRelations,
    indexRelations
  );
  if (maintenance !== null) return maintenance;

  const alteredIndex = matchRelation(
    normalized,
    /^alter\s+index\s+(?:if\s+exists\s+)?/iu
  );
  if (alteredIndex !== null) {
    const relationName = indexRelations.get(alteredIndex.relationName);
    return relationName !== undefined && existingRelations.has(relationName)
      ? recognizedStatement([
          operation(relationName, "unclassified_existing_relation_ddl")
        ])
      : unrecognizedStatement();
  }

  const update = matchRelation(normalized, /^update\s+/iu);
  if (update !== null) {
    return existingRelations.has(update.relationName)
      ? recognizedStatement([operation(update.relationName, "data_rewrite")])
      : unrecognizedStatement();
  }
  const insert = matchRelation(normalized, /^insert\s+into\s+/iu);
  if (insert !== null) {
    if (existingRelations.has(insert.relationName)) {
      return recognizedStatement([
        operation(
          insert.relationName,
          isInsertSelectBackfill(insert.rest)
            ? "unbounded_data_backfill"
            : "unclassified_existing_relation_ddl"
        )
      ]);
    }
    return unrecognizedStatement();
  }
  const destructiveData = matchRelation(normalized, /^delete\s+from\s+/iu);
  if (destructiveData !== null) {
    return existingRelations.has(destructiveData.relationName)
      ? recognizedStatement([
          operation(destructiveData.relationName, "destructive_contract_change")
        ])
      : unrecognizedStatement();
  }

  const droppedIndexes = classifyDroppedIndexes(
    normalized,
    existingRelations,
    indexRelations
  );
  if (droppedIndexes !== null) return droppedIndexes;
  return unrecognizedStatement();
}

function classifyCreateTableStatement(statement, existingRelations) {
  const prefix =
    /^create\s+(?:(?:(?:(?:global|local)\s+)?(?:temporary|temp)|unlogged)\s+)?table\s+(?:if\s+not\s+exists\s+)?/iu;
  if (!prefix.test(statement)) return null;
  const target = matchRelation(statement, prefix);
  if (target === null) return unrecognizedStatement();

  const targetExisted = existingRelations.has(target.relationName);
  const operations = [];
  if (targetExisted) {
    operations.push(
      operation(target.relationName, "unclassified_existing_relation_ddl")
    );
  }
  operations.push(
    ...classifySelectSourceOperations(statement, existingRelations),
    ...classifyCreateTableReferenceOperations(statement, existingRelations)
  );
  if (/\binherits\s*\(/iu.test(maskSqlLiteralsAndComments(statement))) {
    operations.push(
      ...inventoryScopedOperations(
        existingRelations,
        "unclassified_existing_relation_ddl"
      )
    );
  }
  const classifiedOperations = deduplicateOperations(operations);
  const immediatelyPopulatesTarget =
    /\bas\s+(?:select|with|table|execute|values)\b/iu.test(
      maskSqlLiteralsAndComments(target.rest)
    );
  return !targetExisted &&
    immediatelyPopulatesTarget &&
    classifiedOperations.length === 0
    ? unrecognizedStatement()
    : recognizedStatement(classifiedOperations);
}

function classifyCreateTableReferenceOperations(statement, existingRelations) {
  const lexicalSql = maskSqlLiteralsAndComments(statement);
  const references = [];
  const referencePattern =
    /\b(partition\s+of|like|references|as\s+table)\s+(?:only\s+)?(?:(?:"public"|public)\s*\.\s*)?("(?:[^"]|"")*"|[a-z_][a-z0-9_$]*)/giu;
  for (const match of lexicalSql.matchAll(referencePattern)) {
    const relationName = sqlIdentifierValue(match[2]);
    if (existingRelations.has(relationName)) {
      references.push(
        operation(
          relationName,
          /^as\s+table$/iu.test(match[1])
            ? "unbounded_source_backfill"
            : "unclassified_existing_relation_ddl"
        )
      );
    }
  }
  return references;
}

function classifyAbsentAlterTableStatement(alter, existingRelations) {
  const action = stripLeadingComments(alter.rest).trim();
  if (
    splitTopLevelSqlParts(action, ",").length !== 1 ||
    !isClearlyLocalAbsentAlterAction(action)
  ) {
    return unrecognizedStatement();
  }
  return recognizedStatement(
    deduplicateOperations(
      classifyAlterTableReferenceOperations(action, existingRelations)
    )
  );
}

function classifyAlterTableReferenceOperations(action, existingRelations) {
  const lexicalSql = maskSqlLiteralsAndComments(action);
  const references = [];
  const referencePattern =
    /\b(?:references|(?:no\s+)?inherit|attach\s+partition|detach\s+partition)\s+(?:only\s+)?(?:(?:"public"|public)\s*\.\s*)?("(?:[^"]|"")*"|[a-z_][a-z0-9_$]*)/giu;
  for (const match of lexicalSql.matchAll(referencePattern)) {
    const relationName = sqlIdentifierValue(match[1]);
    if (existingRelations.has(relationName)) {
      references.push(
        operation(relationName, "unclassified_existing_relation_ddl")
      );
    }
  }
  return references;
}

function isClearlyLocalAbsentAlterAction(action) {
  if (/^add\s+column\b/iu.test(action)) {
    return (
      classifyAlterTableOperation({
        relationName: "new_relation",
        rest: action
      }).riskKind === "metadata_lock"
    );
  }
  return [
    /^drop\s+(?:column|constraint)\b/iu,
    /^rename\s+(?:column|constraint|to)\b/iu,
    /^(?:(?:enable|disable|force|no\s+force)\s+row\s+level\s+security|(?:disable\s+trigger|enable\s+(?:(?:always|replica)\s+)?trigger)|(?:disable\s+rule|enable\s+(?:(?:always|replica)\s+)?rule))\b/iu,
    /^owner\s+to\b/iu,
    /^(?:set\s+(?:schema|tablespace|logged|unlogged|access\s+method|without\s+oids)\b|set\s*\(|reset\s*\()/iu,
    /^replica\s+identity\b/iu,
    /^(?:cluster\s+on|set\s+without\s+cluster)\b/iu,
    /^(?:no\s+)?inherit\b/iu,
    /^(?:attach|detach)\s+partition\b/iu
  ].some((pattern) => pattern.test(action));
}

function classifyAlterTableOperation(alter) {
  const action = stripLeadingComments(alter.rest).trim();
  if (splitTopLevelSqlParts(action, ",").length > 1) {
    return operation(alter.relationName, "unclassified_existing_relation_ddl");
  }
  if (
    /^(?:enable|disable|force|no\s+force)\s+row\s+level\s+security\b/iu.test(
      action
    )
  ) {
    return operation(alter.relationName, "security_policy_change");
  }
  if (
    /^(?:disable\s+trigger|enable\s+(?:(?:always|replica)\s+)?trigger)\b/iu.test(
      action
    )
  ) {
    return operation(alter.relationName, "trigger_state_change");
  }
  if (
    /^drop\s+(?:column|constraint)\b/iu.test(action) ||
    /^rename\s+(?:column\s+)?/iu.test(action) ||
    /^alter\s+column\b[\s\S]*\b(?:type|set\s+data\s+type)\b/iu.test(action)
  ) {
    return operation(alter.relationName, "destructive_contract_change");
  }
  if (/^add\s+column\b/iu.test(action)) {
    const addedColumn = action.match(
      /^add\s+column\s+(?:if\s+not\s+exists\s+)?(?:"[a-z_][a-z0-9_]*"|[a-z_][a-z0-9_]*)\s+([\s\S]+)$/iu
    );
    if (addedColumn === null) {
      return operation(
        alter.relationName,
        "unclassified_existing_relation_ddl"
      );
    }
    const definition = addedColumn[1].trim();
    if (
      /\b(?:generated|identity|default)\b/iu.test(definition) ||
      /^(?:smallserial|serial|bigserial)\b/iu.test(definition)
    ) {
      return operation(alter.relationName, "table_rewrite");
    }
    if (/\b(?:unique|primary\s+key)\b|\bexclude\b/iu.test(definition)) {
      return operation(alter.relationName, "blocking_index");
    }
    if (/\bnot\s+null\b|\breferences\b|\bcheck\s*\(/iu.test(definition)) {
      return operation(alter.relationName, "validated_constraint");
    }
    return isPlainNullableColumnDefinition(definition)
      ? operation(alter.relationName, "metadata_lock")
      : operation(alter.relationName, "unclassified_existing_relation_ddl");
  }
  if (/^add\s+constraint\b/iu.test(action)) {
    if (/\bnot\s+valid\b/iu.test(action)) {
      return operation(alter.relationName, "immediate_constraint_tightening");
    }
    if (/\b(?:unique|primary\s+key)\b|\bexclude\b/iu.test(action)) {
      return operation(alter.relationName, "blocking_index");
    }
    if (/\bforeign\s+key\b|\bcheck\s*\(/iu.test(action)) {
      return operation(alter.relationName, "validated_constraint");
    }
  }
  if (/^validate\s+constraint\b/iu.test(action)) {
    return operation(alter.relationName, "validation_scan");
  }
  if (/^alter\s+column\b[\s\S]*\bset\s+not\s+null\b/iu.test(action)) {
    return operation(alter.relationName, "validated_constraint");
  }
  return operation(alter.relationName, "unclassified_existing_relation_ddl");
}

function isPlainNullableColumnDefinition(definition) {
  return /^(?:(?:bool|boolean|smallint|int2|integer|int4|bigint|int8|real|float4|double\s+precision|float8|money|text|uuid|json|jsonb|bytea|date|inet|cidr|macaddr|macaddr8)|(?:numeric|decimal)\s*(?:\(\s*\d+\s*(?:,\s*\d+\s*)?\))?|(?:varchar|char|character|bit)\s*(?:varying\s*)?(?:\(\s*\d+\s*\))?|(?:time|timestamp)\s*(?:\(\s*\d+\s*\))?(?:\s+(?:with|without)\s+time\s+zone)?|timetz|timestamptz|interval)(?:\s*\[\s*\])*(?:\s+null)?$/iu.test(
    definition
  );
}

function classifyRelationListStatement(
  statement,
  prefix,
  existingRelations,
  riskKind,
  { requireExistingTarget = false } = {}
) {
  const prefixMatch = statement.match(prefix);
  if (prefixMatch === null || prefixMatch.index !== 0) {
    return { matched: false, complete: false, operations: [] };
  }
  const relations = splitTopLevelSqlParts(
    statement.slice(prefixMatch[0].length),
    ","
  ).map((part) => matchRelation(part, /^(?:only\s+)?/iu));
  return {
    matched: true,
    complete:
      relations.length > 0 &&
      relations.every(
        (relation) =>
          relation !== null &&
          (!requireExistingTarget ||
            existingRelations.has(relation.relationName))
      ),
    operations: relations
      .filter(
        (relation) =>
          relation !== null && existingRelations.has(relation.relationName)
      )
      .map((relation) => operation(relation.relationName, riskKind))
  };
}

function matchTriggerRelation(statement) {
  return (
    matchOnRelation(
      statement,
      /^create\s+(?:or\s+replace\s+)?(?:constraint\s+)?trigger\s+(?:"(?:[^"]|"")*"|[a-z_][a-z0-9_$]*)\s+[\s\S]*?\bon\s+(?:only\s+)?/iu
    ) ??
    matchOnRelation(
      statement,
      /^(?:alter|drop)\s+trigger\s+(?:if\s+exists\s+)?(?:"(?:[^"]|"")*"|[a-z_][a-z0-9_$]*)\s+on\s+(?:only\s+)?/iu
    )
  );
}

function matchPolicyRelation(statement) {
  return matchOnRelation(
    statement,
    /^(?:create|alter|drop)\s+policy\s+(?:if\s+exists\s+)?(?:"(?:[^"]|"")*"|[a-z_][a-z0-9_$]*)\s+on\s+(?:only\s+)?/iu
  );
}

function matchRuleRelation(statement) {
  return (
    matchOnRelation(
      statement,
      /^create\s+(?:or\s+replace\s+)?rule\s+(?:"(?:[^"]|"")*"|[a-z_][a-z0-9_$]*)\s+as\s+on\s+(?:select|insert|update|delete)\s+to\s+(?:only\s+)?/iu
    ) ??
    matchOnRelation(
      statement,
      /^(?:alter|drop)\s+rule\s+(?:if\s+exists\s+)?(?:"(?:[^"]|"")*"|[a-z_][a-z0-9_$]*)\s+on\s+(?:only\s+)?/iu
    )
  );
}

function matchOnRelation(statement, prefix) {
  const prefixMatch = statement.match(prefix);
  if (prefixMatch === null || prefixMatch.index !== 0) return null;
  return matchRelation(statement.slice(prefixMatch[0].length), /^/u);
}

function classifyMaintenanceOperations(
  statement,
  existingRelations,
  indexRelations
) {
  if (
    /^reindex\s+(?:\([^)]*\)\s*)?(?:database|system)\s+(?:concurrently\s+)?(?:"(?:[^"]|"")*"|[a-z_][a-z0-9_$]*)\s*$/iu.test(
      statement
    ) ||
    /^cluster(?:\s+verbose)?\s*$/iu.test(statement) ||
    /^vacuum\s+(?:full(?:\s+(?:freeze|analyze|verbose))*|\((?=[^)]*\bfull\b)[^)]*\))\s*$/iu.test(
      statement
    )
  ) {
    return recognizedStatement(
      inventoryScopedOperations(existingRelations, "blocking_maintenance")
    );
  }

  const reindexSchema = statement.match(
    /^reindex\s+(?:\([^)]*\)\s*)?schema\s+(?:concurrently\s+)?("(?:[^"]|"")*"|[a-z_][a-z0-9_$]*)\s*$/iu
  );
  if (reindexSchema !== null) {
    return recognizedStatement(
      sqlIdentifierValue(reindexSchema[1]) === "public"
        ? inventoryScopedOperations(existingRelations, "blocking_maintenance")
        : []
    );
  }

  const tablePrefixes = [
    /^reindex\s+(?:\([^)]*\)\s*)?table\s+(?:concurrently\s+)?/iu,
    /^cluster\s+(?:verbose\s+)?/iu,
    /^vacuum\s+(?:full(?:\s+(?:freeze|analyze|verbose))*|\((?=[^)]*\bfull\b)[^)]*\))\s+/iu
  ];
  for (const prefix of tablePrefixes) {
    if (!prefix.test(statement)) continue;
    const tableRelation = matchRelation(statement, prefix);
    if (tableRelation === null) return unrecognizedStatement();
    return recognizedStatement(
      existingRelations.has(tableRelation.relationName)
        ? [operation(tableRelation.relationName, "blocking_maintenance")]
        : []
    );
  }

  const indexPrefix =
    /^reindex\s+(?:\([^)]*\)\s*)?index\s+(?:concurrently\s+)?/iu;
  if (indexPrefix.test(statement)) {
    const indexRelation = matchRelation(statement, indexPrefix);
    if (indexRelation === null) return unrecognizedStatement();
    const relationName = indexRelations.get(indexRelation.relationName);
    return recognizedStatement(
      relationName !== undefined && existingRelations.has(relationName)
        ? [operation(relationName, "blocking_maintenance")]
        : []
    );
  }
  return null;
}

function classifyDroppedIndexes(statement, existingRelations, indexRelations) {
  const prefixMatch = statement.match(
    /^drop\s+index\s+(?:concurrently\s+)?(?:if\s+exists\s+)?/iu
  );
  if (prefixMatch === null || prefixMatch.index !== 0) return null;
  const indexes = splitTopLevelSqlParts(
    statement.slice(prefixMatch[0].length),
    ","
  ).map((part) => matchRelation(part, /^/u));
  if (indexes.length === 0 || indexes.some((index) => index === null)) {
    return unrecognizedStatement();
  }
  return recognizedStatement(
    indexes
      .map((index) => indexRelations.get(index.relationName))
      .filter(
        (relationName) =>
          relationName !== undefined && existingRelations.has(relationName)
      )
      .map((relationName) =>
        operation(relationName, "destructive_contract_change")
      )
  );
}

function matchCreateIndex(statement) {
  const match = statement.match(
    /^create\s+(?:unique\s+)?index\s+(concurrently\s+)?(?:if\s+not\s+exists\s+)?(?:(?:"(?:[^"]|"")*"|[a-z_][a-z0-9_$]*)\s+)?on\s+(?:only\s+)?/iu
  );
  if (match === null) return null;
  const relation = matchRelation(statement.slice(match[0].length), /^/u);
  return relation === null
    ? null
    : {
        relationName: relation.relationName,
        concurrent: match[1] !== undefined
      };
}

function matchRelation(statement, prefix) {
  const prefixMatch = statement.match(prefix);
  if (prefixMatch === null || prefixMatch.index !== 0) return null;
  const rest = statement.slice(prefixMatch[0].length);
  const relationMatch = rest.match(
    /^(?:(?:"public"|public)\s*\.\s*)?(?:"([a-z_][a-z0-9_]*)"|([a-z_][a-z0-9_]*))\s*([\s\S]*)$/iu
  );
  if (relationMatch === null) return null;
  return {
    relationName: normalizeIdentifier(relationMatch[1] ?? relationMatch[2]),
    rest: relationMatch[3].trim()
  };
}

function operation(relationName, riskKind) {
  return Object.freeze({ relationName, riskKind });
}

function recognizedStatement(operations = []) {
  return Object.freeze({ recognized: true, operations });
}

function unrecognizedStatement() {
  return Object.freeze({ recognized: false, operations: [] });
}

function inventoryScopedOperations(existingRelations, riskKind) {
  const relationNames = [...new Set(existingRelations)]
    .map((relationName) => normalizeIdentifier(relationName))
    .sort(compareOrdinal);
  if (relationNames.length === 0) return [];
  return [
    Object.freeze({
      relationScope: PRE_EXPAND_PUBLIC_INVENTORY_SCOPE,
      affectedRelationCount: relationNames.length,
      affectedRelationsSha256: sha256(
        `${PRE_EXPAND_PUBLIC_INVENTORY_DIGEST_DOMAIN}\0${canonicalJson(
          relationNames
        )}`
      ),
      riskKind
    })
  ];
}

function violationReasonForOperation(operation, relation) {
  if (!Object.hasOwn(operation, "relationName")) {
    return violationReasonForRiskKind(operation.riskKind);
  }
  if (relation === undefined || relation.totalBytes === null) {
    return "relation_evidence_missing";
  }
  return violationReasonForRiskKind(operation.riskKind);
}

function violationReasonForRiskKind(riskKind) {
  if (riskKind === "metadata_lock") return null;
  return Object.hasOwn(BRIDGE_REASON_BY_RISK_KIND, riskKind)
    ? BRIDGE_REASON_BY_RISK_KIND[riskKind]
    : "unknown_risk_kind_requires_bridge";
}

function classifyInsertSourceOperations(statement, existingRelations) {
  const normalized = maskSqlComments(stripLeadingComments(statement)).trim();
  const insert = matchRelation(normalized, /^insert\s+into\s+/iu);
  if (insert === null) return [];
  return classifySelectSourceOperations(normalized, existingRelations);
}

function classifySelectSourceOperations(statement, existingRelations) {
  const sourceRelations = [];
  const lexicalSql = maskSqlLiteralsAndComments(statement);
  const sourcePattern =
    /\b(?:from|join)\s+(?:only\s+)?(?:(?:"public"|public)\s*\.\s*)?("(?:[^"]|"")*"|[a-z_][a-z0-9_$]*)/giu;
  for (const match of lexicalSql.matchAll(sourcePattern)) {
    const relationName = sqlIdentifierValue(match[1]);
    if (existingRelations.has(relationName)) {
      sourceRelations.push(
        operation(relationName, "unbounded_source_backfill")
      );
    }
  }
  return sourceRelations;
}

function deduplicateOperations(operations) {
  const seen = new Set();
  return operations.filter((candidate) => {
    const key = operationIdentity(candidate);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function operationIdentity(candidate) {
  if (Object.hasOwn(candidate, "relationName")) {
    return `relation\u001f${candidate.relationName}\u001f${candidate.riskKind}`;
  }
  return `scope\u001f${candidate.relationScope}\u001f${candidate.affectedRelationCount}\u001f${candidate.affectedRelationsSha256}\u001f${candidate.riskKind}`;
}

function isInsertSelectBackfill(rest) {
  const withoutTargetColumns = stripInsertTargetColumns(rest);
  return /^(?:overriding\s+(?:system|user)\s+value\s+)?(?:select|with)\b/iu.test(
    withoutTargetColumns
  );
}

function stripInsertTargetColumns(rest) {
  return rest.replace(
    /^\(\s*(?:"[a-z_][a-z0-9_]*"|[a-z_][a-z0-9_]*)(?:\s*,\s*(?:"[a-z_][a-z0-9_]*"|[a-z_][a-z0-9_]*))*\s*\)\s*/iu,
    ""
  );
}

function splitTopLevelSqlStatements(value) {
  return splitTopLevelSqlParts(value, ";");
}

function splitTopLevelSqlParts(value, delimiter) {
  if (delimiter !== ";" && delimiter !== ",") {
    throw new TypeError("SQL delimiter must be a semicolon or comma");
  }
  const parts = [];
  let start = 0;
  let index = 0;
  let parenthesisDepth = 0;
  let mode = "normal";
  let dollarTag = null;
  let blockCommentDepth = 0;

  while (index < value.length) {
    const character = value[index];
    const next = value[index + 1];

    if (mode === "single_quote") {
      if (character === "'" && next === "'") {
        index += 2;
        continue;
      }
      if (character === "\\") {
        index += 2;
        continue;
      }
      if (character === "'") mode = "normal";
      index += 1;
      continue;
    }
    if (mode === "double_quote") {
      if (character === '"' && next === '"') {
        index += 2;
        continue;
      }
      if (character === '"') mode = "normal";
      index += 1;
      continue;
    }
    if (mode === "line_comment") {
      if (character === "\n" || character === "\r") mode = "normal";
      index += 1;
      continue;
    }
    if (mode === "block_comment") {
      if (character === "/" && next === "*") {
        blockCommentDepth += 1;
        index += 2;
        continue;
      }
      if (character === "*" && next === "/") {
        blockCommentDepth -= 1;
        index += 2;
        if (blockCommentDepth === 0) mode = "normal";
        continue;
      }
      index += 1;
      continue;
    }
    if (mode === "dollar_quote") {
      if (value.startsWith(dollarTag, index)) {
        index += dollarTag.length;
        dollarTag = null;
        mode = "normal";
      } else {
        index += 1;
      }
      continue;
    }

    if (character === "-" && next === "-") {
      mode = "line_comment";
      index += 2;
      continue;
    }
    if (character === "/" && next === "*") {
      mode = "block_comment";
      blockCommentDepth = 1;
      index += 2;
      continue;
    }
    if (character === "'") {
      mode = "single_quote";
      index += 1;
      continue;
    }
    if (character === '"') {
      mode = "double_quote";
      index += 1;
      continue;
    }
    if (character === "$") {
      const tag = value.slice(index).match(/^\$(?:[a-z_][a-z0-9_]*)?\$/iu)?.[0];
      if (tag !== undefined) {
        dollarTag = tag;
        mode = "dollar_quote";
        index += tag.length;
        continue;
      }
    }
    if (character === "(") parenthesisDepth += 1;
    if (character === ")" && parenthesisDepth > 0) parenthesisDepth -= 1;
    if (character === delimiter && parenthesisDepth === 0) {
      pushNonEmptySqlPart(parts, value.slice(start, index));
      start = index + 1;
    }
    index += 1;
  }
  pushNonEmptySqlPart(parts, value.slice(start));
  return parts;
}

function pushNonEmptySqlPart(parts, value) {
  const part = value.trim();
  if (part.length > 0) parts.push(part);
}

function maskSqlLiteralsAndComments(value) {
  return maskSqlLexicalRegions(value, true);
}

function maskSqlComments(value) {
  return maskSqlLexicalRegions(value, false);
}

function maskSqlLexicalRegions(value, maskLiterals) {
  const masked = value.split("");
  let index = 0;
  let mode = "normal";
  let dollarTag = null;
  let blockCommentDepth = 0;

  while (index < value.length) {
    const character = value[index];
    const next = value[index + 1];

    if (mode === "single_quote") {
      if (maskLiterals) masked[index] = " ";
      if (character === "'" && next === "'") {
        if (maskLiterals) masked[index + 1] = " ";
        index += 2;
        continue;
      }
      if (character === "\\") {
        if (maskLiterals && index + 1 < masked.length) masked[index + 1] = " ";
        index += 2;
        continue;
      }
      if (character === "'") mode = "normal";
      index += 1;
      continue;
    }
    if (mode === "double_quote") {
      if (character === '"' && next === '"') {
        index += 2;
        continue;
      }
      if (character === '"') mode = "normal";
      index += 1;
      continue;
    }
    if (mode === "line_comment") {
      if (character === "\n" || character === "\r") {
        mode = "normal";
      } else {
        masked[index] = " ";
      }
      index += 1;
      continue;
    }
    if (mode === "block_comment") {
      masked[index] = " ";
      if (character === "/" && next === "*") {
        masked[index + 1] = " ";
        blockCommentDepth += 1;
        index += 2;
        continue;
      }
      if (character === "*" && next === "/") {
        masked[index + 1] = " ";
        blockCommentDepth -= 1;
        index += 2;
        if (blockCommentDepth === 0) mode = "normal";
        continue;
      }
      index += 1;
      continue;
    }
    if (mode === "dollar_quote") {
      if (value.startsWith(dollarTag, index)) {
        if (maskLiterals) masked.fill(" ", index, index + dollarTag.length);
        index += dollarTag.length;
        dollarTag = null;
        mode = "normal";
      } else {
        if (maskLiterals) masked[index] = " ";
        index += 1;
      }
      continue;
    }

    if (character === "-" && next === "-") {
      masked[index] = " ";
      masked[index + 1] = " ";
      mode = "line_comment";
      index += 2;
      continue;
    }
    if (character === "/" && next === "*") {
      masked[index] = " ";
      masked[index + 1] = " ";
      mode = "block_comment";
      blockCommentDepth = 1;
      index += 2;
      continue;
    }
    if (character === "'") {
      if (maskLiterals) masked[index] = " ";
      mode = "single_quote";
      index += 1;
      continue;
    }
    if (character === '"') {
      mode = "double_quote";
      index += 1;
      continue;
    }
    if (character === "$") {
      const tag = value.slice(index).match(/^\$(?:[a-z_][a-z0-9_]*)?\$/iu)?.[0];
      if (tag !== undefined) {
        if (maskLiterals) masked.fill(" ", index, index + tag.length);
        dollarTag = tag;
        mode = "dollar_quote";
        index += tag.length;
        continue;
      }
    }
    index += 1;
  }
  return masked.join("");
}

async function relationHasRows(client, relationName) {
  const result = await client.query(
    `select exists(select 1 from public.${quoteIdentifier(relationName)} limit 1) as non_empty`
  );
  if (!result || !Array.isArray(result.rows) || result.rows.length !== 1) {
    throw new Error(
      "expand DDL relation evidence returned an invalid row count"
    );
  }
  if (typeof result.rows[0].non_empty !== "boolean") {
    throw new Error("expand DDL relation evidence returned invalid occupancy");
  }
  return result.rows[0].non_empty;
}

function safeByteCount(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error("expand DDL relation evidence returned invalid bytes");
  }
  return number;
}

function exactlyOneText(result, field) {
  if (!result || !Array.isArray(result.rows) || result.rows.length !== 1) {
    throw new Error(`expand DDL evidence returned invalid ${field}`);
  }
  const value = result.rows[0][field];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`expand DDL evidence returned invalid ${field}`);
  }
  return value;
}

function normalizeIdentifier(value) {
  if (typeof value !== "string" || !/^[a-z_][a-z0-9_]*$/u.test(value)) {
    throw new Error("expand DDL classifier received an invalid identifier");
  }
  return value;
}

function sqlIdentifierValue(value) {
  if (typeof value !== "string") {
    throw new TypeError("SQL identifier must be a string");
  }
  if (value.startsWith('"')) {
    if (!value.endsWith('"') || value.length < 2) {
      throw new Error("SQL identifier is unterminated");
    }
    return value.slice(1, -1).replaceAll('""', '"');
  }
  return value.toLowerCase();
}

function quoteIdentifier(value) {
  return `"${normalizeIdentifier(value)}"`;
}

function stripLeadingComments(value) {
  let index = 0;
  while (index < value.length) {
    while (index < value.length && /\s/u.test(value[index])) index += 1;
    if (value[index] === "-" && value[index + 1] === "-") {
      index += 2;
      while (
        index < value.length &&
        value[index] !== "\n" &&
        value[index] !== "\r"
      ) {
        index += 1;
      }
      continue;
    }
    if (value[index] === "/" && value[index + 1] === "*") {
      const commentStart = index;
      let depth = 1;
      index += 2;
      while (index < value.length && depth > 0) {
        if (value[index] === "/" && value[index + 1] === "*") {
          depth += 1;
          index += 2;
          continue;
        }
        if (value[index] === "*" && value[index + 1] === "/") {
          depth -= 1;
          index += 2;
          continue;
        }
        index += 1;
      }
      if (depth > 0) {
        throw new Error(
          `expand DDL classifier received an unterminated leading block comment at offset ${commentStart}`
        );
      }
      continue;
    }
    break;
  }
  return value.slice(index);
}

function compareOrdinal(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort(compareOrdinal)
        .map((key) => [key, canonicalValue(value[key])])
    );
  }
  return value;
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}
