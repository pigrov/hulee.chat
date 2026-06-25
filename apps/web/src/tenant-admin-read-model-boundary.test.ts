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
