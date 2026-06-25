import { describe, expect, it } from "vitest";

import {
  PrivilegedActionReauthRequiredError,
  assertRecentPrivilegedActionSession
} from "./privileged-action-policy";

describe("privileged action policy", () => {
  it("allows recent stored sessions", () => {
    expect(() => {
      assertRecentPrivilegedActionSession(
        {
          sessionCreatedAt: "2026-06-22T10:00:00.000Z"
        },
        {
          now: new Date("2026-06-22T10:20:00.000Z"),
          maxAgeMs: 30 * 60 * 1000
        }
      );
    }).not.toThrow();
  });

  it("requires re-authentication for stale stored sessions", () => {
    expect(() => {
      assertRecentPrivilegedActionSession(
        {
          sessionCreatedAt: "2026-06-22T10:00:00.000Z"
        },
        {
          now: new Date("2026-06-22T10:31:00.000Z"),
          maxAgeMs: 30 * 60 * 1000
        }
      );
    }).toThrow(PrivilegedActionReauthRequiredError);
  });

  it("allows sessions without stored creation time by default", () => {
    expect(() => {
      assertRecentPrivilegedActionSession({});
    }).not.toThrow();
  });

  it("can require stored creation time for strict callers", () => {
    expect(() => {
      assertRecentPrivilegedActionSession(
        {},
        {
          allowMissingSessionCreatedAt: false
        }
      );
    }).toThrow(PrivilegedActionReauthRequiredError);
  });
});
