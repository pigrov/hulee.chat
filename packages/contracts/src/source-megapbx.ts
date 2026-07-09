import type {
  NormalizedInboundEvent,
  NormalizedInboundEventId,
  RawInboundEvent,
  RawInboundEventId,
  SourceAccountId,
  SourceConnectionId,
  SourceEventDirection,
  SourceEventType,
  TenantId
} from "./index";
import {
  createNormalizedSourceIdempotencyKey,
  createRawSourceIdempotencyKey
} from "./source-idempotency";
import {
  normalizeSourceConversationResolverInput,
  type SourceConversationResolverInput
} from "./source-conversation";
import {
  normalizeSourceIdentityResolverInput,
  type SourceIdentityResolverInput
} from "./source-identity";

export type MegapbxWebhookPayload = Record<string, unknown>;

export type MegapbxWebhookParseInput = {
  body: unknown;
  headers?: Record<string, unknown>;
  contentType?: string | null;
};

export type MegapbxParsedWebhook = {
  payload: MegapbxWebhookPayload;
  cmd: string;
  eventType: string;
  eventId?: string;
  token?: string;
};

export type CreateMegapbxRawInboundEventInput = {
  id: RawInboundEventId | string;
  tenantId: TenantId | string;
  sourceConnectionId: SourceConnectionId | string;
  sourceAccountId?: SourceAccountId | string | null;
  body: unknown;
  headers?: Record<string, unknown>;
  contentType?: string | null;
  receivedAt: Date | string;
};

export type CreateMegapbxRawInboundEventResult = {
  rawEvent: RawInboundEvent;
  parsedWebhook: MegapbxParsedWebhook;
};

export type MegapbxNormalizedWebhookEvent = {
  normalizedEvent: NormalizedInboundEvent;
  identityResolverInput?: SourceIdentityResolverInput;
  conversationResolverInput?: SourceConversationResolverInput;
};

export type MegapbxWebhookNormalizationResult = {
  parsedWebhook: MegapbxParsedWebhook;
  events: MegapbxNormalizedWebhookEvent[];
  ignoredReason?: "unsupported_command";
};

export class MegapbxWebhookParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MegapbxWebhookParseError";
  }
}

export class MegapbxWebhookNormalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MegapbxWebhookNormalizationError";
  }
}

export function parseMegapbxWebhook(
  input: MegapbxWebhookParseInput | unknown
): MegapbxParsedWebhook {
  const parseInput = isWebhookParseInput(input) ? input : { body: input };
  const payload = parseMegapbxWebhookBody(
    parseInput.body,
    parseInput.contentType
  );
  const cmd = readString(payload.cmd)?.toLowerCase();

  if (!cmd) {
    throw new MegapbxWebhookParseError("MegaPBX webhook cmd is required.");
  }

  const type = readString(payload.type) ?? undefined;
  const eventType = type ? `${cmd}.${type}` : cmd;
  const eventId = buildMegapbxEventId({ cmd, type, payload });
  const token =
    readString(payload.crm_token) ??
    readHeaderString(parseInput.headers, "x-webhook-token") ??
    readHeaderString(parseInput.headers, "x-api-key") ??
    readHeaderString(parseInput.headers, "webhook_token");

  return {
    payload,
    cmd,
    eventType,
    ...(eventId ? { eventId } : {}),
    ...(token ? { token } : {})
  };
}

export function createMegapbxRawInboundEvent(
  input: CreateMegapbxRawInboundEventInput
): CreateMegapbxRawInboundEventResult {
  const parsedWebhook = parseMegapbxWebhook(input);
  const receivedAt = toIsoTimestamp(input.receivedAt);
  const providerTimestamp =
    parseMegapbxTimestamp(readString(parsedWebhook.payload.start)) ?? undefined;

  if (!parsedWebhook.eventId) {
    throw new MegapbxWebhookNormalizationError(
      "MegaPBX webhook event id is required for raw event idempotency."
    );
  }

  const rawEvent: RawInboundEvent = {
    id: String(input.id) as RawInboundEventId,
    tenantId: String(input.tenantId) as TenantId,
    sourceConnectionId: String(input.sourceConnectionId) as SourceConnectionId,
    ...(input.sourceAccountId
      ? { sourceAccountId: String(input.sourceAccountId) as SourceAccountId }
      : {}),
    externalEventId: parsedWebhook.eventId,
    idempotencyKey: createRawSourceIdempotencyKey({
      transport: "webhook",
      sourceConnectionId: input.sourceConnectionId,
      sourceAccountId: input.sourceAccountId,
      externalEventId: parsedWebhook.eventId
    }),
    receivedAt,
    ...(providerTimestamp ? { providerTimestamp } : {}),
    payload: parsedWebhook.payload,
    ...(input.headers ? { headers: normalizeHeaders(input.headers) } : {}),
    processingStatus: "new",
    createdAt: receivedAt,
    updatedAt: receivedAt
  };

  return {
    rawEvent,
    parsedWebhook
  };
}

export function normalizeMegapbxWebhookRawEvent(input: {
  rawEvent: RawInboundEvent;
  parsedWebhook?: MegapbxParsedWebhook;
  normalizedEventId?: NormalizedInboundEventId | string;
  now?: Date | string;
}): MegapbxWebhookNormalizationResult {
  const parsedWebhook =
    input.parsedWebhook ??
    parseMegapbxWebhook({
      body: input.rawEvent.payload,
      headers: input.rawEvent.headers
    });

  if (!isMegapbxSupportedCommand(parsedWebhook.cmd)) {
    return {
      parsedWebhook,
      events: [],
      ignoredReason: "unsupported_command"
    };
  }

  const eventType = sourceEventTypeForMegapbxCommand(parsedWebhook.cmd);
  const call = extractMegapbxCallFields(parsedWebhook);
  const now = toIsoTimestamp(input.now ?? input.rawEvent.receivedAt);
  const occurredAt =
    input.rawEvent.providerTimestamp ??
    call.startedAt ??
    input.rawEvent.receivedAt;
  const normalizedEventId = String(
    input.normalizedEventId ??
      `norm_${String(input.rawEvent.id).replace(/^raw_/, "")}`
  ) as NormalizedInboundEventId;

  const normalizedEvent: NormalizedInboundEvent = {
    id: normalizedEventId,
    rawEventId: input.rawEvent.id,
    tenantId: input.rawEvent.tenantId,
    sourceConnectionId: input.rawEvent.sourceConnectionId,
    ...(input.rawEvent.sourceAccountId
      ? { sourceAccountId: input.rawEvent.sourceAccountId }
      : {}),
    sourceType: "phone",
    sourceName: "megapbx",
    eventType,
    direction: call.direction,
    visibility: "private",
    ...(call.callId ? { externalThreadId: call.callId } : {}),
    ...(parsedWebhook.eventId
      ? { externalMessageId: parsedWebhook.eventId }
      : {}),
    ...(call.clientPhone ? { externalUserId: call.clientPhone } : {}),
    payloadVersion: "v1",
    normalizedPayload: compactRecord({
      provider: "megapbx",
      providerEventType: parsedWebhook.eventType,
      command: parsedWebhook.cmd,
      callId: call.callId,
      callType: call.callType,
      direction: call.direction,
      status: call.status,
      occurredAt,
      startedAt: call.startedAt,
      durationSeconds: call.durationSeconds,
      waitSeconds: call.waitSeconds,
      clientPhone: call.clientPhone,
      destinationPhone: call.destinationPhone,
      diversionPhone: call.diversionPhone,
      employeeExtension: call.employeeExtension,
      operatorLogin: call.operatorLogin,
      operatorName: call.operatorName,
      recordingUrl: call.recordingUrl
    }),
    replyCapability: {
      mode: "readonly",
      reason: "telephony_call_event"
    },
    idempotencyKey: createNormalizedSourceIdempotencyKey({
      transport: "webhook",
      sourceConnectionId: input.rawEvent.sourceConnectionId,
      sourceAccountId: input.rawEvent.sourceAccountId,
      sourceEventType: eventType,
      externalEventId: parsedWebhook.eventId
    }),
    processingStatus: "new",
    createdAt: now,
    updatedAt: now
  };

  return {
    parsedWebhook,
    events: [
      {
        normalizedEvent,
        ...buildMegapbxResolverInputs({
          normalizedEvent,
          rawEvent: input.rawEvent,
          occurredAt,
          call
        })
      }
    ]
  };
}

export function parseMegapbxTimestamp(value: unknown): string | null {
  const text = readString(value);

  if (!text) {
    return null;
  }

  const compact = text.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);

  if (compact) {
    const [, year, month, day, hour, minute, second] = compact;
    return new Date(
      Date.UTC(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute),
        Number(second)
      )
    ).toISOString();
  }

  const parsed = new Date(text);

  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function parseMegapbxWebhookBody(
  body: unknown,
  contentType?: string | null
): MegapbxWebhookPayload {
  if (isRecord(body)) {
    return body;
  }

  const text = bodyToText(body).trim();

  if (!text) {
    throw new MegapbxWebhookParseError("MegaPBX webhook body is empty.");
  }

  const normalizedContentType = contentType?.toLowerCase() ?? "";

  if (normalizedContentType.includes("application/x-www-form-urlencoded")) {
    return parseFormPayload(text);
  }

  if (normalizedContentType.includes("application/json")) {
    return parseJsonPayload(text);
  }

  try {
    return parseJsonPayload(text);
  } catch {
    return parseFormPayload(text);
  }
}

function parseJsonPayload(text: string): MegapbxWebhookPayload {
  const parsed: unknown = JSON.parse(text);

  if (!isRecord(parsed)) {
    throw new MegapbxWebhookParseError(
      "MegaPBX JSON webhook body must be an object."
    );
  }

  return parsed;
}

function parseFormPayload(text: string): MegapbxWebhookPayload {
  return Object.fromEntries(new URLSearchParams(text));
}

function bodyToText(body: unknown): string {
  if (typeof body === "string") {
    return body;
  }

  if (body instanceof ArrayBuffer) {
    return new TextDecoder().decode(body);
  }

  if (ArrayBuffer.isView(body)) {
    return new TextDecoder().decode(body);
  }

  throw new MegapbxWebhookParseError(
    "MegaPBX webhook body must be an object, string or binary buffer."
  );
}

function isWebhookParseInput(
  input: MegapbxWebhookParseInput | unknown
): input is MegapbxWebhookParseInput {
  return isRecord(input) && "body" in input;
}

function buildMegapbxEventId(input: {
  cmd: string;
  type?: string;
  payload: MegapbxWebhookPayload;
}): string | undefined {
  const base =
    input.cmd === "webhook"
      ? readString(input.payload.id)
      : (readString(input.payload.callid) ?? readString(input.payload.callId));

  if (!base) {
    return undefined;
  }

  return input.type ? `${base}:${input.type}` : base;
}

function extractMegapbxCallFields(parsed: MegapbxParsedWebhook): {
  callId?: string;
  callType?: string;
  direction: SourceEventDirection;
  status?: string;
  startedAt?: string;
  durationSeconds?: number;
  waitSeconds?: number;
  clientPhone?: string;
  destinationPhone?: string;
  diversionPhone?: string;
  employeeExtension?: string;
  operatorLogin?: string;
  operatorName?: string;
  recordingUrl?: string;
} {
  const payload = parsed.payload;
  const callType = readString(payload.type);
  const clientPhone = normalizeMegapbxPhone(
    readString(payload.phone) ?? readString(payload.client)
  );
  const recordUrl = readString(payload.record) ?? readString(payload.link);
  const startedAt = parseMegapbxTimestamp(readString(payload.start));
  const durationSeconds = parseInteger(payload.duration);
  const waitSeconds = parseInteger(payload.wait);
  const destinationPhone = normalizeMegapbxPhone(readString(payload.telnum));
  const diversionPhone = normalizeMegapbxPhone(readString(payload.diversion));
  const employeeExtension = readString(payload.ext);
  const operatorLogin = readString(payload.user);
  const operatorName = readString(payload.user_name);

  return {
    callId:
      readString(payload.callid) ?? readString(payload.callId) ?? undefined,
    ...(callType ? { callType } : {}),
    direction: directionFromMegapbxPayload(parsed),
    status: readString(payload.status) ?? statusFromMegapbxType(callType),
    ...(startedAt ? { startedAt } : {}),
    ...(durationSeconds !== null ? { durationSeconds } : {}),
    ...(waitSeconds !== null ? { waitSeconds } : {}),
    ...(clientPhone ? { clientPhone } : {}),
    ...(destinationPhone ? { destinationPhone } : {}),
    ...(diversionPhone ? { diversionPhone } : {}),
    ...(employeeExtension ? { employeeExtension } : {}),
    ...(operatorLogin ? { operatorLogin } : {}),
    ...(operatorName ? { operatorName } : {}),
    ...(recordUrl ? { recordingUrl: recordUrl } : {})
  };
}

function buildMegapbxResolverInputs(input: {
  normalizedEvent: NormalizedInboundEvent;
  rawEvent: RawInboundEvent;
  occurredAt: string;
  call: ReturnType<typeof extractMegapbxCallFields>;
}): {
  identityResolverInput?: SourceIdentityResolverInput;
  conversationResolverInput?: SourceConversationResolverInput;
} {
  if (!input.call.callId && !input.call.clientPhone) {
    return {};
  }

  const identityResolverInput = input.call.clientPhone
    ? normalizeSourceIdentityResolverInput({
        tenantId: input.rawEvent.tenantId,
        sourceConnectionId: input.rawEvent.sourceConnectionId,
        sourceAccountId: input.rawEvent.sourceAccountId,
        sourceType: "phone",
        sourceName: "megapbx",
        sourceEventType: input.normalizedEvent.eventType,
        sourceVisibility: input.normalizedEvent.visibility,
        externalThreadId: input.call.callId,
        externalUserId: input.call.clientPhone,
        rawEventId: input.rawEvent.id,
        normalizedEventId: input.normalizedEvent.id,
        occurredAt: input.occurredAt,
        candidates: [
          {
            kind: "phone",
            value: input.call.clientPhone,
            confidence: "verified",
            sourceField: "phone"
          }
        ],
        profileSnapshot: compactRecord({
          phone: input.call.clientPhone
        })
      })
    : undefined;

  const conversationResolverInput = input.call.callId
    ? normalizeSourceConversationResolverInput({
        tenantId: input.rawEvent.tenantId,
        sourceConnectionId: input.rawEvent.sourceConnectionId,
        sourceAccountId: input.rawEvent.sourceAccountId,
        sourceType: "phone",
        sourceName: "megapbx",
        sourceEventType: input.normalizedEvent.eventType,
        sourceVisibility: input.normalizedEvent.visibility,
        rawEventId: input.rawEvent.id,
        normalizedEventId: input.normalizedEvent.id,
        occurredAt: input.occurredAt,
        conversationTypeHint: "client_direct",
        externalThreadId: input.call.callId,
        externalMessageId: input.normalizedEvent.externalMessageId,
        title: "MegaPBX call",
        keyCandidates: [
          {
            kind: "call",
            value: input.call.callId,
            strength: "exact",
            sourceField: "callid"
          }
        ],
        eventPayload: input.normalizedEvent.normalizedPayload
      })
    : undefined;

  return {
    ...(identityResolverInput ? { identityResolverInput } : {}),
    ...(conversationResolverInput ? { conversationResolverInput } : {})
  };
}

function sourceEventTypeForMegapbxCommand(cmd: string): SourceEventType {
  return cmd === "contact" || cmd === "rating" ? "status_update" : "call";
}

function isMegapbxSupportedCommand(cmd: string): boolean {
  return ["contact", "event", "history", "rating", "webhook"].includes(cmd);
}

function directionFromMegapbxPayload(
  parsed: MegapbxParsedWebhook
): SourceEventDirection {
  const payloadDirection = readString(parsed.payload.direction);
  const type = readString(parsed.payload.type);
  const value = (payloadDirection ?? type ?? "").toLowerCase();

  if (["in", "incoming", "inbound"].includes(value)) {
    return "inbound";
  }

  if (["out", "outgoing", "outbound"].includes(value)) {
    return "outbound";
  }

  return "system";
}

function statusFromMegapbxType(value: string | null): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.toLowerCase();

  if (
    ["accepted", "completed", "cancelled", "incoming", "outgoing"].includes(
      normalized
    )
  ) {
    return normalized;
  }

  return undefined;
}

function normalizeMegapbxPhone(value: string | null): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return undefined;
  }

  const digits = trimmed.replace(/\D/g, "");

  if (!digits) {
    return trimmed;
  }

  return trimmed.startsWith("+") ? `+${digits}` : digits;
}

function parseInteger(value: unknown): number | null {
  const text = readString(value);

  if (!text) {
    return null;
  }

  const parsed = Number.parseInt(text, 10);

  return Number.isFinite(parsed) ? parsed : null;
}

function toIsoTimestamp(value: Date | string): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    throw new MegapbxWebhookNormalizationError(
      "Timestamp must be a valid ISO date."
    );
  }

  return parsed.toISOString();
}

function readHeaderString(
  headers: Record<string, unknown> | undefined,
  name: string
): string | undefined {
  if (!headers) {
    return undefined;
  }

  const normalizedName = name.toLowerCase();

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === normalizedName) {
      return readString(Array.isArray(value) ? value[0] : value) ?? undefined;
    }
  }

  return undefined;
}

function normalizeHeaders(
  headers: Record<string, unknown>
): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(headers)) {
    normalized[key.toLowerCase()] = value;
  }

  return normalized;
}

function compactRecord(
  record: Record<string, unknown | undefined>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined)
  );
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
