import {
  defineInboxV2DataLifecycleRegistry,
  inboxV2CoreDataUseRegistrationSchema,
  inboxV2CoreLifecycleHandlerCatalogRegistrationSchema,
  inboxV2CoreStorageRootCatalogRegistrationSchema,
  inboxV2SourceExternalIdentityIdSchema,
  inboxV2TenantIdSchema,
  type InboxV2DataLifecycleRegistry,
  type InboxV2SourceExternalIdentityId,
  type InboxV2TenantId
} from "@hulee/contracts";
import { sql, type SQL } from "drizzle-orm";

import type { PersistedInboxV2SourceIdentityAssessment } from "./sql-inbox-v2-source-identity-resolution-repository";

export const INBOX_V2_SOURCE_IDENTITY_RESOLUTION_STORAGE_ROOT_IDS =
  Object.freeze([
    "core:source-identity-resolution-observations-sql",
    "core:source-identity-resolution-assessments-sql",
    "core:source-identity-resolution-heads-sql"
  ] as const);

const LIFECYCLE_HANDLER_ID = "core:source-identity-resolution-db009-lifecycle";
const SUBJECT_DISCOVERY_HANDLER_ID =
  "core:source-identity-resolution-db009-subject-discovery";
const EXPORT_PROJECTION_HANDLER_ID =
  "core:source-identity-resolution-db009-export-projection";
const EXPORT_HANDLER_ID = "core:source-identity-resolution-db009-export";
const DELETE_HANDLER_ID = "core:source-identity-resolution-db009-delete";
const VERIFICATION_HANDLER_ID =
  "core:source-identity-resolution-db009-verification";

export const INBOX_V2_SOURCE_IDENTITY_RESOLUTION_STORAGE_ROOT_REGISTRATION =
  inboxV2CoreStorageRootCatalogRegistrationSchema.parse({
    schemaId: "core:inbox-v2.catalog-registration",
    schemaVersion: "v1",
    payload: {
      catalog: "storage-root",
      owner: { kind: "core" },
      entries: INBOX_V2_SOURCE_IDENTITY_RESOLUTION_STORAGE_ROOT_IDS.map(
        (id) => ({
          id,
          definition: {
            kind: "sql",
            boundary: "operated_data_plane",
            tenantIsolation: "required",
            versionEnumeration: "not_applicable",
            configurationProfileId: "core:storage-profile.sql"
          }
        })
      )
    }
  });

const handler = (
  kind:
    | "lifecycle"
    | "subject_discovery"
    | "export_projection"
    | "export_execution"
    | "delete_execution"
    | "verification",
  supportedOperations: readonly (
    | "read"
    | "persist"
    | "export"
    | "delete"
    | "verify_absence"
  )[],
  verifiesAbsence = false
) => ({
  kind,
  supportedRootKinds: ["sql" as const],
  supportedOperations: [...supportedOperations],
  bounded: true as const,
  idempotent: true as const,
  checksTenantFence: true as const,
  checksRevisionFence: true as const,
  checksHoldFence: true,
  verifiesAbsence
});

export const INBOX_V2_SOURCE_IDENTITY_RESOLUTION_HANDLER_REGISTRATION =
  inboxV2CoreLifecycleHandlerCatalogRegistrationSchema.parse({
    schemaId: "core:inbox-v2.catalog-registration",
    schemaVersion: "v1",
    payload: {
      catalog: "lifecycle-handler",
      owner: { kind: "core" },
      entries: [
        {
          id: LIFECYCLE_HANDLER_ID,
          definition: handler("lifecycle", [
            "persist",
            "export",
            "delete",
            "verify_absence"
          ])
        },
        {
          id: SUBJECT_DISCOVERY_HANDLER_ID,
          definition: handler("subject_discovery", ["read"])
        },
        {
          id: EXPORT_PROJECTION_HANDLER_ID,
          definition: handler("export_projection", ["export"])
        },
        {
          id: EXPORT_HANDLER_ID,
          definition: handler("export_execution", ["export"])
        },
        {
          id: DELETE_HANDLER_ID,
          definition: handler("delete_execution", ["delete"])
        },
        {
          id: VERIFICATION_HANDLER_ID,
          definition: handler("verification", ["verify_absence"], true)
        }
      ]
    }
  });

export const INBOX_V2_SOURCE_IDENTITY_RESOLUTION_DATA_USE_REGISTRATION =
  inboxV2CoreDataUseRegistrationSchema.parse({
    schemaId: "core:inbox-v2.core-data-use-registration",
    schemaVersion: "v1",
    payload: {
      dataUses: INBOX_V2_SOURCE_IDENTITY_RESOLUTION_STORAGE_ROOT_IDS.map(
        (storageRootId) => ({
          dataClassId: "core:source_external_identity",
          storageRootId,
          purposeIds: [
            "core:communication_delivery",
            "core:crm_relationship",
            "core:data_subject_request_execution"
          ],
          operations: ["persist", "export", "delete", "verify_absence"],
          canonicalAnchorId: "core:unlink_or_relationship_end",
          lifecycleHandlerId: LIFECYCLE_HANDLER_ID,
          subjectDiscoveryHandlerId: SUBJECT_DISCOVERY_HANDLER_ID,
          exportProjectionHandlerId: EXPORT_PROJECTION_HANDLER_ID,
          exportHandlerId: EXPORT_HANDLER_ID,
          deleteHandlerId: DELETE_HANDLER_ID,
          verificationHandlerId: VERIFICATION_HANDLER_ID
        })
      )
    }
  });

/**
 * Composes the exact DB-009 registry fragment owned by SRC-004. Runtime
 * activation remains a DB-009 responsibility and therefore fails closed if a
 * root or one of its executable handler declarations is missing.
 */
export function defineInboxV2SourceIdentityResolutionLifecycleRegistry(): InboxV2DataLifecycleRegistry {
  return defineInboxV2DataLifecycleRegistry({
    coreStorageRootRegistrations: [
      INBOX_V2_SOURCE_IDENTITY_RESOLUTION_STORAGE_ROOT_REGISTRATION
    ],
    coreLifecycleHandlerRegistrations: [
      INBOX_V2_SOURCE_IDENTITY_RESOLUTION_HANDLER_REGISTRATION
    ],
    coreDataUseRegistrations: [
      INBOX_V2_SOURCE_IDENTITY_RESOLUTION_DATA_USE_REGISTRATION
    ]
  });
}

export type InboxV2SourceIdentityResolutionSubjectlessLifecycleFact = Readonly<{
  schemaId: "core:inbox-v2.source-identity-resolution-subjectless-lifecycle-fact";
  schemaVersion: "v1";
  action: "remove_identity_resolution_keep_subjectless_fact";
  materializationDigestSha256: string;
  assessmentDigestSha256: string;
  assessmentVersion: string;
  outcome: PersistedInboxV2SourceIdentityAssessment["outcome"];
  confidence: PersistedInboxV2SourceIdentityAssessment["confidence"];
  evidenceCount: number;
  candidateCount: number;
  assessedAt: string;
  redactedFields: readonly string[];
}>;

/**
 * Projection handed to DB-009 before the subject-linked roots are removed.
 * It deliberately contains no tenant, identity, event, claim or target key.
 */
export function projectInboxV2SourceIdentityResolutionSubjectlessLifecycleFact(
  assessment: PersistedInboxV2SourceIdentityAssessment
): InboxV2SourceIdentityResolutionSubjectlessLifecycleFact {
  return Object.freeze({
    schemaId:
      "core:inbox-v2.source-identity-resolution-subjectless-lifecycle-fact",
    schemaVersion: "v1",
    action: "remove_identity_resolution_keep_subjectless_fact",
    materializationDigestSha256:
      assessment.sourceExternalIdentityFact.materializationDigestSha256,
    assessmentDigestSha256: assessment.assessmentDigestSha256,
    assessmentVersion: assessment.assessmentVersion,
    outcome: assessment.outcome,
    confidence: assessment.confidence,
    evidenceCount: assessment.evidence.length,
    candidateCount: assessment.candidates.length,
    assessedAt: assessment.assessedAt,
    redactedFields: Object.freeze([
      "canonical_external_subject",
      "materialization_authorization_token",
      "source_external_identity_id",
      "normalized_event_binding",
      "claim_and_candidate_targets"
    ])
  });
}

/** Bounded post-delete verification for the three subject-linked SQL roots. */
export function buildVerifyInboxV2SourceIdentityResolutionAbsenceSql(input: {
  tenantId: InboxV2TenantId;
  sourceExternalIdentityId: InboxV2SourceExternalIdentityId;
}): SQL {
  const tenantId = inboxV2TenantIdSchema.parse(input.tenantId);
  const sourceExternalIdentityId = inboxV2SourceExternalIdentityIdSchema.parse(
    input.sourceExternalIdentityId
  );
  return sql`
    select (
      not exists (
        select 1
          from public.inbox_v2_source_identity_observations observation
         where observation.tenant_id = ${tenantId}
           and observation.source_external_identity_id = ${sourceExternalIdentityId}
      )
      and not exists (
        select 1
          from public.inbox_v2_source_identity_assessments assessment
         where assessment.tenant_id = ${tenantId}
           and assessment.source_external_identity_id = ${sourceExternalIdentityId}
      )
      and not exists (
        select 1
          from public.inbox_v2_source_identity_assessment_heads head
         where head.tenant_id = ${tenantId}
           and head.source_external_identity_id = ${sourceExternalIdentityId}
      )
    ) as absent
  `;
}
