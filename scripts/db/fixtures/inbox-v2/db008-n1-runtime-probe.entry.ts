import { sql } from "drizzle-orm";
import { createInterface } from "node:readline";

import {
  createInternalInboxCommandService,
  createSqlInternalInboxQueryService,
  type InternalInboxAuthorizationService,
  type InternalInboxCommandContext
} from "../../../../apps/api/src/internal-inbox-service";
import { loadInboxViewModel } from "../../../../apps/web/src/inbox-api-client";
import { processOutboxBatch } from "../../../../apps/worker/src/outbox-processor";
import { createSequentialIdFactory } from "../../../../packages/core/src/ids";
import { createMvpTenantWorkspace } from "../../../../packages/core/src/vertical-slice";
import {
  closeHuleeDatabase,
  createHuleeDatabase
} from "../../../../packages/db/src/client";
import { createDrizzlePersistenceExecutor } from "../../../../packages/db/src/repositories/drizzle-persistence-executor";
import { createExternalMessageRepository } from "../../../../packages/db/src/repositories/external-message-repository";
import { createSqlOutboxRepository } from "../../../../packages/db/src/repositories/sql-outbox-repository";
import { createTenantWorkspaceRepository } from "../../../../packages/db/src/repositories/drizzle-tenant-workspace-repository";

const SOURCE_REVISION = "3b9d703bb63d5ce39ea549d62413dee02d1969a0";
const ARTIFACT_KIND = "n-1-compatibility-build";
const COMPATIBILITY_PATCH_ID = "db008-n1-routing-returning-qualification-v1";
const RUNTIME_BOUNDARY = "source-bundled-process-harness";
const PROTOCOL_VERSION = 1;
const SEED_NOW = "2026-07-16T08:00:00.000Z";
const PRE_WORKER_NOW = "2026-07-16T08:00:30.000Z";
const PRE_MIGRATION_NOW = "2026-07-16T08:01:00.000Z";
const POST_MIGRATION_NOW = "2026-07-16T08:02:00.000Z";
const PRE_REPLY_IDEMPOTENCY_KEY = "db008:n-1:reply:before-expand";
const POST_REPLY_IDEMPOTENCY_KEY = "db008:n-1:reply:after-expand";

type BackendIdentity = {
  pid: number;
  backendStart: string;
};

type ProtocolCommand = {
  command?: unknown;
};

const connectionString = process.env.HULEE_DB008_DATABASE_URL;

if (connectionString === undefined || connectionString.trim().length === 0) {
  throw new Error("HULEE_DB008_DATABASE_URL is required.");
}

const database = createHuleeDatabase({
  connectionString,
  poolConfig: {
    max: 1,
    min: 1,
    idleTimeoutMillis: 0
  }
});
const originalFetch = globalThis.fetch;
let closed = false;

const authorization: InternalInboxAuthorizationService = {
  async filterConversations(_context, input) {
    return input.conversations;
  },
  async assertConversationAccess() {}
};

async function main(): Promise<void> {
  const persistenceExecutor = createDrizzlePersistenceExecutor(database);
  const workspace = createMvpTenantWorkspace({
    now: SEED_NOW,
    tenantSlug: "db008-n1",
    tenantDisplayName: "DB-008 N-1 Tenant",
    productName: "Hulee N-1",
    adminEmail: "db008-n1@example.invalid",
    clientDisplayName: "DB-008 N-1 Client",
    inboundText: "N-1 inbound before expand",
    enabledModules: ["channel-public-api"],
    idFactory: createSequentialIdFactory("db008-n1")
  });

  await createTenantWorkspaceRepository(persistenceExecutor).saveWorkspace(
    workspace
  );

  const repository = createExternalMessageRepository({
    rawExecutor: database,
    persistenceExecutor
  });
  const queryService = createSqlInternalInboxQueryService({
    database,
    authorization
  });
  const commandService = createInternalInboxCommandService({
    repository,
    authorization,
    now: () => new Date(PRE_MIGRATION_NOW),
    idFactory: (context) =>
      createSequentialIdFactory(`db008-n1-${context.requestId}`)
  });
  const baseContext = {
    tenantId: workspace.tenant.id,
    employeeId: workspace.admin.id
  };

  globalThis.fetch = createInProcessInboxFetch({
    baseContext,
    queryService,
    commandService
  });

  const initialApiView = await queryService.loadInboxView(
    requestContext(baseContext, "api-query-before"),
    { selectedConversationId: workspace.conversation.id }
  );
  const preWorker = await runWorkerProbe(new Date(PRE_WORKER_NOW));
  const preReply = await commandService.sendReply(
    requestContext(baseContext, "api-reply-before"),
    {
      conversationId: workspace.conversation.id,
      request: {
        text: "N-1 reply before expand",
        idempotencyKey: PRE_REPLY_IDEMPOTENCY_KEY
      }
    }
  );
  const preRouting = await commandService.updateConversationRouting(
    requestContext(baseContext, "api-routing-before"),
    {
      conversationId: workspace.conversation.id,
      request: { assignedEmployeeId: workspace.admin.id }
    }
  );
  const preWebView = await loadInboxViewModel({
    selectedConversationId: workspace.conversation.id,
    assignedToMe: true
  });
  const beforeBackend = await readBackendIdentity();

  writeProtocolMessage({
    type: "ready",
    protocolVersion: PROTOCOL_VERSION,
    sourceRevision: SOURCE_REVISION,
    artifactKind: ARTIFACT_KIND,
    compatibilityPatchId: COMPATIBILITY_PATCH_ID,
    runtimeBoundary: RUNTIME_BOUNDARY,
    environmentKeys: Object.keys(process.env).sort(),
    processPid: process.pid,
    backend: beforeBackend,
    workspace: {
      tenantId: workspace.tenant.id,
      employeeId: workspace.admin.id,
      clientId: workspace.client.id,
      conversationId: workspace.conversation.id,
      inboundMessageId: workspace.inboundMessage.id
    },
    api: {
      initialConversationCount: initialApiView.conversations.length,
      initialMessageCount: initialApiView.messages.length,
      preReply,
      preRouting: normalizeRouting(preRouting)
    },
    web: summarizeView(preWebView),
    worker: preWorker
  });

  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  let failedMigrationProbeCompleted = false;
  for await (const line of lines) {
    if (line.trim().length === 0) continue;
    const command = JSON.parse(line) as ProtocolCommand;
    if (command.command === "after-failed-migration") {
      if (failedMigrationProbeCompleted) {
        throw new Error("DB-008 failed-migration probe was already completed.");
      }
      const result = await runAfterFailedMigration({
        baseContext,
        workspace,
        beforeBackend,
        queryService,
        commandService,
        preReplyMessageId: preReply.messageId
      });
      failedMigrationProbeCompleted = true;
      writeProtocolMessage(result);
      continue;
    }
    if (command.command !== "after-expand") {
      throw new Error(`Unsupported DB-008 command: ${String(command.command)}`);
    }
    if (!failedMigrationProbeCompleted) {
      throw new Error(
        "DB-008 after-failed-migration probe is required before after-expand."
      );
    }

    const result = await runAfterExpand({
      baseContext,
      workspace,
      beforeBackend,
      queryService,
      commandService
    });
    await close();
    writeProtocolMessage(result);
    return;
  }

  throw new Error("DB-008 protocol ended before after-expand.");
}

async function runAfterFailedMigration(input: {
  baseContext: Pick<InternalInboxCommandContext, "tenantId" | "employeeId">;
  workspace: ReturnType<typeof createMvpTenantWorkspace>;
  beforeBackend: BackendIdentity;
  queryService: ReturnType<typeof createSqlInternalInboxQueryService>;
  commandService: ReturnType<typeof createInternalInboxCommandService>;
  preReplyMessageId: string;
}): Promise<Record<string, unknown>> {
  const backend = await readBackendIdentity();
  const apiView = await input.queryService.loadInboxView(
    requestContext(input.baseContext, "api-query-after-failed-migration"),
    { selectedConversationId: input.workspace.conversation.id }
  );
  const webView = await loadInboxViewModel({
    selectedConversationId: input.workspace.conversation.id,
    assignedToMe: true
  });
  const retriedPreReply = await input.commandService.sendReply(
    requestContext(input.baseContext, "api-reply-retry-after-failure"),
    {
      conversationId: input.workspace.conversation.id,
      request: {
        text: "N-1 reply before expand",
        idempotencyKey: PRE_REPLY_IDEMPOTENCY_KEY
      }
    }
  );
  if (retriedPreReply.messageId !== input.preReplyMessageId) {
    throw new Error(
      "DB-008 failed-migration idempotent reply returned a different message."
    );
  }

  return {
    type: "after-failed-migration",
    protocolVersion: PROTOCOL_VERSION,
    sourceRevision: SOURCE_REVISION,
    artifactKind: ARTIFACT_KIND,
    compatibilityPatchId: COMPATIBILITY_PATCH_ID,
    runtimeBoundary: RUNTIME_BOUNDARY,
    processPid: process.pid,
    backend,
    sameBackend:
      backend.pid === input.beforeBackend.pid &&
      backend.backendStart === input.beforeBackend.backendStart,
    api: {
      view: summarizeView(apiView),
      retriedPreReply,
      assignedEmployeeId:
        apiView.selectedConversation?.assignedEmployeeId ?? null
    },
    web: summarizeView(webView)
  };
}

async function runAfterExpand(input: {
  baseContext: Pick<InternalInboxCommandContext, "tenantId" | "employeeId">;
  workspace: ReturnType<typeof createMvpTenantWorkspace>;
  beforeBackend: BackendIdentity;
  queryService: ReturnType<typeof createSqlInternalInboxQueryService>;
  commandService: ReturnType<typeof createInternalInboxCommandService>;
}): Promise<Record<string, unknown>> {
  const afterBackend = await readBackendIdentity();
  const beforeWriteApiView = await input.queryService.loadInboxView(
    requestContext(input.baseContext, "api-query-after-expand"),
    { selectedConversationId: input.workspace.conversation.id }
  );
  const beforeWriteWebView = await loadInboxViewModel({
    selectedConversationId: input.workspace.conversation.id,
    assignedToMe: true
  });
  const retriedPreReply = await input.commandService.sendReply(
    requestContext(input.baseContext, "api-reply-retry-after-expand"),
    {
      conversationId: input.workspace.conversation.id,
      request: {
        text: "N-1 reply before expand",
        idempotencyKey: PRE_REPLY_IDEMPOTENCY_KEY
      }
    }
  );
  const postMigrationCommandService = createInternalInboxCommandService({
    repository: createExternalMessageRepository({
      rawExecutor: database,
      persistenceExecutor: createDrizzlePersistenceExecutor(database)
    }),
    authorization,
    now: () => new Date(POST_MIGRATION_NOW),
    idFactory: (context) =>
      createSequentialIdFactory(`db008-n1-${context.requestId}`)
  });
  const postReply = await postMigrationCommandService.sendReply(
    requestContext(input.baseContext, "api-reply-after-expand"),
    {
      conversationId: input.workspace.conversation.id,
      request: {
        text: "N-1 reply after expand",
        idempotencyKey: POST_REPLY_IDEMPOTENCY_KEY
      }
    }
  );
  const postRouting =
    await postMigrationCommandService.updateConversationRouting(
      requestContext(input.baseContext, "api-routing-after-expand"),
      {
        conversationId: input.workspace.conversation.id,
        request: { assignedEmployeeId: null }
      }
    );
  const worker = await runWorkerProbe(new Date(POST_MIGRATION_NOW));
  const finalApiView = await input.queryService.loadInboxView(
    requestContext(input.baseContext, "api-query-final"),
    { selectedConversationId: input.workspace.conversation.id }
  );
  const outboxStatuses = await database.execute<{
    status: string;
    row_count: number | string;
  }>(sql`
    select status, count(*)::int as row_count
      from outbox
     where tenant_id = ${input.workspace.tenant.id}
     group by status
     order by status
  `);

  return {
    type: "after-expand",
    protocolVersion: PROTOCOL_VERSION,
    sourceRevision: SOURCE_REVISION,
    artifactKind: ARTIFACT_KIND,
    compatibilityPatchId: COMPATIBILITY_PATCH_ID,
    runtimeBoundary: RUNTIME_BOUNDARY,
    processPid: process.pid,
    backend: afterBackend,
    sameBackend:
      afterBackend.pid === input.beforeBackend.pid &&
      afterBackend.backendStart === input.beforeBackend.backendStart,
    api: {
      beforeWrite: summarizeView(beforeWriteApiView),
      retriedPreReply,
      postReply,
      postRouting: normalizeRouting(postRouting),
      final: summarizeView(finalApiView)
    },
    web: summarizeView(beforeWriteWebView),
    worker,
    outboxStatuses: outboxStatuses.rows.map((row) => ({
      status: row.status,
      count: Number(row.row_count)
    }))
  };
}

async function runWorkerProbe(now: Date): Promise<Record<string, unknown>> {
  const handled: Array<{
    id: string;
    eventId: string;
    type: string;
    messageId: unknown;
  }> = [];
  const result = await processOutboxBatch({
    repository: createSqlOutboxRepository(database),
    handler: {
      async handle(record) {
        handled.push({
          id: record.id,
          eventId: record.eventId,
          type: record.payload.type,
          messageId: record.payload.payload.messageId
        });
      }
    },
    batchSize: 100,
    now
  });
  return {
    handler: "fake-no-provider",
    ...result,
    handled,
    messageSentIds: handled
      .filter((record) => record.type === "message.sent")
      .map((record) => record.messageId)
  };
}

function createInProcessInboxFetch(input: {
  baseContext: Pick<InternalInboxCommandContext, "tenantId" | "employeeId">;
  queryService: ReturnType<typeof createSqlInternalInboxQueryService>;
  commandService: ReturnType<typeof createInternalInboxCommandService>;
}): typeof fetch {
  return async (requestInput, init) => {
    const requestUrl =
      requestInput instanceof URL
        ? requestInput
        : new URL(
            typeof requestInput === "string" ? requestInput : requestInput.url
          );
    const method = (init?.method ?? "GET").toUpperCase();
    const context = requestContext(
      input.baseContext,
      `web-${method.toLowerCase()}-${requestUrl.pathname}`
    );

    try {
      if (method === "GET" && requestUrl.pathname === "/internal/v1/inbox") {
        const view = await input.queryService.loadInboxView(context, {
          selectedConversationId:
            requestUrl.searchParams.get("conversationId") ?? undefined,
          filters: {
            queueId: requestUrl.searchParams.get("queueId") ?? undefined,
            assignedToMe: requestUrl.searchParams.get("assigned") === "me"
          }
        });
        return jsonResponse(view);
      }

      const route = requestUrl.pathname.match(
        /^\/internal\/v1\/inbox\/conversations\/([^/]+)\/(replies|routing)$/u
      );
      if (route !== null && method === "POST" && route[2] === "replies") {
        const reply = await input.commandService.sendReply(context, {
          conversationId: decodeURIComponent(route[1]),
          request: parseRequestBody(init?.body)
        });
        return jsonResponse(reply);
      }
      if (route !== null && method === "PATCH" && route[2] === "routing") {
        const routing = await input.commandService.updateConversationRouting(
          context,
          {
            conversationId: decodeURIComponent(route[1]),
            request: parseRequestBody(init?.body)
          }
        );
        return jsonResponse(routing);
      }

      return jsonResponse({ error: "not_found" }, 404);
    } catch (error) {
      return jsonResponse(
        {
          error: error instanceof Error ? error.message : String(error)
        },
        500
      );
    }
  };
}

function parseRequestBody(body: BodyInit | null | undefined): never {
  if (typeof body !== "string") {
    throw new Error("DB-008 in-process request body must be JSON text.");
  }
  return JSON.parse(body) as never;
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

function requestContext(
  base: Pick<InternalInboxCommandContext, "tenantId" | "employeeId">,
  requestId: string
): InternalInboxCommandContext {
  return { ...base, requestId };
}

async function readBackendIdentity(): Promise<BackendIdentity> {
  const result = await database.execute<{
    pid: number;
    backend_start: Date | string;
  }>(sql`
    select pg_backend_pid()::int as pid,
           backend_start
      from pg_stat_activity
     where pid = pg_backend_pid()
  `);
  const row = result.rows[0];
  if (row === undefined)
    throw new Error("PostgreSQL backend identity missing.");
  return {
    pid: Number(row.pid),
    backendStart: new Date(row.backend_start).toISOString()
  };
}

function summarizeView(view: {
  conversations: readonly unknown[];
  messages: readonly { id: string; direction: string }[];
  selectedConversation?: { id: string };
}): Record<string, unknown> {
  return {
    conversationCount: view.conversations.length,
    messageCount: view.messages.length,
    selectedConversationId: view.selectedConversation?.id ?? null,
    messageIds: view.messages.map((message) => message.id),
    directions: view.messages.map((message) => message.direction)
  };
}

function normalizeRouting(input: {
  conversationId: string;
  currentQueueId?: string;
  assignedEmployeeId?: string;
  assignedTeamId?: string;
}): Record<string, string | null> {
  return {
    conversationId: input.conversationId,
    currentQueueId: input.currentQueueId ?? null,
    assignedEmployeeId: input.assignedEmployeeId ?? null,
    assignedTeamId: input.assignedTeamId ?? null
  };
}

function writeProtocolMessage(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

async function close(): Promise<void> {
  if (closed) return;
  closed = true;
  globalThis.fetch = originalFetch;
  await closeHuleeDatabase(database);
}

main().catch(async (error) => {
  await close().catch(() => {});
  writeProtocolMessage({
    type: "fatal",
    protocolVersion: PROTOCOL_VERSION,
    sourceRevision: SOURCE_REVISION,
    artifactKind: ARTIFACT_KIND,
    compatibilityPatchId: COMPATIBILITY_PATCH_ID,
    runtimeBoundary: RUNTIME_BOUNDARY,
    error: serializeError(error)
  });
  process.exitCode = 1;
});

function serializeError(error: unknown, depth = 0): Record<string, unknown> {
  if (!(error instanceof Error)) return { message: String(error) };
  const details = error as Error & {
    cause?: unknown;
    code?: unknown;
    detail?: unknown;
    schema?: unknown;
    table?: unknown;
    constraint?: unknown;
  };
  return {
    message: error.message,
    stack: error.stack,
    code: details.code,
    detail: details.detail,
    schema: details.schema,
    table: details.table,
    constraint: details.constraint,
    cause:
      details.cause === undefined || depth >= 3
        ? undefined
        : serializeError(details.cause, depth + 1)
  };
}
