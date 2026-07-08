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
  createWhatsAppDirectAuthHandler,
  type ConnectWhatsAppSocketLoopInput
} from "./whatsapp-direct-auth-handler";
import { whatsappDirectAuthHandlerTestUtils } from "./whatsapp-direct-auth-handler";

const tenantId = "tenant_whatsapp_direct" as TenantId;
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

describe("whatsapp direct auth handler", () => {
  it("publishes QR state and completes with encrypted Baileys session", async () => {
    const updates: unknown[] = [];
    let ended = false;
    let loopInput: ConnectWhatsAppSocketLoopInput | undefined;
    const connector = createConnector();
    const session = createSession(connector);
    const challenge = createChallenge(connector, {
      challengeType: "qr",
      status: "waiting"
    });
    const handler = createWhatsAppDirectAuthHandler({
      sessionCipher: fakeCipher,
      authTimeoutMs: 30_000,
      createQrImageDataUrl: async (qrPayload) =>
        `data:image/svg+xml;base64,${qrPayload}`,
      connectWhatsAppSocketLoop: async (input) => {
        loopInput = input;
        await input.onQr("whatsapp-qr-payload");
        await input.sessionState.saveCreds({
          me: {
            id: "79990000000:1@s.whatsapp.net",
            name: "Dmitry"
          },
          registered: true
        } as Parameters<typeof input.sessionState.saveCreds>[0]);

        return {
          end() {
            ended = true;
          }
        };
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

    expect(loopInput).toMatchObject({
      sessionId: session.id,
      timeoutMs: 30_000
    });
    expect(updates).toContainEqual(
      expect.objectContaining({
        status: "waiting",
        publicPayload: {
          qrPayloadRef: "whatsapp-qr-payload",
          qrImageDataUrl: "data:image/svg+xml;base64,whatsapp-qr-payload",
          expiresAt: challenge.expiresAt?.toISOString()
        }
      })
    );
    expect(ended).toBe(true);
    expect(result).toMatchObject({
      status: "completed",
      sessionFingerprint: "whatsapp:79990000000:1@s.whatsapp.net",
      externalAccountId: "79990000000:1@s.whatsapp.net",
      displayAddress: "+79990000000",
      connectorDisplayName: "WhatsApp account (+79990000000)",
      publicState: {
        stage: "connected",
        user: {
          id: "79990000000:1@s.whatsapp.net",
          name: "Dmitry"
        }
      }
    });

    if (result.status !== "completed") {
      throw new Error("Expected completed result.");
    }

    expect(
      whatsappDirectAuthHandlerTestUtils.deserializeWhatsAppSessionPayload({
        cipher: fakeCipher,
        sessionEncrypted: result.sessionEncrypted
      })
    ).toMatchObject({
      user: {
        id: "79990000000:1@s.whatsapp.net",
        name: "Dmitry"
      },
      updatedAt: expect.any(String)
    });
  });

  it("fails without opening WhatsApp socket when session encryption is missing", async () => {
    let socketOpened = false;
    const connector = createConnector();
    const handler = createWhatsAppDirectAuthHandler({
      connectWhatsAppSocketLoop: async () => {
        socketOpened = true;
        return {};
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

    expect(socketOpened).toBe(false);
    expect(result).toMatchObject({
      status: "failed",
      errorCode: "validation.failed",
      errorMessage: "Session encryption is not configured.",
      publicPayload: {
        operatorHint:
          "Configure HULEE_SECRET_ENCRYPTION_KEY before authorizing direct WhatsApp accounts."
      }
    });
  });

  it("returns a diagnostic provider failure when WhatsApp socket auth fails", async () => {
    const connector = createConnector();
    const handler = createWhatsAppDirectAuthHandler({
      sessionCipher: fakeCipher,
      authTimeoutMs: 30_000,
      connectWhatsAppSocketLoop: async () => {
        throw new Error("WHATSAPP_QR_AUTH_TIMEOUT");
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

    expect(result).toMatchObject({
      status: "failed",
      errorCode: "provider.permanent_failure",
      errorMessage: "WHATSAPP_QR_AUTH_TIMEOUT",
      publicPayload: {
        operatorHint:
          "WhatsApp QR authorization timed out. Start a new challenge and scan the QR code again."
      }
    });
  });

  it("publishes a pairing code for phone-based WhatsApp linking", async () => {
    const updates: unknown[] = [];
    let loopInput: ConnectWhatsAppSocketLoopInput | undefined;
    const connector = createConnector();
    const session = createSession(connector);
    const challenge = createChallenge(connector, {
      challengeType: "phone_code",
      status: "pending",
      publicPayload: {
        phoneNumber: "+7 (999) 123-45-67"
      }
    });
    const handler = createWhatsAppDirectAuthHandler({
      sessionCipher: fakeCipher,
      authTimeoutMs: 30_000,
      connectWhatsAppSocketLoop: async (input) => {
        loopInput = input;
        await input.onPairingCode?.("abcd1234");
        await input.sessionState.saveCreds({
          me: {
            id: "79991234567:1@s.whatsapp.net",
            name: "Dmitry"
          },
          registered: true
        } as Parameters<typeof input.sessionState.saveCreds>[0]);

        return {};
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

    expect(loopInput).toMatchObject({
      pairingPhoneNumber: "79991234567"
    });
    expect(updates).toContainEqual(
      expect.objectContaining({
        status: "waiting",
        publicPayload: {
          phoneNumber: "+79991234567",
          pairingCode: "ABCD-1234",
          expiresAt: challenge.expiresAt?.toISOString(),
          operatorHint:
            "Enter the pairing code in WhatsApp linked devices. The page will update after authorization."
        }
      })
    );
    expect(result).toMatchObject({
      status: "completed",
      externalAccountId: "79991234567:1@s.whatsapp.net",
      metadata: {
        provider: "whatsapp",
        authMode: "pairing_code"
      }
    });
  });
});

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
    id: "whatsapp_qr_bridge:connector-1" as ChannelConnectorId,
    tenantId,
    channelType: "whatsapp_qr_bridge",
    channelClass: "user_bridge",
    provider: "whatsapp",
    displayName: "WhatsApp account",
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
    id: "channel_session:whatsapp-1",
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
    id: "channel_auth_challenge:whatsapp-1",
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
