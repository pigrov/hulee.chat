import { z } from "zod";

import {
  inboxV2EntityRevisionSchema,
  inboxV2TimestampSchema,
  isInboxV2TimestampOrderValid
} from "./entity-metadata";
import { inboxV2TenantIdSchema } from "./ids";
import {
  createInboxV2SchemaEnvelopeSchema,
  INBOX_V2_INITIAL_SCHEMA_VERSION
} from "./schema-version";
import { inboxV2RoutingTokenSchema } from "./source-routing-primitives";
import { inboxV2SourceThreadBindingTransitionActorSchema } from "./source-thread-binding";
import { inboxV2SourceRegistryLifecycleLocatorSchema } from "./source-registry-lifecycle";
import {
  inboxV2SourceAccountRegistryStateSchema,
  inboxV2SourceConnectionRegistryStateSchema,
  inboxV2SourceRegistryRelatedAuthorityReferenceSchema,
  isInboxV2SourceAccountRegistryState,
  isInboxV2SourceConnectionRegistryState,
  type InboxV2SourceRegistryState
} from "./source-registry-state";

export const INBOX_V2_SOURCE_REGISTRY_TRANSITION_SCHEMA_ID =
  "core:inbox-v2.source-registry-transition" as const;
export const INBOX_V2_SOURCE_REGISTRY_TRANSITION_SCHEMA_VERSION =
  INBOX_V2_INITIAL_SCHEMA_VERSION;

export const inboxV2SourceRegistryTransitionIntentSchema = z.enum([
  "create",
  "enable",
  "disable",
  "degrade",
  "recover",
  "reconnect",
  "replace",
  "delete",
  "update_metadata"
]);

export const inboxV2SourceRegistryStateSchema = z.discriminatedUnion(
  "schemaId",
  [
    inboxV2SourceConnectionRegistryStateSchema,
    inboxV2SourceAccountRegistryStateSchema
  ]
);

export const inboxV2SourceRegistryRelatedAuthorityTransitionSchema = z
  .object({
    transitionId: inboxV2RoutingTokenSchema,
    intent: z.enum(["create", "advance", "revoke"]),
    expectedRevision: inboxV2EntityRevisionSchema.nullable(),
    resultingRevision: inboxV2EntityRevisionSchema,
    previous: inboxV2SourceRegistryRelatedAuthorityReferenceSchema.nullable(),
    resulting: inboxV2SourceRegistryRelatedAuthorityReferenceSchema
  })
  .strict()
  .superRefine((transition, context) => {
    if (transition.previous === null) {
      if (
        transition.intent !== "create" ||
        transition.expectedRevision !== null ||
        transition.resultingRevision !== "1" ||
        transition.resulting.revision !== "1"
      ) {
        addIssue(
          context,
          [],
          "Related-authority create must establish revision 1 without a previous head."
        );
      }
      return;
    }
    if (transition.intent === "create") {
      addIssue(
        context,
        ["intent"],
        "Related-authority create cannot replace an existing head."
      );
    }
    if (
      transition.expectedRevision !== transition.previous.revision ||
      transition.resultingRevision !== transition.resulting.revision ||
      incrementRevision(transition.previous.revision) !==
        transition.resulting.revision
    ) {
      addIssue(
        context,
        ["expectedRevision"],
        "Related-authority transition must CAS and advance its revision exactly once."
      );
    }
    if (
      relatedAuthorityKey(transition.previous) !==
      relatedAuthorityKey(transition.resulting)
    ) {
      addIssue(
        context,
        ["resulting"],
        "Related-authority transition cannot change kind or authority identity."
      );
    }
    if (
      transition.previous.tenantId !== transition.resulting.tenantId ||
      transition.previous.sourceConnection.id !==
        transition.resulting.sourceConnection.id ||
      !sameJson(
        transition.previous.sourceAccount,
        transition.resulting.sourceAccount
      )
    ) {
      addIssue(
        context,
        ["resulting"],
        "Related-authority transition cannot change tenant or source parents."
      );
    }
    if (
      transition.intent === "revoke" &&
      transition.resulting.status !== "revoked"
    ) {
      addIssue(
        context,
        ["resulting", "status"],
        "Related-authority revoke must produce a revoked head."
      );
    }
  });

const inboxV2SourceRegistryTransitionCasSchema = z
  .object({
    expectedRevision: inboxV2EntityRevisionSchema.nullable(),
    expectedRouteGeneration: inboxV2EntityRevisionSchema.nullable(),
    resultingRevision: inboxV2EntityRevisionSchema,
    resultingRouteGeneration: inboxV2EntityRevisionSchema
  })
  .strict();

const sourceRegistryTransitionPayloadSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    transitionId: inboxV2RoutingTokenSchema,
    entityKind: z.enum(["source_connection", "source_account"]),
    intent: inboxV2SourceRegistryTransitionIntentSchema,
    cas: inboxV2SourceRegistryTransitionCasSchema,
    lifecycle: inboxV2SourceRegistryLifecycleLocatorSchema,
    previousState: inboxV2SourceRegistryStateSchema.nullable(),
    resultingState: inboxV2SourceRegistryStateSchema,
    relatedAuthorityTransitions: z
      .array(inboxV2SourceRegistryRelatedAuthorityTransitionSchema)
      .max(10_000),
    actor: inboxV2SourceThreadBindingTransitionActorSchema,
    committedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((transition, context) => {
    addTransitionIssues(transition, context);
  });

export const inboxV2SourceRegistryTransitionSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_SOURCE_REGISTRY_TRANSITION_SCHEMA_ID,
    INBOX_V2_SOURCE_REGISTRY_TRANSITION_SCHEMA_VERSION,
    sourceRegistryTransitionPayloadSchema
  );

export type InboxV2SourceRegistryTransitionIntent = z.infer<
  typeof inboxV2SourceRegistryTransitionIntentSchema
>;
export type InboxV2SourceRegistryTransition = Readonly<
  z.infer<typeof inboxV2SourceRegistryTransitionSchema>
>;

const definedSourceRegistryTransitions = new WeakSet<object>();

export function isInboxV2SourceRegistryTransition(
  value: unknown
): value is InboxV2SourceRegistryTransition {
  return (
    typeof value === "object" &&
    value !== null &&
    definedSourceRegistryTransitions.has(value)
  );
}

/**
 * Creates immutable transition authority only from authentic state heads. A
 * schema-valid clone cannot be substituted for the state accepted by the CAS.
 */
export function defineInboxV2SourceRegistryTransition(input: {
  value: z.input<typeof inboxV2SourceRegistryTransitionSchema>;
}): InboxV2SourceRegistryTransition {
  const previous = input.value.payload.previousState;
  const resulting = input.value.payload.resultingState;
  if (previous !== null && !isAuthenticState(previous)) {
    throw new Error(
      "Source-registry transition previousState must be an authentic registry state."
    );
  }
  if (!isAuthenticState(resulting)) {
    throw new Error(
      "Source-registry transition resultingState must be an authentic registry state."
    );
  }

  const parsed = inboxV2SourceRegistryTransitionSchema.parse(input.value);
  const frozen = cloneAndFreeze(parsed);
  definedSourceRegistryTransitions.add(frozen as object);
  return frozen;
}

function addTransitionIssues(
  transition: z.output<typeof sourceRegistryTransitionPayloadSchema>,
  context: z.RefinementCtx
): void {
  const previous = transition.previousState?.payload ?? null;
  const resulting = transition.resultingState.payload;

  if (
    transition.entityKind !== resulting.entityKind ||
    (previous !== null && transition.entityKind !== previous.entityKind)
  ) {
    addIssue(
      context,
      ["entityKind"],
      "Transition entity kind must match both registry states."
    );
  }
  if (resulting.tenantId !== transition.tenantId) {
    addIssue(
      context,
      ["resultingState", "payload", "tenantId"],
      "Source-registry transition crosses tenant boundary."
    );
  }
  if (
    transition.actor.kind === "employee" &&
    transition.actor.employee.tenantId !== transition.tenantId
  ) {
    addIssue(
      context,
      ["actor", "employee"],
      "Source-registry transition actor crosses tenant boundary."
    );
  }
  if (!sameJson(transition.lifecycle, resulting.lifecycle)) {
    addIssue(
      context,
      ["lifecycle"],
      "Transition lifecycle lineage must equal the resulting registry head lineage."
    );
  }
  addRelatedAuthorityTransitionIssues(transition, context);
  if (previous !== null && previous.tenantId !== transition.tenantId) {
    addIssue(
      context,
      ["previousState", "payload", "tenantId"],
      "Source-registry transition previous state crosses tenant boundary."
    );
  }
  if (resulting.updatedAt !== transition.committedAt) {
    addIssue(
      context,
      ["committedAt"],
      "Transition commit time must equal the resulting state update time."
    );
  }

  if (transition.intent === "create") {
    addCreateIssues(transition, resulting, context);
    return;
  }
  if (previous === null) {
    addIssue(
      context,
      ["previousState"],
      "Only create may omit the previous registry state."
    );
    return;
  }

  addExistingEntityIssues(transition, previous, resulting, context);
}

function addRelatedAuthorityTransitionIssues(
  transition: z.output<typeof sourceRegistryTransitionPayloadSchema>,
  context: z.RefinementCtx
): void {
  const previousAuthorities =
    transition.previousState?.payload.relatedAuthorities ?? [];
  const resultingAuthorities =
    transition.resultingState.payload.relatedAuthorities;
  const transitions = new Map<
    string,
    (typeof transition.relatedAuthorityTransitions)[number]
  >();
  for (const [
    index,
    relatedTransition
  ] of transition.relatedAuthorityTransitions.entries()) {
    const key = relatedAuthorityKey(relatedTransition.resulting);
    if (transitions.has(key)) {
      addIssue(
        context,
        ["relatedAuthorityTransitions", index],
        "Duplicate related-authority transition."
      );
    }
    transitions.set(key, relatedTransition);
    if (relatedTransition.resulting.tenantId !== transition.tenantId) {
      addIssue(
        context,
        ["relatedAuthorityTransitions", index, "resulting", "tenantId"],
        "Related-authority transition crosses tenant authority."
      );
    }
  }

  const previousByKey = new Map(
    previousAuthorities.map((authority) => [
      relatedAuthorityKey(authority),
      authority
    ])
  );
  const resultingByKey = new Map(
    resultingAuthorities.map((authority) => [
      relatedAuthorityKey(authority),
      authority
    ])
  );
  for (const [key, resulting] of resultingByKey) {
    const previous = previousByKey.get(key) ?? null;
    if (sameJson(previous, resulting)) {
      if (transitions.has(key)) {
        addIssue(
          context,
          ["relatedAuthorityTransitions"],
          "Unchanged related authority cannot have a synthetic transition."
        );
      }
      continue;
    }
    const relatedTransition = transitions.get(key);
    if (
      relatedTransition === undefined ||
      !sameJson(relatedTransition.previous, previous) ||
      !sameJson(relatedTransition.resulting, resulting)
    ) {
      addIssue(
        context,
        ["relatedAuthorityTransitions"],
        "Every changed related-authority head requires its exact nested CAS transition."
      );
    }
  }
  for (const key of previousByKey.keys()) {
    if (!resultingByKey.has(key)) {
      addIssue(
        context,
        ["resultingState", "payload", "relatedAuthorities"],
        "Related-authority history cannot be removed; retain a revoked head."
      );
    }
  }
  for (const key of transitions.keys()) {
    if (!resultingByKey.has(key)) {
      addIssue(
        context,
        ["relatedAuthorityTransitions"],
        "Nested related-authority transition must materialize in the resulting head."
      );
    }
  }
}

function addCreateIssues(
  transition: z.output<typeof sourceRegistryTransitionPayloadSchema>,
  resulting: z.output<
    typeof sourceRegistryTransitionPayloadSchema
  >["resultingState"]["payload"],
  context: z.RefinementCtx
): void {
  if (transition.previousState !== null) {
    addIssue(
      context,
      ["previousState"],
      "Create cannot replace an existing head."
    );
  }
  if (
    transition.cas.expectedRevision !== null ||
    transition.cas.expectedRouteGeneration !== null
  ) {
    addIssue(
      context,
      ["cas"],
      "Create CAS must expect no existing revision or route generation."
    );
  }
  if (
    resulting.revision !== "1" ||
    resulting.routeAuthority.generation !== "1" ||
    transition.cas.resultingRevision !== "1" ||
    transition.cas.resultingRouteGeneration !== "1"
  ) {
    addIssue(
      context,
      ["cas"],
      "Create must establish revision and route generation 1."
    );
  }
  if (
    resulting.status !== "pending" ||
    resulting.routeAuthority.state !== "denied"
  ) {
    addIssue(
      context,
      ["resultingState", "payload"],
      "Create must start pending and fail-closed."
    );
  }
}

function addExistingEntityIssues(
  transition: z.output<typeof sourceRegistryTransitionPayloadSchema>,
  previous: z.output<
    typeof sourceRegistryTransitionPayloadSchema
  >["resultingState"]["payload"],
  resulting: z.output<
    typeof sourceRegistryTransitionPayloadSchema
  >["resultingState"]["payload"],
  context: z.RefinementCtx
): void {
  if (
    previous.entityKind !== resulting.entityKind ||
    entityReferenceKey(previous) !== entityReferenceKey(resulting)
  ) {
    addIssue(
      context,
      ["resultingState", "payload"],
      "A transition cannot change source-registry entity identity."
    );
  }
  if (
    previous.sourceName !== resulting.sourceName ||
    previous.sourceTypeId !== resulting.sourceTypeId
  ) {
    addIssue(
      context,
      ["resultingState", "payload", "sourceName"],
      "A transition cannot change source registry catalog identity."
    );
  }
  if (
    transition.cas.expectedRevision !== previous.revision ||
    transition.cas.expectedRouteGeneration !==
      previous.routeAuthority.generation
  ) {
    addIssue(
      context,
      ["cas"],
      "Transition CAS must pin the exact current revision and route generation."
    );
  }
  if (
    transition.cas.resultingRevision !== resulting.revision ||
    transition.cas.resultingRouteGeneration !==
      resulting.routeAuthority.generation
  ) {
    addIssue(
      context,
      ["cas"],
      "Transition CAS result must match the resulting registry head."
    );
  }
  if (incrementRevision(previous.revision) !== resulting.revision) {
    addIssue(
      context,
      ["resultingState", "payload", "revision"],
      "A committed transition must advance the entity revision exactly once."
    );
  }
  if (!isInboxV2TimestampOrderValid(previous.updatedAt, resulting.updatedAt)) {
    addIssue(
      context,
      ["resultingState", "payload", "updatedAt"],
      "A transition cannot move state time backwards."
    );
  }
  if (previous.createdAt !== resulting.createdAt) {
    addIssue(
      context,
      ["resultingState", "payload", "createdAt"],
      "A transition must preserve original creation time."
    );
  }

  addIntentResultIssues(transition.intent, previous, resulting, context);
  addRouteGenerationIssues(transition.intent, previous, resulting, context);
  addAccountIdentityFenceIssues(
    transition.intent,
    previous,
    resulting,
    context
  );
}

function addIntentResultIssues(
  intent: InboxV2SourceRegistryTransitionIntent,
  previous: z.output<
    typeof sourceRegistryTransitionPayloadSchema
  >["resultingState"]["payload"],
  resulting: z.output<
    typeof sourceRegistryTransitionPayloadSchema
  >["resultingState"]["payload"],
  context: z.RefinementCtx
): void {
  const expectedStatus =
    intent === "enable" || intent === "recover"
      ? "active"
      : intent === "disable"
        ? "disabled"
        : intent === "degrade"
          ? "degraded"
          : intent === "reconnect"
            ? "pending"
            : intent === "replace"
              ? "replaced"
              : intent === "delete"
                ? "deleted"
                : previous.status;
  if (resulting.status !== expectedStatus) {
    addIssue(
      context,
      ["resultingState", "payload", "status"],
      `Transition ${intent} requires resulting status ${expectedStatus}.`
    );
  }
  if (intent === "replace" && resulting.entityKind !== "source_account") {
    addIssue(
      context,
      ["intent"],
      "Only a SourceAccount can be replaced; SourceConnection uses disable/delete."
    );
  }
  if (
    (intent === "disable" ||
      intent === "reconnect" ||
      intent === "replace" ||
      intent === "delete") &&
    resulting.routeAuthority.state !== "denied"
  ) {
    addIssue(
      context,
      ["resultingState", "payload", "routeAuthority", "state"],
      `Transition ${intent} must invalidate current route authority.`
    );
  }
  if (
    (intent === "disable" ||
      intent === "reconnect" ||
      intent === "replace" ||
      intent === "delete") &&
    resulting.relatedAuthorities.some(
      (authority) =>
        authority.kind !== "channel_session_event" &&
        authority.status !== "revoked"
    )
  ) {
    addIssue(
      context,
      ["resultingState", "payload", "relatedAuthorities"],
      `Transition ${intent} must retain and revoke every route-capable related authority.`
    );
  }
  if (
    intent === "update_metadata" &&
    (!sameJson(previous.routeAuthority, resulting.routeAuthority) ||
      !sameJson(routeCriticalState(previous), routeCriticalState(resulting)))
  ) {
    addIssue(
      context,
      ["resultingState", "payload", "routeAuthority"],
      "Metadata-only transition cannot mutate route-critical authority."
    );
  }
}

function addRouteGenerationIssues(
  intent: InboxV2SourceRegistryTransitionIntent,
  previous: z.output<
    typeof sourceRegistryTransitionPayloadSchema
  >["resultingState"]["payload"],
  resulting: z.output<
    typeof sourceRegistryTransitionPayloadSchema
  >["resultingState"]["payload"],
  context: z.RefinementCtx
): void {
  const invalidatesUnconditionally = [
    "enable",
    "disable",
    "reconnect",
    "replace",
    "delete"
  ].includes(intent);
  const routeStateChanged =
    previous.routeAuthority.state !== resulting.routeAuthority.state;
  const routeCriticalChanged = !sameJson(
    routeCriticalState(previous),
    routeCriticalState(resulting)
  );
  const expected =
    invalidatesUnconditionally || routeStateChanged || routeCriticalChanged
      ? incrementRevision(previous.routeAuthority.generation)
      : previous.routeAuthority.generation;
  if (resulting.routeAuthority.generation !== expected) {
    addIssue(
      context,
      ["resultingState", "payload", "routeAuthority", "generation"],
      "Route generation must advance exactly when route authority is invalidated or replaced."
    );
  }
  if (
    expected === previous.routeAuthority.generation &&
    resulting.routeAuthority.changedAt !== previous.routeAuthority.changedAt
  ) {
    addIssue(
      context,
      ["resultingState", "payload", "routeAuthority", "changedAt"],
      "Unchanged route generation must preserve its authority timestamp."
    );
  }
}

function routeCriticalState(
  state: z.output<
    typeof sourceRegistryTransitionPayloadSchema
  >["resultingState"]["payload"]
): unknown {
  const artifacts = state.artifacts.filter(
    (artifact) => artifact.kind !== "metadata" && artifact.kind !== "diagnostic"
  );
  return {
    adapterContract: state.adapterContract,
    lifecycle: state.lifecycle,
    artifacts,
    credentialBindings: state.credentialBindings,
    relatedAuthorities: state.relatedAuthorities,
    identityFence:
      state.entityKind === "source_account" ? state.identityFence : null,
    accessFence:
      state.entityKind === "source_account" ? state.accessFence : null
  };
}

function addAccountIdentityFenceIssues(
  intent: InboxV2SourceRegistryTransitionIntent,
  previous: z.output<
    typeof sourceRegistryTransitionPayloadSchema
  >["resultingState"]["payload"],
  resulting: z.output<
    typeof sourceRegistryTransitionPayloadSchema
  >["resultingState"]["payload"],
  context: z.RefinementCtx
): void {
  if (
    previous.entityKind !== "source_account" ||
    resulting.entityKind !== "source_account"
  ) {
    return;
  }
  if (
    compareRevision(
      resulting.identityFence.identityRevision,
      previous.identityFence.identityRevision
    ) < 0 ||
    compareRevision(
      resulting.identityFence.accountGeneration,
      previous.identityFence.accountGeneration
    ) < 0
  ) {
    addIssue(
      context,
      ["resultingState", "payload", "identityFence"],
      "A transition cannot reuse stale DB-003 identity authority."
    );
  }
  if (
    intent === "reconnect" &&
    compareRevision(
      resulting.identityFence.accountGeneration,
      previous.identityFence.accountGeneration
    ) <= 0
  ) {
    addIssue(
      context,
      ["resultingState", "payload", "identityFence", "accountGeneration"],
      "Reconnect must advance the DB-003 account generation fence."
    );
  }
}

function entityReferenceKey(
  state: z.output<
    typeof sourceRegistryTransitionPayloadSchema
  >["resultingState"]["payload"]
): string {
  return state.entityKind === "source_connection"
    ? `${state.sourceConnection.tenantId}\u0000${state.sourceConnection.id}`
    : `${state.sourceAccount.tenantId}\u0000${state.sourceAccount.id}`;
}

function relatedAuthorityKey(
  authority: z.output<
    typeof inboxV2SourceRegistryRelatedAuthorityReferenceSchema
  >
): string {
  return `${authority.kind}\u0000${authority.authorityId}`;
}

function incrementRevision(revision: string): string {
  return (BigInt(revision) + 1n).toString();
}

function compareRevision(left: string, right: string): -1 | 0 | 1 {
  const leftValue = BigInt(left);
  const rightValue = BigInt(right);
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}

function isAuthenticState(value: unknown): value is InboxV2SourceRegistryState {
  return (
    isInboxV2SourceConnectionRegistryState(value) ||
    isInboxV2SourceAccountRegistryState(value)
  );
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
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
