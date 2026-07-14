import { z } from "zod";

import type { Brand } from "../brand";

const namespaceSegmentPattern = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;

export const inboxV2ReservedModuleIds = [
  "core",
  "hulee",
  "module",
  "platform",
  "system"
] as const;

export type InboxV2ModuleId = Brand<string, "InboxV2ModuleId">;
export type InboxV2LocalId = Brand<string, "InboxV2LocalId">;
export type InboxV2Namespace = "core" | Brand<string, "InboxV2ModuleNamespace">;
export type InboxV2NamespacedId = Brand<string, "InboxV2NamespacedId">;

export const inboxV2ModuleIdSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(namespaceSegmentPattern)
  .refine(
    (value) =>
      !inboxV2ReservedModuleIds.includes(
        value as (typeof inboxV2ReservedModuleIds)[number]
      ),
    { message: "Reserved Inbox V2 namespace cannot be used as a module ID." }
  )
  .transform((value) => value as InboxV2ModuleId);

export const inboxV2LocalIdSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(namespaceSegmentPattern)
  .transform((value) => value as InboxV2LocalId);

export const inboxV2NamespaceSchema = z
  .string()
  .min(1)
  .max(88)
  .superRefine((value, context) => {
    if (value === "core") {
      return;
    }

    if (!value.startsWith("module:")) {
      context.addIssue({
        code: "custom",
        message: "Inbox V2 namespace must be core or module:<module-id>."
      });
      return;
    }

    const moduleId = value.slice("module:".length);
    const result = inboxV2ModuleIdSchema.safeParse(moduleId);

    if (!result.success) {
      context.addIssue({
        code: "custom",
        message: "Inbox V2 module namespace contains an invalid module ID."
      });
    }
  })
  .transform((value) => value as InboxV2Namespace);

export const inboxV2NamespacedIdSchema = z
  .string()
  .min(1)
  .max(256)
  .superRefine((value, context) => {
    if (value.startsWith("core:")) {
      const localId = value.slice("core:".length);

      if (!inboxV2LocalIdSchema.safeParse(localId).success) {
        context.addIssue({
          code: "custom",
          message: "Inbox V2 core ID contains an invalid local ID."
        });
      }

      return;
    }

    if (value.startsWith("module:")) {
      const remainder = value.slice("module:".length);
      const separatorIndex = remainder.indexOf(":");

      if (separatorIndex <= 0) {
        context.addIssue({
          code: "custom",
          message: "Inbox V2 module ID must be module:<module-id>:<local-id>."
        });
        return;
      }

      const moduleId = remainder.slice(0, separatorIndex);
      const localId = remainder.slice(separatorIndex + 1);

      if (!inboxV2ModuleIdSchema.safeParse(moduleId).success) {
        context.addIssue({
          code: "custom",
          message: "Inbox V2 module ID contains an invalid module ID."
        });
      }

      if (!inboxV2LocalIdSchema.safeParse(localId).success) {
        context.addIssue({
          code: "custom",
          message: "Inbox V2 module ID contains an invalid local ID."
        });
      }

      return;
    }

    context.addIssue({
      code: "custom",
      message:
        "Inbox V2 ID must use the core:<local-id> or module:<module-id>:<local-id> namespace."
    });
  })
  .transform((value) => value as InboxV2NamespacedId);

export type InboxV2NamespacedIdParts =
  | Readonly<{ namespace: "core"; localId: InboxV2LocalId }>
  | Readonly<{
      namespace: Brand<string, "InboxV2ModuleNamespace">;
      moduleId: InboxV2ModuleId;
      localId: InboxV2LocalId;
    }>;

export function parseInboxV2NamespacedId(
  input: string
): InboxV2NamespacedIdParts {
  const value = inboxV2NamespacedIdSchema.parse(input);

  if (value.startsWith("core:")) {
    return Object.freeze({
      namespace: "core" as const,
      localId: inboxV2LocalIdSchema.parse(value.slice("core:".length))
    });
  }

  const remainder = value.slice("module:".length);
  const separatorIndex = remainder.indexOf(":");
  const moduleId = inboxV2ModuleIdSchema.parse(
    remainder.slice(0, separatorIndex)
  );

  return Object.freeze({
    namespace: `module:${moduleId}` as Brand<string, "InboxV2ModuleNamespace">,
    moduleId,
    localId: inboxV2LocalIdSchema.parse(remainder.slice(separatorIndex + 1))
  });
}
