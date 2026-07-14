import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("tenant admin read-model boundary", () => {
  it("does not use the inbox read model for admin tenant context pages", () => {
    const offenders = adminPageFiles().filter((file) =>
      readFileSync(file, "utf8").includes("loadInboxViewModel")
    );

    expect(offenders).toEqual([]);
  });

  it("keeps target-scoped admin pages off permission-presence enforcement", () => {
    const targetScopedPages = [
      join(process.cwd(), "apps", "web", "app", "admin", "audit", "page.tsx"),
      join(
        process.cwd(),
        "apps",
        "web",
        "app",
        "admin",
        "employees",
        "page.tsx"
      ),
      join(
        process.cwd(),
        "apps",
        "web",
        "app",
        "admin",
        "employees",
        "[employeeId]",
        "access",
        "page.tsx"
      ),
      join(
        process.cwd(),
        "apps",
        "web",
        "app",
        "admin",
        "org-structure",
        "page.tsx"
      ),
      join(process.cwd(), "apps", "web", "app", "admin", "roles", "page.tsx")
    ];
    const offenders = targetScopedPages.filter((file) =>
      readFileSync(file, "utf8").includes("hasEffectivePermission")
    );

    expect(offenders).toEqual([]);
  });

  it("keeps the shared admin command boundary authentication-only", () => {
    const boundary = readFileSync(
      join(
        process.cwd(),
        "apps",
        "web",
        "src",
        "web-admin-command-boundary.ts"
      ),
      "utf8"
    );

    expect(boundary).not.toContain("assertCurrentWebEffectiveTenantPermission");
    expect(boundary).not.toContain("permission:");
  });

  it("uses the same access-denied boundary for missing and hidden employee targets", () => {
    const page = readFileSync(
      join(
        process.cwd(),
        "apps",
        "web",
        "app",
        "admin",
        "employees",
        "[employeeId]",
        "access",
        "page.tsx"
      ),
      "utf8"
    );
    const missingTargetStart = page.indexOf("if (employee === null)");
    const hiddenTargetStart = page.indexOf(
      'permission: "employees.manage"',
      missingTargetStart
    );
    const authorizedContentStart = page.indexOf(
      "const { t } = createTranslator",
      hiddenTargetStart
    );
    const missingTargetBranch = page.slice(
      missingTargetStart,
      hiddenTargetStart
    );
    const hiddenTargetBranch = page.slice(
      hiddenTargetStart,
      authorizedContentStart
    );

    expect(missingTargetStart).toBeGreaterThanOrEqual(0);
    expect(hiddenTargetStart).toBeGreaterThan(missingTargetStart);
    expect(authorizedContentStart).toBeGreaterThan(hiddenTargetStart);
    expect(missingTargetBranch).toContain("<AccessDeniedPage");
    expect(hiddenTargetBranch).toContain("<AccessDeniedPage");
    expect(missingTargetBranch).not.toContain("redirect(");
  });
});

function adminPageFiles(): readonly string[] {
  return listFiles(join(process.cwd(), "apps", "web", "app", "admin")).filter(
    (file) => file.endsWith(".tsx")
  );
}

function listFiles(directory: string): readonly string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);

    if (statSync(path).isDirectory()) {
      return listFiles(path);
    }

    return [path];
  });
}
