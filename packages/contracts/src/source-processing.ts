import { z } from "zod";

import type {
  NormalizedInboundEventId,
  PlatformErrorCode,
  RawInboundEventId,
  Retryability,
  SourceAccountId,
  SourceConnectionId,
  SourceEventProcessingStatus,
  TenantId
} from "./index";

export const sourceProcessingStageSchema = z.enum([
  "raw_ingest",
  "normalization",
  "identity_resolution",
  "conversation_resolution",
  "routing",
  "materialization",
  "outbound_reply"
]);

export const sourceProcessingOutcomeSchema = z.enum([
  "succeeded",
  "failed",
  "ignored",
  "duplicate"
]);

export const sourceProcessingDecisionActionSchema = z.enum([
  "retry",
  "send_to_dlq",
  "ignore",
  "mark_duplicate",
  "mark_processed"
]);

export const sourceReplayReasonSchema = z.enum([
  "operator_requested",
  "adapter_fixed",
  "provider_recovered",
  "configuration_fixed",
  "backfill",
  "support_requested"
]);

export const sourceReplayModeSchema = z.enum([
  "raw_event",
  "normalized_event",
  "from_dlq"
]);

export const sourceReplayRequestSchema = z
  .object({
    tenantId: z.string().trim().min(1),
    sourceConnectionId: z.string().trim().min(1),
    sourceAccountId: z.string().trim().min(1).optional(),
    rawEventId: z.string().trim().min(1).optional(),
    normalizedEventId: z.string().trim().min(1).optional(),
    mode: sourceReplayModeSchema,
    reason: sourceReplayReasonSchema,
    requestedByEmployeeId: z.string().trim().min(1).optional(),
    requestedAt: z.string().datetime({ offset: true }),
    idempotencyKey: z.string().trim().min(1).max(512),
    forceReprocess: z.boolean().default(false),
    metadata: z.record(z.string(), z.unknown()).optional()
  })
  .strict()
  .refine((value) => value.rawEventId || value.normalizedEventId, {
    message: "Replay requires rawEventId or normalizedEventId."
  });

export const sourceProcessingDiagnosticsSchema = z
  .object({
    tenantId: z.string().trim().min(1),
    sourceConnectionId: z.string().trim().min(1),
    sourceAccountId: z.string().trim().min(1).optional(),
    rawEventId: z.string().trim().min(1).optional(),
    normalizedEventId: z.string().trim().min(1).optional(),
    stage: sourceProcessingStageSchema,
    outcome: sourceProcessingOutcomeSchema,
    attempt: z.number().int().min(1),
    maxAttempts: z.number().int().min(1),
    checkedAt: z.string().datetime({ offset: true }),
    errorCode: platformErrorCodeSchema().optional(),
    retryability: z.enum(["retryable", "not_retryable", "unknown"]),
    nextAttemptAt: z.string().datetime({ offset: true }).optional(),
    dlqAt: z.string().datetime({ offset: true }).optional(),
    replayable: z.boolean(),
    operatorHint: z.string().trim().min(1).max(500).optional(),
    safeDetails: z.record(z.string(), z.unknown()).optional()
  })
  .strict();

export const sourceProcessingDecisionSchema = z
  .object({
    action: sourceProcessingDecisionActionSchema,
    processingStatus: z.enum([
      "new",
      "processed",
      "failed",
      "ignored",
      "duplicate"
    ]),
    replayable: z.boolean(),
    retryability: z.enum(["retryable", "not_retryable", "unknown"]),
    nextAttemptAt: z.string().datetime({ offset: true }).optional(),
    dlqReason: z.string().trim().min(1).max(240).optional(),
    diagnostics: sourceProcessingDiagnosticsSchema
  })
  .strict();

export type SourceProcessingStage = z.infer<typeof sourceProcessingStageSchema>;

export type SourceProcessingOutcome = z.infer<
  typeof sourceProcessingOutcomeSchema
>;

export type SourceProcessingDecisionAction = z.infer<
  typeof sourceProcessingDecisionActionSchema
>;

export type SourceReplayReason = z.infer<typeof sourceReplayReasonSchema>;

export type SourceReplayMode = z.infer<typeof sourceReplayModeSchema>;

export type SourceReplayRequest = z.infer<typeof sourceReplayRequestSchema>;

export type SourceProcessingDiagnostics = z.infer<
  typeof sourceProcessingDiagnosticsSchema
>;

export type SourceProcessingDecision = z.infer<
  typeof sourceProcessingDecisionSchema
>;

export type DecideSourceProcessingInput = {
  tenantId: TenantId | string;
  sourceConnectionId: SourceConnectionId | string;
  sourceAccountId?: SourceAccountId | string | null;
  rawEventId?: RawInboundEventId | string | null;
  normalizedEventId?: NormalizedInboundEventId | string | null;
  stage: SourceProcessingStage;
  outcome?: SourceProcessingOutcome;
  attempt?: number;
  maxAttempts?: number;
  checkedAt: Date | string;
  errorCode?: PlatformErrorCode | string | null;
  retryability?: Retryability;
  retryAfterSeconds?: number | null;
  processingStatus?: SourceEventProcessingStatus | string | null;
  operatorHint?: string | null;
  safeDetails?: Record<string, unknown> | null;
};

export function decideSourceProcessing(
  input: DecideSourceProcessingInput
): SourceProcessingDecision {
  const attempt = input.attempt ?? 1;
  const maxAttempts = input.maxAttempts ?? 5;
  const checkedAt = normalizeTimestamp(input.checkedAt);
  const errorCode = normalizePlatformErrorCode(input.errorCode);
  const retryability =
    input.retryability ?? retryabilityForPlatformErrorCode(errorCode);
  const outcome =
    input.outcome ??
    outcomeFromProcessingStatus(input.processingStatus) ??
    (errorCode ? "failed" : "succeeded");

  if (outcome === "duplicate") {
    return buildDecision({
      input,
      action: "mark_duplicate",
      processingStatus: "duplicate",
      outcome,
      attempt,
      maxAttempts,
      checkedAt,
      errorCode,
      retryability: "not_retryable",
      replayable: false
    });
  }

  if (outcome === "ignored") {
    return buildDecision({
      input,
      action: "ignore",
      processingStatus: "ignored",
      outcome,
      attempt,
      maxAttempts,
      checkedAt,
      errorCode,
      retryability: "not_retryable",
      replayable: false
    });
  }

  if (outcome === "succeeded") {
    return buildDecision({
      input,
      action: "mark_processed",
      processingStatus: "processed",
      outcome,
      attempt,
      maxAttempts,
      checkedAt,
      errorCode,
      retryability: "not_retryable",
      replayable: false
    });
  }

  if (shouldRetry({ retryability, attempt, maxAttempts })) {
    const nextAttemptAt = addSeconds(
      checkedAt,
      retryDelaySeconds(input.retryAfterSeconds, attempt)
    );

    return buildDecision({
      input,
      action: "retry",
      processingStatus: "failed",
      outcome,
      attempt,
      maxAttempts,
      checkedAt,
      errorCode,
      retryability,
      replayable: true,
      nextAttemptAt
    });
  }

  return buildDecision({
    input,
    action: "send_to_dlq",
    processingStatus: "failed",
    outcome,
    attempt,
    maxAttempts,
    checkedAt,
    errorCode,
    retryability,
    replayable: true,
    dlqAt: checkedAt,
    dlqReason: sourceDlqReason({
      errorCode,
      retryability,
      attempt,
      maxAttempts
    })
  });
}

export function sanitizeSourceDiagnosticDetails(
  details: Record<string, unknown> | null | undefined
): Record<string, unknown> | undefined {
  if (!details) {
    return undefined;
  }

  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(details)) {
    if (isSensitiveDiagnosticKey(key)) {
      sanitized[key] = "[redacted]";
      continue;
    }

    sanitized[key] = sanitizeDiagnosticValue(value);
  }

  return sanitized;
}

function buildDecision(input: {
  input: DecideSourceProcessingInput;
  action: SourceProcessingDecisionAction;
  processingStatus: SourceEventProcessingStatus;
  outcome: SourceProcessingOutcome;
  attempt: number;
  maxAttempts: number;
  checkedAt: string;
  errorCode?: PlatformErrorCode;
  retryability: Retryability;
  replayable: boolean;
  nextAttemptAt?: string;
  dlqAt?: string;
  dlqReason?: string;
}): SourceProcessingDecision {
  return sourceProcessingDecisionSchema.parse({
    action: input.action,
    processingStatus: input.processingStatus,
    replayable: input.replayable,
    retryability: input.retryability,
    ...(input.nextAttemptAt ? { nextAttemptAt: input.nextAttemptAt } : {}),
    ...(input.dlqReason ? { dlqReason: input.dlqReason } : {}),
    diagnostics: {
      tenantId: String(input.input.tenantId),
      sourceConnectionId: String(input.input.sourceConnectionId),
      ...(input.input.sourceAccountId
        ? { sourceAccountId: String(input.input.sourceAccountId) }
        : {}),
      ...(input.input.rawEventId
        ? { rawEventId: String(input.input.rawEventId) }
        : {}),
      ...(input.input.normalizedEventId
        ? { normalizedEventId: String(input.input.normalizedEventId) }
        : {}),
      stage: input.input.stage,
      outcome: input.outcome,
      attempt: input.attempt,
      maxAttempts: input.maxAttempts,
      checkedAt: input.checkedAt,
      ...(input.errorCode ? { errorCode: input.errorCode } : {}),
      retryability: input.retryability,
      ...(input.nextAttemptAt ? { nextAttemptAt: input.nextAttemptAt } : {}),
      ...(input.dlqAt ? { dlqAt: input.dlqAt } : {}),
      replayable: input.replayable,
      ...(input.input.operatorHint
        ? { operatorHint: input.input.operatorHint }
        : {}),
      ...(input.input.safeDetails
        ? {
            safeDetails: sanitizeSourceDiagnosticDetails(
              input.input.safeDetails
            )
          }
        : {})
    }
  });
}

function shouldRetry(input: {
  retryability: Retryability;
  attempt: number;
  maxAttempts: number;
}): boolean {
  if (input.attempt >= input.maxAttempts) {
    return false;
  }

  return input.retryability === "retryable" || input.retryability === "unknown";
}

function retryDelaySeconds(
  retryAfterSeconds: number | null | undefined,
  attempt: number
): number {
  if (typeof retryAfterSeconds === "number" && retryAfterSeconds > 0) {
    return Math.floor(retryAfterSeconds);
  }

  return Math.min(3600, 30 * 2 ** Math.max(0, attempt - 1));
}

function sourceDlqReason(input: {
  errorCode?: PlatformErrorCode;
  retryability: Retryability;
  attempt: number;
  maxAttempts: number;
}): string {
  if (input.attempt >= input.maxAttempts) {
    return `Attempts exhausted (${input.attempt}/${input.maxAttempts}).`;
  }

  if (input.errorCode) {
    return `Not retryable: ${input.errorCode}.`;
  }

  return `Not retryable: ${input.retryability}.`;
}

function outcomeFromProcessingStatus(
  status: SourceEventProcessingStatus | string | null | undefined
): SourceProcessingOutcome | undefined {
  switch (status) {
    case "processed":
      return "succeeded";
    case "failed":
      return "failed";
    case "ignored":
      return "ignored";
    case "duplicate":
      return "duplicate";
    case "new":
    default:
      return undefined;
  }
}

function retryabilityForPlatformErrorCode(
  errorCode: PlatformErrorCode | undefined
): Retryability {
  if (!errorCode) {
    return "unknown";
  }

  switch (errorCode) {
    case "module.unhealthy":
    case "provider.temporary_failure":
      return "retryable";
    case "auth.invalid_credentials":
    case "auth.email_not_verified":
    case "auth.rate_limited":
    case "entitlement.missing":
    case "license.inactive":
    case "permission.denied":
    case "tenant.not_found":
    case "tenant.boundary_violation":
    case "module.disabled":
    case "usage.limit_exceeded":
    case "provider.permanent_failure":
    case "validation.failed":
      return "not_retryable";
  }
}

function normalizePlatformErrorCode(
  code: PlatformErrorCode | string | null | undefined
): PlatformErrorCode | undefined {
  if (!code || !isPlatformErrorCodeLiteral(code)) {
    return undefined;
  }

  return code;
}

function isPlatformErrorCodeLiteral(code: string): code is PlatformErrorCode {
  return platformErrorCodeSchema().safeParse(code).success;
}

function platformErrorCodeSchema() {
  return z.enum([
    "auth.invalid_credentials",
    "auth.email_not_verified",
    "auth.rate_limited",
    "entitlement.missing",
    "license.inactive",
    "permission.denied",
    "tenant.not_found",
    "tenant.boundary_violation",
    "module.disabled",
    "module.unhealthy",
    "usage.limit_exceeded",
    "provider.temporary_failure",
    "provider.permanent_failure",
    "validation.failed"
  ] satisfies [PlatformErrorCode, ...PlatformErrorCode[]]);
}

function normalizeTimestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function addSeconds(isoTimestamp: string, seconds: number): string {
  return new Date(Date.parse(isoTimestamp) + seconds * 1000).toISOString();
}

function isSensitiveDiagnosticKey(key: string): boolean {
  return /token|secret|password|authorization|cookie|payload|headers/i.test(
    key
  );
}

function sanitizeDiagnosticValue(value: unknown): unknown {
  if (typeof value === "string") {
    return value.length > 500 ? `${value.slice(0, 500)}...` : value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeDiagnosticValue(entry));
  }

  if (value && typeof value === "object") {
    return sanitizeSourceDiagnosticDetails(value as Record<string, unknown>);
  }

  return value;
}
