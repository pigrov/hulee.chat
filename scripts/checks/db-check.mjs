import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";

import {
  assertDrizzleSnapshotParity,
  generateExpectedDrizzleBaseline
} from "./db-check-lib.mjs";

const migrationDirectory = "packages/db/drizzle";
const metadataDirectory = `${migrationDirectory}/meta`;
const baselineFileName = "0000_inbox_v2_baseline.sql";
const snapshotFileName = "0000_snapshot.json";
const journalFileName = "_journal.json";
const baselineTag = "0000_inbox_v2_baseline";
const runtimeSchemaContractFileName =
  "packages/db/src/inbox-v2-runtime-schema-guard.ts";

const legacyTableNames = [
  "conversations",
  "conversation_participants",
  "messages",
  "message_delivery_attempts",
  "message_attachments"
];
const legacyEnumNames = [
  "conversation_type",
  "message_direction",
  "message_status"
];
const requiredTableNames = [
  "tenants",
  "employees",
  "clients",
  "source_connections",
  "source_accounts",
  "raw_inbound_events",
  "normalized_inbound_events",
  "files",
  "event_store",
  "outbox",
  "audit_log",
  "notification_events",
  "inbox_v2_conversations",
  "inbox_v2_conversation_participants",
  "inbox_v2_external_threads",
  "inbox_v2_timeline_items",
  "inbox_v2_messages",
  "inbox_v2_work_items"
];
const requiredEnumNames = [
  "deployment_type",
  "outbox_status",
  "inbox_v2_conversation_topology",
  "inbox_v2_conversation_transport",
  "inbox_v2_conversation_lifecycle",
  "inbox_v2_message_lifecycle",
  "inbox_v2_message_source_direction"
];
const requiredRoleNames = [
  "hulee_inbox_v2_retention_owner",
  "hulee_inbox_v2_runtime",
  "hulee_inbox_v2_membership_owner",
  "hulee_inbox_v2_membership_repair"
];
const requiredFunctionNames = [
  "inbox_v2_advance_tenant_stream_retained_prefix_v1",
  "inbox_v2_apply_participant_membership_mutation_v1",
  "inbox_v2_auth_command_guard",
  "inbox_v2_security_denial_record",
  "inbox_v2_conversation_timeline_head_deferred",
  "inbox_v2_source_raw_admission_guard",
  "inbox_v2_outbound_dispatch_guard_insert",
  "inbox_v2_tm_provider_lifecycle_history_valid"
];
const requiredTriggerNames = [
  "inbox_v2_auth_command_guard_trigger",
  "inbox_v2_security_denial_bucket_guard",
  "inbox_v2_source_raw_admission_guard_trigger",
  "inbox_v2_outbound_dispatches_update_guard_trigger",
  "inbox_v2_tm_timeline_head_guard",
  "inbox_v2_conversation_membership_commits_guard_insert_trigger",
  "inbox_v2_conversations_update_guard_trigger"
];

const [
  migrationFileNames,
  metadataFileNames,
  baselineSql,
  journal,
  snapshot,
  runtimeSchemaContract
] = await Promise.all([
  readdir(migrationDirectory).then((fileNames) =>
    fileNames.filter((fileName) => fileName.endsWith(".sql")).sort()
  ),
  readdir(metadataDirectory).then((fileNames) => fileNames.sort()),
  readFile(`${migrationDirectory}/${baselineFileName}`, "utf8"),
  readJson(`${metadataDirectory}/${journalFileName}`),
  readJson(`${metadataDirectory}/${snapshotFileName}`),
  readFile(runtimeSchemaContractFileName, "utf8")
]);

assertExactSequence(
  migrationFileNames,
  [baselineFileName],
  "Migration directory must contain exactly the one Inbox V2 baseline SQL artifact"
);
assertExactSequence(
  metadataFileNames,
  [snapshotFileName, journalFileName].sort(),
  "Migration metadata directory must contain exactly one baseline snapshot and one journal"
);
assertBaselineJournal(journal);
assertRuntimeSchemaContract({ baselineSql, journal, runtimeSchemaContract });
assertBaselineSnapshotIdentity(snapshot);
assertLegacyObjectsAbsent({ baselineSql, snapshot });
assertRetainedObjectsPresent({ baselineSql, snapshot });
assertManagedRolesPresent(baselineSql);
assertOwnerPortableBaseline(baselineSql);
assertRequiredDatabaseRoutinesPresent(baselineSql);
assertRequiredTriggersPresent(baselineSql);
assertAclBoundaryPresent(baselineSql);
assertSecurityDefinersPinSafeSearchPath(baselineSql);

const generated = await generateExpectedDrizzleBaseline({
  workspaceRoot: process.cwd(),
  schemaPaths: [
    "packages/db/src/schema/tables.ts",
    "packages/db/src/schema/inbox-v2/*.ts"
  ]
});
assertDrizzleSnapshotParity(
  generated.snapshot,
  snapshot,
  `${metadataDirectory}/${snapshotFileName}`
);

console.log(
  [
    "DB check passed:",
    "one Inbox V2 baseline migration",
    "one journal entry and snapshot",
    "runtime schema epoch pinned to that exact baseline",
    "current Drizzle snapshot parity",
    "no Inbox V1 relations or enums",
    "retained platform/V2 objects",
    "managed roles, routines, triggers, ACLs, and SECURITY DEFINER search_path guards"
  ].join(" ")
);

function assertRuntimeSchemaContract({
  baselineSql,
  journal,
  runtimeSchemaContract
}) {
  const migrationHash = createHash("sha256").update(baselineSql).digest("hex");
  const createdAt = String(journal.entries[0].when);
  for (const [literal, label] of [
    [
      `export const INBOX_V2_RUNTIME_SCHEMA_EPOCH =\n  "preproduction-inbox-v2-1" as const;`,
      "clean-slate schema epoch"
    ],
    [`hash: "${migrationHash}"`, "baseline migration hash"],
    [`createdAt: "${createdAt}"`, "baseline journal timestamp"]
  ]) {
    if (!runtimeSchemaContract.includes(literal)) {
      throw new Error(
        `Runtime schema guard must pin the current ${label} exactly.`
      );
    }
  }
}

function assertBaselineJournal(value) {
  if (
    value?.version !== "7" ||
    value?.dialect !== "postgresql" ||
    !Array.isArray(value?.entries) ||
    value.entries.length !== 1
  ) {
    throw new Error(
      "Drizzle journal must be PostgreSQL v7 with exactly one baseline entry."
    );
  }

  const [entry] = value.entries;
  if (
    entry?.idx !== 0 ||
    entry?.version !== "7" ||
    entry?.tag !== baselineTag ||
    entry?.breakpoints !== true ||
    !Number.isSafeInteger(entry?.when) ||
    entry.when <= 0
  ) {
    throw new Error(
      `Drizzle journal entry must exclusively own ${baselineTag} at index 0.`
    );
  }
}

function assertBaselineSnapshotIdentity(value) {
  if (
    value?.version !== "7" ||
    value?.dialect !== "postgresql" ||
    value?.prevId !== "00000000-0000-0000-0000-000000000000" ||
    typeof value?.id !== "string" ||
    !value?.tables ||
    !value?.enums
  ) {
    throw new Error(
      "0000_snapshot.json must be a PostgreSQL v7 root snapshot with no predecessor."
    );
  }
}

function assertLegacyObjectsAbsent({ baselineSql, snapshot }) {
  for (const tableName of legacyTableNames) {
    assertSnapshotObjectAbsent(snapshot.tables, tableName, "table");
    assertPatternAbsent(
      baselineSql,
      new RegExp(
        `\\bCREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:public\\.|"public"\\.)?"?${escapeRegExp(tableName)}"?\\s*\\(`,
        "iu"
      ),
      `Inbox V1 table public.${tableName}`
    );
  }
  for (const enumName of legacyEnumNames) {
    assertSnapshotObjectAbsent(snapshot.enums, enumName, "enum");
    assertPatternAbsent(
      baselineSql,
      new RegExp(
        `\\bCREATE\\s+TYPE\\s+(?:public\\.|"public"\\.)?"?${escapeRegExp(enumName)}"?\\s+AS\\s+ENUM\\b`,
        "iu"
      ),
      `Inbox V1 enum public.${enumName}`
    );
  }
}

function assertRetainedObjectsPresent({ baselineSql, snapshot }) {
  for (const tableName of requiredTableNames) {
    assertSnapshotObjectPresent(snapshot.tables, tableName, "table");
    assertPatternPresent(
      baselineSql,
      new RegExp(
        `^CREATE\\s+TABLE\\s+public\\.${escapeRegExp(tableName)}\\s*\\(`,
        "imu"
      ),
      `retained table public.${tableName}`
    );
  }
  for (const enumName of requiredEnumNames) {
    assertSnapshotObjectPresent(snapshot.enums, enumName, "enum");
    assertPatternPresent(
      baselineSql,
      new RegExp(
        `^CREATE\\s+TYPE\\s+public\\.${escapeRegExp(enumName)}\\s+AS\\s+ENUM\\b`,
        "imu"
      ),
      `retained enum public.${enumName}`
    );
  }
}

function assertManagedRolesPresent(sql) {
  for (const roleName of requiredRoleNames) {
    assertPatternPresent(
      sql,
      new RegExp(`\\bcreate\\s+role\\s+${escapeRegExp(roleName)}\\b`, "iu"),
      `managed role bootstrap ${roleName}`
    );
    assertPatternPresent(
      sql,
      new RegExp(
        `\\balter\\s+role\\s+${escapeRegExp(roleName)}\\s+with\\s+nologin\\s+nosuperuser\\s+nocreatedb\\s+nocreaterole\\s+inherit\\s+noreplication\\s+nobypassrls\\s*;`,
        "iu"
      ),
      `least-privilege role hardening ${roleName}`
    );
    assertPatternPresent(
      sql,
      new RegExp(
        `^GRANT\\s+USAGE\\s+ON\\s+SCHEMA\\s+public\\s+TO\\s+${escapeRegExp(roleName)}\\s*;`,
        "imu"
      ),
      `schema ACL for ${roleName}`
    );
  }
}

function assertOwnerPortableBaseline(sql) {
  const allowedOwnerTargets = new Set([
    "pg_database_owner",
    ...requiredRoleNames
  ]);
  const ownerStatements = sql.matchAll(
    /^ALTER\s+[^\n]+\s+OWNER\s+TO\s+([^;\n]+);$/gimu
  );
  for (const statement of ownerStatements) {
    const ownerTarget = statement[1]?.trim();
    if (!allowedOwnerTargets.has(ownerTarget)) {
      throw new Error(
        `Inbox V2 baseline hard-codes deployment database owner ${ownerTarget}.`
      );
    }
  }
}

function assertRequiredDatabaseRoutinesPresent(sql) {
  for (const functionName of requiredFunctionNames) {
    assertPatternPresent(
      sql,
      new RegExp(
        `^CREATE\\s+FUNCTION\\s+public\\.${escapeRegExp(functionName)}\\s*\\(`,
        "imu"
      ),
      `Inbox V2 function public.${functionName}`
    );
  }
}

function assertRequiredTriggersPresent(sql) {
  for (const triggerName of requiredTriggerNames) {
    assertPatternPresent(
      sql,
      new RegExp(
        `^CREATE\\s+TRIGGER\\s+${escapeRegExp(triggerName)}\\b`,
        "imu"
      ),
      `Inbox V2 trigger ${triggerName}`
    );
  }
}

function assertAclBoundaryPresent(sql) {
  const privilegedFunctions = [
    "inbox_v2_advance_tenant_stream_retained_prefix_v1",
    "inbox_v2_apply_participant_membership_mutation_v1",
    "inbox_v2_lock_conversation_membership_head_v1",
    "inbox_v2_lock_participant_membership_mutation_v1"
  ];
  for (const functionName of privilegedFunctions) {
    assertPatternPresent(
      sql,
      new RegExp(
        `^REVOKE\\s+ALL\\s+ON\\s+FUNCTION\\s+public\\.${escapeRegExp(functionName)}\\([^\\r\\n]*\\)\\s+FROM\\s+PUBLIC\\s*;`,
        "imu"
      ),
      `PUBLIC execute revocation for public.${functionName}`
    );
  }

  const aclPatterns = [
    [
      /^GRANT ALL ON FUNCTION public\.inbox_v2_advance_tenant_stream_retained_prefix_v1\([^\r\n]*\) TO hulee_inbox_v2_runtime;$/imu,
      "retention advance runtime execute grant"
    ],
    [
      /^GRANT ALL ON FUNCTION public\.inbox_v2_apply_participant_membership_mutation_v1\([^\r\n]*\) TO hulee_inbox_v2_runtime;$/imu,
      "membership mutation runtime execute grant"
    ],
    [
      /^GRANT SELECT,DELETE ON TABLE public\.inbox_v2_domain_events TO hulee_inbox_v2_retention_owner;$/imu,
      "retention-owner domain-event ACL"
    ],
    [
      /^GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public\.inbox_v2_conversation_membership_heads TO hulee_inbox_v2_membership_owner;$/imu,
      "membership-owner head ACL"
    ],
    [
      /^GRANT SELECT,INSERT,UPDATE ON TABLE public\.inbox_v2_source_raw_admissions TO hulee_inbox_v2_runtime;$/imu,
      "source-ingress runtime ACL"
    ]
  ];
  for (const [pattern, label] of aclPatterns) {
    assertPatternPresent(sql, pattern, label);
  }
}

function assertSecurityDefinersPinSafeSearchPath(sql) {
  const objectHeaders = [
    ...sql.matchAll(
      /^--\r?\n-- Name: [^\r\n]+; Type: ([^;]+);[^\r\n]*\r?\n--$/gmu
    )
  ];
  const securityDefinerFunctions = [];
  for (let index = 0; index < objectHeaders.length; index += 1) {
    if (objectHeaders[index][1] !== "FUNCTION") continue;
    const start = objectHeaders[index].index;
    const end = objectHeaders[index + 1]?.index ?? sql.length;
    const section = sql.slice(start, end);
    if (/\bSECURITY\s+DEFINER\b/iu.test(section)) {
      securityDefinerFunctions.push(section);
    }
  }
  if (securityDefinerFunctions.length === 0) {
    throw new Error(
      "Baseline must retain its SECURITY DEFINER command functions."
    );
  }
  for (const section of securityDefinerFunctions) {
    if (
      !/\bSET\s+search_path\s+TO\s+'pg_catalog',\s*'public',\s*'pg_temp'/iu.test(
        section
      )
    ) {
      const name = section.match(/-- Name: ([^(;]+)/u)?.[1] ?? "unknown";
      throw new Error(
        `SECURITY DEFINER function ${name} must pin pg_catalog, public, pg_temp search_path.`
      );
    }
  }
}

function assertSnapshotObjectPresent(objects, objectName, kind) {
  if (!Object.hasOwn(objects, `public.${objectName}`)) {
    throw new Error(
      `0000_snapshot.json is missing retained ${kind} public.${objectName}.`
    );
  }
}

function assertSnapshotObjectAbsent(objects, objectName, kind) {
  if (Object.hasOwn(objects, `public.${objectName}`)) {
    throw new Error(
      `0000_snapshot.json must not contain Inbox V1 ${kind} public.${objectName}.`
    );
  }
}

function assertPatternPresent(source, pattern, label) {
  if (!pattern.test(source)) {
    throw new Error(`Baseline is missing ${label}.`);
  }
}

function assertPatternAbsent(source, pattern, label) {
  if (pattern.test(source)) {
    throw new Error(`Baseline must not contain ${label}.`);
  }
}

function assertExactSequence(actual, expected, message) {
  if (
    actual.length !== expected.length ||
    actual.some((value, index) => value !== expected[index])
  ) {
    throw new Error(`${message}; found: ${actual.join(", ") || "none"}.`);
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}
