import type {
  EmployeeId,
  InternalInboxConversation,
  TenantId
} from "@hulee/contracts";
import type { EffectivePermissionGrant, PermissionActor } from "@hulee/core";
import { describe, expect, it } from "vitest";

import { canReplyToConversation } from "./conversation-reply-options";

const tenantId = "tenant-1" as TenantId;
const employeeId = "employee-1" as EmployeeId;
const actor: PermissionActor = {
  tenantId,
  employeeId,
  queueIds: ["queue-sales"],
  teamIds: ["team-sales"],
  orgUnitIds: ["org-sales"]
};
const conversation: InternalInboxConversation = {
  id: "conversation-1",
  clientId: "client-1",
  clientDisplayName: "Client",
  status: "open",
  source: "telegram",
  currentQueueId: "queue-sales",
  currentQueueOwningOrgUnitId: "org-sales",
  messageCount: 1,
  queuedCount: 0
};

describe("conversation reply options", () => {
  it("allows replies when the message scope covers the queue", () => {
    expect(
      canReplyToConversation({
        tenantId,
        actor,
        effectiveGrants: [grant({ type: "queue", id: "queue-sales" })],
        conversation
      })
    ).toBe(true);
  });

  it("rejects replies outside the actor queue scope", () => {
    expect(
      canReplyToConversation({
        tenantId,
        actor,
        effectiveGrants: [grant({ type: "queue", id: "queue-sales" })],
        conversation: {
          ...conversation,
          currentQueueId: "queue-claims",
          currentQueueOwningOrgUnitId: "org-claims"
        }
      })
    ).toBe(false);
  });

  it("allows org-scoped replies only for conversations in the org queue", () => {
    expect(
      canReplyToConversation({
        tenantId,
        actor,
        effectiveGrants: [grant({ type: "org_unit", id: "org-sales" })],
        conversation
      })
    ).toBe(true);

    expect(
      canReplyToConversation({
        tenantId,
        actor,
        effectiveGrants: [grant({ type: "org_unit", id: "org-sales" })],
        conversation: {
          ...conversation,
          currentQueueId: "queue-claims",
          currentQueueOwningOrgUnitId: "org-claims"
        }
      })
    ).toBe(false);
  });

  it("allows assigned replies through employee and team assignment", () => {
    expect(
      canReplyToConversation({
        tenantId,
        actor,
        effectiveGrants: [grant({ type: "assigned" })],
        conversation: {
          ...conversation,
          assignedEmployeeId: employeeId
        }
      })
    ).toBe(true);

    expect(
      canReplyToConversation({
        tenantId,
        actor,
        effectiveGrants: [grant({ type: "assigned" })],
        conversation: {
          ...conversation,
          assignedTeamId: "team-sales"
        }
      })
    ).toBe(true);
  });
});

function grant(
  scope: EffectivePermissionGrant["scope"]
): EffectivePermissionGrant {
  return {
    tenantId,
    employeeId,
    permission: "message.reply",
    scope,
    sources: []
  };
}
