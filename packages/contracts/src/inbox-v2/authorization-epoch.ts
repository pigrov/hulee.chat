import { z } from "zod";

import type { Brand } from "../brand";

export type InboxV2AuthorizationEpoch = Brand<
  string,
  "InboxV2AuthorizationEpoch"
>;

/** Shared opaque server-derived authorization epoch across Inbox V2 domains. */
export const inboxV2AuthorizationEpochSchema = z
  .string()
  .min(8)
  .max(1_024)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._~:-]*$/u)
  .transform((value) => value as InboxV2AuthorizationEpoch);
