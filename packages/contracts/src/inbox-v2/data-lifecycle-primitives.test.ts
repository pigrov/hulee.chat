import { describe, expect, it } from "vitest";

import {
  inboxV2DataSensitivitySchema,
  inboxV2LifecycleActionSchema,
  inboxV2RetentionPeriodSchema,
  inboxV2RetentionWindowSchema,
  inboxV2StorageRootKindSchema,
  inboxV2VersionedProfileReferenceSchema
} from "./data-lifecycle-primitives";

describe("Inbox V2 data lifecycle primitives", () => {
  it("keeps sensitivity, storage-root and expiry-action vocabularies closed", () => {
    expect(inboxV2DataSensitivitySchema.options).toEqual([
      "secret",
      "restricted_content",
      "sensitive_personal",
      "personal_identifier",
      "personal_operational",
      "security_evidence",
      "non_personal_aggregate"
    ]);
    expect(inboxV2StorageRootKindSchema.options).toEqual([
      "sql",
      "json_blob",
      "object",
      "index_cache",
      "log_trace",
      "backup",
      "external_route"
    ]);
    expect(inboxV2LifecycleActionSchema.options).toEqual([
      "hard_delete",
      "purge_content_keep_tombstone",
      "remove_identity_resolution_keep_subjectless_fact",
      "pseudonymize",
      "anonymize_and_reaggregate",
      "compact_to_safe_skeleton",
      "external_delete_request_then_track"
    ]);

    for (const forbidden of [
      "blocked_by_legal_hold",
      "hold_no_purge",
      "forever"
    ]) {
      expect(inboxV2LifecycleActionSchema.safeParse(forbidden).success).toBe(
        false
      );
    }
    expect(inboxV2StorageRootKindSchema.safeParse("vector_db").success).toBe(
      false
    );
  });

  it("accepts only finite, canonical elapsed/calendar/business-day periods", () => {
    expect(
      inboxV2RetentionPeriodSchema.parse({ kind: "elapsed", seconds: 3_600 })
    ).toEqual({ kind: "elapsed", seconds: 3_600 });
    expect(
      inboxV2RetentionPeriodSchema.parse({
        kind: "calendar",
        years: 3,
        months: 0,
        days: 0
      })
    ).toEqual({ kind: "calendar", years: 3, months: 0, days: 0 });
    expect(
      inboxV2RetentionPeriodSchema.parse({
        kind: "business_days",
        days: 10,
        calendar: { id: "core:business-calendar.ru", version: "3" }
      })
    ).toMatchObject({ kind: "business_days", days: 10 });

    for (const invalid of [
      { kind: "elapsed", seconds: 0 },
      { kind: "elapsed", seconds: Number.POSITIVE_INFINITY },
      { kind: "calendar", years: 0, months: 0, days: 0 },
      { kind: "calendar", years: -1, months: 0, days: 0 },
      {
        kind: "business_days",
        days: 10,
        calendar: { id: "core:business-calendar.ru", version: 3 }
      },
      { kind: "forever" }
    ]) {
      expect(inboxV2RetentionPeriodSchema.safeParse(invalid).success).toBe(
        false
      );
    }
  });

  it("requires versioned condition review and profile references", () => {
    const reviewedCondition = {
      kind: "until_condition_then_period",
      condition: {
        id: "core:relationship-ended",
        version: "1",
        resolverHandlerId: "core:data-lifecycle.relationship-end-resolver"
      },
      period: { kind: "elapsed", seconds: 86_400 },
      reviewPeriod: { kind: "elapsed", seconds: 604_800 }
    };

    expect(inboxV2RetentionWindowSchema.parse(reviewedCondition)).toMatchObject(
      reviewedCondition
    );
    expect(
      inboxV2RetentionWindowSchema.safeParse({
        ...reviewedCondition,
        reviewPeriod: undefined
      }).success
    ).toBe(false);
    expect(
      inboxV2RetentionWindowSchema.safeParse({
        ...reviewedCondition,
        condition: { ...reviewedCondition.condition, version: "0" }
      }).success
    ).toBe(false);
    expect(
      inboxV2VersionedProfileReferenceSchema.safeParse({
        id: "core:profile",
        version: 1
      }).success
    ).toBe(false);
  });
});
