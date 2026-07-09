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
  createMaxDirectAuthHandler,
  type MaxDirectAuthHandlerOptions
} from "./max-direct-auth-handler";
import { MaxSocketRequestError } from "./max-direct-transport-client";
import {
  deserializeMaxSessionPayload,
  readMaxChallengeSecretPayload
} from "./max-direct-session";

const tenantId = "tenant_max_direct" as TenantId;
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

describe("max direct auth handler", () => {
  it("turns a submitted phone into code-required state", async () => {
    const updates: unknown[] = [];
    const connector = createConnector();
    const session = createSession(connector);
    const challenge = createChallenge(connector, {
      challengeType: "phone_code",
      status: "pending"
    });
    const fakeClient = new FakeMaxClient([
      {
        token: "max-auth-token",
        codeLength: 6,
        requestCountLeft: 2
      }
    ]);
    const handler = createMaxDirectAuthHandler({
      sessionCipher: fakeCipher,
      createDeviceId: () => "device-1",
      createTransportClient: createFakeTransportFactory(fakeClient)
    });

    const result = await handler.run(
      createHandlerInput({
        connector,
        session,
        challenge,
        challengeSecretPayload: {
          phoneNumber: "+7 (999) 123-45-67"
        },
        updates
      })
    );

    expect(fakeClient.connectCount).toBe(1);
    expect(fakeClient.closeCount).toBe(1);
    expect(fakeClient.commands[0]).toMatchObject({
      opcode: 17,
      payload: {
        phone: "+79991234567",
        type: "START_AUTH",
        language: "ru"
      }
    });
    expect(updates[0]).toMatchObject({
      status: "waiting",
      publicPayload: {
        phoneNumber: "+799******67"
      }
    });
    expect(result).toMatchObject({
      status: "pending",
      challengeStatus: "requires_code",
      publicPayload: {
        phoneNumber: "+799******67"
      }
    });

    if (result.status !== "pending") {
      throw new Error("Expected pending result.");
    }

    expect(readMaxChallengeSecretPayload(result.secretPayload)).toMatchObject({
      deviceId: "device-1",
      phoneNumber: "+79991234567",
      maxAuthToken: "max-auth-token"
    });
  });

  it("completes code login and serializes MAX session", async () => {
    const connector = createConnector();
    const session = createSession(connector);
    const challenge = createChallenge(connector, {
      challengeType: "phone_code",
      status: "requires_code"
    });
    const fakeClient = new FakeMaxClient([
      {
        tokenAttrs: {
          LOGIN: {
            token: "login-token"
          }
        },
        profile: {
          contact: {
            id: 555,
            firstName: "Max",
            lastName: "User",
            username: "max_user",
            phone: "+79991234567"
          }
        }
      },
      {
        time: 1234567890
      }
    ]);
    const handler = createMaxDirectAuthHandler({
      sessionCipher: fakeCipher,
      createTransportClient: createFakeTransportFactory(fakeClient)
    });

    const result = await handler.run(
      createHandlerInput({
        connector,
        session,
        challenge,
        challengeSecretPayload: {
          deviceId: "device-1",
          phoneNumber: "+79991234567",
          maxAuthToken: "max-auth-token",
          code: "123456"
        }
      })
    );

    expect(fakeClient.commands[0]).toMatchObject({
      opcode: 18,
      payload: {
        token: "max-auth-token",
        verifyCode: "123456",
        authTokenType: "CHECK_CODE"
      }
    });
    expect(fakeClient.commands[1]?.opcode).toBe(19);
    expect(result).toMatchObject({
      status: "completed",
      sessionFingerprint: "max:555",
      externalAccountId: "555",
      displayAddress: "Max User",
      connectorDisplayName: "MAX account (Max User)"
    });

    if (result.status !== "completed") {
      throw new Error("Expected completed result.");
    }

    const payload = deserializeMaxSessionPayload({
      cipher: fakeCipher,
      sessionEncrypted: result.sessionEncrypted
    });

    expect(payload).toMatchObject({
      provider: "max",
      deviceId: "device-1",
      auth: {
        token: "login-token",
        viewerId: "555"
      },
      profile: {
        username: "max_user"
      }
    });
  });

  it("surfaces MAX rate limits as a temporary provider failure", async () => {
    const connector = createConnector();
    const session = createSession(connector);
    const challenge = createChallenge(connector, {
      challengeType: "phone_code",
      status: "requires_code"
    });
    const fakeClient = new FakeMaxClient([
      new MaxSocketRequestError(18, {
        error: "error.limit.violate",
        localizedMessage: "Попробуйте позже Слишком много попыток"
      })
    ]);
    const handler = createMaxDirectAuthHandler({
      sessionCipher: fakeCipher,
      createTransportClient: createFakeTransportFactory(fakeClient)
    });

    const result = await handler.run(
      createHandlerInput({
        connector,
        session,
        challenge,
        challengeSecretPayload: {
          deviceId: "device-1",
          phoneNumber: "+79991234567",
          maxAuthToken: "max-auth-token",
          code: "123456"
        }
      })
    );

    expect(result).toMatchObject({
      status: "failed",
      errorCode: "provider.temporary_failure",
      errorMessage: "Попробуйте позже Слишком много попыток",
      publicPayload: {
        operatorHint:
          "MAX temporarily limited authorization attempts. Wait a few minutes before requesting or submitting a new code."
      }
    });
  });
});

class FakeMaxClient {
  auth: { token: string; viewerId: string } | null = null;
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
  client: FakeMaxClient
): NonNullable<MaxDirectAuthHandlerOptions["createTransportClient"]> {
  return () => client;
}

function createHandlerInput(input: {
  connector: ChannelConnectorRecord;
  session: ChannelSessionRecord;
  challenge: ChannelAuthChallengeRecord;
  challengeSecretPayload?: Record<string, unknown>;
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
        challengeSecretPayload: input.challengeSecretPayload ?? {}
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
    id: "max_qr_bridge:connector-1" as ChannelConnectorId,
    tenantId,
    channelType: "max_qr_bridge",
    channelClass: "user_bridge",
    provider: "max",
    displayName: "MAX account",
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
    id: "channel_session:max-1",
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
  }
): ChannelAuthChallengeRecord {
  return {
    id: "channel_auth_challenge:max-1",
    tenantId,
    connectorId: connector.id,
    challengeType: input.challengeType,
    status: input.status,
    publicPayload: {},
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
