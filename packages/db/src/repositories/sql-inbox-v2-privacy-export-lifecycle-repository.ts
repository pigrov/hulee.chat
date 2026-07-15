import {
  defineInboxV2PrivacyExportLifecycleRepository,
  inboxV2PrivacyExportArtifactLifecycleHeadSchema,
  inboxV2PrivacyExportLifecycleBootstrapInputSchema,
  inboxV2PrivacyExportLifecycleKeySchema,
  inboxV2PrivacyExportLifecycleSnapshotSchema,
  inboxV2PrivacyExportLifecycleTransitionInputSchema,
  type InboxV2PrivacyExportArtifactLifecycleRevision,
  type InboxV2PrivacyExportLifecycleBootstrapInput,
  type InboxV2PrivacyExportLifecycleKey,
  type InboxV2PrivacyExportLifecycleRepository,
  type InboxV2PrivacyExportLifecycleSnapshot,
  type InboxV2PrivacyExportLifecycleTransitionInput
} from "@hulee/contracts";
import { sql, type SQL } from "drizzle-orm";

import type { HuleeDatabase } from "../client";
import { buildInboxV2AdvisoryXactLockSql } from "./sql-inbox-v2-advisory-lock";
import type { RawSqlExecutor } from "./sql-outbox-repository";

export type InboxV2PrivacyExportLifecycleTransactionExecutor =
  RawSqlExecutor & {
    transaction<TResult>(
      work: (transaction: RawSqlExecutor) => Promise<TResult>
    ): Promise<TResult>;
  };

type ExportJobRow = {
  tenant_id: unknown;
  job_id: unknown;
  revision: unknown;
  state_revision: unknown;
  state: unknown;
  product_kind: unknown;
  product_authority_id: unknown;
  product_authority_revision: unknown;
  product_authority_hash: unknown;
  tenant_scope_registry_composition_hash: unknown;
  tenant_scope_root_set_hash: unknown;
  tenant_scope_export_root_set_hash: unknown;
  tenant_scope_proof_hash: unknown;
  request_id: unknown;
  request_revision: unknown;
  scope_manifest_id: unknown;
  scope_manifest_revision: unknown;
  governance_context_id: unknown;
  governance_context_version: unknown;
  governance_context_hash: unknown;
  policy_id: unknown;
  policy_version: unknown;
  policy_hash: unknown;
  activation_id: unknown;
  activation_revision: unknown;
  activation_hash: unknown;
  registry_id: unknown;
  registry_revision: unknown;
  export_handler_id: unknown;
  principal_key: unknown;
  export_manifest_id: unknown;
  export_manifest_revision: unknown;
  export_manifest_hash: unknown;
  export_artifact_id: unknown;
  export_artifact_revision: unknown;
  created_at: unknown;
  updated_at: unknown;
};

type ArtifactHeadRow = {
  tenant_id: unknown;
  artifact_id: unknown;
  job_id: unknown;
  job_revision: unknown;
  artifact_claim_key: unknown;
  current_revision: unknown;
  current_state: unknown;
  updated_at: unknown;
};

type PersistedLifecycle = Readonly<{
  bootstrap: InboxV2PrivacyExportLifecycleBootstrapInput;
  current: InboxV2PrivacyExportLifecycleSnapshot;
}>;

class ExportLifecycleConflict extends Error {
  constructor() {
    super("Privacy export lifecycle compare-and-set conflict.");
    this.name = "ExportLifecycleConflict";
  }
}

/** PostgreSQL authority for job state CAS and immutable artifact revisions. */
export function createSqlInboxV2PrivacyExportLifecycleRepository(
  executor: InboxV2PrivacyExportLifecycleTransactionExecutor | HuleeDatabase
): InboxV2PrivacyExportLifecycleRepository {
  const transactionExecutor =
    executor as unknown as InboxV2PrivacyExportLifecycleTransactionExecutor;

  return defineInboxV2PrivacyExportLifecycleRepository({
    async bootstrap(rawInput) {
      const input =
        inboxV2PrivacyExportLifecycleBootstrapInputSchema.parse(rawInput);
      try {
        return await transactionExecutor.transaction(async (transaction) => {
          await transaction.execute(
            buildLockInboxV2PrivacyExportLifecycleSql(input.key)
          );
          const existing = await loadPersistedLifecycle(
            transaction,
            input.key,
            true
          );
          if (existing !== null) {
            return {
              outcome: sameBootstrap(existing.bootstrap, input)
                ? "already_applied"
                : "conflict",
              current: existing.current
            } as const;
          }

          const inserted = await transaction.execute<{ applied: unknown }>(
            buildBootstrapInboxV2PrivacyExportLifecycleSql(input)
          );
          if (
            inserted.rows.length !== 1 ||
            inserted.rows[0]?.applied !== true
          ) {
            throw new ExportLifecycleConflict();
          }
          const current = await loadPersistedLifecycle(
            transaction,
            input.key,
            true
          );
          if (current === null || !sameBootstrap(current.bootstrap, input)) {
            throw new ExportLifecycleConflict();
          }
          return { outcome: "applied", current: current.current } as const;
        });
      } catch (error) {
        if (!isLifecycleConflict(error)) throw error;
        const winner = await loadPersistedLifecycleAfterConflict(
          transactionExecutor,
          input.key
        );
        if (winner === null) throw error;
        return {
          outcome: sameBootstrap(winner.bootstrap, input)
            ? "already_applied"
            : "conflict",
          current: winner.current
        } as const;
      }
    },

    async loadCurrent(rawKey) {
      const key = inboxV2PrivacyExportLifecycleKeySchema.parse(rawKey);
      const persisted = await transactionExecutor.transaction((transaction) =>
        loadPersistedLifecycle(transaction, key, true)
      );
      return persisted === null
        ? ({ outcome: "not_found" } as const)
        : ({ outcome: "found", current: persisted.current } as const);
    },

    async compareAndSet(rawInput) {
      const input =
        inboxV2PrivacyExportLifecycleTransitionInputSchema.parse(rawInput);
      try {
        return await transactionExecutor.transaction(async (transaction) => {
          await transaction.execute(
            buildLockInboxV2PrivacyExportLifecycleSql(input.key)
          );
          const persisted = await loadPersistedLifecycle(
            transaction,
            input.key,
            true
          );
          if (persisted === null) return { outcome: "not_found" } as const;
          if (sameSnapshot(persisted.current, input.candidate)) {
            return {
              outcome: "already_applied",
              current: persisted.current
            } as const;
          }
          if (!sameSnapshot(persisted.current, input.expected)) {
            return {
              outcome: "conflict",
              current: persisted.current
            } as const;
          }

          if (input.artifactRevision !== null) {
            await appendArtifactRevision(transaction, input);
          }
          const updated = await transaction.execute<{ applied: unknown }>(
            buildCompareAndSetInboxV2PrivacyExportJobSql(input)
          );
          if (updated.rows.length !== 1 || updated.rows[0]?.applied !== true) {
            throw new ExportLifecycleConflict();
          }
          const current = await loadPersistedLifecycle(
            transaction,
            input.key,
            true
          );
          if (
            current === null ||
            !sameSnapshot(current.current, input.candidate)
          ) {
            throw new ExportLifecycleConflict();
          }
          return { outcome: "applied", current: current.current } as const;
        });
      } catch (error) {
        if (!isLifecycleConflict(error)) throw error;
        const winner = await loadPersistedLifecycleAfterConflict(
          transactionExecutor,
          input.key
        );
        if (winner === null) return { outcome: "not_found" } as const;
        return sameSnapshot(winner.current, input.candidate)
          ? ({
              outcome: "already_applied",
              current: winner.current
            } as const)
          : ({ outcome: "conflict", current: winner.current } as const);
      }
    }
  });
}

export function buildLockInboxV2PrivacyExportLifecycleSql(
  key: InboxV2PrivacyExportLifecycleKey
): SQL {
  return buildInboxV2AdvisoryXactLockSql([
    key.tenantId,
    key.jobId,
    key.revision
  ]);
}

export function buildFindInboxV2PrivacyExportLifecycleJobSql(input: {
  key: InboxV2PrivacyExportLifecycleKey;
  forUpdate: boolean;
}): SQL {
  const lock = input.forUpdate ? sql`for update of job` : sql``;
  return sql`
    select job.tenant_id,
           job.job_id,
           job.revision::text,
           job.state_revision::text,
           job.state,
           job.product_kind,
           job.product_authority_id,
           job.product_authority_revision::text,
           job.product_authority_hash,
           tenant_scope.registry_composition_hash as tenant_scope_registry_composition_hash,
           tenant_scope.root_set_hash as tenant_scope_root_set_hash,
           tenant_scope.export_root_set_hash as tenant_scope_export_root_set_hash,
           tenant_scope.proof_hash as tenant_scope_proof_hash,
           job.request_id,
           job.request_revision::text,
           job.scope_manifest_id,
           job.scope_manifest_revision::text,
           job.governance_context_id,
           job.governance_context_version::text,
           job.governance_context_hash,
           job.policy_id,
           job.policy_version::text,
           job.policy_hash,
           job.activation_id,
           job.activation_revision::text,
           job.activation_hash,
           job.registry_id,
           job.registry_revision::text,
           job.export_handler_id,
           job.principal_key,
           job.export_manifest_id,
           job.export_manifest_revision::text,
           (
             select manifest.manifest_hash
               from inbox_v2_data_governance_export_manifests manifest
              where manifest.tenant_id = job.tenant_id
                and manifest.manifest_id = job.export_manifest_id
                and manifest.revision = job.export_manifest_revision
                and manifest.job_id = job.job_id
                and manifest.job_revision = job.revision
           ) as export_manifest_hash,
           job.export_artifact_id,
           job.export_artifact_revision::text,
           job.created_at,
           job.updated_at
      from inbox_v2_data_governance_export_jobs job
      left join inbox_v2_data_governance_tenant_termination_scope_authorities tenant_scope
        on tenant_scope.tenant_id = job.tenant_id
       and tenant_scope.manifest_id = job.scope_manifest_id
       and tenant_scope.manifest_revision = job.scope_manifest_revision
     where job.tenant_id = ${input.key.tenantId}
       and job.job_id = ${input.key.jobId}
       and job.revision = ${input.key.revision}
     ${lock}
  `;
}

export function buildFindInboxV2PrivacyExportArtifactHeadSql(input: {
  key: InboxV2PrivacyExportLifecycleKey;
  artifactId: string;
  artifactRevision: string;
  forUpdate: boolean;
}): SQL {
  const lock = input.forUpdate ? sql`for update` : sql``;
  return sql`
    select tenant_id,
           artifact_id,
           job_id,
           job_revision::text,
           artifact_claim_key,
           current_revision::text,
           current_state,
           updated_at
      from inbox_v2_data_governance_export_artifact_heads
     where tenant_id = ${input.key.tenantId}
       and artifact_id = ${input.artifactId}
       and current_revision = ${input.artifactRevision}
       and job_id = ${input.key.jobId}
       and job_revision = ${input.key.revision}
     ${lock}
  `;
}

export function buildBootstrapInboxV2PrivacyExportLifecycleSql(
  input: InboxV2PrivacyExportLifecycleBootstrapInput
): SQL {
  const authority = persistenceAuthorityColumns(input);
  return sql`
    with applied as (
      insert into inbox_v2_data_governance_export_jobs (
        tenant_id,
        job_id,
        revision,
        state_revision,
        state,
        product_kind,
        product_authority_id,
        product_authority_revision,
        product_authority_hash,
        request_id,
        request_revision,
        scope_manifest_id,
        scope_manifest_revision,
        governance_context_id,
        governance_context_version,
        governance_context_hash,
        policy_id,
        policy_version,
        policy_hash,
        activation_id,
        activation_revision,
        activation_hash,
        registry_id,
        registry_revision,
        export_handler_id,
        principal_key,
        canonical_snapshot,
        created_at,
        updated_at
      ) values (
        ${input.key.tenantId},
        ${input.key.jobId},
        ${input.key.revision},
        1,
        'queued',
        ${input.productKind},
        ${authority.productAuthorityId},
        ${authority.productAuthorityRevision},
        ${authority.productAuthorityHash},
        ${input.request?.id ?? null},
        ${input.request?.revision ?? null},
        ${authority.scopeManifestId},
        ${authority.scopeManifestRevision},
        ${authority.governanceContextId},
        ${authority.governanceContextVersion},
        ${authority.governanceContextHash},
        ${authority.policyId},
        ${authority.policyVersion},
        ${authority.policyHash},
        ${authority.activationId},
        ${authority.activationRevision},
        ${authority.activationHash},
        ${input.registry.id},
        ${input.registry.revision},
        ${input.exportHandlerId},
        ${input.principalKey},
        ${JSON.stringify(input)}::jsonb,
        ${input.createdAt},
        ${input.createdAt}
      )
      on conflict do nothing
      returning true as applied
    )
    select applied from applied
  `;
}

export function buildInsertInboxV2PrivacyExportArtifactRevisionSql(
  revision: InboxV2PrivacyExportArtifactLifecycleRevision
): SQL {
  return sql`
    with applied as (
      insert into inbox_v2_data_governance_export_artifacts (
        tenant_id,
        artifact_id,
        revision,
        job_id,
        job_revision,
        state,
        artifact_claim_key,
        manifest_id,
        manifest_revision,
        manifest_hash,
        payload_checksum,
        payload_locator,
        packaging_proof_hash,
        archive_composition_hash,
        byte_count,
        ready_at,
        expires_at,
        deleted_at,
        canonical_snapshot,
        recorded_at
      ) values (
        ${revision.tenantId},
        ${revision.artifactId},
        ${revision.revision},
        ${revision.job.jobId},
        ${revision.job.revision},
        ${revision.state},
        ${revision.artifactClaimKey},
        ${revision.manifest?.manifestId ?? null},
        ${revision.manifest?.revision ?? null},
        ${revision.manifest?.manifestHash ?? null},
        ${revision.payloadChecksum},
        ${revision.payloadLocator},
        ${revision.packagingProofHash},
        ${revision.archiveCompositionHash},
        ${revision.byteCount},
        ${revision.readyAt},
        ${revision.expiresAt},
        ${revision.deletedAt},
        ${JSON.stringify(revision)}::jsonb,
        ${revision.recordedAt}
      )
      on conflict do nothing
      returning true as applied
    )
    select applied from applied
  `;
}

export function buildInsertInboxV2PrivacyExportArtifactHeadSql(
  input: InboxV2PrivacyExportLifecycleTransitionInput
): SQL {
  const artifact = requiredCandidateArtifact(input);
  return sql`
    with applied as (
      insert into inbox_v2_data_governance_export_artifact_heads (
        tenant_id,
        artifact_id,
        job_id,
        job_revision,
        artifact_claim_key,
        current_revision,
        current_state,
        updated_at
      ) values (
        ${input.key.tenantId},
        ${artifact.reference.artifactId},
        ${input.key.jobId},
        ${input.key.revision},
        ${artifact.artifactClaimKey},
        ${artifact.reference.revision},
        ${artifact.reference.state},
        ${input.candidate.updatedAt}
      )
      on conflict do nothing
      returning true as applied
    )
    select applied from applied
  `;
}

export function buildCompareAndSetInboxV2PrivacyExportArtifactHeadSql(
  input: InboxV2PrivacyExportLifecycleTransitionInput
): SQL {
  const expected = requiredExpectedArtifact(input);
  const candidate = requiredCandidateArtifact(input);
  return sql`
    with applied as (
      update inbox_v2_data_governance_export_artifact_heads
         set current_revision = ${candidate.reference.revision},
             current_state = ${candidate.reference.state},
             updated_at = ${input.candidate.updatedAt}
       where tenant_id = ${input.key.tenantId}
         and artifact_id = ${expected.reference.artifactId}
         and job_id = ${input.key.jobId}
         and job_revision = ${input.key.revision}
         and artifact_claim_key = ${expected.artifactClaimKey}
         and current_revision = ${expected.reference.revision}
         and current_state = ${expected.reference.state}
      returning true as applied
    )
    select applied from applied
  `;
}

export function buildCompareAndSetInboxV2PrivacyExportJobSql(
  input: InboxV2PrivacyExportLifecycleTransitionInput
): SQL {
  return sql`
    with applied as (
      update inbox_v2_data_governance_export_jobs
         set state = ${input.candidate.state},
             state_revision = ${input.candidate.stateRevision},
             export_manifest_id = ${input.candidate.manifest?.manifestId ?? null},
             export_manifest_revision = ${input.candidate.manifest?.revision ?? null},
             export_artifact_id = ${input.candidate.artifact?.reference.artifactId ?? null},
             export_artifact_revision = ${input.candidate.artifact?.reference.revision ?? null},
             updated_at = ${input.candidate.updatedAt}
       where tenant_id = ${input.key.tenantId}
         and job_id = ${input.key.jobId}
         and revision = ${input.key.revision}
         and state_revision = ${input.expected.stateRevision}
         and state = ${input.expected.state}
         and export_manifest_id is not distinct from ${input.expected.manifest?.manifestId ?? null}
         and export_manifest_revision is not distinct from ${input.expected.manifest?.revision ?? null}
         and export_artifact_id is not distinct from ${input.expected.artifact?.reference.artifactId ?? null}
         and export_artifact_revision is not distinct from ${input.expected.artifact?.reference.revision ?? null}
      returning true as applied
    )
    select applied from applied
  `;
}

async function appendArtifactRevision(
  transaction: RawSqlExecutor,
  input: InboxV2PrivacyExportLifecycleTransitionInput
): Promise<void> {
  const revision = input.artifactRevision;
  if (revision === null) return;
  const inserted = await transaction.execute<{ applied: unknown }>(
    buildInsertInboxV2PrivacyExportArtifactRevisionSql(revision)
  );
  if (inserted.rows.length !== 1 || inserted.rows[0]?.applied !== true) {
    throw new ExportLifecycleConflict();
  }
  const expected = input.expected.artifact;
  const candidate = requiredCandidateArtifact(input);
  const createsHead =
    expected === null ||
    expected.reference.artifactId !== candidate.reference.artifactId;
  const head = await transaction.execute<{ applied: unknown }>(
    createsHead
      ? buildInsertInboxV2PrivacyExportArtifactHeadSql(input)
      : buildCompareAndSetInboxV2PrivacyExportArtifactHeadSql(input)
  );
  if (head.rows.length !== 1 || head.rows[0]?.applied !== true) {
    throw new ExportLifecycleConflict();
  }
}

async function loadPersistedLifecycle(
  executor: RawSqlExecutor,
  key: InboxV2PrivacyExportLifecycleKey,
  forUpdate: boolean
): Promise<PersistedLifecycle | null> {
  const result = await executor.execute<ExportJobRow>(
    buildFindInboxV2PrivacyExportLifecycleJobSql({ key, forUpdate })
  );
  if (result.rows.length > 1) {
    throw new Error("Privacy export lifecycle job authority is not unique.");
  }
  if (result.rows.length === 0) return null;
  const row = result.rows[0]!;
  const artifactId = optionalString(row.export_artifact_id);
  const artifactRevision = optionalString(row.export_artifact_revision);
  if ((artifactId === null) !== (artifactRevision === null)) {
    throw new Error("Privacy export job persisted a partial artifact head.");
  }
  const artifact =
    artifactId === null
      ? null
      : await loadArtifactHead(executor, {
          key,
          artifactId,
          artifactRevision: artifactRevision!,
          forUpdate
        });
  if (artifactId !== null && artifact === null) {
    throw new Error(
      "Privacy export job points to a missing current artifact head."
    );
  }

  const manifestId = optionalString(row.export_manifest_id);
  const manifestRevision = optionalString(row.export_manifest_revision);
  const manifestHash = optionalString(row.export_manifest_hash);
  if (
    (manifestId === null) !== (manifestRevision === null) ||
    (manifestId === null) !== (manifestHash === null)
  ) {
    throw new Error("Privacy export job points to a missing exact manifest.");
  }
  const createdAt = requiredTimestamp(row.created_at);
  const tenantId = requiredString(row.tenant_id);
  const productKind = requiredString(row.product_kind);
  const requestId = optionalString(row.request_id);
  const requestRevision = optionalString(row.request_revision);
  const scopeManifestId = optionalString(row.scope_manifest_id);
  const scopeManifestRevision = optionalString(row.scope_manifest_revision);
  if ((requestId === null) !== (requestRevision === null)) {
    throw new Error(
      "Privacy export job persisted a partial request authority."
    );
  }
  if ((scopeManifestId === null) !== (scopeManifestRevision === null)) {
    throw new Error("Privacy export job persisted a partial scope authority.");
  }
  const bootstrap = inboxV2PrivacyExportLifecycleBootstrapInputSchema.parse({
    key: {
      tenantId,
      jobId: requiredString(row.job_id),
      revision: requiredString(row.revision),
      requestedAt: createdAt
    },
    productKind,
    productAuthority: persistedProductAuthority({ row, tenantId, productKind }),
    request:
      requestId === null
        ? null
        : {
            id: requestId,
            revision: requestRevision
          },
    scopeManifest:
      productKind !== "data_subject" || scopeManifestId === null
        ? null
        : {
            id: scopeManifestId,
            revision: scopeManifestRevision
          },
    registry: {
      id: requiredString(row.registry_id),
      revision: requiredString(row.registry_revision)
    },
    exportHandlerId: requiredString(row.export_handler_id),
    principalKey: requiredString(row.principal_key),
    createdAt
  });
  const current = inboxV2PrivacyExportLifecycleSnapshotSchema.parse({
    stateRevision: requiredString(row.state_revision),
    state: requiredString(row.state),
    manifest:
      manifestId === null
        ? null
        : {
            tenantId: key.tenantId,
            manifestId,
            revision: manifestRevision,
            manifestHash
          },
    artifact,
    updatedAt: requiredTimestamp(row.updated_at)
  });
  return { bootstrap, current };
}

async function loadArtifactHead(
  executor: RawSqlExecutor,
  input: {
    key: InboxV2PrivacyExportLifecycleKey;
    artifactId: string;
    artifactRevision: string;
    forUpdate: boolean;
  }
): Promise<InboxV2PrivacyExportLifecycleSnapshot["artifact"]> {
  const result = await executor.execute<ArtifactHeadRow>(
    buildFindInboxV2PrivacyExportArtifactHeadSql(input)
  );
  if (result.rows.length > 1) {
    throw new Error("Privacy export artifact head is not unique.");
  }
  if (result.rows.length === 0) return null;
  const row = result.rows[0]!;
  return inboxV2PrivacyExportArtifactLifecycleHeadSchema.parse({
    reference: {
      tenantId: requiredString(row.tenant_id),
      artifactId: requiredString(row.artifact_id),
      revision: requiredString(row.current_revision),
      state: requiredString(row.current_state)
    },
    artifactClaimKey: requiredString(row.artifact_claim_key)
  });
}

async function loadPersistedLifecycleAfterConflict(
  executor: InboxV2PrivacyExportLifecycleTransactionExecutor,
  key: InboxV2PrivacyExportLifecycleKey
): Promise<PersistedLifecycle | null> {
  return executor.transaction(async (transaction) => {
    await transaction.execute(buildLockInboxV2PrivacyExportLifecycleSql(key));
    return loadPersistedLifecycle(transaction, key, true);
  });
}

function sameBootstrap(
  left: InboxV2PrivacyExportLifecycleBootstrapInput,
  right: InboxV2PrivacyExportLifecycleBootstrapInput
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameSnapshot(
  left: InboxV2PrivacyExportLifecycleSnapshot,
  right: InboxV2PrivacyExportLifecycleSnapshot
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function persistenceAuthorityColumns(
  input: InboxV2PrivacyExportLifecycleBootstrapInput
) {
  const authority = input.productAuthority;
  if (authority.kind !== "tenant_deployment") {
    return {
      productAuthorityId: authority.id,
      productAuthorityRevision: authority.revision,
      productAuthorityHash: authority.hash,
      scopeManifestId: input.scopeManifest?.id ?? null,
      scopeManifestRevision: input.scopeManifest?.revision ?? null,
      governanceContextId: null,
      governanceContextVersion: null,
      governanceContextHash: null,
      policyId: null,
      policyVersion: null,
      policyHash: null,
      activationId: null,
      activationRevision: null,
      activationHash: null
    } as const;
  }
  return {
    productAuthorityId: authority.tenantScope.id,
    productAuthorityRevision: authority.tenantScope.revision,
    productAuthorityHash: authority.tenantScope.proofHash,
    scopeManifestId: authority.tenantScope.id,
    scopeManifestRevision: authority.tenantScope.revision,
    governanceContextId: authority.governance.id,
    governanceContextVersion: authority.governance.version,
    governanceContextHash: authority.governance.contextHash,
    policyId: authority.policy.id,
    policyVersion: authority.policy.version,
    policyHash: authority.policy.policyHash,
    activationId: authority.activation.id,
    activationRevision: authority.activation.revision,
    activationHash: authority.activation.activationHash
  } as const;
}

function persistedProductAuthority(input: {
  row: ExportJobRow;
  tenantId: string;
  productKind: string;
}): unknown {
  const { row, tenantId, productKind } = input;
  const productAuthorityId = requiredString(row.product_authority_id);
  const productAuthorityRevision = requiredString(
    row.product_authority_revision
  );
  const productAuthorityHash = requiredString(row.product_authority_hash);
  const tenantScopeValues = {
    registryCompositionHash: optionalString(
      row.tenant_scope_registry_composition_hash
    ),
    rootSetHash: optionalString(row.tenant_scope_root_set_hash),
    exportRootSetHash: optionalString(row.tenant_scope_export_root_set_hash),
    proofHash: optionalString(row.tenant_scope_proof_hash)
  };
  const authorityValues = {
    governanceContextId: optionalString(row.governance_context_id),
    governanceContextVersion: optionalString(row.governance_context_version),
    governanceContextHash: optionalString(row.governance_context_hash),
    policyId: optionalString(row.policy_id),
    policyVersion: optionalString(row.policy_version),
    policyHash: optionalString(row.policy_hash),
    activationId: optionalString(row.activation_id),
    activationRevision: optionalString(row.activation_revision),
    activationHash: optionalString(row.activation_hash)
  };
  if (productKind !== "tenant_deployment") {
    if (
      [
        ...Object.values(tenantScopeValues),
        ...Object.values(authorityValues)
      ].some((value) => value !== null)
    ) {
      throw new Error(
        "Non-tenant export persisted tenant-deployment authority fields."
      );
    }
    return {
      kind: productKind,
      id: productAuthorityId,
      revision: productAuthorityRevision,
      hash: productAuthorityHash
    };
  }
  if (
    Object.values(tenantScopeValues).some((value) => value === null) ||
    Object.values(authorityValues).some((value) => value === null) ||
    optionalString(row.scope_manifest_id) !== productAuthorityId ||
    optionalString(row.scope_manifest_revision) !== productAuthorityRevision ||
    tenantScopeValues.proofHash !== productAuthorityHash
  ) {
    throw new Error(
      "Tenant deployment export persisted incomplete or substituted current authority."
    );
  }
  return {
    kind: "tenant_deployment",
    tenantScope: {
      kind: "tenant_termination_scope",
      tenantId,
      id: productAuthorityId,
      revision: productAuthorityRevision,
      registryCompositionHash: tenantScopeValues.registryCompositionHash,
      rootSetHash: tenantScopeValues.rootSetHash,
      exportRootSetHash: tenantScopeValues.exportRootSetHash,
      proofHash: tenantScopeValues.proofHash
    },
    governance: {
      tenantId,
      id: authorityValues.governanceContextId,
      version: authorityValues.governanceContextVersion,
      contextHash: authorityValues.governanceContextHash
    },
    policy: {
      tenantId,
      id: authorityValues.policyId,
      version: authorityValues.policyVersion,
      policyHash: authorityValues.policyHash
    },
    activation: {
      tenantId,
      id: authorityValues.activationId,
      revision: authorityValues.activationRevision,
      activationHash: authorityValues.activationHash
    }
  };
}

function requiredExpectedArtifact(
  input: InboxV2PrivacyExportLifecycleTransitionInput
) {
  if (input.expected.artifact === null) {
    throw new Error("Artifact head update requires an expected artifact.");
  }
  return input.expected.artifact;
}

function requiredCandidateArtifact(
  input: InboxV2PrivacyExportLifecycleTransitionInput
) {
  if (input.candidate.artifact === null) {
    throw new Error("Artifact revision requires a candidate artifact head.");
  }
  return input.candidate.artifact;
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(
      "Privacy export lifecycle repository returned an invalid row."
    );
  }
  return value;
}

function optionalString(value: unknown): string | null {
  return value === null || value === undefined ? null : requiredString(value);
}

function requiredTimestamp(value: unknown): string {
  const timestamp = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error(
      "Privacy export lifecycle repository returned an invalid timestamp."
    );
  }
  return inboxV2PrivacyExportLifecycleSnapshotSchema.shape.updatedAt.parse(
    timestamp.toISOString()
  );
}

function isLifecycleConflict(error: unknown): boolean {
  if (error instanceof ExportLifecycleConflict) return true;
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }
  return ["23503", "23505", "23514"].includes(
    String((error as { code?: unknown }).code)
  );
}
