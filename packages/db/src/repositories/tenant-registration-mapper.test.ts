import { readFileSync } from "node:fs";

import { createSequentialIdFactory, registerTenant } from "@hulee/core";
import { describe, expect, it } from "vitest";

import {
  collectTenantRegistrationTenantScopedRows,
  mapTenantRegistrationToPersistenceRows
} from "./tenant-registration-mapper";
import { collectTenantBoundaryViolations } from "./tenant-scope";

const now = "2026-06-22T10:00:00.000Z";
const retainedRegistrationRowSets = [
  "tenants",
  "tenantSettings",
  "tenantBrandProfiles",
  "tenantModules",
  "tenantEntitlements",
  "accounts",
  "employees",
  "tenantRoles",
  "tenantRolePermissions",
  "tenantRoleBindings",
  "eventStore",
  "outbox"
] as const;

describe("tenant registration persistence mapper", () => {
  it("maps a passwordless clean-slate registration into only retained foundation rows", () => {
    const registration = registerTenant({
      now,
      tenantSlug: "clean-foundation",
      tenantDisplayName: "Clean Foundation",
      productName: "Clean Desk",
      adminEmail: "Admin@Example.com",
      adminDisplayName: "Admin",
      idFactory: createSequentialIdFactory("clean-foundation")
    });

    const rows = mapTenantRegistrationToPersistenceRows({
      registration,
      adminPasswordHash: null
    });

    expect(Object.keys(rows)).toEqual(retainedRegistrationRowSets);
    expect(rows.accounts).toEqual([
      expect.objectContaining({
        tenantId: registration.tenant.id,
        email: "admin@example.com",
        passwordHash: null,
        emailVerifiedAt: null
      })
    ]);
    expect(rows.employees).toEqual([
      expect.objectContaining({
        tenantId: registration.tenant.id,
        displayName: "Admin"
      })
    ]);
    expect(rows.eventStore.map((row) => row.type)).toEqual([
      "tenant.created",
      "employee.created"
    ]);
    expect(rows.outbox.map((row) => row.eventId)).toEqual(
      registration.events.map((event) => event.id)
    );

    const telegramModule = rows.tenantModules.find(
      (row) => row.moduleId === "channel-telegram"
    );
    expect(telegramModule?.config).toEqual({});
    expect(JSON.stringify(rows)).not.toMatch(
      /botTokenSecretRef|webhookConnectorId|webhookSecretTokenSecretRef|outboundEnabled/
    );
    expect(
      collectTenantBoundaryViolations(
        registration.tenant.id,
        collectTenantRegistrationTenantScopedRows(rows)
      )
    ).toEqual([]);
  });

  it("preserves an explicit local-auth password hash without adding V1 row sets", () => {
    const registration = registerTenant({
      now,
      tenantSlug: "local-auth-foundation",
      tenantDisplayName: "Local Auth Foundation",
      productName: "Local Auth Desk",
      adminEmail: "admin@example.com",
      idFactory: createSequentialIdFactory("local-auth-foundation")
    });

    const rows = mapTenantRegistrationToPersistenceRows({
      registration,
      adminPasswordHash: "scrypt:v1:test"
    });

    expect(rows.accounts[0]?.passwordHash).toBe("scrypt:v1:test");
    expect(Object.keys(rows)).toEqual(retainedRegistrationRowSets);
    expect("clients" in rows).toBe(false);
    expect("conversations" in rows).toBe(false);
    expect("conversationParticipants" in rows).toBe(false);
    expect("messages" in rows).toBe(false);
  });
});

describe("clean-slate foundation seed", () => {
  it("composes tenant registration without V1 demo data or provider credentials", () => {
    const seedSource = readFileSync(
      new URL("../../../../scripts/db/seed-foundation.ts", import.meta.url),
      "utf8"
    );

    expect(seedSource).toContain("registerTenant");
    expect(seedSource).toContain("createTenantRegistrationRepository");
    expect(seedSource).toContain('seedKind: "clean-slate-foundation"');

    for (const forbiddenFragment of [
      "createMvpTenantWorkspace",
      "createTenantWorkspaceRepository",
      "saveWorkspace",
      "HULEE_SEED_CLIENT_NAME",
      "HULEE_SEED_INBOUND_TEXT",
      "HULEE_SEED_TELEGRAM_",
      "botTokenSecretRef",
      "webhookConnectorId",
      "webhookSecretTokenSecretRef",
      "outboundEnabled",
      "conversationId",
      "inboundMessageId"
    ]) {
      expect(seedSource).not.toContain(forbiddenFragment);
    }
  });
});
