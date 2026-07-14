import { z } from "zod";

import type { Brand } from "../brand";
import { inboxV2NamespacedIdSchema } from "./namespace";

export const INBOX_V2_INITIAL_SCHEMA_VERSION = "v1" as const;

export type InboxV2SchemaId = Brand<string, "InboxV2SchemaId">;
export type InboxV2SchemaVersion = Brand<string, "InboxV2SchemaVersion">;

export type InboxV2SchemaEnvelope<
  TSchemaId extends string,
  TSchemaVersion extends string,
  TPayload
> = Readonly<{
  schemaId: TSchemaId;
  schemaVersion: TSchemaVersion;
  payload: TPayload;
}>;

export const inboxV2SchemaIdSchema = inboxV2NamespacedIdSchema.transform(
  (value) => value as unknown as InboxV2SchemaId
);

/**
 * This schema validates version-token syntax only. A contract supports a
 * version only when its exact envelope schema binds that literal.
 */
export const inboxV2SchemaVersionTokenSchema = z
  .string()
  .regex(/^v[1-9][0-9]*$/)
  .transform((value) => value as InboxV2SchemaVersion);

export function createInboxV2SchemaEnvelopeSchema<
  const TSchemaId extends string,
  const TSchemaVersion extends string,
  TPayloadSchema extends z.ZodType
>(
  schemaId: TSchemaId,
  schemaVersion: TSchemaVersion,
  payloadSchema: TPayloadSchema
) {
  inboxV2SchemaIdSchema.parse(schemaId);
  inboxV2SchemaVersionTokenSchema.parse(schemaVersion);

  return z
    .object({
      schemaId: z.literal(schemaId),
      schemaVersion: z.literal(schemaVersion),
      payload: payloadSchema
    })
    .strict();
}

export function createInboxV2SchemaEnvelope<TEnvelopeSchema extends z.ZodType>(
  envelopeSchema: TEnvelopeSchema,
  input: z.input<TEnvelopeSchema>
): z.output<TEnvelopeSchema> {
  return envelopeSchema.parse(input);
}

export type InboxV2VersionedEnvelopeParseResult<
  TSchema extends z.ZodType,
  TInvalidErrorCode extends string,
  TUnsupportedErrorCode extends string
> =
  | Readonly<{ kind: "parsed"; value: z.output<TSchema> }>
  | Readonly<{
      kind: "rejected";
      errorCode: TInvalidErrorCode | TUnsupportedErrorCode;
      cursorAdvance: null;
    }>;

/**
 * Dispatches only after reading the minimal envelope header. Consumers must
 * never try a newer payload with an older parser or advance a cursor after a
 * rejected envelope.
 */
export function parseInboxV2VersionedEnvelope<
  const TSchemaId extends string,
  TSchema extends z.ZodType,
  const TInvalidErrorCode extends string,
  const TUnsupportedErrorCode extends string
>(input: {
  value: unknown;
  schemaId: TSchemaId;
  supportedSchemas: Readonly<Record<string, TSchema>>;
  invalidErrorCode: TInvalidErrorCode;
  unsupportedErrorCode: TUnsupportedErrorCode;
}): InboxV2VersionedEnvelopeParseResult<
  TSchema,
  TInvalidErrorCode,
  TUnsupportedErrorCode
> {
  inboxV2SchemaIdSchema.parse(input.schemaId);
  const header = z
    .object({
      schemaId: z.string(),
      schemaVersion: inboxV2SchemaVersionTokenSchema
    })
    .passthrough()
    .safeParse(input.value);

  if (!header.success) {
    return {
      kind: "rejected",
      errorCode: input.invalidErrorCode,
      cursorAdvance: null
    };
  }

  const parser = input.supportedSchemas[String(header.data.schemaVersion)];
  if (header.data.schemaId !== input.schemaId || parser === undefined) {
    return {
      kind: "rejected",
      errorCode: input.unsupportedErrorCode,
      cursorAdvance: null
    };
  }

  const parsed = parser.safeParse(input.value);
  return parsed.success
    ? { kind: "parsed", value: parsed.data }
    : {
        kind: "rejected",
        errorCode: input.invalidErrorCode,
        cursorAdvance: null
      };
}
