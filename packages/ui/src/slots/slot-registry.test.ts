import { describe, expect, it } from "vitest";

import { createSlotRegistry, getSlotContributions } from "./slot-registry";

describe("slot registry", () => {
  it("orders slot contributions and filters by client", () => {
    const registry = createSlotRegistry([
      {
        id: "telegram-composer",
        slot: "conversation.composer.tool",
        componentRef: "channel-telegram/ComposerTool",
        supportedClients: ["web"],
        order: 20
      },
      {
        id: "public-api-composer",
        slot: "conversation.composer.tool",
        componentRef: "channel-public-api/ComposerTool",
        supportedClients: ["web", "desktop"],
        order: 10
      }
    ]);

    expect(
      getSlotContributions({
        registry,
        slot: "conversation.composer.tool",
        client: "web"
      }).map((contribution) => contribution.id)
    ).toEqual(["public-api-composer", "telegram-composer"]);

    expect(
      getSlotContributions({
        registry,
        slot: "conversation.composer.tool",
        client: "mobile"
      })
    ).toEqual([]);
  });
});
