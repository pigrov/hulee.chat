import {
  inboxV2BigintCounterSchema,
  inboxV2TenantIdSchema,
  type InboxV2BigintCounter,
  type InboxV2TenantId
} from "@hulee/contracts";

const DEFAULT_TENANT_PAGE_SIZE = 16;
const DEFAULT_PRUNE_BATCH_SIZE = 128;
const DEFAULT_CONCURRENCY = 2;
const DEFAULT_MINIMUM_INTERVAL_MILLISECONDS = 60_000;
const DEFAULT_FAILURE_RETRY_DELAY_MILLISECONDS = 5_000;
const DEFAULT_IDLE_DELAY_MILLISECONDS = 60_000;
const MAXIMUM_TENANT_PAGE_SIZE = 64;
const MAXIMUM_PRUNE_BATCH_SIZE = 1_000;
const MAXIMUM_CONCURRENCY = 4;
const MAXIMUM_INTERVAL_MILLISECONDS = 86_400_000;

export type SecurityDenialRetentionRepository = Readonly<{
  listRetentionTenants(input: {
    afterTenantId: InboxV2TenantId | null;
    limit: number;
  }): Promise<readonly InboxV2TenantId[]>;
  prune(input: {
    tenantId: InboxV2TenantId;
    batchSize: number;
  }): Promise<{ readonly deletedWindowCount: InboxV2BigintCounter }>;
}>;

export type SecurityDenialRetentionSweepResult = Readonly<{
  scannedTenants: number;
  prunedTenants: number;
  failedTenants: number;
  saturatedPruneTenants: number;
  deletedWindowCount: InboxV2BigintCounter;
  checkpointTenantId: InboxV2TenantId | null;
  cycleCompleted: boolean;
  throttled: boolean;
}>;

export type SecurityDenialRetentionSweeper = Readonly<{
  sweep(): Promise<SecurityDenialRetentionSweepResult>;
}>;

export type SecurityDenialRetentionBackgroundRunner = Readonly<{
  schedule(): void;
  drain(): Promise<void>;
  stop(): Promise<void>;
}>;

export type SecurityDenialRetentionBackgroundRunnerOptions = Readonly<{
  sweeper: SecurityDenialRetentionSweeper;
  onResult?: (
    result: SecurityDenialRetentionSweepResult
  ) => void | Promise<void>;
  onFailure?: (error: unknown) => void | Promise<void>;
  continuationDelayMilliseconds?: number;
  failureRetryDelayMilliseconds?: number;
  idleDelayMilliseconds?: number;
}>;

export type SecurityDenialRetentionSweeperOptions = Readonly<{
  repository: SecurityDenialRetentionRepository;
  now?: () => Date;
  tenantPageSize?: number;
  pruneBatchSize?: number;
  concurrency?: number;
  minimumIntervalMilliseconds?: number;
  onTenantFailure?: (input: {
    tenantId: InboxV2TenantId;
    error: unknown;
  }) => void | Promise<void>;
}>;

/**
 * Bounded, retryable lifecycle worker for the finite denial store. Tenant IDs
 * are keyset-paged from the canonical tenant registry, so pre-provisioned
 * reserved deployment buckets are swept alongside ordinary tenants.
 */
export function createSecurityDenialRetentionSweeper(
  options: SecurityDenialRetentionSweeperOptions
): SecurityDenialRetentionSweeper {
  const tenantPageSize = boundedInteger(
    options.tenantPageSize ?? DEFAULT_TENANT_PAGE_SIZE,
    1,
    MAXIMUM_TENANT_PAGE_SIZE,
    "security-denial retention tenant page size"
  );
  const pruneBatchSize = boundedInteger(
    options.pruneBatchSize ?? DEFAULT_PRUNE_BATCH_SIZE,
    1,
    MAXIMUM_PRUNE_BATCH_SIZE,
    "security-denial retention prune batch size"
  );
  const concurrency = boundedInteger(
    options.concurrency ?? DEFAULT_CONCURRENCY,
    1,
    MAXIMUM_CONCURRENCY,
    "security-denial retention concurrency"
  );
  const minimumIntervalMilliseconds = boundedInteger(
    options.minimumIntervalMilliseconds ??
      DEFAULT_MINIMUM_INTERVAL_MILLISECONDS,
    0,
    MAXIMUM_INTERVAL_MILLISECONDS,
    "security-denial retention minimum interval"
  );
  let checkpointTenantId: InboxV2TenantId | null = null;
  let nextScanAtMilliseconds = 0;

  return Object.freeze({
    async sweep() {
      const now = (options.now ?? (() => new Date()))();
      if (!Number.isFinite(now.getTime())) {
        throw new TypeError("Security-denial retention clock is invalid.");
      }
      if (now.getTime() < nextScanAtMilliseconds) {
        return emptyResult(true);
      }
      const tenantIds = validateTenantPage(
        await options.repository.listRetentionTenants({
          afterTenantId: checkpointTenantId,
          limit: tenantPageSize
        }),
        checkpointTenantId,
        tenantPageSize
      );

      if (tenantIds.length === 0) {
        checkpointTenantId = null;
        nextScanAtMilliseconds = now.getTime() + minimumIntervalMilliseconds;
        return emptyResult(false);
      }

      let prunedTenants = 0;
      let failedTenants = 0;
      let saturatedPruneTenants = 0;
      let deletedWindowCount = 0n;
      await processWithConcurrency(tenantIds, concurrency, async (tenantId) => {
        try {
          const result = await options.repository.prune({
            tenantId,
            batchSize: pruneBatchSize
          });
          const deletedForTenant = BigInt(
            inboxV2BigintCounterSchema.parse(result.deletedWindowCount)
          );
          if (deletedForTenant > BigInt(pruneBatchSize)) {
            throw new TypeError(
              "Security-denial retention prune exceeded its batch bound."
            );
          }
          deletedWindowCount += deletedForTenant;
          if (deletedForTenant === BigInt(pruneBatchSize)) {
            saturatedPruneTenants += 1;
          }
          prunedTenants += 1;
        } catch (error) {
          failedTenants += 1;
          notifyFailure(options.onTenantFailure, { tenantId, error });
        }
      });

      const cycleCompleted = tenantIds.length < tenantPageSize;
      checkpointTenantId = cycleCompleted
        ? null
        : tenantIds[tenantIds.length - 1]!;
      if (cycleCompleted) {
        nextScanAtMilliseconds = now.getTime() + minimumIntervalMilliseconds;
      }
      return Object.freeze({
        scannedTenants: tenantIds.length,
        prunedTenants,
        failedTenants,
        saturatedPruneTenants,
        deletedWindowCount: inboxV2BigintCounterSchema.parse(
          deletedWindowCount.toString()
        ),
        checkpointTenantId,
        cycleCompleted,
        throttled: false
      });
    }
  });
}

/** Runs at most one maintenance sweep without delaying the provider loop. */
export function createSecurityDenialRetentionBackgroundRunner(
  options: SecurityDenialRetentionBackgroundRunnerOptions
): SecurityDenialRetentionBackgroundRunner {
  const continuationDelayMilliseconds = boundedInteger(
    options.continuationDelayMilliseconds ?? 100,
    0,
    1_000,
    "security-denial retention continuation delay"
  );
  const failureRetryDelayMilliseconds = boundedInteger(
    options.failureRetryDelayMilliseconds ??
      DEFAULT_FAILURE_RETRY_DELAY_MILLISECONDS,
    0,
    MAXIMUM_INTERVAL_MILLISECONDS,
    "security-denial retention failure retry delay"
  );
  const idleDelayMilliseconds = boundedInteger(
    options.idleDelayMilliseconds ?? DEFAULT_IDLE_DELAY_MILLISECONDS,
    0,
    MAXIMUM_INTERVAL_MILLISECONDS,
    "security-denial retention idle delay"
  );
  let pending: Promise<void> | null = null;
  let nextRunTimer: ReturnType<typeof setTimeout> | null = null;
  let stopping = false;

  async function run(): Promise<SecurityDenialRetentionSweepResult | null> {
    try {
      const result = await options.sweeper.sweep();
      notifyWithoutThrowing(options.onResult, result);
      return result;
    } catch (error) {
      notifyWithoutThrowing(options.onFailure, error);
      return null;
    }
  }

  const backgroundRunner: SecurityDenialRetentionBackgroundRunner =
    Object.freeze({
      schedule() {
        if (stopping || pending !== null || nextRunTimer !== null) return;
        let nextDelayMilliseconds = failureRetryDelayMilliseconds;
        const current = run()
          .then((result) => {
            nextDelayMilliseconds =
              result === null
                ? failureRetryDelayMilliseconds
                : !result.throttled && !result.cycleCompleted
                  ? continuationDelayMilliseconds
                  : idleDelayMilliseconds;
          })
          .finally(() => {
            if (pending === current) pending = null;
            if (!stopping) {
              nextRunTimer = setTimeout(() => {
                nextRunTimer = null;
                backgroundRunner.schedule();
              }, nextDelayMilliseconds);
            }
          });
        pending = current;
        void current;
      },
      async drain() {
        await pending;
      },
      async stop() {
        stopping = true;
        if (nextRunTimer !== null) {
          clearTimeout(nextRunTimer);
          nextRunTimer = null;
        }
        await pending;
      }
    });

  return backgroundRunner;
}

function emptyResult(throttled: boolean): SecurityDenialRetentionSweepResult {
  return Object.freeze({
    scannedTenants: 0,
    prunedTenants: 0,
    failedTenants: 0,
    saturatedPruneTenants: 0,
    deletedWindowCount: inboxV2BigintCounterSchema.parse("0"),
    checkpointTenantId: null,
    cycleCompleted: true,
    throttled
  });
}

function validateTenantPage(
  tenantIdInputs: readonly InboxV2TenantId[],
  afterTenantId: InboxV2TenantId | null,
  limit: number
): readonly InboxV2TenantId[] {
  if (tenantIdInputs.length > limit) {
    throw new TypeError(
      "Security-denial retention repository exceeded its tenant page bound."
    );
  }
  const tenantIds = tenantIdInputs.map((tenantId) =>
    inboxV2TenantIdSchema.parse(tenantId)
  );
  const seenTenantIds = new Set<InboxV2TenantId>();
  if (afterTenantId !== null) seenTenantIds.add(afterTenantId);
  for (const tenantId of tenantIds) {
    if (seenTenantIds.has(tenantId)) {
      throw new TypeError(
        "Security-denial retention tenant page repeats a keyset identity."
      );
    }
    seenTenantIds.add(tenantId);
  }
  return Object.freeze(tenantIds);
}

async function processWithConcurrency<T>(
  values: readonly T[],
  concurrency: number,
  process: (value: T) => Promise<void>
): Promise<void> {
  let nextIndex = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (nextIndex < values.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        await process(values[currentIndex]!);
      }
    })
  );
}

function notifyFailure(
  callback: SecurityDenialRetentionSweeperOptions["onTenantFailure"],
  input: { tenantId: InboxV2TenantId; error: unknown }
): void {
  if (callback === undefined) return;
  try {
    void Promise.resolve(callback(input)).catch(() => {});
  } catch {
    // Operational telemetry must not stop retention progress for other tenants.
  }
}

function notifyWithoutThrowing<T>(
  callback: ((value: T) => void | Promise<void>) | undefined,
  value: T
): void {
  if (callback === undefined) return;
  try {
    void Promise.resolve(callback(value)).catch(() => {});
  } catch {
    // Logging/metrics callbacks cannot reject the tracked maintenance task.
  }
}

function boundedInteger(
  value: number,
  minimum: number,
  maximum: number,
  label: string
): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${label} must be between ${minimum} and ${maximum}.`);
  }
  return value;
}
