import { describe, expect, it } from "vitest";

import {
  authSessionCookieName,
  buildWebCookieOptions,
  lastTenantSlugCookieName,
  productionAuthSessionCookieName,
  productionLastTenantSlugCookieName,
  productionTenantLoginChoicesCookieName,
  resolveWebCookieRuntime,
  tenantLoginChoicesCookieName
} from "./session-cookies";

describe("web session cookies", () => {
  it("uses legacy cookie names outside production for local HTTP development", () => {
    expect(resolveWebCookieRuntime("development")).toEqual({
      authSessionCookieName,
      authSessionCookieReadNames: [authSessionCookieName],
      lastTenantSlugCookieName,
      lastTenantSlugCookieReadNames: [lastTenantSlugCookieName],
      tenantLoginChoicesCookieName,
      tenantLoginChoicesCookieReadNames: [tenantLoginChoicesCookieName]
    });
  });

  it("uses __Host-prefixed cookies in production while reading legacy names during migration", () => {
    expect(resolveWebCookieRuntime("production")).toEqual({
      authSessionCookieName: productionAuthSessionCookieName,
      authSessionCookieReadNames: [
        productionAuthSessionCookieName,
        authSessionCookieName
      ],
      lastTenantSlugCookieName: productionLastTenantSlugCookieName,
      lastTenantSlugCookieReadNames: [
        productionLastTenantSlugCookieName,
        lastTenantSlugCookieName
      ],
      tenantLoginChoicesCookieName: productionTenantLoginChoicesCookieName,
      tenantLoginChoicesCookieReadNames: [
        productionTenantLoginChoicesCookieName,
        tenantLoginChoicesCookieName
      ]
    });
  });

  it("builds hardened cookie options for production session state", () => {
    const expires = new Date("2026-06-23T12:00:00.000Z");

    expect(
      buildWebCookieOptions({
        nodeEnv: "production",
        expires
      })
    ).toEqual({
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      expires,
      priority: "high"
    });
  });

  it("does not require HTTPS-only cookies for local development", () => {
    expect(
      buildWebCookieOptions({
        nodeEnv: "development",
        expires: new Date("2026-06-23T12:00:00.000Z")
      }).secure
    ).toBe(false);
  });
});
