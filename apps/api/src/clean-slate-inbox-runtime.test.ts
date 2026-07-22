import { describe, expect, it } from "vitest";

import {
  createCleanSlatePublicApiCommandService,
  createCleanSlateTelegramWebhookHandler
} from "./clean-slate-inbox-runtime";

describe("Inbox V2 clean-slate API boundary", () => {
  it("fails closed every Public API business command without authority", async () => {
    const commands = createCleanSlatePublicApiCommandService();
    const invocations = [
      () => commands.registerClient({} as never, {} as never),
      () => commands.acceptInboundMessage({} as never, {} as never),
      () => commands.queueOutboundMessage({} as never, {} as never),
      () => commands.getDeliveryStatus({} as never, "message-1")
    ];

    for (const invocation of invocations) {
      await expect(invocation()).rejects.toMatchObject({
        code: "module.disabled"
      });
    }
  });

  it("intentionally drops stale Telegram webhooks without parsing or persistence", async () => {
    const response = await createCleanSlateTelegramWebhookHandler().handle({
      method: "POST",
      path: "/webhooks/telegram/stale-connector",
      headers: {
        authorization: "must-not-be-read"
      },
      body: {
        update_id: 42
      }
    });

    expect(response).toEqual({
      status: 204,
      headers: {
        "cache-control": "no-store",
        "x-hulee-inbox-runtime": "clean-slate-detached"
      },
      body: null
    });
  });
});
