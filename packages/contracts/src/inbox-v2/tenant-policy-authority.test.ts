import { describe, expect, it } from "vitest";

import {
  inboxV2ActivateTenantPolicyVersionCommandSchema,
  inboxV2ApproveTenantPolicyVersionCommandSchema,
  inboxV2ExactActiveTenantPolicyAuthorityInputSchema,
  inboxV2PolicyDefinitionDigestSha256Schema,
  inboxV2RevokeTenantPolicyVersionCommandSchema,
  inboxV2TenantPolicyActivationHeadSchema,
  inboxV2TenantPolicyActivationTransitionSchema,
  inboxV2TenantPolicyVersionAuthoritySchema
} from "../index";

const tenantId = "tenant:tenant-1";
const otherTenantId = "tenant:tenant-2";
const approvedAt = "2026-07-14T09:00:00.000Z";
const activatedAt = "2026-07-14T09:01:00.000Z";
const revokedAt = "2026-07-14T09:02:00.000Z";
const employee = {
  tenantId,
  kind: "employee",
  id: "employee:approver-1"
} as const;

function approval(
  family:
    | "source_identity_claim"
    | "conversation_client_link" = "source_identity_claim"
) {
  return {
    tenantId,
    family,
    policyId:
      family === "source_identity_claim"
        ? "core:identity.claim.policy"
        : "core:conversation.client-link.policy",
    policyVersion: "v1",
    definitionContractVersion: "v1",
    definitionDigestSha256: "a".repeat(64),
    approvedTrustedServiceId: "core:identity-resolver",
    approvedBy: employee,
    approvedAt
  } as const;
}

describe("Inbox V2 tenant policy authority contracts", () => {
  it.each(["source_identity_claim", "conversation_client_link"] as const)(
    "accepts one typed immutable %s policy version",
    (family) => {
      const command = inboxV2ApproveTenantPolicyVersionCommandSchema.parse(
        approval(family)
      );
      expect(
        inboxV2TenantPolicyVersionAuthoritySchema.safeParse({
          ...command,
          revision: "1",
          createdAt: approvedAt,
          updatedAt: approvedAt
        }).success
      ).toBe(true);
    }
  );

  it("rejects malformed digests, extra commands and cross-tenant actors", () => {
    expect(
      inboxV2PolicyDefinitionDigestSha256Schema.safeParse("A".repeat(64))
        .success
    ).toBe(false);
    expect(
      inboxV2ApproveTenantPolicyVersionCommandSchema.safeParse({
        ...approval(),
        approvedBy: { ...employee, tenantId: otherTenantId }
      }).success
    ).toBe(false);
    expect(
      inboxV2ApproveTenantPolicyVersionCommandSchema.safeParse({
        ...approval(),
        grantCommands: []
      }).success
    ).toBe(false);
  });

  it("keeps policy family and policy ID in one strict discriminated key", () => {
    expect(
      inboxV2ApproveTenantPolicyVersionCommandSchema.safeParse({
        ...approval(),
        family: "unknown"
      }).success
    ).toBe(false);
    expect(
      inboxV2ApproveTenantPolicyVersionCommandSchema.safeParse({
        ...approval(),
        policyId: "not-a-catalog-id"
      }).success
    ).toBe(false);
  });

  it("validates active and revoked activation-head timestamps and actors", () => {
    const approved = approval();
    const base = {
      tenantId: approved.tenantId,
      family: approved.family,
      policyId: approved.policyId,
      policyVersion: approved.policyVersion,
      definitionContractVersion: approved.definitionContractVersion,
      definitionDigestSha256: approved.definitionDigestSha256,
      approvedTrustedServiceId: approved.approvedTrustedServiceId,
      state: "active" as const,
      activatedBy: employee,
      activatedAt,
      revokedBy: null,
      revokedAt: null,
      revision: "1",
      createdAt: activatedAt,
      updatedAt: activatedAt
    };
    expect(
      inboxV2TenantPolicyActivationHeadSchema.safeParse(base).success
    ).toBe(true);
    expect(
      inboxV2TenantPolicyActivationHeadSchema.safeParse({
        ...base,
        state: "revoked",
        revokedBy: employee,
        revokedAt,
        revision: "2",
        updatedAt: revokedAt
      }).success
    ).toBe(true);
    expect(
      inboxV2TenantPolicyActivationHeadSchema.safeParse({
        ...base,
        state: "revoked",
        revokedAt,
        updatedAt: revokedAt
      }).success
    ).toBe(false);
  });

  it("requires strict tenant-bound activation and revoke CAS commands", () => {
    expect(
      inboxV2ActivateTenantPolicyVersionCommandSchema.safeParse({
        tenantId,
        family: approval().family,
        policyId: approval().policyId,
        policyVersion: "v1",
        expectedHeadRevision: null,
        activatedBy: employee,
        activatedAt
      }).success
    ).toBe(true);
    expect(
      inboxV2RevokeTenantPolicyVersionCommandSchema.safeParse({
        tenantId,
        family: approval().family,
        policyId: approval().policyId,
        policyVersion: "v1",
        expectedHeadRevision: "1",
        revokedBy: { ...employee, tenantId: otherTenantId },
        revokedAt
      }).success
    ).toBe(false);
  });

  it("requires an exact version, definition, service and occurrence fence for use", () => {
    expect(
      inboxV2ExactActiveTenantPolicyAuthorityInputSchema.safeParse({
        tenantId,
        family: approval().family,
        policyId: approval().policyId,
        policyVersion: "v1",
        definitionContractVersion: "v1",
        definitionDigestSha256: "a".repeat(64),
        approvedTrustedServiceId: "core:identity-resolver",
        expectedHeadRevision: "1",
        occurredAt: activatedAt
      }).success
    ).toBe(true);
  });

  it("keeps activation/revocation history append-only and contiguous", () => {
    const snapshot = {
      policyVersion: "v1",
      definitionContractVersion: "v1",
      definitionDigestSha256: "a".repeat(64),
      approvedTrustedServiceId: "core:identity-resolver",
      state: "active" as const
    };
    expect(
      inboxV2TenantPolicyActivationTransitionSchema.safeParse({
        tenantId,
        family: approval().family,
        policyId: approval().policyId,
        operation: "activate",
        expectedHeadRevision: null,
        resultingHeadRevision: "1",
        previous: null,
        resulting: snapshot,
        actor: employee,
        occurredAt: activatedAt,
        createdAt: activatedAt
      }).success
    ).toBe(true);
    expect(
      inboxV2TenantPolicyActivationTransitionSchema.safeParse({
        tenantId,
        family: approval().family,
        policyId: approval().policyId,
        operation: "revoke",
        expectedHeadRevision: "1",
        resultingHeadRevision: "2",
        previous: snapshot,
        resulting: { ...snapshot, state: "revoked" },
        actor: employee,
        occurredAt: revokedAt,
        createdAt: revokedAt
      }).success
    ).toBe(true);
  });
});
