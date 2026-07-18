import { sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { createInterface } from "node:readline";

import {
  inboxV2ConversationIdSchema,
  inboxV2ConversationPurposeIdSchema,
  inboxV2ConversationWorkItemSlotSchema,
  inboxV2TenantIdSchema,
  inboxV2WorkItemCreationCommitSchema,
  inboxV2WorkItemIdSchema,
  inboxV2WorkItemSchema,
  inboxV2WorkItemTransitionCommitSchema,
  inboxV2WorkQueueIdSchema,
  inboxV2WorkQueueSchema,
  type InboxV2ConversationWorkItemSlot,
  type InboxV2WorkItem,
  type InboxV2WorkItemCreationCommit
} from "@hulee/contracts";
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
import { createSqlInboxV2ConversationRepository } from "../../../../packages/db/src/repositories/sql-inbox-v2-conversation-repository";
import { createSqlOutboxRepository } from "../../../../packages/db/src/repositories/sql-outbox-repository";
import { createSqlInboxV2WorkItemRepository } from "../../../../packages/db/src/repositories/sql-inbox-v2-work-item-repository";
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
const WORK_T0 = "2026-07-16T08:03:00.000Z";
const WORK_T1 = "2026-07-16T08:04:00.000Z";
const WORK_T2 = "2026-07-16T08:05:00.000Z";

type BackendIdentity = {
  pid: number;
  backendStart: string;
};

type ProtocolCommand = {
  command?: unknown;
};

type N1WorkFixture = Readonly<{
  tenantId: ReturnType<typeof inboxV2TenantIdSchema.parse>;
  queueId: ReturnType<typeof inboxV2WorkQueueIdSchema.parse>;
  orgUnitId: string;
  migrationGap: InboxV2WorkItemCreationCommit;
  postExpandFirst: InboxV2WorkItemCreationCommit;
}>;

type LegacyWorkRepository = ReturnType<
  typeof createSqlInboxV2WorkItemRepository
>;
type LegacyWorkCreationResult = Awaited<
  ReturnType<LegacyWorkRepository["createWorkItem"]>
>;

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
  const n1Work = await prepareN1WorkFixture(workspace.tenant.id);
  const legacyWorkRepository = createSqlInboxV2WorkItemRepository(database);
  let migrationGapCreation:
    | ReturnType<typeof legacyWorkRepository.createWorkItem>
    | undefined;
  let migrationGapCreated = false;

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
      inboundMessageId: workspace.inboundMessage.id,
      migrationGapConversationId:
        n1Work.migrationGap.createdWorkItem.conversation.id,
      postExpandWorkConversationId:
        n1Work.postExpandFirst.createdWorkItem.conversation.id
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
    if (command.command === "start-legacy-work-item-create") {
      if (
        !failedMigrationProbeCompleted ||
        migrationGapCreation !== undefined
      ) {
        throw new Error(
          "DB-008 legacy WorkItem creation requires the failed-migration probe and can start once."
        );
      }
      migrationGapCreation = legacyWorkRepository.createWorkItem(
        n1Work.migrationGap
      );
      void migrationGapCreation.catch(() => {});
      writeProtocolMessage({
        type: "legacy-work-item-started",
        protocolVersion: PROTOCOL_VERSION,
        conversationId: n1Work.migrationGap.createdWorkItem.conversation.id,
        workItemId: n1Work.migrationGap.createdWorkItem.id
      });
      continue;
    }
    if (command.command === "await-legacy-work-item-create") {
      if (migrationGapCreation === undefined || migrationGapCreated) {
        throw new Error("DB-008 legacy WorkItem creation is not pending.");
      }
      const result = await migrationGapCreation;
      migrationGapCreated = result.kind === "created";
      writeProtocolMessage({
        type: "legacy-work-item-created",
        protocolVersion: PROTOCOL_VERSION,
        result: summarizeWorkItemCreation(result)
      });
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
    if (!migrationGapCreated) {
      throw new Error(
        "DB-008 migration-gap legacy WorkItem probe is required before after-expand."
      );
    }

    const result = await runAfterExpand({
      baseContext,
      workspace,
      beforeBackend,
      queryService,
      commandService,
      n1Work
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
  n1Work: N1WorkFixture;
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
  const legacyWorkRepository = createSqlInboxV2WorkItemRepository(database);
  const migrationGapReplay = await legacyWorkRepository.createWorkItem(
    input.n1Work.migrationGap
  );
  if (migrationGapReplay.kind !== "already_applied") {
    throw new Error(
      `DB-008 N-1 migration-gap WorkItem replay was not idempotent: ${migrationGapReplay.kind}.`
    );
  }
  const firstWorkItem = await legacyWorkRepository.createWorkItem(
    input.n1Work.postExpandFirst
  );
  if (firstWorkItem.kind !== "created") {
    throw new Error(
      `DB-008 N-1 first post-expand WorkItem was not created: ${firstWorkItem.kind}.`
    );
  }
  const closeCommit = terminalCloseCommit(
    {
      workItem: firstWorkItem.workItem,
      slot: firstWorkItem.slot
    },
    input.n1Work,
    "post-expand",
    WORK_T1
  );
  const closedWorkItem =
    await legacyWorkRepository.applyTransition(closeCommit);
  if (closedWorkItem.kind !== "applied") {
    throw new Error(
      `DB-008 N-1 post-expand WorkItem close was not applied: ${closedWorkItem.kind}.`
    );
  }
  const secondCommit = sequentialCreationCommit(
    input.n1Work,
    closedWorkItem.workItem,
    closedWorkItem.slot
  );
  const secondWorkItem =
    await legacyWorkRepository.createWorkItem(secondCommit);
  if (secondWorkItem.kind !== "created") {
    throw new Error(
      `DB-008 N-1 sequential post-expand WorkItem was not created: ${secondWorkItem.kind}.`
    );
  }
  const workHeads = await database.execute<{
    conversation_id: string;
    work_item_count: number | string;
    intake_decision_high_water: number | string;
    pending_materialization_ordinal: number | string | null;
    revision: number | string;
  }>(sql`
    select conversation_id, work_item_count, intake_decision_high_water,
           pending_materialization_ordinal, revision
    from inbox_v2_conversation_work_heads
    where tenant_id = ${input.n1Work.tenantId}
      and conversation_id in (
        ${input.n1Work.migrationGap.createdWorkItem.conversation.id},
        ${input.n1Work.postExpandFirst.createdWorkItem.conversation.id}
      )
    order by conversation_id
  `);
  const workHeadByConversation = new Map(
    workHeads.rows.map((row) => [row.conversation_id, row])
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
    legacyWork: {
      migrationGapReplay: summarizeWorkItemCreation(migrationGapReplay),
      migrationGapHead:
        workHeadByConversation.get(
          input.n1Work.migrationGap.createdWorkItem.conversation.id
        ) ?? null,
      first: summarizeWorkItemCreation(firstWorkItem),
      close: {
        kind: closedWorkItem.kind,
        workItemId: closedWorkItem.workItem.id,
        state: closedWorkItem.workItem.operationalState.state,
        slotRevision: closedWorkItem.slot.revision
      },
      second: summarizeWorkItemCreation(secondWorkItem),
      head:
        workHeadByConversation.get(
          input.n1Work.postExpandFirst.createdWorkItem.conversation.id
        ) ?? null
    },
    outboxStatuses: outboxStatuses.rows.map((row) => ({
      status: row.status,
      count: Number(row.row_count)
    }))
  };
}

async function prepareN1WorkFixture(
  tenantIdInput: string
): Promise<N1WorkFixture> {
  const tenantId = inboxV2TenantIdSchema.parse(tenantIdInput);
  const queueId = inboxV2WorkQueueIdSchema.parse("work_queue:db008-n1-work");
  const orgUnitId = "org_unit:db008-n1-work";
  await database.transaction(async (transaction) => {
    await transaction.execute(sql`
      insert into org_units (
        id, tenant_id, name, kind, status, created_at, updated_at
      ) values (
        ${orgUnitId}, ${tenantId}, 'DB-008 N-1 Work', 'department',
        'active', ${WORK_T0}, ${WORK_T0}
      )
    `);
    await transaction.execute(sql`
      insert into work_queues (
        id, tenant_id, name, kind, owning_org_unit_id, status,
        routing_config, created_at, updated_at
      ) values (
        ${queueId}, ${tenantId}, 'DB-008 N-1 Work', 'support',
        ${orgUnitId}, 'active', '{}'::jsonb, ${WORK_T0}, ${WORK_T0}
      )
    `);
  });

  const conversationRepository =
    createSqlInboxV2ConversationRepository(database);
  const migrationGapConversationId = inboxV2ConversationIdSchema.parse(
    "conversation:db008-n1-migration-gap"
  );
  const postExpandConversationId = inboxV2ConversationIdSchema.parse(
    "conversation:db008-n1-post-expand-work"
  );
  for (const [conversationId, streamPosition] of [
    [migrationGapConversationId, "1"],
    [postExpandConversationId, "2"]
  ] as const) {
    const created = await conversationRepository.create({
      tenantId,
      conversationId,
      topology: "direct",
      transport: "external",
      purposeId: inboxV2ConversationPurposeIdSchema.parse("core:support"),
      lifecycle: "active",
      streamPosition: streamPosition as never,
      createdAt: WORK_T0
    });
    if (created.kind !== "created") {
      throw new Error(
        `DB-008 could not create N-1 WorkItem fixture Conversation: ${created.kind}.`
      );
    }
  }

  const fixture = {
    tenantId,
    queueId,
    orgUnitId
  };
  return {
    ...fixture,
    migrationGap: creationCommit(
      fixture,
      migrationGapConversationId,
      "migration-gap",
      WORK_T0
    ),
    postExpandFirst: creationCommit(
      fixture,
      postExpandConversationId,
      "post-expand-first",
      WORK_T0
    )
  };
}

function creationCommit(
  fixture: Pick<N1WorkFixture, "tenantId" | "queueId" | "orgUnitId">,
  conversationId: ReturnType<typeof inboxV2ConversationIdSchema.parse>,
  suffix: string,
  decidedAt: string
): InboxV2WorkItemCreationCommit {
  const { tenantId, queueId, orgUnitId } = fixture;
  const workItemId = inboxV2WorkItemIdSchema.parse(
    `work_item:db008-n1-${suffix}`
  );
  const conversation = {
    tenantId,
    kind: "conversation" as const,
    id: conversationId
  };
  const workItem = {
    tenantId,
    kind: "work_item" as const,
    id: workItemId
  };
  const slotBefore = inboxV2ConversationWorkItemSlotSchema.parse({
    tenantId,
    id: conversationWorkItemSlotId(tenantId, conversationId),
    conversation,
    latestOrdinal: "0",
    latestWorkItem: null,
    currentNonTerminalWorkItem: null,
    revision: "1",
    createdAt: WORK_T0,
    updatedAt: WORK_T0
  });
  const queueReference = {
    tenantId,
    kind: "work_queue" as const,
    id: queueId
  };
  const createdWorkItem = inboxV2WorkItemSchema.parse({
    tenantId,
    id: workItemId,
    conversation,
    ordinal: "1",
    operationalState: {
      state: "new",
      activeQueue: { queue: queueReference, queueRevision: "1" },
      primaryAssignment: null,
      terminal: null
    },
    priorityId: "core:normal",
    sla: { kind: "not_applied", reasonId: "core:no-sla-policy" },
    currentServicingTeam: null,
    servicingTeamRelationRevision: "1",
    collaboratorSetRevision: "1",
    resourceAccessRevision: "1",
    reopenCycle: "0",
    lastReopen: null,
    createdBy: {
      kind: "trusted_service",
      trustedServiceId: "core:work-intake"
    },
    creationReasonId: "core:external-actionable-input",
    revision: "1",
    createdAt: decidedAt,
    updatedAt: decidedAt
  });
  const slotAfter = inboxV2ConversationWorkItemSlotSchema.parse({
    ...slotBefore,
    latestOrdinal: "1",
    latestWorkItem: {
      workItem,
      ordinal: "1",
      lifecycleClass: "non_terminal",
      lifecycleFenceRevision: "1"
    },
    currentNonTerminalWorkItem: { workItem, ordinal: "1" },
    revision: "2",
    updatedAt: decidedAt
  });
  return inboxV2WorkItemCreationCommitSchema.parse({
    tenantId,
    intakeDecision: {
      tenantId,
      conversation,
      transport: "external",
      policyId: "core:default-actionability",
      policyVersion: "v1",
      policyRevision: "1",
      decisionRevision: "1",
      decidedByTrustedServiceId: "core:work-intake",
      decidedAt,
      outcome: "create_work_item",
      queue: queueReference,
      latestTerminalHandling: "no_latest_work_item",
      reasonId: "core:external-actionable-input"
    },
    queueSnapshot: inboxV2WorkQueueSchema.parse({
      tenantId,
      id: queueId,
      ownerOrgUnit: { tenantId, kind: "org_unit", id: orgUnitId },
      lifecycle: "active",
      eligibilityPolicy: {
        policyId: "core:active-queue-member",
        policyVersion: "v1",
        policyRevision: "1"
      },
      externalReplyPolicy: {
        mode: "responsible_only",
        policyVersion: "v1",
        policyRevision: "1"
      },
      defaultPriorityId: "core:normal",
      defaultSlaPolicy: { kind: "not_applied" },
      resourceAccessRevision: "1",
      revision: "1",
      createdAt: WORK_T0,
      updatedAt: WORK_T0
    }),
    slotBefore,
    previousLatestWorkItem: null,
    createdWorkItem,
    slotAfter,
    occurredAt: decidedAt
  });
}

function terminalCloseCommit(
  value: Readonly<{
    workItem: InboxV2WorkItem;
    slot: InboxV2ConversationWorkItemSlot;
  }>,
  fixture: N1WorkFixture,
  suffix: string,
  occurredAt: string
) {
  const before = value.workItem;
  const sourceQueue = before.operationalState.activeQueue;
  if (sourceQueue === null) {
    throw new Error("Expected an active Queue before terminal transition.");
  }
  const actor = {
    kind: "trusted_service" as const,
    trustedServiceId: "core:db008-n1-work"
  };
  const transition = {
    tenantId: fixture.tenantId,
    id: `work_item_transition:db008-n1-close-${suffix}`,
    workItem: {
      tenantId: fixture.tenantId,
      kind: "work_item" as const,
      id: before.id
    },
    kind: "close_resolved" as const,
    fromState: before.operationalState.state,
    toState: "resolved" as const,
    sourceQueue,
    destinationQueue: sourceQueue,
    actor,
    reasonId: "core:resolved",
    expectedRevision: before.revision,
    resultingRevision: plusOne(before.revision),
    occurredAt
  };
  const after = inboxV2WorkItemSchema.parse({
    ...before,
    operationalState: {
      state: "resolved",
      activeQueue: null,
      primaryAssignment: null,
      terminal: {
        closedByTransition: {
          tenantId: fixture.tenantId,
          kind: "work_item_transition",
          id: transition.id
        },
        reasonId: transition.reasonId,
        closedBy: actor,
        closedAt: occurredAt,
        finalQueue: sourceQueue,
        finalServicingTeam: null,
        finalPrimary: null
      }
    },
    resourceAccessRevision: plusOne(before.resourceAccessRevision),
    revision: transition.resultingRevision,
    updatedAt: occurredAt
  });
  const slotAfter = inboxV2ConversationWorkItemSlotSchema.parse({
    ...value.slot,
    latestWorkItem: {
      workItem: transition.workItem,
      ordinal: before.ordinal,
      lifecycleClass: "terminal",
      lifecycleFenceRevision: transition.resultingRevision
    },
    currentNonTerminalWorkItem: null,
    revision: plusOne(value.slot.revision),
    updatedAt: occurredAt
  });
  return inboxV2WorkItemTransitionCommitSchema.parse({
    tenantId: fixture.tenantId,
    before,
    transition,
    after,
    sourceResponsibility: null,
    assignmentEffect: { kind: "none" },
    servicingTeamEffect: { kind: "none" },
    destinationQueueSnapshot: null,
    slotBefore: value.slot,
    slotAfter
  });
}

function sequentialCreationCommit(
  fixture: N1WorkFixture,
  previousLatestWorkItem: InboxV2WorkItem,
  slotBefore: InboxV2ConversationWorkItemSlot
): InboxV2WorkItemCreationCommit {
  const template = fixture.postExpandFirst;
  const workItemId = inboxV2WorkItemIdSchema.parse(
    "work_item:db008-n1-post-expand-second"
  );
  const workItem = {
    tenantId: fixture.tenantId,
    kind: "work_item" as const,
    id: workItemId
  };
  const createdWorkItem = inboxV2WorkItemSchema.parse({
    ...template.createdWorkItem,
    id: workItemId,
    ordinal: plusOne(previousLatestWorkItem.ordinal),
    createdAt: WORK_T2,
    updatedAt: WORK_T2
  });
  const slotAfter = inboxV2ConversationWorkItemSlotSchema.parse({
    ...slotBefore,
    latestOrdinal: createdWorkItem.ordinal,
    latestWorkItem: {
      workItem,
      ordinal: createdWorkItem.ordinal,
      lifecycleClass: "non_terminal",
      lifecycleFenceRevision: "1"
    },
    currentNonTerminalWorkItem: {
      workItem,
      ordinal: createdWorkItem.ordinal
    },
    revision: plusOne(slotBefore.revision),
    updatedAt: WORK_T2
  });
  return inboxV2WorkItemCreationCommitSchema.parse({
    ...template,
    intakeDecision: {
      ...template.intakeDecision,
      decisionRevision: "1",
      decidedAt: WORK_T2,
      latestTerminalHandling: "create_sequential"
    },
    slotBefore,
    previousLatestWorkItem,
    createdWorkItem,
    slotAfter,
    occurredAt: WORK_T2
  });
}

function summarizeWorkItemCreation(
  result: LegacyWorkCreationResult
): Record<string, unknown> {
  if (result.kind !== "created" && result.kind !== "already_applied") {
    return { kind: result.kind };
  }
  return {
    kind: result.kind,
    workItemId: result.workItem.id,
    ordinal: result.workItem.ordinal,
    slotRevision: result.slot.revision
  };
}

function conversationWorkItemSlotId(
  tenantId: ReturnType<typeof inboxV2TenantIdSchema.parse>,
  conversationId: ReturnType<typeof inboxV2ConversationIdSchema.parse>
): string {
  return `conversation_work_item_slot:${createHash("sha256")
    .update(`${tenantId}\u001f${conversationId}`, "utf8")
    .digest("hex")}`;
}

function plusOne(value: string): string {
  return (BigInt(value) + 1n).toString();
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
