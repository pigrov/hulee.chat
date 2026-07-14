import { describe, expect, it } from "vitest";

import {
  calculateInboxV2SubjectDiscoveryManifestDigest,
  defineInboxV2SubjectDiscoveryManifest,
  defineInboxV2SubjectDiscoverySource,
  getInboxV2SubjectDiscoveryCompletenessProof,
  inboxV2ClassifiedEvidenceReferenceSchema,
  inboxV2SubjectDiscoveryCompletenessProofSchema,
  inboxV2SubjectDiscoveryManifestEnvelopeSchema,
  inboxV2SubjectDiscoveryManifestSchema,
  isInboxV2SubjectDiscoveryManifest,
  matchesInboxV2SubjectDiscoveryManifestReference,
  resolveInboxV2SubjectDiscoveryManifest
} from "./data-subject-discovery";
import { defineInboxV2DataLifecycleRegistry } from "./data-lifecycle-catalog";
import { assertInboxV2ClosedJsonSchema } from "./schema-safety";

const tenantId = "tenant:tenant-1";
const otherTenantId = "tenant:tenant-2";
const hashA = `sha256:${"a".repeat(64)}`;

const requester = {
  kind: "client_contact" as const,
  clientContact: {
    kind: "client_contact" as const,
    tenantId,
    id: "client_contact:client-1"
  }
};
const employee = {
  kind: "employee" as const,
  employee: {
    kind: "employee" as const,
    tenantId,
    id: "employee:employee-1"
  }
};
const unresolved = {
  kind: "unresolved_provider_subject" as const,
  tenantId,
  id: "unresolved_provider_subject:telegram-user-3",
  realmId: "core:source-identity-realm.telegram-account-user",
  scope: { kind: "provider" as const }
};
const root = {
  tenantId,
  dataClassId: "core:message_content_blocks",
  storageRootId: "core:message-content",
  recordId: "data_root:group-message-1"
};

function evidence() {
  return {
    tenantId,
    dataClassId: "core:privacy_sensitive_evidence",
    storageRootId: "core:privacy-evidence-object",
    payload: {
      tenantId,
      recordId: "payload:discovery-evidence-1",
      schemaId: "core:inbox-v2.discovery-evidence",
      schemaVersion: "v1",
      digest: hashA
    }
  };
}

function manifestBody() {
  const provenance = {
    kind: "canonical_relation" as const,
    evidence: evidence()
  };
  return {
    tenantId,
    id: "subject_discovery:request-1",
    requesterSubject: requester,
    discoveredSubjects: [requester, employee, unresolved],
    subjectLinks: [
      {
        tenantId,
        id: "subject_link:01-client",
        root,
        subject: requester,
        role: "participant" as const,
        provenance,
        revision: "1",
        createdAt: "2026-07-12T09:00:00.000Z"
      },
      {
        tenantId,
        id: "subject_link:02-employee",
        root,
        subject: employee,
        role: "participant" as const,
        provenance,
        revision: "1",
        createdAt: "2026-07-12T09:00:00.000Z"
      },
      {
        tenantId,
        id: "subject_link:03-unresolved",
        root,
        subject: unresolved,
        role: "mentioned_person" as const,
        provenance,
        revision: "1",
        createdAt: "2026-07-12T09:00:00.000Z"
      }
    ],
    roots: [
      {
        root,
        subjects: [requester, employee, unresolved],
        relationshipToRequester: "mixed" as const,
        thirdPartyProtection: {
          kind: "redact_or_omit" as const,
          status: "review_required" as const,
          policyProfile: {
            id: "core:governance-profile.default",
            version: "1"
          },
          reasonCode: "core:privacy.third-party-protection"
        }
      }
    ],
    coverage: [
      {
        kind: "deterministic" as const,
        root,
        method: "structured_subject_link" as const,
        outcome: "matched" as const
      },
      {
        kind: "manual_review" as const,
        root,
        outcome: "required" as const,
        evidence: [evidence()]
      }
    ],
    revision: "1",
    generatedAt: "2026-07-12T09:05:00.000Z"
  };
}

function lifecycleHandler(kind: "lifecycle" | "subject_discovery") {
  return {
    kind,
    supportedRootKinds: ["sql" as const],
    supportedOperations: ["read" as const],
    bounded: true as const,
    idempotent: true as const,
    checksTenantFence: true as const,
    checksRevisionFence: true as const,
    checksHoldFence: true as const,
    verifiesAbsence: false
  };
}

function discoveryRegistry() {
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
              id: root.storageRootId,
              definition: {
                kind: "sql",
                boundary: "operated_data_plane",
                tenantIsolation: "required",
                versionEnumeration: "not_applicable",
                configurationProfileId: "core:storage-profile.sql"
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
              id: "core:lifecycle.discovery-test",
              definition: lifecycleHandler("lifecycle")
            },
            {
              id: "core:lifecycle.discovery-test-subjects",
              definition: lifecycleHandler("subject_discovery")
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
              dataClassId: root.dataClassId,
              storageRootId: root.storageRootId,
              purposeIds: ["core:customer_service_history"],
              operations: ["read"],
              canonicalAnchorId: "core:canonical_item_time",
              lifecycleHandlerId: "core:lifecycle.discovery-test",
              subjectDiscoveryHandlerId:
                "core:lifecycle.discovery-test-subjects",
              exportProjectionHandlerId: null,
              exportHandlerId: null,
              deleteHandlerId: null,
              verificationHandlerId: null
            }
          ]
        }
      }
    ]
  });
}

function discoverySource(
  result: ReturnType<typeof manifestBody> = manifestBody(),
  scannedDiscoveryHandlerIds: readonly string[] = [
    "core:lifecycle.discovery-test-subjects"
  ]
) {
  return defineInboxV2SubjectDiscoverySource({
    id: "core:governance-profile.discovery-test-source",
    version: "1",
    loadCompleteDiscovery: () => ({
      ...result,
      streamEpoch: "epoch-1",
      syncGeneration: "1",
      completeThroughPosition: "42",
      scannedDiscoveryHandlerIds: [...scannedDiscoveryHandlerIds]
    })
  });
}

function manifest() {
  return resolveInboxV2SubjectDiscoveryManifest({
    source: discoverySource(),
    registry: discoveryRegistry(),
    tenantId,
    requesterSubject: requester
  });
}

describe("Inbox V2 data-subject discovery", () => {
  it("represents a mixed client/employee/provider group without scalar Client ownership", () => {
    const value = manifest();
    const proof = getInboxV2SubjectDiscoveryCompletenessProof(value);
    expect(isInboxV2SubjectDiscoveryManifest(value)).toBe(true);
    expect(proof).not.toBeNull();
    expect(proof?.resultKind).toBe("complete_nonempty");
    expect(proof?.rootCount).toBe(1);
    expect(
      inboxV2SubjectDiscoveryCompletenessProofSchema.safeParse(proof).success
    ).toBe(true);
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.roots)).toBe(true);
    expect(value.digest).toBe(
      calculateInboxV2SubjectDiscoveryManifestDigest(manifestBody())
    );
    expect(inboxV2SubjectDiscoveryManifestSchema.safeParse(value).success).toBe(
      true
    );
    expect(
      inboxV2SubjectDiscoveryManifestEnvelopeSchema.safeParse({
        schemaId: "core:inbox-v2.subject-discovery-manifest",
        schemaVersion: "v1",
        payload: value
      }).success
    ).toBe(true);
    expect(
      matchesInboxV2SubjectDiscoveryManifestReference({
        manifest: value,
        reference: {
          tenantId,
          id: value.id,
          revision: value.revision,
          digest: value.digest
        }
      })
    ).toBe(true);
  });

  it("rejects caller-authored or stale-digest discovery authority", () => {
    const authentic = manifest();
    const lookalike = structuredClone(authentic);
    expect(
      inboxV2SubjectDiscoveryManifestSchema.safeParse(lookalike).success
    ).toBe(true);
    expect(isInboxV2SubjectDiscoveryManifest(lookalike)).toBe(false);

    const tampered = {
      ...lookalike,
      generatedAt: "2026-07-12T09:06:00.000Z"
    };
    expect(
      inboxV2SubjectDiscoveryManifestSchema.safeParse(tampered).success
    ).toBe(false);

    const recomputed = defineInboxV2SubjectDiscoveryManifest({
      ...manifestBody(),
      digest: hashA
    });
    expect(recomputed.digest).not.toBe(hashA);
    expect(isInboxV2SubjectDiscoveryManifest(recomputed)).toBe(false);
    expect(getInboxV2SubjectDiscoveryCompletenessProof(recomputed)).toBeNull();
  });

  it("rejects source lookalikes and incomplete handler scans", () => {
    const registry = discoveryRegistry();
    const source = discoverySource();
    const lookalike = { ...source };
    expect(() =>
      resolveInboxV2SubjectDiscoveryManifest({
        source: lookalike,
        registry,
        tenantId,
        requesterSubject: requester
      })
    ).toThrow(/registered complete-state source/u);

    expect(() =>
      resolveInboxV2SubjectDiscoveryManifest({
        source: discoverySource(manifestBody(), []),
        registry,
        tenantId,
        requesterSubject: requester
      })
    ).toThrow(/exact registered discovery-handler set/u);
  });

  it("binds an authentic canonical proof to a complete zero result", () => {
    const body = {
      ...manifestBody(),
      discoveredSubjects: [requester],
      subjectLinks: [],
      roots: [],
      coverage: []
    };
    const zero = resolveInboxV2SubjectDiscoveryManifest({
      source: discoverySource(body),
      registry: discoveryRegistry(),
      tenantId,
      requesterSubject: requester
    });
    const proof = getInboxV2SubjectDiscoveryCompletenessProof(zero);
    expect(proof?.resultKind).toBe("complete_zero");
    expect(proof?.rootCount).toBe(0);
    expect(proof?.zeroEvidenceHash).toMatch(/^sha256:/u);
    expect(isInboxV2SubjectDiscoveryManifest(structuredClone(zero))).toBe(
      false
    );
  });

  it("requires explicit third-party protection and coverage for every group root", () => {
    const withoutProtection = structuredClone(manifest());
    withoutProtection.roots[0]!.thirdPartyProtection = null as never;
    expect(
      inboxV2SubjectDiscoveryManifestSchema.safeParse(withoutProtection).success
    ).toBe(false);

    const withoutCoverage = structuredClone(manifest());
    withoutCoverage.coverage = [];
    expect(
      inboxV2SubjectDiscoveryManifestSchema.safeParse(withoutCoverage).success
    ).toBe(false);

    const wrongClassCoverage = structuredClone(manifest());
    Reflect.set(
      wrongClassCoverage.coverage[0]!.root,
      "dataClassId",
      "core:staff_note_content_blocks"
    );
    expect(
      inboxV2SubjectDiscoveryManifestSchema.safeParse(wrongClassCoverage)
        .success
    ).toBe(false);
  });

  it("rejects cross-tenant subjects, evidence and unresolved scopes", () => {
    const crossTenantSubject = structuredClone(manifest());
    Reflect.set(crossTenantSubject.discoveredSubjects, 1, {
      ...employee,
      employee: { ...employee.employee, tenantId: otherTenantId }
    });
    expect(
      inboxV2SubjectDiscoveryManifestSchema.safeParse(crossTenantSubject)
        .success
    ).toBe(false);

    const evidenceManifest = structuredClone(manifest());
    const crossTenantEvidence = {
      ...evidenceManifest,
      coverage: evidenceManifest.coverage.map((entry) =>
        entry.kind === "manual_review"
          ? {
              ...entry,
              evidence: entry.evidence.map((value) => ({
                ...value,
                tenantId: otherTenantId
              }))
            }
          : entry
      )
    };
    expect(
      inboxV2SubjectDiscoveryManifestSchema.safeParse(crossTenantEvidence)
        .success
    ).toBe(false);

    const crossTenantScope = {
      ...unresolved,
      scope: {
        kind: "source_account" as const,
        owner: {
          kind: "source_account" as const,
          tenantId: otherTenantId,
          id: "source_account:telegram-1"
        }
      }
    };
    const unresolvedManifest = structuredClone(manifest());
    const crossTenantUnresolved = structuredClone(unresolvedManifest);
    Reflect.set(crossTenantUnresolved, "discoveredSubjects", [
      requester,
      employee,
      crossTenantScope
    ]);
    expect(
      inboxV2SubjectDiscoveryManifestSchema.safeParse(crossTenantUnresolved)
        .success
    ).toBe(false);
  });

  it("fails closed on duplicate or non-canonical subjects, roots and coverage", () => {
    const reordered = structuredClone(manifest());
    Reflect.set(reordered, "discoveredSubjects", [
      employee,
      requester,
      unresolved
    ]);
    expect(
      inboxV2SubjectDiscoveryManifestSchema.safeParse(reordered).success
    ).toBe(false);

    const duplicateCoverage = structuredClone(manifest());
    duplicateCoverage.coverage.push(duplicateCoverage.coverage[0]!);
    expect(
      inboxV2SubjectDiscoveryManifestSchema.safeParse(duplicateCoverage).success
    ).toBe(false);

    const duplicateRoot = structuredClone(manifest());
    duplicateRoot.roots.push(duplicateRoot.roots[0]!);
    expect(
      inboxV2SubjectDiscoveryManifestSchema.safeParse(duplicateRoot).success
    ).toBe(false);
  });

  it("keeps generic discovery evidence reference-only and structurally strict", () => {
    expect(
      inboxV2ClassifiedEvidenceReferenceSchema.safeParse(evidence()).success
    ).toBe(true);
    for (const forbidden of [
      { messageText: "copied content" },
      { phone: "+70000000000" },
      { rawProviderPayload: { user: "hidden" } },
      { metadata: { anything: true } }
    ]) {
      expect(
        inboxV2ClassifiedEvidenceReferenceSchema.safeParse({
          ...evidence(),
          ...forbidden
        }).success
      ).toBe(false);
    }
    expect(() =>
      assertInboxV2ClosedJsonSchema(
        inboxV2SubjectDiscoveryManifestSchema,
        "subject discovery manifest"
      )
    ).not.toThrow();
  });
});
