import {
  deriveInboxV2ClientMergeCommit,
  inboxV2ClientIdSchema,
  inboxV2ClientMergeCommitSchema,
  inboxV2ClientMergeDecisionSchema,
  inboxV2ClientMergeGraphHeadSchema,
  inboxV2ClientMergeNodeStateSchema,
  inboxV2ClientMergeRedirectIdSchema,
  inboxV2ClientMergeRedirectSchema,
  inboxV2ClientMergeResolutionPathSchema,
  inboxV2ClientMergeTrustedServiceIdSchema,
  inboxV2EntityRevisionSchema,
  inboxV2TenantIdSchema,
  inboxV2TimestampSchema,
  type InboxV2ClientId,
  type InboxV2ClientMergeCommit,
  type InboxV2ClientMergeDecision,
  type InboxV2ClientMergeGraphHead,
  type InboxV2ClientMergeNodeState,
  type InboxV2ClientMergeRedirectId,
  type InboxV2ClientMergeResolutionPath,
  type InboxV2ClientMergeTrustedServiceId,
  type InboxV2EntityRevision,
  type InboxV2TenantId
} from "@hulee/contracts";
import { CoreError } from "@hulee/core";
import { sql, type SQL } from "drizzle-orm";

import type { HuleeDatabase } from "../client";
import { InboxV2PersistenceInvariantError } from "./sql-inbox-v2-conversation-repository";
import type {
  RawSqlExecutor,
  RawSqlQueryResult
} from "./sql-outbox-repository";

const CLIENT_MERGE_TRANSACTION_CONFIG = {
  isolationLevel: "read committed"
} as const;
const CLIENT_MERGE_TRANSACTION_ATTEMPTS = 3;
const RETRYABLE_CLIENT_MERGE_SQLSTATES = new Set(["40001", "40P01"]);
const ENSURE_TENANT_HEAD_KEYS = new Set(["tenantId"]);
const ENSURE_CLIENT_NODE_KEYS = new Set(["tenantId", "clientId"]);
const RESOLVE_CANONICAL_KEYS = new Set([
  "tenantId",
  "clientId",
  "trustedServiceId",
  "resolvedAt"
]);
const MERGE_ROOTS_KEYS = new Set([
  "tenantId",
  "redirectId",
  "sourceRootClientId",
  "targetRootClientId",
  "expectedGraphRevision",
  "resolverTrustedServiceId",
  "resolvedAt",
  "decision",
  "createdAt"
]);

export type EnsureInboxV2ClientMergeTenantHeadInput = Readonly<{
  tenantId: InboxV2TenantId;
}>;

export type EnsureInboxV2ClientMergeTenantHeadResult =
  | Readonly<{
      kind: "ready";
      graphHead: InboxV2ClientMergeGraphHead | null;
    }>
  | Readonly<{ kind: "tenant_not_found" }>;

export type EnsureInboxV2ClientMergeNodeInput = Readonly<{
  tenantId: InboxV2TenantId;
  clientId: InboxV2ClientId;
}>;

export type EnsureInboxV2ClientMergeNodeResult =
  | Readonly<{
      kind: "ready";
      node: InboxV2ClientMergeNodeState;
    }>
  | Readonly<{ kind: "tenant_not_found" | "client_not_found" }>;

export type ResolveInboxV2CanonicalClientInput = Readonly<{
  tenantId: InboxV2TenantId;
  clientId: InboxV2ClientId;
  trustedServiceId: InboxV2ClientMergeTrustedServiceId;
  resolvedAt: string;
}>;

export type ResolveInboxV2CanonicalClientResult =
  | Readonly<{
      kind: "resolved";
      resolution: InboxV2ClientMergeResolutionPath;
    }>
  | Readonly<{ kind: "tenant_not_found" | "client_not_found" }>;

export type MergeInboxV2ClientRootsInput = Readonly<{
  tenantId: InboxV2TenantId;
  redirectId: InboxV2ClientMergeRedirectId;
  sourceRootClientId: InboxV2ClientId;
  targetRootClientId: InboxV2ClientId;
  expectedGraphRevision: InboxV2EntityRevision | null;
  resolverTrustedServiceId: InboxV2ClientMergeTrustedServiceId;
  resolvedAt: string;
  decision: InboxV2ClientMergeDecision;
  createdAt: string;
}>;

export type MergeInboxV2ClientRootsResult =
  | Readonly<{
      kind: "merged";
      commit: InboxV2ClientMergeCommit;
    }>
  | Readonly<{
      kind: "graph_revision_conflict";
      currentGraphRevision: InboxV2EntityRevision | null;
    }>
  | Readonly<{
      kind: "root_conflict";
      sourceNode: InboxV2ClientMergeNodeState;
      targetNode: InboxV2ClientMergeNodeState;
    }>
  | Readonly<{
      kind: "depth_limit_conflict";
      sourceMaximumInboundDepth: number;
      targetMaximumInboundDepth: number;
    }>
  | Readonly<{
      kind: "tenant_not_found" | "client_not_found" | "redirect_id_conflict";
    }>;

export type InboxV2ClientMergeTransactionExecutor = RawSqlExecutor & {
  transaction<TResult>(
    work: (transaction: RawSqlExecutor) => Promise<TResult>,
    config: Readonly<{ isolationLevel: "read committed" }>
  ): Promise<TResult>;
};

export type InboxV2ClientMergeRepository = Readonly<{
  ensureTenantHead(
    input: EnsureInboxV2ClientMergeTenantHeadInput
  ): Promise<EnsureInboxV2ClientMergeTenantHeadResult>;
  ensureClientNode(
    input: EnsureInboxV2ClientMergeNodeInput
  ): Promise<EnsureInboxV2ClientMergeNodeResult>;
  resolveCanonical(
    input: ResolveInboxV2CanonicalClientInput
  ): Promise<ResolveInboxV2CanonicalClientResult>;
  mergeRoots(
    input: MergeInboxV2ClientRootsInput
  ): Promise<MergeInboxV2ClientRootsResult>;
}>;

type HeadRow = {
  tenant_id: unknown;
  revision: unknown;
  updated_at: unknown;
  latest_redirect_id: unknown;
};

type NodeRow = {
  tenant_id: unknown;
  client_id: unknown;
  state: unknown;
  next_client_id: unknown;
  redirect_id: unknown;
  maximum_inbound_depth: unknown;
  revision: unknown;
  last_graph_revision: unknown;
  updated_at: unknown;
};

type ResolutionRow = {
  tenant_id: unknown;
  revision: unknown;
  updated_at: unknown;
  latest_redirect_id: unknown;
  client_exists: unknown;
  node_tenant_id: unknown;
  client_id: unknown;
  state: unknown;
  next_client_id: unknown;
  redirect_id: unknown;
  maximum_inbound_depth: unknown;
  node_revision: unknown;
  last_graph_revision: unknown;
  node_updated_at: unknown;
  traversal_depth: unknown;
  cycle_detected: unknown;
};

type ExistsRow = { exists: unknown };
type ReturnedIdRow = { id: unknown };

type StoredHead = Readonly<{
  graphHead: InboxV2ClientMergeGraphHead | null;
  latestRedirectId: InboxV2ClientMergeRedirectId | null;
}>;

export function createSqlInboxV2ClientMergeRepository(
  executor: InboxV2ClientMergeTransactionExecutor | HuleeDatabase
): InboxV2ClientMergeRepository {
  const transactionExecutor =
    executor as unknown as InboxV2ClientMergeTransactionExecutor;
  const rawExecutor = executor as unknown as RawSqlExecutor;

  return {
    async ensureTenantHead(input) {
      const normalized = normalizeEnsureTenantHeadInput(input);
      const inserted = await rawExecutor.execute<ReturnedIdRow>(
        buildEnsureTenantHeadSql(normalized.tenantId)
      );
      assertAtMostOneRow(inserted, "Client merge tenant-head ensure");

      if (inserted.rows.length === 0) {
        const exists = await tenantExists(rawExecutor, normalized.tenantId);
        if (!exists) return { kind: "tenant_not_found" };
      }

      const head = await loadHead(rawExecutor, normalized.tenantId, false);
      if (head === null) {
        throw invariantError(
          "Client merge tenant-head ensure did not produce a readable row."
        );
      }
      return { kind: "ready", graphHead: head.graphHead };
    },

    async ensureClientNode(input) {
      const normalized = normalizeEnsureClientNodeInput(input);
      const inserted = await rawExecutor.execute<ReturnedIdRow>(
        buildEnsureClientNodeSql(normalized)
      );
      assertAtMostOneRow(inserted, "Client merge node ensure");

      if (inserted.rows.length === 0) {
        if (!(await tenantExists(rawExecutor, normalized.tenantId))) {
          return { kind: "tenant_not_found" };
        }
        if (!(await clientExists(rawExecutor, normalized))) {
          return { kind: "client_not_found" };
        }
      }

      const node = await loadNode(rawExecutor, normalized, false);
      if (node === null) {
        throw invariantError(
          "Client merge node ensure did not produce a readable row."
        );
      }
      return { kind: "ready", node };
    },

    async resolveCanonical(input) {
      const normalized = normalizeResolveCanonicalInput(input);
      const result = await rawExecutor.execute<ResolutionRow>(
        buildResolveCanonicalClientSql(normalized)
      );

      if (result.rows.length === 0) return { kind: "tenant_not_found" };
      return mapResolutionRows(normalized, result.rows);
    },

    async mergeRoots(input) {
      const normalized = normalizeMergeRootsInput(input);

      return runClientMergeTransaction(transactionExecutor, async (tx) => {
        const storedHead = await loadHead(tx, normalized.tenantId, true);
        if (storedHead === null) {
          if (await tenantExists(tx, normalized.tenantId)) {
            throw invariantError(
              "Existing tenant is missing its mandatory Client merge head."
            );
          }
          return { kind: "tenant_not_found" } as const;
        }

        const currentGraphRevision = storedHead.graphHead?.revision ?? null;
        if (normalized.expectedGraphRevision !== currentGraphRevision) {
          return {
            kind: "graph_revision_conflict",
            currentGraphRevision
          } as const;
        }

        const roots = await lockRoots(tx, normalized);
        if (roots === null) {
          const clientsExist = await bothClientsExist(tx, normalized);
          if (!clientsExist) return { kind: "client_not_found" } as const;
          throw invariantError(
            "Existing Client is missing its mandatory merge node."
          );
        }
        const { sourceNode, targetNode } = roots;

        if (
          sourceNode.state !== "canonical_root" ||
          targetNode.state !== "canonical_root"
        ) {
          return {
            kind: "root_conflict",
            sourceNode,
            targetNode
          } as const;
        }

        const resultingMaximumInboundDepth = Math.max(
          targetNode.maximumInboundDepth,
          sourceNode.maximumInboundDepth + 1
        );
        if (
          sourceNode.maximumInboundDepth >= 64 ||
          resultingMaximumInboundDepth > 64
        ) {
          return {
            kind: "depth_limit_conflict",
            sourceMaximumInboundDepth: sourceNode.maximumInboundDepth,
            targetMaximumInboundDepth: targetNode.maximumInboundDepth
          } as const;
        }

        const commit = deriveMergeCommit({
          input: normalized,
          graphHead: storedHead.graphHead,
          sourceNode,
          targetNode,
          resultingMaximumInboundDepth
        });
        const inserted = await tx.execute<ReturnedIdRow>(
          buildInsertClientMergeRedirectSql(commit)
        );
        assertAtMostOneRow(inserted, "Client merge redirect insert");
        if (inserted.rows.length === 0) {
          return { kind: "redirect_id_conflict" } as const;
        }

        await expectOneReturnedRow(
          tx,
          buildUpdateClientMergeNodeSql(
            commit.sourceNodeBefore,
            commit.sourceNodeAfter
          ),
          "Client merge source-node CAS"
        );
        await expectOneReturnedRow(
          tx,
          buildUpdateClientMergeNodeSql(
            commit.targetNodeBefore,
            commit.targetNodeAfter
          ),
          "Client merge target-node CAS"
        );
        await expectOneReturnedRow(
          tx,
          buildAdvanceClientMergeHeadSql(commit, storedHead.latestRedirectId),
          "Client merge graph-head CAS"
        );

        return {
          kind: "merged",
          commit: inboxV2ClientMergeCommitSchema.parse(commit)
        } as const;
      });
    }
  };
}

function normalizeEnsureTenantHeadInput(
  input: EnsureInboxV2ClientMergeTenantHeadInput
): EnsureInboxV2ClientMergeTenantHeadInput {
  assertStrictInput(input, ENSURE_TENANT_HEAD_KEYS, "ensureTenantHead");
  return {
    tenantId: inboxV2TenantIdSchema.parse(input.tenantId)
  };
}

function normalizeEnsureClientNodeInput(
  input: EnsureInboxV2ClientMergeNodeInput
): EnsureInboxV2ClientMergeNodeInput {
  assertStrictInput(input, ENSURE_CLIENT_NODE_KEYS, "ensureClientNode");
  return {
    tenantId: inboxV2TenantIdSchema.parse(input.tenantId),
    clientId: inboxV2ClientIdSchema.parse(input.clientId)
  };
}

function normalizeResolveCanonicalInput(
  input: ResolveInboxV2CanonicalClientInput
): ResolveInboxV2CanonicalClientInput {
  assertStrictInput(input, RESOLVE_CANONICAL_KEYS, "resolveCanonical");
  return {
    tenantId: inboxV2TenantIdSchema.parse(input.tenantId),
    clientId: inboxV2ClientIdSchema.parse(input.clientId),
    trustedServiceId: inboxV2ClientMergeTrustedServiceIdSchema.parse(
      input.trustedServiceId
    ),
    resolvedAt: inboxV2TimestampSchema.parse(input.resolvedAt)
  };
}

function normalizeMergeRootsInput(
  input: MergeInboxV2ClientRootsInput
): MergeInboxV2ClientRootsInput {
  assertStrictInput(input, MERGE_ROOTS_KEYS, "mergeRoots");
  const normalized = {
    tenantId: inboxV2TenantIdSchema.parse(input.tenantId),
    redirectId: inboxV2ClientMergeRedirectIdSchema.parse(input.redirectId),
    sourceRootClientId: inboxV2ClientIdSchema.parse(input.sourceRootClientId),
    targetRootClientId: inboxV2ClientIdSchema.parse(input.targetRootClientId),
    expectedGraphRevision:
      input.expectedGraphRevision === null
        ? null
        : inboxV2EntityRevisionSchema.parse(input.expectedGraphRevision),
    resolverTrustedServiceId: inboxV2ClientMergeTrustedServiceIdSchema.parse(
      input.resolverTrustedServiceId
    ),
    resolvedAt: inboxV2TimestampSchema.parse(input.resolvedAt),
    decision: inboxV2ClientMergeDecisionSchema.parse(input.decision),
    createdAt: inboxV2TimestampSchema.parse(input.createdAt)
  };

  if (normalized.sourceRootClientId === normalized.targetRootClientId) {
    throw new CoreError(
      "validation.failed",
      "mergeRoots source and target must be different Client roots."
    );
  }
  return normalized;
}

async function runClientMergeTransaction<TResult>(
  executor: InboxV2ClientMergeTransactionExecutor,
  work: (transaction: RawSqlExecutor) => Promise<TResult>
): Promise<TResult> {
  for (
    let attempt = 1;
    attempt <= CLIENT_MERGE_TRANSACTION_ATTEMPTS;
    attempt += 1
  ) {
    try {
      return await executor.transaction(work, CLIENT_MERGE_TRANSACTION_CONFIG);
    } catch (error) {
      if (
        attempt === CLIENT_MERGE_TRANSACTION_ATTEMPTS ||
        !isRetryableClientMergeTransactionError(error)
      ) {
        throw error;
      }
    }
  }

  throw invariantError("Client merge transaction retry exhausted.");
}

function isRetryableClientMergeTransactionError(error: unknown): boolean {
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

    const code = Reflect.get(current, "code");
    if (
      typeof code === "string" &&
      RETRYABLE_CLIENT_MERGE_SQLSTATES.has(code)
    ) {
      return true;
    }
    current = Reflect.get(current, "cause");
  }

  return false;
}

export function buildEnsureTenantHeadSql(tenantId: InboxV2TenantId): SQL {
  return sql`
    insert into public.inbox_v2_client_merge_graph_heads (
      tenant_id, revision, updated_at, latest_redirect_id
    )
    select tenant_row.id, null, null, null
    from public.tenants tenant_row
    where tenant_row.id = ${tenantId}
    on conflict (tenant_id) do nothing
    returning tenant_id as id
  `;
}

export function buildEnsureClientNodeSql(
  input: EnsureInboxV2ClientMergeNodeInput
): SQL {
  return sql`
    insert into public.inbox_v2_client_merge_node_states (
      tenant_id,
      client_id,
      state,
      next_client_id,
      redirect_id,
      maximum_inbound_depth,
      revision,
      last_graph_revision,
      updated_at
    )
    select
      client_row.tenant_id,
      client_row.id,
      'canonical_root',
      null,
      null,
      0,
      1,
      null,
      client_row.created_at
    from public.clients client_row
    where client_row.tenant_id = ${input.tenantId}
      and client_row.id = ${input.clientId}
    on conflict (tenant_id, client_id) do nothing
    returning client_id as id
  `;
}

export function buildResolveCanonicalClientSql(
  input: ResolveInboxV2CanonicalClientInput
): SQL {
  return sql`
    with recursive
    graph_head as (
      select
        head_row.tenant_id,
        head_row.revision,
        head_row.updated_at,
        head_row.latest_redirect_id
      from public.inbox_v2_client_merge_graph_heads head_row
      where head_row.tenant_id = ${input.tenantId}
    ),
    requested_client as (
      select exists (
        select 1
        from public.clients client_row
        where client_row.tenant_id = ${input.tenantId}
          and client_row.id = ${input.clientId}
      ) as client_exists
    ),
    resolution_path as (
      select
        node_row.tenant_id,
        node_row.client_id,
        node_row.state,
        node_row.next_client_id,
        node_row.redirect_id,
        node_row.maximum_inbound_depth,
        node_row.revision,
        node_row.last_graph_revision,
        node_row.updated_at,
        0 as traversal_depth,
        array[node_row.client_id]::text[] as visited_client_ids,
        false as cycle_detected
      from public.inbox_v2_client_merge_node_states node_row
      where node_row.tenant_id = ${input.tenantId}
        and node_row.client_id = ${input.clientId}

      union all

      select
        next_node.tenant_id,
        next_node.client_id,
        next_node.state,
        next_node.next_client_id,
        next_node.redirect_id,
        next_node.maximum_inbound_depth,
        next_node.revision,
        next_node.last_graph_revision,
        next_node.updated_at,
        path.traversal_depth + 1,
        path.visited_client_ids || next_node.client_id,
        next_node.client_id = any(path.visited_client_ids)
      from resolution_path path
      join public.inbox_v2_client_merge_node_states next_node
        on next_node.tenant_id = path.tenant_id
       and next_node.client_id = path.next_client_id
      where path.state = 'redirected'
        and path.traversal_depth < 64
        and not path.cycle_detected
    )
    select
      head.tenant_id,
      head.revision,
      head.updated_at,
      head.latest_redirect_id,
      requested.client_exists,
      path.tenant_id as node_tenant_id,
      path.client_id,
      path.state,
      path.next_client_id,
      path.redirect_id,
      path.maximum_inbound_depth,
      path.revision as node_revision,
      path.last_graph_revision,
      path.updated_at as node_updated_at,
      path.traversal_depth,
      path.cycle_detected
    from graph_head head
    cross join requested_client requested
    left join resolution_path path on true
    order by path.traversal_depth asc nulls last
  `;
}

function buildLoadHeadSql(tenantId: InboxV2TenantId, lock: boolean): SQL {
  return sql`
    select tenant_id, revision, updated_at, latest_redirect_id
    from public.inbox_v2_client_merge_graph_heads
    where tenant_id = ${tenantId}
    ${lock ? sql`for update` : sql``}
  `;
}

function buildLoadNodeSql(
  input: EnsureInboxV2ClientMergeNodeInput,
  lock: boolean
): SQL {
  return sql`
    select
      tenant_id,
      client_id,
      state,
      next_client_id,
      redirect_id,
      maximum_inbound_depth,
      revision,
      last_graph_revision,
      updated_at
    from public.inbox_v2_client_merge_node_states
    where tenant_id = ${input.tenantId}
      and client_id = ${input.clientId}
    ${lock ? sql`for update` : sql``}
  `;
}

export function buildLockClientMergeRootsSql(
  input: Pick<
    MergeInboxV2ClientRootsInput,
    "tenantId" | "sourceRootClientId" | "targetRootClientId"
  >
): SQL {
  return sql`
    select
      tenant_id,
      client_id,
      state,
      next_client_id,
      redirect_id,
      maximum_inbound_depth,
      revision,
      last_graph_revision,
      updated_at
    from public.inbox_v2_client_merge_node_states
    where tenant_id = ${input.tenantId}
      and client_id in (
        ${input.sourceRootClientId},
        ${input.targetRootClientId}
      )
    order by client_id collate "C"
    for update
  `;
}

function buildTenantExistsSql(tenantId: InboxV2TenantId): SQL {
  return sql`
    select exists (
      select 1 from public.tenants where id = ${tenantId}
    ) as exists
  `;
}

function buildClientExistsSql(input: EnsureInboxV2ClientMergeNodeInput): SQL {
  return sql`
    select exists (
      select 1
      from public.clients
      where tenant_id = ${input.tenantId}
        and id = ${input.clientId}
    ) as exists
  `;
}

function buildBothClientsExistSql(
  input: Pick<
    MergeInboxV2ClientRootsInput,
    "tenantId" | "sourceRootClientId" | "targetRootClientId"
  >
): SQL {
  return sql`
    select count(*) = 2 as exists
    from public.clients
    where tenant_id = ${input.tenantId}
      and id in (${input.sourceRootClientId}, ${input.targetRootClientId})
  `;
}

export function buildInsertClientMergeRedirectSql(
  commit: InboxV2ClientMergeCommit
): SQL {
  const { redirect, sourceNodeBefore, targetNodeBefore } = commit;
  const actor = redirect.decision.actor;
  const actorEmployeeId = actor.kind === "employee" ? actor.employee.id : null;
  const actorTrustedServiceId =
    actor.kind === "employee" ? null : actor.trustedServiceId;

  return sql`
    insert into public.inbox_v2_client_merge_redirects (
      tenant_id,
      id,
      source_root_client_id,
      target_root_client_id,
      expected_graph_revision,
      current_graph_revision,
      resulting_graph_revision,
      head_before_updated_at,
      head_after_updated_at,
      resolver_trusted_service_id,
      resolved_at,
      decision_actor_kind,
      decision_actor_employee_id,
      decision_actor_trusted_service_id,
      decision_policy_id,
      decision_policy_version,
      decision_reason_code_id,
      source_before_state,
      source_before_next_client_id,
      source_before_redirect_id,
      source_before_maximum_inbound_depth,
      source_before_revision,
      source_before_last_graph_revision,
      source_before_updated_at,
      target_before_state,
      target_before_next_client_id,
      target_before_redirect_id,
      target_before_maximum_inbound_depth,
      target_before_revision,
      target_before_last_graph_revision,
      target_before_updated_at,
      source_after_state,
      source_after_next_client_id,
      source_after_redirect_id,
      source_after_maximum_inbound_depth,
      source_after_revision,
      source_after_last_graph_revision,
      source_after_updated_at,
      target_after_state,
      target_after_next_client_id,
      target_after_redirect_id,
      target_after_maximum_inbound_depth,
      target_after_revision,
      target_after_last_graph_revision,
      target_after_updated_at,
      created_at,
      revision
    ) values (
      ${commit.tenantId},
      ${redirect.id},
      ${redirect.sourceRoot.id},
      ${redirect.targetRoot.id},
      ${redirect.expectedGraphRevision},
      ${redirect.currentGraphRevision},
      ${redirect.resultingGraphRevision},
      ${commit.graphHeadBefore?.updatedAt ?? null},
      ${commit.graphHeadAfter.updatedAt},
      ${redirect.sourceRootVerification.resolutionStamp.trustedServiceId},
      ${redirect.sourceRootVerification.resolutionStamp.resolvedAt},
      ${actor.kind},
      ${actorEmployeeId},
      ${actorTrustedServiceId},
      ${redirect.decision.policyId},
      ${redirect.decision.policyVersion},
      ${redirect.decision.reasonCodeId},
      ${sourceNodeBefore.state},
      ${sourceNodeBefore.nextClient},
      ${sourceNodeBefore.redirect},
      ${sourceNodeBefore.maximumInboundDepth},
      ${sourceNodeBefore.revision},
      ${sourceNodeBefore.lastGraphRevision},
      ${sourceNodeBefore.updatedAt},
      ${targetNodeBefore.state},
      ${targetNodeBefore.nextClient},
      ${targetNodeBefore.redirect},
      ${targetNodeBefore.maximumInboundDepth},
      ${targetNodeBefore.revision},
      ${targetNodeBefore.lastGraphRevision},
      ${targetNodeBefore.updatedAt},
      ${commit.sourceNodeAfter.state},
      ${commit.sourceNodeAfter.nextClient.id},
      ${commit.sourceNodeAfter.redirect.id},
      ${commit.sourceNodeAfter.maximumInboundDepth},
      ${commit.sourceNodeAfter.revision},
      ${commit.sourceNodeAfter.lastGraphRevision},
      ${commit.sourceNodeAfter.updatedAt},
      ${commit.targetNodeAfter.state},
      ${commit.targetNodeAfter.nextClient},
      ${commit.targetNodeAfter.redirect},
      ${commit.targetNodeAfter.maximumInboundDepth},
      ${commit.targetNodeAfter.revision},
      ${commit.targetNodeAfter.lastGraphRevision},
      ${commit.targetNodeAfter.updatedAt},
      ${redirect.createdAt},
      ${redirect.revision}
    )
    on conflict (tenant_id, id) do nothing
    returning id
  `;
}

export function buildUpdateClientMergeNodeSql(
  before: InboxV2ClientMergeNodeState,
  after: InboxV2ClientMergeNodeState
): SQL {
  return sql`
    update public.inbox_v2_client_merge_node_states
    set
      state = ${after.state},
      next_client_id = ${after.nextClient?.id ?? null},
      redirect_id = ${after.redirect?.id ?? null},
      maximum_inbound_depth = ${after.maximumInboundDepth},
      revision = ${after.revision},
      last_graph_revision = ${after.lastGraphRevision},
      updated_at = ${after.updatedAt}
    where tenant_id = ${before.tenantId}
      and client_id = ${before.client.id}
      and state = ${before.state}
      and next_client_id is not distinct from ${before.nextClient?.id ?? null}
      and redirect_id is not distinct from ${before.redirect?.id ?? null}
      and maximum_inbound_depth = ${before.maximumInboundDepth}
      and revision = ${before.revision}
      and last_graph_revision is not distinct from ${before.lastGraphRevision}
      and updated_at = ${before.updatedAt}
    returning client_id as id
  `;
}

export function buildAdvanceClientMergeHeadSql(
  commit: InboxV2ClientMergeCommit,
  latestRedirectIdBefore: InboxV2ClientMergeRedirectId | null
): SQL {
  return sql`
    update public.inbox_v2_client_merge_graph_heads
    set
      revision = ${commit.graphHeadAfter.revision},
      updated_at = ${commit.graphHeadAfter.updatedAt},
      latest_redirect_id = ${commit.redirect.id}
    where tenant_id = ${commit.tenantId}
      and revision is not distinct from ${commit.graphHeadBefore?.revision ?? null}
      and updated_at is not distinct from ${commit.graphHeadBefore?.updatedAt ?? null}
      and latest_redirect_id is not distinct from ${latestRedirectIdBefore}
    returning tenant_id as id
  `;
}

function deriveMergeCommit(input: {
  input: MergeInboxV2ClientRootsInput;
  graphHead: InboxV2ClientMergeGraphHead | null;
  sourceNode: InboxV2ClientMergeNodeState & { state: "canonical_root" };
  targetNode: InboxV2ClientMergeNodeState & { state: "canonical_root" };
  resultingMaximumInboundDepth: number;
}): InboxV2ClientMergeCommit {
  const normalized = input.input;
  const resolutionStamp = {
    kind: "trusted_service" as const,
    trustedServiceId: normalized.resolverTrustedServiceId,
    resolvedAt: normalized.resolvedAt
  };
  const sourceReference = {
    tenantId: normalized.tenantId,
    kind: "client" as const,
    id: normalized.sourceRootClientId
  };
  const targetReference = {
    tenantId: normalized.tenantId,
    kind: "client" as const,
    id: normalized.targetRootClientId
  };
  const sourceRootVerification = inboxV2ClientMergeResolutionPathSchema.parse({
    tenantId: normalized.tenantId,
    graphHead: input.graphHead,
    requestedClient: sourceReference,
    nodes: [input.sourceNode],
    canonicalClient: sourceReference,
    resolutionStamp
  });
  const targetRootVerification = inboxV2ClientMergeResolutionPathSchema.parse({
    tenantId: normalized.tenantId,
    graphHead: input.graphHead,
    requestedClient: targetReference,
    nodes: [input.targetNode],
    canonicalClient: targetReference,
    resolutionStamp
  });
  const resultingGraphRevision = incrementGraphRevision(
    input.graphHead?.revision ?? null
  );
  const redirect = inboxV2ClientMergeRedirectSchema.parse({
    tenantId: normalized.tenantId,
    id: normalized.redirectId,
    sourceRoot: sourceReference,
    targetRoot: targetReference,
    sourceRootVerification,
    targetRootVerification,
    sourceMaximumInboundDepth: input.sourceNode.maximumInboundDepth,
    targetMaximumInboundDepth: input.targetNode.maximumInboundDepth,
    resultingMaximumInboundDepth: input.resultingMaximumInboundDepth,
    decision: normalized.decision,
    expectedGraphRevision: normalized.expectedGraphRevision,
    currentGraphRevision: input.graphHead?.revision ?? null,
    resultingGraphRevision,
    createdAt: normalized.createdAt,
    revision: "1"
  });

  return inboxV2ClientMergeCommitSchema.parse(
    deriveInboxV2ClientMergeCommit({ redirect })
  );
}

function incrementGraphRevision(
  revision: InboxV2EntityRevision | null
): InboxV2EntityRevision {
  return inboxV2EntityRevisionSchema.parse(
    revision === null ? "1" : (BigInt(revision) + 1n).toString()
  );
}

async function loadHead(
  executor: RawSqlExecutor,
  tenantId: InboxV2TenantId,
  lock: boolean
): Promise<StoredHead | null> {
  const result = await executor.execute<HeadRow>(
    buildLoadHeadSql(tenantId, lock)
  );
  assertAtMostOneRow(result, "Client merge graph-head load");
  const row = result.rows[0];
  return row === undefined ? null : mapHeadRow(row, tenantId);
}

async function loadNode(
  executor: RawSqlExecutor,
  input: EnsureInboxV2ClientMergeNodeInput,
  lock: boolean
): Promise<InboxV2ClientMergeNodeState | null> {
  const result = await executor.execute<NodeRow>(buildLoadNodeSql(input, lock));
  assertAtMostOneRow(result, "Client merge node load");
  const row = result.rows[0];
  return row === undefined ? null : mapNodeRow(row, input.tenantId);
}

async function lockRoots(
  executor: RawSqlExecutor,
  input: MergeInboxV2ClientRootsInput
): Promise<{
  sourceNode: InboxV2ClientMergeNodeState;
  targetNode: InboxV2ClientMergeNodeState;
} | null> {
  const result = await executor.execute<NodeRow>(
    buildLockClientMergeRootsSql(input)
  );
  if (result.rows.length > 2) {
    throw invariantError("Client merge root lock returned more than two rows.");
  }
  const mapped = result.rows.map((row) => mapNodeRow(row, input.tenantId));
  const sourceNode = mapped.find(
    (node) => node.client.id === input.sourceRootClientId
  );
  const targetNode = mapped.find(
    (node) => node.client.id === input.targetRootClientId
  );
  if (!sourceNode || !targetNode) return null;
  return { sourceNode, targetNode };
}

async function tenantExists(
  executor: RawSqlExecutor,
  tenantId: InboxV2TenantId
): Promise<boolean> {
  return readExistsResult(
    await executor.execute<ExistsRow>(buildTenantExistsSql(tenantId)),
    "Tenant existence lookup"
  );
}

async function clientExists(
  executor: RawSqlExecutor,
  input: EnsureInboxV2ClientMergeNodeInput
): Promise<boolean> {
  return readExistsResult(
    await executor.execute<ExistsRow>(buildClientExistsSql(input)),
    "Client existence lookup"
  );
}

async function bothClientsExist(
  executor: RawSqlExecutor,
  input: MergeInboxV2ClientRootsInput
): Promise<boolean> {
  return readExistsResult(
    await executor.execute<ExistsRow>(buildBothClientsExistSql(input)),
    "Client merge roots existence lookup"
  );
}

function mapResolutionRows(
  input: ResolveInboxV2CanonicalClientInput,
  rows: readonly ResolutionRow[]
): ResolveInboxV2CanonicalClientResult {
  const first = rows[0];
  if (first === undefined) return { kind: "tenant_not_found" };

  const storedHead = mapHeadRow(
    {
      tenant_id: first.tenant_id,
      revision: first.revision,
      updated_at: first.updated_at,
      latest_redirect_id: first.latest_redirect_id
    },
    input.tenantId
  );
  const head = storedHead.graphHead;
  const clientIsPresent = parseDatabaseBoolean(
    first.client_exists,
    "Client merge resolution client_exists"
  );

  if (first.client_id === null || first.client_id === undefined) {
    if (rows.length !== 1) {
      throw invariantError(
        "Client merge resolution returned multiple empty path rows."
      );
    }
    if (clientIsPresent) {
      throw invariantError(
        "Existing Client is missing its mandatory merge node."
      );
    }
    return { kind: "client_not_found" };
  }
  if (!clientIsPresent) {
    throw invariantError(
      "Client merge resolution found a node without its owning Client."
    );
  }

  const nodes: InboxV2ClientMergeNodeState[] = [];
  for (const [index, row] of rows.entries()) {
    const rowHead = mapHeadRow(
      {
        tenant_id: row.tenant_id,
        revision: row.revision,
        updated_at: row.updated_at,
        latest_redirect_id: row.latest_redirect_id
      },
      input.tenantId
    );
    if (
      !sameStoredHead(rowHead, storedHead) ||
      parseDatabaseBoolean(
        row.client_exists,
        "Client merge resolution client_exists"
      ) !== clientIsPresent
    ) {
      throw invariantError(
        "Client merge resolution rows disagree on the graph-head snapshot."
      );
    }
    const traversalDepth = parseDatabaseInteger(
      row.traversal_depth,
      "Client merge resolution traversal_depth"
    );
    if (traversalDepth !== index) {
      throw invariantError(
        "Client merge resolution path has a non-contiguous traversal depth."
      );
    }
    if (
      parseDatabaseBoolean(
        row.cycle_detected,
        "Client merge resolution cycle_detected"
      )
    ) {
      throw invariantError(
        "Client merge resolution detected a redirect cycle."
      );
    }
    nodes.push(
      mapNodeRow(
        {
          tenant_id: row.node_tenant_id,
          client_id: row.client_id,
          state: row.state,
          next_client_id: row.next_client_id,
          redirect_id: row.redirect_id,
          maximum_inbound_depth: row.maximum_inbound_depth,
          revision: row.node_revision,
          last_graph_revision: row.last_graph_revision,
          updated_at: row.node_updated_at
        },
        input.tenantId
      )
    );
  }

  const requested = nodes[0];
  const canonical = nodes.at(-1);
  if (!requested || requested.client.id !== input.clientId) {
    throw invariantError(
      "Client merge resolution path does not start at the requested Client."
    );
  }
  if (!canonical || canonical.state !== "canonical_root") {
    throw invariantError(
      "Client merge resolution exceeded its bound or ended without a root."
    );
  }

  const resolution = inboxV2ClientMergeResolutionPathSchema.parse({
    tenantId: input.tenantId,
    graphHead: head,
    requestedClient: requested.client,
    nodes,
    canonicalClient: canonical.client,
    resolutionStamp: {
      kind: "trusted_service",
      trustedServiceId: input.trustedServiceId,
      resolvedAt: input.resolvedAt
    }
  });
  return { kind: "resolved", resolution };
}

function mapHeadRow(row: HeadRow, tenantId: InboxV2TenantId): StoredHead {
  const storedTenantId = inboxV2TenantIdSchema.parse(String(row.tenant_id));
  if (storedTenantId !== tenantId) {
    throw invariantError(
      "Client merge graph-head crossed its tenant boundary."
    );
  }

  const empty =
    row.revision === null &&
    row.updated_at === null &&
    row.latest_redirect_id === null;
  if (empty) return { graphHead: null, latestRedirectId: null };
  if (
    row.revision === null ||
    row.revision === undefined ||
    row.updated_at === null ||
    row.updated_at === undefined ||
    row.latest_redirect_id === null ||
    row.latest_redirect_id === undefined
  ) {
    throw invariantError(
      "Client merge graph-head has a partial nullable state."
    );
  }

  const graphHead = inboxV2ClientMergeGraphHeadSchema.parse({
    tenantId,
    revision: parseDatabaseEntityRevision(
      row.revision,
      "Client merge graph-head revision"
    ),
    updatedAt: parseDatabaseTimestamp(
      row.updated_at,
      "Client merge graph-head updated_at"
    )
  });
  const latestRedirectId = inboxV2ClientMergeRedirectIdSchema.parse(
    String(row.latest_redirect_id)
  );
  return { graphHead, latestRedirectId };
}

function mapNodeRow(
  row: NodeRow,
  tenantId: InboxV2TenantId
): InboxV2ClientMergeNodeState {
  const storedTenantId = inboxV2TenantIdSchema.parse(String(row.tenant_id));
  if (storedTenantId !== tenantId) {
    throw invariantError("Client merge node crossed its tenant boundary.");
  }
  const clientId = inboxV2ClientIdSchema.parse(String(row.client_id));
  const common = {
    tenantId,
    client: { tenantId, kind: "client" as const, id: clientId },
    maximumInboundDepth: parseDatabaseInteger(
      row.maximum_inbound_depth,
      "Client merge node maximum_inbound_depth"
    ),
    revision: parseDatabaseEntityRevision(
      row.revision,
      "Client merge node revision"
    ),
    lastGraphRevision:
      row.last_graph_revision === null
        ? null
        : parseDatabaseEntityRevision(
            row.last_graph_revision,
            "Client merge node last_graph_revision"
          ),
    updatedAt: parseDatabaseTimestamp(
      row.updated_at,
      "Client merge node updated_at"
    )
  };

  if (row.state === "canonical_root") {
    if (row.next_client_id !== null || row.redirect_id !== null) {
      throw invariantError(
        "Canonical Client merge node contains redirect-only columns."
      );
    }
    return inboxV2ClientMergeNodeStateSchema.parse({
      ...common,
      state: "canonical_root",
      nextClient: null,
      redirect: null
    });
  }
  if (row.state === "redirected") {
    if (
      row.next_client_id === null ||
      row.next_client_id === undefined ||
      row.redirect_id === null ||
      row.redirect_id === undefined
    ) {
      throw invariantError(
        "Redirected Client merge node is missing its exact edge columns."
      );
    }
    const nextClientId = inboxV2ClientIdSchema.parse(
      String(row.next_client_id)
    );
    const redirectId = inboxV2ClientMergeRedirectIdSchema.parse(
      String(row.redirect_id)
    );
    return inboxV2ClientMergeNodeStateSchema.parse({
      ...common,
      state: "redirected",
      nextClient: {
        tenantId,
        kind: "client",
        id: nextClientId
      },
      redirect: {
        tenantId,
        kind: "client_merge_redirect",
        id: redirectId
      }
    });
  }
  throw invariantError(
    `Unknown Client merge node state: ${String(row.state)}.`
  );
}

function sameStoredHead(left: StoredHead, right: StoredHead): boolean {
  return (
    left.latestRedirectId === right.latestRedirectId &&
    left.graphHead?.tenantId === right.graphHead?.tenantId &&
    left.graphHead?.revision === right.graphHead?.revision &&
    left.graphHead?.updatedAt === right.graphHead?.updatedAt
  );
}

function parseDatabaseEntityRevision(
  value: unknown,
  label: string
): InboxV2EntityRevision {
  if (typeof value === "number") {
    throw invariantError(`${label} was decoded as a lossy JavaScript number.`);
  }
  return inboxV2EntityRevisionSchema.parse(String(value));
}

function parseDatabaseTimestamp(value: unknown, label: string): string {
  const date =
    value instanceof Date
      ? value
      : typeof value === "string"
        ? new Date(value)
        : null;
  if (date === null || Number.isNaN(date.getTime())) {
    throw invariantError(`${label} is not a PostgreSQL timestamp.`);
  }
  return inboxV2TimestampSchema.parse(date.toISOString());
}

function parseDatabaseInteger(value: unknown, label: string): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;
  if (!Number.isSafeInteger(parsed)) {
    throw invariantError(`${label} is not a safe integer.`);
  }
  return parsed;
}

function parseDatabaseBoolean(value: unknown, label: string): boolean {
  if (value === true || value === "t") return true;
  if (value === false || value === "f") return false;
  throw invariantError(`${label} is not a PostgreSQL boolean.`);
}

function readExistsResult(
  result: RawSqlQueryResult<ExistsRow>,
  label: string
): boolean {
  if (result.rows.length !== 1) {
    throw invariantError(`${label} did not return exactly one row.`);
  }
  return parseDatabaseBoolean(result.rows[0]?.exists, `${label} exists`);
}

async function expectOneReturnedRow(
  executor: RawSqlExecutor,
  query: SQL,
  label: string
): Promise<void> {
  const result = await executor.execute<ReturnedIdRow>(query);
  if (result.rows.length !== 1) {
    throw invariantError(`${label} did not affect exactly one row.`);
  }
}

function assertAtMostOneRow(
  result: RawSqlQueryResult<Record<string, unknown>>,
  label: string
): void {
  if (result.rows.length > 1) {
    throw invariantError(`${label} returned more than one row.`);
  }
}

function assertStrictInput(
  input: unknown,
  allowedKeys: ReadonlySet<string>,
  label: string
): void {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new CoreError(
      "validation.failed",
      `${label} input must be an object.`
    );
  }
  const unexpected = Object.keys(input).filter((key) => !allowedKeys.has(key));
  if (unexpected.length > 0) {
    throw new CoreError(
      "validation.failed",
      `${label} input contains unsupported fields: ${unexpected.join(", ")}.`
    );
  }
}

function invariantError(message: string): InboxV2PersistenceInvariantError {
  return new InboxV2PersistenceInvariantError(message);
}

export type { RawSqlExecutor, RawSqlQueryResult };
