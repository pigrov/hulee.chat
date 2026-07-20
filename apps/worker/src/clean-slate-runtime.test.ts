import { CoreError } from "@hulee/core";
import { describe, expect, it } from "vitest";

import { assertCleanSlateWorkerFeatures } from "./index";

describe("Inbox V2 clean-slate worker boundary", () => {
  it("accepts only the provider-free core runtime", () => {
    expect(() => assertCleanSlateWorkerFeatures(["core"])).not.toThrow();
  });

  it.each([
    "webhooks",
    "telegram_bot",
    "telegram_user",
    "whatsapp_user",
    "whatsapp_official",
    "max_user"
  ] as const)("fails loudly when %s is requested", (feature) => {
    expect(() => assertCleanSlateWorkerFeatures(["core", feature])).toThrow(
      expect.objectContaining<Partial<CoreError>>({
        code: "module.disabled"
      })
    );
  });
});
