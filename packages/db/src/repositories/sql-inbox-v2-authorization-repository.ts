import { createHash } from "node:crypto";

import type {
  InboxV2AuthorizationDecisionReference,
  InboxV2CommandRequestIdentity,
  InboxV2DomainEvent,
  InboxV2InternalEntityReference,
  InboxV2OutboxIntent,
  InboxV2PayloadReference,
  InboxV2TenantStreamChange,
  InboxV2TenantStreamCommit
} from "@hulee/contracts";
import {
  INBOX_V2_TENANT_STREAM_SCHEMA_VERSION,
  inboxV2AtomicMutationCommitSchema,
  inboxV2AuthorizationDecisionReferenceSchema,
  inboxV2CatalogIdSchema,
  inboxV2ClientIdSchema,
  inboxV2ClientMutationIdSchema,
  inboxV2ConversationIdSchema,
  inboxV2DomainEventSchema,
  inboxV2EmployeeIdSchema,
  inboxV2InternalEntityReferenceSchema,
  inboxV2InternalOpaqueReferenceSchema,
  inboxV2OutboxIntentSchema,
  inboxV2PayloadReferenceSchema,
  inboxV2RequestIdSchema,
  inboxV2SchemaVersionTokenSchema,
  inboxV2SourceAccountIdSchema,
  inboxV2TenantIdSchema,
  inboxV2TenantStreamCommitSchema,
  inboxV2TenantStreamChangeSchema,
  inboxV2TrustedServiceIdSchema,
  inboxV2WorkItemIdSchema
} from "@hulee/contracts";
import {
  planInboxV2RoleBindingRevision,
  planInboxV2RoleDefinitionRevision,
  type InboxV2RoleBindingLegalityFact,
  type InboxV2RoleLegalityConflict,
  type InboxV2RoleRevisionPlanDecision
} from "@hulee/core";
import { sql, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

import type { HuleeDatabase } from "../client";
import {
  consumeInboxV2AtomicMaterializationSealReceipt,
  registerInboxV2AtomicSealExecutor,
  revokeInboxV2AtomicOutboundRouteProofs,
  revokeInboxV2AtomicSealExecutor,
  type InboxV2AtomicMaterializationSealReceipt,
  type InboxV2AtomicMessageCreationSealManifest,
  type InboxV2AtomicStreamEventManifest,
  type InboxV2AtomicTimelineItemCreationSealManifest
} from "./sql-inbox-v2-atomic-materialization-internal";
import type {
  RawSqlExecutor,
  RawSqlQueryResult
} from "./sql-outbox-repository";

const AUTHORIZATION_MUTATION_TRANSACTION_CONFIG = {
  isolationLevel: "read committed"
} as const;
const AUTHORIZATION_MUTATION_TRANSACTION_ATTEMPTS = 3;
const RETRYABLE_SQLSTATES = new Set(["40001", "40P01"]);
const MAX_BOUNDED_EMPLOYEE_ACCESS_HEADS = 64;
const MAX_BOUNDED_EMPLOYEE_RELATION_HEADS = 1_000;
const MAX_BOUNDED_RESOURCE_HEADS = 256;
const MAX_AUTHORIZATION_RELATION_WRITES = 1_000;
const POSTGRES_BIGINT_MAX = 9_223_372_036_854_775_807n;
const POSTGRES_BIGINT_MAX_DECIMAL = POSTGRES_BIGINT_MAX.toString();
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const INTERNAL_DOMAIN_ID_PATTERN =
  /^[a-z][a-z0-9_-]{1,63}:[A-Za-z0-9][A-Za-z0-9._~-]{0,191}$/u;
const POST_HEAD_SQL_DIALECT = new PgDialect();
const POST_HEAD_INSERT_TABLES = new Set([
  "inbox_v2_action_attributions",
  "inbox_v2_atomic_outbound_dispatch_materializations",
  "inbox_v2_atomic_source_resolution_materializations",
  "inbox_v2_external_message_references",
  "inbox_v2_message_reference_canonical_targets",
  "inbox_v2_message_reference_contexts",
  "inbox_v2_message_reference_external_targets",
  "inbox_v2_message_reference_unresolved_candidates",
  "inbox_v2_message_reference_unresolved_targets",
  "inbox_v2_message_revisions",
  "inbox_v2_message_transport_link_heads",
  "inbox_v2_message_transport_links",
  "inbox_v2_messages",
  "inbox_v2_outbound_dispatches",
  "inbox_v2_outbound_route_consumptions",
  "inbox_v2_source_occurrence_resolution_transitions",
  "inbox_v2_timeline_content_contact_values",
  "inbox_v2_timeline_content_payloads",
  "inbox_v2_timeline_content_revisions",
  "inbox_v2_timeline_contents",
  "inbox_v2_timeline_items",
  "inbox_v2_timeline_subject_details"
]);
const POST_HEAD_FORBIDDEN_SQL_PATTERN =
  /(?:;|--|\/\*|\*\/|\b(?:select|with|merge|delete|truncate|alter|create|drop|grant|revoke|copy|call|lock|from|using|join|union|intersect|except)\b|\bfor\s+(?:update|no\s+key\s+update|share|key\s+share)\b|\bpg_[a-z0-9_]*\s*\()/iu;
const POST_HEAD_INSERT_PATTERN =
  /^insert\s+into\s+(?:(?:public)\.)?([a-z][a-z0-9_]*)\b/iu;
const POST_HEAD_UPDATE_PATTERN =
  /^update\s+(?:(?:public)\.)?([a-z][a-z0-9_]*)\b/iu;
const POST_HEAD_UPDATE_CAS_PREDICATES = new Map<string, readonly RegExp[]>([
  [
    "inbox_v2_conversation_heads",
    [
      /\bwhere\s+tenant_id\s*=\s*\$\d+\s+and\s+conversation_id\s*=\s*\$\d+\s+and\s+revision\s*=\s*\$\d+\s+and\s+latest_timeline_sequence\s*=\s*\$\d+\s+returning\s+conversation_id\s+as\s+id\s*$/iu
    ]
  ],
  [
    "inbox_v2_source_occurrences",
    [
      /\bwhere\s+tenant_id\s*=\s*\$\d+\s+and\s+id\s*=\s*\$\d+\s+and\s+resolution_state\s*=\s*\$\d+\s+and\s+revision\s*=\s*\$\d+\s+and\s+updated_at\s*=\s*\$\d+\s+returning\s+id\s*$/iu
    ]
  ]
]);

export type InboxV2AuthorizationActor =
  | Readonly<{ kind: "employee"; employeeId: string }>
  | Readonly<{ kind: "trusted_service"; trustedServiceId: string }>;

export type InboxV2AuthorizationCommandClaim = Readonly<
  Omit<InboxV2CommandRequestIdentity, "tenantId"> & {
    id: string;
    actor: InboxV2AuthorizationActor;
    authorizationDecisionId: string;
    authorizationEpoch: string;
    authorizedAt: string;
    publicResultCode: string;
    resultReference: InboxV2PayloadReference | null;
    sensitiveResultReference: string | null;
  }
>;

export type InboxV2AuthorizationEmployeeRevisionExpectation = Readonly<{
  employeeId: string;
  expectedEmployeeAccessRevision: string;
  expectedEmployeeInboxRelationRevision: string;
  advanceEmployeeAccess: boolean;
  advanceEmployeeInboxRelation: boolean;
}>;

export type InboxV2AuthorizationResourceKind =
  | "conversation"
  | "client"
  | "source_account"
  | "work_item";

export type InboxV2AuthorizationResourceRevisionExpectation = Readonly<
  {
    resourceId: string;
    expectedResourceAccessRevision: string;
    expectedStructuralRelationRevision?: string;
    advanceStructuralRelation?: "none" | "repository" | "callback";
    expectedCollaboratorSetRevision?: string;
    advanceCollaboratorSet?: "none" | "repository" | "callback";
    /**
     * DB002/DB004 relation repositories already advance some resource heads.
     * `callback` means this wrapper locks the row before the callback and verifies
     * the exact +1 step afterwards instead of advancing it twice.
     */
    advance: "none" | "repository" | "callback";
  } & (
    | Readonly<{
        resourceKind: "work_item";
        resourceHeadId?: never;
        /** Reopen-cycle and WorkItem-head CAS are both mandatory fences. */
        workItemCycle: string;
        expectedWorkItemRevision: string;
      }>
    | Readonly<{
        resourceKind: Exclude<InboxV2AuthorizationResourceKind, "work_item">;
        resourceHeadId: string;
        workItemCycle?: never;
        expectedWorkItemRevision?: never;
      }>
  )
>;

export type InboxV2AuthorizationRevisionPlan = Readonly<{
  expectedTenantRbacRevision: string;
  expectedSharedAccessRevision: string;
  advanceTenantRbac: boolean;
  advanceSharedAccess: boolean;
  employees: readonly InboxV2AuthorizationEmployeeRevisionExpectation[];
  resources: readonly InboxV2AuthorizationResourceRevisionExpectation[];
}>;

export type InboxV2AuthorizationStreamChangeInput = Readonly<
  Omit<InboxV2TenantStreamChange, "reference"> & {
    id: string;
    ordinal: number;
  }
>;

export type InboxV2AuthorizationDomainEventInput = Readonly<
  Omit<InboxV2DomainEvent, "tenantId" | "commit"> & {
    tenantId?: never;
    commit?: never;
  }
>;

export type InboxV2AuthorizationOutboxIntentInput = Readonly<
  Omit<InboxV2OutboxIntent, "tenantId" | "commit"> & {
    tenantId?: never;
    commit?: never;
    ordinal: number;
  }
>;

export type InboxV2AuthorizationAuditFacetInput = Readonly<{
  ordinal: number;
  dimension: "tenant" | "org_unit" | "team" | "queue" | "resource";
  reference: InboxV2InternalEntityReference;
  relation: "source" | "destination" | "affected";
  facetHash: string;
}>;

export type InboxV2AuthorizationAuditInput = Readonly<{
  id: string;
  actionId: string;
  target: InboxV2InternalEntityReference;
  reasonCodeId: string;
  matchedPermissionIds: readonly string[];
  grantSourceIds: readonly string[];
  authorizationScopeIds: readonly string[];
  overrideReasonCodeId: string | null;
  policyVersion: string | null;
  evidenceReference: InboxV2PayloadReference | null;
  authorizationDecisionRefs: readonly InboxV2AuthorizationDecisionReference[];
  correlationId: string;
  outcome: "succeeded";
  revisionDeltaHash: string;
  previousAuditHash: string | null;
  auditHash: string;
  occurredAt: string;
  recordedAt: string;
  expiresAt: string;
  facets: readonly InboxV2AuthorizationAuditFacetInput[];
}>;

export type InboxV2AuthorizationRelationKind =
  | "role"
  | "role_binding"
  | "direct_grant"
  | "workforce_membership"
  | "structural_access"
  | "conversation_collaborator"
  | "work_item_collaborator"
  | "internal_membership"
  | "primary_responsibility"
  | "servicing_team";

export type InboxV2AuthorizedCommandMutationProfile =
  | "domain"
  | "authorization_relation";

export type InboxV2AuthorizationMutationRecords = Readonly<{
  mutationId: string;
  /**
   * Authorization-relation mutations retain their exact relation kind.
   * A null kind selects the provider-neutral domain profile; the profile is
   * deliberately derived so callers cannot submit contradictory flags.
   */
  relationKind: InboxV2AuthorizationRelationKind | null;
  streamCommitId: string;
  expectedStreamEpoch: string;
  audienceImpact: InboxV2TenantStreamCommit["audienceImpact"];
  commitHash: string;
  correlationId: string;
  changes: readonly InboxV2AuthorizationStreamChangeInput[];
  events: readonly InboxV2AuthorizationDomainEventInput[];
  outboxIntents: readonly InboxV2AuthorizationOutboxIntentInput[];
  audit: InboxV2AuthorizationAuditInput;
}>;

export type WithPrivilegedAuthorizationMutationInput = Readonly<{
  tenantId: string;
  command: InboxV2AuthorizationCommandClaim;
  revisions: InboxV2AuthorizationRevisionPlan;
  records: InboxV2AuthorizationMutationRecords;
  occurredAt: string;
}>;

export type InboxV2AuthorizationRevisionEffect = Readonly<{
  id: string;
  kind:
    | "tenant_rbac"
    | "shared_access"
    | "employee_access"
    | "employee_inbox_relation"
    | "resource_access"
    | "collaborator_set";
  employeeId: string | null;
  resourceKind: InboxV2AuthorizationResourceKind | null;
  resourceId: string | null;
  resourceHeadId: string | null;
  workItemCycle: string | null;
  expectedWorkItemRevision: string | null;
  resultingWorkItemRevision: string | null;
  previousRevision: string;
  resultingRevision: string;
}>;

export type InboxV2AuthorizationRelationRevisionEffect = Readonly<{
  id: string;
  ordinal: number;
  relationId: string;
  previousRevision: string | null;
  resultingRevision: string;
}>;

export type InboxV2PrivilegedAuthorizationMutationCallbackResult<TResult> =
  Readonly<{
    result: TResult;
    relationWrites?: readonly InboxV2AuthorizationRelationRevisionEffect[];
  }>;

export type InboxV2PrivilegedAuthorizationMutationContext = Readonly<{
  executor: RawSqlExecutor;
  /**
   * Present only for the prepare phase of the two-phase atomic coordinator.
   * Repositories bind opaque prepared capabilities to this exact transaction
   * token instead of exposing the transaction executor during the seal phase.
   */
  atomicMaterializationToken?: object;
  tenantId: string;
  commandId: string;
  clientMutationId: string;
  commandTypeId: string;
  /**
   * Server-authenticated actor copied from the durably claimed command. Domain
   * repositories use this value from the non-forgeable live context instead
   * of trusting actor/service identifiers repeated in command payloads.
   */
  actor: InboxV2AuthorizationActor;
  authorizationEpoch: string;
  authorizationDecisionId: string;
  authorizationDecisionRefs: readonly InboxV2AuthorizationDecisionReference[];
  authorizationResourceRevisionFences: readonly InboxV2AuthorizationResourceRevisionExpectation[];
  authorizedAt: string;
  occurredAt: string;
  mutationId: string;
  profile: InboxV2AuthorizedCommandMutationProfile;
  revisionEffects: readonly InboxV2AuthorizationRevisionEffect[];
}>;

const authorizedCommandMutationContexts = new WeakSet<object>();
const authorizedAtomicMaterializationContexts = new WeakSet<object>();

function recursivelyFrozenAuthorizationSnapshot<T>(value: T): T {
  if (Array.isArray(value)) {
    return Object.freeze(
      value.map((item) => recursivelyFrozenAuthorizationSnapshot(item))
    ) as T;
  }
  if (typeof value === "object" && value !== null) {
    const snapshot = Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        recursivelyFrozenAuthorizationSnapshot(item)
      ])
    );
    return Object.freeze(snapshot) as T;
  }
  return value;
}

function snapshotInboxV2AuthorizationActor(
  actor: InboxV2AuthorizationActor
): InboxV2AuthorizationActor {
  return recursivelyFrozenAuthorizationSnapshot(actor);
}

function snapshotInboxV2AuthorizationDecisionRefs(
  decisions: readonly InboxV2AuthorizationDecisionReference[]
): readonly InboxV2AuthorizationDecisionReference[] {
  return recursivelyFrozenAuthorizationSnapshot(decisions);
}

function snapshotInboxV2AuthorizationResourceRevisionFences(
  fences: readonly InboxV2AuthorizationResourceRevisionExpectation[]
): readonly InboxV2AuthorizationResourceRevisionExpectation[] {
  return recursivelyFrozenAuthorizationSnapshot(fences);
}

/**
 * Runtime capability check for repositories that may write only from the
 * coordinator-owned transaction callback. Structural TypeScript values are
 * not sufficient for this trust boundary because an in-process caller could
 * otherwise forge the executor/mutation tuple.
 */
export function assertInboxV2AuthorizedCommandMutationContext(
  context: InboxV2PrivilegedAuthorizationMutationContext
): void {
  if (
    typeof context !== "object" ||
    context === null ||
    !authorizedCommandMutationContexts.has(context)
  ) {
    throw new TypeError(
      "Inbox V2 domain persistence requires a live authorized-command context."
    );
  }
}

export type InboxV2AuthorizedAtomicMaterializationContext = Readonly<{
  atomicMaterializationToken: object;
  tenantId: string;
  commandId: string;
  clientMutationId: string;
  commandTypeId: string;
  actor: InboxV2AuthorizationActor;
  authorizationEpoch: string;
  authorizationDecisionId: string;
  authorizationDecisionRefs: readonly InboxV2AuthorizationDecisionReference[];
  authorizationResourceRevisionFences: readonly InboxV2AuthorizationResourceRevisionExpectation[];
  authorizedAt: string;
  occurredAt: string;
  mutationId: string;
  profile: "domain";
  revisionEffects: readonly [];
  streamCommitId: string;
  streamEpoch: string;
  previousPosition: string;
  streamPosition: string;
}>;

/**
 * Runtime capability check for the second, stream-position-aware phase of an
 * atomic domain materialization. The capability exists only while the
 * coordinator owns both the database transaction and the locked tenant stream
 * head; callers therefore cannot forge a position and persist canonical rows
 * outside the commit that publishes them.
 */
export function assertInboxV2AuthorizedAtomicMaterializationContext(
  context: InboxV2AuthorizedAtomicMaterializationContext
): void {
  if (
    typeof context !== "object" ||
    context === null ||
    !authorizedAtomicMaterializationContexts.has(context)
  ) {
    throw new TypeError(
      "Inbox V2 atomic materialization requires a live stream-position context."
    );
  }
}

function createInboxV2AtomicMaterializationPhaseExecutor(
  transaction: RawSqlExecutor
): Readonly<{
  prepareExecutor: RawSqlExecutor;
  sealExecutor: RawSqlExecutor;
  closePreparePhase(): void;
  enterPostHeadWritePhase(): void;
  closePostHeadWritePhase(): void;
}> {
  let preparePhaseOpen = true;
  let postHeadWritePhaseOpen = false;
  const prepareExecutor: RawSqlExecutor = Object.freeze({
    async execute<Row extends Record<string, unknown>>(
      query: SQL
    ): Promise<RawSqlQueryResult<Row>> {
      if (!preparePhaseOpen) {
        throw invariantError(
          "Inbox V2 atomic prepare executor is no longer live."
        );
      }
      return transaction.execute<Row>(query);
    }
  });
  const sealExecutor: RawSqlExecutor = Object.freeze({
    async execute<Row extends Record<string, unknown>>(
      query: SQL
    ): Promise<RawSqlQueryResult<Row>> {
      if (!postHeadWritePhaseOpen) {
        throw invariantError("Inbox V2 atomic seal executor is not live.");
      }
      assertInboxV2PostHeadWriteStatement(
        POST_HEAD_SQL_DIALECT.sqlToQuery(query).sql.trim()
      );
      return transaction.execute<Row>(query);
    }
  });
  return Object.freeze({
    prepareExecutor,
    sealExecutor,
    closePreparePhase(): void {
      preparePhaseOpen = false;
    },
    enterPostHeadWritePhase(): void {
      if (preparePhaseOpen) {
        throw invariantError(
          "Inbox V2 atomic seal cannot open before prepare is revoked."
        );
      }
      postHeadWritePhaseOpen = true;
    },
    closePostHeadWritePhase(): void {
      postHeadWritePhaseOpen = false;
    }
  });
}

function assertInboxV2PostHeadWriteStatement(statement: string): void {
  const normalized = statement.replaceAll('"', "").replace(/\s+/gu, " ").trim();
  if (POST_HEAD_FORBIDDEN_SQL_PATTERN.test(normalized)) {
    throw invalidPostHeadWrite();
  }

  const insert = POST_HEAD_INSERT_PATTERN.exec(normalized);
  if (insert !== null) {
    const table = insert[1];
    if (
      table === undefined ||
      !POST_HEAD_INSERT_TABLES.has(table.toLowerCase()) ||
      !/\)\s+values\s*\(/iu.test(normalized) ||
      (/\bon\s+conflict\b/iu.test(normalized) &&
        !/\bon\s+conflict\s+do\s+nothing\s+returning\b/iu.test(normalized)) ||
      !/\breturning\s+[a-z][a-z0-9_]*(?:\s+as\s+id)?\s*$/iu.test(normalized)
    ) {
      throw invalidPostHeadWrite();
    }
    return;
  }

  const update = POST_HEAD_UPDATE_PATTERN.exec(normalized);
  if (update !== null) {
    const table = update[1]?.toLowerCase();
    const predicates =
      table === undefined
        ? undefined
        : POST_HEAD_UPDATE_CAS_PREDICATES.get(table);
    if (
      predicates === undefined ||
      normalized.includes(" or ") ||
      predicates.some((predicate) => !predicate.test(normalized))
    ) {
      throw invalidPostHeadWrite();
    }
    return;
  }

  throw invalidPostHeadWrite();
}

function invalidPostHeadWrite(): Error {
  return invariantError(
    "Inbox V2 post-stream-head materialization permits only allowlisted append inserts and exact compare-and-swap updates prepared before the tenant stream-head lock."
  );
}

export type InboxV2PrivilegedAuthorizationMutationReplayStatus = Readonly<{
  commandId: string;
  mutationId: string;
  publicResultCode: string;
  resultReference: InboxV2PayloadReference | null;
  streamCommitId: string;
  streamEpoch: string;
  streamPosition: string;
  committedAt: string;
}>;

export type InboxV2PrivilegedAuthorizationMutationAppliedStatus = Readonly<
  InboxV2PrivilegedAuthorizationMutationReplayStatus & {
    sensitiveResultReference: string | null;
  }
>;

export type WithPrivilegedAuthorizationMutationResult<TResult> =
  | Readonly<{
      kind: "applied";
      result: TResult;
      status: InboxV2PrivilegedAuthorizationMutationAppliedStatus;
      revisionEffects: readonly InboxV2AuthorizationRevisionEffect[];
    }>
  | Readonly<{
      /** The canonical body is intentionally not returned on replay. */
      kind: "already_applied";
      status: InboxV2PrivilegedAuthorizationMutationReplayStatus;
      /** Present only when the caller supplied a DB-only authorized loader. */
      result?: TResult;
    }>
  | Readonly<{
      kind: "idempotency_conflict";
      code: "command.idempotency_conflict";
    }>
  | Readonly<{
      kind: "revision_conflict";
      code: "auth.access_revision_stale" | "revision.conflict";
      conflicts: readonly InboxV2AuthorizationRevisionConflict[];
    }>
  | Readonly<{
      kind: "resource_not_found";
    }>
  | Readonly<{
      kind: "role_legality_conflict";
      code: "authorization.role_legality_conflict";
      relationKind: "role" | "role_binding";
      relationId: string;
      reason: Extract<
        InboxV2RoleRevisionPlanDecision,
        { kind: "rejected" }
      >["reason"];
      conflicts: readonly InboxV2RoleLegalityConflict[];
    }>;

export type InboxV2AuthorizationRevisionConflict = Readonly<{
  kind:
    | "tenant_rbac"
    | "shared_access"
    | "employee_access"
    | "employee_inbox_relation"
    | "resource_access"
    | "work_item_revision"
    | "structural_relation"
    | "collaborator_set"
    | "authorization_decision_time"
    | "tenant_stream_epoch";
  employeeId?: string;
  resourceKind?: InboxV2AuthorizationResourceKind;
  resourceId?: string;
  workItemCycle?: string;
  expectedRevision: string;
  currentRevision: string;
}>;

export type InboxV2AuthorizedCommandActor = InboxV2AuthorizationActor;
export type InboxV2AuthorizedCommandClaim = InboxV2AuthorizationCommandClaim;
export type InboxV2AuthorizedCommandRevisionPlan =
  InboxV2AuthorizationRevisionPlan;
export type InboxV2AuthorizedCommandRecords =
  InboxV2AuthorizationMutationRecords;
export type WithInboxV2AuthorizedCommandMutationInput =
  WithPrivilegedAuthorizationMutationInput;
export type InboxV2AuthorizedCommandMutationCallbackResult<TResult> =
  InboxV2PrivilegedAuthorizationMutationCallbackResult<TResult>;
export type InboxV2AuthorizedCommandMutationContext =
  InboxV2PrivilegedAuthorizationMutationContext;
export type InboxV2AuthorizedCommandMutationResult<TResult> =
  WithPrivilegedAuthorizationMutationResult<TResult>;

export type InboxV2AuthorizedAtomicMaterializationSealResult<TResult> =
  Readonly<{
    result: TResult;
    receipt: InboxV2AtomicMaterializationSealReceipt;
  }>;

export type InboxV2AuthorizationTransactionExecutor = RawSqlExecutor & {
  transaction<TResult>(
    work: (transaction: RawSqlExecutor) => Promise<TResult>,
    config: Readonly<{ isolationLevel: "read committed" }>
  ): Promise<TResult>;
};

export type InboxV2AuthorizedCommandCoordinator = Readonly<{
  withAuthorizedCommandMutation<TResult>(
    input: WithInboxV2AuthorizedCommandMutationInput,
    /**
     * Runs inside the coordinator-owned retryable database transaction and may
     * execute again after serialization failures or deadlocks. The callback is
     * intentionally DB-only: provider I/O, credential exchange and one-time
     * secret material must be represented through non-sensitive outbox/result
     * references prepared before the coordinator is called.
     */
    persistDomainMutation: (
      context: InboxV2AuthorizedCommandMutationContext
    ) => Promise<InboxV2AuthorizedCommandMutationCallbackResult<TResult>>,
    loadCommittedResult?: (
      context: InboxV2AuthorizedCommandMutationContext,
      status: InboxV2PrivilegedAuthorizationMutationReplayStatus
    ) => Promise<TResult>
  ): Promise<InboxV2AuthorizedCommandMutationResult<TResult>>;
}>;

export type InboxV2AuthorizedAtomicMaterializationCoordinator = Readonly<
  InboxV2AuthorizedCommandCoordinator & {
    /**
     * Runs a provider-neutral command in two DB-only phases. `prepare` may lock
     * and mutate canonical domain aggregates, but runs before the tenant stream
     * head lock. `seal` receives the coordinator-allocated stream position but
     * no raw executor: repositories may consume only opaque write capabilities
     * prepared in this exact transaction. Provider/network I/O is forbidden in
     * both callbacks and belongs behind the durable outbox.
     *
     * A retry reruns both callbacks. A committed idempotency replay runs neither.
     */
    withAuthorizedAtomicMaterialization<TPrepared, TResult>(
      input: WithInboxV2AuthorizedCommandMutationInput,
      prepareDomainMutation: (
        context: InboxV2AuthorizedCommandMutationContext
      ) => Promise<TPrepared>,
      sealDomainMutation: (
        context: InboxV2AuthorizedAtomicMaterializationContext,
        prepared: TPrepared
      ) => Promise<InboxV2AuthorizedAtomicMaterializationSealResult<TResult>>
    ): Promise<InboxV2AuthorizedCommandMutationResult<TResult>>;
  }
>;

export type InboxV2AuthorizationRepository = Readonly<{
  withPrivilegedAuthorizationMutation<TResult>(
    input: WithPrivilegedAuthorizationMutationInput,
    /**
     * Runs inside a retryable database transaction and may execute more than
     * once after a serialization failure or deadlock. Implementations must use
     * only the supplied transaction executor for idempotent database work and
     * must not perform external side effects; those belong in the outbox.
     */
    persistRelations: (
      context: InboxV2PrivilegedAuthorizationMutationContext
    ) => Promise<InboxV2PrivilegedAuthorizationMutationCallbackResult<TResult>>
  ): Promise<WithPrivilegedAuthorizationMutationResult<TResult>>;
}>;

type CommandClaimRow = {
  id: unknown;
};

type CommandReplayRow = {
  id: unknown;
  request_hash: unknown;
  mutation_id: unknown;
  public_result_code: unknown;
  result_reference: unknown;
  stream_commit_id: unknown;
  stream_epoch: unknown;
  stream_position: unknown;
  committed_at: unknown;
};

type TenantHeadRow = {
  tenant_rbac_revision: unknown;
  shared_access_revision: unknown;
  revision: unknown;
};

type EmployeeHeadRow = {
  employee_id: unknown;
  employee_access_revision: unknown;
  employee_inbox_relation_revision: unknown;
  revision: unknown;
};

type ResourceHeadRow = {
  head_id: unknown;
  resource_kind: unknown;
  resource_id: unknown;
  work_item_cycle: unknown;
  resource_access_revision: unknown;
  structural_relation_revision: unknown;
  collaborator_set_revision: unknown;
  revision: unknown;
};

type StreamHeadRow = {
  stream_epoch: unknown;
  last_position: unknown;
  min_retained_position: unknown;
  revision: unknown;
};

type DatabaseClockRow = {
  database_now: unknown;
};

type AuthorizationRelationTargetRow = {
  ordinal: unknown;
  relation_id: unknown;
  target_employee_id: unknown;
  resource_kind: unknown;
  resource_id: unknown;
  resource_head_id: unknown;
  work_item_cycle: unknown;
};

type PersistedRolePermissionRow = {
  ordinal: unknown;
  role_id: unknown;
  role_revision: unknown;
  permission_count: unknown;
  permission_ordinal: unknown;
  permission_id: unknown;
};

type CurrentRolePermissionRow = {
  role_id: unknown;
  role_revision: unknown;
  permission_count: unknown;
  permission_ordinal: unknown;
  permission_id: unknown;
};

type RoleBindingLegalityRow = {
  ordinal: unknown;
  binding_id: unknown;
  binding_revision: unknown;
  role_id: unknown;
  state: unknown;
  valid_from: unknown;
  valid_until: unknown;
  revoked_at: unknown;
  scope_kind: unknown;
  scope_org_unit_mode: unknown;
  scope_org_unit_id: unknown;
  scope_team_id: unknown;
  scope_work_queue_id: unknown;
  scope_client_id: unknown;
  scope_conversation_id: unknown;
  scope_work_item_id: unknown;
  scope_source_account_id: unknown;
};

export function createSqlInboxV2AuthorizationRepository(
  executor: InboxV2AuthorizationTransactionExecutor | HuleeDatabase
): InboxV2AuthorizationRepository {
  const coordinator = createSqlInboxV2AuthorizedCommandCoordinator(executor);

  return {
    async withPrivilegedAuthorizationMutation(input, persistRelations) {
      return coordinator.withAuthorizedCommandMutation(input, persistRelations);
    }
  };
}

export function createSqlInboxV2AuthorizedCommandCoordinator(
  executor: InboxV2AuthorizationTransactionExecutor | HuleeDatabase
): InboxV2AuthorizedAtomicMaterializationCoordinator {
  const transactionExecutor =
    executor as unknown as InboxV2AuthorizationTransactionExecutor;

  return {
    async withAuthorizedCommandMutation(
      input,
      persistDomainMutation,
      loadCommittedResult
    ) {
      const normalized = normalizeMutationInput(input);
      assertInboxV2OnePhaseMutationDoesNotBypassAtomicMessageSeam(normalized);
      return runAuthorizationMutationTransaction(
        transactionExecutor,
        async (transaction) =>
          persistPrivilegedAuthorizationMutation(
            transaction,
            normalized,
            persistDomainMutation,
            loadCommittedResult
          )
      );
    },
    async withAuthorizedAtomicMaterialization(
      input,
      prepareDomainMutation,
      sealDomainMutation
    ) {
      const normalized = normalizeMutationInput(input);
      if (authorizedCommandMutationProfile(normalized.records) !== "domain") {
        throw new TypeError(
          "Atomic domain materialization requires the provider-neutral domain profile."
        );
      }
      return runAuthorizationMutationTransaction(
        transactionExecutor,
        async (transaction) =>
          persistAuthorizedAtomicMaterialization(
            transaction,
            normalized,
            prepareDomainMutation,
            sealDomainMutation
          )
      );
    }
  };
}

function assertInboxV2OnePhaseMutationDoesNotBypassAtomicMessageSeam(
  input: WithPrivilegedAuthorizationMutationInput
): void {
  const commandTypeId = input.command.commandTypeId;
  const hasAtomicMessageChange = input.records.changes.some(
    ({ entity }) =>
      entity.entityTypeId === "core:message" ||
      entity.entityTypeId === "core:outbound-dispatch" ||
      entity.entityTypeId === "core:timeline-item"
  );
  const hasProviderDispatchIntent = input.records.outboxIntents.some(
    (intent) =>
      intent.effectClass === "provider_io" ||
      intent.typeId === "core:provider.dispatch"
  );
  if (
    commandTypeId === "core:message.send" ||
    commandTypeId === "core:message.receive" ||
    hasAtomicMessageChange ||
    hasProviderDispatchIntent
  ) {
    throw new TypeError(
      "Message, TimelineItem and provider-dispatch mutations require withAuthorizedAtomicMaterialization."
    );
  }
}

async function persistAuthorizedAtomicMaterialization<TPrepared, TResult>(
  transaction: RawSqlExecutor,
  input: WithPrivilegedAuthorizationMutationInput,
  prepareDomainMutation: (
    context: InboxV2AuthorizedCommandMutationContext
  ) => Promise<TPrepared>,
  sealDomainMutation: (
    context: InboxV2AuthorizedAtomicMaterializationContext,
    prepared: TPrepared
  ) => Promise<InboxV2AuthorizedAtomicMaterializationSealResult<TResult>>
): Promise<WithPrivilegedAuthorizationMutationResult<TResult>> {
  const claim = await transaction.execute<CommandClaimRow>(
    buildClaimInboxV2AuthorizationCommandSql(input)
  );
  assertAtMostOneRow(claim, "atomic materialization command claim");
  if (claim.rows.length === 0) {
    const replay = await loadAuthorizationCommandByIdempotencyScope(
      transaction,
      input
    );
    if (replay === null) {
      const commandIdCollision = await loadAuthorizationCommandById(
        transaction,
        input.tenantId,
        input.command.id
      );
      if (commandIdCollision === null) {
        throw invariantError(
          "Atomic materialization command claim lost without a persisted conflict row."
        );
      }
      return idempotencyConflict();
    }
    if (
      asString(replay.request_hash, "command request hash") !==
      input.command.requestHash
    ) {
      return idempotencyConflict();
    }
    const mutationId = nullableString(replay.mutation_id);
    if (mutationId === null) {
      throw invariantError(
        "A visible atomic materialization command remained pending outside its transaction."
      );
    }
    return {
      kind: "already_applied",
      status: mapReplayStatus(replay, mutationId)
    };
  }

  const locked = await lockAndCheckAuthorizationRevisions(transaction, input);
  if (locked.kind !== "locked") {
    throw new AuthorizationMutationAbort(locked.result);
  }
  if (locked.effects.length !== 0) {
    throw invariantError(
      "Atomic domain materialization produced authorization revision effects."
    );
  }
  await assertAuthorizationDecisionTemporalFence(transaction, input);

  const materializationPhase =
    createInboxV2AtomicMaterializationPhaseExecutor(transaction);
  const atomicMaterializationToken = Object.freeze({});

  try {
    const prepareContext: InboxV2AuthorizedCommandMutationContext =
      Object.freeze({
        executor: materializationPhase.prepareExecutor,
        atomicMaterializationToken,
        tenantId: input.tenantId,
        commandId: input.command.id,
        clientMutationId: input.command.clientMutationId,
        commandTypeId: input.command.commandTypeId,
        actor: snapshotInboxV2AuthorizationActor(input.command.actor),
        authorizationEpoch: input.command.authorizationEpoch,
        authorizationDecisionId: input.command.authorizationDecisionId,
        authorizationDecisionRefs: snapshotInboxV2AuthorizationDecisionRefs(
          input.records.audit.authorizationDecisionRefs
        ),
        authorizationResourceRevisionFences:
          snapshotInboxV2AuthorizationResourceRevisionFences(
            input.revisions.resources
          ),
        authorizedAt: input.command.authorizedAt,
        occurredAt: input.occurredAt,
        mutationId: input.records.mutationId,
        profile: "domain",
        revisionEffects: []
      });
    registerInboxV2AtomicSealExecutor(
      prepareContext,
      materializationPhase.sealExecutor
    );
    authorizedCommandMutationContexts.add(prepareContext);
    let prepared: TPrepared;
    try {
      prepared = await prepareDomainMutation(prepareContext);
    } finally {
      authorizedCommandMutationContexts.delete(prepareContext);
      revokeInboxV2AtomicSealExecutor(prepareContext);
      materializationPhase.closePreparePhase();
    }
    await verifyCallbackManagedResourceRevisions(transaction, input);

    // ADR 0012: allocate the tenant position only after every preparatory domain
    // lock/write. Nothing before this point can consume a stream position.
    await ensureTenantStreamHead(transaction, input);
    const streamHead = await lockTenantStreamHead(transaction, input.tenantId);
    if (streamHead === null) {
      throw invariantError(
        "Tenant stream head bootstrap did not produce a row."
      );
    }
    const previousPosition = positiveOrZeroCounter(
      streamHead.last_position,
      "tenant stream last position"
    );
    const streamPosition = (BigInt(previousPosition) + 1n).toString();
    const streamEpoch = asString(
      streamHead.stream_epoch,
      "tenant stream epoch"
    );
    if (streamEpoch !== input.records.expectedStreamEpoch) {
      throw new AuthorizationMutationAbort({
        kind: "revision_conflict",
        code: "revision.conflict",
        conflicts: [
          {
            kind: "tenant_stream_epoch",
            expectedRevision: input.records.expectedStreamEpoch,
            currentRevision: streamEpoch
          }
        ]
      });
    }
    const streamHeadRevision = positiveCounter(
      streamHead.revision,
      "tenant stream head revision"
    );

    await assertAuthorizationDecisionTemporalFence(transaction, input);
    materializationPhase.enterPostHeadWritePhase();

    const sealContext: InboxV2AuthorizedAtomicMaterializationContext =
      Object.freeze({
        atomicMaterializationToken,
        tenantId: input.tenantId,
        commandId: input.command.id,
        clientMutationId: input.command.clientMutationId,
        commandTypeId: input.command.commandTypeId,
        actor: snapshotInboxV2AuthorizationActor(input.command.actor),
        authorizationEpoch: input.command.authorizationEpoch,
        authorizationDecisionId: input.command.authorizationDecisionId,
        authorizationDecisionRefs: snapshotInboxV2AuthorizationDecisionRefs(
          input.records.audit.authorizationDecisionRefs
        ),
        authorizationResourceRevisionFences:
          snapshotInboxV2AuthorizationResourceRevisionFences(
            input.revisions.resources
          ),
        authorizedAt: input.command.authorizedAt,
        occurredAt: input.occurredAt,
        mutationId: input.records.mutationId,
        profile: "domain",
        revisionEffects: [] as const,
        streamCommitId: input.records.streamCommitId,
        streamEpoch,
        previousPosition,
        streamPosition
      });
    authorizedAtomicMaterializationContexts.add(sealContext);
    let sealed: InboxV2AuthorizedAtomicMaterializationSealResult<TResult>;
    try {
      sealed = await sealDomainMutation(sealContext, prepared);
      assertInboxV2AtomicMaterializationSealResult(sealed);
      const sealManifest = consumeInboxV2AtomicMaterializationSealReceipt(
        sealed.receipt,
        atomicMaterializationToken
      );
      if (sealManifest.kind === "message_creation") {
        assertInboxV2AtomicMessageCreationSealManifest(input, sealManifest);
      } else {
        assertInboxV2AtomicTimelineItemCreationSealManifest(
          input,
          sealManifest
        );
      }
    } finally {
      authorizedAtomicMaterializationContexts.delete(sealContext);
      materializationPhase.closePostHeadWritePhase();
    }
    await assertAuthorizationDecisionTemporalFence(transaction, input);

    await persistAtomicMutationClosure(transaction, {
      input,
      streamEpoch,
      previousPosition,
      streamPosition,
      streamHeadRevision,
      revisionEffects: [],
      relationWrites: []
    });

    return {
      kind: "applied",
      result: sealed.result,
      status: {
        commandId: input.command.id,
        mutationId: input.records.mutationId,
        publicResultCode: input.command.publicResultCode,
        resultReference: input.command.resultReference,
        sensitiveResultReference: input.command.sensitiveResultReference,
        streamCommitId: input.records.streamCommitId,
        streamEpoch,
        streamPosition,
        committedAt: input.occurredAt
      },
      revisionEffects: []
    };
  } finally {
    revokeInboxV2AtomicOutboundRouteProofs(atomicMaterializationToken);
  }
}

async function persistAtomicMutationClosure(
  transaction: RawSqlExecutor,
  closure: Readonly<{
    input: WithPrivilegedAuthorizationMutationInput;
    streamEpoch: string;
    previousPosition: string;
    streamPosition: string;
    streamHeadRevision: string;
    revisionEffects: readonly InboxV2AuthorizationRevisionEffect[];
    relationWrites: readonly InboxV2AuthorizationRelationRevisionEffect[];
  }>
): Promise<void> {
  const { input, streamEpoch, previousPosition, streamPosition } = closure;
  await expectOneRow(
    transaction,
    buildInsertInboxV2TenantStreamCommitSql({
      input,
      streamEpoch,
      streamPosition,
      previousPosition
    }),
    "tenant stream commit"
  );
  await expectExactRows(
    transaction,
    buildInsertInboxV2TenantStreamChangesSql({ input, streamPosition }),
    input.records.changes.length,
    "tenant stream changes"
  );
  await expectExactRows(
    transaction,
    buildInsertInboxV2DomainEventsSql({ input, streamPosition }),
    input.records.events.length,
    "domain events"
  );
  if (input.records.outboxIntents.length > 0) {
    await expectExactRows(
      transaction,
      buildInsertInboxV2OutboxIntentsSql({ input, streamPosition }),
      input.records.outboxIntents.length,
      "outbox intents"
    );
  }
  // The audit and mutation-commit FKs include mutation_id. Complete the
  // still-transaction-local command before inserting either child. The row is
  // not observable until this whole transaction commits.
  await expectOneRow(
    transaction,
    buildCompleteInboxV2AuthorizationCommandSql(input),
    "authorization command completion"
  );
  await expectOneRow(
    transaction,
    buildInsertInboxV2AuthorizationAuditEventSql(input),
    "authorization audit event"
  );
  await expectExactRows(
    transaction,
    buildInsertInboxV2AuthorizationAuditFacetsSql(input),
    input.records.audit.facets.length,
    "authorization audit facets"
  );
  await expectOneRow(
    transaction,
    buildInsertInboxV2AuthorizationMutationCommitSql({
      input,
      revisionEffects: closure.revisionEffects,
      relationWrites: closure.relationWrites
    }),
    "authorization mutation commit"
  );
  await expectExactRows(
    transaction,
    buildInsertInboxV2AuthorizationRevisionEffectsSql(
      input,
      closure.revisionEffects
    ),
    closure.revisionEffects.length,
    "authorization revision effects"
  );
  await expectExactRows(
    transaction,
    buildInsertInboxV2AuthorizationRelationWritesSql(
      input,
      closure.relationWrites
    ),
    closure.relationWrites.length,
    "authorization relation writes"
  );
  await expectOneRow(
    transaction,
    buildAdvanceInboxV2TenantStreamHeadSql({
      tenantId: input.tenantId,
      streamEpoch,
      previousPosition,
      streamPosition,
      expectedHeadRevision: closure.streamHeadRevision,
      occurredAt: input.occurredAt
    }),
    "tenant stream head advance"
  );
}

async function persistPrivilegedAuthorizationMutation<TResult>(
  transaction: RawSqlExecutor,
  input: WithPrivilegedAuthorizationMutationInput,
  persistDomainMutation: (
    context: InboxV2PrivilegedAuthorizationMutationContext
  ) => Promise<InboxV2PrivilegedAuthorizationMutationCallbackResult<TResult>>,
  loadCommittedResult?: (
    context: InboxV2AuthorizedCommandMutationContext,
    status: InboxV2PrivilegedAuthorizationMutationReplayStatus
  ) => Promise<TResult>
): Promise<WithPrivilegedAuthorizationMutationResult<TResult>> {
  const claim = await transaction.execute<CommandClaimRow>(
    buildClaimInboxV2AuthorizationCommandSql(input)
  );
  assertAtMostOneRow(claim, "authorization command claim");
  if (claim.rows.length === 0) {
    const replay = await loadAuthorizationCommandByIdempotencyScope(
      transaction,
      input
    );
    if (replay === null) {
      const commandIdCollision = await loadAuthorizationCommandById(
        transaction,
        input.tenantId,
        input.command.id
      );
      if (commandIdCollision === null) {
        throw invariantError(
          "Authorization command claim lost without a persisted conflict row."
        );
      }
      return idempotencyConflict();
    }
    if (
      asString(replay.request_hash, "command request hash") !==
      input.command.requestHash
    ) {
      return idempotencyConflict();
    }
    const mutationId = nullableString(replay.mutation_id);
    if (mutationId === null) {
      throw invariantError(
        "A visible authorization command remained pending outside its mutation transaction."
      );
    }

    const status = mapReplayStatus(replay, mutationId);
    if (loadCommittedResult === undefined) {
      // Opaque reconciliation is intentionally available without replaying the
      // original pre-mutation revision plan. No result body is exposed here.
      return {
        kind: "already_applied",
        status
      };
    }

    // Returning a canonical body is a current read. Fence the caller's fresh
    // authorization proof before the DB-only result loader runs.
    const replayAuthorization = await lockAndCheckAuthorizationRevisions(
      transaction,
      input
    );
    if (replayAuthorization.kind !== "locked") {
      throw new AuthorizationMutationAbort(replayAuthorization.result);
    }
    await assertAuthorizationDecisionTemporalFence(transaction, input);
    const replayContext: InboxV2PrivilegedAuthorizationMutationContext =
      Object.freeze({
        executor: transaction,
        tenantId: input.tenantId,
        commandId: status.commandId,
        clientMutationId: input.command.clientMutationId,
        commandTypeId: input.command.commandTypeId,
        actor: snapshotInboxV2AuthorizationActor(input.command.actor),
        authorizationEpoch: input.command.authorizationEpoch,
        authorizationDecisionId: input.command.authorizationDecisionId,
        authorizationDecisionRefs: snapshotInboxV2AuthorizationDecisionRefs(
          input.records.audit.authorizationDecisionRefs
        ),
        authorizationResourceRevisionFences:
          snapshotInboxV2AuthorizationResourceRevisionFences(
            input.revisions.resources
          ),
        authorizedAt: input.command.authorizedAt,
        occurredAt: input.occurredAt,
        mutationId: status.mutationId,
        profile: authorizedCommandMutationProfile(input.records),
        revisionEffects: replayAuthorization.effects
      });
    authorizedCommandMutationContexts.add(replayContext);
    let result: TResult;
    try {
      result = await loadCommittedResult(replayContext, status);
    } finally {
      authorizedCommandMutationContexts.delete(replayContext);
    }
    return {
      kind: "already_applied",
      status,
      result
    };
  }

  const locked = await lockAndCheckAuthorizationRevisions(transaction, input);
  if (locked.kind !== "locked") {
    throw new AuthorizationMutationAbort(locked.result);
  }

  // The authorization proof is useful only while every decision is valid at
  // the database clock. Fence it before the retryable callback so an expired
  // command cannot perform even transaction-local domain writes.
  await assertAuthorizationDecisionTemporalFence(transaction, input);

  const callbackContext: InboxV2PrivilegedAuthorizationMutationContext =
    Object.freeze({
      executor: transaction,
      tenantId: input.tenantId,
      commandId: input.command.id,
      clientMutationId: input.command.clientMutationId,
      commandTypeId: input.command.commandTypeId,
      actor: snapshotInboxV2AuthorizationActor(input.command.actor),
      authorizationEpoch: input.command.authorizationEpoch,
      authorizationDecisionId: input.command.authorizationDecisionId,
      authorizationDecisionRefs: snapshotInboxV2AuthorizationDecisionRefs(
        input.records.audit.authorizationDecisionRefs
      ),
      authorizationResourceRevisionFences:
        snapshotInboxV2AuthorizationResourceRevisionFences(
          input.revisions.resources
        ),
      authorizedAt: input.command.authorizedAt,
      occurredAt: input.occurredAt,
      mutationId: input.records.mutationId,
      profile: authorizedCommandMutationProfile(input.records),
      revisionEffects: locked.effects
    });
  authorizedCommandMutationContexts.add(callbackContext);
  let callbackResult: InboxV2PrivilegedAuthorizationMutationCallbackResult<TResult>;
  try {
    callbackResult = await persistDomainMutation(callbackContext);
  } finally {
    authorizedCommandMutationContexts.delete(callbackContext);
  }
  const relationWrites = normalizeRelationWrites(
    input,
    callbackResult.relationWrites ?? []
  );
  await assertRelationWriteTargetClosure(transaction, input, relationWrites);
  await assertPersistedRoleLegality(
    transaction,
    input,
    relationWrites,
    locked.tenantHead.tenantRbacRevision
  );
  await verifyCallbackManagedResourceRevisions(transaction, input);

  // ADR 0012: this is deliberately the last potentially blocking domain lock.
  await ensureTenantStreamHead(transaction, input);
  const streamHead = await lockTenantStreamHead(transaction, input.tenantId);
  if (streamHead === null) {
    throw invariantError("Tenant stream head bootstrap did not produce a row.");
  }
  const previousPosition = positiveOrZeroCounter(
    streamHead.last_position,
    "tenant stream last position"
  );
  const streamPosition = (BigInt(previousPosition) + 1n).toString();
  const streamEpoch = asString(streamHead.stream_epoch, "tenant stream epoch");
  if (streamEpoch !== input.records.expectedStreamEpoch) {
    throw new AuthorizationMutationAbort({
      kind: "revision_conflict",
      code: "revision.conflict",
      conflicts: [
        {
          kind: "tenant_stream_epoch",
          expectedRevision: input.records.expectedStreamEpoch,
          currentRevision: streamEpoch
        }
      ]
    });
  }
  const streamHeadRevision = positiveCounter(
    streamHead.revision,
    "tenant stream head revision"
  );

  // The callback and final stream-head lock may outlive the first fence. Check
  // the database clock again after the last potentially blocking domain lock,
  // before any canonical commit/audit rows are appended.
  await assertAuthorizationDecisionTemporalFence(transaction, input);

  await applyAuthorizationRevisionAdvances(transaction, input, locked);
  await persistAtomicMutationClosure(transaction, {
    input,
    streamEpoch,
    previousPosition,
    streamPosition,
    streamHeadRevision,
    revisionEffects: locked.effects,
    relationWrites
  });
  return {
    kind: "applied",
    result: callbackResult.result,
    status: {
      commandId: input.command.id,
      mutationId: input.records.mutationId,
      publicResultCode: input.command.publicResultCode,
      resultReference: input.command.resultReference,
      sensitiveResultReference: input.command.sensitiveResultReference,
      streamCommitId: input.records.streamCommitId,
      streamEpoch,
      streamPosition,
      committedAt: input.occurredAt
    },
    revisionEffects: locked.effects
  };
}

export function buildClaimInboxV2AuthorizationCommandSql(
  input: WithPrivilegedAuthorizationMutationInput
): SQL {
  const actor = actorColumns(input.command.actor);
  return sql`
    insert into inbox_v2_auth_command_records (
      tenant_id,
      id,
      first_request_id,
      client_mutation_id,
      command_type_id,
      request_hash,
      actor_kind,
      actor_employee_id,
      actor_trusted_service_id,
      authorization_decision_id,
      authorization_epoch,
      authorization_decision_refs,
      authorized_at,
      authorization_not_after,
      state,
      mutation_id,
      public_result_code,
      sensitive_result_reference,
      revision,
      occurred_at,
      created_at,
      updated_at
    ) values (
      ${input.tenantId},
      ${input.command.id},
      ${input.command.requestId},
      ${input.command.clientMutationId},
      ${input.command.commandTypeId},
      ${input.command.requestHash},
      ${actor.kind},
      ${actor.employeeId},
      ${actor.trustedServiceId},
      ${input.command.authorizationDecisionId},
      ${input.command.authorizationEpoch},
      ${JSON.stringify(input.records.audit.authorizationDecisionRefs)}::jsonb,
      ${input.command.authorizedAt},
      ${earliestAuthorizationNotAfter(input.records.audit.authorizationDecisionRefs)},
      'pending',
      null,
      ${input.command.publicResultCode},
      null,
      1,
      ${input.occurredAt},
      ${input.occurredAt},
      ${input.occurredAt}
    )
    on conflict do nothing
    returning id
  `;
}

export function buildLockInboxV2AuthorizationCommandByScopeSql(
  input: WithPrivilegedAuthorizationMutationInput
): SQL {
  const actor = actorColumns(input.command.actor);
  return sql`
    select command.id,
           command.request_hash,
           command.mutation_id,
           command.public_result_code,
           command.result_reference,
           stream_commit.id as stream_commit_id,
           stream_commit.stream_epoch,
           stream_commit.position as stream_position,
           stream_commit.committed_at
    from inbox_v2_auth_command_records command
    left join inbox_v2_tenant_stream_commits stream_commit
      on stream_commit.tenant_id = command.tenant_id
     and stream_commit.mutation_id = command.mutation_id
    where command.tenant_id = ${input.tenantId}
      and command.actor_kind = ${actor.kind}
      and command.actor_employee_id is not distinct from ${actor.employeeId}
      and command.actor_trusted_service_id is not distinct from ${actor.trustedServiceId}
      and command.command_type_id = ${input.command.commandTypeId}
      and command.client_mutation_id = ${input.command.clientMutationId}
    for update of command
  `;
}

export function buildLockInboxV2AuthorizationCommandByIdSql(input: {
  tenantId: string;
  commandId: string;
}): SQL {
  return sql`
    select command.id,
           command.request_hash,
           command.mutation_id,
           command.public_result_code,
           command.result_reference,
           stream_commit.id as stream_commit_id,
           stream_commit.stream_epoch,
           stream_commit.position as stream_position,
           stream_commit.committed_at
    from inbox_v2_auth_command_records command
    left join inbox_v2_tenant_stream_commits stream_commit
      on stream_commit.tenant_id = command.tenant_id
     and stream_commit.mutation_id = command.mutation_id
    where command.tenant_id = ${input.tenantId}
      and command.id = ${input.commandId}
    for update of command
  `;
}

export function authorizedCommandMutationProfile(
  records: Pick<InboxV2AuthorizationMutationRecords, "relationKind">
): InboxV2AuthorizedCommandMutationProfile {
  return records.relationKind === null ? "domain" : "authorization_relation";
}

function normalizeMutationInput(
  input: WithPrivilegedAuthorizationMutationInput
): WithPrivilegedAuthorizationMutationInput {
  assertExactKeys(
    input,
    ["tenantId", "command", "revisions", "records", "occurredAt"],
    "mutation input"
  );
  assertExactKeys(
    input.command,
    [
      "id",
      "requestId",
      "clientMutationId",
      "commandTypeId",
      "requestHash",
      "actor",
      "authorizationDecisionId",
      "authorizationEpoch",
      "authorizedAt",
      "publicResultCode",
      "resultReference",
      "sensitiveResultReference"
    ],
    "command"
  );
  assertNonEmpty(input.tenantId, "tenantId");
  inboxV2TenantIdSchema.parse(input.tenantId);
  assertNonEmpty(input.command.id, "command.id");
  assertInternalDomainId(input.command.id, "command.id");
  assertNonEmpty(input.command.requestId, "command.requestId");
  inboxV2RequestIdSchema.parse(input.command.requestId);
  assertNonEmpty(input.command.clientMutationId, "command.clientMutationId");
  inboxV2ClientMutationIdSchema.parse(input.command.clientMutationId);
  assertNonEmpty(input.command.commandTypeId, "command.commandTypeId");
  inboxV2CatalogIdSchema.parse(input.command.commandTypeId);
  assertSha256(input.command.requestHash, "command.requestHash");
  assertNonEmpty(
    input.command.authorizationDecisionId,
    "command.authorizationDecisionId"
  );
  assertInternalDomainId(
    input.command.authorizationDecisionId,
    "command.authorizationDecisionId"
  );
  assertNonEmpty(
    input.command.authorizationEpoch,
    "command.authorizationEpoch"
  );
  assertTimestamp(input.command.authorizedAt, "command.authorizedAt");
  assertNonEmpty(input.command.publicResultCode, "command.publicResultCode");
  inboxV2CatalogIdSchema.parse(input.command.publicResultCode);
  if (input.command.resultReference !== null) {
    inboxV2PayloadReferenceSchema.parse(input.command.resultReference);
    if (input.command.resultReference.tenantId !== input.tenantId) {
      throw new TypeError("Command result reference crosses tenant scope.");
    }
  }
  if (input.command.sensitiveResultReference !== null) {
    inboxV2InternalOpaqueReferenceSchema.parse(
      input.command.sensitiveResultReference
    );
  }
  if (
    input.command.actor.kind !== "employee" &&
    input.command.actor.kind !== "trusted_service"
  ) {
    throw new TypeError("Authorization actor kind is not supported.");
  }
  if (input.command.actor.kind === "employee") {
    assertExactKeys(
      input.command.actor,
      ["kind", "employeeId"],
      "employee actor"
    );
    assertNonEmpty(input.command.actor.employeeId, "command.actor.employeeId");
    inboxV2EmployeeIdSchema.parse(input.command.actor.employeeId);
  } else {
    assertExactKeys(
      input.command.actor,
      ["kind", "trustedServiceId"],
      "trusted-service actor"
    );
    assertNonEmpty(
      input.command.actor.trustedServiceId,
      "command.actor.trustedServiceId"
    );
    inboxV2TrustedServiceIdSchema.parse(input.command.actor.trustedServiceId);
  }
  assertTimestamp(input.occurredAt, "occurredAt");
  if (Date.parse(input.command.authorizedAt) > Date.parse(input.occurredAt)) {
    throw new TypeError("Command cannot be authorized after it is recorded.");
  }
  assertExactKeys(
    input.revisions,
    [
      "expectedTenantRbacRevision",
      "expectedSharedAccessRevision",
      "advanceTenantRbac",
      "advanceSharedAccess",
      "employees",
      "resources"
    ],
    "revision plan"
  );
  assertPositiveCounter(
    input.revisions.expectedTenantRbacRevision,
    "revisions.expectedTenantRbacRevision"
  );
  assertPositiveCounter(
    input.revisions.expectedSharedAccessRevision,
    "revisions.expectedSharedAccessRevision"
  );
  if (
    typeof input.revisions.advanceTenantRbac !== "boolean" ||
    typeof input.revisions.advanceSharedAccess !== "boolean"
  ) {
    throw new TypeError("Tenant authorization advance flags must be boolean.");
  }
  if (input.revisions.resources.length > MAX_BOUNDED_RESOURCE_HEADS) {
    throw new TypeError(
      "Authorization mutation resource revision set is unbounded."
    );
  }
  if (input.revisions.employees.length > MAX_BOUNDED_EMPLOYEE_RELATION_HEADS) {
    throw new TypeError(
      "Authorization mutation Employee fence set is unbounded."
    );
  }
  const employees = [...input.revisions.employees].sort((left, right) =>
    comparePostgresCText(left.employeeId, right.employeeId)
  );
  assertUnique(
    employees.map((entry) => entry.employeeId),
    "Employee revisions"
  );
  for (const employee of employees) {
    assertExactKeys(
      employee,
      [
        "employeeId",
        "expectedEmployeeAccessRevision",
        "expectedEmployeeInboxRelationRevision",
        "advanceEmployeeAccess",
        "advanceEmployeeInboxRelation"
      ],
      "Employee revision expectation"
    );
    assertNonEmpty(employee.employeeId, "revisions.employees.employeeId");
    inboxV2EmployeeIdSchema.parse(employee.employeeId);
    if (
      typeof employee.advanceEmployeeAccess !== "boolean" ||
      typeof employee.advanceEmployeeInboxRelation !== "boolean"
    ) {
      throw new TypeError(
        "Employee authorization advance flags must be boolean."
      );
    }
    assertPositiveCounter(
      employee.expectedEmployeeAccessRevision,
      "expectedEmployeeAccessRevision"
    );
    assertPositiveCounter(
      employee.expectedEmployeeInboxRelationRevision,
      "expectedEmployeeInboxRelationRevision"
    );
  }
  const actorEmployeeId =
    input.command.actor.kind === "employee"
      ? input.command.actor.employeeId
      : null;
  if (
    actorEmployeeId !== null &&
    !employees.some(({ employeeId }) => employeeId === actorEmployeeId)
  ) {
    throw new TypeError(
      "Employee privileged commands must fence the actor Employee access head."
    );
  }
  if (
    employees.filter(({ advanceEmployeeAccess }) => advanceEmployeeAccess)
      .length > MAX_BOUNDED_EMPLOYEE_ACCESS_HEADS
  ) {
    throw new TypeError(
      "Authorization mutation Employee access revision set exceeds 64."
    );
  }
  if (
    employees.filter(
      ({ advanceEmployeeInboxRelation }) => advanceEmployeeInboxRelation
    ).length > MAX_BOUNDED_EMPLOYEE_RELATION_HEADS
  ) {
    throw new TypeError(
      "Authorization mutation Employee Inbox relation set exceeds 1000."
    );
  }
  for (const resource of input.revisions.resources) {
    assertAuthorizationResourceKind(resource.resourceKind);
  }
  const resources = [...input.revisions.resources].sort((left, right) => {
    const kindOrder =
      resourceKindOrder(left.resourceKind) -
      resourceKindOrder(right.resourceKind);
    return kindOrder === 0
      ? comparePostgresCText(left.resourceId, right.resourceId)
      : kindOrder;
  });
  assertUnique(
    resources.map((entry) => `${entry.resourceKind}\u0000${entry.resourceId}`),
    "resource revisions"
  );
  for (const resource of resources) {
    assertExactKeys(
      resource,
      [
        "resourceKind",
        "resourceId",
        "resourceHeadId",
        "workItemCycle",
        "expectedWorkItemRevision",
        "expectedResourceAccessRevision",
        "expectedStructuralRelationRevision",
        "advanceStructuralRelation",
        "expectedCollaboratorSetRevision",
        "advanceCollaboratorSet",
        "advance"
      ],
      "resource revision expectation"
    );
    assertNonEmpty(resource.resourceId, "revisions.resources.resourceId");
    assertAuthorizationResourceId(resource.resourceKind, resource.resourceId);
    assertAuthorizationResourceAdvanceMode(resource.advance, "resource access");
    assertPositiveCounter(
      resource.expectedResourceAccessRevision,
      "expectedResourceAccessRevision"
    );
    assertOptionalRelationRevisionPair(
      resource.expectedStructuralRelationRevision,
      resource.advanceStructuralRelation,
      "structural relation"
    );
    assertOptionalRelationRevisionPair(
      resource.expectedCollaboratorSetRevision,
      resource.advanceCollaboratorSet,
      "collaborator set"
    );
    if (
      resource.expectedStructuralRelationRevision !== undefined &&
      resource.expectedCollaboratorSetRevision !== undefined
    ) {
      throw new TypeError(
        "One resource expectation cannot advance two relation aggregates."
      );
    }
    if (resource.resourceKind === "work_item") {
      if (resource.workItemCycle === undefined) {
        throw new TypeError(
          "WorkItem revision fencing requires its exact cycle."
        );
      }
      assertNonNegativeCounter(
        resource.workItemCycle,
        "revisions.resources.workItemCycle"
      );
      assertPositiveCounter(
        resource.expectedWorkItemRevision,
        "revisions.resources.expectedWorkItemRevision"
      );
      if (resource.advance === "repository") {
        throw new TypeError(
          "WorkItem resource access must be advanced by its DB004 relation callback."
        );
      }
      if (resource.expectedStructuralRelationRevision !== undefined) {
        throw new TypeError(
          "WorkItem does not use an authorization structural-relation head."
        );
      }
    } else {
      assertNonEmpty(
        resource.resourceHeadId ?? "",
        "revisions.resources.resourceHeadId"
      );
      assertInternalDomainId(
        resource.resourceHeadId!,
        "revisions.resources.resourceHeadId"
      );
      if (resource.workItemCycle !== undefined) {
        throw new TypeError("Only WorkItem resources carry a cycle fence.");
      }
      if (resource.expectedWorkItemRevision !== undefined) {
        throw new TypeError(
          "Only WorkItem resources carry a WorkItem revision fence."
        );
      }
    }
    if (
      resource.resourceKind === "work_item" &&
      resource.resourceHeadId !== undefined
    ) {
      throw new TypeError(
        "WorkItem does not use an authorization resource head ID."
      );
    }
  }
  assertBoundedRevisionRule(
    input.revisions,
    employees,
    resources,
    input.records.relationKind,
    input.records.audienceImpact
  );
  const records = normalizeMutationRecords(input);
  const normalized = {
    ...input,
    revisions: { ...input.revisions, employees, resources },
    records
  };
  assertDecisionResourceRevisionFences(normalized);
  return recursivelyFrozenAuthorizationSnapshot(normalized);
}

function normalizeMutationRecords(
  input: WithPrivilegedAuthorizationMutationInput
): InboxV2AuthorizationMutationRecords {
  const { records } = input;
  assertExactKeys(
    records,
    [
      "mutationId",
      "relationKind",
      "streamCommitId",
      "expectedStreamEpoch",
      "audienceImpact",
      "commitHash",
      "correlationId",
      "changes",
      "events",
      "outboxIntents",
      "audit"
    ],
    "mutation records"
  );
  for (const [label, value] of [
    ["records.mutationId", records.mutationId],
    ["records.streamCommitId", records.streamCommitId],
    ["records.correlationId", records.correlationId]
  ] as const) {
    assertNonEmpty(value, label);
    assertInternalDomainId(value, label);
  }
  if (records.relationKind !== null) {
    assertAuthorizationRelationKind(records.relationKind);
  }
  assertNonEmpty(records.expectedStreamEpoch, "records.expectedStreamEpoch");
  assertSha256(records.commitHash, "records.commitHash");
  if (
    records.changes.length === 0 ||
    records.events.length === 0 ||
    records.outboxIntents.length === 0
  ) {
    throw new TypeError(
      "Authorization mutation requires a change, event and invalidation outbox intent."
    );
  }
  if (
    records.changes.length > 1_000 ||
    records.events.length > 1_000 ||
    records.outboxIntents.length > 1_000
  ) {
    throw new TypeError(
      "Authorization atomic stream manifests cannot exceed 1000 records per collection."
    );
  }
  const changes = [...records.changes];
  const events = [...records.events];
  const outboxIntents = [...records.outboxIntents];
  assertUnique(
    changes.map(({ id }) => id),
    "stream change IDs"
  );
  assertUnique(
    changes.map(({ ordinal }) => String(ordinal)),
    "stream change ordinals"
  );
  assertUnique(
    events.map(({ id }) => id),
    "domain event IDs"
  );
  assertUnique(
    events.map(({ ordinal }) => String(ordinal)),
    "domain event ordinals"
  );
  assertUnique(
    outboxIntents.map(({ id }) => id),
    "outbox intent IDs"
  );
  assertUnique(
    outboxIntents.map(({ ordinal }) => String(ordinal)),
    "outbox intent ordinals"
  );
  assertConsecutiveOrdinals(
    changes.map(({ ordinal }) => ordinal),
    "stream changes"
  );
  assertConsecutiveOrdinals(
    events.map(({ ordinal }) => Number(ordinal)),
    "domain events"
  );
  assertConsecutiveOrdinals(
    outboxIntents.map(({ ordinal }) => ordinal),
    "outbox intents"
  );
  const commitReference = {
    tenantId: input.tenantId,
    streamEpoch: records.expectedStreamEpoch,
    commitId: records.streamCommitId,
    streamPosition: "1"
  } as const;
  for (const change of changes) {
    assertExactKeys(
      change,
      [
        "id",
        "ordinal",
        "entity",
        "resultingRevision",
        "timeline",
        "audience",
        "state"
      ],
      "stream change"
    );
    const { id, ordinal, ...contractChange } = change;
    inboxV2TenantStreamChangeSchema.parse({
      reference: {
        tenantId: input.tenantId,
        commitId: records.streamCommitId,
        streamPosition: "1",
        changeId: id,
        ordinal: String(ordinal)
      },
      ...contractChange
    });
  }
  for (const event of events) {
    assertExactKeys(
      event,
      [
        "id",
        "typeId",
        "payloadSchemaId",
        "payloadSchemaVersion",
        "ordinal",
        "changeIds",
        "subjects",
        "payloadReference",
        "correlationId",
        "commandIds",
        "clientMutationIds",
        "authorizationDecisionRefs",
        "accessEffect",
        "occurredAt",
        "recordedAt",
        "eventHash"
      ],
      "domain event"
    );
    inboxV2DomainEventSchema.parse({
      tenantId: input.tenantId,
      commit: commitReference,
      ...event
    });
    if (
      event.correlationId !== records.correlationId ||
      !sameStringArray(event.commandIds, [input.command.id]) ||
      !sameStringArray(event.clientMutationIds, [
        input.command.clientMutationId
      ]) ||
      event.recordedAt !== input.occurredAt
    ) {
      throw new TypeError(
        "Authorization event must reference the exact command and correlation."
      );
    }
  }
  const changeIds = new Set(changes.map(({ id }) => String(id)));
  for (const event of events) {
    assertUnique(event.changeIds.map(String), "domain event change IDs");
    if (event.changeIds.some((changeId) => !changeIds.has(String(changeId)))) {
      throw new TypeError(
        "Domain event references a change outside its atomic commit."
      );
    }
    for (const decision of event.authorizationDecisionRefs) {
      const parsed =
        inboxV2AuthorizationDecisionReferenceSchema.parse(decision);
      if (parsed.tenantId !== input.tenantId || parsed.outcome !== "allowed") {
        throw new TypeError(
          "Authorization event decisions must be allowed and same-tenant."
        );
      }
    }
  }
  if (
    authorizedCommandMutationProfile(records) === "authorization_relation" &&
    !events.some(
      (event) =>
        event.typeId === "core:authorization.changed" &&
        event.accessEffect.kind === "may_change_access"
    )
  ) {
    throw new TypeError(
      "Authorization mutation must emit core:authorization.changed with an access effect."
    );
  }
  for (const intent of outboxIntents) {
    assertExactKeys(
      intent,
      [
        "id",
        "ordinal",
        "typeId",
        "handlerId",
        "effectClass",
        "eventId",
        "changeIds",
        "payloadReference",
        "consumerDedupeKey",
        "correlationId",
        "availableAt",
        "intentHash"
      ],
      "outbox intent"
    );
    const { ordinal: _ordinal, ...contractIntent } = intent;
    inboxV2OutboxIntentSchema.parse({
      tenantId: input.tenantId,
      commit: commitReference,
      ...contractIntent
    });
    if (
      intent.correlationId !== records.correlationId ||
      (authorizedCommandMutationProfile(records) === "authorization_relation" &&
        intent.effectClass === "provider_io") ||
      !events.some(({ id }) => id === intent.eventId) ||
      Date.parse(intent.availableAt) < Date.parse(input.occurredAt)
    ) {
      throw new TypeError(
        "Outbox intent must be correlated and event-backed; authorization-relation mutations cannot dispatch provider I/O."
      );
    }
    assertUnique(intent.changeIds.map(String), "outbox intent change IDs");
    const owningEvent = events.find(({ id }) => id === intent.eventId);
    const owningChangeIds = new Set(
      owningEvent?.changeIds.map((changeId) => String(changeId)) ?? []
    );
    if (
      intent.changeIds.some(
        (changeId) =>
          !changeIds.has(String(changeId)) ||
          !owningChangeIds.has(String(changeId))
      )
    ) {
      throw new TypeError(
        "Outbox intent change references must be owned by its event and atomic commit."
      );
    }
  }
  assertUnique(
    outboxIntents.map(({ consumerDedupeKey }) => String(consumerDedupeKey)),
    "outbox consumer dedupe keys"
  );
  if (
    !outboxIntents.some(
      (intent) =>
        intent.typeId === "core:projection.update" &&
        intent.effectClass === "projection" &&
        intent.changeIds.length > 0
    )
  ) {
    throw new TypeError(
      "Authorization mutation must enqueue a non-provider projection invalidation."
    );
  }
  const audit = normalizeAudit(input);
  assertAudienceImpactTenant(records.audienceImpact, input.tenantId);
  inboxV2TenantStreamCommitSchema.parse({
    tenantId: input.tenantId,
    streamEpoch: records.expectedStreamEpoch,
    id: records.streamCommitId,
    position: "1",
    schemaVersion: INBOX_V2_TENANT_STREAM_SCHEMA_VERSION,
    correlationId: records.correlationId,
    commandIds: [input.command.id],
    clientMutationIds: [input.command.clientMutationId],
    authorizationDecisionRefs: audit.authorizationDecisionRefs,
    changeIds: changes.map(({ id }) => id),
    eventIds: events.map(({ id }) => id),
    outboxIntentIds: outboxIntents.map(({ id }) => id),
    audienceImpact: records.audienceImpact,
    committedAt: input.occurredAt,
    commitHash: records.commitHash
  });
  assertAtomicMutationContract({
    input,
    audit,
    changes,
    events,
    outboxIntents
  });
  return {
    ...records,
    changes,
    events,
    outboxIntents,
    audit
  };
}

function assertAtomicMutationContract(input: {
  input: WithPrivilegedAuthorizationMutationInput;
  audit: InboxV2AuthorizationAuditInput;
  changes: readonly InboxV2AuthorizationStreamChangeInput[];
  events: readonly InboxV2AuthorizationDomainEventInput[];
  outboxIntents: readonly InboxV2AuthorizationOutboxIntentInput[];
}): void {
  const mutation = input.input;
  const commitReference = {
    tenantId: mutation.tenantId,
    streamEpoch: mutation.records.expectedStreamEpoch,
    commitId: mutation.records.streamCommitId,
    streamPosition: "1"
  } as const;
  const principal = authorizationCommandPrincipal(mutation);
  const authorizationNotAfter = earliestAuthorizationNotAfter(
    input.audit.authorizationDecisionRefs
  );
  const commit = {
    tenantId: mutation.tenantId,
    streamEpoch: mutation.records.expectedStreamEpoch,
    id: mutation.records.streamCommitId,
    position: "1",
    schemaVersion: INBOX_V2_TENANT_STREAM_SCHEMA_VERSION,
    correlationId: mutation.records.correlationId,
    commandIds: [mutation.command.id],
    clientMutationIds: [mutation.command.clientMutationId],
    authorizationDecisionRefs: input.audit.authorizationDecisionRefs,
    changeIds: input.changes.map(({ id }) => id),
    eventIds: input.events.map(({ id }) => id),
    outboxIntentIds: input.outboxIntents.map(({ id }) => id),
    audienceImpact: mutation.records.audienceImpact,
    committedAt: mutation.occurredAt,
    commitHash: mutation.records.commitHash
  } as const;
  inboxV2AtomicMutationCommitSchema.parse({
    headBefore: {
      tenantId: mutation.tenantId,
      streamEpoch: mutation.records.expectedStreamEpoch,
      lastPosition: "0",
      minRetainedPosition: "0"
    },
    commit,
    changes: input.changes.map(({ id, ordinal, ...change }) => ({
      reference: {
        tenantId: mutation.tenantId,
        commitId: mutation.records.streamCommitId,
        streamPosition: "1",
        changeId: id,
        ordinal: String(ordinal)
      },
      ...change
    })),
    events: input.events.map((event) => ({
      tenantId: mutation.tenantId,
      commit: commitReference,
      ...event
    })),
    outboxIntents: input.outboxIntents.map(
      ({ ordinal: _ordinal, ...intent }) => ({
        tenantId: mutation.tenantId,
        commit: commitReference,
        ...intent
      })
    ),
    commandRecords: [
      {
        scope: {
          tenantId: mutation.tenantId,
          principal,
          commandTypeId: mutation.command.commandTypeId,
          clientMutationId: mutation.command.clientMutationId
        },
        commandId: mutation.command.id,
        firstRequestId: mutation.command.requestId,
        requestHash: mutation.command.requestHash,
        state: {
          kind: "completed",
          result: {
            tenantId: mutation.tenantId,
            commandId: mutation.command.id,
            principal,
            clientMutationId: mutation.command.clientMutationId,
            requestHash: mutation.command.requestHash,
            authorizationEpoch: mutation.command.authorizationEpoch,
            recordedAt: mutation.occurredAt,
            kind: "committed",
            commit: commitReference,
            resultReference: mutation.command.resultReference
          },
          authorizationDecisionRefs: input.audit.authorizationDecisionRefs,
          authorizedAt: mutation.command.authorizedAt,
          authorizationNotAfter
        }
      }
    ],
    headAfter: {
      tenantId: mutation.tenantId,
      streamEpoch: mutation.records.expectedStreamEpoch,
      lastPosition: "1",
      minRetainedPosition: "0"
    }
  });
}

function normalizeAudit(
  input: WithPrivilegedAuthorizationMutationInput
): InboxV2AuthorizationAuditInput {
  const audit = input.records.audit;
  assertExactKeys(
    audit,
    [
      "id",
      "actionId",
      "target",
      "reasonCodeId",
      "matchedPermissionIds",
      "grantSourceIds",
      "authorizationScopeIds",
      "overrideReasonCodeId",
      "policyVersion",
      "evidenceReference",
      "authorizationDecisionRefs",
      "correlationId",
      "outcome",
      "revisionDeltaHash",
      "previousAuditHash",
      "auditHash",
      "occurredAt",
      "recordedAt",
      "expiresAt",
      "facets"
    ],
    "authorization audit"
  );
  for (const [label, value] of [
    ["audit.id", audit.id],
    ["audit.actionId", audit.actionId],
    ["audit.reasonCodeId", audit.reasonCodeId],
    ["audit.correlationId", audit.correlationId]
  ] as const) {
    assertNonEmpty(value, label);
  }
  const target = inboxV2InternalEntityReferenceSchema.parse(audit.target);
  assertInternalDomainId(audit.id, "audit.id");
  if (target.tenantId !== input.tenantId) {
    throw new TypeError(
      "Authorization audit target crosses the mutation tenant."
    );
  }
  if (
    audit.actionId !== input.command.commandTypeId ||
    audit.correlationId !== input.records.correlationId ||
    audit.outcome !== "succeeded"
  ) {
    throw new TypeError(
      "Authorization audit must match the command, correlation and successful outcome."
    );
  }
  inboxV2CatalogIdSchema.parse(audit.actionId);
  inboxV2CatalogIdSchema.parse(audit.reasonCodeId);
  for (const [label, value] of [
    ["audit.revisionDeltaHash", audit.revisionDeltaHash],
    ["audit.auditHash", audit.auditHash]
  ] as const) {
    assertSha256(value, label);
  }
  if (audit.previousAuditHash !== null) {
    assertSha256(audit.previousAuditHash, "audit.previousAuditHash");
  }
  for (const [label, value] of [
    ["audit.occurredAt", audit.occurredAt],
    ["audit.recordedAt", audit.recordedAt],
    ["audit.expiresAt", audit.expiresAt]
  ] as const) {
    assertTimestamp(value, label);
  }
  if (
    Date.parse(audit.occurredAt) > Date.parse(audit.recordedAt) ||
    Date.parse(audit.recordedAt) >= Date.parse(audit.expiresAt) ||
    audit.recordedAt !== input.occurredAt
  ) {
    throw new TypeError(
      "Authorization audit timestamps must be ordered and recorded with the atomic commit."
    );
  }
  if (audit.overrideReasonCodeId !== null) {
    assertNonEmpty(audit.overrideReasonCodeId, "audit.overrideReasonCodeId");
    inboxV2CatalogIdSchema.parse(audit.overrideReasonCodeId);
  }
  if (audit.policyVersion !== null) {
    assertNonEmpty(audit.policyVersion, "audit.policyVersion");
    if (audit.policyVersion.length > 128) {
      throw new TypeError("audit.policyVersion exceeds 128 characters.");
    }
    inboxV2SchemaVersionTokenSchema.parse(audit.policyVersion);
  }
  if (audit.evidenceReference !== null) {
    const evidence = inboxV2PayloadReferenceSchema.parse(
      audit.evidenceReference
    );
    if (evidence.tenantId !== input.tenantId) {
      throw new TypeError(
        "Audit evidence reference crosses the mutation tenant."
      );
    }
  }
  if (audit.facets.length === 0) {
    throw new TypeError(
      "Privileged authorization mutation requires audit facets."
    );
  }
  if (audit.facets.length > 64) {
    throw new TypeError("Privileged authorization audit has too many facets.");
  }
  const facets = [...audit.facets];
  assertUnique(
    facets.map(({ ordinal }) => String(ordinal)),
    "audit facet ordinals"
  );
  assertConsecutiveOrdinals(
    facets.map(({ ordinal }) => ordinal),
    "audit facets"
  );
  assertCanonicalOrder(
    facets.map(
      ({ dimension, reference, relation }) =>
        `${dimension}\u0000${reference.entityTypeId}\u0000${reference.entityId}\u0000${relation}`
    ),
    "audit facets"
  );
  for (const facet of facets) {
    assertExactKeys(
      facet,
      ["ordinal", "dimension", "reference", "relation", "facetHash"],
      "authorization audit facet"
    );
    const reference = inboxV2InternalEntityReferenceSchema.parse(
      facet.reference
    );
    if (
      facet.relation !== "source" &&
      facet.relation !== "destination" &&
      facet.relation !== "affected"
    ) {
      throw new TypeError("Authorization audit facet relation is invalid.");
    }
    if (
      reference.tenantId !== input.tenantId ||
      auditFacetKind(reference) !== facet.dimension
    ) {
      throw new TypeError(
        "Audit facet must be same-tenant and use its target-derived dimension."
      );
    }
    assertSha256(facet.facetHash, "audit facet hash");
  }
  const decisions = [...audit.authorizationDecisionRefs];
  if (decisions.length === 0 || decisions.length > 64) {
    throw new TypeError("Authorization audit requires a bounded decision set.");
  }
  assertUnique(
    decisions.map(({ id }) => String(id)),
    "authorization decision IDs"
  );
  assertCanonicalOrder(
    decisions.map(({ id }) => String(id)),
    "authorization decision IDs"
  );
  for (const decision of decisions) {
    const parsed = inboxV2AuthorizationDecisionReferenceSchema.parse(decision);
    if (
      parsed.tenantId !== input.tenantId ||
      parsed.outcome !== "allowed" ||
      parsed.authorizationEpoch !== input.command.authorizationEpoch ||
      !decisionPrincipalMatchesActor(parsed, input.command.actor) ||
      Date.parse(parsed.decidedAt) > Date.parse(input.command.authorizedAt) ||
      Date.parse(input.command.authorizedAt) >= Date.parse(parsed.notAfter)
    ) {
      throw new TypeError(
        "Authorization audit decision is not the current allowed command decision."
      );
    }
  }
  if (
    !decisions.some(
      ({ id, authorizationEpoch }) =>
        id === input.command.authorizationDecisionId &&
        authorizationEpoch === input.command.authorizationEpoch
    )
  ) {
    throw new TypeError(
      "Authorization audit omits the command decision proof."
    );
  }
  const matchedPermissionIds = normalizedAuditCatalogIdArray(
    audit.matchedPermissionIds,
    "matched permission IDs"
  );
  const grantSourceIds = normalizedAuditInternalRefArray(
    audit.grantSourceIds,
    "grant source IDs"
  );
  const authorizationScopeIds = normalizedAuditCatalogIdArray(
    audit.authorizationScopeIds,
    "authorization scope IDs"
  );
  return {
    ...audit,
    target,
    matchedPermissionIds,
    grantSourceIds,
    authorizationScopeIds,
    authorizationDecisionRefs: decisions,
    facets
  };
}

function assertBoundedRevisionRule(
  revisions: InboxV2AuthorizationRevisionPlan,
  employees: readonly InboxV2AuthorizationEmployeeRevisionExpectation[],
  resources: readonly InboxV2AuthorizationResourceRevisionExpectation[],
  relationKind: InboxV2AuthorizationMutationRecords["relationKind"],
  audienceImpact: InboxV2AuthorizationMutationRecords["audienceImpact"]
): void {
  const employeeAccessAdvances = employees.filter(
    ({ advanceEmployeeAccess }) => advanceEmployeeAccess
  );
  const employeeRelationAdvances = employees.filter(
    ({ advanceEmployeeInboxRelation }) => advanceEmployeeInboxRelation
  );
  const resourceAdvances = resources.filter(
    ({ advance }) => advance !== "none"
  );
  const structuralRelationAdvances = resources.filter(
    ({ advanceStructuralRelation }) =>
      advanceStructuralRelation !== undefined &&
      advanceStructuralRelation !== "none"
  );
  const collaboratorSetAdvances = resources.filter(
    ({ advanceCollaboratorSet }) =>
      advanceCollaboratorSet !== undefined && advanceCollaboratorSet !== "none"
  );
  if (relationKind === null) {
    if (
      revisions.advanceTenantRbac ||
      revisions.advanceSharedAccess ||
      employeeAccessAdvances.length > 0 ||
      employeeRelationAdvances.length > 0 ||
      resourceAdvances.length > 0 ||
      structuralRelationAdvances.length > 0 ||
      collaboratorSetAdvances.length > 0 ||
      audienceImpact.kind !== "none"
    ) {
      throw new TypeError(
        "Domain mutation cannot advance authorization relations or declare an authorization audience impact."
      );
    }
    return;
  }
  const expectExactShape = (input: {
    tenantRbac: boolean;
    sharedAccess: boolean;
    employeeAccess: "none" | "some";
    employeeRelation: "none" | "some";
    resources: "none" | "some";
    relationAggregate: "none" | "structural" | "collaborator";
    audience: InboxV2AuthorizationMutationRecords["audienceImpact"]["kind"];
  }) => {
    if (
      revisions.advanceTenantRbac !== input.tenantRbac ||
      revisions.advanceSharedAccess !== input.sharedAccess ||
      employees.some(
        ({ advanceEmployeeAccess, advanceEmployeeInboxRelation }) =>
          advanceEmployeeAccess && advanceEmployeeInboxRelation
      ) ||
      (employeeAccessAdvances.length === 0) !==
        (input.employeeAccess === "none") ||
      (employeeRelationAdvances.length === 0) !==
        (input.employeeRelation === "none") ||
      (resourceAdvances.length === 0) !== (input.resources === "none") ||
      structuralRelationAdvances.length > 0 !==
        (input.relationAggregate === "structural") ||
      collaboratorSetAdvances.length > 0 !==
        (input.relationAggregate === "collaborator") ||
      audienceImpact.kind !== input.audience
    ) {
      throw new TypeError(
        `Authorization relation ${relationKind} has an incompatible revision/audience shape.`
      );
    }
  };
  if (relationKind === "role" || relationKind === "role_binding") {
    expectExactShape({
      tenantRbac: true,
      sharedAccess: false,
      employeeAccess: "none",
      employeeRelation: "none",
      resources: "none",
      relationAggregate: "none",
      audience: "tenant_rbac"
    });
    if (
      audienceImpact.kind !== "tenant_rbac" ||
      audienceImpact.previousTenantRbacRevision !==
        revisions.expectedTenantRbacRevision ||
      audienceImpact.resultingTenantRbacRevision !==
        incrementCounter(revisions.expectedTenantRbacRevision)
    ) {
      throw new TypeError(
        "Tenant RBAC audience manifest does not match the exact revision step."
      );
    }
    return;
  }
  if (
    relationKind === "direct_grant" ||
    relationKind === "workforce_membership"
  ) {
    expectExactShape({
      tenantRbac: false,
      sharedAccess: false,
      employeeAccess: "some",
      employeeRelation: "none",
      resources: "none",
      relationAggregate: "none",
      audience: "direct"
    });
    assertDirectAudienceEmployees(
      audienceImpact,
      employeeAccessAdvances.map(({ employeeId }) => employeeId)
    );
    return;
  }
  if (
    relationKind === "structural_access" ||
    relationKind === "servicing_team"
  ) {
    expectExactShape({
      tenantRbac: false,
      sharedAccess: true,
      employeeAccess: "none",
      employeeRelation: "none",
      resources: "some",
      relationAggregate:
        relationKind === "structural_access" ? "structural" : "none",
      audience: "structural"
    });
    if (
      audienceImpact.kind !== "structural" ||
      audienceImpact.previousSharedAccessRevision !==
        revisions.expectedSharedAccessRevision ||
      audienceImpact.resultingSharedAccessRevision !==
        incrementCounter(revisions.expectedSharedAccessRevision)
    ) {
      throw new TypeError(
        "Structural audience manifest does not match the exact shared revision step."
      );
    }
    if (
      relationKind === "structural_access" &&
      (structuralRelationAdvances.length !== resourceAdvances.length ||
        resourceAdvances.some(
          (resource) =>
            resource.advanceStructuralRelation === undefined ||
            resource.advanceStructuralRelation === "none"
        ))
    ) {
      throw new TypeError(
        "Structural access must advance each exact structural relation aggregate."
      );
    }
    return;
  }
  const collaboratorMutation =
    relationKind === "conversation_collaborator" ||
    relationKind === "work_item_collaborator";
  expectExactShape({
    tenantRbac: false,
    sharedAccess: false,
    employeeAccess: "none",
    employeeRelation: "some",
    resources: "none",
    relationAggregate: collaboratorMutation ? "collaborator" : "none",
    audience: "direct"
  });
  if (collaboratorMutation && collaboratorSetAdvances.length !== 1) {
    throw new TypeError(
      "A collaborator mutation must advance exactly one collaborator-set aggregate."
    );
  }
  assertDirectAudienceEmployees(
    audienceImpact,
    employeeRelationAdvances.map(({ employeeId }) => employeeId)
  );
  if (
    relationKind === "conversation_collaborator" &&
    collaboratorSetAdvances.some(
      ({ resourceKind }) => resourceKind !== "conversation"
    )
  ) {
    throw new TypeError(
      "Conversation collaborator aggregate advance must target a Conversation."
    );
  }
  if (
    relationKind === "work_item_collaborator" &&
    collaboratorSetAdvances.some(
      ({ resourceKind, advanceCollaboratorSet }) =>
        resourceKind !== "work_item" || advanceCollaboratorSet !== "callback"
    )
  ) {
    throw new TypeError(
      "WorkItem collaborator aggregate must be advanced by the DB004 callback."
    );
  }
}

function assertDecisionResourceRevisionFences(
  input: WithPrivilegedAuthorizationMutationInput
): void {
  for (const decision of input.records.audit.authorizationDecisionRefs) {
    const resourceKind = authorizationResourceKindFromEntityType(
      String(decision.resource.entityTypeId)
    );
    if (resourceKind === null) continue;
    const resource = input.revisions.resources.find(
      (expectation) =>
        expectation.resourceKind === resourceKind &&
        expectation.resourceId === String(decision.resource.entityId)
    );
    if (
      resource === undefined ||
      resource.expectedResourceAccessRevision !==
        decision.resourceAccessRevision
    ) {
      throw new TypeError(
        "Privileged command must fence every authorization-decision resource revision."
      );
    }
  }
}

function authorizationResourceKindFromEntityType(
  entityTypeId: string
): InboxV2AuthorizationResourceKind | null {
  switch (entityTypeId) {
    case "core:conversation":
      return "conversation";
    case "core:client":
      return "client";
    case "core:source-account":
      return "source_account";
    case "core:work-item":
      return "work_item";
    default:
      return null;
  }
}

type LockedAuthorizationRevisionState = Readonly<{
  kind: "locked";
  tenantHead: Readonly<{
    tenantRbacRevision: string;
    sharedAccessRevision: string;
    revision: string;
  }>;
  employeeHeads: ReadonlyMap<
    string,
    Readonly<{
      employeeAccessRevision: string;
      employeeInboxRelationRevision: string;
      revision: string;
    }>
  >;
  resourceHeads: ReadonlyMap<
    string,
    Readonly<{
      resourceHeadId: string | null;
      workItemCycle: string | null;
      resourceAccessRevision: string;
      structuralRelationRevision: string | null;
      collaboratorSetRevision: string;
      revision: string;
    }>
  >;
  effects: readonly InboxV2AuthorizationRevisionEffect[];
}>;

type FailedAuthorizationRevisionLock = Readonly<{
  kind: "failed";
  result:
    | Extract<
        WithPrivilegedAuthorizationMutationResult<never>,
        { kind: "resource_not_found" }
      >
    | Extract<
        WithPrivilegedAuthorizationMutationResult<never>,
        { kind: "revision_conflict" }
      >;
}>;

async function lockAndCheckAuthorizationRevisions(
  transaction: RawSqlExecutor,
  input: WithPrivilegedAuthorizationMutationInput
): Promise<LockedAuthorizationRevisionState | FailedAuthorizationRevisionLock> {
  await transaction.execute(
    buildEnsureInboxV2AuthorizationTenantHeadSql(input)
  );
  const tenantResult = await transaction.execute<TenantHeadRow>(
    buildLockInboxV2AuthorizationTenantHeadSql(input.tenantId)
  );
  assertAtMostOneRow(tenantResult, "authorization tenant head lock");
  const tenantRow = tenantResult.rows[0];
  if (tenantRow === undefined) {
    return { kind: "failed", result: { kind: "resource_not_found" } };
  }
  const tenantHead = {
    tenantRbacRevision: positiveCounter(
      tenantRow.tenant_rbac_revision,
      "tenant RBAC revision"
    ),
    sharedAccessRevision: positiveCounter(
      tenantRow.shared_access_revision,
      "shared access revision"
    ),
    revision: positiveCounter(
      tenantRow.revision,
      "authorization tenant head revision"
    )
  };

  const employeeHeads = await lockEmployeeRevisionHeads(transaction, input);
  if (employeeHeads === null) {
    return { kind: "failed", result: { kind: "resource_not_found" } };
  }
  const resourceHeads = await lockResourceRevisionHeads(transaction, input);
  if (resourceHeads === null) {
    return { kind: "failed", result: { kind: "resource_not_found" } };
  }
  const conflicts = collectRevisionConflicts(
    input,
    tenantHead,
    employeeHeads,
    resourceHeads
  );
  if (conflicts.length > 0) {
    return {
      kind: "failed",
      result: {
        kind: "revision_conflict",
        code: "auth.access_revision_stale",
        conflicts
      }
    };
  }
  return {
    kind: "locked",
    tenantHead,
    employeeHeads,
    resourceHeads,
    effects: buildAuthorizationRevisionEffects(input)
  };
}

async function lockEmployeeRevisionHeads(
  transaction: RawSqlExecutor,
  input: WithPrivilegedAuthorizationMutationInput
): Promise<LockedAuthorizationRevisionState["employeeHeads"] | null> {
  if (input.revisions.employees.length === 0) return new Map();
  await transaction.execute(
    buildEnsureInboxV2AuthorizationEmployeeHeadsSql(input)
  );
  const result = await transaction.execute<EmployeeHeadRow>(
    buildLockInboxV2AuthorizationEmployeeHeadsSql(input)
  );
  if (result.rows.length !== input.revisions.employees.length) return null;
  const heads = new Map<
    string,
    {
      employeeAccessRevision: string;
      employeeInboxRelationRevision: string;
      revision: string;
    }
  >();
  for (const row of result.rows) {
    const employeeId = asString(row.employee_id, "authorization Employee ID");
    if (heads.has(employeeId)) {
      throw invariantError(
        "Authorization Employee lock returned a duplicate row."
      );
    }
    heads.set(employeeId, {
      employeeAccessRevision: positiveCounter(
        row.employee_access_revision,
        "Employee access revision"
      ),
      employeeInboxRelationRevision: positiveCounter(
        row.employee_inbox_relation_revision,
        "Employee Inbox relation revision"
      ),
      revision: positiveCounter(
        row.revision,
        "authorization Employee head revision"
      )
    });
  }
  return heads;
}

async function lockResourceRevisionHeads(
  transaction: RawSqlExecutor,
  input: WithPrivilegedAuthorizationMutationInput
): Promise<LockedAuthorizationRevisionState["resourceHeads"] | null> {
  const structuralResources = input.revisions.resources.filter(
    ({ resourceKind }) => resourceKind !== "work_item"
  );
  const workItems = input.revisions.resources.filter(
    ({ resourceKind }) => resourceKind === "work_item"
  );
  const heads = new Map<
    string,
    {
      resourceHeadId: string | null;
      workItemCycle: string | null;
      resourceAccessRevision: string;
      structuralRelationRevision: string | null;
      collaboratorSetRevision: string;
      revision: string;
    }
  >();
  if (structuralResources.length > 0) {
    await transaction.execute(
      buildEnsureInboxV2AuthorizationResourceHeadsSql(
        input.tenantId,
        structuralResources,
        input.occurredAt
      )
    );
    const result = await transaction.execute<ResourceHeadRow>(
      buildLockInboxV2AuthorizationResourceHeadsSql(
        input.tenantId,
        structuralResources
      )
    );
    if (result.rows.length !== structuralResources.length) return null;
    addResourceRows(heads, result.rows);
  }
  if (workItems.length > 0) {
    const result = await transaction.execute<ResourceHeadRow>(
      buildLockInboxV2AuthorizationWorkItemResourceHeadsSql(
        input.tenantId,
        workItems
      )
    );
    if (result.rows.length !== workItems.length) return null;
    addResourceRows(heads, result.rows);
  }
  return heads;
}

function addResourceRows(
  target: Map<
    string,
    {
      resourceHeadId: string | null;
      workItemCycle: string | null;
      resourceAccessRevision: string;
      structuralRelationRevision: string | null;
      collaboratorSetRevision: string;
      revision: string;
    }
  >,
  rows: readonly ResourceHeadRow[]
): void {
  for (const row of rows) {
    const resourceKind = asResourceKind(row.resource_kind);
    const resourceId = asString(row.resource_id, "authorization resource ID");
    const key = resourceKey(resourceKind, resourceId);
    if (target.has(key)) {
      throw invariantError(
        "Authorization resource lock returned a duplicate row."
      );
    }
    target.set(key, {
      resourceHeadId:
        resourceKind === "work_item"
          ? nullableString(row.head_id)
          : asString(row.head_id, "authorization resource head ID"),
      workItemCycle:
        resourceKind === "work_item"
          ? positiveOrZeroCounter(
              row.work_item_cycle,
              "authorization WorkItem cycle"
            )
          : null,
      resourceAccessRevision: positiveCounter(
        row.resource_access_revision,
        "resource access revision"
      ),
      structuralRelationRevision:
        resourceKind === "work_item"
          ? null
          : positiveCounter(
              row.structural_relation_revision,
              "structural relation revision"
            ),
      collaboratorSetRevision: positiveCounter(
        row.collaborator_set_revision,
        "collaborator set revision"
      ),
      revision: positiveCounter(
        row.revision,
        "authorization resource head revision"
      )
    });
  }
}

function collectRevisionConflicts(
  input: WithPrivilegedAuthorizationMutationInput,
  tenantHead: LockedAuthorizationRevisionState["tenantHead"],
  employeeHeads: LockedAuthorizationRevisionState["employeeHeads"],
  resourceHeads: LockedAuthorizationRevisionState["resourceHeads"]
): InboxV2AuthorizationRevisionConflict[] {
  const conflicts: InboxV2AuthorizationRevisionConflict[] = [];
  if (
    tenantHead.tenantRbacRevision !== input.revisions.expectedTenantRbacRevision
  ) {
    conflicts.push({
      kind: "tenant_rbac",
      expectedRevision: input.revisions.expectedTenantRbacRevision,
      currentRevision: tenantHead.tenantRbacRevision
    });
  }
  if (
    tenantHead.sharedAccessRevision !==
    input.revisions.expectedSharedAccessRevision
  ) {
    conflicts.push({
      kind: "shared_access",
      expectedRevision: input.revisions.expectedSharedAccessRevision,
      currentRevision: tenantHead.sharedAccessRevision
    });
  }
  for (const expectation of input.revisions.employees) {
    const current = employeeHeads.get(expectation.employeeId);
    if (current === undefined) continue;
    if (
      current.employeeAccessRevision !==
      expectation.expectedEmployeeAccessRevision
    ) {
      conflicts.push({
        kind: "employee_access",
        employeeId: expectation.employeeId,
        expectedRevision: expectation.expectedEmployeeAccessRevision,
        currentRevision: current.employeeAccessRevision
      });
    }
    if (
      current.employeeInboxRelationRevision !==
      expectation.expectedEmployeeInboxRelationRevision
    ) {
      conflicts.push({
        kind: "employee_inbox_relation",
        employeeId: expectation.employeeId,
        expectedRevision: expectation.expectedEmployeeInboxRelationRevision,
        currentRevision: current.employeeInboxRelationRevision
      });
    }
  }
  for (const expectation of input.revisions.resources) {
    const current = resourceHeads.get(
      resourceKey(expectation.resourceKind, expectation.resourceId)
    );
    if (
      current !== undefined &&
      expectation.resourceKind === "work_item" &&
      current.revision !== expectation.expectedWorkItemRevision
    ) {
      conflicts.push({
        kind: "work_item_revision",
        resourceKind: expectation.resourceKind,
        resourceId: expectation.resourceId,
        workItemCycle: expectation.workItemCycle,
        expectedRevision: expectation.expectedWorkItemRevision,
        currentRevision: current.revision
      });
    }
    if (
      current !== undefined &&
      current.resourceAccessRevision !==
        expectation.expectedResourceAccessRevision
    ) {
      conflicts.push({
        kind: "resource_access",
        resourceKind: expectation.resourceKind,
        resourceId: expectation.resourceId,
        ...(expectation.workItemCycle === undefined
          ? {}
          : { workItemCycle: expectation.workItemCycle }),
        expectedRevision: expectation.expectedResourceAccessRevision,
        currentRevision: current.resourceAccessRevision
      });
    }
    if (
      current !== undefined &&
      expectation.expectedStructuralRelationRevision !== undefined &&
      current.structuralRelationRevision !==
        expectation.expectedStructuralRelationRevision
    ) {
      conflicts.push({
        kind: "structural_relation",
        resourceKind: expectation.resourceKind,
        resourceId: expectation.resourceId,
        expectedRevision: expectation.expectedStructuralRelationRevision,
        currentRevision: current.structuralRelationRevision ?? "missing"
      });
    }
    if (
      current !== undefined &&
      expectation.expectedCollaboratorSetRevision !== undefined &&
      current.collaboratorSetRevision !==
        expectation.expectedCollaboratorSetRevision
    ) {
      conflicts.push({
        kind: "collaborator_set",
        resourceKind: expectation.resourceKind,
        resourceId: expectation.resourceId,
        ...(expectation.workItemCycle === undefined
          ? {}
          : { workItemCycle: expectation.workItemCycle }),
        expectedRevision: expectation.expectedCollaboratorSetRevision,
        currentRevision: current.collaboratorSetRevision
      });
    }
  }
  return conflicts;
}

function buildAuthorizationRevisionEffects(
  input: WithPrivilegedAuthorizationMutationInput
): InboxV2AuthorizationRevisionEffect[] {
  const effects: InboxV2AuthorizationRevisionEffect[] = [];
  const effect = (
    kind: InboxV2AuthorizationRevisionEffect["kind"],
    previousRevision: string,
    suffix: string,
    details?: Partial<
      Pick<
        InboxV2AuthorizationRevisionEffect,
        | "employeeId"
        | "resourceKind"
        | "resourceId"
        | "workItemCycle"
        | "expectedWorkItemRevision"
        | "resultingWorkItemRevision"
      >
    >
  ) => {
    effects.push({
      id: `${input.records.mutationId}:revision:${suffix}`,
      kind,
      employeeId: details?.employeeId ?? null,
      resourceKind: details?.resourceKind ?? null,
      resourceId: details?.resourceId ?? null,
      resourceHeadId:
        details?.resourceKind !== undefined &&
        details.resourceKind !== "work_item"
          ? (input.revisions.resources.find(
              (resource) =>
                resource.resourceKind === details.resourceKind &&
                resource.resourceId === details.resourceId
            )?.resourceHeadId ?? null)
          : null,
      workItemCycle: details?.workItemCycle ?? null,
      expectedWorkItemRevision: details?.expectedWorkItemRevision ?? null,
      resultingWorkItemRevision: details?.resultingWorkItemRevision ?? null,
      previousRevision,
      resultingRevision: incrementCounter(previousRevision)
    });
  };
  if (input.revisions.advanceTenantRbac) {
    effect(
      "tenant_rbac",
      input.revisions.expectedTenantRbacRevision,
      "tenant-rbac"
    );
  }
  if (input.revisions.advanceSharedAccess) {
    effect(
      "shared_access",
      input.revisions.expectedSharedAccessRevision,
      "shared-access"
    );
  }
  for (const employee of input.revisions.employees) {
    if (employee.advanceEmployeeAccess) {
      effect(
        "employee_access",
        employee.expectedEmployeeAccessRevision,
        `employee-access:${employee.employeeId}`,
        { employeeId: employee.employeeId }
      );
    }
    if (employee.advanceEmployeeInboxRelation) {
      effect(
        "employee_inbox_relation",
        employee.expectedEmployeeInboxRelationRevision,
        `employee-inbox-relation:${employee.employeeId}`,
        { employeeId: employee.employeeId }
      );
    }
  }
  for (const resource of input.revisions.resources) {
    if (resource.advance !== "none") {
      effect(
        "resource_access",
        resource.expectedResourceAccessRevision,
        `resource-access:${resource.resourceKind}:${resource.resourceId}`,
        {
          resourceKind: resource.resourceKind,
          resourceId: resource.resourceId
        }
      );
    }
    if (
      resource.advanceCollaboratorSet !== undefined &&
      resource.advanceCollaboratorSet !== "none"
    ) {
      const workItem = resource.resourceKind === "work_item";
      effect(
        "collaborator_set",
        resource.expectedCollaboratorSetRevision ??
          (() => {
            throw invariantError(
              "Collaborator-set advance has no expected aggregate revision."
            );
          })(),
        `collaborator-set:${resource.resourceKind}:${resource.resourceId}`,
        {
          resourceKind: resource.resourceKind,
          resourceId: resource.resourceId,
          workItemCycle: workItem ? (resource.workItemCycle ?? null) : null,
          expectedWorkItemRevision: workItem
            ? resource.expectedWorkItemRevision
            : null,
          resultingWorkItemRevision: workItem
            ? incrementCounter(resource.expectedWorkItemRevision)
            : null
        }
      );
    }
  }
  return effects;
}

export function buildEnsureInboxV2AuthorizationTenantHeadSql(
  input: Pick<
    WithPrivilegedAuthorizationMutationInput,
    "tenantId" | "occurredAt"
  >
): SQL {
  return sql`
    insert into inbox_v2_auth_tenant_heads (
      tenant_id,
      tenant_rbac_revision,
      shared_access_revision,
      revision,
      created_at,
      updated_at
    )
    select tenant.id, 1, 1, 1, ${input.occurredAt}, ${input.occurredAt}
    from tenants tenant
    where tenant.id = ${input.tenantId}
    on conflict (tenant_id) do nothing
  `;
}

export function buildLockInboxV2AuthorizationTenantHeadSql(
  tenantId: string
): SQL {
  return sql`
    select tenant_rbac_revision,
           shared_access_revision,
           revision
    from inbox_v2_auth_tenant_heads
    where tenant_id = ${tenantId}
    for update
  `;
}

export function buildEnsureInboxV2AuthorizationEmployeeHeadsSql(
  input: WithPrivilegedAuthorizationMutationInput
): SQL {
  const employeeIds = JSON.stringify(
    input.revisions.employees.map(({ employeeId }) => ({
      employee_id: employeeId
    }))
  );
  return sql`
    with requested as (
      select employee_id
      from jsonb_to_recordset(${employeeIds}::jsonb)
        as requested_row(employee_id text)
      order by employee_id collate "C"
    )
    insert into inbox_v2_auth_employee_heads (
      tenant_id,
      employee_id,
      employee_access_revision,
      employee_inbox_relation_revision,
      revision,
      created_at,
      updated_at
    )
    select employee.tenant_id,
           employee.id,
           1,
           1,
           1,
           ${input.occurredAt},
           ${input.occurredAt}
    from requested
    inner join employees employee
      on employee.tenant_id = ${input.tenantId}
     and employee.id = requested.employee_id
    order by employee.id collate "C"
    on conflict (tenant_id, employee_id) do nothing
  `;
}

export function buildLockInboxV2AuthorizationEmployeeHeadsSql(
  input: Pick<
    WithPrivilegedAuthorizationMutationInput,
    "tenantId" | "revisions"
  >
): SQL {
  const employeeIds = JSON.stringify(
    input.revisions.employees.map(({ employeeId }) => ({
      employee_id: employeeId
    }))
  );
  return sql`
    with requested as (
      select employee_id
      from jsonb_to_recordset(${employeeIds}::jsonb)
        as requested_row(employee_id text)
    )
    select head.employee_id,
           head.employee_access_revision,
           head.employee_inbox_relation_revision,
           head.revision
    from requested
    inner join inbox_v2_auth_employee_heads head
      on head.tenant_id = ${input.tenantId}
     and head.employee_id = requested.employee_id
    order by head.employee_id collate "C"
    for update of head
  `;
}

export function buildEnsureInboxV2AuthorizationResourceHeadsSql(
  tenantId: string,
  resources: readonly InboxV2AuthorizationResourceRevisionExpectation[],
  occurredAt: string
): SQL {
  const rows = serializeStructuralResourceRequests(resources);
  return sql`
    with requested as (
      select *
      from jsonb_to_recordset(${rows}::jsonb)
        as requested_row(
          head_id text,
          resource_kind text,
          conversation_id text,
          client_id text,
          source_account_id text
        )
    ),
    existing_resource as (
      select requested.*
      from requested
      where (requested.resource_kind = 'conversation'
          and exists (
            select 1
            from inbox_v2_conversations conversation
            where conversation.tenant_id = ${tenantId}
              and conversation.id = requested.conversation_id
          ))
         or (requested.resource_kind = 'client'
          and exists (
            select 1
            from clients client
            where client.tenant_id = ${tenantId}
              and client.id = requested.client_id
          ))
         or (requested.resource_kind = 'source_account'
          and exists (
            select 1
            from source_accounts source_account
            where source_account.tenant_id = ${tenantId}
              and source_account.id = requested.source_account_id
          ))
      order by requested.resource_kind collate "C",
               coalesce(
                 requested.conversation_id,
                 requested.client_id,
                 requested.source_account_id
               ) collate "C"
    )
    insert into inbox_v2_auth_resource_heads (
      tenant_id,
      id,
      resource_kind,
      conversation_id,
      client_id,
      source_account_id,
      resource_access_revision,
      structural_relation_revision,
      collaborator_set_revision,
      revision,
      created_at,
      updated_at
    )
    select ${tenantId},
           existing_resource.head_id,
           existing_resource.resource_kind::inbox_v2_auth_structural_resource_kind,
           existing_resource.conversation_id,
           existing_resource.client_id,
           existing_resource.source_account_id,
           1,
           1,
           1,
           1,
           ${occurredAt},
           ${occurredAt}
    from existing_resource
    on conflict do nothing
  `;
}

export function buildLockInboxV2AuthorizationResourceHeadsSql(
  tenantId: string,
  resources: readonly InboxV2AuthorizationResourceRevisionExpectation[]
): SQL {
  const rows = serializeStructuralResourceRequests(resources);
  return sql`
    with requested as (
      select *
      from jsonb_to_recordset(${rows}::jsonb)
        as requested_row(
          head_id text,
          resource_kind text,
          conversation_id text,
          client_id text,
          source_account_id text
        )
    )
    select head.id as head_id,
           head.resource_kind::text as resource_kind,
           coalesce(
             head.conversation_id,
             head.client_id,
             head.source_account_id
           ) as resource_id,
           null::bigint as work_item_cycle,
           head.resource_access_revision,
           head.structural_relation_revision,
           head.collaborator_set_revision,
           head.revision
    from requested
    inner join inbox_v2_auth_resource_heads head
     on head.tenant_id = ${tenantId}
     and head.id = requested.head_id
     and head.resource_kind::text = requested.resource_kind
     and head.conversation_id is not distinct from requested.conversation_id
     and head.client_id is not distinct from requested.client_id
     and head.source_account_id is not distinct from requested.source_account_id
    order by head.resource_kind::text collate "C",
             coalesce(
               head.conversation_id,
               head.client_id,
               head.source_account_id
             ) collate "C"
    for update of head
  `;
}

export function buildLockInboxV2AuthorizationWorkItemResourceHeadsSql(
  tenantId: string,
  resources: readonly InboxV2AuthorizationResourceRevisionExpectation[]
): SQL {
  const workItemIds = JSON.stringify(
    resources.map(({ resourceId, workItemCycle }) => ({
      work_item_id: resourceId,
      work_item_cycle: workItemCycle
    }))
  );
  return sql`
    with requested as (
      select work_item_id, work_item_cycle
      from jsonb_to_recordset(${workItemIds}::jsonb)
        as requested_row(work_item_id text, work_item_cycle bigint)
    )
    select null::text as head_id,
           'work_item'::text as resource_kind,
           work_item.id as resource_id,
           work_item.reopen_cycle as work_item_cycle,
           work_item.resource_access_revision,
           null::bigint as structural_relation_revision,
           work_item.collaborator_set_revision,
           work_item.revision
    from requested
    inner join inbox_v2_work_items work_item
      on work_item.tenant_id = ${tenantId}
     and work_item.id = requested.work_item_id
     and work_item.reopen_cycle = requested.work_item_cycle
    order by work_item.id collate "C"
    for update of work_item
  `;
}

async function applyAuthorizationRevisionAdvances(
  transaction: RawSqlExecutor,
  input: WithPrivilegedAuthorizationMutationInput,
  locked: LockedAuthorizationRevisionState
): Promise<void> {
  if (
    input.revisions.advanceTenantRbac ||
    input.revisions.advanceSharedAccess
  ) {
    await expectOneRow(
      transaction,
      buildAdvanceInboxV2AuthorizationTenantHeadSql(input, locked),
      "authorization tenant revision advance"
    );
  }
  const employees = input.revisions.employees.filter(
    ({ advanceEmployeeAccess, advanceEmployeeInboxRelation }) =>
      advanceEmployeeAccess || advanceEmployeeInboxRelation
  );
  if (employees.length > 0) {
    await expectExactRows(
      transaction,
      buildAdvanceInboxV2AuthorizationEmployeeHeadsSql(
        input,
        locked,
        employees
      ),
      employees.length,
      "authorization Employee revision advances"
    );
  }
  const resources = input.revisions.resources.filter(
    ({ advance, advanceStructuralRelation, advanceCollaboratorSet }) =>
      advance === "repository" ||
      advanceStructuralRelation === "repository" ||
      advanceCollaboratorSet === "repository"
  );
  if (resources.length > 0) {
    await expectExactRows(
      transaction,
      buildAdvanceInboxV2AuthorizationResourceHeadsSql(
        input,
        locked,
        resources
      ),
      resources.length,
      "authorization resource revision advances"
    );
  }
}

export function buildAdvanceInboxV2AuthorizationTenantHeadSql(
  input: WithPrivilegedAuthorizationMutationInput,
  locked: LockedAuthorizationRevisionState
): SQL {
  const nextTenantRbacRevision = input.revisions.advanceTenantRbac
    ? incrementCounter(locked.tenantHead.tenantRbacRevision)
    : locked.tenantHead.tenantRbacRevision;
  const nextSharedAccessRevision = input.revisions.advanceSharedAccess
    ? incrementCounter(locked.tenantHead.sharedAccessRevision)
    : locked.tenantHead.sharedAccessRevision;
  return sql`
    update inbox_v2_auth_tenant_heads
    set tenant_rbac_revision = ${nextTenantRbacRevision},
        shared_access_revision = ${nextSharedAccessRevision},
        revision = revision + 1,
        updated_at = ${input.occurredAt}
    where tenant_id = ${input.tenantId}
      and tenant_rbac_revision = ${locked.tenantHead.tenantRbacRevision}
      and shared_access_revision = ${locked.tenantHead.sharedAccessRevision}
      and revision = ${locked.tenantHead.revision}
    returning tenant_id as id
  `;
}

export function buildAdvanceInboxV2AuthorizationEmployeeHeadsSql(
  input: WithPrivilegedAuthorizationMutationInput,
  locked: LockedAuthorizationRevisionState,
  employees = input.revisions.employees.filter(
    ({ advanceEmployeeAccess, advanceEmployeeInboxRelation }) =>
      advanceEmployeeAccess || advanceEmployeeInboxRelation
  )
): SQL {
  const rows = JSON.stringify(
    employees.map((employee) => {
      const current = locked.employeeHeads.get(employee.employeeId);
      if (current === undefined) {
        throw invariantError(
          "Missing locked Employee head during revision advance."
        );
      }
      return {
        employee_id: employee.employeeId,
        expected_head_revision: current.revision,
        previous_access_revision: current.employeeAccessRevision,
        resulting_access_revision: employee.advanceEmployeeAccess
          ? incrementCounter(current.employeeAccessRevision)
          : current.employeeAccessRevision,
        previous_relation_revision: current.employeeInboxRelationRevision,
        resulting_relation_revision: employee.advanceEmployeeInboxRelation
          ? incrementCounter(current.employeeInboxRelationRevision)
          : current.employeeInboxRelationRevision
      };
    })
  );
  return sql`
    with requested as (
      select *
      from jsonb_to_recordset(${rows}::jsonb)
        as requested_row(
          employee_id text,
          expected_head_revision bigint,
          previous_access_revision bigint,
          resulting_access_revision bigint,
          previous_relation_revision bigint,
          resulting_relation_revision bigint
        )
    )
    update inbox_v2_auth_employee_heads head
    set employee_access_revision = requested.resulting_access_revision,
        employee_inbox_relation_revision = requested.resulting_relation_revision,
        revision = head.revision + 1,
        updated_at = ${input.occurredAt}
    from requested
    where head.tenant_id = ${input.tenantId}
      and head.employee_id = requested.employee_id
      and head.employee_access_revision = requested.previous_access_revision
      and head.employee_inbox_relation_revision = requested.previous_relation_revision
      and head.revision = requested.expected_head_revision
    returning head.employee_id as id
  `;
}

export function buildAdvanceInboxV2AuthorizationResourceHeadsSql(
  input: WithPrivilegedAuthorizationMutationInput,
  locked: LockedAuthorizationRevisionState,
  resources = input.revisions.resources.filter(
    ({ advance, advanceStructuralRelation, advanceCollaboratorSet }) =>
      advance === "repository" ||
      advanceStructuralRelation === "repository" ||
      advanceCollaboratorSet === "repository"
  )
): SQL {
  const rows = JSON.stringify(
    resources.map((resource) => {
      if (resource.resourceKind === "work_item") {
        throw new TypeError("WorkItem revision is callback-managed.");
      }
      const current = locked.resourceHeads.get(
        resourceKey(resource.resourceKind, resource.resourceId)
      );
      if (current === undefined) {
        throw invariantError(
          "Missing locked resource head during revision advance."
        );
      }
      return {
        resource_kind: resource.resourceKind,
        resource_id: resource.resourceId,
        expected_head_revision: current.revision,
        previous_access_revision: current.resourceAccessRevision,
        resulting_access_revision:
          resource.advance === "repository"
            ? incrementCounter(current.resourceAccessRevision)
            : current.resourceAccessRevision,
        previous_structural_relation_revision:
          current.structuralRelationRevision,
        resulting_structural_relation_revision:
          resource.advanceStructuralRelation === "repository"
            ? incrementCounter(
                current.structuralRelationRevision ??
                  (() => {
                    throw invariantError(
                      "Structural relation advance has no locked aggregate."
                    );
                  })()
              )
            : current.structuralRelationRevision,
        previous_collaborator_set_revision: current.collaboratorSetRevision,
        resulting_collaborator_set_revision:
          resource.advanceCollaboratorSet === "repository"
            ? incrementCounter(current.collaboratorSetRevision)
            : current.collaboratorSetRevision
      };
    })
  );
  return sql`
    with requested as (
      select *
      from jsonb_to_recordset(${rows}::jsonb)
        as requested_row(
          resource_kind text,
          resource_id text,
          expected_head_revision bigint,
          previous_access_revision bigint,
          resulting_access_revision bigint,
          previous_structural_relation_revision bigint,
          resulting_structural_relation_revision bigint,
          previous_collaborator_set_revision bigint,
          resulting_collaborator_set_revision bigint
        )
    )
    update inbox_v2_auth_resource_heads head
    set resource_access_revision = requested.resulting_access_revision,
        structural_relation_revision = requested.resulting_structural_relation_revision,
        collaborator_set_revision = requested.resulting_collaborator_set_revision,
        revision = head.revision + 1,
        updated_at = ${input.occurredAt}
    from requested
    where head.tenant_id = ${input.tenantId}
      and head.resource_kind::text = requested.resource_kind
      and coalesce(
        head.conversation_id,
        head.client_id,
        head.source_account_id
      ) = requested.resource_id
      and head.resource_access_revision = requested.previous_access_revision
      and head.structural_relation_revision = requested.previous_structural_relation_revision
      and head.collaborator_set_revision = requested.previous_collaborator_set_revision
      and head.revision = requested.expected_head_revision
    returning head.id
  `;
}

async function verifyCallbackManagedResourceRevisions(
  transaction: RawSqlExecutor,
  input: WithPrivilegedAuthorizationMutationInput
): Promise<void> {
  const resources = input.revisions.resources.filter(
    ({ advance, advanceStructuralRelation, advanceCollaboratorSet }) =>
      advance === "callback" ||
      advanceStructuralRelation === "callback" ||
      advanceCollaboratorSet === "callback"
  );
  if (resources.length === 0) return;
  const structuralResources = resources.filter(
    ({ resourceKind }) => resourceKind !== "work_item"
  );
  const workItems = resources.filter(
    ({ resourceKind }) => resourceKind === "work_item"
  );
  const rows: ResourceHeadRow[] = [];
  if (structuralResources.length > 0) {
    const result = await transaction.execute<ResourceHeadRow>(
      buildReadInboxV2AuthorizationResourceHeadsSql(
        input.tenantId,
        structuralResources
      )
    );
    rows.push(...result.rows);
  }
  if (workItems.length > 0) {
    const result = await transaction.execute<ResourceHeadRow>(
      buildReadInboxV2AuthorizationWorkItemResourceHeadsSql(
        input.tenantId,
        workItems
      )
    );
    rows.push(...result.rows);
  }
  if (rows.length !== resources.length) {
    throw invariantError(
      "Authorization relation callback removed an exact resource fence."
    );
  }
  const current = new Map<
    string,
    {
      resourceHeadId: string | null;
      workItemCycle: string | null;
      resourceAccessRevision: string;
      structuralRelationRevision: string | null;
      collaboratorSetRevision: string;
      revision: string;
    }
  >();
  addResourceRows(current, rows);
  for (const resource of resources) {
    const actual = current.get(
      resourceKey(resource.resourceKind, resource.resourceId)
    );
    if (actual === undefined) {
      throw invariantError("Authorization callback resource fence is missing.");
    }
    if (
      resource.resourceKind === "work_item" &&
      actual.workItemCycle !== resource.workItemCycle
    ) {
      throw invariantError(
        "Authorization callback moved the WorkItem to a different reopen cycle."
      );
    }
    if (
      resource.resourceKind === "work_item" &&
      actual.revision !== incrementCounter(resource.expectedWorkItemRevision)
    ) {
      throw invariantError(
        "Authorization callback did not advance the exact WorkItem revision."
      );
    }
    if (
      resource.advance === "callback" &&
      actual.resourceAccessRevision !==
        incrementCounter(resource.expectedResourceAccessRevision)
    ) {
      throw invariantError(
        "Authorization relation callback did not advance the exact resource access revision."
      );
    }
    if (
      resource.advanceStructuralRelation === "callback" &&
      actual.structuralRelationRevision !==
        incrementCounter(resource.expectedStructuralRelationRevision ?? "0")
    ) {
      throw invariantError(
        "Authorization callback did not advance the structural relation aggregate."
      );
    }
    if (
      resource.advanceCollaboratorSet === "callback" &&
      actual.collaboratorSetRevision !==
        incrementCounter(resource.expectedCollaboratorSetRevision ?? "0")
    ) {
      throw invariantError(
        "Authorization callback did not advance the collaborator set aggregate."
      );
    }
  }
}

export function buildReadInboxV2AuthorizationResourceHeadsSql(
  tenantId: string,
  resources: readonly InboxV2AuthorizationResourceRevisionExpectation[]
): SQL {
  const lockSql = buildLockInboxV2AuthorizationResourceHeadsSql(
    tenantId,
    resources
  );
  return sql`${lockSql}`;
}

export function buildReadInboxV2AuthorizationWorkItemResourceHeadsSql(
  tenantId: string,
  resources: readonly InboxV2AuthorizationResourceRevisionExpectation[]
): SQL {
  const workItemIds = JSON.stringify(
    resources.map(({ resourceId, workItemCycle }) => ({
      work_item_id: resourceId,
      work_item_cycle: workItemCycle
    }))
  );
  return sql`
    with requested as (
      select work_item_id, work_item_cycle
      from jsonb_to_recordset(${workItemIds}::jsonb)
        as requested_row(work_item_id text, work_item_cycle bigint)
    )
    select null::text as head_id,
           'work_item'::text as resource_kind,
           work_item.id as resource_id,
           work_item.reopen_cycle as work_item_cycle,
           work_item.resource_access_revision,
           null::bigint as structural_relation_revision,
           work_item.collaborator_set_revision,
           work_item.revision
    from requested
    inner join inbox_v2_work_items work_item
      on work_item.tenant_id = ${tenantId}
     and work_item.id = requested.work_item_id
     and work_item.reopen_cycle = requested.work_item_cycle
    order by work_item.id collate "C"
  `;
}

async function ensureTenantStreamHead(
  transaction: RawSqlExecutor,
  input: WithPrivilegedAuthorizationMutationInput
): Promise<void> {
  await transaction.execute(buildEnsureInboxV2TenantStreamHeadSql(input));
}

async function lockTenantStreamHead(
  transaction: RawSqlExecutor,
  tenantId: string
): Promise<StreamHeadRow | null> {
  const result = await transaction.execute<StreamHeadRow>(
    buildLockInboxV2TenantStreamHeadSql(tenantId)
  );
  assertAtMostOneRow(result, "tenant stream head lock");
  return result.rows[0] ?? null;
}

async function assertAuthorizationDecisionTemporalFence(
  transaction: RawSqlExecutor,
  input: WithPrivilegedAuthorizationMutationInput
): Promise<void> {
  const result = await transaction.execute<DatabaseClockRow>(
    buildReadInboxV2AuthorizationDatabaseClockSql()
  );
  if (result.rows.length !== 1) {
    throw invariantError(
      "Authorization database clock fence returned no exact row."
    );
  }
  const databaseNow = asTimestamp(
    result.rows[0]!.database_now,
    "authorization database clock"
  );
  const decisions = input.records.audit.authorizationDecisionRefs;
  const earliestNotAfter = decisions.reduce(
    (earliest, decision) =>
      Date.parse(decision.notAfter) < Date.parse(earliest)
        ? decision.notAfter
        : earliest,
    decisions[0]!.notAfter
  );
  const latestDecidedAt = decisions.reduce(
    (latest, decision) =>
      Date.parse(decision.decidedAt) > Date.parse(latest)
        ? decision.decidedAt
        : latest,
    decisions[0]!.decidedAt
  );
  if (
    Date.parse(databaseNow) < Date.parse(latestDecidedAt) ||
    Date.parse(databaseNow) >= Date.parse(earliestNotAfter)
  ) {
    throw new AuthorizationMutationAbort({
      kind: "revision_conflict",
      code: "auth.access_revision_stale",
      conflicts: [
        {
          kind: "authorization_decision_time",
          expectedRevision: earliestNotAfter,
          currentRevision: databaseNow
        }
      ]
    });
  }
}

async function assertRelationWriteTargetClosure(
  transaction: RawSqlExecutor,
  input: WithPrivilegedAuthorizationMutationInput,
  writes: readonly InboxV2AuthorizationRelationRevisionEffect[]
): Promise<void> {
  const query = buildReadInboxV2AuthorizationRelationWriteTargetsSql(
    input,
    writes
  );
  if (query === null) return;

  const result =
    await transaction.execute<AuthorizationRelationTargetRow>(query);
  if (result.rows.length !== writes.length) {
    throw invariantError(
      "Authorization relation writes do not resolve to an exact persisted target set."
    );
  }

  const rows = result.rows.map((row, index) => {
    const ordinal = positiveCounter(row.ordinal, "relation target ordinal");
    const relationId = asString(row.relation_id, "relation target ID");
    if (
      ordinal !== String(index + 1) ||
      relationId !== writes[index]!.relationId
    ) {
      throw invariantError(
        "Authorization relation target rows do not match the ordered write manifest."
      );
    }
    return {
      employeeId: nullableString(row.target_employee_id),
      resourceKind:
        row.resource_kind === null
          ? null
          : authorizationResourceKind(row.resource_kind),
      resourceId: nullableString(row.resource_id),
      resourceHeadId: nullableString(row.resource_head_id),
      workItemCycle:
        row.work_item_cycle === null
          ? null
          : positiveOrZeroCounter(
              row.work_item_cycle,
              "relation target WorkItem cycle"
            )
    };
  });

  const relationKind = input.records.relationKind;
  if (
    relationKind === "direct_grant" ||
    relationKind === "workforce_membership"
  ) {
    assertExactDerivedEmployeeTargets(
      rows,
      input.revisions.employees
        .filter(({ advanceEmployeeAccess }) => advanceEmployeeAccess)
        .map(({ employeeId }) => employeeId),
      "direct-access relation"
    );
    return;
  }

  if (relationKind === "structural_access") {
    assertExactDerivedResourceTargets(
      rows,
      input.revisions.resources.filter(({ advance }) => advance !== "none"),
      true,
      "structural-access relation"
    );
    return;
  }

  if (
    relationKind === "conversation_collaborator" ||
    relationKind === "work_item_collaborator"
  ) {
    assertExactDerivedEmployeeTargets(
      rows,
      input.revisions.employees
        .filter(
          ({ advanceEmployeeInboxRelation }) => advanceEmployeeInboxRelation
        )
        .map(({ employeeId }) => employeeId),
      "collaborator relation"
    );
    assertExactDerivedResourceTargets(
      rows,
      input.revisions.resources.filter(
        ({ advanceCollaboratorSet }) =>
          advanceCollaboratorSet !== undefined &&
          advanceCollaboratorSet !== "none"
      ),
      false,
      "collaborator relation"
    );
  }
}

/**
 * Role and role-binding callbacks are intentionally generic so callers can
 * persist immutable relation versions in one transaction. Legality is not
 * optional, though: after the callback has written its exact version/head
 * rows, this repository reloads those rows under the already-held tenant RBAC
 * head lock and invokes the core planners itself. A rejected plan aborts and
 * rolls back the complete transaction, including every callback artifact.
 */
async function assertPersistedRoleLegality(
  transaction: RawSqlExecutor,
  input: WithPrivilegedAuthorizationMutationInput,
  writes: readonly InboxV2AuthorizationRelationRevisionEffect[],
  lockedTenantRbacRevision: string
): Promise<void> {
  if (input.records.relationKind === "role") {
    const snapshots = await loadPersistedRoleSnapshots(
      transaction,
      input,
      writes
    );
    const bindingsByRole = await loadCurrentRoleBindingFacts(
      transaction,
      input.tenantId,
      snapshots.map(({ roleId }) => roleId)
    );
    for (const snapshot of snapshots) {
      const decision = planInboxV2RoleDefinitionRevision({
        tenantId: inboxV2TenantIdSchema.parse(input.tenantId),
        roleId: snapshot.roleId,
        permissionIds: snapshot.permissionIds,
        currentAndHistoricalBindings: bindingsByRole.get(snapshot.roleId) ?? [],
        evaluatedAt: input.occurredAt,
        previousTenantRbacRevision: lockedTenantRbacRevision
      });
      assertRolePlanDecision(
        decision,
        "role",
        snapshot.roleId,
        lockedTenantRbacRevision
      );
    }
    return;
  }

  if (input.records.relationKind !== "role_binding") return;

  const persistedBindings = await loadPersistedRoleBindings(
    transaction,
    input,
    writes
  );
  const relevantBindings = persistedBindings.filter((binding) =>
    isRoleBindingRelevantAt(binding, input.occurredAt)
  );
  if (relevantBindings.length === 0) return;

  const permissionsByRole = await loadCurrentRolePermissions(
    transaction,
    input.tenantId,
    canonicalUniqueStrings(relevantBindings.map(({ roleId }) => roleId))
  );
  for (const binding of relevantBindings) {
    const permissionIds = permissionsByRole.get(binding.roleId);
    if (permissionIds === undefined) {
      throw invariantError(
        "Persisted role binding does not resolve to a current role permission snapshot."
      );
    }
    const decision = planInboxV2RoleBindingRevision({
      tenantId: inboxV2TenantIdSchema.parse(input.tenantId),
      roleId: binding.roleId,
      subjectTenantId: inboxV2TenantIdSchema.parse(input.tenantId),
      scope: binding.scope,
      currentRolePermissionIds: permissionIds,
      previousTenantRbacRevision: lockedTenantRbacRevision
    });
    assertRolePlanDecision(
      decision,
      "role_binding",
      binding.bindingId,
      lockedTenantRbacRevision
    );
  }
}

type PersistedRoleSnapshot = Readonly<{
  roleId: string;
  permissionIds: readonly string[];
}>;

type PersistedRoleBinding = Readonly<{
  bindingId: string;
  roleId: string;
  state: "active" | "revoked" | "archived";
  validFrom: string;
  validUntil: string | null;
  revokedAt: string | null;
  scope: unknown;
}>;

async function loadPersistedRoleSnapshots(
  transaction: RawSqlExecutor,
  input: WithPrivilegedAuthorizationMutationInput,
  writes: readonly InboxV2AuthorizationRelationRevisionEffect[]
): Promise<readonly PersistedRoleSnapshot[]> {
  const result = await transaction.execute<PersistedRolePermissionRow>(
    buildReadInboxV2PersistedRolePermissionsSql(input, writes)
  );
  const snapshots = new Map<
    number,
    { roleId: string; permissionCount: number; permissionIds: string[] }
  >();
  for (const row of result.rows) {
    const ordinal = Number(positiveCounter(row.ordinal, "role write ordinal"));
    const write = writes[ordinal - 1];
    if (write === undefined) {
      throw invariantError(
        "Persisted role permission row has an unknown write ordinal."
      );
    }
    const roleId = asString(row.role_id, "persisted role ID");
    const roleRevision = positiveCounter(
      row.role_revision,
      "persisted role revision"
    );
    if (
      roleId !== write.relationId ||
      roleRevision !== write.resultingRevision
    ) {
      throw invariantError(
        "Persisted role snapshot does not match the relation write manifest."
      );
    }
    const permissionCount = positiveBoundedInteger(
      row.permission_count,
      256,
      "persisted role permission count"
    );
    const permissionOrdinal = positiveBoundedInteger(
      row.permission_ordinal,
      256,
      "persisted role permission ordinal"
    );
    const permissionId = asString(
      row.permission_id,
      "persisted role permission ID"
    );
    const current = snapshots.get(ordinal);
    if (current === undefined) {
      if (permissionOrdinal !== 1) {
        throw invariantError(
          "Persisted role permission snapshot does not start at ordinal one."
        );
      }
      snapshots.set(ordinal, {
        roleId,
        permissionCount,
        permissionIds: [permissionId]
      });
      continue;
    }
    if (
      current.roleId !== roleId ||
      current.permissionCount !== permissionCount ||
      permissionOrdinal !== current.permissionIds.length + 1
    ) {
      throw invariantError(
        "Persisted role permission snapshot is not an exact ordered manifest."
      );
    }
    current.permissionIds.push(permissionId);
  }
  if (snapshots.size !== writes.length) {
    throw invariantError(
      "Authorization role writes do not resolve to exact permission snapshots."
    );
  }
  return writes.map((write, index) => {
    const snapshot = snapshots.get(index + 1);
    if (
      snapshot === undefined ||
      snapshot.roleId !== write.relationId ||
      snapshot.permissionIds.length !== snapshot.permissionCount
    ) {
      throw invariantError(
        "Authorization role permission manifest is incomplete."
      );
    }
    return Object.freeze({
      roleId: snapshot.roleId,
      permissionIds: Object.freeze([...snapshot.permissionIds])
    });
  });
}

async function loadCurrentRoleBindingFacts(
  transaction: RawSqlExecutor,
  tenantId: string,
  roleIds: readonly string[]
): Promise<ReadonlyMap<string, readonly InboxV2RoleBindingLegalityFact[]>> {
  if (roleIds.length === 0) return new Map();
  const result = await transaction.execute<RoleBindingLegalityRow>(
    buildReadInboxV2CurrentRoleBindingsSql(tenantId, roleIds)
  );
  const parsedTenantId = inboxV2TenantIdSchema.parse(tenantId);
  const bindingsByRole = new Map<string, InboxV2RoleBindingLegalityFact[]>();
  for (const roleId of roleIds) bindingsByRole.set(roleId, []);
  for (const row of result.rows) {
    const requestedOrdinal = positiveBoundedInteger(
      row.ordinal,
      roleIds.length,
      "current role binding requested ordinal"
    );
    const expectedRoleId = roleIds[requestedOrdinal - 1];
    const roleId = asString(row.role_id, "current role binding role ID");
    if (expectedRoleId === undefined || roleId !== expectedRoleId) {
      throw invariantError(
        "Current role binding row does not match its requested role."
      );
    }
    const binding = mapRoleBindingLegalityRow(row, parsedTenantId);
    const roleBindings = bindingsByRole.get(roleId)!;
    if (roleBindings.some(({ bindingId }) => bindingId === binding.bindingId)) {
      throw invariantError("Current role binding query returned a duplicate.");
    }
    roleBindings.push(binding);
  }
  for (const bindings of bindingsByRole.values()) {
    bindings.sort((left, right) =>
      comparePostgresCText(left.bindingId, right.bindingId)
    );
  }
  return bindingsByRole;
}

async function loadPersistedRoleBindings(
  transaction: RawSqlExecutor,
  input: WithPrivilegedAuthorizationMutationInput,
  writes: readonly InboxV2AuthorizationRelationRevisionEffect[]
): Promise<readonly PersistedRoleBinding[]> {
  const result = await transaction.execute<RoleBindingLegalityRow>(
    buildReadInboxV2PersistedRoleBindingsSql(input, writes)
  );
  if (result.rows.length !== writes.length) {
    throw invariantError(
      "Authorization role-binding writes do not resolve to an exact persisted version set."
    );
  }
  const tenantId = inboxV2TenantIdSchema.parse(input.tenantId);
  return result.rows.map((row, index) => {
    const ordinal = positiveBoundedInteger(
      row.ordinal,
      writes.length,
      "persisted role-binding ordinal"
    );
    const write = writes[index];
    const bindingId = asString(row.binding_id, "persisted role-binding ID");
    const revision = positiveCounter(
      row.binding_revision,
      "persisted role-binding revision"
    );
    if (
      ordinal !== index + 1 ||
      write === undefined ||
      bindingId !== write.relationId ||
      revision !== write.resultingRevision
    ) {
      throw invariantError(
        "Persisted role-binding version does not match the ordered write manifest."
      );
    }
    const fact = mapRoleBindingLegalityRow(row, tenantId);
    return Object.freeze({
      bindingId: fact.bindingId,
      roleId: fact.roleId,
      state: authorizationRecordState(row.state),
      validFrom: fact.validFrom,
      validUntil: fact.validUntil,
      revokedAt: fact.revokedAt,
      scope: fact.scope
    });
  });
}

async function loadCurrentRolePermissions(
  transaction: RawSqlExecutor,
  tenantId: string,
  roleIds: readonly string[]
): Promise<ReadonlyMap<string, readonly string[]>> {
  const result = await transaction.execute<CurrentRolePermissionRow>(
    buildReadInboxV2CurrentRolePermissionsSql(tenantId, roleIds)
  );
  const permissions = new Map<
    string,
    { revision: string; count: number; permissionIds: string[] }
  >();
  for (const row of result.rows) {
    const roleId = asString(row.role_id, "current role permission role ID");
    if (!roleIds.includes(roleId)) {
      throw invariantError(
        "Current role permission row is outside the requested role set."
      );
    }
    const revision = positiveCounter(
      row.role_revision,
      "current role permission revision"
    );
    const count = positiveBoundedInteger(
      row.permission_count,
      256,
      "current role permission count"
    );
    const ordinal = positiveBoundedInteger(
      row.permission_ordinal,
      256,
      "current role permission ordinal"
    );
    const permissionId = asString(
      row.permission_id,
      "current role permission ID"
    );
    const current = permissions.get(roleId);
    if (current === undefined) {
      if (ordinal !== 1) {
        throw invariantError(
          "Current role permission snapshot does not start at ordinal one."
        );
      }
      permissions.set(roleId, {
        revision,
        count,
        permissionIds: [permissionId]
      });
      continue;
    }
    if (
      current.revision !== revision ||
      current.count !== count ||
      ordinal !== current.permissionIds.length + 1
    ) {
      throw invariantError(
        "Current role permission snapshot is not an exact ordered manifest."
      );
    }
    current.permissionIds.push(permissionId);
  }
  if (permissions.size !== roleIds.length) {
    throw invariantError(
      "Current role permission query did not resolve every requested role."
    );
  }
  return new Map(
    roleIds.map((roleId) => {
      const snapshot = permissions.get(roleId);
      if (
        snapshot === undefined ||
        snapshot.permissionIds.length !== snapshot.count
      ) {
        throw invariantError("Current role permission manifest is incomplete.");
      }
      return [roleId, Object.freeze([...snapshot.permissionIds])] as const;
    })
  );
}

function mapRoleBindingLegalityRow(
  row: RoleBindingLegalityRow,
  tenantId: ReturnType<typeof inboxV2TenantIdSchema.parse>
): InboxV2RoleBindingLegalityFact {
  return Object.freeze({
    tenantId,
    bindingId: asString(row.binding_id, "role-binding ID"),
    roleId: asString(row.role_id, "role-binding role ID"),
    scope: persistedRoleBindingScope(row, tenantId),
    validFrom: asTimestamp(row.valid_from, "role-binding validFrom"),
    validUntil: nullableTimestamp(row.valid_until, "role-binding validUntil"),
    revokedAt: nullableTimestamp(row.revoked_at, "role-binding revokedAt")
  });
}

function persistedRoleBindingScope(
  row: RoleBindingLegalityRow,
  tenantId: ReturnType<typeof inboxV2TenantIdSchema.parse>
): unknown {
  const type = asString(row.scope_kind, "role-binding scope kind");
  if (
    type === "tenant" ||
    type === "responsible" ||
    type === "collaborator" ||
    type === "internal_participant" ||
    type === "client_owner"
  ) {
    return { type, tenantId };
  }
  if (type === "org_unit") {
    const mode = nullableString(row.scope_org_unit_mode);
    const id = nullableString(row.scope_org_unit_id);
    return mode !== null && id !== null
      ? { type, tenantId, id, mode }
      : { type, tenantId, invalid: true };
  }
  const idByType = {
    team: row.scope_team_id,
    queue: row.scope_work_queue_id,
    client: row.scope_client_id,
    conversation: row.scope_conversation_id,
    work_item: row.scope_work_item_id,
    source_account: row.scope_source_account_id
  } as const;
  if (Object.hasOwn(idByType, type)) {
    const id = nullableString(idByType[type as keyof typeof idByType]);
    return id === null
      ? { type, tenantId, invalid: true }
      : { type, tenantId, id };
  }
  return { type, tenantId, invalid: true };
}

function isRoleBindingRelevantAt(
  binding: PersistedRoleBinding,
  evaluatedAt: string
): boolean {
  const instant = Date.parse(evaluatedAt);
  return (
    binding.state === "active" &&
    binding.revokedAt === null &&
    (binding.validUntil === null || Date.parse(binding.validUntil) > instant)
  );
}

function assertRolePlanDecision(
  decision: InboxV2RoleRevisionPlanDecision,
  relationKind: "role" | "role_binding",
  relationId: string,
  lockedTenantRbacRevision: string
): void {
  if (decision.kind === "rejected") {
    const conflicts =
      relationKind === "role_binding"
        ? decision.conflicts.map((conflict) => ({
            ...conflict,
            bindingId: relationId
          }))
        : decision.conflicts;
    throw new AuthorizationMutationAbort({
      kind: "role_legality_conflict",
      code: "authorization.role_legality_conflict",
      relationKind,
      relationId,
      reason: decision.reason,
      conflicts
    });
  }
  const advance = decision.revisionPlan.tenantRbacRevision;
  if (
    advance === null ||
    advance.previous !== lockedTenantRbacRevision ||
    advance.resulting !== incrementCounter(lockedTenantRbacRevision)
  ) {
    throw invariantError(
      "Core role legality plan does not match the locked tenant RBAC fence."
    );
  }
}

function authorizationRecordState(
  value: unknown
): "active" | "revoked" | "archived" {
  if (value !== "active" && value !== "revoked" && value !== "archived") {
    throw invariantError("Persisted authorization record state is invalid.");
  }
  return value;
}

type DerivedAuthorizationRelationTarget = Readonly<{
  employeeId: string | null;
  resourceKind: InboxV2AuthorizationResourceKind | null;
  resourceId: string | null;
  resourceHeadId: string | null;
  workItemCycle: string | null;
}>;

function assertExactDerivedEmployeeTargets(
  rows: readonly DerivedAuthorizationRelationTarget[],
  expectedEmployeeIds: readonly string[],
  label: string
): void {
  const actual = canonicalUniqueStrings(
    rows.map(({ employeeId }) => {
      if (employeeId === null) {
        throw invariantError(`${label} omitted its Employee target.`);
      }
      return employeeId;
    })
  );
  const expected = canonicalUniqueStrings(expectedEmployeeIds);
  if (!sameStringArray(actual, expected)) {
    throw invariantError(
      `${label} target Employees do not match the bounded revision and audience set.`
    );
  }
}

function assertExactDerivedResourceTargets(
  rows: readonly DerivedAuthorizationRelationTarget[],
  expectedResources: readonly InboxV2AuthorizationResourceRevisionExpectation[],
  includeResourceHeadId: boolean,
  label: string
): void {
  const actual = canonicalUniqueStrings(
    rows.map((row) =>
      derivedResourceTargetKey(row, includeResourceHeadId, label)
    )
  );
  const expected = canonicalUniqueStrings(
    expectedResources.map((resource) =>
      expectedResourceTargetKey(resource, includeResourceHeadId)
    )
  );
  if (!sameStringArray(actual, expected)) {
    throw invariantError(
      `${label} resources do not match the exact aggregate revision target set.`
    );
  }
}

function derivedResourceTargetKey(
  target: DerivedAuthorizationRelationTarget,
  includeResourceHeadId: boolean,
  label: string
): string {
  if (target.resourceKind === null || target.resourceId === null) {
    throw invariantError(`${label} omitted its resource target.`);
  }
  if (
    (target.resourceKind === "work_item") !==
    (target.workItemCycle !== null)
  ) {
    throw invariantError(`${label} has an invalid WorkItem cycle target.`);
  }
  if (
    includeResourceHeadId &&
    (target.resourceKind === "work_item" || target.resourceHeadId === null)
  ) {
    throw invariantError(`${label} omitted its authorization resource head.`);
  }
  return [
    target.resourceKind,
    target.resourceId,
    includeResourceHeadId ? target.resourceHeadId : "",
    target.workItemCycle ?? ""
  ].join("\u0000");
}

function expectedResourceTargetKey(
  resource: InboxV2AuthorizationResourceRevisionExpectation,
  includeResourceHeadId: boolean
): string {
  return [
    resource.resourceKind,
    resource.resourceId,
    includeResourceHeadId ? (resource.resourceHeadId ?? "") : "",
    resource.workItemCycle ?? ""
  ].join("\u0000");
}

function canonicalUniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort(comparePostgresCText);
}

function authorizationResourceKind(
  value: unknown
): InboxV2AuthorizationResourceKind {
  if (
    value !== "conversation" &&
    value !== "client" &&
    value !== "source_account" &&
    value !== "work_item"
  ) {
    throw invariantError("Persisted authorization resource kind is invalid.");
  }
  return value;
}

function assertAuthorizationResourceId(
  kind: InboxV2AuthorizationResourceKind,
  id: string
): void {
  switch (kind) {
    case "conversation":
      inboxV2ConversationIdSchema.parse(id);
      return;
    case "client":
      inboxV2ClientIdSchema.parse(id);
      return;
    case "source_account":
      inboxV2SourceAccountIdSchema.parse(id);
      return;
    case "work_item":
      inboxV2WorkItemIdSchema.parse(id);
      return;
    default:
      throw new TypeError("Authorization resource kind is not supported.");
  }
}

export function buildReadInboxV2AuthorizationRelationWriteTargetsSql(
  input: WithPrivilegedAuthorizationMutationInput,
  writes: readonly InboxV2AuthorizationRelationRevisionEffect[]
): SQL | null {
  const requested = JSON.stringify(
    writes.map(({ ordinal, relationId, resultingRevision }) => ({
      ordinal,
      relation_id: relationId,
      resulting_revision: resultingRevision
    }))
  );
  const relationKind = input.records.relationKind;

  if (relationKind === "direct_grant") {
    return sql`
      with requested as (
        select *
        from jsonb_to_recordset(${requested}::jsonb)
          as requested(ordinal integer, relation_id text, resulting_revision bigint)
      )
      select requested.ordinal,
             version_row.grant_id as relation_id,
             version_row.employee_id as target_employee_id,
             null::text as resource_kind,
             null::text as resource_id,
             null::text as resource_head_id,
             null::bigint as work_item_cycle
      from requested
      join inbox_v2_auth_direct_grant_versions version_row
        on version_row.tenant_id = ${input.tenantId}
       and version_row.grant_id = requested.relation_id
       and version_row.revision = requested.resulting_revision
       and version_row.mutation_id = ${input.records.mutationId}
      order by requested.ordinal
    `;
  }

  if (relationKind === "workforce_membership") {
    return sql`
      with requested as (
        select *
        from jsonb_to_recordset(${requested}::jsonb)
          as requested(ordinal integer, relation_id text, resulting_revision bigint)
      )
      select requested.ordinal,
             version_row.membership_id as relation_id,
             version_row.employee_id as target_employee_id,
             null::text as resource_kind,
             null::text as resource_id,
             null::text as resource_head_id,
             null::bigint as work_item_cycle
      from requested
      join inbox_v2_auth_workforce_membership_versions version_row
        on version_row.tenant_id = ${input.tenantId}
       and version_row.membership_id = requested.relation_id
       and version_row.revision = requested.resulting_revision
       and version_row.mutation_id = ${input.records.mutationId}
      order by requested.ordinal
    `;
  }

  if (relationKind === "structural_access") {
    return sql`
      with requested as (
        select *
        from jsonb_to_recordset(${requested}::jsonb)
          as requested(ordinal integer, relation_id text, resulting_revision bigint)
      )
      select requested.ordinal,
             version_row.binding_id as relation_id,
             null::text as target_employee_id,
             version_row.resource_kind::text as resource_kind,
             case version_row.resource_kind
               when 'conversation' then version_row.conversation_id
               when 'client' then version_row.client_id
               when 'source_account' then version_row.source_account_id
             end as resource_id,
             version_row.resource_head_id,
             null::bigint as work_item_cycle
      from requested
      join inbox_v2_auth_structural_access_versions version_row
        on version_row.tenant_id = ${input.tenantId}
       and version_row.binding_id = requested.relation_id
       and version_row.revision = requested.resulting_revision
       and version_row.mutation_id = ${input.records.mutationId}
      order by requested.ordinal
    `;
  }

  if (
    relationKind === "conversation_collaborator" ||
    relationKind === "work_item_collaborator"
  ) {
    return sql`
      with requested as (
        select *
        from jsonb_to_recordset(${requested}::jsonb)
          as requested(ordinal integer, relation_id text, resulting_revision bigint)
      )
      select requested.ordinal,
             version_row.collaborator_id as relation_id,
             version_row.employee_id as target_employee_id,
             version_row.resource_kind::text as resource_kind,
             case version_row.resource_kind
               when 'conversation' then version_row.conversation_id
               when 'work_item' then version_row.work_item_id
             end as resource_id,
             null::text as resource_head_id,
             version_row.work_item_cycle
      from requested
      join inbox_v2_auth_collaborator_versions version_row
        on version_row.tenant_id = ${input.tenantId}
       and version_row.collaborator_id = requested.relation_id
       and version_row.revision = requested.resulting_revision
       and version_row.mutation_id = ${input.records.mutationId}
      where version_row.resource_kind = ${
        relationKind === "conversation_collaborator"
          ? "conversation"
          : "work_item"
      }::inbox_v2_auth_collaborator_resource_kind
      order by requested.ordinal
    `;
  }

  return null;
}

export function buildReadInboxV2PersistedRolePermissionsSql(
  input: WithPrivilegedAuthorizationMutationInput,
  writes: readonly InboxV2AuthorizationRelationRevisionEffect[]
): SQL {
  const requested = JSON.stringify(
    writes.map(({ ordinal, relationId, resultingRevision }) => ({
      ordinal,
      role_id: relationId,
      resulting_revision: resultingRevision
    }))
  );
  return sql`
    with requested as (
      select *
      from jsonb_to_recordset(${requested}::jsonb)
        as requested(ordinal integer, role_id text, resulting_revision bigint)
    )
    select requested.ordinal,
           version_row.role_id,
           version_row.revision as role_revision,
           version_row.permission_count,
           permission_row.ordinal as permission_ordinal,
           permission_row.permission_id
    from requested
    join inbox_v2_auth_role_versions version_row
      on version_row.tenant_id = ${input.tenantId}
     and version_row.role_id = requested.role_id
     and version_row.revision = requested.resulting_revision
     and version_row.mutation_id = ${input.records.mutationId}
    join inbox_v2_auth_role_heads head_row
      on head_row.tenant_id = version_row.tenant_id
     and head_row.role_id = version_row.role_id
     and head_row.current_revision = version_row.revision
    join inbox_v2_auth_role_version_permissions permission_row
      on permission_row.tenant_id = version_row.tenant_id
     and permission_row.role_id = version_row.role_id
     and permission_row.role_revision = version_row.revision
    order by requested.ordinal, permission_row.ordinal
  `;
}

export function buildReadInboxV2CurrentRoleBindingsSql(
  tenantId: string,
  roleIds: readonly string[]
): SQL {
  const requested = JSON.stringify(
    roleIds.map((roleId, index) => ({
      ordinal: index + 1,
      role_id: roleId
    }))
  );
  return sql`
    with requested as (
      select *
      from jsonb_to_recordset(${requested}::jsonb)
        as requested(ordinal integer, role_id text)
    )
    select requested.ordinal,
           version_row.binding_id,
           version_row.revision as binding_revision,
           version_row.role_id,
           version_row.state::text as state,
           version_row.valid_from,
           version_row.valid_until,
           version_row.revoked_at,
           version_row.scope_kind::text as scope_kind,
           version_row.scope_org_unit_mode::text as scope_org_unit_mode,
           version_row.scope_org_unit_id,
           version_row.scope_team_id,
           version_row.scope_work_queue_id,
           version_row.scope_client_id,
           version_row.scope_conversation_id,
           version_row.scope_work_item_id,
           version_row.scope_source_account_id
    from requested
    join inbox_v2_auth_role_binding_heads head_row
      on head_row.tenant_id = ${tenantId}
    join inbox_v2_auth_role_binding_versions version_row
      on version_row.tenant_id = head_row.tenant_id
     and version_row.binding_id = head_row.binding_id
     and version_row.revision = head_row.current_revision
     and version_row.role_id = requested.role_id
     and version_row.state = 'active'
    order by requested.ordinal, version_row.binding_id collate "C"
  `;
}

export function buildReadInboxV2PersistedRoleBindingsSql(
  input: WithPrivilegedAuthorizationMutationInput,
  writes: readonly InboxV2AuthorizationRelationRevisionEffect[]
): SQL {
  const requested = JSON.stringify(
    writes.map(({ ordinal, relationId, resultingRevision }) => ({
      ordinal,
      binding_id: relationId,
      resulting_revision: resultingRevision
    }))
  );
  return sql`
    with requested as (
      select *
      from jsonb_to_recordset(${requested}::jsonb)
        as requested(ordinal integer, binding_id text, resulting_revision bigint)
    )
    select requested.ordinal,
           version_row.binding_id,
           version_row.revision as binding_revision,
           version_row.role_id,
           version_row.state::text as state,
           version_row.valid_from,
           version_row.valid_until,
           version_row.revoked_at,
           version_row.scope_kind::text as scope_kind,
           version_row.scope_org_unit_mode::text as scope_org_unit_mode,
           version_row.scope_org_unit_id,
           version_row.scope_team_id,
           version_row.scope_work_queue_id,
           version_row.scope_client_id,
           version_row.scope_conversation_id,
           version_row.scope_work_item_id,
           version_row.scope_source_account_id
    from requested
    join inbox_v2_auth_role_binding_versions version_row
      on version_row.tenant_id = ${input.tenantId}
     and version_row.binding_id = requested.binding_id
     and version_row.revision = requested.resulting_revision
     and version_row.mutation_id = ${input.records.mutationId}
    join inbox_v2_auth_role_binding_heads head_row
      on head_row.tenant_id = version_row.tenant_id
     and head_row.binding_id = version_row.binding_id
     and head_row.current_revision = version_row.revision
    order by requested.ordinal
  `;
}

export function buildReadInboxV2CurrentRolePermissionsSql(
  tenantId: string,
  roleIds: readonly string[]
): SQL {
  const requested = JSON.stringify(
    roleIds.map((roleId, index) => ({
      ordinal: index + 1,
      role_id: roleId
    }))
  );
  return sql`
    with requested as (
      select *
      from jsonb_to_recordset(${requested}::jsonb)
        as requested(ordinal integer, role_id text)
    )
    select version_row.role_id,
           version_row.revision as role_revision,
           version_row.permission_count,
           permission_row.ordinal as permission_ordinal,
           permission_row.permission_id
    from requested
    join inbox_v2_auth_role_heads head_row
      on head_row.tenant_id = ${tenantId}
     and head_row.role_id = requested.role_id
    join inbox_v2_auth_role_versions version_row
      on version_row.tenant_id = head_row.tenant_id
     and version_row.role_id = head_row.role_id
     and version_row.revision = head_row.current_revision
    join inbox_v2_auth_role_version_permissions permission_row
      on permission_row.tenant_id = version_row.tenant_id
     and permission_row.role_id = version_row.role_id
     and permission_row.role_revision = version_row.revision
    order by requested.ordinal, permission_row.ordinal
  `;
}

export function buildReadInboxV2AuthorizationDatabaseClockSql(): SQL {
  return sql`select clock_timestamp() as database_now`;
}

export function buildEnsureInboxV2TenantStreamHeadSql(
  input: WithPrivilegedAuthorizationMutationInput
): SQL {
  return sql`
    insert into inbox_v2_tenant_stream_heads (
      tenant_id,
      stream_epoch,
      last_position,
      min_retained_position,
      revision,
      created_at,
      updated_at
    )
    select tenant.id,
           ${input.records.expectedStreamEpoch},
           0,
           0,
           1,
           ${input.occurredAt},
           ${input.occurredAt}
    from tenants tenant
    where tenant.id = ${input.tenantId}
    on conflict (tenant_id) do nothing
  `;
}

export function buildLockInboxV2TenantStreamHeadSql(tenantId: string): SQL {
  return sql`
    select stream_epoch,
           last_position,
           min_retained_position,
           revision
    from inbox_v2_tenant_stream_heads
    where tenant_id = ${tenantId}
    for update
  `;
}

export function buildInsertInboxV2TenantStreamCommitSql(input: {
  input: WithPrivilegedAuthorizationMutationInput;
  streamEpoch: string;
  streamPosition: string;
  previousPosition: string;
}): SQL {
  const records = input.input.records;
  return sql`
    insert into inbox_v2_tenant_stream_commits (
      tenant_id,
      id,
      mutation_id,
      stream_epoch,
      position,
      previous_position,
      schema_version,
      correlation_id,
      command_ids,
      client_mutation_ids,
      authorization_decision_refs,
      change_ids,
      event_ids,
      outbox_intent_ids,
      audience_impact_kind,
      audience_impact_manifest,
      change_count,
      event_count,
      outbox_intent_count,
      manifest_digest_sha256,
      commit_hash,
      committed_at,
      created_at
    ) values (
      ${input.input.tenantId},
      ${records.streamCommitId},
      ${records.mutationId},
      ${input.streamEpoch},
      ${input.streamPosition},
      ${input.previousPosition},
      ${INBOX_V2_TENANT_STREAM_SCHEMA_VERSION},
      ${records.correlationId},
      ${JSON.stringify([input.input.command.id])}::jsonb,
      ${JSON.stringify([input.input.command.clientMutationId])}::jsonb,
      ${JSON.stringify(records.audit.authorizationDecisionRefs)}::jsonb,
      ${JSON.stringify(records.changes.map(({ id }) => id))}::jsonb,
      ${JSON.stringify(records.events.map(({ id }) => id))}::jsonb,
      ${JSON.stringify(records.outboxIntents.map(({ id }) => id))}::jsonb,
      ${records.audienceImpact.kind},
      ${JSON.stringify(records.audienceImpact)}::jsonb,
      ${records.changes.length},
      ${records.events.length},
      ${records.outboxIntents.length},
      ${computeInboxV2TenantStreamManifestDigest(records)},
      ${records.commitHash},
      ${input.input.occurredAt},
      ${input.input.occurredAt}
    )
    returning id
  `;
}

export function buildInsertInboxV2TenantStreamChangesSql(input: {
  input: WithPrivilegedAuthorizationMutationInput;
  streamPosition: string;
}): SQL {
  const rows = JSON.stringify(
    input.input.records.changes.map((change) => ({
      id: change.id,
      ordinal: change.ordinal,
      entity_type_id: change.entity.entityTypeId,
      entity_id: change.entity.entityId,
      resulting_revision: change.resultingRevision,
      timeline: change.timeline,
      audience: change.audience,
      state_kind: change.state.kind,
      state_schema_id:
        change.state.kind === "upsert" ? change.state.stateSchemaId : null,
      state_schema_version:
        change.state.kind === "upsert" ? change.state.stateSchemaVersion : null,
      state_reason_id:
        change.state.kind === "tombstone" ? change.state.reasonId : null,
      state_hash: change.state.stateHash,
      payload_reference:
        change.state.kind === "upsert" ? change.state.payloadReference : null,
      domain_commit_reference: change.state.domainCommitReference
    }))
  );
  return sql`
    with change_rows as (
      select *
      from jsonb_to_recordset(${rows}::jsonb)
        as change_row(
          id text,
          ordinal smallint,
          entity_type_id text,
          entity_id text,
          resulting_revision bigint,
          timeline jsonb,
          audience text,
          state_kind text,
          state_schema_id text,
          state_schema_version text,
          state_reason_id text,
          state_hash text,
          payload_reference jsonb,
          domain_commit_reference jsonb
        )
    )
    insert into inbox_v2_tenant_stream_changes (
      tenant_id,
      id,
      mutation_id,
      stream_commit_id,
      stream_position,
      ordinal,
      entity_type_id,
      entity_id,
      resulting_revision,
      timeline,
      audience,
      state_kind,
      state_schema_id,
      state_schema_version,
      state_reason_id,
      state_hash,
      payload_reference,
      domain_commit_reference,
      created_at
    )
    select ${input.input.tenantId},
           change_rows.id,
           ${input.input.records.mutationId},
           ${input.input.records.streamCommitId},
           ${input.streamPosition},
           change_rows.ordinal,
           change_rows.entity_type_id,
           change_rows.entity_id,
           change_rows.resulting_revision,
           change_rows.timeline,
           change_rows.audience::inbox_v2_tenant_stream_audience,
           change_rows.state_kind,
           change_rows.state_schema_id,
           change_rows.state_schema_version,
           change_rows.state_reason_id,
           change_rows.state_hash,
           change_rows.payload_reference,
           change_rows.domain_commit_reference,
           ${input.input.occurredAt}
    from change_rows
    order by change_rows.ordinal
    returning id
  `;
}

export function buildInsertInboxV2DomainEventsSql(input: {
  input: WithPrivilegedAuthorizationMutationInput;
  streamPosition: string;
}): SQL {
  const rows = JSON.stringify(
    input.input.records.events.map((event) => ({
      id: event.id,
      ordinal: event.ordinal,
      type_id: event.typeId,
      payload_schema_id: event.payloadSchemaId,
      payload_schema_version: event.payloadSchemaVersion,
      change_ids: event.changeIds,
      subjects: event.subjects,
      payload_reference: event.payloadReference,
      correlation_id: event.correlationId,
      command_ids: event.commandIds,
      client_mutation_ids: event.clientMutationIds,
      authorization_decision_refs: event.authorizationDecisionRefs,
      access_effect: event.accessEffect.kind,
      access_effect_causes:
        event.accessEffect.kind === "may_change_access"
          ? event.accessEffect.causes
          : [],
      event_hash: event.eventHash,
      occurred_at: event.occurredAt,
      recorded_at: event.recordedAt
    }))
  );
  return sql`
    with event_rows as (
      select *
      from jsonb_to_recordset(${rows}::jsonb)
        as event_row(
          id text,
          ordinal smallint,
          type_id text,
          payload_schema_id text,
          payload_schema_version text,
          change_ids jsonb,
          subjects jsonb,
          payload_reference jsonb,
          correlation_id text,
          command_ids jsonb,
          client_mutation_ids jsonb,
          authorization_decision_refs jsonb,
          access_effect text,
          access_effect_causes jsonb,
          event_hash text,
          occurred_at timestamptz,
          recorded_at timestamptz
        )
    )
    insert into inbox_v2_domain_events (
      tenant_id,
      id,
      mutation_id,
      stream_commit_id,
      stream_position,
      ordinal,
      type_id,
      payload_schema_id,
      payload_schema_version,
      change_ids,
      subjects,
      payload_reference,
      correlation_id,
      command_ids,
      client_mutation_ids,
      authorization_decision_refs,
      access_effect,
      access_effect_causes,
      event_hash,
      occurred_at,
      recorded_at
    )
    select ${input.input.tenantId},
           event_rows.id,
           ${input.input.records.mutationId},
           ${input.input.records.streamCommitId},
           ${input.streamPosition},
           event_rows.ordinal,
           event_rows.type_id,
           event_rows.payload_schema_id,
           event_rows.payload_schema_version,
           event_rows.change_ids,
           event_rows.subjects,
           event_rows.payload_reference,
           event_rows.correlation_id,
           event_rows.command_ids,
           event_rows.client_mutation_ids,
           event_rows.authorization_decision_refs,
           event_rows.access_effect::inbox_v2_domain_event_access_effect,
           event_rows.access_effect_causes,
           event_rows.event_hash,
           event_rows.occurred_at,
           event_rows.recorded_at
    from event_rows
    order by event_rows.ordinal
    returning id
  `;
}

export function buildInsertInboxV2OutboxIntentsSql(input: {
  input: WithPrivilegedAuthorizationMutationInput;
  streamPosition: string;
}): SQL {
  const rows = JSON.stringify(
    input.input.records.outboxIntents.map((intent) => ({
      id: intent.id,
      ordinal: intent.ordinal,
      type_id: intent.typeId,
      handler_id: intent.handlerId,
      effect_class: intent.effectClass,
      event_id: intent.eventId,
      consumer_dedupe_key: intent.consumerDedupeKey,
      change_ids: intent.changeIds,
      payload_reference: intent.payloadReference,
      correlation_id: intent.correlationId,
      intent_hash: intent.intentHash,
      available_at: intent.availableAt
    }))
  );
  return sql`
    with intent_rows as (
      select *
      from jsonb_to_recordset(${rows}::jsonb)
        as intent_row(
          id text,
          ordinal smallint,
          type_id text,
          handler_id text,
          effect_class text,
          event_id text,
          consumer_dedupe_key text,
          change_ids jsonb,
          payload_reference jsonb,
          correlation_id text,
          intent_hash text,
          available_at timestamptz
        )
    )
    insert into inbox_v2_outbox_intents (
      tenant_id,
      id,
      mutation_id,
      stream_commit_id,
      stream_position,
      ordinal,
      type_id,
      handler_id,
      effect_class,
      event_id,
      consumer_dedupe_key,
      change_ids,
      payload_reference,
      correlation_id,
      intent_hash,
      available_at,
      created_at
    )
    select ${input.input.tenantId},
           intent_rows.id,
           ${input.input.records.mutationId},
           ${input.input.records.streamCommitId},
           ${input.streamPosition},
           intent_rows.ordinal,
           intent_rows.type_id,
           intent_rows.handler_id,
           intent_rows.effect_class::inbox_v2_outbox_intent_effect_class,
           intent_rows.event_id,
           intent_rows.consumer_dedupe_key,
           intent_rows.change_ids,
           intent_rows.payload_reference,
           intent_rows.correlation_id,
           intent_rows.intent_hash,
           intent_rows.available_at,
           ${input.input.occurredAt}
    from intent_rows
    order by intent_rows.ordinal
    returning id
  `;
}

export function buildCompleteInboxV2AuthorizationCommandSql(
  input: WithPrivilegedAuthorizationMutationInput
): SQL {
  const actor = actorColumns(input.command.actor);
  return sql`
    update inbox_v2_auth_command_records command
    set state = 'completed',
        mutation_id = ${input.records.mutationId},
        result_reference = ${input.command.resultReference === null ? null : JSON.stringify(input.command.resultReference)}::jsonb,
        sensitive_result_reference = ${input.command.sensitiveResultReference},
        revision = command.revision + 1,
        updated_at = ${input.occurredAt}
    where command.tenant_id = ${input.tenantId}
      and command.id = ${input.command.id}
      and command.first_request_id = ${input.command.requestId}
      and command.client_mutation_id = ${input.command.clientMutationId}
      and command.command_type_id = ${input.command.commandTypeId}
      and command.request_hash = ${input.command.requestHash}
      and command.actor_kind = ${actor.kind}
      and command.actor_employee_id is not distinct from ${actor.employeeId}
      and command.actor_trusted_service_id is not distinct from ${actor.trustedServiceId}
      and command.authorization_decision_id = ${input.command.authorizationDecisionId}
      and command.authorization_epoch = ${input.command.authorizationEpoch}
      and command.authorized_at = ${input.command.authorizedAt}
      and command.authorization_not_after = ${earliestAuthorizationNotAfter(input.records.audit.authorizationDecisionRefs)}
      and command.state = 'pending'
      and command.mutation_id is null
      and command.result_reference is null
      and command.sensitive_result_reference is null
      and command.revision = 1
    returning command.id
  `;
}

export function buildInsertInboxV2AuthorizationAuditEventSql(
  input: WithPrivilegedAuthorizationMutationInput
): SQL {
  const audit = input.records.audit;
  const actor = actorColumns(input.command.actor);
  const facetRows = authorizationAuditFacetRows(input);
  const facetsDigestSha256 = computeInboxV2LeafHashDigest(
    facetRows.map(({ facet_hash }) => facet_hash)
  );
  return sql`
    insert into inbox_v2_auth_audit_events (
      tenant_id,
      id,
      mutation_id,
      command_record_id,
      category,
      action_id,
      actor_kind,
      actor_employee_id,
      actor_trusted_service_id,
      target_type_id,
      internal_target_ref,
      facet_count,
      facets_digest_sha256,
      authorization_decision_refs,
      authorization_epoch,
      revision_delta_hash,
      reason_code_id,
      client_mutation_id,
      command_type_id,
      request_hash,
      correlation_id,
      matched_permission_ids,
      grant_source_ids,
      scope_ids,
      override_reason_id,
      policy_version,
      evidence_reference,
      outcome,
      previous_audit_hash,
      audit_hash,
      occurred_at,
      recorded_at,
      expires_at,
      created_at
    ) values (
      ${input.tenantId},
      ${audit.id},
      ${input.records.mutationId},
      ${input.command.id},
      'privileged_security',
      ${audit.actionId},
      ${actor.kind},
      ${actor.employeeId},
      ${actor.trustedServiceId},
      ${audit.target.entityTypeId},
      ${audit.target.entityId},
      ${facetRows.length},
      ${facetsDigestSha256},
      ${JSON.stringify(audit.authorizationDecisionRefs)}::jsonb,
      ${input.command.authorizationEpoch},
      ${audit.revisionDeltaHash},
      ${audit.reasonCodeId},
      ${input.command.clientMutationId},
      ${input.command.commandTypeId},
      ${input.command.requestHash},
      ${audit.correlationId},
      array(select jsonb_array_elements_text(${JSON.stringify(audit.matchedPermissionIds)}::jsonb)),
      array(select jsonb_array_elements_text(${JSON.stringify(audit.grantSourceIds)}::jsonb)),
      array(select jsonb_array_elements_text(${JSON.stringify(audit.authorizationScopeIds)}::jsonb)),
      ${audit.overrideReasonCodeId},
      ${audit.policyVersion},
      ${audit.evidenceReference === null ? null : JSON.stringify(audit.evidenceReference)}::jsonb,
      ${audit.outcome},
      ${audit.previousAuditHash},
      ${audit.auditHash},
      ${audit.occurredAt},
      ${audit.recordedAt},
      ${audit.expiresAt},
      ${audit.recordedAt}
    )
    returning id
  `;
}

export function buildInsertInboxV2AuthorizationAuditFacetsSql(
  input: WithPrivilegedAuthorizationMutationInput
): SQL {
  const rows = JSON.stringify(authorizationAuditFacetRows(input));
  return sql`
    with facet_rows as (
      select *
      from jsonb_to_recordset(${rows}::jsonb)
        as facet_row(
          ordinal smallint,
          dimension text,
          facet_kind text,
          entity_type_id text,
          internal_entity_ref text,
          facet_hash text
        )
    )
    insert into inbox_v2_auth_audit_facets (
      tenant_id,
      audit_event_id,
      ordinal,
      dimension,
      facet_kind,
      entity_type_id,
      internal_entity_ref,
      facet_hash,
      created_at
    )
    select ${input.tenantId},
           ${input.records.audit.id},
           facet_rows.ordinal,
           facet_rows.dimension,
           facet_rows.facet_kind::inbox_v2_auth_audit_facet_kind,
           facet_rows.entity_type_id,
           facet_rows.internal_entity_ref,
           facet_rows.facet_hash,
           ${input.records.audit.recordedAt}
    from facet_rows
    order by facet_rows.ordinal
    returning audit_event_id as id
  `;
}

export function buildInsertInboxV2AuthorizationMutationCommitSql(input: {
  input: WithPrivilegedAuthorizationMutationInput;
  revisionEffects: readonly InboxV2AuthorizationRevisionEffect[];
  relationWrites: readonly InboxV2AuthorizationRelationRevisionEffect[];
}): SQL {
  const revisionRows = authorizationRevisionEffectRows(
    input.input,
    input.revisionEffects
  );
  const relationRows = authorizationRelationWriteRows(
    input.input,
    input.relationWrites
  );
  const revisionEffectDigest = computeInboxV2LeafHashDigest(
    revisionRows.map(({ effect_hash }) => effect_hash)
  );
  const relationWriteDigest = computeInboxV2LeafHashDigest(
    relationRows.map(({ write_hash }) => write_hash)
  );
  const projectionIntentCount = input.input.records.outboxIntents.filter(
    ({ effectClass }) => effectClass === "projection"
  ).length;
  const manifestDigest = computeInboxV2AuthorizationMutationManifestDigest({
    revisionEffectDigest,
    relationWriteDigest,
    streamCommitHash: input.input.records.commitHash,
    auditHash: input.input.records.audit.auditHash
  });
  return sql`
    insert into inbox_v2_auth_mutation_commits (
      tenant_id,
      mutation_id,
      command_record_id,
      stream_commit_id,
      audit_event_id,
      revision_effect_count,
      revision_effect_digest_sha256,
      relation_write_count,
      relation_write_digest_sha256,
      projection_intent_count,
      manifest_digest_sha256,
      committed_at,
      created_at
    ) values (
      ${input.input.tenantId},
      ${input.input.records.mutationId},
      ${input.input.command.id},
      ${input.input.records.streamCommitId},
      ${input.input.records.audit.id},
      ${revisionRows.length},
      ${revisionEffectDigest},
      ${relationRows.length},
      ${relationWriteDigest},
      ${projectionIntentCount},
      ${manifestDigest},
      ${input.input.occurredAt},
      ${input.input.occurredAt}
    )
    returning mutation_id as id
  `;
}

export function buildInsertInboxV2AuthorizationRevisionEffectsSql(
  input: WithPrivilegedAuthorizationMutationInput,
  effects: readonly InboxV2AuthorizationRevisionEffect[]
): SQL {
  const rows = JSON.stringify(authorizationRevisionEffectRows(input, effects));
  return sql`
    with effect_rows as (
      select *
      from jsonb_to_recordset(${rows}::jsonb)
        as effect_row(
          id text,
          ordinal smallint,
          effect_kind text,
          before_revision bigint,
          after_revision bigint,
          employee_id text,
          resource_head_id text,
          work_item_id text,
          work_item_cycle bigint,
          expected_work_item_revision bigint,
          resulting_work_item_revision bigint,
          effect_hash text
        )
    )
    insert into inbox_v2_auth_revision_effects (
      tenant_id,
      id,
      mutation_id,
      ordinal,
      effect_kind,
      before_revision,
      after_revision,
      employee_id,
      resource_head_id,
      work_item_id,
      work_item_cycle,
      expected_work_item_revision,
      resulting_work_item_revision,
      effect_hash,
      created_at
    )
    select ${input.tenantId},
           effect_rows.id,
           ${input.records.mutationId},
           effect_rows.ordinal,
           effect_rows.effect_kind::inbox_v2_auth_revision_effect_kind,
           effect_rows.before_revision,
           effect_rows.after_revision,
           effect_rows.employee_id,
           effect_rows.resource_head_id,
           effect_rows.work_item_id,
           effect_rows.work_item_cycle,
           effect_rows.expected_work_item_revision,
           effect_rows.resulting_work_item_revision,
           effect_rows.effect_hash,
           ${input.occurredAt}
    from effect_rows
    order by effect_rows.ordinal
    returning id
  `;
}

export function buildInsertInboxV2AuthorizationRelationWritesSql(
  input: WithPrivilegedAuthorizationMutationInput,
  writes: readonly InboxV2AuthorizationRelationRevisionEffect[]
): SQL {
  const rows = JSON.stringify(authorizationRelationWriteRows(input, writes));
  return sql`
    with relation_rows as (
      select *
      from jsonb_to_recordset(${rows}::jsonb)
        as relation_row(
          id text,
          ordinal smallint,
          relation_kind text,
          relation_id text,
          previous_revision bigint,
          resulting_revision bigint,
          role_id text,
          role_binding_id text,
          direct_grant_id text,
          workforce_membership_id text,
          structural_access_binding_id text,
          collaborator_id text,
          internal_membership_transition_id text,
          primary_responsibility_transition_id text,
          servicing_team_transition_id text,
          write_hash text
        )
    )
    insert into inbox_v2_auth_relation_writes (
      tenant_id,
      id,
      mutation_id,
      ordinal,
      relation_kind,
      relation_id,
      previous_revision,
      resulting_revision,
      role_id,
      role_binding_id,
      direct_grant_id,
      workforce_membership_id,
      structural_access_binding_id,
      collaborator_id,
      internal_membership_transition_id,
      primary_responsibility_transition_id,
      servicing_team_transition_id,
      write_hash,
      created_at
    )
    select ${input.tenantId},
           relation_rows.id,
           ${input.records.mutationId},
           relation_rows.ordinal,
           relation_rows.relation_kind::inbox_v2_auth_relation_kind,
           relation_rows.relation_id,
           relation_rows.previous_revision,
           relation_rows.resulting_revision,
           relation_rows.role_id,
           relation_rows.role_binding_id,
           relation_rows.direct_grant_id,
           relation_rows.workforce_membership_id,
           relation_rows.structural_access_binding_id,
           relation_rows.collaborator_id,
           relation_rows.internal_membership_transition_id,
           relation_rows.primary_responsibility_transition_id,
           relation_rows.servicing_team_transition_id,
           relation_rows.write_hash,
           ${input.occurredAt}
    from relation_rows
    order by relation_rows.ordinal
    returning id
  `;
}

export function buildAdvanceInboxV2TenantStreamHeadSql(input: {
  tenantId: string;
  streamEpoch: string;
  previousPosition: string;
  streamPosition: string;
  expectedHeadRevision: string;
  occurredAt: string;
}): SQL {
  return sql`
    update inbox_v2_tenant_stream_heads
    set last_position = ${input.streamPosition},
        revision = revision + 1,
        updated_at = ${input.occurredAt}
    where tenant_id = ${input.tenantId}
      and stream_epoch = ${input.streamEpoch}
      and last_position = ${input.previousPosition}
      and revision = ${input.expectedHeadRevision}
    returning tenant_id as id
  `;
}

type AuthorizationMutationAbortResult =
  | Extract<
      WithPrivilegedAuthorizationMutationResult<never>,
      { kind: "resource_not_found" }
    >
  | Extract<
      WithPrivilegedAuthorizationMutationResult<never>,
      { kind: "revision_conflict" }
    >
  | Extract<
      WithPrivilegedAuthorizationMutationResult<never>,
      { kind: "role_legality_conflict" }
    >;

class AuthorizationMutationAbort extends Error {
  constructor(readonly result: AuthorizationMutationAbortResult) {
    super(result.kind);
    this.name = "AuthorizationMutationAbort";
  }
}

export class InboxV2AuthorizationPersistenceInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InboxV2AuthorizationPersistenceInvariantError";
  }
}

async function runAuthorizationMutationTransaction<TResult>(
  executor: InboxV2AuthorizationTransactionExecutor,
  work: (
    transaction: RawSqlExecutor
  ) => Promise<WithPrivilegedAuthorizationMutationResult<TResult>>
): Promise<WithPrivilegedAuthorizationMutationResult<TResult>> {
  for (
    let attempt = 1;
    attempt <= AUTHORIZATION_MUTATION_TRANSACTION_ATTEMPTS;
    attempt += 1
  ) {
    try {
      return await executor.transaction(
        work,
        AUTHORIZATION_MUTATION_TRANSACTION_CONFIG
      );
    } catch (error) {
      if (error instanceof AuthorizationMutationAbort) {
        return error.result;
      }
      if (
        attempt === AUTHORIZATION_MUTATION_TRANSACTION_ATTEMPTS ||
        !hasRetryableSqlState(error)
      ) {
        throw error;
      }
    }
  }
  throw invariantError("Authorization mutation retry loop exhausted.");
}

async function loadAuthorizationCommandByIdempotencyScope(
  executor: RawSqlExecutor,
  input: WithPrivilegedAuthorizationMutationInput
): Promise<CommandReplayRow | null> {
  const result = await executor.execute<CommandReplayRow>(
    buildLockInboxV2AuthorizationCommandByScopeSql(input)
  );
  assertAtMostOneRow(result, "authorization command idempotency lookup");
  return result.rows[0] ?? null;
}

async function loadAuthorizationCommandById(
  executor: RawSqlExecutor,
  tenantId: string,
  commandId: string
): Promise<CommandReplayRow | null> {
  const result = await executor.execute<CommandReplayRow>(
    buildLockInboxV2AuthorizationCommandByIdSql({ tenantId, commandId })
  );
  assertAtMostOneRow(result, "authorization command ID lookup");
  return result.rows[0] ?? null;
}

function mapReplayStatus(
  row: CommandReplayRow,
  mutationId: string
): InboxV2PrivilegedAuthorizationMutationReplayStatus {
  return {
    commandId: asString(row.id, "replayed command ID"),
    mutationId,
    publicResultCode: asString(
      row.public_result_code,
      "replayed public result code"
    ),
    resultReference:
      row.result_reference === null
        ? null
        : inboxV2PayloadReferenceSchema.parse(row.result_reference),
    streamCommitId: asString(row.stream_commit_id, "replayed stream commit ID"),
    streamEpoch: asString(row.stream_epoch, "replayed stream epoch"),
    streamPosition: positiveCounter(
      row.stream_position,
      "replayed stream position"
    ),
    committedAt: asTimestamp(row.committed_at, "replayed commit time")
  };
}

function idempotencyConflict(): Extract<
  WithPrivilegedAuthorizationMutationResult<never>,
  { kind: "idempotency_conflict" }
> {
  return {
    kind: "idempotency_conflict",
    code: "command.idempotency_conflict"
  };
}

type AuthorizationRevisionEffectRow = Readonly<{
  id: string;
  ordinal: number;
  effect_kind: InboxV2AuthorizationRevisionEffect["kind"];
  before_revision: string;
  after_revision: string;
  employee_id: string | null;
  resource_head_id: string | null;
  work_item_id: string | null;
  work_item_cycle: string | null;
  expected_work_item_revision: string | null;
  resulting_work_item_revision: string | null;
  effect_hash: string;
}>;

function authorizationAuditFacetRows(
  input: WithPrivilegedAuthorizationMutationInput
): readonly Readonly<{
  ordinal: number;
  dimension: InboxV2AuthorizationAuditFacetInput["dimension"];
  facet_kind: InboxV2AuthorizationAuditFacetInput["relation"];
  entity_type_id: string;
  internal_entity_ref: string;
  facet_hash: string;
}>[] {
  return input.records.audit.facets.map((facet) => ({
    ordinal: facet.ordinal,
    dimension: facet.dimension,
    facet_kind: facet.relation,
    entity_type_id: String(facet.reference.entityTypeId),
    internal_entity_ref: String(facet.reference.entityId),
    facet_hash: facet.facetHash
  }));
}

function authorizationRevisionEffectRows(
  input: WithPrivilegedAuthorizationMutationInput,
  effects: readonly InboxV2AuthorizationRevisionEffect[]
): readonly AuthorizationRevisionEffectRow[] {
  const profile = authorizedCommandMutationProfile(input.records);
  if (effects.length > 1_000) {
    throw new TypeError(
      "Authorized command mutation revision manifest exceeds 1000 rows."
    );
  }
  if (profile === "authorization_relation" && effects.length === 0) {
    throw new TypeError(
      "Authorization relation mutation requires a non-empty revision manifest."
    );
  }
  if (profile === "domain" && effects.length > 0) {
    throw invariantError(
      "Domain mutation reached revision-row serialization with authorization effects."
    );
  }
  return effects.map((effect, index) => {
    const target = {
      employee_id: effect.employeeId,
      resource_head_id:
        (effect.kind === "resource_access" ||
          effect.kind === "collaborator_set") &&
        effect.resourceKind !== "work_item"
          ? effect.resourceHeadId
          : null,
      work_item_id:
        (effect.kind === "resource_access" ||
          effect.kind === "collaborator_set") &&
        effect.resourceKind === "work_item"
          ? effect.resourceId
          : null,
      work_item_cycle:
        effect.kind === "collaborator_set" ? effect.workItemCycle : null,
      expected_work_item_revision:
        effect.kind === "collaborator_set"
          ? effect.expectedWorkItemRevision
          : null,
      resulting_work_item_revision:
        effect.kind === "collaborator_set"
          ? effect.resultingWorkItemRevision
          : null
    };
    const base = {
      id: effect.id,
      ordinal: index + 1,
      effect_kind: effect.kind,
      before_revision: effect.previousRevision,
      after_revision: effect.resultingRevision,
      ...target
    };
    return {
      ...base,
      effect_hash: sha256Canonical({
        tenantId: input.tenantId,
        mutationId: input.records.mutationId,
        ...base
      })
    };
  });
}

type AuthorizationRelationWriteRow = Readonly<{
  id: string;
  ordinal: number;
  relation_kind: InboxV2AuthorizationRelationKind;
  relation_id: string;
  previous_revision: string | null;
  resulting_revision: string;
  role_id: string | null;
  role_binding_id: string | null;
  direct_grant_id: string | null;
  workforce_membership_id: string | null;
  structural_access_binding_id: string | null;
  collaborator_id: string | null;
  internal_membership_transition_id: string | null;
  primary_responsibility_transition_id: string | null;
  servicing_team_transition_id: string | null;
  write_hash: string;
}>;

function authorizationRelationWriteRows(
  input: WithPrivilegedAuthorizationMutationInput,
  writes: readonly InboxV2AuthorizationRelationRevisionEffect[]
): readonly AuthorizationRelationWriteRow[] {
  const relationKind = input.records.relationKind;
  if (relationKind === null) {
    if (writes.length > 0) {
      throw invariantError(
        "Domain mutation reached relation-row serialization with relation writes."
      );
    }
    return [];
  }
  return writes.map((write) => {
    const typedReference = relationWriteReferenceColumns(
      relationKind,
      write.relationId
    );
    const base = {
      id: write.id,
      ordinal: write.ordinal,
      relation_kind: relationKind,
      relation_id: write.relationId,
      previous_revision: write.previousRevision,
      resulting_revision: write.resultingRevision,
      ...typedReference
    };
    return {
      ...base,
      write_hash: sha256Canonical({
        tenantId: input.tenantId,
        mutationId: input.records.mutationId,
        ...base
      })
    };
  });
}

function relationWriteReferenceColumns(
  kind: InboxV2AuthorizationRelationKind,
  relationId: string
): Omit<
  AuthorizationRelationWriteRow,
  | "id"
  | "ordinal"
  | "relation_kind"
  | "relation_id"
  | "previous_revision"
  | "resulting_revision"
  | "write_hash"
> {
  const columns: {
    role_id: string | null;
    role_binding_id: string | null;
    direct_grant_id: string | null;
    workforce_membership_id: string | null;
    structural_access_binding_id: string | null;
    collaborator_id: string | null;
    internal_membership_transition_id: string | null;
    primary_responsibility_transition_id: string | null;
    servicing_team_transition_id: string | null;
  } = {
    role_id: null,
    role_binding_id: null,
    direct_grant_id: null,
    workforce_membership_id: null,
    structural_access_binding_id: null,
    collaborator_id: null,
    internal_membership_transition_id: null,
    primary_responsibility_transition_id: null,
    servicing_team_transition_id: null
  };
  switch (kind) {
    case "role":
      columns.role_id = relationId;
      break;
    case "role_binding":
      columns.role_binding_id = relationId;
      break;
    case "direct_grant":
      columns.direct_grant_id = relationId;
      break;
    case "workforce_membership":
      columns.workforce_membership_id = relationId;
      break;
    case "structural_access":
      columns.structural_access_binding_id = relationId;
      break;
    case "conversation_collaborator":
    case "work_item_collaborator":
      columns.collaborator_id = relationId;
      break;
    case "internal_membership":
      columns.internal_membership_transition_id = relationId;
      break;
    case "primary_responsibility":
      columns.primary_responsibility_transition_id = relationId;
      break;
    case "servicing_team":
      columns.servicing_team_transition_id = relationId;
      break;
  }
  return columns;
}

export function computeInboxV2LeafHashDigest(
  hashesInOrdinalOrder: readonly string[]
): string {
  for (const hash of hashesInOrdinalOrder) {
    assertSha256(hash, "manifest leaf hash");
  }
  return sha256Text(hashesInOrdinalOrder.join("\n"));
}

export function computeInboxV2TenantStreamManifestDigest(
  records: Pick<
    InboxV2AuthorizationMutationRecords,
    "changes" | "events" | "outboxIntents"
  >
): string {
  const changeHashes = records.changes.map(({ state }) =>
    String(state.stateHash)
  );
  const eventHashes = records.events.map(({ eventHash }) => String(eventHash));
  const intentHashes = records.outboxIntents.map(({ intentHash }) =>
    String(intentHash)
  );
  for (const hash of [...changeHashes, ...eventHashes, ...intentHashes]) {
    assertSha256(hash, "stream manifest leaf hash");
  }
  return sha256Text(
    [
      ...changeHashes.map((hash) => `change:${hash}`),
      ...eventHashes.map((hash) => `event:${hash}`),
      ...intentHashes.map((hash) => `intent:${hash}`)
    ].join("\n")
  );
}

export function computeInboxV2AuthorizationMutationManifestDigest(input: {
  revisionEffectDigest: string;
  relationWriteDigest: string;
  streamCommitHash: string;
  auditHash: string;
}): string {
  for (const [label, value] of Object.entries(input)) {
    assertSha256(value, label);
  }
  return sha256Text(
    [
      `effects:${input.revisionEffectDigest}`,
      `relations:${input.relationWriteDigest}`,
      `stream:${input.streamCommitHash}`,
      `audit:${input.auditHash}`
    ].join("\n")
  );
}

function sha256Text(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function sha256Canonical(value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(canonicalJson(value), "utf8")
    .digest("hex")}`;
}

function canonicalJson(value: unknown): string {
  const normalize = (candidate: unknown): unknown => {
    if (Array.isArray(candidate)) return candidate.map(normalize);
    if (typeof candidate === "object" && candidate !== null) {
      const record = candidate as Readonly<Record<string, unknown>>;
      return Object.fromEntries(
        Object.keys(record)
          .sort(comparePostgresCText)
          .map((key) => [key, normalize(record[key])])
      );
    }
    if (
      candidate === null ||
      typeof candidate === "string" ||
      typeof candidate === "number" ||
      typeof candidate === "boolean"
    ) {
      return candidate;
    }
    throw new TypeError(
      "Canonical authorization manifest contains an unsupported value."
    );
  };
  return JSON.stringify(normalize(value));
}

function normalizeRelationWrites(
  input: WithPrivilegedAuthorizationMutationInput,
  writes: readonly InboxV2AuthorizationRelationRevisionEffect[]
): readonly InboxV2AuthorizationRelationRevisionEffect[] {
  if (authorizedCommandMutationProfile(input.records) === "domain") {
    if (writes.length > 0) {
      throw new TypeError(
        "Domain mutation cannot persist authorization relation writes."
      );
    }
    return [];
  }
  if (writes.length === 0) {
    throw new TypeError(
      "Authorization mutation must persist a relation write proof."
    );
  }
  if (writes.length > MAX_AUTHORIZATION_RELATION_WRITES) {
    throw new TypeError(
      "Authorization relation write manifest exceeds 1000 rows."
    );
  }
  assertUnique(
    writes.map(({ id }) => id),
    "relation write IDs"
  );
  assertUnique(
    writes.map(({ ordinal }) => String(ordinal)),
    "relation write ordinals"
  );
  assertUnique(
    writes.map(({ relationId }) => relationId),
    "relation write relation IDs"
  );
  assertCanonicalOrder(
    writes.map(({ relationId }) => relationId),
    "relation write relation IDs"
  );
  const sorted = [...writes];
  assertConsecutiveOrdinals(
    sorted.map(({ ordinal }) => ordinal),
    "relation writes"
  );
  return sorted.map((effect) => {
    assertExactKeys(
      effect,
      ["id", "ordinal", "relationId", "previousRevision", "resultingRevision"],
      "relation write proof"
    );
    assertNonEmpty(effect.id, "relation write ID");
    assertInternalDomainId(effect.id, "relation write ID");
    if (!Number.isInteger(effect.ordinal) || effect.ordinal < 1) {
      throw new TypeError("Relation write ordinal must be a positive integer.");
    }
    assertNonEmpty(effect.relationId, "relation write relation ID");
    assertInternalDomainId(effect.relationId, "relation write relation ID");
    if (effect.previousRevision !== null) {
      assertPositiveCounter(
        effect.previousRevision,
        "relation previous revision"
      );
    }
    const expectedResultingRevision =
      effect.previousRevision === null
        ? "1"
        : incrementCounter(effect.previousRevision);
    if (effect.resultingRevision !== expectedResultingRevision) {
      throw new TypeError("Relation write revision must advance exactly once.");
    }
    return effect;
  });
}

async function expectOneRow(
  executor: RawSqlExecutor,
  query: SQL,
  label: string
): Promise<void> {
  await expectExactRows(executor, query, 1, label);
}

async function expectExactRows(
  executor: RawSqlExecutor,
  query: SQL,
  expected: number,
  label: string
): Promise<void> {
  const result = await executor.execute<Record<string, unknown>>(query);
  if (result.rows.length !== expected) {
    throw invariantError(
      `${label} affected ${result.rows.length} rows; expected ${expected}.`
    );
  }
}

function assertAtMostOneRow<Row>(
  result: RawSqlQueryResult<Row>,
  label: string
): void {
  if (result.rows.length > 1) {
    throw invariantError(`${label} returned more than one row.`);
  }
}

function actorColumns(actor: InboxV2AuthorizationActor): Readonly<{
  kind: InboxV2AuthorizationActor["kind"];
  employeeId: string | null;
  trustedServiceId: string | null;
}> {
  return actor.kind === "employee"
    ? {
        kind: actor.kind,
        employeeId: actor.employeeId,
        trustedServiceId: null
      }
    : {
        kind: actor.kind,
        employeeId: null,
        trustedServiceId: actor.trustedServiceId
      };
}

function authorizationCommandPrincipal(
  input: WithPrivilegedAuthorizationMutationInput
) {
  return input.command.actor.kind === "employee"
    ? {
        kind: "employee" as const,
        employee: {
          tenantId: input.tenantId,
          kind: "employee" as const,
          id: input.command.actor.employeeId
        }
      }
    : {
        kind: "trusted_service" as const,
        trustedServiceId: input.command.actor.trustedServiceId
      };
}

function earliestAuthorizationNotAfter(
  decisions: readonly InboxV2AuthorizationDecisionReference[]
): string {
  if (decisions.length === 0) {
    throw new TypeError(
      "Authorization command requires at least one decision expiry fence."
    );
  }
  return decisions.reduce((earliest, decision) => {
    assertTimestamp(decision.notAfter, "authorization decision notAfter");
    return Date.parse(decision.notAfter) < Date.parse(earliest)
      ? decision.notAfter
      : earliest;
  }, decisions[0]!.notAfter);
}

function serializeStructuralResourceRequests(
  resources: readonly InboxV2AuthorizationResourceRevisionExpectation[]
): string {
  return JSON.stringify(
    resources.map((resource) => ({
      head_id: resource.resourceHeadId,
      resource_kind: resource.resourceKind,
      conversation_id:
        resource.resourceKind === "conversation" ? resource.resourceId : null,
      client_id:
        resource.resourceKind === "client" ? resource.resourceId : null,
      source_account_id:
        resource.resourceKind === "source_account" ? resource.resourceId : null
    }))
  );
}

function auditFacetKind(
  reference: InboxV2InternalEntityReference
): "tenant" | "org_unit" | "team" | "queue" | "resource" {
  switch (String(reference.entityTypeId)) {
    case "core:tenant":
      return "tenant";
    case "core:org-unit":
      return "org_unit";
    case "core:team":
      return "team";
    case "core:work-queue":
      return "queue";
    case "core:conversation":
    case "core:client":
    case "core:work-item":
    case "core:source-account":
      return "resource";
    default:
      throw new TypeError("Audit facet reference type is not allowlisted.");
  }
}

function resourceKindOrder(kind: InboxV2AuthorizationResourceKind): number {
  switch (kind) {
    case "conversation":
      return 0;
    case "client":
      return 1;
    case "source_account":
      return 2;
    case "work_item":
      return 3;
  }
}

function asResourceKind(value: unknown): InboxV2AuthorizationResourceKind {
  if (
    value === "conversation" ||
    value === "client" ||
    value === "source_account" ||
    value === "work_item"
  ) {
    return value;
  }
  throw invariantError("Persisted authorization resource kind is invalid.");
}

function resourceKey(
  kind: InboxV2AuthorizationResourceKind,
  id: string
): string {
  return `${kind}\u0000${id}`;
}

function incrementCounter(value: string): string {
  const current = BigInt(value);
  if (current >= POSTGRES_BIGINT_MAX) {
    throw new TypeError("PostgreSQL bigint counter cannot advance past max.");
  }
  return (current + 1n).toString();
}

function positiveCounter(value: unknown, label: string): string {
  const normalized = asCounter(value, label);
  if (BigInt(normalized) < 1n) {
    throw invariantError(`${label} must be positive.`);
  }
  return normalized;
}

function positiveOrZeroCounter(value: unknown, label: string): string {
  const normalized = asCounter(value, label);
  if (BigInt(normalized) < 0n) {
    throw invariantError(`${label} cannot be negative.`);
  }
  return normalized;
}

function asCounter(value: unknown, label: string): string {
  const normalized =
    typeof value === "bigint"
      ? value.toString()
      : typeof value === "number" && Number.isSafeInteger(value)
        ? String(value)
        : typeof value === "string"
          ? value
          : null;
  if (
    normalized === null ||
    !isCanonicalPostgresBigintDecimal(normalized, true)
  ) {
    throw invariantError(`${label} is not a PostgreSQL bigint counter.`);
  }
  return BigInt(normalized).toString();
}

function asString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw invariantError(`${label} must be a non-empty string.`);
  }
  return value;
}

function nullableString(value: unknown): string | null {
  return value === null ? null : asString(value, "nullable persisted string");
}

function nullableTimestamp(value: unknown, label: string): string | null {
  return value === null ? null : asTimestamp(value, label);
}

function asTimestamp(value: unknown, label: string): string {
  const candidate =
    value instanceof Date ? value.toISOString() : asString(value, label);
  if (!Number.isFinite(Date.parse(candidate))) {
    throw invariantError(`${label} must be a finite timestamp.`);
  }
  return new Date(candidate).toISOString();
}

function positiveBoundedInteger(
  value: unknown,
  maximum: number,
  label: string
): number {
  const counter = BigInt(positiveCounter(value, label));
  if (counter > BigInt(maximum)) {
    throw invariantError(`${label} exceeds its bounded maximum.`);
  }
  return Number(counter);
}

function assertNonEmpty(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new TypeError(`${label} must be non-empty.`);
  }
}

function assertInternalDomainId(value: string, label: string): void {
  if (!INTERNAL_DOMAIN_ID_PATTERN.test(value)) {
    throw new TypeError(
      `${label} must be a bounded, namespaced, PII-free internal ID.`
    );
  }
}

function assertSha256(value: string, label: string): void {
  if (!SHA256_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a canonical sha256 digest.`);
  }
}

function assertTimestamp(value: string, label: string): void {
  if (!Number.isFinite(Date.parse(value))) {
    throw new TypeError(`${label} must be a finite timestamp.`);
  }
}

function assertPositiveCounter(value: string, label: string): void {
  if (!isCanonicalPostgresBigintDecimal(value, false)) {
    throw new TypeError(`${label} must be a positive bigint counter.`);
  }
}

function assertNonNegativeCounter(value: string, label: string): void {
  if (!isCanonicalPostgresBigintDecimal(value, true)) {
    throw new TypeError(
      `${label} must be a canonical nonnegative PostgreSQL bigint counter.`
    );
  }
}

function isCanonicalPostgresBigintDecimal(
  value: string,
  allowZero: boolean
): boolean {
  const pattern = allowZero ? /^(?:0|[1-9]\d*)$/u : /^[1-9]\d*$/u;
  return (
    pattern.test(value) &&
    (value.length < POSTGRES_BIGINT_MAX_DECIMAL.length ||
      (value.length === POSTGRES_BIGINT_MAX_DECIMAL.length &&
        value <= POSTGRES_BIGINT_MAX_DECIMAL))
  );
}

function assertOptionalRelationRevisionPair(
  expectedRevision: string | undefined,
  advance: "none" | "repository" | "callback" | undefined,
  label: string
): void {
  if (advance !== undefined) {
    assertAuthorizationResourceAdvanceMode(advance, label);
  }
  if ((expectedRevision === undefined) !== (advance === undefined)) {
    throw new TypeError(
      `${label} expectation and advance mode must be provided together.`
    );
  }
  if (expectedRevision !== undefined) {
    assertPositiveCounter(expectedRevision, `${label} expected revision`);
  }
}

function assertAuthorizationResourceAdvanceMode(
  value: unknown,
  label: string
): asserts value is "none" | "repository" | "callback" {
  if (value !== "none" && value !== "repository" && value !== "callback") {
    throw new TypeError(`${label} advance mode is invalid.`);
  }
}

function assertAuthorizationResourceKind(
  value: unknown
): asserts value is InboxV2AuthorizationResourceKind {
  if (
    value !== "conversation" &&
    value !== "client" &&
    value !== "source_account" &&
    value !== "work_item"
  ) {
    throw new TypeError("Authorization resource kind is not supported.");
  }
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new TypeError(`${label} must be unique.`);
  }
}

function assertCanonicalOrder(values: readonly string[], label: string): void {
  if (
    values.some(
      (value, index) =>
        index > 0 && comparePostgresCText(values[index - 1]!, value) >= 0
    )
  ) {
    throw new TypeError(`${label} must use unique PostgreSQL C order.`);
  }
}

function assertExactKeys(
  value: object,
  allowedKeys: readonly string[],
  label: string
): void {
  const allowed = new Set(allowedKeys);
  const extras = Object.keys(value).filter((key) => !allowed.has(key));
  if (extras.length > 0) {
    throw new TypeError(
      `${label} contains unsupported fields: ${extras.sort(comparePostgresCText).join(", ")}.`
    );
  }
}

function assertInboxV2AtomicMaterializationSealResult(
  value: unknown
): asserts value is InboxV2AuthorizedAtomicMaterializationSealResult<unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(
      "Inbox V2 atomic materialization seal result must contain exactly result and receipt."
    );
  }
  assertExactKeys(
    value,
    ["result", "receipt"],
    "atomic materialization seal result"
  );
  if (!Object.hasOwn(value, "result") || !Object.hasOwn(value, "receipt")) {
    throw new TypeError(
      "Inbox V2 atomic materialization seal result must contain exactly result and receipt."
    );
  }
}

function assertInboxV2AtomicMessageCreationSealManifest(
  input: WithPrivilegedAuthorizationMutationInput,
  manifest: InboxV2AtomicMessageCreationSealManifest
): void {
  const messageChanges = input.records.changes.filter(
    (change) => change.entity.entityTypeId === "core:message"
  );
  const matchingChanges = messageChanges.filter(
    (change) =>
      change.entity.tenantId === manifest.tenantId &&
      String(change.entity.entityId) === String(manifest.messageId)
  );
  const change = matchingChanges[0];
  const state = change?.state;
  const timeline = change?.timeline;
  const payloadReference =
    state?.kind === "upsert" ? state.payloadReference : null;
  const domainCommitReference = state?.domainCommitReference;
  const commandResultReference = input.command.resultReference;
  const changeMatches =
    input.tenantId === manifest.tenantId &&
    messageChanges.length === 1 &&
    matchingChanges.length === 1 &&
    change !== undefined &&
    String(change.resultingRevision) === manifest.messageRevision &&
    change.audience === manifest.audience &&
    timeline !== null &&
    timeline.conversation.tenantId === manifest.tenantId &&
    String(timeline.conversation.id) === String(manifest.conversationId) &&
    String(timeline.timelineSequence) === manifest.timelineSequence &&
    state?.kind === "upsert" &&
    state.stateSchemaId === manifest.stateSchemaId &&
    state.stateSchemaVersion === manifest.stateSchemaVersion &&
    state.stateHash === manifest.stateHash &&
    payloadReference !== null &&
    payloadReferencesMatch(payloadReference, manifest.payloadReference) &&
    domainCommitReference !== undefined &&
    payloadReferencesMatch(
      domainCommitReference,
      manifest.domainCommitReference
    ) &&
    commandResultReference !== null &&
    payloadReferencesMatch(commandResultReference, payloadReference);
  if (!changeMatches) throw atomicMessageSealManifestMismatch();

  const messageEvent = assertInboxV2AtomicEntityEventAndProjectionClosure(
    input,
    change,
    manifest.event
  );

  assertInboxV2AtomicOutboundDispatchClosure(input, manifest, messageEvent);

  const sourceOccurrenceManifest = manifest.sourceOccurrence;
  const sourceOccurrenceChanges = input.records.changes.filter(
    (candidate) => candidate.entity.entityTypeId === "core:source-occurrence"
  );
  if (sourceOccurrenceManifest === null) {
    if (sourceOccurrenceChanges.length !== 0) {
      throw atomicMessageSealManifestMismatch();
    }
    return;
  }
  const sourceOccurrenceChange = sourceOccurrenceChanges.find(
    (candidate) =>
      candidate.entity.tenantId === manifest.tenantId &&
      String(candidate.entity.entityId) ===
        String(sourceOccurrenceManifest.sourceOccurrenceId)
  );
  const occurrenceState = sourceOccurrenceChange?.state;
  if (
    sourceOccurrenceChanges.length !== 1 ||
    sourceOccurrenceChange === undefined ||
    String(sourceOccurrenceChange.resultingRevision) !==
      sourceOccurrenceManifest.resultingRevision ||
    sourceOccurrenceChange.timeline !== null ||
    sourceOccurrenceChange.audience !== sourceOccurrenceManifest.audience ||
    occurrenceState?.kind !== "upsert" ||
    occurrenceState.stateSchemaId !== sourceOccurrenceManifest.stateSchemaId ||
    occurrenceState.stateSchemaVersion !==
      sourceOccurrenceManifest.stateSchemaVersion ||
    occurrenceState.stateHash !== sourceOccurrenceManifest.stateHash ||
    !payloadReferencesMatch(
      occurrenceState.payloadReference,
      sourceOccurrenceManifest.payloadReference
    ) ||
    !payloadReferencesMatch(
      occurrenceState.domainCommitReference,
      sourceOccurrenceManifest.domainCommitReference
    )
  ) {
    throw atomicMessageSealManifestMismatch();
  }
  assertInboxV2AtomicEntityEventAndProjectionClosure(
    input,
    sourceOccurrenceChange,
    sourceOccurrenceManifest.event
  );
}

function assertInboxV2AtomicTimelineItemCreationSealManifest(
  input: WithPrivilegedAuthorizationMutationInput,
  manifest: InboxV2AtomicTimelineItemCreationSealManifest
): void {
  const timelineItemChanges = input.records.changes.filter(
    (change) => change.entity.entityTypeId === "core:timeline-item"
  );
  const change = timelineItemChanges.find(
    (candidate) =>
      candidate.entity.tenantId === manifest.tenantId &&
      String(candidate.entity.entityId) === String(manifest.timelineItemId)
  );
  const state = change?.state;
  const timeline = change?.timeline;
  const commandResultReference = input.command.resultReference;
  const forbiddenProviderIntents = input.records.outboxIntents.filter(
    (intent) =>
      intent.effectClass === "provider_io" ||
      intent.typeId === "core:provider.dispatch"
  );
  if (
    input.tenantId !== manifest.tenantId ||
    input.records.changes.length !== 1 ||
    input.records.events.length !== 1 ||
    input.records.outboxIntents.length !== 1 ||
    timelineItemChanges.length !== 1 ||
    change === undefined ||
    String(change.resultingRevision) !== manifest.timelineItemRevision ||
    change.audience !== manifest.audience ||
    timeline === undefined ||
    timeline === null ||
    timeline.conversation.tenantId !== manifest.tenantId ||
    String(timeline.conversation.id) !== String(manifest.conversationId) ||
    String(timeline.timelineSequence) !== manifest.timelineSequence ||
    manifest.subjectKind !== "system_event" ||
    manifest.activityKind !== "non_activity" ||
    state?.kind !== "upsert" ||
    state.stateSchemaId !== manifest.stateSchemaId ||
    state.stateSchemaVersion !== manifest.stateSchemaVersion ||
    state.stateHash !== manifest.stateHash ||
    !payloadReferencesMatch(
      state.payloadReference,
      manifest.payloadReference
    ) ||
    !payloadReferencesMatch(
      state.domainCommitReference,
      manifest.domainCommitReference
    ) ||
    commandResultReference === null ||
    !payloadReferencesMatch(commandResultReference, state.payloadReference) ||
    forbiddenProviderIntents.length !== 0
  ) {
    throw atomicTimelineItemSealManifestMismatch();
  }

  const event = assertInboxV2AtomicEntityEventAndProjectionClosure(
    input,
    change,
    manifest.event,
    atomicTimelineItemSealManifestMismatch
  );
  const forbiddenTimelineSideEffects = input.records.outboxIntents.filter(
    (intent) =>
      (String(intent.eventId) === String(event.id) ||
        intent.changeIds.some((id) => String(id) === String(change.id))) &&
      (intent.effectClass !== "projection" ||
        intent.typeId !== "core:projection.update")
  );
  if (forbiddenTimelineSideEffects.length !== 0) {
    throw atomicTimelineItemSealManifestMismatch();
  }
}

function assertInboxV2AtomicEntityEventAndProjectionClosure(
  input: WithPrivilegedAuthorizationMutationInput,
  change: InboxV2AuthorizationStreamChangeInput,
  manifest: InboxV2AtomicStreamEventManifest,
  mismatch: () => Error = atomicMessageSealManifestMismatch
): InboxV2AuthorizationDomainEventInput {
  const events = input.records.events.filter(
    (event) =>
      event.changeIds.some(
        (changeId) => String(changeId) === String(change.id)
      ) ||
      event.subjects.some(
        (subject) =>
          subject.tenantId === change.entity.tenantId &&
          subject.entityTypeId === change.entity.entityTypeId &&
          String(subject.entityId) === String(change.entity.entityId)
      )
  );
  const event = events[0];
  if (
    events.length !== 1 ||
    event === undefined ||
    event.typeId !== manifest.typeId ||
    event.payloadSchemaId !== manifest.payloadSchemaId ||
    event.payloadSchemaVersion !== manifest.payloadSchemaVersion ||
    event.occurredAt !== manifest.occurredAt ||
    event.recordedAt !== manifest.recordedAt ||
    event.payloadReference === null ||
    !payloadReferencesMatch(
      event.payloadReference,
      manifest.payloadReference
    ) ||
    !event.changeIds.some(
      (changeId) => String(changeId) === String(change.id)
    ) ||
    !event.subjects.some(
      (subject) =>
        subject.tenantId === change.entity.tenantId &&
        subject.entityTypeId === change.entity.entityTypeId &&
        String(subject.entityId) === String(change.entity.entityId)
    )
  ) {
    throw mismatch();
  }
  const matchingProjections = input.records.outboxIntents.filter(
    (intent) =>
      intent.effectClass === "projection" &&
      intent.typeId === "core:projection.update" &&
      String(intent.eventId) === String(event.id) &&
      intent.changeIds.some(
        (changeId) => String(changeId) === String(change.id)
      )
  );
  if (matchingProjections.length !== 1) {
    throw mismatch();
  }
  return event;
}

function assertInboxV2AtomicOutboundDispatchClosure(
  input: WithPrivilegedAuthorizationMutationInput,
  manifest: InboxV2AtomicMessageCreationSealManifest,
  messageEvent: InboxV2AuthorizationDomainEventInput
): void {
  const dispatchChanges = input.records.changes.filter(
    (change) => change.entity.entityTypeId === "core:outbound-dispatch"
  );
  const providerIntents = input.records.outboxIntents.filter(
    (intent) =>
      intent.typeId === "core:provider.dispatch" ||
      intent.effectClass === "provider_io"
  );
  const dispatchManifest = manifest.outboundDispatch;
  if (dispatchManifest === null) {
    if (dispatchChanges.length !== 0 || providerIntents.length !== 0) {
      throw atomicMessageSealManifestMismatch();
    }
    return;
  }
  if (manifest.audience !== "conversation_external") {
    throw atomicMessageSealManifestMismatch();
  }

  const dispatchChange = dispatchChanges.find(
    (candidate) =>
      candidate.entity.tenantId === manifest.tenantId &&
      String(candidate.entity.entityId) === String(dispatchManifest.dispatchId)
  );
  const dispatchState = dispatchChange?.state;
  if (
    dispatchChanges.length !== 1 ||
    dispatchChange === undefined ||
    String(dispatchChange.resultingRevision) !==
      dispatchManifest.resultingRevision ||
    dispatchChange.timeline !== null ||
    dispatchChange.audience !== "conversation_external" ||
    dispatchState?.kind !== "upsert" ||
    dispatchState.stateSchemaId !== dispatchManifest.stateSchemaId ||
    dispatchState.stateSchemaVersion !== dispatchManifest.stateSchemaVersion ||
    dispatchState.stateHash !== dispatchManifest.stateHash ||
    !payloadReferencesMatch(
      dispatchState.payloadReference,
      dispatchManifest.payloadReference
    ) ||
    !payloadReferencesMatch(
      dispatchState.domainCommitReference,
      manifest.domainCommitReference
    )
  ) {
    throw atomicMessageSealManifestMismatch();
  }

  const providerIntent = providerIntents[0];
  if (
    providerIntents.length !== 1 ||
    providerIntent === undefined ||
    providerIntent.typeId !== "core:provider.dispatch" ||
    providerIntent.effectClass !== "provider_io" ||
    String(providerIntent.eventId) !== String(messageEvent.id) ||
    providerIntent.changeIds.length !== 1 ||
    String(providerIntent.changeIds[0]) !== String(dispatchChange.id) ||
    providerIntent.payloadReference === null ||
    !payloadReferencesMatch(
      providerIntent.payloadReference,
      dispatchManifest.payloadReference
    )
  ) {
    throw atomicMessageSealManifestMismatch();
  }
}

function payloadReferencesMatch(
  reference: InboxV2PayloadReference,
  expected: InboxV2PayloadReference
): boolean {
  return (
    reference.tenantId === expected.tenantId &&
    String(reference.recordId) === String(expected.recordId) &&
    reference.schemaId === expected.schemaId &&
    reference.schemaVersion === expected.schemaVersion &&
    reference.digest === expected.digest
  );
}

function atomicMessageSealManifestMismatch(): Error {
  return invariantError(
    "Inbox V2 atomic Message seal manifest does not match the exact stream change, event and projection closure."
  );
}

function atomicTimelineItemSealManifestMismatch(): Error {
  return invariantError(
    "Inbox V2 atomic TimelineItem seal manifest does not match the exact stream change, event and projection closure."
  );
}

function assertConsecutiveOrdinals(
  ordinals: readonly number[],
  label: string
): void {
  if (
    ordinals.some(
      (ordinal, index) => !Number.isInteger(ordinal) || ordinal !== index + 1
    )
  ) {
    throw new TypeError(`${label} ordinals must be contiguous from 1.`);
  }
}

function normalizedAuditCatalogIdArray(
  values: readonly string[],
  label: string
): readonly string[] {
  if (values.length === 0 || values.length > 256) {
    throw new TypeError(`${label} must contain between 1 and 256 values.`);
  }
  for (const value of values) inboxV2CatalogIdSchema.parse(value);
  assertUnique(values, label);
  assertCanonicalOrder(values, label);
  return [...values];
}

function normalizedAuditInternalRefArray(
  values: readonly string[],
  label: string
): readonly string[] {
  if (values.length === 0 || values.length > 256) {
    throw new TypeError(`${label} must contain between 1 and 256 values.`);
  }
  for (const value of values) inboxV2InternalOpaqueReferenceSchema.parse(value);
  assertUnique(values, label);
  assertCanonicalOrder(values, label);
  return [...values];
}

function sameStringArray(
  left: readonly unknown[],
  right: readonly string[]
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => String(value) === right[index])
  );
}

function decisionPrincipalMatchesActor(
  decision: InboxV2AuthorizationDecisionReference,
  actor: InboxV2AuthorizationActor
): boolean {
  if (actor.kind === "employee") {
    return (
      decision.principal.kind === "employee" &&
      decision.principal.employee.id === actor.employeeId
    );
  }
  return (
    decision.principal.kind === "trusted_service" &&
    decision.principal.trustedServiceId === actor.trustedServiceId
  );
}

function assertDirectAudienceEmployees(
  audienceImpact: InboxV2AuthorizationMutationRecords["audienceImpact"],
  expectedEmployeeIds: readonly string[]
): void {
  if (audienceImpact.kind !== "direct") {
    throw new TypeError(
      "Direct authorization mutation requires a direct audience manifest."
    );
  }
  const actualEmployeeIds = audienceImpact.affectedRecipients.map(
    ({ employee }) => String(employee.id)
  );
  if (!sameStringArray(actualEmployeeIds, expectedEmployeeIds)) {
    throw new TypeError(
      "Direct audience recipients must exactly match bounded Employee revision targets."
    );
  }
  assertUnique(actualEmployeeIds, "direct audience Employee IDs");
}

function assertAudienceImpactTenant(
  audienceImpact: InboxV2AuthorizationMutationRecords["audienceImpact"],
  tenantId: string
): void {
  if (audienceImpact.kind === "none") {
    return;
  }
  if (audienceImpact.kind === "direct") {
    for (const recipient of audienceImpact.affectedRecipients) {
      if (recipient.employee.tenantId !== tenantId) {
        throw new TypeError(
          "Direct audience recipient crosses the mutation tenant."
        );
      }
      assertInvalidationScopesTenant(recipient.invalidations, tenantId);
      for (const decision of recipient.authorizationDecisionRefs) {
        const parsed =
          inboxV2AuthorizationDecisionReferenceSchema.parse(decision);
        if (parsed.tenantId !== tenantId || parsed.outcome !== "allowed") {
          throw new TypeError(
            "Direct audience decision must be allowed and same-tenant."
          );
        }
      }
    }
    return;
  }
  assertInvalidationScopesTenant(audienceImpact.invalidations, tenantId);
}

function assertInvalidationScopesTenant(
  scopes: readonly (
    | Readonly<{ kind: "recipient_scope" }>
    | Readonly<{ kind: "projection"; projectionId: unknown }>
    | Readonly<{
        kind: "conversation";
        conversation: Readonly<{ tenantId: string }>;
      }>
    | Readonly<{
        kind: "entity";
        entity: Readonly<{ tenantId: string }>;
      }>
  )[],
  tenantId: string
): void {
  for (const scope of scopes) {
    if (
      (scope.kind === "conversation" &&
        scope.conversation.tenantId !== tenantId) ||
      (scope.kind === "entity" && scope.entity.tenantId !== tenantId)
    ) {
      throw new TypeError(
        "Audience invalidation scope crosses the mutation tenant."
      );
    }
  }
}

function assertAuthorizationRelationKind(
  value: string
): asserts value is InboxV2AuthorizationRelationKind {
  if (
    ![
      "role",
      "role_binding",
      "direct_grant",
      "workforce_membership",
      "structural_access",
      "conversation_collaborator",
      "work_item_collaborator",
      "internal_membership",
      "primary_responsibility",
      "servicing_team"
    ].includes(value)
  ) {
    throw new TypeError("Authorization relation kind is unsupported.");
  }
}

function comparePostgresCText(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function hasRetryableSqlState(error: unknown): boolean {
  let current = error;
  const seen = new Set<unknown>();
  for (let depth = 0; depth < 8; depth += 1) {
    if (
      (typeof current !== "object" || current === null) &&
      typeof current !== "function"
    ) {
      return false;
    }
    if (seen.has(current)) return false;
    seen.add(current);
    const candidate = current as { code?: unknown; cause?: unknown };
    if (
      typeof candidate.code === "string" &&
      RETRYABLE_SQLSTATES.has(candidate.code)
    ) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

function invariantError(
  message: string
): InboxV2AuthorizationPersistenceInvariantError {
  return new InboxV2AuthorizationPersistenceInvariantError(message);
}
