import { isPermission } from "@hulee/core";
import { describe, expect, it } from "vitest";

import {
  findRoleTemplate,
  roleTemplateCatalog,
  roleTemplateIds,
  roleTemplatePermissionsFitRecommendedScope,
  uniqueRoleTemplateName
} from "./role-templates";

describe("role templates", () => {
  it("defines one valid template per template id", () => {
    expect(roleTemplateCatalog.map((template) => template.id)).toEqual([
      ...roleTemplateIds
    ]);

    for (const template of roleTemplateCatalog) {
      expect(findRoleTemplate(template.id)).toBe(template);
      expect(template.permissions.length).toBeGreaterThan(0);
      expect(template.permissions.every(isPermission)).toBe(true);
    }
  });

  it("keeps recommended scopes compatible with every template permission", () => {
    for (const template of roleTemplateCatalog) {
      expect(roleTemplatePermissionsFitRecommendedScope(template)).toBe(true);
    }
  });

  it("generates a unique copy name when the template role already exists", () => {
    expect(uniqueRoleTemplateName(["Sales"], "Sales")).toBe("Sales (2)");
    expect(uniqueRoleTemplateName(["Sales", "Sales (2)"], "Sales")).toBe(
      "Sales (3)"
    );
    expect(uniqueRoleTemplateName([], "Support")).toBe("Support");
  });
});
