import { permissionCatalog } from "@hulee/core";
import { createTranslator } from "@hulee/i18n";
import { describe, expect, it } from "vitest";

import {
  allowedPermissionScopesText,
  permissionDescriptionKey,
  summarizePermissionCatalogDomains
} from "./rbac-permission-display";

describe("rbac permission display", () => {
  it("has a human-readable description key for every permission", () => {
    expect(
      permissionCatalog.map((permission) =>
        permissionDescriptionKey(permission.id)
      )
    ).toHaveLength(permissionCatalog.length);
  });

  it("summarizes the catalog by product domain without losing permissions", () => {
    const summarizedPermissions = summarizePermissionCatalogDomains().flatMap(
      (summary) => summary.permissions
    );

    expect(new Set(summarizedPermissions)).toEqual(
      new Set(permissionCatalog.map((permission) => permission.id))
    );
  });

  it("formats allowed scopes through i18n labels", () => {
    const { t } = createTranslator("en");

    expect(allowedPermissionScopesText("message.reply", t)).toContain("Queue");
  });
});
