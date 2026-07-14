import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  defineInboxV2DataLifecycleRegistry,
  INBOX_V2_CORE_DATA_CLASS_CATALOG,
  INBOX_V2_CORE_PROCESSING_PURPOSE_CATALOG,
  INBOX_V2_CORE_RETENTION_ANCHOR_CATALOG,
  inboxV2CoreDataUseRegistrationSchema,
  inboxV2DataClassDefinitionSchema,
  inboxV2ModuleDataUseSchema,
  inboxV2ModuleDataGovernanceContributionSchema,
  inboxV2StorageRootDefinitionSchema
} from "./data-lifecycle-catalog";

const EXPECTED_CORE_DATA_CLASS_IDS = [
  "core:raw_event_envelope",
  "core:raw_provider_payload",
  "core:raw_provider_allowed_headers",
  "core:normalized_event_envelope",
  "core:normalized_event_payload",
  "core:source_delivery_dedupe_skeleton",
  "core:domain_event_commit_envelope",
  "core:domain_event_content_or_evidence_ref",
  "core:outbox_dispatch_envelope",
  "core:outbox_webhook_dispatch_body",
  "core:replay_sync_delta",
  "core:timeline_item_envelope",
  "core:message_content_blocks",
  "core:staff_note_content_blocks",
  "core:timeline_tombstone",
  "core:source_account_identity_and_alias",
  "core:external_thread_identity_and_alias",
  "core:source_thread_binding",
  "core:source_occurrence_and_external_reference",
  "core:outbound_route_and_policy",
  "core:outbound_dispatch_attempt_and_artifact",
  "core:outbound_dispatch_reconciliation",
  "core:conversation_state",
  "core:work_item_state",
  "core:work_assignment_history",
  "core:employee_conversation_read_state",
  "core:participant_membership",
  "core:source_external_identity",
  "core:client_contact_profile",
  "core:crm_value_and_history",
  "core:conversation_client_link_history",
  "core:client_merge_node_state",
  "core:client_merge_redirect_history",
  "core:file_metadata",
  "core:file_original_binary",
  "core:file_derived_binary",
  "core:call_metadata",
  "core:call_recording",
  "core:call_transcript",
  "core:ai_prompt_output_embedding",
  "core:notification_endpoint",
  "core:notification_preview_payload",
  "core:notification_feed_delivery",
  "core:analytics_person_fact",
  "core:analytics_subject_bridge",
  "core:analytics_anonymous_rollup",
  "core:domain_audit_skeleton",
  "core:privileged_security_audit_skeleton",
  "core:security_denial_signal",
  "core:platform_audit_skeleton",
  "core:privacy_sensitive_evidence",
  "core:external_deletion_residual_evidence",
  "core:export_partial_artifact",
  "core:export_ready_artifact",
  "core:export_manifest_evidence",
  "core:operational_log_trace_diagnostic",
  "core:support_bundle",
  "core:auth_credential_session_challenge_secret",
  "core:auth_security_outcome",
  "core:source_account_connector_metadata",
  "core:access_grant_invitation_membership_history",
  "core:webhook_config_and_delivery_metadata",
  "core:usage_billing_entitlement_fact",
  "core:tenant_brand_asset",
  "core:backup_copy_or_object_version",
  "core:erasure_hold_restore_ledger"
] as const;

const EXPECTED_CORE_PURPOSE_IDS = [
  "core:communication_delivery",
  "core:customer_service_history",
  "core:work_management",
  "core:crm_relationship",
  "core:source_replay_and_diagnostics",
  "core:security_and_fraud_prevention",
  "core:contract_and_billing_evidence",
  "core:legal_claim_or_regulatory_duty",
  "core:product_notification",
  "core:manager_reporting",
  "core:ai_or_transcription",
  "core:data_subject_request_execution"
] as const;

type ModuleContributionInput = z.input<
  typeof inboxV2ModuleDataGovernanceContributionSchema
>;

function catalogDigest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function handler(
  kind: ModuleContributionInput["payload"]["handlers"][number]["definition"]["kind"],
  supportedOperations: ModuleContributionInput["payload"]["handlers"][number]["definition"]["supportedOperations"],
  input?: { verifiesAbsence?: boolean }
): ModuleContributionInput["payload"]["handlers"][number]["definition"] {
  return {
    kind,
    supportedRootKinds: ["object"],
    supportedOperations,
    bounded: true,
    idempotent: true,
    checksTenantFence: true,
    checksRevisionFence: true,
    checksHoldFence: true,
    verifiesAbsence: input?.verifiesAbsence ?? false
  };
}

function validModuleContribution(): ModuleContributionInput {
  return {
    schemaId: "core:inbox-v2.module-data-governance",
    schemaVersion: "v1",
    payload: {
      moduleId: "sample-source",
      dataHandling: "tenant_or_customer_data",
      processingPurposes: [],
      retentionRules: [
        {
          id: "module:sample-source:provider-media-delivery-rule",
          definition: {
            revision: "1",
            dataClassId: "module:sample-source:provider-media",
            purposeId: "core:communication_delivery",
            retentionAnchorId: "core:all_parent_links_and_purposes_end",
            baselineWindow: {
              kind: "inherits_all_live_parents",
              maximumAdditionalPeriod: {
                kind: "elapsed",
                seconds: 86_400
              }
            },
            actionAtExpiry: "hard_delete",
            backupMaximum: { kind: "elapsed", seconds: 3_024_000 },
            holdEligible: true,
            lifecycleHandlerId: "module:sample-source:lifecycle",
            deleteHandlerId: "module:sample-source:delete-execution",
            verificationHandlerId: "module:sample-source:verification"
          }
        }
      ],
      retentionAnchors: [],
      handlers: [
        {
          id: "module:sample-source:lifecycle",
          definition: handler("lifecycle", [
            "persist",
            "export",
            "delete",
            "verify_absence"
          ])
        },
        {
          id: "module:sample-source:subject-discovery",
          definition: handler("subject_discovery", ["read"])
        },
        {
          id: "module:sample-source:export-projection",
          definition: handler("export_projection", ["export"])
        },
        {
          id: "module:sample-source:export-execution",
          definition: handler("export_execution", ["export"])
        },
        {
          id: "module:sample-source:delete-execution",
          definition: handler("delete_execution", ["delete"])
        },
        {
          id: "module:sample-source:verification",
          definition: handler("verification", ["verify_absence"], {
            verifiesAbsence: true
          })
        },
        {
          id: "module:sample-source:migration-uninstall",
          definition: handler("migration_uninstall", ["delete"])
        }
      ],
      storageRoots: [
        {
          id: "module:sample-source:file-object",
          definition: {
            kind: "object",
            boundary: "operated_data_plane",
            tenantIsolation: "required",
            versionEnumeration: "supported",
            configurationProfileId: "core:development-storage-profile"
          }
        }
      ],
      dataClasses: [
        {
          id: "module:sample-source:provider-media",
          parentCoreClassId: "core:file_original_binary",
          storageRootIds: ["module:sample-source:file-object"],
          sensitivity: "restricted_content",
          allowedPurposeIds: ["core:communication_delivery"],
          parentBehavior: "inherits_all_live_parents",
          canonicalAnchorId: null,
          retentionRuleRefs: [
            {
              id: "module:sample-source:provider-media-delivery-rule",
              revision: "1"
            }
          ],
          subjectLinkBehavior: "discovery_candidates",
          exportBehavior: "authorized_projection",
          holdEligible: true,
          allowedExpiryActions: ["hard_delete"],
          immediateTerminalPurge: false,
          lifecycleHandlerId: "module:sample-source:lifecycle",
          subjectDiscoveryHandlerId: "module:sample-source:subject-discovery",
          exportProjectionHandlerId: "module:sample-source:export-projection",
          exportHandlerId: "module:sample-source:export-execution",
          deleteHandlerId: "module:sample-source:delete-execution",
          verificationHandlerId: "module:sample-source:verification"
        }
      ],
      dataUses: [
        {
          dataClassId: "core:file_original_binary",
          storageRootId: "module:sample-source:file-object",
          purposeIds: ["core:communication_delivery"],
          operations: ["persist", "export", "delete", "verify_absence"],
          canonicalAnchorId: "core:all_parent_links_and_purposes_end",
          lifecycleHandlerId: "module:sample-source:lifecycle",
          subjectDiscoveryHandlerId: "module:sample-source:subject-discovery",
          exportProjectionHandlerId: "module:sample-source:export-projection",
          exportHandlerId: "module:sample-source:export-execution",
          deleteHandlerId: "module:sample-source:delete-execution",
          verificationHandlerId: "module:sample-source:verification"
        },
        {
          dataClassId: "module:sample-source:provider-media",
          storageRootId: "module:sample-source:file-object",
          purposeIds: ["core:communication_delivery"],
          operations: ["persist", "export", "delete", "verify_absence"],
          canonicalAnchorId: "core:all_parent_links_and_purposes_end",
          lifecycleHandlerId: "module:sample-source:lifecycle",
          subjectDiscoveryHandlerId: "module:sample-source:subject-discovery",
          exportProjectionHandlerId: "module:sample-source:export-projection",
          exportHandlerId: "module:sample-source:export-execution",
          deleteHandlerId: "module:sample-source:delete-execution",
          verificationHandlerId: "module:sample-source:verification"
        }
      ],
      externalRoutes: [],
      migrationAndUninstallHandlerId: "module:sample-source:migration-uninstall"
    }
  };
}

function validModulePurposeContribution(): ModuleContributionInput {
  const contribution = structuredClone(validModuleContribution());
  const purposeId = "module:sample-source:provider-ai-enrichment";
  const classId = "module:sample-source:provider-ai-output";
  const ruleId = "module:sample-source:provider-ai-output-rule";
  contribution.payload.processingPurposes = [
    {
      id: purposeId,
      definition: {
        responsibilityRoleRequired: true,
        subjectDiscoveryRequired: true,
        parentCorePurposeId: "core:ai_or_transcription"
      }
    }
  ];
  contribution.payload.dataClasses[0] = {
    ...contribution.payload.dataClasses[0]!,
    id: classId,
    parentCoreClassId: "core:ai_prompt_output_embedding",
    allowedPurposeIds: [purposeId],
    canonicalAnchorId: null,
    retentionRuleRefs: [{ id: ruleId, revision: "1" }],
    subjectLinkBehavior: "inherits_from_parent",
    exportBehavior: "normalized_projection"
  };
  contribution.payload.retentionRules = [
    {
      id: ruleId,
      definition: {
        ...contribution.payload.retentionRules![0]!.definition,
        dataClassId: classId,
        purposeId,
        retentionAnchorId: "core:source_parent_or_last_required_use"
      }
    }
  ];
  contribution.payload.dataUses[1] = {
    ...contribution.payload.dataUses[1]!,
    dataClassId: classId,
    purposeIds: [purposeId],
    canonicalAnchorId: "core:source_parent_or_last_required_use"
  };
  return contribution;
}

function validModuleContributionFor(moduleId: string): ModuleContributionInput {
  return JSON.parse(
    JSON.stringify(validModuleContribution()).replaceAll(
      "sample-source",
      moduleId
    )
  ) as ModuleContributionInput;
}

function validExternalRouteContribution(): ModuleContributionInput {
  const contribution = structuredClone(validModuleContribution());
  contribution.payload.handlers.push(
    {
      id: "module:sample-source:external-lifecycle",
      definition: {
        ...handler("lifecycle", ["transmit_external"]),
        supportedRootKinds: ["external_route"]
      }
    },
    {
      id: "module:sample-source:external-delete",
      definition: {
        ...handler("external_deletion", ["transmit_external"]),
        supportedRootKinds: ["external_route"]
      }
    }
  );
  contribution.payload.handlers
    .find((item) => item.id === "module:sample-source:subject-discovery")!
    .definition.supportedRootKinds.push("external_route");
  contribution.payload.storageRoots.push({
    id: "module:sample-source:provider-route",
    definition: {
      kind: "external_route",
      boundary: "outside_operated_data_plane",
      tenantIsolation: "required",
      versionEnumeration: "not_applicable",
      configurationProfileId: "core:development-external-route-profile"
    }
  });
  contribution.payload.dataUses.push({
    dataClassId: "core:raw_provider_payload",
    storageRootId: "module:sample-source:provider-route",
    purposeIds: ["core:source_replay_and_diagnostics"],
    operations: ["transmit_external"],
    canonicalAnchorId: "core:terminal_processing",
    lifecycleHandlerId: "module:sample-source:external-lifecycle",
    subjectDiscoveryHandlerId: "module:sample-source:subject-discovery",
    exportProjectionHandlerId: null,
    exportHandlerId: null,
    deleteHandlerId: null,
    verificationHandlerId: null
  });
  contribution.payload.externalRoutes.push({
    id: "module:sample-source:provider-processing-route",
    storageRootId: "module:sample-source:provider-route",
    dataClassIds: ["core:raw_provider_payload"],
    purposeId: "core:source_replay_and_diagnostics",
    recipientCategoryId: "core:provider-subprocessor",
    regionProfile: { id: "core:region-profile.eu", version: "1" },
    deleteCapabilityHandlerId: "module:sample-source:external-delete"
  });
  return contribution;
}

describe("Inbox V2 data lifecycle catalog", () => {
  it("pins the approved closed core data-class and purpose catalogs", () => {
    expect(
      INBOX_V2_CORE_DATA_CLASS_CATALOG.payload.entries.map((entry) => entry.id)
    ).toEqual(EXPECTED_CORE_DATA_CLASS_IDS);
    expect(
      INBOX_V2_CORE_PROCESSING_PURPOSE_CATALOG.payload.entries.map(
        (entry) => entry.id
      )
    ).toEqual(EXPECTED_CORE_PURPOSE_IDS);
    // Pin every approved class/purpose/anchor definition without a 66-row
    // inline snapshot. Any policy metadata change must therefore be explicit.
    expect(
      catalogDigest(INBOX_V2_CORE_DATA_CLASS_CATALOG.payload.entries)
    ).toBe("ac82de313a4a184f97406e436589ed8aef2d79972361474e5b7808589f278f0d");
    expect(
      catalogDigest(INBOX_V2_CORE_PROCESSING_PURPOSE_CATALOG.payload.entries)
    ).toBe("1c918292c65bd31c0ca4ef3caeb8bf9c59560d86b5659296362cf0d7155dcda3");
    expect(
      catalogDigest(INBOX_V2_CORE_RETENTION_ANCHOR_CATALOG.payload.entries)
    ).toBe("519de7f8e7ceb85dae87795f11e16b68e9512286c3fae63ae586e8f0cd5657aa");

    const secretEntries =
      INBOX_V2_CORE_DATA_CLASS_CATALOG.payload.entries.filter(
        (entry) => entry.definition.sensitivity === "secret"
      );
    expect(secretEntries).toHaveLength(1);
    expect(secretEntries[0]).toMatchObject({
      id: "core:auth_credential_session_challenge_secret",
      definition: {
        holdEligible: false,
        exportBehavior: "never",
        allowedExpiryActions: ["hard_delete"],
        immediateTerminalPurge: true
      }
    });

    for (const entry of INBOX_V2_CORE_DATA_CLASS_CATALOG.payload.entries) {
      expect(() =>
        inboxV2DataClassDefinitionSchema.parse(entry.definition)
      ).not.toThrow();
      expect(JSON.stringify(entry.definition)).not.toMatch(
        /hold_no_purge|blocked_by_legal_hold|forever/
      );
    }
  });

  it("composes an immutable module contribution for core and module classes", () => {
    const registry = defineInboxV2DataLifecycleRegistry({
      moduleContributions: [validModuleContribution()]
    });

    expect(
      registry.dataClasses.find(
        (entry) => entry.id === "module:sample-source:provider-media"
      )
    ).toMatchObject({
      owner: "sample-source",
      definition: {
        canonicalAnchorId: "core:all_parent_links_and_purposes_end",
        parentBehavior: "inherits_all_live_parents"
      }
    });
    expect(registry.storageRoots).toHaveLength(1);
    expect(Object.isFrozen(registry)).toBe(true);
    expect(Object.isFrozen(registry.moduleContributions[0]?.payload)).toBe(
      true
    );
    expect(registry.compositionHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(
      defineInboxV2DataLifecycleRegistry({
        moduleContributions: [validModuleContribution()]
      }).compositionHash
    ).toBe(registry.compositionHash);

    const changed = validModuleContribution();
    changed.payload.storageRoots[0]!.definition.configurationProfileId =
      "core:storage-profile.changed";
    expect(
      defineInboxV2DataLifecycleRegistry({
        moduleContributions: [changed]
      }).compositionHash
    ).not.toBe(registry.compositionHash);
  });

  it("attaches a namespaced AI purpose to its owning module class with an executable finite rule", () => {
    const registry = defineInboxV2DataLifecycleRegistry({
      moduleContributions: [validModulePurposeContribution()]
    });

    expect(
      registry.processingPurposes.find(
        (entry) => entry.id === "module:sample-source:provider-ai-enrichment"
      )
    ).toMatchObject({
      owner: "sample-source",
      definition: { parentCorePurposeId: "core:ai_or_transcription" }
    });
    expect(
      registry.dataClasses.find(
        (entry) => entry.id === "module:sample-source:provider-ai-output"
      )?.definition.retentionRequirement
    ).toEqual({
      kind: "declared_rule_set",
      ruleRefs: [
        {
          id: "module:sample-source:provider-ai-output-rule",
          revision: "1"
        }
      ]
    });
    expect(registry.retentionRules).toEqual([
      expect.objectContaining({
        id: "module:sample-source:provider-ai-output-rule",
        owner: "sample-source",
        definition: expect.objectContaining({
          purposeId: "module:sample-source:provider-ai-enrichment",
          retentionAnchorId: "core:source_parent_or_last_required_use",
          actionAtExpiry: "hard_delete",
          backupMaximum: { kind: "elapsed", seconds: 3_024_000 },
          lifecycleHandlerId: "module:sample-source:lifecycle",
          deleteHandlerId: "module:sample-source:delete-execution",
          verificationHandlerId: "module:sample-source:verification"
        })
      })
    ]);

    const changedRule = validModulePurposeContribution();
    changedRule.payload.retentionRules![0]!.definition.backupMaximum = {
      kind: "elapsed",
      seconds: 2_592_000
    };
    expect(
      defineInboxV2DataLifecycleRegistry({
        moduleContributions: [changedRule]
      }).compositionHash
    ).not.toBe(registry.compositionHash);
  });

  it("rejects foreign purpose reuse, safety widening and non-executable rule references", () => {
    const wrongPurposeNamespace = validModulePurposeContribution();
    wrongPurposeNamespace.payload.processingPurposes[0]!.id =
      "module:another-source:provider-ai-enrichment";
    expect(() =>
      defineInboxV2DataLifecycleRegistry({
        moduleContributions: [wrongPurposeNamespace]
      })
    ).toThrow(/must use its own namespace/u);

    const widenedPurpose = validModulePurposeContribution();
    widenedPurpose.payload.processingPurposes[0]!.definition.parentCorePurposeId =
      "core:manager_reporting";
    expect(() =>
      defineInboxV2DataLifecycleRegistry({
        moduleContributions: [widenedPurpose]
      })
    ).toThrow(/not allowed by parent .* safety ceiling/u);

    const weakenedPurpose = validModulePurposeContribution();
    weakenedPurpose.payload.processingPurposes[0]!.definition.subjectDiscoveryRequired = false;
    expect(() =>
      defineInboxV2DataLifecycleRegistry({
        moduleContributions: [weakenedPurpose]
      })
    ).toThrow(/cannot weaken its core purpose safety ceiling/u);

    const missingRule = validModulePurposeContribution();
    missingRule.payload.retentionRules = [];
    expect(() =>
      defineInboxV2DataLifecycleRegistry({
        moduleContributions: [missingRule]
      })
    ).toThrow(/exactly one finite retention rule per purpose/u);

    const staleRuleRef = validModulePurposeContribution();
    staleRuleRef.payload.dataClasses[0]!.retentionRuleRefs[0]!.revision = "2";
    expect(() =>
      defineInboxV2DataLifecycleRegistry({
        moduleContributions: [staleRuleRef]
      })
    ).toThrow(/not pinned .* exact revision|stale or foreign/u);

    const incompatibleAction = validModulePurposeContribution();
    incompatibleAction.payload.retentionRules![0]!.definition.actionAtExpiry =
      "compact_to_safe_skeleton";
    expect(() =>
      defineInboxV2DataLifecycleRegistry({
        moduleContributions: [incompatibleAction]
      })
    ).toThrow(/weakens expiry action or hold semantics/u);

    const invalidMaximum = validModulePurposeContribution();
    invalidMaximum.payload.retentionRules![0]!.definition.backupMaximum = {
      kind: "elapsed",
      seconds: 0
    };
    expect(
      inboxV2ModuleDataGovernanceContributionSchema.safeParse(invalidMaximum)
        .success
    ).toBe(false);

    const nonCanonicalRefs = validModulePurposeContribution();
    nonCanonicalRefs.payload.dataClasses[0]!.retentionRuleRefs = [
      { id: "module:sample-source:z-rule", revision: "1" },
      { id: "module:sample-source:a-rule", revision: "1" }
    ];
    expect(
      inboxV2ModuleDataGovernanceContributionSchema.safeParse(nonCanonicalRefs)
        .success
    ).toBe(false);

    const owner = validModulePurposeContribution();
    const foreign = validModuleContributionFor("other-source");
    foreign.payload.dataClasses[0]!.allowedPurposeIds = [
      "module:sample-source:provider-ai-enrichment"
    ];
    foreign.payload.retentionRules![0]!.definition.purposeId =
      "module:sample-source:provider-ai-enrichment";
    foreign.payload.dataUses[1]!.purposeIds = [
      "module:sample-source:provider-ai-enrichment"
    ];
    expect(() =>
      defineInboxV2DataLifecycleRegistry({
        moduleContributions: [owner, foreign]
      })
    ).toThrow(/not allowed by parent .* safety ceiling|owning module class/u);

    const coreClassMutation = validModulePurposeContribution();
    coreClassMutation.payload.dataUses[0]!.purposeIds = [
      "module:sample-source:provider-ai-enrichment"
    ];
    expect(() =>
      defineInboxV2DataLifecycleRegistry({
        moduleContributions: [coreClassMutation]
      })
    ).toThrow(/not allowed for core:file_original_binary|owning module class/u);
  });

  it("requires explicit nullable discovery and export-projection fields", () => {
    const use = structuredClone(validModuleContribution().payload.dataUses[0]!);
    delete (use as Partial<typeof use>).subjectDiscoveryHandlerId;
    expect(inboxV2ModuleDataUseSchema.safeParse(use).success).toBe(false);

    const secondUse = structuredClone(
      validModuleContribution().payload.dataUses[0]!
    );
    delete (secondUse as Partial<typeof secondUse>).exportProjectionHandlerId;
    expect(inboxV2ModuleDataUseSchema.safeParse(secondUse).success).toBe(false);
  });

  it("fails closed on incomplete local discovery, export and deletion coverage", () => {
    const missingDiscovery = structuredClone(validModuleContribution());
    missingDiscovery.payload.dataUses[0]!.subjectDiscoveryHandlerId = null;
    expect(() =>
      defineInboxV2DataLifecycleRegistry({
        moduleContributions: [missingDiscovery]
      })
    ).toThrow(/incomplete subject-discovery coverage/u);

    const missingExport = structuredClone(validModuleContribution());
    missingExport.payload.dataUses[0]!.operations =
      missingExport.payload.dataUses[0]!.operations.filter(
        (operation) => operation !== "export"
      );
    missingExport.payload.dataUses[0]!.exportProjectionHandlerId = null;
    missingExport.payload.dataUses[0]!.exportHandlerId = null;
    expect(() =>
      defineInboxV2DataLifecycleRegistry({
        moduleContributions: [missingExport]
      })
    ).toThrow(/requires export projection and execution coverage/u);

    const missingDeletion = structuredClone(validModuleContribution());
    missingDeletion.payload.dataUses[0]!.operations =
      missingDeletion.payload.dataUses[0]!.operations.filter(
        (operation) => operation !== "delete" && operation !== "verify_absence"
      );
    missingDeletion.payload.dataUses[0]!.deleteHandlerId = null;
    missingDeletion.payload.dataUses[0]!.verificationHandlerId = null;
    expect(() =>
      defineInboxV2DataLifecycleRegistry({
        moduleContributions: [missingDeletion]
      })
    ).toThrow(/requires delete and absence-verification coverage/u);
  });

  it("validates discovery/export handler kind, operation and class declaration mapping", () => {
    const wrongDiscoveryKind = structuredClone(validModuleContribution());
    wrongDiscoveryKind.payload.dataUses[0]!.subjectDiscoveryHandlerId =
      "module:sample-source:lifecycle";
    expect(() =>
      defineInboxV2DataLifecycleRegistry({
        moduleContributions: [wrongDiscoveryKind]
      })
    ).toThrow(/is not a subject_discovery handler/u);

    const wrongProjectionOperation = structuredClone(validModuleContribution());
    wrongProjectionOperation.payload.handlers.find(
      (item) => item.id === "module:sample-source:export-projection"
    )!.definition.supportedOperations = ["read"];
    expect(() =>
      defineInboxV2DataLifecycleRegistry({
        moduleContributions: [wrongProjectionOperation]
      })
    ).toThrow(/does not support operation export/u);

    const mismatchedDeclaration = structuredClone(validModuleContribution());
    const discoveryDefinition = structuredClone(
      mismatchedDeclaration.payload.handlers.find(
        (item) => item.id === "module:sample-source:subject-discovery"
      )!.definition
    );
    mismatchedDeclaration.payload.handlers.push({
      id: "module:sample-source:alternate-subject-discovery",
      definition: discoveryDefinition
    });
    mismatchedDeclaration.payload.dataUses[1]!.subjectDiscoveryHandlerId =
      "module:sample-source:alternate-subject-discovery";
    expect(() =>
      defineInboxV2DataLifecycleRegistry({
        moduleContributions: [mismatchedDeclaration]
      })
    ).toThrow(/does not match declared subjectDiscoveryHandlerId/u);

    const foreignHandler = structuredClone(validModuleContribution());
    const otherContribution = validModuleContributionFor("other-source");
    foreignHandler.payload.dataUses[0]!.lifecycleHandlerId =
      "module:other-source:lifecycle";
    expect(() =>
      defineInboxV2DataLifecycleRegistry({
        moduleContributions: [foreignHandler, otherContribution]
      })
    ).toThrow(/must use its own namespace/u);
  });

  it("requires hold-safe uninstall, materialized local roots and monotonic module subclasses", () => {
    const unsafeUninstall = structuredClone(validModuleContribution());
    unsafeUninstall.payload.handlers.find(
      (item) => item.id === "module:sample-source:migration-uninstall"
    )!.definition.checksHoldFence = false;
    expect(() =>
      defineInboxV2DataLifecycleRegistry({
        moduleContributions: [unsafeUninstall]
      })
    ).toThrow(/must check the hold fence/u);

    const readOnlyRoot = structuredClone(validModuleContribution());
    readOnlyRoot.payload.handlers
      .find((item) => item.id === "module:sample-source:lifecycle")!
      .definition.supportedOperations.push("read");
    for (const use of readOnlyRoot.payload.dataUses) {
      use.operations = ["read"];
      use.exportProjectionHandlerId = null;
      use.exportHandlerId = null;
      use.deleteHandlerId = null;
      use.verificationHandlerId = null;
    }
    expect(() =>
      defineInboxV2DataLifecycleRegistry({
        moduleContributions: [readOnlyRoot]
      })
    ).toThrow(/cannot declare a read-only data use/u);

    const incompatibleCases: Array<(value: ModuleContributionInput) => void> = [
      (value) => {
        value.payload.dataClasses[0]!.allowedPurposeIds = [
          "core:security_and_fraud_prevention"
        ];
      },
      (value) => {
        value.payload.dataClasses[0]!.sensitivity = "personal_operational";
      },
      (value) => {
        value.payload.dataClasses[0]!.subjectLinkBehavior = "direct_structured";
      },
      (value) => {
        value.payload.dataClasses[0]!.exportBehavior = "normalized_projection";
      },
      (value) => {
        value.payload.dataClasses[0]!.holdEligible = false;
      },
      (value) => {
        value.payload.dataClasses[0]!.allowedExpiryActions = [
          "hard_delete",
          "compact_to_safe_skeleton"
        ];
      },
      (value) => {
        value.payload.dataClasses[0]!.parentCoreClassId =
          "core:auth_credential_session_challenge_secret";
        value.payload.dataClasses[0]!.allowedPurposeIds = [
          "core:security_and_fraud_prevention"
        ];
      }
    ];

    for (const mutate of incompatibleCases) {
      const contribution = structuredClone(validModuleContribution());
      mutate(contribution);
      expect(() =>
        defineInboxV2DataLifecycleRegistry({
          moduleContributions: [contribution]
        })
      ).toThrow(/cannot weaken parent|not allowed by parent/u);
    }
  });

  it("requires explicit class/root/purpose/anchor lineage for every core root", () => {
    const storageRegistration = {
      schemaId: "core:inbox-v2.catalog-registration" as const,
      schemaVersion: "v1" as const,
      payload: {
        catalog: "storage-root" as const,
        owner: { kind: "core" as const },
        entries: [
          {
            id: "core:test-message-sql",
            definition: {
              kind: "sql" as const,
              boundary: "operated_data_plane" as const,
              tenantIsolation: "required" as const,
              versionEnumeration: "not_applicable" as const,
              configurationProfileId: "core:storage-profile.sql"
            }
          }
        ]
      }
    };
    const handlerRegistration = {
      schemaId: "core:inbox-v2.catalog-registration" as const,
      schemaVersion: "v1" as const,
      payload: {
        catalog: "lifecycle-handler" as const,
        owner: { kind: "core" as const },
        entries: [
          {
            id: "core:test-message-lifecycle",
            definition: {
              kind: "lifecycle" as const,
              supportedRootKinds: ["sql" as const],
              supportedOperations: [
                "persist" as const,
                "export" as const,
                "delete" as const,
                "verify_absence" as const
              ],
              bounded: true as const,
              idempotent: true as const,
              checksTenantFence: true as const,
              checksRevisionFence: true as const,
              checksHoldFence: true,
              verifiesAbsence: false
            }
          },
          {
            id: "core:test-message-subject-discovery",
            definition: {
              ...handler("subject_discovery", ["read"]),
              supportedRootKinds: ["sql" as const]
            }
          },
          {
            id: "core:test-message-export-projection",
            definition: {
              ...handler("export_projection", ["export"]),
              supportedRootKinds: ["sql" as const]
            }
          },
          {
            id: "core:test-message-export-execution",
            definition: {
              ...handler("export_execution", ["export"]),
              supportedRootKinds: ["sql" as const]
            }
          },
          {
            id: "core:test-message-delete-execution",
            definition: {
              ...handler("delete_execution", ["delete"]),
              supportedRootKinds: ["sql" as const]
            }
          },
          {
            id: "core:test-message-verification",
            definition: {
              ...handler("verification", ["verify_absence"], {
                verifiesAbsence: true
              }),
              supportedRootKinds: ["sql" as const]
            }
          }
        ]
      }
    };
    const dataUseRegistration: z.input<
      typeof inboxV2CoreDataUseRegistrationSchema
    > = {
      schemaId: "core:inbox-v2.core-data-use-registration" as const,
      schemaVersion: "v1" as const,
      payload: {
        dataUses: [
          {
            dataClassId: "core:message_content_blocks",
            storageRootId: "core:test-message-sql",
            purposeIds: ["core:communication_delivery"],
            operations: [
              "persist" as const,
              "export" as const,
              "delete" as const,
              "verify_absence" as const
            ],
            canonicalAnchorId: "core:canonical_item_time",
            lifecycleHandlerId: "core:test-message-lifecycle",
            subjectDiscoveryHandlerId: "core:test-message-subject-discovery",
            exportProjectionHandlerId: "core:test-message-export-projection",
            exportHandlerId: "core:test-message-export-execution",
            deleteHandlerId: "core:test-message-delete-execution",
            verificationHandlerId: "core:test-message-verification"
          }
        ]
      }
    };

    expect(() =>
      defineInboxV2DataLifecycleRegistry({
        coreStorageRootRegistrations: [storageRegistration],
        coreLifecycleHandlerRegistrations: [handlerRegistration]
      })
    ).toThrow(/has no registered data use/u);

    const registry = defineInboxV2DataLifecycleRegistry({
      coreStorageRootRegistrations: [storageRegistration],
      coreLifecycleHandlerRegistrations: [handlerRegistration],
      coreDataUseRegistrations: [dataUseRegistration]
    });
    expect(registry.dataUses).toEqual([
      expect.objectContaining({
        owner: "core",
        dataClassId: "core:message_content_blocks",
        storageRootId: "core:test-message-sql"
      })
    ]);

    const missingCoreExport = structuredClone(dataUseRegistration);
    missingCoreExport.payload.dataUses[0]!.operations = [
      "persist",
      "delete",
      "verify_absence"
    ];
    missingCoreExport.payload.dataUses[0]!.exportProjectionHandlerId = null;
    missingCoreExport.payload.dataUses[0]!.exportHandlerId = null;
    expect(() =>
      defineInboxV2DataLifecycleRegistry({
        coreStorageRootRegistrations: [storageRegistration],
        coreLifecycleHandlerRegistrations: [handlerRegistration],
        coreDataUseRegistrations: [missingCoreExport]
      })
    ).toThrow(/requires export projection and execution coverage/u);

    const wrongAnchor = structuredClone(dataUseRegistration);
    wrongAnchor.payload.dataUses[0]!.canonicalAnchorId =
      "core:terminal_processing";
    expect(() =>
      defineInboxV2DataLifecycleRegistry({
        coreStorageRootRegistrations: [storageRegistration],
        coreLifecycleHandlerRegistrations: [handlerRegistration],
        coreDataUseRegistrations: [wrongAnchor]
      })
    ).toThrow(/does not use its canonical anchor/u);
  });

  it("fails closed for unknown class, root, purpose and handler references", () => {
    const cases: Array<(value: ModuleContributionInput) => void> = [
      (value) => {
        value.payload.dataUses[0]!.dataClassId = "core:not_registered";
      },
      (value) => {
        value.payload.dataUses[0]!.storageRootId =
          "module:sample-source:not_registered";
      },
      (value) => {
        value.payload.dataUses[0]!.purposeIds = ["core:not_registered"];
      },
      (value) => {
        value.payload.dataUses[0]!.lifecycleHandlerId =
          "module:sample-source:not_registered";
      }
    ];

    for (const mutate of cases) {
      const contribution = structuredClone(validModuleContribution());
      mutate(contribution);
      expect(() =>
        defineInboxV2DataLifecycleRegistry({
          moduleContributions: [contribution]
        })
      ).toThrow(/Unknown Inbox V2/);
    }
  });

  it("rejects namespace mismatch, incompatible handlers and missing lineage", () => {
    const wrongNamespace = structuredClone(validModuleContribution());
    wrongNamespace.payload.storageRoots[0]!.id =
      "module:another-module:file-object";
    expect(() =>
      defineInboxV2DataLifecycleRegistry({
        moduleContributions: [wrongNamespace]
      })
    ).toThrow(/must use its own namespace/);

    const incompatibleHandler = structuredClone(validModuleContribution());
    incompatibleHandler.payload.handlers[0]!.definition.supportedRootKinds = [
      "sql"
    ];
    expect(() =>
      defineInboxV2DataLifecycleRegistry({
        moduleContributions: [incompatibleHandler]
      })
    ).toThrow(/does not support object|incompatible with root kind object/);

    const missingLineage = structuredClone(validModuleContribution());
    missingLineage.payload.dataUses = [missingLineage.payload.dataUses[0]!];
    expect(() =>
      defineInboxV2DataLifecycleRegistry({
        moduleContributions: [missingLineage]
      })
    ).toThrow(
      /has no executable data use|lacks persist\/derive plus delete lineage/
    );
  });

  it("requires external transmission lineage and a compatible delete capability", () => {
    const registry = defineInboxV2DataLifecycleRegistry({
      moduleContributions: [validExternalRouteContribution()]
    });
    expect(
      registry.storageRoots.find(
        (entry) => entry.id === "module:sample-source:provider-route"
      )?.definition
    ).toMatchObject({
      kind: "external_route",
      boundary: "outside_operated_data_plane"
    });
    expect(
      registry.dataUses.find(
        (use) =>
          String(use.storageRootId) === "module:sample-source:provider-route" &&
          String(use.dataClassId) === "core:raw_provider_payload"
      )
    ).toMatchObject({
      operations: ["transmit_external"],
      subjectDiscoveryHandlerId: "module:sample-source:subject-discovery",
      exportProjectionHandlerId: null,
      exportHandlerId: null,
      deleteHandlerId: null,
      verificationHandlerId: null
    });

    const missingExternalDiscovery = validExternalRouteContribution();
    missingExternalDiscovery.payload.dataUses.at(
      -1
    )!.subjectDiscoveryHandlerId = null;
    expect(() =>
      defineInboxV2DataLifecycleRegistry({
        moduleContributions: [missingExternalDiscovery]
      })
    ).toThrow(/incomplete subject-discovery coverage/u);

    const externalLocalExport = validExternalRouteContribution();
    const externalUse = externalLocalExport.payload.dataUses.at(-1)!;
    externalUse.operations = ["transmit_external", "export"];
    externalUse.exportProjectionHandlerId =
      "module:sample-source:export-projection";
    externalUse.exportHandlerId = "module:sample-source:export-execution";
    expect(() =>
      defineInboxV2DataLifecycleRegistry({
        moduleContributions: [externalLocalExport]
      })
    ).toThrow(/may only declare transmit_external/u);

    const missingRoute = validExternalRouteContribution();
    missingRoute.payload.externalRoutes = [];
    expect(() =>
      defineInboxV2DataLifecycleRegistry({
        moduleContributions: [missingRoute]
      })
    ).toThrow(/lacks an external route declaration/);

    const wrongDeleteCapability = validExternalRouteContribution();
    wrongDeleteCapability.payload.externalRoutes[0]!.deleteCapabilityHandlerId =
      "module:sample-source:delete-execution";
    expect(() =>
      defineInboxV2DataLifecycleRegistry({
        moduleContributions: [wrongDeleteCapability]
      })
    ).toThrow(/is not a external_deletion handler/);
  });

  it("rejects secret export or hold declarations at schema and registry boundaries", () => {
    const exportedCoreSecret = structuredClone(validModuleContribution());
    exportedCoreSecret.payload.dataUses[0] = {
      ...exportedCoreSecret.payload.dataUses[0]!,
      dataClassId: "core:auth_credential_session_challenge_secret",
      purposeIds: ["core:security_and_fraud_prevention"],
      operations: ["persist", "export", "delete", "verify_absence"],
      canonicalAnchorId: "core:revoke_expiry_or_completion",
      subjectDiscoveryHandlerId: null,
      exportHandlerId: "module:sample-source:export-execution"
    };
    expect(() =>
      defineInboxV2DataLifecycleRegistry({
        moduleContributions: [exportedCoreSecret]
      })
    ).toThrow(/Secret data class .* cannot be exported/);

    const heldModuleSecret = structuredClone(validModuleContribution());
    heldModuleSecret.payload.dataClasses[0] = {
      ...heldModuleSecret.payload.dataClasses[0]!,
      sensitivity: "secret",
      holdEligible: true
    };
    expect(
      inboxV2ModuleDataGovernanceContributionSchema.safeParse(heldModuleSecret)
        .success
    ).toBe(false);

    const nonExportableDiagnostic = structuredClone(validModuleContribution());
    nonExportableDiagnostic.payload.dataUses[0] = {
      ...nonExportableDiagnostic.payload.dataUses[0]!,
      dataClassId: "core:operational_log_trace_diagnostic",
      purposeIds: ["core:source_replay_and_diagnostics"],
      operations: ["persist", "export", "delete", "verify_absence"],
      canonicalAnchorId: "core:creation",
      subjectDiscoveryHandlerId: null,
      exportHandlerId: "module:sample-source:export-execution"
    };
    expect(() =>
      defineInboxV2DataLifecycleRegistry({
        moduleContributions: [nonExportableDiagnostic]
      })
    ).toThrow(/is not eligible for export/);
  });

  it("enforces physical storage root boundary and version semantics", () => {
    expect(
      inboxV2StorageRootDefinitionSchema.safeParse({
        kind: "object",
        boundary: "operated_data_plane",
        tenantIsolation: "required",
        versionEnumeration: "not_applicable",
        configurationProfileId: "core:profile"
      }).success
    ).toBe(false);
    expect(
      inboxV2StorageRootDefinitionSchema.safeParse({
        kind: "backup",
        boundary: "operated_data_plane",
        tenantIsolation: "required",
        versionEnumeration: "supported",
        configurationProfileId: "core:profile"
      }).success
    ).toBe(false);
    expect(
      inboxV2StorageRootDefinitionSchema.safeParse({
        kind: "external_route",
        boundary: "operated_data_plane",
        tenantIsolation: "required",
        versionEnumeration: "not_applicable",
        configurationProfileId: "core:profile"
      }).success
    ).toBe(false);

    const backupOnLiveObject = validModuleContribution();
    backupOnLiveObject.payload.dataUses[0]!.dataClassId =
      "core:backup_copy_or_object_version";
    expect(() =>
      defineInboxV2DataLifecycleRegistry({
        moduleContributions: [backupOnLiveObject]
      })
    ).toThrow(/Backup data class and backup storage-root semantics/u);
  });
});
