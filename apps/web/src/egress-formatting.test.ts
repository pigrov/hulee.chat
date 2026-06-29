import { describe, expect, it } from "vitest";

import {
  egressProfileKindKey,
  egressStatusKey,
  resolveOverallEgressStatus
} from "./egress-formatting";

describe("egress formatting", () => {
  it("maps egress status and profile kind to i18n keys", () => {
    expect(egressStatusKey("ready")).toBe("integrations.egress.status.ready");
    expect(egressProfileKindKey("vpn_namespace")).toBe(
      "integrations.egress.kind.vpn_namespace"
    );
  });

  it("resolves the most severe egress profile status", () => {
    expect(resolveOverallEgressStatus([])).toBe("unknown");
    expect(
      resolveOverallEgressStatus([
        {
          status: "ready"
        },
        {
          status: "degraded"
        }
      ])
    ).toBe("degraded");
    expect(
      resolveOverallEgressStatus([
        {
          status: "unavailable"
        },
        {
          status: "misconfigured"
        }
      ])
    ).toBe("misconfigured");
  });
});
