import {
  inboxV2CatalogIdSchema,
  inboxV2TimestampSchema,
  type InboxV2OutboundProviderSettlementCommit
} from "@hulee/contracts";
import {
  createSqlInboxV2OutboundProviderSettlementRuntime,
  type HuleeDatabase,
  type InboxV2OutboundProviderSettlementCommandResult,
  type InboxV2OutboundProviderSettlementPlanner,
  type InboxV2OutboundProviderSettlementPlanResult,
  type InboxV2OutboundProviderSettlementService,
  type InboxV2OutboundProviderSettlementWorkClaim,
  type InboxV2OutboundProviderSettlementWorkFinalizeResult,
  type InboxV2OutboundProviderSettlementWorkRepository,
  type WithInboxV2AuthorizedCommandMutationInput
} from "@hulee/db";

export const INBOX_V2_OUTBOUND_PROVIDER_SETTLEMENT_PERMISSION_ID =
  "core:message.receive_external" as const;

type SettlementDeferral =
  | Readonly<{
      kind: "retry";
      availableAt: string;
      errorCode: string;
    }>
  | Readonly<{ kind: "dead"; errorCode: string }>;

export type InboxV2OutboundProviderSettlementAuthorizationResult<TAuthority> =
  | Readonly<{
      kind: "authorized";
      authority: TAuthority;
    }>
  | SettlementDeferral;

export type InboxV2OutboundProviderSettlementExecutionResult =
  | Readonly<{
      kind: "settled" | "already_settled" | "lease_conflict";
    }>
  | SettlementDeferral;

/**
 * Narrow authority seam: planning is database-owned and cannot be replaced by
 * an authorization adapter. The adapter may only authorize the exact commit
 * and execute that same commit through the authorized settlement service.
 */
export type InboxV2OutboundProviderSettlementAuthorityPort<TAuthority> =
  Readonly<{
    authorizeExactCommit(
      input: Readonly<{
        claim: InboxV2OutboundProviderSettlementWorkClaim;
        commit: InboxV2OutboundProviderSettlementCommit;
      }>
    ): Promise<
      InboxV2OutboundProviderSettlementAuthorizationResult<TAuthority>
    >;
    executeAuthorizedExactCommit(
      input: Readonly<{
        claim: InboxV2OutboundProviderSettlementWorkClaim;
        commit: InboxV2OutboundProviderSettlementCommit;
        authority: TAuthority;
      }>
    ): Promise<InboxV2OutboundProviderSettlementExecutionResult>;
  }>;

export type InboxV2OutboundProviderSettlementAuthorizer = Readonly<{
  authorizeExactCommit(
    input: Readonly<{
      claim: InboxV2OutboundProviderSettlementWorkClaim;
      commit: InboxV2OutboundProviderSettlementCommit;
    }>
  ): Promise<
    InboxV2OutboundProviderSettlementAuthorizationResult<WithInboxV2AuthorizedCommandMutationInput>
  >;
}>;

/** Production authority: authorization plus the only allowed settlement write. */
export function createInboxV2OutboundProviderSettlementAuthority(
  input: Readonly<{
    authorizer: InboxV2OutboundProviderSettlementAuthorizer;
    settlementService: InboxV2OutboundProviderSettlementService;
    retryAt?: () => string;
  }>
): InboxV2OutboundProviderSettlementAuthorityPort<WithInboxV2AuthorizedCommandMutationInput> {
  assertProductionAuthorityOptions(input);
  const retryAt = input.retryAt ?? defaultSettlementRetryAt;
  return Object.freeze({
    authorizeExactCommit(request) {
      return input.authorizer.authorizeExactCommit(request);
    },
    async executeAuthorizedExactCommit(request) {
      if (
        !hasHistoricalProviderTruthAuthority(request.authority, request.commit)
      ) {
        return {
          kind: "dead",
          errorCode: "core:provider-settlement-authorization-invalid"
        };
      }
      const result = await input.settlementService.settle({
        authorizedMutation: request.authority,
        workLease: request.claim,
        commit: request.commit
      });
      return mapSettlementServiceResult(result, retryAt);
    }
  });
}

export type InboxV2OutboundProviderSettlementWorkerResult =
  | Readonly<{
      kind: "settled";
      observationId: string;
      replay: boolean;
    }>
  | Readonly<{
      kind: "retry_scheduled" | "dead";
      observationId: string;
    }>
  | Readonly<{
      kind: "lease_conflict";
      observationId: string;
    }>
  | Readonly<{
      kind: "lease_abandoned";
      observationId: string;
      stage: "load" | "settle" | "finalize";
    }>;

export type InboxV2OutboundProviderSettlementWorker = Readonly<{
  processBatch(
    input: Readonly<{
      tenantId: string;
      workerId: string;
      limit: number;
      leaseDurationMs: number;
    }>
  ): Promise<readonly InboxV2OutboundProviderSettlementWorkerResult[]>;
}>;

export function createInboxV2OutboundProviderSettlementWorkerCoordinator<
  TAuthority
>(
  input: Readonly<{
    work: InboxV2OutboundProviderSettlementWorkRepository;
    planner: InboxV2OutboundProviderSettlementPlanner;
    settlementAuthority: InboxV2OutboundProviderSettlementAuthorityPort<TAuthority>;
  }>
): InboxV2OutboundProviderSettlementWorker {
  assertWorkerOptions(input);
  return Object.freeze({
    async processBatch(request) {
      const claims = await input.work.claim(request);
      return Promise.all(claims.map((claim) => processClaim(input, claim)));
    }
  });
}

/** Production composition: one DB-owned runtime plus a narrow authorizer. */
export function createInboxV2OutboundProviderSettlementWorker(
  input: Readonly<{
    database: HuleeDatabase;
    authorizer: InboxV2OutboundProviderSettlementAuthorizer;
    tokenSource?: () => string;
    retryAt?: () => string;
  }>
): InboxV2OutboundProviderSettlementWorker {
  const runtime = createSqlInboxV2OutboundProviderSettlementRuntime(
    input.database,
    input.tokenSource === undefined ? {} : { tokenSource: input.tokenSource }
  );
  return createInboxV2OutboundProviderSettlementWorkerCoordinator({
    work: runtime.work,
    planner: runtime.planner,
    settlementAuthority: createInboxV2OutboundProviderSettlementAuthority({
      authorizer: input.authorizer,
      settlementService: runtime.settlementService,
      ...(input.retryAt === undefined ? {} : { retryAt: input.retryAt })
    })
  });
}

async function processClaim<TAuthority>(
  options: Readonly<{
    work: InboxV2OutboundProviderSettlementWorkRepository;
    planner: InboxV2OutboundProviderSettlementPlanner;
    settlementAuthority: InboxV2OutboundProviderSettlementAuthorityPort<TAuthority>;
  }>,
  claim: InboxV2OutboundProviderSettlementWorkClaim
): Promise<InboxV2OutboundProviderSettlementWorkerResult> {
  let loaded: InboxV2OutboundProviderSettlementPlanResult;
  try {
    loaded = await options.planner.loadAndPlanExactCommit({
      claim
    });
  } catch {
    return abandoned(claim, "load");
  }

  if (loaded.kind === "already_settled") {
    return finalizeSettlement(options.work, claim, { kind: "settled" }, true);
  }
  if (loaded.kind === "lease_conflict") {
    return { kind: "lease_conflict", observationId: claim.observationId };
  }
  if (loaded.kind === "retry" || loaded.kind === "dead") {
    return finalizeDeferral(options.work, claim, loaded);
  }

  let authorization: InboxV2OutboundProviderSettlementAuthorizationResult<TAuthority>;
  try {
    authorization = await options.settlementAuthority.authorizeExactCommit({
      claim,
      commit: loaded.commit
    });
  } catch {
    return abandoned(claim, "settle");
  }
  if (authorization.kind === "retry" || authorization.kind === "dead") {
    return finalizeDeferral(options.work, claim, authorization);
  }

  let settled: InboxV2OutboundProviderSettlementExecutionResult;
  try {
    settled = await options.settlementAuthority.executeAuthorizedExactCommit({
      claim,
      commit: loaded.commit,
      authority: authorization.authority
    });
  } catch {
    return abandoned(claim, "settle");
  }
  if (settled.kind === "lease_conflict") {
    return { kind: "lease_conflict", observationId: claim.observationId };
  }
  if (settled.kind === "retry" || settled.kind === "dead") {
    return finalizeDeferral(options.work, claim, settled);
  }
  return finalizeSettlement(
    options.work,
    claim,
    { kind: "settled" },
    settled.kind === "already_settled"
  );
}

async function finalizeDeferral(
  work: InboxV2OutboundProviderSettlementWorkRepository,
  claim: InboxV2OutboundProviderSettlementWorkClaim,
  result: SettlementDeferral
): Promise<InboxV2OutboundProviderSettlementWorkerResult> {
  const errorCode = inboxV2CatalogIdSchema.parse(result.errorCode);
  const outcome =
    result.kind === "retry"
      ? ({
          kind: "retry" as const,
          availableAt: inboxV2TimestampSchema.parse(result.availableAt),
          errorCode
        } as const)
      : ({ kind: "dead" as const, errorCode } as const);
  return finalizeSettlement(work, claim, outcome, false);
}

async function finalizeSettlement(
  work: InboxV2OutboundProviderSettlementWorkRepository,
  claim: InboxV2OutboundProviderSettlementWorkClaim,
  outcome:
    | Readonly<{ kind: "settled" }>
    | Readonly<{
        kind: "retry";
        availableAt: string;
        errorCode: string;
      }>
    | Readonly<{ kind: "dead"; errorCode: string }>,
  replay: boolean
): Promise<InboxV2OutboundProviderSettlementWorkerResult> {
  let finalized: InboxV2OutboundProviderSettlementWorkFinalizeResult;
  try {
    finalized = await work.finalize({
      tenantId: claim.tenantId,
      observationId: claim.observationId,
      workerId: claim.workerId,
      leaseToken: claim.leaseToken,
      expectedLeaseRevision: claim.leaseRevision,
      outcome
    });
  } catch {
    return abandoned(claim, "finalize");
  }
  if (finalized.kind === "conflict") {
    return { kind: "lease_conflict", observationId: claim.observationId };
  }
  if (outcome.kind === "retry") {
    return {
      kind: "retry_scheduled",
      observationId: claim.observationId
    };
  }
  if (outcome.kind === "dead") {
    return { kind: "dead", observationId: claim.observationId };
  }
  return {
    kind: "settled",
    observationId: claim.observationId,
    replay: replay || finalized.kind === "already_finalized"
  };
}

function abandoned(
  claim: InboxV2OutboundProviderSettlementWorkClaim,
  stage: "load" | "settle" | "finalize"
): InboxV2OutboundProviderSettlementWorkerResult {
  return {
    kind: "lease_abandoned",
    observationId: claim.observationId,
    stage
  };
}

function assertWorkerOptions<TAuthority>(input: {
  work: InboxV2OutboundProviderSettlementWorkRepository;
  planner: InboxV2OutboundProviderSettlementPlanner;
  settlementAuthority: InboxV2OutboundProviderSettlementAuthorityPort<TAuthority>;
}): void {
  if (
    input === null ||
    typeof input !== "object" ||
    input.work === null ||
    typeof input.work !== "object" ||
    typeof input.work.claim !== "function" ||
    typeof input.work.finalize !== "function" ||
    input.planner === null ||
    typeof input.planner !== "object" ||
    typeof input.planner.loadAndPlanExactCommit !== "function" ||
    input.settlementAuthority === null ||
    typeof input.settlementAuthority !== "object" ||
    typeof input.settlementAuthority.authorizeExactCommit !== "function" ||
    typeof input.settlementAuthority.executeAuthorizedExactCommit !== "function"
  ) {
    throw new TypeError(
      "Provider settlement worker requires durable work and settlement authority ports."
    );
  }
}

function assertProductionAuthorityOptions(input: {
  authorizer: InboxV2OutboundProviderSettlementAuthorizer;
  settlementService: InboxV2OutboundProviderSettlementService;
  retryAt?: () => string;
}): void {
  if (
    input === null ||
    typeof input !== "object" ||
    input.authorizer === null ||
    typeof input.authorizer !== "object" ||
    typeof input.authorizer.authorizeExactCommit !== "function" ||
    input.settlementService === null ||
    typeof input.settlementService !== "object" ||
    typeof input.settlementService.settle !== "function" ||
    (input.retryAt !== undefined && typeof input.retryAt !== "function")
  ) {
    throw new TypeError(
      "Provider settlement authority requires an authorizer and authorized settlement service."
    );
  }
}

function mapSettlementServiceResult(
  result: InboxV2OutboundProviderSettlementCommandResult,
  retryAt: () => string
): InboxV2OutboundProviderSettlementExecutionResult {
  switch (result.kind) {
    case "applied":
      return { kind: "settled" };
    case "already_applied":
      return { kind: "already_settled" };
    case "idempotency_conflict":
      return {
        kind: "dead",
        errorCode: "core:provider-settlement-idempotency-conflict"
      };
    case "resource_not_found":
    case "role_legality_conflict":
      return {
        kind: "dead",
        errorCode: "core:provider-settlement-authorization-rejected"
      };
    case "revision_conflict":
      return retry(
        retryAt,
        "core:provider-settlement-authorization-revision-conflict"
      );
    case "settlement_conflict":
      if (result.reason === "work_lease_conflict") {
        return { kind: "lease_conflict" };
      }
      if (result.reason === "observation_already_settled") {
        return { kind: "already_settled" };
      }
      return retry(retryAt, "core:provider-settlement-concurrent-conflict");
  }
}

function retry(
  retryAt: () => string,
  errorCode: string
): InboxV2OutboundProviderSettlementExecutionResult {
  return {
    kind: "retry",
    availableAt: inboxV2TimestampSchema.parse(retryAt()),
    errorCode
  };
}

function defaultSettlementRetryAt(): string {
  return new Date(Date.now() + 1_000).toISOString();
}

function hasHistoricalProviderTruthAuthority(
  authority: WithInboxV2AuthorizedCommandMutationInput,
  commit: InboxV2OutboundProviderSettlementCommit
): boolean {
  const decisions = authority.records.audit.authorizationDecisionRefs.filter(
    (decision) =>
      decision.permissionId ===
        INBOX_V2_OUTBOUND_PROVIDER_SETTLEMENT_PERMISSION_ID &&
      decision.resourceScopeId === "core:conversation" &&
      decision.resource.tenantId === commit.tenantId &&
      decision.resource.entityTypeId === "core:conversation" &&
      String(decision.resource.entityId) ===
        String(commit.messageTransportAssociation.message.conversation.id) &&
      decision.outcome === "allowed"
  );
  const conversationFences = authority.revisions.resources.filter(
    (resource) =>
      resource.resourceKind === "conversation" &&
      String(resource.resourceId) ===
        String(commit.messageTransportAssociation.message.conversation.id) &&
      resource.advance === "none" &&
      String(resource.expectedResourceAccessRevision) ===
        String(decisions[0]?.resourceAccessRevision)
  );
  return (
    authority.command.commandTypeId ===
      "core:outbound-provider-observation.settle" &&
    authority.command.actor.kind === "trusted_service" &&
    authority.command.actor.trustedServiceId ===
      commit.settledByTrustedServiceId &&
    authority.occurredAt === commit.settledAt &&
    Date.parse(authority.command.authorizedAt) <=
      Date.parse(commit.settledAt) &&
    authority.command.authorizationDecisionId === decisions[0]?.id &&
    decisions.length === 1 &&
    conversationFences.length === 1 &&
    authority.revisions.resources.length === 1 &&
    !authority.records.audit.authorizationDecisionRefs.some(
      (decision) => decision.permissionId === "core:source_account.use"
    ) &&
    !authority.records.outboxIntents.some(
      (intent) => intent.effectClass === "provider_io"
    )
  );
}
