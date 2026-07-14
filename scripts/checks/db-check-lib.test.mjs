import { describe, expect, it } from "vitest";

import {
  assertDrizzleSnapshotParity,
  assertParentUniqueConstraintsBeforeForeignKeys,
  assertSqlStatementParity,
  collectFinalizedMigrationDdlStatements,
  migrationJournal,
  normalizeDrizzleSnapshot,
  splitMigrationStatements
} from "./db-check-lib.mjs";

describe("DB check generated-schema parity helpers", () => {
  it("splits migration breakpoints and normalizes line endings", () => {
    expect(
      splitMigrationStatements(
        "  create table one ();\r\n--> statement-breakpoint\r\ncreate table two ();\r\n"
      )
    ).toEqual(["create table one ();", "create table two ();"]);
  });

  it("removes the preflight and any discovered invariant-block count", () => {
    const invariantBlocks = [
      { name: "FIRST", sql: "create function first();" },
      { name: "SECOND", sql: "create function second();" },
      { name: "THIRD", sql: "create function third();" }
    ];
    const migrationSql = [
      "-- FINALIZED\n-- PREFLIGHT\ndo preflight;",
      "create table one ();",
      invariantBlocks[0].sql,
      "create table two ();",
      invariantBlocks[1].sql,
      invariantBlocks[2].sql
    ].join("\n--> statement-breakpoint\n");

    expect(
      collectFinalizedMigrationDdlStatements({
        migrationSql,
        finalizedMarker: "-- FINALIZED",
        preflightMarker: "-- PREFLIGHT",
        invariantBlocks
      })
    ).toEqual(["create table one ();", "create table two ();"]);
  });

  it("requires every discovered invariant block exactly once", () => {
    expect(() =>
      collectFinalizedMigrationDdlStatements({
        migrationSql: [
          "-- FINALIZED\n-- PREFLIGHT\ndo preflight;",
          "create function duplicate();",
          "create function duplicate();"
        ].join("\n--> statement-breakpoint\n"),
        finalizedMarker: "-- FINALIZED",
        preflightMarker: "-- PREFLIGHT",
        invariantBlocks: [
          { name: "DUPLICATE", sql: "create function duplicate();" }
        ]
      })
    ).toThrow(/exactly once; found 2/u);
  });

  it("removes only the explicitly supplied invariant block", () => {
    expect(
      collectFinalizedMigrationDdlStatements({
        migrationSql: [
          "-- WORK ITEM FINALIZED\n-- WORK ITEM PREFLIGHT\ndo preflight;",
          "create table work_item ();",
          "create function work_item_invariant();",
          "create function unrelated_invariant();"
        ].join("\n--> statement-breakpoint\n"),
        finalizedMarker: "-- WORK ITEM FINALIZED",
        preflightMarker: "-- WORK ITEM PREFLIGHT",
        invariantBlocks: [
          {
            name: "INBOX_V2_WORK_ITEM_INVARIANTS_SQL",
            sql: "create function work_item_invariant();"
          }
        ]
      })
    ).toEqual([
      "create table work_item ();",
      "create function unrelated_invariant();"
    ]);
  });

  it("requires finalized marker and preflight exactly once", () => {
    expect(() =>
      collectFinalizedMigrationDdlStatements({
        migrationSql: [
          "-- FINALIZED\n-- PREFLIGHT\ndo preflight;",
          "-- FINALIZED\ncreate table duplicate_marker ();",
          "create function invariant();"
        ].join("\n--> statement-breakpoint\n"),
        finalizedMarker: "-- FINALIZED",
        preflightMarker: "-- PREFLIGHT",
        invariantBlocks: [
          { name: "INVARIANT", sql: "create function invariant();" }
        ]
      })
    ).toThrow(/marker and preflight exactly once/u);
  });

  it("requires each parent unique constraint exactly once before any foreign key", () => {
    const constraintNames = [
      "org_units_tenant_id_unique",
      "teams_tenant_id_unique",
      "work_queues_tenant_id_unique"
    ];
    const parentConstraints = constraintNames.map(
      (name) =>
        `ALTER TABLE "parent" ADD CONSTRAINT "${name}" UNIQUE("tenant_id", "id");`
    );
    const foreignKey =
      'ALTER TABLE "child" ADD CONSTRAINT "child_parent_fk" FOREIGN KEY ("tenant_id", "parent_id") REFERENCES "parent"("tenant_id", "id");';

    expect(() =>
      assertParentUniqueConstraintsBeforeForeignKeys({
        migrationSql: [...parentConstraints, foreignKey].join("\n"),
        constraintNames
      })
    ).not.toThrow();

    expect(() =>
      assertParentUniqueConstraintsBeforeForeignKeys({
        migrationSql: [
          ...parentConstraints,
          parentConstraints[0],
          foreignKey
        ].join("\n"),
        constraintNames
      })
    ).toThrow(/org_units_tenant_id_unique.*exactly once; found 2/u);

    expect(() =>
      assertParentUniqueConstraintsBeforeForeignKeys({
        migrationSql: [
          parentConstraints[0],
          foreignKey,
          parentConstraints[1],
          parentConstraints[2]
        ].join("\n"),
        constraintNames
      })
    ).toThrow(/teams_tenant_id_unique.*precede the first foreign key/u);
  });

  it("compares generated DDL as a duplicate-aware statement multiset", () => {
    expect(() =>
      assertSqlStatementParity(
        ["create table a ();", "create table a ();", "create table b ();"],
        ["create table b ();", "create table a ();"]
      )
    ).toThrow(/Missing \(1\): create table a/u);

    expect(() =>
      assertSqlStatementParity(
        ["create table a ();", "create table b ();"],
        ["create table b ();", "create table a ();"]
      )
    ).not.toThrow();
  });

  it("ignores only the random snapshot ID and keeps prevId authoritative", () => {
    const expected = {
      id: "generated-random-id",
      prevId: "base-id",
      tables: { "public.example": { name: "example" } }
    };
    const actual = {
      ...expected,
      id: "checked-in-random-id"
    };

    expect(normalizeDrizzleSnapshot(actual)).not.toHaveProperty("id");
    expect(() =>
      assertDrizzleSnapshotParity(
        expected,
        actual,
        "packages/db/drizzle/meta/0030_snapshot.json"
      )
    ).not.toThrow();
    expect(() =>
      assertDrizzleSnapshotParity(
        expected,
        {
          ...actual,
          prevId: "wrong-base-id"
        },
        "packages/db/drizzle/meta/0030_snapshot.json"
      )
    ).toThrow(/0030_snapshot\.json.*at \$\.prevId/u);
  });

  it("builds an exact base journal without accepting a missing boundary", () => {
    const journal = {
      version: "7",
      entries: [{ idx: 27 }, { idx: 28 }, { idx: 29 }]
    };
    expect(migrationJournal(journal, 28).entries).toEqual([
      { idx: 27 },
      { idx: 28 }
    ]);
    expect(() => migrationJournal(journal, 26)).toThrow(
      /no base migration index 26/u
    );
  });
});
