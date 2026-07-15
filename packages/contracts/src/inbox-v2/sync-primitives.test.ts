import { describe, expect, it } from "vitest";

import {
  inboxV2AppAuthorizationEpochSchema,
  inboxV2AuthorizationDecisionReferenceSchema,
  inboxV2AuthorizationDependencyVectorSchema,
  inboxV2AuthorizationEpochSchema,
  inboxV2ProjectionCheckpointSchema,
  inboxV2TenantStreamCommitPositionSchema,
  inboxV2TenantStreamPositionSchema,
  inboxV2WorkAuthorizationEpochSchema
} from "../index";

const digest = `sha256:${"a".repeat(64)}`;
const tenantId = "tenant:tenant-1";

describe("Inbox V2 sync primitives", () => {
  it("keeps counters lossless beyond Number.MAX_SAFE_INTEGER", () => {
    const lossless = "9007199254740993";
    expect(inboxV2TenantStreamPositionSchema.parse(lossless)).toBe(lossless);
    expect(inboxV2ProjectionCheckpointSchema.parse(lossless)).toBe(lossless);
    expect(
      inboxV2TenantStreamPositionSchema.safeParse(Number(lossless)).success
    ).toBe(false);
    expect(inboxV2TenantStreamPositionSchema.safeParse("01").success).toBe(
      false
    );
  });

  it("allows zero only for heads/checkpoints, never for immutable commits", () => {
    expect(inboxV2TenantStreamPositionSchema.parse("0")).toBe("0");
    expect(inboxV2ProjectionCheckpointSchema.parse("0")).toBe("0");
    expect(inboxV2TenantStreamCommitPositionSchema.safeParse("0").success).toBe(
      false
    );
    expect(inboxV2TenantStreamCommitPositionSchema.parse("1")).toBe("1");
  });

  it("uses one authorization epoch grammar across timeline, work and routing", () => {
    const epoch = "authorization:epoch-0001";
    expect(inboxV2AuthorizationEpochSchema.parse(epoch)).toBe(epoch);
    expect(inboxV2AppAuthorizationEpochSchema.parse(epoch)).toBe(epoch);
    expect(inboxV2WorkAuthorizationEpochSchema.parse(epoch)).toBe(epoch);
    expect(inboxV2AuthorizationEpochSchema.safeParse("short").success).toBe(
      false
    );
    expect(inboxV2AppAuthorizationEpochSchema.safeParse("short").success).toBe(
      false
    );
    expect(inboxV2WorkAuthorizationEpochSchema.safeParse("short").success).toBe(
      false
    );
  });

  it("binds a composite epoch to a bounded canonical resource revision set", () => {
    const vector = {
      tenantRbacRevision: "1",
      employeeAccessRevision: "2",
      employeeInboxRelationRevision: "3",
      sharedAccessRevision: "4",
      resourceDependencies: [
        {
          resource: {
            tenantId,
            entityTypeId: "core:conversation",
            entityId: "conversation:conversation-1"
          },
          accessRevision: "5"
        },
        {
          resource: {
            tenantId,
            entityTypeId: "core:work-item",
            entityId: "work_item:work-1"
          },
          accessRevision: "8"
        }
      ],
      temporalBoundaryDigest: digest
    };

    expect(
      inboxV2AuthorizationDependencyVectorSchema.safeParse(vector).success
    ).toBe(true);
    expect(
      inboxV2AuthorizationDependencyVectorSchema.safeParse({
        ...vector,
        tenantRbacRevision: "0"
      }).success
    ).toBe(false);
    expect(
      inboxV2AuthorizationDependencyVectorSchema.safeParse({
        ...vector,
        resourceDependencies: [...vector.resourceDependencies].reverse()
      }).success
    ).toBe(false);
    expect(
      inboxV2AuthorizationDependencyVectorSchema.safeParse({
        ...vector,
        resourceDependencies: [
          vector.resourceDependencies[0],
          vector.resourceDependencies[0]
        ]
      }).success
    ).toBe(false);
  });

  it("keeps authorization decision resource revisions on the same baseline", () => {
    const decision = {
      tenantId,
      id: "authorization_decision:decision-1",
      authorizationEpoch: "authorization:epoch-0001",
      principal: {
        kind: "employee" as const,
        employee: {
          tenantId,
          kind: "employee" as const,
          id: "employee:employee-1"
        }
      },
      permissionId: "core:inbox.read",
      resourceScopeId: "core:conversation",
      resource: {
        tenantId,
        entityTypeId: "core:conversation",
        entityId: "conversation:conversation-1"
      },
      resourceAccessRevision: "1",
      decisionRevision: "1",
      decisionHash: digest,
      outcome: "allowed" as const,
      decidedAt: "2026-07-15T09:00:00.000Z",
      notAfter: "2026-07-15T09:05:00.000Z"
    };

    expect(
      inboxV2AuthorizationDecisionReferenceSchema.safeParse(decision).success
    ).toBe(true);
    expect(
      inboxV2AuthorizationDecisionReferenceSchema.safeParse({
        ...decision,
        resourceAccessRevision: "0"
      }).success
    ).toBe(false);
  });
});
