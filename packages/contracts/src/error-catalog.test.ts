import { describe, expect, it } from "vitest";

import {
  getPlatformErrorDefinition,
  isPlatformErrorCode,
  platformErrorCatalog,
  type PlatformErrorCode
} from "./index";

const platformErrorCodes: PlatformErrorCode[] = [
  "auth.invalid_credentials",
  "auth.email_not_verified",
  "entitlement.missing",
  "license.inactive",
  "permission.denied",
  "tenant.not_found",
  "tenant.boundary_violation",
  "module.disabled",
  "module.unhealthy",
  "usage.limit_exceeded",
  "provider.temporary_failure",
  "provider.permanent_failure",
  "validation.failed"
];

describe("platform error catalog", () => {
  it("defines every public platform error code", () => {
    expect(Object.keys(platformErrorCatalog).sort()).toEqual(
      platformErrorCodes.sort()
    );
  });

  it("keeps provider temporary failures retryable", () => {
    expect(
      getPlatformErrorDefinition("provider.temporary_failure")
    ).toMatchObject({
      httpStatus: 502,
      retryability: "retryable"
    });
  });

  it("detects known codes without accepting arbitrary strings", () => {
    expect(isPlatformErrorCode("validation.failed")).toBe(true);
    expect(isPlatformErrorCode("validation.secret_value")).toBe(false);
  });
});
