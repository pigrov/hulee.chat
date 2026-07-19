import {
  canonicalizeInboxV2Json,
  inboxV2CatalogIdSchema,
  inboxV2RoutingTokenSchema,
  inboxV2SafeSourceDiagnosticSchema,
  inboxV2TenantIdSchema,
  type InboxV2SafeSourceDiagnostic
} from "@hulee/contracts";
import {
  isSqlInboxV2SourceAttachmentMaterializationRepository,
  isSqlInboxV2SourceAttachmentReservationCommandPort,
  isSqlInboxV2SourceAttachmentReservationCommandPortForRepository
} from "@hulee/db/internal/attachment-materialization";
import { Buffer } from "node:buffer";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import type {
  InboxV2SourceProcessingRuntimeClaim,
  InboxV2SourceProcessingStageHandler
} from "./source-processing-runtime-coordinator";

const SOURCE_ATTACHMENT_LIMIT = 64;
const SOURCE_LOCATOR_HANDLE_PATTERN = /^src_ref_[A-Za-z0-9_-]{43}$/u;
const STORAGE_KEY_PREFIX_PATTERN =
  /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[^\\]{2,1024}\/$/u;
const NAMESPACE_KEY_MIN_BYTES = 32;
const NAMESPACE_KEYRING_LIMIT = 4;

class SourceAttachmentReservationNamespaceUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceAttachmentReservationNamespaceUnavailableError";
  }
}

const trustedReservationPlanners = new WeakSet<object>();
const trustedMaterializationHandlers = new WeakSet<object>();
const trustedNamespaceAuthorities = new WeakMap<
  object,
  NamespaceAuthorityState
>();
const trustedStorageAddressResolvers = new WeakMap<
  object,
  TenantStorageAddressResolverState
>();

export type InboxV2SourceAttachmentMaterializationOrigin = Readonly<{
  tenantId: string;
  workId: string;
  normalizedEventId: string;
  sourceOccurrenceId: string;
  conversationId: string;
  timelineItemId: string;
  messageId: string;
  messageRevision: string;
  timelineContentId: string;
  contentRevision: string;
  visibilityBoundary: "external_work" | "internal";
  dataClassId: string;
  processingPurposeId: string;
  retentionAnchorAt: string;
  causeEventId: string;
  causeMutationId: string;
  causeStreamCommitId: string;
  causeStreamPosition: string;
  correlationId: string;
  causedAt: string;
}>;

export type InboxV2SourceAttachmentMaterializationAnchor = Readonly<{
  ordinal: number;
  blockKey: string;
  attachmentId: string;
  attachmentRevision: string;
}>;

export type InboxV2SourceAttachmentMaterializationPlan = Readonly<{
  origin: InboxV2SourceAttachmentMaterializationOrigin;
  anchors: readonly InboxV2SourceAttachmentMaterializationAnchor[];
}>;

export type InboxV2SourceAttachmentReservationInput = Readonly<{
  tenantId: string;
  reservationNamespaceGeneration: string;
  jobId: string;
  attachmentId: string;
  file: Readonly<{
    id: string;
    expectedRevision: string;
    dataClassId: string;
    processingPurposeId: string;
    retentionAnchorAt: string;
  }>;
  content: Readonly<{
    conversationId: string;
    timelineItemId: string;
    parentMessageId: string;
    expectedParentRevision: string;
    visibilityBoundary: "external_work" | "internal";
    id: string;
    expectedRevision: string;
    blockKey: string;
    mutationFenceSha256: string;
  }>;
  sourceOccurrenceId: string;
  sourceLocator: Readonly<{
    kind: "provider";
    reference: string;
  }>;
  causeEventId: string;
  causeMutationId: string;
  causeStreamCommitId: string;
  causeStreamPosition: string;
  correlationId: string;
  causedAt: string;
  idempotencyToken: string;
  expectedAttachmentRevision: string;
  reservation: Readonly<{
    fileVersionId: string;
    objectVersionId: string;
    storageRootId: string;
    storageKey: string;
  }>;
}>;

export type InboxV2SourceAttachmentReservationResult =
  | Readonly<{
      kind: "reserved" | "already_reserved";
      jobId: string;
      fileId: string;
      fileVersionId: string;
      objectVersionId: string;
      storageRootId: string;
      storageKey: string;
    }>
  | Readonly<{
      kind: "conflict";
      code:
        | "attachment_not_pending"
        | "attachment_revision_conflict"
        | "content_fence_conflict"
        | "file_conflict"
        | "job_conflict"
        | "reservation_conflict";
    }>;

export type InboxV2SourceAttachmentMaterializationRepositoryPort = Readonly<{
  loadPlan(claim: InboxV2SourceProcessingRuntimeClaim): Promise<
    | Readonly<{
        kind: "selected";
        plan: InboxV2SourceAttachmentMaterializationPlan;
      }>
    | Readonly<{ kind: "no_materializable_message" }>
    | Readonly<{ kind: "lease_lost" }>
    | Readonly<{ kind: "reconciliation_missing" }>
  >;
  verifyExactReservationSet(input: {
    claim: InboxV2SourceProcessingRuntimeClaim;
    plan: InboxV2SourceAttachmentMaterializationPlan;
    reservations: readonly InboxV2SourceAttachmentReservationInput[];
  }): Promise<
    | Readonly<{ kind: "complete"; attachmentCount: number }>
    | Readonly<{ kind: "incomplete"; attachmentCount: number }>
    | Readonly<{ kind: "lease_lost" }>
  >;
}>;

/**
 * The implementation behind this port must obtain a complete current
 * `core:file.upload` plus Conversation-read decision set and close each
 * reservation through the authorized DB coordinator. A provider payload is
 * never authorization input.
 */
export type InboxV2SourceAttachmentReservationCommandPort = Readonly<{
  reserve(
    input: InboxV2SourceAttachmentReservationInput
  ): Promise<InboxV2SourceAttachmentReservationResult>;
}>;

export type InboxV2SourceAttachmentReservationNamespacePurpose =
  | "job_id"
  | "file_id"
  | "file_version_id"
  | "object_version_id"
  | "idempotency_token"
  | "provider_source_locator";

export type InboxV2SourceAttachmentReservationNamespaceAuthority = Readonly<{
  kind: "source_attachment_reservation_namespace_authority";
}>;

export type InboxV2SourceAttachmentNamespaceKey = Readonly<{
  generation: string;
  key: Uint8Array;
  /** Immutable admission cutover; source facts use the latest key active at causedAt. */
  activatedAt: string;
  /** Required for every non-active key; the verifier fails closed after it. */
  verifyUntil: string | null;
}>;

type NamespaceAuthorityKeyState = Readonly<{
  generation: string;
  key: Buffer;
  activatedAtEpoch: number;
  verifyUntilEpoch: number | null;
}>;

type NamespaceAuthorityState = Readonly<{
  activeGeneration: string;
  keys: readonly NamespaceAuthorityKeyState[];
  now: () => number;
}>;

export type InboxV2TenantAttachmentStorageAddress = Readonly<{
  tenantId: string;
  storageRootId: string;
  keyPrefix: string;
}>;

export type InboxV2TenantAttachmentStorageAddressResolver = Readonly<{
  kind: "tenant_attachment_storage_address_resolver";
}>;

type TenantStorageAddressResolverState = Readonly<{
  resolve(tenantId: string): InboxV2TenantAttachmentStorageAddress;
}>;

export type InboxV2ProviderSourceLocatorVerificationInput = Readonly<{
  tenantId: string;
  reservationNamespaceGeneration: string;
  sourceOccurrenceId: string;
  parentMessageId: string;
  timelineContentId: string;
  expectedContentRevision: string;
  blockKey: string;
  attachmentId: string;
  expectedAttachmentRevision: string;
  reference: string;
}>;

export type InboxV2ProviderSourceLocatorVerificationResult =
  | Readonly<{ kind: "verified" }>
  | Readonly<{ kind: "namespace_unavailable" }>
  | Readonly<{ kind: "reference_mismatch" }>;

type InboxV2ProviderSourceLocatorFacts = Omit<
  InboxV2ProviderSourceLocatorVerificationInput,
  "reference" | "reservationNamespaceGeneration"
>;

export type InboxV2TrustedSourceAttachmentReservationPlanner = Readonly<{
  plan(input: {
    plan: InboxV2SourceAttachmentMaterializationPlan;
    anchor: InboxV2SourceAttachmentMaterializationAnchor;
  }): InboxV2SourceAttachmentReservationInput;
  /**
   * Re-derives a handle from facts present on the durable job claim. A provider
   * loader can therefore resolve the SourceOccurrence/evidence path without
   * persisting a URL, bearer token or provider file secret in the job.
   */
  verifyProviderSourceLocator(
    input: InboxV2ProviderSourceLocatorVerificationInput
  ): InboxV2ProviderSourceLocatorVerificationResult;
}>;

export type InboxV2SourceAttachmentMaterializationHandlerOptions = Readonly<{
  repository: InboxV2SourceAttachmentMaterializationRepositoryPort;
  reservationCommands: InboxV2SourceAttachmentReservationCommandPort;
  reservationPlanner: InboxV2TrustedSourceAttachmentReservationPlanner;
}>;

export type InboxV2TrustedSourceAttachmentMaterializationHandler =
  InboxV2SourceProcessingStageHandler;

/**
 * Creates a process-authentic, tenant-keyed HMAC authority. Callers supply only
 * key material; they cannot substitute an unkeyed digest callback. A bounded
 * retired-key ring keeps already-reserved opaque locators verifiable through a
 * finite rotation window.
 */
export function createInboxV2SourceAttachmentReservationNamespaceAuthority(
  input: Readonly<{
    activeGeneration: string;
    keys: readonly InboxV2SourceAttachmentNamespaceKey[];
    now?: () => number;
  }>
): InboxV2SourceAttachmentReservationNamespaceAuthority {
  const activeGeneration = inboxV2RoutingTokenSchema.parse(
    input.activeGeneration
  );
  if (
    input.keys.length < 1 ||
    input.keys.length > NAMESPACE_KEYRING_LIMIT ||
    new Set(input.keys.map(({ generation }) => generation)).size !==
      input.keys.length
  ) {
    throw new TypeError(
      "Source attachment namespace keyring must be non-empty, unique and bounded."
    );
  }
  const now = input.now ?? Date.now;
  const nowEpoch = now();
  if (!Number.isFinite(nowEpoch)) {
    throw new TypeError("Source attachment namespace clock is invalid.");
  }
  const keys = input.keys.map((candidate): NamespaceAuthorityKeyState => {
    const generation = inboxV2RoutingTokenSchema.parse(candidate.generation);
    if (
      !(candidate.key instanceof Uint8Array) ||
      candidate.key.byteLength < NAMESPACE_KEY_MIN_BYTES
    ) {
      throw new TypeError(
        "Source attachment namespace HMAC keys must contain at least 32 bytes."
      );
    }
    const verifyUntilEpoch =
      candidate.verifyUntil === null ? null : Date.parse(candidate.verifyUntil);
    const activatedAtEpoch = Date.parse(candidate.activatedAt);
    if (
      !Number.isFinite(activatedAtEpoch) ||
      activatedAtEpoch > nowEpoch ||
      (generation === activeGeneration
        ? verifyUntilEpoch !== null
        : verifyUntilEpoch === null ||
          !Number.isFinite(verifyUntilEpoch) ||
          verifyUntilEpoch <= nowEpoch)
    ) {
      throw new TypeError(
        "The active namespace key must not expire and every retired key needs a future finite verification deadline."
      );
    }
    return Object.freeze({
      generation,
      key: Buffer.from(candidate.key),
      activatedAtEpoch,
      verifyUntilEpoch
    });
  });
  if (
    new Set(keys.map(({ activatedAtEpoch }) => activatedAtEpoch)).size !==
    keys.length
  ) {
    throw new TypeError(
      "Source attachment namespace generations require unique activation times."
    );
  }
  const activeKey = keys.find(
    ({ generation }) => generation === activeGeneration
  );
  if (
    activeKey === undefined ||
    keys.some(
      ({ generation, activatedAtEpoch }) =>
        generation !== activeGeneration &&
        activatedAtEpoch >= activeKey.activatedAtEpoch
    )
  ) {
    throw new TypeError(
      "Source attachment namespace active generation must be the latest admission key."
    );
  }
  const authority = Object.freeze({
    kind: "source_attachment_reservation_namespace_authority" as const
  });
  trustedNamespaceAuthorities.set(authority, {
    activeGeneration,
    keys: Object.freeze(keys),
    now
  });
  return authority;
}

/**
 * Wraps the deployment's tenant storage catalog. The returned marker exposes no
 * root or prefix; every plan resolves and validates the exact tenant address.
 */
export function createInboxV2TenantAttachmentStorageAddressResolver(input: {
  resolve(tenantId: string): InboxV2TenantAttachmentStorageAddress;
}): InboxV2TenantAttachmentStorageAddressResolver {
  if (typeof input?.resolve !== "function") {
    throw new TypeError(
      "Tenant attachment storage resolution requires a trusted resolver."
    );
  }
  const resolver = Object.freeze({
    kind: "tenant_attachment_storage_address_resolver" as const
  });
  trustedStorageAddressResolvers.set(resolver, { resolve: input.resolve });
  return resolver;
}

/** Creates deterministic reservation inputs from authentic HMAC/storage authorities. */
export function createInboxV2SourceAttachmentReservationPlanner(input: {
  namespaceAuthority: InboxV2SourceAttachmentReservationNamespaceAuthority;
  storageAddressResolver: InboxV2TenantAttachmentStorageAddressResolver;
}): InboxV2TrustedSourceAttachmentReservationPlanner {
  const namespaceAuthority = trustedNamespaceAuthorities.get(
    input.namespaceAuthority as object
  );
  const storageAddressResolver = trustedStorageAddressResolvers.get(
    input.storageAddressResolver as object
  );
  if (
    namespaceAuthority === undefined ||
    storageAddressResolver === undefined
  ) {
    throw new TypeError(
      "Source attachment reservation planner requires authentic HMAC and tenant-storage authorities."
    );
  }

  const derive = (
    purpose: InboxV2SourceAttachmentReservationNamespacePurpose,
    tenantId: string,
    identity: unknown,
    generation = namespaceAuthority.activeGeneration
  ): string => {
    const canonicalPreimage = canonicalizeInboxV2Json({
      domain: "core:inbox-v2.source-attachment-reservation-identity",
      version: "v1",
      tenantId,
      namespaceGeneration: generation,
      purpose,
      identity
    });
    const key = namespaceAuthority.keys.find(
      (candidate) => candidate.generation === generation
    );
    if (key === undefined) {
      throw new SourceAttachmentReservationNamespaceUnavailableError(
        "Source attachment namespace generation is unavailable."
      );
    }
    return createHmac("sha256", key.key)
      .update(canonicalPreimage, "utf8")
      .digest("hex");
  };

  const providerSourceReference = (
    locator: InboxV2ProviderSourceLocatorFacts,
    generation = namespaceAuthority.activeGeneration
  ): string => {
    const digest = derive(
      "provider_source_locator",
      locator.tenantId,
      providerSourceLocatorIdentity(locator),
      generation
    );
    return `src_ref_${Buffer.from(digest, "hex").toString("base64url")}`;
  };

  const planner = Object.freeze({
    plan({ plan, anchor }) {
      assertPlannerInput(plan, anchor);
      const origin = plan.origin;
      const storageAddress = resolveTenantStorageAddress(
        storageAddressResolver,
        origin.tenantId
      );
      const namespaceGeneration = selectNamespaceGenerationForOrigin(
        namespaceAuthority,
        origin.causedAt
      );
      const identity = reservationIdentity(origin, anchor);
      const jobDigest = derive(
        "job_id",
        origin.tenantId,
        identity,
        namespaceGeneration
      );
      const fileDigest = derive(
        "file_id",
        origin.tenantId,
        identity,
        namespaceGeneration
      );
      const fileVersionDigest = derive(
        "file_version_id",
        origin.tenantId,
        identity,
        namespaceGeneration
      );
      const objectVersionDigest = derive(
        "object_version_id",
        origin.tenantId,
        identity,
        namespaceGeneration
      );
      const idempotencyDigest = derive(
        "idempotency_token",
        origin.tenantId,
        identity,
        namespaceGeneration
      );
      const locatorFacts = providerSourceLocatorFacts(origin, anchor);
      const sourceLocatorReference = providerSourceReference(
        locatorFacts,
        namespaceGeneration
      );
      if (!SOURCE_LOCATOR_HANDLE_PATTERN.test(sourceLocatorReference)) {
        throw new TypeError(
          "Source attachment locator authority did not issue an opaque src_ref handle."
        );
      }

      return deepFreeze({
        tenantId: origin.tenantId,
        reservationNamespaceGeneration: namespaceGeneration,
        jobId: `attachment_materialization_job:${jobDigest}`,
        attachmentId: anchor.attachmentId,
        file: {
          id: `file:${fileDigest}`,
          expectedRevision: "1",
          dataClassId: origin.dataClassId,
          processingPurposeId: origin.processingPurposeId,
          retentionAnchorAt: origin.retentionAnchorAt
        },
        content: {
          conversationId: origin.conversationId,
          timelineItemId: origin.timelineItemId,
          parentMessageId: origin.messageId,
          expectedParentRevision: origin.messageRevision,
          visibilityBoundary: origin.visibilityBoundary,
          id: origin.timelineContentId,
          expectedRevision: origin.contentRevision,
          blockKey: anchor.blockKey,
          mutationFenceSha256: attachmentContentMutationFence({
            tenantId: origin.tenantId,
            attachmentId: anchor.attachmentId,
            expectedAttachmentRevision: anchor.attachmentRevision,
            timelineContentId: origin.timelineContentId,
            expectedContentRevision: origin.contentRevision,
            contentBlockKey: anchor.blockKey
          })
        },
        sourceOccurrenceId: origin.sourceOccurrenceId,
        sourceLocator: {
          kind: "provider",
          reference: sourceLocatorReference
        },
        causeEventId: origin.causeEventId,
        causeMutationId: origin.causeMutationId,
        causeStreamCommitId: origin.causeStreamCommitId,
        causeStreamPosition: origin.causeStreamPosition,
        correlationId: origin.correlationId,
        causedAt: origin.causedAt,
        idempotencyToken: `attachment-reservation:v2:${namespaceGeneration}:${idempotencyDigest}`,
        expectedAttachmentRevision: anchor.attachmentRevision,
        reservation: {
          fileVersionId: `file_version:${fileVersionDigest}`,
          objectVersionId: `file_object_version:${objectVersionDigest}`,
          storageRootId: storageAddress.storageRootId,
          storageKey: `${storageAddress.keyPrefix}attachments/${fileDigest}/versions/${objectVersionDigest}`
        }
      });
    },
    verifyProviderSourceLocator(candidate) {
      if (!SOURCE_LOCATOR_HANDLE_PATTERN.test(candidate.reference)) {
        return { kind: "reference_mismatch" as const };
      }
      const { reference, reservationNamespaceGeneration, ...facts } = candidate;
      const actual = Buffer.from(reference, "utf8");
      const now = namespaceAuthority.now();
      if (!Number.isFinite(now)) {
        return { kind: "namespace_unavailable" as const };
      }
      const key = namespaceAuthority.keys.find(
        ({ generation }) => generation === reservationNamespaceGeneration
      );
      if (
        key === undefined ||
        (key.verifyUntilEpoch !== null && key.verifyUntilEpoch <= now)
      ) {
        return { kind: "namespace_unavailable" as const };
      }
      const expected = Buffer.from(
        providerSourceReference(facts, key.generation),
        "utf8"
      );
      return actual.byteLength === expected.byteLength &&
        timingSafeEqual(actual, expected)
        ? { kind: "verified" as const }
        : { kind: "reference_mismatch" as const };
    }
  }) satisfies InboxV2TrustedSourceAttachmentReservationPlanner;
  trustedReservationPlanners.add(planner);
  return planner;
}

export function isInboxV2TrustedSourceAttachmentReservationPlanner(
  value: unknown
): value is InboxV2TrustedSourceAttachmentReservationPlanner {
  return (
    typeof value === "object" &&
    value !== null &&
    trustedReservationPlanners.has(value)
  );
}

/**
 * Concrete materialization-stage handler. Reservations are intentionally
 * sequential: after a crash at N/2, deterministic command identities make the
 * first N/2 return `already_reserved`, while the exact-set proof prevents the
 * source work from completing until every current-head anchor has one job.
 */
export function createInboxV2SourceAttachmentMaterializationHandler(
  options: InboxV2SourceAttachmentMaterializationHandlerOptions
): InboxV2TrustedSourceAttachmentMaterializationHandler {
  assertHandlerOptions(options, true);
  return createMaterializationHandler(options, true);
}

/** Relative-module test seam; never registered as production durability authority. */
export function createInboxV2SourceAttachmentMaterializationHandlerForTest(
  options: InboxV2SourceAttachmentMaterializationHandlerOptions
): InboxV2SourceProcessingStageHandler {
  assertHandlerOptions(options, false);
  return createMaterializationHandler(options, false);
}

function createMaterializationHandler(
  options: InboxV2SourceAttachmentMaterializationHandlerOptions,
  productionTrusted: boolean
): InboxV2SourceProcessingStageHandler {
  const handler = Object.freeze({
    async process(
      claim: InboxV2SourceProcessingRuntimeClaim
    ): Promise<
      Awaited<ReturnType<InboxV2SourceProcessingStageHandler["process"]>>
    > {
      if (
        claim.attempt.scope.stage !== "materialization" ||
        claim.attempt.scope.normalizedEventId === null ||
        claim.rawIngressClaim !== null
      ) {
        return failed(
          claim,
          "core:source-materialization-stage-scope-invalid",
          false
        );
      }

      let selected: Awaited<
        ReturnType<
          InboxV2SourceAttachmentMaterializationRepositoryPort["loadPlan"]
        >
      >;
      try {
        selected = await options.repository.loadPlan(claim);
      } catch {
        return failed(
          claim,
          "core:source-materialization-plan-load-failed",
          true
        );
      }
      if (selected.kind === "lease_lost") {
        return failed(claim, "core:source-materialization-lease-lost", true);
      }
      if (selected.kind === "reconciliation_missing") {
        return failed(
          claim,
          "core:source-materialization-reconciliation-missing",
          true
        );
      }
      if (selected.kind === "no_materializable_message") {
        return Object.freeze({ kind: "processed" as const });
      }

      let reservations: readonly InboxV2SourceAttachmentReservationInput[];
      try {
        reservations = Object.freeze(
          selected.plan.anchors.map((anchor) =>
            options.reservationPlanner.plan({
              plan: selected.plan,
              anchor
            })
          )
        );
      } catch (error) {
        if (
          error instanceof SourceAttachmentReservationNamespaceUnavailableError
        ) {
          return failed(
            claim,
            "core:source-materialization-namespace-unavailable",
            true
          );
        }
        return failed(claim, "core:source-materialization-plan-invalid", false);
      }

      for (const reservation of reservations) {
        let result: InboxV2SourceAttachmentReservationResult;
        try {
          result = await options.reservationCommands.reserve(reservation);
        } catch {
          return failed(
            claim,
            "core:source-materialization-reservation-failed",
            true
          );
        }
        if (result.kind === "conflict") {
          return failed(
            claim,
            "core:source-materialization-reservation-conflict",
            true
          );
        }
        if (!reservationResultMatches(result, reservation)) {
          return failed(
            claim,
            "core:source-materialization-reservation-result-invalid",
            false
          );
        }
      }

      let verification: Awaited<
        ReturnType<
          InboxV2SourceAttachmentMaterializationRepositoryPort["verifyExactReservationSet"]
        >
      >;
      try {
        verification = await options.repository.verifyExactReservationSet({
          claim,
          plan: selected.plan,
          reservations
        });
      } catch {
        return failed(
          claim,
          "core:source-materialization-verification-failed",
          true
        );
      }
      if (verification.kind === "lease_lost") {
        return failed(claim, "core:source-materialization-lease-lost", true);
      }
      if (
        verification.kind !== "complete" ||
        verification.attachmentCount !== reservations.length
      ) {
        return failed(
          claim,
          "core:source-materialization-reservation-incomplete",
          true
        );
      }
      return Object.freeze({ kind: "processed" as const });
    }
  });
  if (productionTrusted) trustedMaterializationHandlers.add(handler);
  return handler;
}

export function isInboxV2TrustedSourceAttachmentMaterializationHandler(
  value: unknown
): value is InboxV2TrustedSourceAttachmentMaterializationHandler {
  return (
    typeof value === "object" &&
    value !== null &&
    trustedMaterializationHandlers.has(value)
  );
}

function assertHandlerOptions(
  options: InboxV2SourceAttachmentMaterializationHandlerOptions,
  production: boolean
): void {
  if (
    typeof options?.repository?.loadPlan !== "function" ||
    typeof options.repository.verifyExactReservationSet !== "function" ||
    typeof options.reservationCommands?.reserve !== "function" ||
    !trustedReservationPlanners.has(options.reservationPlanner as object) ||
    (production &&
      (!isSqlInboxV2SourceAttachmentMaterializationRepository(
        options.repository
      ) ||
        !isSqlInboxV2SourceAttachmentReservationCommandPort(
          options.reservationCommands
        ) ||
        !isSqlInboxV2SourceAttachmentReservationCommandPortForRepository(
          options.reservationCommands,
          options.repository
        )))
  ) {
    throw new TypeError(
      "Source attachment materialization requires the same-database SQL plan/exact-set repository, authorized reservation commands and an authentic HMAC planner."
    );
  }
}

function assertPlannerInput(
  plan: InboxV2SourceAttachmentMaterializationPlan,
  anchor: InboxV2SourceAttachmentMaterializationAnchor
): void {
  if (
    plan.anchors.length > SOURCE_ATTACHMENT_LIMIT ||
    !plan.anchors.some(
      (candidate) =>
        candidate.ordinal === anchor.ordinal &&
        candidate.blockKey === anchor.blockKey &&
        candidate.attachmentId === anchor.attachmentId &&
        candidate.attachmentRevision === anchor.attachmentRevision
    )
  ) {
    throw new TypeError(
      "Source attachment reservation anchor is outside its bounded current-head plan."
    );
  }
}

function resolveTenantStorageAddress(
  resolver: TenantStorageAddressResolverState,
  rawTenantId: string
): InboxV2TenantAttachmentStorageAddress {
  const tenantId = inboxV2TenantIdSchema.parse(rawTenantId);
  const address = resolver.resolve(tenantId);
  if (
    inboxV2TenantIdSchema.parse(address.tenantId) !== tenantId ||
    !STORAGE_KEY_PREFIX_PATTERN.test(address.keyPrefix) ||
    hasControlCharacter(address.keyPrefix)
  ) {
    throw new TypeError(
      "Tenant attachment storage resolver returned a cross-tenant or unsafe address."
    );
  }
  return Object.freeze({
    tenantId,
    storageRootId: inboxV2CatalogIdSchema.parse(address.storageRootId),
    keyPrefix: address.keyPrefix
  });
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0)!;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}

function selectNamespaceGenerationForOrigin(
  authority: NamespaceAuthorityState,
  causedAt: string
): string {
  const causedAtEpoch = Date.parse(causedAt);
  const now = authority.now();
  if (!Number.isFinite(causedAtEpoch) || !Number.isFinite(now)) {
    throw new TypeError("Source attachment namespace origin time is invalid.");
  }
  const selected = authority.keys
    .filter(({ activatedAtEpoch }) => activatedAtEpoch <= causedAtEpoch)
    .sort((left, right) => right.activatedAtEpoch - left.activatedAtEpoch)[0];
  if (
    selected === undefined ||
    (selected.verifyUntilEpoch !== null && selected.verifyUntilEpoch <= now)
  ) {
    throw new SourceAttachmentReservationNamespaceUnavailableError(
      "Source attachment namespace generation is outside its admission/retirement window."
    );
  }
  return selected.generation;
}

function reservationIdentity(
  origin: InboxV2SourceAttachmentMaterializationOrigin,
  anchor: InboxV2SourceAttachmentMaterializationAnchor
): unknown {
  return {
    sourceOccurrenceId: origin.sourceOccurrenceId,
    messageId: origin.messageId,
    messageRevision: origin.messageRevision,
    timelineContentId: origin.timelineContentId,
    contentRevision: origin.contentRevision,
    blockKey: anchor.blockKey,
    attachmentId: anchor.attachmentId,
    attachmentRevision: anchor.attachmentRevision,
    causeEventId: origin.causeEventId,
    causeMutationId: origin.causeMutationId,
    causeStreamCommitId: origin.causeStreamCommitId,
    causeStreamPosition: origin.causeStreamPosition
  };
}

function providerSourceLocatorFacts(
  origin: InboxV2SourceAttachmentMaterializationOrigin,
  anchor: InboxV2SourceAttachmentMaterializationAnchor
): InboxV2ProviderSourceLocatorFacts {
  return {
    tenantId: origin.tenantId,
    sourceOccurrenceId: origin.sourceOccurrenceId,
    parentMessageId: origin.messageId,
    timelineContentId: origin.timelineContentId,
    expectedContentRevision: origin.contentRevision,
    blockKey: anchor.blockKey,
    attachmentId: anchor.attachmentId,
    expectedAttachmentRevision: anchor.attachmentRevision
  };
}

function providerSourceLocatorIdentity(
  input: InboxV2ProviderSourceLocatorFacts
): unknown {
  return {
    sourceOccurrenceId: input.sourceOccurrenceId,
    parentMessageId: input.parentMessageId,
    timelineContentId: input.timelineContentId,
    expectedContentRevision: input.expectedContentRevision,
    blockKey: input.blockKey,
    attachmentId: input.attachmentId,
    expectedAttachmentRevision: input.expectedAttachmentRevision
  };
}

function attachmentContentMutationFence(input: {
  tenantId: string;
  attachmentId: string;
  expectedAttachmentRevision: string;
  timelineContentId: string;
  expectedContentRevision: string;
  contentBlockKey: string;
}): string {
  const hash = createHash("sha256");
  hash.update("core:inbox-v2.attachment-content-mutation-fence@v1", "utf8");
  for (const part of [
    input.tenantId,
    input.attachmentId,
    input.expectedAttachmentRevision,
    input.timelineContentId,
    input.expectedContentRevision,
    input.contentBlockKey
  ]) {
    hash.update("\u0000", "utf8");
    hash.update(part, "utf8");
  }
  return hash.digest("hex");
}

function reservationResultMatches(
  result: Extract<
    InboxV2SourceAttachmentReservationResult,
    { kind: "reserved" | "already_reserved" }
  >,
  input: InboxV2SourceAttachmentReservationInput
): boolean {
  return (
    result.jobId === input.jobId &&
    result.fileId === input.file.id &&
    result.fileVersionId === input.reservation.fileVersionId &&
    result.objectVersionId === input.reservation.objectVersionId &&
    result.storageRootId === input.reservation.storageRootId &&
    result.storageKey === input.reservation.storageKey
  );
}

function failed(
  claim: InboxV2SourceProcessingRuntimeClaim,
  codeId: string,
  retryable: boolean
): Readonly<{
  kind: "failed";
  diagnostic: InboxV2SafeSourceDiagnostic;
}> {
  return Object.freeze({
    kind: "failed" as const,
    diagnostic: inboxV2SafeSourceDiagnosticSchema.parse({
      codeId,
      retryable,
      correlationToken: claim.attempt.attemptId,
      safeOperatorHintId: "core:inspect-source-runtime"
    })
  });
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}
