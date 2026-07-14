import { z } from "zod";

import { inboxV2CatalogIdSchema, type InboxV2CatalogId } from "./catalog";
import {
  inboxV2EntityRevisionSchema,
  inboxV2TimestampSchema
} from "./entity-metadata";
import { inboxV2SchemaVersionTokenSchema } from "./schema-version";

export const INBOX_V2_SOURCE_ADAPTER_CONTRACT_CATALOG =
  "source-adapter-contract" as const;
export const INBOX_V2_SOURCE_SURFACE_CATALOG = "source-surface" as const;
export const INBOX_V2_SOURCE_ACCOUNT_REALM_CATALOG =
  "source-account-realm" as const;
export const INBOX_V2_EXTERNAL_THREAD_REALM_CATALOG =
  "external-thread-realm" as const;
export const INBOX_V2_EXTERNAL_THREAD_OBJECT_KIND_CATALOG =
  "external-thread-object-kind" as const;
export const INBOX_V2_EXTERNAL_MESSAGE_REALM_CATALOG =
  "external-message-realm" as const;
export const INBOX_V2_SOURCE_OPERATION_CATALOG = "source-operation" as const;
export const INBOX_V2_SOURCE_CONTENT_KIND_CATALOG =
  "source-content-kind" as const;
export const INBOX_V2_SOURCE_CAPABILITY_CATALOG = "source-capability" as const;
export const INBOX_V2_PROVIDER_ROLE_CATALOG = "provider-role" as const;
export const INBOX_V2_ROUTE_DESTINATION_KIND_CATALOG =
  "route-destination-kind" as const;
export const INBOX_V2_ROUTE_ATTRIBUTE_CATALOG = "route-attribute" as const;
export const INBOX_V2_SOURCE_ROUTE_POLICY_CATALOG =
  "source-route-policy" as const;
export const INBOX_V2_SOURCE_DIAGNOSTIC_CATALOG = "source-diagnostic" as const;
export const INBOX_V2_SOURCE_PERMISSION_CATALOG = "source-permission" as const;
export const INBOX_V2_ROUTING_TRUSTED_SERVICE_CATALOG =
  "trusted-service" as const;

export type InboxV2SourceAdapterContractId = InboxV2CatalogId<
  typeof INBOX_V2_SOURCE_ADAPTER_CONTRACT_CATALOG
>;
export type InboxV2SourceSurfaceId = InboxV2CatalogId<
  typeof INBOX_V2_SOURCE_SURFACE_CATALOG
>;
export type InboxV2SourceAccountRealmId = InboxV2CatalogId<
  typeof INBOX_V2_SOURCE_ACCOUNT_REALM_CATALOG
>;
export type InboxV2ExternalThreadRealmId = InboxV2CatalogId<
  typeof INBOX_V2_EXTERNAL_THREAD_REALM_CATALOG
>;
export type InboxV2ExternalThreadObjectKindId = InboxV2CatalogId<
  typeof INBOX_V2_EXTERNAL_THREAD_OBJECT_KIND_CATALOG
>;
export type InboxV2ExternalMessageRealmId = InboxV2CatalogId<
  typeof INBOX_V2_EXTERNAL_MESSAGE_REALM_CATALOG
>;
export type InboxV2SourceOperationId = InboxV2CatalogId<
  typeof INBOX_V2_SOURCE_OPERATION_CATALOG
>;
export type InboxV2SourceContentKindId = InboxV2CatalogId<
  typeof INBOX_V2_SOURCE_CONTENT_KIND_CATALOG
>;
export type InboxV2SourceCapabilityId = InboxV2CatalogId<
  typeof INBOX_V2_SOURCE_CAPABILITY_CATALOG
>;
export type InboxV2ProviderRoleId = InboxV2CatalogId<
  typeof INBOX_V2_PROVIDER_ROLE_CATALOG
>;
export type InboxV2RouteDestinationKindId = InboxV2CatalogId<
  typeof INBOX_V2_ROUTE_DESTINATION_KIND_CATALOG
>;
export type InboxV2RouteAttributeId = InboxV2CatalogId<
  typeof INBOX_V2_ROUTE_ATTRIBUTE_CATALOG
>;
export type InboxV2SourceRoutePolicyId = InboxV2CatalogId<
  typeof INBOX_V2_SOURCE_ROUTE_POLICY_CATALOG
>;
export type InboxV2SourceDiagnosticId = InboxV2CatalogId<
  typeof INBOX_V2_SOURCE_DIAGNOSTIC_CATALOG
>;
export type InboxV2SourcePermissionId = InboxV2CatalogId<
  typeof INBOX_V2_SOURCE_PERMISSION_CATALOG
>;
export type InboxV2RoutingTrustedServiceId = InboxV2CatalogId<
  typeof INBOX_V2_ROUTING_TRUSTED_SERVICE_CATALOG
>;

function createCatalogIdSchema<TCatalog extends string>() {
  return inboxV2CatalogIdSchema.transform(
    (value) => value as InboxV2CatalogId<TCatalog>
  );
}

export const inboxV2SourceAdapterContractIdSchema =
  createCatalogIdSchema<typeof INBOX_V2_SOURCE_ADAPTER_CONTRACT_CATALOG>();
export const inboxV2SourceSurfaceIdSchema =
  createCatalogIdSchema<typeof INBOX_V2_SOURCE_SURFACE_CATALOG>();
export const inboxV2SourceAccountRealmIdSchema =
  createCatalogIdSchema<typeof INBOX_V2_SOURCE_ACCOUNT_REALM_CATALOG>();
export const inboxV2ExternalThreadRealmIdSchema =
  createCatalogIdSchema<typeof INBOX_V2_EXTERNAL_THREAD_REALM_CATALOG>();
export const inboxV2ExternalThreadObjectKindIdSchema =
  createCatalogIdSchema<typeof INBOX_V2_EXTERNAL_THREAD_OBJECT_KIND_CATALOG>();
export const inboxV2ExternalMessageRealmIdSchema =
  createCatalogIdSchema<typeof INBOX_V2_EXTERNAL_MESSAGE_REALM_CATALOG>();
export const inboxV2SourceOperationIdSchema =
  createCatalogIdSchema<typeof INBOX_V2_SOURCE_OPERATION_CATALOG>();
export const inboxV2SourceContentKindIdSchema =
  createCatalogIdSchema<typeof INBOX_V2_SOURCE_CONTENT_KIND_CATALOG>();
export const inboxV2SourceCapabilityIdSchema =
  createCatalogIdSchema<typeof INBOX_V2_SOURCE_CAPABILITY_CATALOG>();
export const inboxV2ProviderRoleIdSchema =
  createCatalogIdSchema<typeof INBOX_V2_PROVIDER_ROLE_CATALOG>();
export const inboxV2RouteDestinationKindIdSchema =
  createCatalogIdSchema<typeof INBOX_V2_ROUTE_DESTINATION_KIND_CATALOG>();
export const inboxV2RouteAttributeIdSchema =
  createCatalogIdSchema<typeof INBOX_V2_ROUTE_ATTRIBUTE_CATALOG>();
export const inboxV2SourceRoutePolicyIdSchema =
  createCatalogIdSchema<typeof INBOX_V2_SOURCE_ROUTE_POLICY_CATALOG>();
export const inboxV2SourceDiagnosticIdSchema =
  createCatalogIdSchema<typeof INBOX_V2_SOURCE_DIAGNOSTIC_CATALOG>();
export const inboxV2SourcePermissionIdSchema =
  createCatalogIdSchema<typeof INBOX_V2_SOURCE_PERMISSION_CATALOG>();
export const inboxV2RoutingTrustedServiceIdSchema =
  createCatalogIdSchema<typeof INBOX_V2_ROUTING_TRUSTED_SERVICE_CATALOG>();

/** Adapter-owned opaque values are validated but never trimmed or case-folded. */
export const inboxV2OpaqueProviderSubjectSchema = z
  .string()
  .min(1)
  .max(1_024)
  .superRefine((value, context) => {
    if (!/\S/u.test(value)) {
      context.addIssue({
        code: "custom",
        message: "Opaque provider subject cannot be blank."
      });
    }
    if (
      [...value].some((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint <= 31 || codePoint === 127;
      })
    ) {
      context.addIssue({
        code: "custom",
        message: "Opaque provider subject cannot contain control characters."
      });
    }
    if (
      [...value].some((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint >= 0xd800 && codePoint <= 0xdfff;
      })
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Opaque provider subject cannot contain an unpaired UTF-16 surrogate."
      });
    }
  });

export const inboxV2RoutingTokenSchema = z
  .string()
  .min(8)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._~:-]*$/u);

export const inboxV2AdapterContractSnapshotSchema = z
  .object({
    contractId: inboxV2SourceAdapterContractIdSchema,
    contractVersion: inboxV2SchemaVersionTokenSchema,
    declarationRevision: inboxV2EntityRevisionSchema,
    surfaceId: inboxV2SourceSurfaceIdSchema,
    loadedByTrustedServiceId: inboxV2RoutingTrustedServiceIdSchema,
    loadedAt: inboxV2TimestampSchema
  })
  .strict();

export const inboxV2AdapterIdentityScopeKindSchema = z.enum([
  "provider",
  "source_connection",
  "source_account",
  "source_thread_binding",
  "provider_thread"
]);

/**
 * Server-pinned adapter declaration. Parsing a namespaced ID alone is never
 * proof that a module actually registered or may use this realm/scope.
 */
export const inboxV2AdapterIdentityDeclarationSchema = z
  .object({
    adapterContract: inboxV2AdapterContractSnapshotSchema,
    identityKind: z.enum([
      "source_account",
      "source_external_identity",
      "external_thread",
      "message"
    ]),
    realmId: inboxV2CatalogIdSchema,
    realmVersion: inboxV2SchemaVersionTokenSchema,
    canonicalizationVersion: inboxV2SchemaVersionTokenSchema,
    objectKindId: inboxV2CatalogIdSchema,
    scopeKind: inboxV2AdapterIdentityScopeKindSchema,
    decisionStrength: z.enum(["authoritative", "safe_default"])
  })
  .strict()
  .superRefine((declaration, context) => {
    if (
      declaration.decisionStrength === "safe_default" &&
      declaration.scopeKind !== "source_account" &&
      declaration.scopeKind !== "source_thread_binding"
    ) {
      context.addIssue({
        code: "custom",
        path: ["scopeKind"],
        message:
          "Safe-default identity scope is limited to account or binding scope."
      });
    }
    if (
      (declaration.scopeKind === "provider" ||
        declaration.scopeKind === "provider_thread") &&
      declaration.decisionStrength !== "authoritative"
    ) {
      context.addIssue({
        code: "custom",
        path: ["decisionStrength"],
        message: "Provider-wide identity scope requires authoritative evidence."
      });
    }
  });

export const inboxV2RouteDescriptorAttributeSchema = z
  .object({
    attributeId: inboxV2RouteAttributeIdSchema,
    value: inboxV2OpaqueProviderSubjectSchema
  })
  .strict();

/**
 * Bounded, secret-free adapter destination. Credentials are loaded separately
 * from SourceAccount; raw authorization/session/cookie material is forbidden.
 */
export const inboxV2OpaqueAdapterRouteDescriptorSchema = z
  .object({
    adapterContract: inboxV2AdapterContractSnapshotSchema,
    descriptorSchemaId: inboxV2CatalogIdSchema,
    descriptorVersion: inboxV2SchemaVersionTokenSchema,
    descriptorRevision: inboxV2EntityRevisionSchema,
    destinationKindId: inboxV2RouteDestinationKindIdSchema,
    destinationSubject: inboxV2OpaqueProviderSubjectSchema,
    attributes: z.array(inboxV2RouteDescriptorAttributeSchema).max(64),
    descriptorDigestSha256: z.string().regex(/^[a-f0-9]{64}$/u)
  })
  .strict()
  .superRefine((descriptor, context) => {
    const attributeIds = new Set<string>();

    for (const [index, attribute] of descriptor.attributes.entries()) {
      const id = String(attribute.attributeId);
      if (attributeIds.has(id)) {
        context.addIssue({
          code: "custom",
          path: ["attributes", index, "attributeId"],
          message: "Opaque adapter route attributes must be unique."
        });
      }
      attributeIds.add(id);
    }

    if (new TextEncoder().encode(JSON.stringify(descriptor)).length > 16_384) {
      context.addIssue({
        code: "custom",
        message: "Opaque adapter route descriptor exceeds 16 KiB."
      });
    }
  });

export const inboxV2SafeSourceDiagnosticSchema = z
  .object({
    codeId: inboxV2SourceDiagnosticIdSchema,
    retryable: z.boolean(),
    correlationToken: inboxV2RoutingTokenSchema,
    safeOperatorHintId: inboxV2CatalogIdSchema.nullable()
  })
  .strict();

export type InboxV2AdapterContractSnapshot = z.infer<
  typeof inboxV2AdapterContractSnapshotSchema
>;
export type InboxV2AdapterIdentityDeclaration = z.infer<
  typeof inboxV2AdapterIdentityDeclarationSchema
>;
export type InboxV2OpaqueAdapterRouteDescriptor = z.infer<
  typeof inboxV2OpaqueAdapterRouteDescriptorSchema
>;
export type InboxV2SafeSourceDiagnostic = z.infer<
  typeof inboxV2SafeSourceDiagnosticSchema
>;
