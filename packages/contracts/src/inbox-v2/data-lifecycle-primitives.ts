import { z } from "zod";

import type { Brand } from "../brand";
import { inboxV2EntityRevisionSchema } from "./entity-metadata";
import { inboxV2NamespacedIdSchema } from "./namespace";

export const INBOX_V2_DATA_LIFECYCLE_SCHEMA_VERSION = "v1" as const;

export type InboxV2DataClassId = Brand<string, "InboxV2DataClassId">;
export type InboxV2ProcessingPurposeId = Brand<
  string,
  "InboxV2ProcessingPurposeId"
>;
export type InboxV2StorageRootId = Brand<string, "InboxV2StorageRootId">;
export type InboxV2RetentionAnchorId = Brand<
  string,
  "InboxV2RetentionAnchorId"
>;
export type InboxV2LifecycleHandlerId = Brand<
  string,
  "InboxV2LifecycleHandlerId"
>;
export type InboxV2GovernanceProfileId = Brand<
  string,
  "InboxV2GovernanceProfileId"
>;
export type InboxV2RetentionRuleId = Brand<string, "InboxV2RetentionRuleId">;
export type InboxV2RetentionEndConditionId = Brand<
  string,
  "InboxV2RetentionEndConditionId"
>;
export type InboxV2ExternalRouteId = Brand<string, "InboxV2ExternalRouteId">;

function brandedNamespacedIdSchema<TBrand extends string>() {
  return inboxV2NamespacedIdSchema.transform(
    (value) => value as unknown as Brand<string, TBrand>
  );
}

export const inboxV2DataClassIdSchema =
  brandedNamespacedIdSchema<"InboxV2DataClassId">();
export const inboxV2ProcessingPurposeIdSchema =
  brandedNamespacedIdSchema<"InboxV2ProcessingPurposeId">();
export const inboxV2StorageRootIdSchema =
  brandedNamespacedIdSchema<"InboxV2StorageRootId">();
export const inboxV2RetentionAnchorIdSchema =
  brandedNamespacedIdSchema<"InboxV2RetentionAnchorId">();
export const inboxV2LifecycleHandlerIdSchema =
  brandedNamespacedIdSchema<"InboxV2LifecycleHandlerId">();
export const inboxV2GovernanceProfileIdSchema =
  brandedNamespacedIdSchema<"InboxV2GovernanceProfileId">();
export const inboxV2RetentionRuleIdSchema =
  brandedNamespacedIdSchema<"InboxV2RetentionRuleId">();
export const inboxV2RetentionEndConditionIdSchema =
  brandedNamespacedIdSchema<"InboxV2RetentionEndConditionId">();
export const inboxV2ExternalRouteIdSchema =
  brandedNamespacedIdSchema<"InboxV2ExternalRouteId">();

export const inboxV2DeploymentProfileSchema = z.enum([
  "saas_shared",
  "saas_isolated",
  "on_prem"
]);

export const inboxV2DataSensitivitySchema = z.enum([
  "secret",
  "restricted_content",
  "sensitive_personal",
  "personal_identifier",
  "personal_operational",
  "security_evidence",
  "non_personal_aggregate"
]);

/**
 * Physical/remote storage surfaces are closed so a new persistence technology
 * cannot silently bypass lineage, retention, export or deletion registration.
 */
export const inboxV2StorageRootKindSchema = z.enum([
  "sql",
  "json_blob",
  "object",
  "index_cache",
  "log_trace",
  "backup",
  "external_route"
]);

export const inboxV2SubjectLinkBehaviorSchema = z.enum([
  "none",
  "direct_structured",
  "inherits_from_parent",
  "discovery_candidates"
]);

export const inboxV2DataOperationSchema = z.enum([
  "read",
  "persist",
  "derive",
  "export",
  "delete",
  "verify_absence",
  "transmit_external"
]);

export const inboxV2LifecycleHandlerKindSchema = z.enum([
  "anchor_resolution",
  "condition_resolution",
  "scope_matcher",
  "lifecycle",
  "subject_discovery",
  "export_projection",
  "export_execution",
  "delete_execution",
  "verification",
  "external_deletion",
  "migration_uninstall"
]);

/** Persisted expiry actions only. A legal hold is an evaluator outcome. */
export const inboxV2LifecycleActionSchema = z.enum([
  "hard_delete",
  "purge_content_keep_tombstone",
  "remove_identity_resolution_keep_subjectless_fact",
  "pseudonymize",
  "anonymize_and_reaggregate",
  "compact_to_safe_skeleton",
  "external_delete_request_then_track"
]);

export const inboxV2DataExportBehaviorSchema = z.enum([
  "never",
  "omit_with_reason",
  "normalized_projection",
  "authorized_projection",
  "tenant_manifest",
  "reviewed_sensitive_evidence",
  "anonymous_only"
]);

export const inboxV2ParentRetentionBehaviorSchema = z.enum([
  "independent",
  "inherits_all_live_parents"
]);

export const inboxV2VersionedProfileReferenceSchema = z
  .object({
    id: inboxV2GovernanceProfileIdSchema,
    version: inboxV2EntityRevisionSchema
  })
  .strict();

const inboxV2ElapsedRetentionPeriodSchema = z
  .object({
    kind: z.literal("elapsed"),
    seconds: z.number().int().positive().max(3_155_760_000)
  })
  .strict();

const inboxV2CalendarRetentionPeriodSchema = z
  .object({
    kind: z.literal("calendar"),
    years: z.number().int().min(0).max(100),
    months: z.number().int().min(0).max(1_200),
    days: z.number().int().min(0).max(36_600)
  })
  .strict()
  .superRefine((period, context) => {
    if (period.years + period.months + period.days === 0) {
      context.addIssue({
        code: "custom",
        message: "Calendar retention period must be positive."
      });
    }
  });

const inboxV2BusinessDaysRetentionPeriodSchema = z
  .object({
    kind: z.literal("business_days"),
    days: z.number().int().positive().max(36_600),
    calendar: inboxV2VersionedProfileReferenceSchema
  })
  .strict();

export const inboxV2RetentionPeriodSchema = z.discriminatedUnion("kind", [
  inboxV2ElapsedRetentionPeriodSchema,
  inboxV2CalendarRetentionPeriodSchema,
  inboxV2BusinessDaysRetentionPeriodSchema
]);

export const inboxV2RetentionEndConditionSchema = z
  .object({
    id: inboxV2RetentionEndConditionIdSchema,
    version: inboxV2EntityRevisionSchema,
    resolverHandlerId: inboxV2LifecycleHandlerIdSchema
  })
  .strict();

export const inboxV2RetentionWindowSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("fixed_after_anchor"),
      period: inboxV2RetentionPeriodSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("until_condition_then_period"),
      condition: inboxV2RetentionEndConditionSchema,
      period: inboxV2RetentionPeriodSchema,
      reviewPeriod: inboxV2RetentionPeriodSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("inherits_all_live_parents"),
      maximumAdditionalPeriod: inboxV2RetentionPeriodSchema.nullable()
    })
    .strict()
]);

export const inboxV2CanonicalAnchorSourceSchema = z.enum([
  "server_timestamp",
  "tenant_stream_position"
]);

export const inboxV2CanonicalAnchorDefinitionSchema = z
  .object({
    source: inboxV2CanonicalAnchorSourceSchema,
    resolverHandlerId: inboxV2LifecycleHandlerIdSchema
  })
  .strict();

export type InboxV2DeploymentProfile = z.infer<
  typeof inboxV2DeploymentProfileSchema
>;
export type InboxV2DataSensitivity = z.infer<
  typeof inboxV2DataSensitivitySchema
>;
export type InboxV2StorageRootKind = z.infer<
  typeof inboxV2StorageRootKindSchema
>;
export type InboxV2SubjectLinkBehavior = z.infer<
  typeof inboxV2SubjectLinkBehaviorSchema
>;
export type InboxV2DataOperation = z.infer<typeof inboxV2DataOperationSchema>;
export type InboxV2LifecycleHandlerKind = z.infer<
  typeof inboxV2LifecycleHandlerKindSchema
>;
export type InboxV2LifecycleAction = z.infer<
  typeof inboxV2LifecycleActionSchema
>;
export type InboxV2DataExportBehavior = z.infer<
  typeof inboxV2DataExportBehaviorSchema
>;
export type InboxV2ParentRetentionBehavior = z.infer<
  typeof inboxV2ParentRetentionBehaviorSchema
>;
export type InboxV2RetentionPeriod = z.infer<
  typeof inboxV2RetentionPeriodSchema
>;
export type InboxV2RetentionEndCondition = z.infer<
  typeof inboxV2RetentionEndConditionSchema
>;
export type InboxV2RetentionWindow = z.infer<
  typeof inboxV2RetentionWindowSchema
>;
export type InboxV2VersionedProfileReference = z.infer<
  typeof inboxV2VersionedProfileReferenceSchema
>;
export type InboxV2CanonicalAnchorDefinition = z.infer<
  typeof inboxV2CanonicalAnchorDefinitionSchema
>;
