import { z } from "zod";

import { inboxV2AuthorizationEpochSchema } from "./authorization-epoch";
import { inboxV2CatalogIdSchema } from "./catalog";
import {
  inboxV2BigintCounterSchema,
  inboxV2EntityRevisionSchema,
  inboxV2TimestampSchema,
  isInboxV2TimestampOrderValid
} from "./entity-metadata";
import { inboxV2TenantIdSchema } from "./ids";
import {
  createInboxV2SchemaEnvelopeSchema,
  inboxV2SchemaVersionTokenSchema,
  parseInboxV2VersionedEnvelope
} from "./schema-version";
import {
  inboxV2AuthorizationEpochSnapshotSchema,
  inboxV2AuthorizationDecisionReferenceSchema,
  inboxV2ClientMutationIdSchema,
  inboxV2EntityKeySchema,
  inboxV2InvalidationScopeSchema,
  inboxV2ProjectionCheckpointSchema,
  inboxV2RecipientScopeIdSchema,
  inboxV2RecipientScopeSchema,
  inboxV2Sha256DigestSchema,
  inboxV2SnapshotIdSchema,
  inboxV2StreamEpochSchema,
  inboxV2SyncCursorSchema,
  inboxV2SyncGenerationSchema,
  inboxV2TenantStreamCommitIdSchema,
  inboxV2TenantStreamCommitPositionSchema,
  inboxV2TenantStreamPositionSchema
} from "./sync-primitives";
import {
  INBOX_V2_MAX_SYNC_BATCH_CHANGES,
  INBOX_V2_MAX_SYNC_BATCH_COMMITS,
  INBOX_V2_MAX_SYNC_COMMIT_CHANGES,
  INBOX_V2_MAX_SYNC_FRAME_BYTES,
  INBOX_V2_REALTIME_ENVELOPE_SCHEMA_ID,
  INBOX_V2_RECIPIENT_SNAPSHOT_PAGE_SCHEMA_ID,
  INBOX_V2_RECIPIENT_SYNC_BATCH_SCHEMA_ID,
  INBOX_V2_RECIPIENT_SYNC_ARCHIVED_SCHEMA_VERSION,
  INBOX_V2_RECIPIENT_SYNC_SCHEMA_VERSION
} from "./recipient-sync-constants";
import {
  inboxV2AcceptedSnapshotPageCursorValidationProofSchema,
  inboxV2AcceptedSnapshotStartAuthorizationValidationProofSchema,
  inboxV2AcceptedSyncCursorValidationProofSchema,
  inboxV2AuthorizationSecurityStatesMatch,
  inboxV2AuthorizationSnapshotsMatch,
  inboxV2EffectiveAuthorizationNotAfter,
  inboxV2SnapshotManifestCoverageSchema,
  inboxV2SnapshotPageCursorMintSchema,
  inboxV2SnapshotPageCursorValidationContextSchema,
  inboxV2ScopeTransitionInputCursorProofSchema,
  inboxV2SyncCursorErrorCodeSchema,
  inboxV2SyncCursorMintSchema
} from "./recipient-sync-cursor";
import {
  calculateInboxV2SnapshotManifestDefinitionHash,
  verifyInboxV2SnapshotManifestHash
} from "./recipient-sync-hash";
import {
  invalidationScopeBelongsToTenant,
  jsonUtf8ByteLength,
  sameJsonValue
} from "./recipient-sync-json";
import {
  createInboxV2ArchivedV1RecipientEntityChangeSchema,
  createInboxV2ArchivedV1RecipientUpsertChangeSchema,
  createInboxV2RecipientEntityChangeSchema,
  createInboxV2RecipientUpsertChangeSchema,
  createRecipientProjectionRegistry,
  deriveInboxV2RecipientWireProjectionRegistrations,
  findRecipientProjectionRegistration,
  inboxV2RecipientSecurityPurgeChangeSchema,
  normalizeRecipientProjectionRegistrations,
  recipientRequirementResource
} from "./recipient-sync-projection";
import type { InboxV2RecipientProjectionRegistration } from "./recipient-sync-projection";
import { createInboxV2RecipientWireSyncContracts } from "./recipient-sync-wire-contracts";

type AuthorizationSnapshot = z.output<
  typeof inboxV2AuthorizationEpochSnapshotSchema
>;

function authorizationSnapshotBindsRecipient(input: {
  authorization: AuthorizationSnapshot;
  tenantId: string;
  employeeId: string;
  authorizationEpoch: string;
  authorizationNotAfter: string;
}): boolean {
  return (
    input.authorization.tenantId === input.tenantId &&
    input.authorization.employee.id === input.employeeId &&
    input.authorization.value === input.authorizationEpoch &&
    inboxV2EffectiveAuthorizationNotAfter(input.authorization) ===
      input.authorizationNotAfter
  );
}

function parseArchivedRecipientSyncEnvelope<
  TArchived extends z.ZodType
>(input: { value: unknown; schemaId: string; archivedSchema: TArchived }) {
  return parseInboxV2VersionedEnvelope({
    value: input.value,
    schemaId: input.schemaId,
    supportedSchemas: {
      [INBOX_V2_RECIPIENT_SYNC_ARCHIVED_SCHEMA_VERSION]: input.archivedSchema
    },
    invalidErrorCode: "sync.envelope_invalid",
    unsupportedErrorCode: "sync.schema_unsupported"
  });
}

export function createInboxV2RecipientSyncContracts<
  const TProjections extends readonly InboxV2RecipientProjectionRegistration[],
  const TArchivedV1Projections extends
    readonly InboxV2RecipientProjectionRegistration[]
>(input: {
  projections: TProjections;
  archivedV1Projections: TArchivedV1Projections;
  snapshotIndexScopeIds: readonly string[];
  archivedV1SnapshotIndexScopeIds: readonly string[];
  verifyRecipientStateFingerprint: (change: unknown) => boolean;
}) {
  const registrations = normalizeRecipientProjectionRegistrations(
    input.projections
  );
  const registry = createRecipientProjectionRegistry(registrations);
  const archivedV1Registrations = normalizeRecipientProjectionRegistrations(
    input.archivedV1Projections
  );
  const archivedV1Registry = createRecipientProjectionRegistry(
    archivedV1Registrations
  );
  const authorizedEntityChangeSchema = createInboxV2RecipientEntityChangeSchema(
    {
      projections: input.projections,
      verifyRecipientStateFingerprint: input.verifyRecipientStateFingerprint
    }
  );
  const archivedV1EntityChangeSchema =
    createInboxV2ArchivedV1RecipientEntityChangeSchema({
      projections: input.archivedV1Projections
    });
  const snapshotIndexScopeIds = input.snapshotIndexScopeIds
    .map((scopeId) => String(inboxV2CatalogIdSchema.parse(scopeId)))
    .sort();
  const archivedV1SnapshotIndexScopeIds = input.archivedV1SnapshotIndexScopeIds
    .map((scopeId) => String(inboxV2CatalogIdSchema.parse(scopeId)))
    .sort();
  if (
    snapshotIndexScopeIds.length === 0 ||
    snapshotIndexScopeIds.length > 64 ||
    new Set(snapshotIndexScopeIds).size !== snapshotIndexScopeIds.length
  ) {
    throw new Error("Snapshot manifest requires 1..64 unique index scope IDs.");
  }
  if (
    archivedV1SnapshotIndexScopeIds.length === 0 ||
    archivedV1SnapshotIndexScopeIds.length > 64 ||
    new Set(archivedV1SnapshotIndexScopeIds).size !==
      archivedV1SnapshotIndexScopeIds.length
  ) {
    throw new Error(
      "Archived V1 snapshot manifest requires 1..64 unique frozen index scope IDs."
    );
  }
  const wireContracts = createInboxV2RecipientWireSyncContracts({
    projections: deriveInboxV2RecipientWireProjectionRegistrations(
      input.projections
    ),
    snapshotIndexScopeIds
  });
  const entityChangeSchema = wireContracts.entityChangeSchema;
  const recipientCommitSchema = wireContracts.recipientCommitSchema;
  const authorizedRecipientCommitSchema = z
    .object({
      commitId: inboxV2TenantStreamCommitIdSchema,
      streamPosition: inboxV2TenantStreamCommitPositionSchema,
      clientMutationIds: z.array(inboxV2ClientMutationIdSchema).max(64),
      recipientChangeCount: inboxV2EntityRevisionSchema,
      commitCompleteness: z.literal("complete"),
      changes: z
        .array(authorizedEntityChangeSchema)
        .min(1)
        .max(INBOX_V2_MAX_SYNC_COMMIT_CHANGES)
    })
    .strict()
    .superRefine((commit, context) => {
      if (
        BigInt(commit.recipientChangeCount) !== BigInt(commit.changes.length) ||
        commit.changes.some(
          (change, index) =>
            BigInt(change.recipientOrdinal) !== BigInt(index + 1) ||
            (index > 0 &&
              BigInt(change.sourceChangeOrdinal) <=
                BigInt(commit.changes[index - 1]!.sourceChangeOrdinal))
        ) ||
        new Set(commit.clientMutationIds).size !==
          commit.clientMutationIds.length ||
        !recipientEntityChangesAreUnique(commit.changes) ||
        !recipientAuthorizationDecisionReferencesAreConsistent(
          commit.changes.map((change) => change.authorizationDecisionRefs)
        )
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Recipient commit must be a complete, ordered and unsplit projection of one canonical commit."
        });
      }
    });
  const archivedV1RecipientCommitSchema = z
    .object({
      commitId: inboxV2TenantStreamCommitIdSchema,
      streamPosition: inboxV2TenantStreamCommitPositionSchema,
      clientMutationIds: z.array(inboxV2ClientMutationIdSchema).max(64),
      recipientChangeCount: inboxV2EntityRevisionSchema,
      commitCompleteness: z.literal("complete"),
      changes: z
        .array(archivedV1EntityChangeSchema)
        .min(1)
        .max(INBOX_V2_MAX_SYNC_COMMIT_CHANGES)
    })
    .strict()
    .superRefine((commit, context) => {
      if (
        BigInt(commit.recipientChangeCount) !== BigInt(commit.changes.length) ||
        commit.changes.some(
          (change, index) =>
            BigInt(change.recipientOrdinal) !== BigInt(index + 1) ||
            (index > 0 &&
              BigInt(change.sourceChangeOrdinal) <=
                BigInt(commit.changes[index - 1]!.sourceChangeOrdinal))
        ) ||
        new Set(commit.clientMutationIds).size !==
          commit.clientMutationIds.length ||
        !recipientEntityChangesAreUnique(commit.changes) ||
        !recipientAuthorizationDecisionReferencesAreConsistent(
          commit.changes.map((change) => change.authorizationDecisionRefs)
        )
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Archived V1 recipient commit must remain a complete, ordered and unsplit canonical commit projection."
        });
      }
    });

  const syncBatchFields = {
    tenantId: inboxV2TenantIdSchema,
    streamEpoch: inboxV2StreamEpochSchema,
    syncGeneration: inboxV2SyncGenerationSchema,
    scopeId: inboxV2RecipientScopeIdSchema,
    scope: inboxV2RecipientScopeSchema,
    authorizationEpoch: inboxV2AuthorizationEpochSchema,
    authorizationNotAfter: inboxV2TimestampSchema,
    fromExclusive: inboxV2TenantStreamPositionSchema,
    scannedThrough: inboxV2TenantStreamPositionSchema,
    projectionCheckpoint: inboxV2ProjectionCheckpointSchema,
    hasMore: z.boolean(),
    cursor: inboxV2SyncCursorSchema
  } as const;
  const authorizedSyncBatchBaseSchema = z
    .object({
      ...syncBatchFields,
      commits: z
        .array(authorizedRecipientCommitSchema)
        .max(INBOX_V2_MAX_SYNC_BATCH_COMMITS)
    })
    .strict();
  const archivedV1SyncBatchBaseSchema = z
    .object({
      ...syncBatchFields,
      commits: z
        .array(archivedV1RecipientCommitSchema)
        .max(INBOX_V2_MAX_SYNC_BATCH_COMMITS)
    })
    .strict();
  const refineSyncBatch = (
    batch: z.output<typeof authorizedSyncBatchBaseSchema>,
    context: z.RefinementCtx,
    projectionRegistry = registry
  ) => {
    if (
      batch.scopeId !== batch.scope.id ||
      batch.scope.employee.tenantId !== batch.tenantId ||
      BigInt(batch.scannedThrough) <= BigInt(batch.fromExclusive) ||
      BigInt(batch.projectionCheckpoint) < BigInt(batch.scannedThrough) ||
      batch.hasMore !==
        BigInt(batch.scannedThrough) < BigInt(batch.projectionCheckpoint)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Sync batch must advance one authorized scope only through a durable contiguous projection checkpoint."
      });
    }

    const totalChanges = batch.commits.reduce(
      (total, commit) => total + commit.changes.length,
      0
    );
    const commitIds = batch.commits.map((commit) => commit.commitId);
    const clientMutationIds = batch.commits.flatMap(
      (commit) => commit.clientMutationIds
    );
    if (
      totalChanges > INBOX_V2_MAX_SYNC_BATCH_CHANGES ||
      jsonUtf8ByteLength(batch) > INBOX_V2_MAX_SYNC_FRAME_BYTES ||
      new Set(commitIds).size !== commitIds.length ||
      new Set(clientMutationIds).size !== clientMutationIds.length ||
      !recipientAuthorizationDecisionReferencesAreConsistent(
        batch.commits.flatMap((commit) =>
          commit.changes.map((change) => change.authorizationDecisionRefs)
        )
      )
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Sync batch exceeds the global recipient change or encoded-byte budget."
      });
    }

    let previous = BigInt(batch.fromExclusive);
    for (const [commitIndex, commit] of batch.commits.entries()) {
      const position = BigInt(commit.streamPosition);
      if (position <= previous || position > BigInt(batch.scannedThrough)) {
        context.addIssue({
          code: "custom",
          path: ["commits", commitIndex, "streamPosition"],
          message:
            "Recipient commits must be strictly ordered inside the scanned range."
        });
      }
      previous = position;

      for (const [changeIndex, change] of commit.changes.entries()) {
        let invalidEntityState = false;
        let missingEntityAuthorization = false;
        if (
          "entity" in change &&
          "lastChangedStreamPosition" in change &&
          "timeline" in change
        ) {
          const registration = findRecipientProjectionRegistration(
            projectionRegistry,
            change
          );
          invalidEntityState =
            change.entity.tenantId !== batch.tenantId ||
            BigInt(change.lastChangedStreamPosition) > position ||
            (change.timeline !== null &&
              change.timeline.conversation.tenantId !== batch.tenantId);
          missingEntityAuthorization =
            registration === undefined ||
            !registration.authorizationRequirements.every((requirement) => {
              const resource = recipientRequirementResource(
                requirement,
                change
              );
              return (
                resource !== null &&
                change.authorizationDecisionRefs.some(
                  (decision) =>
                    decision.permissionId === requirement.permissionId &&
                    decision.resourceScopeId === requirement.resourceScopeId &&
                    sameJsonValue(decision.resource, resource) &&
                    decision.principal.kind === "employee" &&
                    decision.principal.employee.id ===
                      batch.scope.employee.id &&
                    decision.outcome === "allowed"
                )
              );
            });
        }
        if (
          change.authorizationDecisionRefs.some(
            (decision) =>
              decision.tenantId !== batch.tenantId ||
              decision.authorizationEpoch !== batch.authorizationEpoch ||
              decision.principal.kind !== "employee" ||
              decision.principal.employee.id !== batch.scope.employee.id ||
              decision.outcome !== "allowed" ||
              Date.parse(decision.decidedAt) >=
                Date.parse(batch.authorizationNotAfter) ||
              !isInboxV2TimestampOrderValid(
                batch.authorizationNotAfter,
                decision.notAfter
              )
          ) ||
          invalidEntityState ||
          missingEntityAuthorization
        ) {
          context.addIssue({
            code: "custom",
            path: ["commits", commitIndex, "changes", changeIndex],
            message:
              "Recipient changes must be tenant-safe, authorized and cannot claim a future entity position."
          });
        }
      }
    }
  };
  const archivedV1SyncBatchSchema = archivedV1SyncBatchBaseSchema.superRefine(
    (batch, context) => {
      refineSyncBatch(
        batch as unknown as z.output<typeof authorizedSyncBatchBaseSchema>,
        context,
        archivedV1Registry
      );
    }
  );
  /** Client wire payload: authorization dependencies stay server-side. */
  const syncBatchSchema = wireContracts.syncBatchSchema;
  const authorizedSyncBatchSchema =
    authorizedSyncBatchBaseSchema.superRefine(refineSyncBatch);

  const syncBatchEnvelopeSchema = wireContracts.syncBatchEnvelopeSchema;
  const archivedV1SyncBatchEnvelopeSchema = createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_RECIPIENT_SYNC_BATCH_SCHEMA_ID,
    INBOX_V2_RECIPIENT_SYNC_ARCHIVED_SCHEMA_VERSION,
    archivedV1SyncBatchSchema
  );
  /** Internal producer gate; serialize only `batch` after this proof passes. */
  const syncBatchProducerDeliverySchema = z
    .object({
      batch: syncBatchEnvelopeSchema,
      authorizedBatch: authorizedSyncBatchSchema,
      authorization: inboxV2AuthorizationEpochSnapshotSchema,
      acceptedInputCursor: inboxV2AcceptedSyncCursorValidationProofSchema,
      cursorMint: inboxV2SyncCursorMintSchema
    })
    .strict()
    .superRefine((delivery, context) => {
      const batch = delivery.batch.payload;
      const authorizedBatch = delivery.authorizedBatch;
      const authorization = delivery.authorization;
      const accepted = delivery.acceptedInputCursor;
      const mint = delivery.cursorMint;
      const decisionGroups = authorizedBatch.commits.flatMap((commit) =>
        commit.changes.map((change) => change.authorizationDecisionRefs)
      );
      if (
        !sameJsonValue(
          batch,
          stripRecipientSyncBatchAuthorizationEvidence(authorizedBatch)
        ) ||
        !authorizationSnapshotBindsRecipient({
          authorization,
          tenantId: batch.tenantId,
          employeeId: batch.scope.employee.id,
          authorizationEpoch: batch.authorizationEpoch,
          authorizationNotAfter: batch.authorizationNotAfter
        }) ||
        !recipientAuthorizationDecisionsMatchSnapshot(
          decisionGroups,
          authorization
        ) ||
        accepted.fromExclusive !== batch.fromExclusive ||
        accepted.validationContext.tenantId !== batch.tenantId ||
        accepted.validationContext.employee.id !== batch.scope.employee.id ||
        accepted.validationContext.scopeId !== batch.scopeId ||
        accepted.validationContext.streamEpoch !== batch.streamEpoch ||
        accepted.validationContext.syncGeneration !== batch.syncGeneration ||
        !inboxV2AuthorizationSnapshotsMatch(
          accepted.validationContext.authorization,
          authorization
        ) ||
        mint.cursor !== batch.cursor ||
        mint.claims.tenantId !== batch.tenantId ||
        mint.claims.employee.id !== batch.scope.employee.id ||
        mint.claims.scopeId !== batch.scopeId ||
        mint.claims.streamEpoch !== batch.streamEpoch ||
        mint.claims.syncGeneration !== batch.syncGeneration ||
        mint.claims.authorizationEpoch !== batch.authorizationEpoch ||
        mint.claims.notAfter !== batch.authorizationNotAfter ||
        !inboxV2AuthorizationSnapshotsMatch(
          mint.authorization,
          authorization
        ) ||
        mint.claims.issuedAt !== accepted.validationContext.now ||
        mint.claims.schemaVersion !== delivery.batch.schemaVersion ||
        mint.claims.scannedThrough !== batch.scannedThrough ||
        mint.claims.resumeMode !== "delta" ||
        authorizedBatch.commits.some((commit) =>
          commit.changes.some((change) =>
            change.authorizationDecisionRefs.some(
              (decision) =>
                Date.parse(decision.decidedAt) >
                Date.parse(mint.claims.issuedAt)
            )
          )
        )
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Sync delivery must start at the accepted input cursor and mint the result from the exact authorization snapshot and scannedThrough checkpoint."
        });
      }
    });

  const archivedV1SnapshotRegistrationSchema = z
    .object({
      entityTypeId: inboxV2CatalogIdSchema,
      projectionTypeId: inboxV2CatalogIdSchema,
      stateSchemaId: inboxV2CatalogIdSchema,
      stateSchemaVersion: inboxV2SchemaVersionTokenSchema,
      authorizationRequirements: z
        .array(
          z
            .object({
              permissionId: inboxV2CatalogIdSchema,
              resourceScopeId: inboxV2CatalogIdSchema,
              resourceResolverId: inboxV2CatalogIdSchema
            })
            .strict()
        )
        .min(1)
        .max(16)
    })
    .strict();
  const recipientSemanticDeclarationSchema = z
    .object({
      semanticId: inboxV2CatalogIdSchema,
      fingerprint: inboxV2Sha256DigestSchema
    })
    .strict();
  const authorizedSnapshotRegistrationSchema = z
    .object({
      entityTypeId: inboxV2CatalogIdSchema,
      projectionTypeId: inboxV2CatalogIdSchema,
      stateSchemaId: inboxV2CatalogIdSchema,
      stateSchemaVersion: inboxV2SchemaVersionTokenSchema,
      valueContextValidator: recipientSemanticDeclarationSchema,
      authorizationRequirements: z
        .array(
          z
            .object({
              permissionId: inboxV2CatalogIdSchema,
              resourceScopeId: inboxV2CatalogIdSchema,
              resourceResolver: recipientSemanticDeclarationSchema
            })
            .strict()
        )
        .min(1)
        .max(16)
    })
    .strict();
  const archivedV1SnapshotManifestBaseSchema = z
    .object({
      completeness: z.literal("complete_for_scope"),
      registrations: z
        .array(archivedV1SnapshotRegistrationSchema)
        .min(1)
        .max(256),
      indexScopeIds: z.array(inboxV2CatalogIdSchema).min(1).max(64),
      manifestHash: inboxV2Sha256DigestSchema
    })
    .strict();
  const authorizedSnapshotManifestBaseSchema = z
    .object({
      completeness: z.literal("complete_for_scope"),
      registrations: z
        .array(authorizedSnapshotRegistrationSchema)
        .min(1)
        .max(256),
      indexScopeIds: z.array(inboxV2CatalogIdSchema).min(1).max(64),
      manifestDefinitionHash: inboxV2Sha256DigestSchema,
      manifestHash: inboxV2Sha256DigestSchema
    })
    .strict();
  const refineArchivedV1SnapshotManifest = (
    manifest: z.output<typeof archivedV1SnapshotManifestBaseSchema>,
    context: z.RefinementCtx
  ) => {
    const expectedRegistrations = archivedV1Registrations.map(
      (registration) => ({
        projectionTypeId: registration.projectionTypeId,
        entityTypeId: registration.entityTypeId,
        stateSchemaId: registration.stateSchemaId,
        stateSchemaVersion: registration.stateSchemaVersion,
        authorizationRequirements: registration.authorizationRequirements.map(
          (requirement) => ({
            permissionId: requirement.permissionId,
            resourceScopeId: requirement.resourceScopeId,
            resourceResolverId: requirement.resourceResolverId
          })
        )
      })
    );
    if (
      !sameJsonValue(manifest.registrations, expectedRegistrations) ||
      !sameJsonValue(manifest.indexScopeIds, archivedV1SnapshotIndexScopeIds)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Snapshot manifest must exactly declare registered entity/state and index coverage."
      });
    }
  };
  const refineAuthorizedSnapshotManifest = (
    manifest: z.output<typeof authorizedSnapshotManifestBaseSchema>,
    context: z.RefinementCtx
  ) => {
    const expectedRegistrations = registrations.map((registration) => ({
      projectionTypeId: registration.projectionTypeId,
      entityTypeId: registration.entityTypeId,
      stateSchemaId: registration.stateSchemaId,
      stateSchemaVersion: registration.stateSchemaVersion,
      valueContextValidator: {
        semanticId: registration.valueContextValidatorId,
        fingerprint: registration.valueContextValidatorFingerprint
      },
      authorizationRequirements: registration.authorizationRequirements.map(
        (requirement) => ({
          permissionId: requirement.permissionId,
          resourceScopeId: requirement.resourceScopeId,
          resourceResolver: {
            semanticId: requirement.resourceResolverId,
            fingerprint: requirement.resourceResolverFingerprint
          }
        })
      )
    }));
    if (
      !sameJsonValue(manifest.registrations, expectedRegistrations) ||
      !sameJsonValue(manifest.indexScopeIds, snapshotIndexScopeIds)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Snapshot manifest must exactly declare registered schema, validator, resolver and index semantics."
      });
    }
  };
  const snapshotManifestDefinitionHashInput = (
    manifest: z.output<typeof authorizedSnapshotManifestBaseSchema>
  ) => ({
    recipientSyncSchemaVersion: INBOX_V2_RECIPIENT_SYNC_SCHEMA_VERSION,
    completeness: manifest.completeness,
    registrations: manifest.registrations,
    indexScopeIds: manifest.indexScopeIds
  });
  const archivedV1SnapshotManifestSchema =
    archivedV1SnapshotManifestBaseSchema.superRefine(
      refineArchivedV1SnapshotManifest
    );
  const authorizedSnapshotManifestSchema = authorizedSnapshotManifestBaseSchema
    .extend({ coverage: inboxV2SnapshotManifestCoverageSchema })
    .strict()
    .superRefine((manifest, context) => {
      refineAuthorizedSnapshotManifest(manifest, context);
      const expectedDefinitionHash =
        calculateInboxV2SnapshotManifestDefinitionHash(
          snapshotManifestDefinitionHashInput(manifest)
        );
      if (
        manifest.manifestDefinitionHash !== expectedDefinitionHash ||
        !verifyInboxV2SnapshotManifestHash({
          manifestDefinitionHash: manifest.manifestDefinitionHash,
          coverage: manifest.coverage,
          manifestHash: manifest.manifestHash
        })
      ) {
        context.addIssue({
          code: "custom",
          path: ["manifestDefinitionHash"],
          message:
            "Snapshot manifest hash must commit its exact semantic definition and authoritative coverage."
        });
      }
    });
  type AuthorizedSnapshotManifest = z.output<
    typeof authorizedSnapshotManifestSchema
  >;
  const stripSnapshotManifestAuthorizationEvidence = (
    manifest: AuthorizedSnapshotManifest
  ) => ({
    completeness: manifest.completeness,
    registrations: manifest.registrations.map((registration) => ({
      projectionTypeId: registration.projectionTypeId,
      entityTypeId: registration.entityTypeId,
      stateSchemaId: registration.stateSchemaId,
      stateSchemaVersion: registration.stateSchemaVersion,
      valueContextValidator: registration.valueContextValidator
    })),
    indexScopeIds: manifest.indexScopeIds,
    manifestDefinitionHash: manifest.manifestDefinitionHash,
    manifestHash: manifest.manifestHash,
    coverage: manifest.coverage
  });
  const authorizedSnapshotUpsertSchema =
    createInboxV2RecipientUpsertChangeSchema(input);
  const authorizedSnapshotEntitiesSchema = z
    .array(authorizedSnapshotUpsertSchema)
    .max(INBOX_V2_MAX_SYNC_BATCH_CHANGES);
  const snapshotPageSchema = wireContracts.snapshotPageSchema;
  const snapshotPageEnvelopeSchema = wireContracts.snapshotPageEnvelopeSchema;
  const archivedV1SnapshotEntitiesSchema = z
    .array(
      createInboxV2ArchivedV1RecipientUpsertChangeSchema({
        projections: input.archivedV1Projections
      })
    )
    .max(INBOX_V2_MAX_SYNC_BATCH_CHANGES);
  type AuthorizedSnapshotEntities = z.output<
    typeof authorizedSnapshotEntitiesSchema
  >;

  const snapshotEntitiesAreValid = (page: {
    tenantId: string;
    authorizationEpoch: string;
    authorizationNotAfter: string;
    employeeId: string;
    snapshotCheckpoint: string;
    entities: AuthorizedSnapshotEntities;
    authorization?: AuthorizationSnapshot;
    projectionRegistry?: typeof registry;
  }): boolean =>
    recipientAuthorizationDecisionReferencesAreConsistent(
      page.entities.map((entity) => entity.authorizationDecisionRefs)
    ) &&
    (page.authorization === undefined ||
      recipientAuthorizationDecisionsMatchSnapshot(
        page.entities.map((entity) => entity.authorizationDecisionRefs),
        page.authorization
      )) &&
    !page.entities.some((entity) => {
      const registration = findRecipientProjectionRegistration(
        page.projectionRegistry ?? registry,
        entity
      );
      return (
        entity.entity.tenantId !== page.tenantId ||
        (entity.timeline !== null &&
          entity.timeline.conversation.tenantId !== page.tenantId) ||
        BigInt(entity.lastChangedStreamPosition) >
          BigInt(page.snapshotCheckpoint) ||
        registration === undefined ||
        !registration.authorizationRequirements.every((requirement) => {
          const resource = recipientRequirementResource(requirement, entity);
          return (
            resource !== null &&
            entity.authorizationDecisionRefs.some(
              (decision) =>
                decision.permissionId === requirement.permissionId &&
                decision.resourceScopeId === requirement.resourceScopeId &&
                sameJsonValue(decision.resource, resource) &&
                decision.principal.kind === "employee" &&
                decision.principal.employee.id === page.employeeId &&
                decision.outcome === "allowed"
            )
          );
        }) ||
        entity.authorizationDecisionRefs.some(
          (decision) =>
            decision.tenantId !== page.tenantId ||
            decision.authorizationEpoch !== page.authorizationEpoch ||
            decision.principal.kind !== "employee" ||
            decision.principal.employee.id !== page.employeeId ||
            decision.outcome !== "allowed" ||
            Date.parse(decision.decidedAt) >=
              Date.parse(page.authorizationNotAfter) ||
            !isInboxV2TimestampOrderValid(
              page.authorizationNotAfter,
              decision.notAfter
            )
        )
      );
    });
  const snapshotEntityPositionKey = (
    entity: z.output<typeof inboxV2EntityKeySchema>
  ) => `${entity.entityTypeId}\u0000${entity.entityId}`;

  const archivedV1SnapshotPageBaseSchema = z
    .object({
      tenantId: inboxV2TenantIdSchema,
      streamEpoch: inboxV2StreamEpochSchema,
      syncGeneration: inboxV2SyncGenerationSchema,
      scopeId: inboxV2RecipientScopeIdSchema,
      scope: inboxV2RecipientScopeSchema,
      authorizationEpoch: inboxV2AuthorizationEpochSchema,
      authorizationNotAfter: inboxV2TimestampSchema,
      manifest: archivedV1SnapshotManifestSchema,
      snapshotId: inboxV2SnapshotIdSchema,
      snapshotCheckpoint: inboxV2ProjectionCheckpointSchema,
      resumeAfter: inboxV2SyncCursorSchema,
      pageCursor: inboxV2SyncCursorSchema.nullable(),
      pagePositionHash: inboxV2Sha256DigestSchema.nullable(),
      hasMore: z.boolean(),
      entities: archivedV1SnapshotEntitiesSchema
    })
    .strict();
  const archivedV1SnapshotPageSchema =
    archivedV1SnapshotPageBaseSchema.superRefine((page, context) => {
      const entityKeys = page.entities.map((entity) =>
        snapshotEntityPositionKey(entity.entity)
      );
      if (
        page.scopeId !== page.scope.id ||
        page.scope.employee.tenantId !== page.tenantId ||
        jsonUtf8ByteLength(page) > INBOX_V2_MAX_SYNC_FRAME_BYTES ||
        new Set(entityKeys).size !== entityKeys.length ||
        entityKeys.some(
          (key, index) => index > 0 && key <= entityKeys[index - 1]!
        ) ||
        (page.hasMore && page.pageCursor === null) ||
        (!page.hasMore && page.pageCursor !== null) ||
        (page.hasMore && page.pagePositionHash === null) ||
        (!page.hasMore && page.pagePositionHash !== null) ||
        !snapshotEntitiesAreValid({
          tenantId: page.tenantId,
          authorizationEpoch: page.authorizationEpoch,
          authorizationNotAfter: page.authorizationNotAfter,
          employeeId: page.scope.employee.id,
          snapshotCheckpoint: page.snapshotCheckpoint,
          entities: page.entities,
          projectionRegistry: archivedV1Registry
        })
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Snapshot page must come from one repeatable authorized checkpoint and resume strictly after it."
        });
      }
    });

  const archivedV1SnapshotPageEnvelopeSchema =
    createInboxV2SchemaEnvelopeSchema(
      INBOX_V2_RECIPIENT_SNAPSHOT_PAGE_SCHEMA_ID,
      INBOX_V2_RECIPIENT_SYNC_ARCHIVED_SCHEMA_VERSION,
      archivedV1SnapshotPageSchema
    );
  /** Internal producer gate; serialize only `page` after validation. */
  const snapshotPageProducerDeliverySchema = z
    .object({
      page: snapshotPageEnvelopeSchema,
      authorizedManifest: authorizedSnapshotManifestSchema,
      authorizedEntities: authorizedSnapshotEntitiesSchema,
      frozenAuthorization: inboxV2AuthorizationEpochSnapshotSchema,
      acceptedInput: z.discriminatedUnion("kind", [
        z
          .object({
            kind: z.literal("first_page"),
            inputCursor: z.null(),
            authorizationProof:
              inboxV2AcceptedSnapshotStartAuthorizationValidationProofSchema
          })
          .strict(),
        z
          .object({
            kind: z.literal("continuation"),
            proof: inboxV2AcceptedSnapshotPageCursorValidationProofSchema
          })
          .strict()
      ]),
      snapshotContext: inboxV2SnapshotPageCursorValidationContextSchema,
      resumeCursorMint: inboxV2SyncCursorMintSchema.nullable(),
      pageCursorMint: inboxV2SnapshotPageCursorMintSchema.nullable()
    })
    .strict()
    .superRefine((delivery, context) => {
      const page = delivery.page.payload;
      const resume = delivery.resumeCursorMint;
      const pageMint = delivery.pageCursorMint;
      const position = page.pagePosition;
      const snapshotContext = delivery.snapshotContext;
      const frozenAuthorization = delivery.frozenAuthorization;
      const invalidProducerAuthorization =
        !sameJsonValue(
          page.manifest,
          stripSnapshotManifestAuthorizationEvidence(
            delivery.authorizedManifest
          )
        ) ||
        !sameJsonValue(
          page.entities,
          delivery.authorizedEntities.map(
            stripRecipientChangeAuthorizationEvidence
          )
        ) ||
        !authorizationSnapshotBindsRecipient({
          authorization: frozenAuthorization,
          tenantId: page.tenantId,
          employeeId: page.scope.employee.id,
          authorizationEpoch: page.authorizationEpoch,
          authorizationNotAfter: page.authorizationNotAfter
        }) ||
        Date.parse(page.snapshotIssuedAt) <
          Date.parse(frozenAuthorization.evaluatedAt) ||
        !snapshotEntitiesAreValid({
          tenantId: page.tenantId,
          authorizationEpoch: page.authorizationEpoch,
          authorizationNotAfter: page.authorizationNotAfter,
          employeeId: page.scope.employee.id,
          snapshotCheckpoint: page.snapshotCheckpoint,
          entities: delivery.authorizedEntities,
          authorization: frozenAuthorization
        });
      const invalidInput =
        delivery.acceptedInput.kind === "first_page"
          ? position.ordinal !== "1" ||
            position.afterExclusive !== null ||
            position.previousPageHash !== null ||
            position.previousCumulativeEntityCount !== "0" ||
            position.previousCumulativePageChainHash !== null ||
            delivery.acceptedInput.authorizationProof.snapshotContextHash !==
              page.snapshotContextHash ||
            delivery.acceptedInput.authorizationProof.checkedAt !==
              snapshotContext.now ||
            delivery.acceptedInput.authorizationProof.currentAuthorization
              .tenantId !== page.tenantId ||
            delivery.acceptedInput.authorizationProof.currentAuthorization
              .employee.id !== page.scope.employee.id ||
            Date.parse(delivery.acceptedInput.authorizationProof.checkedAt) <
              Date.parse(page.snapshotIssuedAt) ||
            !inboxV2AuthorizationSecurityStatesMatch(
              delivery.acceptedInput.authorizationProof.currentAuthorization,
              frozenAuthorization
            ) ||
            !inboxV2AuthorizationSnapshotsMatch(
              delivery.acceptedInput.authorizationProof.currentAuthorization,
              snapshotContext.currentAuthorization
            )
          : delivery.acceptedInput.proof.nextPageOrdinal !== position.ordinal ||
            !sameJsonValue(
              delivery.acceptedInput.proof.afterExclusive,
              position.afterExclusive
            ) ||
            delivery.acceptedInput.proof.acceptedPageHash !==
              position.previousPageHash ||
            delivery.acceptedInput.proof.acceptedCumulativeEntityCount !==
              position.previousCumulativeEntityCount ||
            delivery.acceptedInput.proof.acceptedCumulativePageChainHash !==
              position.previousCumulativePageChainHash ||
            delivery.acceptedInput.proof.validationContext.tenantId !==
              page.tenantId ||
            delivery.acceptedInput.proof.validationContext.employee.id !==
              page.scope.employee.id ||
            delivery.acceptedInput.proof.validationContext.scopeId !==
              page.scopeId ||
            delivery.acceptedInput.proof.validationContext.snapshotId !==
              page.snapshotId ||
            delivery.acceptedInput.proof.validationContext.streamEpoch !==
              page.streamEpoch ||
            delivery.acceptedInput.proof.validationContext.syncGeneration !==
              page.syncGeneration ||
            delivery.acceptedInput.proof.validationContext.schemaVersion !==
              delivery.page.schemaVersion ||
            delivery.acceptedInput.proof.validationContext
              .snapshotCheckpoint !== page.snapshotCheckpoint ||
            delivery.acceptedInput.proof.validationContext.manifestHash !==
              page.manifest.manifestHash ||
            delivery.acceptedInput.proof.validationContext
              .snapshotContextHash !== page.snapshotContextHash ||
            delivery.acceptedInput.proof.validationContext.snapshotIssuedAt !==
              page.snapshotIssuedAt ||
            !sameJsonValue(
              delivery.acceptedInput.proof.validationContext.coverage,
              page.manifest.coverage
            ) ||
            !inboxV2AuthorizationSnapshotsMatch(
              delivery.acceptedInput.proof.validationContext
                .frozenAuthorization,
              frozenAuthorization
            ) ||
            !inboxV2AuthorizationSecurityStatesMatch(
              delivery.acceptedInput.proof.validationContext
                .currentAuthorization,
              frozenAuthorization
            ) ||
            !sameJsonValue(
              delivery.acceptedInput.proof.validationContext,
              snapshotContext
            );
      const invalidSnapshotContext =
        snapshotContext.tenantId !== page.tenantId ||
        snapshotContext.employee.id !== page.scope.employee.id ||
        snapshotContext.scopeId !== page.scopeId ||
        snapshotContext.snapshotId !== page.snapshotId ||
        snapshotContext.streamEpoch !== page.streamEpoch ||
        snapshotContext.syncGeneration !== page.syncGeneration ||
        snapshotContext.schemaVersion !== delivery.page.schemaVersion ||
        snapshotContext.snapshotCheckpoint !== page.snapshotCheckpoint ||
        snapshotContext.manifestHash !== page.manifest.manifestHash ||
        snapshotContext.snapshotContextHash !== page.snapshotContextHash ||
        snapshotContext.snapshotIssuedAt !== page.snapshotIssuedAt ||
        !sameJsonValue(snapshotContext.coverage, page.manifest.coverage) ||
        Date.parse(snapshotContext.now) <
          Date.parse(snapshotContext.snapshotIssuedAt) ||
        Date.parse(snapshotContext.now) >=
          Date.parse(
            inboxV2EffectiveAuthorizationNotAfter(
              snapshotContext.currentAuthorization
            )
          ) ||
        snapshotContext.currentAuthorization.evaluatedAt !==
          snapshotContext.now ||
        !inboxV2AuthorizationSnapshotsMatch(
          snapshotContext.frozenAuthorization,
          frozenAuthorization
        ) ||
        !inboxV2AuthorizationSecurityStatesMatch(
          snapshotContext.currentAuthorization,
          frozenAuthorization
        );
      const invalidResume = page.hasMore
        ? page.resumeAfter !== null || resume !== null
        : resume === null ||
          page.resumeAfter === null ||
          resume.cursor !== page.resumeAfter ||
          resume.claims.tenantId !== page.tenantId ||
          resume.claims.employee.id !== page.scope.employee.id ||
          resume.claims.scopeId !== page.scopeId ||
          resume.claims.streamEpoch !== page.streamEpoch ||
          resume.claims.syncGeneration !== page.syncGeneration ||
          resume.claims.authorizationEpoch !== page.authorizationEpoch ||
          resume.claims.notAfter !== page.authorizationNotAfter ||
          !inboxV2AuthorizationSnapshotsMatch(
            resume.authorization,
            frozenAuthorization
          ) ||
          resume.claims.schemaVersion !== delivery.page.schemaVersion ||
          String(resume.claims.scannedThrough) !==
            String(page.snapshotCheckpoint) ||
          resume.claims.resumeMode !== "delta" ||
          resume.claims.issuedAt !== page.snapshotIssuedAt;
      const invalidPageCursor = page.hasMore
        ? pageMint === null ||
          page.pageCursor !== pageMint.cursor ||
          pageMint.claims.tenantId !== page.tenantId ||
          pageMint.claims.employee.id !== page.scope.employee.id ||
          pageMint.claims.scopeId !== page.scopeId ||
          pageMint.claims.snapshotId !== page.snapshotId ||
          pageMint.claims.streamEpoch !== page.streamEpoch ||
          pageMint.claims.syncGeneration !== page.syncGeneration ||
          pageMint.claims.authorizationEpoch !== page.authorizationEpoch ||
          pageMint.claims.notAfter !== page.authorizationNotAfter ||
          !inboxV2AuthorizationSnapshotsMatch(
            pageMint.authorization,
            frozenAuthorization
          ) ||
          pageMint.claims.issuedAt !== page.snapshotIssuedAt ||
          pageMint.claims.schemaVersion !== delivery.page.schemaVersion ||
          pageMint.claims.snapshotCheckpoint !== page.snapshotCheckpoint ||
          pageMint.claims.manifestHash !== page.manifest.manifestHash ||
          pageMint.claims.snapshotContextHash !== page.snapshotContextHash ||
          pageMint.claims.nextPageOrdinal !==
            String(BigInt(position.ordinal) + 1n) ||
          !sameJsonValue(
            pageMint.claims.afterExclusive,
            position.throughInclusive
          ) ||
          pageMint.claims.acceptedPageHash !== position.pageHash ||
          pageMint.claims.acceptedCumulativeEntityCount !==
            position.cumulativeEntityCount ||
          pageMint.claims.acceptedCumulativePageChainHash !==
            position.cumulativePageChainHash ||
          pageMint.claims.issuedAt !== page.snapshotIssuedAt
        : pageMint !== null;
      const hasFutureDecision = delivery.authorizedEntities.some((entity) =>
        entity.authorizationDecisionRefs.some(
          (decision) =>
            Date.parse(decision.decidedAt) > Date.parse(page.snapshotIssuedAt)
        )
      );
      if (
        invalidProducerAuthorization ||
        invalidInput ||
        invalidSnapshotContext ||
        invalidResume ||
        invalidPageCursor ||
        hasFutureDecision
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Snapshot delivery must prove its exact input page, frozen context, continuation chain and final-only resume cursor."
        });
      }
    });

  const authorizedScopeTransitionBaseSchema = z
    .object({
      kind: z.literal("scope_transition"),
      tenantId: inboxV2TenantIdSchema,
      streamEpoch: inboxV2StreamEpochSchema,
      syncGeneration: inboxV2SyncGenerationSchema,
      previousScopeId: inboxV2RecipientScopeIdSchema,
      resultingScope: inboxV2RecipientScopeSchema,
      transitionCause: z.enum([
        "grant_or_expand",
        "revoke_or_narrow",
        "mixed_or_temporal"
      ]),
      previousAuthorizationEpoch: inboxV2AuthorizationEpochSchema,
      resultingAuthorizationEpoch: inboxV2AuthorizationEpochSchema,
      authorizationNotAfter: inboxV2TimestampSchema,
      authorizationDecisionRefs: z
        .array(inboxV2AuthorizationDecisionReferenceSchema)
        .min(1)
        .max(64),
      transitionPosition: inboxV2TenantStreamCommitPositionSchema,
      scannedThrough: inboxV2TenantStreamCommitPositionSchema,
      projectionCheckpoint: inboxV2ProjectionCheckpointSchema,
      cursor: inboxV2SyncCursorSchema,
      sseEventId: inboxV2SyncCursorSchema,
      invalidations: z
        .array(inboxV2RecipientSecurityPurgeChangeSchema)
        .max(1_000),
      closeAfterDelivery: z.literal(true),
      nextAction: z.literal("snapshot_required")
    })
    .strict();
  const refineAuthorizedScopeTransition = (
    transition: z.output<typeof authorizedScopeTransitionBaseSchema>,
    context: z.RefinementCtx
  ) => {
    const transitionDecisionsInvalid =
      !recipientAuthorizationDecisionReferencesAreConsistent([
        transition.authorizationDecisionRefs,
        ...transition.invalidations.map(
          (change) => change.authorizationDecisionRefs
        )
      ]) ||
      transition.authorizationDecisionRefs.some(
        (decision) =>
          decision.tenantId !== transition.tenantId ||
          decision.authorizationEpoch !==
            transition.resultingAuthorizationEpoch ||
          decision.principal.kind !== "employee" ||
          decision.principal.employee.id !==
            transition.resultingScope.employee.id ||
          Date.parse(decision.decidedAt) >=
            Date.parse(transition.authorizationNotAfter) ||
          !isInboxV2TimestampOrderValid(
            transition.authorizationNotAfter,
            decision.notAfter
          )
      );
    const hasAllowed = transition.authorizationDecisionRefs.some(
      (decision) => decision.outcome === "allowed"
    );
    const hasDenied = transition.authorizationDecisionRefs.some(
      (decision) => decision.outcome === "denied"
    );
    const invalidCauseEvidence =
      transition.transitionCause === "grant_or_expand"
        ? transition.invalidations.length !== 0 || !hasAllowed || hasDenied
        : transition.transitionCause === "revoke_or_narrow"
          ? transition.invalidations.length === 0 || !hasDenied
          : transition.invalidations.length === 0 || !hasAllowed || !hasDenied;
    const deniedRequiresRecipientPurge =
      hasDenied &&
      !transition.invalidations.some(
        (change) => change.scope.kind === "recipient_scope"
      );
    if (
      transition.previousAuthorizationEpoch ===
        transition.resultingAuthorizationEpoch ||
      transition.resultingScope.employee.tenantId !== transition.tenantId ||
      transition.cursor !== transition.sseEventId ||
      transition.scannedThrough !== transition.transitionPosition ||
      String(transition.projectionCheckpoint) !==
        String(transition.scannedThrough) ||
      transitionDecisionsInvalid ||
      invalidCauseEvidence ||
      deniedRequiresRecipientPurge ||
      transition.invalidations.some(
        (change) =>
          !invalidationScopeBelongsToTenant(
            change.scope,
            transition.tenantId
          ) ||
          change.resultingAuthorizationEpoch !==
            transition.resultingAuthorizationEpoch ||
          change.authorizationDecisionRefs.some(
            (decision) =>
              decision.tenantId !== transition.tenantId ||
              decision.authorizationEpoch !==
                transition.resultingAuthorizationEpoch ||
              decision.principal.kind !== "employee" ||
              decision.principal.employee.id !==
                transition.resultingScope.employee.id ||
              decision.outcome !== "denied" ||
              Date.parse(decision.decidedAt) >=
                Date.parse(transition.authorizationNotAfter) ||
              !isInboxV2TimestampOrderValid(
                transition.authorizationNotAfter,
                decision.notAfter
              )
          )
      )
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Scope transition carries only bounded invalidations, mints a new-scope cursor and then closes."
      });
    }
  };
  const archivedV1ScopeTransitionSchema =
    authorizedScopeTransitionBaseSchema.superRefine(
      refineAuthorizedScopeTransition
    );
  /** Client wire transition; full authorization snapshots are producer-only. */
  const authorizedScopeTransitionSchema =
    authorizedScopeTransitionBaseSchema.superRefine(
      refineAuthorizedScopeTransition
    );
  const scopeTransitionSchema = wireContracts.scopeTransitionSchema;

  const realtimeReadySchema = wireContracts.realtimeReadySchema;

  const realtimeHeartbeatSchema = wireContracts.realtimeHeartbeatSchema;

  const realtimeEnvelopeSchema = wireContracts.realtimeEnvelopeSchema;

  /** Internal producer gate; the authorization snapshot is never serialized. */
  const realtimeReadyProducerDeliverySchema = z
    .object({
      ready: realtimeReadySchema,
      authorization: inboxV2AuthorizationEpochSnapshotSchema
    })
    .strict()
    .superRefine((delivery, context) => {
      const { ready, authorization } = delivery;
      if (
        authorization.evaluatedAt !== ready.connectedAt ||
        !authorizationSnapshotBindsRecipient({
          authorization,
          tenantId: ready.tenantId,
          employeeId: ready.scope.employee.id,
          authorizationEpoch: ready.authorizationEpoch,
          authorizationNotAfter: ready.authorizationNotAfter
        })
      ) {
        context.addIssue({
          code: "custom",
          path: ["authorization"],
          message:
            "Realtime ready delivery must use a fresh current authorization snapshot."
        });
      }
    });

  /** Internal producer gate required before every active heartbeat emission. */
  const realtimeHeartbeatProducerDeliverySchema = z
    .object({
      heartbeat: realtimeHeartbeatSchema,
      scope: inboxV2RecipientScopeSchema,
      authorization: inboxV2AuthorizationEpochSnapshotSchema
    })
    .strict()
    .superRefine((delivery, context) => {
      const { heartbeat, scope, authorization } = delivery;
      if (
        scope.id !== heartbeat.scopeId ||
        scope.employee.tenantId !== heartbeat.tenantId ||
        authorization.evaluatedAt !== heartbeat.sentAt ||
        !authorizationSnapshotBindsRecipient({
          authorization,
          tenantId: heartbeat.tenantId,
          employeeId: scope.employee.id,
          authorizationEpoch: heartbeat.authorizationEpoch,
          authorizationNotAfter: heartbeat.authorizationNotAfter
        })
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Realtime heartbeat delivery must revalidate one current tenant scope before emission."
        });
      }
    });

  const archivedV1RealtimeReadySchema = z
    .object({
      kind: z.literal("ready"),
      tenantId: inboxV2TenantIdSchema,
      streamEpoch: inboxV2StreamEpochSchema,
      syncGeneration: inboxV2SyncGenerationSchema,
      scope: inboxV2RecipientScopeSchema,
      authorizationEpoch: inboxV2AuthorizationEpochSchema,
      authorizationNotAfter: inboxV2TimestampSchema,
      projectionCheckpoint: inboxV2ProjectionCheckpointSchema,
      tenantStreamHead: inboxV2TenantStreamPositionSchema,
      lagPositions: inboxV2BigintCounterSchema,
      connectedAt: inboxV2TimestampSchema
    })
    .strict()
    .superRefine((ready, context) => {
      if (
        ready.scope.employee.tenantId !== ready.tenantId ||
        BigInt(ready.tenantStreamHead) < BigInt(ready.projectionCheckpoint) ||
        BigInt(ready.lagPositions) !==
          BigInt(ready.tenantStreamHead) - BigInt(ready.projectionCheckpoint) ||
        Date.parse(ready.connectedAt) >= Date.parse(ready.authorizationNotAfter)
      ) {
        context.addIssue({
          code: "custom",
          message: "Archived realtime ready frame is internally inconsistent."
        });
      }
    });
  const archivedV1RealtimeHeartbeatSchema = z
    .object({
      kind: z.literal("heartbeat"),
      tenantId: inboxV2TenantIdSchema,
      scopeId: inboxV2RecipientScopeIdSchema,
      streamEpoch: inboxV2StreamEpochSchema,
      syncGeneration: inboxV2SyncGenerationSchema,
      projectionCheckpoint: inboxV2ProjectionCheckpointSchema,
      tenantStreamHead: inboxV2TenantStreamPositionSchema,
      lagPositions: inboxV2BigintCounterSchema,
      sentAt: inboxV2TimestampSchema
    })
    .strict()
    .superRefine((heartbeat, context) => {
      if (
        BigInt(heartbeat.tenantStreamHead) <
          BigInt(heartbeat.projectionCheckpoint) ||
        BigInt(heartbeat.lagPositions) !==
          BigInt(heartbeat.tenantStreamHead) -
            BigInt(heartbeat.projectionCheckpoint)
      ) {
        context.addIssue({
          code: "custom",
          message: "Archived heartbeat lag must be exact."
        });
      }
    });
  const archivedV1RealtimeDeltaSchema = z
    .object({
      kind: z.literal("delta"),
      batch: archivedV1SyncBatchEnvelopeSchema,
      sseEventId: inboxV2SyncCursorSchema
    })
    .strict()
    .superRefine((delta, context) => {
      if (delta.sseEventId !== delta.batch.payload.cursor) {
        context.addIssue({
          code: "custom",
          message: "Archived delta ID must equal its batch cursor."
        });
      }
    });
  const archivedV1RealtimeResyncSchema = z
    .object({
      kind: z.literal("resync_required"),
      tenantId: inboxV2TenantIdSchema,
      scopeId: inboxV2RecipientScopeIdSchema,
      errorCode: inboxV2SyncCursorErrorCodeSchema,
      invalidations: z.array(inboxV2InvalidationScopeSchema).min(1).max(1_000),
      close: z.literal(true)
    })
    .strict()
    .superRefine((resync, context) => {
      if (
        resync.invalidations.some(
          (scope) => !invalidationScopeBelongsToTenant(scope, resync.tenantId)
        )
      ) {
        context.addIssue({
          code: "custom",
          message: "Archived resync invalidations cannot cross tenants."
        });
      }
    });
  const archivedV1RealtimeEnvelopeSchema = createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_REALTIME_ENVELOPE_SCHEMA_ID,
    INBOX_V2_RECIPIENT_SYNC_ARCHIVED_SCHEMA_VERSION,
    z
      .discriminatedUnion("kind", [
        archivedV1RealtimeReadySchema,
        archivedV1RealtimeHeartbeatSchema,
        archivedV1RealtimeDeltaSchema,
        archivedV1ScopeTransitionSchema,
        archivedV1RealtimeResyncSchema
      ])
      .superRefine((payload, context) => {
        if (jsonUtf8ByteLength(payload) > INBOX_V2_MAX_SYNC_FRAME_BYTES) {
          context.addIssue({
            code: "custom",
            message: "Archived realtime frame exceeds the byte budget."
          });
        }
      })
  );

  /** Internal producer gate; serialize only `transition` after validation. */
  const scopeTransitionProducerDeliverySchema = z
    .object({
      transition: scopeTransitionSchema,
      authorizedTransition: authorizedScopeTransitionSchema,
      previousAuthorization: inboxV2AuthorizationEpochSnapshotSchema,
      resultingAuthorization: inboxV2AuthorizationEpochSnapshotSchema,
      inputCursorProof: inboxV2ScopeTransitionInputCursorProofSchema,
      cursorMint: inboxV2SyncCursorMintSchema,
      producedAt: inboxV2TimestampSchema
    })
    .strict()
    .superRefine((delivery, context) => {
      const transition = delivery.transition;
      const authorizedTransition = delivery.authorizedTransition;
      const previousAuthorization = delivery.previousAuthorization;
      const resultingAuthorization = delivery.resultingAuthorization;
      const input = delivery.inputCursorProof;
      const mint = delivery.cursorMint;
      if (
        !sameJsonValue(
          transition,
          stripScopeTransitionAuthorizationEvidence(authorizedTransition)
        ) ||
        !authorizationSnapshotBindsRecipient({
          authorization: resultingAuthorization,
          tenantId: transition.tenantId,
          employeeId: transition.resultingScope.employee.id,
          authorizationEpoch: transition.resultingAuthorizationEpoch,
          authorizationNotAfter: transition.authorizationNotAfter
        }) ||
        previousAuthorization.tenantId !== transition.tenantId ||
        previousAuthorization.employee.id !==
          transition.resultingScope.employee.id ||
        previousAuthorization.value !== transition.previousAuthorizationEpoch ||
        !recipientAuthorizationDecisionsMatchSnapshot(
          [
            authorizedTransition.authorizationDecisionRefs,
            ...authorizedTransition.invalidations.map(
              (change) => change.authorizationDecisionRefs
            )
          ],
          resultingAuthorization
        ) ||
        input.claims.tenantId !== transition.tenantId ||
        input.claims.employee.id !== transition.resultingScope.employee.id ||
        input.claims.scopeId !== transition.previousScopeId ||
        input.claims.streamEpoch !== transition.streamEpoch ||
        input.claims.syncGeneration !== transition.syncGeneration ||
        input.claims.authorizationEpoch !==
          transition.previousAuthorizationEpoch ||
        input.claims.authorizationEpoch !== previousAuthorization.value ||
        input.claims.notAfter !==
          inboxV2EffectiveAuthorizationNotAfter(previousAuthorization) ||
        Date.parse(input.claims.issuedAt) <
          Date.parse(previousAuthorization.evaluatedAt) ||
        input.claims.schemaVersion !== INBOX_V2_RECIPIENT_SYNC_SCHEMA_VERSION ||
        BigInt(input.claims.scannedThrough) >=
          BigInt(transition.transitionPosition) ||
        mint.cursor !== transition.cursor ||
        mint.claims.tenantId !== transition.tenantId ||
        mint.claims.employee.id !== transition.resultingScope.employee.id ||
        mint.claims.scopeId !== transition.resultingScope.id ||
        mint.claims.streamEpoch !== transition.streamEpoch ||
        mint.claims.syncGeneration !== transition.syncGeneration ||
        mint.claims.authorizationEpoch !==
          transition.resultingAuthorizationEpoch ||
        mint.claims.notAfter !== transition.authorizationNotAfter ||
        !inboxV2AuthorizationSnapshotsMatch(
          mint.authorization,
          resultingAuthorization
        ) ||
        resultingAuthorization.evaluatedAt !== delivery.producedAt ||
        mint.claims.issuedAt !== delivery.producedAt ||
        Date.parse(delivery.producedAt) < Date.parse(input.verifiedAt) ||
        mint.claims.schemaVersion !== INBOX_V2_RECIPIENT_SYNC_SCHEMA_VERSION ||
        mint.claims.scannedThrough !== transition.scannedThrough ||
        mint.claims.resumeMode !== "snapshot_required" ||
        authorizedTransition.authorizationDecisionRefs.some(
          (decision) =>
            Date.parse(decision.decidedAt) > Date.parse(mint.claims.issuedAt)
        ) ||
        authorizedTransition.invalidations.some((change) =>
          change.authorizationDecisionRefs.some(
            (decision) =>
              Date.parse(decision.decidedAt) > Date.parse(mint.claims.issuedAt)
          )
        )
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Scope-transition cursor must bind the exact resulting scope, epoch and transition position."
        });
      }
    });

  return Object.freeze({
    entityChangeSchema,
    authorizedEntityChangeSchema,
    recipientCommitSchema,
    authorizedRecipientCommitSchema,
    archivedV1SyncBatchSchema,
    archivedV1SyncBatchEnvelopeSchema,
    syncBatchSchema,
    syncBatchEnvelopeSchema,
    syncBatchProducerDeliverySchema,
    archivedV1SnapshotPageSchema,
    archivedV1SnapshotPageEnvelopeSchema,
    snapshotPageSchema,
    snapshotPageEnvelopeSchema,
    snapshotPageProducerDeliverySchema,
    scopeTransitionSchema,
    scopeTransitionProducerDeliverySchema,
    realtimeReadyProducerDeliverySchema,
    realtimeHeartbeatProducerDeliverySchema,
    archivedV1RealtimeEnvelopeSchema,
    realtimeEnvelopeSchema,
    parseSyncBatchEnvelope(input: unknown) {
      return wireContracts.parseSyncBatchEnvelope(input);
    },
    parseArchivedV1SyncBatchEnvelope(input: unknown) {
      return parseArchivedRecipientSyncEnvelope({
        value: input,
        schemaId: INBOX_V2_RECIPIENT_SYNC_BATCH_SCHEMA_ID,
        archivedSchema: archivedV1SyncBatchEnvelopeSchema
      });
    },
    parseSnapshotPageEnvelope(input: unknown) {
      return wireContracts.parseSnapshotPageEnvelope(input);
    },
    parseArchivedV1SnapshotPageEnvelope(input: unknown) {
      return parseArchivedRecipientSyncEnvelope({
        value: input,
        schemaId: INBOX_V2_RECIPIENT_SNAPSHOT_PAGE_SCHEMA_ID,
        archivedSchema: archivedV1SnapshotPageEnvelopeSchema
      });
    },
    parseRealtimeEnvelope(input: unknown) {
      return wireContracts.parseRealtimeEnvelope(input);
    },
    parseArchivedV1RealtimeEnvelope(input: unknown) {
      return parseArchivedRecipientSyncEnvelope({
        value: input,
        schemaId: INBOX_V2_REALTIME_ENVELOPE_SCHEMA_ID,
        archivedSchema: archivedV1RealtimeEnvelopeSchema
      });
    }
  });
}

function recipientEntityChangesAreUnique(
  changes: readonly Readonly<{
    projectionTypeId?: string;
    entity?: Readonly<{ entityTypeId: string; entityId: string }>;
  }>[]
): boolean {
  const identities = changes.flatMap((change) =>
    change.projectionTypeId === undefined || change.entity === undefined
      ? []
      : [
          `${change.projectionTypeId}\u0000${change.entity.entityTypeId}\u0000${change.entity.entityId}`
        ]
  );
  return new Set(identities).size === identities.length;
}

function stripRecipientChangeAuthorizationEvidence(
  input: Readonly<Record<string, unknown>> &
    Readonly<{ authorizationDecisionRefs: unknown }>
): Readonly<Record<string, unknown>> {
  const { authorizationDecisionRefs: _authorizationEvidence, ...change } =
    input;
  return change;
}

function stripRecipientSyncBatchAuthorizationEvidence(
  input: Readonly<{
    tenantId: unknown;
    streamEpoch: unknown;
    syncGeneration: unknown;
    scopeId: unknown;
    scope: unknown;
    authorizationEpoch: unknown;
    authorizationNotAfter: unknown;
    fromExclusive: unknown;
    scannedThrough: unknown;
    projectionCheckpoint: unknown;
    hasMore: unknown;
    cursor: unknown;
    commits: readonly Readonly<{
      commitId: unknown;
      streamPosition: unknown;
      clientMutationIds: unknown;
      recipientChangeCount: unknown;
      commitCompleteness: unknown;
      changes: readonly (Readonly<Record<string, unknown>> &
        Readonly<{ authorizationDecisionRefs: unknown }>)[];
    }>[];
  }>
): unknown {
  return {
    tenantId: input.tenantId,
    streamEpoch: input.streamEpoch,
    syncGeneration: input.syncGeneration,
    scopeId: input.scopeId,
    scope: input.scope,
    authorizationEpoch: input.authorizationEpoch,
    authorizationNotAfter: input.authorizationNotAfter,
    fromExclusive: input.fromExclusive,
    scannedThrough: input.scannedThrough,
    projectionCheckpoint: input.projectionCheckpoint,
    hasMore: input.hasMore,
    cursor: input.cursor,
    commits: input.commits.map((commit) => ({
      commitId: commit.commitId,
      streamPosition: commit.streamPosition,
      clientMutationIds: commit.clientMutationIds,
      recipientChangeCount: commit.recipientChangeCount,
      commitCompleteness: commit.commitCompleteness,
      changes: commit.changes.map(stripRecipientChangeAuthorizationEvidence)
    }))
  };
}

function stripScopeTransitionAuthorizationEvidence(
  input: Readonly<Record<string, unknown>> &
    Readonly<{
      authorizationDecisionRefs: unknown;
      invalidations: readonly (Readonly<Record<string, unknown>> &
        Readonly<{ authorizationDecisionRefs: unknown }>)[];
    }>
): Readonly<Record<string, unknown>> {
  const {
    authorizationDecisionRefs: _transitionAuthorizationEvidence,
    invalidations,
    ...transition
  } = input;
  return {
    ...transition,
    invalidations: invalidations.map(stripRecipientChangeAuthorizationEvidence)
  };
}

function recipientAuthorizationDecisionReferencesAreConsistent(
  groups: readonly (readonly Readonly<{ id: string }>[])[]
): boolean {
  const decisionsById = new Map<string, Readonly<{ id: string }>>();
  for (const group of groups) {
    const ids = group.map((decision) => decision.id);
    if (new Set(ids).size !== ids.length) {
      return false;
    }
    for (const decision of group) {
      const existing = decisionsById.get(decision.id);
      if (existing !== undefined && !sameJsonValue(existing, decision)) {
        return false;
      }
      decisionsById.set(decision.id, decision);
    }
  }
  return true;
}

function recipientAuthorizationDecisionsMatchSnapshot(
  groups: readonly (readonly Readonly<{
    resource: Readonly<{
      tenantId: string;
      entityTypeId: string;
      entityId: string;
    }>;
    resourceAccessRevision: string;
  }>[])[],
  authorization: AuthorizationSnapshot
): boolean {
  return groups.every((group) =>
    group.every((decision) =>
      authorization.dependencies.resourceDependencies.some(
        (dependency) =>
          sameJsonValue(dependency.resource, decision.resource) &&
          dependency.accessRevision === decision.resourceAccessRevision
      )
    )
  );
}
