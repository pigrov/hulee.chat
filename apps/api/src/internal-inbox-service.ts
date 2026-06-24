import {
  normalizeBrandThemeTokens,
  resolveBrandProfile
} from "@hulee/branding";
import type {
  ConversationId,
  EmployeeId,
  InternalInboxBrandProfile,
  InternalInboxConversation,
  InternalInboxConversationRoutingUpdateRequest,
  InternalInboxConversationRoutingUpdateResponse,
  InternalInboxMessage,
  InternalInboxReplyRequest,
  InternalInboxReplyResponse,
  InternalInboxTenantContext,
  InternalInboxViewResponse,
  TenantId
} from "@hulee/contracts";
import {
  assignConversationRouting,
  canAccess,
  CoreError,
  createSequentialIdFactory,
  queueExternalOutboundMessage,
  resolveEffectivePermissionGrants,
  type IdFactory,
  type Permission,
  type PermissionActor,
  type PermissionResourceContext
} from "@hulee/core";
import type {
  EmployeeDirectoryRepository,
  ExternalMessageRepository,
  HuleeDatabase,
  TenantEmployeeRecord,
  TenantRbacRepository
} from "@hulee/db";
import {
  createSqlEmployeeDirectoryRepository,
  createSqlTenantRbacRepository
} from "@hulee/db";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

export type InternalInboxCommandContext = {
  requestId: string;
  tenantId: TenantId;
  employeeId: EmployeeId;
};

export type InternalInboxQueryContext = InternalInboxCommandContext;

export type InternalInboxConversationFilters = {
  queueId?: string;
  assignedToMe?: boolean;
};

export type InternalInboxQueryService = {
  loadInboxView(
    context: InternalInboxQueryContext,
    input?: {
      selectedConversationId?: string;
      filters?: InternalInboxConversationFilters;
    }
  ): Promise<InternalInboxViewResponse>;
};

export type InternalInboxCommandService = {
  sendReply(
    context: InternalInboxCommandContext,
    input: { conversationId: string; request: InternalInboxReplyRequest }
  ): Promise<InternalInboxReplyResponse>;
  updateConversationRouting(
    context: InternalInboxCommandContext,
    input: {
      conversationId: string;
      request: InternalInboxConversationRoutingUpdateRequest;
    }
  ): Promise<InternalInboxConversationRoutingUpdateResponse>;
};

export type InternalInboxConversationAccessResource = {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly clientId: string;
  readonly currentQueueId?: string;
  readonly currentQueueOwningOrgUnitId?: string;
  readonly assignedEmployeeId?: EmployeeId;
  readonly assignedTeamId?: string;
};

export type InternalInboxAuthorizationService = {
  filterConversations<
    TConversation extends InternalInboxConversationAccessResource
  >(
    context: InternalInboxQueryContext,
    input: {
      conversations: readonly TConversation[];
      permission: Permission;
    }
  ): Promise<readonly TConversation[]>;
  assertConversationAccess(
    context: InternalInboxCommandContext,
    input: {
      conversation: InternalInboxConversationAccessResource;
      permission: Permission;
    }
  ): Promise<void>;
};

export type InternalInboxAuthorizationServiceOptions = {
  employeeRepository: Pick<EmployeeDirectoryRepository, "findEmployee">;
  rbacRepository: Pick<TenantRbacRepository, "listEffectiveAccessSources">;
  queueOwnerResolver?: (input: {
    tenantId: TenantId;
    queueId: string;
  }) => Promise<string | undefined>;
  now?: () => Date;
};

export type InternalInboxCommandServiceOptions = {
  repository: ExternalMessageRepository;
  authorization: InternalInboxAuthorizationService;
  now?: () => Date;
  idFactory?: (context: InternalInboxCommandContext) => IdFactory;
  idempotencyKeyFactory?: (input: {
    conversationId: string;
    requestId: string;
  }) => string;
};

type TenantRow = {
  tenant_id: string;
  display_name: string;
  deployment_type: InternalInboxTenantContext["deploymentType"];
  locale: string;
  timezone: string;
  brand_id: string | null;
  product_name: string | null;
  short_product_name: string | null;
  assets: Record<string, string> | null;
  theme_tokens: Record<string, string> | null;
  links: Record<string, string> | null;
};

type ConversationRow = {
  tenant_id: string;
  conversation_id: string;
  client_id: string;
  client_display_name: string;
  status: string;
  source: string;
  current_queue_id: string | null;
  current_queue_name: string | null;
  current_queue_owning_org_unit_id: string | null;
  assigned_employee_id: string | null;
  assigned_employee_display_name: string | null;
  assigned_team_id: string | null;
  assigned_team_name: string | null;
  message_count: number | string;
  queued_count: number | string;
  last_message_text: string | null;
  last_message_at: Date | string | null;
};

type InboxConversationRecord = InternalInboxConversation &
  InternalInboxConversationAccessResource;

type MessageRow = {
  id: string;
  conversation_id: string;
  direction: InternalInboxMessage["direction"];
  text: string | null;
  status: InternalInboxMessage["status"];
  created_at: Date | string;
};

export function createInternalInboxCommandService(
  options: InternalInboxCommandServiceOptions
): InternalInboxCommandService {
  const now = options.now ?? (() => new Date());
  const idFactory =
    options.idFactory ??
    ((context: InternalInboxCommandContext) =>
      createSequentialIdFactory(`${context.requestId}-${randomUUID()}`));
  const idempotencyKeyFactory =
    options.idempotencyKeyFactory ??
    ((input) => `internal-inbox-reply:${input.conversationId}:${randomUUID()}`);

  return {
    async sendReply(context, input) {
      const idempotencyKey =
        input.request.idempotencyKey ??
        idempotencyKeyFactory({
          conversationId: input.conversationId,
          requestId: context.requestId
        });
      const conversation = await options.repository.findConversationById({
        tenantId: context.tenantId,
        conversationId: input.conversationId as ConversationId
      });

      if (conversation === null) {
        throw new CoreError("tenant.not_found");
      }

      await options.authorization.assertConversationAccess(context, {
        conversation,
        permission: "message.reply"
      });

      const existingMessage =
        await options.repository.findMessageByIdempotencyKey({
          tenantId: context.tenantId,
          idempotencyKey
        });

      if (existingMessage !== null) {
        if (existingMessage.message.conversationId !== conversation.id) {
          throw new CoreError("validation.failed");
        }

        return {
          messageId: existingMessage.message.id,
          status: "queued",
          idempotencyKey: existingMessage.message.idempotencyKey
        };
      }

      const result = queueExternalOutboundMessage({
        now: now().toISOString(),
        idFactory: idFactory(context),
        tenantId: context.tenantId,
        conversation,
        text: input.request.text,
        idempotencyKey
      });

      await options.repository.saveExternalOutboundMessage(result);

      return {
        messageId: result.message.id,
        status: "queued",
        idempotencyKey: result.message.idempotencyKey
      };
    },

    async updateConversationRouting(context, input) {
      const assignedAt = now();
      const conversation = await options.repository.findConversationById({
        tenantId: context.tenantId,
        conversationId: input.conversationId as ConversationId
      });

      if (conversation === null) {
        throw new CoreError("tenant.not_found");
      }

      await options.authorization.assertConversationAccess(context, {
        conversation,
        permission: "conversation.assign"
      });

      const result = assignConversationRouting({
        now: assignedAt.toISOString(),
        idFactory: idFactory(context),
        tenantId: context.tenantId,
        actorEmployeeId: context.employeeId,
        conversation,
        currentQueueId: input.request.currentQueueId,
        assignedEmployeeId: input.request.assignedEmployeeId as
          | EmployeeId
          | null
          | undefined,
        assignedTeamId: input.request.assignedTeamId
      });
      const updatedConversation =
        await options.repository.updateConversationRouting({
          tenantId: context.tenantId,
          conversation: result.conversation,
          events: result.events,
          updatedAt: assignedAt
        });

      if (updatedConversation === null) {
        throw new CoreError("validation.failed");
      }

      return toConversationRoutingResponse(updatedConversation);
    }
  };
}

export function createSqlInternalInboxAuthorizationService(input: {
  database: HuleeDatabase;
  now?: () => Date;
}): InternalInboxAuthorizationService {
  return createInternalInboxAuthorizationService({
    employeeRepository: createSqlEmployeeDirectoryRepository(input.database),
    rbacRepository: createSqlTenantRbacRepository(input.database),
    queueOwnerResolver: ({ tenantId, queueId }) =>
      loadQueueOwnerOrgUnitId(input.database, tenantId, queueId),
    now: input.now
  });
}

export function createInternalInboxAuthorizationService(
  options: InternalInboxAuthorizationServiceOptions
): InternalInboxAuthorizationService {
  const now = options.now ?? (() => new Date());

  return {
    async filterConversations(context, input) {
      const snapshot = await resolveInboxAccessSnapshot({
        context,
        now: now(),
        options
      });

      return input.conversations.filter(
        (conversation) =>
          canAccess({
            actor: snapshot.actor,
            permission: input.permission,
            resource: conversationResourceContext(conversation),
            effectiveGrants: snapshot.effectiveGrants
          }).allowed
      );
    },

    async assertConversationAccess(context, input) {
      const snapshot = await resolveInboxAccessSnapshot({
        context,
        now: now(),
        options
      });
      const conversation = await withResolvedQueueOwner(
        input.conversation,
        options
      );
      const decision = canAccess({
        actor: snapshot.actor,
        permission: input.permission,
        resource: conversationResourceContext(conversation),
        effectiveGrants: snapshot.effectiveGrants
      });

      if (!decision.allowed) {
        throw new CoreError("permission.denied");
      }
    }
  };
}

export function createSqlInternalInboxQueryService(input: {
  database: HuleeDatabase;
  authorization?: InternalInboxAuthorizationService;
}): InternalInboxQueryService {
  const authorization =
    input.authorization ??
    createSqlInternalInboxAuthorizationService({ database: input.database });

  return {
    async loadInboxView(context, queryInput) {
      const [tenant, conversationRecords] = await Promise.all([
        loadTenantContext(input.database, context.tenantId),
        loadConversations(input.database, context.tenantId)
      ]);
      const readableConversationRecords =
        await authorization.filterConversations(context, {
          conversations: conversationRecords,
          permission: "inbox.read"
        });
      const filteredConversationRecords = filterInboxConversations(
        context,
        readableConversationRecords,
        queryInput?.filters
      );
      const selectedConversationRecord =
        filteredConversationRecords.find(
          (conversation) =>
            conversation.id === queryInput?.selectedConversationId
        ) ?? filteredConversationRecords[0];
      const conversations = filteredConversationRecords.map(
        toInternalInboxConversation
      );
      const selectedConversation =
        selectedConversationRecord === undefined
          ? undefined
          : toInternalInboxConversation(selectedConversationRecord);
      const messages = selectedConversationRecord
        ? await loadMessages(
            input.database,
            context.tenantId,
            selectedConversationRecord.id
          )
        : [];

      return {
        tenant,
        conversations,
        selectedConversation,
        messages
      };
    }
  };
}

export function filterInboxConversations<
  TConversation extends InternalInboxConversationAccessResource
>(
  context: InternalInboxQueryContext,
  conversations: readonly TConversation[],
  filters?: InternalInboxConversationFilters
): readonly TConversation[] {
  if (
    (filters?.queueId === undefined || filters.queueId === "") &&
    filters?.assignedToMe !== true
  ) {
    return conversations;
  }

  return conversations.filter((conversation) => {
    if (
      filters?.queueId !== undefined &&
      filters.queueId !== "" &&
      conversation.currentQueueId !== filters.queueId
    ) {
      return false;
    }

    if (
      filters?.assignedToMe === true &&
      conversation.assignedEmployeeId !== context.employeeId
    ) {
      return false;
    }

    return true;
  });
}

function toInternalInboxConversation(
  record: InboxConversationRecord
): InternalInboxConversation {
  const { tenantId: _tenantId, ...conversation } = record;

  return conversation;
}

function toConversationRoutingResponse(
  conversation: InternalInboxConversationAccessResource
): InternalInboxConversationRoutingUpdateResponse {
  return {
    conversationId: conversation.id,
    currentQueueId: conversation.currentQueueId,
    assignedEmployeeId: conversation.assignedEmployeeId,
    assignedTeamId: conversation.assignedTeamId
  };
}

async function resolveInboxAccessSnapshot(input: {
  readonly context: InternalInboxCommandContext;
  readonly now: Date;
  readonly options: InternalInboxAuthorizationServiceOptions;
}): Promise<{
  readonly actor: PermissionActor;
  readonly effectiveGrants: ReturnType<typeof resolveEffectivePermissionGrants>;
}> {
  const employee = await input.options.employeeRepository.findEmployee({
    tenantId: input.context.tenantId,
    employeeId: input.context.employeeId
  });

  if (employee === null || employee.deactivatedAt !== null) {
    throw new CoreError("permission.denied");
  }

  const actor = permissionActorFromEmployee(employee);
  const sources = await input.options.rbacRepository.listEffectiveAccessSources(
    {
      actor,
      at: input.now
    }
  );

  return {
    actor,
    effectiveGrants: resolveEffectivePermissionGrants({
      actor,
      roles: sources.roles,
      roleBindings: sources.roleBindings,
      directGrants: sources.directGrants,
      at: input.now
    })
  };
}

function permissionActorFromEmployee(
  employee: TenantEmployeeRecord
): PermissionActor {
  return {
    tenantId: employee.tenantId,
    employeeId: employee.employeeId,
    roles: employee.roles,
    teamIds: employee.teamIds,
    orgUnitIds: employee.orgUnitIds,
    queueIds: employee.queueIds
  };
}

async function withResolvedQueueOwner(
  conversation: InternalInboxConversationAccessResource,
  options: InternalInboxAuthorizationServiceOptions
): Promise<InternalInboxConversationAccessResource> {
  if (
    conversation.currentQueueId === undefined ||
    conversation.currentQueueOwningOrgUnitId !== undefined ||
    options.queueOwnerResolver === undefined
  ) {
    return conversation;
  }

  const currentQueueOwningOrgUnitId = await options.queueOwnerResolver({
    tenantId: conversation.tenantId,
    queueId: conversation.currentQueueId
  });

  return currentQueueOwningOrgUnitId === undefined
    ? conversation
    : {
        ...conversation,
        currentQueueOwningOrgUnitId
      };
}

function conversationResourceContext(
  conversation: InternalInboxConversationAccessResource
): PermissionResourceContext {
  return {
    tenantId: conversation.tenantId,
    clientId: conversation.clientId as PermissionResourceContext["clientId"],
    conversationId:
      conversation.id as PermissionResourceContext["conversationId"],
    orgUnitId: conversation.currentQueueOwningOrgUnitId,
    queueId: conversation.currentQueueId,
    assignedEmployeeId: conversation.assignedEmployeeId,
    assignedTeamIds:
      conversation.assignedTeamId === undefined
        ? undefined
        : [conversation.assignedTeamId]
  };
}

async function loadQueueOwnerOrgUnitId(
  db: HuleeDatabase,
  tenantId: TenantId,
  queueId: string
): Promise<string | undefined> {
  const result = await db.execute<{ owning_org_unit_id: string | null }>(sql`
    select owning_org_unit_id
    from work_queues
    where tenant_id = ${tenantId}
      and id = ${queueId}
    limit 1
  `);

  return result.rows[0]?.owning_org_unit_id ?? undefined;
}

async function loadTenantContext(
  db: HuleeDatabase,
  tenantId: TenantId
): Promise<InternalInboxTenantContext> {
  const result = await db.execute<TenantRow>(sql`
    select
      t.id as tenant_id,
      t.display_name,
      t.deployment_type,
      coalesce(ts.locale, 'ru') as locale,
      coalesce(ts.timezone, 'Europe/Moscow') as timezone,
      tbp.id as brand_id,
      tbp.product_name,
      tbp.short_product_name,
      tbp.assets,
      tbp.theme_tokens,
      tbp.links
    from tenants t
    left join tenant_settings ts
      on ts.tenant_id = t.id
    left join lateral (
      select id,
             product_name,
             short_product_name,
             assets,
             theme_tokens,
             links
      from tenant_brand_profiles
      where tenant_id = t.id
      order by created_at desc
      limit 1
    ) tbp on true
    where t.id = ${tenantId}
    limit 1
  `);
  const row = result.rows[0];

  if (!row) {
    throw new CoreError("tenant.not_found");
  }

  const tenantBrand =
    row.brand_id && row.product_name
      ? {
          id: row.brand_id,
          scope: "tenant" as const,
          tenantId,
          productName: row.product_name,
          shortProductName: row.short_product_name ?? undefined,
          companyName: row.display_name,
          assets: row.assets ?? {},
          themeTokens: normalizeThemeTokens(row.theme_tokens),
          links: row.links ?? {}
        }
      : undefined;
  const brand = resolveBrandProfile({ tenant: tenantBrand });

  return {
    tenantId,
    displayName: row.display_name,
    deploymentType: row.deployment_type,
    locale: resolveLocale(row.locale),
    timezone: row.timezone,
    brand: {
      id: brand.id,
      scope: brand.scope,
      tenantId: brand.tenantId,
      productName: brand.productName,
      shortProductName: brand.shortProductName,
      companyName: brand.companyName,
      assets: brand.assets,
      themeTokens: brand.themeTokens,
      links: brand.links ?? {}
    } satisfies InternalInboxBrandProfile
  };
}

async function loadConversations(
  db: HuleeDatabase,
  tenantId: TenantId
): Promise<InboxConversationRecord[]> {
  const result = await db.execute<ConversationRow>(sql`
    select
      c.tenant_id,
      c.id as conversation_id,
      c.client_id,
      cl.display_name as client_display_name,
      c.status,
      cl.source,
      c.current_queue_id,
      wq.name as current_queue_name,
      wq.owning_org_unit_id as current_queue_owning_org_unit_id,
      c.assigned_employee_id,
      ae.display_name as assigned_employee_display_name,
      c.assigned_team_id,
      assigned_team.name as assigned_team_name,
      count(m.id)::int as message_count,
      count(m.id) filter (where m.status = 'queued')::int as queued_count,
      (
        array_agg(m.text order by m.created_at desc, m.id desc)
        filter (where m.id is not null)
      )[1] as last_message_text,
      max(m.created_at) as last_message_at
    from conversations c
    inner join clients cl
      on cl.tenant_id = c.tenant_id
     and cl.id = c.client_id
    left join work_queues wq
      on wq.tenant_id = c.tenant_id
     and wq.id = c.current_queue_id
    left join employees ae
      on ae.tenant_id = c.tenant_id
     and ae.id = c.assigned_employee_id
    left join teams assigned_team
      on assigned_team.tenant_id = c.tenant_id
     and assigned_team.id = c.assigned_team_id
    left join messages m
      on m.tenant_id = c.tenant_id
     and m.conversation_id = c.id
    where c.tenant_id = ${tenantId}
      and c.type = 'client_direct'
      and c.status = 'open'
    group by c.tenant_id,
             c.id,
             c.client_id,
             cl.display_name,
             c.status,
             cl.source,
             c.current_queue_id,
             wq.name,
             wq.owning_org_unit_id,
             c.assigned_employee_id,
             ae.display_name,
             c.assigned_team_id,
             assigned_team.name
    order by max(m.created_at) desc nulls last, c.created_at desc, c.id desc
    limit 50
  `);

  return result.rows.map((row) => ({
    tenantId: row.tenant_id as TenantId,
    id: row.conversation_id,
    clientId: row.client_id,
    clientDisplayName: row.client_display_name,
    status: row.status,
    source: row.source,
    currentQueueId: row.current_queue_id ?? undefined,
    currentQueueName: row.current_queue_name ?? undefined,
    currentQueueOwningOrgUnitId:
      row.current_queue_owning_org_unit_id ?? undefined,
    assignedEmployeeId: row.assigned_employee_id
      ? (row.assigned_employee_id as EmployeeId)
      : undefined,
    assignedEmployeeDisplayName:
      row.assigned_employee_display_name ?? undefined,
    assignedTeamId: row.assigned_team_id ?? undefined,
    assignedTeamName: row.assigned_team_name ?? undefined,
    messageCount: Number(row.message_count),
    queuedCount: Number(row.queued_count),
    lastMessageText: row.last_message_text ?? undefined,
    lastMessageAt: row.last_message_at
      ? toIsoTimestamp(row.last_message_at)
      : undefined
  }));
}

async function loadMessages(
  db: HuleeDatabase,
  tenantId: TenantId,
  conversationId: string
): Promise<InternalInboxMessage[]> {
  const result = await db.execute<MessageRow>(sql`
    select id,
           conversation_id,
           direction,
           text,
           status,
           created_at
    from messages
    where tenant_id = ${tenantId}
      and conversation_id = ${conversationId}
    order by created_at asc, id asc
    limit 200
  `);

  return result.rows.map((row) => ({
    id: row.id,
    conversationId: row.conversation_id,
    direction: row.direction,
    text: row.text ?? undefined,
    status: row.status,
    createdAt: toIsoTimestamp(row.created_at)
  }));
}

function resolveLocale(locale: string): InternalInboxTenantContext["locale"] {
  return locale === "en" ? "en" : "ru";
}

function toIsoTimestamp(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function normalizeThemeTokens(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  const record = Object.fromEntries(
    Object.entries(value).flatMap(([key, rawValue]) => {
      return typeof rawValue === "string" ? [[key, rawValue]] : [];
    })
  );

  try {
    return normalizeBrandThemeTokens(record);
  } catch {
    return {};
  }
}
