import type {
  ChannelAuthChallengeRecord,
  ChannelConnectorRecord,
  ChannelSessionRecord
} from "@hulee/db";
import type {
  ChannelConnectorId,
  InternalChannelAuthChallengeStatus,
  InternalChannelAuthChallengeType,
  TenantId
} from "@hulee/contracts";
import { describe, expect, it } from "vitest";

import type { DirectAccountAuthHandlerInput } from "./direct-account-auth-sweeper";
import {
  createTelegramDirectAuthHandler,
  type CreateTelegramAuthClientInput,
  type TelegramAuthClient
} from "./telegram-direct-auth-handler";

const tenantId = "tenant_telegram_direct" as TenantId;
const now = new Date("2026-07-07T10:00:00.000Z");
const fakeCipher = {
  encrypt(plainText: string): string {
    return `sealed:${Buffer.from(plainText, "utf8").toString("base64url")}`;
  },
  decrypt(sealedValue: string): string {
    return Buffer.from(
      sealedValue.replace(/^sealed:/, ""),
      "base64url"
    ).toString("utf8");
  }
};

describe("telegram direct auth handler", () => {
  it("publishes QR state and completes with encrypted MTProto session", async () => {
    const updates: unknown[] = [];
    const connector = createConnector();
    const session = createSession(connector, {
      sessionEncrypted: fakeCipher.encrypt(
        JSON.stringify({
          sessionString: "existing-session"
        })
      )
    });
    const challenge = createChallenge(connector, {
      challengeType: "qr",
      status: "waiting"
    });
    const fakeClient = new FakeTelegramAuthClient("success");
    let clientInput: CreateTelegramAuthClientInput | undefined;
    const handler = createTelegramDirectAuthHandler({
      apiId: 12345,
      apiHash: "api-hash",
      sessionCipher: fakeCipher,
      authTimeoutMs: 30_000,
      createQrImageDataUrl: async () => "data:image/svg+xml;base64,test",
      createTelegramClient(input) {
        clientInput = input;
        return fakeClient;
      }
    });

    const result = await handler.run(
      createHandlerInput({
        connector,
        session,
        challenge,
        updates
      })
    );

    expect(clientInput).toMatchObject({
      apiId: 12345,
      apiHash: "api-hash",
      sessionString: "existing-session"
    });
    expect(fakeClient.connectCount).toBe(1);
    expect(fakeClient.disconnectCount).toBe(1);
    expect(updates).toContainEqual(
      expect.objectContaining({
        status: "waiting",
        publicPayload: expect.objectContaining({
          qrPayloadRef: "tg://login?token=cXItdG9rZW4",
          qrImageDataUrl: "data:image/svg+xml;base64,test"
        })
      })
    );
    expect(result).toMatchObject({
      status: "completed",
      sessionFingerprint: "telegram:123",
      externalAccountId: "123",
      displayAddress: "@hulee_user",
      connectorDisplayName: "Telegram account (@hulee_user)",
      publicState: {
        stage: "connected",
        user: {
          id: "123",
          username: "hulee_user",
          firstName: "Hulee",
          lastName: "User"
        }
      }
    });

    if (result.status !== "completed") {
      throw new Error("Expected completed result.");
    }

    expect(
      JSON.parse(fakeCipher.decrypt(result.sessionEncrypted))
    ).toMatchObject({
      sessionString: "saved-telegram-session",
      user: {
        id: "123",
        username: "hulee_user"
      }
    });
  });

  it("fails without creating a Telegram client when API credentials are missing", async () => {
    let clientCreated = false;
    const connector = createConnector();
    const handler = createTelegramDirectAuthHandler({
      apiHash: "",
      sessionCipher: fakeCipher,
      createTelegramClient() {
        clientCreated = true;
        return new FakeTelegramAuthClient("success");
      }
    });

    const result = await handler.run(
      createHandlerInput({
        connector,
        session: createSession(connector),
        challenge: createChallenge(connector, {
          challengeType: "qr",
          status: "waiting"
        })
      })
    );

    expect(clientCreated).toBe(false);
    expect(result).toMatchObject({
      status: "failed",
      errorCode: "validation.failed",
      errorMessage: "Telegram user API id/hash are not configured.",
      publicPayload: {
        operatorHint:
          "Configure HULEE_TELEGRAM_USER_API_ID and HULEE_TELEGRAM_USER_API_HASH in the provider worker deployment."
      }
    });
  });

  it("waits for a 2FA password from the latest encrypted challenge payload", async () => {
    const updates: unknown[] = [];
    const connector = createConnector();
    const session = createSession(connector);
    const challenge = createChallenge(connector, {
      challengeType: "qr",
      status: "waiting"
    });
    const handler = createTelegramDirectAuthHandler({
      apiId: 12345,
      apiHash: "api-hash",
      sessionCipher: fakeCipher,
      authTimeoutMs: 30_000,
      passwordTimeoutMs: 30_000,
      passwordPollIntervalMs: 250,
      sleep: async () => undefined,
      createQrImageDataUrl: async () => "data:image/svg+xml;base64,test",
      createTelegramClient() {
        return new FakeTelegramAuthClient("password");
      }
    });

    const result = await handler.run(
      createHandlerInput({
        connector,
        session,
        challenge,
        latestChallengeSecretPayload: {
          password: "2fa-secret"
        },
        updates
      })
    );

    expect(updates).toContainEqual(
      expect.objectContaining({
        status: "requires_password",
        publicPayload: {
          operatorHint:
            "Telegram requires a two-step verification password. Hint: hint text"
        }
      })
    );
    expect(result).toMatchObject({
      status: "completed",
      externalAccountId: "123"
    });
  });

  it("sends a phone login code and completes after submitted code", async () => {
    const updates: unknown[] = [];
    const connector = createConnector();
    const session = createSession(connector);
    const challenge = createChallenge(connector, {
      challengeType: "phone_code",
      status: "pending",
      publicPayload: {
        phoneNumber: "+79991234567"
      }
    });
    const handler = createTelegramDirectAuthHandler({
      apiId: 12345,
      apiHash: "api-hash",
      sessionCipher: fakeCipher,
      authTimeoutMs: 30_000,
      passwordTimeoutMs: 30_000,
      passwordPollIntervalMs: 250,
      sleep: async () => undefined,
      createTelegramClient() {
        return new FakeTelegramAuthClient("phone_code");
      }
    });

    const result = await handler.run(
      createHandlerInput({
        connector,
        session,
        challenge,
        latestChallengeSecretPayload: {
          code: "12345"
        },
        updates
      })
    );

    expect(updates).toContainEqual(
      expect.objectContaining({
        status: "requires_code",
        publicPayload: {
          phoneNumber: "+79991234567",
          operatorHint: "Telegram sent a login code to the Telegram app."
        }
      })
    );
    expect(result).toMatchObject({
      status: "completed",
      externalAccountId: "123",
      metadata: {
        provider: "telegram",
        authMode: "phone_code"
      }
    });
  });
});

class FakeTelegramAuthClient implements TelegramAuthClient {
  readonly session = {
    save: () => this.sessionString
  };

  connectCount = 0;
  disconnectCount = 0;

  constructor(
    private readonly behavior: "success" | "password" | "phone_code",
    private readonly sessionString = "saved-telegram-session"
  ) {}

  async connect(): Promise<void> {
    this.connectCount += 1;
  }

  async disconnect(): Promise<void> {
    this.disconnectCount += 1;
  }

  async signInUserWithQrCode(
    _apiCredentials: { apiId: number; apiHash: string },
    authParams: {
      qrCode(qrCode: {
        token: Buffer | Uint8Array;
        expires: number;
      }): Promise<void>;
      password(hint?: string): Promise<string>;
      onError(error: Error): Promise<boolean> | boolean;
    }
  ): Promise<unknown> {
    await authParams.qrCode({
      token: Buffer.from("qr-token"),
      expires: 1_776_000_000
    });

    if (this.behavior === "password") {
      expect(await authParams.password("hint text")).toBe("2fa-secret");
    }

    return {
      id: 123n,
      username: "hulee_user",
      firstName: "Hulee",
      lastName: "User"
    };
  }

  async signInUser(
    _apiCredentials: { apiId: number; apiHash: string },
    authParams: {
      phoneNumber: string | (() => Promise<string>);
      phoneCode(isCodeViaApp?: boolean): Promise<string>;
      password(hint?: string): Promise<string>;
      onError(error: Error): Promise<boolean> | boolean;
    }
  ): Promise<unknown> {
    const phoneNumber =
      typeof authParams.phoneNumber === "function"
        ? await authParams.phoneNumber()
        : authParams.phoneNumber;

    expect(phoneNumber).toBe("+79991234567");
    expect(await authParams.phoneCode(true)).toBe("12345");

    return {
      id: 123n,
      username: "hulee_user",
      firstName: "Hulee",
      lastName: "User"
    };
  }
}

function createHandlerInput(input: {
  connector: ChannelConnectorRecord;
  session: ChannelSessionRecord;
  challenge: ChannelAuthChallengeRecord;
  challengeSecretPayload?: Record<string, unknown>;
  latestChallengeSecretPayload?: Record<string, unknown>;
  updates?: unknown[];
}): DirectAccountAuthHandlerInput {
  return {
    connector: input.connector,
    session: input.session,
    challenge: input.challenge,
    challengeSecretPayload: input.challengeSecretPayload ?? {},
    now,
    async loadLatestChallenge() {
      return {
        challenge: input.challenge,
        challengeSecretPayload: input.latestChallengeSecretPayload ?? {}
      };
    },
    async updateChallenge(patch) {
      input.updates?.push(patch);
    },
    encryptSecretPayload(payload) {
      return fakeCipher.encrypt(JSON.stringify(payload));
    }
  };
}

function createConnector(): ChannelConnectorRecord {
  return {
    id: "telegram_qr_bridge:connector-1" as ChannelConnectorId,
    tenantId,
    channelType: "telegram_qr_bridge",
    channelClass: "user_bridge",
    provider: "telegram",
    displayName: "Telegram account",
    status: "authorizing",
    healthStatus: "unknown",
    capabilities: {},
    onboardingState: {},
    config: {},
    diagnostics: {},
    createdByEmployeeId: null,
    createdAt: now,
    updatedAt: now
  };
}

function createSession(
  connector: ChannelConnectorRecord,
  patch: Partial<ChannelSessionRecord> = {}
): ChannelSessionRecord {
  return {
    id: "channel_session:telegram-1",
    tenantId,
    connectorId: connector.id,
    sessionKey: "primary",
    status: "pending_auth",
    sessionEncrypted: null,
    sessionFingerprint: null,
    externalAccountId: null,
    displayAddress: null,
    publicState: {},
    metadata: {},
    challengeType: null,
    challengeExpiresAt: null,
    leaseOwner: null,
    leaseExpiresAt: null,
    lastConnectedAt: null,
    lastDisconnectedAt: null,
    lastHeartbeatAt: null,
    lastInboundAt: null,
    lastOutboundAt: null,
    lastErrorAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    createdAt: now,
    updatedAt: now,
    ...patch
  };
}

function createChallenge(
  connector: ChannelConnectorRecord,
  input: {
    challengeType: InternalChannelAuthChallengeType;
    status: InternalChannelAuthChallengeStatus;
    publicPayload?: Record<string, unknown>;
  }
): ChannelAuthChallengeRecord {
  return {
    id: "channel_auth_challenge:telegram-1",
    tenantId,
    connectorId: connector.id,
    challengeType: input.challengeType,
    status: input.status,
    publicPayload: input.publicPayload ?? {},
    secretPayloadEncrypted: null,
    errorCode: null,
    errorMessage: null,
    expiresAt: new Date(now.getTime() + 5 * 60_000),
    completedAt: null,
    createdByEmployeeId: null,
    createdAt: now,
    updatedAt: now
  };
}
