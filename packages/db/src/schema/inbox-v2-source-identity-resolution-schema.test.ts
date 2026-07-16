import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  inboxV2SourceExternalIdentities,
  inboxV2SourceIdentityClaims
} from "./inbox-v2/identity-foundation";
import {
  INBOX_V2_SOURCE_IDENTITY_RESOLUTION_INTEGRITY_SQL,
  inboxV2SourceIdentityAssessmentConfidence,
  inboxV2SourceIdentityAssessmentHeads,
  inboxV2SourceIdentityAssessmentOutcome,
  inboxV2SourceIdentityAssessments,
  inboxV2SourceIdentityObservations
} from "./inbox-v2/source-identity-resolution";
import { inboxV2SourceNormalizedEnvelopes } from "./inbox-v2/source-normalization";

describe("Inbox V2 source identity resolution schema", () => {
  it("stores one exact normalized observation binding per observation key", () => {
    expect(primaryKeyColumns(inboxV2SourceIdentityObservations)).toEqual([
      ["tenant_id", "normalized_event_id", "observation_key"]
    ]);
    expectForeignKey(
      inboxV2SourceIdentityObservations,
      "inbox_v2_identity_observations_envelope_fk",
      inboxV2SourceNormalizedEnvelopes,
      ["tenant_id", "normalized_event_id", "safe_envelope_hmac_sha256"],
      ["tenant_id", "normalized_event_id", "safe_envelope_hmac_sha256"]
    );
    expectForeignKey(
      inboxV2SourceIdentityObservations,
      "inbox_v2_identity_observations_identity_fk",
      inboxV2SourceExternalIdentities,
      ["tenant_id", "source_external_identity_id"],
      ["tenant_id", "id"]
    );
    expect(
      checkSql(
        inboxV2SourceIdentityObservations,
        "inbox_v2_identity_observations_digest_check"
      )
    ).toContain("^hmac-sha256:[0-9a-f]{64}$");
  });

  it("retains explicit unresolved, conflicted and typed claimed outcomes", () => {
    expect(inboxV2SourceIdentityAssessmentOutcome.enumValues).toEqual([
      "unresolved",
      "conflicted",
      "claimed_employee",
      "claimed_client_contact"
    ]);
    expect(inboxV2SourceIdentityAssessmentConfidence.enumValues).toEqual([
      "none",
      "weak",
      "strong",
      "verified"
    ]);
    expect(columnNames(inboxV2SourceIdentityAssessments)).toEqual(
      expect.arrayContaining([
        "evidence",
        "candidates",
        "provenance",
        "assessment_digest_sha256",
        "claim_id",
        "claim_version",
        "claim_target_key"
      ])
    );
    const outcome = checkSql(
      inboxV2SourceIdentityAssessments,
      "inbox_v2_identity_assessments_outcome_check"
    );
    expect(outcome).toContain("\"outcome\" = 'conflicted'");
    expect(outcome).toContain('"candidate_count" >= 2');
    expect(outcome).toContain("\"outcome\" = 'claimed_employee'");
    expect(outcome).toContain("\"claim_target_kind\" = 'client_contact'");
  });

  it("binds a claimed assessment to the exact historical claim target", () => {
    expectForeignKey(
      inboxV2SourceIdentityAssessments,
      "inbox_v2_identity_assessments_claim_fk",
      inboxV2SourceIdentityClaims,
      [
        "tenant_id",
        "claim_id",
        "source_external_identity_id",
        "claim_version",
        "claim_target_kind",
        "claim_target_key"
      ],
      [
        "tenant_id",
        "id",
        "source_external_identity_id",
        "claim_version",
        "target_kind",
        "target_key"
      ]
    );
    expectForeignKey(
      inboxV2SourceIdentityAssessments,
      "inbox_v2_identity_assessments_observation_fk",
      inboxV2SourceIdentityObservations,
      [
        "tenant_id",
        "normalized_event_id",
        "observation_key",
        "source_external_identity_id",
        "safe_envelope_hmac_sha256"
      ],
      [
        "tenant_id",
        "normalized_event_id",
        "observation_key",
        "source_external_identity_id",
        "safe_envelope_hmac_sha256"
      ]
    );
  });

  it("keeps one exact current head and enforces append-only CAS history", () => {
    expect(primaryKeyColumns(inboxV2SourceIdentityAssessmentHeads)).toEqual([
      ["tenant_id", "source_external_identity_id"]
    ]);
    expectForeignKey(
      inboxV2SourceIdentityAssessmentHeads,
      "inbox_v2_identity_assessment_heads_latest_fk",
      inboxV2SourceIdentityAssessments,
      [
        "tenant_id",
        "latest_assessment_id",
        "source_external_identity_id",
        "latest_assessment_version",
        "normalized_event_id",
        "observation_key",
        "safe_envelope_hmac_sha256",
        "outcome",
        "confidence",
        "assessment_digest_sha256",
        "idempotency_key"
      ],
      [
        "tenant_id",
        "id",
        "source_external_identity_id",
        "assessment_version",
        "normalized_event_id",
        "observation_key",
        "safe_envelope_hmac_sha256",
        "outcome",
        "confidence",
        "assessment_digest_sha256",
        "idempotency_key"
      ]
    );
    const ddl = INBOX_V2_SOURCE_IDENTITY_RESOLUTION_INTEGRITY_SQL;
    expect(ddl).toContain(
      "inbox_v2_source_identity_resolution_reject_immutable"
    );
    expect(ddl).toContain("new.latest_assessment_version <> 1");
    expect(ddl).toContain(
      "new.latest_assessment_version <> old.latest_assessment_version + 1"
    );
    expect(ddl).toContain("deferrable initially deferred");
    expect(ddl).toContain(
      "successor.assessment_version = p_assessment_version + 1"
    );
    expect(ddl).toContain(
      "predecessor.assessment_version = p_assessment_version - 1"
    );
  });

  it("keeps append verification bounded to indexed predecessor, successor and head lookups", () => {
    const ddl = INBOX_V2_SOURCE_IDENTITY_RESOLUTION_INTEGRITY_SQL;
    expect(ddl).not.toMatch(/count\s*\(/iu);
    expect(ddl).not.toMatch(/\bmin\s*\(|\bmax\s*\(/iu);
    expect(ddl).not.toContain("assessment_history_incoherent");
    expect(ddl).toContain("inbox_v2_source_identity_assessment_assert_local");
    expect(ddl).toContain(
      "inbox_v2_source_identity_assessment_assert_head_local"
    );
    expect(ddl).toContain(
      "after insert on public.inbox_v2_source_identity_assessments"
    );
    expect(ddl).toContain(
      "after insert or update on public.inbox_v2_source_identity_assessment_heads"
    );
    expect(ddl.match(/select \* into v_head/gu)).toHaveLength(2);
    expect(ddl).toContain(
      "v_head.latest_assessment_version < p_assessment_version"
    );
    expect(ddl).toContain(
      "successor.previous_assessment_version = p_assessment_version"
    );
  });
});

function primaryKeyColumns(
  table: Parameters<typeof getTableConfig>[0]
): string[][] {
  return getTableConfig(table).primaryKeys.map((primaryKey) =>
    primaryKey.columns.map((column) => column.name)
  );
}

function columnNames(table: Parameters<typeof getTableConfig>[0]): string[] {
  return getTableConfig(table).columns.map((column) => column.name);
}

function expectForeignKey(
  table: Parameters<typeof getTableConfig>[0],
  name: string,
  foreignTable: Parameters<typeof getTableConfig>[0],
  columns: string[],
  foreignColumns: string[]
): void {
  const foreignKey = getTableConfig(table).foreignKeys.find(
    (candidate) => candidate.getName() === name
  );
  expect(foreignKey).toBeDefined();
  const reference = foreignKey?.reference();
  expect(reference?.foreignTable).toBe(foreignTable);
  expect(reference?.columns.map((column) => column.name)).toEqual(columns);
  expect(reference?.foreignColumns.map((column) => column.name)).toEqual(
    foreignColumns
  );
}

function checkSql(
  table: Parameters<typeof getTableConfig>[0],
  name: string
): string {
  const constraint = getTableConfig(table).checks.find(
    (candidate) => candidate.name === name
  );
  if (!constraint) throw new Error(`Missing check constraint: ${name}`);
  return new PgDialect().sqlToQuery(constraint.value).sql;
}
