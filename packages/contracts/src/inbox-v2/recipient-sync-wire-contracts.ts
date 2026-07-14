import { z } from "zod";

import { inboxV2AuthorizationEpochSchema } from "./authorization-epoch";
import { inboxV2CatalogIdSchema } from "./catalog";
import {
  inboxV2BigintCounterSchema,
  inboxV2EntityRevisionSchema,
  inboxV2TimestampSchema
} from "./entity-metadata";
import { inboxV2TenantIdSchema } from "./ids";
import {
  createInboxV2SchemaEnvelopeSchema,
  inboxV2SchemaVersionTokenSchema,
  parseInboxV2VersionedEnvelope
} from "./schema-version";
import {
  inboxV2ClientMutationIdSchema,
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
  INBOX_V2_RECIPIENT_SYNC_SCHEMA_VERSION
} from "./recipient-sync-constants";
import {
  inboxV2SnapshotFinalCompletionSchema,
  inboxV2SnapshotManifestCoverageSchema,
  inboxV2SnapshotPagePositionSchema,
  inboxV2SyncCursorErrorCodeSchema
} from "./recipient-sync-cursor";
import {
  verifyInboxV2SnapshotCumulativePageChainHash,
  verifyInboxV2SnapshotManifestHash,
  verifyInboxV2SnapshotPageHash
} from "./recipient-sync-hash";
import {
  invalidationScopeBelongsToTenant,
  jsonUtf8ByteLength,
  sameJsonValue
} from "./recipient-sync-json";
import {
  createInboxV2RecipientWireEntityChangeSchema,
  createInboxV2RecipientWireUpsertChangeSchema,
  inboxV2RecipientWireSecurityPurgeChangeSchema,
  normalizeRecipientWireProjectionRegistrations
} from "./recipient-sync-projection";
import type { InboxV2RecipientWireProjectionRegistration } from "./recipient-sync-projection";

type InboxV2StrictWireProjectionRegistration<
  TValueSchema extends z.ZodType = z.ZodTypeAny
> = InboxV2RecipientWireProjectionRegistration<TValueSchema> &
  Readonly<{
    authorizationRequirements?: never;
    resolveResource?: never;
    verifyRecipientStateFingerprint?: never;
    verifier?: never;
    key?: never;
  }>;

const wireFactoryInputKeys = ["projections", "snapshotIndexScopeIds"] as const;
const wireProjectionRegistrationKeys = [
  "projectionTypeId",
  "entityTypeId",
  "stateSchemaId",
  "stateSchemaVersion",
  "valueContextValidatorId",
  "valueContextValidatorFingerprint",
  "valueSchema",
  "validateValueContext"
] as const;

const forbiddenWirePayloadKeys = new Set([
  "acceptedinput",
  "acceptedinputcursor",
  "authorization",
  "authorizationdecisionrefs",
  "employeeaccessrevision",
  "employeeinboxrelationrevision",
  "authorizationproof",
  "authorizationrequirements",
  "authorizationsnapshot",
  "authorizedbatch",
  "authorizedentities",
  "authorizedmanifest",
  "authorizedtransition",
  "cursormint",
  "currentauthorization",
  "decodedclaims",
  "frozenauthorization",
  "inputcursorproof",
  "pagecursormint",
  "pagemint",
  "previousauthorization",
  "resolveresource",
  "resourceresolver",
  "resourceresolverfingerprint",
  "resourceresolverid",
  "resourcedependencies",
  "resumeclaims",
  "resumecursormint",
  "resultingauthorization",
  "snapshotcontext",
  "sharedaccessrevision",
  "statefingerprintprotection",
  "temporalboundarydigest",
  "tenantrbacrevision",
  "validationcontext",
  "verifyrecipientstatefingerprint"
]);

/**
 * Browser/mobile/desktop parser facade. It intentionally contains only active
 * V2 DTO schemas. Producer evidence and archived compatibility parsers belong
 * to the server composition root, not to this client dependency surface.
 */
export function createInboxV2RecipientWireSyncContracts<
  const TProjections extends readonly InboxV2StrictWireProjectionRegistration[]
>(input: {
  projections: TProjections;
  snapshotIndexScopeIds: readonly string[];
}) {
  assertExactOwnKeys(input, wireFactoryInputKeys, "Recipient wire factory");
  for (const registration of input.projections) {
    assertExactOwnKeys(
      registration,
      wireProjectionRegistrationKeys,
      "Recipient wire projection registration"
    );
  }

  const registrations = normalizeRecipientWireProjectionRegistrations(
    input.projections
  );
  const snapshotIndexScopeIds = input.snapshotIndexScopeIds
    .map((scopeId) => String(inboxV2CatalogIdSchema.parse(scopeId)))
    .sort(compareContractIds);
  if (
    snapshotIndexScopeIds.length === 0 ||
    snapshotIndexScopeIds.length > 64 ||
    new Set(snapshotIndexScopeIds).size !== snapshotIndexScopeIds.length
  ) {
    throw new Error(
      "Recipient wire snapshot manifest requires 1..64 unique index scope IDs."
    );
  }

  const entityChangeSchema = enforceClientWireBoundary(
    createInboxV2RecipientWireEntityChangeSchema({
      projections: input.projections
    })
  );

  const recipientCommitSchema = enforceClientWireBoundary(
    z
      .object({
        commitId: inboxV2TenantStreamCommitIdSchema,
        streamPosition: inboxV2TenantStreamCommitPositionSchema,
        clientMutationIds: z.array(inboxV2ClientMutationIdSchema).max(64),
        recipientChangeCount: inboxV2EntityRevisionSchema,
        commitCompleteness: z.literal("complete"),
        changes: z
          .array(entityChangeSchema)
          .min(1)
          .max(INBOX_V2_MAX_SYNC_COMMIT_CHANGES)
      })
      .strict()
      .superRefine((commit, context) => {
        if (
          BigInt(commit.recipientChangeCount) !==
            BigInt(commit.changes.length) ||
          commit.changes.some(
            (change, index) =>
              BigInt(change.recipientOrdinal) !== BigInt(index + 1) ||
              (index > 0 &&
                BigInt(change.sourceChangeOrdinal) <=
                  BigInt(commit.changes[index - 1]!.sourceChangeOrdinal))
          ) ||
          new Set(commit.clientMutationIds).size !==
            commit.clientMutationIds.length ||
          !recipientEntityChangesAreUnique(commit.changes)
        ) {
          context.addIssue({
            code: "custom",
            message:
              "Recipient wire commit must be complete, ordered, unique and unsplit."
          });
        }
      })
  );

  const syncBatchSchema = enforceClientWireBoundary(
    z
      .object({
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
        cursor: inboxV2SyncCursorSchema,
        commits: z
          .array(recipientCommitSchema)
          .max(INBOX_V2_MAX_SYNC_BATCH_COMMITS)
      })
      .strict()
      .superRefine((batch, context) => {
        const totalChanges = batch.commits.reduce(
          (total, commit) => total + commit.changes.length,
          0
        );
        const commitIds = batch.commits.map((commit) => commit.commitId);
        const mutationIds = batch.commits.flatMap(
          (commit) => commit.clientMutationIds
        );
        if (
          batch.scopeId !== batch.scope.id ||
          batch.scope.employee.tenantId !== batch.tenantId ||
          BigInt(batch.scannedThrough) <= BigInt(batch.fromExclusive) ||
          BigInt(batch.projectionCheckpoint) < BigInt(batch.scannedThrough) ||
          batch.hasMore !==
            BigInt(batch.scannedThrough) < BigInt(batch.projectionCheckpoint) ||
          totalChanges > INBOX_V2_MAX_SYNC_BATCH_CHANGES ||
          jsonUtf8ByteLength(batch) > INBOX_V2_MAX_SYNC_FRAME_BYTES ||
          new Set(commitIds).size !== commitIds.length ||
          new Set(mutationIds).size !== mutationIds.length
        ) {
          context.addIssue({
            code: "custom",
            message:
              "Recipient wire batch must advance one bounded tenant scope through a durable checkpoint."
          });
        }

        let previousPosition = BigInt(batch.fromExclusive);
        for (const [commitIndex, commit] of batch.commits.entries()) {
          const streamPosition = BigInt(commit.streamPosition);
          if (
            streamPosition <= previousPosition ||
            streamPosition > BigInt(batch.scannedThrough)
          ) {
            context.addIssue({
              code: "custom",
              path: ["commits", commitIndex, "streamPosition"],
              message:
                "Recipient wire commits must be strictly ordered inside the scanned range."
            });
          }
          previousPosition = streamPosition;

          for (const [changeIndex, change] of commit.changes.entries()) {
            if (
              change.entity.tenantId !== batch.tenantId ||
              BigInt(change.lastChangedStreamPosition) > streamPosition ||
              (change.timeline !== null &&
                change.timeline.conversation.tenantId !== batch.tenantId)
            ) {
              context.addIssue({
                code: "custom",
                path: ["commits", commitIndex, "changes", changeIndex],
                message:
                  "Recipient wire changes must stay inside the batch tenant and canonical commit."
              });
            }
          }
        }
      })
  );

  const syncBatchEnvelopeSchema = createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_RECIPIENT_SYNC_BATCH_SCHEMA_ID,
    INBOX_V2_RECIPIENT_SYNC_SCHEMA_VERSION,
    syncBatchSchema
  );

  const semanticDeclarationSchema = z
    .object({
      semanticId: inboxV2CatalogIdSchema,
      fingerprint: inboxV2Sha256DigestSchema
    })
    .strict();
  const snapshotRegistrationSchema = z
    .object({
      entityTypeId: inboxV2CatalogIdSchema,
      projectionTypeId: inboxV2CatalogIdSchema,
      stateSchemaId: inboxV2CatalogIdSchema,
      stateSchemaVersion: inboxV2SchemaVersionTokenSchema,
      valueContextValidator: semanticDeclarationSchema
    })
    .strict();
  const expectedSnapshotRegistrations = registrations.map((registration) => ({
    projectionTypeId: registration.projectionTypeId,
    entityTypeId: registration.entityTypeId,
    stateSchemaId: registration.stateSchemaId,
    stateSchemaVersion: registration.stateSchemaVersion,
    valueContextValidator: {
      semanticId: registration.valueContextValidatorId,
      fingerprint: registration.valueContextValidatorFingerprint
    }
  }));
  const snapshotManifestSchema = z
    .object({
      completeness: z.literal("complete_for_scope"),
      registrations: z.array(snapshotRegistrationSchema).min(1).max(256),
      indexScopeIds: z.array(inboxV2CatalogIdSchema).min(1).max(64),
      manifestDefinitionHash: inboxV2Sha256DigestSchema,
      manifestHash: inboxV2Sha256DigestSchema,
      coverage: inboxV2SnapshotManifestCoverageSchema
    })
    .strict()
    .superRefine((manifest, context) => {
      if (
        !sameJsonValue(manifest.registrations, expectedSnapshotRegistrations) ||
        !sameJsonValue(manifest.indexScopeIds, snapshotIndexScopeIds) ||
        !verifyInboxV2SnapshotManifestHash({
          manifestDefinitionHash: manifest.manifestDefinitionHash,
          coverage: manifest.coverage,
          manifestHash: manifest.manifestHash
        })
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Recipient wire manifest must declare exact client schemas and bind its opaque definition commitment to coverage."
        });
      }
    });

  const snapshotEntitiesSchema = z
    .array(
      createInboxV2RecipientWireUpsertChangeSchema({
        projections: input.projections
      })
    )
    .max(INBOX_V2_MAX_SYNC_BATCH_CHANGES);

  const snapshotPageSchema = enforceClientWireBoundary(
    z
      .object({
        tenantId: inboxV2TenantIdSchema,
        streamEpoch: inboxV2StreamEpochSchema,
        syncGeneration: inboxV2SyncGenerationSchema,
        scopeId: inboxV2RecipientScopeIdSchema,
        scope: inboxV2RecipientScopeSchema,
        authorizationEpoch: inboxV2AuthorizationEpochSchema,
        authorizationNotAfter: inboxV2TimestampSchema,
        manifest: snapshotManifestSchema,
        snapshotId: inboxV2SnapshotIdSchema,
        snapshotCheckpoint: inboxV2ProjectionCheckpointSchema,
        snapshotContextHash: inboxV2Sha256DigestSchema,
        snapshotIssuedAt: inboxV2TimestampSchema,
        resumeAfter: inboxV2SyncCursorSchema.nullable(),
        pageCursor: inboxV2SyncCursorSchema.nullable(),
        pagePosition: inboxV2SnapshotPagePositionSchema,
        finalCompletion: inboxV2SnapshotFinalCompletionSchema.nullable(),
        hasMore: z.boolean(),
        entities: snapshotEntitiesSchema
      })
      .strict()
      .superRefine((page, context) => {
        const entityKeys = page.entities.map((entity) =>
          snapshotEntityPositionKey(entity.entity)
        );
        const firstEntity = page.entities[0]?.entity ?? null;
        const finalEntity = page.entities.at(-1)?.entity ?? null;
        const position = page.pagePosition;
        const coverage = page.manifest.coverage;
        const isFirstPage = position.ordinal === "1";
        const isFinalPage = !page.hasMore;

        const invalidRange =
          String(page.entities.length) !== position.entityCount ||
          !sameJsonValue(position.firstInclusive, firstEntity) ||
          !sameJsonValue(position.throughInclusive, finalEntity) ||
          (position.afterExclusive !== null &&
            (position.afterExclusive.tenantId !== page.tenantId ||
              (firstEntity !== null &&
                snapshotEntityPositionKey(firstEntity) <=
                  snapshotEntityPositionKey(position.afterExclusive)))) ||
          entityKeys.some(
            (key, index) => index > 0 && key <= entityKeys[index - 1]!
          );
        const invalidCoverage =
          (coverage.finalEntity !== null &&
            coverage.finalEntity.tenantId !== page.tenantId) ||
          BigInt(position.ordinal) > BigInt(coverage.pageCount) ||
          page.hasMore !==
            BigInt(position.ordinal) < BigInt(coverage.pageCount) ||
          BigInt(position.cumulativeEntityCount) >
            BigInt(coverage.entityCount) ||
          (page.hasMore &&
            BigInt(position.cumulativeEntityCount) >=
              BigInt(coverage.entityCount)) ||
          (page.entities.length === 0 &&
            (!isFirstPage ||
              !isFinalPage ||
              coverage.entityCount !== "0" ||
              coverage.pageCount !== "1"));
        const invalidCompletion = isFinalPage
          ? page.finalCompletion === null ||
            page.finalCompletion.snapshotId !== page.snapshotId ||
            page.finalCompletion.manifestHash !== page.manifest.manifestHash ||
            page.finalCompletion.snapshotCheckpoint !==
              page.snapshotCheckpoint ||
            page.finalCompletion.pageCount !== coverage.pageCount ||
            page.finalCompletion.entityCount !== coverage.entityCount ||
            !sameJsonValue(
              page.finalCompletion.finalEntity,
              coverage.finalEntity
            ) ||
            page.finalCompletion.pageChainRootHash !==
              coverage.pageChainRootHash ||
            position.ordinal !== coverage.pageCount ||
            position.cumulativeEntityCount !== coverage.entityCount ||
            position.cumulativePageChainHash !== coverage.pageChainRootHash ||
            !sameJsonValue(position.throughInclusive, coverage.finalEntity)
          : page.finalCompletion !== null;
        const pageHashIsValid = verifyInboxV2SnapshotPageHash({
          frozenContext: {
            tenantId: page.tenantId,
            scopeId: page.scopeId,
            snapshotId: page.snapshotId,
            streamEpoch: page.streamEpoch,
            syncGeneration: page.syncGeneration,
            authorizationEpoch: page.authorizationEpoch,
            schemaVersion: INBOX_V2_RECIPIENT_SYNC_SCHEMA_VERSION,
            snapshotCheckpoint: page.snapshotCheckpoint,
            snapshotIssuedAt: page.snapshotIssuedAt,
            manifestDefinitionHash: page.manifest.manifestDefinitionHash
          },
          position: {
            ordinal: position.ordinal,
            afterExclusive: position.afterExclusive,
            firstInclusive: position.firstInclusive,
            throughInclusive: position.throughInclusive,
            entityCount: position.entityCount,
            previousPageHash: position.previousPageHash,
            previousCumulativeEntityCount:
              position.previousCumulativeEntityCount,
            cumulativeEntityCount: position.cumulativeEntityCount,
            previousCumulativePageChainHash:
              position.previousCumulativePageChainHash
          },
          entities: page.entities.map((entity) => ({
            projectionTypeId: entity.projectionTypeId,
            entity: entity.entity,
            revision: entity.revision,
            stateHash: entity.stateHash
          })),
          pageHash: position.pageHash
        });
        const pageChainIsValid = verifyInboxV2SnapshotCumulativePageChainHash({
          previousCumulativePageChainHash:
            position.previousCumulativePageChainHash,
          pageHash: position.pageHash,
          cumulativeEntityCount: position.cumulativeEntityCount,
          cumulativePageChainHash: position.cumulativePageChainHash
        });

        if (
          page.scopeId !== page.scope.id ||
          page.scope.employee.tenantId !== page.tenantId ||
          jsonUtf8ByteLength(page) > INBOX_V2_MAX_SYNC_FRAME_BYTES ||
          new Set(entityKeys).size !== entityKeys.length ||
          (page.hasMore &&
            (page.pageCursor === null || page.resumeAfter !== null)) ||
          (!page.hasMore &&
            (page.pageCursor !== null || page.resumeAfter === null)) ||
          Date.parse(page.snapshotIssuedAt) >=
            Date.parse(page.authorizationNotAfter) ||
          page.entities.some(
            (entity) =>
              entity.entity.tenantId !== page.tenantId ||
              BigInt(entity.lastChangedStreamPosition) >
                BigInt(page.snapshotCheckpoint) ||
              (entity.timeline !== null &&
                entity.timeline.conversation.tenantId !== page.tenantId)
          ) ||
          invalidRange ||
          invalidCoverage ||
          invalidCompletion ||
          !pageHashIsValid ||
          !pageChainIsValid
        ) {
          context.addIssue({
            code: "custom",
            message:
              "Recipient wire snapshot must preserve one frozen scope, exact page chain and authoritative final coverage."
          });
        }
      })
  );

  const snapshotPageEnvelopeSchema = createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_RECIPIENT_SNAPSHOT_PAGE_SCHEMA_ID,
    INBOX_V2_RECIPIENT_SYNC_SCHEMA_VERSION,
    snapshotPageSchema
  );

  const scopeTransitionSchema = enforceClientWireBoundary(
    z
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
        transitionPosition: inboxV2TenantStreamCommitPositionSchema,
        scannedThrough: inboxV2TenantStreamCommitPositionSchema,
        projectionCheckpoint: inboxV2ProjectionCheckpointSchema,
        cursor: inboxV2SyncCursorSchema,
        sseEventId: inboxV2SyncCursorSchema,
        invalidations: z
          .array(inboxV2RecipientWireSecurityPurgeChangeSchema)
          .max(1_000),
        closeAfterDelivery: z.literal(true),
        nextAction: z.literal("snapshot_required")
      })
      .strict()
      .superRefine((transition, context) => {
        const invalidCauseShape =
          transition.transitionCause === "grant_or_expand"
            ? transition.invalidations.length !== 0
            : transition.invalidations.length === 0;
        if (
          transition.previousAuthorizationEpoch ===
            transition.resultingAuthorizationEpoch ||
          transition.resultingScope.employee.tenantId !== transition.tenantId ||
          transition.cursor !== transition.sseEventId ||
          transition.scannedThrough !== transition.transitionPosition ||
          String(transition.projectionCheckpoint) !==
            String(transition.scannedThrough) ||
          invalidCauseShape ||
          transition.invalidations.some(
            (change) =>
              !invalidationScopeBelongsToTenant(
                change.scope,
                transition.tenantId
              ) ||
              change.resultingAuthorizationEpoch !==
                transition.resultingAuthorizationEpoch
          )
        ) {
          context.addIssue({
            code: "custom",
            message:
              "Recipient wire scope transition must close one tenant scope with bounded purge instructions."
          });
        }
      })
  );

  const realtimeReadySchema = z
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
          message:
            "Recipient wire ready frame must bind one current tenant scope and exact lag."
        });
      }
    });

  const realtimeHeartbeatSchema = z
    .object({
      kind: z.literal("heartbeat"),
      tenantId: inboxV2TenantIdSchema,
      scopeId: inboxV2RecipientScopeIdSchema,
      streamEpoch: inboxV2StreamEpochSchema,
      syncGeneration: inboxV2SyncGenerationSchema,
      authorizationEpoch: inboxV2AuthorizationEpochSchema,
      authorizationNotAfter: inboxV2TimestampSchema,
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
            BigInt(heartbeat.projectionCheckpoint) ||
        Date.parse(heartbeat.sentAt) >=
          Date.parse(heartbeat.authorizationNotAfter)
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Recipient wire heartbeat must carry opaque current authorization bounds and exact lag."
        });
      }
    });

  const realtimeDeltaSchema = z
    .object({
      kind: z.literal("delta"),
      batch: syncBatchEnvelopeSchema,
      sseEventId: inboxV2SyncCursorSchema
    })
    .strict()
    .superRefine((delta, context) => {
      if (delta.sseEventId !== delta.batch.payload.cursor) {
        context.addIssue({
          code: "custom",
          message:
            "Recipient wire delta event ID must equal the batch result cursor."
        });
      }
    });

  const realtimeScopeTransitionSchema = z
    .object({
      kind: z.literal("scope_transition"),
      transition: scopeTransitionSchema,
      sseEventId: inboxV2SyncCursorSchema
    })
    .strict()
    .superRefine((payload, context) => {
      if (
        payload.sseEventId !== payload.transition.sseEventId ||
        payload.sseEventId !== payload.transition.cursor
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Recipient wire scope-transition event ID must equal its close cursor."
        });
      }
    });

  const realtimeResyncSchema = z
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
          message:
            "Recipient wire resync invalidations cannot cross a tenant boundary."
        });
      }
    });

  const realtimeSchema = enforceClientWireBoundary(
    z
      .discriminatedUnion("kind", [
        realtimeReadySchema,
        realtimeHeartbeatSchema,
        realtimeDeltaSchema,
        realtimeScopeTransitionSchema,
        realtimeResyncSchema
      ])
      .superRefine((payload, context) => {
        if (jsonUtf8ByteLength(payload) > INBOX_V2_MAX_SYNC_FRAME_BYTES) {
          context.addIssue({
            code: "custom",
            message: "Recipient wire realtime frame exceeds the byte budget."
          });
        }
      })
  );
  const realtimeEnvelopeSchema = createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_REALTIME_ENVELOPE_SCHEMA_ID,
    INBOX_V2_RECIPIENT_SYNC_SCHEMA_VERSION,
    realtimeSchema
  );

  return Object.freeze({
    entityChangeSchema,
    recipientCommitSchema,
    syncBatchSchema,
    syncBatchEnvelopeSchema,
    snapshotPageSchema,
    snapshotPageEnvelopeSchema,
    scopeTransitionSchema,
    realtimeReadySchema,
    realtimeHeartbeatSchema,
    realtimeSchema,
    realtimeEnvelopeSchema,
    parseSyncBatchEnvelope(value: unknown) {
      return parseWireEnvelope(
        value,
        INBOX_V2_RECIPIENT_SYNC_BATCH_SCHEMA_ID,
        syncBatchEnvelopeSchema
      );
    },
    parseSnapshotPageEnvelope(value: unknown) {
      return parseWireEnvelope(
        value,
        INBOX_V2_RECIPIENT_SNAPSHOT_PAGE_SCHEMA_ID,
        snapshotPageEnvelopeSchema
      );
    },
    parseRealtimeEnvelope(value: unknown) {
      return parseWireEnvelope(
        value,
        INBOX_V2_REALTIME_ENVELOPE_SCHEMA_ID,
        realtimeEnvelopeSchema
      );
    }
  });
}

function enforceClientWireBoundary<TSchema extends z.ZodType>(schema: TSchema) {
  return schema.superRefine((value, context) => {
    if (containsForbiddenWirePayloadKey(value)) {
      context.addIssue({
        code: "custom",
        message:
          "Recipient client wire payload cannot contain server authorization evidence, decoded claims or key material."
      });
    }
  });
}

function containsForbiddenWirePayloadKey(value: unknown): boolean {
  const queue: unknown[] = [value];
  const visited = new WeakSet<object>();
  // Every distinct JSON node consumes at least one encoded byte, plus the root.
  // This budget therefore accepts every valid <= frame-budget DTO while
  // bounding traversal of already-invalid/adversarial parsed values.
  let remainingNodeBudget = INBOX_V2_MAX_SYNC_FRAME_BYTES + 1;
  while (queue.length > 0) {
    remainingNodeBudget -= 1;
    if (remainingNodeBudget < 0) {
      return true;
    }
    const current = queue.pop();
    if (current === null || typeof current !== "object") {
      continue;
    }
    if (visited.has(current)) {
      continue;
    }
    visited.add(current);
    if (Array.isArray(current)) {
      if (queue.length + current.length > remainingNodeBudget) {
        return true;
      }
      for (const nested of current) {
        queue.push(nested);
      }
      continue;
    }
    if (
      isUnknownRecord(current) &&
      isRecognizableServerOnlyWireShape(current)
    ) {
      return true;
    }
    for (const [key, nested] of Object.entries(current)) {
      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/gu, "");
      if (forbiddenWirePayloadKeys.has(normalizedKey)) {
        return true;
      }
      if (queue.length >= remainingNodeBudget) {
        return true;
      }
      queue.push(nested);
    }
  }
  return false;
}

type UnknownRecord = Readonly<Record<string, unknown>>;

function isRecognizableServerOnlyWireShape(value: UnknownRecord): boolean {
  return (
    isAuthorizationDependencyVector(value) ||
    isAuthorizationSnapshot(value) ||
    isAuthorizationDecisionReference(value) ||
    isSyncCursorClaims(value) ||
    isSnapshotPageCursorClaims(value) ||
    isCursorMintOrAcceptedProof(value) ||
    isRecipientStateFingerprintProtection(value) ||
    isAuthorizationRequirement(value) ||
    isRichAuthorizedManifest(value)
  );
}

function isAuthorizationDependencyVector(value: UnknownRecord): boolean {
  return (
    hasOwnFields(value, [
      "tenantRbacRevision",
      "employeeAccessRevision",
      "employeeInboxRelationRevision",
      "sharedAccessRevision",
      "resourceDependencies",
      "temporalBoundaryDigest"
    ]) && Array.isArray(value.resourceDependencies)
  );
}

function isAuthorizationSnapshot(value: UnknownRecord): boolean {
  return (
    hasOwnFields(value, [
      "tenantId",
      "employee",
      "value",
      "dependencies",
      "evaluatedAt",
      "notAfter",
      "nextAuthorizationBoundary"
    ]) &&
    isUnknownRecord(value.employee) &&
    isUnknownRecord(value.dependencies) &&
    isAuthorizationDependencyVector(value.dependencies)
  );
}

function isAuthorizationDecisionReference(value: UnknownRecord): boolean {
  return (
    hasOwnFields(value, [
      "tenantId",
      "id",
      "authorizationEpoch",
      "principal",
      "permissionId",
      "resourceScopeId",
      "resource",
      "resourceAccessRevision",
      "decisionRevision",
      "decisionHash",
      "outcome",
      "decidedAt",
      "notAfter"
    ]) &&
    isUnknownRecord(value.principal) &&
    isUnknownRecord(value.resource) &&
    (value.outcome === "allowed" || value.outcome === "denied")
  );
}

function isSyncCursorClaims(value: UnknownRecord): boolean {
  return (
    hasOwnFields(value, [
      "tenantId",
      "employee",
      "scopeId",
      "streamEpoch",
      "syncGeneration",
      "authorizationEpoch",
      "schemaVersion",
      "resumeMode",
      "scannedThrough",
      "issuedAt",
      "notAfter"
    ]) &&
    isUnknownRecord(value.employee) &&
    (value.resumeMode === "delta" || value.resumeMode === "snapshot_required")
  );
}

function isSnapshotPageCursorClaims(value: UnknownRecord): boolean {
  return (
    hasOwnFields(value, [
      "tenantId",
      "employee",
      "scopeId",
      "snapshotId",
      "streamEpoch",
      "syncGeneration",
      "authorizationEpoch",
      "schemaVersion",
      "snapshotCheckpoint",
      "manifestHash",
      "snapshotContextHash",
      "nextPageOrdinal",
      "afterExclusive",
      "acceptedPageHash",
      "acceptedCumulativeEntityCount",
      "acceptedCumulativePageChainHash",
      "issuedAt",
      "notAfter"
    ]) &&
    isUnknownRecord(value.employee) &&
    isUnknownRecord(value.afterExclusive)
  );
}

function isCursorMintOrAcceptedProof(value: UnknownRecord): boolean {
  const claims = isUnknownRecord(value.claims) ? value.claims : undefined;
  if (
    typeof value.cursor === "string" &&
    claims !== undefined &&
    (isSyncCursorClaims(claims) || isSnapshotPageCursorClaims(claims)) &&
    isUnknownRecord(value.authorization) &&
    isAuthorizationSnapshot(value.authorization)
  ) {
    return true;
  }
  return (
    (value.kind === "accepted" ||
      value.kind === "accepted_for_scope_transition") &&
    typeof value.inputCursor === "string" &&
    claims !== undefined &&
    (isSyncCursorClaims(claims) || isSnapshotPageCursorClaims(claims)) &&
    (typeof value.verifiedAt === "string" ||
      isUnknownRecord(value.validationContext))
  );
}

function isRecipientStateFingerprintProtection(value: UnknownRecord): boolean {
  return (
    value.purpose === "recipient_state_integrity" &&
    hasOwnFields(value, ["tenantId", "keyGeneration", "key"])
  );
}

function isAuthorizationRequirement(value: UnknownRecord): boolean {
  if (!hasOwnFields(value, ["permissionId", "resourceScopeId"])) {
    return false;
  }
  return (
    (isUnknownRecord(value.resourceResolver) &&
      hasOwnFields(value.resourceResolver, ["semanticId", "fingerprint"])) ||
    hasOwnFields(value, ["resourceResolverId", "resourceResolverFingerprint"])
  );
}

function isRichAuthorizedManifest(value: UnknownRecord): boolean {
  if (
    value.completeness !== "complete_for_scope" ||
    !Array.isArray(value.registrations) ||
    !Array.isArray(value.indexScopeIds)
  ) {
    return false;
  }
  return value.registrations.some(
    (registration) =>
      isUnknownRecord(registration) &&
      Object.values(registration).some(
        (candidate) =>
          Array.isArray(candidate) &&
          candidate.some(
            (requirement) =>
              isUnknownRecord(requirement) &&
              isAuthorizationRequirement(requirement)
          )
      )
  );
}

function isUnknownRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOwnFields(
  value: UnknownRecord,
  fields: readonly string[]
): boolean {
  return fields.every((field) =>
    Object.prototype.hasOwnProperty.call(value, field)
  );
}

function assertExactOwnKeys(
  value: object,
  expectedKeys: readonly string[],
  label: string
): void {
  const actual = Object.keys(value).sort(compareContractIds);
  const expected = [...expectedKeys].sort(compareContractIds);
  if (!sameJsonValue(actual, expected)) {
    throw new TypeError(`${label} must expose only its client-safe fields.`);
  }
}

function recipientEntityChangesAreUnique(
  changes: readonly Readonly<{
    projectionTypeId: string;
    entity: Readonly<{ entityTypeId: string; entityId: string }>;
  }>[]
): boolean {
  const identities = changes.map(
    (change) =>
      `${change.projectionTypeId}\u0000${change.entity.entityTypeId}\u0000${change.entity.entityId}`
  );
  return new Set(identities).size === identities.length;
}

function snapshotEntityPositionKey(entity: {
  entityTypeId: string;
  entityId: string;
}): string {
  return `${entity.entityTypeId}\u0000${entity.entityId}`;
}

function compareContractIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function parseWireEnvelope<TSchema extends z.ZodType>(
  value: unknown,
  schemaId: string,
  schema: TSchema
) {
  return parseInboxV2VersionedEnvelope({
    value,
    schemaId,
    supportedSchemas: {
      [INBOX_V2_RECIPIENT_SYNC_SCHEMA_VERSION]: schema
    },
    invalidErrorCode: "sync.envelope_invalid",
    unsupportedErrorCode: "sync.schema_unsupported"
  });
}
