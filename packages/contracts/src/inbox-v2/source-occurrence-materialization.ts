import { z } from "zod";

import {
  inboxV2TimestampSchema,
  isInboxV2TimestampOrderValid
} from "./entity-metadata";
import { inboxV2TenantIdSchema } from "./ids";
import {
  inboxV2SourceOccurrenceSchema,
  type InboxV2SourceOccurrence
} from "./external-message-reference";
import {
  inboxV2ExternalThreadMappingSchema,
  type InboxV2ExternalThreadMapping
} from "./external-thread";
import {
  inboxV2OutboundDispatchAttemptSchema,
  inboxV2OutboundDispatchSchema,
  type InboxV2OutboundDispatch,
  type InboxV2OutboundDispatchAttempt
} from "./outbound-dispatch";
import {
  inboxV2OutboundRouteSchema,
  type InboxV2OutboundRoute
} from "./outbound-route";
import {
  createInboxV2SchemaEnvelopeSchema,
  INBOX_V2_INITIAL_SCHEMA_VERSION
} from "./schema-version";
import {
  inboxV2SourceAccountIdentitySchema,
  type InboxV2SourceAccountIdentity
} from "./source-account-identity";
import {
  inboxV2RoutingTokenSchema,
  inboxV2RoutingTrustedServiceIdSchema,
  type InboxV2AdapterContractSnapshot
} from "./source-routing-primitives";
import {
  deriveInboxV2SourceThreadBindingFence,
  inboxV2SourceThreadBindingCurrentProjectionSchema,
  type InboxV2SourceThreadBindingCurrentProjection
} from "./source-thread-binding";

export const INBOX_V2_SOURCE_OCCURRENCE_MATERIALIZATION_COMMIT_SCHEMA_ID =
  "core:inbox-v2.source-occurrence-materialization-commit" as const;
export const INBOX_V2_SOURCE_OCCURRENCE_MATERIALIZATION_SCHEMA_VERSION =
  INBOX_V2_INITIAL_SCHEMA_VERSION;

type InboxV2VerifiedSourceAccountIdentity = Extract<
  InboxV2SourceAccountIdentity,
  { state: "verified" }
>;

export const inboxV2MaterializationVerifiedSourceAccountIdentitySchema =
  inboxV2SourceAccountIdentitySchema
    .superRefine((identity, context) => {
      if (identity.state !== "verified") {
        addIssue(
          context,
          ["state"],
          "Occurrence materialization requires the current verified canonical SourceAccountIdentity."
        );
      }
    })
    .transform((identity) => identity as InboxV2VerifiedSourceAccountIdentity);

export const inboxV2SourceOccurrenceMaterializationAuthoritySchema = z
  .object({
    kind: z.literal("trusted_service"),
    trustedServiceId: inboxV2RoutingTrustedServiceIdSchema,
    authorizationToken: inboxV2RoutingTokenSchema,
    authorizedAt: inboxV2TimestampSchema
  })
  .strict();

export const inboxV2SourceOccurrenceBindingMaterializationSchema =
  z.discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("existing"),
        currentProjection: inboxV2SourceThreadBindingCurrentProjectionSchema,
        creationAuthority: z.null()
      })
      .strict(),
    z
      .object({
        kind: z.literal("created"),
        currentProjection: inboxV2SourceThreadBindingCurrentProjectionSchema,
        creationAuthority: inboxV2SourceOccurrenceMaterializationAuthoritySchema
      })
      .strict()
  ]);

/**
 * One bounded write proof for one initial SourceOccurrence. It deliberately
 * carries exact current snapshots and never a thread/account occurrence list.
 */
export const inboxV2SourceOccurrenceMaterializationCommitSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    occurrence: inboxV2SourceOccurrenceSchema,
    bindingMaterialization: inboxV2SourceOccurrenceBindingMaterializationSchema,
    externalThreadMapping: inboxV2ExternalThreadMappingSchema,
    sourceAccountIdentity:
      inboxV2MaterializationVerifiedSourceAccountIdentitySchema,
    outboundDispatchAttempt: inboxV2OutboundDispatchAttemptSchema.nullable(),
    outboundDispatch: inboxV2OutboundDispatchSchema.nullable(),
    outboundRoute: inboxV2OutboundRouteSchema.nullable(),
    authority: inboxV2SourceOccurrenceMaterializationAuthoritySchema,
    materializedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((commit, context) => {
    const { occurrence } = commit;
    const projection = commit.bindingMaterialization.currentProjection;
    const { binding, currentRemoteAccessEpisode: episode } = projection;
    const mapping = commit.externalThreadMapping;
    const identity = commit.sourceAccountIdentity;

    if (
      commit.tenantId !== occurrence.tenantId ||
      commit.tenantId !== binding.tenantId ||
      commit.tenantId !== mapping.tenantId ||
      commit.tenantId !== identity.tenantId
    ) {
      addIssue(
        context,
        ["tenantId"],
        "Occurrence, binding, mapping and account identity must share the materialization tenant."
      );
    }

    if (
      occurrence.resolution.state !== "pending" ||
      String(occurrence.revision) !== "1" ||
      occurrence.createdAt !== occurrence.updatedAt
    ) {
      addIssue(
        context,
        ["occurrence"],
        "Materialization accepts only an initial revision-1 pending SourceOccurrence."
      );
    }

    if (
      commit.materializedAt !== occurrence.recordedAt ||
      commit.authority.authorizedAt !== commit.materializedAt
    ) {
      addIssue(
        context,
        ["materializedAt"],
        "Occurrence recording, trusted authorization and materialization must share one commit boundary."
      );
    }

    if (
      commit.authority.trustedServiceId !==
      occurrence.messageIdentityDeclaration.adapterContract
        .loadedByTrustedServiceId
    ) {
      addIssue(
        context,
        ["authority", "trustedServiceId"],
        "Materialization must use the trusted service pinned by the occurrence declaration."
      );
    }

    addBindingAgreementIssues(context, occurrence, projection);
    addMappingAgreementIssues(context, occurrence, projection, mapping);
    addAccountIdentityAgreementIssues(context, projection, identity);
    addAdapterAgreementIssues(
      context,
      occurrence,
      projection,
      mapping,
      identity
    );
    addBindingCreationIssues(context, commit);
    addOutboundProofIssues(context, commit);

    for (const [path, timestamp] of [
      [
        ["externalThreadMapping", "thread", "createdAt"],
        mapping.thread.createdAt
      ],
      [
        ["bindingMaterialization", "currentProjection", "binding", "createdAt"],
        binding.createdAt
      ],
      [
        [
          "bindingMaterialization",
          "currentProjection",
          "currentRemoteAccessEpisode",
          "startedAt"
        ],
        episode.startedAt
      ],
      [["sourceAccountIdentity", "updatedAt"], identity.updatedAt]
    ] as const) {
      if (!isInboxV2TimestampOrderValid(timestamp, commit.materializedAt)) {
        addIssue(
          context,
          path,
          "Materialization cannot use a snapshot created after its commit boundary."
        );
      }
    }
  });

export const inboxV2SourceOccurrenceMaterializationCommitEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_SOURCE_OCCURRENCE_MATERIALIZATION_COMMIT_SCHEMA_ID,
    INBOX_V2_SOURCE_OCCURRENCE_MATERIALIZATION_SCHEMA_VERSION,
    inboxV2SourceOccurrenceMaterializationCommitSchema
  );

export type InboxV2MaterializationVerifiedSourceAccountIdentity = z.infer<
  typeof inboxV2MaterializationVerifiedSourceAccountIdentitySchema
>;
export type InboxV2SourceOccurrenceMaterializationAuthority = z.infer<
  typeof inboxV2SourceOccurrenceMaterializationAuthoritySchema
>;
export type InboxV2SourceOccurrenceBindingMaterialization = z.infer<
  typeof inboxV2SourceOccurrenceBindingMaterializationSchema
>;
export type InboxV2SourceOccurrenceMaterializationCommit = z.infer<
  typeof inboxV2SourceOccurrenceMaterializationCommitSchema
>;

function addBindingAgreementIssues(
  context: z.RefinementCtx,
  occurrence: InboxV2SourceOccurrence,
  projection: InboxV2SourceThreadBindingCurrentProjection
): void {
  const { binding } = projection;
  const occurrenceBinding = occurrence.bindingContext;

  for (const [path, left, right] of [
    [
      ["bindingMaterialization", "currentProjection", "binding", "id"],
      { tenantId: binding.tenantId, id: binding.id },
      occurrenceBinding.sourceThreadBinding
    ],
    [
      [
        "bindingMaterialization",
        "currentProjection",
        "binding",
        "externalThread"
      ],
      binding.externalThread,
      occurrenceBinding.externalThread
    ],
    [
      [
        "bindingMaterialization",
        "currentProjection",
        "binding",
        "sourceAccount"
      ],
      binding.sourceAccount,
      occurrenceBinding.sourceAccount
    ]
  ] as const) {
    if (!sameReference(left, right)) {
      addIssue(
        context,
        path,
        "Occurrence must name the exact materialized binding anchor."
      );
    }
  }

  if (
    String(binding.bindingGeneration) !==
    String(occurrenceBinding.bindingGeneration)
  ) {
    addIssue(
      context,
      [
        "bindingMaterialization",
        "currentProjection",
        "binding",
        "bindingGeneration"
      ],
      "Occurrence must pin the exact binding generation."
    );
  }

  if (
    String(occurrence.descriptor.capabilityRevision) !==
    String(binding.capabilities.revision)
  ) {
    addIssue(
      context,
      ["occurrence", "descriptor", "capabilityRevision"],
      "Occurrence descriptor must pin the exact binding capability revision."
    );
  }
}

function addMappingAgreementIssues(
  context: z.RefinementCtx,
  occurrence: InboxV2SourceOccurrence,
  projection: InboxV2SourceThreadBindingCurrentProjection,
  mapping: InboxV2ExternalThreadMapping
): void {
  const threadReference = {
    tenantId: mapping.thread.tenantId,
    id: mapping.thread.id
  };

  if (
    !sameReference(threadReference, occurrence.bindingContext.externalThread) ||
    !sameReference(threadReference, occurrence.messageKey.externalThread) ||
    !sameReference(threadReference, projection.binding.externalThread)
  ) {
    addIssue(
      context,
      ["externalThreadMapping", "thread", "id"],
      "Materialization mapping, message key and binding must use one exact ExternalThread."
    );
  }

  const threadScope = mapping.thread.key.scope;
  if (
    threadScope.kind === "source_account" &&
    !sameReference(threadScope.owner, projection.binding.sourceAccount)
  ) {
    addIssue(
      context,
      ["externalThreadMapping", "thread", "key", "scope", "owner"],
      "Account-scoped ExternalThread must belong to the exact materialized binding SourceAccount."
    );
  }
  if (
    threadScope.kind === "source_connection" &&
    !sameReference(threadScope.owner, projection.binding.sourceConnection)
  ) {
    addIssue(
      context,
      ["externalThreadMapping", "thread", "key", "scope", "owner"],
      "Connection-scoped ExternalThread must belong to the exact materialized binding SourceConnection."
    );
  }
}

function addAccountIdentityAgreementIssues(
  context: z.RefinementCtx,
  projection: InboxV2SourceThreadBindingCurrentProjection,
  identity: InboxV2VerifiedSourceAccountIdentity
): void {
  const { binding } = projection;
  const snapshot = binding.accountIdentitySnapshot;

  if (
    !sameReference(identity.sourceAccount, binding.sourceAccount) ||
    !sameReference(identity.sourceConnection, binding.sourceConnection) ||
    String(identity.accountGeneration) !== String(snapshot.accountGeneration)
  ) {
    addIssue(
      context,
      ["sourceAccountIdentity"],
      "Verified account identity must match the binding account, connection and generation."
    );
  }

  if (
    String(identity.canonicalIdentity.realm.realmId) !==
      String(snapshot.realmId) ||
    identity.canonicalIdentity.canonicalExternalSubject !==
      snapshot.canonicalExternalSubject ||
    !sameAccountDeclarationAnchor(
      identity.identityDeclaration,
      snapshot.declaration
    )
  ) {
    addIssue(
      context,
      ["sourceAccountIdentity", "canonicalIdentity"],
      "Binding account snapshot must equal the current verified canonical account identity."
    );
  }
}

function addAdapterAgreementIssues(
  context: z.RefinementCtx,
  occurrence: InboxV2SourceOccurrence,
  projection: InboxV2SourceThreadBindingCurrentProjection,
  mapping: InboxV2ExternalThreadMapping,
  identity: InboxV2VerifiedSourceAccountIdentity
): void {
  const expected = occurrence.messageIdentityDeclaration.adapterContract;
  const contracts = [
    projection.binding.accountIdentitySnapshot.declaration.adapterContract,
    projection.binding.capabilities.adapterContract,
    projection.binding.routeDescriptor.adapterContract,
    mapping.thread.identityDeclaration.adapterContract,
    identity.identityDeclaration.adapterContract
  ];

  if (!contracts.every((contract) => sameAdapterSurface(expected, contract))) {
    addIssue(
      context,
      ["occurrence", "messageIdentityDeclaration", "adapterContract"],
      "Occurrence, binding, mapping and account identity must use one adapter surface declaration."
    );
  }
}

function addBindingCreationIssues(
  context: z.RefinementCtx,
  commit: z.infer<typeof inboxV2SourceOccurrenceMaterializationCommitSchema>
): void {
  const materialization = commit.bindingMaterialization;
  if (materialization.kind !== "created") {
    return;
  }

  const { binding, currentRemoteAccessEpisode: episode } =
    materialization.currentProjection;
  const authority = materialization.creationAuthority;

  if (
    authority.trustedServiceId !==
      binding.accountIdentitySnapshot.declaration.adapterContract
        .loadedByTrustedServiceId ||
    authority.authorizedAt !== binding.createdAt ||
    episode.createdAt !== binding.createdAt ||
    String(binding.revision) !== "1"
  ) {
    addIssue(
      context,
      ["bindingMaterialization", "creationAuthority"],
      "New binding materialization requires loader-pinned authority at its exact revision-1 creation boundary."
    );
  }

  if (commit.occurrence.origin.kind === "provider_response") {
    addIssue(
      context,
      ["bindingMaterialization", "kind"],
      "A provider response must reuse the binding already pinned by its OutboundRoute."
    );
    return;
  }

  const eventReferences = [
    commit.occurrence.origin.rawInboundEvent,
    commit.occurrence.origin.normalizedInboundEvent
  ];
  if (
    !eventReferences.some((reference) =>
      episode.startEvidence.some((evidence) =>
        sameReference(evidence, reference)
      )
    )
  ) {
    addIssue(
      context,
      [
        "bindingMaterialization",
        "currentProjection",
        "currentRemoteAccessEpisode",
        "startEvidence"
      ],
      "A newly created binding episode must cite this occurrence event evidence."
    );
  }
}

function addOutboundProofIssues(
  context: z.RefinementCtx,
  commit: z.infer<typeof inboxV2SourceOccurrenceMaterializationCommitSchema>
): void {
  const snapshots = [
    commit.outboundDispatchAttempt,
    commit.outboundDispatch,
    commit.outboundRoute
  ];
  const isProviderResponse =
    commit.occurrence.origin.kind === "provider_response";

  if (!isProviderResponse) {
    if (snapshots.some((snapshot) => snapshot !== null)) {
      addIssue(
        context,
        ["outboundDispatchAttempt"],
        "Only provider-response materialization may carry outbound snapshots."
      );
    }
    return;
  }

  if (
    commit.outboundDispatchAttempt === null ||
    commit.outboundDispatch === null ||
    commit.outboundRoute === null
  ) {
    addIssue(
      context,
      ["outboundDispatchAttempt"],
      "Provider-response materialization requires exact attempt, dispatch and immutable route snapshots."
    );
    return;
  }

  addExactOutboundProofIssues(
    context,
    commit,
    commit.outboundDispatchAttempt,
    commit.outboundDispatch,
    commit.outboundRoute
  );
}

function addExactOutboundProofIssues(
  context: z.RefinementCtx,
  commit: z.infer<typeof inboxV2SourceOccurrenceMaterializationCommitSchema>,
  attempt: InboxV2OutboundDispatchAttempt,
  dispatch: InboxV2OutboundDispatch,
  route: InboxV2OutboundRoute
): void {
  const occurrence = commit.occurrence;
  if (occurrence.origin.kind !== "provider_response") {
    return;
  }
  const { binding } = commit.bindingMaterialization.currentProjection;
  const mapping = commit.externalThreadMapping;
  const attemptReference = { tenantId: attempt.tenantId, id: attempt.id };
  const dispatchReference = { tenantId: dispatch.tenantId, id: dispatch.id };
  const routeReference = { tenantId: route.tenantId, id: route.id };

  if (
    !sameReference(
      occurrence.origin.outboundDispatchAttempt,
      attemptReference
    ) ||
    !sameReference(attempt.dispatch, dispatchReference) ||
    !sameReference(attempt.route, routeReference) ||
    !sameReference(dispatch.route, routeReference) ||
    dispatch.lastAttempt === null ||
    !sameReference(dispatch.lastAttempt, attemptReference)
  ) {
    addIssue(
      context,
      ["outboundDispatchAttempt"],
      "Provider response must prove the exact attempt-to-dispatch-to-route chain."
    );
  }

  for (const [path, left, right] of [
    [
      ["outboundRoute", "externalThread"],
      route.externalThread,
      binding.externalThread
    ],
    [
      ["outboundRoute", "sourceThreadBinding"],
      route.sourceThreadBinding,
      { tenantId: binding.tenantId, id: binding.id }
    ],
    [
      ["outboundRoute", "sourceAccount"],
      route.sourceAccount,
      binding.sourceAccount
    ],
    [
      ["outboundRoute", "sourceConnection"],
      route.sourceConnection,
      binding.sourceConnection
    ],
    [
      ["outboundRoute", "conversation"],
      route.conversation,
      mapping.thread.conversation
    ]
  ] as const) {
    if (!sameReference(left, right)) {
      addIssue(
        context,
        path,
        "OutboundRoute must pin the exact materialized mapping and binding anchor."
      );
    }
  }

  if (
    !sameValue(
      route.bindingFence,
      deriveInboxV2SourceThreadBindingFence(binding)
    )
  ) {
    addIssue(
      context,
      ["outboundRoute", "bindingFence"],
      "OutboundRoute must pin the exact materialized binding fence."
    );
  }

  if (
    !sameAdapterSurface(
      occurrence.messageIdentityDeclaration.adapterContract,
      route.adapterContract
    )
  ) {
    addIssue(
      context,
      ["outboundRoute", "adapterContract"],
      "Provider response and OutboundRoute must use one adapter surface."
    );
  }

  if (
    !isInboxV2TimestampOrderValid(dispatch.createdAt, attempt.openedAt) ||
    !isInboxV2TimestampOrderValid(route.createdAt, attempt.openedAt) ||
    !isInboxV2TimestampOrderValid(attempt.openedAt, occurrence.observedAt)
  ) {
    addIssue(
      context,
      ["outboundDispatchAttempt", "openedAt"],
      "Provider response cannot precede its immutable route, dispatch or provider attempt."
    );
  }
}

function sameAccountDeclarationAnchor(
  left: InboxV2SourceAccountIdentity["identityDeclaration"],
  right: InboxV2SourceThreadBindingCurrentProjection["binding"]["accountIdentitySnapshot"]["declaration"]
): boolean {
  return (
    left.identityKind === right.identityKind &&
    String(left.realmId) === String(right.realmId) &&
    left.realmVersion === right.realmVersion &&
    left.canonicalizationVersion === right.canonicalizationVersion &&
    String(left.objectKindId) === String(right.objectKindId) &&
    left.scopeKind === right.scopeKind &&
    sameAdapterSurface(left.adapterContract, right.adapterContract)
  );
}

function sameAdapterSurface(
  left: InboxV2AdapterContractSnapshot,
  right: InboxV2AdapterContractSnapshot
): boolean {
  return (
    String(left.contractId) === String(right.contractId) &&
    left.contractVersion === right.contractVersion &&
    String(left.surfaceId) === String(right.surfaceId)
  );
}

function sameReference(
  left: { tenantId: string; id: string },
  right: { tenantId: string; id: string }
): boolean {
  return (
    left.tenantId === right.tenantId && String(left.id) === String(right.id)
  );
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function addIssue(
  context: z.RefinementCtx,
  path: readonly PropertyKey[],
  message: string
): void {
  context.addIssue({ code: "custom", path: [...path], message });
}
