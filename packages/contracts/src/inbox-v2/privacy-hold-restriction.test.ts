import { describe, expect, it } from "vitest";

import { defineInboxV2DataLifecycleRegistry } from "./data-lifecycle-catalog";
import {
  defineInboxV2LegalHold,
  defineInboxV2PrivacyScopeManifest,
  defineInboxV2ProspectivePrivacyScopeMatcher,
  defineInboxV2ProcessingRestriction,
  inboxV2LegalHoldSchema,
  inboxV2LegalHoldEnvelopeSchema,
  inboxV2PrivacyScopeManifestEnvelopeSchema,
  inboxV2ProcessingRestrictionSchema,
  inboxV2ProcessingRestrictionEnvelopeSchema,
  isInboxV2LegalHold,
  isInboxV2PrivacyScopeManifest,
  isInboxV2ProcessingRestriction,
  matchInboxV2LegalHold,
  matchInboxV2ProcessingRestriction
} from "./privacy-hold-restriction";
import { assertInboxV2ClosedJsonSchema } from "./schema-safety";

const tenantId = "tenant:tenant-1";
const entity = {
  tenantId,
  entityTypeId: "core:message",
  entityId: "message:message-1"
};

function manifest() {
  return defineInboxV2PrivacyScopeManifest({
    tenantId,
    id: "scope-manifest:scope-1",
    revision: "1",
    frozenAt: "2026-01-01T00:00:00.000Z",
    roots: [
      {
        root: {
          tenantId,
          dataClassId: "core:message_content_blocks",
          storageRootId: "core:message-content-sql",
          recordId: "data_root:message-1"
        },
        entity,
        expectedEntityRevision: "5",
        expectedLineageRevision: "7",
        rootKind: "sql" as const,
        boundary: "operated_data_plane" as const,
        copyRole: "primary" as const
      }
    ]
  });
}

function registry() {
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
              id: "core:message-content-sql",
              definition: {
                kind: "sql",
                boundary: "operated_data_plane",
                tenantIsolation: "required",
                versionEnumeration: "not_applicable",
                configurationProfileId: "core:storage-profile.sql"
              }
            },
            {
              id: "core:call-metadata-sql",
              definition: {
                kind: "sql",
                boundary: "operated_data_plane",
                tenantIsolation: "required",
                versionEnumeration: "not_applicable",
                configurationProfileId: "core:storage-profile.sql"
              }
            },
            {
              id: "core:notification-endpoint-sql",
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
              id: "core:condition-resolver",
              definition: {
                kind: "condition_resolution",
                supportedRootKinds: ["sql"],
                supportedOperations: ["read"],
                bounded: true,
                idempotent: true,
                checksTenantFence: true,
                checksRevisionFence: true,
                checksHoldFence: false,
                verifiesAbsence: false
              }
            },
            {
              id: "core:scope-matcher",
              definition: {
                kind: "scope_matcher",
                supportedRootKinds: ["sql"],
                supportedOperations: ["read"],
                bounded: true,
                idempotent: true,
                checksTenantFence: true,
                checksRevisionFence: true,
                checksHoldFence: false,
                verifiesAbsence: false
              }
            },
            ...(
              [
                ["lifecycle", "lifecycle", "persist", false],
                ["subject-discovery", "subject_discovery", "read", false],
                ["export-projection", "export_projection", "export", false],
                ["export", "export_execution", "export", false],
                ["delete", "delete_execution", "delete", false],
                ["verify", "verification", "verify_absence", true]
              ] as const
            ).map(([suffix, kind, operation, verifiesAbsence]) => ({
              id: `core:hold-${suffix}`,
              definition: {
                kind,
                supportedRootKinds: ["sql" as const],
                supportedOperations:
                  suffix === "lifecycle"
                    ? [
                        ...([
                          "persist",
                          "export",
                          "delete",
                          "verify_absence"
                        ] as const)
                      ]
                    : [operation],
                bounded: true as const,
                idempotent: true as const,
                checksTenantFence: true as const,
                checksRevisionFence: true as const,
                checksHoldFence: true as const,
                verifiesAbsence
              }
            }))
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
              dataClassId: "core:message_content_blocks",
              storageRootId: "core:message-content-sql",
              purposeIds: [
                "core:customer_service_history",
                "core:legal_claim_or_regulatory_duty"
              ],
              operations: ["persist", "export", "delete", "verify_absence"],
              canonicalAnchorId: "core:canonical_item_time",
              lifecycleHandlerId: "core:hold-lifecycle",
              subjectDiscoveryHandlerId: "core:hold-subject-discovery",
              exportProjectionHandlerId: "core:hold-export-projection",
              exportHandlerId: "core:hold-export",
              deleteHandlerId: "core:hold-delete",
              verificationHandlerId: "core:hold-verify"
            },
            {
              dataClassId: "core:call_metadata",
              storageRootId: "core:call-metadata-sql",
              purposeIds: ["core:customer_service_history"],
              operations: ["persist", "export", "delete", "verify_absence"],
              canonicalAnchorId: "core:call_completion",
              lifecycleHandlerId: "core:hold-lifecycle",
              subjectDiscoveryHandlerId: "core:hold-subject-discovery",
              exportProjectionHandlerId: "core:hold-export-projection",
              exportHandlerId: "core:hold-export",
              deleteHandlerId: "core:hold-delete",
              verificationHandlerId: "core:hold-verify"
            },
            {
              dataClassId: "core:notification_endpoint",
              storageRootId: "core:notification-endpoint-sql",
              purposeIds: ["core:product_notification"],
              operations: ["persist", "export", "delete", "verify_absence"],
              canonicalAnchorId: "core:revoke_or_deactivation",
              lifecycleHandlerId: "core:hold-lifecycle",
              subjectDiscoveryHandlerId: "core:hold-subject-discovery",
              exportProjectionHandlerId: "core:hold-export-projection",
              exportHandlerId: "core:hold-export",
              deleteHandlerId: "core:hold-delete",
              verificationHandlerId: "core:hold-verify"
            }
          ]
        }
      }
    ]
  });
}

function exactScope() {
  return {
    kind: "exact" as const,
    targets: [entity],
    manifest: manifest(),
    futureMatch: "none" as const
  };
}

function target(
  sensitivity: "restricted_content" | "secret" = "restricted_content",
  holdEligible = true
) {
  return {
    tenantId,
    root: manifest().roots[0]!.root,
    entity,
    entityRevision: "5",
    lineageRevision: "7",
    dataClassId: "core:message_content_blocks",
    sensitivity,
    holdEligible,
    anchorAt: "2026-01-02T00:00:00.000Z"
  };
}

function hold() {
  return {
    tenantId,
    id: "hold:case-1",
    revision: "7",
    caseId: "case:case-1",
    dataClassIds: ["core:message_content_blocks"],
    scope: exactScope(),
    anchorFrom: "2026-01-01T00:00:00.000Z",
    anchorThrough: "2026-12-31T23:59:59.999Z",
    owner: { tenantId, kind: "employee" as const, id: "employee:owner" },
    approver: {
      tenantId,
      kind: "employee" as const,
      id: "employee:approver"
    },
    reasonCode: "core:legal-claim",
    legalReferenceCode: "core:case-reference",
    endCondition: {
      id: "core:legal-case-closed",
      version: "1",
      resolverHandlerId: "core:condition-resolver"
    },
    effectiveAt: "2026-01-01T00:00:00.000Z",
    reviewAt: "2026-06-01T00:00:00.000Z",
    state: "active" as const
  };
}

function restriction() {
  return {
    tenantId,
    id: "restriction:case-1",
    revision: "3",
    scope: exactScope(),
    dataClassIds: ["core:message_content_blocks"],
    continuingPurposeIds: ["core:legal_claim_or_regulatory_duty"],
    allowedUses: ["legal_claim" as const, "storage" as const],
    owner: { tenantId, kind: "employee" as const, id: "employee:owner" },
    reasonCode: "core:subject-objection",
    endCondition: {
      id: "core:objection-resolved",
      version: "1",
      resolverHandlerId: "core:condition-resolver"
    },
    effectiveAt: "2026-01-01T00:00:00.000Z",
    reviewAt: "2026-04-01T00:00:00.000Z",
    state: "active" as const
  };
}

function definedHold(
  value: Parameters<typeof defineInboxV2LegalHold>[0]["hold"] = hold(),
  lifecycleRegistry = registry()
) {
  return defineInboxV2LegalHold({ hold: value, registry: lifecycleRegistry });
}

function definedRestriction(
  value: Parameters<
    typeof defineInboxV2ProcessingRestriction
  >[0]["restriction"] = restriction(),
  lifecycleRegistry = registry()
) {
  return defineInboxV2ProcessingRestriction({
    restriction: value,
    registry: lifecycleRegistry
  });
}

describe("Inbox V2 legal hold and processing restriction", () => {
  it("keeps hold and restriction boundary schemas closed", () => {
    expect(() =>
      assertInboxV2ClosedJsonSchema(inboxV2LegalHoldSchema, "legal hold")
    ).not.toThrow();
    expect(() =>
      assertInboxV2ClosedJsonSchema(
        inboxV2ProcessingRestrictionSchema,
        "processing restriction"
      )
    ).not.toThrow();
    expect(
      inboxV2PrivacyScopeManifestEnvelopeSchema.safeParse({
        schemaId: "core:inbox-v2.privacy-scope-manifest",
        schemaVersion: "v1",
        payload: manifest()
      }).success
    ).toBe(true);
    expect(
      inboxV2LegalHoldEnvelopeSchema.safeParse({
        schemaId: "core:inbox-v2.legal-hold",
        schemaVersion: "v1",
        payload: hold()
      }).success
    ).toBe(true);
    expect(
      inboxV2ProcessingRestrictionEnvelopeSchema.safeParse({
        schemaId: "core:inbox-v2.processing-restriction",
        schemaVersion: "v1",
        payload: restriction()
      }).success
    ).toBe(true);
  });

  it("matches exact active controls while preserving exact revision/review", () => {
    expect(inboxV2LegalHoldSchema.safeParse(hold()).success).toBe(true);
    const active = definedHold();
    expect(active).toEqual(hold());
    expect(
      matchInboxV2LegalHold({
        hold: active,
        target: target(),
        now: "2026-05-01T00:00:00.000Z"
      })
    ).toEqual({ kind: "matches", reviewOverdue: false });
    expect(
      matchInboxV2LegalHold({
        hold: active,
        target: target(),
        now: "2026-07-01T00:00:00.000Z"
      })
    ).toEqual({ kind: "matches", reviewOverdue: true });

    const released = definedHold({
      ...hold(),
      state: "released" as const,
      releasedAt: "2026-06-15T00:00:00.000Z"
    });
    expect(
      matchInboxV2LegalHold({
        hold: released,
        target: target(),
        now: "2026-05-01T00:00:00.000Z"
      })
    ).toEqual({ kind: "matches", reviewOverdue: false });
    expect(
      matchInboxV2LegalHold({
        hold: released,
        target: target(),
        now: "2026-07-01T00:00:00.000Z"
      })
    ).toEqual({ kind: "does_not_match" });
  });

  it("never lets a hold preserve secrets or cross tenant boundaries", () => {
    const active = definedHold();
    expect(
      matchInboxV2LegalHold({
        hold: active,
        target: target("secret"),
        now: "2026-05-01T00:00:00.000Z"
      })
    ).toEqual({
      kind: "rejected",
      errorCode: "privacy.data_class_not_hold_eligible"
    });
    expect(
      matchInboxV2LegalHold({
        hold: active,
        target: target("restricted_content", false),
        now: "2026-05-01T00:00:00.000Z"
      })
    ).toEqual({
      kind: "rejected",
      errorCode: "privacy.data_class_not_hold_eligible"
    });
    expect(
      matchInboxV2LegalHold({
        hold: active,
        target: {
          ...target(),
          tenantId: "tenant:tenant-2",
          root: { ...target().root, tenantId: "tenant:tenant-2" },
          entity: { ...entity, tenantId: "tenant:tenant-2" }
        },
        now: "2026-05-01T00:00:00.000Z"
      })
    ).toEqual({ kind: "rejected", errorCode: "privacy.policy_missing" });
    expect(
      inboxV2LegalHoldSchema.safeParse({
        ...hold(),
        scope: {
          ...hold().scope,
          manifest: {
            ...hold().scope.manifest,
            tenantId: "tenant:tenant-2"
          }
        }
      }).success
    ).toBe(false);
  });

  it("models restriction as allowed processing, never a retention extension", () => {
    expect(
      inboxV2ProcessingRestrictionSchema.safeParse(restriction()).success
    ).toBe(true);
    const active = definedRestriction();
    expect(
      matchInboxV2ProcessingRestriction({
        restriction: active,
        target: target(),
        now: "2026-02-01T00:00:00.000Z"
      })
    ).toEqual({ kind: "matches", reviewOverdue: false });
    expect(
      inboxV2ProcessingRestrictionSchema.safeParse({
        ...restriction(),
        retentionExtension: { kind: "elapsed", seconds: 86_400 }
      }).success
    ).toBe(false);
    expect(
      inboxV2ProcessingRestrictionSchema.safeParse({
        ...restriction(),
        reviewAt: restriction().effectiveAt
      }).success
    ).toBe(false);
    expect(
      defineInboxV2ProcessingRestriction({
        restriction: restriction(),
        registry: registry()
      })
    ).toEqual(restriction());
  });

  it("rejects forged manifests and registry-incompatible controls", () => {
    expect(
      inboxV2LegalHoldSchema.safeParse({
        ...hold(),
        scope: {
          ...exactScope(),
          manifest: {
            ...manifest(),
            manifestHash: `sha256:${"f".repeat(64)}`
          }
        }
      }).success
    ).toBe(false);

    expect(() =>
      defineInboxV2LegalHold({
        hold: { ...hold(), dataClassIds: ["core:notification_endpoint"] },
        registry: registry()
      })
    ).toThrow(/not hold eligible/u);

    expect(() =>
      defineInboxV2ProcessingRestriction({
        restriction: {
          ...restriction(),
          dataClassIds: ["core:unknown_data_class"]
        },
        registry: registry()
      })
    ).toThrow(/unknown/u);

    expect(() =>
      defineInboxV2LegalHold({
        hold: {
          ...hold(),
          scope: {
            kind: "prospective",
            matcherHandlerId: "core:unregistered-scope-matcher",
            matcherVersion: "1",
            predicateHash: `sha256:${"a".repeat(64)}`,
            manifest: manifest(),
            futureMatch: "match_until_release"
          }
        },
        registry: registry()
      })
    ).toThrow(/scope_matcher/u);

    expect(
      inboxV2LegalHoldSchema.safeParse({
        ...hold(),
        scope: {
          ...exactScope(),
          targets: [
            entity,
            { ...entity, entityId: "message:message-not-in-manifest" }
          ]
        }
      }).success
    ).toBe(false);
  });

  it("requires authentic immutable manifests and controls at executable match boundaries", () => {
    const scopeManifest = manifest();
    const activeHold = definedHold();
    const activeRestriction = definedRestriction();

    expect(isInboxV2PrivacyScopeManifest(scopeManifest)).toBe(true);
    expect(isInboxV2LegalHold(activeHold)).toBe(true);
    expect(isInboxV2ProcessingRestriction(activeRestriction)).toBe(true);
    expect(Object.isFrozen(scopeManifest.roots[0])).toBe(true);
    expect(Object.isFrozen(activeHold.scope.manifest)).toBe(true);
    expect(Object.isFrozen(activeRestriction.allowedUses)).toBe(true);
    expect(
      Reflect.set(activeHold, "reviewAt", "2099-01-01T00:00:00.000Z")
    ).toBe(false);
    expect(isInboxV2LegalHold(structuredClone(activeHold))).toBe(false);
    expect(
      isInboxV2ProcessingRestriction(structuredClone(activeRestriction))
    ).toBe(false);
    expect(
      matchInboxV2LegalHold({
        hold: structuredClone(activeHold),
        target: target(),
        now: "2026-05-01T00:00:00.000Z"
      })
    ).toEqual({ kind: "rejected", errorCode: "privacy.policy_missing" });
    expect(
      matchInboxV2ProcessingRestriction({
        restriction: structuredClone(activeRestriction),
        target: target(),
        now: "2026-02-01T00:00:00.000Z"
      })
    ).toEqual({ kind: "rejected", errorCode: "privacy.policy_missing" });

    expect(() =>
      defineInboxV2LegalHold({
        hold: structuredClone(activeHold),
        registry: registry()
      })
    ).toThrow(/authentic frozen privacy scope manifest/u);
  });

  it("pins exact scope matches to root, entity and both revision fences", () => {
    const active = definedHold();
    for (const staleTarget of [
      { ...target(), entityRevision: "6" },
      { ...target(), lineageRevision: "8" },
      {
        ...target(),
        root: { ...target().root, recordId: "data_root:message-2" }
      },
      {
        ...target(),
        root: {
          ...target().root,
          storageRootId: "core:call-metadata-sql"
        }
      }
    ]) {
      expect(
        matchInboxV2LegalHold({
          hold: active,
          target: staleTarget,
          now: "2026-05-01T00:00:00.000Z"
        })
      ).toEqual({ kind: "does_not_match" });
    }
  });

  it("accepts only an exact registry-bound prospective matcher capability", () => {
    const lifecycleRegistry = registry();
    const predicateHash = `sha256:${"a".repeat(64)}`;
    const prospective = definedHold(
      {
        ...hold(),
        scope: {
          kind: "prospective",
          matcherHandlerId: "core:scope-matcher",
          matcherVersion: "2",
          predicateHash,
          manifest: manifest(),
          futureMatch: "match_until_release"
        }
      },
      lifecycleRegistry
    );
    const fakeMatcher = {
      registryCompositionHash: lifecycleRegistry.compositionHash,
      matcherHandlerId: "core:scope-matcher",
      matcherVersion: "2",
      predicateHash,
      matches: () => false
    } as unknown as Parameters<
      typeof matchInboxV2LegalHold
    >[0]["prospectiveMatcher"];
    expect(
      matchInboxV2LegalHold({
        hold: prospective,
        target: target(),
        now: "2026-05-01T00:00:00.000Z",
        prospectiveMatcher: fakeMatcher
      })
    ).toEqual({ kind: "rejected", errorCode: "privacy.scope_ambiguous" });

    const matcher = defineInboxV2ProspectivePrivacyScopeMatcher({
      registry: lifecycleRegistry,
      matcherHandlerId: "core:scope-matcher",
      matcherVersion: "2",
      predicateHash,
      matches: () => false
    });
    expect(
      matchInboxV2LegalHold({
        hold: prospective,
        target: target(),
        now: "2026-05-01T00:00:00.000Z",
        prospectiveMatcher: matcher
      })
    ).toEqual({ kind: "does_not_match" });
  });

  it("keeps restrictions independent from hold eligibility and intersects class purposes", () => {
    const lifecycleRegistry = registry();
    const notificationManifest = defineInboxV2PrivacyScopeManifest({
      tenantId,
      id: "scope-manifest:notification",
      revision: "1",
      frozenAt: "2026-01-01T00:00:00.000Z",
      roots: [
        {
          root: {
            tenantId,
            dataClassId: "core:notification_endpoint",
            storageRootId: "core:notification-endpoint-sql",
            recordId: "data_root:notification-endpoint-1"
          },
          entity,
          expectedEntityRevision: "5",
          expectedLineageRevision: "7",
          rootKind: "sql",
          boundary: "operated_data_plane",
          copyRole: "primary"
        }
      ]
    });
    const notificationRestriction = defineInboxV2ProcessingRestriction({
      registry: lifecycleRegistry,
      restriction: {
        ...restriction(),
        id: "restriction:notification",
        scope: {
          kind: "exact",
          targets: [entity],
          manifest: notificationManifest,
          futureMatch: "none"
        },
        dataClassIds: ["core:notification_endpoint"],
        continuingPurposeIds: ["core:product_notification"]
      }
    });
    expect(
      matchInboxV2ProcessingRestriction({
        restriction: notificationRestriction,
        target: {
          ...target("restricted_content", false),
          root: notificationManifest.roots[0]!.root,
          dataClassId: "core:notification_endpoint",
          sensitivity: "personal_identifier"
        },
        now: "2026-02-01T00:00:00.000Z"
      })
    ).toEqual({ kind: "matches", reviewOverdue: false });

    const multiClassManifest = defineInboxV2PrivacyScopeManifest({
      tenantId,
      id: "scope-manifest:multi-class",
      revision: "1",
      frozenAt: "2026-01-01T00:00:00.000Z",
      roots: [
        {
          root: {
            tenantId,
            dataClassId: "core:call_metadata",
            storageRootId: "core:call-metadata-sql",
            recordId: "data_root:call-1"
          },
          entity,
          expectedEntityRevision: "5",
          expectedLineageRevision: "7",
          rootKind: "sql",
          boundary: "operated_data_plane",
          copyRole: "primary"
        },
        manifest().roots[0]!
      ]
    });
    expect(() =>
      defineInboxV2ProcessingRestriction({
        registry: lifecycleRegistry,
        restriction: {
          ...restriction(),
          id: "restriction:multi-class",
          scope: {
            kind: "exact",
            targets: [entity],
            manifest: multiClassManifest,
            futureMatch: "none"
          },
          dataClassIds: ["core:call_metadata", "core:message_content_blocks"],
          continuingPurposeIds: ["core:legal_claim_or_regulatory_duty"]
        }
      })
    ).toThrow(/not registered for its classes/u);
  });
});
