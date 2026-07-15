import {
  inboxV2PrivacyExportJobReferenceSchema,
  inboxV2PrivacyExportManifestReferenceSchema,
  inboxV2PolicyActivationAuthoritySchema,
  inboxV2Sha256DigestSchema,
  inboxV2TenantIdSchema,
  type InboxV2PrivacyExportClaimLineage
} from "@hulee/contracts";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  buildConsumeInboxV2PrivacyExportDownloadReceiptSql,
  buildCompareAndSetInboxV2PolicyActivationHeadSql,
  buildFindCurrentInboxV2PolicyActivationSql,
  buildFindInboxV2PolicyActivationPresenceSql,
  buildFindInboxV2PrivacyExportArtifactAuthoritySql,
  buildInsertInboxV2PrivacyExportArtifactClaimSql,
  buildInsertInboxV2PrivacyExportDownloadReceiptSql,
  createSqlInboxV2PolicyActivationRepository,
  createSqlInboxV2PrivacyExportClaimRepository,
  type InboxV2PrivacyExportClaimTransactionExecutor
} from "./sql-inbox-v2-data-governance-privacy-repository";

const tenantId = inboxV2TenantIdSchema.parse("tenant:tenant-1");
const requestedAt = "2026-07-15T08:00:00.000Z";
const hashA = inboxV2Sha256DigestSchema.parse(`sha256:${"a".repeat(64)}`);
const hashB = inboxV2Sha256DigestSchema.parse(`sha256:${"b".repeat(64)}`);
const hashC = inboxV2Sha256DigestSchema.parse(`sha256:${"c".repeat(64)}`);

const lineage: InboxV2PrivacyExportClaimLineage = {
  job: inboxV2PrivacyExportJobReferenceSchema.parse({
    tenantId,
    jobId: "privacy-export-job:job-1",
    revision: "7",
    requestedAt
  }),
  manifest: inboxV2PrivacyExportManifestReferenceSchema.parse({
    tenantId,
    manifestId: "privacy-export-manifest:manifest-1",
    revision: "4",
    manifestHash: hashA
  }),
  packagingProofHash: hashA,
  archiveCompositionHash: hashB,
  issuedReceiptHash: hashC
};

const base = {
  artifactClaimKey: "artifact-claim:one",
  receiptKey: "receipt:one",
  principalKey: "principal:employee-1",
  lineage
} as const;

const policyAuthority = inboxV2PolicyActivationAuthoritySchema.parse({
  tenantId,
  registryCompositionHash: hashA,
  governance: {
    tenantId,
    id: "core:governance-context.lifecycle",
    version: "3",
    contextHash: hashB
  },
  effectivePolicy: {
    tenantId,
    id: "core:lifecycle-policy.default",
    version: "8",
    policyHash: hashC
  },
  activation: {
    tenantId,
    id: "core:lifecycle-policy-activation.default",
    revision: "2",
    activationHash: hashA
  }
});

describe("Inbox V2 durable policy activation authority", () => {
  it("loads the current policy/governance/registry activation lineage", async () => {
    const executor = queuedExecutor([
      [policyAuthorityRow(policyAuthority, "5")]
    ]);
    const repository = createSqlInboxV2PolicyActivationRepository(executor);

    await expect(
      repository.loadCurrent({
        tenantId,
        policyId: policyAuthority.effectivePolicy.id
      })
    ).resolves.toEqual({ outcome: "found", current: policyAuthority });
    expect(executor.queries[0]).toContain(
      "from inbox_v2_data_governance_policy_activation_heads head"
    );
    expect(executor.queries[0]).not.toContain("for update of head");
  });

  it("bootstraps one current authority through advisory lock and relational lineage proof", async () => {
    const executor = queuedExecutor([
      [],
      [],
      [presenceRow()],
      [{ applied: true }]
    ]);
    const repository = createSqlInboxV2PolicyActivationRepository(executor);

    await expect(
      repository.compareAndSetActivation({
        key: { tenantId, policyId: policyAuthority.effectivePolicy.id },
        expectedCurrent: null,
        candidate: policyAuthority
      })
    ).resolves.toEqual({ outcome: "applied", current: policyAuthority });
    expect(executor.queries[0]).toContain("pg_advisory_xact_lock");
    expect(executor.queries[1]).toContain("for update of head");
    expect(executor.queries[2]).toContain("exact_lineage_found");
    expect(executor.queries[3]).toContain(
      "insert into inbox_v2_data_governance_policy_activation_heads"
    );
  });

  it("reports current and missing-lineage conflicts without advancing the head", async () => {
    const prior = inboxV2PolicyActivationAuthoritySchema.parse({
      ...policyAuthority,
      effectivePolicy: { ...policyAuthority.effectivePolicy, version: "7" },
      activation: { ...policyAuthority.activation, revision: "1" }
    });
    const conflict = queuedExecutor([[], [policyAuthorityRow(prior, "4")]]);
    await expect(
      createSqlInboxV2PolicyActivationRepository(
        conflict
      ).compareAndSetActivation({
        key: { tenantId, policyId: policyAuthority.effectivePolicy.id },
        expectedCurrent: null,
        candidate: policyAuthority
      })
    ).resolves.toEqual({ outcome: "current_conflict", current: prior });
    expect(conflict.queries).toHaveLength(2);

    const missing = queuedExecutor([
      [],
      [],
      [presenceRow({ registry_found: false })]
    ]);
    await expect(
      createSqlInboxV2PolicyActivationRepository(
        missing
      ).compareAndSetActivation({
        key: { tenantId, policyId: policyAuthority.effectivePolicy.id },
        expectedCurrent: null,
        candidate: policyAuthority
      })
    ).resolves.toEqual({
      outcome: "not_found",
      missingAuthority: "registry_composition"
    });
    expect(missing.queries).toHaveLength(3);
  });

  it("rejects a candidate whose persisted transition does not name the expected authority", async () => {
    const prior = inboxV2PolicyActivationAuthoritySchema.parse({
      ...policyAuthority,
      effectivePolicy: { ...policyAuthority.effectivePolicy, version: "7" },
      activation: { ...policyAuthority.activation, revision: "1" }
    });
    const executor = queuedExecutor([
      [],
      [policyAuthorityRow(prior, "4")],
      [presenceRow({ exact_lineage_found: false })]
    ]);

    await expect(
      createSqlInboxV2PolicyActivationRepository(
        executor
      ).compareAndSetActivation({
        key: { tenantId, policyId: policyAuthority.effectivePolicy.id },
        expectedCurrent: prior,
        candidate: policyAuthority
      })
    ).resolves.toEqual({ outcome: "lineage_conflict", current: prior });
    expect(executor.queries).toHaveLength(3);
    expect(executor.queries[2]).toContain(
      "transition_kind = 'supersede_current'"
    );
    expect(executor.queries[2]).toContain("prior_activation_id =");
    expect(executor.queries[2]).toContain("prior_activation_revision =");
    expect(executor.queries[2]).toContain("prior_policy_version =");
  });

  it("builds tenant-fenced compare-and-set SQL for bootstrap and supersession", () => {
    const key = {
      tenantId,
      policyId: policyAuthority.effectivePolicy.id
    };
    const currentSql = render(
      buildFindCurrentInboxV2PolicyActivationSql({ key, forUpdate: true })
    );
    const bootstrapSql = render(
      buildCompareAndSetInboxV2PolicyActivationHeadSql({
        mutation: { key, expectedCurrent: null, candidate: policyAuthority },
        expectedHeadRevision: null
      })
    );
    const supersedeSql = render(
      buildCompareAndSetInboxV2PolicyActivationHeadSql({
        mutation: {
          key,
          expectedCurrent: policyAuthority,
          candidate: policyAuthority
        },
        expectedHeadRevision: "5"
      })
    );
    const bootstrapPresenceSql = render(
      buildFindInboxV2PolicyActivationPresenceSql({
        candidate: policyAuthority,
        expectedCurrent: null
      })
    );
    const supersedePresenceSql = render(
      buildFindInboxV2PolicyActivationPresenceSql({
        candidate: policyAuthority,
        expectedCurrent: policyAuthority
      })
    );

    expect(currentSql).toContain("head.tenant_id =");
    expect(currentSql).toContain("for update of head");
    expect(bootstrapSql).toContain("on conflict do nothing");
    expect(supersedeSql).toContain("head_revision = head_revision + 1");
    expect(supersedeSql).toContain("and head_revision =");
    expect(bootstrapPresenceSql).toContain(
      "transition_kind = 'initial_reviewed_bootstrap'"
    );
    expect(bootstrapPresenceSql).toContain("prior_activation_id is null");
    expect(supersedePresenceSql).toContain(
      "transition_kind = 'supersede_current'"
    );
    expect(supersedePresenceSql).toContain("prior_policy_version =");
  });
});

describe("Inbox V2 durable privacy export claims", () => {
  it("atomically issues the unique artifact claim and principal-bound receipt", async () => {
    const claim = claimRow("1");
    const receipt = receiptRow("issued", "1");
    const executor = queuedExecutor([
      [],
      [],
      [],
      [{ found: true }],
      [claim],
      [receipt]
    ]);
    const repository = createSqlInboxV2PrivacyExportClaimRepository(executor);

    await expect(
      repository.issue({ ...base, issuedRevision: "1" })
    ).resolves.toEqual({ outcome: "applied", claimRevision: "1" });
    expect(executor.transactionCount).toBe(1);
    expect(executor.queries).toHaveLength(6);
    expect(executor.queries[0]).toContain("pg_advisory_xact_lock");
    expect(executor.queries[1]).toContain("pg_advisory_xact_lock");
    expect(executor.queries[2]).toContain(
      "from inbox_v2_data_governance_export_claims"
    );
    expect(executor.queries[3]).toContain(
      "from inbox_v2_data_governance_export_artifact_heads artifact_head"
    );
    expect(executor.queries[4]).toContain(
      "insert into inbox_v2_data_governance_export_claims"
    );
    expect(executor.queries[5]).toContain(
      "insert into inbox_v2_data_governance_export_receipt_cas"
    );
  });

  it("rejects a mixed or expired artifact/job/manifest lineage before inserting a claim", async () => {
    const executor = queuedExecutor([[], [], [], []]);
    const repository = createSqlInboxV2PrivacyExportClaimRepository(executor);

    await expect(
      repository.issue({ ...base, issuedRevision: "1" })
    ).resolves.toEqual({ outcome: "conflict" });
    expect(executor.queries).toHaveLength(4);
    expect(executor.queries[3]).toContain(
      "join inbox_v2_data_governance_export_jobs job"
    );
    expect(executor.queries[3]).toContain(
      "join inbox_v2_data_governance_export_manifests manifest"
    );
    expect(executor.queries[3]).toContain("artifact.state = 'ready'");
    expect(executor.queries[3]).toContain(
      "artifact.expires_at > clock_timestamp()"
    );
    expect(executor.queries[3]).toContain("artifact.packaging_proof_hash =");
  });

  it("returns conflict without creating a second receipt for an existing claim", async () => {
    const executor = queuedExecutor([[], [], [claimRow("1")]]);
    const repository = createSqlInboxV2PrivacyExportClaimRepository(executor);

    await expect(
      repository.issue({ ...base, issuedRevision: "1" })
    ).resolves.toEqual({ outcome: "conflict" });
    expect(executor.queries).toHaveLength(3);
  });

  it("consumes only the exact issued receipt revision and immutable lineage", async () => {
    const executor = queuedExecutor([
      [],
      [],
      [claimRow("1")],
      [receiptRow("issued", "1")],
      [{ found: true }],
      [receiptRow("consumed", "2")]
    ]);
    const repository = createSqlInboxV2PrivacyExportClaimRepository(executor);

    await expect(
      repository.consume({
        ...base,
        expectedRevision: "1",
        nextRevision: "2"
      })
    ).resolves.toEqual({ outcome: "applied", claimRevision: "2" });
    expect(executor.queries[4]).toContain(
      "from inbox_v2_data_governance_export_artifact_heads artifact_head"
    );
    expect(executor.queries[5]).toContain("set state = 'consumed'");
    expect(executor.queries[5]).toContain("issued_receipt_hash");
  });

  it("rejects consumption after the current artifact head stops being ready", async () => {
    const executor = queuedExecutor([
      [],
      [],
      [claimRow("1")],
      [receiptRow("issued", "1")],
      []
    ]);
    await expect(
      createSqlInboxV2PrivacyExportClaimRepository(executor).consume({
        ...base,
        expectedRevision: "1",
        nextRevision: "2"
      })
    ).resolves.toEqual({ outcome: "conflict" });
    expect(executor.queries).toHaveLength(5);
    expect(executor.queries[4]).toContain(
      "artifact_head.current_state = 'ready'"
    );
  });

  it("rejects stale, skipped and cross-tenant receipt transitions", async () => {
    const stale = queuedExecutor([
      [],
      [],
      [claimRow("1")],
      [receiptRow("consumed", "2")]
    ]);
    await expect(
      createSqlInboxV2PrivacyExportClaimRepository(stale).consume({
        ...base,
        expectedRevision: "1",
        nextRevision: "2"
      })
    ).resolves.toEqual({ outcome: "conflict" });

    const unused = queuedExecutor([]);
    await expect(
      createSqlInboxV2PrivacyExportClaimRepository(unused).consume({
        ...base,
        expectedRevision: "1",
        nextRevision: "3"
      })
    ).rejects.toThrow(/advance exactly one revision/u);
    await expect(
      createSqlInboxV2PrivacyExportClaimRepository(unused).issue({
        ...base,
        issuedRevision: "1",
        lineage: {
          ...lineage,
          manifest: {
            ...lineage.manifest,
            tenantId: inboxV2TenantIdSchema.parse("tenant:tenant-2")
          }
        }
      })
    ).rejects.toThrow(/cannot cross tenants/u);
  });

  it("keeps all builder statements tenant-fenced and CAS-shaped", () => {
    const normalized = {
      ...base,
      issuedRevision: "1",
      lineage: {
        tenantId,
        jobId: String(lineage.job.jobId),
        jobRevision: lineage.job.revision,
        manifestId: String(lineage.manifest.manifestId),
        manifestRevision: lineage.manifest.revision,
        manifestHash: lineage.manifest.manifestHash,
        packagingProofHash: hashA,
        archiveCompositionHash: hashB,
        issuedReceiptHash: hashC
      }
    };
    const issueSql = render(
      buildInsertInboxV2PrivacyExportArtifactClaimSql(normalized)
    );
    const authoritySql = render(
      buildFindInboxV2PrivacyExportArtifactAuthoritySql(normalized)
    );
    const receiptSql = render(
      buildInsertInboxV2PrivacyExportDownloadReceiptSql(normalized)
    );
    const consumeSql = render(
      buildConsumeInboxV2PrivacyExportDownloadReceiptSql({
        ...normalized,
        expectedRevision: "1",
        nextRevision: "2"
      })
    );

    expect(issueSql).toContain("tenant_id");
    expect(authoritySql).toContain(
      "for update of artifact_head, artifact, job"
    );
    expect(authoritySql).toContain(
      "job.export_artifact_revision = artifact_head.current_revision"
    );
    expect(authoritySql).toContain("manifest.manifest_hash =");
    expect(authoritySql).toContain("artifact.manifest_id =");
    expect(authoritySql).toContain("artifact.manifest_hash =");
    expect(authoritySql).toContain("artifact.payload_checksum is not null");
    expect(issueSql).toContain("on conflict do nothing");
    expect(receiptSql).toContain("principal_key");
    expect(consumeSql).toContain("state = 'issued'");
    expect(consumeSql).toContain("revision =");
  });
});

function claimRow(revision: string) {
  return {
    artifact_claim_key: base.artifactClaimKey,
    receipt_key: base.receiptKey,
    principal_key: base.principalKey,
    claim_revision: revision,
    job_id: lineage.job.jobId,
    job_revision: lineage.job.revision,
    manifest_id: lineage.manifest.manifestId,
    manifest_revision: lineage.manifest.revision,
    packaging_proof_hash: hashA,
    archive_composition_hash: hashB,
    issued_receipt_hash: hashC
  };
}

function receiptRow(state: "issued" | "consumed", revision: string) {
  return { ...claimRow("1"), state, revision };
}

function policyAuthorityRow(
  authority: typeof policyAuthority,
  headRevision: string
) {
  return {
    tenant_id: authority.tenantId,
    registry_composition_hash: authority.registryCompositionHash,
    governance_context_id: authority.governance.id,
    governance_context_version: authority.governance.version,
    governance_context_hash: authority.governance.contextHash,
    policy_id: authority.effectivePolicy.id,
    policy_version: authority.effectivePolicy.version,
    policy_hash: authority.effectivePolicy.policyHash,
    activation_id: authority.activation.id,
    activation_revision: authority.activation.revision,
    activation_hash: authority.activation.activationHash,
    head_revision: headRevision
  };
}

function presenceRow(
  patch: Partial<
    Record<
      | "registry_found"
      | "governance_found"
      | "policy_found"
      | "activation_found"
      | "exact_lineage_found",
      boolean
    >
  > = {}
) {
  return {
    registry_found: true,
    governance_found: true,
    policy_found: true,
    activation_found: true,
    exact_lineage_found: true,
    ...patch
  };
}

function queuedExecutor(rows: readonly (readonly Record<string, unknown>[])[]) {
  let index = 0;
  const queries: string[] = [];
  const executor: InboxV2PrivacyExportClaimTransactionExecutor & {
    queries: string[];
    transactionCount: number;
  } = {
    queries,
    transactionCount: 0,
    async execute(query) {
      queries.push(render(query));
      return {
        rows: (rows[index++] ?? []) as never
      };
    },
    async transaction(work) {
      executor.transactionCount += 1;
      return work(executor);
    }
  };
  return executor;
}

function render(query: Parameters<PgDialect["sqlToQuery"]>[0]): string {
  return new PgDialect().sqlToQuery(query).sql.replace(/\s+/gu, " ").trim();
}
