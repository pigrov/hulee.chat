import {
  defineInboxV2DataLifecycleRegistry,
  type InboxV2SourceExternalIdentityId,
  type InboxV2TenantId
} from "@hulee/contracts";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  buildVerifyInboxV2SourceIdentityResolutionAbsenceSql,
  defineInboxV2SourceIdentityResolutionLifecycleRegistry,
  INBOX_V2_SOURCE_IDENTITY_RESOLUTION_DATA_USE_REGISTRATION,
  INBOX_V2_SOURCE_IDENTITY_RESOLUTION_HANDLER_REGISTRATION,
  INBOX_V2_SOURCE_IDENTITY_RESOLUTION_STORAGE_ROOT_IDS,
  INBOX_V2_SOURCE_IDENTITY_RESOLUTION_STORAGE_ROOT_REGISTRATION,
  projectInboxV2SourceIdentityResolutionSubjectlessLifecycleFact
} from "./sql-inbox-v2-source-identity-resolution-lifecycle";
import type { PersistedInboxV2SourceIdentityAssessment } from "./sql-inbox-v2-source-identity-resolution-repository";

const tenantId = "tenant:src004-lifecycle" as InboxV2TenantId;
const identityId =
  "source_external_identity:src004-lifecycle" as InboxV2SourceExternalIdentityId;

describe("Inbox V2 source identity resolution lifecycle declaration", () => {
  it("registers all three subject-linked roots under the existing identity class and action", () => {
    const registry = defineInboxV2SourceIdentityResolutionLifecycleRegistry();
    expect(registry.storageRoots.map((root) => root.id)).toEqual(
      INBOX_V2_SOURCE_IDENTITY_RESOLUTION_STORAGE_ROOT_IDS
    );
    expect(registry.dataUses).toHaveLength(3);
    for (const use of registry.dataUses) {
      expect(use).toMatchObject({
        owner: "core",
        dataClassId: "core:source_external_identity",
        operations: ["persist", "export", "delete", "verify_absence"],
        canonicalAnchorId: "core:unlink_or_relationship_end"
      });
      expect(use.subjectDiscoveryHandlerId).not.toBeNull();
      expect(use.exportProjectionHandlerId).not.toBeNull();
      expect(use.exportHandlerId).not.toBeNull();
      expect(use.deleteHandlerId).not.toBeNull();
      expect(use.verificationHandlerId).not.toBeNull();
    }
    const identityClass = registry.dataClasses.find(
      (entry) => entry.id === "core:source_external_identity"
    );
    expect(identityClass?.definition.allowedExpiryActions).toContain(
      "remove_identity_resolution_keep_subjectless_fact"
    );
    expect(identityClass?.definition.subjectLinkBehavior).toBe(
      "direct_structured"
    );
  });

  it("fails closed when export, delete or absence verification coverage is missing", () => {
    const withoutExport = {
      ...INBOX_V2_SOURCE_IDENTITY_RESOLUTION_HANDLER_REGISTRATION,
      payload: {
        ...INBOX_V2_SOURCE_IDENTITY_RESOLUTION_HANDLER_REGISTRATION.payload,
        entries:
          INBOX_V2_SOURCE_IDENTITY_RESOLUTION_HANDLER_REGISTRATION.payload.entries.filter(
            (entry) => entry.definition.kind !== "export_execution"
          )
      }
    };
    expect(() =>
      defineInboxV2DataLifecycleRegistry({
        coreStorageRootRegistrations: [
          INBOX_V2_SOURCE_IDENTITY_RESOLUTION_STORAGE_ROOT_REGISTRATION
        ],
        coreLifecycleHandlerRegistrations: [withoutExport],
        coreDataUseRegistrations: [
          INBOX_V2_SOURCE_IDENTITY_RESOLUTION_DATA_USE_REGISTRATION
        ]
      })
    ).toThrow(/Unknown Inbox V2 lifecycle handler/u);

    const withoutDelete = {
      ...INBOX_V2_SOURCE_IDENTITY_RESOLUTION_DATA_USE_REGISTRATION,
      payload: {
        dataUses:
          INBOX_V2_SOURCE_IDENTITY_RESOLUTION_DATA_USE_REGISTRATION.payload.dataUses.map(
            (use) => ({ ...use, deleteHandlerId: null })
          )
      }
    };
    expect(() =>
      defineInboxV2DataLifecycleRegistry({
        coreStorageRootRegistrations: [
          INBOX_V2_SOURCE_IDENTITY_RESOLUTION_STORAGE_ROOT_REGISTRATION
        ],
        coreLifecycleHandlerRegistrations: [
          INBOX_V2_SOURCE_IDENTITY_RESOLUTION_HANDLER_REGISTRATION
        ],
        coreDataUseRegistrations: [withoutDelete]
      })
    ).toThrow(/Delete operation and delete handler must be declared together/u);

    const nonVerifyingHandlers = {
      ...INBOX_V2_SOURCE_IDENTITY_RESOLUTION_HANDLER_REGISTRATION,
      payload: {
        ...INBOX_V2_SOURCE_IDENTITY_RESOLUTION_HANDLER_REGISTRATION.payload,
        entries:
          INBOX_V2_SOURCE_IDENTITY_RESOLUTION_HANDLER_REGISTRATION.payload.entries.map(
            (entry) =>
              entry.definition.kind === "verification"
                ? {
                    ...entry,
                    definition: {
                      ...entry.definition,
                      verifiesAbsence: false
                    }
                  }
                : entry
          )
      }
    };
    expect(() =>
      defineInboxV2DataLifecycleRegistry({
        coreStorageRootRegistrations: [
          INBOX_V2_SOURCE_IDENTITY_RESOLUTION_STORAGE_ROOT_REGISTRATION
        ],
        coreLifecycleHandlerRegistrations: [nonVerifyingHandlers],
        coreDataUseRegistrations: [
          INBOX_V2_SOURCE_IDENTITY_RESOLUTION_DATA_USE_REGISTRATION
        ]
      })
    ).toThrow(/does not verify absence/u);
  });

  it("builds one bounded tenant-and-identity absence check for every root", () => {
    const query = renderQuery(
      buildVerifyInboxV2SourceIdentityResolutionAbsenceSql({
        tenantId,
        sourceExternalIdentityId: identityId
      })
    );
    expect(query.sql).toContain("public.inbox_v2_source_identity_observations");
    expect(query.sql).toContain("public.inbox_v2_source_identity_assessments");
    expect(query.sql).toContain(
      "public.inbox_v2_source_identity_assessment_heads"
    );
    expect(query.sql.match(/not exists/gu)).toHaveLength(3);
    expect(query.sql.match(/tenant_id =/gu)).toHaveLength(3);
    expect(query.sql.match(/source_external_identity_id =/gu)).toHaveLength(3);
    expect(query.sql).not.toMatch(/count\s*\(/iu);
    expect(query.params).toEqual([
      tenantId,
      identityId,
      tenantId,
      identityId,
      tenantId,
      identityId
    ]);
  });

  it("projects only a subjectless retained fact before DB-009 removes linked roots", () => {
    const projection =
      projectInboxV2SourceIdentityResolutionSubjectlessLifecycleFact(
        persistedAssessment()
      );
    expect(projection).toMatchObject({
      schemaVersion: "v1",
      action: "remove_identity_resolution_keep_subjectless_fact",
      assessmentVersion: "7",
      evidenceCount: 1,
      candidateCount: 1
    });
    const serialized = JSON.stringify(projection);
    for (const forbidden of [
      "Provider-Clear-Subject",
      "materialization-secret-token",
      tenantId,
      identityId,
      "normalized_inbound_event:src004-sensitive",
      "source_identity_claim:src004-sensitive",
      "employee:src004-sensitive"
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(serialized).toContain(`sha256:${"a".repeat(64)}`);
    expect(serialized).toContain(`sha256:${"b".repeat(64)}`);
  });
});

function persistedAssessment(): PersistedInboxV2SourceIdentityAssessment {
  return {
    clearProviderSubject: "Provider-Clear-Subject",
    materializationAuthorizationToken: "materialization-secret-token",
    tenantId,
    assessmentId: "source_identity_assessment:src004-sensitive",
    sourceExternalIdentityId: identityId,
    normalizedEventId: "normalized_inbound_event:src004-sensitive",
    observationKey: "src004-sensitive",
    safeEnvelopeHmacSha256: `hmac-sha256:${"c".repeat(64)}`,
    previousAssessmentVersion: "6",
    assessmentVersion: "7",
    outcome: "claimed_employee",
    confidence: "verified",
    evidence: [
      {
        ordinal: 0,
        reference: {
          kind: "normalized_inbound_event",
          reference: {
            tenantId,
            kind: "normalized_inbound_event",
            id: "normalized_inbound_event:src004-sensitive"
          }
        },
        confidence: "verified",
        provenance: {
          kind: "manual_review",
          actorEmployee: {
            tenantId,
            kind: "employee",
            id: "employee:src004-sensitive"
          },
          authorizationDecisionId: "authorization_decision:src004-sensitive"
        },
        observedAt: "2026-07-17T08:00:00.000Z"
      }
    ],
    candidates: [
      {
        ordinal: 0,
        target: {
          kind: "employee",
          employee: {
            tenantId,
            kind: "employee",
            id: "employee:src004-sensitive"
          }
        },
        confidence: "verified",
        evidenceOrdinals: [0]
      }
    ],
    sourceExternalIdentityFact: {
      schemaId:
        "core:inbox-v2.source-identity-materialization-subjectless-fact",
      schemaVersion: "v1",
      materializationDigestSha256: `sha256:${"a".repeat(64)}`,
      identityRevision: "3",
      resolutionStatus: "claimed",
      latestClaimVersion: "2",
      materializedAt: "2026-07-17T08:00:00.000Z",
      identityUpdatedAt: "2026-07-17T08:05:00.000Z"
    },
    assessment: {
      outcome: "resolved_employee",
      confidence: "verified",
      reason: "manual_confirmation",
      employee: {
        tenantId,
        kind: "employee",
        id: "employee:src004-sensitive"
      },
      claim: {
        tenantId,
        kind: "source_identity_claim",
        id: "source_identity_claim:src004-sensitive"
      },
      claimVersion: "2",
      evidenceOrdinals: [0],
      candidateOrdinal: 0,
      assessedAt: "2026-07-17T08:05:00.000Z"
    },
    assessmentDigestSha256: `sha256:${"b".repeat(64)}`,
    idempotencyKey: `source:v2:identity-resolution:${"d".repeat(64)}`,
    claim: {
      kind: "employee",
      claimId: "source_identity_claim:src004-sensitive",
      claimVersion: "2",
      employeeId: "employee:src004-sensitive"
    },
    assessedAt: "2026-07-17T08:05:00.000Z"
  } as unknown as PersistedInboxV2SourceIdentityAssessment & {
    clearProviderSubject?: "Provider-Clear-Subject";
    materializationAuthorizationToken?: "materialization-secret-token";
  };
}

function renderQuery(query: SQL): { sql: string; params: unknown[] } {
  const rendered = new PgDialect().sqlToQuery(query);
  return { sql: rendered.sql, params: rendered.params };
}
