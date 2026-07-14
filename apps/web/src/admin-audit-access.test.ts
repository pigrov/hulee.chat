import type { EmployeeId, TenantId } from "@hulee/contracts";
import type { EffectivePermissionGrant } from "@hulee/core";
import { describe, expect, it } from "vitest";

import { resolveAdminAuditAuthorization } from "./admin-audit-access";
import type { WebEffectiveAccessSnapshot } from "./rbac-effective-access";

const tenantId = "tenant-1" as TenantId;
const employeeId = "employee-1" as EmployeeId;

describe("admin audit access", () => {
  it("derives a deterministic union of audit scopes", () => {
    const authorization = resolveAdminAuditAuthorization(
      snapshot([
        grant({ type: "queue", id: "queue-sales" }),
        grant({ type: "org_unit", id: "org-sales" }),
        grant({ type: "team", id: "team-support" }),
        grant({ type: "queue", id: "queue-sales" })
      ])
    );

    expect(authorization).toEqual({
      kind: "scoped",
      orgUnitIds: ["org-sales"],
      teamIds: ["team-support"],
      queueIds: ["queue-sales"]
    });
  });

  it("uses tenant authorization when any valid audit grant is tenant-wide", () => {
    expect(
      resolveAdminAuditAuthorization(
        snapshot([
          grant({ type: "queue", id: "queue-sales" }),
          grant({ type: "tenant" })
        ])
      )
    ).toEqual({ kind: "tenant" });
  });

  it("ignores grants outside the snapshot actor boundary", () => {
    expect(
      resolveAdminAuditAuthorization(
        snapshot([
          {
            ...grant({ type: "tenant" }),
            tenantId: "tenant-2" as TenantId
          },
          {
            ...grant({ type: "tenant" }),
            employeeId: "employee-2" as EmployeeId
          }
        ])
      )
    ).toBeUndefined();
  });

  it("fails closed without an applicable structural audit scope", () => {
    expect(resolveAdminAuditAuthorization(undefined)).toBeUndefined();
    expect(
      resolveAdminAuditAuthorization(
        snapshot([
          {
            ...grant({ type: "queue", id: "queue-sales" }),
            permission: "roles.manage"
          },
          grant({ type: "conversation", id: "conversation-1" })
        ])
      )
    ).toBeUndefined();
  });

  it("uses target-scoped decisions instead of another permission on the same resource", () => {
    expect(
      resolveAdminAuditAuthorization(
        snapshot([
          {
            ...grant({ type: "queue", id: "queue-sales" }),
            permission: "roles.manage"
          },
          grant({ type: "queue", id: "queue-support" })
        ])
      )
    ).toEqual({
      kind: "scoped",
      orgUnitIds: [],
      teamIds: [],
      queueIds: ["queue-support"]
    });
  });
});

function snapshot(
  effectiveGrants: readonly EffectivePermissionGrant[]
): WebEffectiveAccessSnapshot {
  return {
    actor: {
      tenantId,
      employeeId
    },
    effectiveGrants
  };
}

function grant(
  scope: EffectivePermissionGrant["scope"]
): EffectivePermissionGrant {
  return {
    tenantId,
    employeeId,
    permission: "audit.view",
    scope,
    sources: []
  };
}
