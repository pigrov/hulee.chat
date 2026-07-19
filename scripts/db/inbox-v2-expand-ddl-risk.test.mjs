import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { readMigrationFiles } from "drizzle-orm/migrator";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  INBOX_V2_BLOCKING_DDL_MAX_RELATION_BYTES,
  classifyInboxV2PendingDdl,
  inspectInboxV2ExpandDdlRisk
} from "./inbox-v2-expand-ddl-risk.mjs";
import { splitMigrationStatements } from "../checks/db-check-lib.mjs";

describe("Inbox V2 preserve expand DDL risk", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("requires a reviewed online bridge for the exact MSG-004 revision and reference constraints", async () => {
    const migrationSql = await readFile(
      resolve("packages/db/drizzle/0054_inbox_v2_reply_and_forward.sql"),
      "utf8"
    );
    const migrations = [migration(splitMigrationStatements(migrationSql))];
    const relations = [
      relation("inbox_v2_message_revisions", 16 * 1024 * 1024, true),
      relation(
        "inbox_v2_message_reference_canonical_targets",
        16 * 1024 * 1024,
        true
      ),
      relation("inbox_v2_outbound_routes", 16 * 1024 * 1024, true)
    ];
    const report = await inspectInboxV2ExpandDdlRisk(
      evidenceClient({ databaseName: "hulee_production", relations }),
      { migrations, appliedCount: 0 }
    );

    expect(report).toMatchObject({
      pendingMigrationCount: 1,
      requiresOnlineBridge: true,
      reviewedOnlineBridgeRequested: false,
      reviewedOnlineBridgeAuthorized: false
    });
    expect(
      report.violations.map(({ relationName, riskKind, violationReason }) => ({
        relationName,
        riskKind,
        violationReason
      }))
    ).toEqual(
      expect.arrayContaining([
        {
          relationName: "inbox_v2_message_revisions",
          riskKind: "blocking_index",
          violationReason: "blocking_index_requires_bridge"
        },
        {
          relationName: "inbox_v2_message_reference_canonical_targets",
          riskKind: "destructive_contract_change",
          violationReason: "destructive_expand_requires_bridge"
        },
        {
          relationName: "inbox_v2_message_reference_canonical_targets",
          riskKind: "validated_constraint",
          violationReason: "validated_constraint_requires_bridge"
        },
        {
          relationName: "inbox_v2_outbound_routes",
          riskKind: "destructive_contract_change",
          violationReason: "destructive_expand_requires_bridge"
        },
        {
          relationName: "inbox_v2_outbound_routes",
          riskKind: "validated_constraint",
          violationReason: "validated_constraint_requires_bridge"
        }
      ])
    );

    const reviewed = await inspectInboxV2ExpandDdlRisk(
      evidenceClient({ databaseName: "hulee_production", relations }),
      { migrations, appliedCount: 0, allowReviewedOnlineBridge: true }
    );
    expect(reviewed).toMatchObject({
      requiresOnlineBridge: true,
      reviewedOnlineBridgeRequested: true,
      reviewedOnlineBridgeAuthorized: true
    });
  });

  it("classifies only operations against relations that existed before expand", () => {
    const migrations = [
      migration([
        'create table "new_relation" ("id" text primary key)',
        'create index "new_relation_idx" on "new_relation" ("id")',
        'alter table "raw_inbound_events" add column "scope" text generated always as (id) stored not null',
        'alter table "clients" add constraint "clients_tenant_unique" unique("tenant_id", "id")',
        'alter table "clients" add constraint "clients_tenant_fk" foreign key ("tenant_id") references "tenants"("id") not valid',
        'alter table "clients" validate constraint "clients_tenant_fk"',
        'alter table "clients" disable trigger "clients_guard"',
        'insert into "clients" ("id", "tenant_id") select "id", "tenant_id" from "legacy_clients"',
        'insert into "clients" ("id", "tenant_id") values (\'bounded\', \'tenant\')',
        'create index concurrently "clients_online_idx" on "clients" ("tenant_id")',
        'alter table "clients" drop constraint "clients_old_check"',
        'drop index "clients_old_idx"'
      ])
    ];

    const operations = classifyInboxV2PendingDdl({
      migrations,
      appliedCount: 0,
      existingRelationNames: [
        "raw_inbound_events",
        "clients",
        "legacy_clients"
      ],
      indexRelations: new Map([["clients_old_idx", "clients"]])
    });

    expect(
      operations.map(({ relationName, riskKind }) => ({
        relationName,
        riskKind
      }))
    ).toEqual([
      { relationName: "raw_inbound_events", riskKind: "table_rewrite" },
      { relationName: "clients", riskKind: "blocking_index" },
      {
        relationName: "clients",
        riskKind: "immediate_constraint_tightening"
      },
      { relationName: "clients", riskKind: "validation_scan" },
      { relationName: "clients", riskKind: "trigger_state_change" },
      { relationName: "clients", riskKind: "unbounded_data_backfill" },
      {
        relationName: "legacy_clients",
        riskKind: "unbounded_source_backfill"
      },
      {
        relationName: "clients",
        riskKind: "unclassified_existing_relation_ddl"
      },
      { relationName: "clients", riskKind: "online_index" },
      {
        relationName: "clients",
        riskKind: "destructive_contract_change"
      },
      {
        relationName: "clients",
        riskKind: "destructive_contract_change"
      }
    ]);
    expect(
      operations.every(({ statementSha256 }) =>
        /^sha256:[a-f0-9]{64}$/u.test(statementSha256)
      )
    ).toBe(true);
  });

  it("recognizes arbitrary quoted trigger, policy, rule and index names", () => {
    const operations = classifyInboxV2PendingDdl({
      migrations: [
        migration([
          'CREATE TRIGGER "clients guard" BEFORE UPDATE ON clients FOR EACH ROW EXECUTE FUNCTION guard_client()',
          'ALTER TRIGGER "clients guard" ON clients RENAME TO "clients guard v2"',
          'DROP TRIGGER "clients guard v2" ON clients',
          'CREATE POLICY "clients read policy" ON clients FOR SELECT USING (true)',
          'ALTER POLICY "clients read policy" ON clients USING (false)',
          'DROP POLICY "clients read policy" ON clients',
          'CREATE RULE "clients update rule" AS ON UPDATE TO clients DO INSTEAD NOTHING',
          'ALTER RULE "clients update rule" ON clients RENAME TO "clients update rule v2"',
          'DROP RULE "clients update rule v2" ON clients',
          'CREATE INDEX "clients search index" ON clients (id)'
        ])
      ],
      appliedCount: 0,
      existingRelationNames: ["unrelated", "clients"]
    });

    expect(
      operations.map(({ relationName, riskKind }) => ({
        relationName,
        riskKind
      }))
    ).toEqual([
      { relationName: "clients", riskKind: "trigger_state_change" },
      { relationName: "clients", riskKind: "trigger_state_change" },
      { relationName: "clients", riskKind: "trigger_state_change" },
      { relationName: "clients", riskKind: "security_policy_change" },
      { relationName: "clients", riskKind: "security_policy_change" },
      { relationName: "clients", riskKind: "security_policy_change" },
      { relationName: "clients", riskKind: "rule_change" },
      { relationName: "clients", riskKind: "rule_change" },
      { relationName: "clients", riskKind: "rule_change" },
      { relationName: "clients", riskKind: "blocking_index" }
    ]);
    expect(
      operations.every(
        (candidate) =>
          Object.hasOwn(candidate, "relationName") &&
          !Object.hasOwn(candidate, "relationScope")
      )
    ).toBe(true);
  });

  it("bounds ALTER TABLE or INDEX ALL IN TABLESPACE to one inventory operation", () => {
    const operations = classifyInboxV2PendingDdl({
      migrations: [
        migration([
          "ALTER TABLE ALL IN TABLESPACE old_space SET TABLESPACE new_space",
          "ALTER INDEX ALL IN TABLESPACE old_space SET TABLESPACE new_space"
        ])
      ],
      appliedCount: 0,
      existingRelationNames: ["zeta", "alpha"]
    });

    expect(operations.map(operationSummary)).toEqual([
      inventoryScopeSummary(2, "unclassified_existing_relation_ddl"),
      inventoryScopeSummary(2, "unclassified_existing_relation_ddl")
    ]);
    expect(operations[0].affectedRelationsSha256).toBe(
      operations[1].affectedRelationsSha256
    );
  });

  it("fails closed with one bounded operation for every unrecognized statement", () => {
    const operations = classifyInboxV2PendingDdl({
      migrations: [
        migration([
          "COMMENT ON TABLE clients IS 'customer records'",
          "DO $$ BEGIN PERFORM 1; END $$",
          "REFRESH MATERIALIZED VIEW client_rollup"
        ])
      ],
      appliedCount: 0,
      existingRelationNames: ["zeta", "alpha"]
    });

    expect(operations.map(operationSummary)).toEqual(
      Array.from({ length: 3 }, () =>
        inventoryScopeSummary(2, "unclassified_existing_relation_ddl")
      )
    );
    expect(
      new Set(
        operations.map(({ affectedRelationsSha256 }) => affectedRelationsSha256)
      )
    ).toHaveLength(1);
  });

  it("keeps an empty fresh database safe even for unrecognized statements", () => {
    const operations = classifyInboxV2PendingDdl({
      migrations: [
        migration([
          "COMMENT ON DATABASE current_database IS 'fresh database'",
          "DO $$ BEGIN PERFORM 1; END $$",
          "REFRESH MATERIALIZED VIEW client_rollup"
        ])
      ],
      appliedCount: 0,
      existingRelationNames: []
    });

    expect(operations).toEqual([]);
  });

  it("keeps a 10k relation inventory bounded and hashes normalized sorted names", () => {
    const relationNames = Array.from(
      { length: 10_000 },
      (_, index) => `relation_${String(index).padStart(5, "0")}`
    );
    const options = {
      migrations: [migration(["DO $$ BEGIN PERFORM 1; END $$"])],
      appliedCount: 0
    };
    const reversed = classifyInboxV2PendingDdl({
      ...options,
      existingRelationNames: [...relationNames].reverse()
    });
    const sorted = classifyInboxV2PendingDdl({
      ...options,
      existingRelationNames: relationNames
    });
    const expectedDigest = `sha256:${createHash("sha256")
      .update(
        `hulee:inbox-v2.expand-ddl-risk:pre-expand-public-inventory@v1\0${JSON.stringify(
          relationNames
        )}`
      )
      .digest("hex")}`;

    expect(reversed).toHaveLength(1);
    expect(reversed).toEqual(sorted);
    expect(operationSummary(reversed[0])).toEqual({
      relationScope: "pre_expand_public_inventory",
      affectedRelationCount: 10_000,
      affectedRelationsSha256: expectedDigest,
      riskKind: "unclassified_existing_relation_ddl"
    });
    expect(Object.hasOwn(reversed[0], "relationName")).toBe(false);
    expect(Object.hasOwn(reversed[0], "affectedRelations")).toBe(false);
    expect(JSON.stringify(reversed[0])).not.toContain("relation_00000");
  });

  it("keeps clearly local DDL on an absent relation safe", () => {
    const operations = classifyInboxV2PendingDdl({
      migrations: [
        migration([
          "CREATE TABLE new_relation (id text)",
          "ALTER TABLE new_relation ADD COLUMN note text",
          'CREATE INDEX "new relation index" ON new_relation (id)',
          'CREATE TRIGGER "new relation trigger" BEFORE UPDATE ON new_relation FOR EACH ROW EXECUTE FUNCTION guard_client()',
          'CREATE POLICY "new relation policy" ON new_relation USING (true)',
          'CREATE RULE "new relation rule" AS ON UPDATE TO new_relation DO INSTEAD NOTHING'
        ])
      ],
      appliedCount: 0,
      existingRelationNames: ["clients"]
    });

    expect(operations).toEqual([]);
  });

  it("does not exempt absent UPDATE or DELETE targets from fail-closed fan-out", () => {
    const operations = classifyInboxV2PendingDdl({
      migrations: [
        migration([
          "UPDATE new_relation SET id = clients.id FROM clients",
          "DELETE FROM new_relation USING clients WHERE new_relation.id = clients.id"
        ])
      ],
      appliedCount: 0,
      existingRelationNames: ["clients"]
    });

    expect(operations.map(operationSummary)).toEqual([
      inventoryScopeSummary(1, "unclassified_existing_relation_ddl"),
      inventoryScopeSummary(1, "unclassified_existing_relation_ddl")
    ]);
  });

  it("does not treat executable DML or CREATE TABLE AS expressions as local metadata", () => {
    const operations = classifyInboxV2PendingDdl({
      migrations: [
        migration([
          "INSERT INTO new_relation (id) VALUES (dangerous_function())",
          "INSERT INTO new_relation DEFAULT VALUES",
          "CREATE TABLE constant_copy AS SELECT dangerous_function() AS id",
          "CREATE TABLE values_copy AS VALUES (dangerous_function())",
          "ALTER INDEX new_relation_idx ATTACH PARTITION clients_idx",
          "TRUNCATE TABLE new_relation"
        ])
      ],
      appliedCount: 0,
      existingRelationNames: ["clients"]
    });

    expect(operations.map(operationSummary)).toEqual(
      Array.from({ length: 6 }, () =>
        inventoryScopeSummary(1, "unclassified_existing_relation_ddl")
      )
    );
  });

  it("blocks absent ALTER and VALUES subqueries that depend on existing relations", () => {
    const operations = classifyInboxV2PendingDdl({
      migrations: [
        migration([
          "ALTER TABLE new_relation ADD COLUMN client_id text REFERENCES clients(id)",
          "ALTER TABLE new_relation INHERIT clients",
          "ALTER TABLE new_relation ATTACH PARTITION clients FOR VALUES IN ('active')",
          "INSERT INTO new_relation (id) VALUES ((SELECT id FROM clients LIMIT 1))"
        ])
      ],
      appliedCount: 0,
      existingRelationNames: ["clients"]
    });

    expect(operations.map(operationSummary)).toEqual([
      inventoryScopeSummary(1, "unclassified_existing_relation_ddl"),
      {
        relationName: "clients",
        riskKind: "unclassified_existing_relation_ddl"
      },
      {
        relationName: "clients",
        riskKind: "unclassified_existing_relation_ddl"
      },
      {
        relationName: "clients",
        riskKind: "unbounded_source_backfill"
      },
      inventoryScopeSummary(1, "unclassified_existing_relation_ddl")
    ]);
  });

  it("blocks CREATE TABLE statements that read or depend on existing relations", () => {
    const operations = classifyInboxV2PendingDdl({
      migrations: [
        migration([
          "CREATE TABLE copied_clients AS SELECT * FROM clients",
          "CREATE TABLE client_partition PARTITION OF clients FOR VALUES IN ('active')",
          "CREATE TABLE client_shape (LIKE clients INCLUDING ALL)",
          "CREATE TABLE client_reference (client_id text REFERENCES clients(id))",
          "CREATE TABLE inherited_clients (note text) INHERITS (clients)",
          "CREATE TABLE table_copy AS TABLE clients",
          "CREATE TABLE prepared_copy AS EXECUTE load_clients()"
        ])
      ],
      appliedCount: 0,
      existingRelationNames: ["clients"]
    });

    expect(operations.map(operationSummary)).toEqual([
      { relationName: "clients", riskKind: "unbounded_source_backfill" },
      {
        relationName: "clients",
        riskKind: "unclassified_existing_relation_ddl"
      },
      {
        relationName: "clients",
        riskKind: "unclassified_existing_relation_ddl"
      },
      {
        relationName: "clients",
        riskKind: "unclassified_existing_relation_ddl"
      },
      inventoryScopeSummary(1, "unclassified_existing_relation_ddl"),
      { relationName: "clients", riskKind: "unbounded_source_backfill" },
      inventoryScopeSummary(1, "unclassified_existing_relation_ddl")
    ]);
  });

  it("requires an online bridge for validation, trigger and backfill operations", async () => {
    const report = await inspectInboxV2ExpandDdlRisk(
      evidenceClient({
        databaseName: "shared_saas",
        relations: [
          relation(
            "clients",
            INBOX_V2_BLOCKING_DDL_MAX_RELATION_BYTES + 1,
            true
          ),
          relation("messages", 8192, true),
          relation("legacy_messages", 8192, true)
        ]
      }),
      {
        migrations: [
          migration([
            'alter table "clients" validate constraint "clients_tenant_fk"',
            'alter table "messages" enable trigger "messages_guard"',
            'insert into "messages" ("id") with candidates as (select "id" from "legacy_messages") select "id" from candidates'
          ])
        ],
        appliedCount: 0
      }
    );

    expect(
      report.violations.map(({ riskKind, violationReason }) => ({
        riskKind,
        violationReason
      }))
    ).toEqual([
      {
        riskKind: "validation_scan",
        violationReason: "validation_scan_requires_bridge"
      },
      {
        riskKind: "trigger_state_change",
        violationReason: "trigger_change_requires_bridge"
      },
      {
        riskKind: "unbounded_data_backfill",
        violationReason: "unbounded_target_backfill_requires_bridge"
      },
      {
        riskKind: "unbounded_source_backfill",
        violationReason: "unbounded_source_backfill_requires_bridge"
      }
    ]);
    expect(report.requiresOnlineBridge).toBe(true);
  });

  it("does not treat relation-looking literals or comments as backfill sources", () => {
    const operations = classifyInboxV2PendingDdl({
      migrations: [
        migration([
          `insert into "new_target" ("payload", "metadata")
           select
             'from public.clients; join public.tenants',
             $evidence$join public.employees; from public.accounts$evidence$
             /* from public.source_connections */
             -- join public.source_accounts
           from public.real_source`
        ])
      ],
      appliedCount: 0,
      existingRelationNames: [
        "accounts",
        "clients",
        "employees",
        "real_source",
        "source_accounts",
        "source_connections",
        "tenants"
      ]
    });

    expect(operations.map(operationSummary)).toEqual([
      {
        relationName: "real_source",
        riskKind: "unbounded_source_backfill"
      },
      inventoryScopeSummary(7, "unclassified_existing_relation_ddl")
    ]);
  });

  it("handles leading nested comments, IF EXISTS/ONLY and fails closed for multi-action or unknown ALTER", () => {
    const operations = classifyInboxV2PendingDdl({
      migrations: [
        migration([
          `-- generated preface
           /* outer /* nested */ block */
           ALTER TABLE IF EXISTS ONLY public.clients ADD COLUMN "note" text`,
          `/* multi action */ ALTER TABLE IF EXISTS public.clients
             ADD COLUMN "temporary" text,
             DROP COLUMN "legacy"`,
          "ALTER TABLE ONLY public.clients OWNER TO application_role",
          "ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY",
          `ALTER TABLE public.clients
             ADD CONSTRAINT "clients_kind_check"
             CHECK ("kind" IN ('lead', 'customer')) NOT VALID`
        ])
      ],
      appliedCount: 0,
      existingRelationNames: ["clients"]
    });

    expect(operations.map(({ riskKind }) => riskKind)).toEqual([
      "metadata_lock",
      "unclassified_existing_relation_ddl",
      "unclassified_existing_relation_ddl",
      "security_policy_change",
      "immediate_constraint_tightening"
    ]);
    expect(() =>
      classifyInboxV2PendingDdl({
        migrations: [
          migration([
            "/* unterminated /* nested */ ALTER TABLE clients DROP COLUMN old"
          ])
        ],
        appliedCount: 0,
        existingRelationNames: ["clients"]
      })
    ).toThrowError(/unterminated leading block comment/u);
  });

  it("recognizes comments between DDL keywords and relations plus nameless indexes", () => {
    const operations = classifyInboxV2PendingDdl({
      migrations: [
        migration([
          "ALTER /* outer /* nested */ comment */ TABLE /* target */ public.clients DROP COLUMN legacy",
          "DROP /* generated */ TABLE /* target */ public.clients",
          "CREATE /* generated */ INDEX /* unnamed */ ON /* target */ public.clients (id)",
          "CREATE INDEX CONCURRENTLY ON public.clients (id)"
        ])
      ],
      appliedCount: 0,
      existingRelationNames: ["clients"]
    });

    expect(operations.map(({ riskKind }) => riskKind)).toEqual([
      "destructive_contract_change",
      "destructive_contract_change",
      "blocking_index",
      "online_index"
    ]);
  });

  it("keeps metadata-only ADD COLUMN narrow and blocks inline modifiers", () => {
    const operations = classifyInboxV2PendingDdl({
      migrations: [
        migration([
          "ALTER TABLE clients ADD COLUMN optional_code varchar(64) NULL",
          "ALTER TABLE clients ADD COLUMN tenant_id text REFERENCES tenants(id)",
          "ALTER TABLE clients ADD COLUMN score integer CHECK (score >= 0)",
          "ALTER TABLE clients ADD COLUMN external_id text UNIQUE",
          "ALTER TABLE clients ADD COLUMN ordinal bigint PRIMARY KEY",
          "ALTER TABLE clients ADD COLUMN sequence_id bigint GENERATED BY DEFAULT AS IDENTITY",
          "ALTER TABLE clients ADD COLUMN legacy_id bigserial",
          "ALTER TABLE clients ADD COLUMN domain_value company.customer_code"
        ])
      ],
      appliedCount: 0,
      existingRelationNames: ["clients"]
    });

    expect(operations.map(({ riskKind }) => riskKind)).toEqual([
      "metadata_lock",
      "validated_constraint",
      "validated_constraint",
      "blocking_index",
      "blocking_index",
      "table_rewrite",
      "table_rewrite",
      "unclassified_existing_relation_ddl"
    ]);
  });

  it("classifies RULE changes and bounds global maintenance without row fan-out", async () => {
    const migrations = [
      migration([
        "CREATE /* generated */ RULE clients_guard AS ON UPDATE TO /* target */ public.alpha DO INSTEAD NOTHING",
        "ALTER RULE clients_guard ON public.alpha RENAME TO clients_guard_v2",
        "DROP RULE IF EXISTS clients_guard_v2 ON public.alpha",
        "REINDEX SCHEMA public",
        "REINDEX DATABASE current",
        "REINDEX SYSTEM current",
        "CLUSTER",
        "VACUUM FULL"
      ])
    ];
    const operations = classifyInboxV2PendingDdl({
      migrations,
      appliedCount: 0,
      existingRelationNames: ["zeta", "alpha"]
    });

    expect(operations.map(operationSummary)).toEqual([
      { relationName: "alpha", riskKind: "rule_change" },
      { relationName: "alpha", riskKind: "rule_change" },
      { relationName: "alpha", riskKind: "rule_change" },
      ...Array.from({ length: 5 }, () =>
        inventoryScopeSummary(2, "blocking_maintenance")
      )
    ]);

    const client = evidenceClient({
      databaseName: "empty_global_maintenance",
      relations: [relation("alpha", 0, false), relation("zeta", 0, false)]
    });
    const report = await inspectInboxV2ExpandDdlRisk(client, {
      migrations,
      appliedCount: 0
    });
    expect(report.violationCount).toBe(8);
    expect(
      report.violations.map(({ violationReason }) => violationReason)
    ).toEqual([
      "rule_change_requires_bridge",
      "rule_change_requires_bridge",
      "rule_change_requires_bridge",
      ...Array.from({ length: 5 }, () => "blocking_maintenance_requires_bridge")
    ]);
    expect(report.relations).toEqual([
      { relationName: "alpha", totalBytes: 0, nonEmpty: false }
    ]);
    expect(
      client.query.mock.calls.filter(([statement]) =>
        statement.includes("select exists")
      )
    ).toHaveLength(1);
  });

  it("classifies trigger, policy, destructive table and blocking maintenance statements", () => {
    const operations = classifyInboxV2PendingDdl({
      migrations: [
        migration([
          'CREATE TRIGGER "clients_guard" BEFORE UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION public.guard_client()',
          'ALTER TRIGGER "clients_guard" ON public.clients RENAME TO "clients_guard_v2"',
          'DROP TRIGGER IF EXISTS "clients_guard_v2" ON public.clients',
          'CREATE POLICY "clients_read" ON public.clients FOR SELECT USING (true)',
          'ALTER POLICY "clients_read" ON public.clients USING (false)',
          'DROP POLICY IF EXISTS "clients_read" ON public.clients',
          "DROP TABLE IF EXISTS ONLY public.clients CASCADE",
          "DROP TABLE IF EXISTS public.new_relation, public.clients RESTRICT",
          "REINDEX TABLE public.clients",
          "REINDEX INDEX public.clients_old_idx",
          "ALTER INDEX IF EXISTS public.clients_old_idx RENAME TO clients_legacy_idx",
          "CLUSTER public.clients",
          "VACUUM (FULL, ANALYZE) public.clients",
          "LOCK TABLE ONLY public.clients IN ACCESS EXCLUSIVE MODE"
        ])
      ],
      appliedCount: 0,
      existingRelationNames: ["clients"],
      indexRelations: new Map([["clients_old_idx", "clients"]])
    });

    expect(operations.map(({ riskKind }) => riskKind)).toEqual([
      "trigger_state_change",
      "trigger_state_change",
      "trigger_state_change",
      "security_policy_change",
      "security_policy_change",
      "security_policy_change",
      "destructive_contract_change",
      "destructive_contract_change",
      "blocking_maintenance",
      "blocking_maintenance",
      "unclassified_existing_relation_ddl",
      "blocking_maintenance",
      "blocking_maintenance",
      "explicit_table_lock"
    ]);
  });

  it("requires a bridge for risky operations on empty small pre-existing relations", async () => {
    const report = await inspectInboxV2ExpandDdlRisk(
      evidenceClient({
        databaseName: "empty_small_preserve",
        relations: [
          relation("clients", 0, false),
          relation("legacy_messages", 0, false),
          relation("messages", 0, false),
          relation("raw_inbound_events", 0, false)
        ]
      }),
      {
        migrations: [
          migration([
            "ALTER TABLE raw_inbound_events ADD COLUMN scope text GENERATED ALWAYS AS (id) STORED",
            "UPDATE clients SET updated_at = now()",
            "INSERT INTO messages (id) SELECT id FROM legacy_messages",
            "ALTER TABLE messages ENABLE TRIGGER ALL",
            "CREATE INDEX clients_idx ON clients (id)",
            "CREATE INDEX CONCURRENTLY clients_online_idx ON clients (id)",
            "ALTER TABLE clients ADD CONSTRAINT clients_check CHECK (id <> '')",
            "ALTER TABLE clients VALIDATE CONSTRAINT clients_check",
            "ALTER TABLE clients DROP CONSTRAINT clients_check",
            "ALTER TABLE clients OWNER TO application_role",
            "CREATE POLICY clients_read ON clients FOR SELECT USING (true)",
            "ALTER TABLE clients ADD COLUMN optional_note text",
            "ALTER TABLE clients ADD CONSTRAINT clients_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id) NOT VALID"
          ])
        ],
        appliedCount: 0
      }
    );

    expect(report).toMatchObject({
      operationCount: 14,
      violationCount: 13,
      requiresOnlineBridge: true
    });
    expect(
      report.violations.map(({ riskKind, violationReason }) => ({
        riskKind,
        violationReason
      }))
    ).toEqual([
      {
        riskKind: "table_rewrite",
        violationReason: "existing_relation_rewrite_requires_bridge"
      },
      {
        riskKind: "data_rewrite",
        violationReason: "existing_relation_rewrite_requires_bridge"
      },
      {
        riskKind: "unbounded_data_backfill",
        violationReason: "unbounded_target_backfill_requires_bridge"
      },
      {
        riskKind: "unbounded_source_backfill",
        violationReason: "unbounded_source_backfill_requires_bridge"
      },
      {
        riskKind: "trigger_state_change",
        violationReason: "trigger_change_requires_bridge"
      },
      {
        riskKind: "blocking_index",
        violationReason: "blocking_index_requires_bridge"
      },
      {
        riskKind: "online_index",
        violationReason: "concurrent_index_requires_bridge_executor"
      },
      {
        riskKind: "validated_constraint",
        violationReason: "validated_constraint_requires_bridge"
      },
      {
        riskKind: "validation_scan",
        violationReason: "validation_scan_requires_bridge"
      },
      {
        riskKind: "destructive_contract_change",
        violationReason: "destructive_expand_requires_bridge"
      },
      {
        riskKind: "unclassified_existing_relation_ddl",
        violationReason: "unclassified_existing_relation_ddl_requires_bridge"
      },
      {
        riskKind: "security_policy_change",
        violationReason: "security_policy_change_requires_bridge"
      },
      {
        riskKind: "immediate_constraint_tightening",
        violationReason: "immediate_constraint_tightening_requires_bridge"
      }
    ]);
    expect(report.relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ totalBytes: 0, nonEmpty: false })
      ])
    );
    expect(
      report.operations.filter(({ riskKind }) => riskKind === "metadata_lock")
    ).toHaveLength(1);
  });

  it("fails closed for rewrites, blocking DDL and destructive changes", async () => {
    const client = evidenceClient({
      databaseName: "shared_saas",
      relations: [
        {
          relation_name: "raw_inbound_events",
          total_bytes: "8192",
          nonEmpty: true
        },
        {
          relation_name: "clients",
          total_bytes: String(INBOX_V2_BLOCKING_DDL_MAX_RELATION_BYTES + 1),
          nonEmpty: true
        }
      ],
      indexes: [{ index_name: "clients_old_idx", relation_name: "clients" }]
    });
    const report = await inspectInboxV2ExpandDdlRisk(client, {
      migrations: [
        migration([
          'alter table "raw_inbound_events" add column "scope" text generated always as (id) stored not null',
          'create index "clients_idx" on "clients" ("tenant_id")',
          'drop index "clients_old_idx"'
        ])
      ],
      appliedCount: 0
    });

    expect(report).toMatchObject({
      schemaId: "core:inbox-v2.expand-ddl-risk-evidence@v2",
      violationCount: 3,
      requiresOnlineBridge: true,
      overrideRequested: false,
      overrideAuthorized: false
    });
    expect(
      report.violations.map(({ violationReason }) => violationReason)
    ).toEqual([
      "existing_relation_rewrite_requires_bridge",
      "blocking_index_requires_bridge",
      "destructive_expand_requires_bridge"
    ]);
    expect(report.reportSha256).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(Object.isFrozen(report)).toBe(true);
  });

  it("authorizes the compatibility override only for strict ephemeral DB-008 integration tests", async () => {
    const migrationBundle = [
      migration(['alter table "messages" drop constraint "messages_old_check"'])
    ];
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("HULEE_DB_INTEGRATION", "1");
    const forbidden = await inspectInboxV2ExpandDdlRisk(
      evidenceClient({
        databaseName: "production",
        relations: [relation("messages", 8192, true)]
      }),
      {
        migrations: migrationBundle,
        appliedCount: 0,
        allowEphemeralBlockingDdlCompatibilityTest: true
      }
    );
    const allowed = await inspectInboxV2ExpandDdlRisk(
      evidenceClient({
        databaseName: "hulee_db008_preserve_upgrade_a1b2",
        relations: [relation("messages", 8192, true)]
      }),
      {
        migrations: migrationBundle,
        appliedCount: 0,
        allowEphemeralBlockingDdlCompatibilityTest: true
      }
    );

    expect(forbidden.overrideRequested).toBe(true);
    expect(forbidden.overrideAuthorized).toBe(false);
    expect(allowed.overrideAuthorized).toBe(true);
    expect(allowed.databaseRef).not.toContain("hulee_db008");
  });

  it("refuses the compatibility override without both test process guards", async () => {
    const options = {
      migrations: [
        migration([
          'alter table "messages" drop constraint "messages_old_check"'
        ])
      ],
      appliedCount: 0,
      allowEphemeralBlockingDdlCompatibilityTest: true
    };
    const clientOptions = {
      databaseName: "hulee_db008_n1_upgrade_a1b2",
      relations: [relation("messages", 8192, true)]
    };

    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("HULEE_DB_INTEGRATION", "1");
    const production = await inspectInboxV2ExpandDdlRisk(
      evidenceClient(clientOptions),
      options
    );

    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("HULEE_DB_INTEGRATION", "0");
    const nonIntegration = await inspectInboxV2ExpandDdlRisk(
      evidenceClient(clientOptions),
      options
    );

    expect(production.overrideAuthorized).toBe(false);
    expect(nonIntegration.overrideAuthorized).toBe(false);
  });

  it("records an explicitly reviewed online bridge separately from the test override", async () => {
    const report = await inspectInboxV2ExpandDdlRisk(
      evidenceClient({
        databaseName: "production",
        relations: [relation("messages", 8192, true)]
      }),
      {
        migrations: [
          migration([
            'alter table "messages" drop constraint "messages_old_check"'
          ])
        ],
        appliedCount: 0,
        allowReviewedOnlineBridge: true
      }
    );

    expect(report).toMatchObject({
      requiresOnlineBridge: true,
      overrideRequested: false,
      overrideAuthorized: false,
      reviewedOnlineBridgeRequested: true,
      reviewedOnlineBridgeAuthorized: true
    });
  });

  it("detects the checked-in populated 0029 rewrite and 0036 destructive boundary", () => {
    const migrations = readMigrationFiles({
      migrationsFolder: "packages/db/drizzle"
    });
    const from0027 = classifyInboxV2PendingDdl({
      migrations,
      appliedCount: 28,
      existingRelationNames: [
        "accounts",
        "client_contacts",
        "clients",
        "employees",
        "normalized_inbound_events",
        "raw_inbound_events",
        "source_accounts",
        "source_connections",
        "tenants"
      ]
    });
    const from0034 = classifyInboxV2PendingDdl({
      migrations,
      appliedCount: 35,
      existingRelationNames: [
        "accounts",
        "inbox_v2_tenant_stream_changes",
        "inbox_v2_domain_events",
        "inbox_v2_outbox_intents",
        "inbox_v2_data_governance_subject_links"
      ]
    });

    expect(from0027).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          migrationIndex: 29,
          relationName: "raw_inbound_events",
          riskKind: "table_rewrite"
        }),
        expect.objectContaining({
          migrationIndex: 29,
          relationName: "normalized_inbound_events",
          riskKind: "blocking_index"
        }),
        expect.objectContaining({
          migrationIndex: 29,
          relationName: "tenants",
          riskKind: "unbounded_source_backfill"
        }),
        expect.objectContaining({
          migrationIndex: 29,
          relationName: "clients",
          riskKind: "unbounded_source_backfill"
        }),
        expect.objectContaining({
          migrationIndex: 30,
          relationName: "employees",
          riskKind: "unbounded_source_backfill"
        })
      ])
    );
    expect(from0034).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          migrationIndex: 36,
          relationName: "inbox_v2_tenant_stream_changes",
          riskKind: "destructive_contract_change"
        }),
        expect.objectContaining({
          migrationIndex: 36,
          relationName: "inbox_v2_tenant_stream_changes",
          riskKind: "trigger_state_change"
        }),
        expect.objectContaining({
          migrationIndex: 36,
          relationName: "inbox_v2_tenant_stream_changes",
          riskKind: "data_rewrite"
        }),
        expect.objectContaining({
          migrationIndex: 36,
          relationName: "inbox_v2_outbox_intents",
          riskKind: "unbounded_source_backfill"
        })
      ])
    );
  });
});

function migration(sql) {
  return { sql, folderMillis: 1, hash: "hash" };
}

function operationSummary(operation) {
  if (Object.hasOwn(operation, "relationName")) {
    return {
      relationName: operation.relationName,
      riskKind: operation.riskKind
    };
  }
  return {
    relationScope: operation.relationScope,
    affectedRelationCount: operation.affectedRelationCount,
    affectedRelationsSha256: operation.affectedRelationsSha256,
    riskKind: operation.riskKind
  };
}

function inventoryScopeSummary(affectedRelationCount, riskKind) {
  return {
    relationScope: "pre_expand_public_inventory",
    affectedRelationCount,
    affectedRelationsSha256: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
    riskKind
  };
}

function relation(relationName, totalBytes, nonEmpty) {
  return {
    relation_name: relationName,
    total_bytes: String(totalBytes),
    nonEmpty
  };
}

function evidenceClient({ databaseName, relations, indexes = [] }) {
  const query = vi.fn(async (statement) => {
    if (statement === "select current_database() as database_name") {
      return { rows: [{ database_name: databaseName }] };
    }
    if (statement.includes("pg_catalog.pg_partition_tree")) {
      return {
        rows: relations.map(({ relation_name, total_bytes }) => ({
          relation_name,
          total_bytes
        }))
      };
    }
    if (statement.includes("from pg_catalog.pg_index")) {
      return { rows: indexes };
    }
    const relationName = statement.match(
      /from public\."([a-z_][a-z0-9_]*)"/u
    )?.[1];
    const relationRow = relations.find(
      ({ relation_name }) => relation_name === relationName
    );
    if (relationRow !== undefined) {
      return { rows: [{ non_empty: relationRow.nonEmpty }] };
    }
    throw new Error(`Unexpected query: ${statement}`);
  });
  return { query };
}
