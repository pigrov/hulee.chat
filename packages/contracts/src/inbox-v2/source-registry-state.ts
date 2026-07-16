import { z } from "zod";

import { inboxV2CatalogIdSchema } from "./catalog";
import {
  inboxV2EntityRevisionSchema,
  inboxV2TimestampSchema,
  isInboxV2TimestampOrderValid
} from "./entity-metadata";
import {
  inboxV2SourceAccountReferenceSchema,
  inboxV2SourceConnectionReferenceSchema,
  inboxV2TenantIdSchema
} from "./ids";
import {
  createInboxV2SchemaEnvelopeSchema,
  INBOX_V2_INITIAL_SCHEMA_VERSION
} from "./schema-version";
import {
  inboxV2AdapterContractSnapshotSchema,
  inboxV2RoutingTokenSchema
} from "./source-routing-primitives";
import { inboxV2SourceThreadBindingTransitionActorSchema } from "./source-thread-binding";
import {
  assertInboxV2SourceRegistryLifecycleLocator,
  inboxV2SourceRegistryLifecycleLocatorSchema,
  isInboxV2SourceRegistryLifecycleBinding,
  type InboxV2SourceRegistryLifecycleBinding
} from "./source-registry-lifecycle";
import {
  inboxV2PayloadReferenceSchema,
  inboxV2Sha256DigestSchema
} from "./sync-primitives";

export const INBOX_V2_SOURCE_CONNECTION_REGISTRY_STATE_SCHEMA_ID =
  "core:inbox-v2.source-connection-registry-state" as const;
export const INBOX_V2_SOURCE_ACCOUNT_REGISTRY_STATE_SCHEMA_ID =
  "core:inbox-v2.source-account-registry-state" as const;
export const INBOX_V2_SOURCE_REGISTRY_STATE_SCHEMA_VERSION =
  INBOX_V2_INITIAL_SCHEMA_VERSION;

export const inboxV2SourceRegistryNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9][a-z0-9._-]*$/u);

export const inboxV2SourceRegistryArtifactKindSchema = z.enum([
  "configuration",
  "capability",
  "metadata",
  "diagnostic",
  "catalog_registration",
  "module_registration"
]);

/**
 * The registry never embeds provider JSON. It stores an immutable, digest-
 * pinned classified payload reference and its exact lifecycle lineage.
 */
export const inboxV2SourceRegistryArtifactReferenceSchema = z
  .object({
    kind: inboxV2SourceRegistryArtifactKindSchema,
    payload: inboxV2PayloadReferenceSchema,
    lifecycle: inboxV2SourceRegistryLifecycleLocatorSchema
  })
  .strict()
  .superRefine((artifact, context) => {
    const expectedSlot =
      artifact.kind === "catalog_registration"
        ? "source_catalog_registration"
        : artifact.kind === "module_registration"
          ? "source_module_registration"
          : "source_registry_artifact";
    if (artifact.lifecycle.copySlot !== expectedSlot) {
      addIssue(
        context,
        ["lifecycle", "copySlot"],
        `Artifact kind ${artifact.kind} requires lifecycle slot ${expectedSlot}.`
      );
    }
  });

/**
 * Opaque, revocable authority reference. Vault paths, ciphertext, provider
 * credentials and challenge/session material are intentionally unrepresentable.
 */
export const inboxV2SourceRegistrySecretReferenceSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    bindingId: inboxV2RoutingTokenSchema,
    revision: inboxV2EntityRevisionSchema,
    status: z.enum(["active", "revoked"]),
    lifecycle: inboxV2SourceRegistryLifecycleLocatorSchema
  })
  .strict()
  .superRefine((secret, context) => {
    if (secret.lifecycle.copySlot !== "credential_binding") {
      addIssue(
        context,
        ["lifecycle", "copySlot"],
        "Credential authority requires the credential_binding lifecycle slot."
      );
    }
  });

export const inboxV2SourceRegistryRouteAuthoritySchema = z
  .object({
    state: z.enum(["enabled", "inbound_only", "denied"]),
    generation: inboxV2EntityRevisionSchema,
    reasonCodeId: inboxV2CatalogIdSchema,
    changedAt: inboxV2TimestampSchema
  })
  .strict();

export const inboxV2SourceConnectionRegistryStatusSchema = z.enum([
  "pending",
  "active",
  "degraded",
  "disabled",
  "deleted"
]);

export const inboxV2SourceAccountRegistryStatusSchema = z.enum([
  "pending",
  "active",
  "degraded",
  "disabled",
  "replaced",
  "deleted"
]);

const sourceAccountIdentityFenceCommonShape = {
  kind: z.literal("source_account_identity"),
  identityRevision: inboxV2EntityRevisionSchema,
  accountGeneration: inboxV2EntityRevisionSchema
};

export const inboxV2SourceAccountIdentityFenceSchema = z.discriminatedUnion(
  "state",
  [
    z
      .object({
        ...sourceAccountIdentityFenceCommonShape,
        state: z.literal("provisional"),
        provisionalKeyDigest: inboxV2Sha256DigestSchema
      })
      .strict(),
    z
      .object({
        ...sourceAccountIdentityFenceCommonShape,
        state: z.literal("verified"),
        canonicalIdentityDigest: inboxV2Sha256DigestSchema
      })
      .strict(),
    z
      .object({
        ...sourceAccountIdentityFenceCommonShape,
        state: z.literal("conflicted"),
        conflictEvidenceDigest: inboxV2Sha256DigestSchema
      })
      .strict()
  ]
);

export const inboxV2SourceAccountAccessFenceSchema = z
  .object({
    resource: inboxV2SourceAccountReferenceSchema,
    authorizationResourceHeadId: inboxV2RoutingTokenSchema,
    resourceAccessRevision: inboxV2EntityRevisionSchema,
    structuralRelationRevision: inboxV2EntityRevisionSchema
  })
  .strict();

const relatedAuthorityBaseShape = {
  tenantId: inboxV2TenantIdSchema,
  authorityId: inboxV2RoutingTokenSchema,
  revision: inboxV2EntityRevisionSchema,
  status: z.enum(["active", "revoked"]),
  sourceConnection: inboxV2SourceConnectionReferenceSchema,
  sourceAccount: inboxV2SourceAccountReferenceSchema.nullable(),
  lifecycle: inboxV2SourceRegistryLifecycleLocatorSchema
};

/** Typed references keep connector/session/challenge authority out of JSON. */
export const inboxV2SourceRegistryRelatedAuthorityReferenceSchema =
  z.discriminatedUnion("kind", [
    z
      .object({
        ...relatedAuthorityBaseShape,
        kind: z.literal("channel_connector")
      })
      .strict(),
    z
      .object({
        ...relatedAuthorityBaseShape,
        kind: z.literal("channel_session"),
        connectorAuthorityId: inboxV2RoutingTokenSchema
      })
      .strict(),
    z
      .object({
        ...relatedAuthorityBaseShape,
        kind: z.literal("channel_session_event"),
        connectorAuthorityId: inboxV2RoutingTokenSchema,
        sessionAuthorityId: inboxV2RoutingTokenSchema
      })
      .strict(),
    z
      .object({
        ...relatedAuthorityBaseShape,
        kind: z.literal("channel_auth_challenge"),
        connectorAuthorityId: inboxV2RoutingTokenSchema,
        sessionAuthorityId: inboxV2RoutingTokenSchema.nullable()
      })
      .strict(),
    z
      .object({
        ...relatedAuthorityBaseShape,
        kind: z.literal("source_ingress_route"),
        parentAuthorityId: inboxV2RoutingTokenSchema,
        handlerGeneration: inboxV2EntityRevisionSchema
      })
      .strict()
  ]);

const sourceRegistryCommonShape = {
  tenantId: inboxV2TenantIdSchema,
  sourceName: inboxV2SourceRegistryNameSchema,
  displayName: z.string().trim().min(1).max(200),
  sourceTypeId: inboxV2CatalogIdSchema,
  adapterContract: inboxV2AdapterContractSnapshotSchema,
  lifecycle: inboxV2SourceRegistryLifecycleLocatorSchema,
  revision: inboxV2EntityRevisionSchema,
  routeAuthority: inboxV2SourceRegistryRouteAuthoritySchema,
  artifacts: z
    .array(inboxV2SourceRegistryArtifactReferenceSchema)
    .max(1_000)
    .superRefine((artifacts, context) => {
      const keys = new Set<string>();
      for (const [index, artifact] of artifacts.entries()) {
        const key = artifact.kind;
        if (keys.has(key)) {
          addIssue(
            context,
            [index],
            "Duplicate classified source-registry artifact reference."
          );
        }
        keys.add(key);
      }
    }),
  credentialBindings: z
    .array(inboxV2SourceRegistrySecretReferenceSchema)
    .max(100)
    .superRefine((secrets, context) => {
      const keys = new Set<string>();
      for (const [index, secret] of secrets.entries()) {
        if (keys.has(secret.bindingId)) {
          addIssue(
            context,
            [index, "bindingId"],
            "Duplicate source-registry credential binding."
          );
        }
        keys.add(secret.bindingId);
      }
    }),
  relatedAuthorities: z
    .array(inboxV2SourceRegistryRelatedAuthorityReferenceSchema)
    .max(10_000)
    .superRefine((authorities, context) => {
      const keys = new Set<string>();
      for (const [index, authority] of authorities.entries()) {
        const key = `${authority.kind}\u0000${authority.authorityId}`;
        if (keys.has(key)) {
          addIssue(
            context,
            [index],
            "Duplicate typed source-registry related authority reference."
          );
        }
        keys.add(key);
      }
    }),
  createdBy: inboxV2SourceThreadBindingTransitionActorSchema,
  createdAt: inboxV2TimestampSchema,
  updatedAt: inboxV2TimestampSchema
};

const sourceConnectionRegistryStatePayloadSchema = z
  .object({
    ...sourceRegistryCommonShape,
    entityKind: z.literal("source_connection"),
    sourceConnection: inboxV2SourceConnectionReferenceSchema,
    status: inboxV2SourceConnectionRegistryStatusSchema
  })
  .strict()
  .superRefine((state, context) => {
    addCommonStateIssues(state, context);
    addTenantReferenceIssue(context, state.tenantId, state.sourceConnection, [
      "sourceConnection"
    ]);
    if (state.lifecycle.copySlot !== "source_connection_registry") {
      addIssue(
        context,
        ["lifecycle", "copySlot"],
        "SourceConnection state requires source_connection_registry lifecycle lineage."
      );
    }
    addRelatedAuthorityAnchorIssues(state, context);
    addRouteStatusIssue(state.status, state.routeAuthority.state, context);
  });

const sourceAccountRegistryStatePayloadSchema = z
  .object({
    ...sourceRegistryCommonShape,
    entityKind: z.literal("source_account"),
    sourceAccount: inboxV2SourceAccountReferenceSchema,
    sourceConnection: inboxV2SourceConnectionReferenceSchema,
    status: inboxV2SourceAccountRegistryStatusSchema,
    identityFence: inboxV2SourceAccountIdentityFenceSchema,
    accessFence: inboxV2SourceAccountAccessFenceSchema
  })
  .strict()
  .superRefine((state, context) => {
    addCommonStateIssues(state, context);
    addTenantReferenceIssue(context, state.tenantId, state.sourceAccount, [
      "sourceAccount"
    ]);
    addTenantReferenceIssue(context, state.tenantId, state.sourceConnection, [
      "sourceConnection"
    ]);
    if (state.lifecycle.copySlot !== "source_account_registry") {
      addIssue(
        context,
        ["lifecycle", "copySlot"],
        "SourceAccount state requires source_account_registry lifecycle lineage."
      );
    }
    addRelatedAuthorityAnchorIssues(state, context);
    addRouteStatusIssue(state.status, state.routeAuthority.state, context);
    if (
      state.accessFence.resource.tenantId !== state.tenantId ||
      state.accessFence.resource.id !== state.sourceAccount.id
    ) {
      addIssue(
        context,
        ["accessFence", "resource"],
        "SourceAccount access fence must pin its exact RBAC-003 resource head."
      );
    }
    if (
      state.routeAuthority.state === "enabled" &&
      state.identityFence.state !== "verified"
    ) {
      addIssue(
        context,
        ["identityFence", "state"],
        "Enabled SourceAccount routing requires verified DB-003 identity authority."
      );
    }
    if (
      state.identityFence.state === "conflicted" &&
      state.routeAuthority.state !== "denied"
    ) {
      addIssue(
        context,
        ["routeAuthority", "state"],
        "Conflicted SourceAccount identity must fail closed."
      );
    }
  });

export const inboxV2SourceConnectionRegistryStateSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_SOURCE_CONNECTION_REGISTRY_STATE_SCHEMA_ID,
    INBOX_V2_SOURCE_REGISTRY_STATE_SCHEMA_VERSION,
    sourceConnectionRegistryStatePayloadSchema
  );

export const inboxV2SourceAccountRegistryStateSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_SOURCE_ACCOUNT_REGISTRY_STATE_SCHEMA_ID,
    INBOX_V2_SOURCE_REGISTRY_STATE_SCHEMA_VERSION,
    sourceAccountRegistryStatePayloadSchema
  );

export type InboxV2SourceRegistryArtifactReference = z.infer<
  typeof inboxV2SourceRegistryArtifactReferenceSchema
>;
export type InboxV2SourceRegistrySecretReference = z.infer<
  typeof inboxV2SourceRegistrySecretReferenceSchema
>;
export type InboxV2SourceRegistryRouteAuthority = z.infer<
  typeof inboxV2SourceRegistryRouteAuthoritySchema
>;
export type InboxV2SourceAccountIdentityFence = z.infer<
  typeof inboxV2SourceAccountIdentityFenceSchema
>;
export type InboxV2SourceAccountAccessFence = z.infer<
  typeof inboxV2SourceAccountAccessFenceSchema
>;
export type InboxV2SourceRegistryRelatedAuthorityReference = z.infer<
  typeof inboxV2SourceRegistryRelatedAuthorityReferenceSchema
>;
export type InboxV2SourceConnectionRegistryState = Readonly<
  z.infer<typeof inboxV2SourceConnectionRegistryStateSchema>
>;
export type InboxV2SourceAccountRegistryState = Readonly<
  z.infer<typeof inboxV2SourceAccountRegistryStateSchema>
>;
export type InboxV2SourceRegistryState =
  | InboxV2SourceConnectionRegistryState
  | InboxV2SourceAccountRegistryState;

const definedConnectionRegistryStates = new WeakSet<object>();
const definedAccountRegistryStates = new WeakSet<object>();

export function isInboxV2SourceConnectionRegistryState(
  value: unknown
): value is InboxV2SourceConnectionRegistryState {
  return (
    typeof value === "object" &&
    value !== null &&
    definedConnectionRegistryStates.has(value)
  );
}

export function isInboxV2SourceAccountRegistryState(
  value: unknown
): value is InboxV2SourceAccountRegistryState {
  return (
    typeof value === "object" &&
    value !== null &&
    definedAccountRegistryStates.has(value)
  );
}

export function defineInboxV2SourceConnectionRegistryState(input: {
  lifecycleBinding: InboxV2SourceRegistryLifecycleBinding;
  value: z.input<typeof inboxV2SourceConnectionRegistryStateSchema>;
}): InboxV2SourceConnectionRegistryState {
  const parsed = inboxV2SourceConnectionRegistryStateSchema.parse(input.value);
  assertStateLifecycleReferences(input.lifecycleBinding, parsed.payload);
  const frozen = cloneAndFreeze(parsed);
  definedConnectionRegistryStates.add(frozen as object);
  return frozen;
}

export function defineInboxV2SourceAccountRegistryState(input: {
  lifecycleBinding: InboxV2SourceRegistryLifecycleBinding;
  value: z.input<typeof inboxV2SourceAccountRegistryStateSchema>;
}): InboxV2SourceAccountRegistryState {
  const parsed = inboxV2SourceAccountRegistryStateSchema.parse(input.value);
  assertStateLifecycleReferences(input.lifecycleBinding, parsed.payload);
  const frozen = cloneAndFreeze(parsed);
  definedAccountRegistryStates.add(frozen as object);
  return frozen;
}

function assertStateLifecycleReferences(
  lifecycleBinding: InboxV2SourceRegistryLifecycleBinding,
  state:
    | z.output<typeof sourceConnectionRegistryStatePayloadSchema>
    | z.output<typeof sourceAccountRegistryStatePayloadSchema>
): void {
  if (!isInboxV2SourceRegistryLifecycleBinding(lifecycleBinding)) {
    throw new Error(
      "Source-registry state requires an authentic lifecycle binding."
    );
  }
  assertInboxV2SourceRegistryLifecycleLocator({
    binding: lifecycleBinding,
    locator: state.lifecycle
  });
  for (const artifact of state.artifacts) {
    if (artifact.payload.tenantId !== state.tenantId) {
      throw new Error("Source-registry artifact crosses the tenant boundary.");
    }
    assertInboxV2SourceRegistryLifecycleLocator({
      binding: lifecycleBinding,
      locator: artifact.lifecycle
    });
  }
  for (const secret of state.credentialBindings) {
    if (secret.tenantId !== state.tenantId) {
      throw new Error(
        "Source-registry credential crosses the tenant boundary."
      );
    }
    assertInboxV2SourceRegistryLifecycleLocator({
      binding: lifecycleBinding,
      locator: secret.lifecycle
    });
  }
  for (const authority of state.relatedAuthorities) {
    assertInboxV2SourceRegistryLifecycleLocator({
      binding: lifecycleBinding,
      locator: authority.lifecycle
    });
  }
}

function addRelatedAuthorityAnchorIssues(
  state:
    | z.output<typeof sourceConnectionRegistryStatePayloadSchema>
    | z.output<typeof sourceAccountRegistryStatePayloadSchema>,
  context: z.RefinementCtx
): void {
  for (const [index, authority] of state.relatedAuthorities.entries()) {
    if (authority.sourceConnection.id !== state.sourceConnection.id) {
      addIssue(
        context,
        ["relatedAuthorities", index, "sourceConnection"],
        "Related authority must pin the registry state's SourceConnection."
      );
    }
    if (
      state.entityKind === "source_account" &&
      authority.sourceAccount !== null &&
      authority.sourceAccount.id !== state.sourceAccount.id
    ) {
      addIssue(
        context,
        ["relatedAuthorities", index, "sourceAccount"],
        "Related authority SourceAccount must match the registry state."
      );
    }
  }
}

function addCommonStateIssues(
  state: {
    tenantId: string;
    adapterContract: { loadedAt: string };
    routeAuthority: { state: string; changedAt: string };
    artifacts: readonly z.output<
      typeof inboxV2SourceRegistryArtifactReferenceSchema
    >[];
    credentialBindings: readonly z.output<
      typeof inboxV2SourceRegistrySecretReferenceSchema
    >[];
    relatedAuthorities: readonly z.output<
      typeof inboxV2SourceRegistryRelatedAuthorityReferenceSchema
    >[];
    createdBy: z.output<typeof inboxV2SourceThreadBindingTransitionActorSchema>;
    createdAt: string;
    updatedAt: string;
  },
  context: z.RefinementCtx
): void {
  if (
    state.createdBy.kind === "employee" &&
    state.createdBy.employee.tenantId !== state.tenantId
  ) {
    addIssue(
      context,
      ["createdBy", "employee"],
      "Source-registry creator crosses tenant boundary."
    );
  }
  for (const [index, artifact] of state.artifacts.entries()) {
    if (artifact.payload.tenantId !== state.tenantId) {
      addIssue(
        context,
        ["artifacts", index, "payload", "tenantId"],
        "Classified source-registry artifact must belong to the registry tenant."
      );
    }
  }
  for (const [index, secret] of state.credentialBindings.entries()) {
    if (secret.tenantId !== state.tenantId) {
      addIssue(
        context,
        ["credentialBindings", index, "tenantId"],
        "Credential binding must belong to the registry tenant."
      );
    }
  }
  for (const [index, authority] of state.relatedAuthorities.entries()) {
    for (const [field, reference] of [
      ["sourceConnection", authority.sourceConnection],
      ["sourceAccount", authority.sourceAccount]
    ] as const) {
      if (reference !== null && reference.tenantId !== state.tenantId) {
        addIssue(
          context,
          ["relatedAuthorities", index, field],
          "Related source authority crosses tenant boundary."
        );
      }
    }
    if (authority.tenantId !== state.tenantId) {
      addIssue(
        context,
        ["relatedAuthorities", index, "tenantId"],
        "Related source authority must belong to the registry tenant."
      );
    }
    const expectedSlot =
      authority.kind === "channel_connector"
        ? "channel_connector_registry"
        : authority.kind === "channel_session"
          ? "channel_session_state"
          : authority.kind === "channel_session_event"
            ? "channel_session_event"
            : authority.kind === "channel_auth_challenge"
              ? "channel_auth_challenge_outcome"
              : "source_ingress_route";
    if (authority.lifecycle.copySlot !== expectedSlot) {
      addIssue(
        context,
        ["relatedAuthorities", index, "lifecycle", "copySlot"],
        `Related authority kind ${authority.kind} requires lifecycle slot ${expectedSlot}.`
      );
    }
  }
  if (!isInboxV2TimestampOrderValid(state.createdAt, state.updatedAt)) {
    addIssue(
      context,
      ["updatedAt"],
      "Source-registry updatedAt cannot precede createdAt."
    );
  }
  if (
    !isInboxV2TimestampOrderValid(
      state.adapterContract.loadedAt,
      state.createdAt
    )
  ) {
    addIssue(
      context,
      ["createdAt"],
      "Source-registry state cannot predate its loaded adapter contract."
    );
  }
  if (
    !isInboxV2TimestampOrderValid(
      state.createdAt,
      state.routeAuthority.changedAt
    ) ||
    !isInboxV2TimestampOrderValid(
      state.routeAuthority.changedAt,
      state.updatedAt
    )
  ) {
    addIssue(
      context,
      ["routeAuthority", "changedAt"],
      "Route-authority change must fall inside the state lifetime."
    );
  }
  if (
    state.routeAuthority.state !== "denied" &&
    state.credentialBindings.some((secret) => secret.status !== "active")
  ) {
    addIssue(
      context,
      ["credentialBindings"],
      "A routable source cannot depend on a revoked credential binding."
    );
  }
}

function addRouteStatusIssue(
  status: string,
  routeState: string,
  context: z.RefinementCtx
): void {
  if (
    (status === "pending" ||
      status === "disabled" ||
      status === "replaced" ||
      status === "deleted") &&
    routeState !== "denied"
  ) {
    addIssue(
      context,
      ["routeAuthority", "state"],
      `Source-registry status ${status} requires denied route authority.`
    );
  }
}

function addTenantReferenceIssue(
  context: z.RefinementCtx,
  tenantId: string,
  reference: { tenantId: string },
  path: readonly (string | number)[]
): void {
  if (reference.tenantId !== tenantId) {
    addIssue(
      context,
      path,
      "Source-registry reference crosses tenant boundary."
    );
  }
}

function addIssue(
  context: z.RefinementCtx,
  path: readonly (string | number)[],
  message: string
): void {
  context.addIssue({ code: "custom", path: [...path], message });
}

function cloneAndFreeze<TValue>(value: TValue): TValue {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => cloneAndFreeze(item))) as TValue;
  }
  const clone: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    clone[key] = cloneAndFreeze(item);
  }
  return Object.freeze(clone) as TValue;
}
