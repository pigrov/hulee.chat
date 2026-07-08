import type { TenantSecretCipher } from "@hulee/db";
import { randomUUID } from "node:crypto";

export type MaxSelfUser = {
  id?: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  username?: string;
  phone?: string;
};

export type MaxSessionPayload = {
  provider: "max";
  adapter: string;
  transportEndpoint: string;
  appVersion: string;
  locale: string;
  deviceId: string;
  auth: {
    token: string;
    viewerId: string;
  };
  profile?: MaxSelfUser;
  sync?: Record<string, unknown>;
  connectedAt?: string;
};

export type MaxChallengeSecretPayload = {
  deviceId?: string;
  phoneNumber?: string | null;
  maxAuthToken?: string | null;
  verificationCode?: string;
  passwordTrackId?: string | null;
  password?: string;
};

export type MaxAuthStep = "phone_number" | "verification_code" | "password_2fa";

export type MaxPasswordChallenge = {
  trackId?: unknown;
  hint?: unknown;
  email?: unknown;
};

export type MaxLoginPayload = {
  tokenAttrs?: {
    LOGIN?: {
      token?: unknown;
    };
  };
  token?: unknown;
  profile?: unknown;
  passwordChallenge?: MaxPasswordChallenge;
  time?: unknown;
};

export type MaxSessionHelpersOptions = {
  appVersion?: string;
  buildNumber?: number;
  createClientSessionId?: () => number;
  defaultDeviceLocale?: string;
  defaultLocale?: string;
  defaultScreen?: string;
  defaultTimezone?: string;
  defaultUserAgent?: string;
  deviceType?: string;
  transportAdapter?: string;
  transportEndpoint?: string;
};

export function normalizeMaxPhoneNumber(value: string): string {
  let normalized = value.replace(/[\s()-]/g, "");

  if (normalized.startsWith("00")) {
    normalized = `+${normalized.slice(2)}`;
  }

  if (!normalized.startsWith("+")) {
    normalized = `+${normalized}`;
  }

  if (!/^\+\d{8,15}$/.test(normalized)) {
    throw new Error("MAX_PHONE_INVALID");
  }

  return normalized;
}

export function maskMaxPhoneNumber(value: string): string {
  const digits = value.replace(/\D/g, "");

  if (digits.length <= 4) {
    return value;
  }

  const prefixLength = Math.min(3, Math.max(1, digits.length - 6));
  const prefix = digits.slice(0, prefixLength);
  const suffix = digits.slice(-2);
  const masked = "*".repeat(
    Math.max(2, digits.length - prefix.length - suffix.length)
  );

  return `+${prefix}${masked}${suffix}`;
}

export function normalizeMaxVerificationCode(value: string): string {
  const normalized = value.replace(/\s+/g, "");

  if (!/^\d{4,10}$/.test(normalized)) {
    throw new Error("MAX_VERIFICATION_CODE_INVALID");
  }

  return normalized;
}

export function getMaxPasswordTrackIdPayload(value: unknown): unknown {
  return /^\d+$/.test(String(value || "")) ? BigInt(String(value)) : value;
}

export function serializeMaxProfile(profile: unknown): MaxSelfUser {
  const profileRecord = isRecord(profile) ? profile : {};
  const contact = isRecord(profileRecord.contact) ? profileRecord.contact : {};
  const firstName = readOptionalString(contact.firstName);
  const lastName = readOptionalString(contact.lastName);
  const displayName =
    [firstName, lastName].filter(Boolean).join(" ").trim() ||
    readOptionalString(contact.name);

  return {
    id: readOptionalId(contact.id),
    firstName,
    lastName,
    displayName,
    username: readOptionalString(contact.username),
    phone: readOptionalString(contact.phone)
  };
}

export function hasMaxLoginPayload(
  payload: unknown
): payload is MaxLoginPayload {
  const record = isRecord(payload) ? payload : {};
  const tokenAttrs = isRecord(record.tokenAttrs) ? record.tokenAttrs : {};
  const login = isRecord(tokenAttrs.LOGIN) ? tokenAttrs.LOGIN : {};
  const profile = isRecord(record.profile) ? record.profile : {};
  const contact = isRecord(profile.contact) ? profile.contact : {};

  return Boolean(readOptionalString(login.token) && readOptionalId(contact.id));
}

export function getMaxLoginToken(payload: unknown): string | undefined {
  const record = isRecord(payload) ? payload : {};
  const tokenAttrs = isRecord(record.tokenAttrs) ? record.tokenAttrs : {};
  const login = isRecord(tokenAttrs.LOGIN) ? tokenAttrs.LOGIN : {};

  return readOptionalString(record.token) ?? readOptionalString(login.token);
}

export function getMaxLoginViewerId(payload: unknown): string | undefined {
  const record = isRecord(payload) ? payload : {};
  const profile = isRecord(record.profile) ? record.profile : {};
  const contact = isRecord(profile.contact) ? profile.contact : {};

  return readOptionalId(contact.id);
}

export function getMaxPasswordChallenge(payload: unknown): {
  trackId?: unknown;
  hint?: string;
  email?: string;
} | null {
  const record = isRecord(payload) ? payload : {};
  const passwordChallenge = isRecord(record.passwordChallenge)
    ? record.passwordChallenge
    : null;

  if (!passwordChallenge || passwordChallenge.trackId === undefined) {
    return null;
  }

  return {
    trackId: passwordChallenge.trackId,
    hint: readOptionalString(passwordChallenge.hint),
    email: readOptionalString(passwordChallenge.email)
  };
}

export function getMaxChallengeMethod(
  secretPayload: MaxChallengeSecretPayload
): MaxAuthStep | null {
  if (
    secretPayload.password &&
    secretPayload.passwordTrackId &&
    String(secretPayload.passwordTrackId).trim().length > 0
  ) {
    return "password_2fa";
  }

  if (
    secretPayload.verificationCode &&
    secretPayload.maxAuthToken &&
    secretPayload.maxAuthToken.trim().length > 0
  ) {
    return "verification_code";
  }

  if (
    secretPayload.phoneNumber &&
    secretPayload.phoneNumber.trim().length > 0
  ) {
    return "phone_number";
  }

  return null;
}

export function resolveMaxRecoverableState(
  method: MaxAuthStep,
  code: string
): {
  state: "phone_required" | "code_required" | "password_required";
  method: MaxAuthStep;
} {
  if (method === "phone_number") {
    return { state: "phone_required", method: "phone_number" };
  }

  if (method === "verification_code") {
    if (
      [
        "error.limit.violate",
        "auth.token.invalid",
        "auth.token.expired",
        "auth.code.expired"
      ].includes(code)
    ) {
      return { state: "phone_required", method: "phone_number" };
    }

    return { state: "code_required", method: "verification_code" };
  }

  if (
    [
      "auth.token.invalid",
      "auth.token.expired",
      "track.not.found",
      "password2fa.track.invalid"
    ].includes(code)
  ) {
    return { state: "phone_required", method: "phone_number" };
  }

  return { state: "password_required", method: "password_2fa" };
}

export function createMaxSessionHelpers(
  options: MaxSessionHelpersOptions = {}
) {
  const config = {
    appVersion: options.appVersion || "25.12.14",
    buildNumber:
      typeof options.buildNumber === "number" ? options.buildNumber : 0x97cb,
    createClientSessionId:
      options.createClientSessionId ??
      (() => Math.floor(Math.random() * 15) + 1),
    defaultDeviceLocale: options.defaultDeviceLocale || "ru",
    defaultLocale: options.defaultLocale || "ru",
    defaultScreen: options.defaultScreen || "1080x1920 1.0x",
    defaultTimezone: options.defaultTimezone || "Europe/Moscow",
    defaultUserAgent: options.defaultUserAgent || "",
    deviceType: options.deviceType || "DESKTOP",
    transportAdapter: options.transportAdapter || "api.oneme.ru",
    transportEndpoint: options.transportEndpoint || "tls://api.oneme.ru:443"
  };

  const buildMaxUserAgent = (locale = config.defaultLocale) => ({
    deviceType: config.deviceType,
    locale,
    deviceLocale: config.defaultDeviceLocale,
    osVersion: buildMaxDeviceOs(config.defaultUserAgent),
    deviceName: buildMaxDeviceName(config.defaultUserAgent),
    headerUserAgent: config.defaultUserAgent,
    appVersion: config.appVersion,
    screen: config.defaultScreen,
    timezone: config.defaultTimezone,
    clientSessionId: config.createClientSessionId(),
    buildNumber: config.buildNumber
  });

  return {
    buildMaxHandshakePayload(deviceId: string, locale = config.defaultLocale) {
      return {
        userAgent: buildMaxUserAgent(locale),
        deviceId
      };
    },

    buildMaxResyncPayload(input: {
      token: string;
      locale?: string;
      sync?: Record<string, unknown>;
    }) {
      const sync = input.sync ?? {};

      return {
        token: input.token,
        userAgent: buildMaxUserAgent(input.locale || config.defaultLocale),
        chatsCount: 40,
        interactive: false,
        chatsSync: toMaxWireSyncCursor(sync.chatsSync, 0),
        contactsSync: toMaxWireSyncCursor(sync.contactsSync, 0),
        presenceSync: toMaxWireSyncCursor(sync.presenceSync, -1),
        draftsSync: toMaxWireSyncCursor(sync.draftsSync, 0),
        configHash: readOptionalString(sync.configHash) ?? ""
      };
    },

    buildMaxSessionPayload(input: {
      deviceId: string;
      token: string;
      viewerId: string;
      profile?: MaxSelfUser;
      lastLogin?: unknown;
      connectedAt?: string;
    }): MaxSessionPayload {
      return {
        provider: "max",
        adapter: config.transportAdapter,
        transportEndpoint: config.transportEndpoint,
        appVersion: config.appVersion,
        locale: config.defaultLocale,
        deviceId: input.deviceId,
        auth: {
          token: input.token,
          viewerId: input.viewerId
        },
        profile: input.profile,
        sync: {
          chatsSync: 0,
          contactsSync: 0,
          presenceSync: -1,
          draftsSync: 0,
          configHash: "",
          lastLogin: input.lastLogin ?? null
        },
        connectedAt: input.connectedAt ?? new Date().toISOString()
      };
    },

    getMaxSessionDeviceId(
      sessionPayload: MaxSessionPayload | null | undefined
    ) {
      return sessionPayload?.deviceId || randomUUID();
    },

    getMaxSessionLocale(sessionPayload: MaxSessionPayload | null | undefined) {
      return sessionPayload?.locale || config.defaultLocale;
    }
  };
}

export function buildNextMaxSyncState(
  previousSync: Record<string, unknown> | undefined,
  resyncPayload: unknown
): Record<string, unknown> {
  const response = isRecord(resyncPayload) ? resyncPayload : {};
  const responseConfig = isRecord(response.config) ? response.config : {};
  const time = normalizeMaxSyncCursor(
    response.time,
    normalizeMaxSyncCursor(previousSync?.chatsSync, 0)
  );

  return {
    chatsSync: time,
    contactsSync: time,
    presenceSync: time,
    draftsSync: normalizeMaxSyncCursor(previousSync?.draftsSync, 0),
    configHash:
      readOptionalString(responseConfig.hash) ??
      readOptionalString(previousSync?.configHash) ??
      "",
    lastLogin:
      previousSync && previousSync.lastLogin !== undefined
        ? previousSync.lastLogin
        : null,
    seeded: true
  };
}

export function encryptMaxSessionPayload(input: {
  cipher: Pick<TenantSecretCipher, "encrypt">;
  payload: MaxSessionPayload;
}): string {
  return input.cipher.encrypt(stringifyJsonSafe(input.payload));
}

export function deserializeMaxSessionPayload(input: {
  cipher: Pick<TenantSecretCipher, "decrypt">;
  sessionEncrypted: string | null;
}): MaxSessionPayload | null {
  if (!input.sessionEncrypted) {
    return null;
  }

  try {
    const record = parseJsonRecord(
      input.cipher.decrypt(input.sessionEncrypted)
    );

    if (!record || record.provider !== "max") {
      return null;
    }

    const auth = isRecord(record.auth) ? record.auth : {};
    const token = readOptionalString(auth.token);
    const viewerId = readOptionalString(auth.viewerId);
    const deviceId = readOptionalString(record.deviceId);

    if (!token || !viewerId || !deviceId) {
      return null;
    }

    return {
      provider: "max",
      adapter: readOptionalString(record.adapter) ?? "api.oneme.ru",
      transportEndpoint:
        readOptionalString(record.transportEndpoint) ??
        "tls://api.oneme.ru:443",
      appVersion: readOptionalString(record.appVersion) ?? "25.12.14",
      locale: readOptionalString(record.locale) ?? "ru",
      deviceId,
      auth: {
        token,
        viewerId
      },
      profile: readMaxSelfUser(record.profile),
      sync: readSyncRecord(record.sync),
      connectedAt: readOptionalString(record.connectedAt)
    };
  } catch {
    return null;
  }
}

export function readMaxChallengeSecretPayload(
  value: unknown
): MaxChallengeSecretPayload {
  if (!isRecord(value)) {
    return {};
  }

  const verificationCode =
    readOptionalString(value.verificationCode) ??
    readOptionalString(value.code);
  const phoneNumber = toNullableString(value.phoneNumber);

  return {
    deviceId: readOptionalString(value.deviceId),
    phoneNumber: phoneNumber ? normalizeMaxPhoneNumber(phoneNumber) : null,
    maxAuthToken: toNullableString(value.maxAuthToken),
    verificationCode: verificationCode
      ? normalizeMaxVerificationCode(verificationCode)
      : undefined,
    passwordTrackId: toNullableString(value.passwordTrackId),
    password: readOptionalString(value.password)
  };
}

export function displayAddressForMaxUser(
  user: MaxSelfUser
): string | undefined {
  return user.displayName ?? user.username ?? user.phone ?? user.id;
}

export function displayNameForMaxUser(user: MaxSelfUser): string {
  const displayAddress = displayAddressForMaxUser(user);

  return displayAddress ? `MAX account (${displayAddress})` : "MAX account";
}

function buildMaxDeviceOs(userAgent = ""): string {
  if (/Windows/i.test(userAgent)) {
    return "Windows";
  }

  if (/Android/i.test(userAgent)) {
    return "Android";
  }

  if (/iPhone|iPad|iPod/i.test(userAgent)) {
    return "iOS";
  }

  if (/Macintosh|Mac OS X/i.test(userAgent)) {
    return "macOS";
  }

  if (/Linux/i.test(userAgent)) {
    return "Linux";
  }

  return "Unknown";
}

function buildMaxDeviceName(userAgent = ""): string {
  if (/YaBrowser/i.test(userAgent)) {
    return "Yandex Browser";
  }

  if (/OPR|Opera/i.test(userAgent)) {
    return "Opera";
  }

  if (/Atom/i.test(userAgent)) {
    return "Atom";
  }

  if (/MSIE/i.test(userAgent)) {
    return "Internet Explorer";
  }

  if (/Edg/i.test(userAgent)) {
    return "Edge";
  }

  if (/Firefox/i.test(userAgent)) {
    return "Firefox";
  }

  if (/Chrome/i.test(userAgent)) {
    return "Chrome";
  }

  if (/Safari/i.test(userAgent)) {
    return "Safari";
  }

  return "Unknown";
}

function normalizeMaxSyncCursor(value: unknown, fallback: number): number {
  if (typeof value === "bigint") {
    return Number(value);
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);

    if (Number.isFinite(parsed)) {
      return Math.trunc(parsed);
    }
  }

  return fallback;
}

function toMaxWireSyncCursor(
  value: unknown,
  fallback: number
): number | bigint {
  const normalized = normalizeMaxSyncCursor(value, fallback);

  return normalized > 0 ? BigInt(normalized) : normalized;
}

function readMaxSelfUser(value: unknown): MaxSelfUser | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  return {
    id: readOptionalId(value.id),
    firstName: readOptionalString(value.firstName),
    lastName: readOptionalString(value.lastName),
    displayName: readOptionalString(value.displayName),
    username: readOptionalString(value.username),
    phone: readOptionalString(value.phone)
  };
}

function readSyncRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function parseJsonRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;

    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function stringifyJsonSafe(value: unknown): string {
  return JSON.stringify(value, (_key, item) =>
    typeof item === "bigint" ? item.toString() : item
  );
}

function toNullableString(value: unknown): string | null {
  return readOptionalString(value) ?? null;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function readOptionalId(value: unknown): string | undefined {
  if (typeof value === "bigint" || typeof value === "number") {
    return String(value);
  }

  return readOptionalString(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export const maxDirectSessionTestUtils = {
  readMaxChallengeSecretPayload,
  stringifyJsonSafe
};
