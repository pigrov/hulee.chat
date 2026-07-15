import {
  INBOX_V2_SECURITY_DENIAL_POLICY,
  inboxV2SecurityDenialActionSchema,
  inboxV2SecurityDenialAlertTypeSchema,
  inboxV2SecurityDenialDispositionSchema,
  inboxV2SecurityDenialKindSchema,
  inboxV2SecurityDenialMaximumRowsPerWindow,
  inboxV2SecurityDenialPrincipalClassSchema,
  inboxV2SecurityDenialPublicErrorClassSchema,
  inboxV2SecurityDenialReviewAggregationKindSchema,
  inboxV2SecurityDenialReviewStatusSchema,
  inboxV2SecurityDenialReviewTypeSchema,
  inboxV2SecurityDenialRiskSchema
} from "@hulee/contracts";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  INBOX_V2_SECURITY_DENIAL_INTEGRITY_SQL,
  inboxV2SecurityDenialAction,
  inboxV2SecurityDenialAlertType,
  inboxV2SecurityDenialBuckets,
  inboxV2SecurityDenialDisposition,
  inboxV2SecurityDenialKind,
  inboxV2SecurityDenialPrincipalClass,
  inboxV2SecurityDenialPublicErrorClass,
  inboxV2SecurityDenialReviewAggregationKind,
  inboxV2SecurityDenialReviewDisposition,
  inboxV2SecurityDenialReviewSignals,
  inboxV2SecurityDenialReviewStatus,
  inboxV2SecurityDenialReviewType,
  inboxV2SecurityDenialRisk,
  inboxV2SecurityDenialWindowShards
} from "./inbox-v2/security-denial";

const denialTables = [
  inboxV2SecurityDenialWindowShards,
  inboxV2SecurityDenialBuckets,
  inboxV2SecurityDenialReviewSignals
] as const;

describe("Inbox V2 bounded security-denial schema", () => {
  it("declares exactly three tenant-owned bounded sink tables", () => {
    expect(denialTables.map((table) => getTableConfig(table).name)).toEqual([
      "inbox_v2_security_denial_window_shards",
      "inbox_v2_security_denial_buckets",
      "inbox_v2_security_denial_review_signals"
    ]);
    for (const table of denialTables) {
      expect(column(table, "tenant_id").notNull).toBe(true);
      for (const tableIndex of getTableConfig(table).indexes) {
        expect(indexColumnName(tableIndex.config.columns[0])).toBe("tenant_id");
      }
    }
  });

  it("keeps every database enum in exact authoritative contract order", () => {
    expect(inboxV2SecurityDenialAction.enumValues).toEqual(
      inboxV2SecurityDenialActionSchema.options
    );
    expect(inboxV2SecurityDenialPrincipalClass.enumValues).toEqual(
      inboxV2SecurityDenialPrincipalClassSchema.options
    );
    expect(inboxV2SecurityDenialKind.enumValues).toEqual(
      inboxV2SecurityDenialKindSchema.options
    );
    expect(inboxV2SecurityDenialPublicErrorClass.enumValues).toEqual(
      inboxV2SecurityDenialPublicErrorClassSchema.options
    );
    expect(inboxV2SecurityDenialRisk.enumValues).toEqual(
      inboxV2SecurityDenialRiskSchema.options
    );
    expect(inboxV2SecurityDenialReviewType.enumValues).toEqual(
      inboxV2SecurityDenialReviewTypeSchema.options
    );
    expect(inboxV2SecurityDenialAlertType.enumValues).toEqual(
      inboxV2SecurityDenialAlertTypeSchema.options
    );
    expect(inboxV2SecurityDenialDisposition.enumValues).toEqual(
      inboxV2SecurityDenialDispositionSchema.options
    );
    expect(inboxV2SecurityDenialReviewAggregationKind.enumValues).toEqual(
      inboxV2SecurityDenialReviewAggregationKindSchema.options
    );
    expect(inboxV2SecurityDenialReviewStatus.enumValues).toEqual(
      inboxV2SecurityDenialReviewStatusSchema.options
    );
    expect(inboxV2SecurityDenialReviewDisposition.enumValues).toEqual([
      "candidate_created",
      "candidate_aggregated",
      "overflow_created",
      "overflow_aggregated"
    ]);
  });

  it("encodes the fixed shard, detail, candidate and E30D budgets", () => {
    expect(INBOX_V2_SECURITY_DENIAL_POLICY).toMatchObject({
      windowSeconds: 3_600,
      retentionSeconds: 2_592_000,
      shardCount: 16,
      detailBucketLimitPerShard: 16,
      reviewCandidateLimitPerShard: 4,
      attemptRateLimitPerShard: 600
    });
    expect(inboxV2SecurityDenialMaximumRowsPerWindow()).toBe(528);
    const windowPolicy = checkSql(
      inboxV2SecurityDenialWindowShards,
      "inbox_v2_security_denial_window_policy_check"
    );
    const windowCounts = checkSql(
      inboxV2SecurityDenialWindowShards,
      "inbox_v2_security_denial_window_counts_check"
    );
    const expiryChecks = [
      windowPolicy,
      checkSql(
        inboxV2SecurityDenialBuckets,
        "inbox_v2_security_denial_buckets_window_check"
      ),
      checkSql(
        inboxV2SecurityDenialReviewSignals,
        "inbox_v2_security_denial_review_window_check"
      )
    ];
    expect(windowPolicy).toContain("3600");
    expect(windowPolicy).toContain("2592000");
    expect(windowPolicy).toContain("between 0 and 16 - 1");
    expect(windowCounts).toContain("between 0 and 16");
    expect(windowCounts).toContain("between 0 and 4");
    expect(windowCounts).toContain("admitted_review_candidate_count");
    for (const expiryCheck of expiryChecks) {
      expect(expiryCheck).toContain(
        '"window_started_at" + make_interval(secs => 2592000)'
      );
      expect(expiryCheck).not.toContain(
        '"window_ended_at" + make_interval(secs => 2592000)'
      );
    }
  });

  it("stores only typed decisions, HMACs and opaque candidate references", () => {
    const allColumns = denialTables.flatMap((table) =>
      getTableConfig(table).columns.map((tableColumn) => ({
        name: tableColumn.name,
        sqlType: tableColumn.getSQLType()
      }))
    );
    for (const forbidden of [
      "target_id",
      "request_id",
      "correlation_id",
      "client_mutation_id",
      "ip",
      "email",
      "phone",
      "headers",
      "body",
      "metadata",
      "payload",
      "provider_id"
    ]) {
      expect(allColumns.map(({ name }) => name)).not.toContain(forbidden);
    }
    expect(allColumns.map(({ sqlType }) => sqlType)).not.toContain("json");
    expect(allColumns.map(({ sqlType }) => sqlType)).not.toContain("jsonb");

    const bucketIdentity = checkSql(
      inboxV2SecurityDenialBuckets,
      "inbox_v2_security_denial_buckets_identity_check"
    );
    const reviewShape = checkSql(
      inboxV2SecurityDenialReviewSignals,
      "inbox_v2_security_denial_review_shape_check"
    );
    const bucketDecision = checkSql(
      inboxV2SecurityDenialBuckets,
      "inbox_v2_security_denial_buckets_decision_check"
    );
    const reviewPresentation = checkSql(
      inboxV2SecurityDenialReviewSignals,
      "inbox_v2_security_denial_review_presentation_check"
    );
    expect(bucketIdentity).toContain("^hmac-sha256:[a-f0-9]{64}$");
    expect(bucketIdentity).toContain("^security-denial-key:[a-f0-9]{16,32}$");
    expect(reviewShape).toContain("^internal-ref:[a-f0-9]{32,64}$");
    expect(reviewShape).toContain('"candidate_ref" is null');
    expect(reviewShape).toContain("\"review_type\" = 'manual_self_claim'");
    expect(bucketDecision).toContain("authorization.privileged_mutation");
    expect(bucketDecision).toContain("identity.claim");
    expect(bucketDecision).toContain(
      "\"denial_kind\" = 'manual_self_claim') ="
    );
    expect(bucketDecision).toContain("identity_claim_self_forbidden");
    expect(reviewPresentation).toContain("privacy_control_review");
    expect(reviewPresentation).toContain("abuse_threshold_alert");
  });

  it("binds candidates and all child rows to one exact tenant shard", () => {
    expectForeignKey(
      inboxV2SecurityDenialBuckets,
      "inbox_v2_security_denial_buckets_window_fk",
      inboxV2SecurityDenialWindowShards,
      ["tenant_id", "window_started_at", "shard_no"],
      ["tenant_id", "window_started_at", "shard_no"]
    );
    expectForeignKey(
      inboxV2SecurityDenialReviewSignals,
      "inbox_v2_security_denial_review_signals_window_fk",
      inboxV2SecurityDenialWindowShards,
      ["tenant_id", "window_started_at", "shard_no"],
      ["tenant_id", "window_started_at", "shard_no"]
    );
    expectForeignKey(
      inboxV2SecurityDenialReviewSignals,
      "inbox_v2_security_denial_review_signals_bucket_fk",
      inboxV2SecurityDenialBuckets,
      ["tenant_id", "window_started_at", "shard_no", "candidate_fingerprint"],
      ["tenant_id", "window_started_at", "shard_no", "dedupe_fingerprint"]
    );
    const aggregationKey = column(
      inboxV2SecurityDenialReviewSignals,
      "aggregation_key"
    );
    expect(aggregationKey.generated).toBeDefined();
    expect(
      column(inboxV2SecurityDenialReviewSignals, "review_sequence")
        .generatedIdentity
    ).toBeDefined();
  });

  it("installs one canonical O(1) recorder and bounded tenant prune", () => {
    const invariantSql = INBOX_V2_SECURITY_DENIAL_INTEGRITY_SQL;
    expect(
      invariantSql.match(/create or replace function public\./g)
    ).toHaveLength(3);
    expect(
      invariantSql.match(/set search_path = pg_catalog, public, pg_temp/g)
    ).toHaveLength(3);
    expect(invariantSql).toContain("public.inbox_v2_security_denial_record(");
    expect(invariantSql).toContain("public.inbox_v2_security_denial_prune(");
    expect(invariantSql).toContain(
      "public.inbox_v2_security_denial_integrity_guard()"
    );
    expect(invariantSql).toContain("inbox_v2.security_denial_policy_mismatch");
    expect(invariantSql).toContain("date_bin(");
    expect(invariantSql).toContain("v_observed_at timestamptz := date_trunc(");
    expect(invariantSql).toContain("p_observation_receipt text");
    expect(invariantSql).not.toContain("p_occurred_at");
    expect(invariantSql).toContain("v_expires_at := v_window_started_at +");
    expect(invariantSql).not.toContain("v_expires_at := v_window_ended_at +");
    expect(invariantSql).toContain(
      "substring(p_actor_fingerprint from 13 for 8)"
    );
    expect(invariantSql).not.toContain(
      "substring(p_dedupe_fingerprint from 13 for 8)"
    );
    expect(invariantSql).toContain("for update");
    expect(invariantSql).toContain("9223372036854775807");
    expect(invariantSql).toMatch(/admitted_detail_bucket_count <\s+16/u);
    expect(invariantSql).toMatch(/admitted_review_candidate_count <\s+4/u);
    expect(invariantSql).toContain("v_shard.attempt_count > 600");
    expect(invariantSql).toContain("denial_rate_exceeded");
    expect(invariantSql).toContain("denial_volume_exceeded");
    expect(invariantSql).toContain("authorization.privileged_mutation");
    expect(invariantSql).toContain("p_denial_kind <> 'manual_self_claim'");
    expect(invariantSql).toContain(
      "inbox_v2.security_denial_manual_self_claim_invalid"
    );
    const manualReviewIndex = invariantSql.indexOf(
      "if p_denial_kind = 'manual_self_claim' then"
    );
    const privacyReviewIndex = invariantSql.indexOf(
      "elsif p_action::text like 'privacy.%' then"
    );
    const crossReviewIndex = invariantSql.indexOf(
      "elsif p_denial_kind = 'cross_tenant_probe' then"
    );
    const hiddenReviewIndex = invariantSql.indexOf(
      "elsif p_denial_kind = 'unknown_or_hidden_resource' then"
    );
    expect(manualReviewIndex).toBeGreaterThan(-1);
    expect(manualReviewIndex).toBeLessThan(privacyReviewIndex);
    expect(privacyReviewIndex).toBeLessThan(crossReviewIndex);
    expect(crossReviewIndex).toBeLessThan(hiddenReviewIndex);
    expect(invariantSql).toContain("review_types");
    expect(invariantSql).toContain("review_dispositions");
    expect(invariantSql).toContain("for update skip locked");
    expect(invariantSql).toContain("limit p_batch_size");
    expect(invariantSql).not.toContain("p_now timestamptz");
    expect(invariantSql).toContain(
      "inbox_v2.security_denial_detail_budget_exceeded"
    );
    expect(invariantSql).toContain(
      "inbox_v2.security_denial_review_budget_exceeded"
    );
    expect(invariantSql).toContain(
      "inbox_v2.security_denial_cardinality_invalid"
    );
    expect(invariantSql).toContain(
      "inbox_v2.security_denial_window_clock_invalid"
    );
    expect(invariantSql.match(/create constraint trigger/g)).toHaveLength(3);
    expect(invariantSql).not.toMatch(/\bjsonb?\b/u);
    expect(invariantSql).not.toContain("inbox_v2_tenant_stream");
    expect(invariantSql).not.toContain("inbox_v2_domain_events");
    expect(invariantSql).not.toContain("inbox_v2_outbox");
  });
});

function column(
  table: Parameters<typeof getTableConfig>[0],
  name: string
): ReturnType<typeof getTableConfig>["columns"][number] {
  const tableColumn = getTableConfig(table).columns.find(
    (candidate) => candidate.name === name
  );
  if (!tableColumn) throw new Error(`Missing expected column: ${name}`);
  return tableColumn;
}

function checkSql(
  table: Parameters<typeof getTableConfig>[0],
  name: string
): string {
  const constraint = getTableConfig(table).checks.find(
    (candidate) => candidate.name === name
  );
  if (!constraint) throw new Error(`Missing expected check: ${name}`);
  return new PgDialect().sqlToQuery(constraint.value).sql;
}

function indexColumnName(
  tableColumn: ReturnType<
    typeof getTableConfig
  >["indexes"][number]["config"]["columns"][number]
): string | undefined {
  return "name" in tableColumn && typeof tableColumn.name === "string"
    ? tableColumn.name
    : undefined;
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
  expect(reference?.columns.map((tableColumn) => tableColumn.name)).toEqual(
    columns
  );
  expect(
    reference?.foreignColumns.map((tableColumn) => tableColumn.name)
  ).toEqual(foreignColumns);
}
