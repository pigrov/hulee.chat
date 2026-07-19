import {
  createHmac,
  randomBytes as nodeRandomBytes,
  timingSafeEqual
} from "node:crypto";

import {
  evaluateInboxV2FileView,
  type InboxV2FileAccessSnapshot,
  type InboxV2FileObjectPin,
  type InboxV2FileParentFence
} from "@hulee/core";
import type { HuleeSha256 } from "@hulee/storage";

const TICKET_VERSION = 1 as const;
const MIN_SECRET_BYTES = 32;
const MAX_TTL_SECONDS = 300;
const MAX_TICKET_LENGTH = 32_768;
const MAX_OPAQUE_VALUE_LENGTH = 2_048;
const TICKET_PAYLOAD_KEYS = [
  "v",
  "tenantId",
  "principalId",
  "authorizationEpoch",
  "pin",
  "parentFence",
  "issuedAtMs",
  "expiresAtMs",
  "nonce"
] as const;
const FILE_PIN_KEYS = [
  "tenantId",
  "fileId",
  "fileRevision",
  "fileVersionId",
  "objectVersionId"
] as const;
const PARENT_FENCE_KEYS = [
  "pin",
  "parentLinkId",
  "parentLinkRevision",
  "parentId",
  "parentRevision",
  "contentRevision",
  "blockKey"
] as const;

export type InboxV2FileDownloadPrincipalIdentity = Readonly<{
  tenantId: string;
  principalId: string;
}>;

/** @deprecated Use InboxV2FileDownloadPrincipalIdentity. */
export type InboxV2FileDownloadPrincipal = InboxV2FileDownloadPrincipalIdentity;

export type InboxV2FileDownloadAccessRecord = Readonly<{
  currentAuthorizationEpoch: string;
  snapshot: InboxV2FileAccessSnapshot;
  storageRootId: string;
  storageKey: string;
  storageVersionId: string;
  checksumSha256: HuleeSha256;
  fileName: string;
  mediaType: string;
  sizeBytes: number;
}>;

export type InboxV2FileDownloadAccessRepository = Readonly<{
  loadCurrentAccess(
    input: Readonly<{
      principal: InboxV2FileDownloadPrincipalIdentity;
      pin: InboxV2FileObjectPin;
      parentLinkId: string;
    }>
  ): Promise<InboxV2FileDownloadAccessRecord | null>;
}>;

export type InboxV2FileDownloadTicketErrorCode =
  | "ticket_invalid"
  | "ticket_expired"
  | "ticket_principal_mismatch"
  | "ticket_authorization_stale"
  | "file_access_denied"
  | "file_state_changed"
  | "file_unavailable";

export class InboxV2FileDownloadTicketError extends Error {
  readonly code: InboxV2FileDownloadTicketErrorCode;

  constructor(code: InboxV2FileDownloadTicketErrorCode) {
    super(code);
    this.name = "InboxV2FileDownloadTicketError";
    this.code = code;
  }
}

export type InboxV2FileDownloadTicketService = Readonly<{
  issue(
    principal: InboxV2FileDownloadPrincipalIdentity,
    input: Readonly<{
      pin: InboxV2FileObjectPin;
      parentLinkId: string;
    }>
  ): Promise<
    Readonly<{ ticket: string; downloadUrl: string; expiresAt: string }>
  >;
  redeem(
    principal: InboxV2FileDownloadPrincipalIdentity,
    input: Readonly<{ ticket: string }>
  ): Promise<
    Readonly<{
      pin: InboxV2FileObjectPin;
      parentFence: InboxV2FileParentFence;
      storageRootId: string;
      storageKey: string;
      storageVersionId: string;
      checksumSha256: HuleeSha256;
      fileName: string;
      mediaType: string;
      sizeBytes: number;
    }>
  >;
}>;

export type InboxV2FileDownloadTicketServiceOptions = Readonly<{
  repository: InboxV2FileDownloadAccessRepository;
  secret: string | Uint8Array;
  ttlSeconds?: number;
  downloadPath?: string;
  now?: () => Date;
  nonce?: () => string;
}>;

type TicketPayload = Readonly<{
  v: typeof TICKET_VERSION;
  tenantId: string;
  principalId: string;
  authorizationEpoch: string;
  pin: InboxV2FileObjectPin;
  parentFence: InboxV2FileParentFence;
  issuedAtMs: number;
  expiresAtMs: number;
  nonce: string;
}>;

/**
 * Issues opaque, short-lived application tickets. The ticket never contains a
 * storage key. Redemption verifies the signature and then reloads and
 * reauthorizes the exact object version and exact parent revision before the
 * caller may ask storage for bytes.
 */
export function createInboxV2FileDownloadTicketService(
  options: InboxV2FileDownloadTicketServiceOptions
): InboxV2FileDownloadTicketService {
  const secret = normalizeSecret(options.secret);
  const ttlSeconds = options.ttlSeconds ?? 60;
  if (
    !Number.isInteger(ttlSeconds) ||
    ttlSeconds < 1 ||
    ttlSeconds > MAX_TTL_SECONDS
  ) {
    throw new Error(
      `ttlSeconds must be an integer between 1 and ${MAX_TTL_SECONDS}.`
    );
  }
  const now = options.now ?? (() => new Date());
  const nonce =
    options.nonce ?? (() => nodeRandomBytes(18).toString("base64url"));
  const downloadPath =
    options.downloadPath ?? "/internal/inbox-v2/files/download";

  return {
    async issue(principal, input) {
      const access = await loadAuthorizedAccess(
        options.repository,
        {
          tenantId: principal.tenantId,
          principalId: principal.principalId
        },
        input
      );
      const decision = evaluateInboxV2FileView({
        tenantId: principal.tenantId,
        pin: input.pin,
        parentLinkId: input.parentLinkId,
        snapshot: access.snapshot
      });
      if (decision.outcome === "denied") {
        throw new InboxV2FileDownloadTicketError("file_access_denied");
      }
      const issuedAtMs = now().getTime();
      const expiresAtMs = issuedAtMs + ttlSeconds * 1_000;
      const payload: TicketPayload = {
        v: TICKET_VERSION,
        tenantId: principal.tenantId,
        principalId: principal.principalId,
        authorizationEpoch: access.currentAuthorizationEpoch,
        pin: input.pin,
        parentFence: decision.fence,
        issuedAtMs,
        expiresAtMs,
        nonce: normalizeNonce(nonce())
      };
      const ticket = signTicket(payload, secret);

      return {
        ticket,
        downloadUrl: `${downloadPath}?ticket=${encodeURIComponent(ticket)}`,
        expiresAt: new Date(expiresAtMs).toISOString()
      };
    },

    async redeem(principal, input) {
      const payload = verifyTicket(input.ticket, secret);
      const currentTime = now().getTime();
      if (
        payload.expiresAtMs <= currentTime ||
        payload.issuedAtMs > currentTime
      ) {
        throw new InboxV2FileDownloadTicketError("ticket_expired");
      }
      if (
        payload.tenantId !== principal.tenantId ||
        payload.principalId !== principal.principalId
      ) {
        throw new InboxV2FileDownloadTicketError("ticket_principal_mismatch");
      }
      const access = await loadAuthorizedAccess(options.repository, principal, {
        pin: payload.pin,
        parentLinkId: payload.parentFence.parentLinkId
      });
      if (access.currentAuthorizationEpoch !== payload.authorizationEpoch) {
        throw new InboxV2FileDownloadTicketError("ticket_authorization_stale");
      }
      const decision = evaluateInboxV2FileView({
        tenantId: principal.tenantId,
        pin: payload.pin,
        parentLinkId: payload.parentFence.parentLinkId,
        snapshot: access.snapshot
      });
      if (decision.outcome === "denied") {
        throw new InboxV2FileDownloadTicketError("file_access_denied");
      }
      if (!sameParentFence(decision.fence, payload.parentFence)) {
        throw new InboxV2FileDownloadTicketError("file_state_changed");
      }

      return {
        pin: payload.pin,
        parentFence: decision.fence,
        storageRootId: access.storageRootId,
        storageKey: access.storageKey,
        storageVersionId: access.storageVersionId,
        checksumSha256: access.checksumSha256,
        fileName: access.fileName,
        mediaType: access.mediaType,
        sizeBytes: access.sizeBytes
      };
    }
  };
}

async function loadAuthorizedAccess(
  repository: InboxV2FileDownloadAccessRepository,
  principal: InboxV2FileDownloadPrincipalIdentity,
  input: Readonly<{ pin: InboxV2FileObjectPin; parentLinkId: string }>
): Promise<InboxV2FileDownloadAccessRecord> {
  const access = await repository.loadCurrentAccess({ principal, ...input });
  if (access === null) {
    throw new InboxV2FileDownloadTicketError("file_unavailable");
  }
  return access;
}

function signTicket(payload: TicketPayload, secret: Uint8Array): string {
  const payloadPart = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url"
  );
  const signature = createHmac("sha256", secret)
    .update(payloadPart, "utf8")
    .digest("base64url");
  return `${payloadPart}.${signature}`;
}

function verifyTicket(ticket: string, secret: Uint8Array): TicketPayload {
  if (ticket.length < 3 || ticket.length > MAX_TICKET_LENGTH) {
    throw new InboxV2FileDownloadTicketError("ticket_invalid");
  }
  const parts = ticket.split(".");
  if (parts.length !== 2 || parts.some((part) => part.length === 0)) {
    throw new InboxV2FileDownloadTicketError("ticket_invalid");
  }
  const [payloadPart, signaturePart] = parts as [string, string];
  const expected = createHmac("sha256", secret)
    .update(payloadPart, "utf8")
    .digest();
  let supplied: Buffer;
  try {
    supplied = Buffer.from(signaturePart, "base64url");
  } catch {
    throw new InboxV2FileDownloadTicketError("ticket_invalid");
  }
  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  ) {
    throw new InboxV2FileDownloadTicketError("ticket_invalid");
  }

  let candidate: unknown;
  try {
    candidate = JSON.parse(
      Buffer.from(payloadPart, "base64url").toString("utf8")
    );
  } catch {
    throw new InboxV2FileDownloadTicketError("ticket_invalid");
  }
  if (!isTicketPayload(candidate)) {
    throw new InboxV2FileDownloadTicketError("ticket_invalid");
  }
  return candidate;
}

function isTicketPayload(value: unknown): value is TicketPayload {
  if (!hasExactKeys(value, TICKET_PAYLOAD_KEYS)) return false;
  const candidate = value as Record<string, unknown>;
  const pin = candidate.pin;
  const fence = candidate.parentFence;
  const issuedAtMs = candidate.issuedAtMs;
  const expiresAtMs = candidate.expiresAtMs;
  return (
    candidate.v === TICKET_VERSION &&
    isBoundedOpaqueValue(candidate.tenantId) &&
    isBoundedOpaqueValue(candidate.principalId) &&
    isBoundedOpaqueValue(candidate.authorizationEpoch) &&
    Number.isSafeInteger(issuedAtMs) &&
    Number.isSafeInteger(expiresAtMs) &&
    (issuedAtMs as number) >= 0 &&
    (expiresAtMs as number) > (issuedAtMs as number) &&
    (expiresAtMs as number) - (issuedAtMs as number) <=
      MAX_TTL_SECONDS * 1_000 &&
    isValidNonce(candidate.nonce) &&
    hasExactStringKeys(pin, FILE_PIN_KEYS) &&
    hasExactKeys(fence, PARENT_FENCE_KEYS) &&
    PARENT_FENCE_KEYS.filter((key) => key !== "pin").every((key) =>
      isBoundedOpaqueValue(fence[key])
    ) &&
    hasExactStringKeys(fence.pin, FILE_PIN_KEYS) &&
    JSON.stringify(fence.pin) === JSON.stringify(pin)
  );
}

function hasExactStringKeys(value: unknown, keys: readonly string[]): boolean {
  return (
    hasExactKeys(value, keys) &&
    keys.every((key) => isBoundedOpaqueValue(value[key]))
  );
}

function hasExactKeys(
  value: unknown,
  expectedKeys: readonly string[]
): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const actualKeys = Object.keys(value);
  return (
    actualKeys.length === expectedKeys.length &&
    expectedKeys.every((key) => Object.hasOwn(value, key))
  );
}

function isBoundedOpaqueValue(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= MAX_OPAQUE_VALUE_LENGTH &&
    /\S/u.test(value) &&
    !/\p{Cc}/u.test(value)
  );
}

function isValidNonce(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 16 &&
    value.length <= 256 &&
    /^[A-Za-z0-9_-]+$/u.test(value)
  );
}

function normalizeNonce(value: string): string {
  if (!isValidNonce(value)) {
    throw new Error(
      "Download-ticket nonce must be a 16-256 character base64url token."
    );
  }
  return value;
}

function sameParentFence(
  left: InboxV2FileParentFence,
  right: InboxV2FileParentFence
): boolean {
  return (
    JSON.stringify(left.pin) === JSON.stringify(right.pin) &&
    left.parentLinkId === right.parentLinkId &&
    left.parentLinkRevision === right.parentLinkRevision &&
    left.parentId === right.parentId &&
    left.parentRevision === right.parentRevision &&
    left.contentRevision === right.contentRevision &&
    left.blockKey === right.blockKey
  );
}

function normalizeSecret(secret: string | Uint8Array): Uint8Array {
  const normalized =
    typeof secret === "string" ? Buffer.from(secret, "utf8") : secret;
  if (normalized.byteLength < MIN_SECRET_BYTES) {
    throw new Error(
      `Download-ticket secret must contain at least ${MIN_SECRET_BYTES} bytes.`
    );
  }
  return normalized;
}
