import type { ChannelConnectorRecord, ChannelSessionRecord } from "@hulee/db";
import type { ChannelConnectorId, TenantId } from "@hulee/contracts";
import { describe, expect, it } from "vitest";

import {
  createMaxDirectSessionProbeHandler,
  type MaxDirectSessionProbeHandlerOptions
} from "./max-direct-session-probe";
import {
  encryptMaxSessionPayload,
  type MaxSessionPayload
} from "./max-direct-session";
import { MaxSocketRequestError } from "./max-direct-transport-client";

const tenantId = "tenant_max_probe" as TenantId;
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

describe("max direct session probe handler", () => {
  it("checks an existing MAX session through resync", async () => {
    const client = new FakeMaxProbeClient([
      {
        time: 1234567890,
        config: {
          hash: "config-hash"
        }
      }
    ]);
    const handler = createMaxDirectSessionProbeHandler({
      sessionCipher: fakeCipher,
      createTransportClient: createFakeTransportFactory(client)
    });

    const result = await handler.probe({
      connector: createConnector(),
      session: createSession({
        sessionEncrypted: encryptSessionPayload()
      }),
      now
    });

    expect(client.connectCount).toBe(1);
    expect(client.closeCount).toBe(1);
    expect(client.commands[0]).toMatchObject({
      opcode: 19,
      payload: {
        token: "max-session-token"
      }
    });
    expect(result).toMatchObject({
      status: "healthy",
      sessionFingerprint: "max:555",
      externalAccountId: "555",
      displayAddress: "Max User",
      connectorDisplayName: "MAX account (Max User)"
    });
  });

  it("requires reauth when MAX rejects the stored token", async () => {
    const handler = createMaxDirectSessionProbeHandler({
      sessionCipher: fakeCipher,
      createTransportClient: createFakeTransportFactory(
        new FakeMaxProbeClient([
          new MaxSocketRequestError(19, {
            error: "auth.token.expired",
            localizedMessage: "Token expired"
          })
        ])
      )
    });

    await expect(
      handler.probe({
        connector: createConnector(),
        session: createSession({
          sessionEncrypted: encryptSessionPayload()
        }),
        now
      })
    ).resolves.toMatchObject({
      status: "reauth_required",
      errorCode: "provider.permanent_failure"
    });
  });
});

class FakeMaxProbeClient {
  connectCount = 0;
  closeCount = 0;
  readonly commands: { opcode: number; payload: unknown }[] = [];

  constructor(private readonly responses: unknown[]) {}

  async connect(): Promise<void> {
    this.connectCount += 1;
  }

  async cmd(opcode: number, payload: unknown): Promise<unknown> {
    this.commands.push({ opcode, payload });
    const response = this.responses.shift();

    if (response instanceof Error) {
      throw response;
    }

    return response;
  }

  async close(): Promise<void> {
    this.closeCount += 1;
  }
}

function createFakeTransportFactory(
  client: FakeMaxProbeClient
): NonNullable<MaxDirectSessionProbeHandlerOptions["createTransportClient"]> {
  return () => client;
}

function encryptSessionPayload(patch: Partial<MaxSessionPayload> = {}): string {
  return encryptMaxSessionPayload({
    cipher: fakeCipher,
    payload: {
      provider: "max",
      adapter: "api.oneme.ru",
      transportEndpoint: "tls://api.oneme.ru:443",
      appVersion: "25.12.14",
      locale: "ru",
      deviceId: "device-1",
      auth: {
        token: "max-session-token",
        viewerId: "555"
      },
      profile: {
        id: "555",
        displayName: "Max User",
        username: "max_user"
      },
      sync: {
        chatsSync: 0,
        contactsSync: 0,
        presenceSync: -1,
        draftsSync: 0,
        configHash: ""
      },
      connectedAt: now.toISOString(),
      ...patch
    }
  });
}

function createConnector(): ChannelConnectorRecord {
  return {
    id: "max_qr_bridge:connector-1" as ChannelConnectorId,
    tenantId,
    channelType: "max_qr_bridge",
    channelClass: "user_bridge",
    provider: "max",
    displayName: "MAX account",
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
    id: "channel_session:max-1",
    tenantId,
    connectorId: "max_qr_bridge:connector-1" as ChannelConnectorId,
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
