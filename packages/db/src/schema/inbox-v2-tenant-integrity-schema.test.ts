import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import * as schema from "./index";

describe("Inbox V2 tenant relationship catalog", () => {
  it("maps tenant_id at the same FK position for every tenant-owned V2 parent edge", () => {
    const tablesByName = new Map<string, PgTable>();

    for (const exported of Object.values(schema)) {
      if (is(exported, PgTable)) {
        tablesByName.set(getTableConfig(exported).name, exported);
      }
    }

    const inspectedEdges: string[] = [];
    const unsafeEdges: string[] = [];

    for (const table of tablesByName.values()) {
      const config = getTableConfig(table);
      if (
        !config.name.startsWith("inbox_v2_") ||
        !config.columns.some((column) => column.name === "tenant_id")
      ) {
        continue;
      }

      for (const foreignKey of config.foreignKeys) {
        const reference = foreignKey.reference();
        const parentConfig = getTableConfig(reference.foreignTable);
        if (
          !parentConfig.columns.some((column) => column.name === "tenant_id")
        ) {
          continue;
        }

        const childColumns = reference.columns.map((column) => column.name);
        const parentColumns = reference.foreignColumns.map(
          (column) => column.name
        );
        const edge = `${config.name}.${foreignKey.getName()}`;
        inspectedEdges.push(edge);

        const childTenantPosition = childColumns.indexOf("tenant_id");
        const parentTenantPosition = parentColumns.indexOf("tenant_id");
        if (
          childTenantPosition === -1 ||
          parentTenantPosition === -1 ||
          childTenantPosition !== parentTenantPosition
        ) {
          unsafeEdges.push(
            `${edge}: (${childColumns.join(",")}) -> ${parentConfig.name}(${parentColumns.join(",")})`
          );
        }
      }
    }

    // Keep this catalog-wide so dropping most V2 exports/FKs cannot turn the
    // invariant into a vacuous pass. The current schema exposes 570 such edges.
    expect(inspectedEdges.length).toBeGreaterThan(500);
    expect(unsafeEdges).toEqual([]);
  });
});
