import {
  inboxV2OutboundDispatchRerouteCommitSchema,
  type InboxV2OutboundDispatchRerouteCommit,
  type InboxV2PayloadReference
} from "@hulee/contracts";

import type { RawSqlExecutor } from "./sql-outbox-repository";

const atomicSealExecutors = new WeakMap<object, RawSqlExecutor>();
const atomicSealReceipts = new WeakMap<
  object,
  Readonly<{
    token: object;
    manifest: InboxV2AtomicMaterializationSealManifest;
  }>
>();
const atomicSealReceiptTokens = new WeakSet<object>();
const atomicOutboundRouteProofs = new WeakMap<
  object,
  readonly InboxV2AtomicOutboundRouteProof[]
>();
const atomicOutboundRerouteProofs = new WeakMap<
  object,
  readonly InboxV2OutboundDispatchRerouteCommit[]
>();

declare const inboxV2AtomicMaterializationSealReceiptBrand: unique symbol;

/**
 * Opaque, one-shot proof that one repository completed its canonical seal for
 * an exact coordinator-owned atomic materialization. The brand is type-only;
 * runtime authority lives exclusively in this module's WeakMap.
 */
export type InboxV2AtomicMaterializationSealReceipt = Readonly<{
  [inboxV2AtomicMaterializationSealReceiptBrand]: true;
}>;

export type InboxV2AtomicMessageCreationSealManifest = Readonly<{
  kind: "message_creation";
  tenantId: string;
  messageId: string;
  messageRevision: string;
  conversationId: string;
  timelineSequence: string;
  audience: "internal_participants" | "conversation_external";
  stateSchemaId: string;
  stateSchemaVersion: string;
  stateHash: string;
  payloadReference: InboxV2PayloadReference;
  domainCommitReference: InboxV2PayloadReference;
  event: InboxV2AtomicStreamEventManifest;
  outboundDispatch: InboxV2AtomicOutboundDispatchSealManifest | null;
  outboundReroute: InboxV2AtomicOutboundRerouteSealManifest | null;
  sourceOccurrence: InboxV2AtomicSourceOccurrenceSealManifest | null;
}>;

export type InboxV2AtomicTimelineItemCreationSealManifest = Readonly<{
  kind: "timeline_item_creation";
  tenantId: string;
  timelineItemId: string;
  timelineItemRevision: string;
  conversationId: string;
  timelineSequence: string;
  subjectKind: "system_event";
  activityKind: "non_activity";
  audience: "workforce_metadata";
  stateSchemaId: string;
  stateSchemaVersion: string;
  stateHash: string;
  payloadReference: InboxV2PayloadReference;
  domainCommitReference: InboxV2PayloadReference;
  event: InboxV2AtomicStreamEventManifest;
}>;

export type InboxV2AtomicMaterializationSealManifest =
  | InboxV2AtomicMessageCreationSealManifest
  | InboxV2AtomicTimelineItemCreationSealManifest;

export type InboxV2AtomicStreamEventManifest = Readonly<{
  typeId: string;
  payloadSchemaId: string;
  payloadSchemaVersion: string;
  payloadReference: InboxV2PayloadReference;
  occurredAt: string;
  recordedAt: string;
}>;

export type InboxV2AtomicSourceOccurrenceSealManifest = Readonly<{
  sourceOccurrenceId: string;
  resultingRevision: string;
  audience: "policy_filtered";
  stateSchemaId: string;
  stateSchemaVersion: string;
  stateHash: string;
  payloadReference: InboxV2PayloadReference;
  domainCommitReference: InboxV2PayloadReference;
  event: InboxV2AtomicStreamEventManifest;
}>;

export type InboxV2AtomicOutboundDispatchSealManifest = Readonly<{
  dispatchId: string;
  resultingRevision: string;
  stateSchemaId: string;
  stateSchemaVersion: string;
  stateHash: string;
  payloadReference: InboxV2PayloadReference;
}>;

export type InboxV2AtomicOutboundRerouteSealManifest = Readonly<{
  originalRouteId: string;
  expectedOriginalDispatchRevision: string;
  originalDispatch: InboxV2AtomicOutboundDispatchSealManifest;
  originalOutboxIntentId: string;
  replacement: Readonly<{
    messageId: string;
    routeId: string;
    dispatchId: string;
    outboxIntentId: string;
  }>;
  reasonId: string;
  changedAt: string;
  domainCommitReference: InboxV2PayloadReference;
  event: InboxV2AtomicStreamEventManifest;
}>;

export type InboxV2AtomicOutboundRerouteExpectation = Readonly<{
  tenantId: string;
  originalRouteId: string;
  originalDispatchId: string;
  expectedOriginalDispatchRevision: string;
  replacementMessageId: string;
  replacementRouteId: string;
  replacementDispatchId: string;
  reasonId: string;
}>;

/**
 * One exact successful use of the authorized route seam. It is deliberately
 * token-bound and package-internal: a persisted/old OutboundRoute row is not
 * proof that this command resolved that route under its current decisions.
 */
export type InboxV2AtomicOutboundRouteProof = Readonly<{
  tenantId: string;
  routeId: string;
  conversationId: string;
  sourceAccountId: string;
  routePolicyId: string;
  routePolicyRevision: string;
  routeDigest: string;
}>;

/**
 * Package-internal bridge between the authorized coordinator and repositories
 * that issue opaque atomic seal capabilities. It is intentionally not exported
 * from `@hulee/db`; the executor is held only in this module-private WeakMap and
 * is therefore absent even from reflection over the public prepare context.
 */
export function registerInboxV2AtomicSealExecutor(
  context: object,
  executor: RawSqlExecutor
): void {
  if (atomicSealExecutors.has(context)) {
    throw new TypeError(
      "Inbox V2 atomic preparation already has a seal executor."
    );
  }
  atomicSealExecutors.set(context, executor);
}

export function requireInboxV2AtomicSealExecutor(
  context: object
): RawSqlExecutor {
  const executor = atomicSealExecutors.get(context);
  if (executor === undefined) {
    throw new TypeError(
      "Inbox V2 atomic preparation has no repository seal executor."
    );
  }
  return executor;
}

export function revokeInboxV2AtomicSealExecutor(context: object): void {
  atomicSealExecutors.delete(context);
}

/**
 * Package-internal issuer used only by canonical repository seal functions.
 * It is deliberately absent from the `@hulee/db` package-root exports.
 */
export function issueInboxV2AtomicMaterializationSealReceipt(
  atomicMaterializationToken: object,
  manifest: InboxV2AtomicMaterializationSealManifest
): InboxV2AtomicMaterializationSealReceipt {
  assertObjectCapability(
    atomicMaterializationToken,
    "Inbox V2 atomic materialization token"
  );
  const frozenManifest = recursivelyFrozenManifest(manifest);
  if (atomicSealReceiptTokens.has(atomicMaterializationToken)) {
    throw new TypeError(
      "Inbox V2 atomic materialization token already issued a canonical seal receipt."
    );
  }
  atomicSealReceiptTokens.add(atomicMaterializationToken);
  const receipt = Object.freeze({});
  atomicSealReceipts.set(
    receipt,
    Object.freeze({
      token: atomicMaterializationToken,
      manifest: frozenManifest
    })
  );
  return receipt as InboxV2AtomicMaterializationSealReceipt;
}

export function registerInboxV2AtomicOutboundRouteProof(
  atomicMaterializationToken: object,
  proof: InboxV2AtomicOutboundRouteProof
): void {
  assertObjectCapability(
    atomicMaterializationToken,
    "Inbox V2 atomic materialization token"
  );
  const frozenProof = recursivelyFrozenValue(proof);
  atomicOutboundRouteProofs.set(
    atomicMaterializationToken,
    Object.freeze([
      ...(atomicOutboundRouteProofs.get(atomicMaterializationToken) ?? []),
      frozenProof
    ])
  );
}

/**
 * Consumes the complete route-proof set once. External sends require exactly
 * one matching proof; source/internal Messages require none. Deleting before
 * validation also makes mismatch and duplicate-proof failures one-shot.
 */
export function consumeInboxV2AtomicOutboundRouteProof(
  atomicMaterializationToken: object,
  expected: InboxV2AtomicOutboundRouteProof | null
): void {
  assertObjectCapability(
    atomicMaterializationToken,
    "Inbox V2 atomic materialization token"
  );
  const proofs =
    atomicOutboundRouteProofs.get(atomicMaterializationToken) ?? [];
  atomicOutboundRouteProofs.delete(atomicMaterializationToken);
  if (expected === null) {
    if (proofs.length === 0) return;
    throw new TypeError(
      "Inbox V2 non-external Message materialization cannot consume an outbound route proof."
    );
  }
  if (
    proofs.length !== 1 ||
    !atomicOutboundRouteProofMatches(proofs[0], expected)
  ) {
    throw new TypeError(
      "Inbox V2 external Message materialization requires exactly one matching live outbound route proof."
    );
  }
}

export function revokeInboxV2AtomicOutboundRouteProofs(
  atomicMaterializationToken: object
): void {
  assertObjectCapability(
    atomicMaterializationToken,
    "Inbox V2 atomic materialization token"
  );
  atomicOutboundRouteProofs.delete(atomicMaterializationToken);
}

/**
 * Registers the exact pre-I/O cancellation and replacement set persisted by
 * the explicit-reroute transport seam. The proof is token-bound, one-shot and
 * intentionally package-internal.
 */
export function registerInboxV2AtomicOutboundRerouteProof(
  atomicMaterializationToken: object,
  commit: InboxV2OutboundDispatchRerouteCommit
): void {
  assertObjectCapability(
    atomicMaterializationToken,
    "Inbox V2 atomic materialization token"
  );
  const frozenCommit = recursivelyFrozenValue(
    inboxV2OutboundDispatchRerouteCommitSchema.parse(commit)
  );
  atomicOutboundRerouteProofs.set(
    atomicMaterializationToken,
    Object.freeze([
      ...(atomicOutboundRerouteProofs.get(atomicMaterializationToken) ?? []),
      frozenCommit
    ])
  );
}

/**
 * Consumes the complete reroute-proof set once. Normal Message sends require
 * none; an explicit reroute requires exactly one proof matching both the
 * immutable original fence and the complete replacement identity.
 */
export function consumeInboxV2AtomicOutboundRerouteProof(
  atomicMaterializationToken: object,
  expected: InboxV2AtomicOutboundRerouteExpectation | null
): InboxV2OutboundDispatchRerouteCommit | null {
  assertObjectCapability(
    atomicMaterializationToken,
    "Inbox V2 atomic materialization token"
  );
  const proofs =
    atomicOutboundRerouteProofs.get(atomicMaterializationToken) ?? [];
  atomicOutboundRerouteProofs.delete(atomicMaterializationToken);
  if (expected === null) {
    if (proofs.length === 0) return null;
    throw new TypeError(
      "Inbox V2 non-reroute Message materialization cannot consume an outbound reroute proof."
    );
  }
  const proof = proofs[0];
  if (
    proofs.length !== 1 ||
    proof === undefined ||
    !atomicOutboundRerouteProofMatches(proof, expected)
  ) {
    throw new TypeError(
      "Inbox V2 explicit-reroute Message materialization requires exactly one matching live outbound reroute proof."
    );
  }
  return proof;
}

export function revokeInboxV2AtomicOutboundRerouteProofs(
  atomicMaterializationToken: object
): void {
  assertObjectCapability(
    atomicMaterializationToken,
    "Inbox V2 atomic materialization token"
  );
  atomicOutboundRerouteProofs.delete(atomicMaterializationToken);
}

/**
 * Consumes an exact-token receipt once. Deleting the WeakMap entry before the
 * coordinator publishes its stream closure makes replay fail closed even when
 * a caller retains the otherwise-empty frozen object.
 */
export function consumeInboxV2AtomicMaterializationSealReceipt(
  receipt: InboxV2AtomicMaterializationSealReceipt,
  atomicMaterializationToken: object
): InboxV2AtomicMaterializationSealManifest {
  assertObjectCapability(
    atomicMaterializationToken,
    "Inbox V2 atomic materialization token"
  );
  const receiptObject = asReceiptObject(receipt);
  const issued = atomicSealReceipts.get(receiptObject);
  if (issued === undefined) {
    throw new TypeError(
      "Inbox V2 atomic materialization seal receipt was not issued or is no longer live."
    );
  }
  if (issued.token !== atomicMaterializationToken) {
    throw new TypeError(
      "Inbox V2 atomic materialization seal receipt belongs to a different atomic materialization."
    );
  }
  atomicSealReceipts.delete(receiptObject);
  return issued.manifest;
}

/**
 * Explicitly invalidates an unconsumed receipt on a repository-local failure.
 * Only the token that issued the receipt may revoke it.
 */
export function revokeInboxV2AtomicMaterializationSealReceipt(
  receipt: InboxV2AtomicMaterializationSealReceipt,
  atomicMaterializationToken: object
): void {
  assertObjectCapability(
    atomicMaterializationToken,
    "Inbox V2 atomic materialization token"
  );
  const receiptObject = asReceiptObject(receipt);
  const issued = atomicSealReceipts.get(receiptObject);
  if (issued === undefined) return;
  if (issued.token !== atomicMaterializationToken) {
    throw new TypeError(
      "Inbox V2 atomic materialization seal receipt belongs to a different atomic materialization."
    );
  }
  atomicSealReceipts.delete(receiptObject);
}

function recursivelyFrozenManifest(
  manifest: InboxV2AtomicMaterializationSealManifest
): InboxV2AtomicMaterializationSealManifest {
  if (
    typeof manifest !== "object" ||
    manifest === null ||
    (manifest.kind !== "message_creation" &&
      manifest.kind !== "timeline_item_creation")
  ) {
    throw new TypeError(
      "Inbox V2 atomic seal receipt requires a supported canonical creation manifest."
    );
  }
  return recursivelyFrozenValue(manifest);
}

function recursivelyFrozenValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return Object.freeze(
      value.map((item) => recursivelyFrozenValue(item))
    ) as T;
  }
  if (typeof value === "object" && value !== null) {
    return Object.freeze(
      Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          recursivelyFrozenValue(item)
        ])
      )
    ) as T;
  }
  return value;
}

function atomicOutboundRouteProofMatches(
  actual: InboxV2AtomicOutboundRouteProof | undefined,
  expected: InboxV2AtomicOutboundRouteProof
): boolean {
  return (
    actual !== undefined &&
    actual.tenantId === expected.tenantId &&
    actual.routeId === expected.routeId &&
    actual.conversationId === expected.conversationId &&
    actual.sourceAccountId === expected.sourceAccountId &&
    actual.routePolicyId === expected.routePolicyId &&
    actual.routePolicyRevision === expected.routePolicyRevision &&
    actual.routeDigest === expected.routeDigest
  );
}

function atomicOutboundRerouteProofMatches(
  actual: InboxV2OutboundDispatchRerouteCommit,
  expected: InboxV2AtomicOutboundRerouteExpectation
): boolean {
  return (
    actual.tenantId === expected.tenantId &&
    actual.original.dispatchBefore.route.tenantId === expected.tenantId &&
    String(actual.original.dispatchBefore.route.id) ===
      String(expected.originalRouteId) &&
    String(actual.original.dispatchBefore.id) ===
      String(expected.originalDispatchId) &&
    String(actual.original.dispatchBefore.revision) ===
      String(expected.expectedOriginalDispatchRevision) &&
    actual.replacement.message.tenantId === expected.tenantId &&
    String(actual.replacement.message.id) ===
      String(expected.replacementMessageId) &&
    actual.replacement.route.tenantId === expected.tenantId &&
    String(actual.replacement.route.id) ===
      String(expected.replacementRouteId) &&
    actual.replacement.dispatch.tenantId === expected.tenantId &&
    String(actual.replacement.dispatch.id) ===
      String(expected.replacementDispatchId) &&
    String(actual.reasonId) === String(expected.reasonId)
  );
}

function asReceiptObject(
  receipt: InboxV2AtomicMaterializationSealReceipt
): object {
  assertObjectCapability(
    receipt,
    "Inbox V2 atomic materialization seal receipt"
  );
  return receipt;
}

function assertObjectCapability(
  value: unknown,
  label: string
): asserts value is object {
  if (
    (typeof value !== "object" && typeof value !== "function") ||
    value === null
  ) {
    throw new TypeError(`${label} must be an opaque object capability.`);
  }
}
