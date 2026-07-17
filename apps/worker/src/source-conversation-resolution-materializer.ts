import {
  INBOX_V2_SOURCE_CONVERSATION_CAPABILITY_ENTRY_MAX,
  canonicalizeInboxV2Json,
  inboxV2ConversationIdSchema,
  inboxV2ConversationPurposeIdSchema,
  inboxV2ExternalThreadIdSchema,
  inboxV2OpaqueAdapterRouteDescriptorSchema,
  inboxV2RoutingTokenSchema,
  inboxV2RoutingTrustedServiceIdSchema,
  inboxV2SourceConversationInitialHistorySyncStateSchema,
  inboxV2SourceConversationMaterializationPlanSchema,
  inboxV2SourceConversationResolutionSourceProjectionSchema,
  inboxV2SourceConversationTopologySchema,
  inboxV2SourceThreadBindingIdSchema,
  inboxV2SourceThreadBindingCapabilityEntrySchema,
  inboxV2SourceThreadBindingRemoteAccessEpisodeIdSchema,
  inboxV2TimestampSchema,
  type InboxV2SourceConversationMaterializationPlan,
  type InboxV2SourceConversationResolutionSourceProjection
} from "@hulee/contracts";
import { computeInboxV2SourceThreadBindingRouteDescriptorDigest } from "@hulee/db";

const MATERIALIZER_OPTION_KEYS = new Set([
  "trustedServiceId",
  "namespaceDeriver",
  "threadPlanResolver",
  "clock"
]);
const THREAD_PLAN_KEYS = new Set([
  "topology",
  "purposeId",
  "routeDescriptor",
  "capabilityEntries",
  "historySyncState"
]);
const trustedMaterializers = new WeakSet<object>();

export type InboxV2SourceConversationNamespacePurpose =
  | "conversation_id"
  | "external_thread_id"
  | "source_thread_binding_id"
  | "remote_access_episode_id"
  | "materialization_authorization";

export type InboxV2SourceConversationNamespaceDeriver = Readonly<{
  /**
   * Long-lived tenant namespace generation. Rotating only the wrapping key
   * must preserve both this generation and the underlying namespace secret.
   */
  namespaceGeneration: string;
  deriveNamespaceHmacSha256(input: {
    tenantId: string;
    trustedServiceId: string;
    namespaceGeneration: string;
    purpose: InboxV2SourceConversationNamespacePurpose;
    canonicalPreimage: string;
  }): string;
}>;

export type InboxV2SourceConversationThreadPlan = Readonly<
  Pick<
    InboxV2SourceConversationMaterializationPlan,
    | "topology"
    | "purposeId"
    | "routeDescriptor"
    | "capabilityEntries"
    | "historySyncState"
  >
>;

/**
 * Adapter-owned pure projection resolver. Its closed input deliberately has no
 * sender, identity observations, Client, title, participant or caller-selected
 * Conversation. It must perform no provider/network I/O.
 */
export type InboxV2SourceConversationThreadPlanResolver = Readonly<{
  resolve(
    source: InboxV2SourceConversationResolutionSourceProjection
  ): InboxV2SourceConversationThreadPlan;
}>;

export type InboxV2SourceConversationMaterializationClock = Readonly<{
  now(): string;
}>;

export type InboxV2TrustedSourceConversationResolutionMaterializer = Readonly<{
  materialize(
    source: InboxV2SourceConversationResolutionSourceProjection
  ): InboxV2SourceConversationMaterializationPlan;
}>;

export type InboxV2SourceConversationMaterializationAuthorizationInput =
  Readonly<
    Omit<InboxV2SourceConversationMaterializationPlan, "materializationToken">
  >;

export type InboxV2SourceConversationResolutionMaterializerErrorCode =
  | "source.conversation_resolution.source_projection_invalid"
  | "source.conversation_resolution.materializer_service_mismatch"
  | "source.conversation_resolution.adapter_surface_mismatch"
  | "source.conversation_resolution.route_descriptor_digest_invalid"
  | "source.conversation_resolution.thread_plan_invalid"
  | "source.conversation_resolution.namespace_derivation_invalid"
  | "source.conversation_resolution.materialization_clock_invalid"
  | "source.conversation_resolution.materialization_plan_invalid";

export class InboxV2SourceConversationResolutionMaterializerError extends Error {
  readonly code: InboxV2SourceConversationResolutionMaterializerErrorCode;
  readonly retryable = false;

  constructor(
    code: InboxV2SourceConversationResolutionMaterializerErrorCode,
    options: { cause?: unknown } = {}
  ) {
    super(
      code,
      options.cause === undefined ? undefined : { cause: options.cause }
    );
    this.name = "InboxV2SourceConversationResolutionMaterializerError";
    this.code = code;
  }
}

/**
 * Creates a server-owned planning capability. This slice derives candidates
 * only; the DB coordinator remains the sole owner of locks, writes, retries and
 * tenant stream publication.
 */
export function createInboxV2TrustedSourceConversationResolutionMaterializer(input: {
  trustedServiceId: string;
  namespaceDeriver: InboxV2SourceConversationNamespaceDeriver;
  threadPlanResolver: InboxV2SourceConversationThreadPlanResolver;
  clock: InboxV2SourceConversationMaterializationClock;
}): InboxV2TrustedSourceConversationResolutionMaterializer {
  assertExactOptions(input);
  const trustedServiceId = inboxV2RoutingTrustedServiceIdSchema.parse(
    input.trustedServiceId
  );
  const namespaceGeneration = inboxV2RoutingTokenSchema.parse(
    input.namespaceDeriver.namespaceGeneration
  );
  if (
    typeof input.namespaceDeriver.deriveNamespaceHmacSha256 !== "function" ||
    typeof input.threadPlanResolver.resolve !== "function" ||
    typeof input.clock.now !== "function"
  ) {
    throw new TypeError(
      "Conversation materializer requires a namespace deriver and thread plan resolver."
    );
  }

  const materializer: InboxV2TrustedSourceConversationResolutionMaterializer =
    Object.freeze({
      materialize(untrustedSource) {
        const source = parseSourceProjection(untrustedSource);
        if (
          String(source.adapterContract.loadedByTrustedServiceId) !==
          String(trustedServiceId)
        ) {
          throw materializerError(
            "source.conversation_resolution.materializer_service_mismatch"
          );
        }

        const resolverSource = deepFreeze(source);
        const threadPlan = resolveThreadPlan(
          input.threadPlanResolver,
          resolverSource
        );
        if (
          !sameAdapterSurface(
            threadPlan.routeDescriptor.adapterContract,
            source.adapterContract
          )
        ) {
          throw materializerError(
            "source.conversation_resolution.adapter_surface_mismatch"
          );
        }
        if (
          String(
            threadPlan.routeDescriptor.adapterContract.loadedByTrustedServiceId
          ) !== String(trustedServiceId)
        ) {
          throw materializerError(
            "source.conversation_resolution.materializer_service_mismatch"
          );
        }
        if (
          computeInboxV2SourceThreadBindingRouteDescriptorDigest(
            threadPlan.routeDescriptor
          ) !== threadPlan.routeDescriptor.descriptorDigestSha256
        ) {
          throw materializerError(
            "source.conversation_resolution.route_descriptor_digest_invalid"
          );
        }

        const threadIdentity = {
          threadKey: source.thread.key
        } as const;
        const conversationDigest = deriveTenantDigest(input.namespaceDeriver, {
          tenantId: source.tenantId,
          trustedServiceId,
          namespaceGeneration,
          purpose: "conversation_id",
          canonicalPreimage: canonicalizeInboxV2Json({
            domain: "core:inbox-v2.source-conversation-id",
            version: "v1",
            tenantId: source.tenantId,
            trustedServiceId,
            namespaceGeneration,
            ...threadIdentity
          })
        });
        const externalThreadDigest = deriveTenantDigest(
          input.namespaceDeriver,
          {
            tenantId: source.tenantId,
            trustedServiceId,
            namespaceGeneration,
            purpose: "external_thread_id",
            canonicalPreimage: canonicalizeInboxV2Json({
              domain: "core:inbox-v2.external-thread-id",
              version: "v1",
              tenantId: source.tenantId,
              trustedServiceId,
              namespaceGeneration,
              ...threadIdentity
            })
          }
        );
        const bindingIdentity = {
          ...threadIdentity,
          sourceAccount: source.sourceAccount
        } as const;
        const sourceThreadBindingDigest = deriveTenantDigest(
          input.namespaceDeriver,
          {
            tenantId: source.tenantId,
            trustedServiceId,
            namespaceGeneration,
            purpose: "source_thread_binding_id",
            canonicalPreimage: canonicalizeInboxV2Json({
              domain: "core:inbox-v2.source-thread-binding-id",
              version: "v1",
              tenantId: source.tenantId,
              trustedServiceId,
              namespaceGeneration,
              ...bindingIdentity
            })
          }
        );
        const remoteAccessEpisodeDigest = deriveTenantDigest(
          input.namespaceDeriver,
          {
            tenantId: source.tenantId,
            trustedServiceId,
            namespaceGeneration,
            purpose: "remote_access_episode_id",
            canonicalPreimage: canonicalizeInboxV2Json({
              domain:
                "core:inbox-v2.source-thread-binding-initial-remote-access-episode-id",
              version: "v1",
              tenantId: source.tenantId,
              trustedServiceId,
              namespaceGeneration,
              ...bindingIdentity,
              episodeKind: "initial_remote_access_episode_v1"
            })
          }
        );
        const candidateIds = {
          candidateConversationId: inboxV2ConversationIdSchema.parse(
            `conversation:${conversationDigest}`
          ),
          candidateExternalThreadId: inboxV2ExternalThreadIdSchema.parse(
            `external_thread:${externalThreadDigest}`
          ),
          candidateSourceThreadBindingId:
            inboxV2SourceThreadBindingIdSchema.parse(
              `source_thread_binding:${sourceThreadBindingDigest}`
            ),
          candidateRemoteAccessEpisodeId:
            inboxV2SourceThreadBindingRemoteAccessEpisodeIdSchema.parse(
              `source_thread_binding_remote_access_episode:${remoteAccessEpisodeDigest}`
            )
        } as const;
        const materializedAt = readMaterializationTime(input.clock);
        if (Date.parse(materializedAt) < Date.parse(source.recordedAt)) {
          throw materializerError(
            "source.conversation_resolution.materialization_clock_invalid"
          );
        }
        const unsignedPlan = {
          source,
          topology: threadPlan.topology,
          purposeId: threadPlan.purposeId,
          routeDescriptor: threadPlan.routeDescriptor,
          ...candidateIds,
          capabilityEntries: threadPlan.capabilityEntries,
          historySyncState: threadPlan.historySyncState,
          namespaceGeneration,
          materializedByTrustedServiceId: trustedServiceId,
          materializedAt
        } satisfies InboxV2SourceConversationMaterializationAuthorizationInput;
        const authorizationDigest =
          deriveInboxV2SourceConversationMaterializationAuthorizationDigest(
            input.namespaceDeriver,
            unsignedPlan
          );

        try {
          return deepFreeze(
            inboxV2SourceConversationMaterializationPlanSchema.parse({
              ...unsignedPlan,
              materializationToken: `source-conversation-materialization:${namespaceGeneration}:${authorizationDigest}`
            })
          );
        } catch (cause) {
          throw materializerError(
            "source.conversation_resolution.materialization_plan_invalid",
            cause
          );
        }
      }
    });

  trustedMaterializers.add(materializer);
  return materializer;
}

function readMaterializationTime(
  clock: InboxV2SourceConversationMaterializationClock
): string {
  try {
    return inboxV2TimestampSchema.parse(clock.now());
  } catch (cause) {
    throw materializerError(
      "source.conversation_resolution.materialization_clock_invalid",
      cause
    );
  }
}

export function isInboxV2TrustedSourceConversationResolutionMaterializer(
  value: unknown
): value is InboxV2TrustedSourceConversationResolutionMaterializer {
  return (
    typeof value === "object" &&
    value !== null &&
    trustedMaterializers.has(value)
  );
}

function resolveThreadPlan(
  resolver: InboxV2SourceConversationThreadPlanResolver,
  source: InboxV2SourceConversationResolutionSourceProjection
): InboxV2SourceConversationThreadPlan {
  try {
    return deepFreeze(parseThreadPlan(resolver.resolve(source)));
  } catch (cause) {
    if (cause instanceof InboxV2SourceConversationResolutionMaterializerError) {
      throw cause;
    }
    throw materializerError(
      "source.conversation_resolution.thread_plan_invalid",
      cause
    );
  }
}

/**
 * Canonical authorization preimage shared by the trusted materializer and its
 * consumer-side verifier. Keeping this projection in one pure builder prevents
 * the two boundaries from silently authenticating different plan fields.
 */
export function buildInboxV2SourceConversationMaterializationAuthorizationPreimage(
  input: InboxV2SourceConversationMaterializationAuthorizationInput
): string {
  return canonicalizeInboxV2Json({
    domain: "core:inbox-v2.source-conversation-materialization-authorization",
    version: "v1",
    tenantId: input.source.tenantId,
    trustedServiceId: input.materializedByTrustedServiceId,
    namespaceGeneration: input.namespaceGeneration,
    rawInboundEvent: input.source.rawInboundEvent,
    normalizedInboundEvent: input.source.normalizedInboundEvent,
    safeEnvelopeHmacSha256: input.source.safeEnvelopeHmacSha256,
    sourceConnection: input.source.sourceConnection,
    sourceAccount: input.source.sourceAccount,
    threadKey: input.source.thread.key,
    topology: input.topology,
    purposeId: input.purposeId,
    routeDescriptor: input.routeDescriptor,
    capabilityEntries: input.capabilityEntries,
    historySyncState: input.historySyncState,
    candidateIds: {
      candidateConversationId: input.candidateConversationId,
      candidateExternalThreadId: input.candidateExternalThreadId,
      candidateSourceThreadBindingId: input.candidateSourceThreadBindingId,
      candidateRemoteAccessEpisodeId: input.candidateRemoteAccessEpisodeId
    },
    materializedAt: input.materializedAt
  });
}

export function deriveInboxV2SourceConversationMaterializationAuthorizationDigest(
  deriver: InboxV2SourceConversationNamespaceDeriver,
  input: InboxV2SourceConversationMaterializationAuthorizationInput
): string {
  return deriveTenantDigest(deriver, {
    tenantId: input.source.tenantId,
    trustedServiceId: input.materializedByTrustedServiceId,
    namespaceGeneration: input.namespaceGeneration,
    purpose: "materialization_authorization",
    canonicalPreimage:
      buildInboxV2SourceConversationMaterializationAuthorizationPreimage(input)
  });
}

function parseSourceProjection(
  source: InboxV2SourceConversationResolutionSourceProjection
): InboxV2SourceConversationResolutionSourceProjection {
  try {
    return inboxV2SourceConversationResolutionSourceProjectionSchema.parse(
      source
    );
  } catch (cause) {
    throw materializerError(
      "source.conversation_resolution.source_projection_invalid",
      cause
    );
  }
}

function parseThreadPlan(input: unknown): InboxV2SourceConversationThreadPlan {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new TypeError("Thread plan must be a closed object.");
  }
  for (const key of Object.keys(input)) {
    if (!THREAD_PLAN_KEYS.has(key)) {
      throw new TypeError(`Unknown thread plan field: ${key}`);
    }
  }
  for (const key of THREAD_PLAN_KEYS) {
    if (!Object.hasOwn(input, key)) {
      throw new TypeError(`Missing thread plan field: ${key}`);
    }
  }
  const candidate = input as Record<string, unknown>;
  if (!Array.isArray(candidate.capabilityEntries)) {
    throw new TypeError("Thread plan capabilityEntries must be an array.");
  }
  if (
    candidate.capabilityEntries.length >
    INBOX_V2_SOURCE_CONVERSATION_CAPABILITY_ENTRY_MAX
  ) {
    throw new TypeError("Thread plan contains too many capability entries.");
  }
  return {
    topology: inboxV2SourceConversationTopologySchema.parse(candidate.topology),
    purposeId: inboxV2ConversationPurposeIdSchema.parse(candidate.purposeId),
    routeDescriptor: inboxV2OpaqueAdapterRouteDescriptorSchema.parse(
      candidate.routeDescriptor
    ),
    capabilityEntries: candidate.capabilityEntries.map((entry) =>
      inboxV2SourceThreadBindingCapabilityEntrySchema.parse(entry)
    ),
    historySyncState:
      inboxV2SourceConversationInitialHistorySyncStateSchema.parse(
        candidate.historySyncState
      )
  };
}

function deriveTenantDigest(
  deriver: InboxV2SourceConversationNamespaceDeriver,
  input: Parameters<
    InboxV2SourceConversationNamespaceDeriver["deriveNamespaceHmacSha256"]
  >[0]
): string {
  let digest: string;
  try {
    digest = deriver.deriveNamespaceHmacSha256(input);
  } catch (cause) {
    throw materializerError(
      "source.conversation_resolution.namespace_derivation_invalid",
      cause
    );
  }
  if (!/^[a-f0-9]{64}$/u.test(digest)) {
    throw materializerError(
      "source.conversation_resolution.namespace_derivation_invalid"
    );
  }
  return digest;
}

function sameAdapterSurface(
  left: Readonly<{
    contractId: unknown;
    contractVersion: string;
    surfaceId: unknown;
  }>,
  right: Readonly<{
    contractId: unknown;
    contractVersion: string;
    surfaceId: unknown;
  }>
): boolean {
  return (
    String(left.contractId) === String(right.contractId) &&
    left.contractVersion === right.contractVersion &&
    String(left.surfaceId) === String(right.surfaceId)
  );
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

function assertExactOptions(input: object): void {
  for (const key of Object.keys(input)) {
    if (!MATERIALIZER_OPTION_KEYS.has(key)) {
      throw new TypeError(
        `Unknown source conversation materializer option: ${key}`
      );
    }
  }
}

function materializerError(
  code: InboxV2SourceConversationResolutionMaterializerErrorCode,
  cause?: unknown
): InboxV2SourceConversationResolutionMaterializerError {
  return new InboxV2SourceConversationResolutionMaterializerError(code, {
    cause
  });
}
