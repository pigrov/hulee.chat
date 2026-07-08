import type { ChannelConnectorRecord, ChannelSessionRecord } from "@hulee/db";
import type { ChannelConnectorId, TenantId } from "@hulee/contracts";
import { describe, expect, it } from "vitest";

import {
  createTelegramDirectSessionProbeHandler,
  type CreateTelegramSessionProbeClientInput,
  type TelegramSessionProbeClient
} from "./telegram-direct-session-probe";

const tenantId = "tenant_telegram_probe" as TenantId;
const now = new Date("2026-07-08T10:00:00.000Z");
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

describe("telegram direct session probe handler", () => {
  it("checks an existing MTProto session through getMe", async () => {
    let clientInput: CreateTelegramSessionProbeClientInput | undefined;
    const client = new FakeTelegramSessionProbeClient("healthy");
    const handler = createTelegramDirectSessionProbeHandler({
      apiId: 12345,
      apiHash: "hash",
      sessionCipher: fakeCipher,
      createTelegramClient(input) {
        clientInput = input;
        return client;
      }
    });

    const result = await handler.probe({
      connector: createConnector(),
      session: createSession({
        sessionEncrypted: fakeCipher.encrypt(
          JSON.stringify({
            sessionString: "existing-session"
          })
        )
      }),
      now
    });

    expect(clientInput).toMatchObject({
      sessionString: "existing-session",
      apiId: 12345,
      apiHash: "hash"
    });
    expect(client.connectCount).toBe(1);
    expect(client.disconnectCount).toBe(1);
    expect(result).toMatchObject({
      status: "healthy",
      externalAccountId: "123",
      displayAddress: "@hulee_user",
      connectorDisplayName: "Telegram account (@hulee_user)"
    });
  });

  it("requires reauth when Telegram rejects the stored session", async () => {
    const handler = createTelegramDirectSessionProbeHandler({
      apiId: 12345,
      apiHash: "hash",
      sessionCipher: fakeCipher,
      createTelegramClient() {
        return new FakeTelegramSessionProbeClient("revoked");
      }
    });

    await expect(
      handler.probe({
        connector: createConnector(),
        session: createSession({
          sessionEncrypted: fakeCipher.encrypt(
            JSON.stringify({
              sessionString: "revoked-session"
            })
          )
        }),
        now
      })
    ).resolves.toMatchObject({
      status: "reauth_required",
      errorCode: "provider.permanent_failure"
    });
  });
});

class FakeTelegramSessionProbeClient implements TelegramSessionProbeClient {
  readonly session = {
    save: () => "saved-session"
  };

  connectCount = 0;
  disconnectCount = 0;

  constructor(private readonly behavior: "healthy" | "revoked") {}

  async connect(): Promise<void> {
    this.connectCount += 1;
  }

  async disconnect(): Promise<void> {
    this.disconnectCount += 1;
  }

  async getMe(): Promise<unknown> {
    if (this.behavior === "revoked") {
      throw new Error("AUTH_KEY_UNREGISTERED");
    }

    return {
      id: 123n,
      username: "hulee_user"
    };
  }
}

function createConnector(): ChannelConnectorRecord {
  return {
    id: "telegram_qr_bridge:connector-1" as ChannelConnectorId,
    tenantId,
    channelType: "telegram_qr_bridge",
    channelClass: "user_bridge",
    provider: "telegram",
    displayName: "Telegram account",
    status: "connected",
    healthStatus: "healthy",
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
  patch: Partial<ChannelSessionRecord> = {}
): ChannelSessionRecord {
  return {
    id: "channel_session:telegram-1",
    tenantId,
    connectorId: "telegram_qr_bridge:connector-1" as ChannelConnectorId,
    sessionKey: "primary",
    status: "connected",
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
    lastConnectedAt: now,
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
