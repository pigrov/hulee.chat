import {
  inboxV2ConversationIdSchema,
  inboxV2EmployeeIdSchema,
  inboxV2TenantIdSchema
} from "@hulee/contracts";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  buildCountActorVisibleInboxV2ConversationsSql,
  buildListActorVisibleInboxV2ConversationsSql,
  createSqlInboxV2ActorVisibleAccessPlanRepository,
  type InboxV2EffectiveConversationAccessSnapshot
} from "./sql-inbox-v2-access-plan-repository";

const tenantId = inboxV2TenantIdSchema.parse("tenant:db007-unit");
const otherTenantId = inboxV2TenantIdSchema.parse("tenant:db007-other");
const employeeId = inboxV2EmployeeIdSchema.parse("employee:db007-unit");
const conversationId = inboxV2ConversationIdSchema.parse(
  "conversation:db007-unit"
);

function access(
  patch: Partial<InboxV2EffectiveConversationAccessSnapshot> = {}
): InboxV2EffectiveConversationAccessSnapshot {
  return {
    snapshotId: "access-snapshot:db007-unit",
    authorizationEpoch: "authorization:db007-unit",
    tenantId,
    employeeId,
    tenantWideExternalRead: false,
    explicitConversationIds: [conversationId],
    workItemIds: ["work_item:db007-unit"],
    queueIds: ["work_queue:db007-unit"],
    orgUnitIds: ["org_unit:db007-unit"],
    teamIds: ["team:db007-unit"],
    allowResponsible: true,
    allowCollaborator: true,
    allowInternalParticipant: true,
    ...patch
  };
}

describe("SQL Inbox V2 actor-visible access plan repository", () => {
  it("builds one actor access set before keyset pagination", () => {
    const query = normalizeSql(
      renderQuery(
        buildListActorVisibleInboxV2ConversationsSql({
          tenantId,
          employeeId,
          access: access(),
          limit: 51
        })
      ).sql
    );

    expect(query).toContain("access_snapshot as materialized");
    expect(query).toContain("authorized_conversations as materialized");
    expect(query).toContain("inbox_v2_auth_structural_access_heads");
    expect(query).toContain("inbox_v2_work_item_primary_assignments");
    expect(query).toContain("inbox_v2_auth_collaborator_heads");
    expect(query).toContain("inbox_v2_participant_membership_episodes");
    expect(query.indexOf("authorized_conversations")).toBeLessThan(
      query.lastIndexOf("limit")
    );
    expect(query).not.toMatch(/role_binding|direct_grant|role_versions/iu);
  });

  it("uses a head-index scan for tenant-wide external access but keeps internal hard privacy", () => {
    const query = normalizeSql(
      renderQuery(
        buildListActorVisibleInboxV2ConversationsSql({
          tenantId,
          employeeId,
          access: access({ tenantWideExternalRead: true }),
          limit: 50
        })
      ).sql
    );

    expect(query).toContain("from inbox_v2_conversation_heads head");
    expect(query).toContain("conversation.transport = 'external'");
    expect(query).toContain("episode.origin_kind = 'hulee_internal_command'");
    expect(query).toContain(
      "order by head.latest_activity_at desc nulls last, head.conversation_id asc"
    );
    expect(query).not.toContain("authorized_conversations as materialized");
  });

  it("encodes the nulls-last composite keyset without offset pagination", () => {
    const dated = normalizeSql(
      renderQuery(
        buildListActorVisibleInboxV2ConversationsSql({
          tenantId,
          employeeId,
          access: access(),
          cursor: {
            latestActivityAt: "2026-07-15T12:00:00.000Z",
            conversationId
          },
          limit: 50
        })
      ).sql
    );
    expect(dated).toContain("head.latest_activity_at <");
    expect(dated).toContain("head.latest_activity_at is null");
    expect(dated).toContain("head.conversation_id >");
    expect(dated).not.toContain("offset");

    const nullActivity = normalizeSql(
      renderQuery(
        buildListActorVisibleInboxV2ConversationsSql({
          tenantId,
          employeeId,
          access: access(),
          cursor: { latestActivityAt: null, conversationId },
          limit: 50
        })
      ).sql
    );
    expect(nullActivity).toContain(
      "head.latest_activity_at is null and head.conversation_id >"
    );
  });

  it("counts through the authorization predicate without page limit", () => {
    const query = normalizeSql(
      renderQuery(
        buildCountActorVisibleInboxV2ConversationsSql({
          tenantId,
          employeeId,
          access: access()
        })
      ).sql
    );

    expect(query).toContain("authorized_conversations as materialized");
    expect(query).toContain("count(*)::bigint as visible_count");
    expect(query).not.toMatch(/\blimit\b|\boffset\b/iu);
  });

  it("returns a stable next cursor and pins the response to its access snapshot", async () => {
    const executor = {
      async execute() {
        return {
          rows: [
            row(conversationId, "2026-07-15T12:00:00.000Z"),
            row(
              inboxV2ConversationIdSchema.parse("conversation:db007-second"),
              null
            )
          ]
        };
      }
    };
    const repository = createSqlInboxV2ActorVisibleAccessPlanRepository(
      executor as never
    );

    const page = await repository.list({
      tenantId,
      employeeId,
      access: access(),
      limit: 1
    });

    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toEqual({
      latestActivityAt: "2026-07-15T12:00:00.000Z",
      conversationId
    });
    expect(page.accessSnapshotId).toBe("access-snapshot:db007-unit");
    expect(page.authorizationEpoch).toBe("authorization:db007-unit");
  });

  it("fails closed when a mapper observes another tenant", async () => {
    const repository = createSqlInboxV2ActorVisibleAccessPlanRepository({
      async execute() {
        return {
          rows: [
            {
              ...row(conversationId, "2026-07-15T12:00:00.000Z"),
              tenant_id: otherTenantId
            }
          ]
        };
      }
    } as never);

    await expect(
      repository.list({
        tenantId,
        employeeId,
        access: access(),
        limit: 50
      })
    ).rejects.toMatchObject({ code: "tenant.boundary_violation" });
  });

  it("rejects duplicate or unbounded effective-scope snapshots", () => {
    expect(() =>
      buildListActorVisibleInboxV2ConversationsSql({
        tenantId,
        employeeId,
        access: access({ queueIds: ["queue:one", "queue:one"] }),
        limit: 50
      })
    ).toThrow(/duplicates/iu);
    expect(() =>
      buildListActorVisibleInboxV2ConversationsSql({
        tenantId,
        employeeId,
        access: access({
          teamIds: Array.from({ length: 10_001 }, (_, index) => `team:${index}`)
        }),
        limit: 50
      })
    ).toThrow(/bounded/iu);
  });

  it("fails closed when the effective-access snapshot belongs to another principal", () => {
    expect(() =>
      buildListActorVisibleInboxV2ConversationsSql({
        tenantId,
        employeeId,
        access: access({ tenantId: otherTenantId }),
        limit: 50
      })
    ).toThrow("tenant.boundary_violation");

    expect(() =>
      buildListActorVisibleInboxV2ConversationsSql({
        tenantId,
        employeeId,
        access: access({
          employeeId: inboxV2EmployeeIdSchema.parse("employee:db007-other")
        }),
        limit: 50
      })
    ).toThrow("permission.denied");
  });
});

function row(id: string, activityAt: string | null) {
  return {
    tenant_id: tenantId,
    conversation_id: id,
    topology: "direct",
    transport: "external",
    lifecycle: "active",
    purpose_id: "core:chat",
    latest_timeline_sequence: "9",
    latest_activity_item_id: "timeline_item:db007-unit",
    latest_activity_timeline_sequence: "9",
    latest_activity_at: activityAt,
    updated_at: "2026-07-15T12:00:00.000Z"
  };
}

function renderQuery(query: SQL) {
  return new PgDialect().sqlToQuery(query);
}

function normalizeSql(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}
