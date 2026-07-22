import { z } from "zod";

import { inboxV2CatalogIdSchema } from "./catalog";
import { inboxV2AuthorizationEpochSchema } from "./authorization-epoch";
import { inboxV2TimestampSchema } from "./entity-metadata";
import { inboxV2EmployeeReferenceSchema, inboxV2TenantIdSchema } from "./ids";
import { inboxV2NamespacedIdSchema } from "./namespace";
import { inboxV2TrustedServiceIdSchema } from "./participant-identity";
import { assertInboxV2ClosedJsonSchema } from "./schema-safety";
import {
  createInboxV2SchemaEnvelopeSchema,
  INBOX_V2_INITIAL_SCHEMA_VERSION,
  parseInboxV2VersionedEnvelope
} from "./schema-version";
import {
  inboxV2TimelineCommandIntentEnvelopeSchema,
  type InboxV2TimelineCommandIntent
} from "./timeline-command-intents";
import {
  inboxV2AuthorizationDecisionReferenceSchema,
  inboxV2AuthorizationEpochSnapshotSchema,
  inboxV2ClientMutationIdSchema,
  inboxV2CommandIdSchema,
  inboxV2PayloadReferenceSchema,
  inboxV2RequestIdSchema,
  inboxV2Sha256DigestSchema,
  inboxV2StreamEpochSchema,
  inboxV2TenantStreamCommitIdSchema,
  inboxV2TenantStreamCommitPositionSchema
} from "./sync-primitives";

export const INBOX_V2_CLIENT_COMMAND_REQUEST_SCHEMA_ID =
  "core:inbox-v2.client-command-request" as const;
export const INBOX_V2_AUTHORIZED_COMMAND_SCHEMA_ID =
  "core:inbox-v2.authorized-command" as const;
export const INBOX_V2_COMMAND_RESULT_SCHEMA_ID =
  "core:inbox-v2.command-result" as const;
export const INBOX_V2_COMMAND_PROTOCOL_SCHEMA_VERSION =
  INBOX_V2_INITIAL_SCHEMA_VERSION;
export const INBOX_V2_TIMELINE_COMMAND_TYPE_ID =
  "core:timeline.command" as const;

/**
 * Builds the untrusted request boundary for one exact command payload schema.
 * Actor and authorization fields intentionally do not exist on this surface.
 */
export function createInboxV2ClientCommandRequestEnvelopeSchema<
  const TCommandTypeId extends string,
  TPayloadSchema extends z.ZodType
>(input: { commandTypeId: TCommandTypeId; payloadSchema: TPayloadSchema }) {
  inboxV2NamespacedIdSchema.parse(input.commandTypeId);
  assertInboxV2ClosedJsonSchema(input.payloadSchema, "Client command payload");

  return createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_CLIENT_COMMAND_REQUEST_SCHEMA_ID,
    INBOX_V2_COMMAND_PROTOCOL_SCHEMA_VERSION,
    z
      .object({
        tenantId: inboxV2TenantIdSchema,
        requestId: inboxV2RequestIdSchema,
        clientMutationId: inboxV2ClientMutationIdSchema,
        commandTypeId: z.literal(input.commandTypeId),
        payload: input.payloadSchema
      })
      .strict()
  );
}

export const inboxV2CommandPrincipalSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("employee"),
      employee: inboxV2EmployeeReferenceSchema,
      authorization: inboxV2AuthorizationEpochSnapshotSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("trusted_service"),
      trustedServiceId: inboxV2TrustedServiceIdSchema,
      authorizationEpoch: inboxV2AuthorizationEpochSchema
    })
    .strict()
]);

export const inboxV2CommandPrincipalIdentitySchema = z.discriminatedUnion(
  "kind",
  [
    z
      .object({
        kind: z.literal("employee"),
        employee: inboxV2EmployeeReferenceSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("trusted_service"),
        trustedServiceId: inboxV2TrustedServiceIdSchema
      })
      .strict()
  ]
);

export const inboxV2CommandRequestIdentitySchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    requestId: inboxV2RequestIdSchema,
    clientMutationId: inboxV2ClientMutationIdSchema,
    commandTypeId: inboxV2CatalogIdSchema,
    requestHash: inboxV2Sha256DigestSchema
  })
  .strict();

export type InboxV2AuthorizedIntentContext = Readonly<{
  tenantId: string;
  authorizationContextComplete: boolean;
  actor:
    | Readonly<{
        kind: "employee";
        employee: Readonly<{ tenantId: string; id: string }>;
        authorizationEpoch: string;
      }>
    | Readonly<{ kind: "trusted_service"; trustedServiceId: string }>;
  requiredAuthorizations: readonly Readonly<{
    permissionId: string;
    resourceScopeId: string;
    resource: Readonly<{
      tenantId: string;
      entityTypeId: string;
      entityId: string;
    }>;
  }>[];
}>;

export function createInboxV2AuthorizedCommandContract<
  const TCommandTypeId extends string,
  TIntentSchema extends z.ZodType
>(input: {
  commandTypeId: TCommandTypeId;
  intentSchema: TIntentSchema;
  resolveIntentContext: (
    intent: z.output<TIntentSchema>
  ) => InboxV2AuthorizedIntentContext;
}) {
  const commandTypeId = inboxV2CatalogIdSchema.parse(input.commandTypeId);
  assertInboxV2ClosedJsonSchema(
    input.intentSchema,
    "Authorized command intent"
  );
  const commandSchema = z
    .object({
      tenantId: inboxV2TenantIdSchema,
      commandId: inboxV2CommandIdSchema,
      request: inboxV2CommandRequestIdentitySchema,
      principal: inboxV2CommandPrincipalSchema,
      authorizationDecisionRefs: z
        .array(inboxV2AuthorizationDecisionReferenceSchema)
        .min(1)
        .max(64),
      intent: input.intentSchema,
      authorizedAt: inboxV2TimestampSchema
    })
    .strict()
    .superRefine((command, context) => {
      const epoch = commandAuthorizationEpoch(command.principal);
      const intentContext = input.resolveIntentContext(
        (command as unknown as { intent: z.output<TIntentSchema> }).intent
      );
      const principalMatchesIntent = contextActorMatchesPrincipal(
        intentContext.actor,
        command.principal
      );
      const effectiveEmployeeAuthorizationBoundary =
        command.principal.kind === "employee"
          ? (command.principal.authorization.nextAuthorizationBoundary ??
            command.principal.authorization.notAfter)
          : null;
      const authorizedAtIsValid =
        command.principal.kind !== "employee" ||
        (Date.parse(command.authorizedAt) >=
          Date.parse(command.principal.authorization.evaluatedAt) &&
          Date.parse(command.authorizedAt) <
            Date.parse(effectiveEmployeeAuthorizationBoundary!));
      const hasEveryRequiredDecision =
        intentContext.requiredAuthorizations.length > 0 &&
        intentContext.requiredAuthorizations.every((required) =>
          command.authorizationDecisionRefs.some(
            (decision) =>
              decision.permissionId === required.permissionId &&
              decision.resourceScopeId === required.resourceScopeId &&
              sameValue(decision.resource, required.resource) &&
              decisionPrincipalMatches(decision.principal, command.principal) &&
              (command.principal.kind !== "employee" ||
                command.principal.authorization.dependencies.resourceDependencies.some(
                  (dependency) =>
                    sameValue(dependency.resource, decision.resource) &&
                    dependency.accessRevision ===
                      decision.resourceAccessRevision
                ))
          )
        );
      const everyDecisionIsDeclaredEvidence =
        command.authorizationDecisionRefs.every(
          (decision) =>
            decisionPrincipalMatches(decision.principal, command.principal) &&
            intentContext.requiredAuthorizations.some(
              (required) =>
                decision.permissionId === required.permissionId &&
                decision.resourceScopeId === required.resourceScopeId &&
                sameValue(decision.resource, required.resource)
            ) &&
            (command.principal.kind !== "employee" ||
              command.principal.authorization.dependencies.resourceDependencies.some(
                (dependency) =>
                  sameValue(dependency.resource, decision.resource) &&
                  dependency.accessRevision === decision.resourceAccessRevision
              ))
        );
      const decisionIdsAreUnique =
        new Set(
          command.authorizationDecisionRefs.map((decision) => decision.id)
        ).size === command.authorizationDecisionRefs.length;

      if (
        command.request.commandTypeId !== commandTypeId ||
        command.tenantId !== command.request.tenantId ||
        command.tenantId !== intentContext.tenantId ||
        !principalMatchesIntent ||
        !intentContext.authorizationContextComplete ||
        !authorizedAtIsValid ||
        !hasEveryRequiredDecision ||
        !everyDecisionIsDeclaredEvidence ||
        !decisionIdsAreUnique ||
        (command.principal.kind === "employee" &&
          (command.principal.employee.tenantId !== command.tenantId ||
            command.principal.authorization.tenantId !== command.tenantId ||
            command.principal.authorization.employee.id !==
              command.principal.employee.id)) ||
        command.authorizationDecisionRefs.some(
          (decision) =>
            decision.tenantId !== command.tenantId ||
            decision.authorizationEpoch !== epoch ||
            decision.outcome !== "allowed" ||
            Date.parse(command.authorizedAt) < Date.parse(decision.decidedAt) ||
            Date.parse(command.authorizedAt) >= Date.parse(decision.notAfter) ||
            (effectiveEmployeeAuthorizationBoundary !== null &&
              Date.parse(decision.notAfter) >
                Date.parse(effectiveEmployeeAuthorizationBoundary))
        )
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Authorized command must bind one tenant, principal, epoch, allow decision set and server-stamped intent."
        });
      }
    });

  const envelopeSchema = createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_AUTHORIZED_COMMAND_SCHEMA_ID,
    INBOX_V2_COMMAND_PROTOCOL_SCHEMA_VERSION,
    commandSchema
  );
  return Object.freeze({
    commandSchema,
    envelopeSchema,
    parseEnvelope(value: unknown) {
      return parseInboxV2VersionedEnvelope({
        value,
        schemaId: INBOX_V2_AUTHORIZED_COMMAND_SCHEMA_ID,
        supportedSchemas: {
          [INBOX_V2_COMMAND_PROTOCOL_SCHEMA_VERSION]: envelopeSchema
        },
        invalidErrorCode: "command.envelope_invalid",
        unsupportedErrorCode: "command.schema_unsupported"
      });
    }
  });
}

const inboxV2TimelineAuthorizedCommandContract =
  createInboxV2AuthorizedCommandContract({
    commandTypeId: INBOX_V2_TIMELINE_COMMAND_TYPE_ID,
    intentSchema: inboxV2TimelineCommandIntentEnvelopeSchema,
    resolveIntentContext: (envelope) => {
      const intent = envelope.payload;
      const actor =
        intent.kind === "read_staff_note" ? intent.reader : intent.appActor;
      return {
        tenantId: intent.tenantId,
        authorizationContextComplete:
          isTimelineAuthorizationContextComplete(intent),
        actor:
          actor.kind === "employee"
            ? {
                kind: "employee" as const,
                employee: actor.employee,
                authorizationEpoch: actor.authorizationEpoch
              }
            : {
                kind: "trusted_service" as const,
                trustedServiceId: actor.trustedServiceId
              },
        requiredAuthorizations: requiredAuthorizationsForIntent(intent)
      };
    }
  });

export const inboxV2AuthorizedCommandSchema =
  inboxV2TimelineAuthorizedCommandContract.commandSchema;
export const inboxV2AuthorizedCommandEnvelopeSchema =
  inboxV2TimelineAuthorizedCommandContract.envelopeSchema;

export const inboxV2CommandCommitReferenceSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    streamEpoch: inboxV2StreamEpochSchema,
    commitId: inboxV2TenantStreamCommitIdSchema,
    streamPosition: inboxV2TenantStreamCommitPositionSchema
  })
  .strict();

const commandResultBaseFields = {
  tenantId: inboxV2TenantIdSchema,
  commandId: inboxV2CommandIdSchema,
  principal: inboxV2CommandPrincipalIdentitySchema,
  clientMutationId: inboxV2ClientMutationIdSchema,
  requestHash: inboxV2Sha256DigestSchema,
  authorizationEpoch: inboxV2AuthorizationEpochSchema,
  recordedAt: inboxV2TimestampSchema
} as const;

export const inboxV2CommandResultSchema = z
  .discriminatedUnion("kind", [
    z
      .object({
        ...commandResultBaseFields,
        kind: z.literal("committed"),
        commit: inboxV2CommandCommitReferenceSchema,
        resultReference: inboxV2PayloadReferenceSchema.nullable()
      })
      .strict(),
    z
      .object({
        ...commandResultBaseFields,
        kind: z.literal("no_op"),
        commit: z.null(),
        resultReference: inboxV2PayloadReferenceSchema.nullable()
      })
      .strict(),
    z
      .object({
        ...commandResultBaseFields,
        kind: z.literal("rejected"),
        commit: z.null(),
        errorCode: inboxV2NamespacedIdSchema,
        resultReference: z.null()
      })
      .strict()
  ])
  .superRefine((result, context) => {
    if (
      (result.principal.kind === "employee" &&
        result.principal.employee.tenantId !== result.tenantId) ||
      (result.resultReference !== null &&
        result.resultReference.tenantId !== result.tenantId) ||
      (result.kind === "committed" &&
        result.commit.tenantId !== result.tenantId)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Command result principal, payload reference and commit must belong to the result tenant."
      });
    }
  });

export const inboxV2CommandResultEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_COMMAND_RESULT_SCHEMA_ID,
    INBOX_V2_COMMAND_PROTOCOL_SCHEMA_VERSION,
    inboxV2CommandResultSchema
  );

export function parseInboxV2AuthorizedCommandEnvelope(input: unknown) {
  return inboxV2TimelineAuthorizedCommandContract.parseEnvelope(input);
}

export function parseInboxV2CommandResultEnvelope(input: unknown) {
  return parseInboxV2VersionedEnvelope({
    value: input,
    schemaId: INBOX_V2_COMMAND_RESULT_SCHEMA_ID,
    supportedSchemas: {
      [INBOX_V2_COMMAND_PROTOCOL_SCHEMA_VERSION]:
        inboxV2CommandResultEnvelopeSchema
    },
    invalidErrorCode: "command.envelope_invalid",
    unsupportedErrorCode: "command.schema_unsupported"
  });
}

export const inboxV2CommandIdempotencyScopeSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    principal: inboxV2CommandPrincipalIdentitySchema,
    commandTypeId: inboxV2CatalogIdSchema,
    clientMutationId: inboxV2ClientMutationIdSchema
  })
  .strict()
  .superRefine((scope, context) => {
    if (
      scope.principal.kind === "employee" &&
      scope.principal.employee.tenantId !== scope.tenantId
    ) {
      context.addIssue({
        code: "custom",
        path: ["principal"],
        message: "Idempotency principal must belong to the scope tenant."
      });
    }
  });

export const inboxV2CommandIdempotencyRecordSchema = z
  .object({
    scope: inboxV2CommandIdempotencyScopeSchema,
    commandId: inboxV2CommandIdSchema,
    firstRequestId: inboxV2RequestIdSchema,
    requestHash: inboxV2Sha256DigestSchema,
    state: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("executing") }).strict(),
      z
        .object({
          kind: z.literal("completed"),
          result: inboxV2CommandResultSchema,
          authorizationDecisionRefs: z
            .array(inboxV2AuthorizationDecisionReferenceSchema)
            .min(1)
            .max(64)
            .optional(),
          authorizedAt: inboxV2TimestampSchema.optional(),
          authorizationNotAfter: inboxV2TimestampSchema.optional()
        })
        .strict()
    ])
  })
  .strict()
  .superRefine((record, context) => {
    const completedState =
      record.state.kind === "completed" ? record.state : null;
    const hasCompleteAuthorizationEvidence =
      completedState !== null &&
      completedState.authorizationDecisionRefs !== undefined &&
      completedState.authorizedAt !== undefined &&
      completedState.authorizationNotAfter !== undefined;
    if (
      completedState !== null &&
      (completedState.result.tenantId !== record.scope.tenantId ||
        completedState.result.commandId !== record.commandId ||
        completedState.result.clientMutationId !==
          record.scope.clientMutationId ||
        completedState.result.requestHash !== record.requestHash ||
        !sameValue(completedState.result.principal, record.scope.principal))
    ) {
      context.addIssue({
        code: "custom",
        path: ["state", "result"],
        message:
          "Stored idempotent result must match its exact tenant, command, mutation and request hash."
      });
    }
    if (
      completedState !== null &&
      (completedState.authorizationDecisionRefs !== undefined ||
        completedState.authorizedAt !== undefined ||
        completedState.authorizationNotAfter !== undefined) &&
      !hasCompleteAuthorizationEvidence
    ) {
      context.addIssue({
        code: "custom",
        path: ["state", "authorizationDecisionRefs"],
        message:
          "Stored command authorization evidence is all-or-none and includes its effective temporal boundary."
      });
    }
    if (
      completedState !== null &&
      hasCompleteAuthorizationEvidence &&
      (new Set(
        completedState.authorizationDecisionRefs!.map((decision) => decision.id)
      ).size !== completedState.authorizationDecisionRefs!.length ||
        Date.parse(completedState.authorizedAt!) >=
          Date.parse(completedState.authorizationNotAfter!) ||
        completedState.authorizationDecisionRefs!.some(
          (decision) =>
            decision.tenantId !== record.scope.tenantId ||
            decision.authorizationEpoch !==
              completedState.result.authorizationEpoch ||
            decision.outcome !== "allowed" ||
            !sameValue(decision.principal, record.scope.principal) ||
            Date.parse(decision.decidedAt) >
              Date.parse(completedState.authorizedAt!) ||
            Date.parse(completedState.authorizedAt!) >=
              Date.parse(decision.notAfter) ||
            Date.parse(completedState.authorizationNotAfter!) >
              Date.parse(decision.notAfter)
        ))
    ) {
      context.addIssue({
        code: "custom",
        path: ["state", "authorizationDecisionRefs"],
        message:
          "Stored command authorization evidence must be the exact unique allowed principal/epoch set."
      });
    }
  });

export const inboxV2CommandIdempotencyDecisionSchema = z.discriminatedUnion(
  "kind",
  [
    z.object({ kind: z.literal("execute") }).strict(),
    z.object({ kind: z.literal("await_existing") }).strict(),
    z
      .object({
        kind: z.literal("replay"),
        result: inboxV2CommandResultSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("conflict"),
        errorCode: z.literal("command.idempotency_conflict")
      })
      .strict()
  ]
);

export function decideInboxV2CommandIdempotency(input: {
  scope: z.input<typeof inboxV2CommandIdempotencyScopeSchema>;
  requestHash: z.input<typeof inboxV2Sha256DigestSchema>;
  existing: z.input<typeof inboxV2CommandIdempotencyRecordSchema> | null;
}): z.infer<typeof inboxV2CommandIdempotencyDecisionSchema> {
  const scope = inboxV2CommandIdempotencyScopeSchema.parse(input.scope);
  const requestHash = inboxV2Sha256DigestSchema.parse(input.requestHash);

  if (input.existing === null) {
    return { kind: "execute" };
  }

  const existing = inboxV2CommandIdempotencyRecordSchema.parse(input.existing);
  if (!sameValue(existing.scope, scope)) {
    return { kind: "execute" };
  }
  if (existing.requestHash !== requestHash) {
    return {
      kind: "conflict",
      errorCode: "command.idempotency_conflict"
    };
  }

  return existing.state.kind === "executing"
    ? { kind: "await_existing" }
    : { kind: "replay", result: existing.state.result };
}

type InboxV2RequiredAuthorization = Readonly<{
  permissionId: string;
  resourceScopeId: string;
  resource: Readonly<{
    tenantId: string;
    entityTypeId: string;
    entityId: string;
  }>;
}>;

function requiredAuthorizationsForIntent(
  intent: InboxV2TimelineCommandIntent
): readonly InboxV2RequiredAuthorization[] {
  const conversation = {
    tenantId: intent.conversation.tenantId,
    entityTypeId: "core:conversation",
    entityId: intent.conversation.id
  };
  const required: InboxV2RequiredAuthorization[] = [
    {
      permissionId: conversationReadPermissionForIntent(intent),
      resourceScopeId: "core:conversation",
      resource: conversation
    },
    requiredActionAuthorizationForIntent(intent)
  ];
  if (intent.kind === "forward_content_copy") {
    for (const source of intent.sourceReadProofs ?? []) {
      required.push({
        permissionId:
          source.visibilityBoundary === "internal"
            ? "core:conversation.internal.read"
            : "core:conversation.read",
        resourceScopeId: "core:conversation",
        resource: {
          tenantId: source.conversation.tenantId,
          entityTypeId: "core:conversation",
          entityId: source.conversation.id
        }
      });
    }
  }
  if (intent.kind === "forward_provider_native") {
    for (const source of intent.sourceReadProofs ?? []) {
      required.push(
        {
          permissionId: "core:conversation.read",
          resourceScopeId: "core:conversation",
          resource: {
            tenantId: source.conversation.tenantId,
            entityTypeId: "core:conversation",
            entityId: source.conversation.id
          }
        },
        {
          permissionId: "core:source_account.use",
          resourceScopeId: "core:source-account",
          resource: {
            tenantId: source.sourceAccount.tenantId,
            entityTypeId: "core:source-account",
            entityId: source.sourceAccount.id
          }
        }
      );
    }
  }
  const routeAuthorization = routeAuthorizationForIntent(intent);
  if (routeAuthorization !== undefined) {
    required.push({
      permissionId: "core:source_account.use",
      resourceScopeId: "core:source-account",
      resource: {
        tenantId: routeAuthorization.sourceAccount.tenantId,
        entityTypeId: "core:source-account",
        entityId: routeAuthorization.sourceAccount.id
      }
    });
  }
  const fileReadProofs = fileReadProofsForIntent(intent);
  if (intent.kind === "edit_message" && fileReadProofs.length > 0) {
    // Editing content establishes a new live File parent just like the
    // corresponding send path. Keep that destination authority separate from
    // the lifecycle edit action and let the exact-requirement map deduplicate
    // the Conversation read already required above.
    required.push(
      {
        permissionId: conversationReadPermissionForIntent(intent),
        resourceScopeId: "core:conversation",
        resource: conversation
      },
      {
        permissionId:
          intent.transport.kind === "internal"
            ? "core:message.send_internal"
            : "core:message.reply_external",
        resourceScopeId: "core:conversation",
        resource: conversation
      }
    );
  }
  for (const proof of fileReadProofs) {
    const fileResource = {
      tenantId: proof.file.tenantId,
      entityTypeId: "core:file",
      entityId: proof.file.id
    };
    required.push({
      permissionId: "core:file.view",
      resourceScopeId: "core:file",
      resource: fileResource
    });
    if (proof.sourceParent.kind === "upload_staging") {
      required.push({
        permissionId: "core:file.upload",
        resourceScopeId: "core:file",
        resource: fileResource
      });
    } else {
      const sourceConversation = {
        tenantId: proof.sourceParent.conversation.tenantId,
        entityTypeId: "core:conversation",
        entityId: proof.sourceParent.conversation.id
      };
      required.push({
        permissionId:
          (proof.sourceParent.kind === "message" &&
            proof.sourceParent.visibilityBoundary === "internal") ||
          (proof.sourceParent.kind === "staff_note" &&
            proof.sourceParent.parentConversationVisibility === "internal")
            ? "core:conversation.internal.read"
            : "core:conversation.read",
        resourceScopeId: "core:conversation",
        resource: sourceConversation
      });
      if (proof.sourceParent.kind === "staff_note") {
        required.push({
          permissionId: "core:message.staff_note.read",
          resourceScopeId: "core:conversation",
          resource: sourceConversation
        });
      }
    }
  }
  const replyAuthority = replyAuthorityForIntent(intent);
  if (replyAuthority !== undefined && replyAuthority.kind !== "no_work_item") {
    required.push({
      permissionId: "core:work.read",
      resourceScopeId: "core:work-item",
      resource: {
        tenantId: replyAuthority.workItem.tenantId,
        entityTypeId: "core:work-item",
        entityId: replyAuthority.workItem.id
      }
    });
    if (replyAuthority.kind === "supervisor_override") {
      required.push({
        permissionId: "core:work.override",
        resourceScopeId: "core:work-item",
        resource: {
          tenantId: replyAuthority.workItem.tenantId,
          entityTypeId: "core:work-item",
          entityId: replyAuthority.workItem.id
        }
      });
    }
  }
  const unique = new Map(
    required.map((requirement) => [
      `${requirement.permissionId}\u0000${requirement.resourceScopeId}\u0000${requirement.resource.tenantId}\u0000${requirement.resource.entityTypeId}\u0000${requirement.resource.entityId}`,
      requirement
    ])
  );
  return [...unique.values()];
}

function conversationReadPermissionForIntent(
  intent: InboxV2TimelineCommandIntent
): "core:conversation.read" | "core:conversation.internal.read" {
  const internal =
    intent.kind === "send_internal" ||
    (intent.kind === "create_staff_note" &&
      intent.parentConversationVisibility === "internal") ||
    (intent.kind === "read_staff_note" &&
      intent.readProof?.parentConversationVisibility === "internal") ||
    (intent.kind === "edit_message" && intent.transport.kind === "internal") ||
    (intent.kind === "delete_message_local" &&
      intent.visibilityBoundary === "internal") ||
    (intent.kind === "forward_content_copy" &&
      intent.destination.kind === "internal") ||
    (intent.kind === "reaction_set" && intent.target.kind === "internal") ||
    ((intent.kind === "reaction_replace" || intent.kind === "reaction_clear") &&
      intent.target.kind === "internal");
  return internal
    ? "core:conversation.internal.read"
    : "core:conversation.read";
}

function isTimelineAuthorizationContextComplete(
  intent: InboxV2TimelineCommandIntent
): boolean {
  if (
    intent.kind === "delete_message_local" &&
    intent.visibilityBoundary === undefined
  ) {
    return false;
  }
  if (
    intent.kind === "forward_content_copy" &&
    (intent.referenceContext.kind !== "forward_content_copy" ||
      intent.sourceReadProofs === undefined)
  ) {
    return false;
  }
  if (
    intent.kind === "forward_provider_native" &&
    (intent.referenceContext.kind !== "forward_provider_native" ||
      intent.sourceReadProofs === undefined)
  ) {
    return false;
  }
  if (
    requiresExternalReplyAuthority(intent) &&
    replyAuthorityForIntent(intent) === undefined
  ) {
    return false;
  }
  if (
    (intent.kind === "edit_message" ||
      intent.kind === "delete_message_local" ||
      intent.kind === "delete_message_provider") &&
    intent.mutationAuthority === undefined
  ) {
    return false;
  }
  if (intent.kind === "read_staff_note" && intent.readProof === undefined) {
    return false;
  }
  if (
    intent.kind === "create_staff_note" &&
    intent.parentConversationVisibility === undefined
  ) {
    return false;
  }
  if (
    (intent.kind === "reaction_set" ||
      intent.kind === "reaction_replace" ||
      intent.kind === "reaction_clear") &&
    intent.targetProof === undefined
  ) {
    return false;
  }
  if (
    intent.kind === "reaction_set" &&
    intent.expectedMessageRevision === undefined
  ) {
    return false;
  }
  if (
    requiresProviderRoute(intent) &&
    routeAuthorizationForIntent(intent) === undefined
  ) {
    return false;
  }
  const content = contentForIntent(intent);
  if (
    content !== null &&
    content.blocks.some(
      (block) =>
        ("attachment" in block && block.attachment.state === "ready") ||
        block.kind === "extension"
    ) &&
    fileReadProofsForIntent(intent).length === 0
  ) {
    return false;
  }
  return true;
}

function routeAuthorizationForIntent(intent: InboxV2TimelineCommandIntent) {
  switch (intent.kind) {
    case "send_external":
    case "reply_external":
    case "delete_message_provider":
    case "forward_provider_native":
      return intent.routeAuthorization;
    case "edit_message":
      return intent.transport.kind === "external"
        ? intent.transport.routeAuthorization
        : undefined;
    case "forward_content_copy":
      return intent.destination.kind === "external"
        ? intent.destination.routeAuthorization
        : undefined;
    case "reaction_set":
    case "reaction_replace":
    case "reaction_clear":
      return intent.target.kind === "external"
        ? intent.target.routeAuthorization
        : undefined;
    default:
      return undefined;
  }
}

function requiresProviderRoute(intent: InboxV2TimelineCommandIntent): boolean {
  switch (intent.kind) {
    case "send_external":
    case "reply_external":
    case "delete_message_provider":
    case "forward_provider_native":
      return true;
    case "edit_message":
      return intent.transport.kind === "external";
    case "forward_content_copy":
      return intent.destination.kind === "external";
    case "reaction_set":
    case "reaction_replace":
    case "reaction_clear":
      return intent.target.kind === "external";
    default:
      return false;
  }
}

function replyAuthorityForIntent(intent: InboxV2TimelineCommandIntent) {
  switch (intent.kind) {
    case "send_external":
    case "reply_external":
    case "forward_provider_native":
      return intent.replyAuthority;
    case "forward_content_copy":
      return intent.destination.kind === "external"
        ? intent.replyAuthority
        : undefined;
    default:
      return undefined;
  }
}

function requiresExternalReplyAuthority(
  intent: InboxV2TimelineCommandIntent
): boolean {
  return (
    intent.kind === "send_external" ||
    intent.kind === "reply_external" ||
    intent.kind === "forward_provider_native" ||
    (intent.kind === "forward_content_copy" &&
      intent.destination.kind === "external")
  );
}

function fileReadProofsForIntent(intent: InboxV2TimelineCommandIntent) {
  switch (intent.kind) {
    case "send_external":
    case "reply_external":
    case "send_internal":
    case "create_staff_note":
    case "edit_message":
    case "forward_content_copy":
      return intent.fileReadProofs ?? [];
    default:
      return [];
  }
}

function contentForIntent(intent: InboxV2TimelineCommandIntent) {
  switch (intent.kind) {
    case "send_external":
    case "reply_external":
    case "send_internal":
    case "create_staff_note":
    case "edit_message":
    case "forward_content_copy":
      return intent.content;
    default:
      return null;
  }
}

function requiredActionAuthorizationForIntent(
  intent: InboxV2TimelineCommandIntent
): InboxV2RequiredAuthorization {
  const conversationResource = {
    tenantId: intent.conversation.tenantId,
    entityTypeId: "core:conversation",
    entityId: intent.conversation.id
  };
  switch (intent.kind) {
    case "send_external":
      return {
        permissionId: "core:message.reply_external",
        resourceScopeId: "core:conversation",
        resource: conversationResource
      };
    case "reply_external":
      return {
        permissionId: "core:message.reply_external",
        resourceScopeId: "core:conversation",
        resource: conversationResource
      };
    case "send_internal":
      return {
        permissionId: "core:message.send_internal",
        resourceScopeId: "core:conversation",
        resource: conversationResource
      };
    case "create_staff_note":
      return {
        permissionId: "core:message.staff_note.create",
        resourceScopeId: "core:conversation",
        resource: conversationResource
      };
    case "read_staff_note":
      return {
        permissionId: "core:message.staff_note.read",
        resourceScopeId: "core:conversation",
        resource: conversationResource
      };
    case "edit_message":
      return lifecycleActionAuthorization(
        intent,
        intent.mutationAuthority?.kind === "moderate_external"
          ? "core:message.moderate_external"
          : intent.mutationAuthority?.kind === "moderate_internal"
            ? "core:message.moderate_internal"
            : "core:message.edit_own",
        conversationResource
      );
    case "delete_message_local":
    case "delete_message_provider":
      return lifecycleActionAuthorization(
        intent,
        intent.mutationAuthority?.kind === "moderate_external"
          ? "core:message.moderate_external"
          : intent.mutationAuthority?.kind === "moderate_internal"
            ? "core:message.moderate_internal"
            : "core:message.delete_own",
        conversationResource
      );
    case "forward_content_copy":
      return {
        permissionId:
          intent.destination.kind === "external"
            ? "core:message.forward_external"
            : "core:message.send_internal",
        resourceScopeId: "core:conversation",
        resource: conversationResource
      };
    case "forward_provider_native":
      return {
        permissionId: "core:message.forward_external",
        resourceScopeId: "core:conversation",
        resource: conversationResource
      };
    case "reaction_set":
    case "reaction_replace":
    case "reaction_clear":
      return reactionActionAuthorization(intent, conversationResource);
  }
}

function reactionActionAuthorization(
  intent: Extract<
    InboxV2TimelineCommandIntent,
    { kind: "reaction_set" | "reaction_replace" | "reaction_clear" }
  >,
  conversationResource: InboxV2RequiredAuthorization["resource"]
): InboxV2RequiredAuthorization {
  const targetProof = intent.targetProof;
  if (targetProof === undefined) {
    // Incomplete trusted-resolution input is rejected by
    // isTimelineAuthorizationContextComplete. Do not manufacture an
    // untrusted TimelineItem identifier while keeping this function total.
    return {
      permissionId: "core:message.react",
      resourceScopeId: "core:conversation",
      resource: conversationResource
    };
  }
  return {
    permissionId: "core:message.react",
    resourceScopeId: "core:timeline-item",
    resource: {
      tenantId: targetProof.timelineItem.tenantId,
      entityTypeId: "core:timeline-item",
      entityId: targetProof.timelineItem.id
    }
  };
}

function lifecycleActionAuthorization(
  intent: Extract<
    InboxV2TimelineCommandIntent,
    {
      kind: "edit_message" | "delete_message_local" | "delete_message_provider";
    }
  >,
  permissionId: string,
  conversationResource: InboxV2RequiredAuthorization["resource"]
): InboxV2RequiredAuthorization {
  const authority = intent.mutationAuthority;
  if (authority === undefined || authority.kind === "moderate_internal") {
    // An incomplete lifecycle intent is rejected separately. Keeping the
    // fallback total avoids manufacturing an untrusted TimelineItem ID.
    return {
      permissionId,
      resourceScopeId: "core:conversation",
      resource: conversationResource
    };
  }
  return {
    permissionId,
    resourceScopeId: "core:timeline-item",
    resource: {
      tenantId: authority.timelineItem.tenantId,
      entityTypeId: "core:timeline-item",
      entityId: authority.timelineItem.id
    }
  };
}

function decisionPrincipalMatches(
  decisionPrincipal: z.infer<
    typeof inboxV2AuthorizationDecisionReferenceSchema
  >["principal"],
  commandPrincipal: z.infer<typeof inboxV2CommandPrincipalSchema>
): boolean {
  if (decisionPrincipal.kind !== commandPrincipal.kind) {
    return false;
  }
  return decisionPrincipal.kind === "employee" &&
    commandPrincipal.kind === "employee"
    ? decisionPrincipal.employee.id === commandPrincipal.employee.id
    : decisionPrincipal.kind === "trusted_service" &&
        commandPrincipal.kind === "trusted_service" &&
        decisionPrincipal.trustedServiceId ===
          commandPrincipal.trustedServiceId;
}

export function discloseInboxV2CommandResult(input: {
  result: z.input<typeof inboxV2CommandResultSchema>;
  tenantId: string;
  principal: z.input<typeof inboxV2CommandPrincipalIdentitySchema>;
  currentAuthorizationEpoch: string;
  mayReadResult: boolean;
}):
  | Readonly<{
      kind: "authorized";
      result: z.infer<typeof inboxV2CommandResultSchema>;
    }>
  | Readonly<{
      kind: "status_only";
      status: "committed" | "no_op" | "rejected";
      commandId: string;
    }>
  | Readonly<{ kind: "not_found" }> {
  const result = inboxV2CommandResultSchema.parse(input.result);
  const principal = inboxV2CommandPrincipalIdentitySchema.parse(
    input.principal
  );
  if (
    result.tenantId !== input.tenantId ||
    !sameValue(result.principal, principal)
  ) {
    return { kind: "not_found" };
  }
  if (
    input.mayReadResult &&
    result.authorizationEpoch === input.currentAuthorizationEpoch
  ) {
    return { kind: "authorized", result };
  }

  return {
    kind: "status_only",
    status: result.kind,
    commandId: result.commandId
  };
}

function commandAuthorizationEpoch(
  principal: z.infer<typeof inboxV2CommandPrincipalSchema>
): string {
  return principal.kind === "employee"
    ? principal.authorization.value
    : principal.authorizationEpoch;
}

function contextActorMatchesPrincipal(
  actor: InboxV2AuthorizedIntentContext["actor"],
  principal: z.infer<typeof inboxV2CommandPrincipalSchema>
): boolean {
  if (actor.kind !== principal.kind) {
    return false;
  }

  return principal.kind === "employee" && actor.kind === "employee"
    ? actor.employee.id === principal.employee.id &&
        actor.authorizationEpoch === principal.authorization.value
    : principal.kind === "trusted_service" &&
        actor.kind === "trusted_service" &&
        actor.trustedServiceId === principal.trustedServiceId;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export type InboxV2CommandPrincipal = z.infer<
  typeof inboxV2CommandPrincipalSchema
>;
export type InboxV2CommandRequestIdentity = z.infer<
  typeof inboxV2CommandRequestIdentitySchema
>;
export type InboxV2AuthorizedCommand = z.infer<
  typeof inboxV2AuthorizedCommandSchema
>;
export type InboxV2CommandResult = z.infer<typeof inboxV2CommandResultSchema>;
export type InboxV2CommandIdempotencyRecord = z.infer<
  typeof inboxV2CommandIdempotencyRecordSchema
>;
