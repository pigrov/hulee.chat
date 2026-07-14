import { z } from "zod";

import { inboxV2CatalogIdSchema, type InboxV2CatalogId } from "./catalog";
import {
  inboxV2EntityRevisionSchema,
  inboxV2TimestampSchema,
  isInboxV2TimestampOrderValid
} from "./entity-metadata";
import { inboxV2ExternalThreadMappingSchema } from "./external-thread";
import {
  inboxV2EmployeeReferenceSchema,
  inboxV2ExternalThreadReferenceSchema,
  inboxV2NormalizedInboundEventReferenceSchema,
  inboxV2ProviderRosterEvidenceReferenceSchema,
  inboxV2ProviderRosterMemberEvidenceReferenceSchema,
  inboxV2RawInboundEventReferenceSchema,
  inboxV2SourceAccountReferenceSchema,
  inboxV2SourceAccountIdentityAliasReferenceSchema,
  inboxV2SourceAccountIdentityTransitionReferenceSchema,
  inboxV2SourceConnectionReferenceSchema,
  inboxV2SourceThreadBindingIdSchema,
  inboxV2SourceThreadBindingReferenceSchema,
  inboxV2SourceThreadBindingRemoteAccessEpisodeIdSchema,
  inboxV2SourceThreadBindingRemoteAccessEpisodeReferenceSchema,
  inboxV2SourceThreadBindingTransitionIdSchema,
  inboxV2TenantIdSchema
} from "./ids";
import { inboxV2SourceAccountIdentitySchema } from "./source-account-identity";
import { inboxV2AuthorizationEpochSchema } from "./authorization-epoch";
import {
  inboxV2AdapterContractSnapshotSchema,
  inboxV2AdapterIdentityDeclarationSchema,
  inboxV2OpaqueAdapterRouteDescriptorSchema,
  inboxV2OpaqueProviderSubjectSchema,
  inboxV2ProviderRoleIdSchema,
  inboxV2RoutingTokenSchema,
  inboxV2RoutingTrustedServiceIdSchema,
  inboxV2SafeSourceDiagnosticSchema,
  inboxV2SourceAccountRealmIdSchema,
  inboxV2SourceCapabilityIdSchema,
  inboxV2SourceContentKindIdSchema,
  inboxV2SourceOperationIdSchema,
  inboxV2SourcePermissionIdSchema
} from "./source-routing-primitives";
import {
  createInboxV2SchemaEnvelopeSchema,
  INBOX_V2_INITIAL_SCHEMA_VERSION
} from "./schema-version";

export const INBOX_V2_SOURCE_THREAD_BINDING_SCHEMA_ID =
  "core:inbox-v2.source-thread-binding" as const;
export const INBOX_V2_SOURCE_THREAD_BINDING_REMOTE_ACCESS_EPISODE_SCHEMA_ID =
  "core:inbox-v2.source-thread-binding-remote-access-episode" as const;
export const INBOX_V2_SOURCE_THREAD_BINDING_TRANSITION_SCHEMA_ID =
  "core:inbox-v2.source-thread-binding-transition" as const;
export const INBOX_V2_SOURCE_THREAD_BINDING_CURRENT_PROJECTION_SCHEMA_ID =
  "core:inbox-v2.source-thread-binding-current-projection" as const;
export const INBOX_V2_SOURCE_THREAD_BINDING_TRANSITION_COMMIT_SCHEMA_ID =
  "core:inbox-v2.source-thread-binding-transition-commit" as const;
export const INBOX_V2_SOURCE_THREAD_BINDING_CREATION_COMMIT_SCHEMA_ID =
  "core:inbox-v2.source-thread-binding-creation-commit" as const;
export const INBOX_V2_SOURCE_THREAD_BINDING_SCHEMA_VERSION =
  INBOX_V2_INITIAL_SCHEMA_VERSION;
export const INBOX_V2_SOURCE_THREAD_BINDING_CURRENT_PAGE_MAX = 128;
export const INBOX_V2_SOURCE_THREAD_BINDING_CAPABILITY_ENTRY_MAX = 256;
export const INBOX_V2_SOURCE_THREAD_BINDING_TRANSITION_REASON_CATALOG =
  "source-thread-binding-transition-reason" as const;
export const INBOX_V2_SOURCE_THREAD_BINDING_ADMINISTRATIVE_PERMISSION_ID =
  "core:source_thread_binding.administrative.update" as const;

export type InboxV2SourceThreadBindingTransitionReasonId = InboxV2CatalogId<
  typeof INBOX_V2_SOURCE_THREAD_BINDING_TRANSITION_REASON_CATALOG
>;

export const inboxV2SourceThreadBindingTransitionReasonIdSchema =
  inboxV2CatalogIdSchema.transform(
    (value) => value as InboxV2SourceThreadBindingTransitionReasonId
  );

export const inboxV2SourceThreadBindingEvidenceReferenceSchema = z.union([
  inboxV2RawInboundEventReferenceSchema,
  inboxV2NormalizedInboundEventReferenceSchema,
  inboxV2SourceAccountIdentityTransitionReferenceSchema,
  inboxV2SourceAccountIdentityAliasReferenceSchema,
  inboxV2ProviderRosterEvidenceReferenceSchema,
  inboxV2ProviderRosterMemberEvidenceReferenceSchema
]);

const bindingEvidenceListSchema = z
  .array(inboxV2SourceThreadBindingEvidenceReferenceSchema)
  .min(1)
  .max(32)
  .superRefine((references, context) => {
    const keys = new Set<string>();

    for (const [index, reference] of references.entries()) {
      const key = `${reference.kind}\u0000${String(reference.id)}`;

      if (keys.has(key)) {
        addIssue(
          context,
          [index],
          "SourceThreadBinding evidence references must be unique."
        );
      }

      keys.add(key);
    }
  });

/**
 * Immutable proof of the verified account anchor captured when the binding is
 * created or reauthenticated. This snapshot is not a second canonical account
 * identity or authorization source: routing must separately load and validate
 * the current SourceAccountIdentity authority. Connector/session identifiers
 * remain evidence and never become the account subject. Reauthentication may
 * advance accountGeneration while preserving this exact SourceAccount, realm
 * and canonical subject.
 */
export const inboxV2SourceThreadBindingVerifiedAccountIdentitySnapshotSchema = z
  .object({
    status: z.literal("verified"),
    sourceConnection: inboxV2SourceConnectionReferenceSchema,
    sourceAccount: inboxV2SourceAccountReferenceSchema,
    declaration: inboxV2AdapterIdentityDeclarationSchema,
    realmId: inboxV2SourceAccountRealmIdSchema,
    canonicalExternalSubject: inboxV2OpaqueProviderSubjectSchema,
    accountGeneration: inboxV2EntityRevisionSchema,
    verificationEvidence: bindingEvidenceListSchema,
    verifiedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((identity, context) => {
    if (identity.declaration.identityKind !== "source_account") {
      addIssue(
        context,
        ["declaration", "identityKind"],
        "Verified binding account identity requires a source-account declaration."
      );
    }

    if (String(identity.declaration.realmId) !== String(identity.realmId)) {
      addIssue(
        context,
        ["realmId"],
        "Verified account realm must match its adapter declaration."
      );
    }

    if (
      identity.declaration.scopeKind !== "provider" &&
      identity.declaration.scopeKind !== "source_connection"
    ) {
      addIssue(
        context,
        ["declaration", "scopeKind"],
        "Verified source-account identity is provider- or connection-scoped."
      );
    }

    if (identity.declaration.decisionStrength !== "authoritative") {
      addIssue(
        context,
        ["declaration", "decisionStrength"],
        "Verified source-account identity requires authoritative adapter evidence."
      );
    }

    if (
      identity.sourceConnection.tenantId !== identity.sourceAccount.tenantId
    ) {
      addIssue(
        context,
        ["sourceAccount", "tenantId"],
        "Verified account snapshot references must share tenant scope."
      );
    }

    if (
      Date.parse(identity.declaration.adapterContract.loadedAt) >
      Date.parse(identity.verifiedAt)
    ) {
      addIssue(
        context,
        ["verifiedAt"],
        "Account verification cannot precede its trusted adapter declaration."
      );
    }

    if (
      !identity.verificationEvidence.some(
        (reference) =>
          reference.kind === "raw_inbound_event" ||
          reference.kind === "normalized_inbound_event" ||
          reference.kind === "source_account_identity_transition" ||
          reference.kind === "source_account_identity_alias"
      )
    ) {
      addIssue(
        context,
        ["verificationEvidence"],
        "Verified account snapshot requires exact account-identity or event evidence."
      );
    }
  });

export const inboxV2SourceThreadBindingRemoteAccessStateSchema = z.enum([
  "observed",
  "active",
  "left",
  "removed"
]);

export const inboxV2SourceThreadBindingRemoteAccessEvidenceAuthoritySchema =
  z.enum([
    "direct_observation",
    "explicit_terminal_event",
    "authoritative_snapshot",
    "advisory_snapshot",
    "migration_observed"
  ]);

export const inboxV2SourceThreadBindingAdministrativeStateSchema = z.enum([
  "enabled",
  "disabled"
]);

export const inboxV2SourceThreadBindingRuntimeHealthStateSchema = z.enum([
  "unknown",
  "ready",
  "degraded",
  "unavailable"
]);

export const inboxV2SourceThreadBindingHistorySyncStateSchema = z.enum([
  "unsupported",
  "not_started",
  "backfilling",
  "catching_up",
  "live",
  "paused",
  "failed"
]);

export const inboxV2SourceReferencePortabilitySchema = z.enum([
  "not_applicable",
  "binding_only",
  "external_thread",
  "provider_global"
]);

export const inboxV2SourceBindingCapabilityStateSchema = z.enum([
  "supported",
  "unsupported",
  "unknown",
  "temporarily_unavailable",
  "expired"
]);

export const inboxV2SourceThreadBindingRemoteAccessSnapshotSchema = z
  .object({
    state: inboxV2SourceThreadBindingRemoteAccessStateSchema,
    evidenceAuthority:
      inboxV2SourceThreadBindingRemoteAccessEvidenceAuthoritySchema,
    revision: inboxV2EntityRevisionSchema,
    since: inboxV2TimestampSchema,
    evidence: bindingEvidenceListSchema
  })
  .strict()
  .superRefine((snapshot, context) => {
    if (
      (snapshot.state === "left" || snapshot.state === "removed") &&
      snapshot.evidenceAuthority !== "explicit_terminal_event" &&
      snapshot.evidenceAuthority !== "authoritative_snapshot"
    ) {
      addIssue(
        context,
        ["evidenceAuthority"],
        "Left or removed binding access requires an explicit terminal event or authoritative provider snapshot."
      );
    }

    if (
      snapshot.state === "active" &&
      snapshot.evidenceAuthority !== "direct_observation" &&
      snapshot.evidenceAuthority !== "authoritative_snapshot"
    ) {
      addIssue(
        context,
        ["evidenceAuthority"],
        "Active binding access requires direct or authoritative provider evidence."
      );
    }
  });

export const inboxV2SourceThreadBindingAdministrativeSnapshotSchema = z
  .object({
    state: inboxV2SourceThreadBindingAdministrativeStateSchema,
    revision: inboxV2EntityRevisionSchema,
    changedAt: inboxV2TimestampSchema
  })
  .strict();

export const inboxV2SourceThreadBindingRuntimeHealthSnapshotSchema = z
  .object({
    state: inboxV2SourceThreadBindingRuntimeHealthStateSchema,
    revision: inboxV2EntityRevisionSchema,
    checkedAt: inboxV2TimestampSchema,
    diagnostic: inboxV2SafeSourceDiagnosticSchema.nullable()
  })
  .strict()
  .superRefine((health, context) => {
    if (
      (health.state === "degraded" || health.state === "unavailable") &&
      health.diagnostic === null
    ) {
      addIssue(
        context,
        ["diagnostic"],
        "Degraded or unavailable binding health requires a safe diagnostic."
      );
    }

    if (health.state === "ready" && health.diagnostic !== null) {
      addIssue(
        context,
        ["diagnostic"],
        "Ready binding health cannot retain a failure diagnostic."
      );
    }
  });

export const inboxV2SourceThreadBindingHistorySyncSnapshotSchema = z
  .object({
    state: inboxV2SourceThreadBindingHistorySyncStateSchema,
    revision: inboxV2EntityRevisionSchema,
    receiveCursor: inboxV2OpaqueProviderSubjectSchema.nullable(),
    historyCursor: inboxV2OpaqueProviderSubjectSchema.nullable(),
    providerWatermark: inboxV2OpaqueProviderSubjectSchema.nullable(),
    lastDurableRawEvent: inboxV2RawInboundEventReferenceSchema.nullable(),
    updatedAt: inboxV2TimestampSchema,
    diagnostic: inboxV2SafeSourceDiagnosticSchema.nullable()
  })
  .strict()
  .superRefine((history, context) => {
    if (history.state === "failed" && history.diagnostic === null) {
      addIssue(
        context,
        ["diagnostic"],
        "Failed history synchronization requires a safe diagnostic."
      );
    }

    if (
      history.state === "unsupported" &&
      (history.receiveCursor !== null ||
        history.historyCursor !== null ||
        history.providerWatermark !== null)
    ) {
      addIssue(
        context,
        ["state"],
        "Unsupported history synchronization cannot retain provider cursors."
      );
    }
  });

export const inboxV2SourceThreadBindingProviderAccessSnapshotSchema = z
  .object({
    revision: inboxV2EntityRevisionSchema,
    roleIds: z.array(inboxV2ProviderRoleIdSchema).max(32),
    evidence: bindingEvidenceListSchema,
    observedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((snapshot, context) => {
    addDuplicateStringIssues(context, snapshot.roleIds, ["roleIds"]);
  });

export const inboxV2SourceThreadBindingCapabilityEntrySchema = z
  .object({
    capabilityId: inboxV2SourceCapabilityIdSchema,
    operationId: inboxV2SourceOperationIdSchema,
    contentKindId: inboxV2SourceContentKindIdSchema.nullable(),
    state: inboxV2SourceBindingCapabilityStateSchema,
    referencePortability: inboxV2SourceReferencePortabilitySchema,
    requiredProviderRoleIds: z.array(inboxV2ProviderRoleIdSchema).max(16),
    validUntil: inboxV2TimestampSchema.nullable(),
    diagnostic: inboxV2SafeSourceDiagnosticSchema.nullable(),
    evidence: bindingEvidenceListSchema
  })
  .strict()
  .superRefine((entry, context) => {
    addDuplicateStringIssues(context, entry.requiredProviderRoleIds, [
      "requiredProviderRoleIds"
    ]);

    if (entry.state === "expired" && entry.validUntil === null) {
      addIssue(
        context,
        ["validUntil"],
        "Expired source capability requires its expiry boundary."
      );
    }

    if (
      entry.state === "temporarily_unavailable" &&
      entry.diagnostic === null
    ) {
      addIssue(
        context,
        ["diagnostic"],
        "Temporarily unavailable capability requires a safe diagnostic."
      );
    }
  });

export const inboxV2SourceThreadBindingCapabilitySnapshotSchema = z
  .object({
    adapterContract: inboxV2AdapterContractSnapshotSchema,
    revision: inboxV2EntityRevisionSchema,
    capturedAt: inboxV2TimestampSchema,
    entries: z
      .array(inboxV2SourceThreadBindingCapabilityEntrySchema)
      .max(INBOX_V2_SOURCE_THREAD_BINDING_CAPABILITY_ENTRY_MAX)
  })
  .strict()
  .superRefine((snapshot, context) => {
    const keys = new Set<string>();

    for (const [index, entry] of snapshot.entries.entries()) {
      const key = [
        String(entry.capabilityId),
        String(entry.operationId),
        entry.contentKindId === null ? "" : String(entry.contentKindId)
      ].join("\u0000");

      if (keys.has(key)) {
        addIssue(
          context,
          ["entries", index],
          "Binding capability entries must be unique per capability, operation and content kind."
        );
      }

      keys.add(key);

      if (
        entry.state === "expired" &&
        entry.validUntil !== null &&
        Date.parse(entry.validUntil) > Date.parse(snapshot.capturedAt)
      ) {
        addIssue(
          context,
          ["entries", index, "validUntil"],
          "Expired capability boundary cannot follow snapshot capture time."
        );
      }

      if (
        entry.state === "supported" &&
        entry.validUntil !== null &&
        Date.parse(entry.validUntil) <= Date.parse(snapshot.capturedAt)
      ) {
        addIssue(
          context,
          ["entries", index, "validUntil"],
          "Supported capability cannot retain an already expired validity boundary."
        );
      }
    }
  });

export const inboxV2SourceThreadBindingFenceSchema = z
  .object({
    accountGeneration: inboxV2EntityRevisionSchema,
    bindingGeneration: inboxV2EntityRevisionSchema,
    remoteAccessRevision: inboxV2EntityRevisionSchema,
    administrativeRevision: inboxV2EntityRevisionSchema,
    capabilityRevision: inboxV2EntityRevisionSchema,
    routeDescriptorRevision: inboxV2EntityRevisionSchema
  })
  .strict();

/**
 * SourceConnection here is the durable source anchor, not an ephemeral
 * connector/session row. Recreated connector credentials must alias back to
 * that anchor for reauthentication. A real connection/account replacement is
 * an audited new binding or rebind operation, never this anchor mutating under
 * an existing route.
 */
export const inboxV2SourceThreadBindingSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2SourceThreadBindingIdSchema,
    externalThread: inboxV2ExternalThreadReferenceSchema,
    sourceConnection: inboxV2SourceConnectionReferenceSchema,
    sourceAccount: inboxV2SourceAccountReferenceSchema,
    accountIdentitySnapshot:
      inboxV2SourceThreadBindingVerifiedAccountIdentitySnapshotSchema,
    bindingGeneration: inboxV2EntityRevisionSchema,
    remoteAccess: inboxV2SourceThreadBindingRemoteAccessSnapshotSchema,
    administrative: inboxV2SourceThreadBindingAdministrativeSnapshotSchema,
    runtimeHealth: inboxV2SourceThreadBindingRuntimeHealthSnapshotSchema,
    historySync: inboxV2SourceThreadBindingHistorySyncSnapshotSchema,
    providerAccess: inboxV2SourceThreadBindingProviderAccessSnapshotSchema,
    capabilities: inboxV2SourceThreadBindingCapabilitySnapshotSchema,
    routeDescriptor: inboxV2OpaqueAdapterRouteDescriptorSchema,
    revision: inboxV2EntityRevisionSchema,
    createdAt: inboxV2TimestampSchema,
    updatedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((binding, context) => {
    for (const [field, reference] of [
      ["externalThread", binding.externalThread],
      ["sourceConnection", binding.sourceConnection],
      ["sourceAccount", binding.sourceAccount]
    ] as const) {
      addTenantReferenceIssue(context, binding.tenantId, reference, [field]);
    }

    addAccountIdentitySnapshotIssues(context, binding);

    for (const [index, reference] of binding.remoteAccess.evidence.entries()) {
      addTenantReferenceIssue(context, binding.tenantId, reference, [
        "remoteAccess",
        "evidence",
        index
      ]);
    }

    for (const [
      index,
      reference
    ] of binding.providerAccess.evidence.entries()) {
      addTenantReferenceIssue(context, binding.tenantId, reference, [
        "providerAccess",
        "evidence",
        index
      ]);
    }

    for (const [entryIndex, entry] of binding.capabilities.entries.entries()) {
      for (const [evidenceIndex, reference] of entry.evidence.entries()) {
        addTenantReferenceIssue(context, binding.tenantId, reference, [
          "capabilities",
          "entries",
          entryIndex,
          "evidence",
          evidenceIndex
        ]);
      }
    }

    if (binding.historySync.lastDurableRawEvent !== null) {
      addTenantReferenceIssue(
        context,
        binding.tenantId,
        binding.historySync.lastDurableRawEvent,
        ["historySync", "lastDurableRawEvent"]
      );
    }

    if (
      !sameAdapterSurface(
        binding.accountIdentitySnapshot.declaration.adapterContract,
        binding.capabilities.adapterContract
      ) ||
      !sameAdapterSurface(
        binding.accountIdentitySnapshot.declaration.adapterContract,
        binding.routeDescriptor.adapterContract
      )
    ) {
      addIssue(
        context,
        ["routeDescriptor", "adapterContract"],
        "Account identity, capability snapshot and route descriptor must use one adapter surface."
      );
    }

    if (!isInboxV2TimestampOrderValid(binding.createdAt, binding.updatedAt)) {
      addIssue(
        context,
        ["updatedAt"],
        "SourceThreadBinding updatedAt cannot precede createdAt."
      );
    }

    for (const [path, timestamp] of [
      [
        ["accountIdentitySnapshot", "verifiedAt"],
        binding.accountIdentitySnapshot.verifiedAt
      ],
      [["remoteAccess", "since"], binding.remoteAccess.since],
      [["administrative", "changedAt"], binding.administrative.changedAt],
      [["runtimeHealth", "checkedAt"], binding.runtimeHealth.checkedAt],
      [["historySync", "updatedAt"], binding.historySync.updatedAt],
      [["providerAccess", "observedAt"], binding.providerAccess.observedAt],
      [["capabilities", "capturedAt"], binding.capabilities.capturedAt]
    ] as const) {
      if (Date.parse(timestamp) > Date.parse(binding.updatedAt)) {
        addIssue(
          context,
          [...path],
          "Binding component timestamp cannot follow binding updatedAt."
        );
      }
    }
  });

export const inboxV2SourceThreadBindingRemoteAccessEpisodeSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2SourceThreadBindingRemoteAccessEpisodeIdSchema,
    binding: inboxV2SourceThreadBindingReferenceSchema,
    state: inboxV2SourceThreadBindingRemoteAccessStateSchema,
    startedAt: inboxV2TimestampSchema,
    endedAt: inboxV2TimestampSchema.nullable(),
    startEvidence: bindingEvidenceListSchema,
    endEvidence: z
      .array(inboxV2SourceThreadBindingEvidenceReferenceSchema)
      .max(32),
    revision: inboxV2EntityRevisionSchema,
    createdAt: inboxV2TimestampSchema,
    updatedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((episode, context) => {
    addTenantReferenceIssue(context, episode.tenantId, episode.binding, [
      "binding"
    ]);

    for (const [field, references] of [
      ["startEvidence", episode.startEvidence],
      ["endEvidence", episode.endEvidence]
    ] as const) {
      for (const [index, reference] of references.entries()) {
        addTenantReferenceIssue(context, episode.tenantId, reference, [
          field,
          index
        ]);
      }
    }

    if (episode.createdAt !== episode.startedAt) {
      addIssue(
        context,
        ["createdAt"],
        "Remote-access episode creation must equal its start boundary."
      );
    }

    if (episode.endedAt === null) {
      if (episode.endEvidence.length > 0) {
        addIssue(
          context,
          ["endEvidence"],
          "Open remote-access episode cannot carry end evidence."
        );
      }

      if (String(episode.revision) !== "1") {
        addIssue(
          context,
          ["revision"],
          "Open remote-access episode must remain at revision 1."
        );
      }

      if (episode.updatedAt !== episode.startedAt) {
        addIssue(
          context,
          ["updatedAt"],
          "Open remote-access episode update time must equal its start boundary."
        );
      }
    } else {
      if (!isInboxV2TimestampOrderValid(episode.startedAt, episode.endedAt)) {
        addIssue(
          context,
          ["endedAt"],
          "Remote-access episode cannot end before it starts."
        );
      }

      if (episode.endEvidence.length === 0) {
        addIssue(
          context,
          ["endEvidence"],
          "Closed remote-access episode requires end evidence."
        );
      }

      if (String(episode.revision) !== "2") {
        addIssue(
          context,
          ["revision"],
          "Closed remote-access episode must advance exactly to revision 2."
        );
      }

      if (episode.updatedAt !== episode.endedAt) {
        addIssue(
          context,
          ["updatedAt"],
          "Closed remote-access episode update time must equal its end boundary."
        );
      }
    }
  });

export const inboxV2SourceThreadBindingCurrentProjectionSchema = z
  .object({
    binding: inboxV2SourceThreadBindingSchema,
    currentRemoteAccessEpisode:
      inboxV2SourceThreadBindingRemoteAccessEpisodeSchema
  })
  .strict()
  .superRefine((projection, context) => {
    const { binding, currentRemoteAccessEpisode: episode } = projection;

    if (
      episode.tenantId !== binding.tenantId ||
      episode.binding.tenantId !== binding.tenantId ||
      String(episode.binding.id) !== String(binding.id)
    ) {
      addIssue(
        context,
        ["currentRemoteAccessEpisode", "binding"],
        "Current remote-access episode must belong to the projected binding."
      );
    }

    if (episode.endedAt !== null) {
      addIssue(
        context,
        ["currentRemoteAccessEpisode", "endedAt"],
        "Current remote-access episode must be open."
      );
    }

    if (episode.state !== binding.remoteAccess.state) {
      addIssue(
        context,
        ["currentRemoteAccessEpisode", "state"],
        "Current episode state must match the binding remote-access projection."
      );
    }

    if (episode.startedAt !== binding.remoteAccess.since) {
      addIssue(
        context,
        ["currentRemoteAccessEpisode", "startedAt"],
        "Current episode start must match the binding remote-access boundary."
      );
    }

    if (!sameValue(episode.startEvidence, binding.remoteAccess.evidence)) {
      addIssue(
        context,
        ["currentRemoteAccessEpisode", "startEvidence"],
        "Current episode evidence must match the binding remote-access projection."
      );
    }
  });

const currentAxisRevisionSchema = <TState extends z.ZodTypeAny>(
  stateSchema: TState
) =>
  z
    .object({
      state: stateSchema,
      revision: inboxV2EntityRevisionSchema
    })
    .strict();

/**
 * Bounded list/read-model item. It deliberately excludes route descriptors,
 * capability entries, evidence, provider roles and history cursors. Callers
 * load the full one-entity projection only for an exact transition or route.
 */
export const inboxV2SourceThreadBindingCurrentHeadSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    binding: inboxV2SourceThreadBindingReferenceSchema,
    externalThread: inboxV2ExternalThreadReferenceSchema,
    sourceConnection: inboxV2SourceConnectionReferenceSchema,
    sourceAccount: inboxV2SourceAccountReferenceSchema,
    fence: inboxV2SourceThreadBindingFenceSchema,
    remoteAccess: currentAxisRevisionSchema(
      inboxV2SourceThreadBindingRemoteAccessStateSchema
    ),
    administrative: currentAxisRevisionSchema(
      inboxV2SourceThreadBindingAdministrativeStateSchema
    ),
    runtimeHealth: currentAxisRevisionSchema(
      inboxV2SourceThreadBindingRuntimeHealthStateSchema
    ),
    historySync: currentAxisRevisionSchema(
      inboxV2SourceThreadBindingHistorySyncStateSchema
    ),
    providerAccessRevision: inboxV2EntityRevisionSchema,
    bindingRevision: inboxV2EntityRevisionSchema,
    updatedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((head, context) => {
    for (const [field, reference] of [
      ["binding", head.binding],
      ["externalThread", head.externalThread],
      ["sourceConnection", head.sourceConnection],
      ["sourceAccount", head.sourceAccount]
    ] as const) {
      addTenantReferenceIssue(context, head.tenantId, reference, [field]);
    }

    if (
      String(head.fence.remoteAccessRevision) !==
      String(head.remoteAccess.revision)
    ) {
      addIssue(
        context,
        ["remoteAccess", "revision"],
        "Current binding head remote revision must match its route fence."
      );
    }
    if (
      String(head.fence.administrativeRevision) !==
      String(head.administrative.revision)
    ) {
      addIssue(
        context,
        ["administrative", "revision"],
        "Current binding head administrative revision must match its route fence."
      );
    }
  });

/**
 * Atomic bounded proof for creating one binding against already canonical
 * thread/account authorities. It contains no tenant-wide lookup or history.
 */
export const inboxV2SourceThreadBindingCreationCommitSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    externalThreadMapping: inboxV2ExternalThreadMappingSchema,
    sourceAccountIdentity: inboxV2SourceAccountIdentitySchema,
    initialProjection: inboxV2SourceThreadBindingCurrentProjectionSchema
  })
  .strict()
  .superRefine((commit, context) => {
    addBindingCreationCommitIssues(context, commit);
  });

export const inboxV2SourceThreadBindingCurrentPageSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    externalThread: inboxV2ExternalThreadReferenceSchema,
    items: z
      .array(inboxV2SourceThreadBindingCurrentHeadSchema)
      .max(INBOX_V2_SOURCE_THREAD_BINDING_CURRENT_PAGE_MAX),
    nextCursor: inboxV2RoutingTokenSchema.nullable()
  })
  .strict()
  .superRefine((page, context) => {
    addTenantReferenceIssue(context, page.tenantId, page.externalThread, [
      "externalThread"
    ]);

    const bindingIds = new Set<string>();
    const accountIds = new Set<string>();

    for (const [index, item] of page.items.entries()) {
      if (item.tenantId !== page.tenantId) {
        addIssue(
          context,
          ["items", index, "tenantId"],
          "Binding page item must belong to the page tenant."
        );
      }

      if (!sameReference(item.externalThread, page.externalThread)) {
        addIssue(
          context,
          ["items", index, "externalThread"],
          "Binding page item must belong to the exact page thread."
        );
      }

      const bindingId = String(item.binding.id);
      const accountId = String(item.sourceAccount.id);

      if (bindingIds.has(bindingId)) {
        addIssue(
          context,
          ["items", index, "binding"],
          "Binding page cannot contain duplicate binding anchors."
        );
      }

      if (accountIds.has(accountId)) {
        addIssue(
          context,
          ["items", index, "sourceAccount"],
          "One thread page cannot contain two binding anchors for one SourceAccount."
        );
      }

      bindingIds.add(bindingId);
      accountIds.add(accountId);
    }
  });

/**
 * Server-loaded RBAC authority for one administrative binding change. Provider
 * roles/evidence and client booleans cannot substitute for this decision.
 */
export const inboxV2SourceThreadBindingAdministrativeAuthorizationDecisionSchema =
  z
    .object({
      decisionKind: z.literal("source_thread_binding_administrative"),
      tenantId: inboxV2TenantIdSchema,
      principal: z
        .object({
          kind: z.literal("employee"),
          employee: inboxV2EmployeeReferenceSchema
        })
        .strict(),
      target: z
        .object({
          binding: inboxV2SourceThreadBindingReferenceSchema,
          externalThread: inboxV2ExternalThreadReferenceSchema,
          sourceAccount: inboxV2SourceAccountReferenceSchema,
          sourceConnection: inboxV2SourceConnectionReferenceSchema
        })
        .strict(),
      effect: z.enum(["allow", "deny"]),
      requiredPermissionId: z.literal(
        INBOX_V2_SOURCE_THREAD_BINDING_ADMINISTRATIVE_PERMISSION_ID
      ),
      matchedPermissionIds: z.array(inboxV2SourcePermissionIdSchema).max(64),
      authorizationEpoch: inboxV2AuthorizationEpochSchema,
      decisionRevision: inboxV2EntityRevisionSchema,
      decisionToken: inboxV2RoutingTokenSchema,
      loadedByTrustedServiceId: inboxV2RoutingTrustedServiceIdSchema,
      decidedAt: inboxV2TimestampSchema,
      notAfter: inboxV2TimestampSchema
    })
    .strict()
    .superRefine((decision, context) => {
      addDuplicateStringIssues(context, decision.matchedPermissionIds, [
        "matchedPermissionIds"
      ]);
      for (const [field, reference] of [
        ["principal", decision.principal.employee],
        ["binding", decision.target.binding],
        ["externalThread", decision.target.externalThread],
        ["sourceAccount", decision.target.sourceAccount],
        ["sourceConnection", decision.target.sourceConnection]
      ] as const) {
        addTenantReferenceIssue(context, decision.tenantId, reference, [
          field === "principal" ? "principal" : "target",
          field === "principal" ? "employee" : field
        ]);
      }
      if (
        decision.effect === "allow" &&
        !decision.matchedPermissionIds.some(
          (permissionId) =>
            String(permissionId) === decision.requiredPermissionId
        )
      ) {
        addIssue(
          context,
          ["matchedPermissionIds"],
          "Allow decision must match the exact binding administrative permission."
        );
      }
      if (
        !isInboxV2TimestampOrderValid(decision.decidedAt, decision.notAfter)
      ) {
        addIssue(
          context,
          ["notAfter"],
          "Administrative authorization cannot expire before it is decided."
        );
      }
    });

export const inboxV2SourceThreadBindingTransitionActorSchema =
  z.discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("employee"),
        employee: inboxV2EmployeeReferenceSchema,
        authorizationEpoch: inboxV2AuthorizationEpochSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("trusted_service"),
        trustedServiceId: inboxV2RoutingTrustedServiceIdSchema
      })
      .strict()
  ]);

const transitionBaseShape = {
  tenantId: inboxV2TenantIdSchema,
  id: inboxV2SourceThreadBindingTransitionIdSchema,
  binding: inboxV2SourceThreadBindingReferenceSchema,
  actor: inboxV2SourceThreadBindingTransitionActorSchema,
  reasonId: inboxV2SourceThreadBindingTransitionReasonIdSchema,
  expectedBindingRevision: inboxV2EntityRevisionSchema,
  resultingBindingRevision: inboxV2EntityRevisionSchema,
  occurredAt: inboxV2TimestampSchema
};

export const inboxV2SourceThreadBindingTransitionSchema = z
  .discriminatedUnion("kind", [
    z
      .object({
        ...transitionBaseShape,
        kind: z.literal("remote_access"),
        fromState: inboxV2SourceThreadBindingRemoteAccessStateSchema,
        toState: inboxV2SourceThreadBindingRemoteAccessStateSchema,
        expectedRemoteAccessRevision: inboxV2EntityRevisionSchema,
        resultingRemoteAccess:
          inboxV2SourceThreadBindingRemoteAccessSnapshotSchema,
        closedEpisode:
          inboxV2SourceThreadBindingRemoteAccessEpisodeReferenceSchema,
        openedEpisode:
          inboxV2SourceThreadBindingRemoteAccessEpisodeReferenceSchema,
        evidence: bindingEvidenceListSchema
      })
      .strict(),
    z
      .object({
        ...transitionBaseShape,
        kind: z.literal("administrative"),
        fromState: inboxV2SourceThreadBindingAdministrativeStateSchema,
        toState: inboxV2SourceThreadBindingAdministrativeStateSchema,
        expectedAdministrativeRevision: inboxV2EntityRevisionSchema,
        resultingAdministrative:
          inboxV2SourceThreadBindingAdministrativeSnapshotSchema,
        authorizationDecision:
          inboxV2SourceThreadBindingAdministrativeAuthorizationDecisionSchema
      })
      .strict(),
    z
      .object({
        ...transitionBaseShape,
        kind: z.literal("runtime_health"),
        fromState: inboxV2SourceThreadBindingRuntimeHealthStateSchema,
        toState: inboxV2SourceThreadBindingRuntimeHealthStateSchema,
        expectedRuntimeHealthRevision: inboxV2EntityRevisionSchema,
        resultingRuntimeHealth:
          inboxV2SourceThreadBindingRuntimeHealthSnapshotSchema
      })
      .strict(),
    z
      .object({
        ...transitionBaseShape,
        kind: z.literal("history_sync"),
        fromState: inboxV2SourceThreadBindingHistorySyncStateSchema,
        toState: inboxV2SourceThreadBindingHistorySyncStateSchema,
        expectedHistorySyncRevision: inboxV2EntityRevisionSchema,
        resultingHistorySync:
          inboxV2SourceThreadBindingHistorySyncSnapshotSchema
      })
      .strict(),
    z
      .object({
        ...transitionBaseShape,
        kind: z.literal("capabilities"),
        expectedCapabilityRevision: inboxV2EntityRevisionSchema,
        resultingCapabilities:
          inboxV2SourceThreadBindingCapabilitySnapshotSchema,
        evidence: bindingEvidenceListSchema
      })
      .strict(),
    z
      .object({
        ...transitionBaseShape,
        kind: z.literal("route_descriptor"),
        expectedBindingGeneration: inboxV2EntityRevisionSchema,
        resultingBindingGeneration: inboxV2EntityRevisionSchema,
        expectedRouteDescriptorRevision: inboxV2EntityRevisionSchema,
        resultingRouteDescriptor: inboxV2OpaqueAdapterRouteDescriptorSchema,
        evidence: bindingEvidenceListSchema
      })
      .strict(),
    z
      .object({
        ...transitionBaseShape,
        kind: z.literal("account_generation"),
        expectedAccountGeneration: inboxV2EntityRevisionSchema,
        resultingAccountIdentitySnapshot:
          inboxV2SourceThreadBindingVerifiedAccountIdentitySnapshotSchema,
        evidence: bindingEvidenceListSchema
      })
      .strict(),
    z
      .object({
        ...transitionBaseShape,
        kind: z.literal("provider_access"),
        expectedProviderAccessRevision: inboxV2EntityRevisionSchema,
        expectedBindingGeneration: inboxV2EntityRevisionSchema,
        resultingBindingGeneration: inboxV2EntityRevisionSchema,
        resultingProviderAccess:
          inboxV2SourceThreadBindingProviderAccessSnapshotSchema,
        evidence: bindingEvidenceListSchema
      })
      .strict()
  ])
  .superRefine((transition, context) => {
    addMonotonicRevisionIssue(
      context,
      transition.expectedBindingRevision,
      transition.resultingBindingRevision,
      ["resultingBindingRevision"],
      "Binding transition must advance entity revision exactly once."
    );

    addTenantReferenceIssue(context, transition.tenantId, transition.binding, [
      "binding"
    ]);

    addTransitionTenantIssues(context, transition);

    if (
      transition.kind !== "administrative" &&
      transition.actor.kind !== "trusted_service"
    ) {
      addIssue(
        context,
        ["actor"],
        "Only a trusted source service may change provider-observed binding axes."
      );
    }

    if (
      transition.kind === "administrative" &&
      transition.actor.kind !== "employee"
    ) {
      addIssue(
        context,
        ["actor"],
        "Administrative binding changes require an authenticated Employee decision."
      );
    }

    switch (transition.kind) {
      case "remote_access":
        addStateTransitionIssues(
          context,
          transition.fromState,
          transition.toState,
          transition.expectedRemoteAccessRevision,
          transition.resultingRemoteAccess.revision,
          transition.resultingRemoteAccess.state,
          transition.resultingRemoteAccess.since,
          transition.occurredAt,
          ["resultingRemoteAccess"]
        );
        if (sameReference(transition.closedEpisode, transition.openedEpisode)) {
          addIssue(
            context,
            ["openedEpisode"],
            "Remote-access transition must open a new episode identity."
          );
        }
        break;
      case "administrative":
        addStateTransitionIssues(
          context,
          transition.fromState,
          transition.toState,
          transition.expectedAdministrativeRevision,
          transition.resultingAdministrative.revision,
          transition.resultingAdministrative.state,
          transition.resultingAdministrative.changedAt,
          transition.occurredAt,
          ["resultingAdministrative"]
        );
        addAdministrativeTransitionAuthorizationIssues(context, transition);
        break;
      case "runtime_health":
        addStateTransitionIssues(
          context,
          transition.fromState,
          transition.toState,
          transition.expectedRuntimeHealthRevision,
          transition.resultingRuntimeHealth.revision,
          transition.resultingRuntimeHealth.state,
          transition.resultingRuntimeHealth.checkedAt,
          transition.occurredAt,
          ["resultingRuntimeHealth"],
          transition.fromState === "ready" && transition.toState === "ready"
        );
        break;
      case "history_sync": {
        const isCursorProgress = isHistorySyncSameStateProgress(
          transition.fromState,
          transition.toState
        );
        addStateTransitionIssues(
          context,
          transition.fromState,
          transition.toState,
          transition.expectedHistorySyncRevision,
          transition.resultingHistorySync.revision,
          transition.resultingHistorySync.state,
          transition.resultingHistorySync.updatedAt,
          transition.occurredAt,
          ["resultingHistorySync"],
          isCursorProgress
        );
        if (
          !isCursorProgress &&
          !isHistorySyncTransitionAllowed(
            transition.fromState,
            transition.toState
          )
        ) {
          addIssue(
            context,
            ["toState"],
            "History synchronization transition must follow the bounded recovery state machine."
          );
        }
        if (
          isCursorProgress &&
          transition.resultingHistorySync.receiveCursor === null &&
          transition.resultingHistorySync.historyCursor === null &&
          transition.resultingHistorySync.providerWatermark === null
        ) {
          addIssue(
            context,
            ["resultingHistorySync"],
            "Same-state history progress requires at least one receive/history cursor or provider watermark."
          );
        }
        break;
      }
      case "capabilities":
        addMonotonicRevisionIssue(
          context,
          transition.expectedCapabilityRevision,
          transition.resultingCapabilities.revision,
          ["resultingCapabilities", "revision"],
          "Capability snapshot revision must advance exactly once."
        );
        if (
          transition.resultingCapabilities.capturedAt !== transition.occurredAt
        ) {
          addIssue(
            context,
            ["resultingCapabilities", "capturedAt"],
            "Capability snapshot capture must equal transition time."
          );
        }
        break;
      case "route_descriptor":
        addMonotonicRevisionIssue(
          context,
          transition.expectedBindingGeneration,
          transition.resultingBindingGeneration,
          ["resultingBindingGeneration"],
          "Route descriptor replacement must advance binding generation once."
        );
        addMonotonicRevisionIssue(
          context,
          transition.expectedRouteDescriptorRevision,
          transition.resultingRouteDescriptor.descriptorRevision,
          ["resultingRouteDescriptor", "descriptorRevision"],
          "Route descriptor revision must advance exactly once."
        );
        break;
      case "account_generation":
        addMonotonicRevisionIssue(
          context,
          transition.expectedAccountGeneration,
          transition.resultingAccountIdentitySnapshot.accountGeneration,
          ["resultingAccountIdentitySnapshot", "accountGeneration"],
          "Account reauthentication must advance account generation once."
        );
        if (
          transition.resultingAccountIdentitySnapshot.verifiedAt !==
          transition.occurredAt
        ) {
          addIssue(
            context,
            ["resultingAccountIdentitySnapshot", "verifiedAt"],
            "Account-generation verification must equal transition time."
          );
        }
        break;
      case "provider_access":
        addMonotonicRevisionIssue(
          context,
          transition.expectedProviderAccessRevision,
          transition.resultingProviderAccess.revision,
          ["resultingProviderAccess", "revision"],
          "Provider-access revision must advance exactly once."
        );
        if (
          transition.resultingProviderAccess.observedAt !==
          transition.occurredAt
        ) {
          addIssue(
            context,
            ["resultingProviderAccess", "observedAt"],
            "Provider-access observation must equal transition time."
          );
        }
        addMonotonicRevisionIssue(
          context,
          transition.expectedBindingGeneration,
          transition.resultingBindingGeneration,
          ["resultingBindingGeneration"],
          "Provider-access changes must invalidate pinned routes by advancing binding generation."
        );
        break;
    }
  });

export const inboxV2SourceThreadBindingTransitionCommitSchema = z
  .object({
    before: inboxV2SourceThreadBindingCurrentProjectionSchema,
    transition: inboxV2SourceThreadBindingTransitionSchema,
    after: inboxV2SourceThreadBindingCurrentProjectionSchema,
    closedRemoteAccessEpisode:
      inboxV2SourceThreadBindingRemoteAccessEpisodeSchema.nullable()
  })
  .strict()
  .superRefine((commit, context) => {
    addTransitionCommitIssues(context, commit);
  });

export const inboxV2SourceThreadBindingEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_SOURCE_THREAD_BINDING_SCHEMA_ID,
    INBOX_V2_SOURCE_THREAD_BINDING_SCHEMA_VERSION,
    inboxV2SourceThreadBindingSchema
  );

export const inboxV2SourceThreadBindingRemoteAccessEpisodeEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_SOURCE_THREAD_BINDING_REMOTE_ACCESS_EPISODE_SCHEMA_ID,
    INBOX_V2_SOURCE_THREAD_BINDING_SCHEMA_VERSION,
    inboxV2SourceThreadBindingRemoteAccessEpisodeSchema
  );

export const inboxV2SourceThreadBindingTransitionEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_SOURCE_THREAD_BINDING_TRANSITION_SCHEMA_ID,
    INBOX_V2_SOURCE_THREAD_BINDING_SCHEMA_VERSION,
    inboxV2SourceThreadBindingTransitionSchema
  );

export const inboxV2SourceThreadBindingCurrentProjectionEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_SOURCE_THREAD_BINDING_CURRENT_PROJECTION_SCHEMA_ID,
    INBOX_V2_SOURCE_THREAD_BINDING_SCHEMA_VERSION,
    inboxV2SourceThreadBindingCurrentProjectionSchema
  );

export const inboxV2SourceThreadBindingTransitionCommitEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_SOURCE_THREAD_BINDING_TRANSITION_COMMIT_SCHEMA_ID,
    INBOX_V2_SOURCE_THREAD_BINDING_SCHEMA_VERSION,
    inboxV2SourceThreadBindingTransitionCommitSchema
  );

export const inboxV2SourceThreadBindingCreationCommitEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_SOURCE_THREAD_BINDING_CREATION_COMMIT_SCHEMA_ID,
    INBOX_V2_SOURCE_THREAD_BINDING_SCHEMA_VERSION,
    inboxV2SourceThreadBindingCreationCommitSchema
  );

export type InboxV2SourceThreadBindingVerifiedAccountIdentitySnapshot = z.infer<
  typeof inboxV2SourceThreadBindingVerifiedAccountIdentitySnapshotSchema
>;
export type InboxV2SourceThreadBindingRemoteAccessState = z.infer<
  typeof inboxV2SourceThreadBindingRemoteAccessStateSchema
>;
export type InboxV2SourceThreadBindingRemoteAccessEvidenceAuthority = z.infer<
  typeof inboxV2SourceThreadBindingRemoteAccessEvidenceAuthoritySchema
>;
export type InboxV2SourceThreadBindingAdministrativeState = z.infer<
  typeof inboxV2SourceThreadBindingAdministrativeStateSchema
>;
export type InboxV2SourceThreadBindingRuntimeHealthState = z.infer<
  typeof inboxV2SourceThreadBindingRuntimeHealthStateSchema
>;
export type InboxV2SourceThreadBindingHistorySyncState = z.infer<
  typeof inboxV2SourceThreadBindingHistorySyncStateSchema
>;
export type InboxV2SourceReferencePortability = z.infer<
  typeof inboxV2SourceReferencePortabilitySchema
>;
export type InboxV2SourceBindingCapabilityState = z.infer<
  typeof inboxV2SourceBindingCapabilityStateSchema
>;
export type InboxV2SourceThreadBindingFence = z.infer<
  typeof inboxV2SourceThreadBindingFenceSchema
>;
export type InboxV2SourceThreadBinding = z.infer<
  typeof inboxV2SourceThreadBindingSchema
>;
export type InboxV2SourceThreadBindingRemoteAccessEpisode = z.infer<
  typeof inboxV2SourceThreadBindingRemoteAccessEpisodeSchema
>;
export type InboxV2SourceThreadBindingCurrentProjection = z.infer<
  typeof inboxV2SourceThreadBindingCurrentProjectionSchema
>;
export type InboxV2SourceThreadBindingCurrentHead = z.infer<
  typeof inboxV2SourceThreadBindingCurrentHeadSchema
>;
export type InboxV2SourceThreadBindingCurrentPage = z.infer<
  typeof inboxV2SourceThreadBindingCurrentPageSchema
>;
export type InboxV2SourceThreadBindingTransition = z.infer<
  typeof inboxV2SourceThreadBindingTransitionSchema
>;
export type InboxV2SourceThreadBindingTransitionCommit = z.infer<
  typeof inboxV2SourceThreadBindingTransitionCommitSchema
>;
export type InboxV2SourceThreadBindingCreationCommit = z.infer<
  typeof inboxV2SourceThreadBindingCreationCommitSchema
>;

export function deriveInboxV2SourceThreadBindingFence(
  input: z.input<typeof inboxV2SourceThreadBindingSchema>
): InboxV2SourceThreadBindingFence {
  const binding = inboxV2SourceThreadBindingSchema.parse(input);

  return inboxV2SourceThreadBindingFenceSchema.parse({
    accountGeneration: binding.accountIdentitySnapshot.accountGeneration,
    bindingGeneration: binding.bindingGeneration,
    remoteAccessRevision: binding.remoteAccess.revision,
    administrativeRevision: binding.administrative.revision,
    capabilityRevision: binding.capabilities.revision,
    routeDescriptorRevision: binding.routeDescriptor.descriptorRevision
  });
}

export function deriveInboxV2SourceThreadBindingCurrentHead(
  input: z.input<typeof inboxV2SourceThreadBindingSchema>
): InboxV2SourceThreadBindingCurrentHead {
  const binding = inboxV2SourceThreadBindingSchema.parse(input);

  return inboxV2SourceThreadBindingCurrentHeadSchema.parse({
    tenantId: binding.tenantId,
    binding: {
      tenantId: binding.tenantId,
      kind: "source_thread_binding",
      id: binding.id
    },
    externalThread: binding.externalThread,
    sourceConnection: binding.sourceConnection,
    sourceAccount: binding.sourceAccount,
    fence: deriveInboxV2SourceThreadBindingFence(binding),
    remoteAccess: {
      state: binding.remoteAccess.state,
      revision: binding.remoteAccess.revision
    },
    administrative: {
      state: binding.administrative.state,
      revision: binding.administrative.revision
    },
    runtimeHealth: {
      state: binding.runtimeHealth.state,
      revision: binding.runtimeHealth.revision
    },
    historySync: {
      state: binding.historySync.state,
      revision: binding.historySync.revision
    },
    providerAccessRevision: binding.providerAccess.revision,
    bindingRevision: binding.revision,
    updatedAt: binding.updatedAt
  });
}

/**
 * Provider roles and capability facts never grant Hulee authority. A true
 * result proves only current remote/admin structure; callers must separately
 * validate current canonical account identity, capability, runtime readiness,
 * exact SourceAccount use authority and Conversation action authority.
 */
export function isInboxV2SourceThreadBindingStructurallyActive(
  input: z.input<typeof inboxV2SourceThreadBindingSchema>
): boolean {
  const binding = inboxV2SourceThreadBindingSchema.parse(input);

  return (
    binding.remoteAccess.state === "active" &&
    binding.administrative.state === "enabled"
  );
}

type BindingTransitionCommitValue = z.infer<
  typeof inboxV2SourceThreadBindingTransitionCommitSchema
>;

type BindingCreationCommitValue = z.infer<
  typeof inboxV2SourceThreadBindingCreationCommitSchema
>;

function addBindingCreationCommitIssues(
  context: z.RefinementCtx,
  commit: BindingCreationCommitValue
): void {
  const mapping = commit.externalThreadMapping;
  const identity = commit.sourceAccountIdentity;
  const binding = commit.initialProjection.binding;
  const episode = commit.initialProjection.currentRemoteAccessEpisode;

  if (
    mapping.tenantId !== commit.tenantId ||
    identity.tenantId !== commit.tenantId ||
    binding.tenantId !== commit.tenantId
  ) {
    addIssue(
      context,
      ["tenantId"],
      "Binding creation authorities and initial projection must share one tenant."
    );
  }

  const mappedThread = {
    tenantId: mapping.thread.tenantId,
    kind: "external_thread" as const,
    id: mapping.thread.id
  };
  if (!sameReference(binding.externalThread, mappedThread)) {
    addIssue(
      context,
      ["initialProjection", "binding", "externalThread"],
      "Initial binding must use the exact canonical ExternalThread mapping."
    );
  }

  const threadScope = mapping.thread.key.scope;
  if (
    threadScope.kind === "source_account" &&
    !sameReference(threadScope.owner, binding.sourceAccount)
  ) {
    addIssue(
      context,
      ["externalThreadMapping", "thread", "key", "scope", "owner"],
      "Account-scoped ExternalThread must be owned by the binding SourceAccount."
    );
  }
  if (
    threadScope.kind === "source_connection" &&
    !sameReference(threadScope.owner, binding.sourceConnection)
  ) {
    addIssue(
      context,
      ["externalThreadMapping", "thread", "key", "scope", "owner"],
      "Connection-scoped ExternalThread must be owned by the binding SourceConnection."
    );
  }

  if (identity.state !== "verified") {
    addIssue(
      context,
      ["sourceAccountIdentity", "state"],
      "Binding creation requires a currently verified canonical SourceAccountIdentity."
    );
    return;
  }

  if (
    !sameReference(binding.sourceAccount, identity.sourceAccount) ||
    !sameReference(binding.sourceConnection, identity.sourceConnection)
  ) {
    addIssue(
      context,
      ["initialProjection", "binding", "sourceAccount"],
      "Initial binding must use the exact canonical SourceAccount and SourceConnection."
    );
  }

  const snapshot = binding.accountIdentitySnapshot;
  const canonical = identity.canonicalIdentity;
  if (
    String(snapshot.accountGeneration) !== String(identity.accountGeneration) ||
    !sameValue(snapshot.declaration, identity.identityDeclaration) ||
    String(snapshot.realmId) !== String(canonical.realm.realmId) ||
    snapshot.canonicalExternalSubject !== canonical.canonicalExternalSubject ||
    snapshot.declaration.realmVersion !== canonical.realm.realmVersion ||
    snapshot.declaration.canonicalizationVersion !==
      canonical.realm.canonicalizationVersion ||
    String(snapshot.declaration.objectKindId) !==
      String(canonical.realm.objectKindId) ||
    snapshot.verifiedAt !== identity.updatedAt
  ) {
    addIssue(
      context,
      ["initialProjection", "binding", "accountIdentitySnapshot"],
      "Initial binding account proof must exactly match the current verified canonical identity generation and declaration."
    );
  }

  if (
    !sameAdapterSurface(
      mapping.thread.identityDeclaration.adapterContract,
      binding.routeDescriptor.adapterContract
    )
  ) {
    addIssue(
      context,
      ["externalThreadMapping", "thread", "identityDeclaration"],
      "Thread mapping and initial binding route must use one adapter surface."
    );
  }

  for (const [path, revision] of [
    [
      ["initialProjection", "binding", "bindingGeneration"],
      binding.bindingGeneration
    ],
    [
      ["initialProjection", "binding", "remoteAccess", "revision"],
      binding.remoteAccess.revision
    ],
    [
      ["initialProjection", "binding", "administrative", "revision"],
      binding.administrative.revision
    ],
    [
      ["initialProjection", "binding", "runtimeHealth", "revision"],
      binding.runtimeHealth.revision
    ],
    [
      ["initialProjection", "binding", "historySync", "revision"],
      binding.historySync.revision
    ],
    [
      ["initialProjection", "binding", "providerAccess", "revision"],
      binding.providerAccess.revision
    ],
    [
      ["initialProjection", "binding", "capabilities", "revision"],
      binding.capabilities.revision
    ],
    [
      ["initialProjection", "binding", "routeDescriptor", "descriptorRevision"],
      binding.routeDescriptor.descriptorRevision
    ],
    [["initialProjection", "binding", "revision"], binding.revision],
    [
      ["initialProjection", "currentRemoteAccessEpisode", "revision"],
      episode.revision
    ]
  ] as const) {
    if (String(revision) !== "1") {
      addIssue(
        context,
        [...path],
        "A newly created binding and every binding-local axis must start at revision 1."
      );
    }
  }

  if (
    binding.createdAt !== binding.updatedAt ||
    episode.createdAt !== binding.createdAt ||
    episode.updatedAt !== binding.createdAt ||
    episode.startedAt !== binding.createdAt
  ) {
    addIssue(
      context,
      ["initialProjection", "binding", "createdAt"],
      "Initial binding and its first open access episode must share one creation boundary."
    );
  }
}

function addAdministrativeTransitionAuthorizationIssues(
  context: z.RefinementCtx,
  transition: Extract<
    z.infer<typeof inboxV2SourceThreadBindingTransitionSchema>,
    { kind: "administrative" }
  >
): void {
  const decision = transition.authorizationDecision;
  const actor = transition.actor;

  if (actor.kind !== "employee") {
    return;
  }
  if (
    decision.tenantId !== transition.tenantId ||
    !sameReference(decision.principal.employee, actor.employee) ||
    !sameReference(decision.target.binding, transition.binding) ||
    decision.authorizationEpoch !== actor.authorizationEpoch
  ) {
    addIssue(
      context,
      ["authorizationDecision"],
      "Administrative authorization must bind the exact Employee, tenant, binding and authenticated authorization epoch."
    );
  }
  if (decision.effect !== "allow") {
    addIssue(
      context,
      ["authorizationDecision", "effect"],
      "Administrative binding transition requires an explicit allow decision."
    );
  }
  if (
    Date.parse(decision.decidedAt) > Date.parse(transition.occurredAt) ||
    Date.parse(decision.notAfter) < Date.parse(transition.occurredAt)
  ) {
    addIssue(
      context,
      ["authorizationDecision", "notAfter"],
      "Administrative authorization must be current at transition time."
    );
  }
}

function addAdministrativeAuthorizationCommitIssues(
  context: z.RefinementCtx,
  commit: BindingTransitionCommitValue
): void {
  const transition = commit.transition;
  if (transition.kind !== "administrative") {
    return;
  }
  const actor = transition.actor;
  if (actor.kind !== "employee") {
    return;
  }
  const before = commit.before.binding;
  const target = transition.authorizationDecision.target;
  if (
    !sameReference(target.binding, transition.binding) ||
    !sameReference(target.externalThread, before.externalThread) ||
    !sameReference(target.sourceAccount, before.sourceAccount) ||
    !sameReference(target.sourceConnection, before.sourceConnection)
  ) {
    addIssue(
      context,
      ["transition", "authorizationDecision", "target"],
      "Administrative authorization must target the exact current thread, binding, account and connection."
    );
  }
}

function sameHistoryProgressPosition(
  left: z.infer<typeof inboxV2SourceThreadBindingHistorySyncSnapshotSchema>,
  right: z.infer<typeof inboxV2SourceThreadBindingHistorySyncSnapshotSchema>
): boolean {
  return (
    left.receiveCursor === right.receiveCursor &&
    left.historyCursor === right.historyCursor &&
    left.providerWatermark === right.providerWatermark
  );
}

function sameCapabilitySemantics(
  left: z.infer<typeof inboxV2SourceThreadBindingCapabilitySnapshotSchema>,
  right: z.infer<typeof inboxV2SourceThreadBindingCapabilitySnapshotSchema>
): boolean {
  const semanticSnapshot = (
    snapshot: z.infer<typeof inboxV2SourceThreadBindingCapabilitySnapshotSchema>
  ) => ({
    adapterContract: {
      contractId: snapshot.adapterContract.contractId,
      contractVersion: snapshot.adapterContract.contractVersion,
      declarationRevision: snapshot.adapterContract.declarationRevision,
      surfaceId: snapshot.adapterContract.surfaceId,
      loadedByTrustedServiceId:
        snapshot.adapterContract.loadedByTrustedServiceId
    },
    entries: snapshot.entries
      .map((entry) => ({
        capabilityId: entry.capabilityId,
        operationId: entry.operationId,
        contentKindId: entry.contentKindId,
        state: entry.state,
        referencePortability: entry.referencePortability,
        requiredProviderRoleIds: [...entry.requiredProviderRoleIds].sort(),
        validUntil: entry.validUntil,
        diagnostic: entry.diagnostic
      }))
      .sort((first, second) =>
        JSON.stringify(first).localeCompare(JSON.stringify(second))
      )
  });

  return sameValue(semanticSnapshot(left), semanticSnapshot(right));
}

function sameStringSet(
  left: readonly string[],
  right: readonly string[]
): boolean {
  return sameValue([...left].sort(), [...right].sort());
}

function addTransitionCommitIssues(
  context: z.RefinementCtx,
  commit: BindingTransitionCommitValue
): void {
  const before = commit.before.binding;
  const after = commit.after.binding;
  const transition = commit.transition;

  if (
    transition.tenantId !== before.tenantId ||
    transition.tenantId !== after.tenantId ||
    transition.binding.tenantId !== before.tenantId ||
    String(transition.binding.id) !== String(before.id)
  ) {
    addIssue(
      context,
      ["transition", "binding"],
      "Transition must target the exact before/after binding."
    );
  }

  if (!sameBindingAnchor(before, after)) {
    addIssue(
      context,
      ["after"],
      "Binding transition cannot replace tenant, thread, connection, account or anchor identity."
    );
  }

  if (
    transition.kind !== "administrative" &&
    (transition.actor.kind !== "trusted_service" ||
      String(transition.actor.trustedServiceId) !==
        String(
          before.accountIdentitySnapshot.declaration.adapterContract
            .loadedByTrustedServiceId
        ))
  ) {
    addIssue(
      context,
      ["transition", "actor"],
      "Provider-owned transition must use the trusted service pinned by the binding account snapshot."
    );
  }

  if (
    String(before.revision) !== String(transition.expectedBindingRevision) ||
    String(after.revision) !== String(transition.resultingBindingRevision)
  ) {
    addIssue(
      context,
      ["transition", "expectedBindingRevision"],
      "Transition CAS revisions must match before and after projections."
    );
  }

  if (
    transition.occurredAt !== after.updatedAt ||
    Date.parse(transition.occurredAt) < Date.parse(before.updatedAt)
  ) {
    addIssue(
      context,
      ["after", "binding", "updatedAt"],
      "After projection update time must equal a non-regressing transition time."
    );
  }

  const expectedAfter: InboxV2SourceThreadBinding = {
    ...before,
    revision: transition.resultingBindingRevision,
    updatedAt: transition.occurredAt
  };

  switch (transition.kind) {
    case "remote_access":
      expectedAfter.remoteAccess = transition.resultingRemoteAccess;
      addRemoteAccessCommitIssues(context, commit);
      break;
    case "administrative":
      expectedAfter.administrative = transition.resultingAdministrative;
      addAdministrativeAuthorizationCommitIssues(context, commit);
      addExpectedSnapshotIssue(
        context,
        before.administrative.state === transition.fromState &&
          String(before.administrative.revision) ===
            String(transition.expectedAdministrativeRevision),
        ["transition", "expectedAdministrativeRevision"],
        "Administrative transition must match the current administrative axis."
      );
      break;
    case "runtime_health":
      expectedAfter.runtimeHealth = transition.resultingRuntimeHealth;
      addExpectedSnapshotIssue(
        context,
        before.runtimeHealth.state === transition.fromState &&
          String(before.runtimeHealth.revision) ===
            String(transition.expectedRuntimeHealthRevision),
        ["transition", "expectedRuntimeHealthRevision"],
        "Runtime-health transition must match the current health axis."
      );
      break;
    case "history_sync":
      expectedAfter.historySync = transition.resultingHistorySync;
      addExpectedSnapshotIssue(
        context,
        before.historySync.state === transition.fromState &&
          String(before.historySync.revision) ===
            String(transition.expectedHistorySyncRevision),
        ["transition", "expectedHistorySyncRevision"],
        "History transition must match the current history axis."
      );
      if (
        isHistorySyncSameStateProgress(
          transition.fromState,
          transition.toState
        ) &&
        sameHistoryProgressPosition(
          before.historySync,
          transition.resultingHistorySync
        )
      ) {
        addIssue(
          context,
          ["transition", "resultingHistorySync"],
          "Same-state history transition must advance a cursor or provider watermark."
        );
      }
      break;
    case "capabilities":
      expectedAfter.capabilities = transition.resultingCapabilities;
      addExpectedSnapshotIssue(
        context,
        String(before.capabilities.revision) ===
          String(transition.expectedCapabilityRevision),
        ["transition", "expectedCapabilityRevision"],
        "Capability transition must match the current capability revision."
      );
      if (
        sameCapabilitySemantics(
          before.capabilities,
          transition.resultingCapabilities
        )
      ) {
        addIssue(
          context,
          ["transition", "resultingCapabilities"],
          "Freshness-only capability observation cannot churn the effective capability fence."
        );
      }
      break;
    case "route_descriptor":
      expectedAfter.routeDescriptor = transition.resultingRouteDescriptor;
      expectedAfter.bindingGeneration = transition.resultingBindingGeneration;
      addExpectedSnapshotIssue(
        context,
        String(before.bindingGeneration) ===
          String(transition.expectedBindingGeneration) &&
          String(before.routeDescriptor.descriptorRevision) ===
            String(transition.expectedRouteDescriptorRevision),
        ["transition", "expectedBindingGeneration"],
        "Route transition must match the current descriptor and binding generation."
      );
      break;
    case "account_generation":
      expectedAfter.accountIdentitySnapshot =
        transition.resultingAccountIdentitySnapshot;
      addExpectedSnapshotIssue(
        context,
        String(before.accountIdentitySnapshot.accountGeneration) ===
          String(transition.expectedAccountGeneration),
        ["transition", "expectedAccountGeneration"],
        "Account transition must match the current account generation."
      );
      if (
        !sameVerifiedAccountIdentitySnapshotAnchor(
          before.accountIdentitySnapshot,
          transition.resultingAccountIdentitySnapshot
        )
      ) {
        addIssue(
          context,
          ["transition", "resultingAccountIdentitySnapshot"],
          "Reauthentication must preserve the verified SourceAccount, realm and canonical subject."
        );
      }
      break;
    case "provider_access":
      expectedAfter.providerAccess = transition.resultingProviderAccess;
      expectedAfter.bindingGeneration = transition.resultingBindingGeneration;
      addExpectedSnapshotIssue(
        context,
        String(before.providerAccess.revision) ===
          String(transition.expectedProviderAccessRevision) &&
          String(before.bindingGeneration) ===
            String(transition.expectedBindingGeneration),
        ["transition", "expectedProviderAccessRevision"],
        "Provider-access transition must match current access and binding-generation revisions."
      );
      if (
        sameStringSet(
          before.providerAccess.roleIds,
          transition.resultingProviderAccess.roleIds
        )
      ) {
        addIssue(
          context,
          ["transition", "resultingProviderAccess", "roleIds"],
          "Freshness-only provider-role observation cannot churn the binding fence."
        );
      }
      break;
  }

  if (!sameValue(after, expectedAfter)) {
    addIssue(
      context,
      ["after", "binding"],
      "Axis-specific transition may change only its owned projection fields."
    );
  }

  if (
    transition.kind !== "remote_access" &&
    (!sameValue(
      commit.before.currentRemoteAccessEpisode,
      commit.after.currentRemoteAccessEpisode
    ) ||
      commit.closedRemoteAccessEpisode !== null)
  ) {
    addIssue(
      context,
      ["after", "currentRemoteAccessEpisode"],
      "Non-remote transition cannot change or close the current remote-access episode."
    );
  }
}

function addRemoteAccessCommitIssues(
  context: z.RefinementCtx,
  commit: BindingTransitionCommitValue
): void {
  if (commit.transition.kind !== "remote_access") {
    return;
  }

  const transition = commit.transition;
  const beforeBinding = commit.before.binding;
  const beforeEpisode = commit.before.currentRemoteAccessEpisode;
  const afterEpisode = commit.after.currentRemoteAccessEpisode;
  const closedEpisode = commit.closedRemoteAccessEpisode;

  addExpectedSnapshotIssue(
    context,
    beforeBinding.remoteAccess.state === transition.fromState &&
      String(beforeBinding.remoteAccess.revision) ===
        String(transition.expectedRemoteAccessRevision),
    ["transition", "expectedRemoteAccessRevision"],
    "Remote transition must match the current remote-access axis."
  );

  if (
    closedEpisode === null ||
    !sameReference(transition.closedEpisode, {
      tenantId: beforeEpisode.tenantId,
      kind: "source_thread_binding_remote_access_episode",
      id: beforeEpisode.id
    }) ||
    !sameReference(transition.openedEpisode, {
      tenantId: afterEpisode.tenantId,
      kind: "source_thread_binding_remote_access_episode",
      id: afterEpisode.id
    })
  ) {
    addIssue(
      context,
      ["closedRemoteAccessEpisode"],
      "Remote transition must close the current episode and reference the newly opened episode."
    );
    return;
  }

  const expectedClosedEpisode: InboxV2SourceThreadBindingRemoteAccessEpisode = {
    ...beforeEpisode,
    endedAt: transition.occurredAt,
    endEvidence: transition.evidence,
    revision: inboxV2EntityRevisionSchema.parse("2"),
    updatedAt: transition.occurredAt
  };

  if (!sameValue(closedEpisode, expectedClosedEpisode)) {
    addIssue(
      context,
      ["closedRemoteAccessEpisode"],
      "Closed episode must be the exact revision-2 closure of the previous current episode."
    );
  }

  if (
    afterEpisode.state !== transition.toState ||
    afterEpisode.startedAt !== transition.occurredAt ||
    afterEpisode.endedAt !== null ||
    !sameValue(afterEpisode.startEvidence, transition.evidence)
  ) {
    addIssue(
      context,
      ["after", "currentRemoteAccessEpisode"],
      "Remote transition must open an evidence-bound episode for the resulting state."
    );
  }
}

function addAccountIdentitySnapshotIssues(
  context: z.RefinementCtx,
  binding: z.infer<typeof inboxV2SourceThreadBindingSchema>
): void {
  const identity = binding.accountIdentitySnapshot;

  for (const [field, reference] of [
    ["sourceConnection", identity.sourceConnection],
    ["sourceAccount", identity.sourceAccount]
  ] as const) {
    addTenantReferenceIssue(context, binding.tenantId, reference, [
      "accountIdentitySnapshot",
      field
    ]);
  }

  if (!sameReference(identity.sourceConnection, binding.sourceConnection)) {
    addIssue(
      context,
      ["accountIdentitySnapshot", "sourceConnection"],
      "Verified account snapshot must use the binding SourceConnection."
    );
  }

  if (!sameReference(identity.sourceAccount, binding.sourceAccount)) {
    addIssue(
      context,
      ["accountIdentitySnapshot", "sourceAccount"],
      "Verified account snapshot must use the binding SourceAccount."
    );
  }

  for (const [index, reference] of identity.verificationEvidence.entries()) {
    addTenantReferenceIssue(context, binding.tenantId, reference, [
      "accountIdentitySnapshot",
      "verificationEvidence",
      index
    ]);
  }
}

function addTransitionTenantIssues(
  context: z.RefinementCtx,
  transition: z.infer<typeof inboxV2SourceThreadBindingTransitionSchema>
): void {
  if (transition.actor.kind === "employee") {
    addTenantReferenceIssue(
      context,
      transition.tenantId,
      transition.actor.employee,
      ["actor", "employee"]
    );
  }

  switch (transition.kind) {
    case "remote_access":
      addTenantReferenceIssue(
        context,
        transition.tenantId,
        transition.closedEpisode,
        ["closedEpisode"]
      );
      addTenantReferenceIssue(
        context,
        transition.tenantId,
        transition.openedEpisode,
        ["openedEpisode"]
      );
      addEvidenceTenantIssues(
        context,
        transition.tenantId,
        transition.resultingRemoteAccess.evidence,
        ["resultingRemoteAccess", "evidence"]
      );
      addEvidenceTenantIssues(
        context,
        transition.tenantId,
        transition.evidence,
        ["evidence"]
      );
      break;
    case "administrative":
      if (transition.authorizationDecision.tenantId !== transition.tenantId) {
        addIssue(
          context,
          ["authorizationDecision", "tenantId"],
          "Administrative authorization must share the transition tenant."
        );
      }
      break;
    case "runtime_health":
      break;
    case "history_sync":
      if (transition.resultingHistorySync.lastDurableRawEvent !== null) {
        addTenantReferenceIssue(
          context,
          transition.tenantId,
          transition.resultingHistorySync.lastDurableRawEvent,
          ["resultingHistorySync", "lastDurableRawEvent"]
        );
      }
      break;
    case "capabilities":
      for (const [
        entryIndex,
        entry
      ] of transition.resultingCapabilities.entries.entries()) {
        addEvidenceTenantIssues(context, transition.tenantId, entry.evidence, [
          "resultingCapabilities",
          "entries",
          entryIndex,
          "evidence"
        ]);
      }
      addEvidenceTenantIssues(
        context,
        transition.tenantId,
        transition.evidence,
        ["evidence"]
      );
      addTrustedActorContractIssue(
        context,
        transition,
        transition.resultingCapabilities.adapterContract,
        ["resultingCapabilities", "adapterContract"]
      );
      break;
    case "route_descriptor":
      addEvidenceTenantIssues(
        context,
        transition.tenantId,
        transition.evidence,
        ["evidence"]
      );
      addTrustedActorContractIssue(
        context,
        transition,
        transition.resultingRouteDescriptor.adapterContract,
        ["resultingRouteDescriptor", "adapterContract"]
      );
      break;
    case "account_generation":
      addTenantReferenceIssue(
        context,
        transition.tenantId,
        transition.resultingAccountIdentitySnapshot.sourceConnection,
        ["resultingAccountIdentitySnapshot", "sourceConnection"]
      );
      addTenantReferenceIssue(
        context,
        transition.tenantId,
        transition.resultingAccountIdentitySnapshot.sourceAccount,
        ["resultingAccountIdentitySnapshot", "sourceAccount"]
      );
      addEvidenceTenantIssues(
        context,
        transition.tenantId,
        transition.resultingAccountIdentitySnapshot.verificationEvidence,
        ["resultingAccountIdentitySnapshot", "verificationEvidence"]
      );
      addEvidenceTenantIssues(
        context,
        transition.tenantId,
        transition.evidence,
        ["evidence"]
      );
      addTrustedActorContractIssue(
        context,
        transition,
        transition.resultingAccountIdentitySnapshot.declaration.adapterContract,
        ["resultingAccountIdentitySnapshot", "declaration", "adapterContract"]
      );
      break;
    case "provider_access":
      addEvidenceTenantIssues(
        context,
        transition.tenantId,
        transition.resultingProviderAccess.evidence,
        ["resultingProviderAccess", "evidence"]
      );
      addEvidenceTenantIssues(
        context,
        transition.tenantId,
        transition.evidence,
        ["evidence"]
      );
      break;
  }
}

function addEvidenceTenantIssues(
  context: z.RefinementCtx,
  tenantId: string,
  references: readonly { tenantId: string }[],
  path: PropertyKey[]
): void {
  for (const [index, reference] of references.entries()) {
    addTenantReferenceIssue(context, tenantId, reference, [...path, index]);
  }
}

function addTrustedActorContractIssue(
  context: z.RefinementCtx,
  transition: z.infer<typeof inboxV2SourceThreadBindingTransitionSchema>,
  adapterContract: z.infer<typeof inboxV2AdapterContractSnapshotSchema>,
  path: PropertyKey[]
): void {
  if (
    transition.actor.kind !== "trusted_service" ||
    String(transition.actor.trustedServiceId) !==
      String(adapterContract.loadedByTrustedServiceId)
  ) {
    addIssue(
      context,
      path,
      "Adapter-owned binding update must be stamped by the service that loaded its contract."
    );
  }
}

function sameVerifiedAccountIdentitySnapshotAnchor(
  left: z.infer<
    typeof inboxV2SourceThreadBindingVerifiedAccountIdentitySnapshotSchema
  >,
  right: z.infer<
    typeof inboxV2SourceThreadBindingVerifiedAccountIdentitySnapshotSchema
  >
): boolean {
  return (
    sameReference(left.sourceConnection, right.sourceConnection) &&
    sameReference(left.sourceAccount, right.sourceAccount) &&
    String(left.realmId) === String(right.realmId) &&
    left.canonicalExternalSubject === right.canonicalExternalSubject &&
    left.declaration.identityKind === right.declaration.identityKind &&
    String(left.declaration.realmId) === String(right.declaration.realmId) &&
    left.declaration.realmVersion === right.declaration.realmVersion &&
    left.declaration.canonicalizationVersion ===
      right.declaration.canonicalizationVersion &&
    String(left.declaration.objectKindId) ===
      String(right.declaration.objectKindId) &&
    left.declaration.scopeKind === right.declaration.scopeKind &&
    String(left.declaration.adapterContract.contractId) ===
      String(right.declaration.adapterContract.contractId) &&
    left.declaration.adapterContract.contractVersion ===
      right.declaration.adapterContract.contractVersion &&
    String(left.declaration.adapterContract.surfaceId) ===
      String(right.declaration.adapterContract.surfaceId)
  );
}

function sameBindingAnchor(
  left: InboxV2SourceThreadBinding,
  right: InboxV2SourceThreadBinding
): boolean {
  return (
    left.tenantId === right.tenantId &&
    String(left.id) === String(right.id) &&
    sameReference(left.externalThread, right.externalThread) &&
    sameReference(left.sourceConnection, right.sourceConnection) &&
    sameReference(left.sourceAccount, right.sourceAccount) &&
    left.createdAt === right.createdAt
  );
}

function sameAdapterSurface(
  left: z.infer<typeof inboxV2AdapterContractSnapshotSchema>,
  right: z.infer<typeof inboxV2AdapterContractSnapshotSchema>
): boolean {
  return (
    String(left.contractId) === String(right.contractId) &&
    left.contractVersion === right.contractVersion &&
    String(left.surfaceId) === String(right.surfaceId)
  );
}

function addStateTransitionIssues(
  context: z.RefinementCtx,
  fromState: string,
  toState: string,
  expectedRevision: string,
  resultingRevision: string,
  resultingState: string,
  resultingTimestamp: string,
  occurredAt: string,
  path: PropertyKey[],
  allowSameStateProgress = false
): void {
  if (fromState === toState && !allowSameStateProgress) {
    addIssue(
      context,
      ["toState"],
      "Same-state binding observations are idempotent no-ops, not transitions."
    );
  }

  if (resultingState !== toState) {
    addIssue(
      context,
      [...path, "state"],
      "Resulting binding axis must carry the declared target state."
    );
  }

  if (resultingTimestamp !== occurredAt) {
    addIssue(
      context,
      [...path],
      "Resulting binding axis timestamp must equal transition time."
    );
  }

  addMonotonicRevisionIssue(
    context,
    expectedRevision,
    resultingRevision,
    [...path, "revision"],
    "Resulting binding axis revision must advance exactly once."
  );
}

function isHistorySyncTransitionAllowed(
  fromState: z.infer<typeof inboxV2SourceThreadBindingHistorySyncStateSchema>,
  toState: z.infer<typeof inboxV2SourceThreadBindingHistorySyncStateSchema>
): boolean {
  const allowed: Record<
    z.infer<typeof inboxV2SourceThreadBindingHistorySyncStateSchema>,
    readonly z.infer<typeof inboxV2SourceThreadBindingHistorySyncStateSchema>[]
  > = {
    unsupported: ["not_started"],
    not_started: ["backfilling", "live"],
    backfilling: ["catching_up", "paused", "failed"],
    catching_up: ["live", "paused", "failed"],
    live: ["paused", "failed"],
    paused: ["backfilling", "catching_up", "live", "failed"],
    failed: ["not_started", "backfilling", "catching_up", "paused"]
  };

  return allowed[fromState].includes(toState);
}

function isHistorySyncSameStateProgress(
  fromState: z.infer<typeof inboxV2SourceThreadBindingHistorySyncStateSchema>,
  toState: z.infer<typeof inboxV2SourceThreadBindingHistorySyncStateSchema>
): boolean {
  return (
    fromState === toState &&
    (fromState === "backfilling" ||
      fromState === "catching_up" ||
      fromState === "live")
  );
}

function addMonotonicRevisionIssue(
  context: z.RefinementCtx,
  expectedRevision: string,
  resultingRevision: string,
  path: PropertyKey[],
  message: string
): void {
  if (BigInt(resultingRevision) !== BigInt(expectedRevision) + 1n) {
    addIssue(context, path, message);
  }
}

function addDuplicateStringIssues(
  context: z.RefinementCtx,
  values: readonly string[],
  path: PropertyKey[]
): void {
  const seen = new Set<string>();

  for (const [index, value] of values.entries()) {
    if (seen.has(String(value))) {
      addIssue(context, [...path, index], "Catalog IDs must be unique.");
    }
    seen.add(String(value));
  }
}

function addTenantReferenceIssue(
  context: z.RefinementCtx,
  tenantId: string,
  reference: { tenantId: string },
  path: PropertyKey[]
): void {
  if (reference.tenantId !== tenantId) {
    addIssue(
      context,
      path,
      "Referenced binding entity must share tenant scope."
    );
  }
}

function addExpectedSnapshotIssue(
  context: z.RefinementCtx,
  condition: boolean,
  path: PropertyKey[],
  message: string
): void {
  if (!condition) {
    addIssue(context, path, message);
  }
}

function sameReference(
  left: { tenantId: string; kind: string; id: string },
  right: { tenantId: string; kind: string; id: string }
): boolean {
  return (
    left.tenantId === right.tenantId &&
    left.kind === right.kind &&
    String(left.id) === String(right.id)
  );
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function addIssue(
  context: z.RefinementCtx,
  path: PropertyKey[],
  message: string
): void {
  context.addIssue({ code: "custom", path, message });
}
