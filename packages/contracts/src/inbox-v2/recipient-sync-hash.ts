import { sha256 } from "@noble/hashes/sha2.js";
import { hmac } from "@noble/hashes/hmac.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

import type {
  InboxV2RecipientStateFingerprint,
  InboxV2Sha256Digest
} from "./sync-primitives";

export const INBOX_V2_RECIPIENT_HASH_PREIMAGE_VERSION = "v1" as const;

const MAX_CANONICAL_JSON_DEPTH = 64;
const MAX_CANONICAL_JSON_NODES = 100_000;
export const INBOX_V2_MAX_CANONICAL_HASH_PREIMAGE_BYTES = 8 * 1024 * 1024;

const hashDomains = {
  upsertState: "core:inbox-v2.recipient-upsert-state",
  tombstoneState: "core:inbox-v2.recipient-tombstone-state",
  invalidateInstruction: "core:inbox-v2.recipient-invalidate-instruction",
  snapshotManifestDefinition:
    "core:inbox-v2.recipient-snapshot-manifest-definition",
  snapshotManifest: "core:inbox-v2.recipient-snapshot-manifest",
  snapshotContext: "core:inbox-v2.recipient-snapshot-context",
  snapshotPage: "core:inbox-v2.recipient-snapshot-page",
  snapshotCumulativePageChain:
    "core:inbox-v2.recipient-snapshot-cumulative-page-chain"
} as const;

type RecipientHashEntityKey = Readonly<{
  tenantId: string;
  entityTypeId: string;
  entityId: string;
}>;

type RecipientHashConversationReference = Readonly<{
  tenantId: string;
  kind: string;
  id: string;
}>;

export type InboxV2RecipientHashTimelineContext = Readonly<{
  conversation: RecipientHashConversationReference;
  timelineSequence: string;
}> | null;

type RecipientEntityHashBase = Readonly<{
  projectionTypeId: string;
  entity: RecipientHashEntityKey;
  revision: string;
  lastChangedStreamPosition: string;
  timeline: InboxV2RecipientHashTimelineContext;
  stateSchemaId: string;
  stateSchemaVersion: string;
}>;

export type InboxV2RecipientUpsertStateHashInput<TValue = unknown> =
  RecipientEntityHashBase &
    Readonly<{
      kind: "upsert";
      value: TValue;
    }>;

export type InboxV2RecipientStateFingerprintProtection = Readonly<{
  tenantId: string;
  purpose: "recipient_state_integrity";
  keyGeneration: string;
  key: Uint8Array;
}>;

export type InboxV2RecipientTombstoneStateHashInput = RecipientEntityHashBase &
  Readonly<{
    kind: "tombstone";
    reasonId: string;
  }>;

/**
 * An invalidate carries the expected hash of the unavailable actual state and
 * a separately verifiable instruction hash. A later targeted fetch can thus
 * prove that its same-revision state is the state named by the invalidate.
 */
export type InboxV2RecipientInvalidateInstructionHashInput =
  RecipientEntityHashBase &
    Readonly<{
      kind: "invalidate";
      stateHash: string;
      reasonId: string;
      targetedFetchRequired: true;
    }>;

export type InboxV2RecipientValueContextSemanticDeclaration = Readonly<{
  semanticId: string;
  fingerprint: string;
}>;

export type InboxV2RecipientResourceResolverSemanticDeclaration = Readonly<{
  semanticId: string;
  fingerprint: string;
}>;

export type InboxV2SnapshotManifestRegistrationHashInput = Readonly<{
  projectionTypeId: string;
  entityTypeId: string;
  stateSchemaId: string;
  stateSchemaVersion: string;
  valueContextValidator: InboxV2RecipientValueContextSemanticDeclaration;
  authorizationRequirements: readonly Readonly<{
    permissionId: string;
    resourceScopeId: string;
    resourceResolver: InboxV2RecipientResourceResolverSemanticDeclaration;
  }>[];
}>;

export type InboxV2SnapshotManifestDefinitionHashInput = Readonly<{
  recipientSyncSchemaVersion: string;
  completeness: "complete_for_scope";
  registrations: readonly InboxV2SnapshotManifestRegistrationHashInput[];
  indexScopeIds: readonly string[];
}>;

export type InboxV2SnapshotManifestCoverageHashInput = Readonly<{
  entityCount: string;
  pageCount: string;
  finalEntity: RecipientHashEntityKey | null;
  pageChainRootHash: string;
}>;

export type InboxV2SnapshotManifestHashInput = Readonly<{
  manifestDefinitionHash: string;
  coverage: InboxV2SnapshotManifestCoverageHashInput;
}>;

export type InboxV2SnapshotContextHashInput<
  TAuthorizationSnapshot = unknown,
  TResumeClaims = unknown
> = Readonly<{
  tenantId: string;
  scope: Readonly<{
    id: string;
    kind: string;
    employee: Readonly<{ tenantId: string; kind: string; id: string }>;
  }>;
  snapshotId: string;
  streamEpoch: string;
  syncGeneration: string;
  authorization: TAuthorizationSnapshot;
  schemaVersion: string;
  snapshotCheckpoint: string;
  manifestHash: string;
  coverage: InboxV2SnapshotManifestCoverageHashInput;
  snapshotIssuedAt: string;
  resumeClaims: TResumeClaims;
}>;

export type InboxV2SnapshotPageFrozenContextHashInput = Readonly<{
  tenantId: string;
  scopeId: string;
  snapshotId: string;
  streamEpoch: string;
  syncGeneration: string;
  authorizationEpoch: string;
  schemaVersion: string;
  snapshotCheckpoint: string;
  snapshotIssuedAt: string;
  manifestDefinitionHash: string;
}>;

export type InboxV2SnapshotPagePositionHashInput = Readonly<{
  ordinal: string;
  afterExclusive: RecipientHashEntityKey | null;
  firstInclusive: RecipientHashEntityKey | null;
  throughInclusive: RecipientHashEntityKey | null;
  entityCount: string;
  previousPageHash: string | null;
  previousCumulativeEntityCount: string;
  cumulativeEntityCount: string;
  previousCumulativePageChainHash: string | null;
}>;

export type InboxV2SnapshotPageEntityIdentityHashInput = Readonly<{
  projectionTypeId: string;
  entity: RecipientHashEntityKey;
  revision: string;
  stateHash: string;
}>;

export type InboxV2SnapshotPageHashInput = Readonly<{
  frozenContext: InboxV2SnapshotPageFrozenContextHashInput;
  position: InboxV2SnapshotPagePositionHashInput;
  entities: readonly InboxV2SnapshotPageEntityIdentityHashInput[];
}>;

export type InboxV2SnapshotCumulativePageChainHashInput = Readonly<{
  previousCumulativePageChainHash: string | null;
  pageHash: string;
  cumulativeEntityCount: string;
}>;

/**
 * Serializes the closed JSON subset used by Inbox V2 hashes. Object properties
 * use raw UTF-16 code-unit order as required by JCS; locale-sensitive ordering
 * is deliberately forbidden.
 */
export function canonicalizeInboxV2Json(value: unknown): string {
  assertCanonicalJsonFitsHashBudget(value);
  const state = { nodeCount: 0, ancestors: new Set<object>() };
  return canonicalizeJsonValue(value, 0, state);
}

export function encodeInboxV2CanonicalJson(value: unknown): Uint8Array {
  return utf8ToBytes(canonicalizeInboxV2Json(value));
}

export function calculateInboxV2CanonicalSha256(
  value: unknown
): InboxV2Sha256Digest {
  return `sha256:${bytesToHex(sha256(encodeInboxV2CanonicalJson(value)))}` as InboxV2Sha256Digest;
}

/** Digest for an already encoded classified payload or transient secret. */
export function calculateInboxV2BytesSha256(
  value: Uint8Array
): InboxV2Sha256Digest {
  return `sha256:${bytesToHex(sha256(value))}` as InboxV2Sha256Digest;
}

function buildInboxV2RecipientUpsertStateFingerprintPreimage<TValue>(
  input: InboxV2RecipientUpsertStateHashInput<TValue>,
  protection: InboxV2RecipientStateFingerprintProtection
) {
  return {
    domain: hashDomains.upsertState,
    hashVersion: INBOX_V2_RECIPIENT_HASH_PREIMAGE_VERSION,
    protection: {
      tenantId: protection.tenantId,
      purpose: protection.purpose,
      keyGeneration: protection.keyGeneration
    },
    projectionTypeId: input.projectionTypeId,
    entity: input.entity,
    revision: input.revision,
    lastChangedStreamPosition: input.lastChangedStreamPosition,
    timeline: input.timeline,
    stateSchemaId: input.stateSchemaId,
    stateSchemaVersion: input.stateSchemaVersion,
    kind: input.kind,
    value: input.value
  } as const;
}

export function calculateInboxV2RecipientUpsertStateHash<TValue>(
  input: InboxV2RecipientUpsertStateHashInput<TValue>,
  protection: InboxV2RecipientStateFingerprintProtection
): InboxV2RecipientStateFingerprint {
  assertRecipientStateFingerprintProtection(input, protection);
  const digest = bytesToHex(
    hmac(
      sha256,
      protection.key,
      encodeInboxV2CanonicalJson(
        buildInboxV2RecipientUpsertStateFingerprintPreimage(input, protection)
      )
    )
  );
  return `hmac-sha256:${protection.keyGeneration}:${digest}` as InboxV2RecipientStateFingerprint;
}

export function verifyInboxV2RecipientUpsertStateHash<TValue>(
  input: InboxV2RecipientUpsertStateHashInput<TValue> &
    Readonly<{ stateHash: string }>,
  protection: InboxV2RecipientStateFingerprintProtection
): boolean {
  return safeHashVerification(input.stateHash, () =>
    calculateInboxV2RecipientUpsertStateHash(input, protection)
  );
}

export function buildInboxV2RecipientTombstoneStateHashPreimage(
  input: InboxV2RecipientTombstoneStateHashInput
) {
  return {
    domain: hashDomains.tombstoneState,
    hashVersion: INBOX_V2_RECIPIENT_HASH_PREIMAGE_VERSION,
    projectionTypeId: input.projectionTypeId,
    entity: input.entity,
    revision: input.revision,
    lastChangedStreamPosition: input.lastChangedStreamPosition,
    timeline: input.timeline,
    stateSchemaId: input.stateSchemaId,
    stateSchemaVersion: input.stateSchemaVersion,
    kind: input.kind,
    reasonId: input.reasonId
  } as const;
}

export function calculateInboxV2RecipientTombstoneStateHash(
  input: InboxV2RecipientTombstoneStateHashInput
): InboxV2Sha256Digest {
  return calculateInboxV2CanonicalSha256(
    buildInboxV2RecipientTombstoneStateHashPreimage(input)
  );
}

export function verifyInboxV2RecipientTombstoneStateHash(
  input: InboxV2RecipientTombstoneStateHashInput &
    Readonly<{ stateHash: string }>
): boolean {
  return safeHashVerification(input.stateHash, () =>
    calculateInboxV2RecipientTombstoneStateHash(input)
  );
}

export function buildInboxV2RecipientInvalidateInstructionHashPreimage(
  input: InboxV2RecipientInvalidateInstructionHashInput
) {
  return {
    domain: hashDomains.invalidateInstruction,
    hashVersion: INBOX_V2_RECIPIENT_HASH_PREIMAGE_VERSION,
    projectionTypeId: input.projectionTypeId,
    entity: input.entity,
    revision: input.revision,
    lastChangedStreamPosition: input.lastChangedStreamPosition,
    timeline: input.timeline,
    stateSchemaId: input.stateSchemaId,
    stateSchemaVersion: input.stateSchemaVersion,
    kind: input.kind,
    targetStateHash: input.stateHash,
    reasonId: input.reasonId,
    targetedFetchRequired: input.targetedFetchRequired
  } as const;
}

export function calculateInboxV2RecipientInvalidateInstructionHash(
  input: InboxV2RecipientInvalidateInstructionHashInput
): InboxV2Sha256Digest {
  return calculateInboxV2CanonicalSha256(
    buildInboxV2RecipientInvalidateInstructionHashPreimage(input)
  );
}

export function verifyInboxV2RecipientInvalidateInstructionHash(
  input: InboxV2RecipientInvalidateInstructionHashInput &
    Readonly<{ invalidationHash: string }>
): boolean {
  return safeHashVerification(input.invalidationHash, () =>
    calculateInboxV2RecipientInvalidateInstructionHash(input)
  );
}

export function buildInboxV2SnapshotManifestDefinitionHashPreimage(
  input: InboxV2SnapshotManifestDefinitionHashInput
) {
  const registrations = [...input.registrations]
    .map((registration) => {
      const authorizationRequirements = [
        ...registration.authorizationRequirements
      ]
        .map((requirement) => ({
          permissionId: requirement.permissionId,
          resourceScopeId: requirement.resourceScopeId,
          resourceResolver: requirement.resourceResolver
        }))
        .sort(compareAuthorizationRequirements);
      assertUniqueCanonicalKeys(
        authorizationRequirements.map(authorizationRequirementIdentity),
        "Snapshot manifest authorization requirements must be unique."
      );
      return {
        projectionTypeId: registration.projectionTypeId,
        entityTypeId: registration.entityTypeId,
        stateSchemaId: registration.stateSchemaId,
        stateSchemaVersion: registration.stateSchemaVersion,
        valueContextValidator: registration.valueContextValidator,
        authorizationRequirements
      };
    })
    .sort(compareManifestRegistrations);
  assertUniqueCanonicalKeys(
    registrations.map(manifestRegistrationIdentity),
    "Snapshot manifest registration identities must be unique."
  );
  const indexScopeIds = [...input.indexScopeIds].sort(compareUtf16Strings);
  assertUniqueCanonicalKeys(
    indexScopeIds,
    "Snapshot manifest index scope IDs must be unique."
  );

  return {
    domain: hashDomains.snapshotManifestDefinition,
    hashVersion: INBOX_V2_RECIPIENT_HASH_PREIMAGE_VERSION,
    recipientSyncSchemaVersion: input.recipientSyncSchemaVersion,
    completeness: input.completeness,
    registrations,
    indexScopeIds
  } as const;
}

export function calculateInboxV2SnapshotManifestDefinitionHash(
  input: InboxV2SnapshotManifestDefinitionHashInput
): InboxV2Sha256Digest {
  return calculateInboxV2CanonicalSha256(
    buildInboxV2SnapshotManifestDefinitionHashPreimage(input)
  );
}

export function verifyInboxV2SnapshotManifestDefinitionHash(
  input: InboxV2SnapshotManifestDefinitionHashInput &
    Readonly<{ manifestDefinitionHash: string }>
): boolean {
  return safeHashVerification(input.manifestDefinitionHash, () =>
    calculateInboxV2SnapshotManifestDefinitionHash(input)
  );
}

export function buildInboxV2SnapshotManifestHashPreimage(
  input: InboxV2SnapshotManifestHashInput
) {
  return {
    domain: hashDomains.snapshotManifest,
    hashVersion: INBOX_V2_RECIPIENT_HASH_PREIMAGE_VERSION,
    manifestDefinitionHash: input.manifestDefinitionHash,
    coverage: {
      entityCount: input.coverage.entityCount,
      pageCount: input.coverage.pageCount,
      finalEntity: input.coverage.finalEntity,
      pageChainRootHash: input.coverage.pageChainRootHash
    }
  } as const;
}

export function calculateInboxV2SnapshotManifestHash(
  input: InboxV2SnapshotManifestHashInput
): InboxV2Sha256Digest {
  return calculateInboxV2CanonicalSha256(
    buildInboxV2SnapshotManifestHashPreimage(input)
  );
}

export function verifyInboxV2SnapshotManifestHash(
  input: InboxV2SnapshotManifestHashInput & Readonly<{ manifestHash: string }>
): boolean {
  return safeHashVerification(input.manifestHash, () =>
    calculateInboxV2SnapshotManifestHash(input)
  );
}

export function buildInboxV2SnapshotContextHashPreimage<
  TAuthorizationSnapshot,
  TResumeClaims
>(
  input: InboxV2SnapshotContextHashInput<TAuthorizationSnapshot, TResumeClaims>
) {
  return {
    domain: hashDomains.snapshotContext,
    hashVersion: INBOX_V2_RECIPIENT_HASH_PREIMAGE_VERSION,
    tenantId: input.tenantId,
    scope: input.scope,
    snapshotId: input.snapshotId,
    streamEpoch: input.streamEpoch,
    syncGeneration: input.syncGeneration,
    authorization: input.authorization,
    schemaVersion: input.schemaVersion,
    snapshotCheckpoint: input.snapshotCheckpoint,
    manifestHash: input.manifestHash,
    coverage: input.coverage,
    snapshotIssuedAt: input.snapshotIssuedAt,
    resumeClaims: input.resumeClaims
  } as const;
}

export function calculateInboxV2SnapshotContextHash<
  TAuthorizationSnapshot,
  TResumeClaims
>(
  input: InboxV2SnapshotContextHashInput<TAuthorizationSnapshot, TResumeClaims>
): InboxV2Sha256Digest {
  return calculateInboxV2CanonicalSha256(
    buildInboxV2SnapshotContextHashPreimage(input)
  );
}

export function verifyInboxV2SnapshotContextHash<
  TAuthorizationSnapshot,
  TResumeClaims
>(
  input: InboxV2SnapshotContextHashInput<
    TAuthorizationSnapshot,
    TResumeClaims
  > &
    Readonly<{ snapshotContextHash: string }>
): boolean {
  return safeHashVerification(input.snapshotContextHash, () =>
    calculateInboxV2SnapshotContextHash(input)
  );
}

export function buildInboxV2SnapshotPageHashPreimage(
  input: InboxV2SnapshotPageHashInput
) {
  return {
    domain: hashDomains.snapshotPage,
    hashVersion: INBOX_V2_RECIPIENT_HASH_PREIMAGE_VERSION,
    frozenContext: {
      tenantId: input.frozenContext.tenantId,
      scopeId: input.frozenContext.scopeId,
      snapshotId: input.frozenContext.snapshotId,
      streamEpoch: input.frozenContext.streamEpoch,
      syncGeneration: input.frozenContext.syncGeneration,
      authorizationEpoch: input.frozenContext.authorizationEpoch,
      schemaVersion: input.frozenContext.schemaVersion,
      snapshotCheckpoint: input.frozenContext.snapshotCheckpoint,
      snapshotIssuedAt: input.frozenContext.snapshotIssuedAt,
      manifestDefinitionHash: input.frozenContext.manifestDefinitionHash
    },
    position: {
      ordinal: input.position.ordinal,
      afterExclusive: input.position.afterExclusive,
      firstInclusive: input.position.firstInclusive,
      throughInclusive: input.position.throughInclusive,
      entityCount: input.position.entityCount,
      previousPageHash: input.position.previousPageHash,
      previousCumulativeEntityCount:
        input.position.previousCumulativeEntityCount,
      cumulativeEntityCount: input.position.cumulativeEntityCount,
      previousCumulativePageChainHash:
        input.position.previousCumulativePageChainHash
    },
    entities: input.entities.map((entity) => ({
      projectionTypeId: entity.projectionTypeId,
      entity: entity.entity,
      revision: entity.revision,
      stateHash: entity.stateHash
    }))
  } as const;
}

export function calculateInboxV2SnapshotPageHash(
  input: InboxV2SnapshotPageHashInput
): InboxV2Sha256Digest {
  return calculateInboxV2CanonicalSha256(
    buildInboxV2SnapshotPageHashPreimage(input)
  );
}

export function verifyInboxV2SnapshotPageHash(
  input: InboxV2SnapshotPageHashInput & Readonly<{ pageHash: string }>
): boolean {
  return safeHashVerification(input.pageHash, () =>
    calculateInboxV2SnapshotPageHash(input)
  );
}

export function buildInboxV2SnapshotCumulativePageChainHashPreimage(
  input: InboxV2SnapshotCumulativePageChainHashInput
) {
  return {
    domain: hashDomains.snapshotCumulativePageChain,
    hashVersion: INBOX_V2_RECIPIENT_HASH_PREIMAGE_VERSION,
    previousCumulativePageChainHash: input.previousCumulativePageChainHash,
    pageHash: input.pageHash,
    cumulativeEntityCount: input.cumulativeEntityCount
  } as const;
}

export function calculateInboxV2SnapshotCumulativePageChainHash(
  input: InboxV2SnapshotCumulativePageChainHashInput
): InboxV2Sha256Digest {
  return calculateInboxV2CanonicalSha256(
    buildInboxV2SnapshotCumulativePageChainHashPreimage(input)
  );
}

export function verifyInboxV2SnapshotCumulativePageChainHash(
  input: InboxV2SnapshotCumulativePageChainHashInput &
    Readonly<{ cumulativePageChainHash: string }>
): boolean {
  return safeHashVerification(input.cumulativePageChainHash, () =>
    calculateInboxV2SnapshotCumulativePageChainHash(input)
  );
}

function assertCanonicalJsonFitsHashBudget(value: unknown): void {
  const state = {
    nodeCount: 0,
    byteCount: 0,
    ancestors: new Set<object>()
  };
  measureCanonicalJsonValue(value, 0, state);
}

function measureCanonicalJsonValue(
  value: unknown,
  depth: number,
  state: {
    nodeCount: number;
    byteCount: number;
    ancestors: Set<object>;
  }
): void {
  enterCanonicalJsonNode(depth, state);
  if (value === null) {
    addCanonicalJsonBytes(state, 4);
    return;
  }
  if (typeof value === "boolean") {
    addCanonicalJsonBytes(state, value ? 4 : 5);
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Inbox V2 hash preimage requires finite numbers.");
    }
    addCanonicalJsonBytes(state, JSON.stringify(value).length);
    return;
  }
  if (typeof value === "string") {
    measureCanonicalJsonString(value, state);
    return;
  }
  if (typeof value !== "object") {
    throw new TypeError(
      "Inbox V2 hash preimage must contain JSON values only."
    );
  }
  if (state.ancestors.has(value)) {
    throw new TypeError("Inbox V2 hash preimage cannot contain cycles.");
  }

  state.ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      assertCanonicalJsonArrayShape(value, state.nodeCount);
      addCanonicalJsonBytes(state, 2 + Math.max(0, value.length - 1));
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = canonicalJsonArrayItemDescriptor(value, index);
        measureCanonicalJsonValue(descriptor.value, depth + 1, state);
      }
      return;
    }

    const entries = canonicalJsonObjectEntries(
      value,
      MAX_CANONICAL_JSON_NODES - state.nodeCount,
      false
    );
    addCanonicalJsonBytes(state, 2 + Math.max(0, entries.length - 1));
    for (const [key, nested] of entries) {
      measureCanonicalJsonString(key, state);
      addCanonicalJsonBytes(state, 1);
      measureCanonicalJsonValue(nested, depth + 1, state);
    }
  } finally {
    state.ancestors.delete(value);
  }
}

function measureCanonicalJsonString(
  value: string,
  state: { byteCount: number }
): void {
  addCanonicalJsonBytes(state, 2);
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const trailing = value.charCodeAt(index + 1);
      if (index + 1 >= value.length || trailing < 0xdc00 || trailing > 0xdfff) {
        throw new TypeError(
          "Inbox V2 hash preimage strings require well-formed Unicode."
        );
      }
      addCanonicalJsonBytes(state, 4);
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new TypeError(
        "Inbox V2 hash preimage strings require well-formed Unicode."
      );
    } else if (code === 0x22 || code === 0x5c) {
      addCanonicalJsonBytes(state, 2);
    } else if (
      code === 0x08 ||
      code === 0x09 ||
      code === 0x0a ||
      code === 0x0c ||
      code === 0x0d
    ) {
      addCanonicalJsonBytes(state, 2);
    } else if (code <= 0x1f) {
      addCanonicalJsonBytes(state, 6);
    } else if (code <= 0x7f) {
      addCanonicalJsonBytes(state, 1);
    } else if (code <= 0x7ff) {
      addCanonicalJsonBytes(state, 2);
    } else {
      addCanonicalJsonBytes(state, 3);
    }
  }
}

function enterCanonicalJsonNode(
  depth: number,
  state: { nodeCount: number }
): void {
  if (depth > MAX_CANONICAL_JSON_DEPTH) {
    throw new TypeError("Inbox V2 hash preimage exceeds its depth limit.");
  }
  state.nodeCount += 1;
  if (state.nodeCount > MAX_CANONICAL_JSON_NODES) {
    throw new TypeError("Inbox V2 hash preimage exceeds its node limit.");
  }
}

function addCanonicalJsonBytes(
  state: { byteCount: number },
  byteCount: number
): void {
  state.byteCount += byteCount;
  if (state.byteCount > INBOX_V2_MAX_CANONICAL_HASH_PREIMAGE_BYTES) {
    throw new TypeError("Inbox V2 hash preimage exceeds its byte limit.");
  }
}

function canonicalizeJsonValue(
  value: unknown,
  depth: number,
  state: {
    nodeCount: number;
    ancestors: Set<object>;
  }
): string {
  enterCanonicalJsonNode(depth, state);

  if (value === null || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Inbox V2 hash preimage requires finite numbers.");
    }
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    assertWellFormedUnicode(value);
    return JSON.stringify(value);
  }
  if (typeof value !== "object") {
    throw new TypeError(
      "Inbox V2 hash preimage must contain JSON values only."
    );
  }
  if (state.ancestors.has(value)) {
    throw new TypeError("Inbox V2 hash preimage cannot contain cycles.");
  }

  state.ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      assertCanonicalJsonArrayShape(value, state.nodeCount);
      return `[${Array.from({ length: value.length }, (_, index) => {
        const descriptor = canonicalJsonArrayItemDescriptor(value, index);
        return canonicalizeJsonValue(descriptor.value, depth + 1, state);
      }).join(",")}]`;
    }

    const entries = canonicalJsonObjectEntries(
      value,
      MAX_CANONICAL_JSON_NODES - state.nodeCount,
      true
    );
    return `{${entries
      .map(
        ([key, nested]) =>
          `${JSON.stringify(key)}:${canonicalizeJsonValue(
            nested,
            depth + 1,
            state
          )}`
      )
      .join(",")}}`;
  } finally {
    state.ancestors.delete(value);
  }
}

function assertCanonicalJsonArrayShape(
  value: readonly unknown[],
  alreadyVisitedNodes: number
): void {
  if (value.length > MAX_CANONICAL_JSON_NODES - alreadyVisitedNodes) {
    throw new TypeError("Inbox V2 hash preimage exceeds its node limit.");
  }
  const ownPropertyNames = Object.getOwnPropertyNames(value);
  if (
    ownPropertyNames.length !== value.length + 1 ||
    !ownPropertyNames.includes("length") ||
    Object.getOwnPropertySymbols(value).length > 0
  ) {
    throw new TypeError(
      "Inbox V2 hash preimage arrays must be dense JSON arrays."
    );
  }
  for (let index = 0; index < value.length; index += 1) {
    canonicalJsonArrayItemDescriptor(value, index);
  }
}

function canonicalJsonArrayItemDescriptor(
  value: readonly unknown[],
  index: number
): PropertyDescriptor & Readonly<{ value: unknown }> {
  const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
  if (
    descriptor === undefined ||
    !descriptor.enumerable ||
    !("value" in descriptor)
  ) {
    throw new TypeError(
      "Inbox V2 hash preimage arrays require dense data properties."
    );
  }
  return descriptor as PropertyDescriptor & Readonly<{ value: unknown }>;
}

function canonicalJsonObjectEntries(
  value: object,
  remainingNodeBudget: number,
  sort: boolean
): readonly (readonly [string, unknown])[] {
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(
      "Inbox V2 hash preimage objects must be plain JSON objects."
    );
  }

  const keys = Object.getOwnPropertyNames(value);
  if (keys.length > remainingNodeBudget) {
    throw new TypeError("Inbox V2 hash preimage exceeds its node limit.");
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError(
      "Inbox V2 hash preimage objects require enumerable string properties."
    );
  }
  if (sort) {
    keys.sort(compareUtf16Strings);
  }

  return keys.map((key) => {
    assertWellFormedUnicode(key);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !("value" in descriptor)
    ) {
      throw new TypeError(
        "Inbox V2 hash preimage objects require enumerable data properties."
      );
    }
    return [key, descriptor.value] as const;
  });
}

function assertWellFormedUnicode(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const trailing = value.charCodeAt(index + 1);
      if (index + 1 >= value.length || trailing < 0xdc00 || trailing > 0xdfff) {
        throw new TypeError(
          "Inbox V2 hash preimage strings require well-formed Unicode."
        );
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new TypeError(
        "Inbox V2 hash preimage strings require well-formed Unicode."
      );
    }
  }
}

function compareUtf16Strings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareManifestRegistrations(
  left: InboxV2SnapshotManifestRegistrationHashInput,
  right: InboxV2SnapshotManifestRegistrationHashInput
): number {
  return compareUtf16Strings(
    manifestRegistrationIdentity(left),
    manifestRegistrationIdentity(right)
  );
}

function compareAuthorizationRequirements(
  left: InboxV2SnapshotManifestRegistrationHashInput["authorizationRequirements"][number],
  right: InboxV2SnapshotManifestRegistrationHashInput["authorizationRequirements"][number]
): number {
  return compareUtf16Strings(
    `${left.resourceResolver.semanticId}\u0000${left.permissionId}\u0000${left.resourceScopeId}\u0000${left.resourceResolver.fingerprint}`,
    `${right.resourceResolver.semanticId}\u0000${right.permissionId}\u0000${right.resourceScopeId}\u0000${right.resourceResolver.fingerprint}`
  );
}

function manifestRegistrationIdentity(
  registration: InboxV2SnapshotManifestRegistrationHashInput
): string {
  return `${registration.projectionTypeId}\u0000${registration.entityTypeId}\u0000${registration.stateSchemaId}\u0000${registration.stateSchemaVersion}`;
}

function authorizationRequirementIdentity(
  requirement: InboxV2SnapshotManifestRegistrationHashInput["authorizationRequirements"][number]
): string {
  return `${requirement.resourceResolver.semanticId}\u0000${requirement.permissionId}\u0000${requirement.resourceScopeId}`;
}

function assertUniqueCanonicalKeys(
  keys: readonly string[],
  message: string
): void {
  if (new Set(keys).size !== keys.length) {
    throw new TypeError(message);
  }
}

function assertRecipientStateFingerprintProtection<TValue>(
  input: InboxV2RecipientUpsertStateHashInput<TValue>,
  protection: InboxV2RecipientStateFingerprintProtection
): void {
  if (
    protection.tenantId !== input.entity.tenantId ||
    protection.purpose !== "recipient_state_integrity" ||
    !/^[A-Za-z0-9][A-Za-z0-9._~:-]{7,255}$/u.test(protection.keyGeneration) ||
    !(protection.key instanceof Uint8Array) ||
    protection.key.byteLength < 32 ||
    protection.key.byteLength > 128
  ) {
    throw new TypeError(
      "Recipient state fingerprint requires matching tenant/purpose/generation and a 32..128-byte lifecycle key."
    );
  }
}

function safeHashVerification(
  supplied: string,
  calculate: () => string
): boolean {
  try {
    return supplied === calculate();
  } catch {
    return false;
  }
}
