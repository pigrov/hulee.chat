import type {
  ApiKeyAuthenticator,
  PublicApiCommandContext,
  PublicApiCommandService,
  PublicApiAuditRecord
} from "./public-api-handler";
import { describe, expect, it, vi } from "vitest";

import type { TenantId } from "@hulee/contracts";

import { createPublicApiHandler } from "./public-api-handler";

const tenantId = "tenant-1" as TenantId;

function createCommands(): PublicApiCommandService {
  return {
    async registerClient(_context, request) {
      return {
        clientId: `client:${request.externalId}`,
        externalId: request.externalId,
        created: true
      };
    },
    async acceptInboundMessage(_context, request) {
      return {
        clientId: `client:${request.clientExternalId}`,
        conversationId: "conversation-1",
        messageId: `message:${request.providerMessageId}`,
        accepted: true
      };
    },
    async queueOutboundMessage(_context, request) {
      return {
        messageId: "message-outbound-1",
        status: "queued",
        idempotencyKey: request.idempotencyKey
      };
    },
    async getDeliveryStatus(_context, messageId) {
      return {
        messageId,
        status: "queued",
        updatedAt: "2026-06-22T07:00:00.000Z"
      };
    }
  };
}

function createHandler(input?: {
  commands?: PublicApiCommandService;
  auditRecords?: PublicApiAuditRecord[];
  authenticator?: ApiKeyAuthenticator;
}) {
  return createPublicApiHandler({
    requestIdFactory: () => "request-1",
    authenticator: input?.authenticator ?? {
      async authenticate(rawApiKey) {
        if (rawApiKey !== "valid-key") {
          return null;
        }

        return {
          tenantId,
          apiKeyId: "api-key-1"
        };
      }
    },
    commands: input?.commands ?? createCommands(),
    auditSink: {
      async record(record) {
        input?.auditRecords?.push(record);
      }
    }
  });
}

describe("public API handler", () => {
  it("serves versioned health without API key auth", async () => {
    const response = await createHandler().handle({
      method: "GET",
      path: "/v1/health"
    });

    expect(response).toEqual({
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8"
      },
      body: {
        status: "ok",
        version: "v1"
      }
    });
  });

  it("rejects public API requests without credentials", async () => {
    const response = await createHandler().handle({
      method: "POST",
      path: "/v1/clients",
      body: {
        externalId: "client-1",
        displayName: "Alice"
      }
    });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: {
        code: "auth.invalid_credentials",
        messageKey: "errors.auth.invalidCredentials",
        retryability: "not_retryable",
        requestId: "request-1"
      }
    });
  });

  it("rejects malformed API keys before authenticator work", async () => {
    const authenticate = vi.fn(async () => null);
    const oversizedKey = "a".repeat(257);
    const handler = createHandler({
      authenticator: {
        authenticate
      }
    });

    const oversizedResponse = await handler.handle({
      method: "POST",
      path: "/v1/clients",
      headers: {
        authorization: `Bearer ${oversizedKey}`
      },
      body: {
        externalId: "client-1",
        displayName: "Alice"
      }
    });
    const controlCharacterResponse = await handler.handle({
      method: "POST",
      path: "/v1/clients",
      headers: {
        "x-hulee-api-key": "valid-key\ninjected"
      },
      body: {
        externalId: "client-1",
        displayName: "Alice"
      }
    });

    expect(oversizedResponse.status).toBe(401);
    expect(controlCharacterResponse.status).toBe(401);
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("registers clients under the tenant resolved from the API key", async () => {
    const auditRecords: PublicApiAuditRecord[] = [];

    const response = await createHandler({ auditRecords }).handle({
      method: "POST",
      path: "/v1/clients",
      headers: {
        authorization: "Bearer valid-key"
      },
      body: {
        externalId: "client-1",
        displayName: "Alice"
      }
    });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      clientId: "client:client-1",
      externalId: "client-1",
      created: true
    });
    expect(auditRecords).toEqual([
      {
        requestId: "request-1",
        tenantId,
        apiKeyId: "api-key-1",
        action: "public_api.client.register",
        entityType: "client",
        entityId: "client:client-1",
        outcome: "success",
        status: 201
      }
    ]);
  });

  it("passes the versioned inbound request to the command boundary", async () => {
    const acceptInboundMessage = vi.fn(
      async (
        _context: PublicApiCommandContext,
        request: Parameters<PublicApiCommandService["acceptInboundMessage"]>[1]
      ) => ({
        clientId: `client:${request.clientExternalId}`,
        conversationId: "conversation-1",
        messageId: `message:${request.providerMessageId}`,
        accepted: true as const
      })
    );
    const commands = {
      ...createCommands(),
      acceptInboundMessage
    };

    const response = await createHandler({ commands }).handle({
      method: "POST",
      path: "/v1/messages/inbound",
      headers: {
        "x-hulee-api-key": "valid-key"
      },
      body: {
        clientExternalId: "client-1",
        channelExternalId: "public-api",
        providerMessageId: "provider-message-1",
        text: "Hello",
        occurredAt: "2026-06-22T07:00:00.000Z",
        idempotencyKey: "inbound-1"
      }
    });

    expect(response.status).toBe(202);
    expect(acceptInboundMessage).toHaveBeenCalledWith(
      {
        requestId: "request-1",
        tenantId,
        apiKeyId: "api-key-1"
      },
      {
        providerMessageId: "provider-message-1",
        channelExternalId: "public-api",
        clientExternalId: "client-1",
        text: "Hello",
        attachments: [],
        occurredAt: "2026-06-22T07:00:00.000Z",
        idempotencyKey: "inbound-1"
      }
    );
  });

  it("rejects caller scope and provider fields on inbound before command execution", async () => {
    const auditRecords: PublicApiAuditRecord[] = [];
    const acceptInboundMessage = vi.fn(createCommands().acceptInboundMessage);
    const commands = {
      ...createCommands(),
      acceptInboundMessage
    };

    const response = await createHandler({ commands, auditRecords }).handle({
      method: "POST",
      path: "/v1/messages/inbound",
      headers: {
        "x-hulee-api-key": "valid-key"
      },
      body: {
        tenantId: "caller-controlled-tenant",
        clientExternalId: "client-1",
        channelExternalId: "public-api",
        providerMessageId: "provider-message-1",
        text: "Hello",
        occurredAt: "2026-06-22T07:00:00.000Z",
        idempotencyKey: "inbound-1",
        providerSpecificFlag: true
      }
    });

    expect(response.status).toBe(400);
    expect(acceptInboundMessage).not.toHaveBeenCalled();
    expect(auditRecords).toEqual([
      {
        requestId: "request-1",
        tenantId,
        apiKeyId: "api-key-1",
        action: "public_api.message.inbound",
        entityType: "inbound_message",
        entityId: "*",
        outcome: "failure",
        status: 400,
        errorCode: "validation.failed"
      }
    ]);
  });

  it("rejects invalid request bodies before command execution", async () => {
    const auditRecords: PublicApiAuditRecord[] = [];
    const commands = {
      ...createCommands(),
      registerClient: vi.fn(createCommands().registerClient)
    };

    const response = await createHandler({ commands, auditRecords }).handle({
      method: "POST",
      path: "/v1/clients",
      headers: {
        authorization: "Bearer valid-key"
      },
      body: {
        externalId: "client-1",
        displayName: "Alice",
        providerSpecificFlag: true
      }
    });

    expect(response.status).toBe(400);
    expect(commands.registerClient).not.toHaveBeenCalled();
    expect(auditRecords).toEqual([
      {
        requestId: "request-1",
        tenantId,
        apiKeyId: "api-key-1",
        action: "public_api.client.register",
        entityType: "register_client",
        entityId: "*",
        outcome: "failure",
        status: 400,
        errorCode: "validation.failed"
      }
    ]);
  });

  it("reads delivery status from a tenant-scoped route", async () => {
    const response = await createHandler().handle({
      method: "GET",
      path: "/v1/messages/message-1/delivery-status",
      headers: {
        authorization: "Bearer valid-key"
      }
    });

    expect(response).toMatchObject({
      status: 200,
      body: {
        messageId: "message-1",
        status: "queued"
      }
    });
  });
});
