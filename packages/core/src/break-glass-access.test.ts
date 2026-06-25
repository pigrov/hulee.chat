import type { EmployeeId, EventId, TenantId } from "@hulee/contracts";
import { describe, expect, it } from "vitest";

import { CoreError } from "./errors";
import {
  defaultBreakGlassDurationMs,
  maxBreakGlassDurationMs,
  prepareBreakGlassDirectGrant
} from "./break-glass-access";

const tenantId = "tenant-break-glass" as TenantId;
const actorEmployeeId = "employee-admin" as EmployeeId;
const targetEmployeeId = "employee-target" as EmployeeId;
const now = new Date("2026-06-25T10:00:00.000Z");

describe("break-glass access", () => {
  it("prepares a short-lived direct grant, audit metadata and event", () => {
    const prepared = prepareBreakGlassDirectGrant({
      tenantId,
      grantId: "grant-break-glass",
      eventId: "event-break-glass" as EventId,
      actorEmployeeId,
      targetEmployeeId,
      permission: "message.reply",
      scope: {
        type: "queue",
        id: "queue-sales"
      },
      reason: "urgent customer escalation",
      now
    });
    const expectedExpiresAt = new Date(
      now.getTime() + defaultBreakGlassDurationMs
    ).toISOString();

    expect(prepared.directGrant).toEqual({
      id: "grant-break-glass",
      tenantId,
      employeeId: targetEmployeeId,
      permission: "message.reply",
      scope: {
        type: "queue",
        id: "queue-sales"
      },
      reason: "break-glass: urgent customer escalation",
      expiresAt: expectedExpiresAt
    });
    expect(prepared.createdByEmployeeId).toBe(actorEmployeeId);
    expect(prepared.auditMetadata).toMatchObject({
      breakGlass: true,
      targetEmployeeId,
      permission: "message.reply",
      reason: "break-glass: urgent customer escalation",
      expiresAt: expectedExpiresAt,
      scopeType: "queue",
      scopeId: "queue-sales"
    });
    expect(prepared.event).toMatchObject({
      id: "event-break-glass",
      tenantId,
      type: "direct_grant.created",
      version: "v1",
      occurredAt: now.toISOString(),
      payload: {
        grantId: "grant-break-glass",
        actorEmployeeId,
        targetEmployeeId,
        permission: "message.reply",
        reason: "break-glass: urgent customer escalation",
        expiresAt: expectedExpiresAt,
        scope: {
          type: "queue",
          id: "queue-sales"
        }
      }
    });
  });

  it("rejects missing reasons and non-short expiry windows", () => {
    expect(() =>
      prepareBreakGlassDirectGrant({
        ...validInput(),
        reason: " "
      })
    ).toThrow(new CoreError("validation.failed"));

    expect(() =>
      prepareBreakGlassDirectGrant({
        ...validInput(),
        expiresAt: now
      })
    ).toThrow(new CoreError("validation.failed"));

    expect(() =>
      prepareBreakGlassDirectGrant({
        ...validInput(),
        expiresAt: new Date(now.getTime() + maxBreakGlassDurationMs + 1)
      })
    ).toThrow(new CoreError("validation.failed"));
  });

  it("rejects permission and scope combinations outside the permission catalog", () => {
    expect(() =>
      prepareBreakGlassDirectGrant({
        ...validInput(),
        permission: "modules.manage",
        scope: {
          type: "queue",
          id: "queue-sales"
        }
      })
    ).toThrow(new CoreError("validation.failed"));
  });
});

function validInput(): Parameters<typeof prepareBreakGlassDirectGrant>[0] {
  return {
    tenantId,
    grantId: "grant-break-glass",
    eventId: "event-break-glass" as EventId,
    actorEmployeeId,
    targetEmployeeId,
    permission: "message.reply",
    scope: {
      type: "queue",
      id: "queue-sales"
    },
    reason: "urgent customer escalation",
    now
  };
}
