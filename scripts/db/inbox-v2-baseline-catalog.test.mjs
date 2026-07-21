import { describe, expect, it } from "vitest";

import { normalizeInboxV2BaselineCatalogRows } from "./inbox-v2-baseline-catalog.mjs";

describe("Inbox V2 baseline catalog normalization", () => {
  it("normalizes database owners and ACL grantors without rewriting domain text", () => {
    const first = normalizeInboxV2BaselineCatalogRows(
      catalogRows("hulee", "hulee", "db_one")
    );
    const second = normalizeInboxV2BaselineCatalogRows(
      catalogRows("private-owner", '"private-owner"', "db_two")
    );

    expect(second).toEqual(first);
    expect(first).toContainEqual(
      expect.objectContaining({
        objectKind: "database",
        objectName: "<database>",
        ownerName: "<database-owner>"
      })
    );
    expect(JSON.stringify(first)).toContain("<database-owner>");
    expect(JSON.stringify(first)).toContain("hulee_internal_command");
  });

  it("fails closed without one authoritative database owner", () => {
    expect(() => normalizeInboxV2BaselineCatalogRows([])).toThrow(
      /exactly one database catalog row/u
    );
  });

  it("preserves semantically significant constraint grouping", () => {
    const left = normalizeInboxV2BaselineCatalogRows([
      ...catalogRows("hulee", "hulee", "db_one"),
      constraintRow("CHECK ((a AND b) OR c)")
    ]);
    const right = normalizeInboxV2BaselineCatalogRows([
      ...catalogRows("hulee", "hulee", "db_one"),
      constraintRow("CHECK (a AND (b OR c))")
    ]);

    expect(left).not.toEqual(right);
  });
});

function catalogRows(ownerName, aclOwnerIdentifier, databaseName) {
  const ownerAcl = `{${aclOwnerIdentifier}=CTc/${aclOwnerIdentifier},hulee_inbox_v2_runtime=c/${aclOwnerIdentifier}}`;
  return [
    {
      objectKind: "database",
      schemaName: "",
      objectName: databaseName,
      ownerName,
      definition: JSON.stringify(["-1", ownerAcl])
    },
    {
      objectKind: "relation",
      schemaName: "public",
      objectName: "inbox_v2_messages",
      ownerName,
      definition: JSON.stringify([
        "r",
        "p",
        ownerAcl,
        "false",
        "false",
        "d",
        "",
        ""
      ])
    },
    {
      objectKind: "column",
      schemaName: "public",
      objectName: "inbox_v2_messages.origin_kind",
      ownerName: "",
      definition: JSON.stringify([
        "37",
        "text",
        "true",
        "",
        "s",
        ownerAcl,
        "CASE WHEN true THEN 'hulee_internal_command'::text END",
        "default"
      ])
    }
  ];
}

function constraintRow(definition) {
  return {
    objectKind: "constraint",
    schemaName: "public",
    objectName: "inbox_v2_messages.grouping_check",
    ownerName: "",
    definition: JSON.stringify(["c", "true", "false", "false", definition])
  };
}
