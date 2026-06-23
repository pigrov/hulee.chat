import type { PlatformEvent, TenantId } from "@hulee/contracts";
import {
  CoreError,
  type AuthEmailToken,
  type AuthEmailTokenPurpose
} from "@hulee/core";
import { createHash } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";

import type { HuleeDatabase } from "../client";
import type { RawSqlExecutor } from "./sql-outbox-repository";

export type AuthEmailTokenTarget = {
  tenantId: TenantId;
  tenantSlug: string;
  tenantDisplayName: string;
  productName: string;
  accountId: string;
  email: string;
  displayName: string;
};

export type AuthEmailTokenPreview = {
  token: AuthEmailToken;
  tenantSlug: string;
  tenantDisplayName: string;
  productName: string;
  displayName: string;
};

export type FindAuthEmailTokenTargetByEmailInput = {
  tenantSlug: string;
  email: string;
};

export type ListAuthEmailTokenTargetsByEmailInput = {
  email: string;
};

export type FindAuthEmailTokenTargetByAccountInput = {
  tenantId: TenantId;
  accountId: string;
};

export type FindValidAuthEmailTokenInput = {
  tokenHash: string;
  purpose: AuthEmailTokenPurpose;
  now: Date;
};

export type CreateAuthEmailTokenPersistenceInput = {
  token: AuthEmailToken;
  events: readonly PlatformEvent[];
};

export type CompleteEmailVerificationPersistenceInput = {
  token: AuthEmailToken;
  verifiedAt: Date;
  events: readonly PlatformEvent[];
};

export type CompletePasswordResetPersistenceInput = {
  token: AuthEmailToken;
  passwordHash: string;
  resetAt: Date;
  events: readonly PlatformEvent[];
};

export type AuthEmailTokenRepository = {
  findTargetByEmail(
    input: FindAuthEmailTokenTargetByEmailInput
  ): Promise<AuthEmailTokenTarget | null>;
  listTargetsByEmail(
    input: ListAuthEmailTokenTargetsByEmailInput
  ): Promise<readonly AuthEmailTokenTarget[]>;
  findTargetByAccount(
    input: FindAuthEmailTokenTargetByAccountInput
  ): Promise<AuthEmailTokenTarget | null>;
  findValidToken(
    input: FindValidAuthEmailTokenInput
  ): Promise<AuthEmailTokenPreview | null>;
  createToken(input: CreateAuthEmailTokenPersistenceInput): Promise<void>;
  completeEmailVerification(
    input: CompleteEmailVerificationPersistenceInput
  ): Promise<void>;
  completePasswordReset(
    input: CompletePasswordResetPersistenceInput
  ): Promise<void>;
};

type AuthEmailTokenTargetRow = {
  tenant_id: string;
  tenant_slug: string;
  tenant_display_name: string;
  product_name: string | null;
  account_id: string;
  email: string;
  display_name: string;
};

type AuthEmailTokenPreviewRow = AuthEmailTokenTargetRow & {
  token_id: string;
  token_hash: string;
  purpose: string;
  expires_at: Date;
  consumed_at: Date | null;
  created_at: Date;
};

export function createSqlAuthEmailTokenRepository(
  executor: RawSqlExecutor | HuleeDatabase
): AuthEmailTokenRepository {
  const rawExecutor = executor as RawSqlExecutor;

  return {
    async findTargetByEmail(input) {
      const result = await rawExecutor.execute<AuthEmailTokenTargetRow>(
        buildFindAuthEmailTokenTargetByEmailSql(input)
      );
      const row = result.rows[0];

      return row === undefined ? null : mapTargetRow(row);
    },

    async listTargetsByEmail(input) {
      const result = await rawExecutor.execute<AuthEmailTokenTargetRow>(
        buildListAuthEmailTokenTargetsByEmailSql(input)
      );

      return result.rows.map(mapTargetRow);
    },

    async findTargetByAccount(input) {
      const result = await rawExecutor.execute<AuthEmailTokenTargetRow>(
        buildFindAuthEmailTokenTargetByAccountSql(input)
      );
      const row = result.rows[0];

      return row === undefined ? null : mapTargetRow(row);
    },

    async findValidToken(input) {
      const result = await rawExecutor.execute<AuthEmailTokenPreviewRow>(
        buildFindValidAuthEmailTokenSql(input)
      );
      const row = result.rows[0];

      return row === undefined ? null : mapPreviewRow(row);
    },

    async createToken(input) {
      await rawExecutor.execute(buildCreateAuthEmailTokenSql(input));
    },

    async completeEmailVerification(input) {
      const result = await rawExecutor.execute<{ token_id: string }>(
        buildCompleteEmailVerificationSql(input)
      );

      if (result.rows[0] === undefined) {
        throw new CoreError("validation.failed");
      }
    },

    async completePasswordReset(input) {
      const result = await rawExecutor.execute<{ token_id: string }>(
        buildCompletePasswordResetSql(input)
      );

      if (result.rows[0] === undefined) {
        throw new CoreError("validation.failed");
      }
    }
  };
}

export function buildFindAuthEmailTokenTargetByEmailSql(
  input: FindAuthEmailTokenTargetByEmailInput
): SQL {
  return sql`
    select tenants.id as tenant_id,
           tenants.slug as tenant_slug,
           tenants.display_name as tenant_display_name,
           brand.product_name,
           accounts.id as account_id,
           accounts.email,
           employees.display_name
    from tenants
    inner join accounts on accounts.tenant_id = tenants.id
    inner join employees on employees.tenant_id = tenants.id
      and employees.account_id = accounts.id
      and employees.deactivated_at is null
    left join lateral (
      select tenant_brand_profiles.product_name
      from tenant_brand_profiles
      where tenant_brand_profiles.tenant_id = tenants.id
      order by tenant_brand_profiles.created_at desc
      limit 1
    ) brand on true
    where tenants.slug = ${input.tenantSlug}
      and lower(accounts.email) = lower(${input.email})
    limit 1
  `;
}

export function buildListAuthEmailTokenTargetsByEmailSql(
  input: ListAuthEmailTokenTargetsByEmailInput
): SQL {
  return sql`
    select tenants.id as tenant_id,
           tenants.slug as tenant_slug,
           tenants.display_name as tenant_display_name,
           brand.product_name,
           accounts.id as account_id,
           accounts.email,
           employees.display_name
    from tenants
    inner join accounts on accounts.tenant_id = tenants.id
    inner join employees on employees.tenant_id = tenants.id
      and employees.account_id = accounts.id
      and employees.deactivated_at is null
    left join lateral (
      select tenant_brand_profiles.product_name
      from tenant_brand_profiles
      where tenant_brand_profiles.tenant_id = tenants.id
      order by tenant_brand_profiles.created_at desc
      limit 1
    ) brand on true
    where lower(accounts.email) = lower(${input.email})
    order by tenants.display_name asc,
             tenants.slug asc
  `;
}

export function buildFindAuthEmailTokenTargetByAccountSql(
  input: FindAuthEmailTokenTargetByAccountInput
): SQL {
  return sql`
    select tenants.id as tenant_id,
           tenants.slug as tenant_slug,
           tenants.display_name as tenant_display_name,
           brand.product_name,
           accounts.id as account_id,
           accounts.email,
           employees.display_name
    from accounts
    inner join tenants on tenants.id = accounts.tenant_id
    inner join employees on employees.tenant_id = accounts.tenant_id
      and employees.account_id = accounts.id
      and employees.deactivated_at is null
    left join lateral (
      select tenant_brand_profiles.product_name
      from tenant_brand_profiles
      where tenant_brand_profiles.tenant_id = tenants.id
      order by tenant_brand_profiles.created_at desc
      limit 1
    ) brand on true
    where accounts.tenant_id = ${input.tenantId}
      and accounts.id = ${input.accountId}
    limit 1
  `;
}

export function buildFindValidAuthEmailTokenSql(
  input: FindValidAuthEmailTokenInput
): SQL {
  return sql`
    select auth_email_verification_tokens.id as token_id,
           auth_email_verification_tokens.tenant_id,
           auth_email_verification_tokens.account_id,
           auth_email_verification_tokens.token_hash,
           auth_email_verification_tokens.purpose,
           auth_email_verification_tokens.expires_at,
           auth_email_verification_tokens.consumed_at,
           auth_email_verification_tokens.created_at,
           tenants.slug as tenant_slug,
           tenants.display_name as tenant_display_name,
           brand.product_name,
           accounts.email,
           employees.display_name
    from auth_email_verification_tokens
    inner join accounts on accounts.tenant_id = auth_email_verification_tokens.tenant_id
      and accounts.id = auth_email_verification_tokens.account_id
    inner join tenants on tenants.id = auth_email_verification_tokens.tenant_id
    inner join employees on employees.tenant_id = accounts.tenant_id
      and employees.account_id = accounts.id
      and employees.deactivated_at is null
    left join lateral (
      select tenant_brand_profiles.product_name
      from tenant_brand_profiles
      where tenant_brand_profiles.tenant_id = tenants.id
      order by tenant_brand_profiles.created_at desc
      limit 1
    ) brand on true
    where auth_email_verification_tokens.token_hash = ${input.tokenHash}
      and auth_email_verification_tokens.purpose = ${input.purpose}
      and auth_email_verification_tokens.consumed_at is null
      and auth_email_verification_tokens.expires_at > ${input.now}
    limit 1
  `;
}

export function buildCreateAuthEmailTokenSql(
  input: CreateAuthEmailTokenPersistenceInput
): SQL {
  return sql`
    with inserted_token as (
      insert into auth_email_verification_tokens (
        id,
        tenant_id,
        account_id,
        token_hash,
        purpose,
        expires_at,
        created_at,
        updated_at
      )
      values (
        ${input.token.id},
        ${input.token.tenantId},
        ${input.token.accountId},
        ${input.token.tokenHash},
        ${input.token.purpose},
        ${new Date(input.token.expiresAt)},
        ${new Date(input.token.createdAt)},
        ${new Date(input.token.createdAt)}
      )
      returning id
    ),
    event_rows as (
      select *
      from jsonb_to_recordset(${serializeEventRows(input.events)}::jsonb)
        as event_row(
          id text,
          tenant_id text,
          type text,
          version text,
          occurred_at timestamptz,
          idempotency_key text,
          payload jsonb
        )
    ),
    inserted_events as (
      insert into event_store (
        id,
        tenant_id,
        type,
        version,
        occurred_at,
        idempotency_key,
        payload,
        created_at,
        updated_at
      )
      select id,
             tenant_id,
             type,
             version,
             occurred_at,
             idempotency_key,
             payload,
             occurred_at,
             occurred_at
      from event_rows
      where exists (select 1 from inserted_token)
      returning id,
                tenant_id,
                payload,
                occurred_at
    )
    insert into outbox (
      id,
      tenant_id,
      event_id,
      status,
      attempts,
      payload,
      created_at,
      updated_at
    )
    select concat('outbox:', id),
           tenant_id,
           id,
           'pending',
           0,
           payload,
           occurred_at,
           occurred_at
    from inserted_events
  `;
}

export function buildCompleteEmailVerificationSql(
  input: CompleteEmailVerificationPersistenceInput
): SQL {
  return sql`
    with pending_token as (
      select id,
             tenant_id,
             account_id
      from auth_email_verification_tokens
      where tenant_id = ${input.token.tenantId}
        and account_id = ${input.token.accountId}
        and token_hash = ${input.token.tokenHash}
        and purpose = 'email_verification'
        and consumed_at is null
        and expires_at > ${input.verifiedAt}
      limit 1
    ),
    updated_account as (
      update accounts
      set email_verified_at = coalesce(email_verified_at, ${input.verifiedAt}),
          updated_at = ${input.verifiedAt}
      from pending_token
      where accounts.tenant_id = pending_token.tenant_id
        and accounts.id = pending_token.account_id
      returning accounts.id
    ),
    updated_token as (
      update auth_email_verification_tokens
      set consumed_at = ${input.verifiedAt},
          updated_at = ${input.verifiedAt}
      from pending_token
      where auth_email_verification_tokens.id = pending_token.id
      returning auth_email_verification_tokens.id,
                auth_email_verification_tokens.tenant_id
    ),
    event_rows as (
      select *
      from jsonb_to_recordset(${serializeEventRows(input.events)}::jsonb)
        as event_row(
          id text,
          tenant_id text,
          type text,
          version text,
          occurred_at timestamptz,
          idempotency_key text,
          payload jsonb
        )
    ),
    inserted_events as (
      insert into event_store (
        id,
        tenant_id,
        type,
        version,
        occurred_at,
        idempotency_key,
        payload,
        created_at,
        updated_at
      )
      select event_rows.id,
             event_rows.tenant_id,
             event_rows.type,
             event_rows.version,
             event_rows.occurred_at,
             event_rows.idempotency_key,
             event_rows.payload,
             event_rows.occurred_at,
             event_rows.occurred_at
      from event_rows
      where exists (select 1 from updated_token)
      returning id,
                tenant_id,
                payload,
                occurred_at
    ),
    inserted_outbox as (
      insert into outbox (
        id,
        tenant_id,
        event_id,
        status,
        attempts,
        payload,
        created_at,
        updated_at
      )
      select concat('outbox:', id),
             tenant_id,
             id,
             'pending',
             0,
             payload,
             occurred_at,
             occurred_at
      from inserted_events
      returning id
    )
    select id as token_id
    from updated_token
    limit 1
  `;
}

export function buildCompletePasswordResetSql(
  input: CompletePasswordResetPersistenceInput
): SQL {
  return sql`
    with pending_token as (
      select id,
             tenant_id,
             account_id
      from auth_email_verification_tokens
      where tenant_id = ${input.token.tenantId}
        and account_id = ${input.token.accountId}
        and token_hash = ${input.token.tokenHash}
        and purpose = 'password_reset'
        and consumed_at is null
        and expires_at > ${input.resetAt}
      limit 1
    ),
    updated_account as (
      update accounts
      set password_hash = ${input.passwordHash},
          updated_at = ${input.resetAt}
      from pending_token
      where accounts.tenant_id = pending_token.tenant_id
        and accounts.id = pending_token.account_id
      returning accounts.id
    ),
    updated_token as (
      update auth_email_verification_tokens
      set consumed_at = ${input.resetAt},
          updated_at = ${input.resetAt}
      from pending_token
      where auth_email_verification_tokens.id = pending_token.id
      returning auth_email_verification_tokens.id,
                auth_email_verification_tokens.tenant_id,
                auth_email_verification_tokens.account_id
    ),
    revoked_sessions as (
      update sessions
      set revoked_at = ${input.resetAt},
          updated_at = ${input.resetAt}
      from updated_token
      inner join employees on employees.tenant_id = updated_token.tenant_id
        and employees.account_id = updated_token.account_id
      where sessions.tenant_id = updated_token.tenant_id
        and sessions.employee_id = employees.id
        and sessions.revoked_at is null
      returning sessions.id
    ),
    event_rows as (
      select *
      from jsonb_to_recordset(${serializeEventRows(input.events)}::jsonb)
        as event_row(
          id text,
          tenant_id text,
          type text,
          version text,
          occurred_at timestamptz,
          idempotency_key text,
          payload jsonb
        )
    ),
    inserted_events as (
      insert into event_store (
        id,
        tenant_id,
        type,
        version,
        occurred_at,
        idempotency_key,
        payload,
        created_at,
        updated_at
      )
      select event_rows.id,
             event_rows.tenant_id,
             event_rows.type,
             event_rows.version,
             event_rows.occurred_at,
             event_rows.idempotency_key,
             event_rows.payload,
             event_rows.occurred_at,
             event_rows.occurred_at
      from event_rows
      where exists (select 1 from updated_token)
      returning id,
                tenant_id,
                payload,
                occurred_at
    ),
    inserted_outbox as (
      insert into outbox (
        id,
        tenant_id,
        event_id,
        status,
        attempts,
        payload,
        created_at,
        updated_at
      )
      select concat('outbox:', id),
             tenant_id,
             id,
             'pending',
             0,
             payload,
             occurred_at,
             occurred_at
      from inserted_events
      returning id
    )
    select id as token_id
    from updated_token
    limit 1
  `;
}

export function hashAuthEmailToken(token: string): string {
  return `sha256:${createHash("sha256").update(token).digest("hex")}`;
}

function serializeEventRows(events: readonly PlatformEvent[]): string {
  return JSON.stringify(
    events.map((event) => {
      return {
        id: event.id,
        tenant_id: event.tenantId,
        type: event.type,
        version: event.version,
        occurred_at: event.occurredAt,
        idempotency_key: event.idempotencyKey ?? null,
        payload: event
      };
    })
  );
}

function mapTargetRow(row: AuthEmailTokenTargetRow): AuthEmailTokenTarget {
  return {
    tenantId: row.tenant_id as TenantId,
    tenantSlug: row.tenant_slug,
    tenantDisplayName: row.tenant_display_name,
    productName: row.product_name ?? row.tenant_display_name,
    accountId: row.account_id,
    email: row.email,
    displayName: row.display_name
  };
}

function mapPreviewRow(row: AuthEmailTokenPreviewRow): AuthEmailTokenPreview {
  const purpose = parsePurpose(row.purpose);

  return {
    token: {
      id: row.token_id,
      tenantId: row.tenant_id as TenantId,
      accountId: row.account_id,
      email: row.email,
      purpose,
      tokenHash: row.token_hash,
      expiresAt: row.expires_at.toISOString(),
      consumedAt: row.consumed_at?.toISOString(),
      createdAt: row.created_at.toISOString()
    },
    tenantSlug: row.tenant_slug,
    tenantDisplayName: row.tenant_display_name,
    productName: row.product_name ?? row.tenant_display_name,
    displayName: row.display_name
  };
}

function parsePurpose(value: string): AuthEmailTokenPurpose {
  if (value !== "email_verification" && value !== "password_reset") {
    throw new CoreError("validation.failed");
  }

  return value;
}
