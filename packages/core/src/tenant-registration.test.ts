import { describe, expect, it } from "vitest";

import { CoreError, createSequentialIdFactory, registerTenant } from "./index";

const now = "2026-06-23T10:00:00.000Z";

describe("tenant registration", () => {
  it("creates a tenant admin workspace without demo customer data", () => {
    const registration = registerTenant({
      now,
      tenantSlug: "Acme-Chat",
      tenantDisplayName: "Acme",
      productName: "Acme Desk",
      adminEmail: "OWNER@EXAMPLE.COM",
      adminDisplayName: "Owner",
      idFactory: createSequentialIdFactory("registration")
    });

    expect(registration.tenant).toMatchObject({
      slug: "acme-chat",
      displayName: "Acme",
      locale: "ru",
      timezone: "Europe/Moscow"
    });
    expect(registration.brandProfile).toMatchObject({
      tenantId: registration.tenant.id,
      productName: "Acme Desk"
    });
    expect(registration.license.entitlements).toContainEqual({
      key: "module.enabled",
      value: "auth-local",
      enabled: true
    });
    expect(registration.admin).toMatchObject({
      tenantId: registration.tenant.id,
      email: "owner@example.com",
      displayName: "Owner",
      systemRoleTemplateIds: ["tenant_admin"]
    });
    expect(registration.events.map((event) => event.type)).toEqual([
      "tenant.created",
      "employee.created"
    ]);
    expect(
      registration.events.every((event) => {
        return event.tenantId === registration.tenant.id;
      })
    ).toBe(true);
  });

  it("requires the local auth module for email-password registration", () => {
    expect(() => {
      registerTenant({
        now,
        tenantSlug: "blocked-auth",
        tenantDisplayName: "Blocked",
        productName: "Blocked Desk",
        adminEmail: "owner@example.com",
        enabledModules: ["channel-public-api"],
        idFactory: createSequentialIdFactory("blocked-auth")
      });
    }).toThrow(new CoreError("module.disabled"));
  });

  it("validates tenant slug and admin email before creating events", () => {
    expect(() => {
      registerTenant({
        now,
        tenantSlug: "bad slug",
        tenantDisplayName: "Bad",
        productName: "Bad Desk",
        adminEmail: "owner@example.com"
      });
    }).toThrow(CoreError);

    expect(() => {
      registerTenant({
        now,
        tenantSlug: "bad-email",
        tenantDisplayName: "Bad",
        productName: "Bad Desk",
        adminEmail: "not-an-email"
      });
    }).toThrow(CoreError);
  });
});
