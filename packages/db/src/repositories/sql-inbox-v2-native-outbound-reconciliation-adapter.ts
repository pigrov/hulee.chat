import {
  inboxV2ConversationParticipantSchema,
  inboxV2ExternalMessageReferenceSchema,
  inboxV2MessageCreationCommitSchema,
  inboxV2MessageTransportAssociationCommitSchema,
  inboxV2SourceOccurrenceResolutionCommitSchema,
  inboxV2SourceOccurrenceSchema,
  type InboxV2ConversationParticipant,
  type InboxV2MessageCreationCommit,
  type InboxV2SourceOccurrenceResolutionCommit
} from "@hulee/contracts";

import type {
  InboxV2SourceMessageCanonicalResult,
  InboxV2SourceMessageReconciliationCallbackResult,
  InboxV2SourceMessageReconciliationCallbacks,
  InboxV2SourceMessageReconciliationConflictCode
} from "./sql-inbox-v2-source-message-reconciliation-repository";
import type { RawSqlExecutor } from "./sql-outbox-repository";

type CreateMessageInput = Parameters<
  InboxV2SourceMessageReconciliationCallbacks["createMessage"]
>[1];
type AttachOccurrenceInput = Parameters<
  InboxV2SourceMessageReconciliationCallbacks["attachOccurrence"]
>[1];
type InboxV2MessageTransportAssociationCommit = ReturnType<
  typeof inboxV2MessageTransportAssociationCommitSchema.parse
>;

const EFFECT_DISPOSITION_KEYS = Object.freeze([
  "countsAsCustomerInbound",
  "createsUnread",
  "createsWorkItem",
  "requiresProviderIo",
  "createsOutboundDispatch",
  "notificationEligible"
] as const);

/**
 * Native/provider-app outbound observations are source truth, not a new app
 * command or customer inbound. The transaction-local persistence boundary must
 * return this closed receipt after checking its durable effect closure.
 */
export type InboxV2NativeOutboundEffectDisposition = Readonly<{
  countsAsCustomerInbound: boolean;
  createsUnread: boolean;
  createsWorkItem: boolean;
  requiresProviderIo: boolean;
  createsOutboundDispatch: boolean;
  notificationEligible: boolean;
}>;

export const inboxV2NativeOutboundNoEffectDisposition: InboxV2NativeOutboundEffectDisposition =
  Object.freeze({
    countsAsCustomerInbound: false,
    createsUnread: false,
    createsWorkItem: false,
    requiresProviderIo: false,
    createsOutboundDispatch: false,
    notificationEligible: false
  });

export type InboxV2NativeOutboundCreationPersistenceProof = Readonly<{
  commit: InboxV2MessageCreationCommit;
  effectDisposition: InboxV2NativeOutboundEffectDisposition;
}>;

export type InboxV2NativeOutboundAssociationPersistenceProof = Readonly<{
  commit: InboxV2MessageTransportAssociationCommit;
  sourceResolutionCommit: InboxV2SourceOccurrenceResolutionCommit;
  authorParticipant: InboxV2ConversationParticipant;
  effectDisposition: InboxV2NativeOutboundEffectDisposition;
}>;

type NativeOutboundPersistenceResult<TProof> =
  | Readonly<{
      kind: "committed";
      result: InboxV2SourceMessageCanonicalResult;
      proof: TProof;
    }>
  | Readonly<{
      kind: "conflict";
      code: InboxV2SourceMessageReconciliationConflictCode;
    }>;

/**
 * Trusted, provider-neutral persistence port. Implementations run exclusively
 * on the supplied ambient transaction and must derive effectDisposition from
 * the durable closure written by the same transaction (never from adapter
 * input). Throwing after a partial write rolls the whole reconciliation back.
 */
export type InboxV2NativeOutboundCanonicalPersistence = Readonly<{
  createMessage(
    transaction: RawSqlExecutor,
    input: CreateMessageInput
  ): Promise<
    NativeOutboundPersistenceResult<InboxV2NativeOutboundCreationPersistenceProof>
  >;
  attachOccurrence(
    transaction: RawSqlExecutor,
    input: AttachOccurrenceInput
  ): Promise<
    NativeOutboundPersistenceResult<InboxV2NativeOutboundAssociationPersistenceProof>
  >;
}>;

export type InboxV2NativeOutboundCanonicalCallbacks = Pick<
  InboxV2SourceMessageReconciliationCallbacks,
  "createMessage" | "attachOccurrence"
>;

export class InboxV2NativeOutboundPersistenceInvariantError extends Error {
  readonly code = "inbox_v2.native_outbound_persistence_invariant" as const;

  constructor(message: string) {
    super(message);
    this.name = "InboxV2NativeOutboundPersistenceInvariantError";
  }
}

/**
 * Production SRC-006 canonical callback seam for provider-app/native outbound
 * Messages. Exact-key serialization and terminal replay stay owned by the SQL
 * reconciliation repository; this adapter proves source authorship and the
 * absence of app-command/customer-inbound side effects before acknowledging a
 * transaction-local persistence result.
 */
export function createInboxV2NativeOutboundCanonicalCallbacks(
  persistence: InboxV2NativeOutboundCanonicalPersistence
): InboxV2NativeOutboundCanonicalCallbacks {
  return Object.freeze({
    async createMessage(transaction, input) {
      assertNativeOutboundPlan(input.plan);
      const persisted = await persistence.createMessage(transaction, input);
      if (persisted.kind === "conflict") return persisted;
      verifyCreationProof(input, persisted.result, persisted.proof);
      return committed(persisted.result);
    },

    async attachOccurrence(transaction, input) {
      assertNativeOutboundPlan(input.plan);
      if (input.reason !== "exact_message_reuse") {
        throw invariant(
          "Native outbound occurrence attachment requires exact Message-key reuse."
        );
      }
      const persisted = await persistence.attachOccurrence(transaction, input);
      if (persisted.kind === "conflict") return persisted;
      verifyAssociationProof(input, persisted.result, persisted.proof);
      return committed(persisted.result);
    }
  });
}

function verifyCreationProof(
  input: CreateMessageInput,
  result: InboxV2SourceMessageCanonicalResult,
  proof: InboxV2NativeOutboundCreationPersistenceProof
): void {
  const parsed = inboxV2MessageCreationCommitSchema.safeParse(proof.commit);
  if (!parsed.success) {
    throw invariant(
      "Native outbound creation returned an invalid Message creation commit."
    );
  }
  const commit = parsed.data;
  const occurrence = commit.sourceOccurrence;
  const resolution = commit.sourceResolutionCommit;
  const reference = commit.externalMessageReference;
  const link = commit.originTransportLink;
  const actor = input.plan.sourceOccurrence.providerActor;

  if (
    occurrence === null ||
    resolution === null ||
    reference === null ||
    link === null ||
    actor?.kind !== "source_external_identity" ||
    commit.message.origin.kind !== "source_originated" ||
    commit.message.origin.direction !== "outbound" ||
    commit.message.origin.originOccurrence.id !==
      input.plan.sourceOccurrence.id ||
    commit.message.appActor !== null ||
    commit.message.automationCausation !== null ||
    commit.authorParticipant.subject.kind !== "source_external_identity" ||
    commit.authorParticipant.subject.sourceExternalIdentity.id !==
      actor.sourceExternalIdentity.id ||
    commit.authorParticipant.id !== commit.message.authorParticipant.id ||
    input.plan.intent.kind !== "message_create" ||
    commit.message.id !== input.plan.intent.candidateMessageId ||
    commit.message.timelineItem.id !==
      input.plan.intent.candidateTimelineItemId ||
    link.id !== input.plan.intent.candidateTransportLinkId ||
    link.role !== "native_outbound" ||
    commit.outboundRoute !== null ||
    commit.outboundBindingSnapshot !== null ||
    commit.outboundDispatch !== null ||
    commit.routeConsumption !== null ||
    resolution.resolver.kind !== "trusted_service" ||
    resolution.resolver.trustedServiceId !==
      input.plan.materializedByTrustedServiceId ||
    !sameValue(resolution.before, input.plan.sourceOccurrence) ||
    !sameValue(resolution.after, occurrence) ||
    !sameValue(reference, input.candidateExternalMessageReference) ||
    !sameValue(resolution.resolvedReference, reference) ||
    !sameCanonicalResult(result, reference, occurrence)
  ) {
    throw invariant(
      "Native outbound creation did not preserve the exact source author, occurrence, candidate identities or no-route boundary."
    );
  }

  assertNoForbiddenEffects(proof.effectDisposition);
}

function verifyAssociationProof(
  input: AttachOccurrenceInput,
  result: InboxV2SourceMessageCanonicalResult,
  proof: InboxV2NativeOutboundAssociationPersistenceProof
): void {
  const parsedCommit = inboxV2MessageTransportAssociationCommitSchema.safeParse(
    proof.commit
  );
  const parsedResolution =
    inboxV2SourceOccurrenceResolutionCommitSchema.safeParse(
      proof.sourceResolutionCommit
    );
  const parsedParticipant = inboxV2ConversationParticipantSchema.safeParse(
    proof.authorParticipant
  );
  if (
    !parsedCommit.success ||
    !parsedResolution.success ||
    !parsedParticipant.success
  ) {
    throw invariant(
      "Native outbound attachment returned an invalid transport, resolution or author proof."
    );
  }
  const commit = parsedCommit.data;
  const resolution = parsedResolution.data;
  const author = parsedParticipant.data;
  const occurrence = commit.sourceOccurrence;
  const actor = input.plan.sourceOccurrence.providerActor;

  if (
    actor?.kind !== "source_external_identity" ||
    input.plan.intent.kind !== "message_create" ||
    commit.message.origin.kind !== "source_originated" ||
    commit.message.origin.direction !== "outbound" ||
    commit.message.appActor !== null ||
    commit.message.automationCausation !== null ||
    commit.messageOriginProof.kind !== "source_originated" ||
    commit.messageOriginProof.originOccurrence.providerActor?.kind !==
      "source_external_identity" ||
    author.subject.kind !== "source_external_identity" ||
    author.id !== commit.message.authorParticipant.id ||
    author.conversation.id !== commit.message.conversation.id ||
    author.subject.sourceExternalIdentity.id !==
      actor.sourceExternalIdentity.id ||
    author.subject.sourceExternalIdentity.id !==
      commit.messageOriginProof.originOccurrence.providerActor
        .sourceExternalIdentity.id ||
    commit.link.id !== input.plan.intent.candidateTransportLinkId ||
    commit.link.role !== "native_outbound" ||
    commit.link.message.id !==
      input.targetExternalMessageReference.message.id ||
    commit.link.sourceOccurrence.id !== input.plan.sourceOccurrence.id ||
    !sameValue(
      commit.externalMessageReference,
      input.targetExternalMessageReference
    ) ||
    !sameValue(resolution.before, input.plan.sourceOccurrence) ||
    !sameValue(resolution.after, occurrence) ||
    !sameValue(
      resolution.resolvedReference,
      input.targetExternalMessageReference
    ) ||
    resolution.resolver.kind !== "trusted_service" ||
    resolution.resolver.trustedServiceId !==
      input.plan.materializedByTrustedServiceId ||
    !sameCanonicalResult(
      result,
      input.targetExternalMessageReference,
      occurrence
    )
  ) {
    throw invariant(
      "Native outbound attachment did not preserve the exact source author, occurrence, canonical Message or native transport link."
    );
  }

  assertNoForbiddenEffects(proof.effectDisposition);
}

function assertNativeOutboundPlan(
  plan: CreateMessageInput["plan"] | AttachOccurrenceInput["plan"]
): void {
  const actor = plan.sourceOccurrence.providerActor;
  if (
    plan.intent.kind !== "message_create" ||
    plan.intent.transportRole !== "native_outbound" ||
    plan.sourceOccurrence.direction !== "outbound" ||
    plan.sourceOccurrence.origin.kind === "provider_echo" ||
    plan.sourceOccurrence.origin.kind === "provider_response" ||
    actor?.kind !== "source_external_identity"
  ) {
    throw invariant(
      "Native outbound callbacks accept only ordinary outbound source occurrences with one source external identity actor."
    );
  }
}

function assertNoForbiddenEffects(
  disposition: InboxV2NativeOutboundEffectDisposition
): void {
  const record = disposition as unknown as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const expectedKeys = [...EFFECT_DISPOSITION_KEYS].sort();
  if (
    !sameValue(keys, expectedKeys) ||
    EFFECT_DISPOSITION_KEYS.some((key) => record[key] !== false)
  ) {
    throw invariant(
      "Native outbound import cannot count as customer inbound, mutate unread/work, enqueue provider I/O/outbound dispatch or become notification eligible."
    );
  }
}

function sameCanonicalResult(
  result: InboxV2SourceMessageCanonicalResult,
  expectedReference: InboxV2SourceMessageCanonicalResult["externalMessageReference"],
  expectedOccurrence: InboxV2SourceMessageCanonicalResult["sourceOccurrence"]
): boolean {
  const reference = inboxV2ExternalMessageReferenceSchema.safeParse(
    result.externalMessageReference
  );
  const occurrence = inboxV2SourceOccurrenceSchema.safeParse(
    result.sourceOccurrence
  );
  return (
    reference.success &&
    occurrence.success &&
    sameValue(reference.data, expectedReference) &&
    sameValue(occurrence.data, expectedOccurrence)
  );
}

function committed(
  result: InboxV2SourceMessageCanonicalResult
): InboxV2SourceMessageReconciliationCallbackResult<InboxV2SourceMessageCanonicalResult> {
  return { kind: "committed", result };
}

function invariant(
  message: string
): InboxV2NativeOutboundPersistenceInvariantError {
  return new InboxV2NativeOutboundPersistenceInvariantError(message);
}

function sameValue(left: unknown, right: unknown): boolean {
  return stableJson(left) === stableJson(right);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
