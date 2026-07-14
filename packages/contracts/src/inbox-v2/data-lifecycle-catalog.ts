import { z } from "zod";

import {
  createInboxV2CoreCatalogRegistrationSchema,
  defineInboxV2CatalogRegistrations,
  type InboxV2DeepReadonly
} from "./catalog";
import {
  inboxV2CanonicalAnchorDefinitionSchema,
  inboxV2DataClassIdSchema,
  inboxV2DataExportBehaviorSchema,
  inboxV2DataOperationSchema,
  inboxV2DataSensitivitySchema,
  inboxV2ExternalRouteIdSchema,
  inboxV2GovernanceProfileIdSchema,
  inboxV2LifecycleActionSchema,
  inboxV2LifecycleHandlerIdSchema,
  inboxV2LifecycleHandlerKindSchema,
  inboxV2ParentRetentionBehaviorSchema,
  inboxV2ProcessingPurposeIdSchema,
  inboxV2RetentionAnchorIdSchema,
  inboxV2RetentionPeriodSchema,
  inboxV2RetentionRuleIdSchema,
  inboxV2RetentionWindowSchema,
  inboxV2StorageRootIdSchema,
  inboxV2StorageRootKindSchema,
  inboxV2SubjectLinkBehaviorSchema,
  inboxV2VersionedProfileReferenceSchema
} from "./data-lifecycle-primitives";
import { inboxV2EntityRevisionSchema } from "./entity-metadata";
import { inboxV2ModuleIdSchema, parseInboxV2NamespacedId } from "./namespace";
import { calculateInboxV2CanonicalSha256 } from "./recipient-sync-hash";
import {
  createInboxV2SchemaEnvelopeSchema,
  INBOX_V2_INITIAL_SCHEMA_VERSION
} from "./schema-version";
import type { InboxV2Sha256Digest } from "./sync-primitives";

export const INBOX_V2_MODULE_DATA_GOVERNANCE_SCHEMA_ID =
  "core:inbox-v2.module-data-governance" as const;
export const INBOX_V2_CORE_DATA_USE_REGISTRATION_SCHEMA_ID =
  "core:inbox-v2.core-data-use-registration" as const;

const nonEmptyUniqueNamespacedIds = <TSchema extends z.ZodType>(
  schema: TSchema,
  label: string
) =>
  z
    .array(schema)
    .min(1)
    .max(1_000)
    .superRefine((values, context) => {
      const seen = new Set<string>();
      for (const [index, value] of values.entries()) {
        const key = String(value);
        if (seen.has(key)) {
          context.addIssue({
            code: "custom",
            path: [index],
            message: `Duplicate ${label}: ${key}.`
          });
        }
        seen.add(key);
      }
    });

export const inboxV2ProcessingPurposeDefinitionSchema = z
  .object({
    responsibilityRoleRequired: z.boolean(),
    subjectDiscoveryRequired: z.boolean(),
    parentCorePurposeId: inboxV2ProcessingPurposeIdSchema.nullable()
  })
  .strict();

const inboxV2RetentionRuleReferenceSchema = z
  .object({
    id: inboxV2RetentionRuleIdSchema,
    revision: inboxV2EntityRevisionSchema
  })
  .strict();

export const inboxV2ModuleRetentionRuleDeclarationSchema = z
  .object({
    id: inboxV2RetentionRuleIdSchema,
    definition: z
      .object({
        revision: inboxV2EntityRevisionSchema,
        dataClassId: inboxV2DataClassIdSchema,
        purposeId: inboxV2ProcessingPurposeIdSchema,
        retentionAnchorId: inboxV2RetentionAnchorIdSchema,
        baselineWindow: inboxV2RetentionWindowSchema,
        actionAtExpiry: inboxV2LifecycleActionSchema,
        backupMaximum: inboxV2RetentionPeriodSchema,
        holdEligible: z.boolean(),
        lifecycleHandlerId: inboxV2LifecycleHandlerIdSchema,
        deleteHandlerId: inboxV2LifecycleHandlerIdSchema,
        verificationHandlerId: inboxV2LifecycleHandlerIdSchema
      })
      .strict()
  })
  .strict();

export const inboxV2LifecycleHandlerDefinitionSchema = z
  .object({
    kind: inboxV2LifecycleHandlerKindSchema,
    supportedRootKinds: z
      .array(inboxV2StorageRootKindSchema)
      .min(1)
      .max(7)
      .superRefine((values, context) => addDuplicateIssues(values, context)),
    supportedOperations: z
      .array(inboxV2DataOperationSchema)
      .min(1)
      .max(7)
      .superRefine((values, context) => addDuplicateIssues(values, context)),
    bounded: z.literal(true),
    idempotent: z.literal(true),
    checksTenantFence: z.literal(true),
    checksRevisionFence: z.literal(true),
    checksHoldFence: z.boolean(),
    verifiesAbsence: z.boolean()
  })
  .strict();

export const inboxV2StorageRootDefinitionSchema = z
  .object({
    kind: inboxV2StorageRootKindSchema,
    boundary: z.enum(["operated_data_plane", "outside_operated_data_plane"]),
    tenantIsolation: z.literal("required"),
    versionEnumeration: z.enum([
      "not_applicable",
      "supported",
      "expiry_ledger"
    ]),
    configurationProfileId: inboxV2GovernanceProfileIdSchema
  })
  .strict()
  .superRefine((root, context) => {
    const external = root.kind === "external_route";
    if (external !== (root.boundary === "outside_operated_data_plane")) {
      context.addIssue({
        code: "custom",
        path: ["boundary"],
        message:
          "Only external_route roots are outside the operated data plane."
      });
    }
    if (root.kind === "backup" && root.versionEnumeration !== "expiry_ledger") {
      context.addIssue({
        code: "custom",
        path: ["versionEnumeration"],
        message: "Backup roots require a bounded expiry ledger."
      });
    }
    if (root.kind === "object" && root.versionEnumeration !== "supported") {
      context.addIssue({
        code: "custom",
        path: ["versionEnumeration"],
        message: "Object roots must enumerate and delete all object versions."
      });
    }
  });

const inboxV2DataClassRetentionRequirementSchema = z.discriminatedUnion(
  "kind",
  [
    z
      .object({
        kind: z.literal("fixed_after_anchor"),
        period: inboxV2RetentionPeriodSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("inherits_all_live_parents"),
        maximumAdditionalPeriod: inboxV2RetentionPeriodSchema.nullable()
      })
      .strict(),
    z
      .object({
        kind: z.literal("declared_rule_set"),
        ruleRefs: z
          .array(inboxV2RetentionRuleReferenceSchema)
          .min(1)
          .max(1_000)
          .superRefine((values, context) =>
            addCanonicalRuleReferenceIssues(values, context)
          )
      })
      .strict(),
    z.object({ kind: z.literal("profile_required") }).strict()
  ]
);

export const inboxV2DataClassDefinitionSchema = z
  .object({
    sensitivity: inboxV2DataSensitivitySchema,
    allowedPurposeIds: nonEmptyUniqueNamespacedIds(
      inboxV2ProcessingPurposeIdSchema,
      "processing purpose"
    ),
    canonicalAnchorId: inboxV2RetentionAnchorIdSchema,
    retentionRequirement: inboxV2DataClassRetentionRequirementSchema,
    allowedExpiryActions: z
      .array(inboxV2LifecycleActionSchema)
      .min(1)
      .max(7)
      .superRefine((values, context) => addDuplicateIssues(values, context)),
    immediateTerminalPurge: z.boolean(),
    parentBehavior: inboxV2ParentRetentionBehaviorSchema,
    subjectLinkBehavior: inboxV2SubjectLinkBehaviorSchema,
    exportBehavior: inboxV2DataExportBehaviorSchema,
    holdEligible: z.boolean()
  })
  .strict()
  .superRefine((definition, context) => {
    if (
      definition.retentionRequirement.kind !== "declared_rule_set" &&
      (definition.parentBehavior === "inherits_all_live_parents") !==
        (definition.retentionRequirement.kind === "inherits_all_live_parents")
    ) {
      context.addIssue({
        code: "custom",
        path: ["parentBehavior"],
        message: "Parent behavior and retention requirement must agree exactly."
      });
    }
    if (definition.sensitivity === "secret") {
      if (definition.holdEligible) {
        context.addIssue({
          code: "custom",
          path: ["holdEligible"],
          message: "Secrets are never eligible for legal hold."
        });
      }
      if (definition.exportBehavior !== "never") {
        context.addIssue({
          code: "custom",
          path: ["exportBehavior"],
          message: "Secrets are never export eligible."
        });
      }
      if (
        definition.allowedExpiryActions.length !== 1 ||
        definition.allowedExpiryActions[0] !== "hard_delete"
      ) {
        context.addIssue({
          code: "custom",
          path: ["allowedExpiryActions"],
          message: "Secrets require hard_delete as their only expiry action."
        });
      }
    }
  });

export const inboxV2CoreDataClassCatalogRegistrationSchema =
  createInboxV2CoreCatalogRegistrationSchema({
    catalog: "data-class",
    definitionSchema: inboxV2DataClassDefinitionSchema
  });

export const inboxV2CoreProcessingPurposeCatalogRegistrationSchema =
  createInboxV2CoreCatalogRegistrationSchema({
    catalog: "processing-purpose",
    definitionSchema: inboxV2ProcessingPurposeDefinitionSchema
  });

export const inboxV2CoreRetentionAnchorCatalogRegistrationSchema =
  createInboxV2CoreCatalogRegistrationSchema({
    catalog: "retention-anchor",
    definitionSchema: inboxV2CanonicalAnchorDefinitionSchema
  });

export const inboxV2CoreStorageRootCatalogRegistrationSchema =
  createInboxV2CoreCatalogRegistrationSchema({
    catalog: "storage-root",
    definitionSchema: inboxV2StorageRootDefinitionSchema
  });

export const inboxV2CoreLifecycleHandlerCatalogRegistrationSchema =
  createInboxV2CoreCatalogRegistrationSchema({
    catalog: "lifecycle-handler",
    definitionSchema: inboxV2LifecycleHandlerDefinitionSchema
  });

const inboxV2ModulePurposeDeclarationSchema = z
  .object({
    id: inboxV2ProcessingPurposeIdSchema,
    definition: inboxV2ProcessingPurposeDefinitionSchema
  })
  .strict();

const inboxV2ModuleAnchorDeclarationSchema = z
  .object({
    id: inboxV2RetentionAnchorIdSchema,
    definition: inboxV2CanonicalAnchorDefinitionSchema
  })
  .strict();

const inboxV2ModuleHandlerDeclarationSchema = z
  .object({
    id: inboxV2LifecycleHandlerIdSchema,
    definition: inboxV2LifecycleHandlerDefinitionSchema
  })
  .strict();

const inboxV2ModuleStorageRootDeclarationSchema = z
  .object({
    id: inboxV2StorageRootIdSchema,
    definition: inboxV2StorageRootDefinitionSchema
  })
  .strict();

export const inboxV2ModuleDataClassDeclarationSchema = z
  .object({
    id: inboxV2DataClassIdSchema,
    parentCoreClassId: inboxV2DataClassIdSchema,
    storageRootIds: nonEmptyUniqueNamespacedIds(
      inboxV2StorageRootIdSchema,
      "storage root"
    ),
    sensitivity: inboxV2DataSensitivitySchema,
    allowedPurposeIds: nonEmptyUniqueNamespacedIds(
      inboxV2ProcessingPurposeIdSchema,
      "processing purpose"
    ),
    parentBehavior: inboxV2ParentRetentionBehaviorSchema,
    canonicalAnchorId: inboxV2RetentionAnchorIdSchema.nullable(),
    retentionRuleRefs: z
      .array(inboxV2RetentionRuleReferenceSchema)
      .min(1)
      .max(1_000)
      .superRefine((values, context) =>
        addCanonicalRuleReferenceIssues(values, context)
      ),
    subjectLinkBehavior: inboxV2SubjectLinkBehaviorSchema,
    exportBehavior: inboxV2DataExportBehaviorSchema,
    holdEligible: z.boolean(),
    allowedExpiryActions: z
      .array(inboxV2LifecycleActionSchema)
      .min(1)
      .max(7)
      .superRefine((values, context) => addDuplicateIssues(values, context)),
    immediateTerminalPurge: z.boolean(),
    lifecycleHandlerId: inboxV2LifecycleHandlerIdSchema,
    subjectDiscoveryHandlerId: inboxV2LifecycleHandlerIdSchema.nullable(),
    exportProjectionHandlerId: inboxV2LifecycleHandlerIdSchema.nullable(),
    exportHandlerId: inboxV2LifecycleHandlerIdSchema.nullable(),
    deleteHandlerId: inboxV2LifecycleHandlerIdSchema,
    verificationHandlerId: inboxV2LifecycleHandlerIdSchema
  })
  .strict()
  .superRefine((declaration, context) => {
    if (declaration.parentBehavior === "independent") {
      if (declaration.canonicalAnchorId === null) {
        addIssue(
          context,
          ["canonicalAnchorId"],
          "Independent module data class requires a canonical anchor."
        );
      }
    } else if (declaration.canonicalAnchorId !== null) {
      addIssue(
        context,
        ["parentBehavior"],
        "Parent-inheriting module class cannot replace its parent anchor."
      );
    }
    if (
      (declaration.subjectLinkBehavior !== "none") !==
      (declaration.subjectDiscoveryHandlerId !== null)
    ) {
      addIssue(
        context,
        ["subjectDiscoveryHandlerId"],
        "Subject-bearing module classes require discovery handlers; subjectless classes forbid them."
      );
    }
    const exportable = declaration.exportBehavior !== "never";
    if (
      exportable !==
      (declaration.exportProjectionHandlerId !== null &&
        declaration.exportHandlerId !== null)
    ) {
      addIssue(
        context,
        ["exportHandlerId"],
        "Exportable classes require projection/execution handlers; non-exportable classes forbid them."
      );
    }
    if (
      declaration.sensitivity === "secret" &&
      (declaration.holdEligible ||
        exportable ||
        declaration.allowedExpiryActions.length !== 1 ||
        declaration.allowedExpiryActions[0] !== "hard_delete" ||
        !declaration.immediateTerminalPurge)
    ) {
      addIssue(
        context,
        ["sensitivity"],
        "Secrets are neither hold nor export eligible."
      );
    }
  });

export const inboxV2ModuleDataUseSchema = z
  .object({
    dataClassId: inboxV2DataClassIdSchema,
    storageRootId: inboxV2StorageRootIdSchema,
    purposeIds: nonEmptyUniqueNamespacedIds(
      inboxV2ProcessingPurposeIdSchema,
      "processing purpose"
    ),
    operations: z
      .array(inboxV2DataOperationSchema)
      .min(1)
      .max(7)
      .superRefine((values, context) => addDuplicateIssues(values, context)),
    canonicalAnchorId: inboxV2RetentionAnchorIdSchema,
    lifecycleHandlerId: inboxV2LifecycleHandlerIdSchema,
    subjectDiscoveryHandlerId: inboxV2LifecycleHandlerIdSchema.nullable(),
    exportProjectionHandlerId: inboxV2LifecycleHandlerIdSchema.nullable(),
    exportHandlerId: inboxV2LifecycleHandlerIdSchema.nullable(),
    deleteHandlerId: inboxV2LifecycleHandlerIdSchema.nullable(),
    verificationHandlerId: inboxV2LifecycleHandlerIdSchema.nullable()
  })
  .strict()
  .superRefine((use, context) => {
    const exportsData = use.operations.includes("export");
    if (
      exportsData !== (use.exportProjectionHandlerId !== null) ||
      exportsData !== (use.exportHandlerId !== null)
    ) {
      addIssue(
        context,
        ["exportHandlerId"],
        "Export operation, projection handler and execution handler must be declared together."
      );
    }
    if (use.operations.includes("delete") !== (use.deleteHandlerId !== null)) {
      addIssue(
        context,
        ["deleteHandlerId"],
        "Delete operation and delete handler must be declared together."
      );
    }
    if (
      use.operations.includes("verify_absence") !==
      (use.verificationHandlerId !== null)
    ) {
      addIssue(
        context,
        ["verificationHandlerId"],
        "Absence-verification operation and verification handler must be declared together."
      );
    }
  });

export const inboxV2CoreDataUseRegistrationSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_CORE_DATA_USE_REGISTRATION_SCHEMA_ID,
    INBOX_V2_INITIAL_SCHEMA_VERSION,
    z
      .object({
        dataUses: z.array(inboxV2ModuleDataUseSchema).min(1).max(100_000)
      })
      .strict()
  );

export const inboxV2ModuleExternalRouteSchema = z
  .object({
    id: inboxV2ExternalRouteIdSchema,
    storageRootId: inboxV2StorageRootIdSchema,
    dataClassIds: nonEmptyUniqueNamespacedIds(
      inboxV2DataClassIdSchema,
      "data class"
    ),
    purposeId: inboxV2ProcessingPurposeIdSchema,
    recipientCategoryId: inboxV2GovernanceProfileIdSchema,
    regionProfile: inboxV2VersionedProfileReferenceSchema,
    deleteCapabilityHandlerId: inboxV2LifecycleHandlerIdSchema
  })
  .strict();

const inboxV2ModuleDataGovernancePayloadSchema = z
  .object({
    moduleId: inboxV2ModuleIdSchema,
    dataHandling: z.literal("tenant_or_customer_data"),
    processingPurposes: z
      .array(inboxV2ModulePurposeDeclarationSchema)
      .max(1_000),
    retentionRules: z
      .array(inboxV2ModuleRetentionRuleDeclarationSchema)
      .max(10_000)
      .default([]),
    retentionAnchors: z.array(inboxV2ModuleAnchorDeclarationSchema).max(1_000),
    handlers: z.array(inboxV2ModuleHandlerDeclarationSchema).min(1).max(1_000),
    storageRoots: z
      .array(inboxV2ModuleStorageRootDeclarationSchema)
      .min(1)
      .max(1_000),
    dataClasses: z.array(inboxV2ModuleDataClassDeclarationSchema).max(1_000),
    dataUses: z.array(inboxV2ModuleDataUseSchema).min(1).max(10_000),
    externalRoutes: z.array(inboxV2ModuleExternalRouteSchema).max(1_000),
    migrationAndUninstallHandlerId: inboxV2LifecycleHandlerIdSchema
  })
  .strict()
  .superRefine((payload, context) => {
    for (const [field, values] of [
      ["processingPurposes", payload.processingPurposes],
      ["retentionRules", payload.retentionRules],
      ["retentionAnchors", payload.retentionAnchors],
      ["handlers", payload.handlers],
      ["storageRoots", payload.storageRoots],
      ["dataClasses", payload.dataClasses],
      ["externalRoutes", payload.externalRoutes]
    ] as const) {
      addDuplicateObjectIdIssues(values, context, [field]);
    }
  });

export const inboxV2ModuleDataGovernanceContributionSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_MODULE_DATA_GOVERNANCE_SCHEMA_ID,
    INBOX_V2_INITIAL_SCHEMA_VERSION,
    inboxV2ModuleDataGovernancePayloadSchema
  );

const PURPOSE = {
  delivery: "core:communication_delivery",
  service: "core:customer_service_history",
  work: "core:work_management",
  crm: "core:crm_relationship",
  replay: "core:source_replay_and_diagnostics",
  security: "core:security_and_fraud_prevention",
  billing: "core:contract_and_billing_evidence",
  legal: "core:legal_claim_or_regulatory_duty",
  notification: "core:product_notification",
  reporting: "core:manager_reporting",
  ai: "core:ai_or_transcription",
  privacy: "core:data_subject_request_execution"
} as const;

const CORE_PURPOSE_ROWS = [
  [PURPOSE.delivery, true, true],
  [PURPOSE.service, true, true],
  [PURPOSE.work, true, true],
  [PURPOSE.crm, true, true],
  [PURPOSE.replay, true, true],
  [PURPOSE.security, true, true],
  [PURPOSE.billing, true, true],
  [PURPOSE.legal, true, true],
  [PURPOSE.notification, true, true],
  [PURPOSE.reporting, true, true],
  [PURPOSE.ai, true, true],
  [PURPOSE.privacy, true, true]
] as const;

const corePurposeRegistration =
  inboxV2CoreProcessingPurposeCatalogRegistrationSchema.parse({
    schemaId: "core:inbox-v2.catalog-registration",
    schemaVersion: "v1",
    payload: {
      catalog: "processing-purpose",
      owner: { kind: "core" },
      entries: CORE_PURPOSE_ROWS.map(
        ([id, responsibilityRoleRequired, subjectDiscoveryRequired]) => ({
          id,
          definition: {
            responsibilityRoleRequired,
            subjectDiscoveryRequired,
            parentCorePurposeId: null
          }
        })
      )
    }
  });

export const INBOX_V2_CORE_PROCESSING_PURPOSE_CATALOG =
  defineInboxV2CatalogRegistrations([corePurposeRegistration])[0]!;

const CORE_ANCHOR_RESOLVER_HANDLER_ID =
  "core:data-lifecycle.canonical-anchor-resolver";
const CORE_ANCHOR_LOCAL_IDS = [
  "terminal_processing",
  "materialization_or_final_failure",
  "tenant_commit",
  "parent_commit",
  "terminal_outcome",
  "committed_stream_position",
  "canonical_item_commit",
  "canonical_item_time",
  "content_purge_or_revision",
  "account_replacement_or_relationship_end",
  "thread_relationship_end",
  "unbind_or_source_termination",
  "terminal_occurrence_or_resolution",
  "route_or_policy_replacement",
  "terminal_dispatch_or_artifact_outcome",
  "terminal_reconciliation_decision",
  "conversation_terminal_or_relationship_end",
  "work_item_terminal",
  "assignment_interval_close",
  "employee_conversation_relation_end",
  "membership_end",
  "unlink_or_relationship_end",
  "relationship_end",
  "relationship_or_case_end",
  "link_episode_or_relationship_end",
  "client_or_merge_relationship_end",
  "source_or_canonical_relationship_end",
  "all_parent_links_and_purposes_end",
  "source_or_last_required_use",
  "call_completion",
  "source_parent_or_last_required_use",
  "revoke_or_deactivation",
  "source_or_creation",
  "creation_or_terminal_outcome",
  "event_time",
  "source_fact_or_relationship_end",
  "rollup_window_close",
  "action_time",
  "signal_time",
  "case_completion_or_release",
  "final_external_outcome",
  "cancel_or_failure",
  "ready",
  "artifact_expiry_or_request_completion",
  "creation",
  "support_case_close",
  "revoke_expiry_or_completion",
  "disconnect_or_account_termination",
  "revoke_expiry_or_membership_end",
  "disable_delete_or_terminal_outcome",
  "billing_or_contract_period_close",
  "replacement_or_tenant_termination",
  "backup_or_version_creation",
  "completion_or_release"
] as const;

const coreAnchorRegistration =
  inboxV2CoreRetentionAnchorCatalogRegistrationSchema.parse({
    schemaId: "core:inbox-v2.catalog-registration",
    schemaVersion: "v1",
    payload: {
      catalog: "retention-anchor",
      owner: { kind: "core" },
      entries: CORE_ANCHOR_LOCAL_IDS.map((localId) => ({
        id: `core:${localId}`,
        definition: {
          source:
            localId === "committed_stream_position"
              ? "tenant_stream_position"
              : "server_timestamp",
          resolverHandlerId: CORE_ANCHOR_RESOLVER_HANDLER_ID
        }
      }))
    }
  });

export const INBOX_V2_CORE_RETENTION_ANCHOR_CATALOG =
  defineInboxV2CatalogRegistrations([coreAnchorRegistration])[0]!;

const coreAnchorHandlerRegistration =
  inboxV2CoreLifecycleHandlerCatalogRegistrationSchema.parse({
    schemaId: "core:inbox-v2.catalog-registration",
    schemaVersion: "v1",
    payload: {
      catalog: "lifecycle-handler",
      owner: { kind: "core" },
      entries: [
        {
          id: CORE_ANCHOR_RESOLVER_HANDLER_ID,
          definition: {
            kind: "anchor_resolution",
            supportedRootKinds: [
              "sql",
              "json_blob",
              "object",
              "index_cache",
              "log_trace",
              "backup",
              "external_route"
            ],
            supportedOperations: ["read"],
            bounded: true,
            idempotent: true,
            checksTenantFence: true,
            checksRevisionFence: true,
            checksHoldFence: false,
            verifiesAbsence: false
          }
        }
      ]
    }
  });

export const INBOX_V2_CORE_LIFECYCLE_HANDLER_CATALOG =
  defineInboxV2CatalogRegistrations([coreAnchorHandlerRegistration])[0]!;

const elapsed = (seconds: number) =>
  ({ kind: "elapsed" as const, seconds }) satisfies z.input<
    typeof inboxV2RetentionPeriodSchema
  >;
const calendarYears = (years: number) =>
  ({ kind: "calendar" as const, years, months: 0, days: 0 }) satisfies z.input<
    typeof inboxV2RetentionPeriodSchema
  >;
const E1H = elapsed(3_600);
const E24H = elapsed(86_400);
const E7D = elapsed(604_800);
const E30D = elapsed(2_592_000);
const E35D = elapsed(3_024_000);
const E90D = elapsed(7_776_000);
const E365D = elapsed(31_536_000);
const C3Y = calendarYears(3);
const profileRequired = { kind: "profile_required" as const };
const parentWindow = {
  kind: "inherits_all_live_parents" as const,
  maximumAdditionalPeriod: null
};
const parentWithMaximum = (
  period: z.input<typeof inboxV2RetentionPeriodSchema>
) =>
  ({
    kind: "inherits_all_live_parents" as const,
    maximumAdditionalPeriod: period
  }) satisfies z.input<typeof inboxV2DataClassRetentionRequirementSchema>;
const fixed = (period: z.input<typeof inboxV2RetentionPeriodSchema>) =>
  ({ kind: "fixed_after_anchor" as const, period }) satisfies z.input<
    typeof inboxV2DataClassRetentionRequirementSchema
  >;
const anchor = (localId: (typeof CORE_ANCHOR_LOCAL_IDS)[number]) =>
  `core:${localId}` as const;

type CoreDataClassRow = Readonly<{
  id: `core:${string}`;
  sensitivity: z.input<typeof inboxV2DataSensitivitySchema>;
  purposes: readonly string[];
  anchor: `core:${string}`;
  retention: z.input<typeof inboxV2DataClassRetentionRequirementSchema>;
  actions: readonly z.input<typeof inboxV2LifecycleActionSchema>[];
  hold: boolean;
  exportBehavior: z.input<typeof inboxV2DataExportBehaviorSchema>;
  subject: z.input<typeof inboxV2SubjectLinkBehaviorSchema>;
  immediate?: boolean;
}>;

const row = (
  localId: string,
  input: Omit<CoreDataClassRow, "id">
): CoreDataClassRow => ({ id: `core:${localId}`, ...input });

const hard = ["hard_delete"] as const;
const compactOrDelete = ["compact_to_safe_skeleton", "hard_delete"] as const;
const removeIdentity = [
  "remove_identity_resolution_keep_subjectless_fact"
] as const;
const purgeContent = ["purge_content_keep_tombstone"] as const;
const anonymizeOrDelete = ["anonymize_and_reaggregate", "hard_delete"] as const;
const deliveryService = [PURPOSE.delivery, PURPOSE.service, PURPOSE.legal];
const replaySecurity = [PURPOSE.replay, PURPOSE.security, PURPOSE.legal];
const privacyLegal = [PURPOSE.privacy, PURPOSE.legal];

const CORE_DATA_CLASS_ROWS: readonly CoreDataClassRow[] = [
  row("raw_event_envelope", {
    sensitivity: "personal_operational",
    purposes: replaySecurity,
    anchor: anchor("terminal_processing"),
    retention: fixed(E90D),
    actions: ["compact_to_safe_skeleton"],
    hold: true,
    exportBehavior: "normalized_projection",
    subject: "direct_structured"
  }),
  row("raw_provider_payload", {
    sensitivity: "restricted_content",
    purposes: replaySecurity,
    anchor: anchor("terminal_processing"),
    retention: fixed(E30D),
    actions: hard,
    hold: true,
    exportBehavior: "normalized_projection",
    subject: "discovery_candidates"
  }),
  row("raw_provider_allowed_headers", {
    sensitivity: "personal_identifier",
    purposes: replaySecurity,
    anchor: anchor("terminal_processing"),
    retention: fixed(E30D),
    actions: hard,
    hold: true,
    exportBehavior: "normalized_projection",
    subject: "direct_structured"
  }),
  row("normalized_event_envelope", {
    sensitivity: "personal_operational",
    purposes: replaySecurity,
    anchor: anchor("materialization_or_final_failure"),
    retention: fixed(E90D),
    actions: ["compact_to_safe_skeleton"],
    hold: true,
    exportBehavior: "normalized_projection",
    subject: "direct_structured"
  }),
  row("normalized_event_payload", {
    sensitivity: "restricted_content",
    purposes: replaySecurity,
    anchor: anchor("materialization_or_final_failure"),
    retention: fixed(E90D),
    actions: hard,
    hold: true,
    exportBehavior: "normalized_projection",
    subject: "direct_structured"
  }),
  row("source_delivery_dedupe_skeleton", {
    sensitivity: "personal_identifier",
    purposes: [PURPOSE.replay],
    anchor: anchor("terminal_processing"),
    retention: profileRequired,
    actions: hard,
    hold: false,
    exportBehavior: "omit_with_reason",
    subject: "direct_structured"
  }),
  row("domain_event_commit_envelope", {
    sensitivity: "personal_operational",
    purposes: [PURPOSE.service, PURPOSE.work, PURPOSE.legal],
    anchor: anchor("tenant_commit"),
    retention: profileRequired,
    actions: ["compact_to_safe_skeleton"],
    hold: true,
    exportBehavior: "normalized_projection",
    subject: "direct_structured"
  }),
  row("domain_event_content_or_evidence_ref", {
    sensitivity: "restricted_content",
    purposes: [PURPOSE.service, PURPOSE.legal],
    anchor: anchor("parent_commit"),
    retention: parentWindow,
    actions: hard,
    hold: true,
    exportBehavior: "authorized_projection",
    subject: "inherits_from_parent"
  }),
  row("outbox_dispatch_envelope", {
    sensitivity: "personal_operational",
    purposes: [PURPOSE.delivery, PURPOSE.replay],
    anchor: anchor("terminal_outcome"),
    retention: fixed(E90D),
    actions: ["compact_to_safe_skeleton"],
    hold: true,
    exportBehavior: "tenant_manifest",
    subject: "direct_structured"
  }),
  row("outbox_webhook_dispatch_body", {
    sensitivity: "restricted_content",
    purposes: [PURPOSE.delivery, PURPOSE.replay],
    anchor: anchor("terminal_outcome"),
    retention: fixed(E30D),
    actions: hard,
    hold: true,
    exportBehavior: "normalized_projection",
    subject: "inherits_from_parent"
  }),
  row("replay_sync_delta", {
    sensitivity: "personal_operational",
    purposes: [PURPOSE.replay],
    anchor: anchor("committed_stream_position"),
    retention: fixed(E90D),
    actions: hard,
    hold: true,
    exportBehavior: "tenant_manifest",
    subject: "inherits_from_parent"
  }),
  row("timeline_item_envelope", {
    sensitivity: "personal_operational",
    purposes: deliveryService,
    anchor: anchor("canonical_item_commit"),
    retention: profileRequired,
    actions: ["compact_to_safe_skeleton"],
    hold: true,
    exportBehavior: "normalized_projection",
    subject: "direct_structured"
  }),
  row("message_content_blocks", {
    sensitivity: "restricted_content",
    purposes: deliveryService,
    anchor: anchor("canonical_item_time"),
    retention: fixed(E365D),
    actions: purgeContent,
    hold: true,
    exportBehavior: "authorized_projection",
    subject: "discovery_candidates"
  }),
  row("staff_note_content_blocks", {
    sensitivity: "restricted_content",
    purposes: [PURPOSE.work, PURPOSE.legal, PURPOSE.privacy],
    anchor: anchor("canonical_item_time"),
    retention: fixed(E365D),
    actions: purgeContent,
    hold: true,
    exportBehavior: "reviewed_sensitive_evidence",
    subject: "discovery_candidates"
  }),
  row("timeline_tombstone", {
    sensitivity: "personal_operational",
    purposes: [PURPOSE.replay, PURPOSE.legal],
    anchor: anchor("content_purge_or_revision"),
    retention: profileRequired,
    actions: compactOrDelete,
    hold: true,
    exportBehavior: "normalized_projection",
    subject: "inherits_from_parent"
  }),
  row("source_account_identity_and_alias", {
    sensitivity: "personal_identifier",
    purposes: [PURPOSE.delivery, PURPOSE.replay, PURPOSE.privacy],
    anchor: anchor("account_replacement_or_relationship_end"),
    retention: profileRequired,
    actions: removeIdentity,
    hold: true,
    exportBehavior: "normalized_projection",
    subject: "direct_structured"
  }),
  row("external_thread_identity_and_alias", {
    sensitivity: "personal_identifier",
    purposes: [PURPOSE.delivery, PURPOSE.replay, PURPOSE.privacy],
    anchor: anchor("thread_relationship_end"),
    retention: profileRequired,
    actions: removeIdentity,
    hold: true,
    exportBehavior: "normalized_projection",
    subject: "direct_structured"
  }),
  row("source_thread_binding", {
    sensitivity: "personal_identifier",
    purposes: [PURPOSE.delivery, PURPOSE.replay],
    anchor: anchor("unbind_or_source_termination"),
    retention: profileRequired,
    actions: removeIdentity,
    hold: true,
    exportBehavior: "tenant_manifest",
    subject: "direct_structured"
  }),
  row("source_occurrence_and_external_reference", {
    sensitivity: "personal_operational",
    purposes: [PURPOSE.delivery, PURPOSE.replay, PURPOSE.legal],
    anchor: anchor("terminal_occurrence_or_resolution"),
    retention: profileRequired,
    actions: ["compact_to_safe_skeleton"],
    hold: true,
    exportBehavior: "normalized_projection",
    subject: "direct_structured"
  }),
  row("outbound_route_and_policy", {
    sensitivity: "personal_operational",
    purposes: [PURPOSE.delivery, PURPOSE.replay],
    anchor: anchor("route_or_policy_replacement"),
    retention: profileRequired,
    actions: ["compact_to_safe_skeleton"],
    hold: true,
    exportBehavior: "normalized_projection",
    subject: "inherits_from_parent"
  }),
  row("outbound_dispatch_attempt_and_artifact", {
    sensitivity: "personal_operational",
    purposes: [PURPOSE.delivery, PURPOSE.replay],
    anchor: anchor("terminal_dispatch_or_artifact_outcome"),
    retention: profileRequired,
    actions: ["compact_to_safe_skeleton"],
    hold: true,
    exportBehavior: "normalized_projection",
    subject: "inherits_from_parent"
  }),
  row("outbound_dispatch_reconciliation", {
    sensitivity: "security_evidence",
    purposes: [PURPOSE.delivery, PURPOSE.replay, PURPOSE.legal],
    anchor: anchor("terminal_reconciliation_decision"),
    retention: profileRequired,
    actions: ["compact_to_safe_skeleton"],
    hold: true,
    exportBehavior: "normalized_projection",
    subject: "inherits_from_parent"
  }),
  row("conversation_state", {
    sensitivity: "personal_operational",
    purposes: deliveryService,
    anchor: anchor("conversation_terminal_or_relationship_end"),
    retention: profileRequired,
    actions: compactOrDelete,
    hold: true,
    exportBehavior: "authorized_projection",
    subject: "direct_structured"
  }),
  row("work_item_state", {
    sensitivity: "personal_operational",
    purposes: [PURPOSE.work, PURPOSE.service, PURPOSE.reporting],
    anchor: anchor("work_item_terminal"),
    retention: profileRequired,
    actions: compactOrDelete,
    hold: true,
    exportBehavior: "authorized_projection",
    subject: "direct_structured"
  }),
  row("work_assignment_history", {
    sensitivity: "personal_operational",
    purposes: [PURPOSE.work, PURPOSE.reporting, PURPOSE.legal],
    anchor: anchor("assignment_interval_close"),
    retention: profileRequired,
    actions: compactOrDelete,
    hold: true,
    exportBehavior: "normalized_projection",
    subject: "direct_structured"
  }),
  row("employee_conversation_read_state", {
    sensitivity: "personal_operational",
    purposes: [PURPOSE.work],
    anchor: anchor("employee_conversation_relation_end"),
    retention: fixed(E90D),
    actions: hard,
    hold: false,
    exportBehavior: "normalized_projection",
    subject: "direct_structured"
  }),
  row("participant_membership", {
    sensitivity: "personal_identifier",
    purposes: deliveryService,
    anchor: anchor("membership_end"),
    retention: profileRequired,
    actions: removeIdentity,
    hold: true,
    exportBehavior: "authorized_projection",
    subject: "direct_structured"
  }),
  row("source_external_identity", {
    sensitivity: "personal_identifier",
    purposes: [PURPOSE.delivery, PURPOSE.crm, PURPOSE.privacy],
    anchor: anchor("unlink_or_relationship_end"),
    retention: profileRequired,
    actions: removeIdentity,
    hold: true,
    exportBehavior: "authorized_projection",
    subject: "direct_structured"
  }),
  row("client_contact_profile", {
    sensitivity: "personal_identifier",
    purposes: [PURPOSE.crm, PURPOSE.service, PURPOSE.privacy],
    anchor: anchor("relationship_end"),
    retention: profileRequired,
    actions: removeIdentity,
    hold: true,
    exportBehavior: "authorized_projection",
    subject: "direct_structured"
  }),
  row("crm_value_and_history", {
    sensitivity: "personal_identifier",
    purposes: [PURPOSE.crm, PURPOSE.service, PURPOSE.reporting],
    anchor: anchor("relationship_or_case_end"),
    retention: profileRequired,
    actions: removeIdentity,
    hold: true,
    exportBehavior: "authorized_projection",
    subject: "direct_structured"
  }),
  row("conversation_client_link_history", {
    sensitivity: "personal_identifier",
    purposes: [PURPOSE.crm, PURPOSE.service, PURPOSE.privacy],
    anchor: anchor("link_episode_or_relationship_end"),
    retention: profileRequired,
    actions: removeIdentity,
    hold: true,
    exportBehavior: "authorized_projection",
    subject: "direct_structured"
  }),
  row("client_merge_node_state", {
    sensitivity: "personal_identifier",
    purposes: [PURPOSE.crm, PURPOSE.privacy],
    anchor: anchor("client_or_merge_relationship_end"),
    retention: profileRequired,
    actions: removeIdentity,
    hold: true,
    exportBehavior: "authorized_projection",
    subject: "direct_structured"
  }),
  row("client_merge_redirect_history", {
    sensitivity: "personal_identifier",
    purposes: [PURPOSE.crm, PURPOSE.privacy],
    anchor: anchor("source_or_canonical_relationship_end"),
    retention: profileRequired,
    actions: removeIdentity,
    hold: true,
    exportBehavior: "authorized_projection",
    subject: "direct_structured"
  }),
  row("file_metadata", {
    sensitivity: "personal_identifier",
    purposes: [PURPOSE.delivery, PURPOSE.service, PURPOSE.legal],
    anchor: anchor("all_parent_links_and_purposes_end"),
    retention: parentWindow,
    actions: hard,
    hold: true,
    exportBehavior: "authorized_projection",
    subject: "inherits_from_parent"
  }),
  row("file_original_binary", {
    sensitivity: "restricted_content",
    purposes: [PURPOSE.delivery, PURPOSE.service, PURPOSE.legal],
    anchor: anchor("all_parent_links_and_purposes_end"),
    retention: parentWindow,
    actions: hard,
    hold: true,
    exportBehavior: "authorized_projection",
    subject: "discovery_candidates"
  }),
  row("file_derived_binary", {
    sensitivity: "restricted_content",
    purposes: [PURPOSE.delivery, PURPOSE.service],
    anchor: anchor("source_or_last_required_use"),
    retention: parentWithMaximum(E30D),
    actions: hard,
    hold: true,
    exportBehavior: "omit_with_reason",
    subject: "inherits_from_parent"
  }),
  row("call_metadata", {
    sensitivity: "personal_operational",
    purposes: [PURPOSE.delivery, PURPOSE.service, PURPOSE.reporting],
    anchor: anchor("call_completion"),
    retention: fixed(E365D),
    actions: ["compact_to_safe_skeleton"],
    hold: true,
    exportBehavior: "normalized_projection",
    subject: "direct_structured"
  }),
  row("call_recording", {
    sensitivity: "restricted_content",
    purposes: [PURPOSE.service, PURPOSE.legal, PURPOSE.ai],
    anchor: anchor("call_completion"),
    retention: fixed(E90D),
    actions: purgeContent,
    hold: true,
    exportBehavior: "reviewed_sensitive_evidence",
    subject: "discovery_candidates"
  }),
  row("call_transcript", {
    sensitivity: "restricted_content",
    purposes: [PURPOSE.service, PURPOSE.legal, PURPOSE.ai],
    anchor: anchor("call_completion"),
    retention: fixed(E90D),
    actions: purgeContent,
    hold: true,
    exportBehavior: "reviewed_sensitive_evidence",
    subject: "discovery_candidates"
  }),
  row("ai_prompt_output_embedding", {
    sensitivity: "restricted_content",
    purposes: [PURPOSE.ai],
    anchor: anchor("source_parent_or_last_required_use"),
    retention: parentWindow,
    actions: hard,
    hold: true,
    exportBehavior: "normalized_projection",
    subject: "inherits_from_parent"
  }),
  row("notification_endpoint", {
    sensitivity: "personal_identifier",
    purposes: [PURPOSE.notification, PURPOSE.security],
    anchor: anchor("revoke_or_deactivation"),
    retention: fixed(E30D),
    actions: hard,
    hold: false,
    exportBehavior: "normalized_projection",
    subject: "direct_structured"
  }),
  row("notification_preview_payload", {
    sensitivity: "restricted_content",
    purposes: [PURPOSE.notification],
    anchor: anchor("source_or_creation"),
    retention: parentWithMaximum(E7D),
    actions: hard,
    hold: true,
    exportBehavior: "normalized_projection",
    subject: "inherits_from_parent"
  }),
  row("notification_feed_delivery", {
    sensitivity: "personal_operational",
    purposes: [PURPOSE.notification],
    anchor: anchor("creation_or_terminal_outcome"),
    retention: fixed(E90D),
    actions: compactOrDelete,
    hold: false,
    exportBehavior: "normalized_projection",
    subject: "direct_structured"
  }),
  row("analytics_person_fact", {
    sensitivity: "personal_operational",
    purposes: [PURPOSE.reporting],
    anchor: anchor("event_time"),
    retention: fixed(E365D),
    actions: removeIdentity,
    hold: true,
    exportBehavior: "authorized_projection",
    subject: "direct_structured"
  }),
  row("analytics_subject_bridge", {
    sensitivity: "personal_identifier",
    purposes: [PURPOSE.reporting, PURPOSE.privacy],
    anchor: anchor("source_fact_or_relationship_end"),
    retention: fixed(E365D),
    actions: hard,
    hold: true,
    exportBehavior: "normalized_projection",
    subject: "direct_structured"
  }),
  row("analytics_anonymous_rollup", {
    sensitivity: "non_personal_aggregate",
    purposes: [PURPOSE.reporting],
    anchor: anchor("rollup_window_close"),
    retention: profileRequired,
    actions: anonymizeOrDelete,
    hold: false,
    exportBehavior: "anonymous_only",
    subject: "none"
  }),
  row("domain_audit_skeleton", {
    sensitivity: "security_evidence",
    purposes: [PURPOSE.legal, PURPOSE.security],
    anchor: anchor("action_time"),
    retention: fixed(C3Y),
    actions: compactOrDelete,
    hold: true,
    exportBehavior: "reviewed_sensitive_evidence",
    subject: "direct_structured"
  }),
  row("privileged_security_audit_skeleton", {
    sensitivity: "security_evidence",
    purposes: [PURPOSE.security, PURPOSE.legal],
    anchor: anchor("action_time"),
    retention: fixed(C3Y),
    actions: compactOrDelete,
    hold: true,
    exportBehavior: "reviewed_sensitive_evidence",
    subject: "direct_structured"
  }),
  row("security_denial_signal", {
    sensitivity: "security_evidence",
    purposes: [PURPOSE.security],
    anchor: anchor("signal_time"),
    retention: fixed(E30D),
    actions: anonymizeOrDelete,
    hold: false,
    exportBehavior: "normalized_projection",
    subject: "direct_structured"
  }),
  row("platform_audit_skeleton", {
    sensitivity: "security_evidence",
    purposes: [PURPOSE.security, PURPOSE.legal],
    anchor: anchor("action_time"),
    retention: fixed(C3Y),
    actions: compactOrDelete,
    hold: true,
    exportBehavior: "tenant_manifest",
    subject: "direct_structured"
  }),
  row("privacy_sensitive_evidence", {
    sensitivity: "sensitive_personal",
    purposes: privacyLegal,
    anchor: anchor("case_completion_or_release"),
    retention: profileRequired,
    actions: hard,
    hold: true,
    exportBehavior: "reviewed_sensitive_evidence",
    subject: "direct_structured"
  }),
  row("external_deletion_residual_evidence", {
    sensitivity: "security_evidence",
    purposes: privacyLegal,
    anchor: anchor("final_external_outcome"),
    retention: fixed(C3Y),
    actions: compactOrDelete,
    hold: true,
    exportBehavior: "normalized_projection",
    subject: "direct_structured"
  }),
  row("export_partial_artifact", {
    sensitivity: "restricted_content",
    purposes: [PURPOSE.privacy],
    anchor: anchor("cancel_or_failure"),
    retention: fixed(E1H),
    actions: hard,
    hold: false,
    exportBehavior: "never",
    subject: "inherits_from_parent"
  }),
  row("export_ready_artifact", {
    sensitivity: "restricted_content",
    purposes: [PURPOSE.privacy],
    anchor: anchor("ready"),
    retention: fixed(E24H),
    actions: hard,
    hold: false,
    exportBehavior: "authorized_projection",
    subject: "inherits_from_parent"
  }),
  row("export_manifest_evidence", {
    sensitivity: "security_evidence",
    purposes: privacyLegal,
    anchor: anchor("artifact_expiry_or_request_completion"),
    retention: profileRequired,
    actions: compactOrDelete,
    hold: true,
    exportBehavior: "normalized_projection",
    subject: "direct_structured"
  }),
  row("operational_log_trace_diagnostic", {
    sensitivity: "security_evidence",
    purposes: [PURPOSE.replay, PURPOSE.security],
    anchor: anchor("creation"),
    retention: fixed(E30D),
    actions: hard,
    hold: false,
    exportBehavior: "never",
    subject: "none"
  }),
  row("support_bundle", {
    sensitivity: "restricted_content",
    purposes: [PURPOSE.replay],
    anchor: anchor("support_case_close"),
    retention: fixed(E7D),
    actions: hard,
    hold: false,
    exportBehavior: "tenant_manifest",
    subject: "discovery_candidates"
  }),
  row("auth_credential_session_challenge_secret", {
    sensitivity: "secret",
    purposes: [PURPOSE.security],
    anchor: anchor("revoke_expiry_or_completion"),
    retention: fixed(E24H),
    actions: hard,
    hold: false,
    exportBehavior: "never",
    subject: "none",
    immediate: true
  }),
  row("auth_security_outcome", {
    sensitivity: "security_evidence",
    purposes: [PURPOSE.security],
    anchor: anchor("revoke_expiry_or_completion"),
    retention: fixed(E30D),
    actions: compactOrDelete,
    hold: false,
    exportBehavior: "normalized_projection",
    subject: "direct_structured"
  }),
  row("source_account_connector_metadata", {
    sensitivity: "personal_operational",
    purposes: [PURPOSE.delivery, PURPOSE.replay],
    anchor: anchor("disconnect_or_account_termination"),
    retention: profileRequired,
    actions: compactOrDelete,
    hold: true,
    exportBehavior: "authorized_projection",
    subject: "direct_structured"
  }),
  row("access_grant_invitation_membership_history", {
    sensitivity: "security_evidence",
    purposes: [PURPOSE.security, PURPOSE.work, PURPOSE.legal],
    anchor: anchor("revoke_expiry_or_membership_end"),
    retention: profileRequired,
    actions: compactOrDelete,
    hold: true,
    exportBehavior: "normalized_projection",
    subject: "direct_structured"
  }),
  row("webhook_config_and_delivery_metadata", {
    sensitivity: "personal_operational",
    purposes: [PURPOSE.delivery, PURPOSE.replay],
    anchor: anchor("disable_delete_or_terminal_outcome"),
    retention: profileRequired,
    actions: compactOrDelete,
    hold: true,
    exportBehavior: "authorized_projection",
    subject: "direct_structured"
  }),
  row("usage_billing_entitlement_fact", {
    sensitivity: "personal_operational",
    purposes: [PURPOSE.billing, PURPOSE.legal],
    anchor: anchor("billing_or_contract_period_close"),
    retention: profileRequired,
    actions: compactOrDelete,
    hold: true,
    exportBehavior: "authorized_projection",
    subject: "direct_structured"
  }),
  row("tenant_brand_asset", {
    sensitivity: "restricted_content",
    purposes: [PURPOSE.service],
    anchor: anchor("replacement_or_tenant_termination"),
    retention: parentWindow,
    actions: hard,
    hold: true,
    exportBehavior: "tenant_manifest",
    subject: "discovery_candidates"
  }),
  row("backup_copy_or_object_version", {
    sensitivity: "restricted_content",
    purposes: [PURPOSE.security, PURPOSE.legal],
    anchor: anchor("backup_or_version_creation"),
    retention: fixed(E35D),
    actions: hard,
    hold: true,
    exportBehavior: "never",
    subject: "inherits_from_parent"
  }),
  row("erasure_hold_restore_ledger", {
    sensitivity: "security_evidence",
    purposes: privacyLegal,
    anchor: anchor("completion_or_release"),
    retention: profileRequired,
    actions: compactOrDelete,
    hold: true,
    exportBehavior: "normalized_projection",
    subject: "direct_structured"
  })
];

const coreDataClassRegistration =
  inboxV2CoreDataClassCatalogRegistrationSchema.parse({
    schemaId: "core:inbox-v2.catalog-registration",
    schemaVersion: "v1",
    payload: {
      catalog: "data-class",
      owner: { kind: "core" },
      entries: CORE_DATA_CLASS_ROWS.map((item) => ({
        id: item.id,
        definition: {
          sensitivity: item.sensitivity,
          allowedPurposeIds: item.purposes,
          canonicalAnchorId: item.anchor,
          retentionRequirement: item.retention,
          allowedExpiryActions: item.actions,
          immediateTerminalPurge: item.immediate ?? false,
          parentBehavior:
            item.retention.kind === "inherits_all_live_parents"
              ? "inherits_all_live_parents"
              : "independent",
          subjectLinkBehavior: item.subject,
          exportBehavior: item.exportBehavior,
          holdEligible: item.hold
        }
      }))
    }
  });

export const INBOX_V2_CORE_DATA_CLASS_CATALOG =
  defineInboxV2CatalogRegistrations([coreDataClassRegistration])[0]!;

export type InboxV2ProcessingPurposeDefinition = z.infer<
  typeof inboxV2ProcessingPurposeDefinitionSchema
>;
export type InboxV2LifecycleHandlerDefinition = z.infer<
  typeof inboxV2LifecycleHandlerDefinitionSchema
>;
export type InboxV2StorageRootDefinition = z.infer<
  typeof inboxV2StorageRootDefinitionSchema
>;
export type InboxV2DataClassDefinition = z.infer<
  typeof inboxV2DataClassDefinitionSchema
>;
export type InboxV2ModuleDataClassDeclaration = z.infer<
  typeof inboxV2ModuleDataClassDeclarationSchema
>;
export type InboxV2ModuleRetentionRuleDeclaration = z.infer<
  typeof inboxV2ModuleRetentionRuleDeclarationSchema
>;
export type InboxV2ModuleDataUse = z.infer<typeof inboxV2ModuleDataUseSchema>;
export type InboxV2CoreDataUseRegistration = z.infer<
  typeof inboxV2CoreDataUseRegistrationSchema
>;
export type InboxV2ModuleExternalRoute = z.infer<
  typeof inboxV2ModuleExternalRouteSchema
>;
export type InboxV2ModuleDataGovernanceContribution = z.infer<
  typeof inboxV2ModuleDataGovernanceContributionSchema
>;

type RegistryEntry<TDefinition> = Readonly<{
  id: string;
  definition: TDefinition;
  owner: "core" | string;
}>;

export type InboxV2RegisteredDataUse = Readonly<
  InboxV2ModuleDataUse & { owner: "core" | string }
>;

export type InboxV2DataLifecycleRegistry = InboxV2DeepReadonly<{
  schemaVersion: typeof INBOX_V2_INITIAL_SCHEMA_VERSION;
  compositionHash: InboxV2Sha256Digest;
  dataClasses: readonly RegistryEntry<InboxV2DataClassDefinition>[];
  processingPurposes: readonly RegistryEntry<InboxV2ProcessingPurposeDefinition>[];
  retentionRules: readonly RegistryEntry<
    InboxV2ModuleRetentionRuleDeclaration["definition"]
  >[];
  retentionAnchors: readonly RegistryEntry<
    z.infer<typeof inboxV2CanonicalAnchorDefinitionSchema>
  >[];
  storageRoots: readonly RegistryEntry<InboxV2StorageRootDefinition>[];
  handlers: readonly RegistryEntry<InboxV2LifecycleHandlerDefinition>[];
  dataUses: readonly InboxV2RegisteredDataUse[];
  moduleContributions: readonly InboxV2ModuleDataGovernanceContribution[];
}>;

const definedInboxV2DataLifecycleRegistries = new WeakSet<object>();

/** Runtime authenticity guard; a frozen caller-authored lookalike is rejected. */
export function isInboxV2DataLifecycleRegistry(
  value: unknown
): value is InboxV2DataLifecycleRegistry {
  return (
    typeof value === "object" &&
    value !== null &&
    definedInboxV2DataLifecycleRegistries.has(value)
  );
}

export function defineInboxV2DataLifecycleRegistry(input?: {
  coreStorageRootRegistrations?: readonly z.input<
    typeof inboxV2CoreStorageRootCatalogRegistrationSchema
  >[];
  coreLifecycleHandlerRegistrations?: readonly z.input<
    typeof inboxV2CoreLifecycleHandlerCatalogRegistrationSchema
  >[];
  coreDataUseRegistrations?: readonly z.input<
    typeof inboxV2CoreDataUseRegistrationSchema
  >[];
  moduleContributions?: readonly z.input<
    typeof inboxV2ModuleDataGovernanceContributionSchema
  >[];
}): InboxV2DataLifecycleRegistry {
  const dataClasses: RegistryEntry<InboxV2DataClassDefinition>[] =
    INBOX_V2_CORE_DATA_CLASS_CATALOG.payload.entries.map((entry) => ({
      id: inboxV2DataClassIdSchema.parse(entry.id),
      definition: inboxV2DataClassDefinitionSchema.parse(entry.definition),
      owner: "core"
    }));
  const processingPurposes: RegistryEntry<InboxV2ProcessingPurposeDefinition>[] =
    INBOX_V2_CORE_PROCESSING_PURPOSE_CATALOG.payload.entries.map((entry) => ({
      id: inboxV2ProcessingPurposeIdSchema.parse(entry.id),
      definition: inboxV2ProcessingPurposeDefinitionSchema.parse(
        entry.definition
      ),
      owner: "core"
    }));
  const retentionRules: RegistryEntry<
    InboxV2ModuleRetentionRuleDeclaration["definition"]
  >[] = [];
  const retentionAnchors: RegistryEntry<
    z.infer<typeof inboxV2CanonicalAnchorDefinitionSchema>
  >[] = INBOX_V2_CORE_RETENTION_ANCHOR_CATALOG.payload.entries.map((entry) => ({
    id: inboxV2RetentionAnchorIdSchema.parse(entry.id),
    definition: inboxV2CanonicalAnchorDefinitionSchema.parse(entry.definition),
    owner: "core"
  }));
  const storageRoots: RegistryEntry<InboxV2StorageRootDefinition>[] = [];
  const handlers: RegistryEntry<InboxV2LifecycleHandlerDefinition>[] =
    INBOX_V2_CORE_LIFECYCLE_HANDLER_CATALOG.payload.entries.map((entry) => ({
      id: inboxV2LifecycleHandlerIdSchema.parse(entry.id),
      definition: inboxV2LifecycleHandlerDefinitionSchema.parse(
        entry.definition
      ),
      owner: "core"
    }));
  const dataUses: InboxV2RegisteredDataUse[] = [];

  for (const registrationInput of input?.coreStorageRootRegistrations ?? []) {
    const registration =
      inboxV2CoreStorageRootCatalogRegistrationSchema.parse(registrationInput);
    for (const entry of registration.payload.entries) {
      storageRoots.push({
        id: inboxV2StorageRootIdSchema.parse(entry.id),
        definition: inboxV2StorageRootDefinitionSchema.parse(entry.definition),
        owner: "core"
      });
    }
  }
  for (const registrationInput of input?.coreLifecycleHandlerRegistrations ??
    []) {
    const registration =
      inboxV2CoreLifecycleHandlerCatalogRegistrationSchema.parse(
        registrationInput
      );
    for (const entry of registration.payload.entries) {
      handlers.push({
        id: inboxV2LifecycleHandlerIdSchema.parse(entry.id),
        definition: inboxV2LifecycleHandlerDefinitionSchema.parse(
          entry.definition
        ),
        owner: "core"
      });
    }
  }
  for (const registrationInput of input?.coreDataUseRegistrations ?? []) {
    const registration =
      inboxV2CoreDataUseRegistrationSchema.parse(registrationInput);
    for (const use of registration.payload.dataUses) {
      assertCoreId(use.dataClassId, "core data-use class");
      assertCoreId(use.storageRootId, "core data-use storage root");
      assertCoreId(use.lifecycleHandlerId, "core data-use lifecycle handler");
      for (const [handlerId, label] of [
        [use.subjectDiscoveryHandlerId, "subject-discovery"],
        [use.exportProjectionHandlerId, "export-projection"],
        [use.exportHandlerId, "export"],
        [use.deleteHandlerId, "delete"],
        [use.verificationHandlerId, "verification"]
      ] as const) {
        if (handlerId !== null) {
          assertCoreId(handlerId, `core data-use ${label} handler`);
        }
      }
      dataUses.push({ ...use, owner: "core" });
    }
  }

  const moduleContributions = (input?.moduleContributions ?? []).map(
    (contribution) =>
      inboxV2ModuleDataGovernanceContributionSchema.parse(contribution)
  );

  for (const contribution of moduleContributions) {
    const { payload } = contribution;
    for (const declaration of payload.processingPurposes) {
      assertOwnedByModule(declaration.id, payload.moduleId, "purpose");
      processingPurposes.push({
        ...declaration,
        owner: String(payload.moduleId)
      });
    }
    for (const declaration of payload.retentionAnchors) {
      assertOwnedByModule(declaration.id, payload.moduleId, "anchor");
      retentionAnchors.push({
        ...declaration,
        owner: String(payload.moduleId)
      });
    }
    for (const declaration of payload.handlers) {
      assertOwnedByModule(declaration.id, payload.moduleId, "handler");
      handlers.push({ ...declaration, owner: String(payload.moduleId) });
    }
    for (const declaration of payload.storageRoots) {
      assertOwnedByModule(declaration.id, payload.moduleId, "storage root");
      storageRoots.push({ ...declaration, owner: String(payload.moduleId) });
    }
    for (const use of payload.dataUses) {
      dataUses.push({ ...use, owner: String(payload.moduleId) });
    }
  }

  assertUniqueRegistryIds(dataClasses, "data class");
  assertUniqueRegistryIds(processingPurposes, "processing purpose");
  assertUniqueRegistryIds(retentionAnchors, "retention anchor");
  assertUniqueRegistryIds(storageRoots, "storage root");
  assertUniqueRegistryIds(handlers, "lifecycle handler");

  const coreClassById = new Map(dataClasses.map((entry) => [entry.id, entry]));
  const purposeById = new Map(
    processingPurposes.map((entry) => [entry.id, entry])
  );
  const anchorById = new Map(
    retentionAnchors.map((entry) => [entry.id, entry])
  );
  const rootById = new Map(storageRoots.map((entry) => [entry.id, entry]));
  const handlerById = new Map(handlers.map((entry) => [entry.id, entry]));

  for (const anchorEntry of retentionAnchors) {
    requireHandler(
      handlerById,
      anchorEntry.definition.resolverHandlerId,
      "anchor_resolution",
      undefined,
      undefined
    );
  }

  for (const classEntry of dataClasses) {
    requireEntry(anchorById, classEntry.definition.canonicalAnchorId, "anchor");
    for (const purposeId of classEntry.definition.allowedPurposeIds) {
      requireEntry(purposeById, purposeId, "processing purpose");
    }
  }

  for (const purposeEntry of processingPurposes) {
    if (purposeEntry.owner === "core") {
      if (purposeEntry.definition.parentCorePurposeId !== null) {
        throw new Error(
          `Core processing purpose ${purposeEntry.id} cannot declare a parent purpose.`
        );
      }
      continue;
    }
    const parentPurposeId = purposeEntry.definition.parentCorePurposeId;
    if (parentPurposeId === null) {
      throw new Error(
        `Module processing purpose ${purposeEntry.id} requires a core safety ceiling.`
      );
    }
    const parentPurpose = requireEntry(
      purposeById,
      parentPurposeId,
      "parent processing purpose"
    );
    if (parentPurpose.owner !== "core") {
      throw new Error(
        `Module processing purpose ${purposeEntry.id} must map directly to a core purpose.`
      );
    }
    if (
      (parentPurpose.definition.responsibilityRoleRequired &&
        !purposeEntry.definition.responsibilityRoleRequired) ||
      (parentPurpose.definition.subjectDiscoveryRequired &&
        !purposeEntry.definition.subjectDiscoveryRequired)
    ) {
      throw new Error(
        `Module processing purpose ${purposeEntry.id} cannot weaken its core purpose safety ceiling.`
      );
    }
  }

  for (const contribution of moduleContributions) {
    const { payload } = contribution;
    for (const declaration of payload.dataClasses) {
      assertOwnedByModule(declaration.id, payload.moduleId, "data class");
      assertCoreId(declaration.parentCoreClassId, "parent data class");
      const parent = requireEntry(
        coreClassById,
        declaration.parentCoreClassId,
        "parent core data class"
      );
      validateModuleDataClassCompatibility({
        declaration,
        parent: parent.definition,
        moduleId: String(payload.moduleId),
        purposeById
      });
      for (const rootId of declaration.storageRootIds) {
        assertOwnedByModule(rootId, payload.moduleId, "storage root");
      }
      for (const ruleRef of declaration.retentionRuleRefs) {
        assertOwnedByModule(ruleRef.id, payload.moduleId, "retention rule");
      }
      const canonicalAnchorId =
        declaration.canonicalAnchorId ?? parent.definition.canonicalAnchorId;
      requireEntry(anchorById, canonicalAnchorId, "canonical anchor");
      for (const purposeId of declaration.allowedPurposeIds) {
        requireEntry(purposeById, purposeId, "processing purpose");
      }
      const definition = inboxV2DataClassDefinitionSchema.parse({
        sensitivity: declaration.sensitivity,
        allowedPurposeIds: declaration.allowedPurposeIds,
        canonicalAnchorId,
        retentionRequirement: {
          kind: "declared_rule_set",
          ruleRefs: declaration.retentionRuleRefs
        },
        allowedExpiryActions: declaration.allowedExpiryActions,
        immediateTerminalPurge: declaration.immediateTerminalPurge,
        parentBehavior: declaration.parentBehavior,
        subjectLinkBehavior: declaration.subjectLinkBehavior,
        exportBehavior: declaration.exportBehavior,
        holdEligible: declaration.holdEligible
      });
      dataClasses.push({
        id: String(declaration.id),
        definition,
        owner: String(payload.moduleId)
      });
      coreClassById.set(String(declaration.id), dataClasses.at(-1)!);
    }
  }

  assertUniqueRegistryIds(dataClasses, "data class");
  const classById = new Map(dataClasses.map((entry) => [entry.id, entry]));
  const backupClassIds = new Set<string>([
    "core:backup_copy_or_object_version",
    ...moduleContributions.flatMap((contribution) =>
      contribution.payload.dataClasses
        .filter(
          (declaration) =>
            String(declaration.parentCoreClassId) ===
            "core:backup_copy_or_object_version"
        )
        .map((declaration) => String(declaration.id))
    )
  ]);

  for (const contribution of moduleContributions) {
    for (const declaration of contribution.payload.retentionRules) {
      assertOwnedByModule(
        declaration.id,
        contribution.payload.moduleId,
        "retention rule"
      );
      retentionRules.push({
        ...declaration,
        owner: String(contribution.payload.moduleId)
      });
    }
  }
  assertUniqueRegistryIds(retentionRules, "retention rule");
  const retentionRuleById = new Map(
    retentionRules.map((entry) => [entry.id, entry])
  );

  for (const contribution of moduleContributions) {
    validateModuleRetentionRules({
      contribution,
      classById,
      purposeById,
      anchorById,
      rootById,
      handlerById,
      retentionRuleById
    });
  }

  const useKeys = new Set<string>();
  for (const use of dataUses) {
    const key = `${use.dataClassId}\u0000${use.storageRootId}`;
    if (useKeys.has(key)) {
      throw new Error(
        `Duplicate data use for ${use.dataClassId} at ${use.storageRootId}.`
      );
    }
    useKeys.add(key);
    validateDataUse({
      use,
      classById,
      purposeById,
      anchorById,
      rootById,
      handlerById,
      backupClassIds
    });
    const dataClass = requireEntry(classById, use.dataClassId, "data class");
    const root = requireEntry(rootById, use.storageRootId, "storage root");
    if (
      use.owner === "core" &&
      (dataClass.owner !== "core" || root.owner !== "core")
    ) {
      throw new Error(
        `Core data use ${use.dataClassId}/${use.storageRootId} must bind core-owned class and root.`
      );
    }
    if (
      use.owner !== "core" &&
      (root.owner !== use.owner ||
        (dataClass.owner !== "core" && dataClass.owner !== use.owner))
    ) {
      throw new Error(
        `Module data use ${use.dataClassId}/${use.storageRootId} crosses its ownership boundary.`
      );
    }
  }

  for (const root of storageRoots) {
    if (!dataUses.some((use) => use.storageRootId === root.id)) {
      throw new Error(`Storage root ${root.id} has no registered data use.`);
    }
  }

  for (const contribution of moduleContributions) {
    validateModuleContribution({
      contribution,
      classById,
      purposeById,
      anchorById,
      rootById,
      handlerById
    });
  }

  const registryContent = {
    schemaVersion: INBOX_V2_INITIAL_SCHEMA_VERSION,
    dataClasses,
    processingPurposes,
    retentionRules,
    retentionAnchors,
    storageRoots,
    handlers,
    dataUses,
    moduleContributions
  };
  const registry = cloneAndFreeze({
    ...registryContent,
    compositionHash:
      calculateInboxV2DataLifecycleRegistryCompositionHash(registryContent)
  });
  definedInboxV2DataLifecycleRegistries.add(registry);
  return registry;
}

/**
 * Pins the exact executable registry composition used by lifecycle policy.
 * Array order supplied by composition roots is deliberately normalized so the
 * same set of reviewed registrations has one deterministic digest.
 */
export function calculateInboxV2DataLifecycleRegistryCompositionHash(input: {
  schemaVersion: string;
  dataClasses: readonly RegistryEntry<unknown>[];
  processingPurposes: readonly RegistryEntry<unknown>[];
  retentionRules: readonly RegistryEntry<unknown>[];
  retentionAnchors: readonly RegistryEntry<unknown>[];
  storageRoots: readonly RegistryEntry<unknown>[];
  handlers: readonly RegistryEntry<unknown>[];
  dataUses: readonly (InboxV2ModuleDataUse & { owner: string })[];
  moduleContributions: readonly InboxV2ModuleDataGovernanceContribution[];
}): InboxV2Sha256Digest {
  const byRegistryEntry = (
    left: RegistryEntry<unknown>,
    right: RegistryEntry<unknown>
  ) =>
    `${left.owner}\u0000${left.id}`.localeCompare(
      `${right.owner}\u0000${right.id}`
    );
  const byDataUse = (
    left: InboxV2ModuleDataUse & { owner: string },
    right: InboxV2ModuleDataUse & { owner: string }
  ) =>
    `${left.owner}\u0000${left.dataClassId}\u0000${left.storageRootId}`.localeCompare(
      `${right.owner}\u0000${right.dataClassId}\u0000${right.storageRootId}`
    );
  const byContribution = (
    left: InboxV2ModuleDataGovernanceContribution,
    right: InboxV2ModuleDataGovernanceContribution
  ) =>
    String(left.payload.moduleId).localeCompare(String(right.payload.moduleId));
  return calculateInboxV2CanonicalSha256({
    domain: "core:inbox-v2.data-lifecycle-registry-composition",
    hashVersion: "v1",
    schemaVersion: input.schemaVersion,
    dataClasses: [...input.dataClasses].sort(byRegistryEntry),
    processingPurposes: [...input.processingPurposes].sort(byRegistryEntry),
    retentionRules: [...input.retentionRules].sort(byRegistryEntry),
    retentionAnchors: [...input.retentionAnchors].sort(byRegistryEntry),
    storageRoots: [...input.storageRoots].sort(byRegistryEntry),
    handlers: [...input.handlers].sort(byRegistryEntry),
    dataUses: [...input.dataUses].sort(byDataUse),
    moduleContributions: [...input.moduleContributions].sort(byContribution)
  });
}

function validateModuleDataClassCompatibility(input: {
  declaration: InboxV2ModuleDataClassDeclaration;
  parent: InboxV2DataClassDefinition;
  moduleId: string;
  purposeById: Map<string, RegistryEntry<InboxV2ProcessingPurposeDefinition>>;
}): void {
  const { declaration, parent } = input;
  for (const purposeId of declaration.allowedPurposeIds) {
    const purpose = requireEntry(
      input.purposeById,
      purposeId,
      "processing purpose"
    );
    const parentPurposeId =
      purpose.owner === "core"
        ? purpose.id
        : purpose.definition.parentCorePurposeId;
    if (
      (purpose.owner !== "core" && purpose.owner !== input.moduleId) ||
      parentPurposeId === null ||
      !parent.allowedPurposeIds.some(
        (allowedPurposeId) => String(allowedPurposeId) === parentPurposeId
      )
    ) {
      throw new Error(
        `Module data class ${declaration.id} purpose ${purposeId} is not allowed by parent ${declaration.parentCoreClassId} safety ceiling.`
      );
    }
  }
  for (const action of declaration.allowedExpiryActions) {
    if (!parent.allowedExpiryActions.includes(action)) {
      throw new Error(
        `Module data class ${declaration.id} expiry action ${action} is not allowed by parent ${declaration.parentCoreClassId}.`
      );
    }
  }
  for (const [field, actual, expected] of [
    ["parentBehavior", declaration.parentBehavior, parent.parentBehavior],
    ["sensitivity", declaration.sensitivity, parent.sensitivity],
    [
      "subjectLinkBehavior",
      declaration.subjectLinkBehavior,
      parent.subjectLinkBehavior
    ],
    ["exportBehavior", declaration.exportBehavior, parent.exportBehavior],
    ["holdEligible", declaration.holdEligible, parent.holdEligible]
  ] as const) {
    if (actual !== expected) {
      throw new Error(
        `Module data class ${declaration.id} cannot weaken parent ${field}; expected ${String(expected)}.`
      );
    }
  }
  if (parent.immediateTerminalPurge && !declaration.immediateTerminalPurge) {
    throw new Error(
      `Module data class ${declaration.id} cannot disable parent immediate terminal purge.`
    );
  }
}

function validateModuleRetentionRules(input: {
  contribution: InboxV2ModuleDataGovernanceContribution;
  classById: Map<string, RegistryEntry<InboxV2DataClassDefinition>>;
  purposeById: Map<string, RegistryEntry<InboxV2ProcessingPurposeDefinition>>;
  anchorById: Map<
    string,
    RegistryEntry<z.infer<typeof inboxV2CanonicalAnchorDefinitionSchema>>
  >;
  rootById: Map<string, RegistryEntry<InboxV2StorageRootDefinition>>;
  handlerById: Map<string, RegistryEntry<InboxV2LifecycleHandlerDefinition>>;
  retentionRuleById: Map<
    string,
    RegistryEntry<InboxV2ModuleRetentionRuleDeclaration["definition"]>
  >;
}): void {
  const payload = input.contribution.payload;
  const moduleId = String(payload.moduleId);
  const classDeclarations = new Map(
    payload.dataClasses.map((declaration) => [
      String(declaration.id),
      declaration
    ])
  );

  for (const rule of payload.retentionRules) {
    assertOwnedByModule(rule.id, moduleId, "retention rule");
    const definition = rule.definition;
    const dataClass = requireEntry(
      input.classById,
      definition.dataClassId,
      "retention-rule data class"
    );
    const classDeclaration = classDeclarations.get(
      String(definition.dataClassId)
    );
    if (dataClass.owner !== moduleId || classDeclaration === undefined) {
      throw new Error(
        `Module retention rule ${rule.id} must target an owning module data class.`
      );
    }
    const purpose = requireEntry(
      input.purposeById,
      definition.purposeId,
      "retention-rule processing purpose"
    );
    if (purpose.owner !== "core" && purpose.owner !== moduleId) {
      throw new Error(
        `Module retention rule ${rule.id} cannot reuse another module purpose.`
      );
    }
    if (
      !dataClass.definition.allowedPurposeIds.includes(definition.purposeId)
    ) {
      throw new Error(
        `Module retention rule ${rule.id} purpose is outside its data-class safety ceiling.`
      );
    }
    requireEntry(
      input.anchorById,
      definition.retentionAnchorId,
      "retention-rule canonical anchor"
    );
    if (
      definition.retentionAnchorId !== dataClass.definition.canonicalAnchorId
    ) {
      throw new Error(
        `Module retention rule ${rule.id} does not use its data-class canonical anchor.`
      );
    }
    if (
      !dataClass.definition.allowedExpiryActions.includes(
        definition.actionAtExpiry
      ) ||
      definition.holdEligible !== dataClass.definition.holdEligible
    ) {
      throw new Error(
        `Module retention rule ${rule.id} weakens expiry action or hold semantics.`
      );
    }
    if (
      (classDeclaration.parentBehavior === "inherits_all_live_parents") !==
      (definition.baselineWindow.kind === "inherits_all_live_parents")
    ) {
      throw new Error(
        `Module retention rule ${rule.id} has an incompatible finite/parent retention window.`
      );
    }

    for (const [actual, expected, label] of [
      [
        definition.lifecycleHandlerId,
        classDeclaration.lifecycleHandlerId,
        "lifecycle"
      ],
      [definition.deleteHandlerId, classDeclaration.deleteHandlerId, "delete"],
      [
        definition.verificationHandlerId,
        classDeclaration.verificationHandlerId,
        "verification"
      ]
    ] as const) {
      if (actual !== expected) {
        throw new Error(
          `Module retention rule ${rule.id} does not bind the declared ${label} handler.`
        );
      }
      assertOwnedByModule(actual, moduleId, `${label} handler`);
    }

    const rootKinds = classDeclaration.storageRootIds.map(
      (rootId) =>
        requireEntry(input.rootById, rootId, "storage root").definition.kind
    );
    requireHandlerForEveryRoot(
      input.handlerById,
      definition.lifecycleHandlerId,
      "lifecycle",
      rootKinds
    );
    requireHandlerForEveryRoot(
      input.handlerById,
      definition.deleteHandlerId,
      "delete_execution",
      rootKinds
    );
    const verification = requireHandlerForEveryRoot(
      input.handlerById,
      definition.verificationHandlerId,
      "verification",
      rootKinds
    );
    if (!verification.definition.verifiesAbsence) {
      throw new Error(
        `Module retention rule ${rule.id} requires an absence-verifying handler.`
      );
    }
    if (definition.baselineWindow.kind === "until_condition_then_period") {
      requireHandler(
        input.handlerById,
        definition.baselineWindow.condition.resolverHandlerId,
        "condition_resolution",
        undefined,
        ["read"]
      );
    }

    const matchingRef = classDeclaration.retentionRuleRefs.find(
      (reference) => String(reference.id) === String(rule.id)
    );
    if (
      matchingRef === undefined ||
      matchingRef.revision !== definition.revision
    ) {
      throw new Error(
        `Module retention rule ${rule.id} is not pinned by its data class at the exact revision.`
      );
    }
  }

  for (const classDeclaration of payload.dataClasses) {
    const rules = payload.retentionRules.filter(
      (rule) => rule.definition.dataClassId === classDeclaration.id
    );
    if (rules.length !== classDeclaration.allowedPurposeIds.length) {
      throw new Error(
        `Module data class ${classDeclaration.id} requires exactly one finite retention rule per purpose.`
      );
    }
    for (const purposeId of classDeclaration.allowedPurposeIds) {
      const matchingRules = rules.filter(
        (rule) => rule.definition.purposeId === purposeId
      );
      if (matchingRules.length !== 1) {
        throw new Error(
          `Module data class ${classDeclaration.id} purpose ${purposeId} requires exactly one finite retention rule.`
        );
      }
      if (
        !payload.dataUses.some(
          (use) =>
            use.dataClassId === classDeclaration.id &&
            use.purposeIds.includes(purposeId)
        )
      ) {
        throw new Error(
          `Module data class ${classDeclaration.id} purpose ${purposeId} has no executable data use.`
        );
      }
    }
    if (classDeclaration.retentionRuleRefs.length !== rules.length) {
      throw new Error(
        `Module data class ${classDeclaration.id} retention-rule references are not exact.`
      );
    }
    for (const reference of classDeclaration.retentionRuleRefs) {
      const registered = requireEntry(
        input.retentionRuleById,
        reference.id,
        "retention rule"
      );
      if (
        registered.owner !== moduleId ||
        registered.definition.revision !== reference.revision ||
        registered.definition.dataClassId !== classDeclaration.id
      ) {
        throw new Error(
          `Module data class ${classDeclaration.id} retention-rule reference is stale or foreign.`
        );
      }
    }
  }

  for (const purpose of payload.processingPurposes) {
    const attached = payload.retentionRules.some(
      (rule) => rule.definition.purposeId === purpose.id
    );
    if (!attached) {
      throw new Error(
        `Module processing purpose ${purpose.id} has no finite rule/class attachment.`
      );
    }
  }
}

function validateDataUse(input: {
  use: InboxV2RegisteredDataUse;
  classById: Map<string, RegistryEntry<InboxV2DataClassDefinition>>;
  purposeById: Map<string, RegistryEntry<InboxV2ProcessingPurposeDefinition>>;
  anchorById: Map<
    string,
    RegistryEntry<z.infer<typeof inboxV2CanonicalAnchorDefinitionSchema>>
  >;
  rootById: Map<string, RegistryEntry<InboxV2StorageRootDefinition>>;
  handlerById: Map<string, RegistryEntry<InboxV2LifecycleHandlerDefinition>>;
  backupClassIds: ReadonlySet<string>;
}): void {
  const { use } = input;
  const dataClass = requireEntry(
    input.classById,
    use.dataClassId,
    "data class"
  );
  const root = requireEntry(input.rootById, use.storageRootId, "storage root");
  if (
    input.backupClassIds.has(String(use.dataClassId)) !==
    (root.definition.kind === "backup")
  ) {
    throw new Error(
      `Backup data class and backup storage-root semantics must be declared together for ${use.dataClassId}/${use.storageRootId}.`
    );
  }
  requireEntry(input.anchorById, use.canonicalAnchorId, "canonical anchor");
  if (use.canonicalAnchorId !== dataClass.definition.canonicalAnchorId) {
    throw new Error(
      `Data use ${use.dataClassId}/${use.storageRootId} does not use its canonical anchor.`
    );
  }
  for (const purposeId of use.purposeIds) {
    const purpose = requireEntry(
      input.purposeById,
      purposeId,
      "processing purpose"
    );
    if (!dataClass.definition.allowedPurposeIds.includes(purposeId)) {
      throw new Error(
        `Data use purpose ${purposeId} is not allowed for ${use.dataClassId}.`
      );
    }
    if (
      purpose.owner !== "core" &&
      (purpose.owner !== use.owner || dataClass.owner !== use.owner)
    ) {
      throw new Error(
        `Module processing purpose ${purposeId} may only be used by its owning module class.`
      );
    }
  }
  const transmits = use.operations.includes("transmit_external");
  if (transmits !== (root.definition.kind === "external_route")) {
    throw new Error(
      `External transmission and external_route root must be declared together for ${use.dataClassId}.`
    );
  }
  if (
    transmits &&
    use.operations.some((operation) => operation !== "transmit_external")
  ) {
    throw new Error(
      `External data use ${use.dataClassId}/${use.storageRootId} may only declare transmit_external.`
    );
  }

  const subjectBearing = dataClass.definition.subjectLinkBehavior !== "none";
  if (subjectBearing !== (use.subjectDiscoveryHandlerId !== null)) {
    throw new Error(
      `Data use ${use.dataClassId}/${use.storageRootId} has incomplete subject-discovery coverage.`
    );
  }

  const exportsData = use.operations.includes("export");
  const projectsExport = use.exportProjectionHandlerId !== null;
  const executesExport = use.exportHandlerId !== null;
  if (
    dataClass.definition.sensitivity === "secret" &&
    (exportsData || projectsExport || executesExport || transmits)
  ) {
    throw new Error(`Secret data class ${use.dataClassId} cannot be exported.`);
  }
  if (
    dataClass.definition.exportBehavior === "never" &&
    (exportsData || projectsExport || executesExport)
  ) {
    throw new Error(
      `Data class ${use.dataClassId} is not eligible for export.`
    );
  }
  if (transmits && (exportsData || projectsExport || executesExport)) {
    throw new Error(
      `External data use ${use.dataClassId}/${use.storageRootId} cannot declare a local export pipeline.`
    );
  }

  const locallyMaterialized =
    !transmits &&
    (use.operations.includes("persist") || use.operations.includes("derive"));
  if (
    locallyMaterialized &&
    (!use.operations.includes("delete") ||
      !use.operations.includes("verify_absence") ||
      use.deleteHandlerId === null ||
      use.verificationHandlerId === null)
  ) {
    throw new Error(
      `Locally materialized data use ${use.dataClassId}/${use.storageRootId} requires delete and absence-verification coverage.`
    );
  }
  if (
    locallyMaterialized &&
    dataClass.definition.exportBehavior !== "never" &&
    (!exportsData || !projectsExport || !executesExport)
  ) {
    throw new Error(
      `Exportable local data use ${use.dataClassId}/${use.storageRootId} requires export projection and execution coverage.`
    );
  }

  requireHandler(
    input.handlerById,
    use.lifecycleHandlerId,
    "lifecycle",
    root.definition.kind,
    use.operations
  );
  if (use.subjectDiscoveryHandlerId !== null) {
    requireHandler(
      input.handlerById,
      use.subjectDiscoveryHandlerId,
      "subject_discovery",
      root.definition.kind,
      ["read"]
    );
  }
  if (use.exportProjectionHandlerId !== null) {
    requireHandler(
      input.handlerById,
      use.exportProjectionHandlerId,
      "export_projection",
      root.definition.kind,
      ["export"]
    );
  }
  if (use.exportHandlerId !== null) {
    requireHandler(
      input.handlerById,
      use.exportHandlerId,
      "export_execution",
      root.definition.kind,
      ["export"]
    );
  }
  if (use.deleteHandlerId !== null) {
    requireHandler(
      input.handlerById,
      use.deleteHandlerId,
      "delete_execution",
      root.definition.kind,
      ["delete"]
    );
  }
  if (use.verificationHandlerId !== null) {
    const handler = requireHandler(
      input.handlerById,
      use.verificationHandlerId,
      "verification",
      root.definition.kind,
      ["verify_absence"]
    );
    if (!handler.definition.verifiesAbsence) {
      throw new Error(
        `Verification handler ${use.verificationHandlerId} does not verify absence.`
      );
    }
  }
}

function validateModuleContribution(input: {
  contribution: InboxV2ModuleDataGovernanceContribution;
  classById: Map<string, RegistryEntry<InboxV2DataClassDefinition>>;
  purposeById: Map<string, RegistryEntry<InboxV2ProcessingPurposeDefinition>>;
  anchorById: Map<
    string,
    RegistryEntry<z.infer<typeof inboxV2CanonicalAnchorDefinitionSchema>>
  >;
  rootById: Map<string, RegistryEntry<InboxV2StorageRootDefinition>>;
  handlerById: Map<string, RegistryEntry<InboxV2LifecycleHandlerDefinition>>;
}): void {
  const payload = input.contribution.payload;
  assertOwnedByModule(
    payload.migrationAndUninstallHandlerId,
    payload.moduleId,
    "migration/uninstall handler"
  );
  const migrationAndUninstallHandler = requireHandler(
    input.handlerById,
    payload.migrationAndUninstallHandlerId,
    "migration_uninstall",
    undefined,
    undefined
  );
  if (!migrationAndUninstallHandler.definition.checksHoldFence) {
    throw new Error(
      `Migration/uninstall handler ${payload.migrationAndUninstallHandlerId} must check the hold fence.`
    );
  }

  const useKeys = new Set<string>();
  for (const use of payload.dataUses) {
    const key = `${use.dataClassId}\u0000${use.storageRootId}`;
    if (useKeys.has(key)) {
      throw new Error(
        `Duplicate module data use for ${use.dataClassId} at ${use.storageRootId}.`
      );
    }
    useKeys.add(key);
    for (const [handlerId, label] of [
      [use.lifecycleHandlerId, "lifecycle"],
      [use.subjectDiscoveryHandlerId, "subject-discovery"],
      [use.exportProjectionHandlerId, "export-projection"],
      [use.exportHandlerId, "export-execution"],
      [use.deleteHandlerId, "delete-execution"],
      [use.verificationHandlerId, "verification"]
    ] as const) {
      if (handlerId !== null) {
        assertOwnedByModule(handlerId, payload.moduleId, `${label} handler`);
      }
    }
  }

  for (const root of payload.storageRoots) {
    const rootUses = payload.dataUses.filter(
      (use) => use.storageRootId === root.id
    );
    if (rootUses.length === 0) {
      throw new Error(`Module storage root ${root.id} has no data use.`);
    }
    if (
      root.definition.kind !== "external_route" &&
      rootUses.some(
        (use) =>
          !use.operations.includes("persist") &&
          !use.operations.includes("derive")
      )
    ) {
      throw new Error(
        `Local module storage root ${root.id} cannot declare a read-only data use.`
      );
    }
  }

  for (const declaration of payload.dataClasses) {
    for (const [handlerId, label] of [
      [declaration.lifecycleHandlerId, "class lifecycle"],
      [declaration.subjectDiscoveryHandlerId, "class subject-discovery"],
      [declaration.exportProjectionHandlerId, "class export-projection"],
      [declaration.exportHandlerId, "class export-execution"],
      [declaration.deleteHandlerId, "class delete-execution"],
      [declaration.verificationHandlerId, "class verification"]
    ] as const) {
      if (handlerId !== null) {
        assertOwnedByModule(handlerId, payload.moduleId, `${label} handler`);
      }
    }
    const rootKinds = declaration.storageRootIds.map(
      (rootId) =>
        requireEntry(input.rootById, rootId, "storage root").definition.kind
    );
    requireHandlerForEveryRoot(
      input.handlerById,
      declaration.lifecycleHandlerId,
      "lifecycle",
      rootKinds
    );
    requireHandlerForEveryRoot(
      input.handlerById,
      declaration.deleteHandlerId,
      "delete_execution",
      rootKinds
    );
    const verification = requireHandlerForEveryRoot(
      input.handlerById,
      declaration.verificationHandlerId,
      "verification",
      rootKinds
    );
    if (!verification.definition.verifiesAbsence) {
      throw new Error(
        `Verification handler ${declaration.verificationHandlerId} does not verify absence.`
      );
    }
    if (declaration.subjectDiscoveryHandlerId !== null) {
      requireHandlerForEveryRoot(
        input.handlerById,
        declaration.subjectDiscoveryHandlerId,
        "subject_discovery",
        rootKinds
      );
    }
    if (declaration.exportProjectionHandlerId !== null) {
      requireHandlerForEveryRoot(
        input.handlerById,
        declaration.exportProjectionHandlerId,
        "export_projection",
        rootKinds
      );
    }
    if (declaration.exportHandlerId !== null) {
      requireHandlerForEveryRoot(
        input.handlerById,
        declaration.exportHandlerId,
        "export_execution",
        rootKinds
      );
    }
    for (const rootId of declaration.storageRootIds) {
      const use = payload.dataUses.find(
        (candidate) =>
          candidate.dataClassId === declaration.id &&
          candidate.storageRootId === rootId
      );
      if (
        use === undefined ||
        (!use.operations.includes("persist") &&
          !use.operations.includes("derive")) ||
        !use.operations.includes("delete")
      ) {
        throw new Error(
          `Module data class ${declaration.id} lacks persist/derive plus delete lineage for root ${rootId}.`
        );
      }
      for (const [field, expected] of [
        ["lifecycleHandlerId", declaration.lifecycleHandlerId],
        ["subjectDiscoveryHandlerId", declaration.subjectDiscoveryHandlerId],
        ["exportProjectionHandlerId", declaration.exportProjectionHandlerId],
        ["exportHandlerId", declaration.exportHandlerId],
        ["deleteHandlerId", declaration.deleteHandlerId],
        ["verificationHandlerId", declaration.verificationHandlerId]
      ] as const) {
        if (use[field] !== expected) {
          throw new Error(
            `Module data class ${declaration.id} use at ${rootId} does not match declared ${field}.`
          );
        }
      }
    }
  }

  const routeIds = new Set<string>();
  for (const route of payload.externalRoutes) {
    assertOwnedByModule(route.id, payload.moduleId, "external route");
    assertOwnedByModule(
      route.deleteCapabilityHandlerId,
      payload.moduleId,
      "external deletion handler"
    );
    if (routeIds.has(String(route.id))) {
      throw new Error(`Duplicate external route ${route.id}.`);
    }
    routeIds.add(String(route.id));
    const root = requireEntry(
      input.rootById,
      route.storageRootId,
      "external route root"
    );
    if (
      root.definition.kind !== "external_route" ||
      root.definition.boundary !== "outside_operated_data_plane"
    ) {
      throw new Error(
        `External route ${route.id} must use an outside-operated external root.`
      );
    }
    requireEntry(input.purposeById, route.purposeId, "processing purpose");
    requireHandler(
      input.handlerById,
      route.deleteCapabilityHandlerId,
      "external_deletion",
      "external_route",
      ["transmit_external"]
    );
    for (const dataClassId of route.dataClassIds) {
      requireEntry(input.classById, dataClassId, "external route data class");
      const use = payload.dataUses.find(
        (candidate) =>
          candidate.dataClassId === dataClassId &&
          candidate.storageRootId === route.storageRootId
      );
      if (
        use === undefined ||
        !use.operations.includes("transmit_external") ||
        !use.purposeIds.includes(route.purposeId)
      ) {
        throw new Error(
          `External route ${route.id} lacks matching transmit_external lineage for ${dataClassId}.`
        );
      }
    }
  }

  for (const use of payload.dataUses.filter((item) =>
    item.operations.includes("transmit_external")
  )) {
    if (
      !payload.externalRoutes.some(
        (route) =>
          route.storageRootId === use.storageRootId &&
          route.dataClassIds.includes(use.dataClassId) &&
          use.purposeIds.includes(route.purposeId)
      )
    ) {
      throw new Error(
        `External data use ${use.dataClassId}/${use.storageRootId} lacks an external route declaration.`
      );
    }
  }
}

function requireHandlerForEveryRoot(
  handlers: Map<string, RegistryEntry<InboxV2LifecycleHandlerDefinition>>,
  handlerId: string,
  kind: z.infer<typeof inboxV2LifecycleHandlerKindSchema>,
  rootKinds: readonly z.infer<typeof inboxV2StorageRootKindSchema>[]
): RegistryEntry<InboxV2LifecycleHandlerDefinition> {
  const handler = requireHandler(
    handlers,
    handlerId,
    kind,
    undefined,
    undefined
  );
  for (const rootKind of rootKinds) {
    if (!handler.definition.supportedRootKinds.includes(rootKind)) {
      throw new Error(
        `Handler ${handlerId} is incompatible with root kind ${rootKind}.`
      );
    }
  }
  return handler;
}

function requireHandler(
  handlers: Map<string, RegistryEntry<InboxV2LifecycleHandlerDefinition>>,
  handlerId: string,
  kind: z.infer<typeof inboxV2LifecycleHandlerKindSchema>,
  rootKind: z.infer<typeof inboxV2StorageRootKindSchema> | undefined,
  operations: readonly z.infer<typeof inboxV2DataOperationSchema>[] | undefined
): RegistryEntry<InboxV2LifecycleHandlerDefinition> {
  const handler = requireEntry(handlers, handlerId, "lifecycle handler");
  if (handler.definition.kind !== kind) {
    throw new Error(`Handler ${handlerId} is not a ${kind} handler.`);
  }
  if (
    rootKind !== undefined &&
    !handler.definition.supportedRootKinds.includes(rootKind)
  ) {
    throw new Error(`Handler ${handlerId} does not support ${rootKind}.`);
  }
  for (const operation of operations ?? []) {
    if (!handler.definition.supportedOperations.includes(operation)) {
      throw new Error(
        `Handler ${handlerId} does not support operation ${operation}.`
      );
    }
  }
  return handler;
}

function requireEntry<TEntry extends RegistryEntry<unknown>>(
  entries: Map<string, TEntry>,
  id: string,
  label: string
): TEntry {
  const entry = entries.get(String(id));
  if (entry === undefined) {
    throw new Error(`Unknown Inbox V2 ${label}: ${id}.`);
  }
  return entry;
}

function assertUniqueRegistryIds(
  entries: readonly RegistryEntry<unknown>[],
  label: string
): void {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.id)) {
      throw new Error(`Duplicate Inbox V2 ${label}: ${entry.id}.`);
    }
    seen.add(entry.id);
  }
}

function assertOwnedByModule(
  id: string,
  moduleId: string,
  label: string
): void {
  const parts = parseInboxV2NamespacedId(String(id));
  if (!("moduleId" in parts) || parts.moduleId !== moduleId) {
    throw new Error(
      `Module ${moduleId} ${label} ${id} must use its own namespace.`
    );
  }
}

function assertCoreId(id: string, label: string): void {
  if (parseInboxV2NamespacedId(String(id)).namespace !== "core") {
    throw new Error(`${label} ${id} must reference the core catalog.`);
  }
}

function addDuplicateIssues<TValue extends string>(
  values: readonly TValue[],
  context: z.RefinementCtx
): void {
  const seen = new Set<string>();
  for (const [index, value] of values.entries()) {
    if (seen.has(value)) {
      context.addIssue({
        code: "custom",
        path: [index],
        message: `Duplicate value: ${value}.`
      });
    }
    seen.add(value);
  }
}

function addCanonicalRuleReferenceIssues(
  values: readonly Readonly<{ id: string; revision: string }>[],
  context: z.RefinementCtx
): void {
  const keys = values.map(
    (reference) => `${reference.id}\u0000${reference.revision}`
  );
  const seen = new Set<string>();
  for (const [index, key] of keys.entries()) {
    if (seen.has(key)) {
      context.addIssue({
        code: "custom",
        path: [index],
        message: `Duplicate retention-rule reference: ${key}.`
      });
    }
    seen.add(key);
  }
  const sorted = [...keys].sort((left, right) => left.localeCompare(right));
  for (const [index, key] of keys.entries()) {
    if (key !== sorted[index]) {
      context.addIssue({
        code: "custom",
        path: [index],
        message: "Retention-rule references must be in canonical order."
      });
      break;
    }
  }
}

function addDuplicateObjectIdIssues(
  values: readonly Readonly<{ id: string }>[],
  context: z.RefinementCtx,
  path: readonly (string | number)[]
): void {
  const seen = new Set<string>();
  for (const [index, value] of values.entries()) {
    if (seen.has(value.id)) {
      context.addIssue({
        code: "custom",
        path: [...path, index, "id"],
        message: `Duplicate declaration: ${value.id}.`
      });
    }
    seen.add(value.id);
  }
}

function addIssue(
  context: z.RefinementCtx,
  path: readonly (string | number)[],
  message: string
): void {
  context.addIssue({ code: "custom", path: [...path], message });
}

function cloneAndFreeze<TValue>(value: TValue): InboxV2DeepReadonly<TValue> {
  if (value === null || typeof value !== "object") {
    return value as InboxV2DeepReadonly<TValue>;
  }
  if (Array.isArray(value)) {
    return Object.freeze(
      value.map((item) => cloneAndFreeze(item))
    ) as InboxV2DeepReadonly<TValue>;
  }
  const clone: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    clone[key] = cloneAndFreeze(item);
  }
  return Object.freeze(clone) as InboxV2DeepReadonly<TValue>;
}
