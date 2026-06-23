import { describe, expect, it } from "vitest";

import {
  buildContentSecurityPolicy,
  buildSecurityHeaders
} from "./security-headers";

describe("web security headers", () => {
  it("adds baseline browser hardening headers", () => {
    const headers = new Map(
      buildSecurityHeaders({ nodeEnv: "production" }).map((header) => [
        header.key,
        header.value
      ])
    );

    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("Referrer-Policy")).toBe(
      "strict-origin-when-cross-origin"
    );
    expect(headers.get("Permissions-Policy")).toContain("camera=()");
    expect(headers.get("Strict-Transport-Security")).toContain(
      "max-age=31536000"
    );
  });

  it("keeps CSP restrictive without blocking local development tooling", () => {
    const developmentPolicy = buildContentSecurityPolicy({
      nodeEnv: "development"
    });
    const productionPolicy = buildContentSecurityPolicy({
      nodeEnv: "production"
    });

    expect(productionPolicy).toContain("frame-ancestors 'none'");
    expect(productionPolicy).toContain("object-src 'none'");
    expect(productionPolicy).toContain("upgrade-insecure-requests");
    expect(productionPolicy).not.toContain("'unsafe-eval'");
    expect(developmentPolicy).toContain("'unsafe-eval'");
  });
});
