import {
  normalizeBrandThemeTokens,
  resolveBrandProfile
} from "@hulee/branding";
import type {
  ConversationId,
  EmployeeId,
  InternalInboxBrandProfile,
  InternalInboxConversation,
  InternalInboxMessage,
  InternalInboxReplyRequest,
  InternalInboxReplyResponse,
  InternalInboxTenantContext,
  InternalInboxViewResponse,
  TenantId
} from "@hulee/contracts";
import {
  CoreError,
  createSequentialIdFactory,
  queueExternalOutboundMessage,
  type IdFactory
} from "@hulee/core";
import type { ExternalMessageRepository, HuleeDatabase } from "@hulee/db";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

export type InternalInboxCommandContext = {
  requestId: string;
  tenantId: TenantId;
  employeeId: EmployeeId;
};

export type InternalInboxQueryContext = InternalInboxCommandContext;

export type InternalInboxQueryService = {
  loadInboxView(
    context: InternalInboxQueryContext,
    input?: { selectedConversationId?: string }
  ): Promise<InternalInboxViewResponse>;
};

export type InternalInboxCommandService = {
  sendReply(
    context: InternalInboxCommandContext,
    input: { conversationId: string; request: InternalInboxReplyRequest }
  ): Promise<InternalInboxReplyResponse>;
};

export type InternalInboxCommandServiceOptions = {
  repository: ExternalMessageRepository;
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
  conversation_id: string;
  client_id: string;
  client_display_name: string;
  status: string;
  source: string;
  message_count: number | string;
  queued_count: number | string;
  last_message_text: string | null;
  last_message_at: Date | string | null;
};

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
      const existingMessage =
        await options.repository.findMessageByIdempotencyKey({
          tenantId: context.tenantId,
          idempotencyKey
        });

      if (existingMessage !== null) {
        return {
          messageId: existingMessage.message.id,
          status: "queued",
          idempotencyKey: existingMessage.message.idempotencyKey
        };
      }

      const conversation = await options.repository.findConversationById({
        tenantId: context.tenantId,
        conversationId: input.conversationId as ConversationId
      });

      if (conversation === null) {
        throw new CoreError("tenant.not_found");
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
    }
  };
}

export function createSqlInternalInboxQueryService(input: {
  database: HuleeDatabase;
}): InternalInboxQueryService {
  return {
    async loadInboxView(context, queryInput) {
      const [tenant, conversations] = await Promise.all([
        loadTenantContext(input.database, context.tenantId),
        loadConversations(input.database, context.tenantId)
      ]);
      const selectedConversation =
        conversations.find(
          (conversation) =>
            conversation.id === queryInput?.selectedConversationId
        ) ?? conversations[0];
      const messages = selectedConversation
        ? await loadMessages(
            input.database,
            context.tenantId,
            selectedConversation.id
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
): Promise<InternalInboxConversation[]> {
  const result = await db.execute<ConversationRow>(sql`
    select
      c.id as conversation_id,
      c.client_id,
      cl.display_name as client_display_name,
      c.status,
      cl.source,
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
    left join messages m
      on m.tenant_id = c.tenant_id
     and m.conversation_id = c.id
    where c.tenant_id = ${tenantId}
      and c.type = 'client_direct'
      and c.status = 'open'
    group by c.id, c.client_id, cl.display_name, c.status, cl.source
    order by max(m.created_at) desc nulls last, c.created_at desc, c.id desc
    limit 50
  `);

  return result.rows.map((row) => ({
    id: row.conversation_id,
    clientId: row.client_id,
    clientDisplayName: row.client_display_name,
    status: row.status,
    source: row.source,
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
