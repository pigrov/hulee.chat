import type {
  PublicApiDeliveryStatusResponse,
  PublicApiInboundMessageResponse,
  PublicApiOutboundMessageResponse,
  PublicApiRegisterClientResponse
} from "@hulee/contracts";
import { CoreError } from "@hulee/core";

import type {
  ApiHttpHandler,
  PublicApiCommandService
} from "./http/public-api-handler";

const detachedRuntimeMessage =
  "Inbox V1 is detached while the Inbox V2 production composition is incomplete.";

export function createCleanSlatePublicApiCommandService(): PublicApiCommandService {
  return {
    async registerClient(): Promise<PublicApiRegisterClientResponse> {
      return rejectDetachedInboxRuntime();
    },

    async acceptInboundMessage(): Promise<PublicApiInboundMessageResponse> {
      return rejectDetachedInboxRuntime();
    },

    async queueOutboundMessage(): Promise<PublicApiOutboundMessageResponse> {
      return rejectDetachedInboxRuntime();
    },

    async getDeliveryStatus(): Promise<PublicApiDeliveryStatusResponse> {
      return rejectDetachedInboxRuntime();
    }
  };
}

export function createCleanSlateTelegramWebhookHandler(): ApiHttpHandler {
  return {
    async handle() {
      // A success response deliberately drains any provider webhook that has not
      // yet been revoked. The handler does not interpret the provider payload,
      // and no connector, secret or V1 repository is reachable.
      return {
        status: 204,
        headers: {
          "cache-control": "no-store",
          "x-hulee-inbox-runtime": "clean-slate-detached"
        },
        body: null
      };
    }
  };
}

function rejectDetachedInboxRuntime(): never {
  throw new CoreError("module.disabled", detachedRuntimeMessage);
}
