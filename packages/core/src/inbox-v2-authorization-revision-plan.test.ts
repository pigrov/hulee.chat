import {
  inboxV2EmployeeReferenceSchema,
  inboxV2TenantIdSchema
} from "@hulee/contracts";
import { describe, expect, it } from "vitest";

import {
  planInboxV2DirectGrantRevision,
  planInboxV2RoleBindingRevision,
  planInboxV2RoleDefinitionRevision,
  type InboxV2RoleBindingLegalityFact
} from "./inbox-v2-authorization-revision-plan";

const tenantId = inboxV2TenantIdSchema.parse("tenant:tenant-1");
const otherTenantId = inboxV2TenantIdSchema.parse("tenant:tenant-2");
const evaluatedAt = "2026-07-15T09:00:00.000Z";

const employee = inboxV2EmployeeReferenceSchema.parse({
  tenantId,
  kind: "employee",
  id: "employee:employee-1"
});

function scope(type: "team" | "queue" | "conversation", tenant = tenantId) {
  return {
    type,
    tenantId: tenant,
    id:
      type === "team"
        ? "team:team-1"
        : type === "queue"
          ? "work_queue:queue-1"
          : "conversation:conversation-1"
  };
}

function binding(input: {
  bindingId: string;
  scopeType?: "team" | "queue";
  tenant?: typeof tenantId;
  roleId?: string;
  validFrom?: string;
  validUntil?: string | null;
  revokedAt?: string | null;
}): InboxV2RoleBindingLegalityFact {
  const tenant = input.tenant ?? tenantId;
  return {
    tenantId: tenant,
    bindingId: input.bindingId,
    roleId: input.roleId ?? "role:role-1",
    scope: scope(input.scopeType ?? "team", tenant),
    validFrom: input.validFrom ?? "2026-07-01T00:00:00.000Z",
    validUntil: input.validUntil ?? null,
    revokedAt: input.revokedAt ?? null
  };
}

describe("Inbox V2 authorization revision planner", () => {
  it("uses catalog legality for direct grants and advances only the exact Employee", () => {
    const accepted = planInboxV2DirectGrantRevision({
      tenantId,
      employee,
      permissionId: "core:conversation.read",
      scope: scope("conversation"),
      previousEmployeeAccessRevision: "41"
    });
    expect(accepted).toMatchObject({
      kind: "accepted",
      permissionId: "core:conversation.read",
      revisionPlan: {
        kind: "employee_access",
        tenantRbacRevision: null,
        sharedAccessRevision: null,
        employeeAccessRevisions: [
          {
            employee,
            advance: { previous: "41", resulting: "42" }
          }
        ],
        employeeInboxRelationRevisions: [],
        resourceAccessRevisions: []
      }
    });
    expect(Object.isFrozen(accepted)).toBe(true);

    expect(
      planInboxV2DirectGrantRevision({
        tenantId,
        employee,
        permissionId: "core:tenant.manage",
        scope: scope("team"),
        previousEmployeeAccessRevision: "1"
      })
    ).toEqual({ kind: "rejected", reason: "illegal_scope" });
    expect(
      planInboxV2DirectGrantRevision({
        tenantId,
        employee,
        permissionId: "core:provider.magic",
        scope: scope("team"),
        previousEmployeeAccessRevision: "1"
      })
    ).toEqual({ kind: "rejected", reason: "unknown_permission" });
    expect(
      planInboxV2DirectGrantRevision({
        tenantId,
        employee,
        permissionId: "core:conversation.read",
        scope: scope("conversation", otherTenantId),
        previousEmployeeAccessRevision: "1"
      })
    ).toEqual({ kind: "rejected", reason: "cross_tenant" });
  });

  it("validates a new stable-role binding against the current role head", () => {
    const accepted = planInboxV2RoleBindingRevision({
      tenantId,
      roleId: "role:role-1",
      subjectTenantId: tenantId,
      scope: scope("team"),
      currentRolePermissionIds: [
        "core:team.manage",
        "core:employee.profile.manage"
      ],
      previousTenantRbacRevision: "7"
    });
    expect(accepted).toMatchObject({
      kind: "accepted",
      roleId: "role:role-1",
      canonicalPermissionIds: [
        "core:employee.profile.manage",
        "core:team.manage"
      ],
      revisionPlan: {
        kind: "role_definition_or_binding",
        tenantRbacRevision: { previous: "7", resulting: "8" },
        sharedAccessRevision: null,
        employeeAccessRevisions: [],
        employeeInboxRelationRevisions: [],
        resourceAccessRevisions: []
      }
    });

    const incompatible = planInboxV2RoleBindingRevision({
      tenantId,
      roleId: "role:role-1",
      subjectTenantId: tenantId,
      scope: scope("team"),
      currentRolePermissionIds: ["core:queue.manage"],
      previousTenantRbacRevision: "7"
    });
    expect(incompatible).toMatchObject({
      kind: "rejected",
      reason: "incompatible_binding_scope",
      conflicts: [{ permissionId: "core:queue.manage", scopeType: "team" }]
    });
  });

  it("rejects a role update incompatible with every active or scheduled binding", () => {
    const decision = planInboxV2RoleDefinitionRevision({
      tenantId,
      roleId: "role:role-1",
      permissionIds: ["core:queue.manage", "core:employee.profile.manage"],
      currentAndHistoricalBindings: [
        binding({
          bindingId: "binding:_scheduled",
          scopeType: "queue",
          validFrom: "2026-08-01T00:00:00.000Z"
        }),
        binding({ bindingId: "binding:-active", scopeType: "team" })
      ],
      evaluatedAt,
      previousTenantRbacRevision: "10"
    });
    expect(decision).toMatchObject({
      kind: "rejected",
      reason: "incompatible_binding_scope",
      conflicts: [
        {
          bindingId: "binding:-active",
          permissionId: "core:queue.manage",
          scopeType: "team"
        },
        {
          bindingId: "binding:_scheduled",
          permissionId: "core:employee.profile.manage",
          scopeType: "queue"
        }
      ]
    });
  });

  it("ignores only historical expired/revoked bindings and keeps scheduled bindings", () => {
    const accepted = planInboxV2RoleDefinitionRevision({
      tenantId,
      roleId: "role:role-1",
      permissionIds: ["core:tenant.manage"],
      currentAndHistoricalBindings: [
        binding({
          bindingId: "binding:expired",
          validUntil: "2026-07-14T00:00:00.000Z"
        }),
        binding({
          bindingId: "binding:revoked",
          revokedAt: "2026-07-14T00:00:00.000Z"
        })
      ],
      evaluatedAt,
      previousTenantRbacRevision: "3"
    });
    expect(accepted).toMatchObject({
      kind: "accepted",
      checkedBindingIds: [],
      revisionPlan: {
        tenantRbacRevision: { previous: "3", resulting: "4" },
        sharedAccessRevision: null,
        employeeAccessRevisions: []
      }
    });
  });

  it("uses deterministic codepoint/C ordering for mixed punctuation", () => {
    const decision = planInboxV2RoleDefinitionRevision({
      tenantId,
      roleId: "role:role-1",
      permissionIds: ["core:team.manage"],
      currentAndHistoricalBindings: [
        binding({ bindingId: "binding:_a" }),
        binding({ bindingId: "binding:.a" }),
        binding({ bindingId: "binding:-a" })
      ],
      evaluatedAt,
      previousTenantRbacRevision: "1"
    });
    expect(decision).toMatchObject({
      kind: "accepted",
      checkedBindingIds: ["binding:-a", "binding:.a", "binding:_a"]
    });
  });

  it("checks mass bindings without Employee fan-out", () => {
    const bindings = Array.from({ length: 50_000 }, (_, index) =>
      binding({ bindingId: `binding:${String(index).padStart(5, "0")}` })
    );
    const decision = planInboxV2RoleDefinitionRevision({
      tenantId,
      roleId: "role:role-1",
      permissionIds: ["core:team.manage"],
      currentAndHistoricalBindings: bindings,
      evaluatedAt,
      previousTenantRbacRevision: "999"
    });
    expect(decision.kind).toBe("accepted");
    if (decision.kind === "accepted") {
      expect(decision.checkedBindingIds).toHaveLength(50_000);
      expect(decision.revisionPlan).toMatchObject({
        tenantRbacRevision: { previous: "999", resulting: "1000" },
        sharedAccessRevision: null,
        employeeAccessRevisions: [],
        employeeInboxRelationRevisions: [],
        resourceAccessRevisions: []
      });
    }
  });

  it("rejects duplicate/unknown permissions, invalid binding sets and counter overflow", () => {
    const base = {
      tenantId,
      roleId: "role:role-1",
      currentAndHistoricalBindings: [] as InboxV2RoleBindingLegalityFact[],
      evaluatedAt,
      previousTenantRbacRevision: "1"
    };
    expect(
      planInboxV2RoleDefinitionRevision({
        ...base,
        permissionIds: ["core:roles.define", "core:roles.define"]
      })
    ).toMatchObject({ kind: "rejected", reason: "invalid_permission_set" });
    expect(
      planInboxV2RoleDefinitionRevision({
        ...base,
        permissionIds: ["core:provider.magic"]
      })
    ).toMatchObject({ kind: "rejected", reason: "invalid_permission_set" });
    expect(
      planInboxV2RoleDefinitionRevision({
        ...base,
        permissionIds: ["core:roles.define"],
        currentAndHistoricalBindings: [
          binding({ bindingId: "binding:other-role", roleId: "role:role-2" })
        ]
      })
    ).toMatchObject({ kind: "rejected", reason: "invalid_binding_set" });
    expect(
      planInboxV2RoleDefinitionRevision({
        ...base,
        permissionIds: ["core:roles.define"],
        previousTenantRbacRevision: "0"
      })
    ).toMatchObject({ kind: "rejected", reason: "invalid_revision" });
    expect(
      planInboxV2RoleDefinitionRevision({
        ...base,
        permissionIds: ["core:roles.define"],
        previousTenantRbacRevision: "9223372036854775807"
      })
    ).toMatchObject({ kind: "rejected", reason: "invalid_revision" });
  });
});
