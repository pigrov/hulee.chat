import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";
import { tsImport } from "tsx/esm/api";

const { Pool } = pg;
const {
  inboxV1PermissionMappingCatalogRegistration,
  inboxV2PermissionScopeCatalog,
  migrateInboxV1PermissionScopeToV2
} = await tsImport(
  "../../packages/core/src/inbox-v2-permission-catalog.ts",
  import.meta.url
);

const REPORT_SCHEMA_ID = "core:inbox-v2.rbac-dry-run";
const REPORT_SCHEMA_VERSION = "v1";
const SAFE_MAPPED_RESTRICTIONS = new Set([
  "same_or_narrower",
  "aggregate_only"
]);
const REFERENCED_SCOPE_SOURCES = Object.freeze({
  org_unit: "orgUnits",
  team: "teams",
  queue: "workQueues",
  client: "clients",
  conversation: "conversations"
});
const SUBJECT_SOURCES = Object.freeze({
  employee: "employees",
  org_unit: "orgUnits",
  team: "teams",
  queue: "workQueues"
});

const RAW_RELATIONS = Object.freeze([
  rawRelation("tenants", "public", "tenants", ["id"]),
  rawRelation("employees", "public", "employees", [
    "id",
    "tenant_id",
    "deactivated_at"
  ]),
  rawRelation("roles", "public", "tenant_roles", ["id", "tenant_id", "status"]),
  rawRelation("rolePermissions", "public", "tenant_role_permissions", [
    "tenant_id",
    "role_id",
    "permission"
  ]),
  rawRelation("roleBindings", "public", "tenant_role_bindings", [
    "id",
    "tenant_id",
    "role_id",
    "subject_type",
    "subject_id",
    "scope_type",
    "scope_id",
    "starts_at",
    "expires_at",
    "revoked_at"
  ]),
  rawRelation("directGrants", "public", "direct_permission_grants", [
    "id",
    "tenant_id",
    "employee_id",
    "permission",
    "scope_type",
    "scope_id",
    "starts_at",
    "expires_at",
    "revoked_at"
  ]),
  rawRelation("orgUnits", "public", "org_units", ["id", "tenant_id"]),
  rawRelation("teams", "public", "teams", ["id", "tenant_id"]),
  rawRelation("workQueues", "public", "work_queues", ["id", "tenant_id"]),
  rawRelation("clients", "public", "clients", ["id", "tenant_id"]),
  rawRelation("conversations", "public", "conversations", ["id", "tenant_id"]),
  rawRelation("sourceJournal", "drizzle", "__drizzle_migrations", [
    "id",
    "hash",
    "created_at"
  ])
]);

const SNAPSHOT_FIELDS = Object.freeze({
  tenants: ["id"],
  employees: ["id", "tenant_id", "deactivated_at"],
  roles: ["id", "tenant_id", "status"],
  rolePermissions: ["tenant_id", "role_id", "permission"],
  roleBindings: [
    "id",
    "tenant_id",
    "role_id",
    "subject_type",
    "subject_id",
    "scope_type",
    "scope_id",
    "starts_at",
    "expires_at",
    "revoked_at"
  ],
  directGrants: [
    "id",
    "tenant_id",
    "employee_id",
    "permission",
    "scope_type",
    "scope_id",
    "starts_at",
    "expires_at",
    "revoked_at"
  ],
  orgUnits: ["id", "tenant_id"],
  teams: ["id", "tenant_id"],
  workQueues: ["id", "tenant_id"],
  clients: ["id", "tenant_id"],
  conversations: ["id", "tenant_id"]
});

export class InboxV2RbacDryRunError extends Error {
  constructor(code) {
    super(code);
    this.name = "InboxV2RbacDryRunError";
    this.code = code;
  }
}

/**
 * Builds a deterministic, PII-safe report from raw V1 rows. The function is
 * deliberately pure: it neither queries nor mutates a database.
 */
export function buildInboxV2RbacDryRun(input) {
  const asOf = normalizeAsOf(input?.observedAt ?? input?.asOf);
  const tenantId = normalizeOptionalTenantId(input?.tenantId);
  const snapshot = normalizeSnapshot(input?.snapshot);
  const sourceJournal = normalizeSourceJournal(input?.sourceJournal);
  const indexes = buildIndexes(snapshot);
  const diagnostics = [];
  const sourceIssues = normalizeReadIssues(input?.readIssues);

  if (tenantId !== null && !indexes.tenantIds.has(tenantId)) {
    sourceIssues.push(
      safeIssue(
        "tenants",
        "requested_tenant_missing",
        referenceHash("tenant", tenantId)
      )
    );
  }
  appendSnapshotIntegrityIssues(snapshot, indexes, sourceIssues, tenantId);

  const permissionsByRoleId = groupBy(snapshot.rolePermissions, "role_id");
  const selectedRoleBindings = selectTenantSources(
    snapshot.roleBindings,
    tenantId
  );
  const selectedDirectGrants = selectTenantSources(
    snapshot.directGrants,
    tenantId
  );
  for (const binding of selectedRoleBindings) {
    const permissions = permissionsByRoleId.get(binding.role_id ?? "") ?? [];
    if (permissions.length === 0) {
      sourceIssues.push(
        safeIssue(
          "roleBindings",
          "role_binding_without_permissions",
          referenceHash("role_binding", sourceIdentity(binding))
        )
      );
      continue;
    }

    for (const permission of permissions) {
      diagnostics.push(
        buildRoleBindingDiagnostic({
          binding,
          permission,
          asOf,
          indexes
        })
      );
    }
  }

  for (const grant of selectedDirectGrants) {
    diagnostics.push(buildDirectGrantDiagnostic({ grant, asOf, indexes }));
  }

  diagnostics.sort(compareCanonical);
  sourceIssues.sort(compareCanonical);

  const outcomeCounts = countValues(
    diagnostics.map((diagnostic) => diagnostic.outcome),
    ["mapped", "review_required", "compatibility_only", "invalid"]
  );
  const temporalCounts = countValues(
    diagnostics.map((diagnostic) => diagnostic.temporalStatus),
    ["active", "scheduled", "expired", "revoked"]
  );
  const broadenedAccessCount = diagnostics.filter(
    (diagnostic) => diagnostic.broadenedAccess
  ).length;
  const catalogSha256 = sha256(
    canonicalJson({
      permissionScopeCatalog: inboxV2PermissionScopeCatalog,
      v1PermissionMappingCatalog: inboxV1PermissionMappingCatalogRegistration
    })
  );
  const sourceSnapshotSha256 = sha256(canonicalJson(snapshot));
  const journalSha256 = sha256(
    canonicalJson(
      sourceJournal.rows.map(({ hash, created_at }) => ({
        hash,
        createdAt: created_at
      }))
    )
  );
  const blockingOutcomeCount =
    outcomeCounts.review_required + outcomeCounts.invalid;
  const counts = {
    mapped: outcomeCounts.mapped,
    reviewRequired: outcomeCounts.review_required,
    compatibilityOnly: outcomeCounts.compatibility_only,
    invalid: outcomeCounts.invalid
  };
  const mappingEvidence = {
    tenantId,
    observedAt: asOf,
    counts,
    entries: diagnostics
  };
  const body = {
    schemaId: REPORT_SCHEMA_ID,
    schemaVersion: REPORT_SCHEMA_VERSION,
    tenantId,
    observedAt: asOf,
    source: {
      journal: {
        status: sourceJournal.status,
        entryCount: sourceJournal.rows.length,
        sha256: journalSha256
      },
      catalog: {
        schemaId: "core:inbox-v2.rbac-migration-catalog-set",
        schemaVersion: "v1",
        sha256: catalogSha256
      },
      snapshotSha256: sourceSnapshotSha256
    },
    summary: {
      roleBindingCount: selectedRoleBindings.length,
      roleBindingPermissionPairCount: diagnostics.filter(
        ({ sourceKind }) => sourceKind === "role_binding_permission"
      ).length,
      directGrantCount: selectedDirectGrants.length,
      outcomeCounts,
      temporalCounts,
      sourceIssueCount: sourceIssues.length,
      blockingOutcomeCount,
      broadenedAccessCount,
      readyForAutomaticApply:
        sourceJournal.status === "present" &&
        sourceIssues.length === 0 &&
        blockingOutcomeCount === 0 &&
        broadenedAccessCount === 0
    },
    counts,
    broadenedAccessCount,
    readyForAutomaticApply:
      sourceJournal.status === "present" &&
      sourceIssues.length === 0 &&
      blockingOutcomeCount === 0 &&
      broadenedAccessCount === 0,
    sourceIssues,
    entries: diagnostics,
    mappingSha256: sha256(canonicalJson(mappingEvidence))
  };

  return deepFreeze({
    ...body,
    reportSha256: sha256(canonicalJson(body))
  });
}

/**
 * Reads every relevant V1 relation independently. Missing or malformed
 * relations become machine-readable issues instead of disappearing through a
 * JOIN or aborting the complete diagnostic transaction.
 */
export async function readInboxV1RbacSnapshot(client) {
  const readContext = { savepoint: 0 };
  const catalog = await queryFailSoft(
    client,
    readContext,
    `select table_schema, table_name, column_name
       from information_schema.columns
      where table_schema = any($1::text[])
        and table_name = any($2::text[])
      order by table_schema, table_name, ordinal_position`,
    [
      [...new Set(RAW_RELATIONS.map(({ schema }) => schema))],
      [...new Set(RAW_RELATIONS.map(({ table }) => table))]
    ]
  );
  const snapshot = emptySnapshot();
  const readIssues = [];
  let sourceJournal = { status: "unavailable", rows: [] };

  if (!catalog.ok) {
    readIssues.push(safeIssue("catalog", "catalog_query_failed"));
    return deepFreeze({ snapshot, sourceJournal, readIssues });
  }

  const columnsByRelation = new Map();
  for (const row of catalog.rows) {
    const relationKey = `${row.table_schema}.${row.table_name}`;
    const columns = columnsByRelation.get(relationKey) ?? new Set();
    columns.add(row.column_name);
    columnsByRelation.set(relationKey, columns);
  }

  for (const relation of RAW_RELATIONS) {
    const relationKey = `${relation.schema}.${relation.table}`;
    const presentColumns = columnsByRelation.get(relationKey);
    if (presentColumns === undefined) {
      readIssues.push(safeIssue(relation.key, "relation_missing"));
      if (relation.key === "sourceJournal") {
        sourceJournal = { status: "missing", rows: [] };
      }
      continue;
    }
    const missingColumnCount = relation.columns.filter(
      (column) => !presentColumns.has(column)
    ).length;
    if (missingColumnCount > 0) {
      readIssues.push(
        safeIssue(relation.key, "required_columns_missing", undefined, {
          missingColumnCount
        })
      );
      if (relation.key === "sourceJournal") {
        sourceJournal = { status: "unavailable", rows: [] };
      }
      continue;
    }

    const result = await queryFailSoft(client, readContext, relation.selectSql);
    if (!result.ok) {
      readIssues.push(safeIssue(relation.key, "raw_query_failed"));
      if (relation.key === "sourceJournal") {
        sourceJournal = { status: "unavailable", rows: [] };
      }
      continue;
    }

    if (relation.key === "sourceJournal") {
      sourceJournal = { status: "present", rows: result.rows };
    } else {
      snapshot[relation.key] = result.rows;
    }
  }

  return deepFreeze({ snapshot, sourceJournal, readIssues });
}

export async function runInboxV2RbacDryRun(options = {}) {
  const asOf = normalizeAsOf(options.observedAt ?? options.asOf ?? new Date());
  const ownsPool = options.pool === undefined;
  const pool =
    options.pool ??
    new Pool({
      connectionString: requiredDatabaseUrl(options.databaseUrl),
      max: 1
    });
  let client;
  let transactionOpen = false;

  try {
    client = await pool.connect();
    await client.query("begin isolation level repeatable read read only");
    transactionOpen = true;
    const raw = await readInboxV1RbacSnapshot(client);
    const report = buildInboxV2RbacDryRun({
      ...raw,
      observedAt: asOf,
      tenantId: options.tenantId
    });
    await client.query("commit");
    transactionOpen = false;
    return report;
  } catch (error) {
    if (transactionOpen && client !== undefined) {
      try {
        await client.query("rollback");
      } catch {
        // The public error remains deliberately free of connection details.
      }
    }
    if (error instanceof InboxV2RbacDryRunError) throw error;
    throw new InboxV2RbacDryRunError("inbox_v2.rbac_dry_run_failed");
  } finally {
    client?.release?.();
    if (ownsPool) await pool.end();
  }
}

export async function runInboxV2RbacDryRunCli(options = {}) {
  const argv = options.argv ?? process.argv.slice(2);
  const env = options.env ?? process.env;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const runner = options.runner ?? runInboxV2RbacDryRun;

  try {
    const parsed = parseCliArguments(argv);
    if (parsed.help) {
      stdout.write(
        `${canonicalJson(
          {
            command: "inbox-v2-rbac-dry-run",
            options: ["--database-url", "--tenant-id", "--as-of", "--pretty"]
          },
          true
        )}\n`
      );
      return 0;
    }
    const report = await runner({
      databaseUrl: parsed.databaseUrl ?? env.DATABASE_URL,
      tenantId: parsed.tenantId,
      observedAt: parsed.asOf
    });
    stdout.write(`${canonicalJson(report, parsed.pretty)}\n`);
    return 0;
  } catch (error) {
    const code =
      error instanceof InboxV2RbacDryRunError
        ? error.code
        : "inbox_v2.rbac_dry_run_failed";
    stderr.write(`${canonicalJson({ error: { code } })}\n`);
    return 1;
  }
}

export function stringifyInboxV2RbacDryRun(report, pretty = false) {
  return canonicalJson(report, pretty);
}

function buildRoleBindingDiagnostic({ binding, permission, asOf, indexes }) {
  const validationCodes = [];
  validateTenant(binding.tenant_id, indexes, validationCodes);
  const role = selectTenantRow(
    indexes.rolesById.get(binding.role_id ?? "") ?? [],
    binding.tenant_id
  );
  if (role === undefined) {
    validationCodes.push(
      hasAnyId(indexes.rolesById, binding.role_id)
        ? "role_tenant_mismatch"
        : "role_missing"
    );
  } else if (role.status !== "active") {
    validationCodes.push("role_inactive");
  }
  if (permission.tenant_id !== binding.tenant_id) {
    validationCodes.push("role_permission_tenant_mismatch");
  }

  const subject = validateSubject(
    binding.subject_type,
    binding.subject_id,
    binding.tenant_id,
    asOf,
    indexes,
    validationCodes
  );
  const scope = validateScope(
    binding.scope_type,
    binding.scope_id,
    binding.tenant_id,
    indexes,
    validationCodes
  );
  const temporal = temporalStatus(binding, asOf, validationCodes);
  const migration = migrateInboxV1PermissionScopeToV2({
    tenantId: binding.tenant_id ?? "",
    permissionId: permission.permission ?? "",
    scope: v1Scope(binding.scope_type, binding.scope_id)
  });

  return finalizeDiagnostic({
    sourceKind: "role_binding_permission",
    sourceRef: referenceHash(
      "role_binding_permission",
      `${sourceIdentity(binding)}|${permission.permission ?? ""}`
    ),
    tenantId: binding.tenant_id,
    permissionId: permission.permission,
    roleRef: referenceHash("role", binding.role_id ?? "missing"),
    roleStatus: role?.status ?? "missing",
    subject,
    scope,
    temporalStatus: temporal,
    migration,
    validationCodes
  });
}

function buildDirectGrantDiagnostic({ grant, asOf, indexes }) {
  const validationCodes = [];
  validateTenant(grant.tenant_id, indexes, validationCodes);
  const subject = validateSubject(
    "employee",
    grant.employee_id,
    grant.tenant_id,
    asOf,
    indexes,
    validationCodes
  );
  const scope = validateScope(
    grant.scope_type,
    grant.scope_id,
    grant.tenant_id,
    indexes,
    validationCodes
  );
  const temporal = temporalStatus(grant, asOf, validationCodes);
  const migration = migrateInboxV1PermissionScopeToV2({
    tenantId: grant.tenant_id ?? "",
    permissionId: grant.permission ?? "",
    scope: v1Scope(grant.scope_type, grant.scope_id)
  });

  return finalizeDiagnostic({
    sourceKind: "direct_grant",
    sourceRef: referenceHash("direct_grant", sourceIdentity(grant)),
    tenantId: grant.tenant_id,
    permissionId: grant.permission,
    subject,
    scope,
    temporalStatus: temporal,
    migration,
    validationCodes
  });
}

function finalizeDiagnostic(input) {
  const validationCodes = [...new Set(input.validationCodes)].sort();
  const mappedRestrictionUnproven =
    input.migration.kind === "mapped" &&
    !SAFE_MAPPED_RESTRICTIONS.has(input.migration.semanticRestriction);
  if (mappedRestrictionUnproven) {
    validationCodes.push("non_broadening_proof_missing");
    validationCodes.sort();
  }
  const outcome = validationCodes.length > 0 ? "invalid" : input.migration.kind;
  const decisionCode =
    validationCodes.length > 0
      ? "source_validation_failed"
      : input.migration.kind === "mapped"
        ? "catalog_mapping_proven"
        : input.migration.reason;
  const mappedGrants =
    outcome === "mapped"
      ? input.migration.grants.map(({ permissionId, scope }) => ({
          permissionId,
          scope: safeMappedScope(scope)
        }))
      : [];
  const candidatePermissionIds =
    input.migration.kind === "review_required"
      ? [...input.migration.candidatePermissionIds].sort()
      : [];

  return {
    sourceKind: input.sourceKind,
    sourceRef: input.sourceRef,
    tenantRef: referenceHash("tenant", input.tenantId ?? "missing"),
    permissionId: input.permissionId ?? null,
    ...(input.roleRef === undefined
      ? {}
      : { roleRef: input.roleRef, roleStatus: input.roleStatus }),
    subject: input.subject,
    scope: input.scope,
    temporalStatus: input.temporalStatus,
    outcome,
    decisionCode,
    semanticRestriction:
      input.migration.kind === "mapped"
        ? input.migration.semanticRestriction
        : null,
    candidatePermissionIds,
    mappedGrants,
    nonBroadeningProof:
      outcome === "mapped" ? "proven_same_or_narrower" : "not_applicable",
    broadenedAccess: false,
    applicationDisposition: applicationDisposition(
      outcome,
      input.temporalStatus
    ),
    validationCodes
  };
}

function validateTenant(tenantId, indexes, codes) {
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    codes.push("tenant_invalid");
  } else if (!indexes.tenantIds.has(tenantId)) {
    codes.push("tenant_missing");
  }
}

function validateSubject(type, id, tenantId, asOf, indexes, codes) {
  const source = SUBJECT_SOURCES[type];
  const safeSubject = {
    type: typeof type === "string" ? type : "invalid",
    ref: referenceHash("subject", `${type ?? "invalid"}|${id ?? "missing"}`),
    status: "invalid"
  };
  if (source === undefined) {
    codes.push("subject_type_invalid");
    return safeSubject;
  }
  if (typeof id !== "string" || id.length === 0) {
    codes.push("subject_id_missing");
    return safeSubject;
  }
  const rows = indexes.bySourceAndId[source].get(id) ?? [];
  const row = selectTenantRow(rows, tenantId);
  if (row === undefined) {
    codes.push(rows.length > 0 ? "subject_tenant_mismatch" : "subject_missing");
    return safeSubject;
  }
  if (type === "employee" && timestampAtOrBefore(row.deactivated_at, asOf)) {
    codes.push("subject_deactivated");
    return { ...safeSubject, status: "deactivated" };
  }
  return { ...safeSubject, status: "active" };
}

function validateScope(type, id, tenantId, indexes, codes) {
  const safeScope = {
    type: typeof type === "string" ? type : "invalid",
    targetRef:
      id === null || id === undefined
        ? null
        : referenceHash(`scope:${type ?? "invalid"}`, String(id)),
    status: "invalid"
  };
  if (type === "tenant" || type === "assigned" || type === "own") {
    if (id !== null && id !== undefined) {
      codes.push("scope_reference_forbidden");
      return safeScope;
    }
    return { ...safeScope, status: "valid" };
  }
  const source = REFERENCED_SCOPE_SOURCES[type];
  if (source === undefined) {
    codes.push("scope_type_invalid");
    return safeScope;
  }
  if (typeof id !== "string" || id.length === 0) {
    codes.push("scope_target_missing");
    return safeScope;
  }
  const rows = indexes.bySourceAndId[source].get(id) ?? [];
  const row = selectTenantRow(rows, tenantId);
  if (row === undefined) {
    codes.push(
      rows.length > 0 ? "scope_target_tenant_mismatch" : "scope_target_missing"
    );
    return safeScope;
  }
  return { ...safeScope, status: "valid" };
}

function temporalStatus(row, asOf, codes) {
  const startsAt = parseOptionalTimestamp(row.starts_at, "starts_at", codes);
  const expiresAt = parseOptionalTimestamp(row.expires_at, "expires_at", codes);
  const revokedAt = parseOptionalTimestamp(row.revoked_at, "revoked_at", codes);
  if (startsAt !== null && expiresAt !== null && startsAt >= expiresAt) {
    codes.push("temporal_window_invalid");
  }
  if (revokedAt !== null && expiresAt !== null && revokedAt > expiresAt) {
    codes.push("revocation_after_expiry");
  }
  if (revokedAt !== null) return "revoked";
  const observedAt = Date.parse(asOf);
  if (startsAt !== null && startsAt > observedAt) return "scheduled";
  if (expiresAt !== null && expiresAt <= observedAt) return "expired";
  return "active";
}

function parseOptionalTimestamp(value, field, codes) {
  if (value === null || value === undefined) return null;
  const parsed = Date.parse(String(value));
  if (!Number.isFinite(parsed)) {
    codes.push(`${field}_invalid`);
    return null;
  }
  return parsed;
}

function timestampAtOrBefore(value, asOf) {
  if (value === null || value === undefined) return false;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) && parsed <= Date.parse(asOf);
}

function v1Scope(type, id) {
  if (typeof type !== "string") return {};
  return id === null || id === undefined ? { type } : { type, id };
}

function safeMappedScope(scope) {
  return {
    type: scope.type,
    ...(scope.id === undefined
      ? {}
      : { targetRef: referenceHash(`scope:${scope.type}`, scope.id) }),
    ...(scope.mode === undefined ? {} : { mode: scope.mode })
  };
}

function applicationDisposition(outcome, temporal) {
  if (outcome === "invalid") return "reject";
  if (outcome === "review_required") return "admin_review";
  if (outcome === "compatibility_only") return "retain_v1";
  if (temporal === "revoked" || temporal === "expired") {
    return "skip_historical";
  }
  if (temporal === "scheduled") return "preserve_schedule";
  return "eligible";
}

function appendSnapshotIntegrityIssues(snapshot, indexes, issues, tenantId) {
  for (const role of selectTenantSources(snapshot.roles, tenantId)) {
    if (!indexes.tenantIds.has(role.tenant_id ?? "")) {
      issues.push(
        safeIssue(
          "roles",
          "role_tenant_missing",
          referenceHash("role", sourceIdentity(role))
        )
      );
    }
  }
  for (const permission of selectTenantSources(
    snapshot.rolePermissions,
    tenantId
  )) {
    const roles = indexes.rolesById.get(permission.role_id ?? "") ?? [];
    if (roles.length === 0) {
      issues.push(
        safeIssue(
          "rolePermissions",
          "role_permission_role_missing",
          referenceHash("role_permission", sourceIdentity(permission))
        )
      );
    } else if (!roles.some((role) => role.tenant_id === permission.tenant_id)) {
      issues.push(
        safeIssue(
          "rolePermissions",
          "role_permission_tenant_mismatch",
          referenceHash("role_permission", sourceIdentity(permission))
        )
      );
    }
  }
}

function buildIndexes(snapshot) {
  const bySourceAndId = {};
  for (const source of [
    "employees",
    "orgUnits",
    "teams",
    "workQueues",
    "clients",
    "conversations"
  ]) {
    bySourceAndId[source] = groupBy(snapshot[source], "id");
  }
  return {
    tenantIds: new Set(
      snapshot.tenants
        .map(({ id }) => id)
        .filter((id) => typeof id === "string")
    ),
    rolesById: groupBy(snapshot.roles, "id"),
    bySourceAndId
  };
}

function normalizeSnapshot(value) {
  const snapshot = emptySnapshot();
  const input = isRecord(value) ? value : {};
  for (const [key, fields] of Object.entries(SNAPSHOT_FIELDS)) {
    const rows = Array.isArray(input[key]) ? input[key] : [];
    snapshot[key] = rows
      .map((row) => normalizeRawRow(row, fields))
      .sort(compareCanonical);
  }
  return snapshot;
}

function normalizeSourceJournal(value) {
  const input = isRecord(value) ? value : {};
  const rows = (Array.isArray(input.rows) ? input.rows : [])
    .map((row) => normalizeRawRow(row, ["id", "hash", "created_at"]))
    .sort((left, right) => {
      const byCreatedAt = compareCodeUnits(
        String(left.created_at),
        String(right.created_at)
      );
      return byCreatedAt || compareCodeUnits(String(left.id), String(right.id));
    });
  const status = ["present", "missing", "unavailable"].includes(input.status)
    ? input.status
    : "unavailable";
  return { status, rows };
}

function normalizeReadIssues(value) {
  if (!Array.isArray(value)) return [];
  return value.map((issue) => {
    const input = isRecord(issue) ? issue : {};
    return safeIssue(
      safeMachineValue(input.source, "unknown"),
      safeMachineValue(input.code, "invalid_read_issue"),
      typeof input.sourceRef === "string" ? input.sourceRef : undefined,
      Number.isInteger(input.missingColumnCount)
        ? { missingColumnCount: input.missingColumnCount }
        : undefined
    );
  });
}

function normalizeRawRow(value, fields) {
  const input = isRecord(value) ? value : {};
  return Object.fromEntries(
    fields.map((field) => [field, normalizeScalar(input[field])])
  );
}

function normalizeScalar(value) {
  if (value instanceof Date) return value.toISOString();
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (value === undefined) return null;
  return String(value);
}

function normalizeAsOf(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new InboxV2RbacDryRunError("inbox_v2.rbac_dry_run_as_of_invalid");
  }
  return date.toISOString();
}

function normalizeOptionalTenantId(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InboxV2RbacDryRunError("inbox_v2.rbac_dry_run_tenant_id_invalid");
  }
  return value;
}

function selectTenantSources(rows, tenantId) {
  return tenantId === null
    ? rows
    : rows.filter((row) => row.tenant_id === tenantId);
}

function normalizeMachineRows(rows) {
  return Array.isArray(rows) ? rows.map((row) => ({ ...row })) : [];
}

function rawRelation(key, schema, table, columns) {
  const selectedColumns = columns.map((column) => `"${column}"`).join(", ");
  const orderColumns = columns
    .filter((column) =>
      ["tenant_id", "role_id", "id", "permission", "created_at"].includes(
        column
      )
    )
    .map((column) => `"${column}"`);
  return Object.freeze({
    key,
    schema,
    table,
    columns: Object.freeze([...columns]),
    selectSql: `select ${selectedColumns} from "${schema}"."${table}"${
      orderColumns.length > 0 ? ` order by ${orderColumns.join(", ")}` : ""
    }`
  });
}

async function queryFailSoft(client, context, text, values = []) {
  const savepoint = `inbox_v2_rbac_dry_run_${context.savepoint}`;
  context.savepoint += 1;
  await client.query(`savepoint ${savepoint}`);
  try {
    const result = await client.query(text, values);
    await client.query(`release savepoint ${savepoint}`);
    return { ok: true, rows: normalizeMachineRows(result.rows) };
  } catch {
    try {
      await client.query(`rollback to savepoint ${savepoint}`);
      await client.query(`release savepoint ${savepoint}`);
    } catch {
      throw new InboxV2RbacDryRunError(
        "inbox_v2.rbac_dry_run_transaction_unrecoverable"
      );
    }
    return { ok: false, rows: [] };
  }
}

function parseCliArguments(argv) {
  const parsed = {
    databaseUrl: undefined,
    tenantId: undefined,
    asOf: undefined,
    pretty: false,
    help: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--pretty") {
      parsed.pretty = true;
    } else if (argument === "--help") {
      parsed.help = true;
    } else if (
      argument === "--database-url" ||
      argument === "--tenant-id" ||
      argument === "--as-of"
    ) {
      const value = argv[index + 1];
      if (typeof value !== "string" || value.startsWith("--")) {
        throw new InboxV2RbacDryRunError(
          "inbox_v2.rbac_dry_run_cli_argument_missing"
        );
      }
      index += 1;
      if (argument === "--database-url") parsed.databaseUrl = value;
      else if (argument === "--tenant-id") parsed.tenantId = value;
      else parsed.asOf = value;
    } else {
      throw new InboxV2RbacDryRunError(
        "inbox_v2.rbac_dry_run_cli_argument_invalid"
      );
    }
  }
  return parsed;
}

function requiredDatabaseUrl(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InboxV2RbacDryRunError(
      "inbox_v2.rbac_dry_run_database_url_missing"
    );
  }
  return value;
}

function safeIssue(source, code, sourceRef, extra = {}) {
  return {
    source: safeMachineValue(source, "unknown"),
    code: safeMachineValue(code, "invalid_issue"),
    ...(sourceRef === undefined ? {} : { sourceRef }),
    ...extra
  };
}

function safeMachineValue(value, fallback) {
  return typeof value === "string" && /^[a-zA-Z0-9_.-]+$/u.test(value)
    ? value
    : fallback;
}

function sourceIdentity(row) {
  if (typeof row.id === "string" && row.id.length > 0) return row.id;
  return sha256(canonicalJson(row));
}

function referenceHash(kind, value) {
  return sha256(`${REPORT_SCHEMA_ID}|${kind}|${value}`);
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function canonicalJson(value, pretty = false) {
  return JSON.stringify(canonicalValue(value), null, pretty ? 2 : undefined);
}

function canonicalValue(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((key) => value[key] !== undefined)
        .map((key) => [key, canonicalValue(value[key])])
    );
  }
  return value;
}

function compareCanonical(left, right) {
  return compareCodeUnits(canonicalJson(left), canonicalJson(right));
}

function compareCodeUnits(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function groupBy(rows, key) {
  const grouped = new Map();
  for (const row of rows) {
    const value = typeof row[key] === "string" ? row[key] : "";
    const group = grouped.get(value) ?? [];
    group.push(row);
    grouped.set(value, group);
  }
  return grouped;
}

function selectTenantRow(rows, tenantId) {
  return rows.find((row) => row.tenant_id === tenantId);
}

function hasAnyId(index, id) {
  return typeof id === "string" && (index.get(id)?.length ?? 0) > 0;
}

function countValues(values, keys) {
  const counts = Object.fromEntries(keys.map((key) => [key, 0]));
  for (const value of values) {
    if (Object.hasOwn(counts, value)) counts[value] += 1;
  }
  return counts;
}

function emptySnapshot() {
  return Object.fromEntries(
    Object.keys(SNAPSHOT_FIELDS).map((key) => [key, []])
  );
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepFreeze(value) {
  if (!isRecord(value) && !Array.isArray(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isDirectExecution) {
  process.exitCode = await runInboxV2RbacDryRunCli();
}
