import { z } from "zod";

import type { Brand } from "../brand";

const postgresBigintMax = "9223372036854775807";
const canonicalPositiveDecimalPattern = /^[1-9][0-9]*$/;
const canonicalNonNegativeDecimalPattern = /^(?:0|[1-9][0-9]*)$/;

export type InboxV2EntityRevision = Brand<string, "InboxV2EntityRevision">;
export type InboxV2BigintCounter = Brand<string, "InboxV2BigintCounter">;

export const inboxV2EntityRevisionSchema = z
  .string()
  .max(postgresBigintMax.length)
  .regex(canonicalPositiveDecimalPattern)
  .refine(isPostgresBigint, {
    message: "Entity revision exceeds PostgreSQL bigint range."
  })
  .transform((value) => value as InboxV2EntityRevision);

/**
 * Lossless PostgreSQL bigint counter used by positions and checkpoints.
 * Wire contracts deliberately keep the canonical decimal string and never
 * coerce it through a JavaScript number.
 */
export const inboxV2BigintCounterSchema = z
  .string()
  .max(postgresBigintMax.length)
  .regex(canonicalNonNegativeDecimalPattern)
  .refine(isPostgresBigint, {
    message: "Counter exceeds PostgreSQL bigint range."
  })
  .transform((value) => value as InboxV2BigintCounter);

export const inboxV2TimestampSchema = z.string().datetime({
  offset: true,
  precision: 3
});

export function isInboxV2TimestampOrderValid(
  earlier: string,
  later: string
): boolean {
  return Date.parse(later) >= Date.parse(earlier);
}

export function compareInboxV2BigintDecimal(
  left: string,
  right: string
): -1 | 0 | 1 {
  const leftValue = BigInt(inboxV2BigintCounterSchema.parse(left));
  const rightValue = BigInt(inboxV2BigintCounterSchema.parse(right));

  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}

function isPostgresBigint(value: string): boolean {
  return (
    value.length < postgresBigintMax.length ||
    (value.length === postgresBigintMax.length && value <= postgresBigintMax)
  );
}
