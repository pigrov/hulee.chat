import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  InboxV2RbacDryRunError,
  buildInboxV2RbacDryRun,
  readInboxV1RbacSnapshot,
  runInboxV2RbacDryRun,
  runInboxV2RbacDryRunCli,
  stringifyInboxV2RbacDryRun
} from "./inbox-v2-rbac-dry-run.mjs";

const observedAt = "2026-07-16T06:00:00.000Z";
const tenantId = "tenant:alpha";

describe("Inbox V2 DB-level RBAC dry-run", () => {
  it("maps every persisted binding-permission pair and direct grant without broadening", () => {
    const input = representativeInput();

    const report = buildInboxV2RbacDryRun(input);

    expect(report).toMatchObject({
      schemaId: "core:inbox-v2.rbac-dry-run",
      schemaVersion: "v1",
      tenantId,
      observedAt,
      counts: {
        mapped: 5,
        reviewRequired: 2,
        compatibilityOnly: 1,
        invalid: 2
      },
      broadenedAccessCount: 0,
      readyForAutomaticApply: false
    });
    expect(report.entries).toHaveLength(10);
    expect(report.summary.roleBindingPermissionPairCount).toBe(6);
    expect(report.summary.directGrantCount).toBe(4);
    expect(report.summary.temporalCounts).toEqual({
      active: 6,
      scheduled: 2,
      expired: 1,
      revoked: 1
    });
    expect(
      report.entries.every((entry) => entry.broadenedAccess === false)
    ).toBe(true);
    expect(
      report.entries.find(
        ({ permissionId, temporalStatus }) =>
          permissionId === "modules.manage" && temporalStatus === "revoked"
      )
    ).toMatchObject({
      outcome: "compatibility_only",
      decisionCode: "outside_inbox_v2",
      applicationDisposition: "retain_v1"
    });
    expect(
      report.entries.find(
        ({ permissionId, temporalStatus }) =>
          permissionId === "reports.view" && temporalStatus === "scheduled"
      )
    ).toMatchObject({
      outcome: "mapped",
      semanticRestriction: "aggregate_only",
      applicationDisposition: "preserve_schedule"
    });
    expect(
      report.entries.find(
        ({ permissionId, validationCodes }) =>
          permissionId === "inbox.read" &&
          validationCodes.includes("scope_target_tenant_mismatch")
      )
    ).toMatchObject({
      outcome: "invalid",
      decisionCode: "source_validation_failed"
    });
    expect(
      report.entries.find(({ validationCodes }) =>
        validationCodes.includes("subject_deactivated")
      )
    ).toMatchObject({
      outcome: "invalid",
      subject: { type: "employee", status: "deactivated" }
    });

    const serialized = stringifyInboxV2RbacDryRun(report);
    expect(serialized).not.toContain("Customer named in reason");
    expect(serialized).not.toContain("operator@example.test");
    expect(serialized).not.toContain("employee:operator");
    expect(serialized).not.toContain("grant:cross-tenant-target");
    expect(serialized).not.toContain("work_queue:tenant-b-only");
    expect(serialized).toContain(report.reportSha256);
    expect(report.source.catalog.sha256).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(report.source.journal.sha256).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(report.mappingSha256).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it("is deterministic across raw row order and excludes non-contract columns", () => {
    const firstInput = representativeInput();
    const secondInput = structuredClone(firstInput);
    for (const rows of Object.values(secondInput.snapshot)) rows.reverse();
    secondInput.snapshot.directGrants[0].reason = "A different PII reason";
    secondInput.snapshot.employees[0].email = "changed@example.test";

    const first = buildInboxV2RbacDryRun(firstInput);
    const second = buildInboxV2RbacDryRun(secondInput);

    expect(second).toEqual(first);
    expect(second.mappingSha256).toBe(first.mappingSha256);
    expect(second.reportSha256).toBe(first.reportSha256);
  });

  it("uses ordinal code-unit ordering for report entries and journal digests", () => {
    const input = representativeInput();
    input.snapshot.roleBindings = [];
    input.snapshot.roles = [];
    input.snapshot.rolePermissions = [];
    input.snapshot.directGrants = [
      grant("grant:umlaut", "employee:operator", "ä.permission"),
      grant("grant:z", "employee:operator", "z.permission")
    ];
    input.sourceJournal.rows = [
      { id: "ä", hash: "hash-umlaut", created_at: "1" },
      { id: "z", hash: "hash-z", created_at: "1" }
    ];

    const report = buildInboxV2RbacDryRun(input);
    const reversedInput = structuredClone(input);
    reversedInput.snapshot.directGrants.reverse();
    reversedInput.sourceJournal.rows.reverse();

    expect(report.entries.map(({ permissionId }) => permissionId)).toEqual([
      "z.permission",
      "ä.permission"
    ]);
    expect(report.source.journal.sha256).toBe(
      sha256Json([
        { createdAt: "1", hash: "hash-z" },
        { createdAt: "1", hash: "hash-umlaut" }
      ])
    );
    expect(buildInboxV2RbacDryRun(reversedInput)).toEqual(report);
  });

  it("keeps the mapping digest stable while binding the full report to its journal", () => {
    const before = buildInboxV2RbacDryRun(representativeInput());
    const afterInput = representativeInput();
    afterInput.sourceJournal.rows.push({
      id: "2",
      hash: "migration-hash-2",
      created_at: "1784118691728"
    });
    const after = buildInboxV2RbacDryRun(afterInput);

    expect(after.entries).toEqual(before.entries);
    expect(after.mappingSha256).toBe(before.mappingSha256);
    expect(after.source.journal.sha256).not.toBe(before.source.journal.sha256);
    expect(after.reportSha256).not.toBe(before.reportSha256);
  });

  it("marks an automatic-only, fully validated snapshot ready", () => {
    const input = representativeInput();
    input.snapshot.roles = [
      { id: "role:mapped", tenant_id: tenantId, status: "active" }
    ];
    input.snapshot.rolePermissions = [
      {
        tenant_id: tenantId,
        role_id: "role:mapped",
        permission: "inbox.read"
      }
    ];
    input.snapshot.roleBindings = [
      binding("binding:active", "role:mapped", "tenant", null)
    ];
    input.snapshot.directGrants = [];

    const report = buildInboxV2RbacDryRun(input);

    expect(report).toMatchObject({
      counts: {
        mapped: 1,
        reviewRequired: 0,
        compatibilityOnly: 0,
        invalid: 0
      },
      broadenedAccessCount: 0,
      readyForAutomaticApply: true
    });
    expect(report.entries[0]).toMatchObject({
      outcome: "mapped",
      nonBroadeningProof: "proven_same_or_narrower",
      applicationDisposition: "eligible"
    });
  });

  it("blocks automatic apply when the requested tenant is absent", () => {
    const input = representativeInput();
    input.tenantId = "tenant:missing";

    const report = buildInboxV2RbacDryRun(input);

    expect(report).toMatchObject({
      tenantId: "tenant:missing",
      counts: {
        mapped: 0,
        reviewRequired: 0,
        compatibilityOnly: 0,
        invalid: 0
      },
      readyForAutomaticApply: false,
      summary: {
        sourceIssueCount: 1,
        readyForAutomaticApply: false
      }
    });
    expect(report.sourceIssues).toEqual([
      {
        source: "tenants",
        code: "requested_tenant_missing",
        sourceRef: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u)
      }
    ]);
  });

  it("fails soft on an unknown persisted permission", () => {
    const input = representativeInput();
    input.snapshot.roleBindings = [];
    input.snapshot.roles = [];
    input.snapshot.rolePermissions = [];
    input.snapshot.directGrants = [
      grant("grant:unknown", "employee:operator", "unknown.permission")
    ];

    const report = buildInboxV2RbacDryRun(input);

    expect(report.counts).toEqual({
      mapped: 0,
      reviewRequired: 0,
      compatibilityOnly: 0,
      invalid: 1
    });
    expect(report.entries[0]).toMatchObject({
      outcome: "invalid",
      decisionCode: "unknown_v1_permission",
      broadenedAccess: false,
      applicationDisposition: "reject"
    });
  });

  it("reads raw tables independently, never selects grant reason or employee PII", async () => {
    const client = fakeReaderClient({ includeDirectGrant: true });

    const result = await readInboxV1RbacSnapshot(client);

    expect(result.snapshot.directGrants).toEqual([
      {
        id: "grant:safe",
        tenant_id: tenantId,
        employee_id: "employee:operator",
        permission: "reports.view",
        scope_type: "tenant",
        scope_id: null,
        starts_at: null,
        expires_at: null,
        revoked_at: null
      }
    ]);
    expect(result.sourceJournal).toEqual({
      status: "present",
      rows: [{ id: "1", hash: "migration-hash-1", created_at: "1784000000" }]
    });
    const directGrantSelect = client.queries.find(({ text }) =>
      /from "public"\."direct_permission_grants"/u.test(text)
    )?.text;
    expect(directGrantSelect).toBeDefined();
    expect(directGrantSelect).not.toMatch(/\breason\b/iu);
    expect(client.queries.map(({ text }) => text).join("\n")).not.toMatch(
      /\b(email|display_name|profile)\b/iu
    );
  });

  it("records a raw query failure and recovers through a savepoint", async () => {
    const client = fakeReaderClient({ failDirectGrantQuery: true });

    const result = await readInboxV1RbacSnapshot(client);

    expect(result.snapshot.directGrants).toEqual([]);
    expect(result.readIssues).toContainEqual({
      source: "directGrants",
      code: "raw_query_failed"
    });
    expect(
      client.queries.some(({ text }) =>
        /^rollback to savepoint inbox_v2_rbac_dry_run_\d+$/u.test(text)
      )
    ).toBe(true);
    expect(result.sourceJournal.status).toBe("present");
  });

  it("runs the complete reader in a repeatable-read, read-only transaction", async () => {
    const client = fakeReaderClient();
    let released = false;
    const pool = {
      async connect() {
        return {
          ...client,
          release() {
            released = true;
          }
        };
      }
    };

    const report = await runInboxV2RbacDryRun({
      pool,
      tenantId,
      observedAt
    });

    const statements = client.queries.map(({ text }) => text);
    expect(statements[0]).toBe(
      "begin isolation level repeatable read read only"
    );
    expect(statements.at(-1)).toBe("commit");
    expect(statements.join("\n")).not.toMatch(
      /\b(insert|update|delete|truncate|alter|drop|create)\b/iu
    );
    expect(released).toBe(true);
    expect(report).toMatchObject({
      tenantId,
      counts: {
        mapped: 0,
        reviewRequired: 0,
        compatibilityOnly: 0,
        invalid: 0
      },
      broadenedAccessCount: 0,
      readyForAutomaticApply: false
    });
  });

  it("reports an unknown requested tenant through the database runner", async () => {
    const client = fakeReaderClient({
      tenantRows: [{ id: "tenant:other" }]
    });
    const pool = {
      async connect() {
        return { ...client, release() {} };
      }
    };

    const report = await runInboxV2RbacDryRun({
      pool,
      tenantId: "tenant:missing",
      observedAt
    });

    expect(report.readyForAutomaticApply).toBe(false);
    expect(report.sourceIssues).toContainEqual({
      source: "tenants",
      code: "requested_tenant_missing",
      sourceRef: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u)
    });
  });

  it("keeps CLI failures machine-readable without leaking connection details", async () => {
    const stdout = outputBuffer();
    const stderr = outputBuffer();

    const exitCode = await runInboxV2RbacDryRunCli({
      argv: ["--database-url", "postgres://user:secret@localhost/db"],
      env: {},
      stdout,
      stderr,
      async runner() {
        throw new InboxV2RbacDryRunError("inbox_v2.rbac_fixture_failed");
      }
    });

    expect(exitCode).toBe(1);
    expect(stdout.value).toBe("");
    expect(stderr.value).toBe(
      '{"error":{"code":"inbox_v2.rbac_fixture_failed"}}\n'
    );
    expect(stderr.value).not.toContain("secret");
  });

  it("prints a blocking source issue for an unknown CLI tenant", async () => {
    const stdout = outputBuffer();
    const stderr = outputBuffer();

    const exitCode = await runInboxV2RbacDryRunCli({
      argv: ["--tenant-id", "tenant:missing", "--as-of", observedAt],
      env: { DATABASE_URL: "postgres://unused" },
      stdout,
      stderr,
      async runner(options) {
        const input = representativeInput();
        input.tenantId = options.tenantId;
        return buildInboxV2RbacDryRun(input);
      }
    });
    const report = JSON.parse(stdout.value);

    expect(exitCode).toBe(0);
    expect(stderr.value).toBe("");
    expect(report.readyForAutomaticApply).toBe(false);
    expect(report.sourceIssues).toContainEqual({
      source: "tenants",
      code: "requested_tenant_missing",
      sourceRef: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u)
    });
  });
});

function representativeInput() {
  return {
    tenantId,
    observedAt,
    sourceJournal: {
      status: "present",
      rows: [
        {
          id: "1",
          hash: "migration-hash-1",
          created_at: "1784000000"
        }
      ]
    },
    readIssues: [],
    snapshot: {
      tenants: [{ id: tenantId }, { id: "tenant:beta" }],
      employees: [
        {
          id: "employee:operator",
          tenant_id: tenantId,
          deactivated_at: null,
          email: "operator@example.test",
          display_name: "Private Operator"
        },
        {
          id: "employee:deactivated",
          tenant_id: tenantId,
          deactivated_at: "2026-07-15T00:00:00.000Z"
        }
      ],
      roles: [
        { id: "role:mapped", tenant_id: tenantId, status: "active" },
        { id: "role:review", tenant_id: tenantId, status: "active" },
        { id: "role:compat", tenant_id: tenantId, status: "active" }
      ],
      rolePermissions: [
        {
          tenant_id: tenantId,
          role_id: "role:mapped",
          permission: "inbox.read"
        },
        {
          tenant_id: tenantId,
          role_id: "role:review",
          permission: "message.reply"
        },
        {
          tenant_id: tenantId,
          role_id: "role:compat",
          permission: "modules.manage"
        }
      ],
      roleBindings: [
        binding("binding:active", "role:mapped", "tenant", null),
        binding("binding:scheduled", "role:mapped", "tenant", null, {
          starts_at: "2026-07-17T00:00:00.000Z"
        }),
        binding("binding:expired", "role:mapped", "tenant", null, {
          expires_at: "2026-07-15T00:00:00.000Z"
        }),
        binding("binding:review", "role:review", "assigned", null),
        binding("binding:compat", "role:compat", "tenant", null, {
          revoked_at: "2026-07-15T12:00:00.000Z"
        }),
        binding(
          "binding:cross-tenant-target",
          "role:mapped",
          "queue",
          "work_queue:tenant-b-only"
        )
      ],
      directGrants: [
        grant("grant:scheduled-report", "employee:operator", "reports.view", {
          starts_at: "2026-07-17T00:00:00.000Z"
        }),
        grant("grant:client-review", "employee:operator", "conversation.read", {
          scope_type: "client",
          scope_id: "client:alpha"
        }),
        grant("grant:deactivated", "employee:deactivated", "reports.view"),
        grant("grant:automatic", "employee:operator", "client.view", {
          scope_type: "client",
          scope_id: "client:alpha"
        })
      ],
      orgUnits: [],
      teams: [],
      workQueues: [
        { id: "work_queue:tenant-b-only", tenant_id: "tenant:beta" }
      ],
      clients: [{ id: "client:alpha", tenant_id: tenantId }],
      conversations: []
    }
  };
}

function binding(id, roleId, scopeType, scopeId, overrides = {}) {
  return {
    id,
    tenant_id: tenantId,
    role_id: roleId,
    subject_type: "employee",
    subject_id: "employee:operator",
    scope_type: scopeType,
    scope_id: scopeId,
    starts_at: null,
    expires_at: null,
    revoked_at: null,
    ...overrides
  };
}

function grant(id, employeeId, permission, overrides = {}) {
  return {
    id,
    tenant_id: tenantId,
    employee_id: employeeId,
    permission,
    scope_type: "tenant",
    scope_id: null,
    reason: "Customer named in reason",
    starts_at: null,
    expires_at: null,
    revoked_at: null,
    ...overrides
  };
}

function fakeReaderClient(options = {}) {
  const queries = [];
  const catalogRows = [
    ...catalogColumns("public", "tenants", ["id"]),
    ...catalogColumns("public", "direct_permission_grants", [
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
    ...catalogColumns("drizzle", "__drizzle_migrations", [
      "id",
      "hash",
      "created_at"
    ])
  ];
  return {
    queries,
    async query(text, values) {
      queries.push({ text, values });
      if (/from information_schema\.columns/u.test(text)) {
        return { rows: catalogRows };
      }
      if (/from "public"\."tenants"/u.test(text)) {
        return { rows: options.tenantRows ?? [{ id: tenantId }] };
      }
      if (/from "public"\."direct_permission_grants"/u.test(text)) {
        if (options.failDirectGrantQuery) throw new Error("unsafe db detail");
        return {
          rows: options.includeDirectGrant
            ? [
                {
                  id: "grant:safe",
                  tenant_id: tenantId,
                  employee_id: "employee:operator",
                  permission: "reports.view",
                  scope_type: "tenant",
                  scope_id: null,
                  starts_at: null,
                  expires_at: null,
                  revoked_at: null
                }
              ]
            : []
        };
      }
      if (/from "drizzle"\."__drizzle_migrations"/u.test(text)) {
        return {
          rows: [
            {
              id: "1",
              hash: "migration-hash-1",
              created_at: "1784000000"
            }
          ]
        };
      }
      return { rows: [] };
    }
  };
}

function catalogColumns(tableSchema, tableName, columns) {
  return columns.map((columnName) => ({
    table_schema: tableSchema,
    table_name: tableName,
    column_name: columnName
  }));
}

function outputBuffer() {
  return {
    value: "",
    write(chunk) {
      this.value += chunk;
    }
  };
}

function sha256Json(value) {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")}`;
}
