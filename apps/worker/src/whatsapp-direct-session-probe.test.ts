import type { ChannelConnectorRecord, ChannelSessionRecord } from "@hulee/db";
import type { ChannelConnectorId, TenantId } from "@hulee/contracts";
import { describe, expect, it } from "vitest";

import {
  createWhatsAppDirectSessionProbeHandler,
  type WhatsAppSessionProbeConnectionInput
} from "./whatsapp-direct-session-probe";
import {
  encryptWhatsAppSessionPayload,
  whatsappDirectAuthHandlerTestUtils
} from "./whatsapp-direct-auth-handler";

const tenantId = "tenant_whatsapp_probe" as TenantId;
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

describe("whatsapp direct session probe handler", () => {
  it("checks an existing Baileys session and persists updated credentials", async () => {
    let probeInput: WhatsAppSessionProbeConnectionInput | undefined;
    const handler = createWhatsAppDirectSessionProbeHandler({
      sessionCipher: fakeCipher,
      connectWhatsAppSessionProbe: async (input) => {
        probeInput = input;
        await input.sessionState.saveCreds({
          me: {
            id: "79990000000:1@s.whatsapp.net",
            name: "Dmitry"
          },
          registered: true
        } as Parameters<typeof input.sessionState.saveCreds>[0]);

        return {
          status: "healthy",
          user: {
            id: "79990000000:1@s.whatsapp.net",
            name: "Dmitry"
          }
        };
      }
    });

    const result = await handler.probe({
      connector: createConnector(),
      session: createSession({
        sessionEncrypted: createEncryptedWhatsAppSession()
      }),
      now
    });

    expect(probeInput).toMatchObject({
      sessionId: "channel_session:whatsapp-1"
    });
    expect(result).toMatchObject({
      status: "healthy",
      externalAccountId: "79990000000:1@s.whatsapp.net",
      displayAddress: "+79990000000",
      connectorDisplayName: "WhatsApp account (+79990000000)"
    });
  });

  it("requires reauth when WhatsApp returns a QR during a session probe", async () => {
    const handler = createWhatsAppDirectSessionProbeHandler({
      sessionCipher: fakeCipher,
      connectWhatsAppSessionProbe: async () => ({
        status: "reauth_required",
        errorMessage: "WhatsApp requested a new QR login."
      })
    });

    await expect(
      handler.probe({
        connector: createConnector(),
        session: createSession({
          sessionEncrypted: createEncryptedWhatsAppSession()
        }),
        now
      })
    ).resolves.toMatchObject({
      status: "reauth_required",
      errorCode: "provider.permanent_failure"
    });
  });
});

function createEncryptedWhatsAppSession(): string {
  const sessionState =
    whatsappDirectAuthHandlerTestUtils.createWhatsAppSessionState();

  return encryptWhatsAppSessionPayload({
    cipher: fakeCipher,
    payload: sessionState.snapshot()
  });
}

function createConnector(): ChannelConnectorRecord {
  return {
    id: "whatsapp_qr_bridge:connector-1" as ChannelConnectorId,
    tenantId,
    channelType: "whatsapp_qr_bridge",
    channelClass: "user_bridge",
    provider: "whatsapp",
    displayName: "WhatsApp account",
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
    id: "channel_session:whatsapp-1",
    tenantId,
    connectorId: "whatsapp_qr_bridge:connector-1" as ChannelConnectorId,
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
