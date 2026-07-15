import { describe, expect, it } from "vitest";

import * as core from "./index";

describe("Inbox V2 security-denial package API", () => {
  it("exports only the gate and opaque context constructors", () => {
    const tenantScope = core.createInboxV2VerifiedSecurityTenantScope(
      "tenant:security-denial-public-api"
    );
    const fingerprints = core.createInboxV2SecurityDenialFingerprintProof({
      tenantId: tenantScope.tenantId,
      action: "resource.read",
      principalClass: "employee",
      fingerprintKeyEpoch: "security-denial-key:0123456789abcdef",
      hmacKey: new Uint8Array(32).fill(7),
      actorStableKey: "employee:public-api",
      dedupeStableKey: "opaque:public-api-target"
    });
    const context: core.InboxV2SecurityDenialContext = {
      principalClass: "employee",
      tenantScope,
      fingerprints,
      reviewCandidateRef: null
    };

    expect(context.fingerprints.action).toBe("resource.read");
    expect(core.executeInboxV2AuthorizationGate).toBeTypeOf("function");
    expect(core).not.toHaveProperty("planInboxV2SecurityDenial");
    expect(core).not.toHaveProperty("tryObserveInboxV2SecurityDenial");
  });
});
