import { z } from "zod";

import { inboxV2AuthorizationEpochSchema } from "./authorization-epoch";
import {
  inboxV2BigintCounterSchema,
  inboxV2EntityRevisionSchema,
  inboxV2TimestampSchema
} from "./entity-metadata";
import { inboxV2EmployeeReferenceSchema, inboxV2TenantIdSchema } from "./ids";
import { inboxV2SchemaVersionTokenSchema } from "./schema-version";
import {
  inboxV2AuthorizationEpochSnapshotSchema,
  inboxV2EntityKeySchema,
  inboxV2ProjectionCheckpointSchema,
  inboxV2RecipientScopeIdSchema,
  inboxV2Sha256DigestSchema,
  inboxV2SnapshotIdSchema,
  inboxV2StreamEpochSchema,
  inboxV2SyncCursorSchema,
  inboxV2SyncGenerationSchema,
  inboxV2TenantStreamPositionSchema
} from "./sync-primitives";
import type { InboxV2AuthorizationEpochSnapshot } from "./sync-primitives";
import { verifyInboxV2SnapshotContextHash } from "./recipient-sync-hash";

/**
 * An authorization snapshot is usable only until its closest temporal
 * boundary. The snapshot schema guarantees that the optional boundary is not
 * later than `notAfter`, so this is the explicit `min(...)` required by ADR
 * 0013 rather than a caller-selected lifetime.
 */
export function inboxV2EffectiveAuthorizationNotAfter(
  snapshot: InboxV2AuthorizationEpochSnapshot
): string {
  return snapshot.nextAuthorizationBoundary ?? snapshot.notAfter;
}

export function inboxV2AuthorizationSnapshotsMatch(
  left: InboxV2AuthorizationEpochSnapshot,
  right: InboxV2AuthorizationEpochSnapshot
): boolean {
  return (
    inboxV2AuthorizationSecurityStatesMatch(left, right) &&
    left.evaluatedAt === right.evaluatedAt
  );
}

/** Same security state after a fresh evaluation; excludes only evaluatedAt. */
export function inboxV2AuthorizationSecurityStatesMatch(
  left: InboxV2AuthorizationEpochSnapshot,
  right: InboxV2AuthorizationEpochSnapshot
): boolean {
  return (
    left.tenantId === right.tenantId &&
    left.employee.id === right.employee.id &&
    left.value === right.value &&
    left.notAfter === right.notAfter &&
    left.nextAuthorizationBoundary === right.nextAuthorizationBoundary &&
    JSON.stringify(left.dependencies) === JSON.stringify(right.dependencies)
  );
}

function cursorClaimsMatchAuthorization(
  claims: z.output<typeof inboxV2SyncCursorClaimsSchema>,
  authorization: InboxV2AuthorizationEpochSnapshot
): boolean {
  const effectiveNotAfter =
    inboxV2EffectiveAuthorizationNotAfter(authorization);
  return (
    claims.tenantId === authorization.tenantId &&
    claims.employee.id === authorization.employee.id &&
    claims.authorizationEpoch === authorization.value &&
    claims.notAfter === effectiveNotAfter &&
    Date.parse(claims.issuedAt) >= Date.parse(authorization.evaluatedAt) &&
    Date.parse(claims.issuedAt) < Date.parse(effectiveNotAfter)
  );
}

export const inboxV2SyncCursorErrorCodeSchema = z.enum([
  "sync.cursor_invalid",
  "sync.cursor_future",
  "sync.cursor_expired",
  "sync.epoch_changed",
  "sync.scope_changed",
  "sync.schema_unsupported",
  "sync.gap_detected",
  "sync.resync_required"
]);

/**
 * Server-side signed-token claims. Clients only see the opaque cursor string;
 * these claims are never an authorization grant and are revalidated on use.
 */
export const inboxV2SyncCursorClaimsSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    employee: inboxV2EmployeeReferenceSchema,
    scopeId: inboxV2RecipientScopeIdSchema,
    streamEpoch: inboxV2StreamEpochSchema,
    syncGeneration: inboxV2SyncGenerationSchema,
    authorizationEpoch: inboxV2AuthorizationEpochSchema,
    schemaVersion: inboxV2SchemaVersionTokenSchema,
    resumeMode: z.enum(["delta", "snapshot_required"]),
    scannedThrough: inboxV2TenantStreamPositionSchema,
    issuedAt: inboxV2TimestampSchema,
    notAfter: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((claims, context) => {
    if (
      claims.employee.tenantId !== claims.tenantId ||
      Date.parse(claims.issuedAt) >= Date.parse(claims.notAfter)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Cursor claims must bind one tenant employee and an ordered finite lifetime."
      });
    }
  });

export const inboxV2SyncCursorMintSchema = z
  .object({
    cursor: inboxV2SyncCursorSchema,
    claims: inboxV2SyncCursorClaimsSchema,
    authorization: inboxV2AuthorizationEpochSnapshotSchema
  })
  .strict()
  .superRefine((mint, context) => {
    if (!cursorClaimsMatchAuthorization(mint.claims, mint.authorization)) {
      context.addIssue({
        code: "custom",
        path: ["authorization"],
        message:
          "Cursor mint must use the exact authorization snapshot and its nearest temporal boundary."
      });
    }
  });

/**
 * Server-only proof that an opaque input cursor was signature-verified and
 * decoded for a scope-transition purge. It is deliberately not a replay
 * acceptance: an old cursor may already be scope-changed or expired and must
 * never authorize another customer-data payload.
 */
export const inboxV2ScopeTransitionInputCursorProofSchema = z
  .object({
    kind: z.literal("accepted_for_scope_transition"),
    inputCursor: inboxV2SyncCursorSchema,
    claims: inboxV2SyncCursorClaimsSchema,
    verifiedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((proof, context) => {
    if (
      proof.claims.resumeMode !== "delta" ||
      Date.parse(proof.verifiedAt) < Date.parse(proof.claims.issuedAt)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Scope-transition input proof must carry verified prior delta-cursor claims."
      });
    }
  });

export const inboxV2SyncCursorValidationContextSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    employee: inboxV2EmployeeReferenceSchema,
    scopeId: inboxV2RecipientScopeIdSchema,
    streamEpoch: inboxV2StreamEpochSchema,
    syncGeneration: inboxV2SyncGenerationSchema,
    authorization: inboxV2AuthorizationEpochSnapshotSchema,
    supportedSchemaVersions: z
      .array(inboxV2SchemaVersionTokenSchema)
      .min(1)
      .max(32),
    minRetainedTenantStreamPosition: inboxV2TenantStreamPositionSchema,
    minReplayableRecipientPosition: inboxV2TenantStreamPositionSchema,
    projectionCheckpoint: inboxV2ProjectionCheckpointSchema,
    tenantStreamHead: inboxV2TenantStreamPositionSchema,
    now: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((current, context) => {
    if (
      current.employee.tenantId !== current.tenantId ||
      current.authorization.tenantId !== current.tenantId ||
      current.authorization.employee.id !== current.employee.id ||
      Date.parse(current.now) < Date.parse(current.authorization.evaluatedAt) ||
      BigInt(current.minRetainedTenantStreamPosition) >
        BigInt(current.projectionCheckpoint) ||
      BigInt(current.minReplayableRecipientPosition) >
        BigInt(current.projectionCheckpoint) ||
      BigInt(current.projectionCheckpoint) > BigInt(current.tenantStreamHead) ||
      new Set(current.supportedSchemaVersions).size !==
        current.supportedSchemaVersions.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Cursor validation context must describe one valid live scope."
      });
    }
  });

export const inboxV2AcceptedSyncCursorValidationProofSchema = z
  .object({
    kind: z.literal("accepted"),
    inputCursor: inboxV2SyncCursorSchema,
    claims: inboxV2SyncCursorClaimsSchema,
    validationContext: inboxV2SyncCursorValidationContextSchema,
    fromExclusive: inboxV2TenantStreamPositionSchema
  })
  .strict()
  .superRefine((proof, context) => {
    const rejection = evaluateSyncCursorClaims(
      proof.claims,
      proof.validationContext
    );
    if (
      rejection !== null ||
      proof.fromExclusive !== proof.claims.scannedThrough
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Accepted cursor proof must preserve the exact validated claims and input position."
      });
    }
  });

const inboxV2RejectedSyncCursorValidationDecisionSchema = z
  .object({
    kind: z.literal("rejected"),
    errorCode: inboxV2SyncCursorErrorCodeSchema,
    cursorAdvance: z.null()
  })
  .strict();

export const inboxV2SyncCursorValidationDecisionSchema = z.union([
  inboxV2AcceptedSyncCursorValidationProofSchema,
  inboxV2RejectedSyncCursorValidationDecisionSchema
]);

export function validateInboxV2SyncCursorClaims(input: {
  cursor: unknown;
  claims: unknown;
  current: z.input<typeof inboxV2SyncCursorValidationContextSchema>;
}): z.infer<typeof inboxV2SyncCursorValidationDecisionSchema> {
  const cursor = inboxV2SyncCursorSchema.safeParse(input.cursor);
  const claims = inboxV2SyncCursorClaimsSchema.safeParse(input.claims);
  if (!cursor.success || !claims.success) {
    return rejectCursor("sync.cursor_invalid");
  }
  const current = inboxV2SyncCursorValidationContextSchema.safeParse(
    input.current
  );
  if (!current.success) {
    return rejectCursor("sync.cursor_invalid");
  }
  const rejection = evaluateSyncCursorClaims(claims.data, current.data);
  if (rejection !== null) {
    return rejectCursor(rejection);
  }
  return {
    kind: "accepted",
    inputCursor: cursor.data,
    claims: claims.data,
    validationContext: current.data,
    fromExclusive: claims.data.scannedThrough
  };
}

function evaluateSyncCursorClaims(
  claims: z.output<typeof inboxV2SyncCursorClaimsSchema>,
  current: z.output<typeof inboxV2SyncCursorValidationContextSchema>
): z.output<typeof inboxV2SyncCursorErrorCodeSchema> | null {
  if (
    claims.tenantId !== current.tenantId ||
    claims.employee.id !== current.employee.id ||
    claims.scopeId !== current.scopeId
  ) {
    return "sync.cursor_invalid";
  }
  if (!current.supportedSchemaVersions.includes(claims.schemaVersion)) {
    return "sync.schema_unsupported";
  }
  if (
    claims.streamEpoch !== current.streamEpoch ||
    claims.syncGeneration !== current.syncGeneration
  ) {
    return "sync.epoch_changed";
  }
  if (
    claims.authorizationEpoch !== current.authorization.value ||
    claims.notAfter !==
      inboxV2EffectiveAuthorizationNotAfter(current.authorization)
  ) {
    return "sync.scope_changed";
  }
  if (
    current.authorization.evaluatedAt !== current.now ||
    Date.parse(claims.issuedAt) > Date.parse(current.now) ||
    Date.parse(current.now) >= Date.parse(claims.notAfter)
  ) {
    return "sync.cursor_expired";
  }
  if (claims.resumeMode === "snapshot_required") {
    return "sync.resync_required";
  }
  if (BigInt(claims.scannedThrough) > BigInt(current.tenantStreamHead)) {
    return "sync.cursor_future";
  }
  if (BigInt(claims.scannedThrough) > BigInt(current.projectionCheckpoint)) {
    return "sync.gap_detected";
  }

  const minReplayablePosition =
    BigInt(current.minRetainedTenantStreamPosition) >
    BigInt(current.minReplayableRecipientPosition)
      ? current.minRetainedTenantStreamPosition
      : current.minReplayableRecipientPosition;
  const earliestResume =
    minReplayablePosition === "0" ? 0n : BigInt(minReplayablePosition) - 1n;
  if (BigInt(claims.scannedThrough) < earliestResume) {
    return "sync.cursor_expired";
  }
  return null;
}

/** Input to the trusted current-authorization evaluator for a first page. */
const inboxV2SnapshotStartAuthorizationValidationInputSchema = z
  .object({
    snapshotContextHash: inboxV2Sha256DigestSchema,
    frozenAuthorization: inboxV2AuthorizationEpochSnapshotSchema,
    snapshotIssuedAt: inboxV2TimestampSchema,
    current: z
      .object({
        authorization: inboxV2AuthorizationEpochSnapshotSchema,
        now: inboxV2TimestampSchema
      })
      .strict()
  })
  .strict()
  .superRefine((input, context) => {
    if (
      input.frozenAuthorization.tenantId !==
        input.current.authorization.tenantId ||
      input.frozenAuthorization.employee.id !==
        input.current.authorization.employee.id
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Snapshot-start authorization input must bind one tenant employee."
      });
    }
  });

export const inboxV2AcceptedSnapshotStartAuthorizationValidationProofSchema = z
  .object({
    kind: z.literal("accepted"),
    snapshotContextHash: inboxV2Sha256DigestSchema,
    currentAuthorization: inboxV2AuthorizationEpochSnapshotSchema,
    checkedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((proof, context) => {
    if (
      proof.currentAuthorization.evaluatedAt !== proof.checkedAt ||
      Date.parse(proof.checkedAt) >=
        Date.parse(
          inboxV2EffectiveAuthorizationNotAfter(proof.currentAuthorization)
        )
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Accepted snapshot-start proof must carry one fresh authorization evaluation before its nearest boundary."
      });
    }
  });

const inboxV2RejectedSnapshotStartAuthorizationValidationDecisionSchema = z
  .object({
    kind: z.literal("rejected"),
    errorCode: inboxV2SyncCursorErrorCodeSchema,
    cursorAdvance: z.null()
  })
  .strict();

export const inboxV2SnapshotStartAuthorizationValidationDecisionSchema =
  z.union([
    inboxV2AcceptedSnapshotStartAuthorizationValidationProofSchema,
    inboxV2RejectedSnapshotStartAuthorizationValidationDecisionSchema
  ]);

export function validateInboxV2SnapshotStartAuthorization(input: {
  snapshotContextHash: unknown;
  frozenAuthorization: unknown;
  snapshotIssuedAt: unknown;
  current: unknown;
}): z.infer<typeof inboxV2SnapshotStartAuthorizationValidationDecisionSchema> {
  const validationInput =
    inboxV2SnapshotStartAuthorizationValidationInputSchema.safeParse(input);
  if (!validationInput.success) {
    return rejectSnapshotStartAuthorization("sync.cursor_invalid");
  }
  const rejection = evaluateSnapshotStartAuthorization(validationInput.data);
  if (rejection !== null) {
    return rejectSnapshotStartAuthorization(rejection);
  }
  return {
    kind: "accepted",
    snapshotContextHash: validationInput.data.snapshotContextHash,
    currentAuthorization: validationInput.data.current.authorization,
    checkedAt: validationInput.data.current.now
  };
}

function evaluateSnapshotStartAuthorization(
  input: z.output<typeof inboxV2SnapshotStartAuthorizationValidationInputSchema>
): z.output<typeof inboxV2SyncCursorErrorCodeSchema> | null {
  if (
    !inboxV2AuthorizationSecurityStatesMatch(
      input.frozenAuthorization,
      input.current.authorization
    )
  ) {
    return "sync.scope_changed";
  }

  const effectiveNotAfter = inboxV2EffectiveAuthorizationNotAfter(
    input.current.authorization
  );
  if (
    input.current.authorization.evaluatedAt !== input.current.now ||
    Date.parse(input.snapshotIssuedAt) <
      Date.parse(input.frozenAuthorization.evaluatedAt) ||
    Date.parse(input.snapshotIssuedAt) >= Date.parse(effectiveNotAfter) ||
    Date.parse(input.current.now) < Date.parse(input.snapshotIssuedAt) ||
    Date.parse(input.current.now) >= Date.parse(effectiveNotAfter)
  ) {
    return "sync.cursor_expired";
  }

  return null;
}

export const inboxV2SnapshotPageCursorClaimsSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    employee: inboxV2EmployeeReferenceSchema,
    scopeId: inboxV2RecipientScopeIdSchema,
    snapshotId: inboxV2SnapshotIdSchema,
    streamEpoch: inboxV2StreamEpochSchema,
    syncGeneration: inboxV2SyncGenerationSchema,
    authorizationEpoch: inboxV2AuthorizationEpochSchema,
    schemaVersion: inboxV2SchemaVersionTokenSchema,
    snapshotCheckpoint: inboxV2ProjectionCheckpointSchema,
    manifestHash: inboxV2Sha256DigestSchema,
    snapshotContextHash: inboxV2Sha256DigestSchema,
    nextPageOrdinal: inboxV2EntityRevisionSchema,
    afterExclusive: inboxV2EntityKeySchema,
    acceptedPageHash: inboxV2Sha256DigestSchema,
    acceptedCumulativeEntityCount: inboxV2BigintCounterSchema,
    acceptedCumulativePageChainHash: inboxV2Sha256DigestSchema,
    issuedAt: inboxV2TimestampSchema,
    notAfter: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((claims, context) => {
    if (
      claims.employee.tenantId !== claims.tenantId ||
      claims.afterExclusive.tenantId !== claims.tenantId ||
      BigInt(claims.nextPageOrdinal) < 2n ||
      BigInt(claims.acceptedCumulativeEntityCount) === 0n ||
      BigInt(claims.acceptedCumulativeEntityCount) <
        BigInt(claims.nextPageOrdinal) - 1n ||
      Date.parse(claims.issuedAt) >= Date.parse(claims.notAfter)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Snapshot page cursor must bind one tenant employee and finite snapshot lifetime."
      });
    }
  });

export const inboxV2SnapshotManifestCoverageSchema = z
  .object({
    entityCount: inboxV2BigintCounterSchema,
    pageCount: inboxV2EntityRevisionSchema,
    finalEntity: inboxV2EntityKeySchema.nullable(),
    pageChainRootHash: inboxV2Sha256DigestSchema
  })
  .strict()
  .superRefine((coverage, context) => {
    const entityCount = BigInt(coverage.entityCount);
    const pageCount = BigInt(coverage.pageCount);
    if (
      (entityCount === 0n) !== (coverage.finalEntity === null) ||
      (entityCount === 0n && pageCount !== 1n) ||
      (entityCount > 0n && pageCount > entityCount)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Snapshot coverage must identify the final entity exactly when the frozen scope is non-empty."
      });
    }
  });

export const inboxV2SnapshotPagePositionSchema = z
  .object({
    ordinal: inboxV2EntityRevisionSchema,
    afterExclusive: inboxV2EntityKeySchema.nullable(),
    firstInclusive: inboxV2EntityKeySchema.nullable(),
    throughInclusive: inboxV2EntityKeySchema.nullable(),
    entityCount: inboxV2BigintCounterSchema,
    previousPageHash: inboxV2Sha256DigestSchema.nullable(),
    pageHash: inboxV2Sha256DigestSchema,
    previousCumulativeEntityCount: inboxV2BigintCounterSchema,
    cumulativeEntityCount: inboxV2BigintCounterSchema,
    previousCumulativePageChainHash: inboxV2Sha256DigestSchema.nullable(),
    cumulativePageChainHash: inboxV2Sha256DigestSchema
  })
  .strict()
  .superRefine((position, context) => {
    const isFirst = position.ordinal === "1";
    const isEmpty = position.entityCount === "0";
    if (
      (isFirst &&
        (position.afterExclusive !== null ||
          position.previousPageHash !== null ||
          position.previousCumulativeEntityCount !== "0" ||
          position.previousCumulativePageChainHash !== null)) ||
      (!isFirst &&
        (position.afterExclusive === null ||
          position.previousPageHash === null ||
          BigInt(position.previousCumulativeEntityCount) === 0n ||
          BigInt(position.previousCumulativeEntityCount) <
            BigInt(position.ordinal) - 1n ||
          position.previousCumulativePageChainHash === null)) ||
      isEmpty !==
        (position.firstInclusive === null &&
          position.throughInclusive === null) ||
      (!isEmpty &&
        (position.firstInclusive === null ||
          position.throughInclusive === null)) ||
      BigInt(position.cumulativeEntityCount) !==
        BigInt(position.previousCumulativeEntityCount) +
          BigInt(position.entityCount)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Snapshot page position must form one exact ordinal, range and cumulative chain."
      });
    }
  });

export const inboxV2SnapshotFinalCompletionSchema = z
  .object({
    snapshotId: inboxV2SnapshotIdSchema,
    manifestHash: inboxV2Sha256DigestSchema,
    snapshotCheckpoint: inboxV2ProjectionCheckpointSchema,
    pageCount: inboxV2EntityRevisionSchema,
    entityCount: inboxV2BigintCounterSchema,
    finalEntity: inboxV2EntityKeySchema.nullable(),
    pageChainRootHash: inboxV2Sha256DigestSchema
  })
  .strict()
  .superRefine((completion, context) => {
    if (
      (BigInt(completion.entityCount) === 0n) !==
      (completion.finalEntity === null)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Final snapshot completion must identify the final entity exactly when coverage is non-empty."
      });
    }
  });

export const inboxV2SnapshotPageCursorMintSchema = z
  .object({
    cursor: inboxV2SyncCursorSchema,
    claims: inboxV2SnapshotPageCursorClaimsSchema,
    authorization: inboxV2AuthorizationEpochSnapshotSchema
  })
  .strict()
  .superRefine((mint, context) => {
    const effectiveNotAfter = inboxV2EffectiveAuthorizationNotAfter(
      mint.authorization
    );
    if (
      mint.claims.tenantId !== mint.authorization.tenantId ||
      mint.claims.employee.id !== mint.authorization.employee.id ||
      mint.claims.authorizationEpoch !== mint.authorization.value ||
      mint.claims.notAfter !== effectiveNotAfter ||
      Date.parse(mint.claims.issuedAt) <
        Date.parse(mint.authorization.evaluatedAt) ||
      Date.parse(mint.claims.issuedAt) >= Date.parse(effectiveNotAfter)
    ) {
      context.addIssue({
        code: "custom",
        path: ["authorization"],
        message:
          "Snapshot page cursor mint must use the exact authorization snapshot and its nearest temporal boundary."
      });
    }
  });

export const inboxV2SnapshotPageCursorValidationContextSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    employee: inboxV2EmployeeReferenceSchema,
    scopeId: inboxV2RecipientScopeIdSchema,
    snapshotId: inboxV2SnapshotIdSchema,
    streamEpoch: inboxV2StreamEpochSchema,
    syncGeneration: inboxV2SyncGenerationSchema,
    frozenAuthorization: inboxV2AuthorizationEpochSnapshotSchema,
    currentAuthorization: inboxV2AuthorizationEpochSnapshotSchema,
    schemaVersion: inboxV2SchemaVersionTokenSchema,
    snapshotCheckpoint: inboxV2ProjectionCheckpointSchema,
    manifestHash: inboxV2Sha256DigestSchema,
    snapshotContextHash: inboxV2Sha256DigestSchema,
    snapshotIssuedAt: inboxV2TimestampSchema,
    coverage: inboxV2SnapshotManifestCoverageSchema,
    resumeClaims: inboxV2SyncCursorClaimsSchema,
    now: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((current, context) => {
    if (
      current.employee.tenantId !== current.tenantId ||
      current.frozenAuthorization.tenantId !== current.tenantId ||
      current.frozenAuthorization.employee.id !== current.employee.id ||
      current.currentAuthorization.tenantId !== current.tenantId ||
      current.currentAuthorization.employee.id !== current.employee.id ||
      (current.coverage.finalEntity !== null &&
        current.coverage.finalEntity.tenantId !== current.tenantId) ||
      current.resumeClaims.tenantId !== current.tenantId ||
      current.resumeClaims.employee.id !== current.employee.id ||
      current.resumeClaims.scopeId !== current.scopeId ||
      current.resumeClaims.streamEpoch !== current.streamEpoch ||
      current.resumeClaims.syncGeneration !== current.syncGeneration ||
      current.resumeClaims.authorizationEpoch !==
        current.frozenAuthorization.value ||
      current.resumeClaims.schemaVersion !== current.schemaVersion ||
      current.resumeClaims.resumeMode !== "delta" ||
      String(current.resumeClaims.scannedThrough) !==
        String(current.snapshotCheckpoint) ||
      current.resumeClaims.issuedAt !== current.snapshotIssuedAt ||
      current.resumeClaims.notAfter !==
        inboxV2EffectiveAuthorizationNotAfter(current.frozenAuthorization) ||
      Date.parse(current.snapshotIssuedAt) <
        Date.parse(current.frozenAuthorization.evaluatedAt) ||
      Date.parse(current.snapshotIssuedAt) >=
        Date.parse(
          inboxV2EffectiveAuthorizationNotAfter(current.frozenAuthorization)
        ) ||
      !verifyInboxV2SnapshotContextHash({
        tenantId: current.tenantId,
        scope: {
          id: current.scopeId,
          kind: "employee_inbox",
          employee: current.employee
        },
        snapshotId: current.snapshotId,
        streamEpoch: current.streamEpoch,
        syncGeneration: current.syncGeneration,
        authorization: current.frozenAuthorization,
        schemaVersion: current.schemaVersion,
        snapshotCheckpoint: current.snapshotCheckpoint,
        manifestHash: current.manifestHash,
        coverage: current.coverage,
        snapshotIssuedAt: current.snapshotIssuedAt,
        resumeClaims: current.resumeClaims,
        snapshotContextHash: current.snapshotContextHash
      })
    ) {
      context.addIssue({
        code: "custom",
        message: "Snapshot cursor context must bind one tenant employee."
      });
    }
  });

export const inboxV2AcceptedSnapshotPageCursorValidationProofSchema = z
  .object({
    kind: z.literal("accepted"),
    inputCursor: inboxV2SyncCursorSchema,
    claims: inboxV2SnapshotPageCursorClaimsSchema,
    validationContext: inboxV2SnapshotPageCursorValidationContextSchema,
    nextPageOrdinal: inboxV2EntityRevisionSchema,
    afterExclusive: inboxV2EntityKeySchema,
    acceptedPageHash: inboxV2Sha256DigestSchema,
    acceptedCumulativeEntityCount: inboxV2BigintCounterSchema,
    acceptedCumulativePageChainHash: inboxV2Sha256DigestSchema
  })
  .strict()
  .superRefine((proof, context) => {
    const rejection = evaluateSnapshotPageCursorClaims(
      proof.claims,
      proof.validationContext
    );
    if (
      rejection !== null ||
      proof.nextPageOrdinal !== proof.claims.nextPageOrdinal ||
      JSON.stringify(proof.afterExclusive) !==
        JSON.stringify(proof.claims.afterExclusive) ||
      proof.acceptedPageHash !== proof.claims.acceptedPageHash ||
      proof.acceptedCumulativeEntityCount !==
        proof.claims.acceptedCumulativeEntityCount ||
      proof.acceptedCumulativePageChainHash !==
        proof.claims.acceptedCumulativePageChainHash
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Accepted snapshot-page proof must preserve the exact validated claims and page position."
      });
    }
  });

const inboxV2RejectedSnapshotPageCursorValidationDecisionSchema = z
  .object({
    kind: z.literal("rejected"),
    errorCode: inboxV2SyncCursorErrorCodeSchema,
    cursorAdvance: z.null()
  })
  .strict();

export const inboxV2SnapshotPageCursorValidationDecisionSchema = z.union([
  inboxV2AcceptedSnapshotPageCursorValidationProofSchema,
  inboxV2RejectedSnapshotPageCursorValidationDecisionSchema
]);

export function validateInboxV2SnapshotPageCursorClaims(input: {
  cursor: unknown;
  claims: unknown;
  current: z.input<typeof inboxV2SnapshotPageCursorValidationContextSchema>;
}): z.infer<typeof inboxV2SnapshotPageCursorValidationDecisionSchema> {
  const cursor = inboxV2SyncCursorSchema.safeParse(input.cursor);
  const claims = inboxV2SnapshotPageCursorClaimsSchema.safeParse(input.claims);
  if (!cursor.success || !claims.success) {
    return rejectSnapshotPageCursor("sync.cursor_invalid");
  }
  const current = inboxV2SnapshotPageCursorValidationContextSchema.safeParse(
    input.current
  );
  if (!current.success) {
    return rejectSnapshotPageCursor("sync.cursor_invalid");
  }
  const rejection = evaluateSnapshotPageCursorClaims(claims.data, current.data);
  if (rejection !== null) {
    return rejectSnapshotPageCursor(rejection);
  }
  return {
    kind: "accepted",
    inputCursor: cursor.data,
    claims: claims.data,
    validationContext: current.data,
    nextPageOrdinal: claims.data.nextPageOrdinal,
    afterExclusive: claims.data.afterExclusive,
    acceptedPageHash: claims.data.acceptedPageHash,
    acceptedCumulativeEntityCount: claims.data.acceptedCumulativeEntityCount,
    acceptedCumulativePageChainHash: claims.data.acceptedCumulativePageChainHash
  };
}

function evaluateSnapshotPageCursorClaims(
  claims: z.output<typeof inboxV2SnapshotPageCursorClaimsSchema>,
  current: z.output<typeof inboxV2SnapshotPageCursorValidationContextSchema>
): z.output<typeof inboxV2SyncCursorErrorCodeSchema> | null {
  if (
    claims.tenantId !== current.tenantId ||
    claims.employee.id !== current.employee.id ||
    claims.scopeId !== current.scopeId ||
    claims.snapshotId !== current.snapshotId ||
    claims.snapshotCheckpoint !== current.snapshotCheckpoint ||
    claims.manifestHash !== current.manifestHash ||
    claims.snapshotContextHash !== current.snapshotContextHash ||
    claims.issuedAt !== current.snapshotIssuedAt ||
    claims.afterExclusive.tenantId !== current.tenantId ||
    BigInt(claims.nextPageOrdinal) > BigInt(current.coverage.pageCount) ||
    BigInt(claims.acceptedCumulativeEntityCount) >
      BigInt(current.coverage.entityCount)
  ) {
    return "sync.cursor_invalid";
  }
  if (claims.schemaVersion !== current.schemaVersion) {
    return "sync.schema_unsupported";
  }
  if (
    claims.streamEpoch !== current.streamEpoch ||
    claims.syncGeneration !== current.syncGeneration
  ) {
    return "sync.epoch_changed";
  }
  if (
    !inboxV2AuthorizationSecurityStatesMatch(
      current.frozenAuthorization,
      current.currentAuthorization
    ) ||
    claims.authorizationEpoch !== current.currentAuthorization.value ||
    claims.notAfter !==
      inboxV2EffectiveAuthorizationNotAfter(current.currentAuthorization)
  ) {
    return "sync.scope_changed";
  }
  if (
    current.currentAuthorization.evaluatedAt !== current.now ||
    Date.parse(claims.issuedAt) <
      Date.parse(current.frozenAuthorization.evaluatedAt) ||
    Date.parse(claims.issuedAt) > Date.parse(current.now) ||
    Date.parse(current.now) >= Date.parse(claims.notAfter)
  ) {
    return "sync.cursor_expired";
  }
  return null;
}

function rejectCursor(
  errorCode: z.infer<typeof inboxV2SyncCursorErrorCodeSchema>
): z.infer<typeof inboxV2SyncCursorValidationDecisionSchema> {
  return { kind: "rejected", errorCode, cursorAdvance: null };
}

function rejectSnapshotPageCursor(
  errorCode: z.infer<typeof inboxV2SyncCursorErrorCodeSchema>
): z.infer<typeof inboxV2SnapshotPageCursorValidationDecisionSchema> {
  return { kind: "rejected", errorCode, cursorAdvance: null };
}

function rejectSnapshotStartAuthorization(
  errorCode: z.infer<typeof inboxV2SyncCursorErrorCodeSchema>
): z.infer<typeof inboxV2SnapshotStartAuthorizationValidationDecisionSchema> {
  return { kind: "rejected", errorCode, cursorAdvance: null };
}
