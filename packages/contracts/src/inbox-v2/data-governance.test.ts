import { describe, expect, it } from "vitest";

import {
  calculateInboxV2DataGovernanceContextHash,
  defineInboxV2DataGovernanceContext,
  inboxV2ApprovedExtensionResponsibilityRoleSchema,
  inboxV2DataGovernanceContextEnvelopeSchema,
  inboxV2DataGovernanceContextSchema,
  inboxV2GovernanceRoleAssignmentSchema,
  isInboxV2DataGovernanceContext,
  matchesInboxV2DataGovernanceContextReference
} from "./data-governance";
import { assertInboxV2ClosedJsonSchema } from "./schema-safety";

function governanceContext() {
  return defineInboxV2DataGovernanceContext({
    tenantId: "tenant:tenant-1",
    id: "core:governance-profile",
    version: "2",
    policyRevision: "4",
    deploymentProfile: "saas_shared" as const,
    rolesByPurpose: [
      {
        purposeId: "core:customer_service_history",
        roles: [{ regime: "eu" as const, role: "controller" as const }],
        lawfulBasisReferenceCode: "core:lawful-basis.contract-1",
        customerInstructionReferenceCode: null
      }
    ],
    jurisdictionProfiles: [{ id: "core:jurisdiction-eu", version: "3" }],
    residencyRegionIds: ["core:region-eu"],
    crossBorderRouteIds: [],
    timeZone: "Europe/Berlin",
    tzdbVersion: "2026a",
    calendarPeriodResolver: {
      id: "core:calendar-period-resolver",
      version: "1"
    },
    calendarBoundaryPolicy: {
      monthOverflow: "constrain" as const,
      ambiguousLocalTime: "reject" as const,
      nonexistentLocalTime: "reject" as const,
      businessDayAnchor: "exclusive" as const
    },
    businessCalendars: [{ id: "core:calendar-eu", version: "5" }],
    requestSlaProfile: { id: "core:request-sla-eu", version: "2" },
    industryProfiles: [],
    approvedAt: "2026-01-01T00:00:00.000Z",
    effectiveAt: "2026-02-01T00:00:00.000Z",
    reviewAt: "2027-02-01T00:00:00.000Z"
  });
}

describe("Inbox V2 data-governance context", () => {
  it("keeps governance boundary schemas closed", () => {
    expect(() =>
      assertInboxV2ClosedJsonSchema(
        inboxV2DataGovernanceContextSchema,
        "data governance context"
      )
    ).not.toThrow();
  });

  it("accepts a versioned tenant context and exact immutable reference", () => {
    const context = governanceContext();
    expect(isInboxV2DataGovernanceContext(context)).toBe(true);
    expect(Object.isFrozen(context)).toBe(true);
    expect(isInboxV2DataGovernanceContext(structuredClone(context))).toBe(
      false
    );
    expect(inboxV2DataGovernanceContextSchema.safeParse(context).success).toBe(
      true
    );
    expect(
      matchesInboxV2DataGovernanceContextReference({
        context,
        reference: {
          tenantId: context.tenantId,
          id: context.id,
          version: context.version,
          contextHash: context.contextHash
        }
      })
    ).toBe(true);
    expect(
      inboxV2DataGovernanceContextEnvelopeSchema.safeParse({
        schemaId: "core:inbox-v2.data-governance-context",
        schemaVersion: "v1",
        payload: context
      }).success
    ).toBe(true);
  });

  it("rejects stale/cross-tenant references and ambiguous governance", () => {
    const context = governanceContext();
    expect(
      matchesInboxV2DataGovernanceContextReference({
        context,
        reference: {
          tenantId: "tenant:tenant-2",
          id: context.id,
          version: context.version,
          contextHash: context.contextHash
        }
      })
    ).toBe(false);
    expect(
      inboxV2DataGovernanceContextSchema.safeParse({
        ...context,
        reviewAt: context.effectiveAt
      }).success
    ).toBe(false);
    expect(
      inboxV2DataGovernanceContextSchema.safeParse({
        ...context,
        residencyRegionIds: ["core:region-eu", "core:region-eu"]
      }).success
    ).toBe(false);
    expect(
      inboxV2DataGovernanceContextSchema.safeParse({
        ...context,
        policyRevision: "5"
      }).success
    ).toBe(false);
    const { contextHash: _ignored, ...body } = context;
    expect(calculateInboxV2DataGovernanceContextHash(body)).toBe(
      context.contextHash
    );
  });

  it("requires processor instructions and closed namespaced extensions", () => {
    expect(
      inboxV2GovernanceRoleAssignmentSchema.safeParse({
        purposeId: "core:communication_delivery",
        roles: [{ regime: "eu", role: "controller" }],
        lawfulBasisReferenceCode: "Alice requested deletion by email",
        customerInstructionReferenceCode: null
      }).success
    ).toBe(false);
    expect(
      inboxV2GovernanceRoleAssignmentSchema.safeParse({
        purposeId: "core:communication_delivery",
        roles: [{ regime: "eu", role: "personal_data_operator" }],
        lawfulBasisReferenceCode: "tenant-instruction",
        customerInstructionReferenceCode: null
      }).success
    ).toBe(false);
    expect(
      inboxV2GovernanceRoleAssignmentSchema.safeParse({
        purposeId: "core:communication_delivery",
        roles: [{ regime: "ru_152_fz", role: "controller" }],
        lawfulBasisReferenceCode: "tenant-instruction",
        customerInstructionReferenceCode: null
      }).success
    ).toBe(false);
    expect(
      inboxV2GovernanceRoleAssignmentSchema.safeParse({
        purposeId: "core:communication_delivery",
        roles: [{ regime: "eu", role: "processor" }],
        lawfulBasisReferenceCode: "tenant-instruction",
        customerInstructionReferenceCode: null
      }).success
    ).toBe(false);
    expect(
      inboxV2ApprovedExtensionResponsibilityRoleSchema.safeParse({
        regime: "approved_extension",
        regimeId: "extension:regime-x",
        roleId: "extension:role-x",
        approvedProfile: { id: "core:approved-extension", version: "1" }
      }).success
    ).toBe(true);
    expect(
      inboxV2ApprovedExtensionResponsibilityRoleSchema.safeParse({
        regime: "approved_extension",
        regimeId: "eu",
        roleId: "controller",
        approvedProfile: { id: "core:approved-extension", version: "1" }
      }).success
    ).toBe(false);
  });
});
