import {
  INBOX_V2_CONVERSATION_SYSTEM_EVENT_PAYLOAD_SCHEMA_ID,
  INBOX_V2_CONVERSATION_SYSTEM_EVENT_PAYLOAD_SCHEMA_VERSION,
  inboxV2SystemEventTimelineCreationCommitSchema,
  type InboxV2SystemEventTimelineCreationCommit
} from "@hulee/contracts";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  fixtureReference,
  fixtureT1,
  fixtureT2,
  fixtureTenantId,
  fixtureTimelineAllocation,
  fixtureTimelineItem
} from "../../../contracts/src/inbox-v2/timeline-message-fixtures.type-fixture";
import {
  INBOX_V2_SYSTEM_EVENT_TIMELINE_COMMAND_TYPE_ID,
  INBOX_V2_SYSTEM_EVENT_TIMELINE_PERMISSION_ID,
  assertSystemEventTimelineCreationAuthority,
  buildFindInboxV2SystemEventSourceSql,
  buildFindInboxV2SystemEventTimelineSubjectSql,
  buildInsertInboxV2SystemEventTimelineSubjectSql,
  buildLockInboxV2SystemEventTimelineConversationSql,
  inboxV2SystemEventSourceRowMatches
} from "./sql-inbox-v2-timeline-system-event-repository";
import { computeInboxV2TimelineMessageCommitDigest } from "./sql-inbox-v2-timeline-message-repository";

const trustedServiceId = "core:timeline-runtime";
const decisionId = "authorization-decision:timeline-system-event";

describe("SQL Inbox V2 system-event Timeline repository", () => {
  it("binds creation to one exact trusted service, Conversation decision and fence", () => {
    const commit = systemEventCommit();
    const context = systemEventAuthorityContext(commit);

    expect(() =>
      assertSystemEventTimelineCreationAuthority(context, commit)
    ).not.toThrow();

    for (const mutatedContext of [
      {
        ...context,
        commandTypeId: "core:message.send"
      },
      {
        ...context,
        actor: {
          kind: "trusted_service" as const,
          trustedServiceId: "core:other"
        }
      },
      {
        ...context,
        authorizationResourceRevisionFences: []
      },
      {
        ...context,
        authorizationDecisionRefs: context.authorizationDecisionRefs.map(
          (decision) => ({
            ...decision,
            permissionId: "core:message.receive_external"
          })
        )
      }
    ]) {
      expect(() =>
        assertSystemEventTimelineCreationAuthority(
          mutatedContext as unknown as Parameters<
            typeof assertSystemEventTimelineCreationAuthority
          >[0],
          commit
        )
      ).toThrow(/trusted-service Conversation authorization/iu);
    }
  });

  it("pins the owning legacy event before the Conversation and emits post-head-safe subject SQL", () => {
    const commit = systemEventCommit();
    const item = commit.timelineAllocation.items[0]!;
    const sourceSql = normalizeSql(
      renderSql(
        buildFindInboxV2SystemEventSourceSql({
          tenantId: commit.tenantId,
          eventId: commit.source.event.id
        })
      )
    );
    const conversationSql = normalizeSql(
      renderSql(
        buildLockInboxV2SystemEventTimelineConversationSql({
          tenantId: commit.tenantId,
          conversationId: item.conversation.id
        })
      )
    );
    const subjectSql = normalizeSql(
      renderSql(buildInsertInboxV2SystemEventTimelineSubjectSql(commit))
    );

    expect(sourceSql).toContain("from event_store");
    expect(sourceSql).toContain("where tenant_id = $1 and id = $2");
    expect(sourceSql).toContain("for share");
    expect(conversationSql).toContain("for update of c, h");
    expect(subjectSql).toContain(
      "insert into inbox_v2_timeline_subject_details"
    );
    expect(subjectSql).toContain("values");
    expect(subjectSql).toContain("returning timeline_item_id as id");
    expect(subjectSql).not.toMatch(/\b(?:select|from|join|for update)\b/iu);
  });

  it("matches only an immutable payload digest bound to the exact Conversation", () => {
    const commit = systemEventCommit();
    const payload = systemEventPayload(commit);
    const exactCommit = inboxV2SystemEventTimelineCreationCommitSchema.parse({
      ...commit,
      source: {
        ...commit.source,
        payloadDigest: `sha256:${computeInboxV2TimelineMessageCommitDigest(payload)}`
      }
    });
    const row = {
      id: exactCommit.source.event.id,
      type: exactCommit.source.eventTypeId,
      version: exactCommit.source.eventVersion,
      occurred_at: new Date(exactCommit.source.occurredAt),
      created_at: new Date(exactCommit.source.recordedAt),
      payload
    };

    expect(inboxV2SystemEventSourceRowMatches(row, exactCommit)).toBe(true);
    expect(
      inboxV2SystemEventSourceRowMatches(
        {
          ...row,
          payload: {
            ...payload,
            conversation: {
              ...payload.conversation,
              id: "conversation:other"
            }
          }
        },
        exactCommit
      )
    ).toBe(false);

    const lookupSql = normalizeSql(
      renderSql(
        buildFindInboxV2SystemEventTimelineSubjectSql({
          tenantId: exactCommit.tenantId,
          conversationId: exactCommit.source.conversation.id,
          eventId: exactCommit.source.event.id
        })
      )
    );
    expect(lookupSql).toContain("detail.system_event_id = $2");
    expect(lookupSql).toContain("item.conversation_id = $3");
    expect(lookupSql).toContain("for update of detail, item");
  });
});

function systemEventCommit(): InboxV2SystemEventTimelineCreationCommit {
  const event = fixtureReference("event", "event:timeline-system-1");
  const item = fixtureTimelineItem("external", {
    subject: {
      kind: "system_event" as const,
      event,
      systemActorId: "core:timeline-system",
      appActor: {
        kind: "trusted_service" as const,
        trustedServiceId
      }
    },
    visibility: "workforce_metadata" as const,
    activity: {
      kind: "non_activity" as const,
      reasonId: "core:system-metadata"
    },
    occurredAt: fixtureT1,
    receivedAt: fixtureT2
  });
  return inboxV2SystemEventTimelineCreationCommitSchema.parse({
    tenantId: fixtureTenantId,
    timelineAllocation: fixtureTimelineAllocation("external", item),
    source: {
      event,
      eventTypeId: "core:conversation.system_fact",
      eventVersion: "v1",
      conversation: item.conversation,
      payloadDigest: `sha256:${"a".repeat(64)}`,
      occurredAt: fixtureT1,
      recordedAt: fixtureT2
    }
  });
}

function systemEventPayload(commit: InboxV2SystemEventTimelineCreationCommit) {
  return {
    schemaId: INBOX_V2_CONVERSATION_SYSTEM_EVENT_PAYLOAD_SCHEMA_ID,
    schemaVersion: INBOX_V2_CONVERSATION_SYSTEM_EVENT_PAYLOAD_SCHEMA_VERSION,
    conversation: commit.source.conversation,
    recordedAt: commit.source.recordedAt,
    fact: { kind: "fixture" }
  };
}

function systemEventAuthorityContext(
  commit: InboxV2SystemEventTimelineCreationCommit
): Parameters<typeof assertSystemEventTimelineCreationAuthority>[0] {
  const item = commit.timelineAllocation.items[0]!;
  const authorizationEpoch = "authorization:timeline-runtime";
  const resourceAccessRevision = "1";
  return {
    tenantId: commit.tenantId,
    commandTypeId: INBOX_V2_SYSTEM_EVENT_TIMELINE_COMMAND_TYPE_ID,
    actor: { kind: "trusted_service", trustedServiceId },
    authorizationEpoch,
    authorizationDecisionId: decisionId,
    authorizationDecisionRefs: [
      {
        tenantId: commit.tenantId,
        id: decisionId,
        authorizationEpoch,
        principal: { kind: "trusted_service", trustedServiceId },
        permissionId: INBOX_V2_SYSTEM_EVENT_TIMELINE_PERMISSION_ID,
        resourceScopeId: "core:conversation",
        resource: {
          tenantId: commit.tenantId,
          entityTypeId: "core:conversation",
          entityId: item.conversation.id
        },
        resourceAccessRevision,
        decisionRevision: "1",
        decisionHash: "a".repeat(64),
        outcome: "allowed",
        decidedAt: fixtureT1,
        notAfter: "2027-07-11T09:02:00.000Z"
      }
    ],
    authorizationResourceRevisionFences: [
      {
        resourceKind: "conversation",
        resourceId: item.conversation.id,
        resourceHeadId: "authorization-resource:timeline-system-event",
        expectedResourceAccessRevision: resourceAccessRevision,
        advance: "none"
      }
    ],
    occurredAt: commit.timelineAllocation.committedAt
  } as unknown as Parameters<
    typeof assertSystemEventTimelineCreationAuthority
  >[0];
}

function renderSql(statement: Parameters<PgDialect["sqlToQuery"]>[0]): string {
  return new PgDialect().sqlToQuery(statement).sql;
}

function normalizeSql(statement: string): string {
  return statement.replaceAll(/\s+/gu, " ").trim();
}
