import { createHmac, randomBytes } from "node:crypto";

import {
  INBOX_V2_SECURITY_DENIAL_POLICY,
  inboxV2SecurityDenialActionSchema,
  inboxV2SecurityDenialAttemptSchema,
  inboxV2SecurityDenialFingerprintKeyEpochSchema,
  inboxV2SecurityDenialPrincipalClassSchema,
  inboxV2SecurityDenialResultMatchesAttempt,
  inboxV2SecurityDenialResultSchema,
  inboxV2TenantIdSchema,
  type InboxV2SecurityDenialAction,
  type InboxV2SecurityDenialAttempt,
  type InboxV2SecurityDenialKind,
  type InboxV2SecurityDenialPublicErrorClass,
  type InboxV2SecurityDenialResult,
  type InboxV2SecurityDenialReviewType,
  type InboxV2SecurityDenialRisk,
  type InboxV2InternalOpaqueReference,
  type InboxV2TenantId
} from "@hulee/contracts";

import {
  evaluateInboxV2AuthorizationPlan,
  toInboxV2PublicAuthorizationDecision,
  type InboxV2AuthorizationDecision,
  type InboxV2AuthorizationInternalReason,
  type InboxV2AuthorizationPlanInput,
  type InboxV2AuthorizationPublicErrorCode,
  type InboxV2PublicAuthorizationDecision
} from "./inbox-v2-authorization-policy";

export type InboxV2DeniedAuthorizationDecision = Extract<
  InboxV2AuthorizationDecision,
  { readonly outcome: "denied" }
>;

export type InboxV2SecurityDenialContext = Readonly<{
  principalClass:
    | "employee"
    | "trusted_service"
    | "platform_support"
    | "invalid_or_anonymous";
  tenantScope: InboxV2SecurityDenialTenantScope;
  fingerprints: InboxV2SecurityDenialFingerprintProof;
  reviewCandidateRef?: InboxV2InternalOpaqueReference | null;
}>;

const securityTenantScopeProof = Symbol("inbox-v2-security-tenant-scope");
const securityFingerprintProof = Symbol("inbox-v2-security-fingerprint");
const denialDedupeDerivationKeys = new WeakMap<object, Uint8Array>();

export type InboxV2SecurityDenialTenantScope = Readonly<
  (
    | { kind: "verified_tenant"; tenantId: InboxV2TenantId }
    | { kind: "deployment_bucket"; tenantId: InboxV2TenantId }
  ) & { [securityTenantScopeProof]: true }
>;

export type InboxV2SecurityDenialFingerprintProof = Readonly<{
  tenantId: InboxV2TenantId;
  action: InboxV2SecurityDenialAction;
  principalClass: InboxV2SecurityDenialContext["principalClass"];
  fingerprintKeyEpoch: string;
  actorFingerprint: string;
  [securityFingerprintProof]: true;
}>;

export type InboxV2SecurityDenialRecordOptions = Readonly<{
  signal: AbortSignal;
}>;

export type InboxV2SecurityDenialSink = Readonly<{
  record(
    attempt: InboxV2SecurityDenialAttempt,
    options: InboxV2SecurityDenialRecordOptions
  ): Promise<InboxV2SecurityDenialResult>;
}>;

export type InboxV2SecurityDenialHealthSignal = Readonly<{
  kind: "security_denial_sink_unavailable";
  tenantId: InboxV2DeniedAuthorizationDecision["tenantId"];
  action: InboxV2SecurityDenialAction;
  failureClass:
    | "invalid_attempt"
    | "invalid_result"
    | "sink_rejected"
    | "sink_timeout"
    | "sink_overloaded"
    | "circuit_open";
}>;

export type InboxV2SecurityDenialObservation =
  | Readonly<{
      outcome: "recorded";
      result: InboxV2SecurityDenialResult;
    }>
  | Readonly<{
      outcome: "sink_unavailable";
      failureClass: InboxV2SecurityDenialHealthSignal["failureClass"];
    }>;

export type InboxV2AuthorizationGateResult<TResult> =
  | Readonly<{
      outcome: "allowed";
      publicDecision: Extract<
        InboxV2PublicAuthorizationDecision,
        { readonly outcome: "allowed" }
      >;
      value: TResult;
    }>
  | Readonly<{
      outcome: "denied";
      publicDecision: Extract<
        InboxV2PublicAuthorizationDecision,
        { readonly outcome: "denied" }
      >;
    }>;

/**
 * Constructed only after the request tenant was resolved by authentication or
 * deployment routing. Cross-tenant probes are attributed to this verified
 * actor tenant, never to the caller-selected target tenant.
 */
export function createInboxV2VerifiedSecurityTenantScope(
  tenantIdInput: string
): InboxV2SecurityDenialTenantScope {
  return Object.freeze({
    kind: "verified_tenant" as const,
    tenantId: inboxV2TenantIdSchema.parse(tenantIdInput),
    [securityTenantScopeProof]: true as const
  });
}

const deploymentBucketIdPattern = /^[a-z0-9][a-z0-9-]{0,63}$/u;

/**
 * Anonymous traffic uses a reserved deployment bucket, never a caller/target
 * tenant ID. The deployment ID comes from bootstrap configuration and cannot
 * be shaped into the ordinary customer-tenant namespace. Bootstrap must
 * pre-provision the resulting reserved tenant row before serving traffic.
 */
export function createInboxV2DeploymentSecurityTenantScope(
  deploymentId: string
): InboxV2SecurityDenialTenantScope {
  if (!deploymentBucketIdPattern.test(deploymentId)) {
    throw new TypeError(
      "Security-denial deployment ID must be a lowercase bootstrap identifier."
    );
  }
  return Object.freeze({
    kind: "deployment_bucket" as const,
    tenantId: inboxV2TenantIdSchema.parse(
      `tenant:system.security-denial.${deploymentId}`
    ),
    [securityTenantScopeProof]: true as const
  });
}

/**
 * Server-only fingerprint constructor. Raw stable keys exist only as HMAC
 * inputs; purpose and tenant framing makes actor/dedupe values non-reusable.
 */
export function createInboxV2SecurityDenialFingerprintProof(input: {
  tenantId: string;
  action: InboxV2SecurityDenialAction;
  principalClass: InboxV2SecurityDenialContext["principalClass"];
  fingerprintKeyEpoch: string;
  hmacKey: Uint8Array;
  actorStableKey: string;
  dedupeStableKey: string;
}): InboxV2SecurityDenialFingerprintProof {
  const tenantId = inboxV2TenantIdSchema.parse(input.tenantId);
  const action = inboxV2SecurityDenialActionSchema.parse(input.action);
  const principalClass = inboxV2SecurityDenialPrincipalClassSchema.parse(
    input.principalClass
  );
  const fingerprintKeyEpoch =
    inboxV2SecurityDenialFingerprintKeyEpochSchema.parse(
      input.fingerprintKeyEpoch
    );
  if (input.hmacKey.byteLength < 32) {
    throw new TypeError(
      "Security-denial HMAC key must contain at least 32 bytes."
    );
  }
  assertStableFingerprintInput(input.actorStableKey, "actor stable key");
  assertStableFingerprintInput(input.dedupeStableKey, "dedupe stable key");

  const actorFingerprint = denialHmac(input.hmacKey, [
    "inbox-v2-security-denial-v1",
    "actor",
    String(tenantId),
    fingerprintKeyEpoch,
    principalClass,
    input.actorStableKey
  ]);
  const dedupeDerivationKey = denialHmacDigest(input.hmacKey, [
    "inbox-v2-security-denial-v1",
    "attempt-dedupe-key",
    String(tenantId),
    fingerprintKeyEpoch,
    principalClass,
    actorFingerprint,
    action,
    input.dedupeStableKey
  ]);
  const proof = Object.freeze({
    tenantId,
    action,
    principalClass,
    fingerprintKeyEpoch,
    actorFingerprint,
    [securityFingerprintProof]: true as const
  });
  denialDedupeDerivationKeys.set(proof, dedupeDerivationKey);
  return proof;
}

export function planInboxV2SecurityDenial(input: {
  decision: InboxV2DeniedAuthorizationDecision;
  context: InboxV2SecurityDenialContext;
}): InboxV2SecurityDenialAttempt {
  const denialKind = classifyDenialKind(input.decision);
  assertTrustedDenialContext(input.decision, input.context);
  const action = input.decision.securityDenialAction;
  const publicErrorClass = classifyPublicError(input.decision.publicErrorCode);
  const reviewSignal = deriveReviewSignal(
    action,
    denialKind,
    input.context.reviewCandidateRef ?? null
  );

  const attempt = inboxV2SecurityDenialAttemptSchema.parse({
    observationReceipt: createSecurityDenialObservationReceipt(),
    tenantId: input.context.tenantScope.tenantId,
    action,
    principalClass: input.context.principalClass,
    fingerprintKeyEpoch: input.context.fingerprints.fingerprintKeyEpoch,
    actorFingerprint: input.context.fingerprints.actorFingerprint,
    dedupeFingerprint: deriveDenialDedupeFingerprint(
      input.context.fingerprints,
      denialKind,
      publicErrorClass
    ),
    denialKind,
    publicErrorClass,
    risk: deriveRisk(action, denialKind),
    reviewSignal,
    policy: INBOX_V2_SECURITY_DENIAL_POLICY
  });
  if (attempt.reviewSignal !== null) Object.freeze(attempt.reviewSignal);
  Object.freeze(attempt.policy);
  return Object.freeze(attempt);
}

/**
 * The public denial is fixed before this best-effort path runs. Sink errors,
 * timeouts and health-reporting failures cannot turn deny into allow or 500.
 */
export async function tryObserveInboxV2SecurityDenial(input: {
  decision: InboxV2DeniedAuthorizationDecision;
  context: InboxV2SecurityDenialContext;
  sink: InboxV2SecurityDenialSink;
  timeoutMilliseconds?: number;
  reportHealth?: (
    signal: InboxV2SecurityDenialHealthSignal
  ) => void | Promise<void>;
}): Promise<InboxV2SecurityDenialObservation> {
  let attempt: InboxV2SecurityDenialAttempt;
  try {
    attempt = planInboxV2SecurityDenial(input);
  } catch {
    reportHealthWithoutThrowing(input, "invalid_attempt");
    return Object.freeze({
      outcome: "sink_unavailable",
      failureClass: "invalid_attempt"
    });
  }

  const timeoutMilliseconds = normalizeObservationTimeout(
    input.timeoutMilliseconds
  );
  const state = denialSinkState();
  const now = Date.now();
  if (state.circuitOpenUntil > now) {
    reportHealthWithoutThrowing(input, "circuit_open");
    return Object.freeze({
      outcome: "sink_unavailable",
      failureClass: "circuit_open"
    });
  }
  if (
    state.inFlight >= INBOX_V2_SECURITY_DENIAL_POLICY.maxInFlightObservations
  ) {
    reportHealthWithoutThrowing(input, "sink_overloaded");
    return Object.freeze({
      outcome: "sink_unavailable",
      failureClass: "sink_overloaded"
    });
  }

  state.inFlight += 1;
  const abortController = new AbortController();
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  // Deferral turns a synchronous adapter throw into a normal rejection. The
  // in-flight slot is released only when the underlying call actually settles;
  // permanently hung adapters therefore consume a fixed maximum, not one task
  // per request.
  const sinkPromise = Promise.resolve().then(() =>
    input.sink.record(attempt, { signal: abortController.signal })
  );
  void sinkPromise.then(
    () => releaseDenialSinkSlot(state),
    () => releaseDenialSinkSlot(state)
  );
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(
      () => reject(new SecurityDenialSinkTimeoutError()),
      timeoutMilliseconds
    );
  });

  try {
    const rawResult = await Promise.race([sinkPromise, timeoutPromise]);
    const parsedResult = inboxV2SecurityDenialResultSchema.safeParse(rawResult);
    if (
      !parsedResult.success ||
      !inboxV2SecurityDenialResultMatchesAttempt(attempt, parsedResult.data)
    ) {
      markDenialSinkFailure(state);
      reportHealthWithoutThrowing(input, "invalid_result");
      return Object.freeze({
        outcome: "sink_unavailable",
        failureClass: "invalid_result"
      });
    }
    markDenialSinkSuccess(state);
    return Object.freeze({ outcome: "recorded", result: parsedResult.data });
  } catch (error) {
    const failureClass =
      error instanceof SecurityDenialSinkTimeoutError
        ? "sink_timeout"
        : "sink_rejected";
    if (failureClass === "sink_timeout") abortController.abort();
    markDenialSinkFailure(state);
    reportHealthWithoutThrowing(input, failureClass);
    return Object.freeze({ outcome: "sink_unavailable", failureClass });
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
  }
}

/**
 * Application boundary for future Inbox V2 commands/queries. Every command
 * claim, pagination/count, artifact operation and domain mutation belongs in
 * executeAllowed, so a denial reaches only the bounded denial sink.
 */
export async function executeInboxV2AuthorizationGate<TResult>(input: {
  /** Authorization facts only; the gate owns policy evaluation. */
  authorizationPlan: InboxV2AuthorizationPlanInput;
  /** Trusted action/fingerprint context is required before any DB work. */
  denialContext: InboxV2SecurityDenialContext;
  denialSink: InboxV2SecurityDenialSink;
  executeAllowed: () => Promise<TResult>;
  timeoutMilliseconds?: number;
  reportHealth?: (
    signal: InboxV2SecurityDenialHealthSignal
  ) => void | Promise<void>;
  /** Internal-only diagnostics; never becomes part of a public result. */
  onDenialObserved?: (
    observation: InboxV2SecurityDenialObservation
  ) => void | Promise<void>;
}): Promise<InboxV2AuthorizationGateResult<TResult>> {
  const decision = evaluateInboxV2AuthorizationPlan(input.authorizationPlan);
  const publicDecision = toInboxV2PublicAuthorizationDecision(decision);
  if (decision.outcome === "denied") {
    const observation = await tryObserveInboxV2SecurityDenial({
      decision,
      context: input.denialContext,
      sink: input.denialSink,
      timeoutMilliseconds: input.timeoutMilliseconds,
      reportHealth: input.reportHealth
    });
    notifyObservationWithoutThrowing(
      input.onDenialObserved,
      observation,
      decision,
      input.denialContext
    );
    return Object.freeze({
      outcome: "denied",
      publicDecision: publicDecision as Extract<
        InboxV2PublicAuthorizationDecision,
        { readonly outcome: "denied" }
      >
    });
  }

  return Object.freeze({
    outcome: "allowed",
    publicDecision: publicDecision as Extract<
      InboxV2PublicAuthorizationDecision,
      { readonly outcome: "allowed" }
    >,
    value: await input.executeAllowed()
  });
}

function classifyDenialKind(
  decision: InboxV2DeniedAuthorizationDecision
): InboxV2SecurityDenialKind {
  if (decision.publicErrorCode === "identity.claim_self_forbidden") {
    return "manual_self_claim";
  }
  const mapping: Partial<
    Record<InboxV2AuthorizationInternalReason, InboxV2SecurityDenialKind>
  > = {
    tenant_boundary_mismatch: "cross_tenant_probe",
    hidden_target: "unknown_or_hidden_resource",
    secondary_resource_denied: "unknown_or_hidden_resource",
    unknown_permission: "missing_permission",
    missing_permission: "missing_permission",
    scope_not_matched: "scope_mismatch",
    canonical_relation_not_matched: "scope_mismatch",
    structural_path_missing: "scope_mismatch",
    authorization_epoch_stale: "stale_authorization",
    revision_guard_failed: "stale_authorization",
    separation_of_duties_denied: "separation_of_duties",
    hard_boundary_denied: "hard_boundary",
    state_guard_failed: "state_guard"
  };
  return mapping[decision.diagnostics.reason] ?? "other_denied";
}

function classifyPublicError(
  errorCode: InboxV2AuthorizationPublicErrorCode
): InboxV2SecurityDenialPublicErrorClass {
  if (errorCode === "resource.not_found") return "not_found";
  if (errorCode === "permission.denied") return "permission_denied";
  if (errorCode === "auth.access_revision_stale") {
    return "authorization_stale";
  }
  if (errorCode === "identity.claim_self_forbidden") {
    return "identity_claim_self_forbidden";
  }
  if (errorCode.startsWith("privacy.")) return "privacy_denied";
  if (
    errorCode === "revision.conflict" ||
    errorCode === "work.state_changed" ||
    errorCode === "route.binding_changed"
  ) {
    return "state_conflict";
  }
  return "other_denied";
}

function deriveRisk(
  action: InboxV2SecurityDenialAction,
  denialKind: InboxV2SecurityDenialKind
): InboxV2SecurityDenialRisk {
  if (
    denialKind === "cross_tenant_probe" ||
    action === "privacy.deletion.execute"
  ) {
    return "critical";
  }
  if (
    denialKind === "manual_self_claim" ||
    denialKind === "unknown_or_hidden_resource" ||
    action === "authorization.privileged_mutation" ||
    action === "identity.claim" ||
    action.startsWith("privacy.")
  ) {
    return "high";
  }
  return denialKind === "state_guard" || denialKind === "other_denied"
    ? "low"
    : "medium";
}

function deriveReviewSignal(
  action: InboxV2SecurityDenialAction,
  denialKind: InboxV2SecurityDenialKind,
  candidateRef: InboxV2InternalOpaqueReference | null
): InboxV2SecurityDenialAttempt["reviewSignal"] {
  if (denialKind === "manual_self_claim") {
    return {
      reviewType: "manual_self_claim",
      alertType: "identity_claim_review",
      candidateRef
    };
  }
  const reviewTypeByAction: Partial<
    Record<InboxV2SecurityDenialAction, InboxV2SecurityDenialReviewType>
  > = {
    "privacy.hold.issue": "privacy_hold_issue_denied",
    "privacy.hold.release": "privacy_hold_release_denied",
    "privacy.subject_evidence.view": "privacy_evidence_access_denied",
    "privacy.tenant_export": "tenant_export_denied",
    "privacy.deletion.preview": "destructive_preview_denied",
    "privacy.deletion.approve": "destructive_approval_denied",
    "privacy.deletion.execute": "destructive_execution_denied"
  };
  const reviewType = reviewTypeByAction[action];
  if (reviewType !== undefined) {
    return {
      reviewType,
      alertType: "privacy_control_review",
      // A standalone persisted privacy-denial row cannot prove later viewer
      // authority over the target. Keep it navigationally opaque.
      candidateRef: null
    };
  }
  if (denialKind === "cross_tenant_probe") {
    return {
      reviewType: "cross_tenant_probe",
      alertType: "security_probe_review",
      candidateRef: null
    };
  }
  if (denialKind === "unknown_or_hidden_resource") {
    return {
      reviewType: "guessed_identifier_probe",
      alertType: "security_probe_review",
      candidateRef: null
    };
  }
  return null;
}

function normalizeObservationTimeout(value: number | undefined): number {
  if (value === undefined) return 750;
  if (!Number.isInteger(value) || value < 10 || value > 5_000) return 750;
  return value;
}

function reportHealthWithoutThrowing(
  input: {
    decision: InboxV2DeniedAuthorizationDecision;
    context: InboxV2SecurityDenialContext;
    reportHealth?: (
      signal: InboxV2SecurityDenialHealthSignal
    ) => void | Promise<void>;
  },
  failureClass: InboxV2SecurityDenialHealthSignal["failureClass"]
): void {
  if (input.reportHealth === undefined) return;
  const signal: InboxV2SecurityDenialHealthSignal = {
    kind: "security_denial_sink_unavailable",
    tenantId: input.context.tenantScope.tenantId,
    action: input.decision.securityDenialAction,
    failureClass
  };
  notifyBoundedTelemetry(
    `health:${signal.tenantId}:${signal.action}:${signal.failureClass}`,
    input.reportHealth,
    signal
  );
}

function assertTrustedDenialContext(
  decision: InboxV2DeniedAuthorizationDecision,
  context: InboxV2SecurityDenialContext
): void {
  if (
    context.tenantScope[securityTenantScopeProof] !== true ||
    context.fingerprints[securityFingerprintProof] !== true ||
    !denialDedupeDerivationKeys.has(context.fingerprints) ||
    context.fingerprints.tenantId !== context.tenantScope.tenantId ||
    context.fingerprints.action !== decision.securityDenialAction ||
    context.fingerprints.principalClass !== context.principalClass ||
    context.principalClass !== decision.securityDenialPrincipalClass
  ) {
    throw new TypeError("Unbound security-denial context.");
  }
  if (decision.securityDenialTenantId === null) {
    if (
      context.principalClass !== "invalid_or_anonymous" ||
      context.tenantScope.kind !== "deployment_bucket"
    ) {
      throw new TypeError("Anonymous denial requires a deployment bucket.");
    }
    return;
  }
  if (
    context.principalClass === "invalid_or_anonymous" ||
    context.tenantScope.kind !== "verified_tenant" ||
    context.tenantScope.tenantId !== decision.securityDenialTenantId
  ) {
    throw new TypeError("Security-denial tenant attribution is not verified.");
  }
}

function assertStableFingerprintInput(value: string, label: string): void {
  if (value.length < 1 || value.length > 1_024 || value.includes("\u0000")) {
    throw new TypeError(`${label} must contain 1..1024 non-NUL characters.`);
  }
}

function denialHmac(key: Uint8Array, fields: readonly string[]): string {
  return `hmac-sha256:${denialHmacDigest(key, fields).toString("hex")}`;
}

function denialHmacDigest(key: Uint8Array, fields: readonly string[]): Buffer {
  const hmac = createHmac("sha256", key);
  for (const field of fields) {
    const encoded = Buffer.from(field, "utf8");
    const length = Buffer.allocUnsafe(4);
    length.writeUInt32BE(encoded.byteLength);
    hmac.update(length);
    hmac.update(encoded);
  }
  return hmac.digest();
}

function createSecurityDenialObservationReceipt(): string {
  return `security-denial-observation:${randomBytes(32).toString("hex")}`;
}

function deriveDenialDedupeFingerprint(
  proof: InboxV2SecurityDenialFingerprintProof,
  denialKind: InboxV2SecurityDenialKind,
  publicErrorClass: InboxV2SecurityDenialPublicErrorClass
): string {
  const key = denialDedupeDerivationKeys.get(proof);
  if (key === undefined) {
    throw new TypeError("Missing security-denial dedupe derivation key.");
  }
  return denialHmac(key, [
    "inbox-v2-security-denial-v1",
    "attempt-dedupe",
    denialKind,
    publicErrorClass
  ]);
}

type DenialSinkState = {
  inFlight: number;
  consecutiveFailures: number;
  circuitOpenUntil: number;
};

// Process-wide rather than sink-object keyed: per-request wrappers cannot
// bypass the work cap or leave an unbounded number of hung adapter promises.
const processDenialSinkState: DenialSinkState = {
  inFlight: 0,
  consecutiveFailures: 0,
  circuitOpenUntil: 0
};

function denialSinkState(): DenialSinkState {
  return processDenialSinkState;
}

function releaseDenialSinkSlot(state: DenialSinkState): void {
  state.inFlight = Math.max(0, state.inFlight - 1);
}

function markDenialSinkSuccess(state: DenialSinkState): void {
  state.consecutiveFailures = 0;
  state.circuitOpenUntil = 0;
}

function markDenialSinkFailure(state: DenialSinkState): void {
  state.consecutiveFailures += 1;
  if (
    state.consecutiveFailures >=
    INBOX_V2_SECURITY_DENIAL_POLICY.circuitFailureThreshold
  ) {
    state.circuitOpenUntil =
      Date.now() + INBOX_V2_SECURITY_DENIAL_POLICY.circuitCooldownMilliseconds;
  }
}

function notifyObservationWithoutThrowing(
  observer:
    | ((observation: InboxV2SecurityDenialObservation) => void | Promise<void>)
    | undefined,
  observation: InboxV2SecurityDenialObservation,
  decision: InboxV2DeniedAuthorizationDecision,
  context: InboxV2SecurityDenialContext
): void {
  if (observer === undefined) return;
  const observationClass =
    observation.outcome === "recorded"
      ? `recorded:${observation.result.disposition}`
      : `unavailable:${observation.failureClass}`;
  notifyBoundedTelemetry(
    `observation:${context.tenantScope.tenantId}:${decision.securityDenialAction}:${observationClass}`,
    observer,
    observation
  );
}

const pendingTelemetryKeys = new Set<string>();

/** Duplicate pending signals coalesce, and distinct hung callbacks have one cap. */
function notifyBoundedTelemetry<TValue>(
  key: string,
  callback: (value: TValue) => void | Promise<void>,
  value: TValue
): void {
  if (
    pendingTelemetryKeys.has(key) ||
    pendingTelemetryKeys.size >=
      INBOX_V2_SECURITY_DENIAL_POLICY.maxInFlightTelemetryCallbacks
  ) {
    return;
  }
  pendingTelemetryKeys.add(key);
  let result: void | Promise<void>;
  try {
    result = callback(value);
  } catch {
    pendingTelemetryKeys.delete(key);
    return;
  }
  if (result === undefined) {
    pendingTelemetryKeys.delete(key);
    return;
  }
  void Promise.resolve(result).then(
    () => pendingTelemetryKeys.delete(key),
    () => pendingTelemetryKeys.delete(key)
  );
}

class SecurityDenialSinkTimeoutError extends Error {}
