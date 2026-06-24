import type {
  ClientId,
  ConversationId,
  EmployeeId,
  TenantId
} from "@hulee/contracts";
import { describe, expect, it } from "vitest";

import { assignConversationRouting } from "./conversation-routing";
import { CoreError } from "./errors";
import { createSequentialIdFactory } from "./ids";
import type { Conversation } from "./vertical-slice";

const tenantId = "tenant-routing" as TenantId;
const conversation: Conversation = {
  id: "conversation-routing" as ConversationId,
  tenantId,
  type: "client_direct",
  clientId: "client-routing" as ClientId,
  participantEmployeeIds: [],
  currentQueueId: "queue-intake",
  assignedEmployeeId: "employee-old" as EmployeeId,
  createdAt: "2026-06-22T10:00:00.000Z"
};

describe("conversation routing", () => {
  it("updates queue and assignee fields and emits an explicit assignment event", () => {
    const result = assignConversationRouting({
      now: "2026-06-22T11:00:00.000Z",
      idFactory: createSequentialIdFactory("routing"),
      tenantId,
      actorEmployeeId: "employee-manager" as EmployeeId,
      conversation,
      currentQueueId: "queue-sales",
      assignedEmployeeId: "employee-new" as EmployeeId,
      assignedTeamId: null
    });

    expect(result.conversation).toMatchObject({
      currentQueueId: "queue-sales",
      assignedEmployeeId: "employee-new",
      assignedTeamId: undefined
    });
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      type: "conversation.assigned",
      tenantId,
      payload: {
        conversationId: conversation.id,
        actorEmployeeId: "employee-manager",
        currentQueueId: "queue-sales",
        assignedEmployeeId: "employee-new",
        assignedTeamId: null
      }
    });
  });

  it("rejects cross-tenant routing changes", () => {
    expect(() =>
      assignConversationRouting({
        now: "2026-06-22T11:00:00.000Z",
        idFactory: createSequentialIdFactory("routing-cross"),
        tenantId: "tenant-other" as TenantId,
        actorEmployeeId: "employee-manager" as EmployeeId,
        conversation,
        currentQueueId: "queue-sales"
      })
    ).toThrow(new CoreError("tenant.boundary_violation"));
  });
});
