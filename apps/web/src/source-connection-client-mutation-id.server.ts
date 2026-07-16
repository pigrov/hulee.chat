import { randomUUID } from "node:crypto";

import {
  inboxV2ClientMutationIdSchema,
  type InboxV2ClientMutationId
} from "@hulee/contracts";

export function createSourceConnectionClientMutationId(
  uuidFactory: () => string = randomUUID
): InboxV2ClientMutationId {
  return inboxV2ClientMutationIdSchema.parse(
    `client-mutation:source-${uuidFactory()}`
  );
}
