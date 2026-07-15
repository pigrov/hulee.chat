import {
  defineInboxV2PolicyActivationRepository,
  defineInboxV2PrivacyExportClaimRepository,
  inboxV2EntityRevisionSchema,
  inboxV2PolicyActivationAuthoritySchema,
  inboxV2PolicyActivationCompareAndSetInputSchema,
  inboxV2PolicyActivationRepositoryKeySchema,
  inboxV2PrivacyExportJobReferenceSchema,
  inboxV2PrivacyExportManifestReferenceSchema,
  inboxV2Sha256DigestSchema,
  inboxV2TenantIdSchema,
  type InboxV2PolicyActivationAuthority,
  type InboxV2PolicyActivationCompareAndSetInput,
  type InboxV2PolicyActivationRepository,
  type InboxV2PolicyActivationRepositoryKey,
  type InboxV2PrivacyExportClaimLineage,
  type InboxV2PrivacyExportClaimRepository,
  type InboxV2PrivacyExportClaimRepositoryResult,
  type InboxV2TenantId
} from "@hulee/contracts";
import { sql, type SQL } from "drizzle-orm";

import type { HuleeDatabase } from "../client";
import { buildInboxV2AdvisoryXactLockSql } from "./sql-inbox-v2-advisory-lock";
import type { RawSqlExecutor } from "./sql-outbox-repository";

export type InboxV2PrivacyExportClaimTransactionExecutor = RawSqlExecutor & {
  transaction<TResult>(
    work: (transaction: RawSqlExecutor) => Promise<TResult>
  ): Promise<TResult>;
};

export type InboxV2DataGovernanceTransactionExecutor = RawSqlExecutor & {
  transaction<TResult>(
    work: (transaction: RawSqlExecutor) => Promise<TResult>
  ): Promise<TResult>;
};

type PolicyActivationAuthorityRow = {
  tenant_id: unknown;
  registry_composition_hash: unknown;
  governance_context_id: unknown;
  governance_context_version: unknown;
  governance_context_hash: unknown;
  policy_id: unknown;
  policy_version: unknown;
  policy_hash: unknown;
  activation_id: unknown;
  activation_revision: unknown;
  activation_hash: unknown;
  head_revision: unknown;
};

type PolicyActivationPresenceRow = {
  registry_found: unknown;
  governance_found: unknown;
  policy_found: unknown;
  activation_found: unknown;
  exact_lineage_found: unknown;
};

/** Restart-safe authority adapter used before every destructive operation. */
export function createSqlInboxV2PolicyActivationRepository(
  executor: InboxV2DataGovernanceTransactionExecutor | HuleeDatabase
): InboxV2PolicyActivationRepository {
  const transactionExecutor =
    executor as unknown as InboxV2DataGovernanceTransactionExecutor;

  return defineInboxV2PolicyActivationRepository({
    async loadCurrent(key) {
      const normalized = inboxV2PolicyActivationRepositoryKeySchema.parse(key);
      const current = await loadCurrentPolicyActivation(
        transactionExecutor,
        normalized,
        false
      );
      return current === null
        ? { outcome: "not_found" }
        : { outcome: "found", current: current.authority };
    },

    async compareAndSetActivation(input) {
      const mutation =
        inboxV2PolicyActivationCompareAndSetInputSchema.parse(input);
      return transactionExecutor.transaction(async (transaction) => {
        await transaction.execute(
          buildLockInboxV2PolicyActivationSql(mutation.key)
        );

        const current = await loadCurrentPolicyActivation(
          transaction,
          mutation.key,
          true
        );
        const alreadyApplied =
          current !== null &&
          samePolicyAuthority(current.authority, mutation.candidate);
        if (
          !alreadyApplied &&
          (mutation.expectedCurrent === null
            ? current !== null
            : current === null ||
              !samePolicyAuthority(current.authority, mutation.expectedCurrent))
        ) {
          return current === null
            ? { outcome: "lineage_conflict", current: null }
            : { outcome: "current_conflict", current: current.authority };
        }

        const presence = await loadPolicyActivationPresence(
          transaction,
          mutation.candidate,
          mutation.expectedCurrent
        );
        const missingAuthority = firstMissingPolicyAuthority(presence);
        if (missingAuthority !== null) {
          return { outcome: "not_found", missingAuthority };
        }
        if (!presence.exactLineageFound) {
          return {
            outcome: "lineage_conflict",
            current: current?.authority ?? null
          };
        }
        if (alreadyApplied) {
          return { outcome: "already_applied", current: current.authority };
        }

        const result = await transaction.execute<{ applied: unknown }>(
          buildCompareAndSetInboxV2PolicyActivationHeadSql({
            mutation,
            expectedHeadRevision: current?.headRevision ?? null
          })
        );
        if (result.rows.length !== 1 || result.rows[0]?.applied !== true) {
          const winner = await loadCurrentPolicyActivation(
            transaction,
            mutation.key,
            true
          );
          return winner === null
            ? { outcome: "lineage_conflict", current: null }
            : samePolicyAuthority(winner.authority, mutation.candidate)
              ? { outcome: "already_applied", current: winner.authority }
              : { outcome: "current_conflict", current: winner.authority };
        }
        return { outcome: "applied", current: mutation.candidate };
      });
    }
  });
}

export function buildLockInboxV2PolicyActivationSql(
  key: InboxV2PolicyActivationRepositoryKey
): SQL {
  return buildInboxV2AdvisoryXactLockSql([key.tenantId, key.policyId]);
}

export function buildFindCurrentInboxV2PolicyActivationSql(input: {
  key: InboxV2PolicyActivationRepositoryKey;
  forUpdate: boolean;
}): SQL {
  const lock = input.forUpdate ? sql`for update of head` : sql``;
  return sql`
    select head.tenant_id,
           registry.composition_hash as registry_composition_hash,
           governance.context_id as governance_context_id,
           governance.version::text as governance_context_version,
           governance.context_hash as governance_context_hash,
           policy.policy_id,
           policy.version::text as policy_version,
           policy.policy_hash,
           activation.activation_id,
           activation.revision::text as activation_revision,
           activation.activation_hash,
           head.head_revision::text as head_revision
      from inbox_v2_data_governance_policy_activation_heads head
      join inbox_v2_data_governance_effective_policies policy
        on policy.tenant_id = head.tenant_id
       and policy.policy_id = head.policy_id
       and policy.version = head.current_policy_version
      join inbox_v2_data_governance_contexts governance
        on governance.tenant_id = policy.tenant_id
       and governance.context_id = policy.governance_context_id
       and governance.version = policy.governance_context_version
      join inbox_v2_data_governance_registry_versions registry
        on registry.id = policy.registry_id
       and registry.revision = policy.registry_revision
      join inbox_v2_data_governance_policy_activations activation
        on activation.tenant_id = head.tenant_id
       and activation.activation_id = head.current_activation_id
       and activation.revision = head.current_activation_revision
       and activation.policy_id = head.policy_id
       and activation.policy_version = head.current_policy_version
       and activation.candidate_policy_hash = policy.policy_hash
       and activation.governance_context_id = governance.context_id
       and activation.governance_context_version = governance.version
       and activation.governance_context_hash = governance.context_hash
     where head.tenant_id = ${input.key.tenantId}
       and head.policy_id = ${input.key.policyId}
     ${lock}
  `;
}

export function buildFindInboxV2PolicyActivationPresenceSql(input: {
  candidate: InboxV2PolicyActivationAuthority;
  expectedCurrent: InboxV2PolicyActivationAuthority | null;
}): SQL {
  const { candidate, expectedCurrent } = input;
  const transitionLineage =
    expectedCurrent === null
      ? sql`activation.transition_kind = 'initial_reviewed_bootstrap'
             and activation.prior_activation_id is null
             and activation.prior_activation_revision is null
             and activation.prior_policy_version is null`
      : sql`activation.transition_kind = 'supersede_current'
             and activation.prior_activation_id = ${expectedCurrent.activation.id}
             and activation.prior_activation_revision = ${expectedCurrent.activation.revision}
             and activation.prior_policy_version = ${expectedCurrent.effectivePolicy.version}`;
  return sql`
    select
      exists (
        select 1
          from inbox_v2_data_governance_registry_versions registry
         where registry.composition_hash = ${candidate.registryCompositionHash}
      ) as registry_found,
      exists (
        select 1
          from inbox_v2_data_governance_contexts governance
         where governance.tenant_id = ${candidate.tenantId}
           and governance.context_id = ${candidate.governance.id}
           and governance.version = ${candidate.governance.version}
           and governance.context_hash = ${candidate.governance.contextHash}
      ) as governance_found,
      exists (
        select 1
          from inbox_v2_data_governance_effective_policies policy
         where policy.tenant_id = ${candidate.tenantId}
           and policy.policy_id = ${candidate.effectivePolicy.id}
           and policy.version = ${candidate.effectivePolicy.version}
           and policy.policy_hash = ${candidate.effectivePolicy.policyHash}
      ) as policy_found,
      exists (
        select 1
          from inbox_v2_data_governance_policy_activations activation
         where activation.tenant_id = ${candidate.tenantId}
           and activation.activation_id = ${candidate.activation.id}
           and activation.revision = ${candidate.activation.revision}
           and activation.activation_hash = ${candidate.activation.activationHash}
      ) as activation_found,
      exists (
        select 1
          from inbox_v2_data_governance_effective_policies policy
          join inbox_v2_data_governance_contexts governance
            on governance.tenant_id = policy.tenant_id
           and governance.context_id = policy.governance_context_id
           and governance.version = policy.governance_context_version
          join inbox_v2_data_governance_registry_versions registry
            on registry.id = policy.registry_id
           and registry.revision = policy.registry_revision
          join inbox_v2_data_governance_policy_activations activation
            on activation.tenant_id = policy.tenant_id
           and activation.policy_id = policy.policy_id
           and activation.policy_version = policy.version
           and activation.candidate_policy_hash = policy.policy_hash
           and activation.governance_context_id = governance.context_id
           and activation.governance_context_version = governance.version
           and activation.governance_context_hash = governance.context_hash
         where policy.tenant_id = ${candidate.tenantId}
           and policy.policy_id = ${candidate.effectivePolicy.id}
           and policy.version = ${candidate.effectivePolicy.version}
           and policy.policy_hash = ${candidate.effectivePolicy.policyHash}
           and governance.context_id = ${candidate.governance.id}
           and governance.version = ${candidate.governance.version}
           and governance.context_hash = ${candidate.governance.contextHash}
           and registry.composition_hash = ${candidate.registryCompositionHash}
           and activation.activation_id = ${candidate.activation.id}
           and activation.revision = ${candidate.activation.revision}
           and activation.activation_hash = ${candidate.activation.activationHash}
           and ${transitionLineage}
      ) as exact_lineage_found
  `;
}

export function buildCompareAndSetInboxV2PolicyActivationHeadSql(input: {
  mutation: InboxV2PolicyActivationCompareAndSetInput;
  expectedHeadRevision: string | null;
}): SQL {
  const candidate = input.mutation.candidate;
  if (input.expectedHeadRevision === null) {
    return sql`
      with applied as (
        insert into inbox_v2_data_governance_policy_activation_heads (
          tenant_id,
          policy_id,
          current_policy_version,
          current_activation_id,
          current_activation_revision,
          head_revision,
          updated_at
        ) values (
          ${candidate.tenantId},
          ${candidate.effectivePolicy.id},
          ${candidate.effectivePolicy.version},
          ${candidate.activation.id},
          ${candidate.activation.revision},
          1,
          clock_timestamp()
        )
        on conflict do nothing
        returning true as applied
      )
      select applied from applied
    `;
  }
  return sql`
    with applied as (
      update inbox_v2_data_governance_policy_activation_heads
         set current_policy_version = ${candidate.effectivePolicy.version},
             current_activation_id = ${candidate.activation.id},
             current_activation_revision = ${candidate.activation.revision},
             head_revision = head_revision + 1,
             updated_at = clock_timestamp()
       where tenant_id = ${candidate.tenantId}
         and policy_id = ${candidate.effectivePolicy.id}
         and head_revision = ${input.expectedHeadRevision}
      returning true as applied
    )
    select applied from applied
  `;
}

async function loadCurrentPolicyActivation(
  executor: RawSqlExecutor,
  key: InboxV2PolicyActivationRepositoryKey,
  forUpdate: boolean
): Promise<{
  authority: InboxV2PolicyActivationAuthority;
  headRevision: string;
} | null> {
  const result = await executor.execute<PolicyActivationAuthorityRow>(
    buildFindCurrentInboxV2PolicyActivationSql({ key, forUpdate })
  );
  if (result.rows.length > 1) {
    throw new Error("Policy activation head is not unique.");
  }
  if (result.rows.length === 0) return null;
  const row = result.rows[0]!;
  return {
    authority: inboxV2PolicyActivationAuthoritySchema.parse({
      tenantId: requiredString(row.tenant_id),
      registryCompositionHash: requiredString(row.registry_composition_hash),
      governance: {
        tenantId: requiredString(row.tenant_id),
        id: requiredString(row.governance_context_id),
        version: requiredString(row.governance_context_version),
        contextHash: requiredString(row.governance_context_hash)
      },
      effectivePolicy: {
        tenantId: requiredString(row.tenant_id),
        id: requiredString(row.policy_id),
        version: requiredString(row.policy_version),
        policyHash: requiredString(row.policy_hash)
      },
      activation: {
        tenantId: requiredString(row.tenant_id),
        id: requiredString(row.activation_id),
        revision: requiredString(row.activation_revision),
        activationHash: requiredString(row.activation_hash)
      }
    }),
    headRevision: inboxV2EntityRevisionSchema.parse(row.head_revision)
  };
}

async function loadPolicyActivationPresence(
  executor: RawSqlExecutor,
  candidate: InboxV2PolicyActivationAuthority,
  expectedCurrent: InboxV2PolicyActivationAuthority | null
): Promise<{
  registryFound: boolean;
  governanceFound: boolean;
  policyFound: boolean;
  activationFound: boolean;
  exactLineageFound: boolean;
}> {
  const result = await executor.execute<PolicyActivationPresenceRow>(
    buildFindInboxV2PolicyActivationPresenceSql({
      candidate,
      expectedCurrent
    })
  );
  if (result.rows.length !== 1) {
    throw new Error(
      "Policy activation presence query returned no exact result."
    );
  }
  const row = result.rows[0]!;
  return {
    registryFound: requiredBoolean(row.registry_found),
    governanceFound: requiredBoolean(row.governance_found),
    policyFound: requiredBoolean(row.policy_found),
    activationFound: requiredBoolean(row.activation_found),
    exactLineageFound: requiredBoolean(row.exact_lineage_found)
  };
}

function firstMissingPolicyAuthority(input: {
  registryFound: boolean;
  governanceFound: boolean;
  policyFound: boolean;
  activationFound: boolean;
}):
  | "registry_composition"
  | "governance_context"
  | "effective_policy"
  | "activation"
  | null {
  if (!input.registryFound) return "registry_composition";
  if (!input.governanceFound) return "governance_context";
  if (!input.policyFound) return "effective_policy";
  if (!input.activationFound) return "activation";
  return null;
}

function samePolicyAuthority(
  left: InboxV2PolicyActivationAuthority,
  right: InboxV2PolicyActivationAuthority
): boolean {
  return (
    left.tenantId === right.tenantId &&
    left.registryCompositionHash === right.registryCompositionHash &&
    left.governance.id === right.governance.id &&
    left.governance.version === right.governance.version &&
    left.governance.contextHash === right.governance.contextHash &&
    left.effectivePolicy.id === right.effectivePolicy.id &&
    left.effectivePolicy.version === right.effectivePolicy.version &&
    left.effectivePolicy.policyHash === right.effectivePolicy.policyHash &&
    left.activation.id === right.activation.id &&
    left.activation.revision === right.activation.revision &&
    left.activation.activationHash === right.activation.activationHash
  );
}

function requiredBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw new Error(
      "Policy activation repository returned an invalid boolean."
    );
  }
  return value;
}

type NormalizedClaimLineage = Readonly<{
  tenantId: InboxV2TenantId;
  jobId: string;
  jobRevision: string;
  manifestId: string;
  manifestRevision: string;
  manifestHash: string;
  packagingProofHash: string;
  archiveCompositionHash: string;
  issuedReceiptHash: string;
}>;

type IssueClaimInput = Readonly<{
  artifactClaimKey: string;
  receiptKey: string;
  principalKey: string;
  issuedRevision: string;
  lineage: NormalizedClaimLineage;
}>;

type ConsumeClaimInput = Readonly<{
  artifactClaimKey: string;
  receiptKey: string;
  principalKey: string;
  expectedRevision: string;
  nextRevision: string;
  lineage: NormalizedClaimLineage;
}>;

type ClaimRow = {
  artifact_claim_key: unknown;
  receipt_key: unknown;
  principal_key: unknown;
  claim_revision: unknown;
  job_id: unknown;
  job_revision: unknown;
  manifest_id: unknown;
  manifest_revision: unknown;
  packaging_proof_hash: unknown;
  archive_composition_hash: unknown;
  issued_receipt_hash: unknown;
};

type ReceiptRow = ClaimRow & {
  state: unknown;
  revision: unknown;
};

class PrivacyExportClaimConflict extends Error {
  constructor() {
    super("Privacy export artifact or receipt already has a durable claim.");
    this.name = "PrivacyExportClaimConflict";
  }
}

/**
 * Durable, cross-process adapter for the one-use export capability. The
 * artifact claim and its issued receipt are committed atomically. Consumption
 * compares both immutable lineage and the receipt revision before advancing.
 */
export function createSqlInboxV2PrivacyExportClaimRepository(
  executor: InboxV2PrivacyExportClaimTransactionExecutor | HuleeDatabase
): InboxV2PrivacyExportClaimRepository {
  const transactionExecutor =
    executor as unknown as InboxV2PrivacyExportClaimTransactionExecutor;

  return defineInboxV2PrivacyExportClaimRepository({
    async issue(input) {
      const normalized = normalizeIssueInput(input);
      try {
        return await transactionExecutor.transaction(async (transaction) => {
          await transaction.execute(
            buildLockInboxV2PrivacyExportClaimSql(normalized)
          );
          await transaction.execute(
            buildLockInboxV2PrivacyExportLifecycleAuthoritySql(normalized)
          );
          const existing = await loadClaim(transaction, normalized);
          if (existing !== null) throw new PrivacyExportClaimConflict();

          const artifactAuthority = await transaction.execute<{
            found: unknown;
          }>(buildFindInboxV2PrivacyExportArtifactAuthoritySql(normalized));
          if (
            artifactAuthority.rows.length !== 1 ||
            artifactAuthority.rows[0]?.found !== true
          ) {
            throw new PrivacyExportClaimConflict();
          }

          const claim = await transaction.execute<ClaimRow>(
            buildInsertInboxV2PrivacyExportArtifactClaimSql(normalized)
          );
          if (claim.rows.length !== 1) throw new PrivacyExportClaimConflict();

          const receipt = await transaction.execute<ReceiptRow>(
            buildInsertInboxV2PrivacyExportDownloadReceiptSql(normalized)
          );
          if (receipt.rows.length !== 1) throw new PrivacyExportClaimConflict();

          assertExactClaimRow(claim.rows[0]!, normalized);
          assertExactReceiptRow(receipt.rows[0]!, normalized, "issued");
          return {
            outcome: "applied",
            claimRevision: normalized.issuedRevision
          } as const;
        });
      } catch (error) {
        if (
          error instanceof PrivacyExportClaimConflict ||
          isUniqueViolation(error)
        ) {
          return { outcome: "conflict" };
        }
        throw error;
      }
    },

    async consume(input) {
      const normalized = normalizeConsumeInput(input);
      return transactionExecutor.transaction(async (transaction) => {
        await transaction.execute(
          buildLockInboxV2PrivacyExportClaimSql(normalized)
        );
        await transaction.execute(
          buildLockInboxV2PrivacyExportLifecycleAuthoritySql(normalized)
        );
        const claim = await loadClaim(transaction, normalized);
        const receipt = await loadReceipt(transaction, normalized);
        if (
          claim === null ||
          receipt === null ||
          !claimRowMatches(claim, normalized) ||
          !receiptRowMatches(receipt, normalized, "issued") ||
          receipt.revision !== normalized.expectedRevision
        ) {
          return { outcome: "conflict" };
        }

        const artifactAuthority = await transaction.execute<{
          found: unknown;
        }>(buildFindInboxV2PrivacyExportArtifactAuthoritySql(normalized));
        if (
          artifactAuthority.rows.length !== 1 ||
          artifactAuthority.rows[0]?.found !== true
        ) {
          return { outcome: "conflict" };
        }

        const updated = await transaction.execute<ReceiptRow>(
          buildConsumeInboxV2PrivacyExportDownloadReceiptSql(normalized)
        );
        if (updated.rows.length !== 1) return { outcome: "conflict" };
        assertExactReceiptRow(updated.rows[0]!, normalized, "consumed");
        return {
          outcome: "applied",
          claimRevision: normalized.nextRevision
        };
      });
    }
  });
}

export function buildLockInboxV2PrivacyExportClaimSql(input: {
  lineage: { tenantId: string };
  artifactClaimKey: string;
}): SQL {
  return buildInboxV2AdvisoryXactLockSql([
    input.lineage.tenantId,
    input.artifactClaimKey
  ]);
}

/** Shares the job-level serialization key with lifecycle CAS transitions. */
export function buildLockInboxV2PrivacyExportLifecycleAuthoritySql(input: {
  lineage: { tenantId: string; jobId: string; jobRevision: string };
}): SQL {
  return buildInboxV2AdvisoryXactLockSql([
    input.lineage.tenantId,
    input.lineage.jobId,
    input.lineage.jobRevision
  ]);
}

export function buildFindInboxV2PrivacyExportArtifactClaimSql(
  input: IssueClaimInput | ConsumeClaimInput
): SQL {
  return sql`
    select artifact_claim_key,
           receipt_key,
           principal_key,
           claim_revision::text,
           job_id,
           job_revision::text,
           manifest_id,
           manifest_revision::text,
           packaging_proof_hash,
           archive_composition_hash,
           issued_receipt_hash
      from inbox_v2_data_governance_export_claims
     where tenant_id = ${input.lineage.tenantId}
       and artifact_claim_key = ${input.artifactClaimKey}
     for update
  `;
}

/** Exact ready artifact authority checked under the same lock as claim issue. */
export function buildFindInboxV2PrivacyExportArtifactAuthoritySql(
  input: IssueClaimInput | ConsumeClaimInput
): SQL {
  return sql`
    select true as found
      from inbox_v2_data_governance_export_artifact_heads artifact_head
      join inbox_v2_data_governance_export_artifacts artifact
        on artifact.tenant_id = artifact_head.tenant_id
       and artifact.artifact_id = artifact_head.artifact_id
       and artifact.revision = artifact_head.current_revision
       and artifact.job_id = artifact_head.job_id
       and artifact.job_revision = artifact_head.job_revision
       and artifact.artifact_claim_key = artifact_head.artifact_claim_key
       and artifact.state = artifact_head.current_state
      join inbox_v2_data_governance_export_jobs job
        on job.tenant_id = artifact_head.tenant_id
       and job.job_id = artifact_head.job_id
       and job.revision = artifact_head.job_revision
       and job.export_artifact_id = artifact_head.artifact_id
       and job.export_artifact_revision = artifact_head.current_revision
       and job.principal_key = ${input.principalKey}
       and job.state = 'ready'
       and job.export_manifest_id = ${input.lineage.manifestId}
       and job.export_manifest_revision = ${input.lineage.manifestRevision}
      join inbox_v2_data_governance_export_manifests manifest
        on manifest.tenant_id = job.tenant_id
       and manifest.manifest_id = job.export_manifest_id
       and manifest.revision = job.export_manifest_revision
       and manifest.job_id = job.job_id
       and manifest.job_revision = job.revision
       and manifest.manifest_hash = ${input.lineage.manifestHash}
     where artifact_head.tenant_id = ${input.lineage.tenantId}
       and artifact_head.artifact_claim_key = ${input.artifactClaimKey}
       and artifact_head.current_state = 'ready'
       and artifact.job_id = ${input.lineage.jobId}
       and artifact.job_revision = ${input.lineage.jobRevision}
       and artifact.state = 'ready'
       and artifact.manifest_id = ${input.lineage.manifestId}
       and artifact.manifest_revision = ${input.lineage.manifestRevision}
       and artifact.manifest_hash = ${input.lineage.manifestHash}
       and artifact.payload_checksum is not null
       and artifact.ready_at is not null
       and artifact.ready_at <= clock_timestamp()
       and artifact.expires_at > clock_timestamp()
       and artifact.deleted_at is null
       and artifact.packaging_proof_hash = ${input.lineage.packagingProofHash}
       and artifact.archive_composition_hash = ${input.lineage.archiveCompositionHash}
     for update of artifact_head, artifact, job
  `;
}

export function buildFindInboxV2PrivacyExportDownloadReceiptSql(
  input: ConsumeClaimInput
): SQL {
  return sql`
    select artifact_claim_key,
           receipt_key,
           principal_key,
           claim_revision::text,
           job_id,
           job_revision::text,
           manifest_id,
           manifest_revision::text,
           packaging_proof_hash,
           archive_composition_hash,
           issued_receipt_hash,
           state,
           revision::text
      from inbox_v2_data_governance_export_receipt_cas
     where tenant_id = ${input.lineage.tenantId}
       and receipt_key = ${input.receiptKey}
     for update
  `;
}

export function buildInsertInboxV2PrivacyExportArtifactClaimSql(
  input: IssueClaimInput
): SQL {
  return sql`
    insert into inbox_v2_data_governance_export_claims (
      tenant_id,
      artifact_claim_key,
      receipt_key,
      principal_key,
      claim_revision,
      job_id,
      job_revision,
      manifest_id,
      manifest_revision,
      packaging_proof_hash,
      archive_composition_hash,
      issued_receipt_hash,
      created_at
    ) values (
      ${input.lineage.tenantId},
      ${input.artifactClaimKey},
      ${input.receiptKey},
      ${input.principalKey},
      ${input.issuedRevision},
      ${input.lineage.jobId},
      ${input.lineage.jobRevision},
      ${input.lineage.manifestId},
      ${input.lineage.manifestRevision},
      ${input.lineage.packagingProofHash},
      ${input.lineage.archiveCompositionHash},
      ${input.lineage.issuedReceiptHash},
      clock_timestamp()
    )
    on conflict do nothing
    returning artifact_claim_key,
              receipt_key,
              principal_key,
              claim_revision::text,
              job_id,
              job_revision::text,
              manifest_id,
              manifest_revision::text,
              packaging_proof_hash,
              archive_composition_hash,
              issued_receipt_hash
  `;
}

export function buildInsertInboxV2PrivacyExportDownloadReceiptSql(
  input: IssueClaimInput
): SQL {
  return sql`
    insert into inbox_v2_data_governance_export_receipt_cas (
      tenant_id,
      receipt_key,
      artifact_claim_key,
      principal_key,
      claim_revision,
      job_id,
      job_revision,
      manifest_id,
      manifest_revision,
      packaging_proof_hash,
      archive_composition_hash,
      issued_receipt_hash,
      state,
      revision,
      created_at,
      updated_at
    ) values (
      ${input.lineage.tenantId},
      ${input.receiptKey},
      ${input.artifactClaimKey},
      ${input.principalKey},
      ${input.issuedRevision},
      ${input.lineage.jobId},
      ${input.lineage.jobRevision},
      ${input.lineage.manifestId},
      ${input.lineage.manifestRevision},
      ${input.lineage.packagingProofHash},
      ${input.lineage.archiveCompositionHash},
      ${input.lineage.issuedReceiptHash},
      'issued',
      ${input.issuedRevision},
      clock_timestamp(),
      clock_timestamp()
    )
    on conflict do nothing
    returning artifact_claim_key,
              receipt_key,
              principal_key,
              claim_revision::text,
              job_id,
              job_revision::text,
              manifest_id,
              manifest_revision::text,
              packaging_proof_hash,
              archive_composition_hash,
              issued_receipt_hash,
              state,
              revision::text
  `;
}

export function buildConsumeInboxV2PrivacyExportDownloadReceiptSql(
  input: ConsumeClaimInput
): SQL {
  return sql`
    update inbox_v2_data_governance_export_receipt_cas
       set state = 'consumed',
           revision = ${input.nextRevision},
           consumed_at = clock_timestamp(),
           updated_at = clock_timestamp()
     where tenant_id = ${input.lineage.tenantId}
       and receipt_key = ${input.receiptKey}
       and artifact_claim_key = ${input.artifactClaimKey}
       and principal_key = ${input.principalKey}
       and state = 'issued'
       and revision = ${input.expectedRevision}
       and claim_revision = ${input.expectedRevision}
       and job_id = ${input.lineage.jobId}
       and job_revision = ${input.lineage.jobRevision}
       and manifest_id = ${input.lineage.manifestId}
       and manifest_revision = ${input.lineage.manifestRevision}
       and packaging_proof_hash = ${input.lineage.packagingProofHash}
       and archive_composition_hash = ${input.lineage.archiveCompositionHash}
       and issued_receipt_hash = ${input.lineage.issuedReceiptHash}
    returning artifact_claim_key,
              receipt_key,
              principal_key,
              claim_revision::text,
              job_id,
              job_revision::text,
              manifest_id,
              manifest_revision::text,
              packaging_proof_hash,
              archive_composition_hash,
              issued_receipt_hash,
              state,
              revision::text
  `;
}

async function loadClaim(
  executor: RawSqlExecutor,
  input: IssueClaimInput | ConsumeClaimInput
): Promise<NormalizedClaimRow | null> {
  const result = await executor.execute<ClaimRow>(
    buildFindInboxV2PrivacyExportArtifactClaimSql(input)
  );
  if (result.rows.length > 1) {
    throw new Error("Privacy export artifact claim is not unique.");
  }
  return result.rows.length === 0 ? null : normalizeClaimRow(result.rows[0]!);
}

async function loadReceipt(
  executor: RawSqlExecutor,
  input: ConsumeClaimInput
): Promise<NormalizedReceiptRow | null> {
  const result = await executor.execute<ReceiptRow>(
    buildFindInboxV2PrivacyExportDownloadReceiptSql(input)
  );
  if (result.rows.length > 1) {
    throw new Error("Privacy export receipt is not unique.");
  }
  return result.rows.length === 0 ? null : normalizeReceiptRow(result.rows[0]!);
}

type NormalizedClaimRow = {
  artifact_claim_key: string;
  receipt_key: string;
  principal_key: string;
  claim_revision: string;
  job_id: string;
  job_revision: string;
  manifest_id: string;
  manifest_revision: string;
  packaging_proof_hash: string;
  archive_composition_hash: string;
  issued_receipt_hash: string;
};

type NormalizedReceiptRow = NormalizedClaimRow & {
  state: string;
  revision: string;
};

function normalizeIssueInput(input: {
  artifactClaimKey: string;
  receiptKey: string;
  principalKey: string;
  issuedRevision: string;
  lineage: InboxV2PrivacyExportClaimLineage;
}): IssueClaimInput {
  return {
    artifactClaimKey: boundedOpaque(input.artifactClaimKey, "artifactClaimKey"),
    receiptKey: boundedOpaque(input.receiptKey, "receiptKey"),
    principalKey: boundedOpaque(input.principalKey, "principalKey"),
    issuedRevision: inboxV2EntityRevisionSchema.parse(input.issuedRevision),
    lineage: normalizeLineage(input.lineage)
  };
}

function normalizeConsumeInput(input: {
  artifactClaimKey: string;
  receiptKey: string;
  principalKey: string;
  expectedRevision: string;
  nextRevision: string;
  lineage: InboxV2PrivacyExportClaimLineage;
}): ConsumeClaimInput {
  const expectedRevision = inboxV2EntityRevisionSchema.parse(
    input.expectedRevision
  );
  const nextRevision = inboxV2EntityRevisionSchema.parse(input.nextRevision);
  if (BigInt(nextRevision) !== BigInt(expectedRevision) + 1n) {
    throw new Error(
      "Privacy export receipt CAS must advance exactly one revision."
    );
  }
  return {
    artifactClaimKey: boundedOpaque(input.artifactClaimKey, "artifactClaimKey"),
    receiptKey: boundedOpaque(input.receiptKey, "receiptKey"),
    principalKey: boundedOpaque(input.principalKey, "principalKey"),
    expectedRevision,
    nextRevision,
    lineage: normalizeLineage(input.lineage)
  };
}

function normalizeLineage(
  lineage: InboxV2PrivacyExportClaimLineage
): NormalizedClaimLineage {
  const job = inboxV2PrivacyExportJobReferenceSchema.parse(lineage.job);
  const manifest = inboxV2PrivacyExportManifestReferenceSchema.parse(
    lineage.manifest
  );
  if (job.tenantId !== manifest.tenantId) {
    throw new Error("Privacy export claim lineage cannot cross tenants.");
  }
  return {
    tenantId: inboxV2TenantIdSchema.parse(job.tenantId),
    jobId: String(job.jobId),
    jobRevision: job.revision,
    manifestId: String(manifest.manifestId),
    manifestRevision: manifest.revision,
    manifestHash: inboxV2Sha256DigestSchema.parse(manifest.manifestHash),
    packagingProofHash: inboxV2Sha256DigestSchema.parse(
      lineage.packagingProofHash
    ),
    archiveCompositionHash: inboxV2Sha256DigestSchema.parse(
      lineage.archiveCompositionHash
    ),
    issuedReceiptHash: inboxV2Sha256DigestSchema.parse(
      lineage.issuedReceiptHash
    )
  };
}

function boundedOpaque(value: string, field: string): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 512 ||
    [...value].some((character) => {
      const codePoint = character.codePointAt(0)!;
      return codePoint <= 31 || codePoint === 127;
    })
  ) {
    throw new Error(`${field} must be one bounded opaque token.`);
  }
  return value;
}

function normalizeClaimRow(row: ClaimRow): NormalizedClaimRow {
  return {
    artifact_claim_key: requiredString(row.artifact_claim_key),
    receipt_key: requiredString(row.receipt_key),
    principal_key: requiredString(row.principal_key),
    claim_revision: requiredString(row.claim_revision),
    job_id: requiredString(row.job_id),
    job_revision: requiredString(row.job_revision),
    manifest_id: requiredString(row.manifest_id),
    manifest_revision: requiredString(row.manifest_revision),
    packaging_proof_hash: requiredString(row.packaging_proof_hash),
    archive_composition_hash: requiredString(row.archive_composition_hash),
    issued_receipt_hash: requiredString(row.issued_receipt_hash)
  };
}

function normalizeReceiptRow(row: ReceiptRow): NormalizedReceiptRow {
  return {
    ...normalizeClaimRow(row),
    state: requiredString(row.state),
    revision: requiredString(row.revision)
  };
}

function assertExactClaimRow(
  row: ClaimRow,
  input: IssueClaimInput | ConsumeClaimInput
): void {
  if (!claimRowMatches(normalizeClaimRow(row), input)) {
    throw new Error("Persisted privacy export claim lost its exact lineage.");
  }
}

function assertExactReceiptRow(
  row: ReceiptRow,
  input: IssueClaimInput | ConsumeClaimInput,
  state: "issued" | "consumed"
): void {
  const normalized = normalizeReceiptRow(row);
  if (!receiptRowMatches(normalized, input, state)) {
    throw new Error("Persisted privacy export receipt lost its exact lineage.");
  }
}

function claimRowMatches(
  row: NormalizedClaimRow,
  input: IssueClaimInput | ConsumeClaimInput
): boolean {
  return (
    row.artifact_claim_key === input.artifactClaimKey &&
    row.receipt_key === input.receiptKey &&
    row.principal_key === input.principalKey &&
    row.claim_revision ===
      ("issuedRevision" in input
        ? input.issuedRevision
        : input.expectedRevision) &&
    row.job_id === input.lineage.jobId &&
    row.job_revision === input.lineage.jobRevision &&
    row.manifest_id === input.lineage.manifestId &&
    row.manifest_revision === input.lineage.manifestRevision &&
    row.packaging_proof_hash === input.lineage.packagingProofHash &&
    row.archive_composition_hash === input.lineage.archiveCompositionHash &&
    row.issued_receipt_hash === input.lineage.issuedReceiptHash
  );
}

function receiptRowMatches(
  row: NormalizedReceiptRow,
  input: IssueClaimInput | ConsumeClaimInput,
  state: "issued" | "consumed"
): boolean {
  const revision =
    state === "consumed" && "nextRevision" in input
      ? input.nextRevision
      : "issuedRevision" in input
        ? input.issuedRevision
        : input.expectedRevision;
  return (
    claimRowMatches(row, input) &&
    row.state === state &&
    row.revision === revision
  );
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Privacy export claim repository returned an invalid row.");
  }
  return value;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

export type { InboxV2PrivacyExportClaimRepositoryResult };
