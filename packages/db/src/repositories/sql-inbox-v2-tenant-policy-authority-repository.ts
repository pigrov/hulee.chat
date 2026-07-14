import {
  inboxV2ActivateTenantPolicyVersionCommandSchema,
  inboxV2ApproveTenantPolicyVersionCommandSchema,
  inboxV2ExactActiveTenantPolicyAuthorityInputSchema,
  inboxV2RevokeTenantPolicyVersionCommandSchema,
  inboxV2TenantPolicyActivationHeadSchema,
  inboxV2TenantPolicyActivationTransitionSchema,
  inboxV2TenantPolicyVersionAuthoritySchema,
  type InboxV2ActivateTenantPolicyVersionCommand,
  type InboxV2ApproveTenantPolicyVersionCommand,
  type InboxV2EntityRevision,
  type InboxV2ExactActiveTenantPolicyAuthority,
  type InboxV2ExactActiveTenantPolicyAuthorityInput,
  type InboxV2RevokeTenantPolicyVersionCommand,
  type InboxV2TenantPolicyActivationHead,
  type InboxV2TenantPolicyActivationTransition,
  type InboxV2TenantPolicyVersionAuthority
} from "@hulee/contracts";
import { sql, type SQL } from "drizzle-orm";

import type { HuleeDatabase } from "../client";
import { InboxV2PersistenceInvariantError } from "./sql-inbox-v2-conversation-repository";
import type {
  RawSqlExecutor,
  RawSqlQueryResult
} from "./sql-outbox-repository";

const POLICY_AUTHORITY_TRANSACTION_CONFIG = {
  isolationLevel: "read committed"
} as const;
const POLICY_AUTHORITY_TRANSACTION_ATTEMPTS = 3;
const RETRYABLE_POLICY_AUTHORITY_SQLSTATES = new Set(["40001", "40P01"]);

export type ApproveInboxV2TenantPolicyVersionResult =
  | Readonly<{
      kind: "approved" | "already_approved";
      authority: InboxV2TenantPolicyVersionAuthority;
    }>
  | Readonly<{
      kind: "policy_version_conflict";
      currentAuthority: InboxV2TenantPolicyVersionAuthority;
    }>
  | InboxV2TenantPolicyEmployeeConflict;

export type ActivateInboxV2TenantPolicyVersionResult =
  | Readonly<{
      kind: "activated";
      authority: InboxV2TenantPolicyVersionAuthority;
      activation: InboxV2TenantPolicyActivationHead & { state: "active" };
      transition: InboxV2TenantPolicyActivationTransition;
    }>
  | Readonly<{ kind: "policy_version_not_found" }>
  | InboxV2TenantPolicyHeadRevisionConflict
  | Readonly<{
      kind: "head_state_conflict";
      currentHead: InboxV2TenantPolicyActivationHead;
    }>
  | Readonly<{
      kind: "activation_time_conflict";
      minimumAt: string;
    }>
  | InboxV2TenantPolicyEmployeeConflict;

export type RevokeInboxV2TenantPolicyVersionResult =
  | Readonly<{
      kind: "revoked";
      authority: InboxV2TenantPolicyVersionAuthority;
      activation: InboxV2TenantPolicyActivationHead & { state: "revoked" };
      transition: InboxV2TenantPolicyActivationTransition;
    }>
  | Readonly<{ kind: "policy_not_found" }>
  | InboxV2TenantPolicyHeadRevisionConflict
  | Readonly<{
      kind: "head_state_conflict";
      currentHead: InboxV2TenantPolicyActivationHead;
    }>
  | Readonly<{
      kind: "policy_version_conflict";
      currentPolicyVersion: string;
    }>
  | Readonly<{
      kind: "revocation_time_conflict";
      minimumAt: string;
    }>
  | InboxV2TenantPolicyEmployeeConflict;

export type LockExactActiveInboxV2TenantPolicyAuthorityResult =
  | Readonly<{
      kind: "locked";
      authority: InboxV2ExactActiveTenantPolicyAuthority;
      headRevision: InboxV2EntityRevision;
    }>
  | Readonly<{ kind: "policy_not_found" }>
  | Readonly<{
      kind: "policy_inactive";
      currentHeadRevision: InboxV2EntityRevision;
    }>
  | InboxV2TenantPolicyHeadRevisionConflict
  | Readonly<{
      kind: "policy_version_conflict";
      currentPolicyVersion: string;
      currentHeadRevision: InboxV2EntityRevision;
    }>
  | Readonly<{
      kind: "definition_contract_version_conflict";
      currentDefinitionContractVersion: string;
      currentHeadRevision: InboxV2EntityRevision;
    }>
  | Readonly<{
      kind: "definition_digest_conflict";
      currentDefinitionDigestSha256: string;
      currentHeadRevision: InboxV2EntityRevision;
    }>
  | Readonly<{
      kind: "trusted_service_conflict";
      currentApprovedTrustedServiceId: string;
      currentHeadRevision: InboxV2EntityRevision;
    }>
  | Readonly<{
      kind: "authority_time_conflict";
      approvedAt: string;
      activatedAt: string;
    }>
  | Readonly<{
      kind: "occurred_before_activation";
      activatedAt: string;
      currentHeadRevision: InboxV2EntityRevision;
    }>;

type InboxV2TenantPolicyHeadRevisionConflict = Readonly<{
  kind: "head_revision_conflict";
  currentHeadRevision: InboxV2EntityRevision | null;
}>;

type InboxV2TenantPolicyEmployeeConflict = Readonly<{
  kind: "employee_not_found" | "employee_inactive";
  employeeId: string;
}>;

export type InboxV2TenantPolicyAuthorityTransactionExecutor = RawSqlExecutor & {
  transaction<TResult>(
    work: (
      transaction: InboxV2TenantPolicyAuthorityUseTransaction
    ) => Promise<TResult>,
    config: Readonly<{ isolationLevel: "read committed" }>
  ): Promise<TResult>;
};

declare const inboxV2TenantPolicyAuthorityUseTransactionBrand: unique symbol;

/**
 * Nominal transaction-scoped executor for authority consumption. There is no
 * public adapter from RawSqlExecutor: the brand is supplied only by repository
 * transaction callback boundaries, so an auto-commit caller cannot compile.
 */
export type InboxV2TenantPolicyAuthorityUseTransaction = RawSqlExecutor & {
  readonly [inboxV2TenantPolicyAuthorityUseTransactionBrand]: true;
};

export type InboxV2TenantPolicyAuthorityRepository = Readonly<{
  approveVersion(
    input: InboxV2ApproveTenantPolicyVersionCommand
  ): Promise<ApproveInboxV2TenantPolicyVersionResult>;
  activateVersion(
    input: InboxV2ActivateTenantPolicyVersionCommand
  ): Promise<ActivateInboxV2TenantPolicyVersionResult>;
  revokeVersion(
    input: InboxV2RevokeTenantPolicyVersionCommand
  ): Promise<RevokeInboxV2TenantPolicyVersionResult>;
}>;

type EmployeeLockRow = {
  id: unknown;
  created_at: unknown;
  deactivated_at: unknown;
};

type PolicyVersionRow = {
  tenant_id: unknown;
  family: unknown;
  policy_id: unknown;
  policy_version: unknown;
  definition_contract_version: unknown;
  definition_digest_sha256: unknown;
  approved_trusted_service_id: unknown;
  approved_by_employee_id: unknown;
  approved_at: unknown;
  revision: unknown;
  created_at: unknown;
  updated_at: unknown;
};

type PolicyActivationHeadRow = {
  tenant_id: unknown;
  family: unknown;
  policy_id: unknown;
  policy_version: unknown;
  definition_contract_version: unknown;
  definition_digest_sha256: unknown;
  approved_trusted_service_id: unknown;
  state: unknown;
  activated_by_employee_id: unknown;
  activated_at: unknown;
  revoked_by_employee_id: unknown;
  revoked_at: unknown;
  revision: unknown;
  created_at: unknown;
  updated_at: unknown;
};

type ExactPolicyAuthorityRow = PolicyActivationHeadRow & {
  version_approved_by_employee_id: unknown;
  version_approved_at: unknown;
  version_revision: unknown;
  version_created_at: unknown;
  version_updated_at: unknown;
};

export function createSqlInboxV2TenantPolicyAuthorityRepository(
  executor: InboxV2TenantPolicyAuthorityTransactionExecutor | HuleeDatabase
): InboxV2TenantPolicyAuthorityRepository {
  const transactionExecutor =
    executor as unknown as InboxV2TenantPolicyAuthorityTransactionExecutor;

  return {
    async approveVersion(input) {
      const command =
        inboxV2ApproveTenantPolicyVersionCommandSchema.parse(input);

      return runPolicyAuthorityTransaction(
        transactionExecutor,
        async (transaction) => {
          const employeeConflict = await lockActiveEmployee(transaction, {
            tenantId: command.tenantId,
            employeeId: command.approvedBy.id,
            occurredAt: command.approvedAt
          });
          if (employeeConflict !== null) return employeeConflict;

          const inserted = await transaction.execute<PolicyVersionRow>(
            buildInsertInboxV2TenantPolicyVersionSql(command)
          );
          requireAtMostOneRow(inserted, "Tenant policy version insert");

          const authority = await loadPolicyVersion(transaction, command);
          if (authority === null) {
            throw invariantError(
              "Tenant policy version insert conflict has no readable winner."
            );
          }
          if (!samePolicyApproval(authority, command)) {
            return {
              kind: "policy_version_conflict",
              currentAuthority: authority
            } as const;
          }
          return {
            kind: inserted.rows.length === 1 ? "approved" : "already_approved",
            authority
          } as const;
        }
      );
    },

    async activateVersion(input) {
      const command =
        inboxV2ActivateTenantPolicyVersionCommandSchema.parse(input);

      try {
        return await runPolicyAuthorityTransaction(
          transactionExecutor,
          async (transaction) => activatePolicyVersion(transaction, command)
        );
      } catch (error) {
        if (sqlState(error) !== "23505") throw error;
        const concurrentHead = await loadPolicyHead(
          transactionExecutor,
          command
        );
        if (concurrentHead === null) throw error;
        return {
          kind: "head_revision_conflict",
          currentHeadRevision: concurrentHead.revision
        };
      }
    },

    async revokeVersion(input) {
      const command =
        inboxV2RevokeTenantPolicyVersionCommandSchema.parse(input);
      return runPolicyAuthorityTransaction(
        transactionExecutor,
        async (transaction) => revokePolicyVersion(transaction, command)
      );
    }
  };
}

/**
 * Locks the current activation head and its exact immutable version for the
 * caller's surrounding transaction. Consumers must persist the returned
 * headRevision in the same transaction; calling this on an auto-commit
 * executor would release the revoke-vs-use fence too early.
 */
export async function lockAndValidateExactActiveInboxV2TenantPolicyAuthority(
  transaction: InboxV2TenantPolicyAuthorityUseTransaction,
  input: InboxV2ExactActiveTenantPolicyAuthorityInput
): Promise<LockExactActiveInboxV2TenantPolicyAuthorityResult> {
  const exact = inboxV2ExactActiveTenantPolicyAuthorityInputSchema.parse(input);
  const result = await transaction.execute<ExactPolicyAuthorityRow>(
    buildLockExactActiveInboxV2TenantPolicyAuthoritySql(exact)
  );
  const row = requireAtMostOneRow(result, "Exact tenant policy authority lock");
  if (row === null) return { kind: "policy_not_found" };

  const activation = mapPolicyHead(row);
  const version = mapExactPolicyVersion(row);
  if (activation.state !== "active") {
    return {
      kind: "policy_inactive",
      currentHeadRevision: activation.revision
    };
  }
  const activeActivation = asPolicyHeadState(activation, "active");
  if (
    exact.expectedHeadRevision !== null &&
    activation.revision !== exact.expectedHeadRevision
  ) {
    return {
      kind: "head_revision_conflict",
      currentHeadRevision: activation.revision
    };
  }
  if (activation.policyVersion !== exact.policyVersion) {
    return {
      kind: "policy_version_conflict",
      currentPolicyVersion: activation.policyVersion,
      currentHeadRevision: activation.revision
    };
  }
  if (
    activation.definitionContractVersion !== exact.definitionContractVersion
  ) {
    return {
      kind: "definition_contract_version_conflict",
      currentDefinitionContractVersion: activation.definitionContractVersion,
      currentHeadRevision: activation.revision
    };
  }
  if (activation.definitionDigestSha256 !== exact.definitionDigestSha256) {
    return {
      kind: "definition_digest_conflict",
      currentDefinitionDigestSha256: activation.definitionDigestSha256,
      currentHeadRevision: activation.revision
    };
  }
  if (activation.approvedTrustedServiceId !== exact.approvedTrustedServiceId) {
    return {
      kind: "trusted_service_conflict",
      currentApprovedTrustedServiceId: activation.approvedTrustedServiceId,
      currentHeadRevision: activation.revision
    };
  }
  if (Date.parse(version.approvedAt) > Date.parse(activation.activatedAt)) {
    return {
      kind: "authority_time_conflict",
      approvedAt: version.approvedAt,
      activatedAt: activation.activatedAt
    };
  }
  if (Date.parse(activation.activatedAt) > Date.parse(exact.occurredAt)) {
    return {
      kind: "occurred_before_activation",
      activatedAt: activation.activatedAt,
      currentHeadRevision: activation.revision
    };
  }

  const authority: InboxV2ExactActiveTenantPolicyAuthority = {
    version,
    activation: activeActivation,
    headRevision: activeActivation.revision,
    approvedTrustedServiceId: activeActivation.approvedTrustedServiceId
  };
  return {
    kind: "locked",
    authority,
    headRevision: activeActivation.revision
  };
}

async function activatePolicyVersion(
  transaction: RawSqlExecutor,
  command: ReturnType<
    typeof inboxV2ActivateTenantPolicyVersionCommandSchema.parse
  >
): Promise<ActivateInboxV2TenantPolicyVersionResult> {
  const currentHead = await loadPolicyHead(transaction, command, true);
  if (
    (currentHead === null && command.expectedHeadRevision !== null) ||
    (currentHead !== null &&
      currentHead.revision !== command.expectedHeadRevision)
  ) {
    return {
      kind: "head_revision_conflict",
      currentHeadRevision: currentHead?.revision ?? null
    };
  }
  if (currentHead !== null && currentHead.state !== "revoked") {
    return { kind: "head_state_conflict", currentHead };
  }
  const revokedHead =
    currentHead === null ? null : asPolicyHeadState(currentHead, "revoked");

  const authority = await loadPolicyVersion(transaction, command, true);
  if (authority === null) return { kind: "policy_version_not_found" };

  const minimumAt = maxTimestamp(
    authority.approvedAt,
    revokedHead?.revokedAt ?? authority.approvedAt
  );
  if (Date.parse(command.activatedAt) < Date.parse(minimumAt)) {
    return { kind: "activation_time_conflict", minimumAt };
  }

  const employeeConflict = await lockActiveEmployee(transaction, {
    tenantId: command.tenantId,
    employeeId: command.activatedBy.id,
    occurredAt: command.activatedAt
  });
  if (employeeConflict !== null) return employeeConflict;

  const resultingRevision = nextRevision(command.expectedHeadRevision);
  const transition = inboxV2TenantPolicyActivationTransitionSchema.parse({
    tenantId: command.tenantId,
    family: command.family,
    policyId: command.policyId,
    operation: "activate",
    expectedHeadRevision: command.expectedHeadRevision,
    resultingHeadRevision: resultingRevision,
    previous: revokedHead === null ? null : policySnapshot(revokedHead),
    resulting: { ...policySnapshot(authority), state: "active" },
    actor: command.activatedBy,
    occurredAt: command.activatedAt,
    createdAt: command.activatedAt
  });

  await expectOneReturnedRow(
    transaction,
    buildInsertInboxV2TenantPolicyActivationTransitionSql(transition),
    "Tenant policy activation transition insert"
  );
  const activation = mapPolicyHead(
    await expectOneReturnedRow(
      transaction,
      revokedHead === null
        ? buildInsertInboxV2TenantPolicyActivationHeadSql({
            authority,
            transition
          })
        : buildAdvanceInboxV2TenantPolicyActivationHeadSql({
            currentHead: revokedHead,
            authority,
            transition
          }),
      "Tenant policy activation head advance"
    )
  );
  if (activation.state !== "active") {
    throw invariantError("Activation head advance returned a non-active row.");
  }
  return {
    kind: "activated",
    authority,
    activation: asPolicyHeadState(activation, "active"),
    transition
  };
}

async function revokePolicyVersion(
  transaction: RawSqlExecutor,
  command: ReturnType<
    typeof inboxV2RevokeTenantPolicyVersionCommandSchema.parse
  >
): Promise<RevokeInboxV2TenantPolicyVersionResult> {
  const currentHead = await loadPolicyHead(transaction, command, true);
  if (currentHead === null) return { kind: "policy_not_found" };
  if (currentHead.revision !== command.expectedHeadRevision) {
    return {
      kind: "head_revision_conflict",
      currentHeadRevision: currentHead.revision
    };
  }
  if (currentHead.state !== "active") {
    return { kind: "head_state_conflict", currentHead };
  }
  const activeHead = asPolicyHeadState(currentHead, "active");
  if (activeHead.policyVersion !== command.policyVersion) {
    return {
      kind: "policy_version_conflict",
      currentPolicyVersion: activeHead.policyVersion
    };
  }
  if (Date.parse(command.revokedAt) < Date.parse(activeHead.activatedAt)) {
    return {
      kind: "revocation_time_conflict",
      minimumAt: activeHead.activatedAt
    };
  }

  const authority = await loadPolicyVersion(transaction, command, true);
  if (authority === null) {
    throw invariantError("Active policy head has no exact immutable version.");
  }
  if (!headMatchesAuthority(activeHead, authority)) {
    throw invariantError(
      "Active policy head does not match its immutable version."
    );
  }

  const employeeConflict = await lockActiveEmployee(transaction, {
    tenantId: command.tenantId,
    employeeId: command.revokedBy.id,
    occurredAt: command.revokedAt
  });
  if (employeeConflict !== null) return employeeConflict;

  const transition = inboxV2TenantPolicyActivationTransitionSchema.parse({
    tenantId: command.tenantId,
    family: command.family,
    policyId: command.policyId,
    operation: "revoke",
    expectedHeadRevision: command.expectedHeadRevision,
    resultingHeadRevision: nextRevision(command.expectedHeadRevision),
    previous: policySnapshot(activeHead),
    resulting: { ...policySnapshot(activeHead), state: "revoked" },
    actor: command.revokedBy,
    occurredAt: command.revokedAt,
    createdAt: command.revokedAt
  });
  await expectOneReturnedRow(
    transaction,
    buildInsertInboxV2TenantPolicyActivationTransitionSql(transition),
    "Tenant policy revocation transition insert"
  );
  const activation = mapPolicyHead(
    await expectOneReturnedRow(
      transaction,
      buildRevokeInboxV2TenantPolicyActivationHeadSql({
        currentHead: activeHead,
        transition
      }),
      "Tenant policy activation head revoke"
    )
  );
  if (activation.state !== "revoked") {
    throw invariantError("Activation head revoke returned a non-revoked row.");
  }
  return {
    kind: "revoked",
    authority,
    activation: asPolicyHeadState(activation, "revoked"),
    transition
  };
}

export function buildLockExactActiveInboxV2TenantPolicyAuthoritySql(
  input: ReturnType<
    typeof inboxV2ExactActiveTenantPolicyAuthorityInputSchema.parse
  >
): SQL {
  return sql`
    select
      head_row.*,
      version_row.approved_by_employee_id as version_approved_by_employee_id,
      version_row.approved_at as version_approved_at,
      version_row.revision as version_revision,
      version_row.created_at as version_created_at,
      version_row.updated_at as version_updated_at
    from inbox_v2_tenant_policy_activation_heads head_row
    join inbox_v2_tenant_policy_versions version_row
      on version_row.tenant_id = head_row.tenant_id
     and version_row.family = head_row.family
     and version_row.policy_id = head_row.policy_id
     and version_row.policy_version = head_row.policy_version
     and version_row.definition_contract_version =
         head_row.definition_contract_version
     and version_row.definition_digest_sha256 =
         head_row.definition_digest_sha256
     and version_row.approved_trusted_service_id =
         head_row.approved_trusted_service_id
    where head_row.tenant_id = ${input.tenantId}
      and head_row.family = ${input.family}
      and head_row.policy_id = ${input.policyId}
    for share of head_row, version_row
  `;
}

export function buildLockInboxV2TenantPolicyActivationHeadSql(input: {
  tenantId: string;
  family: string;
  policyId: string;
}): SQL {
  return sql`
    select *
    from inbox_v2_tenant_policy_activation_heads
    where tenant_id = ${input.tenantId}
      and family = ${input.family}
      and policy_id = ${input.policyId}
    for update
  `;
}

export function buildLockInboxV2TenantPolicyVersionSql(input: {
  tenantId: string;
  family: string;
  policyId: string;
  policyVersion: string;
}): SQL {
  return sql`
    select *
    from inbox_v2_tenant_policy_versions
    where tenant_id = ${input.tenantId}
      and family = ${input.family}
      and policy_id = ${input.policyId}
      and policy_version = ${input.policyVersion}
    for share
  `;
}

export function buildLockInboxV2TenantPolicyEmployeeSql(input: {
  tenantId: string;
  employeeId: string;
}): SQL {
  return sql`
    select id, created_at, deactivated_at
    from employees
    where tenant_id = ${input.tenantId}
      and id = ${input.employeeId}
    for share
  `;
}

export function buildInsertInboxV2TenantPolicyVersionSql(
  command: ReturnType<
    typeof inboxV2ApproveTenantPolicyVersionCommandSchema.parse
  >
): SQL {
  return sql`
    insert into inbox_v2_tenant_policy_versions (
      tenant_id, family, policy_id, policy_version,
      definition_contract_version, definition_digest_sha256,
      approved_trusted_service_id, approved_by_employee_id, approved_at,
      revision, created_at, updated_at
    ) values (
      ${command.tenantId}, ${command.family}, ${command.policyId},
      ${command.policyVersion}, ${command.definitionContractVersion},
      ${command.definitionDigestSha256}, ${command.approvedTrustedServiceId},
      ${command.approvedBy.id}, ${command.approvedAt}, 1,
      ${command.approvedAt}, ${command.approvedAt}
    )
    on conflict (tenant_id, family, policy_id, policy_version) do nothing
    returning *
  `;
}

export function buildInsertInboxV2TenantPolicyActivationTransitionSql(
  transition: InboxV2TenantPolicyActivationTransition
): SQL {
  return sql`
    insert into inbox_v2_tenant_policy_activation_transitions (
      tenant_id, family, policy_id, operation, expected_head_revision,
      resulting_head_revision, previous_state, previous_policy_version,
      previous_definition_contract_version,
      previous_definition_digest_sha256,
      previous_approved_trusted_service_id, resulting_state,
      resulting_policy_version, resulting_definition_contract_version,
      resulting_definition_digest_sha256,
      resulting_approved_trusted_service_id, actor_employee_id, occurred_at,
      created_at
    ) values (
      ${transition.tenantId}, ${transition.family}, ${transition.policyId},
      ${transition.operation}, ${transition.expectedHeadRevision},
      ${transition.resultingHeadRevision}, ${transition.previous?.state ?? null},
      ${transition.previous?.policyVersion ?? null},
      ${transition.previous?.definitionContractVersion ?? null},
      ${transition.previous?.definitionDigestSha256 ?? null},
      ${transition.previous?.approvedTrustedServiceId ?? null},
      ${transition.resulting.state}, ${transition.resulting.policyVersion},
      ${transition.resulting.definitionContractVersion},
      ${transition.resulting.definitionDigestSha256},
      ${transition.resulting.approvedTrustedServiceId}, ${transition.actor.id},
      ${transition.occurredAt}, ${transition.createdAt}
    )
    returning resulting_head_revision as revision
  `;
}

export function buildInsertInboxV2TenantPolicyActivationHeadSql(input: {
  authority: InboxV2TenantPolicyVersionAuthority;
  transition: InboxV2TenantPolicyActivationTransition;
}): SQL {
  return sql`
    insert into inbox_v2_tenant_policy_activation_heads (
      tenant_id, family, policy_id, policy_version,
      definition_contract_version, definition_digest_sha256,
      approved_trusted_service_id, state, activated_by_employee_id,
      activated_at, revoked_by_employee_id, revoked_at, revision,
      created_at, updated_at
    ) values (
      ${input.authority.tenantId}, ${input.authority.family},
      ${input.authority.policyId}, ${input.authority.policyVersion},
      ${input.authority.definitionContractVersion},
      ${input.authority.definitionDigestSha256},
      ${input.authority.approvedTrustedServiceId}, 'active',
      ${input.transition.actor.id}, ${input.transition.occurredAt}, null, null,
      ${input.transition.resultingHeadRevision},
      ${input.transition.occurredAt}, ${input.transition.occurredAt}
    )
    on conflict (tenant_id, family, policy_id) do nothing
    returning *
  `;
}

export function buildAdvanceInboxV2TenantPolicyActivationHeadSql(input: {
  currentHead: InboxV2TenantPolicyActivationHead & { state: "revoked" };
  authority: InboxV2TenantPolicyVersionAuthority;
  transition: InboxV2TenantPolicyActivationTransition;
}): SQL {
  return sql`
    update inbox_v2_tenant_policy_activation_heads
    set policy_version = ${input.authority.policyVersion},
        definition_contract_version = ${input.authority.definitionContractVersion},
        definition_digest_sha256 = ${input.authority.definitionDigestSha256},
        approved_trusted_service_id = ${input.authority.approvedTrustedServiceId},
        state = 'active',
        activated_by_employee_id = ${input.transition.actor.id},
        activated_at = ${input.transition.occurredAt},
        revoked_by_employee_id = null,
        revoked_at = null,
        revision = ${input.transition.resultingHeadRevision},
        updated_at = ${input.transition.occurredAt}
    where tenant_id = ${input.currentHead.tenantId}
      and family = ${input.currentHead.family}
      and policy_id = ${input.currentHead.policyId}
      and revision = ${input.transition.expectedHeadRevision}
      and state = 'revoked'
    returning *
  `;
}

export function buildRevokeInboxV2TenantPolicyActivationHeadSql(input: {
  currentHead: InboxV2TenantPolicyActivationHead & { state: "active" };
  transition: InboxV2TenantPolicyActivationTransition;
}): SQL {
  return sql`
    update inbox_v2_tenant_policy_activation_heads
    set state = 'revoked',
        revoked_by_employee_id = ${input.transition.actor.id},
        revoked_at = ${input.transition.occurredAt},
        revision = ${input.transition.resultingHeadRevision},
        updated_at = ${input.transition.occurredAt}
    where tenant_id = ${input.currentHead.tenantId}
      and family = ${input.currentHead.family}
      and policy_id = ${input.currentHead.policyId}
      and policy_version = ${input.currentHead.policyVersion}
      and revision = ${input.transition.expectedHeadRevision}
      and state = 'active'
    returning *
  `;
}

async function loadPolicyVersion(
  executor: RawSqlExecutor,
  input: {
    tenantId: string;
    family: string;
    policyId: string;
    policyVersion: string;
  },
  lock = false
): Promise<InboxV2TenantPolicyVersionAuthority | null> {
  const result = await executor.execute<PolicyVersionRow>(
    lock
      ? buildLockInboxV2TenantPolicyVersionSql(input)
      : sql`
          select *
          from inbox_v2_tenant_policy_versions
          where tenant_id = ${input.tenantId}
            and family = ${input.family}
            and policy_id = ${input.policyId}
            and policy_version = ${input.policyVersion}
        `
  );
  const row = requireAtMostOneRow(result, "Tenant policy version lookup");
  return row === null ? null : mapPolicyVersion(row);
}

async function loadPolicyHead(
  executor: RawSqlExecutor,
  input: { tenantId: string; family: string; policyId: string },
  lock = false
): Promise<InboxV2TenantPolicyActivationHead | null> {
  const result = await executor.execute<PolicyActivationHeadRow>(
    lock
      ? buildLockInboxV2TenantPolicyActivationHeadSql(input)
      : sql`
          select *
          from inbox_v2_tenant_policy_activation_heads
          where tenant_id = ${input.tenantId}
            and family = ${input.family}
            and policy_id = ${input.policyId}
        `
  );
  const row = requireAtMostOneRow(
    result,
    "Tenant policy activation-head lookup"
  );
  return row === null ? null : mapPolicyHead(row);
}

async function lockActiveEmployee(
  executor: RawSqlExecutor,
  input: { tenantId: string; employeeId: string; occurredAt: string }
): Promise<InboxV2TenantPolicyEmployeeConflict | null> {
  const result = await executor.execute<EmployeeLockRow>(
    buildLockInboxV2TenantPolicyEmployeeSql(input)
  );
  const row = requireAtMostOneRow(result, "Tenant policy Employee lock");
  if (row === null) {
    return { kind: "employee_not_found", employeeId: input.employeeId };
  }
  const createdAt = toIsoTimestamp(row.created_at, "Employee created_at");
  const deactivatedAt = toNullableIsoTimestamp(
    row.deactivated_at,
    "Employee deactivated_at"
  );
  if (
    Date.parse(createdAt) > Date.parse(input.occurredAt) ||
    (deactivatedAt !== null &&
      Date.parse(deactivatedAt) <= Date.parse(input.occurredAt))
  ) {
    return { kind: "employee_inactive", employeeId: input.employeeId };
  }
  return null;
}

function mapPolicyVersion(
  row: PolicyVersionRow
): InboxV2TenantPolicyVersionAuthority {
  const tenantId = requireString(row.tenant_id, "Policy version tenant_id");
  return inboxV2TenantPolicyVersionAuthoritySchema.parse({
    tenantId,
    family: requireString(row.family, "Policy version family"),
    policyId: requireString(row.policy_id, "Policy version policy_id"),
    policyVersion: requireString(
      row.policy_version,
      "Policy version policy_version"
    ),
    definitionContractVersion: requireString(
      row.definition_contract_version,
      "Policy version definition_contract_version"
    ),
    definitionDigestSha256: requireString(
      row.definition_digest_sha256,
      "Policy version definition_digest_sha256"
    ),
    approvedTrustedServiceId: requireString(
      row.approved_trusted_service_id,
      "Policy version approved_trusted_service_id"
    ),
    approvedBy: {
      tenantId,
      kind: "employee",
      id: requireString(
        row.approved_by_employee_id,
        "Policy version approved_by_employee_id"
      )
    },
    approvedAt: toIsoTimestamp(row.approved_at, "Policy version approved_at"),
    revision: requireBigintString(row.revision, "Policy version revision"),
    createdAt: toIsoTimestamp(row.created_at, "Policy version created_at"),
    updatedAt: toIsoTimestamp(row.updated_at, "Policy version updated_at")
  });
}

function mapExactPolicyVersion(row: ExactPolicyAuthorityRow) {
  return mapPolicyVersion({
    ...row,
    approved_by_employee_id: row.version_approved_by_employee_id,
    approved_at: row.version_approved_at,
    revision: row.version_revision,
    created_at: row.version_created_at,
    updated_at: row.version_updated_at
  });
}

function mapPolicyHead(
  row: PolicyActivationHeadRow
): InboxV2TenantPolicyActivationHead {
  const tenantId = requireString(row.tenant_id, "Policy head tenant_id");
  const revokedEmployeeId = optionalString(
    row.revoked_by_employee_id,
    "Policy head revoked_by_employee_id"
  );
  return inboxV2TenantPolicyActivationHeadSchema.parse({
    tenantId,
    family: requireString(row.family, "Policy head family"),
    policyId: requireString(row.policy_id, "Policy head policy_id"),
    policyVersion: requireString(
      row.policy_version,
      "Policy head policy_version"
    ),
    definitionContractVersion: requireString(
      row.definition_contract_version,
      "Policy head definition_contract_version"
    ),
    definitionDigestSha256: requireString(
      row.definition_digest_sha256,
      "Policy head definition_digest_sha256"
    ),
    approvedTrustedServiceId: requireString(
      row.approved_trusted_service_id,
      "Policy head approved_trusted_service_id"
    ),
    state: requireString(row.state, "Policy head state"),
    activatedBy: {
      tenantId,
      kind: "employee",
      id: requireString(
        row.activated_by_employee_id,
        "Policy head activated_by_employee_id"
      )
    },
    activatedAt: toIsoTimestamp(row.activated_at, "Policy head activated_at"),
    revokedBy:
      revokedEmployeeId === null
        ? null
        : { tenantId, kind: "employee", id: revokedEmployeeId },
    revokedAt: toNullableIsoTimestamp(row.revoked_at, "Policy head revoked_at"),
    revision: requireBigintString(row.revision, "Policy head revision"),
    createdAt: toIsoTimestamp(row.created_at, "Policy head created_at"),
    updatedAt: toIsoTimestamp(row.updated_at, "Policy head updated_at")
  });
}

function samePolicyApproval(
  authority: InboxV2TenantPolicyVersionAuthority,
  command: ReturnType<
    typeof inboxV2ApproveTenantPolicyVersionCommandSchema.parse
  >
): boolean {
  return (
    authority.tenantId === command.tenantId &&
    authority.family === command.family &&
    authority.policyId === command.policyId &&
    authority.policyVersion === command.policyVersion &&
    authority.definitionContractVersion === command.definitionContractVersion &&
    authority.definitionDigestSha256 === command.definitionDigestSha256 &&
    authority.approvedTrustedServiceId === command.approvedTrustedServiceId &&
    authority.approvedBy.id === command.approvedBy.id &&
    authority.approvedAt === command.approvedAt
  );
}

function headMatchesAuthority(
  head: InboxV2TenantPolicyActivationHead,
  authority: InboxV2TenantPolicyVersionAuthority
): boolean {
  return (
    head.tenantId === authority.tenantId &&
    head.family === authority.family &&
    head.policyId === authority.policyId &&
    head.policyVersion === authority.policyVersion &&
    head.definitionContractVersion === authority.definitionContractVersion &&
    head.definitionDigestSha256 === authority.definitionDigestSha256 &&
    head.approvedTrustedServiceId === authority.approvedTrustedServiceId
  );
}

function policySnapshot(
  source:
    | InboxV2TenantPolicyActivationHead
    | InboxV2TenantPolicyVersionAuthority
) {
  return {
    policyVersion: source.policyVersion,
    definitionContractVersion: source.definitionContractVersion,
    definitionDigestSha256: source.definitionDigestSha256,
    approvedTrustedServiceId: source.approvedTrustedServiceId,
    state: "state" in source ? source.state : ("active" as const)
  };
}

function asPolicyHeadState<TState extends "active" | "revoked">(
  head: InboxV2TenantPolicyActivationHead,
  state: TState
): InboxV2TenantPolicyActivationHead & { state: TState } {
  if (head.state !== state) {
    throw invariantError(`Policy activation head is not ${state}.`);
  }
  return head as InboxV2TenantPolicyActivationHead & { state: TState };
}

async function runPolicyAuthorityTransaction<TResult>(
  executor: InboxV2TenantPolicyAuthorityTransactionExecutor,
  work: (
    transaction: InboxV2TenantPolicyAuthorityUseTransaction
  ) => Promise<TResult>
): Promise<TResult> {
  for (
    let attempt = 1;
    attempt <= POLICY_AUTHORITY_TRANSACTION_ATTEMPTS;
    attempt += 1
  ) {
    try {
      return await executor.transaction(
        work,
        POLICY_AUTHORITY_TRANSACTION_CONFIG
      );
    } catch (error) {
      if (
        attempt === POLICY_AUTHORITY_TRANSACTION_ATTEMPTS ||
        !isRetryablePolicyAuthorityTransactionError(error)
      ) {
        throw error;
      }
    }
  }
  throw invariantError("Tenant policy authority transaction retry exhausted.");
}

function isRetryablePolicyAuthorityTransactionError(error: unknown): boolean {
  const code = sqlState(error);
  return code !== null && RETRYABLE_POLICY_AUTHORITY_SQLSTATES.has(code);
}

function sqlState(error: unknown): string | null {
  let current = error;
  const seen = new Set<unknown>();
  for (let depth = 0; depth < 8; depth += 1) {
    if (
      (typeof current !== "object" || current === null) &&
      typeof current !== "function"
    ) {
      return null;
    }
    if (seen.has(current)) return null;
    seen.add(current);
    const code = Reflect.get(current, "code");
    if (typeof code === "string") return code;
    current = Reflect.get(current, "cause");
  }
  return null;
}

async function expectOneReturnedRow<Row extends Record<string, unknown>>(
  executor: RawSqlExecutor,
  query: SQL,
  label: string
): Promise<Row> {
  const result = await executor.execute<Row>(query);
  if (result.rows.length !== 1) {
    throw invariantError(`${label} did not return exactly one row.`);
  }
  return result.rows[0]!;
}

function requireAtMostOneRow<Row>(
  result: RawSqlQueryResult<Row>,
  label: string
): Row | null {
  if (result.rows.length > 1) {
    throw invariantError(`${label} returned more than one row.`);
  }
  return result.rows[0] ?? null;
}

function nextRevision(revision: string | null): InboxV2EntityRevision {
  return String(BigInt(revision ?? "0") + 1n) as InboxV2EntityRevision;
}

function maxTimestamp(left: string, right: string): string {
  return Date.parse(left) >= Date.parse(right) ? left : right;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw invariantError(`${label} is not a string.`);
  }
  return value;
}

function optionalString(value: unknown, label: string): string | null {
  if (value === null || value === undefined) return null;
  return requireString(value, label);
}

function requireBigintString(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/u.test(value)) {
    throw invariantError(`${label} is not a canonical positive bigint string.`);
  }
  return value;
}

function toIsoTimestamp(value: unknown, label: string): string {
  const date =
    value instanceof Date
      ? value
      : typeof value === "string"
        ? new Date(value)
        : null;
  if (date === null || Number.isNaN(date.getTime())) {
    throw invariantError(`${label} is not a PostgreSQL timestamp.`);
  }
  return date.toISOString();
}

function toNullableIsoTimestamp(value: unknown, label: string): string | null {
  return value === null || value === undefined
    ? null
    : toIsoTimestamp(value, label);
}

function invariantError(message: string): InboxV2PersistenceInvariantError {
  return new InboxV2PersistenceInvariantError(message);
}

export type { RawSqlExecutor, RawSqlQueryResult };
