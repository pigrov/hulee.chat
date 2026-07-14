import { describe, expect, it } from "vitest";

import {
  defineInboxV2PrivacyEvidence,
  inboxV2PrivacyEvidenceEnvelopeSchema,
  inboxV2PrivacyEvidenceSchema,
  inboxV2SafeAuditEnvelopeSchema,
  inboxV2SafeAuditRecordSchema,
  isInboxV2PrivacyEvidence
} from "./privacy-audit";
import { defineInboxV2DataLifecycleRegistry } from "./data-lifecycle-catalog";
import { assertInboxV2ClosedJsonSchema } from "./schema-safety";

const tenantId = "tenant:tenant-1";
const occurredAt = "2026-07-11T10:00:00.000Z";
const expiresAt = "2029-07-11T10:00:00.000Z";
const hashA = `sha256:${"a".repeat(64)}`;
const hashB = `sha256:${"b".repeat(64)}`;
const evidenceId = `privacy-evidence:${"c".repeat(32)}`;
const employee = {
  tenantId,
  kind: "employee" as const,
  id: "employee:employee-1"
};
const target = {
  tenantId,
  entityTypeId: "core:privacy-request",
  entityId: `internal-ref:${"e".repeat(32)}`
};

function auditRecord() {
  return {
    tenantId,
    auditId: `privacy-audit:${"a".repeat(32)}`,
    category: "privacy" as const,
    actionId: "core:privacy.request.decide",
    actor: { kind: "employee" as const, employee },
    effectiveActor: { kind: "employee" as const, employee },
    target,
    authorizationFacets: [
      {
        permissionId: "core:privacy.request.decide",
        resourceScopeId: "core:privacy-request",
        decisionRevision: "1",
        decisionHash: hashA,
        outcome: "allowed" as const
      }
    ],
    policy: {
      policyId: "core:retention-policy.default",
      policyRevision: "1",
      governanceContextId: "core:governance-context.default",
      governanceContextRevision: "1",
      ruleId: "core:retention-rule.message-content"
    },
    beforeRevision: "1",
    afterRevision: "2",
    reasonId: "core:privacy.reason.approved",
    requestId: `request:${"1".repeat(32)}`,
    clientMutationId: `mutation:${"2".repeat(32)}`,
    correlationId: `privacy-correlation:${"b".repeat(32)}`,
    outcome: "succeeded" as const,
    occurredAt,
    expiresAt,
    evidenceRef: {
      tenantId,
      entityTypeId: "core:privacy-evidence",
      entityId: evidenceId
    },
    previousAuditHash: null,
    auditHash: hashB
  };
}

function privacyEvidence() {
  return {
    tenantId,
    evidenceId,
    evidenceTypeId: "core:privacy-evidence.decision",
    dataClassId: "core:privacy_sensitive_evidence",
    purposeId: "core:data_subject_request_execution",
    rootId: "core:privacy-evidence-object",
    target,
    payload: {
      tenantId,
      recordId: `privacy-evidence-payload:${"d".repeat(32)}`,
      schemaId: "core:inbox-v2.privacy-evidence-payload",
      schemaVersion: "v1",
      digest: hashA
    },
    encryptionProfileId: "core:encryption.restricted-evidence",
    lifecycleHandlerId: "core:lifecycle.privacy-evidence",
    createdAt: occurredAt,
    expiresAt,
    revision: "1"
  };
}

function privacyEvidenceRegistry() {
  return defineInboxV2DataLifecycleRegistry({
    coreStorageRootRegistrations: [
      {
        schemaId: "core:inbox-v2.catalog-registration",
        schemaVersion: "v1",
        payload: {
          catalog: "storage-root",
          owner: { kind: "core" },
          entries: [
            {
              id: "core:privacy-evidence-object",
              definition: {
                kind: "object",
                boundary: "operated_data_plane",
                tenantIsolation: "required",
                versionEnumeration: "supported",
                configurationProfileId: "core:storage-profile.privacy-evidence"
              }
            }
          ]
        }
      }
    ],
    coreLifecycleHandlerRegistrations: [
      {
        schemaId: "core:inbox-v2.catalog-registration",
        schemaVersion: "v1",
        payload: {
          catalog: "lifecycle-handler",
          owner: { kind: "core" },
          entries: [
            {
              id: "core:lifecycle.privacy-evidence",
              definition: {
                kind: "lifecycle",
                supportedRootKinds: ["object"],
                supportedOperations: [
                  "persist",
                  "export",
                  "delete",
                  "verify_absence"
                ],
                bounded: true,
                idempotent: true,
                checksTenantFence: true,
                checksRevisionFence: true,
                checksHoldFence: true,
                verifiesAbsence: false
              }
            },
            {
              id: "core:lifecycle.privacy-evidence-subject-discovery",
              definition: {
                kind: "subject_discovery",
                supportedRootKinds: ["object"],
                supportedOperations: ["read"],
                bounded: true,
                idempotent: true,
                checksTenantFence: true,
                checksRevisionFence: true,
                checksHoldFence: true,
                verifiesAbsence: false
              }
            },
            {
              id: "core:lifecycle.privacy-evidence-export-projection",
              definition: {
                kind: "export_projection",
                supportedRootKinds: ["object"],
                supportedOperations: ["export"],
                bounded: true,
                idempotent: true,
                checksTenantFence: true,
                checksRevisionFence: true,
                checksHoldFence: true,
                verifiesAbsence: false
              }
            },
            {
              id: "core:lifecycle.privacy-evidence-export",
              definition: {
                kind: "export_execution",
                supportedRootKinds: ["object"],
                supportedOperations: ["export"],
                bounded: true,
                idempotent: true,
                checksTenantFence: true,
                checksRevisionFence: true,
                checksHoldFence: true,
                verifiesAbsence: false
              }
            },
            {
              id: "core:lifecycle.privacy-evidence-delete",
              definition: {
                kind: "delete_execution",
                supportedRootKinds: ["object"],
                supportedOperations: ["delete"],
                bounded: true,
                idempotent: true,
                checksTenantFence: true,
                checksRevisionFence: true,
                checksHoldFence: true,
                verifiesAbsence: false
              }
            },
            {
              id: "core:lifecycle.privacy-evidence-verify",
              definition: {
                kind: "verification",
                supportedRootKinds: ["object"],
                supportedOperations: ["verify_absence"],
                bounded: true,
                idempotent: true,
                checksTenantFence: true,
                checksRevisionFence: true,
                checksHoldFence: true,
                verifiesAbsence: true
              }
            }
          ]
        }
      }
    ],
    coreDataUseRegistrations: [
      {
        schemaId: "core:inbox-v2.core-data-use-registration",
        schemaVersion: "v1",
        payload: {
          dataUses: [
            {
              dataClassId: "core:privacy_sensitive_evidence",
              storageRootId: "core:privacy-evidence-object",
              purposeIds: ["core:data_subject_request_execution"],
              operations: ["persist", "export", "delete", "verify_absence"],
              canonicalAnchorId: "core:case_completion_or_release",
              lifecycleHandlerId: "core:lifecycle.privacy-evidence",
              subjectDiscoveryHandlerId:
                "core:lifecycle.privacy-evidence-subject-discovery",
              exportProjectionHandlerId:
                "core:lifecycle.privacy-evidence-export-projection",
              exportHandlerId: "core:lifecycle.privacy-evidence-export",
              deleteHandlerId: "core:lifecycle.privacy-evidence-delete",
              verificationHandlerId: "core:lifecycle.privacy-evidence-verify"
            }
          ]
        }
      }
    ]
  });
}

describe("Inbox V2 privacy audit contracts", () => {
  it("accepts versioned minimized audit and evidence references", () => {
    expect(inboxV2SafeAuditRecordSchema.safeParse(auditRecord()).success).toBe(
      true
    );
    expect(
      inboxV2SafeAuditEnvelopeSchema.safeParse({
        schemaId: "core:inbox-v2.safe-audit",
        schemaVersion: "v1",
        payload: auditRecord()
      }).success
    ).toBe(true);
    expect(
      inboxV2PrivacyEvidenceSchema.safeParse(privacyEvidence()).success
    ).toBe(true);
    expect(
      inboxV2PrivacyEvidenceEnvelopeSchema.safeParse({
        schemaId: "core:inbox-v2.privacy-evidence",
        schemaVersion: "v1",
        payload: privacyEvidence()
      }).success
    ).toBe(true);
    expect(() =>
      assertInboxV2ClosedJsonSchema(
        inboxV2SafeAuditRecordSchema,
        "privacy safe audit"
      )
    ).not.toThrow();
    expect(() =>
      assertInboxV2ClosedJsonSchema(
        inboxV2PrivacyEvidenceSchema,
        "privacy evidence"
      )
    ).not.toThrow();
  });

  it("structurally rejects copied content, PII, credentials and arbitrary metadata", () => {
    for (const forbidden of [
      { messageText: "secret message" },
      { phone: "+79990000000" },
      { email: "person@example.test" },
      { token: "provider-token" },
      { rawProviderPayload: { update_id: 1 } },
      { metadata: { arbitrary: true } }
    ]) {
      expect(
        inboxV2SafeAuditRecordSchema.safeParse({
          ...auditRecord(),
          ...forbidden
        }).success
      ).toBe(false);
    }
    expect(
      inboxV2SafeAuditRecordSchema.safeParse({
        ...auditRecord(),
        auditId: "privacy-audit:Bearer_SECRET_message_body"
      }).success
    ).toBe(false);
    for (const entityId of [
      "79990000000",
      "person@example.test",
      "telegram:123456789",
      "+79990000000"
    ]) {
      expect(
        inboxV2SafeAuditRecordSchema.safeParse({
          ...auditRecord(),
          target: { ...target, entityId }
        }).success
      ).toBe(false);
      expect(
        inboxV2PrivacyEvidenceSchema.safeParse({
          ...privacyEvidence(),
          target: { ...target, entityId }
        }).success
      ).toBe(false);
    }
    expect(
      inboxV2SafeAuditRecordSchema.safeParse({
        ...auditRecord(),
        correlationId: "person@example.test"
      }).success
    ).toBe(false);
    for (const [requestId, clientMutationId] of [
      ["79990000000", `mutation:${"2".repeat(32)}`],
      ["request:telegram-123456789", `mutation:${"2".repeat(32)}`],
      [`request:${"1".repeat(32)}`, "phone:79990000000"],
      [`request:${"1".repeat(32)}`, "mutation:provider-business-key"]
    ]) {
      expect(
        inboxV2SafeAuditRecordSchema.safeParse({
          ...auditRecord(),
          requestId,
          clientMutationId
        }).success
      ).toBe(false);
    }
    expect(
      inboxV2PrivacyEvidenceSchema.safeParse({
        ...privacyEvidence(),
        evidenceId: "privacy-evidence:customer-phone-79990000000"
      }).success
    ).toBe(false);
    expect(
      inboxV2PrivacyEvidenceSchema.safeParse({
        ...privacyEvidence(),
        payload: {
          ...privacyEvidence().payload,
          recordId: "privacy-evidence-payload:person-alice"
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2SafeAuditRecordSchema.safeParse({
        ...auditRecord(),
        evidenceRef: {
          tenantId,
          entityTypeId: "core:privacy-evidence",
          entityId: "privacy-evidence:person-alice"
        }
      }).success
    ).toBe(false);
  });

  it("rejects cross-tenant actors, targets and sensitive evidence payloads", () => {
    const crossTenantActor = structuredClone(auditRecord());
    if (crossTenantActor.actor.kind === "employee") {
      crossTenantActor.actor.employee.tenantId = "tenant:tenant-2";
    }
    expect(
      inboxV2SafeAuditRecordSchema.safeParse(crossTenantActor).success
    ).toBe(false);

    const crossTenantEvidence = structuredClone(privacyEvidence());
    crossTenantEvidence.payload.tenantId = "tenant:tenant-2";
    expect(
      inboxV2PrivacyEvidenceSchema.safeParse(crossTenantEvidence).success
    ).toBe(false);
  });

  it("requires finite audit retention and no state revision on denial", () => {
    expect(
      inboxV2SafeAuditRecordSchema.safeParse({
        ...auditRecord(),
        evidenceRef: null
      }).success
    ).toBe(true);
    expect(
      inboxV2SafeAuditRecordSchema.safeParse({
        ...auditRecord(),
        expiresAt: occurredAt
      }).success
    ).toBe(false);
    expect(
      inboxV2SafeAuditRecordSchema.safeParse({
        ...auditRecord(),
        outcome: "denied",
        afterRevision: "2"
      }).success
    ).toBe(false);

    const denied = {
      ...auditRecord(),
      outcome: "denied" as const,
      afterRevision: null,
      authorizationFacets: auditRecord().authorizationFacets.map((facet) => ({
        ...facet,
        outcome: "denied" as const
      }))
    };
    expect(inboxV2SafeAuditRecordSchema.safeParse(denied).success).toBe(true);
  });

  it("requires non-empty authorization facets coherent with the audit outcome", () => {
    expect(
      inboxV2SafeAuditRecordSchema.safeParse({
        ...auditRecord(),
        authorizationFacets: []
      }).success
    ).toBe(false);

    const deniedWithAllowedFacet = {
      ...auditRecord(),
      outcome: "denied" as const,
      afterRevision: null
    };
    expect(
      inboxV2SafeAuditRecordSchema.safeParse(deniedWithAllowedFacet).success
    ).toBe(false);

    const succeededWithDeniedFacet = {
      ...auditRecord(),
      authorizationFacets: auditRecord().authorizationFacets.map((facet) => ({
        ...facet,
        outcome: "denied" as const
      }))
    };
    expect(
      inboxV2SafeAuditRecordSchema.safeParse(succeededWithDeniedFacet).success
    ).toBe(false);
  });

  it("rejects duplicate authorization facets", () => {
    const duplicate = auditRecord();
    duplicate.authorizationFacets.push({
      ...duplicate.authorizationFacets[0]!
    });
    expect(inboxV2SafeAuditRecordSchema.safeParse(duplicate).success).toBe(
      false
    );
  });

  it("requires authentic registry-bound class, purpose, root and handler lineage", () => {
    const registry = privacyEvidenceRegistry();
    const evidence = defineInboxV2PrivacyEvidence({
      evidence: privacyEvidence(),
      registry
    });
    expect(evidence.evidenceId).toBe(evidenceId);
    expect(isInboxV2PrivacyEvidence(evidence)).toBe(true);
    expect(Object.isFrozen(evidence)).toBe(true);
    expect(Object.isFrozen(evidence.payload)).toBe(true);
    expect(Reflect.set(evidence, "expiresAt", "2099-01-01T00:00:00.000Z")).toBe(
      false
    );
    expect(isInboxV2PrivacyEvidence(structuredClone(evidence))).toBe(false);

    expect(() =>
      defineInboxV2PrivacyEvidence({
        evidence: privacyEvidence(),
        registry: structuredClone(registry) as typeof registry
      })
    ).toThrow(/authentic composed registry/u);

    for (const [field, value, expected] of [
      ["dataClassId", "core:unknown_privacy_evidence", /Unknown.*data class/u],
      ["purposeId", "core:unknown_privacy_purpose", /Unknown.*purpose/u],
      [
        "rootId",
        "core:unknown-privacy-evidence-root",
        /Unknown.*storage root/u
      ],
      [
        "lifecycleHandlerId",
        "core:lifecycle.privacy-evidence-delete",
        /registered class\/root lifecycle policy/u
      ],
      [
        "purposeId",
        "core:legal_claim_or_regulatory_duty",
        /no registered exact data-use lineage/u
      ]
    ] as const) {
      expect(() =>
        defineInboxV2PrivacyEvidence({
          evidence: { ...privacyEvidence(), [field]: value },
          registry
        })
      ).toThrow(expected);
    }
  });
});
