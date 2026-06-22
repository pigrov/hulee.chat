import { describe, expect, it } from "vitest";

import {
  evaluateEntitlement,
  evaluatePolicyUsage,
  type LicenseSnapshot
} from "./index";

const activeLicense: LicenseSnapshot = {
  licenseId: "lic_1",
  customerId: "customer_1",
  deploymentId: "deployment_1",
  validFrom: "2026-01-01T00:00:00.000Z",
  validUntil: "2027-01-01T00:00:00.000Z",
  issuer: "hulee",
  entitlements: [
    {
      key: "module.enabled",
      value: "channel.telegram",
      enabled: true
    }
  ]
};

describe("entitlement evaluator", () => {
  it("allows enabled module when license is active", () => {
    const decision = evaluateEntitlement(
      {
        license: activeLicense,
        now: new Date("2026-06-01T00:00:00.000Z")
      },
      "module.enabled",
      "channel.telegram"
    );

    expect(decision).toEqual({ allowed: true });
  });

  it("returns a diagnosable missing entitlement decision", () => {
    const decision = evaluateEntitlement(
      {
        license: activeLicense,
        now: new Date("2026-06-01T00:00:00.000Z")
      },
      "module.enabled",
      "channel.whatsapp"
    );

    expect(decision).toEqual({
      allowed: false,
      code: "entitlement.missing",
      key: "module.enabled"
    });
  });

  it("blocks usage at the hard limit", () => {
    const decision = evaluatePolicyUsage(
      {
        entitlement: "storage.gb_month",
        included: 100,
        hardLimit: 120,
        softLimit: 90,
        resetPeriod: "monthly"
      },
      {
        entitlement: "storage.gb_month",
        used: 120
      }
    );

    expect(decision).toEqual({
      allowed: false,
      code: "usage.limit_exceeded",
      limit: 120,
      used: 120
    });
  });
});
