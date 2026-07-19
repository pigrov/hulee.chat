import {
  inboxV2CatalogIdSchema,
  inboxV2TenantIdSchema
} from "@hulee/contracts";
import type { HuleeDatabase, RawSqlExecutor } from "@hulee/db";
import {
  createSqlInboxV2AttachmentMaterializationTerminalCommandService,
  createSqlInboxV2FileObjectRepository,
  createSqlInboxV2SourceAttachmentMaterializationRepository,
  isSqlInboxV2SourceAttachmentReservationCommandPort,
  isSqlInboxV2SourceAttachmentReservationCommandPortForRepository,
  type InboxV2AttachmentMaterializationClaim as SqlInboxV2AttachmentMaterializationClaim,
  type InboxV2AttachmentMaterializationTerminalCommandResult,
  type InboxV2SqlSourceAttachmentReservationCommandPort
} from "@hulee/db/internal/attachment-materialization";
import type { TenantScopedVersionAwareObjectStorageResolver } from "@hulee/storage";

import {
  createInboxV2AttachmentMaterializationCoordinator,
  InboxV2AttachmentMaterializationSourceError,
  type InboxV2AttachmentMaterializationClaim,
  type InboxV2AttachmentMaterializationProcessResult,
  type InboxV2AttachmentMaterializationSource,
  type InboxV2AttachmentMaterializationSourceLoader
} from "./inbox-v2-attachment-materialization-coordinator";
import {
  isInboxV2TrustedSourceAttachmentReservationPlanner,
  type InboxV2TrustedSourceAttachmentReservationPlanner
} from "./source-attachment-materialization-handler";

const DEFAULT_SWEEP_BATCH_SIZE = 16;
const MAXIMUM_SWEEP_BATCH_SIZE = 64;
const DEFAULT_SWEEP_CONCURRENCY = 4;
const MAXIMUM_SWEEP_CONCURRENCY = 16;
const DEFAULT_LEASE_DURATION_SECONDS = 120;
const MINIMUM_LEASE_DURATION_SECONDS = 5;
const MAXIMUM_LEASE_DURATION_SECONDS = 900;

const trustedProviderSourceLoaders = new WeakMap<
  object,
  TrustedProviderSourceLoaderState
>();
const trustedTenantStorageResolvers = new WeakMap<
  object,
  TenantScopedVersionAwareObjectStorageResolver
>();
const trustedProductionServices = new WeakMap<
  object,
  AttachmentMaterializationProductionServicesState
>();

export type InboxV2TrustedAttachmentMaterializationProviderSourceLoader =
  Readonly<{
    kind: "trusted_attachment_materialization_provider_source_loader";
  }>;

export type InboxV2TrustedAttachmentMaterializationStorageResolver = Readonly<{
  kind: "trusted_attachment_materialization_storage_resolver";
}>;

export type InboxV2AttachmentMaterializationProductionServices = Readonly<{
  kind: "attachment_materialization_production_services";
}>;

type TrustedProviderSourceLoaderState = Readonly<{
  reservationPlanner: InboxV2TrustedSourceAttachmentReservationPlanner;
  open(
    request: InboxV2AttachmentMaterializationProviderSourceRequest,
    options: Readonly<{ signal: AbortSignal; maximumBytes: number }>
  ): Promise<InboxV2AttachmentMaterializationSource>;
}>;

/** Server-only request handed to the provider adapter after HMAC verification. */
export type InboxV2AttachmentMaterializationProviderSourceRequest = Readonly<{
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

type AttachmentMaterializationProductionServicesState = Readonly<{
  database: HuleeDatabase;
  reservationCommands: InboxV2SqlSourceAttachmentReservationCommandPort;
}>;

type AuthorizationRefreshCandidate = Readonly<{
  tenantId: string;
  jobId: string;
  expectedJobRevision: string;
}>;

type AuthorizationRefreshResult = Awaited<
  ReturnType<
    InboxV2SqlSourceAttachmentReservationCommandPort["refreshPendingAuthorization"]
  >
>;

export type WorkerInboxV2AttachmentMaterializationSweepResult = Readonly<{
  authorizationRefreshSelectedCount: number;
  authorizationRefreshRefreshedCount: number;
  authorizationRefreshAlreadyCurrentCount: number;
  authorizationRefreshConflictCount: number;
  authorizationRefreshFailureCount: number;
  claimFailureCount: 0 | 1;
  claimedCount: number;
  attemptedCount: number;
  cancelledCount: number;
  readyCount: number;
  visibleFallbackCount: number;
  readyReconciledCount: number;
  orphanRecordedCount: number;
  orphanUnrecordedCount: number;
  indeterminateCount: number;
  unhandledFailureCount: number;
}>;

export type WorkerInboxV2AttachmentMaterializationSweeper = Readonly<{
  sweep(): Promise<WorkerInboxV2AttachmentMaterializationSweepResult>;
}>;

export type WorkerInboxV2AttachmentMaterializationSweeperOptions = Readonly<{
  services: InboxV2AttachmentMaterializationProductionServices;
  tenantId: string;
  workerId: string;
  sourceLoader: InboxV2TrustedAttachmentMaterializationProviderSourceLoader;
  storageResolver: InboxV2TrustedAttachmentMaterializationStorageResolver;
  batchSize?: number;
  concurrency?: number;
  leaseDurationSeconds?: number;
  maximumAttachmentBytes?: number;
}>;

type NormalizedSweepOptions = Readonly<{
  tenantId: string;
  workerId: string;
  batchSize: number;
  concurrency: number;
  leaseDurationSeconds: number;
}>;

type SweepRuntime = Readonly<{
  listAuthorizationRefreshCandidates(): Promise<
    readonly AuthorizationRefreshCandidate[]
  >;
  refreshAuthorization(
    candidate: AuthorizationRefreshCandidate
  ): Promise<AuthorizationRefreshResult>;
  claimBatch(): Promise<readonly InboxV2AttachmentMaterializationClaim[]>;
  processClaim(
    claim: InboxV2AttachmentMaterializationClaim
  ): Promise<InboxV2AttachmentMaterializationProcessResult>;
}>;

/**
 * Server-only admission of the real SQL database plus the DB-branded
 * reservation command port. The opaque result is the only form accepted by the
 * public production sweep constructor, so an object with the same structural
 * methods cannot substitute either dependency. Omitted from the package root.
 */
export function createInboxV2AttachmentMaterializationProductionServices(
  input: Readonly<{
    database: HuleeDatabase;
    reservationCommands: InboxV2SqlSourceAttachmentReservationCommandPort;
  }>
): InboxV2AttachmentMaterializationProductionServices {
  assertProductionDatabase(input?.database);
  const sourceRepository =
    createSqlInboxV2SourceAttachmentMaterializationRepository(
      input.database as RawSqlExecutor
    );
  if (
    !isSqlInboxV2SourceAttachmentReservationCommandPort(
      input?.reservationCommands
    ) ||
    !isSqlInboxV2SourceAttachmentReservationCommandPortForRepository(
      input.reservationCommands,
      sourceRepository
    )
  ) {
    throw new TypeError(
      "Attachment materialization production services require an authentic SQL reservation command port bound to the same database."
    );
  }
  const capability = Object.freeze({
    kind: "attachment_materialization_production_services" as const
  });
  trustedProductionServices.set(capability, {
    database: input.database,
    reservationCommands: input.reservationCommands
  });
  return capability;
}

/**
 * Explicit production trust-admission boundary. The provider callback cannot
 * become a materialization authority on its own: an authentic HMAC reservation
 * planner is captured and verifies the opaque source handle before `open` can
 * observe it or perform provider I/O. This factory is intentionally omitted
 * from the worker package root and belongs in server-only composition.
 */
export function createInboxV2TrustedAttachmentMaterializationProviderSourceLoader(
  input: Readonly<{
    reservationPlanner: InboxV2TrustedSourceAttachmentReservationPlanner;
    open(
      request: InboxV2AttachmentMaterializationProviderSourceRequest,
      options: Readonly<{ signal: AbortSignal; maximumBytes: number }>
    ): Promise<InboxV2AttachmentMaterializationSource>;
  }>
): InboxV2TrustedAttachmentMaterializationProviderSourceLoader {
  if (
    !isInboxV2TrustedSourceAttachmentReservationPlanner(
      input?.reservationPlanner
    ) ||
    typeof input.open !== "function"
  ) {
    throw new TypeError(
      "Provider attachment loading requires an authentic HMAC locator planner and an explicit provider callback."
    );
  }
  const capability = Object.freeze({
    kind: "trusted_attachment_materialization_provider_source_loader" as const
  });
  trustedProviderSourceLoaders.set(capability, {
    reservationPlanner: input.reservationPlanner,
    open: input.open
  });
  return capability;
}

/**
 * Explicit production trust-admission boundary for the tenant/root storage
 * catalog. The structural resolver remains hidden in a WeakMap and therefore
 * cannot be substituted directly at the production sweep constructor.
 */
export function createInboxV2TrustedAttachmentMaterializationStorageResolver(
  resolver: TenantScopedVersionAwareObjectStorageResolver
): InboxV2TrustedAttachmentMaterializationStorageResolver {
  if (typeof resolver?.resolve !== "function") {
    throw new TypeError(
      "Attachment materialization requires a tenant-scoped storage resolver."
    );
  }
  const capability = Object.freeze({
    kind: "trusted_attachment_materialization_storage_resolver" as const
  });
  trustedTenantStorageResolvers.set(capability, resolver);
  return capability;
}

/** Relative-module verification seam; omitted from the worker package root. */
export function resolveInboxV2TrustedAttachmentMaterializationSourceLoaderForTest(
  capability: InboxV2TrustedAttachmentMaterializationProviderSourceLoader
): InboxV2AttachmentMaterializationSourceLoader {
  const state = trustedProviderSourceLoaders.get(capability as object);
  if (state === undefined) {
    throw new TypeError(
      "Attachment materialization provider-source capability is not authentic."
    );
  }
  return createVerifiedSourceLoader(state);
}

/**
 * High-level production composition for one bounded tenant sweep. SQL owns
 * claiming and terminal command persistence; the low-level lease/source/key
 * structures never cross this public result boundary.
 */
export function createWorkerInboxV2AttachmentMaterializationSweeper(
  options: WorkerInboxV2AttachmentMaterializationSweeperOptions
): WorkerInboxV2AttachmentMaterializationSweeper {
  const normalized = normalizeSweepOptions(options);
  const services = trustedProductionServices.get(options.services as object);
  const sourceState = trustedProviderSourceLoaders.get(
    options.sourceLoader as object
  );
  const storageResolver = trustedTenantStorageResolvers.get(
    options.storageResolver as object
  );
  if (
    services === undefined ||
    sourceState === undefined ||
    storageResolver === undefined
  ) {
    throw new TypeError(
      "Production attachment materialization requires authentic SQL, provider-source and tenant-storage capabilities."
    );
  }

  const terminalCommands =
    createSqlInboxV2AttachmentMaterializationTerminalCommandService(
      services.database
    );
  const files = createSqlInboxV2FileObjectRepository(services.database, {
    messageMutationRunner: {
      async ready(input) {
        return mapTerminalCommandResult(await terminalCommands.ready(input));
      },
      async failed(input) {
        return mapTerminalCommandResult(await terminalCommands.failed(input));
      }
    }
  });
  const coordinator = createInboxV2AttachmentMaterializationCoordinator({
    repository: {
      authorizeMaterializationIo: (claim) =>
        files.authorizeMaterializationIo(requireSqlClaim(claim)),
      async finalizeReady(input) {
        return simplifyFileFinalization(
          await files.finalizeReady({
            ...input,
            claim: requireSqlClaim(input.claim)
          })
        );
      },
      async finalizeFailed(input) {
        return simplifyFileFinalization(
          await files.finalizeFailed({
            ...input,
            claim: requireSqlClaim(input.claim)
          })
        );
      },
      recordOrphan: (input) =>
        files.recordOrphan({
          ...input,
          claim: requireSqlClaim(input.claim)
        })
    },
    sourceLoader: createVerifiedSourceLoader(sourceState),
    storageResolver,
    maximumAttachmentBytes: options.maximumAttachmentBytes
  });

  return createSweeper(normalized, {
    listAuthorizationRefreshCandidates: () =>
      files.listPendingMaterializationAuthorizationRefreshCandidates({
        tenantId: normalized.tenantId,
        limit: normalized.batchSize
      }),
    refreshAuthorization: (candidate) =>
      services.reservationCommands.refreshPendingAuthorization(candidate),
    claimBatch: () =>
      files.claimMaterializationJobs({
        tenantId: normalized.tenantId,
        workerId: normalized.workerId,
        batchSize: normalized.batchSize,
        leaseDurationSeconds: normalized.leaseDurationSeconds
      }),
    processClaim: (claim) => coordinator.process(claim)
  });
}

/** Relative-module test seam; deliberately omitted from the package root. */
export function createInboxV2AttachmentMaterializationSweeperForTest(
  options: Readonly<{
    tenantId: string;
    workerId: string;
    claimBatch(): Promise<readonly InboxV2AttachmentMaterializationClaim[]>;
    processClaim(
      claim: InboxV2AttachmentMaterializationClaim
    ): Promise<InboxV2AttachmentMaterializationProcessResult>;
    listAuthorizationRefreshCandidates?(): Promise<
      readonly AuthorizationRefreshCandidate[]
    >;
    refreshAuthorization?(
      candidate: AuthorizationRefreshCandidate
    ): Promise<AuthorizationRefreshResult>;
    batchSize?: number;
    concurrency?: number;
    leaseDurationSeconds?: number;
  }>
): WorkerInboxV2AttachmentMaterializationSweeper {
  const normalized = normalizeSweepOptions(options);
  if (
    typeof options.claimBatch !== "function" ||
    typeof options.processClaim !== "function"
  ) {
    throw new TypeError(
      "Attachment materialization test sweep requires claim and process seams."
    );
  }
  return createSweeper(normalized, {
    listAuthorizationRefreshCandidates:
      options.listAuthorizationRefreshCandidates ?? (async () => []),
    refreshAuthorization:
      options.refreshAuthorization ??
      (async () => ({ kind: "already_current", jobRevision: "1" })),
    claimBatch: options.claimBatch,
    processClaim: options.processClaim
  });
}

function createSweeper(
  options: NormalizedSweepOptions,
  runtime: SweepRuntime
): WorkerInboxV2AttachmentMaterializationSweeper {
  return Object.freeze({
    async sweep() {
      const refreshCandidates = await loadAuthorizationRefreshCandidates(
        options,
        runtime
      );
      const refreshCounts = await refreshPendingAuthorization(
        refreshCandidates.candidates,
        options.concurrency,
        runtime
      );
      let claims: readonly InboxV2AttachmentMaterializationClaim[];
      try {
        claims = await runtime.claimBatch();
        if (!Array.isArray(claims) || claims.length > options.batchSize) {
          throw new TypeError(
            "Attachment materialization claim source exceeded its bounded batch."
          );
        }
      } catch {
        return Object.freeze({
          ...emptySweepResult(1),
          ...refreshCounts,
          authorizationRefreshFailureCount:
            refreshCounts.authorizationRefreshFailureCount +
            refreshCandidates.selectionFailureCount
        });
      }

      const mutable = mutableSweepResult(claims.length);
      Object.assign(mutable, refreshCounts, {
        authorizationRefreshFailureCount:
          refreshCounts.authorizationRefreshFailureCount +
          refreshCandidates.selectionFailureCount
      });
      let nextIndex = 0;
      const processNext = async (): Promise<void> => {
        while (nextIndex < claims.length) {
          const claim = claims[nextIndex];
          nextIndex += 1;
          if (claim === undefined) return;
          mutable.attemptedCount += 1;
          try {
            recordProcessResult(mutable, await runtime.processClaim(claim));
          } catch {
            mutable.unhandledFailureCount += 1;
          }
        }
      };
      const workerCount = Math.min(options.concurrency, claims.length);
      await Promise.all(
        Array.from({ length: workerCount }, () => processNext())
      );
      return Object.freeze({ ...mutable });
    }
  });
}

type AuthorizationRefreshCounts = {
  -readonly [Key in
    | "authorizationRefreshSelectedCount"
    | "authorizationRefreshRefreshedCount"
    | "authorizationRefreshAlreadyCurrentCount"
    | "authorizationRefreshConflictCount"
    | "authorizationRefreshFailureCount"]: WorkerInboxV2AttachmentMaterializationSweepResult[Key];
};

async function loadAuthorizationRefreshCandidates(
  options: NormalizedSweepOptions,
  runtime: SweepRuntime
): Promise<
  Readonly<{
    candidates: readonly AuthorizationRefreshCandidate[];
    selectionFailureCount: 0 | 1;
  }>
> {
  try {
    const candidates = await runtime.listAuthorizationRefreshCandidates();
    const identities = new Set<string>();
    if (!Array.isArray(candidates) || candidates.length > options.batchSize) {
      throw new TypeError(
        "Attachment authorization refresh source exceeded its bounded batch."
      );
    }
    for (const candidate of candidates) {
      const identity = `${candidate.tenantId}\u0000${candidate.jobId}`;
      if (
        candidate.tenantId !== options.tenantId ||
        typeof candidate.jobId !== "string" ||
        candidate.jobId.length < 1 ||
        !/^[1-9][0-9]*$/u.test(candidate.expectedJobRevision) ||
        identities.has(identity)
      ) {
        throw new TypeError(
          "Attachment authorization refresh source returned an invalid candidate set."
        );
      }
      identities.add(identity);
    }
    return Object.freeze({ candidates, selectionFailureCount: 0 });
  } catch {
    return Object.freeze({ candidates: [], selectionFailureCount: 1 });
  }
}

async function refreshPendingAuthorization(
  candidates: readonly AuthorizationRefreshCandidate[],
  concurrency: number,
  runtime: SweepRuntime
): Promise<AuthorizationRefreshCounts> {
  const counts: AuthorizationRefreshCounts = {
    authorizationRefreshSelectedCount: candidates.length,
    authorizationRefreshRefreshedCount: 0,
    authorizationRefreshAlreadyCurrentCount: 0,
    authorizationRefreshConflictCount: 0,
    authorizationRefreshFailureCount: 0
  };
  let nextIndex = 0;
  const refreshNext = async (): Promise<void> => {
    while (nextIndex < candidates.length) {
      const candidate = candidates[nextIndex];
      nextIndex += 1;
      if (candidate === undefined) return;
      try {
        const result = await runtime.refreshAuthorization(candidate);
        recordAuthorizationRefreshResult(counts, result);
      } catch {
        counts.authorizationRefreshFailureCount += 1;
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, candidates.length) }, () =>
      refreshNext()
    )
  );
  return Object.freeze({ ...counts });
}

function recordAuthorizationRefreshResult(
  counts: AuthorizationRefreshCounts,
  result: AuthorizationRefreshResult
): void {
  switch (result.kind) {
    case "refreshed":
      counts.authorizationRefreshRefreshedCount += 1;
      return;
    case "already_current":
      counts.authorizationRefreshAlreadyCurrentCount += 1;
      return;
    case "authorization_conflict":
    case "not_found":
    case "state_conflict":
      counts.authorizationRefreshConflictCount += 1;
  }
}

function createVerifiedSourceLoader(
  state: TrustedProviderSourceLoaderState
): InboxV2AttachmentMaterializationSourceLoader {
  const verifyClaim = (
    claim: InboxV2AttachmentMaterializationClaim
  ): InboxV2AttachmentMaterializationProviderSourceRequest => {
    const sqlClaim = requireSqlClaim(claim);
    if (
      sqlClaim.sourceLocator.kind !== "provider" ||
      sqlClaim.sourceOccurrenceId === null
    ) {
      throw new InboxV2AttachmentMaterializationSourceError(
        "source_locator_reference_mismatch",
        false
      );
    }
    const request = Object.freeze({
      tenantId: sqlClaim.tenantId,
      reservationNamespaceGeneration: sqlClaim.reservationNamespaceGeneration,
      sourceOccurrenceId: sqlClaim.sourceOccurrenceId,
      parentMessageId: sqlClaim.contentOrigin.parentEntityId,
      timelineContentId: sqlClaim.contentOrigin.timelineContentId,
      expectedContentRevision: sqlClaim.contentOrigin.expectedContentRevision,
      blockKey: sqlClaim.contentOrigin.contentBlockKey,
      attachmentId: sqlClaim.attachmentId,
      expectedAttachmentRevision:
        sqlClaim.contentOrigin.expectedAttachmentRevision,
      reference: sqlClaim.sourceLocator.reference
    });
    const verification =
      state.reservationPlanner.verifyProviderSourceLocator(request);
    if (verification.kind === "namespace_unavailable") {
      throw new InboxV2AttachmentMaterializationSourceError(
        "source_locator_namespace_unavailable",
        true,
        "indeterminate"
      );
    }
    if (verification.kind === "reference_mismatch") {
      throw new InboxV2AttachmentMaterializationSourceError(
        "source_locator_reference_mismatch",
        false
      );
    }
    return request;
  };

  return Object.freeze({
    verify(claim) {
      verifyClaim(claim);
    },
    async open(claim, options) {
      // Repeat the pure verification immediately before provider I/O so a
      // finite retired-key deadline cannot expire between preflight and open.
      return state.open(verifyClaim(claim), options);
    }
  });
}

function requireSqlClaim(
  claim: InboxV2AttachmentMaterializationClaim
): SqlInboxV2AttachmentMaterializationClaim {
  const candidate = claim as Partial<SqlInboxV2AttachmentMaterializationClaim>;
  if (
    typeof candidate.attachmentId !== "string" ||
    typeof candidate.workerId !== "string" ||
    typeof candidate.leaseGeneration !== "string" ||
    typeof candidate.reservationNamespaceGeneration !== "string" ||
    typeof candidate.sourceOccurrenceId === "undefined" ||
    typeof candidate.contentOrigin !== "object" ||
    candidate.contentOrigin === null ||
    typeof candidate.reservationAuthority !== "object" ||
    candidate.reservationAuthority === null
  ) {
    throw new TypeError(
      "Attachment materialization production claim is not SQL-authentic."
    );
  }
  return candidate as SqlInboxV2AttachmentMaterializationClaim;
}

function mapTerminalCommandResult(
  result: InboxV2AttachmentMaterializationTerminalCommandResult
) {
  switch (result.kind) {
    case "applied":
      return result.result.materialization;
    case "already_applied":
      return "already_applied" as const;
    case "materialization_conflict":
      return result.reason === "lease_lost"
        ? ("lease_lost" as const)
        : ("state_conflict" as const);
    case "authorization_conflict":
    case "idempotency_conflict":
    case "not_found":
      return "state_conflict" as const;
  }
}

function simplifyFileFinalization(
  result: Awaited<
    ReturnType<
      ReturnType<typeof createSqlInboxV2FileObjectRepository>["finalizeReady"]
    >
  >
): "applied" | "already_applied" | "lease_lost" | "state_conflict" {
  return typeof result === "string" ? result : "applied";
}

function normalizeSweepOptions(input: {
  tenantId: string;
  workerId: string;
  batchSize?: number;
  concurrency?: number;
  leaseDurationSeconds?: number;
}): NormalizedSweepOptions {
  const tenantId = inboxV2TenantIdSchema.parse(input.tenantId);
  const workerId = inboxV2CatalogIdSchema.parse(input.workerId);
  const batchSize = input.batchSize ?? DEFAULT_SWEEP_BATCH_SIZE;
  const concurrency =
    input.concurrency ?? Math.min(DEFAULT_SWEEP_CONCURRENCY, batchSize);
  const leaseDurationSeconds =
    input.leaseDurationSeconds ?? DEFAULT_LEASE_DURATION_SECONDS;
  if (
    !Number.isSafeInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > MAXIMUM_SWEEP_BATCH_SIZE
  ) {
    throw new TypeError(
      `Attachment materialization batchSize must be between 1 and ${MAXIMUM_SWEEP_BATCH_SIZE}.`
    );
  }
  if (
    !Number.isSafeInteger(concurrency) ||
    concurrency < 1 ||
    concurrency > MAXIMUM_SWEEP_CONCURRENCY ||
    concurrency > batchSize
  ) {
    throw new TypeError(
      "Attachment materialization concurrency must be positive, bounded and no larger than batchSize."
    );
  }
  if (
    !Number.isSafeInteger(leaseDurationSeconds) ||
    leaseDurationSeconds < MINIMUM_LEASE_DURATION_SECONDS ||
    leaseDurationSeconds > MAXIMUM_LEASE_DURATION_SECONDS
  ) {
    throw new TypeError(
      `Attachment materialization leaseDurationSeconds must be between ${MINIMUM_LEASE_DURATION_SECONDS} and ${MAXIMUM_LEASE_DURATION_SECONDS}.`
    );
  }
  return Object.freeze({
    tenantId,
    workerId,
    batchSize,
    concurrency,
    leaseDurationSeconds
  });
}

function assertProductionDatabase(database: HuleeDatabase): void {
  const candidate = database as Partial<HuleeDatabase> | undefined;
  if (
    typeof candidate?.execute !== "function" ||
    typeof candidate.transaction !== "function" ||
    typeof candidate.$client?.query !== "function" ||
    typeof candidate.$client.connect !== "function"
  ) {
    throw new TypeError(
      "Attachment materialization production sweep requires a PostgreSQL Hulee database."
    );
  }
}

type MutableSweepResult = {
  -readonly [Key in keyof WorkerInboxV2AttachmentMaterializationSweepResult]: WorkerInboxV2AttachmentMaterializationSweepResult[Key];
};

function mutableSweepResult(claimedCount: number): MutableSweepResult {
  return {
    authorizationRefreshSelectedCount: 0,
    authorizationRefreshRefreshedCount: 0,
    authorizationRefreshAlreadyCurrentCount: 0,
    authorizationRefreshConflictCount: 0,
    authorizationRefreshFailureCount: 0,
    claimFailureCount: 0,
    claimedCount,
    attemptedCount: 0,
    cancelledCount: 0,
    readyCount: 0,
    visibleFallbackCount: 0,
    readyReconciledCount: 0,
    orphanRecordedCount: 0,
    orphanUnrecordedCount: 0,
    indeterminateCount: 0,
    unhandledFailureCount: 0
  };
}

function emptySweepResult(
  claimFailureCount: 0 | 1
): WorkerInboxV2AttachmentMaterializationSweepResult {
  return Object.freeze({
    ...mutableSweepResult(0),
    claimFailureCount
  });
}

function recordProcessResult(
  result: MutableSweepResult,
  processed: InboxV2AttachmentMaterializationProcessResult
): void {
  switch (processed.outcome) {
    case "cancelled":
      result.cancelledCount += 1;
      return;
    case "ready":
      result.readyCount += 1;
      return;
    case "visible_fallback":
      result.visibleFallbackCount += 1;
      return;
    case "ready_reconciled":
      result.readyReconciledCount += 1;
      return;
    case "orphan_recorded":
      result.orphanRecordedCount += 1;
      return;
    case "orphan_unrecorded":
      result.orphanUnrecordedCount += 1;
      return;
    case "indeterminate":
      result.indeterminateCount += 1;
  }
}
