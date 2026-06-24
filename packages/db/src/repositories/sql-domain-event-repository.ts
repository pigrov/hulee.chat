import type { PlatformEvent, TenantId } from "@hulee/contracts";
import { CoreError } from "@hulee/core";
import { sql, type SQL } from "drizzle-orm";

import type { HuleeDatabase } from "../client";
import type { RawSqlExecutor } from "./sql-outbox-repository";

export type AppendTenantEventsInput = {
  readonly tenantId: TenantId;
  readonly events: readonly PlatformEvent[];
};

export type DomainEventRepository = {
  append(input: AppendTenantEventsInput): Promise<void>;
};

export function createSqlDomainEventRepository(
  executor: RawSqlExecutor | HuleeDatabase
): DomainEventRepository {
  const rawExecutor = executor as RawSqlExecutor;

  return {
    async append(input: AppendTenantEventsInput): Promise<void> {
      if (input.events.length === 0) {
        return;
      }

      await rawExecutor.execute(buildAppendTenantEventsSql(input));
    }
  };
}

export function buildAppendTenantEventsSql(
  input: AppendTenantEventsInput
): SQL {
  assertTenantScopedEvents(input);

  return sql`
    with event_rows as (
      select *
      from jsonb_to_recordset(${serializeEventRows(input.events)}::jsonb)
        as event_row(
          id text,
          tenant_id text,
          type text,
          version text,
          occurred_at timestamptz,
          idempotency_key text,
          payload jsonb,
          outbox_payload jsonb
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
      where tenant_id = ${input.tenantId}
      on conflict (id) do nothing
      returning id,
                tenant_id
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
    select concat('outbox:', er.id),
           er.tenant_id,
           er.id,
           'pending',
           0,
           er.outbox_payload,
           er.occurred_at,
           er.occurred_at
    from event_rows er
    inner join inserted_events ie
      on ie.id = er.id
    on conflict (id) do nothing
  `;
}

function assertTenantScopedEvents(input: AppendTenantEventsInput): void {
  if (input.events.some((event) => event.tenantId !== input.tenantId)) {
    throw new CoreError("tenant.boundary_violation");
  }
}

function serializeEventRows(events: readonly PlatformEvent[]): string {
  return JSON.stringify(
    events.map((event) => ({
      id: event.id,
      tenant_id: event.tenantId,
      type: event.type,
      version: event.version,
      occurred_at: event.occurredAt,
      idempotency_key: event.idempotencyKey ?? null,
      payload: event.payload,
      outbox_payload: event
    }))
  );
}
